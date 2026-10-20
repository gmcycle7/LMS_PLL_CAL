import { useCallback, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Data, Layout, Shape } from 'plotly.js-cartesian-dist-min'
import {
  Callout,
  ExperimentShell,
  ParamControl,
  Plot,
  SelectControl,
  Tex,
  ToggleControl,
  mathText,
  useThemeTokens,
  type CheckEntry,
  type MetricRow,
  type ThemeTokens,
} from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import {
  CAL_STATE_LABEL,
  CAL_STATES,
  DEFAULT_CAL_SM,
  comparatorKq,
  runCalStateMachine,
  type CalSmMonteCarloResult,
  type CalSmParams,
  type CalState,
} from '@/simulation/models/optimizer'
import {
  ACQ_STATES,
  DEFAULT_ACQ,
  acquisitionAnalytic,
  acquisitionMonteCarlo,
  acquisitionTimeline,
  fllGain,
  fllGainLsbFor,
  runAcquisition,
  tVcoFs,
  type AcqParams,
  type AcqResult,
  type AcqState,
} from '@/simulation/models/acquisition'
import { md, nf, tx, vBand, vLine, withAlpha } from '../shared'

/** 每個狀態的顏色（Plotly 讀不到 CSS 變數，所以由 theme tokens 轉成實際色碼）。 */
export function stateColor(s: CalState, t: ThemeTokens): string {
  switch (s) {
    case 'RESET':
      return t.textMuted
    case 'LOCK':
      return t.series[5]
    case 'COARSE':
      return t.series[1]
    case 'VERIFY':
      return t.series[4]
    case 'FINE':
      return t.series[3]
    case 'TRACK':
      return t.series[2]
    case 'FREEZE':
      return t.series[0]
    case 'RESTART':
    case 'FAULT':
      return t.danger
  }
}

/** 把逐 block 的狀態壓成連續區段 [start, end)（給背景色帶與時間軸用）。 */
export function stateSegments(state: ArrayLike<number>): { s: CalState; k0: number; k1: number }[] {
  const out: { s: CalState; k0: number; k1: number }[] = []
  for (let k = 0; k < state.length; k++) {
    const s = CAL_STATES[state[k]]
    const last = out[out.length - 1]
    if (last && last.s === s) last.k1 = k + 1
    else out.push({ s, k0: k, k1: k + 1 })
  }
  return out
}

/** 線性模型對「固定步長 μ 追蹤 ramp」穩態 RMS 的預測：√(σ_w²(μ) + (r/g)²)（F-14.12）；預設 μ = μ_track。 */
export function trackRmsPrediction(cfg: CalSmParams, mu = cfg.muTrack): number {
  const K = comparatorKq(cfg.sigmaV) * Math.cos((cfg.thetaDeg * Math.PI) / 180)
  const g = mu * K
  if (!(g > 0 && g < 2)) return NaN
  const s2 = 1 / cfg.N
  return Math.sqrt((mu * s2) / (K * (2 - g)) + (cfg.driftPerBlock / g) ** 2)
}

/** 情境裡有沒有會破壞「純穩態」的事件（step、失鎖、bad-FCW）；有的話固定 μ 對照組沒有穩態公式可比。 */
export function hasDisturbance(cfg: CalSmParams): boolean {
  return (cfg.stepBlock >= 0 && cfg.stepBlock < cfg.blocks && cfg.stepSize !== 0) || (cfg.lockLossLen > 0 && cfg.lockLossStart >= 0) || (cfg.badFcwLen > 0 && cfg.badFcwStart >= 0)
}

export function smWarnings(cfg: CalSmParams): string[] {
  const w: string[] = []
  const C = Math.cos((cfg.thetaDeg * Math.PI) / 180)
  const K = comparatorKq(cfg.sigmaV) * C
  if (K <= 0) {
    w.push(
      String.raw`C ≤ 0：更新極性錯誤，正 learning rate 會使平均誤差發散（$\theta=${cfg.thetaDeg}^\circ$，$C=\cos\theta=${C.toFixed(3)}$）。COARSE 會把 $w$ 推離 $a$，直到 clip detect 或 VERIFY 的斜率檢查發現（看事件紀錄）；正確做法是修正極性（Ch06／Ch07）。`,
    )
  } else if (cfg.muCoarse * K >= 2) {
    w.push(
      String.raw`$\mu_\text{coarse}K=${(cfg.muCoarse * K).toFixed(3)}\ge2$：coarse 階段的一階模型不穩定（只因 Sign-GMAC 的 $|G|\le1$ 才沒有數值發散，會出現大幅振盪）。`,
    )
  }
  if (cfg.registerLsb > 0) {
    const typical = cfg.muTrack / Math.sqrt(cfg.N)
    if (typical < cfg.registerLsb / 2) {
      w.push(
        String.raw`定點 dead zone：TRACK 的典型更新量 $\mu_\text{track}\sigma_G\approx${tx(typical, 3)}\,\mathrm{fs}<\tfrac12\,\text{LSB}=${tx(cfg.registerLsb / 2, 3)}\,\mathrm{fs}$，大部分更新會被捨入吃掉：係數卡住、無法追蹤漂移（需要更多小數位元，或累加器先在高解析度更新，見 Ch13）。`,
      )
    }
  }
  if (cfg.hysteresis && cfg.alarmLoZ >= cfg.alarmHiZ) w.push(String.raw`hysteresis 無效：低門檻 $${cfg.alarmLoZ}\sigma$ 不低於高門檻 $${cfg.alarmHiZ}\sigma$，Schmitt trigger 失去遲滯。`)
  if (cfg.verifyDelta >= cfg.sigmaV) {
    w.push(String.raw`VERIFY 擾動 $\Delta=${cfg.verifyDelta}\,\mathrm{fs}\ge\sigma_v$：erf 飽和使斜率量測低估超過 14%（F-14.21），$\hat K$ 可能誤判；而且 VERIFY 期間 DTC 多了 $\pm\Delta$ 的誤差。`)
  }
  if (cfg.wMin >= cfg.wMax) w.push(String.raw`暫存器範圍不合法：$w_{\min}\ge w_{\max}$。`)
  if (cfg.lockLossLen > 0 && !cfg.lockDetect) {
    w.push(
      String.raw`lock detect 關閉：失鎖期間（block ${cfg.lockLossStart}–${cfg.lockLossStart + cfg.lockLossLen - 1}）GMAC 被 cycle slip 主導，假相關 $\beta=${cfg.unlockBias}$ 讓 $w$ 每 block 被推約 $\mu\beta$，校正被破壞。`,
    )
  }
  if (cfg.badFcwLen > 0 && cfg.badFcwPolicy === 'ignore') {
    w.push(
      String.raw`bad-FCW policy 為 ignore：在 $C\approx${tx(C * cfg.badFcwGain, 3)}$ 的 FCW 繼續更新，$\lambda\approx0$（不可辨識）且有假相關 ${cfg.badFcwBias}，$w$ 會漂走或觸發誤警報／FAULT。`,
    )
  }
  return w
}

/** 給 String.raw 模板用的 ∞（不在模板裡寫雙反斜線） */
const INF = '\\infty'

/** acquisition 狀態的顏色（和 block 級狀態對齊：ACQ／PLOCK 對 LOCK、CAL 對 TRACK、HOLD／RECAL 對 FREEZE／VERIFY）。 */
export function acqStateColor(s: AcqState, t: ThemeTokens): string {
  switch (s) {
    case 'ACQ':
      return t.series[5]
    case 'PLOCK':
      return t.series[4]
    case 'CAL':
      return t.series[2]
    case 'HOLD':
      return t.danger
    case 'RECAL':
      return t.series[3]
  }
}

/** acquisition 模型的實驗參數（`AcqParams` 中由 block 級情境決定的欄位會在 buildAcqConfig 填入）。 */
export type AcqExpParams = Omit<AcqParams, 'seed' | 'blockN' | 'dtcGainsFs' | 'cycles' | 'lossCycle'>
export const DEFAULT_ACQ_EXP: AcqExpParams = (() => {
  const { seed: _s, blockN: _n, dtcGainsFs: _g, cycles: _c, lossCycle: _l, ...rest } = DEFAULT_ACQ
  return rest
})()

/**
 * 把 acquisition 參數接上 block 級情境：seed 共用、block 長度 N、DTC 要檢查的 gain 是初始暫存器 w_0 與真值 a_0、
 * 失鎖事件（外部干擾結束時 VCO 頻率仍偏 Δf_loss）放在 (lockLossStart + lockLossLen)·N；模擬長度依封閉式的 enable 週期放大。
 */
