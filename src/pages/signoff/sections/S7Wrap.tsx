import { MathText, Quiz, Recap, Section, Tex } from '@/components'
import { eigSym } from '@/simulation/core'
import { failureUpperBound, kq, mimoJudge } from '../judges'
import { tx } from '../shared'

/** §11：思考題與本頁必記 */
export function S7Wrap() {
  const pu = failureUpperBound(0, 100)
  // 對稱、−J 正定的例子：J = −K_q·[[1, 0.5],[0.5, 1]]（σ_v = 100 fs）
  const k = kq(100)
  const J = [
    [-k, -0.5 * k],
    [-0.5 * k, -k],
  ]
  const lamMax = eigSym(J.map((r) => r.map((v) => -v))).values[0] // −J 的最大 eigenvalue（= K_q(1 + 0.5)）
  const muEdge = 2 / lamMax
  const inside = mimoJudge(J, [
    [0.9 * muEdge, 0],
    [0, 0.9 * muEdge],
  ])
  const outside = mimoJudge(J, [
    [1.1 * muEdge, 0],
    [0, 1.1 * muEdge],
  ])
  return (
    <Section kind="example" level={2} title="11. 思考題與本頁必記" id="so-wrap">
      <Quiz
        title="思考題 11-1"
        question="FCW sweep 的 100 個均勻隨機點、各 1 個 seed 都沒有發散。95% 信心下，最多能宣稱什麼？"
        options={[
          { label: '所有 FCW 都穩定' },
          { label: <MathText>{`對同分布的隨機 FCW，發散機率 $\\le${tx(pu, 3)}$`}</MathText>, correct: true },
          { label: '發散機率為 0' },
          { label: '均方穩定' },
        ]}
        answer={
          <p>
            <Tex>{`p_U=1-0.05^{1/100}=${tx(pu, 5)}`}</Tex>。這只對「同分布的隨機 FCW」成立；特定的 near-integer FCW 要另外列入 sweep。「沒有發散」也不是均方穩定（heavy tail，§3）。
          </p>
        }
      />
      <Quiz
        title="思考題 11-2"
        question={
          <>
            設計者回報「GMAC 輸出已經平均為 0，所以 DTC gain 校正正確、spur 消失」。你在 review 時應該要求補什麼？
          </>
        }
        options={[
          { label: <MathText>{'不用補，$E[G]=0$ 就是正確'}</MathText> },
          { label: '只要再跑一次更長的模擬' },
          { label: <MathText>{String.raw`固定點 bias（$w^*-a$，含 INL、offset、$\varepsilon_{cc}$ 與架構的 DC null）與 output-level 的 spur／PN 量測`}</MathText>, correct: true },
          { label: '只要提高 PM' },
        ]}
        answer={
          <p>
            <Tex>{'E[G(w^*)]=0'}</Tex> 只定義固定點：<Tex>{'w^*\\approx a+B_\\text{bias}/C'}</Tex>。spur 來自 <Tex>{'\\delta t=x\\,\\delta w'}</Tex> 的頻譜混合與殘餘 INL，要在輸出（經 <Tex>{'T'}</Tex>）量測。這是 §16.3 的第二個 ❌ 例句。
          </p>
        }
      />
      <Quiz
        title="思考題 11-3（Research）"
        question={
          <>
            <Tex>{'\\mathbf J=-K_q\\begin{bmatrix}1&0.5\\\\0.5&1\\end{bmatrix}'}</Tex>（對稱、<Tex>{'-\\mathbf J'}</Tex> 正定），<Tex>{'\\mathbf M=\\mu\\mathbf I'}</Tex>。<Tex>{'\\mu'}</Tex> 的穩定上限是多少？
          </>
        }
        answer={
          <>
            <p>
              <Tex>{'\\mathbf I+\\mu\\mathbf J'}</Tex> 的 eigenvalue 是 <Tex>{'1-\\mu\\lambda_i(-\\mathbf J)'}</Tex>；<Tex>{'\\lambda_{\\max}(-\\mathbf J)=1.5K_q'}</Tex>，所以 <Tex>{`0<\\mu<2/(1.5K_q)=${tx(muEdge, 5)}\\,\\mathrm{fs}`}</Tex>。
            </p>
            <p>
              驗算（本頁 mimoJudge）：<Tex>{'\\mu=0.9\\mu_\\text{edge}'}</Tex> 時 <Tex>{`\\rho=${tx(inside.rho, 5)}`}</Tex>；<Tex>{'1.1\\mu_\\text{edge}'}</Tex> 時 <Tex>{`\\rho=${tx(outside.rho, 5)}`}</Tex>。注意上限由 <Tex>{'\\lambda_{\\max}=K_q(1+\\rho_{12})'}</Tex> 決定，比只看對角元素 <Tex>{'K_q'}</Tex> 得到的 <Tex>{'2/K_q'}</Tex> 小——這就是「各自穩定 ≠ 一起穩定」的溫和版本。
            </p>
          </>
        }
      />
      <Recap
        title="這一頁最重要的公式"
        formulas={[
          { label: String.raw`極性：freeze $\pm\Delta$ 的斜率與判決`, tex: String.raw`\boxed{\hat K=-\frac{\bar G(w+\Delta)-\bar G(w-\Delta)}{2\Delta}>z\,\frac{\sigma_\eta}{\Delta\sqrt{2M}}}` },
          { label: '延遲下的穩定與 PM', tex: String.raw`\boxed{g<g_\text{crit}(d)=2\sin\frac{\pi}{4d+2},\qquad PM_d=90^\circ-(2d+1)\arcsin\frac g2}` },
          { label: '多參數局部線性穩定', tex: String.raw`\boxed{\rho\big(\mathbf I+\mathbf M\mathbf J_\text{true}\big)<1}` },
          { label: '0 次失效的證據強度', tex: String.raw`\boxed{p_U=1-\alpha^{1/n}\approx\frac{-\ln\alpha}{n}}` },
          { label: '定點', tex: String.raw`\boxed{B_\text{acc}\ge B_x+\lceil\log_2N\rceil,\qquad c=\tfrac Pq\Rightarrow T_\text{lc}=q}` },
        ]}
        points={[
          <>先驗極性：每個 mode、每個 FCW、每個 corner、每個參數都要做 freeze <Tex>{'\\pm\\Delta'}</Tex>；<Tex>{'C'}</Tex> 接近 0 的地方最需要量。</>,
          <>「穩定」必須說種類：mean、mean-square、almost-sure、local linear、機率性有界，或「指定 sweep／seeds 未觀察到失效」。</>,
          <>單點 PM 與各自穩定都不代表整體：要用實際的 <Tex>{'d'}</Tex> 與完整的 <Tex>{'\\mathbf I+\\mathbf M\\mathbf J'}</Tex>。</>,
          <>Monte Carlo 只能給失效機率上界；heavy-tail 指標用封閉式或分位數，不用長時間樣本平均。</>,
          <>GMAC 歸零 ≠ 無 bias ≠ 無 spur；最後驗收的是 PLL 輸出（經 <Tex>{'T'}</Tex>，不是 <Tex>{'H_\\mathrm{PD}'}</Tex>）。</>,
        ]}
      />
    </Section>
  )
}
