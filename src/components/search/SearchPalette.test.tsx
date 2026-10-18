import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { SearchPalette, fallbackWhenMissing, revealLocal, revealWhenPresent, type IndexLoader } from './SearchPalette'
import { makeEntry, type SearchEntry } from './searchCore'
import { revealFromRoute } from '../links/anchor'

/** 假的靜態索引（六種各一兩筆） */
const FAKE: SearchEntry[] = [
  makeEntry({ kind: 'formula', id: 'F-05.1', title: 'Comparator 輸出 $+1$ 的機率', tex: String.raw`P(q=+1)=\Phi(s/\sigma_v)`, detail: '05 1-bit Comparator 統計', to: '/ch/05?f=F-05.1' }),
  makeEntry({ kind: 'formula', id: 'F-12.9', title: 'ENBW（等效雜訊頻寬）', tex: String.raw`\mathrm{ENBW}=\frac{f_u}{2}\,\frac{1-p}{1+p}`, detail: '12 Coefficient Noise', to: '/ch/12?f=F-12.9' }),
  makeEntry({ kind: 'section', id: 'ch12', label: '12', title: '12 Coefficient Noise → PLL Output', to: '/ch/12' }),
  makeEntry({ kind: 'preset', id: 'noise-enbw', title: 'ENBW 對照', detail: '12 · 頻寬', to: '/ch/12?preset=noise-enbw&a=exp-noise-lab' }),
  makeEntry({ kind: 'erratum', id: 'E13', title: '§12 頻寬：ENBW 的定義', to: '/verification?e=E13' }),
  makeEntry({ kind: 'term', id: 'enbw', label: 'ENBW', title: '等效雜訊頻寬（Equivalent Noise Bandwidth）', to: '/formulas?q=%E7%AD%89%E6%95%88', revealSelector: '.fr-gloss-item[data-term="enbw"]' }),
  makeEntry({ kind: 'handcalc', id: 'HC-12.3', title: '算 ENBW', detail: '12', to: '/ch/12?a=handcalc-HC-12.3' }),
]
const fakeLoader: IndexLoader = () => Promise.resolve(FAKE)

function Probe() {
  const { pathname, search } = useLocation()
  return <span data-testid="loc">{`${pathname}${search}`}</span>
}

/** 一個有兩個段落的假頁面（本頁段落從 DOM 讀） */
function mountPage() {
  const main = document.createElement('main')
  main.id = 'main'
  main.innerHTML = `<article class="page"><h1>第五章</h1>
    <section class="c-section" id="ch05-intro"><h2>直覺：硬幣</h2></section>
    <section class="c-section" id="ch05-prob"><h2>單一次比較</h2><div id="formula-F-05.1">公式</div></section>
  </article>`
  document.body.appendChild(main)
}

/** loadIndex 'real'：用預設的 import('./buildIndex')（真的索引） */
function renderPalette(opts: { onClose?: () => void; loadIndex?: IndexLoader | 'real'; route?: string } = {}) {
  const onClose = opts.onClose ?? vi.fn()
  const loader = opts.loadIndex === 'real' ? undefined : (opts.loadIndex ?? fakeLoader)
  const utils = render(
    <MemoryRouter initialEntries={[opts.route ?? '/ch/05']}>
      <Probe />
      <SearchPalette onClose={onClose} loadIndex={loader} />
    </MemoryRouter>,
  )
  return { ...utils, onClose }
}

const input = () => screen.getByRole('combobox') as HTMLInputElement
const dialog = () => screen.getByRole('dialog')
const options = () => screen.queryAllByRole('option') as HTMLAnchorElement[]
const activeOption = () => document.getElementById(input().getAttribute('aria-activedescendant') ?? '') as HTMLAnchorElement | null
const type = (text: string) => fireEvent.change(input(), { target: { value: text } })

