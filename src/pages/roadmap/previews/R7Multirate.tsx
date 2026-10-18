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
  TexBlock,
  useThemeTokens,
  type ExperimentPreset,
  type MetricRow,
} from '@/components'
import modelSrc from '../model.ts?raw'
import { r7Rho, R7_EXAMPLE, roadmapHandCalc } from '../handcalcs'
import { dualLoopMuMax, dualLoopSweep, eig2, liftedDualLoop, quasiStaticPole, simulateMultirate } from '../model'
import { ErratumNote, mergeParams, mt, n4, Observe, pl, TryIt, useRoadmapPresets } from '../common'

const EXP_ID = 'roadmap-r7-lifting'
const PATH = 'src/pages/roadmap/model.ts'

interface R7Params {
  r: number
  b: number
  c: number
  mu: number
  N: number
  blocks: number
}

const DEFAULTS: R7Params = { ...R7_EXAMPLE, N: 1, blocks: 60 }

const INLINE_PRESETS: ExperimentPreset[] = [
  { name: '規格 §8.4 / Gallery #5：N = 1、μ = 1.2（發散）', params: { ...DEFAULTS } },
  { name: '同一個 μ = 1.2、N = 16（每 block 16 個快迴路 sample）', params: { ...DEFAULTS, N: 16 }, description: '多速率模型穩定' },
  { name: 'N = 64、μ = 2.2（超過 quasi-static 上限 2 仍穩定）', params: { ...DEFAULTS, N: 64, mu: 2.2 }, description: '有限 N 的 GMAC 平均到暫態，有效增益較小' },
  { name: '慢觀測 r_s = 0.95、N = 8', params: { ...DEFAULTS, r: 0.95, b: 0.05, N: 8, mu: 0.8 }, description: '觀測狀態慢：μ_max(N) 的峰值移到更大的 N' },
]

/** 「先算一次」表格列出的 N（N = 2 是 HC-RM.7 的預設值） */
const FIRST_LOOK_N = [1, 2, 16]
const N_LIST = [1, 2, 4, 16, 64]
const MU_GRID = Array.from({ length: 161 }, (_, i) => i * 0.025)
const N_SWEEP = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 256, 512, 1024]

// Plot 的 layout 是靜態的：放在模組層，避免每次 render 產生新物件而觸發 Plotly.react
const LAYOUT_RHO: Partial<Layout> = { xaxis: { title: { text: '$\\mu$（正規化）' } }, yaxis: { title: { text: 'spectral radius' }, range: [0, 1.6] } }
const LAYOUT_MUMAX: Partial<Layout> = { xaxis: { title: { text: '$N$（log）' } }, yaxis: { title: { text: '$\\mu_{\\max}$' } } }
const LAYOUT_TIME: Partial<Layout> = { xaxis: { title: { text: '$k$（block）' } }, yaxis: { title: { text: '$\\delta_k / \\delta_0$' } } }

