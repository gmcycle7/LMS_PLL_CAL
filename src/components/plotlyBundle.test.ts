// @vitest-environment jsdom
/**
 * 真的載入 plotly.js-cartesian-dist-min（不 mock）：確認 Plot.tsx 用到的 API 與站內用到的 trace 型別都在這個
 * 比完整版小 70% 的 bundle 裡。換成更小的 plotly.js-basic-dist-min（沒有 heatmap / histogram）或升級 plotly
 * 之後少了什麼，這裡會先失敗，而不是讀者捲到某張圖才看到「圖表模組載入失敗」。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { loadPlotly } from './Plot'

type PlotlyWithSchema = Awaited<ReturnType<typeof loadPlotly>> & {
  version: string
  PlotSchema: { get: () => { traces: Record<string, unknown>; layout: { layoutAttributes: Record<string, unknown> } } }
}

/** 站內實際用到的 trace 型別（grep `type: '…'` 的結果；scatter 是沒寫 type 時的預設） */
const USED_TRACE_TYPES = ['scatter', 'bar', 'histogram', 'heatmap']
/** 站內用到的 layout 元件（都在 plotly core，不在任何 trace bundle 裡） */
const USED_LAYOUT_COMPONENTS = ['annotations', 'shapes', 'legend', 'xaxis', 'yaxis', 'colorscale']
/**
 * plotly.js 2.35 完整版註冊的全部 51 種 trace 型別（cartesian bundle 只有前 12 種）。
 * 掃 src 時只有這些名字算「trace 型別」；`type: 'line'`（shape）、`type: 'log'`（軸）等不算。
 */
const ALL_PLOTLY_TRACE_TYPES = new Set([
  'bar', 'box', 'contour', 'heatmap', 'histogram', 'histogram2d', 'histogram2dcontour', 'image', 'pie', 'scatter', 'scatterternary', 'violin',
  'barpolar', 'candlestick', 'carpet', 'choropleth', 'choroplethmap', 'choroplethmapbox', 'cone', 'contourcarpet', 'densitymap', 'densitymapbox',
  'funnel', 'funnelarea', 'heatmapgl', 'icicle', 'indicator', 'isosurface', 'mesh3d', 'ohlc', 'parcats', 'parcoords', 'pointcloud', 'sankey',
  'scatter3d', 'scattercarpet', 'scattergeo', 'scattergl', 'scattermap', 'scattermapbox', 'scatterpolar', 'scatterpolargl', 'scattersmith',
  'splom', 'streamtube', 'sunburst', 'surface', 'table', 'treemap', 'volume', 'waterfall',
])

/** src 下的 .ts／.tsx 原始碼（不含測試與 .d.ts） */
function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) listSourceFiles(full, out)
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

describe('plotly.js-cartesian-dist-min（Plot 實際載入的 bundle）', () => {
  it('是 2.35.x，而且 Plot.tsx 用到的 API 都在：react / relayout / purge / toImage / downloadImage / Plots.resize', async () => {
    const P = (await loadPlotly()) as PlotlyWithSchema
    expect(P.version).toMatch(/^2\.35\./)
    for (const fn of ['react', 'relayout', 'purge', 'toImage', 'downloadImage'] as const) {
      expect(typeof P[fn], fn).toBe('function')
    }
    expect(typeof P.Plots.resize).toBe('function')
  })

  it('工具列用的內建圖示（camera-retro、disk）與 modebar 都在', async () => {
    const P = (await loadPlotly()) as PlotlyWithSchema
    for (const name of ['camera-retro', 'disk', 'zoombox', 'pan', 'autoscale'] as const) {
      const icon = P.Icons[name]
      expect(icon, name).toBeTruthy()
      expect(typeof icon.path, `${name}.path`).toBe('string')
    }
  })

  it(`已註冊的 trace 型別涵蓋站內用到的 ${USED_TRACE_TYPES.join(' / ')}；沒有 WebGL（scattergl）或 3D / 地圖`, async () => {
    const P = (await loadPlotly()) as PlotlyWithSchema
    const traces = Object.keys(P.PlotSchema.get().traces)
    expect(traces).toEqual(expect.arrayContaining(USED_TRACE_TYPES))
    // 換回完整版（或 gl2d）會多出這些：bundle 預算會先擋，這裡再明確說明原因
    for (const heavy of ['scattergl', 'scatter3d', 'surface', 'scattermapbox', 'scattergeo', 'scatterpolar']) {
      expect(traces, `${heavy} 不該在 cartesian bundle 裡`).not.toContain(heavy)
    }
    const layoutKeys = Object.keys(P.PlotSchema.get().layout.layoutAttributes)
    expect(layoutKeys).toEqual(expect.arrayContaining(USED_LAYOUT_COMPONENTS))
  })

  it('src 原始碼裡每個 `type: \'…\'` 的 Plotly trace 型別都已註冊在 cartesian bundle（新圖用到 polar／3D／gl／地圖時這裡先失敗，而不是讀者看到空圖）', async () => {
    const P = (await loadPlotly()) as PlotlyWithSchema
    const registered = new Set(Object.keys(P.PlotSchema.get().traces))
    const srcDir = resolve(process.cwd(), 'src') // vitest 的 cwd 是 repo 根目錄；jsdom 下 import.meta.url 不是 file:
    const used = new Map<string, Set<string>>()
    for (const file of listSourceFiles(srcDir)) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/\btype: '([a-z0-9]+)'/g)) {
        if (!ALL_PLOTLY_TRACE_TYPES.has(m[1])) continue
        if (!used.has(m[1])) used.set(m[1], new Set())
        used.get(m[1])!.add(relative(srcDir, file))
      }
    }
    // 掃描本身有效：至少找到上面列的四種
    expect([...used.keys()].sort()).toEqual(expect.arrayContaining([...USED_TRACE_TYPES].sort()))
    const missing = [...used].filter(([t]) => !registered.has(t)).map(([t, files]) => `${t}（${[...files].join('、')}）`)
    expect(missing, '這些 trace 型別不在 plotly.js-cartesian-dist-min 裡：改用 2D 圖，或換 bundle 並提高 scripts/check-bundle-size.mjs 的 plotly 預算').toEqual([])
  })
})
