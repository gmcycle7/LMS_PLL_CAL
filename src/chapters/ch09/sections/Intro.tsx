import { useMemo } from 'react'
import { Callout, ClaimTag, CodeBlock, Section, SourceTag, SymbolTable, Tex, TexBlock, type SymbolEntry } from '@/components'
import peSrc from '@/simulation/models/pe.ts?raw'
import { lmsHandSteps, type HandStepRow } from '@/simulation/models/pe'
import { Erratum, HandCalcBox, m, num, texNum } from '../shared'

const SYMBOLS: SymbolEntry[] = [
  {
    symbol: String.raw`\mathbf u[n]`,
    meaning: <>有效 regressor 向量（{m`M`} 個參數各自的 regressor，經 PLL error path 到 PD）</>,
    unit: String.raw`\text{無因次 code}`,
    firstSeen: '§9',
    note: (
      <>
        全站 §0：{m`u=h*x`}。§9.2 另用 {m`\tilde{\mathbf x}`} 表示含常數 1 的原始 one-hot regressor
      </>
    ),
  },
  { symbol: String.raw`\mathbf a,\ \mathbf w_k`, meaning: <>真實參數／第 {m`k`} 個 GMAC block 使用的校正係數</>, unit: String.raw`\text{依校正對象（例如 fs）}`, firstSeen: '§9' },
  {
    symbol: String.raw`\boldsymbol\delta_k=\mathbf a-\mathbf w_k`,
    meaning: '參數誤差向量',
    unit: String.raw`\text{同 }\mathbf a`,
    firstSeen: '§9',
    note: <>極性採全站約定 {m`\delta=a-w`}（<Erratum id="E32" />）</>,
  },
  { symbol: String.raw`e[n],\ v[n]`, meaning: 'comparator 前的誤差、雜訊', unit: String.raw`\mathrm{fs}`, firstSeen: '§9' },
  { symbol: String.raw`t[n]`, meaning: <>GMAC 的乘數：linear 時 {m`t=e`}，1-bit 時 {m`t=\mathrm{sign}(e)`}</>, unit: String.raw`\mathrm{fs}\text{ 或 }\pm1`, firstSeen: '§9' },
  { symbol: String.raw`\mathbf G_k`, meaning: <>GMAC 第 {m`k`} 個 block 的平均相關輸出</>, unit: String.raw`\text{同 }t\cdot u`, firstSeen: '§9', note: <>全站 §0：{m`\mathbf G`} 為平均；硬體若用總和要再除以 {m`N`}</> },
  { symbol: String.raw`\mathbf R=E[\mathbf u\mathbf u^T]`, meaning: 'regressor 自相關矩陣（對稱、半正定）', unit: String.raw`\text{無因次}`, firstSeen: '§9' },
  { symbol: String.raw`\rho`, meaning: '兩個 regressor 的相關係數', unit: String.raw`-1\le\rho\le1`, firstSeen: '§9 例子' },
  {
    symbol: String.raw`\lambda_i,\ \mathbf v_i`,
    meaning: <>{m`\mathbf R`} 的第 {m`i`} 個 eigenvalue／單位 eigenvector（由大到小）</>,
    unit: String.raw`\text{無因次}`,
    firstSeen: '§9',
    note: <>{m`\lambda`} 只代表 eigenvalue；正則化參數另用 {m`\varepsilon`}（<Erratum id="E22" />）</>,
  },
  { symbol: String.raw`\mathbf Q,\ \boldsymbol\Lambda`, meaning: <>eigenvector 矩陣（欄為 {m`\mathbf v_i`}）、eigenvalue 對角矩陣：{m`\mathbf R=\mathbf Q\boldsymbol\Lambda\mathbf Q^T`}</>, firstSeen: '§9' },
  { symbol: String.raw`c_{i,k}`, meaning: <>模態座標 {m`\mathbf c_k=\mathbf Q^TE[\boldsymbol\delta_k]`}（誤差在第 {m`i`} 個 eigenvector 上的分量）</>, unit: String.raw`\text{同 }\mathbf a`, firstSeen: '§9' },
  { symbol: String.raw`\kappa`, meaning: <>condition number {m`\lambda_{\max}/\lambda_{\min}`}（eigenvalue spread）</>, unit: String.raw`\ge1`, firstSeen: '§9' },
  { symbol: String.raw`\mu`, meaning: 'learning rate（更新步長）', unit: String.raw`\text{linear: 無因次；1-bit: }\mathrm{fs}`, firstSeen: '§9' },
  {
    symbol: 'K_q',
    meaning: (
      <>
        1-bit comparator 的統計小訊號增益 {m`\sqrt{2/\pi}/\sigma_v`}；linear detector 時 {m`K_q\equiv1`}
      </>
    ),
    unit: String.raw`\mathrm{fs}^{-1}`,
    firstSeen: '§9',
    note: <>規格 §9 的 {m`\mathbf I-\mu\mathbf R`} 隱含 {m`K_q=1`}；本章一律明寫（<Erratum id="E05" />、<Erratum id="E08" />）</>,
  },
  { symbol: String.raw`g=\mu K_q`, meaning: <>無因次 loop gain（正規化後的「{m`\mu`}」）</>, unit: String.raw`\text{無因次}`, firstSeen: '§9' },
  { symbol: 'p_i=1-g\\lambda_i', meaning: <>第 {m`i`} 個 eigen-mode 的平均 pole</>, unit: String.raw`\text{無因次}`, firstSeen: '§9' },
  { symbol: 'k_{95}', meaning: '某模式衰減到 5% 所需的 block 數', unit: String.raw`\text{blocks}`, firstSeen: '§9' },
  { symbol: 'N,\\ N_0', meaning: 'GMAC block 長度／PE 窗口長度', unit: String.raw`\text{samples}`, firstSeen: '§9、§9.1', note: <>兩者不同：{m`N`} 決定雜訊平均，{m`N_0`} 是檢查 PE 的窗口</> },
  { symbol: String.raw`\mathbf R_k,\ \mathbf U_k`, meaning: <>滑動窗口相關矩陣、{m`N_0\times M`} 資料矩陣</>, firstSeen: '§9.1' },
  { symbol: String.raw`\alpha,\ \beta`, meaning: 'PE 定義的下界／上界（窗口能量）', unit: String.raw`\text{同 }\textstyle\sum uu^T`, firstSeen: '§9.1' },
  { symbol: String.raw`\sigma_i(\mathbf A)`, meaning: <>singular value {m`=\sqrt{\lambda_i(\mathbf A^T\mathbf A)}`}</>, firstSeen: '§9.1' },
  { symbol: String.raw`\mathbf P_k=E[\boldsymbol\delta_k\boldsymbol\delta_k^T]`, meaning: <>誤差的二階動差矩陣（mean-square）；其遞迴的 spectral radius 記為 {m`\rho_{\mathrm{MS}}`}</>, firstSeen: '§9（E23）' },
  { symbol: String.raw`\tilde{\mathbf x}[n]=(1,x_0,\dots,x_3)`, meaning: <>global offset {m`b`} 的 regressor（常數 1）＋四相 one-hot regressor</>, unit: String.raw`\{0,1\}`, firstSeen: '§9.2' },
  {
    symbol: String.raw`b,\ a_i`,
    meaning: <>所有相位共用的 global offset（規格 §9.2 的 GOS）、第 {m`i`} 相的 phase offset（PHOS）</>,
    unit: String.raw`\mathrm{fs}`,
    firstSeen: '§9.2',
    note: <>若你的架構把 GOS／PHOS 這些縮寫用在別的量，請用 regressor 的結構來對應：{m`b\leftrightarrow`} 常數 1，{m`a_i\leftrightarrow`} one-hot</>,
  },
  { symbol: String.raw`\mathbf n`, meaning: <>gauge null vector {m`(1,-1,-1,-1,-1)`}</>, firstSeen: '§9.2' },
  {
    symbol: 'P',
    meaning: <>one-hot 的相數（本章與實驗室取 {m`P=4`}）</>,
    unit: String.raw`\text{整數}`,
    firstSeen: '§9.2',
    note: <>細體 {m`P`}（相數）與粗體 {m`\mathbf P_k`}（二階動差矩陣）是不同的量</>,
  },
  {
    symbol: String.raw`H_{\mathrm{PD}}(z),\ h[n]`,
    meaning: <>DTC 誤差 → PD 的轉移函數與 impulse response；type-I/II PLL 有 {m`H_{\mathrm{PD}}(1)=0`}</>,
    firstSeen: '§9.2',
    note: <>u-domain：{m`\tilde{\mathbf u}=h*\tilde{\mathbf x}`}（<Erratum id="E04" />）</>,
  },
  {
    symbol: String.raw`s[n],\ S`,
    meaning: <>{m`H_{\mathrm{PD}}`} 的 step response {m`s[n]=\sum_{m\le n}h[m]`} 及其總和 {m`S=\sum_ns[n]`}（type-II 為 0）</>,
    firstSeen: '§9.2',
    note: <>只用在 {m`w_b`} 漂移的估計（F-09.19）</>,
  },
  { symbol: 'n,\\ k,\\ K', meaning: <>時間索引：{m`n`} = comparator sample，{m`k`} = GMAC block；{m`K`} = 已經跑過的 block 數</>, firstSeen: '全站 §0' },
]

