import type { ReactNode } from 'react'
import { useSettings, type LearningMode } from '@/app/settings'
import { HandCalc, Tex } from '@/components'
import { fmt } from '@/simulation/core'
import {
  STRATEGY_LABEL,
  type QuantLabParams,
  type QuantStrategy,
} from '@/simulation/models/quantizer'
import { HANDCALCS } from './handcalcs'

/**
 * 第 13 章共用的小元件與預設參數（只在本章使用）。
 */

/**
 * 「帶入手算」題：依 id 從本章的 HANDCALCS 取出並顯示（docs/teaching-style.md §7）。
 * children 是放在題目前面的一句話：邀請讀者把數字換成自己的，先用紙筆算一次再對答案。
 */
export function Hand({ id, children }: { id: string; children?: ReactNode }) {
  const def = HANDCALCS.find((h) => h.id === id)
  if (!def) return null
  return (
    <div className="ch13-hand">
      <p className="small ch13-hand-invite">
        <strong>換你算：</strong>
        {children ?? '把下面的數字換成你自己的，先用紙筆和計算機算一次，再和網站的每一步對答案。'}
      </p>
      <HandCalc def={def} />
    </div>
  )
}

/** 「勘誤 Exx」小標，連到驗證頁（勘誤依 id 列在 #/verification）。 */
export function Erratum({ id, children }: { id: string; children?: ReactNode }) {
  return (
    <a className="ch13-erratum" href="#/verification" title={`docs/validation.md ${id}：本站採用修正後的版本`}>
      勘誤 {id}
      {children ? <span className="ch13-erratum-note">：{children}</span> : null}
    </a>
  )
}

/**
 * 依學習模式決定預設展開的推導框：Beginner 收合、Engineer 以上展開（docs/teaching-style.md §6）。
 * 使用者手動開關後以 DOM 狀態為準；切換模式時以 key 重設。
 */
export function Fold({
  title,
  openFrom = 'engineer',
  children,
  className,
}: {
  title: ReactNode
  openFrom?: LearningMode
  children: ReactNode
  className?: string
}) {
  const { atLeast, mode } = useSettings()
  return (
    <details key={mode} className={`ch13-fold${className ? ` ${className}` : ''}`} open={atLeast(openFrom)}>
      <summary>{title}</summary>
      <div className="ch13-fold-body">{children}</div>
    </details>
  )
}

/**
 * 把含 `$…$` 的說明文字轉成「文字 + 行內 KaTeX」，讓理由句子裡的數學也用 LaTeX（teaching-style §3）。
 * 例：tx(String.raw`分子 $e^{-j2\pi k}=1$，所以常數項為 0。`)
 */
export function tx(s: string): ReactNode {
  const parts = s.split(/\$([^$]+)\$/g)
  return <>{parts.map((part, i) => (i % 2 ? <Tex key={i}>{part}</Tex> : part))}</>
}

/**
 * 「線功率 @ 頻率」的表格格子：頻率以 code 更新率 $f_u$ 的倍數表示（單位符號用 LaTeX）。
 * 例：<SpurAt power={0.2094} fRel={0.4} /> → 0.2094 @ 0.400 f_u
 */
export function SpurAt({ power, fRel, digits = 3, fDigits = 3 }: { power: number; fRel: number; digits?: number; fDigits?: number }) {
  return (
    <span className="nowrap">
      {num(power, digits)} @ <Tex>{`${fx(fRel, fDigits)}\\,f_u`}</Tex>
    </span>
  )
}

/** 表頭用的單位（LaTeX）：<Unit>{'LSB^2'}</Unit> → [LSB²]。 */
export function Unit({ children }: { children: string }) {
  return <Tex>{`[\\mathrm{${children}}]`}</Tex>
}

/** 數字格式（有效位數）。 */
export function n(x: number | null | undefined, digits = 4): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '—'
  return fmt(x, digits)
}

