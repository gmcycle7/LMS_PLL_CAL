import { fireEvent } from '@testing-library/react'
import FormulasPage from './index'
import { ALL_FORMULAS } from './registry'
import { GLOBAL_SYMBOLS, SYMBOL_COLLISIONS } from './symbols'
import { QUICK_REF } from './appendixA'
import { LIMITATIONS } from './appendixB'
import { GLOSSARY } from './glossary'
import { UNIT_TOPICS } from './searchIndex'
import { ERRATA } from './errata'
import { buttonByText, count, mountAt, q, renderProblems } from './domTestUtils'

vi.mock('plotly.js-dist-min', async () => ({ default: (await import('./domTestUtils')).PLOTLY_STUB }))
vi.mock('mermaid', () => ({ default: { initialize: () => undefined, render: async () => ({ svg: '<svg></svg>' }) } }))

// 整頁在 jsdom 約 10 萬個節點；其他 agent 同時跑測試時較慢
vi.setConfig({ testTimeout: 180_000 })

/**
 * console.error 監看：React 的 key 重複、DOM 巢狀錯誤（<div> 放進 <p>）、未知屬性等都走 console.error。
 * 共用 Plot 元件載入 Plotly 後的 setState 會觸發「not wrapped in act(...)」提示（與本頁無關），其餘一律視為問題。
 */
const consoleErrors: string[] = []
let errorSpy: ReturnType<typeof vi.spyOn> | null = null
beforeEach(() => {
  consoleErrors.length = 0
  errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const text = args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message : String(a))).join(' ')
    if (/not wrapped in act\(/.test(text)) return
    consoleErrors.push(text.slice(0, 300))
  })
})

afterEach(() => {
  errorSpy?.mockRestore()
  errorSpy = null
  try {
    localStorage.clear()
  } catch {
    /* ignore */
  }
})

/** 依標籤文字找 ToggleControl 的 switch */
function switchByLabel(root: ParentNode, label: RegExp): HTMLInputElement {
  const el = Array.from(root.querySelectorAll<HTMLInputElement>('input[role="switch"]')).find((i) => label.test(i.closest('.c-toggle')?.textContent ?? ''))
  if (!el) throw new Error(`找不到開關：${String(label)}`)
  return el
}

