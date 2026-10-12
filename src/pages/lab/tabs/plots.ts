/**
 * Lab 各分頁的圖表資料（純函式：模擬結果 → Plotly traces / layout）。
 * 所有曲線都直接取自 unifiedLab.ts 的結果，這裡只做排版；圖內的數學一律寫 `$...$`（LaTeX）；共用的 `Plot` 元件用 plotMath.ts 轉成斜體符號與上下標（Plotly 的 SVG 文字不能放 KaTeX）。
 */
import type { Data, Layout } from 'plotly.js-dist-min'
import { histogram } from '@/simulation/core'
import type { FcwPoint, LinearPrediction, McSummary, PipelineResult, TrainingResult } from '@/simulation/models/unifiedLab'
import { PE_ZERO_REL, timingPsdToDbc } from '../logic'

export interface Fig {
  data: Data[]
  layout: Partial<Layout>
}

export interface Palette {
  series: string[]
  muted: string
  danger: string
}

const ax = (text: string) => ({ title: { text } })
/** 模型（unifiedLab.ts）自己組出來的 code 名稱含 Unicode 的「±」：換成 `$\\pm$`（plotMath 會轉回斜體符號與上下標） */
const texLabel = (label: string): string => label.replace(/±/g, '$\\pm$')
const range2 = (a: ArrayLike<number>): [number, number] => [a[0], a[a.length - 1]]
const hline = (x: [number, number], y: number, name: string, color: string, dash: 'dot' | 'dash' | 'dashdot' = 'dot'): Data => ({
  x,
  y: [y, y],
  name,
  mode: 'lines',
  line: { color, width: 1, dash },
  hoverinfo: 'skip',
})

/* ------------------------------------------------------------------ */
/* Pipeline                                                            */
/* ------------------------------------------------------------------ */

/** w_k 軌跡：內部暫存器、實體 gain（定點）、平均模型（mean-field 軌跡；線性時不變模型作對照）、a 與 w*，以及單步游標。 */
export function figW(r: PipelineResult, pal: Palette, cursor: number | null): Fig {
  const b = r.blocks
  const xr = range2(b.k)
  const data: Data[] = [{ x: b.k, y: b.w, name: '$w_k$（內部暫存器）', mode: 'lines', line: { color: pal.series[0], width: 1.4 } }]
  if (r.params.quantize) data.push({ x: b.k, y: b.wPhys, name: '$w_{\\mathrm{phys}}$（實體 code $\\times$ LSB）', mode: 'lines', line: { color: pal.series[3], width: 1, shape: 'hv' } })
  const mf = r.meanModel === 'mean-field'
  if (Number.isFinite(b.wMeanModel[0])) data.push({ x: b.k, y: b.wMeanModel, name: mf ? 'mean-field 平均軌跡 $\\hat w_k$（對雜訊取期望）' : '線性平均模型 $w^* - \\delta_k$', mode: 'lines', line: { color: pal.series[1], width: 1.6, dash: 'dash' } })
  // 線性時不變模型（常數 w*、g）：只在它與 mean-field 軌跡不同時才有資訊，預設收在圖例裡
  if (mf && Number.isFinite(b.wLinearModel[b.wLinearModel.length - 1]))
    data.push({ x: b.k, y: b.wLinearModel, name: '線性時不變模型 $w^* - \\delta_k$（對照）', mode: 'lines', line: { color: pal.series[4], width: 1, dash: 'dot' }, visible: modelsDiffer(b.wMeanModel, b.wLinearModel, r.analytic.sigmaWPred) ? true : 'legendonly' })
  data.push(hline(xr, r.params.aFs, '$a$（真實 gain 誤差）', pal.muted))
  if (Number.isFinite(r.analytic.wStarMeanField) && Math.abs(r.analytic.wStarMeanField - r.params.aFs) > 1e-9)
    data.push(hline(xr, r.analytic.wStarMeanField, '$w^*$（mean-field 固定點）', pal.series[2], 'dashdot'))
  if (cursor !== null && cursor >= 0 && cursor < b.k.length)
    data.push({ x: [b.k[cursor]], y: [b.w[cursor]], name: `游標 $k = ${b.k[cursor]}$`, mode: 'markers', marker: { color: pal.danger, size: 10, symbol: 'diamond' } })
  return { data, layout: { xaxis: ax('block $k$'), yaxis: ax('gain [fs per unit code]') } }
}

