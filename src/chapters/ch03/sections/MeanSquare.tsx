import { useMemo } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import { Callout, ClaimTag, ModeGate, Plot, Prereq, Section, Tex, TexBlock, useThemeTokens, ChRef } from '@/components'
import { meanSquareFactor } from '@/simulation/models/lms'
import { analyticTrajectory, stabilityBounds, xMoments } from '@/simulation/models/scalarStability'
import { Erratum, FBlock, Fig, HC, num, StepsBox, T, tnum, tx, Verdict } from '../common'
import { CHART_G_BUILD, CHART_KURTOSIS_COMPARE, CHART_MSD_LOOP, CHART_NOISE_INJECTION, figRef } from '../diagrams'
import { EXAMPLE_DISTS } from './RandomMean'
import t03 from '../../../../golden/vectors/T03.json'

/** 規格 T03 的 golden vector（Python 獨立計算）；表中的因子由 meanSquareFactor 即時計算後逐項比對 */
const T03_MUS: number[] = t03.inputs.mu_list
const T03_G: number[] = t03.expected.ms_factor_list
const T03_TOL = t03.tolerance.abs

function DistTable() {
  const rows = useMemo(
    () =>
      EXAMPLE_DISTS.map(({ label, tex, dist }) => {
        const m = xMoments(dist)
        const b = stabilityBounds(dist)
        return { label, tex, m, b }
      }),
    [],
  )
  return (
    <div className="table-wrap">
      <table className="ch03-num">
        <thead>
          <tr>
            <th>
              <Tex>x</Tex> 的分布
            </th>
            <th>
              <Tex>{T`P_x`}</Tex>
            </th>
            <th>
              <Tex>{T`M_4`}</Tex>
            </th>
            <th>
              <Tex>{T`\kappa=M_4/P_x^2`}</Tex>
            </th>
            <th>
              mean 界 <Tex>{T`2/P_x`}</Tex>
            </th>
            <th>
              MS 界 <Tex>{T`2P_x/M_4`}</Tex>
            </th>
            <th>
              a.s. 界 <Tex>{T`\mu_\text{as}`}</Tex>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, tex, m, b }) => (
            <tr key={label}>
              <td>
                <Tex>{tex}</Tex>
              </td>
              <td>{num(m.Px, 4)}</td>
              <td>{num(m.M4, 4)}</td>
              <td>{num(m.kurtosis, 4)}</td>
              <td>{num(b.meanMax, 5)}</td>
              <td>{num(b.msMax, 5)}</td>
              <td>{num(b.asMax, 5)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function T03Table() {
  return (
    <div className="table-wrap">
      <table className="ch03-num">
        <thead>
          <tr>
            <th>
              <Tex>\mu</Tex>
            </th>
            <th>
              mean 因子 <Tex>{T`1-\mu`}</Tex>
            </th>
            <th>mean</th>
            <th>
              MS 因子 <Tex>{T`g=1-2\mu+3\mu^2`}</Tex>
            </th>
            <th>mean-square</th>
            <th>
              golden <Tex>g</Tex>（Python）
            </th>
          </tr>
        </thead>
        <tbody>
          {T03_MUS.map((mu, i) => {
            const g = meanSquareFactor(mu, 1, 3)
            const match = Math.abs(g - T03_G[i]) <= T03_TOL
            return (
              <tr key={mu}>
                <td>{num(mu, 4)}</td>
                <td>{num(1 - mu, 4)}</td>
                <td>
                  <Verdict value={Math.abs(1 - mu)} />
                </td>
                <td>{num(g, 4)}</td>
                <td>
                  <Verdict value={g} />
                </td>
                <td>
                  {num(T03_G[i], 6)} {match ? '✓' : '✗ 不一致'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function GParabolaPlot() {
  const tokens = useThemeTokens()
  const data = useMemo<Data[]>(() => {
    const mus = Array.from({ length: 301 }, (_, i) => (2.4 * i) / 300)
    const traces: Data[] = EXAMPLE_DISTS.slice(0, 3).map(({ label, dist }, i) => {
      const m = xMoments(dist)
      return {
        x: mus,
        y: mus.map((mu) => meanSquareFactor(mu, m.Px, m.M4)),
        name: T`$g(\mu)$：${label}`,
        mode: 'lines',
        line: { color: tokens.series[i], width: 2 },
      } as Data
    })
    const opt: Data = {
      x: EXAMPLE_DISTS.slice(0, 3).map(({ dist }) => stabilityBounds(dist).msOpt),
      y: EXAMPLE_DISTS.slice(0, 3).map(({ dist }) => stabilityBounds(dist).msOptFactor),
      name: T`最小值 $\mu^\ast = P_x/M_4$`,
      mode: 'markers',
      marker: { size: 9, color: tokens.text, symbol: 'diamond' },
    }
    const one: Data = { x: [0, 2.4], y: [1, 1], name: '門檻 $g = 1$', mode: 'lines', line: { color: tokens.textMuted, dash: 'dash', width: 1.5 } }
    return [...traces, opt, one]
  }, [tokens])
  const layout = useMemo<Partial<Layout>>(() => ({ xaxis: { title: { text: T`$\mu$（單位功率 $P_x = 1$）` } }, yaxis: { title: { text: T`$g(\mu) = E[(1 - \mu x^2)^2]$` }, range: [0, 3] } }), [])
  return (
    <Plot
      title={T`MSD 每步因子 $g(\mu)$：開口向上的拋物線`}
      ariaLabel="MSD 每步因子對學習率：開口向上的拋物線"
      data={data}
      layout={layout}
      height={320}
      csvName="ch03-g-parabola"
      caption={tx`三個分布功率相同（$P_x=1$，所以 mean 界都是 2），差別只在 $M_4$：kurtosis 越大，拋物線越陡，$g<1$ 的區間越短。`}
    />
  )
}

function StationaryRmsPlot() {
  const tokens = useThemeTokens()
  const sigmaV = 0.1
  const data = useMemo<Data[]>(() => {
    const mus = Array.from({ length: 400 }, (_, i) => 0.005 + (2.1 * i) / 399)
    return EXAMPLE_DISTS.slice(0, 3).map(({ label, dist }, i) => ({
      x: mus,
      y: mus.map((mu) => {
        const msd = analyticTrajectory({ mu, dist, delta0: 0, noiseSigma: sigmaV }, [0]).msdInf
        return Number.isFinite(msd) ? Math.sqrt(msd) : null
      }),
      name: label,
      mode: 'lines',
      line: { color: tokens.series[i], width: 2 },
    }))
  }, [tokens])
  const layout = useMemo<Partial<Layout>>(() => ({ xaxis: { title: { text: T`$\mu$` } }, yaxis: { title: { text: T`$\sqrt{\text{MSD}_\infty}$（$\sigma_v = 0.1$）` } } }), [])
  return (
    <Plot
      title={T`有雜訊時的穩態 RMS 係數誤差 $\sqrt{\text{MSD}_\infty}$`}
      ariaLabel="有雜訊時的穩態 RMS 係數誤差對學習率"
      data={data}
      layout={layout}
      yLog
      height={300}
      csvName="ch03-stationary-rms"
      caption={tx`由 F-03.11 計算（$\sigma_v=0.1$）：Gaussian 在 $\mu\to2/3$、Uniform 在 $\mu\to10/9$、$\pm1$ 在 $\mu\to2$ 時發散（之後沒有有限的穩態 MSD，曲線中斷）。小 $\mu$ 時 $\sqrt{\text{MSD}_\infty}\approx\sigma_v\sqrt{\mu/2}$。`}
    />
  )
}

export function MeanSquareSection() {
  const g = xMoments({ kind: 'gaussian', sigma: 1 })
  const gb = useMemo(() => stabilityBounds({ kind: 'gaussian', sigma: 1 }), [])
  return (
    <>
      <h2 id="mean-square">3｜均方（Mean-Square）收斂與 MSD：把正負號拿掉</h2>
      <Section kind="intuition" title="為什麼平均不夠">
        <p>
          模型 A 的誤差在 <Tex>{T`\pm10`}</Tex> 之間跳、模型 B 在 <Tex>{T`\pm1`}</Tex> 之間跳，兩者平均都是 0，但 B 顯然好得多。看<strong>平方的平均</strong>{' '}
          <Tex>{T`E[\delta^2]`}</Tex> 才分得出來：A 是 100、B 是 1。
        </p>
        <Callout kind="warn" title={<>{tx`名詞：這裡的 $E[\delta^2]$ 是 MSD，不是 MSE`} <Erratum id="E42" /></>}>
          <Tex>{T`E[\delta_n^2]`}</Tex> 是<strong>係數均方偏差</strong>（mean-square deviation, MSD），量的是 <Tex>w</Tex> 離 <Tex>a</Tex> 多遠；<ChRef ch="01">第 1 章</ChRef>的 MSE 成本是{' '}
          <Tex>{T`J=E[e^2]`}</Tex>，量的是預測誤差。iid <Tex>x</Tex>、雜訊零均值且與 <Tex>x</Tex> 獨立時兩者的關係是 <Tex>{T`E[e^2]=P_x\,E[\delta^2]+\sigma_v^2`}</Tex>（<Tex>{T`\sigma_v^2`}</Tex> 是量測雜訊的變異數；本節後面推導）。
          規格 §3.1 的「均方誤差」指的是 MSD；本站圖例一律分開標示「MSD <Tex>{T`E[\delta^2]`}</Tex>」與「MSE <Tex>{T`E[e^2]`}</Tex>」。
        </Callout>
        <Prereq title="變異數（variance）：為什麼均方趨近 0 同時保證平均與分散都趨近 0">
          <p>
            變異數 <Tex>{T`\operatorname{Var}(\delta)=E\big[(\delta-E[\delta])^2\big]`}</Tex>。把平方展開並用線性：
          </p>
          <TexBlock>{T`\operatorname{Var}(\delta)=E[\delta^2]-2E[\delta]E[\delta]+E[\delta]^2=E[\delta^2]-E[\delta]^2\ \ \Rightarrow\ \ E[\delta^2]=\operatorname{Var}(\delta)+E[\delta]^2`}</TexBlock>
          <p>
            兩項都 <Tex>{T`\ge0`}</Tex>，所以 <Tex>{T`E[\delta^2]\to0`}</Tex> 同時逼迫 <Tex>{T`E[\delta]\to0`}</Tex> 與 <Tex>{T`\operatorname{Var}(\delta)\to0`}</Tex>：<strong>mean-square 收斂 <Tex>{T`\Rightarrow`}</Tex> mean 收斂</strong>，反之不成立。
          </p>
        </Prereq>
      </Section>

      <Section kind="formula" title="一步一步推導 MSD 遞迴">
        <p>
          做法和上一節一樣，只是先把遞迴<strong>兩邊平方</strong>再取期望值，所以每一步乘上的倍數變成 <Tex>{T`g(\mu)=E\big[(1-\mu x^2)^2\big]`}</Tex>——我們叫它 <strong>MSD 每步因子</strong>。
          下圖把 <Tex>g</Tex> 怎麼由輸入的兩個統計量組出來畫成訊號流：
        </p>
        <Fig
          chart={CHART_G_BUILD}
          caption={T`MSD 每步因子 $g(\mu)$ 的組成。看加法點（藍）的三條輸入 $+1$、$-2\mu P_x$、$+\mu^2M_4$，以及最後和 1 的比較。`}
          ariaLabel="由 x 算出 P x（平方後取平均）與 M 4（四次方後取平均）；1 減 2 mu P x 加 mu 平方 M 4 得到 g；g 小於 1 時 MSD 每步縮小，否則不變或發散"
        />
        <p>
          先看上半：由 <Tex>x</Tex> 算出兩個統計量——平方後取平均是 <Tex>{T`P_x`}</Tex>，四次方後取平均是 <Tex>{T`M_4`}</Tex>。再看加法點：
          <Tex>{T`+1`}</Tex>、<Tex>{T`-2\mu P_x`}</Tex>、<Tex>{T`+\mu^2M_4`}</Tex> 三項相加就是 <Tex>g</Tex>；最後的菱形把 <Tex>g</Tex> 和 1 比。加法點的三條輸入線，就是下面推導第 3–4 步展開{' '}
          <Tex>{T`(1-\mu x^2)^2`}</Tex> 得到的三項；菱形「是」那一支就是 F-03.7。
        </p>
        <StepsBox
          title={tx`$E[\delta_{n+1}^2]=g(\mu)\,E[\delta_n^2]$`}
          steps={[
            { tex: T`\delta_{n+1}^2=(1-\mu x_n^2)^2\,\delta_n^2`, why: tx`把 $\delta_{n+1}=(1-\mu x_n^2)\delta_n$ 兩邊平方。` },
            { tex: T`E[\delta_{n+1}^2]=E\big[(1-\mu x_n^2)^2\big]\;E[\delta_n^2]`, why: tx`$x_n$ 與 $\delta_n$ 獨立（同上一節第 3 步），所以它們的函數 $(1-\mu x_n^2)^2$ 與 $\delta_n^2$ 也獨立，期望值可以拆開。` },
            { tex: T`(1-\mu x^2)^2=1-2\mu x^2+\mu^2x^4`, why: tx`展開 $(A-B)^2=A^2-2AB+B^2$。` },
            { tex: T`E\big[(1-\mu x^2)^2\big]=1-2\mu E[x^2]+\mu^2E[x^4]=1-2\mu P_x+\mu^2M_4`, why: tx`線性；用定義 $P_x=E[x^2]$、$M_4=E[x^4]$。` },
          ]}
          result={T`E[\delta_{n+1}^2]=g(\mu)\,E[\delta_n^2],\quad g(\mu)=1-2\mu P_x+\mu^2M_4`}
        />
        <FBlock id="F-03.6" />
        <StepsBox
          title={tx`$g(\mu)<1$ 解成 $\mu$ 的範圍`}
          steps={[
            { tex: T`1-2\mu P_x+\mu^2M_4<1`, why: tx`MSD 是等比數列 $g^n\delta_0^2$，收斂 $\iff g<1$（$g\ge0$ 恆成立，因為是平方的期望值）。` },
            { tex: T`\mu\,(\mu M_4-2P_x)<0`, why: tx`兩邊減 1，再提出公因數 $\mu$。` },
            { tex: T`\mu>0\ \text{且}\ \mu M_4-2P_x<0`, why: tx`兩數相乘為負 $\iff$ 一正一負；$\mu<0$ 時另一個因子也 $<0$，乘積為正，不可能。` },
            { tex: T`0<\mu<\frac{2P_x}{M_4}`, why: tx`$M_4>0$，兩邊同除以 $M_4$。` },
          ]}
        />
        <FBlock id="F-03.7" />
        <Prereq title="Gaussian 的二階與四階動差（1 與 3）：分部積分">
          <p>
            標準常態密度 <Tex>{T`\varphi(t)=\frac{1}{\sqrt{2\pi}}e^{-t^2/2}`}</Tex>，關鍵性質：<Tex>{T`\varphi'(t)=-t\,\varphi(t)`}</Tex>（鏈鎖律）。對 <Tex>{T`k\ge1`}</Tex>：
          </p>
          <TexBlock>{T`\begin{aligned}
E[t^{k+1}]&=\int_{-\infty}^{\infty}t^{k}\,\big(t\varphi(t)\big)\,dt=\int_{-\infty}^{\infty}t^{k}\,\big(-\varphi'(t)\big)\,dt &&\text{（把 } t\varphi \text{ 寫成 } -\varphi'\text{）}\\
&=\Big[-t^{k}\varphi(t)\Big]_{-\infty}^{\infty}+k\int_{-\infty}^{\infty}t^{k-1}\varphi(t)\,dt &&\text{（分部積分 }\textstyle\int u\,dv=uv-\int v\,du\text{）}\\
&=0+k\,E[t^{k-1}] &&\text{（}e^{-t^2/2}\text{ 比任何多項式都衰減得快）}
\end{aligned}`}</TexBlock>
          <p>
            從 <Tex>{T`E[t^0]=\int\varphi=1`}</Tex> 出發：<Tex>{T`E[t^2]=1\cdot1=1`}</Tex>，<Tex>{T`E[t^4]=3\cdot E[t^2]=3`}</Tex>，<Tex>{T`E[t^6]=5\cdot3=15`}</Tex>，
            <Tex>{T`E[t^8]=7\cdot15=105`}</Tex>。一般 <Tex>{T`x=\sigma t`}</Tex>：<Tex>{T`E[x^{2k}]=(2k-1)!!\,\sigma^{2k}`}</Tex>。
          </p>
          <p>
            對照：<strong>Uniform</strong> <Tex>{T`U(-c,c)`}</Tex> 的密度是常數 <Tex>{T`1/(2c)`}</Tex>，直接積分 <Tex>{T`E[x^{2k}]=\frac{1}{2c}\int_{-c}^{c}x^{2k}dx=\frac{c^{2k}}{2k+1}`}</Tex>，
            所以 <Tex>{T`P_x=c^2/3`}</Tex>、<Tex>{T`M_4=c^4/5`}</Tex>、<Tex>{T`\kappa=9/5`}</Tex>。<strong><Tex>{T`\pm A`}</Tex></strong>：<Tex>{T`x^2\equiv A^2`}</Tex>，<Tex>{T`\kappa=1`}</Tex>。
          </p>
        </Prereq>
        <FBlock id="F-03.8" />
        <p>
          標準 Gaussian：<Tex>{T`g(\mu)=1-2\mu+3\mu^2`}</Tex>，<Tex>{T`g(2/3)=1-\tfrac43+\tfrac43=1`}</Tex>，所以 MS 上限是{' '}
          <Tex>{T`2P_x/M_4=${tnum(gb.msMax)}=2/3`}</Tex>，比 mean 上限 <Tex>{T`${tnum(gb.meanMax)}`}</Tex> 嚴格 <Tex>{T`\kappa=${tnum(g.kurtosis)}`}</Tex> 倍。<ClaimTag kind="exact" />
        </p>
        <T03Table />
        <p className="small muted">表中 <Tex>\mu</Tex> 清單即規格 T03 / golden vector 的輸入；因子由網站的 <code>meanSquareFactor</code>（lms.ts）即時計算，最右欄是 Python golden（<code>golden/vectors/T03.json</code>）的值，容許誤差 <Tex>{T`${tnum(T03_TOL)}`}</Tex>；單元測試做同樣的比對。</p>
        <HC id="HC-03.4">
          {tx`上表的每一列都可以自己驗算：把 $\mu$ 換成 $0.3$、$0.6$、$0.7$、$1$、$1.9$，先用紙筆算 $g$ 再對答案；$P_x$、$M_4$ 也可以換成你在 HC-03.3 算出的 code 動差。`}
        </HC>
      </Section>

      <Section kind="diagram" title="Kurtosis（峰度）決定兩個界限差多少">
        <p>
          以下把 mean 界記為 <Tex>{T`\mu_\text{mean}=2/P_x`}</Tex>、mean-square 界記為 <Tex>{T`\mu_\text{MS}=2P_x/M_4`}</Tex>。兩者差幾倍，只看 <Tex>{T`x^2`}</Tex> 起伏得多厲害，也就是 kurtosis{' '}
          <Tex>\kappa</Tex>。下圖把三種功率相同（<Tex>{T`P_x=1`}</Tex>，所以 mean 界都是 2）的分布並排：
        </p>
        <Fig
          chart={CHART_KURTOSIS_COMPARE}
          caption={T`三種分布功率相同（mean 界都是 2），只差在 $x^2$ 起伏多大。看每一框最後一格：$\kappa$ 越大，MS 界 $=2\div\kappa$ 越小（綠 → 褐 → 紅）。`}
          ariaLabel="三列並排：正負 1 的 code，kappa 等於 1，MS 界等於 2；Uniform，kappa 等於 1.8，MS 界等於 9 分之 10；Gaussian，kappa 等於 3，MS 界等於 3 分之 2"
        />
        <p>
          三個框各是一種分布：<Tex>{T`\pm1`}</Tex> code 的 <Tex>{T`x^2`}</Tex> 完全不起伏（<Tex>{T`\kappa=1`}</Tex>），MS 界和 mean 界一樣；Uniform 有上限，<Tex>{T`\kappa=9/5`}</Tex>；Gaussian 偶爾出現很大的{' '}
          <Tex>{T`x^2`}</Tex>，<Tex>{T`\kappa=3`}</Tex>，MS 界縮到 <Tex>{T`2/3`}</Tex>。每一框最後一格都是同一個算式 <Tex>{T`\mu_\text{MS}=\mu_\text{mean}\div\kappa`}</Tex>——下面三行推導證明它，並說明為什麼{' '}
          <Tex>{T`\kappa\ge1`}</Tex>。
        </p>
        <StepsBox
          title={tx`為什麼 MS 界一定 $\le$ mean 界`}
          steps={[
            { tex: T`\operatorname{Var}(x^2)=E[x^4]-E[x^2]^2=M_4-P_x^2\ge0`, why: tx`對隨機變數 $x^2$ 用上面的變異數公式。` },
            { tex: T`\kappa=\frac{M_4}{P_x^2}\ge1`, why: tx`兩邊除以 $P_x^2>0$。` },
            { tex: T`\mu_\text{MS}=\frac{2P_x}{M_4}=\frac{1}{\kappa}\cdot\frac{2}{P_x}=\frac{\mu_\text{mean}}{\kappa}\le\mu_\text{mean}`, why: tx`把 $M_4=\kappa P_x^2$ 代入。等號 $\iff\operatorname{Var}(x^2)=0\iff|x|$ 是常數（例如 $\pm1$ code）。` },
          ]}
        />
        <DistTable />
        <p className="small muted">
          表中最右欄的 a.s. 界 <Tex>{T`\mu_\text{as}`}</Tex> 是第 4 節才會介紹的第三種界限（讓「典型路徑的平均對數縮放率」<Tex>{T`\lambda(\mu)`}</Tex> 等於 0 的那個 <Tex>\mu</Tex>），先列出來對照。
        </p>
        <div className="ch03-plots">
          <GParabolaPlot />
          <div>
            <FBlock id="F-03.13" />
            <p>
              <Tex>{T`g(\mu)`}</Tex> 的最低點在 <Tex>{T`dg/d\mu=-2P_x+2\mu M_4=0`}</Tex>，即 <Tex>{T`\mu^\ast=P_x/M_4`}</Tex>（MS 界的一半），最小值 <Tex>{T`1-1/\kappa`}</Tex>。
              Gaussian：<Tex>{T`\mu^\ast=1/3`}</Tex>、<Tex>{T`g^\ast=2/3`}</Tex>——MSD 每步最多只能縮小到 <Tex>{T`2/3`}</Tex>，不可能像固定 <Tex>x</Tex> 那樣一步到位（<Tex>{T`\kappa=1\Rightarrow g^\ast=0`}</Tex>）。
            </p>
          </div>
        </div>
      </Section>

      <Section kind="formula" title="加入量測雜訊：MSD 的穩態與 MSE">
        <p>
          真實量測有雜訊：<Tex>{T`y_n=ax_n+v_n`}</Tex>，<Tex>{T`v_n`}</Tex> 零均值、變異數 <Tex>{T`\sigma_v^2`}</Tex>、與 <Tex>x</Tex> 獨立。誤差變成 <Tex>{T`e_n=\delta_nx_n+v_n`}</Tex>，遞迴多了一項。先看雜訊從哪裡進到迴圈（{figRef(CHART_NOISE_INJECTION)}），再看平方、取平均之後變成什麼（{figRef(CHART_MSD_LOOP)}）：
        </p>
        <Fig
          chart={CHART_NOISE_INJECTION}
          caption={T`量測雜訊的注入點（紅）。看 $v_n$ 加在誤差 $e_n$ 上，再經「$\times\,\mu x_n$」以負號進入 $\delta_{n+1}$。`}
          ariaLabel="delta n 乘 x n 後與雜訊 v n 相加得到誤差 e n；e n 乘 mu x n 後從 delta n 中減掉得到 delta n 加 1，延遲一步回授"
        />
        <p>
          先看紅色的加法點：<Tex>{T`v[n]`}</Tex> 加在 <Tex>{T`\delta[n]\,x[n]`}</Tex> 上，成為誤差 <Tex>{T`e[n]=\delta[n]\,x[n]+v[n]`}</Tex>。再跟著 <Tex>{T`e[n]`}</Tex> 往下：它乘上 <Tex>{T`\mu\,x[n]`}</Tex>（虛線：和前面乘法點用的是同一個 <Tex>{T`x[n]`}</Tex>）後從{' '}
          <Tex>{T`\delta[n]`}</Tex> 裡被<strong>減掉</strong>（−），雜訊也就一起被帶進 <Tex>{T`\delta[n+1]`}</Tex>——多出來的那一項是 <Tex>{T`-\mu\,x[n]\,v[n]`}</Tex>。這張圖就是下面推導的第 1 步。
        </p>
        <Fig
          chart={CHART_MSD_LOOP}
          caption={T`MSD 的迴圈：每圈乘 $g$，再加上固定的注入量 $\mu^2P_x\sigma_v^2$（紅）。看 $g<1$ 時的不動點（綠）與 $g\ge1$ 時沒有穩態（紅）。`}
          ariaLabel="E delta 平方每步乘上 g，再加上雜訊注入量 mu 平方 P x sigma v 平方；g 小於 1 時收斂到穩態 MSD 等於注入除以 1 減 g，並可換算成 MSE；g 大於等於 1 時沒有有限穩態"
        />
        <p>
          這是同一個迴圈「平方、再取平均」之後的樣子：<Tex>{T`E[\delta[n]^2]`}</Tex> 每繞一圈乘 <Tex>g</Tex>（和無雜訊時一樣），但加法點多了一個固定的注入量{' '}
          <Tex>{T`\mu^2P_x\sigma_v^2`}</Tex>（紅色）。<Tex>{T`g<1`}</Tex> 時每圈漏掉 <Tex>{T`1-g`}</Tex> 的比例，漏掉的和注入的平衡在{' '}
          <Tex>{T`\text{MSD}_\infty=\text{注入}\div(1-g)`}</Tex>（<Tex>{T`\text{MSD}_\infty`}</Tex> 是<strong>穩態的係數均方偏差</strong>）；<Tex>{T`g\ge1`}</Tex> 時只進不出，沒有有限的穩態。
          圖上的注入量就是推導第 4 步的 <Tex>{T`E[\mu^2x_n^2v_n^2]`}</Tex>，綠色兩格就是 F-03.11。
        </p>
        <StepsBox
          title="有雜訊時的 MSD 遞迴與穩態值"
          steps={[
            { tex: T`\delta_{n+1}=\delta_n-\mu(\delta_nx_n+v_n)x_n=(1-\mu x_n^2)\delta_n-\mu x_nv_n`, why: tx`同第 1 節的推導，只是 $e_n$ 多了 $v_n$。` },
            { tex: T`\delta_{n+1}^2=(1-\mu x_n^2)^2\delta_n^2-2\mu(1-\mu x_n^2)x_n\delta_n\,v_n+\mu^2x_n^2v_n^2`, why: tx`平方展開 $(A-B)^2$，$A=(1-\mu x_n^2)\delta_n$、$B=\mu x_nv_n$。` },
            { tex: T`E\big[(1-\mu x_n^2)x_n\delta_n\,v_n\big]=E\big[(1-\mu x_n^2)x_n\delta_n\big]\,E[v_n]=0`, why: tx`$v_n$ 與 $(x_n,\delta_n)$ 獨立且零均值：交叉項消失。` },
            { tex: T`E\big[\mu^2x_n^2v_n^2\big]=\mu^2P_x\sigma_v^2`, why: tx`$x_n$ 與 $v_n$ 獨立。` },
            { tex: T`E[\delta_{n+1}^2]=g\,E[\delta_n^2]+\mu^2P_x\sigma_v^2`, why: '三項合起來（第一項同無雜訊推導）。' },
            { tex: T`\text{MSD}_\infty=g\,\text{MSD}_\infty+\mu^2P_x\sigma_v^2\ \Rightarrow\ \text{MSD}_\infty=\frac{\mu^2P_x\sigma_v^2}{1-g}`, why: tx`$g<1$ 時遞迴收斂到不動點（等比級數和）；令 $E[\delta_{n+1}^2]=E[\delta_n^2]$。` },
            { tex: T`=\frac{\mu^2P_x\sigma_v^2}{2\mu P_x-\mu^2M_4}=\frac{\mu P_x\sigma_v^2}{2P_x-\mu M_4}`, why: tx`代入 $1-g=2\mu P_x-\mu^2M_4$，上下同除以 $\mu$。` },
            { tex: T`E[e_n^2]=E[\delta_n^2x_n^2]+2E[\delta_nx_nv_n]+E[v_n^2]=P_x\,E[\delta_n^2]+\sigma_v^2`, why: tx`$e_n=\delta_nx_n+v_n$ 平方後取期望值；$x_n\perp\!\!\!\perp\delta_n$、$v_n$ 零均值且獨立（勘誤 E42：MSE 與 MSD 的換算）。` },
          ]}
        />
        <FBlock id="F-03.11" />
        <p>
          完整的時間軌跡是等比數列加等比級數：<Tex>{T`E[\delta_n^2]=g^n\delta_0^2+\mu^2P_x\sigma_v^2\,\frac{1-g^n}{1-g}`}</Tex>。固定 <Tex>x</Tex>（<Tex>{T`M_4=P_x^2=x^4`}</Tex>）時退化成{' '}
          <Tex>{T`\text{MSD}_\infty=\frac{\mu\sigma_v^2}{2-\mu x^2}`}</Tex>：<Tex>{T`x=2,\mu=0.1,\sigma_v=1`}</Tex> 得{' '}
          <Tex>{T`${tnum(analyticTrajectory({ mu: 0.1, dist: { kind: 'fixed', value: 2 }, delta0: 0, noiseSigma: 1 }, [0]).msdInf)}`}</Tex>（單元測試以 Monte Carlo 驗證）。
        </p>
        <HC id="HC-03.5">
          {tx`代入你自己的 $P_x$、$M_4$、$\mu$、$\sigma_v$，先手算穩態 $\text{MSD}_\infty$、RMS 與 MSE（只有開根號需要計算機），再對答案。把 $\mu$ 往 $2P_x/M_4$ 推，看分母怎麼趨近 0。`}
        </HC>
        <StationaryRmsPlot />
        <Callout kind="danger" title={tx`同一個 $\mu=2P_x/M_4$ 讓「有雜訊的穩態 MSD」爆掉`}>
          有雜訊時，MS 條件不只是「收斂快慢」：<Tex>{T`\mu\ge2P_x/M_4`}</Tex> 時穩態 MSD 是無限大。規格 §3.1 的提醒成立：<strong>不可把「平均 pole 在單位圓內」直接標成「雜訊下完全穩定」</strong>。
          但下一節會看到：MSD 無限大並不代表你在示波器上看到的那條軌跡會發散。
        </Callout>
        <ModeGate min="research">
          <p className="small">
            Research：小 <Tex>\mu</Tex> 時 <Tex>{T`\text{MSD}_\infty\approx\mu\sigma_v^2/2`}</Tex>（與分布無關）；分母的修正項 <Tex>{T`\mu M_4/(2P_x)`}</Tex> 才看得到分布的形狀。 <ChRef ch="12">第 12 章</ChRef>的線性 block 模型 <Tex>{T`\delta_{k+1}=p\,\delta_k+\mu\eta_k`}</Tex> 給出 <Tex>{T`\operatorname{Var}=\mu^2\sigma_\eta^2/(1-p^2)`}</Tex>，是同一個 <Tex>{T`\text{不動點}=\text{注入量}\div(1-\text{每步因子})`}</Tex> 的結構。
          </p>
        </ModeGate>
      </Section>
    </>
  )
}
