import { Fragment, useState, type ReactNode } from 'react'
import { Tex } from '@/components'
import { useSettings, type LearningMode } from '@/app/settings'
import type { CodeDistKind, DcNullMode } from '@/simulation/models/bias'

/**
 * 推導理由等短句的行內數學：以 `$…$` 標出 TeX 片段，其餘為一般文字。
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

/**
 * 表格用的 code 分布名稱（`$…$` 版，以 m() 顯示）。下拉選單的 <option> 不能放 KaTeX，仍用 bias.ts 的 CODE_KIND_LABEL。
 */
export const CODE_KIND_TEX: Record<CodeDistKind, string> = {
  five_level: String.raw`5-level $\{-2,-1,0,1,2\}$（等機率）`,
  pm_one: String.raw`$\pm1$（等機率）`,
  unipolar4: String.raw`4-level unipolar $\{0,1,2,3\}$（等機率）`,
  gaussian: String.raw`Gaussian $\mathcal N(0,1)$`,
  uniform_residue: String.raw`Uniform $[0,1)$ residue`,
  dsm: 'DSM residue（8-bit 累加器）',
}

/** 表格用的主迴路 DC null 模式名稱（`$…$` 版）；選單仍用 bias.ts 的 DC_MODE_LABEL。 */
export const DC_MODE_TEX: Record<DcNullMode, string> = {
  none: 'none：DC 不被主迴路消除（靜態式）',
  shared_bbpd: String.raw`shared BBPD：type-II 主迴路強制 $E[q]=0$`,
  linear_pd: 'linear PD + separate comparator',
}

/** 勘誤小標：連到驗證頁（驗證頁依 id 列出勘誤）。 */
export function Erratum({ id, note }: { id: string; note?: string }) {
  return (
    <a className="ch11-erratum" href="#/verification" title={note ? `勘誤 ${id}：${note}` : `勘誤 ${id}（見驗證頁）`}>
      勘誤 {id}
    </a>
  )
}

const RANK: Record<LearningMode, number> = { beginner: 0, engineer: 1, research: 2 }

/**
 * 依學習模式決定預設展開的推導框（docs/teaching-style.md §6）：
 * Beginner 預設收合（一鍵展開）；Engineer 起預設展開。使用者手動切換後以手動為準。
 */
export function ModeDetails({
  title,
  children,
  openFrom = 'engineer',
}: {
  title: ReactNode
  children: ReactNode
  openFrom?: LearningMode
}) {
  const { mode } = useSettings()
  const byMode = RANK[mode] >= RANK[openFrom]
  const [manual, setManual] = useState<boolean | null>(null)
  const open = manual ?? byMode
  return (
    <details
      className="ch11-details"
      open={open}
      onToggle={(e) => {
        const now = (e.currentTarget as HTMLDetailsElement).open
        if (now !== open) setManual(now)
      }}
    >
      <summary>{title}</summary>
      <div className="ch11-details-body">{children}</div>
    </details>
  )
}

/** 顯示用數字：有效位數 digits，去尾零；非有限值顯示 '—'。 */
export function num(x: number, digits = 6): string {
  if (!Number.isFinite(x)) return x === Infinity ? '∞' : x === -Infinity ? '−∞' : '—'
  if (x === 0) return '0'
  const a = Math.abs(x)
  if (a >= 1e6 || a < 1e-4) return x.toExponential(Math.max(0, digits - 1))
  return String(Number(x.toPrecision(digits)))
}

/** 把浮點捨入造成的「應為 0」的小數歸零（|x| ≤ tol·scale 時回傳 0）。只用於顯示。 */
export function chop(x: number, scale = 1, tol = 1e-12): number {
  return Math.abs(x) <= tol * Math.max(Math.abs(scale), 1e-300) ? 0 : x
}

/** 放進 TeX 的數字：非有限值改成 TeX 記號（\\infty、—），科學記號改成 a\\times10^{b}。 */
export function texNum(x: number, digits = 6): string {
  if (Number.isNaN(x)) return '\\text{—}'
  if (x === Infinity) return '\\infty'
  if (x === -Infinity) return '-\\infty'
  const s = num(x, digits)
  const mm = /^(-?[\d.]+)e([+-]?\d+)$/.exec(s)
  return mm ? `${mm[1]}\\times10^{${Number(mm[2])}}` : s
}

/** 帶正負號的數字（殘差表用） */
export function signed(x: number, digits = 6): string {
  const s = num(x, digits)
  return x > 0 ? `+${s}` : s
}

/**
 * log 軸畫不出 ≤ 0 的值：改成 null，折線在那裡斷開。
 * 直接把負值交給 Plotly 的 log 軸時，它會把線拉到圖的最下面，變成一根一根的直線（§11.4：$C\le0$ 的 FCW）。
 */
export function positiveOrGap(v: number): number | null {
  return v > 0 ? v : null
}

/**
 * 把一組遞增的索引畫成一條折線時用：索引不相鄰的地方插入 null，Plotly 就在那裡斷線。
 * 同一張圖把點分成兩類、各畫一條線（例如 §11.4 的「通過／未通過代回檢查」）時，線才不會跨過另一類的點。
 */
export function gappedSeries(idx: readonly number[], x: ArrayLike<number>, y: ArrayLike<number>): { x: (number | null)[]; y: (number | null)[] } {
  const xs: (number | null)[] = []
  const ys: (number | null)[] = []
  idx.forEach((i, k) => {
    if (k > 0 && i !== idx[k - 1] + 1) {
      xs.push(null)
      ys.push(null)
    }
    xs.push(x[i])
    ys.push(y[i])
  })
  return { x: xs, y: ys }
}
