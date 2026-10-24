import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { formatShortDay, formatTime } from '../lib/date'
import { gridKey, type AbsenceGrid, type GridCell, type TrendPoint } from '../lib/analysis'

/*
  Two small charts, drawn by hand because they are the only charts in the
  app: a library would weigh more than everything else on the screen.

  Both follow one system: the app's single accent as the one data hue,
  hairline recessive axes, values in text tokens rather than the data colour,
  a hover/focus readout, and a table view so nothing depends on seeing the
  marks.
*/

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    setWidth(element.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, width] as const
}

/* -------------------------------------------------------------------------- */
/* Trend                                                                       */
/* -------------------------------------------------------------------------- */

const HEIGHT = 200
const PAD = { top: 14, right: 44, bottom: 24, left: 34 }
const TICKS = [0, 25, 50, 75, 100]

/** Attendance at each class over time, against the course's target. */
export function TrendChart({ points, target }: { points: TrendPoint[]; target: number }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)

  const innerWidth = Math.max(0, width - PAD.left - PAD.right)
  const innerHeight = HEIGHT - PAD.top - PAD.bottom
  const first = points[0]?.at ?? 0
  const last = points.at(-1)?.at ?? 1
  const span = Math.max(1, last - first)

  const x = (at: number) => PAD.left + (points.length === 1 ? innerWidth / 2 : ((at - first) / span) * innerWidth)
  const y = (percentage: number) => PAD.top + innerHeight - (percentage / 100) * innerHeight

  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.at).toFixed(1)},${y(point.percentage).toFixed(1)}`).join(' ')
  const end = points.at(-1)

  // The crosshair snaps to the nearest class along the time axis.
  const track = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const pointer = event.clientX - box.left + PAD.left
    let nearest = 0
    for (let index = 1; index < points.length; index += 1) {
      if (Math.abs(x(points[index].at) - pointer) < Math.abs(x(points[nearest].at) - pointer)) nearest = index
    }
    setActive(nearest)
  }

  const shown = active === null ? null : points[active]

  return (
    <div>
      <div ref={ref} className="relative">
        {width > 0 ? (
          <svg width={width} height={HEIGHT} role="img" aria-label={`Attendance at each of ${points.length} classes`}>
            {TICKS.map((tick) => (
              <g key={tick}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} className="stroke-line" strokeWidth={1} />
                <text x={PAD.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-ink-faint font-mono text-[10px]">
                  {tick}
                </text>
              </g>
            ))}

            {/* The target is a reference, not data: a hairline in ink, labelled. */}
            <line x1={PAD.left} x2={width - PAD.right} y1={y(target)} y2={y(target)} className="stroke-ink-muted" strokeWidth={1} />
            <text x={width - PAD.right + 6} y={y(target)} dy="0.32em" className="fill-ink-muted font-mono text-[10px]">
              {target}%
            </text>

            {points.length > 1 ? (
              <>
                <text x={PAD.left} y={HEIGHT - 6} className="fill-ink-faint font-mono text-[10px]">
                  {formatShortDay(new Date(first).toISOString())}
                </text>
                <text x={width - PAD.right} y={HEIGHT - 6} textAnchor="end" className="fill-ink-faint font-mono text-[10px]">
                  {formatShortDay(new Date(last).toISOString())}
                </text>
              </>
            ) : null}

            <path d={path} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="stroke-accent" />

            {shown ? (
              <line
                x1={x(shown.at)}
                x2={x(shown.at)}
                y1={PAD.top}
                y2={PAD.top + innerHeight}
                className="stroke-line-strong"
                strokeWidth={1}
              />
            ) : null}

            {[shown, end].filter((point): point is TrendPoint => Boolean(point)).map((point) => (
              <circle
                key={point.sessionId}
                cx={x(point.at)}
                cy={y(point.percentage)}
                r={4}
                strokeWidth={2}
                className="fill-accent stroke-surface"
              />
            ))}

            {end ? (
              <text x={x(end.at) + 8} y={y(end.percentage)} dy="-0.6em" className="fill-ink font-mono text-[11px]">
                {Math.round(end.percentage)}%
              </text>
            ) : null}

            {/* A hit area over the whole plot, bigger than any mark. */}
            <rect
              x={PAD.left}
              y={PAD.top}
              width={innerWidth}
              height={innerHeight}
              fill="transparent"
              onPointerMove={track}
              onPointerDown={track}
              onPointerLeave={() => setActive(null)}
            />
          </svg>
        ) : (
          <div style={{ height: HEIGHT }} />
        )}

        {shown ? (
          <div
            className="pointer-events-none absolute top-0 rounded-xl border border-line bg-elevated px-3 py-2 font-mono text-[0.68rem] text-ink shadow-lg"
            style={{ left: Math.min(Math.max(0, x(shown.at) - 70), Math.max(0, width - 150)) }}
          >
            <p className="text-ink-muted">{formatShortDay(new Date(shown.at).toISOString())} · {formatTime(new Date(shown.at).toISOString())}</p>
            <p className="mt-1">
              {shown.percentage}% · {shown.present} of {shown.counted}
            </p>
          </div>
        ) : null}
      </div>

      <TableView>
        <table className="w-full font-mono text-[0.7rem]">
          <thead>
            <tr className="text-left text-ink-faint">
              <th className="py-1.5 font-normal">Class</th>
              <th className="py-1.5 text-right font-normal">Present</th>
              <th className="py-1.5 text-right font-normal">%</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.sessionId} className="border-t border-line tabular-nums">
                <td className="py-1.5">{formatShortDay(new Date(point.at).toISOString())} · {formatTime(new Date(point.at).toISOString())}</td>
                <td className="py-1.5 text-right">{point.present}/{point.counted}</td>
                <td className="py-1.5 text-right">{point.percentage}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableView>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Heatmap                                                                     */
/* -------------------------------------------------------------------------- */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/*
  Sequential: one hue, more absence is more accent. Five steps rather than a
  continuous scale, so neighbouring cells either look the same or clearly do
  not. Text inside a cell switches to near-black once the fill is light.
*/
const STEPS = [
  { upTo: 0.05, fill: 'color-mix(in oklab, var(--color-accent) 12%, var(--color-surface))', dark: false },
  { upTo: 0.1, fill: 'color-mix(in oklab, var(--color-accent) 28%, var(--color-surface))', dark: false },
  { upTo: 0.2, fill: 'color-mix(in oklab, var(--color-accent) 48%, var(--color-surface))', dark: false },
  { upTo: 0.35, fill: 'color-mix(in oklab, var(--color-accent) 72%, var(--color-surface))', dark: true },
  { upTo: Infinity, fill: 'var(--color-accent)', dark: true }
]

const stepFor = (rate: number) => STEPS.find((step) => rate <= step.upTo) ?? STEPS[STEPS.length - 1]
const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`
const describeCell = (cell: GridCell) =>
  `${WEEKDAYS[cell.weekday]} ${hourLabel(cell.hour)} · ${cell.sessions} ${cell.sessions === 1 ? 'class' : 'classes'} · ${Math.round(cell.rate * 100)}% absent (${cell.absent} of ${cell.counted})`

