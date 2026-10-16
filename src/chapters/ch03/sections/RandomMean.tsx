import { useMemo } from 'react'
import { Callout, ClaimTag, ModeGate, Prereq, Section, SourceTag, Tex, TexBlock, ChRef } from '@/components'
import { createRng, erf, normSf } from '@/simulation/core'
import { meanPole } from '@/simulation/models/lms'
import { drawX, stabilityBounds, xMoments, type XDist } from '@/simulation/models/scalarStability'
import { Erratum, FBlock, Fig, HC, num, StepsBox, T, tnum, tx } from '../common'
import { CHART_ERROR_RECURSION, CHART_MEAN_PATH, CHART_RANDOM_GAIN, figRef } from '../diagrams'

const HAND_SEED = 20261010
const HAND_MU = 0.5

/** 有限 code 的數字例（也是「帶入手算」HC-03.3 的預設值）：等機率的五階 code 與 μ */
const CODE5: XDist = { kind: 'list', values: [-2, -1, 0, 1, 2] }
const CODE5_MU = 0.25

/** 手算例子：Gaussian x 的前 6 筆（seed 固定，示意用；由 drawX 實際抽樣） */
function RandomHandTable() {
  const rows = useMemo(() => {
    const rng = createRng(HAND_SEED).fork('ch03-hand')
    const d: XDist = { kind: 'gaussian', sigma: 1 }
    let delta = 1
    return Array.from({ length: 6 }, (_, n) => {
      const x = drawX(d, rng)
      const f = 1 - HAND_MU * x * x
      const row = { n, x, f, before: delta, after: f * delta }
      delta = f * delta
      return row
    })
  }, [])
  return (
    <div className="table-wrap">
      <table className="ch03-num">
        <thead>
          <tr>
            <th>
              <Tex>n</Tex>
            </th>
            <th>
              <Tex>{T`x_n`}</Tex>
            </th>
            <th>
              <Tex>{T`f_n=1-\mu x_n^2`}</Tex>
            </th>
            <th>
              <Tex>{T`\delta_n`}</Tex>
            </th>
            <th>
              <Tex>{T`\delta_{n+1}=f_n\delta_n`}</Tex>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.n}>
              <td>{r.n}</td>
              <td>{num(r.x, 4)}</td>
              <td>{num(r.f, 4)}</td>
              <td>{num(r.before, 4)}</td>
              <td>{num(r.after, 4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 先備知識：機率密度、Gaussian／Uniform／±A 分布（百分比由 erf / normSf 即時計算） */
function DistributionPrereq() {
  const pct = (k: number) => tnum(100 * erf(k / Math.SQRT2), 4)
  return (
    <Prereq title={T`隨機變數、機率密度，以及 Gaussian（常態）／Uniform（均勻）／$\pm A$ 三種分布`}>
      <p>
        <strong>隨機變數</strong>（random variable）：每次量到的值不固定，但「落在哪裡的機會有多大」是固定的。連續的隨機變數用<strong>機率密度</strong>{' '}
        <Tex>{T`p(x)`}</Tex>（probability density）描述：落在區間 <Tex>{T`[\alpha,\beta]`}</Tex> 的機率是曲線下的面積，總面積為 1：
      </p>
      <TexBlock>{T`P(\alpha\le x\le\beta)=\int_{\alpha}^{\beta} p(x)\,dx,\qquad \int_{-\infty}^{\infty}p(x)\,dx=1`}</TexBlock>
      <ul>
        <li>
          <strong>Gaussian（高斯／常態分布）</strong> <Tex>{T`x\sim\mathcal N(m,\sigma^2)`}</Tex>：鐘形曲線，<Tex>m</Tex> 是中心、<Tex>\sigma</Tex>（標準差）是寬度：
          <TexBlock>{T`p(x)=\frac{1}{\sqrt{2\pi}\,\sigma}\,e^{-(x-m)^2/(2\sigma^2)}`}</TexBlock>
          落在 <Tex>{T`m\pm\sigma`}</Tex> 內的機率是 <Tex>{T`${pct(1)}\%`}</Tex>、<Tex>{T`\pm2\sigma`}</Tex> 內 <Tex>{T`${pct(2)}\%`}</Tex>、<Tex>{T`\pm3\sigma`}</Tex> 內{' '}
          <Tex>{T`${pct(3)}\%`}</Tex>。重點：它<strong>沒有上限</strong>——再大的 <Tex>{T`|x|`}</Tex> 都有（很小的）機率出現。<Tex>{T`\mathcal N(0,1)`}</Tex>（<Tex>{T`m=0,\ \sigma=1`}</Tex>）叫標準常態。
          熱雜訊、許多獨立小擾動的總和都近似 Gaussian。
        </li>
        <li>
          <strong>Uniform（均勻分布）</strong> <Tex>{T`x\sim U(-c,c)`}</Tex>：在 <Tex>{T`[-c,c]`}</Tex> 內每個值機會均等，<Tex>{T`p(x)=\frac{1}{2c}`}</Tex>；<strong>有上限</strong>{' '}
          <Tex>{T`|x|\le c`}</Tex>。量化殘差（例如一階 <Tex>{T`\Delta\Sigma`}</Tex> 調變器的 residue）常近似這種分布。
        </li>
        <li>
          <strong><Tex>{T`\pm A`}</Tex>（bipolar code）</strong>：只取 <Tex>{T`+A`}</Tex> 或 <Tex>{T`-A`}</Tex>，各一半機率；<Tex>{T`|x|`}</Tex> 恆為 <Tex>A</Tex>。
        </li>
      </ul>
      <p>
        本章會反覆看到：<strong>分布有沒有「偶爾出現的大值」</strong>，決定了三種收斂界限差多少。<Tex>{T`\pm A`}</Tex> 完全沒有大值（三個界限相同），Gaussian 的尾巴最長（界限差最多）。
      </p>
    </Prereq>
  )
}

/** 本章反覆使用的四個例子；label 給圖例（字串中的數學寫 `$…$`，Plot 轉成斜體符號），tex 給表格（KaTeX） */
export const EXAMPLE_DISTS: { label: string; tex: string; dist: XDist }[] = [
  { label: T`Gaussian $\mathcal N(0,1)$`, tex: T`\text{Gaussian }\mathcal N(0,1)`, dist: { kind: 'gaussian', sigma: 1 } },
  { label: T`Uniform $U(-\sqrt{3},\ \sqrt{3})$`, tex: T`\text{Uniform }U(-\sqrt3,\sqrt3)`, dist: { kind: 'uniform', halfWidth: Math.sqrt(3) } },
  { label: T`$\pm1$（bipolar code）`, tex: T`\pm1\ \text{(bipolar code)}`, dist: { kind: 'pm_one', amplitude: 1 } },
  { label: T`稀疏 code $\{0\times9,\ 3\}$`, tex: T`\text{稀疏 code }\{0\times9,\ 3\}`, dist: { kind: 'list', values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 3] } },
]

export function RandomMeanSection() {
  const g = xMoments({ kind: 'gaussian', sigma: 1 })
  const gb = useMemo(() => stabilityBounds({ kind: 'gaussian', sigma: 1 }), [])
  const c5 = xMoments(CODE5)
  return (
    <>
      <h2 id="random-mean">2｜隨機輸入：平均誤差（Mean）</h2>
      <Section kind="intuition" title="這一節要回答的問題">
        <p>
          真實的 PLL 校正裡，regressor 不是固定的 <Tex>{T`x=2`}</Tex>：DSM / DTC code 每個 sample 都在變。推導完全一樣，只是<strong>每一步的乘法因子都不同</strong>：
        </p>
        <TexBlock>{T`\delta_{n+1}=\underbrace{(1-\mu x_n^2)}_{f_n\ \text{（每步不同）}}\,\delta_n\qquad\Longrightarrow\qquad \delta_n=\delta_0\prod_{k=0}^{n-1}(1-\mu x_k^2)`}</TexBlock>
        <p>
          現在 <Tex>{T`\delta_n`}</Tex> 是<strong>隨機變數</strong>：同一個 <Tex>\mu</Tex>、同一個 <Tex>{T`\delta_0`}</Tex>，換一組 <Tex>{T`x_0,x_1,\dots`}</Tex> 就得到不同的路徑。要談「收斂」，就必須先說清楚是哪一種：
          本章會遇到三種——<strong>平均（mean）</strong>、<strong>均方（mean-square）</strong>、<strong>幾乎每條路徑（almost-sure）</strong>。
        </p>
        <p>
          畫成方塊圖：和{figRef(CHART_ERROR_RECURSION)} 的「合併之後」是同一個迴圈，只是固定的增益 <Tex>p</Tex> 換成了由 <Tex>{T`x[n]`}</Tex> 即時算出來的增益 <Tex>{T`f[n]`}</Tex>（time-varying gain，隨時間變的增益）。
        </p>
        <Fig
          chart={CHART_RANDOM_GAIN}
          caption={T`隨機輸入時，迴圈增益 $f_n=1-\mu x_n^2$ 每一步都不同。看乘法點（藍）的兩個輸入：一個來自「這一步」的 $x_n$，另一個只含「過去」的 $x$——兩者獨立。`}
          ariaLabel="x n 進入算增益的方塊，輸出每步不同的增益 f n 等於 1 減 mu x n 平方；它與延遲一步回來的 delta n 相乘得到 delta n 加 1"
        />
        <p>
          先看左邊：<Tex>{T`x[n]`}</Tex> 進到「算這一步的增益」方塊（平方、乘 <Tex>\mu</Tex>、再用 1 去減），輸出 <Tex>{T`f[n]`}</Tex>——就是上式的 <Tex>{T`f_n=1-\mu x_n^2`}</Tex>。再看乘法點的另一個輸入：
          <Tex>{T`\delta[n]`}</Tex> 是從 <Tex>{T`z^{-1}`}</Tex> 出來的，只由過去的 <Tex>{T`x[0],\dots,x[n-1]`}</Tex> 決定。所以乘法點的兩個輸入<strong>互相獨立</strong>——下面能把期望值拆開，靠的就是這一點。
        </p>
      </Section>

      <Section kind="example" title={tx`先算一次：Gaussian $x$、$\mu=0.5$、$\delta_0=1$`}>
        <DistributionPrereq />
        <p>
          從標準 Gaussian <Tex>{T`\mathcal N(0,1)`}</Tex> 抽 6 筆 <Tex>{T`x_n`}</Tex>，每一步照 <Tex>{T`\delta_{n+1}=(1-\mu x_n^2)\delta_n`}</Tex> 更新：
        </p>
        <RandomHandTable />
        <p>
          大部分 <Tex>{T`|f_n|<1`}</Tex>（誤差縮小），但只要某一筆 <Tex>{T`x_n^2>2/\mu=4`}</Tex>（即 <Tex>{T`|x_n|>2`}</Tex>，機率{' '}
          <Tex>{T`2\,(1-\Phi(2))\approx${tnum(200 * normSf(2), 3)}\%`}</Tex>；<Tex>{T`\Phi(z)`}</Tex> 是標準 Gaussian 落在 <Tex>z</Tex> 以下的機率，第 5 節的先備知識有完整說明），<Tex>{T`|f_n|>1`}</Tex> 就會把誤差放大。誤差是一連串<strong>隨機因子的乘積</strong>。
          <SourceTag kind="illustrative" />（seed {HAND_SEED}，由 <code>drawX</code> 實際抽樣）
        </p>
      </Section>

      <Section kind="formula" title="定義兩個輸入統計量">
        <Prereq title="期望值、線性、獨立（expectation / independence）">
          <p>
            <strong>期望值</strong>（expectation）= 「重複做很多次的平均」。離散：<Tex>{T`E[X]=\sum_i p_i x_i`}</Tex>；連續（機率密度 <Tex>{T`p(x)`}</Tex>）：
            <Tex>{T`E[X]=\int x\,p(x)\,dx`}</Tex>，<Tex>{T`E[g(X)]=\int g(x)\,p(x)\,dx`}</Tex>。
          </p>
          <p>
            <strong>線性</strong>：對任何常數 <Tex>{T`c_1,c_2`}</Tex>，<Tex>{T`E[c_1X+c_2Y]=c_1E[X]+c_2E[Y]`}</Tex>——因為積分是線性的（不需要 <Tex>X</Tex>、<Tex>Y</Tex> 獨立）。
          </p>
          <p>
            <strong>獨立</strong>（independent）：聯合密度可以拆成乘積 <Tex>{T`p(x,y)=p_X(x)\,p_Y(y)`}</Tex>。此時二重積分分離：
          </p>
          <TexBlock>{T`E[XY]=\iint xy\,p_X(x)p_Y(y)\,dx\,dy=\Big(\int x\,p_X(x)\,dx\Big)\Big(\int y\,p_Y(y)\,dy\Big)=E[X]\,E[Y]`}</TexBlock>
          <p>
            同理 <Tex>{T`E[g(X)h(Y)]=E[g(X)]\,E[h(Y)]`}</Tex>：<strong>獨立變數的函數仍然獨立</strong>。不獨立時這個拆法一般不成立（例：<Tex>{T`Y=X`}</Tex> 時 <Tex>{T`E[X^2]\ne E[X]^2`}</Tex>）。
          </p>
          <p>
            <strong>iid</strong>（independent and identically distributed）：每一筆 <Tex>{T`x_n`}</Tex> 來自同一個分布，且彼此獨立。
          </p>
        </Prereq>
        <TexBlock>{T`P_x\equiv E[x^2]\ \ \text{（輸入功率）},\qquad M_4\equiv E[x^4]\ \ \text{（四階動差）},\qquad \kappa\equiv\frac{M_4}{P_x^2}\ \ \text{（kurtosis）}`}</TexBlock>
        <p>
          標準 Gaussian：<Tex>{T`P_x=${tnum(g.Px)},\ M_4=${tnum(g.M4)},\ \kappa=${tnum(g.kurtosis)}`}</Tex>（下一節用分部積分證明）。
        </p>
        <Callout kind="info" title={tx`名詞：本章的 $\kappa$ 用「對原點」的動差`}>
          <strong>動差</strong>（moment）：<Tex>{T`E[x^k]`}</Tex> 叫 <Tex>k</Tex> 階動差。統計課本的 <strong>kurtosis（峰度）</strong>通常先減掉平均：
          <Tex>{T`E[(x-m)^4]/\operatorname{Var}(x)^2`}</Tex>。本章的 <Tex>\kappa</Tex> 一律是<strong>不減平均</strong>的 <Tex>{T`E[x^4]/E[x^2]^2`}</Tex>，因為誤差遞迴裡出現的就是{' '}
          <Tex>{T`x^2`}</Tex> 與 <Tex>{T`x^4`}</Tex> 本身。<Tex>x</Tex> 零均值（Gaussian、對稱 Uniform、<Tex>{T`\pm A`}</Tex>）時兩者相同；<Tex>x</Tex> 帶有 DC 偏移（例如固定{' '}
          <Tex>{T`x=2`}</Tex>：<Tex>{T`\kappa=1`}</Tex>；稀疏 code <Tex>{T`\{0\times9,\,3\}`}</Tex>：<Tex>{T`\kappa=${tnum(xMoments(EXAMPLE_DISTS[3].dist).kurtosis)}`}</Tex>）時不同，
          套本章公式時要用 <Tex>{T`E[x^4]/E[x^2]^2`}</Tex>。<Tex>\kappa</Tex> 越大，代表 <Tex>{T`x^2`}</Tex> 起伏越劇烈（偶爾出現很大的值）。
        </Callout>
      </Section>

      <Section kind="formula" title="一步一步推導 mean 遞迴（為什麼可以拆開期望值）">
        <p>
          每條路徑的增益都在亂跳，沒辦法直接套等比數列。但如果只問「很多條路徑的<strong>平均</strong>」，隨機增益就可以換成它自己的平均值。下圖一框是一條路徑，另一框是兩邊取期望值之後：
        </p>
        <Fig
          chart={CHART_MEAN_PATH}
          caption={T`取期望值，把隨機增益（褐）換成固定增益 $1-\mu P_x$（藍）：平均誤差 $E[\delta_n]$ 又是一個等比數列。`}
          ariaLabel="一框是一條路徑的迴圈，增益 f n 每步不同；另一框是取期望值後的迴圈，E delta n 每步乘上固定增益 1 減 mu P x"
        />
        <p>
          先看「一條路徑」那一框：乘法點的增益 <Tex>{T`f[n]`}</Tex> 每一步不同（褐色）。再看「兩邊取期望值」那一框（線上的 <Tex>{T`E[\delta[n]]`}</Tex>、<Tex>{T`E[\delta[n+1]]`}</Tex> 就是兩邊取期望值之後的誤差）：因為 <Tex>{T`x[n]`}</Tex> 與 <Tex>{T`\delta[n]`}</Tex> 獨立，
          <Tex>{T`E[f\cdot\delta]=E[f]\cdot E[\delta]`}</Tex>，隨機增益被換成固定增益 <Tex>{T`E[f]=1-\mu P_x`}</Tex>（藍色），迴圈又回到第 1 節那種等比數列。圖上的「
          <Tex>{T`\times\,(1-\mu P_x)`}</Tex>」就是下面推導的最後一行，也是 F-03.5 的 mean pole。
        </p>
        <StepsBox
          title={tx`$E[\delta_{n+1}]=(1-\mu P_x)\,E[\delta_n]$`}
          steps={[
            { tex: T`\delta_{n+1}=(1-\mu x_n^2)\,\delta_n`, why: tx`第 1 節的推導每一步都只用到「這一筆」的 $x$，把 $x$ 換成 $x_n$ 照樣成立（無雜訊）。` },
            { tex: T`\delta_n=\delta_0\prod_{k=0}^{n-1}(1-\mu x_k^2)`, why: tx`反覆代入：$\delta_n$ 只由 $\delta_0$ 與「過去」的 $x_0,\dots,x_{n-1}$ 決定。` },
            { tex: T`x_n\ \perp\!\!\!\perp\ (x_0,\dots,x_{n-1})\ \Rightarrow\ x_n\ \perp\!\!\!\perp\ \delta_n`, why: tx`符號 $\perp\!\!\!\perp$ 讀作「獨立於」。iid：$x_n$ 與過去的樣本獨立；$\delta_n$ 是過去樣本的函數，所以也與 $x_n$ 獨立（勘誤 E38：這是自動成立的，不是額外假設）。` },
            { tex: T`E[\delta_{n+1}]=E\big[(1-\mu x_n^2)\,\delta_n\big]`, why: '兩邊取期望值。' },
            { tex: T`=E\big[1-\mu x_n^2\big]\;E[\delta_n]`, why: '獨立變數乘積的期望值 = 期望值的乘積（先備知識）。' },
            { tex: T`=(1-\mu E[x_n^2])\,E[\delta_n]=(1-\mu P_x)\,E[\delta_n]`, why: tx`線性；同分布，所以每個 $n$ 的 $E[x_n^2]$ 都等於 $P_x$。` },
          ]}
          result={T`E[\delta_{n+1}]=(1-\mu P_x)\,E[\delta_n]`}
        />
        <p>
          這和第 1 節是同一個等比數列，只是把 <Tex>{T`x^2`}</Tex> 換成 <Tex>{T`P_x`}</Tex>：<Tex>{T`E[\delta_n]=(1-\mu P_x)^n\delta_0`}</Tex>，所以
        </p>
        <FBlock id="F-03.5" />
        <p>
          標準 Gaussian：<Tex>{T`0<\mu<${tnum(gb.meanMax)}`}</Tex>（T03 的 mean 上限）。<ClaimTag kind="exact" />
        </p>
        <p>
          有限個取值的 code 也是同一個公式，而且完全可以手算。例如等機率的五階 code <Tex>{T`\{-2,-1,0,1,2\}`}</Tex>：
          <Tex>{T`P_x=\tfrac{4+1+0+1+4}{5}=${tnum(c5.Px)}`}</Tex>、<Tex>{T`M_4=\tfrac{16+1+0+1+16}{5}=${tnum(c5.M4)}`}</Tex>、<Tex>{T`\kappa=M_4/P_x^2=${tnum(c5.kurtosis)}`}</Tex>，
          所以 mean 界是 <Tex>{T`2/P_x=${tnum(2 / c5.Px)}`}</Tex>；取 <Tex>{T`\mu=${tnum(CODE5_MU)}`}</Tex> 時 mean 因子 <Tex>{T`1-\mu P_x=${tnum(meanPole(CODE5_MU, c5.Px))}`}</Tex>，
          <Tex>{T`E[\delta_n]`}</Tex> 每一步減半。<ClaimTag kind="exact" />
        </p>
        <HC id="HC-03.3">
          {tx`真實的 code 不是 Gaussian，而是有限個取值。把下面 5 個取值換成你的 code（例如 $\{-1,0,0,1,2\}$），先手算 $P_x$、$M_4$、$\kappa$ 與 mean 界（只需要四則運算），再對答案。`}
        </HC>
        <Callout kind="info" title={<>精確式，不是 independence approximation <Erratum id="E38" /></>}>
          規格 §3.1 寫「假設 <Tex>{T`x_n`}</Tex> 為 iid、且和前一輪係數誤差獨立」。後半句其實是<strong>自動成立</strong>的（上面第 3 步），所以對 iid 純量 <Tex>x</Tex>（<Tex>{T`M_4`}</Tex> 有限、雜訊零均值且與 <Tex>x</Tex> 獨立），
          mean 與 mean-square 遞迴都是 <strong>[精確｜指定模型]</strong>。反過來，若 regressor 有時間相關——例如 tapped delay line，或第 6–7 章經過 PLL error path 的{' '}
          <Tex>{T`u=h*x`}</Tex>（<Tex>h</Tex> 是 error path 的脈衝響應、<Tex>{T`*`}</Tex> 是卷積，也就是把 <Tex>x</Tex> 的過去幾筆加權相加；<ChRef ch="06">第 6 章</ChRef>從頭說明）——<Tex>{T`x_n`}</Tex> 與 <Tex>{T`\delta_n`}</Tex> 不再獨立，同樣的公式降為 <strong>[近似｜需驗證]</strong>。
          （<strong>相關</strong> correlation：相鄰 sample 彼此有關，例如 <Tex>{T`E[x_nx_{n-1}]\ne0`}</Tex>；此時 <Tex>{T`x_n`}</Tex> 透過 <Tex>{T`x_{n-1}`}</Tex> 與 <Tex>{T`\delta_n`}</Tex> 牽連在一起。）
        </Callout>
      </Section>

      <Section kind="assumptions" title="Mean 只說了「平均」">
        <p>
          <Tex>{T`\mu=1/P_x`}</Tex> 時 mean pole 為 0：<Tex>{T`E[\delta_1]=0`}</Tex>，「平均」一步歸零。但每一條路徑的 <Tex>{T`\delta_1=(1-\mu x_0^2)\delta_0`}</Tex> 幾乎都不是 0——
          有的路徑 <Tex>{T`\delta_1>0`}</Tex>、有的 <Tex>{T`\delta_1<0`}</Tex>，<strong>正負互相抵消</strong>才讓平均等於 0。所以 mean 收斂只是最弱的保證：它甚至不保證誤差的大小會變小。
          下一節用平方把正負號拿掉。
        </p>
        <ModeGate min="engineer">
          <p>
            更極端的反例（第 4 節與 Stability Lab 的「稀疏 code」preset）：<Tex>{T`x\in\{0,\dots,0,3\}`}</Tex>（10 筆中 1 筆是 3），<Tex>{T`\mu=0.5`}</Tex>。mean pole{' '}
            <Tex>{T`1-\mu P_x=${tnum(1 - 0.5 * xMoments(EXAMPLE_DISTS[3].dist).Px)}`}</Tex>，<Tex>{T`E[\delta_n]`}</Tex> 收斂；但每次抽到 3 就乘上 <Tex>{T`1-0.5\cdot9=-3.5`}</Tex>，
            幾乎每條路徑都發散。平均收斂是靠正負號交替抵消出來的。
          </p>
        </ModeGate>
      </Section>
    </>
  )
}
