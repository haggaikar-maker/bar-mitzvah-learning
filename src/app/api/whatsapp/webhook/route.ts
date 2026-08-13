import {
  buildWhatsAppBotEmptyCatalogText,
  buildWhatsAppBotInvalidSelectionText,
  buildWhatsAppBotMenuText,
  buildWhatsAppBotSelectionText,
  buildWhatsAppBotStatsText,
  buildWhatsAppBotTeacherContactPrompt,
  buildWhatsAppBotTeacherMessageSentText,
  buildWhatsAppBotTeacherUnavailableText,
  buildWhatsAppTeacherInboxText,
  buildWhatsAppTeacherNoPendingSessionText,
  buildWhatsAppTeacherReplySentText,
  getStudentWhatsAppCatalogByPhoneWithSource,
  getStudentWhatsAppProgressSummary,
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
      lesson_part_id: number | null
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

type ContactSessionSelectChain = {
  eq: (_column: string, _value: unknown) => ContactSessionSelectChain
  order: (
    _column: string,
    _options: { ascending: boolean }
  ) => ContactSessionSelectChain
  limit: (_count: number) => ContactSessionSelectChain
  maybeSingle: () => Promise<{
    data: ContactSessionRow | null
    error: { message: string } | null
  }>
}

type WhatsAppContactSessionsTableClient = {
  select: (_columns: string) => ContactSessionSelectChain
  update: (values: {
    status: ContactSessionRow['status']
    initiated_by: ContactSessionRow['initiated_by']
    last_student_message: string | null
    last_admin_message: string | null
    updated_at: string
  }) => {
    eq: (_column: string, _value: unknown) => Promise<{ error: { message: string } | null }>
  }
  insert: (values: {
    student_id: number
    admin_id: number
    status: ContactSessionRow['status']
    initiated_by: ContactSessionRow['initiated_by']
    last_student_message: string | null
    last_admin_message: string | null
    updated_at: string
  }) => {
    select: (_columns: string) => {
      single: () => Promise<{
        data: { id: number }
        error: { message: string } | null
      }>
    }
  }
  delete: () => {
    eq: (_column: string, _value: unknown) => Promise<{ error: { message: string } | null }>
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
  lessonPartId: number | null
  recipientPhone: string
  messageType: string
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
    message_type: input.messageType,
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

type AdminPhoneRow = {
  id: number
  display_name: string
  whatsapp_phone: string | null
}

type StudentPhoneRow = {
  id: number
  name: string
  whatsapp_phone: string | null
}

type ContactSessionRow = {
  id: number
  student_id: number
  admin_id: number
  status: 'awaiting_student_message' | 'awaiting_admin_reply'
  initiated_by: 'student' | 'admin'
  last_student_message: string | null
  last_admin_message: string | null
  updated_at: string
}

async function findAdminByWhatsAppPhone(rawPhone: string) {
  const normalizedPhone = sanitizePhoneNumber(rawPhone)

  if (!normalizedPhone) {
    return null
  }

  const supabaseAdmin = getSupabaseAdmin()
  const { data, error } = await supabaseAdmin
    .from('admins')
    .select('id, display_name, whatsapp_phone')
    .not('whatsapp_phone', 'is', null)

  if (error) {
    throw new Error(error.message)
  }

  return (
    ((data ?? []) as AdminPhoneRow[]).find(
      (admin) => sanitizePhoneNumber(admin.whatsapp_phone ?? '') === normalizedPhone
    ) ?? null
  )
}

async function getTeacherById(adminId: number) {
  const supabaseAdmin = getSupabaseAdmin()
  const { data, error } = await supabaseAdmin
    .from('admins')
    .select('id, display_name, whatsapp_phone')
    .eq('id', adminId)
    .maybeSingle()

  if (error || !data) {
    return null
  }

  return data as AdminPhoneRow
}

async function getStudentById(studentId: number) {
  const supabaseAdmin = getSupabaseAdmin()
  const { data, error } = await supabaseAdmin
    .from('students')
    .select('id, name, whatsapp_phone')
    .eq('id', studentId)
    .maybeSingle()

  if (error || !data) {
    return null
  }

  return data as StudentPhoneRow
}

async function getContactSession(input: {
  studentId: number
  adminId: number
  status?: ContactSessionRow['status']
}) {
  const supabaseAdmin = getSupabaseAdmin()
  const contactSessionsTable = supabaseAdmin.from(
    'whatsapp_contact_sessions'
  ) as unknown as WhatsAppContactSessionsTableClient
  let query = contactSessionsTable
    .select('*')
    .eq('student_id', input.studentId)
    .eq('admin_id', input.adminId)

  if (input.status) {
    query = query.eq('status', input.status)
  }

  const { data, error } = await query.maybeSingle()
  if (error) {
    throw new Error(error.message)
  }

  return (data as ContactSessionRow | null) ?? null
}

async function saveContactSession(input: {
  studentId: number
  adminId: number
  status: ContactSessionRow['status']
  initiatedBy: ContactSessionRow['initiated_by']
  lastStudentMessage?: string | null
  lastAdminMessage?: string | null
}) {
  const supabaseAdmin = getSupabaseAdmin()
  const contactSessionsTable = supabaseAdmin.from(
    'whatsapp_contact_sessions'
  ) as unknown as WhatsAppContactSessionsTableClient
  const existing = await getContactSession({
    studentId: input.studentId,
    adminId: input.adminId,
  })

  if (existing) {
    const { error } = await contactSessionsTable
      .update({
        status: input.status,
        initiated_by: input.initiatedBy,
        last_student_message: input.lastStudentMessage ?? existing.last_student_message,
        last_admin_message: input.lastAdminMessage ?? existing.last_admin_message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)

    if (error) {
      throw new Error(error.message)
    }

    return existing.id
  }

  const { data, error } = await contactSessionsTable
    .insert({
      student_id: input.studentId,
      admin_id: input.adminId,
      status: input.status,
      initiated_by: input.initiatedBy,
      last_student_message: input.lastStudentMessage ?? null,
      last_admin_message: input.lastAdminMessage ?? null,
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data.id as number
}

async function deleteContactSession(sessionId: number) {
  const supabaseAdmin = getSupabaseAdmin()
  const contactSessionsTable = supabaseAdmin.from(
    'whatsapp_contact_sessions'
  ) as unknown as WhatsAppContactSessionsTableClient
  const { error } = await contactSessionsTable
    .delete()
    .eq('id', sessionId)

  if (error) {
    throw new Error(error.message)
  }
}

async function getLatestPendingAdminReplySession(adminId: number) {
  const supabaseAdmin = getSupabaseAdmin()
  const contactSessionsTable = supabaseAdmin.from(
    'whatsapp_contact_sessions'
  ) as unknown as WhatsAppContactSessionsTableClient
  const { data, error } = await contactSessionsTable
    .select('*')
    .eq('admin_id', adminId)
    .eq('status', 'awaiting_admin_reply')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return (data as ContactSessionRow | null) ?? null
}

async function getLatestAwaitingStudentMessageSession(studentId: number) {
  const supabaseAdmin = getSupabaseAdmin()
  const contactSessionsTable = supabaseAdmin.from(
    'whatsapp_contact_sessions'
  ) as unknown as WhatsAppContactSessionsTableClient
  const { data, error } = await contactSessionsTable
    .select('*')
    .eq('student_id', studentId)
    .eq('status', 'awaiting_student_message')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return (data as ContactSessionRow | null) ?? null
}

async function handleIncomingAdminMessage(admin: AdminPhoneRow, bodyText: string) {
  const pendingSession = await getLatestPendingAdminReplySession(admin.id)

  if (!pendingSession) {
    await sendWhatsAppTextMessage({
      to: sanitizePhoneNumber(admin.whatsapp_phone ?? ''),
      body: buildWhatsAppTeacherNoPendingSessionText(admin.display_name),
    })
    return
  }

  const student = await getStudentById(pendingSession.student_id)

  if (!student?.whatsapp_phone) {
    await deleteContactSession(pendingSession.id)
    await sendWhatsAppTextMessage({
      to: sanitizePhoneNumber(admin.whatsapp_phone ?? ''),
      body: buildWhatsAppTeacherNoPendingSessionText(admin.display_name),
    })
    return
  }

  const sendResult = await sendWhatsAppTextMessage({
    to: sanitizePhoneNumber(student.whatsapp_phone),
    body: `המורה ${admin.display_name} כתב לך:\n${bodyText}`,
  })

  void logOutgoingBotSelectionMessage({
    studentId: student.id,
    adminId: admin.id,
    lessonPartId: null,
    recipientPhone: student.whatsapp_phone,
    messageType: 'teacher_reply',
    messageText: bodyText,
    lessonLink: '',
    externalMessageId: sendResult.messageId,
    providerResponse: sendResult.responseBody,
  }).catch((error) => {
    console.error('Failed to log teacher reply', error)
  })

  await deleteContactSession(pendingSession.id)

  await sendWhatsAppTextMessage({
    to: sanitizePhoneNumber(admin.whatsapp_phone ?? ''),
    body: buildWhatsAppTeacherReplySentText({
      teacherName: admin.display_name,
      studentName: student.name,
    }),
  })
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

  const lookupStartedAt = Date.now()
  const phoneCatalog = await getStudentWhatsAppCatalogByPhoneWithSource(rawPhone)
  const student = phoneCatalog.student
  const lookupElapsedMs = Date.now() - lookupStartedAt
  checkpoints.findStudentMs = lookupElapsedMs
  checkpoints.getCatalogMs = phoneCatalog.catalog ? 0 : lookupElapsedMs

  if (!student) {
    console.log('whatsapp webhook student not found', {
      rawPhone,
      studentLookupSource: phoneCatalog.studentSource,
      timings: checkpoints,
      totalMs: Date.now() - startedAt,
    })
    return
  }

  console.log('whatsapp webhook matched student', {
    studentId: student.id,
    studentName: student.name,
    studentLookupSource: phoneCatalog.studentSource,
  })

  const catalog = phoneCatalog.catalog

  if (!catalog) {
    console.log('whatsapp webhook catalog missing after lookup', {
      studentId: student.id,
      studentLookupSource: phoneCatalog.studentSource,
      catalogSource: phoneCatalog.catalogSource,
      timings: checkpoints,
      totalMs: Date.now() - startedAt,
    })
    return
  }

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
    checkpoints.sendMessageMs = Date.now() - lookupStartedAt - checkpoints.findStudentMs
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
    catalogSource: phoneCatalog.catalogSource,
    selection,
    availableParts: catalog.parts.map((part, index) => ({
      index: index + 1,
      lessonPartId: part.lessonPartId,
      sectionName: part.sectionName,
      partName: part.partName,
    })),
  })

  if (selection === 'stats') {
    const summary = await getStudentWhatsAppProgressSummary(catalog.student.id)

    await sendWhatsAppTextMessage({
      to: rawPhone,
      body: buildWhatsAppBotStatsText({
        studentName: summary.student.name,
        parts: summary.parts,
      }),
    })
    console.log('whatsapp webhook sent stats response', {
      studentId: catalog.student.id,
      to: rawPhone,
      timings: checkpoints,
      totalMs: Date.now() - startedAt,
    })
    return
  }

  if (selection === 'contact_teacher') {
    const summary = await getStudentWhatsAppProgressSummary(catalog.student.id)
    const teacherAdminId = summary.teacherAdminId ?? catalog.student.admin_id

    if (!teacherAdminId) {
      await sendWhatsAppTextMessage({
        to: rawPhone,
        body: buildWhatsAppBotTeacherUnavailableText(catalog.student.name),
      })
      return
    }

    const teacher = await getTeacherById(teacherAdminId)
    if (!teacher?.whatsapp_phone) {
      await sendWhatsAppTextMessage({
        to: rawPhone,
        body: buildWhatsAppBotTeacherUnavailableText(catalog.student.name),
      })
      return
    }

    await saveContactSession({
      studentId: catalog.student.id,
      adminId: teacher.id,
      status: 'awaiting_student_message',
      initiatedBy: 'student',
    })

    await sendWhatsAppTextMessage({
      to: rawPhone,
      body: buildWhatsAppBotTeacherContactPrompt({
        studentName: catalog.student.name,
        teacherName: teacher.display_name,
      }),
    })
    return
  }

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

  const awaitingTeacherMessageSession = await getLatestAwaitingStudentMessageSession(
    catalog.student.id
  )

  if (awaitingTeacherMessageSession) {
    const teacher = await getTeacherById(awaitingTeacherMessageSession.admin_id)

    if (!teacher?.whatsapp_phone) {
      await sendWhatsAppTextMessage({
        to: rawPhone,
        body: buildWhatsAppBotTeacherUnavailableText(catalog.student.name),
      })
      return
    }

    const sendResult = await sendWhatsAppTextMessage({
      to: sanitizePhoneNumber(teacher.whatsapp_phone),
      body: buildWhatsAppTeacherInboxText({
        teacherName: teacher.display_name,
        studentName: catalog.student.name,
        bodyText,
      }),
    })

    await saveContactSession({
      studentId: catalog.student.id,
      adminId: teacher.id,
      status: 'awaiting_admin_reply',
      initiatedBy: 'student',
      lastStudentMessage: bodyText,
    })

    void logOutgoingBotSelectionMessage({
      studentId: catalog.student.id,
      adminId: teacher.id,
      lessonPartId: null,
      recipientPhone: teacher.whatsapp_phone,
      messageType: 'student_to_teacher',
      messageText: bodyText,
      lessonLink: '',
      externalMessageId: sendResult.messageId,
      providerResponse: sendResult.responseBody,
    }).catch((error) => {
      console.error('Failed to log student-to-teacher message', error)
    })

    await sendWhatsAppTextMessage({
      to: rawPhone,
      body: buildWhatsAppBotTeacherMessageSentText({
        studentName: catalog.student.name,
        teacherName: teacher.display_name,
      }),
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
    messageType: 'bot_selection_response',
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
    studentLookupSource: phoneCatalog.studentSource,
    catalogSource: phoneCatalog.catalogSource,
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

      const admin = await findAdminByWhatsAppPhone(from)

      if (admin) {
        await handleIncomingAdminMessage(admin, textBody)
        continue
      }

      await handleIncomingStudentMessage(from, textBody)
    }
  } catch (error) {
    console.error('WhatsApp webhook handling failed', error)
  }

  return Response.json({ ok: true })
}
