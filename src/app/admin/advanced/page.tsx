import Link from 'next/link'
import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { getAdminDashboardData } from '@/lib/admin-data'
import { getAdminSession } from '@/lib/admin-auth'
import { supabase } from '@/lib/supabase'
import {
  deleteAdmin,
  logoutAdmin,
  updateMyShareCode,
  upsertAdmin,
  upsertParasha,
  upsertSection,
} from '../actions'
import { AdminQueryForm } from '../selectors'

type AdvancedAdminPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function toNumber(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function toStringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? ''
}

function DisclosureSection({
  title,
  description,
  children,
  defaultOpen = false,
}: {
  title: string
  description: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  return (
    <details
      open={defaultOpen}
      className="rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-slate-200"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{title}</h2>
          <p className="mt-2 text-sm leading-7 text-slate-600">{description}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
          הצג
        </span>
      </summary>
      <div className="mt-6">{children}</div>
    </details>
  )
}

export default async function AdvancedAdminPage({ searchParams }: AdvancedAdminPageProps) {
  const session = await getAdminSession()
  const resolvedSearchParams = await searchParams

  if (!session) {
    redirect('/')
  }

  const hasOwnerAdminIdParam = Object.prototype.hasOwnProperty.call(
    resolvedSearchParams,
    'ownerAdminId'
  )
  const ownerAdminIdParamValue = toStringParam(resolvedSearchParams.ownerAdminId)
  const selectedOwnerAdminId =
    ownerAdminIdParamValue === 'all' ? null : toNumber(resolvedSearchParams.ownerAdminId)
  const selectedTeacherParashaStatus = toStringParam(resolvedSearchParams.teacherParashaStatus)
  const selectedBaseParashaFilterId = toNumber(resolvedSearchParams.baseParashaFilterId)
  const selectedNusachFilterId = toNumber(resolvedSearchParams.nusachFilterId)
  const selectedAdminView = toStringParam(resolvedSearchParams.adminView) || 'single'
  const selectedAdminCardId = toNumber(resolvedSearchParams.adminId)
  const whatsappStatus = toStringParam(resolvedSearchParams.waStatus)
  const whatsappMessage = toStringParam(resolvedSearchParams.waMessage)

  const ownerAdminSelectValue =
    session.role === 'primary'
      ? hasOwnerAdminIdParam
        ? ownerAdminIdParamValue === 'all'
          ? 'all'
          : (selectedOwnerAdminId?.toString() ?? '')
        : (session.id?.toString() ?? '')
      : (session.id?.toString() ?? '')

  const effectiveOwnerAdminId =
    session.role === 'primary'
      ? hasOwnerAdminIdParam
        ? ownerAdminIdParamValue === 'all'
          ? null
          : selectedOwnerAdminId
        : (session.id ?? null)
      : (session.id ?? null)

  const {
    parashot,
    teacherParashot = [],
    allTeacherParashot = [],
    nusachim = [],
    sections,
    students,
    admins,
    error,
  } = await getAdminDashboardData(
    {
      ownerAdminId: effectiveOwnerAdminId,
      teacherParashaStatus: selectedTeacherParashaStatus || null,
      baseParashaFilterId: selectedBaseParashaFilterId,
      nusachFilterId: selectedNusachFilterId,
    },
    session
  )

  const currentParams = new URLSearchParams()
  for (const [key, value] of Object.entries(resolvedSearchParams)) {
    if (key === 'waStatus' || key === 'waMessage') {
      continue
    }

    const normalizedValue = Array.isArray(value) ? value[0] : value
    if (normalizedValue) {
      currentParams.set(key, normalizedValue)
    }
  }

  const currentAdminReturnPath = currentParams.size > 0
    ? `/admin/advanced?${currentParams.toString()}`
    : '/admin/advanced'

  const selectedAdminCard =
    admins.find((admin) => admin.id === selectedAdminCardId) ?? admins[0] ?? null
  const visibleAdmins =
    selectedAdminView === 'all'
      ? admins
      : selectedAdminCard
        ? admins.filter((admin) => admin.id === selectedAdminCard.id)
        : []

  const teacherParashaStatusCounts = {
    active: teacherParashot.filter((item) => item.status === 'active').length,
    frozen: teacherParashot.filter((item) => item.status === 'frozen').length,
    draft: teacherParashot.filter((item) => item.status === 'draft').length,
    archived: teacherParashot.filter((item) => item.status === 'archived').length,
  }

  const unassignedStudents = students.filter((student) => !student.admin_id).length

  let contentParashaCount = 0
  let contentSectionCount = 0
  let unassignedTeacherParashot: Array<{
    id: number
    internalDisplayName: string
    ownerDisplayName: string
    nusachName: string
  }> = []
  let unassignedLessonParts: Array<{
    id: number
    name: string
    sectionName: string
    internalDisplayName: string
    ownerDisplayName: string
  }> = []

  if (allTeacherParashot.length > 0) {
    const { data: visibleGroups } = await supabase
      .from('lesson_groups')
      .select('id, teacher_parasha_id, section_id')
      .in(
        'teacher_parasha_id',
        allTeacherParashot.map((teacherParasha) => teacherParasha.id)
      )

    const allGroups = (visibleGroups ?? []) as Array<{
      id: number
      teacher_parasha_id: number
      section_id: number
    }>

    if (allGroups.length > 0) {
      const { data: visibleParts } = await supabase
        .from('lesson_parts')
        .select('lesson_group_id')
        .in(
          'lesson_group_id',
          allGroups.map((group) => group.id)
        )

      const groupIdsWithParts = new Set(
        ((visibleParts ?? []) as Array<{ lesson_group_id: number }>).map(
          (part) => part.lesson_group_id
        )
      )

      const teacherParashaIdsWithParts = new Set<number>()
      const sectionIdsWithParts = new Set<number>()

      for (const group of allGroups) {
        if (!groupIdsWithParts.has(group.id)) {
          continue
        }

        teacherParashaIdsWithParts.add(group.teacher_parasha_id)
        sectionIdsWithParts.add(group.section_id)
      }

      contentParashaCount = new Set(
        allTeacherParashot
          .filter((teacherParasha) => teacherParashaIdsWithParts.has(teacherParasha.id))
          .map((teacherParasha) => teacherParasha.parasha_id)
      ).size
      contentSectionCount = sectionIdsWithParts.size

      const { data: activeAssignments } = await supabase
        .from('student_teacher_parasha_assignments')
        .select('teacher_parasha_id')
        .in(
          'teacher_parasha_id',
          allTeacherParashot.map((teacherParasha) => teacherParasha.id)
        )
        .eq('status', 'active')

      const assignedTeacherParashaIds = new Set(
        ((activeAssignments ?? []) as Array<{ teacher_parasha_id: number }>).map(
          (assignment) => assignment.teacher_parasha_id
        )
      )

      unassignedTeacherParashot = allTeacherParashot
        .filter((teacherParasha) => !assignedTeacherParashaIds.has(teacherParasha.id))
        .map((teacherParasha) => ({
          id: teacherParasha.id,
          internalDisplayName: teacherParasha.internal_display_name,
          ownerDisplayName: teacherParasha.owner_display_name,
          nusachName: teacherParasha.nusach_name,
        }))

      const lessonGroupById = new Map(
        allGroups.map((group) => [group.id, group] as const)
      )
      const teacherParashaById = new Map(
        allTeacherParashot.map((teacherParasha) => [teacherParasha.id, teacherParasha] as const)
      )
      const sectionNameById = new Map(
        sections.map((section) => [section.id, section.name] as const)
      )

      const { data: allVisibleParts } = await supabase
        .from('lesson_parts')
        .select('id, name, lesson_group_id')
        .in(
          'lesson_group_id',
          allGroups.map((group) => group.id)
        )

      unassignedLessonParts = ((allVisibleParts ?? []) as Array<{
        id: number
        name: string
        lesson_group_id: number
      }>)
        .map((part) => {
          const group = lessonGroupById.get(part.lesson_group_id)
          if (!group || assignedTeacherParashaIds.has(group.teacher_parasha_id)) {
            return null
          }

          const teacherParasha = teacherParashaById.get(group.teacher_parasha_id)
          if (!teacherParasha) {
            return null
          }

          return {
            id: part.id,
            name: part.name,
            sectionName: sectionNameById.get(group.section_id) ?? 'ללא חלק',
            internalDisplayName: teacherParasha.internal_display_name,
            ownerDisplayName: teacherParasha.owner_display_name,
          }
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div>
            <p className="text-sm font-medium text-blue-700">ניהול מתקדם</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-900">
              תחזוקה והגדרות
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              כאן מרוכזים כלי התחזוקה הרחבים: מנהלים, תוכן לא משויך, פרשות, חלקים ראשיים וסטטיסטיקות כלליות.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/admin"
              className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white"
            >
              חזרה לניהול הראשי
            </Link>
            <Link
              href="/student"
              className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700"
            >
              מעבר לצד תלמיד
            </Link>
            <form action={logoutAdmin}>
              <button
                type="submit"
                className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
              >
                יציאה
              </button>
            </form>
          </div>
        </header>

        {error ? (
          <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
            {error.message}
          </div>
        ) : null}

        {whatsappMessage ? (
          <div
            className={`rounded-2xl p-4 text-sm ring-1 ${
              whatsappStatus === 'success'
                ? 'bg-emerald-50 text-emerald-900 ring-emerald-200'
                : 'bg-rose-50 text-rose-900 ring-rose-200'
            }`}
          >
            {whatsappMessage}
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200">
            <p className="text-sm text-slate-500">פרשות עם תוכן</p>
            <p className="mt-2 text-3xl font-black text-slate-900">{contentParashaCount}</p>
          </div>
          <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200">
            <p className="text-sm text-slate-500">חלקים ראשיים עם תוכן</p>
            <p className="mt-2 text-3xl font-black text-slate-900">{contentSectionCount}</p>
          </div>
          <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200">
            <p className="text-sm text-slate-500">ספריות לא משויכות</p>
            <p className="mt-2 text-3xl font-black text-slate-900">{unassignedTeacherParashot.length}</p>
          </div>
          <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200">
            <p className="text-sm text-slate-500">ללא שיוך מנהל</p>
            <p className="mt-2 text-3xl font-black text-slate-900">{unassignedStudents}</p>
          </div>
        </div>

        <section className="rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900">מסננים כלליים</h2>
              <p className="mt-2 text-sm text-slate-600">
                הסינון כאן משפיע על התוכן הלא משויך ועל ספריות התחזוקה.
              </p>
            </div>
          </div>

          <AdminQueryForm
            className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto]"
            autoSubmitOnChange
          >
            {session.role === 'primary' ? (
              <select
                name="ownerAdminId"
                defaultValue={ownerAdminSelectValue}
                className="rounded-2xl border border-slate-200 px-4 py-3"
              >
                <option value="all">כל המלמדים</option>
                {admins.map((admin) => (
                  <option key={admin.id} value={admin.id}>
                    {admin.display_name}
                  </option>
                ))}
              </select>
            ) : (
              <input type="hidden" name="ownerAdminId" value={session.id ?? ''} />
            )}
            <select
              name="teacherParashaStatus"
              defaultValue={selectedTeacherParashaStatus}
              className="rounded-2xl border border-slate-200 px-4 py-3"
            >
              <option value="">כל הסטטוסים</option>
              <option value="active">פעילות</option>
              <option value="frozen">קפואות</option>
              <option value="draft">טיוטות</option>
              <option value="archived">ארכיון</option>
            </select>
            <select
              name="baseParashaFilterId"
              defaultValue={selectedBaseParashaFilterId ?? ''}
              className="rounded-2xl border border-slate-200 px-4 py-3"
            >
              <option value="">כל הפרשות</option>
              {parashot.map((parasha) => (
                <option key={parasha.id} value={parasha.id}>
                  {parasha.name}
                </option>
              ))}
            </select>
            <select
              name="nusachFilterId"
              defaultValue={selectedNusachFilterId ?? ''}
              className="rounded-2xl border border-slate-200 px-4 py-3"
            >
              <option value="">כל הנוסחים</option>
              {nusachim.map((nusach) => (
                <option key={nusach.id} value={nusach.id}>
                  {nusach.name}
                </option>
              ))}
            </select>
            <select
              name="adminView"
              defaultValue={selectedAdminView}
              className="rounded-2xl border border-slate-200 px-4 py-3"
            >
              <option value="single">מנהל אחד</option>
              <option value="all">כל המנהלים</option>
            </select>
            <button
              type="submit"
              className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
            >
              רענון
            </button>
          </AdminQueryForm>
        </section>

        <DisclosureSection
          defaultOpen
          title="תוכן לא משויך"
          description="כאן רואים ספריות ותתי־חלקים שאין להם כרגע תלמיד פעיל. זהו אזור בדיקה ותחזוקה בלבד."
        >
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200">
              <h3 className="text-base font-semibold text-slate-900">ספריות ללא תלמיד פעיל</h3>
              <div className="mt-3 space-y-2">
                {unassignedTeacherParashot.length > 0 ? (
                  unassignedTeacherParashot.map((teacherParasha) => (
                    <div
                      key={teacherParasha.id}
                      className="rounded-2xl bg-white px-4 py-3 text-sm ring-1 ring-slate-200"
                    >
                      <div className="font-semibold text-slate-900">{teacherParasha.internalDisplayName}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {teacherParasha.ownerDisplayName} | {teacherParasha.nusachName}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-500 ring-1 ring-slate-200">
                    אין כרגע ספריות לא משויכות בסינון הפעיל.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200">
              <h3 className="text-base font-semibold text-slate-900">תתי־חלקים ללא תלמיד פעיל</h3>
              <div className="mt-3 space-y-2">
                {unassignedLessonParts.length > 0 ? (
                  unassignedLessonParts.map((part) => (
                    <div
                      key={part.id}
                      className="rounded-2xl bg-white px-4 py-3 text-sm ring-1 ring-slate-200"
                    >
                      <div className="font-semibold text-slate-900">
                        {part.sectionName} | {part.name}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {part.ownerDisplayName} | {part.internalDisplayName}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-500 ring-1 ring-slate-200">
                    אין כרגע תתי־חלקים לא משויכים בסינון הפעיל.
                  </div>
                )}
              </div>
            </div>
          </div>
        </DisclosureSection>

        {session.role === 'primary' ? (
          <DisclosureSection
            title="ניהול מנהלים"
            description="מכאן מנהל ראשי מוסיף, מעדכן או משבית מנהלים. מנהל שאינו ראשי לא רואה את האזור הזה."
          >
            <AdminQueryForm className="grid gap-3 rounded-3xl bg-slate-50 p-4 md:grid-cols-[12rem_1fr_auto]">
              <select
                name="adminView"
                defaultValue={selectedAdminView}
                className="rounded-2xl border border-slate-200 px-4 py-3"
              >
                <option value="single">מנהל אחד</option>
                <option value="all">כל המנהלים</option>
              </select>
              <select
                name="adminId"
                defaultValue={selectedAdminCard?.id ?? ''}
                className="rounded-2xl border border-slate-200 px-4 py-3"
              >
                <option value="">בחירת מנהל</option>
                {admins.map((admin) => (
                  <option key={admin.id} value={admin.id}>
                    {admin.display_name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
              >
                סינון
              </button>
            </AdminQueryForm>

            <div className="mt-6 grid gap-6 xl:grid-cols-2">
              <div className="space-y-4">
                {visibleAdmins.length > 0 ? visibleAdmins.map((admin) => (
                  <form key={admin.id} action={upsertAdmin} className="grid gap-3 rounded-3xl bg-slate-50 p-4">
                    <input type="hidden" name="id" value={admin.id} />
                    <input type="hidden" name="return_path" value={currentAdminReturnPath} />
                    <input
                      name="display_name"
                      defaultValue={admin.display_name}
                      className="rounded-2xl border border-slate-200 px-4 py-3"
                    />
                    <input
                      name="username"
                      defaultValue={admin.username}
                      className="rounded-2xl border border-slate-200 px-4 py-3"
                    />
                    <input
                      name="whatsapp_phone"
                      defaultValue={admin.whatsapp_phone ?? ''}
                      placeholder="מספר WhatsApp, למשל 9725..."
                      className="rounded-2xl border border-slate-200 px-4 py-3"
                    />
                    <input
                      name="city"
                      defaultValue={admin.city ?? ''}
                      placeholder="עיר / יישוב"
                      className="rounded-2xl border border-slate-200 px-4 py-3"
                    />
                    <input
                      name="email"
                      type="email"
                      defaultValue={admin.email ?? ''}
                      placeholder="אימייל"
                      className="rounded-2xl border border-slate-200 px-4 py-3"
                    />
                    <input
                      name="password"
                      type="password"
                      placeholder="סיסמה חדשה אם רוצים לעדכן"
                      className="rounded-2xl border border-slate-200 px-4 py-3"
                    />
                    <select
                      name="role"
                      defaultValue={admin.role}
                      className="rounded-2xl border border-slate-200 px-4 py-3"
                    >
                      <option value="teacher">מנהל מלמד</option>
                      <option value="primary">מנהל ראשי</option>
                    </select>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <button
                        type="submit"
                        className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
                      >
                        שמירת מנהל
                      </button>
                      <button
                        formAction={deleteAdmin}
                        type="submit"
                        className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white"
                      >
                        מחיקת מנהל
                      </button>
                    </div>
                  </form>
                )) : (
                  <div className="rounded-3xl bg-slate-50 p-5 text-sm text-slate-500 ring-1 ring-slate-200">
                    לא נבחר מנהל להצגה.
                  </div>
                )}
              </div>

              <form action={upsertAdmin} className="grid gap-3 rounded-3xl bg-blue-50 p-4">
                <h3 className="text-lg font-semibold text-slate-900">הוספת מנהל חדש</h3>
                <input
                  name="display_name"
                  placeholder="שם תצוגה"
                  className="rounded-2xl border border-slate-200 px-4 py-3"
                />
                <input
                  name="username"
                  placeholder="שם משתמש"
                  className="rounded-2xl border border-slate-200 px-4 py-3"
                />
                <input
                  name="whatsapp_phone"
                  placeholder="מספר WhatsApp, למשל 9725..."
                  className="rounded-2xl border border-slate-200 px-4 py-3"
                />
                <input
                  name="city"
                  placeholder="עיר / יישוב"
                  className="rounded-2xl border border-slate-200 px-4 py-3"
                />
                <input
                  name="email"
                  type="email"
                  placeholder="אימייל"
                  className="rounded-2xl border border-slate-200 px-4 py-3"
                />
                <input
                  name="password"
                  type="password"
                  placeholder="סיסמה"
                  className="rounded-2xl border border-slate-200 px-4 py-3"
                />
                <select
                  name="role"
                  defaultValue="teacher"
                  className="rounded-2xl border border-slate-200 px-4 py-3"
                >
                  <option value="teacher">מנהל מלמד</option>
                  <option value="primary">מנהל ראשי</option>
                </select>
                <button
                  type="submit"
                  className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white"
                >
                  הוספת מנהל
                </button>
              </form>
            </div>
          </DisclosureSection>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <DisclosureSection
            title="פרשות"
            description="כאן מוסיפים פרשה חדשה בלבד. אם השם כבר קיים, המערכת תציג הודעה מתאימה."
          >
            <form action={upsertParasha} className="grid gap-3 rounded-3xl bg-slate-50 p-4">
              <h3 className="text-lg font-semibold text-slate-900">הוספת פרשה</h3>
              <input
                name="name"
                placeholder="למשל: וירא"
                className="rounded-2xl border border-slate-200 px-4 py-3"
              />
              <button
                type="submit"
                className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white"
              >
                הוספת פרשה חדשה
              </button>
            </form>
          </DisclosureSection>

          <DisclosureSection
            title="חלקים ראשיים"
            description="כאן מוסיפים חלק ראשי חדש בלבד. אם השם כבר קיים, המערכת תציג הודעה מתאימה."
          >
            <form action={upsertSection} className="grid gap-3 rounded-3xl bg-slate-50 p-4">
              <h3 className="text-lg font-semibold text-slate-900">הוספת חלק חדש</h3>
              <input
                name="name"
                placeholder="למשל: מפטיר"
                className="rounded-2xl border border-slate-200 px-4 py-3"
              />
              <input
                name="order_index"
                type="number"
                placeholder="סדר תצוגה"
                className="rounded-2xl border border-slate-200 px-4 py-3"
              />
              <button
                type="submit"
                className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white"
              >
                הוספת חלק
              </button>
            </form>
          </DisclosureSection>
        </div>

        <section className="rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <form action={updateMyShareCode} className="grid gap-3 rounded-3xl bg-slate-50 p-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900">קוד שיתוף למבנה פרשה</h2>
              <p className="mt-2 text-sm text-slate-600">
                כאן אפשר לעדכן את קוד השיתוף שמאפשר למלמד אחר להעתיק ממך מבנה בלי לחבר את הנתונים אחר כך.
              </p>
            </div>
            <input
              name="share_code"
              type="password"
              placeholder="קוד שיתוף חדש או מעודכן"
              className="rounded-2xl border border-slate-200 px-4 py-3"
            />
            <button
              type="submit"
              className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
            >
              שמירת קוד שיתוף
            </button>
          </form>
        </section>

        <section className="rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-xl font-bold text-slate-900">ספריות פעילות לפי הסינון</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
              <div className="text-xs text-slate-500">פעילות</div>
              <div className="mt-1 text-2xl font-black text-emerald-700">{teacherParashaStatusCounts.active}</div>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
              <div className="text-xs text-slate-500">קפואות</div>
              <div className="mt-1 text-2xl font-black text-amber-700">{teacherParashaStatusCounts.frozen}</div>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
              <div className="text-xs text-slate-500">טיוטות</div>
              <div className="mt-1 text-2xl font-black text-slate-700">{teacherParashaStatusCounts.draft}</div>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
              <div className="text-xs text-slate-500">ארכיון</div>
              <div className="mt-1 text-2xl font-black text-rose-700">{teacherParashaStatusCounts.archived}</div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