let scrollCalls: Element[] = []
beforeEach(() => {
  scrollCalls = []
  ;(Element.prototype as unknown as { scrollIntoView: (this: Element) => void }).scrollIntoView = function (this: Element) {
    scrollCalls.push(this)
  }
  window.history.replaceState(null, '', '#/ch/05')
})
afterEach(() => {
  // 先卸載（portal 在 body 上），再清掉假頁面；順序反過來 React 會找不到要移除的節點
  cleanup()
  document.body.innerHTML = ''
  document.body.style.overflow = ''
})

/** 索引載好（空查詢而且沒有本頁段落時沒有 listbox，所以看 data-ready） */
const ready = () => waitFor(() => expect(dialog().getAttribute('data-ready')).toBe('true'))

describe('SearchPalette：結構與無障礙', () => {
  it('對話框 aria-modal、輸入框是 combobox 並自動聚焦；載入中的狀態、載入後 listbox／group／option 都有角色；背景捲動被鎖住', async () => {
    mountPage()
    renderPalette()
    expect(dialog().getAttribute('aria-modal')).toBe('true')
    expect(dialog().getAttribute('aria-label')).toBe('搜尋全站')
    expect(dialog().parentElement?.parentElement).toBe(document.body) // portal
    expect(document.activeElement).toBe(input())
    expect(input().getAttribute('aria-autocomplete')).toBe('list')
    expect(document.body.style.overflow).toBe('hidden')
    expect(screen.getByRole('status').textContent).toBe('索引載入中')
    await screen.findByRole('listbox')
    // 空查詢 = 本頁目錄
    expect(screen.getByRole('status').textContent).toBe('本頁 2 個段落；輸入關鍵字搜尋全站')
    const groups = screen.getAllByRole('group')
    expect(groups).toHaveLength(1)
    expect(document.getElementById(groups[0].getAttribute('aria-labelledby')!)?.textContent).toBe('章節2')
    expect(options().map((o) => o.textContent)).toEqual(['本頁直覺：硬幣05 1-bit Comparator 統計', '本頁單一次比較05 1-bit Comparator 統計'])
    expect(input().getAttribute('aria-expanded')).toBe('true')
    expect(input().getAttribute('aria-controls')).toBe(screen.getByRole('listbox').id)
    expect(activeOption()).toBe(options()[0])
    expect(options()[0].getAttribute('aria-selected')).toBe('true')
    expect(options()[1].getAttribute('aria-selected')).toBe('false')
    // option 是真的連結（中鍵／複製連結可用），href 是路由
    expect(options()[0].getAttribute('href')).toBe('#/ch/05?a=ch05-intro')
  })

  it('輸入關鍵字：結果分組、每組有數量；公式顯示 KaTeX；沒有結果時提示；索引載入失敗時提示', async () => {
    renderPalette()
    await ready()
    type('ENBW')
    await waitFor(() => expect(screen.getAllByRole('group').length).toBe(5))
    const labels = screen.getAllByRole('group').map((g) => document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent)
    // 'ENBW' 正好是術語 enbw 的 id：術語那一組排最前面，其餘照 KIND_ORDER
    expect(labels).toEqual(['術語1', '公式1', '實驗 preset1', '勘誤1', '手算題1'])
    expect(screen.getByRole('status').textContent).toBe('符合 5 項')
    const formula = options()[1]
    expect(formula.querySelector('.c-search-opt-id')?.textContent).toBe('F-12.9')
    expect(formula.querySelector('.c-search-opt-tex .katex')).not.toBeNull()
    expect(formula.querySelector('.c-search-opt-title')?.textContent).toBe('ENBW（等效雜訊頻寬）')
    // 術語的標籤是縮寫
    expect(screen.getAllByRole('group')[0].querySelector('.c-search-opt-id')?.textContent).toBe('ENBW')

    type('zzzz-nothing')
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    expect(screen.getByRole('status').textContent).toBe('沒有符合的項目')
    expect(input().getAttribute('aria-expanded')).toBe('false')
    expect(input().hasAttribute('aria-activedescendant')).toBe(false)
  })

  it('索引載入失敗：顯示提示，不會丟例外', async () => {
    renderPalette({ loadIndex: () => Promise.reject(new Error('boom')) })
    await screen.findByText('索引載入失敗，請重新整理後再試。')
    expect(screen.getByRole('status').textContent).toBe('索引載入失敗')
  })
})

