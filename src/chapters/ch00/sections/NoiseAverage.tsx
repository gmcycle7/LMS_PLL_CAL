import { useMemo } from 'react'
import { ClaimTag, CodeBlock, Derivation, ModeGate, Prereq, Section, StepDerivation, Tex, TexBlock } from '@/components'
import { useSettings } from '@/app/settings'
import { Link } from 'react-router-dom'
import { presetById, presetHref } from '@/app/presets'
import { fixedXPole } from '@/simulation/models/lms'
import { STEADY_STATE_EXAMPLE, diceAverages, equivalentAveragingLength, steadyStateVarW, stepsToFraction } from '../model'
import { num, texNum } from '../format'
import { ChapterDiagram, ChapterHandCalc, ErratumRef, FigRef, Observe, PageLink } from '../common'
import { NoiseAverageLab } from '../experiments/NoiseAverageLab'
import modelSrc from '../model.ts?raw'
import playgroundSrc from '../experiments/playgroundModel.ts?raw'

const DICE_SEED = 20261010
/** 公平骰子：E[X] = 3.5、Var(X) = E[X²] − E[X]² = 91/6 − 49/4 = 35/12（由定義直接算） */
const DIE_FACES = [1, 2, 3, 4, 5, 6]
const DIE_MEAN = DIE_FACES.reduce((s, v) => s + v, 0) / 6
const DIE_STD = Math.sqrt(DIE_FACES.reduce((s, v) => s + v * v, 0) / 6 - DIE_MEAN * DIE_MEAN)
const SS_X = STEADY_STATE_EXAMPLE.x
const SS_SIGMA = STEADY_STATE_EXAMPLE.sigmaV
/** 「有雜訊」的 Playground preset（數值例與它同一組參數；測試會檢查兩者一致） */
const NOISY_PRESET = presetById(STEADY_STATE_EXAMPLE.presetId)
/** 等效平均長度表用的 μ（x = 2）：很小、小、手算例、一步到位（p = 0）、震盪收斂（p < 0） */
const NEQ_MUS = [0.01, 0.05, 0.1, 0.25, 0.4]

