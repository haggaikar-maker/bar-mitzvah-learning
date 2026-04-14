import Link from 'next/link'
import { redirect } from 'next/navigation'
import { logoutUser } from '../auth-actions'
import {
  getStudentDashboardData,
} from '@/lib/practice-data'
import { requireStudentSession } from '@/lib/student-auth'

export default async function StudentPage() {
  const session = await requireStudentSession()
  const { student, sections, parashaName, error } =
    await getStudentDashboardData(session.id)

  if (error || !student) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">שגיאה בטעינת תלמיד</h1>
        <p className="mt-3">{error?.message ?? 'לא נמצא תלמיד פעיל'}</p>
      </main>
    )
  }

  if (student.id !== session.id) {
    redirect('/student')
  }

  const totalParts = sections.reduce((sum, section) => sum + section.totalParts, 0)
  const completedParts = sections.reduce(
    (sum, section) => sum + section.completedParts,
    0
  )
  const totalPractices = sections.reduce(
    (sum, section) => sum + section.practiceCount,
    0
  )
  const totalCompletionEvents = sections.reduce(
    (sum, section) => sum + section.completionEventCount,
    0
  )
  const totalCompletionTarget = sections.reduce(
    (sum, section) => sum + section.completionTarget,
    0
  )

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/"
            className="inline-flex rounded-2xl bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200"
          >
            חזרה להתחברות
          </Link>
          <form action={logoutUser}>
            <button
              type="submit"
              className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
            >
              יציאה
            </button>
          </form>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
            <p className="text-sm text-slate-500">ברוך הבא</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-900">
              {student.name}
            </h1>

            <div className="mt-6 rounded-[1.75rem] bg-blue-50 p-5 text-center">
              <p className="text-sm text-slate-600">הפרשה שלך</p>
              <h2 className="mt-2 text-4xl font-extrabold text-slate-900">
                {parashaName ?? 'לא הוגדרה פרשה'}
              </h2>
            </div>

            <div className="mt-8">
              <h3 className="mb-4 text-lg font-semibold text-slate-900">
                בחר חלק לתרגול
              </h3>

              {sections.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {sections.map((section) => {
                    const completionRatio = Math.min(
                      100,
                      Math.round(
                        (section.completionEventCount /
                          Math.max(section.completionTarget, 1)) *
                          100
                      )
                    )

                    return (
                      <Link
                        key={section.id}
                        href={`/student/section/${section.id}`}
                        className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4 transition hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <h4 className="text-xl font-bold text-slate-900">
                            {section.name}
                          </h4>
                          <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600 ring-1 ring-slate-200">
                            {section.totalParts} תתי-חלקים מוכנים
                          </span>
                        </div>

                        <div className="mt-4 h-2 rounded-full bg-slate-200">
                          <div
                            className="h-2 rounded-full bg-blue-600"
                            style={{ width: `${completionRatio}%` }}
                          />
                        </div>

                        <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
                          <span>
                            {section.completionEventCount}/{section.completionTarget} ליעד
                          </span>
                          <span>{section.practiceCount} תרגולים</span>
                        </div>

                        <p className="mt-3 text-xs text-slate-400">
                          {section.completedParts} תתי־חלקים הושלמו לפחות פעם אחת
                        </p>
                      </Link>
                    )
                  })}
                </div>
              ) : (
                <div className="rounded-2xl bg-slate-100 p-4 text-sm text-slate-600">
                  עדיין אין לתלמיד הזה חלקים מוכנים עם אודיו ושקופיות.
                </div>
              )}
            </div>
          </section>

          <aside className="space-y-4">
            <div className="rounded-[2rem] bg-slate-900 p-6 text-white shadow-sm">
              <p className="text-sm text-slate-300">סיכום התקדמות</p>
              <div className="mt-6 grid grid-cols-3 gap-3">
                <div className="rounded-2xl bg-white/10 p-4 text-center">
                  <p className="text-xs text-slate-300">סה״כ</p>
                  <p className="mt-2 text-3xl font-black">{totalParts}</p>
                </div>
                <div className="rounded-2xl bg-white/10 p-4 text-center">
                  <p className="text-xs text-slate-300">הושלמו</p>
                  <p className="mt-2 text-3xl font-black">{completedParts}</p>
                </div>
                <div className="rounded-2xl bg-white/10 p-4 text-center">
                  <p className="text-xs text-slate-300">תרגולים</p>
                  <p className="mt-2 text-3xl font-black">{totalPractices}</p>
                </div>
              </div>

              <p className="mt-4 text-sm text-slate-300">
                יעד כולל: {totalCompletionEvents}/{totalCompletionTarget || 0} השלמות
              </p>
            </div>

            <div className="rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">מה כבר קיים בקוד</h3>
              <ul className="mt-4 space-y-3 text-sm leading-7 text-slate-600">
                <li>מסך תלמיד שמושך את הפרשה ואת רשימת החלקים הראשיים.</li>
                <li>מסך חלק ראשי שמאתר `lesson_group` לפי פרשה + חלק.</li>
                <li>מסך שיעור שמושך `lesson_parts`, `lesson_slides` ואודיו.</li>
                <li>מעכשיו יש גם בחירת תלמיד אמיתית והתקדמות לפי `practice_events`.</li>
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </main>
  )
}
