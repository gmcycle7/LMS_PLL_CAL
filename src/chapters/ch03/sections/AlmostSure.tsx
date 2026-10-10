import { useMemo } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import { Callout, ClaimTag, ModeGate, Plot, Prereq, Section, SourceTag, Tex, TexBlock, useThemeTokens } from '@/components'
import { createRng } from '@/simulation/core'
import { meanSquareFactor } from '@/simulation/models/lms'
import {
  drawX,
  fastestAlmostSure,
  kestenTailExponent,
  lyapunovExponent,
  stabilityBounds,
  stabilityFactors,
  type XDist,
} from '@/simulation/models/scalarStability'
import { Erratum, FBlock, HC, logGrid, num, StepsBox, T, tnum, tx } from '../common'
import { EXAMPLE_DISTS } from './RandomMean'

const GAUSS: XDist = { kind: 'gaussian', sigma: 1 }
const PARADOX_MU = 0.8
const PARADOX_N = 200

/** μ = 0.8 的 8 筆手算（seed 固定，示意）：顯示「平均 f²」與「平均 ln|f|」差在哪 */
function ProductTable() {
  const { rows, meanF2, meanLog, prod } = useMemo(() => {
    const rng = createRng(20261010).fork('ch03-as-hand')
    const rows = Array.from({ length: 8 }, (_, k) => {
      const x = drawX(GAUSS, rng)
      const f = 1 - PARADOX_MU * x * x
      return { k, x, f, f2: f * f, lg: Math.log(Math.abs(f)) }
    })
    return {
      rows,
      meanF2: rows.reduce((s, r) => s + r.f2, 0) / rows.length,
      meanLog: rows.reduce((s, r) => s + r.lg, 0) / rows.length,
      prod: rows.reduce((s, r) => s * r.f, 1),
    }
  }, [])
  return (
    <>
      <div className="table-wrap">
        <table className="ch03-num">
          <thead>
            <tr>
              <th>
                <Tex>k</Tex>
              </th>
              <th>
                <Tex>{T`x_k`}</Tex>
              </th>
              <th>
                <Tex>{T`f_k=1-0.8x_k^2`}</Tex>
              </th>
              <th>
                <Tex>{T`f_k^2`}</Tex>
              </th>
              <th>
                <Tex>{T`\ln|f_k|`}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.k}>
                <td>{r.k}</td>
                <td>{num(r.x, 4)}</td>
                <td>{num(r.f, 4)}</td>
                <td>{num(r.f2, 4)}</td>
                <td>{num(r.lg, 4)}</td>
              </tr>
            ))}
            <tr>
              <td>平均</td>
              <td>—</td>
              <td>—</td>
              <td>
                <strong>{num(meanF2, 4)}</strong>
              </td>
              <td>
                <strong>{num(meanLog, 4)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        這 8 筆的乘積 <Tex>{T`\prod f_k=${tnum(prod, 4)}`}</Tex>，<Tex>{T`|\delta_8|/|\delta_0|=e^{8\cdot(${tnum(meanLog, 4)})}`}</Tex>。平方的平均被少數大的 <Tex>{T`|f_k|`}</Tex> 拉高，
        對數的平均則反映「典型」的一步。理論值：<Tex>{T`g(0.8)=${tnum(meanSquareFactor(0.8, 1, 3), 4)}`}</Tex>、<Tex>{T`\lambda(0.8)=${tnum(lyapunovExponent(0.8, GAUSS), 5)}`}</Tex>。
        <SourceTag kind="illustrative" />
      </p>
    </>
  )
}

