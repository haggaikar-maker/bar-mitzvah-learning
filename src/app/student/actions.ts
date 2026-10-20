'use server'

import { revalidatePath } from 'next/cache'
import { createPracticeEvent } from '@/lib/practice-data'
import {
  getAvailableLessonVideoVariants,
  getLessonMediaKind,
  isLessonPartReady,
} from '@/lib/lesson-media'
import { deleteStorageObject, uploadStorageFile } from '@/lib/storage-files'
import { createStudentDirectAccessLink } from '@/lib/student-direct-links'
import { requireStudentSession } from '@/lib/student-auth'
import { supabase } from '@/lib/supabase'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { refreshStudentWhatsAppCatalog } from '@/lib/whatsapp-bot'
import { sanitizePhoneNumber, sendWhatsAppTextMessage } from '@/lib/whatsapp'

export async function recordPracticeEvent(input: {
  lessonPartId: number
  completed: boolean
}) {
  const session = await requireStudentSession()
  await getStudentLessonPartForRecording(session.id, input.lessonPartId)
  const { event, error } = await createPracticeEvent({
    studentId: session.id,
    lessonPartId: input.lessonPartId,
    completed: input.completed,
  })

  if (error) {
    throw new Error(error.message)
  }

  await refreshStudentWhatsAppCatalog(session.id)

  return event
}

type ListeningInterval = { start: number; end: number }

function mergeListeningIntervals(intervals: ListeningInterval[], durationSeconds: number) {
  const sorted = intervals
    .map(({ start, end }) => ({
      start: Math.max(0, Math.min(durationSeconds, start)),
      end: Math.max(0, Math.min(durationSeconds, end)),
    }))
    .filter(({ start, end }) => end > start)
    .sort((left, right) => left.start - right.start)
  const merged: ListeningInterval[] = []
  for (const interval of sorted) {
    const previous = merged.at(-1)
    if (previous && interval.start <= previous.end + 0.15) {
      previous.end = Math.max(previous.end, interval.end)
    } else {
      merged.push({ ...interval })
    }
  }
  return merged
}

export async function recordListeningProgress(input: {
  sessionId: string
  lessonPartId: number
  durationSeconds: number
  listenedSeconds: number
  intervals: ListeningInterval[]
}) {
  const session = await requireStudentSession()
  await getStudentLessonPartForRecording(session.id, input.lessonPartId)
  const durationSeconds = Math.round(input.durationSeconds)
  if (!/^[0-9a-f-]{36}$/i.test(input.sessionId) || durationSeconds < 1 || durationSeconds > 7200) {
    throw new Error('נתוני סשן ההאזנה אינם תקינים.')
  }

  const supabaseAdmin = getSupabaseAdmin()
  // This table is created by the synchronized-listening SQL migration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listeningDb = supabaseAdmin as any
  const { data: previous, error: previousError } = await listeningDb
    .from('student_listening_sessions')
    .select('listened_seconds, covered_intervals, completed')
    .eq('id', input.sessionId)
    .eq('student_id', session.id)
    .maybeSingle()
  if (previousError) throw new Error(previousError.message)

  const intervals = mergeListeningIntervals(
    [...((previous?.covered_intervals ?? []) as ListeningInterval[]), ...input.intervals],
    durationSeconds
  )
  const coveredSeconds = intervals.reduce((sum, interval) => sum + interval.end - interval.start, 0)
  const coveragePercent = Math.min(100, (coveredSeconds / durationSeconds) * 100)
  const completed = Boolean(previous?.completed) || coveragePercent >= 80
  const listenedSeconds = Math.max(
    Number(previous?.listened_seconds ?? 0),
    Math.min(Math.round(input.listenedSeconds), 24 * 60 * 60)
  )
  const { error } = await listeningDb
    .from('student_listening_sessions')
    .upsert({
      id: input.sessionId,
      student_id: session.id,
      lesson_part_id: input.lessonPartId,
      duration_seconds: durationSeconds,
      listened_seconds: listenedSeconds,
      covered_intervals: intervals,
      coverage_percent: coveragePercent,
      completed,
      updated_at: new Date().toISOString(),
      ...(completed && !previous?.completed ? { completed_at: new Date().toISOString() } : {}),
    }, { onConflict: 'id' })
  if (error) throw new Error(error.message)

  if (completed && !previous?.completed) {
    // The unique session id makes completion counting idempotent across pause/end retries.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: eventError } = await (supabaseAdmin as any)
      .from('practice_events')
      .upsert({
        student_id: session.id,
        lesson_part_id: input.lessonPartId,
        completed: true,
        listening_session_id: input.sessionId,
      }, { onConflict: 'listening_session_id', ignoreDuplicates: true })
    if (eventError) throw new Error(eventError.message)
    await refreshStudentWhatsAppCatalog(session.id)
  }

  const { data: progressRows, error: progressError } = await listeningDb
    .from('student_listening_sessions')
    .select('listened_seconds, completed')
    .eq('student_id', session.id)
    .eq('lesson_part_id', input.lessonPartId)
  if (progressError) throw new Error(progressError.message)
  const rows = (progressRows ?? []) as Array<{ listened_seconds: number; completed: boolean }>
  return {
    listenedSeconds: rows.reduce((sum, row) => sum + (row.listened_seconds ?? 0), 0),
    completedSessions: rows.filter((row) => row.completed).length,
    coveragePercent,
    completed,
  }
}

