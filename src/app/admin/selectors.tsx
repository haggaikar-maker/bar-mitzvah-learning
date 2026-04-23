'use client'

import type { ReactNode } from 'react'
import { useMemo, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { AdminSection, AdminTeacherParasha } from '@/lib/admin-data'
import type { LessonPart } from '@/lib/practice-data'

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
}

export function AdminQueryForm({
  children,
  className,
  hash,
}: AdminQueryFormProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault()

        const formData = new FormData(event.currentTarget)
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
      }}
    >
      {children}
    </form>
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
  const [, startTransition] = useTransition()
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
  )
}
