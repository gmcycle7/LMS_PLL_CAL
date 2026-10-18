import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Component, type ReactNode } from 'react'
import { act, cleanup, render, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { hasLocatingParam, keepViewBelow, lazyPart, NEAR_MARGIN_PX, NearGate, preloadModule, resetModuleCache, useModule } from './lazy'

/**
 * 工具型頁面共用的延後載入工具（lazy.tsx）：NearGate（接近可視範圍才掛載）、useModule（頁面資料在背景載入）、lazyPart。
 * 首屏模組不可靜態 import 它們包住的東西，由 lazyBoundary.test.ts 檢查；這裡檢查行為。
 */

/** 可手動觸發的 IntersectionObserver 替身 */
class FakeIO {
  static instances: FakeIO[] = []
  observed: Element[] = []
  disconnected = false
  constructor(
    private cb: IntersectionObserverCallback,
    public options?: IntersectionObserverInit,
  ) {
    FakeIO.instances.push(this)
  }
  observe(el: Element) {
    this.observed.push(el)
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true
  }
  takeRecords() {
    return []
  }
  fire(isIntersecting: boolean) {
    this.cb(this.observed.map((target) => ({ isIntersecting, target }) as IntersectionObserverEntry), this as unknown as IntersectionObserver)
  }
}

const gateOf = (c: ParentNode) => c.querySelector('[data-lazy-gate]') as HTMLElement | null

function inRouter(ui: ReactNode, url = '/') {
  return render(<MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter>)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  FakeIO.instances.length = 0
})

describe('hasLocatingParam：網址是不是在指著「頁面上不知道在哪個區塊」的位置（?f=、?a=）', () => {
  it.each([
    ['?f=F-05.1', true],
    ['f=F-VF.4&x=1', true],
    ['?a=handcalc-HC-14.5', true],
    ['?tab=practice&a=handcalc-HC-14.5', true],
    // 只指向特定區塊或首屏內容的參數：不強制所有區塊（?e= 由勘誤區自己 force；?t=、?hc= 的目標在首屏）
    ['?e=E05', false],
    ['t=T05', false],
    ['?hc=HC-03.2', false],
    ['?inspect=ch05-demo&x=1', false],
    ['?preset=abc', false],
    ['?tab=practice&seed=3', false],
    ['?ch=ch05&level=beginner', false],
    ['', false],
  ])('%s → %s', (search, want) => {
    expect(hasLocatingParam(search)).toBe(want)
  })
})

