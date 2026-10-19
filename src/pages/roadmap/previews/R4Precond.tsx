import { useDeferredValue, useMemo, useState } from 'react'
import type { Data, Layout } from 'plotly.js-cartesian-dist-min'
import {
  ClaimTag,
  CodeBlock,
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
import { eigvals } from '@/simulation/core'
import modelSrc from '../model.ts?raw'
import { roadmapHandCalc } from '../handcalcs'
import { precondSweep, regularizedPreconditioner, scalarLmsPoles, simulatePrecond } from '../model'
import { ErratumNote, mergeParams, mt, n4, Observe, pl, TryIt, useRoadmapPresets } from '../common'

const EXP_ID = 'roadmap-r4-precond'
const PATH = 'src/pages/roadmap/model.ts'

interface R4Params {
  j11: number
  j12: number
  j21: number
  j22: number
  gamma: number
  eps: number
  N: number
  muRaw: number
  seed: number
}

const DEFAULTS: R4Params = { j11: -1, j12: 2, j21: 2, j22: -1, gamma: 0.5, eps: 0.1, N: 64, muRaw: 0.2, seed: 20261010 }

const INLINE_PRESETS: ExperimentPreset[] = [
  { name: 'T18 反例 J = [[−1, 2], [2, −1]]、γ = 0.5、ε = 0.1', params: { ...DEFAULTS }, description: '對角都負，eigenvalue 卻是 +1、−3' },
  { name: '強相關 J = −[[1, 0.99], [0.99, 1]]（ρ = 0.99）', params: { ...DEFAULTS, j11: -1, j12: -0.99, j21: -0.99, j22: -1, eps: 0.001 }, description: 'σ_min = 0.01：ε 決定弱方向收多快、雜訊多大' },
  { name: '奇異 J（不可辨識）', params: { ...DEFAULTS, j11: -1, j12: -1, j21: -1, j22: -1, eps: 0.1 }, description: 'λ_min = 0：有一個方向完全看不見' },
]

const EPS_GRID = Array.from({ length: 61 }, (_, i) => 10 ** (-6 + i * 0.12))

// Plot 的 layout 是靜態的：放在模組層，避免每次 render 產生新物件而觸發 Plotly.react
const LAYOUT_TRADEOFF: Partial<Layout> = { xaxis: { title: { text: '95% 收斂 blocks（最慢 mode）' } }, yaxis: { title: { text: '$E\\|\\delta\\mathbf w\\|^2$' } } }
const LAYOUT_POLES: Partial<Layout> = { xaxis: { title: { text: '$\\varepsilon$' } }, yaxis: { title: { text: '$p_i$' } } }

function R4Experiment() {
  const [P, setP] = useState<R4Params>(DEFAULTS)
  const tokens = useThemeTokens()
  const presets = useRoadmapPresets(EXP_ID, INLINE_PRESETS, (pr) => setP((prev) => mergeParams(prev, pr)))
  const dP = useDeferredValue(P)
  const J = useMemo(
    () => [
      [dP.j11, dP.j12],
      [dP.j21, dP.j22],
    ],
    [dP.j11, dP.j12, dP.j21, dP.j22],
  )
  const sigmaEta2 = 1 / dP.N
  const res = useMemo(() => regularizedPreconditioner({ J, gamma: dP.gamma, eps: dP.eps, sigmaEta2 }), [J, dP.gamma, dP.eps, sigmaEta2])
  const mc = useMemo(() => (res.slowest < 1 ? simulatePrecond({ J, gamma: dP.gamma, eps: dP.eps, sigmaEta2, chains: 16, blocks: 3000, seed: dP.seed }) : null), [res.slowest, J, dP.gamma, dP.eps, sigmaEta2, dP.seed])
  const sweep = useMemo(() => precondSweep({ J, gamma: dP.gamma, sigmaEta2, epsGrid: EPS_GRID }), [J, dP.gamma, sigmaEta2])
  const raw = useMemo(() => scalarLmsPoles(J, dP.muRaw), [J, dP.muRaw])
  const rawRho = Math.max(...raw.map((z) => Math.hypot(z.re, z.im)))
  const eigJ = useMemo(() => eigvals(J), [J])
  const indefinite = eigJ.some((z) => z.re > 1e-12) && eigJ.some((z) => z.re < -1e-12)

  const sortedPoles = [...res.poles].sort((a, b) => b - a)
  const eigErr = Math.max(...res.polesEig.map((p, i) => Math.abs(p - sortedPoles[i])))
  const lyapOk = res.totalVarLyap !== null && Math.abs(res.totalVarLyap - res.totalVar) <= 1e-9 * Math.max(res.totalVar, 1e-300)
  const mcOk = mc ? res.totalVar >= mc.lo - 0.03 * res.totalVar && res.totalVar <= mc.hi + 0.03 * res.totalVar : false

  const warnings: string[] = []
  if (res.nullDirs > 0)
    warnings.push(
      String.raw`$\lambda_{\min}=0$（$\sigma_{\min}=0$）：有 ${res.nullDirs} 個方向不可辨識。該 mode 的 pole 為 1（不收斂、也不被雜訊推動），$\varepsilon$ 與 $\gamma$ 都救不回缺少的資訊；需要改 regressor / training sequence（R5）。`,
    )
  if (!(dP.gamma > 0 && dP.gamma < 2)) warnings.push(String.raw`$\gamma=${dP.gamma}$ 不在 $(0,2)$：理想模型下最快 mode 的 pole $1-\gamma\sigma^2/(\sigma^2+\varepsilon)$ 會落到 $-1$ 以外。`)
  if (rawRho >= 1)
    warnings.push(
      String.raw`對照組 $\mathbf M=\mu\mathbf I$（$\mu=${dP.muRaw}$）：$\rho(\mathbf I+\mu\mathbf J)=${n4(rawRho)}\ge1$，發散。` +
        (indefinite ? String.raw`$\mathbf J$ 的 eigenvalue 實部有正有負（不定），任何純量 $\mu$（正或負）都不可能讓所有 $|1+\mu\lambda_i|<1$——每個 loop 單獨看都對，合起來卻錯（T18）。` : ''),
    )

  const metrics: MetricRow[] = [
    { name: String.raw`$\sigma_1,\ \sigma_2$（singular values）`, value: res.sv.map((s) => n4(s)).join(', '), unit: '—' },
    { name: String.raw`poles（封閉式）$p_i=1-\gamma\frac{\sigma_i^2}{\sigma_i^2+\varepsilon}$`, value: res.poles.map((p) => n4(p)).join(', '), formulaId: 'F-R4.1', claim: 'exact' },
    { name: String.raw`封閉式與 $\mathrm{eig}(\mathbf I+\mathbf M\mathbf J)$ 的最大差`, value: eigErr, analytic: 0, tolerance: 1e-10 },
    { name: '最慢 pole', value: res.slowest, unit: '—' },
    { name: '95% 收斂 blocks', value: Number.isFinite(res.settle) ? res.settle : '不收斂（pole 為 1）', unit: 'blocks' },
    { name: String.raw`每個 mode 的穩態變異 $\mathrm{Var}_i$`, value: res.modeVar.map((v) => n4(v)).join(', '), unit: String.raw`$[w]^2$`, formulaId: 'F-R4.1', claim: 'exact' },
    { name: String.raw`$E\|\delta\mathbf w\|^2$（封閉式）`, value: res.totalVar, unit: String.raw`$[w]^2$`, claim: 'exact' },
    {
      name: String.raw`$E\|\delta\mathbf w\|^2$（Lyapunov trace）`,
      value: res.totalVarLyap,
      unit: String.raw`$[w]^2$`,
      analytic: res.totalVar,
      tolerance: 1e-9,
      toleranceMode: 'rel',
      note: res.totalVarLyap === null ? '有 pole 等於 1：Lyapunov 無唯一解' : undefined,
    },
    {
      name: String.raw`$E\|\delta\mathbf w\|^2$（Monte Carlo）`,
      value: mc?.meanSq ?? null,
      unit: String.raw`$[w]^2$`,
      analytic: res.totalVar,
      tolerance: mc ? Math.max(mc.hi - mc.meanSq, mc.meanSq - mc.lo) + 0.03 * res.totalVar : undefined,
      claim: 'approx',
      note: mc ? String.raw`95% CI $[${n4(mc.lo)},\ ${n4(mc.hi)}]$（16 chains，每條 3000 blocks）` : String.raw`最慢 pole $\ge1$：不跑 MC`,
    },
    { name: String.raw`對照：$\mathbf M=\mu\mathbf I$ 的 $\rho(\mathbf I+\mu\mathbf J)$（$\mu=${dP.muRaw}$）`, value: rawRho, unit: '—', note: rawRho >= 1 ? '發散' : '收斂' },
  ]

  const tradeoff: Data[] = useMemo(() => {
    const ok = sweep.settle.map((s) => Number.isFinite(s))
    return [
      {
        x: sweep.settle.filter((_, i) => ok[i]),
        y: sweep.totalVar.filter((_, i) => ok[i]),
        text: sweep.eps.filter((_, i) => ok[i]).map((e) => `$\\varepsilon$ = ${e.toExponential(2)}`),
        name: '$\\varepsilon$ 由 1e-6 掃到 1e1',
        mode: 'lines+markers',
        marker: { size: 4 },
        line: { color: tokens.series[0] },
      },
      ...(Number.isFinite(res.settle)
        ? [{ x: [res.settle], y: [res.totalVar], name: `目前 $\\varepsilon$ = ${dP.eps}`, mode: 'markers', marker: { size: 12, color: tokens.series[1], symbol: 'diamond' } } as Data]
        : []),
    ]
  }, [sweep, res, dP.eps, tokens])
  const poleData: Data[] = useMemo(() => {
    const modes = sweep.eps.map((eps) => regularizedPreconditioner({ J, gamma: dP.gamma, eps, sigmaEta2 }).poles)
    return [0, 1].map((i) => ({ x: sweep.eps, y: modes.map((m) => m[i]), name: `mode ${i + 1}（$\\sigma$ = ${n4(res.sv[i] ?? NaN)}）`, mode: 'lines', line: { color: tokens.series[2 + i] } }))
  }, [sweep, J, dP.gamma, sigmaEta2, res.sv, tokens])

  return (
    <ExperimentShell
      id={EXP_ID}
      title="R4 預覽：Regularized preconditioner 的收斂–雜訊取捨"
      level="L3"
      claim="exact"
      source="simulation"
      description={
        <>
          <Tex>{String.raw`\mathbf M=-\gamma(\mathbf J^T\mathbf J+\varepsilon\mathbf I)^{-1}\mathbf J^T`}</Tex>：每個 singular 方向一個 pole 與一個穩態變異；<Tex>{'\\varepsilon'}</Tex> 把慢、雜訊大的弱方向換成更慢、雜訊小。
        </>
      }
      assumptions={[
        String.raw`$\mathbf G\approx\mathbf J(\mathbf w-\mathbf w^*)+\boldsymbol\eta$，在固定點附近線性化有效（中央差分量測的 $\hat{\mathbf J}=\mathbf J$）`,
        String.raw`$\mathrm{Cov}(\boldsymbol\eta)=\sigma_\eta^2\mathbf I$，$\sigma_\eta^2=1/N$（真實 GMAC 為 $\mathbf R/N$，見第 10 章）`,
        String.raw`無更新延遲；正則化寫 $\varepsilon$（勘誤 E22）`,
      ]}
      params={{ J11: dP.j11, J12: dP.j12, J21: dP.j21, J22: dP.j22, gamma: dP.gamma, eps: dP.eps, N: dP.N, muRaw: dP.muRaw }}
      seed={P.seed}
      onSeedChange={(s) => setP({ ...P, seed: s })}
      units={{ J: '[G]/[w]', eps: '[J]²', gamma: '—' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: { status: eigErr < 1e-10 && (lyapOk || res.totalVarLyap === null) ? 'ok' : 'mismatch', note: String.raw`封閉式 vs $\mathrm{eig}(\mathbf I+\mathbf M\mathbf J)$ vs Lyapunov` },
        monteCarlo: mc ? { status: mcOk ? 'ok' : 'mismatch', note: String.raw`封閉式在 95% CI（$\pm3\%$）內` } : { status: 'n/a', note: '不收斂時不跑' },
        fixedPoint: { status: 'not-implemented', note: '預覽模型沒有定點版本（roadmap R4 的子目標：M／J 的定點係數量化）' },
      }}
      actions={{ onReset: () => setP(DEFAULTS) }}
      presets={presets}
      onLoadPreset={(pr) => setP((prev) => mergeParams(prev, pr.params))}
      exportData={() => ({ eps: sweep.eps, settle95_blocks: sweep.settle.map((s) => (Number.isFinite(s) ? s : null)), total_var: sweep.totalVar, slowest_pole: sweep.slowest })}
      controls={
        <>
          <ParamControl {...pl(String.raw`$\hat J_{11}$`, 'J11（量測 Jacobian）')} value={P.j11} onChange={(v) => setP({ ...P, j11: v })} min={-3} max={3} step={0.01} unit="—" reg="Measured Jacobian（中央差分）" />
          <ParamControl {...pl(String.raw`$\hat J_{12}$`, 'J12（量測 Jacobian）')} value={P.j12} onChange={(v) => setP({ ...P, j12: v })} min={-3} max={3} step={0.01} unit="—" reg="Measured Jacobian" />
          <ParamControl {...pl(String.raw`$\hat J_{21}$`, 'J21（量測 Jacobian）')} value={P.j21} onChange={(v) => setP({ ...P, j21: v })} min={-3} max={3} step={0.01} unit="—" reg="Measured Jacobian" />
          <ParamControl {...pl(String.raw`$\hat J_{22}$`, 'J22（量測 Jacobian）')} value={P.j22} onChange={(v) => setP({ ...P, j22: v })} min={-3} max={3} step={0.01} unit="—" reg="Measured Jacobian" />
          <ParamControl {...pl(String.raw`$\gamma$（收斂因子）`, 'gamma（收斂因子）')} value={P.gamma} onChange={(v) => setP({ ...P, gamma: v })} min={0.01} max={1.99} step={0.01} unit="—" reg="REG_PRECOND_GAMMA" />
          <ParamControl {...pl(String.raw`$\varepsilon$（正則化）`, 'epsilon（正則化）')} value={P.eps} onChange={(v) => setP({ ...P, eps: v })} min={1e-6} max={10} log unit="—" reg="REG_PRECOND_EPS" hint={mt(String.raw`勘誤 E22：$\lambda$ 只代表 eigenvalue`)} />
          <ParamControl {...pl(String.raw`$N$（GMAC block，$\sigma_\eta^2=1/N$）`, 'N（GMAC block）')} value={P.N} onChange={(v) => setP({ ...P, N: v })} min={1} max={65536} log integer clampOnBlur unit="samples" reg="REG_GMAC_N" />
          <ParamControl {...pl(String.raw`對照：純量 $\mu$（$\mathbf M=\mu\mathbf I$）`, '對照：純量 mu')} value={P.muRaw} onChange={(v) => setP({ ...P, muRaw: v })} min={-2} max={2} step={0.01} unit="—" reg="REG_GAIN_STEP（raw LMS）" />
        </>
      }
    >
      <div className="rm-plots">
        <Plot
          title={String.raw`取捨曲線：95% 收斂 blocks vs 穩態 $E\|\delta\mathbf w\|^2$`}
          data={tradeoff}
          xLog
          yLog
          layout={LAYOUT_TRADEOFF}
          height={300}
          csvName="r4-tradeoff"
        />
        <Plot title={String.raw`每個 mode 的 pole vs $\varepsilon$`} data={poleData} xLog layout={LAYOUT_POLES} height={300} csvName="r4-poles" />
      </div>
    </ExperimentShell>
  )
}

export default function R4Preview() {
  return (
    <div className="rm-preview">
      <Prereq title="SVD：把矩陣拆成「旋轉、拉伸、再旋轉」">
        <p>
          任何矩陣都能寫成 <Tex>{String.raw`\mathbf J=\mathbf U\boldsymbol\Sigma\mathbf V^T`}</Tex>，<Tex>{'\\mathbf U,\\mathbf V'}</Tex> 是正交矩陣（<Tex>{'\\mathbf V^T\\mathbf V=\\mathbf I'}</Tex>，只旋轉不拉伸），
          <Tex>{'\\boldsymbol\\Sigma=\\mathrm{diag}(\\sigma_1,\\sigma_2,\\dots)'}</Tex> 是非負的拉伸量（singular values）。於是 <Tex>{String.raw`\mathbf J^T\mathbf J=\mathbf V\boldsymbol\Sigma^2\mathbf V^T`}</Tex>，加上 <Tex>{'\\varepsilon\\mathbf I=\\mathbf V(\\varepsilon\\mathbf I)\\mathbf V^T'}</Tex> 再取反矩陣，只是把每個 <Tex>{'\\sigma_i^2'}</Tex> 換成 <Tex>{'1/(\\sigma_i^2+\\varepsilon)'}</Tex>。 <ChRef ch="10">第 10 章</ChRef>有 {mt('$2\\times2$')} 的逐步範例。
        </p>
      </Prereq>
      <StepDerivation
        title="一步一步推導：每個 mode 的 pole 與穩態變異"
        steps={[
          { tex: String.raw`\delta\mathbf w_{k+1}=(\mathbf I+\mathbf M\mathbf J)\,\delta\mathbf w_k+\mathbf M\boldsymbol\eta_k`, why: <>代入 <Tex>{String.raw`\mathbf G\approx\mathbf J\delta\mathbf w+\boldsymbol\eta`}</Tex> 與 <Tex>{String.raw`\mathbf w_{k+1}=\mathbf w_k+\mathbf M\mathbf G_k`}</Tex>（規格 §10.2）。</> },
          { tex: String.raw`\mathbf M=-\gamma(\mathbf V\boldsymbol\Sigma^2\mathbf V^T+\varepsilon\mathbf I)^{-1}\mathbf V\boldsymbol\Sigma\mathbf U^T=-\gamma\,\mathbf V\,\mathrm{diag}\Big(\frac{\sigma_i}{\sigma_i^2+\varepsilon}\Big)\mathbf U^T`, why: <>代入 SVD；<Tex>{'\\mathbf V'}</Tex> 正交，反矩陣只作用在對角線上。</> },
          { tex: String.raw`\mathbf M\mathbf J=-\gamma\,\mathbf V\,\mathrm{diag}\Big(\frac{\sigma_i^2}{\sigma_i^2+\varepsilon}\Big)\mathbf V^T`, why: <>再乘 <Tex>{String.raw`\mathbf J=\mathbf U\boldsymbol\Sigma\mathbf V^T`}</Tex>，<Tex>{'\\mathbf U^T\\mathbf U=\\mathbf I'}</Tex>。</> },
          { tex: String.raw`\mathbf z_k=\mathbf V^T\delta\mathbf w_k:\quad z_{i,k+1}=p_i\,z_{i,k}-\gamma\frac{\sigma_i}{\sigma_i^2+\varepsilon}\,(\mathbf U^T\boldsymbol\eta_k)_i`, why: <>換到 <Tex>{'\\mathbf V'}</Tex> 的座標，每個 mode 互不干擾。</> },
          { tex: String.raw`\mathrm{Cov}(\mathbf U^T\boldsymbol\eta)=\mathbf U^T(\sigma_\eta^2\mathbf I)\mathbf U=\sigma_\eta^2\mathbf I`, why: '旋轉不改變白雜訊的大小。' },
          { tex: String.raw`\mathrm{Var}(z_i)=\frac{\gamma^2\sigma_i^2\sigma_\eta^2}{(\sigma_i^2+\varepsilon)^2(1-p_i^2)}`, why: <>每個 mode 都是純量 AR(1)：<Tex>{'\\mathrm{Var}=b^2\\sigma_\\eta^2/(1-p^2)'}</Tex>（R1 的 <Tex>{'\\rho=0'}</Tex>）。</> },
          { tex: String.raw`E\|\delta\mathbf w\|^2=\sum_i\mathrm{Var}(z_i)`, why: <><Tex>{'\\mathbf V'}</Tex> 正交：長度平方不變。</> },
        ]}
        result={String.raw`p_i=1-\gamma\frac{\sigma_i^2}{\sigma_i^2+\varepsilon},\qquad \mathrm{Var}_i=\frac{\gamma^2\sigma_i^2\sigma_\eta^2}{(\sigma_i^2+\varepsilon)^2(1-p_i^2)}\qquad(\text{F-R4.1})`}
      />
      <p>
        <ClaimTag kind="exact" /> 兩個極限：<Tex>{'\\varepsilon=0'}</Tex> 時所有 pole 都是 <Tex>{'1-\\gamma'}</Tex>，但 <Tex>{'\\mathrm{Var}_i=\\gamma\\sigma_\\eta^2/(\\sigma_i^2(2-\\gamma))'}</Tex> 在弱方向（小 <Tex>{'\\sigma_i'}</Tex>）爆大；
        <Tex>{'\\varepsilon\\gg\\sigma_i^2'}</Tex> 時 <Tex>{'p_i\\approx1-\\gamma\\sigma_i^2/\\varepsilon'}</Tex>，等於步長 <Tex>{'\\gamma/\\varepsilon'}</Tex> 的梯度型更新 <Tex>{String.raw`\mathbf M\approx-(\gamma/\varepsilon)\mathbf J^T`}</Tex>（不做反矩陣）：慢，但雜訊小。
        <ErratumNote eid="E37">{String.raw`這是 eigen-mode 的變異，不是第 $i$ 個參數的變異。`}</ErratumNote>
      </p>
      <HandCalc def={roadmapHandCalc('HC-RM.4')} />
      <R4Experiment />
      <TryIt
        items={[
          String.raw`T18 預設下把「對照 $\mu$」從 $-2$ 掃到 2：$\rho(\mathbf I+\mu\mathbf J)$ 永遠 $\ge1$；regularized $\mathbf M$ 卻兩個 pole 都在 0.5 附近。`,
          String.raw`載入「強相關」preset，把 $\varepsilon$ 從 $10^{-6}$ 拉到 1：取捨曲線上的點沿著曲線滑動——收斂 blocks 變多、雜訊變小。`,
          String.raw`載入「奇異 J」：警告說明 $\lambda_{\min}=0$ 的方向不可辨識，Lyapunov 欄位顯示無唯一解。`,
        ]}
      />
      <Observe>
        沒有一個 <Tex>{'\\varepsilon'}</Tex> 同時最快又最安靜；R4 的研究工作是在多個 corner 的 <Tex>{'\\mathbf J_c'}</Tex> 下同時保證穩定（<Tex>{'\\max_c\\rho(\\mathbf I+\\mathbf M\\mathbf J_c)<1'}</Tex>），再把乘法器 / LUT 的成本放進同一個目標。
      </Observe>
      <h4>核心程式碼</h4>
      <CodeBlock source={modelSrc} region="regularizedPreconditioner" path={PATH} caption={String.raw`標示行：$\varepsilon$ 讓小 $\sigma_i$ 的增益變小——這就是收斂與雜訊的取捨。`} />
      <ModeGate min="research">
        <h4>{mt(String.raw`Research：模型誤差 $\hat{\mathbf J}\ne\mathbf J$`)}</h4>
        <p>
          實際的 poles 是 <Tex>{String.raw`\mathrm{eig}\big(\mathbf I-\gamma(\hat{\mathbf J}^T\hat{\mathbf J}+\varepsilon\mathbf I)^{-1}\hat{\mathbf J}^T\mathbf J\big)`}</Tex>，只有 <Tex>{'\\hat{\\mathbf J}=\\mathbf J'}</Tex> 時才化成上面的封閉式。
          <ErratumNote eid="E24">{String.raw`規格 §10.2 的 pole 公式需要 $\hat{\mathbf J}=\mathbf J$。`}</ErratumNote> robust 設計要對一組 <Tex>{'\\mathbf J_c'}</Tex>（FCW、PVT corner）同時檢查——這是 R4 的待辦。
        </p>
      </ModeGate>
    </div>
  )
}