/** 兩條平均軌跡在後半段是否差到「看得出來」（超過 σ_w 預測的 1/4；沒有 σ_w 預測時只要有差就算） */
function modelsDiffer(a: ArrayLike<number>, b: ArrayLike<number>, sigma: number): boolean {
  const thr = Number.isFinite(sigma) && sigma > 0 ? 0.25 * sigma : 1e-9
  for (let i = a.length >> 1; i < a.length; i++) if (Math.abs(a[i] - b[i]) > thr) return true
  return false
}

/** 每個 block 的 GMAC 輸出 G_k */
export function figG(r: PipelineResult, pal: Palette): Fig {
  const b = r.blocks
  return {
    data: [
      { x: b.k, y: b.G, name: '$G_k$', mode: 'lines', line: { color: pal.series[4], width: 1 } },
      hline(range2(b.k), 0, 'G = 0', pal.muted),
    ],
    layout: { xaxis: ax('block $k$'), yaxis: ax(r.params.gmMode === 'sum' ? '$G_k$（sum）' : '$G_k$（average，無因次）') },
  }
}

export type SampleView = 'snippet' | 'window'

/** 逐 sample：code 與 comparator 輸出 */
export function figCode(r: PipelineResult, pal: Palette, view: SampleView): Fig | null {
  const s = view === 'snippet' ? r.snippet : r.window
  if (!s) return null
  const data: Data[] = [{ x: s.n, y: s.x, name: '$x[n]$（正規化 code）', mode: 'lines', line: { color: pal.series[0], width: 1 } }]
  if (r.params.regressor !== 'raw') data.push({ x: s.n, y: s.xRef, name: '$x_{\\mathrm{ref}}[n]$（GMAC regressor）', mode: 'lines', line: { color: pal.series[2], width: 1 } })
  data.push({ x: s.n, y: s.q, name: '$q[n]$（comparator）', mode: 'markers', marker: { color: pal.series[1], size: 3 }, yaxis: 'y2' })
  return {
    data,
    layout: {
      xaxis: ax(view === 'snippet' ? 'sample $n$（連續）' : 'sample $n$（整個視窗，抽樣顯示）'),
      yaxis: ax('code（無因次）'),
      yaxis2: { title: { text: '$q$' }, overlaying: 'y', side: 'right', range: [-1.6, 1.6], showgrid: false },
    },
  }
}

/** 逐 sample：DTC 誤差、PD 的輸出（H_PD{e_DTC}）、comparator 輸入、output timing error */
export function figError(r: PipelineResult, pal: Palette, view: SampleView): Fig | null {
  const s = view === 'snippet' ? r.snippet : r.window
  if (!s) return null
  return {
    data: [
      { x: s.n, y: s.e, name: '$e = u_{\\mathrm{pd}} + b + v$（comparator 輸入，含雜訊）', mode: 'lines', line: { color: pal.muted, width: 0.6 }, visible: 'legendonly' },
      { x: s.n, y: s.eDtc, name: '$e_{\\mathrm{DTC}}$（DTC 誤差）', mode: 'lines', line: { color: pal.series[0], width: 1 } },
      { x: s.n, y: s.uPd, name: '$u_{\\mathrm{pd}} = H_{\\mathrm{PD}}(e_{\\mathrm{DTC}})$（PD 的輸出）', mode: 'lines', line: { color: pal.series[1], width: 1 } },
      { x: s.n, y: s.tOut, name: '$t_{\\mathrm{out}} = T(e_{\\mathrm{DTC}})$（輸出端）', mode: 'lines', line: { color: pal.series[2], width: 1.4 } },
    ],
    layout: { xaxis: ax(view === 'snippet' ? 'sample $n$（連續）' : 'sample $n$（整個視窗，抽樣顯示）'), yaxis: ax('時間誤差 [fs]') },
  }
}

