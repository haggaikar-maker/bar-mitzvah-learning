import Image from 'next/image'
import Link from 'next/link'
import type { Metadata } from 'next'
import { landingPageContent } from '../../marketing-content/landing-page-content'

export const metadata: Metadata = {
  title: 'דף נחיתה | תרגול לבר מצווה',
  description:
    'מערכת ללימוד בר מצווה עם שליטת מלמד, מעקב תלמידים, תזכורות WhatsApp ושמירת הקלטות משפחתיות.',
}

const sectionCardClasses =
  'rounded-[2rem] border border-white/60 bg-white/80 p-6 shadow-[0_20px_60px_rgba(36,63,88,0.08)] backdrop-blur'

type ScreenshotFrameProps = {
  src: string
  alt: string
  label: string
  caption: string
  viewportClassName: string
}

function ScreenshotFrame({
  src,
  alt,
  label,
  caption,
  viewportClassName,
}: ScreenshotFrameProps) {
  return (
    <div className="rounded-[2.4rem] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbfd_100%)] p-3 shadow-[0_22px_64px_rgba(36,63,88,0.12)]">
      <div className="flex items-center justify-between rounded-[1.4rem] bg-slate-900 px-4 py-3 text-white">
        <span className="text-sm font-black tracking-[0.14em] text-amber-300">
          {label}
        </span>
        <span className="text-xs font-bold text-white/70">צילום מסך אמיתי</span>
      </div>

      <div className="mt-3 rounded-[2rem] bg-[radial-gradient(circle_at_top_right,rgba(255,211,92,0.16),transparent_28%),linear-gradient(180deg,#fdfdfd_0%,#eef5fa_100%)] p-3">
        <div
          className={`relative overflow-hidden rounded-[1.7rem] border border-slate-200 bg-white ${viewportClassName}`}
        >
          <Image
            src={src}
            alt={alt}
            fill
            sizes="(max-width: 1024px) 100vw, 50vw"
            className="object-contain object-center"
          />
        </div>
      </div>

      <p className="px-2 pt-4 text-sm leading-7 text-slate-600">{caption}</p>
    </div>
  )
}