describe('SearchPalette：鍵盤', () => {
  it('↑↓ 移動 aria-activedescendant（頭尾循環）、輸入新字回到第一筆、滑鼠移過也會選取', async () => {
    renderPalette()
    await ready()
    type('ENBW')
    await waitFor(() => expect(options()).toHaveLength(5))
    expect(activeOption()).toBe(options()[0])
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(activeOption()).toBe(options()[1])
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    expect(activeOption()).toBe(options()[4]) // 從第一筆往上 → 最後一筆
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(activeOption()).toBe(options()[0]) // 最後一筆往下 → 第一筆
    expect(scrollCalls.at(-1)).toBe(options()[0]) // 目前的項目會捲進可視範圍
    fireEvent.mouseMove(options()[3])
    expect(activeOption()).toBe(options()[3])
    type('ENBW ')
    await waitFor(() => expect(activeOption()).toBe(options()[0]))
    // 焦點一直在輸入框（option 不進 Tab 順序）
    expect(document.activeElement).toBe(input())
    expect(options().every((o) => o.tabIndex === -1)).toBe(true)
  })

  it('Enter 前往目前的項目：別頁的目標走路由（navigate），面板先關閉；中文輸入法選字中的 Enter 不算', async () => {
    const { onClose } = renderPalette()
    await ready()
    type('E13')
    await waitFor(() => expect(options()).toHaveLength(1))
    fireEvent.keyDown(input(), { key: 'Enter', isComposing: true })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/verification?e=E13'))
  })

  it('Enter 在本頁的段落：直接捲到該元素、展開祖先、網址加上 ?a=（不經過路由）', async () => {
    mountPage()
    const { onClose } = renderPalette()
    await screen.findByRole('listbox')
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(activeOption()?.textContent).toContain('單一次比較')
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(scrollCalls).toContain(document.getElementById('ch05-prob')))
    expect(window.location.hash).toBe('#/ch/05?a=ch05-prob')
    expect(screen.getByTestId('loc').textContent).toBe('/ch/05') // 路由沒變
    expect(document.getElementById('ch05-prob')?.getAttribute('data-link-target')).toBe('true')
  })

  it('本頁有這條公式（#formula-ID）時 Enter 捲到公式並寫入 ?f=；別章的公式走路由到該章的 ?f=', async () => {
    mountPage()
    const { onClose } = renderPalette()
    await screen.findByRole('listbox')
    type('F-05.1')
    await waitFor(() => expect(options()[0].querySelector('.c-search-opt-id')?.textContent).toBe('F-05.1'))
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => expect(scrollCalls).toContain(document.getElementById('formula-F-05.1')))
    expect(window.location.hash).toBe('#/ch/05?f=F-05.1')
    expect(onClose).toHaveBeenCalledTimes(1)
    // 另一章的公式
    const e = FAKE.find((x) => x.id === 'F-12.9')!
    expect(revealLocal(e, '/ch/05')).toBe(false)
  })

  it('Esc 關閉（不往外冒泡）；點背景關閉；點 option 也會前往；Tab 只在輸入框與關閉鈕之間循環', async () => {
    const outer = vi.fn()
    document.addEventListener('keydown', outer)
    try {
      const { onClose } = renderPalette()
      await ready()
      type('ENBW')
      await waitFor(() => expect(options()).toHaveLength(5))
      fireEvent.keyDown(input(), { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(outer).not.toHaveBeenCalled()

      fireEvent.mouseDown(dialog().parentElement!) // 背景
      expect(onClose).toHaveBeenCalledTimes(2)
      fireEvent.mouseDown(dialog()) // 面板本身不算
      expect(onClose).toHaveBeenCalledTimes(2)

      fireEvent.click(options()[3]) // 勘誤 E13（術語、公式、preset 之後）
      expect(onClose).toHaveBeenCalledTimes(3)
      await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/verification?e=E13'))

      const close = screen.getByRole('button', { name: '關閉' })
      expect(document.activeElement).toBe(input())
      fireEvent.keyDown(input(), { key: 'Tab', shiftKey: true })
      expect(document.activeElement).toBe(close)
      fireEvent.keyDown(close, { key: 'Tab' })
      expect(document.activeElement).toBe(input())
    } finally {
      document.removeEventListener('keydown', outer)
    }
  })

  it('關閉鈕上的 Enter 是按下按鈕（關閉），不是前往目前選到的結果', async () => {
    const { onClose } = renderPalette()
    await ready()
    type('ENBW')
    await waitFor(() => expect(options()).toHaveLength(5))
    const close = screen.getByRole('button', { name: '關閉' })
    close.focus()
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    act(() => {
      close.dispatchEvent(enter)
    })
    expect(enter.defaultPrevented).toBe(false) // 瀏覽器會照常把 Enter 變成按鈕的 click
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('loc').textContent).toBe('/ch/05')
    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledTimes(1)
    // 輸入框裡的 Enter 才是前往（第一筆是術語 enbw：ENBW 正好是它的 id）
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onClose).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/formulas?q=%E7%AD%89%E6%95%88'))
  })
})

