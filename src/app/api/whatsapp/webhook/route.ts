import {
  buildWhatsAppBotEmptyCatalogText,
  buildWhatsAppBotInvalidSelectionText,
  buildWhatsAppBotLeadDetailsPromptText,
  buildWhatsAppBotLeadDetailsSavedText,
  buildWhatsAppBotMenuText,
  buildWhatsAppBotSelectionText,
  buildWhatsAppBotStatsText,
  buildWhatsAppBotTeacherContactPrompt,
  buildWhatsAppBotTeacherMessageSentText,
  buildWhatsAppBotTeacherUnavailableText,
  buildWhatsAppTeacherInboxText,
  buildWhatsAppTeacherNoPendingSessionText,
  buildWhatsAppTeacherReplySentText,
  getStudentWhatsAppCatalogWithSource,
  getStudentWhatsAppCatalogByPhoneWithSource,
  getStudentWhatsAppProgressSummary,
  parseWhatsAppBotSelection,
  type StudentWhatsAppCatalog,
} from '@/lib/whatsapp-bot'
import {
  buildMarketingLeadNotificationText,
  getMarketingDemoSessionByPhone,
  insertMarketingLead,
  parseWhatsAppLeadDetailsMessage,
  updateMarketingDemoSession,
} from '@/lib/marketing-landing'
import { createStudentDirectAccessLink } from '@/lib/student-direct-links'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getDaysUntilReading } from '@/lib/student-schedule'
import { buildPracticeReminderText, sanitizePhoneNumber, sendWhatsAppTextMessage } from '@/lib/whatsapp'
import { landingPageContent } from '@/src/marketing-content/landing-page-content'

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
        statuses?: Array<{
          id?: string
          status?: string
          timestamp?: string
          recipient_id?: string
          errors?: Array<{
            code?: number
            title?: string
            message?: string
          }>
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
  role: 'primary' | 'teacher'
}