describe('NearGate：占位區接近可視範圍才掛載 children', () => {
  it('沒有 IntersectionObserver（jsdom、很舊的瀏覽器）：立刻掛載，不留空白', () => {
    expect(typeof IntersectionObserver).toBe('undefined')
    const { container } = inRouter(
      <NearGate label="X">
        <p data-testid="body">內容</p>
      </NearGate>,
    )
    expect(container.textContent).toContain('內容')
    expect(gateOf(container)).toBeNull()
  })

  it('有 IntersectionObserver：先只有占位區（label、最小高度、aria-busy、data-lazy-kind），相交之後才掛載，之後不再觀察', () => {
    vi.stubGlobal('IntersectionObserver', FakeIO)
    let mounted = 0
    const Child = () => {
      mounted++
      return <p>內容</p>
    }
    const { container } = inRouter(
      <NearGate label="Preset Inspector" minHeight={2200} kind="exp" className="gal-loading">
        <Child />
      </NearGate>,
    )
    const gate = gateOf(container)!
    expect(gate.textContent).toBe('載入 Preset Inspector…')
    expect(gate.style.minHeight).toBe('2200px')
    expect(gate.getAttribute('aria-busy')).toBe('true')
    expect(gate.getAttribute('data-lazy-kind')).toBe('exp')
    expect(gate.className).toContain('gal-loading')
    expect(mounted).toBe(0)
    // 觀察的是占位區本身，提前量是 NEAR_MARGIN_PX
    const io = FakeIO.instances[0]
    expect(io.observed).toEqual([gate])
    expect(io.options?.rootMargin).toBe(`${NEAR_MARGIN_PX}px 0px`)
    // 還沒相交（isIntersecting = false）：不掛載
    act(() => io.fire(false))
    expect(mounted).toBe(0)
    act(() => io.fire(true))
    expect(mounted).toBeGreaterThan(0)
    expect(container.textContent).toContain('內容')
    expect(gateOf(container)).toBeNull()
    expect(io.disconnected).toBe(true)
  })

  it('force：不等捲動，立刻掛載（也不建立 observer）', () => {
    vi.stubGlobal('IntersectionObserver', FakeIO)
    const { container } = inRouter(
      <NearGate label="X" force>
        <p>內容</p>
      </NearGate>,
    )
    expect(container.textContent).toContain('內容')
    expect(FakeIO.instances).toHaveLength(0)
  })

  it('網址帶 ?f=／?a=（公式、頁內錨點，不知道在哪個區塊）：所有區塊立刻掛載——深連結的目標不能等使用者捲過去', () => {
    vi.stubGlobal('IntersectionObserver', FakeIO)
    for (const url of ['/verification?f=F-VF.4', '/ch/05?f=F-05.1', '/workbook?a=handcalc-HC-14.5']) {
      const { container, unmount } = inRouter(
        <NearGate label="X">
          <p>內容</p>
        </NearGate>,
        url,
      )
      expect(container.textContent, url).toContain('內容')
      unmount()
    }
  })

  it('?e=、?t=、?hc=、?tab= 這類只指向特定區塊或首屏內容的參數：不強制（照樣等相交）；要不要提早掛載由區塊自己用 force 決定', () => {
    vi.stubGlobal('IntersectionObserver', FakeIO)
    for (const url of ['/verification?e=E05', '/verification?t=T05', '/workbook?hc=HC-01.1', '/gallery?inspect=x', '/workbook?tab=practice&seed=3']) {
      const { container, unmount } = inRouter(
        <NearGate label="X">
          <p>內容</p>
        </NearGate>,
        url,
      )
      expect(gateOf(container), url).toBeTruthy()
      expect(container.textContent, url).not.toContain('內容')
      unmount()
    }
    const { container } = inRouter(
      <NearGate label="X" force>
        <p>內容</p>
      </NearGate>,
      '/verification?e=E05',
    )
    expect(container.textContent).toContain('內容')
  })

  it('列印（beforeprint）：還沒捲到的區塊也要出現，否則印出「載入中…」', () => {
    vi.stubGlobal('IntersectionObserver', FakeIO)
    const { container } = inRouter(
      <NearGate label="X">
        <p>內容</p>
      </NearGate>,
    )
    expect(gateOf(container)).toBeTruthy()
    act(() => {
      window.dispatchEvent(new Event('beforeprint'))
    })
    expect(container.textContent).toContain('內容')
  })

  it('不在 Router 裡也能用（單元測試直接 render 區塊）', () => {
    const { container } = render(
      <NearGate>
        <p>內容</p>
      </NearGate>,
    )
    expect(container.textContent).toContain('內容')
  })

  it('離開頁面（unmount）會 disconnect observer、移除 beforeprint 監聽', () => {
    vi.stubGlobal('IntersectionObserver', FakeIO)
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = inRouter(
      <NearGate label="X">
        <p>內容</p>
      </NearGate>,
    )
    unmount()
    expect(FakeIO.instances[0].disconnected).toBe(true)
    expect(remove.mock.calls.some((call) => String(call[0]) === 'beforeprint')).toBe(true)
    remove.mockRestore()
  })

  it('children 是 React.lazy 的元件：載入期間占位區留在畫面上（同一個 data-lazy-gate），載完才換成內容', async () => {
    let release!: (m: { default: () => ReactNode }) => void
    const Lazy = lazyPart(() => new Promise<{ default: () => ReactNode }>((r) => (release = r)))
    const { container } = inRouter(
      <NearGate label="慢的區塊" minHeight={300}>
        <Lazy />
      </NearGate>,
    )
    // 沒有 IntersectionObserver ⇒ 立刻掛載 Lazy；它還在下載，所以看到的是占位區
    expect(gateOf(container)?.textContent).toBe('載入 慢的區塊…')
    expect(container.textContent).not.toContain('載好了')
    await act(async () => {
      release({ default: () => <p>載好了</p> })
    })
    await waitFor(() => expect(container.textContent).toContain('載好了'))
    expect(gateOf(container)).toBeNull()
  })
})

