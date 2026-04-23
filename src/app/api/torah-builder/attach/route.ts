import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

type LessonPartRow = {
  id: number
  lesson_group_id: number
  media_kind: string | null
}

type LessonGroupRow = {
  id: number
  teacher_parasha_id: number
}

type CallbackOutput = {
  kind: 'image' | 'audio' | 'video' | 'video_segment'
  publicUrl?: string | null
  metadata?: Record<string, unknown> | null
}

type CallbackPayload = {
  lessonId: string
  parashaId?: string
  projectId?: string
  outputs: CallbackOutput[]
}

function asNumber(value: string | undefined) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function asSlideStartSecond(metadata: Record<string, unknown> | null | undefined) {
  const raw = metadata?.startSecond
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
}

export async function POST(request: Request) {
  const secret = process.env.TORAH_BUILDER_CALLBACK_SECRET
  const suppliedSecret = request.headers.get('x-torah-builder-callback-secret')

  if (!secret) {
    return NextResponse.json({ error: 'TORAH_BUILDER_CALLBACK_SECRET is not configured.' }, { status: 500 })
  }

  if (!suppliedSecret || suppliedSecret !== secret) {
    return NextResponse.json({ error: 'Invalid builder callback secret.' }, { status: 401 })
  }

  const payload = (await request.json()) as Partial<CallbackPayload>
  const lessonPartId = asNumber(payload.lessonId)
  const teacherParashaId = asNumber(payload.parashaId)
  const outputs = Array.isArray(payload.outputs) ? payload.outputs : []

  if (!lessonPartId || outputs.length === 0) {
    return NextResponse.json({ error: 'lessonId and outputs are required.' }, { status: 400 })
  }

  const supabaseAdmin = getSupabaseAdmin() as any
  const { data: lessonPart, error: lessonPartError } = await supabaseAdmin
    .from('lesson_parts')
    .select('id, lesson_group_id, media_kind')
    .eq('id', lessonPartId)
    .maybeSingle()

  const typedLessonPart = lessonPart as LessonPartRow | null

  if (lessonPartError || !typedLessonPart) {
    return NextResponse.json({ error: lessonPartError?.message ?? 'Lesson part not found.' }, { status: 404 })
  }

  const { data: lessonGroup, error: lessonGroupError } = await supabaseAdmin
    .from('lesson_groups')
    .select('id, teacher_parasha_id')
    .eq('id', typedLessonPart.lesson_group_id)
    .maybeSingle()

  const typedLessonGroup = lessonGroup as LessonGroupRow | null

  if (lessonGroupError || !typedLessonGroup) {
    return NextResponse.json({ error: lessonGroupError?.message ?? 'Lesson group not found.' }, { status: 404 })
  }

  if (teacherParashaId && typedLessonGroup.teacher_parasha_id !== teacherParashaId) {
    return NextResponse.json({ error: 'Lesson part does not belong to the requested teacher parasha.' }, { status: 403 })
  }

  const audioOutput = outputs.find((item) => item.kind === 'audio' && item.publicUrl)
  const primaryVideoOutput =
    outputs.find((item) => item.kind === 'video' && item.publicUrl) ??
    outputs.find((item) => item.kind === 'video_segment' && item.publicUrl)
  const slideOutputs = outputs
    .filter(
      (item) =>
        item.kind === 'image' &&
        item.publicUrl &&
        item.metadata &&
        item.metadata.role === 'slide'
    )
    .sort((left, right) => {
      const leftIndex = typeof left.metadata?.slideIndex === 'number' ? left.metadata.slideIndex : 0
      const rightIndex = typeof right.metadata?.slideIndex === 'number' ? right.metadata.slideIndex : 0
      return leftIndex - rightIndex
    })

  const updatePayload =
    typedLessonPart.media_kind === 'video'
      ? {
          video_url: primaryVideoOutput?.publicUrl ?? null,
        }
      : {
          audio_url: audioOutput?.publicUrl ?? null,
        }

  const { error: updatePartError } = await supabaseAdmin
    .from('lesson_parts')
    .update(updatePayload)
    .eq('id', lessonPartId)

  if (updatePartError) {
    return NextResponse.json({ error: updatePartError.message }, { status: 500 })
  }

  const { error: deleteSlidesError } = await supabaseAdmin
    .from('lesson_slides')
    .delete()
    .eq('lesson_part_id', lessonPartId)

  if (deleteSlidesError) {
    return NextResponse.json({ error: deleteSlidesError.message }, { status: 500 })
  }

  if (typedLessonPart.media_kind !== 'video' && slideOutputs.length > 0) {
    const slideRows = slideOutputs.map((output, index) => ({
      lesson_part_id: lessonPartId,
      image_url: output.publicUrl!,
      slide_index:
        typeof output.metadata?.slideIndex === 'number' ? Number(output.metadata.slideIndex) : index,
      start_second: asSlideStartSecond(output.metadata),
    }))

    const { error: insertSlidesError } = await supabaseAdmin.from('lesson_slides').insert(slideRows)
    if (insertSlidesError) {
      return NextResponse.json({ error: insertSlidesError.message }, { status: 500 })
    }
  }

  revalidatePath('/admin')
  revalidatePath('/student')

  return NextResponse.json({
    ok: true,
    lessonPartId,
    attached: {
      audioUrl: audioOutput?.publicUrl ?? null,
      videoUrl: primaryVideoOutput?.publicUrl ?? null,
      slideCount: slideOutputs.length,
    },
  })
}
