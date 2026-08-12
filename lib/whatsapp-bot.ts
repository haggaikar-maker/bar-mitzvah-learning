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

type StudentWhatsAppCatalogStateRow = {
  student_id: number
  admin_id: number | null
  student_name: string
  whatsapp_phone: string | null
  whatsapp_phone_normalized: string | null
  torah_reading_date: string | null
  active_teacher_parasha_id: number | null
  available_part_count: number
  recommended_lesson_part_id: number | null
}

type StudentWhatsAppCatalogItemRow = {
  student_id: number
  active_teacher_parasha_id: number
  lesson_part_id: number
  lesson_group_id: number
  display_index: number
  section_name: string
  section_order_index: number
  part_name: string
  part_order: number
  completion_target: number
  completed_count: number
  media_kind: LessonMediaKind
  media_url: string | null
  audio_url: string | null
  video_url: string | null
  slide_count: number
  is_recommended: boolean
}

type CacheStateTableClient = {
  select: (_columns: string) => {
    eq: (_column: string, _value: unknown) => {
      maybeSingle: () => Promise<{
        data: StudentWhatsAppCatalogStateRow | null
        error: { message: string } | null
      }>
    }
  }
  upsert: (
    values: {
      student_id: number
      admin_id: number | null
      student_name: string
      whatsapp_phone: string | null
      whatsapp_phone_normalized: string | null
      torah_reading_date: string | null
      active_teacher_parasha_id: number
      available_part_count: number
      recommended_lesson_part_id: number | null
      updated_at: string
    },
    options: { onConflict: string }
  ) => Promise<{ error: { message: string } | null }>
  delete: () => {
    eq: (_column: string, _value: unknown) => Promise<{ error: { message: string } | null }>
  }
}

type CacheItemsTableClient = {
  select: (_columns: string) => {
    eq: (_column: string, _value: unknown) => {
      order: (
        _column: string,
        options: { ascending: boolean }
      ) => Promise<{
        data: StudentWhatsAppCatalogItemRow[] | null
        error: { message: string } | null
      }>
    }
  }
  insert: (
    values: Array<{
      student_id: number
      active_teacher_parasha_id: number
      lesson_part_id: number
      lesson_group_id: number
      display_index: number
      section_name: string
      section_order_index: number
      part_name: string
      part_order: number
      completion_target: number
      completed_count: number
      media_kind: LessonMediaKind
      media_url: string | null
      audio_url: string | null
      video_url: string | null
      slide_count: number
      is_recommended: boolean
      updated_at: string
    }>
  ) => Promise<{ error: { message: string } | null }>
  delete: () => {
    eq: (_column: string, _value: unknown) => Promise<{ error: { message: string } | null }>
  }
}

