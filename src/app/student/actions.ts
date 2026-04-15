'use server'

import { revalidatePath } from 'next/cache'
import { createPracticeEvent } from '@/lib/practice-data'
import { isLessonPartReady } from '@/lib/lesson-media'
import { deleteStorageObject, uploadStorageFile } from '@/lib/storage-files'
import { requireStudentSession } from '@/lib/student-auth'
import { supabase } from '@/lib/supabase'

export async function recordPracticeEvent(input: {
  lessonPartId: number
  completed: boolean
}) {
  const session = await requireStudentSession()
  const { event, error } = await createPracticeEvent({
    studentId: session.id,
    lessonPartId: input.lessonPartId,
    completed: input.completed,
  })

  if (error) {
    throw new Error(error.message)
  }

  return event
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
          parasha_id
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

  if (
    !lessonGroup ||
    lessonGroup.admin_id !== session.adminId ||
    lessonGroup.parasha_id !== session.parashaId
  ) {
    throw new Error('תת־החלק לא שייך למסלול של התלמיד.')
  }

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

  if (!isLessonPartReady(lessonPart, slideCountByPartId, lessonPartId)) {
    throw new Error('אפשר להקליט רק לקטע שזמין כרגע לתלמיד.')
  }

  return {
    session,
    lessonPart: lessonPart as {
      id: number
      name: string
      duration_seconds: number | null
      media_kind?: string | null
      audio_url: string | null
      video_url?: string | null
    },
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

  const { lessonPart } = await getStudentLessonPartForRecording(
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
