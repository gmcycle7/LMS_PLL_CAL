import { act, cleanup, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ErrataBrowser } from './sections/ErrataBrowser'
import { HowItWorks } from './sections/HowItWorks'
import { MonteCarloLab } from './sections/MonteCarloLab'
import { NegativeTests } from './sections/NegativeTests'

/**
 * /verification 的深連結要不要把整頁的延後區塊一起下載（首屏不必付 §V.3–§V.6 的重量，深連結也不該為不相干的區塊付）：
 *   ?e=E05 → 只有勘誤區（卡片在裡面）立刻掛載；?t=T05 → 目標在首屏的驗收表，不強制任何區塊；
 *   ?f=／?a=（頁面不知道目標在哪個區塊）→ 全部立刻掛載。
 * 四個區塊的內容（Body）換成輕量的替身：這裡只檢查「哪些區塊在等捲動」，區塊本身的功能由 index.test.tsx／index.heavy.test.tsx 檢查。
 */
vi.mock('./sections/MonteCarloLabBody', async () => {
  const { createElement } = await import('react')
  return { MonteCarloLabBody: () => createElement('p', { 'data-testid': 'body-mc' }, 'mc') }
})
vi.mock('./sections/NegativeTestsBody', async () => {
  const { createElement } = await import('react')
  return { NegativeTestsBody: () => createElement('p', { 'data-testid': 'body-neg' }, 'neg') }
})
vi.mock('./sections/HowItWorksBody', async () => {
  const { createElement } = await import('react')
  return { HowItWorksBody: () => createElement('p', { 'data-testid': 'body-how' }, 'how') }
})
vi.mock('./sections/ErrataBrowserBody', async () => {
  const { createElement } = await import('react')
  return { ErrataBrowserBody: ({ focusEid }: { focusEid: string | null }) => createElement('p', { 'data-testid': 'body-errata' }, `errata ${focusEid ?? ''}`) }
})

/** 記下每一次 observe 的元素的 IntersectionObserver 替身（只在 NearGate 還在等捲動時才會有） */
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

const LABELS = { mc: '§V.3 Monte Carlo 驗收', neg: '§V.4 反面測試', how: '§V.5 驗證管線', errata: '§V.6 勘誤瀏覽器' }

/** 還在等捲動的延後區塊（占位區的 data-lazy-gate 標籤） */
function waiting(): string[] {
  return FakeIO.instances.flatMap((io) => io.observed).filter((el) => el.isConnected && el.hasAttribute('data-lazy-gate')).map((el) => el.getAttribute('data-lazy-gate') ?? '')
}

function renderBlocks(url: string) {
  const eid = new URLSearchParams(url.split('?')[1] ?? '').get('e')
  return render(
    <MemoryRouter initialEntries={[url]}>
      <MonteCarloLab />
      <NegativeTests />
      <HowItWorks />
      <ErrataBrowser focusEid={eid} />
    </MemoryRouter>,
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

describe('/verification 的延後區塊：哪些在等捲動、哪些為深連結立刻掛載', () => {
  it('沒有深連結：四個區塊都只有占位區（h2 標題在占位區外面），沒有內容', () => {
    const { container } = renderBlocks('/verification')
    expect(waiting()).toEqual([LABELS.mc, LABELS.neg, LABELS.how, LABELS.errata])
    expect(container.querySelectorAll('[data-testid^="body-"]')).toHaveLength(0)
    for (const id of ['ver-mc', 'ver-negative', 'ver-pipeline', 'ver-errata']) expect(container.querySelector(`#${id} h2`), `${id} 的標題`).toBeTruthy()
  })

  it('?e=E05：只有勘誤區立刻掛載（並收到 focusEid），§V.3–§V.5 仍在等捲動', async () => {
    const { container, findByTestId } = renderBlocks('/verification?e=E05')
    expect((await findByTestId('body-errata')).textContent).toBe('errata E05')
    expect(waiting()).toEqual([LABELS.mc, LABELS.neg, LABELS.how])
    expect(container.querySelector('[data-testid="body-mc"]')).toBeNull()
    expect(container.querySelector('[data-testid="body-neg"]')).toBeNull()
    expect(container.querySelector('[data-testid="body-how"]')).toBeNull()
  })

  it('?e= 的格式不合法（parseDeepLink 之外的值由頁面丟掉，focusEid 為 null）：不強制任何區塊', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/verification?e=nonsense']}>
        <MonteCarloLab />
        <ErrataBrowser focusEid={null} />
      </MemoryRouter>,
    )
    expect(waiting()).toEqual([LABELS.mc, LABELS.errata])
    expect(container.querySelectorAll('[data-testid^="body-"]')).toHaveLength(0)
  })

  it('?t=T05：目標在首屏的驗收表，不強制任何區塊（不為它下載 §V.3–§V.6）', () => {
    const { container } = renderBlocks('/verification?t=T05')
    expect(waiting()).toEqual([LABELS.mc, LABELS.neg, LABELS.how, LABELS.errata])
    expect(container.querySelectorAll('[data-testid^="body-"]')).toHaveLength(0)
  })

  it('?f=F-VF.4（公式）或 ?a=（頁內錨點）：不知道目標在哪個區塊，四個區塊全部立刻掛載', async () => {
    for (const url of ['/verification?f=F-VF.4', '/verification?a=handcalc-HC-VF.1']) {
      const { findByTestId, unmount } = renderBlocks(url)
      for (const id of ['body-mc', 'body-neg', 'body-how', 'body-errata']) await findByTestId(id)
      expect(waiting(), url).toEqual([])
      unmount()
    }
  })

  it('等捲動的區塊：占位區相交之後才掛載（不論其他區塊）', async () => {
    const { container, findByTestId } = renderBlocks('/verification')
    const gate = Array.from(container.querySelectorAll('[data-lazy-gate]')).find((el) => el.getAttribute('data-lazy-gate') === LABELS.neg)!
    const io = FakeIO.instances.find((i) => i.observed.includes(gate))!
    act(() => io.fire(gate))
    await findByTestId('body-neg')
    await waitFor(() => expect(waiting()).toEqual([LABELS.mc, LABELS.how, LABELS.errata]))
  })
})
