import { supabase } from '@/lib/supabase'
import {
  getLessonMediaKind,
  getLessonMediaUrl,
  isLessonPartReady,
  type LessonMediaKind,
} from '@/lib/lesson-media'
import { createSignedStorageUrl } from '@/lib/storage-files'

type Parasha = {
  id: number
  name: string
}

export type Student = {
  id: number
  admin_id: number | null
  username: string | null
  name: string
  parasha_id: number | null
  parashot: Parasha | Parasha[] | null
}

export type Section = {
  id: number
  name: string
  order_index: number
}

type LessonGroup = {
  id: number
  admin_id: number | null
  parasha_id: number | null
  section_id: number
  completion_target?: number | null
}

export type LessonPart = {
  id: number
  lesson_group_id: number
  name: string
  part_order: number
  is_full_reading: boolean
  media_kind?: LessonMediaKind | string | null
  is_visible_to_student?: boolean | null
  completion_target?: number | null
  audio_url: string | null
  video_url?: string | null
  duration_seconds: number | null
}

export type LessonSlide = {
  id: number
  lesson_part_id: number
  image_url: string
  slide_index: number
  start_second: number
}

export type PracticeEvent = {
  id: number
  student_id: number
  lesson_part_id: number
  completed: boolean
  created_at: string
}

export type StudentRecording = {
  id: number
  student_id: number
  lesson_part_id: number
  storage_path: string
  duration_seconds: number | null
  created_at: string
  updated_at?: string
  signed_url?: string | null
}

export type SectionProgress = Section & {
  totalParts: number
  completedParts: number
  practiceCount: number
  lessonGroupId: number | null
  completionTarget: number
  completionEventCount: number
}

export type PartProgress = LessonPart & {
  practiceCount: number
  completedCount: number
  lastPracticedAt: string | null
  slideCount: number
  isReady: boolean
  completionTarget: number
  mediaKind: LessonMediaKind
  mediaUrl: string | null
}

export type LessonNavigation = {
  previous: { id: number; name: string } | null
  next: { id: number; name: string } | null
}

function getCompletionTarget(part: LessonPart | null | undefined) {
  return Math.max(part?.completion_target ?? 3, 1)
}

async function getSlideCountByPartIds(partIds: number[]) {
  if (partIds.length === 0) {
    return {
      slideCountByPartId: new Map<number, number>(),
      error: null,
    }
  }

  const { data, error } = await supabase
    .from('lesson_slides')
    .select('lesson_part_id')
    .in('lesson_part_id', partIds)

  if (error) {
    return {
      slideCountByPartId: new Map<number, number>(),
      error,
    }
  }

  const slideCountByPartId = new Map<number, number>()

  for (const row of (data ?? []) as Array<{ lesson_part_id: number }>) {
    slideCountByPartId.set(
      row.lesson_part_id,
      (slideCountByPartId.get(row.lesson_part_id) ?? 0) + 1
    )
  }

  return {
    slideCountByPartId,
    error: null,
  }
}

async function getStudentRecording(
  studentId: number,
  lessonPartId: number
) {
  const { data, error } = await supabase
    .from('student_recordings')
    .select('id, student_id, lesson_part_id, storage_path, duration_seconds, created_at, updated_at')
    .eq('student_id', studentId)
    .eq('lesson_part_id', lessonPartId)
    .maybeSingle()

  if (error) {
    return {
      recording: null as StudentRecording | null,
      error,
    }
  }

  if (!data) {
    return {
      recording: null as StudentRecording | null,
      error: null,
    }
  }

  try {
    const signedUrl = await createSignedStorageUrl(
      'student-recordings',
      data.storage_path
    )

    return {
      recording: {
        ...(data as StudentRecording),
        signed_url: signedUrl,
      },
      error: null,
    }
  } catch (error) {
    return {
      recording: {
        ...(data as StudentRecording),
        signed_url: null,
      },
      error: error instanceof Error ? error : new Error('לא הצלחנו ליצור קישור להקלטה.'),
    }
  }
}

function getParashaName(student: Student | null) {
  const parashot = student?.parashot

  if (!parashot) {
    return null
  }

  return Array.isArray(parashot) ? parashot[0]?.name ?? null : parashot.name
}

