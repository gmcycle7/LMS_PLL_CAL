import { SymbolTable, type SymbolEntry, ChRef } from '@/components'
import { Erratum, m } from '../shared'

/**
 * 本章符號表（docs/teaching-style.md §5：放在章末、「本課必記」之後，外層 id="symbols"）。
 * 章首只留一行 <SymbolsLink />；每個符號第一次出現時，正文會就地用一句話說明，這張表是查閱用的總整理。
 */
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
  { symbol: 'M', meaning: <>同時校正的參數個數（開場與 §9 的例子 {m`M=2`}；§9.2 的四相＋global offset {m`M=5`}）</>, unit: String.raw`\text{整數}`, firstSeen: '§9', note: <>粗體 {m`\mathbf M`}（例如 {m`\mathbf M=\mu\mathbf I`}）是<ChRef ch="10">第 10 章</ChRef>的步長矩陣，不是個數</> },
  { symbol: String.raw`\mathbf a,\ \mathbf w_k`, meaning: <>真實參數／第 {m`k`} 個 GMAC block 使用的校正係數</>, unit: String.raw`\text{依校正對象（例如 fs）}`, firstSeen: '§9' },
  {
    symbol: String.raw`\boldsymbol\delta_k=\mathbf a-\mathbf w_k`,
    meaning: '參數誤差向量',
    unit: String.raw`\text{同 }\mathbf a`,
    firstSeen: '§9',
    note: <>極性採全站約定 {m`\delta=a-w`}（<Erratum id="E32" />）</>,
  },
  {
    symbol: String.raw`e[n],\ v[n]`,
    meaning: <>PD 的輸出（comparator 前的誤差，也是送進 loop filter 的同一個訊號）、comparator 前的雜訊</>,
    unit: String.raw`\mathrm{fs}`,
    firstSeen: '§9',
    note: <>{m`e[n]=t_{\mathrm{ref}}'[n]-t_{\mathrm{fb}}[n]=(a-w)\,x[n]+v[n]`}；§9.2 的 PD 輸出記為 {m`e_{\mathrm{PD}}[n]`}</>,
  },
  {
    symbol: String.raw`t_{\mathrm{ref}}'[n],\ t_{\mathrm{fb}}[n]`,
    meaning: <>（DTC 延遲後的）reference edge 與 feedback（divider）edge 的時間；PD 量的是兩者之差</>,
    unit: String.raw`\mathrm{fs}`,
    firstSeen: '§9',
    note: <>補償不足（{m`w<a`}）時 reference 還是太晚，{m`e`} 為正</>,
  },
  {
    symbol: String.raw`T_0,\ \tau_{\mathrm{DTC}}[n]`,
    meaning: <>reference 端 DTC 的基準延遲／第 {m`n`} 個 sample 的延遲 {m`\tau_{\mathrm{DTC}}=T_0-w\,x[n]`}；{m`w\,x[n]`} 是補償量（reference edge 被提前——也就是少延遲——的時間）</>,
    unit: String.raw`\mathrm{fs}`,
    firstSeen: '§9',
    note: <>DTC 只能延遲、不能提前，所以從 {m`T_0`} 往回扣；{m`T_0`} 是常數，被 PLL 當成靜態相位偏移吸收</>,
  },
  { symbol: String.raw`t[n]`, meaning: <>GMAC 的乘數：linear 時 {m`t=e`}，1-bit 時 {m`t=\mathrm{sign}(e)`}</>, unit: String.raw`\mathrm{fs}\text{ 或 }\pm1`, firstSeen: '§9' },
  { symbol: String.raw`\mathbf G_k`, meaning: <>GMAC 第 {m`k`} 個 block 的平均相關輸出</>, unit: String.raw`\text{同 }t\cdot u`, firstSeen: '§9', note: <>全站 §0：{m`\mathbf G`} 為平均；硬體若用總和要再除以 {m`N`}</> },
  { symbol: String.raw`\mathbf R=E[\mathbf u\mathbf u^T]`, meaning: 'regressor 自相關矩陣（對稱、半正定）', unit: String.raw`\text{無因次}`, firstSeen: '§9' },
  {
    symbol: String.raw`\rho`,
    meaning: '兩個 regressor 的相關係數',
    unit: String.raw`-1\le\rho\le1`,
    firstSeen: '§9 例子',
    note: <>不扣平均：{m`\rho=E[u_1u_2]/\sqrt{E[u_1^2]\,E[u_2^2]}`}。{m`\rho=0`} 是正交（{m`E[u_1u_2]=0`}）；其中一個 regressor 的平均為 0 時也就是不相關</>,
  },
  {
    symbol: String.raw`\lambda_i,\ \mathbf v_i`,
    meaning: <>{m`\mathbf R`} 的第 {m`i`} 個 eigenvalue／單位 eigenvector（由大到小）</>,
    unit: String.raw`\text{無因次}`,
    firstSeen: '§9',
    note: (
      <>
        {m`\lambda`} 只代表 eigenvalue；正則化參數另用 {m`\varepsilon`}（<Erratum id="E22" />）。F-09.5 的 {m`\lambda_{1,2}=1\pm\rho`} 固定配共模／差模：
        {m`\rho\ge0`} 時就是由大到小，{m`\rho<0`} 時 {m`\lambda_{\max}=\lambda_2`}
      </>
    ),
  },
  { symbol: String.raw`\mathbf Q,\ \boldsymbol\Lambda`, meaning: <>eigenvector 矩陣（欄為 {m`\mathbf v_i`}）、eigenvalue 對角矩陣：{m`\mathbf R=\mathbf Q\boldsymbol\Lambda\mathbf Q^T`}</>, firstSeen: '§9' },
  { symbol: String.raw`c_{i,k}`, meaning: <>模態座標 {m`\mathbf c_k=\mathbf Q^TE[\boldsymbol\delta_k]`}（誤差在第 {m`i`} 個 eigenvector 上的分量）</>, unit: String.raw`\text{同 }\mathbf a`, firstSeen: '§9' },
  { symbol: String.raw`\kappa`, meaning: <>condition number {m`\lambda_{\max}/\lambda_{\min}`}（eigenvalue spread）</>, unit: String.raw`\ge1`, firstSeen: '§9' },
  { symbol: String.raw`\mu`, meaning: 'learning rate（更新步長）', unit: String.raw`\text{linear: 無因次；1-bit: }\mathrm{fs}`, firstSeen: '§9' },
  {
    symbol: 'K_q',
    meaning: (
      <>
        1-bit comparator 的統計小訊號增益 {m`\sqrt{2/\pi}/\sigma_v`}（{m`\sigma_v`}：comparator 前雜訊 {m`v`} 的標準差）；linear detector 時 {m`K_q\equiv1`}
      </>
    ),
    unit: String.raw`\mathrm{fs}^{-1}`,
    firstSeen: '§9',
    note: <>規格 §9 的 {m`\mathbf I-\mu\mathbf R`} 隱含 {m`K_q=1`}；本章一律明寫（<Erratum id="E05" />、<Erratum id="E08" />）</>,
  },
  { symbol: String.raw`g=\mu K_q`, meaning: <>無因次 loop gain（正規化後的「{m`\mu`}」）</>, unit: String.raw`\text{無因次}`, firstSeen: '§9' },
  {
    symbol: String.raw`s_\delta`,
    meaning: (
      <>
        comparator 輸入端由參數誤差造成的訊號（{m`\mathbf u^T\boldsymbol\delta`} 的 RMS）與雜訊的比：{m`s_\delta=\sqrt{\boldsymbol\delta^T\mathbf R\boldsymbol\delta}/\sigma_v`}；1-bit 的小訊號條件就是 {m`s_\delta\ll1`}
      </>
    ),
    unit: String.raw`\text{無因次}`,
    firstSeen: '§9（F-09.3）',
    note: (
      <>
        只有 1-bit 需要；Gaussian {m`\mathbf u`} 時有效增益是 {m`K_q/\sqrt{1+s_\delta^2}`}（F-09.16）。和 {m`\pm1`} code 的符號 {m`s`}、§9.2 的 {m`s[n]`} 是不同的量
      </>
    ),
  },
  { symbol: 'p_i=1-g\\lambda_i', meaning: <>第 {m`i`} 個 eigen-mode 的平均 pole</>, unit: String.raw`\text{無因次}`, firstSeen: '§9' },
  { symbol: 'k_{95}', meaning: '某模式衰減到 5% 所需的 block 數', unit: String.raw`\text{blocks}`, firstSeen: '§9' },
  { symbol: 'N,\\ N_0', meaning: 'GMAC block 長度／PE 窗口長度', unit: String.raw`\text{samples}`, firstSeen: '§9、§9.1', note: <>兩者不同：{m`N`} 決定雜訊平均，{m`N_0`} 是檢查 PE 的窗口</> },
  {
    symbol: String.raw`\mathbf S_k,\ \mathbf R_k,\ \mathbf U_k`,
    meaning: <>窗口能量矩陣 {m`\sum_n\mathbf u[n]\mathbf u^T[n]`}、滑動窗口相關矩陣 {m`\mathbf S_k/N_0`}、{m`N_0\times M`} 資料矩陣</>,
    firstSeen: '§9.1',
    note: <>這裡的下標 {m`k`} 是窗口的起點（sample index）</>,
  },
  {
    symbol: String.raw`N_{+},\ N_{-}`,
    meaning: <>{m`\pm1`} sparse-flip code 的一個窗口內，{m`s=+1`}、{m`s=-1`} 的個數（{m`N_{+}+N_{-}=N_0`}）</>,
    unit: String.raw`\text{整數}`,
    firstSeen: '§9.1',
    note: <>只用在 F-09.11 的圖與說明：{m`\lambda_{\min}(\mathbf S_k)=2\min(N_{+},N_{-})`}</>,
  },
  { symbol: String.raw`\alpha,\ \beta`, meaning: 'PE 定義的下界／上界（窗口能量）', unit: String.raw`\text{同 }\textstyle\sum uu^T`, firstSeen: '§9.1' },
  { symbol: String.raw`\sigma_i(\mathbf A)`, meaning: <>singular value {m`=\sqrt{\lambda_i(\mathbf A^T\mathbf A)}`}</>, firstSeen: '§9.1' },
  {
    symbol: 's',
    meaning: <>{m`\pm1`} sparse-flip code 的符號：{m`u_2=s\,u_1`}，{m`P(s=+1)=(1+\rho)/2`}，各 sample 獨立</>,
    unit: String.raw`\pm1`,
    firstSeen: '§9（E23）',
    note: <>§9.2 的 {m`s[n]`}（step response）是另一個量</>,
  },
  { symbol: String.raw`\mathbf P_k=E[\boldsymbol\delta_k\boldsymbol\delta_k^T]`, meaning: <>誤差的二階動差矩陣（mean-square）；其遞迴的 spectral radius 記為 {m`\rho_{\mathrm{MS}}`}</>, firstSeen: '§9（E23）' },
  { symbol: String.raw`\tilde{\mathbf x}[n]=(1,x_0,\dots,x_3)`, meaning: <>global offset {m`b`} 的 regressor（常數 1）＋四相 one-hot regressor</>, unit: String.raw`\{0,1\}`, firstSeen: '§9.2' },
  {
    symbol: String.raw`b,\ a_i`,
    meaning: <>所有相位共用的 global offset（規格 §9.2 的 GOS）、第 {m`i`} 相的 phase offset（PHOS）</>,
    unit: String.raw`\mathrm{fs}`,
    firstSeen: '§9.2',
    note: <>若你的架構把 GOS／PHOS 這些縮寫用在別的量，請用 regressor 的結構來對應：{m`b\leftrightarrow`} 常數 1，{m`a_i\leftrightarrow`} one-hot</>,
  },
  { symbol: String.raw`\boldsymbol\theta=(b,a_0,\dots,a_3)`, meaning: <>§9.2 的參數向量（真值）；{m`y=\tilde{\mathbf x}^T\boldsymbol\theta`}，校正係數仍記為 {m`\mathbf w`}</>, unit: String.raw`\mathrm{fs}`, firstSeen: '§9.2' },
  { symbol: String.raw`\mathbf n`, meaning: <>gauge null vector {m`(1,-1,-1,-1,-1)`}</>, firstSeen: '§9.2', note: <>粗體 {m`\mathbf n`}（向量）與細體 {m`n`}（sample index）不同</> },
  {
    symbol: 'P',
    meaning: <>one-hot 的相數（本章與實驗室取 {m`P=4`}）</>,
    unit: String.raw`\text{整數}`,
    firstSeen: '§9.2',
    note: <>細體 {m`P`}（相數）與粗體 {m`\mathbf P_k`}（二階動差矩陣）是不同的量</>,
  },
  {
    symbol: String.raw`H_{\mathrm{PD}}(z),\ h[n]`,
    meaning: <>DTC 殘餘誤差（在 PD 的 reference 輸入端注入）→ PD 輸出的轉移函數 {m`1/(1+L(z))`}（{m`L`}：主 PLL 的開迴路增益）與它的 impulse response；type-I/II PLL 有 {m`H_{\mathrm{PD}}(1)=0`}</>,
    firstSeen: '§9.2',
    note: <>u-domain：{m`\tilde{\mathbf u}=h*\tilde{\mathbf x}`}（<Erratum id="E04" />）</>,
  },
  {
    symbol: String.raw`\phi_{\mathrm{dtc}},\ \theta_{\mathrm{fb}}`,
    meaning: <>DTC 補償後留下的殘餘誤差（在 PD 的 reference 輸入端注入）、回授（divider）相位；{m`e_{\mathrm{PD}}=\phi_{\mathrm{dtc}}-\theta_{\mathrm{fb}}`}</>,
    unit: String.raw`\mathrm{rad}\text{ 或 }\mathrm{fs}`,
    firstSeen: '§9.2',
    note: <>解出 {m`e_{\mathrm{PD}}=H_{\mathrm{PD}}\,\phi_{\mathrm{dtc}}`}（正號）；§9.2 的 {m`d[n]=\tilde{\mathbf x}^T(\boldsymbol\theta-\mathbf w_k)`} 就是以時間為單位的 {m`\phi_{\mathrm{dtc}}`}</>,
  },
  {
    symbol: String.raw`s[n],\ S`,
    meaning: <>{m`H_{\mathrm{PD}}`} 的 step response {m`s[n]=\sum_{m\le n}h[m]`} 及其總和 {m`S=\sum_ns[n]`}（type-II 為 0）</>,
    firstSeen: '§9.2',
    note: <>只用在 {m`w_b`} 漂移的估計（F-09.19）</>,
  },
  { symbol: String.raw`\eta_k`, meaning: <>第 {m`k`} 個 block 內雜訊 {m`v[n]`} 的平均（{m`\mathrm{Var}=\sigma_v^2/N`}）</>, unit: String.raw`\mathrm{fs}`, firstSeen: '§9.2', note: <>驅動 {m`w_b`} random walk 的那一項</> },
  { symbol: 'n,\\ k,\\ K', meaning: <>時間索引：{m`n`} = comparator sample，{m`k`} = GMAC block；{m`K`} = 已經跑過的 block 數</>, firstSeen: '全站 §0' },
]

/** 章末的符號表：整章最後一個區塊（「本課必記」與「連結到 PLL 硬體」之後） */
export function ChapterSymbols() {
  return (
    <section id="symbols" className="ch09-symbols" aria-label="本章符號表">
      <SymbolTable
        rows={SYMBOLS}
        title="本章符號表"
        caption={
          <>
            本章所有平均遞迴都明寫 {m`K_q`}（<Erratum id="E05" />、<Erratum id="E08" />）；linear detector 時是精確的等式，1-bit 時是
            {m`|\mathbf u^T\boldsymbol\delta_k|\ll\sigma_v`} 的小訊號近似（F-09.3）；598 blocks 這類數字是 <strong>mean</strong> 的敘述（
            <Erratum id="E23" />）；§9.2 的 DC-null 版本採修正文字（<Erratum id="E04" />）；{m`\lambda`} 只代表 eigenvalue（
            <Erratum id="E22" />）。全站符號總表在 Formula &amp; Unit Reference 頁。
          </>
        }
      />
    </section>
  )
}
