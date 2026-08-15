import 'server-only'

type WhatsAppTextSendInput = {
  to: string
  body: string
}

type WhatsAppTemplateSendInput = {
  to: string
  templateName: string
  languageCode?: string | null
  bodyParameters?: string[]
}

export const DEFAULT_WHATSAPP_TEMPLATE = [
  'שלום %STUDENT%',
  'היום כדאי לתרגל את %SECTION% חלק %PART%.',
  '%COUNTDOWN%',
].join('\n')

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

export function normalizePhoneWithDefaultCountryCode(input: {
  phone: string
  defaultCountryCode?: string | null
}) {
  const digits = sanitizePhoneNumber(input.phone)

  if (!digits) {
    return ''
  }

  const countryCode = sanitizePhoneNumber(input.defaultCountryCode ?? '')

  if (!countryCode) {
    return digits
  }

  if (digits.startsWith(`00${countryCode}`)) {
    return digits.slice(2)
  }

  if (digits.startsWith(countryCode)) {
    return digits
  }

  if (digits.startsWith('0')) {
    return `${countryCode}${digits.slice(1)}`
  }

  if (digits.length <= 10) {
    return `${countryCode}${digits}`
  }

  return digits
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
  templateText?: string | null
  studentName: string
  sectionName: string
  partName: string
  daysUntilReading: number | null
  lessonLink: string
}) {
  const countdownText =
    input.daysUntilReading !== null
      ? `נשארו ${input.daysUntilReading} ימים לקריאה בתורה.`
      : ''
  const baseTemplate = input.templateText?.trim() || DEFAULT_WHATSAPP_TEMPLATE
  const messageBody = baseTemplate
    .replaceAll('%STUDENT%', input.studentName)
    .replaceAll('%SECTION%', input.sectionName)
    .replaceAll('%PART%', input.partName)
    .replaceAll('%DAYS%', input.daysUntilReading !== null ? String(input.daysUntilReading) : '')
    .replaceAll('%COUNTDOWN%', countdownText)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => {
      if (line !== '') {
        return true
      }

      return index > 0 && index < lines.length - 1 && lines[index - 1] !== '' && lines[index + 1] !== ''
    })
    .join('\n')
    .trim()

  return `${messageBody}\n\nקישור ישיר לקטע:\n${input.lessonLink}`
}

export async function sendWhatsAppTextMessage(input: WhatsAppTextSendInput) {
  const accessToken = getRequiredEnv('WHATSAPP_ACCESS_TOKEN')
  const phoneNumberId = getRequiredEnv('WHATSAPP_PHONE_NUMBER_ID')
  const version = process.env.WHATSAPP_API_VERSION ?? 'v23.0'
  const endpoint = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`
  const startedAt = Date.now()

  console.log('whatsapp send start', {
    to: sanitizePhoneNumber(input.to),
    bodyLength: input.body.length,
    endpoint,
  })

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

  const responseMs = Date.now() - startedAt

  const responseBody = (await response.json().catch(() => null)) as
    | {
        error?: {
          message?: string
        }
        messages?: Array<{ id?: string }>
      }
    | null

  if (!response.ok) {
    console.error('whatsapp send failed', {
      to: sanitizePhoneNumber(input.to),
      status: response.status,
      responseMs,
      errorMessage: responseBody?.error?.message ?? null,
    })
    throw new Error(
      responseBody?.error?.message ??
        `שליחת ההודעה ל-WhatsApp נכשלה עם קוד ${response.status}.`
    )
  }

  console.log('whatsapp send success', {
    to: sanitizePhoneNumber(input.to),
    status: response.status,
    responseMs,
    messageId: responseBody?.messages?.[0]?.id ?? null,
  })

  return {
    messageId: responseBody?.messages?.[0]?.id ?? null,
    responseBody,
  } satisfies WhatsAppSendResult
}

export async function sendWhatsAppTemplateMessage(
  input: WhatsAppTemplateSendInput
) {
  const accessToken = getRequiredEnv('WHATSAPP_ACCESS_TOKEN')
  const phoneNumberId = getRequiredEnv('WHATSAPP_PHONE_NUMBER_ID')
  const version = process.env.WHATSAPP_API_VERSION ?? 'v23.0'
  const endpoint = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`
  const startedAt = Date.now()

  const bodyParameters = (input.bodyParameters ?? [])
    .map((value) => value.trim())
    .filter(Boolean)

  console.log('whatsapp template send start', {
    to: sanitizePhoneNumber(input.to),
    templateName: input.templateName,
    bodyParameterCount: bodyParameters.length,
    endpoint,
  })

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
      type: 'template',
      template: {
        name: input.templateName,
        language: {
          code: input.languageCode?.trim() || 'he',
        },
        ...(bodyParameters.length > 0
          ? {
              components: [
                {
                  type: 'body',
                  parameters: bodyParameters.map((value) => ({
                    type: 'text',
                    text: value,
                  })),
                },
              ],
            }
          : {}),
      },
    }),
    cache: 'no-store',
  })

  const responseMs = Date.now() - startedAt

  const responseBody = (await response.json().catch(() => null)) as
    | {
        error?: {
          message?: string
        }
        messages?: Array<{ id?: string }>
      }
    | null

  if (!response.ok) {
    console.error('whatsapp template send failed', {
      to: sanitizePhoneNumber(input.to),
      templateName: input.templateName,
      status: response.status,
      responseMs,
      errorMessage: responseBody?.error?.message ?? null,
    })
    throw new Error(
      responseBody?.error?.message ??
        `שליחת תבנית ה-WhatsApp נכשלה עם קוד ${response.status}.`
    )
  }

  console.log('whatsapp template send success', {
    to: sanitizePhoneNumber(input.to),
    templateName: input.templateName,
    status: response.status,
    responseMs,
    messageId: responseBody?.messages?.[0]?.id ?? null,
  })

  return {
    messageId: responseBody?.messages?.[0]?.id ?? null,
    responseBody,
  } satisfies WhatsAppSendResult
}
