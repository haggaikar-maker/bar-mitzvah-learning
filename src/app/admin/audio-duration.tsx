'use client'

import { useEffect, useState } from 'react'

type AudioDurationProps = {
  src: string | null | undefined
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.floor(totalSeconds % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function AudioDuration({ src }: AudioDurationProps) {
  const [duration, setDuration] = useState<number | null>(null)

  useEffect(() => {
    if (!src) {
      return
    }

    const audio = new Audio(src)
    const handleLoadedMetadata = () => {
      if (Number.isFinite(audio.duration)) {
        setDuration(audio.duration)
      }
    }

    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.load()

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
    }
  }, [src])

  if (!src) {
    return <span>אין אודיו משויך</span>
  }

  if (duration === null) {
    return <span>טוען משך אודיו...</span>
  }

  return <span>{formatDuration(duration)}</span>
}
