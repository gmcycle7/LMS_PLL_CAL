import { useDeferredValue, useMemo, useState } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import {
  ClaimTag,
  CodeCompare,
  ExperimentShell,
  HandCalc,
  ModeGate,
  ParamControl,
  Plot,
  Prereq,
  SelectControl,
  StepDerivation,
  Tex,
  useThemeTokens,
  type ExperimentPreset,
  type MetricRow,
} from '@/components'
import modelSrc from '../model.ts?raw'
import { roadmapHandCalc } from '../handcalcs'
import { comparatorMean, comparatorSlope, hysteresisStats, mcComparator, noiseCdf, noisePdf, type NoiseKind, type NoiseSpec } from '../model'
import { ErratumNote, KvTable, mergeParams, n4, Observe, pl, TryIt, useRoadmapPresets } from '../common'

const EXP_ID = 'roadmap-r6-comparator'
const PATH = 'src/pages/roadmap/model.ts'

export const NOISE_LABEL: Record<NoiseKind, string> = {
  gaussian: 'Gaussian',
  laplace: 'Laplace（重尾、尖峰）',
  uniform: 'Uniform（有界）',
  student3: 'Student-t（自由度 3，重尾）',
  dualDirac: 'Dual-Dirac DJ + Gaussian RJ',
}
const KINDS: NoiseKind[] = ['gaussian', 'laplace', 'uniform', 'student3', 'dualDirac']

interface R6Params {
  kind: NoiseKind
  sigma: number
  djFrac: number
  theta: number
  H: number
  samples: number
  seed: number
}

const DEFAULTS: R6Params = { kind: 'gaussian', sigma: 100, djFrac: 0.6, theta: 0, H: 0, samples: 4000, seed: 20261010 }

const INLINE_PRESETS: ExperimentPreset[] = [
  { name: 'Gaussian、無遲滯（第 5 章的 K_q）', params: { ...DEFAULTS } },
  { name: 'Laplace：同 RMS、斜率大 √π 倍', params: { ...DEFAULTS, kind: 'laplace' } },
  { name: 'DJ 佔 60% 變異數（dual-Dirac）', params: { ...DEFAULTS, kind: 'dualDirac', djFrac: 0.6 }, description: '中心附近 PDF 很低 ⇒ 斜率小' },
  { name: 'Gaussian + 遲滯 H = σ_v', params: { ...DEFAULTS, H: 100 }, description: '斜率變大、資訊卻變少' },
  { name: '門檻 offset θ = 20 fs', params: { ...DEFAULTS, theta: 20 }, description: 'E[q|s] 在 s = θ 才歸零 ⇒ bias' },
]

// Plot 的 layout 是靜態的：放在模組層，避免每次 render 產生新物件而觸發 Plotly.react
const LAYOUT_S: Partial<Layout> = { xaxis: { title: { text: 's / σ_v' } }, yaxis: { title: { text: 'E[q | s]' }, range: [-1.05, 1.05] } }
const LAYOUT_H: Partial<Layout> = { xaxis: { title: { text: 'H / σ_v' } }, yaxis: { title: { text: '相對值' } } }

