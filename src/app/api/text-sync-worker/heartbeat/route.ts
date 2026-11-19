import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

function isAuthorized(request: Request) {
  const expected = process.env.TEXT_SYNC_WORKER_SECRET ?? ''
  const supplied = request.headers.get('x-text-sync-worker-secret') ?? ''
  if (!expected || !supplied) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(supplied)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { workerId?: string; activeJobId?: string | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const workerId = typeof body.workerId === 'string' ? body.workerId.trim() : ''
  const activeJobId = typeof body.activeJobId === 'string' ? body.activeJobId : null
  if (!workerId || workerId.length > 80) return NextResponse.json({ error: 'Invalid workerId.' }, { status: 400 })

  // Worker tables are introduced by a manual SQL migration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseAdmin() as any
  const now = new Date()
  const { error } = await db.from('text_sync_worker_heartbeats').upsert({
    worker_id: workerId,
    worker_kind: workerId === 'vercel-daemon' ? 'vercel' : 'local',
    active_job_id: activeJobId,
    last_seen_at: now.toISOString(),
  }, { onConflict: 'worker_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (activeJobId) {
    const { error: leaseError } = await db.from('text_sync_jobs').update({
      lease_expires_at: new Date(now.getTime() + 3 * 60 * 1000).toISOString(),
    }).eq('id', activeJobId).eq('status', 'processing').eq('claimed_by', workerId)
    if (leaseError) return NextResponse.json({ error: leaseError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, lastSeenAt: now.toISOString() })
}
