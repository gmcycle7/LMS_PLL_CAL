import { useMemo } from 'react'
import type { Data, Shape } from 'plotly.js-dist-min'
import { Callout, ClaimTag, CodeBlock, ModeGate, Plot, Section, Tex, TexBlock, useThemeTokens, ChRef } from '@/components'
import optimizerSrc from '@/simulation/models/optimizer.ts?raw'
import {
  OBJECTIVE_LABEL,
  OBJECTIVES,
  asymptoticFinalOptimum,
  loopGainK,
  objectiveCost,
  optimizeMu,
  type DesignModel,
  type Objective,
} from '@/simulation/models/optimizer'
import { Diagram } from '../Diagram'
import { CHART_DESIGN_FLOW, CHART_NOISE_SHAPING, CHART_OBJECTIVE_FLOW, CHART_PM_LOOP, CHART_TRACKING_TRADEOFF } from '../diagrams'
import { Hand } from '../Hand'
import { BIAS2, logspace, md, nf, Steps, tx, vLine } from '../shared'

/** 第 10 課的條件 + 各目標所需的額外參數（示例值） */
export const LESSON_MODEL: DesignModel = {
  K: loopGainK(100, 0),
  delta0: 3,
  sigmaEta2: 1 / 4096,
  B: 32,
  eps: 0.05,
  spurOmega: 2 * Math.PI * 0.05,
  driftRate: 0.002,
  driftSigma: 0.02,
}

const COST_TEX: Record<Objective, string> = {
  final: String.raw`E[\delta_B^2]`,
  fastest: String.raw`\tau=-1/\ln|p|`,
  integrated: String.raw`\tfrac1B\sum_{k=1}^{B}E[\delta_k^2]`,
  spur: String.raw`S_w(e^{j\Omega_s})\ \text{s.t.}\ |E[\delta_B]|\le\epsilon|\delta_0|`,
  trackRamp: String.raw`(r/g)^2+\sigma_w^2`,
  trackRw: String.raw`(\sigma_\zeta^2+\mu^2\sigma_\eta^2)/(1-p^2)`,
}

