import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Dash, Data, Layout } from 'plotly.js-dist-min'
import {
  Callout,
  CaseSelector,
  ClaimTag,
  ExperimentShell,
  ParamControl,
  Plot,
  SelectControl,
  Tex,
  ToggleControl,
  useCases,
  useThemeTokens,
  type CheckEntry,
  type CsvColumns,
  type ExperimentPreset,
  type MetricRow,
  type ThemeTokens,
  type UseCasesResult,
} from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { cAbs, cToString, type Complex } from '@/simulation/core'
import {
  analyzeDualLoop,
  analyzeGeneral,
  calLoopGainGeneral,
  dualLoopGainMargin,
  dualLoopRootLocus,
  logOmegaGrid,
  loopMargins,
  loopResponse,
  observationTransfer,
  peakAbs,
  pmFirstOrder,
  simulateFullModel,
  simulateGeneral,
  simulateQuasiStatic,
  stableIntervalsNumeric,
  type DualLoopParams,
  type ObservationSystem,
} from '@/simulation/models/stability'
import { hLine, indexArray, poleTrace, unitCircleTrace, vLine, zPlaneLayout } from './plotHelpers'
import { MatrixEditor } from './MatrixEditor'
import { fx, rich, sig, tsig, tx } from '../common'

export const DUAL_LOOP_ID = 'dual-loop'

type Mode = 'two-state' | 'general'

interface GeneralState {
  A: number[][]
  b: number[]
  c: number[]
  d: number
  mu: number
  /** μ 掃描上限（找穩定區間用） */
  muScanMax: number
}

const DEFAULT_CASE: DualLoopParams = { r: 0.8, b: 0.2, c: 1, mu: 1.2 }
const DEFAULT_GENERAL: GeneralState = { A: [[0.8]], b: [0.2], c: [1], d: 0, mu: 1.2, muScanMax: 5 }

interface ViewModel {
  metrics: MetricRow[]
  warnings: string[]
  crossCheck: { analytic: CheckEntry; monteCarlo: CheckEntry; fixedPoint: CheckEntry }
  params: Record<string, unknown>
  plots: { zPlane: Data[]; time: Data[]; sweep: Data[]; bodeMag: Data[]; bodePhase: Data[] }
  sweepRange: number
  exportData: () => CsvColumns
  summary: { fullStable: boolean; simplifiedStable: boolean; rho: number; simplifiedPole: number }
}

const finiteOrNull = (x: number): number | null => (Number.isFinite(x) ? x : null)
/** 圖表用：非有限值（r_s = 1 時 quasi-static 的 ±∞／NaN）改成 null，Plotly 會畫成斷點而不是把座標軸撐爆 */
const finiteSeries = (xs: ArrayLike<number>): (number | null)[] => Array.from(xs, finiteOrNull)
const maxAbs = (zs: Complex[]) => zs.reduce((m, z) => Math.max(m, cAbs(z)), 0)
const BODE_OMEGAS = logOmegaGrid(400, 1e-3, Math.PI)

// 固定的 Plot layout 放在模組層級（物件參考不變 ⇒ 重新渲染時不會多打一次 Plotly.react、也不會重設使用者的縮放）
const Z_PLANE_LAYOUT = zPlaneLayout(1.6)
const BODE_MAG_LAYOUT: Partial<Layout> = { xaxis: { title: { text: String.raw`$\omega$ [rad/block]` }, dtick: 1 }, yaxis: { title: { text: 'dB' }, range: [-30, 50] } }
/** Bode 圖兩個模式共用的 trace 名稱（數學寫 `$...$`，Plot 會轉成斜體符號） */
const BODE_FULL_NAME = String.raw`完整 $L = \mu F(z)/(z - 1)$`
const BODE_QS_NAME = String.raw`quasi-static $\mu F(1)/(z - 1)$`
const BODE_MINUS_180_NAME = String.raw`$-180^\circ$`
const BODE_PHASE_LAYOUT: Partial<Layout> = { xaxis: { title: { text: String.raw`$\omega$ [rad/block]` }, dtick: 1 }, yaxis: { title: { text: 'deg' } } }

/** 「試試看」提示用到的數字：全部由模型計算（不手寫） */
const TRY = (() => {
  const g5 = analyzeDualLoop(DEFAULT_CASE)
  const slow = analyzeDualLoop({ ...DEFAULT_CASE, mu: 0.5 })
  const tauSimp = -1 / Math.log(Math.abs(slow.simplifiedPole))
  const tauFull = -1 / Math.log(slow.rho)
  return {
    g5,
    peak30: peakAbs(simulateFullModel(DEFAULT_CASE, 30).delta, 0, 30),
    growthPct: (g5.rho - 1) * 100,
    slow,
    tauSimp,
    tauFull,
  }
})()

function rhoClosedForm(p: DualLoopParams): number {
  const disc = (1 - p.r) ** 2 - 4 * p.mu * p.b * p.c
  if (disc < 0) return Math.sqrt(p.r + p.mu * p.b * p.c) // 複數共軛對：|z|² = 常數項
  const s = Math.sqrt(disc)
  return Math.max(Math.abs((1 + p.r + s) / 2), Math.abs((1 + p.r - s) / 2))
}

/**
 * Bode 曲線（大小 dB、展開相位）：直接用模型的 loopResponse（與 PM Lab、loopMargins 同一套展開相位）。
 * negativeGain：低頻增益為負（等效 K = F(1) < 0）時採 lag 分支，相位由 −270° 起算，避免被誤讀成「PM ≈ 270°」。
 */
function bodeTraces(
  label: string,
  L: (w: number) => Complex,
  color: string,
  dash: Dash,
  negativeGain = false,
): { mag: Data; phase: Data } | null {
  try {
    const resp = loopResponse(L, BODE_OMEGAS, negativeGain)
    return {
      mag: { x: BODE_OMEGAS, y: finiteSeries(resp.magDb), name: label, mode: 'lines', line: { color, dash, width: 2 } },
      phase: { x: BODE_OMEGAS, y: finiteSeries(resp.phaseDeg), name: label, mode: 'lines', line: { color, dash, width: 2 } },
    }
  } catch {
    return null // z = e^{jω} 恰為 A_s 的 eigenvalue：F 在單位圓上有極點
  }
}

/** PM／GM 的定義前提不成立時，指標顯示「—」並說明原因（不可顯示一個看似很大的正 PM） */
function marginPrecondition(dcGain: number, observerRho: number): string | null {
  if (!Number.isFinite(dcGain)) return String.raw`等效 $K=F(1)$ 不存在（觀測含 $z=1$ 的積分器）：$L$ 在低頻不是單一積分器，PM／GM 依定義不適用，請看 $\rho$`
  if (dcGain <= 0) return String.raw`等效 $K=F(1)\le0$（極性錯誤或沒有恢復力）：相位由 $-270^\circ$ 起算，PM／GM 依定義不適用，請看 $\rho$`
  if (observerRho >= 1) return String.raw`觀測狀態本身不穩定（開迴路在單位圓上或圓外有 pole）：Bode 的 PM／GM 讀法不適用（需用完整 Nyquist 判據），請看 $\rho$`
  return null
}

