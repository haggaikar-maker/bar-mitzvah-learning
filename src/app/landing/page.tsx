import Link from 'next/link'
import type { Metadata } from 'next'
import { PendingSubmitButton } from '@/src/components/pending-submit-button'
import { MarketingScreenshotFrame } from '@/src/components/marketing-screenshot-frame'
import { landingPageContent } from '../../marketing-content/landing-page-content'
import { sendMarketingWhatsAppDemo, submitMarketingLead } from './actions'

export const metadata: Metadata = {
  title: 'דף נחיתה | תרגול לבר מצווה',
  description:
    'מערכת דיגיטלית לליווי לימוד בר מצווה עם אזור תלמיד, אזור מלווה, WhatsApp והשארת פרטים.',
}

type LandingPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const cardClasses =
  'rounded-[2.2rem] border border-slate-200 bg-white/90 p-6 shadow-[0_20px_60px_rgba(36,63,88,0.08)] backdrop-blur sm:p-8'

function readSearchParam(
  searchParams: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = searchParams[key]
  return Array.isArray(value) ? value[0] : value
}

function StatusMessage({
  message,
  tone,
}: {
  message: string | null
  tone: 'success' | 'error'
}) {
  if (!message) {
    return null
  }

  return (
    <div
      className={`rounded-[1.4rem] px-4 py-3 text-sm font-bold ${
        tone === 'success'
          ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200'
          : 'bg-rose-50 text-rose-800 ring-1 ring-rose-200'
      }`}
    >
      {message}
    </div>
  )
}

