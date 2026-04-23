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

function isLessonPartImportableForCopy(
  part: {
    id: number
    media_kind?: string | null
    audio_url: string | null
    video_url?: string | null
  },
  slideCountByPartId: Map<number, number>
) {
  const mediaKind = getLessonMediaKind(part)

  if (mediaKind === 'video') {
    return Boolean(part.video_url)
  }

  return Boolean(part.audio_url) && (slideCountByPartId.get(part.id) ?? 0) > 0
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

async function getManageableTeacherParasha(
  teacherParashaId: number,
  session: Awaited<ReturnType<typeof requireAdminSession>>
) {
  const { data, error } = await supabase
    .from('teacher_parashot')
    .select('id, owner_admin_id, parasha_id, nusach_id, status')
    .eq('id', teacherParashaId)
    .maybeSingle()

  if (error || !data) {
    throw new Error(error?.message ?? 'פרשת המלמד לא נמצאה.')
  }

  if (session.role !== 'primary' && data.owner_admin_id !== session.id) {
    throw new Error('אין הרשאה לנהל את פרשת המלמד הזאת.')
  }

  return data
}

async function getManageableLessonGroup(
  lessonGroupId: number,
  session: Awaited<ReturnType<typeof requireAdminSession>>
) {
  const { data, error } = await supabase
    .from('lesson_groups')
    .select('id, teacher_parasha_id')
    .eq('id', lessonGroupId)
    .maybeSingle()

  if (error || !data) {
    throw new Error(error?.message ?? 'קבוצת השיעור לא נמצאה.')
  }

  if (data.teacher_parasha_id) {
    await getManageableTeacherParasha(data.teacher_parasha_id, session)
  }

  return data
}

async function getManageableLessonPart(
  lessonPartId: number,
  session: Awaited<ReturnType<typeof requireAdminSession>>
) {
  const { data, error } = await supabase
    .from('lesson_parts')
    .select('id, lesson_group_id')
    .eq('id', lessonPartId)
    .maybeSingle()

  if (error || !data) {
    throw new Error(error?.message ?? 'תת־החלק לא נמצא.')
  }

  await getManageableLessonGroup(data.lesson_group_id, session)
  return data
}

async function assignStudentTeacherParashaInternal(input: {
  studentId: number
  teacherParashaId: number | null
  assignedByAdminId: number | null
}) {
  const { error: endAssignmentsError } = await supabase
    .from('student_teacher_parasha_assignments')
    .update({
      status: 'ended',
      ended_at: new Date().toISOString(),
    })
    .eq('student_id', input.studentId)
    .eq('status', 'active')

  if (endAssignmentsError) {
    throw new Error(endAssignmentsError.message)
  }

  if (!input.teacherParashaId) {
    return
  }

  const { error } = await supabase
    .from('student_teacher_parasha_assignments')
    .insert({
      student_id: input.studentId,
      teacher_parasha_id: input.teacherParashaId,
      assigned_by_admin_id: input.assignedByAdminId,
      status: 'active',
    })

  if (error) {
    throw new Error(error.message)
  }
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
  const session = await requireAdminSession()

  if (session.role !== 'primary') {
    throw new Error('רק מנהל ראשי יכול לערוך את רשימת הפרשות הכללית.')
  }

  const id = readNumber(formData, 'id')
  const name = readString(formData, 'name')

  if (!name) {
    throw new Error('יש להזין שם פרשה.')
  }

  const { data: existingParasha, error: existingParashaError } = await supabase
    .from('parashot')
    .select('id')
    .eq('name', name)
    .maybeSingle()

  if (existingParashaError) {
    throw new Error(existingParashaError.message)
  }

  if (existingParasha && existingParasha.id !== id) {
    throw new Error('הפרשה הזאת כבר קיימת במערכת.')
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
  const session = await requireAdminSession()

  if (session.role !== 'primary') {
    throw new Error('רק מנהל ראשי יכול לערוך את רשימת החלקים הכללית.')
  }

  const id = readNumber(formData, 'id')
  const name = readString(formData, 'name')
  const orderIndex = readNumber(formData, 'order_index')

  if (!name || orderIndex === null) {
    throw new Error('יש להזין שם חלק וסדר תצוגה.')
  }

  const { data: existingSection, error: existingSectionError } = await supabase
    .from('sections')
    .select('id')
    .eq('name', name)
    .maybeSingle()

  if (existingSectionError) {
    throw new Error(existingSectionError.message)
  }

  if (existingSection && existingSection.id !== id) {
    throw new Error('החלק הראשי הזה כבר קיים במערכת.')
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
  const teacherParashaId = readNumber(formData, 'teacher_parasha_id')
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

  let requestedAdminId =
    session.role === 'primary'
      ? (managerId ?? session.id)
      : session.id
  let resolvedParashaId: number | null = null

  if (teacherParashaId) {
    const teacherParasha = await getManageableTeacherParasha(teacherParashaId, session)
    requestedAdminId = teacherParasha.owner_admin_id
    resolvedParashaId = teacherParasha.parasha_id
  }

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
    parasha_id: resolvedParashaId,
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
    await assignStudentTeacherParashaInternal({
      studentId,
      teacherParashaId,
      assignedByAdminId: session.id,
    })
  }

  revalidatePath('/admin')
  revalidatePath('/student')
}

export async function ensureLessonGroup(formData: FormData) {
  const session = await requireAdminSession()

  const teacherParashaId = readNumber(formData, 'teacher_parasha_id')
  const sectionId = readNumber(formData, 'section_id')

  if (!teacherParashaId || !sectionId) {
    throw new Error('יש לבחור פרשת מלמד וחלק.')
  }

  const teacherParasha = await getManageableTeacherParasha(teacherParashaId, session)

  const { data: existing, error: lookupError } = await supabase
    .from('lesson_groups')
    .select('id')
    .eq('teacher_parasha_id', teacherParashaId)
    .eq('section_id', sectionId)
    .maybeSingle()

  if (lookupError) {
    throw new Error(lookupError.message)
  }

  if (!existing) {
    const { error } = await supabase
      .from('lesson_groups')
      .insert({
        admin_id: teacherParasha.owner_admin_id,
        parasha_id: teacherParasha.parasha_id,
        teacher_parasha_id: teacherParashaId,
        section_id: sectionId,
      })
    if (error) throw new Error(error.message)
  }

  revalidatePath('/admin')
}

export async function upsertLessonPart(formData: FormData) {
  const session = await requireAdminSession()

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

  await getManageableLessonGroup(lessonGroupId, session)

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

export async function updateStudentPartVisibility(formData: FormData) {
  const session = await requireAdminSession()

  const studentId = readNumber(formData, 'student_id')
  const lessonPartId = readNumber(formData, 'lesson_part_id')
  const isVisibleToStudent = readString(formData, 'is_visible_to_student') === 'on'

  if (!studentId || !lessonPartId) {
    throw new Error('חסרים מזהי תלמיד או תת־חלק לעדכון חשיפה.')
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
    throw new Error('אין הרשאה לעדכן חשיפה עבור תלמיד זה.')
  }

  const { error } = await supabase
    .from('student_lesson_part_settings')
    .upsert(
      {
        student_id: studentId,
        lesson_part_id: lessonPartId,
        is_visible_to_student: isVisibleToStudent,
      },
      { onConflict: 'student_id,lesson_part_id' }
    )

  if (error) {
    if (error.message.includes('student_lesson_part_settings')) {
      throw new Error('טבלת חשיפת תתי־חלקים לתלמידים עדיין לא קיימת. צריך להריץ את עדכון ה-SQL החדש.')
    }

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
  const session = await requireAdminSession()

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

  if (lessonPartId) {
    await getManageableLessonPart(lessonPartId, session)
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
  const city = readString(formData, 'city')
  const email = readString(formData, 'email')
  const password = readString(formData, 'password')
  const role = readString(formData, 'role') === 'primary' ? 'primary' : 'teacher'

  if (!username || !displayName) {
    throw new Error('יש להזין שם משתמש ושם תצוגה.')
  }

  const payload: {
    username: string
    display_name: string
    city: string | null
    email: string | null
    role: 'primary' | 'teacher'
    password_hash?: string
  } = {
    username,
    display_name: displayName,
    city: city || null,
    email: email || null,
    role,
  }

  if (password) {
    payload.password_hash = hashAdminPassword(password)
  }

  if (id) {
    const { error } = await supabase.from('admins').update(payload).eq('id', id)
    if (error) {
      if (error.message.includes('city') || error.message.includes('email')) {
        throw new Error('שדות העיר והאימייל עדיין לא קיימים בבסיס הנתונים. צריך להריץ את עדכון ה-SQL החדש.')
      }

      throw new Error(error.message)
    }
  } else {
    if (!payload.password_hash) {
      throw new Error('ביצירת מנהל חדש חייבים להזין סיסמה.')
    }

    const { error } = await supabase.from('admins').insert(payload)
    if (error) {
      if (error.message.includes('city') || error.message.includes('email')) {
        throw new Error('שדות העיר והאימייל עדיין לא קיימים בבסיס הנתונים. צריך להריץ את עדכון ה-SQL החדש.')
      }

      throw new Error(error.message)
    }
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

  const teacherParashaId = readNumber(formData, 'teacher_parasha_id')
  let sourceTeacherParashaId = readNumber(formData, 'source_teacher_parasha_id')
  const copyScope = readString(formData, 'copy_scope') === 'single_part' ? 'single_part' : 'all'
  const sourceLessonPartId = readNumber(formData, 'source_lesson_part_id')
  const shareCode = readString(formData, 'share_code')

  if (!teacherParashaId || !shareCode) {
    throw new Error('יש לבחור פרשת מקור, פרשת יעד וקוד שיתוף.')
  }

  if (copyScope === 'single_part' && !sourceLessonPartId) {
    throw new Error('בייבוא תת־חלק בודד צריך לבחור תת־חלק מקור מוכן.')
  }

  if (copyScope === 'single_part' && sourceLessonPartId) {
    const { data: sourcePartOwner, error: sourcePartOwnerError } = await supabase
      .from('lesson_parts')
      .select(
        `
          id,
          lesson_groups (
            teacher_parasha_id
          )
        `
      )
      .eq('id', sourceLessonPartId)
      .maybeSingle()

    if (sourcePartOwnerError || !sourcePartOwner) {
      throw new Error(sourcePartOwnerError?.message ?? 'תת־החלק המקורי לא נמצא.')
    }

    const sourceGroup = Array.isArray(sourcePartOwner.lesson_groups)
      ? sourcePartOwner.lesson_groups[0]
      : sourcePartOwner.lesson_groups

    sourceTeacherParashaId = sourceGroup?.teacher_parasha_id ?? sourceTeacherParashaId
  }

  if (!sourceTeacherParashaId) {
    throw new Error('יש לבחור פרשת מקור לייבוא.')
  }

  try {
    const targetTeacherParasha = await getManageableTeacherParasha(teacherParashaId, session)

    const { data: sourceTeacherParasha, error: sourceTeacherParashaError } = await supabase
      .from('teacher_parashot')
      .select('id, owner_admin_id, parasha_id, nusach_id, source_teacher_parasha_id')
      .eq('id', sourceTeacherParashaId)
      .maybeSingle()

    if (sourceTeacherParashaError || !sourceTeacherParasha) {
      throw new Error(sourceTeacherParashaError?.message ?? 'פרשת המקור לא נמצאה.')
    }

    if (sourceTeacherParasha.nusach_id !== targetTeacherParasha.nusach_id) {
      throw new Error('אפשר להעתיק מבנה רק מפרשה עם אותו נוסח קריאה.')
    }

    if (sourceTeacherParasha.id === targetTeacherParasha.id) {
      throw new Error('אי אפשר להעתיק מבנה מאותה פרשה בדיוק.')
    }

    const { data: sourceAdmin, error: sourceAdminError } = await supabase
      .from('admins')
      .select('id, share_code_hash')
      .eq('id', sourceTeacherParasha.owner_admin_id)
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

    const { data: sourceGroups, error: sourceGroupsError } = await supabase
      .from('lesson_groups')
      .select('id, teacher_parasha_id, section_id')
      .eq('teacher_parasha_id', sourceTeacherParasha.id)
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

    const sourcePartRows =
      (sourceParts ?? []) as Array<{
        id: number
        lesson_group_id: number
        name: string
        part_order: number
        is_full_reading: boolean
        media_kind?: string | null
        is_visible_to_student?: boolean | null
        completion_target?: number | null
        audio_url: string | null
        video_url?: string | null
        duration_seconds: number | null
      }>
    const sourcePartIds = sourcePartRows.map((part) => part.id)
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

    const slideCountByPartId = new Map<number, number>()

    for (const slide of sourceSlides) {
      slideCountByPartId.set(
        slide.lesson_part_id,
        (slideCountByPartId.get(slide.lesson_part_id) ?? 0) + 1
      )
    }

    const importableSourceParts = sourcePartRows.filter((part) =>
      isLessonPartImportableForCopy(part, slideCountByPartId)
    )

    if (importableSourceParts.length === 0) {
      throw new Error('למנהל המקור אין תתי־חלקים מוכנים לייבוא בפרשה הזאת.')
    }

    const partsToCopy =
      copyScope === 'single_part'
        ? importableSourceParts.filter((part) => part.id === sourceLessonPartId)
        : importableSourceParts

    if (partsToCopy.length === 0) {
      throw new Error('תת־החלק שנבחר אינו מוכן לייבוא או שאינו שייך לפרשת המקור.')
    }

    const sourceGroupIdsToCopy = Array.from(
      new Set(partsToCopy.map((part) => part.lesson_group_id))
    )
    const groupsToCopy = groups.filter((group) => sourceGroupIdsToCopy.includes(group.id))
    const slidesToCopy = sourceSlides.filter((slide) =>
      partsToCopy.some((part) => part.id === slide.lesson_part_id)
    )

    const { data: existingGroups, error: existingGroupsError } = await supabase
      .from('lesson_groups')
      .select('id, section_id')
      .eq('teacher_parasha_id', targetTeacherParasha.id)

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

    for (const group of groupsToCopy) {
      let targetGroupId = targetGroupsBySectionId.get(group.section_id)

      if (!targetGroupId) {
        const { data, error } = await supabase
          .from('lesson_groups')
          .insert({
            admin_id: targetTeacherParasha.owner_admin_id,
            parasha_id: targetTeacherParasha.parasha_id,
            teacher_parasha_id: targetTeacherParasha.id,
            section_id: group.section_id,
          })
          .select('id')
          .single()

        if (error) {
          const { data: refetchedGroup, error: refetchError } = await supabase
            .from('lesson_groups')
            .select('id')
            .eq('teacher_parasha_id', targetTeacherParasha.id)
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
      if (copyScope === 'all') {
        const { error: deletePartsError } = await supabase
          .from('lesson_parts')
          .delete()
          .in('lesson_group_id', targetGroupIds)

        if (deletePartsError) {
          throw new Error(`שגיאה בניקוי התוכן הישן: ${deletePartsError.message}`)
        }
      } else {
        const { data: existingTargetParts, error: existingTargetPartsError } = await supabase
          .from('lesson_parts')
          .select('id, lesson_group_id, name, part_order')
          .in('lesson_group_id', targetGroupIds)

        if (existingTargetPartsError) {
          throw new Error(`שגיאה בטעינת תתי־החלקים הקיימים ביעד: ${existingTargetPartsError.message}`)
        }

        const partKeysToReplace = new Set(
          partsToCopy.map((part) => `${groupIdMap.get(part.lesson_group_id)}::${part.part_order}::${part.name}`)
        )
        const existingTargetPartIdsToDelete = ((existingTargetParts ?? []) as Array<{
          id: number
          lesson_group_id: number
          name: string
          part_order: number
        }>)
          .filter((part) =>
            partKeysToReplace.has(`${part.lesson_group_id}::${part.part_order}::${part.name}`)
          )
          .map((part) => part.id)

        if (existingTargetPartIdsToDelete.length > 0) {
          const { error: deleteExistingTargetPartsError } = await supabase
            .from('lesson_parts')
            .delete()
            .in('id', existingTargetPartIdsToDelete)

          if (deleteExistingTargetPartsError) {
            throw new Error(
              `שגיאה בניקוי תת־החלק הקיים ביעד: ${deleteExistingTargetPartsError.message}`
            )
          }
        }
      }
    }

    const partIdMap = new Map<number, number>()

    for (const part of partsToCopy) {
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

    const importScope =
      copyScope === 'single_part' ? 'selected_parts' : 'full_parasha'

    const { data: importBatch, error: importBatchError } = await supabase
      .from('teacher_parasha_import_batches')
      .insert({
        target_teacher_parasha_id: targetTeacherParasha.id,
        source_teacher_parasha_id: sourceTeacherParasha.id,
        imported_by_admin_id: session.id,
        scope: importScope,
        note:
          copyScope === 'single_part'
            ? `ייבוא תת־חלק בודד: ${partsToCopy[0]?.name ?? ''}`
            : 'ייבוא מבנה מלא',
      })
      .select('id')
      .single()

    if (importBatchError || !importBatch) {
      throw new Error(
        `שגיאה ברישום מקור הייבוא: ${importBatchError?.message ?? 'לא ידוע.'}`
      )
    }

    const targetRootSourceId = sourceTeacherParasha.source_teacher_parasha_id ?? sourceTeacherParasha.id
    const { error: updateTargetTeacherParashaError } = await supabase
      .from('teacher_parashot')
      .update({
        source_teacher_parasha_id: targetRootSourceId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', targetTeacherParasha.id)

    if (updateTargetTeacherParashaError) {
      throw new Error(
        `שגיאה בעדכון מקור הייבוא של ספריית היעד: ${updateTargetTeacherParashaError.message}`
      )
    }

    const importItemsPayload = Array.from(partIdMap.entries()).map(
      ([sourcePartId, targetPartId]) => ({
        import_batch_id: importBatch.id,
        source_lesson_part_id: sourcePartId,
        target_lesson_part_id: targetPartId,
      })
    )

    if (importItemsPayload.length > 0) {
      const { error: importItemsError } = await supabase
        .from('teacher_parasha_import_items')
        .insert(importItemsPayload)

      if (importItemsError) {
        throw new Error(`שגיאה ברישום פריטי הייבוא: ${importItemsError.message}`)
      }
    }

    if (slidesToCopy.length > 0) {
      const slidesPayload = slidesToCopy
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
      teacherParashaId,
      sourceTeacherParashaId,
      error,
    })

    throw error instanceof Error
      ? error
      : new Error('אירעה שגיאה לא צפויה בהעתקת המבנה.')
  }
}

export async function deleteStudent(formData: FormData) {
  const session = await requireAdminSession()
  const id = readNumber(formData, 'id')
  if (!id) throw new Error('חסר מזהה תלמיד.')

  if (session.role !== 'primary') {
    const { data: student, error: studentError } = await supabase
      .from('students')
      .select('admin_id')
      .eq('id', id)
      .maybeSingle()

    if (studentError || !student) {
      throw new Error(studentError?.message ?? 'התלמיד לא נמצא.')
    }

    if (student.admin_id !== session.id) {
      throw new Error('אין הרשאה למחוק תלמיד של מלמד אחר.')
    }
  }

  const { error } = await supabase.from('students').delete().eq('id', id)
  if (error) throw new Error(error.message)

  revalidatePath('/admin')
  revalidatePath('/student')
}

export async function deleteParasha(formData: FormData) {
  const session = await requireAdminSession()
  if (session.role !== 'primary') throw new Error('רק מנהל ראשי יכול למחוק פרשה כללית.')
  const id = readNumber(formData, 'id')
  if (!id) throw new Error('חסר מזהה פרשה.')

  const { error } = await supabase.from('parashot').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/admin')
}

export async function deleteSection(formData: FormData) {
  const session = await requireAdminSession()
  if (session.role !== 'primary') throw new Error('רק מנהל ראשי יכול למחוק חלק כללי.')
  const id = readNumber(formData, 'id')
  if (!id) throw new Error('חסר מזהה חלק.')

  const { error } = await supabase.from('sections').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/admin')
}

export async function deleteLessonPart(formData: FormData) {
  const session = await requireAdminSession()
  const id = readNumber(formData, 'id')
  if (!id) throw new Error('חסר מזהה תת-חלק.')

  await getManageableLessonPart(id, session)

  const { error } = await supabase.from('lesson_parts').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/admin')
  revalidatePath('/student')
}

export async function deleteLessonSlide(formData: FormData) {
  const session = await requireAdminSession()
  const id = readNumber(formData, 'id')
  if (!id) throw new Error('חסר מזהה שקופית.')

  const { data: slide, error: slideError } = await supabase
    .from('lesson_slides')
    .select('lesson_part_id')
    .eq('id', id)
    .maybeSingle()

  if (slideError || !slide) {
    throw new Error(slideError?.message ?? 'השקופית לא נמצאה.')
  }

  await getManageableLessonPart(slide.lesson_part_id, session)

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

  const { error } = await supabase
    .from('admins')
    .update({
      status: 'inactive',
      deactivated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/admin')
}

export async function upsertTeacherParasha(formData: FormData) {
  const session = await requireAdminSession()

  const id = readNumber(formData, 'id')
  const baseParashaId = readNumber(formData, 'base_parasha_id')
  const nusachId = readNumber(formData, 'nusach_id')
  const status =
    readString(formData, 'status') === 'draft'
      ? 'draft'
      : readString(formData, 'status') === 'frozen'
        ? 'frozen'
        : readString(formData, 'status') === 'archived'
          ? 'archived'
          : 'active'
  const freezeReason = readString(formData, 'freeze_reason')
  const notes = readString(formData, 'notes')
  const ownerAdminId =
    session.role === 'primary'
      ? (readNumber(formData, 'owner_admin_id') ?? session.id)
      : session.id

  if (!baseParashaId || !nusachId || !ownerAdminId) {
    throw new Error('יש לבחור פרשה בסיסית, נוסח ומלמד בעלים.')
  }

  const validAdminId = await resolveValidAdminId(ownerAdminId)

  if (!validAdminId) {
    throw new Error('לא נמצא מלמד בעלים תקין.')
  }

  if (id) {
    await getManageableTeacherParasha(id, session)
    const { error } = await supabase
      .from('teacher_parashot')
      .update({
        owner_admin_id: validAdminId,
        parasha_id: baseParashaId,
        nusach_id: nusachId,
        status,
        freeze_reason: freezeReason || null,
        notes: notes || null,
        updated_at: new Date().toISOString(),
        frozen_at: status === 'frozen' ? new Date().toISOString() : null,
        archived_at: status === 'archived' ? new Date().toISOString() : null,
      })
      .eq('id', id)

    if (error) throw new Error(error.message)
  } else {
    const { data: maxVariantRow, error: maxVariantError } = await supabase
      .from('teacher_parashot')
      .select('variant_number')
      .eq('owner_admin_id', validAdminId)
      .eq('parasha_id', baseParashaId)
      .eq('nusach_id', nusachId)
      .order('variant_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (maxVariantError) {
      throw new Error(maxVariantError.message)
    }

    const variantNumber = (maxVariantRow?.variant_number ?? 0) + 1
    const { error } = await supabase.from('teacher_parashot').insert({
      owner_admin_id: validAdminId,
      parasha_id: baseParashaId,
      nusach_id: nusachId,
      variant_number: variantNumber,
      status,
      freeze_reason: freezeReason || null,
      notes: notes || null,
      created_by_admin_id: session.id,
    })

    if (error) throw new Error(error.message)
  }

  revalidatePath('/admin')
}

export async function setTeacherParashaStatus(formData: FormData) {
  const session = await requireAdminSession()
  const id = readNumber(formData, 'id')
  const status = readString(formData, 'status')
  const freezeReason = readString(formData, 'freeze_reason')

  if (!id) {
    throw new Error('חסר מזהה פרשת מלמד.')
  }

  if (!['active', 'frozen', 'archived', 'draft'].includes(status)) {
    throw new Error('סטטוס לא תקין.')
  }

  await getManageableTeacherParasha(id, session)

  const { error } = await supabase
    .from('teacher_parashot')
    .update({
      status,
      freeze_reason: status === 'frozen' ? freezeReason || null : null,
      updated_at: new Date().toISOString(),
      frozen_at: status === 'frozen' ? new Date().toISOString() : null,
      archived_at: status === 'archived' ? new Date().toISOString() : null,
    })
    .eq('id', id)

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/admin')
  revalidatePath('/student')
}

export async function deleteTeacherParasha(formData: FormData) {
  const session = await requireAdminSession()
  const id = readNumber(formData, 'id')

  if (!id) {
    throw new Error('חסר מזהה ספריית פרשה.')
  }

  await getManageableTeacherParasha(id, session)

  const { error } = await supabase.from('teacher_parashot').delete().eq('id', id)

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/admin')
  revalidatePath('/student')
}
