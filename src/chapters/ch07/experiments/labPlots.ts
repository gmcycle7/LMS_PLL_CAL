/**
 * Lab 的 Plotly trace / layout 建構（純函式；所有數值都來自 analyzeFxLab 或 runFxComparison 的結果）。
 */
import type { Data, Layout } from 'plotly.js-dist-min'
import type { FxComparisonResult, FxLabAnalysis, RegressorMode } from '@/simulation/models/filteredX'
import type { LabScenario } from './labState'
import { txs } from '../util'

/**
 * 圖內文字的數學一律寫 `$...$`（docs/teaching-style.md §3）：Plot 元件會用 plotMath 轉成斜體符號與上下標。
 * 只用 plotMath 支援的基本指令（希臘字母、\hat、\angle、_ ^、\cdot、\times、\mathrm、\equiv…）。
 */
const r = String.raw

const zeroLine = (): Partial<Layout>['shapes'] => [
  { type: 'line', xref: 'paper', x0: 0, x1: 1, y0: 0, y1: 0, line: { dash: 'dot', width: 1 } },
]

function rmsOf(v: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i] * v[i]
  return v.length ? Math.sqrt(s / v.length) : 0
}

/**
 * u_f 的顯示縮放：Ĥ 的增益可能和 H 差很多（二次差分約 1/(ω_nT_s)² 倍），疊圖時會把其他曲線壓扁。
 * 只在 RMS 比超過 3 倍時把 u_f 縮放到與 u 同 RMS（只影響圖，不影響 CSV 與任何計算；縮放倍數寫在圖例）。
 */
export function ufDisplayScale(an: Pick<FxLabAnalysis, 'wave'>): number {
  const ru = rmsOf(an.wave.u)
  const rf = rmsOf(an.wave.uf)
  if (!(ru > 0 && rf > 0)) return 1
  const k = ru / rf
  return k > 3 || k < 1 / 3 ? k : 1
}

/** 波形疊圖：x、u、x_D = x[n−D]、u_f（以及 filtered 模式下 D > 0 時實際使用的 u_f[n−D]） */
export function waveFigure(an: FxLabAnalysis, mode: RegressorMode, D: number): { data: Data[]; layout: Partial<Layout> } {
  const n = Array.from(an.wave.n)
  const k = ufDisplayScale(an)
  const tag = k === 1 ? '' : r`（顯示 $\times ${txs(k, 3)}$，與 $u$ 同 RMS）`
  const data: Data[] = [
    { x: n, y: Array.from(an.wave.x), name: r`$x[n]$（code）`, mode: 'lines', line: { width: 1.5 } },
    { x: n, y: Array.from(an.wave.u), name: r`$u[n] = (h*x)[n]$（PD 看到的）`, mode: 'lines', line: { width: 2.5 } },
    { x: n, y: Array.from(an.wave.xD), name: r`$x[n-${D}]$（delayed-x）`, mode: 'lines', line: { dash: 'dash', width: 1.5 } },
    { x: n, y: Array.from(an.wave.uf, (v) => v * k), name: r`$u_f[n] = (\hat h*x)[n]$（filtered-x）${tag}`, mode: 'lines', line: { dash: 'dot', width: 2 } },
  ]
  if (mode === 'filtered' && D > 0) {
    data.push({ x: n, y: Array.from(an.wave.ref, (v) => v * k), name: r`$u_f[n-${D}]$（實際 regressor）${tag}`, mode: 'lines', line: { dash: 'dashdot', width: 1.5 } })
  }
  return {
    data,
    layout: {
      xaxis: { title: { text: r`$n$ [sample]` } },
      yaxis: { title: { text: '振幅（unit-power code）' } },
      shapes: zeroLine(),
    },
  }
}

/** 相關 vs D：延遲 code、延遲 error、filtered-x（解析 + 同一段 code 的經驗值） */
export function sweepFigure(an: FxLabAnalysis, D: number, mode: RegressorMode): { data: Data[]; layout: Partial<Layout> } {
  const Ds = Array.from(an.sweep.D)
  const data: Data[] = []
  const add = (arr: Float64Array | null, name: string, dash: 'solid' | 'dash' | 'dot', legendgroup: string) => {
    if (arr) data.push({ x: Ds, y: Array.from(arr), name: `${name}（解析）`, mode: 'lines', line: { dash, width: 2 }, legendgroup })
  }
  add(an.sweep.codeDelay.analytic, r`delayed-x：$E[x[n-D]\cdot u[n]]$`, 'solid', 'code')
  data.push({ x: Ds, y: Array.from(an.sweep.codeDelay.empirical), name: 'delayed-x（經驗）', mode: 'markers', marker: { size: 5 }, legendgroup: 'code' })
  add(an.sweep.errorDelay.analytic, r`延遲 error：$E[x[n]\cdot u[n-D]]$`, 'dash', 'err')
  data.push({ x: Ds, y: Array.from(an.sweep.errorDelay.empirical), name: '延遲 error（經驗）', mode: 'markers', marker: { size: 4, symbol: 'x' }, legendgroup: 'err' })
  add(an.sweep.filtered.analytic, r`filtered-x：$E[u_f[n-D]\cdot u[n]]$`, 'dot', 'fil')
  data.push({ x: Ds, y: Array.from(an.sweep.filtered.empirical), name: 'filtered-x（經驗）', mode: 'markers', marker: { size: 4, symbol: 'diamond' }, legendgroup: 'fil' })
  const shapes = [
    ...(zeroLine() ?? []),
    ...(mode !== 'raw'
      ? [{ type: 'line' as const, xref: 'x' as const, yref: 'paper' as const, x0: D, x1: D, y0: 0, y1: 1, line: { dash: 'dash' as const, width: 1 } }]
      : []),
  ]
  return {
    data,
    layout: {
      xaxis: { title: { text: r`$D$ [samples]` } },
      yaxis: { title: { text: r`相關 $C$（unit-power code）` } },
      shapes,
    },
  }
}

