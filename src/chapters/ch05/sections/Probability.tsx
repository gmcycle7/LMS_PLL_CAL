import { useMemo } from 'react'
import type { Data } from 'plotly.js-dist-min'
import { Callout, ClaimTag, ModeGate, Plot, Prereq, Section, Tex, TexBlock, useThemeTokens } from '@/components'
import { erf, normCdf, normPdf } from '@/simulation/core'
import { meanGmacEncoding, meanQ, pPlus, signLmsFixedPointEncoding } from '@/simulation/models/comparator'
import { Erratum, Fig, HandCalcBlock, Steps, fx, linspace, texNum, vline } from '../common'

/** 先備知識：Gaussian、Φ、erf。 */
export function GaussianPrereq() {
  return (
    <Prereq title={String.raw`Gaussian（常態）分布、$\Phi$、$\varphi$ 與 $\operatorname{erf}$——只用到積分`}>
      <p>
        <strong>機率密度 PDF</strong>：連續的隨機變數 <Tex>{'v'}</Tex> 落在區間 <Tex>{'[a,b]'}</Tex> 的機率是曲線下的面積{' '}
        <Tex>{'P(a\\le v\\le b)=\\int_a^b f(t)\\,dt'}</Tex>，而且 <Tex>{'\\int_{-\\infty}^{\\infty}f=1'}</Tex>。
        單一點的機率 <Tex>{'P(v=c)=\\int_c^c f=0'}</Tex>，所以連續雜訊下「剛好等於門檻」不會發生。
      </p>
      <p>
        <strong>Gaussian</strong>（平均 0、標準差 <Tex>{'\\sigma'}</Tex>）：
      </p>
      <TexBlock>{String.raw`f(v)=\frac{1}{\sqrt{2\pi}\,\sigma}\,e^{-v^2/(2\sigma^2)},\qquad \varphi(z)\equiv\frac{1}{\sqrt{2\pi}}e^{-z^2/2}\;(\sigma=1\text{ 的標準形})`}</TexBlock>
      <p>
        <strong>標準化</strong>：令 <Tex>{'z=v/\\sigma'}</Tex>，則 <Tex>{'z\\sim\\mathcal N(0,1)'}</Tex>。任何 Gaussian 問題都可以先除以{' '}
        <Tex>{'\\sigma'}</Tex> 變成標準形，只需要一張表 <Tex>{'\\Phi'}</Tex>。
      </p>
      <p>
        <strong>CDF</strong>：<Tex>{String.raw`\Phi(z)=P(Z\le z)=\int_{-\infty}^{z}\varphi(t)\,dt`}</Tex>。由微積分基本定理{' '}
        <Tex>{"\\Phi'(z)=\\varphi(z)"}</Tex>；由 <Tex>{'\\varphi(-z)=\\varphi(z)'}</Tex>（左右對稱）得 <Tex>{'\\Phi(-z)=1-\\Phi(z)'}</Tex>、
        <Tex>{'\\Phi(0)=\\tfrac12'}</Tex>。
      </p>
      <p>
        <strong>erf</strong>：<Tex>{String.raw`\operatorname{erf}(x)=\frac{2}{\sqrt\pi}\int_0^x e^{-t^2}\,dt`}</Tex>（奇函數，
        <Tex>{'\\operatorname{erf}(\\pm\\infty)=\\pm1'}</Tex>）。它和 <Tex>{'\\Phi'}</Tex> 的關係用一次變數變換就出來：
      </p>
      <Steps
        title={
          <>
            <Tex>{'\\Phi'}</Tex> 與 <Tex>{'\\operatorname{erf}'}</Tex> 的關係
          </>
        }
        open
        steps={[
          { tex: String.raw`\Phi(z)=\tfrac12+\int_0^{z}\frac{1}{\sqrt{2\pi}}e^{-u^2/2}\,du`, why: <>把積分從 <Tex>{'(-\\infty,z]'}</Tex> 拆成 <Tex>{'(-\\infty,0]'}</Tex>（面積 <Tex>{'\\tfrac12'}</Tex>，對稱）與 <Tex>{'[0,z]'}</Tex>。</> },
          { tex: String.raw`u=\sqrt2\,t,\quad du=\sqrt2\,dt`, why: <>換變數，讓指數變成 <Tex>{'-t^2'}</Tex>（erf 的形狀）。</> },
          { tex: String.raw`\Phi(z)=\tfrac12+\int_0^{z/\sqrt2}\frac{\sqrt2}{\sqrt{2\pi}}e^{-t^2}\,dt=\tfrac12+\frac{1}{\sqrt\pi}\int_0^{z/\sqrt2}e^{-t^2}\,dt`, why: <>上限 <Tex>{'u=z'}</Tex> 對應 <Tex>{'t=z/\\sqrt2'}</Tex>；係數 <Tex>{'\\sqrt2/\\sqrt{2\\pi}=1/\\sqrt\\pi'}</Tex>。</> },
          { tex: String.raw`\Phi(z)=\tfrac12\Big[1+\operatorname{erf}\big(z/\sqrt2\big)\Big]`, why: <><Tex>{'1/\\sqrt\\pi=\\tfrac12\\cdot2/\\sqrt\\pi'}</Tex>，正好是 erf 的定義。</> },
        ]}
        result={String.raw`2\Phi(z)-1=\operatorname{erf}\!\big(z/\sqrt2\big)`}
      />
    </Prereq>
  )
}

