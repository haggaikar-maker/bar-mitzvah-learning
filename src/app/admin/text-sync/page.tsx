import { redirect } from 'next/navigation'
import { getAdminSession } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import TextSyncStudio from './studio'
import './studio.css'

type Nested<T> = T | T[] | null
const first = <T,>(value: Nested<T>): T | null => Array.isArray(value) ? value[0] ?? null : value

export default async function TextSyncPage() {
  const session = await getAdminSession()
  if (!session) redirect('/')
  // New migration tables are not yet part of the generated Supabase TypeScript schema.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseAdmin() as any

  let librariesQuery = db.from('teacher_parashot')
    .select('id, owner_admin_id, parasha_id, parashot(name)')
    .in('status', ['active', 'draft'])
    .order('id', { ascending: false })
  if (session.role !== 'primary' && session.id) librariesQuery = librariesQuery.eq('owner_admin_id', session.id)
  const { data: libraries, error } = await librariesQuery
  const ownerAdminIds = [...new Set((libraries ?? []).map((row: { owner_admin_id: number }) => row.owner_admin_id))]
  const { data: owners, error: ownersError } = ownerAdminIds.length
    ? await db.from('admins').select('id, display_name').in('id', ownerAdminIds)
    : { data: [], error: null }
  const libraryIds = (libraries ?? []).map((row: { id: number }) => row.id)
  const { data: groups } = libraryIds.length
    ? await db.from('lesson_groups').select('id, teacher_parasha_id, section_id').in('teacher_parasha_id', libraryIds)
    : { data: [] }
  const groupIds = (groups ?? []).map((row: { id: number }) => row.id)
  const sectionIds = [...new Set((groups ?? []).map((row: { section_id: number }) => row.section_id))]
  const [{ data: sections }, { data: parts }, { data: assignments }] = await Promise.all([
    sectionIds.length ? db.from('sections').select('id, name, order_index').in('id', sectionIds) : Promise.resolve({ data: [] }),
    groupIds.length ? db.from('lesson_parts').select('id, lesson_group_id, name, part_order').in('lesson_group_id', groupIds).order('part_order') : Promise.resolve({ data: [] }),
    libraryIds.length ? db.from('student_teacher_parasha_assignments').select('student_id, teacher_parasha_id, students(id, name)').in('teacher_parasha_id', libraryIds).eq('status', 'active') : Promise.resolve({ data: [] }),
  ])

  const sectionRows = (sections ?? []) as Array<{ id: number; name: string; order_index: number }>
  const groupRows = (groups ?? []) as Array<{ id: number; teacher_parasha_id: number; section_id: number }>
  const partRows = (parts ?? []) as Array<{ id: number; lesson_group_id: number; name: string; part_order: number }>
  const assignmentRows = (assignments ?? []) as Array<{ student_id: number; teacher_parasha_id: number; students: Nested<{ id: number; name: string }> }>
  const sectionsById = new Map<number, { id: number; name: string; order_index: number }>(sectionRows.map((section) => [section.id, section]))
  const ownersById = new Map<number, string>((owners ?? []).map((owner: { id: number; display_name: string }) => [owner.id, owner.display_name]))
  const librariesDto = (libraries ?? []).map((library: { id: number; owner_admin_id: number; parashot: Nested<{ name: string }> }) => {
    const sectionsDto = groupRows.filter((group) => group.teacher_parasha_id === library.id).map((group) => {
      const section = sectionsById.get(group.section_id)
      return section ? {
        id: section.id,
        name: section.name,
        orderIndex: section.order_index,
        parts: partRows.filter((part) => part.lesson_group_id === group.id).map((part) => ({ id: part.id, name: part.name, order: part.part_order })),
      } : null
    }).filter((section): section is NonNullable<typeof section> => section !== null).sort((a, b) => a.orderIndex - b.orderIndex)
    const studentsDto = assignmentRows.filter((row) => row.teacher_parasha_id === library.id).map((row) => first(row.students)).filter((student): student is { id: number; name: string } => student !== null).map((student) => ({ id: student.id, name: student.name }))
    return { id: library.id, ownerAdminId: library.owner_admin_id, ownerDisplayName: ownersById.get(library.owner_admin_id) ?? '', parashaName: first(library.parashot)?.name ?? 'פרשה', sections: sectionsDto, students: studentsDto }
  })

  return (
    <main dir="rtl" className="min-h-screen bg-[#f3f6f8] px-4 py-8 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <nav className="mb-6 flex flex-wrap gap-3 text-sm font-semibold">
          <a className="rounded-full bg-white px-4 py-2 ring-1 ring-slate-200 hover:bg-slate-50" href="/admin">חזרה לניהול הראשי</a>
          <a className="rounded-full bg-white px-4 py-2 ring-1 ring-slate-200 hover:bg-slate-50" href="/admin/advanced">ניהול מתקדם</a>
        </nav>
        <header className="mb-7 rounded-[2rem] bg-[#101a2e] p-7 text-white sm:p-10">
          <p className="text-sm font-bold tracking-[.16em] text-cyan-200">TEXT · VOICE · TIMING</p>
          <h1 className="mt-3 text-3xl font-black sm:text-4xl">סטודיו לקריאה מסונכרנת</h1>
          <p className="mt-3 max-w-3xl leading-7 text-slate-200">בוחרים פרשה ועלייה, מקליטים או מעלים את קריאת המלמד, ומקבלים תזמון מילים לבדיקה. שום דבר לא יוצג לתלמיד לפני אישור.</p>
        </header>
        {error || ownersError ? <div className="rounded-2xl bg-rose-50 p-4 text-rose-800">לא הצלחנו לטעון את הספריות: {(error ?? ownersError)?.message}</div> : <TextSyncStudio libraries={librariesDto} />}
      </div>
    </main>
  )
}
