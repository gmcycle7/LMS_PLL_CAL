import { useMemo } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import { Callout, ClaimTag, CodeBlock, CodeCompare, ModeGate, Plot, Prereq, Section, StepDerivation, Tex, TexBlock, TestBadge, useThemeTokens } from '@/components'
import biasSrc from '@/simulation/models/bias.ts?raw'
import {
  buildCodeDistribution,
  codeMoments,
  cubicReferenceTable,
  eDet,
  expectation,
  fixedPoint,
  meanGmacSign,
  mseFixedPoint,
  perCodeGain,
  signWeightedMedian,
  type ErrorModel,
} from '@/simulation/models/bias'
import { F } from '../formulas'
import { Erratum, ModeDetails, num, signed, m, texNum } from '../common'
import { Fig, FigRef } from '../Fig'
import { Hand } from '../Hand'

const PATH = 'src/simulation/models/bias.ts'
const M: ErrorModel = { a: 1, b: 0, c2: 0, c3: 0.1, kappa: 0, sigmaV: 0 }
const SWEEP_LAYOUT: Partial<Layout> = { xaxis: { title: { text: String.raw`$\sigma_v$（t.u.，log）` } }, yaxis: { title: { text: String.raw`$w^*$（t.u.）` }, range: [1.33, 1.41] } }

function logspace(lo: number, hi: number, n: number): number[] {
  const a = Math.log10(lo)
  const b = Math.log10(hi)
  return Array.from({ length: n }, (_, i) => 10 ** (a + ((b - a) * i) / (n - 1)))
}

