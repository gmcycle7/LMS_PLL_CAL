import { StrictMode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import {
  AnchorDeepLink,
  AnchorLink,
  ChRef,
  FormulaLink,
  chapterTarget,
  formulaHref,
  markNavigation,
  normalizeChapterId,
  revealAnchor,
  revealFromRoute,
  routeWithParam,
} from './index'
import { MetricTable } from '../MetricTable'

/** 測試中記錄 scrollIntoView（jsdom 沒有這個函式） */
function stubScroll() {
  const calls: { id: string; arg: unknown }[] = []
  const proto = Element.prototype as unknown as { scrollIntoView?: (arg?: unknown) => void }
  const original = proto.scrollIntoView
  proto.scrollIntoView = function (this: Element, arg?: unknown) {
    calls.push({ id: this.id, arg })
  }
  return {
    calls,
    restore() {
      if (original) proto.scrollIntoView = original
      else delete proto.scrollIntoView
    },
  }
}

function setHash(h: string) {
  window.history.replaceState(null, '', h)
}

/** 放一個目標元素進 document（可選：回報它在視窗裡的位置） */
function mountTarget(id: string, top?: () => number) {
  const fig = document.createElement('figure')
  fig.id = id
  // jsdom 的 getBoundingClientRect 全是 0（沒有版面）；要測位置校正時給它一個真的矩形
  if (top) fig.getBoundingClientRect = () => ({ top: top(), left: 0, right: 600, bottom: top() + 40, width: 600, height: 40, x: 0, y: top(), toJSON: () => ({}) })
  document.body.appendChild(fig)
  return fig
}

beforeEach(() => {
  // 每個測試都當成一次新的導覽：revealFromRoute 的「同一次導覽只捲一次」不會跨測試
  markNavigation()
})

afterEach(() => {
  setHash('#/')
  document.body.innerHTML = ''
})

describe('routeWithParam / formulaHref', () => {
  it('在路由上設定 ?f= 或 ?a=，保留其他參數，f 與 a 互斥', () => {
    expect(routeWithParam('#/ch/05', 'f', 'F-05.1')).toBe('#/ch/05?f=F-05.1')
    expect(routeWithParam('/ch/05?preset=x', 'a', 'sec-2')).toBe('#/ch/05?preset=x&a=sec-2')
    expect(routeWithParam('#/ch/05?f=F-05.1', 'a', 'sec-2')).toBe('#/ch/05?a=sec-2')
    expect(routeWithParam('#/ch/05?a=sec-2', 'f', 'F-05.2')).toBe('#/ch/05?f=F-05.2')
    expect(routeWithParam('', 'f', 'F-DB.1')).toBe('#/?f=F-DB.1')
  })
  it('公式連結的 href 是公式速查頁的真路由，永遠不是 #formula-…', () => {
    expect(formulaHref('F-05.1')).toBe('#/formulas?f=F-05.1')
    expect(formulaHref('F-05.1')).not.toMatch(/^#formula-/)
  })
})

describe('FormulaLink', () => {
  it('本頁有這條公式：攔截點擊、捲過去、展開祖先 <details>、網址改成 目前路由 + ?f=（不新增歷史紀錄）', () => {
    const scroll = stubScroll()
    try {
      setHash('#/ch/05')
      const historyLength = window.history.length
      const { container } = render(
        <details>
          <summary>推導</summary>
          <figure id="formula-F-05.1">公式</figure>
        </details>,
      )
      render(<FormulaLink id="F-05.1" />)
      const link = screen.getByText('F-05.1')
      expect(link.getAttribute('href')).toBe('#/formulas?f=F-05.1')
      const details = container.querySelector('details') as HTMLDetailsElement
      expect(details.open).toBe(false)
      // fireEvent.click 回傳 false 表示預設行為（換 hash）被取消
      expect(fireEvent.click(link)).toBe(false)
      // 瞬間捲動（不是 smooth：長章節的 smooth 動畫會被後面的位置校正截斷）
      expect(scroll.calls.map((c) => c.id)).toEqual(['formula-F-05.1'])
      expect(scroll.calls[0].arg).toMatchObject({ behavior: 'auto', block: 'start' })
      expect(details.open).toBe(true)
      expect(window.location.hash).toBe('#/ch/05?f=F-05.1')
      expect(window.history.length).toBe(historyLength)
      // topbar 不能蓋住目標；目標被聚焦（螢幕閱讀器會讀出它）並短暫標示
      const target = container.querySelector('#formula-F-05\\.1') as HTMLElement
      expect(target.style.scrollMarginTop).toContain('--topbar-h')
      expect(document.activeElement).toBe(target)
      expect(target.getAttribute('data-link-target')).toBe('true')
    } finally {
      scroll.restore()
    }
  })

  it('本頁沒有這條公式：不攔截，讓連結照 href 走（公式速查頁）；路由部分不會被改掉', () => {
    setHash('#/ch/14')
    render(<FormulaLink id="F-06.1" />)
    const link = screen.getByText('F-06.1')
    expect(fireEvent.click(link)).toBe(true)
    expect(window.location.hash.startsWith('#/formulas?f=F-06.1') || window.location.hash === '#/ch/14').toBe(true)
  })

  it('Ctrl／⌘／Shift／Alt 點擊與中鍵不攔截（讓瀏覽器開新分頁）', () => {
    const scroll = stubScroll()
    try {
      setHash('#/ch/05')
      render(
        <>
          <figure id="formula-F-05.1" />
          <FormulaLink id="F-05.1" />
        </>,
      )
      const link = screen.getByText('F-05.1')
      for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
        expect(fireEvent.click(link, init), JSON.stringify(init)).toBe(true)
      }
      expect(scroll.calls).toHaveLength(0)
      expect(window.location.hash).toBe('#/ch/05')
    } finally {
      scroll.restore()
    }
  })

  it('公式速查頁（/formulas）自己用 ?f= 當搜尋字串：在那一頁捲動時不改網址', () => {
    const scroll = stubScroll()
    try {
      setHash('#/formulas')
      render(
        <>
          <figure id="formula-F-UN.1" />
          <FormulaLink id="F-UN.1" />
        </>,
      )
      expect(fireEvent.click(screen.getByText('F-UN.1'))).toBe(false)
      expect(scroll.calls).toHaveLength(1)
      expect(window.location.hash).toBe('#/formulas')
    } finally {
      scroll.restore()
    }
  })

  it('MetricTable 的「公式」欄使用它：沒有任何 #formula-… 的 href', () => {
    const { container } = render(<MetricTable rows={[{ name: 'x', value: 1, formulaId: 'F-12.9' }, { name: 'y', value: 2 }]} />)
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['#/formulas?f=F-12.9'])
  })
})

