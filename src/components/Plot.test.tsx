import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Data } from 'plotly.js-cartesian-dist-min'
import { downloadText } from './download'
import { Plot, PLOT_NEAR_MARGIN, resetPlotlyPrefetchForTests } from './Plot'
import { createPlotRegistry, PlotRegistryProvider } from './plotRegistry'

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  relayout: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))

vi.mock('plotly.js-cartesian-dist-min', () => ({ default: P }))
vi.mock('./download', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./download')>()
  return { ...orig, downloadText: vi.fn() }
})

beforeEach(() => {
  P.react.mockClear()
  P.relayout.mockClear()
  P.purge.mockClear()
  P.toImage.mockClear()
  P.downloadImage.mockClear()
  vi.mocked(downloadText).mockClear()
})

type ReactCall = [HTMLElement, Data[], Record<string, unknown>, Record<string, unknown>]
type Button = { name: string; title: string; click: (gd: HTMLElement) => void }

describe('Plot', () => {
  it('載入前顯示固定高度的佔位（預設 360px），載入後呼叫 Plotly.react（主題 layout、透明背景、精簡 modebar）', async () => {
    const { container, rerender } = render(<Plot data={[{ x: [1, 2], y: [3, 4], name: 'w' }]} />)
    expect((container.querySelector('.c-plot-frame') as HTMLElement).style.height).toBe('360px')
    rerender(<Plot data={[{ x: [1, 2], y: [3, 4], name: 'w' }]} height={260} title="w_k" />)
    const frame = container.querySelector('.c-plot-frame') as HTMLElement
    expect(frame.style.height).toBe('260px')
    await waitFor(() => expect(P.react).toHaveBeenCalled())
    const [, data, layout, config] = P.react.mock.calls.at(-1) as unknown as ReactCall
    expect(data).toEqual([{ x: [1, 2], y: [3, 4], name: 'w' }])
    expect(layout.paper_bgcolor).toBe('rgba(0,0,0,0)')
    expect(layout.height).toBe(260)
    expect(Array.isArray(layout.colorway)).toBe(true)
    const groups = config.modeBarButtons as unknown[][]
    expect(groups[0]).toEqual(['zoom2d', 'pan2d', 'resetScale2d'])
    const names = groups.flat().filter((b): b is Button => typeof b === 'object').map((b) => b.title)
    expect(names).toEqual(['下載 PNG', '下載 SVG', '下載 CSV'])
    expect(config.displaylogo).toBe(false)
    expect(config.displayModeBar).toBe(true)
    expect(screen.queryByText('圖表載入中…')).toBeNull()
  })

  it('≤ 3 條 trace 時圖例放圖內；第 4 條起補 dash 循環', async () => {
    const two: Data[] = [{ y: [1], name: 'a' }, { y: [2], name: 'b' }]
    const { rerender } = render(<Plot data={two} />)
    await waitFor(() => expect(P.react).toHaveBeenCalled())
    let [, , layout] = P.react.mock.calls.at(-1) as unknown as ReactCall
    expect((layout.legend as { orientation: string }).orientation).toBe('v')

    const five: Data[] = Array.from({ length: 5 }, (_, i) => ({ y: [i], name: `t${i}` }))
    rerender(<Plot data={five} />)
    await waitFor(() => expect(P.react).toHaveBeenCalledTimes(2))
    const fiveCall = P.react.mock.calls.at(-1) as unknown as ReactCall
    layout = fiveCall[2]
    expect((layout.legend as { orientation: string }).orientation).toBe('h')
    expect(fiveCall[1].map((t) => (t as { line?: { dash?: string } }).line?.dash)).toEqual([undefined, undefined, undefined, 'dash', 'dot'])
    // showlegend: false 的輔助線不算進圖例條數
    const helper: Data[] = [{ y: [1], name: 'a' }, { y: [2], name: 'b' }, { y: [0], showlegend: false }, { y: [0], showlegend: false }]
    rerender(<Plot data={helper} />)
    await waitFor(() => expect(P.react).toHaveBeenCalledTimes(3))
    ;[, , layout] = P.react.mock.calls.at(-1) as unknown as ReactCall
    expect((layout.legend as { orientation: string }).orientation).toBe('v')
  })

  it('log 軸略去 ≤0 的點並顯示數量；跨 ≥ 1.7 個十進位只標 10 的整數次方、1–1.7 標 2 與 5、更窄交給 Plotly', async () => {
    const { rerender } = render(<Plot data={[{ x: [0, 1, 10, 100], y: [5, -1, 2, 3] }]} xLog yLog />)
    expect(screen.getByText('已略去 2 個 ≤0 的點（log 軸）')).toBeTruthy()
    await waitFor(() => expect(P.react).toHaveBeenCalled())
    let [, data, layout] = P.react.mock.calls.at(-1) as unknown as ReactCall
    expect(data[0]).toMatchObject({ x: [10, 100], y: [2, 3] })
    const ax = (l: Record<string, unknown>, k: 'xaxis' | 'yaxis') => l[k] as { type: string; dtick?: unknown; minor?: { showgrid: boolean } }
    expect(ax(layout, 'xaxis').type).toBe('log')
    // x 剩 10…100（1 個十進位）→ 'D2'；y 剩 2…3（0.18 個十進位）→ 不設 dtick
    expect(ax(layout, 'xaxis').dtick).toBe('D2')
    expect(ax(layout, 'yaxis').dtick).toBeUndefined()
    expect(ax(layout, 'yaxis').minor?.showgrid).toBe(true)
    rerender(<Plot data={[{ x: [0.01, 1, 100], y: [1e-3, 1, 1e3] }]} xLog yLog />)
    await waitFor(() => expect(P.react).toHaveBeenCalledTimes(2))
    ;[, data, layout] = P.react.mock.calls.at(-1) as unknown as ReactCall
    expect(ax(layout, 'xaxis').dtick).toBe(1)
    expect(ax(layout, 'yaxis').dtick).toBe(1)
    // 呼叫端自己設刻度 → 不動
    rerender(<Plot data={[{ x: [0.01, 1, 100], y: [1e-3, 1, 1e3] }]} xLog layout={{ xaxis: { tickvals: [0.01, 1] } }} />)
    await waitFor(() => expect(P.react).toHaveBeenCalledTimes(3))
    ;[, data, layout] = P.react.mock.calls.at(-1) as unknown as ReactCall
    expect(ax(layout, 'xaxis').dtick).toBe(1) // 主題預設仍在（Plotly 有 tickvals 時會用 tickvals）
  })

  it('heatmap 的 x 也算進 log 軸的十進位數：熱圖 + 一條直線（0 個十進位）仍只標 10 的整數次方；只在 layout 設 type:log 而沒給 xLog 時不管刻度', async () => {
    // case-sspll 的 sign map：heatmap x 跨 0.5…1999.5 MHz（3.6 個十進位），同圖只有「目前的 α」直線 x = [80, 80]
    const heat: Data[] = [
      { type: 'heatmap', x: [0.5, 5, 50, 500, 1999.5], y: ['GOS', 'PHOS'], z: [[1, -1, 0, 1, 1], [0, 0, 1, 1, -1]] } as Data,
      { x: [80, 80], y: ['GOS', 'PHOS'], mode: 'lines' } as Data,
    ]
    const ax = (l: Record<string, unknown>) => l.xaxis as { type?: string; dtick?: unknown; tickmode?: unknown }
    const { rerender } = render(<Plot data={heat} xLog />)
    await waitFor(() => expect(P.react).toHaveBeenCalled())
    let [, , layout] = P.react.mock.calls.at(-1) as unknown as ReactCall
    expect(ax(layout).type).toBe('log')
    expect(ax(layout).dtick).toBe(1) // 少了 heatmap 的 x 只剩直線的 0 個十進位 → 交給 Plotly，刻度會隨像素寬度變
    // 呼叫端只在 layout 設 type: 'log'（沒給 xLog）：Plot 不過濾也不管刻度（文件寫明的契約），dtick 交給 Plotly
    rerender(<Plot data={heat} layout={{ xaxis: { type: 'log' } }} />)
    await waitFor(() => expect(P.react).toHaveBeenCalledTimes(2))
    ;[, , layout] = P.react.mock.calls.at(-1) as unknown as ReactCall
    expect(ax(layout).type).toBe('log')
    expect(ax(layout).dtick).toBeUndefined()
  })

  it('縮放（plotly_relayout）時依目前範圍換 log 軸刻度；工具列位置：圖例在上方時移到繪圖區頂端', async () => {
    type Drawn = HTMLElement & { on?: (ev: string, cb: () => void) => void; _fullLayout?: unknown }
    const handlers: Record<string, () => void> = {}
    P.react.mockImplementation(async (...args: unknown[]) => {
      const gd = args[0] as Drawn
      gd.on = (ev, cb) => {
        handlers[ev] = cb
      }
      gd._fullLayout = { _size: { t: 72 }, xaxis: { type: 'log', range: [-2, 2], tickmode: 'linear', dtick: 1 }, yaxis: { type: 'linear' } }
      return undefined
    })
    try {
      const four: Data[] = Array.from({ length: 4 }, (_, i) => ({ x: [0.01, 100], y: [i, i], name: `t${i}` }))
      const { container, rerender } = render(<Plot data={four} xLog />)
      await waitFor(() => expect(P.react).toHaveBeenCalled())
      const gd = container.querySelector('.c-plot-gd') as Drawn
      await waitFor(() => expect(handlers.plotly_relayout).toBeTypeOf('function'))
      // 4 條 → 圖例在上方 → 工具列往下移到上邊界（含圖例）之下
      expect(gd.style.getPropertyValue('--c-plot-top')).toBe('72px')
      // 使用者的每次縮放都在新的 tick：Plot 自己那次 relayout 的 promise 已經結束
      const fire = async () => {
        handlers.plotly_relayout()
        await new Promise((r) => setTimeout(r, 0))
      }
      // 放大到 1.2 個十進位 → 改標 2、5
      ;(gd._fullLayout as { xaxis: { range: number[] } }).xaxis.range = [0, 1.2]
      await fire()
      expect(P.relayout).toHaveBeenLastCalledWith(gd, { 'xaxis.dtick': 'D2' })
      // Plotly 套用後 tickmode 仍 linear、dtick 'D2'：再觸發不會再呼叫
      Object.assign((gd._fullLayout as { xaxis: Record<string, unknown> }).xaxis, { dtick: 'D2' })
      P.relayout.mockClear()
      await fire()
      expect(P.relayout).not.toHaveBeenCalled()
      // 放大到半個十進位 → 交回 Plotly 自動（dtick 與 tickmode 一起清掉）
      ;(gd._fullLayout as { xaxis: { range: number[] } }).xaxis.range = [0, 0.5]
      await fire()
      expect(P.relayout).toHaveBeenLastCalledWith(gd, { 'xaxis.dtick': null, 'xaxis.tickmode': null })
      Object.assign((gd._fullLayout as { xaxis: Record<string, unknown> }).xaxis, { tickmode: 'auto', dtick: 0.2 })
      P.relayout.mockClear()
      await fire()
      expect(P.relayout).not.toHaveBeenCalled()
      // 自己的 relayout 觸發的 plotly_relayout 不再處理（即使狀態看起來還不一致也只排一次）
      Object.assign((gd._fullLayout as { xaxis: Record<string, unknown> }).xaxis, { tickmode: 'linear', dtick: 'L0.5' })
      let nestedCalls = -1
      P.relayout.mockImplementationOnce(async () => {
        handlers.plotly_relayout()
        nestedCalls = P.relayout.mock.calls.length
        return undefined
      })
      await fire()
      expect(nestedCalls).toBe(1)
      expect(P.relayout).toHaveBeenCalledTimes(1)
      P.relayout.mockClear()
      // 縮回全範圍 → 只標 10 的整數次方
      ;(gd._fullLayout as { xaxis: { range: number[] } }).xaxis.range = [-2, 2]
      await fire()
      expect(P.relayout).toHaveBeenLastCalledWith(gd, { 'xaxis.dtick': 1 })
      // 2 條、右上沒資料 → 圖例在內側 → 工具列回到紙面頂端
      rerender(<Plot data={[{ x: [0.01, 100], y: [1, 0], name: 'a' }, { x: [0.01, 100], y: [0.5, 0], name: 'b' }]} xLog />)
      await waitFor(() => expect(P.react).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(gd.style.getPropertyValue('--c-plot-top')).toBe('0px'))
      handlers.plotly_afterplot()
      expect(gd.style.getPropertyValue('--c-plot-top')).toBe('0px')
    } finally {
      P.react.mockReset()
      P.react.mockImplementation(async () => undefined)
    }
  })

  it('圖例角落依資料決定：上升曲線 → 左上；收斂到上緣的曲線加滿寬參考線 → 上方；下降曲線 → 右上', async () => {
    const rise: Data = { x: [0, 1, 2, 3], y: [0, 1, 2, 3], name: 'a' }
    const { rerender } = render(<Plot data={[rise]} />)
    await waitFor(() => expect(P.react).toHaveBeenCalled())
    const legend = () => (P.react.mock.calls.at(-1) as unknown as ReactCall)[2].legend as Record<string, unknown>
    expect(legend()).toMatchObject({ orientation: 'v', x: 0, xanchor: 'left', y: 1, yanchor: 'top' })
    rerender(<Plot data={[{ x: [0, 1, 2, 3], y: [0, 2, 2.9, 3], name: 'V' }, { x: [0, 3], y: [3, 3], name: 'σ²' }]} />)
    await waitFor(() => expect(P.react).toHaveBeenCalledTimes(2))
    expect(legend()).toMatchObject({ orientation: 'h', y: 1.02 })
    rerender(<Plot data={[{ x: [0, 1, 2, 3], y: [3, 2, 1, 0], name: 'a' }]} />)
    await waitFor(() => expect(P.react).toHaveBeenCalledTimes(3))
    expect(legend()).toMatchObject({ orientation: 'v', x: 1, xanchor: 'right' })
  })

  it('卸載時 Plotly.purge', async () => {
    const { unmount } = render(<Plot data={[{ y: [1] }]} />)
    await waitFor(() => expect(P.react).toHaveBeenCalled())
    unmount()
    expect(P.purge).toHaveBeenCalledTimes(1)
  })

  it('下載 PNG / SVG / CSV 按鈕：匯出 layout 不透明並含標題；CSV 用原始資料', async () => {
    render(<Plot data={[{ x: [1, 2], y: [3, 4], name: 'w_k' }]} title="收斂 $w_k$" csvName="conv" />)
    await waitFor(() => expect(P.react).toHaveBeenCalled())
    const [gd, , , config] = P.react.mock.calls.at(-1) as unknown as ReactCall
    const el = gd as HTMLElement & { data?: unknown; layout?: unknown }
    el.data = [{ x: [1, 2], y: [3, 4], name: 'w_k' }]
    el.layout = { margin: { t: 30 } }
    const buttons = (config.modeBarButtons as unknown[][]).flat().filter((b): b is Button => typeof b === 'object')
    buttons[0].click(gd)
    expect(P.downloadImage).toHaveBeenCalledWith(
      expect.objectContaining({ layout: expect.objectContaining({ paper_bgcolor: expect.any(String), title: expect.objectContaining({ text: '收斂 <i>w</i><sub><i>k</i></sub>' }) }) }),
      expect.objectContaining({ format: 'png', filename: 'conv', scale: 2 }),
    )
    buttons[1].click(gd)
    expect(P.downloadImage).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ format: 'svg', scale: 1 }))
    buttons[2].click(gd)
    expect(vi.mocked(downloadText)).toHaveBeenCalledWith('conv.csv', 'text/csv', 'w_k x,w_k y\n1,3\n2,4', { bom: true })
  })

  it('在 PlotRegistryProvider 內註冊，captureAll 以 Plotly.toImage 取得 PNG', async () => {
    const registry = createPlotRegistry()
    render(
      <PlotRegistryProvider registry={registry}>
        <Plot data={[{ y: [1, 2] }]} title="收斂曲線" />
      </PlotRegistryProvider>,
    )
    await waitFor(() => expect(P.react).toHaveBeenCalled())
    expect(registry.size()).toBe(1)
    // jsdom 中 Plotly.react 是 mock，不會在 gd 上設定 data → 模擬已繪製
    const gd = document.querySelector('.c-plot-gd') as HTMLElement & { data?: unknown; layout?: unknown }
    gd.data = [{ y: [1, 2] }]
    gd.layout = {}
    const { plots, failed } = await registry.captureAll()
    expect(failed).toEqual([])
    expect(plots).toEqual([{ title: '收斂曲線', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }])
    expect(P.toImage).toHaveBeenCalledWith(
      expect.objectContaining({ layout: expect.objectContaining({ title: expect.objectContaining({ text: '收斂曲線' }) }) }),
      expect.objectContaining({ format: 'png' }),
    )
  })
})

