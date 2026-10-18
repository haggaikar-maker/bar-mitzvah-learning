'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { getActiveSynchronizedTokenIndex, groupSynchronizedLayout, type SynchronizedToken } from '@/lib/synchronized-reading-layout'

type Part = { id: number; name: string; order: number }
type Section = { id: number; name: string; orderIndex: number; parts: Part[] }
type Library = { id: number; ownerAdminId: number; ownerDisplayName: string; parashaName: string; sections: Section[]; students: Array<{ id: number; name: string }> }
type Token = SynchronizedToken
type Passage = { title: string; book: string; sourceRef: string; startChapter: number; startVerse: number; endChapter: number; endVerse: number; text: string; verses: Array<{ ref: string; text: string }>; layoutTokens?: Token[] | null }
type Job = { id: string; status: string; progress_percent: number; student_id?: number; lesson_part_id?: number; audio_public_url?: string; parasha_name?: string; aliyah_number?: number; reading_title?: string; created_at?: string; assignment?: { studentId: number; studentName: string; teacherParashaId: number | null; teacherName: string; libraryName: string; parashaName: string; sectionName: string; partName: string }; result_json?: { ref?: string; text?: string; durationSeconds?: number; layoutKind?: string; pages?: number[]; tokens?: Token[] } | null; error_message?: string | null }

const manualBooks = ['בראשית', 'שמות', 'ויקרא', 'במדבר', 'דברים', 'יהושע', 'שופטים', 'שמואל_א', 'שמואל_ב', 'מלכים_א', 'מלכים_ב', 'ישעיהו', 'ירמיהו', 'יחזקאל', 'הושע', 'יואל', 'עמוס', 'עובדיה', 'יונה', 'מיכה', 'נחום', 'חבקוק', 'צפניה', 'חגי', 'זכריה', 'מלאכי', 'תהילים', 'משלי', 'איוב', 'שיר_השירים', 'רות', 'איכה', 'קהלת', 'אסתר', 'דניאל', 'עזרא', 'נחמיה', 'דברי_הימים_א', 'דברי_הימים_ב']

const supportedParashot = new Set([
  'בראשית','נח','לך לך','וירא','חיי שרה','תולדות','ויצא','וישלח','וישב','מקץ','ויגש','ויחי',
  'שמות','וארא','בא','בשלח','יתרו','משפטים','תרומה','תצוה','כי תשא','ויקהל','פקודי','ויקרא',
  'צו','שמיני','תזריע','מצורע','אחרי מות','קדושים','אמור','בהר','בחוקותי','במדבר','נשא',
  'בהעלותך','שלח לך','קרח','חקת','בלק','פנחס','מטות','מסעי','דברים','ואתחנן','עקב','ראה',
  'שופטים','כי תצא','כי תבוא','נצבים','וילך','האזינו','וזאת הברכה',
])

