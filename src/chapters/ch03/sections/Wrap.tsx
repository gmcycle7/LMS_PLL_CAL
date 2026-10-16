import { useMemo } from 'react'
import { Quiz, Recap, Section, Tex, TexBlock, ChRef } from '@/components'
import { fixedXPole, meanSquareFactor } from '@/simulation/models/lms'
import { normInv } from '@/simulation/core'
import {
  analyticTrajectory,
  cltConvergedFraction,
  cltStepsBelowStart,
  logFactorVariance,
  stabilityBounds,
  stabilityFactors,
  xMoments,
  type XDist,
} from '@/simulation/models/scalarStability'
import { Fig, HC, T, tnum, tx } from '../common'
import { CHART_SYNTHESIS_FLOW } from '../diagrams'

const SPARSE: XDist = { kind: 'list', values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 3] }
const UNIF: XDist = { kind: 'uniform', halfWidth: Math.sqrt(3) }
const GAUSS: XDist = { kind: 'gaussian', sigma: 1 }

/** 章末、思考題之前的綜合手算（HC-03.8）：把整章的公式串成一次 sign-off 檢查 */
export function SynthesisSection() {
  return (
    <>
      <h2 id="synthesis">綜合手算：把整章的公式串起來</h2>
      <Section kind="example" title="做思考題之前，先完整算一次">
        <p>
          {tx`這一題把本章的公式串成一次 sign-off 檢查：由 code 的 $\sigma$ 算出 $P_x$、$M_4$ 與三個界限，再看你想用的 $\mu$ 在 mean、mean-square、almost-sure 三種意義下各落在哪一區，最後看 GMAC 平均 $N$ 筆之後界限放寬多少。全部只需要四則運算（$2.4212$ 這個常數直接代入）。`}
        </p>
        <Fig
          chart={CHART_SYNTHESIS_FLOW}
          caption={T`綜合手算（HC-03.8）的計算順序 ①–⑤；⑤ 的三個出口（綠／褐／紅）對應 sign-off 的三種結論。`}
          ariaLabel="計算順序：先算動差 P x 與 M 4；由它們算三個界限、你的 mu 的 mean 因子與 g、以及 GMAC 平均 N 筆後的 mean-square 界；最後判斷 mu 落在哪一區"
        />
        <p>
          {tx`照圖上的 ① 到 ⑤ 做：先算 ① 的 $P_x$、$M_4$（只看 code），②③④ 都由它們算出——② 三個界限、③ 代入你的 $\mu$ 的兩個因子、④ GMAC 平均 $N$ 筆之後的界限（$E[S^2]$ 是 block 平均 $S=\tfrac1N\sum x_i^2$ 的二階動差，取代原本的 $M_4$）；最後 ⑤ 把 $\mu$ 和 ② 的界限比，三個出口就是三種 sign-off 結論。圖上的 ① 對應下面帶入過程的第 1–3 行、② 對應第 4–6 行、③ 對應第 7–10 行、④ 對應第 11–13 行，⑤ 對應最後的結論文字。Gaussian 時三個界限的大小順序固定是 $\mu_\text{MS}<\mu_\text{mean}<\mu_\text{as}$；落在 $\mu_\text{mean}$ 與 $\mu_\text{as}$ 之間時連 $E[\delta_n]$ 也不收斂。`}
        </p>
        <HC id="HC-03.8">
          {tx`把 $\sigma$、$\mu$、$N$ 換成你自己設計的數字，先在紙上把每一步算完，再和網站逐步對照；也可以按「換一題」讓網站隨機出數字。`}
        </HC>
        <p className="small muted">
          全站的手算題彙整在<a href="#/workbook">「手算練習簿」頁</a>，可以隨機出題、列印練習卷；本章共 8 題（HC-03.1–HC-03.8），分別緊跟在對應的推導後面。
        </p>
      </Section>
    </>
  )
}

