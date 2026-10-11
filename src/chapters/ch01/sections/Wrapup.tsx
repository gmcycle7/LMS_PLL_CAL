import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ClaimTag, ModelLevel, Quiz, Recap, Section, StepDerivation, Tex } from '@/components'
import { batchOptima } from '@/simulation/models/lms'
import { generateLossData, runVariantOnData, signErrorLatticeStationary, type LossDataParams } from '@/simulation/models/lossCompare'
import { BlockDiagram, ChapterHandCalc, Erratum, PllLink, texNum } from '../common'

const SPEED = { a: 3, mu: 0.05, tol: 0.1, delta0: [1, 10, 100] }
/** 思考題 3 的資料與兩個步長（用 lattice Markov 鏈精確算 Sign-Error 的穩態） */
const Q3 = [1, 2, 3, 100]
const Q3_MUS = [0.05, 0.01]

/** Sign-Error（sign(0) = 0）在 {1,2,3,100} 上的精確穩態：平均、std、落在中位數區間 [2,3] 的機率 */
function quiz3Lattice(mu: number) {
  const p: LossDataParams = {
    model: 'four_point',
    values: Q3,
    a: 0,
    xDist: 'const',
    xScale: 1,
    sigma: 0,
    outlierProb: 0,
    outlierSize: 0,
    outlierSign: 'positive',
    n: 0,
    seed: 0,
  }
  const r = signErrorLatticeStationary(p, { w0: 0, mu, tie: 'zero' })
  if (!r) return null
  const inside = r.grid.reduce((acc, g, i) => (g >= 2 - 1e-9 && g <= 3 + 1e-9 ? acc + r.pi[i] : acc), 0)
  return { mu, mean: r.mean, std: r.std, inside }
}

/** 第一次 |w_n − a| ≤ tol 的 n（找不到回傳 null） */
function firstWithin(w: Float64Array, a: number, tol: number): number | null {
  for (let n = 0; n < w.length; n++) if (Math.abs(w[n] - a) <= tol) return n
  return null
}