function R7Experiment() {
  const [P, setP] = useState<R7Params>(DEFAULTS)
  const tokens = useThemeTokens()
  const presets = useRoadmapPresets(EXP_ID, INLINE_PRESETS, (pr) => setP((prev) => mergeParams(prev, pr)))
  const dP = useDeferredValue(P)
  const N = Math.max(1, Math.round(dP.N))
  const base = useMemo(() => ({ r: dP.r, b: dP.b, c: dP.c }), [dP.r, dP.b, dP.c])
  const A = useMemo(() => liftedDualLoop({ ...base, mu: dP.mu, N }), [base, dP.mu, N])
  const { z, rho } = eig2(A)
  const qs = quasiStaticPole({ ...base, mu: dP.mu, N })
  const blocks = Math.max(5, Math.round(dP.blocks))
  const sim = useMemo(() => simulateMultirate({ ...base, mu: dP.mu, N }, blocks, 0, 1), [base, dP.mu, N, blocks])
  const lifted = useMemo(() => {
    const out = new Float64Array(blocks + 1)
    let x = [0, 1]
    out[0] = 1
    for (let k = 1; k <= blocks; k++) {
      x = [A[0][0] * x[0] + A[0][1] * x[1], A[1][0] * x[0] + A[1][1] * x[1]]
      out[k] = x[1]
    }
    return out
  }, [A, blocks])
  const liftErr = useMemo(() => {
    let m = 0
    let scale = 1
    for (let k = 0; k <= blocks; k++) {
      m = Math.max(m, Math.abs(lifted[k] - sim.delta[k]))
      scale = Math.max(scale, Math.abs(sim.delta[k]))
    }
    return m / scale
  }, [lifted, sim, blocks])
  const sweep = useMemo(() => dualLoopSweep(base, Array.from(new Set([...N_LIST, N])).sort((a, b) => a - b), MU_GRID), [base, N])
  const muMaxCurve = useMemo(() => N_SWEEP.map((n) => dualLoopMuMax(base, n, 20)), [base])
  const muMaxHere = useMemo(() => dualLoopMuMax(base, N, 20), [base, N])
  const qsMax = (2 * (1 - dP.r)) / (dP.b * dP.c)
  const jury = (1 - dP.r) / (dP.b * dP.c)

  const warnings: string[] = []
  if (!(Math.abs(dP.r) < 1)) warnings.push(String.raw`$|r_s|=${Math.abs(dP.r)}\ge1$：快迴路（觀測動態）本身不穩定，quasi-static 假設 $s\approx b_s\delta/(1-r_s)$ 完全不成立。`)
  if (rho >= 1)
    warnings.push(
      String.raw`$\rho(\mathbf A_N)=${n4(rho)}\ge1$：完整多速率模型發散；quasi-static 卻預測 $|1-\mu c_sb_s/(1-r_s)|=${n4(Math.abs(qs))}$` + (Math.abs(qs) < 1 ? String.raw`（$<1$，看起來穩定）——時間尺度分離失效。` : '。'),
    )
  if (dP.b * dP.c <= 0) warnings.push(String.raw`$b_sc_s\le0$：校正方向與觀測增益反號，正 $\mu$ 的 quasi-static pole 大於 1（polarity 錯誤）。`)

  const metrics: MetricRow[] = [
    { name: String.raw`$\mathbf A_N$（lifted）`, value: `[[${n4(A[0][0])}, ${n4(A[0][1])}], [${n4(A[1][0])}, ${n4(A[1][1])}]]`, formulaId: 'F-R7.1', claim: 'exact' },
    { name: 'eigenvalues', value: z.map((v) => (Math.abs(v.im) > 1e-12 ? `${n4(v.re)} ± j${n4(Math.abs(v.im))}` : n4(v.re))).filter((s, i, a) => a.indexOf(s) === i).join('、') },
    { name: String.raw`$\rho(\mathbf A_N)$`, value: rho, unit: '—', note: rho >= 1 ? '發散' : '收斂' },
    { name: String.raw`quasi-static pole $1-\mu c_sb_s/(1-r_s)$`, value: qs, unit: '—', claim: 'approx', note: '近似：時間尺度分離' },
    { name: String.raw`穩定上限 $\mu_{\max}$（$N=${N}$）`, value: muMaxHere, unit: '—', claim: 'exact', note: String.raw`二分法找 $\rho(\mathbf A_N)=1$` },
    { name: String.raw`$N=1$ 的 Jury 上限 $(1-r_s)/(b_sc_s)$`, value: jury, unit: '—', claim: 'exact' },
    { name: String.raw`quasi-static 上限 $2(1-r_s)/(b_sc_s)$`, value: qsMax, unit: '—', claim: 'approx' },
    { name: String.raw`lifted vs 逐 sample：$\max_k|\Delta\delta_k|/\max_k|\delta_k|$`, value: liftErr, analytic: 0, tolerance: 1e-9 },
  ]

  const rhoData: Data[] = useMemo(() => {
    const d: Data[] = Object.keys(sweep.rho)
      .map(Number)
      .map((n, i) => ({ x: MU_GRID, y: sweep.rho[n], name: `$N = ${n}$`, mode: 'lines', line: { color: tokens.series[i % tokens.series.length], width: n === N ? 3 : 1.5 } }))
    d.push({ x: MU_GRID, y: sweep.quasi, name: 'quasi-static |pole|', mode: 'lines', line: { color: tokens.textMuted, dash: 'dash' } })
    d.push({ x: [MU_GRID[0], MU_GRID[MU_GRID.length - 1]], y: [1, 1], name: '單位圓', mode: 'lines', line: { color: tokens.text, dash: 'dot' } })
    d.push({ x: [dP.mu], y: [rho], name: '目前 $(\\mu, N)$', mode: 'markers', marker: { size: 11, symbol: 'diamond', color: tokens.text } })
    return d
  }, [sweep, N, dP.mu, rho, tokens])
  const muData: Data[] = useMemo(
    () => [
      { x: N_SWEEP, y: muMaxCurve, name: '$\\mu_{\\max}(N)$（lifted，exact）', mode: 'lines+markers', marker: { size: 5 }, line: { color: tokens.series[0] } },
      { x: [N_SWEEP[0], N_SWEEP[N_SWEEP.length - 1]], y: [qsMax, qsMax], name: 'quasi-static $2(1 - r_s)/(b_s c_s)$', mode: 'lines', line: { color: tokens.series[1], dash: 'dash' } },
      { x: [N_SWEEP[0], N_SWEEP[N_SWEEP.length - 1]], y: [jury, jury], name: '$N = 1$ Jury $(1 - r_s)/(b_s c_s)$', mode: 'lines', line: { color: tokens.series[2], dash: 'dot' } },
    ],
    [muMaxCurve, qsMax, jury, tokens],
  )
  const kAxis = useMemo(() => Array.from({ length: blocks + 1 }, (_, k) => k), [blocks])
  const tData: Data[] = useMemo(
    () => [
      { x: kAxis, y: Array.from(sim.delta), name: '逐 sample 模擬 $\\delta_k$', mode: 'lines', line: { color: tokens.series[0] } },
      { x: kAxis, y: Array.from(lifted), name: 'lifted $\\mathbf A_N^k$', mode: 'markers', marker: { size: 5, color: tokens.series[1], symbol: 'circle-open' } },
    ],
    [kAxis, sim, lifted, tokens],
  )

  return (
    <ExperimentShell
      id={EXP_ID}
      title="R7 預覽：多速率 lifting——快迴路每 sample、LMS 每 $N$ 個 sample"
      level="L2"
      claim="exact"
      source="simulation"
      description={<>規格 §8.4 的抽象觀測狀態 <Tex>{'s'}</Tex> 改成每個 sample 走一步，GMAC 在一個 block 內平均 <Tex>{'N'}</Tex> 個 <Tex>{'c_s\\,s'}</Tex> 才更新一次 <Tex>{'\\delta'}</Tex>。</>}
      assumptions={[
        String.raw`抽象線性觀測 $s_{n+1}=r_s\,s_n+b_s\,\delta$（不是特定 PLL 狀態；規格 §8.4，符號依勘誤 E31 / E34 加下標 $s$）`,
        String.raw`$\delta$ 在 block 內保持不變（ZOH），$G_k=\frac{c_s}{N}\sum s$，無 commit latency`,
        String.raw`$\mu$ 為 $K\equiv1$ 的正規化步長（勘誤 E13）；無雜訊（平均動態）`,
      ]}
      params={{ ...P, N }}
      units={{ r: '—', b: '—', c: '—', mu: '—（正規化）', N: 'samples/block' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: { status: liftErr < 1e-9 ? 'ok' : 'mismatch', note: 'lifted 矩陣的冪次 vs 逐 sample 模擬' },
        monteCarlo: 'n/a',
        fixedPoint: 'not-implemented',
      }}
      actions={{ onReset: () => setP(DEFAULTS) }}
      presets={presets}
      onLoadPreset={(pr) => setP((prev) => mergeParams(prev, pr.params))}
      exportData={() => ({ mu: MU_GRID, ...Object.fromEntries(Object.entries(sweep.rho).map(([n, v]) => [`rho_N${n}`, v])), N_sweep: N_SWEEP, mu_max: muMaxCurve, k: kAxis, delta_sim: sim.delta })}
      controls={
        <>
          <ParamControl {...pl('$r_s$（觀測狀態 pole）', 'r_s（觀測狀態 pole）')} value={P.r} onChange={(v) => setP({ ...P, r: v })} min={-0.99} max={0.999} step={0.001} unit="—" reg="Behavioral：主迴路殘差 pole（每 sample）" />
          <ParamControl {...pl('$b_s$（誤差到觀測狀態的增益）', 'b_s（誤差到觀測狀態的增益）')} value={P.b} onChange={(v) => setP({ ...P, b: v })} min={-1} max={1} step={0.01} unit="—" reg="Behavioral：校正誤差到觀測狀態的增益" />
          <ParamControl {...pl('$c_s$（觀測狀態到 GMAC 的增益）', 'c_s（觀測狀態到 GMAC 的增益）')} value={P.c} onChange={(v) => setP({ ...P, c: v })} min={-2} max={2} step={0.01} unit="—" reg="Behavioral：觀測狀態到 GMAC 的增益" />
          <ParamControl {...pl(String.raw`$\mu$（正規化步長）`, 'mu（正規化步長）')} value={P.mu} onChange={(v) => setP({ ...P, mu: v })} min={0.001} max={4} step={0.001} unit="—" reg="REG_GAIN_STEP（K ≡ 1）" />
          <ParamControl {...pl('$N$（每 block 的快迴路 sample）', 'N（每 block 的快迴路 sample）')} value={P.N} onChange={(v) => setP({ ...P, N: v })} min={1} max={4096} log integer clampOnBlur unit="samples" reg="REG_GMAC_N" />
          <ParamControl label="模擬 blocks" value={P.blocks} onChange={(v) => setP({ ...P, blocks: v })} min={5} max={400} integer clampOnBlur unit="blocks" reg="Sim：block 數" />
        </>
      }
    >
      <div className="rm-plots">
        <Plot title={String.raw`$\rho(\mathbf A_N)$ vs $\mu$：不同 $N$`} data={rhoData} layout={LAYOUT_RHO} height={300} csvName="r7-rho-vs-mu" />
        <Plot title={String.raw`穩定上限 $\mu_{\max}$ 隨 $N$ 變化`} data={muData} xLog layout={LAYOUT_MUMAX} height={300} csvName="r7-mumax" />
      </div>
      <Plot title={String.raw`$\delta_k$：lifted 矩陣（○）與逐 sample 模擬（線）逐點重合`} data={tData} layout={LAYOUT_TIME} height={260} csvName="r7-time" />
    </ExperimentShell>
  )
}