type StudentPhoneRow = {
  id: number
  name: string
  whatsapp_phone: string | null
  torah_reading_date?: string | null
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
    .select('id, display_name, whatsapp_phone, role')
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
    .select('id, display_name, whatsapp_phone, role')
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
    .select('id, name, whatsapp_phone, torah_reading_date')
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

async function getManagerActiveParashaId(admin: AdminPhoneRow, studentId: number) {
  // The generated DB types predate the assignment tables used by the manager bot.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabaseAdmin = getSupabaseAdmin() as any
  const { data: student, error: studentError } = await supabaseAdmin
    .from('students')
    .select('id, admin_id')
    .eq('id', studentId)
    .maybeSingle()
  if (studentError || !student) throw new Error(studentError?.message ?? 'התלמיד לא נמצא.')

  const { data: assignment, error: assignmentError } = await supabaseAdmin
    .from('student_teacher_parasha_assignments')
    .select('teacher_parasha_id')
    .eq('student_id', studentId)
    .eq('status', 'active')
    .maybeSingle()
  if (assignmentError) throw new Error(assignmentError.message)
  if (!assignment?.teacher_parasha_id) throw new Error('לתלמיד אין פרשה פעילה עם תתי־חלקים זמינים.')
  const { data: parasha, error: parashaError } = await supabaseAdmin
    .from('teacher_parashot')
    .select('owner_admin_id, status')
    .eq('id', assignment.teacher_parasha_id)
    .maybeSingle()
  if (parashaError) throw new Error(parashaError.message)
  if (admin.role !== 'primary') {
    const ownsActiveAssignment = parasha?.owner_admin_id === admin.id && parasha.status === 'active'
    if (!ownsActiveAssignment) {
      throw new Error('התלמיד אינו משויך למנהל הזה.')
    }
  }
  return assignment.teacher_parasha_id as number
}

type ManagerAction = 'student_recordings' | 'teacher_recordings' | 'reminders' | 'statistics'
type ManagerMenuOption = { id: number; name: string; details?: string; groupId?: number; sortPercent?: number; sortAmount?: number }
type ManagerMenuOptions = { groups: ManagerMenuOption[]; items: ManagerMenuOption[] }

const managerActionLabels: Record<ManagerAction, string> = {
  student_recordings: 'הקלטות התלמיד',
  teacher_recordings: 'הקלטות המלמד',
  reminders: 'שליחת תזכורת',
  statistics: 'סטטיסטיקות',
}

function managerActionMenu(studentName: string) {
  return [
    `${studentName} · מה תרצה לעשות?`,
    '1 · הקלטות של התלמיד',
    '2 · הקלטות של המלמד',
    '3 · שליחת תזכורת',
    '4 · סטטיסטיקות',
    '0 · בחירת תלמיד',
    '# · חזרה לרשימת התלמידים',
  ].join('\n')
}

function numberedMenu(title: string, options: ManagerMenuOption[]) {
  return [title, ...options.map((option, index) => `${index + 1} · ${option.name}${option.details ? ` — ${option.details}` : ''}`), '', '0 · בחירת תלמיד', '# · חזרה'].join('\n')
}

async function getManagerStudentPartCatalog(admin: AdminPhoneRow, studentId: number) {
  // These assignment tables are newer than the generated Supabase schema.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseAdmin() as any
  const teacherParashaId = await getManagerActiveParashaId(admin, studentId)
  const { data: groups, error: groupError } = await db
    .from('lesson_groups')
    .select('id, sections(name)')
    .eq('teacher_parasha_id', teacherParashaId)
    .order('section_id', { ascending: true })
  if (groupError) throw new Error(groupError.message)
  const groupRows = (groups ?? []) as Array<{ id: number; sections: { name: string } | Array<{ name: string }> | null }>
  const groupIds = groupRows.map((group) => group.id)
  const { data: rows, error: partError } = groupIds.length
    ? await db.from('lesson_parts').select('id, lesson_group_id, name, part_order, completion_target, duration_seconds, media_kind, video_url, video_url_nikud, video_url_tikkun').in('lesson_group_id', groupIds).order('part_order', { ascending: true })
    : { data: [], error: null }
  if (partError) throw new Error(partError.message)
  const parts = (rows ?? []) as Array<{
    id: number
    lesson_group_id: number
    name: string
    part_order: number
    completion_target: number | null
    duration_seconds: number | null
    media_kind: string | null
    video_url: string | null
    video_url_nikud: string | null
    video_url_tikkun: string | null
  }>
  const partIds = parts.map((part) => part.id)
  const [recordingResult, readingResult, listeningResult] = partIds.length
    ? await Promise.all([
      db.from('student_recordings').select('lesson_part_id').eq('student_id', studentId).in('lesson_part_id', partIds),
      db.from('student_lesson_part_readings').select('lesson_part_id').eq('student_id', studentId).in('lesson_part_id', partIds),
      db.from('student_listening_sessions').select('lesson_part_id, listened_seconds, completed, duration_seconds').eq('student_id', studentId).in('lesson_part_id', partIds),
    ])
    : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }]
  for (const result of [recordingResult, readingResult, listeningResult]) {
    if (result.error) throw new Error(result.error.message)
  }
  const studentRecordingIds = new Set((recordingResult.data ?? []).map((row: { lesson_part_id: number }) => row.lesson_part_id))
  const teacherReadingIds = new Set((readingResult.data ?? []).map((row: { lesson_part_id: number }) => row.lesson_part_id))
  const sessions = (listeningResult.data ?? []) as Array<{ lesson_part_id: number; listened_seconds: number; completed: boolean; duration_seconds: number }>
  return parts.map((part) => {
    const group = groupRows.find((item) => item.id === part.lesson_group_id)
    const section = Array.isArray(group?.sections) ? group.sections[0]?.name : group?.sections?.name
    const partSessions = sessions.filter((row) => row.lesson_part_id === part.id)
    const listenedSeconds = partSessions.reduce((sum, row) => sum + (row.listened_seconds ?? 0), 0)
    const duration = partSessions.reduce((max, row) => Math.max(max, row.duration_seconds ?? 0), part.duration_seconds ?? 0)
    const goalSeconds = duration * Math.max(part.completion_target ?? 3, 1)
    const percent = goalSeconds > 0 ? Math.min(100, Math.round((listenedSeconds / goalSeconds) * 100)) : 0
    return {
      id: part.id,
      groupId: part.lesson_group_id,
      section: section ?? 'קריאה',
      partName: part.name,
      name: `${part.name} · ${section ?? 'קריאה'}`,
      durationSeconds: part.duration_seconds,
      hasStudentRecording: studentRecordingIds.has(part.id),
      hasTeacherRecording: teacherReadingIds.has(part.id),
      hasTeacherVideo: Boolean(part.video_url || part.video_url_nikud || part.video_url_tikkun),
      listenedSeconds,
      goalSeconds,
      percent,
      completions: partSessions.filter((row) => row.completed).length,
    }
  })
}

