import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

function isAuthorized(request: Request) {
  const expected = process.env.TEXT_SYNC_FAILOVER_SECRET ?? ''
  const supplied = request.headers.get('x-text-sync-failover-secret') ?? ''
  if (!expected || !supplied) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(supplied)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { eventType?: string; message?: string; metadata?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const allowedEvents = new Set(['scale_requested', 'scale_failed'])
  const eventType = typeof body.eventType === 'string' ? body.eventType : ''
  if (!allowedEvents.has(eventType)) return NextResponse.json({ error: 'Invalid eventType.' }, { status: 400 })

  // Worker tables are introduced by a manual SQL migration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseAdmin() as any
  const message = String(body.message ?? '').slice(0, 1000)
  if (eventType === 'scale_failed') {
    const recentCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const { count, error: recentError } = await db.from('text_sync_worker_events')
      .select('id', { count: 'exact', head: true }).eq('event_type', eventType)
      .eq('message', message).gte('created_at', recentCutoff)
    if (recentError) return NextResponse.json({ error: recentError.message }, { status: 500 })
    if ((count ?? 0) > 0) return NextResponse.json({ ok: true, deduplicated: true })
  }

  const { error } = await db.from('text_sync_worker_events').insert({
    event_type: eventType,
    message,
    metadata: body.metadata ?? {},
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