export default function R7Preview() {
  return (
    <div className="rm-preview">
      <Prereq title="矩陣的冪次、eigenvalue 與 spectral radius">
        <p>
          <Tex>{'\\mathbf x_{k+1}=\\mathbf A\\mathbf x_k'}</Tex> 的解是 <Tex>{'\\mathbf x_k=\\mathbf A^k\\mathbf x_0'}</Tex>。若 <Tex>{'\\mathbf A=\\mathbf Q\\boldsymbol\\Lambda\\mathbf Q^{-1}'}</Tex>，則 <Tex>{'\\mathbf A^k=\\mathbf Q\\boldsymbol\\Lambda^k\\mathbf Q^{-1}'}</Tex>，每個方向乘上 <Tex>{'\\lambda_i^k'}</Tex>。所以「收斂」等價於所有 <Tex>{'|\\lambda_i|<1'}</Tex>，也就是 spectral radius <Tex>{'\\rho(\\mathbf A)=\\max|\\lambda_i|<1'}</Tex>。複數 eigenvalue 代表振盪；<Tex>{'|\\lambda|'}</Tex> 才決定衰減或發散。
        </p>
      </Prereq>
      <h4>{mt(String.raw`先算一次：規格 §8.4 的數字（$r_s=${R7_EXAMPLE.r}$、$b_s=${R7_EXAMPLE.b}$、$c_s=${R7_EXAMPLE.c}$、$\mu=${R7_EXAMPLE.mu}$），只改 $N$`)}</h4>
      <div className="table-wrap">
        <table aria-label="先算一次：同一個步長在三種 block 長度下的 spectral radius">
          <thead>
            <tr>
              <th>{mt('$N$（每 block 的快迴路 sample 數）')}</th>
              <th>
                <Tex>{'\\rho(\\mathbf A_N)'}</Tex>
              </th>
              <th>結論</th>
            </tr>
          </thead>
          <tbody>
            {FIRST_LOOK_N.map((nn) => {
              const rho = r7Rho(nn)
              return (
                <tr key={nn}>
                  <td>{nn}</td>
                  <td>{n4(rho)}</td>
                  <td>{rho < 1 ? '收斂' : '發散'}{nn === 1 ? '（規格 §8.4、T09）' : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        表中每個數字都由 <code>liftedDualLoop</code> 與 <code>eig2</code> 即時計算；{mt('$N=2$')} 那一列就是下方「帶入手算」的預設值。同一個 <Tex>{'\\mu'}</Tex>，只因 GMAC 多平均了一個 sample，結論就從發散變成收斂——下面推導這個 <Tex>{'\\mathbf A_N'}</Tex> 是怎麼來的。
      </p>
      <StepDerivation
        title={mt('一步一步推導：把一個 block 內的 $N$ 步積掉（lifting）')}
        steps={[
          { tex: String.raw`s_{n+1}=r_s\,s_n+b_s\,\delta_k,\qquad n=kN,\dots,kN+N-1`, why: <>快迴路每個 sample 走一步；<Tex>{'\\delta'}</Tex> 在 block 內不變（ZOH）。</> },
          { tex: String.raw`s_{kN+i}=r_s^{\,i}s_{kN}+b_s\,\delta_k\sum_{j=0}^{i-1}r_s^{\,j}=r_s^{\,i}s_{kN}+b_s\,\delta_k\frac{1-r_s^{\,i}}{1-r_s}`, why: '反覆代入，等比級數求和。' },
          { tex: String.raw`s_{(k+1)N}=r_s^{N}s_{kN}+b_s\,S_N\,\delta_k,\qquad S_N=\sum_{i=0}^{N-1}r_s^{\,i}=\frac{1-r_s^N}{1-r_s}`, why: <>取 <Tex>{'i=N'}</Tex>。</> },
          { tex: String.raw`G_k=\frac{c_s}{N}\sum_{i=0}^{N-1}s_{kN+i}=\frac{c_s}{N}\Big[S_N\,s_{kN}+\frac{b_s}{1-r_s}(N-S_N)\,\delta_k\Big]`, why: <>把第 2 步對 <Tex>{'i=0..N-1'}</Tex> 加總：<Tex>{String.raw`\sum_i(1-r_s^{\,i})=N-S_N`}</Tex>。</> },
          { tex: String.raw`\delta_{k+1}=\delta_k-\mu G_k`, why: 'LMS 更新（規格 §8.4）。' },
          { tex: String.raw`N=1:\ \mathbf A_1=\begin{bmatrix}r_s&b_s\\-\mu c_s&1\end{bmatrix};\qquad N\to\infty:\ \mathbf A_N\to\begin{bmatrix}0&\frac{b_s}{1-r_s}\\0&1-\frac{\mu c_sb_s}{1-r_s}\end{bmatrix}`, why: <><Tex>{'S_N=1'}</Tex> 時回到規格；<Tex>{'r_s^N\\to0'}</Tex>、<Tex>{'S_N/N\\to0'}</Tex> 時左下的耦合項消失，矩陣變成上三角，eigenvalue 就是 0 與 quasi-static pole——時間尺度分離變成精確。</> },
        ]}
        result={String.raw`\mathbf A_N=\begin{bmatrix}r_s^N&b_sS_N\\-\mu c_sS_N/N&1-\mu c_sb_s\frac{N-S_N}{N(1-r_s)}\end{bmatrix}\qquad(\text{F-R7.1})`}
      />
      <p>
        <ClaimTag kind="exact" /> 在此線性多速率模型中精確（下方實驗以逐 sample 模擬逐點驗證）。<Tex>{'N=1'}</Tex> 的範圍是 <Tex>{'0<\\mu<(1-r_s)/(b_sc_s)'}</Tex>（Jury），
        <Tex>{'N\\to\\infty'}</Tex> 趨近 quasi-static 的 <Tex>{'0<\\mu<2(1-r_s)/(b_sc_s)'}</Tex>；中間的 <Tex>{'N'}</Tex> 不一定在兩者之間——block 平均包含快迴路的暫態，有效增益 <Tex>{'(N-S_N)/N<1'}</Tex>。
        <ErratumNote eid="E19">§8.4 的失穩來自觀測動態，不是「延遲」本身。</ErratumNote>
        <ErratumNote eid="E31">{String.raw`規格 §8.4 的 $(\mathbf A,\mathbf B,\mathbf C,D)$ 與 $r,b,c$ 會和 §0 的 $\mathbf C=E[\mathbf x\mathbf u^T]$、code delay $D$ 撞名；本站改記 $(\mathbf A_s,\mathbf b_s,\mathbf c_s^T,d_s)$ 與 $r_s,b_s,c_s$（與第 8 章相同）。`}</ErratumNote>
      </p>
      <TexBlock>{String.raw`\text{一般化（R7 待辦）：}\ \mathbf s_{(k+1)N}=\mathbf A_s^{N}\mathbf s_{kN}+\Big(\sum_{i=0}^{N-1}\mathbf A_s^{i}\Big)\mathbf b_s\,\delta_k,\qquad G_k=\frac1N\sum_{i=0}^{N-1}\mathbf c_s^{T}\mathbf s_{kN+i}+d_s\,\delta_k`}</TexBlock>
      <HandCalc def={roadmapHandCalc('HC-RM.7')} />
      <R7Experiment />
      <TryIt
        items={[
          <>預設（規格 §8.4、<Tex>{'N=1'}</Tex>、<Tex>{'\\mu=1.2'}</Tex>）：<Tex>{'\\rho=\\sqrt{1.04}>1'}</Tex> 發散。把 <Tex>{'N'}</Tex> 改成 16：同一個 <Tex>{'\\mu'}</Tex> 變成收斂。</>,
          <>看右上圖：<Tex>{'\\mu_{\\max}(N)'}</Tex> 先上升、超過 quasi-static 上限、再慢慢降回 <Tex>{'2(1-r_s)/(b_sc_s)'}</Tex>——不能用單一速率的公式外推。</>,
          <>把 <Tex>{'r_s'}</Tex> 拉到 0.99（快迴路很慢）：要更大的 <Tex>{'N'}</Tex> 才進入 quasi-static 區。</>,
        ]}
      />
      <Observe>
        同一個 <Tex>{'\\mu'}</Tex>、同一個主迴路，換一個 GMAC 長度 <Tex>{'N'}</Tex> 穩定性就改變。R7 的工作是把這個 lifting 套到真實的 <Tex>{'H_{\\mathrm{PD}}(z)'}</Tex>（Type-II、含 latency）與 commit timing，再往事件級模型推進。
      </Observe>
      <h4>核心程式碼：lifted 矩陣 vs 逐 sample 模擬</h4>
      <CodeCompare
        items={[
          { label: 'lifted 矩陣（block rate）', source: modelSrc, region: 'liftedDualLoop', path: PATH, note: '一個 block 的 $N$ 步用封閉式積掉。' },
          { label: '逐 sample 模擬（sample rate）', source: modelSrc, region: 'multirateSim', path: PATH, note: '直接跑 $N$ 步再更新一次。' },
        ]}
      />
      <ModeGate min="research">
        <h4>Research：事件級模型要多什麼</h4>
        <ul>
          <li>reference edge 經 DTC 的延遲（DTC 在 reference 輸入端、只能延遲：<Tex>{'\\tau_{\\mathrm{DTC}}=T_0-w\\,x'}</Tex>）、feedback（divider）edge 的時間序（DSM 改變 divider 比例 → edge 時間是非線性的）、PD 的取樣時刻；PD 量的是（被 DTC 延遲後的）reference edge 減 feedback edge。</li>
          <li>四條路徑分開：PD error（<Tex>{'H_{\\mathrm{PD}}'}</Tex>）、reference noise、VCO noise（<Tex>{'1-T'}</Tex>）、gain update（本預覽）。</li>
          <li>
            injection-locked 模式的 <Tex>{'H_{\\mathrm{PD}}'}</Tex> 與非注入模式不同，必須分開量測。<ErratumNote eid="E44">{String.raw`CT 原型的 $H_{\mathrm{PD}}$ 不能直接套在 DT 迴路上。`}</ErratumNote>
          </li>
        </ul>
      </ModeGate>
    </div>
  )
}