describe('AnchorLink', () => {
  it('href 是「目前路由 + ?a=id」；本頁有目標時攔截並捲過去，網址跟著更新', () => {
    const scroll = stubScroll()
    try {
      setHash('#/ch/14')
      render(
        <MemoryRouter initialEntries={['/ch/14']}>
          <section id="ch14-budget">預算</section>
          <AnchorLink id="ch14-budget">14.3 預算</AnchorLink>
        </MemoryRouter>,
      )
      const link = screen.getByText('14.3 預算')
      expect(link.getAttribute('href')).toBe('#/ch/14?a=ch14-budget')
      expect(fireEvent.click(link)).toBe(false)
      expect(scroll.calls.map((c) => c.id)).toEqual(['ch14-budget'])
      expect(window.location.hash).toBe('#/ch/14?a=ch14-budget')
    } finally {
      scroll.restore()
    }
  })

  it('不在 <Router> 裡也能用（退回 window.location.hash）；目標不存在時不攔截', () => {
    setHash('#/lab')
    render(<AnchorLink id="lab-experiments">跳到第 7 節</AnchorLink>)
    const link = screen.getByText('跳到第 7 節')
    expect(link.getAttribute('href')).toBe('#/lab?a=lab-experiments')
    expect(fireEvent.click(link)).toBe(true)
  })
})

