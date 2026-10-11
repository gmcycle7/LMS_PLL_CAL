import { Fragment, type ReactNode } from 'react'
import { useSettings } from '@/app/settings'
import { HandCalc, Mermaid, Tex, type ExperimentPreset } from '@/components'
import type { PresetEntry } from '@/data/types'
import { fmt } from '@/simulation/core'
import type { AlgoId } from '@/simulation/models/sgd'
import { DIAGRAM_BY_ID, type DiagramId } from './diagrams'
import { HANDCALCS } from './handcalcs'

/** 勘誤小標：連到驗證頁（驗證頁依 id 列出勘誤）。 */
export function ErrataNote({ id, children }: { id: string; children?: ReactNode }) {
  return (
    <a className="ch02-erratum" href="#/verification" title={`本段依 docs/validation.md 勘誤 ${id} 修正`}>
      勘誤 {id}
      {children ? <span className="ch02-erratum-text">：{children}</span> : null}
    </a>
  )
}

/** 章節內連結（HashRouter）。 */
export function ChapterLink({ ch, children }: { ch: string; children: ReactNode }) {
  return <a href={`#/ch/${ch}`}>{children}</a>
}

/** 每個演算法固定一個顏色（--series-1..6 的索引），所有圖一致。 */
export const ALGO_SERIES: Record<AlgoId, number> = { lms: 0, sign_error: 1, sign_sign: 2, nlms: 3, huber: 4 }

/** Case A / B / C 的線型 */
export const CASE_DASH = ['solid', 'dash', 'dot'] as const

/** 顯示用數字（4 位有效數字；NaN → —） */
export function f4(x: number, digits = 4): string {
  return Number.isFinite(x) ? fmt(x, digits) : Number.isNaN(x) ? '—' : fmt(x, digits)
}

/**
 * 數字 → TeX 片段（放進 `$...$` 字串用）：科學記號改成 a×10^b，±∞ 與 NaN 轉成 TeX。
 * 例：tn(1.2e-7) → '1.2\\times10^{-7}'、tn(Infinity) → '\\infty'。
 */
export function tn(x: number, digits = 4): string {
  if (Number.isNaN(x)) return String.raw`\text{—}`
  if (!Number.isFinite(x)) return x > 0 ? String.raw`\infty` : String.raw`-\infty`
  const s = fmt(x, digits)
  const m = /^(-?[\d.]+)e(-?\d+)$/.exec(s)
  return m ? String.raw`${m[1]}\times10^{${m[2]}}` : s
}

/** 把 PresetEntry 轉成 ExperimentShell 的 presets 格式 */
export function toShellPresets(list: PresetEntry[]): ExperimentPreset[] {
  return list.map((p) => ({ name: p.title, params: p.params, description: p.description }))
}

/** 0…N 的整數索引陣列 */
export function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i)
}

/** 降取樣（保留端點），避免把數萬點全部丟給 Plotly */
export function decimate(n: number, maxPts = 3000): number[] {
  if (n <= maxPts) return range(n)
  const stride = Math.ceil(n / maxPts)
  const out: number[] = []
  for (let i = 0; i < n; i += stride) out.push(i)
  if (out[out.length - 1] !== n - 1) out.push(n - 1)
  return out
}

/** 數學上的 sign(0) 慣例說明（E40） */
export const TIE_LABEL = {
  zero: 'sign(0)=0（數學次梯度）',
  plus: 'sign(0)=+1（comparator tie → +1）',
  minus: 'sign(0)=−1（comparator tie → −1）',
} as const

/** 字串屬性（assumptions、warnings…）用：`$...$` 會被共用元件以 KaTeX 顯示。 */
export const TIE_MATH = {
  zero: String.raw`$\operatorname{sign}(0)=0$（數學次梯度）`,
  plus: String.raw`$\operatorname{sign}(0)=+1$（comparator：tie 輸出 $+1$）`,
  minus: String.raw`$\operatorname{sign}(0)=-1$（comparator：tie 輸出 $-1$）`,
} as const

