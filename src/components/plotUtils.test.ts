import type { Data } from 'plotly.js-dist-min'
import { buildExportLayout, buildThemedLayout, filterLogData, mergeDeep, tracesToColumns } from './plotUtils'
import type { ThemeTokens } from './theme'

const tokens: ThemeTokens = {
  theme: 'dark',
  text: '#e6ebf1',
  textMuted: '#a3aebb',
  textFaint: '#75818f',
  border: '#2c3744',
  borderStrong: '#3d4a59',
  surface: '#161d25',
  surface2: '#1d2630',
  accent: '#6aa8ec',
  danger: '#f2837a',
  fontSans: 'sans-serif',
  fontMono: 'monospace',
  series: ['#6aa8ec', '#f07a8a', '#5cc98b', '#f0b44c', '#b48cec', '#6fc4dc'],
}

describe('filterLogData', () => {
  it('不使用 log 軸時原樣回傳', () => {
    const data: Data[] = [{ x: [0, 1], y: [-1, 2] }]
    const r = filterLogData(data, false, false)
    expect(r.dropped).toBe(0)
    expect(r.data[0]).toBe(data[0])
  })

  it('yLog：丟棄 y ≤ 0 的點並同步過濾 x 與逐點欄位', () => {
    const data: Data[] = [
      { x: [1, 2, 3, 4], y: [1e-3, 0, -2, 5], text: ['a', 'b', 'c', 'd'], marker: { color: ['r', 'g', 'b', 'k'] } },
    ]
    const r = filterLogData(data, false, true)
    expect(r.dropped).toBe(2)
    const t = r.data[0] as { x: number[]; y: number[]; text: string[]; marker: { color: string[] } }
    expect(t.x).toEqual([1, 4])
    expect(t.y).toEqual([1e-3, 5])
    expect(t.text).toEqual(['a', 'd'])
    expect(t.marker.color).toEqual(['r', 'k'])
    // 原始資料不被修改
    expect((data[0] as { y: number[] }).y).toEqual([1e-3, 0, -2, 5])
  })

  it('xLog：只有 y 的 trace 會補上隱含 x，index 0（x = 0）被丟棄（例如 PSD 的 DC bin）', () => {
    const r = filterLogData([{ y: new Float64Array([9, 8, 7]) }], true, false)
    expect(r.dropped).toBe(1)
    const t = r.data[0] as { x: number[]; y: Float64Array }
    expect(t.x).toEqual([1, 2])
    expect(t.y).toBeInstanceOf(Float64Array)
    expect(Array.from(t.y)).toEqual([8, 7])
  })

  it('typed array、-0、NaN（保留為斷點）與跨 trace 計數', () => {
    const r = filterLogData(
      [
        { x: new Float64Array([0, 1, 10, 100]), y: [1, 2, NaN, 4] },
        { x: [-0, 5], y: [1, 1] },
        { type: 'heatmap', z: [[1, -1]] } as Data,
      ],
      true,
      true,
    )
    expect(r.dropped).toBe(2)
    expect(Array.from((r.data[0] as { x: Float64Array }).x)).toEqual([1, 10, 100])
    expect((r.data[0] as { y: number[] }).y).toEqual([2, NaN, 4])
    expect((r.data[1] as { x: number[] }).x).toEqual([5])
    expect((r.data[2] as { type: string }).type).toBe('heatmap')
  })
})

describe('buildThemedLayout', () => {
  it('透明背景、主題文字色、series colorway', () => {
    const l = buildThemedLayout(tokens, { height: 300 }) as Record<string, unknown>
    expect(l.paper_bgcolor).toBe('rgba(0,0,0,0)')
    expect(l.plot_bgcolor).toBe('rgba(0,0,0,0)')
    expect(l.colorway).toEqual(tokens.series)
    expect((l.font as { color: string }).color).toBe(tokens.text)
    expect((l.xaxis as { gridcolor: string }).gridcolor).toBe(tokens.border)
    expect(l.height).toBe(300)
  })

  it('使用者 layout 深層覆寫；字串標題轉成 { text } 並保留主題字色；xLog / yLog 強制 log 軸', () => {
    const l = buildThemedLayout(tokens, {
      height: 280,
      xLog: true,
      yLog: true,
      layout: { xaxis: { title: 'f (Hz)' as never, range: [0, 6] }, yaxis2: { overlaying: 'y' }, height: 999 },
    }) as Record<string, Record<string, unknown>>
    expect(l.xaxis.type).toBe('log')
    expect(l.yaxis.type).toBe('log')
    expect(l.xaxis.range).toEqual([0, 6])
    expect(l.xaxis.title).toEqual({ text: 'f (Hz)', font: { color: tokens.text } })
    expect(l.xaxis.gridcolor).toBe(tokens.border)
    expect(l.yaxis2.gridcolor).toBe(tokens.border)
    expect(l.yaxis2.overlaying).toBe('y')
    // height 以 prop 為準（placeholder 也用同一高度）
    expect(l.height as unknown).toBe(280)
  })

  it('圖例：預設貼在繪圖區上方；呼叫端只把 y 設成 ≤ 0（放到 x 軸下方）時錨點自動換成 top，自己指定 yanchor 則照用', () => {
    const legend = (layout?: Record<string, unknown>) => buildThemedLayout(tokens, { height: 300, layout }).legend as { y: number; yanchor: string; orientation: string }
    expect(legend()).toMatchObject({ orientation: 'h', y: 1.02, yanchor: 'bottom' })
    expect(legend({ legend: { y: -0.25 } })).toMatchObject({ orientation: 'h', y: -0.25, yanchor: 'top' })
    expect(legend({ legend: { y: -0.25, yanchor: 'middle' } }).yanchor).toBe('middle')
    expect(legend({ legend: { y: 1.1 } }).yanchor).toBe('bottom')
    expect(legend({ legend: { orientation: 'v' } })).toMatchObject({ orientation: 'v', y: 1.02, yanchor: 'bottom' })
  })

  it('buildExportLayout：不透明背景並把標題放進圖內', () => {
    const l = buildExportLayout({ margin: { t: 16 } }, tokens, 'PSD') as Record<string, unknown>
    expect(l.paper_bgcolor).toBe(tokens.surface)
    expect((l.title as { text: string }).text).toBe('PSD')
    expect((l.margin as { t: number }).t).toBe(50)
  })

  it('mergeDeep 不修改輸入，陣列直接取代', () => {
    const a = { p: { q: 1, r: [1, 2] } }
    const m = mergeDeep(a, { p: { r: [3] } })
    expect(m).toEqual({ p: { q: 1, r: [3] } })
    expect(a.p.r).toEqual([1, 2])
  })
})

describe('tracesToColumns', () => {
  it('每個 trace 產生「名稱 x / 名稱 y」欄，重複名稱加編號，只有 y 時補 x0 + i·dx', () => {
    const cols = tracesToColumns([
      { name: 'w_k', x: [0, 1], y: [1, 1.8] },
      { name: 'w_k', y: [3, 3], x0: 10, dx: 0.5 },
      { y: [7] },
      { type: 'heatmap', z: [[1]] } as Data,
    ])
    expect(Object.keys(cols)).toEqual(['w_k x', 'w_k y', 'w_k (2) x', 'w_k (2) y', 'trace3 x', 'trace3 y'])
    expect(cols['w_k (2) x']).toEqual([10, 10.5])
    expect(cols['trace3 x']).toEqual([0])
  })
})