const db10 = (v: number): number => (v > 0 ? 10 * Math.log10(v) : NaN)

/** |H_PD|²、|T|²（dB）與幾個關鍵頻率 */
export function figTransfer(r: PipelineResult, pal: Palette): Fig | null {
  const o = r.output
  if (!o) return null
  const f = o.psdAnalytic.f
  const marks: { f: number; name: string }[] = [{ f: r.analytic.fuHz, name: '$f_u = f_s/N$' }]
  if (Number.isFinite(r.analytic.f3dbHz)) marks.push({ f: r.analytic.f3dbHz, name: 'cal −3 dB' })
  if (Number.isFinite(r.pll.f3dbTHz)) marks.push({ f: r.pll.f3dbTHz, name: 'PLL $T$ −3 dB' })
  if (Number.isFinite(o.fracToneHz) && o.fracToneHz > 0) marks.push({ f: o.fracToneHz, name: 'fractional tone $f_1$' })
  return {
    data: [
      { x: f, y: Array.from(o.psdAnalytic.hpd2, db10), name: '$|H_{\\mathrm{PD}}|^2$（DTC 誤差 → PD）', mode: 'lines', line: { color: pal.series[1], width: 1.5 } },
      { x: f, y: Array.from(o.psdAnalytic.t2, db10), name: '$|T|^2$（DTC 誤差 → 輸出）', mode: 'lines', line: { color: pal.series[2], width: 1.5 } },
      { x: marks.map((m) => m.f), y: marks.map(() => 0), text: marks.map((m) => m.name), name: '關鍵頻率', mode: 'markers', marker: { color: pal.series[3], size: 9, symbol: 'triangle-down' } },
    ],
    layout: { xaxis: ax('$f$ [Hz]（sample-rate 軸，$f_s = f_{\\mathrm{ref}}$）'), yaxis: { ...ax('增益 [dB]'), range: [-120, 12] } },
  }
}

export type PsdUnit = 'fs2' | 'dbc'

/** 輸出 timing error 的 PSD：模擬（Welch）與 gain-noise 解析曲線 */
export function figPsd(r: PipelineResult, pal: Palette, unit: PsdUnit): Fig | null {
  const o = r.output
  if (!o) return null
  const conv = (y: Float64Array): Float64Array => (unit === 'dbc' ? timingPsdToDbc(y, r.fOutHz) : y)
  const data: Data[] = [{ x: o.psdSim.f, y: conv(o.psdSim.psd), name: '模擬 $t_{\\mathrm{out}}$（Welch，Hann）', mode: 'lines', line: { color: pal.series[0], width: 1 } }]
  if (o.psdAnalytic.noise.some((v) => Number.isFinite(v)))
    data.push({ x: o.psdAnalytic.f, y: conv(o.psdAnalytic.noise), name: '解析：gain noise $\\times$ code 經 $T$', mode: 'lines', line: { color: pal.series[1], width: 1.6, dash: 'dash' } })
  return {
    data,
    layout: { xaxis: ax('$f$ [Hz]'), yaxis: ax(unit === 'dbc' ? '$\\mathcal{L}(f)$ [dBc/Hz]' : '$S_t$（one-sided）[fs$^2$/Hz]') },
  }
}

/* ------------------------------------------------------------------ */
/* FCW sweep                                                           */
/* ------------------------------------------------------------------ */

const fr = (pts: FcwPoint[]): number[] => pts.map((p) => p.frac)

