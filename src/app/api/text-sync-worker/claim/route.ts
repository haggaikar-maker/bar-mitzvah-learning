import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getBucketName } from '@/lib/storage-files'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

function isAuthorized(request: Request) {
  const expected = process.env.TEXT_SYNC_WORKER_SECRET ?? ''
  const supplied = request.headers.get('x-text-sync-worker-secret') ?? ''
  if (!expected || !supplied) return false
  const expectedBuffer = Buffer.from(expected)
  const suppliedBuffer = Buffer.from(supplied)
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer)
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // The job table is added by a manual Supabase migration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseAdmin() as any
  const { data, error } = await db.rpc('claim_text_sync_job')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const job = Array.isArray(data) ? data[0] : data
  if (!job) return NextResponse.json({ job: null })
  const bucket = getBucketName('audio')
  const { data: signed, error: signedError } = await db.storage
    .from(bucket)
    .createSignedUrl(job.audio_object_path, 60 * 60)
  if (signedError || !signed) return NextResponse.json({ error: signedError?.message ?? 'Could not create audio URL.' }, { status: 500 })
  return NextResponse.json({
    job: {
      id: job.id,
      parashaName: job.parasha_name,
      aliyahNumber: job.aliyah_number,
      readingKind: job.reading_kind,
      readingTitle: job.reading_title,
      sourceBook: job.source_book,
      startChapter: job.start_chapter,
      startVerse: job.start_verse,
      endChapter: job.end_chapter,
      endVerse: job.end_verse,
      audioObjectPath: job.audio_object_path,
      audioUrl: signed.signedUrl,
    },
  })
}
