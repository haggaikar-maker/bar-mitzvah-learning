'use client'

import { useEffect, useState } from 'react'

type AudioDurationProps = {
  src: string | null | undefined
  kind?: 'audio' | 'video'
  fallback?: string
  loadingLabel?: string
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.floor(totalSeconds % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function AudioDuration({
  src,
  kind = 'audio',
  fallback = 'אין אודיו משויך',
  loadingLabel = 'טוען משך אודיו...',
}: AudioDurationProps) {
  const [audioState, setAudioState] = useState<{
    src: string | null
    duration: number | null
    hasError: boolean
  }>({
    src: null,
    duration: null,
    hasError: false,
  })

  useEffect(() => {
    if (!src) {
      return
    }

    const media =
      kind === 'video'
        ? document.createElement('video')
        : document.createElement('audio')

    media.preload = 'metadata'
    media.src = src

    const handleLoadedMetadata = () => {
      if (Number.isFinite(media.duration)) {
        setAudioState({
          src,
          duration: media.duration,
          hasError: false,
        })
      } else {
        setAudioState({
          src,
          duration: null,
          hasError: true,
        })
      }
    }

    const handleError = () => {
      setAudioState({
        src,
        duration: null,
        hasError: true,
      })
    }

    media.addEventListener('loadedmetadata', handleLoadedMetadata)
    media.addEventListener('error', handleError)
    media.load()

    return () => {
      media.removeEventListener('loadedmetadata', handleLoadedMetadata)
      media.removeEventListener('error', handleError)
      media.src = ''
    }
  }, [kind, src])

  if (!src) {
    return <span>{fallback}</span>
  }

  if (audioState.src === src && audioState.hasError) {
    return (
      <span>
        {kind === 'video'
          ? 'לא הצלחנו לטעון את משך הווידאו'
          : 'לא הצלחנו לטעון את משך האודיו'}
      </span>
    )
  }

  if (audioState.src !== src || audioState.duration === null) {
    return <span>{loadingLabel}</span>
  }

  return <span>{formatDuration(audioState.duration)}</span>
}
