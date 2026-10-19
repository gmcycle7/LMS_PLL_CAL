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
  TexBlock,
  useThemeTokens,
  type ExperimentPreset,
  type MetricRow,
  ChRef,
} from '@/components'
import modelSrc from '../model.ts?raw'
import { roadmapHandCalc } from '../handcalcs'
import { cycloAutocorr, gcd, simulateCyclo, zohAutocorr } from '../model'
import { ErratumNote, mergeParams, mt, n4, Observe, pl, TryIt, useRoadmapPresets } from '../common'

const EXP_ID = 'roadmap-r2-cyclo'
const PATH = 'src/pages/roadmap/model.ts'

interface R2Params {
  K: number
  M: number
  N: number
  p: number
  seed: number
}

const DEFAULTS: R2Params = { K: 3, M: 8, N: 16, p: 0.6, seed: 20261010 }

const INLINE_PRESETS: ExperimentPreset[] = [
  { name: '同步：P = 8、N = 16（gcd = 8）', params: { K: 3, M: 8, N: 16, p: 0.6 }, description: 'block 邊界永遠落在同一組 code 相位' },
  { name: '互質：P = 8、N = 15（gcd = 1）', params: { K: 3, M: 8, N: 15, p: 0.6 }, description: '只差一個 sample，獨立平穩近似就變成精確' },
  { name: '部分同步：P = 8、N = 12（gcd = 4）', params: { K: 3, M: 8, N: 12, p: 0.6 }, description: 'gcd 介於兩者之間' },
  { name: '慢迴路 p = 0.95（P = 8、N = 16）', params: { K: 3, M: 8, N: 16, p: 0.95 }, description: 'p → 1 時跨 block 的衰減變小，誤差也變小' },
]

// Plot 的 layout 是靜態的：放在模組層，避免每次 render 產生新物件而觸發 Plotly.react
const LAYOUT_AC: Partial<Layout> = { xaxis: { title: { text: 'lag $m$ [samples]' } }, yaxis: { title: { text: '$\\bar R[m] / \\sigma_w^2$' } } }
const LAYOUT_VAR: Partial<Layout> = { xaxis: { title: { text: '$n$ [samples]（一個 $L$ 週期，最多 512 點）' } }, yaxis: { title: { text: '$x[n]^2$' } } }

