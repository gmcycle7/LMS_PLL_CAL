import type { ReactNode } from 'react'
import { useSettings, type LearningMode } from '@/app/settings'
import { HandCalc, mathText } from '@/components'
import { fmt } from '@/simulation/core'
import { handcalc } from './handcalcs'

/**
 * 「換你算」：放在對應推導／worked example 的正後方（docs/teaching-style.md §7）。
 * 先用一句話邀請讀者把數字換成自己的、用紙筆和計算機算一次，再對照網站的逐步帶入；題目定義在 ./handcalcs.ts（依 id 取出，打錯會丟錯）。
 */
export function Hand({ id, children }: { id: string; children?: ReactNode }) {
  return (
    <div className="ch10-hand" data-handcalc={id}>
      <p className="ch10-hand-invite">
        <strong>換你算：</strong>
        {children ?? '把下面的數字換成你自己的，先用紙筆和計算機算一次，再展開步驟對答案。'}
      </p>
      <HandCalc def={handcalc(id)} />
    </div>
  )
}

/** 勘誤標記：連到 Verification 頁的勘誤列表（依 id）。 */
export function Erratum({ id, title }: { id: string; title?: string }) {
  return (
    <a className="ch10-erratum" href="#/verification" title={title ?? `docs/validation.md 勘誤 ${id}：本站採用修正後版本`}>
      勘誤 {id}
    </a>
  )
}

/** 內文／表格用的數字格式（有效位數；去尾零）。負號一律用數學負號 U+2212（−），不用連字號；TeX 字串請改用 tn()。 */
export function n(x: number | null | undefined, digits = 4): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '—'
  if (!Number.isFinite(x)) return x > 0 ? '∞' : '−∞'
  return fmt(x, digits).replace(/-/g, '−')
}

/** 用於 TeX 字串的數字（負號用 '-'，指數用 \times 10^{}） */
export function tn(x: number | null | undefined, digits = 4): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '\\text{—}'
  if (!Number.isFinite(x)) return x > 0 ? '\\infty' : '-\\infty'
  const s = fmt(x, digits)
  const m = /^(-?[\d.]+)e([+-]?\d+)$/.exec(s)
  if (m) return `${m[1]}\\times10^{${Number(m[2])}}`
  return s
}

/** 整數加千分位（TeX 用 {,}） */
export function tint(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '\\infty'
  return Math.round(x)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '{,}')
}

/** 整數加千分位（純文字） */
export function nint(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '∞'
  return Math.round(x).toLocaleString('en-US')
}

/** 矩陣 → TeX bmatrix。比最大元素小 12 個數量級以上的元素視為浮點殘餘、顯示為 0（例如 8.7e−19）。 */
export function texMat(A: number[][], digits = 4): string {
  const scale = Math.max(0, ...A.flat().map((v) => (Number.isFinite(v) ? Math.abs(v) : 0)))
  const clean = (v: number) => (Number.isFinite(v) && Math.abs(v) < 1e-12 * scale ? 0 : v)
  return `\\begin{bmatrix}${A.map((r) => r.map((v) => tn(clean(v), digits)).join('&')).join('\\\\')}\\end{bmatrix}`
}

/** 向量 → TeX 行向量（轉置成欄） */
export function texVec(v: number[], digits = 4): string {
  return `\\begin{bmatrix}${v.map((x) => tn(x, digits)).join('\\\\')}\\end{bmatrix}`
}

/**
 * 推導框：Beginner 預設收合（一鍵展開），Engineer / Research 預設展開（docs/teaching-style.md §6）。
 * title 若是字串，其中的 `$...$` 以 KaTeX 顯示（mathText；docs/teaching-style.md §3）。
 */
export function Deriv({ title, children, min = 'engineer' }: { title: ReactNode; children: ReactNode; min?: LearningMode }) {
  const { atLeast } = useSettings()
  return (
    <details className="ch10-deriv" open={atLeast(min)}>
      <summary>
        <span className="ch10-deriv-badge">推導</span> {mathText(title)}
      </summary>
      <div className="ch10-deriv-body">{children}</div>
    </details>
  )
}

/**
 * 進階內容：達到 min 模式時直接顯示；較低模式時收合成一個可展開的框（一鍵展開，docs/teaching-style.md §6）。
 * 用在「內含已登錄公式（F-10.x）」的進階段落：公式錨點在所有模式都存在，內文與實驗裡的 F-10.x 連結不會失效。
 */
export function Advanced({ min, title, children }: { min: LearningMode; title: ReactNode; children: ReactNode }) {
  const { atLeast } = useSettings()
  if (atLeast(min)) return <>{children}</>
  return (
    <details className="ch10-deriv">
      <summary>
        <span className="ch10-deriv-badge">{min === 'research' ? 'Research' : 'Engineer'} 進階</span> {mathText(title)}
      </summary>
      <div className="ch10-deriv-body">{children}</div>
    </details>
  )
}

/** 小標籤列 */
export function TagRow({ children }: { children: ReactNode }) {
  return <div className="c-tag-row ch10-tags">{children}</div>
}

/** 「試試看」提示 */
export function TryIt({ children }: { children: ReactNode }) {
  return (
    <div className="ch10-tryit">
      <span className="ch10-tryit-badge">試試看</span> {children}
    </div>
  )
}

/**
 * 從 golden/lms_pll_golden/mimo.py（?raw）取出「§10 Preconditioner」之後的段落（Preconditioner + §10.2 Jacobian）。
 * golden 檔沒有 #region 標記（不屬於本章），所以用段落標題切；找不到標題時退回整個檔案（仍是真實的 golden 程式碼）。
 */
export function goldenSection10(src: string): string {
  const i = src.indexOf('# §10 Preconditioner')
  if (i < 0) return src
  const rule = src.lastIndexOf('\n# ---', i)
  return src.slice(rule >= 0 ? rule + 1 : i).trimEnd()
}