function LambdaPlot() {
  const tokens = useThemeTokens()
  const data = useMemo<Data[]>(() => {
    const mus = logGrid(0.01, 4, 260)
    const traces: Data[] = EXAMPLE_DISTS.map(({ label, dist }, i) => ({
      x: mus,
      y: mus.map((mu) => {
        const l = lyapunovExponent(mu, dist)
        return Number.isFinite(l) ? l : null
      }),
      name: `λ(μ)：${label}`,
      mode: 'lines',
      line: { color: tokens.series[i], width: 2 },
    }))
    const g = stabilityBounds(GAUSS)
    const fast = fastestAlmostSure(GAUSS)
    traces.push({
      x: [g.asMax, fast.mu],
      y: [0, fast.lambda],
      mode: 'text+markers',
      text: [`μ_as ≈ ${num(g.asMax, 5)}`, `最快 μ ≈ ${num(fast.mu, 4)}`],
      textposition: 'top center',
      name: 'Gaussian 的界限與最快點',
      marker: { size: 10, color: tokens.text, symbol: 'diamond' },
      textfont: { color: tokens.text, size: 11 },
    } as Data)
    traces.push({ x: [0.01, 4], y: [0, 0], mode: 'lines', name: 'λ = 0', line: { color: tokens.textMuted, dash: 'dash', width: 1.5 } })
    return traces
  }, [tokens])
  const layout = useMemo<Partial<Layout>>(
    () => ({ xaxis: { title: { text: 'μ（log；P_x = 1 或稀疏 code）' }, type: 'log' }, yaxis: { title: { text: 'λ(μ) = E ln|1 − μx²|' }, range: [-1.5, 1.2] } }),
    [],
  )
  return (
    <Plot
      title={T`Lyapunov 指數 $\lambda(\mu)$：小於 0 就是幾乎每條路徑收斂`}
      ariaLabel="Lyapunov 指數對學習率：小於 0 就是幾乎每條路徑收斂"
      data={data}
      layout={layout}
      height={340}
      csvName="ch03-lyapunov"
      caption={tx`Gaussian 由 Dawson 形式、Uniform 由封閉式（F-03.12）、$\pm1$ 與稀疏 code 直接計算。$\pm1$ 在 $\mu=1$ 時 $\lambda=-\infty$（一步歸零）；稀疏 code 在 $\mu=1/9$ 時 $\lambda=-\infty$，在 $\mu>2/9$ 後 $\lambda>0$。`}
    />
  )
}

