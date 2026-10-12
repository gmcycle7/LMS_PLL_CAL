import { useMemo } from 'react'
import { Callout, ClaimTag, CodeBlock, CodeCompare, ModeGate, Prereq, Section, SourceTag, StepDerivation, Tex, TexBlock } from '@/components'
import { erf } from '@/simulation/core'
import gmacSrc from '@/simulation/models/gmac.ts?raw'
import {
  blockUpdate,
  bugFixedPointGaussian,
  bugMeanGmac,
  comparatorBit,
  decodeComparator,
  gmacAverage,
  gmacRunningSum,
  gmacSum,
  negateExtended,
  negateInplace,
  sumAverageTable,
  unmappedUpdateAtTruth,
  wrapTwos,
} from '@/simulation/models/gmac'
import { SignalFlowExperiment } from '../experiments/SignalFlowExperiment'
import { BitEncodingExperiment } from '../experiments/BitEncodingExperiment'
import { BIT_MAPPING, GMAC_MEAN_MODEL, NEGATE_DATAPATH, SUM_VS_AVERAGE } from '../diagrams'
import { DerivationFold, Erratum, f, FigRef, HandCalcBox, MermaidFig, tx, mt } from '../common'

const R = String.raw
const GMAC_PATH = 'src/simulation/models/gmac.ts'

/** 手算例子（illustrative 輸入；表內所有衍生數字由 gmac.ts 計算） */
export const HAND_GMAC = {
  a: 3,
  w: 1,
  mu: 2,
  x: [1, -1, 1, -1],
  v: [0.5, 1.5, -3.0, -0.5],
}

export function handGmac() {
  const { a, w, mu, x, v } = HAND_GMAC
  const delta = a - w
  const e = x.map((xi, i) => delta * xi + v[i])
  const b = e.map((ei) => comparatorBit(ei))
  const q = b.map((bi) => decodeComparator(bi, 'bipolar_pm_one'))
  const S = gmacRunningSum(q, x)
  const G = gmacAverage(q, x)
  const Ssum = gmacSum(q, x)
  const wAvg = blockUpdate(w, q, x, mu, 'average')
  const wSum = blockUpdate(w, q, x, mu, 'sum')
  const qBug = b.map((bi) => decodeComparator(bi, 'unipolar_unmapped_bug'))
  const Gbug = gmacAverage(qBug, x)
  const xbar = x.reduce((s, xi) => s + xi, 0) / x.length
  return { delta, e, b, q, S, G, Ssum, wAvg, wSum, Gbug, xbar }
}

