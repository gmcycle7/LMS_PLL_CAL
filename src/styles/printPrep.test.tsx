import { act, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsProvider } from '@/app/settings'
import { Derivation } from '@/components/Derivation'
import { Quiz } from '@/components/Teaching'
import { PENDING_FIGURES, PRINT_SETTLE_MS, PRINT_WAIT_MS, SCROLL_BACK_TEXT, TOGGLE_QUIET_MS, WIDE_BASE_PX, installPrintPrep, isPrintShortcut, prepareForPrint } from './printPrep'

/** 瀏覽器列印時會先後觸發這兩個事件（page.pdf()、Ctrl+P 的預覽都是；重新整理預覽時會再來一輪） */
const beforePrint = () => act(() => void window.dispatchEvent(new Event('beforeprint')))
const afterPrint = () => act(() => void window.dispatchEvent(new Event('afterprint')))

let uninstall: (() => void) | null = null
afterEach(() => {
  uninstall?.()
  uninstall = null
  document.body.innerHTML = ''
  localStorage.clear()
})

function mountDetails(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  return host
}

describe('列印前展開 <details>（beforeprint／afterprint）', () => {
  it('beforeprint 打開所有收合的 <details>（含巢狀），afterprint 還原；本來就展開的不動', () => {
    const host = mountDetails(`
      <details id="a"><summary>推導</summary>內容 A
        <details id="inner"><summary>更深一層</summary>內容 inner</details>
      </details>
      <details id="b" open><summary>本來就展開</summary>內容 B</details>
      <details id="c"><summary>先備知識</summary>內容 C</details>`)
    uninstall = installPrintPrep(window)
    const open = (id: string) => (host.querySelector(`#${id}`) as HTMLDetailsElement).open

    expect(['a', 'inner', 'b', 'c'].map(open)).toEqual([false, false, true, false])
    beforePrint()
    expect(['a', 'inner', 'b', 'c'].map(open)).toEqual([true, true, true, true])
    afterPrint()
    expect(['a', 'inner', 'b', 'c'].map(open)).toEqual([false, false, true, false])
  })

  it('預覽重新整理時 beforeprint 會再來一次（沒有 afterprint）：不疊加，最後一次 afterprint 就還原乾淨', () => {
    const host = mountDetails('<details id="a"><summary>x</summary>y</details>')
    uninstall = installPrintPrep(window)
    const a = host.querySelector('#a') as HTMLDetailsElement
    beforePrint()
    beforePrint()
    expect(a.open).toBe(true)
    afterPrint()
    expect(a.open).toBe(false)
    afterPrint() // 多餘的 afterprint 不出錯
    expect(a.open).toBe(false)
  })

  it('列印前使用者自己開／關過的 <details>：以列印當下的狀態為準，afterprint 後回到列印前的狀態', () => {
    const host = mountDetails('<details id="a"><summary>x</summary>y</details><details id="b" open><summary>x</summary>y</details>')
    uninstall = installPrintPrep(window)
    const a = host.querySelector('#a') as HTMLDetailsElement
    const b = host.querySelector('#b') as HTMLDetailsElement
    a.open = true // 使用者先展開了 a
    b.open = false // 又把 b 收起來
    beforePrint()
    expect(a.open && b.open).toBe(true)
    afterPrint()
    expect([a.open, b.open]).toEqual([true, false])
  })

  it('解除安裝後不再處理 beforeprint，並順便還原', () => {
    const host = mountDetails('<details id="a"><summary>x</summary>y</details>')
    const off = installPrintPrep(window)
    const a = host.querySelector('#a') as HTMLDetailsElement
    beforePrint()
    expect(a.open).toBe(true)
    off()
    expect(a.open).toBe(false)
    beforePrint()
    expect(a.open).toBe(false)
  })

  it('prepareForPrint 回傳的還原函式可以重複呼叫', () => {
    const host = mountDetails('<details id="a"><summary>x</summary>y</details>')
    const restore = prepareForPrint(host)
    const a = host.querySelector('#a') as HTMLDetailsElement
    expect(a.open).toBe(true)
    restore()
    restore()
    expect(a.open).toBe(false)
  })
})

