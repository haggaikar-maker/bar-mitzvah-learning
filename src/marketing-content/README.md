# תוכן שיווקי מקומי

כל הטקסטים המרכזיים של דף הנחיתה מרוכזים בקובץ:

- `C:\Tora\bar-mitzvah-learning\src\marketing-content\landing-page-content.ts`

שם אפשר לשנות:

- כותרות
- פסקאות
- כפתורים
- נתיבי תמונות
- כרטיסי יתרונות
- שלבי תהליך

דף הנחיתה עצמו נמצא כאן:

- `C:\Tora\bar-mitzvah-learning\src\app\landing\page.tsx`

## איך מחליפים טקסטים

1. פותחים את `landing-page-content.ts`
2. מאתרים את האזור הרצוי, למשל `hero`, `story`, `highlights`
3. משנים את הטקסט בעברית ושומרים

## איך מחליפים תמונות

מומלץ להעלות את התמונות החדשות לתקייה:

- `C:\Tora\bar-mitzvah-learning\public\marketing-ui\`

אחר כך מעדכנים את הנתיב בקובץ `landing-page-content.ts`, למשל:

- `'/marketing-ui/hero-main.jpg'`
- `'/marketing-ui/whatsapp-preview.jpg'`
- `'/marketing-ui/family-legacy.jpg'`

כרגע הדף משתמש בתמונות הקיימות של המערכת כדי לעלות מיד בלי להמתין לנכסים חדשים.

## מה חשוב לדעת

- הנתיבים של תמונות ב־Next מתחילים ב־`/`
- כל קובץ שתשים בתוך `public` נהיה נגיש לאתר
- אם מחליפים שם קובץ, צריך לעדכן גם את הנתיב בקובץ התוכן

## סדר עבודה מומלץ

1. לבחור תמונות ולשים אותן ב־`public/marketing-ui`
2. לעדכן את הטקסטים בקובץ התוכן
3. לבדוק מקומית ב־`/landing`
4. להעלות ל־GitHub ולתת ל־Vercel לפרסם
