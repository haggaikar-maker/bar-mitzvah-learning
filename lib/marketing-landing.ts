import 'server-only'

import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { sanitizePhoneNumber } from '@/lib/whatsapp'

export type MarketingDemoSessionRow = {
  id: number
  raw_phone: string
  normalized_phone: string
  demo_student_id: number
  status: 'active' | 'awaiting_details' | 'completed'
  lead_name: string | null
  lead_role: string | null
  lead_email: string | null
  lead_notes: string | null
  expires_at: string
}

type MarketingDemoSessionInsert = {
  raw_phone: string
  normalized_phone: string
  demo_student_id: number
  status: MarketingDemoSessionRow['status']
  requested_template_name: string | null
  expires_at: string
  updated_at: string
}

type MarketingLeadInsert = {
  source: string
  full_name: string | null
  contact_role: string | null
  phone: string | null
  normalized_phone: string | null
  email: string | null
  notes: string | null
  related_demo_session_id: number | null
}

type MarketingDemoSessionsClient = {
  from: (_table: 'marketing_demo_sessions') => {
    select: (_columns: string) => {
      eq: (_column: string, _value: unknown) => {
        gt: (_column: string, _value: unknown) => {
          maybeSingle: () => Promise<{
            data: MarketingDemoSessionRow | null
            error: { message: string } | null
          }>
        }
      }
    }
    upsert: (
      values: MarketingDemoSessionInsert,
      options: { onConflict: string }
    ) => Promise<{ error: { message: string } | null }>
    update: (values: Record<string, unknown>) => {
      eq: (_column: string, _value: unknown) => Promise<{ error: { message: string } | null }>
    }
  }
}

type MarketingLeadsClient = {
  from: (_table: 'marketing_leads') => {
    insert: (values: MarketingLeadInsert) => Promise<{ error: { message: string } | null }>
  }
}

function getDemoExpiryIso(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

export async function upsertMarketingDemoSession(input: {
  phone: string
  demoStudentId: number
  templateName: string | null
  sessionHours: number
}) {
  const normalizedPhone = sanitizePhoneNumber(input.phone)

  if (!normalizedPhone) {
    throw new Error('יש להזין מספר טלפון תקין.')
  }

  const supabaseAdmin =
    getSupabaseAdmin() as unknown as MarketingDemoSessionsClient
  const nowIso = new Date().toISOString()

  const { error } = await supabaseAdmin.from('marketing_demo_sessions').upsert(
    {
      raw_phone: input.phone,
      normalized_phone: normalizedPhone,
      demo_student_id: input.demoStudentId,
      status: 'active',
      requested_template_name: input.templateName,
      expires_at: getDemoExpiryIso(input.sessionHours),
      updated_at: nowIso,
    },
    { onConflict: 'normalized_phone' }
  )

  if (error) {
    throw new Error(error.message)
  }

  return normalizedPhone
}

export async function getMarketingDemoSessionByPhone(rawPhone: string) {
  const normalizedPhone = sanitizePhoneNumber(rawPhone)

  if (!normalizedPhone) {
    return null
  }

  const supabaseAdmin =
    getSupabaseAdmin() as unknown as MarketingDemoSessionsClient
  const { data, error } = await supabaseAdmin
    .from('marketing_demo_sessions')
    .select(
      'id, raw_phone, normalized_phone, demo_student_id, status, lead_name, lead_role, lead_email, lead_notes, expires_at'
    )
    .eq('normalized_phone', normalizedPhone)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function updateMarketingDemoSession(
  sessionId: number,
  values: Record<string, unknown>
) {
  const supabaseAdmin =
    getSupabaseAdmin() as unknown as MarketingDemoSessionsClient
  const { error } = await supabaseAdmin
    .from('marketing_demo_sessions')
    .update({
      ...values,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId)

  if (error) {
    throw new Error(error.message)
  }
}

export async function insertMarketingLead(input: {
  source: 'landing_form' | 'whatsapp_100'
  fullName: string | null
  role: string | null
  phone: string | null
  email: string | null
  notes: string | null
  relatedDemoSessionId?: number | null
}) {
  const supabaseAdmin =
    getSupabaseAdmin() as unknown as MarketingLeadsClient
  const normalizedPhone = input.phone ? sanitizePhoneNumber(input.phone) : null

  const { error } = await supabaseAdmin.from('marketing_leads').insert({
    source: input.source,
    full_name: input.fullName,
    contact_role: input.role,
    phone: input.phone,
    normalized_phone: normalizedPhone,
    email: input.email,
    notes: input.notes,
    related_demo_session_id: input.relatedDemoSessionId ?? null,
  })

  if (error) {
    throw new Error(error.message)
  }
}

export function buildMarketingLeadNotificationText(input: {
  source: 'landing_form' | 'whatsapp_100'
  fullName: string | null
  role: string | null
  phone: string | null
  email: string | null
  notes: string | null
}) {
  const sourceLabel =
    input.source === 'whatsapp_100'
      ? 'ליד חדש מ-WhatsApp'
      : 'ליד חדש מדף השיווק'

  return [
    sourceLabel,
    '',
    `שם: ${input.fullName || 'לא הוזן'}`,
    `סוג ליווי: ${input.role || 'לא הוזן'}`,
    `טלפון: ${input.phone || 'לא הוזן'}`,
    `אימייל: ${input.email || 'לא הוזן'}`,
    `הערות: ${input.notes || 'ללא הערות'}`,
  ].join('\n')
}

export function parseWhatsAppLeadDetailsMessage(bodyText: string) {
  const compact = bodyText.trim()
  if (!compact) {
    return null
  }

  const lines = compact
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const values = {
    name: '',
    role: '',
    email: '',
    notes: '',
  }

  for (const line of lines) {
    if (line.startsWith('שם:')) {
      values.name = line.replace('שם:', '').trim()
      continue
    }
    if (line.startsWith('ליווי:')) {
      values.role = line.replace('ליווי:', '').trim()
      continue
    }
    if (line.startsWith('אימייל:')) {
      values.email = line.replace('אימייל:', '').trim()
      continue
    }
    if (line.startsWith('הערות:')) {
      values.notes = line.replace('הערות:', '').trim()
      continue
    }
  }

  return {
    name: values.name || null,
    role: values.role || null,
    email: values.email || null,
    notes: values.notes || compact,
  }
}
