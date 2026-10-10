import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { Data } from 'plotly.js-dist-min'
import { ExperimentShell, ParamControl, Plot, Tex, useThemeTokens, type ExperimentPreset, type MetricRow } from '@/components'
import { useUrlPreset } from '@/app/presets'
import { CORNER_SCAN_POINTS, cornerFeasibleScan, cornerJudge, gCrit, kq, pmNumeric, type CornerSpec } from '../judges'
import { Verdict, nf, plainText, rich, tx, usePresetList, withAlpha } from '../shared'

export const CORNER_EXPERIMENT_ID = 'signoff-corner-judge'

export interface CornerJudgeParams {
  corners: CornerSpec[]
  mu: number
  d: number
  pmTargetDeg: number
  B: number
  N: number
  sigmaWMax: number
}

export const CORNER_JUDGE_DEFAULT: CornerJudgeParams = {
  corners: [
    { name: 'TT 25°C', sigmaV: 100, thetaDeg: 0 },
    { name: 'SS −40°C', sigmaV: 140, thetaDeg: 25 },
    { name: 'FF 125°C', sigmaV: 70, thetaDeg: 10 },
    { name: 'near-grid FCW', sigmaV: 100, thetaDeg: 60 },
  ],
  mu: 10,
  d: 1,
  pmTargetDeg: 60,
  B: 120,
  N: 4096,
  sigmaWMax: 1,
}

const LOCAL_PRESETS: ExperimentPreset[] = [
  { name: '四個 corner、d = 1（預設）', params: { ...CORNER_JUDGE_DEFAULT } },
  { name: '某個 corner 有效相位超過 90°：沒有任何 μ 可行', params: { ...CORNER_JUDGE_DEFAULT, corners: [...CORNER_JUDGE_DEFAULT.corners.slice(0, 3), { name: 'low-BW mode', sigmaV: 100, thetaDeg: 100 }] } },
  { name: 'commit latency d = 3：上限變嚴', params: { ...CORNER_JUDGE_DEFAULT, d: 3, mu: 30 } },
  { name: 'B 太小：區間為空', params: { ...CORNER_JUDGE_DEFAULT, B: 20 } },
]

const MAX_CORNERS = 6

function isCornerParams(v: unknown): v is Partial<CornerJudgeParams> {
  return typeof v === 'object' && v !== null
}

