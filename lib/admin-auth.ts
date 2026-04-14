import 'server-only'

import { cookies } from 'next/headers'
import { supabase } from '@/lib/supabase'
import {
  signAdminSession,
  verifyAdminSession,
} from '@/lib/admin-security'

const ADMIN_SESSION_COOKIE = 'bar_mitzvah_admin'

export type AdminSession = {
  id: number | null
  username: string
  displayName: string
  role: 'primary' | 'teacher'
  isEnvFallback: boolean
}

export function getConfiguredAdmin(): {
  isConfigured: boolean
  username: string | undefined
  password: string | undefined
  displayName: string
  role: AdminSession['role']
} {
  const username = process.env.ADMIN_USERNAME
  const password = process.env.ADMIN_PASSWORD
  const displayName = process.env.ADMIN_DISPLAY_NAME ?? username ?? 'מנהל'
  const role: AdminSession['role'] =
    process.env.ADMIN_ROLE === 'teacher' ? 'teacher' : 'primary'

  return {
    isConfigured: Boolean(username && password),
    username,
    password,
    displayName,
    role,
  }
}

export async function getAdminSession() {
  const cookieStore = await cookies()
  const rawSessionValue = cookieStore.get(ADMIN_SESSION_COOKIE)?.value
  const admin = getConfiguredAdmin()

  if (!rawSessionValue) {
    return null
  }

  const verifiedPayload = verifyAdminSession(rawSessionValue)

  if (!verifiedPayload) {
    return null
  }

  if (verifiedPayload.startsWith('env:')) {
    const username = verifiedPayload.slice(4)

    if (!admin.isConfigured || username !== admin.username) {
      return null
    }

    return {
      id: null,
      username: admin.username!,
      displayName: admin.displayName,
      role: admin.role === 'teacher' ? 'teacher' : 'primary',
      isEnvFallback: true,
    } satisfies AdminSession
  }

  if (!verifiedPayload.startsWith('db:')) {
    return null
  }

  const adminId = Number(verifiedPayload.slice(3))

  if (!Number.isFinite(adminId)) {
    return null
  }

  const { data, error } = await supabase
    .from('admins')
    .select('id, username, display_name, role')
    .eq('id', adminId)
    .maybeSingle()

  if (error || !data) {
    return null
  }

  return {
    id: data.id,
    username: data.username,
    displayName: data.display_name,
    role: data.role === 'teacher' ? 'teacher' : 'primary',
    isEnvFallback: false,
  } satisfies AdminSession
}

export async function requireAdminSession() {
  const session = await getAdminSession()

  if (!session) {
    throw new Error('נדרשת התחברות מנהל')
  }

  return session
}

export async function createAdminSession(input: {
  username: string
  adminId?: number | null
}) {
  const cookieStore = await cookies()
  const payload = input.adminId ? `db:${input.adminId}` : `env:${input.username}`

  cookieStore.set({
    name: ADMIN_SESSION_COOKIE,
    value: signAdminSession(payload),
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 10,
  })
}

export async function clearAdminSession() {
  const cookieStore = await cookies()
  cookieStore.delete(ADMIN_SESSION_COOKIE)
}
