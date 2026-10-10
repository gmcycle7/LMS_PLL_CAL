import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { Data } from 'plotly.js-dist-min'
import { ExperimentShell, ParamControl, Plot, Tex, useThemeTokens, type ExperimentPreset, type MetricRow } from '@/components'
import { useUrlPreset } from '@/app/presets'
import { binomCdf, mean, variance } from '@/simulation/core'
import { gaussianLyapunov, meanPole, meanSquareFactor } from '@/simulation/models/lms'
import { failureUpperBound, scalarPathStudy, trialsForZeroFailure } from '../judges'
import { Verdict, nf, rich, tx, usePresetList } from '../shared'

export const EVIDENCE_EXPERIMENT_ID = 'signoff-evidence'

export interface EvidenceParams {
  /** 獨立試驗數（seeds × sweep 點） */
  n: number
  /** 觀察到的失效數 */
  kf: number
  /** 信心水準 */
  conf: number
  /** 想宣稱的失效機率上限 */
  pMax: number
  /** 純量 Gaussian LMS 的 μ */
  mu: number
  paths: number
  steps: number
  seed: number
}

export const EVIDENCE_DEFAULT: EvidenceParams = { n: 200, kf: 0, conf: 0.95, pMax: 0.01, mu: 0.8, paths: 200, steps: 200, seed: 20261010 }

/** 路徑研究的計算上限（paths × steps 個 Gaussian 樣本）。 */
export const PATH_BUDGET = 200_000

const PU_LAYOUT = { xaxis: { title: { text: 'n（獨立試驗數）' } }, yaxis: { title: { text: 'p_U' } } }
const HIST_LAYOUT = {
  xaxis: { title: { text: 'log10 |δ_n/δ_0|' } },
  yaxis: { title: { text: '路徑數' } },
  yaxis2: { overlaying: 'y' as const, range: [0, 1], visible: false },
  bargap: 0.02,
}

const LOCAL_PRESETS: ExperimentPreset[] = [
  { name: '「200 seeds 都收斂」：μ = 0.8（均方發散、樣本路徑收斂）', params: { ...EVIDENCE_DEFAULT } },
  { name: 'μ = 0.5：三種穩定都成立', params: { ...EVIDENCE_DEFAULT, mu: 0.5 } },
  { name: 'μ = 2.3：mean 也發散，但 a.s. 仍收斂（很慢）', params: { ...EVIDENCE_DEFAULT, mu: 2.3, steps: 400, paths: 400 } },
  { name: '1000 個 sweep 點，有 2 個失效', params: { ...EVIDENCE_DEFAULT, n: 1000, kf: 2 } },
]

