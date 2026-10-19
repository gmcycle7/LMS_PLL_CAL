import type { ReactNode } from 'react'
import { ChapterFig, FigRef as SharedFigRef, Tex, bindHandCalc, makeTexNum, mathText } from '@/components'
import { useSettings } from '@/app/settings'
import { fmt } from '@/simulation/core'
import { ch09Diagram } from './diagrams'
import { FORMULAS } from './formulas'
import { HANDCALCS } from './handcalcs'

/**
 * 公式登錄（formulas.ts）裡某個 ID 的 TeX：頁面上的 <TexBlock id="F-09.x"> 直接用它，
 * 確保章內顯示與 Formula & Unit Reference 頁是同一份原始碼（不會各改各的）。
 */
export function formulaTex(id: string): string {
  const f = FORMULAS.find((x) => x.id === id)
  if (!f) throw new Error(`Ch09 公式登錄中找不到 ${id}`)
  return f.tex
}

/** 行內數學的 tagged template：{m`\mathbf u[n]`}（等同 <Tex>{String.raw`…`}</Tex>） */
export function m(strings: TemplateStringsArray, ...values: unknown[]): ReactNode {
  return <Tex>{String.raw({ raw: strings.raw }, ...values)}</Tex>
}

/**
 * 參數控制項（ParamControl／SelectControl／ToggleControl）的 label 與 hint：字串裡的 `$…$` 以 KaTeX 顯示。
 * 這些屬性是 ReactNode，共用元件不會自動轉換；另外用 ariaLabel 傳入純文字名稱，螢幕閱讀器才讀得到。
 * 用法：label={mt`$\rho$（相關係數）`} ariaLabel="ρ（相關係數）"
 */
export function mt(strings: TemplateStringsArray, ...values: unknown[]): ReactNode {
  return mathText(String.raw({ raw: strings.raw }, ...values))
}

/**
 * 依學習模式決定推導預設展開與否（docs/teaching-style.md §6）：
 * Beginner 預設收合（一鍵展開）；Engineer / Research 預設展開。
 */
export function DerivBox({ title, children }: { title: ReactNode; children: ReactNode }) {
  const { mode } = useSettings()
  return (
    <details className="ch09-deriv" open={mode !== 'beginner'} key={mode}>
      <summary>
        <span className="ch09-deriv-badge">推導</span> {title}
        {mode === 'beginner' && <span className="small muted">（點開看逐步推導）</span>}
      </summary>
      <div className="ch09-deriv-body">{children}</div>
    </details>
  )
}

/**
 * 「帶入手算」題（docs/teaching-style.md §7）：放在對應推導／例子的正後方。
 * 先用一句話邀請讀者把數字換成自己的、用紙筆算過，再看網站逐步帶入；題目由 handcalcs.ts 依 ID 取出。
 */
export const HandCalcBox = bindHandCalc(HANDCALCS)

/**
 * 方塊圖（docs/teaching-style.md §8）：依代號從 diagrams.ts 取出 Mermaid 原始碼，並自動編上圖號（圖 9.n）。
 * children 是圖說（一句話說明要看什麼），可以放 <Tex>（{m`…`}）；圖本身的文字替代說明（aria-label）用 diagrams.ts 的 alt。
 */
export function Diagram({ id, children }: { id: string; children: ReactNode }) {
  const { def, number } = ch09Diagram(id)
  return (
    <ChapterFig chart={def.chart} label={`圖 9.${number}`} kind={def.kind} richCaption={children} ariaLabel={`圖 9.${number}：${def.alt}`} dataAttrs={{ 'data-diagram': id, 'data-kind': def.kind }} />
  )
}

/** 正文裡引用圖號（「圖 9.3」）：由 diagrams.ts 的清單算出，圖的順序調整時不必手動改字 */
export function FigRef({ id }: { id: string }) {
  return <SharedFigRef label={`圖 9.${ch09Diagram(id).number}`} />
}

/** 數字格式：有限值用 fmt，∞ 顯示為 ∞ */
export function num(x: number, digits = 4): string {
  if (x === Infinity) return '∞'
  if (x === -Infinity) return '−∞'
  if (Number.isNaN(x)) return '—'
  return fmt(x, digits)
}

/** TeX 內使用的數字：指數記號改成 ×10^{k}（fmt 的 '7.979e-5' 放進 TeX 會把 e 當成變數），∞ 改成 \infty（共用的 texNumber）。 */
export const texNum = makeTexNum(4)

/** 2×2 / 小矩陣的 TeX（bmatrix） */
export function texMatrix(A: number[][], digits = 4): string {
  return String.raw`\begin{bmatrix}${A.map((row) => row.map((v) => texNum(v, digits)).join('&')).join(String.raw`\\`)}\end{bmatrix}`
}

/** 欄向量的 TeX */
export function texVec(v: ArrayLike<number>, digits = 4): string {
  return String.raw`\begin{bmatrix}${Array.from(v)
    .map((x) => texNum(x, digits))
    .join(String.raw`\\`)}\end{bmatrix}`
}
