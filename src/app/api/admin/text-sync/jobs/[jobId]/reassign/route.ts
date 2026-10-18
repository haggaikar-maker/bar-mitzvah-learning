import { NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const session = await getAdminSession()
    if (!session) return NextResponse.json({ error: 'נדרשת התחברות מנהל.' }, { status: 401 })

    const { jobId } = await params
    const body = await request.json() as { studentId?: number; lessonPartId?: number }
    const studentId = Number(body.studentId)
    const lessonPartId = Number(body.lessonPartId)
    if (!Number.isInteger(studentId) || studentId <= 0 || !Number.isInteger(lessonPartId) || lessonPartId <= 0) {
      return NextResponse.json({ error: 'יש לבחור תלמיד ותת־חלק חדשים.' }, { status: 400 })
    }

    // Tables introduced by the text-sync migrations are not in the generated DB types yet.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getSupabaseAdmin() as any
    let jobQuery = db.from('text_sync_jobs').select('*').eq('id', jobId).eq('status', 'approved')
    if (session.role !== 'primary') jobQuery = jobQuery.eq('owner_admin_id', session.id)
    const { data: job, error: jobError } = await jobQuery.maybeSingle()
    if (jobError || !job) return NextResponse.json({ error: jobError?.message ?? 'לא נמצאה קריאה מאושרת להעברה.' }, { status: 404 })

    const { data: part, error: partError } = await db.from('lesson_parts')
      .select('id, lesson_group_id').eq('id', lessonPartId).maybeSingle()
    if (partError || !part) return NextResponse.json({ error: partError?.message ?? 'תת־החלק החדש לא נמצא.' }, { status: 404 })
    const { data: group, error: groupError } = await db.from('lesson_groups')
      .select('id, teacher_parasha_id').eq('id', part.lesson_group_id).maybeSingle()
    if (groupError || !group) return NextResponse.json({ error: groupError?.message ?? 'החלק החדש לא נמצא.' }, { status: 404 })
    const { data: library, error: libraryError } = await db.from('teacher_parashot')
      .select('id, owner_admin_id, status, parasha_id, parashot(name)')
      .eq('id', group.teacher_parasha_id).maybeSingle()
    if (libraryError || !library) return NextResponse.json({ error: libraryError?.message ?? 'ספריית הפרשה לא נמצאה.' }, { status: 404 })
    if (session.role !== 'primary' && library.owner_admin_id !== session.id) {
      return NextResponse.json({ error: 'אין לך הרשאה לשייך לספרייה הזאת.' }, { status: 403 })
    }
    if (!['active', 'draft'].includes(library.status)) {
      return NextResponse.json({ error: 'אפשר להעביר קריאה רק לספרייה פעילה או בטיוטה.' }, { status: 400 })
    }
    const { data: assignment, error: assignmentError } = await db.from('student_teacher_parasha_assignments')
      .select('id').eq('student_id', studentId).eq('teacher_parasha_id', library.id)
      .eq('status', 'active').maybeSingle()
    if (assignmentError || !assignment) {
      return NextResponse.json({ error: 'התלמיד אינו משויך לספריית הפרשה שנבחרה.' }, { status: 400 })
    }

    const sameTarget = job.student_id === studentId && job.lesson_part_id === lessonPartId
    if (!sameTarget) {
      const { data: conflictingReading, error: conflictError } = await db.from('student_lesson_part_readings')
        .select('id').eq('student_id', studentId).eq('lesson_part_id', lessonPartId).maybeSingle()
      if (conflictError) return NextResponse.json({ error: conflictError.message }, { status: 500 })
      if (conflictingReading) {
        return NextResponse.json({ error: 'כבר קיימת לתלמיד הזה הקלטה מסונכרנת בתת־החלק החדש. לא שיניתי דבר כדי לא לדרוס אותה.' }, { status: 409 })
      }

      const { data: sourceReading, error: sourceError } = await db.from('student_lesson_part_readings')
        .select('id').eq('student_id', job.student_id).eq('lesson_part_id', job.lesson_part_id).maybeSingle()
      if (sourceError || !sourceReading) {
        return NextResponse.json({ error: sourceError?.message ?? 'לא נמצאה ההקלטה המשויכת כעת למשימה.' }, { status: 404 })
      }
      const { error: moveError } = await db.from('student_lesson_part_readings').update({
        student_id: studentId,
        lesson_part_id: lessonPartId,
        updated_at: new Date().toISOString(),
      }).eq('id', sourceReading.id)
      if (moveError) return NextResponse.json({ error: moveError.message }, { status: 500 })

      const parashaRelation = library.parashot
      const parashaName = Array.isArray(parashaRelation) ? parashaRelation[0]?.name : parashaRelation?.name
      const readingTitle = job.reading_kind === 'weekly_aliyah' && job.aliyah_number
        ? `${parashaName ?? job.parasha_name} · עלייה ${job.aliyah_number}`
        : job.reading_title
      const { error: updateJobError } = await db.from('text_sync_jobs').update({
        student_id: studentId,
        lesson_part_id: lessonPartId,
        owner_admin_id: library.owner_admin_id,
        parasha_name: parashaName ?? job.parasha_name,
        reading_title: readingTitle,
        updated_at: new Date().toISOString(),
      }).eq('id', jobId)
      if (updateJobError) {
        await db.from('student_lesson_part_readings').update({
          student_id: job.student_id,
          lesson_part_id: job.lesson_part_id,
          updated_at: new Date().toISOString(),
        }).eq('id', sourceReading.id)
        return NextResponse.json({ error: updateJobError.message }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'שינוי השיוך נכשל.' }, { status: 500 })
  }
}
