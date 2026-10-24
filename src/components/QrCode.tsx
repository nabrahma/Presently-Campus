import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { cn } from '../lib/cn'

/**
 * A QR code drawn as SVG, dark on white.
 *
 * Phone cameras find codes fastest with a light quiet zone around a dark
 * pattern, so this stays light even on the app's black canvas. The SVG comes
 * from the qrcode library and contains only the module paths; the encoded
 * value never appears in it as markup.
 */
export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const [svg, setSvg] = useState('')

  useEffect(() => {
    let cancelled = false
    QRCode.toString(value, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' })
      .then((markup) => {
        if (!cancelled) setSvg(markup)
      })
      .catch(() => {
        if (!cancelled) setSvg('')
      })
    return () => {
      cancelled = true
    }
  }, [value])

  return (
    <div
      role="img"
      aria-label={label}
      className={cn('aspect-square w-full rounded-2xl bg-white p-2 [&>svg]:h-full [&>svg]:w-full', className)}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
