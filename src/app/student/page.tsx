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
              <span className="student-badge bg-white/16 text-white ring-1 ring-white/20">
                מסלול אישי לבר מצווה
              </span>
              <h1 className="mt-4 text-4xl font-black tracking-tight sm:text-5xl">
                {student.name}, מתחילים לעבוד חכם על הקריאה שלך
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-8 text-white/90 sm:text-lg">
                כל חלק שמופיע כאן כבר מוכן עם אודיו ושקופיות. אפשר להתקדם בקצב שלך,
                לחזור לקטעים קודמים, ולראות בכל רגע כמה עוד נשאר עד היעד.
              </p>
            </div>

            <div className="student-glass-card min-w-[280px] p-4 text-[var(--student-ink)]">
              <p className="text-sm font-semibold text-slate-500">פרשה פעילה</p>
              <h2 className="mt-2 text-3xl font-black">{parashaName ?? 'לא הוגדרה פרשה'}</h2>
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

        <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
          <section className="student-card p-6 sm:p-8">
            <div className="student-image-slot rounded-[28px] p-6 text-white">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-white/85">מרכז המשימות שלך</p>
                  <h3 className="mt-2 text-3xl font-black sm:text-4xl">
                    החלקים שמוכנים עכשיו לתרגול
                  </h3>
                </div>
                <div className="student-banner-note bg-white/14 text-white ring-1 ring-white/18">
                  רק קטעים מוכנים באמת מוצגים כאן
                </div>
              </div>
            </div>

            <div className="mt-8">
              <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="student-panel-title text-slate-900">
                    בחר חלק לתרגול
                  </h3>
                </div>
              </div>

              {sections.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2">
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
                        className="student-section-card p-5 ring-1 ring-white/70"
                      >
                        <div className="relative z-10">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <h4 className="text-2xl font-black text-slate-900">
                                {section.name}
                              </h4>
                              <p className="mt-2 text-sm text-slate-500">
                                {section.totalParts} תתי־חלקים זמינים
                              </p>
                            </div>
                            <span className="student-badge bg-white text-[var(--student-ink)] ring-1 ring-slate-200">
                              {section.practiceCount} תרגולים
                            </span>
                          </div>

                          <div className="mt-5 student-progress-track">
                            <div
                              className="student-progress-fill"
                              style={{ width: `${completionRatio}%` }}
                            />
                          </div>

                          <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <div className="rounded-2xl bg-white/80 px-4 py-3 text-sm text-slate-700 ring-1 ring-white/80">
                              יעד חלק: {section.completionEventCount}/{section.completionTarget}
                            </div>
                            <div className="rounded-2xl bg-white/80 px-4 py-3 text-sm text-slate-700 ring-1 ring-white/80">
                              {section.completedParts} קטעים הושלמו לפחות פעם אחת
                            </div>
                          </div>

                          <div className="mt-4 flex items-center justify-between text-sm font-semibold text-slate-700">
                            <span>כניסה לחלק</span>
                            <span>←</span>
                          </div>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              ) : (
                <div className="student-card border border-dashed border-[var(--student-blue)]/40 bg-white/70 p-5 text-sm text-slate-600">
                  עדיין אין לתלמיד הזה חלקים מוכנים עם אודיו ושקופיות.
                </div>
              )}
            </div>
          </section>

          <aside className="space-y-5">
            <div className="student-footer-banner student-subtle-grid p-6">
              <p className="text-sm text-white/80">לוח התקדמות</p>
              <div className="mt-5 grid grid-cols-3 gap-3">
                <div className="rounded-2xl bg-white/12 p-4 text-center backdrop-blur-sm">
                  <p className="text-xs text-white/75">זמינים</p>
                  <p className="mt-2 text-3xl font-black">{totalParts}</p>
                </div>
                <div className="rounded-2xl bg-white/12 p-4 text-center backdrop-blur-sm">
                  <p className="text-xs text-white/75">הושלמו</p>
                  <p className="mt-2 text-3xl font-black">{completedParts}</p>
                </div>
                <div className="rounded-2xl bg-white/12 p-4 text-center backdrop-blur-sm">
                  <p className="text-xs text-white/75">תרגולים</p>
                  <p className="mt-2 text-3xl font-black">{totalPractices}</p>
                </div>
              </div>
              <div className="mt-5 student-progress-track bg-white/15">
                <div
                  className="student-progress-fill"
                  style={{ width: `${heroCompletionRatio}%` }}
                />
              </div>
              <p className="mt-4 text-sm text-white/85">
                יעד כולל: {totalCompletionEvents}/{totalCompletionTarget || 0} השלמות
              </p>
            </div>

            <div className="student-card p-6">
              <h3 className="text-xl font-black text-slate-900">איך משתמשים באזור?</h3>
              <div className="mt-4 grid gap-3">
                <div className="rounded-2xl bg-[var(--student-cream)] px-4 py-3 text-sm leading-7 text-slate-700">
                  בוחרים חלק, נכנסים לתת־חלק, ומאזינים ברצף כדי שהמערכת תסמן השלמה.
                </div>
                <div className="rounded-2xl bg-[#eef5fb] px-4 py-3 text-sm leading-7 text-slate-700">
                  אפשר לעבור לקטע הבא ישירות מתוך המסך של ההאזנה, בלי לחזור אחורה כל פעם.
                </div>
                <div className="rounded-2xl bg-[#fff1dc] px-4 py-3 text-sm leading-7 text-slate-700">
                  בהמשך אפשר לשים פה תמונת השראה, פסוק, או מטרה שבועית בעיצוב מלא.
                </div>
              </div>
            </div>

          </aside>
        </div>

        <section className="student-card p-5 sm:p-6">
          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-[28px] bg-gradient-to-l from-[var(--student-gold)]/25 to-[var(--student-orange)]/10 p-5">
              <p className="text-sm font-semibold text-slate-500">מה מחכה בהמשך?</p>
              <h3 className="mt-2 text-2xl font-black text-slate-900">
                אפשר לבנות כאן חוויית לימוד מלאה
              </h3>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
                תמונת רקע לכל חלק, איור לפי פרשה, משפטי חיזוק, או “אתגר השבוע” יכולים
                להיכנס לכאן בלי לשנות את החוקיות של המערכת בכלל.
              </p>
            </div>
            <div className="rounded-[28px] bg-[var(--student-cream)] p-5">
              <p className="text-sm font-semibold text-slate-500">מוכנים להמשיך</p>
              <h3 className="mt-2 text-2xl font-black text-slate-900">
                כל חלק נפתח רק כשהוא באמת מוכן
              </h3>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                כך קל יותר להתרכז, להתקדם שלב אחרי שלב, ולשמור על חוויית לימוד ברורה.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
