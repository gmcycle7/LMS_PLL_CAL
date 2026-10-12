import type { SymbolEntry } from '@/components'
import { ErratumNote, md } from './common'

/** 本頁符號（docs/teaching-style.md §5）：有衝突或勘誤時註明本頁採用的定義。 */
export const MODEL_SYMBOLS: SymbolEntry[] = [
  { symbol: 'n', meaning: md('comparator / code sample 索引（$f_s$ 時基）'), unit: '\\text{sample}', firstSeen: '§1', note: md('本頁 $f_s=f_\\mathrm{ref}$（一個 code 對一個 comparator sample）') },
  { symbol: 'k', meaning: md('GMAC block 索引（$f_u=f_s/N$ 時基）'), unit: '\\text{block}', firstSeen: '§1' },
  { symbol: 'N', meaning: 'gm_accum_samples：每個 block 累加的 sample 數', unit: '\\text{samples}', firstSeen: '§1' },
  { symbol: 'x[n]', meaning: '正規化後的 code / regressor（seeded_pattern + code_normalization）', unit: '1', firstSeen: '§3' },
  {
    symbol: 'u[n]=(h*x)[n]',
    meaning: md('經 PLL error path $H_\\mathrm{PD}$ 的有效 regressor'),
    unit: '[x]',
    firstSeen: '§3',
    note: (
      <>
        {md('與 $x$ 同單位（E13）；不是 §11 的干擾')} <ErratumNote id="E12" />
      </>
    ),
  },
  { symbol: 'x_\\mathrm{ref}[n]', meaning: md('GMAC 實際拿去相乘的 regressor：raw $x[n]$、$x[n-D]$ 或 $u_f[n-D]$'), unit: '1', firstSeen: '§3' },
  {
    symbol: 'D',
    meaning: 'gm_code_delay_samples：GMAC code 對齊延遲',
    unit: '\\text{samples}',
    firstSeen: '§3',
    note: (
      <>
        {md('§16.1 第 2 項原文寫 $d$，本頁改 $D$')} <ErratumNote id="E34" />
      </>
    ),
  },
  { symbol: 'd', meaning: 'cal_update_delay_blocks：新 gain 生效前的 block 延遲', unit: '\\text{blocks}', firstSeen: '§3' },
  { symbol: 'a', meaning: 'gain_true：DUT 的真實 gain（行為參數）', unit: '\\mathrm{fs}/\\text{unit code}', firstSeen: '§3' },
  { symbol: 'w_k', meaning: md('第 $k$ 個 block 更新後的 gain 暫存器'), unit: '\\mathrm{fs}/\\text{unit code}', firstSeen: '§3' },
  {
    symbol: '\\delta_k=a-w_k',
    meaning: '剩餘參數誤差（全站極性）',
    unit: '\\mathrm{fs}/\\text{unit code}',
    firstSeen: '§3',
    note: (
      <>
        {md('與 §3、§12 的 $w-a$、$w-w^*$ 相反')} <ErratumNote id="E39" />
      </>
    ),
  },
  { symbol: 'e[n]', meaning: 'comparator 前的 time-equivalent error：PD 的輸出（送進 loop filter 的同一個訊號），加上折算到這個節點的 comparator offset 與 comparator 前的雜訊', unit: '\\mathrm{fs}', firstSeen: '§3' },
  {
    symbol: "t_\\mathrm{ref}',\\;t_\\mathrm{fb}",
    meaning: md("DTC 延遲後的 reference edge 與 feedback（divider）edge 的時刻；PD 比的是這兩條 edge，主 PLL 反應之前兩者相差 $t_\\mathrm{ref}'-t_\\mathrm{fb}=(a-w)\\,x$（常數 $T_0$ 不計）"),
    unit: '\\mathrm{fs}',
    firstSeen: '§3',
  },
  {
    symbol: 'T_0,\\;C_0,\\;\\tau_\\mathrm{DTC}[n]',
    meaning: md('reference 端 DTC 的基準延遲、對應的固定中心 code、實際延遲 $\\tau_\\mathrm{DTC}[n]=T_0-w\\,x[n]$（$w\\,x[n]$ 是補償量）'),
    unit: '\\mathrm{fs},\\;\\mathrm{LSB},\\;\\mathrm{fs}',
    firstSeen: '§3',
    note: md('DTC 只能延遲、不能提前；常數 $T_0$ 被 PLL 當成靜態相位偏移吸收'),
  },
  { symbol: 'v[n],\\;\\sigma_v', meaning: 'comparator 前 Gaussian 雜訊與其 RMS（pd_noise_rms_fs）', unit: '\\mathrm{fs}', firstSeen: '§3' },
  { symbol: 'b', meaning: 'comparator_offset_fs：comparator offset', unit: '\\mathrm{fs}', firstSeen: '§3', note: md('不是 §8.4 的 $b_s$') },
  {
    symbol: 'q[n]',
    meaning: md('1-bit comparator 雙極性輸出 $\\pm1$（$e\\ge0\\Rightarrow+1$）'),
    unit: '\\pm1',
    firstSeen: '§3',
    note: (
      <>
        tie 規則 <ErratumNote id="E07" />
      </>
    ),
  },
  {
    symbol: 'S_k,\\;G_k',
    meaning: md('GMAC 總和與平均：$G_k=S_k/N$'),
    unit: '1',
    firstSeen: '§3',
    note: (
      <>
        {md('sum / average 差 $N$ 倍')} <ErratumNote id="E18" />
      </>
    ),
  },
  { symbol: '\\mu', meaning: 'gain_step（learning rate）', unit: '\\mathrm{fs}', firstSeen: '§3', note: md('average 模式下單位為 fs；sum 模式為 fs per unit $S$') },
  { symbol: 'K_q', meaning: md('comparator 小訊號增益 $\\sqrt{2/\\pi}/\\sigma_v$'), unit: '\\mathrm{fs}^{-1}', firstSeen: '§3' },
  { symbol: 'C', meaning: md('有效相關 $E[x_\\mathrm{ref}\\,u]$'), unit: '1', firstSeen: '§3', note: '不是 §8.4 的 state-space 輸出矩陣（E31）' },
  {
    symbol: 'K=K_qC',
    meaning: md('平均 GMAC 斜率 $-\\partial E[G]/\\partial w$'),
    unit: '\\mathrm{fs}^{-1}',
    firstSeen: '§3',
    note: (
      <>
        {md('§0 未定義 $K$')} <ErratumNote id="E13" />
      </>
    ),
  },
  {
    symbol: 'S_\\mathrm{GMAC},\\;K_\\mathrm{mf}',
    meaning: md('GMAC 對 $w$ 的斜率 $S_\\mathrm{GMAC}=\\partial E[G]/\\partial w$（freeze 後以 $\\pm\\Delta w$ 量測）；JSON Lab 顯示 $K_\\mathrm{mf}=-S_\\mathrm{GMAC}$ 在 $w^*$ 的值'),
    unit: '\\mathrm{fs}^{-1}',
    firstSeen: '§6',
    note: md('有恢復力 $\\iff S_\\mathrm{GMAC}<0\\iff K_\\mathrm{mf}>0$；不要和 GMAC 總和 $S_k$ 混淆'),
  },
  { symbol: 'g=\\mu K', meaning: md('無因次 loop gain（sum 模式再 $\\times N$）'), unit: '—', firstSeen: '§3' },
  { symbol: 'p=1-g', meaning: md('$d=0$ 時的平均 pole'), unit: '—', firstSeen: '§3' },
  { symbol: '\\sigma_\\eta^2', meaning: md('每 block GMAC 雜訊變異數（$G$ 的單位平方）'), unit: '—', firstSeen: '§3' },
  {
    symbol: '\\sigma_w',
    meaning: md('穩態 $w$ 標準差（gain-equivalent noise）'),
    unit: '\\mathrm{fs}',
    firstSeen: '§3',
    note: (
      <>
        不是 output jitter <ErratumNote id="E30" />
      </>
    ),
  },
  { symbol: 'f_s,\\;f_u', meaning: md('comparator sample rate 與 block update rate $f_s/N$'), unit: '\\mathrm{Hz}', firstSeen: '§3' },
  {
    symbol: '\\phi_\\mathrm{dtc},\\;e_\\mathrm{PD},\\;\\theta_\\mathrm{fb}',
    meaning: md('DTC 的殘餘誤差（從 PD 的 reference 輸入注入）、PD 的輸出、回授相位（PLL 輸出折算到 PD 輸入）：$e_\\mathrm{PD}=\\phi_\\mathrm{dtc}-\\theta_\\mathrm{fb}=H_\\mathrm{PD}\\,\\phi_\\mathrm{dtc}$、$\\theta_\\mathrm{fb}=T\\,\\phi_\\mathrm{dtc}$'),
    unit: '\\mathrm{fs}',
    firstSeen: '§2、§4',
    note: md('兩條路都是正號；$H_\\mathrm{PD}=1/(1+L)$、$T=L/(1+L)$、$H_\\mathrm{PD}+T=1$'),
  },
  { symbol: 'K_p,\\;K_i,\\;\\omega_nT_s,\\;\\zeta', meaning: 'DT 主 PLL 的比例／積分增益、正規化自然頻率、阻尼', unit: '\\text{rad/sample}', firstSeen: '§4' },
  {
    symbol: 'M=2^{B},\\;K_\\mathrm{FCW}',
    meaning: 'DSM 累加器模數與整數 FCW',
    unit: '\\text{LSB}',
    firstSeen: '§4',
    note: md('DSM 的 FCW 改記 $K_\\mathrm{FCW}$，避免與 $K=K_qC$ 衝突'),
  },
  { symbol: 'r[n]', meaning: 'DSM phase residue（DTC 要抵消的量）', unit: 'T_\\mathrm{vco}', firstSeen: '§4', note: md('$r\\le0$：feedback（divider）edge 早到 $-r\\,T_\\mathrm{vco}$；DTC code $x=-r$') },
  {
    symbol: 'c,\\;\\hat c,\\;g_\\mathrm{DTC},\\;o,\\;c_2,\\;c_3',
    meaning: md('DTC 的 code 要求、量化並飽和後的實體 code、線性增益、固定延遲、二階／三階係數（$\\tau(\\hat c)$ 為延遲）'),
    unit: '\\mathrm{LSB},\\;\\mathrm{fs}/\\mathrm{LSB}^k',
    firstSeen: '§4',
    note: md('$c_2$、$c_3$ 在 JSON 的 dtc_nonlinearity 是「正規化 code」上的係數（單位 fs）'),
  },
  {
    symbol: 'N_\\mathrm{blk},\\;\\rho_1,\\;N_\\mathrm{eff},\\;s_w',
    meaning: md('統計用的 block 數、相鄰 block 的相關係數（一階迴路時 $\\rho_1=p$）、有效樣本數、$w$ 的樣本標準差'),
    unit: '—',
    firstSeen: '§7',
    note: md('$\\rho_1$ 不是 JSON Lab 解析區塊的 spectral radius $\\rho$；$N_\\mathrm{blk}$ 依 E34 的改名（原文 §14 的 $B$）'),
  },
  { symbol: 'B_x,\\;B_\\mathrm{acc}', meaning: 'GMAC 輸入 code 位元數與 accumulator 位元數', unit: '\\text{bits}', firstSeen: '§9' },
  { symbol: 'F_G,\\;\\ell,\\;\\Delta_G', meaning: md('右移後保留的小數 bit、右移量 $\\ell=\\log_2N-F_G$、$G$ 的 LSB'), unit: '—', firstSeen: '§9' },
  { symbol: 'W(\\delta),\\;\\mathrm{ENBW}', meaning: md('視窗在分數 bin 偏移 $\\delta$ 的頻率響應、等效雜訊頻寬（$\\delta$ 在 §8 指 bin 偏移，不是 $a-w$）'), unit: '\\text{bins}', firstSeen: '§8' },
  {
    symbol: '\\nu=m+\\delta,\\;n_\\mathrm{seg},\\;n_\\mathrm{bins},\\;\\mathrm{RBW}',
    meaning: md('離 tone 的距離（bin，可以不是整數；$m$ 為整數）、Welch segment 長度、主瓣積分的 bin 數、解析頻寬（以 Hz 表示的 ENBW）'),
    unit: '\\text{bins},\\;\\mathrm{Hz}',
    firstSeen: '§8',
    note: md('§8 的 $m$ 是 bin 數，不是 F-16.4 的 shift 量'),
  },
]
