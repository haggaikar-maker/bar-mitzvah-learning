import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  getLessonPageData,
} from '@/lib/practice-data'
import { requireStudentSession } from '@/lib/student-auth'
import { logoutUser } from '../../../auth-actions'
import LessonExperience from './lesson-experience'

type LessonPageProps = {
  params: Promise<{ partId: string }>
}

export default async function LessonPage({
  params,
}: LessonPageProps) {
  const { partId } = await params
  const partIdNumber = Number(partId)
  const session = await requireStudentSession()

  if (!partId || Number.isNaN(partIdNumber)) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">מזהה תת-חלק לא תקין</h1>
        <p className="mt-3">partId שהתקבל: {String(partId)}</p>
      </main>
    )
  }

  const {
    student,
    lessonPart,
    lessonGroup,
    section,
    slides,
    practiceEvents,
    navigation,
    parashaName,
    error,
  } = await getLessonPageData(partIdNumber, session.id)
  const errorMessage = error instanceof Error ? error.message : null

  if (error && !student) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">שגיאה בטעינת תלמיד</h1>
        <p className="mt-3">{error.message}</p>
      </main>
    )
  }

  if (error && !lessonPart) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">שיעור לא נמצא</h1>
        <p className="mt-3">{error.message}</p>
      </main>
    )
  }

  if (!student || !lessonPart || !lessonGroup || !section) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">שגיאה בטעינת השיעור</h1>
        <p className="mt-3">{error?.message ?? 'חסרים נתוני שיעור'}</p>
      </main>
    )
  }

  if (student.id !== session.id) {
    redirect('/student')
  }

  if (error) {
    return (
      <main className="student-app">
        <div className="student-shell">
          <div className="student-card mx-auto max-w-3xl p-6 sm:p-8">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Link
              href={`/student/section/${lessonGroup.section_id}`}
              className="student-floating-chip inline-block px-4 py-2 text-sm font-semibold text-slate-700"
            >
              חזרה לתת-חלקים
            </Link>
          </div>

          <h1 className="text-2xl font-bold text-slate-900">הקטע עדיין לא זמין</h1>
          <p className="mt-4 text-sm leading-7 text-slate-600">{error.message}</p>
        </div>
        </div>
      </main>
    )
  }

  return (
    <main className="student-app">
      <div className="student-shell">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Link
            href={`/student/section/${lessonGroup.section_id}`}
            className="student-floating-chip inline-block px-4 py-2 text-sm font-semibold text-slate-700"
          >
            חזרה לתת-חלקים
          </Link>
          {navigation.previous ? (
            <Link
              href={`/student/lesson/${navigation.previous.id}`}
              className="student-floating-chip inline-block px-4 py-2 text-sm font-semibold text-slate-700"
            >
              לחלק הקודם
            </Link>
          ) : null}
          {navigation.next ? (
            <Link
              href={`/student/lesson/${navigation.next.id}`}
              className="inline-block rounded-xl bg-[var(--student-orange)] px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-orange-400/25"
            >
              לחלק הבא
            </Link>
          ) : null}
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
          <div className="relative z-10 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="text-white">
              <span className="student-badge bg-white/16 text-white ring-1 ring-white/20">
                הקשבה חכמה ומרוכזת
              </span>
              <p className="mt-5 text-sm font-semibold text-white/85">פרשה</p>
              <h1 className="mt-2 text-3xl font-black sm:text-4xl">
                {parashaName ?? 'לא הוגדרה פרשה'}
              </h1>
              <div className="mt-5 rounded-[24px] bg-white/12 p-4 backdrop-blur-sm">
                <p className="text-sm text-white/75">חלק</p>
                <h2 className="mt-1 text-2xl font-black">{section.name}</h2>
                <p className="mt-4 text-sm text-white/75">תת־חלק</p>
                <h3 className="mt-1 text-4xl font-black">{lessonPart.name}</h3>
                <p className="mt-3 text-sm leading-7 text-white/85">
                  אפשר לעבור ישר לקטע הבא או לחזור לקטע קודם לפי סדר הקריאה.
                </p>
              </div>
            </div>

            <div className="student-glass-card p-5 text-[var(--student-ink)]">
              <p className="text-sm font-semibold text-slate-500">ניווט מהיר</p>
              <div className="mt-4 grid gap-3">
                <div className="rounded-2xl bg-white/85 px-4 py-3 text-sm text-slate-700">
                  קטע קודם: {navigation.previous?.name ?? 'זה הקטע הראשון כרגע'}
                </div>
                <div className="rounded-2xl bg-white/85 px-4 py-3 text-sm text-slate-700">
                  קטע הבא: {navigation.next?.name ?? 'זה הקטע האחרון כרגע'}
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="mt-6 student-card p-6 shadow-sm ring-1 ring-white/50 sm:p-8">
          <div className="mt-2 grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
            <LessonExperience
              audioUrl={lessonPart.audio_url}
              durationSeconds={lessonPart.duration_seconds}
              initialPracticeEvents={practiceEvents}
              initialSlides={slides}
              lessonPartId={lessonPart.id}
            />
          </div>

          {errorMessage ? (
            <div className="mt-6 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
              {errorMessage}
            </div>
          ) : null}
        </div>

        <section className="mt-6 student-footer-banner">
          <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <p className="text-sm font-semibold text-white/75">ממשיכים ברצף</p>
              <h3 className="mt-2 text-2xl font-black">שומעים, מסיימים, ומתקדמים</h3>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-white/85">
                כל קטע כאן בנוי כדי לעזור לשמור על זרימה, ריכוז ותחושת הצלחה לאורך כל הקריאה.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
