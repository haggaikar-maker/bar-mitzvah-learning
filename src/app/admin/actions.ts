'use server'

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
import { getLessonMediaKind } from '@/lib/lesson-media'
import {
  deleteStorageObject,
  normalizePublicPath,
  uploadStorageFile,
} from '@/lib/storage-files'
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

async function saveUploadedFile(
  file: FormDataEntryValue | null,
  input: {
    kind: 'audio' | 'images' | 'videos'
    segments: string[]
    filenameBase: string
  }
) {
  const uploaded = await uploadStorageFile(file, {
    kind: input.kind,
    segments: input.segments,
    filenameBase: input.filenameBase,
    visibility: 'public',
  })

  return uploaded?.publicUrl ?? null
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
  const currentVideoUrl = readString(formData, 'current_video_url')
  const currentDurationSeconds = readNumber(formData, 'current_duration_seconds')
  const isFullReading = readString(formData, 'is_full_reading') === 'on'
  const mediaKind = readString(formData, 'media_kind') === 'video' ? 'video' : 'audio_slides'
  const isVisibleToStudent = readString(formData, 'is_visible_to_student') === 'on'
  const completionTarget = readNumber(formData, 'completion_target')
  const parashaName = readString(formData, 'parasha_name')
  const sectionName = readString(formData, 'section_name')
  const uploadedAudioUrl = await saveUploadedFile(formData.get('audio_file'), {
    kind: 'audio',
    segments: [parashaName || 'parasha', sectionName || 'section', name || 'part'],
    filenameBase: `${name || 'part'}-${partOrder ?? '0'}`,
  })
  const uploadedVideoUrl = await saveUploadedFile(formData.get('video_file'), {
    kind: 'videos',
    segments: [parashaName || 'parasha', sectionName || 'section', name || 'part'],
    filenameBase: `${name || 'part'}-video-${partOrder ?? '0'}`,
  })
  const inputVideoUrl = normalizePublicPath(readString(formData, 'video_url'))

  if (!lessonGroupId || !name || partOrder === null) {
    throw new Error('יש להזין שם תת-חלק, סדר ומזהה קבוצה.')
  }

  if (completionTarget !== null && completionTarget < 1) {
    throw new Error('יעד ההשלמות חייב להיות לפחות 1.')
  }

  const nextAudioUrl =
    mediaKind === 'audio_slides'
      ? uploadedAudioUrl ??
        (normalizePublicPath(audioUrl) || normalizePublicPath(currentAudioUrl) || null)
      : null
  const fallbackVideoUrl =
    inputVideoUrl || normalizePublicPath(currentVideoUrl) || null
  const nextVideoUrl =
    mediaKind === 'video'
      ? uploadedVideoUrl ?? fallbackVideoUrl
      : null
  const payload = {
    lesson_group_id: lessonGroupId,
    name,
    part_order: partOrder,
    is_full_reading: isFullReading,
    media_kind: mediaKind,
    is_visible_to_student: isVisibleToStudent,
    completion_target: completionTarget ?? 3,
    audio_url: nextAudioUrl,
    video_url: nextVideoUrl,
    duration_seconds: durationSeconds ?? currentDurationSeconds,
  }

  if (id) {
    const { error } = await supabase.from('lesson_parts').update(payload).eq('id', id)
    if (error) {
      if (
        error.message.includes('media_kind') ||
        error.message.includes('video_url') ||
        error.message.includes('completion_target') ||
        error.message.includes('is_visible_to_student')
      ) {
        throw new Error(
          'עמודות המדיה, היעד או החשיפה עדיין לא קיימות בבסיס הנתונים. צריך להריץ את עדכון ה-SQL החדש.'
        )
      }

      throw new Error(error.message)
    }
  } else {
    const { error } = await supabase.from('lesson_parts').insert(payload)
    if (error) {
      if (
        error.message.includes('media_kind') ||
        error.message.includes('video_url') ||
        error.message.includes('completion_target') ||
        error.message.includes('is_visible_to_student')
      ) {
        throw new Error(
          'עמודות המדיה, היעד או החשיפה עדיין לא קיימות בבסיס הנתונים. צריך להריץ את עדכון ה-SQL החדש.'
        )
      }

      throw new Error(error.message)
    }
  }

  if (id && mediaKind === 'video') {
    const { error: deleteSlidesError } = await supabase
      .from('lesson_slides')
      .delete()
      .eq('lesson_part_id', id)

    if (deleteSlidesError) {
      throw new Error(deleteSlidesError.message)
    }
  }

  revalidatePath('/admin')
  revalidatePath('/student')
}