export function GmacMathSection() {
  const h = useMemo(() => handGmac(), [])
  const { a, w, mu, x, v } = HAND_GMAC
  // 規格 §5 的例子：σ_v = 100 fs、誤差 1 fs ⇒ m = E[q] = erf(0.01/√2)
  const m = erf(0.01 / Math.SQRT2)
  const N5 = 10000
  const table = useMemo(
    () =>
      sumAverageTable({
        mu: 10,
        sigmaV: 100,
        C: 1,
        Ex2: 1,
        Ns: [1, 16, 256, 4096, 16384],
      }),
    [],
  )
  const half6 = 2 ** 5
  const dcCodes = [-1, -0.5, 0, 0.5, 1, 1.5]
  const dcUpdate = unmappedUpdateAtTruth(dcCodes)
  const Kq100 = Math.sqrt(2 / Math.PI) / 100
  const bugLin = a + 0.5 / (Kq100 * 1.25)
  // 忘了映射＋Gaussian code N(0.5, 1)：F-04.16 的封閉式精確根（不依賴取樣）
  const bugEx = bugFixedPointGaussian({
    codeMean: 0.5,
    codeSigma: 1,
    sigmaV: 100,
    aTrue: a,
  })
  const bugSmall = [100, 10, 1].map((sv) => ({
    sv,
    dw:
      bugFixedPointGaussian({
        codeMean: 0.5,
        codeSigma: 1,
        sigmaV: sv,
        aTrue: a,
      }).wStar - a,
  }))
  const hAtRoot = bugMeanGmac(bugEx.xi, 0.5, 1)
  return (
    <Section kind="formula" title="§4 GMAC 的數學：它在估計什麼？sum 和 average 差在哪？" level={2} id="ch04-gmac">
      <p>
        GMAC（gradient multiply-accumulate）只做一件事：把一個 block 內的 <Tex>{R`q[n]\cdot x_\mathrm{ref}[n]`}</Tex> 加起來。 它的意義是「
        <strong>
          用 <Tex>N</Tex> 個 sample 的平均，估計 comparator 輸出和 code 的相關
        </strong>
        」。如果 DTC gain 太小（<Tex>{R`\delta>0`}</Tex>）， PD 殘差 <Tex>{R`\delta x`}</Tex> 和 code 同號，<Tex>q</Tex> 傾向和 <Tex>x</Tex> 同號，乘積平均為正，於是 <Tex>w</Tex> 往上加；反之往下減。
      </p>
      <MermaidFig
        chart={GMAC_MEAN_MODEL}
        caption={R`GMAC 在估計什麼。左欄是真正發生的事（每個 sample 一次，最後平均成 $G_k$）；右欄是對雜訊取平均之後的等效。看右欄的兩個藍色方塊：整條路徑平均起來只剩兩個增益 $K_q$ 與 $C$。`}
        ariaLabel="GMAC 的實際訊號路徑與取期望值後的小訊號等效"
      />
      <p>
        <strong>先看左欄</strong>（實際訊號，由上往下）：gain 誤差 <Tex>{R`\delta_k=a-w_k`}</Tex> 乘上有效 regressor <Tex>{R`u[n]`}</Tex>（code 經過 PLL 誤差路徑後的樣子；PD 直接看到 DTC 誤差時{' '}
        <Tex>{R`u=x`}</Tex>），加上雜訊 <Tex>{R`v[n]`}</Tex> 得到 PD 的輸出 <Tex>{R`e[n]`}</Tex>（comparator 取的就是它）；comparator 只留下正負號 <Tex>{R`q[n]`}</Tex>；再乘上對齊的 code <Tex>{R`x_\mathrm{ref}[n]`}</Tex>；最後把一個 block 的{' '}
        <Tex>N</Tex> 筆平均起來成為 <Tex>{R`G_k`}</Tex>。下面「先算一次」的表格，每一欄就是左欄的一個方塊。
      </p>
      <p>
        <strong>再看右欄</strong>：對雜訊取期望值之後，「加雜訊 + sign」這個非線性組合平均起來像一個線性增益 <Tex>{R`K_q=\sqrt{2/\pi}/\sigma_v`}</Tex>（雜訊越大，同樣的誤差越難看出來，增益越小），
        「兩個乘法 + 平均」變成相關 <Tex>{R`C=E[x_\mathrm{ref}u]`}</Tex>。所以 GMAC 的平均正比於 gain 誤差：<Tex>{R`E[G_k]\approx K_qC\,\delta_k`}</Tex>，比例係數記成 <Tex>{R`K=K_qC`}</Tex>（GMAC 對{' '}
        <Tex>{R`\delta`}</Tex> 的平均斜率，單位 <Tex>{R`\mathrm{fs}^{-1}`}</Tex>）。這就是後面 F-04.4 要一步一步推導的結果。
      </p>


      <h3>
        先算一次：<Tex>{R`N=4`}</Tex> 的一個 block
      </h3>
      <p>
        取 <Tex>{R`a=${a},\;w=${w}`}</Tex>（所以 <Tex>{R`\delta=a-w=${h.delta}\,\mathrm{fs}`}</Tex>），code <Tex>{R`x=[${x.join(',')}]`}</Tex>，雜訊 <Tex>{R`v=[${v.join(',')}]\,\mathrm{fs}`}</Tex>，
        <Tex>{R`\mu=${mu}\,\mathrm{fs}`}</Tex> <SourceTag kind="illustrative" />。
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <Tex>n</Tex>
              </th>
              <th>
                <Tex>{R`x[n]`}</Tex>
              </th>
              <th>
                <Tex>{R`\delta x[n]`}</Tex>
              </th>
              <th>
                <Tex>{R`v[n]`}</Tex>
              </th>
              <th>
                <Tex>{R`e=\delta x+v`}</Tex>
              </th>
              <th>
                <Tex>{R`b=(e\ge0)`}</Tex>
              </th>
              <th>
                <Tex>{R`q=2b-1`}</Tex>
              </th>
              <th>
                <Tex>{R`q\,x`}</Tex>
              </th>
              <th>
                累加 <Tex>S</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            {x.map((xi, i) => (
              <tr key={i}>
                <td className="num">{i}</td>
                <td className="num">{xi}</td>
                <td className="num">{h.delta * xi}</td>
                <td className="num">{v[i]}</td>
                <td className="num">{f(h.e[i], 4)}</td>
                <td className="num">{h.b[i]}</td>
                <td className="num">{h.q[i]}</td>
                <td className="num">{h.q[i] * xi}</td>
                <td className="num">{h.S[i]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TexBlock>
        {R`S=${h.Ssum},\quad G=\frac{S}{N}=\frac{${h.Ssum}}{4}=${tx(h.G)}\;\Rightarrow\;w_\mathrm{avg}=w+\mu G=${w}+${mu}\times${tx(h.G)}=${tx(h.wAvg)},\qquad w_\mathrm{sum}=w+\mu S=${w}+${mu}\times${h.Ssum}=${tx(h.wSum)}`}
      </TexBlock>
      <p>
        注意第 1 拍：<Tex>{R`\delta x=-2`}</Tex> 但雜訊 <Tex>{R`+1.5`}</Tex> 讓 <Tex>e</Tex> 只剩 <Tex>{R`-0.5`}</Tex>，方向還是對的；第 2 拍雜訊 <Tex>{R`-3`}</Tex> 把正確的 <Tex>{R`+2`}</Tex> 翻成{' '}
        <Tex>{R`-1`}</Tex>，<Tex>{R`q\,x=-1`}</Tex> 是「投錯票」。4 票裡 3 票對，所以平均是正的。average 模式把 <Tex>w</Tex> 從 1 推到 {f(h.wAvg)}
        （更接近 <Tex>{R`a=3`}</Tex>）； sum 模式同一個 <Tex>{R`\mu`}</Tex> 卻推到 {f(h.wSum)}，<strong>直接衝過頭</strong>——這是 <Tex>{R`N=4`}</Tex> 的情形，<Tex>{R`N=4096`}</Tex> 時會放大 4096 倍。
      </p>
      <HandCalcBox id="HC-04.2">
        把 <Tex>a</Tex>、<Tex>w</Tex>、四拍的 code 和雜訊換成你自己的數字（雜訊可以故意給大一點，看它翻掉幾票），照上面的表格在紙上累加一個 block，算出 <Tex>S</Tex>、<Tex>G</Tex> 和兩種更新後的{' '}
        <Tex>w</Tex>，再對答案。
      </HandCalcBox>

      <h3>GMAC 的平均：一步一步推導</h3>
      <p className="small muted">
        先備知識：期望值、變異數、相關，以及 Gaussian、<Tex>{R`\Phi`}</Tex>、<Tex>{R`\mathrm{erf}`}</Tex> 的可展開說明框在 §3（第一次用到的地方）。推導的每一步對應 <FigRef chart={GMAC_MEAN_MODEL} />{' '}
        的方塊：第 3–5 步把左欄的「加雜訊 + sign」換成右欄的 <Tex>{R`K_q`}</Tex>，第 6 步把「乘 <Tex>{R`x_\mathrm{ref}`}</Tex> 再平均」換成 <Tex>C</Tex>。
      </p>
      <DerivationFold title={mt(R`$E[G_k]\approx K_qC\,\delta_k$`)}>
        <StepDerivation
          steps={[
            {
              tex: R`G_k=\frac1N\sum_{n\in k}q[n]\,x_\mathrm{ref}[n]`,
              why: mt(R`GMAC 平均的定義（§0；勘誤 E07 / E18：總和另記為 $S_k$）。`),
            },
            {
              tex: R`E[G_k\mid\delta_k]=\frac1N\sum_{n}x_\mathrm{ref}[n]\;E\bigl[q[n]\bigr]`,
              why: mt(R`給定 code 時 $x_\mathrm{ref}$ 是確定的，只有雜訊 $v$ 是隨機；期望值是線性的，可以搬進求和。`),
            },
            {
              tex: R`E\bigl[q[n]\bigr]=P(e\ge0)-P(e<0)=2\Phi\Bigl(\frac{\delta_ku[n]}{\sigma_v}\Bigr)-1`,
              why: mt(R`$e=\delta u+v$，$v\sim\mathcal N(0,\sigma_v^2)$：$P(e\ge0)=P(v\ge-\delta u)=\Phi(\delta u/\sigma_v)$。tie（$e=0$）判 $+1$ 不影響機率（連續分布下 $P(e=0)=0$）。`),
            },
            {
              tex: R`=\mathrm{erf}\Bigl(\frac{\delta_ku[n]}{\sqrt2\,\sigma_v}\Bigr)\approx\sqrt{\frac2\pi}\,\frac{\delta_ku[n]}{\sigma_v}`,
              why: mt(R`$2\Phi(z)-1=\mathrm{erf}(z/\sqrt2)$；$|\delta u|\ll\sigma_v$ 時取一階泰勒展開 $\mathrm{erf}(z)\approx2z/\sqrt\pi$。`),
            },
            {
              tex: R`=K_q\,\delta_k\,u[n],\qquad K_q=\frac{\sqrt{2/\pi}}{\sigma_v}\;[\mathrm{fs}^{-1}]`,
              why: mt(R`把常數收成 comparator 的小訊號增益 $K_q$。`),
            },
            {
              tex: R`E[G_k\mid\delta_k]\approx K_q\,\delta_k\cdot\frac1N\sum_nx_\mathrm{ref}[n]\,u[n]=K_qC\,\delta_k`,
              why: mt(R`代回第 2 步；$C=E[x_\mathrm{ref}u]$ 是 regressor 與有效 regressor 的相關（identity path、$x_\mathrm{ref}=x$ 時 $C=E[x^2]$）。`),
            },
          ]}
          result={R`E[G_k]\approx K\,\delta_k,\quad K=K_qC\;[\mathrm{fs}^{-1}]`}
        />
        <p className="small">
          <ClaimTag kind="approx" /> 小訊號近似，相對誤差約 <Tex>{R`(\delta u/\sigma_v)^2/6`}</Tex>。第 3 步的 <Tex>{R`e=\delta_ku+v`}</Tex> 在 PLL 誤差路徑有記憶（<Tex>{R`u\ne x`}</Tex>）時另需{' '}
          <Tex>w</Tex> 在 <Tex>h</Tex> 的記憶長度內近似不變（§3 推導的第 1 步，Ch06 的 F-06.1）；identity path（<Tex>{R`u=x`}</Tex>）時是等式。<Tex>K</Tex> 的單位是 <Tex>{R`\mathrm{fs}^{-1}`}</Tex>、
          <Tex>{R`\mu`}</Tex> 的單位是 <Tex>{R`\mathrm{fs}`}</Tex>，乘起來 <Tex>{R`g=\mu K`}</Tex> 無因次 <Erratum id="E13" />
          。若 <Tex>{R`C\le0`}</Tex>（PLL 路徑相位 &gt; 90° 或 code 錯位），平均更新方向相反（Ch06、Ch07）。
        </p>
      </DerivationFold>
      <TexBlock id="F-04.3" label="GMAC 的總和與平均（勘誤 E07 / E18 的記號）">
        {R`S_k=\sum_{n=kN}^{kN+N-1}q[n]\,x_\mathrm{ref}[n],\qquad G_k=\frac{S_k}{N}`}
      </TexBlock>
      <TexBlock id="F-04.4" label="GMAC 的平均（小訊號）">
        {R`E[G_k\mid\delta_k]=\frac1N\sum_n x_\mathrm{ref}[n]\,\mathrm{erf}\!\Bigl(\frac{\delta_k u[n]}{\sqrt2\,\sigma_v}\Bigr)\approx K_qC\,\delta_k=K\delta_k`}
      </TexBlock>

      <h3>
        Sum vs average：同一個 <Tex>{R`\mu`}</Tex>，loop gain 差 <Tex>N</Tex> 倍
      </h3>
      <p>
        GMAC 累加器吐出來的是總和 <Tex>{R`S_k`}</Tex>，它的大小跟著 <Tex>N</Tex> 成長（累加越久數字越大）；更新式要的是平均 <Tex>{R`G_k=S_k/N`}</Tex>。RTL 上「<Tex>{R`\div N`}</Tex>」只是一個右移，
        很容易被省掉，或在和「<Tex>{R`\times\mu`}</Tex>」合併時算錯位數。下圖把三種接法並排：
      </p>
      <MermaidFig
        chart={SUM_VS_AVERAGE}
        caption={R`Sum 與 average 的 scaling 路徑。三條路徑從同一個 $S_k$ 出發，差別只在有沒有「$\div N$」；看每條路徑最下面的 loop gain $g$：紅色那條（少了右移）是綠色的 $N$ 倍。`}
        ariaLabel="GMAC 總和 S_k 經過除以 N 或不除，再乘 mu 的三種 scaling 路徑"
      />
      <p>
        <strong>先看</strong>綠色路徑（average）：<Tex>{R`S_k`}</Tex> 先右移 <Tex>{R`\log_2N`}</Tex> bits 變成 <Tex>{R`G_k`}</Tex>，再乘 <Tex>{R`\mu`}</Tex>；每個 block 的修正量是{' '}
        <Tex>{R`\Delta w=w_{k+1}-w_k=\mu G_k`}</Tex>，loop gain <Tex>{R`g=\mu K`}</Tex> 和 <Tex>N</Tex> 無關。<strong>再看</strong>紅色路徑（sum）：少了右移，同一個 <Tex>{R`\mu`}</Tex> 乘到的是{' '}
        <Tex>{R`S_k=NG_k`}</Tex>，修正量變成 <Tex>N</Tex> 倍，loop gain 也變成 <Tex>{R`N\mu K`}</Tex>，合法的 <Tex>{R`\mu`}</Tex> 範圍縮小 <Tex>N</Tex> 倍。<strong>最後看</strong>沒上色的那條：如果是刻意省掉右移，
        把學習率改成 <Tex>{R`\mu/N`}</Tex> 就和 average 完全一樣——重點是文件必須寫清楚暫存器裡的「<Tex>{R`\mu`}</Tex>」是哪一種意義。圖上三條路徑最下面的 <Tex>g</Tex> 就是下面的 F-04.5。
      </p>
      <DerivationFold title={mt(R`為什麼 sum 模式的 $g$ 放大 $N$ 倍`)}>
        <StepDerivation
          steps={[
            {
              tex: R`\text{average: }w_{k+1}=w_k+\mu G_k,\qquad\text{sum: }w_{k+1}=w_k+\mu S_k=w_k+\mu N G_k`,
              why: mt(R`$S_k=NG_k$（定義）；RTL 若少了「$\div N$」的右移，送進更新式的就是 $S_k$。`),
            },
            {
              tex: R`\delta_{k+1}=a-w_{k+1}=\delta_k-\mu G_k\;\text{ 或 }\;\delta_k-\mu NG_k`,
              why: mt(R`兩邊用 $a$ 去減（$\delta=a-w$）。`),
            },
            {
              tex: R`E[\delta_{k+1}]=(1-\mu K)\,E[\delta_k]\;\text{ 或 }\;(1-N\mu K)\,E[\delta_k]`,
              why: mt(R`代入 $E[G_k]\approx K\delta_k$ 並取期望值。`),
            },
            {
              tex: R`g_\mathrm{avg}=\mu K,\qquad g_\mathrm{sum}=N\mu K=N\,g_\mathrm{avg}`,
              why: mt(R`平均 pole $p=1-g$；sum 模式等於把 $\mu$ 換成 $\mu_\mathrm{eff}=N\mu$。`),
            },
            {
              tex: R`0<g<2\;\Rightarrow\;0<\mu<\frac{2}{K}\;(\text{avg}),\qquad0<\mu<\frac{2}{NK}\;(\text{sum})`,
              why: mt(R`一階遞迴 $|1-g|<1$ 的條件（等比數列收斂，Ch03）；sum 模式的合法 $\mu$ 範圍縮小 $N$ 倍。`),
            },
            {
              tex: R`\mu_\mathrm{sum}=\mu_\mathrm{avg}/N\;\Rightarrow\;w_k\text{ 完全相同}`,
              why: mt(R`$\mu S_k/N$ 與 $\mu G_k$ 是同一個數；$N$ 為 2 的冪時連浮點捨入都相同（blockLms.test.ts 逐位元驗證）。`),
            },
          ]}
          result={R`g_\mathrm{sum}=N\,\mu K_qC=N\,g_\mathrm{avg}`}
        />
        <p className="small">
          <ClaimTag kind="exact" /> 在一階平均模型下精確。sign-LMS 的 <Tex>{R`|G|\le\max|x_\mathrm{ref}|`}</Tex> 有界，所以 <Tex>{R`g\gg2`}</Tex> 時模擬不會「數值爆掉」， 而是在 <Tex>a</Tex>{' '}
          兩側做大振幅來回跳（blockLms 的警告會說明）。
        </p>
      </DerivationFold>
      <TexBlock id="F-04.5" label={mt(R`Sum 模式的 loop gain 放大 $N$ 倍`)}>
        {R`\boxed{g_\mathrm{avg}=\mu K,\qquad g_\mathrm{sum}=N\mu K,\qquad p=1-g}`}
      </TexBlock>
      <p>
        數字（lesson 4 的表；
        <Tex>{R`\mu=10\,\mathrm{fs},\;\sigma_v=100\,\mathrm{fs},\;C=1`}</Tex>
        ，由 <code>sumAverageTable</code> 計算）<SourceTag kind="illustrative" />：
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <Tex>N</Tex>
              </th>
              <th>
                <Tex>{R`g_\mathrm{avg}`}</Tex>
              </th>
              <th>
                <Tex>{R`p_\mathrm{avg}`}</Tex>
              </th>
              <th>
                <Tex>{R`g_\mathrm{sum}`}</Tex>
              </th>
              <th>
                <Tex>{R`p_\mathrm{sum}`}</Tex>
              </th>
              <th>sum 模式</th>
              <th>
                收斂附近 <Tex>{R`\mathrm{sd}(G)`}</Tex> / <Tex>{R`\mathrm{sd}(S)`}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            {table.map((r) => (
              <tr key={r.N}>
                <td className="num">{r.N}</td>
                <td className="num">{f(r.gAvg, 5)}</td>
                <td className="num">{f(r.poleAvg, 5)}</td>
                <td className="num">{f(r.gSum, 5)}</td>
                <td className="num">{f(r.poleSum, 5)}</td>
                <td>
                  {r.stableSum ? (
                    r.poleSum < 0 ? (
                      <>
                        穩定但振盪（<Tex>{R`p<0`}</Tex>）
                      </>
                    ) : (
                      '穩定'
                    )
                  ) : (
                    <>
                      不穩定（<Tex>{R`|p|\ge1`}</Tex>）
                    </>
                  )}
                </td>
                <td className="num">
                  {f(r.sdAvg, 4)} / {f(r.sdSum, 4)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        <Tex>{R`N=4096`}</Tex> 那一列就是規格 T13 的反面測試：
        <Tex>{R`g_\mathrm{sum}=${tx(table[3].gSum, 6)}`}</Tex>、pole <Tex>{R`${tx(table[3].poleSum, 6)}`}</Tex>（golden vector 驗證，見 gmac.test.ts）。
      </p>
      <HandCalcBox id="HC-04.3">
        把 <Tex>{R`\mu`}</Tex>、<Tex>{R`\sigma_v`}</Tex>、<Tex>N</Tex> 換成你的設計值，先用計算機算出 <Tex>{R`K_q`}</Tex>、<Tex>g</Tex> 和 pole，再看「少一個右移」會把 loop gain 放大成多少；預設值就是上表{' '}
        <Tex>{R`N=4096`}</Tex> 那一列（測試 T13）。
      </HandCalcBox>

      <Callout
        kind="info"
        title={
          <>
            Sum 與 average 的平均與變異數 <Erratum id="E18" />
          </>
        }
      >
        <p>
          規格 §5 用 <Tex>{R`G_N=\sum q_i`}</Tex>（總和）配 <Tex>{R`\mathrm{Var}=N(1-m^2)`}</Tex>，和 §0 的平均定義衝突。本站一律：總和寫 <Tex>{R`S_N`}</Tex>、平均寫 <Tex>G</Tex>；
          <Tex>{R`E[q]`}</Tex> 寫成 <Tex>{R`m_q`}</Tex>（規格寫 <Tex>m</Tex>，與其他章節的 <Tex>m</Tex> 衝突 <Erratum id="E34" />）。以{' '}
          <Tex>{R`x\equiv1`}</Tex>、<Tex>{R`m_q=E[q]=\mathrm{erf}(0.01/\sqrt2)=${tx(m, 6)}`}</Tex>（<Tex>{R`1\,\mathrm{fs}`}</Tex> 的誤差埋在 <Tex>{R`\sigma_v=100\,\mathrm{fs}`}</Tex> 的雜訊裡）、
          <Tex>{R`N=${N5}`}</Tex> 為例 <SourceTag kind="illustrative" />：
        </p>
        <TexBlock id="F-04.6">
          {R`\begin{aligned}E[S_N]&=Nm_q=${tx(N5 * m, 6)},&\mathrm{sd}(S_N)&=\sqrt{N(1-m_q^2)}=${tx(Math.sqrt(N5 * (1 - m * m)), 6)};\\E[G]&=m_q=${tx(m, 6)},&\mathrm{sd}(G)&=\sqrt{\tfrac{1-m_q^2}{N}}=${tx(Math.sqrt((1 - m * m) / N5), 6)}\end{aligned}`}
        </TexBlock>
        <p>
          兩者差 <Tex>N</Tex> 倍，但「方向判斷」<Tex>{R`P(S_N>0)=P(G>0)`}</Tex> 與尺度無關。histogram 或信賴區間的軸一定要標明是 sum 還是 average。<Tex>N</Tex> 為偶數時 <Tex>{R`S_N=0`}</Tex> 的 tie 必須另訂規則{' '}
          <Erratum id="E07" />
          （Ch05）。
        </p>
      </Callout>

      <h3>核心程式碼：sum vs average</h3>
      <CodeCompare
        items={[
          {
            label: 'Average（除以 N）',
            source: gmacSrc,
            region: 'gmacAverage',
            path: GMAC_PATH,
            note: R`§0 的定義 $G_k=S_k/N$；RTL 以右移 $\log_2N$ bits 實作`,
          },
          {
            label: 'Sum（不除）',
            source: gmacSrc,
            region: 'gmacSum',
            path: GMAC_PATH,
            note: R`省掉右移的 RTL：同一個 $\mu$ 時 $g$ 放大 $N$ 倍`,
          },
        ]}
        caption={R`差異只有最後一行（自動高亮）。兩個函式是 gmac.ts 實際執行的程式碼，下面的訊號流實驗以它們由 trace 重算 $G_k$，與 blockLms 交叉比對。`}
      />
      <CodeBlock source={gmacSrc} region="blockUpdate" path={GMAC_PATH} title="一個 block 的更新" />

      <SignalFlowExperiment />

      <h3>
        <Tex>{R`q=\pm1`}</Tex> 時不需要乘法器：條件取負
      </h3>
      <p>
        因為 <Tex>q</Tex> 只有 <Tex>{R`\pm1`}</Tex>，<Tex>{R`q\cdot x`}</Tex> 只是「照抄 <Tex>x</Tex>」或「取負」。硬體上用一個 2 選 1 的 mux，或更省的 <strong>XOR + carry-in</strong>：把 <Tex>x</Tex>{' '}
        逐位元反相，再在累加器加法器的 carry-in 送 1。整個 GMAC 只要一個加法器和一個暫存器。
      </p>
      <MermaidFig
        chart={NEGATE_DATAPATH}
        caption={R`條件取負的 GMAC datapath 與各級位元寬度：藍色三格（符號延伸、XOR、carry-in 控制）取代了乘法器。看位元寬度怎麼變：$B_x$ → $B_\mathrm{acc}$ → 右移後保留 $F_G$ 個小數位元。`}
        ariaLabel="條件取負的 GMAC datapath：符號延伸、XOR、carry-in、累加器、右移、乘 mu、gain register"
      />
      <p>
        <strong>先看</strong>左欄（sample rate）上方的第一個輸入：code 是 <Tex>{R`B_x`}</Tex>-bit 的二補數整數 <Tex>{R`x_\mathrm{int}[n]`}</Tex>（正規化的 code 是 <Tex>{R`x=x_\mathrm{int}/2^{B_x-1}`}</Tex>），它<strong>先</strong>符號延伸到累加器的寬度{' '}
        <Tex>{R`B_\mathrm{acc}`}</Tex>。<strong>再看</strong>第二個輸入：comparator 的位元 <Tex>{R`b[n]`}</Tex> 反相後得到控制訊號 neg（<Tex>{R`q=-1`}</Tex> 時為 1）。neg 同時做兩件事：把 <Tex>x</Tex>{' '}
        的每個位元反相（XOR），得到 <Tex>{R`\overline{x}=-x-1`}</Tex>；並當成加法器的 carry-in，補上那個 <Tex>{R`+1`}</Tex>。兩者合起來，加法器算的就是 <Tex>{R`S+q\cdot x_\mathrm{int}`}</Tex>。
        <strong>最後</strong>順著箭頭到右欄（block rate）：block 結束時把 <Tex>{R`S_k`}</Tex> 右移 <Tex>{R`\ell=\log_2N-F_G`}</Tex> bits（<Tex>{R`F_G`}</Tex> 是保留的小數位元數，§5.2）、乘 <Tex>{R`\mu`}</Tex>、加進 gain register；虛線是 block 邊界的清除訊號。
      </p>
      <p className="small">
        圖和公式的對應：XOR 方塊裡的兩種情形就是 F-04.8 的兩列；「符號延伸」畫在 XOR <strong>之前</strong>是關鍵——順序反過來（先在 <Tex>{R`B_x`}</Tex> bits 內取負、再延伸），最負的那個 code 會算錯，下面的推導說明原因。
      </p>
      <Prereq title="二補數（two's complement）">
        <p>
          <Tex>B</Tex>-bit 二補數 <Tex>{R`b_{B-1}\dots b_1b_0`}</Tex> 代表的值是 <Tex>{R`-2^{B-1}b_{B-1}+\sum_{i=0}^{B-2}2^ib_i`}</Tex>
          ：最高位元的權重是負的。 例：4-bit 的 <code>0101</code> <Tex>{R`=4+1=5`}</Tex>，
          <code>1011</code> <Tex>{R`=-8+2+1=-5`}</Tex>。範圍是 <Tex>{R`[-2^{B-1},\,2^{B-1}-1]`}</Tex>，<strong>負的那一邊多一個</strong>。 超出範圍時硬體只保留低 B 位元，等於對 <Tex>{R`2^B`}</Tex>{' '}
          取模後再映回這個範圍（wrap）。
        </p>
      </Prereq>
      <DerivationFold title={mt(R`$-x=\overline{x}+1$，以及最負 code 的陷阱`)}>
        <StepDerivation
          steps={[
            {
              tex: R`x=-2^{B-1}b_{B-1}+\sum_{i=0}^{B-2}2^ib_i`,
              why: '二補數的定義。',
            },
            {
              tex: R`\overline{x}=-2^{B-1}(1-b_{B-1})+\sum_{i=0}^{B-2}2^i(1-b_i)`,
              why: mt(R`逐位元反相：每個 $b_i$ 換成 $1-b_i$。`),
            },
            {
              tex: R`x+\overline{x}=-2^{B-1}+\sum_{i=0}^{B-2}2^i=-2^{B-1}+(2^{B-1}-1)=-1`,
              why: mt(R`兩式相加，$b_i$ 全部抵消；中間的等比數列和為 $2^{B-1}-1$。`),
            },
            {
              tex: R`-x=\overline{x}+1`,
              why: mt(R`移項。所以「取負」= 反相 $+1$，這個 $+1$ 可以由加法器的 carry-in 免費提供。`),
            },
            {
              tex: R`q\cdot x=(x\oplus\mathrm{mask})+c_\mathrm{in},\quad(\mathrm{mask},\,c_\mathrm{in})=\begin{cases}(00\cdots0,\;0),&b=1\\(11\cdots1,\;1),&b=0\end{cases}`,
              why: mt(R`條件取負：$b=0$（$q=-1$）時把 $x$ 和全 1 的 mask 做 XOR（$\oplus$，逐位元反相）並令加法器的 carry-in $c_\mathrm{in}=1$；$b=1$ 時兩者都是 0，$x$ 原樣通過。`),
            },
            {
              tex: R`x\in[-2^{B-1},\,2^{B-1}-1]\;\Rightarrow\;-x\in[-2^{B-1}+1,\;+2^{B-1}]`,
              why: mt(R`取負把範圍翻過來；$+2^{B-1}$ 在 $B$ bits 內放不下。`),
            },
            {
              tex: R`\text{在 }B\text{ bits 內：}-(-2^{B-1})\;\xrightarrow{\text{wrap}}\;-2^{B-1}`,
              why: mt(R`例：6-bit 的 $-32$ 取負應為 $+32$，但 6-bit 只能表示到 $+31$，wrap 回 $-32$——符號完全錯誤。`),
            },
          ]}
          result={R`\text{先把 }x\text{ 符號延伸到 }B_x+1\text{ bits（或直接延伸到累加器寬度）再取負；或把 code 限制在對稱範圍}`}
        />
        <p className="small">
          <ClaimTag kind="exact" /> 以 6-bit 驗算：
          <Tex>{R`\text{negateExtended}(-32,b{=}0)=${negateExtended(-half6, 0)}`}</Tex>，<Tex>{R`\text{negateInplace}(-32,b{=}0)=${negateInplace(-half6, 0, 6)}`}</Tex>，
          <Tex>{R`\text{wrapTwos}(32,6)=${wrapTwos(half6, 6)}`}</Tex>。 gmac.test.ts 對 6-bit 的全部 64 個 code 與 <Tex>{R`b\in\{0,1\}`}</Tex> 窮舉驗證：只有 <Tex>{R`-32`}</Tex> 這一個 code 會出錯。
        </p>
      </DerivationFold>
      <TexBlock id="F-04.8" label="條件取負（二補數）">
        {R`q\cdot x=\begin{cases}x,&b=1\\ \overline{x}+1,&b=0\end{cases},\qquad \overline{x}=-x-1`}
      </TexBlock>
      <CodeCompare
        items={[
          {
            label: '先符號延伸再取負（正確）',
            source: gmacSrc,
            region: 'negateExtended',
            path: GMAC_PATH,
            note: R`在 $B_x+1$ bits 內取負：$-(-2^{B_x-1})=+2^{B_x-1}$ 放得下`,
          },
          {
            label: '原寬度內取負（bug）',
            source: gmacSrc,
            region: 'negateInplace',
            path: GMAC_PATH,
            note: R`仍在 $B_x$ bits 內做 $\overline{x}+1$：最負 code 溢位回到自己`,
          },
        ]}
        caption="差異行自動高亮。面板 A 的「一直是最負 code」情境可以看到 bug 讓總和變號。"
      />
      <CodeBlock source={gmacSrc} region="xorCarryAccumulate" path={GMAC_PATH} title="RTL 寫法：XOR + carry-in 的單一加法器" />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>實作</th>
              <th>硬體</th>
              <th>最負 code</th>
              <th>適用</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                一般乘法器 <Tex>{R`q\times x`}</Tex>
              </td>
              <td>
                <Tex>{R`B_q\times B_x`}</Tex> multiplier
              </td>
              <td>正確（輸出寬度夠時）</td>
              <td>
                只有 <Tex>q</Tex> 是多位元時才需要（非 sign-error LMS）
              </td>
            </tr>
            <tr>
              <td>{mt(R`mux 選 $+x$ / $-x$（$B_x+1$ bits）`)}</td>
              <td>取負電路 + mux</td>
              <td>正確</td>
              <td>直觀，面積略大</td>
            </tr>
            <tr>
              <td>XOR + carry-in</td>
              <td>{mt(R`$B_\mathrm{acc}$ 個 XOR + 加法器 carry-in`)}</td>
              <td>{mt(R`正確（$x$ 已延伸到 $B_\mathrm{acc}$）`)}</td>
              <td>最省；推薦</td>
            </tr>
            <tr>
              <td>{mt(R`$B_x$ bits 內取負`)}</td>
              <td>同上但少 1 bit</td>
              <td>
                <strong>錯</strong>：<Tex>{R`-(-2^{B-1})`}</Tex> wrap 回自己
              </td>
              <td>反面教材（或保證 code 對稱）</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>
        硬體 0/1 → <Tex>{R`\pm1`}</Tex>：<Tex>{R`q=2b-1`}</Tex>，忘了會怎樣？
      </h3>
      <p>
        comparator 輸出的是一個 bit <Tex>{R`b\in\{0,1\}`}</Tex>。LMS 需要的是 <Tex>{R`q=\mathrm{sign}(e)\in\{-1,+1\}`}</Tex>：<Tex>{R`q=2b-1`}</Tex>
        （§16.1 第 1 項）。如果 RTL 直接拿 <Tex>b</Tex> 去控制「加 <Tex>x</Tex> 或不加」，就等於用 <Tex>{R`q_\mathrm{bug}=b`}</Tex>。
      </p>
      <MermaidFig
        chart={BIT_MAPPING}
        caption={R`0/1 → $\pm1$ 的映射方塊（綠色，正確路徑）與忘了映射的 bug 路徑（紅色）。看兩條路徑的第一格：只差一個映射方塊，最下面的結果卻差了「增益減半」和「一個和 code 平均成正比的偏差」。`}
        ariaLabel="comparator 位元映射成正負一的正確路徑，與直接使用 0/1 的錯誤路徑"
      />
      <p>
        <strong>先看</strong>綠色路徑：位元 <Tex>{R`b[n]`}</Tex> 經過 <Tex>{R`q=2b-1`}</Tex> 變成 <Tex>{R`\pm1`}</Tex> 再進 GMAC，平均是 <Tex>{R`K\delta`}</Tex>；<Tex>{R`\delta=0`}</Tex> 時平均更新為 0，所以迴路平均起來停住的地方——
        <strong>固定點</strong> <Tex>{R`w^*`}</Tex>——就是真值 <Tex>a</Tex>。<strong>再看</strong>紅色路徑：<Tex>b</Tex> 直接當成 <Tex>q</Tex>，等於每一筆乘積都多加了 <Tex>{R`\tfrac12x_\mathrm{ref}`}</Tex>。圖上的{' '}
        <Tex>{R`G_\mathrm{bug}=\tfrac12G+\tfrac12\bar x_\mathrm{ref}`}</Tex>（<Tex>{R`\bar x_\mathrm{ref}`}</Tex> 是這個 block 內 code 的平均）就是下面推導的第 3 步；最下面偏掉的固定點是第 6 步，也就是 F-04.7。
      </p>
      <DerivationFold title={mt(R`忘了映射：增益減半，再加一個 $E[x_\mathrm{ref}]/K$ 的偏差`)}>
        <StepDerivation
          steps={[
            {
              tex: R`q=2b-1\;\Longleftrightarrow\;b=\frac{q+1}{2}`,
              why: mt(R`正確映射；反過來解出 $b$。`),
            },
            {
              tex: R`G_\mathrm{bug}=\frac1N\sum_n b[n]\,x_\mathrm{ref}[n]=\frac1N\sum_n\frac{q[n]+1}{2}\,x_\mathrm{ref}[n]`,
              why: mt(R`把錯誤的 $q_\mathrm{bug}=b$ 代進 GMAC。`),
            },
            {
              tex: R`=\tfrac12\,G_k+\tfrac12\,\bar x_\mathrm{ref},\qquad\bar x_\mathrm{ref}=\frac1N\sum_nx_\mathrm{ref}[n]`,
              why: '求和拆成兩項——這是恆等式，對每一個 block 都精確成立。',
            },
            {
              tex: R`E[G_\mathrm{bug}]\approx\tfrac12K\delta+\tfrac12E[x_\mathrm{ref}]`,
              why: mt(R`取期望值並代入 $E[G]\approx K\delta$。`),
            },
            {
              tex: R`\tfrac12K\delta^*+\tfrac12E[x_\mathrm{ref}]=0\;\Rightarrow\;\delta^*=-\frac{E[x_\mathrm{ref}]}{K}`,
              why: '固定點：平均更新為 0。',
            },
            {
              tex: R`w^*_\mathrm{bug}=a-\delta^*=a+\frac{E[x_\mathrm{ref}]}{K_qC}`,
              why: mt(R`$\delta=a-w\Rightarrow w^*=a-\delta^*$。`),
            },
          ]}
          result={R`g_\mathrm{bug}=\tfrac12\mu K,\qquad w^*_\mathrm{bug}-a\approx\frac{E[x_\mathrm{ref}]}{K_qC}`}
        />
        <p className="small">
          <ClaimTag kind="exact" /> 第 3 步是恆等式；
          <ClaimTag kind="approx" /> 固定點是小訊號近似（
          <Tex>{R`|\delta x|\ll\sigma_v`}</Tex>）。因為 <Tex>{R`K_q`}</Tex> 很小 （<Tex>{R`\sigma_v=100\,\mathrm{fs}\Rightarrow K_q=${tx(Kq100, 4)}\,\mathrm{fs}^{-1}`}</Tex>
          ），在 <Tex>{R`C=1`}</Tex> 時 code 平均只要 0.01，偏差就有 <Tex>{R`0.01/(K_qC)=${tx(0.01 / Kq100, 4)}\,\mathrm{fs}`}</Tex>。
        </p>
      </DerivationFold>
      <TexBlock id="F-04.7" label={mt(R`硬體 0/1 映射成 $\pm1$，以及忘記映射的後果`)}>
        {R`q=2b-1;\qquad G_\mathrm{bug}=\tfrac12G+\tfrac12\bar x_\mathrm{ref}\;\Rightarrow\;w^*_\mathrm{bug}\approx a+\frac{E[x_\mathrm{ref}]}{K_qC}`}
      </TexBlock>
      <ul>
        <li>
          手算例子：
          <Tex>{R`G_\mathrm{bug}=${tx(h.Gbug)}=\tfrac12\times${tx(h.G)}+\tfrac12\times${tx(h.xbar)}`}</Tex>
          （零均值 code：只剩增益減半）。
        </li>
        <li>
          golden 反面測試：在 <Tex>{R`w=a`}</Tex> 時每個 sample 的平均更新 <Tex>{R`E[b\,x]=E[x]/2`}</Tex>；code <Tex>{R`\{${dcCodes.join(',')}\}`}</Tex> 均勻時為 <Tex>{R`${tx(dcUpdate)}`}</Tex>（不是 0，所以 <Tex>{R`w=a`}</Tex> 不是固定點）。
        </li>
        <li>
          <Tex>{R`x\sim\mathcal N(0.5,1)`}</Tex>、<Tex>{R`\sigma_v=100\,\mathrm{fs}`}</Tex>、<Tex>{R`a=${a}\,\mathrm{fs}`}</Tex>：線性化 <Tex>{R`w^*\approx${tx(bugLin, 5)}\,\mathrm{fs}`}</Tex>，
          mean-field 精確根 <Tex>{R`w^*=${tx(bugEx.wStar, 6)}\,\mathrm{fs}`}</Tex>（F-04.16 封閉式；<Tex>{R`|\delta x|`}</Tex> 已經不遠小於 <Tex>{R`\sigma_v`}</Tex>，線性化低估）。下面的實驗直接模擬。
        </li>
        <li>
          <strong>單邊 code 更糟：</strong>§2 的 DSM code <Tex>{R`x=s/M\in[0,1)`}</Tex> 恆 <Tex>{R`\ge0`}</Tex>
          。忘了映射時每一項 <Tex>{R`b[n]\,x[n]\ge0`}</Tex>，所以 <Tex>{R`G_\mathrm{bug}\ge0`}</Tex> 對每個 block 都成立：<Tex>w</Tex> 只會單調往上漂到 DTC gain 的 rail，
          <strong>根本沒有固定點</strong>
          。這時線性化公式給的 <Tex>{R`E[x]/(K_qC)=0.5/(K_q/3)`}</Tex> 是假的數字（線性化假設 <Tex>{R`|\delta x|\ll\sigma_v`}</Tex> 在漂移中完全失效）。訊號流實驗的「DSM residue ＋忘了映射」preset
          可以直接看到（該 code 恆 <Tex>{R`\le0`}</Tex>，所以往下漂）。
        </li>
      </ul>
      <HandCalcBox id="HC-04.4">
        隨手寫 4 個 comparator 位元和 4 個 code（試試全正的 code，例如 <Tex>{R`[0.5,\,1,\,1.5,\,1]`}</Tex>），在紙上分別用 <Tex>{R`q=2b-1`}</Tex> 和「直接用 <Tex>b</Tex>」各累加一次，確認{' '}
        <Tex>{R`G_\mathrm{bug}=\tfrac12G+\tfrac12\bar x`}</Tex> 每一次都成立。
      </HandCalcBox>
      <CodeCompare
        items={[
          {
            label: 'decodeComparator',
            source: gmacSrc,
            region: 'decodeComparator',
            path: GMAC_PATH,
            note: '三種編碼；bug 那一行被高亮',
          },
          {
            label: 'bitToBipolar',
            source: gmacSrc,
            region: 'bitToBipolar',
            path: GMAC_PATH,
            note: R`正確的 $q=2b-1$`,
          },
          {
            label: 'comparatorBit',
            source: gmacSrc,
            region: 'comparatorBit',
            path: GMAC_PATH,
            note: 'tie 規則（E07）',
          },
        ]}
        layout="tabs"
      />
      <BitEncodingExperiment />
      <DerivationFold title={mt(R`Gaussian code 時的精確固定點：封閉式與「偏差正比於 $\sigma_v$」`)} openAt="research">
        <p className="small">
          符號：code 的平均與標準差寫成 <Tex>{R`m_x=E[x]`}</Tex>、<Tex>{R`\sigma_x`}</Tex>（<Tex>{R`E[x^2]=m_x^2+\sigma_x^2`}</Tex>）；正規化誤差 <Tex>{R`\xi:=\delta/\sigma_v`}</Tex>（無因次）；
          <Tex>{R`\Phi`}</Tex>、<Tex>{R`\varphi`}</Tex> 是標準 Gaussian 的累積分布與密度（§3 的先備知識框）。
        </p>
        <StepDerivation
          steps={[
            {
              tex: R`E\bigl[b\,x\mid x\bigr]=x\,P(e\ge0\mid x)=x\,\Phi\Bigl(\frac{\delta x}{\sigma_v}\Bigr)\;\Rightarrow\;E[G_\mathrm{bug}]=h(\xi):=E_x\bigl[x\,\Phi(\xi x)\bigr],\quad\xi=\frac{\delta}{\sigma_v}`,
              why: mt(R`忘了映射時 GMAC 的每一項是 $b\,x$；先固定 $x$ 對雜訊取期望值，再對 $x$ 取期望值。注意 $h$ 只透過 $\xi=\delta/\sigma_v$ 依賴 $\delta$ 與 $\sigma_v$。`),
            },
            {
              tex: R`E_x\bigl[\Phi(\xi x)\bigr]=P(Z\le\xi x)=P(Z-\xi x\le0)=\Phi\Bigl(\frac{\xi m_x}{\gamma}\Bigr),\quad\gamma:=\sqrt{1+\xi^2\sigma_x^2}`,
              why: mt(R`把 $\Phi(\xi x)$ 看成「另一個獨立的 $Z\sim\mathcal N(0,1)$ 小於 $\xi x$ 的機率」；$Z-\xi x$ 是 Gaussian，平均 $-\xi m_x$、變異數 $1+\xi^2\sigma_x^2=\gamma^2$（$x\sim\mathcal N(m_x,\sigma_x^2)$）。`),
            },
            {
              tex: R`E\bigl[(x-m_x)\,f(x)\bigr]=\sigma_x^2\,E\bigl[f'(x)\bigr]`,
              why: mt(R`分部積分：Gaussian 密度 $p(x)$ 滿足 $(x-m_x)\,p(x)=-\sigma_x^2\,p'(x)$，所以 $\int(x-m_x)f\,p\,dx=-\sigma_x^2[f\,p]+\sigma_x^2\int f'p\,dx$，邊界項為 0。`),
            },
            {
              tex: R`f(x)=\Phi(\xi x),\;f'(x)=\xi\,\varphi(\xi x),\quad E_x\bigl[\varphi(\xi x)\bigr]=\frac{1}{\gamma}\,\varphi\Bigl(\frac{\xi m_x}{\gamma}\Bigr)`,
              why: mt(R`兩個 Gaussian 指數相乘再對 $x$ 積分（配方），結果仍是 Gaussian 形狀，寬度變成 $\gamma$；也可以直接把第 2 步的 $P(Z-\xi x\le c)$ 對 $c$ 微分後令 $c=0$。`),
            },
            {
              tex: R`h(\xi)=m_x\,E[\Phi(\xi x)]+E[(x-m_x)\Phi(\xi x)]=m_x\,\Phi\Bigl(\frac{\xi m_x}{\gamma}\Bigr)+\frac{\sigma_x^2\,\xi}{\gamma}\,\varphi\Bigl(\frac{\xi m_x}{\gamma}\Bigr)`,
              why: mt(R`把 $x$ 拆成 $m_x+(x-m_x)$，代入第 2、3、4 步。`),
            },
            {
              tex: R`h(0)=\frac{m_x}{2},\quad h'(0)=\frac{m_x^2+\sigma_x^2}{\sqrt{2\pi}}\;\Rightarrow\;\xi_\mathrm{lin}=-\frac{m_x}{\sqrt{2/\pi}\,E[x^2]}`,
              why: mt(R`在 $\xi=0$ 泰勒一階展開並令 $h=0$；乘回 $\sigma_v$ 就是 F-04.7 的線性化 $E[x]/(K_qE[x^2])$。`),
            },
            {
              tex: R`h(\xi^*)=0\;\Rightarrow\;w^*-a=-\xi^*\sigma_v\;\propto\;\sigma_v`,
              why: mt(R`$\xi^*$ 只和 code 分布 $(m_x,\sigma_x)$ 有關，所以偏差與 $\sigma_v$ 精確成正比；$\sigma_v\to0$ 時偏差 $\to0$（前提是 code 有正有負）。`),
            },
          ]}
          result={R`m_x=0.5,\;\sigma_x=1:\quad\xi^*=${tx(bugEx.xi, 6)}\;(h(\xi^*)=${tx(hAtRoot, 2)}),\quad\xi_\mathrm{lin}=${tx(bugEx.xiLin, 6)}`}
        />
      </DerivationFold>
      <TexBlock id="F-04.16" label="忘了映射＋Gaussian code：mean-field 固定點的封閉式">
        {R`h(\xi)=m_x\,\Phi\!\Bigl(\frac{\xi m_x}{\gamma}\Bigr)+\frac{\sigma_x^2\,\xi}{\gamma}\,\varphi\!\Bigl(\frac{\xi m_x}{\gamma}\Bigr),\quad\gamma=\sqrt{1+\xi^2\sigma_x^2};\qquad\boxed{h(\xi^*)=0\Rightarrow w^*=a-\xi^*\sigma_v}`}
      </TexBlock>
      <p className="small">
        <ClaimTag kind="exact" /> 在「Gaussian code <Tex>{R`x\sim\mathcal N(m_x,\sigma_x^2)`}</Tex>、Gaussian 雜訊、identity path、mean-field（平均更新為 0）」的指定模型下精確，其中{' '}
        <Tex>{R`\xi=\delta/\sigma_v`}</Tex>。數值（<Tex>{R`m_x=0.5,\;\sigma_x=1,\;a=${a}\,\mathrm{fs}`}</Tex>，由 <code>bugFixedPointGaussian</code> 二分法求根）：
        {bugSmall.map((r, i) => (
          <span key={r.sv}>
            {i > 0 ? '、' : ' '}
            <Tex>{R`\sigma_v=${r.sv}\,\mathrm{fs}\Rightarrow w^*-a=${tx(r.dw, 5)}\,\mathrm{fs}`}</Tex>
          </span>
        ))}
        。blockLms 的 <code>wStarMeanField</code> 用 <Tex>{R`2^{14}`}</Tex> 個實際 code 樣本求根，會帶一點取樣誤差；獨立的 Python mean-field 求根（blockLms.test.ts 引用）為{' '}
        <Tex>{R`w^*=63.2341\,\mathrm{fs}`}</Tex>，與上面 <Tex>{R`\sigma_v=100\,\mathrm{fs}`}</Tex> 的封閉式結果 <Tex>{R`${tx(bugEx.wStar, 6)}\,\mathrm{fs}`}</Tex> 相同（gmac.test.ts 比對到 <Tex>{R`10^{-8}`}</Tex>）。
      </p>
      <HandCalcBox id="HC-04.5">
        拿一張標準常態表（或計算機的 <Tex>{R`\Phi`}</Tex> / erf 功能），自己挑一個試探值 <Tex>{R`\xi`}</Tex> 代進 <Tex>{R`h(\xi)`}</Tex>：先試線性化的{' '}
        <Tex>{R`\xi_\mathrm{lin}=${tx(bugEx.xiLin, 4)}`}</Tex>（<Tex>h</Tex> 不是 0），再試 <Tex>{R`${tx(bugEx.xi, 4)}`}</Tex>（<Tex>{R`h\approx0`}</Tex>），親手確認線性化低估了偏差。
      </HandCalcBox>
      <ModeGate min="engineer">
        <CodeBlock source={gmacSrc} region="bugMeanGmac" path={GMAC_PATH} title="F-04.16 的程式版（頁面與實驗共用）" />
      </ModeGate>
    </Section>
  )
}
