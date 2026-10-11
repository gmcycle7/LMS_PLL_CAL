import type { ReactNode } from 'react'
import { act, fireEvent, render } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'

/**
 * jsdom 測試共用工具（不是測試檔）。
 *
 * 本頁在 jsdom 裡約有 10 萬個 DOM 節點（上千個 KaTeX，每個都有 HTML + MathML）。兩件事要避免：
 *   1. `screen.getByRole(...)`：dom-testing-library 會對整棵樹計算 accessibility，慢（數秒）而且吃數百 MB。
 *      → 一律用 container.querySelector 加明確的 selector。
 *   2. `container.cloneNode(true)`：整棵樹再複製一份。
 *      → 檢查文字時直接走訪文字節點。
 * Plotly 的假模組也不要用 vi.fn（mock.calls 會抓住圖表的 DOM 節點，整頁的 detached DOM 無法回收）。
 */

export type Mode = 'beginner' | 'engineer' | 'research'

export const PLOTLY_STUB = {
  react: async () => undefined,
  purge: () => undefined,
  toImage: async () => 'data:image/png;base64,iVBORw0KGgo=',
  downloadImage: async () => '',
  Plots: { resize: () => undefined },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="loc">{`${loc.pathname}${loc.search}`}</div>
}

/** 在 SettingsProvider + MemoryRouter 內渲染；path 以外的路由顯示「其他頁面」，並附一個顯示目前網址的探針 */
export function mountAt(ui: ReactNode, opts: { mode?: Mode; url?: string; path?: string } = {}) {
  const { mode = 'engineer', url = '/formulas', path = '/formulas' } = opts
  try {
    localStorage.setItem('lmspll.mode', mode)
  } catch {
    /* storage 不可用時沿用預設 */
  }
  const r = render(
    <SettingsProvider>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path={path} element={ui} />
          <Route path="*" element={<div data-testid="other-page">其他頁面</div>} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </SettingsProvider>,
  )
  const loc = () => r.container.querySelector('[data-testid="loc"]')?.textContent ?? ''
  return { ...r, loc }
}

export const count = (root: ParentNode, sel: string) => root.querySelectorAll(sel).length

export function q<T extends Element = HTMLElement>(root: ParentNode, sel: string): T {
  const el = root.querySelector<T>(sel)
  if (!el) throw new Error(`找不到元素：${sel}`)
  return el
}

/** 依文字找按鈕（只在 root 內找；不計算 accessibility tree） */
export function buttonByText(root: ParentNode, text: string | RegExp): HTMLButtonElement {
  const btn = Array.from(root.querySelectorAll('button')).find((b) => (typeof text === 'string' ? (b.textContent ?? '').trim() === text : text.test(b.textContent ?? '')))
  if (!btn) throw new Error(`找不到按鈕：${String(text)}`)
  return btn
}

/** SelectControl 的 <option value> 是索引：依顯示文字選取 */
export function chooseOption(select: HTMLSelectElement, label: string | RegExp) {
  const opt = Array.from(select.options).find((o) => (typeof label === 'string' ? o.textContent === label : label.test(o.textContent ?? '')))
  if (!opt) throw new Error(`找不到選項 ${String(label)}：${Array.from(select.options).map((o) => o.textContent).join(' | ')}`)
  act(() => {
    fireEvent.change(select, { target: { value: opt.value } })
  })
}

// .c-tip-list：TestBadge 的 tooltip 逐字列出測試標題（原始資料，標題裡可以出現 NaN、`$...$` 等字樣），不是排版出來的文字
const EXCLUDE = 'pre, code, .katex-mathml, select, [data-testid="loc"], .c-tip-list'

/**
 * 在「看得見的文字」中找 pattern（略過程式碼區塊、MathML 註解、下拉選單），回傳每個出現位置的前後文。
 * 先用整段 textContent 快速判斷，沒有才不必走訪文字節點。
 */
export function visibleTextMatches(root: HTMLElement, pattern: RegExp, max = 6): string[] {
  if (!pattern.test(root.textContent ?? '')) return []
  const out: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const re = new RegExp(pattern.source, pattern.flags.replace('g', ''))
  let node = walker.nextNode()
  while (node && out.length < max) {
    const text = node.nodeValue ?? ''
    if (re.test(text) && !node.parentElement?.closest(EXCLUDE)) {
      const host = node.parentElement?.closest('td, p, li, dd, figcaption, .c-metric-table, div') ?? node.parentElement
      out.push((host?.textContent ?? text).replace(/\s+/g, ' ').slice(0, 120))
    }
    node = walker.nextNode()
  }
  return out
}

/** 渲染結果的基本健檢：沒有 KaTeX 錯誤、沒有找不到的 code region、算出來的數字沒有 undefined / NaN */
export function renderProblems(root: HTMLElement): string[] {
  const problems: string[] = []
  for (const e of Array.from(root.querySelectorAll('.katex-error, .c-tex-error'))) problems.push(`KaTeX 錯誤：${(e.textContent ?? '').slice(0, 80)}`)
  if ((root.textContent ?? '').includes('程式碼載入錯誤')) problems.push('CodeBlock：找不到 #region')
  for (const ctx of visibleTextMatches(root, /undefined|NaN/)) problems.push(`未定義的數字：${ctx}`)
  // 字串屬性裡的 $…$ 若元件沒有經過 mathText，就會把錢字號原樣顯示出來
  for (const ctx of visibleTextMatches(root, /\$/)) problems.push(`沒有被渲染的 $…$：${ctx}`)
  return problems
}

/** 在本頁的搜尋框輸入文字 */
export function typeSearch(root: ParentNode, text: string): HTMLInputElement {
  const input = q<HTMLInputElement>(root, '#fr-search-input')
  act(() => {
    fireEvent.change(input, { target: { value: text } })
  })
  return input
}
