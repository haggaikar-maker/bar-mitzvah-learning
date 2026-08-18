import Link from 'next/link'
import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { getAdminDashboardData } from '@/lib/admin-data'
import { getAdminSession } from '@/lib/admin-auth'
import { getLessonMediaKindLabel } from '@/lib/lesson-media'
import {
  formatGregorianDate,
  getDaysUntilReading,
  getReadingCountdownLabel,
} from '@/lib/student-schedule'
import { supabase } from '@/lib/supabase'
import {
  copyParashaStructure,
  deleteTeacherParasha,
  deleteLessonPart,
  deleteLessonSlide,
  deleteStudentRecordingFromAdmin,
  deleteStudent,
  ensureLessonGroup,
  hideAllStudentTeacherParashaParts,
  logoutAdmin,
  setTeacherParashaStatus,
  resetStudentPartProgress,
  saveWhatsAppTemplate,
  sendStudentWhatsAppBotMenuMessage,
  sendStudentWhatsAppPracticeMessage,
  updateStudentPartVisibility,
  upsertLessonPart,
  upsertLessonSlide,
  upsertStudent,
  upsertTeacherParasha,
} from './actions'
import { AudioDuration } from './audio-duration'
import { DirectVideoUpload } from './direct-video-upload'
import { AdminContentSelector, AdminEditorNavigator, AdminQueryForm } from './selectors'
import { PendingSubmitButton } from '../../components/pending-submit-button'

type SectionContentSummary = {
  sectionId: number
  partCount: number
  hasContent: boolean
}

type AdminPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function toNumber(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function toStringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? ''
}

function getTeacherParashaStatusLabel(status: string) {
  switch (status) {
    case 'active':
      return 'פעילה'
    case 'frozen':
      return 'קפואה'
    case 'draft':
      return 'טיוטה'
    case 'archived':
      return 'ארכיון'
    default:
      return status
  }
}

function getTeacherParashaStatusClass(status: string) {
  switch (status) {
    case 'active':
      return 'bg-emerald-100 text-emerald-900'
    case 'frozen':
      return 'bg-amber-100 text-amber-900'
    case 'draft':
      return 'bg-slate-200 text-slate-700'
    case 'archived':
      return 'bg-rose-100 text-rose-900'
    default:
      return 'bg-slate-100 text-slate-700'
  }
}

