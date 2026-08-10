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
  student_id: number
  lesson_part_id: number
}

type StudentAccessLinksAdminClient = {
  from: (_table: 'student_access_links') => {
    insert: (values: StudentAccessLinkInsert) => Promise<{
      error: { message: string } | null
    }>
    update: (values: { used_at: string }) => {
      eq: (_column: 'token_hash', _value: string) => {
        is: (_column: 'used_at', _value: null) => {
          gt: (_column: 'expires_at', _value: string) => {
            select: (_columns: string) => {
              maybeSingle: () => Promise<{
                data: StudentAccessLinkRow | null
                error: { message: string } | null
              }>
            }
          }
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
  const rawToken = randomBytes(32).toString('base64url')
  const tokenHash = hashToken(rawToken)
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

  return `${getMainSiteUrl()}/student/direct/${rawToken}`
}

export async function consumeStudentDirectAccessToken(token: string) {
  const supabaseAdmin =
    getSupabaseAdmin() as unknown as StudentAccessLinksAdminClient
  const tokenHash = hashToken(token)
  const nowIso = new Date().toISOString()

  const { data, error } = await supabaseAdmin
    .from('student_access_links')
    .update({ used_at: nowIso })
    .eq('token_hash', tokenHash)
    .is('used_at', null)
    .gt('expires_at', nowIso)
    .select('student_id, lesson_part_id')
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data
}
