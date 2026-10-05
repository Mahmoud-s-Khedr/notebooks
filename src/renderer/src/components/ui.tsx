import React, { forwardRef, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Popover from '@radix-ui/react-popover'
import * as Tooltip from '@radix-ui/react-tooltip'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'

const buttonStyles = cva('button', {
  variants: {
    variant: {
      default: 'button-primary',
      primary: 'button-primary',
      secondary: 'button-secondary',
      ghost: 'button-ghost',
      danger: 'button-danger',
      icon: 'icon-button'
    },
    size: { default: '', sm: 'button-sm', icon: 'icon-button' }
  },
  defaultVariants: { variant: 'default', size: 'default' }
})

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonStyles>
>(({ className = '', variant, size, ...props }, ref) => (
  <button ref={ref} className={`${buttonStyles({ variant, size })} ${className}`} {...props} />
))
Button.displayName = 'Button'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...props }, ref) => <input ref={ref} className={`input ${className}`} {...props} />
)
Input.displayName = 'Input'

export { Dialog, DropdownMenu, Popover, Tooltip }

export function IconTip({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <Tooltip.Provider delayDuration={350}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="tooltip" sideOffset={6}>
            {label}
            <Tooltip.Arrow className="tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}

export function Modal({
  title,
  children,
  defaultCancel = false,
  open,
  onOpenChange
}: {
  title: string
  defaultCancel?: boolean
  children: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
}): ReactNode {
  const content = useRef<HTMLDivElement>(null)
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          ref={content}
          className="dialog-content"
          onOpenAutoFocus={(event) => {
            if (defaultCancel) {
              event.preventDefault()
              content.current?.querySelector<HTMLButtonElement>('[data-default-cancel]')?.focus()
            }
          }}
        >
          <div className="dialog-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label={`Close ${title}`}>
              <X size={18} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
