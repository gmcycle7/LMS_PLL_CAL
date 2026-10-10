import type { ReactNode } from 'react'
import { HandCalc, StepDerivation, mathText, type Step } from '@/components'
import { useSettings, type LearningMode } from '@/app/settings'
import errata from '@/data/errata.json'
import { HANDCALCS } from './handcalcs'
import {
  CODE_LABEL_TEX,
  REGIME_LABEL_TEX,
  calLoop,
  codeSpectraAnalytic,
  spurBeta,
  spurDbcBessel,
  spurDbcSmallAngle,
  type BwRegime,
  type CodeKind,
  type CodeSpectraResult,
} from '@/simulation/models/calNoise'

/** 本章的 T13 / T14 標準例（規格 §12.1；條件依勘誤 E30）——所有內文數字都由這裡計算，不手打。 */
export const EX_INPUT = { N: 4096, fs: 4e9, mu: 10, sigmaV: 100, C: 1 } as const
export const EX = calLoop(EX_INPUT)
/** §12.4 spur 例：f_out = 13 GHz、A_t = 0.5 fs peak、|T| = 1 */
export const SPUR = (() => {
  const beta = spurBeta(13e9, 0.5, 1)
  return { fOut: 13e9, at: 0.5, beta, dbc: spurDbcSmallAngle(beta), dbcBessel: spurDbcBessel(beta) }
})()

/** 三種 code 表的條件：f_x = 100 kHz、A = 1、in-band 0…1 MHz、type-II PLL f_3dB,T = 1 MHz、ζ = 0.707、jitter 1 kHz–100 MHz */
export const CODE_TABLE_PRM = {
  ...EX_INPUT,
  fx: 1e5,
  toneA: 1,
  fBw: 1e6,
  pll: { f3dbT: 1e6, zeta: 0.707 },
  fL: 1e3,
  fH: 1e8,
}
let codeTableCache: CodeSpectraResult | null = null
/** 三種 code 表（數值積分約數十 ms；第一次呼叫時計算並快取） */
export function codeTable(): CodeSpectraResult {
  codeTableCache ??= codeSpectraAnalytic(CODE_TABLE_PRM)
  return codeTableCache
}

/** 學習模式（在 SettingsProvider 外時回傳 engineer，避免單元測試或預覽丟錯）。 */
export function useMode(): LearningMode {
  try {
    return useSettings().mode
  } catch {
    return 'engineer'
  }
}

interface ErratumRecord {
  eid: string
  problem: string
  correction: string
}

/** 「勘誤 Exx」小標：連到驗證頁（勘誤列表依 id 排列），滑鼠停留顯示修正摘要。 */
export function Erratum({ id }: { id: string }) {
  const rec = (errata as { errata: ErratumRecord[] }).errata.find((e) => e.eid === id)
  const tip = rec ? `${rec.correction.slice(0, 280)}${rec.correction.length > 280 ? '…' : ''}` : undefined
  return (
    <a className="ch12-erratum" href="#/verification" title={tip}>
      勘誤 {id}
    </a>
  )
}

/**
 * 依學習模式呈現的逐步推導：Beginner 預設收合（一鍵展開），Engineer / Research 直接展開。
 * 每一步都是一行公式 + 一句理由（docs/teaching-style.md §2-3）。
 */
export function Steps({ title, steps, result }: { title: ReactNode; steps: Step[]; result?: string }) {
  const mode = useMode()
  const body = <StepDerivation title={title} steps={steps} result={result} />
  if (mode !== 'beginner') return body
  return (
    <details className="ch12-fold">
      <summary>展開推導：{title}</summary>
      {body}
    </details>
  )
}

/**
 * 「帶入手算」題（docs/teaching-style.md §7）：依 ID 從本章題庫 handcalcs.ts 取出題目，放在對應推導／範例的正後方。
 * children 是一句邀請讀者「換成自己的數字、先用紙筆算一次」的話。
 */
export function Hand({ id, children }: { id: string; children: ReactNode }) {
  const def = HANDCALCS.find((h) => h.id === id)
  if (!def) throw new Error(`第 12 章沒有手算題 ${id}（請檢查 handcalcs.ts）`)
  return (
    <div className="ch12-hand">
      <p className="ch12-hand-invite">{children}</p>
      <HandCalc def={def} />
    </div>
  )
}

/** 有效位數格式化（不用科學記號，除非數值太大或太小） */
export function sig(x: number, digits = 4): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? '—' : x > 0 ? '∞' : '−∞'
  if (x === 0) return '0'
  const a = Math.abs(x)
  if (a >= 1e6 || a < 1e-4) {
    const [m, e] = x.toExponential(digits - 1).split('e')
    return `${m}\\times10^{${Number(e)}}`
  }
  return Number(x.toPrecision(digits)).toString()
}

/** 純文字版（非 TeX）有效位數 */
export function sigText(x: number, digits = 4): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? '—' : x > 0 ? '∞' : '−∞'
  if (x === 0) return '0'
  const a = Math.abs(x)
  if (a >= 1e6 || a < 1e-4) return x.toExponential(digits - 1).replace('e', '×10^')
  return Number(x.toPrecision(digits)).toString()
}

/** Hz → kHz 文字（TeX 用） */
export function kHz(x: number, digits = 5): string {
  return sig(x / 1e3, digits)
}

/** 相對誤差（%） */
export function relPct(a: number, ref: number, digits = 3): string {
  return sig(((a - ref) / ref) * 100, digits)
}

/**
 * 把含 $…$ 的說明文字轉成「文字 + 行內 KaTeX」：md('因為 $|x|=1$，所以…')。
 * 讓逐步推導的理由也遵守「所有數學一律 LaTeX」（docs/teaching-style.md §3）。
 * 直接委派給共用層的 mathText（@/components），配對規則與字串屬性完全一致。
 */
export function md(s: string): ReactNode {
  return mathText(s)
}

/** 三種 code 的顯示名稱（表格用；數學部分以 KaTeX 呈現）。純文字版 CODE_LABEL 留給 Plotly 圖例。 */
export function codeLabel(kind: CodeKind): ReactNode {
  return mathText(CODE_LABEL_TEX[kind])
}

/** H_{η→w} 型態的顯示名稱（E27 的 UI 規則；表格用）。 */
export function regimeLabel(regime: BwRegime): ReactNode {
  return mathText(REGIME_LABEL_TEX[regime])
}
