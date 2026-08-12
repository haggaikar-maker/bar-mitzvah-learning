import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

const STUDENT_LINK_TTL_HOURS = 24 * 7

function getMainSiteUrl() {
  const mainSiteUrl = process.env.MAIN_SITE_URL

  if (!mainSiteUrl) {
    throw new Error('חסר משתנה סביבה נדרש: MAIN_SITE_URL')
  }

  return mainSiteUrl.replace(/\/$/, '')
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

type StudentAccessLinkInsert = {
  token_hash: string
  student_id: number
  lesson_part_id: number
  created_by_admin_id: number | null
  expires_at: string
}

type StudentAccessLinkRow = {
  token_hash?: string
  student_id: number
  lesson_part_id: number
}

type StudentAccessLinksAdminClient = {
  from: (_table: 'student_access_links') => {
    insert: (values: StudentAccessLinkInsert) => Promise<{
      error: { message: string } | null
    }>
    select: (_columns: string) => {
      eq: (_column: 'token_hash' | 'student_id' | 'lesson_part_id', _value: string | number) => {
        eq: (_column: 'student_id' | 'lesson_part_id', _value: string | number) => {
          gt: (_column: 'expires_at', _value: string) => {
            order: (
              _column: 'created_at',
              options: { ascending: boolean }
            ) => {
              limit: (_value: number) => {
                maybeSingle: () => Promise<{
                  data: StudentAccessLinkRow | null
                  error: { message: string } | null
                }>
              }
            }
          }
        }
        gt: (_column: 'expires_at', _value: string) => {
          maybeSingle: () => Promise<{
            data: StudentAccessLinkRow | null
            error: { message: string } | null
          }>
        }
      }
    }
  }
}

export async function createStudentDirectAccessLink(input: {
  studentId: number
  lessonPartId: number
  adminId: number | null
}) {
  const supabaseAdmin =
    getSupabaseAdmin() as unknown as StudentAccessLinksAdminClient
  const nowIso = new Date().toISOString()
  const { data: existingLink, error: existingLinkError } = await supabaseAdmin
    .from('student_access_links')
    .select('token_hash, student_id, lesson_part_id')
    .eq('student_id', input.studentId)
    .eq('lesson_part_id', input.lessonPartId)
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingLinkError) {
    throw new Error(existingLinkError.message)
  }

  if (existingLink?.token_hash) {
    return `${getMainSiteUrl()}/student/direct/${existingLink.token_hash}`
  }

  const tokenHash = hashToken(randomBytes(32).toString('base64url'))
  const expiresAt = new Date(
    Date.now() + STUDENT_LINK_TTL_HOURS * 60 * 60 * 1000
  ).toISOString()

  const { error } = await supabaseAdmin.from('student_access_links').insert({
    token_hash: tokenHash,
    student_id: input.studentId,
    lesson_part_id: input.lessonPartId,
    created_by_admin_id: input.adminId,
    expires_at: expiresAt,
  })

  if (error) {
    throw new Error(error.message)
  }

  return `${getMainSiteUrl()}/student/direct/${tokenHash}`
}

export async function consumeStudentDirectAccessToken(token: string) {
  const supabaseAdmin =
    getSupabaseAdmin() as unknown as StudentAccessLinksAdminClient
  const tokenHash = /^[a-f0-9]{64}$/i.test(token) ? token : hashToken(token)
  const nowIso = new Date().toISOString()

  const { data, error } = await supabaseAdmin
    .from('student_access_links')
    .select('student_id, lesson_part_id')
    .eq('token_hash', tokenHash)
    .gt('expires_at', nowIso)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data
}