/** Share of students absent, by weekday and the hour classes start. */
export function AbsenceHeatmap({ grid }: { grid: AbsenceGrid }) {
  const [focused, setFocused] = useState<GridCell | null>(null)

  return (
    <div>
      <div className="overflow-x-auto">
        <div
          className="grid min-w-max gap-[2px]"
          style={{ gridTemplateColumns: `2.5rem repeat(${grid.hours.length}, minmax(3rem, 1fr))` }}
        >
          <span />
          {grid.hours.map((hour) => (
            <span key={hour} className="pb-1.5 text-center font-mono text-[0.6rem] text-ink-faint">
              {hourLabel(hour)}
            </span>
          ))}

          {grid.weekdays.map((weekday) => (
            <Row key={weekday} weekday={weekday} grid={grid} onFocusCell={setFocused} />
          ))}
        </div>
      </div>

      <p role="status" className="mt-3 min-h-4 font-mono text-[0.66rem] text-ink-muted">
        {focused ? describeCell(focused) : 'Point at or tab to a cell for its figures.'}
      </p>

      <div className="mt-3 flex items-center gap-1.5" aria-hidden>
        <span className="font-mono text-[0.6rem] text-ink-faint">Fewer absent</span>
        {STEPS.map((step) => (
          <span key={step.upTo} className="h-2.5 w-6 rounded-[3px]" style={{ background: step.fill }} />
        ))}
        <span className="font-mono text-[0.6rem] text-ink-faint">More</span>
      </div>

      <TableView>
        <table className="w-full font-mono text-[0.7rem]">
          <thead>
            <tr className="text-left text-ink-faint">
              <th className="py-1.5 font-normal">When</th>
              <th className="py-1.5 text-right font-normal">Classes</th>
              <th className="py-1.5 text-right font-normal">Absent</th>
            </tr>
          </thead>
          <tbody>
            {[...grid.cells.values()].map((cell) => (
              <tr key={gridKey(cell.weekday, cell.hour)} className="border-t border-line tabular-nums">
                <td className="py-1.5">
                  {WEEKDAYS[cell.weekday]} {hourLabel(cell.hour)}
                </td>
                <td className="py-1.5 text-right">{cell.sessions}</td>
                <td className="py-1.5 text-right">
                  {Math.round(cell.rate * 100)}% ({cell.absent}/{cell.counted})
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableView>
    </div>
  )
}

function Row({ weekday, grid, onFocusCell }: { weekday: number; grid: AbsenceGrid; onFocusCell: (cell: GridCell | null) => void }) {
  return (
    <>
      <span className="flex items-center font-mono text-[0.62rem] text-ink-faint">{WEEKDAYS[weekday]}</span>
      {grid.hours.map((hour) => {
        const cell = grid.cells.get(gridKey(weekday, hour))
        if (!cell) return <span key={hour} className="h-10 rounded-[4px] border border-dashed border-line" />
        const step = stepFor(cell.rate)
        return (
          <button
            key={hour}
            type="button"
            aria-label={describeCell(cell)}
            onPointerEnter={() => onFocusCell(cell)}
            onPointerLeave={() => onFocusCell(null)}
            onFocus={() => onFocusCell(cell)}
            onBlur={() => onFocusCell(null)}
            className={cn('h-10 rounded-[4px] font-mono text-[0.66rem] tabular-nums', step.dark ? 'text-bg' : 'text-ink')}
            style={{ background: step.fill }}
          >
            {Math.round(cell.rate * 100)}
          </button>
        )
      })}
    </>
  )
}

function TableView({ children }: { children: ReactNode }) {
  return (
    <details className="mt-4">
      <summary className="cursor-pointer font-mono text-[0.62rem] tracking-[0.1em] text-ink-muted uppercase">Show as table</summary>
      <div className="mt-2">{children}</div>
    </details>
  )
}
