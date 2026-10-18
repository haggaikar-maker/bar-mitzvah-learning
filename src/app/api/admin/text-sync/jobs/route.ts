import { NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/admin-auth'
import { getBucketName } from '@/lib/storage-files'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

const allowedBooks = new Set([
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'I Samuel', 'II Samuel', 'I Kings', 'II Kings',
  'Isaiah', 'Jeremiah', 'Ezekiel', 'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah',
  'Haggai', 'Zechariah', 'Malachi', 'Psalms', 'Proverbs', 'Job', 'Song of Songs', 'Ruth', 'Lamentations', 'Ecclesiastes',
  'Esther', 'Daniel', 'Ezra', 'Nehemiah', 'I Chronicles', 'II Chronicles',
])

export async function POST(request: Request) {
  try {
    const session = await getAdminSession()
    if (!session) return NextResponse.json({ error: 'נדרשת התחברות מנהל.' }, { status: 401 })
    const body = (await request.json()) as {
      lessonPartId?: number; studentId?: number; aliyahNumber?: number; readingKind?: string; readingTitle?: string
      sourceBook?: string; startChapter?: number; startVerse?: number; endChapter?: number; endVerse?: number
      audioObjectPath?: string; audioPublicUrl?: string
    }
    const lessonPartId = Number(body.lessonPartId)
    const studentId = Number(body.studentId)
    const readingKind = body.readingKind === 'manual_range' ? 'manual_range' : 'weekly_aliyah'
    const aliyahNumber = body.aliyahNumber == null ? null : Number(body.aliyahNumber)
    const range = [body.startChapter, body.startVerse, body.endChapter, body.endVerse].map(Number)
    if (!Number.isInteger(lessonPartId) || !Number.isInteger(studentId) || (readingKind === 'weekly_aliyah' && (!aliyahNumber || aliyahNumber < 1 || aliyahNumber > 7)) || !range.every((value) => Number.isInteger(value) && value > 0) || range[0] > 150 || range[2] > 150 || range[1] > 200 || range[3] > 200 || range[2] - range[0] > 12 || !body.sourceBook || !allowedBooks.has(body.sourceBook) || range[2] < range[0] || (range[2] === range[0] && range[3] < range[1])) {
      return NextResponse.json({ error: 'נתוני תלמיד, טווח פסוקים או עלייה אינם תקינים.' }, { status: 400 })
    }
    if (!body.audioObjectPath?.startsWith(`teacher-readings/${studentId}/${lessonPartId}/`) || !body.audioPublicUrl) {
      return NextResponse.json({ error: 'נתיב ההקלטה אינו תקין.' }, { status: 400 })
    }

    // New migration tables/relations are not yet part of the generated Supabase TypeScript schema.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getSupabaseAdmin() as any
    const bucketName = getBucketName('audio')
    const { data: expectedUrl } = db.storage.from(bucketName).getPublicUrl(body.audioObjectPath)
    if (expectedUrl.publicUrl !== body.audioPublicUrl) {
      return NextResponse.json({ error: 'קישור ההקלטה אינו תואם לנתיב שהועלה.' }, { status: 400 })
    }
    const { data: part, error: partError } = await db
      .from('lesson_parts')
      .select('id, lesson_group_id, lesson_groups(teacher_parasha_id, teacher_parashot(owner_admin_id, status, parashot(name)))')
      .eq('id', lessonPartId)
      .maybeSingle()
    if (partError || !part) return NextResponse.json({ error: partError?.message ?? 'תת־החלק לא נמצא.' }, { status: 404 })
    const group = Array.isArray(part.lesson_groups) ? part.lesson_groups[0] : part.lesson_groups
    const library = Array.isArray(group?.teacher_parashot) ? group.teacher_parashot[0] : group?.teacher_parashot
    const parasha = Array.isArray(library?.parashot) ? library.parashot[0] : library?.parashot
    if (!library || (session.role !== 'primary' && library.owner_admin_id !== session.id)) {
      return NextResponse.json({ error: 'אין הרשאה לספריית הפרשה הזאת.' }, { status: 403 })
    }
    if (!['active', 'draft'].includes(library.status)) {
      return NextResponse.json({ error: 'אי אפשר לפתוח תזמון לספרייה קפואה או לארכיון.' }, { status: 400 })
    }
    const { data: assignment, error: assignmentError } = await db
      .from('student_teacher_parasha_assignments').select('id')
      .eq('student_id', studentId).eq('teacher_parasha_id', group.teacher_parasha_id).eq('status', 'active').maybeSingle()
    if (assignmentError || !assignment) return NextResponse.json({ error: 'התלמיד אינו משויך לספריית הפרשה.' }, { status: 400 })

    const { data, error } = await db.from('text_sync_jobs').insert({
      owner_admin_id: library.owner_admin_id,
      student_id: studentId,
      lesson_part_id: lessonPartId,
      parasha_name: parasha?.name ?? '',
      aliyah_number: readingKind === 'weekly_aliyah' ? aliyahNumber : null,
      reading_kind: readingKind,
      reading_title: body.readingTitle?.trim() || (readingKind === 'weekly_aliyah' ? `${parasha?.name ?? ''} · עלייה ${aliyahNumber}` : 'קריאה ידנית'),
      source_book: body.sourceBook,
      start_chapter: range[0],
      start_verse: range[1],
      end_chapter: range[2],
      end_verse: range[3],
      audio_object_path: body.audioObjectPath,
      audio_public_url: body.audioPublicUrl,
    }).select('id, status, progress_percent, created_at').single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'לא ניתן ליצור משימת תזמון.' }, { status: 500 })
    return NextResponse.json({ job: data })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'יצירת משימת התזמון נכשלה.' }, { status: 500 })
  }
}