async function getStudentLessonPartForRecording(studentId: number, lessonPartId: number) {
  const session = await requireStudentSession()

  if (session.id !== studentId) {
    throw new Error('אין הרשאה להעלות הקלטה עבור תלמיד אחר.')
  }

  const { data: lessonPart, error: lessonPartError } = await supabase
    .from('lesson_parts')
    .select(
      `
        *,
        lesson_groups (
          id,
          admin_id,
          parasha_id,
          teacher_parasha_id
        )
      `
    )
    .eq('id', lessonPartId)
    .maybeSingle()

  if (lessonPartError || !lessonPart) {
    throw new Error(lessonPartError?.message ?? 'תת־החלק לא נמצא.')
  }

  const lessonGroup = Array.isArray(lessonPart.lesson_groups)
    ? lessonPart.lesson_groups[0]
    : lessonPart.lesson_groups

  const { data: activeAssignment, error: assignmentError } = await supabase
    .from('student_teacher_parasha_assignments')
    .select(
      `
        teacher_parasha_id,
        teacher_parashot (
          id,
          owner_admin_id,
          parasha_id,
          status
        )
      `
    )
    .eq('student_id', session.id)
    .eq('status', 'active')
    .maybeSingle()

  if (assignmentError) {
    throw new Error(assignmentError.message)
  }

  const teacherParasha = Array.isArray(activeAssignment?.teacher_parashot)
    ? activeAssignment.teacher_parashot[0]
    : activeAssignment?.teacher_parashot

  const belongsToStudent = teacherParasha
    ? lessonGroup?.teacher_parasha_id === teacherParasha.id
    : lessonGroup &&
      lessonGroup.admin_id === session.adminId &&
      lessonGroup.parasha_id === session.parashaId

  if (!lessonGroup || !belongsToStudent) {
    throw new Error('תת־החלק לא שייך למסלול של התלמיד.')
  }

  if (teacherParasha?.status === 'frozen') {
    throw new Error('הפרשה של התלמיד קפואה כרגע, ולכן אי אפשר להקליט לקטעים שלה.')
  }

  const mediaKind = getLessonMediaKind(lessonPart)
  let nativeMediaAvailable = false

  if (mediaKind === 'video') {
    nativeMediaAvailable =
      getAvailableLessonVideoVariants(lessonPart).length > 0 &&
      isLessonPartReady(lessonPart, undefined, lessonPartId)
  } else {
    const { data: slideRows, error: slidesError } = await supabase
      .from('lesson_slides')
      .select('lesson_part_id')
      .eq('lesson_part_id', lessonPartId)

    if (slidesError) {
      throw new Error(slidesError.message)
    }

    const slideCountByPartId = new Map<number, number>([
      [lessonPartId, (slideRows ?? []).length],
    ])

    nativeMediaAvailable = isLessonPartReady(lessonPart, slideCountByPartId, lessonPartId)
  }

  if (!nativeMediaAvailable) {
    // Synchronized text readings are valid practice targets even without video or slides.
    // RLS intentionally blocks anon access to synchronized readings; this query
    // runs only after the student's session and lesson ownership were verified.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: synchronizedReading, error: synchronizedReadingError } = await (getSupabaseAdmin() as any)
      .from('student_lesson_part_readings')
      .select('id')
      .eq('student_id', session.id)
      .eq('lesson_part_id', lessonPartId)
      .maybeSingle()

    if (synchronizedReadingError) {
      throw new Error(synchronizedReadingError.message)
    }
    if (!synchronizedReading) {
      throw new Error('אפשר להקליט רק לקטע שזמין כרגע לתלמיד.')
    }
  }

  return {
    session,
    assignedAdminId: teacherParasha?.owner_admin_id ?? lessonGroup.admin_id ?? session.adminId,
    lessonPart: lessonPart as {
      id: number
      name: string
      duration_seconds: number | null
      media_kind?: string | null
      audio_url: string | null
      video_url?: string | null
      video_url_nikud?: string | null
      video_url_tikkun?: string | null
    },
  }
}

