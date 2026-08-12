import 'server-only'

import { getLessonMediaKind, type LessonMediaKind } from '@/lib/lesson-media'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { sanitizePhoneNumber } from '@/lib/whatsapp'

export type StudentWhatsAppCatalogStudent = {
  id: number
  admin_id: number | null
  name: string
  whatsapp_phone: string | null
  torah_reading_date: string | null
}

export type StudentWhatsAppCatalogPart = {
  lessonPartId: number
  lessonGroupId: number
  sectionName: string
  sectionOrderIndex: number
  partName: string
  partOrder: number
  completionTarget: number
  completedCount: number
  mediaKind: LessonMediaKind
  mediaUrl: string | null
  audioUrl: string | null
  videoUrl: string | null
  slideCount: number
}

export type StudentWhatsAppCatalog = {
  student: StudentWhatsAppCatalogStudent
  activeTeacherParashaId: number
  parts: StudentWhatsAppCatalogPart[]
  recommendedPart: StudentWhatsAppCatalogPart | null
}

function getBotPromptLine() {
  return 'השב עם מספר הקטע שתרצה לפתוח, או כתוב "תפריט" כדי לקבל שוב את הרשימה.'
}

function isReadyForWhatsApp(input: {
  mediaKind: LessonMediaKind
  audioUrl: string | null
  videoUrl: string | null
  slideCount: number
}) {
  if (input.mediaKind === 'video') {
    return Boolean(input.videoUrl)
  }

  return Boolean(input.audioUrl) && input.slideCount > 0
}

export async function findStudentByWhatsAppPhone(rawPhone: string) {
  const normalizedPhone = sanitizePhoneNumber(rawPhone)

  if (!normalizedPhone) {
    return null
  }

  const supabaseAdmin = getSupabaseAdmin()
  const { data, error } = await supabaseAdmin
    .from('students')
    .select('id, admin_id, name, whatsapp_phone, torah_reading_date')
    .not('whatsapp_phone', 'is', null)

  if (error) {
    throw new Error(error.message)
  }

  const students = (data ?? []) as StudentWhatsAppCatalogStudent[]

  return (
    students.find((student) =>
      sanitizePhoneNumber(student.whatsapp_phone ?? '') === normalizedPhone
    ) ?? null
  )
}

