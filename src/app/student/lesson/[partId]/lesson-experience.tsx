'use client'

/* eslint-disable @next/next/no-img-element */

import { startTransition, useEffect, useRef, useState } from 'react'
import { recordPracticeEvent } from '../../actions'
import type { LessonSlide, PracticeEvent } from '@/lib/practice-data'

type LessonExperienceProps = {
  audioUrl: string | null
  durationSeconds: number | null
  initialSlides: LessonSlide[]
  initialPracticeEvents: PracticeEvent[]
  lessonPartId: number
}

export default function LessonExperience({
  audioUrl,
  durationSeconds,
  initialSlides,
  initialPracticeEvents,
  lessonPartId,
}: LessonExperienceProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const lastStableTimeRef = useRef(0)
  const loggedPracticeRef = useRef(false)
  const completionLoggedRef = useRef(false)
  const playbackStartedAtBeginningRef = useRef(false)
  const continuousPlaybackRef = useRef(false)

  const [currentTime, setCurrentTime] = useState(0)
  const [isViewerOpen, setIsViewerOpen] = useState(false)
  const [viewerSlideIndex, setViewerSlideIndex] = useState(0)
  const [practiceEvents, setPracticeEvents] =
    useState<PracticeEvent[]>(initialPracticeEvents)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [audioDuration, setAudioDuration] = useState<number | null>(
    durationSeconds
  )

  const activeSlideIndex =
    initialSlides.findLastIndex((slide) => slide.start_second <= currentTime) || 0
  const activeSlide = initialSlides[Math.max(activeSlideIndex, 0)] ?? null
  const completedCount = practiceEvents.filter((event) => event.completed).length

  useEffect(() => {
    if (activeSlideIndex >= 0) {
      setViewerSlideIndex(activeSlideIndex)
    }
  }, [activeSlideIndex])

  useEffect(() => {
    const audio = audioRef.current

    if (!audioUrl || !audio) {
      return
    }

    const handleLoadedMetadata = () => {
      if (Number.isFinite(audio.duration)) {
        setAudioDuration(audio.duration)
      }
    }

    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    handleLoadedMetadata()

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
    }
  }, [audioUrl])

  function formatDuration(totalSeconds: number) {
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = Math.floor(totalSeconds % 60)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  async function logEvent(completed: boolean, successMessage: string) {
    if (isSaving) {
      return
    }

    setIsSaving(true)

    try {
      const event = await recordPracticeEvent({
        lessonPartId,
        completed,
      })

      if (event) {
        setPracticeEvents((current) => [event, ...current])
      }

      setStatusMessage(successMessage)
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : 'לא הצלחנו לשמור את התרגול'
      )
    } finally {
      setIsSaving(false)
    }
  }

  function openViewer(index: number) {
    setViewerSlideIndex(index)
    setIsViewerOpen(true)
  }

  function handleAudioPlay() {
    const audio = audioRef.current

    if (!audio) {
      return
    }

    if (!loggedPracticeRef.current) {
      const startsAtBeginning = audio.currentTime <= 0.75
      playbackStartedAtBeginningRef.current = startsAtBeginning
      continuousPlaybackRef.current = startsAtBeginning
      loggedPracticeRef.current = true

      startTransition(() => {
        void logEvent(false, 'התרגול נרשם. השלמה תישמר אוטומטית בסוף האזנה רציפה.')
      })
    } else if (audio.currentTime < audio.duration - 0.5) {
      continuousPlaybackRef.current = false
    }
  }

  function handleTimeUpdate() {
    const audio = audioRef.current

    if (!audio) {
      return
    }

    setCurrentTime(audio.currentTime)
    lastStableTimeRef.current = audio.currentTime
  }

  function handlePause() {
    const audio = audioRef.current

    if (!audio) {
      return
    }

    if (audio.currentTime > 0 && audio.currentTime < audio.duration - 0.5) {
      continuousPlaybackRef.current = false
    }
  }

  function handleSeeking() {
    const audio = audioRef.current

    if (!audio) {
      return
    }

    if (Math.abs(audio.currentTime - lastStableTimeRef.current) > 1.5) {
      continuousPlaybackRef.current = false
    }
  }

  function handleEnded() {
    const canComplete =
      playbackStartedAtBeginningRef.current &&
      continuousPlaybackRef.current &&
      !completionLoggedRef.current

    if (!canComplete) {
      setStatusMessage('ההאזנה הסתיימה, אבל לא ברצף מלא מתחילת הקטע ולכן לא סומנה כהשלמה.')
      return
    }

    completionLoggedRef.current = true

    startTransition(() => {
      void logEvent(true, 'כל הכבוד, הקטע הושלם בהאזנה רציפה וסומן אוטומטית.')
    })
  }

  function jumpToSlide(index: number) {
    const slide = initialSlides[index]
    const audio = audioRef.current

    if (!slide) {
      return
    }

    setViewerSlideIndex(index)

    if (audio) {
      audio.currentTime = slide.start_second
      setCurrentTime(slide.start_second)
      continuousPlaybackRef.current = false
    }
  }

  return (
    <>
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => openViewer(Math.max(activeSlideIndex, 0))}
          className="block w-full rounded-3xl border-2 border-dashed border-slate-300 bg-slate-100 p-4 text-right"
        >
          {activeSlide ? (
            <img
              src={activeSlide.image_url}
              alt={`Slide ${activeSlide.slide_index}`}
              className="w-full rounded-2xl object-contain"
            />
          ) : (
            <div className="flex min-h-[420px] items-center justify-center rounded-2xl bg-white text-center text-slate-400">
              אין תמונה לתת-החלק הזה
            </div>
          )}
        </button>

        <div className="rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-lg font-semibold text-slate-900">שקופיות מסונכרנות</h4>
              <p className="text-sm text-slate-500">
                אפשר לפתוח גדול, או לקפוץ ישירות לשנייה המתאימה בהקלטה.
              </p>
            </div>
            <span className="text-sm text-slate-500">{initialSlides.length} תמונות</span>
          </div>

          {initialSlides.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {initialSlides.map((slide, index) => {
                const isActive = index === activeSlideIndex

                return (
                  <button
                    key={slide.id}
                    type="button"
                    onClick={() => jumpToSlide(index)}
                    onDoubleClick={() => openViewer(index)}
                    className={`overflow-hidden rounded-2xl bg-white text-right ring-1 transition ${
                      isActive
                        ? 'ring-2 ring-blue-500'
                        : 'ring-slate-200 hover:ring-blue-300'
                    }`}
                  >
                    <img
                      src={slide.image_url}
                      alt={`שקופית ${slide.slide_index}`}
                      className="h-40 w-full object-cover"
                    />
                    <div className="flex items-center justify-between px-4 py-3 text-sm text-slate-600">
                      <span>שקופית {slide.slide_index}</span>
                      <span>{slide.start_second} שנ׳</span>
                    </div>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="rounded-2xl bg-white p-4 text-sm text-slate-500 ring-1 ring-slate-200">
              עדיין לא הוגדרו תמונות לקטע הזה.
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-2xl bg-slate-100 p-4">
          <p className="mb-2 text-sm font-medium text-slate-600">נגן אודיו</p>

          {audioUrl ? (
            <audio
              ref={audioRef}
              controls
              className="w-full"
              onEnded={handleEnded}
              onPause={handlePause}
              onPlay={handleAudioPlay}
              onSeeking={handleSeeking}
              onTimeUpdate={handleTimeUpdate}
            >
              <source src={audioUrl} type="audio/mpeg" />
              הדפדפן שלך לא תומך בנגן אודיו
            </audio>
          ) : (
            <p className="text-sm text-slate-500">עדיין לא הוגדר קובץ אודיו.</p>
          )}

          <p className="mt-3 text-sm text-slate-500">
            השלמה תסומן רק אם הקטע נוגן ברציפות מתחילתו ועד סופו.
          </p>
        </div>

        <div className="rounded-2xl bg-slate-100 p-4">
          <p className="text-sm text-slate-600">סטטיסטיקה</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white p-4 text-center ring-1 ring-slate-200">
              <p className="text-xs text-slate-400">תרגולים</p>
              <p className="mt-2 text-3xl font-black text-slate-900">
                {practiceEvents.length}
              </p>
            </div>
            <div className="rounded-2xl bg-white p-4 text-center ring-1 ring-slate-200">
              <p className="text-xs text-slate-400">השלמות</p>
              <p className="mt-2 text-3xl font-black text-slate-900">
                {completedCount}
              </p>
            </div>
          </div>

          <p className="mt-4 text-sm text-slate-500">
            משך: {audioDuration ? formatDuration(audioDuration) : 'לא הוגדר'}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            זמן נוכחי: {Math.floor(currentTime)} שנ׳
          </p>
        </div>

        <div className="rounded-2xl bg-slate-100 p-4">
          <p className="text-sm font-medium text-slate-700">היסטוריית תרגול</p>

          {practiceEvents.length > 0 ? (
            <div className="mt-4 space-y-3">
              {practiceEvents.slice(0, 6).map((event) => (
                <div
                  key={event.id}
                  className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-600 ring-1 ring-slate-200"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span>{event.completed ? 'הושלם אוטומטית' : 'התחיל תרגול'}</span>
                    <span>{new Date(event.created_at).toLocaleString('he-IL')}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500">אין עדיין אירועי תרגול לקטע הזה.</p>
          )}
        </div>

        {statusMessage ? (
          <div className="rounded-2xl bg-blue-50 p-4 text-sm text-blue-900 ring-1 ring-blue-200">
            {statusMessage}
          </div>
        ) : null}
      </div>

      {isViewerOpen && activeSlide ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="w-full max-w-5xl rounded-[2rem] bg-white p-4 shadow-2xl sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-slate-500">תצוגה מוגדלת</p>
                <h4 className="text-xl font-bold text-slate-900">
                  שקופית {initialSlides[viewerSlideIndex]?.slide_index ?? '-'}
                </h4>
              </div>

              <button
                type="button"
                onClick={() => setIsViewerOpen(false)}
                className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700"
              >
                סגירה
              </button>
            </div>

            <img
              src={initialSlides[viewerSlideIndex]?.image_url ?? activeSlide.image_url}
              alt="שקופית מוגדלת"
              className="max-h-[70vh] w-full rounded-3xl object-contain"
            />

            <div className="mt-4 flex flex-wrap gap-3">
              {initialSlides.map((slide, index) => (
                <button
                  key={slide.id}
                  type="button"
                  onClick={() => setViewerSlideIndex(index)}
                  className={`rounded-2xl px-4 py-2 text-sm font-semibold ${
                    index === viewerSlideIndex
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  שקופית {slide.slide_index}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