function R2Experiment() {
  const [P, setP] = useState<R2Params>(DEFAULTS)
  const tokens = useThemeTokens()
  const presets = useRoadmapPresets(EXP_ID, INLINE_PRESETS, (pr) => setP((prev) => mergeParams(prev, pr)))
  const dP = useDeferredValue(P)
  const K = Math.round(dP.K)
  const M = Math.max(2, Math.round(dP.M))
  const N = Math.max(1, Math.round(dP.N))
  const maxLag = Math.min(192, 3 * N)
  const res = useMemo(() => cycloAutocorr({ K, M, N, p: dP.p, maxLag }), [K, M, N, dP.p, maxLag])
  const mc = useMemo(() => simulateCyclo({ K, M, N, p: dP.p, maxLag, seed: dP.seed, budget: 1 << 17 }), [K, M, N, dP.p, maxLag, dP.seed])
  const r0 = Math.max(Math.abs(res.exact[0]), 1e-300)
  const mcErr = useMemo(() => mc.empirical.reduce((m, v, i) => Math.max(m, Math.abs(v - res.exact[i])), 0) / r0, [mc, res, r0])
  const trivial = K % M === 0
  // 解析交叉比對：ZOH 的 R̄_w[m] 逐點平均 vs 封閉式（F-R2.1 的第二個因子）；gcd = 1 時精確式 = 分解式（F-R2.2）
  const rwErr = useMemo(() => res.rw.reduce((m, v, i) => Math.max(m, Math.abs(v - zohAutocorr(dP.p, N, res.lags[i]))), 0), [res, dP.p, N])
  const analyticOk = rwErr < 1e-12 && (res.g > 1 || res.maxRelErr < 1e-9)

  const warnings: string[] = []
  if (trivial) warnings.push(String.raw`$K\equiv0\pmod M$：FCW 小數為 0（整數 FCW），一階 DSM residue 恆為 0，$\delta t\equiv0$。選一個非零的 $K$ 才有東西可分析。`)
  if (!trivial && res.g > 1 && res.maxRelErr > 0.02)
    warnings.push(
      String.raw`$\gcd(P,N)=${res.g}>1$：block 邊界與 code 週期同步，「$x$、$\delta w$ 獨立平穩」的 $S_x\circledast S_w$ 公式失準（自相關最大相對誤差 ${n4(100 * res.maxRelErr)}%）。`,
    )
  if (Math.abs(dP.p) >= 1) warnings.push(String.raw`$|p|\ge1$：block-rate AR(1) 不平穩（校正迴路不穩定），時間平均自相關沒有意義。`)

  const metrics: MetricRow[] = [
    { name: String.raw`code 週期 $P=M/\gcd(K,M)$`, value: res.P, unit: 'samples' },
    { name: 'block 長度 $N$', value: N, unit: 'samples' },
    { name: String.raw`$\gcd(P,N)$`, value: res.g, unit: '—', note: String.raw`$=1$ 時精確分解（F-R2.2）` },
    { name: String.raw`聯合週期 $L=\mathrm{lcm}(P,N)$`, value: res.L, unit: 'samples' },
    {
      name: String.raw`精確 vs 分解：$\max_m|\Delta\bar R[m]|/\bar R[0]$`,
      value: res.maxRelErr,
      unit: '—',
      formulaId: 'F-R2.2',
      claim: 'exact',
      analytic: res.g === 1 ? 0 : undefined,
      tolerance: res.g === 1 ? 1e-12 : undefined,
    },
    { name: String.raw`ZOH 的 $\bar R_w[m]$：逐點平均 vs 封閉式的最大差`, value: rwErr, unit: '—', analytic: 0, tolerance: 1e-12, claim: 'exact', note: String.raw`$(1-\tfrac{m'}{N})p^{q}+\tfrac{m'}{N}p^{q+1}$` },
    { name: String.raw`MC vs 精確：$\max_m|\Delta\bar R[m]|/\bar R[0]$`, value: mcErr, unit: '—', claim: 'approx', note: String.raw`${mc.samples} samples（$L$ 的整數倍）` },
    { name: String.raw`$\bar R[0]=\overline{x^2}\,\sigma_w^2$（以 $\sigma_w^2$ 為單位）`, value: res.exact[0], unit: '—', formulaId: 'F-R2.1' },
  ]

  const acData: Data[] = useMemo(
    () => [
      { x: res.lags, y: res.exact, name: '精確時間平均 $\\bar R_{\\delta t}[m]$', mode: 'lines+markers', marker: { size: 4 }, line: { color: tokens.series[0] } },
      { x: res.lags, y: res.factorized, name: '獨立平穩近似 $\\bar R_x\\,\\bar R_w$', mode: 'lines', line: { color: tokens.series[1], dash: 'dash' } },
      { x: mc.lags, y: mc.empirical, name: 'Monte Carlo', mode: 'markers', marker: { color: tokens.series[2], size: 5, symbol: 'x' } },
    ],
    [res, mc, tokens],
  )
  const varData: Data[] = useMemo(() => {
    const n = res.instVar.map((_, i) => i)
    return [{ x: n, y: res.instVar, name: '$E[\\delta t[n]^2]/\\sigma_w^2 = x[n]^2$', mode: 'lines', line: { shape: 'hv', color: tokens.series[3] } }]
  }, [res, tokens])

  return (
    <ExperimentShell
      id={EXP_ID}
      title={String.raw`R2 預覽：ZOH 係數 $\times$ DSM residue 的時間平均自相關`}
      level="L4"
      claim="exact"
      source="simulation"
      description={
        <>
          <Tex>{String.raw`\delta t[n]=x[n]\,\delta w_{\lfloor n/N\rfloor}`}</Tex>，<Tex>{'x'}</Tex> 為一階 DSM residue（FCW 小數 <Tex>{'K/M'}</Tex>），<Tex>{'\\delta w'}</Tex> 為 block-rate AR(1)（<Tex>{'\\sigma_w^2=1'}</Tex>）。比較精確的時間平均自相關與「各自平均再相乘」的近似。
        </>
      }
      assumptions={[
        String.raw`$x$ 為決定性週期序列（一階 DSM residue，零均值化），與 $\delta w$ 獨立（真實 LMS 中兩者相關，屬 R2 待辦）`,
        String.raw`$\delta w$ 為平穩 block-rate AR(1)，pole $p$，$\sigma_w^2$ 正規化為 1；ZOH、commit latency 0（勘誤 E09）`,
        String.raw`時間平均取 $L=\mathrm{lcm}(P,N)$ 的整數倍，等同 Welch / 頻譜儀看到的平均 PSD`,
      ]}
      params={{ K, M, N, p: dP.p }}
      seed={P.seed}
      onSeedChange={(s) => setP({ ...P, seed: s })}
      units={{ K: '—', M: '—', N: 'samples', p: '—' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: { status: analyticOk ? 'ok' : 'mismatch', note: String.raw`$\bar R_w[m]$ 的封閉式 vs 逐點平均` + (res.g === 1 ? String.raw`；$\gcd(P,N)=1$ 時精確式 $=$ 分解式` : '') },
        monteCarlo: { status: trivial || mcErr < 0.1 ? 'ok' : 'mismatch', note: String.raw`MC 與精確式的最大差 $<0.1\,\bar R[0]$（$2^{17}$ samples）` },
        fixedPoint: { status: 'n/a', note: '相關函數的統計量，沒有暫存器量化' },
      }}
      actions={{ onReset: () => setP(DEFAULTS) }}
      presets={presets}
      onLoadPreset={(pr) => setP((prev) => mergeParams(prev, pr.params))}
      exportData={() => ({ lag: res.lags, exact: res.exact, factorized: res.factorized, Rx: res.rx, Rw: res.rw, mc: mc.empirical })}
      controls={
        <>
          <ParamControl {...pl('$K$（FCW 小數分子）', 'K（FCW 小數分子）')} value={P.K} onChange={(v) => setP({ ...P, K: v })} min={0} max={63} integer clampOnBlur unit="—" reg="Behavioral：FCW frac = K/M（一階 DSM）" />
          <ParamControl {...pl('$M$（FCW 小數分母）', 'M（FCW 小數分母）')} value={P.M} onChange={(v) => setP({ ...P, M: v })} min={2} max={64} integer clampOnBlur unit="—" reg="Behavioral：DSM modulus M" />
          <ParamControl {...pl('$N$（GMAC block 長度）', 'N（GMAC block 長度）')} value={P.N} onChange={(v) => setP({ ...P, N: v })} min={1} max={64} integer clampOnBlur unit="samples" reg="REG_GMAC_N" />
          <ParamControl {...pl('$p$（block-rate AR(1) 係數，即校正 pole）', 'p（block-rate AR(1) 係數，即校正 pole）')} value={P.p} onChange={(v) => setP({ ...P, p: v })} min={-0.95} max={0.99} step={0.01} unit="—" reg="Behavioral：校正 pole p" hint={mt(String.raw`$p=1-\mu K$`)} />
        </>
      }
    >
      <div className="rm-plots">
        <Plot
          title="時間平均自相關：精確 vs 獨立平穩近似 vs MC"
          data={acData}
          layout={LAYOUT_AC}
          height={300}
          csvName="r2-autocorr"
        />
        <Plot
          title={String.raw`瞬時變異數 $E[\delta t[n]^2]$ 隨 $n$ 週期變化（cyclostationary）`}
          data={varData}
          layout={LAYOUT_VAR}
          height={300}
          csvName="r2-inst-var"
        />
      </div>
      <p className="small muted">{mt(String.raw`目前 $P=${res.P}$、$N=${N}$、$\gcd(P,N)=${gcd(res.P, N)}$、$L=${res.L}$。`)}</p>
    </ExperimentShell>
  )
}

