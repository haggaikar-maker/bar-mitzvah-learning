import Link from 'next/link'
import { redirect } from 'next/navigation'
import { logoutUser } from '../../../auth-actions'
import { getSectionPageData } from '@/lib/practice-data'
import { AudioDuration } from '../../../../components/audio-duration'
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
    <main className="student-app">
      <div className="student-shell max-w-6xl">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Link
            href="/student"
            className="student-floating-chip inline-block px-4 py-2 text-sm font-semibold text-slate-700"
          >
            חזרה לחלקים
          </Link>
          <form action={logoutUser}>
            <button
              type="submit"
              className="rounded-xl bg-[var(--student-ink)] px-4 py-2 text-sm font-semibold text-white"
            >
              יציאה
            </button>
          </form>
        </div>

        <section className="student-hero">
          <div className="relative z-10 grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="text-white">
              <span className="student-badge bg-white/16 text-white ring-1 ring-white/20">
                מסלול תרגול פעיל
              </span>
              <h1 className="mt-4 text-4xl font-black sm:text-5xl">
                {section.name}
              </h1>
              <p className="mt-4 text-base leading-8 text-white/90">
                כאן נמצאים תתי־החלקים שמוכנים לתלמיד כרגע. כל כרטיס מוביל ישירות
                למסך האזנה עם ניווט קדימה ואחורה.
              </p>
            </div>

            <div className="student-glass-card p-5 text-[var(--student-ink)]">
              <p className="text-sm font-semibold text-slate-500">פרשה</p>
              <h2 className="mt-2 text-3xl font-black">
                {parashaName ?? 'לא הוגדרה פרשה'}
              </h2>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-white/85 p-4 text-center">
                  <p className="text-xs text-slate-500">תתי־חלקים</p>
                  <p className="mt-2 text-3xl font-black text-slate-900">{parts.length}</p>
                </div>
                <div className="rounded-2xl bg-white/85 p-4 text-center">
                  <p className="text-xs text-slate-500">זמינות</p>
                  <p className="mt-2 text-sm font-bold text-slate-700">מוכנים לתרגול</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="mt-6 student-card p-6 shadow-sm ring-1 ring-white/50 sm:p-8">
          <div className="student-image-slot rounded-[28px] p-5 text-white">
            <h3 className="text-2xl font-black">בחר תת־חלק שמוכן להאזנה</h3>
          </div>

          <div className="mt-8">
            {parts.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {parts.map((part) => (
                  <Link
                    key={part.id}
                    href={`/student/lesson/${part.id}`}
                    className="student-section-card p-5 ring-1 ring-white/70"
                  >
                    <div className="relative z-10">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="text-xl font-black text-slate-900">
                            {part.name}
                          </h4>
                          <p className="mt-1 text-sm text-slate-500">
                            {part.is_full_reading ? 'קריאה מלאה' : `סדר ${part.part_order}`}
                          </p>
                        </div>

                        <span className="student-badge bg-white text-[var(--student-ink)] ring-1 ring-slate-200">
                          {part.practiceCount} תרגולים
                        </span>
                      </div>

                      <div className="mt-5 grid gap-3">
                        <div className="flex items-center justify-between rounded-2xl bg-white/80 px-4 py-3 text-sm text-slate-700 ring-1 ring-white/80">
                          <span>{part.completedCount}/{part.completionTarget} ליעד</span>
                          <span>
                            <AudioDuration
                              src={part.audio_url}
                              fallback="ללא משך"
                              loadingLabel="טוען משך..."
                            />
                          </span>
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-white/80 px-4 py-3 text-sm text-slate-700 ring-1 ring-white/80">
                          <span>{part.slideCount} שקופיות מסונכרנות</span>
                          <span>{part.isReady ? 'מוכן' : 'לא מוכן'}</span>
                        </div>
                      </div>

                      <p className="mt-4 text-xs text-slate-500">
                        {part.lastPracticedAt
                          ? `תרגול אחרון: ${new Date(part.lastPracticedAt).toLocaleString('he-IL')}`
                          : 'עדיין לא תורגל'}
                      </p>

                      <div className="mt-4 flex items-center justify-between text-sm font-semibold text-slate-700">
                        <span>פתיחת הקטע</span>
                        <span>←</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="student-card border border-dashed border-[var(--student-blue)]/40 bg-white/70 p-5 text-sm text-slate-600">
                אין עדיין תתי-חלקים מוכנים לחלק הזה. רק קטעים עם אודיו ולפחות שקופית אחת מוצגים לתלמיד.
              </div>
            )}
          </div>

          {error ? (
            <div className="mt-6 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
              {error.message}
            </div>
          ) : null}
        </div>

        <section className="mt-6 student-footer-banner">
          <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <p className="text-sm font-semibold text-white/75">טיפ ללמידה טובה</p>
              <h3 className="mt-2 text-2xl font-black">לעבוד קצר, רצוף, ולהמשיך לקטע הבא</h3>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-white/85">
                ככל שהניווט מהיר ונעים יותר, יותר קל לשמור על רצף הקשבה ותחושת הצלחה.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
