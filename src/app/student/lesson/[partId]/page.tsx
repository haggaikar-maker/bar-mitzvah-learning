import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  getLessonPageData,
} from '@/lib/practice-data'
import { getLessonMediaKind, getLessonMediaUrl } from '@/lib/lesson-media'
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
    studentRecording,
    navigation,
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
              href="/student"
              className="student-floating-chip inline-block px-4 py-2 text-sm font-semibold text-slate-700"
            >
              חזרה לקריאות
            </Link>
          </div>

          <h1 className="text-2xl font-bold text-slate-900">הקטע עדיין לא זמין</h1>
          <p className="mt-4 text-sm leading-7 text-slate-600">{error.message}</p>
        </div>
        </div>
      </main>
    )
  }

  const mediaKind = getLessonMediaKind(lessonPart)
  const mediaUrl = getLessonMediaUrl(lessonPart)

  return (
    <main className="student-app">
      <div className="student-shell">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Link
            href="/student"
            className="student-floating-chip inline-block px-4 py-2 text-sm font-semibold text-slate-700"
          >
            חזרה לקריאות
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
          <div className="relative z-10 text-white">
            <div className="rounded-[24px] bg-white/12 p-4 backdrop-blur-sm">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                <div className="min-w-0 text-right">
                  {navigation.previous ? (
                    <Link
                      href={`/student/lesson/${navigation.previous.id}`}
                      className="block rounded-2xl bg-white/10 px-3 py-2 text-white transition hover:bg-white/20"
                    >
                      <div className="text-[11px] text-white/70">הקודם</div>
                      <div className="truncate text-sm font-semibold">
                        {navigation.previous.name}
                      </div>
                    </Link>
                  ) : (
                    <div className="rounded-2xl bg-white/5 px-3 py-2 text-white/50">
                      <div className="text-[11px]">הקודם</div>
                      <div className="truncate text-sm font-semibold">-</div>
                    </div>
                  )}
                </div>
                <div className="text-center">
                  <h1 className="text-3xl font-black sm:text-4xl">{lessonPart.name}</h1>
                  <p className="mt-2 text-sm font-semibold text-white/80">{section.name}</p>
                </div>
                <div className="min-w-0 text-left">
                  {navigation.next ? (
                    <Link
                      href={`/student/lesson/${navigation.next.id}`}
                      className="block rounded-2xl bg-white/10 px-3 py-2 text-white transition hover:bg-white/20"
                    >
                      <div className="text-[11px] text-white/70">הבא</div>
                      <div className="truncate text-sm font-semibold">
                        {navigation.next.name}
                      </div>
                    </Link>
                  ) : (
                    <div className="rounded-2xl bg-white/5 px-3 py-2 text-white/50">
                      <div className="text-[11px]">הבא</div>
                      <div className="truncate text-sm font-semibold">-</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="mt-6 student-card p-6 shadow-sm ring-1 ring-white/50 sm:p-8">
          <div className="mt-2 grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
            <LessonExperience
              mediaKind={mediaKind}
              mediaUrl={mediaUrl}
              durationSeconds={lessonPart.duration_seconds}
              initialPracticeEvents={practiceEvents}
              initialSlides={slides}
              studentRecording={studentRecording}
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
              <h3 className="text-2xl font-black">המשך רציף לקטע הבא</h3>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