export function figSweepC(pts: FcwPoint[], pal: Palette): Fig {
  const bad = pts.filter((p) => p.signFlip)
  const data: Data[] = [
    { x: fr(pts), y: pts.map((p) => p.blockGainMax), name: 'block 相關 $C_k$ 最大', mode: 'lines', line: { color: pal.muted, width: 0.8 } },
    { x: fr(pts), y: pts.map((p) => p.blockGainMin), name: 'block 相關 $C_k$ 最小', mode: 'lines', line: { color: pal.muted, width: 0.8 }, fill: 'tonexty', fillcolor: 'rgba(128,128,128,0.15)' },
    { x: fr(pts), y: pts.map((p) => p.C), name: '$C = E[x_{\\mathrm{ref}}\\cdot u_x]$（整段平均）', mode: 'lines+markers', line: { color: pal.series[0], width: 1.6 }, marker: { size: 5 } },
    { x: fr(pts), y: pts.map((p) => p.CblockLms), name: '$C$（blockLms，前 $2^{17}$ 樣本）', mode: 'markers', marker: { color: pal.series[2], size: 5, symbol: 'x' } },
    hline([pts[0].frac, pts[pts.length - 1].frac], 0, '$C = 0$（極性邊界）', pal.danger, 'dash'),
  ]
  if (bad.length > 0) data.push({ x: fr(bad), y: bad.map((p) => p.C), name: '$C \\le 0$：極性錯誤', mode: 'markers', marker: { color: pal.danger, size: 10, symbol: 'circle-open', line: { width: 2 } } })
  return { data, layout: { xaxis: ax('FCW 小數部分 $\\alpha$'), yaxis: ax('$C$（無因次）') } }
}

export function figSweepPole(pts: FcwPoint[], pal: Palette): Fig {
  return {
    data: [
      { x: fr(pts), y: pts.map((p) => p.rho), name: '$\\rho$（平均模型的 pole 半徑）', mode: 'lines+markers', line: { color: pal.series[0], width: 1.6 }, marker: { size: 5 } },
      hline([pts[0].frac, pts[pts.length - 1].frac], 1, '$\\rho = 1$（穩定邊界）', pal.danger, 'dash'),
      { x: fr(pts), y: pts.map((p) => (Number.isFinite(p.tauBlocks) && p.tauBlocks > 0 ? p.tauBlocks : NaN)), name: '$\\tau$ [blocks]（右軸，log）', mode: 'lines+markers', line: { color: pal.series[3], width: 1.2 }, marker: { size: 4 }, yaxis: 'y2' },
    ],
    layout: {
      xaxis: ax('FCW 小數部分 $\\alpha$'),
      yaxis: ax('$\\rho$'),
      yaxis2: { title: { text: '$\\tau$ [blocks]' }, overlaying: 'y', side: 'right', type: 'log', showgrid: false },
    },
  }
}

export function figSweepPe(pts: FcwPoint[], pal: Palette): Fig {
  const floor = (p: FcwPoint) => Math.max(p.peLambdaMin, 1e-30)
  const bad = pts.filter((p) => p.peLambdaMin < PE_ZERO_REL * Math.max(p.Ex2, 1e-300))
  const data: Data[] = [
    { x: fr(pts), y: pts.map(floor), name: '$\\lambda_{\\min} = \\min_k \\frac{1}{N}\\sum u_x^2$', mode: 'lines+markers', line: { color: pal.series[2], width: 1.6 }, marker: { size: 5 } },
    { x: fr(pts), y: pts.map((p) => p.fracNegBlocks), name: '$C_k \\le 0$ 的 block 比例（右軸）', mode: 'lines+markers', line: { color: pal.series[1], width: 1 }, marker: { size: 4 }, yaxis: 'y2' },
  ]
  if (bad.length > 0) data.push({ x: fr(bad), y: bad.map(floor), name: '$\\lambda_{\\min} \\approx 0$：不可辨識', mode: 'markers', marker: { color: pal.danger, size: 10, symbol: 'circle-open', line: { width: 2 } } })
  return {
    data,
    layout: {
      xaxis: ax('FCW 小數部分 $\\alpha$'),
      yaxis: { ...ax('$\\lambda_{\\min}$（log；下限夾在 1e-30）'), type: 'log' },
      yaxis2: { title: { text: '比例' }, overlaying: 'y', side: 'right', range: [0, 1], showgrid: false },
    },
  }
}

