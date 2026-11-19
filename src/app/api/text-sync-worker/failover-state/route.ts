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

export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Worker tables are introduced by a manual SQL migration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseAdmin() as any
  const now = Date.now()
  const localCutoff = new Date(now - 90_000).toISOString()
  const [queuedResult, processingResult, localResult] = await Promise.all([
    db.from('text_sync_jobs').select('id, created_at', { count: 'exact' }).eq('status', 'queued')
      .order('created_at', { ascending: true }).limit(1),
    db.from('text_sync_jobs').select('id, claimed_by, lease_expires_at, created_at').eq('status', 'processing'),
    db.from('text_sync_worker_heartbeats').select('worker_id, last_seen_at')
      .eq('worker_kind', 'local').gte('last_seen_at', localCutoff),
  ])
  const failed = [queuedResult, processingResult, localResult].find((result) => result.error)
  if (failed) return NextResponse.json({ error: failed.error.message }, { status: 500 })

  const processing = (processingResult.data ?? []) as Array<{
    id: string
    claimed_by: string | null
    lease_expires_at: string | null
    created_at: string
  }>
  const localOnline = (localResult.data ?? []).length > 0
  const { data: cloudWorkers, error: cloudError } = await db.from('text_sync_worker_heartbeats')
    .select('worker_id, last_seen_at').eq('worker_kind', 'vercel').gte('last_seen_at', localCutoff)
  if (cloudError) return NextResponse.json({ error: cloudError.message }, { status: 500 })
  const cloudOnline = (cloudWorkers ?? []).length > 0
  const cloudIsWorking = processing.some((job) => job.claimed_by === 'vercel-daemon'
    && job.lease_expires_at !== null && Date.parse(job.lease_expires_at) > now)
  const hasExpiredLease = processing.some((job) => !job.lease_expires_at || Date.parse(job.lease_expires_at) <= now)
  const queuedJobs = queuedResult.count ?? 0
  const oldestQueuedAt = queuedResult.data?.[0]?.created_at as string | undefined

  let desiredInstances = 0
  let reason = 'queue_empty'
  if (cloudIsWorking) {
    desiredInstances = 1
    reason = 'cloud_job_in_progress'
  } else if (localOnline) {
    reason = 'local_worker_online'
  } else if (queuedJobs > 0 || hasExpiredLease) {
    desiredInstances = 1
    reason = queuedJobs > 0 ? 'local_worker_offline_with_queued_jobs' : 'local_job_lease_expired'
  } else if (processing.length > 0) {
    reason = 'waiting_for_job_lease_expiry'
  }

  let cloudStartOverdue = false
  if (desiredInstances === 1 && !cloudOnline) {
    const { data: lastScaleRequest, error: eventError } = await db.from('text_sync_worker_events')
      .select('created_at, metadata').eq('event_type', 'scale_requested')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (eventError) return NextResponse.json({ error: eventError.message }, { status: 500 })
    const pendingSince = [
      oldestQueuedAt,
      ...processing.filter((job) => !job.lease_expires_at || Date.parse(job.lease_expires_at) <= now)
        .map((job) => job.created_at),
    ].filter((value): value is string => Boolean(value)).sort()[0]
    cloudStartOverdue = Boolean(pendingSince && lastScaleRequest
      && lastScaleRequest.metadata?.desiredInstances === 1
      && Date.parse(lastScaleRequest.created_at) >= Date.parse(pendingSince)
      && now - Date.parse(lastScaleRequest.created_at) > 3 * 60 * 1000)
  }

  return NextResponse.json({
    desiredInstances,
    reason,
    localOnline,
    cloudOnline,
    cloudStartOverdue,
    queuedJobs,
    processingJobs: processing.length,
    checkedAt: new Date(now).toISOString(),
  })
}
