import { memo, useMemo, type ReactNode } from 'react'
import { ClaimTag, Tex, TexBlock } from '@/components'
import { useSettings } from '@/app/settings'
import { QUESTIONS } from '../data'
import { computePreviews, type Previews } from '../previews'
import { ConditionChip, ErratumLink, Glue, PageChip, Rich } from '../ui'

const f = (x: number, d = 6) => Number(x.toPrecision(d)).toString()

/** 每題的「一段話答案」：公式 + 由程式算出的數字 + 結論標籤；完整推導在對應章節。 */
function answer(n: number, P: Previews): ReactNode {
  switch (n) {
    case 1:
      return (
        <>
          <p>
            LMS = <strong>L</strong>east <strong>M</strong>ean <strong>S</strong>quares：要最小化的是平均平方誤差{' '}
            <Tex>{'J(w)=E[(y-wx)^2]'}</Tex>。平方可微、對大誤差懲罰重、最佳解是<strong>平均</strong>；絕對值的最佳解是<strong>中位數</strong>。
            例：對 <Tex>{'y=[0,0,0,10]'}</Tex> 估一個常數，MSE 給 <Tex>{`${f(P.q1.mse)}`}</Tex>、MAE 給 <Tex>{`${f(P.q1.maeLow)}`}</Tex>。
          </p>
          <ClaimTag kind="exact" />
        </>
      )
    case 2:
      return (
        <>
          <StepLine tex={String.raw`\frac{\partial}{\partial w}\Big(\tfrac12e^2\Big)=e\,\frac{\partial e}{\partial w}=e\cdot(-x)=-e\,x\;\Rightarrow\;w\leftarrow w+\mu\,e\,x`} />
          <p>
            沿負梯度走一步就是 <Tex>{'+\\mu ex'}</Tex>。GMAC 的 <Tex>{'\\sum q\\,x'}</Tex> 是它的 1-bit 版本：
            <Tex>{'E[q\\,x]\\approx K_q\\,E[e\\,x]'}</Tex>，方向相同、大小差 <Tex>{'K_q'}</Tex>。
          </p>
          <ClaimTag kind="exact" /> <ClaimTag kind="approx" />
        </>
      )
    case 3:
      return (
        <>
          <p>
            每一筆只多了一點點偏向：<Tex>{`P(q=+1)=\\Phi(s/\\sigma_v)=\\Phi(${f(P.comparator.s / P.comparator.sigmaV)})=${f(P.comparator.pPlus)}`}</Tex>，
            <Tex>{`E[q]=\\mathrm{erf}\\big(s/(\\sqrt2\\sigma_v)\\big)=${f(P.comparator.meanQ)}`}</Tex>。累加 <Tex>{'N'}</Tex> 筆，訊號{' '}
            <Tex>{'\\propto N'}</Tex>、雜訊 <Tex>{'\\propto\\sqrt N'}</Tex>，所以資訊以 <Tex>{'\\sqrt N'}</Tex> 浮現；小訊號增益{' '}
            <Tex>{`K_q=\\sqrt{2/\\pi}/\\sigma_v=${f(P.comparator.Kq)}\\,\\mathrm{fs^{-1}}`}</Tex>。
          </p>
          <ClaimTag kind="exact" /> <span className="small muted">（Gaussian 雜訊模型）</span>
        </>
      )
    case 4:
      return (
        <>
          <StepLine tex={String.raw`P(G_N>0)\approx\Phi\!\Big(\frac{m\sqrt N}{\sqrt{1-m^2}}\Big)\ \Rightarrow\ N_{95}\approx\Big(\frac{z_{0.95}\sqrt{1-m^2}}{m}\Big)^2=${f(P.n95.nClt95, 7)}`} />
          <p>
            CLT 近似 <ClaimTag kind="approx" />；精確 binomial（取奇數 <Tex>{'N'}</Tex>，沒有平手）最小為 <Tex>{`N=${P.n95.nOdd95}`}</Tex>{' '}
            <ClaimTag kind="exact" />。偶數 <Tex>{'N'}</Tex> 會出現 <Tex>{'G_N=0'}</Tex> 的平手，必須先定義 tie rule <ErratumLink eid="E02" />。
          </p>
        </>
      )
    case 5:
      return (
        <>
          <p>
            固定 <Tex>{`x=${P.fixedX.x}`}</Tex> 時 <Tex>{'\\delta_{n+1}=(1-\\mu x^2)\\delta_n'}</Tex>：<Tex>{`0<\\mu<${f(P.fixedX.muOneStep)}`}</Tex> 單調收斂、
            <Tex>{`\\mu=${f(P.fixedX.muOneStep)}`}</Tex> 一步到位、<Tex>{`${f(P.fixedX.muOneStep)}<\\mu<${f(P.fixedX.muMax)}`}</Tex> 震盪收斂、
            <Tex>{`\\mu=${f(P.fixedX.muMax)}`}</Tex> 臨界（<Tex>{'p=-1'}</Tex>）、更大就發散。加上 block 延遲後臨界增益再縮小（Ch08）。
          </p>
          <ClaimTag kind="exact" />
        </>
      )
    case 6:
      return (
        <>
          <p>
            Gaussian <Tex>{'x'}</Tex>（<Tex>{'E[x^2]=1,\\ E[x^4]=3'}</Tex>）：平均 <Tex>{'E[\\delta]'}</Tex> 收斂要 <Tex>{`0<\\mu<${f(P.meanSquare.meanMuMax)}`}</Tex>；
            均方 <Tex>{'E[\\delta^2]'}</Tex> 收斂要 <Tex>{`0<\\mu<2E[x^2]/E[x^4]=${f(P.meanSquare.msMuMax, 4)}`}</Tex>；而樣本路徑幾乎必然收斂的上限約{' '}
            <Tex>{`${f(P.meanSquare.asMuMax, 5)}`}</Tex>。三種「穩定」是三件不同的事 <ErratumLink eid="E14" />。
          </p>
          <ClaimTag kind="exact" />
        </>
      )
    case 7:
      return (
        <>
          <p>
            LMS 看的是 code 與殘差的<strong>相關</strong>：<Tex>{'C=\\tfrac{A^2}{2}|H|\\cos\\phi'}</Tex>。PLL error transfer 在 code 頻率的相位{' '}
            <Tex>{'\\phi=120^\\circ'}</Tex>（<Tex>{'A=1'}</Tex>）時 <Tex>{`C=${f(P.t06.C)}`}</Tex>，正的 <Tex>{'\\mu=10\\,\\mathrm{fs}'}</Tex> 給出{' '}
            <Tex>{`p=1-\\mu K_qC=${f(P.t06.pole)}>1`}</Tex>——主 PLL 再穩也沒用。
          </p>
          <ClaimTag kind="exact" />
        </>
      )
    case 8:
      return (
        <>
          <p>
            Delay 只能加上與頻率成正比的相位 <Tex>{'\\Omega D'}</Tex>：<Tex>{'C_D=\\tfrac{A^2}{2}|H|\\cos(\\phi+\\Omega D)'}</Tex>。
            <Tex>{'\\phi=-120^\\circ,\\ \\Omega=\\pi/6,\\ D=4'}</Tex> 得 <Tex>{`\\theta=${f(P.t07.thetaDeg)}^\\circ,\\ C_D=${f(P.t07.C)}`}</Tex>（最大）。
            寬頻 code 的每個頻率需要不同的補償，這時要用 filtered-x：先把 code 經過路徑模型 <Tex>{'\\hat h'}</Tex> 再相關。
          </p>
          <ClaimTag kind="exact" /> <span className="small muted">（單頻）</span>
        </>
      )
    case 9:
      return (
        <>
          <p>
            Polarity margin <Tex>{'M_{\\mathrm{pol}}=\\arcsin(\\cos\\theta)'}</Tex> 只回答「平均更新方向對不對」（靜態、單頻）；真正的 calibration PM 來自{' '}
            <Glue>
              <Tex>{'L(z)=g\\,z^{-d}/(z-1)'}</Tex>：
            </Glue>
            <Tex>{'\\mathrm{PM}=90^\\circ-(2d+1)\\arcsin(g/2)'}</Tex>，例如 <Tex>{`g=${P.pm.g}`}</Tex> 時{' '}
            <Tex>{`\\mathrm{PM}=${f(P.pm.pmDeg, 4)}^\\circ`}</Tex>。<Tex>{'M_{\\mathrm{pol}}=90^\\circ'}</Tex> 而 PM 很小、或反過來，都可能發生 <ErratumLink eid="E20" />。
          </p>
          <ClaimTag kind="exact" />
        </>
      )
    case 10:
      return (
        <>
          <StepLine tex={String.raw`z^2-(1+r)z+r+\mu bc=0,\qquad r=${P.dual.r},\ b=${P.dual.b},\ c=${P.dual.c},\ \mu=${P.dual.mu}\ \Rightarrow\ |z|=${f(P.dual.absZ)}>1`} />
          <p>
            這是 Ch08 §8.4 <strong>二狀態模型</strong>的特徵方程（主 PLL 的觀測是一階狀態，誤差晚一個 block 才被 GMAC 看到）。時間尺度分離（quasi-static）給{' '}
            <Tex>{`0<\\mu<2(1-r)/(bc)=${f(P.dual.muMaxSimplified)}`}</Tex>，這個模型的完整界限只有 <Tex>{`0<\\mu<(1-r)/(bc)=${f(P.dual.muMaxFull)}`}</Tex>：差的那一半來自
            sample→observe 的一個 block latency；觀測路徑不同的雙迴路，比例不一定是一半。只有 <Tex>{'\\mu bc\\ll(1-r)^2/4'}</Tex> 時才能分開分析{' '}
            <ErratumLink eid="E19" />。
          </p>
          <ClaimTag kind="exact" />{' '}
          <span className="small muted">
            （Ch08 二狀態模型，
            <Glue>
              <Tex>{'|r|<1'}</Tex>、
            </Glue>
            <Glue>
              <Tex>{'bc>0'}</Tex>）
            </Glue>
          </span>
        </>
      )
    case 11:
      return (
        <>
          <p>
            GMAC 停在 <Tex>{'E[G]=0'}</Tex>，也就是 <Tex>{'w^*=a+B/C'}</Tex>，不是 <Tex>{'w=a'}</Tex>。三階 INL 例（
            <Tex>{'x\\in\\{-2,\\dots,2\\},\\ a=1,\\ c_3=0.1'}</Tex>）：MSE-LMS 停在 <Tex>{`1+c_3E[x^4]/E[x^2]=${f(P.inl.wMse)}`}</Tex>，無雜訊 Sign-LMS 則在{' '}
            <Tex>{'|x|'}</Tex> 加權中位數 <Tex>{`${f(P.inl.wSign0)}`}</Tex> 的兩側來回跳（<Tex>{'E[G]'}</Tex> 在那裡由正變負，不是等於 0）——兩者的 GMAC 時間平均都是 0，但殘差{' '}
            <Tex>{'(a-w^*)x+c_3x^3'}</Tex> 仍在，仍會產生 spur{' '}
            <ErratumLink eid="E01" /> <ErratumLink eid="E03" />。
          </p>
          <ClaimTag kind="exact" />
        </>
      )
    case 12:
      return (
        <>
          <p>
            PE：存在一個窗口長度 <Tex>{'N_0'}</Tex>，使得<strong>每一個</strong>長度 <Tex>{'N_0'}</Tex> 的窗口內，有效 regressor 的相關矩陣都滿足{' '}
            <Tex>{'\\lambda_{\\min}\\ge\\alpha_{\\mathrm{PE}}>0'}</Tex>（不是只有長期平均）。<Tex>{`\\rho=${P.pe.rho}`}</Tex> 時{' '}
            <Tex>{`\\lambda=${f(P.pe.lamMax)},\\ ${f(P.pe.lamMin)}`}</Tex>、<Tex>{`\\kappa=${f(P.pe.kappa)}`}</Tex>；一般 LMS（<Tex>{'\\mu K_q=0.5'}</Tex>）的慢 pole{' '}
            <Tex>{`${f(P.pe.slowPole)}`}</Tex>，衰減 95% 要 <Tex>{`${P.pe.slowBlocks}`}</Tex> blocks。
          </p>
          <ClaimTag kind="exact" />
        </>
      )
    case 13:
      return (
        <>
          <p>
            <Tex>{'\\mathbf M=0.5\\,\\mathbf R^{-1}'}</Tex>（<Tex>{'K_q'}</Tex> 正規化為 1）讓所有 pole 變成 <Tex>{`${f(P.precond.pole)}`}</Tex>，
            <Tex>{`${P.precond.blocks}`}</Tex> blocks 就收斂；但 <Tex>{'\\mathbf R^{-1}'}</Tex> 在弱方向的增益是 <Tex>{'1/\\lambda_{\\min}'}</Tex>，
            雜訊 RMS 比強方向大 <Tex>{`\\sqrt{\\kappa}=${f(P.precond.noiseAmp, 4)}`}</Tex> 倍 <ErratumLink eid="E05" /> <ErratumLink eid="E21" />。
          </p>
          <ClaimTag kind="approx" />
        </>
      )
    case 14:
      return (
        <>
          <StepLine tex={String.raw`\delta t[n]=x[n]\,\delta w[n],\qquad \sigma_w=\sqrt{\frac{\mu^2\sigma_\eta^2}{1-p^2}}=${f(P.noise.sigmaW, 4)}\ \mathrm{fs}`} />
          <p>
            乘法會把頻譜「搬家」：低頻的係數雜訊乘上寬頻 DSM code，變成寬頻 timing error；再經 output transfer <Tex>{'T'}</Tex> 才是 PN。
            0.5 fs peak 的 code-correlated tone 在 13 GHz 輸出約 <Tex>{`${f(P.noise.spur, 4)}\\,\\mathrm{dBc}`}</Tex>（<Tex>{'|T|=1'}</Tex>）。
            <Tex>{'\\sigma_w'}</Tex> 是 gain-equivalent，不能直接叫 output jitter（規格 §12.1）。頻寬要分清 <Tex>{'-3\\,\\mathrm{dB}'}</Tex> 與 ENBW{' '}
            <ErratumLink eid="E06" />；block rate 的 <Tex>{'\\delta w_k'}</Tex> 要先以 ZOH 展開到 sample rate 才能和 code 相乘 <ErratumLink eid="E09" />。
          </p>
          <ClaimTag kind="approx" />
        </>
      )
    case 15:
      return (
        <>
          <p>
            目標 <Tex>{`${P.quant.target}\\,\\mathrm{LSB}`}</Tex>：freeze 在 32 的誤差 <Tex>{`w-w^*=${f(P.quant.freezeErr, 3)}\\,\\mathrm{LSB}`}</Tex>，功率{' '}
            <Tex>{`${f(P.quant.freezePower, 3)}\\,\\mathrm{LSB^2}`}</Tex> 全在 DC；任何無偏的 32/33 兩階方案（toggle、stochastic、一階 <Tex>{'\\Delta\\Sigma'}</Tex>）總誤差功率都是{' '}
            <Tex>{`p(1-p)=${f(P.quant.twoLevelPower, 3)}\\,\\mathrm{LSB^2}`}</Tex>，差別只在<strong>功率落在哪個頻率</strong>。所以要用 PLL output transfer 與 spur
            規格去選，而不是只看 RMS <ErratumLink eid="E15" /> <ErratumLink eid="E49" />。
          </p>
          <ClaimTag kind="exact" />
        </>
      )
    default:
      return null
  }
}