/** 假的 IntersectionObserver：記錄 callback 與選項，由測試決定何時「進入可視範圍」 */
class FakeIO {
  static instances: FakeIO[] = []
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
  takeRecords = () => []
  constructor(
    public cb: (entries: { isIntersecting: boolean }[]) => void,
    public opts?: IntersectionObserverInit,
  ) {
    FakeIO.instances.push(this)
  }
}

describe('Plot：接近可視範圍才載入與繪製（有 IntersectionObserver 的瀏覽器）', () => {
  const idle = vi.fn<(cb: () => void) => number>(() => 1)
  beforeEach(() => {
    FakeIO.instances = []
    idle.mockClear()
    vi.stubGlobal('IntersectionObserver', FakeIO)
    vi.stubGlobal('requestIdleCallback', idle)
    resetPlotlyPrefetchForTests()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('還沒接近時只有佔位、不呼叫 Plotly.react；進入 700px 範圍才繪製；閒置時預取 Plotly', async () => {
    render(<Plot data={[{ y: [1] }]} />)
    expect(screen.getByText('圖表載入中…')).toBeTruthy()
    expect(FakeIO.instances).toHaveLength(1)
    const io = FakeIO.instances[0]
    expect(io.opts?.rootMargin).toBe(`${PLOT_NEAR_MARGIN}px 0px`)
    expect(io.observe).toHaveBeenCalledWith(document.querySelector('figure.c-plot'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(P.react).not.toHaveBeenCalled()
    // 首屏之後排程預取（只排一次）
    expect(idle).toHaveBeenCalledTimes(1)
    act(() => io.cb([{ isIntersecting: false }]))
    expect(P.react).not.toHaveBeenCalled()
    act(() => io.cb([{ isIntersecting: true }]))
    await waitFor(() => expect(P.react).toHaveBeenCalledTimes(1))
    expect(io.disconnect).toHaveBeenCalled()
    expect(screen.queryByText('圖表載入中…')).toBeNull()
  })

  it('列印（beforeprint）時強制繪製', async () => {
    render(<Plot data={[{ y: [1] }]} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(P.react).not.toHaveBeenCalled()
    act(() => {
      window.dispatchEvent(new Event('beforeprint'))
    })
    await waitFor(() => expect(P.react).toHaveBeenCalledTimes(1))
  })

  it('HTML 報告擷圖（registry.capture）會強制載入並等第一次畫完', async () => {
    P.react.mockImplementationOnce(async (...args: unknown[]) => {
      const [gd, data, layout] = args as [HTMLElement & { data?: unknown; layout?: unknown }, unknown, unknown]
      gd.data = data
      gd.layout = layout
      return undefined
    })
    const registry = createPlotRegistry()
    render(
      <PlotRegistryProvider registry={registry}>
        <Plot data={[{ y: [1, 2] }]} title="還沒捲到的圖" />
      </PlotRegistryProvider>,
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(P.react).not.toHaveBeenCalled()
    // capture 會 setNear(true) 再等第一次畫完：不能包在 act 裡（act 會等 capture 結束才 flush render）
    const pending = registry.captureAll()
    await waitFor(() => expect(P.react).toHaveBeenCalledTimes(1))
    const result = await pending
    expect(result.failed).toEqual([])
    expect(result.plots.map((p) => p.title)).toEqual(['還沒捲到的圖'])
  })
})

const openDetails = (d: HTMLDetailsElement) => {
  d.open = true
  fireEvent(d, new Event('toggle'))
}
/** 摘掉 KaTeX 的 MathML 複本與 annotation 後的顯示文字 */
const shown = (el: Element) => {
  const c = el.cloneNode(true) as Element
  c.querySelectorAll('.katex-mathml, annotation').forEach((e) => e.remove())
  return (c.textContent ?? '').replace(/\s+/g, ' ').trim()
}
const tex = (el: Element) => [...el.querySelectorAll('annotation')].map((a) => a.textContent)

describe('Plot：看數據（文字替代）', () => {
  it('預設收合：figure 的 aria-describedby 指到 details；收合時只多 <details><summary>，沒有表格', async () => {
    const { container } = render(<Plot data={[{ x: [1, 2], y: [3, 4], name: 'w' }, { y: [1, 2, 3], name: 'v' }]} title="收斂" />)
    await waitFor(() => expect(P.react).toHaveBeenCalled())
    const figure = container.querySelector('figure.c-plot')!
    const details = container.querySelector('details.c-plot-alt') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(figure.getAttribute('aria-describedby')).toBe(details.id)
    expect(details.querySelector('summary')?.textContent).toBe('看數據（2 條曲線）')
    expect(details.querySelectorAll('*')).toHaveLength(1)
    expect(container.querySelector('table')).toBeNull()
    expect(figure.lastElementChild).toBe(details)
  })

  it('沒有資料的圖不加看數據', async () => {
    const { container } = render(<Plot data={[]} />)
    await waitFor(() => expect(P.react).toHaveBeenCalled())
    expect(container.querySelector('details')).toBeNull()
    expect(container.querySelector('figure')?.hasAttribute('aria-describedby')).toBe(false)
  })

  it('展開後每條 trace 一列：名稱、點數、x 範圍、y 的最小／最大／首值／末值；數字照 texNum（4 位有效數字，極大極小用 a×10^b）', async () => {
    const data: Data[] = [
      { x: [0, 0.5, 1, 2], y: [3.14159, -2, 7.5, 0.00001234], name: '曲線 $w_k$' },
      { y: [10, 20, 30], x0: 5, dx: 2, name: '只有 y' },
      { x: ['甲', '乙', '丙'], y: [1, 2e7, 3], type: 'bar' },
    ]
    const { container } = render(<Plot data={data} layout={{ xaxis: { title: { text: '時間 $t$' } }, yaxis: { title: { text: '誤差' } } }} />)
    await waitFor(() => expect(P.react).toHaveBeenCalled())
    openDetails(container.querySelector('details') as HTMLDetailsElement)
    const table = container.querySelector('table')!
    expect(table.querySelector('caption')?.textContent).toBe('圖中各條曲線的數據摘要')
    expect([...table.querySelectorAll('thead th')].map((h) => h.getAttribute('scope'))).toEqual(Array(7).fill('col'))
    const rows = [...table.querySelectorAll('tbody tr')]
    expect(rows).toHaveLength(3)
    expect(rows[0].querySelector('th[scope="row"]')?.textContent).toContain('曲線')
    expect(rows[0].querySelector('th .katex')).toBeTruthy() // 名稱裡的 $w_k$ 用 KaTeX
    const cells = (r: Element) => [...r.querySelectorAll('td')]
    // 第 1 條：4 點；x 0…2；y 最小 −2、最大 7.5、首值 3.142（4 位有效數字）、末值 1.234×10^-5
    let c = cells(rows[0])
    expect(c[0].textContent).toBe('4')
    expect(shown(c[1])).toBe('0 到 2')
    expect(shown(c[2])).toBe('−2')
    expect(shown(c[3])).toBe('7.5')
    expect(shown(c[4])).toBe('3.142')
    expect(tex(c[5])).toEqual(['1.234\\times10^{-5}'])
    // 第 2 條沒有 x：x0 + i·dx = 5, 7, 9
    c = cells(rows[1])
    expect(c[0].textContent).toBe('3')
    expect(shown(c[1])).toBe('5 到 9')
    expect([shown(c[2]), shown(c[3]), shown(c[4]), shown(c[5])]).toEqual(['10', '30', '10', '30'])
    // 第 3 條類別軸：列出第一個與最後一個類別；y 的最大 2×10^7
    c = cells(rows[2])
    expect(shown(c[1])).toBe('甲 … 丙')
    expect(tex(c[3])).toEqual(['2\\times10^{7}'])
    // 軸標題（含 LaTeX）
    const axes = container.querySelector('.c-figalt-body > ul')!
    expect(axes.querySelectorAll('li')).toHaveLength(2)
    expect(shown(axes)).toContain('時間')
    expect(axes.querySelector('.katex')).toBeTruthy()
  })

  it('log 軸：表格看實際畫出來的點（≤0 已略去），並註明略去幾個；對數軸標在軸說明裡', async () => {
    const { container } = render(<Plot data={[{ x: [0, 1, 10, 1000], y: [5, 1e-3, -1, 1e-7], name: 'PSD' }]} xLog yLog />)
    await waitFor(() => expect(P.react).toHaveBeenCalled())
    openDetails(container.querySelector('details') as HTMLDetailsElement)
    const row = container.querySelector('tbody tr')!
    const c = [...row.querySelectorAll('td')]
    // x = [0,1,10,1000] 與 y = [5,1e-3,-1,1e-7]：第 1、3 點各有一個 ≤0 → 剩 [1, 1000]／[1e-3, 1e-7]
    expect(c[0].textContent).toBe('2（另略去 2 個 ≤0 的點）')
    expect(shown(c[1])).toBe('1 到 1000')
    expect(tex(c[2])).toEqual(['10^{-7}'])
    expect(shown(c[3])).toBe('0.001')
    expect(container.querySelector('.c-figalt-body')?.textContent).toContain('（對數軸）')
    expect(container.querySelector('.c-figalt-body')?.textContent).toContain('下載 CSV 仍是完整的原始資料')
  })

  it('heatmap 與 histogram 有說明；沒有名稱的曲線叫「曲線 N」', async () => {
    const { container } = render(
      <Plot
        data={[
          { type: 'heatmap', x: [1, 2, 3], y: ['a', 'b'], z: [[1, -1, 0], [0, 0.5, 2]] } as Data,
          { type: 'histogram', x: [1, 2, 2, 3, 3, 3] } as Data,
        ]}
      />,
    )
    await waitFor(() => expect(P.react).toHaveBeenCalled())
    openDetails(container.querySelector('details') as HTMLDetailsElement)
    const rows = [...container.querySelectorAll('tbody tr')]
    expect(rows[0].querySelector('th')?.textContent).toContain('曲線 1')
    expect(rows[0].querySelector('th')?.textContent).toContain('熱圖，2 列 × 3 欄')
    expect(rows[0].querySelector('td')?.textContent).toBe('6')
    expect([...rows[0].querySelectorAll('td')].slice(2, 6).map(shown)).toEqual(['−1', '2', '1', '2'])
    expect(rows[1].querySelector('th')?.textContent).toContain('直方圖')
    expect(rows[1].querySelector('td')?.textContent).toBe('6')
  })
})

describe('Plot：鍵盤可達的工具列（重設視圖、下載 PNG、下載 CSV）', () => {
  it('Plotly 畫好才出現；一個 role=toolbar，三個按鈕，名稱沒有 $', async () => {
    const { container } = render(<Plot data={[{ x: [1, 2], y: [3, 4], name: 'w' }]} title="收斂 $w_k$" />)
    await waitFor(() => expect(container.querySelector('.c-plot-kbar')).toBeTruthy())
    const bar = screen.getByRole('toolbar', { name: '圖表工具' })
    expect(within(bar).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['重設視圖', '下載 PNG', '下載 CSV'])
    expect(bar.closest('.c-plot-frame')).toBeTruthy()
    // 一個 Tab 停靠點（roving tabindex）
    expect(within(bar).getAllByRole('button').map((b) => b.tabIndex)).toEqual([0, -1, -1])
  })

  it('載入前（還沒接近可視範圍）沒有工具列', () => {
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} takeRecords() { return [] } })
    try {
      const { container } = render(<Plot data={[{ y: [1] }]} />)
      expect(container.querySelector('.c-plot-kbar')).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('←→／Home／End 在按鈕間移動（循環），Tab 停靠點跟著走', async () => {
    render(<Plot data={[{ y: [1, 2] }]} />)
    const bar = await screen.findByRole('toolbar')
    const [reset, png, csv] = within(bar).getAllByRole('button')
    reset.focus()
    fireEvent.keyDown(bar, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(png)
    expect([reset.tabIndex, png.tabIndex, csv.tabIndex]).toEqual([-1, 0, -1])
    fireEvent.keyDown(bar, { key: 'End' })
    expect(document.activeElement).toBe(csv)
    fireEvent.keyDown(bar, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(reset)
    fireEvent.keyDown(bar, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(csv)
    fireEvent.keyDown(bar, { key: 'Home' })
    expect(document.activeElement).toBe(reset)
    fireEvent.keyDown(bar, { key: 'a' })
    expect(document.activeElement).toBe(reset)
  })

  it('重設視圖 = Plotly.relayout：沒有指定範圍的軸交回 autorange，layout 指定了範圍的軸回到那個範圍', async () => {
    const { rerender } = render(<Plot data={[{ x: [1, 2], y: [3, 4] }]} />)
    fireEvent.click(await screen.findByRole('button', { name: '重設視圖' }))
    const gd = document.querySelector('.c-plot-gd')
    expect(P.relayout).toHaveBeenLastCalledWith(gd, { 'xaxis.autorange': true, 'yaxis.autorange': true })
    rerender(<Plot data={[{ x: [1, 2], y: [3, 4] }]} layout={{ yaxis: { range: [-1, 1] } }} />)
    await waitFor(() => expect(P.react).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: '重設視圖' }))
    expect(P.relayout).toHaveBeenLastCalledWith(gd, { 'xaxis.autorange': true, 'yaxis.range': [-1, 1] })
  })

  it('下載 PNG 走 Plotly.downloadImage（和 modebar 同一組設定）；下載 CSV 用原始資料與 csvName', async () => {
    render(<Plot data={[{ x: [1, 2], y: [3, 4], name: 'w_k' }]} title="收斂" csvName="conv" />)
    const png = await screen.findByRole('button', { name: '下載 PNG' })
    const gd = document.querySelector('.c-plot-gd') as HTMLElement & { data?: unknown; layout?: unknown }
    gd.data = [{ x: [1, 2], y: [3, 4], name: 'w_k' }]
    gd.layout = { margin: { t: 30 } }
    fireEvent.click(png)
    expect(P.downloadImage).toHaveBeenCalledWith(
      expect.objectContaining({ layout: expect.objectContaining({ paper_bgcolor: expect.any(String) }) }),
      expect.objectContaining({ format: 'png', filename: 'conv', scale: 2 }),
    )
    fireEvent.click(screen.getByRole('button', { name: '下載 CSV' }))
    expect(vi.mocked(downloadText)).toHaveBeenCalledWith('conv.csv', 'text/csv', 'w_k x,w_k y\n1,3\n2,4', { bom: true })
  })

  it('原本的 Plotly modebar（含下載 CSV）保留', async () => {
    render(<Plot data={[{ y: [1] }]} csvName="x" />)
    await waitFor(() => expect(P.react).toHaveBeenCalled())
    const config = (P.react.mock.calls.at(-1) as unknown as ReactCall)[3]
    const titles = (config.modeBarButtons as unknown[][]).flat().filter((b): b is Button => typeof b === 'object').map((b) => b.title)
    expect(titles).toEqual(['下載 PNG', '下載 SVG', '下載 CSV'])
  })
})
