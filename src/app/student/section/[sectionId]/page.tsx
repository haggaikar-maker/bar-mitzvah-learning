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

  const { student, section, parts, error } =
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
          <div className="relative z-10">
            <div className="text-white">
              <h1 className="mt-2 text-4xl font-black sm:text-5xl">
                {section.name}
              </h1>
              <p className="mt-4 text-sm font-semibold text-white/85">
                {parts.length} תתי־חלקים
              </p>
            </div>
          </div>
        </section>

        <div className="mt-6 student-card p-4 shadow-sm ring-1 ring-white/50 sm:p-6">
          <div className="mt-2">
            {parts.length > 0 ? (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {parts.map((part) => (
                  <Link
                    key={part.id}
                    href={`/student/lesson/${part.id}`}
                    className="student-section-card p-2.5 ring-1 ring-white/70"
                  >
                    <div className="relative z-10">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="text-base font-black leading-tight text-slate-900 sm:text-lg">
                            {part.name}
                          </h4>
                        </div>
                      </div>

                      <div className="mt-3 grid gap-1.5">
                        <div className="flex items-center justify-between rounded-2xl bg-white/80 px-3 py-2 text-xs text-slate-700 ring-1 ring-white/80 sm:text-sm">
                          <span>{part.completedCount}/{part.completionTarget} ליעד</span>
                          <span>
                            <AudioDuration
                              src={part.mediaUrl}
                              kind={part.mediaKind === 'video' ? 'video' : 'audio'}
                              fallback={part.mediaKind === 'video' ? 'ללא וידאו' : 'ללא אודיו'}
                              loadingLabel={
                                part.mediaKind === 'video' ? 'טוען משך וידאו...' : 'טוען משך אודיו...'
                              }
                            />
                          </span>
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-white/80 px-3 py-2 text-xs text-slate-700 ring-1 ring-white/80 sm:text-sm">
                          <span>{part.practiceCount} תרגולים</span>
                          <span>{part.mediaKind === 'video' ? 'וידאו' : 'תמונות'}</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="student-card border border-dashed border-[var(--student-blue)]/40 bg-white/70 p-5 text-sm text-slate-600">
                אין עדיין תתי-חלקים מוכנים לחלק הזה. רק קטעים עם מדיה פעילה מוצגים לתלמיד.
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
