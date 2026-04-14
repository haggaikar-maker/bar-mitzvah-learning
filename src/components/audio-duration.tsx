'use client'

import { useEffect, useState } from 'react'

type AudioDurationProps = {
  src: string | null | undefined
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

    const audio = new Audio()
    audio.preload = 'metadata'
    audio.src = src

    const handleLoadedMetadata = () => {
      if (Number.isFinite(audio.duration)) {
        setAudioState({
          src,
          duration: audio.duration,
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

    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('error', handleError)
    audio.load()

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('error', handleError)
      audio.src = ''
    }
  }, [src])

  if (!src) {
    return <span>{fallback}</span>
  }

  if (audioState.src === src && audioState.hasError) {
    return <span>לא הצלחנו לטעון את משך האודיו</span>
  }

  if (audioState.src !== src || audioState.duration === null) {
    return <span>{loadingLabel}</span>
  }

  return <span>{formatDuration(audioState.duration)}</span>
}
