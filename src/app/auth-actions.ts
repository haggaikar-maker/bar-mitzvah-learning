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

export async function loginUser(formData: FormData) {
  const username = readString(formData, 'username')
  const password = readString(formData, 'password')
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
    redirect('/admin')
  }

  if (
    configuredAdmin.isConfigured &&
    username === configuredAdmin.username &&
    password === configuredAdmin.password
  ) {
    await clearStudentSession()
    await createAdminSession({ username })
    redirect('/admin')
  }

  const { data: student } = await supabase
    .from('students')
    .select('id, username, password_hash')
    .eq('username', username)
    .maybeSingle()

  if (student && student.password_hash && verifyPassword(password, student.password_hash)) {
    await clearAdminSession()
    await createStudentSession(student.id)
    redirect('/student')
  }

  redirect('/?error=invalid')
}

export async function logoutUser() {
  await clearAdminSession()
  await clearStudentSession()
  redirect('/')
}