describe('useModule：頁面資料在背景載入', () => {
  interface Mod {
    value: number
  }
  function Probe({ load }: { load: () => Promise<Mod> }) {
    const m = useModule(load)
    return <p data-testid="probe">{m === null ? '…' : `值 ${m.value}`}</p>
  }
  class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
    state = { error: null as Error | null }
    static getDerivedStateFromError(error: Error) {
      return { error }
    }
    render() {
      return this.state.error ? <p data-testid="caught">{this.state.error.message}</p> : this.props.children
    }
  }

  it('載入前回傳 null；載完重新 render；同一個 loader 只真的 import 一次（多個元件共用）', async () => {
    const load = vi.fn(async () => ({ value: 42 }))
    const a = render(<Probe load={load} />)
    expect(a.getByTestId('probe').textContent).toBe('…')
    await waitFor(() => expect(a.getByTestId('probe').textContent).toBe('值 42'))
    const b = render(<Probe load={load} />)
    expect(within(b.container).getByTestId('probe').textContent, '載過之後第一次 render 就拿得到，不會再閃一次占位').toBe('值 42')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('preloadModule 先開始載入（不必等第一次 render），回傳同一個結果；之後 useModule 同步拿到', async () => {
    const load = vi.fn(async () => ({ value: 7 }))
    const p1 = preloadModule(load)
    const p2 = preloadModule(load)
    expect(await p1).toEqual({ value: 7 })
    expect(await p2).toEqual({ value: 7 })
    expect(load).toHaveBeenCalledTimes(1)
    const { getByTestId } = render(<Probe load={load} />)
    expect(getByTestId('probe').textContent).toBe('值 7')
  })

  it('載入失敗：在 render 裡丟出，交給外框的 ErrorBoundary；清掉快取之後（重試）會再 import 一次', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let fail = true
    const load = vi.fn(async () => {
      if (fail) throw new Error('boom')
      return { value: 1 }
    })
    const { getByTestId } = render(
      <Boundary>
        <Probe load={load} />
      </Boundary>,
    )
    await waitFor(() => expect(getByTestId('caught').textContent).toBe('boom'))
    expect(load, '失敗之後不會自己無限重試').toHaveBeenCalledTimes(1)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(load).toHaveBeenCalledTimes(1)
    cleanup()
    // 「重試」＝重新掛載：失敗的快取已經被清掉，所以會真的再 import 一次
    fail = false
    const again = render(
      <Boundary>
        <Probe load={load} />
      </Boundary>,
    )
    await waitFor(() => expect(again.getByTestId('probe').textContent).toBe('值 1'))
    expect(load).toHaveBeenCalledTimes(2)
    vi.restoreAllMocks()
  })

  it('resetModuleCache：下一次 render 重新載入（測試用）', async () => {
    const load = vi.fn(async () => ({ value: 3 }))
    await preloadModule(load)
    resetModuleCache(load)
    const { getByTestId } = render(<Probe load={load} />)
    expect(getByTestId('probe').textContent).toBe('…')
    await waitFor(() => expect(getByTestId('probe').textContent).toBe('值 3'))
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('元件在載入完成前就卸載：不會對已卸載的元件 setState（沒有 act／unmounted 警告）', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let release!: (m: Mod) => void
    const load = () => new Promise<Mod>((r) => (release = r))
    const { unmount } = render(<Probe load={load} />)
    unmount()
    await act(async () => {
      release({ value: 9 })
    })
    expect(err).not.toHaveBeenCalled()
    err.mockRestore()
  })
})

describe('lazyPart：React.lazy + 失敗復原，任何 props 的元件都能用', () => {
  it('有必要 props 的元件也推得出型別，載完正常 render', async () => {
    const Needs = ({ label }: { label: string }) => <p>{label}</p>
    const Lazy = lazyPart(async () => ({ default: Needs }))
    const { container } = render(
      <NearGate>
        <Lazy label="有 props" />
      </NearGate>,
    )
    await waitFor(() => expect(container.textContent).toContain('有 props'))
  })
})

describe('NearGate：內容取代占位區的那一刻，補償捲動位置（keepViewBelow）', () => {
  /** 讓 jsdom 的元素有版面：宿主元素（占位時 data-lazy-gate、掛載後 .lazy-gate-host）回傳指定的 top 與高度 */
  function layout(top: number, pendingHeight: number, contentHeight: number) {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      // 補償的那一刻宿主還帶著占位的屬性（狀態在下一次 render 才換）：以「裡面是不是還是占位文字」判斷它現在多高
      const isHost = this.hasAttribute('data-lazy-gate') || this.classList.contains('lazy-gate-host')
      const pending = isHost && /^載入/.test(this.textContent ?? '')
      const height = isHost ? (pending ? pendingHeight : contentHeight) : 0
      return { top, left: 0, right: 0, bottom: top + height, width: 0, height, x: 0, y: top, toJSON: () => ({}) } as DOMRect
    })
  }
  let scrollBy: ReturnType<typeof vi.fn>
  beforeEach(() => {
    scrollBy = vi.fn()
    vi.stubGlobal('scrollBy', scrollBy)
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true, writable: true })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function mountLazy(top: number, pendingHeight: number, contentHeight: number) {
    layout(top, pendingHeight, contentHeight)
    let release!: (m: { default: () => ReactNode }) => void
    const Lazy = lazyPart(() => new Promise<{ default: () => ReactNode }>((r) => (release = r)))
    const { container } = inRouter(
      <NearGate label="§V.6 勘誤瀏覽器" minHeight={pendingHeight}>
        <Lazy />
      </NearGate>,
    )
    expect(gateOf(container)).toBeTruthy()
    await act(async () => {
      release({ default: () => <p>內容</p> })
    })
    await waitFor(() => expect(container.textContent).toContain('內容'))
    return container
  }

  it('區塊整個在可視範圍上方（使用者從目錄跳到更下面的區塊、或頁首連到頁尾的符號表）：捲動位置移動「內容高度 − 占位高度」，看的東西不動', async () => {
    const container = await mountLazy(-5000, 3000, 33880)
    expect(scrollBy).toHaveBeenCalledTimes(1)
    expect(scrollBy).toHaveBeenCalledWith(0, 33880 - 3000)
    // 宿主留著（拿掉它 React 會把內容整個重新掛載），但不再是占位區：沒有 data-lazy-gate／aria-busy／min-height
    const host = container.querySelector('.lazy-gate-host') as HTMLElement
    expect(host).toBeTruthy()
    expect(host.hasAttribute('data-lazy-gate')).toBe(false)
    expect(host.getAttribute('aria-busy')).toBeNull()
    expect(host.style.minHeight).toBe('')
    expect(host.textContent).toBe('內容')
  })

  it('區塊只露出尾巴（舊底邊在視窗內，使用者看的是它下面的標題）：一樣補償', async () => {
    await mountLazy(-2960, 3000, 33880)
    expect(scrollBy).toHaveBeenCalledWith(0, 33880 - 3000)
  })

  it('內容比占位區矮（負的差）也補償：下面的內容不會往上跳', async () => {
    await mountLazy(-5000, 3000, 2400)
    expect(scrollBy).toHaveBeenCalledWith(0, 2400 - 3000)
  })

  it('占位區的頂端在視窗內（使用者捲到它、或跳到它上面的標題）：不動，內容就在原地出現', async () => {
    await mountLazy(120, 3000, 33880)
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('舊範圍蓋住整個視窗（使用者正看著占位區中段）：不動', async () => {
    await mountLazy(-1000, 3000, 33880)
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('區塊在可視範圍下方：不動', async () => {
    await mountLazy(2000, 3000, 33880)
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('高度沒變：不動', async () => {
    await mountLazy(-5000, 3000, 3000)
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('keepViewBelow 直接呼叫：回傳移動量；不符合條件時回傳 0、不捲動', () => {
    layout(-4000, 500, 2500)
    const host = document.createElement('div')
    host.className = 'lazy-gate-host'
    expect(keepViewBelow(host, 500)).toBe(2000)
    expect(scrollBy).toHaveBeenCalledWith(0, 2000)
    scrollBy.mockClear()
    layout(10, 500, 2500)
    expect(keepViewBelow(host, 500)).toBe(0)
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('補償在宿主換成最終樣子（沒有 .small 字級與 min-height）之後才量：量到的是內容在最終字級下的高度', async () => {
    // 量高度時宿主若還帶著占位的 class（.small 字級較小），內容的高度會偏小；這裡以 class 判斷回傳的高度，驗證量測發生在 class 換掉之後
    vi.restoreAllMocks()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const pendingAttrs = this.hasAttribute('data-lazy-gate')
      const isHost = pendingAttrs || this.classList.contains('lazy-gate-host')
      const height = !isHost ? 0 : /^載入/.test(this.textContent ?? '') ? 3000 : pendingAttrs ? 29888 : 32875
      return { top: -5000, left: 0, right: 0, bottom: -5000 + height, width: 0, height, x: 0, y: -5000, toJSON: () => ({}) } as DOMRect
    })
    let release!: (m: { default: () => ReactNode }) => void
    const Lazy = lazyPart(() => new Promise<{ default: () => ReactNode }>((r) => (release = r)))
    const { container } = inRouter(
      <NearGate label="§V.6 勘誤瀏覽器" minHeight={3000}>
        <Lazy />
      </NearGate>,
    )
    await act(async () => {
      release({ default: () => <p>內容</p> })
    })
    await waitFor(() => expect(container.textContent).toContain('內容'))
    expect(scrollBy).toHaveBeenCalledTimes(1)
    expect(scrollBy).toHaveBeenCalledWith(0, 32875 - 3000)
  })
})

describe('lazy.css：宿主的版面規則', () => {
  const css = readFileSync(join(process.cwd(), 'src/pages/verification/lazy.css'), 'utf8')

  it('.c-section-body 裡第一個子元素是宿主時，宿主裡的第一個元素補上 margin-top: 0（和沒有宿主時的版面一樣）', () => {
    expect(css).toMatch(/\.c-section-body > \.lazy-gate-host:first-child > :first-child \{\s*margin-top: 0;\s*\}/)
  })

  it('列印時占位區不留預留高度（chunk 沒來得及下載的區塊只印一行，不印好幾頁空白）', () => {
    const print = /@media print \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    expect(print).toMatch(/\.lazy-gate \{\s*min-height: 0 !important;\s*\}/)
  })

  it('lazy.tsx 匯入 lazy.css（規則跟著元件走）', () => {
    expect(readFileSync(join(process.cwd(), 'src/pages/verification/lazy.tsx'), 'utf8')).toMatch(/import '\.\/lazy\.css'/)
  })
})
