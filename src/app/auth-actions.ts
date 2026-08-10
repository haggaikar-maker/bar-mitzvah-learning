'use server'

import { redirect } from 'next/navigation'
import { clearAdminSession, createAdminSession, getConfiguredAdmin } from '@/lib/admin-auth'
import { verifyPassword } from '@/lib/admin-security'
import { createStudentSession, clearStudentSession } from '@/lib/student-auth'
import { supabase } from '@/lib/supabase'

function readString(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function sanitizeRedirectTarget(path: string) {
  if (!path || !path.startsWith('/') || path.startsWith('//')) {
    return null
  }

  if (!/^\/(student|admin)(\/|$)/.test(path)) {
    return null
  }

  return path
}

export async function loginUser(formData: FormData) {
  const username = readString(formData, 'username')
  const password = readString(formData, 'password')
  const nextPath = sanitizeRedirectTarget(readString(formData, 'next'))
  const configuredAdmin = getConfiguredAdmin()

  if (!username || !password) {
    redirect('/?error=missing')
  }

  const { data: admin } = await supabase
    .from('admins')
    .select('id, username, password_hash')
    .eq('username', username)
    .maybeSingle()

  if (admin && verifyPassword(password, admin.password_hash)) {
    await clearStudentSession()
    await createAdminSession({ username: admin.username, adminId: admin.id })
    redirect(nextPath?.startsWith('/admin') ? nextPath : '/admin')
  }

  if (
    configuredAdmin.isConfigured &&
    username === configuredAdmin.username &&
    password === configuredAdmin.password
  ) {
    await clearStudentSession()
    await createAdminSession({ username })
    redirect(nextPath?.startsWith('/admin') ? nextPath : '/admin')
  }

  const { data: student } = await supabase
    .from('students')
    .select('id, username, password_hash')
    .eq('username', username)
    .maybeSingle()

  if (student && student.password_hash && verifyPassword(password, student.password_hash)) {
    await clearAdminSession()
    await createStudentSession(student.id)
    redirect(nextPath?.startsWith('/student') ? nextPath : '/student')
  }

  redirect('/?error=invalid')
}

export async function logoutUser() {
  await clearAdminSession()
  await clearStudentSession()
  redirect('/')
}
