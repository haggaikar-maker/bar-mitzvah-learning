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
          <div className="grid gap-0 lg:grid-cols-[1.08fr_0.92fr]">
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

            <div className="relative min-h-[320px] overflow-hidden lg:min-h-full">
              <div
                className="absolute inset-0"
                style={{
                  background: `linear-gradient(140deg, rgba(242,161,74,0.74), rgba(255,211,92,0.42), rgba(111,153,187,0.46)), url('${hero.heroImageUrl}') center/cover`,
                }}
              />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(36,63,88,0.1),rgba(36,63,88,0.3))]" />
              <div className="relative z-10 flex h-full min-h-[320px] items-end p-6 sm:p-8">
                <div className="max-w-sm rounded-[2rem] bg-white/84 p-5 shadow-[0_20px_50px_rgba(36,63,88,0.18)] backdrop-blur">
                  <p className="text-sm font-black text-slate-900">
                    תלמיד, מלמד, משפחה ו־WhatsApp באותה שפה.
                  </p>
                  <p className="mt-2 text-sm leading-7 text-slate-700">
                    בונים ספריית לימוד מסודרת, פותחים קטעים בהדרגה, שומרים הקלטות ומלווים את הדרך עד העלייה לתורה.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
          <div className={`${sectionCardClasses}`}>
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

          <div
            className="relative min-h-[340px] overflow-hidden rounded-[2.5rem] border border-amber-100 shadow-[0_22px_64px_rgba(36,63,88,0.12)]"
            style={{
              background: `linear-gradient(145deg, rgba(255,211,92,0.18), rgba(36,63,88,0.08)), url('${imageSlots.teacherShowcaseImageUrl}') center/cover`,
            }}
          >
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(36,63,88,0.26))]" />
            <div className="relative z-10 flex h-full items-end justify-start p-6">
              <div className="max-w-sm rounded-[1.9rem] bg-white/90 p-5 backdrop-blur">
                <p className="text-sm font-black text-slate-900">דשבורד מלמד</p>
                <p className="mt-2 text-sm leading-7 text-slate-700">
                  שליטה בתוכן, בתלמידים, במדיה ובתזכורות בלי לעבור בין כמה מערכות.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section
          id={studentSection.id}
          className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]"
        >
          <div
            className="relative min-h-[320px] overflow-hidden rounded-[2.5rem] border border-sky-100 shadow-[0_22px_64px_rgba(36,63,88,0.12)]"
            style={{
              background: `linear-gradient(145deg, rgba(111,153,187,0.22), rgba(255,255,255,0.18)), url('${imageSlots.studentShowcaseImageUrl}') center/cover`,
            }}
          >
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(36,63,88,0.22))]" />
            <div className="relative z-10 flex h-full items-end p-6">
              <div className="max-w-sm rounded-[1.8rem] bg-white/88 p-5 backdrop-blur">
                <p className="text-sm font-black text-slate-900">חוויית תלמיד</p>
                <p className="mt-2 text-sm leading-7 text-slate-700">
                  מסך ממוקד לפלאפון, עם קטע ברור, מדיה מתאימה, הקלטה עצמית ותזכורת למה ללמוד עכשיו.
                </p>
              </div>
            </div>
          </div>

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

          <div
            className="relative min-h-[360px] overflow-hidden rounded-[2.5rem] border border-emerald-100 shadow-[0_22px_64px_rgba(36,63,88,0.12)]"
            style={{
              background: `linear-gradient(145deg, rgba(255,211,92,0.2), rgba(111,153,187,0.24)), url('${imageSlots.whatsappShowcaseImageUrl}') center/cover`,
            }}
          >
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(36,63,88,0.06),rgba(36,63,88,0.28))]" />
            <div className="relative z-10 flex h-full items-end justify-end p-6">
              <div className="max-w-sm rounded-[1.9rem] bg-slate-900/88 p-5 text-white backdrop-blur">
                <p className="text-sm font-black tracking-[0.12em] text-amber-300">
                  תרחיש אמיתי
                </p>
                <p className="mt-3 text-lg font-black">
                  &quot;שלום, היום כדאי לתרגל את חלק שלישי&quot;
                </p>
                <p className="mt-2 text-sm leading-7 text-white/90">
                  התלמיד מקבל קישור מדויק, תפריט, סטטיסטיקות וקשר ישיר עם המלמד בלי לחפש חומרים.
                </p>
              </div>
            </div>
          </div>
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
          <div
            className="relative min-h-[340px] overflow-hidden rounded-[2.5rem] border border-slate-200 shadow-[0_22px_64px_rgba(36,63,88,0.12)]"
            style={{
              background: `linear-gradient(145deg, rgba(242,161,74,0.24), rgba(36,63,88,0.1)), url('${imageSlots.legacyShowcaseImageUrl}') center/cover`,
            }}
          >
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(36,63,88,0.12),rgba(36,63,88,0.36))]" />
            <div className="relative z-10 flex h-full items-end p-6">
              <div className="max-w-md rounded-[1.9rem] bg-white/88 p-5 backdrop-blur">
                <p className="text-sm font-black text-slate-900">זיכרון שנשאר</p>
                <p className="mt-2 text-sm leading-7 text-slate-700">
                  הקלטה של אבא, סבא או מלמד אהוב יכולה להפוך לנכס משפחתי שחוזר שוב בכל דור.
                </p>
              </div>
            </div>
          </div>

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
