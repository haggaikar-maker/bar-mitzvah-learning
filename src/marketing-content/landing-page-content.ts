export type LandingSectionCard = {
  eyebrow: string
  title: string
  description: string
}

export type LandingHighlight = {
  title: string
  description: string
}

export type LandingStep = {
  title: string
  description: string
}

export const landingPageContent = {
  hero: {
    badge: 'מערכת דיגיטלית ללימוד בר מצווה',
    title: 'לימוד בר מצווה שמחבר בין תלמיד, מלמד, משפחה ו־WhatsApp במקום אחד.',
    description:
      'מכינים קריאה מדויקת, שומרים הקלטות וסרטונים, שולחים תזכורות חכמות ומלווים את התלמיד צעד אחר צעד עד העלייה לתורה וגם אחריה.',
    primaryCtaLabel: 'כניסה למערכת',
    primaryCtaHref: '/',
    secondaryCtaLabel: 'איך זה נראה לתלמיד',
    secondaryCtaHref: '#student-experience',
    heroImageUrl: '/login-ui/top-banner.jpg',
  },
  story: {
    title: 'לא עוד קבצים מפוזרים וקבוצות בלי סדר',
    description:
      'המערכת מרכזת פרשות, תתי־חלקים, אודיו, וידאו, תמונות, הקלטות תלמיד, מעקב תרגולים ותזכורות WhatsApp. כל תלמיד רואה רק מה שפתוח לו, וכל מלמד עובד בשיטה שמתאימה בדיוק לנוסח ולחלוקה שלו.',
    stats: [
      { value: '1', label: 'בית אחד לניהול הלימוד' },
      { value: 'WhatsApp', label: 'תזכורות ובוט עוזר' },
      { value: 'משפחתי', label: 'שומר מסורת והקלטות לדורות' },
    ],
  },
  experienceCards: [
    {
      eyebrow: 'לתלמיד',
      title: 'מסלול לימוד ברור ופשוט',
      description:
        'רואה רק קטעים פתוחים, מתרגל אודיו או וידאו, מקליט את עצמו ושומר התקדמות בלי עומס ובלי בלבול.',
    },
    {
      eyebrow: 'למלמד',
      title: 'שליטה מלאה בחלוקה ובתוכן',
      description:
        'מגדיר נוסח, בונה מבנה אישי לכל פרשה, מעלה מדיה, פותח קטעים בהדרגה ושולח תזכורות ישירות ל־WhatsApp.',
    },
    {
      eyebrow: 'למשפחה',
      title: 'מעורבות בלי לרדוף אחרי החומר',
      description:
        'כל החומרים זמינים בצורה מסודרת, עם קישורים ישירים ויכולת לשמר קול משפחתי שילמד גם את הדור הבא.',
    },
  ] satisfies LandingSectionCard[],
  highlights: [
    {
      title: 'בוט WhatsApp שמזכיר מה ללמוד היום',
      description:
        'לחיצה אחת מהמלמד או מהמנהל, והתלמיד מקבל קישור ישיר לתת־החלק הרלוונטי עם טקסט ברור והמשך עבודה מיידי.',
    },
    {
      title: 'תזכורת גם אחרי הבר מצווה',
      description:
        'אפשר להזכיר לתלמיד מתי פרשת השבוע שלו חוזרת, כדי להמשיך קשר, רגש וזיכרון גם שנים קדימה.',
    },
    {
      title: 'שומרים את הקול של סבא',
      description:
        'מעלים הקלטות משפחתיות ומחברים בין מסורת, זיכרון ולימוד חי. הנכדים והנינים יוכלו ללמוד מאותו קול בעתיד.',
    },
  ] satisfies LandingHighlight[],
  journey: [
    {
      title: 'המלמד בוחר נוסח ופותח ספריית פרשה',
      description:
        'החלוקה והמדיה נבנות פעם אחת בצורה מסודרת, עם אפשרות להעתיק, להתאים ולשמור ספריות שונות לפי צורך.',
    },
    {
      title: 'התלמיד מקבל מסלול מדויק',
      description:
        'הוא רואה רק מה שרלוונטי אליו, יודע כמה נשאר עד הקריאה, ומתקדם דרך אודיו, וידאו, תמונות והקלטות.',
    },
    {
      title: 'WhatsApp ממשיך את הליווי מחוץ לאתר',
      description:
        'תפריט בוט, תזכורות, הודעות למלמד וקישורים ישירים הופכים את התרגול לזמין גם תוך כדי היום־יום.',
    },
  ] satisfies LandingStep[],
  imageSlots: {
    heroImageUrl: '/marketing-ui/hero-main.jpg',
    studentShowcaseImageUrl: '/marketing-ui/student-screen.jpg',
    teacherShowcaseImageUrl: '/marketing-ui/teacher-dashboard.jpg',
    whatsappShowcaseImageUrl: '/marketing-ui/whatsapp-screen.jpg',
    legacyShowcaseImageUrl: '/marketing-ui/family-legacy.jpg',
  },
  studentSection: {
    id: 'student-experience',
    title: 'חוויה רגועה, צעירה וממוקדת לתלמיד',
    description:
      'המסכים בנויים במיוחד לעבודה מהטלפון: ניווט פשוט, מעט מלל, קטע ברור, סטטוס תרגול, הקלטה עצמית ופתיחת מדיה בגודל נוח.',
  },
  whatsappSection: {
    title: 'WhatsApp כחלק אמיתי מהלימוד',
    description:
      'לא רק הודעות שיווקיות. המלמד יכול לשלוח תזכורת ממוקדת, התלמיד יכול לקבל תפריט קטעים, לראות סטטיסטיקות, ולפנות ישירות למלמד כשצריך.',
  },
  legacySection: {
    title: 'הפרשה נשארת חיה גם במשפחה',
    description:
      'המערכת לא חייבת להיגמר ביום העלייה לתורה. אפשר לשמור בה הקלטות, סרטונים ותוכן משפחתי שילווה את הבית לשנים ארוכות.',
  },
  footer: {
    title: 'רוצים להרגיש איך זה עובד באמת?',
    description:
      'אפשר להיכנס למערכת, לראות את חוויית התלמיד והמלמד, ולהמשיך לעצב את התוכן השיווקי המקומי בדיוק לשפה שמתאימה לכם.',
    primaryCtaLabel: 'כניסה למסך ההתחברות',
    primaryCtaHref: '/',
  },
} as const
