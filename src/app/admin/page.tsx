import Link from 'next/link'
import type { ReactNode } from 'react'
import { getAdminDashboardData } from '@/lib/admin-data'
import { getAdminSession, getConfiguredAdmin } from '@/lib/admin-auth'
import {
  copyParashaStructure,
  deleteAdmin,
  deleteLessonPart,
  deleteLessonSlide,
  deleteParasha,
  deleteSection,
  deleteStudent,
  ensureLessonGroup,
  loginAdmin,
  logoutAdmin,
  updateMyShareCode,
  upsertAdmin,
  upsertLessonPart,
  upsertLessonSlide,
  upsertParasha,
  upsertSection,
  upsertStudent,
} from './actions'
import { AudioDuration } from './audio-duration'
import { AdminContentSelector } from './selectors'

type AdminPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function toNumber(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function DisclosureSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <details className="rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-slate-200">
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

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const session = await getAdminSession()
  const configuredAdmin = getConfiguredAdmin()
  const resolvedSearchParams = await searchParams

  if (!session) {
    const errorCode = Array.isArray(resolvedSearchParams.error)
      ? resolvedSearchParams.error[0]
      : resolvedSearchParams.error

    const loginError =
      errorCode === 'invalid'
        ? 'שם המשתמש או הסיסמה אינם נכונים.'
        : errorCode === 'setup'
          ? 'יש להגדיר ADMIN_USERNAME ו-ADMIN_PASSWORD בקובץ .env.local.'
          : null

    return (
      <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto max-w-md rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
          <p className="text-sm font-medium text-blue-700">אזור מנהל</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900">
            התחברות לניהול המערכת
          </h1>
          <p className="mt-4 text-sm leading-7 text-slate-600">
            הגרסה הראשונית משתמשת בשם משתמש וסיסמה מתוך קובץ הסביבה. אחרי
            שנמסד טבלת מנהלים, נחבר גם שיוך קבוע בין מנהל לתלמידים.
          </p>

          <form action={loginAdmin} className="mt-8 space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">
                שם משתמש
              </span>
              <input
                name="username"
                type="text"
                defaultValue={configuredAdmin.username ?? ''}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none ring-0"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">
                סיסמה
              </span>
              <input
                name="password"
                type="password"
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none ring-0"
              />
            </label>

            <button
              type="submit"
              className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
            >
              כניסה
            </button>
          </form>

          {loginError ? (
            <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
              {loginError}
            </div>
          ) : null}
        </div>
      </main>
    )
  }

  const selectedParashaId = toNumber(resolvedSearchParams.parashaId)
  const selectedSectionId = toNumber(resolvedSearchParams.sectionId)
  const selectedPartId = toNumber(resolvedSearchParams.partId)

  const {
    parashot,
    sections,
    students,
    admins,
    managerByStudentId,
    lessonGroup,
    lessonParts,
    lessonSlides,
    selectedParashaId: activeParashaId,
    selectedSectionId: activeSectionId,
    selectedPartId: activePartId,
    parashaSources,
    error,
  } = await getAdminDashboardData({
    parashaId: selectedParashaId,
    sectionId: selectedSectionId,
    partId: selectedPartId,
  }, session)

  const selectedParasha = parashot.find((parasha) => parasha.id === activeParashaId)
  const selectedSection = sections.find((section) => section.id === activeSectionId)
  const selectedPart = lessonParts.find((part) => part.id === activePartId) ?? null
  const unassignedStudents = students.filter(
    (student) => !managerByStudentId[student.id]
  ).length

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="order-1 flex flex-wrap items-center justify-between gap-4 rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div>
            <p className="text-sm font-medium text-blue-700">אזור מנהל</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-900">
              שלום {session.displayName}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              מכאן אפשר לנהל תלמידים, פרשות, חלקים, תתי־חלקים, קבצי אודיו
              ושקופיות. הגרסה הזאת כבר עובדת על הטבלאות הקיימות שלך. לשיוך
              קבוע מנהל↔תלמידים נצטרך להוסיף טבלת מנהלים/שיוכים ב־SQL.
            </p>
          </div>

          <div className="flex gap-3">
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
          <div className="order-2 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
            {error.message}
          </div>
        ) : null}

        <div className="order-3 grid gap-4 md:grid-cols-4">
          <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200">
            <p className="text-sm text-slate-500">פרשות</p>
            <p className="mt-2 text-3xl font-black text-slate-900">{parashot.length}</p>
          </div>
          <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200">
            <p className="text-sm text-slate-500">חלקים ראשיים</p>
            <p className="mt-2 text-3xl font-black text-slate-900">{sections.length}</p>
          </div>
          <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200">
            <p className="text-sm text-slate-500">תלמידים נראים</p>
            <p className="mt-2 text-3xl font-black text-slate-900">{students.length}</p>
          </div>
          <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200">
            <p className="text-sm text-slate-500">ללא שיוך מנהל</p>
            <p className="mt-2 text-3xl font-black text-slate-900">{unassignedStudents}</p>
          </div>
        </div>

        <section className="order-[3] rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div className="grid gap-6 xl:grid-cols-2">
            <form action={updateMyShareCode} className="grid gap-3 rounded-3xl bg-slate-50 p-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">קוד שיתוף למבנה פרשה</h2>
                <p className="mt-2 text-sm text-slate-600">
                  קוד זה מאפשר למנהל אחר להעתיק אל עצמו מבנה של פרשה שלך, בלי
                  לחבר בין הנתונים אחר כך.
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

            <div className="rounded-3xl bg-slate-50 p-4">
              <h2 className="text-xl font-bold text-slate-900">בידוד בין מנהלים</h2>
              <p className="mt-2 text-sm leading-7 text-slate-600">
                המערכת עובדת עכשיו כך שכל מנהל רואה רק את תלמידיו, ולכל מנהל
                יש מבנה פרשה פרטי משלו. גם אם שני מנהלים עובדים על אותה פרשה,
                כל אחד יכול לשנות חלקים, אודיו ושקופיות בלי להשפיע על השני.
              </p>
            </div>
          </div>
        </section>

        {session.role === 'primary' ? (
          <div className="order-6">
            <DisclosureSection
              title="ניהול מנהלים"
              description="מנהל ראשי יכול להוסיף מנהלים, לשנות תפקיד, ולעדכן פרטי כניסה."
            >
              <div className="mt-6 grid gap-6 xl:grid-cols-2">
                <div className="space-y-4">
                  {admins.map((admin) => (
                    <form key={admin.id} action={upsertAdmin} className="grid gap-3 rounded-3xl bg-slate-50 p-4">
                      <input type="hidden" name="id" value={admin.id} />
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
                  ))}
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
          </div>
        ) : null}

        <div className="order-5 grid gap-6 xl:grid-cols-3">
          <DisclosureSection
            title="פרשות"
            description="הצג או ערוך את רשימת הפרשיות במערכת."
          >
            <div className="mt-5 space-y-3">
              {parashot.map((parasha) => (
                <form key={parasha.id} action={upsertParasha} className="grid gap-3">
                  <input type="hidden" name="id" value={parasha.id} />
                  <input
                    name="name"
                    defaultValue={parasha.name}
                    className="rounded-2xl border border-slate-200 px-4 py-3"
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="submit"
                      className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
                    >
                      שמירת פרשה
                    </button>
                    <button
                      formAction={deleteParasha}
                      type="submit"
                      className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white"
                    >
                      מחיקת פרשה
                    </button>
                  </div>
                </form>
              ))}
            </div>

            <form action={upsertParasha} className="mt-6 grid gap-3 rounded-3xl bg-slate-50 p-4">
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
            description="כאן מגדירים ראשון, שני, שלישי וכן הלאה."
          >
            <div className="mt-5 space-y-3">
              {sections.map((section) => (
                <form key={section.id} action={upsertSection} className="grid gap-3">
                  <input type="hidden" name="id" value={section.id} />
                  <input
                    name="name"
                    defaultValue={section.name}
                    className="rounded-2xl border border-slate-200 px-4 py-3"
                  />
                  <input
                    name="order_index"
                    type="number"
                    defaultValue={section.order_index}
                    className="rounded-2xl border border-slate-200 px-4 py-3"
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="submit"
                      className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
                    >
                      שמירת חלק
                    </button>
                    <button
                      formAction={deleteSection}
                      type="submit"
                      className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white"
                    >
                      מחיקת חלק
                    </button>
                  </div>
                </form>
              ))}
            </div>

            <form action={upsertSection} className="mt-6 grid gap-3 rounded-3xl bg-slate-50 p-4">
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

        <DisclosureSection
          title="תלמידי המנהל"
          description="כאן עורכים רק את תלמידי המנהל המחובר, עם שם משתמש וסיסמה אישיים."
        >
              <div className="mt-5 space-y-4">
                {students.map((student) => (
                  <form key={student.id} action={upsertStudent} className="grid gap-3 rounded-3xl bg-slate-50 p-4">
                    <input type="hidden" name="id" value={student.id} />
                <input
                  name="name"
                  defaultValue={student.name}
                  className="rounded-2xl border border-slate-200 px-4 py-3"
                />
                <input
                  name="username"
                  defaultValue={student.username ?? ''}
                  className="rounded-2xl border border-slate-200 px-4 py-3"
                />
                <input
                  name="password"
                  type="password"
                  placeholder="סיסמה חדשה אם רוצים לעדכן"
                  className="rounded-2xl border border-slate-200 px-4 py-3"
                />
                <select
                  name="parasha_id"
                  defaultValue={student.parasha_id ?? ''}
                  className="rounded-2xl border border-slate-200 px-4 py-3"
                >
                    <option value="">ללא פרשה</option>
                      {parashot.map((parasha) => (
                        <option key={parasha.id} value={parasha.id}>
                          {parasha.name}
                        </option>
                      ))}
                    </select>

                <div className="grid gap-3 sm:grid-cols-2">
                      <button
                        type="submit"
                        className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
                      >
                        שמירת תלמיד
                      </button>
                      <button
                        formAction={deleteStudent}
                        type="submit"
                        className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white"
                      >
                        מחיקת תלמיד
                      </button>
                    </div>
                  </form>
                ))}
              </div>

            <form action={upsertStudent} className="mt-6 grid gap-3 rounded-3xl bg-slate-50 p-4">
              <h3 className="text-lg font-semibold text-slate-900">הוספת תלמיד</h3>
            <input
              name="name"
              placeholder="שם תלמיד"
              className="rounded-2xl border border-slate-200 px-4 py-3"
            />
            <input
              name="username"
              placeholder="שם משתמש לתלמיד"
              className="rounded-2xl border border-slate-200 px-4 py-3"
            />
            <input
              name="password"
              type="password"
              placeholder="סיסמה לתלמיד"
              className="rounded-2xl border border-slate-200 px-4 py-3"
            />
            <select
              name="parasha_id"
              defaultValue=""
              className="rounded-2xl border border-slate-200 px-4 py-3"
            >
                <option value="">בחירת פרשה</option>
                {parashot.map((parasha) => (
                  <option key={parasha.id} value={parasha.id}>
                    {parasha.name}
                    </option>
                  ))}
                </select>
            <button
                  type="submit"
                  className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white"
                >
                הוספת תלמיד
              </button>
            </form>
          </DisclosureSection>
        </div>

        <section
          id="content-editor"
          className="order-4 rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-slate-200"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">עריכת פרשה ספציפית</h2>
              <p className="mt-2 text-sm text-slate-600">
                כאן מתבצעת העריכה המרכזית של המנהל: בוחרים פרשה וחלק, מוסיפים
                תתי־חלקים, משייכים אודיו, ומגדירים שקופיות עם זמן החלפה.
              </p>
            </div>
          </div>

          <div className="mt-6">
            <AdminContentSelector
              key={`${activeParashaId ?? 'none'}-${activeSectionId ?? 'none'}-${activePartId ?? 'none'}`}
              parashot={parashot}
              sections={sections}
              lessonParts={lessonParts}
              selectedParashaId={activeParashaId}
              selectedSectionId={activeSectionId}
              selectedPartId={activePartId}
            />
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200">
              <p className="text-sm text-slate-500">פרשה נבחרת</p>
              <p className="mt-2 text-2xl font-black text-slate-900">
                {selectedParasha?.name ?? 'לא נבחרה'}
              </p>
            </div>
            <div className="rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200">
              <p className="text-sm text-slate-500">חלק נבחר</p>
              <p className="mt-2 text-2xl font-black text-slate-900">
                {selectedSection?.name ?? 'לא נבחר'}
              </p>
            </div>
            <div className="rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200">
              <p className="text-sm text-slate-500">תת־חלק פתוח</p>
              <p className="mt-2 text-2xl font-black text-slate-900">
                {selectedPart?.name ?? 'אין'}
              </p>
            </div>
          </div>

          {selectedParasha ? (
            <div className="mt-6 grid gap-6 xl:grid-cols-2">
              <div className="rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200">
                <h3 className="text-lg font-semibold text-slate-900">
                  העתקת מבנה לפרשה {selectedParasha.name}
                </h3>
                <p className="mt-2 text-sm text-slate-600">
                  אם מנהל אחר כבר בנה את אותה פרשה, אפשר להעתיק את כל המבנה אליך
                  באמצעות קוד השיתוף שלו. לאחר ההעתקה, כל שינוי שתעשה יישאר רק
                  אצלך.
                </p>
                <form action={copyParashaStructure} className="mt-4 grid gap-3">
                  <input type="hidden" name="parasha_id" value={selectedParasha.id} />
                  <select
                    name="source_username"
                    defaultValue=""
                    className="rounded-2xl border border-slate-200 px-4 py-3"
                  >
                    <option value="">בחר מנהל מקור</option>
                    {parashaSources.map((source) => (
                      <option key={source.adminId} value={source.username}>
                        {source.displayName}
                      </option>
                    ))}
                  </select>
                  <input
                    name="share_code"
                    type="password"
                    placeholder="קוד השיתוף של מנהל המקור"
                    className="rounded-2xl border border-slate-200 px-4 py-3"
                  />
                  <button
                    type="submit"
                    className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white"
                  >
                    העתקת מבנה הפרשה
                  </button>
                </form>
              </div>

              <div className="rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200">
                <h3 className="text-lg font-semibold text-slate-900">מנהלים עם אותה פרשה</h3>
                {parashaSources.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    {parashaSources.map((source) => (
                      <div
                        key={source.adminId}
                        className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 ring-1 ring-slate-200"
                      >
                        {source.displayName}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-slate-500">
                    עדיין אין מנהל אחר שבנה את הפרשה הזאת.
                  </p>
                )}
              </div>
            </div>
          ) : null}

          {!lessonGroup && activeParashaId && activeSectionId ? (
            <form action={ensureLessonGroup} className="mt-6 rounded-3xl bg-slate-50 p-4">
              <input type="hidden" name="parasha_id" value={activeParashaId} />
              <input type="hidden" name="section_id" value={activeSectionId} />
              <p className="text-sm text-slate-600">
                עדיין אין `lesson_group` עבור הבחירה הזאת.
              </p>
              <button
                type="submit"
                className="mt-4 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white"
              >
                יצירת group לפרשה + חלק
              </button>
            </form>
          ) : null}

          {lessonGroup ? (
            <div className="mt-8 grid gap-6 xl:grid-cols-[1fr_0.9fr]">
              <div>
                <h3 className="text-xl font-bold text-slate-900">תתי־חלקים</h3>
                <p className="mt-2 text-sm text-slate-600">
                  כאן מגדירים את המבנה של תתי־החלקים. את האודיו והשקופיות של
                  הקטע הנבחר עורכים בעמודה השנייה בלבד.
                </p>
                <div className="mt-4 space-y-4">
                  {lessonParts.map((part) => (
                    <form key={part.id} action={upsertLessonPart} className="grid gap-3 rounded-3xl bg-slate-50 p-4">
                      <input type="hidden" name="id" value={part.id} />
                      <input
                        type="hidden"
                        name="lesson_group_id"
                        value={lessonGroup.id}
                      />
                      <input
                        type="hidden"
                        name="parasha_name"
                        value={selectedParasha?.name ?? ''}
                      />
                      <input
                        type="hidden"
                        name="section_name"
                        value={selectedSection?.name ?? ''}
                      />
                      <input
                        type="hidden"
                        name="current_audio_url"
                        value={part.audio_url ?? ''}
                      />
                      <input
                        type="hidden"
                        name="current_duration_seconds"
                        value={part.duration_seconds ?? ''}
                      />
                      <input
                        name="name"
                        defaultValue={part.name}
                        className="rounded-2xl border border-slate-200 px-4 py-3"
                      />
                      <div className="grid gap-3 md:grid-cols-2">
                        <input
                          name="part_order"
                          type="number"
                          defaultValue={part.part_order}
                          className="rounded-2xl border border-slate-200 px-4 py-3"
                        />
                        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                          משך האודיו: <AudioDuration src={part.audio_url} />
                        </div>
                      </div>
                      <div className="rounded-2xl bg-white p-3 text-sm text-slate-600 ring-1 ring-slate-200">
                        {part.audio_url
                          ? `אודיו משויך: ${part.audio_url}`
                          : 'אודיו עדיין לא הוגדר. פתח את הקטע בצד שמאל כדי לשייך קובץ.'}
                      </div>
                      <label className="flex items-center gap-3 text-sm text-slate-700">
                        <input
                          name="is_full_reading"
                          type="checkbox"
                          defaultChecked={part.is_full_reading}
                        />
                        סימון כקריאה מלאה
                      </label>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <button
                          type="submit"
                          className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
                        >
                          שמירת מבנה
                        </button>
                        <div className="grid gap-3 md:grid-cols-2">
                          <Link
                            href={`/admin?parashaId=${activeParashaId ?? ''}&sectionId=${activeSectionId ?? ''}&partId=${part.id}#content-editor`}
                            className="rounded-2xl bg-blue-600 px-4 py-3 text-center text-sm font-semibold text-white"
                          >
                            עריכת מדיה
                          </Link>
                          <button
                            formAction={deleteLessonPart}
                            type="submit"
                            className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white"
                          >
                            מחיקת תת־חלק
                          </button>
                        </div>
                      </div>
                    </form>
                  ))}
                </div>

                <form action={upsertLessonPart} className="mt-6 grid gap-3 rounded-3xl bg-slate-50 p-4">
                  <h4 className="text-lg font-semibold text-slate-900">הוספת תת־חלק חדש</h4>
                  <input type="hidden" name="lesson_group_id" value={lessonGroup.id} />
                  <input
                    type="hidden"
                    name="parasha_name"
                    value={selectedParasha?.name ?? ''}
                  />
                  <input
                    type="hidden"
                    name="section_name"
                    value={selectedSection?.name ?? ''}
                  />
                  <input type="hidden" name="current_audio_url" value="" />
                  <input type="hidden" name="current_duration_seconds" value="" />
                  <input
                    name="name"
                    placeholder="למשל: ראשון-4"
                    className="rounded-2xl border border-slate-200 px-4 py-3"
                  />
                  <div className="grid gap-3 md:grid-cols-2">
                    <input
                      name="part_order"
                      type="number"
                      placeholder="סדר תצוגה"
                      className="rounded-2xl border border-slate-200 px-4 py-3"
                    />
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
                      משך האודיו יוצג אוטומטית אחרי שיוגדר קובץ לקטע.
                    </div>
                  </div>
                  <label className="flex items-center gap-3 text-sm text-slate-700">
                    <input name="is_full_reading" type="checkbox" />
                    סימון כקריאה מלאה
                  </label>
                  <button
                    type="submit"
                    className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white"
                  >
                    הוספת תת־חלק
                  </button>
                </form>
              </div>

              <div>
                <h3 className="text-xl font-bold text-slate-900">אודיו ושקופיות לקטע הנבחר</h3>
                {activePartId ? (
                  <>
                    <form action={upsertLessonPart} className="mt-4 grid gap-3 rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200">
                      <h4 className="text-lg font-semibold text-slate-900">
                        אודיו עבור {selectedPart?.name}
                      </h4>
                      <input type="hidden" name="id" value={selectedPart?.id ?? ''} />
                      <input
                        type="hidden"
                        name="lesson_group_id"
                        value={lessonGroup.id}
                      />
                      <input
                        type="hidden"
                        name="parasha_name"
                        value={selectedParasha?.name ?? ''}
                      />
                      <input
                        type="hidden"
                        name="section_name"
                        value={selectedSection?.name ?? ''}
                      />
                      <input
                        type="hidden"
                        name="name"
                        value={selectedPart?.name ?? ''}
                      />
                      <input
                        type="hidden"
                        name="part_order"
                        value={selectedPart?.part_order ?? ''}
                      />
                      <input
                        type="hidden"
                        name="current_audio_url"
                        value={selectedPart?.audio_url ?? ''}
                      />
                      <input
                        type="hidden"
                        name="current_duration_seconds"
                        value={selectedPart?.duration_seconds ?? ''}
                      />
                      {selectedPart?.is_full_reading ? (
                        <input type="hidden" name="is_full_reading" value="on" />
                      ) : null}
                      <label className="grid gap-2 text-sm font-medium text-slate-700">
                        <span>בחירת קובץ אודיו</span>
                        <input
                          name="audio_file"
                          type="file"
                          accept="audio/*"
                          className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3"
                        />
                      </label>
                      <input
                        name="audio_url"
                        defaultValue={selectedPart?.audio_url ?? ''}
                        placeholder="/Audio/example.mp3"
                        className="rounded-2xl border border-slate-200 px-4 py-3"
                      />
                      <div className="rounded-2xl bg-white p-3 text-sm text-slate-600 ring-1 ring-slate-200">
                        {selectedPart?.audio_url ?? 'אין עדיין קובץ אודיו משויך'}
                      </div>
                      <div className="rounded-2xl bg-white p-3 text-sm text-slate-700 ring-1 ring-slate-200">
                        משך האודיו: <AudioDuration src={selectedPart?.audio_url} />
                      </div>
                      {selectedPart?.audio_url ? (
                        <audio
                          controls
                          className="w-full"
                          src={selectedPart.audio_url}
                        />
                      ) : null}
                      <button
                        type="submit"
                        className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
                      >
                        שמירת אודיו לקטע
                      </button>
                    </form>

                    <div className="mt-4 space-y-4">
                      {lessonSlides.map((slide) => (
                        <form key={slide.id} action={upsertLessonSlide} className="grid gap-3 rounded-3xl bg-slate-50 p-4">
                          <input type="hidden" name="id" value={slide.id} />
                          <input
                            type="hidden"
                            name="lesson_part_id"
                            value={activePartId}
                          />
                          <input
                            type="hidden"
                            name="parasha_name"
                            value={selectedParasha?.name ?? ''}
                          />
                          <input
                            type="hidden"
                            name="section_name"
                            value={selectedSection?.name ?? ''}
                          />
                          <input
                            type="hidden"
                            name="part_name"
                            value={selectedPart?.name ?? ''}
                          />
                          <label className="grid gap-2 text-sm font-medium text-slate-700">
                            <span>בחירת קובץ תמונה</span>
                            <input
                              name="image_file"
                              type="file"
                              accept="image/*"
                              className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3"
                            />
                          </label>
                          <input
                            name="image_url"
                            defaultValue={slide.image_url}
                            placeholder="/images/example.jpg"
                            className="rounded-2xl border border-slate-200 px-4 py-3"
                          />
                          {slide.image_url ? (
                            <div className="rounded-2xl bg-white p-3 text-sm text-slate-600 ring-1 ring-slate-200">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={slide.image_url}
                                alt={slide.image_url}
                                className="h-40 w-full rounded-2xl object-contain bg-slate-50"
                              />
                              <p className="mt-3 break-all">{slide.image_url}</p>
                            </div>
                          ) : null}
                          <div className="grid gap-3 md:grid-cols-2">
                            <input
                              name="slide_index"
                              type="number"
                              defaultValue={slide.slide_index}
                              className="rounded-2xl border border-slate-200 px-4 py-3"
                            />
                            <input
                              name="start_second"
                              type="number"
                              defaultValue={slide.start_second}
                              className="rounded-2xl border border-slate-200 px-4 py-3"
                            />
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <button
                              type="submit"
                              className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
                            >
                              שמירת שקופית
                            </button>
                            <button
                              formAction={deleteLessonSlide}
                              type="submit"
                              className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white"
                            >
                              מחיקת שקופית
                            </button>
                          </div>
                        </form>
                      ))}
                    </div>

                    <form action={upsertLessonSlide} className="mt-6 grid gap-3 rounded-3xl bg-slate-50 p-4">
                      <h4 className="text-lg font-semibold text-slate-900">הוספת שקופית</h4>
                      <input type="hidden" name="lesson_part_id" value={activePartId} />
                      <input
                        type="hidden"
                        name="parasha_name"
                        value={selectedParasha?.name ?? ''}
                      />
                      <input
                        type="hidden"
                        name="section_name"
                        value={selectedSection?.name ?? ''}
                      />
                      <input
                        type="hidden"
                        name="part_name"
                        value={selectedPart?.name ?? ''}
                      />
                      <label className="grid gap-2 text-sm font-medium text-slate-700">
                        <span>בחירת קובץ תמונה</span>
                        <input
                          name="image_file"
                          type="file"
                          accept="image/*"
                          className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3"
                        />
                      </label>
                      <input
                        name="image_url"
                        placeholder="/images/bereshit_r1_1_0.jpg"
                        className="rounded-2xl border border-slate-200 px-4 py-3"
                      />
                      <div className="grid gap-3 md:grid-cols-2">
                        <input
                          name="slide_index"
                          type="number"
                          placeholder="מספר שקופית"
                          className="rounded-2xl border border-slate-200 px-4 py-3"
                        />
                        <input
                          name="start_second"
                          type="number"
                          placeholder="שנייה להתחלה"
                          className="rounded-2xl border border-slate-200 px-4 py-3"
                        />
                      </div>
                      <button
                        type="submit"
                        className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white"
                      >
                        הוספת שקופית
                      </button>
                    </form>
                  </>
                ) : (
                  <div className="mt-4 rounded-3xl bg-slate-50 p-4 text-sm text-slate-600">
                    בחר תת־חלק כדי לערוך את השקופיות שלו.
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  )
}
