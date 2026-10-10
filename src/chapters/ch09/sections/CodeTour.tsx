import { CodeBlock, CodeCompare, ModeGate, Section } from '@/components'
import peSrc from '@/simulation/models/pe.ts?raw'
import mimoPy from '../../../../golden/lms_pll_golden/mimo.py?raw'
import { pyFunction } from '../pyExcerpt'
import { Erratum, m } from '../shared'

const PATH = 'src/simulation/models/pe.ts'
const PY_PATH = 'golden/lms_pll_golden/mimo.py'

/** 核心程式碼導覽：頁面顯示的就是網站實際執行的程式碼（#region core:*）。 */
export function CodeTour() {
  return (
    <Section kind="example" title="核心程式碼：網站實際執行的版本" level={2} id="ch09-code">
      <p>
        下面每一段都直接從 <code>{PATH}</code> 擷取（<code>?raw</code> + <code>#region core:*</code>），不是另外手寫的示意版。
        比較不同演算法時，關鍵差異行以 <code>// ← 差異：…</code> 標出並高亮。
      </p>

      <h3>1. Eigen 分解：{m`2\times2`} 閉式解 vs. 一般 {m`M\times M`}</h3>
      <p>
        左邊直接解 {m`\det(\mathbf R-\lambda\mathbf I)=0`} 的二次方程式 {m`\lambda=\tfrac{a+d}2\pm\sqrt{(\tfrac{a-d}2)^2+b^2}`}；右邊用 Jacobi 迭代處理任意
        {m`M\times M`}，再算 {m`p_i=1-g\lambda_i`}、{m`k_{95}`}、{m`\kappa`} 與零 eigenvalue 個數。兩者在實驗室裡互相驗算（{m`|\Delta\lambda|<10^{-12}`}）。
      </p>
      <CodeCompare
        items={[
          { label: String.raw`$2\times2$ 閉式解 eig2x2`, source: peSrc, region: 'eig2x2', path: PATH, note: '二次方程式 + 旋轉角；滑動窗口每個窗口都用它（$O(1)$）。' },
          { label: String.raw`一般 $M\times M$ eigenModes`, source: peSrc, region: 'eigenModes', path: PATH, note: String.raw`Jacobi eigSym；同時算 pole、$k_{95}$、$\kappa$、null 方向數。實驗室用兩者互相驗算。` },
        ]}
      />
      <CodeBlock source={peSrc} region="stepsToDecay" path={PATH} caption="598 的來源（F-09.6）；兩個邊界情況要特別處理。" />
      <p>
        {m`k_{95}=\lceil\ln0.05/\ln|p|\rceil`}；{m`p=0`} 時一步歸零（回傳 1），{m`|p|\ge1`} 時永遠不衰減（回傳 {m`\infty`}）。
      </p>

      <h3>
        2. Mean recursion vs. mean-square recursion（<Erratum id="E23" />）
      </h3>
      <CodeCompare
        items={[
          { label: String.raw`Mean：$E[\boldsymbol\delta]$`, source: peSrc, region: 'meanRecursion', path: PATH, note: String.raw`一次矩：只需要 $\mathbf R$。` },
          { label: String.raw`Mean-square：$E[\boldsymbol\delta\boldsymbol\delta^T]$`, source: peSrc, region: 'meanSquareMap', path: PATH, note: String.raw`二次矩：linear detector 需要四階動差 $\mathcal K(\mathbf P)$（Gaussian 與 $\pm1$ code 不同）；1-bit 因 $q^2\equiv1$ 沒有這一項（F-09.18）。` },
        ]}
      />

      <h3>3. Regressor：Gaussian vs. {m`\pm1`} sparse-flip</h3>
      <p>
        Gaussian：{m`u_2=\rho u_1+\sqrt{1-\rho^2}\,z_2`}，每個 sample 都帶一點差模能量；{m`\pm1`}：{m`u_2=s\,u_1`}，差模只在 flip（{m`s=-1`}，機率
        {m`(1-\rho)/2`}）時出現。兩者的 {m`\mathbf R=\begin{bmatrix}1&\rho\\\rho&1\end{bmatrix}`} 完全相同，所以 mean recursion 完全相同；四階動差不同，所以
        mean-square 與個別軌跡不同。
      </p>
      <CodeCompare
        items={[
          { label: String.raw`Gaussian（$\rho$）`, source: peSrc, region: 'regressorGaussian', path: PATH, note: '連續值：每個 sample 都帶一點差模能量。' },
          { label: String.raw`$\pm1$ sparse-flip（$\rho$）`, source: peSrc, region: 'regressorPm1', path: PATH, note: '差模只在 flip 的 sample 出現。' },
        ]}
      />

      <h3>4. GMAC 乘數：linear（conventional）vs. 1-bit（sign）</h3>
      <p>
        linear：{m`t=e\ \Rightarrow\ E[\mathbf G\mid\boldsymbol\delta]=\mathbf R\boldsymbol\delta`}（{m`K_q\equiv1`}）；1-bit：{m`t=\mathrm{sign}(e)\ \Rightarrow`}
        {m`E[\mathbf G\mid\boldsymbol\delta]\approx K_q\mathbf R\boldsymbol\delta`}，{m`K_q=\sqrt{2/\pi}/\sigma_v`}（<Erratum id="E05" />）。
      </p>
      <CodeCompare
        items={[
          { label: 'Linear：$t=e$', source: peSrc, region: 'gmacLinear', path: PATH, note: '保留誤差大小（多位元）。' },
          { label: String.raw`1-bit：$t=\mathrm{sign}(e)$`, source: peSrc, region: 'gmacSign', path: PATH, note: '只剩正負號（comparator）。' },
        ]}
      />
      <CodeBlock
        source={peSrc}
        region="peBlockLms"
        path={PATH}
        caption={'實驗室的 Monte Carlo：每條 chain 用 rng.fork(`u-\\${c}`) / fork(`v-\\${c}`)，所以改變 chains 數不影響既有 chain（同 seed 可重現）。'}
      />
      <ModeGate min="research">
        <CodeBlock source={peSrc} region="bussgangMeanG" path={PATH} caption="1-bit 的精確條件平均（Bussgang）：實驗室在 sign detector 模式用它當 mean-field 參考線。" />
      </ModeGate>

      <h3>5. §9.1 滑動窗口 PE 統計</h3>
      <CodeBlock source={peSrc} region="slidingWindowPe" path={PATH} caption={String.raw`prefix sum 讓每個窗口 $O(1)$；$\pm1$ code 的和是整數，退化窗口精確退化。`} />
      <p>
        {m`\mathbf R_k`} 的三個元素都是 prefix sum 的差，每個窗口 {m`O(1)`}；{m`\pm1`} code 的和是整數，退化窗口的 {m`\lambda_{\min}(\mathbf R_k)`} 精確為 0
        （沒有浮點殘差）。{m`\sigma_i(\mathbf U_k)=\sqrt{N_0\lambda_i(\mathbf R_k)}`}（F-09.10）。
      </p>

      <h3>6. §9.2 Gauge：raw-x vs. u-domain regressor</h3>
      <p>
        raw-x：{m`\mathbf u=\tilde{\mathbf x}`}，常數 1 原封不動，{m`b`} 的 regressor 有能量；u-domain：{m`\tilde{\mathbf u}=h*\tilde{\mathbf x}`}，
        {m`H_{\mathrm{PD}}(1)=0`} 把常數 1 濾成 0，{m`\sum_i\tilde u_i`} 也 {m`\to0`}（<Erratum id="E04" />）。
      </p>
      <CodeCompare
        items={[
          { label: String.raw`raw-x：$\mathbf u=\tilde{\mathbf x}$`, source: peSrc, region: 'gaugeRegressorsRaw', path: PATH, note: '不經濾波。' },
          { label: String.raw`u-domain：$\tilde{\mathbf u}=h*\tilde{\mathbf x}$`, source: peSrc, region: 'gaugeRegressorsPd', path: PATH, note: String.raw`每一欄經同一個有狀態的 $H_{\mathrm{PD}}$。` },
        ]}
      />
      <CodeBlock
        source={peSrc}
        region="gaugeLms"
        path={PATH}
        caption={String.raw`u-domain 的誤差先經有狀態的 $H_{\mathrm{PD}}$ 濾波器（主 PLL 不在每個 block 重置）；GMAC regressor 可選 raw $\tilde{\mathbf x}$ 或 filtered $\tilde{\mathbf u}$。`}
      />
      <ModeGate min="engineer">
        <p>
          u-domain 用 raw {m`\tilde{\mathbf x}`} 當 GMAC regressor 時，{m`w_b`} 只被雜訊推動。每個 block 的平均雜訊 {m`\eta_k`} 的標準差是 {m`\sigma_v/\sqrt N`}，
          {m`K`} 個 block 的 random walk 累積 {m`\mu\sigma_v\sqrt{K/N}`}；type-I 迴路的 step response 總和 {m`S=\sum_ns[n]=1/(1-r)\ne0`}，
          會把每一步「回吐」一部分（阻尼 {m`1/(1+\tfrac54\mu S/N)`}，F-09.19），type-II 的 {m`S=0`} 則沒有這個效應。兩者都<strong>沒有恢復力</strong>。
        </p>
        <CodeBlock source={peSrc} region="gaugeDriftStd" path={PATH} caption="實驗室顯示的 random-walk 預測（近似；與多個 seed 的 Monte Carlo 在測試中比對）。" />
      </ModeGate>

      <h3>程式層級的比較</h3>
      <div className="table-wrap">
        <table className="ch09-table">
          <thead>
            <tr>
              <th className="ch09-left">比較</th>
              <th className="ch09-left">差異行</th>
              <th className="ch09-left">平均行為</th>
              <th className="ch09-left">二階／個別軌跡</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="ch09-left">Gaussian vs. {m`\pm1`}</td>
              <td className="ch09-left">{m`u_2`} 的產生方式</td>
              <td className="ch09-left">相同（同一個 {m`\mathbf R`}）</td>
              <td className="ch09-left">
                {m`N=1`}、{m`g=0.5`}（linear）：Gaussian {m`\rho_{\mathrm{MS}}=1.98`}（發散），{m`\pm1`} 為 0.995（階梯）
              </td>
            </tr>
            <tr>
              <td className="ch09-left">linear vs. 1-bit</td>
              <td className="ch09-left">{m`t=e`} vs. {m`t=\mathrm{sign}(e)`}</td>
              <td className="ch09-left">
                方向同為 {m`\mathbf R\boldsymbol\delta`}；增益 1 vs. {m`K_q`}（小訊號）
              </td>
              <td className="ch09-left">
                linear 有四階動差項（可乘法式發散）；1-bit 因 {m`q^2\equiv1`} 沒有，只剩 {m`\mu^2\mathbf R/N`} 的雜訊注入（F-09.18）
              </td>
            </tr>
            <tr>
              <td className="ch09-left">raw-x vs. u-domain</td>
              <td className="ch09-left">是否經 {m`H_{\mathrm{PD}}`} 濾波</td>
              <td className="ch09-left">null space 1 維 vs. 2 維</td>
              <td className="ch09-left">raw GMAC 時 {m`w_b`} 與 {m`a_i`} 共模 random walk</td>
            </tr>
          </tbody>
        </table>
      </div>

      <ModeGate min="research">
        <h3>Python golden model 對照（TypeScript vs. NumPy）</h3>
        <p>
          獨立的 NumPy 版本（<code>{PY_PATH}</code>）產生 T10 / T11 的 golden vectors；Vitest 讀這些 JSON 與上面的 TypeScript 交叉比對。
          下面逐一並排「同一件事的兩種寫法」（Python 段落以函式名稱從原始檔擷取）。注意 golden 的 {m`\mathbf I-\mu\mathbf R`} 沒有 {m`K_q`}：它驗的是
          {m`K_q=1`} 的正規化情形（<Erratum id="E05" />）。
        </p>
        <CodeCompare
          items={[
            { label: 'TS：stepsToDecay', source: peSrc, region: 'stepsToDecay', path: PATH, note: String.raw`$|p|\ge1$ 回傳 $\infty$、$p=0$ 回傳 1（給 UI 用，不丟例外）。` },
            { label: 'Python：steps_to_decay', source: pyFunction(mimoPy, 'steps_to_decay'), lang: 'python', path: PY_PATH, note: String.raw`同一個 $\lceil\ln f/\ln|p|\rceil$；不合法的 $p$ 直接丟 ValueError。` },
          ]}
        />
        <CodeCompare
          items={[
            { label: 'TS：meanTrajectory', source: peSrc, region: 'meanRecursion', path: PATH, note: String.raw`$\mathbf A=\mathbf I-g\mathbf R$，$g=\mu K_q$（$K_q$ 明寫）。` },
            { label: 'Python：simulate_mean_lms', source: pyFunction(mimoPy, 'simulate_mean_lms'), lang: 'python', path: PY_PATH, note: String.raw`$\mathbf A=\mathbf I-\mu\mathbf R$（$K_q\equiv1$ 的正規化）。` },
          ]}
        />
        <CodeCompare
          items={[
            { label: 'TS：slidingWindowPe', source: peSrc, region: 'slidingWindowPe', path: PATH, note: 'prefix sum：所有窗口一次算完，每個窗口 $O(1)$。' },
            { label: 'Python：windowed_pe', source: pyFunction(mimoPy, 'windowed_pe'), lang: 'python', path: PY_PATH, note: String.raw`單一窗口直接算 $\mathbf U^T\mathbf U/N_0$（$O(N_0)$），當作對照的定義式。` },
          ]}
        />
        <CodeCompare
          items={[
            { label: 'TS：gaugeRegressorsRaw', source: peSrc, region: 'gaugeRegressorsRaw', path: PATH, note: String.raw`依 phase 序列產生每個 sample 的 $\tilde{\mathbf x}[n]$。` },
            { label: 'Python：onehot_with_global_regressors', source: pyFunction(mimoPy, 'onehot_with_global_regressors'), lang: 'python', path: PY_PATH, note: String.raw`列出 $P$ 種可能的 $\tilde{\mathbf x}$（每相一列），用來求 null space。` },
          ]}
        />
        <CodeBlock source={pyFunction(mimoPy, 'eig_sorted')} lang="python" path={PY_PATH} title="eig_sorted（golden 的 eigenvector 正負號約定）" caption="eigenvalue 由大到小；每個 eigenvector 的第一個非零分量取正——eig2x2 的 signNormalize 採同一約定，才能逐元素比對。" />
      </ModeGate>
    </Section>
  )
}
