'use client'

import type { ReactNode } from 'react'
import { useMemo, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { AdminRecord, AdminSection, AdminTeacherParasha } from '@/lib/admin-data'
import type { LessonPart } from '@/lib/practice-data'
import { CenteredLoadingState } from '../../components/centered-loading-state'

type SectionContentSummary = {
  sectionId: number
  partCount: number
  hasContent: boolean
}

type AdminContentSelectorProps = {
  teacherParashot: AdminTeacherParasha[]
  sections: AdminSection[]
  sectionSummaries: SectionContentSummary[]
  lessonParts: LessonPart[]
  selectedParashaId: number | null
  selectedSectionId: number | null
  selectedPartId: number | null
}

type AdminQueryFormProps = {
  children: ReactNode
  className?: string
  hash?: string
  autoSubmitOnChange?: boolean
}

type AdminEditorNavigatorStudent = {
  id: number
  name: string
  admin_id: number | null
  active_teacher_parasha_id?: number | null
}

type AdminEditorNavigatorProps = {
  admins: AdminRecord[]
  students: AdminEditorNavigatorStudent[]
  teacherParashot: AdminTeacherParasha[]
  selectedOwnerAdminId: number | null
  selectedStudentId: number | null
  selectedParashaId: number | null
}

export function AdminQueryForm({
  children,
  className,
  hash,
  autoSubmitOnChange = false,
}: AdminQueryFormProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  function navigateWithForm(formData: FormData) {
    const nextParams = new URLSearchParams(searchParams.toString())

    for (const [key, value] of formData.entries()) {
      const normalizedValue = typeof value === 'string' ? value.trim() : ''

      if (normalizedValue) {
        nextParams.set(key, normalizedValue)
      } else {
        nextParams.delete(key)
      }
    }

    startTransition(() => {
      router.replace(
        `${pathname}?${nextParams.toString()}${hash ? `#${hash}` : ''}`,
        { scroll: false }
      )
    })
  }

  return (
    <>
      <form
        className={className}
        onSubmit={(event) => {
          event.preventDefault()

          navigateWithForm(new FormData(event.currentTarget))
        }}
        onChange={(event) => {
          if (!autoSubmitOnChange) {
            return
          }

          const target = event.target
          if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) {
            return
          }

          if (!target.form) {
            return
          }

          navigateWithForm(new FormData(target.form))
        }}
      >
        {children}
      </form>
      {isPending ? (
        <CenteredLoadingState
          label="טוען..."
          subtitle="מעדכן את הסינון והנתונים על המסך"
        />
      ) : null}
    </>
  )
}

export function AdminEditorNavigator({
  admins,
  students,
  teacherParashot,
  selectedOwnerAdminId,
  selectedStudentId,
  selectedParashaId,
}: AdminEditorNavigatorProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const selectedOwnerAdminIdValue = selectedOwnerAdminId?.toString() ?? 'all'
  const selectedStudentIdValue = selectedStudentId?.toString() ?? ''
  const selectedParashaIdValue = selectedParashaId?.toString() ?? ''

  const filteredStudents = useMemo(
    () =>
      selectedOwnerAdminId
        ? students.filter((student) => student.admin_id === selectedOwnerAdminId)
        : students,
    [selectedOwnerAdminId, students]
  )

  const filteredTeacherParashot = useMemo(
    () =>
      selectedOwnerAdminId
        ? teacherParashot.filter((teacherParasha) => teacherParasha.owner_admin_id === selectedOwnerAdminId)
        : teacherParashot,
    [selectedOwnerAdminId, teacherParashot]
  )

  function replaceParams(updates: Record<string, string | null | undefined>) {
    const nextParams = new URLSearchParams(searchParams.toString())

    for (const [key, value] of Object.entries(updates)) {
      if (value && value.trim()) {
        nextParams.set(key, value)
      } else {
        nextParams.delete(key)
      }
    }

    startTransition(() => {
      router.replace(`${pathname}?${nextParams.toString()}#content-editor`, {
        scroll: false,
      })
    })
  }

  return (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        <select
          value={selectedOwnerAdminIdValue}
          onChange={(event) => {
            const nextOwnerAdminId = event.target.value
            replaceParams({
              ownerAdminId: nextOwnerAdminId || null,
              studentId: null,
              parashaId: null,
              sectionId: null,
              partId: null,
            })
          }}
          className="rounded-2xl border border-slate-200 px-4 py-3"
        >
          <option value="all">כל המלמדים</option>
          {admins.map((admin) => (
            <option key={admin.id} value={admin.id}>
              {admin.display_name}
            </option>
          ))}
        </select>

        <select
          value={selectedStudentIdValue}
          onChange={(event) => {
            const nextStudentId = event.target.value
            const selectedStudent = students.find((student) => student.id === Number(nextStudentId))

            replaceParams({
              ownerAdminId: selectedStudent?.admin_id ? String(selectedStudent.admin_id) : selectedOwnerAdminIdValue || 'all',
              studentId: nextStudentId || null,
              parashaId: selectedStudent?.active_teacher_parasha_id
                ? String(selectedStudent.active_teacher_parasha_id)
                : null,
              sectionId: null,
              partId: null,
            })
          }}
          className="rounded-2xl border border-slate-200 px-4 py-3"
        >
          <option value="">בחירת תלמיד</option>
          {filteredStudents.map((student) => (
            <option key={student.id} value={student.id}>
              {student.name}
            </option>
          ))}
        </select>

        <select
          value={selectedParashaIdValue}
          onChange={(event) => {
            replaceParams({
              parashaId: event.target.value || null,
              sectionId: null,
              partId: null,
            })
          }}
          className="rounded-2xl border border-slate-200 px-4 py-3"
        >
          <option value="">בחירת ספריית פרשה</option>
          {filteredTeacherParashot.map((teacherParasha) => (
            <option key={teacherParasha.id} value={teacherParasha.id}>
              {teacherParasha.internal_display_name} | {teacherParasha.owner_display_name} | {teacherParasha.nusach_name}
            </option>
          ))}
        </select>
      </div>
      {isPending ? (
        <CenteredLoadingState
          label="טוען עריכה..."
          subtitle="מעדכן את המלמד, התלמיד והספרייה לעריכה"
        />
      ) : null}
    </>
  )
}

