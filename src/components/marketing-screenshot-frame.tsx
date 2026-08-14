'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'

type MarketingScreenshotFrameProps = {
  src: string
  alt: string
  label: string
  caption: string
  viewportClassName: string
}

export function MarketingScreenshotFrame({
  src,
  alt,
  label,
  caption,
  viewportClassName,
}: MarketingScreenshotFrameProps) {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [isOpen])

  return (
    <>
      <div className="rounded-[2.4rem] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbfd_100%)] p-3 shadow-[0_22px_64px_rgba(36,63,88,0.12)]">
        <div className="flex items-center justify-between rounded-[1.4rem] bg-slate-900 px-4 py-3 text-white">
          <span className="text-sm font-black tracking-[0.14em] text-amber-300">
            {label}
          </span>
          <span className="text-xs font-bold text-white/70">צילום מסך אמיתי</span>
        </div>

        <div className="mt-3 rounded-[2rem] bg-[radial-gradient(circle_at_top_right,rgba(255,211,92,0.16),transparent_28%),linear-gradient(180deg,#fdfdfd_0%,#eef5fa_100%)] p-3">
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="block w-full cursor-zoom-in"
            aria-label={`הגדלת ${label}`}
          >
            <div
              className={`relative overflow-hidden rounded-[1.7rem] border border-slate-200 bg-white ${viewportClassName}`}
            >
              <Image
                src={src}
                alt={alt}
                fill
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-contain object-center"
              />
            </div>
          </button>
        </div>

        <p className="px-2 pt-4 text-sm leading-7 text-slate-600">{caption}</p>
      </div>

      {isOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/84 px-4 py-6 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="relative w-full max-w-6xl rounded-[2rem] border border-white/15 bg-slate-900 p-3 shadow-[0_30px_80px_rgba(0,0,0,0.45)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between rounded-[1.4rem] bg-white/8 px-4 py-3 text-white">
              <div>
                <p className="text-sm font-black tracking-[0.14em] text-amber-300">
                  {label}
                </p>
                <p className="mt-1 text-sm text-white/74">{alt}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-full bg-white px-4 py-2 text-sm font-black text-slate-900"
              >
                סגירה
              </button>
            </div>

            <div className="relative h-[70vh] overflow-hidden rounded-[1.6rem] bg-white">
              <Image
                src={src}
                alt={alt}
                fill
                sizes="100vw"
                className="object-contain object-center"
                priority
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
