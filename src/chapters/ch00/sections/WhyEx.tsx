import { useMemo } from 'react'
import type { Data, Layout } from 'plotly.js-cartesian-dist-min'
import {
  ClaimTag,
  CodeBlock,
  Derivation,
  MathText,
  ModeGate,
  Plot,
  Prereq,
  Section,
  StepDerivation,
  Tex,
  TexBlock,
  useThemeTokens,
  ChRef,
} from '@/components'
import { useSettings } from '@/app/settings'
import {
  conventionalStep,
  fixedXMuMax,
  gaussianAlmostSureMuMax,
  meanPole,
  meanSquareMuMax,
  type PoleBehaviour,
} from '@/simulation/models/lms'
import { analyticGradient, centralDifference, costCurve, poleTable, sampleCost } from '../model'
import { POLE_BEHAVIOUR_TEX, num, texNum, texRes } from '../format'
import { ChapterDiagram, ChapterHandCalc, ErratumNote, ErratumRef, FigRef, Observe, PageLink } from '../common'
import modelSrc from '../model.ts?raw'

const X = 2
const Y = 6
const W0 = 1
const MU = 0.1
/** §0.6「數字驗算」用的例子（與 §0.4 手算表同一組；HC-00.4 的預設值，handcalcs.test.tsx 會比對） */
export const GRADIENT_EXAMPLE = { w: W0, x: X, y: Y, mu: MU }
const MU_LIST = [0.02, 0.1, 0.25, 0.4, 0.5, 0.65]
/** 固定的版面物件放在模組層級：每次 render 傳入同一個參照，Plot 才不會重畫（也不會把使用者的縮放重設） */
const COST_LAYOUT: Partial<Layout> = { xaxis: { title: { text: '$w$' } }, yaxis: { title: { text: '$j(w)$' }, range: [-0.5, 14] } }

