import { SymbolTable, Tex, type SymbolEntry } from '@/components'
import { ErrataNote, JumpTo, tm } from '../common'

/** 章末符號表的錨點（章首的「本章符號表在最後」會捲到這裡）。 */
export const SYMBOLS_ID = 'symbols'
/** 章首的錨點（章末的「回到章首」會捲到這裡）。 */
export const TOP_ID = 'ch02-top'

/**
 * 本章符號表（docs/teaching-style.md §5：放在章末）。
 * 「首次出現」欄只放純文字（§ 編號）；意義與備註裡的數學一律用 KaTeX。
 * 表格在最後，所以正文裡每個符號第一次出現時都另有一句就地說明——這裡是回頭查用的。
 */
export const SYMBOLS: SymbolEntry[] = [
  { symbol: 'a', meaning: '真實（未知）係數；校正時就是理想 DTC gain 等', unit: '[y]/[x]', firstSeen: '§1' },
  { symbol: 'w_n', meaning: tm('第 $n$ 筆資料時的係數估計（我們能改的旋鈕）；方塊圖裡寫成 $w[n]$'), unit: '[a]', firstSeen: '§1' },
  { symbol: 'x_n,\\;y_n', meaning: tm('第 $n$ 筆輸入（regressor）與量測輸出；方塊圖裡寫成 $x[n]$、$y[n]$。DTC 校正時 $x[n]$ 是 DSM 殘差 code，$a\\,x[n]$ 是 divider 的 feedback edge 比理想時刻早到的時間'), unit: '[x],\\ [y]', firstSeen: '§1' },
  { symbol: '\\hat y_n=w_nx_n', meaning: tm('預測值：用目前的 $w_n$ 猜的輸出；DTC 校正時就是 reference 端 DTC 的補償量（從基準延遲 $T_0$ 往回扣、reference edge 少延遲的時間）'), unit: '[y]', firstSeen: '§1' },
  { symbol: 'v_n,\\;\\sigma_v', meaning: tm('量測雜訊與它的標準差（形狀可為 Gaussian / Laplacian / impulsive / skewed，四種都正規化成同一個 $\\sigma_v$，見 §3 的雜訊形狀表）'), unit: '[y]', firstSeen: '§2' },
  { symbol: 'e_n=y_n-w_nx_n', meaning: tm('預測誤差（comparator 之前的訊號；PLL 裡就是 PD 的輸出 $e[n]$）：量到的減掉預測的'), unit: '[y]', firstSeen: '§1' },
  { symbol: '\\Delta w_n', meaning: tm('這一步的更新量：$w_{n+1}=w_n+\\Delta w_n$'), unit: '[a]', firstSeen: '§1' },
  { symbol: '\\delta_n=a-w_n', meaning: '參數誤差', unit: '[a]', firstSeen: '§1', note: tm('全站極性 $\\delta=a-w$（規格 §3 曾寫 $w-a$，勘誤 E39）') },
  { symbol: 'd=a-w', meaning: tm('同 $\\delta$，但在期望值裡當作固定的數（mean-field 推導用）'), unit: '[a]', firstSeen: '§3', note: tm('與 Ch08 的 update delay $d$ 無關') },
  { symbol: 'J(w)=\\tfrac12E[e^2]', meaning: '平均成本（MSE 的一半）', unit: '[y]^2', firstSeen: '§1', note: <>本章採含 <Tex>{'\\tfrac12'}</Tex> 的定義 <ErrataNote id="E41" /></> },
  { symbol: "J'(w),\\;J''(w)", meaning: tm('成本對 $w$ 的一階、二階導數（切線斜率、彎曲程度）'), firstSeen: '§1' },
  { symbol: 'p=1-\\mu K', meaning: tm("pole：每一步參數誤差縮小的倍率，$\\delta_{n+1}=p\\,\\delta_n$；§1 的 $K=J''$"), unit: '1', firstSeen: '§1', note: tm('收斂需 $|p|<1$（四種行為見 Ch03）') },
  {
    symbol: '\\mu,\\;\\mu_n',
    meaning: tm('步長（learning rate）；$\\mu_n$ 為第 $n$ 步的步長（排程）'),
    firstSeen: '§1',
    note: tm('單位依演算法：LMS $1/[x]^2$；Sign-Error $[w]/[x]$；Sign-Sign $[w]$'),
  },
  { symbol: '\\mu_0,\\;n_0', meaning: tm('遞減步長 $\\mu_n=\\mu_0/(1+n/n_0)$ 的初值與時間常數'), unit: '[\\mu],\\ \\text{samples}', firstSeen: '§3' },
  { symbol: '\\mu_{\\min}', meaning: tm('gear-shift 排程的步長下限（降到這裡就不再變小，保留追蹤能力）'), unit: '[\\mu]', firstSeen: '§3' },
  { symbol: 'D,\\;N_{\\rm reach}', meaning: tm('遞減步長要走完的距離 $D=|a-w_0|$，與走完它大約需要的步數'), unit: '[a],\\ \\text{samples}', firstSeen: '§3', note: tm('與 Part B 的 code delay $D$ 無關') },
  { symbol: 'c=\\mu_0n_0', meaning: tm('遞減步長的漸近係數：$n\\gg n_0$ 時 $\\mu_n\\approx c/n$（Research 模式的推導）'), firstSeen: '§3' },
  { symbol: '\\hat g_n', meaning: tm('單筆隨機梯度（stochastic gradient）$-e_nx_n$'), firstSeen: '§2' },
  { symbol: 'N,\\;B', meaning: tm('資料筆數與 mini-batch 大小（每累加 $B$ 筆更新一次）'), unit: '\\text{samples}', firstSeen: '§2', note: tm('GMAC 的 block 長度 $N$ 就是 $B$；Ch11 的 $B$（bias 項）與此無關') },
  {
    symbol: 'G_k,\\;k',
    meaning: tm('GMAC 在第 $k$ 個 block 的平均 $G_k=\\frac1N\\sum q[n]\\,x[n]$；$k$ 是 block 索引（$n$ 是 sample 索引）'),
    unit: '[x]',
    firstSeen: '§2',
    note: tm('每個 block 更新一次：$w_{k+1}=w_k+\\mu G_k$'),
  },
  { symbol: 'f_s,\\;f_u', meaning: tm('comparator 的取樣率與係數的更新率 $f_u=f_s/N$'), unit: '\\mathrm{Hz}', firstSeen: '§2' },
  { symbol: 'E[\\cdot]', meaning: '期望值：「做很多次再平均」的極限', firstSeen: '§2' },
  { symbol: 'P_x=E[x^2]', meaning: '輸入功率', unit: '[x]^2', firstSeen: '§2' },
  { symbol: 'E[x^4]', meaning: tm('輸入的四階動差（$x$ 四次方的平均）；出現在 LMS 的穩態 MSD 與均方穩定界'), unit: '[x]^4', firstSeen: '§2', note: 'Ch03 詳細討論' },
  { symbol: 'w_{LS}', meaning: tm('有限 $N$ 筆資料的最小平方解 $\\sum x_iy_i/\\sum x_i^2$（batch GD 收斂到的點）'), unit: '[a]', firstSeen: '§2' },
  { symbol: 'E[\\delta^2]_\\infty', meaning: '穩態的均方偏差（MSD）：收斂之後參數誤差平方的平均', unit: '[a]^2', firstSeen: '§2', note: <>不是成本 MSE <ErrataNote id="E42" /></> },
  {
    symbol: '\\operatorname{sign}(\\cdot)',
    meaning: tm('正負號；$\\operatorname{sign}(0)$ 的慣例必須明定'),
    firstSeen: '§3',
    note: <>{tm('數學 $0$ 或 comparator $\\pm1$')} <ErrataNote id="E40" /></>,
  },
  {
    symbol: 'q_n=\\operatorname{sign}(e_n)',
    meaning: tm('1-bit comparator 的輸出（$\\pm1$）；方塊圖裡寫成 $q[n]$'),
    unit: '1',
    firstSeen: '§2',
    note: tm('硬體輸出 0/1 的 $b$ 時要先映射 $q=2b-1$（§5、Ch05）'),
  },
  { symbol: 'h=\\mu|x|', meaning: 'Sign-Error 每步固定的移動量（limit-cycle 帶寬）', unit: '[a]', firstSeen: '§3', note: tm('與 Part B 的 error-path 脈衝響應 $h[n]$（$u=h*x$）無關') },
  {
    symbol: 'n_c,\\;\\rho',
    meaning: tm('Sign-Error 進入 limit cycle 前走的整步數 $n_c=\\lfloor|\\delta_0|/h\\rfloor$ 與剩下不到一步的距離 $\\rho=|\\delta_0|-n_ch$'),
    unit: '\\text{samples},\\ [a]',
    firstSeen: '§3',
    note: tm('不寫成 $k$、$r$：$k$ 是 GMAC block 索引，$r$ 留給 §4 的比值 $y/x$'),
  },
  { symbol: '\\psi(w)', meaning: tm('平均更新方向 $E[\\Delta w]/\\mu$（mean-field drift）；固定點 $\\psi(w^*)=0$'), firstSeen: '§3' },
  { symbol: 'w^*', meaning: tm('固定點（平均更新為零的 $w$）；不同演算法一般不同'), unit: '[a]', firstSeen: '§2' },
  { symbol: 'F_v,\\;f_v', meaning: '雜訊的累積分布函數（CDF）與機率密度（PDF）', unit: '1,\\ 1/[y]', firstSeen: '§3' },
  { symbol: '\\Phi(z)', meaning: tm('標準常態分布的 CDF：$F_v(t)=\\Phi(t/\\sigma_v)$（Gaussian 雜訊）'), unit: '1', firstSeen: '§3' },
  { symbol: 'K_q', meaning: tm('1-bit comparator 的統計小訊號增益 $2f_v(0)$；Gaussian 雜訊時為 $\\sqrt{2/\\pi}/\\sigma_v$'), unit: '1/[y]', firstSeen: '§3', note: 'Ch05 詳細推導' },
  {
    symbol: 'K',
    meaning: tm("線性化斜率 $K=-\\psi'(w^*)$（每單位步長的 loop gain）"),
    firstSeen: '§3',
    note: tm('LMS：$K=E[x^2]$；Gaussian 雜訊的 Sign-Error：$K=K_{\\rm SE}=K_qE[x^2]$（Ch05）'),
  },
  { symbol: 'g=\\mu K,\\;\\tau', meaning: tm('正規化 loop gain 與時間常數 $\\tau=-1/\\ln|1-\\mu K|\\approx1/g$'), unit: '1,\\ \\text{samples}', firstSeen: '§5' },
  { symbol: '\\sigma_w,\\;\\mu_{\\rm L}', meaning: tm('係數 $w$ 的穩態標準差（抖動）；$\\mu_{\\rm L}$ 是和 Sign-Error 同收斂速度的 LMS 步長（綜合手算）'), unit: '[a],\\ 1/[x]^2', firstSeen: '§6' },
  { symbol: '\\eta_n,\\;\\sigma_\\eta^2', meaning: tm('梯度雜訊（單步更新方向偏離平均的部分）與它在 $w^*$ 處的變異'), firstSeen: '§3' },
  { symbol: 'r_n=y_n/x_n', meaning: '單筆「比值」估計；四種演算法的固定點都是它的加權平均／中位數', unit: '[a]', firstSeen: '§4' },
  {
    symbol: '\\tilde\\mu,\\;\\varepsilon',
    meaning: 'NLMS 的無因次步長與正規化常數',
    unit: '1,\\ [x]^2',
    firstSeen: '§4、§5',
    note: tm('§4 的比值觀點先用 $\\varepsilon=0$ 的特例；Ch01 用 $\\varepsilon$ 表示 outlier 機率，本章 $\\varepsilon$ 只給 NLMS'),
  },
  { symbol: 'e^+', meaning: tm('a posteriori 誤差：更新之後，同一筆資料再算一次的誤差 $y-w_{n+1}x$'), unit: '[y]', firstSeen: '§5' },
  { symbol: 'B_e,\\;B_x', meaning: tm('誤差 $e$ 與輸入 $x$ 的位元數（乘法器的大小約正比於 $B_e\\times B_x$）'), unit: '\\text{bits}', firstSeen: '§5' },
  {
    symbol: 'p_{\\rm out},\\;s',
    meaning: tm('單邊 outlier：每筆以機率 $p_{\\rm out}$ 在雜訊上加一個固定的 $s$'),
    unit: '1,\\ [y]',
    firstSeen: '§3',
    note: tm('下標 out 用來與 pole $p$ 區分（Ch01 寫作 $\\varepsilon,\\ s$）'),
  },
  {
    symbol: '\\psi_{\\rm H}(e),\\;\\delta_{\\rm H}',
    meaning: tm('Huber 的截斷函數 $\\psi_{\\rm H}(e)=\\max(-\\delta_{\\rm H},\\min(e,\\delta_{\\rm H}))$ 與門檻'),
    unit: '[y]',
    firstSeen: '§5',
    note: tm('下標 H 用來與漂移函數 $\\psi(w)$、參數誤差 $\\delta_n$ 區分（lms.ts 的程式註解寫作 $\\psi_\\delta$）'),
  },
  { symbol: 'R', meaning: tm('Monte Carlo 的次數：用 $R$ 個不同的 seed 各跑一次'), unit: '1', firstSeen: '§5', note: tm('與 Ch09–Ch10 的相關矩陣 $R$ 無關') },
  { symbol: 'A', meaning: tm('幅度固定的 code：$x=\\pm A$ 等機率（綜合手算與 §6）'), unit: '[x]', firstSeen: '§5' },
]

