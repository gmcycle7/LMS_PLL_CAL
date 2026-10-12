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
  { symbol: '\\sigma_\\eta^2', meaning: 'GMAC block 雜訊變異數（$\\pm1$ code、近平衡時 $\\approx1/N$）', unit: '—', firstSeen: '§2' },
  { symbol: '\\mathrm{se},\\ z', meaning: '估計值的標準誤、判決用的信心倍數', unit: '—', firstSeen: '§0' },
  { symbol: '\\mathbf J,\\ \\hat{\\mathbf J}', meaning: '多參數 Jacobian $\\partial E[\\mathbf G]/\\partial\\mathbf w$ 與其量測值', unit: '\\mathrm{fs}^{-1}', firstSeen: '§2.5' },
  { symbol: '\\mathbf M,\\ \\mathbf A=\\mathbf I+\\mathbf M\\mathbf J', meaning: '更新矩陣與線性化閉迴路矩陣', unit: '—', firstSeen: '§7' },
  { symbol: '\\rho(\\mathbf A)', meaning: 'spectral radius（$\\max_i|\\lambda_i|$）', unit: '—', firstSeen: '§7', note: 'regressor 相關係數另記 $\\rho_{GP}$' },
  { symbol: '\\sigma_i,\\ \\kappa', meaning: '奇異值與 condition number $\\sigma_{\\max}/\\sigma_{\\min}$', unit: '—', firstSeen: '§7' },
  { symbol: 'g_2(\\mu),\\ \\lambda(\\mu)', meaning: '均方係數 $E[(1-\\mu x^2)^2]$ 與 Lyapunov 指數 $E[\\log|1-\\mu x^2|]$', unit: '—', firstSeen: '§3', note: <>與迴路增益 <Tex>{'g'}</Tex> 區分；a.s. 界見 <ErratumTag id="E14" /></> },
  { symbol: 'n,\\ k_f,\\ p_U', meaning: '獨立試驗數、觀察到的失效數、失效機率上界', unit: '—', firstSeen: '§3.5' },
  { symbol: 'B_x,\\ B_\\text{acc},\\ F', meaning: 'GMAC 輸入位元、累加器位元、內部小數位元', unit: '\\text{bits}', firstSeen: '§6' },
  { symbol: 'T_\\text{lc}', meaning: 'limit cycle 週期（與閉迴路 $T=L/(1+L)$ 不同）', unit: '\\text{updates}', firstSeen: '§6' },
  { symbol: '\\delta t[n],\\ \\sigma_{\\delta t},\\ T', meaning: 'DTC 的補償誤差 $\\delta t=x\\,\\delta w$（reference 端的 DTC 多補償的時間：reference edge 少延遲、早到這麼多，殘差是 $-\\delta t$）、它的 RMS，與主 PLL 對輸出的 transfer $T=L/(1+L)$（DTC 殘差在 PD 的 reference 輸入注入，$\\theta_\\mathrm{out}=+T\\,\\phi_\\mathrm{dtc}$；輸出路徑用 $T$，不是 $H_\\mathrm{PD}$）', unit: '\\mathrm{fs},\\ \\mathrm{fs},\\ 1', firstSeen: '§8' },
]

/** 字串欄位中的 `$…$` 以 KaTeX 顯示（SymbolTable 的 meaning／note 是 ReactNode，不會自動轉）。 */
export const SYMBOL_ROWS: SymbolEntry[] = SYMBOLS.map((r) => ({ ...r, meaning: mathText(r.meaning), note: mathText(r.note) }))

/** 符號表的圖說：本頁一律 δ = a − w（全站約定）。 */
export const SYMBOL_CAPTION = String.raw`本頁一律 $\delta=a-w$；$K$、$\mu$ 的單位依 average-mode GMAC（$G$ 無因次）。粗體為矩陣。`