function parseNumericId(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = Number(raw)

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export function getStudentIdFromSearchParams(
  searchParams: Record<string, string | string[] | undefined>
) {
  return parseNumericId(searchParams.studentId)
}

export async function getStudents() {
  const { data, error } = await supabase
    .from('students')
    .select(
      `
        id,
        admin_id,
        username,
        name,
        parasha_id,
        parashot (
          id,
          name
        )
      `
    )
    .order('name', { ascending: true })

  return {
    students: (data ?? []) as Student[],
    error,
  }
}

export async function getActiveStudent(studentId?: number | null) {
  let query = supabase.from('students').select(
    `
      id,
      admin_id,
      username,
      name,
      parasha_id,
      parashot (
        id,
        name
      )
    `
  )

  if (studentId) {
    query = query.eq('id', studentId)
  } else {
    query = query.order('name', { ascending: true }).limit(1)
  }

  const { data, error } = await query.maybeSingle()

  return {
    student: (data ?? null) as Student | null,
    error,
  }
}

export async function getSections() {
  const { data, error } = await supabase
    .from('sections')
    .select('id, name, order_index')
    .order('order_index', { ascending: true })

  return {
    sections: (data ?? []) as Section[],
    error,
  }
}

export async function getStudentDashboardData(studentId?: number | null) {
  const [{ student, error: studentError }, { students, error: studentsError }, { sections, error: sectionsError }] =
    await Promise.all([getActiveStudent(studentId), getStudents(), getSections()])

  if (studentError || studentsError || sectionsError || !student) {
    return {
      student,
      students,
      sections: [] as SectionProgress[],
      parashaName: getParashaName(student),
      error:
        studentError ??
        studentsError ??
        sectionsError ??
        new Error('לא נמצא תלמיד פעיל'),
    }
  }

  const { data: lessonGroups, error: lessonGroupsError } = await supabase
    .from('lesson_groups')
    .select('*')
    .eq('admin_id', student.admin_id ?? -1)
    .eq('parasha_id', student.parasha_id ?? -1)

  if (lessonGroupsError) {
    return {
      student,
      students,
      sections: [] as SectionProgress[],
      parashaName: getParashaName(student),
      error: lessonGroupsError,
    }
  }

  const groups = (lessonGroups ?? []) as LessonGroup[]
  const groupIds = groups.map((group) => group.id)

  const { data: lessonParts, error: lessonPartsError } = groupIds.length
      ? await supabase
        .from('lesson_parts')
        .select('*')
        .in('lesson_group_id', groupIds)
    : { data: [], error: null }

  if (lessonPartsError) {
    return {
      student,
      students,
      sections: [] as SectionProgress[],
      parashaName: getParashaName(student),
      error: lessonPartsError,
    }
  }

  const parts = (lessonParts ?? []) as LessonPart[]
  const partIds = parts.map((part) => part.id)
  const { slideCountByPartId, error: slideCountError } =
    await getSlideCountByPartIds(partIds)

  if (slideCountError) {
    return {
      student,
      students,
      sections: [] as SectionProgress[],
      parashaName: getParashaName(student),
      error: slideCountError,
    }
  }

  const readyParts = parts.filter((part) =>
    isLessonPartReady(part, slideCountByPartId, part.id)
  )
  const readyPartIds = readyParts.map((part) => part.id)

  const { data: practiceEvents, error: practiceError } = readyPartIds.length
    ? await supabase
        .from('practice_events')
        .select('id, student_id, lesson_part_id, completed, created_at')
        .eq('student_id', student.id)
        .in('lesson_part_id', readyPartIds)
    : { data: [], error: null }

  if (practiceError) {
    return {
      student,
      students,
      sections: [] as SectionProgress[],
      parashaName: getParashaName(student),
      error: practiceError,
    }
  }

  const groupBySection = new Map(groups.map((group) => [group.section_id, group]))
  const partsByGroup = new Map<number, LessonPart[]>()
  const completedPartIds = new Set<number>()
  const practiceCountByPart = new Map<number, number>()

  const completedEventCountByPart = new Map<number, number>()

  for (const part of readyParts) {
    const collection = partsByGroup.get(part.lesson_group_id) ?? []
    collection.push(part)
    partsByGroup.set(part.lesson_group_id, collection)
  }

  for (const event of (practiceEvents ?? []) as PracticeEvent[]) {
    practiceCountByPart.set(
      event.lesson_part_id,
      (practiceCountByPart.get(event.lesson_part_id) ?? 0) + 1
    )

    if (event.completed) {
      completedPartIds.add(event.lesson_part_id)
      completedEventCountByPart.set(
        event.lesson_part_id,
        (completedEventCountByPart.get(event.lesson_part_id) ?? 0) + 1
      )
    }
  }

  const sectionProgress = sections
    .map((section) => {
      const group = groupBySection.get(section.id)
      const groupParts = group ? partsByGroup.get(group.id) ?? [] : []
      const practiceCount = groupParts.reduce(
        (sum, part) => sum + (practiceCountByPart.get(part.id) ?? 0),
        0
      )
      const completedParts = groupParts.filter((part) =>
        completedPartIds.has(part.id)
      ).length
      const completionEventCount = groupParts.reduce(
        (sum, part) => sum + (completedEventCountByPart.get(part.id) ?? 0),
        0
      )

      return {
        ...section,
        totalParts: groupParts.length,
        completedParts,
        practiceCount,
        lessonGroupId: group?.id ?? null,
        completionTarget: groupParts.reduce(
          (sum, part) => sum + getCompletionTarget(part),
          0
        ),
        completionEventCount,
      }
    })
    .filter((section) => section.totalParts > 0)

  return {
    student,
    students,
    sections: sectionProgress,
    parashaName: getParashaName(student),
    error: null,
  }
}

export async function getSectionPageData(
  sectionId: number,
  studentId?: number | null
) {
  const [{ student, error: studentError }, { students, error: studentsError }] =
    await Promise.all([getActiveStudent(studentId), getStudents()])

  if (studentError || studentsError || !student) {
    return {
      student,
      students,
      section: null,
      parts: [] as PartProgress[],
      parashaName: getParashaName(student),
      error:
        studentError ?? studentsError ?? new Error('לא נמצא תלמיד פעיל'),
    }
  }

  const { data: section, error: sectionError } = await supabase
    .from('sections')
    .select('id, name, order_index')
    .eq('id', sectionId)
    .single()

  if (sectionError || !section) {
    return {
      student,
      students,
      section: null,
      parts: [] as PartProgress[],
      parashaName: getParashaName(student),
      error: sectionError ?? new Error('החלק לא נמצא'),
    }
  }

  const { data: lessonGroup, error: lessonGroupError } = await supabase
    .from('lesson_groups')
    .select('*')
    .eq('admin_id', student.admin_id ?? -1)
    .eq('parasha_id', student.parasha_id ?? -1)
    .eq('section_id', sectionId)
    .maybeSingle()

  if (lessonGroupError) {
    return {
      student,
      students,
      section: section as Section,
      parts: [] as PartProgress[],
      parashaName: getParashaName(student),
      error: lessonGroupError,
    }
  }

  if (!lessonGroup) {
    return {
      student,
      students,
      section: section as Section,
      parts: [] as PartProgress[],
      parashaName: getParashaName(student),
      error: null,
    }
  }

  const { data: lessonParts, error: lessonPartsError } = await supabase
    .from('lesson_parts')
    .select('*')
    .eq('lesson_group_id', lessonGroup.id)
    .order('part_order', { ascending: true })

  if (lessonPartsError) {
    return {
      student,
      students,
      section: section as Section,
      parts: [] as PartProgress[],
      parashaName: getParashaName(student),
      error: lessonPartsError,
    }
  }

  const parts = (lessonParts ?? []) as LessonPart[]
  const partIds = parts.map((part) => part.id)
  const { slideCountByPartId, error: slideCountError } =
    await getSlideCountByPartIds(partIds)

  if (slideCountError) {
    return {
      student,
      students,
      section: section as Section,
      parts: [] as PartProgress[],
      parashaName: getParashaName(student),
      error: slideCountError,
    }
  }

  const readyParts = parts.filter((part) =>
    isLessonPartReady(part, slideCountByPartId, part.id)
  )
  const readyPartIds = readyParts.map((part) => part.id)

  const { data: practiceEvents, error: practiceError } = readyPartIds.length
    ? await supabase
        .from('practice_events')
        .select('id, student_id, lesson_part_id, completed, created_at')
        .eq('student_id', student.id)
        .in('lesson_part_id', readyPartIds)
        .order('created_at', { ascending: false })
    : { data: [], error: null }

  if (practiceError) {
    return {
      student,
      students,
      section: section as Section,
      parts: [] as PartProgress[],
      parashaName: getParashaName(student),
      error: practiceError,
    }
  }

  const eventsByPart = new Map<number, PracticeEvent[]>()

  for (const event of (practiceEvents ?? []) as PracticeEvent[]) {
    const collection = eventsByPart.get(event.lesson_part_id) ?? []
    collection.push(event)
    eventsByPart.set(event.lesson_part_id, collection)
  }

  return {
    student,
    students,
    section: section as Section,
    parts: readyParts.map((part) => {
      const events = eventsByPart.get(part.id) ?? []

      return {
        ...part,
        practiceCount: events.length,
        completedCount: events.filter((event) => event.completed).length,
        lastPracticedAt: events[0]?.created_at ?? null,
        slideCount: slideCountByPartId.get(part.id) ?? 0,
        isReady: true,
        completionTarget: getCompletionTarget(part),
        mediaKind: getLessonMediaKind(part),
        mediaUrl: getLessonMediaUrl(part),
      }
    }),
    parashaName: getParashaName(student),
    error: null,
  }
}

export async function getLessonPageData(
  partId: number,
  studentId?: number | null
) {
  const [{ student, error: studentError }, { students, error: studentsError }] =
    await Promise.all([getActiveStudent(studentId), getStudents()])

  if (studentError || studentsError || !student) {
    return {
      student,
      students,
      lessonPart: null,
      lessonGroup: null,
      section: null,
      slides: [] as LessonSlide[],
      practiceEvents: [] as PracticeEvent[],
      studentRecording: null as StudentRecording | null,
      navigation: { previous: null, next: null } as LessonNavigation,
      parashaName: getParashaName(student),
      error:
        studentError ?? studentsError ?? new Error('לא נמצא תלמיד פעיל'),
    }
  }

  const { data: lessonPart, error: lessonPartError } = await supabase
    .from('lesson_parts')
    .select('*')
    .eq('id', partId)
    .single()

  if (lessonPartError || !lessonPart) {
    return {
      student,
      students,
      lessonPart: null,
      lessonGroup: null,
      section: null,
      slides: [] as LessonSlide[],
      practiceEvents: [] as PracticeEvent[],
      studentRecording: null as StudentRecording | null,
      navigation: { previous: null, next: null } as LessonNavigation,
      parashaName: getParashaName(student),
      error: lessonPartError ?? new Error('לא נמצא תת-חלק'),
    }
  }

  const { data: lessonGroup, error: lessonGroupError } = await supabase
    .from('lesson_groups')
    .select('*')
    .eq('id', lessonPart.lesson_group_id)
    .single()

  if (lessonGroupError || !lessonGroup) {
    return {
      student,
      students,
      lessonPart: lessonPart as LessonPart,
      lessonGroup: null,
      section: null,
      slides: [] as LessonSlide[],
      practiceEvents: [] as PracticeEvent[],
      studentRecording: null as StudentRecording | null,
      navigation: { previous: null, next: null } as LessonNavigation,
      parashaName: getParashaName(student),
      error: lessonGroupError ?? new Error('לא נמצאה קבוצת שיעור'),
    }
  }

  if (
    lessonGroup.parasha_id !== student.parasha_id ||
    lessonGroup.admin_id !== student.admin_id
  ) {
    return {
      student,
      students,
      lessonPart: lessonPart as LessonPart,
      lessonGroup: lessonGroup as LessonGroup,
      section: null,
      slides: [] as LessonSlide[],
      practiceEvents: [] as PracticeEvent[],
      studentRecording: null as StudentRecording | null,
      navigation: { previous: null, next: null } as LessonNavigation,
      parashaName: getParashaName(student),
      error: new Error('השיעור לא שייך לתוכן של התלמיד'),
    }
  }

  const [
    { data: section, error: sectionError },
    { data: slides, error: slidesError },
    { data: practiceEvents, error: practiceError },
    { data: allGroups, error: allGroupsError },
    { recording: studentRecording },
  ] =
    await Promise.all([
      supabase
        .from('sections')
        .select('id, name, order_index')
        .eq('id', lessonGroup.section_id)
        .single(),
      supabase
        .from('lesson_slides')
        .select('id, lesson_part_id, image_url, slide_index, start_second')
        .eq('lesson_part_id', lessonPart.id)
        .order('slide_index', { ascending: true }),
      supabase
        .from('practice_events')
        .select('id, student_id, lesson_part_id, completed, created_at')
        .eq('student_id', student.id)
        .eq('lesson_part_id', lessonPart.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('lesson_groups')
        .select('id, section_id, sections ( order_index )')
        .eq('admin_id', student.admin_id ?? -1)
        .eq('parasha_id', student.parasha_id ?? -1),
      getStudentRecording(student.id, lessonPart.id),
    ])

  if (allGroupsError) {
    return {
      student,
      students,
      lessonPart: lessonPart as LessonPart,
      lessonGroup: lessonGroup as LessonGroup,
      section: (section ?? null) as Section | null,
      slides: (slides ?? []) as LessonSlide[],
      practiceEvents: (practiceEvents ?? []) as PracticeEvent[],
      studentRecording,
      navigation: { previous: null, next: null } as LessonNavigation,
      parashaName: getParashaName(student),
      error: allGroupsError,
    }
  }

  const groupRows = (allGroups ?? []) as Array<{
    id: number
    section_id: number
    sections: { order_index: number } | { order_index: number }[] | null
  }>
  const navigationGroupIds = groupRows.map((group) => group.id)
  const { data: navigationParts, error: navigationPartsError } =
    navigationGroupIds.length > 0
      ? await supabase
          .from('lesson_parts')
          .select('*')
          .in('lesson_group_id', navigationGroupIds)
      : { data: [], error: null }

  if (navigationPartsError) {
    return {
      student,
      students,
      lessonPart: lessonPart as LessonPart,
      lessonGroup: lessonGroup as LessonGroup,
      section: (section ?? null) as Section | null,
      slides: (slides ?? []) as LessonSlide[],
      practiceEvents: (practiceEvents ?? []) as PracticeEvent[],
      studentRecording,
      navigation: { previous: null, next: null } as LessonNavigation,
      parashaName: getParashaName(student),
      error: navigationPartsError,
    }
  }

  const allNavigationParts = (navigationParts ?? []) as LessonPart[]
  const navigationPartIds = allNavigationParts.map((part) => part.id)
  const { slideCountByPartId: navigationSlidesCountByPartId, error: navigationSlidesError } =
    await getSlideCountByPartIds(navigationPartIds)

  if (navigationSlidesError) {
    return {
      student,
      students,
      lessonPart: lessonPart as LessonPart,
      lessonGroup: lessonGroup as LessonGroup,
      section: (section ?? null) as Section | null,
      slides: (slides ?? []) as LessonSlide[],
      practiceEvents: (practiceEvents ?? []) as PracticeEvent[],
      studentRecording,
      navigation: { previous: null, next: null } as LessonNavigation,
      parashaName: getParashaName(student),
      error: navigationSlidesError,
    }
  }

  const sectionOrderByGroupId = new Map<number, number>()

  for (const group of groupRows) {
    const sectionRow = Array.isArray(group.sections) ? group.sections[0] : group.sections
    sectionOrderByGroupId.set(group.id, sectionRow?.order_index ?? 0)
  }

  const orderedReadyParts = allNavigationParts
    .filter((part) => isLessonPartReady(part, navigationSlidesCountByPartId, part.id))
    .sort((left, right) => {
      const leftSectionOrder = sectionOrderByGroupId.get(left.lesson_group_id) ?? 0
      const rightSectionOrder = sectionOrderByGroupId.get(right.lesson_group_id) ?? 0

      if (leftSectionOrder !== rightSectionOrder) {
        return leftSectionOrder - rightSectionOrder
      }

      if (left.part_order !== right.part_order) {
        return left.part_order - right.part_order
      }

      return left.id - right.id
    })

  const currentPartIndex = orderedReadyParts.findIndex((part) => part.id === lessonPart.id)
  const navigation: LessonNavigation = {
    previous:
      currentPartIndex > 0
        ? {
            id: orderedReadyParts[currentPartIndex - 1].id,
            name: orderedReadyParts[currentPartIndex - 1].name,
          }
        : null,
    next:
      currentPartIndex >= 0 && currentPartIndex < orderedReadyParts.length - 1
        ? {
            id: orderedReadyParts[currentPartIndex + 1].id,
            name: orderedReadyParts[currentPartIndex + 1].name,
          }
        : null,
  }

  return {
    student,
    students,
    lessonPart: lessonPart as LessonPart,
    lessonGroup: lessonGroup as LessonGroup,
    section: (section ?? null) as Section | null,
    slides: (slides ?? []) as LessonSlide[],
    practiceEvents: (practiceEvents ?? []) as PracticeEvent[],
    studentRecording,
    navigation,
    parashaName: getParashaName(student),
    error: !isLessonPartReady(
      lessonPart as LessonPart,
      new Map([[lessonPart.id, (slides ?? []).length]]),
      lessonPart.id
    )
      ? new Error(
          getLessonMediaKind(lessonPart as LessonPart) === 'video'
            ? 'הקטע עדיין לא מוכן לתלמיד. נדרש קובץ וידאו.'
            : 'הקטע עדיין לא מוכן לתלמיד. נדרש אודיו ולפחות שקופית אחת.'
        )
      : sectionError ?? slidesError ?? practiceError ?? null,
  }
}

export async function createPracticeEvent(input: {
  studentId: number
  lessonPartId: number
  completed: boolean
}) {
  const { data, error } = await supabase
    .from('practice_events')
    .insert({
      student_id: input.studentId,
      lesson_part_id: input.lessonPartId,
      completed: input.completed,
    })
    .select('id, student_id, lesson_part_id, completed, created_at')
    .single()

  return {
    event: (data ?? null) as PracticeEvent | null,
    error,
  }
}
