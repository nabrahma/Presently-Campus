import type { ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Drawer } from 'vaul'
import { X } from 'lucide-react'
import { useDesktop } from '../lib/useMediaQuery'

interface SheetProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
}

/**
 * The app's only modal surface, in the shape the device expects.
 *
 * On a phone it is a Vaul drawer that drags and flicks away. With a pointer it
 * is a centred dialog, because a panel sliding up from the bottom edge of a
 * wide display is a phone gesture wearing the wrong clothes — and there is
 * nothing to drag it with.
 *
 * Both sit on Radix Dialog, so focus trapping, Escape, focus restore and
 * scroll locking behave identically either way.
 */
export function Sheet({ open, onClose, title, description, children, footer }: SheetProps) {
  const desktop = useDesktop()

  const onOpenChange = (next: boolean) => {
    if (!next) onClose()
  }

  const body = (
    <>
      <div className="scroll-region min-h-0 flex-1 px-5 pb-6 md:px-7">{children}</div>
      {footer ? (
        <div
          className="shrink-0 border-t border-line px-5 pt-4 md:px-7"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          {footer}
        </div>
      ) : (
        <div aria-hidden style={{ height: 'env(safe-area-inset-bottom)' }} />
      )}
    </>
  )

  if (desktop) {
    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay
            className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[3px]
                       data-[state=open]:animate-[overlay-in_.15s_ease-out]"
          />
          <Dialog.Content
            className="fixed top-1/2 left-1/2 z-50 flex max-h-[88dvh] w-[min(38rem,calc(100vw-3rem))]
                       -translate-x-1/2 -translate-y-1/2 flex-col rounded-[1.75rem] border border-line
                       bg-surface shadow-(--shadow-lift) outline-none
                       data-[state=open]:animate-[dialog-in_.18s_cubic-bezier(0.32,0.72,0,1)]"
          >
            <div className="flex items-start justify-between gap-4 px-7 pt-6 pb-4">
              <div className="min-w-0">
                <Dialog.Title className="title text-[1.5rem]">{title}</Dialog.Title>
                {description ? (
                  <Dialog.Description className="mt-1.5 text-[1rem] text-ink-muted">
                    {description}
                  </Dialog.Description>
                ) : (
                  <Dialog.Description className="sr-only">{title}</Dialog.Description>
                )}
              </div>
              <Dialog.Close
                aria-label={`Close ${title}`}
                className="-mt-1 -mr-2 grid size-12 shrink-0 place-items-center rounded-full border border-line
                           text-ink transition-colors hover:bg-elevated"
              >
                <X size={20} strokeWidth={2} />
              </Dialog.Close>
            </div>
            {body}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    )
  }

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} dismissible repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[3px]" />

        <Drawer.Content
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] w-full max-w-[36rem]
                     flex-col rounded-t-[1.75rem] border-t border-line bg-surface shadow-(--shadow-lift) outline-none"
        >
          {/* The grab handle is the affordance that says "this drags". */}
          <div aria-hidden className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-line-strong" />

          <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-4">
            <div className="min-w-0">
              <Drawer.Title className="title text-[1.375rem]">{title}</Drawer.Title>
              {description ? (
                <Drawer.Description className="mt-1.5 text-[1rem] text-ink-muted">
                  {description}
                </Drawer.Description>
              ) : (
                <Drawer.Description className="sr-only">{title}</Drawer.Description>
              )}
            </div>
            {/* Dragging down closes it too, but nobody should have to know that. */}
            <Drawer.Close
              aria-label={`Close ${title}`}
              className="-mt-1 -mr-1 grid size-12 shrink-0 place-items-center rounded-full border border-line text-ink"
            >
              <X size={20} strokeWidth={2} />
            </Drawer.Close>
          </div>

          {body}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
