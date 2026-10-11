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
  StepDerivation,
  Tex,
  useThemeTokens,
  type ExperimentPreset,
  type MetricRow,
} from '@/components'
import modelSrc from '../model.ts?raw'
import { roadmapHandCalc } from '../handcalcs'
import { kalmanSteady, MC_BURN_CAP, optimalTrackingGain, simulateTracking, trackingVariance } from '../model'
import { ErratumNote, mergeParams, mt, n4, Observe, PageRef, pl, TryIt, useRoadmapPresets } from '../common'

const EXP_ID = 'roadmap-r8-tracking'
const PATH = 'src/pages/roadmap/model.ts'

interface R8Params {
  sigmaV: number
  N: number
  C: number
  sigmaZeta: number
  mu: number
  chains: number
  blocks: number
  seed: number
}

const DEFAULTS: R8Params = { sigmaV: 100, N: 4096, C: 1, sigmaZeta: 0.01, mu: 10, chains: 16, blocks: 4000, seed: 20261010 }

const INLINE_PRESETS: ExperimentPreset[] = [
  { name: 'T13 的 μ = 10 fs、漂移 0.01 fs/block', params: { ...DEFAULTS }, description: 'μ 太大：追得上，但被雜訊推著走' },
  { name: '漂移很快 σ_ζ = 0.5 fs/block', params: { ...DEFAULTS, sigmaZeta: 0.5 }, description: '最佳 μ 變大' },
  { name: '幾乎不漂移 σ_ζ = 1e-4 fs/block', params: { ...DEFAULTS, sigmaZeta: 1e-4, mu: 0.1 }, description: '最佳 μ 很小（趨近 freeze）' },
]

// Plot 的 layout 是靜態的：放在模組層，避免每次 render 產生新物件而觸發 Plotly.react
const LAYOUT_TRACK: Partial<Layout> = { xaxis: { title: { text: '$\\mu$ [fs]' } }, yaxis: { title: { text: 'RMS$(w^* - w)$ [fs]' } } }

