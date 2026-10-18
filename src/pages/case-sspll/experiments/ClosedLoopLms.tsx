import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Data } from 'plotly.js-cartesian-dist-min'
import { Callout, ExperimentShell, ParamControl, Plot, SelectControl, mathText, useDebouncedValue, useThemeTokens, type CheckStatus, type ExperimentPreset, type MetricRow } from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import {
  analyseAlpha,
  eqOffset,
  gosOffsetBias,
  phosSteadyState,
  type LoopModels,
  type ResidualLine,
  type SspllLmsCase,
  type SspllLmsCompareSpectrumParams,
  type SspllLmsCompareSpectrumResult,
  type SspllLmsResult,
  type SspllLmsSpectrumResult,
  type SspllLoop,
  type SspllOutputSpectrum,
} from '@/simulation/models/sspll'
import { FREF_MHZ, LMS_NOTE_ZH, LOOPS, LOOP_LABEL, P_ONLY, PRED, SIM_CFG, type LmsTrace, type LoopKey } from '../data'
import { DataTable, fmtFs, fp, fx, tx, txs } from '../common'
import { hpdMemorySamples } from '../sections/S04MeanUpdate'

export const LMS_EXPERIMENT_ID = 'sspll-closed-loop'

/** PMUX 偏差 ε_k（params.json，golden 的 seed 7）的 rms [fs]：也是權重從 0 開始時 PHOS 誤差的初值 */
const EPS_RMS_FS = Math.sqrt(SIM_CFG.epsPs.reduce((a, e) => a + e * e, 0) / SIM_CFG.epsPs.length) * 1000

export type LmsCaseKind = 'off' | 'raw' | 'ac' | 'zm' | '1diff' | 'fx' | 'ponly-raw' | 'ponly-zm' | 'D1' | '2diff'

export const LMS_CASE_LABEL: Record<LmsCaseKind, string> = {
  off: '（不使用）',
  raw: 'raw',
  ac: 'ac（GOS 去平均）',
  zm: 'zm（GOS、PHOS 都去平均）',
  '1diff': '一階差分',
  fx: 'filtered-x（Ĥ = H）',
  'ponly-raw': 'P-only 迴路 + raw',
  'ponly-zm': 'P-only 迴路 + zm',
  D1: 'D = +1（有害）',
  '2diff': '二階差分（有害）',
}

/**
 * 同一組標籤的 `$...$` 版本：用在會經過 mathText 的地方（警告、指標名稱、表格）與 Plotly 圖例（`Plot` 會把 `$...$` 轉成斜體符號與上下標）。
 * 只有下拉選單的 <option> 不渲染公式，仍用上面的純文字版。
 */
export const LMS_CASE_TEX: Record<LmsCaseKind, string> = {
  ...LMS_CASE_LABEL,
  fx: 'filtered-x（$\\hat H=H$）',
  D1: '$D=+1$（有害）',
}

/** 警告與指標用的 case 標籤，例如「Case C（filtered-x（$\hat H=H$））」 */
export function lmsCaseTag(slot: string, kind: LmsCaseKind): string {
  return `Case ${slot}（${LMS_CASE_TEX[kind]}）`
}

export interface LmsParams {
  loop: LoopKey
  /** α·f_ref [MHz] */
  fMHz: number
  caseA: LmsCaseKind
  caseB: LmsCaseKind
  caseC: LmsCaseKind
  nBlocks: number
  nBlk: number
  tauBlocks: number
  /** 比較器 offset [fs] */
  uOsFs: number
  lanes: number
}

export const LMS_DEFAULTS: LmsParams = { loop: 'L2', fMHz: 80, caseA: 'raw', caseB: '1diff', caseC: 'fx', nBlocks: 1500, nBlk: 512, tauBlocks: 25, uOsFs: 0, lanes: 2 }
export const LMS_DEFAULT_SEED = 3

const KINDS = new Set<string>(Object.keys(LMS_CASE_LABEL))
/** 一次執行的總 sample 上限（避免瀏覽器卡住） */
export const LMS_MAX_SAMPLES = 6e7
/** 參數變更後自動重跑的總 sample 上限（超過時要按「執行 Run」） */
export const LMS_AUTO_RUN_SAMPLES = 6e6

export function mergeLmsParams(prev: LmsParams, raw: unknown): LmsParams {
  if (!raw || typeof raw !== 'object') return prev
  const o = raw as Record<string, unknown>
  const next = { ...prev }
  if (typeof o.loop === 'string' && ['L1', 'L2', 'L3'].includes(o.loop)) next.loop = o.loop as LoopKey
  if (typeof o.fMHz === 'number' && o.fMHz > 0 && o.fMHz < FREF_MHZ) next.fMHz = o.fMHz
  else if (typeof o.alpha === 'number' && o.alpha > 0 && o.alpha < 1) next.fMHz = o.alpha * FREF_MHZ
  for (const k of ['caseA', 'caseB', 'caseC'] as const) {
    const v = o[k]
    if (typeof v === 'string' && KINDS.has(v)) next[k] = v as LmsCaseKind
  }
  const int = (k: 'nBlocks' | 'nBlk' | 'lanes' | 'tauBlocks', lo: number, hi: number) => {
    const v = o[k]
    if (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi) next[k] = k === 'tauBlocks' ? v : Math.round(v)
  }
  int('nBlocks', 50, 20000)
  int('nBlk', 64, 4096)
  int('lanes', 1, 4)
  int('tauBlocks', 2, 500)
  if (typeof o.uOsFs === 'number' && Math.abs(o.uOsFs) <= 500) next.uOsFs = o.uOsFs
  return next
}

interface CaseSetup {
  loop: SspllLoop
  variant: string
  models?: LoopModels
  /** pred_vs_sim.json 的 lms key 後綴（沒有 golden 存檔時為 null） */
  goldenSuffix: string | null
}

/** Case 種類 → 等效迴路、變體名稱 */
export function lmsCaseSetup(loopKey: LoopKey, kind: LmsCaseKind): CaseSetup | null {
  const loop = LOOPS[loopKey]
  const ponly = loopKey === 'L2' ? P_ONLY.L2 : loopKey === 'L3' ? P_ONLY.L3 : loop
  switch (kind) {
    case 'off':
      return null
    case 'raw':
      return { loop, variant: 'raw', goldenSuffix: 'raw' }
    case 'ac':
      return { loop, variant: 'ac', goldenSuffix: 'ac' }
    case 'zm':
      return { loop, variant: 'zm', goldenSuffix: null }
    case '1diff':
      return { loop, variant: '1diff', goldenSuffix: '1diff' }
    case 'fx':
      return { loop, variant: 'fx:exact', models: { exact: loop }, goldenSuffix: 'fx:exact' }
    case 'ponly-raw':
      return { loop: ponly, variant: 'raw', goldenSuffix: 'raw|Ponly' }
    case 'ponly-zm':
      return { loop: ponly, variant: 'zm', goldenSuffix: null }
    case 'D1':
      return { loop, variant: 'D:1', goldenSuffix: 'D:1' }
    case '2diff':
      return { loop, variant: '2diff', goldenSuffix: '2diff' }
  }
}

/** golden（Python）存檔的閉迴路 LMS 軌跡：key 為 `${loop}|${alpha}|${suffix}` */
export function goldenTrace(loopKey: LoopKey, alpha: number, suffix: string | null): { key: string; trace: LmsTrace } | null {
  if (!suffix) return null
  for (const [key, trace] of Object.entries(PRED.lms)) {
    const parts = key.split('|')
    if (parts[0] !== loopKey || Math.abs(Number(parts[1]) - alpha) > 1e-9) continue
    if (parts.slice(2).join('|') === suffix) return { key, trace }
  }
  return null
}

/** golden 存檔（pred_vs_sim.json 的 lms）的執行條件：N = 512、N_τ = 25 blocks、沒有比較器 offset */
export const GOLDEN_LMS_COND = { nBlk: 512, tauBlocks: 25, uOsFs: 0 } as const

/** Monte Carlo 交叉比對的容許倍率：TS 與 golden 用不同的隨機數，PHOS rms 在同一個 block 相差不到這個倍數才算一致 */
export const LMS_MC_RATIO_TOL = 4

