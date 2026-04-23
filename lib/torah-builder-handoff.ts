import 'server-only'

import { createHmac } from 'node:crypto'

export type TorahBuilderHandoffPayload = {
  ownerUserId: string
  teacherName?: string
  sourceApp?: string
  returnUrl?: string
  callbackUrl?: string
  lessonId?: string
  parashaId?: string
  exp?: number
}

function toBase64Url(value: string | Buffer) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function normalizeBaseUrl(url: string) {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

export function createTorahBuilderHandoffToken(
  payload: TorahBuilderHandoffPayload,
  secret: string
) {
  const payloadSegment = toBase64Url(JSON.stringify(payload))
  const signature = createHmac('sha256', secret).update(payloadSegment).digest()
  const signatureSegment = toBase64Url(signature)

  return `${payloadSegment}.${signatureSegment}`
}

export function createTorahBuilderLaunchUrl(payload: TorahBuilderHandoffPayload) {
  const builderBaseUrl = process.env.TORAH_BUILDER_URL
  const secret = process.env.BUILDER_HANDOFF_SECRET

  if (!builderBaseUrl) {
    throw new Error('TORAH_BUILDER_URL is required.')
  }

  if (!secret) {
    throw new Error('BUILDER_HANDOFF_SECRET is required.')
  }

  const token = createTorahBuilderHandoffToken(payload, secret)
  const url = new URL(normalizeBaseUrl(builderBaseUrl))
  url.searchParams.set('handoff', token)
  return url.toString()
}
