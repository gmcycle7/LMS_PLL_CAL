import { useMemo } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import { Callout, ClaimTag, Mermaid, ModeGate, Plot, Prereq, Section, SourceTag, Tex, TexBlock } from '@/components'
import { dwStep } from '@/simulation/models/calNoise'
import { EX, Hand, md, sig } from '../common'

/** 示意用的 η 序列（±σ_η 的固定圖樣，只為了手算；不是模擬結果） */
const ETA_PATTERN = [1, -1, 1, 1, -1, -1, 1, -1]

const V_LAYOUT: Partial<Layout> = { xaxis: { title: { text: 'block k' } }, yaxis: { title: { text: 'V_k [fs²]' } } }

/** 雜訊傳遞鏈（Mermaid flowchart；diagram.test.tsx 以真正的 mermaid parser 驗證語法） */
export const NOISE_CHAIN_CHART = `flowchart LR
  V["v[n]：comparator 前雜訊<br/>σ_v = 100 fs"] --> Q["1-bit comparator<br/>q = sign(e)"]
  Q --> G["GMAC 平均<br/>G_k = (1/N)·Σ q·x<br/>雜訊 η_k"]
  G --> U["LMS 更新<br/>w ← w + μ·G"]
  U --> W["係數雜訊 δw_k<br/>（gain-equivalent）"]
  X["DSM code x[n]"] --> M(("×"))
  W --> M
  M --> DT["δt[n] = x·δw<br/>DTC 多出的延遲"]
  DT --> PD["H_PD = 1/(1+L)<br/>PD residual：high-pass"]
  DT --> T["T = L/(1+L)<br/>PLL output：low-pass"]
  T --> OUT["φ_out = −2π f_out·T·δt<br/>jitter skirt 或 spur"]`