/** 先備知識：期望值與變異數（離散）。 */
export function ExpectationPrereq() {
  return (
    <Prereq title={String.raw`期望值 $E[\cdot]$ 與變異數 $\operatorname{Var}(\cdot)$：「做很多次的平均」`}>
      <p>
        一個只會取幾個值的隨機變數 <Tex>{'X'}</Tex>，期望值就是「每個值乘上它出現的機率」再加總：<Tex>{String.raw`E[X]=\sum_x x\,P(X=x)`}</Tex>。
        直覺：重複很多次、取平均，就會接近 <Tex>{'E[X]'}</Tex>。期望值是線性的：<Tex>{'E[aX+bY]=aE[X]+bE[Y]'}</Tex>（不需要獨立）。
      </p>
      <p>
        變異數（variance）衡量「離平均有多散」：<Tex>{String.raw`\operatorname{Var}(X)\equiv E\big[(X-E[X])^2\big]`}</Tex>。它的單位是 <Tex>{'X'}</Tex> 的平方，所以常取平方根變回原單位，叫
        <strong>標準差</strong>（standard deviation）<Tex>{String.raw`\mathrm{SD}(X)=\sqrt{\operatorname{Var}(X)}`}</Tex>；平均為 0 的雜訊，標準差就是它的 RMS 值（例如{' '}
        <Tex>{'\\sigma_v'}</Tex>）。變異數可以化成更好算的形式：
      </p>
      <Steps
        title={<Tex>{String.raw`\operatorname{Var}(X)=E[X^2]-\big(E[X]\big)^2`}</Tex>}
        steps={[
          { tex: String.raw`\operatorname{Var}(X)\equiv E\big[(X-\mu)^2\big],\quad \mu=E[X]`, why: '定義：離平均的平方誤差的平均。' },
          { tex: String.raw`=E\big[X^2-2\mu X+\mu^2\big]`, why: '展開平方。' },
          { tex: String.raw`=E[X^2]-2\mu E[X]+\mu^2`, why: <>期望值線性；<Tex>{'\\mu'}</Tex> 是常數可以提出來（這裡的 <Tex>{'\\mu'}</Tex> 是平均值，不是 §7 的學習率）。</> },
          { tex: String.raw`=E[X^2]-\mu^2`, why: <>代入 <Tex>{'E[X]=\\mu'}</Tex>：<Tex>{'-2\\mu^2+\\mu^2=-\\mu^2'}</Tex>。</> },
        ]}
        result={String.raw`\operatorname{Var}(X)=E[X^2]-\big(E[X]\big)^2`}
      />
    </Prereq>
  )
}

