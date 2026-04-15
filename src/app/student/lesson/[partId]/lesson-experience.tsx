'use client'

/* eslint-disable @next/next/no-img-element */

import {
  startTransition,
  type ChangeEvent,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  deleteMyStudentRecording,
  recordPracticeEvent,
  saveStudentRecording,
} from '../../actions'
import type { LessonSlide, PracticeEvent, StudentRecording } from '@/lib/practice-data'
import type { LessonMediaKind } from '@/lib/lesson-media'

type LessonExperienceProps = {
  mediaKind: LessonMediaKind
  mediaUrl: string | null
  durationSeconds: number | null
  initialSlides: LessonSlide[]
  initialPracticeEvents: PracticeEvent[]
  studentRecording: StudentRecording | null
  lessonPartId: number
}

export default function LessonExperience({
  mediaKind,
  mediaUrl,
  durationSeconds,
  initialSlides,
  initialPracticeEvents,
  studentRecording,
  lessonPartId,
}: LessonExperienceProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordingStreamRef = useRef<MediaStream | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const recordingSecondsRef = useRef(0)
  const recordTimerRef = useRef<number | null>(null)
  const recordIntervalRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
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
  const [mediaDuration, setMediaDuration] = useState<number | null>(
    durationSeconds
  )
  const [isRecording, setIsRecording] = useState(false)
  const [isRecordingBusy, setIsRecordingBusy] = useState(false)
  const [recordingStatus, setRecordingStatus] = useState<string | null>(null)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [recordingPreviewUrl, setRecordingPreviewUrl] = useState<string | null>(
    studentRecording?.signed_url ?? null
  )
  const [recordingMeta, setRecordingMeta] = useState<{
    createdAt: string
    durationSeconds: number | null
  } | null>(
    studentRecording
      ? {
          createdAt: studentRecording.created_at,
          durationSeconds: studentRecording.duration_seconds,
        }
      : null
  )

  const activeSlideIndex =
    initialSlides.findLastIndex((slide) => slide.start_second <= currentTime) || 0
  const activeSlide = initialSlides[Math.max(activeSlideIndex, 0)] ?? null
  const completedCount = practiceEvents.filter((event) => event.completed).length
  const sourceDuration =
    mediaDuration && Number.isFinite(mediaDuration) && mediaDuration > 0
      ? mediaDuration
      : durationSeconds && durationSeconds > 0
        ? durationSeconds
        : null
  const maxRecordingSeconds = sourceDuration
    ? Math.max(1, Math.floor(sourceDuration * 2))
    : null

  function getMediaElement() {
    return mediaKind === 'video' ? videoRef.current : audioRef.current
  }

  function stopRecordingCleanup() {
    if (recordTimerRef.current) {
      window.clearTimeout(recordTimerRef.current)
      recordTimerRef.current = null
    }

    if (recordIntervalRef.current) {
      window.clearInterval(recordIntervalRef.current)
      recordIntervalRef.current = null
    }

    if (recordingStreamRef.current) {
      recordingStreamRef.current.getTracks().forEach((track) => track.stop())
      recordingStreamRef.current = null
    }
  }

  useEffect(() => {
    if (activeSlideIndex >= 0) {
      setViewerSlideIndex(activeSlideIndex)
    }
  }, [activeSlideIndex])

  useEffect(() => {
    const media = mediaKind === 'video' ? videoRef.current : audioRef.current

    if (!mediaUrl || !media) {
      return
    }

    const handleLoadedMetadata = () => {
      if (Number.isFinite(media.duration)) {
        setMediaDuration(media.duration)
      }
    }

    media.addEventListener('loadedmetadata', handleLoadedMetadata)
    handleLoadedMetadata()

    return () => {
      media.removeEventListener('loadedmetadata', handleLoadedMetadata)
    }
  }, [mediaKind, mediaUrl])

  useEffect(() => {
    return () => {
      stopRecordingCleanup()
      if (recordingPreviewUrl && recordingPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(recordingPreviewUrl)
      }
    }
  }, [recordingPreviewUrl])

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
    const media = getMediaElement()

    if (!media) {
      return
    }

    if (!loggedPracticeRef.current) {
      const startsAtBeginning = media.currentTime <= 0.75
      playbackStartedAtBeginningRef.current = startsAtBeginning
      continuousPlaybackRef.current = startsAtBeginning
      loggedPracticeRef.current = true

      startTransition(() => {
        void logEvent(false, 'התרגול נרשם. השלמה תישמר אוטומטית בסוף האזנה רציפה.')
      })
    } else if (media.currentTime < media.duration - 0.5) {
      continuousPlaybackRef.current = false
    }
  }

  function handleTimeUpdate() {
    const media = getMediaElement()

    if (!media) {
      return
    }

    setCurrentTime(media.currentTime)
    lastStableTimeRef.current = media.currentTime
  }

  function handlePause() {
    const media = getMediaElement()

    if (!media) {
      return
    }

    if (media.currentTime > 0 && media.currentTime < media.duration - 0.5) {
      continuousPlaybackRef.current = false
    }
  }

  function handleSeeking() {
    const media = getMediaElement()

    if (!media) {
      return
    }

    if (Math.abs(media.currentTime - lastStableTimeRef.current) > 1.5) {
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
    const media = getMediaElement()

    if (!slide) {
      return
    }

    setViewerSlideIndex(index)

    if (media) {
      media.currentTime = slide.start_second
      setCurrentTime(slide.start_second)
      continuousPlaybackRef.current = false
    }
  }

  async function uploadRecording(file: File, explicitDurationSeconds?: number | null) {
    setIsRecordingBusy(true)
    setRecordingStatus('מעלה את ההקלטה...')

    try {
      const formData = new FormData()
      formData.set('lessonPartId', String(lessonPartId))
      formData.set('recording', file)

      if (
        explicitDurationSeconds !== null &&
        explicitDurationSeconds !== undefined &&
        Number.isFinite(explicitDurationSeconds)
      ) {
        formData.set('durationSeconds', String(Math.round(explicitDurationSeconds)))
      }

      const result = await saveStudentRecording(formData)

      if (recordingPreviewUrl && recordingPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(recordingPreviewUrl)
      }

      setRecordingPreviewUrl(URL.createObjectURL(file))
      setRecordingMeta({
        createdAt: result.createdAt,
        durationSeconds: result.durationSeconds,
      })
      setRecordingStatus('ההקלטה נשמרה בהצלחה.')
    } catch (error) {
      setRecordingStatus(
        error instanceof Error ? error.message : 'לא הצלחנו לשמור את ההקלטה.'
      )
    } finally {
      setIsRecordingBusy(false)
    }
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setRecordingStatus('הדפדפן הזה לא תומך בהקלטה ישירה.')
      return
    }

    if (!maxRecordingSeconds) {
      setRecordingStatus('לא הצלחנו לזהות את אורך הקטע, ולכן אי אפשר להתחיל הקלטה כרגע.')
      return
    }

    setIsRecordingBusy(true)
    setRecordingStatus('מתחיל הקלטה...')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : ''
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)

      recordingStreamRef.current = stream
      mediaRecorderRef.current = recorder
      recordedChunksRef.current = []
      recordingSecondsRef.current = 0
      setRecordingSeconds(0)

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data)
        }
      })

      recorder.addEventListener('stop', () => {
        stopRecordingCleanup()
        setIsRecording(false)

        const finalDuration =
          recordingSecondsRef.current > 0 ? recordingSecondsRef.current : null
        const blob = new Blob(recordedChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        })
        const extension = recorder.mimeType.includes('mp4') ? 'm4a' : 'webm'
        const file = new File([blob], `student-recording.${extension}`, {
          type: recorder.mimeType || 'audio/webm',
        })

        startTransition(() => {
          void uploadRecording(file, finalDuration)
        })
      })

      recorder.start()
      setIsRecording(true)
      setIsRecordingBusy(false)
      setRecordingStatus(`מקליט... אפשר עד ${formatDuration(maxRecordingSeconds)}`)

      recordIntervalRef.current = window.setInterval(() => {
        setRecordingSeconds((current) => {
          recordingSecondsRef.current = current + 1

          if (maxRecordingSeconds && current + 1 >= maxRecordingSeconds) {
            mediaRecorderRef.current?.stop()
          }

          return current + 1
        })
      }, 1000)

      recordTimerRef.current = window.setTimeout(() => {
        mediaRecorderRef.current?.stop()
      }, maxRecordingSeconds * 1000)
    } catch (error) {
      stopRecordingCleanup()
      setIsRecording(false)
      setIsRecordingBusy(false)
      setRecordingStatus(
        error instanceof Error ? error.message : 'לא הצלחנו להתחיל את ההקלטה.'
      )
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop()
  }

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    const fileDuration = await new Promise<number | null>((resolve) => {
      const audio = document.createElement('audio')
      audio.preload = 'metadata'
      audio.src = URL.createObjectURL(file)
      audio.onloadedmetadata = () => {
        const duration = Number.isFinite(audio.duration) ? audio.duration : null
        URL.revokeObjectURL(audio.src)
        resolve(duration)
      }
      audio.onerror = () => {
        URL.revokeObjectURL(audio.src)
        resolve(null)
      }
    })

    if (maxRecordingSeconds && fileDuration && fileDuration > maxRecordingSeconds + 1) {
      setRecordingStatus('הקובץ ארוך מדי. אפשר להעלות עד פי 2 מזמן הקטע בלבד.')
      event.target.value = ''
      return
    }

    await uploadRecording(file, fileDuration)
    event.target.value = ''
  }

  async function deleteRecording() {
    setIsRecordingBusy(true)
    setRecordingStatus('מוחק את ההקלטה...')

    try {
      const formData = new FormData()
      formData.set('lessonPartId', String(lessonPartId))
      await deleteMyStudentRecording(formData)

      if (recordingPreviewUrl && recordingPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(recordingPreviewUrl)
      }

      setRecordingPreviewUrl(null)
      setRecordingMeta(null)
      setRecordingStatus('ההקלטה נמחקה.')
    } catch (error) {
      setRecordingStatus(
        error instanceof Error ? error.message : 'לא הצלחנו למחוק את ההקלטה.'
      )
    } finally {
      setIsRecordingBusy(false)
    }
  }

  return (
    <>
      <div className="space-y-4">
        {mediaKind === 'video' ? (
          <div className="student-audio-panel p-4 ring-1 ring-white/70">
            {mediaUrl ? (
              <video
                ref={videoRef}
                controls
                className="w-full rounded-[24px] bg-black shadow-2xl shadow-slate-900/10"
                onEnded={handleEnded}
                onPause={handlePause}
                onPlay={handleAudioPlay}
                onSeeking={handleSeeking}
                onTimeUpdate={handleTimeUpdate}
                src={mediaUrl}
              />
            ) : (
              <div className="flex min-h-[420px] items-center justify-center rounded-[24px] bg-white/85 text-center text-slate-500">
                אין וידאו לתת-החלק הזה
              </div>
            )}
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => openViewer(Math.max(activeSlideIndex, 0))}
              className="student-audio-panel block w-full p-4 text-right ring-1 ring-white/70"
            >
              {activeSlide ? (
                <img
                  src={activeSlide.image_url}
                  alt={`Slide ${activeSlide.slide_index}`}
                  className="w-full rounded-[24px] object-contain shadow-2xl shadow-slate-900/10"
                />
              ) : (
                <div className="flex min-h-[420px] items-center justify-center rounded-[24px] bg-white/85 text-center text-slate-500">
                  אין תמונה לתת-החלק הזה
                </div>
              )}
            </button>

            <div className="student-card p-4 ring-1 ring-white/70">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-lg font-black text-slate-900">שקופיות מסונכרנות</h4>
                  <p className="text-sm text-slate-500">
                    אפשר לפתוח גדול, או לקפוץ ישירות לשנייה המתאימה בהקלטה.
                  </p>
                </div>
                <span className="student-badge bg-[var(--student-cream)] text-slate-700 ring-1 ring-amber-100">
                  {initialSlides.length} תמונות
                </span>
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
                        className={`overflow-hidden rounded-[24px] bg-white text-right shadow-lg shadow-slate-900/5 ring-1 transition ${
                          isActive
                            ? 'ring-2 ring-[var(--student-orange)]'
                            : 'ring-slate-200 hover:ring-[var(--student-blue)]'
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
                <div className="rounded-[24px] bg-white p-4 text-sm text-slate-500 ring-1 ring-slate-200">
                  עדיין לא הוגדרו תמונות לקטע הזה.
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="space-y-4">
        <div className="student-audio-panel p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-600">
              {mediaKind === 'video' ? 'נגן וידאו' : 'נגן אודיו'}
            </p>
            <span className="student-badge bg-white/80 text-slate-700 ring-1 ring-white/80">
              הקשבה רציפה = השלמה
            </span>
          </div>

          {mediaKind === 'audio_slides' && mediaUrl ? (
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
              <source src={mediaUrl} type="audio/mpeg" />
              הדפדפן שלך לא תומך בנגן אודיו
            </audio>
          ) : mediaKind === 'video' ? (
            <p className="text-sm text-slate-500">
              הווידאו מופיע בצד שמאל, והשלמה תסומן רק אם הוא נוגן ברצף מלא.
            </p>
          ) : (
            <p className="text-sm text-slate-500">עדיין לא הוגדר קובץ מדיה.</p>
          )}

          <p className="mt-3 text-sm text-slate-500">
            השלמה תסומן רק אם {mediaKind === 'video' ? 'הווידאו' : 'הקטע'} נוגן ברציפות מתחילתו ועד סופו.
          </p>
        </div>

        <div className="student-card p-4">
          <p className="text-sm font-semibold text-slate-600">סטטיסטיקה</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-[24px] bg-white p-4 text-center ring-1 ring-slate-200">
              <p className="text-xs text-slate-400">תרגולים</p>
              <p className="mt-2 text-3xl font-black text-slate-900">
                {practiceEvents.length}
              </p>
            </div>
            <div className="rounded-[24px] bg-white p-4 text-center ring-1 ring-slate-200">
              <p className="text-xs text-slate-400">השלמות</p>
              <p className="mt-2 text-3xl font-black text-slate-900">
                {completedCount}
              </p>
            </div>
          </div>

          <p className="mt-4 text-sm text-slate-500">
            משך: {mediaDuration ? formatDuration(mediaDuration) : 'לא הוגדר'}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            זמן נוכחי: {Math.floor(currentTime)} שנ׳
          </p>
        </div>

        <div className="student-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-700">הקלטה שלי</p>
              <p className="mt-1 text-sm text-slate-500">
                אפשר להקליט או להעלות קובץ אחד בלבד לקטע הזה, עד פי 2 מאורך {mediaKind === 'video' ? 'הווידאו' : 'האודיו'}.
              </p>
            </div>
            {maxRecordingSeconds ? (
              <span className="student-badge bg-[var(--student-cream)] text-slate-700 ring-1 ring-amber-100">
                מקסימום {formatDuration(maxRecordingSeconds)}
              </span>
            ) : null}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isRecordingBusy || !maxRecordingSeconds}
              className={`rounded-2xl px-4 py-3 text-sm font-semibold text-white ${
                isRecording ? 'bg-rose-600' : 'bg-[var(--student-orange)]'
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {isRecording ? `עצירת הקלטה (${formatDuration(recordingSeconds)})` : 'התחלת הקלטה'}
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isRecordingBusy || isRecording}
              className="rounded-2xl bg-[var(--student-ink)] px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              העלאת קובץ קיים
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              hidden
              onChange={(event) => {
                void handleFileUpload(event)
              }}
            />
          </div>

          {recordingPreviewUrl ? (
            <div className="mt-4 rounded-[24px] bg-white p-4 ring-1 ring-slate-200">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-700">ההקלטה השמורה שלך</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {recordingMeta?.createdAt
                      ? `נשמרה ב־${new Date(recordingMeta.createdAt).toLocaleString('he-IL')}`
                      : 'ההקלטה זמינה להשמעה'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    startTransition(() => {
                      void deleteRecording()
                    })
                  }}
                  disabled={isRecordingBusy}
                  className="rounded-2xl bg-rose-100 px-4 py-2 text-sm font-semibold text-rose-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  מחיקת ההקלטה
                </button>
              </div>

              <audio controls className="w-full" src={recordingPreviewUrl}>
                הדפדפן שלך לא תומך בהשמעת ההקלטה.
              </audio>

              <p className="mt-3 text-xs text-slate-500">
                משך: {recordingMeta?.durationSeconds ? formatDuration(recordingMeta.durationSeconds) : 'לא זוהה'}
              </p>
            </div>
          ) : (
            <div className="mt-4 rounded-[24px] bg-white p-4 text-sm text-slate-500 ring-1 ring-slate-200">
              עדיין לא נשמרה הקלטה אישית לקטע הזה.
            </div>
          )}

          {recordingStatus ? (
            <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
              {recordingStatus}
            </div>
          ) : null}
        </div>

        <div className="student-card p-4">
          <p className="text-sm font-semibold text-slate-700">היסטוריית תרגול</p>

          {practiceEvents.length > 0 ? (
            <div className="mt-4 space-y-3">
              {practiceEvents.slice(0, 6).map((event) => (
                <div
                  key={event.id}
                  className="rounded-[24px] bg-white px-4 py-3 text-sm text-slate-600 ring-1 ring-slate-200"
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
          <div className="rounded-[24px] bg-blue-50 p-4 text-sm text-blue-900 ring-1 ring-blue-200">
            {statusMessage}
          </div>
        ) : null}
      </div>

      {isViewerOpen && activeSlide && mediaKind === 'audio_slides' ? (
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
