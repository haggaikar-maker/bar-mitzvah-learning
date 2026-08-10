import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'מדיניות פרטיות',
  description: 'מדיניות הפרטיות של מערכת תרגול לבר מצווה',
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#f7f4ec] px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-4xl rounded-[2.5rem] bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-sky-700">מערכת תרגול לבר מצווה</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
              מדיניות פרטיות
            </h1>
          </div>
          <Link
            href="/"
            className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
          >
            חזרה להתחברות
          </Link>
        </div>

        <div className="mt-8 space-y-6 text-right text-base leading-8 text-slate-700">
          <p>
            מערכת זו נועדה לסייע לתלמידים, מלמדים ומנהלים בתרגול קריאה לבר מצווה,
            כולל ניהול קטעים, קישורים אישיים, הקלטות, תזכורות ו־WhatsApp.
          </p>

          <section>
            <h2 className="text-xl font-bold text-slate-900">איזה מידע נשמר</h2>
            <p className="mt-2">
              המערכת עשויה לשמור פרטים כגון שם תלמיד, שם משתמש, מספר WhatsApp,
              תאריכי לידה וקריאה, שיוך לפרשה, נתוני תרגול, השלמות, הקלטות תלמיד,
              וקישורי גישה אישיים לקטעי לימוד.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900">למה המידע משמש</h2>
            <p className="mt-2">
              המידע נשמר כדי לאפשר גישה אישית לתכני הלימוד, מעקב אחרי תרגולים,
              שליחת תזכורות, וניהול תהליך ההכנה לקריאה בתורה על ידי המלמד או המנהל.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900">שיתוף מידע</h2>
            <p className="mt-2">
              המידע אינו מיועד למכירה לצדדים שלישיים. מידע רלוונטי עשוי להיות
              מועבר לשירותים טכניים הנדרשים להפעלת המערכת, כגון אחסון קבצים,
              מסד נתונים ושירותי שליחת הודעות.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900">אבטחה</h2>
            <p className="mt-2">
              אנו נוקטים באמצעים סבירים להגנה על נתוני המשתמשים, אך אין אפשרות
              להבטיח אבטחה מוחלטת של כל מערכת מקוונת.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900">יצירת קשר</h2>
            <p className="mt-2">
              לבקשות בנושא פרטיות, תיקון מידע או שאלות כלליות ניתן ליצור קשר
              בכתובת הדוא&quot;ל: <a className="font-semibold text-sky-700" href="mailto:haggaikar@gmail.com">haggaikar@gmail.com</a>
            </p>
          </section>

          <p className="border-t border-slate-200 pt-4 text-sm text-slate-500">
            מסמך זה הוא מסמך בסיסי לצורך הפעלת המערכת וניתן לעדכון בעתיד בהתאם
            להתרחבות השימוש או דרישות רגולטוריות.
          </p>
        </div>
      </div>
    </main>
  )
}