/** 凍結權重後再跑的拍數：65,536 = 128 個 N = 512 的 block（Welch 8192 點、Blackman–Harris、50% 重疊 ⇒ 15 段、Δf ≈ 0.49 MHz） */
export const LMS_TAIL = 65536
export const LMS_NPERSEG = 8192
/** spur 表每個 case 最多列幾條閉合式譜線（依輸出振幅） */
export const LMS_MAX_LINES = 8
/** 閉合式 vs toneFit 的容許差 [dB]（權重凍結後輸出是確定性的多音訊號，兩者只差數值誤差） */
export const SPUR_TOL_DB = 0.2
/** 小角 PM 的上限：一條 tone 的 Φ = 2π f_vco A_out 超過它就不報 dBc（殘差已是 ps 級：硬體上是 DTC 飽和） */
export const SPUR_PHI_MAX = 0.3
/** 穩態 PHOS rms 的量測 vs F-CS.23 的容許倍率（後半段的時間平均、2 條 lane：最慢模態只有十幾個有效樣本） */
export const STEADY_RMS_TOL = 0.5
/** 穩態比對只在模擬長度 ≥ 這麼多倍最慢模態的時間常數時才做（前半段丟掉、後半段至少 6 個時間常數） */
export const STEADY_MIN_TAU = 12

/** 譜線的來源標籤（`$...$` 版） */
export function lineLabel(l: ResidualLine): string {
  return l.source === 'phos' ? `PHOS mode ${l.mode}，$\\ell=${l.ell}$` : `GOS 諧波 $m=${l.mode}$`
}

/**
 * spur 表的一致性：閉合式（週期序列的精確 Fourier 係數，或無理數 α 的 ℓ 級數）vs toneFit，只比輸出振幅 ≥ 1% 最大線、而且 ≥ 0.01 fs 的線；
 * 回傳比對的線數與最大的 dB 差（沒有可比的線時 maxDb = 0）。
 */
export function spurAgreement(spec: SspllOutputSpectrum): { n: number; maxDb: number } {
  const aMax = spec.lines.length ? spec.lines[0].ampOutFs : 0
  let n = 0
  let maxDb = 0
  spec.lines.forEach((l, i) => {
    const fit = spec.toneFitFs[i]
    if (!(l.ampOutFs >= Math.max(0.01, 0.01 * aMax)) || !Number.isFinite(fit) || !(fit > 0)) return
    n++
    maxDb = Math.max(maxDb, Math.abs(20 * Math.log10(fit / l.ampOutFs)))
  })
  return { n, maxDb }
}

/**
 * 穩態 PHOS rms（量測：後半段所有 lane 的 rms² 平均）vs F-CS.23 的預測。
 * 只在沒有 offset、所有模態 |p_m| < 1、模擬長度 ≥ STEADY_MIN_TAU 倍最慢模態的時間常數、而且 PHOS 沒有發散時比對。
 */
export function steadyCheck(
  kappaM: { re: number; im: number }[],
  res: SspllLmsSpectrumResult,
  nBlk: number,
  nBlocks: number,
  uOsFs: number,
): { predFs: number; measFs: number; ratio: number; applicable: boolean; why: string; tauMax: number } {
  const ss = phosSteadyState(kappaM, res.muP, SIM_CFG.sigmaPs, nBlk, res.spectrum.regCov)
  const meas = res.spectrum.steadyPhosRmsFs
  const diverged = res.finalPhosRmsFs > 2 * res.initPhosRmsFs || res.aborted
  let why = ''
  if (uOsFs !== 0) why = '有比較器 offset：穩態還有 forcing 的偏差，不比對'
  else if (!ss.stable) why = '有模態 $\\lvert p_m\\rvert\\ge1$：沒有穩態'
  else if (diverged) why = 'PHOS 發散，沒有穩態'
  else if (nBlocks < STEADY_MIN_TAU * ss.tauMaxBlocks) why = `模擬長度 ${nBlocks} blocks 不到最慢模態時間常數（${ss.tauMaxBlocks.toFixed(0)} blocks）的 ${STEADY_MIN_TAU} 倍，後半段還沒進入穩態，不比對`
  return { predFs: ss.rmsFs, measFs: meas, ratio: meas / ss.rmsFs, applicable: why === '' && Number.isFinite(meas), why, tauMax: ss.tauMaxBlocks }
}

/**
 * 本頁即時模擬 vs golden 存檔：取 golden 有記錄、且不超過即時模擬長度的最後一個 block，
 * 比較兩者的 PHOS 誤差 rms（即時模擬取最接近該 block 的記錄點）。沒有可比的 block 時回傳 null。
 */
export function compareWithGolden(res: Pick<SspllLmsResult, 'block' | 'phosRmsFs'>, trace: LmsTrace): { block: number; liveFs: number; goldenFs: number; ratio: number } | null {
  const last = res.block[res.block.length - 1]
  let j = -1
  for (let i = 0; i < trace.blocks.length; i++) if (trace.blocks[i] > 0 && trace.blocks[i] <= last) j = i
  if (j < 0) return null
  let k = 0
  for (let i = 1; i < res.block.length; i++) if (Math.abs(res.block[i] - trace.blocks[j]) < Math.abs(res.block[k] - trace.blocks[j])) k = i
  const liveFs = res.phosRmsFs[k]
  const goldenFs = trace.phos_rms_med_fs[j]
  if (!(liveFs > 0) || !(goldenFs > 0)) return null
  return { block: trace.blocks[j], liveFs, goldenFs, ratio: liveFs / goldenFs }
}

/**
 * PHOS regressor 的總和 Σ_k r_k 的平均：one-hot 的和恆為 1，所以 raw／ac／D:k 為 1；
 * zero-mean 的 regressor（zm、一階／二階差分、filtered-x 的 Ĥ(1) = 0）為 0。它決定比較器 offset 對 PHOS 共模的 forcing。
 */
export function phosRegressorSum(variant: string): number {
  return variant === 'raw' || variant === 'ac' || variant.startsWith('D:') ? 1 : 0
}

/** GOS regressor 有沒有 DC（平均約 1/2）：raw 與 D:k 有；ac／zm 減掉了，差分與 filtered-x 天生沒有 */
export function gosRegressorHasDc(variant: string): boolean {
  return variant === 'raw' || variant.startsWith('D:')
}

/**
 * 比較器 offset 造成的 PHOS 共模漂移（公式 F-CS.19 的第 4 步）：每個 block 共模增加 μ_p·E[q]·Σ_k⟨r_k⟩/8，
 * 共模的恢復力 λ_0 = 0，所以 B 個 block 後累積 B·μ_p·E[q]·Σ/8。回傳預測值、容許誤差（15% + 雜訊 random walk 的 4σ）[fs]，
 * 以及這個小訊號公式是否適用：它用 E[q] = erf(u_os/(√2σ_v))，也就是假設 |e_PD| ≪ σ_v。u_os 不小時 raw 的 GOS 被推偏、
 * e_PD 變大，實際的 E[q] 比公式小（golden：u_os = 100 fs 時量到 10.5 ps，公式給 15.4 ps），所以只在 |u_os| ≤ σ_v/4 時拿來比對。
 */
export function predictCmDrift(variant: string, muPps: number, uOsFs: number, sigmaFs: number, nBlocks: number, nBlk: number): { predFs: number; tolFs: number; valid: boolean } {
  const perBlockFs = (muPps * 1000) / 8
  const predFs = Math.abs(nBlocks * perBlockFs * eqOffset(uOsFs, sigmaFs) * phosRegressorSum(variant))
  const rwFs = perBlockFs * Math.sqrt(nBlocks / nBlk) * phosRegressorSum(variant) // mean(q) 的標準差 ≈ 1/√N，B 個 block 累積
  return { predFs, tolFs: 0.15 * predFs + 4 * rwFs + 1, valid: Math.abs(uOsFs) <= sigmaFs / 4 }
}

/**
 * 小訊號平均模型對閉迴路的預測（有限步長）：沿 PHOS 的每個模態，誤差每個 block 乘上 1 − κ_m/N_τ,eff，
 * N_τ,eff = 8/(μ_p K_q) 是實際步長（含 NLMS 式正規化）對應的開迴路名義時間常數（步長的倒數）。
 * ρ = max_m |1 − κ_m/N_τ,eff|：ρ > 1 發散、ρ < 1 收斂；|ρ − 1| < 3/B 時模擬長度不到約 3 個時間常數（模態的實際值 −1/ln ρ），判為邊際（不比對）。
 */
