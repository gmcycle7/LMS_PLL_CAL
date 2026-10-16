import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Data } from 'plotly.js-dist-min'
import {
  Callout,
  CaseSelector,
  ClaimTag,
  CodeBlock,
  CodeCompare,
  ExperimentShell,
  ModeGate,
  Plot,
  Tex,
  useThemeTokens,
  type CaseId,
  type MetricRow,
  type UseCasesResult,
  ChRef,
} from '@/components'
import { presetsForExperiment, useUrlPreset } from '@/app/presets'
import modelSrc from '../thesisModel.ts?raw'
import { SIX_CONDITIONS } from '../data'
import { EXPERIMENT_ID, THESIS_PRESETS, builtinPreset, presetParams, sanitizeParams } from '../presets'
import { DEFAULT_PARAMS, blocksTo95, evaluateThesis, settleDelayed, suggestHorizon, trajectory, weakStrongModes, type ThesisParams, type ThesisResult } from '../thesisModel'
import { MC_GAIN_TRUE_FS } from '../mcBridge'
import { Rich, StateIcon, plainTip, withAlpha } from '../ui'
import { ThesisControls } from './Controls'
import { MonteCarloPanel, useMonteCarloCheck, type McOutcome } from './MonteCarloCheck'

export interface EvaluatedCase {
  id: CaseId
  seriesIndex: number
  result: ThesisResult
}

const MODEL_PATH = 'src/pages/dashboard/thesisModel.ts'
/** eigen-mode 表下方「弱 / 強方向」那一句的括號：哪一個 mode 是弱方向取決於 ρ 的正負號 */
const WEAK_IS = String.raw`弱方向是 $\tilde\lambda_i$ 較小的 mode：$\rho$ 為正時是 $(1,\,-1)/\sqrt2$，為負時是 $(1,\,1)/\sqrt2$`
const f = (x: number, d = 4) => (Number.isFinite(x) ? Number(x.toPrecision(d)).toString() : Number.isNaN(x) ? '—' : x > 0 ? '∞' : '−∞')
/** MetricTable 用：NaN → null（顯示「—」），±∞ → 字串 */
const mv = (x: number): number | string | null => (Number.isFinite(x) ? x : Number.isNaN(x) ? null : x > 0 ? '∞' : '−∞')

/** 假設清單（ExperimentShell 以 mathText 顯示：`$…$` 內為 TeX） */
const ASSUMPTIONS = [
  String.raw`局部線性化：$E[q\mid e_{\mathrm{det}}]\approx K_q\,e_{\mathrm{det}}$，需要 deterministic residual 遠小於 $\sigma_v$（大誤差時 comparator 飽和）`,
  String.raw`時間尺度分離：係數 $w$ 在 PLL error path 的記憶長度內近似常數，誤差才能寫成 $(a-w_k)\,u[n]$、$u=h*x$（Ch06 的 F-06.1；$w$ 變得快時要回到 $h*((a-w)\,x)$）`,
  String.raw`單頻 code $x=A\cos\Omega n$，$P_x=A^2/2$；$C=P_x|H|\cos(\phi+\Omega D)$（多頻 code 要用 $E[x\,(h*x)]$ 整體計算）`,
  String.raw`近平衡、$q$ 近似 iid $\pm1$：$\sigma_\eta^2\approx P_x/N$（勘誤 E30：精確為 $(1-m^2)P_x/N$）；GMAC 雜訊在 block 之間獨立（white）`,
  String.raw`每個 GMAC block 涵蓋許多個 code 週期（$\Omega N\gg2\pi$）：block 內的平均 $\approx$ 長期平均`,
  String.raw`雙參數：$\tilde{\mathbf R}=\begin{bmatrix}1&\rho\\\rho&1\end{bmatrix}$，$\rho$ 是零延遲的相關係數（$E[x_1x_2]=\rho P_x$）。本模型另外假設交叉相關也以同一個 $C$ 縮放：$E[x_i[n-D]\,u_j[n]]=C\,\tilde R_{ij}$（簡化模型）。「兩個 regressor 經過同一條 path」保證不了這一點：它在 $\theta=\phi+\Omega D=0^\circ$ 時成立；$\theta\ne0^\circ$ 時的充分條件是每一個延遲 $m$ 的交叉相關都是自相關的 $\rho$ 倍，$E[x_1[n]\,x_2[n+m]]=\rho\,E[x_1[n]\,x_1[n+m]]$，兩個固定的同頻單頻 code（$|\rho|<1$）做不到。這時體檢會加註，並列出這種 code 的 $\max|z|$ 作對照（F-DB.6）；完整的 Jacobian 見 Ch10`,
  String.raw`$\varepsilon_{\mathrm{det}}$ 的 code 相關部分沿 $x_1$ 方向（$E[x_2\varepsilon_{\mathrm{det}}]=\rho B$）`,
  String.raw`preconditioner $\mathbf M=\mu\tilde{\mathbf R}^{-1}$ 假設 $\tilde{\mathbf R}$ 已知；不修正 path 極性`,
  String.raw`$\delta=a-w$（全站極性）；$\delta w=w-w^*$；時間單位一律 fs`,
  String.raw`spur：單 tone、小角度近似 $20\log_{10}(\pi f_{\mathrm{out}}|T|A_t)$；$A_t=A\,|\Delta w|$ 只計 gain bias 造成的 code tone，$\varepsilon_{\mathrm{det}}$ 本身（例如 INL 殘差）的輸出貢獻未計入`,
  String.raw`$\sigma_{\delta t}$ 為 DTC-referred（gain-equivalent × code），不是 PLL 輸出 jitter；random 與 deterministic 部分以平方和合併（互不相關）。條件 6 只檢查它與單 tone spur 是否在預算內：不和校正前（初始誤差 $w_0-a$）比較，也不把隨機部分經 $T(f)$ 積分成輸出 jitter（$|T|$ 只進入 spur）`,
  String.raw`95% 收斂：每個 mode 的平均暫態（相對於固定點；初始歷史 $=$ 初值，與軌跡圖相同）最後一次超過初值 5% 的下一個 block。$d=0$ 時 $=\lceil\ln0.05/\ln|1-g_i|\rceil$；$d\ge1$ 時 $\max|z|$ 只決定漸近速率，$\max|z|^k$ 不是誤差的包絡（重根、複數根），所以逐 block 數出來`,
  String.raw`identifiability 以有效 regressor 的自相關 $\mathbf R=E[\mathbf u\mathbf u^T]=|H|^2P_x\,\tilde{\mathbf R}$ 判斷（規格 §0）`,
  String.raw`判定門檻（$\kappa>100$、極性裕度 $M_{\mathrm{pol}}<30^\circ$、$\mathrm{PM}<45^\circ$，以及線性化指標 $>0.3$：gain 殘差的 RMS 除以 $\sigma_v$，固定點取 $|\Delta w|\,|H|\sqrt{P_x}/\sigma_v$、起點取 $|w_0-a|\,|H|\sqrt{P_x}/\sigma_v$）為 illustrative 設計規則，不是 sign-off 標準`,
  String.raw`Monte Carlo 交叉比對：共用的 sample-level block Sign-LMS 模型（單參數、$B=0$、Gaussian comparator noise）；比對條件 2–4，不含 bias 與定點量化`,
]

