import {
  buildWhatsAppBotEmptyCatalogText,
  buildWhatsAppBotInvalidSelectionText,
  buildWhatsAppBotMenuText,
  buildWhatsAppBotSelectionText,
  findStudentByWhatsAppPhone,
  getStudentWhatsAppCatalog,
  parseWhatsAppBotSelection,
} from '@/lib/whatsapp-bot'
import { createStudentDirectAccessLink } from '@/lib/student-direct-links'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { sanitizePhoneNumber, sendWhatsAppTextMessage } from '@/lib/whatsapp'

type WhatsAppMessagesAdminClient = {
  from: (_table: 'whatsapp_messages') => {
    insert: (values: {
      student_id: number
      admin_id: number | null
      lesson_part_id: number
      message_type: string
      recipient_phone: string
      message_text: string
      lesson_link: string
      external_message_id: string | null
      status: string
      provider_response: unknown
    }) => Promise<{ error: { message: string } | null }>
  }
}

type IncomingWhatsAppPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          from?: string
          type?: string
          text?: { body?: string }
        }>
      }
    }>
  }>
}

function getWebhookVerifyToken() {
  const token = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN

  if (!token) {
    throw new Error('חסר משתנה סביבה נדרש: WHATSAPP_WEBHOOK_VERIFY_TOKEN')
  }

  return token
}

async function logOutgoingBotSelectionMessage(input: {
  studentId: number
  adminId: number | null
  lessonPartId: number
  recipientPhone: string
  messageText: string
  lessonLink: string
  externalMessageId: string | null
  providerResponse: unknown
}) {
  const supabaseAdmin =
    getSupabaseAdmin() as unknown as WhatsAppMessagesAdminClient
  const { error } = await supabaseAdmin.from('whatsapp_messages').insert({
    student_id: input.studentId,
    admin_id: input.adminId,
    lesson_part_id: input.lessonPartId,
    message_type: 'bot_selection_response',
    recipient_phone: sanitizePhoneNumber(input.recipientPhone),
    message_text: input.messageText,
    lesson_link: input.lessonLink,
    external_message_id: input.externalMessageId,
    status: 'sent',
    provider_response: input.providerResponse,
  })

  if (error) {
    console.error('Failed to log outgoing bot selection message', error.message)
  }
}

async function handleIncomingStudentMessage(rawPhone: string, bodyText: string) {
  const student = await findStudentByWhatsAppPhone(rawPhone)

  if (!student) {
    return
  }

  const catalog = await getStudentWhatsAppCatalog(student.id)

  if (catalog.parts.length === 0) {
    await sendWhatsAppTextMessage({
      to: rawPhone,
      body: buildWhatsAppBotEmptyCatalogText(catalog.student.name),
    })
    return
  }

  const selection = parseWhatsAppBotSelection(bodyText)

  if (selection === 'menu') {
    await sendWhatsAppTextMessage({
      to: rawPhone,
      body: buildWhatsAppBotMenuText({
        studentName: catalog.student.name,
        parts: catalog.parts,
      }),
    })
    return
  }

  if (selection === null) {
    await sendWhatsAppTextMessage({
      to: rawPhone,
      body: buildWhatsAppBotInvalidSelectionText({
        studentName: catalog.student.name,
        parts: catalog.parts,
      }),
    })
    return
  }

  const selectedPart = catalog.parts[selection - 1]

  if (!selectedPart) {
    await sendWhatsAppTextMessage({
      to: rawPhone,
      body: buildWhatsAppBotInvalidSelectionText({
        studentName: catalog.student.name,
        parts: catalog.parts,
      }),
    })
    return
  }

  const lessonLink = await createStudentDirectAccessLink({
    studentId: catalog.student.id,
    lessonPartId: selectedPart.lessonPartId,
    adminId: catalog.student.admin_id ?? null,
  })

  const responseText = buildWhatsAppBotSelectionText({
    studentName: catalog.student.name,
    part: selectedPart,
    lessonLink,
  })

  const sendResult = await sendWhatsAppTextMessage({
    to: rawPhone,
    body: responseText,
  })

  await logOutgoingBotSelectionMessage({
    studentId: catalog.student.id,
    adminId: catalog.student.admin_id ?? null,
    lessonPartId: selectedPart.lessonPartId,
    recipientPhone: rawPhone,
    messageText: responseText,
    lessonLink,
    externalMessageId: sendResult.messageId,
    providerResponse: sendResult.responseBody,
  })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const verifyToken = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (mode === 'subscribe' && verifyToken === getWebhookVerifyToken() && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
      },
    })
  }

  return new Response('Forbidden', { status: 403 })
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as IncomingWhatsAppPayload
    const messages =
      payload.entry?.flatMap((entry) =>
        entry.changes?.flatMap((change) => change.value?.messages ?? []) ?? []
      ) ?? []

    for (const message of messages) {
      const from = message.from
      const textBody = message.text?.body?.trim()

      if (!from || message.type !== 'text' || !textBody) {
        continue
      }

      await handleIncomingStudentMessage(from, textBody)
    }
  } catch (error) {
    console.error('WhatsApp webhook handling failed', error)
  }

  return Response.json({ ok: true })
}