/** 二狀態模式（r_s, b_s, c_s, μ）的所有計算 */
function useTwoStateModel(cases: UseCasesResult<DualLoopParams>, steps: number, tokens: ThemeTokens, signed: boolean): ViewModel {
  const p = cases.active.params
  return useMemo(() => {
    const a = analyzeDualLoop(p)
    const bc = p.b * p.c
    const sweepRange = Math.max(
      Number.isFinite(a.simplifiedRange.hi) ? 1.5 * a.simplifiedRange.hi : 0,
      Number.isFinite(a.fullRange.hi) ? 2.5 * a.fullRange.hi : 0,
      1.5 * p.mu,
      0.5,
    )
    const numeric = stableIntervalsNumeric((mu) => analyzeDualLoop({ ...p, mu }).rho, 0, sweepRange, 801)
    const numHi = numeric.length > 0 ? numeric[0].hi : NaN
    const numLo = numeric.length > 0 ? numeric[0].lo : NaN
    const sys: ObservationSystem = { A: [[p.r]], b: [p.b], c: [p.c], d: 0 }
    // PM／GM 只在「等效 K = F(1) > 0 且觀測狀態穩定」時有定義；否則顯示 — 並說明原因
    const marginNote = marginPrecondition(a.dcGain, Math.abs(p.r))
    const gEff = p.mu * a.dcGain
    let pmFull = NaN
    let gmFull = NaN
    if (!marginNote && gEff > 0) {
      try {
        const m = loopMargins((w) => calLoopGainGeneral(sys, p.mu, w), { omegaMin: Math.min(1e-4, gEff / 100) })
        pmFull = m.pmDeg
        gmFull = m.gmDb
      } catch {
        pmFull = NaN
      }
    }
    const pmSimp = pmFirstOrder(gEff)
    const gmCf = dualLoopGainMargin(p) // 封閉式：GM_完整 = 1/g_eff、GM_簡化 = 2/g_eff（F-08.16）
    const rhoEig = maxAbs(a.polesEig)
    const rhoCf = rhoClosedForm(p)

    // ── 時域（所有 cases） ──
    const k = indexArray(steps + 1)
    const time: Data[] = []
    const deltaName = signed ? String.raw`$\delta_k$` : String.raw`$|\delta_k|$`
    for (const cs of cases.cases) {
      const color = tokens.series[cs.seriesIndex % tokens.series.length]
      const full = simulateFullModel(cs.params, steps).delta
      const simp = simulateQuasiStatic(cs.params, steps)
      const shape = (v: number) => (signed ? v : Math.abs(v))
      time.push({ x: k, y: finiteSeries(Array.from(full, shape)), name: String.raw`Case ${cs.id} 完整：${deltaName}（$\mu=${tsig(cs.params.mu)}$）`, mode: 'lines', line: { color, width: 2 } })
      time.push({ x: k, y: finiteSeries(Array.from(simp, shape)), name: `Case ${cs.id} quasi-static：${deltaName}`, mode: 'lines', line: { color, width: 1.5, dash: 'dash' } })
    }
    // ρ^k 只是漸近速率的參考線，不是 |δ_k| 的包絡：峰值可高出一個常數倍（預設 μ = 1.2 約 2%），重根（預設的 r_s、b_s、c_s 在 μ = 0.05）是 (1 + k/9)·0.9^k（技術審查 R02）
    const env = finiteSeries(Array.from(k, (kk) => a.rho ** kk))
    time.push({ x: k, y: env, name: String.raw`$\rho^k$ 參考線（漸近速率，$\rho = ${fx(a.rho, 4)}$）`, mode: 'lines', line: { color: tokens.textFaint, dash: 'dot', width: 1 } })
    if (signed) time.push({ x: k, y: env.map((e) => (e === null ? null : -e)), name: String.raw`$-\rho^k$`, mode: 'lines', line: { color: tokens.textFaint, dash: 'dot', width: 1 }, showlegend: false })

    // ── z 平面 ──
    const sweepMus = Array.from({ length: 240 }, (_, i) => (sweepRange * (i + 1)) / 240)
    const loc = dualLoopRootLocus(p.r, p.b, p.c, sweepMus).flat()
    const zPlane: Data[] = [
      unitCircleTrace(tokens.textMuted),
      { x: loc.map((z) => z.re), y: loc.map((z) => z.im), name: String.raw`完整模型根軌跡（$\mu$ 由 $0$ 增加）`, mode: 'markers', marker: { size: 3, color: tokens.textFaint }, hoverinfo: 'skip' },
      poleTrace([{ re: p.r, im: 0 }, { re: 1, im: 0 }], String.raw`$\mu = 0$ 的起點 $z = r_s, 1$`, tokens.textMuted, 'x', 11),
      ...cases.cases.map((cs) => {
        const color = tokens.series[cs.seriesIndex % tokens.series.length]
        return poleTrace(analyzeDualLoop(cs.params).poles, String.raw`Case ${cs.id} 完整 poles（$\mu=${tsig(cs.params.mu)}$）`, color, 'circle', 10)
      }),
      ...cases.cases.map((cs) => {
        const color = tokens.series[cs.seriesIndex % tokens.series.length]
        const sp = analyzeDualLoop(cs.params).simplifiedPole
        return poleTrace(Number.isFinite(sp) ? [{ re: sp, im: 0 }] : [], `Case ${cs.id} quasi-static pole`, color, 'diamond-open', 11)
      }),
    ]

    // ── ρ(μ) 掃描 ──
    const rhoFull = sweepMus.map((mu) => analyzeDualLoop({ ...p, mu }).rho)
    const rhoSimp = sweepMus.map((mu) => Math.abs(1 - (mu * bc) / (1 - p.r)))
    const yTop = 1.6
    const sweep: Data[] = [
      { x: sweepMus, y: rhoFull, name: String.raw`完整模型 $\rho(\mathbf A)$`, mode: 'lines', line: { color: tokens.series[0], width: 2 } },
      { x: sweepMus, y: finiteSeries(rhoSimp), name: String.raw`quasi-static $|1 - \mu b_s c_s/(1 - r_s)|$`, mode: 'lines', line: { color: tokens.series[1], width: 2, dash: 'dash' } },
      hLine(1, 0, sweepRange, tokens.danger, String.raw`$\rho = 1$`),
      ...(Number.isFinite(a.fullRange.hi) ? [vLine(a.fullRange.hi, 0, yTop, tokens.series[0], String.raw`$(1 - r_s)/(b_s c_s) = ${tsig(a.fullRange.hi, 5)}$`, 'dash')] : []),
      ...(Number.isFinite(a.simplifiedRange.hi) ? [vLine(a.simplifiedRange.hi, 0, yTop, tokens.series[1], String.raw`$2(1 - r_s)/(b_s c_s) = ${tsig(a.simplifiedRange.hi, 5)}$`, 'dash')] : []),
      ...(Number.isFinite(a.muComplex) && a.muComplex < sweepRange ? [vLine(a.muComplex, 0, yTop, tokens.textMuted, String.raw`複數門檻 $(1 - r_s)^2/(4 b_s c_s) = ${tsig(a.muComplex, 4)}$`, 'dot')] : []),
      { x: [p.mu], y: [a.rho], name: String.raw`目前 $\mu = ${tsig(p.mu)}$`, mode: 'markers', marker: { size: 10, color: tokens.accent } },
    ]

    // ── Bode：完整 vs quasi-static ──
    const negGain = Number.isFinite(gEff) && gEff < 0
    const bf = bodeTraces(BODE_FULL_NAME, (w) => calLoopGainGeneral(sys, p.mu, w), tokens.series[0], 'solid', negGain)
    const bs = Number.isFinite(a.dcGain)
      ? bodeTraces(BODE_QS_NAME, (w) => calLoopGainGeneral({ A: [], b: [], c: [], d: a.dcGain }, p.mu, w), tokens.series[1], 'dash', negGain)
      : null
    const bodeMag = [bf?.mag, bs?.mag, hLine(0, BODE_OMEGAS[0], Math.PI, tokens.textMuted, '0 dB')].filter(Boolean) as Data[]
    const bodePhase = [
      bf?.phase,
      bs?.phase,
      hLine(-180, BODE_OMEGAS[0], Math.PI, tokens.danger, BODE_MINUS_180_NAME),
      ...(Number.isFinite(gmCf.omega180) ? [vLine(gmCf.omega180, -360, 0, tokens.textMuted, String.raw`$\omega_{180} = \arccos((1 + r_s)/2) = ${fx(gmCf.omega180, 4)}$`, 'dot')] : []),
    ].filter(Boolean) as Data[]

    // ── 警告 ──
    const warnings: string[] = []
    if (bc < 0)
      warnings.push(
        String.raw`$b_sc_s=${tsig(bc)}<0$：觀測極性錯誤（等效 $K=F(1)=\frac{b_sc_s}{1-r_s}${a.dcGain < 0 ? '<0' : ''}$），$P(1)=\mu b_sc_s>0$ 要求 $\mu<0$，任何正 $\mu$ 都不穩定。先修正 GMAC 的相關極性（Ch06/Ch07）。`,
      )
    else if (bc === 0)
      warnings.push(String.raw`$b_sc_s=0$：$\delta$ 完全不影響 $G$（不可觀測）。特徵式 $(z-r_s)(z-1)$ 恆有 $z=1$ 的根，校正迴路沒有恢復力。`)
    if (Math.abs(p.r) >= 1)
      warnings.push(String.raw`$|r_s|=${tsig(Math.abs(p.r))}\ge1$：觀測狀態本身不收斂，沒有「穩態 $s=\frac{b_s\delta}{1-r_s}$」，quasi-static 前提不存在。`)
    if (a.marginal) warnings.push(String.raw`$\rho=${tsig(a.rho, 8)}=1$：完整模型臨界（marginal），誤差持續振盪不衰減，不可視為穩定。`)
    else if (!a.stable && a.simplifiedStable)
      warnings.push(
        String.raw`完整模型發散（$\rho=${tsig(a.rho, 6)}>1$），但 quasi-static 簡化模型預測穩定（pole $=${tsig(a.simplifiedPole, 4)}$）。` +
          String.raw`完整上界 $\mu<\frac{1-r_s}{b_sc_s}=${tsig(a.fullRange.hi, 5)}$ 恰為簡化上界 $${tsig(a.simplifiedRange.hi, 5)}$ 的一半（勘誤 E19）：差異來自觀測路徑的一個 block sample→observe latency（$G_k$ 只看到由 $\delta_{k-1}$ 驅動的 $s_k$），不是主迴路不夠快——把 $r_s$ 調小也不會讓簡化界限變對。`,
      )
    else if (!a.stable)
      warnings.push(String.raw`完整模型發散（$\rho=${tsig(a.rho, 6)}>1$），quasi-static 也不穩定（pole $=${tsig(a.simplifiedPole, 4)}$）：$\mu$ 太大，或極性／觀測前提不成立（見其他警告）。`)

    const rangeOk =
      (a.fullRange.empty && numeric.length === 0) ||
      (!a.fullRange.empty && numeric.length === 1 && Math.abs(numHi - a.fullRange.hi) < 1e-6 && Math.abs(numLo - a.fullRange.lo) < 1e-6)
    // 頻域交叉比對：數值 phase crossover 的 GM vs 封閉式 20log10(1/g_eff)（只在 PM／GM 有定義時比）
    const gmOk = !Number.isFinite(gmFull) || !Number.isFinite(gmCf.gmFullDb) || Math.abs(gmFull - gmCf.gmFullDb) < 1e-6
    const analyticOk = Math.abs(rhoEig - a.rho) < 1e-9 && Math.abs(rhoCf - a.rho) < 1e-9 && rangeOk && gmOk

    const fullTraj = simulateFullModel(p, steps).delta
    const lastFull = fullTraj[steps]
    const lastSimp = simulateQuasiStatic(p, steps)[steps]
    // 複數 pole 時，單一時間點可能剛好落在零交越附近：另報「最後一個振盪週期內的峰值」
    const topPole = a.poles.find((z) => z.im > 0)
    const period = topPole ? Math.ceil((2 * Math.PI) / Math.atan2(topPole.im, topPole.re)) : 1
    const lastPeak = peakAbs(fullTraj, steps - period, steps)
    const metrics: MetricRow[] = [
      { name: String.raw`完整 poles（$z^2-(1+r_s)z+(r_s+\mu b_sc_s)$ 的根）`, value: a.poles.map((z) => cToString(z, 4)).join('、'), formulaId: 'F-08.10', claim: 'exact' },
      { name: String.raw`$\rho$（$\mathrm{eig}(\mathbf A)$ vs 封閉式 $\sqrt{r_s+\mu b_sc_s}$／實根）`, value: rhoEig, analytic: rhoCf, tolerance: 1e-9, formulaId: 'F-08.12', claim: 'exact', digits: 8 },
      { name: String.raw`quasi-static pole $1-\frac{\mu b_sc_s}{1-r_s}$`, value: a.simplifiedPole, formulaId: 'F-08.15', claim: 'approx' },
      a.fullRange.empty
        ? { name: String.raw`完整模型 $\mu$ 穩定區間`, value: '空集合', note: a.fullRange.note, formulaId: 'F-08.11', claim: 'exact' }
        : { name: String.raw`完整 $\mu$ 上界（數值掃描 vs $\frac{1-r_s}{b_sc_s}$）`, value: finiteOrNull(numHi), analytic: a.fullRange.hi, tolerance: 1e-6, formulaId: 'F-08.11', claim: 'exact', digits: 8 },
      a.simplifiedRange.empty
        ? { name: String.raw`quasi-static $\mu$ 穩定區間`, value: '空集合', note: a.simplifiedRange.note, formulaId: 'F-08.11', claim: 'approx' }
        : { name: String.raw`quasi-static $\mu$ 上界 $\frac{2(1-r_s)}{b_sc_s}$`, value: a.simplifiedRange.hi, formulaId: 'F-08.11', claim: 'approx', digits: 8 },
      { name: '完整 / quasi-static 上界比', value: !a.fullRange.empty && !a.simplifiedRange.empty ? a.fullRange.hi / a.simplifiedRange.hi : null, note: String.raw`E19：恆為 $\tfrac12$，與 $r_s$ 無關`, claim: 'exact' },
      { name: String.raw`複數 pole 門檻 $\mu=\frac{(1-r_s)^2}{4b_sc_s}$`, value: finiteOrNull(a.muComplex), formulaId: 'F-08.12', claim: 'exact' },
      { name: String.raw`等效 $K=F(1)=\frac{b_sc_s}{1-r_s}$`, value: finiteOrNull(a.dcGain), formulaId: 'F-08.15' },
      { name: String.raw`等效 loop gain $g_{\mathrm{eff}}=\mu F(1)$`, value: finiteOrNull(gEff), formulaId: 'F-08.16', note: String.raw`完整模型 $0<g_{\mathrm{eff}}<1$；quasi-static $0<g_{\mathrm{eff}}<2$` },
      {
        name: String.raw`$PM$（quasi-static：$90^\circ-\arcsin\frac{g_{\mathrm{eff}}}{2}$）`,
        value: marginNote ? null : finiteOrNull(pmSimp.pmDeg),
        unit: '°',
        formulaId: 'F-08.5',
        claim: 'approx',
        note: marginNote ?? (Number.isFinite(pmSimp.pmDeg) ? undefined : String.raw`$g_{\mathrm{eff}}>2$：quasi-static 的 $|L|>1$ 對所有 $\omega$，沒有 gain crossover`),
      },
      {
        name: String.raw`$PM$（完整 $L=\frac{\mu F(z)}{z-1}$，數值）`,
        value: finiteOrNull(pmFull),
        unit: '°',
        formulaId: 'F-08.14',
        claim: 'exact',
        note: marginNote ?? (Number.isFinite(pmFull) ? String.raw`$PM<0\iff$ 完整模型不穩定` : gEff === 0 ? String.raw`$\mu=0$：沒有更新，$|L|\equiv0$` : '沒有 gain crossover'),
      },
      Number.isFinite(gmFull) && Number.isFinite(gmCf.gmFullDb)
        ? { name: String.raw`$GM$（完整：數值 phase crossover vs $20\log_{10}\frac{1}{g_{\mathrm{eff}}}$）`, value: gmFull, analytic: gmCf.gmFullDb, tolerance: 1e-6, unit: 'dB', formulaId: 'F-08.16', claim: 'exact', digits: 6 }
        : { name: String.raw`$GM$（完整）`, value: null, unit: 'dB', formulaId: 'F-08.16', note: marginNote ?? String.raw`$\mu=0$ 或沒有 phase crossover` },
      { name: String.raw`$GM$（quasi-static）$=20\log_{10}\frac{2}{g_{\mathrm{eff}}}$`, value: finiteOrNull(gmCf.gmSimplifiedDb), unit: 'dB', formulaId: 'F-08.16', claim: 'approx', note: String.raw`恆比完整模型多 $20\log_{10}2=${tx(20 * Math.log10(2), 2)}$ dB（2 倍，E19）` },
      {
        name: String.raw`$\tau$ 完整 $=-1/\ln\rho$（漸近衰減率）`,
        value: a.rho < 1 ? -1 / Math.log(a.rho) : null,
        unit: 'blocks',
        note:
          a.rho < 1
            ? String.raw`$\rho$ 只決定漸近的衰減率：$\rho^k$ 每 $\tau$ 個 block 降到 $1/e$，但 $\rho^k$ 不是 $|\delta_k|$ 的包絡（重根、複數根）`
            : String.raw`$\rho\ge1$：誤差不衰減，$\tau$ 沒有定義`,
      },
      { name: String.raw`$\tau$ quasi-static $=-1/\ln|1-g_{\mathrm{eff}}|$`, value: Math.abs(a.simplifiedPole) < 1e-12 ? 0 : Math.abs(a.simplifiedPole) < 1 ? -1 / Math.log(Math.abs(a.simplifiedPole)) : null, unit: 'blocks', claim: 'approx' },
      { name: String.raw`$|\delta_{N_{\mathrm{blk}}}|/\delta_0$，$N_{\mathrm{blk}}=${steps}$（完整 / quasi-static）`, value: `${sig(Math.abs(lastFull), 4)} / ${sig(Math.abs(lastSimp), 4)}` },
      {
        name: String.raw`完整模型最後 ${period} 個 block 的峰值 $\max|\delta_k|/\delta_0$`,
        value: finiteOrNull(lastPeak),
        digits: 5,
        note: topPole
          ? String.raw`複數 pole：振盪週期 $2\pi/\arg z\approx${tsig((2 * Math.PI) / Math.atan2(topPole.im, topPole.re), 4)}$ blocks；單一時間點的 $|\delta_k|$ 可能剛好在零交越附近，要看每個週期的峰值，或拿峰值和 $\rho^k$ 參考線比斜率`
          : '實數 poles',
      },
    ]

    const exportData = (): CsvColumns => {
      const cols: CsvColumns = { k_block: k }
      for (const cs of cases.cases) {
        cols[`case_${cs.id}_delta_full`] = simulateFullModel(cs.params, steps).delta
        cols[`case_${cs.id}_delta_quasi_static`] = simulateQuasiStatic(cs.params, steps)
      }
      cols.sweep_mu = sweepMus
      cols.sweep_rho_full = rhoFull
      cols.sweep_rho_quasi_static = rhoSimp
      cols.pole_re = a.poles.map((z) => z.re)
      cols.pole_im = a.poles.map((z) => z.im)
      return cols
    }

    return {
      metrics,
      warnings,
      crossCheck: {
        analytic: analyticOk
          ? { status: 'ok', note: String.raw`$\mathrm{eig}(\mathbf A)$ = 特徵式根 = 封閉式；Jury 區間 = 數值掃描；$GM$（數值）$=1/g_{\mathrm{eff}}$` }
          : { status: 'mismatch', note: '封閉式與數值不一致（請回報）' },
        monteCarlo: { status: 'n/a', note: '確定性線性模型，沒有隨機成分；隨機 sign-LMS 版本見 PM Lab 的 Monte Carlo' },
        fixedPoint: { status: 'not-implemented', note: '定點量化版本未實作' },
      },
      params: { mode: 'two-state', r_s: p.r, b_s: p.b, c_s: p.c, mu: p.mu, steps, case: cases.activeId },
      plots: { zPlane, time, sweep, bodeMag, bodePhase },
      sweepRange,
      exportData,
      summary: { fullStable: a.stable, simplifiedStable: a.simplifiedStable, rho: a.rho, simplifiedPole: a.simplifiedPole },
    }
  }, [p, cases.cases, cases.activeId, steps, tokens, signed])
}

