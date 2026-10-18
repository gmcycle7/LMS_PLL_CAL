import { Tex, mathText, type SymbolEntry } from '@/components'
import { ErratumTag } from './shared'

/**
 * 本頁符號表的內容（放在頁末，sections/S12Symbols.tsx；docs/teaching-style.md §5）。
 * 符號第一次出現時，正文會先用一句話說明；這裡集中列出單位、第一次出現的小節，以及有勘誤或同一個字母兩種用法時本頁採用的定義。
 */
export const SYMBOLS: SymbolEntry[] = [
  { symbol: '\\delta=a-w', meaning: '剩餘參數誤差（真值減校正係數）', unit: '\\mathrm{fs}', firstSeen: '§0', note: <>全站約定（規格 §3、§12 的反向極性見 <ErratumTag id="E32" /> <ErratumTag id="E33" />）</> },
  { symbol: 'a,\\ w', meaning: '真實係數、GMAC block 使用的校正係數', unit: '\\mathrm{fs}/\\text{unit code}', firstSeen: '§0', note: 'code 正規化時 $w$ 的單位是「每單位 code 的 fs」（E13）' },
  { symbol: 'w^*', meaning: 'LMS 的固定點：$E[G(w^*)]=0$（一般 $w^*\\ne a$）', unit: '\\mathrm{fs}', firstSeen: '§3' },
  { symbol: 'G_k', meaning: '第 $k$ 個 GMAC block 的平均相關輸出 $\\frac1N\\sum_n q[n]\\,x[n-D]$', unit: '—', firstSeen: '§1', note: <>average 模式；sum 模式差 <Tex>{'N'}</Tex> 倍 <ErratumTag id="E18" /></> },
  { symbol: '\\bar G(w)', meaning: '把 $w$ 凍結時 $G_k$ 的期望值（mean-field）', unit: '—', firstSeen: '§2' },
  { symbol: '\\Delta\\ (\\Delta w)', meaning: 'freeze 量測時加在 $w$ 上的擾動', unit: '\\mathrm{fs}', firstSeen: '§2' },
  { symbol: 'M', meaning: '每一側（$+\\Delta$ 或 $-\\Delta$）量測的 block 數', unit: '—', firstSeen: '§2', note: '粗體 $\\mathbf M$ 是多參數更新矩陣，兩者不同' },
  { symbol: 'S=\\partial\\bar G/\\partial w', meaning: 'GMAC 對 $w$ 的斜率（$S_\\mathrm{GMAC}$）', unit: '\\mathrm{fs}^{-1}', firstSeen: '§2' },
  { symbol: '\\bar G_+,\\ \\bar G_-', meaning: '$w$ 被推到 $w_0+\\Delta$、$w_0-\\Delta$ 兩個工作點時，各自 $M$ 個 block 的 GMAC 平均', unit: '—', firstSeen: '§2' },
  { symbol: '\\hat S,\\ \\hat K', meaning: 'freeze 量到的斜率 $\\hat S=(\\bar G_+-\\bar G_-)/(2\\Delta)$ 與恢復力 $\\hat K=-\\hat S$', unit: '\\mathrm{fs}^{-1}', firstSeen: '§2' },
  { symbol: 'K=-S=K_qC', meaning: '恢復力（$K>0$ 才會往正確方向更新）', unit: '\\mathrm{fs}^{-1}', firstSeen: '§2', note: <>§0 未定義 <Tex>{'K'}</Tex>，本站採 E13 <ErratumTag id="E13" /></> },
  { symbol: 'K_q=\\sqrt{2/\\pi}/\\sigma_v', meaning: '1-bit comparator 小訊號增益（$|s|\\ll\\sigma_v$）', unit: '\\mathrm{fs}^{-1}', firstSeen: '§2' },
  { symbol: 'C=E[x[n-D]\\,u[n]]', meaning: '原始 code 與有效 regressor 的相關（含路徑相位與 code delay）', unit: '—', firstSeen: '§2' },
  { symbol: 'B_\\text{bias}', meaning: 'code 與「不是 gain 誤差造成的」干擾（offset、INL、耦合）的相關；線性化的固定點 $w^*\\approx a+B_\\text{bias}/C$', unit: '—', firstSeen: '§5.1' },
  { symbol: 'e_\\text{det}[n]', meaning: 'comparator 前的確定性殘差（comparator 輸入去掉雜訊 $v$ 的部分）', unit: '\\mathrm{fs}', firstSeen: '§2', note: '$K_q$ 線性化要它遠小於 $\\sigma_v$；§5.1 檢查 $a+B_\\text{bias}/C$ 時的門檻是 $\\max_n|e_\\text{det}[n]|\\le0.3\\,\\sigma_v$（Ch11 §11.4）' },
  { symbol: 'D', meaning: 'GMAC code delay（sample）', unit: '\\text{samples}', firstSeen: '§2', note: '與更新延遲 $d$（block）不同（E34）' },
  { symbol: 'd', meaning: '更新／commit 延遲', unit: '\\text{blocks}', firstSeen: '§4' },
  { symbol: 'g=\\mu K,\\ p=1-g', meaning: '無因次迴路增益與一階 pole', unit: '—', firstSeen: '§3' },
  { symbol: 'g_\\text{crit}(d)', meaning: '更新延遲 $d$ 時的臨界增益 $2\\sin\\frac{\\pi}{4d+2}$', unit: '—', firstSeen: '§4' },
  {
    symbol: 'k_{95}',
    meaning: '收斂到初值 5% 以內的 block 數：平均遞迴 $y_{k+1}=y_k-g\\,y_{k-d}$（$y_j=1,\\ j\\le0$）最後一次 $|y_k|>0.05$ 的下一個 block，逐 block 數出來',
    unit: '\\text{blocks}',
    firstSeen: '§4',
    note: '$d=0$ 時等於 $\\lceil\\ln0.05/\\ln\\rho\\rceil$；$d\\ge1$ 時那個式子只是「$\\rho$ 漸近估計」（$\\rho^k$ 不是包絡），不拿來判定。$\\rho$ 是 $z^{d+1}-z^d+g=0$ 的最大根絕對值',
  },
  { symbol: '\\sigma_\\eta^2', meaning: 'GMAC block 雜訊變異數（$\\pm1$ code、近平衡時 $\\approx1/N$）', unit: '—', firstSeen: '§2' },
  { symbol: '\\sigma_w', meaning: '係數 $w$ 在固定點附近的穩態抖動 RMS（一階時 $\\sigma_w=\\mu\\sigma_\\eta/\\sqrt{1-p^2}$）', unit: '\\mathrm{fs}', firstSeen: '§0', note: '§3 的 Chebyshev 例子與 §8.5 的 $\\varepsilon_\\text{bias}$（例如 $2\\sigma_w$）也用它' },
  { symbol: '\\mathrm{se},\\ z', meaning: '估計值的標準誤、判決用的信心倍數', unit: '—', firstSeen: '§0' },
  { symbol: '\\mathbf J,\\ \\hat{\\mathbf J}', meaning: '多參數 Jacobian $\\partial E[\\mathbf G]/\\partial\\mathbf w$ 與其量測值', unit: '\\mathrm{fs}^{-1}', firstSeen: '§2.5' },
  { symbol: '\\mathbf M,\\ \\mathbf A=\\mathbf I+\\mathbf M\\mathbf J', meaning: '更新矩陣與線性化閉迴路矩陣', unit: '—', firstSeen: '§7' },
  { symbol: '\\rho(\\mathbf A)', meaning: 'spectral radius（$\\max_i|\\lambda_i|$）', unit: '—', firstSeen: '§7', note: 'regressor 相關係數另記 $\\rho_{GP}$' },
  { symbol: '\\sigma_i,\\ \\kappa', meaning: '奇異值與 condition number $\\sigma_{\\max}/\\sigma_{\\min}$', unit: '—', firstSeen: '§7' },
  { symbol: 'g_2(\\mu),\\ \\lambda(\\mu)', meaning: '均方係數 $E[(1-\\mu x^2)^2]$ 與 Lyapunov 指數 $E[\\log|1-\\mu x^2|]$', unit: '—', firstSeen: '§3', note: <>與迴路增益 <Tex>{'g'}</Tex> 區分；a.s. 界見 <ErratumTag id="E14" /></> },
  { symbol: 'n,\\ k_f,\\ p_U', meaning: '獨立試驗數、觀察到的失效數、失效機率上界', unit: '—', firstSeen: '§3.5' },
  { symbol: 'B_x,\\ B_\\text{acc},\\ F', meaning: 'GMAC 輸入位元、累加器位元、內部小數位元', unit: '\\text{bits}', firstSeen: '§6' },
  { symbol: 'T_\\text{lc}', meaning: 'limit cycle 週期（與閉迴路 $T=L/(1+L)$ 不同）', unit: '\\text{updates}', firstSeen: '§6' },
  { symbol: '\\beta,\\ A_t', meaning: '單 tone 相位調變指數 $\\beta=2\\pi f_\\text{out}|T(f_m)|A_t$，與 DTC／PMUX 端 timing tone 的 peak；spur $\\approx20\\log_{10}(\\beta/2)$（F-12.18）', unit: '\\mathrm{rad},\\ \\mathrm{fs}', firstSeen: '§8', note: '頻譜儀量到的是輸出：反推 $A_t$ 要除以 $|T(f_m)|$（F-SO.13）' },
  { symbol: '\\delta_P,\\ \\kappa_\\text{pat}', meaning: '單一相的 PHOS offset 殘差，與「tone peak ÷ 殘差」的 pattern 係數 $\\kappa_\\text{pat}=A_t/\\delta_P$（$P$ 相 one-hot、只有一相有殘差、看 $\\alpha f_\\text{ref}$ 的基波時 $2\\sin(\\pi/P)/\\pi$，$P=8$ 時 $0.2436$）', unit: '\\mathrm{fs},\\ 1', firstSeen: '§8.5', note: '$\\alpha=s/P$（DTC 殘量固定）時相干加總成 $2/P$；多相同時有殘差時要用案例頁 F-CS.21 的 DFT 正向公式' },
  { symbol: 'f_\\text{ref},\\ T_\\text{blk},\\ T_\\text{meas}', meaning: 'reference 頻率（每個 reference 週期一個 comparator sample）、一個 GMAC block 的時間 $N/f_\\text{ref}$、兩側各 $M$ 個 block 的量測時間 $2MT_\\text{blk}$', unit: '\\mathrm{Hz},\\ \\mathrm{s},\\ \\mathrm{s}', firstSeen: '§8.5', note: '不含每次改 $w$ 後丟掉的 settling block' },
  { symbol: 'w_\\text{opt},\\ \\varepsilon_\\text{bias}', meaning: 'freeze 後用 w_force 掃 $w$ 時輸出 spur 最低的點（$\\approx$ 物理的 $a$），與 bias 那一列的驗收容限 $|w^*-w_\\text{opt}|\\le\\varepsilon_\\text{bias}$（例如 $2\\sigma_w$，$\\sigma_w$ 是 §0 的係數抖動 RMS）', unit: '\\mathrm{fs},\\ \\mathrm{fs}', firstSeen: '§8.5', note: '$w^*$ 是 LMS 自己停的地方，$w_\\text{opt}$ 是儀器看到最好的地方；兩者的差就是量到的 bias' },
  { symbol: '\\delta t[n],\\ \\sigma_{\\delta t},\\ T', meaning: 'DTC 的補償誤差 $\\delta t=x\\,\\delta w$（reference 端的 DTC 多補償的時間：reference edge 少延遲、早到這麼多，殘差是 $-\\delta t$）、它的 RMS，與主 PLL 對輸出的 transfer $T=L/(1+L)$（DTC 殘差在 PD 的 reference 輸入注入，$\\theta_\\mathrm{out}=+T\\,\\phi_\\mathrm{dtc}$；輸出路徑用 $T$，不是 $H_\\mathrm{PD}$）', unit: '\\mathrm{fs},\\ \\mathrm{fs},\\ 1', firstSeen: '§8' },
]

/** 字串欄位中的 `$…$` 以 KaTeX 顯示（SymbolTable 的 meaning／note 是 ReactNode，不會自動轉）。 */
export const SYMBOL_ROWS: SymbolEntry[] = SYMBOLS.map((r) => ({ ...r, meaning: mathText(r.meaning), note: mathText(r.note) }))

/** 符號表的圖說：本頁一律 δ = a − w（全站約定）。 */
export const SYMBOL_CAPTION = String.raw`本頁一律 $\delta=a-w$；$K$、$\mu$ 的單位依 average-mode GMAC（$G$ 無因次）。粗體為矩陣。`
