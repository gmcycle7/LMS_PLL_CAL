import type { ReactNode } from 'react'
import { Callout, ClaimTag, CodeBlock, CodeCompare, ModeGate, Section, StepDerivation, Tex, TexBlock } from '@/components'
import mimoSrc from '@/simulation/models/mimo.ts?raw'
import mimoPy from '../../../../golden/lms_pll_golden/mimo.py?raw'
import { RULE_SHORT, type MimoRule } from '@/simulation/models/mimo'
import { Deriv, Erratum, Fig, TagRow, goldenSection10, n, nint, tn } from '../common'
import { NUM } from '../numbers'

const PATH = 'src/simulation/models/mimo.ts'
const PY_PATH = 'golden/lms_pll_golden/mimo.py'

/** 程式碼 ↔ 數學對照（§10.8 表格）：每個規則的 M_n 與 Ĵ = J 時的 poles */
const CODE_MATH: { rule: string; fn: string; Mn: string; poles: ReactNode }[] = [
  { rule: 'Scalar', fn: 'mScalar', Mn: String.raw`\mu K_q\,\mathbf I`, poles: <Tex>{String.raw`1-\mu K_q\lambda_i`}</Tex> },
  {
    rule: 'Diagonal',
    fn: 'mDiagonal',
    Mn: String.raw`\operatorname{diag}\!\big(-\gamma/\hat J_{n,ii}\big)`,
    poles: (
      <>
        單一 loop <Tex>{String.raw`1-\gamma`}</Tex>；合起來沒有通式，要算 <Tex>{String.raw`\operatorname{eig}(\mathbf I+\mathbf M_n\mathbf J_n)`}</Tex>
      </>
    ),
  },
  { rule: 'NLMS', fn: 'mNlms', Mn: String.raw`\dfrac{\tilde\mu}{\operatorname{tr}\hat{\mathbf R}_x}\,\mathbf I`, poles: <Tex>{String.raw`1-\tilde\mu\lambda_i/\operatorname{tr}\mathbf R`}</Tex> },
  { rule: 'Full inverse', fn: 'mFull', Mn: String.raw`-\gamma\,\hat{\mathbf J}_n^{-1}\ (=\gamma\hat{\mathbf R}^{-1})`, poles: <Tex>{String.raw`1-\gamma`}</Tex> },
  {
    rule: 'Regularized（R 形式）',
    fn: 'mRegularized',
    Mn: String.raw`\gamma\,(\hat{\mathbf R}+\lambda_{\mathrm{reg}}\mathbf I)^{-1}`,
    poles: <Tex>{String.raw`1-\gamma\lambda_i/(\lambda_i+\lambda_{\mathrm{reg}})`}</Tex>,
  },
  {
    rule: 'Regularized（J 形式）',
    fn: 'mRegularized',
    Mn: String.raw`-\gamma\,(\hat{\mathbf J}_n^T\hat{\mathbf J}_n+\lambda_{\mathrm{reg}}\mathbf I)^{-1}\hat{\mathbf J}_n^T`,
    poles: <Tex>{String.raw`1-\gamma\sigma_i^2/(\sigma_i^2+\lambda_{\mathrm{reg}})`}</Tex>,
  },
  {
    rule: 'Sequential',
    fn: 'mSequential',
    Mn: String.raw`-\dfrac{\gamma}{\hat J_{n,ii}}\,\mathbf e_i\mathbf e_i^T\ \ (\text{第 }k\text{ 個 block 只開第 }i\text{ 個 loop})`,
    poles: (
      <>
        每階段 <Tex>{String.raw`1-\gamma`}</Tex>；一輪的轉移矩陣 <Tex>{String.raw`\boldsymbol\Phi=\prod_i\mathbf A_i^{K}`}</Tex>
      </>
    ),
  },
]

const HW_COST: Record<MimoRule, ReactNode> = {
  scalar: (
    <>
      1 個 shift/multiplier（共用 <Tex>{String.raw`\mu`}</Tex>）
    </>
  ),
  diagonal: (
    <>
      <Tex>{'P'}</Tex> 個獨立 <Tex>{String.raw`\mu_i`}</Tex> 暫存器
    </>
  ),
  nlms: '能量估計 + 除法（或 LUT）',
  full: (
    <>
      <Tex>{String.raw`P\times P`}</Tex> 矩陣乘（<Tex>{'P^2'}</Tex> 個 MAC）+ 寬位元 <Tex>{String.raw`\mathbf M`}</Tex> 係數
    </>
  ),
  regularized: (
    <>
      <Tex>{String.raw`P\times P`}</Tex> 矩陣乘 + <Tex>{String.raw`\lambda_{\mathrm{reg}}`}</Tex>；<Tex>{String.raw`\mathbf M`}</Tex> 由韌體/LUT 預算
    </>
  ),
  sequential: '狀態機（每階段 1 個 loop）',
}