/** §1：單一次比較——P(q=+1)、E[q]、Var(q)。 */
export function ProbabilitySection() {
  const tokens = useThemeTokens()
  const T = useMemo(() => {
    const s = 1
    const sigma = 100
    const p = pPlus(s, sigma)
    const m = meanQ(s, sigma)
    const xs = [-1, -0.5, 0, 0.5, 1, 1.5]
    const ps = xs.map(() => 1 / 6)
    const wrongUpdate = meanGmacEncoding(300, 300, xs, ps, sigma, 'unipolar')
    const wrongShift = signLmsFixedPointEncoding(300, xs, ps, sigma, 'unipolar', [-700, 1300]) - 300
    // 標準化後的 PDF：以 r = 0.6 示意陰影面積（s = 1 fs 時面積差太小，肉眼看不出）
    const z = linspace(-4, 4, 321)
    const rDemo = 0.6
    return { p, m, wrongUpdate, wrongShift, z, rDemo, pDemo: normCdf(rDemo) }
  }, [])

  const pdfData = useMemo<Data[]>(() => {
    const shadeX = T.z.filter((x) => x >= -T.rDemo)
    return [
      { x: T.z, y: T.z.map(normPdf), name: String.raw`$\varphi(z)$：$v/\sigma_v$ 的 PDF`, mode: 'lines', line: { color: tokens.series[0] } },
      {
        x: shadeX,
        y: shadeX.map(normPdf),
        name: String.raw`面積 $= P(q=+1) = \Phi(r) =$ ${fx(T.pDemo, 4)}`,
        mode: 'lines',
        fill: 'tozeroy',
        line: { color: tokens.series[2], width: 0 },
      },
    ]
  }, [T, tokens])

  return (
    <Section
      kind="formula"
      level={2}
      title={
        <>
          2. 單一次比較：<Tex>{String.raw`P(q=+1),\ E[q],\ \operatorname{Var}(q)`}</Tex>
        </>
      }
    >
      <p className="ch05-note">先備知識（Gaussian／<Tex>{'\\Phi'}</Tex>／erf、期望值與變異數）在 §1 的手算表下方。</p>
      <p>
        Comparator 的規則是 <Tex>{String.raw`q=+1\iff e\ge\theta`}</Tex>（規格 §15.2 的硬體慣例），其中 <Tex>{'e=s+v'}</Tex>。
        因為 <Tex>{'v'}</Tex> 是連續的，<Tex>{'P(e=\\theta)=0'}</Tex>，所以單一樣本的 <Tex>{'\\operatorname{sign}(0)'}</Tex> 慣例不影響任何機率
        <Erratum id="E07">
          （規格 §0 的 <Tex>{'\\operatorname{sign}(0)'}</Tex> 與 §15.2 的 <Tex>{'e\\ge0\\Rightarrow+1'}</Tex> 不一致；對單一樣本無影響，但對累加後的{' '}
          <Tex>{'S_N=0'}</Tex> 有影響，見 §3）
        </Erratum>
        。
      </p>
      <Fig name="singleCompare">
        先看左邊兩個加法點：第一個把 <Tex>{'s'}</Tex> 和 <Tex>{'v'}</Tex> 加成 <Tex>{'e'}</Tex>，第二個減掉門檻得到 <Tex>{'e-\\theta'}</Tex>。再看菱形：
        <Tex>{'e-\\theta\\ge0'}</Tex> 就輸出 <Tex>{'q=+1'}</Tex>，否則 <Tex>{'q=-1'}</Tex>。因為 <Tex>{'v'}</Tex> 是隨機的，走哪個出口也是隨機的；「是」那條線上的機率{' '}
        <Tex>{'p'}</Tex> 就是下面要推導的 <Tex>{'P(q=+1)'}</Tex>，圖上的 <Tex>{'(s-\\theta)/\\sigma_v'}</Tex> 就是公式裡的標準化誤差 <Tex>{'r'}</Tex>。
      </Fig>
      <Steps
        title={<Tex>{String.raw`P(q=+1)=\Phi\big((s-\theta)/\sigma_v\big)`}</Tex>}
        steps={[
          { tex: String.raw`P(q=+1)=P(e\ge\theta)`, why: 'comparator 的定義：輸入不低於門檻就輸出 +1。' },
          { tex: String.raw`=P(s+v\ge\theta)`, why: <>代入 <Tex>{'e=s+v'}</Tex>。</> },
          { tex: String.raw`=P(v\ge\theta-s)`, why: <>兩邊減 <Tex>{'s'}</Tex>（<Tex>{'s'}</Tex> 是常數）。</> },
          { tex: String.raw`=P\!\left(\frac{v}{\sigma_v}\ge\frac{\theta-s}{\sigma_v}\right)`, why: <>兩邊除以 <Tex>{'\\sigma_v>0'}</Tex>，不等號方向不變；左邊變成標準常態 <Tex>{'Z'}</Tex>。</> },
          { tex: String.raw`=1-\Phi\!\left(\frac{\theta-s}{\sigma_v}\right)`, why: <><Tex>{'P(Z\\ge c)=1-P(Z<c)=1-\\Phi(c)'}</Tex>（連續分布單一點的機率為 0，所以 <Tex>{'P(Z<c)=P(Z\\le c)'}</Tex>）。</> },
          { tex: String.raw`=\Phi\!\left(\frac{s-\theta}{\sigma_v}\right)`, why: <>對稱性 <Tex>{'1-\\Phi(c)=\\Phi(-c)'}</Tex>。</> },
        ]}
      />
      <TexBlock id="F-05.1" label={<>Comparator 輸出 +1 的機率 <ClaimTag kind="exact" /></>}>
        {String.raw`\boxed{P(q=+1)=\Phi\!\left(\frac{s-\theta}{\sigma_v}\right)}\;\xrightarrow{\;\theta=0\;}\;\Phi\!\left(\frac{s}{\sigma_v}\right)`}
      </TexBlock>
      <p>
        數字：<Tex>{String.raw`\Phi(0.01)=${fx(T.p, 10)}`}</Tex>（T04 參考值 0.503989）。用一階泰勒手算：
        <Tex>{String.raw`\Phi(0.01)\approx\Phi(0)+0.01\,\Phi'(0)=0.5+0.01\cdot\frac{1}{\sqrt{2\pi}}=${fx(0.5 + 0.01 * normPdf(0), 10)}`}</Tex>
        ，只比精確值多 <Tex>{texNum(0.5 + 0.01 * normPdf(0) - T.p, 3)}</Tex>（被捨去的三次項 <Tex>{String.raw`r^3\varphi(0)/6=${texNum((0.01 ** 3 * normPdf(0)) / 6, 3)}`}</Tex>）。
      </p>
      <Plot
        title={String.raw`標準化後的雜訊 PDF：陰影面積就是 $P(q=+1)$（示意 $r=0.6$）`}
        data={pdfData}
        layout={{
          xaxis: { title: { text: String.raw`$z = v/\sigma_v$` } },
          yaxis: { title: { text: String.raw`$\varphi(z)$` } },
          shapes: [vline(-T.rDemo, tokens.series[1])],
          annotations: [{ x: -T.rDemo, y: 0.42, text: String.raw`$z = -r = (\theta - s)/\sigma_v$`, showarrow: false, xanchor: 'right' }],
        }}
        height={260}
        csvName="ch05-pdf-shade"
        caption={
          <>
            <Tex>{'r=(s-\\theta)/\\sigma_v=0.6'}</Tex> 只是為了讓面積差看得見；<Tex>{String.raw`s=1\,\mathrm{fs},\ \sigma_v=100\,\mathrm{fs}`}</Tex> 時{' '}
            <Tex>{'r=0.01'}</Tex>，陰影只比一半多 <Tex>{`${fx(100 * (T.p - 0.5), 3)}\\%`}</Tex>。實驗區可調 <Tex>{'s,\\sigma_v,\\theta'}</Tex>。
          </>
        }
      />

      <p>
        知道了 <Tex>{'p'}</Tex>，接著問兩件事：<Tex>{'q'}</Tex> 的<strong>平均</strong>是多少（這就是藏在雜訊裡的「訊號」），以及它每次<strong>起伏</strong>多大（「雜訊」）。
        <Tex>{'q'}</Tex> 只有 <Tex>{'\\pm1'}</Tex> 兩個值，所以算法和算一枚硬幣的平均輸贏一樣：
      </p>
      <Fig name="qStats">
        先看通往加法點的兩條線：<Tex>{'q=+1'}</Tex> 以機率 <Tex>{'p'}</Tex> 出現、<Tex>{'q=-1'}</Tex> 以機率 <Tex>{'1-p'}</Tex> 出現，加法點把「<Tex>{'+p'}</Tex>」和「
        <Tex>{'-(1-p)'}</Tex>」相加，得到平均 <Tex>{'m=2p-1'}</Tex>。再看標著「<Tex>{'q^2=1'}</Tex>」的兩條線：不管 <Tex>{'q'}</Tex> 是哪一個值，<Tex>{'q^2'}</Tex> 都是 1，所以{' '}
        <Tex>{'E[q^2]=1'}</Tex>，變異數就是 <Tex>{'1-m^2'}</Tex>。圖上的 <Tex>{'\\operatorname{erf}'}</Tex> 是 error function（和 <Tex>{'\\Phi'}</Tex>{' '}
        只差一個尺度與平移，見 §1 的先備知識框）；它讓 <Tex>{'m'}</Tex> 直接寫成 <Tex>{'s'}</Tex> 的函數。圖上加法點的兩條輸入，就是下面推導第二行的{' '}
        <Tex>{'p-(1-p)'}</Tex>。
      </Fig>
      <Steps
        title={<Tex>{String.raw`E[q]=2\Phi-1=\operatorname{erf}`}</Tex>}
        steps={[
          { tex: String.raw`E[q]=(+1)\,P(q=+1)+(-1)\,P(q=-1)`, why: '期望值的定義：每個值乘上它的機率再加總。' },
          { tex: String.raw`=p-(1-p)`, why: <><Tex>{'q'}</Tex> 只有兩個值，所以 <Tex>{'P(q=-1)=1-p'}</Tex>。</> },
          { tex: String.raw`=2p-1=2\Phi(r)-1`, why: <>整理，並代入 <Tex>{'p=\\Phi(r)'}</Tex>、<Tex>{'r=(s-\\theta)/\\sigma_v'}</Tex>。</> },
          { tex: String.raw`=2\cdot\tfrac12\big[1+\operatorname{erf}(r/\sqrt2)\big]-1`, why: <>代入先備知識中 <Tex>{'\\Phi'}</Tex> 與 <Tex>{'\\operatorname{erf}'}</Tex> 的關係。</> },
          { tex: String.raw`=\operatorname{erf}\!\left(\frac{s-\theta}{\sqrt2\,\sigma_v}\right)`, why: '化簡。' },
        ]}
      />
      <TexBlock id="F-05.2" label={<>單一樣本的平均輸出（訊號）<ClaimTag kind="exact" /></>}>
        {String.raw`\boxed{m\equiv m_q\equiv E[q]=2\Phi\!\left(\frac{s-\theta}{\sigma_v}\right)-1=\operatorname{erf}\!\left(\frac{s-\theta}{\sqrt2\,\sigma_v}\right)}\;\xrightarrow{\;\theta=0\;}\;\operatorname{erf}\!\left(\frac{s}{\sqrt2\,\sigma_v}\right)`}
      </TexBlock>
      <p className="ch05-note">
        全站符號表把這個平均寫成 <Tex>{'m_q'}</Tex>（避免和 Ch12 的 code DC 混淆）；本章只有這一個平均值，公式裡簡寫成 <Tex>{'m'}</Tex>，兩者是同一個量。
        <Erratum id="E34" />
      </p>
      <Steps
        title={<Tex>{String.raw`\operatorname{Var}(q)=1-m^2`}</Tex>}
        steps={[
          { tex: String.raw`\operatorname{Var}(q)=E[q^2]-\big(E[q]\big)^2`, why: '先備知識中的變異數公式。' },
          { tex: String.raw`q^2=(\pm1)^2=1\;\Rightarrow\;E[q^2]=1`, why: <>不論輸出 <Tex>{'+1'}</Tex> 還是 <Tex>{'-1'}</Tex>，平方都是 1。</> },
          { tex: String.raw`\operatorname{Var}(q)=1-m^2`, why: '代入。' },
        ]}
      />
      <TexBlock id="F-05.3" label={<>單一樣本的雜訊功率 <ClaimTag kind="exact" /></>}>
        {String.raw`\boxed{\operatorname{Var}(q)=1-m^2}`}
      </TexBlock>
      <p>
        <Tex>{String.raw`s=1\,\mathrm{fs},\ \sigma_v=100\,\mathrm{fs}`}</Tex>：<Tex>{String.raw`m=\operatorname{erf}(0.01/\sqrt2)=${fx(T.m, 10)}`}</Tex>，
        <Tex>{String.raw`\operatorname{Var}(q)=${fx(1 - T.m * T.m, 8)}`}</Tex>。也可以直接驗算 <Tex>{`2p-1=${fx(2 * T.p - 1, 10)}`}</Tex> 與{' '}
        <Tex>{`\\operatorname{erf}(0.01/\\sqrt2)=${fx(erf(0.01 / Math.SQRT2), 10)}`}</Tex> 相同。
      </p>
      <HandCalcBlock id="HC-05.1">
        上面三個 boxed 公式，用你自己的 <Tex>{'s'}</Tex>、<Tex>{'\\sigma_v'}</Tex>、<Tex>{'\\theta'}</Tex> 代一次：先用紙筆算出{' '}
        <Tex>{'p'}</Tex>、<Tex>{'m'}</Tex>、<Tex>{'\\operatorname{Var}(q)'}</Tex>，再展開帶入過程對答案（小訊號下不需要常態表）。
      </HandCalcBlock>

      <Callout
        kind="warn"
        title={
          <>
            硬體 0/1 位元一定要先映射成 <Tex>{'q=2b-1'}</Tex>
          </>
        }
      >
        <p>
          若把 comparator 的 0/1 位元 <Tex>{'b'}</Tex> 直接當成 <Tex>{'q'}</Tex> 送進 GMAC，<Tex>{'E[b]=p'}</Tex> 在 <Tex>{'s=0'}</Tex> 時是{' '}
          <Tex>{'\\tfrac12'}</Tex> 而不是 0。這裡要暫時離開 <Tex>{'x\\equiv1'}</Tex>：真正的 GMAC 累加的是 <Tex>{'q\\,x'}</Tex>（<Tex>{'x'}</Tex> 是 regressor，例如 DTC
          code），誤差是 <Tex>{'s=(a-w)\\,x'}</Tex>；<Tex>{'w=a'}</Tex> 表示係數 <Tex>{'w'}</Tex> 已經等於真值 <Tex>{'a'}</Tex>，這時平均更新量應該是 0，迴路才會停在這裡。
        </p>
        <Fig name="bitMapping">
          先看綠色的路徑：位元 <Tex>{'b'}</Tex> 先映射成 <Tex>{'q=2b-1'}</Tex> 再進 GMAC，在 <Tex>{'w=a'}</Tex> 時 <Tex>{'E[q\\,x]=0'}</Tex>，固定點正確。再看紅色的路徑：直接累加{' '}
          <Tex>{'b\\,x'}</Tex>，因為 <Tex>{'E[b]=\\tfrac12'}</Tex>，平均更新量是 <Tex>{'\\tfrac12E[x]'}</Tex>；只要 code 有直流成分（<Tex>{'E[x]\\ne0'}</Tex>），迴路就會被推到別的地方才平衡。圖上紅、綠兩個結果，就是下面 F-05.16 的左右兩邊。
        </Fig>
        <TexBlock id="F-05.16" label={<>反面測試（T04）<ClaimTag kind="exact" /></>}>
          {String.raw`E[b\,x]\big|_{w=a}=\tfrac12E[x]\neq0\qquad(\text{正確：}q=2b-1\Rightarrow E[q\,x]\big|_{w=a}=0)`}
        </TexBlock>
        <p>
          以 golden T04 的 code <Tex>{'x\\in\\{-1,-0.5,0,0.5,1,1.5\\}'}</Tex>（等機率、<Tex>{'E[x]=0.25'}</Tex>）、
          <Tex>{String.raw`\sigma_v=100\,\mathrm{fs}`}</Tex>、<Tex>{String.raw`a=300\,\mathrm{fs}`}</Tex> 為例：在真值 <Tex>{'w=a'}</Tex> 時平均更新量是{' '}
          <Tex>{fx(T.wrongUpdate, 6)}</Tex>（不是 0），Sign-LMS 的平均固定點因此偏移 <strong>{fx(T.wrongShift, 2)} fs</strong>。
          零均值 code 下 <Tex>{String.raw`E[b\,x]=\tfrac12E[x]+\tfrac12E[q\,x]=\tfrac12E[q\,x]`}</Tex>：只會讓增益減半、不會偏移，所以這個 bug
          很容易在模擬中被掩蓋。
        </p>
      </Callout>

      <ModeGate min="research">
        <Callout
          kind="info"
          title={
            <>
              Research：為什麼 <Tex>{'E[q]'}</Tex> 用 <Tex>{'\\operatorname{erf}'}</Tex> 算、不用 <Tex>{'2\\Phi-1'}</Tex>？
            </>
          }
        >
          數值上 <Tex>{'2\\Phi(r)-1'}</Tex> 在 <Tex>{'r\\approx0'}</Tex> 時是兩個接近 1 的數相減，會損失約{' '}
          <Tex>{'\\log_{10}(1/|m|)'}</Tex> 位有效數字；<Tex>{'\\operatorname{erf}(r/\\sqrt2)'}</Tex> 直接在 0 附近有完整相對精度。本站{' '}
          <code>meanQ()</code> 因此用 erf（見 §8 的程式碼）。
        </Callout>
      </ModeGate>
    </Section>
  )
}
