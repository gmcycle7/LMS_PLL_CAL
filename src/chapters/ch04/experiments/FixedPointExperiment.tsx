import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { Data } from 'plotly.js-dist-min'
import {
  CaseSelector,
  ExperimentShell,
  ParamControl,
  Plot,
  SelectControl,
  Tex,
  ToggleControl,
  useCases,
  useDebouncedValue,
  useThemeTokens,
  type CheckEntry,
  type MetricRow,
} from '@/components'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import {
  ROUNDING_LABEL,
  ROUNDING_MODES,
  DITHER_MIN,
  accumulatorSizing,
  accumulatorTrace,
  ditherMinFor,
  floorRestoringSlope,
  halfEvenTieAmplitude,
  roundingMeanError,
  roundingTransfer,
  towardZeroRestoringSlope,
  type AccScenario,
  type CodeKind,
  type CodeRange,
  type FixedLoopAnalytic,
  type FixedLoopMc,
  type FixedLoopParams,
  type FixedLoopResult,
  type GmMode,
  type NegateMode,
  type OverflowMode,
  type RoundingMode,
} from '@/simulation/models/gmac'
import { f, mt, tx } from '../common'
import { texifyModelText } from '../modelText'
import { useCasePresets } from './presetHooks'

const R = String.raw
export const FIXED_POINT_ID = 'gmac-fixed-point'

export interface FpShared {
  bx: number
  log2N: number
  codeRange: CodeRange
  codeKind: CodeKind
  dsmFrac: number
  scenario: AccScenario
  deltaOverSigma: number
  ellB: number
  ditherRatio: number
  aTrue: number
  aStepBlock: number
  aStepValue: number
  w0: number
  mu: number
  sigmaV: number
  physMin: number
  physMax: number
  regMin: number
  regMax: number
  numBlocks: number
  /** 面板 C：對目前選取的 case 另跑多 seed Monte Carlo（較慢） */
  mc: boolean
}

/** Monte Carlo 的 seed 數（opt-in） */
const MC_RUNS = 6

export interface FpCase {
  accBits: number
  negate: NegateMode
  accOverflow: OverflowMode
  gmMode: GmMode
  gFracBits: number
  rounding: RoundingMode
  antiWindup: boolean
  regOverflow: OverflowMode
  /** W 的 LSB Δ_W [fs per FS code]；0 = 浮點（不取整） */
  wLsb: number
  /** μ·G → W 格點的 rounding */
  wRounding: RoundingMode
}

export const DEFAULT_FP_SHARED: FpShared = {
  bx: 6,
  log2N: 10,
  codeRange: 'symmetric',
  codeKind: 'uniform',
  dsmFrac: 0.3,
  scenario: 'random',
  deltaOverSigma: 3,
  ellB: 4,
  ditherRatio: 1,
  aTrue: 3,
  aStepBlock: -1,
  aStepValue: 3,
  w0: 0,
  mu: 10,
  sigmaV: 100,
  physMin: -16,
  physMax: 16,
  regMin: -32,
  regMax: 32,
  numBlocks: 600,
  mc: false,
}

export const DEFAULT_FP_CASE: FpCase = {
  accBits: 16,
  negate: 'extend',
  accOverflow: 'wrap',
  gmMode: 'average',
  gFracBits: 2,
  rounding: 'floor',
  antiWindup: true,
  regOverflow: 'saturate',
  wLsb: 0,
  wRounding: 'half_even',
}

/** preset 的 case 只寫了部分欄位時，以預設值補齊（模組層級：傳給 useCasePresets 時參考穩定） */
export function normalizeFpCase(c: Partial<FpCase>): FpCase {
  return { ...DEFAULT_FP_CASE, ...c }
}

/**
 * 偏差預測（F-04.11、F-04.18）在「取整」這一關是否適用：兩個取整點都要有足夠的 dither
 * （下限是 gmac.ts 的 ditherMinFor：DITHER_MIN，toward-0 加倍——模型的 dead zone 警告用同一個下限，所以這裡判成不適用時警告清單一定有對應的訊息）。
 * half-even / toward-0 也不例外——它們的平衡點雖然是 δ = 0，dither 不夠時迴路一樣停在 dead zone，到不了這個點。
 * 高於下限時，單一 seed 的 4 SE 比對仍有幾個百分點的機會標成不相符：AR(1) 近似的標準誤偏小（預測恰為 0 的 half-even 與 toward-0，
 * 誤差 ÷ SE 的 RMS 約 1.1–2.5 而不是 1；16 個 seed × 兩個 w₀ 的 32 次裡各有 0–3 次超過 4 SE，和 dither 比無關）。要確認請開 Monte Carlo。
 */
export function roundingPredictionOk(
  an: Pick<FixedLoopAnalytic, 'ell' | 'ditherRatio' | 'ditherRatioW'>,
  c: Pick<FpCase, 'gmMode' | 'wLsb' | 'rounding' | 'wRounding'>,
): boolean {
  const shiftOk = c.gmMode === 'sum' || an.ell <= 0 || an.ditherRatio >= ditherMinFor(c.rounding)
  const wOk = c.wLsb <= 0 || an.ditherRatioW >= ditherMinFor(c.wRounding)
  return shiftOk && wOk
}

/** 單一 seed 的比對標成不相符時附在說明後面：這個比對用的 AR(1) 標準誤偏小，相符的設定偶爾也會超過 4 SE（見 roundingPredictionOk 的說明）。 */
export const SINGLE_SEED_HINT = '。單一 seed 的標準誤（AR(1) 近似）偏小，相符的設定偶爾也會超過 4 SE：請打開面板 C 的 Monte Carlo，用多個 seed 確認'

const ROUND_SHORT: Record<RoundingMode, string> = { floor: 'floor', half_up: 'half-up', toward_zero: 'toward-0', half_even: 'half-even' }

/** case 的一行摘要；`$...$` 以 mt() 顯示成 KaTeX */
function caseLabel(c: FpCase): string {
  return R`${c.gmMode === 'sum' ? 'sum' : R`avg $F_G=${c.gFracBits}$ ${ROUND_SHORT[c.rounding]}`}，$B_\mathrm{acc}=${c.accBits}$${c.accOverflow === 'saturate' ? ' sat' : ''}${c.negate === 'inplace' ? '，取負 bug' : ''}，${c.antiWindup ? 'AW' : c.regOverflow === 'wrap' ? R`$W$ wrap` : '無 AW'}${c.wLsb > 0 ? R`，$\Delta_W=${tx(c.wLsb, 6)}$ ${ROUND_SHORT[c.wRounding]}` : ''}`
}