const HYPER: Record<MimoRule, ReactNode> = {
  scalar: <Tex>{String.raw`\mu K_q=0.5`}</Tex>,
  diagonal: (
    <>
      <Tex>{String.raw`\gamma=0.5`}</Tex>（單 loop pole 0.5）
    </>
  ),
  nlms: <Tex>{String.raw`\tilde\mu=1`}</Tex>,
  full: <Tex>{String.raw`\gamma=0.5`}</Tex>,
  regularized: (
    <>
      <Tex>{String.raw`\gamma=0.5,\ \lambda_{\mathrm{reg}}=0.1`}</Tex>（R 形式）
    </>
  ),
  sequential: (
    <>
      <Tex>{String.raw`\gamma=1`}</Tex>、1 block/階段、round-robin
    </>
  ),
}

/** 四捨五入到 10⁻⁶ 再顯示（避免把 0.5⁴⁰ 量級的浮點殘餘印成 3.6e−12） */
function r6(x: number): string {
  const v = Math.round(x * 1e6) / 1e6
  return n(v === 0 ? 0 : v, 7)
}

const PHASE_LABEL: ReactNode[] = [
  '初值',
  <>
    階段 1：只更新 <Tex>{'w_1'}</Tex>
  </>,
  <>
    階段 2：只更新 <Tex>{'w_2'}</Tex>
  </>,
]

