import { render, screen, waitFor } from '@testing-library/react'
import type { Data } from 'plotly.js-dist-min'
import { Plot } from './Plot'
import { createPlotRegistry, PlotRegistryProvider } from './plotRegistry'

const P = vi.hoisted(() => ({
  react: vi.fn(async () => undefined),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
  downloadImage: vi.fn(async () => ''),
  Plots: { resize: vi.fn() },
  Icons: { 'camera-retro': { width: 1, height: 1, path: 'M0 0' }, disk: { width: 1, height: 1, path: 'M0 0' } },
}))

vi.mock('plotly.js-dist-min', () => ({ default: P }))

beforeEach(() => {
  P.react.mockClear()
  P.purge.mockClear()
  P.toImage.mockClear()
})

type ReactCall = [HTMLElement, Data[], Record<string, unknown>, Record<string, unknown>]

describe('Plot', () => {
  it('載入前顯示固定高度的佔位，載入後呼叫 Plotly.react（主題 layout、透明背景、自訂 modebar）', async () => {
    const { container } = render(<Plot data={[{ x: [1, 2], y: [3, 4], name: 'w' }]} height={260} title="w_k" />)
    const frame = container.querySelector('.c-plot-frame') as HTMLElement
    expect(frame.style.height).toBe('260px')
    await waitFor(() => expect(P.react).toHaveBeenCalled())
    const [, data, layout, config] = P.react.mock.calls.at(-1) as unknown as ReactCall
    expect(data).toEqual([{ x: [1, 2], y: [3, 4], name: 'w' }])
    expect(layout.paper_bgcolor).toBe('rgba(0,0,0,0)')
    expect(layout.height).toBe(260)
    expect(Array.isArray(layout.colorway)).toBe(true)
    const buttons = (config.modeBarButtons as unknown[][]).flat()
    expect(buttons).toEqual(expect.arrayContaining(['zoom2d', 'pan2d', 'resetScale2d']))
    const names = buttons.filter((b): b is { name: string; title: string } => typeof b === 'object').map((b) => b.title)
    expect(names).toEqual(['下載 PNG', '下載 SVG', '下載 CSV'])
    expect(config.displaylogo).toBe(false)
    expect(screen.queryByText('圖表載入中…')).toBeNull()
  })

  it('log 軸略去 ≤0 的點並顯示數量', async () => {
    render(<Plot data={[{ x: [0, 1, 10, 100], y: [5, -1, 2, 3] }]} xLog yLog />)
    expect(screen.getByText('已略去 2 個 ≤0 的點（log 軸）')).toBeTruthy()
    await waitFor(() => expect(P.react).toHaveBeenCalled())
    const [, data, layout] = P.react.mock.calls.at(-1) as unknown as ReactCall
    expect(data[0]).toMatchObject({ x: [10, 100], y: [2, 3] })
    expect((layout.xaxis as { type: string }).type).toBe('log')
    expect((layout.yaxis as { type: string }).type).toBe('log')
  })

  it('卸載時 Plotly.purge', async () => {
    const { unmount } = render(<Plot data={[{ y: [1] }]} />)
    await waitFor(() => expect(P.react).toHaveBeenCalled())
    unmount()
    expect(P.purge).toHaveBeenCalledTimes(1)
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
