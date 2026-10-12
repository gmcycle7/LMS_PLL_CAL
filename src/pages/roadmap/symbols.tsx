import type { SymbolEntry } from '@/components'
import { ErratumTag, mt } from './common'

/**
 * 本頁符號（docs/teaching-style.md §5）。各研究預覽的局部符號在「首次出現」欄標明所屬項目；
 * 與全站約定或其他章節衝突者在備註欄說明本頁採用的定義。意義與備註中的數學一律以 `$…$`（KaTeX）書寫。
 */
export const ROADMAP_SYMBOLS: SymbolEntry[] = [
  { symbol: '\\delta w_k=w_k-w^*', meaning: mt('係數誤差（block $k$）'), unit: '\\mathrm{fs}', firstSeen: 'R1', note: <>{mt(String.raw`與第 12 章相同；§0 的 $\delta=a-w$ 極性相反`)}（<ErratumTag eid="E33" />）</> },
  { symbol: 'K=K_qC', meaning: '平均 GMAC 斜率', unit: '\\mathrm{fs}^{-1}', firstSeen: 'R1', note: <><ErratumTag eid="E13" /> {mt('$K$ 的定義')}</> },
  { symbol: 'g=\\mu K', meaning: '無因次迴路增益', firstSeen: 'R1' },
  { symbol: 'p=1-g', meaning: '校正迴路 pole（R2 中即 block-rate AR(1) 係數）', firstSeen: 'R1', note: mt('$p[n]$（SSPLL）是 PMUX 相位索引，不同的量') },
  { symbol: '\\mu', meaning: 'LMS 步長（average-mode GMAC）', unit: '\\mathrm{fs}', firstSeen: 'R1', note: mt(String.raw`R7 中為 $K\equiv1$ 的正規化步長（無因次）`) },
  { symbol: '\\sigma_\\eta^2', meaning: mt(String.raw`GMAC 雜訊變異數，約 $1/N$`), firstSeen: 'R1', note: <><ErratumTag eid="E30" /> {mt(String.raw`$x=\pm1$ 時精確為 $(1-m^2)/N$`)}</> },
  {
    symbol: '\\rho',
    meaning: 'GMAC 雜訊的 AR(1) 係數（相鄰 block 的相關係數）',
    firstSeen: 'R1',
    note: mt(String.raw`第 12 章 §12.4 記作 $r$（本頁 R7 的觀測 pole 記作 $r_s$）；第 9 章的 $\rho$ 是 $\mathbf R$ 的相關係數；$\rho(\mathbf A)$ 是 spectral radius；SSPLL 的 $\rho[n]$ 是 DTC 細部殘差——都是不同的量`),
  },
  { symbol: '\\sigma_w', meaning: '係數穩態 RMS（gain-equivalent，不是 output jitter）', unit: '\\mathrm{fs}', firstSeen: 'R1' },
  { symbol: 'x[n],\\ P', meaning: 'code（DSM residue）與其週期', firstSeen: 'R2' },
  { symbol: 'N,\\ L=\\mathrm{lcm}(P,N)', meaning: 'GMAC block 長度、聯合週期', unit: '\\mathrm{samples}', firstSeen: 'R2', note: mt('SSPLL 的 $L$ 是主 PLL 的開迴路增益') },
  { symbol: 'W,\\ S,\\ R', meaning: mt('整數目標、尺度（$2^F$ 或分母）、整數餘數：$w_H=W/S$'), firstSeen: 'R3', note: '局部符號（只在 R3）' },
  { symbol: '\\mathbf J=\\mathbf U\\boldsymbol\\Sigma\\mathbf V^T', meaning: mt(String.raw`Jacobian 與其 SVD；$\sigma_i$ 為 singular values`), firstSeen: 'R4' },
  { symbol: '\\gamma,\\ \\varepsilon', meaning: '收斂因子、正則化參數', firstSeen: 'R4', note: <><ErratumTag eid="E22" /> {mt(String.raw`$\lambda$ 只代表 eigenvalue`)}</> },
  { symbol: '\\mathbf R,\\ \\lambda_{\\min}', meaning: mt(String.raw`資訊矩陣 $E[\mathbf u\mathbf u^T]$ 與最小 eigenvalue`), firstSeen: 'R5' },
  { symbol: '\\alpha,\\ N_0', meaning: 'FCW 小數（離整數的距離）、PE 窗口長度', firstSeen: 'R5', note: mt(String.raw`SSPLL 中 $\alpha$ 同樣是 FCW 小數`) },
  { symbol: 's', meaning: 'offset regressor 的單位尺度', firstSeen: 'R5', note: mt('局部符號；R6 中 $s$ 是 comparator 看到的誤差、R7 中是觀測狀態') },
  { symbol: 'F_v,\\ f_v', meaning: 'comparator 前雜訊的 CDF / PDF', firstSeen: 'R6' },
  { symbol: '\\theta,\\ H', meaning: '門檻 offset、遲滯寬度', unit: '\\mathrm{fs}', firstSeen: 'R6', note: mt(String.raw`$H$ 不是 $H_{\mathrm{PD}}$`) },
  { symbol: 't_\\pm,\\ \\nu', meaning: mt(String.raw`遲滯 Markov chain 的翻轉機率、記憶因子 $1-t_+-t_-$`), firstSeen: 'R6' },
  { symbol: '\\mathcal I', meaning: '每個 sample 的有效資訊', unit: '\\mathrm{fs}^{-2}', firstSeen: 'R6' },
  { symbol: 'r_s,\\ b_s,\\ c_s', meaning: mt('§8.4 抽象觀測狀態 $s$ 的 pole、輸入增益、輸出增益'), firstSeen: 'R7', note: <><ErratumTag eid="E31" /> <ErratumTag eid="E34" /> {mt(String.raw`規格寫 $r,b,c$；加下標 $s$ 以免與 offset $b$、INL 係數 $c_3$、$\mathbf C=E[\mathbf x\mathbf u^T]$ 撞名（與第 8 章相同）`)}</> },
  { symbol: '\\mathbf A_N,\\ S_N', meaning: mt(String.raw`lifted 矩陣、$\sum_{i<N}r_s^{\,i}$`), firstSeen: 'R7' },
  { symbol: '\\sigma_\\zeta^2,\\ \\sigma_y^2', meaning: mt(String.raw`每 block 的漂移變異數、等效量測雜訊 $\sigma_\eta^2/K^2$`), unit: '\\mathrm{fs}^2', firstSeen: 'R8' },
  { symbol: 'P^-,\\ K_\\infty', meaning: '穩態 Kalman 預測變異數與增益', firstSeen: 'R8' },
  { symbol: 'W_x,\\ W_\\mathrm{acc}', meaning: 'code 位寬、累加器位寬', unit: '\\mathrm{bits}', firstSeen: 'R9' },
  { symbol: 'n_{\\mathrm{safe}}', meaning: mt(String.raw`最壞情況（每筆都加 $\max|q\,x|$）下累加器不溢位最多能累加的筆數；第 $n_{\mathrm{safe}}+1$ 筆第一次溢位`), unit: '\\mathrm{samples}', firstSeen: 'R9', note: '局部符號（只在 R9）' },
  { symbol: 'T_{\\max},\\ \\varepsilon,\\ B', meaning: '校正時間上限、平均誤差縮減比（相對）、block 數', firstSeen: 'R10', note: <><ErratumTag eid="E16" /> {mt(String.raw`$\varepsilon$ 是相對比例`)}</> },
  { symbol: 'L_\\varepsilon,\\ y', meaning: mt(String.raw`$\ln(1/\varepsilon)$、tanh 律的自變數 $NL_\varepsilon/(2f_sT_{\max})$`), firstSeen: 'R10', note: mt('局部符號；R2 的 $L$ 是聯合週期、SSPLL 的 $L$ 是開迴路增益') },
  { symbol: 'L,\\ H_{\\mathrm{PD}},\\ T', meaning: mt(String.raw`主 PLL 開迴路、PD 誤差轉移 $1/(1+L)$、output 轉移 $L/(1+L)$`), firstSeen: 'SSPLL' },
  {
    symbol: '\\phi_{\\mathrm{in}},\\ \\theta_{\\mathrm{fb}},\\ e_{\\mathrm{PD}}',
    meaning: mt(String.raw`折算到 PD 的 reference 輸入的外加誤差（reference 端 DTC 的殘差，加上折算過來的 PMUX offset）、回授回來的相位 $L\,e_{\mathrm{PD}}$、PD 的輸出 $\phi_{\mathrm{in}}-\theta_{\mathrm{fb}}=H_{\mathrm{PD}}\,\phi_{\mathrm{in}}$（comparator 取的就是它）`),
    firstSeen: 'SSPLL',
    note: mt(String.raw`案例頁把同一個外加誤差記作 $u[n]$；本頁的 $u$ 保留給有效 regressor $h_{\mathrm{PD}}*x$`),
  },
  { symbol: 'K_L;\\ K_p,\\ K_i', meaning: 'Type-I 迴路增益；Type-II 的比例 / 積分增益（每 sample）', firstSeen: 'SSPLL', note: mt('$K_L$ 與 $K=K_qC$ 不同') },
  { symbol: '\\Omega=2\\pi f/f_{\\mathrm{ref}}', meaning: '離散時間頻率', unit: '\\mathrm{rad/sample}', firstSeen: 'SSPLL' },
  { symbol: '\\varphi[n],\\ p[n]', meaning: mt(String.raw`分數累加器相位 $\mathrm{frac}(n\alpha)$、PMUX 相位索引 $\lfloor8\varphi[n]\rfloor$`), firstSeen: 'SSPLL', note: mt('$p[n]$ 與校正 pole $p$ 不同') },
  { symbol: '\\rho[n],\\ \\beta', meaning: mt(String.raw`DTC 細部殘差 $8\varphi[n]-p[n]\in[0,1)$（GOS 的 regressor）、鋸齒基頻 $\mathrm{frac}(8\alpha)$`), firstSeen: 'SSPLL' },
  { symbol: '\\kappa_1,\\ W_1', meaning: mt(String.raw`PHOS mode-1 的正規化平均斜率（$H_{\mathrm{PD}}\equiv1$ 時為 1）、基波權重 $64\sin^2(\pi/8)/\pi^2$`), firstSeen: 'SSPLL' },
  { symbol: 'D', meaning: mt('相關器延遲：GMAC 用 $x[n-D]$；本頁一律 $D=0$'), unit: '\\mathrm{samples}', firstSeen: 'SSPLL' },
  { symbol: '\\beta_x', meaning: '對照用 AR(1) code 的相關係數', firstSeen: 'SSPLL', note: '局部符號' },
]