/** 表格 / 內文用的數字：一般情況是純文字；需要指數記號時改用 LaTeX（$a\\times10^{k}$），不顯示程式語言的 1.2e-6。 */
export function num(x: number | null | undefined, digits = 4): ReactNode {
  const s = n(x, digits)
  return /e/.test(s) ? <Tex>{ntex(x, digits)}</Tex> : s
}

/** 給 TeX 用的數字：指數記號寫成 \\times10^{k}（例如 8.37e-6 → 8.37\\times10^{-6}）。 */
export function ntex(x: number | null | undefined, digits = 4): string {
  const s = n(x, digits)
  const m = /^(-?[\d.]+)e(-?\d+)$/.exec(s)
  return m ? `${m[1]}\\times10^{${m[2]}}` : s === '—' ? '\\text{—}' : s
}

/**
 * 圖例／圖標題用：把策略名稱裡的「ΔΣ」換成 `$\Delta\Sigma$`（Plot 會轉成符號）。
 * 網頁上的表格、選單與 aria-label 仍用純文字的 STRATEGY_LABEL。
 */
export function texLabel(s: string): string {
  return s.replace(/ΔΣ/g, () => String.raw`$\Delta\Sigma$`)
}

/** 固定小數位數（表格對齊用）。 */
export function fx(x: number | null | undefined, digits = 4): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '—'
  if (Object.is(x, -0) || Math.abs(x) < 0.5 * 10 ** -digits) return (0).toFixed(digits)
  return x.toFixed(digits)
}

/** dB（10log10）。 */
export function db(x: number): string {
  return x > 0 ? (10 * Math.log10(x)).toFixed(2) : '−∞'
}

/** 本章範例共用的示例 Δ_LSB（fs/LSB；與 blockLms 的 gain_lsb_fs 預設一致，勘誤 E13）。 */
export const LSB_FS_EXAMPLE = 0.125

/** 實驗預設參數（Gallery #10：常數 32.4、五策略比較）。 */
export const DEFAULT_LAB_PARAMS: QuantLabParams = {
  target: 32.4,
  bits: 6,
  rounding: 'nearest',
  overflow: 'saturate',
  antiWindup: false,
  arithmetic: 'rational',
  fracBits: 10,
  length: 16384,
  fs: 100e6,
  nUpd: 1,
  lmsNoise: false,
  sigmaW: 0.2,
  pole: 0.9202,
  driftPerK: 0,
  lmsFreezeAt: 0,
  togglePeriod: 5,
  toggleOrder: 'spread',
  randomSource: 'ideal',
  prbsBits: 7,
  ditherLsb: 1,
  ditherPdf: 'uniform',
  lsbFs: LSB_FS_EXAMPLE,
  mixing: true,
  dsmKind: 'first_order',
  // FCW frac = 13/128：20-bit DSM 可以精確表示、residue 週期只有 128 個 cycle，所有混頻產物都落在 f_s/640 的倍數上，
  // 用 2^15 以上的紀錄就解析得出來。（frac = 0.1 看起來更「漂亮」，但 K = round(0.1·2^20) 讓 residue 週期變成 2^19，
  // 與 toggle 的差頻慢到紀錄內看不見——那是 §13.5b「FCW 陷阱」的示範。）
  dsmFrac: 13 / 128,
  pllBwHz: 1e6,
  pllZeta: 0.7,
  mixSamples: 1 << 18,
  nperseg: 4096,
  seed: 20261010,
  rInit: 0,
  traceLen: 160,
}

export const STRATEGY_OPTIONS: { value: QuantStrategy; label: string }[] = (
  ['freeze', 'toggle', 'stochastic', 'deltaSigma', 'deltaSigmaDither'] as QuantStrategy[]
).map((s) => ({ value: s, label: STRATEGY_LABEL[s] }))

/** 五個策略的固定顏色索引（useThemeTokens().series）。 */
export const STRATEGY_COLOR: Record<QuantStrategy, number> = {
  freeze: 4,
  toggle: 0,
  stochastic: 3,
  deltaSigma: 1,
  deltaSigmaDither: 2,
}
