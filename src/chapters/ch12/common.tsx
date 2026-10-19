import type { ReactNode } from 'react'
import { HandCalc, Mermaid, StepDerivation, mathText, type Step } from '@/components'
import { useSettings, type LearningMode } from '@/app/settings'
import errata from '@/data/errata.json'
import { erfc } from '@/simulation/core'
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

/**
 * §12.1「適用範圍」的反例（技術審查 R06c）：±1 iid code、兩個 tap 的 path u[n] = c0·x[n] + c1·x[n−1]。
 * 固定點 w* = a、沒有 offset 時 comparator 的輸入是 e[n] = −δw·u[n] + v[n]（v 為 Gaussian，RMS σ_v），
 * 所以 E[q·x | δw] = E[x·erf(−δw·u/(√2σ_v))]。把 (x[n], x[n−1]) 四種組合各算一次 erf 再平均：
 *   E[G | δw] = −½[erf(d(c1 + c0)) − erf(d(c1 − c0))]，d = δw/(√2σ_v)。
 * 用 erfc 相減（erf(a) − erf(b) = erfc(b) − erfc(a)），避免兩個接近 1 的數相減把結果消光。
 * c1 = 0 時退回無記憶 path 的 −erf(c0·δw/(√2σ_v))（F-12.1 推導的第三步）。
 */
export function twoTapMeanG(c0: number, c1: number, dw: number, sigmaV: number): number {
  const d = dw / (Math.SQRT2 * sigmaV)
  return -0.5 * (erfc(d * (c1 - c0)) - erfc(d * (c1 + c0)))
}
/** 反例的數字（c0 = 0.001、c1 = 1、δw = 10 fs、σ_v = 1 fs）：|C·δw| = 0.01 fs 看似小訊號，|δw|·u_max = 10.01 fs 卻早已飽和。 */
export const TWO_TAP = (() => {
  const c0 = 0.001
  const c1 = 1
  const dw = 10
  const sigmaV = 1
  // K = K_q·C 與 N、f_s、μ 無關；這裡借用本章的 calLoop，確保和正文用的是同一個 K_q
  const K = calLoop({ N: EX_INPUT.N, fs: EX_INPUT.fs, mu: 1, sigmaV, C: c0 }).K
  const linear = -K * dw // F-12.1 的線性預測 −K·δw
  const exact = twoTapMeanG(c0, c1, dw, sigmaV)
  return {
    c0,
    c1,
    dw,
    sigmaV,
    /** C = E[x·u] = c0（x[n] 與 x[n−1] 獨立） */
    C: c0,
    K,
    linear,
    exact,
    /** 實際恢復力 ÷ F-12.1 的線性預測 */
    ratio: exact / linear,
    /** u 的峰值 |c0| + |c1| */
    uMax: Math.abs(c0) + Math.abs(c1),
    /** c0·d ≪ 1 時的近似 −K·δw·exp(−(c1·δw)²/(2σ_v²))：兩個 erf 的差 ≈ erf 在 c1·d 的斜率 × 2·c0·d */
    gauss: linear * Math.exp(-((c1 * dw) ** 2) / (2 * sigmaV * sigmaV)),
    /** δw = 1 fs 時「實際 ÷ 線性」（≈ e^{−1/2}）：線性範圍其實只到 |δw| ≪ σ_v/u_max */
    at1: twoTapMeanG(c0, c1, 1, sigmaV) / -K,
  }
})()

/**
 * 線性化 E[G] ≈ −K·δw 的相對誤差首項（±1 iid code、FIR path u[n] = Σ_m h_m·x[n−m]、Gaussian v）：
 *   erf(z) ≈ (2/√π)(z − z³/3) ⇒ E[x·erf(δw·u/(√2σ_v))] ≈ √(2/π)·(δw/σ_v)·[E[x·u] − δw²·E[x·u³]/(6σ_v²)]，
 *   E[x·u] = h_0、E[x·u³] = h_0·(h_0² + 3·Σ_{m≥1} h_m²)（x[n] 與前幾拍的 code 獨立、x² = 1），所以
 *   E[G | δw] ≈ −K·δw·[1 − δw²·(h_0² + 3·Σ_{m≥1} h_m²)/(6σ_v²)]，K = K_q·h_0。
 * 回傳方括號裡的第二項（負數）。無記憶 path（只有 h_0 = C）時是 −(C·δw)²/(6σ_v²)。
 */
export function cubicRelError(taps: readonly number[], dw: number, sigmaV: number): number {
  const tail = taps.slice(1).reduce((s, h) => s + h * h, 0)
  return -(dw * dw * (taps[0] * taps[0] + 3 * tail)) / (6 * sigmaV * sigmaV)
}
/** §12.1 Research 段落的數字：同一條兩個 tap 的 path，偏差縮小到 δw = 0.3 fs（展開還有效的範圍）。 */
export const TWO_TAP_SMALL = (() => {
  const { c0, c1, sigmaV, K } = TWO_TAP
  const dw = 0.3
  return {
    dw,
    /** 首項（三階展開） */
    lead: cubicRelError([c0, c1], dw, sigmaV),
    /** 完整 erf 平均的相對誤差：E[G]/(−K·δw) − 1 */
    exact: twoTapMeanG(c0, c1, dw, sigmaV) / (-K * dw) - 1,
    /** 對照：同樣的 δw、無記憶 path u = c0·x 的首項 */
    scalarLead: cubicRelError([c0], dw, sigmaV),
    /** 反例的 δw = 10 fs 代進首項：遠超出展開有效的範圍 */
    leadAtCounterexample: cubicRelError([c0, c1], TWO_TAP.dw, sigmaV),
  }
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

/**
 * 方塊圖 + 導讀（docs/teaching-style.md §8）：圖放在白話說明之後、推導之前。
 *  - chart：diagrams.ts 匯出的 Mermaid 原始碼（圖內標籤的數學寫 `$...$`，由共用的 Mermaid 元件以 KaTeX 排版）；
 *  - caption：一句話說明要看什麼；圖說支援 `$...$` 行內 KaTeX，所以圖對應的那條方程式直接寫在圖說裡（不用 Unicode 拼公式）；
 *  - children：「先看…再看…」的導讀，以及「圖上的 X 就是公式裡的 x」的對照（這裡的數學照常用 KaTeX）。
 */
export function Diagram({ chart, caption, ariaLabel, children }: { chart: string; caption: string; ariaLabel?: string; children: ReactNode }) {
  return (
    <div className="ch12-diagram">
      <Mermaid chart={chart} caption={caption} ariaLabel={ariaLabel} />
      <div className="ch12-diagram-read">{children}</div>
    </div>
  )
}

/** 本章符號表（章末）的錨點 id。HashRouter 下不能用 href="#symbols"（會被當成路由），所以一律用 scrollIntoView。 */
export const SYMBOLS_ID = 'symbols'

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
