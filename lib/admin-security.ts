import 'server-only'

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET ?? 'dev-admin-session-secret'

export function hashPassword(password: string) {
  return createHash('sha256').update(password).digest('hex')
}

export function verifyPassword(password: string, storedHash: string) {
  const computed = hashPassword(password)

  try {
    return timingSafeEqual(Buffer.from(computed), Buffer.from(storedHash))
  } catch {
    return false
  }
}

export function signSession(payload: string) {
  const signature = createHmac('sha256', SESSION_SECRET).update(payload).digest('hex')
  return `${payload}.${signature}`
}

export function verifySession(token: string) {
  const lastDotIndex = token.lastIndexOf('.')

  if (lastDotIndex <= 0) {
    return null
  }

  const payload = token.slice(0, lastDotIndex)
  const signature = token.slice(lastDotIndex + 1)
  const expectedSignature = createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('hex')

  try {
    const isValid = timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )

    return isValid ? payload : null
  } catch {
    return null
  }
}

export const hashAdminPassword = hashPassword
export const verifyAdminPassword = verifyPassword
export const signAdminSession = signSession
export const verifyAdminSession = verifySession
