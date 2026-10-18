import { useDeferredValue, useMemo, useState } from 'react'
import type { Data, Layout } from 'plotly.js-cartesian-dist-min'
import {
  ClaimTag,
  CodeCompare,
  ExperimentShell,
  HandCalc,
  ModeGate,
  ParamControl,
  Plot,
  Prereq,
  StepDerivation,
  Tex,
  useThemeTokens,
  type ExperimentPreset,
  type MetricRow,
  ChRef,
} from '@/components'
import modelSrc from '../model.ts?raw'
import { roadmapHandCalc } from '../handcalcs'
import { designMetrics, nearIntegerAsymptote, nearIntegerKeepOut, uniformCodeR, windowLambdaMin } from '../model'
import { ErratumNote, mergeParams, mt, n4, Observe, pl, TryIt, useRoadmapPresets } from '../common'

const PATH = 'src/pages/roadmap/model.ts'

/* ─────────── A：E- vs D-optimal ─────────── */

const EXP_A = 'roadmap-r5-design'

interface DesignParams {
  mean: number
  half: number
  scale: number
}

const DEF_A: DesignParams = { mean: 0.3, half: 0.6, scale: 1 }
const PRESETS_A: ExperimentPreset[] = [
  { name: '有 DC 的 code（m = 0.3、h = 0.6）', params: { ...DEF_A }, description: 'Var = 0.12' },
  { name: '置中的 code（m = 0、h = 0.5）', params: { mean: 0, half: 0.5, scale: 1 }, description: 'Var = 1/12' },
  { name: 'offset 以 0.1 為單位（s = 0.1）', params: { ...DEF_A, scale: 0.1 }, description: '換單位：E-optimal 的排名翻轉' },
]
// Plot 的 layout 是靜態的：放在模組層，避免每次 render 產生新物件而觸發 Plotly.react
const LAYOUT_MEAN: Partial<Layout> = { xaxis: { title: { text: '$m$（code 平均）' } }, yaxis: { title: { text: '指標' } } }
const LAYOUT_SCALE: Partial<Layout> = { xaxis: { title: { text: '$s$（offset 單位尺度）' } }, yaxis: { title: { text: 'A / B' } } }
const LAYOUT_NEAR: Partial<Layout> = { xaxis: { title: { text: '$\\alpha$（FCW 小數，離整數的距離）' } }, yaxis: { title: { text: '$\\lambda_{\\min}$' } } }

const DESIGN_A = { mean: 0, half: 0.5 }
const DESIGN_B = { mean: 0.3, half: 0.6 }

