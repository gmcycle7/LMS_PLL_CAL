import { act, render, screen, waitFor } from '@testing-library/react'
import type { Data } from 'plotly.js-dist-min'
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

vi.mock('plotly.js-dist-min', () => ({ default: P }))
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