export function CornerJudgeExperiment() {
  const tokens = useThemeTokens()
  const [p, setP] = useState<CornerJudgeParams>(CORNER_JUDGE_DEFAULT)
  const presets = usePresetList(CORNER_EXPERIMENT_ID, LOCAL_PRESETS)
  const urlPreset = useUrlPreset(CORNER_EXPERIMENT_ID)
  useEffect(() => {
    if (urlPreset && isCornerParams(urlPreset.params)) setP({ ...CORNER_JUDGE_DEFAULT, ...urlPreset.params })
  }, [urlPreset])
  const set = <K extends keyof CornerJudgeParams>(k: K, v: CornerJudgeParams[K]) => setP((s) => ({ ...s, [k]: v }))
  const setCorner = (i: number, patch: Partial<CornerSpec>) => setP((s) => ({ ...s, corners: s.corners.map((c, j) => (j === i ? { ...c, ...patch } : c)) }))
  const dp = useDeferredValue(p)
  const opts = useMemo(
    () => ({ d: Math.round(dp.d), pmTargetDeg: dp.pmTargetDeg, B: Math.round(dp.B), N: Math.round(dp.N), sigmaWMax: dp.sigmaWMax }),
    [dp.d, dp.pmTargetDeg, dp.B, dp.N, dp.sigmaWMax],
  )
  const rows = useMemo(() => cornerJudge(dp.corners, { mu: dp.mu, ...opts }), [dp.corners, dp.mu, opts])
  // 目前的 μ 併入掃描格點：它通過所有 corner 時，掃描不會因為格點間距而回報「沒有可行點」
  const scan = useMemo(() => cornerFeasibleScan(dp.corners, opts, undefined, [dp.mu]), [dp.corners, opts, dp.mu])
  const allOk = rows.every((r) => Object.values(r.ok).every(Boolean))
  // Analytic 交叉比對（真的算）：(1) 封閉式 PM_d 與「二分法找 crossover、直接算 L(e^{jω_c}) 相位」的數值解相符（相位以 360° 為週期比較）；
  // (2) 求根得到的 ρ < 1 與封閉式 g < g_crit(d) 的判定一致（剛好在臨界點上、浮點無法分辨時不比）。
  const analyticOk = rows.every((r) => {
    const dPm = Number.isFinite(r.pm) ? ((((r.pm - pmNumeric(r.g, opts.d) + 180) % 360) + 360) % 360) - 180 : 0
    const gc = gCrit(opts.d)
    const onEdge = Math.abs(r.g - gc) <= 1e-9 * gc
    return Math.abs(dPm) < 1e-6 && (r.g <= 0 || onEdge || (r.rho < 1) === (r.g < gc))
  })

  const warnings: string[] = []
  for (const r of rows) {
    const name = plainText(r.name)
    if (!r.ok.polarity)
      warnings.push(
        `C ≤ 0：「${name}」的 $K=K_q\\cos\\theta=${tx(r.K, 4)}\\,\\mathrm{fs}^{-1}\\le0$——這個 corner 更新極性錯誤，任何正 $\\mu$ 都會讓平均誤差發散；不是調 $\\mu$ 能解決的（改 code delay $D$、filtered-x，或在此 corner freeze）。`,
      )
    else if (!r.ok.stable)
      warnings.push(`「${name}」$g=\\mu K=${tx(r.g, 4)}\\ge g_\\text{crit}(d=${opts.d})=${tx(gCrit(opts.d), 4)}$：更新延遲讓迴路不穩定（spectral radius $\\rho=${tx(r.rho, 4)}\\ge1$）。`)
  }
  if (Number.isNaN(scan.lo))
    warnings.push(
      String.raw`在掃描範圍內沒有任何 $\mu$ 能讓所有 corner 同時滿足（極性、穩定、PM、$B$ 次內收斂、$\sigma_w$）：需要降低 $K$ 的散佈（每個 corner 量 $\hat K_c$ 後用 $\mu_c=g/\hat K_c$）、延長 $B$、放寬 PM 或 $\sigma_w$ 預算。`,
    )

  const scanPlot: Data[] = useMemo(() => {
    const out: Data[] = scan.rho.map((r, c) => ({
      x: scan.mu,
      y: r.map((v) => (Number.isFinite(v) && v < 3 ? v : null)),
      mode: 'lines',
      name: `${dp.corners[c].name}：ρ(μ)`,
      line: { color: tokens.series[c % tokens.series.length] },
    }))
    out.push({ x: [scan.mu[0], scan.mu[scan.mu.length - 1]], y: [Math.pow(0.05, 1 / opts.B), Math.pow(0.05, 1 / opts.B)], mode: 'lines', name: `ρ = 0.05^{1/B}（B = ${opts.B} 內衰減 95%）`, line: { color: tokens.textMuted, dash: 'dash' } })
    out.push({ x: [scan.mu[0], scan.mu[scan.mu.length - 1]], y: [1, 1], mode: 'lines', name: 'ρ = 1（穩定邊界）', line: { color: tokens.text, dash: 'dot' } })
    out.push({ x: [dp.mu, dp.mu], y: [0, 1.6], mode: 'lines', name: `目前 μ = ${nf(dp.mu, 4)} fs`, line: { color: tokens.series[4], width: 2 } })
    return out
  }, [scan, dp.corners, dp.mu, tokens, opts.B])

  const scanLayout = useMemo(
    () => ({
      xaxis: { title: { text: 'μ [fs]' } },
      yaxis: { title: { text: 'ρ' }, range: [0, 1.6] },
      shapes: Number.isNaN(scan.lo) ? [] : [{ type: 'rect' as const, xref: 'x' as const, yref: 'paper' as const, x0: scan.lo, x1: scan.hi, y0: 0, y1: 1, fillcolor: withAlpha(tokens.series[2], 0.15), line: { width: 0 } }],
    }),
    [scan.lo, scan.hi, tokens],
  )

  const metrics: MetricRow[] = [
    { name: `$g_\\text{crit}(d=${opts.d})$`, value: gCrit(opts.d), formulaId: 'F-SO.5', claim: 'exact' },
    { name: String.raw`可行 $\mu$ 下限（格點）`, value: Number.isNaN(scan.lo) ? '無可行點' : scan.lo, unit: 'fs', claim: 'exact', note: `${CORNER_SCAN_POINTS} 點對數格點（外加目前的 $\\mu$），非封閉式；比格點間距更窄的可行區間可能被漏掉` },
    { name: String.raw`可行 $\mu$ 上限（格點）`, value: Number.isNaN(scan.hi) ? '無可行點' : scan.hi, unit: 'fs', claim: 'exact' },
    ...rows.map((r) => ({ name: `${plainText(r.name)}：$PM_d$`, value: r.pm, unit: '°', formulaId: 'F-SO.5', claim: 'exact' as const })),
  ]

  return (
    <ExperimentShell
      id={CORNER_EXPERIMENT_ID}
      title={String.raw`Corner 判斷器：同一組 $(\mu,d)$ 必須通過所有 corner`}
      level="L1"
      claim="exact"
      source="illustrative"
      tests={['T08']}
      description={
        <>
          每個 corner 給 <Tex>{'\\sigma_v'}</Tex> 與有效相位 <Tex>{'\\theta'}</Tex>（<Tex>{'C=\\cos\\theta'}</Tex>，<Tex>{'|H|=1'}</Tex>），計算 <Tex>{'K_c'}</Tex>、<Tex>{'g_c'}</Tex>、
          <Tex>{'z^{d+1}-z^d+g_c=0'}</Tex> 的 spectral radius、PM、95% 收斂 block 數與 <Tex>{'\\sigma_w'}</Tex>。下圖掃描 <Tex>{'\\mu'}</Tex>，標出所有 corner 同時合格的區間。
        </>
      }
      assumptions={[
        String.raw`一階線性化模型（小誤差、Gaussian comparator）；$K_c=K_q(\sigma_{v,c})\cos\theta_c$`,
        String.raw`更新延遲 $d$ 個 block：$\delta_{k+1}=\delta_k-g\,\delta_{k-d}+\mu\eta_k$`,
        String.raw`$\sigma_\eta^2\approx1/N$（$\pm1$ code、近平衡、block 間獨立）；$\sigma_w^2=\mu^2\sigma_\eta^2\sum_kh_k^2$（$\sum_kh_k^2$ 以 Yule–Walker 方程組精確求解）`,
        String.raw`95% 收斂：$k_{95}=\max\big(1,\lceil\ln0.05/\ln\rho\rceil\big)\le B$（以 spectral radius 的包絡估計；$d\ge1$ 時是近似）；$PM_d=90^\circ-(2d+1)\arcsin(g/2)$`,
        String.raw`數值皆為 illustrative；實際 corner 請用 freeze $\pm\Delta$ 量測的 $\hat K$（保守取 $\hat K\mp z\,\mathrm{se}$）`,
      ]}
      params={{ mu: p.mu, d: p.d, pmTargetDeg: p.pmTargetDeg, B: p.B, N: p.N, sigmaWMax: p.sigmaWMax, corners: p.corners.map((c) => `${c.name}:${c.sigmaV}fs/${c.thetaDeg}deg`).join('; ') }}
      units={{ mu: 'fs', pmTargetDeg: 'deg', sigmaWMax: 'fs' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: {
          status: analyticOk ? 'ok' : 'mismatch',
          note: analyticOk ? String.raw`封閉式 $PM_d$ 與數值 crossover 相符；求根的 $\rho<1$ 與 $g<g_\text{crit}(d)$ 判定一致` : String.raw`封閉式 $PM_d$／$g_\text{crit}(d)$ 與數值解不一致`,
        },
        monteCarlo: 'not-implemented',
        fixedPoint: 'not-implemented',
      }}
      actions={{ onReset: () => setP(CORNER_JUDGE_DEFAULT) }}
      exportData={() => ({ mu_fs: scan.mu, all_corners_ok: scan.ok.map((v) => (v ? 1 : 0)), ...Object.fromEntries(scan.rho.map((r, c) => [`rho_${dp.corners[c].name}`, r])) })}
      presets={presets}
      onLoadPreset={(pr) => setP({ ...CORNER_JUDGE_DEFAULT, ...(pr.params as Partial<CornerJudgeParams>) })}
      controls={
        <>
          <ParamControl label={rich(String.raw`$\mu$（learning rate）`)} ariaLabel="μ（learning rate）" value={p.mu} onChange={(v) => set('mu', v)} min={0.01} max={1000} log unit="fs" reg="REG_CAL_MU" />
          <ParamControl label={rich('$d$（commit／更新延遲）')} ariaLabel="d（commit／更新延遲）" value={p.d} onChange={(v) => set('d', v)} min={0} max={6} integer clampOnBlur unit="blocks" reg="RTL: commit latency" />
          <ParamControl label={rich('PM 下限 $PM_t$')} ariaLabel="PM 下限 PM_t" value={p.pmTargetDeg} onChange={(v) => set('pmTargetDeg', v)} min={0} max={89} step={1} unit="deg" reg="behav: pm_target" />
          <ParamControl label={rich('$B$（允許的更新次數）')} ariaLabel="B（允許的更新次數）" value={p.B} onChange={(v) => set('B', v)} min={1} max={100000} log integer reg="behav: cal_budget_blocks" />
          <ParamControl label={rich('$N$（每 block 樣本數）')} ariaLabel="N（每 block 樣本數）" value={p.N} onChange={(v) => set('N', v)} min={16} max={65536} log integer reg="REG_GMAC_N[15:0]" />
          <ParamControl label={rich(String.raw`$\sigma_w$ 預算`)} ariaLabel="σ_w 預算" value={p.sigmaWMax} onChange={(v) => set('sigmaWMax', v)} min={0.001} max={100} log unit="fs" reg="spec: sigma_w_max" />
          <div className="small muted">
            Corners（最多 {MAX_CORNERS} 個）：名稱、<Tex>{'\\sigma_v'}</Tex>、有效相位 <Tex>{'\\theta'}</Tex>
          </div>
          {p.corners.map((c, i) => (
            <div className="so-corner-row" key={i}>
              <label className="small">
                名稱
                <input type="text" value={c.name} onChange={(e) => setCorner(i, { name: e.target.value })} aria-label={`corner ${i + 1} 名稱`} />
              </label>
              <ParamControl label={<Tex>{'\\sigma_v'}</Tex>} ariaLabel={`corner ${i + 1} 的 σ_v`} value={c.sigmaV} onChange={(v) => setCorner(i, { sigmaV: v })} min={1} max={1000} log unit="fs" reg="behav: sigma_v" />
              <ParamControl label={<Tex>{'\\theta'}</Tex>} ariaLabel={`corner ${i + 1} 的有效相位 θ`} value={c.thetaDeg} onChange={(v) => setCorner(i, { thetaDeg: v })} min={-180} max={180} step={1} unit="deg" reg="behav: phase" />
            </div>
          ))}
          <div className="so-toolbar">
            <button type="button" className="btn" disabled={p.corners.length >= MAX_CORNERS} onClick={() => set('corners', [...p.corners, { name: `corner ${p.corners.length + 1}`, sigmaV: 100, thetaDeg: 0 }])}>
              ＋ corner
            </button>
            <button type="button" className="btn" disabled={p.corners.length <= 1} onClick={() => set('corners', p.corners.slice(0, -1))}>
              − 最後一個
            </button>
          </div>
        </>
      }
    >
      <p>
        總判定：
        {allOk ? (
          <Verdict kind="ok">
            <Tex>{`\\mu=${tx(dp.mu, 4)}\\,\\mathrm{fs}`}</Tex> 通過所有 corner
          </Verdict>
        ) : (
          <Verdict kind="bad">至少一個 corner 不合格</Verdict>
        )}{' '}
        <span className="small muted">
          <Tex>{`K_q(\\sigma_v=100\\,\\mathrm{fs})=${tx(kq(100), 5)}\\,\\mathrm{fs}^{-1}`}</Tex>；可行區間{' '}
          {Number.isNaN(scan.lo) ? '（無）' : <Tex>{`${tx(scan.lo, 4)}\\le\\mu\\le${tx(scan.hi, 4)}\\,\\mathrm{fs}`}</Tex>}
        </span>
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Corner</th>
              <th className="num">
                <Tex>{'K\\ [\\mathrm{fs}^{-1}]'}</Tex>
              </th>
              <th className="num">
                <Tex>{'g=\\mu K'}</Tex>
              </th>
              <th className="num">
                <Tex>{'\\rho'}</Tex>
              </th>
              <th className="num">
                <Tex>{'PM_d\\ [^\\circ]'}</Tex>
              </th>
              <th className="num">
                <Tex>{'k_{95}'}</Tex>
              </th>
              <th className="num">
                <Tex>{'\\sigma_w\\ [\\mathrm{fs}]'}</Tex>
              </th>
              <th>判定</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const fails = (Object.entries(r.ok) as [keyof typeof r.ok, boolean][]).filter(([, v]) => !v).map(([k]) => ({ polarity: '極性', stable: '穩定', pm: 'PM', settle: '收斂', noise: '雜訊' })[k])
              return (
                <tr key={i}>
                  <td>{r.name}</td>
                  <td className="num">{nf(r.K, 4)}</td>
                  <td className="num">{nf(r.g, 4)}</td>
                  <td className="num">{nf(r.rho, 5)}</td>
                  <td className="num">{nf(r.pm, 4)}</td>
                  <td className="num">{nf(r.settle95, 5)}</td>
                  <td className="num">{nf(r.sigmaW, 4)}</td>
                  <td>{fails.length === 0 ? <Verdict kind="ok">通過</Verdict> : <Verdict kind="bad">{fails.join('、')}</Verdict>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Plot
        title={String.raw`每個 corner 的 spectral radius $\rho(\mu)$；色帶：所有 corner 同時合格的 $\mu$`}
        data={scanPlot}
        xLog
        layout={scanLayout}
        height={320}
        csvName="signoff-corner-scan"
      />
    </ExperimentShell>
  )
}