export function AdminContentSelector({
  teacherParashot,
  sections,
  sectionSummaries,
  lessonParts,
  selectedParashaId,
  selectedSectionId,
  selectedPartId,
}: AdminContentSelectorProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const parashaId = selectedParashaId?.toString() ?? ''
  const sectionId = selectedSectionId?.toString() ?? ''
  const partId = selectedPartId?.toString() ?? ''

  const sectionSummaryById = useMemo(
    () => new Map(sectionSummaries.map((summary) => [summary.sectionId, summary])),
    [sectionSummaries]
  )

  function navigate(next: {
    parashaId?: string
    sectionId?: string
    partId?: string
  }) {
    const nextParams = new URLSearchParams(searchParams.toString())
    const nextParashaId = next.parashaId ?? parashaId
    const nextSectionId = next.sectionId ?? sectionId
    const nextPartId = next.partId ?? partId

    if (nextParashaId) {
      nextParams.set('parashaId', nextParashaId)
    } else {
      nextParams.delete('parashaId')
    }

    if (nextSectionId) {
      nextParams.set('sectionId', nextSectionId)
    } else {
      nextParams.delete('sectionId')
    }

    if (nextPartId) {
      nextParams.set('partId', nextPartId)
    } else {
      nextParams.delete('partId')
    }

    startTransition(() => {
      router.replace(`${pathname}?${nextParams.toString()}#content-editor`, {
        scroll: false,
      })
    })
  }

  return (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        <select
          value={parashaId}
          onChange={(event) => {
            const nextParashaId = event.target.value
            navigate({ parashaId: nextParashaId, partId: '' })
          }}
          className="rounded-2xl border border-slate-200 px-4 py-3"
        >
          {teacherParashot.length === 0 ? <option value="">אין ספריות זמינות</option> : null}
          {teacherParashot.map((parasha) => (
            <option key={parasha.id} value={parasha.id}>
              {parasha.internal_display_name} | {parasha.owner_display_name} | {parasha.nusach_name}
            </option>
          ))}
        </select>

        <select
          value={sectionId}
          onChange={(event) => {
            const nextSectionId = event.target.value
            navigate({ sectionId: nextSectionId, partId: '' })
          }}
          className="rounded-2xl border border-slate-200 px-4 py-3"
        >
          {sections.map((section) => (
            <option key={section.id} value={section.id}>
              {(() => {
                const summary = sectionSummaryById.get(section.id)
                if (!summary) {
                  return `${section.name} (0)`
                }

                return summary.hasContent
                  ? `${section.name} *`
                  : `${section.name} (${summary.partCount})`
              })()}
            </option>
          ))}
        </select>

        <select
          value={partId}
          onChange={(event) => {
            const nextPartId = event.target.value
            navigate({ partId: nextPartId })
          }}
          className="rounded-2xl border border-slate-200 px-4 py-3"
        >
          <option value="">בחירת תת־חלק</option>
          {lessonParts.map((part) => (
            <option key={part.id} value={part.id}>
              {part.name}
            </option>
          ))}
        </select>
      </div>
      {isPending ? (
        <CenteredLoadingState
          label="טוען תוכן..."
          subtitle="מכין את הפרשה, הקריאה ותתי־החלקים שבחרת"
        />
      ) : null}
    </>
  )
}
