import { useMemo } from 'react'
import type { Data, Layout } from 'plotly.js-cartesian-dist-min'
import { Callout, ClaimTag, ModeGate, Plot, Prereq, Section, SourceTag, SystemMap, Tex, TexBlock } from '@/components'
import { dwStep } from '@/simulation/models/calNoise'
import { Diagram, EX, Hand, md, sig } from '../common'
import { CH12_SYSTEM_FOCUS, CHART_TF_CHAIN, NOISE_CHAIN_CHART } from '../diagrams'

/** 示意用的 η 序列（±σ_η 的固定圖樣，只為了手算；不是模擬結果） */
const ETA_PATTERN = [1, -1, 1, 1, -1, -1, 1, -1]

const V_LAYOUT: Partial<Layout> = { xaxis: { title: { text: 'block $k$' } }, yaxis: { title: { text: String.raw`$V_k$ [$\mathrm{fs}^2$]` } } }

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
      { x: kk, y: curve, name: '$V_k$（解析）', mode: 'lines' },
      { x: [0, 80], y: [EX.sigmaW2, EX.sigmaW2], name: String.raw`$\sigma_w^2$`, mode: 'lines', line: { dash: 'dash' } },
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
      <SystemMap
        focus={CH12_SYSTEM_FOCUS}
        caption={String.raw`系統地圖：藍色是本章追蹤的雜訊路徑，從 comparator 前的雜訊、1-bit comparator、GMAC、平均與學習率、gain accumulator、gain correction 到 reference 輸入端的 DTC，最後分成兩個出口：phase detector 看到的 residual，以及 VCO 輸出。comparator 取的是 phase detector 的輸出 $e[n]$，也就是送進 loop filter 的同一個訊號。教學用概念架構，不是特定晶片的 netlist。`}
      />
      <p>
        {md(
          String.raw`藍色方塊就是雜訊走的路：1-bit comparator 取的是 phase detector 的輸出 $e[n]$（送進 loop filter 的同一個訊號），上面疊著 comparator 前的雜訊，所以 1-bit 判斷會亂跳；GMAC 把它平均、乘上學習率後累加成係數的抖動，這個抖動在 gain correction 乘上 code，送到 reference 輸入端的 DTC，變成補償量的誤差——DTC 的延遲比該有的短了一點或長了一點，reference edge 因此早到或晚到一點。這份時間誤差有兩個地方看得到——phase detector 的 residual，以及經過 PLL 迴路之後的 VCO 輸出。前面幾章只問這條校正迴路「平均」會不會收斂，本章新增的是沿著同一條路，把雜訊的大小（RMS）、頻寬與頻譜一路算到輸出的 jitter 或 spur。`,
        )}
      </p>

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
      <p>
        {md(
          String.raw`四張卡片先用到幾個符號，各用一句話交代（完整的表在本章最後）：$\sigma_w$ 是係數抖動的 RMS；$\mu$ 是 learning rate，每個 block 走多大一步；$N$ 是每個 block 平均的 comparator 樣本數；$p$ 是 pole，每過一個 block 舊的偏差還留下的比例；$f_{3\mathrm{dB}}$ 與 ENBW 是兩種不同定義的頻寬；$x[n]$ 是 DTC／DSM code，也就是 LMS 的 regressor；$\delta w$ 是係數相對於收斂點的偏差；$\delta t$ 是 reference 端的 DTC 因此多補償的時間（reference edge 早到的量）。時間索引有兩個：$n$ 數的是 comparator 的每一個 sample（取樣率 $f_s$），$k$ 數的是 GMAC 的每一個 block（每 $N$ 個 sample 一個，取樣率 $f_u=f_s/N$）。`,
        )}
      </p>

      <Section kind="intuition" title="直覺：恆溫器讀到的溫度一直在跳" level={3}>
        <p>
          想像一台恆溫器：溫度計每秒讀一次，但讀數帶有很大的隨機誤差。控制器每次只根據「讀數比設定高還是低」去微調暖氣。就算房間真的已經在 25°C，讀數還是一半高一半低，所以暖氣的旋鈕會<strong>永遠在設定點附近小幅亂動</strong>。旋鈕調得越積極（learning rate{' '}
          <Tex>{String.raw`\mu`}</Tex> 越大），亂動越大；每次先平均越多次讀數（<Tex>N</Tex> 越大），亂動越小。
        </p>
        <p>
          LMS 校正迴路就是這台恆溫器：<Tex>{'w'}</Tex> 是旋鈕、GMAC 是「平均後的讀數」、comparator noise 是溫度計的誤差。本章把「旋鈕亂動」精確算出來，然後追蹤它怎麼一路影響到 PLL 輸出。
        </p>
        <Diagram
          chart={NOISE_CHAIN_CHART}
          caption={String.raw`雜訊傳遞鏈（本章的地圖）：藍色的圓圈是乘法，不是加法——係數雜訊要先乘上 code，才變成 timing error $\delta t=x\,\delta w$。由 PD 拉回 comparator 的虛線是校正迴路的輸入：comparator 取 PD 的輸出 $e[n]$。`}
          ariaLabel="comparator noise 經 GMAC、LMS、code 相乘、PLL 傳遞到輸出的方塊圖；comparator 的輸入取自 PD 的輸出"
        >
          <p>
            {md(
              String.raw`先由上往下沿著主線看：雜訊 $v[n]$ 進 comparator，1-bit 的 $q$ 被 GMAC 平均成 $G_k$，LMS 用它更新 $w$，於是係數帶著雜訊 $\delta w_k$。再看藍色的乘號：$\delta w$ 不是直接加到輸出，而是先乘上 code $x[n]$ 才變成 reference 端的 DTC 多補償的時間 $\delta t$。最後看乘號之後的分岔：同一個 $\delta t$ 往 PD 走是 high-pass，往 PLL output 走是 low-pass。圖上的方塊對應後面的小節：主線上乘號之前的五格是 §12.1–12.5，乘號是 §12.6，分岔之後是 §12.7–12.8。`,
            )}
          </p>
          <p>
            {md(
              String.raw`圖上由 code 拉到 GMAC 的那條虛線提醒一件事：同一個 code $x[n]$ 用在兩個地方——GMAC 拿它和 $q$ 做相關（$G_k=\tfrac1N\sum q\,x$），DTC 拿它乘上係數。所以 $\delta w$ 其實是由同一個 code 算出來的；§12.6 把兩者當成獨立是一個近似，那裡會再提醒一次。`,
            )}
          </p>
          <p>
            {md(
              String.raw`圖上由 PD residual 拉回 comparator 的那條虛線是校正迴路的輸入：comparator 取的是 PD 的輸出 $e[n]$，也就是送進 loop filter 的同一個訊號。$\delta t$ 留在 PD 上的 residual 和雜訊 $v[n]$ 一起進 comparator，所以係數一偏離就會被拉回來——這條回授就是 §12.1 的恢復力。`,
            )}
          </p>
          <p>
            {md(
              String.raw`圖上最後三格先出現了幾個 §12.7 才會推導的符號，這裡各用一句話交代：$L$ 是 PLL 的開迴路增益；$H_{\mathrm{PD}}=1/(1+L)$ 與 $T=L/(1+L)$ 是 $\delta t$ 到 PD、到輸出的轉移函數（一個 high-pass、一個 low-pass）；$f_{\mathrm{out}}$ 是 PLL 的輸出頻率，乘上 $2\pi f_{\mathrm{out}}$ 是把時間換成相位；$\phi_{\mathrm{out}}$ 是 $\delta t$ 在輸出造成的相位（rad）。最後一格式子前面的負號，是因為 $\delta t$ 是多補償的時間：reference edge 早到 $\delta t$，PLL 跟著把輸出的 edge 也拉早（相位以晚到為正）。`,
            )}
          </p>
        </Diagram>
        <p>
          把同一條鏈的每個方塊換成後面會推導出來的數學模型，並標出每個訊號「多久更新一次」，就是本章的路線圖：
        </p>
        <Diagram
          chart={CHART_TF_CHAIN}
          caption={String.raw`同一條雜訊鏈的數學模型：三個框是三段不同的取樣率（sample 索引 $n$、block 索引 $k$、再回到 $n$），線上寫的是那一段的雜訊大小。先看框的標題，再看框與框之間的線。`}
        >
          <p>
            {md(
              String.raw`先看三個框的標題：(1)、(3) 是每個 sample 都在動的量（索引 $n$，取樣率 $f_s$），(2) 是每個 block 才有一個值的量（索引 $k$，取樣率 $f_u=f_s/N$）。再看框與框之間的線，線上標的是那一點的訊號與它的大小：進入 (2) 之前先平均 $N$ 筆，平均之後剩下的起伏記作 $\eta_k$（GMAC 雜訊），它的變異數 $\sigma_\eta^2$ 降成約 $1/N$；離開 (2) 時每個 $\delta w_k$ 要保持 $N$ 個 sample（zero-order hold，ZOH）才能和 code 相乘。最後沿著 (3) 往下：乘上 code、經過 PLL 的 low-pass 才到輸出。這張圖只畫雜訊往前走的路：comparator 的輸入仍然是 PD 的輸出 $e[n]$（上一張圖的虛線），係數偏差經 PD 回到 comparator 的那一圈沒有另外畫出來，它已經收在 (2) 的「LMS 閉迴路」$H(z)$ 裡——pole $p$ 就是那條回授造成的。`,
            )}
          </p>
          <p>
            {md(
              String.raw`和公式的對照：圖上的 $H(z)=\mu/(z-p)$ 是 §12.2 的 F-12.3；線上的 $\sigma_\eta^2\approx1/N$ 是 F-12.6、$\sigma_w$ 是 §12.4 的 F-12.5；ZOH 是 F-12.14；乘號是 §12.6 的 F-12.11；$T(f)$ 是 §12.7 的 F-12.15，最後一格就是 F-12.16。圖上兩個藍色方塊——閉迴路的 $H(z)$ 與乘號——是整章最重要的兩步。`,
            )}
          </p>
        </Diagram>
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
          {md(
            String.raw`這幾個常數各是什麼：$f_s$ 是 comparator 的取樣率；$K$ 是「GMAC 平均輸出對係數偏差的斜率」，等於 1-bit comparator 的小訊號統計增益 $K_q=\sqrt{2/\pi}/\sigma_v$（第 5 章）乘上有效 code 相關 $C$——code 和它在 comparator 前造成的訊號有多像，理想路徑、unit-RMS 的 $\pm1$ code 時 $C=1$；$g=\mu K$ 是無因次的迴路增益；$p=1-g$ 是 pole，每個 block 舊偏差留下的比例；$\sigma_\eta$ 是每個 block 的 GMAC 平均值自己的隨機起伏（RMS），$N$ 筆 $\pm1$ 平均之後約為 $1/\sqrt N$。`,
          )}
        </p>
        <p>
          接著假裝前五個 block 的 GMAC 雜訊剛好是 <Tex>{String.raw`\eta_k=\pm\sigma_\eta`}</Tex>（只是為了手算的示意圖樣 <SourceTag kind="illustrative" />，真正的隨機模擬在下方 LMS Noise Lab），從{' '}
          <Tex>{String.raw`\delta w_0=0`}</Tex>（已經在最佳點）出發，套用下一節會推導的遞迴 <Tex>{String.raw`\delta w_{k+1}=p\,\delta w_k+\mu\eta_k`}</Tex>。其中{' '}
          <Tex>{String.raw`\delta w_k=w_k-w^*`}</Tex> 是第 <Tex>{'k'}</Tex> 個 block 的係數相對於固定點 <Tex>{'w^*'}</Tex> 的偏差（<Tex>{'w^*'}</Tex> 是 LMS 平均起來不再移動的那個係數值）：
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
            <strong>變異數</strong>量測「離平均多遠」：<Tex>{String.raw`\operatorname{Var}(X)=E[(X-E[X])^2]=E[X^2]-E[X]^2`}</Tex>；標準差（RMS 抖動）是它的平方根。若 <Tex>{'X_1,\\dots,X_N'}</Tex> 彼此獨立、變異數都是 <Tex>{String.raw`\sigma^2`}</Tex>，則平均值的變異數是 <Tex>{String.raw`\sigma^2/N`}</Tex>——這就是「平均 <Tex>{'N'}</Tex> 次，雜訊 RMS 降 <Tex>{String.raw`\sqrt N`}</Tex> 倍」。下面的 <Tex>{'V_k'}</Tex> 就是第 <Tex>{'k'}</Tex> 個 block 的{' '}
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
            <Tex>{String.raw`m=E[qx]=\operatorname{erf}\!\big(C(a-w)/(\sqrt2\sigma_v)\big)`}</Tex>。在 <Tex>{'w=w^*'}</Tex> 附近 <Tex>{'m\\approx0'}</Tex>，但係數本身在抖：<Tex>{String.raw`E[m^2]\approx K^2\sigma_w^2=${sig(EX.K ** 2 * EX.sigmaW2, 3)}`}</Tex>，所以 <Tex>{String.raw`1/N`}</Tex> 的相對誤差只有{' '}
            <Tex>{`${sig(EX.K ** 2 * EX.sigmaW2, 2)}`}</Tex> 量級（勘誤 E30 的條件）。
          </Callout>
        </ModeGate>
      </Section>
    </>
  )
}
