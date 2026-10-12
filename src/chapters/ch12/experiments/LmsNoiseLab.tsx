import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import {
  CaseSelector,
  ExperimentShell,
  ModeGate,
  ParamControl,
  Plot,
  SelectControl,
  Tex,
  mathText,
  stripMathDelimiters,
  useCases,
  useDebouncedValue,
  useThemeTokens,
  type CheckStatus,
  type CrossCheck,
  type MetricRow,
} from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import {
  ENGINE_LABEL,
  REGIME_LABEL,
  REGIME_LABEL_TEX,
  texNum,
  calLoop,
  swOneSided,
  type CalLoop,
  type GmMode,
  type NoiseEngine,
  type NoiseLabBatchParams,
  type NoiseLabBatchResult,
  type NoiseLabSimParams,
  type NoiseLabSimResult,
} from '@/simulation/models/calNoise'
import { md, sig, sigText } from '../common'

export interface NoiseLabParams {
  N: number
  fs: number
  mu: number
  sigmaV: number
  C: number
  gmMode: GmMode
  engine: NoiseEngine
  blocks: number
  chains: number
  dw0: number
  /** S_η 的形狀：AR(1) lag-1 相關 r（0 = 白色，規格 §12.1） */
  etaR: number
}

export const NOISE_LAB_DEFAULTS: NoiseLabParams = {
  N: 4096,
  fs: 4e9,
  mu: 10,
  sigmaV: 100,
  C: 1,
  gmMode: 'average',
  engine: 'binomial',
  blocks: 4000,
  chains: 8,
  dw0: 3,
  etaR: 0,
}

const EXP_ID = 'lms-noise-lab'
// Plot 的 layout 放在模組層：參考不變 ⇒ 重新 render（例如 worker 狀態改變）時不會重畫、也不會重設使用者的 zoom
// 圖內的數學寫 `$...$`（Plot 元件轉成斜體符號與上下標；plotMath.ts）
const TRACE_LAYOUT: Partial<Layout> = { xaxis: { title: { text: 'block $k$' } }, yaxis: { title: { text: String.raw`$\delta w_k = w_k - w^*$ [fs]` } } }
const PSD_LAYOUT: Partial<Layout> = {
  xaxis: { title: { text: String.raw`$f$ [Hz]（block rate $f_u$）` } },
  yaxis: { title: { text: String.raw`$S_w^{(1)}$ [$\mathrm{fs}^2/\mathrm{Hz}$]（one-sided）` } },
}
/** 自動重跑的工作量上限（所有 case 的 block × chain 總和）；超過或含 sample 引擎時改為手動 Run */
const AUTO_LIMIT = 400_000

function toSim(p: NoiseLabParams, seed: number): NoiseLabSimParams {
  return { ...p, seed, nperseg: Math.min(512, p.blocks) }
}

/** 單一 case 的 Monte Carlo 判定：CI 涵蓋解析 σ_w ⇒ ok。colored η 用在 (b)(c) 引擎時兩者模型不同 ⇒ n/a。 */
function caseCheck(lp: CalLoop, r: NoiseLabSimResult | null): { status: CheckStatus; note: string } {
  if (!r) return { status: 'n/a', note: '尚無結果' }
  if (!Number.isFinite(lp.sigmaW)) return { status: 'n/a', note: String.raw`解析 $\sigma_w$ 不存在（${REGIME_LABEL_TEX[lp.regime]}）` }
  if (r.engine !== 'linear' && lp.input.etaR !== 0) return { status: 'n/a', note: String.raw`colored $\eta$ 只適用引擎 (a)` }
  if (!Number.isFinite(r.sigmaWLo) || !Number.isFinite(r.sigmaWHi)) return { status: 'n/a', note: 'CI 無法計算（chain 太少或發散）' }
  const ok = r.sigmaWLo <= lp.sigmaW && lp.sigmaW <= r.sigmaWHi
  const base = String.raw`95% CI $[${texNum(r.sigmaWLo, 4)},\ ${texNum(r.sigmaWHi, 4)}]$ vs 解析 $${texNum(lp.sigmaW, 4)}$ fs`
  // 95% CI 本來就約每 20 個 seed 有一次不涵蓋真值：mismatch 時提醒先換 seed / 加 chains，再判斷是否為模型偏差（例如 K_q 線性化失效）
  return { status: ok ? 'ok' : 'mismatch', note: ok ? base : `${base}；單一 seed 的 95% CI 約有 5% 機率不涵蓋，請換 seed 或增加 chains 再確認` }
}

