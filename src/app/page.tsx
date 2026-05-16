import { redirect } from 'next/navigation'
import { getAdminSession } from '@/lib/admin-auth'
import { getStudentSession } from '@/lib/student-auth'
import { loginUser } from './auth-actions'
import { PendingSubmitButton } from '../components/pending-submit-button'

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const [adminSession, studentSession, resolvedSearchParams] = await Promise.all([
    getAdminSession(),
    getStudentSession(),
    searchParams,
  ])

  if (adminSession) {
    redirect('/admin')
  }

  if (studentSession) {
    redirect('/student')
  }

  const errorCode = Array.isArray(resolvedSearchParams.error)
    ? resolvedSearchParams.error[0]
    : resolvedSearchParams.error

  const errorMessage =
    errorCode === 'missing'
      ? 'יש למלא שם משתמש וסיסמה.'
      : errorCode === 'invalid'
        ? 'שם המשתמש או הסיסמה אינם נכונים.'
        : null

  return (
    <main className="min-h-screen bg-[#f7f4ec] px-4 py-6 sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-5xl flex-col gap-5">
        <section
          className="overflow-hidden rounded-[2.5rem] border border-amber-100 px-6 py-8 text-center shadow-sm"
          style={{
            background:
              "linear-gradient(135deg, rgba(243,147,37,0.92), rgba(252,197,43,0.86)), url('/login-ui/top-banner.jpg') center/cover",
          }}
        >
          <h1 className="text-3xl font-black tracking-tight text-white sm:text-5xl">
            מערכת תרגול לבר מצווה
          </h1>
        </section>

        <div className="mx-auto w-full max-w-md rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
          <h2 className="text-4xl font-black tracking-tight text-slate-900">
            התחברות
          </h2>

          <form action={loginUser} className="mt-8 space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">
                שם משתמש
              </span>
              <input
                name="username"
                type="text"
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">
                סיסמה
              </span>
              <input
                name="password"
                type="password"
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none"
              />
            </label>

            <PendingSubmitButton
              label="כניסה למערכת"
              pendingLabel="בודק..."
              className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-80"
            />
          </form>

          {errorMessage ? (
            <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
              {errorMessage}
            </div>
          ) : null}
        </div>

        <section
          className="mt-auto overflow-hidden rounded-[2.5rem] border border-sky-100 px-6 py-6 shadow-sm"
          style={{
            background:
              "linear-gradient(135deg, rgba(247,244,236,0.88), rgba(121,164,200,0.86)), url('/login-ui/footer-banner.jpg') center/cover",
          }}
        >
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-sm font-medium text-slate-700">
              תרגול נעים, ברור ומדויק בכל כניסה מחדש.
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}