/** 逐頻率殘餘相位 θ(Ω) 與加權（S_xx|H||Ĥ_ref|，正規化），±90° 虛線；Ĥ_ref = 1（raw／delayed）或 Ĥ（filtered） */
export function phaseFigure(an: FxLabAnalysis): { data: Data[]; layout: Partial<Layout> } {
  const om = Array.from(an.freq.omega)
  const data: Data[] = [
    { x: om, y: Array.from(an.freq.thetaDeg), name: r`$\theta(\Omega) = \angle H - \angle\hat H_{\mathrm{ref}} + \Omega D$`, mode: 'lines', line: { width: 2 } },
    { x: om, y: Array.from(an.freq.phaseHDeg), name: r`$\angle H(e^{j\Omega})$`, mode: 'lines', line: { dash: 'dot', width: 1.5 } },
  ]
  // 加權 = S_xx·|H|·|Ĥ_ref|（隨機 code）或 |H|·|Ĥ_ref|（單頻／DSM code：無封閉式 PSD）
  const w = an.freq.magH.map((m, i) => m * an.freq.magRef[i] * (an.freq.sxx ? an.freq.sxx[i] : 1))
  let wMax = 0
  for (const v of w) wMax = Math.max(wMax, v)
  if (wMax > 0) {
    data.push({
      x: om,
      y: Array.from(w, (v) => v / wMax),
      name: an.freq.sxx ? r`加權 $S_{xx}|H||\hat H_{\mathrm{ref}}|$（正規化）` : r`$|H||\hat H_{\mathrm{ref}}|$（正規化）`,
      mode: 'lines',
      yaxis: 'y2',
      line: { width: 1, dash: 'dash' },
    })
  }
  const shapes: Partial<Layout>['shapes'] = [
    { type: 'line', xref: 'paper', x0: 0, x1: 1, y0: 90, y1: 90, line: { dash: 'dash', width: 1 } },
    { type: 'line', xref: 'paper', x0: 0, x1: 1, y0: -90, y1: -90, line: { dash: 'dash', width: 1 } },
  ]
  if (an.tone) shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: an.tone.omega, x1: an.tone.omega, y0: 0, y1: 1, line: { width: 1 } })
  return {
    data,
    layout: {
      xaxis: { title: { text: r`$\Omega$ [rad/sample]（log）` } },
      yaxis: { title: { text: '相位 [deg]' }, range: [-185, 185], dtick: 45 },
      yaxis2: { title: { text: '加權' }, overlaying: 'y', side: 'right', range: [0, 1.05], showgrid: false },
      shapes,
    },
  }
}

/** 閉迴路 w_k（A/B/C 同 seed）＋穩定時的線性化平均軌跡 a − (a − w_0)p^k；`labels` 是各 Case 的簡短說明，數學寫成 `$...$` */
export function closedLoopFigure(
  res: FxComparisonResult,
  scenario: Pick<LabScenario, 'a' | 'w0'>,
  colors: Record<string, string>,
  labels: Record<string, string>,
): { data: Data[]; layout: Partial<Layout> } {
  const data: Data[] = []
  let lo = Math.min(scenario.a, scenario.w0)
  let hi = Math.max(scenario.a, scenario.w0)
  for (const c of res.cases) {
    const k = Array.from({ length: c.w.length }, (_, i) => i)
    const color = colors[c.id]
    data.push({ x: k, y: Array.from(c.w), name: `Case ${c.id}：${labels[c.id] ?? ''}`, mode: 'lines', line: { color, width: 2 } })
    const { g, p } = c.analytic
    if (Number.isFinite(g) && g > 0 && g < 2) {
      const pred = k.map((i) => scenario.a - (scenario.a - scenario.w0) * Math.pow(p, i))
      data.push({ x: k, y: pred, name: r`Case ${c.id} 線性化平均（$p = ${p.toPrecision(4)}$）`, mode: 'lines', line: { color, dash: 'dot', width: 1 }, showlegend: true })
    }
    for (const v of c.w) {
      if (Number.isFinite(v)) {
        lo = Math.min(lo, v)
        hi = Math.max(hi, v)
      }
    }
  }
  const span = hi - lo || 1
  return {
    data,
    layout: {
      xaxis: { title: { text: r`block $k$` } },
      yaxis: { title: { text: r`$w_k$ [fs per unit code]` }, range: [lo - 0.05 * span, hi + 0.05 * span] },
      shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: scenario.a, y1: scenario.a, line: { dash: 'dash', width: 1 } }],
    },
  }
}