export function figSweepBias(pts: FcwPoint[], pal: Palette, sigmaBand: boolean): Fig {
  const data: Data[] = [{ x: fr(pts), y: pts.map((p) => p.biasLin), name: '線性化 bias：$w^*_{\\mathrm{lin}} - a$', mode: 'lines+markers', line: { color: pal.series[0], width: 1.6 }, marker: { size: 5 } }]
  if (sigmaBand) {
    data.push({ x: fr(pts), y: pts.map((p) => p.sigmaWPred), name: '$+\\sigma_{w,\\mathrm{pred}}$', mode: 'lines', line: { color: pal.muted, width: 0.8, dash: 'dot' } })
    data.push({ x: fr(pts), y: pts.map((p) => -p.sigmaWPred), name: '$-\\sigma_{w,\\mathrm{pred}}$', mode: 'lines', line: { color: pal.muted, width: 0.8, dash: 'dot' } })
  }
  const loop = pts.filter((p) => p.loop)
  if (loop.length > 0) {
    const ok = loop.filter((p) => p.loop?.converged)
    const no = loop.filter((p) => !p.loop?.converged)
    data.push({ x: fr(ok), y: ok.map((p) => p.loop?.bias ?? NaN), name: '閉迴路 mean $w - a$（已收斂）', mode: 'markers', marker: { color: pal.series[2], size: 7 } })
    if (no.length > 0) data.push({ x: fr(no), y: no.map((p) => p.loop?.bias ?? NaN), name: '閉迴路（未收斂，含 transient）', mode: 'markers', marker: { color: pal.danger, size: 7, symbol: 'x' } })
  }
  return { data, layout: { xaxis: ax('FCW 小數部分 $\\alpha$'), yaxis: ax('bias [fs per unit code]') } }
}

export function figSweepSpur(pts: FcwPoint[], pal: Palette): Fig {
  return {
    data: [
      { x: fr(pts), y: pts.map((p) => p.spurDbc), name: 'fractional spur（一階封閉式）[dBc]', mode: 'lines+markers', line: { color: pal.series[1], width: 1.6 }, marker: { size: 5 } },
      { x: fr(pts), y: pts.map((p) => p.sensRms), name: '$\\mathrm{std}(T(x))$：每 fs gain 誤差的輸出 RMS（右軸）', mode: 'lines+markers', line: { color: pal.series[4], width: 1 }, marker: { size: 4 }, yaxis: 'y2' },
    ],
    layout: {
      xaxis: ax('FCW 小數部分 $\\alpha$'),
      yaxis: ax('spur [dBc]'),
      yaxis2: { title: { text: 'fs / fs' }, overlaying: 'y', side: 'right', type: 'log', showgrid: false },
    },
  }
}

export function figSweepSlope(pts: FcwPoint[], pal: Palette): Fig | null {
  const s = pts.filter((p) => p.slope)
  if (s.length === 0) return null
  const sl = (p: FcwPoint) => p.slope as NonNullable<FcwPoint['slope']>
  return {
    data: [
      { x: fr(s), y: s.map((p) => sl(p).Klin), name: '$K = K_q\\cdot C$（線性化）', mode: 'lines', line: { color: pal.series[0], width: 1.4 } },
      { x: fr(s), y: s.map((p) => sl(p).Smf), name: 'mean-field 斜率（同一段樣本）', mode: 'lines', line: { color: pal.series[2], width: 1.2, dash: 'dash' } },
      {
        x: fr(s),
        y: s.map((p) => sl(p).S),
        name: 'MC：$S = -(G_+ - G_-)/(2\\Delta w)$，95% CI',
        mode: 'markers',
        marker: { color: pal.series[1], size: 6 },
        error_y: { type: 'data', symmetric: false, array: s.map((p) => sl(p).hi - sl(p).S), arrayminus: s.map((p) => sl(p).S - sl(p).lo), width: 2, thickness: 1 },
      },
      hline([s[0].frac, s[s.length - 1].frac], 0, '$S = 0$', pal.danger, 'dash'),
    ],
    layout: { xaxis: ax('FCW 小數部分 $\\alpha$'), yaxis: ax('GMAC 斜率 [fs$^{-1}$]') },
  }
}

/* ------------------------------------------------------------------ */
/* Monte Carlo                                                         */
/* ------------------------------------------------------------------ */

function thin(n: number, max: number): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i)
  const step = n / max
  return Array.from({ length: max }, (_, i) => Math.floor(i * step))
}

