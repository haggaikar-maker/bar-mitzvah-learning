import { redirect } from 'next/navigation'
import { getAdminSession } from '@/lib/admin-auth'
import { getStudentSession } from '@/lib/student-auth'
import { loginUser } from './auth-actions'

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
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto max-w-md rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
        <p className="text-sm font-medium text-blue-700">מערכת תרגול לבר מצווה</p>
        <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-900">
          התחברות
        </h1>
        <p className="mt-4 text-base leading-8 text-slate-600">
          תלמידים ומנהלים נכנסים מאותו מסך. המערכת תזהה לבד לאיזה אזור להעביר
          אותך.
        </p>

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

          <button
            type="submit"
            className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
          >
            כניסה למערכת
          </button>
        </form>

        {errorMessage ? (
          <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
            {errorMessage}
          </div>
        ) : null}
      </div>
    </main>
  )
}