/** §11.2：三階 INL 的三種演算法情境（勘誤 E01、E11）。 */
export function InlSection() {
  const tokens = useThemeTokens()
  const five = useMemo(() => buildCodeDistribution({ kind: 'five_level' }), [])
  const mo = useMemo(() => codeMoments(five), [five])
  const wMse = useMemo(() => mseFixedPoint(M, five), [five])
  const resid = useMemo(
    () =>
      five.values.map((x) => {
        const e = eDet(x, wMse, M)
        return { x, t: x !== 0 ? perCodeGain(x, M) : Number.NaN, e, xe: x * e, xe3: x * e ** 3 }
      }),
    [five, wMse],
  )
  const exe3 = useMemo(() => expectation(five, (x) => x * eDet(x, wMse, M) ** 3), [five, wMse])
  const coef = -exe3 / (6 * mo.Ex2)
  const table = useMemo(() => cubicReferenceTable({ sigmas: [0.01, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 10] }), [])
  const curve = useMemo(() => cubicReferenceTable({ sigmas: logspace(0.01, 10, 61) }), [])
  const med = useMemo(() => signWeightedMedian(M, five.values, five.probs), [five])
  const steps = useMemo(() => [1.05, 1.25, 1.5].map((w) => ({ w, g: meanGmacSign(w, M, five) })), [five])
  const costs = useMemo(
    () =>
      [1, wMse, med.lo].map((w) => ({
        w,
        mse: expectation(five, (x) => eDet(x, w, M) ** 2),
        mae: expectation(five, (x) => Math.abs(eDet(x, w, M))),
      })),
    [five, wMse, med.lo],
  )
  const others = useMemo(() => {
    const g = buildCodeDistribution({ kind: 'gaussian' })
    return {
      pm: mseFixedPoint(M, buildCodeDistribution({ kind: 'pm_one' })),
      gauss: mseFixedPoint(M, g),
      gaussNoiseFree: fixedPoint('sign', M, g).w, // σ_v = 0 的 mean-field 根（連續 code，斷點積分）
      gaussSign1: fixedPoint('sign', { ...M, sigmaV: 1 }, g).w,
    }
  }, [])

  const plotData: Data[] = useMemo(() => {
    const s = curve.map((r) => r.sigma)
    const lo = s[0]
    const hi = s[s.length - 1]
    return [
      { x: s, y: curve.map((r) => r.exact), mode: 'lines', name: 'Sign-LMS mean-field（精確根）', line: { color: tokens.series[0], width: 2.5 } },
      {
        x: s,
        y: curve.map((r) => (r.secondOrder < 1.45 ? r.secondOrder : null)),
        mode: 'lines',
        name: String.raw`二階近似 $1.34 + 3.456\times10^{-4}/\sigma_v^2$`,
        line: { color: tokens.series[3], dash: 'dashdot' },
      },
      { x: [lo, hi], y: [wMse, wMse], mode: 'lines', name: 'MSE-LMS 1.34（精確）', line: { color: tokens.series[1], dash: 'dash' } },
      { x: [lo, hi], y: [med.lo, med.lo], mode: 'lines', name: String.raw`無雜訊 Sign 1.4（$|x|$ 加權中位數）`, line: { color: tokens.series[2], dash: 'dot' } },
      {
        x: table.filter((r) => [0.05, 0.1, 0.3, 1].includes(r.sigma)).map((r) => r.sigma),
        y: table.filter((r) => [0.05, 0.1, 0.3, 1].includes(r.sigma)).map((r) => r.exact),
        mode: 'markers',
        name: '勘誤 E01 參考點',
        marker: { color: tokens.series[0], size: 8, symbol: 'diamond' },
      },
    ]
  }, [curve, table, wMse, med.lo, tokens])

  return (
    <Section kind="example" title="11.2 DTC 三階非線性：「最佳線性 gain」到底是多少？" level={2} id="ch11-inl">
      <p>
        回到開場的例子：<Tex>{String.raw`e=(a-w)x+c_3x^3`}</Tex>，<Tex>{'a=1'}</Tex>、<Tex>{'c_3=0.1'}</Tex>，<Tex>{'x'}</Tex> 等機率取{' '}
        <Tex>{String.raw`\{-2,-1,0,1,2\}`}</Tex>。<Erratum id="E11" note="1.34 只在這個 5 值等機率分布下成立；c 統一為 c₃" />
        <Erratum id="E01" note="1.34 是 MSE-LMS 的精確固定點，Sign-LMS 依 σ_v 而定" /> <TestBadge id="T12" />
      </p>
      <p>
        先看結論的圖，數字的來源在後面的推導。<FigRef id="best-fit" /> 是 MSE-LMS 的觀點：把 INL <Tex>{'c_3x^3'}</Tex> 對 <Tex>{'x'}</Tex>{' '}
        做投影（找一個倍數，讓剩下的部分和 <Tex>{'x'}</Tex> 的相關為 0）。先看藍色的分支：與 <Tex>{'x'}</Tex> 成正比的那一部分 <Tex>{'0.34\\,x'}</Tex> 在 GMAC
        眼裡就是 gain 誤差，被 <Tex>{'w'}</Tex> 吸收，所以 <Tex>{'w^*=a+0.34'}</Tex>。再看紅色的分支：剩下的 <Tex>{'e_0(x)'}</Tex> 與 <Tex>{'x'}</Tex> 正交（
        <Tex>{String.raw`E[x\,e_0]=0`}</Tex>），GMAC 的平均看不到它，它卻留在每一個 code 上。圖上的 <Tex>{String.raw`E[x\,d]/E[x^2]`}</Tex> 就是 F-11.4 的 INL
        項；<Tex>{'e_0'}</Tex> 就是下面殘差表的第三欄。
      </p>
      <Fig id="best-fit" />
      <StepDerivation
        title="先算 code 的動差（手算）"
        steps={[
          { tex: String.raw`E[x^2]=\tfrac15\big[(-2)^2+(-1)^2+0^2+1^2+2^2\big]=\tfrac{10}{5}=${texNum(mo.Ex2)}`, why: m('期望值 = 機率加權和；每個 code 機率 $1/5$。') },
          { tex: String.raw`E[x^4]=\tfrac15\big[16+1+0+1+16\big]=\tfrac{34}{5}=${texNum(mo.Ex4)}`, why: '同上，四次方。' },
          { tex: String.raw`E[x\,d(x)]=E[x\cdot c_3x^3]=c_3E[x^4]=0.1\times6.8=0.68`, why: m('$d(x)=c_3x^3$（本例 $c_2=0$）；$c_3$ 是常數可提出。') },
        ]}
      />
      <p>
        「最佳直線」只是其中一種標準。同一個誤差模型，<strong>三種演算法情境給出三個不同的答案</strong>。先看 <FigRef id="mean-vs-median" />{' '}
        最上面：兩組 code 想要的 gain 不同（<Tex>{'\\pm1'}</Tex> 想要 1.1、<Tex>{'\\pm2'}</Tex> 想要 1.4）；再往下看三種演算法怎麼調停 —— MSE-LMS
        用「拔河」（拉力等於權重乘上距離）、無雜訊的 Sign-LMS 用「投票」（只看方向、不看差多少）、有 Gaussian 雜訊的 Sign-LMS 介於兩者之間。圖上的{' '}
        <Tex>{'t(x)'}</Tex> 就是 F-11.11 的 per-code gain；最下面三個方塊就是下面三張卡片的答案。
      </p>
      <Fig id="mean-vs-median" />
      <div className="grid-3">
        <div className="card">
          <strong>(1) MSE-LMS</strong> <ClaimTag kind="exact" />
          <TexBlock>{String.raw`w^*=1.34`}</TexBlock>
          <p className="small">{m('GMAC $=E[x\\,e]$；與雜訊無關。$x^2$ 加權「平均」。')}</p>
        </div>
        <div className="card">
          <strong>(2) Sign-LMS + Gaussian v</strong> <ClaimTag kind="approx" />
          <TexBlock>{String.raw`w^*\approx1.34+\frac{3.456\times10^{-4}}{\sigma_v^2}`}</TexBlock>
          <p className="small">{m('$\\sigma_v\\gtrsim0.2$ 時有效；$\\sigma_v\\to\\infty$ 才趨近 1.34。')}</p>
        </div>
        <div className="card">
          <strong>(3) 無雜訊 Sign-LMS</strong> <ClaimTag kind="exact" />
          <TexBlock>{String.raw`w^*=1.4`}</TexBlock>
          <p className="small">{m('GMAC $=E[x\\operatorname{sign}(e)]$；$|x|$ 加權「中位數」，並有 $O(\\mu)$ limit cycle。')}</p>
        </div>
      </div>

      <h3>情境 (1)：MSE-LMS ⇒ 1.34（精確）</h3>
      <StepDerivation
        steps={[
          { tex: String.raw`E[x\,e]=(a-w)E[x^2]+c_3E[x^4]`, why: m('代入 $e=(a-w)x+c_3x^3$，逐項取期望值。') },
          { tex: String.raw`0=(1-w^*)\cdot2+0.1\cdot6.8`, why: '代入數字並令 GMAC 平均為 0。' },
          { tex: String.raw`w^*=1+\frac{0.68}{2}=1.34=\frac{67}{50}`, why: '一次方程直接解出。' },
        ]}
        result={String.raw`w^*_\mathrm{MSE}=a+c_3\frac{E[x^4]}{E[x^2]}=${texNum(wMse)}`}
      />
      <TexBlock id="F-11.8" label="三階 INL 的 MSE 最佳線性 gain（只對此 code 分布）">
        {F.cubicMse}
      </TexBlock>
      <Hand id="HC-11.4">
        {m('把 5 個 code 換成你自己的（不必對稱），重算 $E[x^2]$、$E[x^4]$ 與 $w^*$；預設值會得到上面的 2、6.8 與 1.34。')}
      </Hand>
      <p>殘差表（數字由模型計算；最後一欄是給情境 (2) 用的）：</p>
      <div className="table-wrap">
        <table className="ch11-table">
          <thead>
            <tr>
              <th>
                <Tex>{'x'}</Tex>
              </th>
              <th>
                <Tex>{'t(x)=a+c_3x^2'}</Tex>
              </th>
              <th>
                <Tex>{'e_0=e(x;1.34)'}</Tex>
              </th>
              <th>
                <Tex>{'x\\,e_0'}</Tex>
              </th>
              <th>
                <Tex>{'x\\,e_0^3'}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            {resid.map((r) => (
              <tr key={r.x}>
                <td className="num">{r.x}</td>
                <td className="num">{Number.isFinite(r.t) ? num(r.t, 4) : '—'}</td>
                <td className="num">{signed(r.e, 4)}</td>
                <td className="num">{signed(r.xe, 4)}</td>
                <td className="num">{signed(r.xe3, 6)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        <Tex>{'x\\,e_0'}</Tex> 欄的平均是 0（GMAC 歸零），但 <Tex>{'e_0'}</Tex> 欄沒有一個是 0：<strong>這是可以解釋的最小化結果，不是發散，也不是 bug</strong>。MSE-LMS
        的答案可以看成每個 code 的零誤差 gain <Tex>{'t(x)'}</Tex> 以 <Tex>{'x^2'}</Tex> 加權的平均：
      </p>
      <TexBlock id="F-11.11">{F.weightedMean}</TexBlock>
      <TexBlock>{String.raw`w^*_\mathrm{MSE}=\frac{2\cdot0.2\cdot1.1+2\cdot0.8\cdot1.4}{2\cdot0.2+2\cdot0.8}=\frac{0.44+2.24}{2}=1.34`}</TexBlock>

      <h3>
        情境 (2)：Sign-LMS + Gaussian 雜訊 ⇒ <Tex>{String.raw`1.34+3.456\times10^{-4}/\sigma_v^2`}</Tex>
      </h3>
      <p>
        Sign-LMS 的平均 GMAC 是 <Tex>{String.raw`E\big[x\operatorname{erf}(e/\sqrt2\sigma_v)\big]`}</Tex>。只保留 erf 的一次項會得到 1.34；把三次項也留下來，就能算出偏差：
      </p>
      <ModeDetails title="一步一步推導：erf 的三次項造成的修正">
        <StepDerivation
          steps={[
            { tex: String.raw`\operatorname{erf}\!\Big(\frac{e}{\sqrt2\sigma_v}\Big)\approx K_q\Big(e-\frac{e^3}{6\sigma_v^2}\Big)`, why: m('erf 泰勒展開到三次（先備知識框），$K_q=\\sqrt{2/\\pi}/\\sigma_v$。') },
            { tex: String.raw`E[G](w)\approx K_q\Big(E[x\,e]-\frac{E[x\,e^3]}{6\sigma_v^2}\Big)`, why: m('乘上 $x$ 再取期望值（期望值線性）。') },
            { tex: String.raw`w=w_1+\Delta,\quad w_1=1.34:\qquad e=e_0-\Delta\,x`, why: m('在 MSE 解附近找修正量 $\\Delta=w-w_1$（不是全站的 $\\delta=a-w$）；$e$ 對 $w$ 是線性的，$e_0$ 是 $w_1$ 處的殘差。') },
            { tex: String.raw`E[x\,e]=\underbrace{E[x\,e_0]}_{=0}-\Delta\,E[x^2]=-2\Delta`, why: m('$w_1$ 的定義就是 $E[x\\,e_0]=0$。') },
            { tex: String.raw`E[x\,e^3]\approx E[x\,e_0^3]=${texNum(exe3, 6)}`, why: m('$\\Delta\\propto1/\\sigma_v^2$ 很小，$E[xe^3]$ 的一階修正是更高階的小量，先忽略；數值取上表最後一欄的平均。') },
            { tex: String.raw`0=-2\Delta-\frac{${texNum(exe3, 6)}}{6\sigma_v^2}`, why: m('令 $E[G]=0$（$K_q$ 是正的常數，可以消掉）。') },
            { tex: String.raw`\Delta=-\frac{E[x\,e_0^3]}{6\sigma_v^2E[x^2]}=\frac{${texNum(coef, 6)}}{\sigma_v^2}`, why: m('解出 $\\Delta$：分子是負的，所以 $\\Delta>0$ —— Sign-LMS 的固定點比 1.34 大，往 1.4 偏。') },
          ]}
          result={String.raw`w^*_\mathrm{sign}\approx1.34+\frac{3.456\times10^{-4}}{\sigma_v^2}`}
        />
        <TexBlock id="F-11.9">{F.secondOrder}</TexBlock>
      </ModeDetails>
      <Hand id="HC-11.5">
        {m('把上面七行推導代數字走一遍，並算出「要多大的 $\\sigma_v$ 才能把 MSE 解當成 Sign-LMS 的驗收值」（預設重現 $3.456\\times10^{-4}$ 與 0.588）。')}
      </Hand>
      <p>
        把近似和 mean-field 的精確根（Brent root finding，見下方程式碼）放在一起比較。最後一欄是線性化指標 <Tex>{String.raw`\max|e_\mathrm{det}(w^*)|/\sigma_v`}</Tex>：
      </p>
      <div className="table-wrap">
        <table className="ch11-table">
          <thead>
            <tr>
              <th>
                <Tex>{'\\sigma_v'}</Tex>
              </th>
              <th>mean-field 精確根</th>
              <th>二階近似</th>
              <th>近似誤差</th>
              <th>
                <Tex>{String.raw`\max|e_\mathrm{det}|/\sigma_v`}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            {table.map((r) => (
              <tr key={r.sigma} className={[0.05, 0.1, 0.3, 1].includes(r.sigma) ? 'ch11-hl' : undefined}>
                <td className="num">{r.sigma}</td>
                <td className="num">{num(r.exact, 7)}</td>
                <td className="num">{num(r.secondOrder, 7)}</td>
                <td className="num">{num(r.secondOrder - r.exact, 3)}</td>
                <td className="num">{num(r.ratio, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        標色的四列是勘誤 E01 的參考值 1.38314 / 1.36658 / 1.34385 / 1.34035。<Tex>{'\\sigma_v=0.05'}</Tex> 時二階近似給出 &gt; 1.4 的荒謬值 —— 最大殘差已經是雜訊的{' '}
        {num(table.find((r) => r.sigma === 0.05)?.ratio ?? Number.NaN, 3)} 倍，泰勒展開根本不收斂。要讓
        Sign-LMS 的固定點和 1.34 相差 <Tex>{'<10^{-3}'}</Tex>：<Tex>{String.raw`3.456\times10^{-4}/\sigma_v^2<10^{-3}\Rightarrow\sigma_v>0.588`}</Tex>。
      </p>
      <Plot
        title={String.raw`三階 INL 例：$w^*$ 隨 $\sigma_v$ 從 1.4 滑到 1.34`}
        data={plotData}
        layout={SWEEP_LAYOUT}
        height={300}
        xLog
        csvName="ch11-cubic-wstar-vs-sigma"
        caption="mean-field 根由 bias.ts 的 signFixedPoint 計算；二階近似只畫 $<1.45$ 的部分。"
      />

      <h3>
        情境 (3)：無雜訊 Sign-LMS ⇒ 1.4（<Tex>{'|x|'}</Tex> 加權中位數）
      </h3>
      <Prereq title="加權平均與加權中位數：「拔河」與「投票」">
        <p>
          有幾個意見 <Tex>{'t_1,\\dots,t_K'}</Tex>，各帶一個權重 <Tex>{'m_i>0'}</Tex>。要選一個 <Tex>{'w'}</Tex> 代表大家，有兩種常見做法：
        </p>
        <StepDerivation
          steps={[
            {
              tex: String.raw`\text{加權平均：}\sum_i m_i\,(t_i-w)=0\;\Rightarrow\;w=\frac{\sum_i m_i t_i}{\sum_i m_i}`,
              why: m('拔河：每個意見用「離 $w$ 多遠」乘上權重來拉；拉力總和為 0 的地方就是平衡點。離得遠的意見拉得更用力。'),
            },
            {
              tex: String.raw`\text{加權中位數：}\sum_i m_i\operatorname{sign}(t_i-w)=0`,
              why: m('投票：每個意見只說「往上」或「往下」，票的重量是 $m_i$；上下兩邊的總重量相等（各佔一半）的地方就是答案。離多遠不重要。'),
            },
            {
              tex: String.raw`t=(1.1,\,1.4),\ m=(0.4,\,1.6):\ \text{平均}=\tfrac{0.4\cdot1.1+1.6\cdot1.4}{2}=1.34;\qquad t=(1.1,\,1.4),\ m=(0.4,\,0.8):\ \text{中位數}=1.4`,
              why: m('本例的兩種權重：MSE 用 $p\\,x^2$（左），無雜訊 Sign 用 $p\\,|x|$（右）。中位數那邊 1.4 的票重 0.8 已超過總重 1.2 的一半，所以答案就是 1.4。'),
            },
          ]}
        />
        <p className="small">
          這和 Ch01–02 的 <Tex>{'y=[0,0,0,10]'}</Tex> 是同一件事：平均 2.5 會被離群值拉走，中位數 0 不會。微積分的說法：平均讓 <Tex>{String.raw`\sum m_i(t_i-w)^2`}</Tex>{' '}
          最小（對 <Tex>{'w'}</Tex> 微分等於 0），中位數讓 <Tex>{String.raw`\sum m_i|t_i-w|`}</Tex> 最小（<Tex>{'|u|'}</Tex> 的導數是 <Tex>{String.raw`\operatorname{sign}(u)`}</Tex>）。
        </p>
      </Prereq>
      <ModeDetails title={m('一步一步推導：$E[x\\operatorname{sign}(e)]$ 與加權中位數')} openFrom="beginner">
        <StepDerivation
          steps={[
            { tex: String.raw`e=(a-w)x+c_3x^3=x\,\big(t(x)-w\big),\qquad t(x)=a+c_3x^2`, why: m('把 $x$ 提出來：每個 code 的誤差 = $x$ 乘上「它想要的 gain 與目前 gain 的差」。') },
            { tex: String.raw`x\operatorname{sign}(e)=x\operatorname{sign}(x)\operatorname{sign}\big(t(x)-w\big)=|x|\operatorname{sign}\big(t(x)-w\big)`, why: m('$\\operatorname{sign}(xy)=\\operatorname{sign}(x)\\operatorname{sign}(y)$，且 $x\\operatorname{sign}(x)=|x|$。') },
            { tex: String.raw`E[G](w)=\sum_x p(x)\,|x|\operatorname{sign}\big(t(x)-w\big)`, why: m('取期望值：每個 code 投一張「往上 / 往下」的票，票的重量是 $p\\,|x|$。') },
            { tex: String.raw`t(\pm1)=1.1\ (\text{總重 }0.4),\qquad t(\pm2)=1.4\ (\text{總重 }0.8)`, why: m('代入 $a=1$、$c_3=0.1$；$x=0$ 的票重是 0。') },
            { tex: String.raw`1.1<w<1.4:\;E[G]=-0.4+0.8=+0.4;\qquad w>1.4:\;E[G]=-0.4-0.8=-1.2`, why: m('$w$ 小於某個 $t$ 就得到 +重量，大於就得到 −重量。') },
            { tex: String.raw`E[G]\text{ 在 }w=1.4\text{ 由 }+0.4\text{ 跳到 }-1.2\;\Rightarrow\;w^*=1.4`, why: m('零交越發生在跳變處：累積票重越過總重一半（0.6）的那個 $t$ —— 加權中位數。') },
          ]}
        />
        <TexBlock id="F-11.10">{F.weightedMedian}</TexBlock>
      </ModeDetails>
      <p>
        模型即時計算：<Tex>{String.raw`E[G](${steps[0].w})=${texNum(steps[0].g)}`}</Tex>、<Tex>{String.raw`E[G](${steps[1].w})=${texNum(steps[1].g)}`}</Tex>、
        <Tex>{String.raw`E[G](${steps[2].w})=${texNum(steps[2].g)}`}</Tex>；加權中位數 = {num(med.lo)}。<strong>MSE 是平均、無雜訊 Sign 是中位數</strong> —— 這和 Ch01–02 的
        <Tex>{'y=[0,0,0,10]'}</Tex>（平均 2.5、中位數 0）是同一件事。實際的 <Tex>{'w'}</Tex> 不會停在 1.4，而是在它附近以 <Tex>{'O(\\mu)'}</Tex> 的幅度跳動（limit cycle）：在 1.4 以下每個 block 平均上升{' '}
        <Tex>{'0.4\\mu'}</Tex>、以上平均下降 <Tex>{'1.2\\mu'}</Tex>。
      </p>
      <Hand id="HC-11.6">
        {m('自己排一次票：算 4 個 $t(x)$、排序、累加票重找中位數，再和 $x^2$ 加權平均比較。把 $b$ 改成 0.1、$c_3$ 改成 0，會看到 §11.1 的 dead zone。')}
      </Hand>
      <p>兩種成本在三個候選 gain 的值（數字由模型計算）：</p>
      <div className="table-wrap">
        <table className="ch11-table">
          <thead>
            <tr>
              <th>
                <Tex>{'w'}</Tex>
              </th>
              <th>
                MSE <Tex>{'E[e^2]'}</Tex>
              </th>
              <th>
                MAE <Tex>{'E|e|'}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            {costs.map((c, i) => (
              <tr key={i}>
                <td className="num">{num(c.w, 4)}（{i === 0 ? '真實 a' : i === 1 ? 'MSE 解' : '無雜訊 Sign 解'}）</td>
                <td className="num">{num(c.mse, 5)}</td>
                <td className="num">{num(c.mae, 5)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        1.34 讓 MSE 最小、1.4 讓 MAE 最小：兩個都是「正確」的最小化結果，只是最小化的東西不同。真實的 <Tex>{'a=1'}</Tex> 兩者都不是 —— 用一條直線擬合曲線，本來就回不到{' '}
        <Tex>{'a'}</Tex>。
      </p>

      <Callout kind="warn" title="1.34 只屬於這個 code 分布">
        <Erratum id="E11" />{' '}
        {m(
          `同樣 $a=1$、$c_3=0.1$，換一個 code 分布答案就變（MSE-LMS，即時計算）：$\\pm1$ code 時 $E[x^4]/E[x^2]=1\\Rightarrow w^*=${texNum(others.pm, 5)}$；unit Gaussian code 時 $E[x^4]/E[x^2]=3\\Rightarrow w^*=${texNum(others.gauss, 5)}$。`,
        )}
        Preset 與測試都必須連同 code 分布、路徑與演算法一起存檔，否則會把 1.34 誤當成錯的期望值。
      </Callout>
      <ModeDetails title={m('延伸：Gaussian code 的無雜訊 Sign-LMS 也有封閉解 $a+2c_3\\ln2$')}>
        <StepDerivation
          steps={[
            { tex: String.raw`t(x)=a+c_3x^2,\qquad \text{票重 }|x|\,\phi(x)\,dx,\quad \phi(x)=\tfrac{1}{\sqrt{2\pi}}e^{-x^2/2}`, why: m('與 5-level 相同的推導：$e=x(t(x)-w)$，無雜訊 Sign GMAC 是 $t(x)$ 的 $|x|$ 加權中位數；$t$ 只依賴 $x^2$。') },
            { tex: String.raw`s=\tfrac{x^2}{2}\;(x>0):\quad |x|\,\phi(x)\,dx=\tfrac{1}{\sqrt{2\pi}}\,e^{-s}\,ds`, why: m('變數變換 $ds=x\\,dx$；$x<0$ 那一半給出同樣的式子，所以 $s$ 的權重正比於 $e^{-s}$（指數分布）。') },
            { tex: String.raw`\int_0^{s_m}e^{-s}ds=\tfrac12\;\Rightarrow\;1-e^{-s_m}=\tfrac12\;\Rightarrow\;s_m=\ln2`, why: '加權中位數：累積權重等於一半的位置（微積分直接積分）。' },
            { tex: String.raw`w^*=t\big(x_m\big)=a+c_3\cdot2s_m=a+2c_3\ln2=1+0.2\ln2`, why: m('代回 $x_m^2=2s_m$。') },
          ]}
          result={String.raw`w^*_{\sigma_v=0,\ \text{Gaussian}}=${texNum(1 + 0.2 * Math.LN2, 6)}`}
        />
        <p className="small">
          {m(
            `模型的 mean-field 根（斷點積分，$\\sigma_v=0$）：$${texNum(others.gaussNoiseFree, 6)}$；$\\sigma_v=1$ 時 $${texNum(others.gaussSign1, 6)}$；MSE-LMS $${texNum(others.gauss, 6)}$。Gaussian code 的尾端讓殘差 $\\propto x^3$ 很大，所以即使 $\\sigma_v=1$ 也離 MSE 解很遠。`,
          )}{' '}
          <ClaimTag kind="exact" />
        </p>
      </ModeDetails>

      <h3>核心程式碼：加權平均 vs 加權中位數</h3>
      <CodeCompare
        items={[
          { label: 'MSE：加權平均', source: biasSrc, region: 'mseWeightedMean', path: PATH, note: '$E[x\\,e]=E[x^2(t-w)]$：每個 code 的意見依 $x^2$ 加權平均。' },
          {
            label: '無雜訊 Sign：加權中位數',
            source: biasSrc,
            region: 'signWeightedMedian',
            path: PATH,
            note: '$E[x\\operatorname{sign}(e)]=E[|x|\\operatorname{sign}(t-w)]$：只數票（票重 $|x|$），不看差多少。',
          },
        ]}
      />
      <CodeCompare
        items={[
          { label: 'MSE fixed point（封閉解）', source: biasSrc, region: 'mseFixedPoint', path: PATH, note: '$G(w)$ 是直線：兩點決定，直接解。' },
          { label: 'Sign fixed point（mean-field root find）', source: biasSrc, region: 'signFixedPoint', path: PATH, note: '$G(w)$ 經過 erf：從線性化解出發，bracket + Brent。' },
        ]}
        caption="MSE fixed point vs Sign fixed point（mean-field root find）：Lab 與本頁所有 $w^*$ 都由這兩個函式計算。"
      />
      <CodeBlock source={biasSrc} region="signSecondOrder" path={PATH} title="signSecondOrder：erf 三次項的修正" />
      <ModeGate min="research">
        <Callout kind="info" title="Research：為什麼雜訊讓 Sign-LMS 從中位數走向平均？">
          <p>
            因為 <Tex>{String.raw`e_\mathrm{det}=x\,(t(x)-w)`}</Tex>（<Tex>{'t(x)'}</Tex> 依 F-11.11 定義，已含 <Tex>{'b'}</Tex> 與 <Tex>{String.raw`\varepsilon_{cc}`}</Tex>）且 erf
            是奇函數，<Tex>{String.raw`x\operatorname{erf}(x\,u)=|x|\operatorname{erf}(|x|\,u)`}</Tex>，所以 mean-field 的 Sign GMAC 可以寫成
          </p>
          <TexBlock>{String.raw`E[G](w)=\sum_{x\neq0}p(x)\,|x|\operatorname{erf}\!\Big(\frac{|x|\,(t(x)-w)}{\sqrt2\,\sigma_v}\Big)`}</TexBlock>
          <p>
            {m(
              '$\\sigma_v\\to0$ 時 $\\operatorname{erf}\\to\\operatorname{sign}$，每個 code 只投 $\\pm p|x|$ 的票（加權中位數）；$\\sigma_v\\to\\infty$ 時 erf 線性化，票的重量正比於 $p|x|\\cdot|x|(t-w)$（$x^2$ 加權平均）。中間的 $\\sigma_v$ 是兩者的平滑插值 —— 這就是 comparator 雜訊的「dither」作用：它把 1-bit 的量化變回線性的平均資訊，代價是 $K_q$ 變小（收斂變慢）與 $w$ 的抖動變大（Ch12）。',
            )}
          </p>
        </Callout>
      </ModeGate>
    </Section>
  )
}