function R8Experiment() {
  const [P, setP] = useState<R8Params>(DEFAULTS)
  const tokens = useThemeTokens()
  const presets = useRoadmapPresets(EXP_ID, INLINE_PRESETS, (pr) => setP((prev) => mergeParams(prev, pr)))
  const dP = useDeferredValue(P)
  const K = (Math.sqrt(2 / Math.PI) / dP.sigmaV) * dP.C
  const sigmaEta2 = 1 / dP.N
  const sy2 = sigmaEta2 / (K * K)
  const sz2 = dP.sigmaZeta * dP.sigmaZeta
  const gStar = optimalTrackingGain(sz2, sy2)
  const kal = kalmanSteady(sz2, sy2)
  const muStar = gStar / K
  const g = dP.mu * K
  const Vcur = trackingVariance(g, sz2, sy2)
  const muApprox = dP.sigmaZeta / Math.sqrt(sigmaEta2)

  const muGrid = useMemo(() => {
    const lo = muStar / 300
    const hi = Math.min((1.999 / K) * 0.999, muStar * 300)
    return Array.from({ length: 160 }, (_, i) => lo * (hi / lo) ** (i / 159))
  }, [muStar, K])
  const curve = useMemo(() => muGrid.map((m) => Math.sqrt(trackingVariance(m * K, sz2, sy2))), [muGrid, K, sz2, sy2])
  const mcCur = useMemo(() => (g > 0 && g < 2 ? simulateTracking({ g, sz2, sy2, chains: Math.round(dP.chains), blocks: Math.round(dP.blocks), seed: dP.seed }) : null), [g, sz2, sy2, dP.chains, dP.blocks, dP.seed])
  const mcOpt = useMemo(() => simulateTracking({ g: gStar, sz2, sy2, chains: Math.round(dP.chains), blocks: Math.round(dP.blocks), seed: dP.seed + 1 }), [gStar, sz2, sy2, dP.chains, dP.blocks, dP.seed])

  const inCi = (mc: { meanSq: number; lo: number; hi: number } | null, th: number) => !!mc && th >= mc.lo - 0.03 * th && th <= mc.hi + 0.03 * th
  const curUsable = !!mcCur && mcCur.burnInAdequate
  const optUsable = mcOpt.burnInAdequate

  const warnings: string[] = []
  if (!(g > 0 && g < 2)) warnings.push(String.raw`$g=\mu K=${n4(g)}$ 不在 $(0,2)$：固定增益的追蹤迴路不穩定，沒有穩態誤差。`)
  else if (Vcur > 4 * kal.Pprior)
    warnings.push(String.raw`目前 $\mu$ 的穩態 RMS 是最佳值的 ${n4(Math.sqrt(Vcur / kal.Pprior))} 倍：` + (dP.mu > muStar ? String.raw`$\mu$ 太大，被 GMAC 雜訊推著走。` : String.raw`$\mu$ 太小，追不上漂移。`))
  if (!optUsable || (mcCur && !mcCur.burnInAdequate))
    warnings.push(
      String.raw`追蹤迴路太慢：時間常數 $\tau\approx1/g$ 的 5 倍超過 burn-in 上限 ${MC_BURN_CAP} blocks（$g^*=${n4(gStar)}$ 時 $\tau\approx${n4(mcOpt.tauBlocks)}$ blocks）。誤差從 0 出發還沒到穩態，Monte Carlo 會偏低——這些欄位不拿來判定，請看解析值。`,
    )

  const metrics: MetricRow[] = [
    { name: '$K=K_qC$', value: K, unit: String.raw`$\mathrm{fs}^{-1}$` },
    { name: String.raw`$\sigma_y^2=\sigma_\eta^2/K^2$（等效量測雜訊）`, value: sy2, unit: String.raw`$\mathrm{fs}^2$` },
    { name: '最佳固定增益 $g^*$', value: gStar, unit: '—', formulaId: 'F-R8.1', claim: 'exact' },
    { name: String.raw`穩態 Kalman 增益 $K_\infty=\frac{P^-}{P^-+\sigma_y^2}$`, value: kal.gain, unit: '—', analytic: gStar, tolerance: 1e-12, toleranceMode: 'rel', formulaId: 'F-R8.1', claim: 'exact' },
    { name: String.raw`最佳步長 $\mu^*=g^*/K$`, value: muStar, unit: 'fs' },
    { name: String.raw`第 14 章近似 $\mu^*\approx\sigma_\zeta/\sigma_\eta$（F-14.13）`, value: muApprox, unit: 'fs', analytic: muStar, tolerance: 0.05, toleranceMode: 'rel', claim: 'approx', note: String.raw`小 $\sigma_\zeta$ 時成立` },
    { name: String.raw`最佳穩態 RMS $\sqrt{P^-}$`, value: Math.sqrt(kal.Pprior), unit: 'fs', claim: 'exact' },
    { name: String.raw`目前 $\mu=${dP.mu}$ fs 的穩態 RMS`, value: Math.sqrt(Vcur), unit: 'fs' },
    {
      name: String.raw`MC：目前 $\mu$ 的 $E[e^2]$`,
      value: mcCur?.meanSq ?? null,
      unit: String.raw`$\mathrm{fs}^2$`,
      analytic: curUsable && Number.isFinite(Vcur) ? Vcur : undefined,
      tolerance: curUsable && mcCur ? Math.max(mcCur.hi - mcCur.meanSq, mcCur.meanSq - mcCur.lo) + 0.03 * Vcur : undefined,
      claim: 'approx',
      note: mcCur ? String.raw`95% CI $[${n4(mcCur.lo)},\ ${n4(mcCur.hi)}]$，burn-in ${mcCur.burnIn}${mcCur.burnInAdequate ? '' : '：不足，不判定'}` : '不穩定，未模擬',
    },
    {
      name: String.raw`MC：$\mu^*$ 的 $E[e^2]$`,
      value: mcOpt.meanSq,
      unit: String.raw`$\mathrm{fs}^2$`,
      analytic: optUsable ? kal.Pprior : undefined,
      tolerance: optUsable ? Math.max(mcOpt.hi - mcOpt.meanSq, mcOpt.meanSq - mcOpt.lo) + 0.03 * kal.Pprior : undefined,
      claim: 'approx',
      note: String.raw`95% CI $[${n4(mcOpt.lo)},\ ${n4(mcOpt.hi)}]$，burn-in ${mcOpt.burnIn}${mcOpt.burnInAdequate ? '' : '：不足，不判定'}`,
    },
  ]

  const data: Data[] = useMemo(
    () => [
      { x: muGrid, y: curve, name: '穩態 RMS $\\sqrt{V(\\mu K)}$', mode: 'lines', line: { color: tokens.series[0] } },
      { x: [muStar], y: [Math.sqrt(kal.Pprior)], name: '$\\mu^*$（= 穩態 Kalman）', mode: 'markers', marker: { size: 12, symbol: 'star', color: tokens.series[1] } },
      ...(Number.isFinite(Vcur) ? [{ x: [dP.mu], y: [Math.sqrt(Vcur)], name: '目前 $\\mu$', mode: 'markers', marker: { size: 10, symbol: 'diamond', color: tokens.series[2] } } as Data] : []),
      ...(mcCur ? [{ x: [dP.mu], y: [Math.sqrt(mcCur.meanSq)], name: 'MC（目前 $\\mu$）', mode: 'markers', marker: { size: 8, symbol: 'x', color: tokens.text } } as Data] : []),
      { x: [muStar], y: [Math.sqrt(mcOpt.meanSq)], name: 'MC（$\\mu^*$）', mode: 'markers', marker: { size: 8, symbol: 'x', color: tokens.text } },
    ],
    [muGrid, curve, muStar, kal.Pprior, Vcur, dP.mu, mcCur, mcOpt, tokens],
  )

  return (
    <ExperimentShell
      id={EXP_ID}
      title="R8 預覽：random-walk 追蹤的最佳固定步長就是穩態 Kalman 增益"
      level="L1"
      claim="exact"
      source="simulation"
      description={<>目標 <Tex>{'w^*'}</Tex> 每 block 隨機漂移 <Tex>{'\\sigma_\\zeta'}</Tex>；固定 <Tex>{'\\mu'}</Tex> 的 LMS 穩態誤差 <Tex>{'V(g)'}</Tex> 有唯一最小值。</>}
      assumptions={[
        String.raw`線性化 GMAC：$G\approx K(w^*-w)+\eta$，$\sigma_\eta^2=1/N$（Gaussian 小訊號）`,
        String.raw`$w^*_{k+1}=w^*_k+\zeta_k$，$\zeta$ iid、與 $\eta$ 獨立`,
        '量的是更新前（prior）誤差；無更新延遲',
        String.raw`Monte Carlo 在主執行緒執行：burn-in 取 $20\tau$、上限 ${MC_BURN_CAP} blocks；不足 $5\tau$ 時不判定`,
      ]}
      params={{ ...P }}
      seed={P.seed}
      onSeedChange={(s) => setP({ ...P, seed: s })}
      units={{ sigmaV: 'fs', sigmaZeta: 'fs/block', mu: 'fs', N: 'samples' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: { status: Math.abs(kal.gain - gStar) <= 1e-12 * gStar ? 'ok' : 'mismatch', note: String.raw`$dV/dg=0$ 的根 vs Riccati 的穩態增益` },
        monteCarlo:
          optUsable && (mcCur === null || curUsable)
            ? { status: inCi(mcOpt, kal.Pprior) && (mcCur === null || inCi(mcCur, Vcur)) ? 'ok' : 'mismatch', note: String.raw`解析 $V$ 在 MC 95% CI（$\pm3\%$）內` }
            : { status: 'n/a', note: String.raw`burn-in 不足 $5\tau$：不判定` },
        fixedPoint: 'not-implemented',
      }}
      actions={{ onReset: () => setP(DEFAULTS) }}
      presets={presets}
      onLoadPreset={(pr) => setP((prev) => mergeParams(prev, pr.params))}
      exportData={() => ({ mu_fs: muGrid, rms_fs: curve })}
      controls={
        <>
          <ParamControl {...pl(String.raw`$\sigma_v$`, 'sigma_v')} value={P.sigmaV} onChange={(v) => setP({ ...P, sigmaV: v })} min={1} max={1000} log unit="fs" reg="Behavioral：comparator noise" />
          <ParamControl {...pl('$N$（GMAC block）', 'N（GMAC block）')} value={P.N} onChange={(v) => setP({ ...P, N: v })} min={16} max={65536} log integer clampOnBlur unit="samples" reg="REG_GMAC_N" />
          <ParamControl {...pl('$C$', 'C')} value={P.C} onChange={(v) => setP({ ...P, C: v })} min={0.01} max={2} step={0.01} unit="—" reg="Behavioral：C = E[x·u]" />
          <ParamControl {...pl(String.raw`$\sigma_\zeta$（每 block 漂移）`, 'sigma_zeta（每 block 漂移）')} value={P.sigmaZeta} onChange={(v) => setP({ ...P, sigmaZeta: v })} min={1e-5} max={2} log unit="fs/block" reg="Behavioral：PVT random walk" />
          <ParamControl {...pl(String.raw`$\mu$（目前設計）`, 'mu（目前設計）')} value={P.mu} onChange={(v) => setP({ ...P, mu: v })} min={1e-4} max={400} log unit="fs" reg="REG_GAIN_STEP（μ）" />
          <ParamControl label="MC chains" value={P.chains} onChange={(v) => setP({ ...P, chains: v })} min={4} max={24} integer clampOnBlur unit="chains" reg="MC：獨立 chain 數" />
          <ParamControl label="MC blocks / chain" value={P.blocks} onChange={(v) => setP({ ...P, blocks: v })} min={500} max={4000} integer clampOnBlur unit="blocks" reg="MC：每條 chain 的 block 數" />
        </>
      }
    >
      <Plot title={String.raw`穩態追蹤誤差 RMS vs $\mu$（log–log）`} data={data} xLog yLog layout={LAYOUT_TRACK} height={320} csvName="r8-tracking" />
    </ExperimentShell>
  )
}

