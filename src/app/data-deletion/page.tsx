import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'מחיקת נתונים',
  description: 'הנחיות להגשת בקשה למחיקת נתונים במערכת תרגול לבר מצווה',
}

export default function DataDeletionPage() {
  return (
    <main className="min-h-screen bg-[#f7f4ec] px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-4xl rounded-[2.5rem] bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-sky-700">מערכת תרגול לבר מצווה</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
              מחיקת נתונים
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
            אם ברצונך לבקש מחיקה של מידע אישי מתוך המערכת, ניתן לפנות בדוא&quot;ל
            לכתובת <a className="font-semibold text-sky-700" href="mailto:haggaikar@gmail.com">haggaikar@gmail.com</a>.
          </p>

          <section>
            <h2 className="text-xl font-bold text-slate-900">מה לכלול בבקשה</h2>
            <p className="mt-2">
              כדי שנוכל לאתר את המידע הרלוונטי במהירות, מומלץ לציין בבקשה:
            </p>
            <ul className="mt-3 list-disc space-y-2 pr-6">
              <li>שם התלמיד או המשתמש</li>
              <li>שם המשתמש במערכת, אם קיים</li>
              <li>מספר הטלפון או מספר ה־WhatsApp הרלוונטי</li>
              <li>פירוט קצר של סוג המידע שברצונך למחוק</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900">מה יימחק</h2>
            <p className="mt-2">
              בכפוף לבקשה ולזיהוי סביר של המשתמש, ניתן למחוק או להסיר מידע כגון
              פרטי תלמיד, הקלטות, נתוני תרגול, שיוכים לפרשות, וקישורי גישה אישיים,
              בהתאם למידע הקיים במערכת ובהתאם למגבלות טכניות או חוקיות.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900">זמן טיפול</h2>
            <p className="mt-2">
              בקשות מחיקה יטופלו בתוך זמן סביר לאחר קבלתן ואימות פרטי הפונה.
            </p>
          </section>

          <p className="border-t border-slate-200 pt-4 text-sm text-slate-500">
            מסמך זה נועד לאפשר הגדרה מסודרת של מחיקת נתונים עבור שירותי Meta
            ושירותים מחוברים נוספים.
          </p>
        </div>
      </div>
    </main>
  )
}
