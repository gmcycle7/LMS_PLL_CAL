import type { ReactNode } from 'react'
import { ChapterErratum, ChapterFig, ClaimTag, bindHandCalc, mathText, StepDerivation, Tex, TexBlock, type Step } from '@/components'
import { useSettings } from '@/app/settings'
import type { ClaimKind } from '@/data/types'
import { figNo, figRef } from './diagrams'
import { formulaById } from './formulas'
import { HANDCALCS } from './handcalcs'

/** TeX 字串（保留反斜線） */
export const T = String.raw

/**
 * 夾雜行內數學的文字（教學規範：內文的數學一律用 KaTeX）。
 * 用法：tx`把 $\delta_{n+1}=(1-\mu x_n^2)\delta_n$ 兩邊平方。` —— `$…$` 之間以 <Tex> 排版，其餘為一般文字。
 * 採 String.raw 語意（反斜線原樣保留）；`$` 不成對時丟出錯誤（單元測試會抓到）。
 */
export function tx(strings: TemplateStringsArray, ...vals: unknown[]): ReactNode {
  return texText(String.raw({ raw: strings.raw }, ...vals))
}

/** tx 的字串版本：src 中 `$…$` 為 TeX。 */
export function texText(src: string): ReactNode {
  const parts = src.split('$')
  if (parts.length % 2 === 0) throw new Error(`ch03 tx：$ 不成對：${src}`)
  return <>{parts.map((p, i) => (i % 2 ? <Tex key={i}>{p}</Tex> : p))}</>
}

/**
 * 方塊圖（Mermaid）＋ 圖號 ＋ 圖說（docs/teaching-style.md §8）。
 * 圖說交給共用 Mermaid 元件的 caption（放在 <figure> 裡的 <figcaption>；`$…$` 會以 KaTeX 排版，規範 §3），前面自動加上圖號。
 * chart 必須登錄在 diagrams.ts 的 DIAGRAMS（圖號由登錄順序決定；diagrams.test.tsx 檢查頁面順序與登錄順序一致）。
 * `$` 不成對時丟出錯誤（和 tx 一樣，由單元測試抓到），避免圖說裡留下沒有排版的 TeX。
 */
export function Fig({ chart, caption, ariaLabel }: { chart: string; caption: string; ariaLabel: string }) {
  return <ChapterFig chart={chart} label={figRef(chart)} caption={caption} ariaLabel={ariaLabel} dataAttrs={{ 'data-fig': String(figNo(chart)) }} />
}

/** 已登錄公式（formulas.ts）的獨立公式塊，附 ClaimTag 與勘誤連結 */
export function FBlock({ id, claim, note }: { id: string; claim?: ClaimKind; note?: ReactNode }) {
  const f = formulaById(id)
  return (
    <div className="ch03-fblock">
      <TexBlock id={id} label={mathText(f.title)}>
        {f.tex}
      </TexBlock>
      <div className="ch03-fblock-meta">
        <ClaimTag kind={claim ?? f.claim} />
        {f.erratumId && <ChapterErratum id={f.erratumId} />}
        <span className="small muted">{mathText(f.conditions)}</span>
        {note}
      </div>
    </div>
  )
}

/**
 * 「帶入手算」題（handcalcs.ts 的 HC-03.n）＋一句邀請，放在對應推導／worked example 的正後方。
 * children 可以換成更貼近該題的邀請文字（預設為通用版本）。
 */
export const HC = bindHandCalc(HANDCALCS)

/**
 * 逐步推導框：Engineer / Research 模式預設展開，Beginner 預設收合（一鍵展開）。
 * 內容用 StepDerivation（一步一行 + 一句理由）。
 */
export function StepsBox({ title, steps, result, children }: { title: ReactNode; steps: Step[]; result?: string; children?: ReactNode }) {
  const { atLeast, mode } = useSettings()
  const open = atLeast('engineer')
  return (
    <details className="ch03-steps" open={open} key={mode}>
      <summary>
        <span className="ch03-steps-title">{title}</span>
        {!open && <span className="ch03-steps-hint">（點開看逐步推導）</span>}
      </summary>
      <StepDerivation steps={steps} result={result} />
      {children}
    </details>
  )
}

