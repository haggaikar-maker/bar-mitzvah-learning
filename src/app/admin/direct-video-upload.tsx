'use client'

import { useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

type DirectVideoUploadProps = {
  lessonPartId: number
  parashaName: string
  sectionName: string
  partName: string
  partOrder: number
  initialVideoUrl: string
}

type UploadState =
  | { type: 'idle'; message: string }
  | { type: 'uploading'; message: string }
  | { type: 'success'; message: string }
  | { type: 'error'; message: string }

export function DirectVideoUpload({
  lessonPartId,
  parashaName,
  sectionName,
  partName,
  partOrder,
  initialVideoUrl,
}: DirectVideoUploadProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [videoUrl, setVideoUrl] = useState(initialVideoUrl)
  const [uploadState, setUploadState] = useState<UploadState>({
    type: 'idle',
    message: 'עדיין לא הועלה וידאו חדש ישירות ל-Supabase.',
  })

  async function handleUploadClick() {
    const file = fileInputRef.current?.files?.[0]

    if (!file) {
      setUploadState({
        type: 'error',
        message: 'יש לבחור קודם קובץ וידאו.',
      })
      return
    }

    setUploadState({
      type: 'uploading',
      message: 'מעלה את הווידאו ישירות ל-Supabase...',
    })

    try {
      const targetResponse = await fetch('/api/admin/video-upload-target', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          lessonPartId,
          parashaName,
          sectionName,
          partName,
          partOrder,
          originalFilename: file.name,
        }),
      })

      const targetPayload = (await targetResponse.json()) as {
        bucketName?: string
        objectPath?: string
        token?: string
        publicUrl?: string
        error?: string
      }

      if (!targetResponse.ok || !targetPayload.bucketName || !targetPayload.objectPath || !targetPayload.token || !targetPayload.publicUrl) {
        throw new Error(targetPayload.error ?? 'לא ניתן היה להכין יעד העלאה לווידאו.')
      }

      const { error: uploadError } = await supabase.storage
        .from(targetPayload.bucketName)
        .uploadToSignedUrl(targetPayload.objectPath, targetPayload.token, file)

      if (uploadError) {
        throw new Error(uploadError.message)
      }

      setVideoUrl(targetPayload.publicUrl)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      setUploadState({
        type: 'success',
        message: 'הווידאו הועלה ל-Supabase. עכשיו לחץ על "שמירת וידאו לקטע".',
      })
    } catch (error) {
      setUploadState({
        type: 'error',
        message:
          error instanceof Error ? error.message : 'העלאת הווידאו נכשלה.',
      })
    }
  }

  return (
    <>
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        <span>בחירת קובץ וידאו</span>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3"
        />
      </label>
      <button
        type="button"
        onClick={handleUploadClick}
        disabled={uploadState.type === 'uploading'}
        className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white disabled:cursor-wait disabled:bg-blue-300"
      >
        {uploadState.type === 'uploading'
          ? 'מעלה וידאו...'
          : 'העלאה ישירה ל-Supabase'}
      </button>
      <input
        name="video_url"
        value={videoUrl}
        onChange={(event) => setVideoUrl(event.target.value)}
        placeholder="https://.../lesson-video.mp4"
        className="rounded-2xl border border-slate-200 px-4 py-3"
      />
      <div
        className={`rounded-2xl px-4 py-3 text-sm ring-1 ${
          uploadState.type === 'error'
            ? 'bg-rose-50 text-rose-800 ring-rose-200'
            : uploadState.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
              : 'bg-white text-slate-600 ring-slate-200'
        }`}
      >
        {uploadState.message}
      </div>
    </>
  )
}
