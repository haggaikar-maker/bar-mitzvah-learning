'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

type TokenTiming = { index: number; text: string; start: number; end: number | null }
type HighlightStyle = 'yellow' | 'inverse' | 'red-large' | 'red'

const stripNiqqud = (value: string) => value.replace(/[\u05B0-\u05BC\u05C7]/g, '')
const stripCantillation = (value: string) => value.replace(/[\u0591-\u05AF\u05BD\u05C4\u05C5]/g, '')

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60).toString().padStart(2, '0')
  return `${minutes}:${remainder}`
}

export default function TextSyncPrototype({
  initialText,
  textSource,
}: {
  initialText: string
  textSource: string
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const objectUrlRef = useRef<string | null>(null)
  const [audioUrl, setAudioUrl] = useState('')
  const [recording, setRecording] = useState(false)
  const [isMarking, setIsMarking] = useState(false)
  const [showNiqqud, setShowNiqqud] = useState(true)
  const [showCantillation, setShowCantillation] = useState(true)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [duration, setDuration] = useState(0)
  const [timings, setTimings] = useState<Record<number, number>>({})
  const [highlightStyle, setHighlightStyle] = useState<HighlightStyle>('yellow')
  const [message, setMessage] = useState('')

  const tokens = useMemo(() => {
    let text = initialText
    if (!showNiqqud) text = stripNiqqud(text)
    if (!showCantillation) text = stripCantillation(text)
    return text.split(/\s+/).filter(Boolean)
  }, [initialText, showCantillation, showNiqqud])

  useEffect(() => () => {
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop())
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    let frameId = 0
    const syncHighlight = () => {
      const entries = Object.entries(timings)
        .map(([index, start]) => [Number(index), start] as const)
        .filter(([, start]) => start <= audio.currentTime)
        .sort((a, b) => a[1] - b[1])
      const nextIndex = entries.at(-1)?.[0] ?? -1
      setActiveIndex((current) => current === nextIndex ? current : nextIndex)
    }
    const tick = () => {
      syncHighlight()
      if (!audio.paused && !audio.ended) frameId = requestAnimationFrame(tick)
    }
    const startSync = () => {
      cancelAnimationFrame(frameId)
      frameId = requestAnimationFrame(tick)
    }
    const stopSync = () => {
      cancelAnimationFrame(frameId)
      syncHighlight()
    }

    audio.addEventListener('play', startSync)
    audio.addEventListener('pause', stopSync)
    audio.addEventListener('ended', stopSync)
    audio.addEventListener('timeupdate', syncHighlight)
    audio.addEventListener('seeked', syncHighlight)
    if (!audio.paused) startSync()

    return () => {
      cancelAnimationFrame(frameId)
      audio.removeEventListener('play', startSync)
      audio.removeEventListener('pause', stopSync)
      audio.removeEventListener('ended', stopSync)
      audio.removeEventListener('timeupdate', syncHighlight)
      audio.removeEventListener('seeked', syncHighlight)
    }
  }, [audioUrl, timings])

  async function startRecording() {
    setMessage('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : undefined
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
        const nextUrl = URL.createObjectURL(blob)
        objectUrlRef.current = nextUrl
        setAudioUrl(nextUrl)
        setTimings({})
        setActiveIndex(-1)
        stream.getTracks().forEach((track) => track.stop())
      }
      recorderRef.current = recorder
      recorder.start()
      setRecording(true)
    } catch {
      setMessage('לא ניתן לגשת למיקרופון. יש לאשר הרשאת הקלטה בדפדפן.')
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    setRecording(false)
    setIsMarking(false)
  }

  function markOrPlayToken(index: number) {
    const audio = audioRef.current
    if (isMarking && audio && !audio.paused) {
      setTimings((current) => ({ ...current, [index]: audio.currentTime }))
      return
    }

    const start = timings[index]
    if (audio && start !== undefined) {
      audio.currentTime = start
      void audio.play()
      return
    }

    if (audioUrl) setMessage('להגדרת זמן: הפעילו את ההקלטה, לחצו על „סימון זמנים” ואז הקישו על המילה ברגע שבו היא נשמעת.')
  }

  function downloadTimings() {
    const sorted = Object.entries(timings)
      .map(([index, start]) => ({ index: Number(index), start }))
      .sort((a, b) => a.index - b.index)
    const payload = {
      ref: 'Genesis 37:1',
      source: textSource,
      alignmentMethod: 'manual-click-prototype',
      durationSeconds: Number(duration.toFixed(3)),
      tokens: sorted.map((item, position) => ({
        index: item.index,
        text: tokens[item.index],
        start: Number(item.start.toFixed(3)),
        end: sorted[position + 1]?.start ?? Number(duration.toFixed(3)),
      } satisfies TokenTiming)),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'genesis-37-1-word-timings.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="sync-lab">
      <div className="sync-lab-shell">
        <header className="sync-lab-header">
          <div>
            <p className="sync-eyebrow">מעבדת קריאה · ניסוי מקומי</p>
            <h1>מילים חיות בזמן הקריאה</h1>
            <p className="sync-intro">טקסט, קול ותזמון נפגשים בלי לייצר סרטון.</p>
          </div>
          <div className="sync-source"><span className="sync-dot" />{textSource}</div>
        </header>

        <div className="sync-lab-grid">
          <section className="sync-reader-card" aria-label="תצוגת טקסט מסונכרן">
            <div className="sync-reader-topline">
              <span>בראשית · פרק ל״ז</span>
              <span>ניסוי תצוגה</span>
            </div>
            <div className="sync-text" dir="rtl">
              {tokens.map((token, index) => (
                <button
                  aria-label={`מילה ${index + 1}: ${token}`}
                  className={`sync-word ${activeIndex === index ? `is-active highlight-${highlightStyle}` : ''} ${timings[index] !== undefined ? 'has-time' : ''}`}
                  key={`${index}-${token}`}
                  onClick={() => markOrPlayToken(index)}
                  type="button"
                >
                  {token}
                  {timings[index] !== undefined && <small>{formatTime(timings[index])}</small>}
                </button>
              ))}
            </div>
            <div className="sync-reader-footer">
              <span>{Object.keys(timings).length} מילים סומנו</span>
              <span>לחיצה על מילה מתוזמנת מנגנת ממנה</span>
            </div>
          </section>

          <aside className="sync-controls">
            <section className="sync-control-card">
              <div className="sync-section-heading">
                <div><span className="sync-step">01</span><h2>איך להציג?</h2></div>
                <p>שינוי התצוגה לא משנה את הטקסט המקורי.</p>
              </div>
              <label className="sync-toggle">
                <span><strong>ניקוד</strong><small>קמץ, פתח, שווא ועוד</small></span>
                <input checked={showNiqqud} onChange={(event) => setShowNiqqud(event.target.checked)} type="checkbox" />
              </label>
              <label className="sync-toggle">
                <span><strong>טעמי מקרא</strong><small>סימני הנגינה וההטעמה</small></span>
                <input checked={showCantillation} onChange={(event) => setShowCantillation(event.target.checked)} type="checkbox" />
              </label>
              <div className="sync-highlight-picker">
                <p>איך להדגיש את המילה הפעילה?</p>
                <div className="sync-highlight-options" role="group" aria-label="סגנון הדגשת מילה">
                  <button aria-pressed={highlightStyle === 'yellow'} className={highlightStyle === 'yellow' ? 'is-selected' : ''} onClick={() => setHighlightStyle('yellow')} type="button"><span className="sample-yellow">מילה</span><small>רקע צהוב</small></button>
                  <button aria-pressed={highlightStyle === 'inverse'} className={highlightStyle === 'inverse' ? 'is-selected' : ''} onClick={() => setHighlightStyle('inverse')} type="button"><span className="sample-inverse">מילה</span><small>שחור ולבן</small></button>
                  <button aria-pressed={highlightStyle === 'red-large'} className={highlightStyle === 'red-large' ? 'is-selected' : ''} onClick={() => setHighlightStyle('red-large')} type="button"><span className="sample-red-large">מילה</span><small>אדום ומוגדל</small></button>
                  <button aria-pressed={highlightStyle === 'red'} className={highlightStyle === 'red' ? 'is-selected' : ''} onClick={() => setHighlightStyle('red')} type="button"><span className="sample-red">מילה</span><small>אדום רגיל</small></button>
                </div>
              </div>
            </section>

            <section className="sync-control-card">
              <div className="sync-section-heading">
                <div><span className="sync-step">02</span><h2>ההקלטה שלך</h2></div>
                <p>האודיו נשאר בדפדפן ולא מועלה לשום מקום.</p>
              </div>
              {!audioUrl && !recording && <button className="sync-primary-button" onClick={() => void startRecording()} type="button">התחלת הקלטה</button>}
              {recording && <button className="sync-stop-button" onClick={stopRecording} type="button"><span /> עצירת הקלטה</button>}
              {audioUrl && <audio className="sync-audio" controls onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)} ref={audioRef} src={audioUrl} />}
              {audioUrl && !recording && <button className="sync-text-button" onClick={() => void startRecording()} type="button">הקלטה מחדש</button>}
              {message && <p className="sync-message" role="status">{message}</p>}
            </section>

            <section className="sync-control-card sync-timing-card">
              <div className="sync-section-heading">
                <div><span className="sync-step">03</span><h2>סימון תזמונים</h2></div>
                <p>מנגנים ומקישים על כל מילה כשהיא נשמעת.</p>
              </div>
              <button
                className={`sync-mark-button ${isMarking ? 'is-on' : ''}`}
                disabled={!audioUrl || recording}
                onClick={() => setIsMarking((value) => !value)}
                type="button"
              >
                {isMarking ? 'סיום סימון' : 'סימון זמנים'}
              </button>
              <div className="sync-timing-meta">
                <span>{Object.keys(timings).length} / {tokens.length} מילים</span>
                {duration > 0 && <span>משך: {formatTime(duration)}</span>}
              </div>
              {Object.keys(timings).length > 0 && (
                <button className="sync-export-button" onClick={downloadTimings} type="button">הורדת JSON של התזמונים</button>
              )}
              <p className="sync-prototype-note">בשלב הזה סימון הזמנים ידני. המטרה היא לבדוק את חוויית הלימוד לפני חיבור זיהוי אוטומטי.</p>
            </section>
          </aside>
        </div>
        <footer className="sync-lab-footer">אב־טיפוס בלבד · אין שמירה לחשבון, לשרת או למסד הנתונים</footer>
      </div>
    </main>
  )
}
