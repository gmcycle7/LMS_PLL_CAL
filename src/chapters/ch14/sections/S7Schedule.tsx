import { useMemo, useState } from 'react'
import type { Data } from 'plotly.js-dist-min'
import {
  Callout,
  ClaimTag,
  CodeBlock,
  CodeCompare,
  ModeGate,
  ParamControl,
  Plot,
  Section,
  SourceTag,
  Tex,
  TexBlock,
  useThemeTokens,
} from '@/components'
import { isWorkerCancelled, useWorkerTask } from '@/workers'
import optimizerSrc from '@/simulation/models/optimizer.ts?raw'
import {
  asymptoticFinalOptimum,
  loopGainK,
  msdAfterBlocks,
  optimalSchedule,
  optimizeMu,
  optimizeTwoPhase,
  twoPhaseMsd,
  type ScheduleMcParams,
  type ScheduleMcResult,
} from '@/simulation/models/optimizer'
import { Hand } from '../Hand'
import { md, nf, Steps, tx } from '../shared'

/** §14.6：步長排程（fixed μ vs two-phase vs 1/k）— 推導、程式碼並排、Monte Carlo */
export function S7Schedule() {
  const tokens = useThemeTokens()
  const [delta0, setDelta0] = useState(3)
  const [sigmaV, setSigmaV] = useState(100)
  const [N, setN] = useState(4096)
  const [B, setB] = useState(32)
  const [chains, setChains] = useState(2000)
  const [seed] = useState(20261017)
  const K = loopGainK(sigmaV, 0)
  const s2 = 1 / N
  const design = useMemo(() => {
    const fixed = optimizeMu('final', { K, delta0, sigmaEta2: s2, B })
    const two = optimizeTwoPhase(delta0, K, s2, B)
    const opt = optimalSchedule(delta0, K, s2, B)
    const asym = asymptoticFinalOptimum({ K, delta0, sigmaEta2: s2, B })
    return { fixed, two, opt, asym }
  }, [K, delta0, s2, B])
  const task = useWorkerTask<ScheduleMcParams, ScheduleMcResult>('optimizer', 'runScheduleMonteCarlo', { restartOnRun: true })
  const [mc, setMc] = useState<{ key: string; res: ScheduleMcResult } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const key = JSON.stringify([delta0, sigmaV, N, B, chains, seed])
  const mcRes = mc && mc.key === key ? mc.res : null
  const run = () => {
    setErr(null)
    task
      .run({
        seed,
        sigmaV,
        N,
        thetaDeg: 0,
        delta0,
        B,
        muFixed: design.fixed.mu,
        muCoarse: design.two.mu1,
        muFine: design.two.mu2,
        switchBlock: design.two.B1,
        chains,
      })
      .then(
        (res) => setMc({ key, res }),
        (e: unknown) => {
          if (!isWorkerCancelled(e)) setErr(e instanceof Error ? e.message : String(e))
        },
      )
  }
  const ks = useMemo(() => Array.from({ length: B + 1 }, (_, k) => k), [B])
  const data = useMemo<Data[]>(() => {
    const linFixed = ks.map((k) => msdAfterBlocks(delta0, 1 - design.fixed.mu * K, design.fixed.mu, s2, k))
    const linTwo = ks.map((k) => {
      const b1 = Math.min(k, design.two.B1)
      return twoPhaseMsd(delta0, K, s2, design.two.mu1, b1, design.two.mu2, k - b1)
    })
    const d: Data[] = [
      { x: ks, y: linFixed, name: `固定 μ* = ${nf(design.fixed.mu, 4)} fs（解析）`, line: { color: tokens.series[0], width: 2.2 } },
      { x: ks, y: linTwo, name: `兩段式 ${nf(design.two.mu1, 3)} → ${nf(design.two.mu2, 3)} fs @ k = ${design.two.B1}（解析）`, line: { color: tokens.series[1], width: 2.2 } },
      { x: ks, y: Array.from(design.opt.P), name: '1/k 最佳排程 P_k（解析下界）', line: { color: tokens.series[2], width: 2.2 } },
    ]
    if (mcRes) {
      d.push(
        { x: ks, y: Array.from(mcRes.fixed), name: 'MC 固定 μ', mode: 'markers', marker: { color: tokens.series[0], size: 5 } },
        { x: ks, y: Array.from(mcRes.twoPhase), name: 'MC 兩段式', mode: 'markers', marker: { color: tokens.series[1], size: 5, symbol: 'square' } },
        { x: ks, y: Array.from(mcRes.inverseK), name: 'MC 1/k', mode: 'markers', marker: { color: tokens.series[2], size: 5, symbol: 'diamond' } },
      )
    }
    return d
  }, [ks, delta0, design, K, s2, mcRes, tokens])
  const muData = useMemo<Data[]>(
    () => [
      { x: ks.slice(0, B), y: ks.slice(0, B).map(() => design.fixed.mu), name: '固定 μ*', line: { color: tokens.series[0], shape: 'hv' } },
      { x: ks.slice(0, B), y: ks.slice(0, B).map((k) => (k < design.two.B1 ? design.two.mu1 : design.two.mu2)), name: '兩段式', line: { color: tokens.series[1], shape: 'hv' } },
      { x: ks.slice(0, B), y: Array.from(design.opt.mu), name: 'μ_k = 1/(K(k+1+k₀))', line: { color: tokens.series[2] } },
    ],
    [ks, B, design, tokens],
  )
  const rmsFixed = Math.sqrt(design.fixed.cost)
  const rmsTwo = Math.sqrt(design.two.msd)
  const rmsOpt = Math.sqrt(design.opt.PB)
  const ratioPred = (1 + Math.log(design.asym.A)) / 4
  return (
    <Section kind="explore" level={2} title={md(String.raw`14.6 步長排程：先大後小，為什麼一定比固定 $\mu$ 好？`)} id="ch14-schedule">
      <p>
        固定 <Tex>{'\\mu'}</Tex> 的兩難：大 <Tex>{'\\mu'}</Tex> 收斂快但雜訊大，小 <Tex>{'\\mu'}</Tex> 雜訊小但收斂慢。最自然的解法——<strong>開始時用大步長，接近答案後換小步長</strong>（gear shifting）。
        兩段式包含固定 <Tex>{'\\mu'}</Tex>（<Tex>{'\\mu_1=\\mu_2'}</Tex>）當特例，所以最佳化後<strong>不可能比固定 <Tex>{'\\mu'}</Tex> 差</strong>（線性模型內）。我們先算出「最好能好到哪裡」，再看兩段式能拿到多少。
      </p>
      <h3>兩段式的精確公式</h3>
      <Steps
        steps={[
          { tex: String.raw`m_{k+1}\equiv E[\delta_{k+1}^2]=p^2m_k+\mu^2\sigma_\eta^2`, why: <>F-14.1 平方取期望；交叉項 <Tex>{'E[\\delta_k\\eta_k]=0'}</Tex>（<Tex>{'\\eta_k'}</Tex> 與過去獨立、平均為 0）。這條遞迴對 <Tex>{'m'}</Tex> 是線性的。</> },
          { tex: String.raw`m_{B_1}=\delta_0^2p_1^{2B_1}+\mu_1^2\sigma_\eta^2\frac{1-p_1^{2B_1}}{1-p_1^2}`, why: <>第一段（coarse <Tex>{'\\mu_1'}</Tex>，<Tex>{'p_1=1-\\mu_1K'}</Tex>）就是 F-14.3。</> },
          { tex: String.raw`m_{B_1+B_2}=m_{B_1}p_2^{2B_2}+\mu_2^2\sigma_\eta^2\frac{1-p_2^{2B_2}}{1-p_2^2}`, why: <>第二段從「初始均方誤差 <Tex>{'m_{B_1}'}</Tex>」開始：F-14.3 的推導只用到 <Tex>{'E[\\delta_0^2]'}</Tex>，所以把 <Tex>{'\\delta_0^2'}</Tex> 換成 <Tex>{'m_{B_1}'}</Tex>。</> },
        ]}
      />
      <TexBlock id="F-14.20" label="兩段式">
        {String.raw`E[\delta_{B_1+B_2}^2]=m_{B_1}p_2^{2B_2}+\mu_2^2\sigma_\eta^2\frac{1-p_2^{2B_2}}{1-p_2^2},\quad m_{B_1}=E[\delta_{B_1}^2]\big|_{\mu_1}`}
      </TexBlock>
      <h3>
        最好能多好？每一步都最佳化 <Tex>{'\\mu_k'}</Tex>（scalar Kalman）
      </h3>
      <Steps
        steps={[
          { tex: String.raw`P_{k+1}=(1-\mu_kK)^2P_k+\mu_k^2\sigma_\eta^2`, why: <>同上，但每個 block 可以用不同 <Tex>{'\\mu_k'}</Tex>；<Tex>{'P_k\\equiv E[\\delta_k^2]'}</Tex>。</> },
          { tex: String.raw`\frac{\partial P_{k+1}}{\partial\mu_k}=-2K(1-\mu_kK)P_k+2\mu_k\sigma_\eta^2=0`, why: <>對 <Tex>{'\\mu_k'}</Tex> 微分（<Tex>{'P_k'}</Tex> 已確定）；二次函數開口向上，所以零點是最小值。</> },
          { tex: String.raw`\mu_k=\frac{KP_k}{K^2P_k+\sigma_\eta^2}`, why: <>解 <Tex>{'\\mu_k'}</Tex> 的一次方程：<Tex>{'\\mu_k(K^2P_k+\\sigma_\\eta^2)=KP_k'}</Tex>。</> },
          { tex: String.raw`1-\mu_kK=\frac{\sigma_\eta^2}{K^2P_k+\sigma_\eta^2}\Rightarrow P_{k+1}=\frac{\sigma_\eta^4P_k+K^2P_k^2\sigma_\eta^2}{(K^2P_k+\sigma_\eta^2)^2}=\frac{P_k\sigma_\eta^2}{K^2P_k+\sigma_\eta^2}`, why: <>代回 <Tex>{'P_{k+1}'}</Tex>，分子提出 <Tex>{'\\sigma_\\eta^2P_k(\\sigma_\\eta^2+K^2P_k)'}</Tex> 後約分。</> },
          { tex: String.raw`\frac1{P_{k+1}}=\frac1{P_k}+\frac{K^2}{\sigma_\eta^2}\Rightarrow\frac1{P_B}=\frac1{\delta_0^2}+\frac{BK^2}{\sigma_\eta^2}`, why: <>取倒數：每個 block 增加固定的「資訊量」<Tex>{'K^2/\\sigma_\\eta^2'}</Tex>，從 <Tex>{'1/P_0=1/\\delta_0^2'}</Tex> 累加 <Tex>{'B'}</Tex> 次。</> },
          { tex: String.raw`\mu_k=\frac{1}{K(k+1+k_0)},\quad k_0=\frac{\sigma_\eta^2}{K^2\delta_0^2}`, why: <>把 <Tex>{'1/P_k=1/\\delta_0^2+kK^2/\\sigma_\\eta^2'}</Tex> 代回 <Tex>{'\\mu_kK=1/(1+\\sigma_\\eta^2/(K^2P_k))=1/(1+k_0+k)'}</Tex>。</> },
        ]}
      />
      <TexBlock id="F-14.18" label="最佳遞減步長">
        {String.raw`\boxed{\mu_k=\frac{1}{K(k+1+k_0)},\qquad P_B=\frac{\delta_0^2}{1+B\delta_0^2K^2/\sigma_\eta^2}\approx\frac{\sigma_\eta^2}{BK^2}}`}
      </TexBlock>
      <p>
        <ClaimTag kind="exact" /> 線性模型、<Tex>{'K'}</Tex> 與 <Tex>{'\\delta_0^2'}</Tex> 已知時，這是 <Tex>{'B'}</Tex> 次更新的下界（每一步的最佳 <Tex>{'P_{k+1}'}</Tex> 對 <Tex>{'P_k'}</Tex> 單調遞增，所以逐步貪婪最佳 = 整體最佳）。
        直覺：<Tex>{'\\mu_k\\propto1/k'}</Tex> 等於「把所有 <Tex>{'G'}</Tex> 平均起來」，每個 block 的資訊權重相同。與固定 <Tex>{'\\mu'}</Tex> 比較（F-14.8）：
      </p>
      <TexBlock id="F-14.19" label={md(String.raw`固定 $\mu$ 損失多少`)}>
        {String.raw`\frac{E[\delta_B^2]^*_\text{fixed}}{P_B}\approx\frac{\sigma_\eta^2(1+\ln A)/(4BK^2)}{\sigma_\eta^2/(BK^2)}=\frac{1+\ln A}{4}`}
      </TexBlock>
      <p>
        <ClaimTag kind="approx" /> 損失隨「初始誤差 ÷ 雜訊」的<strong>對數</strong>增長：<Tex>{'\\delta_0'}</Tex> 大 10 倍（<Tex>{'A'}</Tex> 大 100 倍），比值只<strong>增加</strong> <Tex>{'\\ln100/4\\approx1.15'}</Tex>（是加上去，不是乘上去）。
      </p>
      <Hand id="HC-14.7">
        這一題只要加減乘除：算出下界 <Tex>{'P_B'}</Tex> 與第一步、最後一步的步長，親眼看看「先大後小」差了幾倍。再把 <Tex>{'\\delta_0'}</Tex> 改大 10 倍——<Tex>{'P_B'}</Tex> 幾乎不變，只有 <Tex>{'\\mu_0'}</Tex> 變大。
      </Hand>
      <div className="grid-2">
        <ParamControl label={md(String.raw`$\delta_0$`)} ariaLabel="δ0" value={delta0} onChange={setDelta0} min={0.01} max={50} log unit="fs" reg="gain_true 與 gain_initial 的差" hint={md(String.raw`$\delta_0>0.3\sigma_v$ 時線性模型失效（E48）`)} />
        <ParamControl label={md(String.raw`$\sigma_v$`)} ariaLabel="σ_v" value={sigmaV} onChange={setSigmaV} min={1} max={1000} log unit="fs" reg="pd_noise_rms_fs" />
        <ParamControl label={md(String.raw`$N$`)} ariaLabel="N" value={N} onChange={setN} min={16} max={65536} log integer clampOnBlur reg="REG_GMAC_N" />
        <ParamControl label={md(String.raw`$B$（更新次數）`)} ariaLabel="B（更新次數）" value={B} onChange={setB} min={2} max={2000} log integer clampOnBlur reg="CAL_BLOCKS" />
        <ParamControl label="MC chains" value={chains} onChange={setChains} min={100} max={20000} log integer clampOnBlur reg="MC chains" />
      </div>
      <div className="table-wrap">
        <table className="ch14-table">
          <thead>
            <tr>
              <th>排程</th>
              <th>參數（全部由最佳化求得）</th>
              <th>
                RMS <Tex>{'\\delta_B'}</Tex> 解析 (fs)
              </th>
              <th>MC RMS [95% CI]</th>
              <th>{md('相對 $1/k$ 的功率比')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{md(String.raw`固定 $\mu$`)}</td>
              <td>
                <Tex>{`\\mu^*=${tx(design.fixed.mu, 4)}\\,\\mathrm{fs}`}</Tex>
              </td>
              <td className="num">{nf(rmsFixed, 4)}</td>
              <td className="num">{mcRes ? `${nf(Math.sqrt(mcRes.fixed[B]), 4)} [${nf(Math.sqrt(Math.max(0, mcRes.finalCI.fixed[0])), 4)}, ${nf(Math.sqrt(mcRes.finalCI.fixed[1]), 4)}]` : '—'}</td>
              <td className="num">
                {nf(design.fixed.cost / design.opt.PB, 3)}（預測 {nf(ratioPred, 3)}）
              </td>
            </tr>
            <tr className="is-best">
              <td>兩段式（先 coarse 再 fine）</td>
              <td>
                <Tex>{`\\mu_1=${tx(design.two.mu1, 4)}\\,\\mathrm{fs}\\times${design.two.B1}\\ \\text{blocks}\\ \\to\\ \\mu_2=${tx(design.two.mu2, 4)}\\,\\mathrm{fs}\\times${design.two.B2}\\ \\text{blocks}`}</Tex>
              </td>
              <td className="num">{nf(rmsTwo, 4)}</td>
              <td className="num">{mcRes ? `${nf(Math.sqrt(mcRes.twoPhase[B]), 4)} [${nf(Math.sqrt(Math.max(0, mcRes.finalCI.twoPhase[0])), 4)}, ${nf(Math.sqrt(mcRes.finalCI.twoPhase[1]), 4)}]` : '—'}</td>
              <td className="num">{nf(design.two.msd / design.opt.PB, 3)}</td>
            </tr>
            <tr>
              <td>{md('$1/k$（Kalman 下界）')}</td>
              <td>
                <Tex>{`k_0=${tx(design.opt.k0, 4)},\\ \\mu_0=${tx(design.opt.mu[0], 4)}\\,\\mathrm{fs}`}</Tex>
              </td>
              <td className="num">{nf(rmsOpt, 4)}</td>
              <td className="num">{mcRes ? `${nf(Math.sqrt(mcRes.inverseK[B]), 4)} [${nf(Math.sqrt(Math.max(0, mcRes.finalCI.inverseK[0])), 4)}, ${nf(Math.sqrt(mcRes.finalCI.inverseK[1]), 4)}]` : '—'}</td>
              <td className="num">1</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="ch14-row-buttons">
        <button type="button" className="btn btn-primary" onClick={run} disabled={task.running || !(K > 0)}>
          {task.running ? 'Monte Carlo 執行中…' : `執行 Monte Carlo（${chains} chains × 3 排程，Web Worker）`}
        </button>
        {task.running && (
          <button type="button" className="btn" onClick={task.cancel}>
            停止
          </button>
        )}
        <span className="small muted">
          exact-binomial Sign-GMAC、seed {seed}
          {mcRes && mcRes.chains < mcRes.chainsRequested ? `（B 大，chains 自動減為 ${mcRes.chains}）` : ''} <SourceTag kind={mcRes ? 'simulation' : 'illustrative'} />
        </span>
      </div>
      {err && <Callout kind="danger">Monte Carlo 失敗：{err}</Callout>}
      {delta0 > 0.3 * sigmaV && (
        <Callout kind="warn" title="線性模型適用性（勘誤 E48）">
          <Tex>{`\\delta_0/\\sigma_v=${tx(delta0 / sigmaV, 3)}>0.3`}</Tex>：解析曲線（特別是大步長的前幾個 block）會低估 MC。
        </Callout>
      )}
      <Plot
        title={String.raw`$E[\delta_k^2]$：固定 $\mu$ vs 兩段式 vs $1/k$`}
        data={data}
        yLog
        height={320}
        csvName="ch14-schedules"
        layout={{ xaxis: { title: { text: 'k（blocks）' } }, yaxis: { title: { text: 'fs²' } } }}
        caption={md(
          String.raw`線為線性解析（F-14.3、F-14.20、F-14.18），點為 Monte Carlo。條件：$\sigma_v=${tx(sigmaV, 6)}\,\mathrm{fs}$、$N=${N}$、$\delta_0=${tx(delta0, 6)}\,\mathrm{fs}$、$\theta=0$、$K=${tx(K, 4)}\,\mathrm{fs^{-1}}$。`,
        )}
      />
      <Plot
        title={String.raw`三種排程的 $\mu_k$`}
        data={muData}
        yLog
        height={240}
        csvName="ch14-schedule-mu"
        layout={{ xaxis: { title: { text: 'k（blocks）' } }, yaxis: { title: { text: 'μ_k (fs)' } } }}
        caption={md('兩段式就是用兩個「台階」去逼近 $1/k$ 曲線；台階越多（coarse、fine、track 三段）越接近。')}
      />
      <h3>核心程式碼：只差一行</h3>
      <CodeCompare
        items={[
          { label: '固定步長', source: optimizerSrc, region: 'runFixedMu', path: 'src/simulation/models/optimizer.ts', note: '整段校正都用同一個步長。' },
          { label: '兩段式 coarse/fine', source: optimizerSrc, region: 'runTwoPhase', path: 'src/simulation/models/optimizer.ts', note: 'switchBlock 之前用 muCoarse，之後用 muFine。' },
          { label: '遞減步長（Kalman 型）', source: optimizerSrc, region: 'runInverseK', path: 'src/simulation/models/optimizer.ts', note: '每個 block 的步長都不同；需要先知道斜率與初始誤差的量級。' },
        ]}
        caption="三個函式共用同一個 signGmacBlock（exact binomial Sign-GMAC），差異只在標出的那一行。"
      />
      <ModeGate min="engineer">
        <CodeBlock source={optimizerSrc} region="signGmacBlock" path="src/simulation/models/optimizer.ts" />
        <CodeBlock source={optimizerSrc} region="optimalSchedule" path="src/simulation/models/optimizer.ts" />
      </ModeGate>
      <Callout kind="info" title={md('為什麼硬體不直接用 $1/k$ 排程？')}>
        <ul>
          <li>
            <Tex>{'1/k'}</Tex> 永不停止縮小：<Tex>{'\\mu_k\\to0'}</Tex> 後失去追蹤 PVT 漂移的能力。實務上要設地板 <Tex>{'\\mu_k\\ge\\mu_\\text{track}'}</Tex>，這正是 coarse、fine、track 三段的狀態機（§14.7）。
          </li>
          <li>
            需要知道 <Tex>{'K'}</Tex> 與 <Tex>{'\\delta_0'}</Tex>：設計用的 <Tex>{'\\hat K=K_\\text{true}/\\kappa'}</Tex>（估錯一個倍數），等效 <Tex>{'\\mu_kK_\\text{true}=\\kappa/(k+1+k_0)'}</Tex>。
          </li>
          <li>
            任意步長需要乘法器或 LUT；兩段式只要兩個 shift 值（<Tex>{'\\mu'}</Tex> 取 2 的冪）與一個計數器。
          </li>
        </ul>
      </Callout>
      <ModeGate min="research">
        <Callout kind="info" title={md('延伸：$K$ 估錯時的 $1/k$ 排程')}>
          <p>
            <ClaimTag kind="approx" /> 令 <Tex>{'\\mu_k=\\kappa/(K(k+1))'}</Tex>。確定部分 <Tex>{'\\prod_{j\\le k}(1-\\kappa/j)^2\\sim k^{-2\\kappa}'}</Tex>，雜訊部分 <Tex>{'\\sim\\kappa^2\\sigma_\\eta^2/(K^2(2\\kappa-1)k)'}</Tex>（需 <Tex>{'\\kappa>\\tfrac12'}</Tex>）。
            所以 <strong><Tex>{'\\kappa<\\tfrac12'}</Tex>（<Tex>{'K'}</Tex> 高估超過 2 倍）時收斂慢於 <Tex>{'1/k'}</Tex></strong>（只有 <Tex>{'k^{-2\\kappa}'}</Tex>）；<Tex>{'\\kappa>\\tfrac12'}</Tex> 時仍是 <Tex>{'1/k'}</Tex>，但常數變大 <Tex>{'\\kappa^2/(2\\kappa-1)'}</Tex>（<Tex>{'\\kappa=1'}</Tex> 最佳）。
            推導：<Tex>{'v_{k+1}\\approx(1-2\\kappa/k)v_k+\\kappa^2\\sigma_\\eta^2/(K^2k^2)'}</Tex>，代入 <Tex>{'v_k=c/k'}</Tex> 比較 <Tex>{'1/k^2'}</Tex> 係數得 <Tex>{'c(2\\kappa-1)=\\kappa^2\\sigma_\\eta^2/K^2'}</Tex>。這是 stochastic approximation 的經典結果，網站未另做 Monte Carlo 驗證。
          </p>
        </Callout>
      </ModeGate>
      <p className="small muted">
        漸近式 <Tex>{`A=${tx(design.asym.A, 4)}`}</Tex>，預測比值 <Tex>{`(1+\\ln A)/4=${tx(ratioPred, 4)}`}</Tex>。
      </p>
    </Section>
  )
}