describe('打開複製下來的連結（?f= / ?a=）：指著自己的連結掛上來時就捲到目標', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('FormulaLink：網址 ?f= 是自己的公式 → 等公式出現再捲過去；同一頁第二條同名連結不再捲；別的公式不捲', () => {
    const scroll = stubScroll()
    try {
      setHash('#/ch/05?f=F-05.1')
      render(
        <>
          <FormulaLink id="F-05.2" />
          <FormulaLink id="F-05.1" />
          <FormulaLink id="F-05.1" />
        </>,
      )
      act(() => {
        vi.advanceTimersByTime(250)
      })
      expect(scroll.calls).toHaveLength(0) // 公式還沒出現（章節 lazy 載入）
      mountTarget('formula-F-05.1')
      act(() => {
        vi.advanceTimersByTime(250)
      })
      expect(scroll.calls.map((c) => c.id)).toEqual(['formula-F-05.1'])
      // 之後才掛上來的同名連結（例如按 Run 之後的指標表）：同一次導覽，不再捲
      render(<FormulaLink id="F-05.1" />)
      act(() => {
        vi.advanceTimersByTime(250)
      })
      expect(scroll.calls).toHaveLength(1)
      // 上一頁／下一頁（popstate）之後回到同一個網址：再捲一次
      window.dispatchEvent(new Event('popstate'))
      render(<FormulaLink id="F-05.1" />)
      act(() => {
        vi.advanceTimersByTime(250)
      })
      expect(scroll.calls).toHaveLength(2)
    } finally {
      scroll.restore()
    }
  })

  it('React StrictMode（開發模式 effect 掛上→拆掉→再掛）：還是會捲，而且只捲一次', () => {
    const scroll = stubScroll()
    try {
      mountTarget('formula-F-05.1')
      render(
        <StrictMode>
          <MemoryRouter initialEntries={['/ch/05?f=F-05.1']}>
            <AnchorDeepLink />
            <FormulaLink id="F-05.1" />
            <FormulaLink id="F-05.1" />
          </MemoryRouter>
        </StrictMode>,
      )
      act(() => {
        vi.advanceTimersByTime(50)
      })
      expect(scroll.calls.map((c) => c.id)).toEqual(['formula-F-05.1'])
    } finally {
      scroll.restore()
    }
  })

  it('AnchorLink 在 <Router> 裡：用 react-router 的 location（?a=ch14-budget）', () => {
    const scroll = stubScroll()
    try {
      render(
        <MemoryRouter initialEntries={['/ch/14?a=ch14-budget']}>
          <section id="ch14-budget">預算</section>
          <AnchorLink id="ch14-compare">比較</AnchorLink>
          <AnchorLink id="ch14-budget">預算</AnchorLink>
        </MemoryRouter>,
      )
      act(() => {
        vi.advanceTimersByTime(50)
      })
      expect(scroll.calls.map((c) => c.id)).toEqual(['ch14-budget'])
    } finally {
      scroll.restore()
    }
  })

  it('點擊後 replaceState 寫進去的 ?f= 不會讓之後掛上來的同名連結再捲一次', () => {
    const scroll = stubScroll()
    try {
      setHash('#/ch/05')
      mountTarget('formula-F-05.1')
      render(<FormulaLink id="F-05.1" />)
      fireEvent.click(screen.getByText('F-05.1'))
      expect(window.location.hash).toBe('#/ch/05?f=F-05.1')
      expect(scroll.calls).toHaveLength(1)
      render(<FormulaLink id="F-05.1" />) // 例如按 Run 之後出現的指標表
      act(() => {
        vi.advanceTimersByTime(300)
      })
      expect(scroll.calls).toHaveLength(1)
    } finally {
      scroll.restore()
    }
  })

  it('公式速查頁的 ?f= 是搜尋字串：那一頁的 FormulaLink 掛上來時不捲', () => {
    const scroll = stubScroll()
    try {
      setHash('#/formulas?f=F-12.9')
      mountTarget('formula-F-12.9')
      render(<FormulaLink id="F-12.9" />)
      act(() => {
        vi.advanceTimersByTime(300)
      })
      expect(scroll.calls).toHaveLength(0)
      expect(revealFromRoute('/formulas?f=F-12.9')).toBeNull()
      expect(revealFromRoute('/ch/12')).toBeNull()
    } finally {
      scroll.restore()
    }
  })
})