export function EvidenceLabExperiment() {
  const tokens = useThemeTokens()
  const [p, setP] = useState<EvidenceParams>(EVIDENCE_DEFAULT)
  const presets = usePresetList(EVIDENCE_EXPERIMENT_ID, LOCAL_PRESETS)
  const urlPreset = useUrlPreset(EVIDENCE_EXPERIMENT_ID)
  useEffect(() => {
    if (urlPreset) setP({ ...EVIDENCE_DEFAULT, ...(urlPreset.params as Partial<EvidenceParams>) })
  }, [urlPreset])
  const set = <K extends keyof EvidenceParams>(k: K, v: EvidenceParams[K]) => setP((s) => ({ ...s, [k]: v }))
  const dp = useDeferredValue(p)

  const kf = Math.min(Math.round(dp.kf), Math.round(dp.n))
  const pU = failureUpperBound(kf, Math.round(dp.n), dp.conf)
  const nNeed = trialsForZeroFailure(dp.pMax, dp.conf)
  const steps = Math.max(1, Math.min(Math.round(dp.steps), Math.floor(PATH_BUDGET / Math.max(1, Math.round(dp.paths)))))
  const study = useMemo(() => scalarPathStudy(dp.mu, Math.round(dp.paths), steps, dp.seed), [dp.mu, dp.paths, steps, dp.seed])
  const lyap = useMemo(() => gaussianLyapunov(dp.mu), [dp.mu])
  const g2 = meanSquareFactor(dp.mu, 1, 3)
  const pMean = meanPole(dp.mu, 1)
  // Analytic 交叉比對（真的算）：把 p_U 代回二項分布，P(X ≤ k_f | n, p_U) 必須等於 α（k_f = 0 時就是 (1 − p_U)^n = α）
  const nTrials = Math.round(dp.n)
  const alpha = 1 - dp.conf
  const analyticOk = kf >= nTrials ? pU === 1 : Math.abs(binomCdf(kf, nTrials, pU) - alpha) <= 1e-6 * alpha + 1e-12
  // Monte Carlo 交叉比對（真的算）：E[ln|δ_n/δ_0|] = n·λ(μ) 是精確式，所以各路徑 ln|δ_n/δ_0| 的樣本平均應落在 nλ ± 4 se 內
  //（λ 來自 lms.ts 的數值積分，與這裡的路徑模擬互相獨立）。「樣本平均 δ²」與理論的落差是 heavy tail 的預期行為，不列入判定。
  const mcCheck = useMemo(() => {
    const L = Array.from(study.log10Abs, (v) => v * Math.LN10)
    const se = L.length > 1 ? Math.sqrt(variance(L) / L.length) : NaN
    const diff = mean(L) - steps * lyap
    return { diff, se, ok: Math.abs(diff) <= 4 * se }
  }, [study, steps, lyap])

  const warnings: string[] = []
  if (steps < Math.round(dp.steps)) warnings.push(`計算上限：樣本路徑數 × 步數 $\\le${PATH_BUDGET}$，步數由 ${Math.round(dp.steps)} 降為 ${steps}。`)
  if (kf > 0) warnings.push(`觀察到 ${kf} 次失效：不能寫「未觀察到失效」；只能報告失效率上界 $p_U=${tx(pU, 4)}$（信心 ${nf(100 * dp.conf, 4)}%），並逐一分析失效條件。`)
  if (g2 >= 1 && study.fracConverged > 0.5)
    warnings.push(`$g_2(\\mu)=${tx(g2, 4)}\\ge1$：$E[\\delta_n^2]$ 發散（mean-square unstable），但 ${nf(100 * study.fracConverged, 3)}% 的樣本路徑看起來收斂——有限 seeds 的「都收斂」不能拿來宣稱均方穩定（勘誤 E14）。`)
  if (lyap > 0 && study.fracConverged > 0) warnings.push(`$\\lambda(\\mu)=${tx(lyap, 4)}>0$：樣本路徑幾乎必然發散，但在 ${steps} 步內仍有 ${nf(100 * study.fracConverged, 3)}% 看起來很小——有限長度的模擬也會在另一個方向誤導。`)

  const curve: Data[] = useMemo(() => {
    const ns = Array.from({ length: 61 }, (_, i) => Math.round(10 ** (1 + (i * 4) / 60)))
    return [0, 1, 2].map((k) => ({
      x: ns,
      y: ns.map((n) => (n > k ? failureUpperBound(k, n, dp.conf) : NaN)),
      mode: 'lines',
      name: `k_f = ${k}`,
      line: { color: tokens.series[k] },
    }))
  }, [dp.conf, tokens])
  const curveWithMarker: Data[] = useMemo(
    () => [...curve, { x: [Math.round(dp.n)], y: [pU], mode: 'markers', name: '目前 (n, k_f)', marker: { size: 11, symbol: 'diamond', color: tokens.series[3] } }],
    [curve, dp.n, pU, tokens],
  )

  const hist: Data[] = useMemo(
    () => [
      { x: Array.from(study.log10Abs), type: 'histogram', nbinsx: 40, name: 'log10|δ_n/δ_0|（各路徑）', marker: { color: tokens.series[0] } },
      { x: [study.log10MedianAbs, study.log10MedianAbs], y: [0, 1], yaxis: 'y2', mode: 'lines', name: '中位數', line: { color: tokens.series[2], width: 2 } },
      { x: [0.5 * study.log10TheoryMsd, 0.5 * study.log10TheoryMsd], y: [0, 1], yaxis: 'y2', mode: 'lines', name: '理論 log10 √E[δ²]/δ₀', line: { color: tokens.series[1], width: 2, dash: 'dash' } },
      { x: [0.5 * study.log10SampleMsd, 0.5 * study.log10SampleMsd], y: [0, 1], yaxis: 'y2', mode: 'lines', name: '樣本 log10 √mean(δ²)/δ₀', line: { color: tokens.series[3], width: 2, dash: 'dot' } },
    ],
    [study, tokens],
  )

  const metrics: MetricRow[] = [
    { name: `失效率上界 $p_U$（$n=${Math.round(dp.n)}$、$k_f=${kf}$）`, value: pU, formulaId: 'F-SO.8', claim: 'exact', note: String.raw`Clopper–Pearson 單邊；$k_f=0$ 時 $p_U=1-\alpha^{1/n}$` },
    { name: `0 失效要宣稱 $p\\le${tx(dp.pMax, 6)}$ 所需 $n$`, value: nNeed, formulaId: 'F-SO.8', claim: 'exact' },
    { name: String.raw`mean pole $1-\mu P_x$`, value: pMean, claim: 'exact', formulaId: 'F-SO.9' },
    { name: String.raw`$g_2(\mu)=1-2\mu+3\mu^2$`, value: g2, claim: 'exact', formulaId: 'F-SO.9' },
    { name: String.raw`Lyapunov 指數 $\lambda(\mu)=E[\log|1-\mu x^2|]$`, value: lyap, claim: 'exact', formulaId: 'F-SO.9', note: '數值積分（lms.ts gaussianLyapunov）' },
    { name: `樣本路徑 $|\\delta_n|<10^{-3}|\\delta_0|$ 的比例（${Math.round(dp.paths)} 條、${steps} 步）`, value: study.fracConverged, claim: 'approx' },
    { name: String.raw`$\log_{10}$ 樣本平均 $\delta_n^2/\delta_0^2$`, value: study.log10SampleMsd, analytic: study.log10TheoryMsd, note: String.raw`解析欄為 $n\log_{10}g_2(\mu)$；heavy tail 讓樣本平均通常遠低於理論值` },
  ]

  const kind = (ok: boolean) => (ok ? 'ok' : 'bad') as 'ok' | 'bad'
  return (
    <ExperimentShell
      id={EVIDENCE_EXPERIMENT_ID}
      title="證據強度：0 次失效能推出什麼？「都收斂」等於均方穩定嗎？"
      level="L0"
      claim="exact"
      source="simulation"
      tests={['T03']}
      description={
        <>
          左半：把 sweep／seeds 的結果換算成失效機率上界（Clopper–Pearson）。右半：純量 iid Gaussian regressor 的 LMS <Tex>{'\\delta_{n+1}=(1-\\mu x_n^2)\\delta_n'}</Tex>，
          比較三種穩定的解析判準與有限樣本路徑的「觀察」。
        </>
      }
      assumptions={[
        '試驗互相獨立、且與 sign-off 想涵蓋的條件同分布（否則 $p_U$ 不適用）',
        '失效判準在試驗前固定（不能事後調整門檻）',
        String.raw`路徑研究：$x_n\sim\mathcal N(0,1)$ iid、無外加雜訊、$\delta_0=1$；以 $\log|\delta_n|$ 累加避免溢位`,
        String.raw`$g_2(\mu)$ 與 $\lambda(\mu)$ 為 iid 純量模型的精確式（E38）；$\lambda$ 以數值積分求得`,
      ]}
      params={{ ...p }}
      seed={p.seed}
      onSeedChange={(s) => set('seed', s)}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: { status: analyticOk ? 'ok' : 'mismatch', note: analyticOk ? String.raw`把 $p_U$ 代回二項分布：$P(X\le k_f\mid n,p_U)=\alpha$` : String.raw`$P(X\le k_f\mid n,p_U)\ne\alpha$：$p_U$ 的求解沒有收斂` },
        monteCarlo: {
          status: mcCheck.ok ? 'ok' : 'mismatch',
          note: `各路徑 $\\ln|\\delta_n/\\delta_0|$ 的樣本平均與 $n\\lambda(\\mu)$ 相差 $${tx(mcCheck.diff, 3)}$（容許 $\\pm4\\,\\mathrm{se}=${tx(4 * mcCheck.se, 3)}$）；「樣本平均 $\\delta_n^2$」低於理論是 heavy tail 的預期行為，不列入判定`,
        },
        fixedPoint: 'n/a',
      }}
      actions={{ onReset: () => setP(EVIDENCE_DEFAULT) }}
      exportData={() => ({ path_log10_abs_delta: study.log10Abs })}
      presets={presets}
      onLoadPreset={(pr) => setP({ ...EVIDENCE_DEFAULT, ...(pr.params as Partial<EvidenceParams>) })}
      controls={
        <>
          <ParamControl label={rich('$n$（獨立試驗數：seeds × sweep 點）')} ariaLabel="n（獨立試驗數：seeds × sweep 點）" value={p.n} onChange={(v) => set('n', v)} min={1} max={1_000_000} log integer reg="behav: mc_runs" />
          <ParamControl label={rich('$k_f$（觀察到的失效數）')} ariaLabel="k_f（觀察到的失效數）" value={p.kf} onChange={(v) => set('kf', v)} min={0} max={1000} integer clampOnBlur reg="behav: failures" />
          <ParamControl label={rich(String.raw`信心水準 $1-\alpha$`)} ariaLabel="信心水準 1 − α" value={p.conf} onChange={(v) => set('conf', v)} min={0.5} max={0.9999} step={0.0001} reg="behav: confidence" />
          <ParamControl label={rich(String.raw`想宣稱的失效率上限 $p_\text{max}$`)} ariaLabel="想宣稱的失效率上限 p_max" value={p.pMax} onChange={(v) => set('pMax', v)} min={1e-6} max={0.5} log reg="behav: p_fail_target" />
          <hr />
          <ParamControl label={rich(String.raw`$\mu$（純量 Gaussian LMS）`)} ariaLabel="μ（純量 Gaussian LMS）" value={p.mu} onChange={(v) => set('mu', v)} min={0.01} max={3} step={0.01} reg="behav: mu" hint={rich(String.raw`mean 界 $2$、MS 界 $2/3$、a.s. 界 $\approx2.42$`)} />
          <ParamControl label="樣本路徑數" value={p.paths} onChange={(v) => set('paths', v)} min={10} max={2000} integer clampOnBlur reg="behav: paths" />
          <ParamControl label="步數（每條路徑）" value={p.steps} onChange={(v) => set('steps', v)} min={10} max={1000} integer clampOnBlur reg="behav: steps" />
        </>
      }
    >
      <div className="so-kv">
        <div>
          <div className="k">
            平均收斂 <Tex>{'|1-\\mu P_x|<1'}</Tex>
          </div>
          <div className="v">
            <Verdict kind={kind(Math.abs(pMean) < 1)}>{Math.abs(pMean) < 1 ? '成立' : '不成立'}</Verdict>
          </div>
        </div>
        <div>
          <div className="k">
            均方穩定 <Tex>{'g_2(\\mu)<1'}</Tex>
          </div>
          <div className="v">
            <Verdict kind={kind(g2 < 1)}>{g2 < 1 ? '成立' : '不成立'}</Verdict>
          </div>
        </div>
        <div>
          <div className="k">
            幾乎必然收斂 <Tex>{'\\lambda(\\mu)<0'}</Tex>
          </div>
          <div className="v">
            <Verdict kind={kind(lyap < 0)}>{lyap < 0 ? '成立' : '不成立'}</Verdict>
          </div>
        </div>
        <div>
          <div className="k">MC 觀察：路徑收斂比例</div>
          <div className="v">{nf(100 * study.fracConverged, 4)}%</div>
        </div>
      </div>
      <Plot
        title="0 次（或 $k_f$ 次）失效時，失效機率的單邊上界 $p_U$ vs 試驗數 $n$"
        data={curveWithMarker}
        xLog
        yLog
        layout={PU_LAYOUT}
        height={300}
        csvName="signoff-evidence-pu"
      />
      <Plot
        title={`樣本路徑終值 $\\log_{10}|\\delta_n/\\delta_0|$ 的分布（$\\mu=${tx(dp.mu, 4)}$、$n=${steps}$）：中位數 vs 理論 $\\sqrt{E[\\delta_n^2]}$`}
        data={hist}
        layout={HIST_LAYOUT}
        height={300}
        csvName="signoff-evidence-paths"
      />
    </ExperimentShell>
  )
}