export function S5Architectures() {
  const r = NUM.rho099
  const s = NUM.seq
  const seqPhaseLen = 40
  return (
    <>
      <Section kind="formula" title="10.6 NLMS 與 Sequential Calibration" level={2} id="ch10-nlms-seq">
        <TagRow>
          <span className="small muted">規格 §10.3</span>
          <ClaimTag kind="exact" />
        </TagRow>
        <h3>NLMS / Sign-NLMS：只正規化「總能量」</h3>
        <p>
          NLMS 把步長除以 regressor 的能量 <Tex>{String.raw`\|\mathbf u\|^2`}</Tex>，讓 loop gain 不受 code 振幅影響。Block 版本用平均能量{' '}
          <Tex>{String.raw`E\|\mathbf u\|^2=\operatorname{tr}\mathbf R`}</Tex>（<Tex>{String.raw`\|\mathbf u\|^2=u_1^2+\dots+u_P^2`}</Tex> 是這個 sample 所有 regressor 的平方和；它的平均等於{' '}
          <Tex>{String.raw`\mathbf R`}</Tex> 對角線的和）：
        </p>
        <Fig id="nlms">
          先看從 code <Tex>{'x[n]'}</Tex> 出發的那一路：把 <Tex>{'P'}</Tex> 個 code 的平方加起來取平均，得到 regressor 的總能量 <Tex>{String.raw`\operatorname{tr}\mathbf R`}</Tex>（code 振幅變大，這個數就跟著變大）。再看藍色方塊：每個 GMAC 輸出都乘上<strong>同一個數</strong>{' '}
          <Tex>{String.raw`\tilde\mu/(K_q\operatorname{tr}\mathbf R)`}</Tex>，所以 code 振幅改變時 loop gain 不變；但「同一個數」也表示各個方向之間的相對增益完全沒有變（紅色）。圖上的藍色方塊就是下面推導第 1 步的{' '}
          <Tex>{String.raw`\mathbf M=\tilde\mu/(K_q\operatorname{tr}\mathbf R)\cdot\mathbf I`}</Tex>，<Tex>{String.raw`\tilde\mu`}</Tex> 是 NLMS 的無因次步長；最右邊的 pole 就是 F-10.12。
        </Fig>
        <Deriv title="NLMS 的 poles">
          <StepDerivation
            steps={[
              {
                tex: String.raw`\mathbf M=\frac{\tilde\mu}{K_q\operatorname{tr}\mathbf R}\,\mathbf I`,
                why: (
                  <>
                    純量 × <Tex>{String.raw`\mathbf I`}</Tex>：方向與 scalar LMS 相同，只是步長自動縮放。
                  </>
                ),
              },
              { tex: String.raw`\mathbf I-K_q\mathbf M\mathbf R=\mathbf V\Big(\mathbf I-\frac{\tilde\mu}{\operatorname{tr}\mathbf R}\boldsymbol\Lambda\Big)\mathbf V^T`, why: '同 F-10.3 的 eigen 分解。' },
              {
                tex: String.raw`p_i=1-\tilde\mu\,\frac{\lambda_i}{\operatorname{tr}\mathbf R}=1-\tilde\mu\,\frac{\lambda_i}{\sum_j\lambda_j}`,
                why: (
                  <>
                    <Tex>{String.raw`\operatorname{tr}\mathbf R=\sum_j\lambda_j`}</Tex>（trace = eigenvalue 總和）。
                  </>
                ),
              },
            ]}
          />
        </Deriv>
        <TexBlock
          id="F-10.12"
          label={
            <>
              NLMS 每個模式的 loop gain <Tex>{String.raw`1-p_i`}</Tex> 仍然正比於 <Tex>{String.raw`\lambda_i`}</Tex>：eigenvalue spread 沒有被修正
            </>
          }
        >
          {String.raw`\boxed{p_i=1-\tilde\mu\,\frac{\lambda_i}{\operatorname{tr}\mathbf R}}\qquad\Rightarrow\qquad\frac{1-p_{\min}}{1-p_{\max}}=\frac{\lambda_{\min}}{\lambda_{\max}}=\frac{1}{\kappa}`}
        </TexBlock>
        <p>
          <Tex>{String.raw`\rho=0.99,\ \tilde\mu=1`}</Tex>：<Tex>{String.raw`\operatorname{tr}\mathbf R=2`}</Tex>，poles ={' '}
          <Tex>{String.raw`1-1.99/2=${tn(r.nlmsPoles[0])},\ 1-0.01/2=${tn(r.nlmsPoles[1])}`}</Tex>，需要 {nint(r.nlmsBlocks)} 個 block——與 <Tex>{String.raw`\mu K_q=0.5`}</Tex>{' '}
          的一般 LMS 完全一樣。NLMS 解決「code 振幅變了 loop gain 就變」的問題，但<strong>不會自動使高度相關的 regressors 可辨識</strong>。
        </p>

        <h3 className="ch10-sub">Sequential Calibration：一次只校一個（Gauss–Seidel）</h3>
        <p>
          另一種常見做法是分階段：先校 GOS，再校 PHOS，再校 DTC gain。每一階段只有一個 loop 在動，其他凍結——所以每一階段都是穩定的純量 LMS。問題在於：
          被凍結的參數若還有誤差，正在校的那個參數會<strong>把別人的誤差吸收進來</strong>。
        </p>
        <Fig id="seq-fsm">
          先由上往下看兩個主要狀態：階段 1 只有 <Tex>{'w_1'}</Tex> 在更新（更新矩陣只剩 <Tex>{String.raw`M_{11}`}</Tex> 一個元素不是 0），階段 2 換成只有 <Tex>{'w_2'}</Tex>。再看三條箭頭：每個階段跑滿設定的 block
          數就換下一個；一輪（sweep）走完可以再來一輪（round-robin），輪數用完就全部凍結。這就是 §10.8 程式碼 <code>mSequential</code> 的行為：第 <Tex>{'k'}</Tex> 個 block 屬於第{' '}
          <Tex>{String.raw`\lfloor k/B\rfloor`}</Tex> 個階段（<Tex>{'B'}</Tex> 是每個階段的 block 數），那個階段只開第 <Tex>{String.raw`i=\lfloor k/B\rfloor\bmod P`}</Tex> 個 loop（從 0 數起）。圖上的「<Tex>{String.raw`\mathbf M=\mathbf 0`}</Tex>
          」就是所有係數都不再更新。
        </Fig>
        <p>
          每個階段都穩定，聽起來很安全。但把兩個 regressor 完全相同（<Tex>{String.raw`\rho=1`}</Tex>）的極端情況代進這個狀態機，會發生下面的事：
        </p>
        <Fig id="seq-trap">
          由上往下看。第一格是問題的根源：兩個 regressor 完全一樣時，<Tex>{'e[n]'}</Tex> 裡只出現 <Tex>{String.raw`\delta_1+\delta_2`}</Tex>。階段 1 只動 <Tex>{'w_1'}</Tex>，它會一路走到{' '}
          <Tex>{String.raw`\delta_1+\delta_2=0`}</Tex> 為止，也就是 <Tex>{String.raw`w_1=a_1+a_2=${s.a[0] + s.a[1]}`}</Tex>（正確值是 {s.a[0]}）。輪到階段 2 時 GMAC<sub>2</sub> 的平均已經是 0，<Tex>{'w_2'}</Tex> 留在 0（正確值是{' '}
          {s.a[1]}）。最後兩格：輸出誤差是 0，看起來沒問題；直到 code 改變、<Tex>{String.raw`u_1\ne u_2`}</Tex>，藏起來的 <Tex>{String.raw`\boldsymbol\delta=(${-s.a[1]},\ +${s.a[1]})`}</Tex> 才出現。圖上的每一格對應下面
          Callout 的步驟 1–3，以及表格的 block 0、40、80 三列。
        </Fig>
        <Callout
          kind="danger"
          title={
            <>
              陷阱：<Tex>{String.raw`x_1=x_2`}</Tex>（完全相關）時，所有誤差被先校的 <Tex>{'w_1'}</Tex> 吸收
            </>
          }
        >
          <p>
            <Tex>{String.raw`u_1=u_2=u`}</Tex>（<Tex>{String.raw`\rho=1`}</Tex>），真實 <Tex>{String.raw`\mathbf a=(${s.a[0]},\ ${s.a[1]})`}</Tex>，初值{' '}
            <Tex>{String.raw`\mathbf w_0=(0,0)`}</Tex>。誤差 <Tex>{String.raw`e=u(\delta_1+\delta_2)+v`}</Tex> 只看得到<strong>和</strong>{' '}
            <Tex>{String.raw`\delta_1+\delta_2`}</Tex>。
          </p>
          <ol>
            <li>
              階段 1（只動 <Tex>{'w_1'}</Tex>）：GMAC<sub>1</sub> 平均 <Tex>{String.raw`\propto\delta_1+\delta_2`}</Tex>，收斂到 <Tex>{String.raw`\delta_1+\delta_2=0`}</Tex>，也就是{' '}
              <Tex>{String.raw`w_1=a_1+(a_2-w_2)=${s.a[0]}+${s.a[1]}=${s.a[0] + s.a[1]}`}</Tex>。
            </li>
            <li>
              階段 2（只動 <Tex>{'w_2'}</Tex>）：此時 <Tex>{String.raw`\delta_1+\delta_2=0`}</Tex> ⇒ GMAC<sub>2</sub> 平均 = 0 ⇒ <Tex>{'w_2'}</Tex> 永遠停在 0。
            </li>
            <li>
              結果 <Tex>{String.raw`\mathbf w=(${s.a[0] + s.a[1]},0)`}</Tex>：輸出誤差為 0，但兩個參數都錯了。只要之後 code 改變使 <Tex>{String.raw`u_1\ne u_2`}</Tex>（例如換 FCW），錯誤的分配就會現形。
            </li>
          </ol>
        </Callout>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="ch10-num">block k</th>
                <th>
                  <Tex>{String.raw`\delta_k`}</Tex> 來自
                </th>
                <th className="ch10-num">
                  <Tex>{'w_1'}</Tex>
                </th>
                <th className="ch10-num">
                  <Tex>{'w_2'}</Tex>
                </th>
                <th className="ch10-num">
                  <Tex>{String.raw`\delta_1+\delta_2`}</Tex>（輸出看到的）
                </th>
              </tr>
            </thead>
            <tbody>
              {s.rows.map((row) => (
                <tr key={row.k}>
                  <td className="ch10-num">{row.k}</td>
                  <td>{PHASE_LABEL[row.phase]}</td>
                  <td className="ch10-num">{r6(row.w1)}</td>
                  <td className="ch10-num">{r6(row.w2)}</td>
                  <td className="ch10-num">{r6(row.sum)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          由 <code>propagateLinearMoments()</code> 以 sequential 規則（<Tex>{String.raw`\gamma=0.5`}</Tex>、每階段 {seqPhaseLen} blocks、<Tex>{'K_q'}</Tex> 正規化為 1、無雜訊平均）計算；
          階段 1 每個 block 把 <Tex>{String.raw`\delta_1+\delta_2`}</Tex> 乘上 <Tex>{String.raw`1-\gamma=0.5`}</Tex>（表中數字四捨五入到{' '}
          <Tex>{String.raw`10^{-6}`}</Tex>；階段 1 結束時的殘餘 <Tex>{String.raw`4\times0.5^{${seqPhaseLen}}\approx${tn(4 * Math.pow(0.5, seqPhaseLen), 2)}`}</Tex> 已可忽略）。誰先校，誰就吸收全部的不可辨識誤差——
          這和第 9 章的 gauge freedom 是同一件事：<Tex>{String.raw`\mathbf R`}</Tex> 的 null space 方向 <Tex>{String.raw`[1,-1]^T`}</Tex> 的分量由「初值 + 校正順序」決定。
        </p>
        <p>
          <Tex>{String.raw`\rho<1`}</Tex> 時多跑幾輪（round-robin）會收斂，但就是 Gauss–Seidel 迭代（解聯立方程的古典方法：每次只解一個未知數，其他未知數先用目前的值代入，輪流重複）：<Tex>{String.raw`\gamma=1`}</Tex>、每階段一步解出該座標時，每一輪（sweep）誤差只收縮{' '}
          <Tex>{String.raw`\rho^2`}</Tex>。<Tex>{String.raw`\rho=0.99`}</Tex>：每輪收縮 <Tex>{String.raw`${tn(s.gsSweep, 5)}`}</Tex>，也就是平均每個 block 只收縮{' '}
          <Tex>{String.raw`${tn(s.gsPerBlock, 4)}`}</Tex>——和同樣積極的一般 LMS（<Tex>{String.raw`\mu K_q=1`}</Tex>，慢 pole{' '}
          <Tex>{String.raw`1-1\times0.01=${tn(s.scalarMu1Pole, 4)}`}</Tex>，<Tex>{String.raw`k_{95}=${nint(s.scalarMu1Blocks)}`}</Tex>）一模一樣。
          <strong>分階段並沒有解決慢模式</strong>，遠不如完整反矩陣的 {nint(r.blocksFull)} 個 block。
        </p>
        <Fig id="gs-sweep">
          先看階段 1：只有 <Tex>{'w_1'}</Tex> 在動，<Tex>{String.raw`\gamma=1`}</Tex> 代表一步就把 GMAC<sub>1</sub> 的平均推到 0，也就是 <Tex>{String.raw`\delta_1+\rho\,\delta_2=0`}</Tex>；所以新的{' '}
          <Tex>{String.raw`\delta_1'=-\rho\,\delta_2`}</Tex>——<Tex>{'w_1'}</Tex> 並沒有變正確，而是把 <Tex>{String.raw`\delta_2`}</Tex> 的誤差「複製」了過來。再看階段 2：換 <Tex>{'w_2'}</Tex> 把 GMAC<sub>2</sub> 歸零，
          <Tex>{String.raw`\rho\,\delta_1'+\delta_2'=0`}</Tex>，得到 <Tex>{String.raw`\delta_2'=-\rho\,\delta_1'=\rho^2\delta_2`}</Tex>。一輪走完，<Tex>{String.raw`\delta_2`}</Tex> 只乘了{' '}
          <Tex>{String.raw`\rho^2=${tn(s.gsSweep, 5)}`}</Tex>（紅色）；虛線表示下一輪從同樣的地方再來一次。圖上的 <Tex>{String.raw`G_1\propto\delta_1+\rho\,\delta_2`}</Tex>、<Tex>{String.raw`G_2\propto\rho\,\delta_1'+\delta_2`}</Tex>{' '}
          就是 F-10.1 代入 <Tex>{String.raw`\mathbf R=\begin{bmatrix}1&\rho\\\rho&1\end{bmatrix}`}</Tex> 的兩列（輪到階段 2 時 <Tex>{String.raw`\delta_1`}</Tex> 已經變成 <Tex>{String.raw`\delta_1'`}</Tex>）；兩條有標籤的實線箭頭是下面推導（Engineer
          模式）的第 1、2 步，最右邊那一格是第 3 步。
        </Fig>
        <p className="small muted">
          以「最壞初始方向的誤差範數降到 5%」（<Tex>{String.raw`\|\boldsymbol\Phi_k\|_2\le0.05`}</Tex>，<Tex>{String.raw`\boldsymbol\Phi_k`}</Tex> 是前 k 個 block 的轉移矩陣乘積）計算，需要{' '}
          {nint(s.gsBlocks)} 個 block（{nint((s.gsBlocks ?? 0) / 2)} 輪）。它比只看漸近收縮率的 <Tex>{String.raw`\ln0.05/\ln\rho^2=${tn(s.gsNaiveSweeps, 4)}`}</Tex> 輪多一些，因為第一步先把{' '}
          <Tex>{String.raw`\delta_2`}</Tex> 的誤差「複製」到 <Tex>{String.raw`\delta_1`}</Tex>（<Tex>{String.raw`\delta_1'=-\rho\delta_2`}</Tex>），誤差向量的長度先變成{' '}
          <Tex>{String.raw`\sqrt{1+\rho^2}=${tn(s.gsNormFactor, 4)}`}</Tex> 倍才開始衰減。下方比較表的 sequential 列用的就是這個定義；其他規則用最慢 pole 的{' '}
          <Tex>{String.raw`\lceil\ln0.05/\ln|p|\rceil`}</Tex>（F-10.5）。
        </p>
        <ModeGate min="engineer">
          <Deriv
            title={
              <>
                為什麼每輪收縮 <Tex>{String.raw`\rho^2`}</Tex>（2×2、<Tex>{String.raw`\gamma=1`}</Tex>）
              </>
            }
          >
            <StepDerivation
              steps={[
                {
                  tex: String.raw`\text{階段 1：}\ G_1\propto\delta_1+\rho\delta_2=0\ \Rightarrow\ \delta_1'=-\rho\,\delta_2`,
                  why: (
                    <>
                      <Tex>{String.raw`\gamma=1`}</Tex> 時一步把 GMAC<sub>1</sub> 歸零（<Tex>{String.raw`\delta_2`}</Tex> 凍結）。
                    </>
                  ),
                },
                {
                  tex: String.raw`\text{階段 2：}\ G_2\propto\rho\delta_1'+\delta_2'=0\ \Rightarrow\ \delta_2'=-\rho\,\delta_1'=\rho^2\delta_2`,
                  why: (
                    <>
                      再把 GMAC<sub>2</sub> 歸零（<Tex>{String.raw`\delta_1`}</Tex> 凍結在 <Tex>{String.raw`\delta_1'`}</Tex>）。
                    </>
                  ),
                },
                {
                  tex: String.raw`\delta_2^{(\text{sweep }m)}=(\rho^2)^m\,\delta_2^{(0)}`,
                  why: (
                    <>
                      每輪乘 <Tex>{String.raw`\rho^2`}</Tex>：<Tex>{String.raw`\rho\to1`}</Tex> 時與一般 LMS 一樣慢（<Tex>{String.raw`1-\rho^2\approx2(1-\rho)`}</Tex>）。
                    </>
                  ),
                },
              ]}
            />
          </Deriv>
        </ModeGate>
      </Section>

      <Section kind="assumptions" title="10.7 四種架構比較" id="ch10-four-architectures">
        <TagRow>
          <Erratum id="E25" title="規格 §10.3 標題寫「三種架構比較」，表格實際有四列" />
          <span className="small muted">規格 §10.3（標題已更正為「四種」）</span>
        </TagRow>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>方法</th>
                <th>特色</th>
                <th>硬體代價／限制</th>
                <th>本章實驗</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Scalar LMS / independent gains</td>
                <td>最簡單；每個 loop 只看自己的 GMAC</td>
                <td>
                  Eigenvalue spread 大時慢（慢 pole <Tex>{String.raw`1-\mu K_q\lambda_{\min}`}</Tex>），易 cross-coupling；<Tex>{String.raw`\mathbf J`}</Tex> 有實部 <Tex>{String.raw`\ge0`}</Tex> 的 eigenvalue 時任何{' '}
                  <Tex>{String.raw`\mu>0`}</Tex> 都不收斂（T18）
                </td>
                <td>Scalar、Diagonal</td>
              </tr>
              <tr>
                <td>NLMS / Sign-NLMS</td>
                <td>對 regressor 能量做正規化，loop gain 不隨 code 振幅改變</td>
                <td>
                  不會自動使高度相關的 regressors 可辨識（<Tex>{String.raw`p_i=1-\tilde\mu\lambda_i/\operatorname{tr}\mathbf R`}</Tex>）
                </td>
                <td>NLMS</td>
              </tr>
              <tr>
                <td>Regularized Preconditioner</td>
                <td>
                  抑制耦合、控制 noise amplification、對 <Tex>{String.raw`\hat{\mathbf J}`}</Tex> 誤差有 robustness
                </td>
                <td>
                  Matrix/LUT、定點量化、corners 的模型誤差（<Tex>{String.raw`\hat{\mathbf J}\ne\mathbf J`}</Tex>
                  <Erratum id="E24" />）
                </td>
                <td>Full inverse、Regularized</td>
              </tr>
              <tr>
                <td>Sequential Calibration</td>
                <td>GOS、PHOS、DTC 分階段，每階段單一 loop 一定穩定</td>
                <td>
                  可能錯把不可辨識誤差歸給先校正的參數；<Tex>{String.raw`\rho\to1`}</Tex> 時多輪也很慢（每輪 <Tex>{String.raw`\rho^2`}</Tex>）
                </td>
                <td>Sequential</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          把上表和前面幾節的結論排成一張流程，選更新矩陣時可以照著問：
        </p>
        <Fig id="choose-m">
          由上往下問三個問題。第一：<Tex>{String.raw`\lambda_{\min}`}</Tex> 是不是接近 0？是的話兩個參數根本分不開，換哪一種更新矩陣都沒有用（§10.6 的陷阱；第 9 章的 PE 條件）。第二：
          <Tex>{String.raw`\mathbf J`}</Tex> 的 eigenvalue 實部是不是全為負？不是的話（T18），scalar LMS 在某個方向的極性是反的，要靠反矩陣把它轉回來。第三：<Tex>{String.raw`\kappa`}</Tex> 大不大、等不等得起慢模式？等得起就用最簡單的；等不起才用
          regularized preconditioner，並用 <Tex>{String.raw`\lambda_{\mathrm{reg}}`}</Tex> 在速度（F-10.8）、雜訊（F-10.7）與 <Tex>{String.raw`\hat{\mathbf J}`}</Tex> 誤差（勘誤 E24）之間取捨。圖上的 <Tex>{String.raw`\lambda_{\min}`}</Tex>、
          <Tex>{String.raw`\kappa`}</Tex> 就是 §10.3 的最小 eigenvalue 與 condition number。Sequential 不在圖上：它省硬體，但不會讓慢模式變快，而且有上面的吸收陷阱。
        </Fig>
        <p>
          六種更新矩陣在 §10.1 例子（<Tex>{String.raw`\rho=0.99,\ \sigma_v=${NUM.sigmaV}\ \mathrm{fs},\ N=${NUM.noise.N}`}</Tex>、<Tex>{'K_q'}</Tex> 為實體值）下的數字：
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>規則</th>
                <th>超參數</th>
                <th className="ch10-num">95% blocks</th>
                <th className="ch10-num">
                  穩態 <Tex>{String.raw`\mathrm{RMS}(\delta_j)`}</Tex>
                </th>
                <th className="ch10-num">雜訊懲罰（RMS / scalar）</th>
                <th>硬體</th>
              </tr>
            </thead>
            <tbody>
              {NUM.compare.map((row) => {
                const base = NUM.compare[0].std ?? NaN
                return (
                  <tr key={row.rule} className={row.rule === 'full' ? 'ch10-hl' : undefined}>
                    <td>{RULE_SHORT[row.rule]}</td>
                    <td className="small">{HYPER[row.rule]}</td>
                    <td className="ch10-num">{row.blocks95 === null ? '未達成' : nint(row.blocks95)}</td>
                    <td className="ch10-num">{row.std === null ? '—' : `${n(row.std, 4)} fs`}</td>
                    <td className="ch10-num">{row.std === null ? '—' : `×${n(row.std / base, 3)}`}</td>
                    <td className="small">{HW_COST[row.rule]}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          全表由 <code>analyzeRule()</code>（Lyapunov / 協方差傳遞）計算；sequential 的 RMS 是 1000 輪排程結束、凍結時的值（此時已是穩態：每個座標都以增益 1 吸收新的 GMAC
          雜訊，再被慢的 Gauss–Seidel 模式累積）。95% blocks 與 poles：<ClaimTag kind="exact" />；RMS：<ClaimTag kind="approx" />（線性 Gaussian 模型下精確，對真正的 1-bit
          迴路需近平衡）。
        </p>
      </Section>

      <Section kind="formula" title="10.8 核心程式碼：六種更新矩陣並排" id="ch10-code">
        <p>
          以下就是網站實際執行的程式碼（<code>{PATH}</code>，以 <code>?raw</code> 匯入並擷取 <code>#region core:*</code>）。六個函式的「形狀」一樣：輸入正規化 Jacobian{' '}
          <Tex>{String.raw`\hat{\mathbf J}_n=\hat{\mathbf J}/K_q`}</Tex>（匹配模型 <Tex>{String.raw`=-\mathbf R`}</Tex>），輸出正規化更新矩陣{' '}
          <Tex>{String.raw`\mathbf M_n=K_q\mathbf M`}</Tex>；差異只在標了 <code>← 差異</code> 的那一行。實體更新矩陣是 <Tex>{String.raw`\mathbf M=\mathbf M_n/K_q`}</Tex>（fs），由共用的{' '}
          <code>blockUpdate</code> 處理（勘誤 E05 / E08：<Tex>{'K_q'}</Tex> 只在這裡出現一次）。
        </p>
        <Fig id="code-flow">
          先看從 <Tex>{String.raw`\hat{\mathbf J}_n`}</Tex> 出發的那一路：每個規則函式吃進正規化的 Jacobian 估計，吐出正規化更新矩陣 <Tex>{String.raw`\mathbf M_n`}</Tex>——六個函式只差在這一步（藍色）。再看從{' '}
          <Tex>{String.raw`\boldsymbol\delta_k`}</Tex> 出發的那一路：<code>gmacLinear</code>（線性模型）或 <code>gmacSample</code>（逐 sample 的 1-bit comparator）算出 <Tex>{String.raw`\mathbf G_k`}</Tex>。兩路在{' '}
          <code>blockUpdate</code> 會合：它把 <Tex>{String.raw`\mathbf M_n`}</Tex> 除以 <Tex>{'K_q'}</Tex> 之後更新 <Tex>{String.raw`\boldsymbol\delta`}</Tex>，最右邊的 <Tex>{String.raw`\boldsymbol\delta_{k+1}`}</Tex> 就是下一個 block 的輸入。圖上的 <code>blockUpdate</code> 就是 F-10.2 取平均之前的式子{' '}
          <Tex>{String.raw`\boldsymbol\delta_{k+1}=\boldsymbol\delta_k-\mathbf M\mathbf G_k`}</Tex>（<Tex>{String.raw`\mathbf M=\mathbf M_n/K_q`}</Tex>）；圖上的 <Tex>{String.raw`\mathbf C`}</Tex> 是 §10.5 的交叉相關矩陣，匹配模型時等於{' '}
          <Tex>{String.raw`\mathbf R`}</Tex>。
        </Fig>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>規則</th>
                <th>函式</th>
                <th>
                  正規化更新矩陣 <Tex>{String.raw`\mathbf M_n=K_q\mathbf M`}</Tex>
                </th>
                <th>
                  poles（<Tex>{String.raw`\hat{\mathbf J}=\mathbf J`}</Tex>、匹配模型 <Tex>{String.raw`\mathbf J_n=-\mathbf R`}</Tex>）
                </th>
              </tr>
            </thead>
            <tbody>
              {CODE_MATH.map((row) => (
                <tr key={row.fn + row.rule}>
                  <td>{row.rule}</td>
                  <td>
                    <code>{row.fn}</code>
                  </td>
                  <td>
                    <Tex>{row.Mn}</Tex>
                  </td>
                  <td>{row.poles}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <CodeCompare
          layout="tabs"
          items={[
            {
              label: 'Scalar',
              source: mimoSrc,
              region: 'mScalar',
              path: PATH,
              note: String.raw`$\mathbf M_n=\mu K_q\mathbf I$：所有方向共用同一個步長，完全不看 Jacobian；慢模式的 pole $1-\mu K_q\lambda_{\min}$ 由最小的 eigenvalue 決定。`,
            },
            {
              label: 'Diagonal',
              source: mimoSrc,
              region: 'mDiagonal',
              path: PATH,
              note: String.raw`$M_{n,ii}=-\gamma/\hat J_{n,ii}$：只用 Jacobian 估計的對角線，每個 loop 單獨調成 pole $1-\gamma$，但看不到耦合（T18 會發散）。`,
            },
            {
              label: 'NLMS',
              source: mimoSrc,
              region: 'mNlms',
              path: PATH,
              note: String.raw`$\mathbf M_n=\tilde\mu\,\mathbf I/\operatorname{tr}\hat{\mathbf R}_x$：除以 regressor 的平均總能量，只修正總能量；poles $1-\tilde\mu\lambda_i/\operatorname{tr}\mathbf R$ 仍然正比於各自的 eigenvalue。`,
            },
            {
              label: 'Full inverse',
              source: mimoSrc,
              region: 'mFull',
              path: PATH,
              note: String.raw`$\mathbf M_n=-\gamma\hat{\mathbf J}_n^{-1}$：乘上 Jacobian 估計的反矩陣，$\hat{\mathbf J}=\mathbf J$ 時所有 pole $=1-\gamma$；雜訊沿慢方向被放大 $1/\lambda_{\min}$。`,
            },
            {
              label: 'Regularized',
              source: mimoSrc,
              region: 'mRegularized',
              path: PATH,
              note: String.raw`R 形式 $\gamma(\hat{\mathbf R}+\lambda_{\mathrm{reg}}\mathbf I)^{-1}$ 或 J 形式 $-\gamma(\hat{\mathbf J}_n^T\hat{\mathbf J}_n+\lambda_{\mathrm{reg}}\mathbf I)^{-1}\hat{\mathbf J}_n^T$（Tikhonov pseudoinverse），兩行差異各對應一種形式；$\lambda_{\mathrm{reg}}$ 換取雜訊與 robustness。`,
            },
            {
              label: 'Sequential',
              source: mimoSrc,
              region: 'mSequential',
              path: PATH,
              note: String.raw`時變的更新矩陣 $\mathbf M_n(k)$：一次只開一個 loop（第 $i$ 列只有 $M_{n,ii}=-\gamma/\hat J_{n,ii}$），其他列為 0（凍結）。`,
            },
          ]}
          caption={String.raw`所有規則共用同一個 blockUpdate（下方）；差別只在正規化更新矩陣 $\mathbf M_n=K_q\mathbf M$ 怎麼來（數學對照見上表）。`}
        />
        <CodeBlock source={mimoSrc} region="blockUpdate" path={PATH} title={String.raw`共用：一個 block 的更新 $\boldsymbol\delta_{k+1}=\boldsymbol\delta_k-(\mathbf M_n/K_q)\,\mathbf G_k$（所有規則都呼叫它）`} />
        <div className="grid-2">
          <CodeBlock source={mimoSrc} region="gmacLinear" path={PATH} title={String.raw`線性化 GMAC：$\mathbf G_k=K_q\mathbf C\boldsymbol\delta_k+\boldsymbol\eta_k$（公式成立的模型）`} />
          <CodeBlock source={mimoSrc} region="gmacSample" path={PATH} title={String.raw`逐 sample 1-bit GMAC：$\mathbf G_k=\frac1N\sum_n q[n]\,\mathbf x[n]$（真正的 Sign-LMS）`} />
        </div>
        <ModeGate min="engineer">
          <div className="grid-2">
            <CodeBlock source={mimoSrc} region="centralDiffJacobian" path={PATH} title={String.raw`§10.2 中央差分量測 Jacobian：$\hat J_{ij}=\big[G_i(\mathbf w+\Delta\mathbf e_j)-G_i(\mathbf w-\Delta\mathbf e_j)\big]/(2\Delta)$`} />
            <CodeBlock source={mimoSrc} region="lyapunov" path={PATH} title={String.raw`穩態共變異：離散 Lyapunov $\mathbf X=\mathbf A\mathbf X\mathbf A^T+\mathbf Q$（F-10.15）`} />
          </div>
        </ModeGate>
        <ModeGate min="research">
          <CodeBlock source={mimoSrc} region="signGmacMean" path={PATH} title={String.raw`精確 sign-GMAC 平均 $E[\mathbf x\operatorname{sign}(\mathbf u^T\boldsymbol\delta+v)]$（Bussgang／$\pm1$ 碼列舉，F-10.13）`} />
        </ModeGate>
        <ModeGate min="engineer">
          <h3 className="ch10-sub">Python golden 等價版本（NumPy）</h3>
          <p>
            獨立的 NumPy 實作（<code>{PY_PATH}</code>）產生 T10 / T11 / T18 與 <code>preconditioner_variance</code> 的 golden vectors；Vitest 讀這些 JSON 與上面的 TypeScript 交叉比對（
            <code>mimo.test.ts</code>）。對照：<code>preconditioner_ideal</code> ↔ <code>mFull</code>、<code>regularized_update_matrix</code> ↔ <code>mRegularized</code>（J 形式）、
            <code>jacobian_loop_matrix</code> ↔ <Tex>{String.raw`\mathbf I+\mathbf M\mathbf J`}</Tex>、<code>finite_difference_jacobian</code> ↔ <code>centralDiffJacobian</code>。
          </p>
          <CodeBlock source={goldenSection10(mimoPy)} lang="python" path={PY_PATH} title="mimo.py：§10 Preconditioner 與 §10.2 Jacobian（golden model）" />
          <p className="small muted">
            兩個讀碼提醒：(1) Python 以實體單位直接寫 <Tex>{String.raw`\mathbf M=\gamma(K_q\mathbf R)^{-1}`}</Tex>，TypeScript 則先算無因次的{' '}
            <Tex>{String.raw`\mathbf M_n`}</Tex> 再由 <code>blockUpdate</code> 除以 <Tex>{'K_q'}</Tex>，兩者相同。(2) golden 的 docstring 沿用規格原文的{' '}
            <Tex>{String.raw`\operatorname{Var}(\delta_i)`}</Tex> 與 <Tex>{String.raw`\lambda`}</Tex>：前者指第 i 個 eigen-mode 的 <Tex>{String.raw`\operatorname{Var}(\xi_i)`}</Tex>
            <Erratum id="E37" />，後者的參數 <code>lam</code> 就是本章的 <Tex>{String.raw`\lambda_{\mathrm{reg}}`}</Tex>
            <Erratum id="E22" />。
          </p>
        </ModeGate>
      </Section>
    </>
  )
}