export function buildAcqConfig(acq: AcqExpParams, cfg: CalSmParams): AcqParams {
  const hasLoss = cfg.lockLossStart >= 0 && cfg.lockLossLen > 0 && cfg.lockDetect
  const lossCycle = hasLoss ? (cfg.lockLossStart + cfg.lockLossLen) * cfg.N : -1
  const base: AcqParams = { ...acq, seed: cfg.seed, blockN: cfg.N, dtcGainsFs: [cfg.w0, cfg.a0], cycles: 16384, lossCycle }
  const an = acquisitionAnalytic(base)
  const need = Number.isFinite(an.nEnableBound) ? 2 * an.nEnableBound + 4096 : 16384
  const cycles = Math.min(1 << 20, Math.max(16384, need, hasLoss ? lossCycle + need : 0))
  return { ...base, cycles }
}

/** acquisition 模型的解釋型警告。 */
export function acqWarnings(acq: AcqParams, res: AcqResult): string[] {
  const w: string[] = []
  const kF = fllGain(acq)
  const T = tVcoFs(acq)
  if (!(kF > 0 && kF < 1)) w.push(String.raw`FLL 增益 $K_f=${tx(kF, 3)}$ 不在 $(0,1)$：$K_f\le0$ 是極性錯誤（頻率誤差不收斂）、$K_f\ge1$ 每週期修過頭，一階模型 $(1-K_f)^n$ 發散或翻轉（F-14.22）。`)
  if (acq.fUnlockHz <= acq.fTolHz) w.push(String.raw`$f_\text{unlock}=${tx(acq.fUnlockHz / 1e6, 3)}\,\mathrm{MHz}\le f_\text{tol}$：失鎖門檻沒有遲滯，雜訊碰到門檻就會在 ACQ 與 PLOCK 之間來回。`)
  if (acq.thetaMaxFs >= T / 2) w.push(String.raw`$\theta_{\max}=${tx(acq.thetaMaxFs / 1000, 3)}\,\mathrm{ps}\ge T_\text{vco}/2=${tx(T / 2000, 3)}\,\mathrm{ps}$：門檻比 SSPD 的吸引區還大，phase lock 的判定沒有意義（F-14.24）。`)
  if (!res.summary.dtcOk) w.push(String.raw`校正不能 enable：${res.summary.dtcReason}。這不是調 $\mu$ 能解決的——回 Ch04 §5b 改 DTC 的範圍預算（$T_0$、$R$）或初始暫存器 $w_0$。`)
  else if (res.summary.enableCycle < 0) {
    const an = acquisitionAnalytic(acq)
    if (!Number.isFinite(an.nPlRel)) w.push(String.raw`永遠不會 phase lock：殘餘頻率誤差的靜態偏移 $\theta_\text{ss}=${tx(an.thetaSsFs, 3)}\,\mathrm{fs}$ 已超過 $\theta_{\max}$（F-14.24）；把 $f_\text{tol}$ 收緊或放寬 $\theta_{\max}$。`)
    else if (!Number.isFinite(an.nSettleRel)) w.push(String.raw`永遠不會穩態：$\mathrm{rms}_{\max}$ 比靜態偏移 $\theta_\text{ss}=${tx(an.thetaSsFs, 3)}\,\mathrm{fs}$ 還小。`)
    else if (res.summary.freqLockCycle < 0) w.push(String.raw`模擬長度 ${acq.cycles} 個 reference 週期內 FLL 沒有鎖定（封閉式 $n_\text{FL}=${Number.isFinite(an.nFL) ? an.nFL : INF}$）；block 級狀態機整段停在 LOCK。`)
    else w.push(String.raw`模擬長度內沒有 enable（slip ${res.summary.slips} 次、失鎖 ${res.summary.unlocks} 次）；block 級狀態機整段停在 LOCK。`)
  }
  return w
}

// Plot 的軸標題、圖例名稱裡的數學寫 `$...$`（Plot 元件會轉成斜體符號與上下標，見 src/components/plotMath.ts）
const MU_LAYOUT: Partial<Layout> = {
  xaxis: { title: { text: String.raw`block $k$` } },
  yaxis: { title: { text: String.raw`$\mu_k$ (fs)` }, type: 'log' },
  yaxis2: { overlaying: 'y', side: 'right', tickvals: CAL_STATES.map((_, i) => i), ticktext: [...CAL_STATES], range: [-0.5, CAL_STATES.length - 0.5], showgrid: false },
}

function Group({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="ch14-details" open={open}>
      <summary>{title}</summary>
      <div className="ch14-controls">{children}</div>
    </details>
  )
}

