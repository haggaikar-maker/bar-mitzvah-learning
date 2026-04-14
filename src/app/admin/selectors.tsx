'use client'

import { useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { AdminParasha, AdminSection } from '@/lib/admin-data'
import type { LessonPart } from '@/lib/practice-data'

type AdminContentSelectorProps = {
  parashot: AdminParasha[]
  sections: AdminSection[]
  lessonParts: LessonPart[]
  selectedParashaId: number | null
  selectedSectionId: number | null
  selectedPartId: number | null
}

export function AdminContentSelector({
  parashot,
  sections,
  lessonParts,
  selectedParashaId,
  selectedSectionId,
  selectedPartId,
}: AdminContentSelectorProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const [parashaId, setParashaId] = useState(selectedParashaId?.toString() ?? '')
  const [sectionId, setSectionId] = useState(selectedSectionId?.toString() ?? '')
  const [partId, setPartId] = useState(selectedPartId?.toString() ?? '')

  function handleLoad() {
    const nextParams = new URLSearchParams(searchParams.toString())

    if (parashaId) {
      nextParams.set('parashaId', parashaId)
    } else {
      nextParams.delete('parashaId')
    }

    if (sectionId) {
      nextParams.set('sectionId', sectionId)
    } else {
      nextParams.delete('sectionId')
    }

    if (partId) {
      nextParams.set('partId', partId)
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
    <div className="grid gap-4 md:grid-cols-4">
      <select
        value={parashaId}
        onChange={(event) => setParashaId(event.target.value)}
        className="rounded-2xl border border-slate-200 px-4 py-3"
      >
        {parashot.map((parasha) => (
          <option key={parasha.id} value={parasha.id}>
            {parasha.name}
          </option>
        ))}
      </select>

      <select
        value={sectionId}
        onChange={(event) => setSectionId(event.target.value)}
        className="rounded-2xl border border-slate-200 px-4 py-3"
      >
        {sections.map((section) => (
          <option key={section.id} value={section.id}>
            {section.name}
          </option>
        ))}
      </select>

      <select
        value={partId}
        onChange={(event) => setPartId(event.target.value)}
        className="rounded-2xl border border-slate-200 px-4 py-3"
      >
        <option value="">בחירת תת־חלק</option>
        {lessonParts.map((part) => (
          <option key={part.id} value={part.id}>
            {part.name}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={handleLoad}
        disabled={isPending}
        className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
      >
        {isPending ? 'טוען...' : 'טעינת תוכן'}
      </button>
    </div>
  )
}