export default function R2Preview() {
  return (
    <div className="rm-preview">
      <Prereq title="gcd、lcm 與中國餘數定理（CRT）">
        <p>
          <Tex>{'\\gcd(P,N)'}</Tex> 是兩數的最大公因數，<Tex>{'\\mathrm{lcm}(P,N)=PN/\\gcd(P,N)'}</Tex> 是最小公倍數。若 <Tex>{'\\gcd(P,N)=1'}</Tex>（互質），中國餘數定理說：<Tex>{'n=0,1,\\dots,PN-1'}</Tex> 這 <Tex>{'PN'}</Tex> 個整數，和所有餘數配對 <Tex>{'(n\\bmod P,\\ n\\bmod N)'}</Tex> 恰好一對一。例：<Tex>{'P=2,N=3'}</Tex>，<Tex>{'n=0..5'}</Tex> 對應 (0,0)(1,1)(0,2)(1,0)(0,1)(1,2)，六種組合各出現一次。若 <Tex>{'P=2,N=4'}</Tex>，<Tex>{'n\\bmod 2'}</Tex> 由 <Tex>{'n\\bmod 4'}</Tex> 決定，只出現一半的組合。
        </p>
      </Prereq>
      <Prereq title="自相關與 PSD（Wiener–Khinchin）">
        <p>
          平穩序列的 PSD 是自相關的 DTFT：<Tex>{String.raw`S(e^{j\Omega})=\sum_m R[m]e^{-j\Omega m}`}</Tex>。週期性變化的（cyclostationary）序列沒有單一的 <Tex>{'R[m]'}</Tex>，頻譜儀或 Welch 量到的是<strong>時間平均</strong>的 <Tex>{'\\bar R[m]'}</Tex> 的 DTFT。所以只要 <Tex>{'\\bar R'}</Tex> 算錯，量到的 PSD 就和預測不同。
        </p>
      </Prereq>

      <StepDerivation
        title="一步一步推導：時間平均自相關，以及它什麼時候能分解"
        steps={[
          { tex: String.raw`\delta t[n]=x[n]\,\delta w_{\lfloor n/N\rfloor}`, why: <>係數每 <Tex>{'N'}</Tex> 個 sample 才更新一次，中間保持不變（ZOH）。<ErratumNote eid="E09">{String.raw`規格 §12.2 沒有定義 $\delta w[n]$ 與 $\delta w_k$ 的映射。`}</ErratumNote></> },
          { tex: String.raw`E\big[\delta t[n]\,\delta t[n+m]\big]=x[n]x[n+m]\;E\big[\delta w_{\lfloor n/N\rfloor}\,\delta w_{\lfloor (n+m)/N\rfloor}\big]`, why: <><Tex>{'x'}</Tex> 是決定性序列，可以提到期望值外面。</> },
          { tex: String.raw`=x[n]x[n+m]\,\sigma_w^2\,p^{\,|\lfloor (n+m)/N\rfloor-\lfloor n/N\rfloor|}`, why: <>block-rate AR(1)：相隔 <Tex>{'\\ell'}</Tex> 個 block 的相關是 <Tex>{'\\sigma_w^2p^{|\\ell|}'}</Tex>。</> },
          { tex: String.raw`\text{上式依賴 }n\ \Rightarrow\ \text{週期 }L=\mathrm{lcm}(P,N)\text{ 的 cyclostationary 序列}`, why: <>第一個因子以 <Tex>{'P'}</Tex> 為週期、第二個以 <Tex>{'N'}</Tex> 為週期；兩者一起以 <Tex>{'L'}</Tex> 為週期。</> },
          { tex: String.raw`\bar R_{\delta t}[m]=\frac1L\sum_{n=0}^{L-1}x[n]x[n+m]\,\sigma_w^2\,p^{\,|\lfloor (n+m)/N\rfloor-\lfloor n/N\rfloor|}`, why: '頻譜儀量到的是時間平均（F-R2.1）。' },
          { tex: String.raw`\Big\lfloor\tfrac{n+m}{N}\Big\rfloor-\Big\lfloor\tfrac nN\Big\rfloor=\Big\lfloor\tfrac{r+m}{N}\Big\rfloor,\qquad r=n\bmod N`, why: <>寫 <Tex>{'n=qN+r'}</Tex>，<Tex>{'q'}</Tex> 在兩項中相消：第二個因子只依賴 <Tex>{'n\\bmod N'}</Tex>。</> },
          { tex: String.raw`\gcd(P,N)=1:\ \frac1L\sum_{n=0}^{L-1}f(n\bmod P)\,g(n\bmod N)=\Big(\frac1P\sum_{a=0}^{P-1}f(a)\Big)\Big(\frac1N\sum_{r=0}^{N-1}g(r)\Big)`, why: <>CRT：<Tex>{'L=PN'}</Tex> 個 <Tex>{'n'}</Tex> 恰好走遍每一對 <Tex>{'(a,r)'}</Tex> 一次，雙重和拆成兩個單和的乘積。</> },
        ]}
        result={String.raw`\gcd(P,N)=1\;\Rightarrow\;\bar R_{\delta t}[m]=\bar R_x[m]\cdot\bar R_w[m]\qquad(\text{F-R2.2})`}
      />
      <p>
        <ClaimTag kind="exact" /> 互質時，<ChRef ch="12">第 12 章</ChRef>「<Tex>{'x'}</Tex> 與 <Tex>{'\\delta w'}</Tex> 獨立平穩、<Tex>{'S_{\\delta t}=S_x\\circledast S_w'}</Tex>」的時間平均公式是精確的；
        <Tex>{'\\gcd>1'}</Tex> 時，block 邊界只看得到一部分 code 相位，近似會偏（上方實驗量化偏多少）。其中 ZOH 的時間平均自相關是
      </p>
      <TexBlock>{String.raw`\bar R_w[m]=\sigma_w^2\Big[\Big(1-\frac{m'}{N}\Big)p^{q}+\frac{m'}{N}p^{q+1}\Big],\qquad m=qN+m',\ 0\le m'<N`}</TexBlock>
      <p className="small">
        （<Tex>{'r<N-m^\\prime'}</Tex> 時沒有跨到下一個 block，否則多跨一個。）它的 DTFT 就是<ChRef ch="12">第 12 章</ChRef>的 Fejér 權重 <Tex>{String.raw`\frac1N\big[\frac{\sin(N\Omega/2)}{\sin(\Omega/2)}\big]^2S_w^{(f_u)}(e^{jN\Omega})`}</Tex>。
      </p>

      <HandCalc def={roadmapHandCalc('HC-RM.2')} />
      <R2Experiment />
      <TryIt
        items={[
          <>預設 <Tex>{'P=8,N=16'}</Tex>：虛線（獨立近似）在跨 block 的 lag 上偏離實線；把 <Tex>{'N'}</Tex> 改成 15，兩條線重合（指標表中的相對誤差掉到浮點捨入等級）。</>,
          <>把 <Tex>{'p'}</Tex> 拉到 0.99：跨 block 幾乎不衰減，同步造成的誤差變小——偏差來自「跨 block 的那一步」。</>,
          <>右圖的瞬時變異數 <Tex>{'x[n]^2'}</Tex> 以 <Tex>{'P'}</Tex> 為週期起伏：這就是 cyclostationary。</>,
        ]}
      />
      <Observe>
        只差一個 sample（<Tex>{'N=15'}</Tex> 與 <Tex>{'N=16'}</Tex>），「獨立平穩」公式就從精確變成近似。R2 真正要做的是在 MASH、真實 FCW 與 LMS 相關（<Tex>{'\\delta w'}</Tex> 由 <Tex>{'q\\cdot x'}</Tex> 產生）的情況下，分離週期性 spur 與連續 PSD。
      </Observe>
      <h4>核心程式碼：精確式與近似只差標示的兩行</h4>
      <CodeBlock source={modelSrc} region="cycloAutocorr" path={PATH} caption="同一個迴圈裡同時算精確時間平均（含 block 相位）與「各自平均再相乘」的近似。" />
      <ModeGate min="research">
        <h4>Research：cyclic autocorrelation</h4>
        <p>
          完整描述用 cyclic autocorrelation <Tex>{String.raw`R^{(\alpha)}[m]=\frac1L\sum_{n=0}^{L-1}E[\delta t[n]\delta t[n+m]]e^{-j\alpha n}`}</Tex>，<Tex>{'\\alpha=2\\pi k/L'}</Tex>。
          <Tex>{'\\alpha=0'}</Tex> 就是上面的 <Tex>{'\\bar R'}</Tex>；<Tex>{'\\alpha\\ne0'}</Tex> 的成分代表「頻率 <Tex>{'f'}</Tex> 與 <Tex>{'f-\\alpha f_s/2\\pi'}</Tex> 相干」，PLL 的線性濾波（<Tex>{'T(f)'}</Tex>）會把它們搬回同一個頻率而產生交叉項。
          <ClaimTag kind="research" /> 本站尚未實作 <Tex>{'R^{(\\alpha)}'}</Tex>。
        </p>
      </ModeGate>
    </div>
  )
}
