export type LessonMediaKind = 'audio_slides' | 'video'

export type LessonMediaPartLike = {
  media_kind?: string | null
  audio_url?: string | null
  video_url?: string | null
  is_visible_to_student?: boolean | null
}

export function getLessonMediaKind(
  part: LessonMediaPartLike | null | undefined
): LessonMediaKind {
  if (!part) {
    return 'audio_slides'
  }

  return part.media_kind === 'video' || part.video_url ? 'video' : 'audio_slides'
}

export function getLessonMediaUrl(
  part: LessonMediaPartLike | null | undefined
) {
  if (!part) {
    return null
  }

  return getLessonMediaKind(part) === 'video'
    ? part.video_url ?? null
    : part.audio_url ?? null
}

export function isLessonPartVisibleToStudent(
  part: LessonMediaPartLike | null | undefined
) {
  return part?.is_visible_to_student ?? true
}

export function isLessonPartReady(
  part: LessonMediaPartLike | null | undefined,
  slideCountByPartId?: Map<number, number>,
  partId?: number
) {
  if (!part || !isLessonPartVisibleToStudent(part)) {
    return false
  }

  if (getLessonMediaKind(part) === 'video') {
    return Boolean(part.video_url)
  }

  const slideCount =
    typeof partId === 'number'
      ? slideCountByPartId?.get(partId) ?? 0
      : 0

  return Boolean(part.audio_url) && slideCount > 0
}

export function getLessonMediaKindLabel(kind: LessonMediaKind) {
  return kind === 'video' ? 'וידאו' : 'אודיו + שקופיות'
}

