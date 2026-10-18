import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '@/app/settings'
import GalleryPage from './index'

/**
 * Gallery 的三個延後區塊（§4 的數值驗算表、§6 的 Preset Inspector、§7 的核心程式碼）：
 * 預設都等占位區接近可視範圍才下載；?inspect=／?preset= 只決定 Inspector 一開始選哪個 preset，不強制任何區塊；
 * 按了卡片上的「在 Inspector 檢視／匯出」，Inspector 立刻掛載（標題與捲動目標在占位區外面）；?f=／?a= 全部立刻掛載。
 * 三個區塊的內容與預覽面板換成輕量的替身，這裡只檢查「什麼時候掛載、掛載時拿到哪個 preset」。
 */
vi.mock('./sections/Inspector', async () => {
  const { createElement } = await import('react')
  return { default: ({ selected }: { selected: string }) => createElement('div', { 'data-testid': 'inspector-body', 'data-selected': selected }, 'inspector') }
})
vi.mock('./sections/CodeSection', async () => {
  const { createElement } = await import('react')
  return { default: () => createElement('div', { 'data-testid': 'code-body' }, 'code') }
})
vi.mock('./sections/UnifiedCheck', async () => {
  const { createElement } = await import('react')
  return { default: () => createElement('div', { 'data-testid': 'unified-body' }, 'unified') }
})
vi.mock('./sections/PreviewPanel', async () => {
  const { createElement } = await import('react')
  return { default: () => createElement('div', { 'data-testid': 'preview-body' }, 'preview') }
})
vi.mock('plotly.js-cartesian-dist-min', () => ({ default: { react: vi.fn(async () => undefined), purge: vi.fn(), Plots: { resize: vi.fn() } } }))
vi.mock('mermaid', () => ({
  default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })), parse: vi.fn(async () => true) },
}))

class FakeIO {
  static instances: FakeIO[] = []
  observed: Element[] = []
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
  disconnect() {}
  takeRecords() {
    return []
  }
  fire(target: Element) {
    this.cb([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

const LABELS = { unified: '模型模組與數值驗算', inspector: 'Preset Inspector', code: '核心程式碼' }
const WAIT = { timeout: 20000 }

function waiting(): string[] {
  return FakeIO.instances.flatMap((io) => io.observed).filter((el) => el.isConnected && el.hasAttribute('data-lazy-gate')).map((el) => el.getAttribute('data-lazy-gate') ?? '')
}

function renderPage(url: string) {
  localStorage.setItem('lmspll.mode', 'engineer')
  return render(
    <SettingsProvider>
      <MemoryRouter initialEntries={[url]}>
        <GalleryPage />
      </MemoryRouter>
    </SettingsProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', FakeIO)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  FakeIO.instances.length = 0
})

describe('Gallery 的延後區塊', () => {
  it('預設：三個區塊都只有占位區；標題（§6、§7 的 h2）在占位區外面', () => {
    const { container } = renderPage('/gallery')
    expect(waiting().sort()).toEqual([LABELS.unified, LABELS.inspector, LABELS.code].sort())
    expect(container.querySelector('[data-testid$="-body"]')).toBeNull()
    expect(container.querySelector('#gal-s6')).toBeTruthy()
    expect(container.querySelector('#gal-s7')).toBeTruthy()
  }, 60000)

  it('?inspect=<id>：Inspector 不強制載入（頁面不會因此捲到 §6）；使用者捲到時掛載，打開的就是網址指定的 preset', async () => {
    const { container, findByTestId } = renderPage('/gallery?inspect=noise-t13-example')
    expect(waiting()).toContain(LABELS.inspector)
    expect(container.querySelector('[data-testid="inspector-body"]')).toBeNull()
    const gate = Array.from(container.querySelectorAll('[data-lazy-gate]')).find((el) => el.getAttribute('data-lazy-gate') === LABELS.inspector)!
    const io = FakeIO.instances.find((i) => i.observed.includes(gate))!
    act(() => io.fire(gate))
    expect((await findByTestId('inspector-body')).getAttribute('data-selected')).toBe('noise-t13-example')
    // 其他兩個區塊仍在等捲動
    expect(waiting().sort()).toEqual([LABELS.unified, LABELS.code].sort())
  }, 60000)

  it('按「在 Inspector 檢視／匯出」：Inspector 立刻掛載並選到那個 preset（不必等相交），其他區塊不受影響', async () => {
    const { container, findByTestId } = renderPage('/gallery')
    const card = container.querySelector('section.gal-slot[data-slot="5"] article.gal-card') as HTMLElement
    const button = Array.from(card.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === '在 Inspector 檢視／匯出')!
    fireEvent.click(button)
    const body = await findByTestId('inspector-body')
    expect(body.getAttribute('data-selected')).toBe(card.getAttribute('data-preset'))
    await waitFor(() => expect(waiting()).not.toContain(LABELS.inspector), WAIT)
    expect(waiting().sort()).toEqual([LABELS.unified, LABELS.code].sort())
  }, 60000)

  it('?f=（頁面不知道目標在哪個區塊）：三個區塊全部立刻掛載', async () => {
    const { findByTestId } = renderPage('/gallery?f=F-GL.1')
    await findByTestId('inspector-body')
    await findByTestId('code-body')
    await findByTestId('unified-body')
    expect(waiting()).toEqual([])
  }, 60000)
})