async function sendManagerMenu(admin: AdminPhoneRow, body: string) {
  const to = sanitizePhoneNumber(admin.whatsapp_phone ?? '')
  const lines = body.split('\n')
  let chunk = ''
  for (const line of lines) {
    if (chunk && chunk.length + line.length + 1 > 3500) {
      await sendWhatsAppTextMessage({ to, body: chunk })
      chunk = ''
    }
    chunk += `${chunk ? '\n' : ''}${line}`
  }
  if (chunk) await sendWhatsAppTextMessage({ to, body: chunk })
}

async function handleIncomingAdminMessage(admin: AdminPhoneRow, bodyText: string) {
  const normalizedText = bodyText.trim()
  // The new manager-session table is introduced in the accompanying SQL migration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabaseAdmin = getSupabaseAdmin() as any
  const send = (body: string) => sendManagerMenu(admin, body)
  const saveState = async (input: {
    state: string
    studentOptions?: ManagerMenuOption[]
    partOptions?: ManagerMenuOptions
    studentId?: number | null
    partId?: number | null
    action?: ManagerAction | null
  }) => {
    const { error } = await supabaseAdmin.from('whatsapp_admin_bot_sessions').upsert({
      admin_id: admin.id,
      state: input.state,
      student_options: input.studentOptions,
      part_options: input.partOptions ?? { groups: [], items: [] },
      selected_student_id: input.studentId,
      selected_lesson_part_id: input.partId,
      selected_action: input.action,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'admin_id' })
    if (error) throw new Error(error.message)
  }
  const showStudentPicker = async () => {
    const studentIds = new Set<number>()
    if (admin.role === 'primary') {
      const { data, error } = await supabaseAdmin.from('students').select('id')
      if (error) throw new Error(error.message)
      for (const row of data ?? []) studentIds.add(row.id)
    }
    const parashaQuery = supabaseAdmin.from('teacher_parashot').select('id').eq('status', 'active')
    if (admin.role !== 'primary') parashaQuery.eq('owner_admin_id', admin.id)
    const { data: parashot, error: parashaError } = await parashaQuery
    if (parashaError) throw new Error(parashaError.message)
    const parashaIds = (parashot ?? []).map((row: { id: number }) => row.id)
    const { data: assignments, error: assignmentsError } = parashaIds.length
      ? await supabaseAdmin.from('student_teacher_parasha_assignments').select('student_id').in('teacher_parasha_id', parashaIds).eq('status', 'active')
      : { data: [], error: null }
    if (assignmentsError) throw new Error(assignmentsError.message)
    for (const row of assignments ?? []) studentIds.add(row.student_id)
    const { data: students, error: studentsError } = studentIds.size
      ? await supabaseAdmin.from('students').select('id, name').in('id', [...studentIds]).order('name', { ascending: true })
      : { data: [], error: null }
    if (studentsError) throw new Error(studentsError.message)
    const options = (students ?? []) as ManagerMenuOption[]
    await saveState({ state: 'select_student', studentOptions: options, studentId: null, partId: null, action: null })
    await send(options.length
      ? numberedMenu('ניהול תלמידים · בחר תלמיד:', options)
      : 'לא נמצאו תלמידים המשויכים למנהל הזה.')
  }

  if (normalizedText === '0' || normalizedText === 'תפריט') {
    await showStudentPicker()
    return
  }

  const { data: managerState, error: stateError } = await supabaseAdmin
    .from('whatsapp_admin_bot_sessions')
    .select('*')
    .eq('admin_id', admin.id)
    .maybeSingle()
  if (stateError) throw new Error(stateError.message)
  if (!managerState || Date.now() - new Date(managerState.updated_at).getTime() >= 30 * 60 * 1000) {
    await send('התפריט לא פעיל כרגע. שלח 0 כדי לבחור תלמיד ולהתחיל.')
    return
  }

  if (managerState.state === 'selected' && managerState.selected_student_id) {
    const legacyStudent = await getStudentById(managerState.selected_student_id)
    await saveState({ state: 'select_action', studentOptions: (managerState.student_options ?? []) as ManagerMenuOption[], studentId: legacyStudent?.id ?? null, action: null })
    await send(legacyStudent ? managerActionMenu(legacyStudent.name) : 'שלח 0 כדי לבחור תלמיד.')
    return
  }

  const studentOptions = (managerState.student_options ?? []) as ManagerMenuOption[]
  const menuOptions = (managerState.part_options ?? { groups: [], items: [] }) as ManagerMenuOptions
  const student = managerState.selected_student_id
    ? await getStudentById(managerState.selected_student_id)
    : null
  const action = managerState.selected_action as ManagerAction | null
  const selection = /^\d+$/.test(normalizedText) ? Number(normalizedText) : null

  if (normalizedText === '#') {
    if (managerState.state === 'select_student') {
      await send('אתה כבר ברשימת התלמידים. שלח 0 כדי לרענן את הרשימה.')
    } else if (managerState.state === 'select_action') {
      await saveState({ state: 'select_student', studentOptions, studentId: null, partId: null, action: null })
      await send(numberedMenu('ניהול תלמידים · בחר תלמיד:', studentOptions))
    } else if (managerState.state === 'select_section') {
      await saveState({ state: 'select_action', studentOptions, studentId: student?.id ?? null, action })
      await send(student ? managerActionMenu(student.name) : 'שלח 0 כדי לבחור תלמיד.')
    } else if (managerState.state === 'select_part' && action !== 'statistics') {
      await saveState({ state: 'select_section', studentOptions, partOptions: { groups: menuOptions.groups, items: [] }, studentId: student?.id ?? null, action })
      await send(numberedMenu(`${student?.name ?? 'תלמיד'} · בחר קריאה:`, menuOptions.groups))
    } else {
      await saveState({ state: 'select_action', studentOptions, studentId: student?.id ?? null, action: null })
      await send(student ? managerActionMenu(student.name) : 'שלח 0 כדי לבחור תלמיד.')
    }
    return
  }

  if (selection === null || selection < 1) {
    await send('שלח מספר מתוך התפריט, 0 לבחירת תלמיד או # לחזרה.')
    return
  }

  if (managerState.state === 'select_student') {
    const chosenStudent = studentOptions[selection - 1]
    if (!chosenStudent) {
      await send('הבחירה לא קיימת ברשימה. שלח 0 כדי להתחיל מחדש.')
      return
    }
    await saveState({ state: 'select_action', studentOptions, studentId: chosenStudent.id, partId: null, action: null })
    await send(managerActionMenu(chosenStudent.name))
    return
  }

  if (!student || !managerState.selected_student_id) {
    await send('בחירת התלמיד פגה. שלח 0 כדי להתחיל מחדש.')
    return
  }

  if (managerState.state === 'select_action') {
    const chosenAction = (['student_recordings', 'teacher_recordings', 'reminders', 'statistics'] as ManagerAction[])[selection - 1]
    if (!chosenAction) {
      await send(managerActionMenu(student.name))
      return
    }
    let catalog: Awaited<ReturnType<typeof getManagerStudentPartCatalog>>
    try {
      catalog = await getManagerStudentPartCatalog(admin, student.id)
    } catch (error) {
      await send(`${error instanceof Error ? error.message : 'לא הצלחנו לטעון את הקריאות.'}\nשלח # כדי לחזור או 0 לבחירת תלמיד.`)
      return
    }
    if (chosenAction === 'statistics') {
      const items = catalog
        .map((part) => ({
          id: part.id,
          groupId: part.groupId,
          name: part.name,
          details: `${part.percent}% · ${Math.floor(part.listenedSeconds / 60)} דקות · ${part.completions} השלמות`,
          sortPercent: part.percent,
          sortAmount: part.listenedSeconds,
        }))
        .sort((left, right) => (right.sortPercent ?? 0) - (left.sortPercent ?? 0) || (right.sortAmount ?? 0) - (left.sortAmount ?? 0))
      await saveState({ state: 'select_part', studentOptions, partOptions: { groups: [], items }, studentId: student.id, action: chosenAction })
      await send(items.length
        ? numberedMenu(`${student.name} · סטטיסטיקות לפי אחוז התקדמות:`, items)
        : `${student.name} · אין עדיין נתוני תתי־קריאות.\nשלח # לתפריט התלמיד או 0 לבחירת תלמיד.`)
      return
    }

    const eligibleParts = catalog.filter((part) =>
      chosenAction === 'student_recordings' ? part.hasStudentRecording
        : chosenAction === 'teacher_recordings' ? part.hasTeacherRecording || part.hasTeacherVideo
          : true
    )
    const groups = [...new Map(eligibleParts.map((part) => [part.groupId, { id: part.groupId, name: part.section }])).values()]
    if (!groups.length) {
      await saveState({ state: 'select_action', studentOptions, studentId: student.id, action: null })
      const noun = chosenAction === 'student_recordings' ? 'הקלטות תלמיד' : chosenAction === 'teacher_recordings' ? 'הקלטות מלמד' : 'תתי־קריאות'
      await send(`לא נמצאו ${noun} עבור ${student.name}.\n\n${managerActionMenu(student.name)}`)
      return
    }
    await saveState({ state: 'select_section', studentOptions, partOptions: { groups, items: [] }, studentId: student.id, action: chosenAction })
    await send(numberedMenu(`${student.name} · ${managerActionLabels[chosenAction]} · בחר קריאה:`, groups))
    return
  }

  if (managerState.state === 'select_section' && action) {
    const group = menuOptions.groups[selection - 1]
    if (!group) {
      await send(numberedMenu(`${student.name} · בחר קריאה:`, menuOptions.groups))
      return
    }
    let catalog: Awaited<ReturnType<typeof getManagerStudentPartCatalog>>
    try {
      catalog = await getManagerStudentPartCatalog(admin, student.id)
    } catch (error) {
      await send(error instanceof Error ? error.message : 'לא הצלחנו לטעון את תתי־הקריאות.')
      return
    }
    const items = catalog
      .filter((part) => part.groupId === group.id)
      .filter((part) => action === 'student_recordings' ? part.hasStudentRecording : action === 'teacher_recordings' ? part.hasTeacherRecording || part.hasTeacherVideo : true)
      .map((part) => ({ id: part.id, groupId: part.groupId, name: part.partName }))
    if (!items.length) {
      await send(`לא נמצאו תתי־קריאות תחת ${group.name}.\nשלח # כדי לבחור קריאה אחרת.`)
      return
    }
    await saveState({ state: 'select_part', studentOptions, partOptions: { groups: menuOptions.groups, items }, studentId: student.id, action })
    await send(numberedMenu(`${student.name} · ${group.name} · בחר תת־קריאה:`, items))
    return
  }

  if (managerState.state === 'select_part' && action) {
    const selectedPart = menuOptions.items[selection - 1]
    if (!selectedPart) {
      await send(numberedMenu(`${student.name} · ${managerActionLabels[action]}:`, menuOptions.items))
      return
    }
    let catalog: Awaited<ReturnType<typeof getManagerStudentPartCatalog>>
    try {
      catalog = await getManagerStudentPartCatalog(admin, student.id)
    } catch (error) {
      await send(error instanceof Error ? error.message : 'לא הצלחנו לטעון את תת־הקריאה.')
      return
    }
    const part = catalog.find((item) => item.id === selectedPart.id)
    if (!part) {
      await send('תת־הקריאה כבר אינה משויכת לתלמיד. שלח 0 כדי לרענן את התפריט.')
      return
    }
    await saveState({ state: 'select_part', studentOptions, partOptions: menuOptions, studentId: student.id, partId: part.id, action })

    if (action === 'statistics') {
      const details = `${part.name}\nעמידה ביעד האזנה: ${part.percent}% (${Math.floor(part.listenedSeconds / 60)} דקות מתוך ${Math.ceil(part.goalSeconds / 60)} דקות)\nהשלמות: ${part.completions}`
      await send(`${details}\n\n${numberedMenu(`${student.name} · סטטיסטיקות לפי אחוז התקדמות:`, menuOptions.items)}`)
      return
    }

    if (action === 'student_recordings' || action === 'teacher_recordings') {
      const available = action === 'student_recordings' ? part.hasStudentRecording : part.hasTeacherRecording || part.hasTeacherVideo
      if (!available) {
        await send('ההקלטה כבר אינה זמינה. בחר תת־קריאה אחרת.')
        return
      }
      const lessonLink = await createStudentDirectAccessLink({ studentId: student.id, lessonPartId: part.id, adminId: admin.id })
      const recordingType = action === 'student_recordings'
        ? 'הקלטת התלמיד'
        : part.hasTeacherVideo && part.hasTeacherRecording
          ? 'וידאו והקלטת המלמד'
          : part.hasTeacherVideo
            ? 'וידאו של המלמד'
            : 'הקלטת המלמד והטקסט המתוזמן'
      await send(`${part.name}\n${recordingType}: ${lessonLink}\n\n${numberedMenu(`${student.name} · ${managerActionLabels[action]} · בחר תת־קריאה:`, menuOptions.items)}`)
      return
    }

    if (!student.whatsapp_phone) {
      await send('לתלמיד אין מספר WhatsApp שמור.')
      return
    }
    const { data: template, error: templateError } = await supabaseAdmin.from('whatsapp_message_templates').select('template_text').eq('admin_id', admin.id).maybeSingle()
    if (templateError) throw new Error(templateError.message)
    const lessonLink = await createStudentDirectAccessLink({ studentId: student.id, lessonPartId: part.id, adminId: admin.id })
    const messageText = buildPracticeReminderText({
      templateText: template?.template_text ?? null,
      studentName: student.name,
      sectionName: part.section,
      partName: part.partName,
      daysUntilReading: getDaysUntilReading(student.torah_reading_date),
      lessonLink,
    })
    const sendResult = await sendWhatsAppTextMessage({ to: sanitizePhoneNumber(student.whatsapp_phone), body: messageText })
    void logOutgoingBotSelectionMessage({ studentId: student.id, adminId: admin.id, lessonPartId: part.id, recipientPhone: student.whatsapp_phone, messageType: 'practice_reminder', messageText, lessonLink, externalMessageId: sendResult.messageId, providerResponse: sendResult.responseBody })
    await send(`התזכורת נשלחה ל${student.name} עבור ${part.name}.\n\n${numberedMenu(`${student.name} · ${managerActionLabels[action]} · בחר תת־קריאה:`, menuOptions.items)}`)
    return
  }

  const pendingSession = await getLatestPendingAdminReplySession(admin.id)

  if (!pendingSession) {
    await sendWhatsAppTextMessage({
      to: sanitizePhoneNumber(admin.whatsapp_phone ?? ''),
      body: buildWhatsAppTeacherNoPendingSessionText(admin.display_name),
    })
    return
  }

  const pendingStudent = await getStudentById(pendingSession.student_id)

  if (!pendingStudent?.whatsapp_phone) {
    await deleteContactSession(pendingSession.id)
    await sendWhatsAppTextMessage({
      to: sanitizePhoneNumber(admin.whatsapp_phone ?? ''),
      body: buildWhatsAppTeacherNoPendingSessionText(admin.display_name),
    })
    return
  }

  const sendResult = await sendWhatsAppTextMessage({
    to: sanitizePhoneNumber(pendingStudent.whatsapp_phone),
    body: `המורה ${admin.display_name} כתב לך:\n${bodyText}`,
  })

  void logOutgoingBotSelectionMessage({
    studentId: pendingStudent.id,
    adminId: admin.id,
    lessonPartId: null,
    recipientPhone: pendingStudent.whatsapp_phone,
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
      studentName: pendingStudent.name,
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
    const marketingDemoSession = await getMarketingDemoSessionByPhone(rawPhone)

    if (!marketingDemoSession) {
      console.log('whatsapp webhook student not found', {
        rawPhone,
        studentLookupSource: phoneCatalog.studentSource,
        timings: checkpoints,
        totalMs: Date.now() - startedAt,
      })
      return
    }

    if (bodyText.trim() === '100') {
      await updateMarketingDemoSession(marketingDemoSession.id, {
        status: 'awaiting_details',
      })
      const demoCatalogResult = await getStudentWhatsAppCatalogWithSource(
        marketingDemoSession.demo_student_id
      )
      await sendWhatsAppTextMessage({
        to: rawPhone,
        body: buildWhatsAppBotLeadDetailsPromptText(
          demoCatalogResult.catalog.student.name
        ),
      })
      return
    }

    if (marketingDemoSession.status === 'awaiting_details') {
      const parsedLead = parseWhatsAppLeadDetailsMessage(bodyText)
      await insertMarketingLead({
        source: 'whatsapp_100',
        fullName: parsedLead?.name ?? null,
        role: parsedLead?.role ?? null,
        phone: rawPhone,
        email: parsedLead?.email ?? null,
        notes: parsedLead?.notes ?? bodyText,
        relatedDemoSessionId: marketingDemoSession.id,
      })
      await updateMarketingDemoSession(marketingDemoSession.id, {
        status: 'completed',
        lead_name: parsedLead?.name ?? null,
        lead_role: parsedLead?.role ?? null,
        lead_email: parsedLead?.email ?? null,
        lead_notes: parsedLead?.notes ?? bodyText,
      })

      const marketingNotificationPhone = sanitizePhoneNumber(
        landingPageContent.contact.notificationPhone
      )
      if (marketingNotificationPhone) {
        try {
          await sendWhatsAppTextMessage({
            to: marketingNotificationPhone,
            body: buildMarketingLeadNotificationText({
              source: 'whatsapp_100',
              fullName: parsedLead?.name ?? null,
              role: parsedLead?.role ?? null,
              phone: rawPhone,
              email: parsedLead?.email ?? null,
              notes: parsedLead?.notes ?? bodyText,
            }),
          })
        } catch (notificationError) {
          console.error(
            'Failed to send WhatsApp notification for marketing demo lead',
            notificationError
          )
        }
      }

      const demoCatalogResult = await getStudentWhatsAppCatalogWithSource(
        marketingDemoSession.demo_student_id
      )
      await sendWhatsAppTextMessage({
        to: rawPhone,
        body: buildWhatsAppBotLeadDetailsSavedText(
          demoCatalogResult.catalog.student.name
        ),
      })
      return
    }

    const demoCatalogResult = await getStudentWhatsAppCatalogWithSource(
      marketingDemoSession.demo_student_id
    )
    checkpoints.getCatalogMs = Date.now() - lookupStartedAt - checkpoints.findStudentMs

    await handleResolvedStudentCatalogMessage({
      rawPhone,
      bodyText,
      catalog: demoCatalogResult.catalog,
      studentLookupSource: 'marketing-demo',
      catalogSource: demoCatalogResult.source,
      startedAt,
      checkpoints,
    })
    return
  }

  console.log('whatsapp webhook matched student', {
    studentId: student.id,
    studentName: student.name,
    studentLookupSource: phoneCatalog.studentSource,
  })

  if (student.admin_id) {
    // Keep the student's inbound timestamp for the WhatsApp 24-hour conversation window.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: inboundLogError } = await (getSupabaseAdmin() as any)
      .from('whatsapp_messages')
      .insert({
        student_id: student.id,
        admin_id: student.admin_id,
        lesson_part_id: null,
        message_type: 'student_inbound',
        recipient_phone: sanitizePhoneNumber(rawPhone),
        message_text: '[incoming student message]',
        lesson_link: '',
        external_message_id: null,
        status: 'received',
        provider_response: { direction: 'inbound' },
      })

    if (inboundLogError) {
      console.error('Failed to record incoming student WhatsApp message', inboundLogError.message)
    }
  }

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

  await handleResolvedStudentCatalogMessage({
    rawPhone,
    bodyText,
    catalog,
    studentLookupSource: phoneCatalog.studentSource,
    catalogSource: phoneCatalog.catalogSource,
    startedAt,
    checkpoints,
  })
}

async function handleResolvedStudentCatalogMessage(input: {
  rawPhone: string
  bodyText: string
  catalog: StudentWhatsAppCatalog
  studentLookupSource: string
  catalogSource: string
  startedAt: number
  checkpoints: {
    findStudentMs: number
    getCatalogMs: number
    createLinkMs: number
    sendMessageMs: number
    logMessageMs: number
  }
}) {
  const { rawPhone, bodyText, catalog, studentLookupSource, catalogSource, startedAt, checkpoints } =
    input

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
    checkpoints.sendMessageMs = 0
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
    catalogSource,
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

  if (selection === 'leave_details') {
    await sendWhatsAppTextMessage({
      to: rawPhone,
      body: buildWhatsAppBotLeadDetailsPromptText(catalog.student.name),
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
    studentLookupSource,
    catalogSource,
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
    const statuses =
      payload.entry?.flatMap((entry) =>
        entry.changes?.flatMap((change) => change.value?.statuses ?? []) ?? []
      ) ?? []

    console.log('whatsapp webhook payload summary', {
      entryCount: payload.entry?.length ?? 0,
      messageCount:
        payload.entry?.flatMap((entry) =>
          entry.changes?.flatMap((change) => change.value?.messages ?? []) ?? []
        ).length ?? 0,
      statusCount: statuses.length,
    })

    for (const status of statuses) {
      console.log('whatsapp webhook status update', {
        messageId: status.id ?? null,
        status: status.status ?? null,
        timestamp: status.timestamp ?? null,
        recipientId: status.recipient_id ?? null,
        errorCodes: status.errors?.map((error) => error.code ?? null) ?? [],
        errorMessages:
          status.errors?.map((error) => error.message ?? error.title ?? null) ?? [],
      })
    }

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