function R6Experiment() {
  const [P, setP] = useState<R6Params>(DEFAULTS)
  const tokens = useThemeTokens()
  const presets = useRoadmapPresets(EXP_ID, INLINE_PRESETS, (pr) => setP((prev) => mergeParams(prev, pr)))
  const dP = useDeferredValue(P)
  const spec: NoiseSpec = useMemo(() => ({ kind: dP.kind, sigma: dP.sigma, djFrac: dP.djFrac }), [dP.kind, dP.sigma, dP.djFrac])
  const kqGauss = Math.sqrt(2 / Math.PI) / dP.sigma
  const sGrid = useMemo(() => Array.from({ length: 121 }, (_, i) => (-3 + i * 0.05) * dP.sigma), [dP.sigma])
  const sMc = useMemo(() => Array.from({ length: 11 }, (_, i) => (-2.5 + i * 0.5) * dP.sigma + dP.theta), [dP.sigma, dP.theta])
  const mc = useMemo(() => mcComparator({ spec, theta: dP.theta, H: dP.H, sValues: sMc, samples: Math.round(dP.samples), seed: dP.seed }), [spec, dP.theta, dP.H, sMc, dP.samples, dP.seed])
  const at = hysteresisStats(spec, dP.theta, dP.H, dP.theta)
  const info0 = kqGauss * kqGauss

  const curves: Data[] = useMemo(() => {
    const d: Data[] = KINDS.map((k, i) => ({
      x: sGrid.map((s) => s / dP.sigma),
      y: sGrid.map((s) => comparatorMean({ kind: k, sigma: dP.sigma, djFrac: dP.djFrac }, s, dP.theta)),
      name: `${NOISE_LABEL[k]}（H = 0）`,
      mode: 'lines',
      line: { color: tokens.series[i % tokens.series.length], width: k === dP.kind ? 3 : 1, dash: k === dP.kind ? 'solid' : 'dot' },
    }))
    if (dP.H > 0) {
      d.push({
        x: sGrid.map((s) => s / dP.sigma),
        y: sGrid.map((s) => hysteresisStats(spec, s, dP.H, dP.theta).mean),
        name: `${NOISE_LABEL[dP.kind]}，遲滯 H = ${dP.H} fs（Markov 解析）`,
        mode: 'lines',
        line: { color: tokens.text, width: 2, dash: 'dash' },
      })
    }
    d.push({
      x: sMc.map((s) => s / dP.sigma),
      y: mc.mean,
      name: 'Monte Carlo（95% CI）',
      mode: 'markers',
      marker: { color: tokens.text, size: 7, symbol: 'x' },
      error_y: { type: 'data', symmetric: false, array: mc.hi.map((h, i) => h - mc.mean[i]), arrayminus: mc.lo.map((l, i) => mc.mean[i] - l) },
    })
    return d
  }, [sGrid, sMc, mc, spec, dP, tokens])

  const hGrid = useMemo(() => Array.from({ length: 81 }, (_, i) => (i * 0.05) * dP.sigma), [dP.sigma])
  const infoData: Data[] = useMemo(
    () => [
      { x: hGrid.map((h) => h / dP.sigma), y: hGrid.map((h) => hysteresisStats(spec, dP.theta, h, dP.theta).info / info0), name: 'ℐ / K_q²（每 sample 資訊）', mode: 'lines', line: { color: tokens.series[0] } },
      { x: hGrid.map((h) => h / dP.sigma), y: hGrid.map((h) => hysteresisStats(spec, dP.theta, h, dP.theta).slope / kqGauss), name: '斜率 / K_q', mode: 'lines', line: { color: tokens.series[1], dash: 'dash' } },
      { x: hGrid.map((h) => h / dP.sigma), y: hGrid.map((h) => hysteresisStats(spec, dP.theta, h, dP.theta).nu), name: '記憶因子 ν', mode: 'lines', line: { color: tokens.series[2], dash: 'dot' } },
    ],
    [hGrid, spec, dP.theta, dP.sigma, info0, kqGauss, tokens],
  )

  // CDF/PDF 一致性（交叉驗證）：數值微分
  const h = 1e-4 * dP.sigma
  const cdfPdfErr = [-1.2, -0.3, 0.4, 1.1].reduce((m, t) => {
    const v = t * dP.sigma
    return Math.max(m, Math.abs((noiseCdf(spec, v + h) - noiseCdf(spec, v - h)) / (2 * h) - noisePdf(spec, v)) * dP.sigma)
  }, 0)
  const mid = 5 // sMc[5] = θ
  // 有界雜訊且 H/2 超出雜訊範圍：chain 永不翻轉，沒有平穩分布可比（不是 mismatch，是不適用）
  const stuck = !(at.tUp + at.tDown > 0)
  const mcMidOk = Math.abs(mc.mean[mid] - at.mean) <= Math.max(mc.hi[mid] - mc.mean[mid], mc.mean[mid] - mc.lo[mid]) * 2 + 0.01

  const warnings: string[] = []
  if (dP.theta !== 0)
    warnings.push(String.raw`門檻 $\theta=${dP.theta}$ fs $\ne0$：$E[q\mid s]$ 在 $s=\theta$ 才歸零，GMAC 會收斂到偏移 $\theta$ 對應的錯誤固定點（offset bias，第 11 章；架構依賴，見勘誤 E03）。`)
  if (dP.H > 0)
    warnings.push(
      String.raw`遲滯 $H=${dP.H}$ fs：相鄰決策相關（$\nu=${n4(at.nu)}$），block 平均的雜訊變異是 iid 時的 $\frac{1+\nu}{1-\nu}=${n4((1 + at.nu) / (1 - at.nu))}$ 倍——GMAC 雜訊變成有色（見 R1）。`,
    )
  if (stuck) warnings.push(String.raw`遲滯 $H/2=${dP.H / 2}$ fs 超出有界雜訊的範圍：comparator 永遠不會翻轉，輸出卡在初始狀態——沒有任何梯度資訊（$\mathcal I=0$）。`)
  if (dP.kind === 'uniform') warnings.push(String.raw`Uniform 雜訊有界：$|s-\theta|>\sqrt3\,\sigma_v$ 時 $E[q\mid s]=\pm1$、斜率為 0（完全飽和，沒有梯度資訊）。`)
  if (dP.kind === 'dualDirac' && dP.djFrac > 0.8)
    warnings.push(String.raw`DJ 佔 ${Math.round(dP.djFrac * 100)}% 變異數：中心附近 PDF 很低，小訊號斜率遠小於 Gaussian 的 $K_q$；以 RMS 換算 $K_q$ 會高估迴路增益。`)

  const metrics: MetricRow[] = [
    { name: String.raw`Gaussian 的 $K_q=\sqrt{2/\pi}/\sigma_v$`, value: kqGauss, unit: 'fs⁻¹', claim: 'approx' },
    { name: String.raw`斜率 $2f_v(0)$（${NOISE_LABEL[dP.kind]}，$H=0$）`, value: comparatorSlope(spec, dP.theta, dP.theta), unit: 'fs⁻¹', formulaId: 'F-R6.1', claim: 'exact' },
    { name: String.raw`斜率比 $2f_v(0)/K_q$`, value: comparatorSlope(spec, dP.theta, dP.theta) / kqGauss, unit: '—' },
    { name: String.raw`含遲滯的斜率（$H=${dP.H}$ fs）`, value: at.slope, unit: 'fs⁻¹', formulaId: 'F-R6.2', claim: 'exact' },
    { name: String.raw`記憶因子 $\nu=1-t_+-t_-$`, value: at.nu, unit: '—', formulaId: 'F-R6.2' },
    { name: String.raw`MC lag-1 相關（$s=\theta$）`, value: mc.lag1[mid], unit: '—', analytic: at.nu, tolerance: 0.03, claim: 'approx' },
    { name: String.raw`每 sample 資訊 $\mathcal I/K_q^2$`, value: at.info / info0, unit: '—', formulaId: 'F-R6.3', claim: 'approx', note: String.raw`$H=0$ 的 Gaussian 為 1` },
    { name: String.raw`MC 的 $E[q\mid s=\theta]$`, value: mc.mean[mid], analytic: at.mean, tolerance: 0.03, note: String.raw`95% CI $[${n4(mc.lo[mid])},\ ${n4(mc.hi[mid])}]$` },
  ]

  return (
    <ExperimentShell
      id={EXP_ID}
      title="R6 預覽：非 Gaussian 雜訊與遲滯 comparator 的 S 曲線、斜率與資訊"
      level="L1"
      claim="exact"
      source="simulation"
      description={<>同一個 RMS <Tex>{'\\sigma_v'}</Tex>，五種 PDF；遲滯 <Tex>{'H'}</Tex> 以兩狀態 Markov chain 解析，並逐 sample Monte Carlo 驗證。</>}
      assumptions={[
        String.raw`雜訊 $v$ iid、零均值、總 RMS 為 $\sigma_v$（dual-Dirac：$\pm A$ 等機率加上 Gaussian RJ）`,
        String.raw`遲滯門檻 $\theta\pm H/2$，依前一次決策而定；tie 取 $+1$（勘誤 E07）`,
        String.raw`每個 $s$ 的 Monte Carlo 逐 sample 跑 comparator（主執行緒；11 個點合計不超過 $2\times10^5$ 個 sample）`,
        'metastability 未建模（R6 待辦）',
      ]}
      params={{ kind: dP.kind, sigma: dP.sigma, djFrac: dP.djFrac, theta: dP.theta, H: dP.H, samples: dP.samples }}
      seed={P.seed}
      onSeedChange={(s) => setP({ ...P, seed: s })}
      units={{ sigma: 'fs', theta: 'fs', H: 'fs' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: { status: cdfPdfErr < 1e-5 ? 'ok' : 'mismatch', note: 'CDF 的數值微分等於 PDF' },
        monteCarlo: stuck
          ? { status: 'n/a', note: 'comparator 永不翻轉：輸出卡在初始狀態，沒有平穩分布可比' }
          : { status: mcMidOk && Math.abs(mc.lag1[mid] - at.nu) < 0.05 ? 'ok' : 'mismatch', note: String.raw`$s=\theta$ 處的 $E[q]$（95% CI 的 2 倍 $+0.01$）與 lag-1 相關（$\pm0.05$）vs Markov 解析` },
        fixedPoint: 'n/a',
      }}
      actions={{ onReset: () => setP(DEFAULTS) }}
      presets={presets}
      onLoadPreset={(pr) => setP((prev) => mergeParams(prev, pr.params))}
      exportData={() => ({ s_over_sigma: sMc.map((s) => s / dP.sigma), mc_mean_q: mc.mean, mc_lo: mc.lo, mc_hi: mc.hi, mc_lag1: mc.lag1 })}
      controls={
        <>
          <SelectControl label="雜訊 PDF" value={P.kind} onChange={(kind) => setP({ ...P, kind })} options={KINDS.map((k) => ({ value: k, label: NOISE_LABEL[k] }))} reg="Behavioral：comparator noise PDF" />
          <ParamControl {...pl(String.raw`$\sigma_v$（總 RMS）`, 'sigma_v（總 RMS）')} value={P.sigma} onChange={(v) => setP({ ...P, sigma: v })} min={1} max={1000} log unit="fs" reg="Behavioral：comparator noise σ_v" />
          <ParamControl label="DJ 佔變異數比例（dual-Dirac）" value={P.djFrac} onChange={(v) => setP({ ...P, djFrac: v })} min={0} max={0.95} step={0.01} unit="—" reg="Behavioral：DJ / total variance" disabled={P.kind !== 'dualDirac'} />
          <ParamControl {...pl(String.raw`$\theta$（門檻 offset）`, 'theta（門檻 offset）')} value={P.theta} onChange={(v) => setP({ ...P, theta: v })} min={-200} max={200} step={1} unit="fs" reg="Comparator offset（REG_CMP_OS）" />
          <ParamControl {...pl('$H$（遲滯寬度）', 'H（遲滯寬度）')} value={P.H} onChange={(v) => setP({ ...P, H: v })} min={0} max={400} step={1} unit="fs" reg="Comparator hysteresis" />
          <ParamControl label="MC samples / 點" value={P.samples} onChange={(v) => setP({ ...P, samples: v })} min={400} max={18000} integer clampOnBlur unit="samples" reg="MC：每個 s 的 sample 數" />
        </>
      }
    >
      <div className="rm-plots">
        <Plot title={String.raw`$E[q\mid s]$：五種 PDF（同 RMS）與遲滯`} data={curves} layout={LAYOUT_S} height={320} csvName="r6-s-curves" />
        <Plot title={String.raw`遲滯寬度的影響（$s=\theta$）`} data={infoData} layout={LAYOUT_H} height={320} csvName="r6-hysteresis" />
      </div>
    </ExperimentShell>
  )
}