function DisclosureSection({
  title,
  description,
  children,
  defaultOpen = false,
}: {
  title: string
  description: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  return (
    <details
      open={defaultOpen}
      className="rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-slate-200"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{title}</h2>
          <p className="mt-2 text-sm leading-7 text-slate-600">{description}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
          הצג
        </span>
      </summary>
      <div className="mt-6">{children}</div>
    </details>
  )
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const session = await getAdminSession()
  const resolvedSearchParams = await searchParams

  if (!session) {
    redirect('/')
  }

  const hasOwnerAdminIdParam = Object.prototype.hasOwnProperty.call(
    resolvedSearchParams,
    'ownerAdminId'
  )
  const ownerAdminIdParamValue = toStringParam(resolvedSearchParams.ownerAdminId)
  const selectedParashaId = toNumber(resolvedSearchParams.parashaId)
  const selectedSectionId = toNumber(resolvedSearchParams.sectionId)
  const selectedPartId = toNumber(resolvedSearchParams.partId)
  const parsedTrackingStudentId = toNumber(resolvedSearchParams.trackingStudentId)
  const selectedOwnerAdminId =
    ownerAdminIdParamValue === 'all' ? null : toNumber(resolvedSearchParams.ownerAdminId)
  const selectedTeacherParashaStatus = toStringParam(resolvedSearchParams.teacherParashaStatus)
  const selectedBaseParashaFilterId = toNumber(resolvedSearchParams.baseParashaFilterId)
  const selectedNusachFilterId = toNumber(resolvedSearchParams.nusachFilterId)
  const selectedLibraryView = toStringParam(resolvedSearchParams.libraryView) || 'single'
  const selectedStudentView = toStringParam(resolvedSearchParams.studentView) || 'single'
  const selectedStudentCardId = toNumber(resolvedSearchParams.studentId)
  const whatsappStatus = toStringParam(resolvedSearchParams.waStatus)
  const whatsappMessage = toStringParam(resolvedSearchParams.waMessage)
  const ownerAdminSelectValue =
    session.role === 'primary'
      ? hasOwnerAdminIdParam
        ? ownerAdminIdParamValue === 'all'
          ? 'all'
          : (selectedOwnerAdminId?.toString() ?? '')
        : (session.id?.toString() ?? '')
      : (session.id?.toString() ?? '')
  const effectiveOwnerAdminId =
    session.role === 'primary'
      ? hasOwnerAdminIdParam
        ? ownerAdminIdParamValue === 'all'
          ? null
          : selectedOwnerAdminId
        : (session.id ?? null)
      : (session.id ?? null)

  const {
    parashot,
    teacherParashot = [],
    allTeacherParashot = [],
    nusachim = [],
    sections,
    students,
    admins,
    lessonGroup,
    lessonParts,
    lessonSlides,
    selectedParashaId: activeParashaId,
    selectedSectionId: activeSectionId,
    selectedPartId: activePartId,
    selectedTrackingStudentId,
    trackingSummary,
    parashaSources,
    error,
  } = await getAdminDashboardData({
    parashaId: selectedParashaId,
    sectionId: selectedSectionId,
    partId: selectedPartId,
    trackingStudentId: parsedTrackingStudentId,
    ownerAdminId: effectiveOwnerAdminId,
    teacherParashaStatus: selectedTeacherParashaStatus || null,
    baseParashaFilterId: selectedBaseParashaFilterId,
    nusachFilterId: selectedNusachFilterId,
  }, session)

  const selectedTeacherParasha =
    teacherParashot.find((parasha) => parasha.id === activeParashaId) ?? null
  const selectedParasha =
    parashot.find((parasha) => parasha.id === selectedTeacherParasha?.parasha_id) ?? null
  const selectedSection = sections.find((section) => section.id === activeSectionId)
  const selectedPart = lessonParts.find((part) => part.id === activePartId) ?? null
  const selectedPartMediaKind =
    selectedPart?.media_kind === 'video' || selectedPart?.video_url
      ? 'video'
      : 'audio_slides'
  const selectedPartPrimarySlide = lessonSlides[0] ?? null
  const trackingRows = trackingSummary?.rows ?? []
  const selectedLibraryCardId = activeParashaId ?? teacherParashot[0]?.id ?? null
  const filteredStudentsForTeacher =
    effectiveOwnerAdminId
      ? students.filter((student) => student.admin_id === effectiveOwnerAdminId)
      : students
  const normalizedSelectedStudentCardId =
    selectedStudentCardId &&
    filteredStudentsForTeacher.some((student) => student.id === selectedStudentCardId)
      ? selectedStudentCardId
      : null
  const selectedStudentCard =
    filteredStudentsForTeacher.find((student) => student.id === normalizedSelectedStudentCardId) ??
    filteredStudentsForTeacher[0] ??
    null
  const visibleTeacherParashot =
    selectedLibraryView === 'all'
      ? teacherParashot
      : teacherParashot.filter((parasha) => parasha.id === selectedLibraryCardId)
  const visibleStudents =
    selectedStudentView === 'all'
      ? filteredStudentsForTeacher
      : selectedStudentCard
        ? filteredStudentsForTeacher.filter((student) => student.id === selectedStudentCard.id)
        : []
  const selectedTeacherRecord =
    admins.find((admin) => admin.id === effectiveOwnerAdminId) ?? null
  const studentsByTeacherParashaId = new Map<number, typeof students>()
  const teacherParashaById = new Map(
    allTeacherParashot.map((teacherParasha) => [teacherParasha.id, teacherParasha] as const)
  )

  for (const student of students) {
    if (!student.active_teacher_parasha_id) {
      continue
    }

    const current = studentsByTeacherParashaId.get(student.active_teacher_parasha_id) ?? []
    current.push(student)
    studentsByTeacherParashaId.set(student.active_teacher_parasha_id, current)
  }

  const selectedLibraryStudents =
    selectedTeacherParasha
      ? studentsByTeacherParashaId.get(selectedTeacherParasha.id) ?? []
      : []
  const selectedStudentTeacherParasha =
    selectedStudentCard?.active_teacher_parasha_id
      ? teacherParashaById.get(selectedStudentCard.active_teacher_parasha_id) ?? null
      : null
  const trackingReadingCountdown = trackingSummary
    ? getReadingCountdownLabel(trackingSummary.student.torah_reading_date)
    : null
  const trackingReadingDate = trackingSummary?.student.torah_reading_date
    ? formatGregorianDate(trackingSummary.student.torah_reading_date)
    : null
  const trackingDaysUntil = trackingSummary?.student.torah_reading_date
    ? getDaysUntilReading(trackingSummary.student.torah_reading_date)
    : null
  const canSendTrackingReminder =
    Boolean(trackingSummary?.student.whatsapp_phone) &&
    Boolean(trackingSummary?.whatsappRecommendation)
  const canSendTrackingBotMenu =
    Boolean(trackingSummary?.student.whatsapp_phone) &&
    trackingRows.some((row) =>
      row.isVisibleToStudent &&
      (row.mediaKind === 'video' ? row.hasVideo : row.hasAudio && row.slideCount > 0)
    )
  const currentAdminReturnParams = new URLSearchParams()
  for (const [key, value] of Object.entries(resolvedSearchParams)) {
    if (key === 'waStatus' || key === 'waMessage') {
      continue
    }

    const normalizedValue = Array.isArray(value) ? value[0] : value
    if (normalizedValue) {
      currentAdminReturnParams.set(key, normalizedValue)
    }
  }
  const currentAdminReturnPath = currentAdminReturnParams.size > 0
    ? `/admin?${currentAdminReturnParams.toString()}`
    : '/admin'
  const teacherParashaStatusCounts = {
    active: teacherParashot.filter((item) => item.status === 'active').length,
    frozen: teacherParashot.filter((item) => item.status === 'frozen').length,
    draft: teacherParashot.filter((item) => item.status === 'draft').length,
    archived: teacherParashot.filter((item) => item.status === 'archived').length,
  }
  const allImportableSourceParts = parashaSources.flatMap((source) =>
    source.importableParts.map((part) => ({
      ...part,
      sourceLabel: `${source.parashaName} | ${source.displayName} | ${part.sectionName} | ${part.partName}`,
      teacherParashaId: source.teacherParashaId,
    }))
  )
  let sectionSummaries: SectionContentSummary[] = sections.map((section) => ({
    sectionId: section.id,
    partCount: 0,
    hasContent: false,
  }))

  if (activeParashaId) {
    const { data: sectionGroups } = await supabase
      .from('lesson_groups')
      .select('id, section_id')
      .eq('teacher_parasha_id', activeParashaId)

    const groups = (sectionGroups ?? []) as Array<{ id: number; section_id: number }>

    if (groups.length > 0) {
      const { data: groupParts } = await supabase
        .from('lesson_parts')
        .select('lesson_group_id')
        .in(
          'lesson_group_id',
          groups.map((group) => group.id)
        )

      const partCountByGroupId = new Map<number, number>()

      for (const part of (groupParts ?? []) as Array<{ lesson_group_id: number }>) {
        partCountByGroupId.set(
          part.lesson_group_id,
          (partCountByGroupId.get(part.lesson_group_id) ?? 0) + 1
        )
      }

      sectionSummaries = sections.map((section) => {
        const group = groups.find((row) => row.section_id === section.id)
        const partCount = group ? partCountByGroupId.get(group.id) ?? 0 : 0

        return {
          sectionId: section.id,
          partCount,
          hasContent: partCount > 0,
        }
      })
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="order-1 flex flex-wrap items-center justify-between gap-4 rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div>
            <p className="text-sm font-medium text-blue-700">אזור מנהל</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-900">
              שלום {session.displayName}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              דף זה מתמקד עכשיו בעבודה השוטפת: בחירת מלמד, תלמיד, ספריית פרשה ועריכת התוכן בפועל.
              כלי התחזוקה הרחבים זמינים בדף הניהול המתקדם.
            </p>
          </div>

          <div className="flex gap-3">
            <Link
              href="/admin/advanced"
              className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white"
            >
              ניהול מתקדם
            </Link>
            <Link
              href="/student"
              className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700"
            >
              מעבר לצד תלמיד
            </Link>
            <form action={logoutAdmin}>
              <button
                type="submit"
                className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
              >
                יציאה
              </button>
            </form>
          </div>
        </header>

        {error ? (
          <div className="order-2 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
            {error.message}
          </div>
        ) : null}
        {whatsappMessage ? (
          <div
            className={`order-2 rounded-2xl p-4 text-sm ring-1 ${
              whatsappStatus === 'success'
                ? 'bg-emerald-50 text-emerald-900 ring-emerald-200'
                : 'bg-rose-50 text-rose-900 ring-rose-200'
            }`}
          >
            {whatsappMessage}
          </div>
        ) : null}

        <div className="order-2 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-2xl font-bold text-slate-900">בחירה וניווט מהיר</h2>
            <p className="mt-2 text-sm leading-7 text-slate-600">
              מתחילים ממלמד, ממשיכים לתלמיד או לספריית הפרשה שלו, ואז יורדים לעריכת התוכן.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <a
                href="#tracking-panel"
                className="rounded-2xl bg-slate-900 px-4 py-3 text-center text-sm font-semibold text-white"
              >
                מעקב תרגולים
              </a>
              <a
                href="#content-editor"
                className="rounded-2xl bg-blue-600 px-4 py-3 text-center text-sm font-semibold text-white"
              >
                עריכת פרשה
              </a>
              <a
                href="#teacher-libraries"
                className="rounded-2xl bg-slate-100 px-4 py-3 text-center text-sm font-semibold text-slate-800"
              >
                ספריות פרשה
              </a>
              <a
                href="/admin/advanced"
                className="rounded-2xl bg-slate-100 px-4 py-3 text-center text-sm font-semibold text-slate-800"
              >
                ניהול והגדרות
              </a>
            </div>
          </section>

          <section className="rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-xl font-bold text-slate-900">סינון פעיל</h2>
            <div className="mt-4 space-y-3 text-sm text-slate-600">
              <div className="rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
                <div className="text-xs text-slate-500">מלמד פעיל</div>
                <div className="mt-1 text-lg font-bold text-slate-900">
                  {selectedTeacherRecord?.display_name ?? 'כל המלמדים'}
                </div>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
                <div className="text-xs text-slate-500">תלמידים בסינון</div>
                <div className="mt-1 text-lg font-bold text-slate-900">
                  {filteredStudentsForTeacher.length}
                </div>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
                <div className="text-xs text-slate-500">ספרייה פתוחה לעריכה</div>
                <div className="mt-1 text-lg font-bold text-slate-900">
                  {selectedTeacherParasha?.internal_display_name ?? 'עדיין לא נבחרה'}
                </div>
              </div>
            </div>
          </section>
        </div>

        <div id="tracking-panel" className="order-3">
        <DisclosureSection
          title="מעקב תרגולים והשלמות"
          description="בחר קודם מלמד, ואז תלמיד מתוך הרשימה שלו. כך המעקב נשאר נקי ורלוונטי רק למי שאתה עובד עליו."
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div />
          </div>

          <AdminQueryForm
            className="mt-6 grid gap-3 md:grid-cols-[14rem_1fr]"
            autoSubmitOnChange
          >
            <input
              type="hidden"
              name="parashaId"
              value={activeParashaId ?? ''}
            />
            <input
              type="hidden"
              name="sectionId"
              value={activeSectionId ?? ''}
            />
            <input
              type="hidden"
              name="partId"
              value={activePartId ?? ''}
            />
            {session.role === 'primary' ? (
              <select
                name="ownerAdminId"
                defaultValue={ownerAdminSelectValue}
                className="rounded-2xl border border-slate-200 px-4 py-3"
              >
                <option value="all">כל המלמדים</option>
                {admins.map((admin) => (
                  <option key={admin.id} value={admin.id}>
                    {admin.display_name}
                  </option>
                ))}
              </select>
            ) : (
              <input type="hidden" name="ownerAdminId" value={session.id ?? ''} />
            )}
            <select
              name="trackingStudentId"
              defaultValue={
                filteredStudentsForTeacher.some((student) => student.id === selectedTrackingStudentId)
                  ? (selectedTrackingStudentId ?? '')
                  : ''
              }
              className="rounded-2xl border border-slate-200 px-4 py-3"
            >
              <option value="">בחר תלמיד למעקב</option>
              {filteredStudentsForTeacher.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.name}
                </option>
              ))}
            </select>
          </AdminQueryForm>

          {trackingSummary ? (
            <div className="mt-6 overflow-x-auto rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    מעקב עבור {trackingSummary.student.name}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {trackingRows.length > 0
                      ? `${trackingRows.length} תתי־חלקים במעקב`
                      : 'עדיין אין לתלמיד תתי־חלקים מוכנים או משויכים.'}
                  </p>
                  {trackingReadingCountdown ? (
                    <p className="mt-2 text-sm font-semibold text-slate-700">
                      {trackingReadingCountdown}
                    </p>
                  ) : trackingReadingDate ? (
                    <p className="mt-2 text-sm font-semibold text-slate-700">
                      תאריך הקריאה: {trackingReadingDate}
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-slate-500">
                      עדיין לא הוגדר תאריך קריאה לתלמיד.
                    </p>
                  )}
                  {trackingReadingDate && trackingDaysUntil !== null ? (
                    <p className="mt-1 text-xs text-slate-500">
                      {trackingDaysUntil >= 0
                        ? `${trackingDaysUntil} ימים נותרו`
                        : `${Math.abs(trackingDaysUntil)} ימים מאז הקריאה`}
                    </p>
                  ) : null}
                </div>
                <div className="min-w-[280px] rounded-3xl bg-white p-4 ring-1 ring-slate-200">
                  <p className="text-sm font-semibold text-slate-900">שליחת WhatsApp ידנית</p>
                  <p className="mt-2 text-xs text-slate-500">
                    {trackingSummary.student.whatsapp_phone
                      ? `מספר תלמיד: ${trackingSummary.student.whatsapp_phone}`
                      : 'עדיין לא הוגדר מספר WhatsApp לתלמיד.'}
                  </p>
                  {trackingSummary.whatsappRecommendation ? (
                    <>
                      {trackingSummary.whatsappRecommendation.lastMessageAt ? (
                        <p className="mt-2 text-[11px] text-slate-500">
                          נשלח לאחרונה: {new Date(trackingSummary.whatsappRecommendation.lastMessageAt).toLocaleString('he-IL')}
                          {trackingSummary.whatsappRecommendation.lastMessageStatus
                            ? ` · ${trackingSummary.whatsappRecommendation.lastMessageStatus}`
                            : ''}
                        </p>
                      ) : null}
                      <form action={sendStudentWhatsAppPracticeMessage} className="mt-3">
                        <input type="hidden" name="student_id" value={trackingSummary.student.id} />
                        <input type="hidden" name="return_path" value={currentAdminReturnPath} />
                        <input
                          type="hidden"
                          name="lesson_part_id"
                          value={trackingSummary.whatsappRecommendation.lessonPartId}
                        />
                        <PendingSubmitButton
                          label="שליחת הודעת WhatsApp"
                          pendingLabel="שולח..."
                          overlayLabel="שולח תזכורת..."
                          overlaySubtitle="מכין קישור אישי ושולח אותו לתלמיד"
                          disabled={!canSendTrackingReminder}
                          className="w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white disabled:cursor-wait disabled:bg-emerald-400"
                        />
                      </form>
                      <form action={sendStudentWhatsAppBotMenuMessage} className="mt-3">
                        <input type="hidden" name="student_id" value={trackingSummary.student.id} />
                        <input type="hidden" name="return_path" value={currentAdminReturnPath} />
                        <PendingSubmitButton
                          label={canSendTrackingBotMenu ? 'שליחת הודעת בוט' : 'אין תפריט זמין'}
                          pendingLabel="שולח..."
                          overlayLabel="שולח הודעת בוט..."
                          overlaySubtitle="שולח לתלמיד רשימת קטעים פתוחים לבחירה ב-WhatsApp"
                          disabled={!canSendTrackingBotMenu}
                          className="w-full rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
                        />
                      </form>
                    </>
                  ) : (
                    <p className="mt-3 text-xs text-slate-500">
                      אין כרגע קטע מומלץ זמין לשליחה או שחסר קישור מערכת.
                    </p>
                  )}
                </div>
              </div>

              {trackingRows.length > 0 ? (
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead>
                    <tr className="text-right text-slate-500">
                      <th className="px-3 py-2 font-semibold">חלק</th>
                      <th className="px-3 py-2 font-semibold">תת־חלק</th>
                      <th className="px-3 py-2 font-semibold">סוג מדיה</th>
                      <th className="px-3 py-2 font-semibold">חשיפה</th>
                      <th className="px-3 py-2 font-semibold">יעד</th>
                      <th className="px-3 py-2 font-semibold">מדיה</th>
                      <th className="px-3 py-2 font-semibold">הקלטת תלמיד</th>
                      <th className="px-3 py-2 font-semibold">תרגולים</th>
                      <th className="px-3 py-2 font-semibold">השלמות</th>
                      <th className="px-3 py-2 font-semibold">תרגול אחרון</th>
                      <th className="px-3 py-2 font-semibold">תזכורת</th>
                      <th className="px-3 py-2 font-semibold">איפוס</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-700">
                    {trackingRows.map((row) => (
                      <tr key={`${row.lessonPartId}-${row.sectionName}-${row.partName}-${row.partOrder}`}>
                        <td className="px-3 py-3">{row.sectionName}</td>
                        <td className="px-3 py-3">
                          <div className="font-medium text-slate-900">{row.partName}</div>
                          <div className="text-xs text-slate-500">סדר {row.partOrder}</div>
                        </td>
                        <td className="px-3 py-3">{getLessonMediaKindLabel(row.mediaKind)}</td>
                        <td className="px-3 py-3">
                          <form action={updateStudentPartVisibility} className="grid gap-2">
                            <input
                              type="hidden"
                              name="student_id"
                              value={trackingSummary.student.id}
                            />
                            <input
                              type="hidden"
                              name="lesson_part_id"
                              value={row.lessonPartId}
                            />
                            <label className="flex items-center gap-2 text-xs text-slate-700">
                              <input
                                name="is_visible_to_student"
                                type="checkbox"
                                defaultChecked={row.isVisibleToStudent}
                              />
                              להציג לתלמיד
                            </label>
                            <button
                              type="submit"
                              className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-800"
                            >
                              שמירת חשיפה
                            </button>
                          </form>
                          {!row.baseVisibility ? (
                            <div className="mt-2 text-xs text-rose-600">
                              מוסתר גם ברמת הקטע הכללית
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-3">{row.completedCount}/{row.completionTarget}</td>
                        <td className="px-3 py-3">
                          {row.mediaKind === 'video'
                            ? row.hasVideo
                              ? 'וידאו מוכן'
                              : 'חסר וידאו'
                            : row.hasAudio && row.slideCount > 0
                              ? `מוכן: ${row.slideCount} שקופיות`
                              : 'חסר אודיו או שקופיות'}
                        </td>
                        <td className="px-3 py-3">
                          {row.studentRecording ? (
                            <div className="grid gap-2">
                              {row.studentRecording.signedUrl ? (
                                <audio
                                  controls
                                  className="w-full min-w-[220px]"
                                  src={row.studentRecording.signedUrl}
                                />
                              ) : (
                                <div className="text-xs text-slate-500">
                                  הקלטה קיימת אך לא נוצר קישור מאובטח.
                                </div>
                              )}
                              <div className="text-xs text-slate-500">
                                {new Date(row.studentRecording.createdAt).toLocaleString('he-IL')}
                              </div>
                            </div>
                          ) : (
                            'אין הקלטה'
                          )}
                        </td>
                        <td className="px-3 py-3">{row.practiceCount}</td>
                        <td className="px-3 py-3">{row.completedCount}</td>
                        <td className="px-3 py-3">
                          {row.lastPracticedAt
                            ? new Date(row.lastPracticedAt).toLocaleString('he-IL')
                            : 'עדיין לא תורגל'}
                        </td>
                        <td className="px-3 py-3">
                          {(() => {
                            const canSendReminder =
                              Boolean(trackingSummary.student.whatsapp_phone) &&
                              row.isVisibleToStudent &&
                              (row.mediaKind === 'video'
                                ? row.hasVideo
                                : row.hasAudio && row.slideCount > 0)

                            return (
                          <form action={sendStudentWhatsAppPracticeMessage}>
                            <input
                              type="hidden"
                              name="student_id"
                              value={trackingSummary.student.id}
                            />
                            <input type="hidden" name="return_path" value={currentAdminReturnPath} />
                            <input
                              type="hidden"
                              name="lesson_part_id"
                              value={row.lessonPartId}
                            />
                            <PendingSubmitButton
                              label={canSendReminder ? 'שלח תזכורת' : 'לא זמין לשליחה'}
                              pendingLabel="שולח..."
                              overlayLabel="שולח תזכורת..."
                              overlaySubtitle={`מכין קישור אישי עבור ${row.partName}`}
                              disabled={!canSendReminder}
                              className="w-full rounded-xl bg-emerald-100 px-3 py-2 text-xs font-semibold text-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                            />
                          </form>
                            )
                          })()}
                        </td>
                        <td className="px-3 py-3">
                          <div className="grid gap-2">
                            <form action={resetStudentPartProgress}>
                              <input
                                type="hidden"
                                name="student_id"
                                value={trackingSummary.student.id}
                              />
                              <input
                                type="hidden"
                                name="lesson_part_id"
                                value={row.lessonPartId}
                              />
                              <input type="hidden" name="mode" value="completed" />
                              <button
                                type="submit"
                                className="w-full rounded-xl bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-900"
                              >
                                איפוס השלמות
                              </button>
                            </form>
                            <form action={resetStudentPartProgress}>
                              <input
                                type="hidden"
                                name="student_id"
                                value={trackingSummary.student.id}
                              />
                              <input
                                type="hidden"
                                name="lesson_part_id"
                                value={row.lessonPartId}
                              />
                              <input type="hidden" name="mode" value="all" />
                              <button
                                type="submit"
                                className="w-full rounded-xl bg-rose-100 px-3 py-2 text-xs font-semibold text-rose-900"
                              >
                                איפוס תרגולים
                              </button>
                            </form>
                            <form action={deleteStudentRecordingFromAdmin}>
                              <input
                                type="hidden"
                                name="student_id"
                                value={trackingSummary.student.id}
                              />
                              <input
                                type="hidden"
                                name="lesson_part_id"
                                value={row.lessonPartId}
                              />
                              <button
                                type="submit"
                                className="w-full rounded-xl bg-slate-200 px-3 py-2 text-xs font-semibold text-slate-800"
                              >
                                מחיקת הקלטה
                              </button>
                            </form>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="rounded-2xl bg-white p-4 text-sm text-slate-500 ring-1 ring-slate-200">
                  לתלמיד הזה עדיין אין תתי־חלקים משויכים עם נתוני מעקב להצגה.
                </div>
              )}

              <div className="mt-6 rounded-3xl bg-white p-4 ring-1 ring-slate-200">
                <h4 className="text-sm font-semibold text-slate-900">תבנית הודעת WhatsApp</h4>
                <p className="mt-2 text-xs leading-6 text-slate-500">
                  אפשר להשתמש במשתנים: <code>%PART%</code>, <code>%SECTION%</code>, <code>%STUDENT%</code>, <code>%DAYS%</code>, <code>%COUNTDOWN%</code>.
                </p>
                <form action={saveWhatsAppTemplate} className="mt-4">
                  <input type="hidden" name="return_path" value={currentAdminReturnPath} />
                  <textarea
                    name="template_text"
                    defaultValue={trackingSummary.whatsappTemplateText}
                    rows={6}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-7 text-slate-700 outline-none"
                  />
                  <p className="mt-3 text-[11px] text-slate-500">
                    הקישור הישיר לקטע יתווסף אוטומטית בסוף כל הודעה.
                  </p>
                  <div className="mt-4">
                    <PendingSubmitButton
                      label="שמירת תבנית"
                      pendingLabel="שומר..."
                      overlayLabel="שומר תבנית..."
                      overlaySubtitle="מעדכן את ברירת המחדל של הודעות ה-WhatsApp"
                      className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-wait disabled:bg-slate-500"
                    />
                  </div>
                </form>
              </div>
            </div>
          ) : null}
        </DisclosureSection>
        </div>

        <div className="order-5 grid items-start gap-6">
          <div className="xl:col-span-2">
          <DisclosureSection
            defaultOpen
            title="ספריות פרשה של מלמדים"
            description="כאן בוחרים ספריית עבודה, רואים אילו תלמידים משויכים אליה, ומשם ממשיכים לעריכת הפרשה עצמה."
          >
            <div id="teacher-libraries" className="grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
                <div className="text-xs text-slate-500">פעילות</div>
                <div className="mt-1 text-2xl font-black text-emerald-700">{teacherParashaStatusCounts.active}</div>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
                <div className="text-xs text-slate-500">קפואות</div>
                <div className="mt-1 text-2xl font-black text-amber-700">{teacherParashaStatusCounts.frozen}</div>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
                <div className="text-xs text-slate-500">טיוטות</div>
                <div className="mt-1 text-2xl font-black text-slate-700">{teacherParashaStatusCounts.draft}</div>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
                <div className="text-xs text-slate-500">ארכיון</div>
                <div className="mt-1 text-2xl font-black text-rose-700">{teacherParashaStatusCounts.archived}</div>
              </div>
            </div>

            <AdminQueryForm
              className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_1fr_1.4fr_auto]"
              autoSubmitOnChange
            >
              {activeParashaId ? <input type="hidden" name="parashaId" value={activeParashaId} /> : null}
              {activeSectionId ? <input type="hidden" name="sectionId" value={activeSectionId} /> : null}
              {activePartId ? <input type="hidden" name="partId" value={activePartId} /> : null}
              {selectedTrackingStudentId ? <input type="hidden" name="trackingStudentId" value={selectedTrackingStudentId} /> : null}
              {session.role === 'primary' ? (
                <select
                  name="ownerAdminId"
                  defaultValue={ownerAdminSelectValue}
                  className="rounded-2xl border border-slate-200 px-4 py-3"
                >
                  <option value="all">כל המלמדים</option>
                  {admins.map((admin) => (
                    <option key={admin.id} value={admin.id}>
                      {admin.display_name}
                    </option>
                  ))}
                </select>
              ) : (
                <input type="hidden" name="ownerAdminId" value={session.id ?? ''} />
              )}
              <select
                name="baseParashaFilterId"
                defaultValue={selectedBaseParashaFilterId ?? ''}
                className="rounded-2xl border border-slate-200 px-4 py-3"
              >
                <option value="">כל הפרשות</option>
                {parashot.map((parasha) => (
                  <option key={parasha.id} value={parasha.id}>
                    {parasha.name}
                  </option>
                ))}
              </select>
              <select
                name="nusachFilterId"
                defaultValue={selectedNusachFilterId ?? ''}
                className="rounded-2xl border border-slate-200 px-4 py-3"
              >
                <option value="">כל הנוסחים</option>
                {nusachim.filter((nusach) => nusach.slug !== 'unspecified').map((nusach) => (
                  <option key={nusach.id} value={nusach.id}>
                    {nusach.name}
                  </option>
                ))}
              </select>
              <select
                name="teacherParashaStatus"
                defaultValue={selectedTeacherParashaStatus || 'all'}
                className="rounded-2xl border border-slate-200 px-4 py-3"
              >
                <option value="all">כל הסטטוסים</option>
                <option value="active">פעילה</option>
                <option value="frozen">קפואה</option>
                <option value="draft">טיוטה</option>
                <option value="archived">ארכיון</option>
              </select>
              <select
                name="libraryView"
                defaultValue={selectedLibraryView}
                className="rounded-2xl border border-slate-200 px-4 py-3"
              >
                <option value="single">ספרייה אחת</option>
                <option value="all">כל הספריות</option>
              </select>
              <select
                name="parashaId"
                defaultValue={selectedLibraryCardId ?? ''}
                className="rounded-2xl border border-slate-200 px-4 py-3"
              >
                <option value="">בחירת ספרייה</option>
                {teacherParashot.map((teacherParasha) => (
                  <option key={teacherParasha.id} value={teacherParasha.id}>
                    {teacherParasha.internal_display_name} | {teacherParasha.owner_display_name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
              >
                סינון ספריות
              </button>
            </AdminQueryForm>

            <div className="mt-5 space-y-4">
              {visibleTeacherParashot.length > 0 ? (
                visibleTeacherParashot.map((teacherParasha) => (
                  <div key={teacherParasha.id}>
                    <form action={upsertTeacherParasha} className="grid gap-3 rounded-3xl bg-slate-50 p-4">
                      <input type="hidden" name="id" value={teacherParasha.id} />
                      <input type="hidden" name="status" value={teacherParasha.status} />
                      {session.role === 'primary' ? (
                        <select
                          name="owner_admin_id"
                          defaultValue={teacherParasha.owner_admin_id}
                          className="rounded-2xl border border-slate-200 px-4 py-3"
                        >
                          {admins.map((admin) => (
                            <option key={admin.id} value={admin.id}>
                              {admin.display_name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input type="hidden" name="owner_admin_id" value={teacherParasha.owner_admin_id} />
                      )}
                      <select
                        name="base_parasha_id"
                        defaultValue={teacherParasha.parasha_id}
                        className="rounded-2xl border border-slate-200 px-4 py-3"
                      >
                        {parashot.map((parasha) => (
                          <option key={parasha.id} value={parasha.id}>
                            {parasha.name}
                          </option>
                        ))}
                      </select>
                      <select
                        name="nusach_id"
                        defaultValue={teacherParasha.nusach_id}
                        className="rounded-2xl border border-slate-200 px-4 py-3"
                      >
                        {nusachim.filter((nusach) => nusach.slug !== 'unspecified').map((nusach) => (
                          <option key={nusach.id} value={nusach.id}>
                            {nusach.name}
                          </option>
                        ))}
                      </select>
                      <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 ring-1 ring-slate-200">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <span>{teacherParasha.internal_display_name} | {teacherParasha.nusach_name}</span>
                          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${getTeacherParashaStatusClass(teacherParasha.status)}`}>
                            {getTeacherParashaStatusLabel(teacherParasha.status)}
                          </span>
                        </div>
                        <div className="mt-3 text-xs text-slate-500">
                          {(() => {
                            const linkedStudents =
                              studentsByTeacherParashaId.get(teacherParasha.id) ?? []

                            if (linkedStudents.length === 0) {
                              return 'אין עדיין תלמידים משויכים לספרייה הזאת.'
                            }

                            return `תלמידים משויכים: ${linkedStudents.map((student) => student.name).join(' , ')}`
                          })()}
                        </div>
                      </div>
                      <input
                        name="freeze_reason"
                        defaultValue={teacherParasha.freeze_reason ?? ''}
                        placeholder="סיבת הקפאה"
                        className="rounded-2xl border border-slate-200 px-4 py-3"
                      />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <button
                          type="submit"
                          className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
                        >
                          שמירת ספרייה
                        </button>
                        <div />
                      </div>
                    </form>
                    <form action={setTeacherParashaStatus} className="mt-3">
                      <input type="hidden" name="id" value={teacherParasha.id} />
                      <input
                        type="hidden"
                        name="status"
                        value={teacherParasha.status === 'frozen' ? 'active' : 'frozen'}
                      />
                      <input
                        type="hidden"
                        name="freeze_reason"
                        value={teacherParasha.freeze_reason ?? ''}
                      />
                      <button
                        type="submit"
                        className="w-full rounded-2xl bg-amber-500 px-4 py-3 text-sm font-semibold text-white"
                      >
                        {teacherParasha.status === 'frozen' ? 'החזרה לפעיל' : 'הקפאה'}
                      </button>
                    </form>
                  </div>
                ))
              ) : (
                <div className="rounded-3xl bg-slate-50 p-5 text-sm text-slate-500 ring-1 ring-slate-200">
                  לא נמצאה ספרייה להצגה לפי הבחירה שבוצעה.
                </div>
              )}
            </div>

            <details className="mt-6 rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200">
              <summary className="cursor-pointer list-none text-lg font-semibold text-slate-900">
                יצירת ספריית פרשה חדשה
              </summary>
              <form action={upsertTeacherParasha} className="mt-4 grid gap-3">
              {session.role === 'primary' ? (
                <select
                  name="owner_admin_id"
                  defaultValue={session.id ?? ''}
                  className="rounded-2xl border border-slate-200 px-4 py-3"
                >
                  {admins.map((admin) => (
                    <option key={admin.id} value={admin.id}>
                      {admin.display_name}
                    </option>
                  ))}
                </select>
              ) : null}
              <select
                name="base_parasha_id"
                defaultValue=""
                className="rounded-2xl border border-slate-200 px-4 py-3"
              >
                <option value="">בחירת פרשה</option>
                {parashot.map((parasha) => (
                  <option key={parasha.id} value={parasha.id}>
                    {parasha.name}
                  </option>
                ))}
              </select>
              <select
                name="nusach_id"
                defaultValue=""
                className="rounded-2xl border border-slate-200 px-4 py-3"
              >
                <option value="">בחירת נוסח</option>
                {nusachim.filter((nusach) => nusach.slug !== 'unspecified').map((nusach) => (
                  <option key={nusach.id} value={nusach.id}>
                    {nusach.name}
                  </option>
                ))}
              </select>
                  <button
                    type="submit"
                    className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white"
                  >
                    יצירת ספריית פרשה
              </button>
              </form>
            </details>
          </DisclosureSection>
          </div>

        <DisclosureSection
          title="תלמידי המנהל"
          description="כאן בוחרים תלמיד מתוך המלמד המסונן, משייכים לו ספריית פרשה, ואפשר גם לפתוח ישר את הספרייה שלו לעריכה."
        >
            <AdminQueryForm
              className="grid gap-3 rounded-3xl bg-slate-50 p-4 md:grid-cols-[12rem_14rem_1fr_auto]"
              autoSubmitOnChange
            >
              {session.role === 'primary' ? (
                <select
                  name="ownerAdminId"
                  defaultValue={ownerAdminSelectValue}
                  className="rounded-2xl border border-slate-200 px-4 py-3"
                >
                  <option value="all">כל המלמדים</option>
                  {admins.map((admin) => (
                    <option key={admin.id} value={admin.id}>
                      {admin.display_name}
                    </option>
                  ))}
                </select>
              ) : (
                <input type="hidden" name="ownerAdminId" value={session.id ?? ''} />
              )}
              <select
                name="studentView"
                defaultValue={selectedStudentView}
                className="rounded-2xl border border-slate-200 px-4 py-3"
              >
                <option value="single">תלמיד אחד</option>
                <option value="all">כל התלמידים</option>
              </select>
              <select
                name="studentId"
                defaultValue={normalizedSelectedStudentCardId ?? ''}
                className="rounded-2xl border border-slate-200 px-4 py-3"
              >
                <option value="">בחירת תלמיד</option>
                {filteredStudentsForTeacher.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
              >
                סינון
              </button>
            </AdminQueryForm>
              <div className="mt-5 space-y-4">
                {visibleStudents.length > 0 ? visibleStudents.map((student) => (
                  <form key={student.id} action={upsertStudent} className="grid gap-3 rounded-3xl bg-slate-50 p-4">
                    <input type="hidden" name="id" value={student.id} />
                <input
                  name="name"
                  defaultValue={student.name}
                  className="rounded-2xl border border-slate-200 px-4 py-3"
                />
                <input
                  name="username"
                  defaultValue={student.username ?? ''}
                  className="rounded-2xl border border-slate-200 px-4 py-3"
                />
                <input
                  name="password"
                  type="password"
                  placeholder="סיסמה חדשה אם רוצים לעדכן"
                  className="rounded-2xl border border-slate-200 px-4 py-3"
                />
                <input
                  name="whatsapp_phone"
                  defaultValue={student.whatsapp_phone ?? ''}
                  placeholder="מספר WhatsApp, למשל 9725..."
                  className="rounded-2xl border border-slate-200 px-4 py-3"
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-2 text-sm text-slate-700">
                    <span>תאריך לידה</span>
                    <input
                      name="birth_date"
                      type="date"
                      defaultValue={student.birth_date ?? ''}
                      className="rounded-2xl border border-slate-200 px-4 py-3"
                    />
                  </label>
                  <label className="grid gap-2 text-sm text-slate-700">
                    <span>תאריך קריאה בתורה</span>
                    <input
                      name="torah_reading_date"
                      type="date"
                      defaultValue={student.torah_reading_date ?? ''}
                      className="rounded-2xl border border-slate-200 px-4 py-3"
                    />
                  </label>
                </div>
                <select
                  name="teacher_parasha_id"
                  defaultValue={student.active_teacher_parasha_id ?? ''}
                  className="rounded-2xl border border-slate-200 px-4 py-3"
                >
                    <option value="">ללא ספריית פרשה</option>
                      {teacherParashot.map((parasha) => (
                        <option key={parasha.id} value={parasha.id}>
                          {parasha.internal_display_name} | {parasha.owner_display_name}
                        </option>
                      ))}
                    </select>
                <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 ring-1 ring-slate-200">
                  <div className="text-xs text-slate-500">שיוך נוכחי</div>
                  <div className="mt-1 font-semibold text-slate-900">
                    {student.admin_id
                      ? admins.find((admin) => admin.id === student.admin_id)?.display_name ?? 'מנהל לא ידוע'
                      : 'ללא מלמד'}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {student.active_teacher_parasha_id
                      ? teacherParashaById.get(student.active_teacher_parasha_id)?.internal_display_name ?? 'ספרייה לא ידועה'
                      : 'ללא ספריית פרשה'}
                  </div>
                </div>
                {student.active_teacher_parasha_id ? (
                  <Link
                    href={`/admin?ownerAdminId=${student.admin_id ?? ''}&parashaId=${student.active_teacher_parasha_id}#content-editor`}
                    className="rounded-2xl bg-blue-50 px-4 py-3 text-center text-sm font-semibold text-blue-800 ring-1 ring-blue-200"
                  >
                    פתיחת ספריית התלמיד לעריכה
                  </Link>
                ) : (
                  <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-500 ring-1 ring-slate-200">
                    עדיין לא שויכה לתלמיד ספריית פרשה.
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                      <button
                        type="submit"
                        className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
                      >
                        שמירת תלמיד
                      </button>
                      <button
                        formAction={deleteStudent}
                        type="submit"
                        className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white"
                      >
                        מחיקת תלמיד
                      </button>
                    </div>
                  </form>
                )) : (
                  <div className="rounded-3xl bg-slate-50 p-5 text-sm text-slate-500 ring-1 ring-slate-200">
                    לא נבחר תלמיד להצגה.
                  </div>
                )}
              </div>

            <details className="mt-6 rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200">
              <summary className="cursor-pointer list-none text-lg font-semibold text-slate-900">
                הוספת תלמיד חדש
              </summary>
              <form action={upsertStudent} className="mt-4 grid gap-3">
            <input
              name="name"
              placeholder="שם תלמיד"
              className="rounded-2xl border border-slate-200 px-4 py-3"
            />
            <input
              name="username"
              placeholder="שם משתמש לתלמיד"
              className="rounded-2xl border border-slate-200 px-4 py-3"
            />
            <input
              name="password"
              type="password"
              placeholder="סיסמה לתלמיד"
              className="rounded-2xl border border-slate-200 px-4 py-3"
            />
            <input
              name="whatsapp_phone"
              placeholder="מספר WhatsApp, למשל 9725..."
              className="rounded-2xl border border-slate-200 px-4 py-3"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-2 text-sm text-slate-700">
                <span>תאריך לידה</span>
                <input
                  name="birth_date"
                  type="date"
                  className="rounded-2xl border border-slate-200 px-4 py-3"
                />
              </label>
              <label className="grid gap-2 text-sm text-slate-700">
                <span>תאריך קריאה בתורה</span>
                <input
                  name="torah_reading_date"
                  type="date"
                  className="rounded-2xl border border-slate-200 px-4 py-3"
                />
              </label>
            </div>
            <select
              name="teacher_parasha_id"
              defaultValue=""
              className="rounded-2xl border border-slate-200 px-4 py-3"
            >
                <option value="">בחירת ספריית פרשה</option>
                      {teacherParashot.map((parasha) => (
                        <option key={parasha.id} value={parasha.id}>
                          {parasha.internal_display_name} | {parasha.owner_display_name}
                        </option>
                      ))}
                    </select>
              <button
                type="submit"
                className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white"
              >
                הוספת תלמיד
              </button>
              </form>
            </details>
          </DisclosureSection>
        </div>

        <section
          id="content-editor"
          className="order-4 rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-slate-200"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">עריכת פרשה ספציפית</h2>
              <p className="mt-2 text-sm text-slate-600">
                כאן עובדים לפי הסדר הבא: בוחרים מלמד, אפשר להיכנס דרך תלמיד מסוים, ואז עורכים את הספרייה, החלקים ותתי־החלקים.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">כניסה לעריכה לפי תלמיד</h3>
              <p className="mt-2 text-sm text-slate-600">
                אפשר לבחור כאן מלמד, תלמיד או ספריית פרשה ישירות. הבחירה מתעדכנת מיד,
                בלי לחצן ביניים, וכך אפשר לעבור בקלות בין עבודה לפי תלמיד לעבודה לפי פרשה.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200">
                  <div className="text-xs text-slate-500">מלמד פעיל</div>
                  <div className="mt-1 text-base font-bold text-slate-900">
                    {selectedTeacherRecord?.display_name ?? 'כל המלמדים'}
                  </div>
                </div>
                <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200">
                  <div className="text-xs text-slate-500">תלמיד נבחר</div>
                  <div className="mt-1 text-base font-bold text-slate-900">
                    {selectedStudentCard?.name ?? 'עדיין לא נבחר תלמיד'}
                  </div>
                </div>
              </div>
              <div className="mt-4">
                <AdminEditorNavigator
                  admins={admins}
                  students={students}
                  teacherParashot={allTeacherParashot}
                  selectedOwnerAdminId={effectiveOwnerAdminId}
                  selectedStudentId={normalizedSelectedStudentCardId}
                  selectedParashaId={activeParashaId}
                />
              </div>
              <div className="mt-4 rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 ring-1 ring-slate-200">
                {selectedStudentCard ? (
                  selectedStudentTeacherParasha ? (
                    <>
                      <div className="font-semibold text-slate-900">
                        {selectedStudentTeacherParasha.internal_display_name}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {selectedStudentTeacherParasha.owner_display_name} | {selectedStudentTeacherParasha.nusach_name}
                      </div>
                    </>
                  ) : (
                    <div className="text-slate-500">לתלמיד שנבחר עדיין אין ספריית פרשה פעילה.</div>
                  )
                ) : (
                  <div className="text-slate-500">אפשר לבחור מלמד, תלמיד או ספריית פרשה כדי להתחיל עריכה.</div>
                )}
              </div>
              {selectedStudentCard && selectedStudentTeacherParasha ? (
                <form action={hideAllStudentTeacherParashaParts} className="mt-4">
                  <input type="hidden" name="return_path" value={currentAdminReturnPath} />
                  <input type="hidden" name="student_id" value={selectedStudentCard.id} />
                  <input
                    type="hidden"
                    name="teacher_parasha_id"
                    value={selectedStudentTeacherParasha.id}
                  />
                  <button
                    type="submit"
                    className="w-full rounded-2xl bg-amber-500 px-4 py-3 text-sm font-semibold text-white"
                  >
                    הסתרת כל תתי־החלקים של התלמיד
                  </button>
                </form>
              ) : null}
            </div>

            <div className="rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">תלמידים בספרייה הפתוחה</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedLibraryStudents.length > 0 ? (
                  selectedLibraryStudents.map((student) => (
                    <span
                      key={student.id}
                      className="rounded-full bg-white px-3 py-2 text-xs font-semibold text-slate-700 ring-1 ring-slate-200"
                    >
                      {student.name}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-slate-500">אין עדיין תלמידים משויכים לספרייה הזאת.</span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6">
            <AdminContentSelector
              key={`${activeParashaId ?? 'none'}-${activeSectionId ?? 'none'}-${activePartId ?? 'none'}`}
              teacherParashot={teacherParashot}
              sections={sections}
              sectionSummaries={sectionSummaries}
              lessonParts={lessonParts}
              selectedParashaId={activeParashaId}
              selectedSectionId={activeSectionId}
              selectedPartId={activePartId}
            />
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200">
              <p className="text-sm text-slate-500">פרשה נבחרת</p>
              <p className="mt-2 text-2xl font-black text-slate-900">
                {selectedTeacherParasha?.internal_display_name ?? 'לא נבחרה'}
              </p>
              {selectedTeacherParasha ? (
                <div className="mt-2 space-y-1 text-xs text-slate-500">
                  <p>
                    {selectedTeacherParasha.owner_display_name} | {selectedTeacherParasha.nusach_name} | {getTeacherParashaStatusLabel(selectedTeacherParasha.status)}
                  </p>
                  {selectedTeacherParasha.source_teacher_parasha_id ? (
                    <p>ספרייה זו נבנתה על בסיס ייבוא קודם.</p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200">
              <p className="text-sm text-slate-500">חלק נבחר</p>
              <p className="mt-2 text-2xl font-black text-slate-900">
                {selectedSection?.name ?? 'לא נבחר'}
              </p>
            </div>
            <div className="rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200">
              <p className="text-sm text-slate-500">תת־חלק פתוח</p>
              <p className="mt-2 text-2xl font-black text-slate-900">
                {selectedPart?.name ?? 'אין'}
              </p>
            </div>
          </div>

          {selectedTeacherParasha ? (
            <div className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200">
                <h3 className="text-lg font-semibold text-slate-900">תצוגת תוכן לספרייה הנבחרת</h3>
                <p className="mt-2 text-sm text-slate-600">
                  כאן אפשר לעיין במדיה של התת־חלק הפתוח בלי להיכנס לשדות העריכה.
                </p>

                {selectedPart ? (
                  <div className="mt-4 grid gap-4">
                    <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
                      <div className="text-sm font-semibold text-slate-900">{selectedPart.name}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {selectedSection?.name ?? 'ללא חלק'} | {getLessonMediaKindLabel(selectedPartMediaKind)}
                      </div>
                    </div>

                    {selectedPartMediaKind === 'video' && selectedPart.video_url ? (
                      <video
                        controls
                        className="w-full rounded-3xl bg-slate-900 ring-1 ring-slate-200"
                        src={selectedPart.video_url}
                      />
                    ) : null}

                    {selectedPartMediaKind === 'audio_slides' && selectedPart.audio_url ? (
                      <audio
                        controls
                        className="w-full rounded-2xl bg-white p-3 ring-1 ring-slate-200"
                        src={selectedPart.audio_url}
                      />
                    ) : null}

                    {selectedPartMediaKind === 'audio_slides' && selectedPartPrimarySlide ? (
                      <img
                        src={selectedPartPrimarySlide.image_url}
                        alt={selectedPart.name}
                        className="max-h-[22rem] w-full rounded-3xl bg-white object-contain p-3 ring-1 ring-slate-200"
                      />
                    ) : null}

                    {selectedPartMediaKind === 'audio_slides' && lessonSlides.length > 0 ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {lessonSlides.map((slide) => (
                          <div
                            key={slide.id}
                            className="rounded-2xl bg-white p-3 ring-1 ring-slate-200"
                          >
                            <img
                              src={slide.image_url}
                              alt={`שקופית ${slide.slide_index + 1}`}
                              className="h-32 w-full rounded-2xl object-contain"
                            />
                            <div className="mt-2 text-xs text-slate-500">
                              שקופית {slide.slide_index + 1} | {slide.start_second} שניות
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl bg-white p-4 text-sm text-slate-500 ring-1 ring-slate-200">
                    בחר תת־חלק כדי לצפות כאן באודיו, וידאו או שקופיות.
                  </div>
                )}
              </div>

              <div className="rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200">
                <h3 className="text-lg font-semibold text-slate-900">שליטה על הספרייה</h3>
                <p className="mt-2 text-sm text-slate-600">
                  מנהל ראשי יכול להקפיא, לארכב או למחוק את ספריית הפרשה שנבחרה. מלמד רגיל יכול לשלוט רק על הספריות שלו.
                </p>
                <div className="mt-4 grid gap-3">
                  <form action={setTeacherParashaStatus}>
                    <input type="hidden" name="id" value={selectedTeacherParasha.id} />
                    <input
                      type="hidden"
                      name="status"
                      value={selectedTeacherParasha.status === 'frozen' ? 'active' : 'frozen'}
                    />
                    <input
                      type="hidden"
                      name="freeze_reason"
                      value={selectedTeacherParasha.freeze_reason ?? ''}
                    />
                    <button
                      type="submit"
                      className="w-full rounded-2xl bg-amber-500 px-4 py-3 text-sm font-semibold text-white"
                    >
                      {selectedTeacherParasha.status === 'frozen' ? 'החזרה לפעיל' : 'הקפאת ספרייה'}
                    </button>
                  </form>
                  <form action={setTeacherParashaStatus}>
                    <input type="hidden" name="id" value={selectedTeacherParasha.id} />
                    <input
                      type="hidden"
                      name="status"
                      value={selectedTeacherParasha.status === 'archived' ? 'active' : 'archived'}
                    />
                    <input
                      type="hidden"
                      name="freeze_reason"
                      value={selectedTeacherParasha.freeze_reason ?? ''}
                    />
                    <button
                      type="submit"
                      className="w-full rounded-2xl bg-slate-700 px-4 py-3 text-sm font-semibold text-white"
                    >
                      {selectedTeacherParasha.status === 'archived' ? 'החזרה מארכיון' : 'העברה לארכיון'}
                    </button>
                  </form>
                  <form action={deleteTeacherParasha}>
                    <input type="hidden" name="id" value={selectedTeacherParasha.id} />
                    <input type="hidden" name="return_path" value={currentAdminReturnPath} />
                    <button
                      type="submit"
                      className="w-full rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white"
                    >
                      מחיקת ספריית פרשה
                    </button>
                  </form>
                </div>
              </div>
            </div>
          ) : null}

          {selectedTeacherParasha ? (
            <details className="mt-6 rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200">
              <summary className="cursor-pointer list-none text-lg font-semibold text-slate-900">
                העתקת מבנה וייבוא מספריות אחרות
              </summary>
              <div className="mt-4 rounded-3xl bg-slate-50 p-1">
                <div className="rounded-3xl bg-white p-4 ring-1 ring-slate-200">
                <h3 className="text-lg font-semibold text-slate-900">
                  העתקת מבנה לפרשה {selectedTeacherParasha.internal_display_name}
                </h3>
                <p className="mt-2 text-sm text-slate-600">
                  אפשר לייבא את כל המבנה של ספריית מקור או לבחור תת־חלק יחיד בלבד.
                  כעת אפשר לבחור מקור מכל פרשה אחרת, כל עוד הוא באותו נוסח קריאה.
                  המערכת מציגה רק תתי־חלקים שבאמת מוכנים לייבוא: וידאו קיים, או אודיו עם לפחות שקופית אחת.
                </p>
                <form action={copyParashaStructure} className="mt-4 grid gap-3">
                  <input type="hidden" name="teacher_parasha_id" value={selectedTeacherParasha.id} />
                  <select
                    name="copy_scope"
                    defaultValue="all"
                    className="rounded-2xl border border-slate-200 px-4 py-3"
                  >
                    <option value="all">ייבוא כל המבנה</option>
                    <option value="single_part">ייבוא תת־חלק בודד</option>
                  </select>
                  <select
                    name="source_teacher_parasha_id"
                    defaultValue=""
                    className="rounded-2xl border border-slate-200 px-4 py-3"
                  >
                    <option value="">בחר פרשת מקור</option>
                    {parashaSources.map((source) => (
                      <option key={source.teacherParashaId} value={source.teacherParashaId}>
                        {source.parashaName} | {source.internalDisplayName} | {source.displayName}{source.nusachName ? ` | ${source.nusachName}` : ''} | {source.importablePartCount} תתי־חלקים
                      </option>
                    ))}
                  </select>
                  <select
                    name="source_lesson_part_id"
                    defaultValue=""
                    className="rounded-2xl border border-slate-200 px-4 py-3"
                  >
                    <option value="">בחירת תת־חלק בודד לייבוא</option>
                    {allImportableSourceParts.map((part) => (
                      <option key={`${part.teacherParashaId}-${part.lessonPartId}`} value={part.lessonPartId}>
                        {part.sourceLabel}
                      </option>
                    ))}
                  </select>
                  <input
                    name="share_code"
                    type="password"
                    placeholder="קוד השיתוף של מנהל המקור"
                    className="rounded-2xl border border-slate-200 px-4 py-3"
                  />
                  <button
                    type="submit"
                    className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white"
                  >
                    העתקת מבנה הפרשה
                  </button>
                </form>
                {parashaSources.length > 0 ? (
                  <p className="mt-3 text-xs text-slate-500">
                    נמצאו {parashaSources.length} ספריות מקור זמינות לייבוא. הרשימה המלאה מופיעה ישירות בשדות הבחירה למעלה.
                  </p>
                ) : null}
              </div>
              </div>
            </details>
          ) : null}

          {!lessonGroup && activeParashaId && activeSectionId ? (
            <form action={ensureLessonGroup} className="mt-6 rounded-3xl bg-slate-50 p-4">
              <input type="hidden" name="teacher_parasha_id" value={activeParashaId} />
              <input type="hidden" name="section_id" value={activeSectionId} />
              <p className="text-sm text-slate-600">
                עדיין אין `lesson_group` עבור הבחירה הזאת.
              </p>
              <button
                type="submit"
                className="mt-4 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white"
              >
                יצירת group לפרשה + חלק
              </button>
            </form>
          ) : null}

          {lessonGroup ? (
            <div className="mt-8 grid gap-6 xl:grid-cols-[1fr_0.9fr]">
              <div>
                <h3 className="text-xl font-bold text-slate-900">תתי־חלקים</h3>
                <p className="mt-2 text-sm text-slate-600">
                  כאן מגדירים את המבנה של תתי־החלקים. את האודיו והשקופיות של
                  הקטע הנבחר, או את הווידאו שלו, עורכים בעמודה השנייה בלבד.
                </p>
                <div className="mt-4 space-y-4">
                  {lessonParts.map((part) => (
                    <form key={part.id} action={upsertLessonPart} className="grid gap-3 rounded-3xl bg-slate-50 p-4">
                      <input type="hidden" name="id" value={part.id} />
                      <input type="hidden" name="return_path" value={currentAdminReturnPath} />
                      <input
                        type="hidden"
                        name="lesson_group_id"
                        value={lessonGroup.id}
                      />
                      <input
                        type="hidden"
                        name="parasha_name"
                        value={selectedParasha?.name ?? ''}
                      />
                      <input
                        type="hidden"
                        name="section_name"
                        value={selectedSection?.name ?? ''}
                      />
                      <input
                        type="hidden"
                        name="current_audio_url"
                        value={part.audio_url ?? ''}
                      />
                      <input
                        type="hidden"
                        name="current_video_url"
                        value={part.video_url ?? ''}
                      />
                      <input
                        type="hidden"
                        name="current_duration_seconds"
                        value={part.duration_seconds ?? ''}
                      />
                      <input
                        name="name"
                        defaultValue={part.name}
                        className="rounded-2xl border border-slate-200 px-4 py-3"
                      />
                      <div className="grid gap-3 md:grid-cols-2">
                        <input
                          name="part_order"
                          type="number"
                          defaultValue={part.part_order}
                          className="rounded-2xl border border-slate-200 px-4 py-3"
                        />
                        <select
                          name="media_kind"
                          defaultValue={part.media_kind ?? (part.video_url ? 'video' : 'audio_slides')}
                          className="rounded-2xl border border-slate-200 px-4 py-3"
                        >
                          <option value="audio_slides">אודיו + שקופיות</option>
                          <option value="video">וידאו</option>
                        </select>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <input
                          name="completion_target"
                          type="number"
                          min="1"
                          defaultValue={part.completion_target ?? 3}
                          className="rounded-2xl border border-slate-200 px-4 py-3"
                        />
                        <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                          <input
                            name="is_visible_to_student"
                            type="checkbox"
                            defaultChecked={part.is_visible_to_student ?? true}
                          />
                          להציג לתלמיד
                        </label>
                      </div>
                      <div className="rounded-2xl bg-white p-3 text-sm text-slate-600 ring-1 ring-slate-200">
                        <div>סוג מדיה: {getLessonMediaKindLabel(part.media_kind === 'video' || part.video_url ? 'video' : 'audio_slides')}</div>
                        <div className="mt-2 break-all">
                          {part.video_url
                            ? `וידאו משויך: ${part.video_url}`
                            : part.audio_url
                              ? `אודיו משויך: ${part.audio_url}`
                              : 'עדיין לא הוגדרה מדיה. פתח את הקטע בצד שמאל כדי לשייך קובץ.'}
                        </div>
                        <div className="mt-2">
                          משך המדיה:{' '}
                          <AudioDuration
                            src={part.video_url ?? part.audio_url}
                            kind={part.video_url ? 'video' : 'audio'}
                            fallback="ללא מדיה"
                            loadingLabel={part.video_url ? 'טוען משך וידאו...' : 'טוען משך אודיו...'}
                          />
                        </div>
                      </div>
                      <label className="flex items-center gap-3 text-sm text-slate-700">
                        <input
                          name="is_full_reading"
                          type="checkbox"
                          defaultChecked={part.is_full_reading}
                        />
                        סימון כקריאה מלאה
                      </label>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <button
                          type="submit"
                          className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
                        >
                          שמירת מבנה
                        </button>
                        <div className="grid gap-3 md:grid-cols-2">
                          <Link
                            href={`/admin?parashaId=${activeParashaId ?? ''}&sectionId=${activeSectionId ?? ''}&partId=${part.id}#content-editor`}
                            className="rounded-2xl bg-blue-600 px-4 py-3 text-center text-sm font-semibold text-white"
                          >
                            עריכת מדיה
                          </Link>
                          <button
                            formAction={deleteLessonPart}
                            type="submit"
                            className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white"
                          >
                            מחיקת תת־חלק
                          </button>
                        </div>
                      </div>
                    </form>
                  ))}
                </div>

                <form action={upsertLessonPart} className="mt-6 grid gap-3 rounded-3xl bg-slate-50 p-4">
                  <h4 className="text-lg font-semibold text-slate-900">הוספת תת־חלק חדש</h4>
                  <input type="hidden" name="lesson_group_id" value={lessonGroup.id} />
                  <input
                    type="hidden"
                    name="parasha_name"
                    value={selectedParasha?.name ?? ''}
                  />
                  <input
                    type="hidden"
                    name="section_name"
                    value={selectedSection?.name ?? ''}
                  />
                  <input type="hidden" name="current_audio_url" value="" />
                  <input type="hidden" name="current_video_url" value="" />
                  <input type="hidden" name="current_duration_seconds" value="" />
                  <input
                    name="name"
                    placeholder="למשל: ראשון-4"
                    className="rounded-2xl border border-slate-200 px-4 py-3"
                  />
                  <div className="grid gap-3 md:grid-cols-2">
                    <input
                      name="part_order"
                      type="number"
                      placeholder="סדר תצוגה"
                      className="rounded-2xl border border-slate-200 px-4 py-3"
                    />
                    <select
                      name="media_kind"
                      defaultValue="audio_slides"
                      className="rounded-2xl border border-slate-200 px-4 py-3"
                    >
                      <option value="audio_slides">אודיו + שקופיות</option>
                      <option value="video">וידאו</option>
                    </select>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <input
                      name="completion_target"
                      type="number"
                      min="1"
                      defaultValue={3}
                      className="rounded-2xl border border-slate-200 px-4 py-3"
                    />
                    <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                      <input
                        name="is_visible_to_student"
                        type="checkbox"
                        defaultChecked
                      />
                      להציג לתלמיד
                    </label>
                  </div>
                  <label className="flex items-center gap-3 text-sm text-slate-700">
                    <input name="is_full_reading" type="checkbox" />
                    סימון כקריאה מלאה
                  </label>
                  <button
                    type="submit"
                    className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white"
                  >
                    הוספת תת־חלק
                  </button>
                </form>
              </div>

              <div>
                <h3 className="text-xl font-bold text-slate-900">מדיה לקטע הנבחר</h3>
                {activePartId ? (
                  <>
                    <form action={upsertLessonPart} className="mt-4 grid gap-3 rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200">
                      <h4 className="text-lg font-semibold text-slate-900">
                        מדיה עבור {selectedPart?.name}
                      </h4>
                      <input type="hidden" name="id" value={selectedPart?.id ?? ''} />
                      <input
                        type="hidden"
                        name="lesson_group_id"
                        value={lessonGroup.id}
                      />
                      <input
                        type="hidden"
                        name="parasha_name"
                        value={selectedParasha?.name ?? ''}
                      />
                      <input
                        type="hidden"
                        name="section_name"
                        value={selectedSection?.name ?? ''}
                      />
                      <input
                        type="hidden"
                        name="name"
                        value={selectedPart?.name ?? ''}
                      />
                      <input
                        type="hidden"
                        name="part_order"
                        value={selectedPart?.part_order ?? ''}
                      />
                      <input
                        type="hidden"
                        name="completion_target"
                        value={selectedPart?.completion_target ?? 3}
                      />
                      <input
                        type="hidden"
                        name="media_kind"
                        value={selectedPartMediaKind}
                      />
                      {(selectedPart?.is_visible_to_student ?? true) ? (
                        <input type="hidden" name="is_visible_to_student" value="on" />
                      ) : null}
                      <input
                        type="hidden"
                        name="current_audio_url"
                        value={selectedPart?.audio_url ?? ''}
                      />
                      <input
                        type="hidden"
                        name="current_video_url"
                        value={selectedPart?.video_url ?? ''}
                      />
                      <input
                        type="hidden"
                        name="current_duration_seconds"
                        value={selectedPart?.duration_seconds ?? ''}
                      />
                      {selectedPart?.is_full_reading ? (
                        <input type="hidden" name="is_full_reading" value="on" />
                      ) : null}
                      {selectedPartMediaKind === 'video' ? (
                        <>
                          <DirectVideoUpload
                            lessonPartId={selectedPart?.id ?? 0}
                            parashaName={selectedParasha?.name ?? ''}
                            sectionName={selectedSection?.name ?? ''}
                            partName={selectedPart?.name ?? ''}
                            partOrder={selectedPart?.part_order ?? 0}
                            initialVideoUrl={selectedPart?.video_url ?? ''}
                          />
                        </>
                      ) : (
                        <>
                          <label className="grid gap-2 text-sm font-medium text-slate-700">
                            <span>בחירת קובץ אודיו</span>
                            <input
                              name="audio_file"
                              type="file"
                              accept="audio/*"
                              className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3"
                            />
                          </label>
                          <input
                            name="audio_url"
                            defaultValue={selectedPart?.audio_url ?? ''}
                            placeholder="/Audio/example.mp3"
                            className="rounded-2xl border border-slate-200 px-4 py-3"
                          />
                        </>
                      )}
                      <div className="rounded-2xl bg-white p-3 text-sm text-slate-600 ring-1 ring-slate-200">
                        {selectedPartMediaKind === 'video'
                          ? selectedPart?.video_url ?? 'אין עדיין קובץ וידאו משויך'
                          : selectedPart?.audio_url ?? 'אין עדיין קובץ אודיו משויך'}
                      </div>
                      <div className="rounded-2xl bg-white p-3 text-sm text-slate-700 ring-1 ring-slate-200">
                        משך המדיה:{' '}
                        <AudioDuration
                          src={selectedPart?.video_url ?? selectedPart?.audio_url}
                          kind={selectedPartMediaKind === 'video' ? 'video' : 'audio'}
                          fallback={selectedPartMediaKind === 'video' ? 'אין וידאו' : 'אין אודיו'}
                          loadingLabel={selectedPartMediaKind === 'video' ? 'טוען משך וידאו...' : 'טוען משך אודיו...'}
                        />
                      </div>
                      {selectedPartMediaKind === 'video' && selectedPart?.video_url ? (
                        <video controls className="w-full rounded-2xl" src={selectedPart.video_url} />
                      ) : selectedPart?.audio_url ? (
                        <audio controls className="w-full" src={selectedPart.audio_url} />
                      ) : null}
                      <button
                        type="submit"
                        className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
                      >
                        {selectedPartMediaKind === 'video' ? 'שמירת וידאו לקטע' : 'שמירת אודיו לקטע'}
                      </button>
                    </form>

                    {selectedPartMediaKind === 'audio_slides' ? (
                      <>
                        <div className="mt-4 space-y-4">
                          {lessonSlides.map((slide) => (
                            <form key={slide.id} action={upsertLessonSlide} className="grid gap-3 rounded-3xl bg-slate-50 p-4">
                              <input type="hidden" name="id" value={slide.id} />
                              <input
                                type="hidden"
                                name="lesson_part_id"
                                value={activePartId}
                              />
                              <input
                                type="hidden"
                                name="parasha_name"
                                value={selectedParasha?.name ?? ''}
                              />
                              <input
                                type="hidden"
                                name="section_name"
                                value={selectedSection?.name ?? ''}
                              />
                              <input
                                type="hidden"
                                name="part_name"
                                value={selectedPart?.name ?? ''}
                              />
                              <label className="grid gap-2 text-sm font-medium text-slate-700">
                                <span>בחירת קובץ תמונה</span>
                                <input
                                  name="image_file"
                                  type="file"
                                  accept="image/*"
                                  className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3"
                                />
                              </label>
                              <input
                                name="image_url"
                                defaultValue={slide.image_url}
                                placeholder="/images/example.jpg"
                                className="rounded-2xl border border-slate-200 px-4 py-3"
                              />
                              {slide.image_url ? (
                                <div className="rounded-2xl bg-white p-3 text-sm text-slate-600 ring-1 ring-slate-200">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={slide.image_url}
                                    alt={slide.image_url}
                                    className="h-40 w-full rounded-2xl object-contain bg-slate-50"
                                  />
                                  <p className="mt-3 break-all">{slide.image_url}</p>
                                </div>
                              ) : null}
                              <div className="grid gap-3 md:grid-cols-2">
                                <input
                                  name="slide_index"
                                  type="number"
                                  defaultValue={slide.slide_index}
                                  className="rounded-2xl border border-slate-200 px-4 py-3"
                                />
                                <input
                                  name="start_second"
                                  type="number"
                                  defaultValue={slide.start_second}
                                  className="rounded-2xl border border-slate-200 px-4 py-3"
                                />
                              </div>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <button
                                  type="submit"
                                  className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
                                >
                                  שמירת שקופית
                                </button>
                                <button
                                  formAction={deleteLessonSlide}
                                  type="submit"
                                  className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white"
                                >
                                  מחיקת שקופית
                                </button>
                              </div>
                            </form>
                          ))}
                        </div>

                        <form action={upsertLessonSlide} className="mt-6 grid gap-3 rounded-3xl bg-slate-50 p-4">
                          <h4 className="text-lg font-semibold text-slate-900">הוספת שקופית</h4>
                          <input type="hidden" name="lesson_part_id" value={activePartId} />
                          <input
                            type="hidden"
                            name="parasha_name"
                            value={selectedParasha?.name ?? ''}
                          />
                          <input
                            type="hidden"
                            name="section_name"
                            value={selectedSection?.name ?? ''}
                          />
                          <input
                            type="hidden"
                            name="part_name"
                            value={selectedPart?.name ?? ''}
                          />
                          <label className="grid gap-2 text-sm font-medium text-slate-700">
                            <span>בחירת קובץ תמונה</span>
                            <input
                              name="image_file"
                              type="file"
                              accept="image/*"
                              className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3"
                            />
                          </label>
                          <input
                            name="image_url"
                            placeholder="/images/bereshit_r1_1_0.jpg"
                            className="rounded-2xl border border-slate-200 px-4 py-3"
                          />
                          <div className="grid gap-3 md:grid-cols-2">
                            <input
                              name="slide_index"
                              type="number"
                              placeholder="מספר שקופית"
                              className="rounded-2xl border border-slate-200 px-4 py-3"
                            />
                            <input
                              name="start_second"
                              type="number"
                              placeholder="שנייה להתחלה"
                              className="rounded-2xl border border-slate-200 px-4 py-3"
                            />
                          </div>
                          <button
                            type="submit"
                            className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white"
                          >
                            הוספת שקופית
                          </button>
                        </form>
                      </>
                    ) : (
                      <div className="mt-4 rounded-3xl bg-slate-50 p-4 text-sm text-slate-600">
                        כשהקטע מוגדר כווידאו, לא משייכים לו אודיו או שקופיות.
                      </div>
                    )}
                  </>
                ) : (
                  <div className="mt-4 rounded-3xl bg-slate-50 p-4 text-sm text-slate-600">
                    בחר תת־חלק כדי לערוך את השקופיות שלו.
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </section>

      </div>
    </main>
  )
}