export function S1Intro() {
  // 手算表：δw_{k+1} = p δw_k + μ η_k，η_k = ±σ_η（示意圖樣）
  const hand = useMemo(() => {
    const sEta = Math.sqrt(EX.sigmaEta2)
    const rows: { k: number; eta: number; dw: number; next: number }[] = []
    let dw = 0
    for (let k = 0; k < 5; k++) {
      const eta = ETA_PATTERN[k] * sEta
      const next = dwStep(dw, EX.p, EX.input.mu, eta) // F-12.2 的一步（與「帶入手算」HC-12.1 同一個函式）
      rows.push({ k, eta, dw, next })
      dw = next
    }
    return { sEta, rows }
  }, [])
  // 變異數的累積：V_{k+1} = p²V_k + μ²σ_η²
  const vtab = useMemo(() => {
    const q = EX.input.mu ** 2 * EX.sigmaEta2
    const ks = [1, 2, 3, 5, 10, 20, 50]
    const out: { k: number; V: number }[] = []
    let V = 0
    for (let k = 1; k <= 50; k++) {
      V = EX.p * EX.p * V + q
      if (ks.includes(k)) out.push({ k, V })
    }
    const kk = Array.from({ length: 81 }, (_, i) => i)
    const curve = kk.map((k) => EX.sigmaW2 * (1 - EX.p ** (2 * k)))
    // Plot 的 data 必須是穩定的參考（否則每次 render 都觸發 Plotly.react）
    const plot: Data[] = [
      { x: kk, y: curve, name: 'V_k（解析）', mode: 'lines' },
      { x: [0, 80], y: [EX.sigmaW2, EX.sigmaW2], name: 'σ_w²', mode: 'lines', line: { dash: 'dash' } },
    ]
    return { q, out, plot }
  }, [])

  return (
    <>
      <div className="ch12-question">
        <strong>這一章要回答的問題：</strong>LMS 已經「收斂」了，GMAC 平均是 0。可是 comparator 前面還有{' '}
        <Tex>{String.raw`\sigma_v=100\ \mathrm{fs}`}</Tex> 的雜訊，每個 block 的 1-bit 判斷都還是在亂跳。那麼校正係數{' '}
        <Tex>{'w'}</Tex> 本身會抖多少？這個抖動乘上 DSM code、穿過 PLL 之後，會在輸出變成多少 jitter，還是一根 spur？
      </div>

      <div className="ch12-goals">
        <div className="ch12-goal">
          <div className="ch12-goal-title">1. 係數會抖多少</div>
          <Tex>{String.raw`\sigma_w=\mu/\sqrt{N(1-p^2)}`}</Tex>，本例 <Tex>{`${sig(EX.sigmaW, 3)}\\ \\mathrm{fs}`}</Tex>
        </div>
        <div className="ch12-goal">
          <div className="ch12-goal-title">2. 抖得多快（頻寬）</div>
          exact <Tex>{`f_{3\\mathrm{dB}}=${sig(EX.f3dbExact / 1e3, 4)}`}</Tex> kHz；ENBW <Tex>{`${sig(EX.enbw / 1e3, 4)}`}</Tex> kHz（兩者不同！）
        </div>
        <div className="ch12-goal">
          <div className="ch12-goal-title">3. 怎麼變成 timing error</div>
          <Tex>{String.raw`\delta t[n]=x[n]\,\delta w[n]`}</Tex>：乘法會「搬移」頻譜
        </div>
        <div className="ch12-goal">
          <div className="ch12-goal-title">4. PLL 輸出看到什麼</div>
          PD 看 high-pass、output 看 low-pass；隨機 ⇒ skirt，週期 ⇒ spur
        </div>
      </div>

      <Section kind="intuition" title="直覺：恆溫器讀到的溫度一直在跳" level={3}>
        <p>
          想像一台恆溫器：溫度計每秒讀一次，但讀數帶有很大的隨機誤差。控制器每次只根據「讀數比設定高還是低」去微調暖氣。就算房間真的已經在 25°C，
          讀數還是一半高一半低，所以暖氣的旋鈕會<strong>永遠在設定點附近小幅亂動</strong>。旋鈕調得越積極（learning rate{' '}
          <Tex>{String.raw`\mu`}</Tex> 越大），亂動越大；每次先平均越多次讀數（<Tex>N</Tex> 越大），亂動越小。
        </p>
        <p>
          LMS 校正迴路就是這台恆溫器：<Tex>{'w'}</Tex> 是旋鈕、GMAC 是「平均後的讀數」、comparator noise 是溫度計的誤差。
          本章把「旋鈕亂動」精確算出來，然後追蹤它怎麼一路影響到 PLL 輸出。
        </p>
        <Mermaid chart={NOISE_CHAIN_CHART} caption="雜訊傳遞鏈（本章的地圖）：注意 × 是乘法，不是加法。" ariaLabel="comparator noise 經 GMAC、LMS、code 相乘、PLL 傳遞到輸出的方塊圖" />
      </Section>

      <Section kind="example" title="先算一次：用數字走五步" level={3}>
        <p>
          規格 §12.1 的例子：<Tex>{String.raw`f_s=4\ \mathrm{GHz},\ N=4096,\ \mu=10\ \mathrm{fs},\ \sigma_v=100\ \mathrm{fs},\ C=1`}</Tex>。先把需要的常數算好：
        </p>
        <TexBlock>
          {String.raw`\begin{aligned}
K&=K_qC=\frac{\sqrt{2/\pi}}{100\ \mathrm{fs}}=${sig(EX.K, 6)}\ \mathrm{fs}^{-1}\\
g&=\mu K=10\times${sig(EX.K, 6)}=${sig(EX.g, 6)}\\
p&=1-g=${sig(EX.p, 6)}\\
\sigma_\eta&=1/\sqrt N=1/64=${sig(hand.sEta, 6)}
\end{aligned}`}
        </TexBlock>
        <p>
          接著假裝前五個 block 的 GMAC 雜訊剛好是 <Tex>{String.raw`\eta_k=\pm\sigma_\eta`}</Tex>（只是為了手算的示意圖樣 <SourceTag kind="illustrative" />，真正的隨機模擬在下方 LMS Noise Lab），從{' '}
          <Tex>{String.raw`\delta w_0=0`}</Tex>（已經在最佳點）出發，套用下一節會推導的遞迴 <Tex>{String.raw`\delta w_{k+1}=p\,\delta w_k+\mu\eta_k`}</Tex>：
        </p>
        <div className="table-wrap">
          <table className="ch12-table">
            <thead>
              <tr>
                <th>k</th>
                <th className="num">
                  <Tex>{String.raw`\eta_k`}</Tex>
                </th>
                <th className="num">
                  <Tex>{String.raw`p\,\delta w_k`}</Tex> [fs]
                </th>
                <th className="num">
                  <Tex>{String.raw`\mu\eta_k`}</Tex> [fs]
                </th>
                <th className="num">
                  <Tex>{String.raw`\delta w_{k+1}`}</Tex> [fs]
                </th>
              </tr>
            </thead>
            <tbody>
              {hand.rows.map((r) => (
                <tr key={r.k}>
                  <td>{r.k}</td>
                  <td className="num">
                    <Tex>{r.eta > 0 ? '+1/64' : '-1/64'}</Tex>
                  </td>
                  <td className="num">{(EX.p * r.dw).toFixed(5)}</td>
                  <td className="num">{(EX.input.mu * r.eta).toFixed(5)}</td>
                  <td className="num">{r.next.toFixed(5)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Hand id="HC-12.1">
          {md(
            String.raw`把 $\sigma_v$、$\mu$、$N$ 換成你自己電路的數字，先用紙筆和計算機算出 $p$ 與前三步的 $\delta w$，再按「看帶入過程」對答案。用範例數字時，答案就是上表的前三列。`,
          )}
        </Hand>
        <Prereq title={String.raw`期望值 $E[\cdot]$ 與變異數 $\operatorname{Var}(\cdot)$`}>
          <p>
            <strong>期望值</strong>是「做非常多次之後的平均」。若隨機量 <Tex>{'X'}</Tex> 取值 <Tex>{'x_i'}</Tex> 的機率是 <Tex>{'P_i'}</Tex>，
            <Tex>{String.raw`E[X]=\sum_i x_iP_i`}</Tex>。它是線性的：<Tex>{String.raw`E[aX+bY]=aE[X]+bE[Y]`}</Tex>。
          </p>
          <p>
            <strong>變異數</strong>量測「離平均多遠」：<Tex>{String.raw`\operatorname{Var}(X)=E[(X-E[X])^2]=E[X^2]-E[X]^2`}</Tex>；標準差（RMS 抖動）是它的平方根。
            若 <Tex>{'X_1,\\dots,X_N'}</Tex> 彼此獨立、變異數都是 <Tex>{String.raw`\sigma^2`}</Tex>，則平均值的變異數是 <Tex>{String.raw`\sigma^2/N`}</Tex>——
            這就是「平均 <Tex>{'N'}</Tex> 次，雜訊 RMS 降 <Tex>{String.raw`\sqrt N`}</Tex> 倍」。下面的 <Tex>{'V_k'}</Tex> 就是第 <Tex>{'k'}</Tex> 個 block 的{' '}
            <Tex>{String.raw`E[\delta w_k^2]`}</Tex>（平均為 0，所以就是變異數）。
          </p>
        </Prereq>
        <p>
          你會發現：每一步都「記得」上一步的 <Tex>{String.raw`${sig(EX.p, 4)}`}</Tex> 倍，再加上一點新的雜訊。係數不會跑掉（因為{' '}
          <Tex>{'p<1'}</Tex> 會把它拉回來），但也停不下來。它抖多少？把<strong>變異數</strong>也一步步算：
          <Tex>{String.raw`V_{k+1}=p^2V_k+\mu^2\sigma_\eta^2`}</Tex>，其中 <Tex>{`\\mu^2\\sigma_\\eta^2=100/4096=${sig(vtab.q, 5)}\\ \\mathrm{fs}^2`}</Tex>：
        </p>
        <div className="table-wrap">
          <table className="ch12-table">
            <thead>
              <tr>
                <th>k</th>
                {vtab.out.map((r) => (
                  <th key={r.k} className="num">
                    {r.k}
                  </th>
                ))}
                <th className="num">
                  <Tex>{String.raw`\infty`}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <Tex>{String.raw`V_k\ [\mathrm{fs}^2]`}</Tex>
                </td>
                {vtab.out.map((r) => (
                  <td key={r.k} className="num">
                    {r.V.toFixed(4)}
                  </td>
                ))}
                <td className="num">{EX.sigmaW2.toFixed(4)}</td>
              </tr>
              <tr>
                <td>
                  <Tex>{String.raw`\sqrt{V_k}`}</Tex> [fs]
                </td>
                {vtab.out.map((r) => (
                  <td key={r.k} className="num">
                    {Math.sqrt(r.V).toFixed(4)}
                  </td>
                ))}
                <td className="num">{EX.sigmaW.toFixed(4)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <Plot
          title="變異數一步步累積到穩態"
          csvName="ch12-variance-buildup"
          height={240}
          data={vtab.plot}
          layout={V_LAYOUT}
          caption={md(
            `由 $V_{k+1}=p^2V_k+\\mu^2\\sigma_\\eta^2$ 直接計算（$p$ = ${EX.p.toFixed(5)}，$V_0=0$），封閉式是 $V_k=\\sigma_w^2(1-p^{2k})$；$V_k$ 以 $p^{2k}$ 的速度逼近穩態（虛線 $\\sigma_w^2$），時間常數 $1/(-2\\ln p)\\approx${(-1 / (2 * Math.log(EX.p))).toFixed(1)}$ blocks。`,
          )}
        />
        <Callout kind="ok" title="結論">
          係數穩態 RMS <Tex>{`\\sigma_w=${sig(EX.sigmaW, 4)}\\ \\mathrm{fs}`}</Tex> <ClaimTag kind="exact" /> <SourceTag kind="illustrative" />。這是
          <strong>gain-equivalent</strong> noise：它還沒乘上 code、還沒經過 PLL，<strong>不能直接宣稱為 output jitter</strong>。
        </Callout>
        <ModeGate min="research">
          <Callout kind="info" title={md(String.raw`Research：$\sigma_\eta^2$ 的精確值`)}>
            對 <Tex>{'x=\\pm1'}</Tex>，<Tex>{String.raw`(qx)^2=1`}</Tex>，所以 <Tex>{String.raw`\operatorname{Var}(qx)=1-m^2`}</Tex>，
            <Tex>{String.raw`m=E[qx]=\operatorname{erf}\!\big(C(a-w)/(\sqrt2\sigma_v)\big)`}</Tex>。在 <Tex>{'w=w^*'}</Tex> 附近 <Tex>{'m\\approx0'}</Tex>，
            但係數本身在抖：<Tex>{String.raw`E[m^2]\approx K^2\sigma_w^2=${sig(EX.K ** 2 * EX.sigmaW2, 3)}`}</Tex>，所以 <Tex>{String.raw`1/N`}</Tex> 的相對誤差只有{' '}
            <Tex>{`${sig(EX.K ** 2 * EX.sigmaW2, 2)}`}</Tex> 量級（勘誤 E30 的條件）。
          </Callout>
        </ModeGate>
      </Section>
    </>
  )
}
