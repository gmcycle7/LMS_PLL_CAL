import type { ReactNode } from 'react'
import { useSettings, type LearningMode } from '@/app/settings'
import { HandCalc, Mermaid, mathText } from '@/components'
import { fmt } from '@/simulation/core'
import { diagram } from './diagrams'
import { handcalc } from './handcalcs'

/**
 * 方塊圖（docs/teaching-style.md §8）：圖 + 圖說（一句話說明要看什麼）+「怎麼看這張圖」的導讀。
 * 圖的原始碼、圖說與圖號都登錄在 ./diagrams.ts（依 id 取出，打錯會丟錯）；children 是導讀：
 * 先看哪裡、再看哪裡，以及「圖上的 X 就是公式裡的 x」的對應（可以用 <Tex>）。
 * 圖說前面要加粗體的圖號與種類（「圖 10-N（比較圖）」），所以由這裡自己排（`$...$` 用 mathText 以 KaTeX 顯示），不經 Mermaid 元件的 caption 屬性。
 */
export function Fig({ id, children }: { id: string; children: ReactNode }) {
  const dg = diagram(id)
  return (
    <div className="ch10-fig" data-diagram={dg.id} data-diagram-name={dg.name}>
      <Mermaid chart={dg.chart} ariaLabel={`圖 ${dg.no}：${dg.alt}`} />
      <p className="c-figcaption ch10-fig-caption">
        <strong>圖 {dg.no}</strong>（{dg.kind}）{mathText(dg.caption)}
      </p>
      <p className="ch10-fig-walk">
        <span className="ch10-fig-walk-badge">怎麼看這張圖</span> {children}
      </p>
    </div>
  )
}

/**
 * 正文裡提到別張圖時用它（「圖 10-N」）：圖號由登錄表的順序算出，中間插入或刪除一張圖時不會指錯。
 * 不要在正文手寫圖號（diagrams.test.tsx 會檢查頁面上沒有手寫的「圖 10-N」）。
 */
export function FigRef({ id }: { id: string }) {
  return (
    <span className="ch10-figref" data-figref={id}>
      圖 {diagram(id).no}
    </span>
  )
}

/** 按「本章符號表在最後」之前的捲動位置：章末的「回到剛才閱讀的位置」用它捲回去（沒按過就是 null）。 */
let lastReadY: number | null = null

function scrollBehavior(): ScrollBehavior {
  const reduce = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  return reduce ? 'auto' : 'smooth'
}

/** 捲到章末的符號表（id="symbols"）。HashRouter 的 # 已經被路由用掉，不能用 href="#symbols"，所以用按鈕 + scrollIntoView。 */
export function scrollToSymbols() {
  if (typeof document === 'undefined') return
  const el = document.getElementById('symbols')
  if (!el) return
  if (typeof window !== 'undefined' && Number.isFinite(window.scrollY)) lastReadY = window.scrollY
  if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
}

/** 從章末的符號表回到剛才閱讀的位置（沒有記錄時回到章首）。 */
export function scrollBackFromSymbols() {
  if (typeof window === 'undefined' || typeof window.scrollTo !== 'function') return
  window.scrollTo({ top: lastReadY ?? 0, behavior: scrollBehavior() })
}

/** 章首只留一行：「本章符號表在最後」（docs/teaching-style.md §5）。 */
export function SymbolsLink() {
  return (
    <p className="ch10-symbols-link small muted">
      <button type="button" className="ch10-linklike" onClick={scrollToSymbols}>
        本章符號表在最後 ↓
      </button>
      （每個符號第一次出現時，正文會先用一句話說明；忘了再到章末查）
    </p>
  )
}

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