function StepLine({ tex }: { tex: string }) {
  return <TexBlock>{tex}</TexBlock>
}

/** 規格附錄 E 的 15 個問題，每題連到回答它的章節，並附一段可展開的短答案 */
export const QuestionsSection = memo(function QuestionsSection() {
  const P = useMemo(() => computePreviews(), [])
  const { mode } = useSettings()
  return (
    <section id="dash-questions" aria-labelledby="dash-questions-h">
      <h2 id="dash-questions-h" className="dash-h2">
        網站要回答的 15 個問題 <span className="dash-h2-kicker">規格 附錄 E</span>
      </h2>
      <p className="dash-lead-sm">
        每一題都連到主要回答它的章節（實心標籤），以及它屬於六個條件中的哪幾個。展開「短答案」可以先看結論與關鍵數字——數字都由網站程式即時計算。
      </p>
      <ol className="dash-q-list">
        {QUESTIONS.map((q) => (
          <li key={q.n} id={`dash-q-${q.n}`} className="dash-q">
            <span className="dash-q-n" aria-hidden="true">
              {q.n}
            </span>
            <div>
              <div className="dash-q-text">
                <Rich text={q.text} />
              </div>
              <div className="dash-q-row">
                {q.pages.map((id, i) => (
                  <PageChip key={id} id={id} primary={i === 0} />
                ))}
                {q.conditions.map((c) => (
                  <ConditionChip key={c} id={c} />
                ))}
                <span className="small muted">{q.tests.join(' / ')}</span>
              </div>
            </div>
            <details key={`${q.n}-${mode}`} open={mode === 'research'}>
              <summary>短答案</summary>
              <div className="dash-q-answer">{answer(q.n, P)}</div>
            </details>
          </li>
        ))}
      </ol>
    </section>
  )
})