/** §14.2：不同目標 ⇒ 不同最佳 μ（F-14.7–F-14.14） */
export function S3Objectives() {
  const tokens = useThemeTokens()
  const m = LESSON_MODEL
  const K = m.K
  const opts = useMemo(() => OBJECTIVES.map((o) => ({ o, r: optimizeMu(o, m) })), [m])
  const asym = asymptoticFinalOptimum(m)
  const plot = useMemo(() => {
    const mus = logspace(0.3, 1.98 / K, 300)
    const traces: Data[] = []
    const shapes: Partial<Shape>[] = []
    opts.forEach(({ o, r }, i) => {
      if (!r.feasible) return
      shapes.push(vLine(r.mu, tokens.series[i % tokens.series.length], 'dot'))
      if (o === 'fastest') return
      const ref = r.cost
      traces.push({
        x: mus,
        y: mus.map((mu) => {
          if (o === 'spur' && mu < r.muLo) return null
          const v = objectiveCost(o, mu, m) / ref
          return Number.isFinite(v) ? v : null
        }),
        name: OBJECTIVE_LABEL[o],
        line: { color: tokens.series[i % tokens.series.length], width: o === 'final' ? 3 : 1.6 },
      })
    })
    return { traces, shapes }
  }, [opts, K, m, tokens])
  const rmsAt = (mu: number) => Math.sqrt(objectiveCost('final', mu, m))
  const feasibleOpts = opts.filter((x) => x.r.feasible)
  const lowest = feasibleOpts.reduce((a, b) => (b.r.mu < a.r.mu ? b : a), feasibleOpts[0])
  const highest = feasibleOpts.reduce((a, b) => (b.r.mu > a.r.mu ? b : a), feasibleOpts[0])
  return (
    <Section kind="formula" level={2} title={md(String.raw`14.2 優化目標不同，最佳 $\mu$ 也不同`)} id="ch14-objectives">
      <p>
        「最佳 learning rate」不是一個數字，而是一個<strong>問題的答案</strong>。同一組硬體（第 10 課條件：<Tex>{'\\sigma_v=100\\,\\mathrm{fs}'}</Tex>、<Tex>{'N=4096'}</Tex>、
        <Tex>{'B=32'}</Tex>、<Tex>{'\\delta_0=3\\,\\mathrm{fs}'}</Tex>），換一個目標，答案可以差十倍以上。先用一張圖看全貌，再逐一推導。
      </p>
      <Diagram chart={CHART_OBJECTIVE_FLOW} caption="同一個迴路、六種目標：每條分支是一種「最佳」的定義；不管走哪一條，最後都要通過右邊紅色的 PM 上限。">
        <p>
          <strong>先看</strong>最左邊的菱形（你在最佳化什麼），<strong>再</strong>沿著每一條分支看它怎麼決定 <Tex>{'\\mu'}</Tex>：(a) 靠微分找成本的谷底、(b) 直接讓 pole 等於 0、(c) 只能數值解、(d) 由限制條件決定（不是由微分）、(e) 由 gain{' '}
          漂移的快慢決定。<strong>最後看</strong>最右邊：任何目標選出來的 <Tex>{'\\mu'}</Tex> 都不能讓 phase margin 低於下限。
        </p>
        <p>
          圖上每個方塊裡的式子，就是下面 (a)–(f) 各小節最後得到的公式：(a) 是 F-14.8、(b) 是 F-14.10、(d) 的下限是 F-14.15 的單一 corner 版、(e) 是 F-14.12 與 F-14.13、(f) 是 F-14.14。其中 <Tex>{'A'}</Tex>、<Tex>{'\\epsilon'}</Tex>、
          <Tex>{'r'}</Tex>、<Tex>{'\\sigma_\\zeta'}</Tex>、<Tex>{'PM_t'}</Tex> 這幾個新符號，會在各自的小節第一次出現時說明。
        </p>
      </Diagram>

      <h3>
        (a) 最小終點 RMS：對 <Tex>{'\\mu'}</Tex> 微分
      </h3>
      <p>
        目標是讓第 <Tex>{'B'}</Tex> 次更新後的均方誤差最小。計算的路徑是：先由硬體得到斜率 <Tex>{'K'}</Tex>，再對每個候選的 <Tex>{'\\mu'}</Tex> 算出 {BIAS2} 與 variance，加起來就是成本 <Tex>{'J(\\mu)'}</Tex>。
      </p>
      <Diagram chart={CHART_DESIGN_FLOW} caption="從規格到最佳 learning rate 的計算路徑：藍色與棕色兩塊隨步長往相反方向變，相加後的谷底就是答案。">
        <p>
          <strong>先看</strong>上半部：comparator 雜訊 <Tex>{'\\sigma_v'}</Tex> 決定 <Tex>{'K_q'}</Tex>，誤差路徑的增益 <Tex>{'|H|'}</Tex> 與相位 <Tex>{'\\theta'}</Tex> 決定 <Tex>{'C'}</Tex>，兩者相乘是 <Tex>{'K'}</Tex>。<strong>再看</strong>中間：挑一個候選{' '}
          <Tex>{'\\mu'}</Tex>，就得到 <Tex>{'g=\\mu K'}</Tex> 與 <Tex>{'p=1-g'}</Tex>。<strong>最後看</strong>下半部：同一個 <Tex>{'\\mu'}</Tex> 讓藍色的 {BIAS2} 變小、卻讓棕色的 variance 變大；兩者在加法點相加成為 <Tex>{'J(\\mu)'}</Tex>，掃過{' '}
          <Tex>{'\\mu'}</Tex> 找最低點。
        </p>
        <p>
          圖上加法點輸出的 <Tex>{'J(\\mu)=E[\\delta_B^2]'}</Tex> 就是下面第 1 步的 <Tex>{'J(\\mu)'}</Tex>（F-14.3 把雜訊項用 F-14.6 化簡後的寫法）；「找最低點」在數學上就是 <Tex>{'dJ/d\\mu=0'}</Tex>（F-14.7），<Tex>{'B'}</Tex> 大時近似成最下面方塊裡的 F-14.8。
        </p>
      </Diagram>
      <Steps
        steps={[
          {
            tex: String.raw`J(\mu)=\delta_0^2p^{2B}+\sigma_\eta^2\frac{\mu(1-p^{2B})}{K(2-\mu K)},\quad p=1-\mu K`,
            why: <>把 F-14.6 的化簡代入 F-14.3，讓 <Tex>{'\\mu'}</Tex> 只出現在 <Tex>{'p'}</Tex> 與一個有理式裡。</>,
          },
          {
            tex: String.raw`\frac{d}{d\mu}\big[\delta_0^2p^{2B}\big]=\delta_0^2\cdot2Bp^{2B-1}\cdot\frac{dp}{d\mu}=-2BK\delta_0^2p^{2B-1}`,
            why: <>連鎖律；<Tex>{'dp/d\\mu=-K'}</Tex>。增加 <Tex>{'\\mu'}</Tex> 讓 {BIAS2} 下降。</>,
          },
          {
            tex: String.raw`\frac{d}{d\mu}\Big[\frac{\mu}{2-\mu K}\Big]=\frac{(2-\mu K)+\mu K}{(2-\mu K)^2}=\frac{2}{(2-\mu K)^2}`,
            why: <>商的微分 <Tex>{'(f/h)\'=(f\'h-fh\')/h^2'}</Tex>，<Tex>{'f=\\mu,\\ h=2-\\mu K'}</Tex>。</>,
          },
          {
            tex: String.raw`\frac{d}{d\mu}\big[1-p^{2B}\big]=2BKp^{2B-1}`,
            why: '同第 2 步的連鎖律，符號相反。',
          },
          {
            tex: String.raw`\frac{dJ}{d\mu}=-2BK\delta_0^2p^{2B-1}+\sigma_\eta^2\Big[\frac{2(1-p^{2B})}{K(2-\mu K)^2}+\frac{2B\mu p^{2B-1}}{2-\mu K}\Big]`,
            why: <>對 <Tex>{'\\tfrac{\\sigma_\\eta^2}{K}\\cdot\\tfrac{\\mu}{2-\\mu K}\\cdot(1-p^{2B})'}</Tex> 用乘積法則，把第 2–4 步組起來。第一項（負）是 bias 的好處，第二項（正）是 variance 的代價。</>,
          },
        ]}
      />
      <TexBlock id="F-14.7" label="終點成本的導數">
        {String.raw`\frac{dE[\delta_B^2]}{d\mu}=-2BK\delta_0^2p^{2B-1}+\sigma_\eta^2\left[\frac{2(1-p^{2B})}{K(2-\mu K)^2}+\frac{2B\mu p^{2B-1}}{2-\mu K}\right]=0`}
      </TexBlock>
      <p>這條方程沒有初等解，網站用數值求根（log 格點 + 黃金分割）。但大 B 時可以近似出一個很好用的封閉式：</p>
      <Steps
        steps={[
          { tex: String.raw`p^{2B}=e^{2B\ln(1-g)}\approx e^{-2Bg}`, why: <>泰勒：<Tex>{'\\ln(1-g)\\approx-g'}</Tex>（<Tex>{'g\\ll1'}</Tex>）。</> },
          { tex: String.raw`1-p^{2B}\approx1,\quad 2-\mu K\approx2`, why: <><Tex>{'B'}</Tex> 夠大時 <Tex>{'p^{2B}\\ll1'}</Tex>；<Tex>{'g\\ll1'}</Tex>。</> },
          { tex: String.raw`J(\mu)\approx\delta_0^2e^{-2B\mu K}+\frac{\mu\sigma_\eta^2}{2K}`, why: '代回：一個指數下降 + 一條直線上升。' },
          { tex: String.raw`\frac{dJ}{d\mu}\approx-2BK\delta_0^2e^{-2B\mu K}+\frac{\sigma_\eta^2}{2K}=0`, why: '微分並令為 0。' },
          { tex: String.raw`e^{-2B\mu^*K}=\frac{\sigma_\eta^2}{4BK^2\delta_0^2}\equiv\frac1A`, why: <>移項。<Tex>{'A'}</Tex> = 「初始誤差功率 ÷ 雜訊底」的比例。</> },
          { tex: String.raw`\mu^*=\frac{\ln A}{2BK}`, why: <>兩邊取 <Tex>{'\\ln'}</Tex>：<Tex>{'-2B\\mu^*K=-\\ln A'}</Tex>。</> },
          {
            tex: String.raw`J^*\approx\frac{\delta_0^2}{A}+\frac{\sigma_\eta^2\ln A}{4BK^2}=\frac{\sigma_\eta^2}{4BK^2}+\frac{\sigma_\eta^2\ln A}{4BK^2}=\frac{\sigma_\eta^2(1+\ln A)}{4BK^2}`,
            why: <>代回 <Tex>{'J'}</Tex>；<Tex>{'\\delta_0^2/A=\\sigma_\\eta^2/(4BK^2)'}</Tex>。</>,
          },
        ]}
      />
      <TexBlock id="F-14.8" label={md('大 $B$ 封閉近似')}>
        {String.raw`\boxed{\mu^*\approx\frac{\ln A}{2BK},\qquad E[\delta_B^2]^*\approx\frac{\sigma_\eta^2(1+\ln A)}{4BK^2},\qquad A=\frac{4BK^2\delta_0^2}{\sigma_\eta^2}}`}
      </TexBlock>
      <p>
        第 10 課條件：<Tex>{`A=${tx(asym.A, 5)}`}</Tex>，<Tex>{`\\mu^*\\approx${tx(asym.mu, 4)}\\,\\mathrm{fs}`}</Tex>、<Tex>{`\\text{RMS}\\approx${tx(Math.sqrt(asym.cost), 4)}\\,\\mathrm{fs}`}</Tex>；
        精確數值最佳點 <Tex>{`\\mu^*=${tx(opts[0].r.mu, 5)}\\,\\mathrm{fs}`}</Tex>、RMS <Tex>{`${tx(Math.sqrt(opts[0].r.cost), 4)}\\,\\mathrm{fs}`}</Tex> <ClaimTag kind="approx" />。
        注意 <Tex>{'\\mu^*'}</Tex> 只隨 <Tex>{'\\ln\\delta_0'}</Tex> 變：初始誤差大 10 倍，最佳 <Tex>{'\\mu'}</Tex> 只增加 <Tex>{'\\ln 100/(2BK)'}</Tex>。
      </p>
      <Hand id="HC-14.5">
        F-14.8 只需要一次 <Tex>{'\\ln'}</Tex> 和一次開根號。先用第 10 課的數字算出 <Tex>{'A'}</Tex>、<Tex>{'\\mu^*'}</Tex> 和 RMS，再換成你自己晶片的 <Tex>{'\\sigma_v'}</Tex>、<Tex>{'N'}</Tex>、<Tex>{'T'}</Tex>。
      </Hand>

      <h3>(b) 最快初期收斂</h3>
      <p>
        只看平均誤差 <Tex>{'E[\\delta_k]=p^k\\delta_0'}</Tex> 的衰減速度，時間常數 <Tex>{'\\tau=-1/\\ln|1-g|'}</Tex>。<Tex>{'|1-g|'}</Tex> 在 <Tex>{'g=1'}</Tex> 時為 0（一步到位，deadbeat）：
      </p>
      <TexBlock id="F-14.10" label="最快收斂">
        {String.raw`\mu_\text{fast}=\frac1K\ (p=0),\qquad \sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-0}=\frac{\sigma_\eta^2}{K^2}`}
      </TexBlock>
      <p>
        代價：穩態雜訊 <Tex>{`\\sigma_\\eta^2/K^2=${tx(m.sigmaEta2 / (K * K), 4)}\\,\\mathrm{fs^2}`}</Tex>（RMS {nf(Math.sqrt(m.sigmaEta2) / K, 3)} fs）——一個 block 的雜訊直接變成係數誤差
        （<Tex>{'\\sigma_w^2=\\sigma_\\eta^2g/(K^2(2-g))'}</Tex> 隨 <Tex>{'g'}</Tex> 遞增，在 <Tex>{'PM\\ge60^\\circ'}</Tex> 的範圍 <Tex>{'g\\le1'}</Tex> 內以 <Tex>{'g=1'}</Tex> 最大）。而且 <Tex>{'g=1'}</Tex> 時 PM 只剩 <Tex>{'60^\\circ'}</Tex>，
        任何 <Tex>{'K'}</Tex> 的低估（真實 <Tex>{'K'}</Tex> 比設計值大）都會讓 <Tex>{'g'}</Tex> 超過 1。
      </p>

      <h3>(c) 最小全程積分誤差</h3>
      <p>
        如果校正期間 PLL 已經在用（背景校正），在乎的是整段時間的誤差。用 <Tex>{'E[\\delta_k^2]=\\delta_0^2q^k+\\mu^2\\sigma_\\eta^2S_k'}</Tex>（<Tex>{'q=p^2'}</Tex>、<Tex>{'S_k=(1-q^k)/(1-q)'}</Tex>）逐項加總：
      </p>
      <Steps
        steps={[
          { tex: String.raw`\sum_{k=1}^{B}q^k=q\frac{1-q^B}{1-q}=qS_B`, why: <>等比數列（從 <Tex>{'k=1'}</Tex> 開始，提出一個 <Tex>{'q'}</Tex>）。</> },
          { tex: String.raw`\sum_{k=1}^{B}S_k=\sum_{k=1}^{B}\frac{1-q^k}{1-q}=\frac{B-qS_B}{1-q}`, why: <>把 <Tex>{'1'}</Tex> 與 <Tex>{'q^k'}</Tex> 分開加，第二部分用上一步。</> },
        ]}
      />
      <TexBlock id="F-14.9" label="全程積分誤差">
        {String.raw`\frac1B\sum_{k=1}^{B}E[\delta_k^2]=\frac1B\left[\delta_0^2qS_B+\mu^2\sigma_\eta^2\frac{B-qS_B}{1-q}\right]`}
      </TexBlock>
      <p>
        早期的大誤差也被計入，所以最佳 <Tex>{'\\mu'}</Tex> 比 (a) 大（偏向快）。<Tex>{'q\\to1'}</Tex>（<Tex>{'g\\to0'}</Tex>）時 <Tex>{'(B-qS_B)/(1-q)'}</Tex> 是 <Tex>{'0/0'}</Tex>，程式改用泰勒展開{' '}
        <Tex>{'\\sum_{j<B}(B-j)q^j'}</Tex>。
      </p>

      <h3>(d) 最小係數擾動／spur</h3>
      <p>
        係數的抖動乘上 code 之後會出現在 PLL 輸出，週期性的成分就是 spur（<ChRef ch="12">Ch12</ChRef>），所以這個目標關心的是係數雜訊<strong>在某個頻率有多大</strong>，而不是總量。係數雜訊不是白的：它是 GMAC 白雜訊經過 <Tex>{'H(z)=\\mu/(z-p)'}</Tex> 的 low-pass（§12）。先看訊號怎麼流：
      </p>
      <Diagram chart={CHART_NOISE_SHAPING} caption="係數雜訊的來源：白雜訊先乘步長，再進一個帶回授的一階迴路；回授的倍數就是 pole。">
        <p>
          <strong>先看</strong>左邊：每個 block 的白雜訊 <Tex>{'\\eta_k'}</Tex>（每個頻率一樣大）乘上 <Tex>{'\\mu'}</Tex> 進加法點。<strong>再看</strong>右邊的迴圈：加法點的輸出延遲一個 block（<Tex>{'z^{-1}'}</Tex>）成為係數雜訊{' '}
          <Tex>{'w_k-a'}</Tex>（也就是 <Tex>{'-\\delta_k'}</Tex>；正負號不影響功率），同時乘 <Tex>{'p'}</Tex> 回到加法點。舊的雜訊每個 block 只衰減成 <Tex>{'p'}</Tex> 倍，所以變化慢的（低頻）成分會累積起來、變化快的成分互相抵消——這就是 low-pass。
        </p>
        <p>
          圖上的「<Tex>{'\\times\\mu'}</Tex>」「<Tex>{'z^{-1}'}</Tex>」「<Tex>{'\\times p'}</Tex>」合起來就是公式裡的 <Tex>{'H(z)=\\mu z^{-1}/(1-pz^{-1})=\\mu/(z-p)'}</Tex>。在很低的頻率（<Tex>{'z\\to1'}</Tex>）增益是{' '}
          <Tex>{'\\mu/(1-p)=\\mu/(\\mu K)=1/K'}</Tex>：<Tex>{'\\mu'}</Tex> 被約掉了，這就是下面「反直覺結論」的來源。
        </p>
      </Diagram>
      <p>
        把 <Tex>{'z=e^{j\\Omega}'}</Tex> 代入就得到係數雜訊的功率頻譜密度 <Tex>{'S_w(e^{j\\Omega})'}</Tex>（<Tex>{'\\Omega'}</Tex> 以 rad/block 計，對應的實際頻率以更新率 <Tex>{'f_u=f_s/N'}</Tex> 為準）：
      </p>
      <Steps
        steps={[
          { tex: String.raw`S_w(e^{j\Omega})=|H|^2\sigma_\eta^2=\frac{\mu^2\sigma_\eta^2}{|e^{j\Omega}-p|^2}=\frac{\mu^2\sigma_\eta^2}{1-2p\cos\Omega+p^2}`, why: <><Tex>{'|e^{j\\Omega}-p|^2=(\\cos\\Omega-p)^2+\\sin^2\\Omega=1-2p\\cos\\Omega+p^2'}</Tex>。</> },
          { tex: String.raw`1-2p\cos\Omega+p^2=(1-p)^2+2p(1-\cos\Omega)=g^2+2(1-g)(1-\cos\Omega)`, why: <>加減 <Tex>{'2p'}</Tex> 重新配方，再代 <Tex>{'p=1-g'}</Tex>。</> },
          { tex: String.raw`S_w=\frac{\sigma_\eta^2}{K^2}\cdot\frac{g^2}{g^2+2(1-g)(1-\cos\Omega)}=\frac{\sigma_\eta^2}{K^2}\cdot\frac{1}{1+2(1-g)(1-\cos\Omega)/g^2}`, why: <><Tex>{'\\mu^2=g^2/K^2'}</Tex>，分子分母同除 <Tex>{'g^2'}</Tex>。</> },
          { tex: String.raw`\frac{d}{dg}\Big[\frac{1-g}{g^2}\Big]=\frac{g-2}{g^3}<0\quad(0<g<2)`, why: <>分母中的 <Tex>{'(1-g)/g^2'}</Tex> 隨 <Tex>{'g'}</Tex> 遞減，所以 <Tex>{'S_w'}</Tex> 隨 <Tex>{'g'}</Tex>（也就是 <Tex>{'\\mu'}</Tex>）單調遞增（<Tex>{'\\Omega\\ne0'}</Tex>；<Tex>{'\\Omega=0'}</Tex> 時為常數）。</> },
        ]}
      />
      <TexBlock id="F-14.11" label="係數雜訊 PSD">
        {String.raw`S_w(e^{j\Omega})=\frac{\sigma_\eta^2}{K^2}\cdot\frac{g^2}{g^2+2(1-g)(1-\cos\Omega)}\ \xrightarrow{\ \Omega\to0\ }\ \frac{\sigma_\eta^2}{K^2}`}
      </TexBlock>
      <Callout kind="info" title="一個反直覺的結論">
        <ClaimTag kind="exact" /> 在 <Tex>{'\\Omega\\to0'}</Tex>（遠低於校正頻寬）時，係數雜訊密度 <Tex>{'\\sigma_\\eta^2/K^2'}</Tex> <strong>與 <Tex>{'\\mu'}</Tex> 無關</strong>——<Tex>{'\\mu'}</Tex> 只決定這段雜訊延伸到多高頻。所以「降低 <Tex>{'\\mu'}</Tex> 來壓 spur」只對
        <strong>校正頻寬以外</strong>的偏移頻率有效；要壓低頻帶內的雜訊，只能加大 <Tex>{'N'}</Tex>（降 <Tex>{'\\sigma_\\eta^2'}</Tex>）或加大 <Tex>{'K'}</Tex>（降 <Tex>{'\\sigma_v'}</Tex>、改善 <Tex>{'C'}</Tex>）。
      </Callout>
      <p>
        既然成本隨 <Tex>{'\\mu'}</Tex> 單調遞增，最佳解就是「滿足收斂要求的最小 <Tex>{'\\mu'}</Tex>」。收斂要求寫成：<Tex>{'B'}</Tex> 次更新後平均誤差要縮到初始值的 <Tex>{'\\epsilon'}</Tex> 倍以內（<Tex>{'\\epsilon'}</Tex> 是無因次的相對縮減比，
        <Tex>{'0<\\epsilon<1'}</Tex>），也就是 <Tex>{'|E[\\delta_B]|=p^B|\\delta_0|\\le\\epsilon|\\delta_0|\\Rightarrow\\mu\\ge(1-\\epsilon^{1/B})/K'}</Tex>（§14.5 的單一 corner 版本）。
        答案由<strong>限制條件</strong>決定，不是由導數為零決定。
      </p>

      <h3>(e) 最佳 PVT 追蹤</h3>
      <p>
        開機校正結束後，正確答案 <Tex>{'a'}</Tex> 還會隨溫度、電壓慢慢漂移（PVT drift）。這時的取捨換了一組：<Tex>{'\\mu'}</Tex> 太小，係數追不上漂移，永遠落後一截（lag）；<Tex>{'\\mu'}</Tex> 太大，雜訊又被放大。漂移用兩種模型描述：ramp（每個 block
        固定增加 <Tex>{'r'}</Tex>，單位 fs/block）與 random walk（每個 block 隨機走一步 <Tex>{'\\zeta_k'}</Tex>，標準差 <Tex>{'\\sigma_\\zeta'}</Tex>）。
      </p>
      <Diagram chart={CHART_TRACKING_TRADEOFF} caption="追蹤時的取捨：藍色的落後項隨步長變小，棕色的雜訊項隨步長變大，兩者相加找最低點。">
        <p>
          <strong>先看</strong>左邊的兩個來源：<Tex>{'a'}</Tex> 的漂移與 GMAC 雜訊 <Tex>{'\\eta_k'}</Tex>。<strong>再看</strong>中間：漂移造成藍色的「追不上」誤差、雜訊造成棕色的抖動，兩項都由同一個 <Tex>{'\\mu'}</Tex> 控制，但方向相反。
          <strong>最後看</strong>右邊：兩項在加法點相加成為成本 <Tex>{'J(\\mu)'}</Tex>，最低點就是追蹤用的 <Tex>{'\\mu^*'}</Tex>。
        </p>
        <p>
          圖上藍色方塊的 <Tex>{'(r/(\\mu K))^2'}</Tex> 就是下面 ramp 推導第 3 步 <Tex>{'J'}</Tex> 的第一項（穩態落後量 <Tex>{'\\bar\\delta=r/(\\mu K)'}</Tex> 的平方），棕色方塊的 <Tex>{'\\mu\\sigma_\\eta^2/(2K)'}</Tex> 是第二項（F-14.6 的小{' '}
          <Tex>{'g'}</Tex> 近似）；random walk 那一行則對應第二個推導的 <Tex>{'J\\approx\\sigma_\\zeta^2/(2\\mu K)+\\mu\\sigma_\\eta^2/(2K)'}</Tex>。
        </p>
      </Diagram>
      <Steps
        title={
          <>
            Ramp 漂移：<Tex>{'a'}</Tex> 每個 block 增加 <Tex>{'r'}</Tex>
          </>
        }
        steps={[
          { tex: String.raw`\delta_{k+1}=p\delta_k+r-\mu\eta_k`, why: <><Tex>{'a_{k+1}=a_k+r'}</Tex>，代入 <Tex>{'\\delta=a-w'}</Tex> 的遞迴：<Tex>{'\\delta_{k+1}=a_k+r-w_k-\\mu G_k'}</Tex>。</> },
          { tex: String.raw`\bar\delta=p\bar\delta+r\Rightarrow\bar\delta=\frac{r}{1-p}=\frac{r}{\mu K}`, why: '穩態平均（固定點）：追蹤落後量（lag）。' },
          { tex: String.raw`J=\Big(\frac{r}{\mu K}\Big)^2+\frac{\mu\sigma_\eta^2}{K(2-\mu K)}\approx\frac{r^2}{\mu^2K^2}+\frac{\mu\sigma_\eta^2}{2K}`, why: <>落後量的平方加上穩態 variance（F-14.6；均方 <Tex>{'=\\text{bias}^2+\\text{variance}'}</Tex>）；小 <Tex>{'g'}</Tex> 近似。</> },
          { tex: String.raw`\frac{dJ}{d\mu}=-\frac{2r^2}{\mu^3K^2}+\frac{\sigma_\eta^2}{2K}=0\Rightarrow\mu^{*3}=\frac{4r^2}{K\sigma_\eta^2}`, why: '微分令為 0。' },
        ]}
      />
      <TexBlock id="F-14.12" label="Ramp 漂移追蹤">
        {String.raw`\mu^*_\text{ramp}\approx\Big(\frac{4r^2}{K\sigma_\eta^2}\Big)^{1/3}`}
      </TexBlock>
      <Steps
        title={
          <>
            Random-walk 漂移：<Tex>{'a_{k+1}=a_k+\\zeta_k,\\ \\mathrm{Var}(\\zeta_k)=\\sigma_\\zeta^2'}</Tex>
          </>
        }
        steps={[
          { tex: String.raw`\delta_{k+1}=p\delta_k+\zeta_k-\mu\eta_k`, why: '兩個獨立雜訊源。' },
          { tex: String.raw`\sigma_\delta^2=p^2\sigma_\delta^2+\sigma_\zeta^2+\mu^2\sigma_\eta^2\Rightarrow\sigma_\delta^2=\frac{\sigma_\zeta^2+\mu^2\sigma_\eta^2}{1-p^2}`, why: '穩態變異數（兩個雜訊源獨立，所以變異數相加）。' },
          { tex: String.raw`J\approx\frac{\sigma_\zeta^2+\mu^2\sigma_\eta^2}{2\mu K}\Rightarrow\frac{dJ}{d\mu}=0\Rightarrow\mu^{*2}\sigma_\eta^2=\sigma_\zeta^2`, why: <><Tex>{'1-p^2\\approx2\\mu K'}</Tex>；<Tex>{'J\\approx\\sigma_\\zeta^2/(2\\mu K)+\\mu\\sigma_\\eta^2/(2K)'}</Tex>，微分令為 0。</> },
        ]}
      />
      <TexBlock id="F-14.13" label="Random-walk 漂移追蹤">
        {String.raw`\mu^*_\text{rw}\approx\frac{\sigma_\zeta}{\sigma_\eta},\qquad J^*\approx\frac{\sigma_\zeta\sigma_\eta}{K}`}
      </TexBlock>
      <p>
        追蹤目標的最佳 <Tex>{'\\mu'}</Tex> 由「漂移有多快」決定，跟 <Tex>{'\\delta_0'}</Tex> 完全無關——開機校正的 <Tex>{'\\mu'}</Tex> 和背景追蹤的 <Tex>{'\\mu'}</Tex> 本來就該是兩個數字。
      </p>

      <h3>(f) 共同的上限：PM</h3>
      <p>
        <Tex>{'PM'}</Tex> 是校正迴路的 phase margin（離振盪還有多少相位餘裕；推導見章首的先備知識），<Tex>{'PM_t'}</Tex> 是設計要求的下限。要把「<Tex>{'PM\\ge PM_t'}</Tex>」換算成對 <Tex>{'\\mu'}</Tex> 的限制，先把回授線剪開，看開迴路 <Tex>{'L(z)'}</Tex> 是怎麼組成的：
      </p>
      <Diagram chart={CHART_PM_LOOP} caption="PM 的來源：把校正迴路的回授線剪開，兩個方塊相乘就是開迴路；從 $|L|=1$ 的頻率算出 PM，再換算成迴路增益 $g$ 的上限。">
        <p>
          <strong>先看</strong>上面的迴圈：它就是 §14.0 的校正迴路，只是拿掉雜訊（雜訊不影響穩定性），並把「<Tex>{'\\times K'}</Tex>」與「<Tex>{'\\times\\mu'}</Tex>」合併成「<Tex>{'\\times g'}</Tex>」（<Tex>{'g=\\mu K'}</Tex>）；回授的 <Tex>{'w_k'}</Tex> 在加法點以負號相減。
          <strong>再看</strong>虛線：把回授線剪開，從 <Tex>{'\\delta_k'}</Tex> 一路乘到 <Tex>{'w_k'}</Tex> 經過的就是「<Tex>{'\\times g'}</Tex>」與累加器 <Tex>{'1/(z-1)'}</Tex>，也就是開迴路 <Tex>{'L(z)=g/(z-1)'}</Tex>。<strong>最後看</strong>往下的那條鏈：先找 <Tex>{'|L|=1'}</Tex> 的頻率 <Tex>{'\\omega_c'}</Tex>，
          再量那裡離 <Tex>{'-180^\\circ'}</Tex> 還有多遠就是 PM（藍色）；要求 <Tex>{'PM\\ge PM_t'}</Tex>，等於給 <Tex>{'g'}</Tex> 一個上限 <Tex>{'g_{\\max}'}</Tex>。
        </p>
        <p>
          圖上藍色方塊的 <Tex>{'PM=90^\\circ-\\arcsin(g/2)'}</Tex> 就是章首先備知識推導出來的結果；下一個藍色方塊的 <Tex>{'g\\le2\\cos PM_t'}</Tex> 就是下面的 F-14.14，其中 <Tex>{'PM_t=60^\\circ'}</Tex> 給出 <Tex>{'g_{\\max}=1'}</Tex>、<Tex>{'\\mu\\le1/K'}</Tex>，也就是前面全貌圖最右邊的紅色方塊；
          虛線連到的紅色方塊是 <Tex>{'g=2'}</Tex> 的極端：<Tex>{'PM=0^\\circ'}</Tex>、<Tex>{'p=-1'}</Tex>。
        </p>
      </Diagram>
      <p>換算的結果就是前面全貌圖最右邊的紅色方塊：</p>
      <TexBlock id="F-14.14" label={md(String.raw`PM 與 $\mu$ 上限`)}>
        {String.raw`\begin{aligned}&PM=90^\circ-\arcsin\frac{g}{2}\ \ge PM_t\iff g\le2\sin(90^\circ-PM_t)=2\cos PM_t\\[0.5ex]&(PM_t=60^\circ\Rightarrow\mu\le1/K)\end{aligned}`}
      </TexBlock>

      <h3>比較表（第 10 課條件，全部由程式即時計算）</h3>
      <p className="small muted">
        額外參數（示例）：spur 目標 <Tex>{`\\epsilon=${m.eps}`}</Tex>、<Tex>{`\\Omega_s=2\\pi\\times0.05`}</Tex>；ramp <Tex>{`r=${m.driftRate}\\,\\mathrm{fs/block}`}</Tex>；random walk <Tex>{`\\sigma_\\zeta=${m.driftSigma}\\,\\mathrm{fs}`}</Tex>。
      </p>
      <div className="table-wrap">
        <table className="ch14-table">
          <thead>
            <tr>
              <th>目標</th>
              <th>成本</th>
              <th>
                最佳 <Tex>{'\\mu'}</Tex> (fs)
              </th>
              <th>
                <Tex>{'g'}</Tex>
              </th>
              <th>
                <Tex>{'p'}</Tex>
              </th>
              <th>PM</th>
              <th>{md('$B=32$ 後 RMS (fs)')}</th>
              <th>怎麼決定</th>
            </tr>
          </thead>
          <tbody>
            {opts.map(({ o, r }) => (
              <tr key={o} className={o === 'final' ? 'is-best' : ''}>
                <td>{OBJECTIVE_LABEL[o]}</td>
                <td>
                  <Tex>{COST_TEX[o]}</Tex>
                </td>
                <td className="num">{nf(r.mu, 4)}</td>
                <td className="num">{nf(r.g, 3)}</td>
                <td className="num">{nf(r.p, 4)}</td>
                <td className="num">{nf(r.pmDeg, 3)}°</td>
                <td className="num">{nf(rmsAt(r.mu), 3)}</td>
                <td className="small">
                  {r.method === 'closed-form'
                    ? md('封閉式（$g=1$）')
                    : r.method === 'constraint'
                      ? '限制條件（下限）'
                      : r.atBoundary
                        ? '數值；落在可行區間的邊界'
                        : md(String.raw`$dJ/d\mu=0$（數值）`)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Plot
        title="各目標的成本曲線（各自除以自己的最小值）"
        data={plot.traces}
        layout={{
          shapes: plot.shapes,
          xaxis: { title: { text: String.raw`$\mu$（fs，log）` } },
          yaxis: { title: { text: String.raw`$J(\mu)/J(\mu^*)$` }, range: [-0.05, 1.3] },
        }}
        xLog
        yLog
        height={340}
        csvName="ch14-objective-costs"
        caption={md(String.raw`每條曲線的最低點（縱軸為 1）就是該目標的最佳 $\mu$；點線是各目標的最佳點（含 fastest 的 $\mu=1/K$）。spur 曲線只畫在滿足收斂要求的區域。`)}
      />
      <Callout kind="ok" title="結論">
        <ClaimTag kind="exact" /> 在同一個線性模型裡，最佳 <Tex>{'\\mu'}</Tex> 從「{OBJECTIVE_LABEL[lowest.o]}」的 {nf(lowest.r.mu, 3)} fs 到「{OBJECTIVE_LABEL[highest.o]}」的 {nf(highest.r.mu, 4)} fs，
        差了約 {nf(highest.r.mu / lowest.r.mu, 2)} 倍。<strong>規格書要先寫清楚「最佳化什麼」</strong>，否則「最佳 <Tex>{'\\mu'}</Tex>」沒有意義。
      </Callout>
      <ModeGate min="engineer">
        <CodeBlock source={optimizerSrc} region="objectiveCost" path="src/simulation/models/optimizer.ts" />
        <CodeBlock source={optimizerSrc} region="optimizeMu" path="src/simulation/models/optimizer.ts" />
      </ModeGate>
      <ModeGate min="research">
        <CodeBlock source={optimizerSrc} region="dJdmu" path="src/simulation/models/optimizer.ts" />
        <CodeBlock source={optimizerSrc} region="asymptoticFinal" path="src/simulation/models/optimizer.ts" />
      </ModeGate>
    </Section>
  )
}
