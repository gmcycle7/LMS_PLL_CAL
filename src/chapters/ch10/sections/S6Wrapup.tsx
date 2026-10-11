import { Link } from 'react-router-dom'
import { Callout, ClaimTag, Quiz, Recap, Section, StepDerivation, Tex, TexBlock } from '@/components'
import { DEFAULT_RULE, analyzeRule, buildPlant, corrMatrix, inspectMatrix, kqFromSigma, stepsToDecay, stepsToDecayReal } from '@/simulation/models/mimo'
import { inv } from '@/simulation/core'
import { Erratum, Fig, Hand, n, tn } from '../common'
import { NUM, SIGMA_KQ1 } from '../numbers'

function quizNumbers() {
  // Q1：ρ = 0.5、δ = (2, 0)、K_q = 1
  const pQ1 = buildPlant({ mode: 'R', R: corrMatrix(2, 0.5), sigmaV: SIGMA_KQ1, N: 1 })
  const g2 = -(pQ1.Jn[1][0] * 2 + pQ1.Jn[1][1] * 0) // E[G] = −J_n δ（K_q = 1）
  // Q2：ρ = 0.9、μK_q = 0.5
  const lmin = 1 - 0.9
  const p2 = 1 - 0.5 * lmin
  const k2 = stepsToDecay(p2)
  const k2real = stepsToDecayReal(p2)
  // Q3：J = [[−1, 1.5], [1.5, −1]]、M = 0.2I
  const J3 = [
    [-1, 1.5],
    [1.5, -1],
  ]
  const eigJ3 = inspectMatrix(J3).eigSym!.values
  const plantJ = buildPlant({ mode: 'J', Jn: J3, sigmaV: SIGMA_KQ1, N: 1 })
  const an3 = analyzeRule(plantJ, { ...DEFAULT_RULE, rule: 'scalar', muKq: 0.2 }, J3)
  const poles3 = an3.poles.map((z) => z.re).sort((a, b) => b - a)
  // Q4：ρ = 0.9、γ = 0.5、N = 4096、σ_v = 100 fs
  const Kq = kqFromSigma(100)
  const c = 0.5 / (Kq * Kq * 4096 * 1.5)
  const Rinv = inv(corrMatrix(2, 0.9))
  const plant4 = buildPlant({ mode: 'R', R: corrMatrix(2, 0.9), sigmaV: 100, N: 4096 })
  const an4 = analyzeRule(plant4, { ...DEFAULT_RULE, rule: 'full', gamma: 0.5 }, plant4.Jn)
  return { g2, lmin, p2, k2, k2real, eigJ3, poles3, c, Rinv11: Rinv[0][0], modeVar: an4.modeVar!, perParam: an4.perParamVar! }
}

const Q = quizNumbers()

