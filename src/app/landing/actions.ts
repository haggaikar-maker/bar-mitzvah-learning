'use server'

import { redirect } from 'next/navigation'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import {
  buildMarketingLeadNotificationText,
  insertMarketingLead,
  upsertMarketingDemoSession,
} from '@/lib/marketing-landing'
import {
  normalizePhoneWithDefaultCountryCode,
  sendWhatsAppTemplateMessage,
  sendWhatsAppTextMessage,
} from '@/lib/whatsapp'
import { landingPageContent } from '@/src/marketing-content/landing-page-content'

function readString(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function buildRedirectUrl(input: {
  sectionId: string
  kind: 'wa' | 'lead'
  status: 'success' | 'error'
  message: string
}) {
  const params = new URLSearchParams()
  params.set(`${input.kind}Status`, input.status)
  params.set(`${input.kind}Message`, input.message)
  return `/landing?${params.toString()}#${input.sectionId}`
}

export async function sendMarketingWhatsAppDemo(formData: FormData) {
  const phone = readString(formData, 'phone')
  const countryCode = readString(formData, 'countryCode')
  const whatsappConfig = landingPageContent.whatsapp
  const normalizedPhone = normalizePhoneWithDefaultCountryCode({
    phone,
    defaultCountryCode: countryCode || whatsappConfig.defaultCountryCode,
  })

  try {
    if (!normalizedPhone) {
      redirect(
        buildRedirectUrl({
          sectionId: whatsappConfig.id,
          kind: 'wa',
          status: 'error',
          message: 'יש להזין מספר טלפון.',
        })
      )
    }

    await upsertMarketingDemoSession({
      phone: normalizedPhone,
      demoStudentId: whatsappConfig.demoStudentId,
      templateName: whatsappConfig.metaTemplateName || null,
      sessionHours: whatsappConfig.demoSessionHours,
    })

    await sendWhatsAppTemplateMessage({
      to: normalizedPhone,
      templateName: whatsappConfig.metaTemplateName,
      languageCode: whatsappConfig.metaTemplateLanguageCode,
      bodyParameters: whatsappConfig.metaTemplateBodyParameters,
    })

    redirect(
      buildRedirectUrl({
        sectionId: whatsappConfig.id,
        kind: 'wa',
        status: 'success',
        message: 'הודעת הדמו נשלחה בהצלחה. עכשיו אפשר להשיב לה ולקבל את תפריט הדוגמה.',
      })
    )
  } catch (error) {
    if (isRedirectError(error)) {
      throw error
    }

    let message = error instanceof Error ? error.message : 'שליחת הדמו נכשלה.'

    if (message.includes('(#132000)')) {
      message =
        'תבנית ה-WhatsApp שנבחרה דורשת כמות פרמטרים שונה מזו שהוגדרה באתר. צריך לעדכן ב-Meta או בקובץ התוכן את metaTemplateBodyParameters כך שיתאימו בדיוק לתבנית.'
    }

    redirect(
      buildRedirectUrl({
        sectionId: whatsappConfig.id,
        kind: 'wa',
        status: 'error',
        message,
      })
    )
  }
}

export async function submitMarketingLead(formData: FormData) {
  const name = readString(formData, 'name')
  const role = readString(formData, 'role')
  const phone = readString(formData, 'phone')
  const email = readString(formData, 'email')
  const notes = readString(formData, 'notes')
  const contactConfig = landingPageContent.contact

  try {
    if (!name || !phone) {
      redirect(
        buildRedirectUrl({
          sectionId: contactConfig.id,
          kind: 'lead',
          status: 'error',
          message: 'יש למלא לפחות שם וטלפון.',
        })
      )
    }

    await insertMarketingLead({
      source: 'landing_form',
      fullName: name,
      role: role || null,
      phone,
      email: email || null,
      notes: notes || null,
    })

    if (contactConfig.notificationPhone) {
      try {
        await sendWhatsAppTextMessage({
          to: contactConfig.notificationPhone,
          body: buildMarketingLeadNotificationText({
            source: 'landing_form',
            fullName: name,
            role: role || null,
            phone,
            email: email || null,
            notes: notes || null,
          }),
        })
      } catch (notificationError) {
        console.error('Failed to send marketing lead WhatsApp notification', notificationError)
      }
    }

    redirect(
      buildRedirectUrl({
        sectionId: contactConfig.id,
        kind: 'lead',
        status: 'success',
        message: 'הפרטים נקלטו בהצלחה. נחזור אליכם בהקדם.',
      })
    )
  } catch (error) {
    if (isRedirectError(error)) {
      throw error
    }

    const message = error instanceof Error ? error.message : 'שליחת הפרטים נכשלה.'
    redirect(
      buildRedirectUrl({
        sectionId: contactConfig.id,
        kind: 'lead',
        status: 'error',
        message,
      })
    )
  }
}
