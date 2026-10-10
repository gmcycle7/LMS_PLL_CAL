import { Callout, ClaimTag, Mermaid, ModelLevel, Prereq, Section, SourceTag, SymbolTable, Tex, TexBlock, TestBadge, mathText, type SymbolEntry } from '@/components'
import { Erratum, TagRow, tn } from '../common'
import { NUM } from '../numbers'

const SYMBOLS: SymbolEntry[] = [
  { symbol: String.raw`\mathbf w_k=(w_1,\dots,w_P)^T`, meaning: mathText('第 $k$ 個 GMAC block 使用的 $P$ 個校正係數（例如 GOS、PHOS、DTC gain）'), unit: String.raw`\mathrm{fs}`, firstSeen: '10.1' },
  { symbol: String.raw`\mathbf a`, meaning: '真實（理想）參數向量', unit: String.raw`\mathrm{fs}`, firstSeen: '10.1' },
  {
    symbol: String.raw`\boldsymbol\delta_k=\mathbf a-\mathbf w_k`,
    meaning: '參數誤差向量（每個分量 = 一個參數還差多少）',
    unit: String.raw`\mathrm{fs}`,
    firstSeen: '10.1',
    note: (
      <>
        全站約定（規格 §0）；<Tex>{String.raw`\delta_i>0\Rightarrow w_i`}</Tex> 太小
      </>
    ),
  },
  { symbol: String.raw`u_i[n]`, meaning: mathText('第 $i$ 個參數的有效 regressor（它的誤差經 PLL 路徑到 comparator 前的「權重」）'), unit: String.raw`1`, firstSeen: '10.1', note: '已正規化（unit RMS）' },
  {
    symbol: String.raw`x_i[n]`,
    meaning: (
      <>
        第 i 個 GMAC 拿來做相關的 code；理想匹配時 <Tex>{String.raw`\mathbf x=\mathbf u`}</Tex>
      </>
    ),
    unit: String.raw`1`,
    firstSeen: '10.5',
  },
  { symbol: String.raw`e[n]=\mathbf u^T[n]\boldsymbol\delta_k+v[n]`, meaning: 'comparator 前的總誤差：所有參數的誤差加在一起，再加雜訊', unit: String.raw`\mathrm{fs}`, firstSeen: '10.1' },
  {
    symbol: String.raw`v[n],\ \sigma_v`,
    meaning: (
      <>
        comparator 前的雜訊與它的 RMS（<Tex>{String.raw`v\sim\mathcal N(0,\sigma_v^2)`}</Tex>，與 regressor 獨立）
      </>
    ),
    unit: String.raw`\mathrm{fs}`,
    firstSeen: '10.1',
    note: (
      <>
        <Tex>{String.raw`\sigma_v`}</Tex>（下標 v）是雜訊 RMS；<Tex>{String.raw`\sigma_i`}</Tex>（下標 i）是 singular value，兩者無關
      </>
    ),
  },
  { symbol: String.raw`q[n]=\operatorname{sign}(e[n])`, meaning: '1-bit comparator 輸出（雙極性）', unit: String.raw`\pm1`, firstSeen: '10.1' },
  { symbol: String.raw`\mathbf G_k=\frac1N\sum_n q[n]\,\mathbf x[n]`, meaning: mathText('$P$ 個 GMAC 的輸出向量（average 模式）；全部共用同一個 $q$'), unit: String.raw`1`, firstSeen: '10.1' },
  {
    symbol: String.raw`K_q=\sqrt{2/\pi}/\sigma_v`,
    meaning: '1-bit comparator 的小訊號增益（第 5 章）',
    unit: String.raw`\mathrm{fs}^{-1}`,
    firstSeen: '10.1',
    note: (
      <>
        例子若寫「<Tex>{'K_q'}</Tex> 正規化為 1」，代表 <Tex>{String.raw`\mu`}</Tex> 其實是 <Tex>{String.raw`\mu K_q`}</Tex>
        <Erratum id="E05" />
        <Erratum id="E08" />
      </>
    ),
  },
  { symbol: String.raw`\mathbf R=E[\mathbf u\mathbf u^T]`, meaning: 'regressor 自相關矩陣：對角 = 各自功率，非對角 = 互相關', unit: String.raw`1`, firstSeen: '10.2' },
  {
    symbol: String.raw`\rho`,
    meaning: (
      <>
        兩個 regressor 的相關係數：<Tex>{String.raw`\rho=R_{12}=E[u_1u_2]`}</Tex>（unit RMS 時 <Tex>{String.raw`|\rho|\le1`}</Tex>）
      </>
    ),
    unit: String.raw`1`,
    firstSeen: '10.1',
    note: (
      <>
        不要和下面帶括號的 <Tex>{String.raw`\rho(\mathbf A)`}</Tex> 混淆
      </>
    ),
  },
  {
    symbol: String.raw`\rho(\mathbf A)`,
    meaning: (
      <>
        spectral radius：矩陣 <Tex>{String.raw`\mathbf A`}</Tex> 所有 eigenvalue 中最大的絕對值 <Tex>{String.raw`\max_i|p_i|`}</Tex>；<Tex>{String.raw`\rho(\mathbf A)<1`}</Tex> 才收斂
      </>
    ),
    unit: String.raw`1`,
    firstSeen: '10.3',
    note: (
      <>
        一定帶括號與矩陣引數；實驗的 KPI 也寫成 <Tex>{String.raw`\rho(\mathbf A)`}</Tex>
      </>
    ),
  },
  {
    symbol: String.raw`\lambda_i,\ \mathbf v_i`,
    meaning: (
      <>
        <Tex>{String.raw`\mathbf R`}</Tex> 的第 i 個 eigenvalue / eigenvector（由大到小）
      </>
    ),
    unit: String.raw`1`,
    firstSeen: '10.3',
    note: (
      <>
        本章 <Tex>{String.raw`\lambda_i`}</Tex> 只代表 eigenvalue；regularization 改記 <Tex>{String.raw`\lambda_{\mathrm{reg}}`}</Tex>
        <Erratum id="E22" />
      </>
    ),
  },
  {
    symbol: String.raw`\boldsymbol\xi=\mathbf V^T\boldsymbol\delta`,
    meaning: '模式（eigen-mode）座標：沿每個 eigenvector 的誤差分量',
    unit: String.raw`\mathrm{fs}`,
    firstSeen: '10.4',
    note: (
      <>
        <Tex>{String.raw`\operatorname{Var}(\xi_i)`}</Tex> 是第 i 個模式、不是第 i 個參數的變異
        <Erratum id="E37" />
      </>
    ),
  },
  {
    symbol: String.raw`\mathbf V,\ \boldsymbol\Lambda`,
    meaning: (
      <>
        <Tex>{String.raw`\mathbf V`}</Tex>：欄向量為 <Tex>{String.raw`\mathbf v_i`}</Tex> 的正交矩陣；<Tex>{String.raw`\boldsymbol\Lambda=\operatorname{diag}(\lambda_i)`}</Tex>；
        <Tex>{String.raw`\mathbf R=\mathbf V\boldsymbol\Lambda\mathbf V^T`}</Tex>
      </>
    ),
    unit: String.raw`1`,
    firstSeen: '10.3',
  },
  { symbol: String.raw`\kappa=\lambda_{\max}/\lambda_{\min}`, meaning: 'condition number／eigenvalue spread', unit: String.raw`1`, firstSeen: '10.3' },
  {
    symbol: String.raw`\mathbf M`,
    meaning: (
      <>
        更新矩陣：<Tex>{String.raw`\mathbf w_{k+1}=\mathbf w_k+\mathbf M\mathbf G_k`}</Tex>
      </>
    ),
    unit: String.raw`\mathrm{fs}`,
    firstSeen: '10.3',
    note: (
      <>
        正規化 <Tex>{String.raw`\mathbf M_n=K_q\mathbf M`}</Tex>（無因次）
      </>
    ),
  },
  {
    symbol: String.raw`\mu`,
    meaning: (
      <>
        scalar learning rate（<Tex>{String.raw`\mathbf M=\mu\mathbf I`}</Tex>）
      </>
    ),
    unit: String.raw`\mathrm{fs}`,
    firstSeen: '10.3',
    note: (
      <>
        無因次 loop gain = <Tex>{String.raw`\mu K_q`}</Tex>
      </>
    ),
  },
  {
    symbol: String.raw`\gamma`,
    meaning: (
      <>
        preconditioned loop gain（<Tex>{String.raw`\mathbf M=\gamma(K_q\mathbf R)^{-1}`}</Tex> 時每個 <Tex>{String.raw`p_i=1-\gamma`}</Tex>）
      </>
    ),
    unit: String.raw`1`,
    firstSeen: '10.3',
  },
  {
    symbol: String.raw`\lambda_{\mathrm{reg}}`,
    meaning: (
      <>
        regularization 參數（<Tex>{String.raw`\mathbf R+\lambda_{\mathrm{reg}}\mathbf I`}</Tex> 或 <Tex>{String.raw`\mathbf J^T\mathbf J+\lambda_{\mathrm{reg}}\mathbf I`}</Tex>）
      </>
    ),
    unit: String.raw`1\ \text{或}\ \mathrm{fs}^{-2}`,
    firstSeen: '10.4.1',
    note: (
      <>
        規格原寫 <Tex>{String.raw`\lambda`}</Tex>，與 eigenvalue 撞名；兩種形式的單位也不同（docs/validation.md 把兩者分別記為{' '}
        <Tex>{String.raw`\varepsilon_R`}</Tex>、<Tex>{String.raw`\varepsilon_J`}</Tex>；本站統一寫 <Tex>{String.raw`\lambda_{\mathrm{reg}}`}</Tex> 並標明是 R 形式或 J 形式）
        <Erratum id="E22" />
      </>
    ),
  },
  { symbol: String.raw`\mathbf C=E[\mathbf x\mathbf u^T]`, meaning: 'GMAC code 與有效 regressor 的交叉相關（可不對稱）', unit: String.raw`1`, firstSeen: '10.5' },
  {
    symbol: String.raw`\mathbf R_x=E[\mathbf x\mathbf x^T]`,
    meaning: (
      <>
        GMAC code 自己的自相關（決定 GMAC 雜訊的形狀）；理想匹配時 <Tex>{String.raw`\mathbf R_x=\mathbf R`}</Tex>
      </>
    ),
    unit: String.raw`1`,
    firstSeen: '10.2',
  },
  {
    symbol: String.raw`\mathbf J=\partial E[\mathbf G]/\partial\mathbf w=-K_q\mathbf C`,
    meaning: 'GMAC 對校正係數的 Jacobian（斜率矩陣）',
    unit: String.raw`\mathrm{fs}^{-1}`,
    firstSeen: '10.3',
    note: (
      <>
        匹配模型 <Tex>{String.raw`\mathbf J=-K_q\mathbf R`}</Tex>；正規化 <Tex>{String.raw`\mathbf J_n=\mathbf J/K_q`}</Tex>
      </>
    ),
  },
  {
    symbol: String.raw`\sigma_i`,
    meaning: (
      <>
        <Tex>{String.raw`\mathbf J`}</Tex> 的第 i 個 singular value
      </>
    ),
    unit: String.raw`\mathrm{fs}^{-1}`,
    firstSeen: '10.5',
  },
  {
    symbol: String.raw`\hat{\mathbf J}`,
    meaning: (
      <>
        用來建構 <Tex>{String.raw`\mathbf M`}</Tex> 的 Jacobian 估計（量測值或設計值）；真實 plant 仍是 <Tex>{String.raw`\mathbf J`}</Tex>
      </>
    ),
    unit: String.raw`\mathrm{fs}^{-1}`,
    firstSeen: '10.5',
    note: (
      <>
        <Tex>{String.raw`\hat{\mathbf J}\ne\mathbf J`}</Tex> 時封閉式 pole 公式失效
        <Erratum id="E24" />
      </>
    ),
  },
  { symbol: String.raw`\mathbf A_{\mathrm{cal}}=\mathbf I+\mathbf M\mathbf J`, meaning: '校正迴路矩陣；eigenvalue = poles', unit: String.raw`1`, firstSeen: '10.3' },
  { symbol: String.raw`p_i`, meaning: mathText('第 $i$ 個模式的 pole（每個 block 乘一次）'), unit: String.raw`1`, firstSeen: '10.3' },
  {
    symbol: String.raw`k_{95}`,
    meaning: (
      <>
        誤差衰減到 5%（下降 95%）所需的 block 數：<Tex>{String.raw`\lceil\ln0.05/\ln|p|\rceil`}</Tex>
      </>
    ),
    unit: String.raw`\text{blocks}`,
    firstSeen: '10.3.1',
  },
  {
    symbol: String.raw`m_i`,
    meaning: (
      <>
        正規化更新矩陣沿第 i 個 eigenvector 的增益：<Tex>{String.raw`\mathbf M_n\mathbf v_i=m_i\mathbf v_i`}</Tex>（<Tex>{String.raw`p_i=1-m_i\lambda_i`}</Tex>）
      </>
    ),
    unit: String.raw`1`,
    firstSeen: '10.4',
  },
  { symbol: String.raw`\tilde\mu`, meaning: 'NLMS 的正規化步長（已除以 regressor 總能量）', unit: String.raw`1`, firstSeen: '10.6' },
  { symbol: String.raw`\boldsymbol\eta_k`, meaning: mathText(String.raw`GMAC 雜訊：$\mathbf G$ 與其平均之差`), unit: String.raw`1`, firstSeen: '10.2', note: <>近平衡時 <Tex>{String.raw`\operatorname{Cov}(\boldsymbol\eta)\approx\mathbf R_x/N`}</Tex></> },
  { symbol: String.raw`N`, meaning: 'GMAC 每次更新累加的 sample 數', unit: String.raw`\text{samples}`, firstSeen: '10.1' },
  { symbol: String.raw`\Delta_j`, meaning: mathText('量測 Jacobian 時對第 $j$ 個參數的擾動'), unit: String.raw`\mathrm{fs}`, firstSeen: '10.5' },
  {
    symbol: String.raw`N_J`,
    meaning: (
      <>
        量測 Jacobian 時，每一次（<Tex>{String.raw`+\Delta_j`}</Tex> 或 <Tex>{String.raw`-\Delta_j`}</Tex>）GMAC 累加的 sample 數
      </>
    ),
    unit: String.raw`\text{samples}`,
    firstSeen: '10.5',
  },
  {
    symbol: String.raw`n,\ k`,
    meaning: (
      <>
        <Tex>{'n'}</Tex>：comparator sample 索引；<Tex>{'k'}</Tex>：GMAC block（更新）索引
      </>
    ),
    unit: String.raw`1`,
    firstSeen: '10.1',
    note: '規格 §0 時間索引約定',
  },
]

