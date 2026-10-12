import { useMemo } from 'react'
import { Callout, ClaimTag, CodeBlock, CodeCompare, ModeGate, Section, StepDerivation, Tex, TexBlock, mathText } from '@/components'
import { conventionalStep } from '@/simulation/models/lms'
import lmsSrc from '@/simulation/models/lms.ts?raw'
import bridgeSrc from '../bridge.ts?raw'
import { CONVENTION_SHORT, conventionHandTable } from '../bridge'
import { Diagram, ErratumNote, Fold, FormulaAnchor, Hand, Question, num, r } from '../common'
import { CHART_CONVENTION_BRIDGE } from '../diagrams'

/** 規格 §1.2 的手算例（Gallery #1）：w0 = 1、a = 3、x = 2、μ = 0.1 */
export const HAND = { a: 3, w0: 1, x: 2, mu: 0.1, steps: 3 } as const

const BRIDGE_PATH = 'src/pages/papers/bridge.ts'

/** 文獻記號對照：只列廣為人知的寫法，並提醒以手上的版本為準。 */
const NOTATION: { concept: string; site: string; widrow: string; haykin: string; fx: string }[] = [
  {
    concept: '輸入／regressor',
    site: r`x[n]\ (\text{raw}),\ u[n]=(h*x)[n]`,
    widrow: r`\mathbf X_k`,
    haykin: r`\mathbf u(n)`,
    fx: r`x(n),\ x'(n)=\hat s*x\ (\text{filtered})`,
  },
  { concept: '係數', site: r`w_k,\ \mathbf w_k`, widrow: r`\mathbf W_k`, haykin: r`\hat{\mathbf w}(n)`, fx: r`\mathbf w(n)` },
  { concept: '誤差', site: r`e[n]`, widrow: r`\varepsilon_k`, haykin: r`e(n)`, fx: r`e(n)` },
  {
    concept: '更新式',
    site: r`w\leftarrow w+\mu\,e\,x`,
    widrow: r`\mathbf W\leftarrow\mathbf W+2\mu\,\varepsilon\,\mathbf X`,
    haykin: r`\hat{\mathbf w}\leftarrow\hat{\mathbf w}+\mu\,\mathbf u\,e^*`,
    fx: r`\mathbf w\leftarrow\mathbf w+\mu\,e\,\mathbf x'`,
  },
  { concept: '誤差路徑與模型', site: r`H_{\mathrm{PD}},\ \hat H`, widrow: '—', haykin: '—', fx: r`S(z),\ \hat S(z)\ (\text{secondary path})` },
]

/** 四種寫法並排比較（公式皆為本站推導；NLMS 與 GMAC 的界限為近似） */
const COMPARE: { name: string; cost: string; update: string; bound: string; boundClaim: 'exact' | 'approx'; unit: string; hw: string }[] = [
  {
    name: `${CONVENTION_SHORT.half}（本站 Part A）`,
    cost: r`\tfrac12e^2`,
    update: r`w+\mu\,e\,x`,
    bound: r`0<\mu<2/\lambda_{\max}`,
    boundClaim: 'exact',
    unit: r`依 $x$ 的尺度`,
    hw: '多位元誤差與多位元 regressor 相乘的乘法器',
  },
  {
    name: CONVENTION_SHORT.widrow,
    cost: r`\varepsilon^2`,
    update: r`w+2\mu_W\,\varepsilon\,x`,
    bound: r`0<\mu_W<1/\lambda_{\max}`,
    boundClaim: 'exact',
    unit: r`依 $x$ 的尺度`,
    hw: '同上（只是步長記法不同）',
  },
  {
    name: CONVENTION_SHORT.nlms,
    cost: r`\tfrac12e^2\ (\text{正規化步長})`,
    update: r`w+\tilde\mu\,e\,x/(\epsilon_{\mathrm{reg}}+\|x\|^2)`,
    bound: r`0<\tilde\mu<2`,
    boundClaim: 'approx',
    unit: '無因次',
    hw: '需要即時估計輸入能量並做一次除法',
  },
  {
    name: `${CONVENTION_SHORT.signBlock}（本站 Part B）`,
    cost: r`|e|\ (\text{sign-error})`,
    update: r`w+\mu\,\tfrac1N\textstyle\sum q\,x`,
    bound: r`0<\mu K_q\lambda_{\max}<2`,
    boundClaim: 'approx',
    unit: r`$\mathrm{fs}$（average 模式）`,
    hw: '1-bit comparator、條件取負、累加器、shift',
  },
]