export async function resetStudentPartProgress(formData: FormData) {
  const session = await requireAdminSession()

  const studentId = readNumber(formData, 'student_id')
  const lessonPartId = readNumber(formData, 'lesson_part_id')
  const mode = readString(formData, 'mode')

  if (!studentId || !lessonPartId) {
    throw new Error('חסרים מזהי תלמיד או תת־חלק.')
  }

  const { data: student, error: studentError } = await supabase
    .from('students')
    .select('id, admin_id')
    .eq('id', studentId)
    .maybeSingle()

  if (studentError || !student) {
    throw new Error(studentError?.message ?? 'התלמיד לא נמצא.')
  }

  if (session.role !== 'primary' && student.admin_id !== session.id) {
    throw new Error('אין הרשאה לאפס נתוני מעקב עבור תלמיד זה.')
  }

  let query = supabase
    .from('practice_events')
    .delete()
    .eq('student_id', studentId)
    .eq('lesson_part_id', lessonPartId)

  if (mode === 'completed') {
    query = query.eq('completed', true)
  }

  const { error } = await query

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/admin')
  revalidatePath('/student')
}

export async function deleteStudentRecordingFromAdmin(formData: FormData) {
  const session = await requireAdminSession()

  const studentId = readNumber(formData, 'student_id')
  const lessonPartId = readNumber(formData, 'lesson_part_id')

  if (!studentId || !lessonPartId) {
    throw new Error('חסרים מזהי תלמיד או תת־חלק למחיקת ההקלטה.')
  }

  const { data: student, error: studentError } = await supabase
    .from('students')
    .select('id, admin_id')
    .eq('id', studentId)
    .maybeSingle()

  if (studentError || !student) {
    throw new Error(studentError?.message ?? 'התלמיד לא נמצא.')
  }

  if (session.role !== 'primary' && student.admin_id !== session.id) {
    throw new Error('אין הרשאה למחוק הקלטה של תלמיד זה.')
  }

  const { data: recording, error: recordingError } = await supabase
    .from('student_recordings')
    .select('id, storage_path')
    .eq('student_id', studentId)
    .eq('lesson_part_id', lessonPartId)
    .maybeSingle()

  if (recordingError) {
    throw new Error(recordingError.message)
  }

  if (recording?.storage_path) {
    await deleteStorageObject('student-recordings', recording.storage_path)
  }

  const { error } = await supabase
    .from('student_recordings')
    .delete()
    .eq('student_id', studentId)
    .eq('lesson_part_id', lessonPartId)

  if (error) {
    throw new Error(error.message)
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

  const { data: lessonPart, error: lessonPartError } = await supabase
    .from('lesson_parts')
    .select('id, media_kind, video_url')
    .eq('id', lessonPartId ?? -1)
    .maybeSingle()

  if (lessonPartError) {
    throw new Error(lessonPartError.message)
  }

  if (getLessonMediaKind(lessonPart) === 'video') {
    throw new Error('לא ניתן לשייך שקופיות לתת־חלק שמוגדר כווידאו.')
  }

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

  try {
    const { data: sourceAdmin, error: sourceAdminError } = await supabase
      .from('admins')
      .select('id, share_code_hash')
      .eq('username', sourceUsername)
      .maybeSingle()

    if (sourceAdminError || !sourceAdmin) {
      throw new Error(sourceAdminError?.message ?? 'מנהל המקור לא נמצא.')
    }

    if (
      !sourceAdmin.share_code_hash ||
      !verifyAdminPassword(shareCode, sourceAdmin.share_code_hash)
    ) {
      throw new Error('קוד השיתוף אינו תקין.')
    }

    if (sourceAdmin.id === session.id) {
      throw new Error('אי אפשר להעתיק מבנה מעצמך.')
    }

    const { data: sourceGroups, error: sourceGroupsError } = await supabase
      .from('lesson_groups')
      .select('id, parasha_id, section_id')
      .eq('admin_id', sourceAdmin.id)
      .eq('parasha_id', parashaId)
      .order('section_id', { ascending: true })

    if (sourceGroupsError) {
      throw new Error(`שגיאה בטעינת קבוצות המקור: ${sourceGroupsError.message}`)
    }

    const groups = sourceGroups ?? []

    if (groups.length === 0) {
      throw new Error('למנהל המקור אין עדיין מבנה לפרשה הזאת, ולכן לא בוצע שינוי.')
    }

    const sourceGroupIds = groups.map((group) => group.id)
    const { data: sourceParts, error: sourcePartsError } = await supabase
      .from('lesson_parts')
      .select(
        'id, lesson_group_id, name, part_order, is_full_reading, media_kind, is_visible_to_student, completion_target, audio_url, video_url, duration_seconds'
      )
      .in('lesson_group_id', sourceGroupIds)
      .order('part_order', { ascending: true })

    if (sourcePartsError) {
      throw new Error(`שגיאה בטעינת תתי־החלקים: ${sourcePartsError.message}`)
    }

    const sourcePartIds = (sourceParts ?? []).map((part) => part.id)
    let sourceSlides: Array<{
      lesson_part_id: number
      image_url: string
      slide_index: number
      start_second: number
    }> = []

    if (sourcePartIds.length > 0) {
      const { data, error } = await supabase
        .from('lesson_slides')
        .select('lesson_part_id, image_url, slide_index, start_second')
        .in('lesson_part_id', sourcePartIds)
        .order('slide_index', { ascending: true })

      if (error) {
        throw new Error(`שגיאה בטעינת השקופיות: ${error.message}`)
      }

      sourceSlides = data ?? []
    }

    const { data: existingGroups, error: existingGroupsError } = await supabase
      .from('lesson_groups')
      .select('id, section_id')
      .eq('admin_id', session.id)
      .eq('parasha_id', parashaId)

    if (existingGroupsError) {
      throw new Error(`שגיאה בטעינת קבוצות היעד: ${existingGroupsError.message}`)
    }

    const targetGroupsBySectionId = new Map(
      ((existingGroups ?? []) as Array<{ id: number; section_id: number }>).map((group) => [
        group.section_id,
        group.id,
      ])
    )
    const groupIdMap = new Map<number, number>()

    for (const group of groups) {
      let targetGroupId = targetGroupsBySectionId.get(group.section_id)

      if (!targetGroupId) {
        const { data, error } = await supabase
          .from('lesson_groups')
          .insert({
            admin_id: session.id,
            parasha_id: group.parasha_id,
            section_id: group.section_id,
          })
          .select('id')
          .single()

        if (error) {
          const { data: refetchedGroup, error: refetchError } = await supabase
            .from('lesson_groups')
            .select('id')
            .eq('admin_id', session.id)
            .eq('parasha_id', group.parasha_id)
            .eq('section_id', group.section_id)
            .maybeSingle()

          if (refetchError) {
            throw new Error(
              `שגיאה בהכנת קבוצת יעד לחלק ${group.section_id}: ${refetchError.message}`
            )
          }

          if (!refetchedGroup?.id) {
            throw new Error(
              `שגיאה בהכנת קבוצת יעד לחלק ${group.section_id}: ${error.message}`
            )
          }

          targetGroupId = refetchedGroup.id
        } else if (!data?.id) {
          throw new Error(`לא ניתן היה ליצור קבוצת יעד לחלק ${group.section_id}.`)
        } else {
          targetGroupId = data.id
        }

        if (typeof targetGroupId !== 'number') {
          throw new Error(`לא נמצאה קבוצת יעד תקינה לחלק ${group.section_id}.`)
        }

        targetGroupsBySectionId.set(group.section_id, targetGroupId)
      }

      if (typeof targetGroupId !== 'number') {
        throw new Error(`לא נמצאה קבוצת יעד תקינה לחלק ${group.section_id}.`)
      }

      groupIdMap.set(group.id, targetGroupId)
    }

    const targetGroupIds = Array.from(new Set(groupIdMap.values()))

    if (targetGroupIds.length > 0) {
      const { error: deletePartsError } = await supabase
        .from('lesson_parts')
        .delete()
        .in('lesson_group_id', targetGroupIds)

      if (deletePartsError) {
        throw new Error(`שגיאה בניקוי התוכן הישן: ${deletePartsError.message}`)
      }
    }

    const partIdMap = new Map<number, number>()

    for (const part of sourceParts ?? []) {
      const targetGroupId = groupIdMap.get(part.lesson_group_id)

      if (!targetGroupId) {
        throw new Error(`לא נמצאה קבוצת יעד עבור תת־החלק ${part.name}.`)
      }

      const { data, error } = await supabase
        .from('lesson_parts')
        .insert({
          lesson_group_id: targetGroupId,
          name: part.name,
          part_order: part.part_order,
          is_full_reading: part.is_full_reading,
          media_kind: part.media_kind ?? 'audio_slides',
          is_visible_to_student: part.is_visible_to_student ?? true,
          completion_target: part.completion_target ?? 3,
          audio_url: part.audio_url,
          video_url: part.video_url ?? null,
          duration_seconds: part.duration_seconds,
        })
        .select('id')
        .single()

      if (error || !data) {
        throw new Error(
          `שגיאה ביצירת תת־החלק "${part.name}": ${error?.message ?? 'לא ידוע.'}`
        )
      }

      partIdMap.set(part.id, data.id)
    }

    if (sourceSlides.length > 0) {
      const slidesPayload = sourceSlides
        .map((slide) => {
          const targetPartId = partIdMap.get(slide.lesson_part_id)

          if (!targetPartId) {
            return null
          }

          return {
            lesson_part_id: targetPartId,
            image_url: slide.image_url,
            slide_index: slide.slide_index,
            start_second: slide.start_second,
          }
        })
        .filter((slide): slide is NonNullable<typeof slide> => slide !== null)

      if (slidesPayload.length > 0) {
        const { error: insertSlidesError } = await supabase
          .from('lesson_slides')
          .insert(slidesPayload)

        if (insertSlidesError) {
          throw new Error(`שגיאה בהעתקת השקופיות: ${insertSlidesError.message}`)
        }
      }
    }

    revalidatePath('/admin')
  } catch (error) {
    console.error('copyParashaStructure failed', {
      sessionAdminId: session.id,
      parashaId,
      sourceUsername,
      error,
    })

    throw error instanceof Error
      ? error
      : new Error('אירעה שגיאה לא צפויה בהעתקת המבנה.')
  }
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