describe('ChRef', () => {
  const cases: [string, string][] = [
    ['05', '/ch/05'],
    ['5', '/ch/05'],
    ['Ch05', '/ch/05'],
    ['00', '/ch/00'],
    ['14', '/ch/14'],
    ['07b', '/case/sspll'],
  ]
  it.each(cases)('ch=%s → %s', (ch, to) => {
    expect(chapterTarget(ch)?.to).toBe(to)
    render(
      <MemoryRouter>
        <ChRef ch={ch}>內文原本的寫法</ChRef>
      </MemoryRouter>,
    )
    const a = screen.getByText('內文原本的寫法')
    expect(a.tagName).toBe('A')
    expect(a.getAttribute('href')).toBe(to) // MemoryRouter 的 NavLink：/ch/05
    expect(a.className).toContain('c-chref')
  })

  it('連結文字照內文寫的放；沒給文字就用「第 05 章」「07b 案例」；sec 附在後面；hover 顯示章名（來自 registry）', () => {
    render(
      <MemoryRouter>
        <p>
          <ChRef ch="5" /> <ChRef ch="07b" /> <ChRef ch="08" sec="§8.4">Ch08</ChRef>
        </p>
      </MemoryRouter>,
    )
    expect(screen.getByText('第 05 章').getAttribute('title')).toBe('05 1-bit Comparator 統計')
    expect(screen.getByText('07b 案例').getAttribute('href')).toBe('/case/sspll')
    expect(screen.getByText('Ch08 §8.4').getAttribute('title')).toContain('08 LMS Phase Margin')
  })

  it('不在 <Router> 裡退回 <a href="#/ch/05">；不存在的章編號只顯示文字、不產生連結', () => {
    const { container } = render(
      <p>
        <ChRef ch="05">第 05 章</ChRef>
        <ChRef ch="99">第 99 章</ChRef>
      </p>,
    )
    expect(container.querySelector('a')?.getAttribute('href')).toBe('#/ch/05')
    expect(container.querySelectorAll('a')).toHaveLength(1)
    expect(screen.getByText('第 99 章').tagName).toBe('SPAN')
  })

  it('normalizeChapterId', () => {
    expect(normalizeChapterId('ch5')).toBe('05')
    expect(normalizeChapterId(' 07B ')).toBe('07b')
    expect(normalizeChapterId('x')).toBeNull()
  })

  it('點擊走路由（不整頁重新載入）：目前頁面的 location 變成 /ch/05', () => {
    function Where() {
      return <div data-testid="where">{useLocation().pathname}</div>
    }
    render(
      <MemoryRouter initialEntries={['/ch/14']}>
        <ChRef ch="05">Ch05</ChRef>
        <Where />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByText('Ch05'))
    expect(screen.getByTestId('where').textContent).toBe('/ch/05')
  })
})

