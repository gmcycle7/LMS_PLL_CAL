import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ClaimTag, mathText, Mermaid, ModelLevel, StepDerivation, accessibleText, type CheckStatus, type ClaimKind, type ModelLevelId, type Step } from '@/components'
import { useSettings, type LearningMode } from '@/app/settings'
import { texNum } from '@/simulation/models/unifiedLab'

/**
 * Unified Calibration Lab 頁（/lab）私有的小工具。
 * 建議上移到共用層（@/components）的：useAtLeast、Steps、ErratumNote、texifyShared（把共用模型的 Unicode 警告轉成 `$...$`）。
 */

/**
 * 字串內的 `$...$` 以行內 KaTeX 顯示（docs/teaching-style.md §3：數學一律 LaTeX），`**...**` 以粗體顯示。
 * 用在「以字串描述、但要顯示公式」的地方（表格資料、推導每一步的理由、模型回傳的訊息）。
 */
export function md(s: string): ReactNode {
  if (!s.includes('**')) return mathText(s)
  const parts = s.split(/\*\*(.+?)\*\*/g) // 奇數位置是粗體內容
  return (
    <>
      {parts.map((seg, i) => (i % 2 === 1 ? <strong key={i}>{mathText(seg)}</strong> : <Fragment key={i}>{mathText(seg)}</Fragment>))}
    </>
  )
}

/** 純文字版（Plotly 圖例、aria-label、匯出檔）：`$…$` 轉成可念的文字（accessibleText）。 */
export function plain(s: string): string {
  return accessibleText(s)
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
export function Steps({ title, steps, result, open }: { title: string; steps: { tex: string; why: string }[]; result?: string; open?: boolean }) {
  const engineer = useAtLeast('engineer')
  const rendered: Step[] = steps.map((s) => ({ tex: s.tex, why: md(s.why) }))
  return (
    <details className="lab-steps" open={open ?? engineer}>
      <summary>
        <span className="lab-steps-badge">逐步推導</span> {mathText(title)}
      </summary>
      <StepDerivation steps={rendered} result={result} />
    </details>
  )
}

/**
 * 方塊圖 + 「怎麼讀這張圖」導讀（docs/teaching-style.md §8）。
 * 圖上的數學在 diagrams.ts 以 `$...$` 寫 LaTeX、由 <Mermaid> 用 KaTeX 排版；導讀與圖說（caption 支援 `$…$`）用 KaTeX 把圖上的名字對回正文的公式。
 */
export function Diagram({ chart, caption, ariaLabel, children }: { chart: string; caption: string; ariaLabel?: string; children?: ReactNode }) {
  return (
    <div className="lab-diagram">
      <Mermaid chart={chart} caption={caption} ariaLabel={ariaLabel ?? caption} />
      {children && <div className="lab-diagram-walk">{children}</div>}
    </div>
  )
}

/** 勘誤小註：「勘誤 Exx」連到驗證頁（#/verification，依 id 定位）。 */
export function ErratumNote({ id }: { id: string }) {
  return (
    <a className="lab-erratum" href={`#/verification?e=${id}`} title={`本站與規格書不同之處：見驗證頁的勘誤 ${id}`}>
      勘誤 {id}
    </a>
  )
}

/** 章節連結（HashRouter 內用 Link） */
export function ChLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="lab-chlink">
      {children}
    </Link>
  )
}

/** 「這次我們要回答的問題」開場框 */
export function Question({ children }: { children: ReactNode }) {
  return (
    <div className="lab-question">
      <div className="lab-question-label">這次我們要回答的問題</div>
      {children}
    </div>
  )
}

/** 有效位數（去尾端 0；非有限值明確顯示） */
export function sig(x: number | null | undefined, digits = 5): string {
  if (x === null || x === undefined) return '—'
  if (Number.isNaN(x)) return 'NaN'
  if (x === Infinity) return '∞'
  if (x === -Infinity) return '−∞'
  if (x === 0) return '0'
  const a = Math.abs(x)
  if (a >= 1e7 || a < 1e-4) return x.toExponential(Math.max(0, digits - 1)).replace(/\.?0+e/, 'e')
  return String(Number(x.toPrecision(digits)))
}

/** 頻率的純文字（Hz / kHz / MHz / GHz） */
export function fmtHz(f: number | null | undefined, digits = 4): string {
  if (f === null || f === undefined || !Number.isFinite(f)) return '—'
  const a = Math.abs(f)
  if (a >= 1e9) return `${sig(f / 1e9, digits)} GHz`
  if (a >= 1e6) return `${sig(f / 1e6, digits)} MHz`
  if (a >= 1e3) return `${sig(f / 1e3, digits)} kHz`
  return `${sig(f, digits)} Hz`
}

/** 頻率的 TeX（含單位） */
export function texHz(f: number, digits = 4): string {
  if (!Number.isFinite(f)) return texNum(f)
  const a = Math.abs(f)
  if (a >= 1e9) return `${texNum(f / 1e9, digits)}\\,\\mathrm{GHz}`
  if (a >= 1e6) return `${texNum(f / 1e6, digits)}\\,\\mathrm{MHz}`
  if (a >= 1e3) return `${texNum(f / 1e3, digits)}\\,\\mathrm{kHz}`
  return `${texNum(f, digits)}\\,\\mathrm{Hz}`
}