export function predictPhosVerdict(kappaM: { re: number; im: number }[], muPps: number, sigmaPs: number, nBlocks: number): { rho: number; tauEff: number; verdict: 'diverge' | 'converge' | 'marginal' } {
  const tauEff = 8 / (muPps * (Math.sqrt(2 / Math.PI) / sigmaPs))
  let rho = 0
  for (const k of kappaM) rho = Math.max(rho, Math.hypot(1 - k.re / tauEff, k.im / tauEff))
  const margin = 3 / nBlocks
  return { rho, tauEff, verdict: rho > 1 + margin ? 'diverge' : rho < 1 - margin ? 'converge' : 'marginal' }
}

const SLOTS = ['A', 'B', 'C'] as const
type Slot = (typeof SLOTS)[number]

const INLINE_PRESETS: ExperimentPreset[] = [
  { name: 'L2、α = 0.02（80 MHz，帶內）：raw 發散 vs 1diff／fx 收斂', params: { ...LMS_DEFAULTS } },
  { name: 'L2、α = 0.002（8 MHz，dead zone）：raw 漂移、1diff 慢但收斂', params: { ...LMS_DEFAULTS, fMHz: 8, nBlocks: 3000 } },
  { name: 'L2、α = 0.496（alias 區）：raw 發散', params: { ...LMS_DEFAULTS, fMHz: 1984, nBlocks: 3000 } },
  { name: 'L3、α = 0.016（64 MHz）：raw 發散、P-only 收斂', params: { ...LMS_DEFAULTS, loop: 'L3', fMHz: 64, caseC: 'ponly-raw' } },
  { name: 'L1、α = 0.02：Type-I 用 raw 也收斂', params: { ...LMS_DEFAULTS, loop: 'L1', caseB: 'off', caseC: 'off' } },
  { name: 'L2、α = 0.137（帶外）：raw 正常、D = +1 與 2diff 把它弄壞', params: { ...LMS_DEFAULTS, fMHz: 548, caseA: 'raw', caseB: 'D1', caseC: '2diff' } },
  { name: 'L2、α = 0.137、比較器 offset 25 fs：raw 的共模漂移、zm／1diff 不漂', params: { ...LMS_DEFAULTS, fMHz: 548, caseA: 'raw', caseB: 'zm', caseC: '1diff', uOsFs: 25 } },
]

/**
 * 實驗 'sspll-closed-loop'（L3）：閉迴路 sign-error block LMS（真 1-bit 比較器），同一 α 與 seed 下比較最多三種 regressor／迴路。
 * 在 Web Worker 中執行 sspll.ts 的 runSspllLmsCompare（golden simulator.py 的 run_sign_lms 的 TS port）；
 * 虛線是 golden（Python、numpy RNG、6000 blocks × 2 lanes）存在 pred_vs_sim.json 的軌跡——兩者的隨機數不同，只能做統計上的比較。
 */