/** 一般化 state-space 模式（A_s, b_s, c_s, d_s, μ） */
function useGeneralModel(gen: GeneralState, steps: number, tokens: ThemeTokens, signed: boolean): ViewModel {
  return useMemo(() => {
    const sys: ObservationSystem = { A: gen.A, b: gen.b, c: gen.c, d: gen.d }
    const an = analyzeGeneral(sys, gen.mu)
    const n = gen.A.length
    const numeric = stableIntervalsNumeric((mu) => analyzeGeneral(sys, mu).rho, 0, gen.muScanMax, 601)
    // PM／GM 只在「等效 K = F(1) > 0 且 A_s 穩定」時有定義；否則顯示 — 並說明原因
    const marginNote = marginPrecondition(an.dcGain, an.observerRho)
    const gEff = gen.mu * an.dcGain
    let pmFull = NaN
    let gmFull = NaN
    let pmNote = ''
    if (!marginNote && gEff > 0) {
      try {
        const m = loopMargins((w) => calLoopGainGeneral(sys, gen.mu, w), { omegaMin: Math.min(1e-4, gEff / 100) })
        pmFull = m.pmDeg
        gmFull = m.gmDb
      } catch (e) {
        pmNote = e instanceof Error ? e.message : String(e)
      }
    }
    const pmSimp = pmFirstOrder(gEff)
    const k = indexArray(steps + 1)
    const sim = simulateGeneral(sys, gen.mu, steps)
    const simp = Array.from(k, (kk) => (signed ? an.simplifiedPole ** kk : Math.abs(an.simplifiedPole) ** kk))

    const deltaName = signed ? String.raw`$\delta_k$` : String.raw`$|\delta_k|$`
    const time: Data[] = [
      { x: k, y: finiteSeries(Array.from(sim.delta, (v) => (signed ? v : Math.abs(v)))), name: String.raw`完整：${deltaName}（$\rho = ${fx(an.rho, 4)}$）`, mode: 'lines', line: { color: tokens.series[0], width: 2 } },
      { x: k, y: finiteSeries(simp), name: signed ? String.raw`quasi-static：$(1 - \mu F(1))^k$` : String.raw`quasi-static：$|1 - \mu F(1)|^k$`, mode: 'lines', line: { color: tokens.series[1], width: 1.5, dash: 'dash' } },
      { x: k, y: finiteSeries(sim.sNorm), name: String.raw`$\|s_k\|$（觀測狀態）`, mode: 'lines', line: { color: tokens.series[2], width: 1 } },
      { x: k, y: finiteSeries(Array.from(k, (kk) => an.rho ** kk)), name: String.raw`$\rho^k$ 參考線（漸近速率）`, mode: 'lines', line: { color: tokens.textFaint, width: 1, dash: 'dot' } },
    ]
    const zPlane: Data[] = [
      unitCircleTrace(tokens.textMuted),
      poleTrace(an.observerPoles, String.raw`$\mathrm{eig}(\mathbf A_s)$：觀測狀態自己的 poles`, tokens.textMuted, 'x', 11),
      poleTrace(an.poles, String.raw`$\mathrm{eig}(\mathbf A_{\mathrm{comb}})$：完整閉迴路 poles`, tokens.series[0], 'circle', 10),
      poleTrace(Number.isFinite(an.simplifiedPole) ? [{ re: an.simplifiedPole, im: 0 }] : [], String.raw`quasi-static pole $1 - \mu F(1)$`, tokens.series[1], 'diamond-open', 11),
    ]
    const sweepMus = Array.from({ length: 240 }, (_, i) => (gen.muScanMax * (i + 1)) / 240)
    const rhoFull = sweepMus.map((mu) => analyzeGeneral(sys, mu).rho)
    const rhoSimp = sweepMus.map((mu) => Math.abs(1 - mu * an.dcGain))
    const sweep: Data[] = [
      { x: sweepMus, y: rhoFull, name: String.raw`完整 $\rho(\mathbf A_{\mathrm{comb}})$`, mode: 'lines', line: { color: tokens.series[0], width: 2 } },
      { x: sweepMus, y: finiteSeries(rhoSimp), name: String.raw`quasi-static $|1 - \mu F(1)|$`, mode: 'lines', line: { color: tokens.series[1], width: 2, dash: 'dash' } },
      hLine(1, 0, gen.muScanMax, tokens.danger, String.raw`$\rho = 1$`),
      { x: [gen.mu], y: [an.rho], name: String.raw`目前 $\mu = ${tsig(gen.mu)}$`, mode: 'markers', marker: { size: 10, color: tokens.accent } },
      ...(an.simplifiedMuMax < gen.muScanMax ? [vLine(an.simplifiedMuMax, 0, 1.6, tokens.series[1], String.raw`$2/F(1) = ${tsig(an.simplifiedMuMax, 4)}$`, 'dash')] : []),
    ]
    const negGain = Number.isFinite(gEff) && gEff < 0
    const bf = bodeTraces(BODE_FULL_NAME, (w) => calLoopGainGeneral(sys, gen.mu, w), tokens.series[0], 'solid', negGain)
    const bs = Number.isFinite(an.dcGain)
      ? bodeTraces(BODE_QS_NAME, (w) => calLoopGainGeneral({ A: [], b: [], c: [], d: an.dcGain }, gen.mu, w), tokens.series[1], 'dash', negGain)
      : null
    const bodeMag = [bf?.mag, bs?.mag, hLine(0, BODE_OMEGAS[0], Math.PI, tokens.textMuted, '0 dB')].filter(Boolean) as Data[]
    const bodePhase = [bf?.phase, bs?.phase, hLine(-180, BODE_OMEGAS[0], Math.PI, tokens.danger, BODE_MINUS_180_NAME)].filter(Boolean) as Data[]

    const warnings: string[] = []
    if (an.observerRho >= 1 - 1e-12)
      warnings.push(
        String.raw`$\rho(\mathbf A_s)=${tsig(an.observerRho, 6)}\ge1$：觀測狀態本身不收斂（或含積分器），沒有穩態，quasi-static（以 $F(1)$ 代表觀測）不適用。`,
      )
    if (!Number.isFinite(an.dcGain))
      warnings.push(String.raw`$\mathbf I-\mathbf A_s$ 奇異：$\mathbf A_s$ 有 eigenvalue $1$，$F(1)$ 不存在（觀測路徑含積分器），無法定義等效 $K$。`)
    else if (an.dcGain <= 0)
      warnings.push(
        String.raw`$F(1)=${tsig(an.dcGain, 5)}\le0$：等效 $K$ 不為正，正 $\mu$ 在 quasi-static 下就已是極性錯誤（pole $1-\mu F(1)\ge1$）。`,
      )
    if (an.marginal) warnings.push(String.raw`$\rho(\mathbf A_{\mathrm{comb}})=${tsig(an.rho, 8)}=1$：臨界（marginal），不可視為穩定。`)
    else if (!an.stable && Math.abs(an.simplifiedPole) < 1 && an.observerRho < 1)
      warnings.push(
        String.raw`完整模型發散（$\rho(\mathbf A_{\mathrm{comb}})=${tsig(an.rho, 6)}>1$），但 quasi-static 預測穩定（pole $1-\mu F(1)=${tsig(an.simplifiedPole, 4)}$）：把 $F(z)$ 換成 $F(1)$ 忽略了觀測路徑的相位延遲（勘誤 E19 的一般化）。`,
      )
    else if (!an.stable) warnings.push(String.raw`完整模型發散（$\rho(\mathbf A_{\mathrm{comb}})=${tsig(an.rho, 6)}>1$）。`)
    if (pmNote) warnings.push(String.raw`PM 無法計算：${pmNote}（$F(z)$ 在單位圓上有極點）`)

    const metrics: MetricRow[] = [
      { name: String.raw`$\mathrm{eig}(\mathbf A_{\mathrm{comb}})$`, value: an.poles.map((z) => cToString(z, 4)).join('、'), formulaId: 'F-08.13', claim: 'exact' },
      { name: String.raw`$\rho(\mathbf A_{\mathrm{comb}})$`, value: an.rho, formulaId: 'F-08.13', claim: 'exact', digits: 8 },
      { name: String.raw`$\mathrm{eig}(\mathbf A_s)$（觀測）`, value: an.observerPoles.length > 0 ? an.observerPoles.map((z) => cToString(z, 4)).join('、') : '（無：0 維）' },
      { name: String.raw`$F(1)=d_s+\mathbf c_s^{\mathsf T}(\mathbf I-\mathbf A_s)^{-1}\mathbf b_s$（等效 $K$）`, value: finiteOrNull(an.dcGain), formulaId: 'F-08.15' },
      { name: String.raw`quasi-static pole $1-\mu F(1)$`, value: finiteOrNull(an.simplifiedPole), formulaId: 'F-08.15', claim: 'approx' },
      {
        name: String.raw`完整 $\mu$ 穩定區間（掃描 $[0,\,${tsig(gen.muScanMax)}]$）`,
        value: numeric.length > 0 ? numeric.map((iv) => `(${sig(iv.lo, 5)}, ${sig(iv.hi, 5)})`).join(' ∪ ') : '空集合',
        claim: 'exact',
        note: '數值掃描 + 二分法，不用封閉式',
      },
      { name: String.raw`quasi-static $\mu$ 上界 $2/F(1)$`, value: finiteOrNull(an.simplifiedMuMax), claim: 'approx' },
      {
        name: String.raw`$PM$（完整，數值）`,
        value: finiteOrNull(pmFull),
        unit: '°',
        formulaId: 'F-08.14',
        claim: 'exact',
        note: marginNote ?? (Number.isFinite(pmFull) ? String.raw`$PM<0\iff$ 完整模型不穩定（開迴路穩定、單一 crossover 時）` : gEff === 0 ? String.raw`$\mu=0$：沒有更新，$|L|\equiv0$` : '沒有 gain crossover'),
      },
      { name: String.raw`$GM$（完整，數值 phase crossover）`, value: finiteOrNull(gmFull), unit: 'dB', formulaId: 'F-08.14', claim: 'exact', note: marginNote ?? (Number.isFinite(gmFull) ? undefined : String.raw`沒有 phase crossover（或 $\mu=0$）`) },
      {
        name: String.raw`$PM$（quasi-static）`,
        value: marginNote ? null : finiteOrNull(pmSimp.pmDeg),
        unit: '°',
        formulaId: 'F-08.5',
        claim: 'approx',
        note: marginNote ?? (Number.isFinite(pmSimp.pmDeg) ? undefined : String.raw`$\mu F(1)>2$：quasi-static 的 $|L|>1$ 對所有 $\omega$，沒有 gain crossover`),
      },
    ]

    // Schur complement 交叉比對：det(zI − A_comb) = det(zI − A_s)(z − 1 + μF(z)) ⇒ 每個 eigenvalue λ 滿足 λ − 1 + μF(λ) = 0
    let schurMax = 0
    for (const lam of an.poles) {
      try {
        const F = observationTransfer(sys, lam)
        const res = Math.hypot(lam.re - 1 + gen.mu * F.re, lam.im + gen.mu * F.im)
        schurMax = Math.max(schurMax, res / (1 + cAbs(lam) + gen.mu * cAbs(F)))
      } catch {
        // λ 恰為 A_s 的 eigenvalue（不可控／不可觀的模態原封不動留在 A_comb）：它不是 1 + L = 0 的根，跳過
      }
    }
    const analyticOk = schurMax < 1e-8

    return {
      metrics,
      warnings,
      crossCheck: {
        analytic: analyticOk
          ? { status: 'ok', note: String.raw`$\mathrm{eig}(\mathbf A_{\mathrm{comb}})$ 皆滿足 $\lambda-1+\mu F(\lambda)=0$（最大相對殘差 $${tsig(schurMax, 2)}$）` }
          : { status: 'mismatch', note: String.raw`Schur complement 殘差 $${tsig(schurMax, 3)}$（請回報）` },
        monteCarlo: { status: 'n/a', note: '確定性線性模型，沒有隨機成分' },
        fixedPoint: { status: 'not-implemented', note: '定點量化版本未實作' },
      },
      params: { mode: 'general', n, A_s: JSON.stringify(gen.A), b_s: JSON.stringify(gen.b), c_s: JSON.stringify(gen.c), d_s: gen.d, mu: gen.mu, steps },
      plots: { zPlane, time, sweep, bodeMag, bodePhase },
      sweepRange: gen.muScanMax,
      exportData: (): CsvColumns => ({
        k_block: k,
        delta_full: sim.delta,
        s_norm: sim.sNorm,
        [signed ? 'delta_quasi_static' : 'abs_delta_quasi_static']: simp,
        sweep_mu: sweepMus,
        sweep_rho_full: rhoFull,
        sweep_rho_quasi_static: rhoSimp,
        pole_re: an.poles.map((z) => z.re),
        pole_im: an.poles.map((z) => z.im),
      }),
      summary: { fullStable: an.stable, simplifiedStable: Math.abs(an.simplifiedPole) < 1, rho: an.rho, simplifiedPole: an.simplifiedPole },
    }
  }, [gen, steps, tokens, signed])
}

