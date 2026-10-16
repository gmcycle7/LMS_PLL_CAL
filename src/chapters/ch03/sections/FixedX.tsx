import { useMemo } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import { Callout, ClaimTag, mathText, ModeGate, Plot, Prereq, Section, SourceTag, Tex, TexBlock, useThemeTokens, ChRef } from '@/components'
import { fixedXMuMax, fixedXPole, runScalarLms } from '@/simulation/models/lms'
import { Erratum, FBlock, Fig, HC, num, StepsBox, T, tnum, tx, Verdict } from '../common'
import { CHART_ERROR_RECURSION, CHART_LMS_LOOP, CHART_POLE_REGIME, CHART_TAU_FLOW, figRef } from '../diagrams'
import { FixedXExplorer } from '../experiments/FixedXExplorer'
import { poleLabelTex } from '../poleLabel'

/** 規格 §3 的五個 μ（x = 2）。所有數字都由 runScalarLms 實際模擬得到（δ = a − w）。 */
export const FIVE_MUS = [0.1, 0.25, 0.4, 0.5, 0.6] as const
const A = 3
const W0 = 1
const X = 2

function simulate(mu: number, steps: number) {
  return runScalarLms({ variant: 'conventional', a: A, w0: W0, mu, steps, x: { kind: 'fixed', value: X } })
}