const A_TRUE: [number, number] = [3, 1]

function HandTable({ rows, note }: { rows: HandStepRow[]; note?: string }) {
  return (
    <div className="table-wrap">
      <table className="ch09-table">
        <thead>
          <tr>
            <th>
              <Tex>k</Tex>
            </th>
            <th>
              <Tex>{String.raw`\mathbf u_k`}</Tex>
            </th>
            <th>
              <Tex>{String.raw`\mathbf w_k`}</Tex>
            </th>
            <th>
              <Tex>{String.raw`e_k=\mathbf u_k^T(\mathbf a-\mathbf w_k)`}</Tex>
            </th>
            <th>
              <Tex>{String.raw`\Delta\mathbf w=\mu e_k\mathbf u_k`}</Tex>
            </th>
            <th>
              <Tex>{String.raw`\mathbf w_{k+1}`}</Tex>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.k}>
              <td>{r.k}</td>
              <td className="nowrap">({r.u.join(', ')})</td>
              <td className="nowrap">
                ({num(r.w[0])}, {num(r.w[1])})
              </td>
              <td>{num(r.e)}</td>
              <td className="nowrap">
                ({num(r.dw[0])}, {num(r.dw[1])})
              </td>
              <td className="nowrap">
                ({num(r.wNext[0])}, {num(r.wNext[1])})
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {note && <p className="ch09-note">{note}</p>}
    </div>
  )
}