describe('React 控制的 <details open onToggle>（ch06 StepBox 的寫法）不會把列印當成使用者手動操作', () => {
  /** 和 ch06 StepBox／ch11 Details／papers Fold 相同的寫法：toggle 事件把狀態記成 manual，之後不再跟著學習模式走 */
  function StepBoxLike({ byMode, spy }: { byMode: boolean; spy: (now: boolean) => void }) {
    const [manual, setManual] = useState<boolean | null>(null)
    const isOpen = manual ?? byMode
    return (
      <details
        data-testid="box"
        open={isOpen}
        onToggle={(e) => {
          const now = (e.currentTarget as HTMLDetailsElement).open
          spy(now)
          if (now !== isOpen) setManual(now)
        }}
      >
        <summary>推導</summary>
        <p>內容</p>
      </details>
    )
  }
  const toggle = (el: Element) => act(() => void el.dispatchEvent(new Event('toggle')))

  it('列印期間與還原後的一小段時間內，toggle 事件到不了元件；之後使用者真的點開時照常運作；模式改變後仍跟著預設走', async () => {
    const calls: boolean[] = []
    const ui = (byMode: boolean) => <StepBoxLike byMode={byMode} spy={(v) => calls.push(v)} />
    const { rerender } = render(ui(false))
    uninstall = installPrintPrep(window)
    const box = screen.getByTestId('box') as HTMLDetailsElement

    beforePrint()
    expect(box.open).toBe(true)
    toggle(box) // Firefox／Safari：事件在列印期間送出
    afterPrint()
    expect(box.open).toBe(false)
    toggle(box) // 排隊中的事件在還原之後才送出
    expect(calls).toEqual([])

    // 切到 Engineer：manual 沒被鎖住，預設值決定開合
    rerender(ui(true))
    expect(box.open).toBe(true)

    // 過了緩衝時間，使用者自己操作的 toggle 要照常到達元件
    await new Promise((r) => setTimeout(r, TOGGLE_QUIET_MS + 50))
    box.open = false
    toggle(box)
    expect(calls).toEqual([false])
  })

  it('預覽重新整理（beforeprint 連來兩次）後，最後一次還原完才放行', async () => {
    const calls: boolean[] = []
    render(<StepBoxLike byMode={false} spy={(v) => calls.push(v)} />)
    uninstall = installPrintPrep(window)
    const box = screen.getByTestId('box') as HTMLDetailsElement
    beforePrint()
    afterPrint()
    beforePrint() // 第二輪在第一輪的緩衝時間內開始
    await new Promise((r) => setTimeout(r, TOGGLE_QUIET_MS + 50)) // 第一輪的計時器到了，第二輪還在列印中
    toggle(box)
    expect(calls).toEqual([])
    afterPrint()
    await new Promise((r) => setTimeout(r, TOGGLE_QUIET_MS + 50))
    box.open = true
    toggle(box)
    expect(calls).toEqual([true])
  })
})

describe('列印前展開 React 狀態控制的收合（推導框、思考題解析）', () => {
  function renderMode(mode: 'beginner' | 'research', ui: React.ReactElement) {
    localStorage.setItem('lmspll.mode', mode)
    return render(<SettingsProvider>{ui}</SettingsProvider>)
  }

  it('Derivation：Beginner 預設收合，beforeprint 展開、afterprint 收回；Research 本來就展開，不被收起來', () => {
    const ui = <Derivation title="LMS 更新式的推導" derivation={<p>沿負梯度更新</p>} />
    const first = renderMode('beginner', ui)
    uninstall = installPrintPrep(window)
    expect(screen.queryByText('沿負梯度更新')).toBeNull()
    beforePrint()
    expect(screen.getByText('沿負梯度更新')).toBeTruthy()
    afterPrint()
    expect(screen.queryByText('沿負梯度更新')).toBeNull()
    first.unmount()

    renderMode('research', ui)
    expect(screen.getByText('沿負梯度更新')).toBeTruthy()
    beforePrint()
    afterPrint()
    expect(screen.getByText('沿負梯度更新')).toBeTruthy()
  })

  it('Quiz：beforeprint 展開「答案與解析」，afterprint 收回（紙上看不到答案，思考題就沒有解析可對）', () => {
    render(<Quiz question="pole 變成多少？" options={[{ label: '0.9' }, { label: '1.1', correct: true }]} answer={<p>解析：1.1，仍發散</p>} />)
    uninstall = installPrintPrep(window)
    expect(screen.queryByText('解析：1.1，仍發散')).toBeNull()
    beforePrint()
    expect(screen.getByText('解析：1.1，仍發散')).toBeTruthy()
    afterPrint()
    expect(screen.queryByText('解析：1.1，仍發散')).toBeNull()
  })

  it('展開後才出現的巢狀 <details>（推導裡的先備知識）也會被打開並還原', () => {
    function Inner() {
      return (
        <Derivation
          title="外層推導"
          derivation={
            <details data-testid="nested">
              <summary>內層</summary>
              <p>內層內容</p>
            </details>
          }
        />
      )
    }
    renderMode('beginner', <Inner />)
    uninstall = installPrintPrep(window)
    beforePrint()
    expect((screen.getByTestId('nested') as HTMLDetailsElement).open).toBe(true)
    afterPrint()
    expect(screen.queryByTestId('nested')).toBeNull()
  })

  it('本來就展開的推導框（defaultOpen）：列印前後都不被收起（只還原列印前由我們點開的）', () => {
    renderMode('beginner', <Derivation title="推導" derivation={<p>內容</p>} defaultOpen />)
    uninstall = installPrintPrep(window)
    beforePrint()
    expect(screen.getByText('內容')).toBeTruthy()
    afterPrint()
    expect(screen.getByText('內容')).toBeTruthy()
  })
})