function DesignExperiment() {
  const [P, setP] = useState<DesignParams>(DEF_A)
  const tokens = useThemeTokens()
  const presets = useRoadmapPresets(EXP_A, PRESETS_A, (pr) => setP((prev) => mergeParams(prev, pr)))
  const dP = useDeferredValue(P)
  const m = designMetrics(uniformCodeR(dP.mean, dP.half, dP.scale))
  const varX = (dP.half * dP.half) / 3
  // 解析交叉比對：eigSym 的兩個 eigenvalue 的乘積與和，對上封閉式的 det 與 trace
  const detClosed = dP.scale * dP.scale * varX
  const trClosed = dP.mean * dP.mean + varX + dP.scale * dP.scale
  const analyticOk = Math.abs(m.det - detClosed) <= 1e-9 * Math.max(detClosed, 1e-300) && Math.abs(m.trace - trClosed) <= 1e-12 * trClosed
  const meanGrid = useMemo(() => Array.from({ length: 101 }, (_, i) => -0.5 + i * 0.01), [])
  const sGrid = useMemo(() => Array.from({ length: 81 }, (_, i) => 10 ** (-2 + i * 0.05)), [])
  const msGrid = useMemo(() => meanGrid.map((mu) => designMetrics(uniformCodeR(mu, dP.half, dP.scale))), [meanGrid, dP.half, dP.scale])
  const ratios = useMemo(() => {
    const a = sGrid.map((s) => designMetrics(uniformCodeR(DESIGN_A.mean, DESIGN_A.half, s)))
    const b = sGrid.map((s) => designMetrics(uniformCodeR(DESIGN_B.mean, DESIGN_B.half, s)))
    return { lam: a.map((d, i) => d.lambdaMin / b[i].lambdaMin), det: a.map((d, i) => d.det / b[i].det) }
  }, [sGrid])
  const vsMean: Data[] = useMemo(() => {
    const ms = msGrid
    return [
      { x: meanGrid, y: ms.map((d) => d.lambdaMin), name: '$\\lambda_{\\min}$（E-optimal）', mode: 'lines', line: { color: tokens.series[0] } },
      { x: meanGrid, y: ms.map((d) => d.det), name: '$\\det R$（D-optimal）', mode: 'lines', line: { color: tokens.series[1], dash: 'dash' } },
    ]
  }, [meanGrid, msGrid, tokens])
  const flip: Data[] = useMemo(() => {
    return [
      { x: sGrid, y: ratios.lam, name: '$\\lambda_{\\min}(A)/\\lambda_{\\min}(B)$', mode: 'lines', line: { color: tokens.series[0] } },
      { x: sGrid, y: ratios.det, name: '$\\det(A)/\\det(B)$', mode: 'lines', line: { color: tokens.series[1], dash: 'dash' } },
      { x: [sGrid[0], sGrid[sGrid.length - 1]], y: [1, 1], name: '比值 = 1', mode: 'lines', line: { color: tokens.textMuted, dash: 'dot' } },
    ]
  }, [sGrid, ratios, tokens])

  const warnings: string[] = []
  if (m.lambdaMin <= 1e-12) warnings.push(String.raw`$\lambda_{\min}=0$：$\mathrm{Var}(x)=0$（code 沒有擺動），gain 與 offset 不可辨識——GMAC 只能看到兩者的組合。`)
  if (Math.abs(dP.mean) > dP.half) warnings.push(String.raw`$|m|>h$（平均大於半擺幅）：code 全部同號，gain 與 offset 的 regressor 高度相關（$\lambda_{\min}$ 很小）。`)

  const metrics: MetricRow[] = [
    { name: '$E[x]$', value: dP.mean },
    { name: '$E[x^2]=m^2+h^2/3$', value: dP.mean * dP.mean + varX },
    { name: String.raw`$\mathrm{Var}(x)=h^2/3$`, value: varX },
    { name: String.raw`$\det\mathbf R=s^2\,\mathrm{Var}(x)$`, value: m.det, analytic: dP.scale * dP.scale * varX, tolerance: 1e-12, toleranceMode: 'rel', formulaId: 'F-R5.1', claim: 'exact' },
    { name: String.raw`$\lambda_{\min}(\mathbf R)$`, value: m.lambdaMin, formulaId: 'F-R5.1', claim: 'exact' },
    { name: String.raw`$\lambda_{\max}(\mathbf R)$`, value: m.lambdaMax },
    { name: String.raw`$\mathrm{tr}\,\mathbf R=\lambda_{\min}+\lambda_{\max}$`, value: m.trace, analytic: trClosed, tolerance: 1e-12, toleranceMode: 'rel', note: String.raw`封閉式 $E[x^2]+s^2$` },
    { name: String.raw`$\mathrm{cond}(\mathbf R)=\lambda_{\max}/\lambda_{\min}$`, value: m.cond },
  ]

  return (
    <ExperimentShell
      id={EXP_A}
      title="R5 預覽 A：gain + offset 兩參數的 E- / D-optimal 指標"
      level="L3"
      claim="exact"
      description={<>regressor <Tex>{'\\mathbf u=[x,\\ s]^T'}</Tex>，<Tex>{'x'}</Tex> 在 <Tex>{'[m-h,\\ m+h]'}</Tex> 均勻分布；<Tex>{'s'}</Tex> 是 offset 參數的單位尺度。</>}
      assumptions={[String.raw`只看資訊矩陣 $\mathbf R=E[\mathbf u\mathbf u^T]$（raw-x，未經 $H_{\mathrm{PD}}$）`, 'code 均勻分布；真實 training sequence 由 DSM / LFSR 產生（R5 待辦）']}
      params={{ ...P }}
      units={{ mean: 'code 單位', half: 'code 單位', scale: '—' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{ analytic: { status: analyticOk ? 'ok' : 'mismatch', note: String.raw`eigSym 的 eigenvalue 乘積、和 vs 封閉式的 $s^2\mathrm{Var}(x)$、$E[x^2]+s^2$` }, monteCarlo: 'not-implemented', fixedPoint: 'n/a' }}
      actions={{ onReset: () => setP(DEF_A) }}
      presets={presets}
      onLoadPreset={(pr) => setP((prev) => mergeParams(prev, pr.params))}
      exportData={() => ({ mean: meanGrid, lambda_min_vs_mean: msGrid.map((d) => d.lambdaMin), det_vs_mean: msGrid.map((d) => d.det), s: sGrid, lambda_ratio_A_over_B: ratios.lam, det_ratio_A_over_B: ratios.det })}
      controls={
        <>
          <ParamControl {...pl('$m$（code 平均）', 'm（code 平均）')} value={P.mean} onChange={(v) => setP({ ...P, mean: v })} min={-0.5} max={0.5} step={0.01} unit="code" reg="Training：code DC" />
          <ParamControl {...pl('$h$（code 半擺幅）', 'h（code 半擺幅）')} value={P.half} onChange={(v) => setP({ ...P, half: v })} min={0.01} max={1} step={0.01} unit="code" reg="Training：code swing / DTC range" />
          <ParamControl {...pl('$s$（offset 參數的單位尺度）', 's（offset 參數的單位尺度）')} value={P.scale} onChange={(v) => setP({ ...P, scale: v })} min={0.01} max={100} log unit="—" reg="Behavioral：offset regressor scaling" />
        </>
      }
    >
      <div className="rm-plots">
        <Plot title={String.raw`置中（$m\to0$）只改善 $\lambda_{\min}$，不改變 $\det\mathbf R$`} data={vsMean} layout={LAYOUT_MEAN} height={280} csvName="r5-vs-mean" />
        <Plot
          title={String.raw`換單位 $s$：$\det$ 的比值不變、$\lambda_{\min}$ 的比值穿過 1（A：$m=0$、$h=0.5$；B：$m=0.3$、$h=0.6$）`}
          data={flip}
          xLog
          layout={LAYOUT_SCALE}
          height={280}
          csvName="r5-scaling"
        />
      </div>
    </ExperimentShell>
  )
}

/* ─────────── B：near-integer keep-out ─────────── */

const EXP_B = 'roadmap-r5-nearint'

interface NearParams {
  N0: number
  lambdaT: number
}

const DEF_B: NearParams = { N0: 256, lambdaT: 1e-3 }
const PRESETS_B: ExperimentPreset[] = [
  { name: 'N0 = 256、λ_t = 1e-3', params: { ...DEF_B } },
  { name: '更長的 PE 窗口 N0 = 4096', params: { N0: 4096, lambdaT: 1e-3 }, description: 'keep-out 縮小約 16 倍' },
  { name: '更嚴的 λ_t = 0.02', params: { N0: 256, lambdaT: 0.02 }, description: '漸近式開始失準（αN0 不再 ≪ 1）' },
]
const ALPHAS = Array.from({ length: 49 }, (_, i) => 10 ** (-5 + i * (Math.log10(0.4) + 5) / 48))

function NearIntExperiment() {
  const [P, setP] = useState<NearParams>(DEF_B)
  const tokens = useThemeTokens()
  const presets = useRoadmapPresets(EXP_B, PRESETS_B, (pr) => setP((prev) => mergeParams(prev, pr)))
  const dP = useDeferredValue(P)
  const N0 = Math.max(4, Math.round(dP.N0))
  const sweep = useMemo(() => ALPHAS.map((a) => windowLambdaMin(a, N0, 32).worst), [N0])
  const asym = useMemo(() => ALPHAS.map((a) => nearIntegerAsymptote(a, N0)), [N0])
  const alphaAnalytic = nearIntegerKeepOut(dP.lambdaT, N0)
  const idx = sweep.findIndex((v, i) => v >= dP.lambdaT && sweep.slice(i).every((w) => w >= dP.lambdaT))
  const alphaNumeric = idx >= 0 ? ALPHAS[idx] : NaN
  const plateau = sweep[sweep.length - 1]

  const warnings: string[] = []
  if (dP.lambdaT >= plateau)
    warnings.push(String.raw`$\lambda_t=${dP.lambdaT}$ 不小於完整 sawtooth 的 $\lambda_{\min}\approx${n4(plateau)}$：gain + offset 兩參數用 DSM residue 永遠達不到這個 PE 門檻（不是 keep-out 的問題，是 regressor 本身的資訊上限）。`)
  if (alphaAnalytic * N0 > 0.5) warnings.push(String.raw`$\alpha N_0=${n4(alphaAnalytic * N0)}$ 不夠小：窗口內可能已經有 wrap，漸近式 $\alpha^2(N_0^2-1)/15$ 只是估計。`)

  const metrics: MetricRow[] = [
    { name: String.raw`keep-out 邊界 $\alpha_{\mathrm{keep}}$（漸近式）`, value: alphaAnalytic, unit: 'FCW 小數', formulaId: 'F-R5.2', claim: 'approx' },
    { name: String.raw`keep-out 邊界 $\alpha$（數值掃描，格點）`, value: alphaNumeric, unit: 'FCW 小數', note: String.raw`最差窗口 $\lambda_{\min}\ge\lambda_t$ 之後一直成立的最小格點` },
    { name: String.raw`完整 sawtooth 的 $\lambda_{\min}$（$\alpha$ 大）`, value: plateau, unit: '—', note: String.raw`均勻分布 $\mathrm{Var}=1/12$ 附近` },
    { name: String.raw`小 $\alpha$ 的比值 $\lambda_{\min}/$漸近式`, value: sweep[0] / asym[0], unit: '—', analytic: 1, tolerance: 0.1 },
  ]
  const data: Data[] = useMemo(
    () => [
      { x: ALPHAS, y: sweep, name: '最差窗口 $\\lambda_{\\min}$（數值）', mode: 'lines+markers', marker: { size: 4 }, line: { color: tokens.series[0] } },
      { x: ALPHAS, y: asym, name: '$\\alpha^2(N_0^2 - 1)/15$', mode: 'lines', line: { color: tokens.series[1], dash: 'dash' } },
      { x: [ALPHAS[0], ALPHAS[ALPHAS.length - 1]], y: [dP.lambdaT, dP.lambdaT], name: '$\\lambda_t$（PE 門檻）', mode: 'lines', line: { color: tokens.textMuted, dash: 'dot' } },
    ],
    [sweep, asym, dP.lambdaT, tokens],
  )

  return (
    <ExperimentShell
      id={EXP_B}
      title="R5 預覽 B：Near-integer FCW 的 keep-out（滑動窗口 PE）"
      level="L3"
      claim="approx"
      description={<><Tex>{'x[n]=\\mathrm{frac}(n\\alpha+\\varphi_0)-\\tfrac12'}</Tex>，<Tex>{'\\mathbf u=[x,1]^T'}</Tex>，在所有長度 <Tex>{'N_0'}</Tex> 的窗口中找最小的 <Tex>{'\\lambda_{\\min}'}</Tex>。</>}
      assumptions={[
        String.raw`一階 DSM residue（小數 $\alpha$），$\varphi_0=0.123$；每個 $\alpha$ 取 32 個窗口起點，平均分布在一個週期內`,
        String.raw`raw-x（未經 $H_{\mathrm{PD}}$）；經 $H_{\mathrm{PD}}$ 時 offset 方向完全看不見（勘誤 E04）`,
      ]}
      params={{ N0, lambdaT: dP.lambdaT }}
      units={{ N0: 'samples', lambdaT: '—' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{ analytic: { status: Math.abs(sweep[0] / asym[0] - 1) < 0.1 ? 'ok' : 'mismatch', note: String.raw`小 $\alpha$ 時數值 vs 漸近式` }, monteCarlo: 'n/a', fixedPoint: 'n/a' }}
      actions={{ onReset: () => setP(DEF_B) }}
      presets={presets}
      onLoadPreset={(pr) => setP((prev) => mergeParams(prev, pr.params))}
      exportData={() => ({ alpha: ALPHAS, lambda_min_worst: sweep, asymptote: asym })}
      controls={
        <>
          <ParamControl {...pl('$N_0$（PE 窗口長度）', 'N0（PE 窗口長度）')} value={P.N0} onChange={(v) => setP({ ...P, N0: v })} min={16} max={4096} log integer clampOnBlur unit="samples" reg="REG_PE_WINDOW / GMAC N" />
          <ParamControl {...pl(String.raw`$\lambda_t$（要求的最小 eigenvalue）`, 'lambda_t（要求的最小 eigenvalue）')} value={P.lambdaT} onChange={(v) => setP({ ...P, lambdaT: v })} min={1e-7} max={0.08} log unit="—" reg="Design：PE 門檻" />
        </>
      }
    >
      <Plot
        title={String.raw`最差窗口 $\lambda_{\min}$ vs FCW 小數 $\alpha$（log–log：斜率 2 $\Rightarrow\lambda_{\min}\propto\alpha^2$）`}
        data={data}
        xLog
        yLog
        layout={LAYOUT_NEAR}
        height={320}
        csvName="r5-near-integer"
      />
    </ExperimentShell>
  )
}

export default function R5Preview() {
  return (
    <div className="rm-preview">
      <Prereq title={String.raw`$2\times2$ 對稱矩陣的 eigenvalue、trace 與 determinant`}>
        <p>
          <Tex>{String.raw`\mathbf R=\begin{bmatrix}a&b\\b&c\end{bmatrix}`}</Tex> 的 eigenvalue 是 <Tex>{'\\det(\\mathbf R-\\lambda\\mathbf I)=0'}</Tex> 的根：
          <Tex>{'\\lambda^2-(a+c)\\lambda+(ac-b^2)=0'}</Tex>，也就是 <Tex>{'\\lambda^2-\\mathrm{tr}\\,\\lambda+\\det=0'}</Tex>。兩根的乘積是 det、和是 trace。
          <Tex>{'\\lambda_{\\min}'}</Tex> 是「最難被激發的方向」收到多少能量（<ChRef ch="09">第 9 章</ChRef>）：它為 0 就有一個方向完全看不見。
        </p>
      </Prereq>

      <h4>A. E-optimal vs D-optimal：設計指標不是只有一個</h4>
      <StepDerivation
        steps={[
          { tex: String.raw`e=(a-w_a)\,x+(b-w_b)\,s+v\;\Rightarrow\;\mathbf u=[x,\ s]^T`, why: <>gain 誤差乘上 code，offset 誤差乘上常數（以單位尺度 <Tex>{'s'}</Tex> 表示）。</> },
          { tex: String.raw`\mathbf R=E[\mathbf u\mathbf u^T]=\begin{bmatrix}E[x^2]&sE[x]\\sE[x]&s^2\end{bmatrix}`, why: '逐項取期望值。' },
          { tex: String.raw`\det\mathbf R=s^2E[x^2]-s^2E[x]^2=s^2\,\mathrm{Var}(x)`, why: <>D-optimal 只看 <Tex>{'\\mathrm{Var}(x)'}</Tex>：code 的平均（DC）不影響。</> },
          { tex: String.raw`\lambda_{\min}=\tfrac12\Big(\mathrm{tr}\,\mathbf R-\sqrt{(\mathrm{tr}\,\mathbf R)^2-4\det\mathbf R}\Big),\quad \mathrm{tr}\,\mathbf R=E[x^2]+s^2`, why: <>E-optimal 還依賴 trace：DC 讓 <Tex>{'E[x^2]'}</Tex> 變大但 det 不變，<Tex>{'\\lambda_{\\min}'}</Tex> 變小。</> },
          { tex: String.raw`\mathbf u\to\mathbf S\mathbf u:\ \det(\mathbf S\mathbf R\mathbf S)=\det(\mathbf S)^2\det\mathbf R`, why: <>換單位（對角縮放 <Tex>{'\\mathbf S'}</Tex>）只把所有設計的 det 乘上同一個常數，D-optimal 的排名不變；<Tex>{'\\lambda_{\\min}'}</Tex> 沒有這個性質。</> },
        ]}
        result={String.raw`\det\mathbf R=s^2\,\mathrm{Var}(x)\ \text{（與 DC、單位無關的排名）},\qquad \lambda_{\min}\ \text{依賴 DC 與單位}\qquad(\text{F-R5.1})`}
      />
      <p>
        <ClaimTag kind="exact" /> 規格 R5 說 D-optimal「需處理單位與矩陣縮放」——正好相反的情況也要注意：<strong>E-optimal 才是會被單位改變排名的那一個</strong>；D-optimal 對對角縮放不變，但它可以容忍某一個方向很弱（只要另一個方向很強）。
      </p>
      <DesignExperiment />

      <h4>{mt(String.raw`B. Near-integer FCW：$\lambda_{\min}$ 隨 $\alpha^2$ 掉下去`)}</h4>
      <StepDerivation
        steps={[
          { tex: String.raw`x[n]=\mathrm{frac}(n\alpha+\varphi_0)-\tfrac12`, why: <>一階 DSM 的小數 residue（置中）；<Tex>{'\\alpha'}</Tex> 是 FCW 離整數的距離。</> },
          { tex: String.raw`\alpha N_0<1\ \text{且窗口內沒有 wrap}:\ x[n_0+i]=x_0+i\alpha,\ i=0,\dots,N_0-1`, why: '短窗口裡 residue 只是一條緩坡。' },
          { tex: String.raw`\mathrm{Var}_{\mathrm{win}}(x)=\alpha^2\,\mathrm{Var}(i)=\alpha^2\frac{N_0^2-1}{12}`, why: <>離散均勻 <Tex>{'\\{0,\\dots,N_0-1\\}'}</Tex> 的變異數。</> },
          { tex: String.raw`\det\mathbf R_{\mathrm{win}}=\mathrm{Var}_{\mathrm{win}}(x),\qquad \mathrm{tr}\,\mathbf R_{\mathrm{win}}=1+\mathrm{Var}_{\mathrm{win}}+\bar x^2`, why: <>上面 A 的結果，<Tex>{'s=1'}</Tex>。</> },
          { tex: String.raw`\lambda_{\min}=\frac{\mathrm{tr}}2\Big(1-\sqrt{1-\tfrac{4\det}{\mathrm{tr}^2}}\Big)\approx\frac{\det}{\mathrm{tr}}`, why: <><Tex>{'\\sqrt{1-\\epsilon}\\approx1-\\epsilon/2'}</Tex>（泰勒一階），因為 <Tex>{'\\det\\ll\\mathrm{tr}^2'}</Tex>。</> },
          { tex: String.raw`\text{最差窗口 }\bar x\to\pm\tfrac12:\ \mathrm{tr}\approx\tfrac54`, why: '窗口正好在 wrap 之前或之後，平均最偏。' },
        ]}
        result={String.raw`\lambda_{\min}\approx\frac{\alpha^2(N_0^2-1)}{15}\quad\Rightarrow\quad \alpha_{\mathrm{keep}}=\sqrt{\frac{15\,\lambda_t}{N_0^2-1}}\qquad(\text{F-R5.2})`}
      />
      <p>
        <ClaimTag kind="approx" /> 在 <Tex>{'\\alpha N_0\\ll1'}</Tex> 時成立（下方實驗以數值驗證）。keep-out 與 <Tex>{'1/N_0'}</Tex> 成正比：PE 窗口加長 16 倍，keep-out 縮小 16 倍。
        <ErratumNote eid="E04">{String.raw`經 $H_{\mathrm{PD}}$（DC null）觀測時，offset 方向在穩態完全不可觀察，這裡的 $\lambda_{\min}$ 是 raw-x 的上限。`}</ErratumNote>
      </p>
      <HandCalc def={roadmapHandCalc('HC-RM.5')} />
      <NearIntExperiment />
      <TryIt
        items={[
          <>A：把 <Tex>{'m'}</Tex> 從 0.3 拉到 0：det 不動、<Tex>{'\\lambda_{\\min}'}</Tex> 上升——置中只對 E-optimal 有用。</>,
          String.raw`A：右圖中 $\det$ 的比值是水平線，$\lambda_{\min}$ 的比值卻會穿過 1：換個單位，「哪個 training code 比較好」的答案就變了（E-optimal）。`,
          <>B：把 <Tex>{'N_0'}</Tex> 從 256 改成 4096，曲線整體左移（keep-out 變窄）；<Tex>{'\\lambda_t'}</Tex> 設太大時會出現「regressor 本身的資訊上限」警告。</>,
        ]}
      />
      <Observe>
        R5 的研究是把這些指標放進真正的約束（DTC range、spur、jitter、training time）裡最佳化，並在 Training Sequence Lab（規格 §19）中以 FCW / DSM pattern / code randomization 實際量測。
      </Observe>
      <h4>核心程式碼</h4>
      <CodeCompare
        items={[
          { label: 'E / D 指標', source: modelSrc, region: 'designMetrics', path: PATH, note: 'eigSym 的最小值與乘積。' },
          { label: '滑動窗口的最小 eigenvalue', source: modelSrc, region: 'windowLambdaMin', path: PATH, note: String.raw`每個窗口只要 $\sum x$ 與 $\sum x^2$。` },
        ]}
        layout="tabs"
      />
      <ModeGate min="research">
        <h4>Research：E 與 D 以外</h4>
        <p>
          A-optimal（最小化 <Tex>{'\\mathrm{tr}\\,\\mathbf R^{-1}'}</Tex>，即平均參數變異）直接對應 preconditioned LMS 的總雜訊（R4 的 <Tex>{'\\sum\\mathrm{Var}_i\\propto\\sum1/\\lambda_i'}</Tex>）；它和 E-optimal 一樣受單位影響。<ErratumNote eid="E23">PE / mean 收斂與 mean-square 是不同的問題。</ErratumNote> <ClaimTag kind="research" /> 哪個指標最貼近晶片目標，是 R5 待回答的問題。
        </p>
      </ModeGate>
    </div>
  )
}