async function notifyAdminsAboutStudentRecording(input: {
  studentId: number
  studentName: string
  lessonPartId: number
  lessonPartName: string
  assignedAdminId: number | null
}) {
  try {
    // Admin contact details are read with the service-role client because students
    // must not be able to enumerate administrator phone numbers.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getSupabaseAdmin() as any
    const { data: admins, error } = await db
      .from('admins')
      .select('id, display_name, role, whatsapp_phone, status')
    if (error) throw new Error(error.message)

    const activeAdmins = (admins ?? []).filter((admin: { status: string | null }) => admin.status !== 'inactive') as Array<{
      id: number
      display_name: string
      role: string
      whatsapp_phone: string | null
      status: string | null
    }>
    const recipientsByPhone = new Map<string, { name: string }>()
    for (const admin of activeAdmins) {
      const shouldNotify = admin.role === 'primary' || admin.id === input.assignedAdminId
      const phone = sanitizePhoneNumber(admin.whatsapp_phone ?? '')
      if (shouldNotify && phone) recipientsByPhone.set(phone, { name: admin.display_name })
    }

    if (recipientsByPhone.size === 0) {
      console.warn('Student recording saved but no manager WhatsApp recipients are configured', {
        studentId: input.studentId,
        lessonPartId: input.lessonPartId,
      })
      return
    }

    const lessonLink = await createStudentDirectAccessLink({
      studentId: input.studentId,
      lessonPartId: input.lessonPartId,
      adminId: input.assignedAdminId,
    })
    const message = [
      `התלמיד ${input.studentName} שמר הקלטה חדשה.`,
      `תת־חלק: ${input.lessonPartName}`,
      `קישור ישיר לקטע: ${lessonLink}`,
    ].join('\n')
    const results = await Promise.allSettled(
      [...recipientsByPhone.entries()].map(([to]) => sendWhatsAppTextMessage({ to, body: message }))
    )
    const failures = results.flatMap((result, index) => result.status === 'rejected'
      ? [{ recipient: [...recipientsByPhone.values()][index]?.name, reason: result.reason }]
      : [])
    if (failures.length) {
      console.error('Student recording saved but manager notification failed', {
        studentId: input.studentId,
        lessonPartId: input.lessonPartId,
        failures,
      })
    }
  } catch (error) {
    console.error('Student recording saved but manager notifications could not be sent', {
      studentId: input.studentId,
      lessonPartId: input.lessonPartId,
      error,
    })
  }
}