function resize(gen: GeneralState, n: number): GeneralState {
  const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => gen.A[i]?.[j] ?? (i === j ? 0.5 : 0)))
  const b = Array.from({ length: n }, (_, i) => gen.b[i] ?? 0)
  const c = Array.from({ length: n }, (_, i) => gen.c[i] ?? 0)
  return { ...gen, A, b, c }
}

function isMatrix(x: unknown): x is number[][] {
  return Array.isArray(x) && x.every((r) => Array.isArray(r) && r.every((v) => typeof v === 'number'))
}
function isVector(x: unknown): x is number[] {
  return Array.isArray(x) && x.every((v) => typeof v === 'number')
}

/**
 * Dual-Loop Explorer（規格 §19：控制 r, b, c, μ；simple vs full dynamics、unit circle；T09）＋一般化 state-space 模式。
 * 模型 L2：抽象觀測狀態（不是特定 PLL 電路節點），確定性線性模型。
 */
export function DualLoopLab() {
  const tokens = useThemeTokens()
  const [mode, setMode] = useState<Mode>('two-state')
  const cases = useCases<DualLoopParams>(DEFAULT_CASE, { seed: 20261010 })
  const [gen, setGen] = useState<GeneralState>(DEFAULT_GENERAL)
  const [steps, setSteps] = useState(300)
  const [logY, setLogY] = useState(true)
  const { update: updateCase, reset: resetCases } = cases
  const p = cases.active.params

  const two = useTwoStateModel(cases, steps, tokens, !logY)
  const general = useGeneralModel(gen, steps, tokens, !logY)
  const vm = mode === 'two-state' ? two : general

  const presets: ExperimentPreset[] = useMemo(
    () => presetsForExperiment(DUAL_LOOP_ID).map((pr) => ({ name: pr.title, params: pr.params, description: pr.description })),
    [],
  )
  const applyParams = useCallback(
    (pp: Record<string, unknown>) => {
      if (pp.mode === 'general' && isMatrix(pp.A) && isVector(pp.b) && isVector(pp.c)) {
        const n = pp.A.length
        if (n >= 1 && n <= 3 && pp.b.length === n && pp.c.length === n && pp.A.every((r) => r.length === n)) {
          setMode('general')
          setGen((g) => ({
            ...g,
            A: pp.A as number[][],
            b: pp.b as number[],
            c: pp.c as number[],
            d: typeof pp.d === 'number' ? pp.d : 0,
            mu: typeof pp.mu === 'number' ? pp.mu : g.mu,
            muScanMax: typeof pp.muScanMax === 'number' ? pp.muScanMax : g.muScanMax,
          }))
        }
      } else {
        setMode('two-state')
        const patch: Partial<DualLoopParams> = {}
        for (const key of ['r', 'b', 'c', 'mu'] as const) if (typeof pp[key] === 'number') patch[key] = pp[key] as number
        updateCase(patch)
      }
      if (typeof pp.steps === 'number') setSteps(pp.steps)
    },
    [updateCase],
  )
  const urlPreset = useUrlPreset(DUAL_LOOP_ID)
  useEffect(() => {
    if (urlPreset) applyParams(urlPreset.params)
  }, [urlPreset, applyParams])

  const n = gen.A.length
  const sweepLayout = useMemo<Partial<Layout>>(
    () => ({ xaxis: { title: { text: String.raw`$\mu$（正規化）` }, range: [0, vm.sweepRange] }, yaxis: { title: { text: String.raw`$\rho$` }, range: [0, 1.6] } }),
    [vm.sweepRange],
  )
  const timeLayout = useMemo<Partial<Layout>>(
    () => ({ xaxis: { title: { text: '$k$ [block]' } }, yaxis: { title: { text: logY ? String.raw`$|\delta_k| / \delta_0$` : String.raw`$\delta_k / \delta_0$` } } }),
    [logY],
  )
  const timeTitle = `${logY ? String.raw`$|\delta_k|$（log 軸）` : String.raw`$\delta_k$（step response 的誤差，線性軸）`}：${mode === 'two-state' ? '完整' : String.raw`$\mathbf A_{\mathrm{comb}}$`} vs quasi-static（${steps} blocks）`

  return (
    <ExperimentShell
      id={DUAL_LOOP_ID}
      title={String.raw`Dual-Loop Explorer：觀測動態 $\times$ 校正迴路`}
      level="L2"
      claim="exact"
      tests={['T09']}
      description={
        <>
          同時顯示<strong>完整二狀態模型</strong>（<Tex>{'\\rho(\\mathbf A)'}</Tex>，<ClaimTag kind="exact" />）與<strong>quasi-static 簡化模型</strong>（
          <Tex>{'1-\\mu b_sc_s/(1-r_s)'}</Tex>，<ClaimTag kind="approx" />，時間尺度分離）的 poles、單位圓、時域與穩定 <Tex>{'\\mu'}</Tex> 範圍；「一般化」模式可直接編輯{' '}
          <Tex>{'\\mathbf A_s,\\mathbf b_s,\\mathbf c_s,d_s'}</Tex>。
        </>
      }
      assumptions={[
        String.raw`$s$ 為抽象觀測狀態（不是 VCO 控制電壓）；$s_{k+1}=r_ss_k+b_s\delta_k$、$G_k=c_ss_k$、$\delta_{k+1}=\delta_k-\mu G_k$（$\delta=a-w$）`,
        String.raw`$\mu$ 為 $K\equiv1$ 的正規化步長（勘誤 E13）；記號依勘誤 E31（$r_s,b_s,c_s$；$\mathbf A_s,\mathbf b_s,\mathbf c_s^{\mathsf T},d_s$）`,
        String.raw`確定性線性模型；初值 $s_0=0$、$\delta_0=1$（目標在 $k=0$ 跳一步）`,
        String.raw`時域至少 300 blocks 並疊上 $\rho^k$ 參考線：複數 pole 的振盪會讓短視窗誤判為收斂。$\rho^k$ 只給漸近速率（log 軸上的斜率），不是 $|\delta_k|$ 的包絡`,
      ]}
      params={vm.params}
      units={{ mu: '無因次（正規化）', steps: 'blocks', r_s: '無因次', b_s: '無因次', c_s: '無因次' }}
      metrics={vm.metrics}
      warnings={vm.warnings}
      crossCheck={vm.crossCheck}
      actions={{
        onReset: () => {
          resetCases(DEFAULT_CASE)
          setGen(DEFAULT_GENERAL)
          setSteps(300)
          setMode('two-state')
        },
      }}
      exportData={vm.exportData}
      presets={presets}
      onLoadPreset={(pr) => applyParams(pr.params)}
      controls={
        <>
          <SelectControl<Mode>
            label="模型"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'two-state', label: '二狀態（r_s, b_s, c_s, μ）' },
              { value: 'general', label: '一般化 state-space（A_s, b_s, c_s, d_s）' },
            ]}
            reg="behavioral：observation model"
          />
          {mode === 'two-state' ? (
            <>
              <CaseSelector cases={cases} />
              <ParamControl label={<Tex>{'r_s'}</Tex>} ariaLabel="r_s（觀測 pole）" value={p.r} onChange={(v) => updateCase({ r: v })} min={-0.99} max={1.2} step={0.001} unit="無因次" reg="behavioral：主迴路殘差每 block 保留比例" hint={rich(String.raw`$|r_s|<1$：觀測狀態會收斂`)} />
              <ParamControl label={<Tex>{'b_s'}</Tex>} ariaLabel="b_s（δ → s 耦合）" value={p.b} onChange={(v) => updateCase({ b: v })} min={-2} max={2} step={0.001} unit="無因次" reg="behavioral：DTC 誤差注入觀測狀態" />
              <ParamControl label={<Tex>{'c_s'}</Tex>} ariaLabel="c_s（s → G 觀測增益）" value={p.c} onChange={(v) => updateCase({ c: v })} min={-2} max={2} step={0.001} unit="無因次" reg="behavioral：GMAC 對 s 的斜率（含 K_q）" />
              <ParamControl label={<Tex>{'\\mu'}</Tex>} ariaLabel="μ（正規化步長）" value={p.mu} onChange={(v) => updateCase({ mu: v })} min={0} max={5} step={0.001} unit="無因次" reg="REG_CAL_MU（正規化，K ≡ 1）" hint={rich(String.raw`完整上界 $\frac{1-r_s}{b_sc_s}$；quasi-static 上界 $\frac{2(1-r_s)}{b_sc_s}$`)} />
            </>
          ) : (
            <>
              <ParamControl label={rich(String.raw`觀測狀態維度 $n$`)} ariaLabel="觀測狀態維度 n" value={n} onChange={(v) => setGen(resize(gen, v))} min={1} max={3} integer clampOnBlur unit="states" reg="behavioral：dim(s)" />
              <MatrixEditor name="A_s" title={<Tex>{'\\mathbf A_s\\;(n\\times n)'}</Tex>} rows={gen.A} onChange={(A) => setGen({ ...gen, A })} reg="behavioral：觀測狀態矩陣" />
              <MatrixEditor name="b_s" title={<Tex>{'\\mathbf b_s\\;(n\\times 1)'}</Tex>} rows={gen.b.map((v) => [v])} onChange={(rows) => setGen({ ...gen, b: rows.map((r) => r[0]) })} reg="behavioral：δ → s" />
              <MatrixEditor name="c_s" title={<Tex>{'\\mathbf c_s^{\\mathsf T}\\;(1\\times n)\\;=\\;\\text{規格的 }\\mathbf C\\ (\\mathbf C_{\\mathrm{obs}})'}</Tex>} rows={[gen.c]} onChange={(rows) => setGen({ ...gen, c: rows[0] })} reg="behavioral：s → G（E31）" />
              <ParamControl label={<Tex>{'d_s'}</Tex>} ariaLabel="d_s（feedthrough）" value={gen.d} onChange={(v) => setGen({ ...gen, d: v })} min={-5} max={5} step={0.001} unit="無因次" reg="behavioral：δ → G 直通（E31：不是 code delay D）" />
              <ParamControl label={<Tex>{'\\mu'}</Tex>} ariaLabel="μ（正規化步長，一般化）" value={gen.mu} onChange={(v) => setGen({ ...gen, mu: v })} min={0} max={50} step={0.001} unit="無因次" reg="REG_CAL_MU（正規化）" />
              <ParamControl label={rich(String.raw`$\mu$ 掃描上限`)} ariaLabel="μ 掃描上限" value={gen.muScanMax} onChange={(v) => setGen({ ...gen, muScanMax: v })} min={0.1} max={100} log unit="無因次" reg="behavioral：穩定區間搜尋範圍" />
            </>
          )}
          <ParamControl
            label={rich(String.raw`模擬長度 $N_{\mathrm{blk}}$`)}
            ariaLabel="模擬長度（blocks）"
            value={steps}
            onChange={setSteps}
            min={20}
            max={3000}
            integer
            clampOnBlur
            unit="blocks"
            reg="num_blocks（behavioral）"
            hint={rich(String.raw`建議 $\ge300$：複數 pole 的發散很慢`)}
          />
          <ToggleControl label={rich(String.raw`時域用 log 軸（$|\delta_k|$）`)} ariaLabel="時域用 log 軸" value={logY} onChange={setLogY} hint={rich(String.raw`log 軸上指數成長／衰減是直線（斜率 $\log_{10}\rho$）；關掉則顯示帶正負號的 $\delta_k$ 與 $\pm\rho^k$ 參考線`)} />
        </>
      }
    >
      <div className="grid-2">
        <Plot title={String.raw`$z$ 平面：完整 poles（●）vs quasi-static pole（◇）`} ariaLabel="z 平面：完整模型與 quasi-static 的 poles" data={vm.plots.zPlane} height={440} csvName="dual-loop-poles" layout={Z_PLANE_LAYOUT} caption={rich(String.raw`$\mu$ 增加時，完整模型的兩個根先在實軸上靠近，超過複數門檻後變成共軛對，沿 $|z|^2=r_s+\mu b_sc_s$ 的圓往外走；quasi-static pole 只在實軸上往 $-1$ 走。`)} />
        <Plot
          title={String.raw`穩定性 vs $\mu$：完整模型的 $\rho$ 與 quasi-static 的 $|\text{pole}|$`}
          ariaLabel="spectral radius 對 μ 的掃描"
          data={vm.plots.sweep}
          height={440}
          csvName="dual-loop-rho-sweep"
          layout={sweepLayout}
          caption={rich(
            String.raw`實線：完整模型的 $\rho(\mathbf A)$；虛線：quasi-static 的 $|1-\mu F(1)|$。兩條垂直虛線是 E19 要求同時顯示的兩個上界 $\frac{1-r_s}{b_sc_s}$（完整）與 $\frac{2(1-r_s)}{b_sc_s}$（quasi-static）；點線是複數 pole 門檻。`,
          )}
        />
      </div>
      <Plot
        title={timeTitle}
        ariaLabel={`誤差的時域響應：${mode === 'two-state' ? '完整模型' : '合併矩陣'} 與 quasi-static`}
        data={vm.plots.time}
        height={320}
        yLog={logY}
        csvName="dual-loop-time"
        layout={timeLayout}
        caption={rich(
          String.raw`實線：完整模型；虛線：quasi-static；點線：$\rho^k$ 參考線（log 軸上斜率 $=\log_{10}\rho$）。$\rho^k$ 只給漸近速率，不是 $|\delta_k|$ 的包絡：長期來看峰值和它同斜率，但可以高出一個常數倍，重根時還多一個 $k$ 的因子。複數 pole 時 $|\delta_k|$ 會週期性地掉到接近 0（零交越）——判斷收斂還是發散，要看每個週期的峰值是往下還是往上走（長期和點線同斜率），不要看單一時間點。`,
        )}
      />
      <div className="grid-2">
        <Plot title={String.raw`Bode：$|L_{\mathrm{cal}}(e^{j\omega})|$（完整 vs quasi-static）`} ariaLabel="Bode 大小圖：完整與 quasi-static" data={vm.plots.bodeMag} xLog height={300} csvName="dual-loop-bode-mag" layout={BODE_MAG_LAYOUT} caption={rich(String.raw`完整模型多一個 pole：高頻增益比 quasi-static 低，但那裡的相位更差（右圖）。`)} />
        <Plot title={String.raw`Bode：$\angle L_{\mathrm{cal}}(e^{j\omega})$（展開相位）`} ariaLabel="Bode 相位圖：完整與 quasi-static" data={vm.plots.bodePhase} xLog height={300} csvName="dual-loop-bode-phase" layout={BODE_PHASE_LAYOUT} caption={rich(String.raw`quasi-static 把 $F(z)$ 換成 $F(1)$：相位永遠是 $-90^\circ-\omega/2$，看不到觀測路徑額外的相位延遲 $\angle F(e^{j\omega})$。二狀態模式的灰色點線是完整模型的 $\omega_{180}=\arccos\frac{1+r_s}{2}$（F-08.16）。`)} />
      </div>
      <Callout kind={vm.summary.fullStable ? 'ok' : vm.summary.simplifiedStable ? 'danger' : 'warn'} title="判定">
        完整模型{vm.summary.fullStable ? '穩定' : '不穩定'}（<Tex>{`\\rho=${tx(vm.summary.rho, 5)}`}</Tex>）；quasi-static {vm.summary.simplifiedStable ? '預測穩定' : '預測不穩定'}（pole{' '}
        <Tex>{`=${tx(vm.summary.simplifiedPole, 4)}`}</Tex>）。{!vm.summary.fullStable && vm.summary.simplifiedStable ? '→ 簡化模型給出錯誤的穩定結論。' : ''}
      </Callout>
      {mode === 'two-state' && (
        <Callout kind="info" title="試試看">
          <ul className="ch08-try">
            <li>
              {rich(
                String.raw`Gallery #5：$r_s=0.8,\ b_s=0.2,\ c_s=1,\ \mu=1.2$ → 簡化 pole $${tx(TRY.g5.simplifiedPole, 1)}$（穩定），完整 $|z|=${tx(TRY.g5.rho, 4)}$（發散）。把 $N_{\mathrm{blk}}$ 改成 30、關掉 log 軸：峰值只從 1 慢慢長到約 $${tx(TRY.peak30, 1)}$，很像「還在收斂的振盪」；300 blocks 才看得出是發散（每個 block 只長 $${tx(TRY.growthPct, 0)}\%$）。`,
              )}
            </li>
            <li>
              {rich(
                String.raw`$\mu=0.5$：兩者都穩定，但簡化 pole $${tx(TRY.slow.simplifiedPole, 1)}$（$\tau\approx${tx(TRY.tauSimp, 1)}$ block）vs 完整 $\rho=${tx(TRY.slow.rho, 4)}$（$\tau\approx${tx(TRY.tauFull, 0)}$ blocks）——收斂速度差約 $${tx(TRY.tauFull / TRY.tauSimp, 0)}$ 倍。再看 Bode：完整模型的 PM 與 GM 都遠小於 quasi-static（GM 恰好少 $${tx(20 * Math.log10(2), 2)}$ dB）。`,
              )}
            </li>
            <li>{rich(String.raw`把 $r_s$ 改成 $0$（主迴路瞬間穩態）：完整上界變成 $\mu b_sc_s<1$，仍然是簡化上界 $\mu b_sc_s<2$ 的一半——就是 §8.3 的 $d=1$。`)}</li>
            <li>{rich(String.raw`把 $b_s$ 改成負值：任何正 $\mu$ 都不穩定（極性錯誤）。`)}</li>
          </ul>
        </Callout>
      )}
    </ExperimentShell>
  )
}