export async function GET(request: Request) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: 'נדרשת התחברות מנהל.' }, { status: 401 })
  const id = new URL(request.url).searchParams.get('id')
  // New migration tables are not yet part of the generated Supabase TypeScript schema.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseAdmin() as any
  let query = db.from('text_sync_jobs')
    .select('id, owner_admin_id, student_id, lesson_part_id, parasha_name, aliyah_number, reading_kind, reading_title, source_book, start_chapter, start_verse, end_chapter, end_verse, audio_public_url, source_ref, status, progress_percent, result_json, error_message, created_at')
    .order('created_at', { ascending: false })
  if (id) query = query.eq('id', id)
  else query = query.limit(15)
  if (session.role !== 'primary') query = query.eq('owner_admin_id', session.id)
  const { data, error } = id ? await query.maybeSingle() : await query
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'המשימה לא נמצאה.' }, { status: 404 })

  type JobRow = Record<string, unknown> & { student_id: number; lesson_part_id: number; parasha_name?: string }
  type LibraryRow = { id: number; owner_admin_id: number; parashot: { name: string } | Array<{ name: string }> | null }
  const jobs = (Array.isArray(data) ? data : [data]) as JobRow[]
  const studentIds = [...new Set(jobs.map((job) => Number(job.student_id)).filter(Number.isInteger))]
  const partIds = [...new Set(jobs.map((job) => Number(job.lesson_part_id)).filter(Number.isInteger))]
  const { data: students } = studentIds.length
    ? await db.from('students').select('id, name').in('id', studentIds)
    : { data: [] }
  const { data: parts } = partIds.length
    ? await db.from('lesson_parts').select('id, name, lesson_group_id').in('id', partIds)
    : { data: [] }
  const partRows = (parts ?? []) as Array<{ id: number; name: string; lesson_group_id: number }>
  const groupIds = [...new Set(partRows.map((part) => part.lesson_group_id))]
  const { data: groups } = groupIds.length
    ? await db.from('lesson_groups').select('id, teacher_parasha_id, section_id').in('id', groupIds)
    : { data: [] }
  const groupRows = (groups ?? []) as Array<{ id: number; teacher_parasha_id: number; section_id: number }>
  const libraryIds = [...new Set(groupRows.map((group) => group.teacher_parasha_id))]
  const sectionIds = [...new Set(groupRows.map((group) => group.section_id))]
  const { data: libraries } = libraryIds.length
    ? await db.from('teacher_parashot').select('id, owner_admin_id, parashot(name)').in('id', libraryIds)
    : { data: [] }
  const { data: sections } = sectionIds.length
    ? await db.from('sections').select('id, name').in('id', sectionIds)
    : { data: [] }
  const libraryRows = (libraries ?? []) as LibraryRow[]
  const ownerIds = [...new Set(libraryRows.map((library) => library.owner_admin_id))]
  const { data: owners } = ownerIds.length
    ? await db.from('admins').select('id, display_name').in('id', ownerIds)
    : { data: [] }
  const studentById = new Map<number, { id: number; name: string }>((students ?? []).map((student: { id: number; name: string }) => [student.id, student]))
  const partById = new Map(partRows.map((part) => [part.id, part]))
  const groupById = new Map(groupRows.map((group) => [group.id, group]))
  const libraryById = new Map<number, LibraryRow>(libraryRows.map((library) => [library.id, library]))
  const sectionById = new Map<number, { id: number; name: string }>((sections ?? []).map((section: { id: number; name: string }) => [section.id, section]))
  const ownerById = new Map<number, string>((owners ?? []).map((owner: { id: number; display_name: string }) => [owner.id, owner.display_name]))

  const enrichedJobs = jobs.map((job) => {
    const part = partById.get(Number(job.lesson_part_id))
    const group = part ? groupById.get(part.lesson_group_id) : null
    const library = group ? libraryById.get(group.teacher_parasha_id) : null
    const section = group ? sectionById.get(group.section_id) : null
    const parashaRelation = library?.parashot
    const parashaName = Array.isArray(parashaRelation) ? parashaRelation[0]?.name : parashaRelation?.name
    return {
      ...job,
      assignment: {
        studentId: Number(job.student_id),
        studentName: studentById.get(Number(job.student_id))?.name ?? 'תלמיד לא ידוע',
        teacherParashaId: library?.id ?? null,
        teacherName: library ? ownerById.get(library.owner_admin_id) ?? '' : '',
        parashaName: parashaName ?? job.parasha_name ?? '',
        sectionName: section?.name ?? '',
        partName: part?.name ?? '',
      },
    }
  })
  return NextResponse.json(id ? { job: enrichedJobs[0] } : { jobs: enrichedJobs })
}
