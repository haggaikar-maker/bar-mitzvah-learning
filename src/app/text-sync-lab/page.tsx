import TextSyncPrototype from './prototype'
import './text-sync-lab.css'

const fallbackText =
  'וַיֵּשֶׁב יַעֲקֹב בְּאֶרֶץ מְגוּרֵי אָבִיו בְּאֶרֶץ כְּנָעַן. אֵלֶּה תֹּלְדוֹת יַעֲקֹב יוֹסֵף בֶּן שְׁבַע עֶשְׂרֵה שָׁנָה הָיָה רֹעֶה אֶת אֶחָיו בַּצֹּאן.'

type SefariaVersion = { text?: string | string[] }

function asPlainText(value: unknown): string {
  if (Array.isArray(value)) return value.map(asPlainText).filter(Boolean).join(' ')
  if (typeof value !== 'string') return ''

  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

async function getSampleText() {
  try {
    const response = await fetch(
      'https://www.sefaria.org/api/v3/texts/Genesis%2037.1?version=hebrew&return_format=text_only',
      { cache: 'no-store', signal: AbortSignal.timeout(3500) },
    )

    if (!response.ok) return { text: fallbackText, source: 'טקסט מקומי לדוגמה' }

    const data = (await response.json()) as { versions?: SefariaVersion[] }
    const text = asPlainText(data.versions?.[0]?.text)

    return text
      ? { text, source: 'Sefaria · בראשית ל״ז, א׳' }
      : { text: fallbackText, source: 'טקסט מקומי לדוגמה' }
  } catch {
    return { text: fallbackText, source: 'טקסט מקומי לדוגמה' }
  }
}

export default async function TextSyncLabPage() {
  const sample = await getSampleText()

  return <TextSyncPrototype initialText={sample.text} textSource={sample.source} />
}
