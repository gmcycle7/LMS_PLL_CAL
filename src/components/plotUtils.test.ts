import type { Data } from 'plotly.js-cartesian-dist-min'
import {
  applyDashCycle,
  buildExportLayout,
  buildThemedLayout,
  DASH_CYCLE,
  estimateLegendWidth,
  filterLogData,
  LEGEND_INSIDE_MAX,
  legendPlacement,
  LOG_POWER_TICKS_MIN_DECADES,
  logAxisDtick,
  logSpanDecades,
  mergeDeep,
  pickLegendCorner,
  tracesToColumns,
  withAlpha,
} from './plotUtils'
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

  it('圖例位置：≤ 3 條放繪圖區右上角內側（半透明底）、> 3 條放上方；呼叫端自己定位時一律從「上方」為底', () => {
    const legend = (opts: Parameters<typeof buildThemedLayout>[1]) => buildThemedLayout(tokens, opts).legend as Record<string, unknown>
    expect(LEGEND_INSIDE_MAX).toBe(3)
    expect(legend({ height: 300, legendEntries: 2 })).toMatchObject({ orientation: 'v', x: 1, xanchor: 'right', y: 1, yanchor: 'top', bgcolor: 'rgba(22,29,37,0.8)' })
    expect(legend({ height: 300, legendEntries: 3 }).orientation).toBe('v')
    expect(legend({ height: 300, legendEntries: 4 })).toMatchObject({ orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom' })
    // 沒給 trace 數（例如直接呼叫）視為很多 → 上方
    expect(legend({ height: 300 }).orientation).toBe('h')
    // 呼叫端只設 y ≤ 0：底是上方水平圖例，錨點換成 top（R02 的修正仍然有效）
    expect(legend({ height: 300, legendEntries: 2, layout: { legend: { y: -0.25 } } })).toMatchObject({ orientation: 'h', x: 0, y: -0.25, yanchor: 'top' })
    expect(legend({ height: 300, legendEntries: 2, layout: { legend: { orientation: 'h' } } })).toMatchObject({ orientation: 'h', x: 0, y: 1.02 })
    // 只改字型等非位置屬性 → 仍放內側
    expect(legend({ height: 300, legendEntries: 2, layout: { legend: { font: { size: 10 } } } })).toMatchObject({ orientation: 'v', x: 1, font: { size: 10, color: tokens.text } })
  })

  it('圖例角落：右上有資料 → 左上；兩邊都有 → 上方；呼叫端定位 → 上方（legendPlacement）', () => {
    const legend = (opts: Parameters<typeof buildThemedLayout>[1]) => buildThemedLayout(tokens, opts).legend as Record<string, unknown>
    expect(legend({ height: 300, legendEntries: 2, legendCorner: 'top-left' })).toMatchObject({ orientation: 'v', x: 0, xanchor: 'left', y: 1, yanchor: 'top' })
    expect(legend({ height: 300, legendEntries: 2, legendCorner: null })).toMatchObject({ orientation: 'h', y: 1.02, yanchor: 'bottom' })
    expect(legendPlacement({ legendEntries: 2 })).toBe('top-right')
    expect(legendPlacement({ legendEntries: 2, legendCorner: 'top-left' })).toBe('top-left')
    expect(legendPlacement({ legendEntries: 2, legendCorner: null })).toBe('above')
    expect(legendPlacement({ legendEntries: 4, legendCorner: 'top-right' })).toBe('above')
    expect(legendPlacement({ legendEntries: 2, layout: { legend: { x: 0.5 } } })).toBe('above')
    expect(legendPlacement({})).toBe('above')
  })

  it('log 軸：寬的軸只標 10 的整數次方，1–1.7 個十進位標 2、5，不到一個十進位交給 Plotly；次刻度留格線不印數字；呼叫端可覆寫', () => {
    expect(LOG_POWER_TICKS_MIN_DECADES).toBe(1.7)
    expect(logAxisDtick(undefined)).toBe(1)
    expect(logAxisDtick(4)).toBe(1)
    expect(logAxisDtick(11.9)).toBe(1)
    expect(logAxisDtick(12)).toBe(2)
    expect(logAxisDtick(16)).toBe(2)
    expect(logAxisDtick(1.7)).toBe(1)
    expect(logAxisDtick(1.49)).toBe('D2')
    expect(logAxisDtick(1)).toBe('D2')
    expect(logAxisDtick(0.46)).toBeUndefined()
    const narrow = buildThemedLayout(tokens, { height: 300, yLog: true, yLogDecades: 0.46 }) as Record<string, Record<string, unknown>>
    expect(narrow.yaxis.dtick).toBeUndefined()
    expect(narrow.yaxis.minor).toMatchObject({ showgrid: true, dtick: 'D1' })
    const mid = buildThemedLayout(tokens, { height: 300, yLog: true, yLogDecades: 1.3 }) as Record<string, Record<string, unknown>>
    expect(mid.yaxis.dtick).toBe('D2')
    const l = buildThemedLayout(tokens, { height: 300, xLog: true }) as Record<string, Record<string, unknown>>
    expect(l.xaxis.dtick).toBe(1)
    expect(l.xaxis.tickmode).toBeUndefined() // 不鎖 tickmode：呼叫端給 tickvals 時 Plotly 才會用它
    expect(l.xaxis.minor).toEqual({ showgrid: true, gridcolor: 'rgba(44,55,68,0.5)', ticks: '', dtick: 'D1' })
    expect(l.xaxis.exponentformat).toBe('power')
    expect(l.yaxis.dtick).toBeUndefined()
    expect(l.yaxis.minor).toBeUndefined()
    const u = buildThemedLayout(tokens, { height: 300, yLog: true, layout: { yaxis: { dtick: 'D2' as never } } }) as Record<string, Record<string, unknown>>
    expect(u.yaxis.dtick).toBe('D2')
    expect(u.yaxis.type).toBe('log')
  })

  it('工具列底色為半透明 surface', () => {
    const l = buildThemedLayout(tokens, { height: 300 }) as Record<string, Record<string, unknown>>
    expect(l.modebar.bgcolor).toBe('rgba(22,29,37,0.85)')
    expect(l.margin).toEqual({ l: 56, r: 16, t: 30, b: 44, pad: 0 })
  })

  it('withAlpha：#rrggbb / #rgb → rgba；其他字串原樣', () => {
    expect(withAlpha('#ffffff', 0.8)).toBe('rgba(255,255,255,0.8)')
    expect(withAlpha('#abc', 0.5)).toBe('rgba(170,187,204,0.5)')
    expect(withAlpha('rgb(1, 2, 3)', 0.5)).toBe('rgb(1, 2, 3)')
    expect(withAlpha('', 0.5)).toBe('')
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

describe('logSpanDecades', () => {
  it('只看主軸上 > 0 的有限值；只有 y 的 trace 補隱含 x；呼叫端 range（log10 單位）優先', () => {
    const data: Data[] = [
      { x: [0.01, 1, 100], y: [1, 2, 3] },
      { x: [1e-3, NaN, 1e4], y: [0, -1, 5], xaxis: 'x2' } as Data,
      { y: [1, 10], type: 'bar' },
    ]
    expect(logSpanDecades(data, 'x')).toBeCloseTo(4, 6)
    expect(logSpanDecades(data, 'y')).toBeCloseTo(1, 6)
    expect(logSpanDecades(data, 'x', [-2, 3])).toBe(5)
    expect(logSpanDecades([{ y: [1, 2] }], 'x')).toBe(0) // 隱含 x = 0, 1 → 只有 1 > 0
    expect(logSpanDecades([{ y: [-1, 0] }], 'y')).toBeUndefined()
    expect(logSpanDecades([{ type: 'heatmap', z: [[1]] } as Data], 'x')).toBeUndefined()
  })

  it('heatmap / histogram 自己的座標陣列也算進範圍（只看明確給的 x／y；類別字串不算）', () => {
    // sign map 熱圖：x 跨 0.3…3000 MHz（4 個十進位），同圖只有一條「目前的 α」直線（0 個十進位）
    const heat = [
      { type: 'heatmap', x: [0.3, 3, 30, 300, 3000], y: ['GOS', 'PHOS'], z: [[1, -1, 0, 1, 1], [0, 0, 1, 1, -1]] } as Data,
      { x: [80, 80], y: ['GOS', 'PHOS'], mode: 'lines' } as Data,
    ]
    expect(logSpanDecades(heat, 'x')).toBeCloseTo(4, 6)
    expect(logSpanDecades([heat[1]], 'x')).toBe(0)
    expect(logSpanDecades(heat, 'y')).toBeUndefined()
    // histogram：x 是樣本，沒有 y；≤0 與非數值略過；沒有 x 時不補隱含座標
    expect(logSpanDecades([{ type: 'histogram', x: [0, 1, 'a', 1000] } as Data], 'x')).toBeCloseTo(3, 6)
    expect(logSpanDecades([{ type: 'histogram', y: [1, 10] } as Data], 'x')).toBeUndefined()
    expect(logSpanDecades([{ type: 'histogram', y: [1, 10] } as Data], 'y')).toBeCloseTo(1, 6)
  })
})

describe('pickLegendCorner', () => {
  const rise: Data = { x: [0, 1, 2, 3, 4], y: [0, 1, 2, 3, 4], name: 'a' }
  const fall: Data = { x: [0, 1, 2, 3, 4], y: [4, 3, 2, 1, 0], name: 'b' }
  it('右上角沒資料 → 右上；右上有資料 → 左上；兩邊都有 → null', () => {
    expect(pickLegendCorner([fall])).toBe('top-right')
    expect(pickLegendCorner([rise])).toBe('top-left')
    expect(pickLegendCorner([rise, fall])).toBeNull()
    // 收斂到上緣的曲線加滿寬的水平參考線（σ² 虛線）→ 兩邊都有
    expect(pickLegendCorner([{ x: [0, 1, 2, 3, 4], y: [0, 2, 3, 3.5, 3.9] }, { x: [0, 4], y: [4, 4] }])).toBeNull()
    // 峰在中間、兩個上方角落都空 → 右上
    expect(pickLegendCorner([{ x: [0, 4], y: [0, 0] }, { x: [0, 1, 2, 3, 4], y: [0, 1, 2, 1, 0] }])).toBe('top-right')
    expect(pickLegendCorner([])).toBe('top-right')
    // 退化範圍（單點、或全部同一個 y）：Plotly 會把範圍撐開，資料在正中間 → 右上
    expect(pickLegendCorner([{ y: [1], name: 'a' }, { y: [2], name: 'b' }])).toBe('top-right')
    expect(pickLegendCorner([{ x: [0, 1, 2], y: [3, 3, 3] }])).toBe('top-right')
  })
  it('log 軸用 log10 正規化；呼叫端 range 優先；heatmap／次座標軸 → null；圖例太寬 → null', () => {
    // 10⁻²…10² 上升到右上角：線性看會以為左邊都空，log 看右上有資料
    const bode: Data = { x: [0.01, 0.1, 1, 10, 100], y: [1e-4, 1e-3, 1e-2, 0.1, 1], name: 'H' }
    expect(pickLegendCorner([bode], { xLog: true, yLog: true })).toBe('top-left')
    // 呼叫端把 y 範圍拉到 10³：資料就不在上緣了
    expect(pickLegendCorner([bode], { xLog: true, yLog: true, layout: { yaxis: { range: [-4, 3] } } })).toBe('top-right')
    expect(pickLegendCorner([{ type: 'heatmap', z: [[1]] } as Data])).toBeNull()
    expect(pickLegendCorner([{ ...fall, yaxis: 'y2' } as Data])).toBeNull()
    expect(pickLegendCorner([{ ...fall, name: '一條很長很長很長的圖例名稱' }], { plotWidth: 300 })).toBeNull()
    expect(pickLegendCorner([{ ...fall, name: 'short' }], { plotWidth: 300 })).toBe('top-right')
    expect(estimateLegendWidth(['ab', '中文'])).toBe(24 + 46)
    expect(estimateLegendWidth(['<i>w</i>'])).toBe(6.5 + 46)
    // TeX 標記不算寬度：$H(e^{j\Omega})$ → H(ejx) 5 個字
    expect(estimateLegendWidth([String.raw`$H(e^{j\Omega})$`])).toBe(6 * 6.5 + 46)
  })
  it('類別軸（x 是字串標籤）：以出現順序當座標，最右邊的長條最高時圖例不放右上', () => {
    // case-sspll「目前 α 的 κ_m」：m=1…m=7 之後是 GOS，GOS 那根最高且在最右邊（之前字串 x 被丟掉 → 一律右上，圖例蓋住 GOS）
    const cats = ['m=1', 'm=2', 'm=3', 'm=4', 'm=5', 'm=6', 'm=7', 'GOS']
    const bars: Data = { type: 'bar', x: cats, y: [-0.15, 0.4, 0.83, 0.95, 0.83, 0.4, -0.15, 1.2], name: 'Re κ' }
    const marks: Data = { x: cats, y: [0.3, 0.65, 0.38, 0, -0.38, -0.65, -0.3, 0], mode: 'markers', name: 'Im κ' }
    expect(pickLegendCorner([bars, marks])).toBeNull() // 右上有 GOS、左上有 m=3 → 上方
    // 最高的長條在最左 → 左上有資料、右上空 → 右上
    expect(pickLegendCorner([{ type: 'bar', x: ['a', 'b', 'c', 'd'], y: [4, 1, 1, 1], name: 'v' }])).toBe('top-right')
    // 最高的在最右 → 左上
    expect(pickLegendCorner([{ type: 'bar', x: ['a', 'b', 'c', 'd'], y: [1, 1, 1, 4], name: 'v' }])).toBe('top-left')
    // 水平長條（y 是類別）：最長的在最上面一列且長到右邊 → 右上有資料
    expect(pickLegendCorner([{ type: 'bar', orientation: 'h', y: ['a', 'b', 'c', 'd'], x: [1, 1, 1, 4], name: 'v' }])).toBe('top-left')
  })
})

describe('applyDashCycle', () => {
  it('第 4 條起沒指定 dash 的折線依序 dash / dot / dashdot；前三條與已指定者不動', () => {
    const data: Data[] = Array.from({ length: 7 }, (_, i) => ({ x: [0, 1], y: [i, i], name: `t${i}` }))
    ;(data[4] as { line?: { dash: string } }).line = { dash: 'longdash' }
    const out = applyDashCycle(data)
    expect(DASH_CYCLE).toEqual(['dash', 'dot', 'dashdot'])
    const dash = (i: number) => (out[i] as { line?: { dash?: string } }).line?.dash
    expect([0, 1, 2].map(dash)).toEqual([undefined, undefined, undefined])
    // 線型依 trace 序號決定（與 colorway 的顏色序號對齊），已指定者跳過但不改後面的序
    expect(dash(3)).toBe('dash')
    expect(dash(4)).toBe('longdash')
    expect(dash(5)).toBe('dashdot')
    expect(dash(6)).toBe('dash')
    // 不修改輸入
    expect((data[3] as { line?: unknown }).line).toBeUndefined()
    expect(out[0]).toBe(data[0])
  })

  it('只有 markers、line.width = 0（填色帶）、bar / heatmap 不套用；≤ 3 條原樣回傳', () => {
    const data: Data[] = [
      { y: [1] },
      { y: [1] },
      { y: [1] },
      { y: [1], mode: 'markers' },
      { y: [1], mode: 'lines', line: { width: 0 }, fill: 'tonexty' },
      { y: [1], type: 'bar' },
      { type: 'heatmap', z: [[1]] } as Data,
      { y: [1], mode: 'lines+markers', line: { width: 2 } },
      { y: [1], type: 'scattergl' },
    ]
    const out = applyDashCycle(data)
    const dash = (i: number) => (out[i] as { line?: { dash?: string } }).line?.dash
    expect([3, 4, 5, 6].map(dash)).toEqual([undefined, undefined, undefined, undefined])
    expect((out[7] as { line: { width: number; dash: string } }).line).toEqual({ width: 2, dash: 'dot' })
    expect(dash(8)).toBe('dashdot')
    const three: Data[] = [{ y: [1] }, { y: [1] }, { y: [1] }]
    expect(applyDashCycle(three)).toEqual(three)
  })
})
