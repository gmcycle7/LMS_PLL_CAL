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
  const [runs, setRuns] = useState(48)
  const [pendingAuto, setPendingAuto] = useState(true)
  const urlPreset = useUrlPreset('cal-state-machine')
  useEffect(() => {
    if (urlPreset) {
      setCfg({ ...DEFAULT_CAL_SM, ...(urlPreset.params as Partial<CalSmParams>) })
      setPendingAuto(true)
    }
  }, [urlPreset])
  const set = <K extends keyof CalSmParams>(k: K, v: CalSmParams[K]) => setCfg((c) => ({ ...c, [k]: v }))
  const dcfg = useDeferredValue(cfg)
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
    if (pendingAuto && dcfg === cfg) {
      setPendingAuto(false)
      run()
    }
  }, [pendingAuto, dcfg, cfg, run])

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
  const pred = trackRmsPrediction(dcfg)
  // 單一 seed 的 RMS 有多不準：AR(1) 的相關時間 ≈ 2τ，視窗內的有效獨立樣本數 ≈ 窗長/(2τ)
  const gTrack = dcfg.muTrack * comparatorKq(dcfg.sigmaV) * Math.cos((dcfg.thetaDeg * Math.PI) / 180)
  const tauTrack = gTrack > 0 && gTrack < 1 ? 1 / gTrack : NaN
  const nEff = Math.max(0, Bk - dcfg.evalStart) / (2 * tauTrack)
  const warnings = smWarnings(dcfg)
  if (res.summary.fault) {
    warnings.push(`FAULT：狀態機判定無法安全校正（${res.events.filter((e) => e.kind === 'fault' || e.kind === 'clip').map((e) => `block ${e.k}：${e.msg}`).slice(-2).join('；')}），已停止更新並保持 last-known-good，需要外部（FW／mode change）重新觸發。`)
  }
  const analytic: CheckEntry = mcRes
    ? Number.isFinite(pred)
      ? (() => {
          const rel = mcRes.evalRms.mean / pred - 1
          const ok = Math.abs(rel) < 0.25
          return {
            status: ok ? 'ok' : 'mismatch',
            note:
              `狀態機 MC 評估 RMS ${nf(mcRes.evalRms.mean, 3)} vs 線性 TRACK 預測 ${nf(pred, 3)} fs（${(100 * rel).toFixed(1)}%）` +
              (ok ? '' : '；評估視窗內若有 RESTART／VERIFY／FAULT 或事件，純 TRACK 的穩態公式本來就不適用'),
          }
        })()
      : { status: 'n/a', note: String.raw`$\mu_\text{track}K$ 不在 $(0,2)$` }
    : { status: 'n/a', note: '按「執行 Run」後以 MC 對照線性 TRACK 預測' }
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

  const metrics: MetricRow[] = [
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
  const presets = presetsForExperiment('cal-state-machine').map((p) => ({ name: p.title, params: p.params, description: p.description }))
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
        '狀態機邏輯是教學用參考設計，不是 sign-off RTL',
      ]}
      params={{ ...cfg, runs }}
      seed={cfg.seed}
      onSeedChange={(s) => set('seed', s)}
      units={{ sigmaV: 'fs', a0: 'fs', w0: 'fs', driftPerBlock: 'fs/block', stepSize: 'fs', muCoarse: 'fs', muFine: 'fs', muTrack: 'fs', verifyDelta: 'fs', verifyTol: 'fs', wMin: 'fs', wMax: 'fs', maxStep: 'fs', registerLsb: 'fs', baselineMu: 'fs', baselineMu2: 'fs', convTarget: 'fs', thetaDeg: 'deg' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{ analytic, monteCarlo, fixedPoint }}
      actions={{ onRun: run, onStop: task.cancel, running: task.running, onReset: () => setCfg(DEFAULT_CAL_SM) }}
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
        ...(mcRes ? { mc_rms_sm_fs: mcRes.rms.slice(0, Bk), mc_rms_sm_register_fs: mcRes.rmsRegister.slice(0, Bk), mc_rms_fast_fs: mcRes.rmsBase.slice(0, Bk), mc_rms_quiet_fs: mcRes.rmsBase2.slice(0, Bk) } : {}),
      })}
      presets={presets}
      onLoadPreset={(p) => {
        setCfg({ ...DEFAULT_CAL_SM, ...(p.params as Partial<CalSmParams>) })
        setPendingAuto(true)
      }}
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
            <ParamControl label="開機鎖定 blocks" value={cfg.lockBlocks} onChange={(v) => set('lockBlocks', v)} min={0} max={500} step={1} integer reg="PLL lock time" />
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
