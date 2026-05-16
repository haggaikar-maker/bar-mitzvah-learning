'use client'

import type { MouseEvent, ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { CenteredLoadingState } from './centered-loading-state'

type StudentNavLinkProps = {
  href: string
  children: ReactNode
  className?: string
  overlayLabel?: string
  overlaySubtitle?: string
}

export function StudentNavLink({
  href,
  children,
  className,
  overlayLabel = 'טוען...',
  overlaySubtitle = 'פותח עבורך את המסך הבא',
}: StudentNavLinkProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }

    event.preventDefault()

    startTransition(() => {
      router.push(href, { scroll: false })
    })
  }

  return (
    <>
      <Link href={href} className={className} onClick={handleClick}>
        {children}
      </Link>
      {isPending ? (
        <CenteredLoadingState
          label={overlayLabel}
          subtitle={overlaySubtitle}
        />
      ) : null}
    </>
  )
}