export default function LandingPage() {
  const {
    hero,
    story,
    experienceCards,
    highlights,
    journey,
    imageSlots,
    studentSection,
    whatsappSection,
    legacySection,
    footer,
  } = landingPageContent

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fff9ef_0%,#fffdf8_45%,#eef5fa_100%)] px-4 py-5 text-slate-900 sm:px-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <section className="relative overflow-hidden rounded-[2.75rem] border border-amber-100 bg-white shadow-[0_32px_90px_rgba(36,63,88,0.12)]">
          <div className="grid gap-6 p-4 lg:grid-cols-[1.02fr_0.98fr] lg:p-5">
            <div className="relative px-6 py-8 sm:px-10 sm:py-12">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,211,92,0.18),transparent_32%),radial-gradient(circle_at_bottom_left,rgba(111,153,187,0.18),transparent_28%)]" />
              <div className="relative z-10 max-w-2xl">
                <span className="inline-flex rounded-full bg-slate-900 px-4 py-2 text-xs font-black tracking-[0.18em] text-white">
                  {hero.badge}
                </span>
                <h1 className="mt-5 text-4xl font-black leading-tight tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
                  {hero.title}
                </h1>
                <p className="mt-5 max-w-xl text-lg leading-8 text-slate-700">
                  {hero.description}
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <Link
                    href={hero.primaryCtaHref}
                    className="rounded-full bg-slate-900 px-6 py-3 text-sm font-black text-white transition hover:-translate-y-0.5"
                  >
                    {hero.primaryCtaLabel}
                  </Link>
                  <Link
                    href={hero.secondaryCtaHref}
                    className="rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-bold text-slate-800 transition hover:border-slate-500"
                  >
                    {hero.secondaryCtaLabel}
                  </Link>
                </div>
              </div>
            </div>

            <ScreenshotFrame
              src={hero.heroImageUrl}
              alt="משפחה לומדת יחד לבר מצווה"
              label="אווירה משפחתית"
              caption="כאן אפשר לשים תמונת אווירה ראשית שמספרת מיד את הסיפור: תלמיד, משפחה, מסורת וליווי אישי."
              viewportClassName="h-[300px] sm:h-[360px] lg:h-[520px]"
            />
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
          <div className={sectionCardClasses}>
            <p className="text-sm font-black tracking-[0.16em] text-amber-600">
              תמונת מצב
            </p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
              {story.title}
            </h2>
            <p className="mt-4 text-base leading-8 text-slate-700">
              {story.description}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {story.stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-[2rem] border border-amber-100 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,244,216,0.9))] p-5 text-center shadow-[0_16px_42px_rgba(36,63,88,0.08)]"
              >
                <div className="text-3xl font-black text-slate-950">{stat.value}</div>
                <div className="mt-2 text-sm font-bold text-slate-600">{stat.label}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-3">
          {experienceCards.map((card) => (
            <article key={card.title} className={sectionCardClasses}>
              <p className="text-sm font-black tracking-[0.18em] text-sky-700">
                {card.eyebrow}
              </p>
              <h3 className="mt-3 text-2xl font-black tracking-tight text-slate-950">
                {card.title}
              </h3>
              <p className="mt-3 text-base leading-8 text-slate-700">
                {card.description}
              </p>
            </article>
          ))}
        </section>

        <section className="grid gap-5 lg:grid-cols-[1.02fr_0.98fr]">
          <div className={`${sectionCardClasses} flex flex-col justify-center`}>
            <p className="text-sm font-black tracking-[0.18em] text-amber-600">
              שליטת מלמד
            </p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
              המלמד רואה תמונה מלאה ופותח בדיוק את מה שצריך
            </h2>
            <p className="mt-4 text-base leading-8 text-slate-700">
              מסך הניהול מאפשר להגדיר נוסח, לבנות חלוקה אישית, להעלות אודיו או וידאו, לשלוט במה גלוי לתלמיד ולעקוב אחרי כל תרגול והשלמה במקום אחד.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[1.6rem] bg-white px-5 py-4 text-sm font-bold text-slate-700 ring-1 ring-slate-200">
                ספריות פרשה, חלקים ותתי־חלקים לפי שיטת העבודה של המלמד
              </div>
              <div className="rounded-[1.6rem] bg-slate-900 px-5 py-4 text-sm font-bold text-white">
                מעקב תרגולים, פתיחה והסתרה של קטעים, ושליחה ישירה ל־WhatsApp
              </div>
            </div>
          </div>

          <ScreenshotFrame
            src={imageSlots.teacherShowcaseImageUrl}
            alt="מסך ניהול של המלמד"
            label="דשבורד מלמד"
            caption="תמונה רחבה שמתאימה במיוחד למסך הניהול, עם מקום ברור לראות תלמידים, פרשות, תוכן וסטטיסטיקות."
            viewportClassName="h-[260px] sm:h-[320px] lg:h-[360px]"
          />
        </section>

        <section
          id={studentSection.id}
          className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]"
        >
          <ScreenshotFrame
            src={imageSlots.studentShowcaseImageUrl}
            alt="מסך תלמיד בפלאפון"
            label="מסך תלמיד"
            caption="התצוגה כאן שומרת על כל המסך הארוך של התלמיד בצורה קריאה, בלי לחתוך את הכפתורים או את אזור התרגול."
            viewportClassName="h-[440px] sm:h-[560px] lg:h-[720px]"
          />

          <div className={`${sectionCardClasses} flex flex-col justify-center`}>
            <p className="text-sm font-black tracking-[0.18em] text-amber-600">
              מסך תלמיד
            </p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
              {studentSection.title}
            </h2>
            <p className="mt-4 text-base leading-8 text-slate-700">
              {studentSection.description}
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[1.6rem] bg-slate-900 px-5 py-4 text-sm font-bold text-white">
                אודיו, וידאו, שקופיות והקלטה עצמית באותו מקום
              </div>
              <div className="rounded-[1.6rem] bg-white px-5 py-4 text-sm font-bold text-slate-700 ring-1 ring-slate-200">
                שליטה מדויקת מה גלוי עכשיו ומה ייפתח בהמשך
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[1.02fr_0.98fr]">
          <div className={`${sectionCardClasses} flex flex-col justify-center`}>
            <p className="text-sm font-black tracking-[0.18em] text-sky-700">
              WhatsApp
            </p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
              {whatsappSection.title}
            </h2>
            <p className="mt-4 text-base leading-8 text-slate-700">
              {whatsappSection.description}
            </p>
            <div className="mt-6 grid gap-4">
              {highlights.map((item) => (
                <div
                  key={item.title}
                  className="rounded-[1.75rem] border border-slate-200 bg-white px-5 py-4"
                >
                  <h3 className="text-lg font-black text-slate-900">{item.title}</h3>
                  <p className="mt-2 text-sm leading-7 text-slate-700">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <ScreenshotFrame
            src={imageSlots.whatsappShowcaseImageUrl}
            alt="התכתבות WhatsApp עם התלמיד"
            label="WhatsApp בפועל"
            caption="כאן רואים ממש את חוויית הוואטסאפ: תזכורת, בוט, תפריט וקישור ישיר, בלי שהמסך ייחתך בדרך."
            viewportClassName="h-[440px] sm:h-[560px] lg:h-[720px]"
          />
        </section>

        <section className="rounded-[2.5rem] border border-amber-100 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(248,244,216,0.94))] p-6 shadow-[0_22px_64px_rgba(36,63,88,0.09)] sm:p-8">
          <div className="max-w-3xl">
            <p className="text-sm font-black tracking-[0.18em] text-amber-600">
              תהליך עבודה
            </p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
              ספריית לימוד אחת, הרבה אפשרויות שימוש
            </h2>
          </div>
          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {journey.map((step, index) => (
              <div
                key={step.title}
                className="rounded-[2rem] bg-white/86 p-5 ring-1 ring-white shadow-[0_18px_44px_rgba(36,63,88,0.06)]"
              >
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-sm font-black text-white">
                  {index + 1}
                </div>
                <h3 className="mt-4 text-xl font-black text-slate-950">{step.title}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-700">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          <ScreenshotFrame
            src={imageSlots.legacyShowcaseImageUrl}
            alt="משפחה לומדת מתוך מסורת"
            label="המשכיות משפחתית"
            caption="תמונה רחבה יותר שמתאימה למסרים הרגשיים של המשפחה, הזיכרון והשימור לדורות."
            viewportClassName="h-[280px] sm:h-[340px] lg:h-[420px]"
          />

          <div className={`${sectionCardClasses} flex flex-col justify-center`}>
            <p className="text-sm font-black tracking-[0.18em] text-sky-700">
              הרבה מעבר ליום העלייה
            </p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
              {legacySection.title}
            </h2>
            <p className="mt-4 text-base leading-8 text-slate-700">
              {legacySection.description}
            </p>
            <div className="mt-6 rounded-[1.8rem] bg-slate-900 px-5 py-5 text-white">
              <p className="text-lg font-black">
                בעוד כמה שנים תגיע שוב פרשת השבוע שלו.
              </p>
              <p className="mt-2 text-sm leading-7 text-white/90">
                במקום שזה יישכח, אפשר להזכיר, לרגש, ולפתוח מחדש את הקול, הסרטון והסיפור המשפחתי.
              </p>
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden rounded-[2.75rem] border border-slate-200 bg-slate-900 px-6 py-8 text-white shadow-[0_30px_80px_rgba(36,63,88,0.24)] sm:px-10 sm:py-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,211,92,0.22),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(111,153,187,0.24),transparent_34%)]" />
          <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-sm font-black tracking-[0.18em] text-amber-300">
                מוכנים להתקדם?
              </p>
              <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
                {footer.title}
              </h2>
              <p className="mt-4 text-base leading-8 text-white/88">
                {footer.description}
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href={footer.primaryCtaHref}
                className="rounded-full bg-white px-6 py-3 text-sm font-black text-slate-900 transition hover:-translate-y-0.5"
              >
                {footer.primaryCtaLabel}
              </Link>
              <Link
                href="/admin"
                className="rounded-full border border-white/25 px-6 py-3 text-sm font-bold text-white transition hover:bg-white/10"
              >
                כניסה לאזור ניהול
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