/** 章首只留這一行：按下去捲到章末的符號表（HashRouter 下不能用 href="#symbols"）。 */
export function SymbolsLink() {
  return (
    <p className="ch02-symbols-link">
      <JumpTo target={SYMBOLS_ID}>本章符號表在最後 ↓</JumpTo>
      ：每個符號第一次出現時，正文會就地用一句話說明。
    </p>
  )
}

/** 章末的符號表（頁面最後一個區塊）。 */
export function ChapterSymbols() {
  return (
    <section id={SYMBOLS_ID} className="ch02-symbols" tabIndex={-1} aria-label="本章符號表">
      <h2 id="ch02-symbols-title">本章符號表</h2>
      <p className="ch02-note">
        每個符號第一次出現時正文都有一句說明；這裡把它們收在一起，方便回頭查。<JumpTo target={TOP_ID}>回到章首 ↑</JumpTo>
      </p>
      <SymbolTable
        rows={SYMBOLS}
        caption={tm(
          '時間索引 $n$ 為 sample（comparator 取樣）；Part B 的 GMAC block 用 $k$。方塊圖用方括號寫時間索引（$w[n]$ 就是 $w_n$）。單位欄的 $[x]$、$[y]$、$[a]=[y]/[x]$ 表示「與該量同單位」：校正時 $[y]$ 是時間誤差（fs），$[x]$ 是正規化 code（無因次）。',
        )}
      />
    </section>
  )
}
