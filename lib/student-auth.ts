import 'server-only'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { signSession, verifySession } from '@/lib/admin-security'

const STUDENT_SESSION_COOKIE = 'bar_mitzvah_student'

export type StudentSession = {
  id: number
  adminId: number | null
  username: string
  name: string
  parashaId: number | null
}

export async function getStudentSession() {
  const cookieStore = await cookies()
  const rawSessionValue = cookieStore.get(STUDENT_SESSION_COOKIE)?.value

  if (!rawSessionValue) {
    return null
  }

  const verifiedPayload = verifySession(rawSessionValue)

  if (!verifiedPayload?.startsWith('student:')) {
    return null
  }

  const studentId = Number(verifiedPayload.slice('student:'.length))

  if (!Number.isFinite(studentId)) {
    return null
  }

  const { data, error } = await supabase
    .from('students')
    .select('id, admin_id, username, name, parasha_id')
    .eq('id', studentId)
    .maybeSingle()

  if (error || !data || !data.username) {
    return null
  }

  return {
    id: data.id,
    adminId: data.admin_id,
    username: data.username,
    name: data.name,
    parashaId: data.parasha_id,
  } satisfies StudentSession
}

export async function requireStudentSession() {
  const session = await getStudentSession()

  if (!session) {
    redirect('/')
  }

  return session
}

export async function createStudentSession(studentId: number) {
  const cookieStore = await cookies()

  cookieStore.set({
    name: STUDENT_SESSION_COOKIE,
    value: signSession(`student:${studentId}`),
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 10,
  })
}

export async function clearStudentSession() {
  const cookieStore = await cookies()
  cookieStore.delete(STUDENT_SESSION_COOKIE)
}
