'use client'

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { recordPracticeEvent, saveStudentRecording } from '../../actions'
import { getActiveSynchronizedTokenIndex, groupSynchronizedLayout, type SynchronizedToken } from '@/lib/synchronized-reading-layout'

type TimedToken = SynchronizedToken

export default function SynchronizedReading({
  lessonPartId,
  audioUrl,
  existingRecordingUrl,
  sourceRef,
  tokens,
}: {
  lessonPartId: number
  audioUrl: string
  existingRecordingUrl?: string | null
  sourceRef: string
  tokens: TimedToken[]
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pendingSeekRef = useRef<{ audio: HTMLAudioElement; listener: () => void } | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioBufferRef = useRef<AudioBuffer | null>(null)
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const webAudioLoadStartedRef = useRef(false)
  const webAudioPositionRef = useRef(0)
  const webAudioStartedAtRef = useRef(0)
  const webAudioPlayingRef = useRef(false)
  const seekDraggingRef = useRef(false)
  const resumeAfterSeekRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const tokenRefs = useRef(new Map<number, HTMLButtonElement>())
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const hasStartedRef = useRef(false)
  const hasCompletedRef = useRef(false)
  const continuousPlaybackRef = useRef(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [playerMode, setPlayerMode] = useState<'native' | 'web-audio'>('web-audio')
  const [webAudioLoading, setWebAudioLoading] = useState(true)
  const [webAudioReady, setWebAudioReady] = useState(false)
  const [webAudioPlaying, setWebAudioPlaying] = useState(false)
  const [webAudioTime, setWebAudioTime] = useState(0)
  const [displayMode, setDisplayMode] = useState<'vocalized' | 'torah'>('vocalized')
  const [backgroundMode, setBackgroundMode] = useState<'warm' | 'white'>('white')
  const [preferencesLoaded, setPreferencesLoaded] = useState(false)
  const [highlight, setHighlight] = useState<'yellow' | 'inverse' | 'red' | 'red-large'>('yellow')
  const [error, setError] = useState('')
  const [audioDuration, setAudioDuration] = useState(0)
  const [recording, setRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [recordingFile, setRecordingFile] = useState<File | null>(null)
  const [recordingUrl, setRecordingUrl] = useState<string | null>(existingRecordingUrl ?? null)
  const [recordingStatus, setRecordingStatus] = useState('')
  const [savingRecording, setSavingRecording] = useState(false)

  const layoutRows = groupSynchronizedLayout(tokens)
  const hasSemanticLayout = layoutRows.length > 0
  const usesFallbackLayout = tokens.some((token) => token.layoutSource === 'text2video-flow')
  const usesTikkunRows = tokens.some((token) => token.layoutSource === 'tikkun-rows')
  const tokenPositionByIndex = new Map(tokens.map((token, index) => [token.index, index]))
  const maxRecordingSeconds = audioDuration > 0 ? Math.max(60, Math.floor(audioDuration * 2)) : 1800

  function getWebAudioCurrentTime() {
    const context = audioContextRef.current
    const buffer = audioBufferRef.current
    if (!context || !buffer || !webAudioPlayingRef.current) return webAudioPositionRef.current
    return Math.min(buffer.duration, webAudioPositionRef.current + Math.max(0, context.currentTime - webAudioStartedAtRef.current))
  }

  function stopWebAudioSource() {
    const source = audioSourceRef.current
    if (!source) return
    source.onended = null
    try { source.stop() } catch { /* The source may have ended already. */ }
    source.disconnect()
    audioSourceRef.current = null
  }

  function pauseWebAudio() {
    if (!webAudioPlayingRef.current) return
    const position = getWebAudioCurrentTime()
    webAudioPositionRef.current = position
    webAudioPlayingRef.current = false
    stopWebAudioSource()
    setWebAudioPlaying(false)
    setWebAudioTime(position)
    continuousPlaybackRef.current = false
  }

  async function playWebAudioAt(position: number) {
    const context = audioContextRef.current
    const buffer = audioBufferRef.current
    if (!context || !buffer) return

    try {
      await context.resume()
      stopWebAudioSource()
      const offset = Math.max(0, Math.min(position, Math.max(0, buffer.duration - 0.01)))
      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(context.destination)
      webAudioPositionRef.current = offset
      webAudioStartedAtRef.current = context.currentTime
      webAudioPlayingRef.current = true
      audioSourceRef.current = source
      source.onended = () => {
        if (audioSourceRef.current !== source) return
        source.disconnect()
        audioSourceRef.current = null
        webAudioPositionRef.current = buffer.duration
        webAudioPlayingRef.current = false
        setWebAudioPlaying(false)
        setWebAudioTime(buffer.duration)
        void handleEnded()
      }
      source.start(0, offset)
      setWebAudioPlaying(true)
      setWebAudioTime(offset)
      void handlePlay(offset)
    } catch (cause) {
      webAudioPlayingRef.current = false
      setWebAudioPlaying(false)
      setError(cause instanceof Error ? cause.message : 'לא הצלחנו להפעיל את הנגן.')
    }
  }

  async function loadWebAudio() {
    if (audioBufferRef.current) {
      audioRef.current?.pause()
      setPlayerMode('web-audio')
      return
    }
    audioRef.current?.pause()
    setWebAudioLoading(true)
    setError('')
    let context: AudioContext | null = null
    try {
      context = new AudioContext()
      const response = await fetch(audioUrl)
      if (!response.ok) throw new Error(`טעינת קובץ השמע נכשלה (${response.status}).`)
      const buffer = await context.decodeAudioData(await response.arrayBuffer())
      audioContextRef.current = context
      audioBufferRef.current = buffer
      setAudioDuration(buffer.duration)
      webAudioPositionRef.current = 0
      setWebAudioTime(0)
      audioRef.current?.pause()
      setPlayerMode('web-audio')
      setWebAudioReady(true)
    } catch (cause) {
      await context?.close().catch(() => undefined)
      setPlayerMode('native')
      setError(cause instanceof Error ? cause.message : 'הדפדפן לא הצליח לפענח את קובץ השמע לנגן החדש.')
    } finally {
      setWebAudioLoading(false)
    }
  }

  function returnToNativePlayer() {
    const position = getWebAudioCurrentTime()
    pauseWebAudio()
    if (audioRef.current) audioRef.current.currentTime = position
    setPlayerMode('native')
  }

  function beginWebAudioSeek() {
    if (seekDraggingRef.current) return
    seekDraggingRef.current = true
    resumeAfterSeekRef.current = webAudioPlayingRef.current
    if (webAudioPlayingRef.current) pauseWebAudio()
  }

  function finishWebAudioSeek() {
    if (!seekDraggingRef.current) return
    seekDraggingRef.current = false
    if (resumeAfterSeekRef.current) {
      resumeAfterSeekRef.current = false
      void playWebAudioAt(webAudioPositionRef.current)
    }
  }

  function formatTime(time: number) {
    const safeTime = Math.max(0, Math.floor(time))
    return `${Math.floor(safeTime / 60)}:${String(safeTime % 60).padStart(2, '0')}`
  }

  const initializeWebAudio = useEffectEvent(async () => {
    if (webAudioLoadStartedRef.current) return
    webAudioLoadStartedRef.current = true
    await loadWebAudio()
  })

  useEffect(() => {
    void initializeWebAudio()
  }, [])

  useEffect(() => {
    try {
      const saved = localStorage.getItem('student-synchronized-reading-preferences')
      if (saved) {
        const preferences = JSON.parse(saved) as { displayMode?: string; backgroundMode?: string }
        if (preferences.displayMode === 'vocalized' || preferences.displayMode === 'torah') setDisplayMode(preferences.displayMode)
        if (preferences.backgroundMode === 'warm' || preferences.backgroundMode === 'white') setBackgroundMode(preferences.backgroundMode)
      }
    } catch {
      // Ignore unavailable or malformed local preferences.
    } finally {
      setPreferencesLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (!preferencesLoaded) return
    try {
      localStorage.setItem('student-synchronized-reading-preferences', JSON.stringify({ displayMode, backgroundMode }))
    } catch {
      // The reader remains usable when browser storage is disabled.
    }
  }, [backgroundMode, displayMode, preferencesLoaded])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    let frame = 0
    const sync = () => {
      const time = audio.currentTime
      // During gaps or silence, hold the most recently started word instead of flashing blank.
      const index = getActiveSynchronizedTokenIndex(tokens, time)
      setActiveIndex((current) => current === index ? current : index)
    }
    const tick = () => { sync(); if (!audio.paused && !audio.ended) frame = requestAnimationFrame(tick) }
    const play = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(tick) }
    const stop = () => { cancelAnimationFrame(frame); sync() }
    audio.addEventListener('play', play)
    audio.addEventListener('pause', stop)
    audio.addEventListener('ended', stop)
    audio.addEventListener('seeked', sync)
    if (!audio.paused) play()
    return () => {
      cancelAnimationFrame(frame)
      audio.removeEventListener('play', play)
      audio.removeEventListener('pause', stop)
      audio.removeEventListener('ended', stop)
      audio.removeEventListener('seeked', sync)
    }
  }, [tokens])

  useEffect(() => {
    if (playerMode !== 'web-audio' || !webAudioPlaying) return
    let frame = 0
    let lastDisplayedTime = webAudioPositionRef.current
    const tick = () => {
      const time = getWebAudioCurrentTime()
      const index = getActiveSynchronizedTokenIndex(tokens, time)
      setActiveIndex((current) => current === index ? current : index)
      if (time - lastDisplayedTime >= 0.1) {
        lastDisplayedTime = time
        setWebAudioTime(time)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playerMode, tokens, webAudioPlaying])

  useEffect(() => {
    const viewport = scrollRef.current
    const token = tokens[activeIndex]
    const element = token ? tokenRefs.current.get(token.index) : null
    if (!viewport || !element) return
    const viewportRect = viewport.getBoundingClientRect()
    const tokenRect = element.getBoundingClientRect()
    const position = tokenRect.top - viewportRect.top
    const lowerLimit = viewport.clientHeight * 0.76
    const upperLimit = viewport.clientHeight * 0.2
    if (position > lowerLimit || position < upperLimit) {
      viewport.scrollTo({
        top: viewport.scrollTop + position - viewport.clientHeight * 0.48,
        behavior: 'smooth',
      })
    }
  }, [activeIndex, tokens])

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    streamRef.current?.getTracks().forEach((track) => track.stop())
    if (recordingUrl?.startsWith('blob:')) URL.revokeObjectURL(recordingUrl)
  }, [recordingUrl])

  useEffect(() => () => {
    const pendingSeek = pendingSeekRef.current
    if (pendingSeek) pendingSeek.audio.removeEventListener('seeked', pendingSeek.listener)
    const source = audioSourceRef.current
    if (source) {
      source.onended = null
      try { source.stop() } catch { /* The source may have ended already. */ }
      source.disconnect()
    }
    void audioContextRef.current?.close().catch(() => undefined)
  }, [])

  function displayWord(word: string) {
    if (displayMode === 'vocalized') return word
    return word
      .replace(/[\u05B0-\u05BC\u05C7]/g, '')
      .replace(/[\u0591-\u05AF\u05BD\u05C4\u05C5]/g, '')
      .replace(/[:׃־\-|׀]/g, ' ')
  }

  async function handlePlay(playbackPosition?: number) {
    const audio = audioRef.current
    if (!hasStartedRef.current) {
      hasStartedRef.current = true
      continuousPlaybackRef.current = (playbackPosition ?? audio?.currentTime ?? 0) <= 0.75
      try { await recordPracticeEvent({ lessonPartId, completed: false }) }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'לא הצלחנו לעדכן את המעקב.') }
    } else if (audio && audio.currentTime > 0.75) {
      continuousPlaybackRef.current = false
    }
  }

  async function handleEnded() {
    if (hasCompletedRef.current || !continuousPlaybackRef.current) return
    hasCompletedRef.current = true
    try { await recordPracticeEvent({ lessonPartId, completed: true }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'לא הצלחנו לשמור השלמה.') }
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setRecordingStatus('הדפדפן הזה לא תומך בהקלטה. אפשר לנסות דפדפן עדכני או מחשב אחר.')
      return
    }
    try {
      audioRef.current?.pause()
      setRecordingStatus('מבקש הרשאה למיקרופון...')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []
      setRecordingSeconds(0)
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : ''
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      recorderRef.current = recorder
      recorder.addEventListener('dataavailable', (event) => { if (event.data.size) chunksRef.current.push(event.data) })
      recorder.addEventListener('stop', () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        const extension = recorder.mimeType.includes('mp4') ? 'm4a' : 'webm'
        setRecordingFile(new File([blob], `student-reading.${extension}`, { type: recorder.mimeType || 'audio/webm' }))
        setRecording(false)
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        if (timerRef.current !== null) window.clearInterval(timerRef.current)
        timerRef.current = null
        setRecordingStatus('ההקלטה מוכנה. אפשר להאזין ולשמור.')
      })
      recorder.start(250)
      setRecording(true)
      setRecordingStatus('מקליט. אפשר לגלול בטקסט תוך כדי.')
      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((seconds) => {
          if (seconds + 1 >= maxRecordingSeconds) recorderRef.current?.stop()
          return seconds + 1
        })
      }, 1000)
    } catch (cause) {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      setRecording(false)
      setRecordingStatus(cause instanceof Error ? cause.message : 'לא הצלחנו להתחיל את ההקלטה.')
    }
  }

  async function saveRecording() {
    if (!recordingFile) return
    setSavingRecording(true)
    setRecordingStatus('שומר את ההקלטה...')
    try {
      const formData = new FormData()
      formData.set('lessonPartId', String(lessonPartId))
      formData.set('recording', recordingFile)
      formData.set('durationSeconds', String(recordingSeconds))
      await saveStudentRecording(formData)
      if (recordingUrl?.startsWith('blob:')) URL.revokeObjectURL(recordingUrl)
      setRecordingUrl(URL.createObjectURL(recordingFile))
      setRecordingFile(null)
      setRecordingStatus('ההקלטה האישית נשמרה.')
    } catch (cause) {
      setRecordingStatus(cause instanceof Error ? cause.message : 'לא הצלחנו לשמור את ההקלטה.')
    } finally {
      setSavingRecording(false)
    }
  }

  function renderToken(token: TimedToken, index: number) {
    return <button key={`${token.index}-${token.text}`} ref={(element) => { if (element) tokenRefs.current.set(token.index, element); else tokenRefs.current.delete(token.index) }} className={`mx-0 inline rounded-lg px-0.5 transition sm:mx-0.5 sm:px-1 ${index === activeIndex ? `sync-active-${highlight}` : ''}`} onClick={() => {
      if (playerMode === 'web-audio') {
        continuousPlaybackRef.current = false
        setActiveIndex(index)
        void playWebAudioAt(token.start)
        return
      }
      const audio = audioRef.current
      if (!audio) return
      const pendingSeek = pendingSeekRef.current
      if (pendingSeek) pendingSeek.audio.removeEventListener('seeked', pendingSeek.listener)
      audio.pause()
      const playFromTarget = () => {
        pendingSeekRef.current = null
        setActiveIndex(index)
        void audio.play().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'לא הצלחנו להפעיל את ההקלטה מהמילה שנבחרה.'))
      }
      if (Math.abs(audio.currentTime - token.start) < 0.01) {
        playFromTarget()
        return
      }
      const onSeeked = () => playFromTarget()
      pendingSeekRef.current = { audio, listener: onSeeked }
      audio.addEventListener('seeked', onSeeked, { once: true })
      audio.currentTime = token.start
    }} title={`${token.start.toFixed(2)} שניות`} type="button">{displayWord(token.text)}</button>
  }

  function renderSegment(row: ReturnType<typeof groupSynchronizedLayout>[number], segment: 'right' | 'center' | 'left') {
    const padding = row.layoutPadding?.[segment]
    return <>
      {padding?.before.map((word, index) => <span aria-hidden="true" className="sync-layout-spacer" key={`before-${segment}-${index}`}>{displayWord(word)}</span>)}
      {row.segments[segment].map((token) => renderToken(token, tokenPositionByIndex.get(token.index) ?? -1))}
      {padding?.after.map((word, index) => <span aria-hidden="true" className="sync-layout-spacer" key={`after-${segment}-${index}`}>{displayWord(word)}</span>)}
    </>
  }

  function renderSemanticRows() {
    return layoutRows.map((row) => <div className="contents" key={`${row.page}-${row.row}`}>
      {row.pageBreakBefore && <div aria-label="מעבר לעמוד הבא" className="my-5 flex items-center gap-3 text-xs font-bold text-slate-400"><span className="h-px flex-1 bg-amber-200" /><span>מעבר עמוד</span><span className="h-px flex-1 bg-amber-200" /></div>}
      <div className={`${row.breakAfter === 'open' ? 'mb-8' : row.breakAfter === 'closed' ? 'mb-3' : 'mb-1'} ${usesTikkunRows ? 'w-full whitespace-nowrap' : ''} ${row.mode === 'justify' ? 'flex w-full items-baseline justify-between' : ''} ${row.mode === 'segments' ? 'grid w-full grid-cols-[1fr_auto_1fr] items-baseline' : ''}`}>
        {row.mode === 'right' ? <div className="w-full text-right" dir="rtl">{renderSegment(row, 'right')}</div> : row.mode === 'justify' ? <div className="contents" dir="rtl">{renderSegment(row, 'center')}</div> : (['right', 'center', 'left'] as const).map((segment) => <div className={`${segment === 'right' ? 'text-right' : segment === 'left' ? 'text-left' : 'text-center'} ${usesTikkunRows ? 'whitespace-nowrap' : 'min-w-0'}`} dir="rtl" key={segment}>{renderSegment(row, segment)}</div>)}
      </div>
    </div>)
  }

  return (
    <section className="mb-6 overflow-hidden rounded-[1.7rem] bg-white p-2 shadow-sm ring-1 ring-cyan-100 sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs font-bold tracking-widest text-cyan-700">קריאה מסונכרנת</p><h2 className="mt-1 text-xl font-black text-slate-900">הקלטת המלמד · {sourceRef}</h2></div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div aria-label="צורת הצגת הטקסט" className="inline-flex rounded-full bg-slate-100 p-1" role="group">
            <button aria-pressed={displayMode === 'vocalized'} className={`rounded-full px-3 py-2 font-bold ${displayMode === 'vocalized' ? 'bg-white shadow-sm' : ''}`} onClick={() => setDisplayMode('vocalized')} type="button">טקסט מנוקד</button>
            <button aria-pressed={displayMode === 'torah'} className={`rounded-full px-3 py-2 font-bold ${displayMode === 'torah' ? 'bg-white shadow-sm' : ''}`} onClick={() => setDisplayMode('torah')} type="button">ספר תורה</button>
          </div>
          <div aria-label="צבע רקע הטקסט" className="inline-flex rounded-full bg-slate-100 p-1" role="group">
            <button aria-pressed={backgroundMode === 'warm'} className={`rounded-full px-3 py-2 font-bold ${backgroundMode === 'warm' ? 'bg-white shadow-sm' : ''}`} onClick={() => setBackgroundMode('warm')} type="button">צהוב בהיר</button>
            <button aria-pressed={backgroundMode === 'white'} className={`rounded-full px-3 py-2 font-bold ${backgroundMode === 'white' ? 'bg-white shadow-sm' : ''}`} onClick={() => setBackgroundMode('white')} type="button">לבן</button>
          </div>
          <select aria-label="סגנון הדגשת מילה" className="rounded-full bg-slate-100 px-3 py-2" value={highlight} onChange={(event) => setHighlight(event.target.value as typeof highlight)}><option value="yellow">צהוב</option><option value="inverse">שחור ולבן</option><option value="red">אדום</option><option value="red-large">אדום מוגדל</option></select>
        </div>
      </div>
      <audio className={`mt-4 w-full ${playerMode === 'native' ? '' : 'hidden'}`} controls onDurationChange={(event) => setAudioDuration(event.currentTarget.duration || 0)} onLoadedMetadata={(event) => setAudioDuration(event.currentTarget.duration || 0)} onEnded={() => void handleEnded()} onPause={(event) => { if (!event.currentTarget.ended) continuousPlaybackRef.current = false }} onPlay={() => void handlePlay()} onSeeking={(event) => { if (event.currentTarget.currentTime > 1) continuousPlaybackRef.current = false }} ref={audioRef} src={audioUrl} />
      {playerMode === 'web-audio' && <div className="mt-4 rounded-2xl bg-slate-100 p-4" dir="ltr">
        <div className="flex flex-wrap items-center gap-3" dir="rtl">
          <button aria-label={webAudioPlaying ? 'השהיית הנגן' : 'הפעלת הנגן'} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white" disabled={!webAudioReady} onClick={() => webAudioPlaying ? pauseWebAudio() : void playWebAudioAt(webAudioPositionRef.current)} type="button">{webAudioPlaying ? 'השהיה' : 'הפעלה'}</button>
          <span className="font-mono text-sm tabular-nums">{formatTime(webAudioTime)} / {formatTime(audioDuration)}</span>
          <button className="mr-auto rounded-xl bg-white px-3 py-2 text-sm font-bold text-slate-700 ring-1 ring-slate-200" onClick={returnToNativePlayer} type="button">חזרה לנגן הרגיל</button>
        </div>
        <input aria-label="מיקום בהקלטה" className="mt-3 w-full accent-slate-800" disabled={!webAudioReady} max={audioDuration || 0} min="0" onBlur={finishWebAudioSeek} onChange={(event) => {
          const position = Number(event.currentTarget.value)
          webAudioPositionRef.current = position
          setWebAudioTime(position)
        }} onKeyDown={beginWebAudioSeek} onKeyUp={finishWebAudioSeek} onPointerCancel={finishWebAudioSeek} onPointerDown={beginWebAudioSeek} onPointerUp={finishWebAudioSeek} step="0.01" type="range" value={Math.min(webAudioTime, audioDuration || 0)} />
        <p className="mt-2 text-right text-xs text-slate-600" dir="rtl">{webAudioLoading ? 'טוען את ההקלטה למכשיר…' : 'אפשר ללחוץ על מילה כדי לקפוץ אליה'}</p>
      </div>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {playerMode === 'native' && <span className="text-xs text-slate-600">מנגן באמצעות נגן הדפדפן הרגיל.</span>}
        {webAudioLoading && <span aria-live="polite" className="text-xs text-slate-600">טעינת ההקלטה המלאה למכשיר עשויה לקחת מעט זמן.</span>}
      </div>
      <div className="sticky top-0 z-10 mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-white/95 py-2 backdrop-blur">
        {!recording ? <button className="rounded-xl bg-[var(--student-orange)] px-4 py-3 text-sm font-bold text-white" onClick={() => void startRecording()} type="button">הקלטת התלמיד</button> : <button className="rounded-xl bg-rose-700 px-4 py-3 text-sm font-bold text-white" onClick={() => recorderRef.current?.stop()} type="button">עצירת הקלטה · {Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, '0')}</button>}
        {recordingFile && <button className="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-50" disabled={savingRecording} onClick={() => void saveRecording()} type="button">{savingRecording ? 'שומר...' : 'שמירת הקלטה'}</button>}
        {recordingStatus && <span aria-live="polite" className="text-sm text-slate-600">{recordingStatus}</span>}
      </div>
      {usesFallbackLayout && <p className="mt-2 text-xs text-amber-800">העמדת השורות כאן היא פריסה מקורבת, לא שורות Tikkun מדויקות.</p>}
      <div ref={scrollRef} className={`mt-2 h-[55vh] min-h-[330px] max-h-[720px] touch-auto overflow-auto overscroll-contain rounded-2xl p-1.5 ring-1 sm:h-[62vh] sm:p-5 ${backgroundMode === 'white' ? 'bg-white ring-slate-200' : 'bg-[#fffdf7] ring-amber-100'} ${displayMode === 'torah' ? 'torah-stam' : 'torah-teacher-text'}`} dir="rtl" spellCheck={false}>
        <div className="mx-auto w-fit max-w-full text-[clamp(0.82rem,3vw,1.875rem)] leading-[1.9] sm:text-[clamp(1rem,3vw,1.875rem)] sm:leading-[2.15]">
          {hasSemanticLayout ? renderSemanticRows() : tokens.map(renderToken)}
        </div>
      </div>
      {recordingUrl && <div className="mt-3 rounded-xl bg-slate-50 p-3"><p className="mb-2 text-sm font-bold">ההקלטה האישית האחרונה</p><audio className="w-full" controls src={recordingUrl} /></div>}
      {error && <p aria-live="polite" className="mt-3 text-sm text-rose-700">{error}</p>}
    </section>
  )
}
