import { SymbolTable, Tex, mathText, type SymbolEntry, ChRef } from '@/components'
import { Erratum, scrollBackFromSymbols, tn } from '../common'
import { NUM } from '../numbers'

/**
 * 本章符號表（docs/teaching-style.md §5：放在章末、外層 id="symbols"，章首只留一行連結）。
 * 「首次出現」是正文裡第一次用到這個符號的段落；那裡會就地用一句話說明，這張表是忘記時回來查的。
 */
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
  { symbol: String.raw`u_i[n]`, meaning: mathText('第 $i$ 個參數的有效 regressor（它的誤差經 PLL 路徑到 PD 輸出 $e[n]$ 的「權重」）'), unit: String.raw`1`, firstSeen: '10.1', note: '已正規化（unit RMS）' },
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
  { symbol: String.raw`e[n]=\mathbf u^T[n]\boldsymbol\delta_k+v[n]`, meaning: 'PD 的輸出（comparator 的輸入）：所有參數的誤差加在一起，再加雜訊', unit: String.raw`\mathrm{fs}`, firstSeen: '10.1' },
  {
    symbol: String.raw`T_0`,
    meaning: mathText('reference 端 DTC 的固定基準延遲：DTC 只能延遲，補償量 $\\sum_i w_i\\,x_i[n]$ 是從它往回扣的（DTC 的延遲 $=T_0-\\sum_i w_i\\,x_i[n]$）；常數，被 PLL 當成靜態相位偏移吸收'),
    unit: String.raw`\mathrm{fs}`,
    firstSeen: '系統圖',
  },
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
        誤差衰減到 5%（下降 95%）所需的 block 數。單一模式：<Tex>{String.raw`\lceil\ln0.05/\ln|p|\rceil`}</Tex>；整個誤差向量：<Tex>{String.raw`\mathbf A_{\mathrm{cal}}`}</Tex> 對稱（正規）時代{' '}
        <Tex>{String.raw`|p|=\rho(\mathbf A_{\mathrm{cal}})`}</Tex>，否則用 <Tex>{String.raw`\|\mathbf A^k\|_2\le0.05`}</Tex>
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

/** 章末的符號表：整頁的最後一個區塊。 */
export function S7Symbols() {
  return (
    <section id="symbols" className="ch10-symbols" aria-label="本章符號表">
      <SymbolTable
        title="本章符號表"
        rows={SYMBOLS}
        caption={
          <>
            「首次出現」為本頁段落編號（規格對應段落見各節標題旁）。單位約定：時間誤差一律 fs；code / regressor 已正規化（無因次）。本章例子常把 <Tex>{'K_q'}</Tex> 正規化為 1（即取{' '}
            <Tex>{String.raw`\sigma_v=\sqrt{2/\pi}\ \mathrm{fs}`}</Tex>），此時會明寫；換成<ChRef ch="05">第 5 章</ChRef>的{' '}
            <Tex>{String.raw`K_q=${tn(NUM.Kq, 6)}\ \mathrm{fs}^{-1}`}</Tex>（<Tex>{String.raw`\sigma_v=100\ \mathrm{fs}`}</Tex>）時數字會差兩個數量級。
          </>
        }
      />
      <p className="ch10-symbols-back small muted no-print">
        <button type="button" className="ch10-linklike" onClick={scrollBackFromSymbols}>
          ↑ 回到剛才閱讀的位置
        </button>
        （從章首的「本章符號表在最後」跳過來時，會回到原來的地方；否則回到章首）
      </p>
    </section>
  )
}