/** §0.7 為什麼雜訊會被平均掉？ */
export function NoiseAverageSection() {
  const { atLeast } = useSettings()
  const dice = useMemo(() => diceAverages(DICE_SEED, [10, 100, 1000, 10000]), [])
  // 固定 x = 2、σ_v = 0.5 的穩態 std(w)（F-00.9），給幾個 μ 的數值例
  const ssExamples = useMemo(() => STEADY_STATE_EXAMPLE.mus.map((mu) => ({ mu, sd: Math.sqrt(steadyStateVarW(mu, SS_X, SS_SIGMA)) })), [])
  // 等效平均長度 N_eq = (1 + p)/(1 − p)：穩態抖動相當於直接平均了幾筆（含 p = 0 與 p < 0 的例子）
  const neqRows = useMemo(
    () =>
      NEQ_MUS.map((mu) => {
        const p = fixedXPole(mu, SS_X)
        const neq = equivalentAveragingLength(mu, SS_X)
        return {
          mu,
          p,
          neq,
          sd: Math.sqrt(steadyStateVarW(mu, SS_X, SS_SIGMA)),
          sdFromNeq: SS_SIGMA / (Math.abs(SS_X) * Math.sqrt(neq)), // 直接平均 N_eq 筆的 std：應與左欄相同
          n1pct: stepsToFraction(p),
        }
      }),
    [],
  )

  return (
    <Section kind="intuition" level={2} id="ch00-noise" title="§0.7 有雜訊時為什麼還學得會？——雜訊會被平均掉">
      <p>
        回到含雜訊的黑盒子 <Tex>{'y=ax+v'}</Tex>。現在每一筆的誤差裡都混了雜訊，單筆的更新方向甚至可能是錯的。為什麼 LMS 最後還是會走到{' '}
        <Tex>{'a'}</Tex> 附近？答案是：<strong>雜訊時正時負，平均起來接近 0；真正的訊號每次都指向同一個方向，平均起來會留下來。</strong>
      </p>

      <Prereq title={String.raw`期望值 $E[\cdot]$：「做很多次取平均」會得到什麼`}>
        <p>
          <strong>期望值（expectation）</strong> <Tex>{'E[X]'}</Tex> 的白話意思：把同一個隨機實驗做非常多次，結果的平均值會趨近的那個數。擲一顆公平骰子，<Tex>{`E[X]=\\frac{1+2+3+4+5+6}{6}=${texNum(DIE_MEAN)}`}</Tex>，單次的標準差（下一個先備知識框會定義）是{' '}
          <Tex>{`\\sqrt{35/12}\\approx${texNum(DIE_STD, 4)}`}</Tex>。下表是用固定 seed 真的擲骰子的結果：
        </p>
        <div className="table-wrap">
          <table className="ch00-num-table">
            <thead>
              <tr>
                <th className="num">
                  擲幾次 <Tex>{'n'}</Tex>
                </th>
                <th className="num">平均</th>
                <th className="num">
                  與 <Tex>{texNum(DIE_MEAN)}</Tex> 的差
                </th>
                <th className="num">
                  理論 std <Tex>{`=${texNum(DIE_STD, 4)}/\\sqrt n`}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              {dice.map((d) => (
                <tr key={d.n}>
                  <td className="num">{d.n}</td>
                  <td className="num">{num(d.avg, 6)}</td>
                  <td className="num">{num(d.err, 3)}</td>
                  <td className="num">{num(d.theoryStd, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          寫成數學：離散時 <Tex>{'E[X]=\\sum_i x_i\\,P(X=x_i)'}</Tex>；連續時（有機率密度 <Tex>{'f(x)'}</Tex>）就是一個積分{' '}
          <Tex>{'E[X]=\\int_{-\\infty}^{\\infty}x\\,f(x)\\,dx'}</Tex>。
        </p>
        <p>只需要三個性質，全部來自「和／積分是線性的」：</p>
        <ol>
          <li>
            <strong>線性</strong>：<Tex>{'E[cX+dY]=c\\,E[X]+d\\,E[Y]'}</Tex>（<Tex>{'c,d'}</Tex> 是常數）。
          </li>
          <li>
            <strong>獨立就能拆開</strong>：若 <Tex>{'X,Y'}</Tex> 獨立（聯合密度 <Tex>{'f(x,y)=f_X(x)f_Y(y)'}</Tex>），則{' '}
            <Tex>{'E[XY]=\\iint xy\\,f_X(x)f_Y(y)\\,dx\\,dy=E[X]\\,E[Y]'}</Tex>（雙重積分拆成兩個單積分相乘）。
          </li>
          <li>
            <strong>相關（correlation）</strong>：<Tex>{'E[XY]'}</Tex> 稱為 <Tex>{'X'}</Tex> 與 <Tex>{'Y'}</Tex> 的相關。
            <Tex>{'E[XY]=E[X]E[Y]'}</Tex> 叫「不相關」（uncorrelated）；獨立 <Tex>{'\\Rightarrow'}</Tex> 不相關，反過來不一定成立（例：
            <Tex>{'X\\sim\\mathcal N(0,1),\\ Y=X^2'}</Tex> 不獨立，但 <Tex>{'E[XY]=E[X^3]=0=E[X]E[Y]'}</Tex>）。下面的推導其實只需要「不相關」。
          </li>
        </ol>
      </Prereq>

      <h3>平均的更新方向</h3>
      <p>
        LMS 每一步加到 <Tex>{'w'}</Tex> 上的是 <Tex>{'\\mu\\,e\\,x'}</Tex>，所以只要弄清楚 <Tex>{'e\\,x'}</Tex> 這個乘積「平均來說」指向哪裡。把含雜訊的誤差代進去，<Tex>{'e\\,x'}</Tex>{' '}
        會分成兩份：一份來自「<Tex>{'w'}</Tex> 還沒對」，一份來自雜訊。
      </p>
      <ChapterDiagram name="CHART_SIGNAL_VS_NOISE">
        <p>
          先看最左邊：有雜訊的誤差 <Tex>{'e=(a-w)x+v'}</Tex>（把 §0.1 <FigRef name="CHART_BLACKBOX_MODEL" /> 的兩條路相減、再把含 <Tex>{'x'}</Tex> 的項合併）和{' '}
          <Tex>{'x'}</Tex> 一起進乘法器，得到 <Tex>{'e\\,x'}</Tex>。再看乘法器之後分出的兩格（線上寫著 <Tex>{'e\\,x'}</Tex> 的第一項、第二項）：綠色的訊號部分 <Tex>{'(a-w)x^2'}</Tex>（<Tex>{'x^2\\ge0'}</Tex>，所以每一筆都和{' '}
          <Tex>{'a-w'}</Tex> 同號），以及紅色的雜訊部分 <Tex>{'v\\,x'}</Tex>（時正時負）。最後看兩條進「取平均」的線：綠色那一份平均之後還在，紅色那一份平均之後是 0。
        </p>
        <p>
          圖上的「<Tex>{'E[\\cdot]'}</Tex>」就是上面先備知識框介紹的期望值 <Tex>{'E[\\cdot]'}</Tex>；藍色那格「<Tex>{'E[e\\,x] = (a - w)\\,E[x^2] + 0'}</Tex>」就是 F-00.7，其中的{' '}
          <Tex>{'0'}</Tex> 是紅色那一份的平均 <Tex>{'E[v\\,x]'}</Tex>——它是 0 的條件寫在那條線上：<Tex>{'v'}</Tex> 的平均是 0，而且和 <Tex>{'x'}</Tex> 無關。
        </p>
      </ChapterDiagram>
      <div id="ch00-mean-steps">
        <StepDerivation
          title={
            <>
              固定 <Tex>{'w'}</Tex>，計算 <Tex>{'e\\,x'}</Tex> 的期望值
            </>
          }
          steps={[
            {
              tex: String.raw`y=ax+v`,
              why: (
                <>
                  黑盒子模型：<Tex>{'v'}</Tex> 是零均值雜訊，<Tex>{'E[v]=0'}</Tex>。
                </>
              ),
            },
            {
              tex: String.raw`e=y-wx=(a-w)\,x+v`,
              why: (
                <>
                  代入 <Tex>{'y'}</Tex>，把含 <Tex>{'x'}</Tex> 的項合併。
                </>
              ),
            },
            {
              tex: String.raw`e\,x=(a-w)\,x^2+v\,x`,
              why: (
                <>
                  兩邊乘上 <Tex>{'x'}</Tex>（LMS 的更新量正比於 <Tex>{'e\\,x'}</Tex>）。
                </>
              ),
            },
            {
              tex: String.raw`E[e\,x]=(a-w)\,E[x^2]+E[v\,x]`,
              why: (
                <>
                  取期望值並用線性；<Tex>{'w'}</Tex> 固定，所以 <Tex>{'(a-w)'}</Tex> 是常數，可以提出來。
                </>
              ),
            },
            { tex: String.raw`E[v\,x]=E[v]\,E[x]=0`, why: '雜訊與輸入獨立（至少不相關），且雜訊平均為 0。' },
          ]}
          result={String.raw`E[e\,x]=(a-w)\,E[x^2]`}
        />
      </div>
      <TexBlock
        id="F-00.7"
        label={
          <>
            平均更新方向：<Tex>{'E[x^2]>0'}</Tex>，所以平均更新永遠指向 <Tex>{'a'}</Tex>（<Tex>{'\\delta=a-w'}</Tex>，<ErratumRef eid="E39" />）
          </>
        }
      >
        {String.raw`E[e\,x]=(a-w)\,E[x^2]+\underbrace{E[v\,x]}_{=\,0}=\delta\,E[x^2]`}
      </TexBlock>
      <Observe>
        因為 <Tex>{'E[x^2]>0'}</Tex>（只要 <Tex>{'x'}</Tex> 不是永遠 0），平均更新量的正負號永遠和 <Tex>{'a-w'}</Tex> 相同：
        <Tex>{'w'}</Tex> 太小（<Tex>{'a-w>0'}</Tex>）平均往上推，<Tex>{'w'}</Tex> 太大平均往下拉，在 <Tex>{'w=a'}</Tex> 時平均更新為 0。<strong>雜訊不會改變平均方向，只會讓每一步抖動。</strong>
        這也正是 PLL 校正中 GMAC（multiply-accumulate 形式的相關累加器）在做的事：把很多筆 <Tex>{'e\\cdot x'}</Tex> 加起來，讓雜訊互相抵消。
      </Observe>
      <p className="small">
        <ClaimTag kind="exact" /> 在「<Tex>{'x_n,v_n'}</Tex> 與目前的 <Tex>{'w_n'}</Tex> 獨立（<Tex>{'x,v'}</Tex> 為 iid，<Tex>{'w_n'}</Tex>{' '}
        只由過去的樣本決定）」的模型下，
        <Tex>{'E[e_nx_n\\mid w_n]=(a-w_n)E[x^2]'}</Tex> 對每一步都精確成立。若雜訊和 x 相關（例如 code-correlated 干擾），
        <Tex>{'E[vx]\\ne0'}</Tex>，平均更新就會指向錯的位置——這就是 <PageLink id="ch11" /> 的 calibration bias。
      </p>

      <h3>
        平均會讓雜訊縮小多少？——<Tex>{'1/\\sqrt N'}</Tex> 法則
      </h3>
      <Prereq title={String.raw`變異數與 $1/\sqrt N$ 法則：為什麼平均 $N$ 筆，雜訊只降 $\sqrt N$ 倍`}>
        <p>
          <strong>變異數（variance）</strong> <Tex>{'\\operatorname{Var}(X)=E[(X-E[X])^2]'}</Tex>：與平均值差距平方的平均，衡量「抖多大」；它的平方根叫<strong>標準差</strong>（standard deviation, std）。兩個性質：
          <Tex>{'\\operatorname{Var}(cX)=c^2\\operatorname{Var}(X)'}</Tex>；<Tex>{'X,Y'}</Tex> 獨立時{' '}
          <Tex>{'\\operatorname{Var}(X+Y)=\\operatorname{Var}(X)+\\operatorname{Var}(Y)'}</Tex>（交叉項 <Tex>{'2E\\big[(X-E[X])(Y-E[Y])\\big]=2\\big(E[XY]-E[X]E[Y]\\big)'}</Tex>{' '}
          因獨立（其實只要不相關）而為 0）。
        </p>
        <StepDerivation
          steps={[
            {
              tex: String.raw`\bar Z_N=\frac1N\sum_{i=1}^{N}Z_i,\qquad \operatorname{Var}(Z_i)=s_1^2`,
              why: (
                <>
                  <Tex>{'N'}</Tex> 筆獨立、同分布（iid）的量取平均。
                </>
              ),
            },
            {
              tex: String.raw`\operatorname{Var}(\bar Z_N)=\frac1{N^2}\operatorname{Var}\Big(\sum_i Z_i\Big)`,
              why: (
                <>
                  常數 <Tex>{'1/N'}</Tex> 提出來要平方。
                </>
              ),
            },
            { tex: String.raw`=\frac1{N^2}\sum_i\operatorname{Var}(Z_i)=\frac{N s_1^2}{N^2}=\frac{s_1^2}{N}`, why: '獨立：和的變異數 = 變異數的和。' },
            { tex: String.raw`\operatorname{std}(\bar Z_N)=\frac{s_1}{\sqrt N}`, why: '開根號。' },
          ]}
        />
        <p>
          另一種看法：<strong>總和</strong>裡的訊號 <Tex>{'\\propto N'}</Tex>、雜訊 <Tex>{'\\propto\\sqrt N'}</Tex>，所以訊號雜訊比{' '}
          <Tex>{'\\propto\\sqrt N'}</Tex>。要把雜訊再降 10 倍，資料要多 100 倍。
        </p>
      </Prereq>
      <Prereq title={String.raw`高斯分布（Gaussian）、$\Phi$、CLT 與四次矩 $E[x^4]=3\sigma^4$`}>
        <p>
          <strong>高斯（常態）分布</strong> <Tex>{'x\\sim\\mathcal N(0,\\sigma^2)'}</Tex> 的密度是{' '}
          <Tex>{'f(x)=\\frac{1}{\\sqrt{2\\pi}\\sigma}e^{-x^2/(2\\sigma^2)}'}</Tex>，鐘形、對稱、平均 0、變異數 <Tex>{'\\sigma^2'}</Tex>。很多微小獨立干擾加總後都近似高斯（中央極限定理 CLT：<Tex>{'N'}</Tex> 筆 iid 的和，減去平均、除以標準差後，分布趨近{' '}
          <Tex>{'\\mathcal N(0,1)'}</Tex>）。它的累積分布函數（CDF）記為{' '}
          <Tex>{'\\Phi(z)=P(Z\\le z)=\\int_{-\\infty}^{z}\\tfrac{1}{\\sqrt{2\\pi}}e^{-t^2/2}\\,dt'}</Tex>（§0.9 會用到；沒有初等函數的封閉式，用數值計算）。下面用到它的四次矩，以 <Tex>{'\\sigma=1'}</Tex> 為例（用分部積分）：
        </p>
        <StepDerivation
          steps={[
            { tex: String.raw`\varphi(x)=\tfrac{1}{\sqrt{2\pi}}e^{-x^2/2},\qquad \varphi'(x)=-x\,\varphi(x)`, why: '標準常態密度；對指數微分用 chain rule。' },
            {
              tex: String.raw`E[x^4]=\int_{-\infty}^{\infty}x^3\cdot x\varphi(x)\,dx=\int x^3\,\big(-\varphi'(x)\big)\,dx`,
              why: (
                <>
                  把 <Tex>{'x^4\\varphi'}</Tex> 拆成 <Tex>{'x^3'}</Tex> 乘上 <Tex>{"x\\varphi=-\\varphi'"}</Tex>。
                </>
              ),
            },
            {
              tex: String.raw`=\Big[-x^3\varphi(x)\Big]_{-\infty}^{\infty}+\int 3x^2\varphi(x)\,dx`,
              why: (
                <>
                  分部積分 <Tex>{'\\int u\\,dv=uv-\\int v\\,du'}</Tex>，取 <Tex>{'u=x^3,\\ dv=-\\varphi\'(x)dx,\\ v=-\\varphi'}</Tex>。
                </>
              ),
            },
            {
              tex: String.raw`=0+3E[x^2]=3`,
              why: (
                <>
                  邊界項因 <Tex>{'e^{-x^2/2}'}</Tex> 衰減得比 <Tex>{'x^3'}</Tex> 成長快而為 0；<Tex>{'E[x^2]=1'}</Tex>。
                </>
              ),
            },
          ]}
        />
      </Prereq>

      <p>
        把這條法則用在更新量上：把 <Tex>{'N'}</Tex> 筆 <Tex>{'e_ix_i'}</Tex> 加起來再除以 <Tex>{'N'}</Tex>，記為 <Tex>{'\\bar G_N'}</Tex>（<Tex>{'G'}</Tex>{' '}
        上面一橫表示平均）。單獨一筆 <Tex>{'e\\,x'}</Tex> 的標準差記為 <Tex>{'s_1'}</Tex>（下標 1 表示「只有一筆」），雜訊 <Tex>{'v'}</Tex> 的標準差記為 <Tex>{'\\sigma_v'}</Tex>。
      </p>
      <ChapterDiagram name="CHART_NOISE_AVERAGING">
        <p>
          先看最左邊：每一筆 <Tex>{'e_ix_i'}</Tex> 的平均是 <Tex>{'(a-w)E[x^2]'}</Tex>（上一張圖的結論）、標準差是 <Tex>{'s_1'}</Tex>。再看藍色的兩格：先累加 <Tex>{'N'}</Tex>{' '}
          筆——總和裡訊號長成 <Tex>{'N'}</Tex> 倍，雜訊只長成 <Tex>{'\\sqrt N'}</Tex> 倍；再除以 <Tex>{'N'}</Tex>。最後看輸出的兩個性質：中心沒有動，抖動縮成{' '}
          <Tex>{'s_1/\\sqrt N'}</Tex>。
        </p>
        <p>
          圖上的「N 筆的平均」就是公式裡的 <Tex>{'\\bar G_N'}</Tex>；綠色那格「<Tex>{'s_1 / \\sqrt{N}'}</Tex>」就是下面的 F-00.8。這個「先累加、再除以 <Tex>{'N'}</Tex>」的方塊，到了 §0.9 會換個名字叫
          GMAC。
        </p>
      </ChapterDiagram>
      <TexBlock
        id="F-00.8"
        label={
          <>
            <Tex>{'N'}</Tex> 筆 <Tex>{'e\\,x'}</Tex> 平均的標準差；<Tex>{'s_1'}</Tex> 是單筆的標準差（推導見下方）
          </>
        }
      >
        {String.raw`\operatorname{std}\big(\bar G_N\big)=\frac{s_1}{\sqrt N},\quad \bar G_N=\frac1N\sum_{i=1}^Ne_ix_i,\quad s_1^2=(a-w)^2\big(E[x^4]-E[x^2]^2\big)+\sigma_v^2E[x^2]`}
      </TexBlock>
      <Derivation
        title={
          <>
            單筆 <Tex>{'e\\,x'}</Tex> 的變異數 <Tex>{'s_1^2'}</Tex>（決定要平均多少筆）
          </>
        }
        formulaId="F-00.8"
        level="L0"
        claim="exact"
        defaultOpen={atLeast('engineer')}
        derivation={
          <>
            <StepDerivation
              steps={[
                {
                  tex: String.raw`z=e\,x=\delta\,x^2+v\,x,\qquad \delta=a-w`,
                  why: (
                    <>
                      同上；<Tex>{'w'}</Tex> 固定，所以 <Tex>{'\\delta'}</Tex> 是常數。
                    </>
                  ),
                },
                {
                  tex: String.raw`\operatorname{Var}(z)=\operatorname{Var}(\delta x^2)+\operatorname{Var}(vx)+2\operatorname{Cov}(\delta x^2,\,vx)`,
                  why: '兩項和的變異數（一般式，含交叉項）。',
                },
                {
                  tex: String.raw`\operatorname{Cov}(\delta x^2,vx)=E[\delta x^3v]-E[\delta x^2]\,E[vx]=\delta\,E[x^3]E[v]-\delta E[x^2]\cdot E[v]E[x]=0`,
                  why: (
                    <>
                      <Tex>{'\\operatorname{Cov}(A,B)=E[AB]-E[A]E[B]'}</Tex>；<Tex>{'v'}</Tex> 與 <Tex>{'x'}</Tex> 獨立且 <Tex>{'E[v]=0'}</Tex>。
                    </>
                  ),
                },
                {
                  tex: String.raw`\operatorname{Var}(vx)=E[v^2x^2]-\big(E[vx]\big)^2=E[v^2]E[x^2]-0=\sigma_v^2E[x^2]`,
                  why: (
                    <>
                      獨立 <Tex>{'\\Rightarrow E[v^2x^2]=E[v^2]E[x^2]'}</Tex>；<Tex>{'E[v^2]=\\sigma_v^2'}</Tex>（因 <Tex>{'E[v]=0'}</Tex>）。
                    </>
                  ),
                },
                {
                  tex: String.raw`\operatorname{Var}(\delta x^2)=\delta^2\left(E[x^4]-E[x^2]^2\right)`,
                  why: (
                    <>
                      <Tex>{'\\operatorname{Var}(cX)=c^2\\operatorname{Var}(X)'}</Tex>，<Tex>{'\\operatorname{Var}(X)=E[X^2]-E[X]^2'}</Tex>，這裡{' '}
                      <Tex>{'X=x^2'}</Tex>。
                    </>
                  ),
                },
                {
                  tex: String.raw`s_1^2=\delta^2\left(E[x^4]-E[x^2]^2\right)+\sigma_v^2E[x^2]`,
                  why: (
                    <>
                      相加。Gaussian <Tex>{'x'}</Tex>：<Tex>{'E[x^4]-E[x^2]^2=3-1=2'}</Tex>；<Tex>{'\\pm1'}</Tex> 碼：<Tex>{'1-1=0'}</Tex>。
                    </>
                  ),
                },
              ]}
            />
            <CodeBlock source={modelSrc} region="productMoments" path="src/chapters/ch00/model.ts" />
          </>
        }
        assumptions={
          <ul>
            <li>
              <Tex>{'x,v'}</Tex> 各自 iid 且互相獨立
            </li>
            <li>
              <Tex>{'E[v]=0'}</Tex>
            </li>
            <li>
              <Tex>{'w'}</Tex> 在平均期間固定
            </li>
          </ul>
        }
      />

      <ChapterHandCalc id="HC-00.5">
        預設的數字就是下面那個 Monte Carlo 實驗的預設值。先用紙筆和計算機算出 <Tex>{'s_1'}</Tex>、<Tex>{'N=1024'}</Tex> 筆平均後的標準差，以及「要壓到{' '}
        <Tex>{'0.05'}</Tex> 至少要幾筆」，再往下看實驗指標表裡的 <Tex>{'s_1'}</Tex> 與理論 std 是不是同一個數；然後換成你自己的數字再算一次。
      </ChapterHandCalc>

      <h3>動手看：小型 Monte Carlo</h3>
      <NoiseAverageLab />

      <h3>
        LMS 一邊學一邊平均：<Tex>{'w'}</Tex> 最後會抖多大？
      </h3>
      <p>
        LMS 不會先平均再更新，而是每一筆都只更新一點點——<Tex>{'\\mu'}</Tex> 越小，等效上平均越多筆。固定 <Tex>{'x'}</Tex>、雜訊為 iid（每一筆互相獨立、分布相同）時，<Tex>{'w'}</Tex> 收斂後的抖動有精確公式。先看雜訊是從哪裡灌進迴圈的：
      </p>
      <ChapterDiagram name="CHART_STEADY_STATE_NOISE">
        <p>
          先看迴圈（暫存器 → 藍色的「<Tex>{'\\times\\,p'}</Tex>」→ 相加點 → 暫存器）：它就是 §0.6 的 <FigRef name="CHART_ERROR_RECURSION" />，只是把繞一圈的效果合成一格。再看紅色的入口：雜訊{' '}
          <Tex>{'v[n]'}</Tex> 乘上 <Tex>{'\\mu x'}</Tex> 之後以 <Tex>{'(-)'}</Tex> 進入相加點——因為雜訊讓 <Tex>{'e'}</Tex> 多了 <Tex>{'v'}</Tex>，<Tex>{'w'}</Tex> 就多修了{' '}
          <Tex>{'\\mu x v'}</Tex>，「還差多少」<Tex>{'\\delta'}</Tex> 也就少了這麼多。
        </p>
        <p>
          圖上相加點的兩個輸入合起來就是 <Tex>{'\\delta_{n+1}=p\\,\\delta_n-\\mu x\\,v_n'}</Tex>（Engineer 推導的第二行）；綠色那格就是下面的 F-00.9。<Tex>{'\\mu'}</Tex>{' '}
          在圖上出現兩次：入口的 <Tex>{'\\mu x'}</Tex> 決定每一筆雜訊灌進來多少，迴圈裡的 <Tex>{'p=1-\\mu x^2'}</Tex> 決定舊的雜訊多久才忘掉。<Tex>{'\\mu'}</Tex>{' '}
          小，灌進來的少（抖動小），但 <Tex>{'p'}</Tex> 靠近 1、忘得慢（收斂也慢）。
        </p>
      </ChapterDiagram>
      <TexBlock
        id="F-00.9"
        label={
          <>
            固定 <Tex>{'x'}</Tex>、加上白雜訊：<Tex>{'w'}</Tex> 的穩態變異數（需要 <Tex>{'|p|<1'}</Tex>，<Tex>{'p=1-\\mu x^2'}</Tex>）
          </>
        }
      >
        {String.raw`\begin{aligned}\operatorname{Var}(w_\infty)&=\frac{\mu^2x^2\sigma_v^2}{1-p^2}\\&=\frac{\mu\,\sigma_v^2}{2-\mu x^2}\end{aligned}`}
      </TexBlock>
      <p>
        先看數字：<Tex>{`x=${texNum(SS_X)},\\ \\sigma_v=${texNum(SS_SIGMA)}`}</Tex> 時，
        {ssExamples.map((s, i) => (
          <span key={s.mu}>
            <Tex>{`\\mu=${texNum(s.mu)}\\Rightarrow\\operatorname{std}(w_\\infty)=${texNum(s.sd, 4)}`}</Tex>
            {i < ssExamples.length - 1 ? '；' : '。'}
          </span>
        ))}
        <Tex>{'\\mu'}</Tex> 越小抖動越小：<Tex>{'\\mu x^2\\ll1'}</Tex> 時 <Tex>{'\\operatorname{std}(w_\\infty)\\approx\\sigma_v\\sqrt{\\mu/2}'}</Tex>，
        <Tex>{'\\mu'}</Tex> 小 4 倍、抖動約小 2 倍——和「多平均 4 倍的資料，雜訊降 2 倍」是同一件事。
        {NOISY_PRESET && (
          <>
            {' '}
            想親眼看到這三個數字，<Link to={presetHref(NOISY_PRESET)}>在 §0.5 的 Playground 載入這組參數</Link>：圖上的點線是理論值，Monte Carlo 欄會拿模擬的抖動和它比對。
          </>
        )}
      </p>
      <ModeGate min="engineer">
        <Derivation
          title="（Engineer）穩態變異數的推導"
          formulaId="F-00.9"
          level="L0"
          claim="exact"
          defaultOpen={atLeast('engineer')}
          derivation={
            <>
              <p>
                固定 <Tex>{'x'}</Tex>、加入 iid 雜訊 <Tex>{'v_n\\sim(0,\\sigma_v^2)'}</Tex>（平均 0、變異數 <Tex>{'\\sigma_v^2'}</Tex>）：
              </p>
              <StepDerivation
                steps={[
                  { tex: String.raw`e_n=(a-w_n)x+v_n=\delta_nx+v_n`, why: '有雜訊的誤差。' },
                  {
                    tex: String.raw`\delta_{n+1}=\delta_n-\mu e_nx=(1-\mu x^2)\,\delta_n-\mu x\,v_n=p\,\delta_n-\mu x\,v_n`,
                    why: (
                      <>
                        代入更新式（<Tex>{'\\delta=a-w'}</Tex>，所以 <Tex>{'w'}</Tex> 加多少 <Tex>{'\\delta'}</Tex> 就減多少），與 §0.6 相同，只多了雜訊項{' '}
                        <Tex>{'-\\mu x\\,v_n'}</Tex>。
                      </>
                    ),
                  },
                  {
                    tex: String.raw`\begin{aligned}\operatorname{Var}(\delta_{n+1})&=p^2\operatorname{Var}(\delta_n)\\&\quad+\mu^2x^2\sigma_v^2\end{aligned}`,
                    why: (
                      <>
                        <Tex>{'\\delta_n'}</Tex> 只由過去的雜訊 <Tex>{'v_0,\\dots,v_{n-1}'}</Tex> 決定，與 <Tex>{'v_n'}</Tex> 獨立 <Tex>{'\\Rightarrow'}</Tex>{' '}
                        變異數相加；常數 <Tex>{'p'}</Tex>、<Tex>{'\\mu x'}</Tex> 提出來要平方。
                      </>
                    ),
                  },
                  {
                    tex: String.raw`V=p^2V+\mu^2x^2\sigma_v^2\;\Rightarrow\;V=\frac{\mu^2x^2\sigma_v^2}{1-p^2}`,
                    why: (
                      <>
                        穩態：<Tex>{'V_{n+1}=V_n=V'}</Tex>（需要 <Tex>{'|p|<1'}</Tex>，否則 <Tex>{'V_n'}</Tex> 會一直變大、沒有穩態）。
                      </>
                    ),
                  },
                  {
                    tex: String.raw`1-p^2=(1-p)(1+p)=\mu x^2\,(2-\mu x^2)`,
                    why: (
                      <>
                        平方差公式；<Tex>{'1-p=\\mu x^2'}</Tex>、<Tex>{'1+p=2-\\mu x^2'}</Tex>。
                      </>
                    ),
                  },
                  {
                    tex: String.raw`\operatorname{Var}(w_\infty)=V=\frac{\mu\,\sigma_v^2}{2-\mu x^2}`,
                    why: (
                      <>
                        約分 <Tex>{'\\mu x^2'}</Tex>；<Tex>{'\\operatorname{Var}(w)=\\operatorname{Var}(a-w)=\\operatorname{Var}(\\delta)'}</Tex>（<Tex>{'a'}</Tex> 是常數）。
                      </>
                    ),
                  },
                ]}
                result={String.raw`\operatorname{Var}(w_\infty)=\frac{\mu\,\sigma_v^2}{2-\mu x^2}\;\approx\;\frac{\mu\sigma_v^2}{2}\quad(\mu x^2\ll1)`}
              />
              <p className="small">
                <ClaimTag kind="exact" /> 固定 <Tex>{'x'}</Tex>、iid 雜訊、穩態下為精確式；Playground 打開 <Tex>{'\\sigma_v'}</Tex>{' '}
                後會用單一路徑的樣本標準差做 Monte Carlo 比對（相鄰的 <Tex>{'w_n'}</Tex> 是係數 <Tex>{'p'}</Tex> 的 AR(1)，誤差棒要用有效樣本數{' '}
                <Tex>{'n(1-p^2)/(1+p^2)'}</Tex>；程式見下）。
                <ClaimTag kind="approx" /> 暫態衰減到 <Tex>{'1/e'}</Tex> 需要的步數（時間常數）是{' '}
                <Tex>{'\\tau=-1/\\ln|p|\\approx1/(\\mu x^2)'}</Tex>（<Tex>{'\\mu x^2\\ll1'}</Tex> 時，用 <Tex>{'\\ln(1-\\epsilon)\\approx-\\epsilon'}</Tex>）：
                <Tex>{'\\mu'}</Tex> 小，雜訊小但收斂慢——這個取捨會在 <PageLink id="ch12" /> 與 <PageLink id="ch14" /> 變成具體的設計方程式。
              </p>
              <h4>等效平均長度：LMS 的穩態抖動，相當於直接平均了幾筆？</h4>
              <StepDerivation
                steps={[
                  {
                    tex: String.raw`\hat a_N=\frac1N\sum_{i=1}^{N}\frac{y_i}{x}=a+\frac1N\sum_{i=1}^{N}\frac{v_i}{x}`,
                    why: (
                      <>
                        對照組：把 <Tex>{'N'}</Tex> 筆「單筆猜測」<Tex>{'y_i/x'}</Tex>（§0.1）直接平均；代入 <Tex>{'y_i=ax+v_i'}</Tex>。
                      </>
                    ),
                  },
                  {
                    tex: String.raw`\operatorname{Var}(\hat a_N)=\frac{1}{N^2}\cdot N\cdot\frac{\sigma_v^2}{x^2}=\frac{\sigma_v^2}{N\,x^2}`,
                    why: (
                      <>
                        <Tex>{'1/\\sqrt N'}</Tex> 法則：每一筆 <Tex>{'v_i/x'}</Tex> 的變異數是 <Tex>{'\\sigma_v^2/x^2'}</Tex>，彼此獨立。
                      </>
                    ),
                  },
                  {
                    tex: String.raw`\frac{\sigma_v^2}{N_{\mathrm{eq}}\,x^2}=\frac{\mu\,\sigma_v^2}{2-\mu x^2}`,
                    why: (
                      <>
                        令它等於 LMS 的穩態變異數（F-00.9），解出「等效平均長度」<Tex>{'N_{\\mathrm{eq}}'}</Tex>。
                      </>
                    ),
                  },
                  {
                    tex: String.raw`N_{\mathrm{eq}}=\frac{2-\mu x^2}{\mu x^2}=\frac{2}{\mu x^2}-1=\frac{1+p}{1-p}`,
                    why: (
                      <>
                        移項；最後一個等號用 <Tex>{'\\mu x^2=1-p'}</Tex>。<Tex>{'\\sigma_v'}</Tex> 約掉了：<Tex>{'N_{\\mathrm{eq}}'}</Tex> 只由 pole 決定。
                      </>
                    ),
                  },
                ]}
                result={String.raw`N_{\mathrm{eq}}=\frac{2}{\mu x^2}-1=\frac{1+p}{1-p}\;\approx\;\frac{2}{\mu x^2}\approx2\tau\quad(\mu x^2\ll1)`}
              />
              <div className="table-wrap">
                <table className="ch00-num-table" data-testid="ch00-neq-table">
                  <caption className="small muted">
                    <Tex>{`x=${texNum(SS_X)},\\ \\sigma_v=${texNum(SS_SIGMA)}`}</Tex>；由 <code>fixedXPole</code>、<code>equivalentAveragingLength</code>、<code>steadyStateVarW</code>、
                    <code>stepsToFraction</code> 計算
                  </caption>
                  <thead>
                    <tr>
                      <th className="num">
                        <Tex>{'\\mu'}</Tex>
                      </th>
                      <th className="num">
                        <Tex>{'p=1-\\mu x^2'}</Tex>
                      </th>
                      <th className="num">
                        <Tex>{'N_{\\mathrm{eq}}=\\frac{1+p}{1-p}'}</Tex>
                      </th>
                      <th className="num">
                        <Tex>{'\\operatorname{std}(w_\\infty)'}</Tex>
                      </th>
                      <th className="num">
                        <Tex>{'\\sigma_v/(|x|\\sqrt{N_{\\mathrm{eq}}})'}</Tex>
                      </th>
                      <th className="num">
                        暫態降到 1% 的步數
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {neqRows.map((r) => (
                      <tr key={r.mu}>
                        <td className="num">{num(r.mu)}</td>
                        <td className="num">{num(r.p)}</td>
                        <td className="num">{num(r.neq, 5)}</td>
                        <td className="num">{num(r.sd, 5)}</td>
                        <td className="num">{num(r.sdFromNeq, 5)}</td>
                        <td className="num">{r.n1pct}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Observe>
                <Tex>{'\\mu=1/x^2'}</Tex>（<Tex>{'p=0'}</Tex>）時 <Tex>{'N_{\\mathrm{eq}}=1'}</Tex>：一步到位其實就是 <Tex>{'w_{n+1}=y_n/x'}</Tex>，只用最新的一筆，完全沒有平均。
                <Tex>{'\\mu'}</Tex> 再大（<Tex>{'p<0'}</Tex>）則 <Tex>{'N_{\\mathrm{eq}}<1'}</Tex>——每一步都修過頭，比只看一筆資料還吵。想要平均掉雜訊，<Tex>{'\\mu'}</Tex>{' '}
                必須遠小於 <Tex>{'1/x^2'}</Tex>；代價是最右邊那一欄：收斂步數跟著變長。<Tex>{'\\mu x^2\\ll1'}</Tex> 時{' '}
                <Tex>{'\\operatorname{Var}(w_\\infty)\\cdot\\tau\\approx\\dfrac{\\mu\\sigma_v^2}{2}\\cdot\\dfrac{1}{\\mu x^2}=\\dfrac{\\sigma_v^2}{2x^2}'}</Tex>：
                <strong>抖動（變異數）與收斂時間的乘積大致固定</strong>，一個變小、另一個就變大。
              </Observe>
              <CodeBlock source={modelSrc} region="steadyStateVar" path="src/chapters/ch00/model.ts" />
              <CodeBlock
                source={playgroundSrc}
                region="ar1VarianceCheck"
                path="src/chapters/ch00/experiments/playgroundModel.ts"
                caption="Playground 的 Monte Carlo 欄如何判斷「模擬的抖動與公式一致」：相關樣本的樣本變異數，誤差棒要用 AR(1) 的有效樣本數。"
              />
            </>
          }
          assumptions={
            <ul>
              <li>
                <Tex>{'x'}</Tex> 固定
              </li>
              <li>
                <Tex>{'v_n'}</Tex> iid、零均值、與過去獨立
              </li>
              <li>
                <Tex>{'|p|<1'}</Tex> 且已達穩態
              </li>
            </ul>
          }
        />
      </ModeGate>
      <ChapterHandCalc id="HC-00.6">
        預設值是上面三個數字例中間的那一個（<Tex>{`\\mu=${texNum(ssExamples[1].mu)}`}</Tex>，答案 <Tex>{texNum(ssExamples[1].sd, 4)}</Tex>）。先自己用紙筆和計算機算一遍，再把{' '}
        <Tex>{'\\mu'}</Tex> 換成 <Tex>{texNum(ssExamples[0].mu)}</Tex> 或 <Tex>{texNum(ssExamples[2].mu)}</Tex>，看看是不是得到{' '}
        <Tex>{texNum(ssExamples[0].sd, 4)}</Tex> 與 <Tex>{texNum(ssExamples[2].sd, 4)}</Tex>；最後換成你自己設計裡的 <Tex>{'\\mu,\\ x,\\ \\sigma_v'}</Tex>。
      </ChapterHandCalc>
    </Section>
  )
}