describe('SearchPalette：到了目標頁再捲（revealWhenPresent）與帶參數的 ?a=', () => {
  it('術語：Enter 走路由到 /formulas?q=，那一列（過濾後才掛上來）出現就捲過去並標示', async () => {
    const { onClose } = renderPalette()
    await ready()
    type('ENBW')
    await waitFor(() => expect(options()).toHaveLength(5))
    expect(activeOption()?.querySelector('.c-search-opt-id')?.textContent).toBe('ENBW')
    // 模擬 HashRouter 的網址已經到了公式速查頁（revealWhenPresent 用 window.location.hash 判斷讀者還在不在那一頁）
    window.history.replaceState(null, '', '#/formulas?q=%E7%AD%89%E6%95%88')
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/formulas?q=%E7%AD%89%E6%95%88'))
    // （面板自己會把目前的 option 捲進可視範圍，所以 scrollCalls 不是空的；看的是術語列）
    expect(scrollCalls.filter((el) => el.classList.contains('fr-gloss-item'))).toEqual([])
    const row = document.createElement('div')
    row.className = 'fr-gloss-item'
    row.dataset.term = 'enbw'
    document.body.appendChild(row)
    await waitFor(() => expect(scrollCalls).toContain(row), { timeout: 3000 })
    expect(row.getAttribute('data-link-target')).toBe('true')
  })

  it('revealWhenPresent：元素出現才捲（只捲一次）；讀者去了別頁就停；逾時放棄；取消函式', () => {
    vi.useFakeTimers()
    try {
      window.history.replaceState(null, '', '#/formulas?q=x')
      revealWhenPresent('.late', '/formulas?q=x', { intervalMs: 100, timeoutMs: 1000 })
      vi.advanceTimersByTime(350)
      expect(scrollCalls).toEqual([])
      const el = document.createElement('div')
      el.className = 'late'
      document.body.appendChild(el)
      vi.advanceTimersByTime(100)
      expect(scrollCalls).toEqual([el])
      vi.advanceTimersByTime(2000)
      expect(scrollCalls).toEqual([el]) // 捲過就停，不會再捲
      // 讀者去了別頁：不捲
      scrollCalls = []
      const other = document.createElement('div')
      other.className = 'other'
      document.body.appendChild(other)
      window.history.replaceState(null, '', '#/ch/05')
      revealWhenPresent('.other', '/formulas?q=x', { intervalMs: 100, timeoutMs: 1000 })
      vi.advanceTimersByTime(500)
      expect(scrollCalls).toEqual([])
      // 逾時之後才出現：不捲
      window.history.replaceState(null, '', '#/formulas?q=x')
      revealWhenPresent('.never', '/formulas?q=x', { intervalMs: 100, timeoutMs: 300 })
      vi.advanceTimersByTime(400)
      const late = document.createElement('div')
      late.className = 'never'
      document.body.appendChild(late)
      vi.advanceTimersByTime(500)
      expect(scrollCalls).toEqual([])
      // 取消
      const cancel = revealWhenPresent('.never', '/formulas?q=x', { intervalMs: 100, timeoutMs: 1000 })
      cancel()
      vi.advanceTimersByTime(500)
      expect(scrollCalls).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('preset 的目標帶著 ?preset=…&a=exp-…：就算本頁已有那個實驗也要走路由（preset 要靠網址套用）；只有 ?a= 一個參數的才在本頁直接捲', async () => {
    mountPage()
    const exp = document.createElement('section')
    exp.id = 'exp-noise-lab'
    document.querySelector('main article')!.appendChild(exp)
    const preset = FAKE.find((x) => x.kind === 'preset')!
    expect(revealLocal(preset, '/ch/12')).toBe(false)
    expect(scrollCalls).not.toContain(exp)
    const hc = makeEntry({ kind: 'handcalc', id: 'HC-05.9', title: 't', to: '/ch/05?a=exp-noise-lab' })
    expect(revealLocal(hc, '/ch/05')).toBe(true)
    expect(scrollCalls).toContain(exp)
    expect(window.location.hash).toBe('#/ch/05?a=exp-noise-lab')
    // 面板：Enter 走路由，網址帶著 preset 與 a
    const { onClose } = renderPalette({ route: '/ch/12' })
    await ready()
    type('noise-enbw')
    await waitFor(() => expect(options()[0].querySelector('.c-search-opt-id')?.textContent).toBe('noise-enbw'))
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/ch/12?preset=noise-enbw&a=exp-noise-lab'))
  })
})

describe('SearchPalette：走路由算一次新的導覽', () => {
  it('同一個 ?f= 目標：revealFromRoute 在同一次導覽只捲一次，但面板 Enter 之後再呼叫會再捲（去重被 markNavigation 重設）', async () => {
    window.history.replaceState(null, '', '#/ch/12')
    const target = document.createElement('div')
    target.id = 'formula-F-12.9'
    document.body.appendChild(target)
    expect(revealFromRoute('/ch/12?f=F-12.9')).not.toBeNull() // 第一次：處理
    expect(revealFromRoute('/ch/12?f=F-12.9')).toBeNull() // 同一次導覽：去重
    await waitFor(() => expect(scrollCalls).toContain(target))
    target.remove() // 讓面板不要在本頁找到它，而是走路由
    const { onClose } = renderPalette({ route: '/ch/05' })
    await ready()
    type('F-12.9')
    await waitFor(() => expect(options()[0].querySelector('.c-search-opt-id')?.textContent).toBe('F-12.9'))
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/ch/12?f=F-12.9'))
    const again = revealFromRoute('/ch/12?f=F-12.9')
    expect(again).not.toBeNull()
    again?.()
  })
})

describe('公式走路由之後的保險：fallbackWhenMissing', () => {
  const route = '/ch/12?f=F-12.9'
  const fallback = '/formulas?f=F-12.9'
  const mountArticle = (html: string) => {
    document.body.innerHTML = `<main id="main"><article class="page">${html}</article></main>`
  }
  beforeEach(() => {
    vi.useFakeTimers()
    window.history.replaceState(null, '', '#/ch/12?f=F-12.9')
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('章節畫好（有段落 h2）卻沒有錨點：過了 grace 就改去公式速查頁（只呼叫一次）；模式選擇器的 h2 不算「畫好」', () => {
    const go = vi.fn()
    mountArticle('<section class="c-modepicker"><h2>先選一個學習模式</h2></section>')
    fallbackWhenMissing('formula-F-12.9', route, fallback, go, { intervalMs: 100, graceMs: 500, timeoutMs: 5000 })
    vi.advanceTimersByTime(1000)
    expect(go).not.toHaveBeenCalled() // 還沒畫好
    mountArticle('<h1>12</h1><section id="ch12-intro"><h2>直覺</h2></section>')
    vi.advanceTimersByTime(400)
    expect(go).not.toHaveBeenCalled() // grace 內
    vi.advanceTimersByTime(300)
    expect(go).toHaveBeenCalledTimes(1)
    expect(go).toHaveBeenCalledWith(fallback)
    vi.advanceTimersByTime(5000)
    expect(go).toHaveBeenCalledTimes(1)
  })

  it('錨點出現就停（AnchorDeepLink 會捲過去）；讀者已經去了別頁也停；章節一直沒畫好則在 timeout 後改走', () => {
    const a = vi.fn()
    mountArticle('<section id="ch12-x"><h2>段落</h2><div id="formula-F-12.9">公式</div></section>')
    fallbackWhenMissing('formula-F-12.9', route, fallback, a, { intervalMs: 100, graceMs: 200, timeoutMs: 1000 })
    vi.advanceTimersByTime(3000)
    expect(a).not.toHaveBeenCalled()

    const b = vi.fn()
    mountArticle('<section><h2>段落</h2></section>')
    window.history.replaceState(null, '', '#/ch/05')
    fallbackWhenMissing('formula-F-12.9', route, fallback, b, { intervalMs: 100, graceMs: 200, timeoutMs: 1000 })
    vi.advanceTimersByTime(3000)
    expect(b).not.toHaveBeenCalled()

    const c = vi.fn()
    window.history.replaceState(null, '', '#/ch/12?f=F-12.9')
    mountArticle('<h1>12</h1>') // chunk 還沒來
    const cancel = fallbackWhenMissing('formula-F-12.9', route, fallback, c, { intervalMs: 100, graceMs: 200, timeoutMs: 1000 })
    vi.advanceTimersByTime(900)
    expect(c).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(c).toHaveBeenCalledWith(fallback)

    const d = vi.fn()
    const cancelD = fallbackWhenMissing('formula-F-12.9', route, fallback, d, { intervalMs: 100, graceMs: 200, timeoutMs: 1000 })
    cancelD()
    cancel()
    vi.advanceTimersByTime(3000)
    expect(d).not.toHaveBeenCalled()
  })

  it('面板的 Enter：到了該章沒有錨點 → 網址換成 /formulas?f=（replace）；有錨點就留在該章', async () => {
    vi.useRealTimers()
    window.history.replaceState(null, '', '#/ch/05')
    const { onClose } = renderPalette({ route: '/ch/05' })
    await ready()
    type('F-12.9')
    await waitFor(() => expect(options()[0].querySelector('.c-search-opt-id')?.textContent).toBe('F-12.9'))
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/ch/12?f=F-12.9'))
    // 模擬 HashRouter 到了第 12 章、章節畫好了，但這條公式只在較高的模式顯示（沒有 #formula-F-12.9）
    window.history.replaceState(null, '', '#/ch/12?f=F-12.9')
    const main = document.createElement('main')
    main.id = 'main'
    main.innerHTML = '<article class="page"><h1>12</h1><section id="ch12-intro"><h2>直覺</h2></section></article>'
    document.body.appendChild(main)
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/formulas?f=F-12.9'), { timeout: 3000 })
  })
})

describe('SearchPalette：真的索引（預設的 import()）', () => {
  it('第一次開啟才載入 buildIndex；查 F-12.9 的第一筆是那條公式、Enter 前往第 12 章的 ?f=；本頁段落排在靜態索引前面', async () => {
    mountPage()
    const { onClose } = renderPalette({ loadIndex: 'real' })
    await screen.findByRole('listbox', undefined, { timeout: 30_000 })
    expect(options()[0].textContent).toContain('直覺：硬幣')
    await act(async () => {
      type('F-12.9')
    })
    await waitFor(() => expect(options()[0].querySelector('.c-search-opt-id')?.textContent).toBe('F-12.9'))
    expect(options()[0].getAttribute('href')).toBe('#/ch/12?f=F-12.9')
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/ch/12?f=F-12.9'))
  }, 60_000)
})
