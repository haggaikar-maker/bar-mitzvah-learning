'use server'

import path from 'node:path'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import {
  clearAdminSession,
  createAdminSession,
  getConfiguredAdmin,
  requireAdminSession,
} from '@/lib/admin-auth'
import {
  hashAdminPassword,
  verifyAdminPassword,
} from '@/lib/admin-security'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { supabase } from '@/lib/supabase'

function readString(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function readNumber(formData: FormData, key: string) {
  const value = readString(formData, key)
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

async function resolveValidAdminId(adminId: number | null) {
  if (!adminId) {
    return null
  }

  const { data, error } = await supabase
    .from('admins')
    .select('id')
    .eq('id', adminId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data?.id ?? null
}

function normalizePublicPath(value: string) {
  if (!value) {
    return ''
  }

  const normalized = value
    .replaceAll('\\', '/')
    .replace(/^public\//i, '')
    .replace(/^\/+/, '')

  return normalized ? `/${normalized}` : ''
}

function slugifySegment(value: string) {
  const sanitized = value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()

  return sanitized || 'item'
}

async function saveUploadedFile(
  file: FormDataEntryValue | null,
  input: {
    kind: 'audio' | 'images'
    segments: string[]
    filenameBase: string
  }
) {
  if (!(file instanceof File) || file.size === 0) {
    return null
  }

  const bucketName =
    input.kind === 'audio'
      ? process.env.SUPABASE_AUDIO_BUCKET ?? 'lesson-audio'
      : process.env.SUPABASE_IMAGE_BUCKET ?? 'lesson-images'
  const extension = path.extname(file.name) || ''
  const filename = `${slugifySegment(input.filenameBase)}-${Date.now()}${extension.toLowerCase()}`
  const objectPath = [...input.segments.map(slugifySegment), filename].join('/')

  const { error: uploadError } = await supabaseAdmin.storage
    .from(bucketName)
    .upload(objectPath, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type || undefined,
      upsert: true,
    })

  if (uploadError) {
    throw new Error(`שגיאה בהעלאת הקובץ לאחסון: ${uploadError.message}`)
  }

  const { data } = supabaseAdmin.storage.from(bucketName).getPublicUrl(objectPath)

  return data.publicUrl
}

export async function loginAdmin(formData: FormData) {
  const username = readString(formData, 'username')
  const password = readString(formData, 'password')
  const admin = getConfiguredAdmin()

  const { data: dbAdmin } = await supabase
    .from('admins')
    .select('id, username, display_name, password_hash, role')
    .eq('username', username)
    .maybeSingle()

  if (dbAdmin && verifyAdminPassword(password, dbAdmin.password_hash)) {
    await createAdminSession({
      username: dbAdmin.username,
      adminId: dbAdmin.id,
    })
    redirect('/admin')
  }

  if (!admin.isConfigured) {
    redirect('/admin?error=setup')
  }

  if (username !== admin.username || password !== admin.password) {
    redirect('/admin?error=invalid')
  }

  await createAdminSession({ username })
  redirect('/admin')
}

export async function logoutAdmin() {
  await clearAdminSession()
  redirect('/admin')
}

export async function upsertParasha(formData: FormData) {
  await requireAdminSession()

  const id = readNumber(formData, 'id')
  const name = readString(formData, 'name')

  if (!name) {
    throw new Error('יש להזין שם פרשה.')
  }

  if (id) {
    const { error } = await supabase.from('parashot').update({ name }).eq('id', id)
    if (error) throw new Error(error.message)
  } else {
    const { error } = await supabase.from('parashot').insert({ name })
    if (error) throw new Error(error.message)
  }

  revalidatePath('/admin')
}

export async function upsertSection(formData: FormData) {
  await requireAdminSession()

  const id = readNumber(formData, 'id')
  const name = readString(formData, 'name')
  const orderIndex = readNumber(formData, 'order_index')

  if (!name || orderIndex === null) {
    throw new Error('יש להזין שם חלק וסדר תצוגה.')
  }

  if (id) {
    const { error } = await supabase
      .from('sections')
      .update({ name, order_index: orderIndex })
      .eq('id', id)
    if (error) throw new Error(error.message)
  } else {
    const { error } = await supabase
      .from('sections')
      .insert({ name, order_index: orderIndex })
    if (error) throw new Error(error.message)
  }

  revalidatePath('/admin')
}

export async function upsertStudent(formData: FormData) {
  const session = await requireAdminSession()

  const id = readNumber(formData, 'id')
  const name = readString(formData, 'name')
  const username = readString(formData, 'username')
  const password = readString(formData, 'password')
  const parashaId = readNumber(formData, 'parasha_id')
  const managerId = readNumber(formData, 'manager_id')

  if (!name || !username) {
    throw new Error('יש להזין שם תלמיד ושם משתמש.')
  }

  const { data: existingStudentByUsername, error: usernameLookupError } = await supabase
    .from('students')
    .select('id')
    .eq('username', username)
    .maybeSingle()

  if (usernameLookupError) {
    throw new Error(usernameLookupError.message)
  }

  if (existingStudentByUsername && existingStudentByUsername.id !== id) {
    throw new Error('שם המשתמש הזה כבר קיים. בחר שם משתמש אחר לתלמיד.')
  }

  const requestedAdminId =
    session.role === 'primary'
      ? (managerId ?? session.id)
      : session.id
  const validAdminId = await resolveValidAdminId(requestedAdminId)

  if (requestedAdminId && !validAdminId) {
    throw new Error(
      'לא נמצא מנהל חוקי לשיוך התלמיד. התחבר עם מנהל שנשמר בבסיס הנתונים או בחר מנהל קיים.'
    )
  }

  const payload: {
    name: string
    username: string
    parasha_id: number | null
    admin_id: number | null
    password_hash?: string
  } = {
    name,
    username,
    parasha_id: parashaId,
    admin_id: validAdminId,
  }

  if (password) {
    payload.password_hash = hashAdminPassword(password)
  }

  let studentId = id

  if (id) {
    const { error } = await supabase.from('students').update(payload).eq('id', id)
    if (error) throw new Error(error.message)
  } else {
    if (!payload.password_hash) {
      throw new Error('ביצירת תלמיד חדש חייבים להזין סיסמה.')
    }

    const { data, error } = await supabase
      .from('students')
      .insert(payload)
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    studentId = data.id
  }

  if (studentId) {
    await assignStudentManagerInternal({
      studentId,
      managerId: validAdminId,
    })
  }

  revalidatePath('/admin')
  revalidatePath('/student')
}

export async function ensureLessonGroup(formData: FormData) {
  const session = await requireAdminSession()

  const parashaId = readNumber(formData, 'parasha_id')
  const sectionId = readNumber(formData, 'section_id')

  if (!parashaId || !sectionId) {
    throw new Error('יש לבחור פרשה וחלק.')
  }

  const { data: existing, error: lookupError } = await supabase
    .from('lesson_groups')
    .select('id')
    .eq('admin_id', session.id ?? -1)
    .eq('parasha_id', parashaId)
    .eq('section_id', sectionId)
    .maybeSingle()

  if (lookupError) {
    throw new Error(lookupError.message)
  }

  if (!existing) {
    const { error } = await supabase
      .from('lesson_groups')
      .insert({
        admin_id: session.id,
        parasha_id: parashaId,
        section_id: sectionId,
      })
    if (error) throw new Error(error.message)
  }

  revalidatePath('/admin')
}

export async function upsertLessonPart(formData: FormData) {
  await requireAdminSession()

  const id = readNumber(formData, 'id')
  const lessonGroupId = readNumber(formData, 'lesson_group_id')
  const name = readString(formData, 'name')
  const partOrder = readNumber(formData, 'part_order')
  const audioUrl = readString(formData, 'audio_url')
  const durationSeconds = readNumber(formData, 'duration_seconds')
  const currentAudioUrl = readString(formData, 'current_audio_url')
  const currentDurationSeconds = readNumber(formData, 'current_duration_seconds')
  const isFullReading = readString(formData, 'is_full_reading') === 'on'
  const parashaName = readString(formData, 'parasha_name')
  const sectionName = readString(formData, 'section_name')
  const uploadedAudioUrl = await saveUploadedFile(formData.get('audio_file'), {
    kind: 'audio',
    segments: [parashaName || 'parasha', sectionName || 'section', name || 'part'],
    filenameBase: `${name || 'part'}-${partOrder ?? '0'}`,
  })

  if (!lessonGroupId || !name || partOrder === null) {
    throw new Error('יש להזין שם תת-חלק, סדר ומזהה קבוצה.')
  }

  const payload = {
    lesson_group_id: lessonGroupId,
    name,
    part_order: partOrder,
    is_full_reading: isFullReading,
    audio_url:
      uploadedAudioUrl ??
      (normalizePublicPath(audioUrl) || normalizePublicPath(currentAudioUrl) || null),
    duration_seconds: durationSeconds ?? currentDurationSeconds,
  }

  if (id) {
    const { error } = await supabase.from('lesson_parts').update(payload).eq('id', id)
    if (error) throw new Error(error.message)
  } else {
    const { error } = await supabase.from('lesson_parts').insert(payload)
    if (error) throw new Error(error.message)
  }

  revalidatePath('/admin')
  revalidatePath('/student')
}

export async function upsertLessonSlide(formData: FormData) {
  await requireAdminSession()

  const id = readNumber(formData, 'id')
  const lessonPartId = readNumber(formData, 'lesson_part_id')
  const imageUrl = readString(formData, 'image_url')
  const slideIndex = readNumber(formData, 'slide_index')
  const startSecond = readNumber(formData, 'start_second')
  const parashaName = readString(formData, 'parasha_name')
  const sectionName = readString(formData, 'section_name')
  const partName = readString(formData, 'part_name')
  const uploadedImageUrl = await saveUploadedFile(formData.get('image_file'), {
    kind: 'images',
    segments: [parashaName || 'parasha', sectionName || 'section', partName || 'part'],
    filenameBase: `${partName || 'slide'}-${slideIndex ?? '0'}`,
  })

  const finalImageUrl = uploadedImageUrl ?? normalizePublicPath(imageUrl)

  if (!lessonPartId || !finalImageUrl || slideIndex === null || startSecond === null) {
    throw new Error('יש להזין נתוני שקופית מלאים.')
  }

  const payload = {
    lesson_part_id: lessonPartId,
    image_url: finalImageUrl,
    slide_index: slideIndex,
    start_second: startSecond,
  }

  if (id) {
    const { error } = await supabase
      .from('lesson_slides')
      .update(payload)
      .eq('id', id)
    if (error) throw new Error(error.message)
  } else {
    const { error } = await supabase.from('lesson_slides').insert(payload)
    if (error) throw new Error(error.message)
  }

  revalidatePath('/admin')
  revalidatePath('/student')
}

async function assignStudentManagerInternal(input: {
  studentId: number
  managerId: number | null
}) {
  const { error } = await supabase
    .from('students')
    .update({ admin_id: input.managerId })
    .eq('id', input.studentId)

  if (error) {
    throw new Error(error.message)
  }
}

export async function assignStudentManager(formData: FormData) {
  const session = await requireAdminSession()

  if (session.role !== 'primary') {
    throw new Error('רק מנהל ראשי יכול להעביר תלמיד למנהל אחר.')
  }

  const studentId = readNumber(formData, 'student_id')
  const managerId = readNumber(formData, 'manager_id')

  if (!studentId) {
    throw new Error('חסר מזהה תלמיד.')
  }

  await assignStudentManagerInternal({ studentId, managerId })
  revalidatePath('/admin')
}

export async function upsertAdmin(formData: FormData) {
  const session = await requireAdminSession()

  if (session.role !== 'primary') {
    throw new Error('רק מנהל ראשי יכול לערוך מנהלים.')
  }

  const id = readNumber(formData, 'id')
  const username = readString(formData, 'username')
  const displayName = readString(formData, 'display_name')
  const password = readString(formData, 'password')
  const role = readString(formData, 'role') === 'primary' ? 'primary' : 'teacher'

  if (!username || !displayName) {
    throw new Error('יש להזין שם משתמש ושם תצוגה.')
  }

  const payload: {
    username: string
    display_name: string
    role: 'primary' | 'teacher'
    password_hash?: string
  } = {
    username,
    display_name: displayName,
    role,
  }

  if (password) {
    payload.password_hash = hashAdminPassword(password)
  }

  if (id) {
    const { error } = await supabase.from('admins').update(payload).eq('id', id)
    if (error) throw new Error(error.message)
  } else {
    if (!payload.password_hash) {
      throw new Error('ביצירת מנהל חדש חייבים להזין סיסמה.')
    }

    const { error } = await supabase.from('admins').insert(payload)
    if (error) throw new Error(error.message)
  }

  revalidatePath('/admin')
}

export async function updateMyShareCode(formData: FormData) {
  const session = await requireAdminSession()

  if (!session.id) {
    throw new Error('נדרש מנהל מתוך בסיס הנתונים כדי לעדכן קוד שיתוף.')
  }

  const shareCode = readString(formData, 'share_code')

  const { error } = await supabase
    .from('admins')
    .update({
      share_code_hash: shareCode ? hashAdminPassword(shareCode) : null,
    })
    .eq('id', session.id)

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/admin')
}

export async function copyParashaStructure(formData: FormData) {
  const session = await requireAdminSession()

  if (!session.id) {
    throw new Error('נדרש מנהל מתוך בסיס הנתונים כדי להעתיק מבנה.')
  }

  const parashaId = readNumber(formData, 'parasha_id')
  const sourceUsername = readString(formData, 'source_username')
  const shareCode = readString(formData, 'share_code')

  if (!parashaId || !sourceUsername || !shareCode) {
    throw new Error('יש לבחור פרשה, מנהל מקור וקוד שיתוף.')
  }

  const { data: sourceAdmin, error: sourceAdminError } = await supabase
    .from('admins')
    .select('id, share_code_hash')
    .eq('username', sourceUsername)
    .maybeSingle()

  if (sourceAdminError || !sourceAdmin) {
    throw new Error(sourceAdminError?.message ?? 'מנהל המקור לא נמצא.')
  }

  if (!sourceAdmin.share_code_hash || !verifyAdminPassword(shareCode, sourceAdmin.share_code_hash)) {
    throw new Error('קוד השיתוף אינו תקין.')
  }

  const { data: sourceGroups, error: sourceGroupsError } = await supabase
    .from('lesson_groups')
    .select('id, parasha_id, section_id')
    .eq('admin_id', sourceAdmin.id)
    .eq('parasha_id', parashaId)

  if (sourceGroupsError) {
    throw new Error(sourceGroupsError.message)
  }

  const groups = sourceGroups ?? []

  const { data: existingGroups, error: existingGroupsError } = await supabase
    .from('lesson_groups')
    .select('id')
    .eq('admin_id', session.id)
    .eq('parasha_id', parashaId)

  if (existingGroupsError) {
    throw new Error(existingGroupsError.message)
  }

  const existingGroupIds = (existingGroups ?? []).map((group) => group.id)

  if (existingGroupIds.length > 0) {
    const { error: deleteExistingError } = await supabase
      .from('lesson_groups')
      .delete()
      .in('id', existingGroupIds)

    if (deleteExistingError) {
      throw new Error(deleteExistingError.message)
    }
  }

  if (groups.length === 0) {
    revalidatePath('/admin')
    return
  }

  const groupIdMap = new Map<number, number>()

  for (const group of groups) {
    const { data, error } = await supabase
      .from('lesson_groups')
      .insert({
        admin_id: session.id,
        parasha_id: group.parasha_id,
        section_id: group.section_id,
      })
      .select('id')
      .single()

    if (error || !data) {
      throw new Error(error?.message ?? 'לא ניתן היה ליצור קבוצת שיעור.')
    }

    groupIdMap.set(group.id, data.id)
  }

  const sourceGroupIds = groups.map((group) => group.id)
  const { data: sourceParts, error: sourcePartsError } = await supabase
    .from('lesson_parts')
    .select('id, lesson_group_id, name, part_order, is_full_reading, audio_url, duration_seconds')
    .in('lesson_group_id', sourceGroupIds)
    .order('part_order', { ascending: true })

  if (sourcePartsError) {
    throw new Error(sourcePartsError.message)
  }

  const partIdMap = new Map<number, number>()

  for (const part of sourceParts ?? []) {
    const targetGroupId = groupIdMap.get(part.lesson_group_id)

    if (!targetGroupId) {
      continue
    }

    const { data, error } = await supabase
      .from('lesson_parts')
      .insert({
        lesson_group_id: targetGroupId,
        name: part.name,
        part_order: part.part_order,
        is_full_reading: part.is_full_reading,
        audio_url: part.audio_url,
        duration_seconds: part.duration_seconds,
      })
      .select('id')
      .single()

    if (error || !data) {
      throw new Error(error?.message ?? 'לא ניתן היה ליצור תת־חלק.')
    }

    partIdMap.set(part.id, data.id)
  }

  const sourcePartIds = (sourceParts ?? []).map((part) => part.id)

  if (sourcePartIds.length > 0) {
    const { data: sourceSlides, error: sourceSlidesError } = await supabase
      .from('lesson_slides')
      .select('lesson_part_id, image_url, slide_index, start_second')
      .in('lesson_part_id', sourcePartIds)
      .order('slide_index', { ascending: true })

    if (sourceSlidesError) {
      throw new Error(sourceSlidesError.message)
    }

    for (const slide of sourceSlides ?? []) {
      const targetPartId = partIdMap.get(slide.lesson_part_id)

      if (!targetPartId) {
        continue
      }

      const { error } = await supabase.from('lesson_slides').insert({
        lesson_part_id: targetPartId,
        image_url: slide.image_url,
        slide_index: slide.slide_index,
        start_second: slide.start_second,
      })

      if (error) {
        throw new Error(error.message)
      }
    }
  }

  revalidatePath('/admin')
}

export async function deleteStudent(formData: FormData) {
  await requireAdminSession()
  const id = readNumber(formData, 'id')
  if (!id) throw new Error('חסר מזהה תלמיד.')

  const { error } = await supabase.from('students').delete().eq('id', id)
  if (error) throw new Error(error.message)

  revalidatePath('/admin')
  revalidatePath('/student')
}

export async function deleteParasha(formData: FormData) {
  await requireAdminSession()
  const id = readNumber(formData, 'id')
  if (!id) throw new Error('חסר מזהה פרשה.')

  const { error } = await supabase.from('parashot').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/admin')
}

export async function deleteSection(formData: FormData) {
  await requireAdminSession()
  const id = readNumber(formData, 'id')
  if (!id) throw new Error('חסר מזהה חלק.')

  const { error } = await supabase.from('sections').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/admin')
}

export async function deleteLessonPart(formData: FormData) {
  await requireAdminSession()
  const id = readNumber(formData, 'id')
  if (!id) throw new Error('חסר מזהה תת-חלק.')

  const { error } = await supabase.from('lesson_parts').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/admin')
  revalidatePath('/student')
}

export async function deleteLessonSlide(formData: FormData) {
  await requireAdminSession()
  const id = readNumber(formData, 'id')
  if (!id) throw new Error('חסר מזהה שקופית.')

  const { error } = await supabase.from('lesson_slides').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/admin')
  revalidatePath('/student')
}

export async function deleteAdmin(formData: FormData) {
  const session = await requireAdminSession()

  if (session.role !== 'primary') {
    throw new Error('רק מנהל ראשי יכול למחוק מנהלים.')
  }

  const id = readNumber(formData, 'id')
  if (!id) throw new Error('חסר מזהה מנהל.')
  if (session.id === id) throw new Error('לא ניתן למחוק את המנהל שמחובר כרגע.')

  const { error } = await supabase.from('admins').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/admin')
}
