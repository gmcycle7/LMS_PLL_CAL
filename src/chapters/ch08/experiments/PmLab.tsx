import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Data, Layout } from 'plotly.js-cartesian-dist-min'
import {
  Callout,
  CaseSelector,
  ExperimentShell,
  ParamControl,
  Plot,
  Tex,
  useCases,
  useThemeTokens,
  type CheckEntry,
  type ExperimentPreset,
  type MetricRow,
} from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import type { BlockLmsConfigInput, BlockLmsMonteCarloResult } from '@/simulation/models/blockLms'
import { cToString } from '@/simulation/core'
import {
  arcTrace,
  hLine,
  indexArray,
  poleTrace,
  unitCircleTrace,
  vLine,
  withAlpha,
  zPlaneLayout,
} from './plotHelpers'
import {
  buildSignLmsMcConfig,
  calLoopGain,
  calLoopResponse,
  comparatorKq,
  compareMcToLinear,
  delayBoundTable,
  delayCriticalGain,
  delayLoopCrossCheck,
  delayRootLocus,
  delayStable,
  logOmegaGrid,
  pmFirstOrder,
  pmWithDelay,
  simulateDelayRecursion,
  type McComparison,
} from '@/simulation/models/stability'
import { fx, rich, sig, tsig, tx } from '../common'

export const PM_LAB_ID = 'pm-lab'

interface PmCase {
  /** 正規化 loop gain g = μK_qC（無因次） */
  g: number
  /** 更新延遲（blocks） */
  d: number
}

interface McSettings {
  sigmaV: number
  N: number
  delta0: number
  runs: number
  blocks: number
}

interface McState {
  key: string
  deltaMc: Float64Array
  stdMc: Float64Array
  deltaLin: Float64Array
  cmp: McComparison
  gEff: number
  runs: number
  delta0: number
  warnings: string[]
}

const DEFAULT_CASE: PmCase = { g: 1, d: 0 }
const DEFAULT_MC: McSettings = { sigmaV: 100, N: 4096, delta0: 20, runs: 16, blocks: 80 }
const NYQ_R = 2.6
const OMEGAS = logOmegaGrid(500, 1e-3, Math.PI)
const NYQ_OMEGAS = logOmegaGrid(700, 1e-4, Math.PI)

const finiteOrNull = (x: number): number | null => (Number.isFinite(x) ? x : null)

// 固定的 Plot layout 放在模組層級（物件參考不變 ⇒ 重新渲染時不會多打一次 Plotly.react、也不會重設使用者的縮放）
const BODE_MAG_LAYOUT: Partial<Layout> = { xaxis: { title: { text: String.raw`$\omega$ [rad/block]` }, dtick: 1 }, yaxis: { title: { text: String.raw`$|L|$ [dB]` }, range: [-20, 50] } }
const NYQUIST_LAYOUT: Partial<Layout> = {
  xaxis: { title: { text: String.raw`$\mathrm{Re}\,L$` }, range: [-NYQ_R, NYQ_R * 0.7], zeroline: true },
  yaxis: { title: { text: String.raw`$\mathrm{Im}\,L$` }, range: [-NYQ_R, NYQ_R], scaleanchor: 'x', scaleratio: 1, zeroline: true },
}
const Z_PLANE_LAYOUT = zPlaneLayout(1.6)
const ABS_LAYOUT: Partial<Layout> = { xaxis: { title: { text: '$k$ [block]' } }, yaxis: { title: { text: String.raw`$|\delta_k| / \delta_0$` } } }

/** 「試試看」提示用到的數字：全部由模型計算（不手寫） */
const TRY = {
  g1: pmFirstOrder(1),
  g15: pmFirstOrder(1.5),
  gStar1: delayCriticalGain(1),
  periodD1: (2 * Math.PI) / pmWithDelay(1, 1).omega180,
  d2: pmWithDelay(0.65, 2),
  rhoD2: delayStable(0.65, 2).rho,
  neg: pmFirstOrder(-0.1),
}

/**
 * Step response 圖說。點線 1 ± ρ^k 只對目前的 case 畫：
 * d = 0 時 δ_k = (1 − g)^k δ_0，|δ_k|/δ_0 = ρ^k，是精確的包絡；
 * d ≥ 1 時 ρ = max|z| 只給漸近速率，ρ^k 不是誤差的包絡（技術審查 R02）——
 * 例：d = 1、g = 0.25 是重根 z = 0.5，δ_k/δ_0 = (1 + k/2)·2^{−k}，每一個 block 都在點線外面。
 */
export function stepCaption(clipped: boolean, showRhoLine: boolean, d: number): string {
  const clip = clipped ? String.raw`發散的曲線已裁切到 $[-2.5,\,4]$，右圖用 log 軸看完整成長。` : ''
  if (!showRhoLine) return clip || String.raw`$w_k/a=1-\delta_k/\delta_0$：收斂時會走到目標 $1$。`
  const line =
    d === 0
      ? String.raw`點線：目前 case 的解析包絡 $1\pm\rho^k$（$\rho=|1-g|$）；$d=0$ 時 $|\delta_k|/\delta_0=\rho^k$，每一點都落在點線上。`
      : String.raw`點線 $1\pm\rho^k$（目前 case 的 $\rho=\max|z|$）只是漸近速率的參考線，不是包絡：$d\ge1$ 時誤差是 $d+1$ 個模式的組合（可能有重根、複數根），曲線可以跑到點線外面。例：$d=1$、$g=0.25$ 是重根 $z=0.5$，$\delta_k/\delta_0=(1+k/2)\,2^{-k}$。`
  return clip + line
}