describe('FormulasPage（jsdom smoke：三種學習模式）', () => {
  it('Engineer：六個段落 + 思考題都渲染；KaTeX、程式碼區塊、算出來的數字都沒有錯誤；勘誤與頁面連結正確', () => {
    const { container } = mountAt(<FormulasPage />, { mode: 'engineer' })
    for (const id of ['fr-intro', 'fr-symbols', 'fr-units', 'fr-quick', 'fr-registry', 'fr-limits', 'fr-glossary', 'fr-wrapup']) expect(container.querySelector(`#${id}`), id).toBeTruthy()
    // 本頁新增的符號（SymbolTable）在頁面最底端（teaching-style §5），外層 id="symbols"；頁首只留一行連結。全站符號總表（§1）是本頁的主要內容，位置不變。
    const symbols = q(container, '#symbols')
    expect(symbols.querySelector('.c-symbols')).toBeTruthy()
    expect(container.querySelectorAll('#symbols').length).toBe(1)
    expect(container.querySelector('#fr-intro .c-symbols')).toBeNull()
    expect(q(container, '[data-testid="formulas-page"]').lastElementChild).toBe(symbols)
    expect(q(container, '#fr-wrapup').compareDocumentPosition(symbols) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(q(container, '#fr-intro .fr-symbols-link').textContent).toContain('本頁新增的記號表在最後 ↓')
    expect(q(container, '#fr-symbols .fr-sym-table')).toBeTruthy()
    // 1 符號：全部列出（含規格原文欄）＋ 符號衝突表
    expect(count(container, '.fr-sym-table tr[data-symbol]')).toBe(GLOBAL_SYMBOLS.length)
    expect(count(container, '.fr-coll-table tbody tr')).toBe(SYMBOL_COLLISIONS.length)
    expect(q(container, '.fr-sym-table thead').textContent).toContain('規格原文')
    // 2 單位：八個子題、時間軸示意圖與換算器
    expect(count(container, '.fr-topic')).toBe(UNIT_TOPICS.length)
    for (const t of UNIT_TOPICS) expect(container.querySelector(`#fr-unit-${t.id}`), t.id).toBeTruthy()
    expect(container.querySelector('#fr-units-calculator')).toBeTruthy()
    expect(container.querySelector('svg.fr-timeline')).toBeTruthy()
    // 先備知識框（只假設微積分）：期望值、特徵值、常態分布／erf、卷積與相關、離散角頻率、地板函數／ZOH、因次分析、PSD、Z 轉換、等比級數
    const prereqs = Array.from(container.querySelectorAll('.c-prereq > summary')).map((e) => e.textContent ?? '')
    for (const t of [/期望值與變異數/, /特徵值/, /常態分布/, /卷積/, /離散時間的角頻率/, /地板函數/, /因次分析/, /功率頻譜密度/, /Z 轉換、頻率響應與 pole/, /等比級數/])
      expect(prereqs.some((p) => t.test(p)), String(t)).toBe(true)
    // 子題目錄的按鈕與子題標題都用 KaTeX 顯示符號（不是 Unicode 拼的 μ、K_q）
    const chips = Array.from(container.querySelectorAll('#fr-units .fr-chip'))
    expect(chips.length).toBe(UNIT_TOPICS.length)
    expect(chips.filter((c) => c.querySelector('.katex')).length).toBeGreaterThanOrEqual(5)
    expect(chips.some((c) => /[μσ]/.test(Array.from(c.childNodes).filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join('')))).toBe(false)
    expect(q(container, '#fr-unit-index .fr-topic-title').querySelectorAll('.katex').length).toBe(3) // n、k、m
    // 3 速查、5 限制、6 術語
    expect(count(container, '.fr-quick-table tr[data-quick]')).toBe(QUICK_REF.length)
    expect(count(container, '.fr-limit')).toBe(LIMITATIONS.length)
    expect(count(container, '.fr-gloss-item')).toBe(GLOSSARY.length)
    // 4 公式登錄：一次顯示 60 條，並說明總數
    expect(count(container, 'tr[data-formula-row]')).toBe(60)
    expect(q(container, '#fr-registry').textContent).toContain(String(ALL_FORMULAS.length))
    // 7 思考題與必記
    expect(count(container, '.c-quiz')).toBe(5)
    expect(container.querySelector('.c-recap')).toBeTruthy()
    // Research 專屬內容不出現
    expect(container.querySelector('#fr-coverage')).toBeNull()
    expect(renderProblems(container)).toEqual([])
    expect(count(container, '.katex')).toBeGreaterThan(600)
    // 核心程式碼來自實際執行的原始檔：calNoise.ts、comparator.ts、unitsModel.ts 的 #region
    const code = Array.from(container.querySelectorAll('pre'))
      .map((p) => p.textContent ?? '')
      .join('\n')
    for (const snippet of [
      'export function loopCore',
      'export function bw3dbExact',
      'export function enbwOneSided',
      'export function meanGmacEncoding',
      'export function linearMcStep',
      'export function signMcStep',
      'export function f3dbBisection',
      'export function swZohDtft',
      'export function spurBeta',
    ])
      expect(code, snippet).toContain(snippet)
    expect(code).toContain('← 差異')

    // 勘誤標記：連到驗證頁的深連結，49 項全部出現在頁面上，tooltip 是修正摘要
    const tags = Array.from(container.querySelectorAll<HTMLAnchorElement>('a.fr-erratum'))
    expect(tags.length).toBeGreaterThan(150)
    expect(tags.filter((a) => !/^#\/verification\?e=E\d\d$/.test(a.getAttribute('href') ?? '')).length).toBe(0)
    expect(new Set(tags.map((a) => a.dataset.erratum)).size).toBe(ERRATA.length)
    expect(tags.every((a) => (a.getAttribute('title') ?? '').length > 10)).toBe(true)
    // 頁面連結走 router；頁內目錄是按鈕（HashRouter 下不能用 <a href="#id">）
    expect(container.querySelector('a.fr-page-link[href="/ch/12"]')).toBeTruthy()
    expect(count(container, '.fr a[href^="#fr-"]')).toBe(0)
    expect(count(container, '.fr-toc button')).toBe(7)
    // 頁面上引用的每個頁面 id 與公式 ID 都存在（不存在時 PageLink／FormulaLink 會渲染 .fr-missing）
    expect(Array.from(container.querySelectorAll('.fr-missing')).map((e) => e.textContent)).toEqual([])
    expect(consoleErrors).toEqual([]) // 沒有 React 警告（key、DOM 巢狀、未知屬性…）
  })

  it('Beginner：符號表只列核心符號、沒有規格原文欄，一鍵可展開全部；推導預設收合', () => {
    const { container } = mountAt(<FormulasPage />, { mode: 'beginner' })
    const core = GLOBAL_SYMBOLS.filter((s) => s.core).length
    expect(core).toBeGreaterThan(15)
    expect(core).toBeLessThan(GLOBAL_SYMBOLS.length)
    expect(count(container, '.fr-sym-table tr[data-symbol]')).toBe(core)
    expect(q(container, '.fr-sym-table thead').textContent).not.toContain('規格原文')
    expect(container.querySelector('.fr-coll-table')).toBeNull()
    // 本頁自己的推導收合框（fr-collapsible）在 Beginner 預設關閉
    const boxes = Array.from(container.querySelectorAll<HTMLDetailsElement>('#fr-units details.fr-collapsible'))
    expect(boxes.length).toBeGreaterThan(6)
    expect(boxes.every((d) => !d.open)).toBe(true)
    // Engineer 才有的內容不顯示：思考題 5、模型層級表
    expect(count(container, '.c-quiz')).toBe(4)
    expect(container.querySelector('.fr-levels-table')).toBeNull()
    expect(renderProblems(container)).toEqual([])
    fireEvent.click(buttonByText(q(container, '#fr-symbols'), new RegExp(`顯示全部 ${GLOBAL_SYMBOLS.length} 個符號`)))
    expect(count(container, '.fr-sym-table tr[data-symbol]')).toBe(GLOBAL_SYMBOLS.length)
    expect(consoleErrors).toEqual([])
  })

  it('Research：推導預設展開、勘誤覆蓋表列出 49 項、可顯示 TeX 原始碼；所有表格都符合窄螢幕的卡片排版約定', () => {
    const { container } = mountAt(<FormulasPage />, { mode: 'research' })
    const boxes = Array.from(container.querySelectorAll<HTMLDetailsElement>('#fr-units details.fr-collapsible'))
    expect(boxes.every((d) => d.open)).toBe(true)
    expect(container.querySelector('#fr-coverage')).toBeTruthy()
    expect(count(container, '#fr-coverage tr[data-cov]')).toBe(ERRATA.length)
    expect(count(container, '#fr-coverage tr.fr-cov-missing')).toBe(0)
    // Research 多了一個「勘誤覆蓋」段落，但符號表仍然是頁面最後一個區塊（在它之後）
    expect(q(container, '[data-testid="formulas-page"]').lastElementChild).toBe(q(container, '#symbols'))
    expect(q(container, '#fr-coverage').compareDocumentPosition(q(container, '#symbols')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(renderProblems(container)).toEqual([])
    // 版面約定：所有 fr-table 都在 .table-wrap 內，且每個資料格都有 data-label（≤ 640 px 的卡片排版用）
    const tables = Array.from(container.querySelectorAll('table.fr-table'))
    expect(tables.length).toBeGreaterThan(14)
    expect(tables.filter((t) => !t.closest('.table-wrap')).map((t) => t.className)).toEqual([])
    const unlabeled = Array.from(container.querySelectorAll('table.fr-table tbody td')).filter((td) => !td.getAttribute('data-label'))
    expect(unlabeled.map((td) => `${td.closest('table')?.className}: ${td.textContent?.slice(0, 30)}`)).toEqual([])
    // 顯示 TeX 原始碼（Research 才有的開關）
    fireEvent.click(switchByLabel(q(container, '#fr-registry'), /TeX 原始碼/))
    expect(count(container, 'code.fr-tex-src')).toBe(60)
    expect(Array.from(container.querySelectorAll('.fr-missing')).map((e) => e.textContent)).toEqual([])
    expect(consoleErrors).toEqual([])
  })
})