export function QuizSection() {
  const v = useMemo(() => {
    const p04 = fixedXPole(0.4, 2)
    const ub = stabilityBounds(UNIF)
    const um = xMoments(UNIF)
    const g1 = stabilityFactors(1, GAUSS)
    const sp = stabilityFactors(0.5, SPARSE)
    const spm = xMoments(SPARSE)
    const tr = analyticTrajectory({ mu: 0.1, dist: { kind: 'fixed', value: 2 }, delta0: 0, noiseSigma: 1 }, [0])
    // 思考題 7：Gaussian μ = 2.3 的 λ、s 與 CLT 預測
    const lam23 = stabilityFactors(2.3, GAUSS).lambda
    const sd23 = Math.sqrt(logFactorVariance(2.3, GAUSS))
    const z90 = normInv(0.9)
    const n90 = cltStepsBelowStart(lam23, sd23, 0.9)
    const frac200 = cltConvergedFraction(lam23, sd23, 200, 1e-3)
    return { p04, ub, um, g1, sp, spm, tr, lam23, sd23, z90, n90, frac200 }
  }, [])
  return (
    <>
      <h2 id="quiz">思考題</h2>
      <Quiz
        title={T`思考題 1（固定 $x$）`}
        question={
          <>
            <Tex>{T`x=2,\ \mu=0.4,\ \delta_0=2`}</Tex>（無雜訊）。誤差 <Tex>{T`\delta_n`}</Tex> 會怎樣？
          </>
        }
        options={[{ label: '單調收斂' }, { label: '正負交替、震盪收斂', correct: true }, { label: '一步到位' }, { label: '發散' }]}
        answer={
          <>
            <TexBlock>{T`p=1-\mu x^2=1-0.4\cdot4=${tnum(v.p04)},\qquad |p|<1,\ p<0`}</TexBlock>
            <p>
              所以 <Tex>{T`\delta_n=2\cdot(${tnum(v.p04)})^n=${tnum(2)},\ ${tnum(2 * v.p04)},\ ${tnum(2 * v.p04 * v.p04)},\ \dots`}</Tex>：每步變號、大小乘{' '}
              <Tex>{T`|p|=${tnum(Math.abs(v.p04))}`}</Tex>。穩定不代表不震盪。
            </p>
          </>
        }
      />
      <Quiz
        title="思考題 2（計算）"
        question={
          <>
            <Tex>{T`x\sim U(-\sqrt3,\sqrt3)`}</Tex>（單位功率的 uniform code）。mean 界與 mean-square 界各是多少？
          </>
        }
        answer={
          <>
            <TexBlock>{T`P_x=\frac{c^2}{3}=1,\quad M_4=\frac{c^4}{5}=\frac95,\quad \mu_\text{mean}=\frac{2}{P_x}=${tnum(v.ub.meanMax)},\quad \mu_\text{MS}=\frac{2P_x}{M_4}=\frac{10}{9}\approx${tnum(v.ub.msMax)}`}</TexBlock>
            <p>
              兩者差 <Tex>{T`\kappa=M_4/P_x^2=${tnum(v.um.kurtosis)}`}</Tex> 倍。（almost-sure 界由 F-03.12 求根約 <Tex>{T`${tnum(v.ub.asMax, 5)}`}</Tex>。）
            </p>
          </>
        }
      />
      <Quiz
        title="思考題 3（三種收斂）"
        question={
          <>
            Gaussian <Tex>{T`x\sim\mathcal N(0,1)`}</Tex>、<Tex>{T`\mu=1`}</Tex>、無雜訊。哪個敘述正確？
          </>
        }
        options={[
          { label: tx`$E[\delta_1]=0$，所以每條路徑一步就歸零` },
          { label: tx`$E[\delta_n^2]$ 發散，但幾乎每條路徑都收斂`, correct: true },
          { label: '三種意義下都發散' },
          { label: '三種意義下都收斂' },
        ]}
        answer={
          <>
            <TexBlock>{T`1-\mu P_x=${tnum(v.g1.meanPole)},\qquad g(1)=1-2+3=${tnum(v.g1.g)}>1,\qquad \lambda(1)=${tnum(v.g1.lambda, 5)}<0`}</TexBlock>
            <p>
              mean 一步歸零只是「平均」為 0（正負抵消），每條路徑的 <Tex>{T`\delta_1=(1-x_0^2)\delta_0`}</Tex> 幾乎都不是 0；MSD 每步乘{' '}
              <Tex>{T`g=${tnum(v.g1.g)}`}</Tex>（加倍）；典型路徑每步乘 <Tex>{T`e^{\lambda}\approx${tnum(Math.exp(v.g1.lambda), 4)}`}</Tex>。
            </p>
          </>
        }
      />
      <Quiz
        title="思考題 4（稀疏 code）"
        question={
          <>
            <Tex>x</Tex> 從 <Tex>{T`\{0,0,0,0,0,0,0,0,0,3\}`}</Tex> 等機率抽（iid），<Tex>{T`\mu=0.5`}</Tex>。哪個敘述正確？
          </>
        }
        options={[
          { label: 'mean 與路徑都收斂' },
          { label: 'mean 收斂，但幾乎每條路徑發散', correct: true },
          { label: 'mean 發散，路徑收斂' },
          { label: 'mean-square 收斂' },
        ]}
        answer={
          <>
            <TexBlock>{T`P_x=${tnum(v.spm.Px)},\ \ 1-\mu P_x=${tnum(v.sp.meanPole)};\qquad \lambda=\tfrac{1}{10}\ln|1-0.5\cdot9|=\tfrac{1}{10}\ln3.5=${tnum(v.sp.lambda, 4)}>0;\qquad g=${tnum(v.sp.g, 4)}`}</TexBlock>
            <p>
              每抽到一次 3，誤差就乘上 <Tex>{T`1-0.5\cdot9=-3.5`}</Tex>；抽到 0 時乘 1（不變）。<Tex>{T`\delta_n=(-3.5)^{K}\delta_0`}</Tex>，<Tex>K</Tex> 是前{' '}
              <Tex>n</Tex> 步抽到 3 的次數，所以 <Tex>{T`E[\delta_n]=(0.9+0.1\cdot(-3.5))^n\delta_0=${tnum(v.sp.meanPole)}^n\delta_0`}</Tex>：平均之所以收斂，是因為 <Tex>K</Tex> 的奇偶讓正負號互相抵消；而{' '}
              <Tex>{T`|\delta_n|=3.5^K|\delta_0|\to\infty`}</Tex>。<strong>mean 穩定不保證路徑收斂</strong>（mean 與 a.s. 沒有一般的大小順序）。
            </p>
          </>
        }
      />
      <Quiz
        title="思考題 5（雜訊、MSD 與 MSE）"
        question={
          <>
            固定 <Tex>{T`x=2`}</Tex>、<Tex>{T`\mu=0.1`}</Tex>、量測雜訊 <Tex>{T`\sigma_v=1`}</Tex>。穩態的 <Tex>{T`\operatorname{Var}(w)`}</Tex>（= MSD）與 MSE <Tex>{T`E[e^2]`}</Tex> 各是多少？
          </>
        }
        answer={
          <>
            <TexBlock>{T`\text{MSD}_\infty=\frac{\mu\sigma_v^2}{2-\mu x^2}=\frac{0.1}{1.6}=${tnum(v.tr.msdInf)},\qquad E[e^2]=x^2\,\text{MSD}_\infty+\sigma_v^2=${tnum(v.tr.mseInf)}`}</TexBlock>
            <p>注意 MSD 與 MSE 差了 <Tex>{T`P_x=x^2`}</Tex> 倍再加上 <Tex>{T`\sigma_v^2`}</Tex>（勘誤 E42）。</p>
          </>
        }
      />
      <Quiz
        title="思考題 6（驗證方法）"
        question={tx`同事用 20 個 seed 跑 $\mu=0.8$ 的 Gaussian LMS，把 $\delta_n^2$ 平均後畫出來是往下的，說「$2/3$ 這個界太保守」。哪裡錯了？`}
        answer={
          <>
            <p>
              他量到的是<strong>典型路徑</strong>（almost-sure，<Tex>{T`\lambda(0.8)<0`}</Tex>），不是 <Tex>{T`E[\delta^2]`}</Tex>。<Tex>{T`\delta_n^2`}</Tex> 是 heavy tail：20 條路徑幾乎不可能抽到主導期望值的稀有大值，
              樣本平均與樣本 SE 都嚴重偏低。正確的驗證是封閉式 <Tex>{T`g(0.8)=${tnum(meanSquareFactor(0.8, 1, 3))}>1`}</Tex>，或單步 Monte Carlo 估計 <Tex>{T`E[(1-\mu x^2)^2]`}</Tex>（勘誤 E14）。
              兩個說法並不矛盾：路徑會收斂，但有雜訊時穩態 RMS 是無限大，不能拿來做 RMS 預算。
            </p>
          </>
        }
      />
      <Quiz
        title="思考題 7（CLT 預測：要等多久？）"
        question={
          <>
            Gaussian、<Tex>{T`\mu=2.3`}</Tex>、無雜訊：<Tex>{T`\lambda=${tnum(v.lam23, 4)}`}</Tex>、<Tex>{T`s=${tnum(v.sd23, 4)}`}</Tex>（由程式計算）。(a) 跑 200 步後，大約多少比例的路徑滿足{' '}
            <Tex>{T`|\delta_{200}|<10^{-3}|\delta_0|`}</Tex>？(b) 大約要幾步，才有九成的路徑低於起點（<Tex>{T`|\delta_n|<|\delta_0|`}</Tex>）？
          </>
        }
        answer={
          <>
            <TexBlock>{T`\text{(a)}\quad \Phi\!\Big(\frac{\ln10^{-3}-200\lambda}{s\sqrt{200}}\Big)=\Phi\!\Big(\frac{${tnum(Math.log(1e-3), 4)}-(${tnum(200 * v.lam23, 4)})}{${tnum(v.sd23 * Math.sqrt(200), 4)}}\Big)=\Phi(${tnum((Math.log(1e-3) - 200 * v.lam23) / (v.sd23 * Math.sqrt(200)), 3)})\approx${tnum(100 * v.frac200, 3)}\%`}</TexBlock>
            <TexBlock>{T`\text{(b)}\quad n\lambda+z_{0.9}\,s\sqrt n<0\iff n>\Big(\frac{z_{0.9}\,s}{\lambda}\Big)^2=\Big(\frac{${tnum(v.z90, 5)}\times${tnum(v.sd23, 4)}}{${tnum(Math.abs(v.lam23), 4)}}\Big)^2\approx${tnum(Math.ceil(v.n90), 5)}\ \text{步}`}</TexBlock>
            <p>
              <Tex>{T`\lambda<0`}</Tex> 保證「最後會收斂」，但 <Tex>{T`|\lambda|`}</Tex> 很小而 <Tex>s</Tex> 很大時，200 步只有一半左右的路徑明顯變小，要上千步才有九成的路徑低於起點。
              這是 CLT 近似（F-03.18），Stability Lab 的 Monte Carlo 可以直接驗證（preset「Gaussian、<Tex>{T`\mu=2.3`}</Tex>」）。同時別忘了：這個 <Tex>\mu</Tex> 的 mean 與 MSD 都是發散的。
            </p>
          </>
        }
      />
    </>
  )
}