/** §0.6 為什麼更新量是 μ·e·x？——½e² 的導數一步一步算。 */
export function WhyExSection() {
  const { atLeast } = useSettings()
  const tokens = useThemeTokens()
  const e0 = Y - W0 * X
  const g = analyticGradient(W0, X, Y)
  const fd = centralDifference(W0, X, Y)
  const w1 = conventionalStep({ w: W0, x: X, y: Y, mu: MU }).w
  const j0 = sampleCost(W0, X, Y)
  const curve = useMemo(() => costCurve(X, Y, -0.5, 5, 161), [])
  const poles = useMemo(() => poleTable(X, MU_LIST), [])
  const muMax = fixedXMuMax(X)
  const deadbeatMu = 1 / (X * X)
  // Observe 框引用的各區段代表（由 poleTable 的分類挑出，不手打）
  const pick = (b: PoleBehaviour) => poles.find((r) => r.behaviour === b)
  const slow = poles[0]
  const osc = pick('oscillating')
  const div = pick('divergent')

  const costData: Data[] = useMemo(() => {
    const tangentW = [W0 - 0.9, W0 + 0.9]
    return [
      { x: curve.w, y: curve.j, name: String.raw`$j(w) = \tfrac12\,(y - w\,x)^2$`, mode: 'lines', line: { color: tokens.series[0] } },
      {
        x: tangentW,
        y: tangentW.map((w) => j0 + g * (w - W0)),
        name: String.raw`$w_0$ 的切線（斜率 $dj/dw = ${texRes(g)}$）`,
        mode: 'lines',
        line: { color: tokens.series[1], dash: 'dash' },
      },
      {
        x: [W0, w1],
        y: [j0, sampleCost(w1, X, Y)],
        name: String.raw`一步更新 $w_0 = ${texRes(W0)} \to w_1 = ${texRes(w1)}$`,
        mode: 'lines+markers',
        marker: { size: 9 },
        line: { color: tokens.series[2] },
      },
      { x: [Y / X], y: [0], name: String.raw`最低點 $w = y/x = ${texRes(Y / X)}$`, mode: 'markers', marker: { size: 10, symbol: 'star', color: tokens.series[3] } },
    ]
  }, [curve, tokens, g, j0, w1])

  // Research：隨機 x 時的三種界限（Gaussian, E[x²] = 1, E[x⁴] = 3）
  const randomBounds = useMemo(
    () => (atLeast('research') ? { mean: 2 / 1, ms: meanSquareMuMax(1, 3), as: gaussianAlmostSureMuMax(1), meanPoleAt: meanPole(0.5, 1) } : null),
    [atLeast],
  )

  return (
    <Section
      kind="formula"
      level={2}
      id="ch00-why-ex"
      title={
        <>
          §0.6 為什麼是 <Tex>{'e\\,x'}</Tex>？——只用微積分推導
        </>
      }
    >
      <p>
        §0.2 用正負號的表格「猜」出 <Tex>{'\\Delta w\\propto e\\,x'}</Tex>。現在用一次微分證明它：LMS 其實就是在「誤差平方」這座山谷裡往下坡走。
      </p>
      <Prereq title="用到的微積分：chain rule 與 gradient descent（下坡法）">
        <p>
          <strong>Chain rule</strong>：若 <Tex>{'j=f(u)'}</Tex> 且 <Tex>{'u=u(w)'}</Tex>，則 <Tex>{'\\dfrac{dj}{dw}=f\'(u)\\,\\dfrac{du}{dw}'}</Tex>。例如 <Tex>{'\\frac{d}{dw}(3-2w)^2=2(3-2w)\\cdot(-2)'}</Tex>。
        </p>
        <p>
          <strong>Gradient descent</strong>：想找讓 <Tex>{'j(w)'}</Tex> 最小的 <Tex>{'w'}</Tex>，就沿著斜率的反方向走一小步：
          <Tex>{'w\\leftarrow w-\\mu\\,\\dfrac{dj}{dw}'}</Tex>。斜率為正（右邊比較高）就往左走，斜率為負就往右走；<Tex>{'\\mu'}</Tex> 是步長。由泰勒一階展開 <Tex>{'j(w+\\Delta)\\approx j(w)+j\'(w)\\Delta'}</Tex>，取 <Tex>{'\\Delta=-\\mu j\'(w)'}</Tex> 得{' '}
          <Tex>{'j(w+\\Delta)\\approx j(w)-\\mu\\,[j\'(w)]^2\\le j(w)'}</Tex>：只要步長夠小，成本一定下降。
        </p>
      </Prereq>

      <h3>單筆成本：誤差平方的一半</h3>
      <p>
        對第 <Tex>{'n'}</Tex> 筆資料，定義「這筆資料讓我們多不滿意」的分數 <Tex>{'j_n(w)=\\tfrac12e_n^2'}</Tex>。平方讓正負誤差都算成「不好」，前面的 <Tex>{'\\tfrac12'}</Tex> 只是為了讓微分後的 2 剛好約掉。
      </p>
      <p>
        有了分數，「學習」就變成一個幾何問題：把 <Tex>{'j_n'}</Tex> 想成一座山谷的高度，<Tex>{'w'}</Tex> 是我們站的位置，目標是走到谷底。下坡法每一步只做三件事——量腳下的斜率、往斜率的反方向跨一步、站到新的位置：
      </p>
      <ChapterDiagram name="CHART_GRADIENT_DESCENT">
        <p>
          先由左到右看主線：在目前的 <Tex>{'w[n]'}</Tex> 量出單筆成本 <Tex>{'j=\\tfrac12e^2'}</Tex> 的斜率（藍色）；算斜率還要這一筆資料 <Tex>{'x[n]'}</Tex>、<Tex>{'y[n]'}</Tex>（圓角的輸入，因為 <Tex>{'e=y-wx'}</Tex>）。再乘上 <Tex>{'-\\mu'}</Tex>（負號表示「反方向」，<Tex>{'\\mu'}</Tex> 決定步伐大小），得到這一步要走的{' '}
          <Tex>{'\\Delta w'}</Tex>。再看相加點：<Tex>{'w[n]'}</Tex> 另外拉一條線直接過來，和 <Tex>{'\\Delta w'}</Tex> 相加，得到新位置 <Tex>{'w[n+1]'}</Tex>；虛線表示下一筆資料來時再重複一次。
        </p>
        <p>
          圖上的「斜率 <Tex>{'dj/dw = -e\\,x'}</Tex>」就是下面逐步微分要證明的結果；「<Tex>{'\\Delta w = -\\mu\\,(dj/dw) = \\mu\\,e\\,x'}</Tex>」就是推導的最後兩行。把這張圖和 §0.3 的{' '}
          <FigRef name="CHART_LMS_ACCUMULATOR" /> 疊在一起看：兩張圖最後都是「<Tex>{'w[n]'}</Tex> 加上 <Tex>{'\\mu\\,e\\,x'}</Tex>」，所以 LMS 就是下坡法。
        </p>
      </ChapterDiagram>
      <div id="ch00-gradient-steps">
        <StepDerivation
          title="一步一步微分"
          steps={[
            {
              tex: String.raw`j_n(w)=\tfrac12\,e_n^2,\qquad e_n=y_n-w\,x_n`,
              why: (
                <>
                  定義：單筆成本是誤差平方的一半；誤差是 <Tex>{'w'}</Tex> 的函數。
                </>
              ),
            },
            {
              tex: String.raw`\frac{dj_n}{dw}=\tfrac12\cdot 2e_n\cdot\frac{de_n}{dw}`,
              why: (
                <>
                  Chain rule：外層 <Tex>{'\\tfrac12u^2'}</Tex> 對 <Tex>{'u'}</Tex> 微分得 <Tex>{'u'}</Tex>，再乘上內層 <Tex>{'u=e_n'}</Tex> 對{' '}
                  <Tex>{'w'}</Tex> 的導數。
                </>
              ),
            },
            {
              tex: String.raw`\frac{de_n}{dw}=\frac{d}{dw}\left(y_n-w\,x_n\right)=-x_n`,
              why: (
                <>
                  <Tex>{'y_n'}</Tex> 是量到的數字，和 <Tex>{'w'}</Tex> 無關（導數 0）；<Tex>{'w\\,x_n'}</Tex> 對 <Tex>{'w'}</Tex> 的導數是{' '}
                  <Tex>{'x_n'}</Tex>。
                </>
              ),
            },
            {
              tex: String.raw`\frac{dj_n}{dw}=e_n\cdot(-x_n)=-e_n\,x_n`,
              why: (
                <>
                  代入上一步；<Tex>{'\\tfrac12'}</Tex> 和 2 約掉。
                </>
              ),
            },
            { tex: String.raw`w_{n+1}=w_n-\mu\,\frac{dj_n}{dw}`, why: 'Gradient descent：沿斜率的反方向走一小步。' },
            { tex: String.raw`w_{n+1}=w_n-\mu\,(-e_nx_n)=w_n+\mu\,e_nx_n`, why: '代入第 4 步，負負得正。' },
          ]}
          result={String.raw`\frac{dj_n}{dw}=-e_nx_n\quad\Longrightarrow\quad w_{n+1}=w_n+\mu\,e_n\,x_n`}
        />
      </div>
      <TexBlock
        id="F-00.3"
        label={
          <>
            單筆成本與平均成本都帶 <Tex>{'\\tfrac12'}</Tex>（<ErratumRef eid="E41" />）；argmin 不受 <Tex>{'\\tfrac12'}</Tex> 影響
          </>
        }
      >
        {String.raw`j_n(w)=\tfrac12e_n^2,\qquad \frac{dj_n}{dw}=-e_nx_n,\qquad J(w)=\tfrac12E\!\left[(y-wx)^2\right]`}
      </TexBlock>
      <p className="small">
        最後一項 <Tex>{'J(w)'}</Tex> 是<strong>平均成本</strong>：把單筆成本 <Tex>{'j_n'}</Tex> 對非常多筆資料取平均。<Tex>{'E[\\cdot]'}</Tex>{' '}
        讀作「期望值」，就是「做很多次、取平均會趨近的值」（§0.7 的先備知識框會從頭解釋）。LMS 每一步只看得到一筆資料的 <Tex>{'j_n'}</Tex>，卻是在替 <Tex>{'J(w)'}</Tex> 下坡——名字裡的
        Mean Squares 就是指它。
      </p>
      <ErratumNote eid="E41">
        規格 §1 寫 <Tex>{'J_2(w)=E[(y-wx)^2]'}</Tex>（沒有 ½），但 §1.1 的單筆成本有 ½，兩者梯度差 2 倍。本站統一用{' '}
        <Tex>{'J(w)=\\tfrac12E[(y-wx)^2]'}</Tex>：最小值的位置不變，但畫切線或推步長界時，斜率才會和實際更新量{' '}
        <Tex>{'\\mu ex'}</Tex> 用同一個 scaling。
      </ErratumNote>

      <h3>
        數字驗算：在 <Tex>{`w_0=${texNum(W0)}`}</Tex> 的斜率
      </h3>
      <p>
        沿用手算例子（<Tex>{`x=${X},\\ y=${Y}`}</Tex>）：
        <Tex>{String.raw`\ e_0=${Y}-${W0}\times${X}=${texRes(e0)},\quad \frac{dj}{dw}\Big|_{w_0}=-e_0x=-${texNum(e0)}\times${X}=${texRes(g)}`}</Tex>。斜率是負的（往右走成本會下降），所以 gradient descent 往右走 <Tex>{String.raw`\mu\times${num(-g)}=${texNum(w1 - W0)}`}</Tex>，得到 <Tex>{`w_1=${texNum(w1)}`}</Tex>——和手算表完全一樣。
      </p>
      <Plot
        title={String.raw`單筆成本 $j(w)=\tfrac12(${Y}-${X}w)^2$：切線與一步更新`}
        ariaLabel="單筆成本 j(w) 的曲線、切線與一步更新"
        csvName="ch00-cost-tangent"
        data={costData}
        layout={COST_LAYOUT}
        height={300}
        caption={
          <>
            曲線 <Tex>{'j(w)=\\tfrac12(y-wx)^2'}</Tex> 由 <code>sampleCost</code>（＝ <code>lms.ts</code> 的 <code>lossValue('mse')</code>）計算；切線斜率{' '}
            <Tex>{'dj/dw=-e\\,x'}</Tex> 由 <code>analyticGradient</code> 計算；一步更新由 <code>conventionalStep</code> 計算。
          </>
        }
      />
      <Observe>
        更新量 <Tex>{'\\mu e x'}</Tex> 不是隨便湊出來的：<Tex>{'e x'}</Tex> 就是「負的斜率」。誤差越大，山坡越陡，步伐越大；越接近谷底，斜率越小，步伐自動變小。<Tex>{'x'}</Tex> 出現在公式裡，是因為它是 <Tex>{'\\hat y'}</Tex> 對 <Tex>{'w'}</Tex> 的槓桿{' '}
        <Tex>{'\\partial\\hat y/\\partial w=x'}</Tex>：同樣的預測誤差，<Tex>{'|x|'}</Tex> 越大，表示 <Tex>{'w'}</Tex> 對它的責任越大。
      </Observe>

      <ChapterHandCalc id="HC-00.4">
        不必相信微分的結果——用「左右各移一點、看成本差多少」親手量一次斜率。把 <Tex>{'w,\\ x,\\ y'}</Tex> 換成你自己的數字，先在紙上算出{' '}
        <Tex>{'-e\\,x'}</Tex> 和差分 <Tex>{'D_h'}</Tex>，確認兩者相同，再對答案。
      </ChapterHandCalc>

      <ModeGate min="engineer">
        <Derivation
          title={
            <>
              （Engineer）如果不加 <Tex>{'\\tfrac12'}</Tex> 會怎樣？
            </>
          }
          level="L0"
          claim="exact"
          defaultOpen={atLeast('engineer')}
          derivation={
            <StepDerivation
              steps={[
                {
                  tex: String.raw`\frac{d}{dw}\,e_n^2=2e_n\cdot(-x_n)=-2e_nx_n`,
                  why: (
                    <>
                      同樣的 chain rule，但少了 <Tex>{'\\tfrac12'}</Tex>，2 留下來。
                    </>
                  ),
                },
                {
                  tex: String.raw`w_{n+1}=w_n-\mu'\,\frac{d}{dw}e_n^2=w_n+2\mu'e_nx_n`,
                  why: (
                    <>
                      對「沒有 <Tex>{'\\tfrac12'}</Tex> 的成本」用步長 <Tex>{"\\mu'"}</Tex> 做 gradient descent。
                    </>
                  ),
                },
                {
                  tex: String.raw`2\mu'=\mu\iff\mu'=\mu/2`,
                  why: (
                    <>
                      要得到同樣的 LMS 更新，步長必須減半：LMS ＝ 對 <Tex>{'E[e^2]'}</Tex> 用步長 <Tex>{'\\mu/2'}</Tex> 的 SGD。
                    </>
                  ),
                },
                {
                  tex: String.raw`\frac{d^2}{dw^2}\tfrac12e^2=x^2\;\Rightarrow\;0<\mu<\frac{2}{x^2};\qquad \frac{d^2}{dw^2}e^2=2x^2\;\Rightarrow\;0<\mu'<\frac{1}{x^2}`,
                  why: (
                    <>
                      二次函數 <Tex>{'f(w)'}</Tex> 的 GD 穩定界是 <Tex>{"2/f''"}</Tex>（理由見下方的等比數列推導：GD 每一步的誤差倍數是 <Tex>{"p=1-\\mu f''"}</Tex>）。用錯成本的曲率去推{' '}
                      <Tex>{'\\mu'}</Tex> 的界，會差 2 倍（<ErratumRef eid="E41" /> 的數值證據）。
                    </>
                  ),
                },
              ]}
            />
          }
          assumptions={
            <ul>
              <li>
                固定 <Tex>{'x'}</Tex>、無雜訊
              </li>
              <li>
                二次成本的 GD 穩定界 <Tex>{"=2/f''"}</Tex>
              </li>
            </ul>
          }
        />
        <p className="small">
          <strong>數值梯度檢查</strong>：中央差分 <Tex>{'[j(w+h)-j(w-h)]/(2h)'}</Tex>（<Tex>{'h=10^{-3}'}</Tex>）在 <Tex>{'w_0'}</Tex> 得到{' '}
          <code>{String(fd)}</code>，解析值 <Tex>{`-e_0x=${texRes(g)}`}</Tex>。二次函數的中央差分沒有截斷誤差（三次以上的泰勒項為 0），差異只來自浮點（約{' '}
          <Tex>{texRes(Math.abs(fd - g), 2)}</Tex>）。
          <ClaimTag kind="exact" />
        </p>
        <CodeBlock source={modelSrc} region="gradient" path="src/chapters/ch00/model.ts" />
      </ModeGate>

      <h3>
        為什麼 <Tex>{'\\mu'}</Tex> 有上限？——等比數列
      </h3>
      <p>
        手算表的最後一欄是常數 <Tex>{`${texNum(1 - MU * X * X)}`}</Tex>。下面證明：固定 <Tex>{'x'}</Tex>、沒有雜訊時，每一步的參數誤差都乘上同一個數{' '}
        <Tex>{'p=1-\\mu x^2'}</Tex>。
      </p>
      <p>
        要看出原因，把 §0.2 的迴圈換一個變數來畫：不追蹤 <Tex>{'w_n'}</Tex>，改追蹤「還差多少」<Tex>{'\\delta_n=a-w_n'}</Tex>（§0.4 定義的參數誤差）。迴圈會變得非常簡單：
      </p>
      <ChapterDiagram name="CHART_ERROR_RECURSION">
        <p>
          先從暫存器出發順著箭頭走一圈：<Tex>{'\\delta[n]'}</Tex> 乘上 <Tex>{'x'}</Tex> 變成誤差 <Tex>{'e[n]'}</Tex>（沒有雜訊時 <Tex>{'e=\\delta x'}</Tex>），再乘上 <Tex>{'\\mu x'}</Tex>{' '}
          變成 LMS 的修正量 <Tex>{'\\mu e x=\\mu x^2\\delta'}</Tex>。再看藍色的相加點：<Tex>{'\\delta[n]'}</Tex> 以 <Tex>{'(+)'}</Tex> 進入、修正量以 <Tex>{'(-)'}</Tex> 進入——<Tex>{'w'}</Tex>{' '}
          往上修多少，「還差多少」就少多少。相加點的輸出寫回暫存器，成為 <Tex>{'\\delta[n+1]'}</Tex>。
        </p>
        <p>
          圖上繞一圈的總效果「<Tex>{'\\delta[n+1] = (1 - \\mu\\,x^2)\\,\\delta[n]'}</Tex>」就是下面的 F-00.4；括號裡那個數就是 <Tex>{'p'}</Tex>。繞 <Tex>{'n'}</Tex> 圈就乘 <Tex>{'n'}</Tex> 次{' '}
          <Tex>{'p'}</Tex>，所以會不會收斂只看 <Tex>{'|p|<1'}</Tex>——這正是 §0.5 <FigRef name="CHART_MU_REGIONS" /> 五個區段的由來。
        </p>
      </ChapterDiagram>
      <div id="ch00-pole-derivation">
        <Derivation
          title={
            <>
              參數誤差的遞迴（<Tex>{'\\delta=a-w'}</Tex>）
            </>
          }
          formulaId="F-00.4"
          level="L0"
          claim="exact"
          defaultOpen={atLeast('engineer')}
          derivation={
            <StepDerivation
              steps={[
                {
                  tex: String.raw`e_n=y-w_nx=ax-w_nx`,
                  why: (
                    <>
                      無雜訊：<Tex>{'y=ax'}</Tex>。
                    </>
                  ),
                },
                {
                  tex: String.raw`e_n=(a-w_n)\,x=\delta_n\,x`,
                  why: (
                    <>
                      提出 <Tex>{'x'}</Tex>；<Tex>{'\\delta_n=a-w_n'}</Tex> 是「還差多少」（全站極性，<ErratumRef eid="E39" />）。
                    </>
                  ),
                },
                { tex: String.raw`\delta_{n+1}=a-w_{n+1}=a-\left(w_n+\mu e_nx\right)`, why: '代入 LMS 更新式。' },
                {
                  tex: String.raw`\delta_{n+1}=(a-w_n)-\mu\,(\delta_nx)\,x=\delta_n-\mu x^2\delta_n`,
                  why: (
                    <>
                      把 <Tex>{'e_n=\\delta_n x'}</Tex> 代進去。
                    </>
                  ),
                },
                {
                  tex: String.raw`\delta_{n+1}=(1-\mu x^2)\,\delta_n\equiv p\,\delta_n`,
                  why: (
                    <>
                      提出 <Tex>{'\\delta_n'}</Tex>；<Tex>{'p'}</Tex> 稱為這個一階系統的 pole。
                    </>
                  ),
                },
                {
                  tex: String.raw`\delta_n=p^n\,\delta_0`,
                  why: (
                    <>
                      重複代入 <Tex>{'n'}</Tex> 次：等比數列。
                    </>
                  ),
                },
                {
                  tex: String.raw`\delta_n\to0\iff|p|<1\iff-1<1-\mu x^2<1`,
                  why: (
                    <>
                      等比數列 <Tex>{'p^n\\to0'}</Tex> 的充要條件是 <Tex>{'|p|<1'}</Tex>（<Tex>{'\\delta_0\\ne0'}</Tex> 時）。
                    </>
                  ),
                },
                {
                  tex: String.raw`\iff 0<\mu x^2<2\iff 0<\mu<\frac{2}{x^2}`,
                  why: (
                    <>
                      三邊同減 1 再乘 <Tex>{'-1'}</Tex>（不等號反向），最後除以 <Tex>{'x^2>0'}</Tex>。
                    </>
                  ),
                },
              ]}
              result={String.raw`\delta_{n+1}=(1-\mu x^2)\,\delta_n,\qquad 0<\mu<\frac{2}{x^2}\;\overset{x=2}{=}\;0<\mu<${texNum(muMax)}`}
            />
          }
          symbols={[
            { symbol: '\\delta_n=a-w_n', meaning: '參數誤差（全站極性）' },
            { symbol: 'p=1-\\mu x^2', meaning: '離散時間 pole' },
          ]}
          assumptions={
            <ul>
              <li>
                固定非零 <Tex>{'x'}</Tex>
              </li>
              <li>
                無雜訊 <Tex>{'v=0'}</Tex>
              </li>
              <li>
                <Tex>{'\\mu'}</Tex> 為常數
              </li>
            </ul>
          }
        />
      </div>
      <TexBlock
        id="F-00.4"
        label={
          <>
            固定 <Tex>{'x'}</Tex>、無雜訊：參數誤差每步乘上同一個 pole <Tex>{'p'}</Tex>（<Tex>{'\\delta=a-w'}</Tex>，<ErratumRef eid="E39" />）
          </>
        }
      >
        {String.raw`\delta_{n+1}=(1-\mu x^2)\,\delta_n\equiv p\,\delta_n,\qquad \delta_n=p^n\,\delta_0`}
      </TexBlock>
      <TexBlock
        id="F-00.5"
        label={
          <>
            固定 <Tex>{'x'}</Tex> 的穩定條件（<Tex>{`x=${X}`}</Tex> 時理論界 <Tex>{`0<\\mu<${texNum(muMax)}`}</Tex>）
          </>
        }
      >
        {String.raw`|1-\mu x^2|<1\iff\boxed{0<\mu<\dfrac{2}{x^2}}`}
      </TexBlock>
      <ErratumNote eid="E39">
        規格 §3 令 <Tex>{'\\delta_n=w_n-a'}</Tex>，與 §0 的 <Tex>{'\\delta=a-w'}</Tex> 相反。遞迴 <Tex>{'\\delta_{n+1}=(1-\\mu x^2)\\delta_n'}</Tex>{' '}
        是線性齊次的，兩種極性都成立、pole 相同；但畫 <Tex>{'\\delta'}</Tex> 的曲線時正負會相反，所以本站一律用 <Tex>{'a-w'}</Tex>。
      </ErratumNote>

      <Prereq title={String.raw`pole（極點）與單位圓：為什麼 $|p|<1$ 就收斂`}>
        <p>
          對一階遞迴 <Tex>{'\\delta_{n+1}=p\\,\\delta_n'}</Tex>，猜一個「每步乘同一個數 <Tex>{'z'}</Tex>」的解 <Tex>{'\\delta_n=c\\,z^n'}</Tex>（<Tex>{'c\\ne0'}</Tex> 為常數）代進去：
        </p>
        <StepDerivation
          steps={[
            { tex: String.raw`c\,z^{n+1}=p\,c\,z^n`, why: '代入遞迴。' },
            {
              tex: String.raw`c\,z^n\,(z-p)=0\;\Rightarrow\;z=p`,
              why: (
                <>
                  非零解要求 <Tex>{'z-p=0'}</Tex>。這個 <Tex>{'z'}</Tex> 就叫 pole（特徵根）；高階系統有好幾個 pole，在 <ChRef ch="03">Ch03</ChRef>、<ChRef ch="08">Ch08</ChRef> 會用 Z transform 正式處理。
                </>
              ),
            },
            {
              tex: String.raw`|\delta_n|=|p|^n\,|\delta_0|\;\xrightarrow{n\to\infty}\;\begin{cases}0,&|p|<1\\|\delta_0|,&|p|=1\\\infty,&|p|>1\end{cases}`,
              why: (
                <>
                  等比數列的極限。<Tex>{'|z|<1'}</Tex> 的區域就是複數平面上的<strong>單位圓內部</strong>：pole 在單位圓內 <Tex>{'\\Leftrightarrow'}</Tex> 誤差衰減。
                </>
              ),
            },
          ]}
        />
        <p className="small">
          <Tex>{'p'}</Tex> 的正負號決定「怎麼」收斂：<Tex>{'p>0'}</Tex> 每步同號（單調），<Tex>{'p<0'}</Tex> 每步變號（在答案兩側來回跳），<Tex>{'p=0'}</Tex>{' '}
          一步就到（deadbeat）。
        </p>
      </Prereq>

      <p>
        <Tex>{`x=${X}`}</Tex> 時，把幾個 <Tex>{'\\mu'}</Tex> 代進去（由 <code>fixedXPole</code> / <code>classifyPole</code> 計算）：
      </p>
      <div className="table-wrap">
        <table className="ch00-num-table">
          <thead>
            <tr>
              <th className="num">
                <Tex>{'\\mu'}</Tex>
              </th>
              <th className="num">
                <Tex>{`p=1-${texNum(X * X)}\\mu`}</Tex>
              </th>
              <th>行為</th>
              <th className="num">
                <Tex>{'|\\delta|'}</Tex> 降到 1% 的步數
              </th>
            </tr>
          </thead>
          <tbody>
            {poles.map((r) => (
              <tr key={r.mu}>
                <td className="num">{num(r.mu)}</td>
                <td className="num">{num(r.p)}</td>
                <td>
                  <MathText>{POLE_BEHAVIOUR_TEX[r.behaviour]}</MathText>
                </td>
                <td className="num">{Number.isFinite(r.n1pct) ? r.n1pct : '永不'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Observe>
        <Tex>{'\\mu'}</Tex> 太小（<Tex>{texNum(slow.mu)}</Tex>，<Tex>{`p=${texRes(slow.p)}`}</Tex>）很穩但慢；<Tex>{'\\mu'}</Tex> 越大越快，到{' '}
        <Tex>{`\\mu=1/x^2=${texNum(deadbeatMu)}`}</Tex> 一步到位；再大就開始「修過頭」來回震盪
        {osc && (
          <>
            （<Tex>{`${texNum(osc.mu)}`}</Tex>，<Tex>{`p=${texRes(osc.p)}`}</Tex>）
          </>
        )}
        ；超過 <Tex>{`2/x^2=${texNum(muMax)}`}</Tex> 就每一步越修越遠
        {div && (
          <>
            （<Tex>{`${texNum(div.mu)}`}</Tex>，<Tex>{`|p|=${texNum(Math.abs(div.p))}>1`}</Tex>）
          </>
        )}
        。<strong>穩定不代表不震盪，快也不代表好。</strong>
      </Observe>
      <ChapterHandCalc id="HC-00.2">
        換成你自己的 <Tex>{'x'}</Tex> 與 <Tex>{'\\mu'}</Tex>：先判斷它落在上表的哪一種行為（單調、一步到位、震盪、發散），再用紙筆算出穩定上限{' '}
        <Tex>{'\\mu_{\\max}=2/x^2'}</Tex>（F-00.5 的界）、<Tex>{'p'}</Tex> 與 <Tex>{'n'}</Tex> 步之後剩下的誤差，最後和網站比。
      </ChapterHandCalc>
      <p className="small">
        <ClaimTag kind="exact" /> 以上只在「固定 <Tex>{'x'}</Tex>、無雜訊」的模型成立。在 PLL 校正中，同樣的結構會變成{' '}
        <Tex>{'p=1-\\mu K_qC'}</Tex>（<PageLink id="ch05" />、<PageLink id="ch06" />）；有更新延遲時界限還會再縮小（<PageLink id="ch08" />）。
      </p>

      <ModeGate min="research">
        {randomBounds && (
          <div className="callout">
            <p>
              <strong>（Research）x 每一步隨機時，「穩定」有三種不同意思。</strong> 以 <Tex>{'x\\sim\\mathcal N(0,1)'}</Tex>（
              <Tex>{'E[x^2]=1,\\ E[x^4]=3'}</Tex>）為例：
            </p>
            <ul>
              <li>
                平均收斂（mean）：<Tex>{`0<\\mu<2/E[x^2]=${texNum(randomBounds.mean)}`}</Tex>，例如 <Tex>{'\\mu=0.5'}</Tex> 時平均 pole 為{' '}
                <Tex>{texNum(randomBounds.meanPoleAt)}</Tex>。
              </li>
              <li>
                均方收斂（mean-square）：<Tex>{`0<\\mu<2E[x^2]/E[x^4]=${texNum(randomBounds.ms, 6)}`}</Tex>。
              </li>
              <li>
                幾乎必然收斂（almost-sure，單一路徑）：<Tex>{`0<\\mu<${texNum(randomBounds.as, 5)}`}</Tex>（由 <code>gaussianAlmostSureMuMax</code>{' '}
                數值積分求得）。
              </li>
            </ul>
            <p className="small">
              三個界限不一樣：在 <Tex>{`${texNum(randomBounds.ms, 4)}<\\mu<${texNum(randomBounds.as, 4)}`}</Tex> 之間，畫出來的單一路徑看起來收斂，
              <Tex>{'E[\\delta^2]'}</Tex> 卻發散（<ErratumRef eid="E14" />）。詳細推導與 Monte Carlo 見 <PageLink id="ch03" />。<ClaimTag kind="exact" />（在 iid 模型下）
            </p>
          </div>
        )}
      </ModeGate>
    </Section>
  )
}
