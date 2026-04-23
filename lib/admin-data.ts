import { supabase } from '@/lib/supabase'
import type { AdminSession } from '@/lib/admin-auth'
import type { LessonPart, LessonSlide, Section, Student } from '@/lib/practice-data'
import { getLessonMediaKind, type LessonMediaKind } from '@/lib/lesson-media'
import { createSignedStorageUrl } from '@/lib/storage-files'

export type AdminParasha = {
  id: number
  name: string
}

export type AdminTeacherParasha = {
  id: number
  owner_admin_id: number
  owner_display_name: string
  parasha_id: number
  parasha_name: string
  nusach_id: number
  nusach_name: string
  variant_number: number
  status: 'draft' | 'active' | 'frozen' | 'archived'
  freeze_reason: string | null
  internal_display_name: string
  student_display_name: string
  source_teacher_parasha_id?: number | null
}

export type AdminNusach = {
  id: number
  slug: string
  name: string
  is_active: boolean
}

export type AdminSection = Section

export type AdminStudent = Student

export type AdminLessonGroup = {
  id: number
  admin_id?: number | null
  parasha_id: number
  section_id: number
  completion_target?: number | null
}

export type AdminRecord = {
  id: number
  username: string
  display_name: string
  role: 'primary' | 'teacher'
  city?: string | null
  email?: string | null
  status?: string | null
}

export type ParashaSource = {
  teacherParashaId: number
  adminId: number
  username?: string
  displayName: string
  internalDisplayName: string
  nusachName?: string
  importablePartCount: number
  importableParts: ParashaSourcePart[]
  immediateSourceDisplayName?: string | null
  rootSourceDisplayName?: string | null
}

export type ParashaSourcePart = {
  lessonPartId: number
  teacherParashaId: number
  sectionId: number
  sectionName: string
  partName: string
  partOrder: number
  mediaKind: LessonMediaKind
  durationSeconds: number | null
  slideCount: number
}

export type StudentTrackingRow = {
  lessonPartId: number
  sectionName: string
  partName: string
  partOrder: number
  mediaKind: LessonMediaKind
  isVisibleToStudent: boolean
  baseVisibility: boolean
  completionTarget: number
  hasAudio: boolean
  hasVideo: boolean
  slideCount: number
  practiceCount: number
  completedCount: number
  lastPracticedAt: string | null
  studentRecording: {
    id: number
    durationSeconds: number | null
    createdAt: string
    signedUrl: string | null
  } | null
}

export type StudentTrackingSummary = {
  student: AdminStudent
  rows: StudentTrackingRow[]
}

function resolveTeacherParashaChain(
  teacherParashaId: number,
  teacherParashaById: Map<
    number,
    {
      id: number
      ownerDisplayName: string
      sourceTeacherParashaId: number | null
    }
  >
) {
  const visited = new Set<number>()
  const chain: Array<{
    id: number
    ownerDisplayName: string
  }> = []
  let currentId: number | null = teacherParashaId

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const current = teacherParashaById.get(currentId)

    if (!current) {
      break
    }

    chain.push({
      id: current.id,
      ownerDisplayName: current.ownerDisplayName,
    })
    currentId = current.sourceTeacherParashaId ?? null
  }

  return chain
}

