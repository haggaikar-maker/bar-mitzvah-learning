import { supabase } from '@/lib/supabase'
import type { AdminSession } from '@/lib/admin-auth'
import type { LessonPart, LessonSlide, Section, Student } from '@/lib/practice-data'

export type AdminParasha = {
  id: number
  name: string
}

export type AdminSection = Section

export type AdminStudent = Student

export type AdminLessonGroup = {
  id: number
  admin_id?: number
  parasha_id: number
  section_id: number
}

export type AdminRecord = {
  id: number
  username: string
  display_name: string
  role: 'primary' | 'teacher'
}

export type ParashaSource = {
  adminId: number
  username: string
  displayName: string
}

export async function getAdminDashboardData(selected?: {
  parashaId?: number | null
  sectionId?: number | null
  partId?: number | null
}, session?: AdminSession) {
  const [{ data: parashot, error: parashotError }, { data: sections, error: sectionsError }, { data: students, error: studentsError }] =
    await Promise.all([
      supabase.from('parashot').select('id, name').order('name', { ascending: true }),
      supabase
        .from('sections')
        .select('id, name, order_index')
        .order('order_index', { ascending: true }),
      supabase
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
        .order('name', { ascending: true }),
    ])

  if (parashotError || sectionsError || studentsError) {
    return {
      parashot: [] as AdminParasha[],
      sections: [] as AdminSection[],
      students: [] as AdminStudent[],
      admins: [] as AdminRecord[],
      managerByStudentId: {} as Record<number, number | null>,
      lessonGroup: null as AdminLessonGroup | null,
      lessonParts: [] as LessonPart[],
      lessonSlides: [] as LessonSlide[],
      selectedParashaId: selected?.parashaId ?? null,
      selectedSectionId: selected?.sectionId ?? null,
      selectedPartId: selected?.partId ?? null,
      parashaSources: [] as ParashaSource[],
      error: parashotError ?? sectionsError ?? studentsError,
    }
  }

  const availableParashot = (parashot ?? []) as AdminParasha[]
  const availableSections = (sections ?? []) as AdminSection[]
  const availableStudents = (students ?? []) as AdminStudent[]
  const { data: admins, error: adminsError } = await supabase
    .from('admins')
    .select('id, username, display_name, role')
    .order('display_name', { ascending: true })
  const availableAdmins = ((admins ?? []) as AdminRecord[]).map((admin) => ({
    ...admin,
    role: admin.role === 'teacher' ? 'teacher' : 'primary',
  }))
  const managerByStudentId = Object.fromEntries(
    availableStudents.map((student) => [student.id, student.admin_id ?? null])
  ) as Record<number, number | null>

  const relationshipWarning =
    adminsError
      ? new Error(
          'טבלת המנהלים עדיין לא זמינה, לכן ייתכן שחלק מפעולות הניהול לא יוצגו.'
        )
      : null

  const visibleStudents =
    session?.role === 'teacher' && session.id
      ? availableStudents.filter((student) => student.admin_id === session.id)
      : session?.role === 'primary' && session.id
        ? availableStudents.filter(
            (student) => student.admin_id === session.id || student.admin_id === null
          )
      : availableStudents

  const selectedParashaId =
    selected?.parashaId ?? availableParashot[0]?.id ?? null
  const selectedSectionId =
    selected?.sectionId ?? availableSections[0]?.id ?? null

  let lessonGroup: AdminLessonGroup | null = null
  let lessonParts: LessonPart[] = []
  let lessonSlides: LessonSlide[] = []
  let selectedPartId = selected?.partId ?? null
  let legacyContentWarning: Error | null = null

  if (selectedParashaId && selectedSectionId) {
    const { data: groupData, error: groupError } = await supabase
      .from('lesson_groups')
      .select('id, admin_id, parasha_id, section_id')
      .eq('admin_id', session?.id ?? -1)
      .eq('parasha_id', selectedParashaId)
      .eq('section_id', selectedSectionId)
      .maybeSingle()

    if (groupError) {
        return {
          parashot: availableParashot,
          sections: availableSections,
          students: visibleStudents,
          admins: availableAdmins,
          managerByStudentId,
          lessonGroup: null,
          lessonParts: [],
          lessonSlides: [],
          selectedParashaId,
          selectedSectionId,
          selectedPartId,
          parashaSources: [] as ParashaSource[],
          error: groupError ?? relationshipWarning,
        }
      }

    lessonGroup = (groupData ?? null) as AdminLessonGroup | null

    if (!lessonGroup && session?.role === 'primary') {
      const { data: legacyGroupData, error: legacyGroupError } = await supabase
        .from('lesson_groups')
        .select('id, admin_id, parasha_id, section_id')
        .is('admin_id', null)
        .eq('parasha_id', selectedParashaId)
        .eq('section_id', selectedSectionId)
        .maybeSingle()

      if (legacyGroupError) {
        return {
          parashot: availableParashot,
          sections: availableSections,
          students: visibleStudents,
          admins: availableAdmins,
          managerByStudentId,
          lessonGroup: null,
          lessonParts: [],
          lessonSlides: [],
          selectedParashaId,
          selectedSectionId,
          selectedPartId,
          parashaSources: [] as ParashaSource[],
          error: legacyGroupError ?? relationshipWarning,
        }
      }

      lessonGroup = (legacyGroupData ?? null) as AdminLessonGroup | null

      if (lessonGroup) {
        legacyContentWarning = new Error(
          'מוצג כאן מבנה ישן שעדיין לא שויך למנהל. הנתונים לא נמחקו; פשוט צריך לשייך או להעתיק אותם למבנה החדש.'
        )
      }
    }

    if (lessonGroup) {
      const { data: partData, error: partsError } = await supabase
        .from('lesson_parts')
        .select(
          'id, lesson_group_id, name, part_order, is_full_reading, audio_url, duration_seconds'
        )
        .eq('lesson_group_id', lessonGroup.id)
        .order('part_order', { ascending: true })

      if (partsError) {
        return {
          parashot: availableParashot,
          sections: availableSections,
          students: visibleStudents,
          admins: availableAdmins,
          managerByStudentId,
          lessonGroup,
          lessonParts: [],
          lessonSlides: [],
          selectedParashaId,
          selectedSectionId,
          selectedPartId,
          parashaSources: [] as ParashaSource[],
          error: partsError ?? relationshipWarning,
        }
      }

      lessonParts = (partData ?? []) as LessonPart[]
      selectedPartId = selectedPartId ?? lessonParts[0]?.id ?? null

      if (selectedPartId) {
        const { data: slidesData, error: slidesError } = await supabase
          .from('lesson_slides')
          .select('id, lesson_part_id, image_url, slide_index, start_second')
          .eq('lesson_part_id', selectedPartId)
          .order('slide_index', { ascending: true })

        if (slidesError) {
          return {
            parashot: availableParashot,
            sections: availableSections,
            students: visibleStudents,
            admins: availableAdmins,
            managerByStudentId,
            lessonGroup,
            lessonParts,
            lessonSlides: [],
            selectedParashaId,
            selectedSectionId,
            selectedPartId,
            parashaSources: [] as ParashaSource[],
            error: slidesError ?? relationshipWarning,
          }
        }

        lessonSlides = (slidesData ?? []) as LessonSlide[]
      }
    }
  }

  let parashaSources: ParashaSource[] = []

  if (selectedParashaId && session?.id) {
    const { data: sourceRows } = await supabase
      .from('lesson_groups')
      .select('admin_id, admins!inner(id, username, display_name)')
      .eq('parasha_id', selectedParashaId)
      .neq('admin_id', session.id)

    const uniqueSources = new Map<number, ParashaSource>()

    for (const row of (sourceRows ?? []) as Array<{
      admin_id: number
      admins:
        | { id: number; username: string; display_name: string }
        | { id: number; username: string; display_name: string }[]
    }>) {
      const admin = Array.isArray(row.admins) ? row.admins[0] : row.admins

      if (admin && !uniqueSources.has(admin.id)) {
        uniqueSources.set(admin.id, {
          adminId: admin.id,
          username: admin.username,
          displayName: admin.display_name,
        })
      }
    }

    parashaSources = Array.from(uniqueSources.values())
  }

  return {
    parashot: availableParashot,
    sections: availableSections,
    students: visibleStudents,
    admins: availableAdmins,
    managerByStudentId,
    lessonGroup,
    lessonParts,
    lessonSlides,
    selectedParashaId,
    selectedSectionId,
    selectedPartId,
    parashaSources,
    error: legacyContentWarning ?? relationshipWarning,
  }
}