export function S0Intro() {
  const c = NUM.coupling
  return (
    <>
      <TagRow>
        <ModelLevel level="L3" />
        <ClaimTag kind="exact" />
        <ClaimTag kind="approx" />
        <SourceTag kind="illustrative" />
        <TestBadge id="T18" />
        <TestBadge id="T10" />
      </TagRow>

      <Section kind="intuition" title="這一課要回答的問題：多個 LMS loop 同時跑，會互相干擾嗎？" level={2} id="ch10-question">
        <p>
          真實的 Fractional-N PLL 不會只校正一個參數。GOS（DTC gain offset）、PHOS（多相位 offset）、DTC gain 這些 loop 常常<strong>同時</strong>
          在背景更新，而且它們全部看<strong>同一個 1-bit comparator</strong> 的輸出 <Tex>{'q[n]'}</Tex>。每個 loop 單獨調都很穩，放在一起卻可能：
        </p>
        <ol>
          <li>
            <strong>變得非常慢</strong>：單一 loop（<Tex>{String.raw`\mu K_q=0.5`}</Tex>）{NUM.rho099.blocksFull} 個 block 就收斂，兩個高度相關（
            <Tex>{String.raw`\rho=0.99`}</Tex>）的 loop 合在一起要 {NUM.rho099.blocksScalar} 個 block；
          </li>
          <li>
            <strong>係數雜訊變得很大</strong>：為了加速而使用反矩陣，GMAC noise 被放大幾十倍；
          </li>
          <li>
            <strong>直接發散</strong>：每個 loop 的對角斜率都是對的，卻因為 off-diagonal 耦合而一起發散（T18）。
          </li>
        </ol>
        <p>
          這一課先用<strong>數字</strong>看到耦合，再一步一步推出 <Tex>{String.raw`\mathbf G\approx K_q\mathbf R\boldsymbol\delta`}</Tex>、更新矩陣{' '}
          <Tex>{String.raw`\mathbf M`}</Tex> 的五種選擇（scalar / diagonal / NLMS / 完整反矩陣 / regularized）與 sequential calibration，最後用
          Jacobian 的觀點處理「模型不準」與「每個 loop 單獨穩定，不代表 MIMO 一起穩定」。
        </p>
        <Callout kind="info" title="一句話直覺">
          <p>
            一個 comparator 只會說「總誤差是正還是負」。如果兩個參數的 regressor 長得很像（相關係數 <Tex>{String.raw`\rho`}</Tex> 接近 1），GMAC 就很難分辨「是誰錯」；
            它只看得清楚「兩個一起錯」的方向，看不清楚「一個多、一個少」的方向。
          </p>
        </Callout>
      </Section>

      <Section
        kind="diagram"
        title={
          <>
            系統圖：<Tex>{'P'}</Tex> 個 GMAC 共用一個 comparator
          </>
        }
      >
        <Mermaid
          caption="多參數 Block Sign-LMS（示意）。每個 GMAC 用自己的 code 去相關同一個 comparator 輸出；更新矩陣決定各 GMAC 的輸出如何分配到各校正係數（圖中文字為示意標籤，正式符號見下方符號表）。"
          chart={`flowchart LR
  subgraph PLL["PLL + DTC（誤差路徑）"]
    E["e[n] = u1·δ1 + u2·δ2 + u3·δ3 + v"]
  end
  E --> Q["1-bit comparator<br/>q = sign(e)"]
  Q --> G1["GMAC1: Σ q·x1 / N"]
  Q --> G2["GMAC2: Σ q·x2 / N"]
  Q --> G3["GMAC3: Σ q·x3 / N"]
  G1 --> M["更新矩陣 M<br/>(μI / diag / NLMS /<br/>γ(KqR)⁻¹ / regularized)"]
  G2 --> M
  G3 --> M
  M --> W["w ← w + M·G<br/>(GOS / PHOS / DTC gain)"]
  W -->|"δ = a − w"| E`}
        />
        <p className="small muted">
          重點：<Tex>{'e[n]'}</Tex> 是<strong>所有</strong>參數誤差的加總。GMAC<sub>1</sub> 看到的是 <Tex>{String.raw`E[q\,x_1]`}</Tex>，只要{' '}
          <Tex>{String.raw`x_1`}</Tex> 與 <Tex>{String.raw`u_2`}</Tex> 相關，<Tex>{String.raw`\delta_2`}</Tex> 就會漏進 <Tex>{String.raw`G_1`}</Tex>。
        </p>
      </Section>

      <SymbolTable
        rows={SYMBOLS}
        caption={
          <>
            「首次出現」為本頁段落編號（規格對應段落見各節標題旁）。單位約定：時間誤差一律 fs；code / regressor 已正規化（無因次）。本章例子常把 <Tex>{'K_q'}</Tex> 正規化為 1（即取{' '}
            <Tex>{String.raw`\sigma_v=\sqrt{2/\pi}\ \mathrm{fs}`}</Tex>），此時會明寫；換成第 5 章的{' '}
            <Tex>{String.raw`K_q=${tn(NUM.Kq, 6)}\ \mathrm{fs}^{-1}`}</Tex>（<Tex>{String.raw`\sigma_v=100\ \mathrm{fs}`}</Tex>）時數字會差兩個數量級。
          </>
        }
      />

      <Prereq title="向量與矩陣乘向量（本章所有公式的基本動作）">
        <p>
          一個 2×2 矩陣乘一個向量，就是「每一列和向量做內積」。以本章第一個例子的 <Tex>{String.raw`\mathbf R`}</Tex> 為例：
        </p>
        <TexBlock>
          {String.raw`\begin{bmatrix}1&0.8\\0.8&1\end{bmatrix}\begin{bmatrix}\delta_1\\\delta_2\end{bmatrix}=\begin{bmatrix}1\cdot\delta_1+0.8\,\delta_2\\0.8\,\delta_1+1\cdot\delta_2\end{bmatrix}`}
        </TexBlock>
        <p>
          第一列告訴你：第 1 個分量不只看 <Tex>{String.raw`\delta_1`}</Tex>，還混進了 <Tex>{String.raw`0.8\,\delta_2`}</Tex>。這就是「耦合」的數學樣子。
          單位矩陣 <Tex>{String.raw`\mathbf I`}</Tex> 對角是 1、其他是 0，乘任何向量都不變。
        </p>
      </Prereq>

      <Prereq title={String.raw`轉置、行列式、反矩陣與 trace（$2\times2$ 就夠用）`}>
        <p>本章只需要 2×2 矩陣的四個小工具（3×3 的概念完全一樣，只是算式較長，交給實驗的 Matrix Inspector）：</p>
        <ul>
          <li>
            <strong>轉置（transpose）</strong> <Tex>{String.raw`\mathbf A^T`}</Tex>：把列與行對調。欄向量 <Tex>{String.raw`\mathbf u`}</Tex> 的轉置是列向量，所以{' '}
            <Tex>{String.raw`\mathbf u^T\boldsymbol\delta=u_1\delta_1+u_2\delta_2`}</Tex> 是一個數（內積），而 <Tex>{String.raw`\mathbf u\mathbf u^T`}</Tex> 是一個矩陣（外積，第{' '}
            <Tex>{'(i,j)'}</Tex> 格是 <Tex>{String.raw`u_iu_j`}</Tex>）。<Tex>{String.raw`\mathbf A^T=\mathbf A`}</Tex> 的矩陣叫<strong>對稱</strong>。
          </li>
          <li>
            <strong>行列式（determinant）</strong>：<Tex>{String.raw`\det\begin{bmatrix}a&b\\c&d\end{bmatrix}=ad-bc`}</Tex>。<Tex>{String.raw`\det=0`}</Tex>{' '}
            代表兩列（或兩行）成比例，矩陣把某個方向「壓扁」成 0，稱為<strong>奇異（singular）</strong>。
          </li>
          <li>
            <strong>反矩陣（inverse）</strong> <Tex>{String.raw`\mathbf A^{-1}`}</Tex>：滿足 <Tex>{String.raw`\mathbf A^{-1}\mathbf A=\mathbf I`}</Tex> 的矩陣，等於「把{' '}
            <Tex>{String.raw`\mathbf A`}</Tex> 做的事還原」。2×2 的公式：
            <TexBlock>{String.raw`\begin{bmatrix}a&b\\c&d\end{bmatrix}^{-1}=\frac{1}{ad-bc}\begin{bmatrix}d&-b\\-c&a\end{bmatrix}\qquad\Rightarrow\qquad\begin{bmatrix}1&\rho\\\rho&1\end{bmatrix}^{-1}=\frac{1}{1-\rho^2}\begin{bmatrix}1&-\rho\\-\rho&1\end{bmatrix}`}</TexBlock>
            分母就是行列式：<Tex>{String.raw`\rho\to1`}</Tex> 時 <Tex>{String.raw`1-\rho^2\to0`}</Tex>，反矩陣的元素變得非常大；<Tex>{String.raw`\rho=1`}</Tex> 時反矩陣不存在。驗算（
            <Tex>{String.raw`\rho=0.8`}</Tex>）：<Tex>{String.raw`\tfrac{1}{0.36}\begin{bmatrix}1&-0.8\\-0.8&1\end{bmatrix}\begin{bmatrix}1&0.8\\0.8&1\end{bmatrix}=\tfrac{1}{0.36}\begin{bmatrix}0.36&0\\0&0.36\end{bmatrix}=\mathbf I`}</Tex>。
          </li>
          <li>
            <strong>Trace</strong>：<Tex>{String.raw`\operatorname{tr}\mathbf A=a+d`}</Tex>（對角線的和）。
          </li>
        </ul>
        <p className="small muted">
          注意矩陣乘法<strong>不可交換</strong>（<Tex>{String.raw`\mathbf A\mathbf B\ne\mathbf B\mathbf A`}</Tex>），所以推導中 <Tex>{String.raw`\mathbf M`}</Tex> 一律寫在{' '}
          <Tex>{String.raw`\mathbf G`}</Tex> 的左邊，順序不能換。
        </p>
      </Prereq>

      <Prereq title="期望值、相關與自相關矩陣（correlation matrix）">
        <p>
          <Tex>{'E[\\cdot]'}</Tex>（期望值）可以想成「做非常多次再平均」。兩個 regressor 的相關 <Tex>{String.raw`E[u_1u_2]`}</Tex> 是乘積的長期平均：
          如果 <Tex>{String.raw`u_1`}</Tex>、<Tex>{String.raw`u_2`}</Tex> 常常同號，平均是正的；完全無關則是 0。把所有配對排成矩陣：
        </p>
        <TexBlock>
          {String.raw`\mathbf R=E[\mathbf u\mathbf u^T]=\begin{bmatrix}E[u_1^2]&E[u_1u_2]\\E[u_2u_1]&E[u_2^2]\end{bmatrix}=\begin{bmatrix}1&\rho\\\rho&1\end{bmatrix}\quad(\text{unit RMS regressors})`}
        </TexBlock>
        <p>
          <Tex>{String.raw`\mathbf R`}</Tex> 一定<strong>對稱</strong>（<Tex>{String.raw`E[u_1u_2]=E[u_2u_1]`}</Tex>），而且<strong>半正定</strong>：對任何向量{' '}
          <Tex>{String.raw`\mathbf c`}</Tex>，<Tex>{String.raw`\mathbf c^T\mathbf R\mathbf c=E[(\mathbf c^T\mathbf u)^2]\ge0`}</Tex>（平方的平均不會是負的）。
          所以 <Tex>{String.raw`|\rho|\le1`}</Tex>；<Tex>{String.raw`|\rho|>1`}</Tex> 的「<Tex>{String.raw`\mathbf R`}</Tex>」在物理上不存在，實驗會拒絕並說明。
        </p>
      </Prereq>

      <Prereq title="Eigenvalue 與 eigenvector：把耦合的系統拆成互不干擾的「模式」">
        <p>
          若 <Tex>{String.raw`\mathbf R\mathbf v=\lambda\mathbf v`}</Tex>，代表沿著方向 <Tex>{String.raw`\mathbf v`}</Tex>，乘上 <Tex>{String.raw`\mathbf R`}</Tex>{' '}
          只是放大 <Tex>{String.raw`\lambda`}</Tex> 倍、方向不變。求法：<Tex>{String.raw`\det(\mathbf R-\lambda\mathbf I)=0`}</Tex>。對{' '}
          <Tex>{String.raw`\mathbf R=\begin{bmatrix}1&\rho\\\rho&1\end{bmatrix}`}</Tex>：
        </p>
        <TexBlock>
          {String.raw`\begin{aligned}\det\begin{bmatrix}1-\lambda&\rho\\\rho&1-\lambda\end{bmatrix}&=(1-\lambda)^2-\rho^2=0\\&\Rightarrow\ 1-\lambda=\pm\rho\\&\Rightarrow\ \lambda_1=1+\rho,\ \ \mathbf v_1=\tfrac{1}{\sqrt2}\begin{bmatrix}1\\1\end{bmatrix};\qquad\lambda_2=1-\rho,\ \ \mathbf v_2=\tfrac{1}{\sqrt2}\begin{bmatrix}1\\-1\end{bmatrix}\end{aligned}`}
        </TexBlock>
        <p>
          <Tex>{String.raw`\mathbf v_1`}</Tex> 是「兩個參數一起錯同一方向」（共模），<Tex>{String.raw`\mathbf v_2`}</Tex> 是「一個多、一個少」（差模）。
          例如 <Tex>{String.raw`\rho=0.8`}</Tex> 時 <Tex>{String.raw`\lambda=${tn(c.eig[0])},\ ${tn(c.eig[1])}`}</Tex>；<Tex>{String.raw`\rho=0.99`}</Tex>{' '}
          時 <Tex>{String.raw`\lambda=${tn(NUM.rho099.eig[0])},\ ${tn(NUM.rho099.eig[1])}`}</Tex>，<Tex>{String.raw`\kappa=${tn(NUM.rho099.cond, 5)}`}</Tex>。
          對稱矩陣的 eigenvalue 都是實數、eigenvector 互相垂直，可以寫成 <Tex>{String.raw`\mathbf R=\mathbf V\boldsymbol\Lambda\mathbf V^T`}</Tex>（
          <Tex>{String.raw`\mathbf V`}</Tex> 的欄是 eigenvector、<Tex>{String.raw`\boldsymbol\Lambda=\operatorname{diag}(\lambda_i)`}</Tex>、
          <Tex>{String.raw`\mathbf V^T\mathbf V=\mathbf I`}</Tex>）。這是本章最常用的工具。兩個名詞：所有 eigenvalue 都{' '}
          <Tex>{String.raw`>0`}</Tex> 的對稱矩陣叫<strong>正定（positive definite）</strong>，此時反矩陣存在，而且{' '}
          <Tex>{String.raw`\mathbf R^{-1}=\mathbf V\boldsymbol\Lambda^{-1}\mathbf V^T`}</Tex>（eigenvector 不變、每個 eigenvalue 取倒數）；有 eigenvalue 等於 0 時{' '}
          <Tex>{String.raw`\det\mathbf R=\lambda_1\lambda_2=0`}</Tex>，矩陣奇異。另外 <Tex>{String.raw`\operatorname{tr}\mathbf R=\lambda_1+\lambda_2`}</Tex>（本例{' '}
          <Tex>{String.raw`(1+\rho)+(1-\rho)=2`}</Tex>）。
        </p>
      </Prereq>

      <Prereq title="等比數列與 pole：誤差每個 block 乘一個數">
        <p>
          若 <Tex>{String.raw`x_{k+1}=p\,x_k`}</Tex>，則 <Tex>{String.raw`x_k=p^kx_0`}</Tex>。<Tex>{String.raw`|p|<1`}</Tex> 時趨近 0，越接近 1 越慢；
          <Tex>{String.raw`|p|>1`}</Tex> 時發散；<Tex>{String.raw`p<0`}</Tex> 時正負交替。這個 <Tex>{'p'}</Tex> 就叫 pole。矩陣版本{' '}
          <Tex>{String.raw`\boldsymbol\delta_{k+1}=\mathbf A\boldsymbol\delta_k`}</Tex> 在 eigenvector 座標下拆成好幾個獨立的等比數列，每個模式一個 pole{' '}
          <Tex>{String.raw`p_i=\operatorname{eig}_i(\mathbf A)`}</Tex>；最大的 <Tex>{String.raw`|p_i|`}</Tex>（spectral radius）決定收斂與否。
        </p>
      </Prereq>
    </>
  )
}
