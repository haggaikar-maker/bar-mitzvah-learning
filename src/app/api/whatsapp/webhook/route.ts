import {
  buildWhatsAppBotEmptyCatalogText,
  buildWhatsAppBotInvalidSelectionText,
  buildWhatsAppBotMenuText,
  buildWhatsAppBotSelectionText,
  findStudentByWhatsAppPhoneWithSource,
  getStudentWhatsAppCatalogWithSource,
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
  const startedAt = Date.now()
  const checkpoints = {
    findStudentMs: 0,
    getCatalogMs: 0,
    createLinkMs: 0,
    sendMessageMs: 0,
    logMessageMs: 0,
  }

  console.log('whatsapp webhook incoming text', {
    rawPhone,
    bodyText,
  })

  const findStudentStartedAt = Date.now()
  const studentLookup = await findStudentByWhatsAppPhoneWithSource(rawPhone)
  const student = studentLookup.student
  checkpoints.findStudentMs = Date.now() - findStudentStartedAt

  if (!student) {
    console.log('whatsapp webhook student not found', {
      rawPhone,
      studentLookupSource: studentLookup.source,
      timings: checkpoints,
      totalMs: Date.now() - startedAt,
    })
    return
  }

  console.log('whatsapp webhook matched student', {
    studentId: student.id,
    studentName: student.name,
    studentLookupSource: studentLookup.source,
  })

  const catalogStartedAt = Date.now()
  const catalogResult = await getStudentWhatsAppCatalogWithSource(student.id)
  const catalog = catalogResult.catalog
  checkpoints.getCatalogMs = Date.now() - catalogStartedAt

  if (catalog.parts.length === 0) {
    console.log('whatsapp webhook empty catalog', {
      studentId: catalog.student.id,
    })
    console.log('whatsapp webhook sending empty catalog response', {
      to: rawPhone,
    })
    await sendWhatsAppTextMessage({
      to: rawPhone,
      body: buildWhatsAppBotEmptyCatalogText(catalog.student.name),
    })
    checkpoints.sendMessageMs = Date.now() - catalogStartedAt - checkpoints.getCatalogMs
    console.log('whatsapp webhook sent empty catalog response', {
      to: rawPhone,
      timings: checkpoints,
      totalMs: Date.now() - startedAt,
    })
    return
  }

  const selection = parseWhatsAppBotSelection(bodyText)

  console.log('whatsapp webhook parsed selection', {
    studentId: catalog.student.id,
    catalogSource: catalogResult.source,
    selection,
    availableParts: catalog.parts.map((part, index) => ({
      index: index + 1,
      lessonPartId: part.lessonPartId,
      sectionName: part.sectionName,
      partName: part.partName,
    })),
  })

  if (selection === 'menu') {
    console.log('whatsapp webhook sending menu response', {
      studentId: catalog.student.id,
      to: rawPhone,
    })
    await sendWhatsAppTextMessage({
      to: rawPhone,
      body: buildWhatsAppBotMenuText({
        studentName: catalog.student.name,
        parts: catalog.parts,
      }),
    })
    console.log('whatsapp webhook sent menu response', {
      studentId: catalog.student.id,
      to: rawPhone,
      timings: checkpoints,
      totalMs: Date.now() - startedAt,
    })
    return
  }

  if (selection === null) {
    console.log('whatsapp webhook sending invalid selection response', {
      studentId: catalog.student.id,
      to: rawPhone,
    })
    await sendWhatsAppTextMessage({
      to: rawPhone,
      body: buildWhatsAppBotInvalidSelectionText({
        studentName: catalog.student.name,
        parts: catalog.parts,
      }),
    })
    console.log('whatsapp webhook sent invalid selection response', {
      studentId: catalog.student.id,
      to: rawPhone,
      timings: checkpoints,
      totalMs: Date.now() - startedAt,
    })
    return
  }

  const selectedPart = catalog.parts[selection - 1]

  if (!selectedPart) {
    console.log('whatsapp webhook invalid numeric selection', {
      studentId: catalog.student.id,
      selection,
      partCount: catalog.parts.length,
    })
    console.log('whatsapp webhook sending out-of-range selection response', {
      studentId: catalog.student.id,
      to: rawPhone,
    })
    await sendWhatsAppTextMessage({
      to: rawPhone,
      body: buildWhatsAppBotInvalidSelectionText({
        studentName: catalog.student.name,
        parts: catalog.parts,
      }),
    })
    console.log('whatsapp webhook sent out-of-range selection response', {
      studentId: catalog.student.id,
      to: rawPhone,
      timings: checkpoints,
      totalMs: Date.now() - startedAt,
    })
    return
  }

  console.log('whatsapp webhook selected part', {
    studentId: catalog.student.id,
    lessonPartId: selectedPart.lessonPartId,
    sectionName: selectedPart.sectionName,
    partName: selectedPart.partName,
  })

  const createLinkStartedAt = Date.now()
  const lessonLink = await createStudentDirectAccessLink({
    studentId: catalog.student.id,
    lessonPartId: selectedPart.lessonPartId,
    adminId: catalog.student.admin_id ?? null,
  })
  checkpoints.createLinkMs = Date.now() - createLinkStartedAt

  const responseText = buildWhatsAppBotSelectionText({
    studentName: catalog.student.name,
    part: selectedPart,
    lessonLink,
  })

  console.log('whatsapp webhook sending selected part response', {
    studentId: catalog.student.id,
    lessonPartId: selectedPart.lessonPartId,
    to: rawPhone,
  })
  const sendStartedAt = Date.now()
  const sendResult = await sendWhatsAppTextMessage({
    to: rawPhone,
    body: responseText,
  })
  checkpoints.sendMessageMs = Date.now() - sendStartedAt
  console.log('whatsapp webhook sent selected part response', {
    studentId: catalog.student.id,
    lessonPartId: selectedPart.lessonPartId,
    to: rawPhone,
    messageId: sendResult.messageId,
  })

  const logStartedAt = Date.now()
  void logOutgoingBotSelectionMessage({
    studentId: catalog.student.id,
    adminId: catalog.student.admin_id ?? null,
    lessonPartId: selectedPart.lessonPartId,
    recipientPhone: rawPhone,
    messageText: responseText,
    lessonLink,
    externalMessageId: sendResult.messageId,
    providerResponse: sendResult.responseBody,
  }).catch((error) => {
    console.error('Failed to enqueue bot selection log', error)
  })
  checkpoints.logMessageMs = Date.now() - logStartedAt

  console.log('whatsapp webhook handled student message', {
    studentId: catalog.student.id,
    lessonPartId: selectedPart.lessonPartId,
    studentLookupSource: studentLookup.source,
    catalogSource: catalogResult.source,
    timings: checkpoints,
    totalMs: Date.now() - startedAt,
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
    console.log('whatsapp webhook payload summary', {
      entryCount: payload.entry?.length ?? 0,
      messageCount:
        payload.entry?.flatMap((entry) =>
          entry.changes?.flatMap((change) => change.value?.messages ?? []) ?? []
        ).length ?? 0,
    })
    const messages =
      payload.entry?.flatMap((entry) =>
        entry.changes?.flatMap((change) => change.value?.messages ?? []) ?? []
      ) ?? []

    for (const message of messages) {
      const from = message.from
      const textBody = message.text?.body?.trim()

      console.log('whatsapp webhook message envelope', {
        from,
        type: message.type,
        hasText: Boolean(textBody),
      })

      if (!from || message.type !== 'text' || !textBody) {
        console.log('whatsapp webhook skipped message', {
          from,
          type: message.type,
          hasText: Boolean(textBody),
        })
        continue
      }

      await handleIncomingStudentMessage(from, textBody)
    }
  } catch (error) {
    console.error('WhatsApp webhook handling failed', error)
  }

  return Response.json({ ok: true })
}
