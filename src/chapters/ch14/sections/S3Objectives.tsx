import { useMemo } from 'react'
import type { Data, Shape } from 'plotly.js-dist-min'
import { Callout, ClaimTag, CodeBlock, ModeGate, Plot, Section, Tex, TexBlock, useThemeTokens } from '@/components'
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
        <Tex>{'B=32'}</Tex>、<Tex>{'\\delta_0=3\\,\\mathrm{fs}'}</Tex>），換一個目標，答案可以差十倍以上。下面逐一推導。
      </p>

      <h3>
        (a) 最小終點 RMS：對 <Tex>{'\\mu'}</Tex> 微分
      </h3>
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
      <p>係數雜訊不是白的：它是 GMAC 白雜訊經過 <Tex>{'H(z)=\\mu/(z-p)'}</Tex> 的 low-pass（§12）。在 block-rate 頻率 <Tex>{'\\Omega'}</Tex> 的 PSD：</p>
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
        既然成本隨 <Tex>{'\\mu'}</Tex> 單調遞增，最佳解就是「滿足收斂要求的最小 <Tex>{'\\mu'}</Tex>」：<Tex>{'|E[\\delta_B]|=p^B|\\delta_0|\\le\\epsilon|\\delta_0|\\Rightarrow\\mu\\ge(1-\\epsilon^{1/B})/K'}</Tex>（§14.5 的單一 corner 版本）。
        答案由<strong>限制條件</strong>決定，不是由導數為零決定。
      </p>

      <h3>(e) 最佳 PVT 追蹤</h3>
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
      <TexBlock id="F-14.14" label={md(String.raw`PM 與 $\mu$ 上限`)}>
        {String.raw`PM=90^\circ-\arcsin\frac{g}{2}\ \ge PM_t\iff g\le2\sin(90^\circ-PM_t)=2\cos PM_t\qquad(PM_t=60^\circ\Rightarrow\mu\le1/K)`}
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
          xaxis: { title: { text: 'μ（fs，log）' } },
          yaxis: { title: { text: 'J(μ)/J(μ*)' }, range: [-0.05, 1.3] },
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
