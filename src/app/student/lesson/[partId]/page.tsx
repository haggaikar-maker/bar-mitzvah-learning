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
      <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto max-w-3xl rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Link
              href={`/student/section/${lessonGroup.section_id}`}
              className="inline-block rounded-xl bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200"
            >
              חזרה לתת-חלקים
            </Link>
          </div>

          <h1 className="text-2xl font-bold text-slate-900">הקטע עדיין לא זמין</h1>
          <p className="mt-4 text-sm leading-7 text-slate-600">{error.message}</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Link
            href={`/student/section/${lessonGroup.section_id}`}
            className="inline-block rounded-xl bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200"
          >
            חזרה לתת-חלקים
          </Link>
          {navigation.previous ? (
            <Link
              href={`/student/lesson/${navigation.previous.id}`}
              className="inline-block rounded-xl bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200"
            >
              לחלק הקודם
            </Link>
          ) : null}
          {navigation.next ? (
            <Link
              href={`/student/lesson/${navigation.next.id}`}
              className="inline-block rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
            >
              לחלק הבא
            </Link>
          ) : null}
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
            <p className="text-sm text-slate-600">חלק</p>
            <h2 className="mt-2 text-2xl font-bold text-slate-900">
              {section.name}
            </h2>

            <p className="mt-3 text-sm text-slate-600">תת-חלק</p>
            <h3 className="mt-1 text-4xl font-extrabold text-slate-900">
              {lessonPart.name}
            </h3>
            <p className="mt-3 text-sm text-slate-600">
              אפשר לעבור ישר לקטע הבא או לחזור לקטע קודם לפי סדר הקריאה.
            </p>
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
            <LessonExperience
              audioUrl={lessonPart.audio_url}
              durationSeconds={lessonPart.duration_seconds}
              initialPracticeEvents={practiceEvents}
              initialSlides={slides}
              lessonPartId={lessonPart.id}
            />
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