export default function R8Preview() {
  return (
    <div className="rm-preview">
      <Prereq title="Kalman filter 只用到一個想法：把兩個估計按變異數加權">
        <p>
          有兩個獨立的估計：預測值（變異數 <Tex>{'P^-'}</Tex>）與量測（變異數 <Tex>{'\\sigma_y^2'}</Tex>）。以權重 <Tex>{'k'}</Tex> 混合，
          新的變異數 <Tex>{'(1-k)^2P^-+k^2\\sigma_y^2'}</Tex> 對 <Tex>{'k'}</Tex> 微分等於 0，得 <Tex>{'k=P^-/(P^-+\\sigma_y^2)'}</Tex>，混合後變異數 <Tex>{'(1-k)P^-'}</Tex>。
          random walk 再讓下一步的預測變異數加上 <Tex>{'\\sigma_\\zeta^2'}</Tex>。這就是 scalar Kalman 的全部。
        </p>
      </Prereq>
      <StepDerivation
        title={mt(String.raw`一步一步推導：固定步長 LMS 的追蹤誤差與最佳 $\mu$`)}
        steps={[
          { tex: String.raw`w^*_{k+1}=w^*_k+\zeta_k,\qquad G_k=K(w^*_k-w_k)+\eta_k,\qquad w_{k+1}=w_k+\mu G_k`, why: '漂移的目標、線性化 GMAC（第 12、14 章）。' },
          { tex: String.raw`e_k=w^*_k-w_k:\quad e_{k+1}=(1-g)\,e_k-\mu\eta_k+\zeta_k,\quad g=\mu K`, why: '相減；漂移與 GMAC 雜訊兩個獨立的驅動。' },
          { tex: String.raw`V=(1-g)^2V+\mu^2\sigma_\eta^2+\sigma_\zeta^2\;\Rightarrow\;V(g)=\frac{\sigma_\zeta^2+g^2\sigma_y^2}{g(2-g)},\quad \sigma_y^2=\frac{\sigma_\eta^2}{K^2}`, why: <>兩邊取變異數（三項獨立）；<Tex>{'\\mu=g/K'}</Tex>，<Tex>{'1-(1-g)^2=g(2-g)'}</Tex>。</> },
          { tex: String.raw`\frac{dV}{dg}=0\iff 2g\sigma_y^2\,g(2-g)=(\sigma_\zeta^2+g^2\sigma_y^2)(2-2g)`, why: '商的導數，分子為零。' },
          { tex: String.raw`\iff \sigma_y^2g^2+\sigma_\zeta^2g-\sigma_\zeta^2=0`, why: <>展開後 <Tex>{'g^3'}</Tex> 項相消，剩二次方程。</> },
          { tex: String.raw`g^*=\frac{\sqrt{\sigma_\zeta^4+4\sigma_\zeta^2\sigma_y^2}-\sigma_\zeta^2}{2\sigma_y^2}`, why: '取正根。' },
          { tex: String.raw`P^-=\frac{P^-\sigma_y^2}{P^-+\sigma_y^2}+\sigma_\zeta^2\;\Rightarrow\;P^-=\frac{\sigma_\zeta^2+\sqrt{\sigma_\zeta^4+4\sigma_\zeta^2\sigma_y^2}}{2}`, why: <>穩態 Kalman：更新後變異數 <Tex>{'(1-k)P^-=P^-\\sigma_y^2/(P^-+\\sigma_y^2)'}</Tex>，再加漂移 <Tex>{'\\sigma_\\zeta^2'}</Tex>。</> },
          { tex: String.raw`\frac{P^-}{P^-+\sigma_y^2}=g^*,\qquad V(g^*)=P^-`, why: <>令 <Tex>{'s=\\sqrt{\\sigma_\\zeta^4+4\\sigma_\\zeta^2\\sigma_y^2}'}</Tex>，交叉相乘：<Tex>{'(s-\\sigma_\\zeta^2)(s+\\sigma_\\zeta^2+2\\sigma_y^2)=2\\sigma_y^2(s+\\sigma_\\zeta^2)'}</Tex>。</> },
        ]}
        result={String.raw`g^*=K_\infty=\frac{P^-}{P^-+\sigma_y^2}<1,\qquad V_{\min}=P^-\qquad(\text{F-R8.1})`}
      />
      <p>
        <ClaimTag kind="exact" /> 在線性、Gaussian 小訊號模型下，「最佳的固定步長 LMS」就是「穩態的 Kalman filter」；而且 <Tex>{'g^*<1'}</Tex>（因為 <Tex>{'s<\\sigma_\\zeta^2+2\\sigma_y^2'}</Tex>），
        自動滿足 <Tex>{'PM>60^\\circ'}</Tex>。小 <Tex>{'\\sigma_\\zeta'}</Tex> 時 <Tex>{'g^*\\approx\\sigma_\\zeta/\\sigma_y'}</Tex>，即 <PageRef id="ch14">第 14 章</PageRef> F-14.13 的 <Tex>{'\\mu^*\\approx\\sigma_\\zeta/\\sigma_\\eta'}</Tex>。
        <ErratumNote eid="E48">{String.raw`§14 的 $E[\delta_B^2]$ 公式在大 $|\delta_0|/\sigma_v$ 時對 Sign-LMS 失效；這裡只談穩態追蹤。`}</ErratumNote>
      </p>
      <HandCalc def={roadmapHandCalc('HC-RM.8')} />
      <R8Experiment />
      <TryIt
        items={[
          <>預設（T13 的 <Tex>{'\\mu=10'}</Tex> fs）：比最佳 <Tex>{'\\mu^*'}</Tex> 大很多，RMS 被 GMAC 雜訊主導。</>,
          <>把 <Tex>{'\\sigma_\\zeta'}</Tex> 拉到 0.5 fs/block：星號往右移（漂移快就要大步長），第 14 章的近似開始失準。</>,
          String.raw`把 $\mu$ 設到曲線左側：RMS 由「追不上漂移」主導——曲線左右兩側的斜率是 $-\tfrac12$ 與 $+\tfrac12$。`,
        ]}
      />
      <Observe>
        背景追蹤的 <Tex>{'\\mu'}</Tex> 有明確的最佳值，前提是知道 <Tex>{'\\sigma_\\zeta'}</Tex>（PVT 漂移）與 <Tex>{'K'}</Tex>。R8 的待辦：1-bit 觀測（非線性）下的 Kalman 類估計、leaky LMS / RLS 在 PE 不足時的取捨、freeze 與 reacquisition 的切換準則。
      </Observe>
      <h4>核心程式碼：固定步長 vs Kalman，只差增益那一行</h4>
      <CodeCompare
        items={[
          { label: '固定步長 LMS', source: modelSrc, region: 'lmsTrackStep', path: PATH, note: '$g$ 是設計時決定的常數。' },
          { label: 'Scalar Kalman', source: modelSrc, region: 'kalmanTrackStep', path: PATH, note: '增益由誤差變異數 $P$ 每步算出。' },
          { label: '解析：穩態誤差與最佳增益', source: modelSrc, region: 'kalmanSteady', path: PATH, note: '二次方程的正根就是穩態 Kalman 增益。' },
        ]}
      />
      <ModeGate min="research">
        <h4>Research：1-bit 觀測與多參數</h4>
        <p>
          Sign-GMAC 的觀測是 <Tex>{'q=\\mathrm{sign}(\\cdot)'}</Tex>，Kalman 的線性 Gaussian 假設只在 <Tex>{'|C\\delta|\\ll\\sigma_v'}</Tex> 時近似成立；大誤差時更新量被 <Tex>{'\\mu'}</Tex> 截斷（slew，見 R10）。
          多參數時 Kalman 的增益矩陣 <Tex>{'\\mathbf P^-\\mathbf H^T(\\mathbf H\\mathbf P^-\\mathbf H^T+\\mathbf R_y)^{-1}'}</Tex> 會自動做 R4 的 preconditioning，但 PE 不足時 <Tex>{'\\mathbf P^-'}</Tex> 的弱方向會無限長大（需要 leaky / regularization）。
          <ClaimTag kind="research" /> 未實作。<ErratumNote eid="E14">mean / mean-square / almost-sure 三種穩定要分開講。</ErratumNote>
        </p>
      </ModeGate>
    </div>
  )
}