export function WrapupSection() {
  const speed = useMemo(() => {
    const p: LossDataParams = {
      model: 'contaminated',
      a: SPEED.a,
      xDist: 'const',
      xScale: 1,
      sigma: 0,
      outlierProb: 0,
      outlierSize: 0,
      outlierSign: 'positive',
      n: 4000,
      seed: 1,
    }
    const data = generateLossData(p) // 無雜訊：y ≡ a
    return SPEED.delta0.map((d0) => {
      const o = { w0: SPEED.a - d0, mu: SPEED.mu, tie: 'zero' as const, huberDelta: 1 }
      return {
        d0,
        lms: firstWithin(runVariantOnData('conventional', data, o).w, SPEED.a, SPEED.tol),
        se: firstWithin(runVariantOnData('sign_error', data, o).w, SPEED.a, SPEED.tol),
      }
    })
  }, [])
  const q3 = batchOptima(Q3)
  const q3mean = q3.mse
  const q3lat = useMemo(() => Q3_MUS.map(quiz3Lattice), [])
  const corr = { a: 3, c: 0.5 }

  return (
    <>
      <Section kind="assumptions" title="2.6 演算法比較總表與適用條件" level={2} id="ch01-s26">
        <p>
          四種演算法怎麼選？實務上不是「哪個數學比較漂亮」，而是「硬體給你什麼」。先用一張判斷流程圖抓住主幹，再看下面的總表：
        </p>
        <BlockDiagram id="D-01.21">
          先看最上面的菱形：誤差是多位元（知道大小）還是只有 1 bit（只知道正負）。多位元時走左邊，再問資料有沒有 outlier；只有 1 bit 時走右邊，再問 regressor{' '}
          <Tex>{'x'}</Tex> 的大小有沒有留著。藍色方塊是 PLL 校正迴路的位置：comparator 只給 <Tex>{String.raw`\operatorname{sign}(e)`}</Tex>、DSM code 是多位元，所以是 Sign-Error LMS。
          圖上四個方塊裡的更新量 <Tex>{String.raw`\Delta w`}</Tex> 取平均、令它為 0，就是下表的「固定點條件」；方塊裡的「目標」對應下表「最小化的成本」與「
          <Tex>{String.raw`x\equiv1`}</Tex> 時的目標」兩列。
        </BlockDiagram>
        <div className="table-wrap">
          <table className="ch01-table">
            <thead>
              <tr>
                <th>項目</th>
                <th>Conventional LMS</th>
                <th>Sign-Error LMS</th>
                <th>Huber LMS</th>
                <th>Sign-Sign LMS</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>最小化的成本</td>
                <td>
                  <Tex>{String.raw`\tfrac12E[e^2]`}</Tex>
                </td>
                <td>
                  <Tex>{'E|e|'}</Tex>
                </td>
                <td>
                  <Tex>{String.raw`E[\rho_H(e)]`}</Tex>
                </td>
                <td>
                  <Tex>{String.raw`E\big[|e|/|x|\big]=E\big|\tfrac{y}{x}-w\big|`}</Tex>（<Tex>{'x\\ne0'}</Tex>）
                </td>
              </tr>
              <tr>
                <td>固定點條件</td>
                <td>
                  <Tex>{'E[ex]=0'}</Tex>
                </td>
                <td>
                  <Tex>{String.raw`E[\operatorname{sign}(e)x]=0`}</Tex>
                </td>
                <td>
                  <Tex>{String.raw`E[\psi_H(e)x]=0`}</Tex>
                </td>
                <td>
                  <Tex>{String.raw`E[\operatorname{sign}(e)\operatorname{sign}(x)]=0`}</Tex>
                </td>
              </tr>
              <tr>
                <td>
                  <Tex>{String.raw`x\equiv1`}</Tex> 時的目標
                </td>
                <td>平均</td>
                <td>中位數</td>
                <td>Huber 位置</td>
                <td>
                  中位數（一般 <Tex>{'x'}</Tex>：<Tex>{'y/x'}</Tex> 的<strong>不加權</strong>中位數）
                </td>
              </tr>
              <tr>
                <td>誤差資訊</td>
                <td>多位元（ADC / TDC）</td>
                <td>1-bit comparator / BBPD</td>
                <td>多位元 + 比較器</td>
                <td>1-bit 誤差 + 1-bit code</td>
              </tr>
              <tr>
                <td>遠離最佳解時</td>
                <td>
                  指數收斂，步伐 <Tex>{String.raw`\propto|e|`}</Tex>
                </td>
                <td>
                  線性前進，每步 <Tex>{String.raw`\mu|x|`}</Tex>
                </td>
                <td>
                  先線性（每步 <Tex>{String.raw`\mu\delta_H|x|`}</Tex>）後指數
                </td>
                <td>
                  線性，每步 <Tex>{'\\mu'}</Tex>
                </td>
              </tr>
              <tr>
                <td>
                  <Tex>{'\\mu'}</Tex> 的單位
                </td>
                <td>
                  <Tex>{String.raw`1/[x]^2`}</Tex>
                </td>
                <td>
                  <Tex>{String.raw`[y]/[x]^2`}</Tex>（<Tex>{String.raw`\operatorname{sign}(e)`}</Tex> 無因次）
                </td>
                <td>
                  <Tex>{String.raw`1/[x]^2`}</Tex>
                </td>
                <td>
                  <Tex>{String.raw`[y]/[x]`}</Tex>（<Tex>{String.raw`=[w]`}</Tex>：每步固定走 <Tex>{'\\mu'}</Tex>）
                </td>
              </tr>
              <tr>
                <td>時間平均離目標多遠</td>
                <td>
                  0（資料 iid 時 <Tex>{String.raw`E[w_\infty]=w^*`}</Tex>）
                </td>
                <td>
                  <Tex>{String.raw`O(\mu|x|)`}</Tex>，依 tie 慣例與算術而定 <Erratum id="E40" />
                </td>
                <td>
                  小 <Tex>{'\\mu'}</Tex> 時趨近 Huber 位置
                </td>
                <td>
                  <Tex>{String.raw`O(\mu)`}</Tex>
                </td>
              </tr>
              <tr>
                <td>穩態抖動（變異數）</td>
                <td>
                  <Tex>{String.raw`\approx\tfrac{\mu}{2}\operatorname{Var}(\tilde v)`}</Tex>（小 <Tex>{'\\mu'}</Tex>、<Tex>{String.raw`x\equiv A`}</Tex>；
                  <Tex>{'x'}</Tex> 零均值時是 <Tex>{String.raw`\tfrac{\mu}{2}E[\tilde v^2]`}</Tex>）。outlier 也算進去——<Tex>{String.raw`\tilde v=y-ax`}</Tex>{' '}
                  是含 outlier 的總雜訊
                </td>
                <td>
                  連續雜訊：<Tex>{String.raw`\approx\mu/(4f_{\tilde v})`}</Tex>（F-01.18，std 為 <Tex>{String.raw`O(\sqrt\mu)`}</Tex>）；點質量／無雜訊：std 為{' '}
                  <Tex>{String.raw`O(\mu|x|)`}</Tex>。兩者都與 outlier 的大小無關
                </td>
                <td>
                  無封閉式；<Tex>{'\\delta_H'}</Tex> 大時像 LMS、小時像 Sign-Error
                </td>
                <td>
                  連續雜訊：<Tex>{String.raw`\approx\mu/(4f_{y/x})`}</Tex>（<Tex>{'f_{y/x}'}</Tex> 是 <Tex>{'y/x'}</Tex> 的密度）；點質量：std 為{' '}
                  <Tex>{String.raw`O(\mu)`}</Tex>
                </td>
              </tr>
              <tr>
                <td>outlier 影響</td>
                <td>無上限（平均被拉走）</td>
                <td>有上限</td>
                <td>
                  有上限（<Tex>{'\\delta_H'}</Tex>）
                </td>
                <td>有上限</td>
              </tr>
              <tr>
                <td>穩定性</td>
                <td>
                  需 <Tex>{String.raw`0<\mu<2/x^2`}</Tex>（固定 <Tex>{'x'}</Tex>）
                </td>
                <td>
                  步長有界，不會數值發散；但 <Tex>{'\\mu'}</Tex> 決定抖動大小（不會「收斂到一點」）
                </td>
                <td>小誤差區同 LMS</td>
                <td>同 Sign-Error</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          <strong>收斂速度的取捨</strong>（無雜訊、<Tex>{String.raw`x\equiv1`}</Tex>、<Tex>{String.raw`\mu=${SPEED.mu}`}</Tex>，第一次進入{' '}
          <Tex>{String.raw`|w-a|\le${SPEED.tol}`}</Tex> 的步數，由{' '}
          <code>runVariantOnData</code> 計算）：
        </p>
        <div className="table-wrap">
          <table className="ch01-table">
            <thead>
              <tr>
                <th className="num">
                  初始誤差 <Tex>{String.raw`\delta_0`}</Tex>
                </th>
                <th className="num">Conventional LMS</th>
                <th className="num">Sign-Error LMS</th>
              </tr>
            </thead>
            <tbody>
              {speed.map((r) => (
                <tr key={r.d0}>
                  <td className="num">{r.d0}</td>
                  <td className="num">{r.lms ?? '未進入'}</td>
                  <td className="num">{r.se ?? '未進入'}</td>
                </tr>
              ))}
            </tbody>
            <caption>
              LMS：<Tex>{String.raw`n\approx\ln(\text{tol}/\delta_0)/\ln(1-\mu)`}</Tex>，只隨 <Tex>{String.raw`\delta_0`}</Tex> 對數成長；Sign-Error：
              <Tex>{String.raw`n\approx(\delta_0-\text{tol})/\mu`}</Tex>，線性成長。小誤差時 Sign-Error 反而較快（步伐不會隨誤差變小）。
            </caption>
          </table>
        </div>
        <p>
          <ClaimTag kind="exact" /> <ModelLevel level="L0" /> 本章所有結論都在「純量、無 PLL 動態、雜訊與 <Tex>{'x'}</Tex> 獨立」的 L0 模型下成立。
          它們<strong>不</strong>代表：(1) 隨機 <Tex>{'x'}</Tex> 時的穩定界（mean vs mean-square 不同，見 <Link to="/ch/03">Ch03</Link>）；
          (2) comparator 雜訊下 Sign-Error 近似於縮放後的 LMS（需要 Gaussian 雜訊遠大於誤差，見 <Link to="/ch/05">Ch05</Link>）；
          (3) PLL error path 的相位會不會讓更新變號（<Link to="/ch/06">Ch06</Link>）。
        </p>
        <PllLink>
          校正迴路中，PD 後面的 1-bit comparator（BBPD）只給 <Tex>{String.raw`q=\operatorname{sign}(e)`}</Tex>，所以硬體 LMS 天生就是
          Sign-Error LMS，它追的是 <Tex>{String.raw`E[q\,x]=0`}</Tex>（MAE 型、加權中位數）的固定點：
          <ul>
            <li>
              DSM code <Tex>{'x'}</Tex> 是 regressor，GMAC 計算 <Tex>{String.raw`\sum q\,x`}</Tex>，gain update 就是 <Tex>{String.raw`w\leftarrow w+\mu G`}</Tex>（
              <Tex>{'G'}</Tex> 是 GMAC 的輸出，也就是那個總和，或它除以筆數的平均）。
            </li>
            <li>
              comparator 的 tie（<Tex>{'e'}</Tex> 恰好在門檻上）在硬體只能是 <Tex>{'+1'}</Tex> 或 <Tex>{'-1'}</Tex>：這就是本章的{' '}
              <Tex>{String.raw`\operatorname{sign}(0)`}</Tex> 慣例 <Erratum id="E40" />；定點 accumulator 正是本章的「整數 code」模型。
            </li>
            <li>
              沒有 comparator 雜訊時，固定點是 MAE 解（例如 Ch11 的 1.4），雜訊夠大時才接近 MSE 解（1.34）——見{' '}
              <Link to="/ch/11">Ch11</Link>。
            </li>
            <li>
              穩態時 <Tex>{'w'}</Tex> 每步跳 <Tex>{String.raw`\pm\mu|x|`}</Tex>、不會停：有 comparator 雜訊時抖動的變異數約{' '}
              <Tex>{String.raw`\mu/(2K_q)`}</Tex>（§2.3.2），這個係數抖動經 DTC 變成 PLL 的 jitter／spur（<Link to="/ch/12">Ch12</Link>、
              <Link to="/ch/13">Ch13</Link>）。
            </li>
          </ul>
        </PllLink>
      </Section>

      <Section kind="example" title="2.6.1 綜合手算：雜訊加上 outlier，兩種演算法各偏多少、各抖多少" level={3} id="ch01-s261">
        <p>
          把整章串起來算一次。同一組帶 outlier 的量測（<Tex>{String.raw`x\equiv1`}</Tex>，只估一個常數）：Conventional LMS 追<strong>平均</strong>（§1.2、§2.3），
          Sign-Error 追<strong>中位數</strong>（§2.3）；兩者的抖動分別來自 F-01.15 與 F-01.18。中位數那一步要查常態表（或用題目提示裡的手算近似），
          公式是 §2.4（Research 模式才顯示）的 F-01.17——不用切換模式，步驟會直接帶你算。
        </p>
        <BlockDiagram id="D-01.22">
          題目有 14 個步驟，但只有兩條線：上面一列是 Conventional LMS，下面一列是 Sign-Error。每一列都是「先算偏移（目標被 outlier 拉走多少），再算抖動（在目標附近晃多大）」。
          先看上面：偏移 <Tex>{String.raw`\varepsilon s`}</Tex> 與變異數裡的 <Tex>{String.raw`\varepsilon(1-\varepsilon)s^2`}</Tex> 都含有 outlier 的大小 <Tex>{'s'}</Tex>，
          所以偏移與抖動這兩個答案（紅色）都跟著 <Tex>{'s'}</Tex> 變大。再看下面：四格裡完全沒有 <Tex>{'s'}</Tex>，只有 outlier 出現的機率 <Tex>{'\\varepsilon'}</Tex> 與雜訊的標準差{' '}
          <Tex>{String.raw`\sigma_v`}</Tex>，偏移與抖動（綠色）都和 outlier 多大無關。
          圈號對應下面題目的步驟；圖上的 <Tex>{String.raw`\Phi^{-1}`}</Tex> 是標準常態分布的反函數（查表）、<Tex>{String.raw`\varphi(z)`}</Tex> 是標準常態密度，
          <Tex>{String.raw`\tilde v`}</Tex> 是含 outlier 的總雜訊，最後兩個 std 分別來自 F-01.15 與 F-01.18。
        </BlockDiagram>
        <ChapterHandCalc id="HC-01.8">
          先猜猜看：outlier 大小加倍時，哪一個演算法的偏移與抖動會跟著（幾乎）加倍，哪一個完全不變？用紙筆、計算機（<Tex>{String.raw`\sqrt{\ }`}</Tex>、<Tex>{'e^x'}</Tex>）和常態表算完後，到 §2.5 的
          MSE vs MAE Lab 載入 preset「DC 估計 + 10% outlier（s = 20）」，對照指標表的「母體最佳解」「LMS 穩態標準差」「擴散近似」三列。
        </ChapterHandCalc>
      </Section>

      <Section kind="example" title="2.7 思考題" level={2} id="ch01-s27">
        <Quiz
          title="思考題 3（中位數區間）"
          question={
            <>
              資料 <Tex>{'\\{1,2,3,100\\}'}</Tex>（每次等機率抽一筆）、<Tex>{'x\\equiv1'}</Tex>。用很小的 <Tex>{'\\mu'}</Tex>、數學次梯度{' '}
              <Tex>{String.raw`\operatorname{sign}(0)=0`}</Tex> 的 Sign-Error LMS，長期會停在哪裡？
            </>
          }
          options={[
            {
              label: (
                <>
                  收斂到平均 <Tex>{texNum(q3mean)}</Tex>
                </>
              ),
            },
            {
              label: (
                <>
                  不會停在單一點：在整段中位數區間 <Tex>{`[${q3.maeLow},${q3.maeHigh}]`}</Tex> 內來回遊走，只在兩端溢出{' '}
                  <Tex>{String.raw`O(\mu)`}</Tex>
                </>
              ),
              correct: true,
            },
            {
              label: (
                <>
                  收斂到 <Tex>{'2.5'}</Tex>，抖動 <Tex>{String.raw`O(\mu)`}</Tex>
                </>
              ),
            },
            {
              label: (
                <>
                  被 outlier 拉到 <Tex>{'100'}</Tex>
                </>
              ),
            },
          ]}
          answer={
            <>
              <StepDerivation
                steps={[
                  { tex: String.raw`J_{\text{MAE}}'(w)=\tfrac14\big(\#\{y_i<w\}-\#\{y_i>w\}\big)`, why: 'F-01.13：MAE 的斜率 = 計數差' },
                  {
                    tex: String.raw`2<w<3:\ J_{\text{MAE}}'(w)=\tfrac14(2-2)=0`,
                    why: (
                      <>
                        下面兩個（<Tex>{'1,2'}</Tex>）、上面兩個（<Tex>{'3,100'}</Tex>）：斜率剛好 0
                      </>
                    ),
                  },
                  {
                    tex: String.raw`w^*_{\text{MAE}}\in[${q3.maeLow},\,${q3.maeHigh}]`,
                    why: (
                      <>
                        整段都是最小值（<code>batchOptima</code> 給出 maeLow / maeHigh）；平均是 <Tex>{texNum(q3mean)}</Tex>，與 MAE 無關
                      </>
                    ),
                  },
                  {
                    tex: String.raw`E[\Delta w]=\mu\big(P(y>w)-P(y<w)\big)=\begin{cases}+\mu,&w<1\\+\tfrac{\mu}{2},&1<w<2\\0,&2<w<3\\-\tfrac{\mu}{2},&3<w<100\\-\mu,&w>100\end{cases}`,
                    why: (
                      <>
                        Sign-Error 的平均漂移（<Tex>{String.raw`x\equiv1`}</Tex>）：例如 <Tex>{'1<w<2'}</Tex> 時三筆在上面、一筆在下面，
                        <Tex>{String.raw`\tfrac34-\tfrac14=\tfrac12`}</Tex>。區間外被拉回，<strong>區間內平均更新量為 0</strong>——每步{' '}
                        <Tex>{String.raw`\pm\mu`}</Tex> 各半，是沒有回復力的隨機遊走
                      </>
                    ),
                  },
                  {
                    tex: String.raw`\begin{gathered}${q3lat
                      .map((r) =>
                        r
                          ? String.raw`\mu=${r.mu}:\ \overline w=${texNum(r.mean, 4)},\ \operatorname{std}=${texNum(r.std, 3)},\ P(2\le w\le3)=${texNum(r.inside, 3)}`
                          : String.raw`\text{(lattice 無解)}`,
                      )
                      .join(String.raw`\\`)}\end{gathered}`,
                    why: (
                      <>
                        用 <code>signErrorLatticeStationary</code> 精確算出的穩態分布：<Tex>{'\\mu'}</Tex> 縮小 {Q3_MUS[0] / Q3_MUS[1]} 倍，std 幾乎不變（趨近均勻分布的{' '}
                        <Tex>{String.raw`1/\sqrt{12}\approx${texNum(1 / Math.sqrt(12), 3)}`}</Tex>），只是溢出區間的機率變小。所以「抖動{' '}
                        <Tex>{String.raw`O(\mu)`}</Tex>」只在中位數唯一時成立
                      </>
                    ),
                  },
                ]}
              />
              <p className="small">
                <ClaimTag kind="exact" /> 時間平均剛好是區間中點只是因為這組資料對稱（<Tex>{String.raw`P(y<2)=P(y>3)`}</Tex>）；偶數筆資料時，MAE
                本身並不偏好區間內的任何一點。
              </p>
            </>
          }
        />
        <Quiz
          title="思考題 4（雜訊與輸入相關）"
          question={
            <>
              真值 <Tex>{`a=${corr.a}`}</Tex>，量測 <Tex>{String.raw`y=ax+v`}</Tex>，但 <Tex>{String.raw`v=${corr.c}\,x+u`}</Tex>（<Tex>{'u'}</Tex>{' '}
              與 <Tex>{'x'}</Tex> 獨立、零均值，<Tex>{'E[x^2]>0'}</Tex>）。
              Conventional LMS（小 <Tex>{'\\mu'}</Tex>）長期平均收斂到？
            </>
          }
          options={[
            { label: <Tex>{`${corr.a}`}</Tex> },
            { label: <Tex>{texNum(corr.a + corr.c)}</Tex>, correct: true },
            { label: <Tex>{texNum(corr.a - corr.c)}</Tex> },
            { label: '不會收斂' },
          ]}
          answer={
            <StepDerivation
              steps={[
                {
                  tex: String.raw`E[xv]=E[x(${corr.c}x+u)]=${corr.c}\,E[x^2]+E[x]E[u]=${corr.c}\,E[x^2]`,
                  why: (
                    <>
                      <Tex>{'u'}</Tex> 與 <Tex>{'x'}</Tex> 獨立 ⇒ <Tex>{'E[xu]=E[x]E[u]'}</Tex>，且 <Tex>{'E[u]=0'}</Tex>
                    </>
                  ),
                },
                { tex: String.raw`w^*=a+\frac{E[xv]}{E[x^2]}=${corr.a}+${corr.c}=${texNum(corr.a + corr.c)}`, why: 'F-01.4：迴路穩定地收斂到錯的值——穩定不代表準確' },
              ]}
            />
          }
        />
      </Section>

      <Recap
        title="這一課最重要的公式"
        formulas={[
          { tex: String.raw`\boxed{J(w)=\tfrac12E[(y-wx)^2],\quad w^*=\frac{E[xy]}{E[x^2]}=a+\frac{E[xv]}{E[x^2]}}`, label: String.raw`MSE 成本與最佳解（含 $\tfrac12$，勘誤 E41）` },
          { tex: String.raw`\boxed{E[e^*x]=0}`, label: 'Normal equation：最佳解處誤差與輸入不相關' },
          { tex: String.raw`\boxed{w_{n+1}=w_n+\mu e_nx_n,\quad \delta_n=(1-\mu x^2)^n\delta_0,\quad 0<\mu<2/x^2}`, label: (
              <>
                LMS 與固定 <Tex>{'x'}</Tex> 的確切解（<Tex>{String.raw`\delta=a-w`}</Tex>）
              </>
            ),
          },
          { tex: String.raw`\boxed{\Delta w=\mu\,\psi(e)\,x:\ \psi=e\ (\text{MSE}),\ \operatorname{sign}(e)\ (\text{MAE}),\ \operatorname{clip}(e)\ (\text{Huber})}`, label: '一個公式涵蓋三種演算法' },
          {
            tex: String.raw`\boxed{\text{MSE}\to\text{平均},\quad \text{MAE}\to\text{中位數}:\ \big|\overline w-w_{L1}\big|=O(\mu|x|),\quad \operatorname{Var}(w_\infty)\approx\frac{\mu}{4f_{\tilde v}}\ (\text{連續雜訊})}`,
            label: (
              <>
                目標改變：時間平均在中位數 <Tex>{String.raw`\pm O(\mu|x|)`}</Tex>（<Tex>{String.raw`\operatorname{sign}(0)`}</Tex> 慣例需明定，勘誤 E40）；抖動另計
              </>
            ),
          },
        ]}
        points={[
          <>Least＝找最小、Mean＝看平均、Squares＝平方避免正負抵消；平方讓成本變成拋物線，可以用微積分分析。</>,
          <>
            最小平方解 <Tex>{String.raw`w^*=a`}</Tex> <strong>只在</strong> <Tex>{'E[xv]=0'}</Tex> 時成立；誤差若跟著 <Tex>{'x'}</Tex> 走，LMS
            會穩定地學到錯的值。
          </>,
          <>
            LMS = 對 <Tex>{String.raw`\tfrac12J_2`}</Tex> 的隨機梯度下降；用 <Tex>{'J_2'}</Tex> 的曲率推步長界會錯 2 倍。
          </>,
          <>
            換成絕對值（Sign-Error）就換了目標：平均 → 中位數；只需 1-bit，outlier 影響有上限，但固定步長每步都跳{' '}
            <Tex>{String.raw`\pm\mu|x|`}</Tex>、不會停：時間平均依 tie 慣例與算術偏移 <Tex>{String.raw`O(\mu)`}</Tex>，抖動的 std 在連續雜訊下是{' '}
            <Tex>{String.raw`O(\sqrt\mu)`}</Tex>。
          </>,
          <>PLL 的 BBPD／comparator 只給正負號，所以硬體校正迴路天生是 Sign-Error LMS——下一章起要處理它的增益、雜訊與 bias。</>,
        ]}
      />
      <p className="ch01-muted-note">
        下一個值得研究的問題：Sign-Error 只用正負號，為什麼在大雜訊下反而像「縮放過的 LMS」？（<Link to="/ch/02">Ch02</Link>、
        <Link to="/ch/05">Ch05</Link>）隨機 <Tex>{'x'}</Tex> 時 <Tex>{'\\mu'}</Tex> 的上限是多少？（<Link to="/ch/03">Ch03</Link>）
      </p>
    </>
  )
}