export function Intro() {
  const same = useMemo(() => lmsHandSteps({ a: A_TRUE, w0: [0, 0], mu: 0.25, us: Array.from({ length: 6 }, () => [1, 1] as [number, number]) }), [])
  const sameLong = useMemo(() => lmsHandSteps({ a: A_TRUE, w0: [0, 0], mu: 0.25, us: Array.from({ length: 60 }, () => [1, 1] as [number, number]) }), [])
  const alt = useMemo(
    () =>
      lmsHandSteps({
        a: A_TRUE,
        w0: [0, 0],
        mu: 0.25,
        us: Array.from({ length: 6 }, (_, k) => (k % 2 === 0 ? [1, 1] : [1, -1]) as [number, number]),
      }),
    [],
  )
  const altLong = useMemo(
    () =>
      lmsHandSteps({
        a: A_TRUE,
        w0: [0, 0],
        mu: 0.25,
        us: Array.from({ length: 60 }, (_, k) => (k % 2 === 0 ? [1, 1] : [1, -1]) as [number, number]),
      }),
    [],
  )
  const wInf = sameLong[sameLong.length - 1].wNext
  const wAlt = altLong[altLong.length - 1].wNext

  return (
    <>
      <p className="ch09-lead">
        前面幾章把 LMS 當成「一個旋鈕、一個誤差」：只要更新方向對、loop gain 在範圍內，誤差就會收斂。但真實的
        DTC / PLL 校正幾乎都是<strong>好幾個旋鈕同時調</strong>：多段 DTC gain、INL 係數、多相位 PMUX 的 phase offset（PHOS）、
        global offset……這一課要回答一個看似簡單、其實很深的問題：
      </p>
      <Callout kind="info" title="這一課要回答的問題">
        迴路<strong>穩定</strong>了、GMAC 也<strong>歸零</strong>了，每個參數就一定學對了嗎？答案是：不一定。
        要「學得到」每個參數，輸入必須在<strong>每一個參數方向</strong>上都持續提供能量——這叫{' '}
        <strong>Persistent Excitation（PE，持續激發）</strong>。
      </Callout>

      <SymbolTable
        rows={SYMBOLS}
        caption={
          <>
            本章所有平均遞迴都明寫 {m`K_q`}（<Erratum id="E05" />、<Erratum id="E08" />）；598 blocks 這類數字是 <strong>mean</strong> 的敘述（
            <Erratum id="E23" />）；§9.2 的 DC-null 版本採修正文字（<Erratum id="E04" />）；{m`\lambda`} 只代表 eigenvalue（
            <Erratum id="E22" />）。
          </>
        }
      />

      <Section kind="intuition" title="一個黑盒子：兩個旋鈕總是一起動" level={2} id="ch09-intro">
        <p>
          想像一個黑盒子有兩個未知參數 {m`\mathbf a=(a_1,a_2)`}。你每次輸入一組 regressor {m`\mathbf u=(u_1,u_2)`}，只能看到
          誤差 {m`e=u_1(a_1-w_1)+u_2(a_2-w_2)`}。如果<strong>每一次</strong> {m`u_1=u_2`}（兩個旋鈕總是被同一個 code 一起推），
          你永遠只看得到 {m`(a_1-w_1)+(a_2-w_2)`}，也就是<strong>和</strong>；至於「差」是多少，資料裡根本沒有。
        </p>
        <p>
          在 PLL 裡這很常見：兩段 DTC gain 被高度相關的 DSM code 驅動、四個 PMUX phase 加上一個所有相位共用的 offset……
          迴路照樣穩定、GMAC 照樣歸零，但參數可能停在<strong>錯的地方</strong>。
        </p>
      </Section>

      <Section kind="example" title={<>先算一次：{m`\mathbf u`} 永遠是 {m`(1,1)`}</>} level={3}>
        <p>
          設 {m`\mathbf a=(3,1)`}、{m`\mathbf w_0=(0,0)`}、{m`\mu=0.25`}、無雜訊，每一步 {m`\mathbf u=(1,1)`}。conventional LMS：
          {m`\mathbf w\leftarrow\mathbf w+\mu e\,\mathbf u`}。下表每一列都由 <code>lmsHandSteps()</code> 算出：
        </p>
        <HandTable rows={same} />
        <p>
          第 0 步：{m`e_0=1\cdot(3-0)+1\cdot(1-0)=4`}，{m`\Delta\mathbf w=0.25\cdot4\cdot(1,1)=(1,1)`}。第 1 步：
          {m`e_1=(3-1)+(1-1)=2`}，{m`\Delta\mathbf w=(0.5,0.5)`}……每一步誤差減半（因為 {m`\mu\|\mathbf u\|^2=0.25\cdot2=0.5`}）。
          60 步後 {m`\mathbf w=(${texNum(wInf[0], 6)},\ ${texNum(wInf[1], 6)})`}：
        </p>
        <TexBlock>{String.raw`\mathbf w_\infty=(2,\,2),\qquad e_\infty=(3-2)+(1-2)=0,\qquad \boldsymbol\delta_\infty=\mathbf a-\mathbf w_\infty=(1,\,-1)`}</TexBlock>
        <p>
          <strong>誤差歸零，但兩個參數都錯</strong>（{m`w_1=2`} vs {m`a_1=3`}、{m`w_2=2`} vs {m`a_2=1`}）。殘留的誤差 {m`(1,-1)`} 正好是 {m`\mathbf u=(1,1)`}「看不見」的方向：
          {m`(1,1)\cdot(1,-1)=0`}。這就是本章後面會叫做「{m`\lambda_{\min}=0`} 的 eigenvector」的方向。 <ClaimTag kind="exact" /> <SourceTag />
        </p>
      </Section>

      <Section kind="example" title={<>再算一次：{m`\mathbf u`} 在 {m`(1,1)`} 與 {m`(1,-1)`} 之間交替</>} level={3}>
        <HandTable rows={alt} />
        <p>
          這次第 1 步的 regressor {m`(1,-1)`} 恰好照到「差」的方向，所以兩個方向都被推到；60 步後
          {m`\mathbf w=(${texNum(wAlt[0], 6)},\ ${texNum(wAlt[1], 6)})`}，收斂到真值 {m`(3,1)`}。差別不在演算法、不在 {m`\mu`}，
          而在 <strong>輸入有沒有激發每一個方向</strong>。
        </p>
        <HandCalcBox id="HC-09.1">
          把 {m`\mathbf a`} 和 {m`\mu`} 換成你自己的數字，先用紙筆算兩步（每一步只有乘法和加減法）。{m`s=1`} 對照第一張表的前兩列，
          再把 {m`s`} 改成 {m`-1`} 對照這張表——看「差」{m`\delta_1-\delta_2`} 什麼時候才動得了。
        </HandCalcBox>
        <Callout kind="ok" title="本課主線">
          LMS 的收斂速度由 {m`\mathbf R=E[\mathbf u\mathbf u^T]`} 的 eigenvalues 決定：最大的 {m`\lambda_{\max}`} 限制 {m`\mu`}（穩定），
          最小的 {m`\lambda_{\min}`} 決定最慢的模式；{m`\lambda_{\min}=0`} 的方向完全學不到。
        </Callout>
        <CodeBlock source={peSrc} region="handSteps" path="src/simulation/models/pe.ts" caption="上面兩張表就是由這段程式碼算出（無雜訊、逐筆更新）。" />
      </Section>
    </>
  )
}