export function figMcEnsemble(s: McSummary, lin: LinearPrediction, aFs: number, pal: Palette): Fig {
  const idx = thin(s.wMean.length, 2000)
  const k = idx
  const mean = idx.map((i) => s.wMean[i])
  const up = idx.map((i) => s.wMean[i] + s.wStd[i])
  const dn = idx.map((i) => s.wMean[i] - s.wStd[i])
  const data: Data[] = [
    { x: k, y: up, name: '平均 $+ 1\\sigma$（跨 seeds）', mode: 'lines', line: { color: pal.series[0], width: 0.6 } },
    { x: k, y: dn, name: '平均 $-1\\sigma$', mode: 'lines', line: { color: pal.series[0], width: 0.6 }, fill: 'tonexty', fillcolor: 'rgba(100,150,220,0.18)' },
    { x: k, y: mean, name: `跨 ${s.valid} 個 seeds 的平均 $w_k$`, mode: 'lines', line: { color: pal.series[0], width: 1.8 } },
  ]
  if (lin.valid) data.push({ x: k, y: idx.map((i) => lin.traj[i]), name: lin.model === 'mean-field' ? 'mean-field 平均軌跡' : '線性平均模型', mode: 'lines', line: { color: pal.series[1], width: 1.4, dash: 'dash' } })
  data.push(hline([0, s.wMean.length - 1], aFs, '$a$', pal.muted))
  return { data, layout: { xaxis: ax('block $k$'), yaxis: ax('gain [fs per unit code]') } }
}

export function figMcHist(s: McSummary, pal: Palette, pred: number): Fig {
  const bins = Math.max(5, Math.min(24, Math.ceil(Math.sqrt(s.perRunMeanW.length) * 2)))
  const h1 = histogram(s.perRunMeanW, bins)
  const h2 = histogram(s.perRunStdW, bins)
  const data: Data[] = [
    { x: h1.centers, y: h1.counts, name: '每個 seed 的後半段 mean $w$ [fs]', type: 'bar', marker: { color: pal.series[0] } },
    { x: h2.centers, y: h2.counts, name: '每個 seed 的後半段 $\\sigma_w$ [fs]', type: 'bar', marker: { color: pal.series[2] }, xaxis: 'x2', yaxis: 'y2' },
  ]
  if (Number.isFinite(pred)) data.push({ x: [pred, pred], y: [0, Math.max(...h2.counts, 1)], name: '$\\sigma_w$ 預測', mode: 'lines', line: { color: pal.series[1], width: 1.6, dash: 'dash' }, xaxis: 'x2', yaxis: 'y2' })
  return {
    data,
    layout: {
      grid: { rows: 1, columns: 2, pattern: 'independent' },
      xaxis: ax('mean $w$ [fs]'),
      yaxis: ax('seeds 數'),
      xaxis2: ax('$\\sigma_w$ [fs]'),
      yaxis2: {},
      bargap: 0.05,
    },
  }
}

/* ------------------------------------------------------------------ */
/* Training                                                            */
/* ------------------------------------------------------------------ */

export function figTrainPsd(res: TrainingResult, pal: Palette): Fig {
  return {
    data: res.patterns.map((p, i) => ({ x: p.psd.f, y: p.psd.psd, name: `Case ${'ABC'[i]}：${texLabel(p.label)}`, mode: 'lines', line: { color: pal.series[i], width: 1 } }) as Data),
    layout: { xaxis: ax('$f$ [Hz]'), yaxis: ax('$S_x$（one-sided）[1/Hz]') },
  }
}

export function figTrainAcf(res: TrainingResult, pal: Palette): Fig {
  return {
    data: res.patterns.map((p, i) => ({ x: Array.from(p.acf, (_, l) => l), y: p.acf, name: `Case ${'ABC'[i]}`, mode: 'lines+markers', line: { color: pal.series[i], width: 1 }, marker: { size: 3 } }) as Data),
    layout: { xaxis: ax('lag $\\ell$ [samples]'), yaxis: { ...ax('$R_x[\\ell] / R_x[0]$（去平均）'), range: [-1.05, 1.05] } },
  }
}

