import 'server-only'

type WhatsAppTextSendInput = {
  to: string
  body: string
}

export type WhatsAppSendResult = {
  messageId: string | null
  responseBody: unknown
}

function getRequiredEnv(name: string) {
  const value = process.env[name]

  if (!value) {
    throw new Error(`חסר משתנה סביבה נדרש: ${name}`)
  }

  return value
}

export function sanitizePhoneNumber(phone: string) {
  return phone.replace(/[^\d]/g, '')
}

export function sanitizeInternalRedirectPath(path: string | null | undefined) {
  if (!path) {
    return null
  }

  if (!path.startsWith('/')) {
    return null
  }

  if (path.startsWith('//')) {
    return null
  }

  if (!/^\/(student|admin)(\/|$)/.test(path)) {
    return null
  }

  return path
}

export function buildStudentLoginLink(input: { lessonPartId: number }) {
  const mainSiteUrl = getRequiredEnv('MAIN_SITE_URL')
  const url = new URL(mainSiteUrl.endsWith('/') ? mainSiteUrl : `${mainSiteUrl}/`)
  url.pathname = '/'
  url.searchParams.set('next', `/student/lesson/${input.lessonPartId}`)
  return url.toString()
}

export function buildPracticeReminderText(input: {
  studentName: string
  sectionName: string
  partName: string
  daysUntilReading: number | null
  lessonLink: string
}) {
  const lines = [
    `שלום ${input.studentName},`,
    `היום כדאי לתרגל את ${input.sectionName} חלק ${input.partName}.`,
  ]

  if (input.daysUntilReading !== null) {
    lines.push(`נשארו ${input.daysUntilReading} ימים לקריאה בתורה.`)
  }

  lines.push('קישור ישיר לקטע:')
  lines.push(input.lessonLink)

  return lines.join('\n')
}

export async function sendWhatsAppTextMessage(input: WhatsAppTextSendInput) {
  const accessToken = getRequiredEnv('WHATSAPP_ACCESS_TOKEN')
  const phoneNumberId = getRequiredEnv('WHATSAPP_PHONE_NUMBER_ID')
  const version = process.env.WHATSAPP_API_VERSION ?? 'v23.0'
  const endpoint = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: sanitizePhoneNumber(input.to),
      type: 'text',
      text: {
        preview_url: true,
        body: input.body,
      },
    }),
    cache: 'no-store',
  })

  const responseBody = (await response.json().catch(() => null)) as
    | {
        error?: {
          message?: string
        }
        messages?: Array<{ id?: string }>
      }
    | null

  if (!response.ok) {
    throw new Error(
      responseBody?.error?.message ??
        `שליחת ההודעה ל-WhatsApp נכשלה עם קוד ${response.status}.`
    )
  }

  return {
    messageId: responseBody?.messages?.[0]?.id ?? null,
    responseBody,
  } satisfies WhatsAppSendResult
}