export function CalStateMachineExperiment() {
  const tokens = useThemeTokens()
  const [cfg, setCfg] = useState<CalSmParams>(DEFAULT_CAL_SM)
  const [acq, setAcq] = useState<AcqExpParams>(DEFAULT_ACQ_EXP)
  const [runs, setRuns] = useState(48)
  const [pendingAuto, setPendingAuto] = useState(true)
  const urlPreset = useUrlPreset('cal-state-machine')
  /** preset 的 params：`acq` 子物件是 acquisition 參數，其餘是 block 級狀態機參數 */
  const applyPreset = useCallback((params: Record<string, unknown>) => {
    const { acq: acqPatch, ...sm } = params as { acq?: Partial<AcqExpParams> } & Partial<CalSmParams>
    setCfg({ ...DEFAULT_CAL_SM, ...sm })
    setAcq({ ...DEFAULT_ACQ_EXP, ...(acqPatch ?? {}) })
    setPendingAuto(true)
  }, [])
  useEffect(() => {
    if (urlPreset) applyPreset(urlPreset.params)
  }, [urlPreset, applyPreset])
  const set = <K extends keyof CalSmParams>(k: K, v: CalSmParams[K]) => setCfg((c) => ({ ...c, [k]: v }))
  const setA = <K extends keyof AcqExpParams>(k: K, v: AcqExpParams[K]) => setAcq((c) => ({ ...c, [k]: v }))
  const dcfg0 = useDeferredValue(cfg)
  const dacq = useDeferredValue(acq)
  // §14.6b：LOCK 的長度與失鎖後的重新 acquisition 由模型決定，不再是固定的計數器
  const acqCfg = useMemo(() => buildAcqConfig(dacq, dcfg0), [dacq, dcfg0])
  const acqRes = useMemo(() => runAcquisition(acqCfg), [acqCfg])
  const acqTl = useMemo(() => acquisitionTimeline(acqCfg), [acqCfg])
  const acqAn = useMemo(() => acquisitionAnalytic(acqCfg), [acqCfg])
  const acqMc = useMemo(() => acquisitionMonteCarlo({ config: acqCfg, runs: 12 }), [acqCfg])
  const dcfg = useMemo<CalSmParams>(() => {
    const lockBlocks = Number.isFinite(acqRes.summary.lockBlocks) ? acqRes.summary.lockBlocks : dcfg0.blocks
    const relock = acqRes.summary.relockBlocks > 0 ? acqRes.summary.relockBlocks : 0
    return { ...dcfg0, lockBlocks, lockLossLen: dcfg0.lockLossLen > 0 ? dcfg0.lockLossLen + relock : dcfg0.lockLossLen }
  }, [dcfg0, acqRes])
  const res = useMemo(() => runCalStateMachine(dcfg), [dcfg])
  const task = useWorkerTask<{ config: CalSmParams; runs: number }, CalSmMonteCarloResult>('optimizer', 'runCalStateMachineMonteCarlo', { restartOnRun: true })
  const [mc, setMc] = useState<{ key: string; res: CalSmMonteCarloResult } | null>(null)
  const [mcErr, setMcErr] = useState<string | null>(null)
  const key = JSON.stringify([dcfg, runs])
  const mcRes = mc && mc.key === key ? mc.res : null
  const { run: runTask } = task
  const run = useCallback(() => {
    setMcErr(null)
    const k = key
    runTask({ config: dcfg, runs }).then(
      (r) => setMc({ key: k, res: r }),
      (e: unknown) => {
        if (!isWorkerCancelled(e)) setMcErr(e instanceof Error ? e.message : String(e))
      },
    )
  }, [runTask, dcfg, runs, key])
  // 掛載時與載入 preset 後自動跑一次 MC（等 deferred 參數追上再跑），之後改參數需手動 Run
  useEffect(() => {
    if (pendingAuto && dcfg0 === cfg && dacq === acq) {
      setPendingAuto(false)
      run()
    }
  }, [pendingAuto, dcfg0, cfg, dacq, acq, run])

  const Bk = res.state.length
  const ks = useMemo(() => Array.from({ length: Bk + 1 }, (_, k) => k), [Bk])
  const segs = useMemo(() => stateSegments(res.state), [res.state])
  const bandShapes = useMemo<Partial<Shape>[]>(() => {
    const s = segs.map((g) => vBand(g.k0, g.k1, withAlpha(stateColor(g.s, tokens), 1), 0.13))
    for (const e of res.events) if (e.kind === 'alarm' || e.kind === 'clip' || e.kind === 'fault') s.push(vLine(e.k, tokens.danger, 'dot'))
    return s
  }, [segs, res.events, tokens])
  const absData = useMemo<Data[]>(() => {
    const abs = (a: Float64Array) => Array.from(a, (v) => Math.max(Math.abs(v), 1e-4))
    return [
      { x: ks, y: abs(res.deltaApplied), name: String.raw`狀態機：DTC 實際誤差 $|a - w_\text{applied}|$（VERIFY 含 $\pm\Delta$）`, line: { color: tokens.text, width: 2 } },
      { x: ks, y: abs(res.delta), name: String.raw`狀態機：暫存器誤差 $|a - w|$`, line: { color: tokens.text, width: 1, dash: 'dot' }, opacity: 0.7 },
      { x: ks, y: abs(res.deltaBase), name: String.raw`固定快 $\mu = ${tx(dcfg.baselineMu, 4)}\,\mathrm{fs}$`, line: { color: tokens.series[1], width: 1.2 }, opacity: 0.85 },
      { x: ks, y: abs(res.deltaBase2), name: String.raw`固定安靜 $\mu = ${tx(dcfg.baselineMu2, 4)}\,\mathrm{fs}$`, line: { color: tokens.series[4], width: 1.2 }, opacity: 0.85 },
    ]
  }, [ks, res, dcfg.baselineMu, dcfg.baselineMu2, tokens])
  const muData = useMemo<Data[]>(
    () => [
      { x: ks.slice(0, Bk), y: Array.from(res.mu, (v) => (v > 0 ? v : null)), name: String.raw`狀態機 $\mu_k$（$\mu_k = 0$：不更新）`, line: { color: tokens.text, shape: 'hv' } },
      { x: ks.slice(0, Bk), y: Array.from(res.state), name: '狀態', yaxis: 'y2', line: { color: tokens.series[0], shape: 'hv', width: 1 } },
    ],
    [ks, Bk, res, tokens],
  )
  const mcData = useMemo<Data[]>(() => {
    if (!mcRes) return []
    return [
      { x: ks, y: Array.from(mcRes.rms), name: `狀態機 RMS（${mcRes.runs} runs）`, line: { color: tokens.text, width: 2.4 } },
      { x: ks, y: Array.from(mcRes.rmsBase), name: String.raw`固定快 $\mu$`, line: { color: tokens.series[1] } },
      { x: ks, y: Array.from(mcRes.rmsBase2), name: String.raw`固定安靜 $\mu$`, line: { color: tokens.series[4] } },
    ]
  }, [mcRes, ks, tokens])

  const deltaLayout = useMemo(() => ({ shapes: bandShapes, xaxis: { title: { text: String.raw`block $k$` } }, yaxis: { title: { text: String.raw`$|\delta|$ (fs，log)` } } }), [bandShapes])
  const mcLayout = useMemo(
    () => ({ shapes: [vBand(dcfg.evalStart, Bk, withAlpha(tokens.series[2], 1), 0.06)], xaxis: { title: { text: String.raw`block $k$` } }, yaxis: { title: { text: String.raw`RMS $\delta$ (fs，log)` } } }),
    [dcfg.evalStart, Bk, tokens],
  )
  // §14.6b acquisition 時間軸（抽樣到 ≤ 2048 點；|Δf| 用 log 軸、θ 在 ACQ 期間是 NaN）
  const acqPlot = useMemo(() => {
    const n = acqRes.df.length
    const step = Math.max(1, Math.ceil(n / 2048))
    const xs: number[] = []
    const df: number[] = []
    const th: (number | null)[] = []
    for (let i = 0; i < n; i += step) {
      xs.push(i)
      df.push(Math.max(Math.abs(acqRes.df[i]) / 1e6, 1e-6))
      th.push(Number.isNaN(acqRes.theta[i]) ? null : acqRes.theta[i])
    }
    const bands = acqRes.segments.map((g) => vBand(g.from, g.to, withAlpha(acqStateColor(g.state, tokens), 1), 0.13))
    const lines = acqRes.events.filter((e) => e.kind === 'slip' || e.kind === 'unlock' || e.kind === 'hold').slice(0, 200).map((e) => vLine(e.n, tokens.danger, 'dot'))
    const T = tVcoFs(acqCfg)
    const dfData: Data[] = [
      { x: xs, y: df, name: String.raw`$|\Delta f[n]|$（真值）`, line: { color: tokens.text, width: 1.6 } },
      { x: [0, n - 1], y: [acqCfg.fTolHz / 1e6, acqCfg.fTolHz / 1e6], name: String.raw`$f_\text{tol}$`, line: { color: tokens.series[2], dash: 'dash', width: 1 } },
      { x: [0, n - 1], y: [acqCfg.fUnlockHz / 1e6, acqCfg.fUnlockHz / 1e6], name: String.raw`$f_\text{unlock}$`, line: { color: tokens.danger, dash: 'dot', width: 1 } },
    ]
    const thData: Data[] = [
      { x: xs, y: th as number[], name: String.raw`$\theta[n]$（SSPD 相位誤差）`, line: { color: tokens.text, width: 1.2 }, connectgaps: false },
      { x: [0, n - 1], y: [acqCfg.thetaMaxFs, acqCfg.thetaMaxFs], name: String.raw`$+\theta_{\max}$`, line: { color: tokens.series[2], dash: 'dash', width: 1 } },
      { x: [0, n - 1], y: [-acqCfg.thetaMaxFs, -acqCfg.thetaMaxFs], name: String.raw`$-\theta_{\max}$`, line: { color: tokens.series[2], dash: 'dash', width: 1 }, showlegend: false },
      { x: [0, n - 1], y: [T / 2, T / 2], name: String.raw`$\pm T_\text{vco}/2$（slip）`, line: { color: tokens.danger, dash: 'dot', width: 1 } },
      { x: [0, n - 1], y: [-T / 2, -T / 2], name: String.raw`$-T_\text{vco}/2$`, line: { color: tokens.danger, dash: 'dot', width: 1 }, showlegend: false },
    ]
    const dfLayout: Partial<Layout> = { shapes: [...bands, ...lines], xaxis: { title: { text: String.raw`reference 週期 $n$` } }, yaxis: { title: { text: String.raw`$|\Delta f|$ (MHz，log)` } } }
    const thLayout: Partial<Layout> = { shapes: [...bands, ...lines], xaxis: { title: { text: String.raw`reference 週期 $n$` } }, yaxis: { title: { text: String.raw`$\theta$ (fs)` } } }
    return { xs, dfData, thData, dfLayout, thLayout }
  }, [acqRes, acqCfg, tokens])
  const acqWarn = acqWarnings(acqCfg, acqRes)
  // Analytic（acquisition 部分）：無雜訊模擬 vs 封閉式——線性 PD 要完全一致（|差| ≤ 1 週期），sine PD 落在 [線性值, 弦斜率上界]
  const acqCheck = (() => {
    const s = acqTl.summary
    if (!acqRes.summary.dtcOk) return { ok: true, note: String.raw`acquisition：DTC 工作點超出範圍，封閉式與模擬都判定不能 enable（一致）` }
    if (!Number.isFinite(acqAn.nEnable)) return { ok: s.enableCycle < 0, note: String.raw`acquisition：封閉式 $n_\text{enable}=\infty$，無雜訊模擬${s.enableCycle < 0 ? '也沒有 enable（一致）' : `卻在 ${s.enableCycle} enable（不一致）`}` }
    if (s.enableCycle < 0) return { ok: false, note: String.raw`acquisition：封閉式 $n_\text{enable}=${acqAn.nEnable}$，無雜訊模擬在 ${acqCfg.cycles} 個週期內沒有 enable` }
    const lin = acqCfg.pdShape === 'linear'
    const okFl = s.freqLockCycle === acqAn.nFL
    const okEn = lin ? Math.abs(s.enableCycle - acqAn.nEnable) <= 1 : s.enableCycle >= acqAn.nEnable - 1 && s.enableCycle <= acqAn.nEnableBound + 1
    return {
      ok: okFl && okEn,
      note:
        String.raw`acquisition（無雜訊模擬 vs 封閉式 F-14.22／F-14.25）：頻率鎖定 ${s.freqLockCycle} vs $n_\text{FL}=${acqAn.nFL}$；enable ${s.enableCycle} vs ` +
        (lin ? String.raw`$n_\text{enable}=${acqAn.nEnable}$（容許 1 週期）` : String.raw`線性 ${acqAn.nEnable}、sine 上界 ${acqAn.nEnableBound}（模擬要落在兩者之間）`) +
        String.raw`；LOCK ${s.lockBlocks} vs ${acqAn.lockBlocks} blocks`,
    }
  })()
  const pred = trackRmsPrediction(dcfg)
  // 單一 seed 的 RMS 有多不準：AR(1) 的相關時間 ≈ 2τ，視窗內的有效獨立樣本數 ≈ 窗長/(2τ)
  const gTrack = dcfg.muTrack * comparatorKq(dcfg.sigmaV) * Math.cos((dcfg.thetaDeg * Math.PI) / 180)
  const tauTrack = gTrack > 0 && gTrack < 1 ? 1 / gTrack : NaN
  const nEff = Math.max(0, Bk - dcfg.evalStart) / (2 * tauTrack)
  const warnings = [...acqWarn, ...smWarnings(dcfg)]
  if (res.summary.fault) {
    warnings.push(`FAULT：狀態機判定無法安全校正（${res.events.filter((e) => e.kind === 'fault' || e.kind === 'clip').map((e) => `block ${e.k}：${e.msg}`).slice(-2).join('；')}），已停止更新並保持 last-known-good，需要外部（FW／mode change）重新觸發。`)
  }
  const analytic: CheckEntry = mcRes
    ? Number.isFinite(pred)
      ? (() => {
          const rel = mcRes.evalRms.mean / pred - 1
          const ok = Math.abs(rel) < 0.25
          return {
            status: ok && acqCheck.ok ? 'ok' : 'mismatch',
            note:
              `${acqCheck.note}。TRACK：狀態機 MC 評估 RMS ${nf(mcRes.evalRms.mean, 3)} vs 線性 TRACK 預測 ${nf(pred, 3)} fs（${(100 * rel).toFixed(1)}%，容許 25%）` +
              (ok ? '' : '；評估視窗內若有 RESTART／VERIFY／FAULT 或事件，純 TRACK 的穩態公式本來就不適用'),
          }
        })()
      : { status: acqCheck.ok ? 'ok' : 'mismatch', note: String.raw`${acqCheck.note}。TRACK：$\mu_\text{track}K$ 不在 $(0,2)$，沒有穩態公式可比` }
    : { status: acqCheck.ok ? 'ok' : 'mismatch', note: `${acqCheck.note}。TRACK：按「執行 Run」後以 MC 對照線性 TRACK 預測` }
  // Monte Carlo 引擎本身的檢查：沒有事件時，「固定快 μ」對照組的評估 RMS 應等於線性穩態公式（F-14.6 + F-14.12）
  const predBase = trackRmsPrediction(dcfg, dcfg.baselineMu)
  const monteCarlo: CheckEntry = !mcRes
    ? { status: 'n/a', note: '尚未執行：按「執行 Run」' }
    : hasDisturbance(dcfg) || !Number.isFinite(predBase)
      ? { status: 'n/a', note: String.raw`${mcRes.runs} runs 已執行；情境含 step／失鎖／bad-FCW 事件（或固定快 $\mu$ 不穩定），固定 $\mu$ 對照組沒有穩態公式可比` }
      : (() => {
          const rel = mcRes.evalRmsBase.mean / predBase - 1
          const ok = Math.abs(rel) < 0.1
          return {
            status: ok ? 'ok' : 'mismatch',
            note:
              String.raw`固定快 $\mu$ 對照組：MC ${nf(mcRes.evalRmsBase.mean, 3)} vs 線性穩態 ${nf(predBase, 3)} fs（${(100 * rel).toFixed(1)}%；${mcRes.runs} runs）` +
              (ok ? '' : String.raw`；評估起點可能還在收斂暫態內，或 $\delta$ 太大使線性化失效（E48）`),
          }
        })()
  const fixedPoint: CheckEntry = { status: 'n/a', note: dcfg.registerLsb > 0 ? 'L5：暫存器量化已在模型中；沒有獨立 bit-true RTL 對照' : '理想浮點（暫存器 LSB 設為 0）' }

  const aS = acqRes.summary
  const metrics: MetricRow[] = [
    {
      name: String.raw`acquisition：頻率鎖定／enable 的週期（單一 seed）`,
      value: aS.enableCycle >= 0 ? `${aS.freqLockCycle} / ${aS.enableCycle}` : aS.freqLockCycle >= 0 ? `${aS.freqLockCycle} / 沒有 enable` : '沒有鎖定',
      unit: 'ref 週期',
      formulaId: 'F-14.25',
      claim: 'exact',
      note: String.raw`封閉式（無雜訊）$n_\text{FL}=${Number.isFinite(acqAn.nFL) ? acqAn.nFL : INF}$、$n_\text{enable}=${Number.isFinite(acqAn.nEnable) ? acqAn.nEnable : INF}$；有雜訊時 lock detect 要等 $\Delta f$ 比 $f_\text{tol}$ 再小幾個 $\sigma_f$（F-14.23）。MC ${acqMc.runs} seeds：enable 平均 ${Number.isFinite(acqMc.enable.mean) ? `${nf(acqMc.enable.mean, 5)} [${nf(acqMc.enable.lo, 5)}, ${nf(acqMc.enable.hi, 5)}]` : '—'}（沒有 enable 的 runs：${acqMc.enable.failed}）`,
    },
    {
      name: 'LOCK 的 block 數（由 acquisition 模型決定）',
      value: Number.isFinite(aS.lockBlocks) ? aS.lockBlocks : '沒有 enable（LOCK 不結束）',
      unit: 'blocks',
      formulaId: 'F-14.25',
      note: String.raw`$\lceil(n_\text{enable}+1)/N\rceil$；MC 各 seed：${acqMc.lockBlocks.map((b) => (Number.isFinite(b) ? String(b) : `$${INF}$`)).join(' ')}` + (aS.relockBlocks > 0 ? String.raw`；失鎖後重新 enable ${aS.relockCycles} 個週期 = ${aS.relockBlocks} blocks（block 級失鎖視窗 ${dcfg0.lockLossLen} + ${aS.relockBlocks} = ${dcfg.lockLossLen}）` : ''),
    },
    {
      name: String.raw`acquisition：slip／失鎖／HOLD 次數；靜態偏移 $\theta_\text{ss}$`,
      value: `${aS.slips} / ${aS.unlocks} / ${aS.holds}；${nf(acqAn.thetaSsFs, 3)} fs`,
      formulaId: 'F-14.24',
      claim: 'approx',
      note: String.raw`$\Delta f_h=${nf(aS.dfHandoffHz / 1e6, 3)}$ MHz $\Rightarrow\Delta T=${nf(acqAn.rampFsPerCycle, 3)}$ fs/週期；倍頻捕獲 $|\Delta f_h|<f_\text{ref}/2$：${acqAn.harmonic.ok ? 'OK' : '錯的倍頻'}；slip 上限 $\Delta f_\text{limit}=${nf(acqAn.slip.dfLimitHz / 1e6, 3)}$ MHz；穩態 $P_\text{slip}=${tx(acqAn.slipProbPerCycle, 2)}$／週期；DTC 工作點：${aS.dtcOk ? 'OK' : '超出範圍'}`,
    },
    {
      name: String.raw`lock detect：$P_\text{miss}$／$E[T_N]$／$P_\text{FA}(f_\text{tol}+\sigma_f)$`,
      value: `${nf(acqAn.pMiss, 2)} / ${nf(acqAn.expectedDetectCycles, 4)} / ${nf(acqAn.pFalseAlarm, 2)}`,
      formulaId: 'F-14.23',
      claim: 'exact',
      note: String.raw`$z=f_\text{tol}/\sigma_f=${nf(acqCfg.fTolHz / acqCfg.sigmaFHz, 3)}$、$N_\text{ld}=${acqCfg.nLd}$（iid Gaussian 估計）`,
    },
    { name: '第一次進入 TRACK 的 block', value: res.summary.firstTrackBlock >= 0 ? res.summary.firstTrackBlock : '沒有' },
    { name: 'RESTART 次數／VERIFY 失敗／clip 事件', value: `${res.summary.restarts} / ${res.summary.verifyFails} / ${res.summary.clipEvents}` },
    { name: 'FAULT', value: res.summary.fault ? '是' : '否' },
    {
      name: String.raw`評估視窗（$k\ge${dcfg.evalStart}$）RMS：狀態機（DTC 實際誤差）`,
      value: res.summary.rmsEval,
      unit: 'fs',
      note:
        String.raw`單一 seed；含 VERIFY 的 $\pm\Delta$ 擾動。只看暫存器誤差為 ${nf(res.summary.rmsEvalRegister, 4)} fs。` +
        (Number.isFinite(nEff)
          ? String.raw`TRACK 的 $\tau\approx1/g_\text{track}=${tx(tauTrack, 3)}$ blocks，視窗內只有約 ${nf(nEff, 2)} 個獨立樣本，所以單一 seed 的 RMS 會隨 seed 變動數十 %；結論以 Monte Carlo 為準`
          : ''),
    },
    { name: String.raw`VERIFY 佔用的 block 數（每個 block 讓 DTC 多 $\pm\Delta$）`, value: res.summary.verifyBlocksUsed, unit: 'blocks', note: String.raw`$\Delta=${dcfg.verifyDelta}\,\mathrm{fs}$` },
    { name: String.raw`評估視窗 RMS：固定快 $\mu$／固定安靜 $\mu$`, value: `${nf(res.summary.rmsEvalBase, 4)} / ${nf(res.summary.rmsEvalBase2, 4)}`, unit: 'fs' },
    { name: '低雜訊視窗內係數改動次數（SM／快／安靜）', value: `${res.summary.updatesInLowNoise} / ${res.summary.updatesInLowNoiseBase} / ${res.summary.updatesInLowNoiseBase2}`, unit: 'blocks' },
    { name: '線性預測：TRACK 穩態 RMS', value: pred, unit: 'fs', formulaId: 'F-14.12', claim: 'approx', note: String.raw`$\sqrt{\sigma_w^2(\mu_\text{track})+(r/g_\text{track})^2}$` },
  ]
  if (mcRes) {
    metrics.push(
      {
        name: 'MC 評估 RMS：狀態機 [95% CI]',
        value: `${nf(mcRes.evalRms.mean, 4)} [${nf(mcRes.evalRms.lo, 4)}, ${nf(mcRes.evalRms.hi, 4)}]`,
        unit: 'fs',
        note: String.raw`DTC 實際誤差（含 VERIFY 的 $\pm\Delta$）；只看暫存器誤差為 ${nf(mcRes.evalRmsRegister.mean, 4)} fs`,
      },
      { name: String.raw`MC 評估 RMS：固定快 $\mu$`, value: `${nf(mcRes.evalRmsBase.mean, 4)} [${nf(mcRes.evalRmsBase.lo, 4)}, ${nf(mcRes.evalRmsBase.hi, 4)}]`, unit: 'fs' },
      { name: String.raw`MC 評估 RMS：固定安靜 $\mu$`, value: `${nf(mcRes.evalRmsBase2.mean, 4)} [${nf(mcRes.evalRmsBase2.lo, 4)}, ${nf(mcRes.evalRmsBase2.hi, 4)}]`, unit: 'fs' },
      { name: String.raw`收斂到 $\text{RMS}\le${dcfg.convTarget}\,\mathrm{fs}$ 的 block（SM／快／安靜）`, value: `${mcRes.settle.sm} / ${mcRes.settle.base} / ${mcRes.settle.base2}`, note: '顯示 -1 代表沒有達到' },
      { name: '平均 RESTART 次數／FAULT runs', value: `${nf(mcRes.meanRestarts, 3)} / ${mcRes.faultRuns}` },
    )
  }
  const presets = presetsForExperiment('cal-state-machine').map((p) => ({ id: p.id, name: p.title, params: p.params, description: p.description }))
  const level = dcfg.registerLsb > 0 ? 'L5' : 'L1'

  return (
    <ExperimentShell
      id="cal-state-machine"
      title="Calibration State Machine：coarse → verify → fine → track → freeze"
      level={level}
      claim="research"
      source={mcRes ? 'simulation' : 'illustrative'}
      description={
        <>
          每個 block 用 exact-binomial Sign-GMAC（L1）；控制器是 RTL 風格的狀態機（暫存器 LSB 大於 0 時暫存器量化，模型層級變成 L5）。同一情境同時跑兩個「固定 <Tex>{'\\mu'}</Tex>、沒有 guard」的對照組。
        </>
      }
      assumptions={[
        String.raw`$x=\pm1$ iid、$C=\cos\theta$、$\sigma_\eta\approx1/\sqrt N$；$\delta=a-w$。狀態機的 RMS 以 DTC 實際誤差 $a-w_\text{applied}$ 計算：VERIFY 期間 $w_\text{applied}=w\pm\Delta$，擾動的代價也算進去`,
        String.raw`失鎖期間 $G$ 與 $\delta$ 無關，只有假相關 $\beta$（cycle slip 示意）；bad-FCW 時 $C$ 乘上一個倍率並加上假相關`,
        String.raw`PVT：$a_k=a_0+rk$ 再加上 step；guards 的門檻以 $\sigma_G/\sqrt W$ 為單位`,
        String.raw`§14.6b：LOCK 的長度 $B_\text{LOCK}=\lceil(n_\text{enable}+1)/N\rceil$ 由 acquisition 模型決定（FLL 一階模型、lock detect 連續 $N_\text{ld}$、sine SSPD、一階相位迴路、$W$ 週期 rms 視窗、DTC 工作點檢查 $[w_0,a_0]$ 在 $x=\pm1$ 不飽和）；失鎖事件的視窗加上重新 acquisition 的 block 數。HOLD／RECAL 尚未接到 block 級（只在 acquisition 指標裡）`,
        '狀態機邏輯是教學用參考設計，不是 sign-off RTL',
      ]}
      params={{ ...cfg, lockBlocks: dcfg.lockBlocks, lockLossLenEffective: dcfg.lockLossLen, acq, runs }}
      seed={cfg.seed}
      onSeedChange={(s) => set('seed', s)}
      units={{ fRefHz: 'Hz', kVcoHzPerLsb: 'Hz/LSB', df0Hz: 'Hz', sigmaFHz: 'Hz', fTolHz: 'Hz', fUnlockHz: 'Hz', fBwHz: 'Hz', sigmaThetaFs: 'fs', theta0Fs: 'fs', thetaMaxFs: 'fs', rmsMaxFs: 'fs', lossDfHz: 'Hz', sigmaV: 'fs', a0: 'fs', w0: 'fs', driftPerBlock: 'fs/block', stepSize: 'fs', muCoarse: 'fs', muFine: 'fs', muTrack: 'fs', verifyDelta: 'fs', verifyTol: 'fs', wMin: 'fs', wMax: 'fs', maxStep: 'fs', registerLsb: 'fs', baselineMu: 'fs', baselineMu2: 'fs', convTarget: 'fs', thetaDeg: 'deg' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{ analytic, monteCarlo, fixedPoint }}
      actions={{
        onRun: run,
        onStop: task.cancel,
        running: task.running,
        onReset: () => {
          setCfg(DEFAULT_CAL_SM)
          setAcq(DEFAULT_ACQ_EXP)
        },
      }}
      exportData={() => ({
        k: ks.slice(0, Bk),
        state: Array.from(res.state, (s) => CAL_STATES[s]),
        a_fs: res.a.slice(0, Bk),
        w_fs: res.w.slice(0, Bk),
        delta_fs: res.delta.slice(0, Bk),
        delta_applied_fs: res.deltaApplied.slice(0, Bk),
        mu_fs: res.mu,
        G: res.G,
        delta_fixed_fast_fs: res.deltaBase.slice(0, Bk),
        delta_fixed_quiet_fs: res.deltaBase2.slice(0, Bk),
        acq_cycle: acqPlot.xs,
        acq_df_hz: acqPlot.xs.map((i) => acqRes.df[i]),
        acq_theta_fs: acqPlot.xs.map((i) => acqRes.theta[i]),
        acq_state: acqPlot.xs.map((i) => ACQ_STATES[acqRes.state[i]]),
        ...(mcRes ? { mc_rms_sm_fs: mcRes.rms.slice(0, Bk), mc_rms_sm_register_fs: mcRes.rmsRegister.slice(0, Bk), mc_rms_fast_fs: mcRes.rmsBase.slice(0, Bk), mc_rms_quiet_fs: mcRes.rmsBase2.slice(0, Bk) } : {}),
      })}
      presets={presets}
      onLoadPreset={(p) => applyPreset(p.params)}
      controls={
        <div className="ch14-controls">
          <Group title="情境：雜訊、PVT、事件" open>
            <ParamControl label={md(String.raw`$\sigma_v$`)} ariaLabel="σ_v" value={cfg.sigmaV} onChange={(v) => set('sigmaV', v)} min={1} max={1000} log unit="fs" reg="pd_noise_rms_fs" />
            <ParamControl label={md(String.raw`$N$`)} ariaLabel="N" value={cfg.N} onChange={(v) => set('N', v)} min={16} max={65536} log integer clampOnBlur reg="REG_GMAC_N" />
            <ParamControl label={md(String.raw`$\theta$（極性相位）`)} ariaLabel="θ（極性相位）" value={cfg.thetaDeg} onChange={(v) => set('thetaDeg', v)} min={-180} max={180} step={1} unit="°" reg="pll_error_path phase（behavioral）" hint={md(String.raw`$|\theta|>90^\circ$ 示範極性錯誤，最後進入 FAULT`)} />
            <ParamControl label={md(String.raw`$a_0$（真實係數）`)} ariaLabel="a_0（真實係數）" value={cfg.a0} onChange={(v) => set('a0', v)} min={-500} max={500} step={1} unit="fs" reg="gain_true" />
            <ParamControl label={md(String.raw`$w_0$（初始暫存器）`)} ariaLabel="w_0（初始暫存器）" value={cfg.w0} onChange={(v) => set('w0', v)} min={-500} max={500} step={1} unit="fs" reg="gain_initial" />
            <ParamControl label="模擬 blocks" value={cfg.blocks} onChange={(v) => set('blocks', v)} min={50} max={5000} log integer clampOnBlur reg="sim length" />
            <ParamControl label={md(String.raw`PVT ramp $r$`)} ariaLabel="PVT ramp r" value={cfg.driftPerBlock} onChange={(v) => set('driftPerBlock', v)} min={-0.1} max={0.1} step={0.0005} unit="fs/block" reg="temperature drift" />
            <ParamControl label={md(String.raw`mode/PVT step 位置（$-1$：無）`)} ariaLabel="mode/PVT step 位置（−1 = 無）" value={cfg.stepBlock} onChange={(v) => set('stepBlock', v)} min={-1} max={5000} step={1} integer reg="mode change event" />
            <ParamControl label={md(String.raw`step 大小 $\Delta a$`)} ariaLabel="step 大小 Δa" value={cfg.stepSize} onChange={(v) => set('stepSize', v)} min={-200} max={200} step={1} unit="fs" reg="mode change step（behavioral）" />
            <ParamControl label={md(String.raw`失鎖開始（$-1$：無）`)} ariaLabel="失鎖開始（−1 = 無）" value={cfg.lockLossStart} onChange={(v) => set('lockLossStart', v)} min={-1} max={5000} step={1} integer reg="lock-loss event" />
            <ParamControl label="失鎖長度" value={cfg.lockLossLen} onChange={(v) => set('lockLossLen', v)} min={0} max={1000} step={1} integer reg="lock-loss duration" />
            <ParamControl label={md(String.raw`失鎖假相關 $\beta$`)} ariaLabel="失鎖假相關 β" value={cfg.unlockBias} onChange={(v) => set('unlockBias', v)} min={0} max={1} step={0.01} reg="cycle-slip bias" />
            <ParamControl label={md(String.raw`bad-FCW 開始（$-1$：無）`)} ariaLabel="bad-FCW 開始（−1 = 無）" value={cfg.badFcwStart} onChange={(v) => set('badFcwStart', v)} min={-1} max={5000} step={1} integer reg="FCW change event" />
            <ParamControl label="bad-FCW 長度" value={cfg.badFcwLen} onChange={(v) => set('badFcwLen', v)} min={0} max={2000} step={1} integer reg="FCW dwell" />
            <ParamControl label={md(String.raw`bad-FCW 時 $C$ 的倍率`)} ariaLabel="bad-FCW 時 C 的倍率" value={cfg.badFcwGain} onChange={(v) => set('badFcwGain', v)} min={0} max={1} step={0.01} reg="bad-FCW correlation ratio（behavioral）" />
            <ParamControl label="bad-FCW 假相關" value={cfg.badFcwBias} onChange={(v) => set('badFcwBias', v)} min={0} max={0.5} step={0.005} reg="bad-FCW correlated bias（Ch11 §11.4）" />
            <ParamControl label={md(String.raw`低雜訊模式開始（$-1$：無）`)} ariaLabel="低雜訊模式開始（−1 = 無）" value={cfg.lowNoiseStart} onChange={(v) => set('lowNoiseStart', v)} min={-1} max={5000} step={1} integer reg="RX sensitive slot" />
            <ParamControl label="低雜訊模式長度" value={cfg.lowNoiseLen} onChange={(v) => set('lowNoiseLen', v)} min={0} max={2000} step={1} integer reg="freeze request" />
          </Group>
          <Group title="Acquisition（§14.6b：FLL、lock detect、SSPD、enable 條件）">
            <ParamControl label={md(String.raw`FLL 增益 $K_f$（每週期）`)} ariaLabel="FLL 增益 K_f" value={fllGain(acq)} onChange={(v) => setA('fllGainLsb', fllGainLsbFor(v, acq))} min={1e-5} max={0.5} log digits={5} reg="FLL_GAIN（K_vco g_f/(M f_ref)）" hint={md(String.raw`$K_\text{vco}=${tx(acq.kVcoHzPerLsb / 1e6, 3)}$ MHz/LSB、$M=${acq.divRatio}$、$f_\text{ref}=${tx(acq.fRefHz / 1e9, 3)}$ GHz；改 $K_f$ 等於改 $g_f$`)} />
            <ParamControl label={md(String.raw`初始頻率誤差 $\Delta f_0$`)} ariaLabel="初始頻率誤差 Δf_0" value={acq.df0Hz / 1e6} onChange={(v) => setA('df0Hz', v * 1e6)} min={0.1} max={2000} log unit="MHz" reg="VCO initial offset（behavioral）" />
            <ParamControl label={md(String.raw`lock 門檻 $f_\text{tol}$`)} ariaLabel="lock 門檻 f_tol" value={acq.fTolHz / 1e6} onChange={(v) => setA('fTolHz', v * 1e6)} min={0.01} max={100} log unit="MHz" reg="LOCK_DET_FTOL" />
            <ParamControl label={md(String.raw`頻率估計雜訊 $\sigma_f$`)} ariaLabel="頻率估計雜訊 σ_f" value={acq.sigmaFHz / 1e6} onChange={(v) => setA('sigmaFHz', v * 1e6)} min={0} max={10} step={0.01} unit="MHz" reg="FD noise rms（behavioral）" />
            <ParamControl label={md(String.raw`連續週期數 $N_\text{ld}$`)} ariaLabel="連續週期數 N_ld" value={acq.nLd} onChange={(v) => setA('nLd', v)} min={1} max={1024} log integer clampOnBlur reg="LOCK_DET_COUNT" />
            <ParamControl label={md(String.raw`失鎖門檻 $f_\text{unlock}$`)} ariaLabel="失鎖門檻 f_unlock" value={acq.fUnlockHz / 1e6} onChange={(v) => setA('fUnlockHz', v * 1e6)} min={0.01} max={200} log unit="MHz" reg="UNLOCK_DET_FTOL" />
            <ParamControl label={md(String.raw`失鎖連續週期數 $N_\text{ul}$`)} ariaLabel="失鎖連續週期數 N_ul" value={acq.nUl} onChange={(v) => setA('nUl', v)} min={1} max={1024} log integer clampOnBlur reg="UNLOCK_DET_COUNT" />
            <ParamControl label={md(String.raw`迴路頻寬 $f_\text{BW}$`)} ariaLabel="迴路頻寬 f_BW" value={acq.fBwHz / 1e6} onChange={(v) => setA('fBwHz', v * 1e6)} min={1} max={1000} log unit="MHz" reg="PLL loop bandwidth" hint={md(String.raw`$g_p=1-e^{-2\pi f_\text{BW}/f_\text{ref}}=${tx(acqAn.gp, 4)}$`)} />
            <SelectControl
              label="PD 特性"
              value={acq.pdShape}
              onChange={(v) => setA('pdShape', v)}
              options={[
                { value: 'sine', label: 'sine（SSPD：單調 ±T_vco/4）' },
                { value: 'linear', label: 'linear（L1 線性化，只有 ±T_vco/2 的 wrap）' },
              ]}
              reg="SSPD model"
            />
            <ParamControl label={md(String.raw`交棒時的相位 $\theta_0$`)} ariaLabel="交棒時的相位 θ_0" value={acq.theta0Fs / 1000} onChange={(v) => setA('theta0Fs', v * 1000)} min={-31} max={31} step={0.5} unit="ps" reg="handoff phase（behavioral）" hint={md(String.raw`吸引區 $\pm T_\text{vco}/2=\pm${tx(tVcoFs(acq) / 2000, 3)}$ ps`)} />
            <ParamControl label={md(String.raw`phase-lock 門檻 $\theta_{\max}$`)} ariaLabel="phase-lock 門檻 θ_max" value={acq.thetaMaxFs} onChange={(v) => setA('thetaMaxFs', v)} min={10} max={30000} log unit="fs" reg="PLOCK_DET_THETA" />
            <ParamControl label={md(String.raw`phase-lock 連續週期數 $N_\text{pl}$`)} ariaLabel="phase-lock 連續週期數 N_pl" value={acq.nPl} onChange={(v) => setA('nPl', v)} min={1} max={1024} log integer clampOnBlur reg="PLOCK_DET_COUNT" />
            <ParamControl label={md(String.raw`PD 雜訊 $\sigma_\theta$`)} ariaLabel="PD 雜訊 σ_θ" value={acq.sigmaThetaFs} onChange={(v) => setA('sigmaThetaFs', v)} min={0} max={5000} step={10} unit="fs" reg="pd_noise_rms_fs（同 σ_v 的節點）" />
            <ParamControl label={md(String.raw`穩態視窗 $W$`)} ariaLabel="穩態視窗 W" value={acq.settleWindow} onChange={(v) => setA('settleWindow', v)} min={8} max={8192} log integer clampOnBlur reg="SETTLE_WIN" />
            <ParamControl label={md(String.raw`穩態門檻 $\mathrm{rms}_{\max}$`)} ariaLabel="穩態門檻 rms_max" value={acq.rmsMaxFs} onChange={(v) => setA('rmsMaxFs', v)} min={1} max={10000} log unit="fs" reg="SETTLE_RMS_MAX" />
            <ParamControl label={md(String.raw`失鎖事件的頻率跳變 $\Delta f_\text{loss}$`)} ariaLabel="失鎖事件的頻率跳變 Δf_loss" value={acq.lossDfHz / 1e6} onChange={(v) => setA('lossDfHz', v * 1e6)} min={0} max={500} step={1} unit="MHz" reg="VCO kick at lock-loss end（behavioral）" hint="失鎖事件（上一組的「失鎖開始／長度」）結束時 VCO 仍偏這麼多，要重新 acquisition" />
            <ParamControl label="DTC 位元數" value={acq.dtcBits} onChange={(v) => setA('dtcBits', v)} min={4} max={16} step={1} integer reg="DTC_BITS（Ch04 §5b）" hint={md(String.raw`$T_0=${tx(acqAn.dtc.t0Fs / 1000, 4)}$ ps、$R=${tx(acqAn.dtc.rangeFs / 1000, 4)}$ ps、LSB $${tx(acqAn.dtc.lsbFs, 3)}$ fs；檢查 $w_0$ 與 $a_0$ 在 $x=\pm1$`)} />
          </Group>
          <Group title="步長排程與 VERIFY" open>
            <ParamControl label={md(String.raw`$\mu_\text{coarse}$`)} ariaLabel="μ_coarse" value={cfg.muCoarse} onChange={(v) => set('muCoarse', v)} min={0.01} max={500} log unit="fs" reg="REG_MU_COARSE" />
            <ParamControl label={md(String.raw`$\mu_\text{fine}$`)} ariaLabel="μ_fine" value={cfg.muFine} onChange={(v) => set('muFine', v)} min={0.01} max={500} log unit="fs" reg="REG_MU_FINE" />
            <ParamControl label={md(String.raw`$\mu_\text{track}$`)} ariaLabel="μ_track" value={cfg.muTrack} onChange={(v) => set('muTrack', v)} min={0.001} max={100} log unit="fs" reg="REG_MU_TRACK" />
            <ParamControl label="coarse blocks" value={cfg.coarseBlocks} onChange={(v) => set('coarseBlocks', v)} min={1} max={2000} log integer clampOnBlur reg="CAL_COARSE_BLOCKS" />
            <ParamControl label="fine blocks" value={cfg.fineBlocks} onChange={(v) => set('fineBlocks', v)} min={1} max={5000} log integer clampOnBlur reg="CAL_FINE_BLOCKS" />
            <ParamControl label={md(String.raw`VERIFY blocks（$\pm\Delta$ 各半）`)} ariaLabel="VERIFY blocks（±Δ 各半）" value={cfg.verifyBlocks} onChange={(v) => set('verifyBlocks', v)} min={2} max={1024} log integer clampOnBlur reg="CAL_VERIFY_BLOCKS" />
            <ParamControl label={md(String.raw`VERIFY 擾動 $\Delta$`)} ariaLabel="VERIFY 擾動 Δ" value={cfg.verifyDelta} onChange={(v) => set('verifyDelta', v)} min={0.1} max={500} log unit="fs" reg="CAL_PROBE_DELTA" />
            <ParamControl label={md(String.raw`VERIFY 殘差容許 $|\hat\delta|$`)} ariaLabel="VERIFY 殘差容許 |δ̂|" value={cfg.verifyTol} onChange={(v) => set('verifyTol', v)} min={0.01} max={200} log unit="fs" reg="CAL_VERIFY_TOL" />
            <ParamControl label={md(String.raw`VERIFY 極性門檻 $z$`)} ariaLabel="VERIFY 極性門檻 z" value={cfg.verifyZ} onChange={(v) => set('verifyZ', v)} min={0} max={10} step={0.1} reg="CAL_VERIFY_POL_Z（斜率顯著性門檻）" />
          </Group>
          <Group title="Guards（hysteresis、lock、clip、bad-FCW、fallback）">
            <ToggleControl label="lock detect（失鎖時暫停）" value={cfg.lockDetect} onChange={(v) => set('lockDetect', v)} reg="PLL_LOCK_DET" />
            <ToggleControl label="clip detect" value={cfg.clipDetect} onChange={(v) => set('clipDetect', v)} reg="GAIN_CLIP_FLAG" />
            <ToggleControl label="hysteresis（Schmitt trigger）" value={cfg.hysteresis} onChange={(v) => set('hysteresis', v)} reg="TRACK_ALARM_HYST" />
            <ToggleControl label="fallback 到 last-known-good" value={cfg.fallback} onChange={(v) => set('fallback', v)} reg="LKG_RESTORE_EN" />
            <SelectControl
              label="bad-FCW policy"
              value={cfg.badFcwPolicy}
              onChange={(v) => set('badFcwPolicy', v)}
              options={[
                { value: 'freeze', label: 'freeze（暫停更新）' },
                { value: 'ignore', label: 'ignore（照常更新）' },
              ]}
              reg="BAD_FCW_POLICY"
            />
            <ParamControl label={md(String.raw`TRACK 警報視窗 $W$`)} ariaLabel="TRACK 警報視窗 W" value={cfg.trackWindow} onChange={(v) => set('trackWindow', v)} min={1} max={512} log integer clampOnBlur reg="TRACK_WIN" />
            <ParamControl label={md(String.raw`警報高門檻（$\sigma_G/\sqrt W$ 單位）`)} ariaLabel="警報高門檻（σ_G/√W 單位）" value={cfg.alarmHiZ} onChange={(v) => set('alarmHiZ', v)} min={0.5} max={20} step={0.1} reg="TRACK_ALARM_HI" />
            <ParamControl label="警報低門檻" value={cfg.alarmLoZ} onChange={(v) => set('alarmLoZ', v)} min={0} max={20} step={0.1} reg="TRACK_ALARM_LO" />
            <ParamControl label="警報持續 blocks" value={cfg.alarmHold} onChange={(v) => set('alarmHold', v)} min={1} max={256} step={1} integer reg="TRACK_ALARM_HOLD" />
            <ParamControl label={md(String.raw`$w_{\min}$`)} ariaLabel="w_min" value={cfg.wMin} onChange={(v) => set('wMin', v)} min={-2000} max={2000} step={1} unit="fs" reg="GAIN_REG_MIN" />
            <ParamControl label={md(String.raw`$w_{\max}$`)} ariaLabel="w_max" value={cfg.wMax} onChange={(v) => set('wMax', v)} min={-2000} max={2000} step={1} unit="fs" reg="GAIN_REG_MAX" />
            <ParamControl label="clip 判定 blocks" value={cfg.clipBlocks} onChange={(v) => set('clipBlocks', v)} min={1} max={256} step={1} integer reg="CLIP_COUNT" />
            <ParamControl label={md(String.raw`max step $|\Delta w|$（0：不限）`)} ariaLabel="max step |Δw|（0 = 不限）" value={cfg.maxStep} onChange={(v) => set('maxStep', v)} min={0} max={500} step={0.5} unit="fs" reg="MAX_UPDATE" />
            <ParamControl label="最多重試" value={cfg.maxRetries} onChange={(v) => set('maxRetries', v)} min={0} max={20} step={1} integer reg="CAL_MAX_RETRY" />
            <ParamControl label="暫存器 LSB（0 = 浮點）" value={cfg.registerLsb} onChange={(v) => set('registerLsb', v)} min={0} max={4} step={0.001} unit="fs" reg="gain_register LSB（L5）" />
          </Group>
          <Group title="對照組與評估">
            <ParamControl label={md(String.raw`固定「快」$\mu$（對照 A）`)} ariaLabel="固定「快」μ（對照 A）" value={cfg.baselineMu} onChange={(v) => set('baselineMu', v)} min={0.001} max={500} log unit="fs" reg="baseline A" />
            <ParamControl label={md(String.raw`固定「安靜」$\mu$（對照 B）`)} ariaLabel="固定「安靜」μ（對照 B）" value={cfg.baselineMu2} onChange={(v) => set('baselineMu2', v)} min={0.001} max={500} log unit="fs" reg="baseline B" />
            <ParamControl label="評估起點 block" value={cfg.evalStart} onChange={(v) => set('evalStart', v)} min={0} max={5000} step={1} integer reg="metric window" />
            <ParamControl label="收斂判定 RMS" value={cfg.convTarget} onChange={(v) => set('convTarget', v)} min={0.01} max={100} log unit="fs" reg="settle threshold" />
            <ParamControl label="MC runs" value={runs} onChange={setRuns} min={4} max={1000} log integer clampOnBlur reg="Monte Carlo runs" />
          </Group>
        </div>
      }
    >
      {mcErr && <Callout kind="danger">Monte Carlo 失敗：{mcErr}</Callout>}
      <h4>Acquisition 時間軸（§14.6b；reference 週期）</h4>
      <div className="ch14-legend" aria-label="acquisition 狀態顏色">
        {ACQ_STATES.map((s) => (
          <span key={s}>
            <i style={{ background: withAlpha(acqStateColor(s, tokens), 0.45) }} />
            {s}
          </span>
        ))}
      </div>
      <Plot
        title={String.raw`FLL：$|\Delta f[n]|$ 與 lock／unlock 門檻（背景色：acquisition 狀態；紅點線：slip／失鎖／HOLD）`}
        data={acqPlot.dfData}
        yLog
        height={280}
        csvName="ch14-acq-df"
        layout={acqPlot.dfLayout}
        caption={md(
          String.raw`單一 seed（同 block 級狀態機的 seed）。$|\Delta f|$ 以 $(1-K_f)^n$ 指數下降（F-14.22），進 $f_\text{tol}$ 之後要連續 $N_\text{ld}$ 個週期才宣告頻率鎖定；之後 FLL 凍結，殘餘 $\Delta f_h$ 留下相位斜坡。失鎖事件把 $\Delta f$ 踢回門檻外，$|\hat{\Delta f}|>f_\text{unlock}$ 連續 $N_\text{ul}$ 個週期後回 ACQ 重拉。`,
        )}
      />
      <Plot
        title={String.raw`SSPD 相位誤差 $\theta[n]$ 與 $\pm\theta_{\max}$、$\pm T_\text{vco}/2$`}
        data={acqPlot.thData}
        height={260}
        csvName="ch14-acq-theta"
        layout={acqPlot.thLayout}
        caption={md(
          String.raw`ACQ 期間相位迴路未閉合（不畫）；頻率鎖定後從 $\theta_0$ 以 $(1-g_p)^n$ 收到門檻內（F-14.25），再等 $W$ 個週期的 rms 視窗；$|\theta|$ 超過 $\pm T_\text{vco}/2$ 就 cycle slip（F-14.24）。`,
        )}
      />
      <details className="ch14-details">
        <summary>acquisition 事件紀錄（單一 seed；共 {acqRes.events.length} 筆）</summary>
        <div className="ch14-events" role="log" aria-label="acquisition 事件紀錄">
          {acqRes.events.slice(0, 120).map((e, i) => (
            <div key={i}>
              <span className="k">n={e.n}</span> [{e.kind}] {mathText(e.msg)}
            </div>
          ))}
          {acqRes.events.length > 120 && <div>…（共 {acqRes.events.length} 筆）</div>}
        </div>
      </details>
      <h4>Block 級狀態機（§14.7；block）</h4>
      <div className="ch14-legend" aria-label="狀態顏色">
        {CAL_STATES.map((s) => (
          <span key={s}>
            <i style={{ background: withAlpha(stateColor(s, tokens), 0.45) }} />
            {s}
          </span>
        ))}
      </div>
      <Plot
        title="誤差絕對值（背景色：狀態；紅點線：警報／clip／fault）"
        data={absData}
        yLog
        height={340}
        csvName="ch14-sm-delta"
        layout={deltaLayout}
        caption={md(
          String.raw`單一 seed、即時計算。實線是 DTC 實際看到的誤差 $|a-w_\text{applied}|$：VERIFY 期間 $w_\text{applied}=w\pm\Delta$，所以出現一段約 $\Delta$ 高的平台，這是量測斜率的代價；點線是暫存器誤差 $|a-w|$。比較：狀態機先用大步長快速收斂，再降到 $\mu_\text{track}$ 壓低雜訊；固定快 $\mu$ 收斂快但穩態抖動大；固定安靜 $\mu$ 穩態小但收斂很慢。`,
        )}
      />
      <Plot
        title={String.raw`$\mu_k$ 與狀態時間軸`}
        data={muData}
        height={260}
        csvName="ch14-sm-mu"
        layout={MU_LAYOUT}
      />
      {mcRes ? (
        <Plot
          title={`Monte Carlo $\\text{RMS}(k)$（${mcRes.runs} runs）`}
          data={mcData}
          yLog
          height={300}
          csvName="ch14-sm-mc"
          layout={mcLayout}
          caption={md(String.raw`淡綠區為評估視窗（$k\ge${dcfg.evalStart}$）。狀態機曲線是 DTC 實際誤差（VERIFY 的 $\pm\Delta$ 也算在內）。線性 TRACK 預測 ${nf(pred, 3)} fs。`)}
        />
      ) : (
        <p className="small muted">按「執行 Run」在 Web Worker 中跑 {runs} 個 seeds，得到逐 block 的 RMS 與評估視窗 RMS 的 95% CI。</p>
      )}
      <h4>事件紀錄（單一 seed）</h4>
      <div className="ch14-events" role="log" aria-label="狀態機事件紀錄">
        {res.events.slice(0, 300).map((e, i) => (
          <div key={i}>
            <span className="k">k={e.k}</span> [{e.kind}] {mathText(e.msg)}
          </div>
        ))}
        {res.events.length > 300 && <div>…（共 {res.events.length} 筆）</div>}
      </div>
      <p className="small muted">
        狀態說明：{CAL_STATES.map((s) => `${s}：${CAL_STATE_LABEL[s]}`).join('；')}。VERIFY 期間 DTC 實際使用 <Tex>{'w\\pm\\Delta'}</Tex>，所以評估 RMS 用 <Tex>{'a-w_\\text{applied}'}</Tex>（擾動的代價算在狀態機頭上），暫存器誤差{' '}
        <Tex>{'\\delta=a-w'}</Tex> 另列一欄。
      </p>
    </ExperimentShell>
  )
}