export default function R6Preview() {
  const rows = KINDS.map((k) => {
    const spec: NoiseSpec = { kind: k, sigma: 1, djFrac: 0.6 }
    return [NOISE_LABEL[k], String.raw`$${n4(comparatorSlope(spec, 0) / Math.sqrt(2 / Math.PI))}\,K_q$`] as [string, string]
  })
  return (
    <div className="rm-preview">
      <Prereq title="PDF、CDF 與「微分就是密度」">
        <p>
          累積分布 <Tex>{'F_v(t)=P(v\\le t)'}</Tex>，機率密度 <Tex>{"f_v(t)=F_v'(t)"}</Tex>（微積分基本定理）。<Tex>{'P(v>t)=1-F_v(t)'}</Tex>。
          Gaussian 的 <Tex>{'F_v(t)=\\Phi(t/\\sigma_v)'}</Tex>，<Tex>{'f_v(0)=1/(\\sqrt{2\\pi}\\sigma_v)'}</Tex>。
        </p>
      </Prereq>
      <Prereq title="兩狀態 Markov chain">
        <p>
          狀態只有 <Tex>{'+1'}</Tex> 與 <Tex>{'-1'}</Tex>；每一步從 <Tex>{'-1'}</Tex> 跳到 <Tex>{'+1'}</Tex> 的機率 <Tex>{'t_+'}</Tex>、反向 <Tex>{'t_-'}</Tex>。
          長時間後「流進 = 流出」：<Tex>{'\\pi_+t_-=\\pi_-t_+'}</Tex>，所以 <Tex>{'\\pi_+=t_+/(t_++t_-)'}</Tex>。轉移矩陣的另一個 eigenvalue 是 <Tex>{'\\nu=1-t_+-t_-'}</Tex>，
          它就是相隔一步的相關係數；相隔 <Tex>{'k'}</Tex> 步為 <Tex>{'\\nu^k'}</Tex>。
        </p>
      </Prereq>
      <StepDerivation
        title="一步一步推導：任意 PDF 的 S 曲線與斜率"
        steps={[
          { tex: String.raw`q=\mathrm{sign}(s+v-\theta)\;\Rightarrow\;P(q=+1)=P(v>\theta-s)=1-F_v(\theta-s)`, why: <>comparator 看到誤差 <Tex>{'s'}</Tex> 加雜訊，與門檻 <Tex>{'\\theta'}</Tex> 比較。</> },
          { tex: String.raw`E[q\mid s]=(+1)P(+1)+(-1)P(-1)=1-2F_v(\theta-s)`, why: <>期望值的定義，<Tex>{'P(-1)=1-P(+1)'}</Tex>。</> },
          { tex: String.raw`\frac{dE[q\mid s]}{ds}=-2F_v'(\theta-s)\cdot(-1)=2f_v(\theta-s)`, why: '連鎖律；CDF 的導數是 PDF。' },
          { tex: String.raw`\text{Gaussian: }2f_v(0)=\frac{2}{\sqrt{2\pi}\sigma_v}=\frac{\sqrt{2/\pi}}{\sigma_v}=K_q`, why: '代回第 5 章的小訊號增益。' },
          { tex: String.raw`\text{Laplace: }\frac{\sqrt2}{\sigma_v},\quad\text{Uniform: }\frac{1}{\sqrt3\,\sigma_v},\quad t_3:\ \frac{4}{\pi\sigma_v}`, why: <>同一個 RMS，各自的 <Tex>{'f_v(0)'}</Tex>（Laplace 尺度 <Tex>{'\\sigma_v/\\sqrt2'}</Tex>、Uniform 半寬 <Tex>{'\\sqrt3\\sigma_v'}</Tex>）。</> },
        ]}
        result={String.raw`\frac{dE[q\mid s]}{ds}=2f_v(\theta-s)\qquad(\text{F-R6.1})`}
      />
      <KvTable caption="同一個 RMS 下的小訊號斜率（由 comparatorSlope 計算）" rows={rows} />
      <StepDerivation
        title="一步一步推導：遲滯 comparator 的平均與每 sample 資訊"
        steps={[
          { tex: String.raw`t_-=P(\text{+1}\to\text{-1})=F_v\big(\theta-\tfrac H2-s\big),\qquad t_+=1-F_v\big(\theta+\tfrac H2-s\big)`, why: <>目前為 <Tex>{'+1'}</Tex> 時要低於下門檻才翻轉；為 <Tex>{'-1'}</Tex> 時要高於上門檻。</> },
          { tex: String.raw`E[q]=\pi_+-\pi_-=\frac{t_+-t_-}{t_++t_-}`, why: '代入兩狀態 Markov chain 的平穩分布。' },
          { tex: String.raw`\mathrm{Corr}(q_n,q_{n+k})=\nu^k,\qquad \nu=1-t_+-t_-`, why: <><Tex>{'H=0'}</Tex> 時 <Tex>{'t_++t_-=1'}</Tex>、<Tex>{'\\nu=0'}</Tex>：回到 iid。</> },
          { tex: String.raw`\mathrm{Var}\Big(\frac1N\sum q\Big)\approx\frac{1-m^2}{N}\Big(1+2\sum_{k\ge1}\nu^k\Big)=\frac{1-m^2}{N}\cdot\frac{1+\nu}{1-\nu}`, why: <>相關樣本的平均：等比級數；<Tex>{'N'}</Tex> 遠大於相關長度 <Tex>{'1/(1-\\nu)'}</Tex>。</> },
          { tex: String.raw`\mathcal I=\frac{(dE[q]/ds)^2}{(1-m^2)(1+\nu)/(1-\nu)}`, why: <>估計 <Tex>{'s'}</Tex> 的變異約為 <Tex>{'1/(N\\mathcal I)'}</Tex>：斜率平方除以每 sample 的有效雜訊。</> },
          { tex: String.raw`s=\theta:\ \frac{dE[q]}{ds}=\frac{f_v(H/2)}{c},\quad \mathcal I=\frac{f_v(H/2)^2}{c(1-c)},\quad c=1-F_v(H/2)`, why: <>對稱 PDF 時 <Tex>{'t_+=t_-=c'}</Tex>，代入（slope 公式見下方的核心程式碼）。</> },
        ]}
        result={String.raw`\mathcal I\big|_{H=0}=4f_v(0)^2=K_q^2\ (\text{Gaussian}),\qquad \text{遲滯：斜率}\uparrow\ \text{但}\ \nu\uparrow\qquad(\text{F-R6.3})`}
      />
      <p>
        <ClaimTag kind="exact" /> S 曲線與 Markov 平穩分布在 iid 雜訊下精確；<ClaimTag kind="approx" /> <Tex>{'\\mathcal I'}</Tex> 用到大 <Tex>{'N'}</Tex> 的漸近變異。
        Gaussian 時 <Tex>{'\\mathcal I'}</Tex> 隨 <Tex>{'H'}</Tex> 單調下降（下方實驗與 model.test.ts 在 <Tex>{'H/\\sigma_v\\in[0,4]'}</Tex> 數值確認；一般 PDF 未證明 <ClaimTag kind="research" />）。
        <ErratumNote eid="E07">{String.raw`tie（輸入恰為門檻）取 $+1$ 的慣例必須寫清楚。`}</ErratumNote>
      </p>
      <HandCalc def={roadmapHandCalc('HC-RM.6')} />
      <R6Experiment />
      <TryIt
        items={[
          <>切換 PDF：同一個 <Tex>{'\\sigma_v'}</Tex>，Laplace 的 S 曲線在中心最陡、Uniform 最平且在 <Tex>{'\\pm\\sqrt3\\sigma_v'}</Tex> 外完全飽和。</>,
          <>選 Gaussian、把 <Tex>{'H'}</Tex> 拉到 <Tex>{'\\sigma_v'}</Tex>：虛線（遲滯）比實線更陡，但右圖的 <Tex>{'\\mathcal I'}</Tex> 下降、<Tex>{'\\nu'}</Tex> 上升。</>,
          <>設 <Tex>{'\\theta=20'}</Tex> fs：整條曲線右移，<Tex>{'E[q]=0'}</Tex> 的點不在 <Tex>{'s=0'}</Tex>——這就是 offset bias。</>,
        ]}
      />
      <Observe>
        用量測到的 RMS 換算 <Tex>{'K_q'}</Tex> 可能高估或低估迴路增益數倍；R6 的工作是由量測的 S 曲線直接估計斜率，並處理 metastability 與 outlier。
      </Observe>
      <h4>核心程式碼：一般 comparator vs 遲滯 comparator</h4>
      <CodeCompare
        items={[
          { label: '一般 comparator', source: modelSrc, region: 'comparatorStep', path: PATH, note: '與前一次決策無關。' },
          { label: '遲滯 comparator', source: modelSrc, region: 'hysteresisStep', path: PATH, note: '門檻依前一次決策而定。' },
          { label: 'Markov 解析', source: modelSrc, region: 'hysteresisMarkov', path: PATH, note: '平均、記憶因子、斜率與資訊。' },
        ]}
      />
      <ModeGate min="research">
        <h4>Research：robust GMAC</h4>
        <p>
          impulsive noise 下可在 GMAC 前加 clipping：<Tex>{'\\psi_\\delta(e)'}</Tex>（Huber）在 <Tex>{'|e|\\le\\delta'}</Tex> 時像 LMS、之外像 Sign-LMS。1-bit comparator 本身就是 <Tex>{'\\delta\\to0'}</Tex> 的極端，
          所以「robust」與「資訊量」之間的取捨要用同一個 <Tex>{'\\mathcal I'}</Tex> 架構比較。<ClaimTag kind="research" /> 未實作。
        </p>
      </ModeGate>
    </div>
  )
}
