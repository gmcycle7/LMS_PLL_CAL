import { plotMath } from '@/components/plotMath'
import {
  DEFAULT_LAB_PARAMS,
  DEFAULT_SWEEP_OPTIONS,
  DEFAULT_TRAINING_PATTERN,
  analyzeTraining,
  combineMc,
  fcwGrid,
  mcChecks,
  mcSeeds,
  runMcChunk,
  runPipeline,
  sweepFcwChunk,
  type LabParams,
  type TrainingParams,
} from '@/simulation/models/unifiedLab'
import { allChartStrings, chartStringProblems, plotlyLeftovers, type PlotCall } from './chartStringsTestUtils'
import {
  figCode,
  figCompareW,
  figComparePsd,
  figError,
  figG,
  figMcEnsemble,
  figMcHist,
  figPsd,
  figSweepBias,
  figSweepC,
  figSweepPe,
  figSweepPole,
  figSweepSlope,
  figSweepSpur,
  figTrainAcf,
  figTrainCd,
  figTrainPsd,
  figTrainSv,
  figTransfer,
  figW,
  type Fig,
  type Palette,
} from './tabs/plots'

/**
 * Lab 五個分頁的圖表資料（plots.ts）：圖內的數學一律是 `$...$` 的 LaTeX（使用者要求，2026-10-11）。
 * 這裡直接用真正的模擬結果（縮小的長度）呼叫每個 fig*()，檢查「作者寫的字串」：
 *   1. `$...$` 以外沒有 Unicode 拼的數學，公式裡也沒有 Unicode 數學；
 *   2. 經 plotMath 轉成 Plotly 的 pseudo-HTML 之後，沒有殘留的反斜線、大括號、`$`（代表指令都認得）。
 */
const pal: Palette = { series: ['#1f77b4', '#d62728', '#2ca02c', '#9467bd', '#ff7f0e', '#8c564b'], muted: '#888', danger: '#c00' }
const SMALL: LabParams = { ...DEFAULT_LAB_PARAMS, N: 256, blocks: 160, outBlocks: 32, frac: 0.0625, dsmBits: 8, codeSource: 'dsm_first_order', muFs: 20, c3: 0.5, compOffsetFs: 0.5, quantize: true }

const calls: PlotCall[] = []
const record = (f: Fig | null): Fig | null => {
  if (f) calls.push({ data: f.data, layout: f.layout })
  return f
}