function HandCalcTable() {
  const r = useMemo(() => simulate(0.1, 4), [])
  return (
    <div className="table-wrap">
      <table className="ch03-num">
        <thead>
          <tr>
            <th>
              <Tex>n</Tex>
            </th>
            <th>
              <Tex>{T`w_n`}</Tex>
            </th>
            <th>
              <Tex>{T`e_n=y-w_nx`}</Tex>
            </th>
            <th>
              <Tex>{T`\delta_n=a-w_n`}</Tex>
            </th>
            <th>
              <Tex>{T`\delta_n/\delta_{n-1}`}</Tex>
            </th>
          </tr>
        </thead>
        <tbody>
          {Array.from(r.w, (w, n) => (
            <tr key={n}>
              <td>{n}</td>
              <td>{num(w, 6)}</td>
              <td>{n < r.e.length ? num(r.e[n], 6) : '—'}</td>
              <td>{num(r.delta[n], 6)}</td>
              <td>{n === 0 ? '—' : num(r.delta[n] / r.delta[n - 1], 6)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FiveMuTable() {
  const rows = useMemo(
    () =>
      FIVE_MUS.map((mu) => {
        const r = simulate(mu, 3)
        const p = fixedXPole(mu, X)
        const tau = Math.abs(p) > 0 && Math.abs(p) < 1 ? -1 / Math.log(Math.abs(p)) : NaN
        return { mu, p, label: poleLabelTex(p), d: Array.from(r.delta), tau }
      }),
    [],
  )
  return (
    <div className="table-wrap">
      <table className="ch03-num">
        <thead>
          <tr>
            <th>
              <Tex>\mu</Tex>
            </th>
            <th>
              <Tex>{T`p=1-4\mu`}</Tex>
            </th>
            <th>
              <Tex>{T`\delta_1`}</Tex>
            </th>
            <th>
              <Tex>{T`\delta_2`}</Tex>
            </th>
            <th>
              <Tex>{T`\delta_3`}</Tex>
            </th>
            <th>
              <Tex>{T`\tau=-1/\ln|p|`}</Tex>
            </th>
            <th style={{ textAlign: 'left' }}>行為</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.mu}>
              <td>{r.mu}</td>
              <td>{num(r.p, 6)}</td>
              <td>{num(r.d[1], 6)}</td>
              <td>{num(r.d[2], 6)}</td>
              <td>{num(r.d[3], 6)}</td>
              <td>{Number.isNaN(r.tau) ? (r.p === 0 ? '0（一步）' : '—') : num(r.tau, 4)}</td>
              <td style={{ textAlign: 'left' }}>
                <Verdict value={Math.abs(r.p)} /> {mathText(r.label)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FiveMuPlots() {
  const tokens = useThemeTokens()
  const steps = 12
  const { linData, logData } = useMemo(() => {
    const sims = FIVE_MUS.map((mu) => ({ mu, r: simulate(mu, steps) }))
    const n = Array.from({ length: steps + 1 }, (_, i) => i)
    const lin: Data[] = sims
      .filter((s) => s.mu <= 0.5)
      .map((s) => ({
        x: n,
        y: Array.from(s.r.delta),
        name: T`$\mu = ${s.mu}$（$p = ${tnum(fixedXPole(s.mu, X), 3)}$）`,
        mode: 'lines+markers',
        line: { color: tokens.series[FIVE_MUS.indexOf(s.mu)], width: 2 },
        marker: { size: 6 },
      }))
    const lg: Data[] = sims.map((s) => ({
      x: n,
      y: Array.from(s.r.delta, (d) => Math.abs(d)),
      name: T`$\mu = ${s.mu}$`,
      mode: 'lines+markers',
      line: { color: tokens.series[FIVE_MUS.indexOf(s.mu)], width: 2 },
      marker: { size: 6 },
    }))
    return { linData: lin, logData: lg }
  }, [tokens])
  const layoutLin = useMemo<Partial<Layout>>(
    () => ({ xaxis: { title: { text: T`$n$（sample）` } }, yaxis: { title: { text: T`$\delta_n = a - w_n$` }, zeroline: true } }),
    [],
  )
  const layoutLog = useMemo<Partial<Layout>>(() => ({ xaxis: { title: { text: T`$n$（sample）` } }, yaxis: { title: { text: T`$|\delta_n|$（log）` } } }), [])
  return (
    <div className="ch03-plots">
      <Plot
        title={T`$\delta_n$：四種收斂行為（$\mu\le0.5$）`}
        ariaLabel="參數誤差的四種收斂行為"
        data={linData}
        layout={layoutLin}
        height={300}
        csvName="ch03-fixed-x-delta"
        caption={tx`由 runScalarLms 實際迭代 $a=3,\ w_0=1,\ x=2$（$\delta_0=+2$）。$\mu=0.5$ 時 $p=-1$：$|\delta_n|$ 不變、正負交替。`}
      />
      <Plot
        title={T`$|\delta_n|$（log 軸）：斜率就是 $\log_{10}|p|$`}
        ariaLabel="參數誤差的大小（對數軸）"
        data={logData}
        layout={layoutLog}
        yLog
        height={300}
        csvName="ch03-fixed-x-absdelta"
        caption={tx`$\mu=0.25$ 在 $n\ge1$ 時 $\delta_n=0$（log 軸無法畫 0，該點被略去）；$\mu=0.6$ 時 $|p|=1.4>1$，直線往上（發散）。`}
      />
    </div>
  )
}

function UnitCirclePlot() {
  const tokens = useThemeTokens()
  const data = useMemo<Data[]>(() => {
    const th = Array.from({ length: 361 }, (_, i) => (i * Math.PI) / 180)
    const circle: Data = {
      x: th.map(Math.cos),
      y: th.map(Math.sin),
      mode: 'lines',
      name: T`單位圓 $|z| = 1$`,
      line: { color: tokens.textMuted, width: 1.5, dash: 'dot' },
      hoverinfo: 'skip',
    }
    const poles: Data[] = FIVE_MUS.map((mu, i) => ({
      x: [fixedXPole(mu, X)],
      y: [0],
      mode: 'text+markers',
      name: T`$\mu = ${mu}$：$p = ${tnum(fixedXPole(mu, X), 3)}$`,
      text: [T`$\mu=${mu}$`],
      textposition: i % 2 ? 'bottom center' : 'top center',
      marker: { size: 12, symbol: 'x', color: tokens.series[i], line: { width: 2, color: tokens.series[i] } },
      textfont: { color: tokens.text, size: 11 },
    }))
    return [circle, ...poles]
  }, [tokens])
  const layout = useMemo<Partial<Layout>>(
    () => ({
      xaxis: { title: { text: T`$\mathrm{Re}\,z$` }, range: [-1.6, 1.3], zeroline: true },
      yaxis: { title: { text: T`$\mathrm{Im}\,z$` }, range: [-1.2, 1.2], scaleanchor: 'x', zeroline: true },
    }),
    [],
  )
  return (
    <Plot
      title={T`$z$ 平面：誤差遞迴的 pole（$x=2$）`}
      ariaLabel="z 平面：誤差遞迴的 pole"
      data={data}
      layout={layout}
      height={330}
      csvName="ch03-unit-circle"
      caption={tx`$\mu$ 從 0 增加時，pole $p=1-4\mu$ 沿實軸由 1 往左移：$\mu=0.25$ 到原點（一步到位）、$\mu=0.5$ 碰到 $-1$（邊界）、$\mu>0.5$ 跑出單位圓（發散）。`}
    />
  )
}

function PoleVsMuPlot() {
  const tokens = useThemeTokens()
  const data = useMemo<Data[]>(() => {
    const mu = Array.from({ length: 321 }, (_, i) => -0.1 + (0.8 * i) / 320)
    return [
      { x: mu, y: mu.map((m) => Math.abs(fixedXPole(m, X))), name: T`$|p| = |1 - \mu x^2|$`, mode: 'lines', line: { color: tokens.series[0], width: 2 } },
      { x: [-0.1, 0.7], y: [1, 1], name: T`穩定門檻 $|p| = 1$`, mode: 'lines', line: { color: tokens.textMuted, width: 1.5, dash: 'dash' } },
      {
        x: FIVE_MUS.slice(),
        y: FIVE_MUS.map((m) => Math.abs(fixedXPole(m, X))),
        name: '五個例子',
        mode: 'markers',
        marker: { size: 9, color: tokens.series[1] },
      },
    ]
  }, [tokens])
  const layout = useMemo<Partial<Layout>>(
    () => ({
      xaxis: { title: { text: T`$\mu$` } },
      yaxis: { title: { text: T`$|p|$` }, range: [0, 1.8] },
      shapes: [
        { type: 'rect', xref: 'x', yref: 'paper', x0: 0, x1: 0.5, y0: 0, y1: 1, fillcolor: tokens.series[2], opacity: 0.08, line: { width: 0 } },
      ],
      annotations: [
        { x: 0.125, y: 1.65, text: '單調', showarrow: false, font: { color: tokens.textMuted } },
        { x: 0.375, y: 1.65, text: '震盪', showarrow: false, font: { color: tokens.textMuted } },
        { x: 0.6, y: 1.65, text: '發散', showarrow: false, font: { color: tokens.textMuted } },
      ],
    }),
    [tokens],
  )
  return (
    <Plot
      title={T`$|p|$ 對 $\mu$（$x=2$）：V 字形，綠色區 $0<\mu<0.5$ 才收斂`}
      ariaLabel="pole 的大小對學習率：V 字形"
      data={data}
      layout={layout}
      height={300}
      csvName="ch03-pole-vs-mu"
      caption={tx`$\mu<0$（更新方向反了）時 $p>1$，也發散——這就是第 6 章「極性反轉」的最簡單版本。`}
    />
  )
}

/** 研究：IEEE double 下 deadbeat 是否「恰好」一步歸零（數字全部由程式即時計算） */
function FloatDeadbeatNote() {
  const v = useMemo(() => {
    const exact = fixedXPole(0.25, 2)
    const x = 0.3
    const mu = 1 / (x * x)
    const p = fixedXPole(mu, x)
    const r = runScalarLms({ variant: 'conventional', a: A, w0: W0, mu, steps: 3, x: { kind: 'fixed', value: x } })
    return { exact, mu, p, d1: r.delta[1], d2: r.delta[2] }
  }, [])
  return (
    <Callout kind="info" title="Research：浮點下的 deadbeat">
      <p>
        <Tex>{T`\mu=0.25,\ x=2`}</Tex> 時 <Tex>{T`1-\mu x^2=${tnum(v.exact)}`}</Tex>：<Tex>{T`0.25`}</Tex> 與 <Tex>{T`4`}</Tex> 都是 2 的冪次，IEEE double 可以精確表示，模擬的{' '}
        <Tex>{T`\delta_1`}</Tex> 是真正的 0。換成 <Tex>{T`x=0.3`}</Tex>、<Tex>{T`\mu=1/x^2\approx${tnum(v.mu, 8)}`}</Tex>：<Tex>{T`0.3`}</Tex> 在二進位是無窮循環小數，
        <code>fixedXPole</code> 算出 <Tex>{T`1-\mu x^2=${tnum(v.p, 3)}`}</Tex>（不是 0）；<code>runScalarLms</code> 的實際迭代得到{' '}
        <Tex>{T`\delta_1=${tnum(v.d1, 3)},\ \delta_2=${tnum(v.d2, 3)}`}</Tex>——數學上一步到位，數值上是「捨入誤差等級的殘差，下一步才被吸收」。
        定點硬體（<ChRef ch="13">第 13 章</ChRef>）還要再加上係數量化，deadbeat 只是理想化的極限。
      </p>
    </Callout>
  )
}

export function FixedXSection() {
  return (
    <>
      <h2 id="fixed-x">1｜固定輸入：誤差是一個等比數列</h2>
      <Section kind="intuition" title="這一節要回答的問題">
        <p>
          黑盒子 <Tex>{T`y=ax`}</Tex>，你不知道 <Tex>a</Tex>。每次只看到同一個輸入 <Tex>{T`x=2`}</Tex> 與輸出 <Tex>{T`y=6`}</Tex>（真實{' '}
          <Tex>{T`a=3`}</Tex>），從 <Tex>{T`w_0=1`}</Tex> 開始用 LMS 修正。問題是：<strong>學習率 <Tex>\mu</Tex> 要多小才保證會收斂？太大會怎樣？</strong>
        </p>
        <p>
          答案只需要高中的<strong>等比數列</strong>：每一步，剩下的誤差都被乘上同一個數 <Tex>{T`p=1-\mu x^2`}</Tex>。
        </p>
        <p>
          LMS 的每一步做三件事。<strong>預測</strong>：用目前的估計 <Tex>{T`w_n`}</Tex> 算出 <Tex>{T`w_nx`}</Tex>（<Tex>n</Tex> 是第幾次更新，也就是 sample 索引；<Tex>{T`w_n`}</Tex> 是第{' '}
          <Tex>n</Tex> 次更新時你對 <Tex>a</Tex> 的估計）。<strong>比較</strong>：和真實輸出相減，得到<strong>預測誤差</strong> <Tex>{T`e_n=y-w_nx`}</Tex>。<strong>修正</strong>：
          <Tex>{T`w_{n+1}=w_n+\mu\,e_n\,x`}</Tex>，<Tex>\mu</Tex> 是<strong>學習率</strong>（step size）。畫成方塊圖就是一個迴圈：
        </p>
        <Fig
          chart={CHART_LMS_LOOP}
          caption={T`LMS 的一步：預測 → 比較 → 修正。看藍色部分：修正量 $\mu e_nx$ 進累加器，更新後的 $w$ 延遲一步再回到模型，形成回授。`}
          ariaLabel="輸入 x 同時送進未知系統與模型，兩者輸出相減得到誤差 e，誤差乘上 mu 與 x 成為修正量，累加器把它加到 w 上，延遲一步後回到模型"
        />
        <p>
          先看上半：同一個 <Tex>x</Tex> 同時送進未知系統（<Tex>{T`\times\,a`}</Tex>）與你的模型（<Tex>{T`\times\,w[n]`}</Tex>），兩個輸出在加法點相減（<Tex>y</Tex> 標 ＋、<Tex>{T`w[n]x`}</Tex> 標 −）得到{' '}
          <Tex>{T`e[n]`}</Tex>。再看下半的藍色方塊：<Tex>{T`e[n]`}</Tex> 乘上 <Tex>{T`\mu x`}</Tex> 變成修正量（虛線提醒你：這裡的 <Tex>x</Tex> 就是最上面那個輸入，所以 <Tex>{T`\text{修正量}=\text{步長}\times\text{誤差}\times\text{輸入}`}</Tex>），累加器把它加到 <Tex>{T`w[n]`}</Tex> 上得到 <Tex>{T`w[n+1]`}</Tex>；延遲一步之後它就是新的{' '}
          <Tex>{T`w[n]`}</Tex>，沿著回授線回到模型。圖上的 <Tex>{T`e[n]`}</Tex>、<Tex>{T`w[n]`}</Tex> 就是公式裡的 <Tex>{T`e_n`}</Tex>、<Tex>{T`w_n`}</Tex>；藍色兩格加上回授線，就是更新式{' '}
          <Tex>{T`w_{n+1}=w_n+\mu e_nx`}</Tex>（對照章首的系統地圖：「<Tex>{T`\times\,\mu x`}</Tex>」是 learning rate 那一格、累加器就是 gain accumulator）。
        </p>
      </Section>

      <Section kind="example" title={tx`先算一次（$\mu=0.1$）`}>
        <p>
          <Tex>{T`a=3,\ w_0=1,\ x=2,\ \mu=0.1`}</Tex>。第一步：<Tex>{T`e_0=6-1\cdot2=4`}</Tex>，<Tex>{T`w_1=1+0.1\cdot4\cdot2=1.8`}</Tex>；
          第二步：<Tex>{T`e_1=6-1.8\cdot2=2.4`}</Tex>，<Tex>{T`w_2=1.8+0.1\cdot2.4\cdot2=2.28`}</Tex>（T01）。下表由網站的 LMS 程式實際跑出；第四欄{' '}
          <Tex>{T`\delta_n=a-w_n`}</Tex> 是估計值離真實參數<strong>還差多少</strong>（剩餘參數誤差），最右欄是相鄰兩步誤差的比值：
        </p>
        <HandCalcTable />
        <p>
          最右欄永遠是 <strong>0.6</strong>：誤差每一步都剩下 60%。而 <Tex>{T`0.6=1-0.1\cdot2^2=1-\mu x^2`}</Tex>。下面把這件事證明出來。
        </p>
        <Callout kind="info" title={tx`$\delta$ 的正負號（極性）`}>
          本站一律用 <Tex>{T`\delta_n=a-w_n`}</Tex>（規格 §0 約定），所以 <Tex>{T`\delta_0,\delta_1,\delta_2=+2,+1.2,+0.72`}</Tex>。規格 §3 原文寫{' '}
          <Tex>{T`\delta_n=w_n-a`}</Tex>，數值會差一個負號；遞迴式完全相同。 <Erratum id="E39" /> <Erratum id="E32" />
        </Callout>
      </Section>

      <Section kind="formula" title="一步一步推導">
        <p>
          推導之前先看圖。把{figRef(CHART_LMS_LOOP)} 的迴圈改用「還差多少」<Tex>{T`\delta_n=a-w_n`}</Tex> 來畫，未知的 <Tex>a</Tex> 和估計值 <Tex>{T`w_n`}</Tex> 都不見了，只剩一個很小的迴圈：
        </p>
        <Fig
          chart={CHART_ERROR_RECURSION}
          caption={T`誤差遞迴是一個一階回授迴圈。看兩個藍色方塊：「展開來看」每一步修掉 $\mu x^2\delta_n$；「合併之後」兩條路變成一個增益 $p=1-\mu x^2$。`}
          ariaLabel="展開來看：誤差 delta 分兩路，一路直接進加法點，一路乘上 mu x 平方後被減掉，結果延遲一步再回來。合併之後：等效為誤差每繞一圈乘上 p 等於 1 減 mu x 平方"
        />
        <p>
          先看「展開來看」那一框：從 <Tex>{T`z^{-1}`}</Tex>（延遲一步，就是上一張圖累加器裡「下一步才用到新值」的那個延遲）出來的 <Tex>{T`\delta[n]`}</Tex> 分成兩路，一路直接進加法點（＋），另一路乘上{' '}
          <Tex>{T`\mu x^2`}</Tex> 後被<strong>減掉</strong>（−）——這一步修掉的量正比於誤差本身。再看「合併之後」那一框：兩條路合併成一個增益{' '}
          <Tex>{T`p=1-\mu x^2`}</Tex>，每繞一圈（過一次 <Tex>{T`z^{-1}`}</Tex>）誤差就乘一次 <Tex>p</Tex>。圖上的「<Tex>{T`\times\,\mu x^2`}</Tex>」就是下面推導第 5 步的{' '}
          <Tex>{T`\mu(\delta_nx)x`}</Tex>，合併後的「<Tex>{T`\times\,p`}</Tex>」就是 F-03.1 的 <Tex>{T`(1-\mu x^2)`}</Tex>。
        </p>
        <StepsBox
          title="由 LMS 更新式推出誤差遞迴"
          steps={[
            { tex: T`e_n=y-w_nx=ax-w_nx`, why: tx`無雜訊時真實系統輸出 $y=ax$；模型預測是 $w_nx$。` },
            { tex: T`e_n=(a-w_n)\,x=\delta_n\,x`, why: tx`提出公因數 $x$，再用定義 $\delta_n=a-w_n$。` },
            { tex: T`w_{n+1}=w_n+\mu\,e_n\,x`, why: tx`LMS 更新式（第 1 章由 $\tfrac12e_n^2$ 的梯度得到）。` },
            { tex: T`a-w_{n+1}=(a-w_n)-\mu\,e_n\,x`, why: tx`用 $a$ 減去等式兩邊（$a$ 是常數，不隨 $n$ 改變）。` },
            { tex: T`\delta_{n+1}=\delta_n-\mu\,(\delta_n x)\,x`, why: tx`左邊就是 $\delta_{n+1}$；右邊代入第 2 步的 $e_n=\delta_nx$。` },
            { tex: T`\delta_{n+1}=(1-\mu x^2)\,\delta_n`, why: tx`提出公因數 $\delta_n$。` },
          ]}
          result={T`\delta_{n+1}=(1-\mu x^2)\,\delta_n`}
        />
        <FBlock id="F-03.1" />
        <StepsBox
          title="反覆代入得到封閉解"
          steps={[
            { tex: T`\delta_1=p\,\delta_0`, why: tx`令 $p=1-\mu x^2$，把 $n=0$ 代入遞迴。` },
            { tex: T`\delta_2=p\,\delta_1=p\cdot p\,\delta_0=p^2\delta_0`, why: tx`$n=1$ 再代一次，並用上一行。` },
            { tex: T`\delta_n=p^{\,n}\,\delta_0`, why: tx`每走一步多乘一個 $p$（數學歸納法：若 $\delta_n=p^n\delta_0$，則 $\delta_{n+1}=p\cdot p^n\delta_0=p^{n+1}\delta_0$）。` },
          ]}
        />
        <FBlock id="F-03.2" />
        <p>
          這個每一步的乘法因子 <Tex>p</Tex> 在離散時間系統裡叫 <strong>pole（極點）</strong>（名稱的由來見本節後面的先備知識「Z transform、pole 與單位圓」）。對照{figRef(CHART_ERROR_RECURSION)} 的「合併之後」那一框：繞{' '}
          <Tex>n</Tex> 圈就乘 <Tex>n</Tex> 次 <Tex>p</Tex>，所以 <Tex>{T`\delta_n=p^n\delta_0`}</Tex>；會不會收斂，只看 <Tex>{T`|p|`}</Tex> 比 1 大還是小。
        </p>
        <Prereq title={T`等比數列：什麼時候 $r^n$ 會趨近 0？`}>
          <p>
            把 <Tex>{T`|r|^n`}</Tex> 寫成指數：<Tex>{T`|r|^n=e^{\,n\ln|r|}`}</Tex>。
          </p>
          <ul>
            <li>
              <Tex>{T`|r|<1`}</Tex>：<Tex>{T`\ln|r|<0`}</Tex>，指數 <Tex>{T`n\ln|r|\to-\infty`}</Tex>，所以 <Tex>{T`|r|^n\to0`}</Tex>。
            </li>
            <li>
              <Tex>{T`|r|=1`}</Tex>：<Tex>{T`|r|^n=1`}</Tex>，大小不變（不收斂到 0）。
            </li>
            <li>
              <Tex>{T`|r|>1`}</Tex>：<Tex>{T`\ln|r|>0`}</Tex>，<Tex>{T`|r|^n\to\infty`}</Tex>。
            </li>
            <li>
              <Tex>{T`r<0`}</Tex>：<Tex>{T`r^n`}</Tex> 的正負號每一步交替（<Tex>{T`(-0.6)^n=+1,-0.6,+0.36,\dots`}</Tex>），但大小仍由 <Tex>{T`|r|`}</Tex> 決定。
            </li>
          </ul>
          <p>
            同一個式子也給出「時間常數」：<Tex>{T`|r|^n=e^{-n/\tau}`}</Tex>，<Tex>{T`\tau=-1/\ln|r|`}</Tex>。另外本章後面會用到等比級數和：
            <Tex>{T`\sum_{k=0}^{n-1}r^k=\frac{1-r^n}{1-r}`}</Tex>（<Tex>{T`r\ne1`}</Tex>），<Tex>{T`|r|<1`}</Tex> 時趨近 <Tex>{T`\frac{1}{1-r}`}</Tex>。
          </p>
        </Prereq>
        <StepsBox
          title={tx`穩定條件 $|p|<1$ 解成 $\mu$ 的範圍`}
          steps={[
            { tex: T`|\delta_n|=|p|^n|\delta_0|\to0\ \ (\forall\,\delta_0)\iff|p|<1`, why: '等比數列（上面的先備知識）；要對所有初始誤差都成立。' },
            { tex: T`-1<1-\mu x^2<1`, why: tx`絕對值不等式 $|p|<1$ 拆成兩邊。` },
            { tex: T`-2<-\mu x^2<0`, why: '三邊同時減 1。' },
            { tex: T`0<\mu x^2<2`, why: tx`三邊同乘 $-1$，不等號方向反轉。` },
            { tex: T`0<\mu<\frac{2}{x^2}`, why: tx`$x\ne0$ 時 $x^2>0$，三邊同除以 $x^2$ 不改方向。` },
          ]}
        />
        <FBlock id="F-03.3" />
        <p>
          <Tex>{T`x=2`}</Tex>：<Tex>{T`0<\mu<${tnum(fixedXMuMax(X))}`}</Tex>，而且 <Tex>{T`\mu=1/x^2=0.25`}</Tex> 時 <Tex>{T`p=0`}</Tex>，理想模型<strong>一步到答案</strong>。
          <ClaimTag kind="exact" />
        </p>
        <Callout kind="warn" title={tx`$x=0$ 的情況`}>
          <Tex>{T`x=0`}</Tex> 時 <Tex>{T`p=1`}</Tex>（任何 <Tex>\mu</Tex>）：<Tex>{T`e_n=0`}</Tex>，<Tex>w</Tex> 永遠不動。不是「穩定」，而是<strong>沒有激勵、不可辨識</strong>
          ——資料裡根本沒有 <Tex>a</Tex> 的資訊（<ChRef ch="09">第 9 章</ChRef> Persistent Excitation 的最簡單版本）。
        </Callout>
        <HC id="HC-03.1">
          {tx`把 $a$、$w_0$、$x$、$\mu$ 換成你自己的數字，先用紙筆算出 $p$、$\delta_2$ 與 $w_2$（只需要四則運算），再和下面的帶入過程逐步對照。試試 $\mu=0.25$、$0.4$、$0.5$、$0.6$，四種行為各算一次。`}
        </HC>
      </Section>

      <Section kind="diagram" title={tx`四種 pole 行為（$\mu=0.1,\,0.25,\,0.4,\,0.5,\,0.6$；$x=2$）`}>
        <p>
          <Tex>p</Tex> 一算出來，行為就定了。照下圖由左往右問兩個問題：先比 <Tex>{T`|p|`}</Tex> 和 1（決定收斂、邊界還是發散），再看 <Tex>p</Tex> 的正負（決定會不會每一步變號）。
        </p>
        <Fig
          chart={CHART_POLE_REGIME}
          caption={T`由 $p=1-\mu x^2$ 判斷行為的決策樹。綠 = 收斂（三種）、褐 = 邊界或不動、紅 = 發散；每個葉子同時寫出對應的 $\mu$ 範圍。`}
          ariaLabel="決策樹：p 的絕對值小於 1 時依 p 的正負分成單調收斂、一步到位、震盪收斂；等於 1 時為邊界或不動；大於 1 時發散"
        />
        <p>
          每個葉子的 <Tex>\mu</Tex> 範圍都是由 <Tex>{T`p=1-\mu x^2`}</Tex> 反解出來的（例如 <Tex>{T`-1<p<0\iff1/x^2<\mu<2/x^2`}</Tex>）；三個綠色葉子合起來就是 F-03.3 的{' '}
          <Tex>{T`0<\mu<2/x^2`}</Tex>。下表用 <Tex>{T`x=2`}</Tex> 的五個 <Tex>\mu</Tex> 各走一條分支；表中的 <Tex>\tau</Tex> 是<strong>時間常數</strong>（誤差縮小到{' '}
          <Tex>{T`1/e\approx37\%`}</Tex> 所需的步數，本節後半推導）。
        </p>
        <FiveMuTable />
        <FiveMuPlots />
        <ul>
          <li>
            <Tex>{T`0<p<1`}</Tex>（<Tex>{T`\mu=0.1`}</Tex>）：不變號、單調收斂——誤差一直是正的，越來越小。
          </li>
          <li>
            <Tex>{T`p=0`}</Tex>（<Tex>{T`\mu=0.25`}</Tex>）：一步歸零（deadbeat）。<strong>只在無雜訊、<Tex>x</Tex> 完全已知時</strong>成立。
          </li>
          <li>
            <Tex>{T`-1<p<0`}</Tex>（<Tex>{T`\mu=0.4`}</Tex>）：正負交替、震盪收斂——<strong>穩定不代表不震盪</strong>（過頭又拉回來）。
          </li>
          <li>
            <Tex>{T`p=-1`}</Tex>（<Tex>{T`\mu=0.5`}</Tex>）：邊界，<Tex>{T`|\delta_n|`}</Tex> 永遠等於 2，在 <Tex>{T`w=1`}</Tex> 與 <Tex>{T`w=5`}</Tex> 之間來回跳。
          </li>
          <li>
            <Tex>{T`|p|>1`}</Tex>（<Tex>{T`\mu=0.6`}</Tex>，<Tex>{T`p=-1.4`}</Tex>）：每步放大 1.4 倍並變號——發散。
          </li>
        </ul>
        <p>
          「多快收斂」也只由 <Tex>{T`|p|`}</Tex> 決定。<Tex>\varepsilon</Tex> 是你要求的<strong>相對誤差門檻</strong>（例如 <Tex>{T`10^{-3}`}</Tex> 表示誤差降到起點的千分之一），
          <Tex>{T`n_\varepsilon`}</Tex> 是降到門檻以下所需的步數。手算順序如下圖：
        </p>
        <Fig
          chart={CHART_TAU_FLOW}
          caption={T`手算順序（HC-03.2）：$\ln|p|$ 只算一次、用兩次；藍色兩格是要的答案 $\tau$ 與 $n_\varepsilon$。`}
          ariaLabel="由 x 與 mu 算出 p，取絕對值再取自然對數；時間常數是負一除以它，收斂步數是 ln epsilon 除以它後無條件進位"
        />
        <p>
          先看從「已知 <Tex>x</Tex>、<Tex>\mu</Tex>」往下的那條路：算出 <Tex>p</Tex>，取絕對值、按一次 <Tex>{T`\ln`}</Tex>，再做一次除法就是 <Tex>\tau</Tex>。再看從「門檻{' '}
          <Tex>\varepsilon</Tex>」出發的那條路：門檻也取 <Tex>{T`\ln`}</Tex>，兩個負數相除、無條件進位就是 <Tex>{T`n_\varepsilon`}</Tex>。圖上兩個藍色方塊就是下面推導出來的 F-03.4。
        </p>
        <StepsBox
          title={tx`工程量：時間常數與收斂到 $\varepsilon$ 所需的步數`}
          steps={[
            { tex: T`\frac{|\delta_n|}{|\delta_0|}=|p|^n=e^{\,n\ln|p|}`, why: '封閉解取絕對值，再把次方寫成指數。' },
            { tex: T`=e^{-n/\tau},\qquad \tau\equiv\frac{-1}{\ln|p|}`, why: tx`$0<|p|<1$ 時 $\ln|p|<0$，所以 $\tau>0$（單位：sample）。` },
            { tex: T`|p|^n\le\varepsilon\iff n\ln|p|\le\ln\varepsilon`, why: tx`兩邊取 $\ln$（$\ln$ 是遞增函數，不改方向）。` },
            { tex: T`\iff n\ge\frac{\ln\varepsilon}{\ln|p|}`, why: tx`除以負數 $\ln|p|$，不等號反向；$n$ 是整數，所以取上高斯 $\lceil\cdot\rceil$。` },
          ]}
        />
        <FBlock id="F-03.4" />
        <p>
          例：<Tex>{T`p=0.6`}</Tex> 時 <Tex>{T`\tau=${tnum(-1 / Math.log(0.6), 4)}`}</Tex> samples，誤差降到 <Tex>{T`10^{-3}`}</Tex> 需要{' '}
          <Tex>{T`\lceil\ln10^{-3}/\ln0.6\rceil=${Math.ceil(Math.log(1e-3) / Math.log(0.6))}`}</Tex> 步；<Tex>{T`p=-0.6`}</Tex>（<Tex>{T`\mu=0.4`}</Tex>）一樣快，只是會震盪。
        </p>
        <HC id="HC-03.2">
          {tx`換一組 $x$、$\mu$、$\varepsilon$，先用計算機的 $\ln$ 鍵算出 $\tau$ 與 $n_\varepsilon$，再對答案；把 $\mu$ 改成 $0.4$（$p=-0.6$）會發現步數一模一樣。`}
        </HC>
      </Section>

      <Section kind="diagram" title="直覺：pole 在單位圓內，離散時間系統就穩定">
        <div className="ch03-plots">
          <UnitCirclePlot />
          <PoleVsMuPlot />
        </div>
        <Prereq title="Z transform、pole 與單位圓（只用等比級數）">
          <p>
            把整條序列 <Tex>{T`\delta_0,\delta_1,\delta_2,\dots`}</Tex> 打包成一個函數 <Tex>{T`\Delta(z)=\sum_{n\ge0}\delta_n z^{-n}`}</Tex>（Z transform）。代入 <Tex>{T`\delta_n=p^n\delta_0`}</Tex>：
          </p>
          <TexBlock>{T`\Delta(z)=\delta_0\sum_{n\ge0}\big(p\,z^{-1}\big)^n=\frac{\delta_0}{1-p\,z^{-1}}=\frac{\delta_0\,z}{z-p}\qquad(|z|>|p|)`}</TexBlock>
          <p>
            分母在 <Tex>{T`z=p`}</Tex> 變成 0，這個點叫 <strong>pole（極點）</strong>。pole 的位置決定序列的命運：<Tex>{T`|p|<1`}</Tex>（在單位圓 <Tex>{T`|z|=1`}</Tex>{' '}
            之內）<Tex>{T`\iff p^n\to0`}</Tex>。
          </p>
          <p>
            與連續時間的對照：連續系統的解是 <Tex>{T`e^{st}`}</Tex>，穩定 <Tex>{T`\iff\operatorname{Re}s<0`}</Tex>（左半平面）。每隔 <Tex>{T`T_s`}</Tex> 取樣一次，
            <Tex>{T`e^{sT_s n}=(e^{sT_s})^n`}</Tex>，等於一個 pole 在 <Tex>{T`z=e^{sT_s}`}</Tex> 的離散系統；<Tex>{T`|z|=e^{\operatorname{Re}(s)T_s}<1\iff\operatorname{Re}s<0`}</Tex>。
            所以「左半平面」對應到「單位圓內」。差別是：離散系統的 pole 還可以是<strong>負實數</strong>（<Tex>{T`-1<p<0`}</Tex>，每步變號），連續的一階系統做不到。
          </p>
        </Prereq>
        <p className="small muted">
          本章只有一個狀態（純量），pole 只會在實軸上。<ChRef ch="08">第 8 章</ChRef>加入更新延遲後，特徵方程式 <Tex>{T`z^{d+1}-z^d+g=0`}</Tex> 會有複數 pole；第 9–10 章多參數時 pole 變成矩陣的 eigenvalue。
          <SourceTag kind="illustrative" />
        </p>
      </Section>

      <Section kind="explore" title="動手觀察：Fixed-x Pole Explorer">
        <p>
          試試看：(1) 把 Case A 的 <Tex>\mu</Tex> 拉到 <Tex>{T`0.25`}</Tex>，看 <Tex>{T`\delta_1=0`}</Tex>；(2) 新增 Case B 設 <Tex>{T`\mu=0.4`}</Tex>，比較單調與震盪；(3) 把 <Tex>x</Tex> 改成 1，
          穩定上限變成 <Tex>{T`2/x^2=2`}</Tex>——<strong>同一個 <Tex>\mu</Tex> 對不同幅度的 <Tex>x</Tex> 有完全不同的 pole</strong>，這就是後面要用 <Tex>{T`P_x=E[x^2]`}</Tex> 正規化的原因。
        </p>
        <FixedXExplorer />
      </Section>
      <ModeGate min="research">
        <FloatDeadbeatNote />
      </ModeGate>
    </>
  )
}
