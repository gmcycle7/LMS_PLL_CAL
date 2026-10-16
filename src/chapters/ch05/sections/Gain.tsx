import { useMemo } from 'react'
import type { Data } from 'plotly.js-dist-min'
import { Callout, ClaimTag, ModeGate, Plot, Prereq, Section, Tex, TexBlock, useThemeTokens, ChRef } from '@/components'
import { normPdf } from '@/simulation/core'
import { kq, kqLocal, linearizationRelError, meanQ, pPlus } from '@/simulation/models/comparator'
import { Fig, HandCalcBlock, Steps, fx, hline, linspace, pct, texNum } from '../common'

/** 找出線性化誤差 = target 的 r（二分法；誤差在 r > 0 單調遞增）。 */
function rForLinError(target: number): number {
  let lo = 1e-6
  let hi = 5
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2
    if (linearizationRelError(mid) < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

const TABLE_R = [0.01, 0.1, 0.25, 0.5, 1, 1.5, 2, 3]

/** §5：小訊號增益 K_q、S 曲線與飽和。 */
export function GainSection() {
  const tokens = useThemeTokens()
  const d = useMemo(() => {
    const k = kq(100)
    const m = meanQ(1, 100)
    const r1 = rForLinError(0.01)
    const r5 = rForLinError(0.05)
    const rs = linspace(-4, 4, 401)
    const rows = TABLE_R.map((r) => ({
      r,
      p: pPlus(r, 1),
      m: meanQ(r, 1),
      lin: kq(1) * r,
      err: linearizationRelError(r),
      slope: kqLocal(r, 1) / kq(1),
    }))
    return { k, m, r1, r5, rs, rows, sat2: meanQ(2, 1) / (kq(1) * 2) }
  }, [])

  const sData = useMemo<Data[]>(
    () => [
      { x: d.rs, y: d.rs.map((r) => meanQ(r, 1)), name: String.raw`$E[q] = \operatorname{erf}(r/\sqrt{2})$（精確）`, mode: 'lines', line: { color: tokens.series[0], width: 2.5 } },
      {
        x: d.rs.filter((r) => Math.abs(r) <= 1.9),
        y: d.rs.filter((r) => Math.abs(r) <= 1.9).map((r) => Math.sqrt(2 / Math.PI) * r),
        name: String.raw`切線 $K_q\cdot s = \sqrt{2/\pi}\cdot r$（小訊號）`,
        mode: 'lines',
        line: { color: tokens.series[1], dash: 'dash' },
      },
      { x: d.rs, y: d.rs.map((r) => kqLocal(r, 1) / kq(1)), name: String.raw`局部斜率 / $K_q = e^{-r^2/2}$`, mode: 'lines', line: { color: tokens.series[2], dash: 'dot' } },
    ],
    [d, tokens],
  )

  return (
    <Section
      kind="formula"
      level={2}
      title={
        <>
          5. 小訊號增益 <Tex>{'K_q'}</Tex>：把 1-bit comparator 當成一個「平均線性」的增益
        </>
      }
    >
      <p>
        後面所有的 LMS 迴路分析（pole <Tex>{'p_{\\mathrm{cal}}=1-\\mu K_qC'}</Tex>、noise、phase margin）都需要一個「comparator 的增益」。式中 <Tex>{'\\mu'}</Tex>{' '}
        是學習率（每次更新的步長），<Tex>{'C'}</Tex> 是 regressor 與誤差路徑輸出的相關量（<ChRef ch="06">Ch06</ChRef> 詳述；本章 <Tex>{'x\\equiv1'}</Tex>，所以 <Tex>{'C=1'}</Tex>）。但 comparator 是不連續的階梯，
        它的增益從哪來？答案：
        <strong>
          不是單一樣本的增益，而是平均輸出 <Tex>{'E[q]'}</Tex> 對 <Tex>{'s'}</Tex> 的斜率 <Tex>{'dE[q]/ds'}</Tex>
        </strong>
        。雜訊把階梯「抹平」成一條平滑的 S 曲線。
      </p>
      <p>
        有了這個斜率（記作 <Tex>{'K_q'}</Tex>，單位 <Tex>{'\\mathrm{fs}^{-1}'}</Tex>），就可以把不好分析的 sign 換成一個好分析的等效模型：
      </p>
      <Fig name="smallSignal">
        先看上框：真實的 comparator 把 <Tex>{'e=s+v'}</Tex> 硬切成 <Tex>{'\\pm1'}</Tex>，是非線性的。再看下框：同一個輸出 <Tex>{'q'}</Tex> 拆成「平均」加「零均值的起伏」——平均{' '}
        <Tex>{'E[q]'}</Tex> 在 <Tex>{'|s|\\ll\\sigma_v'}</Tex> 時和 <Tex>{'s'}</Tex> 成正比，畫成增益方塊 <Tex>{'K_q'}</Tex>；起伏 <Tex>{'\\eta\\equiv q-E[q]'}</Tex>{' '}
        畫成從加法點注入的雜訊，功率 <Tex>{'\\operatorname{Var}(q)=1-m^2\\approx1'}</Tex>。原本的雜訊 <Tex>{'v'}</Tex> 沒有消失：它決定了 <Tex>{'K_q'}</Tex> 的大小。圖上的「
        <Tex>{'K_q\\cdot s'}</Tex>」就是下面 F-05.10 的 <Tex>{'E[q]\\approx K_qs'}</Tex>。
      </Fig>
      <Prereq title={String.raw`$\operatorname{erf}$ 的泰勒展開（只用到 $e^u$ 的展開與逐項積分）`}>
        <p>
          <Tex>{String.raw`e^{u}=1+u+\frac{u^2}{2!}+\frac{u^3}{3!}+\cdots`}</Tex>，代 <Tex>{'u=-t^2'}</Tex> 得{' '}
          <Tex>{String.raw`e^{-t^2}=1-t^2+\frac{t^4}{2}-\cdots`}</Tex>，逐項從 0 積到 x：
        </p>
        <TexBlock>{String.raw`\operatorname{erf}(x)=\frac{2}{\sqrt\pi}\left(x-\frac{x^3}{3}+\frac{x^5}{10}-\cdots\right)`}</TexBlock>
      </Prereq>
      <Steps
        title={String.raw`方法一：$\operatorname{erf}$ 一階泰勒`}
        steps={[
          { tex: String.raw`E[q]=\operatorname{erf}\!\left(\frac{r}{\sqrt2}\right),\qquad r=\frac{s}{\sigma_v}`, why: <>§2 的結果（<Tex>{'\\theta=0'}</Tex>）。</> },
          { tex: String.raw`=\frac{2}{\sqrt\pi}\left[\frac{r}{\sqrt2}-\frac13\Big(\frac{r}{\sqrt2}\Big)^3+\cdots\right]`, why: <>代入 erf 的泰勒展開，<Tex>{'x=r/\\sqrt2'}</Tex>。</> },
          { tex: String.raw`=\sqrt{\frac2\pi}\,r-\sqrt{\frac2\pi}\,\frac{r^3}{6}+\cdots`, why: <><Tex>{'\\frac{2}{\\sqrt\\pi}\\cdot\\frac{1}{\\sqrt2}=\\sqrt{\\tfrac2\\pi}'}</Tex>；<Tex>{'\\frac{2}{\\sqrt\\pi}\\cdot\\frac{1}{3\\cdot2\\sqrt2}=\\frac16\\sqrt{\\tfrac2\\pi}'}</Tex>。</> },
          { tex: String.raw`\approx\sqrt{\frac2\pi}\,\frac{s}{\sigma_v}\quad(|r|\ll1)`, why: '只留一階項。' },
        ]}
      />
      <Steps
        title="方法二：直接對 $s$ 微分（連鎖律 + 微積分基本定理）"
        steps={[
          { tex: String.raw`\frac{d}{ds}E[q]=\frac{d}{ds}\Big[2\Phi\Big(\frac{s}{\sigma_v}\Big)-1\Big]`, why: <><Tex>{'E[q]=2\\Phi(s/\\sigma_v)-1'}</Tex>（§2）。</> },
          { tex: String.raw`=\frac{2}{\sigma_v}\,\varphi\!\left(\frac{s}{\sigma_v}\right)`, why: <><Tex>{"\\Phi'=\\varphi"}</Tex>（微積分基本定理），內層 <Tex>{'s/\\sigma_v'}</Tex> 的導數 <Tex>{'1/\\sigma_v'}</Tex>（連鎖律）。</> },
          { tex: String.raw`\begin{aligned}\left.\frac{dE[q]}{ds}\right|_{s=0}&=\frac{2}{\sigma_v}\cdot\frac{1}{\sqrt{2\pi}}\\&=\sqrt{\frac{2}{\pi}}\,\frac{1}{\sigma_v}\end{aligned}`, why: <><Tex>{'\\varphi(0)=1/\\sqrt{2\\pi}'}</Tex>；<Tex>{'2/\\sqrt{2\\pi}=\\sqrt{2/\\pi}'}</Tex>。</> },
        ]}
      />
      <TexBlock
        id="F-05.10"
        label={
          <>
            Comparator 小訊號統計增益 <ClaimTag kind="approx" />（<Tex>{'|s|\\ll\\sigma_v'}</Tex>）
          </>
        }
      >
        {String.raw`\boxed{E[q]\approx K_q\,s,\qquad K_q=\sqrt{\frac{2}{\pi}}\,\frac{1}{\sigma_v}}`}
      </TexBlock>
      <p>
        <Tex>{String.raw`\sigma_v=100\,\mathrm{fs}`}</Tex>：<Tex>{String.raw`K_q=${fx(Math.sqrt(2 / Math.PI), 7)}/100\,\mathrm{fs}=${fx(d.k, 8)}\,\mathrm{fs}^{-1}`}</Tex>
        （T04 參考值 <Tex>{String.raw`0.00797885\,\mathrm{fs}^{-1}`}</Tex>）。
        驗算：<Tex>{String.raw`K_q\cdot1\,\mathrm{fs}=${fx(d.k, 10)}`}</Tex>，精確 <Tex>{String.raw`E[q]=${fx(d.m, 10)}`}</Tex>，
        相對差 <Tex>{`${texNum(d.k / d.m - 1, 4)}\\approx(0.01)^2/6=${texNum(1e-4 / 6, 4)}`}</Tex>。<ClaimTag kind="exact" />
      </p>
      <p>
        這個線性模型不是到處都能用：誤差一大，S 曲線就彎下來、最後貼平。實務上先算標準化誤差 <Tex>{'r=|s-\\theta|/\\sigma_v'}</Tex>，再看自己落在哪一區：
      </p>
      <Fig name="sCurveRegions">
        先算最上面的 <Tex>{'r'}</Tex>，再照兩個菱形往下走。綠色的線性區（<Tex>{'r\\le0.25'}</Tex>）可以放心用 <Tex>{'K_q'}</Tex> 與線性的 pole 公式；中間的壓縮區要改用局部斜率{' '}
        <Tex>{'K_qe^{-r^2/2}'}</Tex>；紅色的飽和區 comparator 只剩方向、不剩大小，更新變成每次固定走一步（slew-limited）。圖上「高估約 1%、5%」就是 F-05.11 的線性化誤差，「
        <Tex>{'K_q\\exp(-r^2/2)'}</Tex>」就是 F-05.12 的局部斜率。
      </Fig>
      <TexBlock
        id="F-05.11"
        label={
          <>
            線性化誤差（<Tex>{'K_qs'}</Tex> 高估多少）<ClaimTag kind="approx" />
          </>
        }
      >
        {String.raw`\frac{K_q s-E[q]}{E[q]}=\frac{\sqrt{2/\pi}\,r}{\operatorname{erf}(r/\sqrt2)}-1\approx\frac{r^2}{6}`}
      </TexBlock>
      <p>
        由精確式反解（二分法）：線性化高估 1% 發生在 <Tex>{`r\\approx${fx(d.r1, 3)}`}</Tex>（<Tex>{`\\sqrt{0.06}=${fx(Math.sqrt(0.06), 3)}`}</Tex> 是{' '}
        <Tex>{'r^2/6'}</Tex> 的預測），高估 5% 在 <Tex>{`r\\approx${fx(d.r5, 3)}`}</Tex>。也就是說，只要殘差小於約四分之一個 <Tex>{'\\sigma_v'}</Tex>，
        「comparator = 增益 <Tex>{'K_q'}</Tex>」就是好近似。
      </p>
      <TexBlock id="F-05.12" label={<>任一操作點的局部斜率（S 曲線飽和）<ClaimTag kind="exact" /></>}>
        {String.raw`\frac{dE[q]}{ds}=\frac{2}{\sigma_v}\,\varphi\!\left(\frac{s-\theta}{\sigma_v}\right)=K_q\,e^{-r^2/2}\;\xrightarrow{|r|\gg1}\;0`}
      </TexBlock>
      <Plot
        title="Comparator 的平均輸出（S 曲線）、$K_q$ 切線與局部斜率"
        data={sData}
        layout={{
          xaxis: { title: { text: String.raw`$r = (s - \theta)/\sigma_v$` } },
          yaxis: { title: { text: '$E[q]$　/　斜率比' }, range: [-1.6, 1.6] },
          shapes: [hline(1, tokens.textMuted), hline(-1, tokens.textMuted)],
        }}
        height={300}
        csvName="ch05-s-curve"
        caption={
          <>
            <Tex>{'|r|<0.25'}</Tex> 時切線與 erf 幾乎重合；<Tex>{'|r|>1.5'}</Tex> 以後 <Tex>{'E[q]'}</Tex> 貼近 <Tex>{'\\pm1'}</Tex>、局部斜率掉到{' '}
            <Tex>{`K_q e^{-1.125}=${fx(Math.exp(-1.125), 3)}K_q`}</Tex> 以下——大誤差時 comparator 只告訴你方向、不告訴你大小。
          </>
        }
      />
      <div className="table-wrap">
        <table className="ch05-table">
          <caption>
            以 <Tex>{'r'}</Tex> 為單位（與 golden comparator_table 相同的 <Tex>{'\\operatorname{erf}'}</Tex> / <Tex>{'\\Phi'}</Tex> 計算）。
          </caption>
          <thead>
            <tr>
              <th className="num">
                <Tex>{'r=s/\\sigma_v'}</Tex>
              </th>
              <th className="num">
                <Tex>{'P(q=+1)=\\Phi(r)'}</Tex>
              </th>
              <th className="num">
                <Tex>{'E[q]=\\operatorname{erf}(r/\\sqrt2)'}</Tex>
              </th>
              <th className="num">
                <Tex>{'K_qs=\\sqrt{2/\\pi}\\,r'}</Tex>
              </th>
              <th className="num">線性化高估</th>
              <th className="num">
                局部斜率 <Tex>{'/K_q=e^{-r^2/2}'}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.r}>
                <td className="num">{r.r}</td>
                <td className="num">{fx(r.p, 6)}</td>
                <td className="num">{fx(r.m, 6)}</td>
                <td className="num">{fx(r.lin, 6)}</td>
                <td className="num">{pct(r.err, 3)}</td>
                <td className="num">{fx(r.slope, 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <HandCalcBlock id="HC-05.7">
        用你量到（或估計）的 <Tex>{'\\sigma_v'}</Tex> 算一次 <Tex>{'K_q'}</Tex>；再把 <Tex>{'s'}</Tex> 從 <Tex>{'0.01\\sigma_v'}</Tex> 慢慢加大到{' '}
        <Tex>{'\\sigma_v'}</Tex>，每次先手算「線性預測高估多少、局部斜率剩幾成」，再對照上表。
      </HandCalcBlock>
      <Callout kind="warn" title="大誤差時的飽和：Sign-LMS 變成 slew-limited">
        當 <Tex>{'|s|\\gtrsim\\sigma_v'}</Tex>，<Tex>{'E[q]\\to\\pm1'}</Tex>：每次更新的平均步長被限制在 <Tex>{'\\mu\\cdot\\max|x|'}</Tex>，與誤差大小無關。
        因為 <Tex>{'|E[q]|<K_q|s|'}</Tex>（erf 在正半軸是凹函數），真正的平均修正量比線性模型小，所以用 <Tex>{'K_q'}</Tex> 算出的 pole、時間常數都會
        <strong>低估</strong>收斂所需時間：例如 <Tex>{`|s|/\\sigma_v=${fx(d.r5, 2)}`}</Tex> 時平均修正量已比 <Tex>{'K_qs'}</Tex> 少約 5%（F-05.11），
        <Tex>{'|s|/\\sigma_v=2'}</Tex> 時只剩 <Tex>{`${fx(d.sat2, 3)}`}</Tex> 倍。<ChRef ch="14">Ch14</ChRef> 會把這個效應放進 coarse calibration 的時間估計。
        <ClaimTag kind="approx" />
      </Callout>
      <ModeGate min="research">
        <Callout
          kind="info"
          title={
            <>
              Research：<Tex>{'K_q=\\sqrt{2/\\pi}/\\sigma_v'}</Tex> 只對 Gaussian 成立
            </>
          }
        >
          一般式來自同一個微分：<Tex>{"\\frac{d}{ds}P(s+v\\ge\\theta)=\\frac{d}{ds}\\int_{\\theta-s}^{\\infty}f_v(t)\\,dt=f_v(\\theta-s)"}</Tex>（微積分基本定理），
          所以 <Tex>{"\\frac{dE[q]}{ds}=2f_v(\\theta-s)"}</Tex>，在迴路平衡點 <Tex>{'s=\\theta'}</Tex> 處 <Tex>{'K_q=2f_v(0)'}</Tex>：雜訊 PDF 在「輸入恰好等於門檻」處的值的兩倍。
          Gaussian 時 <Tex>{'f_v(0)=\\varphi(0)/\\sigma_v'}</Tex>（<Tex>{`\\varphi(0)=${fx(normPdf(0), 6)}`}</Tex>）得到 <Tex>{'\\sqrt{2/\\pi}/\\sigma_v'}</Tex>；
          均勻分布雜訊（例如 dither <Tex>{'v\\in[-A,A]'}</Tex>，<Tex>{'f_v=1/(2A)'}</Tex>）則是 <Tex>{'K_q=1/A'}</Tex>，S 曲線在 <Tex>{'\\pm A'}</Tex>{' '}
          內完全線性、外面硬飽和。非 Gaussian 的 BBPD 雜訊（例如含 deterministic jitter）應以量測的 S 曲線斜率取代 <Tex>{'K_q'}</Tex>（規格附錄 C R6）。
        </Callout>
      </ModeGate>
    </Section>
  )
}