export function AlmostSureSection() {
  // 這些數值都由解析／數值積分即時計算（約數十 ms），只算一次
  const { f08, gb, fast, kt, unif } = useMemo(
    () => ({
      f08: stabilityFactors(PARADOX_MU, GAUSS),
      gb: stabilityBounds(GAUSS),
      fast: fastestAlmostSure(GAUSS),
      kt: kestenTailExponent(PARADOX_MU, GAUSS),
      unif: stabilityBounds(EXAMPLE_DISTS[1].dist),
    }),
    [],
  )
  const rmsLog10 = (PARADOX_N / 2) * Math.log10(f08.g)
  const typLog10 = (PARADOX_N * f08.lambda) / Math.LN10
  return (
    <>
      <h2 id="almost-sure">4｜第三種收斂：幾乎每條路徑（Almost-Sure）</h2>
      <Section kind="intuition" title="一個看似矛盾的現象">
        <p>
          Gaussian <Tex>x</Tex>、<Tex>{T`\mu=0.8`}</Tex>（介於 MS 界 <Tex>{T`2/3`}</Tex> 與 mean 界 2 之間）、<Tex>{T`\delta_0=1`}</Tex>。第 3 節說 MSD 每步乘上{' '}
          <Tex>{T`g(0.8)=${tnum(f08.g, 4)}>1`}</Tex>，所以 <Tex>{T`\sqrt{E[\delta_{200}^2]}=g^{100}\approx10^{${tnum(rmsLog10, 4)}}`}</Tex>——爆炸。可是你在 Stability Lab
          裡跑出來的路徑，<Tex>{T`|\delta_{200}|`}</Tex> 的典型值（中位數）約 <Tex>{T`|\delta_0|\,e^{200\lambda}=10^{${tnum(typLog10, 4)}}`}</Tex>，幾乎每一條都遠小於{' '}
          <Tex>{T`10^{-3}`}</Tex>——收斂得非常好。<strong>兩者都對</strong>，因為它們回答的是不同問題。<Erratum id="E14" />
        </p>
      </Section>

      <Section kind="example" title="先算一次：8 個隨機因子">
        <ProductTable />
      </Section>

      <Section kind="formula" title="乘積取對數、變成總和、再用大數法則">
        <Prereq title="對數把乘積變成總和；大數法則（law of large numbers）">
          <p>
            <strong>對數</strong>：<Tex>{T`\ln(ab)=\ln a+\ln b`}</Tex>，所以 <Tex>{T`\ln\prod_k|f_k|=\sum_k\ln|f_k|`}</Tex>。乘積很難分析，總和很容易。
          </p>
          <p>
            <strong>大數法則</strong>（law of large numbers）：<Tex>{T`Y_1,Y_2,\dots`}</Tex> iid、平均 <Tex>{T`m=E[Y]`}</Tex>，則樣本平均 <Tex>{T`\frac1n\sum_{k=1}^nY_k\to m`}</Tex>。
            直覺：平均值的變異數是 <Tex>{T`\operatorname{Var}(Y)/n\to0`}</Tex>（獨立項的變異數相加，再除以 <Tex>{T`n^2`}</Tex>），所以越平均越集中在 <Tex>m</Tex>；
            「強」大數法則更保證<strong>幾乎每一條</strong>樣本序列都如此（機率 1，almost surely）。擲公正銅板 <Tex>{T`Y\in\{0,1\}`}</Tex>，正面比例 <Tex>{T`\to0.5`}</Tex> 就是例子。
          </p>
        </Prereq>
        <StepsBox
          title={tx`$\lambda(\mu)=E\ln|1-\mu x^2|$ 決定典型路徑`}
          steps={[
            { tex: T`|\delta_n|=|\delta_0|\prod_{k=0}^{n-1}|1-\mu x_k^2|`, why: '第 2 節的乘積式取絕對值（無雜訊）。' },
            { tex: T`\ln|\delta_n|=\ln|\delta_0|+\sum_{k=0}^{n-1}\ln|1-\mu x_k^2|`, why: '取自然對數：乘積變總和。' },
            { tex: T`\frac1n\ln\frac{|\delta_n|}{|\delta_0|}=\frac1n\sum_{k=0}^{n-1}Y_k\ \xrightarrow{\ n\to\infty\ }\ E[Y]=\lambda(\mu)`, why: tx`$Y_k=\ln|1-\mu x_k^2|$ 是 iid（因為 $x_k$ 是 iid），用大數法則。` },
            { tex: T`|\delta_n|=|\delta_0|\,e^{\,n\lambda+o(n)}`, why: tx`把上一行乘回 $n$ 再取指數；$o(n)$ 表示比 $n$ 增長慢的修正。` },
            { tex: T`\lambda<0\Rightarrow|\delta_n|\to0\ \text{（a.s.）};\quad\lambda>0\Rightarrow|\delta_n|\to\infty\ \text{（a.s.）}`, why: tx`指數 $n\lambda\to\mp\infty$；這對「幾乎每一條」路徑成立（機率 1）。$\lambda=0$ 時（$\ln|f|$ 非常數）路徑在 0 與 $\infty$ 之間無限次來回，也不收斂。` },
          ]}
          result={T`\text{almost-sure 收斂}\iff\lambda(\mu)=E\big[\ln|1-\mu x^2|\big]<0`}
        />
        <FBlock id="F-03.9" />
        <p>
          <Tex>\lambda</Tex> 叫 <strong>Lyapunov 指數</strong>：典型路徑每一步的平均對數縮放率，<Tex>{T`e^{\lambda}`}</Tex> 是每步縮放倍率的<strong>幾何平均</strong>。
          標準 Gaussian 的 <Tex>{T`\lambda(\mu)`}</Tex> 沒有初等封閉式，數值求根得 <Tex>{T`\mu_\text{as}=${tnum(gb.asMax, 10)}`}</Tex>（與 scipy 一致到 <Tex>{T`10^{-9}`}</Tex>）。
          <ClaimTag kind="exact" />
        </p>
        <LambdaPlot />
        <ModeGate min="engineer">
          <p>
            小 <Tex>\mu</Tex> 時三種判據一致：<Tex>{T`\ln|1-\mu P_x|\approx-\mu P_x`}</Tex>、<Tex>{T`\tfrac12\ln g\approx-\mu P_x`}</Tex>、<Tex>{T`\lambda\approx-\mu P_x`}</Tex>（泰勒一階）。
            差別只出現在 <Tex>\mu</Tex> 不小時。收斂最快的典型路徑在 <Tex>{T`\mu\approx${tnum(fast.mu, 4)}`}</Tex>（<Tex>{T`\lambda=${tnum(fast.lambda, 4)}`}</Tex>），
            而 MSD 最快在 <Tex>{T`\mu^\ast=1/3`}</Tex>（<Tex>{T`\tfrac12\ln g^\ast=${tnum(0.5 * Math.log(2 / 3), 4)}`}</Tex>）——「最佳步長」也取決於你用哪一種收斂來衡量。
          </p>
        </ModeGate>
      </Section>

      <Section kind="formula" title="三種判據的大小順序（Jensen 不等式）">
        <Prereq title="Jensen 不等式：對數的平均不超過平均的對數（用切線證明）">
          <p>
            <Tex>{T`\ln`}</Tex> 是凹函數（二階導數 <Tex>{T`-1/y^2<0`}</Tex>），所以圖形永遠在任一條切線下方。在 <Tex>{T`m=E[Y]>0`}</Tex> 的切線：
          </p>
          <TexBlock>{T`\ln y\le\ln m+\frac{y-m}{m}\quad(\forall\,y>0)\ \ \Rightarrow\ \ E[\ln Y]\le\ln m+\frac{E[Y]-m}{m}=\ln E[Y]`}</TexBlock>
          <p>第二步是對隨機的 <Tex>Y</Tex> 兩邊取期望值（不等式保持），並用 <Tex>{T`E[Y]=m`}</Tex>。等號只在 <Tex>Y</Tex> 是常數時成立。</p>
        </Prereq>
        <StepsBox
          title={tx`$\lambda\le\tfrac12\ln g$：mean-square 穩定 $\Rightarrow$ almost-sure 穩定`}
          steps={[
            { tex: T`\lambda=E\big[\ln|1-\mu x^2|\big]=\tfrac12E\big[\ln(1-\mu x^2)^2\big]`, why: tx`$\ln|f|=\tfrac12\ln f^2$。` },
            { tex: T`\le\tfrac12\ln E\big[(1-\mu x^2)^2\big]=\tfrac12\ln g(\mu)`, why: tx`Jensen，取 $Y=(1-\mu x^2)^2$。` },
            { tex: T`g<1\Rightarrow\ln g<0\Rightarrow\lambda<0`, why: tx`所以 MS 收斂的 $\mu$ 一定也讓幾乎每條路徑收斂。` },
            { tex: T`g=E[f^2]=\operatorname{Var}(f)+E[f]^2\ge(1-\mu P_x)^2`, why: tx`變異數公式（$f=1-\mu x^2$）；所以 $g<1\Rightarrow|1-\mu P_x|<1$：MS 收斂 $\Rightarrow$ mean 收斂。` },
          ]}
        />
        <FBlock id="F-03.10" />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>關係</th>
                <th>是否一般成立</th>
                <th>例子</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  MS <Tex>{T`\Rightarrow`}</Tex> mean
                </td>
                <td>是（<Tex>{T`g\ge(1-\mu P_x)^2`}</Tex>）</td>
                <td>所有分布</td>
              </tr>
              <tr>
                <td>
                  MS <Tex>{T`\Rightarrow`}</Tex> a.s.
                </td>
                <td>是（Jensen）</td>
                <td>所有分布</td>
              </tr>
              <tr>
                <td>
                  a.s. <Tex>{T`\Rightarrow`}</Tex> mean
                </td>
                <td>否</td>
                <td>
                  Gaussian <Tex>{T`2<\mu<${tnum(gb.asMax, 5)}`}</Tex>：路徑收斂，<Tex>{T`E[\delta_n]`}</Tex> 卻以 <Tex>{T`(1-\mu)^n`}</Tex> 震盪發散
                </td>
              </tr>
              <tr>
                <td>
                  mean <Tex>{T`\Rightarrow`}</Tex> a.s.
                </td>
                <td>否</td>
                <td>
                  稀疏 code <Tex>{T`\{0\times9,3\}`}</Tex>、<Tex>{T`2/9<\mu<20/9`}</Tex>：平均收斂，路徑發散
                </td>
              </tr>
              <tr>
                <td>{tx`$|x|$ 為常數（$\pm A$、固定 $x$）`}</td>
                <td>三者相同</td>
                <td>Jensen 取等號：<Tex>{T`2/A^2`}</Tex></td>
              </tr>
            </tbody>
          </table>
        </div>
        <HC id="HC-03.6">
          {tx`上表「mean $\Rightarrow$ a.s. 不成立」的例子可以完全手算：稀疏 code 只有一個非零取值，$\lambda$ 只要按一次 $\ln$。換成你自己的 $A$、$K$、$\mu$，先把三個判據各算一次，再對答案。`}
        </HC>
      </Section>

      <Section kind="assumptions" title={tx`所以 $2/3<\mu<${tnum(gb.asMax, 3)}$ 時到底穩不穩定？`}>
        <Callout kind="warn" title={<>單一路徑收斂不推翻 mean-square 界 <Erratum id="E14" /></>}>
          <p>
            <Tex>{T`2/3<\mu<${tnum(gb.asMax, 5)}`}</Tex>（Gaussian、無雜訊）：<Tex>{T`E[\delta_n^2]\to\infty`}</Tex>，但幾乎每條路徑 <Tex>{T`|\delta_n|\to0`}</Tex>。
            <Tex>{T`E[\delta_n^2]`}</Tex> 是「所有可能路徑的平方平均」，被<strong>機率極小、數值極大</strong>的少數路徑主導：這些路徑出現的機率趨近 0，但它們的 <Tex>{T`\delta^2`}</Tex> 增長得比機率下降更快。
            單位步的「差距」是 <Tex>{T`\tfrac12\ln g-\lambda\ge0`}</Tex>；<Tex>{T`\mu=0.8`}</Tex> 時 <Tex>{T`=${tnum(0.5 * Math.log(f08.g) - f08.lambda, 4)}`}</Tex>（自然對數 / step）。
          </p>
          <p>
            工程上這代表：在這個區間<strong>不能</strong>宣稱「均方穩定」，也不能用少量 seeds 的 sample path 去「驗證」2/3 是錯的；你看到的只是典型路徑。
            有雜訊時情況更微妙（下一段）。
          </p>
        </Callout>
        <ModeGate min="research">
          <FBlock id="F-03.17" />
          <p>
            Research：有量測雜訊且 <Tex>{T`\lambda<0`}</Tex> 時，<Tex>{T`\delta_n`}</Tex> 會收斂到一個<strong>穩態分布</strong>（Kesten 型隨機遞迴 <Tex>{T`\delta_{n+1}=A_n\delta_n+B_n`}</Tex>，
            <Tex>{T`A_n=1-\mu x_n^2`}</Tex>、<Tex>{T`B_n=-\mu x_nv_n`}</Tex>），但它的尾巴是冪次：<Tex>{T`P(|\delta_\infty|>t)\sim Ct^{-\kappa_t}`}</Tex>。
            因為 <Tex>{T`m(s)=E|A|^s`}</Tex> 滿足 <Tex>{T`m(0)=1`}</Tex>、<Tex>{T`m'(0)=\lambda<0`}</Tex>、<Tex>{T`\ln m(s)`}</Tex> 為凸，且 <Tex>{T`m(2)=g`}</Tex>：
            <Tex>{T`g\ge1\iff\kappa_t\le2`}</Tex>（穩態變異數無限大）。<Tex>{T`\mu=0.8`}</Tex> 時 <Tex>{T`\kappa_t=${tnum(kt, 4)}`}</Tex>：分布存在、中位數有限，但二階動差不存在。
            Stability Lab 開啟雜訊時會以 Hill estimator 從 Monte Carlo 估計 <Tex>{T`\kappa_t`}</Tex> 交叉比對。
            <ClaimTag kind="research" /> <SourceTag kind="literature" />（H. Kesten, Acta Math. 131, 1973；C. M. Goldie, Ann. Appl. Probab. 1, 1991；L. Guo, L. Ljung, G.-J. Wang, IEEE TAC 42(6), 1997）
          </p>
        </ModeGate>
      </Section>

      <ModeGate min="engineer">
        <Section kind="formula" title={tx`Uniform $x$ 的 $\lambda(\mu)$：只用微積分的封閉式`}>
          <StepsBox
            title={tx`$x\sim U(-c,c)$`}
            steps={[
              { tex: T`\lambda=\frac{1}{2c}\int_{-c}^{c}\ln|1-\mu x^2|\,dx=\frac1c\int_0^c\ln|1-\mu x^2|\,dx`, why: tx`期望值 = 密度 $1/(2c)$ 乘積分；被積函數是偶函數。` },
              { tex: T`1-\mu x^2=(1-sx)(1+sx),\qquad s=\sqrt{\mu}`, why: tx`平方差公式（$\mu>0$）。` },
              { tex: T`\ln|1-\mu x^2|=\ln|1-sx|+\ln(1+sx)`, why: tx`對數把乘積變總和（$0\le x\le c$ 時 $1+sx>0$）。` },
              { tex: T`\int_0^c\ln(1+sx)\,dx=\frac{(1+u)\ln(1+u)-u}{s},\qquad u=sc`, why: tx`代換 $y=1+sx$（$dy=s\,dx$），用 $\int\ln y\,dy=y\ln y-y$。` },
              { tex: T`\int_0^c\ln|1-sx|\,dx=-\frac{(1-u)\ln|1-u|+u}{s}`, why: tx`代換 $y=1-sx$（$dy=-s\,dx$）；$u=1$ 處 $y\ln|y|\to0$，是可積奇點。` },
              { tex: T`\lambda=\frac{1}{c}\cdot\frac{(1+u)\ln(1+u)-(1-u)\ln|1-u|-2u}{s}=\frac{(1+u)\ln(1+u)-(1-u)\ln|1-u|}{u}-2`, why: tx`兩項相加後除以 $c$，並用 $sc=u$。` },
            ]}
          />
          <FBlock id="F-03.12" />
          <p>
            檢查：<Tex>u</Tex> 很小時泰勒展開得 <Tex>{T`\lambda\approx-u^2/3=-\mu c^2/3=-\mu P_x`}</Tex>，與上面「小 <Tex>\mu</Tex> 時三種判據一致」的結論相符。單位功率（<Tex>{T`c=\sqrt3`}</Tex>）時{' '}
            <Tex>{T`\mu_\text{as}=${tnum(unif.asMax, 6)}`}</Tex>，比 mean 界 2 略大、比 MS 界 <Tex>{T`10/9`}</Tex> 大很多。
          </p>
        </Section>
      </ModeGate>

      <ModeGate min="research">
        <Section kind="formula" title={tx`Gaussian 的 $\lambda(\mu)$：Dawson 形式（交叉驗證用）`}>
          <FBlock id="F-03.15" />
          <p className="small">
            推導概要：令 <Tex>{T`X=t^2\sim\chi^2_1`}</Tex>、<Tex>{T`a=1/c`}</Tex>，<Tex>{T`\lambda=\ln c+E\ln|X-a|`}</Tex>。對 <Tex>a</Tex> 微分得主值積分{' '}
            <Tex>{T`-\,\mathrm{PV}\,E[1/(X-a)]`}</Tex>；Gaussian 的 Hilbert 轉換是 Dawson 函數 <Tex>{T`F(z)=e^{-z^2}\int_0^ze^{s^2}ds`}</Tex>，得{' '}
            <Tex>{T`\tfrac{d}{dz}E\ln|X-a|=4F(z)`}</Tex>（<Tex>{T`z=\sqrt{a/2}`}</Tex>）。由 <Tex>{T`E\ln X=-\gamma-\ln2`}</Tex> 積分，再用{' '}
            <Tex>{T`F(z)=\tfrac12\int_0^\infty e^{-t^2/4}\sin(zt)\,dt`}</Tex> 交換積分次序，得到上式。被積函數處處平滑，Simpson 積分誤差約 <Tex>{T`10^{-9}`}</Tex>；
            它與 lms.ts 的直接積分（含對數奇點的代換）在單元測試中互相比對（差 &lt; <Tex>{T`10^{-5}`}</Tex>）。小 <Tex>c</Tex> 時改用漸近級數{' '}
            <Tex>{T`\lambda\approx-\sum_k(2k-1)!!\,c^k/k=-c-\tfrac32c^2-5c^3-\cdots`}</Tex>（首項 <Tex>{T`-\mu P_x`}</Tex>）。
          </p>
        </Section>
      </ModeGate>
    </>
  )
}
