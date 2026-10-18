import { NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/admin-auth'
import { getBucketName } from '@/lib/storage-files'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

function safeSegment(value: string) {
  return value.normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'item'
}

export async function POST(request: Request) {
  try {
    const session = await getAdminSession()
    if (!session) return NextResponse.json({ error: 'נדרשת התחברות מנהל.' }, { status: 401 })

    const body = (await request.json()) as { lessonPartId?: number; studentId?: number; filename?: string }
    const lessonPartId = Number(body.lessonPartId)
    const studentId = Number(body.studentId)
    if (!Number.isInteger(lessonPartId) || !Number.isInteger(studentId)) {
      return NextResponse.json({ error: 'יש לבחור תלמיד ותת־חלק.' }, { status: 400 })
    }
    const extension = (body.filename?.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0] ?? '').toLowerCase()
    if (!['.webm', '.wav', '.mp3', '.m4a', '.ogg', '.mp4', '.aac', '.flac'].includes(extension)) {
      return NextResponse.json({ error: 'יש לבחור קובץ שמע מסוג WebM, WAV, MP3, M4A, OGG, AAC או FLAC.' }, { status: 400 })
    }

    // New migration tables/relations are not yet part of the generated Supabase TypeScript schema.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getSupabaseAdmin() as any
    const { data: part, error: partError } = await db
      .from('lesson_parts')
      .select('id, lesson_group_id, lesson_groups(teacher_parasha_id)')
      .eq('id', lessonPartId)
      .maybeSingle()
    if (partError || !part) return NextResponse.json({ error: partError?.message ?? 'תת־החלק לא נמצא.' }, { status: 404 })

    const group = Array.isArray(part.lesson_groups) ? part.lesson_groups[0] : part.lesson_groups
    const teacherParashaId = Number(group?.teacher_parasha_id)
    const { data: library, error: libraryError } = await db
      .from('teacher_parashot')
      .select('id, owner_admin_id, status')
      .eq('id', teacherParashaId)
      .maybeSingle()
    if (libraryError || !library) return NextResponse.json({ error: libraryError?.message ?? 'ספריית הפרשה לא נמצאה.' }, { status: 404 })
    if (session.role !== 'primary' && library.owner_admin_id !== session.id) {
      return NextResponse.json({ error: 'אין הרשאה לספריית הפרשה הזאת.' }, { status: 403 })
    }
    if (!['active', 'draft'].includes(library.status)) {
      return NextResponse.json({ error: 'אי אפשר להוסיף הקלטה לספרייה קפואה או לארכיון.' }, { status: 400 })
    }
    const { data: assignment, error: assignmentError } = await db
      .from('student_teacher_parasha_assignments')
      .select('id')
      .eq('student_id', studentId)
      .eq('teacher_parasha_id', teacherParashaId)
      .eq('status', 'active')
      .maybeSingle()
    if (assignmentError || !assignment) {
      return NextResponse.json({ error: 'התלמיד אינו משויך כרגע לספריית הפרשה שנבחרה.' }, { status: 400 })
    }

    const filenameBase = (body.filename ?? 'recording').replace(/\.[a-zA-Z0-9]{1,8}$/, '')
    const objectPath = `teacher-readings/${studentId}/${lessonPartId}/${Date.now()}-${safeSegment(filenameBase)}${extension}`
    const bucketName = getBucketName('audio')
    const { data: signed, error: signedError } = await db.storage.from(bucketName).createSignedUploadUrl(objectPath)
    if (signedError || !signed) return NextResponse.json({ error: signedError?.message ?? 'לא ניתן ליצור יעד העלאה.' }, { status: 500 })
    const { data: publicData } = db.storage.from(bucketName).getPublicUrl(objectPath)

    return NextResponse.json({ bucketName, objectPath, token: signed.token, publicUrl: publicData.publicUrl })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'הכנת ההעלאה נכשלה.' }, { status: 500 })
  }
}