/** 指標表（MetricTable 以 mathText 顯示名稱與備註；單位欄為純文字） */
function metricsFor(r: ThesisResult, mc?: McOutcome): MetricRow[] {
  const p = r.params
  const slow = r.modes.filter((m) => m.identifiable).reduce<ThesisResult['modes'][number] | undefined>((a, b) => (!a || b.radius > a.radius ? b : a), undefined)
  // 交叉比對：σ_w 的 Σy² 分別用 Lyapunov 方程（採用）與直接加總計算
  const sumSigmaW = r.stable && r.identifiable && Number.isFinite(r.sigmaWSum) ? r.sigmaWSum : undefined
  const mcSigma = mc?.comparison.rows.find((x) => x.id === 'sigma')
  const rows: MetricRow[] = [
    { name: String.raw`$K_q=\sqrt{2/\pi}/\sigma_v$`, value: mv(r.Kq), unit: '1/fs', claim: 'approx', note: 'erf 的一階線性化' },
    { name: String.raw`$\theta=\phi+\Omega D$`, value: mv(r.polarity.thetaDeg), unit: '°' },
    { name: String.raw`$C=P_x|H|\cos\theta$`, value: mv(r.polarity.C), claim: 'exact' },
    { name: String.raw`極性裕度 $M_{\mathrm{pol}}=\arcsin(\cos\theta)$`, value: mv(r.polarity.marginDeg), unit: '°', claim: 'exact', note: '勘誤 E20' },
    { name: String.raw`$g=\mu\,s\,K_q\,C$`, value: mv(r.g), claim: 'exact' },
    {
      name: String.raw`$\max|z|$（可辨識 mode）`,
      value: mv(r.maxRadius),
      claim: 'exact',
      ...(p.d === 0 && !p.twoParam ? { analytic: Math.abs(1 - r.g), tolerance: 1e-12, note: String.raw`$d=0$：特徵根 $=1-g$` } : {}),
      ...(p.twoParam ? { note: String.raw`雙參數：以 $E[x_i[n-D]\,u_j[n]]=C\,\tilde R_{ij}$ 為前提` } : {}),
    },
    // 雙參數且 θ ≠ 0°：列出兩個固定同頻單頻 code 的 max|z| 當對照（F-DB.6）。不設 formulaId：這一列是對照值，不是 F-DB.6 本身
    ...(r.crossAssumptionActive
      ? [
          {
            name: String.raw`對照：兩個固定同頻單頻 code 的 $\max|z|$`,
            value: mv(r.fixedToneRadius),
            claim: 'exact' as const,
            note: String.raw`$E[x_i[n-D]\,u_j[n]]=P_x|H|\cos(\theta+\psi_j-\psi_i)$、$\rho=\cos\psi$（F-DB.6）；$\theta=0^\circ$ 時與上一列相同`,
          },
        ]
      : []),
    { name: String.raw`$g^*(d)=2\sin\frac{\pi}{4d+2}$`, value: mv(r.gStar), claim: 'exact' },
    {
      name: '95% 收斂（最慢 mode）',
      value: mv(r.slowT95Blocks),
      unit: 'blocks',
      claim: r.slowT95Exact ? 'exact' : 'approx',
      // 不收斂（∞）時不加備註；其餘說明這個數字是怎麼數出來的
      ...(Number.isFinite(r.slowT95Blocks)
        ? {
            note: !r.slowT95Exact
              ? String.raw`極慢的 mode：改列 $\lceil\ln0.05/\ln\max|z|\rceil$ 的漸近估計`
              : p.d === 0
                ? String.raw`$d=0$：$\lceil\ln0.05/\ln|1-g_i|\rceil$`
                : String.raw`$d\ge1$：由平均遞迴 $\delta_{k+1}=\delta_k-g_i\,\delta_{k-d}$（初始歷史 $=$ 初值，與上圖相同）數到暫態最後一次超過 5% 的下一個 block；只看 $\max|z|$ 的 $\lceil\ln0.05/\ln\max|z|\rceil=${blocksTo95(r.maxRadius)}$ 只是漸近估計`,
          }
        : {}),
    },
    { name: '95% 收斂時間', value: mv(r.slowT95Seconds), unit: 's' },
    { name: String.raw`$\lambda_{\min}(\mathbf R)$，$\mathbf R=|H|^2P_x\,\tilde{\mathbf R}$`, value: mv(r.lamMin), claim: 'exact' },
    { name: String.raw`$\kappa=\lambda_{\max}/\lambda_{\min}$`, value: mv(r.kappa), claim: 'exact' },
    { name: String.raw`$\sigma_\eta^2\approx P_x/N$`, value: mv(r.sigmaEta2), claim: 'approx' },
    {
      name: String.raw`$\sigma_w$（gain 參數穩態 RMS）`,
      value: mv(r.sigmaW),
      unit: 'fs',
      claim: 'approx',
      ...(sumSigmaW !== undefined
        ? {
            analytic: sumSigmaW,
            tolerance: 1e-8,
            toleranceMode: 'rel' as const,
            note: String.raw`$\sum y^2$：${p.d === 0 ? '封閉式 $1/(g(2-g))$' : 'Lyapunov 方程'}；參考欄為直接加總`,
          }
        : {}),
    },
    ...(mcSigma
      ? [
          {
            name: String.raw`$\sigma_w$（Monte Carlo，${mc?.runs} seeds）`,
            value: mv(mcSigma.mc),
            unit: 'fs',
            claim: 'approx' as const,
            analytic: mcSigma.analytic,
            note: String.raw`sample-level Sign-LMS；99% CI $[${f(mcSigma.lo)},\,${f(mcSigma.hi)}]\,\mathrm{fs}$；${mcSigma.pass ? '與解析值一致' : '與解析值不一致'}（判定規則見 Monte Carlo 表）`,
          },
        ]
      : []),
    { name: String.raw`$\Delta w=w^*-a=B/C$`, value: mv(r.deltaW), unit: 'fs', claim: 'exact', note: 'MSE-LMS 線性固定點；Sign-LMS 為近似（勘誤 E01）' },
    { name: String.raw`$\sigma_{\delta t}$ random（DTC-referred）`, value: mv(r.sigmaDtRand), unit: 'fs', claim: 'approx', note: String.raw`gain-equivalent $\times$ code，不是 PLL 輸出 jitter（規格 §12.1）` },
    { name: String.raw`$\sigma_{\delta t}$ deterministic $=\sqrt{P_x}\,|\Delta w|$`, value: mv(r.sigmaDtDet), unit: 'fs', claim: 'exact' },
    { name: String.raw`$\sigma_{\delta t}$ 合計 $=\sqrt{P_x(\Delta w^2+\sigma_w^2)}$`, value: mv(r.sigmaDt), unit: 'fs', claim: 'approx', note: '單參數時等於 F-DB.5；雙參數時 random 部分取兩個 mode 的總和' },
    { name: String.raw`$f_u=f_s/N$`, value: mv(r.fuHz), unit: 'Hz', claim: 'exact' },
    { name: String.raw`$f_{3\mathrm{dB}}$（exact discrete，最慢 mode）`, value: slow ? mv(slow.f3dbHz) : null, unit: 'Hz', claim: 'exact', note: '不是 noise BW（勘誤 E06）' },
    { name: 'ENBW one-sided（最慢 mode）', value: slow ? mv(slow.enbwHz) : null, unit: 'Hz', claim: 'exact', note: String.raw`$\sigma_w^2=S_w^{(1)}(0)\cdot\mathrm{ENBW}$` },
    { name: String.raw`調變指數 $\beta=2\pi f_{\mathrm{out}}|T|A_t$`, value: mv(r.betaRad), unit: 'rad', claim: 'exact', note: String.raw`$A_t=A\,|\Delta w|$（peak）；fs → rad 一律用 fsToRad` },
    { name: String.raw`Spur $\approx20\log_{10}(\beta/2)$`, value: mv(r.spurDbc), unit: 'dBc', claim: 'approx', note: String.raw`小角度近似；只計 gain bias 的 code tone` },
  ]
  return rows
}