/** 把 typed array 轉成 Plotly 可用的陣列：非有限值 → null（畫成斷點） */
export function finiteOrNull(a: ArrayLike<number>): (number | null)[] {
  return Array.from(a, (v) => (Number.isFinite(v) ? v : null))
}

/** 數值顯示：有限值用 toPrecision，否則顯示 ∞ / −∞ / — */
export function num(x: number, digits = 4): string {
  if (Number.isNaN(x)) return '—'
  if (x === Infinity) return '∞'
  if (x === -Infinity) return '−∞'
  if (x === 0) return '0'
  const a = Math.abs(x)
  if (a >= 1e6 || a < 1e-4) return x.toExponential(Math.max(0, digits - 1)).replace(/-/g, '−')
  return String(Number(x.toPrecision(digits))).replace(/-/g, '−')
}

/** 穩定 / 邊界 / 發散 的小標籤（文字 + 底色，不只靠顏色） */
export function Verdict({ value, threshold = 1, lowerIsStable = true }: { value: number; threshold?: number; lowerIsStable?: boolean }) {
  const eps = 1e-12 * Math.max(1, Math.abs(threshold))
  const edge = Math.abs(value - threshold) <= eps
  const stable = lowerIsStable ? value < threshold - eps : value > threshold + eps
  const cls = edge ? 'ch03-status-edge' : stable ? 'ch03-status-ok' : 'ch03-status-bad'
  const text = edge ? '邊界' : stable ? '收斂' : '發散'
  return <span className={`ch03-status ${cls}`}>{text}</span>
}

/**
 * 從 Python 原始檔擷取一個函式定義（golden 檔沒有 region 標記；這裡擷取的就是 golden 實際程式碼）。
 * 從 `def name(` 那一行開始，到下一個「不縮排的非空行」為止。
 */
export function pyDef(source: string, name: string): string {
  const lines = source.split('\n')
  const start = lines.findIndex((l) => l.startsWith(`def ${name}(`))
  if (start < 0) throw new Error(`找不到 Python 函式 ${name}`)
  let end = start + 1
  while (end < lines.length && (lines[end].trim() === '' || /^\s/.test(lines[end]))) end++
  while (end > start && lines[end - 1].trim() === '') end--
  return lines.slice(start, end).join('\n')
}

/** 等比 μ 網格（log 間距） */
export function logGrid(lo: number, hi: number, n: number): number[] {
  const r = Math.log(hi / lo)
  return Array.from({ length: n }, (_, i) => lo * Math.exp((r * i) / (n - 1)))
}

/** TeX 內用的數字（ASCII 負號；極大／極小值寫成 a\times10^{b}） */
export function tnum(x: number, digits = 4): string {
  if (Number.isNaN(x)) return '\\text{—}'
  if (x === Infinity) return '\\infty'
  if (x === -Infinity) return '-\\infty'
  if (x === 0) return '0'
  const a = Math.abs(x)
  if (a >= 1e6 || a < 1e-4) {
    const [m, e] = x.toExponential(Math.max(0, digits - 1)).split('e')
    return `${Number(m)}\\times10^{${Number(e)}}`
  }
  return String(Number(x.toPrecision(digits)))
}

/** 把 preset / 外部參數安全地合併到預設值（只接受同型別的鍵） */
export function mergeParams<P extends object>(base: P, raw: Record<string, unknown> | undefined): P {
  if (!raw) return base
  const out = { ...base } as Record<string, unknown>
  for (const [k, v] of Object.entries(raw)) {
    if (!(k in out)) continue
    const cur = out[k]
    if (typeof cur === 'number' && typeof v === 'number' && Number.isFinite(v)) out[k] = v
    else if (typeof cur === 'string' && typeof v === 'string') out[k] = v
    else if (typeof cur === 'boolean' && typeof v === 'boolean') out[k] = v
  }
  return out as P
}
