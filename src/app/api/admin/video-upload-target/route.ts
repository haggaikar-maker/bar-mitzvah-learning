import { NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/admin-auth'
import { getBucketName } from '@/lib/storage-files'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

function slugifySegment(value: string) {
  const sanitized = value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()

  return sanitized || 'item'
}

function buildVideoObjectPath(input: {
  parashaName: string
  sectionName: string
  partName: string
  partOrder: number
  originalFilename: string
}) {
  const extensionMatch = input.originalFilename.match(/\.[a-zA-Z0-9]+$/)
  const extension = extensionMatch ? extensionMatch[0].toLowerCase() : '.mp4'
  const filename = `${slugifySegment(input.partName || 'part')}-video-${input.partOrder}-${Date.now()}${extension}`

  return [
    slugifySegment(input.parashaName || 'parasha'),
    slugifySegment(input.sectionName || 'section'),
    slugifySegment(input.partName || 'part'),
    filename,
  ].join('/')
}

type UploadTargetRequest = {
  lessonPartId?: number
  parashaName?: string
  sectionName?: string
  partName?: string
  partOrder?: number
  originalFilename?: string
}

export async function POST(request: Request) {
  try {
    const session = await getAdminSession()

    if (!session) {
      return NextResponse.json({ error: 'נדרשת התחברות מנהל.' }, { status: 401 })
    }

    const body = (await request.json()) as UploadTargetRequest
    const lessonPartId = Number(body.lessonPartId)
    const partOrder = Number(body.partOrder)

    if (!Number.isFinite(lessonPartId) || !Number.isFinite(partOrder)) {
      return NextResponse.json({ error: 'חסרים נתוני קטע להעלאת וידאו.' }, { status: 400 })
    }

    const supabaseAdmin = getSupabaseAdmin()
    const { data: lessonPartRow, error: lessonPartError } = await supabaseAdmin
      .from('lesson_parts')
      .select(
        `
          id,
          lesson_group_id,
          lesson_groups (
            teacher_parasha_id
          )
        `
      )
      .eq('id', lessonPartId)
      .maybeSingle()

    if (lessonPartError || !lessonPartRow) {
      return NextResponse.json(
        { error: lessonPartError?.message ?? 'הקטע לא נמצא.' },
        { status: 404 }
      )
    }

    const lessonPart = lessonPartRow as {
      id: number
      lesson_group_id: number
      lesson_groups:
        | {
            teacher_parasha_id: number | null
          }
        | Array<{
            teacher_parasha_id: number | null
          }>
        | null
    }

    const lessonGroup = Array.isArray(lessonPart.lesson_groups)
      ? lessonPart.lesson_groups[0]
      : lessonPart.lesson_groups

    const teacherParashaId = lessonGroup?.teacher_parasha_id

    if (!teacherParashaId) {
      return NextResponse.json(
        { error: 'לא נמצאה ספריית פרשה עבור הקטע.' },
        { status: 400 }
      )
    }

    const { data: teacherParashaRow, error: teacherParashaError } = await supabaseAdmin
      .from('teacher_parashot')
      .select('id, owner_admin_id')
      .eq('id', teacherParashaId)
      .maybeSingle()

    if (teacherParashaError || !teacherParashaRow) {
      return NextResponse.json(
        { error: teacherParashaError?.message ?? 'ספריית הפרשה לא נמצאה.' },
        { status: 404 }
      )
    }

    const teacherParasha = teacherParashaRow as {
      id: number
      owner_admin_id: number | null
    }

    if (session.role !== 'primary' && teacherParasha.owner_admin_id !== session.id) {
      return NextResponse.json({ error: 'אין הרשאה להעלות וידאו לקטע זה.' }, { status: 403 })
    }

    const objectPath = buildVideoObjectPath({
      parashaName: body.parashaName ?? 'parasha',
      sectionName: body.sectionName ?? 'section',
      partName: body.partName ?? 'part',
      partOrder,
      originalFilename: body.originalFilename ?? 'video.mp4',
    })
    const bucketName = getBucketName('videos')
    const { data: signedUploadData, error: signedUploadError } = await supabaseAdmin.storage
      .from(bucketName)
      .createSignedUploadUrl(objectPath)

    if (signedUploadError || !signedUploadData) {
      return NextResponse.json(
        { error: signedUploadError?.message ?? 'לא ניתן היה להכין יעד העלאה.' },
        { status: 500 }
      )
    }

    const { data: publicUrlData } = supabaseAdmin.storage
      .from(bucketName)
      .getPublicUrl(objectPath)

    return NextResponse.json({
      bucketName,
      objectPath,
      token: signedUploadData.token,
      publicUrl: publicUrlData.publicUrl,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'אירעה שגיאה לא צפויה בהכנת העלאת הווידאו.',
      },
      { status: 500 }
    )
  }
}