/** §4：讀文獻前的換算——步長的三種寫法、NLMS、block sign-GMAC。 */
export function S4Conventions() {
  const rows = useMemo(() => conventionHandTable(HAND, conventionalStep), [])
  return (
    <Section kind="formula" level={2} title="4. 讀文獻前的換算：同一個 LMS，三種寫法" id="papers-conventions">
      <Question>
        Widrow 型教科書寫 <Tex>{r`\mathbf W_{k+1}=\mathbf W_k+2\mu\,\varepsilon_k\mathbf X_k`}</Tex>、穩定界 <Tex>{r`0<\mu<1/\lambda_{\max}`}</Tex>；本站寫{' '}
        <Tex>{r`w_{n+1}=w_n+\mu e_nx_n`}</Tex>、界限 <Tex>{r`0<\mu<2/\lambda_{\max}`}</Tex>。是誰錯了？
      </Question>
      <p>
        <strong>都沒錯</strong>，兩邊的 <Tex>{r`\mu`}</Tex> 是不同的數。先用規格 §1.2 的手算例看：<Tex>{r`w_0=${HAND.w0}`}</Tex>、<Tex>{r`a=${HAND.a}`}</Tex>、
        <Tex>{r`x=${HAND.x}`}</Tex>（<Tex>{r`y=ax=${HAND.a * HAND.x}`}</Tex>）。本站用 <Tex>{r`\mu=${HAND.mu}`}</Tex>；Widrow 型用一半的{' '}
        <Tex>{r`\mu_W=${HAND.mu / 2}`}</Tex>；NLMS 用 <Tex>{r`\tilde\mu=\mu x^2=${num(HAND.mu * HAND.x * HAND.x, 4)}`}</Tex>：
      </p>
      <div className="table-wrap">
        <table className="papers-table">
          <thead>
            <tr>
              <th className="num">
                <Tex>{'n'}</Tex>
              </th>
              <th className="num">
                <Tex>{'e_n=y-w_nx'}</Tex>
              </th>
              <th className="num">
                {mathText(CONVENTION_SHORT.half)} <Tex>{r`w_n`}</Tex>
              </th>
              <th className="num">
                Widrow 型 <Tex>{r`w_n`}</Tex>
              </th>
              <th className="num">
                NLMS <Tex>{r`w_n`}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.n}>
                <td className="num">{row.n}</td>
                <td className="num mono">{num(row.e, 6)}</td>
                <td className="num mono">{num(row.wHalf, 6)}</td>
                <td className="num mono">{num(row.wWidrow, 6)}</td>
                <td className="num mono">{num(row.wNlms, 6)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        三欄由三段不同的程式碼（下方 CodeCompare）實際執行得到；{mathText(CONVENTION_SHORT.half)}那一欄就是 Ch00–Ch03 使用的 <code>conventionalStep</code>。
      </p>
      <Diagram
        chart={CHART_CONVENTION_BRIDGE}
        caption="四種寫法先換算成同一個量，再用同一條規則判斷穩定。箭頭上的式子就是換算方式；藍色是共同的中間量。"
        ariaLabel="步長寫法換算圖：本站 Part A、Widrow 型、NLMS、block sign-GMAC 四種更新式換成每單位 eigenvalue 的平均 loop gain，再算每個 eigen-mode 的 loop gain 與 pole"
      >
        <p>
          <strong>先看</strong>最上面一排四個方塊：四種寫法的更新式長得不一樣，但都可以換算成同一個量 <Tex>{'s'}</Tex>（每單位 eigenvalue 的平均 loop gain）。箭頭上寫的就是換算式；Widrow 型的{' '}
          <Tex>{r`s=2\mu_W`}</Tex> 就是「差 2 倍」的來源，下面馬上推導。
        </p>
        <p>
          <strong>再看</strong>往下：有了 <Tex>{'s'}</Tex>，第 <Tex>{'i'}</Tex> 個 eigen-mode 的 loop gain 是 <Tex>{r`g_i=s\lambda_i`}</Tex>（<Tex>{r`\lambda_i`}</Tex> 是 regressor 自相關矩陣的特徵值），pole 是{' '}
          <Tex>{'p_i=1-g_i'}</Tex>，穩定條件對四種寫法都一樣。圖上藍色的 <Tex>{'s'}</Tex> 就是本節後面 <code>gainScale</code> 那段程式回傳的數。
        </p>
      </Diagram>
      <Fold
        title={
          <>
            推導：為什麼差 2 倍（
            <ErratumNote id="E41" />）
          </>
        }
      >
        <FormulaAnchor id="F-PR.1">
          <StepDerivation
            steps={[
              {
                tex: r`J_W(w)=E[\varepsilon^2],\qquad \varepsilon=y-wx`,
                why: (
                  <>
                    Widrow 型的成本：平方誤差的期望值，前面沒有 <Tex>{r`\tfrac12`}</Tex>。
                  </>
                ),
              },
              {
                tex: r`\frac{dJ_W}{dw}=E\!\left[2\varepsilon\cdot\frac{d\varepsilon}{dw}\right]=-2E[\varepsilon x]`,
                why: (
                  <>
                    鏈鎖律：<Tex>{r`d(\varepsilon^2)/dw=2\varepsilon\,d\varepsilon/dw`}</Tex>，而 <Tex>{r`d\varepsilon/dw=-x`}</Tex>；微分與期望值可以交換。
                  </>
                ),
              },
              {
                tex: r`w_{k+1}=w_k-\mu_W\,(-2\varepsilon_kx_k)=w_k+2\mu_W\,\varepsilon_kx_k`,
                why: '最陡下降（往負梯度走），再把期望值換成當筆的值（stochastic gradient）。',
              },
              {
                tex: r`j_n=\tfrac12e_n^2\ \Longrightarrow\ \frac{dj_n}{dw}=-e_nx_n\ \Longrightarrow\ w_{n+1}=w_n+\mu\,e_nx_n`,
                why: (
                  <>
                    本站（規格 §1.1）的單筆成本帶 <Tex>{r`\tfrac12`}</Tex>，微分時剛好把 <Tex>{'2'}</Tex> 消掉。
                  </>
                ),
              },
              {
                tex: r`\mu=2\mu_W`,
                why: '兩個更新式逐項相等的條件。',
              },
              {
                tex: r`p_i=1-\mu\lambda_i=1-2\mu_W\lambda_i\quad\Longrightarrow\quad 0<\mu<\frac{2}{\lambda_{\max}}\ \Longleftrightarrow\ 0<\mu_W<\frac{1}{\lambda_{\max}}`,
                why: (
                  <>
                    同一個 pole，只是換了變數；<Tex>{r`|p_i|<1`}</Tex> 的條件也跟著換。
                  </>
                ),
              },
            ]}
            result={r`\mu_{\text{本站}}=2\,\mu_{W}`}
          />
        </FormulaAnchor>
      </Fold>
      <Hand id="HC-PR.1" />
      <CodeCompare
        caption={r`四段都是網站實際執行的程式碼：$\tfrac12e^2$ 型來自 Part A 共用的 lms.ts；其他三段來自本頁的 bridge.ts（上方表格與下方實驗就是用它們算的）。標「← 差異」的行是關鍵差別。`}
        items={[
          {
            label: '本站 Part A 寫法',
            source: lmsSrc,
            region: 'conventionalStep',
            path: 'src/simulation/models/lms.ts',
            note: r`成本 $\tfrac12e^2$：更新量就是步長乘誤差乘輸入`,
          },
          { label: 'Widrow 寫法', source: bridgeSrc, region: 'widrowStep', path: BRIDGE_PATH, note: r`成本 $\varepsilon^2$：梯度多一個 $2$` },
          { label: 'NLMS', source: bridgeSrc, region: 'nlmsStep', path: BRIDGE_PATH, note: r`步長除以 regressor 能量 $\epsilon_{\mathrm{reg}}+\|x\|^2$` },
          {
            label: 'Block Sign-GMAC（本站 Part B）',
            source: bridgeSrc,
            region: 'blockSignGmacStep',
            path: BRIDGE_PATH,
            note: r`1-bit 誤差 $q=\mathrm{sign}(e)$、$N$ 個 sample 更新一次`,
          },
        ]}
      />
      <h3 className="papers-subhead">四種寫法並排比較</h3>
      <div className="table-wrap">
        <table className="papers-table">
          <thead>
            <tr>
              <th>寫法</th>
              <th>成本（每筆）</th>
              <th>更新式</th>
              <th>平均穩定界（無延遲）</th>
              <th>步長單位</th>
              <th>硬體需要</th>
            </tr>
          </thead>
          <tbody>
            {COMPARE.map((row) => (
              <tr key={row.name}>
                <td className="nowrap">{mathText(row.name)}</td>
                <td>
                  <Tex>{row.cost}</Tex>
                </td>
                <td>
                  <Tex>{row.update}</Tex>
                </td>
                <td>
                  <Tex>{row.bound}</Tex>
                  {row.boundClaim === 'approx' && (
                    <>
                      {' '}
                      <ClaimTag kind="approx" />
                    </>
                  )}
                </td>
                <td className="nowrap">{mathText(row.unit)}</td>
                <td>{row.hw}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="papers-subhead">NLMS：步長自己會依輸入大小縮放</h3>
      <Fold title="推導：NLMS 的收縮因子與等效步長">
        <FormulaAnchor id="F-PR.2">
          <StepDerivation
            steps={[
              {
                tex: r`w_{n+1}=w_n+\frac{\tilde\mu}{\epsilon_{\mathrm{reg}}+x_n^2}\,e_nx_n`,
                why: (
                  <>
                    NLMS 的定義：<Tex>{r`\epsilon_{\mathrm{reg}}\ge0`}</Tex> 防止 <Tex>{'x'}</Tex> 很小時除以 0。
                  </>
                ),
              },
              {
                tex: r`\delta_{n+1}=\Big(1-\frac{\tilde\mu\,x^2}{\epsilon_{\mathrm{reg}}+x^2}\Big)\delta_n`,
                why: (
                  <>
                    固定 <Tex>{'x'}</Tex>、無雜訊時 <Tex>{r`e_n=\delta_nx`}</Tex>（<Tex>{r`\delta=a-w`}</Tex>），代入後整理。
                  </>
                ),
              },
              {
                tex: r`0<\tilde\mu<\frac{2(\epsilon_{\mathrm{reg}}+x^2)}{x^2}\ \xrightarrow{\ \epsilon_{\mathrm{reg}}=0\ }\ 0<\tilde\mu<2`,
                why: (
                  <>
                    等比數列收斂的充要條件是公比的絕對值小於 1；界限與 <Tex>{'x'}</Tex> 的大小無關，這就是「normalized」的意思。
                  </>
                ),
              },
              {
                tex: r`e_n^{\mathrm{post}}=y_n-\mathbf x_n^T\mathbf w_{n+1}=\Big(1-\frac{\tilde\mu\,\|\mathbf x_n\|^2}{\epsilon_{\mathrm{reg}}+\|\mathbf x_n\|^2}\Big)e_n`,
                why: <>向量時：用更新後的係數重新計算同一筆資料的誤差（a posteriori error），代入更新式即得；這一步是精確的代數。</>,
              },
            ]}
            result={r`\begin{aligned}s_{\mathrm{NLMS}}&\approx\frac{\tilde\mu}{\epsilon_{\mathrm{reg}}+E\|\mathbf x\|^2}\\&=\frac{\tilde\mu}{\epsilon_{\mathrm{reg}}+\mathrm{tr}\,\mathbf R}\end{aligned}`}
          />
        </FormulaAnchor>
      </Fold>
      <p>
        最後一個框是<strong>近似</strong> <ClaimTag kind="approx" />
        ：把每筆不同的 <Tex>{r`\|\mathbf x_n\|^2`}</Tex> 換成平均值 <Tex>{r`\mathrm{tr}\,\mathbf R`}</Tex>，才能和 {mathText(CONVENTION_SHORT.half)}的 <Tex>{r`\mu`}</Tex> 對照；長濾波器、
        <Tex>{r`\|\mathbf x\|^2`}</Tex> 波動小時較準。
      </p>
      <Callout kind="warn" title="NLMS 有兩個界限，以較嚴的為準">
        <p>
          把 <Tex>{r`s_{\mathrm{NLMS}}`}</Tex> 代進平均模型 <Tex>{r`|1-s\lambda_{\max}|<1`}</Tex>，會得到{' '}
          <Tex>{r`\tilde\mu<2(\epsilon_{\mathrm{reg}}+\mathrm{tr}\,\mathbf R)/\lambda_{\max}`}</Tex>。因為 <Tex>{r`\mathrm{tr}\,\mathbf R=\sum_i\lambda_i\ge\lambda_{\max}`}</Tex>
          ，這個界限比第 3、4 步的 <Tex>{r`\tilde\mu<2(\epsilon_{\mathrm{reg}}+\|\mathbf x\|^2)/\|\mathbf x\|^2`}</Tex> <strong>寬</strong>：它只保證{' '}
          <Tex>{r`E[\boldsymbol\delta]`}</Tex> 收斂。無雜訊、<Tex>{r`\epsilon_{\mathrm{reg}}=0`}</Tex> 時直接展開更新式可得
        </p>
        <TexBlock>{r`\|\boldsymbol\delta_{n+1}\|^2=\|\boldsymbol\delta_n\|^2-\tilde\mu\,(2-\tilde\mu)\,\frac{(\mathbf x_n^T\boldsymbol\delta_n)^2}{\|\mathbf x_n\|^2}`}</TexBlock>
        <p>
          <ClaimTag kind="exact" /> 所以 <Tex>{r`\tilde\mu>2`}</Tex> 時 <Tex>{r`\|\boldsymbol\delta\|`}</Tex> 每一步都<strong>不減反增</strong>，即使平均模型說{' '}
          <Tex>{r`E[\boldsymbol\delta]\to\mathbf 0`}</Tex>（和 §6 的 mean 與 mean-square 之別是同一類現象）。下方實驗的 NLMS 步長上限因此取兩者較小者。
        </p>
      </Callout>
      <Hand id="HC-PR.2" />
      <h3 className="papers-subhead">本站 block sign-GMAC：把 1-bit 也換算進來</h3>
      <TexBlock id="F-PR.3">{r`\begin{aligned}&G_k=\frac1N\sum_{n\in k}q[n]\,x[n],\quad E[G_k]\approx K_q\,C\,\delta_k\ \Longrightarrow\ \delta_{k+1}\approx(1-\mu K_qC)\,\delta_k\\[2pt]&s_{\mathrm{GMAC}}=\mu K_q\ \big(\times N\ \text{若誤用 sum 模式}\big)\end{aligned}`}</TexBlock>
      <p>
        <Tex>{r`\mu`}</Tex> 的單位是 fs、<Tex>{'K_q'}</Tex> 是 <Tex>{r`\mathrm{fs^{-1}}`}</Tex>，乘起來才是無因次的 loop gain（
        <ErratumNote id="E13" />
        ）。 所以「教科書的 <Tex>{r`\mu\lambda`}</Tex>」對應「本站的 <Tex>{r`g=\mu K_qC`}</Tex>」，<Tex>{'C'}</Tex> 扮演 eigenvalue
        的角色。下面這段就是本頁實驗用來把四種寫法換成同一個 <Tex>{'s'}</Tex>（<Tex>{r`g_i=s\lambda_i`}</Tex>）的程式：
      </p>
      <CodeBlock source={bridgeSrc} region="gainScale" path={BRIDGE_PATH} />
      <Hand id="HC-PR.3" />
      <ModeGate min="engineer">
        <h3 className="papers-subhead">文獻記號對照（常見寫法；以你手上的版本為準）</h3>
        <div className="table-wrap">
          <table className="papers-table">
            <thead>
              <tr>
                <th>概念</th>
                <th>本站</th>
                <th>
                  Widrow 型（<Tex>{r`2\mu`}</Tex>）
                </th>
                <th>Haykin 型</th>
                <th>主動控制 FxLMS 常見寫法</th>
              </tr>
            </thead>
            <tbody>
              {NOTATION.map((row) => (
                <tr key={row.concept}>
                  <td className="nowrap">{row.concept}</td>
                  <td>
                    <Tex>{row.site}</Tex>
                  </td>
                  <td>{row.widrow === '—' ? '—' : <Tex>{row.widrow}</Tex>}</td>
                  <td>{row.haykin === '—' ? '—' : <Tex>{row.haykin}</Tex>}</td>
                  <td>
                    <Tex>{row.fx}</Tex>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          主動控制文獻的更新式正負號取決於誤差的定義（控制路徑的輸出與干擾在誤差感測點是相加還是相減），不同教材的寫法因此可能差一個負號；
          判斷極性時要回到「誤差對係數的偏微分」的符號，而不是只比對更新式的長相（本站 Ch06 的 <Tex>{'C>0'}</Tex> 判據）。
        </p>
        <Callout kind="warn" title="最容易撞名的三個符號">
          <ul>
            <li>
              <Tex>{'u'}</Tex>：Haykin 型教材的 <Tex>{r`\mathbf u(n)`}</Tex> 是<strong>輸入向量</strong>（等於本站的 <Tex>{'x'}</Tex>）；本站的{' '}
              <Tex>{'u[n]'}</Tex> 是經 PLL 誤差路徑濾過的 regressor。
            </li>
            <li>
              <Tex>{r`\varepsilon`}</Tex> / <Tex>{r`\epsilon`}</Tex>：Widrow 型用它表示<strong>誤差</strong>；NLMS 文獻常用它表示 regularizer。本頁把後者寫成{' '}
              <Tex>{r`\epsilon_{\mathrm{reg}}`}</Tex>。
            </li>
            <li>
              <Tex>{r`\delta`}</Tex>：本站是參數誤差 <Tex>{r`a-w`}</Tex>（<ErratumNote id="E32" />
              ）；不少文獻用 <Tex>{r`w-w_o`}</Tex> 或把 <Tex>{r`\delta`}</Tex> 當 NLMS 的 regularizer。極性相反時 pole 不變，但偏差的正負號會反過來。
            </li>
          </ul>
        </Callout>
      </ModeGate>
    </Section>
  )
}