export default async function LandingPage({ searchParams }: LandingPageProps) {
  const resolvedSearchParams = await searchParams
  const waStatus = readSearchParam(resolvedSearchParams, 'waStatus')
  const waMessage = readSearchParam(resolvedSearchParams, 'waMessage')
  const leadStatus = readSearchParam(resolvedSearchParams, 'leadStatus')
  const leadMessage = readSearchParam(resolvedSearchParams, 'leadMessage')

  const { general, student, guide, whatsapp, contact } = landingPageContent

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fff9ef_0%,#fffdf8_48%,#eef5fa_100%)] px-4 py-5 text-slate-900 sm:px-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <section id={general.id} className={cardClasses}>
          <div className="mx-auto max-w-4xl text-center">
            <h1 className="text-3xl font-black tracking-tight text-slate-950 sm:text-5xl">
              {general.title}
            </h1>
            <p className="mx-auto mt-4 max-w-3xl text-base leading-8 text-slate-700 sm:text-lg">
              {general.description}
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              {general.quickLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-full bg-slate-900 px-5 py-3 text-sm font-black text-white transition hover:-translate-y-0.5"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section
          id={student.id}
          className="grid gap-5 rounded-[2.2rem] border border-slate-200 bg-white/84 p-5 shadow-[0_20px_60px_rgba(36,63,88,0.08)] sm:p-6 lg:grid-cols-[0.94fr_1.06fr]"
        >
          <div className="flex flex-col justify-between gap-4">
            <div>
              <h2 className="text-3xl font-black tracking-tight text-slate-950">
                {student.title}
              </h2>
              <p className="mt-4 text-base leading-8 text-slate-700">
                {student.textPrimary}
              </p>
            </div>

            <Link
              href={student.demoLink.href}
              className="inline-flex w-fit rounded-full bg-slate-900 px-6 py-3 text-sm font-black text-white transition hover:-translate-y-0.5"
            >
              {student.demoLink.label}
            </Link>

            <p className="text-base leading-8 text-slate-700">
              {student.textSecondary}
            </p>
          </div>

          <MarketingScreenshotFrame
            src={student.imageUrl}
            alt={student.imageAlt}
            label={student.imageLabel}
            caption={student.imageCaption}
            viewportClassName="h-[460px] sm:h-[620px] lg:h-[780px]"
          />
        </section>

        <section
          id={guide.id}
          className="grid gap-5 rounded-[2.2rem] border border-slate-200 bg-white/84 p-5 shadow-[0_20px_60px_rgba(36,63,88,0.08)] sm:p-6 lg:grid-cols-[1.02fr_0.98fr]"
        >
          <div className="flex flex-col justify-center">
            <h2 className="text-3xl font-black tracking-tight text-slate-950">
              {guide.title}
            </h2>
            <p className="mt-4 text-base leading-8 text-slate-700">
              {guide.description}
            </p>
          </div>

          <MarketingScreenshotFrame
            src={guide.imageUrl}
            alt={guide.imageAlt}
            label={guide.imageLabel}
            caption={guide.imageCaption}
            viewportClassName="h-[260px] sm:h-[320px] lg:h-[360px]"
          />
        </section>

        <section
          id={whatsapp.id}
          className="grid gap-5 rounded-[2.2rem] border border-slate-200 bg-white/84 p-5 shadow-[0_20px_60px_rgba(36,63,88,0.08)] sm:p-6 lg:grid-cols-[0.92fr_1.08fr]"
        >
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-3xl font-black tracking-tight text-slate-950">
                {whatsapp.title}
              </h2>
              <p className="mt-4 text-base leading-8 text-slate-700">
                {whatsapp.description}
              </p>
            </div>

            <StatusMessage
              message={waMessage ?? null}
              tone={waStatus === 'success' ? 'success' : 'error'}
            />

            <form action={sendMarketingWhatsAppDemo} className="rounded-[1.8rem] bg-slate-50 p-4 ring-1 ring-slate-200">
              <div className="grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-slate-700">
                    {whatsapp.countryCodeFieldLabel}
                  </span>
                  <input
                    type="tel"
                    name="countryCode"
                    inputMode="numeric"
                    defaultValue={whatsapp.defaultCountryCode}
                    placeholder={whatsapp.countryCodeFieldPlaceholder}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none"
                    dir="ltr"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-slate-700">
                    {whatsapp.phoneFieldLabel}
                  </span>
                  <input
                    type="tel"
                    name="phone"
                    inputMode="numeric"
                    placeholder={whatsapp.phoneFieldPlaceholder}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none"
                    dir="ltr"
                  />
                </label>
              </div>

              <div className="mt-4">
                <PendingSubmitButton
                  label={whatsapp.submitLabel}
                  pendingLabel="שולח..."
                  overlayLabel="שולח הודעת דמו..."
                  overlaySubtitle="מכין גישת WhatsApp זמנית לתלמיד לדוגמה"
                  className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white disabled:cursor-wait disabled:opacity-80"
                />
              </div>
            </form>

            <p className="text-sm leading-7 text-slate-600">{whatsapp.helperText}</p>
          </div>

          <MarketingScreenshotFrame
            src={whatsapp.imageUrl}
            alt={whatsapp.imageAlt}
            label={whatsapp.imageLabel}
            caption={whatsapp.imageCaption}
            viewportClassName="h-[460px] sm:h-[620px] lg:h-[780px]"
          />
        </section>

        <section
          id={contact.id}
          className="grid gap-5 rounded-[2.2rem] border border-slate-200 bg-white/84 p-5 shadow-[0_20px_60px_rgba(36,63,88,0.08)] sm:p-6 lg:grid-cols-[1fr_1fr]"
        >
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-3xl font-black tracking-tight text-slate-950">
                {contact.title}
              </h2>
              <p className="mt-4 text-base leading-8 text-slate-700">
                {contact.description}
              </p>
            </div>

            <StatusMessage
              message={leadMessage ?? null}
              tone={leadStatus === 'success' ? 'success' : 'error'}
            />

            <form action={submitMarketingLead} className="rounded-[1.8rem] bg-slate-50 p-4 ring-1 ring-slate-200">
              <h3 className="text-xl font-black text-slate-950">
                {contact.formTitle}
              </h3>

              <div className="mt-4 grid gap-3">
                <input
                  type="text"
                  name="name"
                  placeholder={contact.nameLabel}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none"
                />

                <select
                  name="role"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none"
                  defaultValue=""
                >
                  <option value="" disabled>
                    {contact.roleLabel}
                  </option>
                  {contact.roleOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>

                <input
                  type="tel"
                  name="phone"
                  placeholder={contact.phoneLabel}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none"
                />

                <input
                  type="email"
                  name="email"
                  placeholder={contact.emailLabel}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none"
                />

                <textarea
                  name="notes"
                  placeholder={contact.notesPlaceholder}
                  rows={6}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-7 outline-none"
                />
              </div>

              <div className="mt-4">
                <PendingSubmitButton
                  label={contact.submitLabel}
                  pendingLabel="שולח..."
                  overlayLabel="שולח פרטים..."
                  overlaySubtitle="שומר את הפרטים ומכין חזרה מסודרת"
                  className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white disabled:cursor-wait disabled:opacity-80"
                />
              </div>
            </form>
          </div>

          <div className="flex flex-col justify-between gap-4 rounded-[1.8rem] bg-[linear-gradient(180deg,#fefaf0_0%,#eef5fa_100%)] p-5 ring-1 ring-slate-200">
            <div>
              <h3 className="text-2xl font-black tracking-tight text-slate-950">
                {contact.aboutProjectTitle}
              </h3>
              <p className="mt-4 text-base leading-8 text-slate-700">
                {contact.aboutProjectText}
              </p>
            </div>

            <div className="rounded-[1.6rem] bg-white px-5 py-4 ring-1 ring-slate-200">
              <p className="text-sm font-bold leading-7 text-slate-700">
                אפשר להתאים את כל הטקסטים, הלינקים, שמות ה־template, ה־demo student, הכותרות וההסברים ישירות מתוך קובץ התוכן השיווקי.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
