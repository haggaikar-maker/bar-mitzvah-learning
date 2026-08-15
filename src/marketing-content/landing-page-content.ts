export type MarketingQuickLink = {
  label: string
  href: string
}

export type MarketingDemoLink = {
  label: string
  href: string
}

export type MarketingLeadRoleOption = {
  value: string
  label: string
}

export const landingPageContent = {
  general: {
    id: 'marketing-general',
    title: 'ליווי דיגיטלי מסודר ללימוד בר מצווה',
    description:
      'סרטונים, מעקב תרגולים, קישורים ישירים ו־WhatsApp חכם במקום אחד. מתאים להורים, מלמדים ובני מצווה שרוצים תהליך ברור ונוח.',
    quickLinks: [
      { label: 'תלמיד', href: '#marketing-student' },
      { label: 'מלווה', href: '#marketing-guide' },
      { label: 'WhatsApp', href: '#marketing-whatsapp' },
      { label: 'השארת פרטים', href: '#marketing-contact' },
    ] satisfies MarketingQuickLink[],
  },
  student: {
    id: 'marketing-student',
    title: 'לתלמיד',
    textPrimary:
      'התלמיד מקבל אזור לימוד ברור, נקי וממוקד. כל קטע נפתח בזמן הנכון, עם וידאו, אודיו, תמונות, הקלטה עצמית ומעקב התקדמות.',
    textSecondary:
      'אפשר לשלוח אותו ישירות לקטע הרלוונטי בלי לבקש ממנו שם משתמש וסיסמה בכל פעם, וכך הלמידה נשארת זורמת גם מהטלפון.',
    imageUrl: '/marketing-ui/student-screen.jpg',
    imageAlt: 'מסך תלמיד לדוגמה',
    imageLabel: 'אזור תלמיד',
    imageCaption: 'לחיצה על התמונה פותחת אותה בגודל מלא.',
    demoLink: {
      label: 'לקטע וידאו לדוגמה באתר',
      href: '/student/lesson/1',
    } satisfies MarketingDemoLink,
  },
  guide: {
    id: 'marketing-guide',
    title: 'למלווה',
    description:
      'המלמד או ההורה שולט בתהליך: מגדיר קטעים, בוחר מה גלוי, מעלה מדיה, רואה סטטיסטיקות ושולח תזכורות מדויקות בקליק.',
    imageUrl: '/marketing-ui/teacher-dashboard.jpg',
    imageAlt: 'מסך מלווה לדוגמה',
    imageLabel: 'אזור מלווה',
    imageCaption: 'מסך ניהול רחב שמרכז תלמידים, תוכן, תרגולים והודעות.',
  },
  whatsapp: {
    id: 'marketing-whatsapp',
    title: 'WhatsApp',
    description:
      'גם מחוץ לאתר אפשר להמשיך את התהליך. שולחים הודעה לדוגמה, מקבלים בוט עם קטעים פתוחים, סטטיסטיקות והודעות למלמד.',
    imageUrl: '/marketing-ui/whatsapp-screen.jpg',
    imageAlt: 'דוגמת WhatsApp',
    imageLabel: 'WhatsApp',
    imageCaption: 'תצוגת הדמו מראה איך התלמיד מקבל קטעים, סטטיסטיקות וקישורים ישירים.',
    phoneFieldLabel: 'מספר טלפון לקבלת דמו',
    phoneFieldPlaceholder: 'למשל 054-1234567',
    submitLabel: 'שליחת הודעת דמו',
    helperText:
      'אחרי קבלת ההודעה אפשר להשיב לבוט ולקבל גישה זמנית לתלמיד לדוגמה. אפשר גם לשלוח 100 להשארת פרטים דרך ה־WhatsApp.',
    metaTemplateName: 'reminder',
    metaTemplateLanguageCode: 'he',
    metaTemplateBodyParameters: [] as string[],
    demoStudentId: 11,
    demoSessionHours: 24,
    detailsCommand: '100',
  },
  contact: {
    id: 'marketing-contact',
    title: 'השארת פרטים',
    description:
      'כאן אפשר לשים תמחור, פרטי ליווי, מה כולל השירות ואיך נראה תהליך ההצטרפות.',
    notificationPhone: '972542181248',
    formTitle: 'נשאיר פרטים ונחזור אליך',
    nameLabel: 'שם',
    roleLabel: 'סוג ליווי',
    phoneLabel: 'טלפון',
    emailLabel: 'מייל',
    notesLabel: 'הערות',
    notesPlaceholder: 'כתבו כאן מה חשוב לכם, פרטי קריאה, גיל, סוג ליווי רצוי ועוד.',
    submitLabel: 'שליחת פרטים',
    roleOptions: [
      { value: 'parent', label: 'הורה' },
      { value: 'teacher', label: 'מלמד' },
    ] satisfies MarketingLeadRoleOption[],
    aboutProjectTitle: 'קצת על הפרויקט',
    aboutProjectText:
      'המערכת נולדה מתוך צורך אמיתי להפוך את לימוד בר המצווה למסודר, רגוע, זמין וידידותי גם לתלמיד, גם למלמד וגם לבית.',
  },
} as const