export async function getAdminDashboardData(selected?: {
  parashaId?: number | null
  sectionId?: number | null
  partId?: number | null
  trackingStudentId?: number | null
  ownerAdminId?: number | null
  teacherParashaStatus?: string | null
  baseParashaFilterId?: number | null
  nusachFilterId?: number | null
}, session?: AdminSession) {
  const [
    { data: parashot, error: parashotError },
    { data: sections, error: sectionsError },
    { data: students, error: studentsError },
    { data: teacherParashaCatalog, error: teacherParashaError },
    { data: nusachim, error: nusachimError },
  ] =
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
      supabase
        .from('teacher_parasha_catalog_view')
        .select('*')
        .order('owner_display_name', { ascending: true })
        .order('parasha_name', { ascending: true })
        .order('variant_number', { ascending: true }),
      supabase
        .from('nusachim')
        .select('id, slug, name, is_active')
        .order('name', { ascending: true }),
    ])

  if (parashotError || sectionsError || studentsError || teacherParashaError || nusachimError) {
    return {
      parashot: [] as AdminParasha[],
      teacherParashot: [] as AdminTeacherParasha[],
      nusachim: [] as AdminNusach[],
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
      selectedTrackingStudentId: selected?.trackingStudentId ?? null,
      trackingSummary: null as StudentTrackingSummary | null,
      parashaSources: [] as ParashaSource[],
      error: parashotError ?? sectionsError ?? studentsError ?? teacherParashaError ?? nusachimError,
    }
  }

  const availableParashot = (parashot ?? []) as AdminParasha[]
  const availableSections = (sections ?? []) as AdminSection[]
  const availableStudents = (students ?? []) as AdminStudent[]
  const rawTeacherParashot = (teacherParashaCatalog ?? []) as AdminTeacherParasha[]
  const availableNusachim = (nusachim ?? []) as AdminNusach[]
  const { data: adminsWithContact, error: adminsWithContactError } = await supabase
    .from('admins')
    .select('id, username, display_name, role, city, email, status')
    .order('display_name', { ascending: true })

  let availableAdmins: AdminRecord[] = []
  let relationshipWarning: Error | null = null

  if (adminsWithContactError) {
    const { data: adminsFallback, error: adminsFallbackError } = await supabase
      .from('admins')
      .select('id, username, display_name, role, status')
      .order('display_name', { ascending: true })

    if (adminsFallbackError) {
      relationshipWarning = new Error(
        'טבלת המנהלים עדיין לא זמינה, לכן ייתכן שחלק מפעולות הניהול לא יוצגו.'
      )
    } else {
      availableAdmins = ((adminsFallback ?? []) as AdminRecord[]).map((admin) => ({
        ...admin,
        role: admin.role === 'teacher' ? 'teacher' : 'primary',
        city: null,
        email: null,
      }))
      relationshipWarning = new Error(
        'שדות העיר והאימייל של המלמדים עדיין לא נוספו לבסיס הנתונים. כדי להשתמש בהם צריך להריץ את עדכון ה-SQL החדש.'
      )
    }
  } else {
    availableAdmins = ((adminsWithContact ?? []) as AdminRecord[]).map((admin) => ({
      ...admin,
      role: admin.role === 'teacher' ? 'teacher' : 'primary',
    }))
  }

  const { data: teacherParashaLinks, error: teacherParashaLinksError } = await supabase
    .from('teacher_parashot')
    .select('id, source_teacher_parasha_id')

  if (teacherParashaLinksError) {
    return {
      parashot: availableParashot,
      teacherParashot: [] as AdminTeacherParasha[],
      nusachim: availableNusachim,
      sections: availableSections,
      students: [] as AdminStudent[],
      admins: availableAdmins,
      managerByStudentId: {} as Record<number, number | null>,
      lessonGroup: null as AdminLessonGroup | null,
      lessonParts: [] as LessonPart[],
      lessonSlides: [] as LessonSlide[],
      selectedParashaId: selected?.parashaId ?? null,
      selectedSectionId: selected?.sectionId ?? null,
      selectedPartId: selected?.partId ?? null,
      selectedTrackingStudentId: selected?.trackingStudentId ?? null,
      trackingSummary: null as StudentTrackingSummary | null,
      parashaSources: [] as ParashaSource[],
      error: teacherParashaLinksError,
    }
  }

  const teacherParashaLinkById = new Map(
    ((teacherParashaLinks ?? []) as Array<{
      id: number
      source_teacher_parasha_id: number | null
    }>).map((row) => [row.id, row.source_teacher_parasha_id ?? null])
  )
  const allTeacherParashot = rawTeacherParashot.map((item) => ({
    ...item,
    source_teacher_parasha_id: teacherParashaLinkById.get(item.id) ?? null,
  }))

  const { data: assignmentRows, error: assignmentRowsError } = await supabase
    .from('student_teacher_parasha_assignments')
    .select(
      `
        student_id,
        teacher_parasha_id,
        status,
        teacher_parashot (
          id,
          owner_admin_id,
          parasha_id,
          nusach_id,
          status,
          variant_number,
          freeze_reason,
          parashot (
            id,
            name
          )
        )
      `
    )
    .eq('status', 'active')

  if (assignmentRowsError) {
    return {
      parashot: availableParashot,
      teacherParashot: [] as AdminTeacherParasha[],
      nusachim: availableNusachim,
      sections: availableSections,
      students: [] as AdminStudent[],
      admins: availableAdmins,
      managerByStudentId: {} as Record<number, number | null>,
      lessonGroup: null,
      lessonParts: [],
      lessonSlides: [],
      selectedParashaId: selected?.parashaId ?? null,
      selectedSectionId: selected?.sectionId ?? null,
      selectedPartId: selected?.partId ?? null,
      selectedTrackingStudentId: selected?.trackingStudentId ?? null,
      trackingSummary: null,
      parashaSources: [],
      error: assignmentRowsError,
    }
  }

  const assignmentByStudentId = new Map<
    number,
    {
      teacherParashaId: number
      ownerAdminId: number | null
      parashaId: number | null
    }
  >()

  for (const row of (assignmentRows ?? []) as Array<{
    student_id: number
    teacher_parasha_id: number
    teacher_parashot:
      | {
          id: number
          owner_admin_id: number
          parasha_id: number
        }
      | {
          id: number
          owner_admin_id: number
          parasha_id: number
        }[]
      | null
  }>) {
    const teacherParasha = Array.isArray(row.teacher_parashot)
      ? row.teacher_parashot[0]
      : row.teacher_parashot

    assignmentByStudentId.set(row.student_id, {
      teacherParashaId: row.teacher_parasha_id,
      ownerAdminId: teacherParasha?.owner_admin_id ?? null,
      parashaId: teacherParasha?.parasha_id ?? null,
    })
  }

  const hydratedStudents = availableStudents.map((student) => {
    const assignment = assignmentByStudentId.get(student.id)
    return {
      ...student,
      active_teacher_parasha_id: assignment?.teacherParashaId ?? null,
      admin_id: assignment?.ownerAdminId ?? student.admin_id ?? null,
      parasha_id: assignment?.parashaId ?? student.parasha_id ?? null,
    }
  })

  const visibleStudents =
    session?.role === 'teacher' && session.id
      ? hydratedStudents.filter((student) => student.admin_id === session.id)
      : session?.role === 'primary'
        ? hydratedStudents
      : hydratedStudents

  const managerByStudentId = Object.fromEntries(
    hydratedStudents.map((student) => [student.id, student.admin_id ?? null])
  ) as Record<number, number | null>

  const visibleTeacherParashot =
    session?.role === 'teacher' && session.id
      ? allTeacherParashot.filter((item) => item.owner_admin_id === session.id)
      : allTeacherParashot

  const filteredTeacherParashot = visibleTeacherParashot.filter((item) => {
    if (selected?.ownerAdminId && item.owner_admin_id !== selected.ownerAdminId) {
      return false
    }

    if (selected?.baseParashaFilterId && item.parasha_id !== selected.baseParashaFilterId) {
      return false
    }

    if (selected?.nusachFilterId && item.nusach_id !== selected.nusachFilterId) {
      return false
    }

    if (
      selected?.teacherParashaStatus &&
      selected.teacherParashaStatus !== 'all' &&
      item.status !== selected.teacherParashaStatus
    ) {
      return false
    }

    return true
  })

  const selectedParashaId =
    selected?.parashaId ?? filteredTeacherParashot[0]?.id ?? null
  const selectedSectionId =
    selected?.sectionId ?? availableSections[0]?.id ?? null
  const selectedTrackingStudentId =
    selected?.trackingStudentId ?? visibleStudents[0]?.id ?? null

  let lessonGroup: AdminLessonGroup | null = null
  let lessonParts: LessonPart[] = []
  let lessonSlides: LessonSlide[] = []
  let selectedPartId = selected?.partId ?? null
  let trackingSummary: StudentTrackingSummary | null = null

  const selectedTeacherParasha =
    filteredTeacherParashot.find((item) => item.id === selectedParashaId) ??
    visibleTeacherParashot.find((item) => item.id === selectedParashaId) ??
    null

  if (selectedParashaId && selectedSectionId) {
    const { data: groupData, error: groupError } = await supabase
      .from('lesson_groups')
      .select('*')
      .eq('teacher_parasha_id', selectedParashaId)
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
          selectedTrackingStudentId,
          trackingSummary,
          parashaSources: [] as ParashaSource[],
          error: groupError ?? relationshipWarning,
        }
      }

    lessonGroup = (groupData ?? null) as AdminLessonGroup | null

    if (lessonGroup) {
      const { data: partData, error: partsError } = await supabase
        .from('lesson_parts')
        .select('*')
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
            selectedTrackingStudentId,
            trackingSummary,
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
            selectedTrackingStudentId,
            trackingSummary,
            parashaSources: [] as ParashaSource[],
            error: slidesError ?? relationshipWarning,
          }
        }

        lessonSlides = (slidesData ?? []) as LessonSlide[]
      }
    }
  }

  let parashaSources: ParashaSource[] = []

  if (selectedTeacherParasha) {
    const relevantSources = allTeacherParashot.filter(
      (item) =>
        item.parasha_id === selectedTeacherParasha.parasha_id &&
        item.nusach_id === selectedTeacherParasha.nusach_id &&
        item.id !== selectedTeacherParasha.id
    )

    const usernameByAdminId = new Map(availableAdmins.map((admin) => [admin.id, admin.username]))
    const teacherParashaById = new Map(
      allTeacherParashot.map((item) => [
        item.id,
        {
          id: item.id,
          ownerDisplayName: item.owner_display_name,
          sourceTeacherParashaId: item.source_teacher_parasha_id ?? null,
        },
      ])
    )

    const relevantSourceIds = relevantSources.map((source) => source.id)

    if (relevantSourceIds.length > 0) {
      const { data: sourceGroups, error: sourceGroupsError } = await supabase
        .from('lesson_groups')
        .select('id, teacher_parasha_id, section_id')
        .in('teacher_parasha_id', relevantSourceIds)

      if (sourceGroupsError) {
        return {
          parashot: availableParashot,
          teacherParashot: filteredTeacherParashot,
          nusachim: availableNusachim,
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
          selectedTrackingStudentId,
          trackingSummary,
          parashaSources: [] as ParashaSource[],
          error: sourceGroupsError,
        }
      }

      const sourceGroupRows =
        (sourceGroups ?? []) as Array<{
          id: number
          teacher_parasha_id: number
          section_id: number
        }>
      const sourceGroupIds = sourceGroupRows.map((group) => group.id)

      if (sourceGroupIds.length > 0) {
        const { data: sourceParts, error: sourcePartsError } = await supabase
          .from('lesson_parts')
          .select(
            'id, lesson_group_id, name, part_order, media_kind, audio_url, video_url, duration_seconds'
          )
          .in('lesson_group_id', sourceGroupIds)
          .order('part_order', { ascending: true })

        if (sourcePartsError) {
          return {
            parashot: availableParashot,
            teacherParashot: filteredTeacherParashot,
            nusachim: availableNusachim,
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
            selectedTrackingStudentId,
            trackingSummary,
            parashaSources: [] as ParashaSource[],
            error: sourcePartsError,
          }
        }

        const sourcePartRows =
          (sourceParts ?? []) as Array<{
            id: number
            lesson_group_id: number
            name: string
            part_order: number
            media_kind?: LessonMediaKind | string | null
            audio_url: string | null
            video_url?: string | null
            duration_seconds: number | null
          }>
        const sourcePartIds = sourcePartRows.map((part) => part.id)

        const slideCountByPartId = new Map<number, number>()

        if (sourcePartIds.length > 0) {
          const { data: sourceSlides, error: sourceSlidesError } = await supabase
            .from('lesson_slides')
            .select('lesson_part_id')
            .in('lesson_part_id', sourcePartIds)

          if (sourceSlidesError) {
            return {
              parashot: availableParashot,
              teacherParashot: filteredTeacherParashot,
              nusachim: availableNusachim,
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
              selectedTrackingStudentId,
              trackingSummary,
              parashaSources: [] as ParashaSource[],
              error: sourceSlidesError,
            }
          }

          for (const row of (sourceSlides ?? []) as Array<{ lesson_part_id: number }>) {
            slideCountByPartId.set(
              row.lesson_part_id,
              (slideCountByPartId.get(row.lesson_part_id) ?? 0) + 1
            )
          }
        }

        const sectionNameById = new Map(
          availableSections.map((section) => [section.id, section.name])
        )
        const groupById = new Map(sourceGroupRows.map((group) => [group.id, group]))
        const importablePartsByTeacherParashaId = new Map<number, ParashaSourcePart[]>()

        for (const part of sourcePartRows) {
          const group = groupById.get(part.lesson_group_id)

          if (!group) {
            continue
          }

          const mediaKind = getLessonMediaKind(part)
          const slideCount = slideCountByPartId.get(part.id) ?? 0
          const isImportable =
            mediaKind === 'video'
              ? Boolean(part.video_url)
              : Boolean(part.audio_url) && slideCount > 0

          if (!isImportable) {
            continue
          }

          const current = importablePartsByTeacherParashaId.get(group.teacher_parasha_id) ?? []
          current.push({
            lessonPartId: part.id,
            teacherParashaId: group.teacher_parasha_id,
            sectionId: group.section_id,
            sectionName: sectionNameById.get(group.section_id) ?? 'ללא חלק',
            partName: part.name,
            partOrder: part.part_order,
            mediaKind,
            durationSeconds: part.duration_seconds,
            slideCount,
          })
          importablePartsByTeacherParashaId.set(group.teacher_parasha_id, current)
        }

        parashaSources = relevantSources
          .map((source) => {
            const importableParts =
              importablePartsByTeacherParashaId.get(source.id)?.sort((a, b) => {
                if (a.sectionId !== b.sectionId) {
                  return a.sectionId - b.sectionId
                }

                return a.partOrder - b.partOrder
              }) ?? []

            return {
              teacherParashaId: source.id,
              adminId: source.owner_admin_id,
              username: usernameByAdminId.get(source.owner_admin_id),
              displayName: source.owner_display_name,
              internalDisplayName: source.internal_display_name,
              nusachName: source.nusach_name,
              importablePartCount: importableParts.length,
              importableParts,
              immediateSourceDisplayName:
                source.source_teacher_parasha_id
                  ? teacherParashaById.get(source.source_teacher_parasha_id)?.ownerDisplayName ?? null
                  : null,
              rootSourceDisplayName: (() => {
                const chain = resolveTeacherParashaChain(source.id, teacherParashaById)
                return chain.length > 1 ? chain[chain.length - 1]?.ownerDisplayName ?? null : null
              })(),
            }
          })
          .filter((source) => source.importablePartCount > 0)
      }
    }
  }

  const trackingStudent =
    visibleStudents.find((student) => student.id === selectedTrackingStudentId) ?? null

  if (trackingStudent?.active_teacher_parasha_id || (trackingStudent?.admin_id && trackingStudent.parasha_id)) {
    const { data: trackingGroups, error: trackingGroupsError } = await supabase
      .from('lesson_groups')
      .select('*')
      .match(
        trackingStudent.active_teacher_parasha_id
          ? { teacher_parasha_id: trackingStudent.active_teacher_parasha_id }
          : {
              admin_id: trackingStudent.admin_id,
              parasha_id: trackingStudent.parasha_id,
            }
      )

    if (trackingGroupsError) {
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
        selectedTrackingStudentId,
        trackingSummary,
        parashaSources,
        error: trackingGroupsError,
      }
    }

    const groups = (trackingGroups ?? []) as AdminLessonGroup[]
    const sectionNameById = new Map(availableSections.map((section) => [section.id, section.name]))
    const groupIds = groups.map((group) => group.id)

    if (groupIds.length > 0) {
      const { data: trackingParts, error: trackingPartsError } = await supabase
        .from('lesson_parts')
        .select('*')
        .in('lesson_group_id', groupIds)
        .order('part_order', { ascending: true })

      if (trackingPartsError) {
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
          selectedTrackingStudentId,
          trackingSummary,
          parashaSources,
          error: trackingPartsError,
        }
      }

      const parts = (trackingParts ?? []) as LessonPart[]
      const partIds = parts.map((part) => part.id)

      const [
        { data: slidesData, error: slidesError },
        { data: practiceEvents, error: practiceEventsError },
        { data: studentRecordings, error: studentRecordingsError },
        { data: partSettings, error: partSettingsError },
      ] =
        await Promise.all([
          partIds.length
            ? supabase
                .from('lesson_slides')
                .select('lesson_part_id')
                .in('lesson_part_id', partIds)
            : Promise.resolve({ data: [], error: null }),
          partIds.length
            ? supabase
                .from('practice_events')
                .select('lesson_part_id, completed, created_at')
                .eq('student_id', trackingStudent.id)
                .in('lesson_part_id', partIds)
                .order('created_at', { ascending: false })
            : Promise.resolve({ data: [], error: null }),
          partIds.length
            ? supabase
                .from('student_recordings')
                .select('id, lesson_part_id, storage_path, duration_seconds, created_at')
                .eq('student_id', trackingStudent.id)
                .in('lesson_part_id', partIds)
            : Promise.resolve({ data: [], error: null }),
          partIds.length
            ? supabase
                .from('student_lesson_part_settings')
                .select('lesson_part_id, is_visible_to_student')
                .eq('student_id', trackingStudent.id)
                .in('lesson_part_id', partIds)
            : Promise.resolve({ data: [], error: null }),
        ])

      if (slidesError || practiceEventsError || studentRecordingsError || partSettingsError) {
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
          selectedTrackingStudentId,
          trackingSummary,
          parashaSources,
          error: slidesError ?? practiceEventsError ?? studentRecordingsError ?? partSettingsError,
        }
      }

      const slideCountByPartId = new Map<number, number>()

      for (const row of (slidesData ?? []) as Array<{ lesson_part_id: number }>) {
        slideCountByPartId.set(
          row.lesson_part_id,
          (slideCountByPartId.get(row.lesson_part_id) ?? 0) + 1
        )
      }

      const eventsByPartId = new Map<
        number,
        Array<{ lesson_part_id: number; completed: boolean; created_at: string }>
      >()

      for (const event of
        (practiceEvents ?? []) as Array<{
          lesson_part_id: number
          completed: boolean
          created_at: string
        }>) {
        const current = eventsByPartId.get(event.lesson_part_id) ?? []
        current.push(event)
        eventsByPartId.set(event.lesson_part_id, current)
      }

      const groupById = new Map(groups.map((group) => [group.id, group]))
      const recordingByPartId = new Map<
        number,
        {
          id: number
          duration_seconds: number | null
          created_at: string
          storage_path: string
        }
      >()

      for (const recording of
        (studentRecordings ?? []) as Array<{
          id: number
          lesson_part_id: number
          storage_path: string
          duration_seconds: number | null
          created_at: string
        }>) {
        recordingByPartId.set(recording.lesson_part_id, recording)
      }

      const studentVisibilityByPartId = new Map<number, boolean>(
        ((partSettings ?? []) as Array<{
          lesson_part_id: number
          is_visible_to_student: boolean
        }>).map((row) => [row.lesson_part_id, row.is_visible_to_student])
      )

      const rows = await Promise.all(
        parts.map(async (part) => {
          const events = eventsByPartId.get(part.id) ?? []
          const group = groupById.get(part.lesson_group_id)
          const recording = recordingByPartId.get(part.id)
          const mediaKind = getLessonMediaKind(part)
          let signedUrl: string | null = null

          if (recording?.storage_path) {
            try {
              signedUrl = await createSignedStorageUrl(
                'student-recordings',
                recording.storage_path
              )
            } catch {
              signedUrl = null
            }
          }

          return {
            lessonPartId: part.id,
            sectionName: sectionNameById.get(group?.section_id ?? -1) ?? 'ללא חלק',
            partName: part.name,
            partOrder: part.part_order,
            mediaKind,
            isVisibleToStudent:
              (part.is_visible_to_student ?? true) &&
              (studentVisibilityByPartId.get(part.id) ?? true),
            baseVisibility: part.is_visible_to_student ?? true,
            completionTarget: Math.max(part.completion_target ?? 3, 1),
            hasAudio: Boolean(part.audio_url),
            hasVideo: Boolean(part.video_url),
            slideCount: slideCountByPartId.get(part.id) ?? 0,
            practiceCount: events.length,
            completedCount: events.filter((event) => event.completed).length,
            lastPracticedAt: events[0]?.created_at ?? null,
            studentRecording: recording
              ? {
                  id: recording.id,
                  durationSeconds: recording.duration_seconds,
                  createdAt: recording.created_at,
                  signedUrl,
                }
              : null,
          }
        })
      )

      trackingSummary = {
        student: trackingStudent,
        rows,
      }
    } else {
      trackingSummary = {
        student: trackingStudent,
        rows: [],
      }
    }
  } else if (trackingStudent) {
    trackingSummary = {
      student: trackingStudent,
      rows: [],
    }
  }

  return {
    parashot: availableParashot,
    teacherParashot: filteredTeacherParashot,
    allTeacherParashot: visibleTeacherParashot,
    nusachim: availableNusachim,
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
    selectedTrackingStudentId,
    trackingSummary,
    parashaSources,
    error: relationshipWarning,
  }
}