export function LmsNoiseLab() {
  const cases = useCases<NoiseLabParams>(NOISE_LAB_DEFAULTS, { seed: 20261010 })
  const { update, reset } = cases
  const prm = cases.active.params
  const seed = cases.seed
  const tokens = useThemeTokens()
  const task = useWorkerTask<NoiseLabBatchParams, NoiseLabBatchResult>('calNoise', 'runNoiseLabBatch', { restartOnRun: true })
  const { run, cancel } = task
  const [res, setRes] = useState<{ key: string; r: NoiseLabBatchResult } | null>(null)

  const urlPreset = useUrlPreset(EXP_ID)
  useEffect(() => {
    if (urlPreset) reset({ ...NOISE_LAB_DEFAULTS, ...(urlPreset.params as Partial<NoiseLabParams>) })
  }, [urlPreset, reset])
  const presets = useMemo(
    () => presetsForExperiment(EXP_ID).map((p) => ({ name: p.title, params: p.params, description: p.description })),
    [],
  )

  const lp = useMemo(() => calLoop(prm), [prm])
  const loops = useMemo(() => cases.cases.map((c) => ({ id: c.id, idx: c.seriesIndex, params: c.params, lp: calLoop(c.params) })), [cases.cases])
  // 所有 case 一起送進 worker（同一個 seed ⇒ paired simulation）
  const key = JSON.stringify({ c: cases.cases.map((c) => [c.id, c.params]), seed })
  const debouncedKey = useDebouncedValue(key, 350)
  const totalWork = cases.cases.reduce((a, c) => a + c.params.blocks * c.params.chains, 0)
  const anySample = cases.cases.some((c) => c.params.engine === 'sample')
  const auto = !anySample && totalWork <= AUTO_LIMIT

  const doRun = useCallback(() => {
    const k = key
    run({ cases: cases.cases.map((c) => ({ id: c.id, params: toSim(c.params, seed) })) })
      .then((r) => setRes({ key: k, r }))
      .catch((e: unknown) => {
        if (!isWorkerCancelled(e)) setRes(null)
      })
  }, [key, cases.cases, seed, run])

  useEffect(() => {
    if (auto && debouncedKey === key) doRun()
    // 只在 debounce 後的參數改變時自動執行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedKey, auto])

  const batch = res && res.key === key ? res.r : null
  const stale = res !== null && res.key !== key
  const itemOf = useCallback((id: string) => batch?.items.find((i) => i.id === id) ?? null, [batch])
  const current = itemOf(cases.activeId)?.result ?? null
  const colored = lp.input.etaR !== 0

  const metrics: MetricRow[] = useMemo(() => {
    const rows: MetricRow[] = [
      { name: String.raw`$K=K_qC$`, value: lp.K, unit: String.raw`$\mathrm{fs}^{-1}$`, formulaId: 'F-12.1', claim: 'approx', digits: 6 },
      { name: String.raw`$g=\mu K$（sum 模式再乘 $N$）`, value: lp.g, unit: '—', formulaId: 'F-12.2', claim: 'exact', digits: 6 },
      { name: String.raw`$p=1-g$`, value: lp.p, unit: '—', formulaId: 'F-12.2', claim: 'exact', digits: 8 },
      { name: String.raw`$f_u=f_s/N$`, value: lp.fu, unit: 'Hz', claim: 'exact', digits: 8 },
      { name: '型態', value: REGIME_LABEL[lp.regime] },
      { name: String.raw`$\tau=-1/\ln|p|$`, value: lp.tauBlocks, unit: 'blocks', claim: 'exact', digits: 5 },
      { name: String.raw`$f_{3\mathrm{dB}}$（exact discrete）`, value: Number.isFinite(lp.f3dbExact) ? lp.f3dbExact : '不存在', unit: 'Hz', formulaId: 'F-12.7', claim: 'exact', digits: 7 },
      {
        name: String.raw`$f_{3\mathrm{dB}}\approx\tfrac{1-p}{2\pi}f_u$`,
        value: lp.f3dbOneMinusP,
        unit: 'Hz',
        formulaId: 'F-12.8',
        claim: 'approx',
        analytic: Number.isFinite(lp.f3dbExact) ? lp.f3dbExact : undefined,
        digits: 7,
        note: String.raw`相對 exact 的誤差 $\approx-(1-p)/2$（E26）`,
      },
      {
        name: String.raw`$f_{3\mathrm{dB}}\approx\tfrac{-\ln p}{2\pi}f_u$`,
        value: lp.f3dbNegLnP,
        unit: 'Hz',
        formulaId: 'F-12.8',
        claim: 'approx',
        analytic: Number.isFinite(lp.f3dbExact) ? lp.f3dbExact : undefined,
        digits: 7,
        note: String.raw`相對 exact 的誤差 $\approx-(1-p)^2/12$`,
      },
      {
        name: 'ENBW（one-sided，積分用）',
        value: lp.enbw,
        unit: 'Hz',
        formulaId: 'F-12.9',
        claim: 'exact',
        digits: 7,
        note: String.raw`不是 −3 dB；白色 $\eta$ 時 $\sigma_w^2=S_w^{(1)}(0)\cdot\mathrm{ENBW}$（E06）`,
      },
      {
        name: String.raw`$S_w^{(1)}(0)$`,
        value: lp.sw1Dc,
        unit: String.raw`$\mathrm{fs}^2/\mathrm{Hz}$`,
        formulaId: 'F-12.10',
        claim: 'exact',
        digits: 5,
        note: colored ? undefined : String.raw`白色 $\eta$ 時 $=\pi\sigma_v^2/(C^2f_s)$：與 $\mu$、$N$ 無關`,
      },
      { name: String.raw`$\sigma_w$（解析）`, value: lp.sigmaW, unit: 'fs', formulaId: 'F-12.5', claim: 'exact', digits: 6, note: 'gain-equivalent，不是 output jitter' },
      {
        name: String.raw`$\sqrt{S_w^{(1)}(0)\cdot f_{3\mathrm{dB}}}$（錯誤用法）`,
        value: Math.sqrt(lp.sw1Dc * lp.f3dbExact),
        unit: 'fs',
        analytic: lp.sigmaW,
        digits: 5,
        note: String.raw`反面示範：把 $f_{3\mathrm{dB}}$ 當 Noise BW 會低估 $\sigma_w$（E06 / E10）；$\Delta$ 欄就是低估的量`,
      },
    ]
    if (colored) {
      rows.push(
        { name: String.raw`colored $\eta$ 修正 $\tfrac{1+pr}{1-pr}$`, value: lp.colorFactor, unit: '—', claim: 'exact', digits: 6, note: String.raw`$\sigma_w^2$ 相對白色 $\eta$ 的倍數` },
        {
          name: String.raw`實際 PSD 的等效雜訊頻寬 $\sigma_w^2/S_w^{(1)}(0)$`,
          value: lp.enbwEff,
          unit: 'Hz',
          claim: 'exact',
          digits: 6,
          note: String.raw`colored $\eta$ 時 $\ne$ $H_{\eta\to w}$ 的 ENBW`,
        },
      )
    }
    if (current) {
      // tolerance 取「估計值到 CI 對應邊界的距離」⇒ ✓ 恰好等於「CI 涵蓋解析值」
      const sigmaRef = lp.sigmaW
      const tol =
        Number.isFinite(current.sigmaWHi) && Number.isFinite(sigmaRef)
          ? sigmaRef < current.sigmaW
            ? current.sigmaW - current.sigmaWLo
            : current.sigmaWHi - current.sigmaW
          : undefined
      rows.push(
        {
          name: String.raw`$\sigma_w$（Monte Carlo，${current.engine === 'linear' ? '線性' : current.engine === 'binomial' ? 'Binomial' : 'sample-level'}）`,
          value: current.sigmaW,
          unit: 'fs',
          claim: 'approx',
          analytic: Number.isFinite(sigmaRef) ? sigmaRef : undefined,
          tolerance: tol,
          digits: 5,
          note: String.raw`95% CI $[${texNum(current.sigmaWLo, 4)},\ ${texNum(current.sigmaWHi, 4)}]$ fs；✓ 表示 CI 涵蓋解析值`,
        },
        {
          name: colored ? String.raw`$\hat\rho_1$（lag-1 自相關；colored $\eta$ 時 $\ne p$）` : String.raw`$\hat p$（lag-1 自相關，白色 $\eta$ 時 $=p$）`,
          value: current.pHat,
          analytic: Number.isFinite(lp.rho1) ? lp.rho1 : undefined,
          tolerance: 0.01,
          digits: 6,
          claim: 'approx',
          note: colored ? String.raw`解析 $\rho_1=p+\tfrac{r(1-p^2)}{1+pr}$` : undefined,
        },
      )
      if (!colored) {
        rows.push(
          { name: String.raw`$f_{3\mathrm{dB}}$（由 $\hat p$）`, value: current.f3dbFromPHat, unit: 'Hz', analytic: Number.isFinite(lp.f3dbExact) ? lp.f3dbExact : undefined, digits: 6 },
          { name: String.raw`ENBW（由 $\hat p$）`, value: current.enbwFromPHat, unit: 'Hz', analytic: Number.isFinite(lp.enbw) ? lp.enbw : undefined, digits: 6 },
        )
      }
      rows.push({ name: String.raw`穩態平均 $\overline{\delta w}$`, value: current.meanDw, unit: 'fs', digits: 4, note: String.raw`Sign-LMS 對稱情況 $w^*=a$，應 $\approx0$` })
    }
    return rows
  }, [lp, current, colored])

  const crossCheck: CrossCheck = useMemo(() => {
    let mc: { status: CheckStatus; note: string } = { status: 'n/a', note: auto ? '計算中…' : '按「執行 Run」' }
    if (batch) {
      const checks = loops.map((c) => ({ id: c.id, ...caseCheck(c.lp, itemOf(c.id)?.result ?? null) }))
      const bad = checks.filter((c) => c.status === 'mismatch')
      const good = checks.filter((c) => c.status === 'ok')
      const note = checks.map((c) => `Case ${c.id}：${c.status}（${c.note}）`).join('；')
      mc = { status: bad.length ? 'mismatch' : good.length ? 'ok' : 'n/a', note }
    }
    const valid = Number.isFinite(lp.sigmaW)
    return {
      analytic: valid
        ? { status: 'ok', note: String.raw`封閉式；T13 / T14 對 golden 向量（容差 $10^{-12}$ / 相對 $10^{-10}$）；colored $\eta$ 以 Parseval 積分核對` }
        : { status: 'n/a', note: REGIME_LABEL_TEX[lp.regime] },
      monteCarlo: mc,
      fixedPoint: { status: 'not-implemented', note: '6-bit 暫存器量化見第 13 章（blockLms L5）' },
    }
  }, [lp, batch, loops, itemOf, auto])

  const warnings = useMemo(() => {
    const w = [...lp.warnings]
    if (current) for (const x of current.warnings) if (!w.includes(x)) w.push(x)
    for (const it of batch?.items ?? []) if (it.error) w.push(`Case ${it.id} 模擬失敗：${it.error}`)
    if (task.error) w.push(`模擬失敗：${task.error.message}`)
    return w
  }, [lp, current, batch, task.error])

  const tracePlot: Data[] = useMemo(() => {
    const out: Data[] = []
    for (const c of loops) {
      const r = itemOf(c.id)?.result
      if (!r) continue
      const active = c.id === cases.activeId
      out.push({ x: r.trace.k, y: r.trace.dw, name: String.raw`$\delta w_k$（Case ${c.id}，chain 0）`, mode: 'lines', line: { width: active ? 1.2 : 0.8, color: tokens.series[c.idx] }, opacity: active ? 1 : 0.6 })
    }
    if (current && Number.isFinite(lp.sigmaW)) {
      const k = current.trace.k
      const kk = [k[0], k[k.length - 1]]
      out.push(
        { x: kk, y: [lp.sigmaW, lp.sigmaW], name: String.raw`$\pm\sigma_w$（解析，Case ${cases.activeId}）`, mode: 'lines', line: { dash: 'dash', color: tokens.textMuted } },
        { x: kk, y: [-lp.sigmaW, -lp.sigmaW], name: String.raw`$-\sigma_w$`, mode: 'lines', line: { dash: 'dash', color: tokens.textMuted }, showlegend: false },
      )
      const env = Array.from(k, (kv) => prm.dw0 * Math.pow(lp.p, kv))
      out.push({ x: k, y: env, name: String.raw`$E[\delta w_k] = \delta w_0\,p^k$`, mode: 'lines', line: { dash: 'dot', color: tokens.textMuted } })
    }
    return out
  }, [loops, itemOf, current, lp, prm.dw0, tokens, cases.activeId])

  const psdPlot: Data[] = useMemo(() => {
    const out: Data[] = []
    for (const c of loops) {
      const active = c.id === cases.activeId
      const r = itemOf(c.id)?.result
      if (r && r.psd.f.length > 1) {
        out.push({
          x: Array.from(r.psd.f).slice(1),
          y: Array.from(r.psd.sim).slice(1),
          name: `Welch（Case ${c.id}）`,
          mode: 'lines',
          line: { color: tokens.series[c.idx], width: active ? 1.2 : 0.8 },
          opacity: active ? 1 : 0.6,
        })
      }
      if (!(Math.abs(c.lp.p) < 1) || !Number.isFinite(c.lp.K) || !(Math.abs(c.lp.input.etaR) < 1)) continue
      const n = 400
      const fMin = c.lp.fu / 1e4
      const f = Array.from({ length: n }, (_, i) => fMin * Math.pow(c.lp.fu / 2 / fMin, i / (n - 1)))
      out.push({
        x: f,
        y: f.map((ff) => swOneSided(ff, c.lp.input.mu, c.lp.p, c.lp.sigmaEta2, c.lp.fu, c.lp.input.etaR)),
        name: String.raw`解析 $S_w^{(1)}$（Case ${c.id}）`,
        mode: 'lines',
        line: { dash: 'dash', color: active ? tokens.text : tokens.series[c.idx], width: 1.4 },
      })
    }
    if (Number.isFinite(lp.f3dbExact)) {
      out.push({ x: [lp.f3dbExact, lp.f3dbExact], y: [lp.sw1Dc * 1e-4, lp.sw1Dc * 2], name: String.raw`exact $f_{3\mathrm{dB}}$`, mode: 'lines', line: { dash: 'dot', color: tokens.series[3] } })
    }
    if (Number.isFinite(lp.enbw)) {
      out.push({ x: [lp.enbw, lp.enbw], y: [lp.sw1Dc * 1e-4, lp.sw1Dc * 2], name: 'ENBW', mode: 'lines', line: { dash: 'dashdot', color: tokens.series[4] } })
    }
    return out
  }, [loops, itemOf, lp, tokens, cases.activeId])

  const set = (patch: Partial<NoiseLabParams>) => update(patch)
  // 穩定上限 μ_max：g = μK（sum 模式再乘 N）< 2
  const muMax = 2 / (lp.K * (prm.gmMode === 'sum' ? prm.N : 1))

  return (
    <ExperimentShell
      id={EXP_ID}
      title="LMS Noise Lab：comparator noise → 係數雜訊的 RMS、PSD 與頻寬"
      level="L1"
      claim="exact"
      source="simulation"
      tests={['T13', 'T14']}
      description={
        <>
          三個引擎共用同一組參數：(a) 線性化遞迴、(b) <Tex>{String.raw`x=\pm1`}</Tex> 時精確的 Binomial Block Sign-LMS、(c) 逐 sample 的 <code>runBlockLms</code>（真的產生 code 與 Gaussian{' '}
          <Tex>{'v'}</Tex>）。解析值由 <Tex>{String.raw`\sigma_w^2=\mu^2\sigma_\eta^2/(1-p^2)`}</Tex> 與四種頻寬定義計算。PSD 為 block-rate（取樣率 <Tex>{'f_u'}</Tex>）單邊{' '}
          <Tex>{String.raw`\mathrm{fs}^2/\mathrm{Hz}`}</Tex>。所有 Case 以同一個 seed 一起模擬（paired simulation）。
        </>
      }
      assumptions={[
        String.raw`$\sigma_v$：白色 Gaussian comparator 前雜訊；code：unit-RMS $\pm1$ iid；path：identity $\times\,C$（$C=E[x\,u]$）（勘誤 E30 的 T13 條件）`,
        String.raw`GMAC average-mode（sum-mode 時 $g$ 放大 $N$ 倍，作為反面測試）`,
        String.raw`近平衡：$\sigma_\eta^2\approx1/N$（精確值 $(1-m^2)/N$）；無更新延遲 $d=0$、commit latency $n_c=0$`,
        String.raw`線性化 $K_q=\sqrt{2/\pi}/\sigma_v$ 需 comparator 前的確定性殘差遠小於 $\sigma_v$；本 Lab 的 path 無記憶（$u=Cx$、$x=\pm1$），所以條件是 $|C\,\delta w|\ll\sigma_v$（path 有記憶時要看 $|\delta w|\,u_{\max}$，F-06.19）。引擎 (b)(c) 不做此近似`,
        String.raw`$S_\eta$：預設白色（$r=0$）；$r\ne0$ 為 AR(1) colored $\eta$，只作用於引擎 (a) 與解析值（研究延伸 R1 的最簡模型）`,
        String.raw`$\delta w=w-w^*$（極性與 §0 的 $\delta=a-w$ 相反，E33）；Welch：Hann、nperseg $=\min(512,\text{blocks})$、detrend none（先減 chain 平均）`,
      ]}
      params={{ ...prm, seed, cases: cases.cases.length }}
      seed={seed}
      onSeedChange={cases.setSeed}
      units={{ N: 'samples/block', fs: 'Hz', mu: 'fs', sigmaV: 'fs', C: '—', blocks: 'blocks', chains: '—', dw0: 'fs', etaR: '—' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={crossCheck}
      actions={{
        onRun: doRun,
        onStop: cancel,
        running: task.running,
        onReset: () => reset(NOISE_LAB_DEFAULTS),
      }}
      exportData={() => {
        if (!batch) throw new Error('尚無模擬結果：請先執行 Run')
        const out: Record<string, ArrayLike<number>> = {}
        for (const it of batch.items) {
          const r = it.result
          if (!r) continue
          out[`${it.id}_k`] = r.trace.k
          out[`${it.id}_dw_fs`] = r.trace.dw
          out[`${it.id}_psd_f_hz`] = r.psd.f
          out[`${it.id}_psd_sim_fs2_per_hz`] = r.psd.sim
          out[`${it.id}_psd_analytic_fs2_per_hz`] = r.psd.analytic
          out[`${it.id}_sigma_w_chain_fs`] = r.sigmaWChains
        }
        return out
      }}
      presets={presets}
      onLoadPreset={(p) => update({ ...NOISE_LAB_DEFAULTS, ...(p.params as Partial<NoiseLabParams>) })}
      controls={
        <>
          <CaseSelector cases={cases} label="比較組（learning rate、累加長度、雜訊顏色的取捨）" />
          <div className="ch12-controls-title">GMAC / 迴路</div>
          <ParamControl
            label={<>{md('$N$（每 block 樣本數）')}</>}
            ariaLabel="N（每 block 樣本數）"
            value={prm.N}
            onChange={(N) => set({ N })}
            min={16}
            max={65536}
            log
            integer
            clampOnBlur
            reg="REG_GMAC_N[15:0]"
            hint={md(String.raw`$\sigma_\eta^2\approx1/N$，$f_u=f_s/N$`)}
          />
          <ParamControl label={<>{md('$f_s$（comparator 取樣率）')}</>} ariaLabel="f_s（comparator 取樣率）" value={prm.fs} onChange={(fs) => set({ fs })} min={1e6} max={2e10} log unit="Hz" reg="sample_rate_hz（behavioral）" />
          <ParamControl
            label={<>{md(String.raw`$\mu$（learning rate）`)}</>}
            ariaLabel="μ（learning rate）"
            value={prm.mu}
            onChange={(mu) => set({ mu })}
            min={1e-3}
            max={1000}
            log
            unit="fs"
            reg="REG_GAIN_STEP（gain_step）"
            hint={md(`$g=\\mu K$；$0<g<2$ 才有穩態${Number.isFinite(muMax) && muMax > 0 ? `（目前 $\\mu<${sig(muMax, 4)}$ fs）` : ''}`)}
          />
          <ParamControl
            label={<>{md(String.raw`$\sigma_v$（PD noise RMS）`)}</>}
            ariaLabel="σ_v（PD noise RMS）"
            value={prm.sigmaV}
            onChange={(sigmaV) => set({ sigmaV })}
            min={0}
            max={1000}
            step={1}
            unit="fs"
            reg="pd_noise_rms_fs（behavioral）"
            hint={md(String.raw`$K_q=\sqrt{2/\pi}/\sigma_v$；$0$ ⇒ 硬限幅（反面測試）`)}
          />
          <ParamControl label={<>{md(String.raw`$C=E[x\,u]$`)}</>} ariaLabel="C = E[x·u]" value={prm.C} onChange={(C) => set({ C })} min={-2} max={4} step={0.01} reg="C（behavioral：path × code）" hint={md(String.raw`$C\le0$ ⇒ 極性錯誤`)} />
          <SelectControl
            label="GMAC 輸出"
            value={prm.gmMode}
            onChange={(gmMode) => set({ gmMode })}
            options={[
              { value: 'average', label: 'average（每 block 的相關總和再除以 N）' },
              { value: 'sum', label: 'sum（不除以 N；反面測試）' },
            ]}
            reg="REG_GMAC_MODE"
          />
          <ParamControl
            label={<>{md(String.raw`$S_\eta$ 的顏色 $r$（AR(1) lag-1 相關）`)}</>}
            ariaLabel="S_η 的顏色 r（AR(1) lag-1 相關）"
            value={prm.etaR}
            onChange={(etaR) => set({ etaR })}
            min={-0.99}
            max={0.99}
            step={0.01}
            reg="eta_ar1_r（behavioral：GMAC noise 的 lag-1 相關）"
            hint={md(String.raw`$r=0$：白色（規格假設）；$r\ne0$ 只作用於引擎 (a) 與解析值`)}
          />
          <div className="ch12-controls-group">
            <div className="ch12-controls-title">Monte Carlo</div>
            <SelectControl
              label="模擬引擎"
              value={prm.engine}
              onChange={(engine) => set({ engine })}
              options={(['linear', 'binomial', 'sample'] as NoiseEngine[]).map((e) => ({ value: e, label: ENGINE_LABEL[e] }))}
              reg="engine（behavioral）"
            />
            <ParamControl label="穩態 blocks / chain" value={prm.blocks} onChange={(blocks) => set({ blocks })} min={64} max={200000} log integer clampOnBlur unit="blocks" reg="num_blocks（behavioral）" />
            <ParamControl label="chains" value={prm.chains} onChange={(chains) => set({ chains })} min={1} max={64} integer clampOnBlur reg="Monte Carlo runs" hint={md(String.raw`chains $\ge6$ 時 CI 用 chain 間的 Student-t`)} />
            <ParamControl
              label={<>{md(String.raw`$\delta w_0$（chain 0 初始偏差）`)}</>}
              ariaLabel="δw_0（chain 0 初始偏差）"
              value={prm.dw0}
              onChange={(dw0) => set({ dw0 })}
              min={-100}
              max={100}
              step={0.1}
              unit="fs"
              reg="gain_initial（behavioral；相對 w* 的偏移）"
            />
          </div>
          <p className="ch12-status">
            {task.running
              ? '模擬中…'
              : auto
                ? '參數改變後自動重跑（約 0.35 s debounce；所有 Case 一起跑）'
                : '含 sample-level 引擎或總工作量較大：請按「執行 Run」'}
            {task.lastDurationMs != null && !task.running ? `；上次 ${task.lastDurationMs.toFixed(0)} ms（${task.mode}）` : ''}
            {stale && !task.running ? '；參數已改變，Monte Carlo 結果尚未更新' : ''}
          </p>
        </>
      }
    >
      <div className="ch12-kpis">
        <div className="ch12-kpi">
          <div className="ch12-kpi-label">
            <Tex>{'p'}</Tex>
          </div>
          <div className="ch12-kpi-value">{sigText(lp.p, 6)}</div>
        </div>
        <div className="ch12-kpi">
          <div className="ch12-kpi-label">
            exact <Tex>{String.raw`f_{3\mathrm{dB}}`}</Tex>
          </div>
          <div className="ch12-kpi-value">{Number.isFinite(lp.f3dbExact) ? `${sigText(lp.f3dbExact / 1e3, 5)} kHz` : '不存在'}</div>
        </div>
        <div className="ch12-kpi">
          <div className="ch12-kpi-label">ENBW（積分用）</div>
          <div className="ch12-kpi-value">{Number.isFinite(lp.enbw) ? `${sigText(lp.enbw / 1e3, 5)} kHz` : '—'}</div>
        </div>
        <div className="ch12-kpi">
          <div className="ch12-kpi-label">
            <Tex>{String.raw`\sigma_w`}</Tex> 解析
          </div>
          <div className="ch12-kpi-value">{sigText(lp.sigmaW, 4)} fs</div>
        </div>
        <div className="ch12-kpi">
          <div className="ch12-kpi-label">
            <Tex>{String.raw`\sigma_w`}</Tex> 模擬（Case {cases.activeId}）
          </div>
          <div className="ch12-kpi-value">{current ? `${sigText(current.sigmaW, 4)} fs` : '—'}</div>
        </div>
      </div>
      <Plot
        title="係數偏差的收斂與穩態抖動（各 Case 的 chain 0）"
        csvName="ch12-noise-trace"
        height={280}
        data={tracePlot}
        layout={TRACE_LAYOUT}
        caption={
          current
            ? md(`目前 Case 的引擎：${ENGINE_LABEL[current.engine]}；burn-in 後的 ${prm.blocks} blocks $\\times$ ${prm.chains} chains 用於統計。點線是平均軌跡 $E[\\delta w_k]=\\delta w_0p^k$，虛線是 $\\pm\\sigma_w$。`)
            : '尚無模擬結果。'
        }
      />
      <Plot
        title="係數雜訊 PSD：模擬（Welch）vs 解析"
        csvName="ch12-noise-psd"
        height={320}
        xLog
        yLog
        data={psdPlot}
        layout={PSD_LAYOUT}
        caption={
          current
            ? md(
                `Welch：${current.psd.window}、nperseg = ${current.psd.nperseg} blocks、${current.psd.nSegments} segments（含所有 chains）、window ENBW = ${sigText(current.psd.enbwHz, 4)} Hz、$\\Delta f$ = ${sigText(current.psd.df, 4)} Hz；one-sided；取樣率 $f_u$ = ${sigText(lp.fu, 7)} Hz；單位 $\\mathrm{fs}^2/\\mathrm{Hz}$。虛線為各 Case 的解析曲線。`,
              )
            : md(String.raw`解析曲線：$S_w^{(1)}(f)=\tfrac{2}{f_u}\cdot\mu^2S_\eta/(1-2p\cos(2\pi f/f_u)+p^2)$，one-sided、取樣率 $f_u$。`)
        }
      />
      <div className="table-wrap">
        <table className="ch12-table">
          <thead>
            <tr>
              <th>Case</th>
              <th className="num">
                <Tex>{String.raw`\mu`}</Tex> [fs]
              </th>
              <th className="num">
                <Tex>{'N'}</Tex>
              </th>
              <th className="num">
                <Tex>{'r'}</Tex>
              </th>
              <th className="num">
                <Tex>{'p'}</Tex>
              </th>
              <th className="num">
                <Tex>{String.raw`\tau`}</Tex> [<Tex>{String.raw`\mu\mathrm s`}</Tex>]
              </th>
              <th className="num">
                <Tex>{String.raw`f_{3\mathrm{dB}}`}</Tex> [kHz]
              </th>
              <th className="num">ENBW [kHz]</th>
              <th className="num">
                <Tex>{String.raw`\sigma_w`}</Tex> 解析 [fs]
              </th>
              <th className="num">
                <Tex>{String.raw`\sigma_w`}</Tex> 模擬 [fs]（95% CI）
              </th>
            </tr>
          </thead>
          <tbody>
            {loops.map((c) => {
              const r = itemOf(c.id)?.result ?? null
              const chk = caseCheck(c.lp, r)
              return (
                <tr key={c.id} className={c.id === cases.activeId ? 'ch12-hl' : undefined}>
                  <td>{c.id}</td>
                  <td className="num">{sigText(c.lp.input.mu, 4)}</td>
                  <td className="num">{c.lp.input.N}</td>
                  <td className="num">{c.lp.input.etaR}</td>
                  <td className="num">{sigText(c.lp.p, 6)}</td>
                  <td className="num">{sigText(c.lp.tauSeconds * 1e6, 4)}</td>
                  <td className="num">{Number.isFinite(c.lp.f3dbExact) ? sigText(c.lp.f3dbExact / 1e3, 5) : '—'}</td>
                  <td className="num">{sigText(c.lp.enbw / 1e3, 5)}</td>
                  <td className="num">{sigText(c.lp.sigmaW, 4)}</td>
                  <td className="num" title={stripMathDelimiters(chk.note)}>
                    {r ? `${sigText(r.sigmaW, 4)} [${sigText(r.sigmaWLo, 3)}, ${sigText(r.sigmaWHi, 3)}] ${chk.status === 'ok' ? '✓' : chk.status === 'mismatch' ? '✗' : ''}` : mathText(itemOf(c.id)?.error ?? '—')}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="ch12-try">
        {md(
          String.raw`按「＋ Case」複製目前參數，把 Case B 的 $\mu$ 改成 2.5 fs：$\sigma_w$ 約減半（$\propto\sqrt\mu$），但 $\tau$ 變 4 倍。再把 $\mu$ 拉到 120 fs 看 −3 dB 點消失、160 fs 變 high-pass、260 fs 發散；或把 GMAC 改成 sum 看 $g$ 放大 $N$ 倍。Case C 用引擎 (a) 把 $r$ 設成 0.5：同樣的 $\sigma_\eta^2$，$\sigma_w$ 變成 $\sqrt{(1+pr)/(1-pr)}$ 倍。`,
        )}
      </div>
      <ModeGate min="research">
        <p className="small muted">
          {md(
            String.raw`Research：引擎 (b) 利用 $\sum qx=2\,\mathrm{Bin}(N,\Phi(C(a-w)/\sigma_v))-N$（$x=\pm1$ 時與逐 sample 同分布），以精確 inversion 抽 Binomial；CI 在 chains $\ge6$ 時為 chain 間 Student-t，否則用 AR(1) 有效樣本數 $\operatorname{Var}(s^2)\approx2\sigma^4(1+p^2)/((1-p^2)M)$。$\hat p$ 由 lag-1 自相關估計，所以 $f_{3\mathrm{dB}}$、ENBW 也有模擬版本可交叉比對；colored $\eta$ 時 lag-1 自相關變成 $\rho_1=p+r(1-p^2)/(1+pr)$，不再等於 $p$。`,
          )}
        </p>
      </ModeGate>
    </ExperimentShell>
  )
}
