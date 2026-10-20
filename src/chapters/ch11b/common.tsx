import { Fragment, useState, type ReactNode } from 'react'
import { Tex, makeTexNum } from '@/components'
import { useSettings, type LearningMode } from '@/app/settings'

/**
 * 推導理由等短句的行內數學：以 `$…$` 標出 TeX 片段，其餘為一般文字（與 Ch11 相同的寫法）。
 * 例：m('兩邊除以 $E[x^2]$（需 $E[x^2]>0$）') —— 讓所有數學都經過 KaTeX（docs/teaching-style.md §3）。
 */
export function m(text: string): ReactNode {
  const parts = text.split('$')
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <Tex key={i}>{p}</Tex> : <Fragment key={i}>{p}</Fragment>))}
    </>
  )
}

const RANK: Record<LearningMode, number> = { beginner: 0, engineer: 1, research: 2 }

/** 依學習模式決定預設展開的推導框：Beginner 預設收合（一鍵展開）；Engineer 起預設展開；使用者手動切換後以手動為準。 */
export function ModeDetails({ title, children, openFrom = 'engineer' }: { title: ReactNode; children: ReactNode; openFrom?: LearningMode }) {
  const { mode } = useSettings()
  const byMode = RANK[mode] >= RANK[openFrom]
  const [manual, setManual] = useState<boolean | null>(null)
  const open = manual ?? byMode
  return (
    <details
      className="ch11b-details"
      open={open}
      onToggle={(e) => {
        const now = (e.currentTarget as HTMLDetailsElement).open
        if (now !== open) setManual(now)
      }}
    >
      <summary>{title}</summary>
      <div className="ch11b-details-body">{children}</div>
    </details>
  )
}

/** 顯示用數字：有效位數 digits，去尾零；非有限值顯示 '—'。 */
export function num(x: number, digits = 5): string {
  if (!Number.isFinite(x)) return x === Infinity ? '∞' : x === -Infinity ? '−∞' : '—'
  if (x === 0) return '0'
  const a = Math.abs(x)
  if (a >= 1e6 || a < 1e-4) return x.toExponential(Math.max(0, digits - 1))
  return String(Number(x.toPrecision(digits)))
}

/** 放進 TeX 的數字：非有限值改成 TeX 記號，科學記號改成 a\\times10^{b}（共用的 texNumber）。 */
export const texNum = makeTexNum(5)

/** 帶正負號的數字 */
export function signed(x: number, digits = 5): string {
  const s = num(x, digits)
  return x > 0 ? `+${s}` : s
}

/** 把浮點捨入造成的「應為 0」的小數歸零（只用於顯示）。 */
export function chop(x: number, scale = 1, tol = 1e-12): number {
  return Math.abs(x) <= tol * Math.max(Math.abs(scale), 1e-300) ? 0 : x
}