function RecentJobCard({ item, libraries, onOpen, onReassigned }: {
  item: Job
  libraries: Library[]
  onOpen: () => void
  onReassigned: () => Promise<void>
}) {
  const currentTarget = item.student_id && item.lesson_part_id ? `${item.student_id}:${item.lesson_part_id}` : ''
  const [target, setTarget] = useState(currentTarget)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => setTarget(currentTarget), [currentTarget])

  async function reassign() {
    const [studentId, lessonPartId] = target.split(':').map(Number)
    if (!studentId || !lessonPartId || target === currentTarget) return
    setBusy(true)
    setNotice('')
    try {
      const response = await fetch(`/api/admin/text-sync/jobs/${item.id}/reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, lessonPartId }),
      })
      const data = await response.json() as { error?: string }
      if (!response.ok) throw new Error(data.error ?? 'שינוי השיוך נכשל.')
      setNotice('ההקלטה והתזמון הועברו ליעד החדש.')
      await onReassigned()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'שינוי השיוך נכשל.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="grid gap-2 rounded-xl bg-slate-50 p-3 text-right text-xs ring-1 ring-slate-200">
    <button className="flex items-center justify-between gap-3 text-right hover:text-cyan-800" onClick={onOpen} type="button">
      <span className="grid gap-1">
        <strong>{item.reading_title ?? `${item.parasha_name} · עלייה ${item.aliyah_number ?? ''}`}</strong>
        <span className="text-slate-600">
          {item.assignment
            ? `${item.assignment.studentName} · ${item.assignment.teacherName} · ${item.assignment.parashaName} · ${item.assignment.sectionName} › ${item.assignment.partName}`
            : 'טוען פרטי שיוך…'}
        </span>
      </span>
      <strong className="shrink-0">{item.status === 'completed' ? 'מוכנה לבדיקה' : item.status === 'approved' ? 'אושרה' : item.status === 'failed' ? 'נכשלה' : `${item.progress_percent}%`}</strong>
    </button>
    {item.status === 'approved' ? <details className="border-t border-slate-200 pt-2">
      <summary className="cursor-pointer font-bold text-cyan-800">שינוי שיוך</summary>
      <p className="mt-2 leading-5 text-slate-600">הפעולה מעבירה את ההקלטה והתזמון, לא משנה את הטקסט או את קובץ השמע, ולא תדרוס הקלטה שכבר קיימת ביעד.</p>
      <select aria-label="יעד חדש להקלטה המסונכרנת" className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2" onChange={(event) => setTarget(event.target.value)} value={target}>
        {!libraries.some((library) => library.students.some((student) => student.id === item.student_id) && library.sections.some((section) => section.parts.some((part) => part.id === item.lesson_part_id))) && currentTarget ? <option disabled value={currentTarget}>{item.assignment ? `${item.assignment.studentName} · ${item.assignment.parashaName} · ${item.assignment.sectionName} › ${item.assignment.partName} (שיוך נוכחי)` : 'השיוך הנוכחי'}</option> : null}
        {libraries.flatMap((library) => library.students.map((student) => <optgroup key={`${library.id}-${student.id}`} label={`${student.name} · ${library.ownerDisplayName} · ${library.parashaName}`}>
          {library.sections.flatMap((section) => section.parts.map((part) => <option key={`${student.id}-${part.id}`} value={`${student.id}:${part.id}`}>{section.name} › {part.name}</option>))}
        </optgroup>))}
      </select>
      <button className="mt-2 rounded-lg bg-cyan-700 px-3 py-2 font-bold text-white disabled:opacity-50" disabled={busy || !target || target === currentTarget} onClick={() => void reassign()} type="button">{busy ? 'מעביר...' : 'העבר ליעד שנבחר'}</button>
      {notice && <p aria-live="polite" className={`mt-2 leading-5 ${notice.startsWith('ההקלטה') ? 'text-emerald-700' : 'text-rose-700'}`}>{notice}</p>}
    </details> : null}
  </div>
}

export default function TextSyncStudio({ libraries }: { libraries: Library[] }) {
  const availableLibraries = libraries.filter((item) => supportedParashot.has(item.parashaName))
  const [libraryId, setLibraryId] = useState(availableLibraries[0]?.id ?? 0)
  const library = availableLibraries.find((item) => item.id === libraryId) ?? availableLibraries[0]
  const [studentId, setStudentId] = useState(library?.students[0]?.id ?? 0)
  const [sectionId, setSectionId] = useState(library?.sections[0]?.id ?? 0)
  const section = library?.sections.find((item) => item.id === sectionId)
  const [partId, setPartId] = useState(section?.parts[0]?.id ?? 0)
  const [aliyah, setAliyah] = useState(Math.min(7, Math.max(1, (section?.orderIndex ?? 0) + 1)))
  const [readingKind, setReadingKind] = useState<'weekly_aliyah' | 'manual_range'>('weekly_aliyah')
  const [readingTitle, setReadingTitle] = useState('')
  const [manualBook, setManualBook] = useState('ישעיהו')
  const [startChapter, setStartChapter] = useState(40)
  const [startVerse, setStartVerse] = useState(1)
  const [endChapter, setEndChapter] = useState(40)
  const [endVerse, setEndVerse] = useState(5)
  const [passage, setPassage] = useState<Passage | null>(null)
  const [passageLoading, setPassageLoading] = useState(false)
  const [passageError, setPassageError] = useState('')
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [audioUrl, setAudioUrl] = useState('')
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [approvalFeedback, setApprovalFeedback] = useState<{ kind: 'info' | 'success' | 'error'; message: string } | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [recentJobs, setRecentJobs] = useState<Job[]>([])
  const [activeToken, setActiveToken] = useState(-1)
  const [manualTokens, setManualTokens] = useState<Token[] | null>(null)
  const [showNiqqud, setShowNiqqud] = useState(true)
  const [showCantillation, setShowCantillation] = useState(true)
  const [highlight, setHighlight] = useState<'yellow' | 'inverse' | 'red' | 'red-large'>('yellow')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const objectUrlRef = useRef('')

  useEffect(() => {
    setStudentId(library?.students[0]?.id ?? 0)
    setSectionId(library?.sections[0]?.id ?? 0)
    setPartId(library?.sections[0]?.parts[0]?.id ?? 0)
  }, [library])
  useEffect(() => {
    setPartId(section?.parts[0]?.id ?? 0)
    setAliyah(Math.min(7, Math.max(1, (section?.orderIndex ?? 0) + 1)))
  }, [section])
  useEffect(() => {
    let cancelled = false
    const query = new URLSearchParams({ mode: readingKind === 'weekly_aliyah' ? 'weekly' : 'manual' })
    if (readingKind === 'weekly_aliyah') {
      if (!library?.parashaName || !aliyah) return
      query.set('parasha', library.parashaName)
      query.set('aliyah', String(aliyah))
    } else {
      if (![startChapter, startVerse, endChapter, endVerse].every((value) => Number.isInteger(value) && value > 0)) return
      query.set('book', manualBook)
      query.set('startChapter', String(startChapter))
      query.set('startVerse', String(startVerse))
      query.set('endChapter', String(endChapter))
      query.set('endVerse', String(endVerse))
      query.set('title', readingTitle)
    }
    setPassageLoading(true)
    setPassageError('')
    void fetch(`/api/admin/text-sync/passage?${query}`, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json() as Passage & { error?: string }
        if (!response.ok) throw new Error(data.error ?? 'לא ניתן לטעון את הטקסט.')
        if (!cancelled) setPassage(data)
      })
      .catch((error: unknown) => { if (!cancelled) { setPassage(null); setPassageError(error instanceof Error ? error.message : 'טעינת הטקסט נכשלה.') } })
      .finally(() => { if (!cancelled) setPassageLoading(false) })
    return () => { cancelled = true }
  }, [readingKind, library?.parashaName, aliyah, manualBook, startChapter, startVerse, endChapter, endVerse, readingTitle])
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
  }, [])

  const pollingJobId = job?.id
  const pollingJobStatus = job?.status
  useEffect(() => {
    if (!pollingJobId || !['queued', 'processing'].includes(pollingJobStatus ?? '')) return
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/admin/text-sync/jobs?id=${encodeURIComponent(pollingJobId)}`, { cache: 'no-store' })
      const data = await response.json() as { job?: Job; error?: string }
      if (response.ok && data.job) setJob(data.job)
      else if (data.error) setNotice(data.error)
    }, 3000)
    return () => window.clearInterval(timer)
  }, [pollingJobId, pollingJobStatus])

  useEffect(() => {
    let cancelled = false
    void fetch('/api/admin/text-sync/jobs', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data: { jobs?: Job[] }) => { if (!cancelled) setRecentJobs(data.jobs ?? []) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [job?.status])

  async function refreshRecentJobs() {
    const response = await fetch('/api/admin/text-sync/jobs', { cache: 'no-store' })
    const data = await response.json() as { jobs?: Job[] }
    if (!response.ok || !data.jobs) return
    setRecentJobs(data.jobs)
    const refreshedCurrentJob = data.jobs.find((item) => item.id === job?.id)
    if (refreshedCurrentJob) setJob(refreshedCurrentJob)
  }

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    let frame = 0
    const sync = () => {
      const tokens = manualTokens ?? job?.result_json?.tokens ?? []
      const token = getActiveSynchronizedTokenIndex(tokens, audio.currentTime)
      setActiveToken((current) => current === token ? current : token)
    }
    const tick = () => { sync(); if (!audio.paused && !audio.ended) frame = requestAnimationFrame(tick) }
    const play = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(tick) }
    const stop = () => { cancelAnimationFrame(frame); sync() }
    audio.addEventListener('play', play); audio.addEventListener('pause', stop); audio.addEventListener('ended', stop); audio.addEventListener('seeked', sync)
    if (!audio.paused) play()
    return () => { cancelAnimationFrame(frame); audio.removeEventListener('play', play); audio.removeEventListener('pause', stop); audio.removeEventListener('ended', stop); audio.removeEventListener('seeked', sync) }
  }, [job?.result_json?.tokens, manualTokens])

  const timingTokens = useMemo(() => manualTokens ?? job?.result_json?.tokens ?? [], [manualTokens, job?.result_json?.tokens])
  const displayedTokens = useMemo(() => timingTokens.map((token) => ({
    ...token,
    text: token.text
      .replace(showNiqqud ? /$^/ : /[\u05B0-\u05BC\u05C7]/g, '')
      .replace(showCantillation ? /$^/ : /[\u0591-\u05AF\u05BD\u05C4\u05C5]/g, ''),
  })), [timingTokens, showCantillation, showNiqqud])

  function adjustActiveToken(boundary: 'start' | 'end', adjustment: number) {
    if (!timingTokens[activeToken]) return
    setManualTokens(timingTokens.map((token, index) => {
      if (index !== activeToken) return token
      if (boundary === 'start') {
        return { ...token, start: Math.max(0, Math.min(token.end - 0.03, Number((token.start + adjustment).toFixed(2)))) }
      }
      return { ...token, end: Math.max(token.start + 0.03, Number((token.end + adjustment).toFixed(2))) }
    }))
  }

  async function startRecording() {
    try {
      setNotice('')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : undefined
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data) }
      recorder.onstop = () => {
        const file = new File([new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })], `reading-${Date.now()}.webm`, { type: recorder.mimeType || 'audio/webm' })
        setAudioFile(file)
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = URL.createObjectURL(file)
        setAudioUrl(objectUrlRef.current)
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null
      }
      recorderRef.current = recorder
      recorder.start()
      setRecording(true)
    } catch {
      setNotice('לא הצלחנו לפתוח את המיקרופון. בדוק הרשאות דפדפן או בחר קובץ שמע.')
    }
  }

  async function submitForAlignment() {
    if (!library || !studentId || !partId || !audioFile || !passage) { setNotice('בחר ספרייה, תלמיד, טווח קריאה ותת־חלק, והמתן לטעינת הטקסט.'); return }
    setBusy(true); setNotice('מעלה את ההקלטה ל-Supabase...'); setJob(null); setManualTokens(null); setApprovalFeedback(null)
    try {
      const targetResponse = await fetch('/api/admin/text-sync/upload-target', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonPartId: partId, studentId, filename: audioFile.name }),
      })
      const target = await targetResponse.json() as { bucketName?: string; objectPath?: string; token?: string; publicUrl?: string; error?: string }
      if (!targetResponse.ok || !target.bucketName || !target.objectPath || !target.token || !target.publicUrl) throw new Error(target.error ?? 'לא נוצר יעד העלאה.')
      const { error: uploadError } = await supabase.storage.from(target.bucketName).uploadToSignedUrl(target.objectPath, target.token, audioFile, { contentType: audioFile.type || 'audio/webm' })
      if (uploadError) throw new Error(uploadError.message)
      const response = await fetch('/api/admin/text-sync/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonPartId: partId, studentId,
          aliyahNumber: readingKind === 'weekly_aliyah' ? aliyah : null,
          readingKind,
          readingTitle: readingKind === 'manual_range' ? (readingTitle.trim() || passage.title) : passage.title,
          sourceBook: passage.book,
          startChapter: passage.startChapter, startVerse: passage.startVerse,
          endChapter: passage.endChapter, endVerse: passage.endVerse,
          audioObjectPath: target.objectPath, audioPublicUrl: target.publicUrl,
        }),
      })
      const payload = await response.json() as { job?: Job; error?: string }
      if (!response.ok || !payload.job) throw new Error(payload.error ?? 'לא ניתן ליצור משימת תזמון.')
      setJob(payload.job)
      setAudioUrl(target.publicUrl)
      setNotice('ההקלטה נשמרה. משימת Whisper ממתינה לעיבוד ברקע.')
      setAudioFile(null)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'שליחת ההקלטה נכשלה.')
    } finally { setBusy(false) }
  }

  async function approve() {
    if (!job) return
    setBusy(true)
    setApprovalFeedback({ kind: 'info', message: 'שומר ומשייך את הקריאה לתלמיד...' })
    try {
      const timingEdits = manualTokens ? { tokens: manualTokens } : {}
      let response = await fetch(`/api/admin/text-sync/jobs/${job.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(timingEdits),
      })
      const readResult = async (candidate: Response) => candidate.json().catch(() => ({})) as Promise<{ error?: string }>
      let result = await readResult(response)
      if (response.status === 409) {
        const replace = window.confirm(`${result.error ?? 'כבר קיימת הקלטה לתלמיד בתת־החלק הזה.'}\nההקלטה החדשה תחליף את הקיימת עבור התלמיד ותת־החלק הזה בלבד.`)
        if (!replace) {
          setApprovalFeedback({ kind: 'info', message: 'לא בוצעה החלפה. ההקלטה הקיימת נשארה ללא שינוי.' })
          return
        }
        response = await fetch(`/api/admin/text-sync/jobs/${job.id}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...timingEdits, replaceExisting: true }),
        })
        result = await readResult(response)
      }
      if (!response.ok) throw new Error(result.error ?? 'לא ניתן לשמור את הקריאה.')
      setJob({ ...job, status: 'approved' })
      const message = 'הקריאה המסונכרנת אושרה ונשמרה לתלמיד. היא תופיע אצלו בתוך תת־החלק שנבחר.'
      setApprovalFeedback({ kind: 'success', message })
      setNotice(message)
    } catch (error) {
      setApprovalFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'האישור נכשל.' })
    }
    finally { setBusy(false) }
  }

  function openJob(item: Job, audio: string) {
    setManualTokens(null)
    setApprovalFeedback(null)
    setJob(item)
    setAudioUrl(audio)
    setNotice('נפתחה משימה מההיסטוריה.')
  }

  const estimated = displayedTokens.filter((token) => token.source === 'estimated').length
  const sourceWordCount = job?.result_json?.text?.trim().split(/\s+/).filter(Boolean).length ?? 0
  const incompleteResult = sourceWordCount > 0 && displayedTokens.length < sourceWordCount
  const reviewRows = groupSynchronizedLayout(displayedTokens)
  const passagePreviewRows = passage?.layoutTokens?.length ? groupSynchronizedLayout(passage.layoutTokens) : []
  const reviewTokenPositions = new Map(displayedTokens.map((token, index) => [token.index, index]))
  const renderReviewToken = (token: Token) => {
    const index = reviewTokenPositions.get(token.index) ?? -1
    return <button key={`${token.index}-${token.text}`} className={`relative mx-0.5 inline rounded-lg px-1 transition ${index === activeToken ? `sync-active-${highlight}` : ''}`} onClick={() => { if (audioRef.current) { audioRef.current.currentTime = token.start; void audioRef.current.play() } }} title={`${token.start.toFixed(2)}–${token.end.toFixed(2)} שניות · ${token.source === 'estimated' ? 'זמן משוער, מומלץ לבדוק' : 'זוהה'}`} type="button">{token.text}{token.source === 'estimated' && <span aria-label="זמן משוער" className="absolute -left-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-orange-500" />}</button>
  }
  const renderReviewSegment = (row: (typeof reviewRows)[number], segment: 'right' | 'center' | 'left') => {
    const padding = row.layoutPadding?.[segment]
    return <>
      {padding?.before.map((word, index) => <span aria-hidden="true" className="sync-layout-spacer" key={`before-${segment}-${index}`}>{word}</span>)}
      {row.segments[segment].map(renderReviewToken)}
      {padding?.after.map((word, index) => <span aria-hidden="true" className="sync-layout-spacer" key={`after-${segment}-${index}`}>{word}</span>)}
    </>
  }
  const renderPassageSegment = (row: (typeof passagePreviewRows)[number], segment: 'right' | 'center' | 'left') => {
    const padding = row.layoutPadding?.[segment]
    return <>
      {padding?.before.map((word, index) => <span aria-hidden="true" className="sync-layout-spacer" key={`before-${segment}-${index}`}>{word}</span>)}
      {row.segments[segment].map((token) => <span className="mx-0.5 inline px-1" key={token.index}>{token.text}</span>)}
      {padding?.after.map((word, index) => <span aria-hidden="true" className="sync-layout-spacer" key={`after-${segment}-${index}`}>{word}</span>)}
    </>
  }
  const card = 'rounded-[1.7rem] bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6'

  if (!availableLibraries.length) return <section className={card}>אין ספריית פרשה זמינה מתוך 54 פרשות השבוע הנתמכות כרגע. קריאות חג, הפטרות ופרשות משולבות אינן כלולות בשלב הראשון.</section>

  return <div className="grid gap-6 xl:grid-cols-[.85fr_1.15fr]">
    <section className={card}>
      <div className="mb-5"><p className="text-xs font-bold tracking-widest text-cyan-700">01 · בחירה</p><h2 className="mt-2 text-2xl font-black">מכינים קריאה</h2></div>
        <div className="grid gap-4">
        <label className="grid gap-2 text-sm font-bold">ספריית פרשה<select className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3" value={library?.id ?? ''} onChange={(event) => setLibraryId(Number(event.target.value))}>{availableLibraries.map((item) => <option key={item.id} value={item.id}>{item.ownerDisplayName ? `${item.ownerDisplayName} · ` : ''}{item.parashaName}</option>)}</select></label>
        <label className="grid gap-2 text-sm font-bold">תלמיד<select className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3" value={studentId || ''} onChange={(event) => setStudentId(Number(event.target.value))}>{library?.students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}</select></label>
        <fieldset className="grid gap-2 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200"><legend className="px-2 text-sm font-bold">מקור הקריאה</legend><div className="flex flex-wrap gap-3 text-sm"><label className="flex items-center gap-2"><input checked={readingKind === 'weekly_aliyah'} name="reading-kind" onChange={() => setReadingKind('weekly_aliyah')} type="radio" /> עלייה בפרשת השבוע</label><label className="flex items-center gap-2"><input checked={readingKind === 'manual_range'} name="reading-kind" onChange={() => setReadingKind('manual_range')} type="radio" /> טווח ידני, למשל הפטרה</label></div>
          {readingKind === 'weekly_aliyah' ? <label className="grid gap-2 text-sm font-bold">עלייה<select className="rounded-xl border border-slate-200 bg-white px-4 py-3" value={aliyah} onChange={(event) => setAliyah(Number(event.target.value))}>{['ראשון','שני','שלישי','רביעי','חמישי','שישי','שביעי'].map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select></label> : <>
            <label className="grid gap-2 text-sm font-bold">שם הקריאה / ההפטרה<input className="rounded-xl border border-slate-200 bg-white px-4 py-3" onChange={(event) => setReadingTitle(event.target.value)} placeholder="למשל: הפטרת נח" value={readingTitle} /></label>
            <label className="grid gap-2 text-sm font-bold">ספר<select className="rounded-xl border border-slate-200 bg-white px-4 py-3" onChange={(event) => setManualBook(event.target.value)} value={manualBook}>{manualBooks.map((book) => <option key={book} value={book}>{book.replaceAll('_', ' ')}</option>)}</select></label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{([['פרק התחלה', startChapter, setStartChapter], ['פסוק התחלה', startVerse, setStartVerse], ['פרק סיום', endChapter, setEndChapter], ['פסוק סיום', endVerse, setEndVerse]] as const).map(([label, value, setter]) => <label className="grid gap-2 text-xs font-bold" key={label}>{label}<input className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-3" min={1} onChange={(event) => setter(Number(event.target.value))} type="number" value={value} /></label>)}</div>
          </>}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-bold">אזור / חלק<select className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3" value={sectionId || ''} onChange={(event) => setSectionId(Number(event.target.value))}>{library?.sections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        </div>
        <label className="grid gap-2 text-sm font-bold">תת־חלק לשמירה<select className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3" value={partId || ''} onChange={(event) => setPartId(Number(event.target.value))}>{section?.parts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {job && <div className="rounded-2xl bg-cyan-50 p-4 ring-1 ring-cyan-100"><div className="flex justify-between gap-3 text-sm font-bold"><span>{job.status === 'queued' ? 'ממתין ל־worker' : job.status === 'processing' ? 'Whisper מעבד את ההקלטה' : job.status === 'completed' ? 'התזמון מוכן לבדיקה' : job.status === 'approved' ? 'אושר ונשמר לתלמיד' : job.status === 'failed' ? 'העיבוד נכשל' : job.status}</span><span>{job.progress_percent}%</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-cyan-100"><div className="h-full rounded-full bg-cyan-700 transition-all" style={{ width: `${job.progress_percent}%` }} /></div>{job.error_message && <p className="mt-2 text-sm text-rose-800">{job.error_message}</p>}</div>}
        {recentJobs.length > 0 && <div className="border-t border-slate-200 pt-4"><p className="mb-2 text-xs font-bold text-slate-600">משימות אחרונות · תלמיד, פרשה וחלק</p><div className="grid gap-2">{recentJobs.slice(0, 5).map((item) => <RecentJobCard item={item} key={item.id} libraries={availableLibraries} onOpen={() => openJob(item, item.audio_public_url ?? '')} onReassigned={refreshRecentJobs} />)}</div></div>}
        {notice && <p aria-live="polite" className="rounded-xl bg-slate-100 p-3 text-sm leading-6 text-slate-700">{notice}</p>}
      </div>
    </section>

    <section className={card}>
      <div className="mb-5"><p className="text-xs font-bold tracking-widest text-orange-700">02 · הקלטה, טקסט ובדיקה</p><h2 className="mt-2 text-2xl font-black">{job?.status === 'completed' || job?.status === 'approved' ? 'בודקים לפני שמירה' : 'קוראים ומקליטים'}</h2></div>
      {job?.status !== 'completed' && job?.status !== 'approved' ? <div className="grid gap-4">
        <div className="sticky top-2 z-10 rounded-2xl bg-slate-50/95 p-4 shadow-sm ring-1 ring-slate-200 backdrop-blur xl:static"><p className="text-sm font-bold">הקלטת המלמד</p><p className="mt-1 text-xs leading-5 text-slate-600">הטקסט נשאר פתוח לקריאה בזמן ההקלטה. לאחר מכן Whisper יעבד אותה ברקע.</p><div className="mt-3 flex flex-wrap gap-2">
          {!recording ? <button className="rounded-xl bg-[#101a2e] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50" disabled={busy || !passage || passageLoading || Boolean(job && ['queued', 'processing'].includes(job.status))} onClick={() => void startRecording()} type="button">התחלת הקלטה</button> : <button className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white" onClick={() => { recorderRef.current?.stop(); setRecording(false) }} type="button">עצירת הקלטה</button>}
          <label className="cursor-pointer rounded-xl bg-white px-4 py-2.5 text-sm font-bold ring-1 ring-slate-300">בחירת קובץ שמע<input accept="audio/*" className="sr-only" onChange={(event) => { const file = event.target.files?.[0] ?? null; setAudioFile(file); if (file) { if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = URL.createObjectURL(file); setAudioUrl(objectUrlRef.current) } }} type="file" /></label>
        </div></div>{audioFile && <p className="truncate text-xs text-emerald-800">נבחר: {audioFile.name} · {(audioFile.size / 1024 / 1024).toFixed(1)}MB</p>}{audioUrl && <audio className="w-full" controls ref={audioRef} src={audioUrl} />}
        <button className="rounded-xl bg-cyan-700 px-5 py-3 font-bold text-white disabled:cursor-wait disabled:opacity-50" disabled={busy || recording || !audioFile || !partId || !studentId || !passage || passageLoading} onClick={() => void submitForAlignment()} type="button">{busy ? 'מעבד...' : 'שליחת הקלטה לתזמון'}</button>
        {notice && <p aria-live="polite" className="rounded-xl bg-slate-100 p-3 text-sm leading-6 text-slate-700">{notice}</p>}
        <div aria-live="polite" className="rounded-2xl bg-white p-4 ring-1 ring-slate-200"><div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs"><strong>{passageLoading ? 'טוען טקסט מ־Sefaria…' : passage?.title ?? 'הטקסט עדיין לא נטען'}</strong>{passage && <span dir="ltr" className="text-slate-500">{passage.sourceRef}</span>}</div>{passageError ? <p className="text-sm text-rose-700">{passageError}</p> : passage ? <>
          <p className="mb-2 text-[11px] font-bold text-slate-500">{passagePreviewRows.length ? 'העימוד לפי שורות הטיקון' : 'לא נמצאה התאמת שורות לטיקון · מוצג הטקסט המלא'}</p>
          <div className="torah-teacher-text mx-auto max-h-[45vh] w-fit max-w-full touch-pan-y overflow-auto text-[clamp(1rem,3vw,1.875rem)] leading-[2.15] sm:max-h-[55vh]" dir="rtl">
            {passagePreviewRows.length ? passagePreviewRows.map((row) => <div className="contents" key={`${row.page}-${row.row}`}>
              {row.pageBreakBefore && <div aria-label="מעבר לעמוד הבא" className="my-5 flex items-center gap-3 text-xs font-bold text-slate-400"><span className="h-px flex-1 bg-amber-200" /><span>מעבר עמוד</span><span className="h-px flex-1 bg-amber-200" /></div>}
              <div className={`${row.breakAfter === 'open' ? 'mb-8' : 'mb-1'} w-full whitespace-nowrap ${row.mode === 'justify' ? 'flex items-baseline justify-between' : ''} ${row.mode === 'segments' ? 'grid grid-cols-[1fr_auto_1fr] items-baseline' : ''}`}>
                {row.mode === 'right' ? <div className="w-full text-right" dir="rtl">{renderPassageSegment(row, 'right')}</div> : row.mode === 'justify' ? <div className="contents" dir="rtl">{renderPassageSegment(row, 'center')}</div> : (['right', 'center', 'left'] as const).map((segment) => <div className={`${segment === 'right' ? 'text-right' : segment === 'left' ? 'text-left' : 'text-center'} min-w-0 whitespace-nowrap`} dir="rtl" key={segment}>{renderPassageSegment(row, segment)}</div>)}
              </div>
            </div>) : passage.verses.map((verse) => <span key={verse.ref}>{verse.text}{' '}</span>)}
          </div>
        </> : <p className="text-sm text-slate-500">בחר קריאה כדי לראות את הטקסט לפני ההקלטה.</p>}</div>
      </div> : <>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm"><strong dir="ltr">{job.result_json?.ref}</strong><span>{displayedTokens.length} מילים · {estimated} זמנים משוערים</span></div>
        <audio className="mb-4 w-full" controls ref={audioRef} src={audioUrl} />
        <div className="mb-4 flex flex-wrap gap-2 text-sm"><label className="rounded-full bg-slate-100 px-3 py-2"><input checked={showNiqqud} onChange={(event) => setShowNiqqud(event.target.checked)} type="checkbox" /> ניקוד</label><label className="rounded-full bg-slate-100 px-3 py-2"><input checked={showCantillation} onChange={(event) => setShowCantillation(event.target.checked)} type="checkbox" /> טעמים</label><select aria-label="סגנון הדגשה" className="rounded-full bg-slate-100 px-3 py-2" value={highlight} onChange={(event) => setHighlight(event.target.value as typeof highlight)}><option value="yellow">רקע צהוב</option><option value="inverse">שחור ולבן</option><option value="red">אדום רגיל</option><option value="red-large">אדום מוגדל</option></select></div>
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-cyan-50 p-3 text-sm ring-1 ring-cyan-100">
          <strong className="me-1">תיקון ידני של המילה הפעילה</strong>
          <button className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200" onClick={() => adjustActiveToken('start', -0.05)} type="button">התחלה −0.05</button>
          <button className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200" onClick={() => adjustActiveToken('start', 0.05)} type="button">התחלה +0.05</button>
          <button className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200" onClick={() => adjustActiveToken('end', -0.05)} type="button">סיום −0.05</button>
          <button className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200" onClick={() => adjustActiveToken('end', 0.05)} type="button">סיום +0.05</button>
          {timingTokens[activeToken] && <span className="font-mono text-xs" dir="ltr">{timingTokens[activeToken].start.toFixed(2)}–{timingTokens[activeToken].end.toFixed(2)}s</span>}
          {manualTokens && <span className="font-bold text-cyan-900">השינויים יישמרו באישור</span>}
        </div>
        {incompleteResult && <p role="alert" className="mb-3 rounded-xl bg-rose-50 p-3 text-sm font-bold leading-6 text-rose-800 ring-1 ring-rose-200">התוצאה הישנה חסרה מילים: במקור יש {sourceWordCount}, אך בתזמון נשמרו {displayedTokens.length}. אל תאשר אותה. צור משימה חדשה כדי לעבד מחדש את הטקסט המלא.</p>}
        <div className="torah-teacher-text max-h-[55vh] overflow-auto rounded-2xl bg-white p-4 ring-1 ring-slate-200" dir="rtl" spellCheck={false}>
          <div className="mx-auto w-fit max-w-full text-[clamp(1rem,3vw,1.875rem)] leading-[2.15]">{reviewRows.length ? reviewRows.map((row) => <div className="contents" key={`${row.page}-${row.row}`}>
            {row.pageBreakBefore && <div aria-label="מעבר לעמוד הבא" className="my-5 flex items-center gap-3 text-xs font-bold text-slate-400"><span className="h-px flex-1 bg-amber-200" /><span>מעבר עמוד</span><span className="h-px flex-1 bg-amber-200" /></div>}
            <div className={`${row.breakAfter === 'open' ? 'mb-8' : row.breakAfter === 'closed' ? 'mb-3' : 'mb-1'} w-full whitespace-nowrap ${row.mode === 'justify' ? 'flex items-baseline justify-between' : ''} ${row.mode === 'segments' ? 'grid grid-cols-[1fr_auto_1fr] items-baseline' : ''}`}>
              {row.mode === 'right' ? <div className="w-full text-right" dir="rtl">{renderReviewSegment(row, 'right')}</div> : row.mode === 'justify' ? <div className="contents" dir="rtl">{renderReviewSegment(row, 'center')}</div> : (['right', 'center', 'left'] as const).map((segment) => <div className={`min-w-0 ${segment === 'right' ? 'text-right' : segment === 'left' ? 'text-left' : 'text-center'}`} dir="rtl" key={segment}>{renderReviewSegment(row, segment)}</div>)}
            </div>
          </div>) : displayedTokens.map(renderReviewToken)}</div>
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-500"><span className="me-1 inline-block h-1.5 w-1.5 rounded-full bg-orange-500" /> נקודה כתומה מסמנת זמן משוער, שכדאי לבדוק. לחיצה על מילה מנגנת ממנה.</p>
        <div className="mt-5 flex flex-wrap gap-3"><button className="rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white disabled:opacity-50" disabled={busy || incompleteResult || job.status === 'approved'} onClick={() => void approve()} type="button">{busy ? 'שומר ומשייך...' : job.status === 'approved' ? 'הקריאה אושרה' : 'אישור ושיוך לתלמיד'}</button><button className="rounded-xl bg-white px-5 py-3 font-bold ring-1 ring-slate-300" onClick={() => { setJob(null); setManualTokens(null); setAudioFile(null); setApprovalFeedback(null); setNotice('המשימה נשארה בהיסטוריה; אפשר להתחיל הקלטה חדשה.') }} type="button">משימה חדשה</button></div>
        {approvalFeedback && <p aria-live="polite" className={`mt-3 rounded-xl p-3 text-sm font-bold leading-6 ${approvalFeedback.kind === 'success' ? 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200' : approvalFeedback.kind === 'error' ? 'bg-rose-50 text-rose-900 ring-1 ring-rose-200' : 'bg-cyan-50 text-cyan-900 ring-1 ring-cyan-200'}`} role={approvalFeedback.kind === 'error' ? 'alert' : 'status'}>{approvalFeedback.message}</p>}
      </>}
    </section>
  </div>
}
