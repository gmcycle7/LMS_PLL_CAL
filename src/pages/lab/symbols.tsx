import type { SymbolEntry } from '@/components'
import { ErratumNote, md } from './common'

/**
 * 本頁符號表（docs/teaching-style.md §5）。
 * 全站約定：極性 δ = a − w；時間單位 fs；n = comparator sample、k = GMAC block。
 * 與其他章衝突的字母在備註欄說明本頁採用的定義。意義／備註欄的 `$...$` 以 KaTeX 顯示。
 */
export const LAB_SYMBOLS: SymbolEntry[] = [
  { symbol: 'f_{\\mathrm{ref}},\\ f_s', meaning: 'reference 頻率；本頁假設它就是 DSM、DTC、comparator 的取樣率', unit: '\\mathrm{Hz}', firstSeen: '§2', note: md('多速率（$f_s\\ne f_{\\mathrm{ref}}$）未建模') },
  { symbol: 'N_{\\mathrm{int}},\\ \\alpha', meaning: md('FCW 的整數與小數部分；實際小數是量化後的 $\\alpha_{\\mathrm{eff}}=K/M$'), unit: '—', firstSeen: '§3', note: md('$M=2^B$，$B$ 為 DSM 位元數') },
  { symbol: 'f_{\\mathrm{out}}', meaning: md('輸出頻率 $(N_{\\mathrm{int}}+\\alpha_{\\mathrm{eff}})\\,f_{\\mathrm{ref}}$'), unit: '\\mathrm{Hz}', firstSeen: '§3' },
  { symbol: 'y[n]', meaning: 'DSM 輸出（divider 這個週期多吞幾個 VCO 週期）', unit: 'T_{\\mathrm{vco}}', firstSeen: '§3' },
  { symbol: 'r[n]', meaning: 'DSM residue：累積的相位誤差，也就是 DTC 要抵銷的量', unit: 'T_{\\mathrm{vco}}', firstSeen: '§3' },
  { symbol: 'P,\\ A_1', meaning: '一階 DSM residue 的週期，與其基頻譜線的 peak 振幅', unit: '\\mathrm{sample},\\ T_{\\mathrm{vco}}', firstSeen: '§4.1' },
  { symbol: 'x[n]', meaning: md('正規化後的 code（regressor）：$x=(r-o)\\,s$'), unit: '—', firstSeen: '§4.2', note: md('$o$、$s$ 是正規化的 offset 與 scale') },
  { symbol: 'a,\\ w_k', meaning: md('真實的 DTC gain 誤差；第 $k$ 個 block 的校正係數'), unit: '\\mathrm{fs}', firstSeen: '§4.3', note: <>單位是 fs per unit code（<ErratumNote id="E13" />）</> },
  { symbol: '\\delta_k', meaning: md('係數誤差 $\\delta_k=a-w_k$'), unit: '\\mathrm{fs}', firstSeen: '§4.3', note: <>全站極性（<ErratumNote id="E32" />）</> },
  { symbol: 'o_{\\mathrm{DTC}},\\ c_2,\\ c_3', meaning: 'DTC 的 offset 與二、三階 INL 係數', unit: '\\mathrm{fs}', firstSeen: '§4.3', note: md('合起來就是第 11 章的 $d(x)$') },
  { symbol: 'e_{\\mathrm{DTC}}[n]', meaning: 'DTC 沒抵銷乾淨的時間誤差', unit: '\\mathrm{fs}', firstSeen: '§4.3' },
  { symbol: 'L(z)', meaning: '主 PLL 的 open-loop transfer', unit: '—', firstSeen: '§4.4', note: md('頻率變數 $\\Omega$ 的單位是 rad/sample') },
  { symbol: 'H_{\\mathrm{PD}}(z)', meaning: md('DTC 誤差 → PD 看到的 residual：$1/(1+L)$'), unit: '—', firstSeen: '§4.4', note: <>high-pass；Type-I / II 時 {md('$H_{\\mathrm{PD}}(1)=0$')}（<ErratumNote id="E03" />）</> },
  { symbol: 'T(z)', meaning: md('DTC 誤差 → 輸出 timing error：$L/(1+L)=1-H_{\\mathrm{PD}}$'), unit: '—', firstSeen: '§4.4', note: 'low-pass' },
  { symbol: 'u_{\\mathrm{pd}}[n],\\ u_x[n]', meaning: md('PD residual $H_{\\mathrm{PD}}\\{e_{\\mathrm{DTC}}\\}$；有效 regressor $H_{\\mathrm{PD}}\\{x\\}$'), unit: '\\mathrm{fs},\\ —', firstSeen: '§4.4', note: <>{md('$u_x$ 與 $x$ 同單位')}（<ErratumNote id="E13" />）</> },
  { symbol: 'v[n],\\ \\sigma_v,\\ b', meaning: 'comparator 前的雜訊、它的 RMS、comparator offset', unit: '\\mathrm{fs}', firstSeen: '§4.5' },
  { symbol: 'q[n]', meaning: md('1-bit comparator 輸出 $\\mathrm{sign}(e)\\in\\{+1,-1\\}$'), unit: '—', firstSeen: '§4.5', note: <>{md('$e=0$ 時取 $+1$')}（<ErratumNote id="E07" />）</> },
  { symbol: 'K_q', meaning: md('comparator 的小訊號增益 $\\sqrt{2/\\pi}/\\sigma_v$'), unit: '\\mathrm{fs}^{-1}', firstSeen: '§4.5' },
  { symbol: 'x_{\\mathrm{ref}}[n]', meaning: md('GMAC 用的 regressor：$x$、$x[n-D]$ 或 $\\hat H\\{x\\}[n-D]$'), unit: '—', firstSeen: '§4.6' },
  { symbol: 'G_k,\\ N', meaning: md('GMAC 輸出（block 內 $q\\,x_{\\mathrm{ref}}$ 的平均）與每個 block 的樣本數'), unit: '—,\\ \\mathrm{sample}', firstSeen: '§4.6', note: <>{md('average 模式；sum 模式不除 $N$')}（<ErratumNote id="E18" />）</> },
  { symbol: 'C,\\ K', meaning: md('相關 $E[x_{\\mathrm{ref}}u_x]$；GMAC 斜率 $K=K_qC$'), unit: '—,\\ \\mathrm{fs}^{-1}', firstSeen: '§4.6', note: md('$C$ 的正負決定更新極性') },
  { symbol: '\\mu,\\ g', meaning: md('learning rate；無因次迴路增益 $g=\\mu K$'), unit: '\\mathrm{fs},\\ —', firstSeen: '§4.7' },
  { symbol: 'd,\\ D,\\ d_L', meaning: '更新延遲（blocks）；GMAC code delay（samples）；主 PLL 的 loop latency（samples）', unit: '\\mathrm{block},\\ \\mathrm{sample}', firstSeen: '§4.7', note: <>三個不同的延遲，不要混用（<ErratumNote id="E34" />）</> },
  { symbol: 'p,\\ \\rho,\\ \\tau', meaning: md('$d=0$ 的 pole $1-g$；含延遲的 pole 半徑；時間常數 $-1/\\ln\\rho$'), unit: '—,\\ —,\\ \\mathrm{block}', firstSeen: '§4.7', note: md('$\\rho$ 在第 9 章是相關係數；本頁是 pole 半徑') },
  { symbol: 'w^*,\\ \\delta w_k', meaning: md('固定點（$E[G]=0$ 的 $w$）；相對固定點的擾動 $w_k-w^*$'), unit: '\\mathrm{fs}', firstSeen: '§4.7', note: <>{md('$\\delta w$ 的極性與 $\\delta$ 相反')}（<ErratumNote id="E33" />）</> },
  { symbol: '\\sigma_\\eta^2,\\ \\sigma_w', meaning: '每個 block 的 GMAC 雜訊變異數；係數的穩態標準差', unit: '—,\\ \\mathrm{fs}', firstSeen: '§4.7' },
  { symbol: 'f_u', meaning: md('block 更新率 $f_s/N$'), unit: '\\mathrm{Hz}', firstSeen: '§4.7' },
  { symbol: 't_{\\mathrm{out}}[n]', meaning: md('輸出 timing error $T\\{e_{\\mathrm{DTC}}\\}$'), unit: '\\mathrm{fs}', firstSeen: '§4.9' },
  { symbol: 'S_t^{(1)}(f),\\ \\mathcal L(f)', meaning: 'timing error 的 one-sided PSD；單邊帶 phase noise', unit: '\\mathrm{fs^2/Hz},\\ \\mathrm{dBc/Hz}', firstSeen: '§4.9', note: <>換算見 <ErratumNote id="E28" /></> },
  { symbol: '\\beta', meaning: md('phase modulation index $2\\pi f_{\\mathrm{out}}A$（$A$ 為 timing tone 的 peak 振幅）'), unit: '\\mathrm{rad}', firstSeen: '§4.9' },
  { symbol: '\\lambda_{\\min}', meaning: md('Persistent Excitation 指標：每個 block 的 $\\tfrac1N\\sum u_x^2$ 的最小值'), unit: '—', firstSeen: '§5.2', note: '多參數時是資訊矩陣的最小特徵值' },
  { symbol: '\\hat w_k,\\ \\hat G_k', meaning: md('mean-field 平均軌跡，與 GMAC 對雜訊取期望值後的輸出（$q$ 換成 $\\operatorname{erf}$）'), unit: '\\mathrm{fs},\\ —', firstSeen: '§5.2', note: md('預測的是「許多 seeds 的平均」') },
  { symbol: 'C_k,\\ B_k,\\ w^*_k', meaning: md('第 $k$ 個 block 自己的相關、偏差項，與準靜態固定點 $a+B_k/C_k$'), unit: '—,\\ \\mathrm{fs},\\ \\mathrm{fs}', firstSeen: '§5.2', note: md('code 統計不平穩時 $w^*_k$ 會隨 $k$ 擺動') },
  { symbol: 'J', meaning: md('多參數 Jacobian：$J_{ij}=K_q\\,E[\\psi_i\\,\\phi_{u,j}]$'), unit: '\\mathrm{fs}^{-1}', firstSeen: '§5.4' },
  { symbol: 'K_B,\\ W', meaning: md('模擬的 block 數；輸出分析視窗（最後 $W$ 個 block）'), unit: '\\mathrm{block}', firstSeen: '§6', note: md('$K$ 已經用在斜率，所以 block 數寫成 $K_B$') },
]