export function buildLoopParams(s: FpShared, c: FpCase, seed: number): FixedLoopParams {
  return {
    bx: s.bx,
    log2N: s.log2N,
    codeRange: s.codeRange,
    codeKind: s.codeKind,
    dsmFrac: s.dsmFrac,
    accBits: c.accBits,
    accOverflow: c.accOverflow,
    negate: c.negate,
    gmMode: c.gmMode,
    gFracBits: c.gFracBits,
    rounding: c.rounding,
    aTrue: s.aTrue,
    aStepBlock: s.aStepBlock,
    aStepValue: s.aStepValue,
    w0: s.w0,
    mu: s.mu,
    sigmaV: s.sigmaV,
    physMin: s.physMin,
    physMax: s.physMax,
    regMin: s.regMin,
    regMax: s.regMax,
    regOverflow: c.regOverflow,
    antiWindup: c.antiWindup,
    numBlocks: s.numBlocks,
    seed,
    wLsb: c.wLsb,
    wRounding: c.wRounding,
  }
}

export function FixedPointExperiment() {
  const [s, setS] = useState<FpShared>(DEFAULT_FP_SHARED)
  const [seed, setSeed] = useState(20261010)
  const cases = useCases<FpCase>(DEFAULT_FP_CASE, { seed })
  const tokens = useThemeTokens()
  const applyShared = useCallback((p: Record<string, unknown>) => setS({ ...DEFAULT_FP_SHARED, ...(p as Partial<FpShared>) }), [])
  const { presets, load } = useCasePresets<FpCase>({
    experiment: FIXED_POINT_ID,
    cases,
    applyShared,
    setSeed,
    initialExtraCases: [{ ...DEFAULT_FP_CASE, rounding: 'half_even' }],
    normalizeCase: normalizeFpCase,
  })
  const ac = cases.active.params
  const N = 2 ** s.log2N

  // ── Panel A：位元數與一個 block 的累加器軌跡（inline，≤ 65536 samples）──
  const ds = useDeferredValue(s)
  const dac = useDeferredValue(ac)
  const sizing = useMemo(() => accumulatorSizing(ds.bx, 2 ** ds.log2N, ds.codeRange), [ds.bx, ds.log2N, ds.codeRange])
  const trace = useMemo(
    () =>
      accumulatorTrace({
        bx: ds.bx,
        log2N: ds.log2N,
        codeRange: ds.codeRange,
        accBits: dac.accBits,
        negate: dac.negate,
        scenario: ds.scenario,
        deltaOverSigma: ds.deltaOverSigma,
        seed,
      }),
    [ds.bx, ds.log2N, ds.codeRange, dac.accBits, dac.negate, ds.scenario, ds.deltaOverSigma, seed],
  )
  // 解析交叉比對：在 bitsExact 不溢位、bitsExact − 1 溢位（最壞情況）
  const sizingCheck = useMemo(() => {
    const base = { bx: ds.bx, log2N: ds.log2N, codeRange: ds.codeRange, negate: 'extend' as const, scenario: 'worst_case' as const, deltaOverSigma: 0, seed: 1, maxPoints: 8 }
    const ok = accumulatorTrace({ ...base, accBits: sizing.bitsExact })
    const bad = accumulatorTrace({ ...base, accBits: sizing.bitsExact - 1 })
    return { pass: ok.wrapEvents === 0 && bad.wrapEvents > 0 && ok.finalExact === sizing.maxPosSum, okEvents: ok.wrapEvents, badEvents: bad.wrapEvents }
  }, [ds.bx, ds.log2N, ds.codeRange, sizing])
  const sizingTable = useMemo(
    () =>
      [16, 256, 1024, 4096, 65536].map((n) => ({
        N: n,
        sym: accumulatorSizing(ds.bx, n, 'symmetric'),
        full: accumulatorSizing(ds.bx, n, 'full'),
      })),
    [ds.bx],
  )

  // ── Panel B：rounding 的平均轉移特性（精確，inline）──
  const rt = useMemo(() => roundingTransfer({ ell: ds.ellB, ditherRatio: ds.ditherRatio, mRange: 3 }), [ds.ellB, ds.ditherRatio])

  // ── Panel C：閉迴路定點 vs 浮點（worker）──
  // 只有閉迴路相關的欄位改變才重跑（面板 A/B 的控制不觸發 worker）
  const loopKey = JSON.stringify(cases.cases.map((c) => buildLoopParams(s, c.params, seed)))
  const loopParams = useMemo(() => JSON.parse(loopKey) as FixedLoopParams[], [loopKey])
  const debounced = useDebouncedValue(loopParams, 300)
  const activeIdx = cases.cases.findIndex((c) => c.id === cases.activeId)
  const mcReq = useMemo(() => ({ mcRuns: s.mc ? MC_RUNS : 0, mcCase: s.mc ? Math.max(0, activeIdx) : 0 }), [s.mc, activeIdx])
  const task = useWorkerTask<{ cases: FixedLoopParams[]; mcRuns: number; mcCase: number }, { results: FixedLoopResult[]; mc: FixedLoopMc | null }>('gmac', 'runFixedGmacLoopCases', {
    restartOnRun: true,
  })
  const [loop, setLoop] = useState<FixedLoopResult[] | null>(null)
  const [mcRes, setMcRes] = useState<FixedLoopMc | null>(null)
  const [loopErr, setLoopErr] = useState<string | null>(null)
  const { run } = task
  useEffect(() => {
    let alive = true
    run({ cases: debounced, ...mcReq }).then(
      (r) => {
        if (alive) {
          setLoop(r.results)
          setMcRes(r.mc)
          setLoopErr(null)
        }
      },
      (e: unknown) => {
        if (alive && !isWorkerCancelled(e)) setLoopErr((e as Error).message)
      },
    )
    return () => {
      alive = false
    }
  }, [debounced, mcReq, run])
  const activeLoop = loop && loop.length === cases.cases.length ? loop[Math.max(0, activeIdx)] : null

  // ── 警告 ──
  const warnings: string[] = []
  if (trace.wrapEvents > 0 || trace.saturateEvents > 0) {
    warnings.push(
      R`累加器 $B_\mathrm{acc}=${ac.accBits}$ bits 不夠：這個情境下 exact 總和 $${trace.finalExact}$ 超出 $[${trace.rangeLo},\,${trace.rangeHi}]$（第 ${trace.firstOverflow} 個 sample 開始）。wrap 結果 $${trace.finalWrap}$${trace.signFlip ? '（變號！更新方向相反）' : ''}，saturate 結果 $${trace.finalSaturate}$。最壞情況需要 ${sizing.bitsExact} bits`,
    )
  }
  if (trace.negateErrors > 0) {
    warnings.push(R`條件取負在 $B_x$ bits 內做：$x=${-(2 ** (s.bx - 1))}$ 時 $-x$ 溢位回到 $${-(2 ** (s.bx - 1))}$，本 block 有 ${trace.negateErrors} 次 $q\,x$ 符號錯誤`)
  }
  if (loopErr) warnings.push(`閉迴路模擬錯誤：${loopErr}`)
  // runFixedGmacLoop 的警告是純文字：換成 $...$（顯示層；數字沿用模型印出的值）
  if (activeLoop) for (const w of activeLoop.warnings.map(texifyModelText)) if (!warnings.includes(w)) warnings.push(w)
  if (N * s.numBlocks > 2 ** 22) warnings.push(R`$N\times\text{blocks}=${N * s.numBlocks}$：閉迴路計算量較大，每次調整可能需要 1 秒以上`)

  // ── 交叉比對 ──
  const an = activeLoop?.analytic
  const st = activeLoop?.stats
  // 偏差預測（F-04.11 + F-04.15 + F-04.18）適用：無 a 跳變、無累加器 overflow、無 rail / wrap、小訊號；
  // 兩個取整點另需足夠的 dither（σ_S/2^ℓ、μσ_G/Δ_W ≥ ditherMinFor(模式)：DITHER_MIN，toward-0 加倍），half-even / toward-0 也不例外（roundingPredictionOk）
  const roundingOk = !!an && roundingPredictionOk(an, ac)
  const biasValid = !!(an && st && s.aStepBlock < 0 && roundingOk && st.accOverflow === 0 && an.linearValid && st.wSat === 0 && st.wWrap === 0 && Number.isFinite(an.biasPred))
  const fixedOk = biasValid && Math.abs(st!.biasDiff - an!.biasPred) <= 4 * st!.biasDiffSe + 0.05 * Math.abs(an!.biasPred)
  const fixedCheck: CheckEntry = !activeLoop
    ? { status: 'n/a', note: '計算中' }
    : biasValid
      ? {
          status: fixedOk ? 'ok' : 'mismatch',
          note: R`Case ${cases.activeId}：$w_\mathrm{fixed}-w_\mathrm{float}=${tx(st!.biasDiff, 4)}\pm${tx(st!.biasDiffSe, 3)}\,\mathrm{fs}$（AR(1) SE），預測（$\div N$ rounding $${tx(an!.biasPredRound, 4)}$${ac.wLsb > 0 ? R` + $W$ 取整 $${tx(an!.biasPredW, 4)}$` : ''}${an!.pMin > 0 ? R` + 取負 bug，$p_\mathrm{min}=${tx(an!.pMin, 4)}$` : ''}）$=${tx(an!.biasPred, 4)}\,\mathrm{fs}$${fixedOk ? '' : SINGLE_SEED_HINT}`,
        }
      : {
          status: 'n/a',
          note: R`偏差預測只在 $\sigma_S/2^\ell\ge${ditherMinFor(ac.rounding)}$、$\mu\sigma_G/\Delta_W\ge${ditherMinFor(ac.wRounding)}$（half-even 也一樣：dither 不夠時迴路停在 dead zone；toward-0 在 $0$ 附近的平台寬 $2$ 個 LSB，下限加倍成 $${2 * DITHER_MIN}$）、無 accumulator overflow / gain rail / $W$ wrap / $a$ 跳變、小訊號時適用`,
        }
  const mcActive = s.mc && mcRes && mcRes.caseIndex === Math.max(0, activeIdx) ? mcRes : null
  const mcCheck: CheckEntry = !s.mc
    ? { status: 'n/a', note: `未啟用：打開面板 C 的「Monte Carlo（${MC_RUNS} seeds）」才會對目前的 case 跑多 seed（gmac.test.ts 另有 12-seed 驗證）` }
    : !mcActive
      ? { status: 'n/a', note: '計算中' }
      : biasValid
        ? {
            status: Math.abs(mcActive.mean - mcActive.pred) <= 4 * mcActive.se + 0.02 * Math.abs(mcActive.pred) + 0.01 ? 'ok' : 'mismatch',
            note: R`Case ${cases.activeId}，${mcActive.seeds.length} seeds：$w_\mathrm{fixed}-w_\mathrm{float}=${tx(mcActive.mean, 4)}\pm${tx(mcActive.se, 3)}\,\mathrm{fs}$（SE）vs 預測 $${tx(mcActive.pred, 4)}\,\mathrm{fs}$`,
          }
        : { status: 'n/a', note: R`Case ${cases.activeId}，${mcActive.seeds.length} seeds：$w_\mathrm{fixed}-w_\mathrm{float}=${tx(mcActive.mean, 4)}\pm${tx(mcActive.se, 3)}\,\mathrm{fs}$；此設定下解析預測不適用，無法比對` }

  const analyticCheck: CheckEntry = {
    status: sizingCheck.pass ? 'ok' : 'mismatch',
    note: `最壞情況：${sizing.bitsExact} bits 溢位 ${sizingCheck.okEvents} 次、${sizing.bitsExact - 1} bits 溢位 ${sizingCheck.badEvents} 次（精確位元數公式 F-04.9）`,
  }

  // σ_w 的單次估計：w_k 是 pole p 的 AR(1)，窗口內 n 個樣本只有 n_eff ≈ n(1 − p)/(1 + p) 個是獨立的，
  // 標準差估計的相對不確定性約 1/√(2 n_eff)（Gaussian 近似）——短窗口下和預測差 30% 以上是正常的。
  const sigmaWNote = (() => {
    if (!an || !st) return undefined
    const n = st.window[1] - st.window[0] + 1
    if (!(an.pole > 0 && an.pole < 1)) return R`預測 $\sigma_w=\mu\sqrt{\sigma_\eta^2/(1-p^2)}$，$\sigma_\eta^2=E[x^2]/N$（線性化、iid GMAC 雜訊）`
    const nEff = (n * (1 - an.pole)) / (1 + an.pole)
    return R`預測 $\sigma_w=\mu\sqrt{\sigma_\eta^2/(1-p^2)}$；統計窗口 $n=${n}$ blocks、pole $p=${tx(an.pole, 4)}$，只有約 $n(1-p)/(1+p)\approx${tx(nEff, 3)}$ 個獨立樣本，單次估計的相對不確定性約 $\pm${tx(100 / Math.sqrt(2 * Math.max(nEff, 0.5)), 2)}\%$（$1/\sqrt{2n_\mathrm{eff}}$）；拉長 block 數會收斂到預測值`
  })()

  const metrics: MetricRow[] = [
    { name: R`最壞情況需要的 $B_\mathrm{acc}$（精確）`, value: sizing.bitsExact, unit: 'bits', claim: 'exact', formulaId: 'F-04.9', note: R`${s.codeRange === 'full' ? R`full range（含 $-2^{B_x-1}$）` : 'symmetric'}；guard bits $=${sizing.guardBits}$` },
    { name: R`經驗法則 $B_x+\lceil\log_2N\rceil$`, value: sizing.bitsRule, unit: 'bits' },
    { name: R`$\max|S|$（最壞情況）`, value: sizing.maxPosSum, unit: 'LSB' },
    ...(an && st
      ? [
          { name: R`Case ${cases.activeId}：$K=K_qE[x^2]$`, value: an.K, unit: R`$\mathrm{fs}^{-1}$`, digits: 5, claim: 'approx' as const },
          { name: R`Case ${cases.activeId}：$g$、pole $p=1-g$`, value: `${f(an.g, 4)}、${f(an.pole, 5)}`, claim: 'approx' as const, formulaId: 'F-04.5' },
          { name: R`Case ${cases.activeId}：$\ell$、$\Delta_G$`, value: ac.gmMode === 'average' ? `${an.ell}、${f(an.deltaG, 4)}` : 'sum：不右移' },
          {
            name: R`Case ${cases.activeId}：$\sigma_S/2^\ell$（dither 比）`,
            value: an.ditherRatio,
            digits: 4,
            note: R`$\ge1$：餘數幾乎均勻；$\ge${ditherMinFor(ac.rounding)}$：偏差預測仍可用（floor 的回復斜率 $\chi=${tx(floorRestoringSlope(an.ditherRatio), 3)}$${ac.rounding === 'toward_zero' ? R`；toward-0 在 $0$ 附近的平台寬 $2$ 個 LSB，下限是 floor 的兩倍，它自己的回復斜率是 $${tx(towardZeroRestoringSlope(an.ditherRatio), 3)}$` : ''}）；更小：dead zone`,
          },
          ...(ac.wLsb > 0
            ? [
                {
                  name: R`Case ${cases.activeId}：$R=\Delta_W/(\mu\Delta_G)$、$\mu\sigma_G/\Delta_W$`,
                  value: `${f(an.wRatio, 4)}、${f(an.ditherRatioW, 3)}`,
                  formulaId: 'F-04.18',
                  note: R`$W$ 的格點比更新量的格點粗 $R$ 倍；$\mu G$ 取整的平均誤差 $${tx(an.meanIncErr, 4)}\,\mathrm{fs}$／block，所以偏差 $${tx(an.biasPredW, 4)}\,\mathrm{fs}$`,
                },
              ]
            : []),
          {
            name: R`Case ${cases.activeId}：$w_\mathrm{fixed}-w_\mathrm{float}$（定點減浮點）`,
            value: st.biasDiff,
            unit: 'fs',
            digits: 4,
            analytic: biasValid ? an.biasPred : undefined,
            tolerance: biasValid ? 4 * st.biasDiffSe + 0.05 * Math.abs(an.biasPred) : undefined,
            formulaId: an.pMin > 0 ? 'F-04.15' : ac.wLsb > 0 && an.biasPredW !== 0 ? 'F-04.18' : 'F-04.11',
            claim: 'approx' as const,
            note: R`統計窗口 block ${st.window[0]}–${st.window[1]}；SE $${tx(st.biasDiffSe, 3)}\,\mathrm{fs}$；預測：$\div N$ rounding $${tx(an.biasPredRound, 4)}$${ac.wLsb > 0 ? R` + $W$ 取整 $${tx(an.biasPredW, 4)}$（$\bar\varepsilon_W\Delta_W/g$）` : ''}${an.pMin > 0 ? R` 與取負 bug（$p_\mathrm{min}=${tx(an.pMin, 4)}$）的自洽解` : ''}`,
          },
          ...(mcActive
            ? [
                {
                  name: R`Case ${cases.activeId}：Monte Carlo $w_\mathrm{fixed}-w_\mathrm{float}$（${mcActive.seeds.length} seeds）`,
                  value: mcActive.mean,
                  unit: 'fs',
                  digits: 4,
                  analytic: biasValid ? mcActive.pred : undefined,
                  tolerance: biasValid ? 4 * mcActive.se + 0.02 * Math.abs(mcActive.pred) + 0.01 : undefined,
                  claim: 'approx' as const,
                  formulaId: an.pMin > 0 ? 'F-04.15' : 'F-04.11',
                  note: R`SE $=${tx(mcActive.se, 3)}\,\mathrm{fs}$；各 seed：${mcActive.biasDiff.map((v) => f(v, 3)).join('、')}`,
                },
              ]
            : []),
          {
            name: R`Case ${cases.activeId}：$\sigma_w$（定點 / 預測）`,
            value: `${f(st.stdFixed, 4)} / ${f(an.sigmaWPred, 4)}`,
            unit: 'fs',
            claim: 'approx' as const,
            note: sigmaWNote,
          },
          ...(s.aStepBlock >= 0
            ? [
                {
                  name: R`Case ${cases.activeId}：$a$ 跳變後回復 block 數（定點）`,
                  value: st.recoveryFixed,
                  unit: 'blocks',
                  analytic: Number.isFinite(st.recoveryPredFixed) ? st.recoveryPredFixed : undefined,
                  tolerance: Number.isFinite(st.recoveryPredFixed) ? 0.15 * st.recoveryPredFixed + 10 : undefined,
                  digits: 4,
                  claim: 'approx' as const,
                  formulaId: 'F-04.12',
                  note: R`回到 $\pm${tx(st.recoveryTol, 3)}\,\mathrm{fs}$ 內；預測：windup 放掉 $(W_\mathrm{peak}-w_\mathrm{rail})/(g\,|a'-w_\mathrm{rail}|)$，再由 rail 以 pole $1-g$ 收斂；浮點參考 ${st.recoveryFloat ?? '未回復'}`,
                },
              ]
            : []),
          { name: R`Case ${cases.activeId}：overflow / 取負錯誤 / $W$ 飽和 / $W$ wrap`, value: `${st.accOverflow} / ${st.negateErrors} / ${st.wSat} / ${st.wWrap}` },
        ]
      : []),
  ]

  // ── 圖 ──
  const traceData = useMemo<Data[]>(
    () => [
      { x: trace.n, y: trace.exact, name: 'exact（無限位元）', mode: 'lines', line: { color: tokens.series[0] } },
      { x: trace.n, y: trace.wrap, name: `${dac.accBits}-bit wrap`, mode: 'lines', line: { color: tokens.series[1] } },
      { x: trace.n, y: trace.saturate, name: `${dac.accBits}-bit saturate`, mode: 'lines', line: { color: tokens.series[2], dash: 'dash' } },
      { x: [0, 2 ** ds.log2N - 1], y: [trace.rangeHi, trace.rangeHi], name: '暫存器上限', mode: 'lines', line: { color: tokens.textMuted, dash: 'dot' } },
      { x: [0, 2 ** ds.log2N - 1], y: [trace.rangeLo, trace.rangeLo], name: '暫存器下限', mode: 'lines', line: { color: tokens.textMuted, dash: 'dot' }, showlegend: false },
    ],
    [trace, dac.accBits, ds.log2N, tokens],
  )
  const rtData = useMemo<Data[]>(
    () => ROUNDING_MODES.map((m, i) => ({ x: rt.m, y: rt.bias[m], name: ROUND_SHORT[m], mode: 'lines', line: { color: tokens.series[i], shape: ds.ditherRatio === 0 ? 'hv' : 'linear' } })),
    [rt, ds.ditherRatio, tokens],
  )
  const caseIds = cases.cases.map((c) => `${c.id}:${c.seriesIndex}`).join(',')
  const loopData = useMemo<Data[]>(() => {
    const d: Data[] = []
    const ids = caseIds.split(',').map((t) => t.split(':'))
    if (loop && loop.length === ids.length) {
      loop.forEach((r, i) => {
        d.push({ x: r.k, y: r.wFixedApplied, name: `Case ${ids[i][0]}（定點）`, mode: 'lines', line: { color: tokens.series[Number(ids[i][1])] } })
      })
      const r0 = loop[0]
      d.push({ x: r0.k, y: r0.wFloatApplied, name: 'Case A 的浮點參考', mode: 'lines', line: { color: tokens.textMuted, dash: 'dash' } })
      d.push({ x: r0.k, y: r0.a, name: '$a(k)$', mode: 'lines', line: { color: tokens.text, dash: 'dot', shape: 'hv' } })
    }
    return d
  }, [loop, caseIds, tokens])
  const layoutTrace = useMemo(() => ({ xaxis: { title: { text: 'block 內 sample' } }, yaxis: { title: { text: R`$S$ [code LSB]` } } }), [])
  const layoutRt = useMemo(() => ({ xaxis: { title: { text: R`$E[S]/2^{\ell}$（真實平均，輸出 LSB）` } }, yaxis: { title: { text: '平均誤差 [輸出 LSB]' } } }), [])
  const layoutLoop = useMemo(() => ({ xaxis: { title: { text: R`block $k$` } }, yaxis: { title: { text: R`$w_k$ [fs per FS code]` } } }), [])

  return (
    <ExperimentShell
      id={FIXED_POINT_ID}
      source="simulation"
      title="定點 GMAC：位元數、overflow、rounding 偏差與 anti-windup"
      level="L5"
      claim="exact"
      description={
        <>
          三個面板共用同一個位元級 datapath（<code>gmac.ts</code>）：A. 位元數計算器與一個 block 內的累加器軌跡；B. 右移 rounding 的平均轉移特性（精確）；
          C. 閉迴路定點 vs 浮點（同 seed、同 code、同雜訊，Web Worker）。Case A/B/C 只改 datapath 的設定。
        </>
      }
      assumptions={[
        R`code：有號 ${s.bx}-bit 整數 $x_\mathrm{int}$，正規化 $x=x_\mathrm{int}/2^{B_x-1}$；${s.codeRange === 'full' ? R`含最負 code $-2^{B_x-1}$` : '對稱範圍（不含最負 code）'}`,
        R`comparator：$b=[e\ge0]$，$e=(a-w)\,x+v$，$v\sim\mathcal N(0,\sigma_v^2)$ iid；identity error path、$x_\mathrm{ref}=x$、$d=0$`,
        R`average 模式以算術右移 $\ell=\log_2N-F_G$ bits 實作 $\div N$（$N$ 為 2 的冪）；sum 模式不右移`,
        R`gain accumulator $W$：$\Delta_W=0$ 時為浮點高解析；$\Delta_W>0$ 時更新量 $\mu G$ 先取整到 $\Delta_W$ 的格點（第二個截斷點，F-04.18）。實體 DTC gain code 的量化見 Ch13；實際作用 gain $=\mathrm{clamp}(W,\,w_\mathrm{min},\,w_\mathrm{max})$`,
        R`偏差預測（F-04.11 + F-04.15 + F-04.18）假設雜訊足以當 dither（$\sigma_S/2^\ell$ 與 $\mu\sigma_G/\Delta_W\gtrsim${DITHER_MIN}$；toward-0 要 $\gtrsim${2 * DITHER_MIN}$）與 $K_q$ 小訊號線性化；回復時間預測（F-04.12）假設線性小訊號`,
        'Monte Carlo（opt-in）：對目前 case 以 deriveSeed(seed, mc-i) 另跑 6 個 seed，比較跨 seed 平均與預測',
      ]}
      params={{ ...s, seed, active_case: cases.activeId, ...ac }}
      seed={seed}
      onSeedChange={(v) => {
        setSeed(v)
        cases.setSeed(v)
      }}
      units={{ bx: 'bits', log2N: '—', accBits: 'bits', gFracBits: 'bits', aTrue: 'fs per FS code', mu: 'fs', sigmaV: 'fs', physMin: 'fs per FS code', physMax: 'fs per FS code', wLsb: 'fs per FS code' }}
      warnings={warnings}
      metrics={metrics}
      crossCheck={{
        analytic: analyticCheck,
        monteCarlo: mcCheck,
        fixedPoint: fixedCheck,
      }}
      actions={{ onReset: () => setS(DEFAULT_FP_SHARED), running: task.running }}
      exportData={() => {
        const cols: Record<string, ArrayLike<number>> = { acc_n: trace.n, acc_exact: trace.exact, acc_wrap: trace.wrap, acc_saturate: trace.saturate, round_m: rt.m }
        for (const m of ROUNDING_MODES) cols[`round_bias_${m}`] = rt.bias[m]
        if (loop) {
          cols.k = loop[0].k
          cols.a = loop[0].a
          loop.forEach((r, i) => {
            const id = cases.cases[i]?.id ?? String(i)
            cols[`w_fixed_${id}`] = r.wFixedApplied
            cols[`w_float_${id}`] = r.wFloatApplied
            cols[`W_internal_${id}`] = r.wFixed
          })
        }
        return cols
      }}
      presets={presets}
      onLoadPreset={(p) => load(p.params)}
      controls={
        <>
          <div className="ch04-controls-title">Datapath（共用）</div>
          <ParamControl label={mt(R`$B_x$（code 位元）`)} ariaLabel="B_x（code 位元）" value={s.bx} onChange={(bx) => setS({ ...s, bx })} min={2} max={16} integer clampOnBlur unit="bits" reg="GMAC_X_WIDTH" />
          <ParamControl label={mt(R`$\log_2N$`)} ariaLabel="log₂N" value={s.log2N} onChange={(log2N) => setS({ ...s, log2N })} min={0} max={16} integer clampOnBlur hint={mt(R`$N=${N}$`)} reg="REG_GMAC_LOG2N" />
          <SelectControl<CodeRange>
            label="code 範圍"
            value={s.codeRange}
            onChange={(codeRange) => setS({ ...s, codeRange })}
            options={[
              { value: 'symmetric', label: '對稱 ±(2^{B−1}−1)' },
              { value: 'full', label: '完整 [−2^{B−1}, 2^{B−1}−1]' },
            ]}
            reg="RTL: code clamp"
          />
          <SelectControl<CodeKind>
            label="code 來源（面板 C）"
            value={s.codeKind}
            onChange={(codeKind) => setS({ ...s, codeKind })}
            options={[
              { value: 'uniform', label: 'uniform 整數' },
              { value: 'pm_full_scale', label: '±full scale（二值）' },
              { value: 'dsm_residue', label: '一階 DSM 累加器 MSBs' },
            ]}
            reg="seeded_pattern"
          />
          <div className="ch04-controls-group">
            <div className="ch04-controls-title">面板 A：累加器情境</div>
            <SelectControl<AccScenario>
              label="情境"
              value={s.scenario}
              onChange={(scenario) => setS({ ...s, scenario })}
              options={[
                { value: 'worst_case', label: '最壞情況（每筆都加最大值）' },
                { value: 'random', label: '隨機 code + comparator' },
                { value: 'min_code', label: '一直是最負 code（取負 bug）' },
              ]}
              reg="behavioral: 累加器測試情境（面板 A）"
            />
            <ParamControl label={mt(R`$\delta\cdot\mathrm{FS}/\sigma_v$`)} ariaLabel="δ·FS/σ_v" value={s.deltaOverSigma} onChange={(deltaOverSigma) => setS({ ...s, deltaOverSigma })} min={0} max={50} step={0.01} hint={mt(R`$0$ = 已收斂；大 = 剛開機（$q\approx\mathrm{sign}(x)$）`)} reg="behavioral" />
          </div>
          <div className="ch04-controls-group">
            <div className="ch04-controls-title">面板 B：rounding 轉移</div>
            <ParamControl label={mt(R`$\ell$（右移 bits）`)} ariaLabel="ℓ（右移 bits）" value={s.ellB} onChange={(ellB) => setS({ ...s, ellB })} min={1} max={8} integer clampOnBlur unit="bits" reg="behavioral: shift ℓ（面板 B）" />
            <ParamControl label={mt(R`$\sigma_S/2^\ell$（dither 比）`)} ariaLabel="σ_S / 2^ℓ（dither 比）" value={s.ditherRatio} onChange={(ditherRatio) => setS({ ...s, ditherRatio })} min={0} max={3} step={0.01} hint={R`$0$ = 無雜訊`} reg="behavioral: σ_S / 2^ℓ" />
          </div>
          <div className="ch04-controls-group">
            <div className="ch04-controls-title">面板 C：閉迴路（共用）</div>
            <ParamControl label={mt(R`$a$（真實 gain）`)} ariaLabel="a（真實 gain）" value={s.aTrue} onChange={(aTrue) => setS({ ...s, aTrue })} min={-64} max={64} step={0.01} unit="fs/FS" reg="gain_true" />
            <ParamControl label={mt(R`$a$ 跳變的 block（$-1$ = 不跳）`)} ariaLabel="a 跳變的 block（−1 = 不跳）" value={s.aStepBlock} onChange={(aStepBlock) => setS({ ...s, aStepBlock })} min={-1} max={20000} integer clampOnBlur unit="block" reg="behavioral: PVT step（a 跳變）" />
            <ParamControl label={mt(R`跳變後的 $a$`)} ariaLabel="跳變後的 a" value={s.aStepValue} onChange={(aStepValue) => setS({ ...s, aStepValue })} min={-64} max={64} step={0.01} unit="fs/FS" reg="behavioral: gain_true after step" />
            <ParamControl label={mt(R`$w_0$`)} ariaLabel="w₀" value={s.w0} onChange={(w0) => setS({ ...s, w0 })} min={-64} max={64} step={0.01} unit="fs/FS" reg="REG_DTC_GAIN_INIT" />
            <ParamControl label={mt(R`$\mu$`)} ariaLabel="μ" value={s.mu} onChange={(mu) => setS({ ...s, mu })} min={0.001} max={1000} log unit="fs" reg="REG_LMS_MU" />
            <ParamControl label={mt(R`$\sigma_v$`)} ariaLabel="σ_v" value={s.sigmaV} onChange={(sigmaV) => setS({ ...s, sigmaV })} min={0} max={500} step={0.1} unit="fs" reg="pd_noise_rms_fs" />
            <ParamControl label={mt(R`$w_\mathrm{min}$（DTC 可實現下限）`)} ariaLabel="w_min（DTC 可實現下限）" value={s.physMin} onChange={(physMin) => setS({ ...s, physMin })} min={-64} max={64} step={0.125} unit="fs/FS" reg="DTC gain trim range" />
            <ParamControl label={mt(R`$w_\mathrm{max}$（上限）`)} ariaLabel="w_max（上限）" value={s.physMax} onChange={(physMax) => setS({ ...s, physMax })} min={-64} max={64} step={0.125} unit="fs/FS" reg="DTC gain trim range" />
            <ParamControl label={mt(R`$W$ 內部下限`)} ariaLabel="W 內部下限" value={s.regMin} onChange={(regMin) => setS({ ...s, regMin })} min={-256} max={64} step={0.125} unit="fs/FS" reg="internal_bits" />
            <ParamControl label={mt(R`$W$ 內部上限`)} ariaLabel="W 內部上限" value={s.regMax} onChange={(regMax) => setS({ ...s, regMax })} min={-64} max={256} step={0.125} unit="fs/FS" reg="internal_bits" />
            <ToggleControl
              label={`Monte Carlo（目前 case 另跑 ${MC_RUNS} seeds，較慢）`}
              value={s.mc}
              onChange={(mc) => setS({ ...s, mc })}
              reg="behavioral: Monte Carlo seeds"
              hint="seed_i = deriveSeed(seed, 'mc-i')；在 Web Worker 執行"
            />
            <ParamControl label="block 數" value={s.numBlocks} onChange={(numBlocks) => setS({ ...s, numBlocks })} min={10} max={8000} integer clampOnBlur unit="blocks" reg="num_blocks" />
          </div>
          <div className="ch04-controls-group">
            <div className="ch04-controls-title">Case {cases.activeId}（{mt(caseLabel(ac))}）</div>
            <ParamControl label={mt(R`$B_\mathrm{acc}$`)} ariaLabel="B_acc" value={ac.accBits} onChange={(accBits) => cases.update({ accBits })} min={2} max={48} integer clampOnBlur unit="bits" reg="GMAC_ACC_WIDTH" hint={`最壞情況需要 ${sizing.bitsExact}`} />
            <SelectControl<NegateMode>
              label="條件取負"
              value={ac.negate}
              onChange={(negate) => cases.update({ negate })}
              options={[
                { value: 'extend', label: '先延伸到 B_x+1 bits（正確）' },
                { value: 'inplace', label: '在 B_x bits 內取負（bug）' },
              ]}
              reg="RTL: negate width"
            />
            <SelectControl<OverflowMode>
              label="累加器 overflow"
              value={ac.accOverflow}
              onChange={(accOverflow) => cases.update({ accOverflow })}
              options={[
                { value: 'wrap', label: 'wrap（未保護）' },
                { value: 'saturate', label: 'saturate' },
              ]}
              reg="RTL: acc overflow"
            />
            <SelectControl<GmMode>
              label="gm_mode"
              value={ac.gmMode}
              onChange={(gmMode) => cases.update({ gmMode })}
              options={[
                { value: 'average', label: 'average（右移 log₂N − F_G）' },
                { value: 'sum', label: 'sum（不右移）' },
              ]}
              reg="REG_GMAC_MODE"
            />
            <ParamControl label={mt(R`$F_G$（保留小數位元）`)} ariaLabel="F_G（保留小數位元）" value={ac.gFracBits} onChange={(gFracBits) => cases.update({ gFracBits })} min={0} max={24} integer clampOnBlur unit="bits" reg="GMAC_G_FRAC" />
            <SelectControl<RoundingMode>
              label="rounding"
              value={ac.rounding}
              onChange={(rounding) => cases.update({ rounding })}
              options={ROUNDING_MODES.map((m) => ({ value: m, label: ROUNDING_LABEL[m] }))}
              reg="RTL: shift rounding"
            />
            <ParamControl
              label={mt(R`$\Delta_W$（$W$ 的 LSB；$0$ = 浮點）`)}
              ariaLabel="Δ_W（W 的 LSB；0 = 浮點）"
              value={ac.wLsb}
              onChange={(wLsb) => cases.update({ wLsb })}
              min={0}
              max={4}
              step={0.001}
              unit="fs/FS"
              reg="gain_register.internal_bits（W 小數位元）"
              hint={mt(an && ac.gmMode === 'average' ? R`更新量格點 $\mu\Delta_G=${tx(s.mu * an.deltaG, 6)}\,\mathrm{fs}$；右移 $\ell_W$ bits $\Rightarrow\Delta_W=2^{\ell_W}\mu\Delta_G$` : R`更新量 $\mu G$ 先取整到這個格點再加進 $W$`)}
            />
            <SelectControl<RoundingMode>
              label={mt(R`$\mu G\to W$ 的 rounding`)}
              ariaLabel="μ·G → W 的 rounding"
              value={ac.wRounding}
              onChange={(wRounding) => cases.update({ wRounding })}
              options={ROUNDING_MODES.map((m) => ({ value: m, label: ROUNDING_LABEL[m] }))}
              reg="RTL: μ shift rounding"
              disabled={ac.wLsb <= 0}
            />
            <ToggleControl label={mt(R`anti-windup（$W$ 夾在 $[w_\mathrm{min},\,w_\mathrm{max}]$）`)} ariaLabel="anti-windup（W 夾在 [w_min, w_max]）" value={ac.antiWindup} onChange={(antiWindup) => cases.update({ antiWindup })} reg="RTL: integrator clamp" />
            <SelectControl<OverflowMode>
              label={mt(R`$W$ 內部暫存器 overflow`)}
              ariaLabel="W 內部暫存器 overflow"
              value={ac.regOverflow}
              onChange={(regOverflow) => cases.update({ regOverflow })}
              options={[
                { value: 'saturate', label: 'saturate' },
                { value: 'wrap', label: 'wrap（bug）' },
              ]}
              reg="gain_register.overflow"
            />
          </div>
        </>
      }
    >
      <CaseSelector cases={cases} />

      <div className="ch04-panel-title">A. 累加器位元數與一個 block 內的軌跡</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <Tex>N</Tex>
              </th>
              <th>
                symmetric（精確；<Tex>{R`=B_x+\log_2N`}</Tex>）
              </th>
              <th>
                full range（精確；<Tex>{R`=B_x+\log_2N+1`}</Tex>）
              </th>
              <th>
                <Tex>{R`\max|S|`}</Tex>（symmetric）
              </th>
            </tr>
          </thead>
          <tbody>
            {sizingTable.map((r) => (
              <tr key={r.N}>
                <td className="num">{r.N}</td>
                <td className="num">{r.sym.bitsExact}</td>
                <td className="num">{r.full.bitsExact}</td>
                <td className="num">{r.sym.maxPosSum}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        <Tex>{R`B_x=${ds.bx}`}</Tex> 時各 <Tex>N</Tex>（2 的冪）的最少有號位元數（由 <code>accumulatorBitsRequired</code> 窮舉最壞情況計算，與 F-04.9 封閉式相同）。full range 多 1 bit，因為{' '}
        <Tex>{R`-(-2^{B_x-1})=+2^{B_x-1}`}</Tex>。
      </p>
      <Plot
        title={R`累加器：exact vs ${ac.accBits}-bit wrap / saturate（$N=${N}$，Case ${cases.activeId}）`}
        data={traceData}
        layout={layoutTrace}
        height={280}
        csvName="ch04-acc-trace"
      />

      <div className="ch04-panel-title">B. 右移 rounding 的平均誤差（精確｜離散 Gaussian 模型）</div>
      <Plot
        title={R`$E[Q(S)]-E[S]/2^\ell$（$\ell=${ds.ellB}$，$\sigma_S/2^\ell=${tx(ds.ditherRatio, 4)}$）`}
        data={rtData}
        layout={layoutRt}
        height={260}
        csvName="ch04-rounding-transfer"
        caption={mt(
          R`$\sigma_S/2^\ell\gtrsim1$ 時：floor 平坦地少約半個 LSB、half-up 多 $2^{-\ell-1}$、half-even $\approx0$、toward-zero 在 0 附近由 $+\tfrac12$ 翻到 $-\tfrac12$（等效增益下降）。$\sigma_S=0$ 時是階梯與 dead zone。`,
        )}
      />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>rounding</th>
              <th>
                均勻餘數下的 <Tex>{R`\bar\varepsilon\;(\ell=${ds.ellB})`}</Tex>
              </th>
              <th>
                <Tex>{R`G\approx0`}</Tex> 附近
              </th>
            </tr>
          </thead>
          <tbody>
            {ROUNDING_MODES.map((m) => (
              <tr key={m}>
                <td>{ROUNDING_LABEL[m]}</td>
                <td className="num">{m === 'toward_zero' ? <Tex>{R`\mp${tx(Math.abs(roundingMeanError(ds.ellB, m)), 5)}`}</Tex> : f(roundingMeanError(ds.ellB, m), 5)}</td>
                <td className="small">
                  {m === 'floor'
                    ? mt(R`系統性負偏差 $\Rightarrow w$ 停在 $a$ 下方`)
                    : m === 'half_up'
                      ? mt(R`極小正偏差 $2^{-\ell-1}$`)
                      : m === 'half_even'
                        ? '無偏差（推薦）'
                        : '無平均偏差但 0 附近有 dead zone、增益下降'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        {mt(
          R`half-even 那一列的 $0$：除了餘數均勻，還要「恰好一半」時商的奇偶各半（F-04.10）。上圖的離散 Gaussian 模型在 $\sigma_S/2^\ell\ge1$ 時，half-even 的曲線偏離 $0$ 不超過約 $${tx(halfEvenTieAmplitude(1), 2)}\times2^{-\ell}$ 個 LSB；$E[S]=0$（閉迴路的平衡點）時由奇對稱 $Q(-S)=-Q(S)$ 保證為 $0$。`,
        )}
      </p>

      <div className="ch04-panel-title">C. 閉迴路：定點 GMAC vs 浮點 GMAC（同 seed）</div>
      {task.running && <p className="small muted">計算中…（Web Worker）</p>}
      <Plot
        title={R`實際作用到 DTC 的 gain $w_k$`}
        data={loopData}
        layout={layoutLoop}
        height={300}
        csvName="ch04-fixed-loop"
      />
      {loop && loop.length === cases.cases.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Case</th>
                <th>設定</th>
                <th>
                  <Tex>{R`w_\mathrm{fixed}-w_\mathrm{float}`}</Tex>（定點減浮點）[fs]
                </th>
                <th>
                  預測 <Tex>{R`w^*-a`}</Tex> [fs]
                </th>
                <th>
                  <Tex>{R`\sigma_S/2^\ell`}</Tex>
                </th>
                <th>回復（定點 / 浮點 / 預測）</th>
              </tr>
            </thead>
            <tbody>
              {loop.map((r, i) => (
                <tr key={cases.cases[i].id}>
                  <td>{cases.cases[i].id}</td>
                  <td className="small">{mt(caseLabel(cases.cases[i].params))}</td>
                  <td className="num">
                    <Tex>{R`${tx(r.stats.biasDiff, 4)}\pm${tx(r.stats.biasDiffSe, 2)}`}</Tex>
                  </td>
                  <td className="num">{f(r.analytic.biasPred, 4)}</td>
                  <td className="num">{f(r.analytic.ditherRatio, 3)}</td>
                  <td className="num">
                    {r.stats.recoveryFixed ?? '—'} / {r.stats.recoveryFloat ?? '—'} / {Number.isFinite(r.stats.recoveryPredFixed) ? f(r.stats.recoveryPredFixed, 4) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted">
        試試看：載入 preset「anti-windup」，比較 A（沒有 anti-windup）、B（有）、C（<Tex>W</Tex> wrap）在 <Tex>a</Tex> 跳回範圍內之後的回復，並對照表格的預測欄（F-04.12）；載入「6-bit × 4096」，把{' '}
        <Tex>{R`B_\mathrm{acc}`}</Tex> 從 18 改成 17，看 overflow 警告與面板 A 的 wrap 曲線；載入「最負 code 陷阱」，比較 B 的偏差與 F-04.15 的預測；載入「第二個截斷點」，把 <Tex>{R`\mu`}</Tex> 減半，看 B 的偏差加倍（F-04.18）。
      </p>
    </ExperimentShell>
  )
}
