import { supabase } from '@/lib/supabase'

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
  admin_id: number
  parasha_id: number
  section_id: number
}

export type LessonPart = {
  id: number
  lesson_group_id: number
  name: string
  part_order: number
  is_full_reading: boolean
  audio_url: string | null
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

export type SectionProgress = Section & {
  totalParts: number
  completedParts: number
  practiceCount: number
  lessonGroupId: number | null
}

export type PartProgress = LessonPart & {
  practiceCount: number
  completedCount: number
  lastPracticedAt: string | null
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
    .select('id, admin_id, parasha_id, section_id')
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
        .select(
          'id, lesson_group_id, name, part_order, is_full_reading, audio_url, duration_seconds'
        )
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

  const { data: practiceEvents, error: practiceError } = partIds.length
    ? await supabase
        .from('practice_events')
        .select('id, student_id, lesson_part_id, completed, created_at')
        .eq('student_id', student.id)
        .in('lesson_part_id', partIds)
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

  for (const part of parts) {
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
    }
  }

  const sectionProgress = sections.map((section) => {
    const group = groupBySection.get(section.id)
    const groupParts = group ? partsByGroup.get(group.id) ?? [] : []
    const practiceCount = groupParts.reduce(
      (sum, part) => sum + (practiceCountByPart.get(part.id) ?? 0),
      0
    )
    const completedParts = groupParts.filter((part) =>
      completedPartIds.has(part.id)
    ).length

    return {
      ...section,
      totalParts: groupParts.length,
      completedParts,
      practiceCount,
      lessonGroupId: group?.id ?? null,
    }
  })

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
    .select('id, admin_id, parasha_id, section_id')
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
    .select(
      'id, lesson_group_id, name, part_order, is_full_reading, audio_url, duration_seconds'
    )
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

  const { data: practiceEvents, error: practiceError } = partIds.length
    ? await supabase
        .from('practice_events')
        .select('id, student_id, lesson_part_id, completed, created_at')
        .eq('student_id', student.id)
        .in('lesson_part_id', partIds)
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
    parts: parts.map((part) => {
      const events = eventsByPart.get(part.id) ?? []

      return {
        ...part,
        practiceCount: events.length,
        completedCount: events.filter((event) => event.completed).length,
        lastPracticedAt: events[0]?.created_at ?? null,
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
      parashaName: getParashaName(student),
      error:
        studentError ?? studentsError ?? new Error('לא נמצא תלמיד פעיל'),
    }
  }

  const { data: lessonPart, error: lessonPartError } = await supabase
    .from('lesson_parts')
    .select(
      'id, lesson_group_id, name, part_order, is_full_reading, audio_url, duration_seconds'
    )
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
      parashaName: getParashaName(student),
      error: lessonPartError ?? new Error('לא נמצא תת-חלק'),
    }
  }

  const { data: lessonGroup, error: lessonGroupError } = await supabase
    .from('lesson_groups')
    .select('id, admin_id, parasha_id, section_id')
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
      parashaName: getParashaName(student),
      error: new Error('השיעור לא שייך לתוכן של התלמיד'),
    }
  }

  const [{ data: section, error: sectionError }, { data: slides, error: slidesError }, { data: practiceEvents, error: practiceError }] =
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
    ])

  return {
    student,
    students,
    lessonPart: lessonPart as LessonPart,
    lessonGroup: lessonGroup as LessonGroup,
    section: (section ?? null) as Section | null,
    slides: (slides ?? []) as LessonSlide[],
    practiceEvents: (practiceEvents ?? []) as PracticeEvent[],
    parashaName: getParashaName(student),
    error: sectionError ?? slidesError ?? practiceError ?? null,
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
