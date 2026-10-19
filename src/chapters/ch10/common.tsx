import type { ReactNode } from 'react'
import { useSettings, type LearningMode } from '@/app/settings'
import { ChapterFig, FigRef as SharedFigRef, bindHandCalc, mathText } from '@/components'
import { fmt } from '@/simulation/core'
import { diagram } from './diagrams'
import { HANDCALCS } from './handcalcs'

/**
 * 方塊圖（docs/teaching-style.md §8）：圖 + 圖說（一句話說明要看什麼）+「怎麼看這張圖」的導讀（共用的 ChapterFig）。
 * 圖的原始碼、圖說與圖號都登錄在 ./diagrams.ts（依 id 取出，打錯會丟錯）；children 是導讀：
 * 先看哪裡、再看哪裡，以及「圖上的 X 就是公式裡的 x」的對應（可以用 <Tex>）。
 * 圖說前面是圖號與種類（「圖 10-N（比較圖）｜…」），`$...$` 由 KaTeX 排版。
 */
export function Fig({ id, children }: { id: string; children: ReactNode }) {
  const dg = diagram(id)
  return (
    <ChapterFig
      chart={dg.chart}
      label={`圖 ${dg.no}`}
      kind={dg.kind}
      caption={dg.caption}
      ariaLabel={`圖 ${dg.no}：${dg.alt}`}
      dataAttrs={{ 'data-diagram': dg.id, 'data-diagram-name': dg.name }}
    >
      {children}
    </ChapterFig>
  )
}

/**
 * 正文裡提到別張圖時用它（「圖 10-N」）：圖號由登錄表的順序算出，中間插入或刪除一張圖時不會指錯。
 * 不要在正文手寫圖號（diagrams.test.tsx 會檢查頁面上沒有手寫的「圖 10-N」）。
 */
export function FigRef({ id }: { id: string }) {
  return <SharedFigRef label={`圖 ${diagram(id).no}`} dataAttrs={{ 'data-figref': id }} />
}

/**
 * 「換你算」：放在對應推導／worked example 的正後方（docs/teaching-style.md §7）。
 * 先用一句話邀請讀者把數字換成自己的、用紙筆和計算機算一次，再對照網站的逐步帶入；題目定義在 ./handcalcs.ts（依 id 取出，打錯會丟錯）。
 */
export const Hand = bindHandCalc(HANDCALCS)

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

/**
 * pole、$\rho(\mathbf A)$ 這類「和 1 比大小」的無因次量：絕對值小於 10⁻¹² 的是浮點殘餘，顯示成 0。
 * 例：deadbeat（$\gamma=1$）的 pole $1-\gamma=0$ 會被算成 1.1e−16 或 5.6e−17。只用在顯示，不改模型的數值。
 */
export function chop(x: number, tol = 1e-12): number {
  return Math.abs(x) < tol ? 0 : x
}

/**
 * 矩陣 → TeX bmatrix。比最大元素小 12 個數量級以上的元素視為浮點殘餘、顯示為 0（例如 8.7e−19）。
 * minScale：矩陣本來的量級（例如 $\mathbf A=\mathbf I+\mathbf M\mathbf J$ 是 1）。整個矩陣數學上是 0 時（deadbeat），
 * 最大元素自己就是殘餘，要靠它才清得掉。
 */
export function texMat(A: number[][], digits = 4, minScale = 0): string {
  const scale = Math.max(minScale, ...A.flat().map((v) => (Number.isFinite(v) ? Math.abs(v) : 0)))
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