export function S6Wrapup() {
  return (
    <>
      <Section kind="assumptions" title="10.9 注意假設：哪些是精確、哪些是近似" level={2} id="ch10-assumptions">
        <ul>
          <li>
            <ClaimTag kind="exact" /> 在線性 Gaussian 模型 <Tex>{String.raw`\mathbf G=K_q\mathbf C\boldsymbol\delta+\boldsymbol\eta`}</Tex> 下：poles{' '}
            <Tex>{String.raw`=\operatorname{eig}(\mathbf I+\mathbf M\mathbf J)`}</Tex>、<Tex>{String.raw`k_{95}`}</Tex>、F-10.4 的 <Tex>{String.raw`1-\gamma`}</Tex>、F-10.6 / F-10.7 的變異、Lyapunov
            共變異、T18 的 1.2 / 0.4、F-10.10（<Tex>{String.raw`\hat{\mathbf J}=\mathbf J`}</Tex> 時）。這些都是<strong>平均（mean）遞迴</strong>或<strong>二階動差</strong>的結論，不是「每條軌跡」的保證。
          </li>
          <li>
            <ClaimTag kind="approx" /> 把真正的 1-bit Sign-LMS 當成線性模型：需 Gaussian comparator noise、block 內 iid、近平衡（有效性指標{' '}
            <Tex>{String.raw`E[\boldsymbol\delta^T\mathbf R\boldsymbol\delta]/\sigma_v^2\ll1`}</Tex>）、<Tex>{String.raw`\operatorname{Cov}(\boldsymbol\eta)\approx\mathbf R_x/N`}</Tex>。
            對 Gaussian regressor，方向 <Tex>{String.raw`\mathbf C\boldsymbol\delta`}</Tex> 精確、只有增益被壓縮（F-10.13）。
          </li>
          <li>
            <ClaimTag kind="approx" /> 中央差分 <Tex>{String.raw`\hat{\mathbf J}`}</Tex>：同時有 1-bit 截斷（F-10.14）與 <Tex>{String.raw`O(1/(\Delta\sqrt{N_J}))`}</Tex> 雜訊；近奇異{' '}
            <Tex>{String.raw`\mathbf J`}</Tex> 對 <Tex>{String.raw`\hat{\mathbf J}`}</Tex> 誤差極端敏感（勘誤 E24）。
          </li>
          <li>
            <ClaimTag kind="exact" /> 598 / 5 / 65 這些 block 數是 <strong>mean recursion</strong>（很多次實驗的平均誤差）的結果，而且以「一個 block 平均{' '}
            <Tex>{'N'}</Tex> 個 sample」為前提。本章的線性 block 模型裡雜訊是加成的（<Tex>{String.raw`-\mathbf M\boldsymbol\eta_k`}</Tex>），所以均方（mean-square）穩定條件與平均穩定條件相同（
            <Tex>{String.raw`\rho(\mathbf A_{\mathrm{cal}})<1`}</Tex>），代價只反映在穩態共變異 F-10.15。若改成每個 sample 都更新（<Tex>{'N=1'}</Tex>）的 conventional 多位元 LMS，regressor
            本身的隨機性會變成乘性雜訊，<Tex>{String.raw`\mu=0.5`}</Tex> 在 mean-square 意義下會發散——那是第 9 章的內容
            <Erratum id="E23" title="docs/validation.md 勘誤 E23：598 是 mean recursion；per-sample Gaussian regressor 的 mean-square 可能發散（第 9 章）" />。
          </li>
          <li>
            <ClaimTag kind="research" /> 本章是<strong>靜態</strong> plant：沒有 PLL 迴路動態、update latency（第 8 章）、定點量化（第 13 章）、PVT 漂移下的 gain scheduling。
            這些疊加後的最佳更新矩陣是 Roadmap R4 的研究題目。
          </li>
          <li>
            「<Tex>{'K_q'}</Tex> 正規化為 1」的例子（598 / 5 / 65）必須換回實體單位才可用於設計：<Tex>{String.raw`\mu`}</Tex> 的單位是 fs、<Tex>{'K_q'}</Tex> 是{' '}
            <Tex>{String.raw`\mathrm{fs}^{-1}`}</Tex>，<Tex>{String.raw`\mathbf M=\mathbf M_n/K_q`}</Tex>
            <Erratum id="E05" />
            <Erratum id="E08" />。
          </li>
        </ul>
      </Section>

      <Section kind="example" title="綜合手算：把整章的公式串起來" id="ch10-synthesis">
        <p>
          進入思考題之前，用一題把本章的主線走一遍：同一個 <Tex>{String.raw`\mathbf R`}</Tex>、同一個慢模式，三種更新矩陣（一般 LMS／完整反矩陣／regularized）各算一次 pole（F-10.3、F-10.4、F-10.8）、
          <Tex>{'k_{95}'}</Tex>（F-10.5）與穩態變異（F-10.6、F-10.7）。你會親手得到 §10.3.1 的 598／5／65，以及 §10.4 表格裡的三個慢模式變異。
        </p>
        <Fig id="handcalc-flow">
          先做最上面三格（三種更新矩陣共用）：<Tex>{String.raw`\lambda_{\min}`}</Tex>、<Tex>{'K_q'}</Tex>、<Tex>{String.raw`K_q^2N`}</Tex>。再從藍色那一格開始，每種更新矩陣各走一次：選{' '}
          <Tex>{'m'}</Tex> → <Tex>{String.raw`p=1-m\lambda_{\min}`}</Tex> → 左邊一路算 <Tex>{'k_{95}'}</Tex>，右邊一路先算 <Tex>{String.raw`1-p^2`}</Tex> 再算變異。圖上每一格就是 HC-10.8 展開後的一步；<Tex>{'m'}</Tex>{' '}
          的三種寫法分別來自 F-10.3、F-10.4、F-10.8，變異那一格是 F-10.7，其中 <Tex>{String.raw`\xi_{\text{slow}}`}</Tex> 是誤差沿慢 eigenvector 的分量（模式座標，不是單一參數）。
        </Fig>
        <Hand id="HC-10.8">
          建議先在紙上畫一張 3×4 的表（列：三種更新矩陣；欄：<Tex>{'m'}</Tex>、<Tex>{'p'}</Tex>、<Tex>{'k_{95}'}</Tex>、<Tex>{String.raw`\operatorname{Var}`}</Tex>），用預設數字填滿後切到「自己算算看」對答案；再把{' '}
          <Tex>{String.raw`\rho`}</Tex> 換成 0.9、<Tex>{String.raw`\lambda_{\mathrm{reg}}`}</Tex> 換成 0.05 重算一次，看速度與雜訊怎麼互換。
        </Hand>
      </Section>

      <Section kind="example" title="10.10 思考題">
        <Quiz
          title="思考題 1：耦合"
          question={
            <>
              <Tex>{'K_q'}</Tex> 正規化為 1，<Tex>{String.raw`\mathbf R=\begin{bmatrix}1&0.5\\0.5&1\end{bmatrix}`}</Tex>，<Tex>{String.raw`\boldsymbol\delta=(2,\ 0)\ \mathrm{fs}`}</Tex>（
              <Tex>{'w_2'}</Tex> 是對的）。GMAC<sub>2</sub> 的平均輸出 <Tex>{String.raw`E[G_2]`}</Tex> 是多少？
            </>
          }
          options={[
            {
              label: (
                <>
                  0（<Tex>{'w_2'}</Tex> 是對的）
                </>
              ),
            },
            { label: '0.5' },
            { label: '1', correct: true },
            { label: '2' },
          ]}
          answer={
            <>
              <TexBlock>{String.raw`E[G_2]\approx K_q(R_{21}\delta_1+R_{22}\delta_2)=1\times(0.5\times2+1\times0)=${tn(Q.g2)}`}</TexBlock>
              <p>
                <Tex>{'w_2'}</Tex> 正確，但 <Tex>{String.raw`R_{21}=0.5\ne0`}</Tex>，<Tex>{String.raw`\delta_1`}</Tex> 經由耦合漏進 <Tex>{'G_2'}</Tex>。scalar LMS 會把 <Tex>{'w_2'}</Tex>{' '}
                往錯的方向推（<Tex>{String.raw`\delta_2`}</Tex> 變負），之後再被拉回來。
              </p>
            </>
          }
        />
        <Quiz
          title="思考題 2：慢模式"
          question={
            <>
              <Tex>{String.raw`\rho=0.9`}</Tex>、<Tex>{'K_q'}</Tex> 正規化為 1、一般 LMS <Tex>{String.raw`\mu K_q=0.5`}</Tex>。95% 衰減需要幾個 block？若改用{' '}
              <Tex>{String.raw`\mathbf M=0.5(K_q\mathbf R)^{-1}`}</Tex> 呢？
            </>
          }
          answer={
            <StepDerivation
              steps={[
                {
                  tex: String.raw`\lambda_{\min}=1-\rho=${tn(Q.lmin, 3)}`,
                  why: (
                    <>
                      2×2 相關矩陣的 eigenvalue 是 <Tex>{String.raw`1\pm\rho`}</Tex>。
                    </>
                  ),
                },
                { tex: String.raw`p_{\min}=1-0.5\times${tn(Q.lmin, 3)}=${tn(Q.p2, 4)}`, why: 'F-10.3。' },
                { tex: String.raw`k_{95}=\lceil\ln0.05/\ln${tn(Q.p2, 4)}\rceil=\lceil${tn(Q.k2real, 4)}\rceil=${Q.k2}`, why: 'F-10.5。' },
                {
                  tex: String.raw`\text{完整反矩陣：}p=0.5\Rightarrow k_{95}=5`,
                  why: (
                    <>
                      與 <Tex>{String.raw`\rho`}</Tex> 無關（只要 <Tex>{String.raw`\rho<1`}</Tex>）。
                    </>
                  ),
                },
              ]}
            />
          }
        />
        <Quiz
          title="思考題 3：每個 loop 都穩定嗎？"
          question={
            <>
              <Tex>{String.raw`\mathbf J=\begin{bmatrix}-1&1.5\\1.5&-1\end{bmatrix}`}</Tex>（<Tex>{'K_q'}</Tex> 正規化為 1），<Tex>{String.raw`\mathbf M=0.2\mathbf I`}</Tex>。一起更新時迴路如何？
            </>
          }
          options={[
            { label: '穩定：兩個單一 loop 的 pole 都是 0.8' },
            { label: '發散：有一個 pole 大於 1', correct: true },
            { label: '臨界：pole 剛好等於 1' },
            {
              label: (
                <>
                  把 <Tex>{String.raw`\mu`}</Tex> 降到 0.01 就會穩定
                </>
              ),
            },
          ]}
          answer={
            <>
              <TexBlock>{String.raw`\operatorname{eig}(\mathbf J)=-1\pm1.5=\{${tn(Q.eigJ3[0])},\ ${tn(Q.eigJ3[1])}\}\ \Rightarrow\ \operatorname{eig}(\mathbf I+0.2\mathbf J)=\{${tn(Q.poles3[0])},\ ${tn(Q.poles3[1])}\}`}</TexBlock>
              <p>
                共模方向 <Tex>{String.raw`[1,1]^T/\sqrt2`}</Tex> 的斜率是 <Tex>{String.raw`+${tn(Q.eigJ3[0])}`}</Tex>（錯誤極性），所以任何 <Tex>{String.raw`\mu>0`}</Tex> 都發散（
                <Tex>{String.raw`p=1+${tn(Q.eigJ3[0])}\mu`}</Tex>）；降低 <Tex>{String.raw`\mu`}</Tex> 只會讓它發散得慢一點。要用 <Tex>{String.raw`-\gamma\mathbf J^{-1}`}</Tex> 或 regularized pinv
                修正極性——與 T18 同一類問題。
              </p>
            </>
          }
        />
        <Quiz
          title="思考題 4：模式變異 vs 參數變異（勘誤 E37）"
          question={
            <>
              <Tex>{String.raw`\rho=0.9,\ \gamma=0.5,\ N=4096,\ \sigma_v=100\ \mathrm{fs}`}</Tex>，完整 preconditioner。慢模式的 <Tex>{String.raw`\operatorname{Var}(\xi_{\min})`}</Tex> 與每個參數的{' '}
              <Tex>{String.raw`\operatorname{Var}(\delta_j)`}</Tex> 各是多少 <Tex>{String.raw`\mathrm{fs}^2`}</Tex>？
            </>
          }
          answer={
            <>
              <TexBlock>{String.raw`c=\frac{\gamma}{K_q^2N(2-\gamma)}=${tn(Q.c, 5)}\ \mathrm{fs}^2,\quad \operatorname{Var}(\xi_{\min})=\frac{c}{0.1}=${tn(Q.modeVar[1], 5)}\ \mathrm{fs}^2,\quad \operatorname{Var}(\delta_j)=c\,[\mathbf R^{-1}]_{jj}=c\times${tn(Q.Rinv11, 5)}=${tn(Q.perParam[0], 5)}\ \mathrm{fs}^2`}</TexBlock>
              <p>
                <Tex>{String.raw`[\mathbf R^{-1}]_{11}=1/(1-\rho^2)=${tn(Q.Rinv11, 4)}`}</Tex>。每個參數的變異是兩個模式變異的平均（<Tex>{String.raw`\mathbf V`}</Tex> 的元素都是{' '}
                <Tex>{String.raw`\pm1/\sqrt2`}</Tex>，各佔一半），不等於慢模式本身。快模式 <Tex>{String.raw`\operatorname{Var}(\xi_{\max})=c/1.9=${tn(Q.modeVar[0], 4)}\ \mathrm{fs}^2`}</Tex>。
              </p>
            </>
          }
        />
      </Section>

      <Recap
        title="這一課最重要的公式"
        formulas={[
          {
            label: (
              <>
                GMAC 耦合（<Tex>{String.raw`\boldsymbol\delta=\mathbf a-\mathbf w`}</Tex>）
              </>
            ),
            tex: String.raw`E[\mathbf G_k]\approx K_q\mathbf R\boldsymbol\delta_k,\quad G_i\approx K_q\textstyle\sum_jR_{ij}\delta_j`,
          },
          { label: '誤差遞迴與迴路矩陣', tex: String.raw`\boldsymbol\delta_{k+1}=(\mathbf I+\mathbf M\mathbf J)\boldsymbol\delta_k-\mathbf M\boldsymbol\eta_k,\quad\mathbf J=-K_q\mathbf R` },
          { label: 'Scalar vs 完整反矩陣', tex: String.raw`\mathbf M=\mu\mathbf I:\ p_i=1-\mu K_q\lambda_i;\qquad\mathbf M=\gamma(K_q\mathbf R)^{-1}:\ p_i=1-\gamma` },
          {
            label: (
              <>
                雜訊代價（模式座標 <Tex>{String.raw`\boldsymbol\xi=\mathbf V^T\boldsymbol\delta`}</Tex>）
              </>
            ),
            tex: String.raw`\operatorname{Var}(\xi_i)=\frac{\gamma}{K_q^2N\lambda_i(2-\gamma)},\quad\operatorname{Cov}(\boldsymbol\delta)=\frac{\gamma}{K_q^2N(2-\gamma)}\mathbf R^{-1}`,
          },
          {
            label: (
              <>
                Regularized（<Tex>{String.raw`\hat{\mathbf J}=\mathbf J`}</Tex> 時）
              </>
            ),
            tex: String.raw`p_i=1-\gamma\frac{\lambda_i}{\lambda_i+\lambda_{\mathrm{reg}}}\ (\mathbf R\text{ 形式}),\qquad p_i=1-\gamma\frac{\sigma_i^2}{\sigma_i^2+\lambda_{\mathrm{reg}}}\ (\mathbf J\text{ 形式})`,
          },
        ]}
        points={[
          <>
            每個 GMAC 都看到「所有」參數的誤差（經 <Tex>{String.raw`R_{ij}`}</Tex>）：<Tex>{'w_i'}</Tex> 正確不代表 <Tex>{'G_i=0'}</Tex>。
          </>,
          <>
            收斂速度被 <Tex>{String.raw`\lambda_{\min}`}</Tex> 卡住（<Tex>{String.raw`\kappa=\lambda_{\max}/\lambda_{\min}`}</Tex>）；NLMS 與 diagonal 正規化都不會修正相關性。
          </>,
          <>
            完整反矩陣讓所有 <Tex>{String.raw`p_i=1-\gamma`}</Tex>，但沿慢方向把雜訊放大 <Tex>{String.raw`1/\lambda_{\min}`}</Tex>；<Tex>{String.raw`\lambda_{\min}=0`}</Tex>{' '}
            時不可辨識，preconditioner 不能製造缺失的資訊。
          </>,
          <>
            <Tex>{String.raw`\lambda_{\mathrm{reg}}`}</Tex> 在速度與雜訊之間取捨，並提供對 <Tex>{String.raw`\hat{\mathbf J}`}</Tex> 誤差的 robustness；poles 一律用{' '}
            <Tex>{String.raw`\operatorname{eig}(\mathbf I+\mathbf M(\hat{\mathbf J})\mathbf J_{\text{true}})`}</Tex> 計算（勘誤 E24）。
          </>,
          <>每個 loop 單獨穩定，不代表 MIMO 一起穩定（T18）；sequential calibration 會把不可辨識的誤差全部歸給先校的參數，而且不會讓慢模式變快。</>,
        ]}
      />

      <Section kind="diagram" title="10.11 連結到 PLL：這些數學在晶片裡是什麼" level={2} id="ch10-pll">
        <p>
          最後把本章的數學放回硬體。和章首的系統地圖相比，多出來的只有兩樣東西：GMAC 從一個變成 <Tex>{'P'}</Tex> 個，以及 GMAC 與係數暫存器之間的混合矩陣。
        </p>
        <Fig id="hw-map">
          先沿實線走：comparator 的 <Tex>{'q[n]'}</Tex> 同時送進每個參數自己的 GMAC accumulator；<Tex>{'P'}</Tex> 個 GMAC 輸出進到藍色的混合矩陣（scalar／diagonal 時它退化成 <Tex>{'P'}</Tex> 個 shift），再累加到係數暫存器，最後回到
          DTC／PMUX 的補償，經 PLL 的 error path 回到 comparator。再看虛線：韌體或測試機偶爾凍結係數、加上 <Tex>{String.raw`\pm\Delta`}</Tex> 量 <Tex>{String.raw`\hat{\mathbf J}`}</Tex>，算好之後把{' '}
          <Tex>{String.raw`\mathbf M`}</Tex>、<Tex>{String.raw`\gamma`}</Tex>、<Tex>{String.raw`\lambda_{\mathrm{reg}}`}</Tex> 寫進暫存器。圖上的混合矩陣就是公式裡的 <Tex>{String.raw`\mathbf M`}</Tex>，GMAC accumulator 就是{' '}
          <Tex>{String.raw`G_i=\tfrac1N\sum q\,x_i`}</Tex>，係數暫存器就是 <Tex>{String.raw`\mathbf w`}</Tex>；每個方塊對應下表的一列。
        </Fig>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>數學</th>
                <th>硬體 / 韌體</th>
                <th>設計注意</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <Tex>{String.raw`G_i=\frac1N\sum q\,x_i`}</Tex>
                </td>
                <td>每個校正參數一個 GMAC accumulator（conditional negate + 累加），全部共用同一個 BBPD/comparator 的 q</td>
                <td>
                  sum vs average 的 <Tex>{'N'}</Tex> 倍差異（第 5 章、勘誤 E18）會直接乘進 <Tex>{String.raw`\mathbf M`}</Tex>
                </td>
              </tr>
              <tr>
                <td>
                  <Tex>{String.raw`\mathbf R,\ \mathbf C`}</Tex>
                </td>
                <td>DSM residue、PHOS one-hot、DTC gain code 經 PLL error path 後的統計</td>
                <td>
                  隨 FCW、PVT 改變；<Tex>{String.raw`H_{\mathrm{PD}}(1)=0`}</Tex> 時 common-mode 不可觀察（第 9 章、勘誤 E04）
                </td>
              </tr>
              <tr>
                <td>
                  <Tex>{String.raw`\mathbf M`}</Tex>
                </td>
                <td>
                  GMAC 之後的 <Tex>{String.raw`P\times P`}</Tex> 混合矩陣（<Tex>{'P^2'}</Tex> 個乘加）或 LUT；scalar/diagonal 只要 shift
                </td>
                <td>
                  元素可達數千 fs / 單位 <Tex>{'G'}</Tex>（§10.3.1：約 {n(NUM.phys.Mphys[0][0], 3)} fs）：位寬、定點量化與 rounding 會改變 poles
                </td>
              </tr>
              <tr>
                <td>
                  <Tex>{String.raw`\hat{\mathbf J}`}</Tex>
                </td>
                <td>
                  量產測試或背景 FSM：freeze → <Tex>{String.raw`\pm\Delta`}</Tex> → 各跑 <Tex>{'N_J'}</Tex> 個 sample
                </td>
                <td>
                  <Tex>{String.raw`\Delta\approx0.3\sigma_v`}</Tex>（±1 碼截斷 −1.5%）；<Tex>{String.raw`\rho\to1`}</Tex> 時需要非常大的 <Tex>{'N_J'}</Tex>
                </td>
              </tr>
              <tr>
                <td>
                  <Tex>{String.raw`\lambda_{\mathrm{reg}},\ \gamma`}</Tex>
                </td>
                <td>韌體暫存器</td>
                <td>
                  <Tex>{String.raw`\lambda_{\mathrm{reg}}`}</Tex> 同時處理雜訊與 <Tex>{String.raw`\hat{\mathbf J}`}</Tex> 誤差；<Tex>{String.raw`K_q\propto1/\sigma_v`}</Tex> 隨 PVT 漂移 ⇒ 實際{' '}
                  <Tex>{String.raw`\gamma`}</Tex> 也漂移
                </td>
              </tr>
              <tr>
                <td>Sequential</td>
                <td>Calibration state machine 的分階段（GOS → PHOS → gain）</td>
                <td>先校者吸收不可辨識誤差；換 FCW 後錯誤分配現形</td>
              </tr>
            </tbody>
          </table>
        </div>
        <Callout kind="info" title="下一個值得研究的問題">
          <p>
            在 PLL 動態、update latency、定點 <Tex>{String.raw`\mathbf M`}</Tex> 與 PVT 漂移同時存在時，如何同時最佳化收斂時間、穩態共變異與乘法器數量？這是{' '}
            <Link to="/roadmap">Research Backlog R4（多參數最佳更新矩陣）</Link>。下一章（第 11 章）處理另一個問題：GMAC 歸零的點 <Tex>{String.raw`\mathbf w^*`}</Tex> 本身就可能不等於{' '}
            <Tex>{String.raw`\mathbf a`}</Tex>（bias / INL）。
          </p>
        </Callout>
      </Section>
    </>
  )
}
