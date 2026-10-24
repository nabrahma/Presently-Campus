import type { ReactNode } from 'react'

interface EmptyProps {
  icon: ReactNode
  title: string
  text: string
  action?: ReactNode
}

export function Empty({ icon, title, text, action }: EmptyProps) {
  return (
    <div className="dot-grid flex flex-col items-center rounded-panel border border-dashed border-line-strong px-6 py-12 text-center">
      <div className="mb-5 grid size-16 place-items-center rounded-2xl border border-line bg-surface text-ink shadow-(--shadow-card) [&_svg]:size-7">
        {icon}
      </div>
      <h3 className="title text-[1.375rem]">{title}</h3>
      <p className="mt-2 max-w-[26rem] text-[1.0625rem] leading-relaxed text-ink-muted">{text}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  )
}