export { texNum }

/* ------------------------------------------------------------------ */
/* 共用模型（blockLms / dsm）的 Unicode 警告 → `$...$`                  */
/* ------------------------------------------------------------------ */

/** 已知的數學片段（長的在前）→ TeX。只處理共用模型實際會輸出的寫法；其餘原樣保留。 */
const ATOMS: [RegExp, string][] = [
  [/H_PD\(z=1\)/g, 'H_{\\mathrm{PD}}(1)'],
  [/2sin\(π\/\(4d\+2\)\)/g, '2\\sin\\tfrac{\\pi}{4d+2}'],
  [/max\|x_ref\|/g, '\\max|x_{\\mathrm{ref}}|'],
  [/σ_η²/g, '\\sigma_\\eta^2'],
  [/σ_v/g, '\\sigma_v'],
  [/σ_w/g, '\\sigma_w'],
  [/x_ref/g, 'x_{\\mathrm{ref}}'],
  [/u_f/g, 'u_f'],
  [/Ĥ/g, '\\hat H'],
  [/w\*/g, 'w^*'],
  [/μ/g, '\\mu '],
  [/π/g, '\\pi '],
  [/²/g, '^2'],
  [/≤/g, '\\le '],
  [/≥/g, '\\ge '],
  [/≈/g, '\\approx '],
  [/≠/g, '\\ne '],
  [/−/g, '-'],
  [/·/g, '\\cdot '],
  [/±/g, '\\pm '],
]

const NUM = String.raw`[-−]?\d+(?:\.\d+)?(?:e[-+]?\d+)?`
const STRONG = String.raw`(?:H_PD\(z=1\)|2sin\(π\/\(4d\+2\)\)|max\|x_ref\||\|w\||\|G\||E\[[^\]]*\](?:\/2)?|σ_η²|σ_v|σ_w|K_q|w\*|x_ref|u_f|Ĥ|μK|μ\/N|μ)`
const WEAK = String.raw`(?<![A-Za-z_])[CgdNHqbap](?![A-Za-z_])`
const REL = String.raw`\s*(?:≤|≥|≈|≠|=|<|>|−)\s*`
/** 一段「數學 run」：強符號單獨成立；單一字母（C、g、d、N…）後面要接關係運算子才算。 */
const RUN = new RegExp(`(?:${STRONG}|${WEAK})(?:${REL}(?:${STRONG}|${WEAK}|${NUM}))+|${STRONG}|±1`, 'g')

function runToTex(run: string): string {
  let t = run
  for (const [re, tex] of ATOMS) t = t.replace(re, tex)
  // 科學記號 1.5e-7 → 1.5\times10^{-7}
  t = t.replace(/(\d(?:\.\d+)?)e([-+]?\d+)/g, (_, m: string, e: string) => `${m}\\times10^{${Number(e)}}`)
  return t.replace(/\s+/g, ' ').trim()
}

/**
 * 把共用模型（read-only 的 blockLms.ts / dsm.ts）輸出的 Unicode 數學片段包成 `$...$`，
 * 例如 'C ≤ 0：…' → '$C \le 0$：…'、'σ_v = 0' → '$\sigma_v = 0$'。已有的 `$...$` 段落不動。
 * 只做保守的片段轉換：認不得的文字原樣保留（寧可不轉，也不要轉錯）。
 */
export function texifyShared(s: string): string {
  if (!/[σμπ≤≥≈≠Ĥ±²]|_PD|K_q|x_ref|w\*|\|[wG]\||[CgdN] [=<>]/.test(s)) return s
  const parts = s.split(/((?<!\\)\$(?:[^$\\]|\\.)+?(?<!\\)\$)/g) // 奇數位置是既有的 $...$
  return parts.map((seg, i) => (i % 2 === 1 ? seg : seg.replace(RUN, (m) => `$${runToTex(m)}$`))).join('')
}

/* ------------------------------------------------------------------ */
/* 小型顯示元件                                                        */
/* ------------------------------------------------------------------ */

const STATUS_TEXT: Record<CheckStatus, string> = { ok: '一致', mismatch: '不一致', 'not-implemented': 'Not implemented', 'n/a': '不適用' }

/** 交叉比對狀態膠囊 */
export function StatusPill({ status }: { status: CheckStatus }) {
  return <span className={`lab-pill lab-pill-${status === 'n/a' ? 'na' : status}`}>{STATUS_TEXT[status]}</span>
}

/** 級別 + 結論標籤（stage 卡片標頭用） */
export function LevelClaim({ level, claim }: { level: ModelLevelId; claim?: ClaimKind }) {
  return (
    <span className="c-tag-row lab-inline-tags">
      <ModelLevel level={level} />
      {claim && <ClaimTag kind={claim} />}
    </span>
  )
}

/** 進度列（分段 worker 計算） */
export function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((100 * done) / total)) : 0
  return (
    <div className="lab-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={label}>
      <div className="lab-progress-bar" style={{ width: `${pct}%` }} />
      <span className="lab-progress-text small">
        {label}：{done} / {total}（{pct}%）
      </span>
    </div>
  )
}
