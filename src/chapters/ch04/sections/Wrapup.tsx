import { useMemo } from 'react'
import { ClaimTag, Quiz, Section, Tex, TexBlock } from '@/components'
import { accumulatorSizing, roundingMeanError, sumAverageTable } from '@/simulation/models/gmac'
import { wTruncNumbers } from './FixedPoint'
import { HANDCALC_FLOW } from '../diagrams'
import { f, HandCalcBox, MermaidFig, mt, tx } from '../common'

const R = String.raw

export function WrapupSection() {
  const q1 = useMemo(() => sumAverageTable({ mu: 10, sigmaV: 100, C: 1, Ex2: 1, Ns: [256] })[0], [])
  const q2 = useMemo(() => ({ full: accumulatorSizing(8, 1024, 'full'), sym: accumulatorSizing(8, 1024, 'symmetric') }), [])
  const q5 = useMemo(() => {
    const deltaG = 2 ** -4 / 32
    const K = 0.0026
    const ell = 6
    const eps = roundingMeanError(ell, 'floor')
    return { deltaG, K, ell, eps, deltaStar: (-eps * deltaG) / K }
  }, [])
  const q6 = useMemo(() => wTruncNumbers(), [])
  return (
    <Section kind="example" title="§7 比較表、綜合手算與思考題（Part 2）" level={2} id="ch04-wrap">
      <h3>GMAC scaling 的四種寫法</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>寫法</th>
              <th>送進更新式的量</th>
              <th>
                loop gain <Tex>g</Tex>
              </th>
              <th>
                <Tex>{R`\mu`}</Tex> 的穩定範圍
              </th>
              <th>RTL</th>
              <th>注意</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>sum</td>
              <td>
                <Tex>{R`S_k`}</Tex>
              </td>
              <td>
                <Tex>{R`N\mu K`}</Tex>
              </td>
              <td>
                <Tex>{R`0<\mu<2/(NK)`}</Tex>
              </td>
              <td>沒有右移</td>
              <td>{mt(R`$N$ 一改，$g$ 跟著變；sum 的 $\mu$ 要用 $\mu_\mathrm{avg}/N$`)}</td>
            </tr>
            <tr>
              <td>average（除法器）</td>
              <td>
                <Tex>{R`S_k/N`}</Tex>
              </td>
              <td>
                <Tex>{R`\mu K`}</Tex>
              </td>
              <td>
                <Tex>{R`0<\mu<2/K`}</Tex>
              </td>
              <td>{mt(R`除法器或 $\times(1/N)$ 常數`)}</td>
              <td>{mt(R`$N$ 非 2 的冪時有額外 rounding 與 gain 誤差`)}</td>
            </tr>
            <tr>
              <td>{mt(R`average（右移 $\log_2N$）`)}</td>
              <td>
                <Tex>{R`\lfloor S_k/2^{\log_2N}\rfloor`}</Tex>
              </td>
              <td>
                <Tex>{R`\mu K`}</Tex>
              </td>
              <td>同上</td>
              <td>算術右移</td>
              <td>{mt(R`全部截掉 $\Rightarrow G$ 解析度 1 code LSB，收斂附近幾乎都是 $0$ 或 $-1$`)}</td>
            </tr>
            <tr>
              <td>{mt(R`右移 $\ell=\log_2N-F_G$`)}</td>
              <td>
                <Tex>{R`Q(S_k/2^\ell)\cdot2^{-F_G}`}</Tex>
              </td>
              <td>
                <Tex>{R`\mu K`}</Tex>
              </td>
              <td>同上</td>
              <td>右移 + rounding</td>
              <td>
                推薦；rounding 用 half-even，或確認 <Tex>{R`\bar\varepsilon\Delta_G/K`}</Tex> 可忽略
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>位元級細節總表</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>環節</th>
              <th>選項</th>
              <th>平均效應</th>
              <th>結論</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <Tex>{R`b\to q`}</Tex>
              </td>
              <td>
                <Tex>{R`2b-1`}</Tex> ／ 直接用 <Tex>b</Tex>
              </td>
              <td>
                <Tex>{R`\pm1`}</Tex>：<Tex>{R`E[G]\approx K\delta`}</Tex>；<Tex>b</Tex>：<Tex>{R`\tfrac12K\delta+\tfrac12E[x]`}</Tex>
              </td>
              <td>一定要映射 <ClaimTag kind="exact" /></td>
            </tr>
            <tr>
              <td>條件取負</td>
              <td>{mt(R`$B_x+1$ bits ／ $B_x$ bits`)}</td>
              <td>{mt(R`$B_x$ bits 時最負 code 的乘積符號錯：$w^*-a\approx-p_\mathrm{min}/K$`)}</td>
              <td>延伸寬度或限制 code 對稱</td>
            </tr>
            <tr>
              <td>累加器</td>
              <td>足夠 bits ／ wrap ／ saturate</td>
              <td>wrap：開機時變號；saturate：方向對但變慢</td>
              <td>
                <Tex>{R`B_\mathrm{acc}\ge1+\lceil\log_2(NM_x+1)\rceil`}</Tex>（對稱 code：<Tex>{R`B_x+\lceil\log_2N\rceil`}</Tex> 足夠；含最負 code 且 <Tex>{R`N=2^m`}</Tex> 再 +1）
              </td>
            </tr>
            <tr>
              <td>右移 rounding</td>
              <td>floor ／ half-up ／ toward-0 ／ half-even</td>
              <td>
                <Tex>{R`\bar\varepsilon=-\tfrac{1-2^{-\ell}}{2},\;2^{-\ell-1},\;\mp\tfrac{1-2^{-\ell}}{2}\,(\text{依 }\mathrm{sign}\,S),\;0`}</Tex>
                <br />
                <span className="small muted">{mt(R`（餘數均勻時；half-even 的 $0$ 另需「恰好一半」時商的奇偶各半，F-04.10；閉迴路的 $\delta^*=0$ 靠的是奇對稱，不靠這個條件）`)}</span>
              </td>
              <td>{mt(R`half-even；或足夠的 $F_G$`)}</td>
            </tr>
            <tr>
              <td>
                <Tex>{R`\mu G\to W`}</Tex>（<Tex>W</Tex> 的 LSB <Tex>{R`\Delta_W`}</Tex>）
              </td>
              <td>足夠的小數位元 ／ floor ／ half-even</td>
              <td>
                floor：<Tex>{R`w^*-a\approx-\Delta_W/(2g)`}</Tex>，<Tex>{R`\mu`}</Tex> 越小越大；half-even：0
              </td>
              <td>
                <Tex>{R`\Delta_W\le2g\,\delta_\mathrm{tol}`}</Tex>，或 half-even
              </td>
            </tr>
            <tr>
              <td>gain accumulator</td>
              <td>anti-windup ／ 只 clamp 輸出 ／ wrap</td>
              <td>回復時間 0 ／ 正比於 windup 深度 ／ rail 跳 rail</td>
              <td>anti-windup</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>綜合手算：把整條 datapath 算一遍</h3>
      <p>
        做思考題之前，先把本章的公式串起來用一次：給定 comparator 雜訊、<Tex>{R`\mu`}</Tex>、code 位元數、block 長度和兩個右移量，依序算出 <Tex>K</Tex>、<Tex>g</Tex>、穩定餘裕、累加器位元數，以及兩個截斷點各讓{' '}
        <Tex>w</Tex> 偏多少。
      </p>
      <MermaidFig
        chart={HANDCALC_FLOW}
        caption={R`綜合手算 HC-04.8 的計算順序（由上往下算）。看藍色的 $K$ 與 $g$：它們是樞紐，後面的穩定檢查和兩個偏差都要用到；綠色是最後的答案 $w^*-a$。`}
        ariaLabel="綜合手算的計算流程：增益、穩定、位元數、兩個截斷點的偏差"
      />
      <p>
        <strong>先看</strong>從「七個輸入」往下的前兩條支線：由雜訊 <Tex>{R`\sigma_v`}</Tex> 算 comparator 增益 <Tex>{R`K_q`}</Tex>，由 code 位元數 <Tex>{R`B_x`}</Tex> 算 code 的均方 <Tex>{R`E[x^2]`}</Tex>，兩者相乘得到 <Tex>K</Tex>（這一題的{' '}
        <Tex>{R`C=E[x^2]`}</Tex>），再乘 <Tex>{R`\mu`}</Tex> 得到 <Tex>g</Tex>，並且先拿 <Tex>g</Tex> 和臨界增益 <Tex>{R`g_\mathrm{crit}`}</Tex> 比一次，確認迴路穩定。<strong>再看</strong>另外兩條支線：一條直接給出累加器位元數 <Tex>{R`B_\mathrm{acc}`}</Tex>；另一條由 <Tex>{R`\log_2N`}</Tex> 與 <Tex>{R`F_G`}</Tex> 算右移量 <Tex>{R`\ell`}</Tex> 與刻度 <Tex>{R`\Delta_G`}</Tex>，接著分成兩個偏差——偏差 ① 除以 <Tex>K</Tex>（F-04.11），偏差 ② 除以 <Tex>g</Tex>（F-04.18）。<strong>最後</strong>把兩個偏差相加。圖上每一格就是下面手算題的一到兩個步驟，可以邊算邊對照自己算到哪裡；虛線標出其餘幾個輸入用在哪裡（<Tex>{R`\mu`}</Tex> 接到 <Tex>g</Tex>、<Tex>{R`\mu`}</Tex> 與 <Tex>{R`\ell_W`}</Tex> 接到 <Tex>{R`\Delta_W`}</Tex>、<Tex>d</Tex> 接到穩定檢查）。
      </p>
      <HandCalcBox id="HC-04.8">
        把七個數字換成你自己的設計（或按「換一題」），拿紙筆和工程計算機從第一步算到最後一步，再切到「自己算算看」對答案；預設值是 §5.6「第二個截斷點」的例子。
      </HandCalcBox>

      <h3>思考題（Part 2：RTL 與定點）</h3>
      <p className="small muted">
        這四題都是「RTL 做出來和浮點模型不一樣」的地方：少一個右移、累加器位元數、兩個截斷點。訊號流與數學的六題在 Part 1 的最後（§3 之後）。
      </p>
      <Quiz
        title="思考題 7（sum vs average）"
        question={
          <>
            設計時用 average 模式：<Tex>{R`N=256,\;\mu=10\,\mathrm{fs},\;\sigma_v=100\,\mathrm{fs},\;C=1`}</Tex>，所以 <Tex>{R`g=${tx(q1.gAvg, 4)}`}</Tex>。RTL 忘了右移（變成 sum
            模式）、<Tex>{R`\mu`}</Tex> 沒改。新的 <Tex>g</Tex> 與平均 pole 是多少？
          </>
        }
        options={[
          { label: <Tex>{R`g=${tx(q1.gAvg, 4)}`}</Tex> },
          { label: <Tex>{R`g=${tx(q1.gAvg * 4, 4)}`}</Tex> },
          { label: <Tex>{R`g=${tx(q1.gSum, 4)},\;p=${tx(q1.poleSum, 4)}`}</Tex>, correct: true },
          { label: <Tex>{R`g=${tx(q1.gAvg * 4096, 4)}`}</Tex> },
        ]}
        answer={
          <>
            <TexBlock>{R`g_\mathrm{sum}=N\,g_\mathrm{avg}=256\times${tx(q1.gAvg, 6)}=${tx(q1.gSum, 6)},\qquad p=1-g=${tx(q1.poleSum, 6)}`}</TexBlock>
            <p>
              <Tex>{R`|p|\gg1`}</Tex>：一階平均模型不穩定。sign-LMS 的 <Tex>{R`|S|\le N\max|x|`}</Tex> 有界，所以實際看到的是 <Tex>w</Tex> 在 <Tex>a</Tex> 兩側做大振幅擺盪，而不是數值無限大。修正：右移補回來，或 <Tex>{R`\mu`}</Tex> 改成 <Tex>{R`10/256\,\mathrm{fs}`}</Tex>。
            </p>
          </>
        }
      />
      <Quiz
        title="思考題 8（累加器位元數）"
        question={
          <>
            8-bit 有號 code，<strong>包含</strong>最負值 <Tex>{R`-128`}</Tex>；<Tex>{R`N=1024`}</Tex>。最壞情況不溢位，GMAC 累加器最少要幾個有號 bit？
          </>
        }
        options={[{ label: '17' }, { label: '18' }, { label: '19', correct: q2.full.bitsExact === 19 }, { label: '26' }]}
        answer={
          <>
            <p>
              <Tex>{R`-128`}</Tex> 取負是 <Tex>{R`+128`}</Tex>，所以 <Tex>{R`M_x=128`}</Tex>、<Tex>{R`|q\,x|\le128`}</Tex>，<Tex>{R`|S|\le1024\times128=${q2.full.maxPosSum}`}</Tex>。需要{' '}
              <Tex>{R`2^{B-1}-1\ge${q2.full.maxPosSum}`}</Tex>，即 <Tex>{R`B=${q2.full.bitsExact}`}</Tex>（18 bits 的上限 131071 差 1）。若 code 限制在 <Tex>{R`\pm127`}</Tex>（對稱），<Tex>{R`|S|\le${q2.sym.maxPosSum}`}</Tex>，<Tex>{R`B=${q2.sym.bitsExact}=8+\log_2 1024`}</Tex>。
            </p>
          </>
        }
      />
      <Quiz
        title="思考題 9（floor 的偏差，計算題）"
        question={
          <>
            右移 <Tex>{R`\ell=${q5.ell}`}</Tex> bits 用 floor，<Tex>{R`\Delta_G=2^{-4}/32`}</Tex>，<Tex>{R`K=${q5.K}\,\mathrm{fs}^{-1}`}</Tex>，GMAC 雜訊足以讓餘數均勻。<Tex>w</Tex> 會停在 <Tex>a</Tex> 的哪一側、差多少？
          </>
        }
        answer={
          <>
            <TexBlock>
              {R`\bar\varepsilon=-\frac{1-2^{-${q5.ell}}}{2}=${tx(q5.eps, 5)},\qquad\delta^*=-\frac{\bar\varepsilon\,\Delta_G}{K}=\frac{${tx(-q5.eps, 5)}\times${tx(q5.deltaG, 5)}}{${q5.K}}=${tx(q5.deltaStar, 4)}\,\mathrm{fs}`}
            </TexBlock>
            <p>
              <Tex>{R`\delta^*=a-w^*>0`}</Tex>：<Tex>w</Tex> 停在 <Tex>a</Tex> <strong>下方</strong>約 {f(q5.deltaStar, 3)} fs，和 <Tex>{R`\mu`}</Tex> 無關。改 half-even 偏差變 0；或多保留 2 個小數位元（<Tex>{R`\Delta_G`}</Tex> 變 1/4），偏差約變成 1/4。
            </p>
          </>
        }
      />

      <Quiz
        title={R`思考題 10（$\mu$ 減半，RTL 的偏差卻變大？）`}
        question={
          <>
            「<Tex>{R`\div N`}</Tex>」的右移用 half-even（沒有偏差）。更新量 <Tex>{R`\mu G`}</Tex> 加進 <Tex>W</Tex> 前用 floor 對齊 <Tex>W</Tex> 的 LSB{' '}
            <Tex>{R`\Delta_W=${tx(q6.wLsb, 6)}\,\mathrm{fs}`}</Tex>；<Tex>{R`\mu=${q6.mu}\,\mathrm{fs}`}</Tex> 時 <Tex>{R`g=\mu K=${tx(q6.g, 4)}`}</Tex>、<Tex>{R`R=\Delta_W/(\mu\Delta_G)=${q6.R}`}</Tex>，量到 <Tex>{R`w^*-a\approx${tx(q6.bias, 3)}\,\mathrm{fs}`}</Tex>。為了降低雜訊把 <Tex>{R`\mu`}</Tex> 減半（<Tex>{R`\Delta_W`}</Tex> 不變）。偏差會變成多少？
          </>
        }
        options={[
          { label: mt(R`不變（rounding 偏差與 $\mu$ 無關）`) },
          { label: mt(R`減半，約 $${tx(q6.bias / 2, 3)}\,\mathrm{fs}$`) },
          { label: mt(R`約加倍，$${tx(q6.biasHalf, 3)}\,\mathrm{fs}$`), correct: true },
          { label: mt(R`變成 4 倍，約 $${tx(q6.bias * 4, 3)}\,\mathrm{fs}$`) },
        ]}
        answer={
          <>
            <TexBlock>
              {R`w^*-a=\frac{\bar\varepsilon_W\Delta_W}{g},\quad\bar\varepsilon_W=-\frac{1-1/R}{2}:\qquad\mu\to\tfrac\mu2\;\Rightarrow\;g\to\tfrac g2,\;R\to${q6.Rhalf}\;\Rightarrow\;w^*-a=\frac{${tx(-(1 - 1 / q6.Rhalf) / 2, 5)}\times${tx(q6.wLsb, 6)}}{${tx(q6.g / 2, 4)}}=${tx(q6.biasHalf, 4)}\,\mathrm{fs}`}
            </TexBlock>
            <p>
              F-04.18：偏差是「半個 <Tex>W</Tex>-LSB 除以 loop gain」。<Tex>{R`\Delta_W`}</Tex> 是固定的硬體格點，<Tex>g</Tex> 減半偏差就加倍（<Tex>{R`(1-1/R)`}</Tex> 由 {tx((1 - 1 / q6.R), 4)} 變成{' '}
              {tx(1 - 1 / q6.Rhalf, 4)}，所以比 2 倍再多一點）。「與 <Tex>{R`\mu`}</Tex> 無關」只對「<Tex>{R`\div N`}</Tex>」那一次截斷成立（F-04.11），因為那裡的 LSB <Tex>{R`\mu\Delta_G`}</Tex> 跟著 <Tex>{R`\mu`}</Tex> 一起縮小。修正：<Tex>W</Tex> 多留小數位元（<Tex>{R`\Delta_W\le2g\,\delta_\mathrm{tol}`}</Tex>），或用 half-even。
            </p>
          </>
        }
      />
    </Section>
  )
}