describe('AnchorDeepLink', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('?f=F-05.1：目標晚一點才出現（lazy 載入）也會捲過去；?a=id 同理', () => {
    const scroll = stubScroll()
    try {
      render(
        <MemoryRouter initialEntries={['/ch/05?f=F-05.1']}>
          <AnchorDeepLink />
        </MemoryRouter>,
      )
      act(() => {
        vi.advanceTimersByTime(300)
      })
      expect(scroll.calls).toHaveLength(0)
      mountTarget('formula-F-05.1')
      act(() => {
        vi.advanceTimersByTime(300)
      })
      expect(scroll.calls.map((c) => c.id)).toContain('formula-F-05.1')
    } finally {
      scroll.restore()
    }
  })

  it('和頁內指著同一個目標的 FormulaLink 一起掛：只捲一次', () => {
    const scroll = stubScroll()
    try {
      mountTarget('formula-F-05.1')
      render(
        <MemoryRouter initialEntries={['/ch/05?f=F-05.1']}>
          <AnchorDeepLink />
          <FormulaLink id="F-05.1" />
        </MemoryRouter>,
      )
      act(() => {
        vi.advanceTimersByTime(50)
      })
      expect(scroll.calls.map((c) => c.id)).toEqual(['formula-F-05.1'])
    } finally {
      scroll.restore()
    }
  })

  it('公式速查頁的 ?f= 是搜尋字串：不捲動；沒有參數也不做事', () => {
    const scroll = stubScroll()
    try {
      mountTarget('formula-F-12.9')
      render(
        <MemoryRouter initialEntries={['/formulas?f=F-12.9']}>
          <AnchorDeepLink />
        </MemoryRouter>,
      )
      render(
        <MemoryRouter initialEntries={['/ch/12']}>
          <AnchorDeepLink />
        </MemoryRouter>,
      )
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(scroll.calls).toHaveLength(0)
    } finally {
      scroll.restore()
    }
  })
})

describe('捲動之後的位置校正（延後渲染的圖會把目標推離原位）', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('瞬間捲到目標；前 0.5 s 每個 frame 檢查、1 s／2 s 再檢查，偏掉就瞬間拉回；已在位置上就不動', () => {
    const scroll = stubScroll()
    try {
      let top = 68 // 剛好在 topbar 下面
      mountTarget('formula-F-09.1', () => top)
      expect(revealAnchor('formula-F-09.1')).toBe(true)
      expect(scroll.calls).toHaveLength(1)
      expect(scroll.calls[0].arg).toMatchObject({ behavior: 'auto', block: 'start' })
      act(() => {
        vi.advanceTimersByTime(200)
      })
      expect(scroll.calls).toHaveLength(1) // 在位置上：frame 檢查不動
      top = 900 // 上方的圖後來長高，把目標推到下面
      act(() => {
        vi.advanceTimersByTime(40)
      })
      expect(scroll.calls.length).toBeGreaterThanOrEqual(2) // 下一個 frame 就拉回來
      expect(scroll.calls[1].arg).toMatchObject({ behavior: 'auto', block: 'start' })
      top = 68
      const n = scroll.calls.length
      act(() => {
        vi.advanceTimersByTime(700)
      })
      expect(scroll.calls).toHaveLength(n) // 已經在位置上：不再動
      top = 300 // 1 s 的檢查
      act(() => {
        vi.advanceTimersByTime(200)
      })
      expect(scroll.calls).toHaveLength(n + 1)
      top = 68
      act(() => {
        vi.advanceTimersByTime(3000)
      })
      expect(scroll.calls).toHaveLength(n + 1)
    } finally {
      scroll.restore()
    }
  })

  it('使用者自己捲動（wheel／拖捲軸）之後就不再校正', () => {
    const scroll = stubScroll()
    try {
      let top = 68
      mountTarget('formula-F-09.1', () => top)
      revealAnchor('formula-F-09.1')
      window.dispatchEvent(new Event('mousedown'))
      top = 900
      act(() => {
        vi.advanceTimersByTime(2500)
      })
      expect(scroll.calls).toHaveLength(1)
    } finally {
      scroll.restore()
    }
  })
})
