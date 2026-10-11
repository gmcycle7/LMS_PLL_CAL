import { useEffect, useMemo, useState } from 'react'
import type { Data } from 'plotly.js-dist-min'
import {
  Callout,
  ClaimTag,
  CodeBlock,
  Derivation,
  ModeGate,
  ModelLevel,
  Plot,
  Section,
  SourceTag,
  Tex,
  TexBlock,
  useThemeTokens,
} from '@/components'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import optimizerSrc from '@/simulation/models/optimizer.ts?raw'
import { comparatorKq, msdSplit, optimizeMu, type LinearityCheckParams, type LinearityCheckResult } from '@/simulation/models/optimizer'
import { Diagram } from '../Diagram'
import { CHART_E48_REGIMES, CHART_MSD_SPLIT, CHART_POLE_REGIMES, CHART_SAMPLE_TO_BLOCK } from '../diagrams'
import { Hand } from '../Hand'
import { BIAS2, ErratumNote, md, nf, Steps, tx } from '../shared'

const E48_PARAMS: LinearityCheckParams = { seed: 48014, sigmaV: 100, N: 4096, mu: 10, B: 30, ratios: [0.1, 0.2, 0.3, 0.5, 1, 2, 4], chains: 1500 }

/** E48 適用範圍表：δ0/σ_v 變大時線性公式低估多少（worker 計算，exact-binomial Sign-GMAC）。 */
function E48Table() {
  const task = useWorkerTask<LinearityCheckParams, LinearityCheckResult>('optimizer', 'runLinearityCheck')
  const [res, setRes] = useState<LinearityCheckResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const { run } = task
  useEffect(() => {
    run(E48_PARAMS).then(setRes, (e: unknown) => {
      if (!isWorkerCancelled(e)) setErr(e instanceof Error ? e.message : String(e))
    })
  }, [run])
  const K = comparatorKq(100)
  return (
    <div>
      <p className="small muted">
        條件：<Tex>{'\\sigma_v=100\\,\\mathrm{fs},\\ N=4096,\\ \\mu=10\\,\\mathrm{fs}\\ (g=' + tx(10 * K, 4) + '),\\ B=30,\\ x=\\pm1'}</Tex>，每列 {E48_PARAMS.chains} 條
        exact-binomial Sign-GMAC chain（seed {E48_PARAMS.seed}）<SourceTag kind="simulation" />
      </p>
      {err && <Callout kind="danger">Monte Carlo 失敗：{err}</Callout>}
      {!res && !err && <p className="small muted">Monte Carlo 計算中（Web Worker）…</p>}
      {res && (
        <div className="table-wrap">
          <table className="ch14-table">
            <thead>
              <tr>
                <th>
                  <Tex>{'\\delta_0/\\sigma_v'}</Tex>
                </th>
                <th>
                  <Tex>{'\\delta_0\\ (\\mathrm{fs})'}</Tex>
                </th>
                <th>
                  MC <Tex>{'E[\\delta_B^2]\\ (\\mathrm{fs^2})'}</Tex> [95% CI]
                </th>
                <th>線性 F-14.3</th>
                <th>線性的相對誤差</th>
                <th>
                  MC <Tex>{'E[\\delta_B]'}</Tex> vs <Tex>{'p^B\\delta_0'}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              {Array.from(res.ratios).map((r, i) => (
                <tr key={r} className={Math.abs(res.relErr[i]) > 0.1 ? 'is-bad' : ''}>
                  <td className="num">{r}</td>
                  <td className="num">{nf(res.delta0[i], 4)}</td>
                  <td className="num">
                    {nf(res.msd[i], 4)} [{nf(res.lo[i], 4)}, {nf(res.hi[i], 4)}]
                  </td>
                  <td className="num">{nf(res.linear[i], 4)}</td>
                  <td className="num">{(100 * res.relErr[i]).toFixed(1)}%</td>
                  <td className="num">
                    {nf(res.meanMc[i], 4)} vs {nf(res.meanLinear[i], 4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted">
        對照：validation.md E48 以獨立的 Python Monte Carlo（200k trials）得到 <Tex>{'-0.7\\%\\,/\\,-4.6\\%\\,/\\,-17.0\\%\\,/\\,-52.2\\%\\,/\\,-91.5\\%'}</Tex>（
        <Tex>{'\\delta_0=10/50/100/200/400\\,\\mathrm{fs}'}</Tex>）。上表每列只有{' '}
        {E48_PARAMS.chains} 條 chain：<Tex>{'\\delta_B'}</Tex> 近似高斯時 <Tex>{'\\mathrm{Var}(\\delta_B^2)\\approx2E[\\delta_B^2]^2'}</Tex>，相對標準誤 <Tex>{'\\approx\\sqrt{2/1500}\\approx3.7\\%'}</Tex>（95% CI 約 <Tex>{'\\pm7\\%'}</Tex>），
        所以小 <Tex>{'\\delta_0'}</Tex> 列的 <Tex>{'\\pm1\\%'}</Tex> 差異看不出來；大 <Tex>{'\\delta_0'}</Tex> 的低估遠大於抽樣誤差。
      </p>
    </div>
  )
}

/** E[δ_B²] 對 B 的分解圖（固定 μ）：bias² 單調下降、variance 單調上升到 σ_w²。 */
function DecompositionPlot() {
  const tokens = useThemeTokens()
  const K = comparatorKq(100)
  const s2 = 1 / 4096
  // μ 取第 10 課條件（B = 32）的數值最佳點，而不是手寫常數
  const mu = useMemo(() => optimizeMu('final', { K, delta0: 3, sigmaEta2: s2, B: 32 }).mu, [K, s2])
  const data = useMemo<Data[]>(() => {
    const p = 1 - mu * K
    const ks = Array.from({ length: 81 }, (_, k) => k)
    const parts = ks.map((k) => msdSplit(3, p, mu, s2, k))
    return [
      { x: ks, y: parts.map((q) => q.total), name: 'E[δ_k²]（總和）', line: { color: tokens.series[0], width: 2.5 } },
      { x: ks, y: parts.map((q) => q.bias2), name: 'bias² = p²ᵏ·δ0²', line: { color: tokens.series[1], dash: 'dash' } },
      { x: ks, y: parts.map((q) => q.variance), name: 'variance', line: { color: tokens.series[2], dash: 'dot' } },
    ]
  }, [K, mu, s2, tokens])
  return (
    <Plot
      title={String.raw`$E[\delta_k^2]=\text{bias}^2+\text{variance}$（$\delta_0=3\,\mathrm{fs}$、$\mu=\mu^*=${tx(mu, 4)}\,\mathrm{fs}$、$\sigma_v=100\,\mathrm{fs}$、$N=4096$）`}
      data={data}
      yLog
      height={300}
      csvName="ch14-bias-variance-vs-k"
      layout={{ xaxis: { title: { text: '更新次數 k（blocks）' } }, yaxis: { title: { text: 'fs²' } } }}
      caption={md(String.raw`$\mu$ 是 $B=32$ 時的最佳點（§14.2 (a)）。交點附近就是「再多跑也不會更好」的地方；$B=32$ 時 $\text{bias}^2$ 已低於 variance。`)}
    />
  )
}

/** §14.1：一步一步推導 E[δ_B²]（F-14.1–F-14.6；勘誤 E48） */
export function S2Msd() {
  return (
    <Section kind="formula" level={2} title={md(String.raw`14.1 一步一步推導 $E[\delta_B^2]$：$\text{bias}^2+\text{variance}$`)} id="ch14-msd">
      <p>
        <ModelLevel level="L1" /> 單參數、近鎖定、每個 block 的 GMAC 雜訊 iid。我們要算 B 次更新後的均方誤差 <Tex>{'E[\\delta_B^2]'}</Tex>。推導之前先看兩張圖：第一張說明「每個 block 的一個數 <Tex>{'G_k'}</Tex>」是怎麼從{' '}
        <Tex>{'N'}</Tex> 個 comparator 樣本來的，第二張說明 <Tex>{'B'}</Tex> 個 block 之後的誤差由哪兩部分組成。
      </p>
      <Diagram chart={CHART_SAMPLE_TO_BLOCK} caption="從 sample rate 到 block rate：標著 sample rate 的框每個 comparator 樣本做一次，標著 block rate 的框每 $N$ 個樣本才做一次；虛線表示誤差在一個 block 內不變。">
        <p>
          <strong>先看</strong>標著 sample rate 的框（索引 <Tex>{'n'}</Tex>），由左到右：code <Tex>{'x[n]'}</Tex> 經過 PLL 誤差路徑變成 <Tex>{'u[n]'}</Tex>，乘上這個 block 的誤差 <Tex>{'\\delta_k'}</Tex>，再和 RMS 為 <Tex>{'\\sigma_v'}</Tex> 的雜訊 <Tex>{'v[n]'}</Tex> 在加法點相加（兩條線都是正號），
          得到 comparator 看到的 <Tex>{'e[n]=\\delta_k\\,u[n]+v[n]'}</Tex>。comparator 只輸出正負號 <Tex>{'q[n]=\\pm1'}</Tex>，再乘上 code <Tex>{'x[n]'}</Tex>。<strong>再看</strong>標著 block rate 的框（索引 <Tex>{'k'}</Tex>，更新率 <Tex>{'f_u=f_s/N'}</Tex>）：GMAC 把 <Tex>{'N'}</Tex> 個{' '}
          <Tex>{'q[n]x[n]'}</Tex> 平均成一個數 <Tex>{'G_k'}</Tex>，乘 <Tex>{'\\mu'}</Tex> 加進暫存器。虛線是回授：整個 block 內 <Tex>{'w_k'}</Tex> 不變（新的 <Tex>{'w_{k+1}'}</Tex> 要到下個 block 才生效，這就是「無更新延遲 <Tex>{'d=0'}</Tex>」的意思），所以 <Tex>{'\\delta_k'}</Tex> 在 <Tex>{'N'}</Tex> 個樣本內也不變。
        </p>
        <p>
          圖上加法點輸出的「<Tex>{'e[n]=\\delta_k\\,u[n]+v[n]'}</Tex>」就是 comparator 的輸入；藍色方塊輸出的「<Tex>{'G_k\\approx K\\delta_k+\\eta_k'}</Tex>」是下面推導的第 1 步：平均值對誤差的斜率 <Tex>{'K=K_qC'}</Tex>（<Tex>{'K_q=\\sqrt{2/\\pi}/\\sigma_v'}</Tex> 是 comparator 的小訊號增益，<Tex>{'C=E[x\\,u]'}</Tex>{' '}
          是 <Tex>{'x'}</Tex> 與 <Tex>{'u'}</Tex> 的有效相關），<Tex>{'\\eta_k'}</Tex> 是平均不掉的隨機部分；block rate 框裡的更新式則是第 2 步。
        </p>
      </Diagram>
      <Diagram chart={CHART_MSD_SPLIT} caption="把遞迴展開後的兩條路：一條是初始誤差留下來的部分，另一條是累積的雜訊；兩條路互不干擾，平方後各自變成一塊。">
        <p>
          <strong>先看</strong>從 <Tex>{'\\delta_0'}</Tex> 出發的那條路：初始誤差每過一個 block 乘一次 pole <Tex>{'p=1-\\mu K'}</Tex>，<Tex>{'B'}</Tex> 個 block 後剩下 <Tex>{'p^B\\delta_0'}</Tex>，這就是平均誤差 <Tex>{'E[\\delta_B]'}</Tex>。
          <strong>再看</strong>從雜訊出發的那條路：第 <Tex>{'k'}</Tex> 個 block 進來的雜訊 <Tex>{'\\eta_k'}</Tex> 先乘 <Tex>{'\\mu'}</Tex>，之後還要再被 <Tex>{'p'}</Tex> 乘 <Tex>{'B-1-k'}</Tex> 次，所以越早進來的雜訊留下的越少；全部加起來，在加法點以負號併入（來自{' '}
          <Tex>{'\\delta=a-w'}</Tex> 的極性）。
        </p>
        <p>
          圖上藍色方塊就是公式裡的 {BIAS2} <Tex>{'=\\delta_0^2p^{2B}'}</Tex>（初始誤差那條路的平方），棕色方塊就是 variance（雜訊那條路的變異數）；兩條路的交叉項因為 <Tex>{'E[\\eta_k]=0'}</Tex> 而消失，所以均方誤差就是兩塊相加——這正是推導最後得到的
          F-14.3。進加法點的兩條線合起來，是推導第 4 步的 <Tex>{'\\delta_B=p^B\\delta_0-\\mu\\sum_k p^{B-1-k}\\eta_k'}</Tex>。
        </p>
      </Diagram>
      <Steps
        title="從 GMAC 線性化到封閉式"
        steps={[
          {
            tex: String.raw`G_k=\frac1N\sum_{n}q[n]x[n]\approx K\delta_k+\eta_k,\qquad K=K_qC`,
            why: (
              <>
                block 平均輸出 = 平均值 + 擾動。平均值 <Tex>{'E[G|\\delta]=E[x\\,\\mathrm{erf}(\\delta u/(\\sqrt2\\sigma_v))]'}</Tex>（<Tex>{'\\theta=0'}</Tex> 時就是 <Tex>{'\\mathrm{erf}(\\delta C/(\\sqrt2\\sigma_v))'}</Tex>）在 <Tex>{'\\delta=0'}</Tex> 做泰勒一階展開，斜率是{' '}
                <Tex>{'K_qE[xu]=K_qC'}</Tex>；<Tex>{'\\eta_k'}</Tex> 是 <Tex>{'N'}</Tex> 個 <Tex>{'q\\,x=\\pm1'}</Tex> 平均的隨機部分，<Tex>{'E[\\eta_k]=0'}</Tex>、
                <Tex>{'\\mathrm{Var}(\\eta_k)=(1-m^2)/N\\approx1/N'}</Tex>（<Tex>{'N'}</Tex> 個獨立 <Tex>{'\\pm1'}</Tex> 的平均，<Tex>{'m=E[qx]\\approx0'}</Tex>）。
              </>
            ),
          },
          {
            tex: String.raw`\delta_{k+1}=a-w_{k+1}=a-(w_k+\mu G_k)=\delta_k-\mu G_k`,
            why: <>代入更新式 <Tex>{'w_{k+1}=w_k+\\mu G_k'}</Tex> 與定義 <Tex>{'\\delta=a-w'}</Tex>。</>,
          },
          {
            tex: String.raw`\delta_{k+1}=\delta_k-\mu(K\delta_k+\eta_k)=(1-\mu K)\delta_k-\mu\eta_k=p\,\delta_k-\mu\eta_k`,
            why: <>代入第 1 步的線性化，把 <Tex>{'\\delta_k'}</Tex> 的項合併；定義 <Tex>{'p=1-g'}</Tex>、<Tex>{'g=\\mu K'}</Tex>。</>,
          },
          {
            tex: String.raw`\begin{aligned}\delta_1&=p\delta_0-\mu\eta_0\\ \delta_2&=p\delta_1-\mu\eta_1=p^2\delta_0-\mu(p\eta_0+\eta_1)\\ \delta_B&=p^B\delta_0-\mu\sum_{k=0}^{B-1}p^{B-1-k}\eta_k\end{aligned}`,
            why: <>把遞迴往回代（unroll）：每過一個 block，舊的雜訊再乘一次 <Tex>{'p'}</Tex>。</>,
          },
          {
            tex: String.raw`E[\delta_B]=p^B\delta_0-\mu\sum_{k}p^{B-1-k}\underbrace{E[\eta_k]}_{0}=p^B\delta_0`,
            why: <>取期望值（線性運算，可以逐項取）；<Tex>{'\\delta_0'}</Tex> 是確定值；雜訊平均為 0。</>,
          },
          {
            tex: String.raw`\delta_B^2=p^{2B}\delta_0^2-2p^B\delta_0\,\mu\sum_k p^{B-1-k}\eta_k+\mu^2\Big(\sum_k p^{B-1-k}\eta_k\Big)^2`,
            why: <>平方展開 <Tex>{'(u-v)^2=u^2-2uv+v^2'}</Tex>。</>,
          },
          {
            tex: String.raw`E[\delta_B^2]=p^{2B}\delta_0^2+\mu^2\,E\Big[\Big(\sum_k p^{B-1-k}\eta_k\Big)^2\Big]`,
            why: <>交叉項的期望值 <Tex>{'=\\text{常數}\\times E[\\eta_k]=0'}</Tex>，消失。</>,
          },
          {
            tex: String.raw`E\Big[\Big(\sum_k c_k\eta_k\Big)^2\Big]=\sum_k\sum_j c_kc_jE[\eta_k\eta_j]=\sigma_\eta^2\sum_{k=0}^{B-1}p^{2(B-1-k)}`,
            why: <>不同 block 的雜訊獨立：<Tex>{'E[\\eta_k\\eta_j]=0\\ (k\\ne j)'}</Tex>，只剩 k = j 的對角項 <Tex>{'c_k^2\\sigma_\\eta^2'}</Tex>，<Tex>{'c_k=p^{B-1-k}'}</Tex>。</>,
          },
          {
            tex: String.raw`\sum_{k=0}^{B-1}p^{2(B-1-k)}=\sum_{m=0}^{B-1}(p^2)^m=\frac{1-p^{2B}}{1-p^2}`,
            why: <>換變數 <Tex>{'m=B-1-k'}</Tex>，是公比 <Tex>{'p^2'}</Tex> 的等比數列。</>,
          },
        ]}
        result={String.raw`E[\delta_B^2]=\underbrace{\delta_0^2p^{2B}}_{\text{bias}^2=(E[\delta_B])^2}+\underbrace{\mu^2\sigma_\eta^2\frac{1-p^{2B}}{1-p^2}}_{\text{variance}=\mathrm{Var}(\delta_B)}`}
      />
      <TexBlock id="F-14.1" label="線性化遞迴">
        {String.raw`\delta_{k+1}=p\,\delta_k-\mu\eta_k,\qquad p=1-\mu K`}
      </TexBlock>
      <TexBlock id="F-14.2" label="平均誤差">
        {String.raw`E[\delta_B]=p^B\delta_0`}
      </TexBlock>
      <TexBlock id="F-14.3" label={md('$B$ 次更新後的均方誤差')}>
        {String.raw`\boxed{E[\delta_B^2]=\delta_0^2p^{2B}+\mu^2\sigma_\eta^2\frac{1-p^{2B}}{1-p^2}}`}
      </TexBlock>
      <p>
        <ClaimTag kind="exact" /> 對線性化 iid 模型精確（<Tex>{'\\eta'}</Tex> 任意分布、<Tex>{'p<0'}</Tex> 也成立——推導只用到 <Tex>{'E[\\eta]=0'}</Tex> 與獨立性）；<ClaimTag kind="approx" /> 對真正的 1-bit Sign-LMS 只是近似。
      </p>
      <ErratumNote id="E48">
        規格把此式標為近似（<Tex>{'\\approx'}</Tex>）卻沒有說何時失效。本站標示：<strong>[精確｜線性化 iid 模型]</strong>；對 1-bit Sign-LMS 為 <strong>[近似｜需驗證]</strong>，只在
        <Tex>{'|\\delta_0|\\ll\\sigma_v'}</Tex> 時成立（<Tex>{'\\delta_0\\lesssim0.2\\sigma_v'}</Tex> 誤差 <Tex>{'\\le1\\%'}</Tex>、<Tex>{'\\delta_0=0.5\\sigma_v'}</Tex> 低估約 5%、<Tex>{'\\delta_0=\\sigma_v'}</Tex> 低估約 17%、
        <Tex>{'\\delta_0=2\\sigma_v'}</Tex> 低估約 52%）。另補上 <Tex>{'p^2=1'}</Tex> 的極限，以及 coarse 階段的 slew-limited 估計。
      </ErratumNote>
      <Hand id="HC-14.2">
        用 F-14.3 完整算一次 <Tex>{'E[\\delta_B^2]'}</Tex>：預設值是 golden vector 的條件（<Tex>{'\\delta_0=20\\,\\mathrm{fs},\\ \\mu=10\\,\\mathrm{fs},\\ B=20'}</Tex>）。先自己按計算機，再把 <Tex>{'B'}</Tex> 改成 40、80，看 {BIAS2} 與 variance 誰先變成主角。
      </Hand>

      <DecompositionPlot />

      <h3>
        雜訊項的化簡：為什麼它等於 §12 的 <Tex>{'\\sigma_w^2'}</Tex>
      </h3>
      <Steps
        steps={[
          { tex: String.raw`1-p^2=(1-p)(1+p)=g(2-g)=\mu K(2-\mu K)`, why: <>平方差公式，再代入 <Tex>{'p=1-g'}</Tex>。</> },
          { tex: String.raw`\frac{\mu^2}{1-p^2}=\frac{\mu^2}{\mu K(2-\mu K)}=\frac{\mu}{K(2-\mu K)}`, why: <>約掉一個 <Tex>{'\\mu'}</Tex>（<Tex>{'\\mu>0'}</Tex>）。</> },
          { tex: String.raw`\lim_{B\to\infty}E[\delta_B^2]=\frac{\mu^2\sigma_\eta^2}{1-p^2}=\frac{\mu\sigma_\eta^2}{K(2-\mu K)}=\sigma_w^2`, why: <><Tex>{'|p|<1'}</Tex> 時 <Tex>{'p^{2B}\\to0'}</Tex>：{BIAS2} 消失、variance 收斂到穩態。</> },
        ]}
      />
      <TexBlock id="F-14.6" label="雜訊項化簡與穩態">
        {String.raw`\frac{\mu^2}{1-p^2}=\frac{\mu}{K(2-\mu K)},\qquad \sigma_w^2=\frac{\mu\sigma_\eta^2}{K(2-\mu K)}\approx\frac{\mu\sigma_\eta^2}{2K}\ (g\ll1)`}
      </TexBlock>
      <p>
        這裡 <Tex>{'\\sigma_w^2'}</Tex> 是跑了很久之後係數誤差的變異數（穩態雜訊，§12）。小 <Tex>{'g'}</Tex> 時 <Tex>{'\\sigma_w^2\\propto\\mu'}</Tex>：<strong><Tex>{'\\mu'}</Tex> 減半，穩態雜訊功率減半、RMS 只減 <Tex>{'\\sqrt2'}</Tex> 倍</strong>；但收斂的時間常數{' '}
        <Tex>{'\\tau\\approx1/g'}</Tex>（平均誤差縮到 <Tex>{'1/e'}</Tex> 所需的 block 數）加倍。這就是整章的取捨。
      </p>
      <Hand id="HC-14.3">
        「<Tex>{'\\mu'}</Tex> 減半，RMS 只減 <Tex>{'\\sqrt2'}</Tex> 倍、時間卻加倍」——不要只是相信，代兩個候選 <Tex>{'\\mu'}</Tex> 自己算算看（預設的候選 A 就是測試 T13 的條件；時間常數 <Tex>{'\\tau=-1/\\ln|p|'}</Tex> 在 §14.2 (b) 會再出現）。
      </Hand>

      <h3>
        邊界情況：<Tex>{'|p|=1'}</Tex>（勘誤 E48）
      </h3>
      <p>
        F-14.3 的分母 <Tex>{'1-p^2'}</Tex> 在 <Tex>{'p=\\pm1'}</Tex> 時是 0。先看 <Tex>{'g=\\mu K'}</Tex> 從 0 一路加大時，pole <Tex>{'p=1-g'}</Tex> 會經過哪些區段，就知道哪兩個點要特別處理：
      </p>
      <Diagram chart={CHART_POLE_REGIMES} caption={String.raw`迴路增益 $g=\mu K$ 從上到下加大時 pole $p=1-g$ 的走向：綠色是安全區，藍色是一步到位，棕色仍收斂但會正負交替，紅色是 $|p|\ge1$ 的不收斂區。`}>
        <p>
          <strong>先看</strong>最上面的紅色方塊：<Tex>{'g=0'}</Tex> 代表 <Tex>{'K=0'}</Tex>（<Tex>{'C=0'}</Tex>，GMAC 對誤差沒有反應），<Tex>{'p=1'}</Tex>，誤差既不增也不減，雜訊一直累積。<strong>再看</strong>往下的主線：<Tex>{'g'}</Tex> 加大，<Tex>{'p'}</Tex> 從 1 掉到 0（藍色，<Tex>{'g=1'}</Tex>，一步到位）、再變成負的（棕色，
          平均誤差每個 block 正負交替，但幅度仍衰減）。<strong>最後看</strong>最下面兩個紅色方塊：<Tex>{'g=2'}</Tex> 時 <Tex>{'p=-1'}</Tex>，幅度不再衰減；<Tex>{'g>2'}</Tex> 時 <Tex>{'|p|>1'}</Tex>，指數發散。
        </p>
        <p>
          圖上的 <Tex>{'p=1-g'}</Tex> 就是 F-14.1 的 pole；兩個 <Tex>{'|p|=1'}</Tex> 的端點（<Tex>{'g=0'}</Tex> 與 <Tex>{'g=2'}</Tex>）就是下面 F-14.4 要處理的邊界情況；藍色的 <Tex>{'g=1'}</Tex> 就是 §14.2 (b) 的 F-14.10；每個方塊的 phase margin 來自{' '}
          <Tex>{'PM=90^\\circ-\\arcsin(g/2)'}</Tex>（F-14.14）。
        </p>
      </Diagram>
      <Steps
        steps={[
          { tex: String.raw`p^2=1\ \Rightarrow\ \frac{1-p^{2B}}{1-p^2}=\frac00\ (\text{不能直接代})`, why: <><Tex>{'g=0'}</Tex> 或 <Tex>{'g=2'}</Tex> 時分子分母都是 0。</> },
          { tex: String.raw`\frac{1-p^{2B}}{1-p^2}=\sum_{m=0}^{B-1}(p^2)^m=\sum_{m=0}^{B-1}1=B`, why: '回到等比數列的原始和：公比為 1 時每項都是 1。' },
          { tex: String.raw`E[\delta_B^2]=\delta_0^2+B\mu^2\sigma_\eta^2`, why: <>代回 F-14.3（<Tex>{'p^{2B}=1'}</Tex>）。</> },
        ]}
      />
      <TexBlock id="F-14.4" label={md('$|p|=1$ 的極限')}>
        {String.raw`p^2=1:\quad E[\delta_B^2]=\delta_0^2+B\mu^2\sigma_\eta^2`}
      </TexBlock>
      <ul>
        <li>
          <Tex>{'g=0'}</Tex> 而 <Tex>{'\\mu>0'}</Tex> 代表 <Tex>{'K=0'}</Tex>（<Tex>{'C=0'}</Tex>，<Tex>{'\\theta=90^\\circ'}</Tex>）：GMAC 對誤差沒有反應，係數做 <strong>random walk</strong>，均方誤差隨 <Tex>{'B'}</Tex> 線性變大——不是「收斂比較慢」，而是根本不收斂。
        </li>
        <li>
          <Tex>{'g=2'}</Tex>（<Tex>{'p=-1'}</Tex>）：平均誤差正負翻轉、幅度不衰減，<Tex>{'PM=0^\\circ'}</Tex>；<Tex>{'g>2'}</Tex> 指數發散。這兩種都不適用本章的最佳化（穩態不存在）。程式中 <code>geomSum2</code> 對 <Tex>{'p^2\\to1'}</Tex> 用 <code>expm1</code> 避免 <Tex>{'0/0'}</Tex> 相消。
        </li>
      </ul>

      <h3>
        何時失效：<Tex>{'\\delta_0'}</Tex> 大時的 slew-limited 區（勘誤 E48）
      </h3>
      <p>
        線性化 <Tex>{'G_k\\approx K\\delta_k+\\eta_k'}</Tex> 只在誤差遠小於 comparator 雜訊時成立。誤差大時 comparator 幾乎每次都輸出同一個正負號，GMAC 的輸出頂到天花板（<Tex>{'|G_k|\\le\\max|x|'}</Tex>），誤差再大也不會修得更快——這叫
        slew-limited。所以用公式之前，要先判斷自己在哪一區：
      </p>
      <Diagram chart={CHART_E48_REGIMES} caption="先判斷誤差落在哪一區，再決定用哪條公式：綠色可以用線性公式，紅色只能用 slew-limited 估計或 Monte Carlo。">
        <p>
          <strong>先看</strong>最上面的菱形：拿誤差 <Tex>{'|\\delta|'}</Tex> 和 comparator 雜訊 <Tex>{'\\sigma_v'}</Tex> 比。綠色的分支是線性區，F-14.3 可以直接用；紅色的分支是 slew-limited 區，每個 block 最多只能移動{' '}
          <Tex>{'\\mu\\max|x|'}</Tex>，要改用 F-14.5 估 block 數；沒有著色的分支是兩者之間的過渡區，F-14.3 開始低估。<strong>再看</strong>虛線：coarse 階段把誤差拉下來之後，就回到綠色的線性區，Fine／Track 階段才用 F-14.3 設計。
        </p>
        <p>
          圖上紅色方塊裡的「<Tex>{'|G_k|'}</Tex> 最大只有 <Tex>{'\\max|x|'}</Tex>」就是下面「Coarse 階段的粗估」第 1 步的不等式；兩個分界值（<Tex>{'0.2\\sigma_v'}</Tex>、<Tex>{'0.5\\sigma_v'}</Tex>）來自下表的 Monte Carlo。
        </p>
      </Diagram>
      <E48Table />
      <Steps
        title="Coarse 階段的粗估"
        steps={[
          { tex: String.raw`|G_k|=\Big|\frac1N\sum_n q[n]x[n]\Big|\le\frac1N\sum_n|x[n]|\le\max|x|`, why: <><Tex>{'|q|=1'}</Tex>，三角不等式。</> },
          { tex: String.raw`|w_{k+1}-w_k|=\mu|G_k|\le\mu\max|x|`, why: <>每個 block 最多移動 <Tex>{'\\mu\\max|x|'}</Tex>（slew rate 上限）。</> },
          { tex: String.raw`B\gtrsim\frac{|\delta_0|-\delta_\text{target}}{\mu\max|x|}`, why: (
              <>
                要把誤差從 <Tex>{'|\\delta_0|'}</Tex> 拉到目標，至少要這麼多 block（<Tex>{'|\\delta|\\gg\\sigma_v'}</Tex> 時 <Tex>{'|G|\\approx\\max|x|'}</Tex>，等號近似成立）。
              </>
            ),
          },
        ]}
      />
      <TexBlock id="F-14.5" label="Slew-limited 估計">
        {String.raw`B\gtrsim\frac{|\delta_0|-\delta_\text{target}}{\mu\max|x|}\qquad(|\delta_0|\gtrsim0.5\sigma_v)`}
      </TexBlock>
      <Callout kind="warn" title="設計含意">
        §14.2 的 Coarse Calibration 正好落在這個失效區（大 <Tex>{'\\delta_0'}</Tex>、大步長）。Coarse 的時間要用 F-14.5 或 Monte Carlo 估，不能套 F-14.3；F-14.3 只用在 Fine／Track 階段（<Tex>{'|\\delta|\\ll\\sigma_v'}</Tex>）。
        例：<Tex>{'\\delta_0=100\\,\\mathrm{fs},\\ \\mu=60\\,\\mathrm{fs},\\ x=\\pm1'}</Tex>，目標 10 fs，得 <Tex>{'B\\gtrsim(100-10)/60=1.5'}</Tex>，也就是至少 2 個 block（§14.7 狀態機預設值；實際因 erf 未完全飽和會多幾個）。
      </Callout>
      <Hand id="HC-14.4">
        這一題要查 <Tex>{'\\Phi'}</Tex> 表：親手算出 <Tex>{'\\delta_0=\\sigma_v'}</Tex> 時 comparator 的平均輸出，就會看到線性模型高估了多少恢復力；再用 F-14.5 估 coarse 階段至少要幾個 block。換成你自己的 <Tex>{'\\delta_0'}</Tex>、<Tex>{'\\mu_\\text{coarse}'}</Tex> 試試。
      </Hand>

      <ModeGate min="engineer">
        <Derivation
          title="假設清單與程式碼（網站實際執行的版本）"
          formulaId="F-14.3"
          level="L1"
          claim="exact"
          derivation={
            <>
              <CodeBlock source={optimizerSrc} region="geomSum" path="src/simulation/models/optimizer.ts" />
              <CodeBlock source={optimizerSrc} region="msdAfterBlocks" path="src/simulation/models/optimizer.ts" />
              <CodeBlock source={optimizerSrc} region="slewLimited" path="src/simulation/models/optimizer.ts" />
            </>
          }
          symbols={[
            { symbol: '\\delta_0', meaning: '初始誤差（確定值）', unit: 'fs' },
            { symbol: '\\sigma_\\eta^2', meaning: '每 block GMAC 雜訊變異數', unit: '—' },
            { symbol: 'p=1-\\mu K', meaning: '平均誤差的 pole', unit: '—' },
          ]}
          assumptions={
            <ul>
              <li>{md(String.raw`$G_k\approx K\delta_k+\eta_k$（線性化；$|\delta|\ll\sigma_v$）`)}</li>
              <li>
                {md(
                  String.raw`$\eta_k$ 零均值、不同 block 互相獨立、與 $\delta_k$ 無關（Sign-GMAC 的 $\mathrm{Var}(\eta)=(1-m^2)/N$ 其實與 $\delta$ 有關，近鎖定時可忽略）`,
                )}
              </li>
              <li>{md(String.raw`無更新延遲（$d=0$）、無暫存器量化、$K$ 在校正期間不變`)}</li>
            </ul>
          }
        />
      </ModeGate>
    </Section>
  )
}