export async function saveStudentRecording(formData: FormData) {
  const session = await requireStudentSession()
  const lessonPartIdRaw = formData.get('lessonPartId')
  const durationSecondsRaw = formData.get('durationSeconds')
  const lessonPartId =
    typeof lessonPartIdRaw === 'string' ? Number(lessonPartIdRaw) : null
  const durationSeconds =
    typeof durationSecondsRaw === 'string' ? Number(durationSecondsRaw) : null
  const file = formData.get('recording')

  if (!lessonPartId || !(file instanceof File) || file.size === 0) {
    throw new Error('חסרים קובץ הקלטה או מזהה תת־חלק.')
  }

  const { lessonPart, assignedAdminId } = await getStudentLessonPartForRecording(
    session.id,
    lessonPartId
  )

  const partDuration = lessonPart.duration_seconds
  const maxAllowedDuration = partDuration && partDuration > 0 ? partDuration * 2 : null

  if (
    maxAllowedDuration !== null &&
    durationSeconds !== null &&
    Number.isFinite(durationSeconds) &&
    durationSeconds > maxAllowedDuration + 1
  ) {
    throw new Error('משך ההקלטה חורג מהמקסימום המותר לקטע הזה.')
  }

  const { data: existingRecording, error: existingRecordingError } = await supabase
    .from('student_recordings')
    .select('id, storage_path')
    .eq('student_id', session.id)
    .eq('lesson_part_id', lessonPartId)
    .maybeSingle()

  if (existingRecordingError) {
    throw new Error(existingRecordingError.message)
  }

  const uploaded = await uploadStorageFile(file, {
    kind: 'student-recordings',
    segments: [session.username, `part-${lessonPartId}`],
    filenameBase: `${lessonPart.name}-recording`,
    visibility: 'private',
  })

  if (!uploaded?.objectPath) {
    throw new Error('לא הצלחנו לשמור את ההקלטה.')
  }

  if (existingRecording?.storage_path) {
    await deleteStorageObject('student-recordings', existingRecording.storage_path)
  }

  const payload = {
    student_id: session.id,
    lesson_part_id: lessonPartId,
    storage_path: uploaded.objectPath,
    duration_seconds:
      durationSeconds !== null && Number.isFinite(durationSeconds)
        ? Math.round(durationSeconds)
        : null,
  }

  const { error } = await supabase
    .from('student_recordings')
    .upsert(payload, { onConflict: 'student_id,lesson_part_id' })

  if (error) {
    throw new Error(error.message)
  }

  await notifyAdminsAboutStudentRecording({
    studentId: session.id,
    studentName: session.name,
    lessonPartId,
    lessonPartName: lessonPart.name,
    assignedAdminId,
  })

  revalidatePath('/student')
  revalidatePath('/admin')

  return {
    durationSeconds: payload.duration_seconds,
    createdAt: new Date().toISOString(),
  }
}

export async function deleteMyStudentRecording(formData: FormData) {
  const session = await requireStudentSession()
  const lessonPartIdRaw = formData.get('lessonPartId')
  const lessonPartId =
    typeof lessonPartIdRaw === 'string' ? Number(lessonPartIdRaw) : null

  if (!lessonPartId) {
    throw new Error('חסר מזהה תת־חלק למחיקה.')
  }

  await getStudentLessonPartForRecording(session.id, lessonPartId)

  const { data: existingRecording, error: existingRecordingError } = await supabase
    .from('student_recordings')
    .select('id, storage_path')
    .eq('student_id', session.id)
    .eq('lesson_part_id', lessonPartId)
    .maybeSingle()

  if (existingRecordingError) {
    throw new Error(existingRecordingError.message)
  }

  if (existingRecording?.storage_path) {
    await deleteStorageObject('student-recordings', existingRecording.storage_path)
  }

  const { error } = await supabase
    .from('student_recordings')
    .delete()
    .eq('student_id', session.id)
    .eq('lesson_part_id', lessonPartId)

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/student')
  revalidatePath('/admin')
}