export function RecapSection() {
  const gb = useMemo(() => stabilityBounds(GAUSS), [])
  return (
    <Section kind="formula" title="本課必記">
      <Recap
        formulas={[
          { label: T`固定 $x$（T02）`, tex: T`\boxed{\delta_{n+1}=(1-\mu x^2)\,\delta_n,\quad 0<\mu<\frac{2}{x^2}}` },
          { label: T`Mean（iid $x$，精確）`, tex: T`\boxed{E[\delta_{n+1}]=(1-\mu P_x)E[\delta_n],\quad 0<\mu<\frac{2}{P_x}}` },
          { label: 'Mean-square / MSD（T03）', tex: T`\boxed{E[\delta_{n+1}^2]=g\,E[\delta_n^2],\ g=1-2\mu P_x+\mu^2M_4,\quad 0<\mu<\frac{2P_x}{M_4}=\frac{\mu_\text{mean}}{\kappa}}` },
          { label: 'Almost-sure（勘誤 E14）', tex: T`\boxed{\lambda=E\ln|1-\mu x^2|<0,\quad \lambda\le\tfrac12\ln g;\quad \mathcal N(0,1):\ \mu_\text{as}=${tnum(gb.asMax, 5)}}` },
          { label: '有雜訊（勘誤 E42）', tex: T`\boxed{\text{MSD}_\infty=\frac{\mu P_x\sigma_v^2}{2P_x-\mu M_4},\quad E[e^2]=P_xE[\delta^2]+\sigma_v^2}` },
        ]}
        points={[
          tx`「收斂」有三種意義；同一個 $\mu$ 可以 mean 收斂、MSD 發散、而樣本路徑收斂（Gaussian $2/3<\mu<2$）。`,
          tx`iid 純量 $x$ 時 $x_n$ 與 $\delta_n$ 自動獨立，mean / MSD 遞迴是精確式；regressor 有時間相關時才是近似（勘誤 E38）。`,
          tx`MS $\Rightarrow$ mean、MS $\Rightarrow$ a.s.（Jensen）；mean 與 a.s. 沒有一般順序（Gaussian 與稀疏 code 方向相反）。`,
          tx`$\delta_n^2$ 是 heavy tail：不要用樣本平均 + 樣本 SE 驗證 MS 界，改用封閉式或單步 Monte Carlo（勘誤 E14）。`,
          tx`kurtosis $\kappa=M_4/P_x^2$ 決定 mean 與 MS 界差幾倍：$\pm1$ code 三界相同；GMAC 平均 $N$ 筆讓 MS 界趨近 mean 界。`,
          tx`典型路徑以 $e^{n\lambda}$ 縮小、分位帶寬度 $\propto s\sqrt n$：$|\lambda|$ 小時「會收斂」不等於「等得到」（CLT 預測 F-03.18）。`,
        ]}
      />
      <p className="small muted">
        下一個值得研究的問題：comparator 只給 1 bit（Sign-LMS）時，<Tex>{T`1-\mu x^2`}</Tex> 變成什麼？（<ChRef ch="05">第 5 章</ChRef>的 <Tex>{T`K_q`}</Tex>）；regressor 經過 PLL error path{' '}
        <Tex>{T`u=h*x`}</Tex> 後，<Tex>{T`P_x`}</Tex> 要換成什麼？（第 6–7 章的相關 <Tex>C</Tex>，可能是負的。）
      </p>
    </Section>
  )
}
