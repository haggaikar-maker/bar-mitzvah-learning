import { NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/admin-auth'
import { torahAliyahRanges, torahMaftirRanges } from '@/src/data/torah-aliyah-ranges'
import tikkunLayoutData from '@/src/data/tikkun-torah-layout.json'

type LayoutSegment = { tokens: string[] }
type LayoutLine = { page: number; row: number; segments: LayoutSegment[]; isPetucha: boolean }
type LayoutRecord = { page: number; row: number; segment: number; token: number; text: string; normalized: string; endsVerse: boolean }
type PassageLayoutToken = {
  index: number
  text: string
  start: number
  end: number
  layoutSource: 'tikkun-rows'
  page: number
  column: number
  row: number
  segment: 'right' | 'center' | 'left'
  rowMode: 'justify' | 'right' | 'segments'
  layoutPadding?: Record<'right' | 'center' | 'left', { before: string[]; after: string[] }>
  breakAfter?: 'open'
  pageBreakBefore?: boolean
}

const tikkunBookIds: Record<string, number> = { Genesis: 1, Exodus: 2, Leviticus: 3, Numbers: 4, Deuteronomy: 5 }
const layoutLines = new Map<string, LayoutLine>()
const layoutStream: LayoutRecord[] = []
const firstTokenByLine = new Map<string, number>()
const layoutVerseLocations = tikkunLayoutData.toc as Record<string, Record<string, Record<string, { p: number; l: number }>>>

function normalizeLayoutWord(value: string) {
  return value.normalize('NFKC').replace(/\p{M}/gu, '').replace(/[^\u0590-\u05ff]/g, '')
}

function tokenizeLayoutText(value: string) {
  return value
    .replace(/#\([^)]*\)/g, ' ')
    .replace(/#\[[^\]]*\]/g, ' ')
    .replace(/[A-Za-z0-9_/\\|~`=*+<>]+/g, ' ')
    .replace(/[|,;׀]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim().replace(/["'׳״]/g, ''))
    .filter((token) => normalizeLayoutWord(token))
}

function indexTikkunRows() {
  const pages = tikkunLayoutData.pages as Array<Array<{ text: unknown[]; verses: Array<{ book: number; chapter: number; verse: number }>; isPetucha: boolean }>>
  pages.forEach((pageRows, pageIndex) => pageRows.forEach((sourceRow, rowIndex) => {
    const segments = sourceRow.text.flatMap((group) => Array.isArray(group) ? group : [group])
      .map((raw) => ({ tokens: tokenizeLayoutText(String(raw ?? '')) }))
      .filter((segment) => segment.tokens.length > 0)
    const page = pageIndex + 1
    const row = rowIndex + 1
    const line = { page, row, segments, isPetucha: sourceRow.isPetucha }
    layoutLines.set(`${page}:${row}`, line)
    segments.forEach((segment, segmentIndex) => segment.tokens.forEach((text, tokenIndex) => {
      const key = `${page}:${row}`
      if (!firstTokenByLine.has(key)) firstTokenByLine.set(key, layoutStream.length)
      layoutStream.push({ page, row, segment: segmentIndex, token: tokenIndex, text, normalized: normalizeLayoutWord(text), endsVerse: text.includes('׃') })
    }))
  }))
}

indexTikkunRows()

function findVerseStart(bookId: number, chapter: number, verse: number, verseText: string): number | null {
  const location = layoutVerseLocations[String(bookId)]?.[String(chapter)]?.[String(verse)]
  if (!location) return null
  const hint = firstTokenByLine.get(`${location.p}:${location.l}`)
  if (hint === undefined) return null
  const firstOnLine = layoutStream.findIndex((item) => item.page === location.p && item.row === location.l)
  const lastOnLine = layoutStream.findLastIndex((item) => item.page === location.p && item.row === location.l)
  if (firstOnLine < 0 || lastOnLine < firstOnLine) return null
  const firstVerseWord = tokenizeLayoutText(verseText).map(normalizeLayoutWord).find(Boolean)
  if (firstVerseWord) {
    for (let index = firstOnLine; index <= lastOnLine; index += 1) {
      if (layoutStream[index].normalized === firstVerseWord || layoutStream[index].normalized.startsWith(firstVerseWord)) return index
    }
  }
  // A TOC line can start with the previous verse's final words. Start after its marker.
  for (let index = firstOnLine; index <= lastOnLine; index += 1) {
    if (layoutStream[index].endsVerse) return index + 1
  }
  return hint
}

function buildPassageLayout(book: string, verses: Array<{ ref: string; text: string }>): PassageLayoutToken[] | null {
  const bookId = tikkunBookIds[book]
  if (!bookId || !verses.length) return null
  const parseVerse = (item: { ref: string; text: string }) => {
    const match = /^(?:.+ )?(\d+):(\d+)$/.exec(item.ref)
    return match ? { chapter: Number(match[1]), verse: Number(match[2]) } : null
  }
  const firstRef = parseVerse(verses[0])
  const lastRef = parseVerse(verses.at(-1)!)
  if (!firstRef || !lastRef) return null
  const firstToken = findVerseStart(bookId, firstRef.chapter, firstRef.verse, verses[0].text)
  const lastVerseStart = findVerseStart(bookId, lastRef.chapter, lastRef.verse, verses.at(-1)!.text)
  if (firstToken === null || lastVerseStart === null || lastVerseStart < firstToken) return null
  const endToken = layoutStream.findIndex((item, index) => index >= lastVerseStart && item.endsVerse)
  if (endToken < firstToken) return null

  const selected = layoutStream.slice(firstToken, endToken + 1)
  const rowKeys = [...new Map(selected.map((item) => [`${item.page}:${item.row}`, [item.page, item.row] as const])).values()]
  const flattened: Array<LayoutRecord & { segmentName: 'right' | 'center' | 'left'; rowMode: 'justify' | 'right' | 'segments'; padding?: PassageLayoutToken['layoutPadding']; breakAfter?: 'open'; pageBreakBefore?: boolean }> = []
  rowKeys.forEach(([page, row], rowPosition) => {
    const line = layoutLines.get(`${page}:${row}`)
    if (!line) return
    const rowRecords = selected.filter((item) => item.page === page && item.row === row)
    const lastRecord = rowPosition === rowKeys.length - 1 ? selected.at(-1) : undefined
    const finalSegmentIsPartial = Boolean(lastRecord && lastRecord.token < line.segments[lastRecord.segment].tokens.length - 1)
    const alignFinalRowRight = finalSegmentIsPartial && line.segments.length === 1
    const names = line.segments.map((_, index) => line.segments.length === 1
      ? (line.isPetucha || alignFinalRowRight ? 'right' : 'center')
      : index === 0 ? 'right' : index === line.segments.length - 1 ? 'left' : 'center') as Array<'right' | 'center' | 'left'>
    const rowMode = line.segments.length > 1 ? 'segments' : line.isPetucha || alignFinalRowRight ? 'right' : 'justify'
    const padding = { right: { before: [] as string[], after: [] as string[] }, center: { before: [] as string[], after: [] as string[] }, left: { before: [] as string[], after: [] as string[] } }
    const rowStart = flattened.length
    line.segments.forEach((segment, segmentIndex) => {
      const segmentRecords = rowRecords.filter((item) => item.segment === segmentIndex)
      const name = names[segmentIndex]
      if (segmentRecords.length) {
        const first = Math.min(...segmentRecords.map((item) => item.token))
        const last = Math.max(...segmentRecords.map((item) => item.token))
        if (!alignFinalRowRight) {
          padding[name].before = segment.tokens.slice(0, first)
          padding[name].after = segment.tokens.slice(last + 1)
        }
        segmentRecords.forEach((item) => flattened.push({ ...item, segmentName: name, rowMode }))
      } else {
        padding[name].before = segment.tokens
      }
    })
    if (flattened.length === rowStart) return
    flattened[rowStart].padding = padding
    if (line.isPetucha) flattened.at(-1)!.breakAfter = 'open'
    if (rowPosition && page !== rowKeys[rowPosition - 1][0]) flattened[rowStart].pageBreakBefore = true
  })
  if (!flattened.length) return null

  return flattened.map((item, index) => ({
      index,
      text: item.text,
      start: 0,
      end: 0,
      layoutSource: 'tikkun-rows',
      page: item.page,
      column: 0,
      row: item.row,
      segment: item.segmentName,
      rowMode: item.rowMode,
      ...(item.padding ? { layoutPadding: item.padding } : {}),
      ...(item.pageBreakBefore ? { pageBreakBefore: true } : {}),
      ...(item.breakAfter ? { breakAfter: item.breakAfter } : {}),
    }))
}

const books: Record<string, string> = {
  בראשית: 'Genesis', שמות: 'Exodus', ויקרא: 'Leviticus', במדבר: 'Numbers', דברים: 'Deuteronomy',
  יהושע: 'Joshua', שופטים: 'Judges', שמואל_א: 'I Samuel', שמואל_ב: 'II Samuel', מלכים_א: 'I Kings', מלכים_ב: 'II Kings',
  ישעיהו: 'Isaiah', ירמיהו: 'Jeremiah', יחזקאל: 'Ezekiel', הושע: 'Hosea', יואל: 'Joel', עמוס: 'Amos', עובדיה: 'Obadiah', יונה: 'Jonah',
  מיכה: 'Micah', נחום: 'Nahum', חבקוק: 'Habakkuk', צפניה: 'Zephaniah', חגי: 'Haggai', זכריה: 'Zechariah', מלאכי: 'Malachi',
  תהילים: 'Psalms', משלי: 'Proverbs', איוב: 'Job', שיר_השירים: 'Song of Songs', רות: 'Ruth', איכה: 'Lamentations', קהלת: 'Ecclesiastes',
  אסתר: 'Esther', דניאל: 'Daniel', עזרא: 'Ezra', נחמיה: 'Nehemiah', דברי_הימים_א: 'I Chronicles', דברי_הימים_ב: 'II Chronicles',
}

function parseRef(ref: string) {
  const match = /^(Genesis|Exodus|Leviticus|Numbers|Deuteronomy) (\d+):(\d+)$/.exec(ref)
  if (!match) throw new Error('טווח העלייה שנמצא אינו תקין.')
  return { book: match[1], chapter: Number(match[2]), verse: Number(match[3]) }
}

function decodeHtmlEntities(value: string) {
  const namedEntities: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
    thinsp: '\u2009', ensp: '\u2002', emsp: '\u2003', zwnj: '\u200c', zwj: '\u200d',
    shy: ' ',
  }
  let decoded = value
  for (let pass = 0; pass < 3; pass += 1) {
    const next = decoded.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (entity, name: string) => {
      if (name[0] === '#') {
        const hex = name[1]?.toLowerCase() === 'x'
        const codePoint = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10)
        return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : entity
      }
      return namedEntities[name.toLowerCase()] ?? entity
    })
    if (next === decoded) break
    decoded = next
  }
  return decoded
}

function cleanSefariaVerse(value: string) {
  const cleaned = decodeHtmlEntities(value)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\^\{[^}]*\}/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/[A-Za-z0-9_/\\|~`=*+<>]+/g, ' ')
  const filtered = Array.from(cleaned).filter((char) => {
    const codePoint = char.codePointAt(0)!
    return (codePoint >= 0x0590 && codePoint <= 0x05ff)
      || /\s/u.test(char)
      || char === '\u200c'
      || char === '\u200d'
      || ['-', "'", '"', ',', '.', ':'].includes(char)
  }).join('')
  return filtered.replace(/[\s\u00a0\u2000-\u200a]+/g, ' ').trim()
}

function extractText(value: unknown): string[] {
  if (typeof value === 'string') return [cleanSefariaVerse(value)]
  if (Array.isArray(value)) return value.flatMap(extractText)
  return []
}

async function fetchChapter(book: string, chapter: number) {
  const response = await fetch(`https://www.sefaria.org/api/texts/${encodeURIComponent(`${book}.${chapter}`)}?lang=he`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Sefaria לא החזיר את ${book} ${chapter}.`)
  const payload = await response.json() as { he?: unknown }
  const verses = extractText(payload.he)
  if (!verses.length) throw new Error(`לא נמצא טקסט עבור ${book} ${chapter}.`)
  return verses
}

export async function GET(request: Request) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: 'נדרשת התחברות מנהל.' }, { status: 401 })

  try {
    const params = new URL(request.url).searchParams
    const mode = params.get('mode')
    let book: string
    let startChapter: number
    let startVerse: number
    let endChapter: number
    let endVerse: number
    let title = params.get('title')?.trim() ?? ''

    if (mode === 'weekly') {
      const parashaName = params.get('parasha') ?? ''
      const aliyah = params.get('aliyah') ?? ''
      const range = (torahAliyahRanges as Record<string, Record<string, { start: string; end: string }>>)[parashaName]?.[aliyah]
      if (!range) return NextResponse.json({ error: 'לא נמצאה עלייה לפרשה שנבחרה.' }, { status: 400 })
      const start = parseRef(range.start)
      const end = parseRef(range.end)
      ;({ book, chapter: startChapter, verse: startVerse } = start)
      ;({ chapter: endChapter, verse: endVerse } = end)
      title ||= `${parashaName} · עלייה ${aliyah}`
    } else if (mode === 'maftir') {
      const parashaName = params.get('parasha') ?? ''
      const range = (torahMaftirRanges as Record<string, { start: string; end: string }>)[parashaName]
      if (!range) return NextResponse.json({ error: 'לא נמצא טווח מפטיר לפרשה שנבחרה.' }, { status: 400 })
      const start = parseRef(range.start)
      const end = parseRef(range.end)
      book = start.book
      startChapter = start.chapter
      startVerse = start.verse
      endChapter = end.chapter
      endVerse = end.verse
      title ||= `${parashaName} · מפטיר`
    } else if (mode === 'manual') {
      const bookKey = params.get('book') ?? ''
      book = books[bookKey] ?? ''
      startChapter = Number(params.get('startChapter'))
      startVerse = Number(params.get('startVerse'))
      endChapter = Number(params.get('endChapter'))
      endVerse = Number(params.get('endVerse'))
      if (!book || ![startChapter, startVerse, endChapter, endVerse].every((value) => Number.isInteger(value) && value > 0) || endChapter > 150 || startVerse > 200 || endVerse > 200 || endChapter < startChapter || (endChapter === startChapter && endVerse < startVerse) || endChapter - startChapter > 12) {
        return NextResponse.json({ error: 'יש לבדוק את הספר ואת טווח הפרקים והפסוקים.' }, { status: 400 })
      }
      title ||= `${params.get('book')} ${startChapter}:${startVerse}–${endChapter}:${endVerse}`
    } else {
      return NextResponse.json({ error: 'סוג הקריאה אינו תקין.' }, { status: 400 })
    }

    const chapters = await Promise.all(Array.from({ length: endChapter - startChapter + 1 }, (_, index) => fetchChapter(book, startChapter + index)))
    const verses: Array<{ ref: string; text: string }> = []
    chapters.forEach((chapter, chapterIndex) => {
      const number = startChapter + chapterIndex
      const from = number === startChapter ? startVerse : 1
      const to = number === endChapter ? endVerse : chapter.length
      if (to > chapter.length) throw new Error(`הפסוק ${to} אינו קיים בפרק ${number}.`)
      for (let verse = from; verse <= to; verse += 1) {
        const text = chapter[verse - 1]
        if (text) verses.push({ ref: `${book} ${number}:${verse}`, text })
      }
    })
    if (!verses.length) throw new Error('טווח הפסוקים לא החזיר טקסט.')
    const sourceRef = `${verses[0].ref}-${verses.at(-1)?.ref.replace(`${book} `, '')}`
    const text = verses.map((verse) => verse.text).join(' ')
    const layoutTokens = buildPassageLayout(book, verses)
    return NextResponse.json({ title, book, startChapter, startVerse, endChapter, endVerse, sourceRef, text, verses, layoutTokens })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'טעינת הטקסט נכשלה.' }, { status: 502 })
  }
}
