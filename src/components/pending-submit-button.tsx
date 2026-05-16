'use client'

import { useFormStatus } from 'react-dom'
import { CenteredLoadingState } from './centered-loading-state'

type PendingSubmitButtonProps = {
  label: string
  pendingLabel?: string
  overlayLabel?: string
  overlaySubtitle?: string
  className?: string
}

export function PendingSubmitButton({
  label,
  pendingLabel = 'טוען...',
  overlayLabel = 'מתחבר...',
  overlaySubtitle = 'בודק את הפרטים ומעביר אותך למסך המתאים',
  className,
}: PendingSubmitButtonProps) {
  const { pending } = useFormStatus()

  return (
    <>
      <button
        type="submit"
        disabled={pending}
        className={className}
        aria-busy={pending}
      >
        {pending ? pendingLabel : label}
      </button>
      {pending ? (
        <CenteredLoadingState
          label={overlayLabel}
          subtitle={overlaySubtitle}
        />
      ) : null}
    </>
  )
}
