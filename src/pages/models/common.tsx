import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { HandCalc, mathText, Mermaid, StepDerivation, type Step } from '@/components'
import { useSettings, type LearningMode } from '@/app/settings'
import { handcalc } from './handcalcs'

/**
 * Part D「Behavioral Models、RTL 與 Sign-off」頁私有的小工具（建議上移到 @/components：useAtLeast、Steps、ErratumNote、md）。
 */

/**
 * 字串內的 `$...$` 以行內 KaTeX 顯示（docs/teaching-style.md §3：數學一律 LaTeX）。
 * 用在表格資料、ParamControl 的 label / hint 等「以字串描述、但要顯示公式」的地方。
 */
export function md(s: string): ReactNode {
  return mathText(s)
}

/** 與 useSettings().atLeast 相同，但在 SettingsProvider 之外不丟錯（預設 engineer）。 */
export function useAtLeast(min: LearningMode): boolean {
  try {
    return useSettings().atLeast(min)
  } catch {
    return min !== 'research'
  }
}

/**
 * 逐步推導（StepDerivation）外包一層可收合的框：
 * Beginner 預設收合（一鍵展開），Engineer / Research 預設展開（docs/teaching-style.md §6）。
 */
export function Steps({ title, steps, result, open }: { title: ReactNode; steps: Step[]; result?: string; open?: boolean }) {
  const engineer = useAtLeast('engineer')
  // 「為什麼」欄的字串也支援 $...$（StepDerivation 本身不會轉）
  const rendered = steps.map((s) => ({ tex: s.tex, why: mathText(s.why) }))
  return (
    <details className="models-steps" open={open ?? engineer}>
      <summary>
        <span className="models-steps-badge">逐步推導</span> {mathText(title)}
      </summary>
      <StepDerivation steps={rendered} result={result} />
    </details>
  )
}

/**
 * 方塊圖 + 「怎麼讀這張圖」導讀（docs/teaching-style.md §8）。
 * Mermaid 不渲染 KaTeX，圖上的符號是 Unicode；導讀用 KaTeX 把圖上的名字對回正文的公式。圖說（caption）是純文字。
 */
export function Diagram({ chart, caption, ariaLabel, children }: { chart: string; caption: string; ariaLabel?: string; children?: ReactNode }) {
  return (
    <div className="models-diagram">
      <Mermaid chart={chart} caption={caption} ariaLabel={ariaLabel ?? caption} />
      {children && <div className="models-diagram-walk">{children}</div>}
    </div>
  )
}

/** 勘誤小註：「勘誤 Exx」連到 #/verification（驗證頁依 id 列出勘誤）。 */
export function ErratumNote({ id, children }: { id: string; children?: ReactNode }) {
  return (
    <span className="models-erratum">
      <a href="#/verification" title={`本站與規格書不同之處，見驗證頁的勘誤 ${id}`}>
        勘誤 {id}
      </a>
      {children && <span className="models-erratum-text">{children}</span>}
    </span>
  )
}

/**
 * 「換你算」：一句引導 ＋ 帶入手算題（docs/teaching-style.md §7）。題目定義在 ./handcalcs.ts，這裡只負責依 id 取出並排版。
 * 放在對應推導的正後方：先看推導 → 馬上把數字代進去算一次。
 */
export function HandCalcSlot({ id, children }: { id: string; children?: ReactNode }) {
  return (
    <div className="models-handcalc" data-handcalc={id}>
      <p className="models-handcalc-lead small">
        <strong>換你算</strong>：{children ?? '把下面的數字換成你自己的，先用紙筆和計算機算一次，再對答案。'}按「自己算算看」可以先把詳解收起來，算完再按「對答案」；「換一題」會隨機出手算友善的數字。
      </p>
      <HandCalc def={handcalc(id)} />
    </div>
  )
}

/**
 * 「換你算」的指路版：這個公式的帶入手算題已經在別的章節（同一組數字），本頁不重複出題，只告訴讀者去哪裡算。
 */
export function HandCalcPointer({ children }: { children: ReactNode }) {
  return (
    <p className="models-handcalc-lead models-handcalc-pointer small" data-handcalc-pointer="">
      <strong>換你算</strong>：{children}
    </p>
  )
}

/** 章節連結（HashRouter 內用 Link） */
export function ChLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="models-chlink">
      {children}
    </Link>
  )
}

/** 有效位數（去尾端 0；非有限值明確顯示） */
export function sig(x: number, digits = 6): string {
  if (Number.isNaN(x)) return 'NaN'
  if (x === Infinity) return '∞'
  if (x === -Infinity) return '−∞'
  if (x === 0) return '0'
  const a = Math.abs(x)
  if (a >= 1e7 || a < 1e-5) return x.toExponential(digits - 1)
  return String(Number(x.toPrecision(digits)))
}

/** 固定小數位 */
export function fx(x: number, digits = 4): string {
  if (Number.isNaN(x)) return 'NaN'
  if (!Number.isFinite(x)) return x > 0 ? '∞' : '−∞'
  return x.toFixed(digits)
}

/** 千分位整數 */
export function int(x: number): string {
  if (!Number.isFinite(x)) return '—'
  return Math.round(x).toLocaleString('en-US')
}

/** 在 TeX 字串中使用的數字（科學記號轉成 \times 10^{…}） */
export function texNum(x: number, digits = 6): string {
  const s = sig(x, digits)
  const m = /^(-?[\d.]+)e([+-]\d+)$/.exec(s)
  if (!m) return s.replace('−', '-')
  return `${m[1]}\\times10^{${Number(m[2])}}`
}