/** 「六條件一分鐘體檢」：同一組參數同時檢查六個條件，Case A/B/C 並排比較。 */
export function HealthCheck({ cases, evaluated }: { cases: UseCasesResult<ThesisParams>; evaluated: EvaluatedCase[] }) {
  const tokens = useThemeTokens()
  const active = evaluated.find((e) => e.id === cases.activeId) ?? evaluated[0]
  const r = active.result
  const set = (patch: Partial<ThesisParams>) => cases.update(patch)
  // Monte Carlo 交叉比對（Web Worker；全站共用的 block Sign-LMS 模型）
  const mc = useMonteCarloCheck(r, cases.seed)

  // ?preset=<id>：內建 preset（THESIS_PRESETS），或外部 PresetEntry（experiment = 'dashboard-thesis-check'，參數先經 sanitizeParams）
  const urlPreset = useUrlPreset(EXPERIMENT_ID)
  const [search] = useSearchParams()
  const urlBuiltin = builtinPreset(search.get('preset'))
  const { update } = cases
  useEffect(() => {
    if (urlBuiltin) update(presetParams(urlBuiltin))
    else if (urlPreset) update({ ...DEFAULT_PARAMS, ...sanitizeParams(urlPreset.params) })
  }, [urlBuiltin, urlPreset, update])

  const presets = useMemo(
    () => [
      ...THESIS_PRESETS.map((p) => ({ name: p.name, description: p.description, params: presetParams(p) as unknown as Record<string, unknown> })),
      ...presetsForExperiment(EXPERIMENT_ID).map((p) => ({ name: p.title, description: p.description, params: p.params })),
    ],
    [],
  )

  // 時間軌跡：所有 case 用同一個長度，方便同圖比較
  const K = useMemo(() => Math.min(20000, Math.max(...evaluated.map((e) => suggestHorizon(e.result)))), [evaluated])
  const traj = useMemo(() => evaluated.map((e) => ({ e, t: trajectory(e.result, K) })), [evaluated, K])

  const plotData = useMemo<Data[]>(() => {
    const step = Math.max(1, Math.ceil(K / 1500)) // 畫圖時抽點；CSV 匯出用完整資料
    const out: Data[] = []
    for (const { e, t } of traj) {
      const color = tokens.series[e.seriesIndex] ?? tokens.accent
      const xs: number[] = []
      const m: number[] = []
      const up: number[] = []
      const lo: number[] = []
      for (let k = 0; k <= K; k += step) {
        xs.push(k)
        m.push(t.mean[k])
        up.push(t.mean[k] + t.sd[k])
        lo.push(t.mean[k] - t.sd[k])
      }
      out.push(
        { x: xs, y: up, type: 'scatter', mode: 'lines', line: { width: 0, color }, hoverinfo: 'skip', showlegend: false },
        { x: xs, y: lo, type: 'scatter', mode: 'lines', line: { width: 0, color }, fill: 'tonexty', fillcolor: withAlpha(color, 0.18), hoverinfo: 'skip', name: `Case ${e.id} $\\pm1\\sigma$`, showlegend: false },
        { x: xs, y: m, type: 'scatter', mode: 'lines', line: { width: 2, color }, name: `Case ${e.id}：$E[w_k - a]$` },
      )
      if (Number.isFinite(e.result.deltaW))
        out.push({ x: [0, K], y: [e.result.deltaW, e.result.deltaW], type: 'scatter', mode: 'lines', line: { width: 1, dash: 'dash', color }, name: `Case ${e.id}：$\\Delta w = B/C$` })
    }
    return out
  }, [traj, tokens, K])

  const layout = useMemo(
    () => ({
      xaxis: { title: { text: 'GMAC block $k$' } },
      yaxis: { title: { text: '$w_k - a$ [fs]' } },
    }),
    [],
  )
  const diverged = traj.filter((x) => x.t.diverged).map((x) => x.e.id)
  // 雙參數且 θ ≠ 0° 的 case：畫出來的平均軌跡以交叉相關假設為前提（圖說要講）
  const crossCases = evaluated.filter((e) => e.result.crossAssumptionActive).map((e) => e.id)
  // d ≥ 1 時 k_95 的例子（重根）：d = 1、g = 1/4 ⇒ δ_k = (1 + k/2)·2^{−k}；數字由同一個函式現算
  const dblRoot = useMemo(() => ({ y: [5, 6, 7].map((k) => (1 + k / 2) * 2 ** -k), blocks: settleDelayed(0.25, 1).blocks, asym: blocksTo95(0.5) }), [])
  // 演算法比較：同一組參數分別用 M = μI 與 M = μR̃⁻¹（只在 2 參數時有意義）
  const cmp = useMemo(() => {
    const p = r.params
    if (!p.twoParam) return undefined
    return { scalar: evaluateThesis({ ...p, update: 'scalar' }), precond: evaluateThesis({ ...p, update: 'precond' }) }
  }, [r.params])
  // 弱 / 強方向依 λ̃ 的大小決定（ρ < 0 時弱方向是 (1, 1)/√2，不是固定的第二個 mode）
  const ws = weakStrongModes(r.modes)
  const noiseRatio =
    ws && Number.isFinite(ws.weak.variance) && Number.isFinite(ws.strong.variance) && ws.strong.variance > 0 ? Math.sqrt(ws.weak.variance / ws.strong.variance) : NaN

  return (
    <ExperimentShell
      id={EXPERIMENT_ID}
      title="六條件一分鐘體檢（Calibration Thesis Check）"
      level="L2"
      claim="approx"
      source="illustrative"
      tests={['T04', 'T06', 'T07', 'T08', 'T10', 'T11', 'T13', 'T14', 'T15']}
      description={
        <>
          用<strong>同一組參數</strong>、同一條線性化方程式（上一節的推導），一次算出六個條件。燈號來自局部、平均意義的解析模型，
          目的是讓你看見條件之間的關係；按「執行 Run」可以用真正的 sample-level Sign-LMS Monte Carlo 檢查它（單參數）。每一項的完整模擬在對應章節。
          預設值是規格 T13 的條件。
        </>
      }
      assumptions={ASSUMPTIONS}
      controls={<ThesisControls p={cases.active.params} set={set} />}
      params={{ ...cases.active.params, case: cases.activeId }}
      units={{ sigmaV: 'fs', mu: 'fs', fsGHz: 'GHz', phiDeg: 'deg', omega: 'rad/sample', D: 'samples', d: 'blocks', B: 'fs', w0MinusA: 'fs', foutGHz: 'GHz', jitterBudget: 'fs', spurLimit: 'dBc' }}
      seed={cases.seed}
      onSeedChange={cases.setSeed}
      metrics={metricsFor(r, mc.outcome)}
      warnings={r.warnings}
      crossCheck={{
        analytic: { status: r.crossCheck.ok ? 'ok' : 'mismatch', note: r.crossCheck.note },
        monteCarlo: mc.check,
        fixedPoint: { status: 'not-implemented', note: '此模型不含定點 / 6-bit 量化；見 Ch13 與 Behavioral Models' },
      }}
      actions={{
        onReset: () => cases.reset({ ...DEFAULT_PARAMS }),
        ...(mc.plan.ok ? { onRun: mc.run, onStop: mc.cancel, running: mc.running } : {}),
      }}
      exportData={() => {
        const cols: Record<string, ArrayLike<number>> = { k: traj[0]?.t.k ?? [] }
        for (const { e, t } of traj) {
          cols[`case${e.id}_mean_w_minus_a_fs`] = t.mean
          cols[`case${e.id}_sd_fs`] = t.sd
        }
        if (mc.outcome) {
          // Monte Carlo（目前 case、B = 0）：跨 seed 的平均與標準差
          cols[`case${active.id}_mc_k`] = Float64Array.from({ length: mc.outcome.wMean.length }, (_, i) => i)
          cols[`case${active.id}_mc_mean_w_minus_a_fs`] = mc.outcome.wMean.map((w) => w - MC_GAIN_TRUE_FS)
          cols[`case${active.id}_mc_std_across_seeds_fs`] = mc.outcome.wStd
        }
        return cols
      }}
      presets={presets}
      onLoadPreset={(pr) => cases.update({ ...DEFAULT_PARAMS, ...sanitizeParams(pr.params) })}
      headingLevel={2}
    >
      <CaseSelector cases={cases} label="比較組（每組各自調參數）" />

      <div className="table-wrap">
        <table className="dash-check-table">
          <caption className="small muted" style={{ captionSide: 'bottom', textAlign: 'left' }}>
            ✓ 通過、! 注意、✗ 未通過；滑過燈號可看原因。目前編輯中的是 Case {cases.activeId}。
          </caption>
          <thead>
            <tr>
              <th>條件</th>
              {evaluated.map((e) => (
                <th key={e.id}>
                  <span className="dash-dot" style={{ background: `var(--series-${e.seriesIndex + 1})`, marginRight: 6 }} aria-hidden="true" />
                  Case {e.id}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SIX_CONDITIONS.map((c) => (
              <tr key={c.id}>
                <td className="nowrap">
                  {c.n}. {c.zh}
                </td>
                {evaluated.map((e) => {
                  const chk = e.result.checks.find((k) => k.id === c.id)
                  return (
                    <td key={e.id}>
                      {chk && (
                        <span className="dash-check-cell" title={plainTip(chk.reason)}>
                          <StateIcon state={chk.state} />
                          <span>
                            <Rich text={chk.summary} />
                          </span>
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 style={{ marginBottom: 4 }}>Case {cases.activeId} 逐項說明</h4>
      <ul className="dash-reasons">
        {r.checks.map((c) => {
          const def = SIX_CONDITIONS.find((x) => x.id === c.id)
          return (
            <li key={c.id}>
              <StateIcon state={c.state} />
              <span>
                <strong>
                  {def?.n}. {def?.zh}：
                </strong>
                <Rich text={c.reason} />
              </span>
            </li>
          )
        })}
      </ul>
      {r.notes.map((n) => (
        <Callout key={n} kind="warn" title="近似的適用範圍">
          <Rich text={n} />
        </Callout>
      ))}

      <Plot
        title={String.raw`平均 gain 誤差 $E[w_k-a]$ 與 $\pm1\sigma$ 帶（線性化平均模型）`}
        ariaLabel="各個 case 的平均 gain 誤差隨 GMAC block 的變化，陰影為正負一個標準差（線性化平均模型）"
        csvName="dashboard-thesis-trajectory"
        data={plotData}
        layout={layout}
        height={320}
        caption={
          String.raw`虛線為固定點 $\Delta w=B/C$；陰影為從 0 開始累積的 $\pm1\sigma$（穩態寬度為 $\sigma_w$）。` +
          (diverged.length ? ` Case ${diverged.join('、')} 在線性模型下發散，已截斷（真實 Sign-LMS 會因 erf 飽和變成線性漂移，見 Ch06）。` : '') +
          (crossCases.length
            ? String.raw` Case ${crossCases.join('、')} 是雙參數且 $\theta\ne0^\circ$：曲線以交叉相關假設 $E[x_iu_j]=C\,\tilde R_{ij}$ 為前提（見上方「近似的適用範圍」）。`
            : '')
        }
      />

      <MonteCarloPanel mc={mc} r={r} caseId={active.id} seriesIndex={active.seriesIndex} seed={cases.seed} />

      <ModeGate min="engineer">
        <h4 style={{ marginBottom: 4 }}>
          <Rich text={`Case ${cases.activeId} 的 eigen-mode（$\\tilde{\\mathbf R}$ 的特徵方向）`} />
        </h4>
        <div className="table-wrap">
          <table className="dash-eigen-table">
            <thead>
              <tr>
                <th>mode</th>
                <th className="num">
                  <Tex>{'\\tilde\\lambda_i'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'g_i'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'\\max|z|'}</Tex>
                </th>
                <th className="num">PM</th>
                <th className="num">
                  <Tex>{'k_{95}'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'\\sigma_{\\xi,i}\\ [\\mathrm{fs}]'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'f_{3\\mathrm{dB}}'}</Tex>
                </th>
                <th className="num">ENBW</th>
              </tr>
            </thead>
            <tbody>
              {r.modes.map((m, i) => (
                <tr key={i}>
                  <td className="nowrap">{r.params.twoParam ? <Tex>{i === 0 ? '(1,\\,1)/\\sqrt2' : '(1,\\,-1)/\\sqrt2'}</Tex> : '純量'}</td>
                  <td className="num">{f(m.lam)}</td>
                  <td className="num">{f(m.gain)}</td>
                  <td className="num">{f(m.radius, 6)}</td>
                  <td className="num">{Number.isFinite(m.pmDeg) ? `${f(m.pmDeg)}°` : '—'}</td>
                  <td className="num">{f(m.t95Blocks)}</td>
                  <td className="num">{f(Math.sqrt(m.variance))}</td>
                  <td className="num">{Number.isFinite(m.f3dbHz) ? `${f(m.f3dbHz / 1e3)} kHz` : '—'}</td>
                  <td className="num">{Number.isFinite(m.enbwHz) ? `${f(m.enbwHz / 1e3)} kHz` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {r.params.d >= 1 && (
          <p className="small muted">
            <Rich
              text={String.raw`$d\ge1$ 時 $k_{95}$ 由各 mode 的平均遞迴 $\delta_{k+1}=\delta_k-g_i\,\delta_{k-d}$ 逐 block 數出，不是 $\lceil\ln0.05/\ln\max|z|\rceil$：$\max|z|^k$ 不是誤差的包絡。例：$d=1$、$g=0.25$ 是重根 $z=0.5$，$\delta_k=(1+k/2)\,2^{-k}$，在 $k=5,6,7$ 是 $${f(dblRoot.y[0], 3)}$、$${f(dblRoot.y[1], 3)}$、$${f(dblRoot.y[2], 3)}$，要 $${dblRoot.blocks}$ 個 block，而 $\lceil\ln0.05/\ln0.5\rceil=${dblRoot.asym}$。`}
            />
          </p>
        )}
        {r.params.twoParam && (
          <p className="small muted">
            <Rich
              text={String.raw`特徵方向 $(1,\pm1)/\sqrt2$ 與 ${r.params.update === 'precond' ? '$g_i=g$' : String.raw`$g_i=g\,\tilde\lambda_i$`} 來自交叉相關假設 $E[x_i[n-D]\,u_j[n]]=C\,\tilde R_{ij}$：$\theta=0^\circ$ 時對任何同頻 code 都成立；$\theta\ne0^\circ$ 時要另外確認（見下方「假設」與 F-DB.6）。`}
            />
          </p>
        )}
        {ws && (
          <p className="small muted">
            <Rich
              text={
                Number.isFinite(noiseRatio)
                  ? String.raw`弱方向 / 強方向的雜訊 RMS 比 $\sigma_{\xi,\mathrm{weak}}/\sigma_{\xi,\mathrm{strong}}=${f(noiseRatio)}$（${WEAK_IS}）；`
                  : String.raw`弱方向 / 強方向的雜訊 RMS 比 $\sigma_{\xi,\mathrm{weak}}/\sigma_{\xi,\mathrm{strong}}$：迴路不穩定，沒有穩態值（${WEAK_IS}）；`
              }
            />
            {r.params.update === 'precond' ? (
              <Rich text={`preconditioner 下理論值為 $\\sqrt{\\kappa}=${f(Math.sqrt(r.kappa))}$。`} />
            ) : (
              <Rich text={String.raw`一般 LMS 在小步長（$g\,\tilde\lambda_{\max}\ll1$）時兩者相近，但弱方向的收斂約慢 $\tilde\lambda_{\max}/\tilde\lambda_{\min}$ 倍；步長大時各 mode 實際要幾個 block 看上表的 $k_{95}$（例如 $d=0$、$g>1$ 時最慢的反而是強方向）。`} />
            )}
          </p>
        )}

        <h4 style={{ marginBottom: 4 }}>演算法比較：一般 LMS vs preconditioned</h4>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th />
                <th>
                  <Tex>{'\\mathbf M=\\mu\\mathbf I'}</Tex>（一般 LMS）
                </th>
                <th>
                  <Tex>{'\\mathbf M=\\mu\\tilde{\\mathbf R}^{-1}'}</Tex>（preconditioned）
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  mode <Tex>{'i'}</Tex> 的 loop gain
                </td>
                <td>
                  <Tex>{'g\\,\\tilde\\lambda_i'}</Tex>
                </td>
                <td>
                  <Tex>{'g'}</Tex>（所有 mode 相同）
                </td>
              </tr>
              <tr>
                <td>
                  mode <Tex>{'i'}</Tex> 每 block 注入的雜訊功率
                </td>
                <td>
                  <Tex>{'\\mu^2s^2\\frac{P_x}{N}\\,\\tilde\\lambda_i'}</Tex>
                </td>
                <td>
                  <Tex>{'\\mu^2s^2\\frac{P_x}{N}\\,\\frac{1}{\\tilde\\lambda_i}'}</Tex>
                </td>
              </tr>
              <tr>
                <td>固定點</td>
                <td>
                  <Tex>{'w^*=a+B/C'}</Tex>
                </td>
                <td>
                  相同（<Tex>{'\\mathbf M'}</Tex> 可逆時不改變固定點）
                </td>
              </tr>
              <tr>
                <td>需要的知識 / 硬體</td>
                <td>每個參數一個乘法，不需要模型</td>
                <td>
                  需估計 <Tex>{'\\tilde{\\mathbf R}'}</Tex>（或 Jacobian）與矩陣乘法；估錯可能讓某個 mode 變號（T18 反例，<ChRef ch="10">Ch10</ChRef>）
                </td>
              </tr>
              {cmp && (
                <>
                  <tr>
                    <td>
                      目前參數：最慢 mode 95% 收斂 <ClaimTag kind={cmp.scalar.slowT95Exact && cmp.precond.slowT95Exact ? 'exact' : 'approx'} />
                    </td>
                    <td className="num">{f(cmp.scalar.slowT95Blocks)} blocks</td>
                    <td className="num">{f(cmp.precond.slowT95Blocks)} blocks</td>
                  </tr>
                  <tr>
                    <td>
                      目前參數：每個係數的 <Tex>{'\\sigma_w'}</Tex> <ClaimTag kind="approx" />
                    </td>
                    <td className="num">{f(cmp.scalar.sigmaW)} fs</td>
                    <td className="num">{f(cmp.precond.sigmaW)} fs</td>
                  </tr>
                  <tr>
                    <td>
                      目前參數：DTC-referred <Tex>{'\\sigma_{\\delta t}'}</Tex>（random）
                    </td>
                    <td className="num">{f(cmp.scalar.sigmaDtRand)} fs</td>
                    <td className="num">{f(cmp.precond.sigmaDtRand)} fs</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
        {!cmp && (
          <p className="small muted">
            打開「同時校正第二個參數」，表格會用目前參數分別算出兩種 <Tex>{'\\mathbf M'}</Tex> 的收斂時間與雜訊。
          </p>
        )}

        <h4 style={{ marginBottom: 4 }}>核心程式碼：兩種更新矩陣只差三行</h4>
        <CodeCompare
          items={[
            // label 也會出現在分頁按鈕上（純文字），所以數學寫在 title / note（兩者都會以 KaTeX 顯示）
            {
              label: '一般 LMS',
              title: String.raw`modeScalar：$\mathbf M=\mu\mathbf I$`,
              source: modelSrc,
              region: 'modeScalar',
              path: MODEL_PATH,
              note: String.raw`$\mathbf M=\mu\mathbf I$：弱方向的 loop gain 只有 $g\,\tilde\lambda_{\min}$，所以慢`,
            },
            {
              label: 'Preconditioned LMS',
              title: String.raw`modePrecond：$\mathbf M=\mu\tilde{\mathbf R}^{-1}$`,
              source: modelSrc,
              region: 'modePrecond',
              path: MODEL_PATH,
              note: String.raw`$\mathbf M=\mu\tilde{\mathbf R}^{-1}$：每個 mode 一樣快，但雜訊功率 $\propto1/\tilde\lambda_i$`,
            },
          ]}
          caption="網站實際執行的程式碼（src/pages/dashboard/thesisModel.ts）；標記「← 差異」的行就是兩種演算法唯一的不同。"
        />
        <details className="dash-details">
          <summary>更多核心程式碼：極性、特徵根、95% 收斂、雙參數對照、脈衝響應能量</summary>
          <div className="dash-details-body">
            <CodeBlock source={modelSrc} region="polarity" path={MODEL_PATH} title={String.raw`polarityOf：$C=P_x|H|\cos(\phi+\Omega D)$`} />
            <CodeBlock source={modelSrc} region="loopPoles" path={MODEL_PATH} title={String.raw`特徵多項式、$g^*$、phase margin`} />
            <CodeBlock
              source={modelSrc}
              region="settleDelayed"
              path={MODEL_PATH}
              title={String.raw`settleDelayed：有 commit 延遲時的 $k_{95}$（照平均遞迴逐 block 數，不是 $\lceil\ln0.05/\ln\max|z|\rceil$）`}
            />
            <CodeBlock
              source={modelSrc}
              region="fixedToneRadius"
              path={MODEL_PATH}
              title={String.raw`fixedToneRadius：兩個固定同頻單頻 code 的 $\max|z|$（雙參數假設的對照，F-DB.6）`}
            />
            <p className="small">
              <Rich text={String.raw`同一個量 $\sum_m y_m^2$（白雜訊經校正迴路後的功率增益，$\sigma_w^2=q\sum_m y_m^2$）用兩種獨立的方法算，結果必須相同——這就是上方「交叉比對 Analytic」那一格在檢查的事：`} />
            </p>
            <CodeCompare
              items={[
                { label: '算法一：照定義直接加總', source: modelSrc, region: 'impulseEnergy', path: MODEL_PATH, note: '直覺，但極慢的 mode 要加很多項' },
                { label: '算法二：解 Lyapunov 方程', source: modelSrc, region: 'impulseEnergyLyapunov', path: MODEL_PATH, note: '一次線性求解，任何 $g$ 都精確' },
              ]}
              caption={String.raw`$d=0$ 時兩者都等於封閉式 $1/(g(2-g))=1/(1-p^2)$。`}
            />
            <ModeGate min="research">
              <CodeBlock source={modelSrc} region="evaluateThesis" path={MODEL_PATH} title="evaluateThesis：六個條件共用的計算核心" />
            </ModeGate>
          </div>
        </details>
      </ModeGate>
      <p className="small muted">
        <ClaimTag kind="approx" /> 整體為局部線性化平均模型；各列指標旁的標籤說明它在此模型內是精確或近似。
      </p>
    </ExperimentShell>
  )
}
