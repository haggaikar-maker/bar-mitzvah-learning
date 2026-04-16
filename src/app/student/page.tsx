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
  const heroCompletionRatio =
    totalCompletionTarget > 0
      ? Math.min(
          100,
          Math.round((totalCompletionEvents / totalCompletionTarget) * 100)
        )
      : 0

  return (
    <main className="student-app">
      <div className="student-shell space-y-6">
        <section className="student-hero text-white">
          <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
                שלום {student.name}
              </h1>
            </div>

            <div className="student-glass-card min-w-[240px] p-4 text-[var(--student-ink)]">
              <p className="text-xs font-semibold text-slate-500">פרשה פעילה</p>
              <h2 className="mt-2 text-2xl font-black">{parashaName ?? 'לא הוגדרה פרשה'}</h2>
              <div className="mt-4 student-progress-track">
                <div
                  className="student-progress-fill"
                  style={{ width: `${heroCompletionRatio}%` }}
                />
              </div>
              <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
                <span>{totalCompletionEvents}/{totalCompletionTarget} אל היעד</span>
                <span>{heroCompletionRatio}% הושג</span>
              </div>
            </div>
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/"
            className="student-floating-chip inline-flex px-4 py-2 text-sm font-semibold text-slate-700"
          >
            חזרה להתחברות
          </Link>
          <form action={logoutUser}>
            <button
              type="submit"
              className="rounded-2xl bg-[var(--student-ink)] px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-slate-900/15"
            >
              יציאה
            </button>
          </form>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
          <section className="student-card p-4 sm:p-6">
            <div className="student-image-slot rounded-[24px] p-4 text-white">
              <p className="text-base font-black sm:text-2xl">מרכז המשימות שלך</p>
            </div>

            <div className="mt-5">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="student-panel-title text-slate-900">
                    בחר חלק לתרגול
                  </h3>
                </div>
              </div>

              {sections.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
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
                        className="student-section-card p-4 ring-1 ring-white/70"
                      >
                        <div className="relative z-10">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <h4 className="text-xl font-black text-slate-900">
                                {section.name}
                              </h4>
                              <p className="mt-1 text-xs text-slate-500 sm:text-sm">
                                {section.totalParts} תתי־חלקים זמינים
                              </p>
                            </div>
                            <span className="student-badge bg-white text-[var(--student-ink)] ring-1 ring-slate-200">
                              {section.practiceCount} תרגולים
                            </span>
                          </div>

                          <div className="mt-4 student-progress-track">
                            <div
                              className="student-progress-fill"
                              style={{ width: `${completionRatio}%` }}
                            />
                          </div>

                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            <div className="rounded-2xl bg-white/80 px-3 py-2 text-xs text-slate-700 ring-1 ring-white/80 sm:text-sm">
                              יעד חלק: {section.completionEventCount}/{section.completionTarget}
                            </div>
                            <div className="rounded-2xl bg-white/80 px-3 py-2 text-xs text-slate-700 ring-1 ring-white/80 sm:text-sm">
                              {section.completedParts} קטעים הושלמו לפחות פעם אחת
                            </div>
                          </div>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              ) : (
                <div className="student-card border border-dashed border-[var(--student-blue)]/40 bg-white/70 p-5 text-sm text-slate-600">
                  עדיין אין לתלמיד הזה חלקים מוכנים עם מדיה פעילה.
                </div>
              )}
            </div>
          </section>

          <aside className="space-y-5">
            <div className="student-footer-banner student-subtle-grid p-4 sm:p-6">
              <p className="text-xs text-white/80 sm:text-sm">לוח התקדמות</p>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-2xl bg-white/12 p-3 text-center backdrop-blur-sm">
                  <p className="text-xs text-white/75">זמינים</p>
                  <p className="mt-1 text-2xl font-black">{totalParts}</p>
                </div>
                <div className="rounded-2xl bg-white/12 p-3 text-center backdrop-blur-sm">
                  <p className="text-xs text-white/75">הושלמו</p>
                  <p className="mt-1 text-2xl font-black">{completedParts}</p>
                </div>
                <div className="rounded-2xl bg-white/12 p-3 text-center backdrop-blur-sm">
                  <p className="text-xs text-white/75">תרגולים</p>
                  <p className="mt-1 text-2xl font-black">{totalPractices}</p>
                </div>
              </div>
              <div className="mt-4 student-progress-track bg-white/15">
                <div
                  className="student-progress-fill"
                  style={{ width: `${heroCompletionRatio}%` }}
                />
              </div>
              <p className="mt-3 text-xs text-white/85 sm:text-sm">
                יעד כולל: {totalCompletionEvents}/{totalCompletionTarget || 0} השלמות
              </p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  )
}