describe('Plotly 圖縮放到頁寬（viewBox）', () => {
  const plotHtml = (extraSvgAttrs = '') => `
    <div class="c-plot-frame" id="frame" style="height: 280px">
      <div class="c-plot-gd js-plotly-plot" style="height: 280px">
        <div class="plot-container plotly">
          <div class="svg-container" style="position: relative; width: 900px; height: 280px">
            <svg class="main-svg" width="900" height="280" ${extraSvgAttrs}></svg>
            <svg class="main-svg" width="900" height="280"></svg>
            <div class="modebar-container"><svg class="icon" width="16" height="16"></svg></div>
          </div>
        </div>
      </div>
    </div>`

  it('每個圖層 svg 補上 viewBox、frame 掛上 data-print-fit 與長寬比；afterprint 全部還原', () => {
    const host = mountDetails(plotHtml())
    uninstall = installPrintPrep(window)
    const frame = host.querySelector('#frame') as HTMLElement
    const layers = Array.from(host.querySelectorAll('svg.main-svg'))
    beforePrint()
    expect(layers.map((s) => s.getAttribute('viewBox'))).toEqual(['0 0 900 280', '0 0 900 280'])
    expect(frame.hasAttribute('data-print-fit')).toBe(true)
    expect(frame.style.getPropertyValue('--c-print-ar')).toBe('900 / 280')
    expect(frame.style.getPropertyValue('--c-print-w')).toBe('900px')
    // modebar 的小圖示（svg.icon）不是圖層，不加 viewBox
    expect(host.querySelector('svg.icon')!.hasAttribute('viewBox')).toBe(false)
    afterPrint()
    expect(layers.every((s) => !s.hasAttribute('viewBox'))).toBe(true)
    expect(frame.hasAttribute('data-print-fit')).toBe(false)
    expect(frame.style.getPropertyValue('--c-print-ar')).toBe('')
    expect(frame.style.getPropertyValue('--c-print-w')).toBe('')
    expect(frame.style.height).toBe('280px') // React 設的行內高度不被動到
  })

  it('本來就有 viewBox 的 svg 不被改、也不被還原動到', () => {
    const host = mountDetails(plotHtml('viewBox="0 0 10 10"'))
    uninstall = installPrintPrep(window)
    const [first, second] = Array.from(host.querySelectorAll('svg.main-svg'))
    beforePrint()
    expect(first.getAttribute('viewBox')).toBe('0 0 10 10')
    expect(second.getAttribute('viewBox')).toBe('0 0 900 280')
    afterPrint()
    expect(first.getAttribute('viewBox')).toBe('0 0 10 10')
    expect(second.hasAttribute('viewBox')).toBe(false)
  })

  it('還沒畫好的圖（只有「圖表載入中…」佔位）不處理', () => {
    const host = mountDetails('<div class="c-plot-frame" id="frame"><div class="c-plot-gd"></div><div class="c-plot-placeholder">圖表載入中…</div></div>')
    uninstall = installPrintPrep(window)
    beforePrint()
    expect((host.querySelector('#frame') as HTMLElement).hasAttribute('data-print-fit')).toBe(false)
    afterPrint()
  })
})