export async function getStudentWhatsAppCatalog(studentId: number) {
  const supabaseAdmin = getSupabaseAdmin()
  const { data: studentRow, error: studentError } = await supabaseAdmin
    .from('students')
    .select('id, admin_id, name, whatsapp_phone, torah_reading_date')
    .eq('id', studentId)
    .maybeSingle()

  if (studentError || !studentRow) {
    throw new Error(studentError?.message ?? 'התלמיד לא נמצא.')
  }

  const student = studentRow as StudentWhatsAppCatalogStudent

  const { data: activeAssignmentRow, error: assignmentError } = await supabaseAdmin
    .from('student_teacher_parasha_assignments')
    .select('teacher_parasha_id')
    .eq('student_id', studentId)
    .eq('status', 'active')
    .maybeSingle()

  if (assignmentError) {
    throw new Error(assignmentError.message)
  }

  const activeAssignment = activeAssignmentRow as {
    teacher_parasha_id: number
  } | null

  if (!activeAssignment?.teacher_parasha_id) {
    throw new Error('אין לתלמיד ספריית פרשה פעילה לשליחה.')
  }

  const { data: groups, error: groupsError } = await supabaseAdmin
    .from('lesson_groups')
    .select('id, section_id, sections(name, order_index)')
    .eq('teacher_parasha_id', activeAssignment.teacher_parasha_id)

  if (groupsError) {
    throw new Error(groupsError.message)
  }

  const lessonGroups = (groups ?? []) as Array<{
    id: number
    section_id: number
    sections:
      | { name: string; order_index: number }
      | Array<{ name: string; order_index: number }>
      | null
  }>

  if (lessonGroups.length === 0) {
    throw new Error('אין עדיין קבוצות שיעור מוכנות לתלמיד זה.')
  }

  const groupIds = lessonGroups.map((group) => group.id)
  const { data: parts, error: partsError } = await supabaseAdmin
    .from('lesson_parts')
    .select(
      'id, lesson_group_id, name, part_order, is_visible_to_student, completion_target, audio_url, video_url, media_kind'
    )
    .in('lesson_group_id', groupIds)

  if (partsError) {
    throw new Error(partsError.message)
  }

  const lessonParts = (parts ?? []) as Array<{
    id: number
    lesson_group_id: number
    name: string
    part_order: number
    is_visible_to_student: boolean | null
    completion_target: number | null
    audio_url: string | null
    video_url: string | null
    media_kind?: string | null
  }>

  if (lessonParts.length === 0) {
    throw new Error('אין עדיין תתי־חלקים מוכנים לתלמיד זה.')
  }

  const partIds = lessonParts.map((part) => part.id)
  const [
    { data: slideRows, error: slidesError },
    { data: settingRows, error: settingsError },
    { data: practiceRows, error: practiceError },
  ] = await Promise.all([
    supabaseAdmin
      .from('lesson_slides')
      .select('lesson_part_id')
      .in('lesson_part_id', partIds),
    supabaseAdmin
      .from('student_lesson_part_settings')
      .select('lesson_part_id, is_visible_to_student')
      .eq('student_id', studentId)
      .in('lesson_part_id', partIds),
    supabaseAdmin
      .from('practice_events')
      .select('lesson_part_id, completed')
      .eq('student_id', studentId)
      .in('lesson_part_id', partIds),
  ])

  if (slidesError || settingsError || practiceError) {
    throw new Error(
      slidesError?.message ??
        settingsError?.message ??
        practiceError?.message ??
        'שגיאה בטעינת נתוני WhatsApp.'
    )
  }

  const slideCountByPartId = new Map<number, number>()
  for (const row of (slideRows ?? []) as Array<{ lesson_part_id: number }>) {
    slideCountByPartId.set(
      row.lesson_part_id,
      (slideCountByPartId.get(row.lesson_part_id) ?? 0) + 1
    )
  }

  const visibilityByPartId = new Map<number, boolean>(
    ((settingRows ?? []) as Array<{
      lesson_part_id: number
      is_visible_to_student: boolean
    }>).map((row) => [row.lesson_part_id, row.is_visible_to_student])
  )

  const completedCountByPartId = new Map<number, number>()
  for (const row of (practiceRows ?? []) as Array<{
    lesson_part_id: number
    completed: boolean
  }>) {
    if (!row.completed) {
      continue
    }

    completedCountByPartId.set(
      row.lesson_part_id,
      (completedCountByPartId.get(row.lesson_part_id) ?? 0) + 1
    )
  }

  const groupMetaById = new Map(
    lessonGroups.map((group) => {
      const section = Array.isArray(group.sections) ? group.sections[0] : group.sections

      return [
        group.id,
        {
          sectionName: section?.name ?? 'ללא חלק',
          orderIndex: section?.order_index ?? 0,
        },
      ]
    })
  )

  const readyParts = lessonParts
    .filter((part) => {
      const visible =
        (part.is_visible_to_student ?? true) &&
        (visibilityByPartId.get(part.id) ?? true)

      if (!visible) {
        return false
      }

      const mediaKind = getLessonMediaKind(part)
      return isReadyForWhatsApp({
        mediaKind,
        audioUrl: part.audio_url,
        videoUrl: part.video_url,
        slideCount: slideCountByPartId.get(part.id) ?? 0,
      })
    })
    .map((part) => {
      const groupMeta = groupMetaById.get(part.lesson_group_id)
      const mediaKind = getLessonMediaKind(part)

      return {
        lessonPartId: part.id,
        lessonGroupId: part.lesson_group_id,
        sectionName: groupMeta?.sectionName ?? 'ללא חלק',
        sectionOrderIndex: groupMeta?.orderIndex ?? 0,
        partName: part.name,
        partOrder: part.part_order,
        completionTarget: Math.max(part.completion_target ?? 3, 1),
        completedCount: completedCountByPartId.get(part.id) ?? 0,
        mediaKind,
        mediaUrl: mediaKind === 'video' ? part.video_url : part.audio_url,
        audioUrl: part.audio_url,
        videoUrl: part.video_url,
        slideCount: slideCountByPartId.get(part.id) ?? 0,
      } satisfies StudentWhatsAppCatalogPart
    })
    .sort((left, right) => {
      if (left.sectionOrderIndex !== right.sectionOrderIndex) {
        return left.sectionOrderIndex - right.sectionOrderIndex
      }

      if (left.partOrder !== right.partOrder) {
        return left.partOrder - right.partOrder
      }

      return left.lessonPartId - right.lessonPartId
    })

  const recommendedPart =
    readyParts.find((part) => part.completedCount < part.completionTarget) ??
    readyParts[0] ??
    null

  return {
    student,
    activeTeacherParashaId: activeAssignment.teacher_parasha_id,
    parts: readyParts,
    recommendedPart,
  } satisfies StudentWhatsAppCatalog
}

export function buildWhatsAppBotMenuText(input: {
  studentName: string
  parts: StudentWhatsAppCatalogPart[]
}) {
  const lines = [
    `שלום ${input.studentName}`,
    'זה תפריט החלקים שפתוחים עבורך כרגע:',
    ...input.parts.map(
      (part, index) => `${index + 1}. ${part.sectionName} - ${part.partName}`
    ),
    '',
    getBotPromptLine(),
  ]

  return lines.join('\n').trim()
}

export function buildWhatsAppBotSelectionText(input: {
  studentName: string
  part: StudentWhatsAppCatalogPart
  lessonLink: string
}) {
  return [
    `שלום ${input.studentName}`,
    `בחרת: ${input.part.sectionName} - ${input.part.partName}`,
    '',
    'קישור ישיר לקטע באתר:',
    input.lessonLink,
  ]
    .join('\n')
    .trim()
}

export function buildWhatsAppBotInvalidSelectionText(input: {
  studentName: string
  parts: StudentWhatsAppCatalogPart[]
}) {
  return [
    `שלום ${input.studentName}`,
    'לא זיהיתי בחירה תקינה.',
    '',
    buildWhatsAppBotMenuText(input),
  ]
    .join('\n')
    .trim()
}

export function buildWhatsAppBotEmptyCatalogText(studentName: string) {
  return [
    `שלום ${studentName}`,
    'כרגע אין חלקים פתוחים עבורך ב-WhatsApp.',
    'אפשר לפנות למלמד כדי לפתוח קטעים נוספים.',
  ].join('\n')
}

export function parseWhatsAppBotSelection(text: string) {
  const normalized = text.trim()

  if (!normalized) {
    return null
  }

  if (normalized === 'תפריט' || normalized.toLowerCase() === 'menu') {
    return 'menu'
  }

  if (!/^\d+$/.test(normalized)) {
    return null
  }

  const index = Number(normalized)
  return Number.isFinite(index) && index > 0 ? index : null
}