/** g 是否落在「d 個 block 延遲下」的穩定區（不含臨界） */
function verdict(g: number, d: number): { label: ReactNode; kind: 'ok' | 'bad' | 'marginal' } {
  const s = delayStable(g, d)
  if (s.marginal) return { label: rich(String.raw`臨界 marginal（$\rho=1$）`), kind: 'marginal' }
  return s.stable ? { label: '穩定', kind: 'ok' } : { label: '不穩定', kind: 'bad' }
}

/**
 * Phase Margin Lab（規格 §19：控制 g, d；開迴路 Bode、Nyquist、閉迴路 poles；T08 + delay bounds）。
 * 模型 L1：線性化平均模型 δ_{k+1} = δ_k − gδ_{k−d}；選用的 Monte Carlo 以 blockLms 的真實 block sign-LMS 交叉比對。
 */
export function PmLab() {
  const tokens = useThemeTokens()
  const cases = useCases<PmCase>(DEFAULT_CASE, { seed: 20261010 })
  const { g, d } = cases.active.params
  const [steps, setSteps] = useState(40)
  const [mc, setMc] = useState<McSettings>(DEFAULT_MC)
  const [mcState, setMcState] = useState<McState | null>(null)
  const [mcError, setMcError] = useState<string | null>(null)
  const mcTask = useWorkerTask<{ config: BlockLmsConfigInput; runs: number }, BlockLmsMonteCarloResult>(
    'blockLms',
    'runBlockLmsMonteCarlo',
    { restartOnRun: true },
  )
  const { update: updateCase, reset: resetCases, setSeed: setCaseSeed } = cases
  const seed = cases.seed

  // ── presets（src/data/presets/pm*.json）＋ URL ?preset= ──
  const presets: ExperimentPreset[] = useMemo(
    () => presetsForExperiment(PM_LAB_ID).map((p) => ({ id: p.id, name: p.title, params: p.params, description: p.description })),
    [],
  )
  const applyParams = useCallback(
    (p: Record<string, unknown>) => {
      const patch: Partial<PmCase> = {}
      if (typeof p.g === 'number') patch.g = p.g
      if (typeof p.d === 'number') patch.d = p.d
      updateCase(patch)
      if (typeof p.steps === 'number') setSteps(p.steps)
      if (typeof p.mcBlocks === 'number') {
        const blocks = p.mcBlocks
        setMc((m) => ({ ...m, blocks }))
      }
    },
    [updateCase],
  )
  const urlPreset = useUrlPreset(PM_LAB_ID)
  useEffect(() => {
    if (urlPreset) applyParams(urlPreset.params)
  }, [urlPreset, applyParams])

  // ── 解析與數值計算（都很輕：多項式求根、3000 點頻率響應） ──
  const table = useMemo(() => delayBoundTable(6), [])
  const gCritNumeric = table[d]?.gCritNumeric ?? NaN
  // 封閉式（pmWithDelay、g*）vs 數值（loopMargins、求根）；g ≤ 0 時改比對實根 z ≥ 1（PM／GM 不適用）
  const check = useMemo(() => delayLoopCrossCheck(g, d, gCritNumeric), [g, d, gCritNumeric])
  const { pm, stab, margins } = check
  const kq = comparatorKq(mc.sigmaV)
  const muFs = g / kq

  const responses = useMemo(
    () => cases.cases.map((cs) => ({ cs, resp: calLoopResponse(cs.params.g, cs.params.d, OMEGAS) })),
    [cases.cases],
  )
  const runs = useMemo(
    () => cases.cases.map((cs) => ({ cs, run: simulateDelayRecursion(cs.params.g, cs.params.d, steps, 1) })),
    [cases.cases, steps],
  )
  const locus = useMemo(() => {
    const gMax = Math.max(2.4, 1.2 * Math.abs(g))
    const gs = Array.from({ length: 180 }, (_, i) => (gMax * (i + 1)) / 180)
    const roots = delayRootLocus(d, gs).flat()
    return { x: roots.map((z) => z.re), y: roots.map((z) => z.im) }
  }, [g, d])

  // ── Monte Carlo（blockLms，worker） ──
  const mcKey = JSON.stringify({ g, d, ...mc, seed })
  const mcCurrent = mcState && mcState.key === mcKey ? mcState : null
  const onRun = () => {
    setMcError(null)
    const setup = { g, d, sigmaV: mc.sigmaV, N: mc.N, delta0: mc.delta0, blocks: mc.blocks, seed }
    const key = mcKey
    mcTask
      .run({ config: buildSignLmsMcConfig(setup), runs: mc.runs })
      .then((res) => {
        const deltaMc = Float64Array.from(res.wMean, (w) => setup.delta0 - w)
        const deltaLin = simulateDelayRecursion(res.analytic.g, d, setup.blocks, setup.delta0).delta
        const cmp = compareMcToLinear(deltaMc, res.wStd, mc.runs, deltaLin, setup.delta0, setup.sigmaV)
        setMcState({ key, deltaMc, stdMc: res.wStd, deltaLin, cmp, gEff: res.analytic.g, runs: mc.runs, delta0: setup.delta0, warnings: res.warnings })
      })
      .catch((e: unknown) => {
        if (!isWorkerCancelled(e)) setMcError(e instanceof Error ? e.message : String(e))
      })
  }

  // ── 警告（必須解釋原因） ──
  const warnings: string[] = []
  if (g === 0) {
    warnings.push(
      String.raw`$g=0$：沒有任何更新（$\mu=0$ 或 GMAC 斜率 $K=K_qC=0$，例如 $C=0$ 的 $\theta=\pm90^\circ$）。pole $=1$，誤差永遠保持初值——臨界，不是穩定。`,
    )
  } else if (g < 0) {
    warnings.push(
      String.raw`$g=${tsig(g)}<0$：更新極性錯誤（$K=K_qC\le0$ 或 $\mu\le0$）。` +
        (d === 0
          ? String.raw`閉迴路 pole $1-g=${tsig(1 - g)}>1$`
          : String.raw`$P(1)=g<0\Rightarrow$ 特徵式必有實根 $z>1$（$\rho=${tsig(stab.rho, 6)}$）`) +
        String.raw`，平均誤差單調發散；只把 $|\mu|$ 調小無法修正符號，需先修正 polarity（Ch06 / Ch07 的 delay alignment 或 filtered-x）。`,
    )
  } else if (stab.marginal) {
    warnings.push(
      String.raw`$g=${tsig(g)}$ 恰為臨界 $g^*(d=${d})=${tsig(pm.gCrit, 6)}$：根落在單位圓上（$\rho=${tsig(stab.rho, 8)}$），誤差不衰減而持續振盪——臨界／marginal，不可視為穩定。`,
    )
  } else if (!stab.stable) {
    if (d === 0 && g > 2) {
      warnings.push(
        String.raw`$g=${tsig(g)}>2$：$|L(e^{j\omega})|=\frac{g}{2\sin(\omega/2)}\ge\frac g2>1$ 對所有 $\omega$ 成立，沒有 gain crossover（PM 無定義）；pole $1-g=${tsig(1 - g)}<-1$，誤差正負交替發散。`,
      )
    } else {
      warnings.push(
        String.raw`$g=${tsig(g)}>g^*(d=${d})=${tsig(pm.gCrit, 6)}$：${d} 個 block 的更新延遲使 $\rho=${tsig(stab.rho, 5)}>1$，平均誤差振盪發散` +
          (Number.isFinite(pm.pmDeg)
            ? String.raw`（$PM_d=${tx(pm.pmDeg, 2)}^\circ<0$）。`
            : String.raw`（$g>2$：$|L|>1$ 對所有 $\omega$，沒有 gain crossover，PM 無定義）。`) +
          (g < 2 ? String.raw` 若忽略延遲、只用一階模型（$0<g<2$）會誤判為穩定。` : ''),
      )
    }
  }
  if (mcError) warnings.push(`Monte Carlo 執行失敗：${mcError}`)

  // ── 交叉比對 ──
  const analyticNote = check.ok
    ? g > 0
      ? String.raw`封閉式（$\omega_c$、$PM$、$GM$、$g^*$）＝數值 crossover／求根`
      : String.raw`$g\le0$：PM／GM 依定義不適用；求根確認有實根 $z\ge1$（$P(1)=g\le0$），$g^*$ 封閉式＝數值；lag 分支的數值 PM 為負`
    : `不一致的項目：${check.items
        .filter((it) => !it.ok)
        .map((it) => it.name)
        .join('、')}（請回報）`
  const mcCheck: CheckEntry = mcCurrent
    ? mcCurrent.cmp.pass
      ? {
          status: 'ok',
          note: String.raw`${mcCurrent.runs} runs：$\max_k|\delta_{\mathrm{MC},k}-\delta_{\mathrm{lin},k}|=${tsig(mcCurrent.cmp.maxAbsDev, 3)}$ fs，最差為允許值的 $${tsig(mcCurrent.cmp.worstRatio, 3)}$ 倍（Student-t 臨界值 $t=${tsig(mcCurrent.cmp.tCrit, 3)}$）`,
        }
      : {
          status: 'mismatch',
          note: Number.isFinite(mcCurrent.cmp.worstRatio)
            ? String.raw`最差 block ${mcCurrent.cmp.worstBlock}：偏差為允許值的 $${tsig(mcCurrent.cmp.worstRatio, 3)}$ 倍${stab.stable ? '' : String.raw`（線性模型不穩定；sign-LMS 的 $|G|\le1$ 使實際誤差有界、形成 limit cycle）`}`
            : String.raw`線性模型已發散到 $10^{12}$ 以上；sign-LMS 的 $|G|\le1$ 使實際誤差有界（limit cycle）`,
        }
    : { status: 'n/a', note: mcState ? '參數已變更：請重新執行 Run' : '尚未執行：按「執行 Run」以 blockLms 跑真實 block sign-LMS' }

  // ── 指標 ──
  const metrics: MetricRow[] = [
    {
      name: String.raw`閉迴路 poles（$z^{d+1}-z^d+g=0$ 的根）`,
      value: stab.roots.map((z) => cToString(z, 4)).join('、'),
      formulaId: 'F-08.7',
      claim: 'exact',
    },
    { name: String.raw`$\rho=\max_i|z_i|$`, value: stab.rho, formulaId: 'F-08.7', claim: 'exact', digits: 8 },
    {
      name: String.raw`$g^*(d)$（數值求根 vs 封閉式 $2\sin\frac{\pi}{4d+2}$）`,
      value: gCritNumeric,
      analytic: pm.gCrit,
      tolerance: 1e-9,
      formulaId: 'F-08.8',
      claim: 'exact',
      digits: 10,
    },
    Number.isFinite(pm.omegaC)
      ? { name: String.raw`$\omega_c$（數值 crossover vs $2\arcsin\frac g2$）`, value: margins.omegaC, analytic: pm.omegaC, tolerance: 1e-9, unit: 'rad/block', formulaId: 'F-08.4', claim: 'exact', digits: 8 }
      : {
          name: String.raw`$\omega_c$`,
          value: null,
          unit: 'rad/block',
          formulaId: 'F-08.4',
          note: g <= 0 ? String.raw`$g\le0$：極性錯誤或沒有更新，crossover／PM 依定義不適用` : String.raw`$g>2$：$|L|>1$ 對所有 $\omega$，沒有 crossover`,
        },
    Number.isFinite(pm.pmDeg)
      ? { name: String.raw`$PM$（數值展開相位 vs $90^\circ-(2d+1)\arcsin\frac g2$）`, value: margins.pmDeg, analytic: pm.pmDeg, tolerance: 1e-6, unit: '°', formulaId: d === 0 ? 'F-08.5' : 'F-08.9', claim: 'exact', digits: 8 }
      : {
          name: String.raw`$PM$`,
          value: null,
          unit: '°',
          formulaId: 'F-08.5',
          note:
            g < 0
              ? String.raw`$g<0$：負號等於多 $180^\circ$ 的 lag，相位由 $-270^\circ$ 起算，PM 必為負（依定義不適用）`
              : g === 0
                ? String.raw`$g=0$：$|L|\equiv0$，沒有迴路`
                : '沒有 gain crossover，PM 無定義',
        },
    g > 0
      ? { name: String.raw`$GM$（數值 phase crossover vs $20\log_{10}(g^*/g)$）`, value: finiteOrNull(margins.gmDb), analytic: pm.gmDb, tolerance: 1e-6, unit: 'dB', formulaId: 'F-08.9', claim: 'exact', digits: 6 }
      : { name: String.raw`$GM$`, value: null, unit: 'dB', formulaId: 'F-08.9', note: String.raw`$g\le0$：極性錯誤，GM 無意義` },
    { name: String.raw`Delay margin $DM=PM[\mathrm{rad}]/\omega_c$`, value: finiteOrNull(pm.delayMarginBlocks), unit: 'blocks', formulaId: 'F-08.6', claim: 'exact', note: String.raw`在目前的 $d$ 之外還能額外容忍的純延遲（可非整數）` },
    // d = 0：|δ_k| = ρ^k·|δ_0|，τ 是精確的時間常數；d ≥ 1：ρ 只給漸近的衰減率（ρ^k 不是誤差的包絡），不能標「精確」（技術審查 R02）
    d === 0
      ? {
          name: String.raw`時間常數 $\tau=-1/\ln\rho$`,
          value: stab.rho > 0 && stab.rho < 1 ? -1 / Math.log(stab.rho) : null,
          unit: 'blocks',
          claim: 'exact',
          note: String.raw`$d=0$：平均誤差的大小每個 block 剛好乘上 $\rho=|1-g|$`,
        }
      : {
          name: String.raw`$\tau=-1/\ln\rho$（漸近衰減率）`,
          value: stab.rho > 0 && stab.rho < 1 ? -1 / Math.log(stab.rho) : null,
          unit: 'blocks',
          claim: 'approx',
          note: String.raw`$d\ge1$：$\rho$ 只決定漸近的衰減率，$\rho^k$ 不是平均誤差的包絡（重根、複數根）；逐 block 的暫態可能比 $\tau$ 慢、也可能比它快，請直接看下方的 step response`,
        },
    { name: String.raw`對應 $\mu=g/(K_qC)$`, value: muFs, unit: 'fs', note: String.raw`$\sigma_v=${tsig(mc.sigmaV)}$ fs、$C=1$（$\pm1$ code、identity path）、average GMAC` },
  ]

  // ── 圖（全部 memo：只有參數、cases、MC 結果或主題改變時才重建 Plotly trace） ──
  const kAxis = useMemo(() => indexArray(steps + 1), [steps])
  /** step response 上是否畫 1 ± ρ^k 的點線（發散太快或 g ≤ 0 時不畫） */
  const showRhoLine = stab.rho < 1.2 && g > 0
  const plots = useMemo(() => {
    const caseColor = (i: number) => tokens.series[i % tokens.series.length]
    // Bode
    const bodeMag: Data[] = [
      ...responses.map(({ cs, resp }) => ({
        x: resp.omega,
        y: resp.magDb,
        name: String.raw`Case ${cs.id}：$|L|$（$g=${tsig(cs.params.g)}$）`,
        mode: 'lines' as const,
        line: { color: caseColor(cs.seriesIndex), width: cs.id === cases.activeId ? 2.5 : 1.5 },
      })),
      hLine(0, OMEGAS[0], Math.PI, tokens.textMuted, '0 dB'),
      ...(Number.isFinite(pm.omegaC) ? [vLine(pm.omegaC, -40, 60, tokens.danger, String.raw`$\omega_c = ${fx(pm.omegaC, 4)}$`)] : []),
    ]
    const bodePhase: Data[] = [
      ...responses.map(({ cs, resp }) => ({
        x: resp.omega,
        y: resp.phaseDeg,
        name: String.raw`Case ${cs.id}：$\angle L$（$d=${cs.params.d}$）`,
        mode: 'lines' as const,
        line: { color: caseColor(cs.seriesIndex), width: cs.id === cases.activeId ? 2.5 : 1.5 },
      })),
      hLine(-180, OMEGAS[0], Math.PI, tokens.danger, String.raw`$-180^\circ$`),
      ...(Number.isFinite(pm.omegaC) ? [vLine(pm.omegaC, -180 - 360 * 2, 0, tokens.danger, String.raw`$\omega_c$（$PM = ${fx(pm.pmDeg, 2)}^\circ$）`)] : []),
      vLine(pm.omega180, -180 - 360 * 2, 0, tokens.textMuted, String.raw`$\omega_{180} = \pi/(2d+1) = ${fx(pm.omega180, 4)}$`, 'dash'),
    ]
    const phaseMin = Math.min(...responses.map(({ resp }) => resp.phaseDeg[resp.phaseDeg.length - 1]))

    // Nyquist（|L| > NYQ_R 的部分裁切；z = 1 的 indentation 以 R = NYQ_R 的半圓示意）
    const nyquist: Data[] = []
    for (const { cs } of responses) {
      const r = calLoopResponse(cs.params.g, cs.params.d, NYQ_OMEGAS)
      const xs: number[] = []
      const ys: number[] = []
      for (let i = 0; i < r.omega.length; i++) {
        if (r.mag[i] <= NYQ_R) {
          xs.push(r.re[i])
          ys.push(r.im[i])
        }
      }
      const color = caseColor(cs.seriesIndex)
      nyquist.push({ x: xs, y: ys, name: String.raw`Case ${cs.id}：$\omega \in (0, \pi]$`, mode: 'lines', line: { color, width: 2 } })
      nyquist.push({ x: xs, y: ys.map((v) => -v), name: String.raw`Case ${cs.id}：$\omega \in [-\pi, 0)$（共軛）`, mode: 'lines', line: { color, width: 1, dash: 'dash' } })
    }
    nyquist.push(arcTrace(NYQ_R, 90, -90, tokens.textMuted, String.raw`$z = 1$ 的 indentation（示意，順時針）`))
    nyquist.push(unitCircleTrace(tokens.textMuted, String.raw`$|L| = 1$`))
    nyquist.push({ x: [-1], y: [0], name: String.raw`$-1$ 點`, mode: 'markers', marker: { symbol: 'x', size: 12, color: tokens.danger } })
    if (Number.isFinite(pm.omegaC)) {
      const Lc = calLoopGain(g, d, pm.omegaC)
      nyquist.push({ x: [Lc.re], y: [Lc.im], name: String.raw`crossover（$PM = ${fx(pm.pmDeg, 1)}^\circ$）`, mode: 'markers', marker: { size: 10, color: tokens.accent } })
    }

    // z 平面
    const zPlane: Data[] = [
      unitCircleTrace(tokens.textMuted),
      { x: locus.x, y: locus.y, name: String.raw`根軌跡（$d=${d}$，$g$ 由 $0$ 增加）`, mode: 'markers', marker: { size: 3, color: tokens.textFaint }, hoverinfo: 'skip' },
      poleTrace([{ re: 1, im: 0 }], String.raw`開迴路 pole $z = 1$（GMAC 積分器）`, tokens.textMuted, 'x', 12),
      ...(d > 0 ? [poleTrace([{ re: 0, im: 0 }], String.raw`開迴路 pole $z = 0$（${d} 重，延遲）`, tokens.textMuted, 'x-open', 12)] : []),
      ...cases.cases.map((cs) =>
        poleTrace(delayStable(cs.params.g, cs.params.d).roots, String.raw`Case ${cs.id} 閉迴路 poles（$g=${tsig(cs.params.g)}$, $d=${cs.params.d}$）`, caseColor(cs.seriesIndex), 'circle', 10),
      ),
    ]

    // step response
    const stepTraces: Data[] = [
      ...runs.map(({ cs, run }) => ({
        x: kAxis,
        y: Array.from(run.delta, (v) => 1 - v),
        name: String.raw`Case ${cs.id}：$w_k/a$（$g=${tsig(cs.params.g)}$, $d=${cs.params.d}$）`,
        mode: 'lines+markers' as const,
        marker: { size: 4 },
        line: { color: caseColor(cs.seriesIndex), width: 2, shape: 'hv' as const },
      })),
      hLine(1, 0, steps, tokens.textMuted, String.raw`目標 $a$`),
    ]
    if (showRhoLine) {
      // d = 0 時 w_k/a = 1 − (1 − g)^k 剛好落在 1 ± ρ^k 上（包絡）；d ≥ 1 時 ρ^k 只是漸近速率的參考線，曲線可以跑到線外（技術審查 R02）
      const env = Array.from(kAxis, (k) => stab.rho ** k)
      const rhoName = d === 0 ? String.raw`$1 \pm \rho^k$ 包絡（$\rho = ${fx(stab.rho, 4)}$）` : String.raw`$1 \pm \rho^k$ 漸近速率參考線（$\rho = ${fx(stab.rho, 4)}$）`
      stepTraces.push({ x: kAxis, y: env.map((e) => 1 + e), name: rhoName, mode: 'lines', line: { color: tokens.textFaint, dash: 'dot', width: 1 } })
      stepTraces.push({ x: kAxis, y: env.map((e) => 1 - e), name: String.raw`$1 - \rho^k$`, mode: 'lines', line: { color: tokens.textFaint, dash: 'dot', width: 1 }, showlegend: false })
    }
    if (mcCurrent) {
      const kk = indexArray(mcCurrent.deltaMc.length)
      const se = Array.from(mcCurrent.stdMc, (s) => (1.96 * s) / Math.sqrt(mcCurrent.runs) / mcCurrent.delta0)
      const mean = Array.from(mcCurrent.deltaMc, (v) => 1 - v / mcCurrent.delta0)
      stepTraces.push({ x: kk, y: mean.map((m, i) => m + se[i]), mode: 'lines', line: { width: 0 }, showlegend: false, hoverinfo: 'skip', name: 'MC +95%' })
      stepTraces.push({
        x: kk,
        y: mean.map((m, i) => m - se[i]),
        mode: 'lines',
        line: { width: 0 },
        fill: 'tonexty',
        fillcolor: withAlpha(tokens.series[3], 0.25),
        name: 'MC ensemble 95% CI',
        hoverinfo: 'skip',
      })
      stepTraces.push({ x: kk, y: mean, name: `MC：真實 block sign-LMS 平均（${mcCurrent.runs} seeds）`, mode: 'lines', line: { color: tokens.series[3], width: 2 } })
    }
    const allStep = runs.flatMap(({ run }) => Array.from(run.delta).filter(Number.isFinite).map((v) => 1 - v))
    const clipped = Math.max(...allStep, 1.2) > 4 || Math.min(...allStep, -0.2) < -2.5
    const absTraces: Data[] = runs.map(({ cs, run }) => ({
      x: kAxis,
      y: Array.from(run.delta, (v) => Math.abs(v)),
      name: String.raw`Case ${cs.id}：$|\delta_k|/\delta_0$`,
      mode: 'lines',
      line: { color: caseColor(cs.seriesIndex), width: 2 },
    }))
    return { bodeMag, bodePhase, phaseMin, nyquist, zPlane, stepTraces, clipped, absTraces }
  }, [responses, runs, locus, cases.cases, cases.activeId, tokens, pm, stab, g, d, steps, kAxis, mcCurrent, showRhoLine])
  const { bodeMag, bodePhase, phaseMin, nyquist, zPlane, stepTraces, clipped, absTraces } = plots
  const bodePhaseLayout = useMemo<Partial<Layout>>(
    () => ({ xaxis: { title: { text: String.raw`$\omega$ [rad/block]` }, dtick: 1 }, yaxis: { title: { text: String.raw`$\angle L$ [deg]` }, range: [Math.min(-200, phaseMin - 20), -60] } }),
    [phaseMin],
  )
  const stepLayout = useMemo<Partial<Layout>>(
    () => ({ xaxis: { title: { text: '$k$ [block]' } }, yaxis: { title: { text: '$w_k / a$' }, ...(clipped ? { range: [-2.5, 4] } : {}) } }),
    [clipped],
  )

  const exportData = () => {
    const act = responses.find((r) => r.cs.id === cases.activeId)!.resp
    const cols: Record<string, ArrayLike<number | string | null>> = {
      omega_rad_per_block: act.omega,
      L_mag_db: act.magDb,
      L_phase_deg_unwrapped: act.phaseDeg,
      k_block: kAxis,
    }
    for (const { cs, run } of runs) cols[`case_${cs.id}_w_over_a_g${cs.params.g}_d${cs.params.d}`] = Array.from(run.delta, (v) => 1 - v)
    cols.pole_re = stab.roots.map((z) => z.re)
    cols.pole_im = stab.roots.map((z) => z.im)
    cols.table_d = table.map((r) => r.d)
    cols.table_g_crit_closed = table.map((r) => r.gCritClosed)
    cols.table_g_crit_numeric = table.map((r) => r.gCritNumeric)
    cols.table_omega_crit_rad = table.map((r) => r.omegaCrit)
    if (mcCurrent) {
      cols.mc_delta_mean_fs = mcCurrent.deltaMc
      cols.mc_delta_std_fs = mcCurrent.stdMc
      cols.mc_delta_linear_fs = mcCurrent.deltaLin
    }
    return cols
  }

  return (
    <ExperimentShell
      id={PM_LAB_ID}
      title={String.raw`Phase Margin Lab：$L(z)=g\,z^{-d}/(z-1)$`}
      level="L1"
      claim="exact"
      tests={['T08']}
      description={
        <>
          控制正規化 loop gain <Tex>{'g=\\mu K_qC'}</Tex> 與更新延遲 <Tex>{'d'}</Tex>（blocks），即時計算開迴路 Bode、Nyquist、閉迴路 poles、step response 與穩定界限表。所有封閉式都和「數值求根／數值 crossover」交叉比對。
        </>
      }
      assumptions={[
        String.raw`$G_k=K\,(a-w_{k-d})$：GMAC 輸出對 $\delta$ 線性（小誤差線性化，$K=K_qC>0$）`,
        String.raw`block-rate 離散時間；$d$ 為整數 block 的純更新延遲（sample → accumulate → commit → apply）`,
        String.raw`$\delta=a-w$；$a$ 為常數、$w_0=0$，block $k$ 的 DTC 使用 $w_{\max(0,\,k-d)}$（與 blockLms 相同），所以 $k<0$ 的歷史 $\delta=\delta_0$；$w_k/a$ 即閉迴路 step response`,
        String.raw`Monte Carlo（選用）：blockLms 真實 block sign-LMS、iid $\pm1$ code、identity path、$\sigma_v$ 白雜訊、浮點暫存器；$\mu=g/K_q$`,
      ]}
      params={{ g, d, steps, case: cases.activeId, mc_sigma_v_fs: mc.sigmaV, mc_N: mc.N, mc_delta0_fs: mc.delta0, mc_runs: mc.runs, mc_blocks: mc.blocks }}
      seed={seed}
      onSeedChange={setCaseSeed}
      units={{ g: '無因次', d: 'blocks', steps: 'blocks', mc_sigma_v_fs: 'fs', mc_N: 'samples', mc_delta0_fs: 'fs', mc_blocks: 'blocks' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: { status: check.ok ? 'ok' : 'mismatch', note: analyticNote },
        monteCarlo: mcCheck,
        fixedPoint: { status: 'not-implemented', note: '定點暫存器（L5）版本未在本實驗實作；見 Ch13 / Calibration Lab' },
      }}
      actions={{
        onReset: () => {
          resetCases(DEFAULT_CASE)
          setSteps(40)
          setMc(DEFAULT_MC)
          setMcState(null)
        },
        onRun,
        onStop: () => mcTask.cancel(),
        running: mcTask.running,
      }}
      exportData={exportData}
      presets={presets}
      onLoadPreset={(p) => applyParams(p.params)}
      controls={
        <>
          <CaseSelector cases={cases} />
          <ParamControl
            label={<Tex>{'g=\\mu K_qC'}</Tex>}
            ariaLabel="g（正規化 loop gain）"
            value={g}
            onChange={(v) => updateCase({ g: v })}
            min={-1}
            max={3}
            step={0.001}
            unit="無因次"
            reg="REG_CAL_MU × K_q·C（behavioral：g）"
            hint={rich(String.raw`$d=0$：$0<g<2$ 穩定；$g\le0$ 為極性錯誤或沒有更新`)}
          />
          <ParamControl
            label={<Tex>{'d'}</Tex>}
            ariaLabel="d（更新延遲 blocks）"
            value={d}
            onChange={(v) => updateCase({ d: v })}
            min={0}
            max={6}
            integer
            clampOnBlur
            unit="blocks"
            reg="cal_update_delay_blocks（GMAC commit→apply pipeline）"
            hint={<Tex>{`g^*(${d})=2\\sin\\frac{\\pi}{${4 * d + 2}}=${fx(pm.gCrit, 6)}`}</Tex>}
          />
          <ParamControl
            label={rich(String.raw`模擬長度 $N_{\mathrm{blk}}$`)}
            ariaLabel="模擬長度（blocks）"
            value={steps}
            onChange={setSteps}
            min={5}
            max={400}
            integer
            clampOnBlur
            unit="blocks"
            reg="num_blocks（behavioral）"
          />
          <details className="ch08-mc-settings">
            <summary>Monte Carlo 設定（真實 block sign-LMS）</summary>
            <ParamControl label={rich(String.raw`$\sigma_v$（comparator 前雜訊）`)} ariaLabel="σ_v（comparator 前雜訊）" value={mc.sigmaV} onChange={(v) => setMc({ ...mc, sigmaV: v })} min={1} max={1000} log unit="fs" reg="pd_noise_rms_fs" />
            <ParamControl label={rich(String.raw`$N$（GMAC 累加長度）`)} ariaLabel="N（GMAC 累加長度）" value={mc.N} onChange={(v) => setMc({ ...mc, N: v })} min={64} max={16384} integer clampOnBlur unit="samples" reg="REG_GMAC_N（gm_accum_samples）" />
            <ParamControl label={rich(String.raw`$\delta_0=a-w_0$`)} ariaLabel="δ₀ = a − w₀" value={mc.delta0} onChange={(v) => setMc({ ...mc, delta0: v })} min={0.5} max={200} unit="fs" reg="gain_true − gain_initial" hint={rich(String.raw`$\delta_0/\sigma_v$ 越大，sign 非線性（erf）越偏離線性模型`)} />
            <ParamControl label="runs（seeds）" value={mc.runs} onChange={(v) => setMc({ ...mc, runs: v })} min={4} max={64} integer clampOnBlur unit="runs" reg="Monte Carlo runs（behavioral）" />
            <ParamControl label="MC blocks" value={mc.blocks} onChange={(v) => setMc({ ...mc, blocks: v })} min={10} max={300} integer clampOnBlur unit="blocks" reg="num_blocks（MC）" />
            <p className="small muted">
              <Tex>{`\\mu=g/K_q=${sig(muFs, 5)}\\ \\mathrm{fs}`}</Tex>；每次約 {sig((mc.N * mc.blocks * mc.runs) / 1e6, 3)} M 個 comparator samples（在 Web Worker 執行）。
            </p>
          </details>
        </>
      }
    >
      <div className="grid-2">
        <Plot
          title={String.raw`Bode：$|L(e^{j\omega})|$ [dB]`}
          ariaLabel="Bode 大小圖：開迴路增益對頻率"
          data={bodeMag}
          xLog
          height={280}
          csvName="pm-lab-bode-mag"
          layout={BODE_MAG_LAYOUT}
          caption={rich(String.raw`$|L(e^{j\omega})|=\frac{|g|}{2\sin(\omega/2)}$ 與 $d$ 無關：延遲只改相位。紅色點線是 gain crossover $\omega_c=2\arcsin(g/2)$。`)}
        />
        <Plot
          title={String.raw`Bode：$\angle L(e^{j\omega})$（由低頻連續展開）`}
          ariaLabel="Bode 相位圖：開迴路相位對頻率"
          data={bodePhase}
          xLog
          height={280}
          csvName="pm-lab-bode-phase"
          layout={bodePhaseLayout}
          caption={rich(
            String.raw`$\angle L=-90^\circ-(d+\tfrac12)\omega$；$PM=180^\circ+\angle L(e^{j\omega_c})$＝曲線在 $\omega_c$ 處離 $-180^\circ$ 線的距離。$g<0$（極性錯誤）時負號等於多 $180^\circ$ 的 lag：曲線由 $-270^\circ$ 起算，永遠在 $-180^\circ$ 以下。`,
          )}
        />
      </div>
      <div className="grid-2">
        <Plot
          title={String.raw`Nyquist：$L(e^{j\omega})$，$\omega\in[-\pi,\pi]$`}
          ariaLabel="Nyquist 圖：開迴路增益的複數平面軌跡"
          data={nyquist}
          height={440}
          csvName="pm-lab-nyquist"
          layout={NYQUIST_LAYOUT}
          caption={rich(
            String.raw`$|L|>${NYQ_R}$ 的部分已裁切；$z=1$ 的積分器 pole 以向外的小半圓繞過（對應 $L$ 平面右側的大半圓，實際半徑 $\to\infty$，圖上以半徑 $${NYQ_R}$ 示意）。$d=0$ 時曲線是直線 $\mathrm{Re}\,L=-g/2$；曲線不包圍 $-1$ 點 $\iff$ 穩定。`,
          )}
        />
        <Plot
          title={String.raw`$z$ 平面：閉迴路 poles 與根軌跡`}
          ariaLabel="z 平面：閉迴路 poles 與根軌跡"
          data={zPlane}
          height={440}
          csvName="pm-lab-poles"
          layout={Z_PLANE_LAYOUT}
          caption={rich(String.raw`灰點：$g$ 由 $0$ 增加時的根軌跡；從 $z=1$ 與 $z=0$ 出發，$g=g^*$ 時穿越單位圓（角度 $\omega^*=\frac{\pi}{2d+1}$）。`)}
        />
      </div>
      <div className="grid-2">
        <Plot
          title={String.raw`Step response：$w_k/a$（目標在 $k=0$ 跳一步）`}
          ariaLabel="Step response：係數對目標的比值"
          data={stepTraces}
          height={340}
          csvName="pm-lab-step"
          layout={stepLayout}
          caption={rich(stepCaption(clipped, showRhoLine, d))}
        />
        <Plot
          title={String.raw`$|\delta_k|/\delta_0$（log 軸：長期斜率 $=\log_{10}\rho$）`}
          ariaLabel="誤差大小對 block（log 軸）"
          data={absTraces}
          yLog
          height={340}
          csvName="pm-lab-abs-delta"
          layout={ABS_LAYOUT}
          caption={rich(
            String.raw`log 軸上 $\rho^k$ 是直線，斜率 $\log_{10}\rho$：往下＝收斂、水平＝臨界、往上＝發散。$d=0$ 時 $|\delta_k|/\delta_0$ 就是這條直線；$d\ge1$ 時只有長期的斜率是 $\log_{10}\rho$（複數根會週期性往下探，重根多一個 $k$ 的因子）。`,
          )}
        />
      </div>
      {mcCurrent && (
        <p className="small muted">
          {rich(
            String.raw`Monte Carlo：blockLms 回報 $g=${tsig(mcCurrent.gEff, 6)}$（由實際 code 估計 $C$）；線性化容許量 $${tsig(mcCurrent.cmp.linAllowance, 3)}$ fs（$\mathrm{erf}$ 的三次項 $\approx\delta_0(\delta_0/\sigma_v)^2/6$ 再加 $1\%\,\delta_0$）、Student-t 臨界值 $${tsig(mcCurrent.cmp.tCrit, 3)}$（對 $${mcCurrent.deltaMc.length}$ 個 block 做 Bonferroni 校正）。`,
          )}
          {mcCurrent.warnings.length > 0 ? `blockLms 警告：${mcCurrent.warnings.join('；')}` : ''}
        </p>
      )}
      <div className="table-wrap">
        <table className="ch08-table">
          <caption>{rich(String.raw`穩定界限表（$d=0\ldots6$）：封閉式 vs 數值求根，以及目前 $g=${sig(g)}$ 在每個 $d$ 下的結果`)}</caption>
          <thead>
            <tr>
              <th className="num">{rich(String.raw`$d$`)}</th>
              <th className="num">{rich(String.raw`$g^*=2\sin\frac{\pi}{4d+2}$`)}</th>
              <th className="num">{rich(String.raw`$g^*$（數值）`)}</th>
              <th className="num">{rich(String.raw`$\omega^*=\frac{\pi}{2d+1}$`)}</th>
              <th className="num">{rich(String.raw`$PM_d(g)$ [°]`)}</th>
              <th className="num">{rich(String.raw`$GM_d(g)$ [dB]`)}</th>
              <th>{rich(String.raw`目前 $g$`)}</th>
            </tr>
          </thead>
          <tbody>
            {table.map((row) => {
              const p = pmWithDelay(g, row.d)
              const v = verdict(g, row.d)
              return (
                <tr key={row.d} className={row.d === d ? 'ch08-row-active' : undefined}>
                  <td className="num">{row.d}</td>
                  <td className="num mono">{fx(row.gCritClosed, 6)}</td>
                  <td className="num mono">{fx(row.gCritNumeric, 6)}</td>
                  <td className="num mono">{fx(row.omegaCritDeg, 2)}°</td>
                  <td className="num mono">{fx(p.pmDeg, 2)}</td>
                  <td className="num mono">{fx(p.gmDb, 2)}</td>
                  <td className={`ch08-verdict ch08-verdict-${v.kind}`}>{v.label}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Callout kind="info" title="試試看">
        <ul className="ch08-try">
          <li>{rich(String.raw`$g=1,\ d=0$：pole 在 $${tx(TRY.g1.pole, 0)}$，一步到位（deadbeat）；$PM=${tx(TRY.g1.pmDeg, 0)}^\circ$、$DM=${tx(TRY.g1.delayMarginBlocks, 0)}$ block。`)}</li>
          <li>{rich(String.raw`再把 $d$ 改成 $1$：$g=1$ 剛好等於 $g^*(1)=${tx(TRY.gStar1, 0)}$ → 臨界振盪（週期 $${tx(TRY.periodD1, 0)}$ block，根的角度 $\pi/3$）。`)}</li>
          <li>{rich(String.raw`$g=1.5,\ d=0$：$PM=${tx(TRY.g15.pmDeg, 1)}^\circ$，$DM$ 只有 $${tx(TRY.g15.delayMarginBlocks, 3)}$ block → 只要 $d=1$ 就發散。`)}</li>
          <li>
            {rich(
              String.raw`$d=2,\ g=0.65$：一階模型說穩定（$0<g<2$），實際 $\rho=${tx(TRY.rhoD2, 4)}>1$、$PM_2=${tx(TRY.d2.pmDeg, 1)}^\circ<0$。把 MC blocks 調到 $300$ 再按「執行 Run」：線性模型指數成長，真實 sign-LMS 的 ensemble 平均卻停在 $\sigma_v$ 量級的有界 limit cycle（仍然是失敗——它不會收斂到 $a$）。`,
            )}
          </li>
          <li>{rich(String.raw`$g=-0.1$：極性錯誤，pole $${tx(TRY.neg.pole, 1)}>1$，Nyquist 曲線跑到右半平面（$\mathrm{Re}\,L=-g/2>0$），Bode 相位由 $-270^\circ$ 起算。`)}</li>
        </ul>
      </Callout>
    </ExperimentShell>
  )
}