export function ClosedLoopLms() {
  const tokens = useThemeTokens()
  const [P, setP] = useState<LmsParams>(LMS_DEFAULTS)
  const [seed, setSeed] = useState(LMS_DEFAULT_SEED)
  const set = (patch: Partial<LmsParams>) => setP((prev) => ({ ...prev, ...patch }))

  const urlPreset = useUrlPreset(LMS_EXPERIMENT_ID)
  const applied = useRef<string | null>(null)
  useEffect(() => {
    if (urlPreset && applied.current !== urlPreset.id) {
      applied.current = urlPreset.id
      setP((prev) => mergeLmsParams(prev, urlPreset.params))
      const s = (urlPreset.params as Record<string, unknown>).seed
      if (typeof s === 'number') setSeed(s)
    }
  }, [urlPreset])
  const presets: ExperimentPreset[] = useMemo(
    () => [...presetsForExperiment(LMS_EXPERIMENT_ID).map((p) => ({ name: p.title, params: p.params, description: p.description })), ...INLINE_PRESETS],
    [],
  )

  const alpha = P.fMHz / FREF_MHZ
  // 小訊號預測的前提（§4.2 的時間尺度分離）：LMS 的名義時間常數 N·N_τ [拍] 要遠大於主迴路 h_PD 的記憶長度（標稱迴路 14／40／49 拍）
  const hpdMem = useMemo(() => hpdMemorySamples(LOOPS[P.loop]), [P.loop])
  const lmsSamples = P.nBlk * P.tauBlocks
  // golden 存檔只在相同的執行條件下才可比（否則不疊圖、也不做 Monte Carlo 交叉比對）
  const goldenComparable = P.nBlk === GOLDEN_LMS_COND.nBlk && P.tauBlocks === GOLDEN_LMS_COND.tauBlocks && P.uOsFs === GOLDEN_LMS_COND.uOsFs
  const cases = useMemo(() => {
    const kinds: Record<Slot, LmsCaseKind> = { A: P.caseA, B: P.caseB, C: P.caseC }
    return SLOTS.flatMap((slot, i) => {
      const kind = kinds[slot]
      const setup = lmsCaseSetup(P.loop, kind)
      if (!setup) return []
      // 小訊號預測（ergodic）：κ_PHOS，以及 GOS 的 12·C_GOS（pred.kappaGos 是固定乘 12 的值；var(ρ) = 1/12 時才等於 κ_GOS = C_GOS/var(ρ)，
      // 例如 α = 1/16 時 12C = 0.886 而 κ_GOS = 1.181——所以畫面上標成 12C_GOS，不標成 κ_GOS）
      const pred = analyseAlpha(setup.loop, alpha, setup.variant === 'ac' || setup.variant === 'zm' ? 'raw' : setup.variant, setup.models, 2048)
      return [{ slot, kind, setup, pred, golden: goldenComparable ? goldenTrace(P.loop, alpha, setup.goldenSuffix) : null, colorIndex: i }]
    })
  }, [P.loop, P.caseA, P.caseB, P.caseC, alpha, goldenComparable])

  // 每個 case：lanes 條 lane 各跑 settle + nBlocks 個 block，再加凍結後的尾段 LMS_TAIL 拍（只有 lane 0）
  const totalSamples = cases.length * (P.lanes * (4096 + P.nBlocks * P.nBlk) + LMS_TAIL)
  const task = useWorkerTask<SspllLmsCompareSpectrumParams, SspllLmsCompareSpectrumResult>('sspll', 'runSspllLmsCompareSpectrum', { restartOnRun: true })
  const [run, setRun] = useState<{ key: string; result: SspllLmsCompareSpectrumResult; ms: number | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const runKey = JSON.stringify({ P, seed })
  const runTask = task.run
  const onRun = useCallback(() => {
    if (cases.length === 0 || totalSamples > LMS_MAX_SAMPLES) return
    const params: SspllLmsCompareSpectrumParams = {
      common: { alpha, cfg: SIM_CFG, nBlocks: P.nBlocks, nBlk: P.nBlk, tauBlocks: P.tauBlocks, seed, recEvery: Math.max(1, Math.round(P.nBlocks / 150)), lanes: P.lanes, uOsPs: P.uOsFs / 1000, seq: 'acc32', nTail: LMS_TAIL, nperseg: LMS_NPERSEG, maxLines: LMS_MAX_LINES },
      cases: cases.map((c): SspllLmsCase => ({ id: c.slot, loop: c.setup.loop, variant: c.setup.variant, models: c.setup.models })),
    }
    const key = runKey
    const t0 = Date.now()
    setError(null)
    runTask(params).then(
      (result) => setRun({ key, result, ms: Date.now() - t0 }),
      (e: unknown) => {
        if (!isWorkerCancelled(e)) setError(e instanceof Error ? e.message : String(e))
      },
    )
  }, [cases, totalSamples, alpha, P, seed, runKey, runTask])

  // 參數穩定 0.5 秒後自動重跑（Web Worker；總 sample 數不大時才自動跑）
  const settledKey = useDebouncedValue(runKey, 500)
  const lastAuto = useRef<string | null>(null)
  useEffect(() => {
    if (settledKey !== runKey || lastAuto.current === runKey) return
    if (totalSamples > LMS_AUTO_RUN_SAMPLES) return
    lastAuto.current = runKey
    onRun()
    // dev 的 StrictMode 會把 effect 先清理再跑一次：useWorkerTask 的清理把第一次的計算取消了（結果永遠不會回來），
    // 所以清理時解除這把鎖，重新掛載後同一組參數再跑一次。正常使用時參數一變 runKey 就變，不會重複跑。
    return () => {
      if (lastAuto.current === runKey) lastAuto.current = null
    }
  }, [settledKey, runKey, totalSamples, onRun])

  const fresh = run !== null && run.key === runKey
  const resultOf = (slot: Slot) => (fresh ? (run.result.cases.find((c) => c.id === slot)?.result ?? null) : null)

  // ── 警告 ──
  const warnings: string[] = []
  if (error) warnings.push(`模擬錯誤：${error}`)
  if (totalSamples > LMS_MAX_SAMPLES) warnings.push(`總 sample 數 ${totalSamples.toLocaleString()} 超過上限 ${LMS_MAX_SAMPLES.toLocaleString()}：請減少 block 數、N、lane 數或比較組，否則不會執行。`)
  else if (totalSamples > LMS_AUTO_RUN_SAMPLES && !fresh)
    warnings.push(`總 sample 數 ${totalSamples.toLocaleString()} 超過自動重跑上限 ${LMS_AUTO_RUN_SAMPLES.toLocaleString()}：請按「執行 Run」。`)
  const deltaFs = SIM_CFG.deltaPs * 1000
  const sigmaFs = SIM_CFG.sigmaPs * 1000
  const eq = eqOffset(P.uOsFs, sigmaFs)
  /** 比較器 offset 下 raw GOS 的穩態偏差公式值 [fs]（F-CS.19）；不適用時為 null */
  const gosBiasOf = (c: (typeof cases)[number]): number | null => {
    if (P.uOsFs === 0 || !gosRegressorHasDc(c.setup.variant) || c.pred.beta === 0 || !(c.pred.kappaGos > 1e-3)) return null
    return gosOffsetBias(c.pred.kappaGos / 12, 0.5, P.uOsFs, sigmaFs)
  }
  /** 發散原因的說明（接在「小訊號預測 κ_PHOS = …」之後） */
  const divergenceWhy = (c: (typeof cases)[number], res: SspllLmsResult): string => {
    const k = c.pred.kappaPhos
    if (k < -1e-2) return '$<0$：regressor 的功率落在 $\\mathrm{Re}\\,\\Gamma_{\\rm eff}<0$ 的頻率，平均梯度反號，誤差沿該模態指數成長（減小步長只會變慢，不會變號）'
    if (k < -1e-3) return '$<0$，但 $\\lvert\\kappa_{PHOS}\\rvert<10^{-2}$：alias／近整數的 dead zone 等級——平均梯度方向是錯的，只是很弱；誤差被雜訊推大後由大訊號反向（1-bit 比較器看「持續時間」）接手放大'
    if (k <= 1e-3) return '（dead zone：小訊號幾乎沒有恢復力，誤差被雜訊推大後進入大訊號反向區）'
    const v = predictPhosVerdict(c.pred.kappaM, res.muP, SIM_CFG.sigmaPs, P.nBlocks)
    if (v.rho >= 1)
      return `$>0$，但有限步長判據不成立：$\\max_m\\lvert1-\\kappa_m/N_{\\tau,\\mathrm{eff}}\\rvert=${v.rho.toFixed(4)}\\ge1$（實際步長對應 $N_{\\tau,\\mathrm{eff}}=${fx(v.tauEff, 1)}$ blocks），也就是 $\\mathrm{Re}\\,\\kappa\\le\\lvert\\kappa\\rvert^2/(2N_\\tau)$，block 更新振盪發散；請加大 $N_\\tau$`
    return '$>0$，小訊號預測應該收斂——發散來自線性分析以外的機制：GOS 先發散把殘差推大、比較器 offset，或誤差進入大訊號反向區'
  }
  for (const c of cases) {
    const res = resultOf(c.slot)
    if (!res) continue
    const tag = lmsCaseTag(c.slot, c.kind)
    const phosDiverged = res.finalPhosRmsFs > 2 * res.initPhosRmsFs || res.aborted
    if (phosDiverged)
      warnings.push(
        `${tag}不收斂：PHOS 誤差 rms 由 ${fx(res.initPhosRmsFs, 1)} fs 變成 ${fp(res.finalPhosRmsFs, 4)} fs。小訊號預測 $\\kappa_{PHOS}=${Math.abs(c.pred.kappaPhos) < 1e-3 ? txs(c.pred.kappaPhos, 3) : c.pred.kappaPhos.toFixed(4)}$${divergenceWhy(c, res)}。超過 $\\Delta=T_{vco}/8=${fx(deltaFs, 0)}$ fs 的值來自無界的線性模型——硬體上是 DTC 飽和、SSPD cycle slip 或失鎖。`,
      )
    // PHOS 共模：offset 的 forcing（共模的恢復力 λ_0 = 0）
    if (P.uOsFs !== 0 && phosRegressorSum(c.setup.variant) !== 0 && res.finalPhosCmFs > 50) {
      const d = predictCmDrift(c.setup.variant, res.muP, P.uOsFs, sigmaFs, P.nBlocks, P.nBlk)
      warnings.push(
        `${tag}的 PHOS 共模漂移到 ${fp(res.finalPhosCmFs, 4)} fs，而且還在繼續：one-hot regressor 的和恆為 1（每一條的平均是 1/8），比較器 offset 讓 $E[q]=\\mathrm{erf}(u_{os}/\\sqrt2\\sigma_v)=${eq.toFixed(4)}\\ne0$，成為與誤差無關的 forcing 項；共模的恢復力 $\\lambda_0=0$，所以每個 block 累積 $\\mu_pE[q]/8$（${d.valid ? '預測' : '小 offset 公式的估計；$u_{os}$ 不小時實際的 $E[q]$ 較小，這是上限：'} ${fp(d.predFs, 4)} fs）。$\\mathrm{eig}(C)$ 看不到這件事；改用 zero-mean regressor（zm、一階差分）。`,
      )
    }
    // GOS：offset 造成的偏差，或梯度反號
    const gos0 = res.gosAbsFs[0]
    const bias = gosBiasOf(c)
    if (bias !== null && res.finalGosFs > 50)
      warnings.push(
        `${tag}的 GOS 被比較器 offset 推偏：最終 $\\lvert$GOS 誤差$\\rvert$ 為 ${fp(res.finalGosFs, 4)} fs。raw 的 $\\rho$ 平均約 $\\tfrac12$，$E[q]\\ne0$ 的 forcing 把穩態推到 $\\delta^\\star_{GOS}=-E[q]\\langle\\rho\\rangle/(K_q(u_{os})C_{GOS})=${bias.toFixed(1)}$ fs（線性公式）；改用 ac／zm 或一階差分。`,
      )
    else if (res.finalGosFs > Math.max(2 * gos0, 50)) {
      const why =
        c.pred.beta !== 0 && c.pred.kappaGos < -1e-3
          ? `小訊號預測 $12\\,C_{GOS}=${c.pred.kappaGos.toFixed(4)}<0$（$\\kappa_{GOS}=C_{GOS}/\\mathrm{var}(\\rho)$ 與它同號）：鋸齒 regressor 的平均梯度反號`
          : phosDiverged
            ? 'PHOS 發散後 PD 的殘差被它主導，GOS 的更新失去意義'
            : `小訊號預測 $12\\,C_{GOS}=${c.pred.beta === 0 ? '0' : txs(c.pred.kappaGos, 3)}$：near-grid 的 dead zone、比較器 offset 或大訊號反向`
      warnings.push(`${tag}的 GOS 不收斂：$\\lvert$GOS 誤差$\\rvert$ 由 ${fx(gos0, 1)} fs 變成 ${fp(res.finalGosFs, 4)} fs。${why}。`)
    }
  }

  // 凍結後的輸出：最強的線的 Φ ≥ 0.3 rad（還沒被判成發散的 case）：小角 PM 不成立，dBc 沒有意義
  for (const c of cases) {
    const res = resultOf(c.slot)
    if (!res || res.finalPhosRmsFs > 2 * res.initPhosRmsFs || res.aborted) continue
    const top = res.spectrum.lines[0]
    if (top && top.betaRad >= SPUR_PHI_MAX)
      warnings.push(
        `${lmsCaseTag(c.slot, c.kind)}凍結後最強的輸出 tone（${fx(top.fMHz, 1)} MHz）的峰值相位 $\\Phi=2\\pi f_{vco}A_{out}=${fx(top.betaRad, 3)}$ rad $\\ge${SPUR_PHI_MAX}$：小角 PM 不成立，spur 表的 dBc 只能當參考（硬體上 $A_{out}=${fp(top.ampOutFs, 4)}$ fs 已接近 DTC range）。`,
      )
  }

  // ── 指標 ──
  const metrics: MetricRow[] = [
    { name: '$\\alpha$', value: alpha, digits: 6, note: `PMUX 旋轉頻率 ${fx(Math.min(P.fMHz, FREF_MHZ - P.fMHz), 2)} MHz` },
    { name: '總 sample 數（含 settle 與凍結後的尾段）', value: totalSamples, digits: 9, note: `尾段：每個 case 凍結權重後再跑 ${LMS_TAIL.toLocaleString()} 拍（${LMS_TAIL / P.nBlk} 個 block 的長度）` },
  ]
  if (P.uOsFs !== 0) metrics.push({ name: '比較器 offset 的 $E[q]=\\mathrm{erf}(u_{os}/\\sqrt2\\sigma_v)$', value: eq, digits: 4, formulaId: 'F-CS.19', claim: 'exact', note: '與權重誤差無關的 forcing 項' })
  for (const c of cases) {
    const res = resultOf(c.slot)
    const tag = lmsCaseTag(c.slot, c.kind)
    const cmp = res && c.golden ? compareWithGolden(res, c.golden.trace) : null
    metrics.push({
      name: `${tag}：小訊號預測的 $\\kappa_{PHOS}$`,
      value: c.pred.kappaPhos,
      digits: 4,
      formulaId: 'F-CS.13',
      note: `${c.pred.kappaPhos < -1e-3 ? '預測：PHOS 反號' : c.pred.kappaPhos > 1e-3 ? '預測：PHOS 收斂' : '預測：dead zone'}；GOS 的 $12\\,C_{GOS}=${c.pred.beta === 0 ? '\\text{—}' : txs(c.pred.kappaGos, 4)}$（ergodic，固定乘 12；§7.1）`,
    })
    if (res) {
      const v = predictPhosVerdict(c.pred.kappaM, res.muP, SIM_CFG.sigmaPs, P.nBlocks)
      metrics.push({
        name: `${tag}：有限步長的平均模型 $\\max_m\\lvert1-\\kappa_m/N_{\\tau,\\mathrm{eff}}\\rvert$`,
        value: v.rho,
        digits: 5,
        formulaId: 'F-CS.18',
        note: `$N_{\\tau,\\mathrm{eff}}=8/(\\mu_pK_q)=${fx(v.tauEff, 1)}$ blocks（含 regressor 功率正規化）；${v.verdict === 'diverge' ? '$>1$：預測發散' : v.verdict === 'converge' ? '$<1$：預測收斂' : '$\\approx1$：邊際（dead zone，或模擬長度不到約 3 個時間常數）'}`,
      })
    }
    metrics.push({
      name: `${tag}：最終 PHOS 誤差 rms`,
      value: res ? res.finalPhosRmsFs : '尚未執行',
      unit: 'fs',
      digits: 4,
      note: `${res ? `初始 ${fx(res.initPhosRmsFs, 1)} fs；最大 ${fp(res.maxPhosRmsFs, 4)} fs` : ''}${c.golden ? `${res ? '；' : ''}golden（${c.golden.trace.blocks[c.golden.trace.blocks.length - 1]} blocks）：${fp(c.golden.trace.final_phos_rms_fs, 4)} fs` : ''}`,
    })
    if (cmp) {
      const within = cmp.ratio <= LMS_MC_RATIO_TOL && cmp.ratio >= 1 / LMS_MC_RATIO_TOL
      metrics.push({
        name: `${tag}：第 ${cmp.block} block 的 PHOS rms，即時／golden 存檔的比值`,
        value: cmp.ratio,
        digits: 3,
        note: `即時 ${fp(cmp.liveFs, 4)} fs、golden ${fp(cmp.goldenFs, 4)} fs；隨機數不同，比值在 1/${LMS_MC_RATIO_TOL}–${LMS_MC_RATIO_TOL} 之間算一致：${within ? '一致' : '不一致'}`,
      })
    }
    if (res) {
      const bias = gosBiasOf(c)
      const drift = P.uOsFs !== 0 ? predictCmDrift(c.setup.variant, res.muP, P.uOsFs, sigmaFs, P.nBlocks, P.nBlk) : null
      metrics.push(
        {
          name: `${tag}：最終 $\\lvert$GOS 誤差$\\rvert$`,
          value: res.finalGosFs,
          unit: 'fs',
          digits: 4,
          note: `${c.golden ? `golden：${fp(c.golden.trace.final_gos_fs, 4)} fs` : ''}${bias !== null ? `offset 的線性公式：$\\lvert\\delta^\\star_{GOS}\\rvert=${Math.abs(bias).toFixed(1)}$ fs` : ''}` || undefined,
        },
        {
          name: `${tag}：最終 $\\lvert$PHOS 共模$\\rvert$`,
          value: res.finalPhosCmFs < 1e-9 ? 0 : res.finalPhosCmFs, // zero-mean regressor：共模完全不動（只剩浮點捨入）
          unit: 'fs',
          digits: 4,
          ...(drift && drift.valid && !(res.finalPhosRmsFs > 2 * res.initPhosRmsFs) ? { analytic: drift.predFs, tolerance: drift.tolFs, toleranceMode: 'abs' as const, formulaId: 'F-CS.19' } : {}),
          note: `步長 $\\mu_p=${txs(res.muP, 4)}$ ps、$\\mu_g=${txs(res.muG, 4)}$${drift ? (drift.valid ? '；解析值：$B\\,\\mu_p\\,E[q]\\,\\sum_k\\langle r_k\\rangle/8$' : '；$\\lvert u_{os}\\rvert>\\sigma_v/4$：小 offset 的漂移公式不適用，不比對') : ''}`,
        },
      )
      // 凍結後的輸出：最強的 fractional spur（閉合式 vs toneFit）與積分 jitter
      const sp = res.spectrum
      const top = sp.lines[0]
      if (top) {
        const agree = spurAgreement(sp)
        const small = top.betaRad < SPUR_PHI_MAX
        metrics.push({
          // 小角 PM 不成立（Φ ≥ 0.3 rad：發散的 case）時不報 dBc，改報那條線的峰值相位 Φ
          name: small ? `${tag}：凍結後最強的 fractional spur（閉合式）` : `${tag}：凍結後最強的線的峰值相位 $\\Phi=2\\pi f_{vco}A_{out}$（$\\ge${SPUR_PHI_MAX}$ rad：小角 PM 不成立，不報 dBc）`,
          value: small ? top.spurDbc : top.betaRad,
          unit: small ? 'dBc' : 'rad',
          digits: 4,
          formulaId: 'F-CS.21',
          claim: 'approx',
          note: `在 ${fx(top.fMHz, 1)} MHz（${lineLabel(top)}；$\\lvert T\\rvert=${fx(top.tMag, 3)}$，$A_{out}=${fp(top.ampOutFs, 4)}$ fs）；toneFit ${Number.isFinite(sp.toneFitDbc[0]) ? `${fx(sp.toneFitDbc[0], 2)} dBc` : '—'}；${agree.n} 條線的閉合式 vs toneFit 最大差 ${fx(agree.maxDb, 3)} dB`,
        })
        metrics.push({
          name: `${tag}：凍結後的輸出積分 jitter（時域 rms）`,
          value: sp.jitterTimeFs,
          unit: 'fs',
          digits: 4,
          analytic: sp.jitterClosedFs,
          tolerance: 0.02,
          toleranceMode: 'rel',
          formulaId: 'F-CS.21',
          claim: 'approx',
          note: `解析值：閉合式譜線的 $\\sqrt{\\sum A_{out}^2/2}$（$\\lvert\\ell\\rvert\\le2048$、$m\\le2048$）；Welch 積分 ${fp(sp.jitterWelchFs, 4)} fs；注入點 PHOS 殘差 rms ${fx(Math.sqrt(Array.from(sp.phosResidualFs).reduce((a2, v, _i, arr) => a2 + (v - arr.reduce((x, y) => x + y, 0) / arr.length) ** 2, 0) / 8), 2)} fs、$\\lvert$GOS 誤差$\\rvert$ ${fx(sp.gosErrFs, 2)} fs`,
        })
      }
      // 穩態 PHOS rms（校準還在跑時的權重雜訊）vs F-CS.23
      const st = steadyCheck(c.pred.kappaM, res, P.nBlk, P.nBlocks, P.uOsFs)
      metrics.push({
        name: `${tag}：穩態 PHOS rms（block ${sp.steadyBlocks[0]}–${sp.steadyBlocks[1]}、所有 lane 的 rms² 平均）`,
        value: Number.isFinite(st.measFs) ? st.measFs : '—',
        unit: 'fs',
        digits: 3,
        formulaId: 'F-CS.23',
        claim: 'approx',
        ...(st.applicable ? { analytic: st.predFs, tolerance: STEADY_RMS_TOL, toleranceMode: 'rel' as const } : {}),
        note: st.applicable
          ? `解析值：F-CS.23 的 $\\sqrt{\\sum_{m=1}^{7}\\sigma^2_{\\theta,m}}$（$N_{\\tau,\\mathrm{eff}}$、該 regressor 的 $S_m$ 與 $\\kappa_m$）；最慢模態的時間常數 ${fx(st.tauMax, 0)} blocks；容許 ${STEADY_RMS_TOL * 100}%（後半段只有十幾個有效樣本）`
          : `F-CS.23 預測 ${Number.isFinite(st.predFs) ? `${fx(st.predFs, 3)} fs` : '—'}；${st.why}`,
      })
    }
  }

  // ── 交叉比對 ──
  // Analytic：(1) 無 offset 時，小訊號平均模型（有限步長判據）vs 閉迴路是否發散；(2) 有 offset 時，PHOS 共模漂移 vs forcing 公式
  let analytic: CheckStatus = 'n/a'
  let analyticNote = '即時模擬尚未完成'
  if (fresh) {
    let checked = 0
    let bad = 0
    let marginal = 0
    for (const c of cases) {
      const res = resultOf(c.slot)
      if (!res) continue
      if (P.uOsFs === 0) {
        const v = predictPhosVerdict(c.pred.kappaM, res.muP, SIM_CFG.sigmaPs, P.nBlocks)
        if (v.verdict === 'marginal') {
          marginal++
          continue
        }
        checked++
        if (res.finalPhosRmsFs > res.initPhosRmsFs !== (v.verdict === 'diverge')) bad++
      } else if (!(res.finalPhosRmsFs > 2 * res.initPhosRmsFs)) {
        const d = predictCmDrift(c.setup.variant, res.muP, P.uOsFs, sigmaFs, P.nBlocks, P.nBlk)
        if (!d.valid) continue
        checked++
        if (Math.abs(res.finalPhosCmFs - d.predFs) > d.tolFs) bad++
      }
    }
    // 凍結後的 spur 表：閉合式 vs toneFit；穩態 PHOS rms vs F-CS.23（適用時）
    let spurLines = 0
    let spurBad = 0
    let spurMaxDb = 0
    let stChecked = 0
    let stBad = 0
    for (const c of cases) {
      const res = resultOf(c.slot)
      if (!res) continue
      const a = spurAgreement(res.spectrum)
      spurLines += a.n
      spurMaxDb = Math.max(spurMaxDb, a.maxDb)
      if (a.maxDb > SPUR_TOL_DB) spurBad++
      const st = steadyCheck(c.pred.kappaM, res, P.nBlk, P.nBlocks, P.uOsFs)
      if (st.applicable) {
        stChecked++
        if (Math.abs(st.ratio - 1) > STEADY_RMS_TOL) stBad++
      }
    }
    const extra = `；凍結後的 spur 表：${spurLines} 條線的閉合式 vs toneFit 最大差 ${fx(spurMaxDb, 3)} dB（門檻 ${SPUR_TOL_DB}；${spurBad} 個 case 超出）；穩態 PHOS rms vs F-CS.23：${stChecked} 個比對、${stBad} 個不一致`
    analytic = checked + spurLines + stChecked === 0 ? 'n/a' : bad + spurBad + stBad === 0 ? 'ok' : 'mismatch'
    analyticNote =
      (P.uOsFs === 0
        ? `小訊號平均模型 $\\max_m\\lvert1-\\kappa_m/N_{\\tau,\\mathrm{eff}}\\rvert\\gtrless1$ vs 閉迴路的 PHOS 誤差是否變大：${checked} 個比對、${bad} 個不一致${marginal ? `；${marginal} 個是邊際（dead zone，或模擬長度不到約 3 個時間常數），不比對` : ''}`
        : checked === 0
          ? 'offset 的共模漂移公式只在 $\\lvert u_{os}\\rvert\\le\\sigma_v/4$（小訊號）時適用；目前沒有可比對的 case'
          : `PHOS 共模漂移 vs forcing 公式 $B\\,\\mu_p\\,E[q]\\sum_k\\langle r_k\\rangle/8$（${checked} 個比對、${bad} 個不一致）`) + extra
  }
  // Monte Carlo：本頁即時模擬 vs golden（Python）存檔的軌跡，在同一個 block 比 PHOS rms
  let mc: CheckStatus = 'n/a'
  let mcNote = '即時模擬尚未完成：目前只顯示 golden 存檔'
  if (fresh) {
    if (!goldenComparable) mcNote = `目前的設定與 golden 存檔的條件（$N=${GOLDEN_LMS_COND.nBlk}$、$N_\\tau=${GOLDEN_LMS_COND.tauBlocks}$、無 offset）不同，沒有可比的參考`
    else {
      let checked = 0
      let bad = 0
      for (const c of cases) {
        const res = resultOf(c.slot)
        const cmp = res && c.golden ? compareWithGolden(res, c.golden.trace) : null
        if (!cmp) continue
        checked++
        if (cmp.ratio > LMS_MC_RATIO_TOL || cmp.ratio < 1 / LMS_MC_RATIO_TOL) bad++
      }
      mc = checked === 0 ? 'n/a' : bad === 0 ? 'ok' : 'mismatch'
      mcNote =
        checked === 0
          ? '這組（迴路、$\\alpha$、regressor）沒有 golden 存檔，或 block 數不到 200'
          : `即時模擬（${run?.ms ?? '—'} ms，${task.mode}）vs golden 存檔在同一個 block 的 PHOS rms：${checked} 個 case、${bad} 個超出 ${LMS_MC_RATIO_TOL} 倍`
    }
  }

  // ── 圖 ──
  const traces = useMemo(() => {
    const phos: Data[] = []
    const gos: Data[] = []
    for (const c of cases) {
      const color = tokens.series[c.colorIndex]
      const res = fresh ? (run.result.cases.find((x) => x.id === c.slot)?.result ?? null) : null
      const name = `Case ${c.slot}：${LMS_CASE_TEX[c.kind]}` // 圖例支援 `$...$`（Plot 會轉成斜體符號與上下標）
      if (res) {
        phos.push({ x: res.block, y: res.phosRmsFs, name: `${name}（TS，即時）`, mode: 'lines', line: { color, width: 2.2 } })
        gos.push({ x: res.block, y: res.gosAbsFs, name: `${name}（TS，即時）`, mode: 'lines', line: { color, width: 2.2 } })
      }
      if (c.golden) {
        phos.push({ x: c.golden.trace.blocks, y: c.golden.trace.phos_rms_med_fs, name: `${name}（golden 存檔）`, mode: 'lines+markers', marker: { size: 4 }, line: { color, dash: 'dot', width: 1.4 } })
        gos.push({ x: c.golden.trace.blocks, y: c.golden.trace.gos_med_fs, name: `${name}（golden 存檔）`, mode: 'lines+markers', marker: { size: 4 }, line: { color, dash: 'dot', width: 1.4 } })
      }
    }
    if (phos.length) {
      const xs = phos.flatMap((t) => Array.from((t as { x: ArrayLike<number> }).x))
      const xMax = Math.max(...xs)
      phos.push({ x: [0, xMax], y: [deltaFs, deltaFs], name: '$\\Delta=T_{\\mathrm{vco}}/8$（DTC 範圍；之上為飽和／失鎖）', mode: 'lines', line: { color: tokens.textMuted, dash: 'dash', width: 1 } })
    }
    // 凍結後的輸出 fractional spur：閉合式（×）與 Welch + findTones 找到的線（○）
    const spur: Data[] = []
    for (const c of cases) {
      const color = tokens.series[c.colorIndex]
      const res = fresh ? (run.result.cases.find((x) => x.id === c.slot)?.result ?? null) : null
      if (!res) continue
      const sp = res.spectrum
      const name = `Case ${c.slot}：${LMS_CASE_TEX[c.kind]}`
      spur.push({
        x: sp.lines.map((l) => l.fMHz),
        y: sp.lines.map((l) => l.spurDbc),
        text: sp.lines.map((l) => `${lineLabel(l)}：$A_{out}=${fp(l.ampOutFs, 4)}$ fs`),
        name: `${name}（閉合式）`,
        mode: 'markers',
        marker: { color, size: 11, symbol: 'x' },
        hovertemplate: '%{text}<br/>%{x:.2f} MHz，%{y:.1f} dBc<extra></extra>',
      })
      spur.push({
        x: sp.detected.map((d) => d.fMHz),
        y: sp.detected.map((d) => d.spurDbc),
        name: `${name}（Welch + findTones）`,
        mode: 'markers',
        marker: { color, size: 9, symbol: 'circle-open', line: { width: 1.5 } },
        hovertemplate: '%{x:.2f} MHz，%{y:.1f} dBc<extra></extra>',
      })
    }
    return { phos, gos, spur }
  }, [cases, fresh, run, tokens, deltaFs])

  const goldenRows = cases.filter((c) => c.golden)

  return (
    <ExperimentShell
      id={LMS_EXPERIMENT_ID}
      title="實驗 C：閉迴路 sign-error LMS（真 1-bit 比較器）——發散與收斂"
      level="L3"
      claim="approx"
      source="simulation"
      seed={seed}
      onSeedChange={setSeed}
      description={
        <>
          在 Web Worker 裡跑時域模擬（<code>runSspllLmsCompare</code>，<code>simulator.py</code> 的 TS port；參數改變後自動重跑，也可以按「執行 Run」）。不同對策<strong>只差在 GMAC 用的 regressor</strong>（或把迴路換成 P-only）。虛線是 golden（Python）存在 <code>pred_vs_sim.json</code> 的軌跡：兩邊的隨機數產生器不同，只能做統計上的比較。
        </>
      }
      assumptions={[
        '每個 reference cycle 一步；32-bit 一階累加器；物理注入模型 $u=\\rho\\Delta+\\varepsilon_p-(1-a)(1+w_g)(\\rho\\Delta+w_p)$',
        `插圖值：$\\sigma_v=${fx(SIM_CFG.sigmaPs * 1000, 0)}$ fs、$\\Delta=T_{vco}/8=${SIM_CFG.deltaPs}$ ps（$f_{vco}=16$ GHz）、$a=${SIM_CFG.a}$、$\\varepsilon_k$ 取 golden 的 seed 7（rms ${fx(EPS_RMS_FS, 0)} fs）`,
        '步長以 $N_\\tau$ 設定：raw regressor 時 $\\mu_p=8/(N_\\tau K_q)$，開迴路（$H\\equiv1$、$\\kappa=1$，也就是 PMUX 的 8 個相位被選到的次數一樣多）每個 block 把 PHOS 誤差乘上 $1-1/N_\\tau$（$N_\\tau$ 是名義時間常數，見 §12）；其他 regressor 再對功率做 NLMS 式正規化；權重初值為 0',
        `小訊號預測（$\\kappa_{PHOS}$、$12\\,C_{GOS}$、有限步長的平均模型）用到 §4.2 的兩個前提：Bussgang 小訊號（$\\lvert e_{PD}\\rvert\\ll\\sigma_v$），以及 LMS 比主迴路慢很多（時間尺度分離）。目前名義時間常數 $N\\cdot N_\\tau=${Math.round(lmsSamples)}$ 拍，是 ${P.loop} 的 $h_{PD}$ 記憶長度（${hpdMem} 拍）的 $${tx(lmsSamples / hpdMem, lmsSamples / hpdMem < 10 ? 1 : 0)}$ 倍；把 $N$ 與 $N_\\tau$ 調得很小時這個前提不成立，預測只能當參考。時域模擬照實際順序計算（先乘、再通過迴路），不用這兩個近似`,
        '線性、無界的 SSPD 與無限的 DTC range：ps 級的「發散值」在硬體上是飽和／cycle slip／失鎖',
        '比較器除指定的 $u_{os}$ 外沒有 offset；沒有 DTC INL、字長、FLL 等效應；沒有 fixed-point 模型（Fixed-Point 交叉比對未實作）',
        `golden 存檔的條件：$N=${GOLDEN_LMS_COND.nBlk}$、$N_\\tau=${GOLDEN_LMS_COND.tauBlocks}$、無 offset、6000 blocks $\\times$ 2 lanes；設定不同時不疊圖、不比對`,
        'TS 與 golden 使用不同的隨機數產生器（xoshiro128** vs numpy PCG64）：逐點數值不會相同',
        `凍結後的輸出（§15.4）：模擬結束後把 lane 0 的權重凍結（LMS 關閉、不再抽雜訊）再跑 ${LMS_TAIL.toLocaleString()} 拍（${LMS_TAIL / P.nBlk} 個 block 的長度），輸出 $y=T*u=u-e_{PD}$；Welch（Blackman–Harris、${LMS_NPERSEG} 點、50% 重疊）找譜線，再在閉合式譜線的精確頻率做 toneFit；spur $=20\\log_{10}(\\Phi/2)$、$\\Phi=2\\pi f_{vco}A_{out}$（小角 PM，$f_{vco}=16$ GHz 插圖值）；閉合式對週期序列（有理 $\\alpha$）用一個週期的精確 Fourier 係數，否則用 F-CS.21／F-CS.22 的 $\\ell$ 級數`,
      ]}
      params={{ ...P, alpha }}
      units={{ fMHz: 'MHz', nBlocks: 'blocks', nBlk: 'samples/block', tauBlocks: 'blocks', uOsFs: 'fs' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: { status: analytic, note: analyticNote },
        monteCarlo: { status: mc, note: mcNote },
        fixedPoint: 'not-implemented',
      }}
      actions={{
        onReset: () => {
          setP(LMS_DEFAULTS)
          setSeed(LMS_DEFAULT_SEED)
          setRun(null)
        },
        onRun,
        onStop: task.cancel,
        running: task.running,
      }}
      presets={presets}
      onLoadPreset={(pr) => setP((prev) => mergeLmsParams(prev, pr.params))}
      exportData={() => {
        const out: Record<string, ArrayLike<number | string | null>> = {}
        for (const c of cases) {
          const res = resultOf(c.slot)
          if (res) {
            out[`${c.slot}_block`] = res.block
            out[`${c.slot}_phos_rms_fs`] = res.phosRmsFs
            out[`${c.slot}_gos_abs_fs`] = res.gosAbsFs
            out[`${c.slot}_phos_cm_abs_fs`] = res.phosCmAbsFs
            out[`${c.slot}_spur_f_MHz`] = res.spectrum.lines.map((l) => l.fMHz)
            out[`${c.slot}_spur_closed_dbc`] = res.spectrum.lines.map((l) => l.spurDbc)
            out[`${c.slot}_spur_tonefit_dbc`] = res.spectrum.toneFitDbc
            out[`${c.slot}_spur_source`] = res.spectrum.lines.map((l) => `${l.source} m=${l.mode} ell=${l.ell}`)
            out[`${c.slot}_psd_f_MHz`] = res.spectrum.psdFMHz
            out[`${c.slot}_psd_dbc_hz`] = res.spectrum.psdDbcHz
          }
          if (c.golden) {
            out[`${c.slot}_golden_block`] = c.golden.trace.blocks
            out[`${c.slot}_golden_phos_rms_fs`] = c.golden.trace.phos_rms_med_fs
            out[`${c.slot}_golden_gos_fs`] = c.golden.trace.gos_med_fs
          }
        }
        return out
      }}
      controls={
        <>
          <SelectControl label="迴路（標稱設計）" value={P.loop} onChange={(loop) => set({ loop })} options={(['L1', 'L2', 'L3'] as LoopKey[]).map((k) => ({ value: k, label: LOOP_LABEL[k] }))} reg="PLL 架構" />
          <ParamControl
            label={mathText('PMUX 旋轉頻率 $\\alpha f_{ref}$')}
            ariaLabel="α·f_ref"
            value={P.fMHz}
            onChange={(fMHz) => set({ fMHz })}
            min={0.5}
            max={3999.5}
            step={0.5}
            unit="MHz"
            digits={8}
            reg="FCW 的分數部分 × f_ref"
            hint={mathText(`$\\alpha=${(P.fMHz / FREF_MHZ).toFixed(6)}$；golden 存檔的 $\\alpha$：0.002、0.02、0.253、0.496（L2）、0.016（L3）、0.122（L1）、0.137`)}
          />
          {SLOTS.map((slot) => {
            const key = `case${slot}` as 'caseA' | 'caseB' | 'caseC'
            return (
              <SelectControl
                key={slot}
                label={`Case ${slot} 的 regressor／迴路`}
                value={P[key]}
                onChange={(v) => set({ [key]: v } as Partial<LmsParams>)}
                options={(Object.keys(LMS_CASE_LABEL) as LmsCaseKind[]).filter((k) => slot !== 'A' || k !== 'off').map((k) => ({ value: k, label: LMS_CASE_LABEL[k] }))}
                reg="GMAC 前置濾波／校準時的迴路"
              />
            )
          })}
          <ParamControl label="block 數" value={P.nBlocks} onChange={(nBlocks) => set({ nBlocks })} min={50} max={20000} integer clampOnBlur unit="blocks" hint="golden 存檔用 6000" />
          <ParamControl label={mathText('$N$（每 block 的 sample 數）')} ariaLabel="N" value={P.nBlk} onChange={(nBlk) => set({ nBlk })} min={64} max={4096} integer clampOnBlur unit="samples" reg="GMAC 累加長度" />
          <ParamControl label={mathText('$N_\\tau$（開迴路名義時間常數）')} ariaLabel="N_tau" value={P.tauBlocks} onChange={(tauBlocks) => set({ tauBlocks })} min={2} max={500} log unit="blocks" reg="LMS 步長" />
          <ParamControl label={mathText('比較器 offset $u_{os}$')} ariaLabel="比較器 offset" value={P.uOsFs} onChange={(uOsFs) => set({ uOsFs })} min={-500} max={500} step={5} unit="fs" reg="比較器／SSPD 的 DC 工作點" hint={mathText('25 fs $\\approx$ 1 mV（$A=0.4$ V、16 GHz，插圖值）')} />
          <ParamControl label="雜訊 lane 數（取中位數）" value={P.lanes} onChange={(lanes) => set({ lanes })} min={1} max={4} integer clampOnBlur hint="golden 存檔用 2" />
        </>
      }
    >
      {!fresh && (
        <Callout kind="info" title={task.running ? '即時模擬執行中…' : '即時模擬尚未完成'}>
          <p>
            {goldenRows.length ? '目前圖上只有 golden（Python）存檔的軌跡。' : goldenComparable ? mathText('這組（迴路、$\\alpha$、regressor）沒有 golden 存檔，圖暫時是空的。') : '目前的設定與 golden 存檔的條件不同，不疊 golden 的軌跡；圖暫時是空的。'}參數穩定 0.5 秒後會自動用 TS port 在 Web Worker 裡重跑（預設 {LMS_DEFAULTS.nBlocks} blocks，約 2 秒：閉迴路約 1 秒，三個 case 凍結後的尾段與頻譜再約 1 秒）；總 sample
            數超過 {LMS_AUTO_RUN_SAMPLES.toLocaleString()} 時請按「執行 Run」。
          </p>
        </Callout>
      )}
      <div className="cs-plots cs-plots-2">
        <Plot title="PHOS 誤差 rms（去掉共模）對 block" data={traces.phos} yLog height={340} csvName="sspll-lms-phos" layout={{ xaxis: { title: { text: 'block $k$（每 block $N$ 個 sample）' } }, yaxis: { title: { text: 'fs（log）' } } }} />
        <Plot title="$\lvert$GOS 誤差$\rvert$（code = 1 時）對 block" data={traces.gos} yLog height={340} csvName="sspll-lms-gos" layout={{ xaxis: { title: { text: 'block $k$' } }, yaxis: { title: { text: 'fs（log）' } } }} />
      </div>
      {goldenRows.length > 0 && (
        <DataTable
          className="cs-num"
          caption={`golden 存檔（pred_vs_sim.json）。${LMS_NOTE_ZH}`}
          head={['Case', 'golden key', '初始 PHOS rms', '最終 PHOS rms', '最大 PHOS rms', '最終 $\\lvert$GOS 誤差$\\rvert$']}
          rows={goldenRows.map((c) => [
            mathText(`${c.slot}：${LMS_CASE_TEX[c.kind]}`),
            <code key="k">{c.golden!.key}</code>,
            fmtFs(c.golden!.trace.init_phos_rms_fs),
            fmtFs(c.golden!.trace.final_phos_rms_fs),
            fmtFs(c.golden!.trace.max_phos_rms_fs),
            fmtFs(c.golden!.trace.final_gos_fs),
          ])}
        />
      )}
      {fresh && traces.spur.length > 0 && (
        <>
          <div className="cs-plots">
            <Plot
              title="凍結後的輸出 fractional spur：閉合式（$\times$）vs Welch＋findTones（$\circ$）"
              data={traces.spur}
              xLog
              height={340}
              csvName="sspll-lms-spur"
              layout={{ xaxis: { title: { text: '離載波的頻率 [MHz]' } }, yaxis: { title: { text: '單邊 spur [dBc]' } } }}
              caption={`每個 case 凍結權重後再跑 ${LMS_TAIL.toLocaleString()} 拍的輸出 $y=T*u$。${'$\\times$'} 是 F-CS.21／F-CS.22 的閉合式（有理 $\\alpha$ 時用週期序列的精確 Fourier 係數），${'$\\circ$'} 是 Welch PSD 上找到的譜線；兩者重合就是「輸出 = $\\lvert T\\rvert\\times$ 殘差的譜線」。$\\Phi\\ge${SPUR_PHI_MAX}$ rad 的線（發散的 case）小角 PM 不成立，dBc 只能當參考。`}
            />
          </div>
          <DataTable
            className="cs-num cs-spur"
            caption={`凍結後的 spur 表：每個 case 依輸出振幅列前 ${Math.min(6, LMS_MAX_LINES)} 條。注入點的 $A$ 列「單線／注入點」兩個值：「單線」是 F-CS.21／F-CS.22 該成分單獨的振幅，「注入點」是同一頻率上所有成分相干相加（有理 $\\alpha$ 時 $\\ell$ 與 $\\ell\\pm Q$ 的線重合、取樣落在相位邊緣；括號裡的 $+n$ 是相加進來的其他成分數）後的精確值；$A_{out}$ 與 spur 列「閉合式／toneFit」，toneFit 在同一頻率對輸出做 coherent 最小平方。數字是插圖值（$f_{vco}=16$ GHz）。`}
            head={['Case', '譜線（主要成分）', '$f$ [MHz]', '$A$ [fs] 單線／ 注入點', '$\\lvert T\\rvert$', '$A_{out}$ [fs] 閉合式／ toneFit', 'spur [dBc] 閉合式／ toneFit']}
            rows={cases.flatMap((c) => {
              const res = resultOf(c.slot)
              if (!res) return []
              const sp = res.spectrum
              // 「x／y」兩個值各佔一行（textContent 仍是 x／y），表格才塞得進結果欄；4 位有效數字（ps 級的發散值不會把欄位撐寬）
              const pair = (a: string, b: string) => (
                <>
                  {a}／<br />
                  {b}
                </>
              )
              return sp.lines.slice(0, 6).map((l, i) => [
                `${c.slot}`,
                `${lineLabel(l)}${l.others.length ? `（+${l.others.length}）` : ''}`,
                fx(l.fMHz, 1),
                pair(fp(l.mainAmpPdFs, 4), fp(l.ampPdFs, 4)),
                fx(l.tMag, 3),
                pair(fp(l.ampOutFs, 4), Number.isFinite(sp.toneFitFs[i]) ? fp(sp.toneFitFs[i], 4) : '—'),
                l.betaRad < SPUR_PHI_MAX ? (
                  pair(fx(l.spurDbc, 2), Number.isFinite(sp.toneFitDbc[i]) ? fx(sp.toneFitDbc[i], 2) : '—')
                ) : (
                  <>
                    {mathText(`$\\Phi=${fx(l.betaRad, 2)}$`)}
                    <br />
                    rad
                  </>
                ),
              ])
            })}
          />
        </>
      )}
    </ExperimentShell>
  )
}
