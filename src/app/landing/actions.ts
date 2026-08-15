'use server'

import { redirect } from 'next/navigation'
import {
  buildMarketingLeadNotificationText,
  insertMarketingLead,
  upsertMarketingDemoSession,
} from '@/lib/marketing-landing'
import { sendWhatsAppTemplateMessage, sendWhatsAppTextMessage } from '@/lib/whatsapp'
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
  const whatsappConfig = landingPageContent.whatsapp

  try {
    if (!phone) {
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
      phone,
      demoStudentId: whatsappConfig.demoStudentId,
      templateName: whatsappConfig.metaTemplateName || null,
      sessionHours: whatsappConfig.demoSessionHours,
    })

    await sendWhatsAppTemplateMessage({
      to: phone,
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
    const message = error instanceof Error ? error.message : 'שליחת הדמו נכשלה.'
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