describe('過寬的公式片段（KaTeX .base）：記下寬度與欄位縮排，讓 print.css 縮字級', () => {
  /** jsdom 沒有版面：用 defineProperty 補上量測值 */
  const measure = (el: Element, props: { width?: number; clientWidth?: number }) => {
    if (props.width !== undefined) el.getBoundingClientRect = () => ({ width: props.width!, height: 20, top: 0, left: 0, right: props.width!, bottom: 20, x: 0, y: 0, toJSON: () => ({}) })
    if (props.clientWidth !== undefined) Object.defineProperty(el, 'clientWidth', { configurable: true, value: props.clientWidth })
  }
  const katexHtml = (cls = '') => `<span class="katex ${cls}"><span class="katex-html"><span class="base" style="font-size: 17px">x</span></span></span>`
  const baseOf = (host: HTMLElement, sel = '.base') => host.querySelector(sel) as HTMLElement

  it('獨立公式：--c-em = 寬度 / 自己的字級，--c-off = 頁面內容寬 - 公式欄寬（texblock 的公式編號與間距）；afterprint 還原乾淨', () => {
    const host = mountDetails(`<article class="page"><div class="c-texblock-math"><span class="katex-display">${katexHtml()}</span></div></article>`)
    measure(host.querySelector('.page')!, { clientWidth: 880 })
    measure(host.querySelector('.katex-display')!, { clientWidth: 790 })
    measure(baseOf(host), { width: 714 })
    uninstall = installPrintPrep(window)
    const base = baseOf(host)
    beforePrint()
    expect(base.hasAttribute('data-print-wide')).toBe(true)
    expect(base.style.getPropertyValue('--c-em')).toBe((714 / 17).toFixed(2))
    expect(base.style.getPropertyValue('--c-off')).toBe('90px')
    afterPrint()
    expect(base.hasAttribute('data-print-wide')).toBe(false)
    expect(base.style.getPropertyValue('--c-em')).toBe('')
    expect(base.style.getPropertyValue('--c-off')).toBe('')
  })

  it('比 WIDE_BASE_PX 窄的片段不加任何行內樣式', () => {
    const host = mountDetails(`<article class="page"><span class="katex-display">${katexHtml()}</span></article>`)
    measure(host.querySelector('.page')!, { clientWidth: 880 })
    measure(host.querySelector('.katex-display')!, { clientWidth: 880 })
    measure(baseOf(host), { width: WIDE_BASE_PX })
    uninstall = installPrintPrep(window)
    beforePrint()
    expect(baseOf(host).hasAttribute('data-print-wide')).toBe(false)
    expect(baseOf(host).getAttribute('style')).toBe('font-size: 17px')
    afterPrint()
  })

  it('方塊圖（.c-mermaid）裡的公式不動：節點是照原寬度量好的，縮字會讓文字和節點對不上', () => {
    const host = mountDetails(`<article class="page"><figure class="c-mermaid"><span class="katex-display">${katexHtml()}</span></figure></article>`)
    measure(host.querySelector('.page')!, { clientWidth: 880 })
    measure(baseOf(host), { width: 700 })
    uninstall = installPrintPrep(window)
    beforePrint()
    expect(baseOf(host).hasAttribute('data-print-wide')).toBe(false)
    afterPrint()
  })

  it('行內公式取最近的區塊的內容寬（扣掉 padding）；表格內的取整張表的寬', () => {
    const host = mountDetails(`<article class="page">
      <p id="p" style="padding-left: 20px; padding-right: 20px"><span class="c-tex">${katexHtml()}</span></p>
      <table id="t" style="padding: 0"><tbody><tr><td><span class="c-tex">${katexHtml()}</span></td></tr></tbody></table>
    </article>`)
    measure(host.querySelector('.page')!, { clientWidth: 900 })
    measure(host.querySelector('#p')!, { clientWidth: 900 })
    measure(host.querySelector('#t')!, { clientWidth: 700 })
    const [inP, inTd] = Array.from(host.querySelectorAll<HTMLElement>('.base'))
    measure(inP, { width: 500 })
    measure(inTd, { width: 400 })
    uninstall = installPrintPrep(window)
    beforePrint()
    expect(inP.style.getPropertyValue('--c-off')).toBe('40px') // 900 - (900 - 20 - 20)
    expect(inTd.style.getPropertyValue('--c-off')).toBe('200px') // 900 - 700
    afterPrint()
  })

  it('預覽重新整理（beforeprint 連來兩次）不疊加：還原後再量一次，行內樣式只有一份', () => {
    const host = mountDetails(`<article class="page"><span class="katex-display">${katexHtml()}</span></article>`)
    measure(host.querySelector('.page')!, { clientWidth: 880 })
    measure(host.querySelector('.katex-display')!, { clientWidth: 880 })
    measure(baseOf(host), { width: 500 })
    uninstall = installPrintPrep(window)
    beforePrint()
    beforePrint()
    expect(baseOf(host).style.getPropertyValue('--c-off')).toBe('0px')
    afterPrint()
    expect(baseOf(host).style.cssText.replace(/;$/, '')).toBe('font-size: 17px') // 原本的行內樣式還在，我們加的兩個變數都不在了
  })
})