type LessonPartTeacherParashaLookupClient = {
  select: (_columns: string) => {
    eq: (_column: string, _value: unknown) => {
      maybeSingle: () => Promise<{
        data:
          | {
              lesson_groups:
                | { teacher_parasha_id: number | null }
                | Array<{ teacher_parasha_id: number | null }>
                | null
            }
          | null
        error: { message: string } | null
      }>
    }
  }
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

function isWhatsAppCatalogCacheMissingError(message: string) {
  return (
    message.includes('student_whatsapp_catalog_state') ||
    message.includes('student_whatsapp_catalog_items')
  )
}

async function buildStudentWhatsAppCatalogSnapshot(
  studentId: number
): Promise<StudentWhatsAppCatalog> {
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
    .select(
      `
        teacher_parasha_id,
        teacher_parashot (
          id,
          status
        )
      `
    )
    .eq('student_id', studentId)
    .eq('status', 'active')
    .maybeSingle()

  if (assignmentError) {
    throw new Error(assignmentError.message)
  }

  const activeAssignment = activeAssignmentRow as
    | {
        teacher_parasha_id: number
        teacher_parashot:
          | {
              id: number
              status: string | null
            }
          | Array<{
              id: number
              status: string | null
            }>
          | null
      }
    | null

  if (!activeAssignment?.teacher_parasha_id) {
    throw new Error('אין לתלמיד ספריית פרשה פעילה לשליחה.')
  }

  const teacherParasha = Array.isArray(activeAssignment.teacher_parashot)
    ? activeAssignment.teacher_parashot[0]
    : activeAssignment.teacher_parashot

  if (teacherParasha?.status && teacherParasha.status !== 'active') {
    return {
      student,
      activeTeacherParashaId: activeAssignment.teacher_parasha_id,
      parts: [],
      recommendedPart: null,
    }
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
    return {
      student,
      activeTeacherParashaId: activeAssignment.teacher_parasha_id,
      parts: [],
      recommendedPart: null,
    }
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
    return {
      student,
      activeTeacherParashaId: activeAssignment.teacher_parasha_id,
      parts: [],
      recommendedPart: null,
    }
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

async function clearStudentWhatsAppCatalogCache(studentId: number) {
  const supabaseAdmin = getSupabaseAdmin()
  const cacheItemsTable = supabaseAdmin.from(
    'student_whatsapp_catalog_items'
  ) as unknown as CacheItemsTableClient
  const cacheStateTable = supabaseAdmin.from(
    'student_whatsapp_catalog_state'
  ) as unknown as CacheStateTableClient

  const { error: itemsError } = await cacheItemsTable.delete().eq('student_id', studentId)

  if (itemsError && !isWhatsAppCatalogCacheMissingError(itemsError.message)) {
    throw new Error(itemsError.message)
  }

  const { error: stateError } = await cacheStateTable.delete().eq('student_id', studentId)

  if (stateError && !isWhatsAppCatalogCacheMissingError(stateError.message)) {
    throw new Error(stateError.message)
  }
}

async function persistStudentWhatsAppCatalog(snapshot: StudentWhatsAppCatalog) {
  const supabaseAdmin = getSupabaseAdmin()
  const cacheStateTable = supabaseAdmin.from(
    'student_whatsapp_catalog_state'
  ) as unknown as CacheStateTableClient
  const cacheItemsTable = supabaseAdmin.from(
    'student_whatsapp_catalog_items'
  ) as unknown as CacheItemsTableClient
  const normalizedPhone = sanitizePhoneNumber(snapshot.student.whatsapp_phone ?? '') || null
  const updatedAt = new Date().toISOString()

  const { error: stateError } = await cacheStateTable.upsert(
      {
        student_id: snapshot.student.id,
        admin_id: snapshot.student.admin_id,
        student_name: snapshot.student.name,
        whatsapp_phone: snapshot.student.whatsapp_phone,
        whatsapp_phone_normalized: normalizedPhone,
        torah_reading_date: snapshot.student.torah_reading_date,
        active_teacher_parasha_id: snapshot.activeTeacherParashaId,
        available_part_count: snapshot.parts.length,
        recommended_lesson_part_id: snapshot.recommendedPart?.lessonPartId ?? null,
        updated_at: updatedAt,
      },
      { onConflict: 'student_id' }
    )

  if (stateError) {
    if (isWhatsAppCatalogCacheMissingError(stateError.message)) {
      return
    }

    throw new Error(stateError.message)
  }

  const { error: deleteItemsError } = await cacheItemsTable
    .delete()
    .eq('student_id', snapshot.student.id)

  if (deleteItemsError) {
    if (isWhatsAppCatalogCacheMissingError(deleteItemsError.message)) {
      return
    }

    throw new Error(deleteItemsError.message)
  }

  if (snapshot.parts.length === 0) {
    return
  }

  const itemPayload = snapshot.parts.map((part, index) => ({
    student_id: snapshot.student.id,
    active_teacher_parasha_id: snapshot.activeTeacherParashaId,
    lesson_part_id: part.lessonPartId,
    lesson_group_id: part.lessonGroupId,
    display_index: index + 1,
    section_name: part.sectionName,
    section_order_index: part.sectionOrderIndex,
    part_name: part.partName,
    part_order: part.partOrder,
    completion_target: part.completionTarget,
    completed_count: part.completedCount,
    media_kind: part.mediaKind,
    media_url: part.mediaUrl,
    audio_url: part.audioUrl,
    video_url: part.videoUrl,
    slide_count: part.slideCount,
    is_recommended: part.lessonPartId === snapshot.recommendedPart?.lessonPartId,
    updated_at: updatedAt,
  }))

  const { error: insertItemsError } = await cacheItemsTable.insert(itemPayload)

  if (insertItemsError) {
    if (isWhatsAppCatalogCacheMissingError(insertItemsError.message)) {
      return
    }

    throw new Error(insertItemsError.message)
  }
}

async function loadCachedStudentWhatsAppCatalog(studentId: number) {
  const supabaseAdmin = getSupabaseAdmin()
  const cacheStateTable = supabaseAdmin.from(
    'student_whatsapp_catalog_state'
  ) as unknown as CacheStateTableClient
  const cacheItemsTable = supabaseAdmin.from(
    'student_whatsapp_catalog_items'
  ) as unknown as CacheItemsTableClient

  const { data: stateRow, error: stateError } = await cacheStateTable.select(
      'student_id, admin_id, student_name, whatsapp_phone, whatsapp_phone_normalized, torah_reading_date, active_teacher_parasha_id, available_part_count, recommended_lesson_part_id'
    )
    .eq('student_id', studentId)
    .maybeSingle()

  if (stateError) {
    if (isWhatsAppCatalogCacheMissingError(stateError.message)) {
      return null
    }

    throw new Error(stateError.message)
  }

  if (!stateRow) {
    return null
  }

  const state = stateRow as StudentWhatsAppCatalogStateRow

  if (!state.active_teacher_parasha_id) {
    return {
      student: {
        id: state.student_id,
        admin_id: state.admin_id,
        name: state.student_name,
        whatsapp_phone: state.whatsapp_phone,
        torah_reading_date: state.torah_reading_date,
      },
      activeTeacherParashaId: 0,
      parts: [],
      recommendedPart: null,
    }
  }

  const { data: itemRows, error: itemsError } = await cacheItemsTable.select(
      'student_id, active_teacher_parasha_id, lesson_part_id, lesson_group_id, display_index, section_name, section_order_index, part_name, part_order, completion_target, completed_count, media_kind, media_url, audio_url, video_url, slide_count, is_recommended'
    )
    .eq('student_id', studentId)
    .order('display_index', { ascending: true })

  if (itemsError) {
    if (isWhatsAppCatalogCacheMissingError(itemsError.message)) {
      return null
    }

    throw new Error(itemsError.message)
  }

  const items = ((itemRows ?? []) as StudentWhatsAppCatalogItemRow[]).map((row) => ({
    lessonPartId: row.lesson_part_id,
    lessonGroupId: row.lesson_group_id,
    sectionName: row.section_name,
    sectionOrderIndex: row.section_order_index,
    partName: row.part_name,
    partOrder: row.part_order,
    completionTarget: row.completion_target,
    completedCount: row.completed_count,
    mediaKind: row.media_kind,
    mediaUrl: row.media_url,
    audioUrl: row.audio_url,
    videoUrl: row.video_url,
    slideCount: row.slide_count,
  }))

  const recommendedLessonPartId =
    items.find((_, index) => (itemRows as StudentWhatsAppCatalogItemRow[])[index]?.is_recommended)
      ?.lessonPartId ?? state.recommended_lesson_part_id

  return {
    student: {
      id: state.student_id,
      admin_id: state.admin_id,
      name: state.student_name,
      whatsapp_phone: state.whatsapp_phone,
      torah_reading_date: state.torah_reading_date,
    },
    activeTeacherParashaId: state.active_teacher_parasha_id,
    parts: items,
    recommendedPart:
      items.find((part) => part.lessonPartId === recommendedLessonPartId) ??
      items[0] ??
      null,
  } satisfies StudentWhatsAppCatalog
}

export async function clearStudentWhatsAppCatalog(studentId: number) {
  await clearStudentWhatsAppCatalogCache(studentId)
}

export async function refreshStudentWhatsAppCatalog(studentId: number) {
  try {
    const snapshot = await buildStudentWhatsAppCatalogSnapshot(studentId)
    await persistStudentWhatsAppCatalog(snapshot)
    return snapshot
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('אין לתלמיד ספריית פרשה פעילה לשליחה.')
    ) {
      await clearStudentWhatsAppCatalogCache(studentId)
      return null
    }

    throw error
  }
}

export async function refreshWhatsAppCatalogForTeacherParasha(teacherParashaId: number) {
  const supabaseAdmin = getSupabaseAdmin()
  const { data, error } = await supabaseAdmin
    .from('student_teacher_parasha_assignments')
    .select('student_id')
    .eq('teacher_parasha_id', teacherParashaId)
    .eq('status', 'active')

  if (error) {
    throw new Error(error.message)
  }

  const studentIds = Array.from(
    new Set(
      ((data ?? []) as Array<{ student_id: number }>).map((row) => row.student_id)
    )
  )

  await Promise.all(studentIds.map((studentId) => refreshStudentWhatsAppCatalog(studentId)))
}

export async function refreshWhatsAppCatalogForLessonPart(lessonPartId: number) {
  const supabaseAdmin = getSupabaseAdmin()
  const lessonPartsTable = supabaseAdmin.from(
    'lesson_parts'
  ) as unknown as LessonPartTeacherParashaLookupClient
  const { data, error } = await lessonPartsTable
    .select(
      `
        id,
        lesson_groups (
          teacher_parasha_id
        )
      `
    )
    .eq('id', lessonPartId)
    .maybeSingle()

  if (error || !data) {
    throw new Error(error?.message ?? 'תת־החלק לא נמצא.')
  }

  const lessonGroup = Array.isArray(data.lesson_groups)
    ? data.lesson_groups[0]
    : data.lesson_groups

  const teacherParashaId = lessonGroup?.teacher_parasha_id

  if (teacherParashaId) {
    await refreshWhatsAppCatalogForTeacherParasha(teacherParashaId)
  }
}

export async function findStudentByWhatsAppPhone(rawPhone: string) {
  const normalizedPhone = sanitizePhoneNumber(rawPhone)

  if (!normalizedPhone) {
    return null
  }

  const supabaseAdmin = getSupabaseAdmin()
  const cacheStateTable = supabaseAdmin.from(
    'student_whatsapp_catalog_state'
  ) as unknown as CacheStateTableClient
  const { data: stateRow, error: stateError } = await cacheStateTable
    .select('student_id, admin_id, student_name, whatsapp_phone, torah_reading_date')
    .eq('whatsapp_phone_normalized', normalizedPhone)
    .maybeSingle()

  if (stateError && !isWhatsAppCatalogCacheMissingError(stateError.message)) {
    throw new Error(stateError.message)
  }

  if (stateRow) {
    const state = stateRow as {
      student_id: number
      admin_id: number | null
      student_name: string
      whatsapp_phone: string | null
      torah_reading_date: string | null
    }

    return {
      id: state.student_id,
      admin_id: state.admin_id,
      name: state.student_name,
      whatsapp_phone: state.whatsapp_phone,
      torah_reading_date: state.torah_reading_date,
    } satisfies StudentWhatsAppCatalogStudent
  }

  const { data, error } = await supabaseAdmin
    .from('students')
    .select('id, admin_id, name, whatsapp_phone, torah_reading_date')
    .not('whatsapp_phone', 'is', null)

  if (error) {
    throw new Error(error.message)
  }

  const students = (data ?? []) as StudentWhatsAppCatalogStudent[]
  const student =
    students.find((row) => sanitizePhoneNumber(row.whatsapp_phone ?? '') === normalizedPhone) ??
    null

  if (student) {
    await refreshStudentWhatsAppCatalog(student.id).catch(() => undefined)
  }

  return student
}

export async function getStudentWhatsAppCatalog(studentId: number) {
  const cachedCatalog = await loadCachedStudentWhatsAppCatalog(studentId)

  if (cachedCatalog) {
    if (!cachedCatalog.activeTeacherParashaId) {
      throw new Error('אין לתלמיד ספריית פרשה פעילה לשליחה.')
    }

    return cachedCatalog
  }

  const snapshot = await buildStudentWhatsAppCatalogSnapshot(studentId)
  await persistStudentWhatsAppCatalog(snapshot)
  return snapshot
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
