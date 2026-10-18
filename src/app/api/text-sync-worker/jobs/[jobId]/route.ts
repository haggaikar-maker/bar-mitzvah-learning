import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

function isAuthorized(request: Request) {
  const expected = process.env.TEXT_SYNC_WORKER_SECRET ?? ''
  const supplied = request.headers.get('x-text-sync-worker-secret') ?? ''
  if (!expected || !supplied) return false
  const expectedBuffer = Buffer.from(expected)
  const suppliedBuffer = Buffer.from(supplied)
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer)
}

export async function PATCH(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { jobId } = await params
  const body = (await request.json()) as {
    status?: 'processing' | 'completed' | 'failed'; progressPercent?: number
    result?: unknown; sourceRef?: string; errorMessage?: string
  }
  if (!['processing', 'completed', 'failed'].includes(body.status ?? '')) {
    return NextResponse.json({ error: 'Invalid worker status.' }, { status: 400 })
  }
  const progress = Math.max(0, Math.min(100, Math.round(Number(body.progressPercent ?? 0))))
  const patch: Record<string, unknown> = {
    status: body.status,
    progress_percent: progress,
    updated_at: new Date().toISOString(),
  }
  if (body.status === 'completed') {
    patch.result_json = body.result
    patch.source_ref = body.sourceRef ?? null
    patch.error_message = null
  }
  if (body.status === 'failed') patch.error_message = String(body.errorMessage ?? 'Processing failed').slice(0, 1000)

  // The job table is added by a manual Supabase migration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseAdmin() as any
  const { data, error } = await db.from('text_sync_jobs').update(patch)
    .eq('id', jobId).eq('status', 'processing').select('id, status').maybeSingle()
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Job was not found or is no longer processing.' }, { status: 404 })
  return NextResponse.json({ job: data })
}