/** 表格／內文用的 sign(0) 慣例說明（數學部分用 KaTeX；控制項的下拉選單只能放純文字，用上面的 TIE_LABEL）。 */
const TIE_TEX = {
  zero: { tex: String.raw`\operatorname{sign}(0)=0`, text: '數學次梯度', out: '' },
  plus: { tex: String.raw`\operatorname{sign}(0)=+1`, text: 'comparator：tie 輸出 ', out: '+1' },
  minus: { tex: String.raw`\operatorname{sign}(0)=-1`, text: 'comparator：tie 輸出 ', out: '-1' },
} as const

export function TieLabel({ tie }: { tie: keyof typeof TIE_TEX }) {
  return (
    <>
      <Tex>{TIE_TEX[tie].tex}</Tex>（{TIE_TEX[tie].text}
      {TIE_TEX[tie].out && <Tex>{TIE_TEX[tie].out}</Tex>}）
    </>
  )
}

/** 控制項標籤：畫面上用 KaTeX（`$...$`），aria-label 用純文字（螢幕閱讀器與測試查詢用）。 */
export function lab(texLabel: string, plain: string): { label: ReactNode; ariaLabel: string } {
  return { label: tm(texLabel), ariaLabel: plain }
}

/**
 * 推導摺疊框：Beginner 模式預設收合（一鍵展開），Engineer / Research 預設展開（docs/teaching-style.md §6）。
 * 三種模式顯示的是同一份推導，只改變預設狀態。
 */
export function DerivFold({ title = '一步一步推導', children }: { title?: ReactNode; children: ReactNode }) {
  const { atLeast } = useSettings()
  return (
    <details className="ch02-fold" open={atLeast('engineer')}>
      <summary>{title}</summary>
      <div className="ch02-fold-body">{children}</div>
    </details>
  )
}

/**
 * 「帶入手算」題（docs/teaching-style.md §7）：依 ID 從本章的 HANDCALCS 取出題目，放在對應推導／例子的正後方。
 * children 是一句引言：說明這一題對應哪個公式，並請讀者先換成自己的數字用紙筆算一次。
 */
export function HandCalcSlot({ id, children }: { id: string; children?: ReactNode }) {
  const def = HANDCALCS.find((h) => h.id === id)
  if (!def) throw new Error(`ch02：找不到手算題 ${id}`)
  return (
    <div className="ch02-handcalc" data-handcalc={id}>
      <p className="ch02-handcalc-lead">
        <strong>換你算：</strong>
        {children ?? '把數字換成你自己的，先用紙筆算一次，再展開步驟對答案。'}
      </p>
      <HandCalc def={def} />
    </div>
  )
}

/**
 * 方塊圖（docs/teaching-style.md §8）：依 ID 從 diagrams.ts 取出 Mermaid 原始碼與圖說。
 * children 是緊跟在圖後面的「看圖說明」：先看哪裡、再看哪裡，以及圖上的訊號對應公式裡的哪個符號
 * （圖內的節點文字不渲染 KaTeX，用 Unicode 數學符號；這段說明與圖說裡的數學都用 `$...$`）。
 */
export function Diagram({ id, children }: { id: DiagramId; children?: ReactNode }) {
  const d = DIAGRAM_BY_ID[id]
  return (
    <div className="ch02-diagram" data-diagram={id}>
      <Mermaid chart={d.chart} caption={d.caption} />
      {children ? <div className="ch02-diagram-walk">{children}</div> : null}
    </div>
  )
}

/**
 * 頁內跳轉（HashRouter 下不能用 href="#id"：那會改變路由）。改用按鈕 + scrollIntoView；
 * jsdom 沒有實作 scrollIntoView，所以先確認函式存在。捲過去之後把焦點移到目標，鍵盤與螢幕閱讀器才會跟著過去。
 */
export function JumpTo({ target, children }: { target: string; children: ReactNode }) {
  return (
    <button
      type="button"
      className="ch02-jump"
      data-jump={target}
      onClick={() => {
        const el = document.getElementById(target)
        if (!el) return
        if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        el.focus({ preventScroll: true })
      }}
    >
      {children}
    </button>
  )
}

/** 文字中夾數學：以 $…$ 包住的片段用 KaTeX 行內顯示（讓推導理由裡的數學也是 LaTeX）。 */
export function tm(src: string): ReactNode {
  const parts = src.split('$')
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <Tex key={i}>{p}</Tex> : <Fragment key={i}>{p}</Fragment>))}
    </>
  )
}