export function figTrainCd(res: TrainingResult, pal: Palette): Fig {
  const data: Data[] = res.patterns.map((p, i) => ({ x: Array.from(p.cd, (_, d) => d), y: p.cd, name: `Case ${'ABC'[i]}（最佳 $D = ${p.bestD}$）`, mode: 'lines+markers', line: { color: pal.series[i], width: 1.2 }, marker: { size: 3 } }) as Data)
  const n = res.patterns[0]?.cd.length ?? 1
  data.push(hline([0, n - 1], 0, '$C_D = 0$（極性邊界）', pal.danger, 'dash'))
  return { data, layout: { xaxis: ax('GMAC code delay $D$ [samples]'), yaxis: ax('$C_D = E[x_{\\mathrm{ref}}^{(D)}\\cdot u_x]$') } }
}

export function figTrainSv(res: TrainingResult, pal: Palette): Fig {
  // 類別軸的刻度文字（$\sigma_1$、$\sigma_2$…）：資料裡的字串不會套用 plotMath，所以改用 tickvals／ticktext
  const count = Math.max(0, ...res.patterns.map((p) => p.svScaled.length))
  return {
    data: res.patterns.map((p, i) => ({ x: p.svScaled.map((_, j) => j), y: p.svScaled.map((v) => Math.max(v, 1e-16)), name: `Case ${'ABC'[i]}（rank ${p.rank}）`, type: 'bar', marker: { color: pal.series[i] } }) as Data),
    layout: {
      xaxis: { ...ax('scaled Jacobian 的奇異值'), tickmode: 'array', tickvals: Array.from({ length: count }, (_, j) => j), ticktext: Array.from({ length: count }, (_, j) => `$\\sigma_{${j + 1}}$`) },
      yaxis: { ...ax('$\\sigma_i$（log；下限夾在 1e-16）'), type: 'log' },
      barmode: 'group',
    },
  }
}

/* ------------------------------------------------------------------ */
/* Compare                                                             */
/* ------------------------------------------------------------------ */

export interface CompareItem {
  id: string
  seriesIndex: number
  res: PipelineResult
}

export function figCompareW(items: CompareItem[], pal: Palette): Fig {
  const data: Data[] = []
  for (const it of items) {
    const b = it.res.blocks
    data.push({ x: b.k, y: b.w, name: `Case ${it.id}：$w_k$`, mode: 'lines', line: { color: pal.series[it.seriesIndex], width: 1.3 } })
    if (Number.isFinite(b.wMeanModel[0])) data.push({ x: b.k, y: b.wMeanModel, name: `Case ${it.id}：${it.res.meanModel === 'mean-field' ? 'mean-field 平均軌跡' : '線性平均模型'}`, mode: 'lines', line: { color: pal.series[it.seriesIndex], width: 1, dash: 'dash' } })
  }
  const a = new Set(items.map((it) => it.res.params.aFs))
  if (a.size === 1 && items.length > 0) {
    const kmax = Math.max(...items.map((it) => it.res.blocks.k[it.res.blocks.k.length - 1]))
    data.push(hline([0, kmax], items[0].res.params.aFs, '$a$', pal.muted))
  }
  return { data, layout: { xaxis: ax('block $k$'), yaxis: ax('gain [fs per unit code]') } }
}

export function figComparePsd(items: CompareItem[], pal: Palette, unit: PsdUnit): Fig | null {
  const withOut = items.filter((it) => it.res.output)
  if (withOut.length === 0) return null
  return {
    data: withOut.map((it) => {
      const o = it.res.output as NonNullable<PipelineResult['output']>
      return { x: o.psdSim.f, y: unit === 'dbc' ? timingPsdToDbc(o.psdSim.psd, it.res.fOutHz) : o.psdSim.psd, name: `Case ${it.id}：$t_{\\mathrm{out}}$`, mode: 'lines', line: { color: pal.series[it.seriesIndex], width: 1 } } as Data
    }),
    layout: { xaxis: ax('$f$ [Hz]'), yaxis: ax(unit === 'dbc' ? '$\\mathcal{L}(f)$ [dBc/Hz]' : '$S_t$（one-sided）[fs$^2$/Hz]') },
  }
}
