import 'server-only'

import path from 'node:path'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type StorageKind =
  | 'audio'
  | 'images'
  | 'videos'
  | 'student-recordings'

function slugifySegment(value: string) {
  const sanitized = value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()

  return sanitized || 'item'
}

export function normalizePublicPath(value: string) {
  if (!value) {
    return ''
  }

  const normalized = value
    .replaceAll('\\', '/')
    .replace(/^public\//i, '')
    .replace(/^\/+/, '')

  return normalized ? `/${normalized}` : ''
}

export function getBucketName(kind: StorageKind) {
  switch (kind) {
    case 'audio':
      return process.env.SUPABASE_AUDIO_BUCKET ?? 'lesson-audio'
    case 'images':
      return process.env.SUPABASE_IMAGE_BUCKET ?? 'lesson-images'
    case 'videos':
      return process.env.SUPABASE_VIDEO_BUCKET ?? 'lesson-videos'
    case 'student-recordings':
      return process.env.SUPABASE_STUDENT_RECORDING_BUCKET ?? 'student-recordings'
  }
}

export async function uploadStorageFile(
  file: FormDataEntryValue | null,
  input: {
    kind: StorageKind
    segments: string[]
    filenameBase: string
    visibility: 'public' | 'private'
  }
) {
  if (!(file instanceof File) || file.size === 0) {
    return null
  }

  const bucketName = getBucketName(input.kind)
  const extension = path.extname(file.name) || ''
  const filename = `${slugifySegment(input.filenameBase)}-${Date.now()}${extension.toLowerCase()}`
  const objectPath = [...input.segments.map(slugifySegment), filename].join('/')
  const supabaseAdmin = getSupabaseAdmin()

  const { error: uploadError } = await supabaseAdmin.storage
    .from(bucketName)
    .upload(objectPath, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type || undefined,
      upsert: true,
    })

  if (uploadError) {
    throw new Error(`שגיאה בהעלאת הקובץ לאחסון: ${uploadError.message}`)
  }

  if (input.visibility === 'private') {
    return {
      bucketName,
      objectPath,
      publicUrl: null,
    }
  }

  const { data } = supabaseAdmin.storage.from(bucketName).getPublicUrl(objectPath)

  return {
    bucketName,
    objectPath,
    publicUrl: data.publicUrl,
  }
}

export async function createSignedStorageUrl(
  kind: StorageKind,
  objectPath: string,
  expiresIn = 60 * 60
) {
  const supabaseAdmin = getSupabaseAdmin()
  const bucketName = getBucketName(kind)
  const { data, error } = await supabaseAdmin.storage
    .from(bucketName)
    .createSignedUrl(objectPath, expiresIn)

  if (error) {
    throw new Error(`שגיאה ביצירת קישור מאובטח: ${error.message}`)
  }

  return data.signedUrl
}

export async function deleteStorageObject(kind: StorageKind, objectPath: string) {
  const supabaseAdmin = getSupabaseAdmin()
  const bucketName = getBucketName(kind)
  const { error } = await supabaseAdmin.storage.from(bucketName).remove([objectPath])

  if (error) {
    throw new Error(`שגיאה במחיקת קובץ מהאחסון: ${error.message}`)
  }
}