describe('Lab 圖表字串：全部是 LaTeX（plots.ts）', () => {
  let strings: string[] = []

  beforeAll(() => {
    // Pipeline：九級的 w、G、code、誤差、transfer、PSD（兩種單位）
    const r = runPipeline(SMALL)
    const ids: Fig[] = [
      figW(r, pal, 3),
      figG(r, pal),
      figW({ ...r, params: { ...r.params, quantize: false, gmMode: 'sum' } } as typeof r, pal, null),
      figG({ ...r, params: { ...r.params, gmMode: 'sum' } } as typeof r, pal),
    ]
    for (const f of ids) record(f)
    for (const v of ['snippet', 'window'] as const) {
      record(figCode(r, pal, v))
      record(figError(r, pal, v))
    }
    record(figTransfer(r, pal))
    record(figPsd(r, pal, 'dbc'))
    record(figPsd(r, pal, 'fs2'))
    // Compare
    const r2 = runPipeline({ ...SMALL, regressor: 'delayed', codeDelay: 2, quantize: false })
    const items = [
      { id: 'A', seriesIndex: 0, res: r },
      { id: 'B', seriesIndex: 1, res: r2 },
    ]
    record(figCompareW(items, pal))
    record(figComparePsd(items, pal, 'dbc'))
    record(figComparePsd(items, pal, 'fs2'))
    // FCW sweep（含閉迴路與斜率 MC，這樣每條線都畫出來）
    const base: LabParams = { ...SMALL, quantize: false }
    const pts = sweepFcwChunk({ base, fracs: fcwGrid(0.01, 0.5, 5, 'linear'), opts: { ...DEFAULT_SWEEP_OPTIONS, closedLoop: true, loopBlocks: 120, slopeBlocks: 8 }, offset: 0 }).points
    record(figSweepC(pts, pal))
    record(figSweepPole(pts, pal))
    record(figSweepPe(pts, pal))
    record(figSweepBias(pts, pal, true))
    record(figSweepSpur(pts, pal))
    record(figSweepSlope(pts, pal))
    // Monte Carlo
    const chunk = runMcChunk({ base: { ...base, blocks: 80 }, seeds: mcSeeds(1, 0, 4), meanField: true })
    const summary = combineMc([chunk])
    const checks = mcChecks(summary, chunk.analytic, { ...base, blocks: 80 }, chunk.meanField ?? null)
    record(figMcEnsemble(summary, checks.lin, base.aFs, pal))
    record(figMcHist(summary, pal, 0.3))
    // Training
    const tp: TrainingParams = {
      seed: 1,
      fRefHz: base.fRefHz,
      nInt: base.nInt,
      pll: 'type2',
      pllBwHz: base.pllBwHz,
      zeta: base.zeta,
      loopDelay: 0,
      regressor: 'delayed',
      codeDelay: 0,
      sigmaV: base.sigmaV,
      length: 4096,
      N0: 256,
      maxLag: 16,
      maxDelay: 16,
      residualGainFs: 0.1,
      c2: 0,
      c3: 0,
      basis: { gain: true, inl2: true, inl3: false, offset: true },
      patterns: [
        { ...DEFAULT_TRAINING_PATTERN, frac: 0.0625, dsmBits: 8 },
        { ...DEFAULT_TRAINING_PATTERN, source: 'mash111', frac: 0.3, dsmBits: 8 },
        { ...DEFAULT_TRAINING_PATTERN, source: 'iid_pm_one' },
      ],
    }
    const tr = analyzeTraining(tp)
    record(figTrainPsd(tr, pal))
    record(figTrainAcf(tr, pal))
    record(figTrainCd(tr, pal))
    record(figTrainSv(tr, pal))
    strings = allChartStrings(calls)
  }, 120_000)

  it('每個圖內字串：`$` 成對、`$...$` 以外沒有 Unicode 拼的數學、公式裡沒有 Unicode 數學', () => {
    expect(calls.length).toBeGreaterThanOrEqual(20)
    expect(chartStringProblems(calls)).toEqual([])
  })

  it('經 plotMath 轉成 Plotly 的 pseudo-HTML 之後沒有殘留的反斜線、大括號、`$`（所有 TeX 指令都認得）', () => {
    expect(strings.length).toBeGreaterThan(60)
    expect(plotlyLeftovers(strings, plotMath)).toEqual([])
  })

  it('挑幾個代表性的字串核對：下標、希臘字母、帽子、Σ、類別軸的刻度文字', () => {
    const has = (s: string) => expect(strings, s).toContain(s)
    has('$w_k$（內部暫存器）')
    has(String.raw`mean-field 平均軌跡 $\hat w_k$（對雜訊取期望）`)
    has('block $k$')
    has(String.raw`$\rho$（平均模型的 pole 半徑）`)
    has(String.raw`$\lambda_{\min} = \min_k \frac{1}{N}\sum u_x^2$`)
    has(String.raw`$\sigma_w$ 預測`)
    has(String.raw`$\mathcal{L}(f)$ [dBc/Hz]`)
    has(String.raw`$C_D = E[x_{\mathrm{ref}}^{(D)}\cdot u_x]$`)
    // 奇異值的類別軸：資料裡的字串不會套用 plotMath，所以用 tickvals／ticktext
    expect(strings).toContain(String.raw`$\sigma_{1}$`)
    expect(strings.filter((s) => /^\$\\sigma_\{\d+\}\$$/.test(s)).length).toBeGreaterThanOrEqual(3)
    // 模型自己組出來的 code 名稱含「±」：換成 \pm
    expect(strings).toContain(String.raw`Case C：iid $\pm$1`)
    expect(plotMath(String.raw`$\hat w_k$`)).toBe('<i>w\u0302</i><sub><i>k</i></sub>') // 帽子是 combining circumflex
    expect(plotMath(String.raw`$|H_{\mathrm{PD}}|^2$`)).toBe('|<i>H</i><sub>PD</sub>|<sup>2</sup>')
  })

  it('Plotly 圖例的游標與 case 名稱：用到的數字放在 `$...$` 裡', () => {
    expect(strings.some((s) => /^游標 \$k = \d+\$$/.test(s))).toBe(true)
    expect(strings.some((s) => /^Case [AB]：\$w_k\$$/.test(s))).toBe(true)
    expect(strings.some((s) => /^Case [A-C]（最佳 \$D = \d+\$）$/.test(s))).toBe(true)
  })
})
