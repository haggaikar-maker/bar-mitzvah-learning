import { NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { refreshStudentWhatsAppCatalog } from '@/lib/whatsapp-bot'

type TimedToken = { index: number; text: string; start: number; end: number; confidence?: number; source?: string; [key: string]: unknown }
type AlignmentResult = { ref?: string; text?: string; durationSeconds?: number; tokens?: TimedToken[] }

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const session = await getAdminSession()
    if (!session) return NextResponse.json({ error: 'נדרשת התחברות מנהל.' }, { status: 401 })
    const { jobId } = await params
    // New migration tables/relations are not yet part of the generated Supabase TypeScript schema.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getSupabaseAdmin() as any
    let query = db.from('text_sync_jobs').select('*').eq('id', jobId).eq('status', 'completed')
    if (session.role !== 'primary') query = query.eq('owner_admin_id', session.id)
    const { data: job, error: jobError } = await query.maybeSingle()
    if (jobError || !job) return NextResponse.json({ error: jobError?.message ?? 'לא נמצאה משימה מוכנה לאישור.' }, { status: 404 })
    const result = job.result_json as AlignmentResult | null
    if (!result?.ref || !result.text || !Array.isArray(result.tokens) || result.tokens.length === 0) {
      return NextResponse.json({ error: 'תוצאת התזמון אינה מלאה.' }, { status: 400 })
    }
    const approvalOptions = await request.json().catch(() => ({})) as { replaceExisting?: boolean; tokens?: unknown }
    let approvedTokens = result.tokens
    if (approvalOptions.tokens !== undefined) {
      if (!Array.isArray(approvalOptions.tokens) || approvalOptions.tokens.length !== result.tokens.length) {
        return NextResponse.json({ error: 'רשימת הזמנים שנערכה אינה תואמת לתוצאה המקורית.' }, { status: 400 })
      }
      const edits = approvalOptions.tokens as TimedToken[]
      const valid = edits.every((token, index) =>
        token && token.index === result.tokens?.[index]?.index &&
        token.text === result.tokens?.[index]?.text &&
        Number.isFinite(token.start) && Number.isFinite(token.end) &&
        token.start >= 0 && token.end > token.start && token.end <= 86_400
      )
      if (!valid) return NextResponse.json({ error: 'אחד מזמני המילים אינו תקין.' }, { status: 400 })
      approvedTokens = result.tokens.map((token, index) => ({
        ...token,
        start: edits[index].start,
        end: edits[index].end,
      }))
    }

    const { data: part, error: partError } = await db.from('lesson_parts')
      .select('id, lesson_group_id, lesson_groups(teacher_parasha_id, teacher_parashot(owner_admin_id, status))')
      .eq('id', job.lesson_part_id).maybeSingle()
    if (partError || !part) return NextResponse.json({ error: partError?.message ?? 'תת־החלק לא נמצא.' }, { status: 404 })
    const group = Array.isArray(part.lesson_groups) ? part.lesson_groups[0] : part.lesson_groups
    const library = Array.isArray(group?.teacher_parashot) ? group.teacher_parashot[0] : group?.teacher_parashot
    if (!library || (session.role !== 'primary' && library.owner_admin_id !== session.id)) {
      return NextResponse.json({ error: 'אין הרשאה לאשר הקלטה זו.' }, { status: 403 })
    }
    if (!['active', 'draft'].includes(library.status)) {
      return NextResponse.json({ error: 'אי אפשר לאשר הקלטה בספרייה קפואה או בארכיון.' }, { status: 400 })
    }
    const { data: assignment, error: assignmentError } = await db.from('student_teacher_parasha_assignments')
      .select('id').eq('student_id', job.student_id).eq('teacher_parasha_id', group.teacher_parasha_id)
      .eq('status', 'active').maybeSingle()
    if (assignmentError || !assignment) return NextResponse.json({ error: 'התלמיד כבר אינו משויך לספרייה הזאת.' }, { status: 400 })

    const { data: existingReading, error: existingError } = await db.from('student_lesson_part_readings')
      .select('id').eq('student_id', job.student_id).eq('lesson_part_id', job.lesson_part_id).maybeSingle()
    if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 })
    if (existingReading && !approvalOptions.replaceExisting) {
      return NextResponse.json({ error: 'כבר קיימת הקלטה מסונכרנת לתלמיד בתת־החלק הזה. לאשר החלפה?' }, { status: 409 })
    }

    const { error: saveError } = await db.from('student_lesson_part_readings').upsert({
      student_id: job.student_id,
      lesson_part_id: job.lesson_part_id,
      audio_object_path: job.audio_object_path,
      audio_url: job.audio_public_url,
      source_ref: result.ref,
      source_text: result.text,
      word_timings: approvedTokens,
      approved_by_admin_id: session.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'student_id,lesson_part_id' })
    if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 })

    const { error: updateError } = await db.from('text_sync_jobs').update({ status: 'approved', updated_at: new Date().toISOString() }).eq('id', jobId)
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
    await refreshStudentWhatsAppCatalog(job.student_id)
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'שמירת הקריאה נכשלה.' }, { status: 500 })
  }
}
