import Link from 'next/link'
import { redirect } from 'next/navigation'
import { logoutUser } from '../../../auth-actions'
import { getSectionPageData } from '@/lib/practice-data'
import { requireStudentSession } from '@/lib/student-auth'

export default async function SectionPartsPage({
  params,
}: {
  params: Promise<{ sectionId: string }>
}) {
  const { sectionId } = await params
  const sectionIdNumber = Number(sectionId)
  const session = await requireStudentSession()

  if (!sectionId || Number.isNaN(sectionIdNumber)) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">מזהה חלק לא תקין</h1>
        <p className="mt-3">sectionId שהתקבל: {String(sectionId)}</p>
      </main>
    )
  }

  const { student, section, parts, parashaName, error } =
    await getSectionPageData(sectionIdNumber, session.id)

  if (error && !student) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">שגיאה בטעינת תלמיד</h1>
        <p className="mt-3">{error.message}</p>
      </main>
    )
  }

  if (error && !section) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">שגיאה בטעינת חלק</h1>
        <p className="mt-3">{error.message}</p>
      </main>
    )
  }

  if (student && student.id !== session.id) {
    redirect('/student')
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Link
            href="/student"
            className="inline-block rounded-xl bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200"
          >
            חזרה לחלקים
          </Link>
          <form action={logoutUser}>
            <button
              type="submit"
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
            >
              יציאה
            </button>
          </form>
        </div>

        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
          <p className="text-sm text-slate-500">פרשה</p>
          <h1 className="text-3xl font-bold text-slate-900">
            {parashaName ?? 'לא הוגדרה פרשה'}
          </h1>

          <div className="mt-6 rounded-2xl bg-blue-50 p-5 text-center">
            <p className="text-sm text-slate-600">חלק נבחר</p>
            <h2 className="mt-2 text-4xl font-extrabold text-slate-900">
              {section.name}
            </h2>
          </div>

          <div className="mt-8">
            <h3 className="mb-4 text-lg font-semibold text-slate-900">
              בחר תת-חלק
            </h3>

            {parts.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {parts.map((part) => (
                  <Link
                    key={part.id}
                    href={`/student/lesson/${part.id}`}
                    className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4 transition hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-xl font-bold text-slate-900">
                          {part.name}
                        </h4>
                        <p className="mt-1 text-sm text-slate-500">
                          {part.is_full_reading ? 'קריאה מלאה' : `סדר ${part.part_order}`}
                        </p>
                      </div>

                      <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600 ring-1 ring-slate-200">
                        {part.practiceCount} תרגולים
                      </span>
                    </div>

                    <div className="mt-5 flex items-center justify-between text-sm text-slate-600">
                      <span>{part.completedCount} השלמות</span>
                      <span>{part.duration_seconds ? `${part.duration_seconds} שנ׳` : 'ללא משך'}</span>
                    </div>

                    <p className="mt-3 text-xs text-slate-400">
                      {part.lastPracticedAt
                        ? `תרגול אחרון: ${new Date(part.lastPracticedAt).toLocaleString('he-IL')}`
                        : 'עדיין לא תורגל'}
                    </p>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl bg-slate-100 p-4 text-slate-600">
                אין עדיין תתי-חלקים לחלק הזה עבור הפרשה של התלמיד.
              </div>
            )}
          </div>

          {error ? (
            <div className="mt-6 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
              {error.message}
            </div>
          ) : null}
        </div>
      </div>
    </main>
  )
}