describe('紙上沒有「捲回去」：回到章首／頂端／§n 的按鈕列印時隱藏', () => {
  const hidden = (el: Element | null) => el!.hasAttribute('data-no-print')

  it('文字比對：整段就是「↑ 回到章首」「回到章首 ↑」「↑ 回到 §1」「回到頂端」「↑ 回到剛才讀到的地方」才算；正文、帶箭頭以外的 §n、跳到別處的導覽都不算', () => {
    for (const t of ['↑ 回到章首', '回到章首 ↑', '回到章首', ' ↑ 回到 §1 ', '↑ 回到 §12.3', '↑回到頂端', '回到頁首 ↑', '↑ 回到剛才讀到的地方', '↑ 回到剛才閱讀的位置']) expect(SCROLL_BACK_TEXT.test(t), t).toBe(true)
    for (const t of ['現在回到章首的系統地圖', '回到 §3', '本章符號表在最後 ↓', '§7 的 Polarity Explorer', '↑ 回到章首的系統地圖', '回到章首後再看', '回到剛才讀到的地方', '↑ 回到剛才讀到的地方再往下', '']) expect(SCROLL_BACK_TEXT.test(t), t).toBe(false)
  })

  it('beforeprint 標上 data-no-print（print.css 隱藏它），afterprint 拿掉；其他按鈕與本來就標過的不動', () => {
    const host = mountDetails(`
      <main class="page">
        <p>現在回到章首的系統地圖。</p>
        <button id="top" type="button">↑ 回到章首</button>
        <button id="sec" type="button">↑ 回到 §1</button>
        <a id="link" href="/x">回到頂端 ↑</a>
        <button id="jump" type="button">本章符號表在最後 ↓</button>
        <button id="tab" type="button">§7 的 Polarity Explorer</button>
        <button id="mine" type="button" data-no-print>↑ 回到章首</button>
      </main>`)
    uninstall = installPrintPrep(window)
    const q = (id: string) => host.querySelector(`#${id}`)
    expect(['top', 'sec', 'link', 'jump', 'tab', 'mine'].map((id) => hidden(q(id)))).toEqual([false, false, false, false, false, true])
    beforePrint()
    expect(['top', 'sec', 'link', 'jump', 'tab', 'mine'].map((id) => hidden(q(id)))).toEqual([true, true, true, false, false, true])
    afterPrint()
    expect(['top', 'sec', 'link', 'jump', 'tab', 'mine'].map((id) => hidden(q(id)))).toEqual([false, false, false, false, false, true]) // 原本就有的標記不被我們拿掉
  })
})

