export type LessonMediaKind = 'audio_slides' | 'video'
export type LessonVideoVariant = 'nikud' | 'tikkun'

export type LessonMediaPartLike = {
  media_kind?: string | null
  audio_url?: string | null
  video_url?: string | null
  video_url_nikud?: string | null
  video_url_tikkun?: string | null
  is_visible_to_student?: boolean | null
}

export function getLessonVideoVariantLabel(variant: LessonVideoVariant) {
  return variant === 'tikkun' ? 'תיקון סופרים' : 'עם ניקוד'
}

export function getLessonVariantVideoUrl(
  part: LessonMediaPartLike | null | undefined,
  variant: LessonVideoVariant
) {
  if (!part) {
    return null
  }

  if (variant === 'tikkun') {
    return part.video_url_tikkun ?? null
  }

  return part.video_url_nikud ?? part.video_url ?? null
}

export function getAvailableLessonVideoVariants(
  part: LessonMediaPartLike | null | undefined
) {
  if (!part) {
    return [] as LessonVideoVariant[]
  }

  const variants: LessonVideoVariant[] = []

  if (getLessonVariantVideoUrl(part, 'nikud')) {
    variants.push('nikud')
  }

  if (getLessonVariantVideoUrl(part, 'tikkun')) {
    variants.push('tikkun')
  }

  return variants
}

export function resolveLessonVideoVariant(
  part: LessonMediaPartLike | null | undefined,
  input?: {
    studentPreferredVariant?: LessonVideoVariant | null
    partPreferredVariant?: LessonVideoVariant | null
  }
) {
  const availableVariants = getAvailableLessonVideoVariants(part)

  if (availableVariants.length === 0) {
    return null
  }

  const preferredOrder = [
    input?.partPreferredVariant ?? null,
    input?.studentPreferredVariant ?? null,
    'nikud' as LessonVideoVariant,
    'tikkun' as LessonVideoVariant,
  ]

  for (const variant of preferredOrder) {
    if (variant && availableVariants.includes(variant)) {
      return variant
    }
  }

  return availableVariants[0] ?? null
}

export function getLessonMediaKind(
  part: LessonMediaPartLike | null | undefined
): LessonMediaKind {
  if (!part) {
    return 'audio_slides'
  }

  return part.media_kind === 'video' ||
    part.video_url ||
    part.video_url_nikud ||
    part.video_url_tikkun
    ? 'video'
    : 'audio_slides'
}

export function getLessonMediaUrl(
  part: LessonMediaPartLike | null | undefined,
  input?: {
    studentPreferredVariant?: LessonVideoVariant | null
    partPreferredVariant?: LessonVideoVariant | null
  }
) {
  if (!part) {
    return null
  }

  if (getLessonMediaKind(part) === 'video') {
    const resolvedVariant = resolveLessonVideoVariant(part, input)
    return resolvedVariant ? getLessonVariantVideoUrl(part, resolvedVariant) : null
  }

  return part.audio_url ?? null
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
    return getAvailableLessonVideoVariants(part).length > 0
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
