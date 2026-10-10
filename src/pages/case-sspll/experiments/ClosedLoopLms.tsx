import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Data } from 'plotly.js-dist-min'
import { Callout, ExperimentShell, ParamControl, Plot, SelectControl, mathText, useDebouncedValue, useThemeTokens, type CheckStatus, type ExperimentPreset, type MetricRow } from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import { analyseAlpha, eqOffset, gosOffsetBias, type LoopModels, type SspllLmsCase, type SspllLmsCompareParams, type SspllLmsCompareResult, type SspllLmsResult, type SspllLoop } from '@/simulation/models/sspll'
import { FREF_MHZ, LMS_NOTE_ZH, LOOPS, LOOP_LABEL, P_ONLY, PRED, SIM_CFG, type LmsTrace, type LoopKey } from '../data'
import { DataTable, fmtFs, fp, fx, txs } from '../common'

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
 * 同一組標籤的 `$...$` 版本：用在會經過 mathText 的地方（警告、指標名稱、表格）。
 * 下拉選單的 <option> 與 Plotly 圖例不渲染 KaTeX，仍用上面的純文字版。
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
 * N_τ,eff = 8/(μ_p K_q) 是實際步長（含 NLMS 式正規化）對應的開迴路時間常數。
 * ρ = max_m |1 − κ_m/N_τ,eff|：ρ > 1 發散、ρ < 1 收斂；|ρ − 1| < 3/B 時時間常數比模擬長度還長，判為邊際（不比對）。
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
  // golden 存檔只在相同的執行條件下才可比（否則不疊圖、也不做 Monte Carlo 交叉比對）
  const goldenComparable = P.nBlk === GOLDEN_LMS_COND.nBlk && P.tauBlocks === GOLDEN_LMS_COND.tauBlocks && P.uOsFs === GOLDEN_LMS_COND.uOsFs
  const cases = useMemo(() => {
    const kinds: Record<Slot, LmsCaseKind> = { A: P.caseA, B: P.caseB, C: P.caseC }
    return SLOTS.flatMap((slot, i) => {
      const kind = kinds[slot]
      const setup = lmsCaseSetup(P.loop, kind)
      if (!setup) return []
      // 小訊號預測（ergodic）：κ_PHOS、κ_GOS
      const pred = analyseAlpha(setup.loop, alpha, setup.variant === 'ac' || setup.variant === 'zm' ? 'raw' : setup.variant, setup.models, 2048)
      return [{ slot, kind, setup, pred, golden: goldenComparable ? goldenTrace(P.loop, alpha, setup.goldenSuffix) : null, colorIndex: i }]
    })
  }, [P.loop, P.caseA, P.caseB, P.caseC, alpha, goldenComparable])

  const totalSamples = cases.length * P.lanes * (4096 + P.nBlocks * P.nBlk)
  const task = useWorkerTask<SspllLmsCompareParams, SspllLmsCompareResult>('sspll', 'runSspllLmsCompare', { restartOnRun: true })
  const [run, setRun] = useState<{ key: string; result: SspllLmsCompareResult; ms: number | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const runKey = JSON.stringify({ P, seed })
  const runTask = task.run
  const onRun = useCallback(() => {
    if (cases.length === 0 || totalSamples > LMS_MAX_SAMPLES) return
    const params: SspllLmsCompareParams = {
      common: { alpha, cfg: SIM_CFG, nBlocks: P.nBlocks, nBlk: P.nBlk, tauBlocks: P.tauBlocks, seed, recEvery: Math.max(1, Math.round(P.nBlocks / 150)), lanes: P.lanes, uOsPs: P.uOsFs / 1000, seq: 'acc32' },
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
    if (k < -1e-3) return '$<0$，但 $\\lvert\\kappa\\rvert<10^{-2}$：alias／近整數的 dead zone 等級——平均梯度方向是錯的，只是很弱；誤差被雜訊推大後由大訊號反向（1-bit 比較器看「持續時間」）接手放大'
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
          ? `小訊號預測 $\\kappa_{GOS}=${c.pred.kappaGos.toFixed(4)}<0$：鋸齒 regressor 的平均梯度反號`
          : phosDiverged
            ? 'PHOS 發散後 PD 的殘差被它主導，GOS 的更新失去意義'
            : `小訊號預測 $\\kappa_{GOS}=${c.pred.beta === 0 ? '0' : txs(c.pred.kappaGos, 3)}$：near-grid 的 dead zone、比較器 offset 或大訊號反向`
      warnings.push(`${tag}的 GOS 不收斂：$\\lvert$GOS 誤差$\\rvert$ 由 ${fx(gos0, 1)} fs 變成 ${fp(res.finalGosFs, 4)} fs。${why}。`)
    }
  }

  // ── 指標 ──
  const metrics: MetricRow[] = [
    { name: '$\\alpha$', value: alpha, digits: 6, note: `PMUX 旋轉頻率 ${fx(Math.min(P.fMHz, FREF_MHZ - P.fMHz), 2)} MHz` },
    { name: '總 sample 數（含 settle）', value: totalSamples, digits: 9 },
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
      note: `${c.pred.kappaPhos < -1e-3 ? '預測：PHOS 反號' : c.pred.kappaPhos > 1e-3 ? '預測：PHOS 收斂' : '預測：dead zone'}；$\\kappa_{GOS}=${c.pred.beta === 0 ? '\\text{—}' : txs(c.pred.kappaGos, 4)}$`,
    })
    if (res) {
      const v = predictPhosVerdict(c.pred.kappaM, res.muP, SIM_CFG.sigmaPs, P.nBlocks)
      metrics.push({
        name: `${tag}：有限步長的平均模型 $\\max_m\\lvert1-\\kappa_m/N_{\\tau,\\mathrm{eff}}\\rvert$`,
        value: v.rho,
        digits: 5,
        formulaId: 'F-CS.18',
        note: `$N_{\\tau,\\mathrm{eff}}=8/(\\mu_pK_q)=${fx(v.tauEff, 1)}$ blocks（含 regressor 功率正規化）；${v.verdict === 'diverge' ? '$>1$：預測發散' : v.verdict === 'converge' ? '$<1$：預測收斂' : '$\\approx1$：邊際（dead zone 或時間常數比模擬長）'}`,
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
    analytic = checked === 0 ? 'n/a' : bad === 0 ? 'ok' : 'mismatch'
    analyticNote =
      P.uOsFs === 0
        ? `小訊號平均模型 $\\max_m\\lvert1-\\kappa_m/N_{\\tau,\\mathrm{eff}}\\rvert\\gtrless1$ vs 閉迴路的 PHOS 誤差是否變大：${checked} 個比對、${bad} 個不一致${marginal ? `；${marginal} 個是邊際（dead zone 或時間常數比模擬長），不比對` : ''}`
        : checked === 0
          ? 'offset 的共模漂移公式只在 $\\lvert u_{os}\\rvert\\le\\sigma_v/4$（小訊號）時適用；目前沒有可比對的 case'
          : `PHOS 共模漂移 vs forcing 公式 $B\\,\\mu_p\\,E[q]\\sum_k\\langle r_k\\rangle/8$（${checked} 個比對、${bad} 個不一致）`
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
      const name = `Case ${c.slot}：${LMS_CASE_LABEL[c.kind]}`
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
      phos.push({ x: [0, xMax], y: [deltaFs, deltaFs], name: 'Δ = T_vco/8（DTC 範圍；之上為飽和／失鎖）', mode: 'lines', line: { color: tokens.textMuted, dash: 'dash', width: 1 } })
    }
    return { phos, gos }
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
          在 Web Worker 裡跑時域模擬（<code>runSspllLmsCompare</code>，<code>simulator.py</code> 的 TS port；參數改變後自動重跑，也可以按「執行 Run」）。不同對策<strong>只差在 GMAC 用的 regressor</strong>（或把迴路換成 P-only）。
          虛線是 golden（Python）存在 <code>pred_vs_sim.json</code> 的軌跡：兩邊的隨機數產生器不同，只能做統計上的比較。
        </>
      }
      assumptions={[
        '每個 reference cycle 一步；32-bit 一階累加器；物理注入模型 $u=\\rho\\Delta+\\varepsilon_p-(1-a)(1+w_g)(\\rho\\Delta+w_p)$',
        `插圖值：$\\sigma_v=${fx(SIM_CFG.sigmaPs * 1000, 0)}$ fs、$\\Delta=T_{vco}/8=${SIM_CFG.deltaPs}$ ps（$f_{vco}=16$ GHz）、$a=${SIM_CFG.a}$、$\\varepsilon_k$ 取 golden 的 seed 7（rms ${fx(EPS_RMS_FS, 0)} fs）`,
        '步長以開迴路（$H\\equiv1$）時間常數 $N_\\tau$ 決定，並對 regressor 功率做 NLMS 式正規化；權重初值為 0',
        '線性、無界的 SSPD 與無限的 DTC range：ps 級的「發散值」在硬體上是飽和／cycle slip／失鎖',
        '比較器除指定的 $u_{os}$ 外沒有 offset；沒有 DTC INL、字長、FLL 等效應；沒有 fixed-point 模型（Fixed-Point 交叉比對未實作）',
        `golden 存檔的條件：$N=${GOLDEN_LMS_COND.nBlk}$、$N_\\tau=${GOLDEN_LMS_COND.tauBlocks}$、無 offset、6000 blocks × 2 lanes；設定不同時不疊圖、不比對`,
        'TS 與 golden 使用不同的隨機數產生器（xoshiro128** vs numpy PCG64）：逐點數值不會相同',
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
          <ParamControl label={mathText('$N_\\tau$（開迴路時間常數）')} ariaLabel="N_tau" value={P.tauBlocks} onChange={(tauBlocks) => set({ tauBlocks })} min={2} max={500} log unit="blocks" reg="LMS 步長" />
          <ParamControl label={mathText('比較器 offset $u_{os}$')} ariaLabel="比較器 offset" value={P.uOsFs} onChange={(uOsFs) => set({ uOsFs })} min={-500} max={500} step={5} unit="fs" reg="比較器／SSPD 的 DC 工作點" hint={mathText('25 fs $\\approx$ 1 mV（$A=0.4$ V、16 GHz，插圖值）')} />
          <ParamControl label="雜訊 lane 數（取中位數）" value={P.lanes} onChange={(lanes) => set({ lanes })} min={1} max={4} integer clampOnBlur hint="golden 存檔用 2" />
        </>
      }
    >
      {!fresh && (
        <Callout kind="info" title={task.running ? '即時模擬執行中…' : '即時模擬尚未完成'}>
          <p>
            {goldenRows.length ? '目前圖上只有 golden（Python）存檔的軌跡。' : goldenComparable ? mathText('這組（迴路、$\\alpha$、regressor）沒有 golden 存檔，圖暫時是空的。') : '目前的設定與 golden 存檔的條件不同，不疊 golden 的軌跡；圖暫時是空的。'}參數穩定 0.5 秒後會自動用 TS port 在 Web Worker 裡重跑（預設 {LMS_DEFAULTS.nBlocks} blocks，約 1 秒）；總 sample
            數超過 {LMS_AUTO_RUN_SAMPLES.toLocaleString()} 時請按「執行 Run」。
          </p>
        </Callout>
      )}
      <div className="cs-plots cs-plots-2">
        <Plot title="PHOS 誤差 rms（去掉共模）對 block" data={traces.phos} yLog height={340} csvName="sspll-lms-phos" layout={{ xaxis: { title: { text: 'block k（每 block N 個 sample）' } }, yaxis: { title: { text: 'fs（log）' } } }} />
        <Plot title="$\lvert$GOS 誤差$\rvert$（code = 1 時）對 block" data={traces.gos} yLog height={340} csvName="sspll-lms-gos" layout={{ xaxis: { title: { text: 'block k' } }, yaxis: { title: { text: 'fs（log）' } } }} />
      </div>
      {goldenRows.length > 0 && (
        <DataTable
          className="cs-num"
          caption={`golden 存檔（pred_vs_sim.json）。${LMS_NOTE_ZH}`}
          head={['Case', 'golden key', '初始 PHOS rms', '最終 PHOS rms', '最大 PHOS rms', '最終 |GOS 誤差|']}
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
    </ExperimentShell>
  )
}