describe('Ctrl／⌘+P：圖還沒畫好時先讓它們畫完再列印（剛開章就按列印，整章的圖不會印成「圖表載入中…」）', () => {
  const pressPrint = (init: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, cancelable: true, bubbles: true, ...init })
    window.dispatchEvent(e)
    return e
  }
  const mermaidPending = '<figure class="c-mermaid"><div class="c-mermaid-pending"><div class="c-mermaid-loading">圖表載入中…</div></div></figure>'
  const plotPending = '<figure class="c-plot"><div class="c-plot-frame"><div class="c-plot-gd"></div><div class="c-plot-placeholder" aria-busy="true">圖表載入中…</div></div></figure>'

  let print: ReturnType<typeof vi.spyOn>
  afterEach(() => {
    print?.mockRestore()
    vi.useRealTimers()
  })
  const spyPrint = () => {
    print = vi.spyOn(window, 'print').mockImplementation(() => {})
    return print
  }

  it('快捷鍵的判定：Ctrl+P 與 ⌘+P 算；Shift／Alt 的組合、單獨的 P 不算', () => {
    expect(isPrintShortcut(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true }))).toBe(true)
    expect(isPrintShortcut(new KeyboardEvent('keydown', { key: 'P', metaKey: true }))).toBe(true)
    expect(isPrintShortcut(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(isPrintShortcut(new KeyboardEvent('keydown', { key: 'p', metaKey: true, altKey: true }))).toBe(false)
    expect(isPrintShortcut(new KeyboardEvent('keydown', { key: 'p' }))).toBe(false)
    expect(isPrintShortcut(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))).toBe(false)
  })

  it('佔位框的選擇器對得上 Mermaid 與 Plot 的「載入中」標記；畫好／失敗的不算', () => {
    const host = mountDetails(`${mermaidPending}${plotPending}
      <figure class="c-mermaid"><div class="c-mermaid-frame"><div class="c-mermaid-svg"><svg></svg></div></div></figure>
      <figure class="c-plot"><div class="c-plot-frame"><div class="c-plot-placeholder c-plot-error" role="alert">圖表模組載入失敗</div></div></figure>`)
    expect(host.querySelectorAll(PENDING_FIGURES)).toHaveLength(2)
  })

  it('圖都畫好了：不攔快捷鍵（不 preventDefault、不自己呼叫 print），交給瀏覽器', () => {
    mountDetails('<figure class="c-mermaid"><div class="c-mermaid-svg"><svg></svg></div></figure><details id="a"><summary>x</summary>y</details>')
    const p = spyPrint()
    uninstall = installPrintPrep(window)
    const e = pressPrint()
    expect(e.defaultPrevented).toBe(false)
    expect(p).not.toHaveBeenCalled()
    expect((document.querySelector('#a') as HTMLDetailsElement).open).toBe(false) // 沒有展開內容
  })

  it('有圖還沒畫好：攔下快捷鍵，先送 beforeprint 叫圖開始畫（這一輪不展開內容），佔位框消失後稍等再 print()；瀏覽器接著送來的 beforeprint 才展開', () => {
    vi.useFakeTimers()
    const host = mountDetails(`${mermaidPending}${plotPending}<details id="a"><summary>x</summary>y</details>`)
    const p = spyPrint()
    const seen: string[] = []
    window.addEventListener('beforeprint', () => seen.push('beforeprint')) // 模擬 Mermaid／Plot 元件
    uninstall = installPrintPrep(window)
    const a = host.querySelector('#a') as HTMLDetailsElement

    const e = pressPrint({ key: 'P', metaKey: true, ctrlKey: false })
    expect(e.defaultPrevented).toBe(true)
    expect(seen).toEqual(['beforeprint'])
    expect(a.open).toBe(false) // 只是叫圖開始畫，不展開
    expect(p).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1000)
    expect(p).not.toHaveBeenCalled() // 還在等
    pressPrint() // 等待中再按一次：不重複排程
    host.querySelector('.c-mermaid-loading')!.remove()
    host.querySelector('.c-plot-placeholder')!.remove()
    vi.advanceTimersByTime(100 + PRINT_SETTLE_MS - 1)
    expect(p).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2)
    expect(p).toHaveBeenCalledTimes(1)
    expect(a.open).toBe(false)

    // 瀏覽器接著送來真正的 beforeprint／afterprint：照常展開與還原
    beforePrint()
    expect(a.open).toBe(true)
    afterPrint()
    expect(a.open).toBe(false)
    vi.advanceTimersByTime(PRINT_WAIT_MS)
    expect(p).toHaveBeenCalledTimes(1) // 之後不會再多印一次
  })

  it('圖一直畫不完：等到 PRINT_WAIT_MS 就照印', () => {
    vi.useFakeTimers()
    mountDetails(mermaidPending)
    const p = spyPrint()
    uninstall = installPrintPrep(window)
    pressPrint()
    vi.advanceTimersByTime(PRINT_WAIT_MS - 50)
    expect(p).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100 + PRINT_SETTLE_MS + 100)
    expect(p).toHaveBeenCalledTimes(1)
  })

  it('別人已經處理掉的快捷鍵（defaultPrevented）不碰；解除安裝後取消等待中的列印', () => {
    vi.useFakeTimers()
    mountDetails(mermaidPending)
    const p = spyPrint()
    uninstall = installPrintPrep(window)
    const handled = new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, cancelable: true })
    handled.preventDefault()
    window.dispatchEvent(handled)
    vi.advanceTimersByTime(PRINT_WAIT_MS + 1000)
    expect(p).not.toHaveBeenCalled()

    pressPrint()
    uninstall()
    uninstall = null
    vi.advanceTimersByTime(PRINT_WAIT_MS + 1000)
    expect(p).not.toHaveBeenCalled()
  })
})
