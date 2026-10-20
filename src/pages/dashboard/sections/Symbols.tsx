import { memo } from 'react'
import { Link } from 'react-router-dom'
import { revealAnchor, type SymbolEntry, SymbolTable } from '@/components'
import { ErratumLink, Rich } from '../ui'
import { FoldCard } from './FoldCard'

const R = (t: string) => <Rich text={t} />

/** 頁末符號表的錨點（docs/teaching-style.md §5：符號表放最後，外層 id="symbols"）。 */
export const SYMBOLS_ANCHOR = 'symbols'

/** 本頁符號（原本在「一條方程式」那一節的開頭；docs/teaching-style.md §5 改放頁末）。「首次出現」欄是規格書的節號。 */
export const DASH_SYMBOLS: SymbolEntry[] = [
  { symbol: 'a', meaning: '理想（真實）校正係數，例如 DTC gain', unit: '\\mathrm{fs}', firstSeen: '§0', note: <>單位 = [PD error]/[code]（<ErratumLink eid="E13" />）</> },
  { symbol: 'w_k', meaning: R('第 $k$ 個 GMAC block 使用的係數'), unit: '\\mathrm{fs}', firstSeen: '§0' },
  { symbol: '\\delta_k=a-w_k', meaning: '剩餘參數誤差', unit: '\\mathrm{fs}', firstSeen: '§0', note: <>全站極性（規格 §3 原寫 <Rich text="$w-a$" />，<ErratumLink eid="E32" />）</> },
  { symbol: 'w^*,\\ \\Delta w=w^*-a', meaning: 'LMS 的平均固定點，與它相對真值的偏移（gain bias）', unit: '\\mathrm{fs}', firstSeen: '§11', note: R('推導 2：$\\Delta w=B/C$') },
  { symbol: '\\delta w_k=w_k-w^*', meaning: R('相對固定點的係數雜訊（極性與 $\\delta$ 相反）'), unit: '\\mathrm{fs}', firstSeen: '§12', note: <ErratumLink eid="E33" /> },
  { symbol: 'x[n]', meaning: R('DSM / DTC code（regressor），$n$ 為 comparator sample'), firstSeen: '§0', note: '正規化、無因次' },
  {
    symbol: '\\tau_{\\mathrm{DTC}}[n]=T_0-w\\,x[n]',
    meaning: R('reference 端 DTC 的延遲：固定的基準延遲 $T_0$ 減去補償量 $w\\,x[n]$（DTC 只能延遲、不能提前；$T_0$ 被 PLL 當成靜態相位偏移吸收）'),
    unit: '\\mathrm{fs}',
    firstSeen: '系統地圖',
    note: R('code $x$ 越大，延遲越短'),
  },
  {
    symbol: "t_{\\mathrm{ref}}'[n],\\ t_{\\mathrm{fb}}[n]",
    meaning: R("DTC 延遲後的 reference edge 與 feedback（divider）edge 的時刻；PD 量的是 $e[n]=t_{\\mathrm{ref}}'[n]-t_{\\mathrm{fb}}[n]=(a-w)\\,x[n]+v[n]$"),
    unit: '\\mathrm{fs}',
    firstSeen: '系統地圖',
  },
  { symbol: 'P_x=E[x^2]', meaning: R('code 功率；單頻 $x=A\\cos\\Omega n$ 時 $P_x=A^2/2$'), firstSeen: '§6.1', note: <>僅 <Rich text="$0<\Omega<\pi$" />（<ErratumLink eid="E46" />）</> },
  { symbol: 'u[n]=(h*x)[n]', meaning: '經 PLL error path 到 PD 的有效 regressor', firstSeen: '§0', note: <>與 <Rich text="$x$" /> 同單位（<ErratumLink eid="E13" />）</> },
  { symbol: '|H|,\\ \\phi', meaning: R('error path $H(e^{j\\Omega})$ 在 code 頻率的幅度與相位'), unit: '1,\\ {}^\\circ', firstSeen: '§6.1', note: R('離散時間響應，不可代入 $H(j\\Omega)$（勘誤 E44）') },
  { symbol: '\\Omega', meaning: 'code 的離散角頻率', unit: '\\mathrm{rad/sample}', firstSeen: '§6.1' },
  { symbol: 'D', meaning: 'GMAC 的 code delay', unit: '\\mathrm{samples}', firstSeen: '§7', note: R('與 $d$（blocks）不同') },
  { symbol: '\\theta=\\phi+\\Omega D', meaning: '補償後的殘餘相位', unit: '{}^\\circ', firstSeen: '§7' },
  { symbol: 'M_{\\mathrm{pol}}=\\arcsin(\\cos\\theta)', meaning: '極性裕度（polarity margin）', unit: '{}^\\circ', firstSeen: '§8.1', note: <>規格寫 <Rich text="$90^\circ-|\mathrm{wrap}_{180}(\theta)|$" />（<ErratumLink eid="E20" />）；加下標以免和更新矩陣 <Rich text="$\mathbf M$" /> 混淆</> },
  {
    symbol: '\\varepsilon_{\\mathrm{det}}[n]',
    meaning: R('與 code 相關的 deterministic 干擾總和：$\\varepsilon_{\\mathrm{det}}=b+d(x)+\\varepsilon_{\\mathrm{cc}}$（offset、INL、code-correlated deterministic error）'),
    unit: '\\mathrm{fs}',
    firstSeen: '§11',
    note: <>規格原以 <Rich text="$u$" /> 表示其中一項，與上面的 <Rich text="$u$" /> 衝突，改名（<ErratumLink eid="E12" />）</>,
  },
  { symbol: 'v[n]', meaning: R('comparator 前的隨機雜訊，RMS 為 $\\sigma_v$'), unit: '\\mathrm{fs}', firstSeen: '§0' },
  { symbol: 'e[n]=e_{\\mathrm{det}}[n]+v[n]', meaning: R('PD 的輸出（送進 loop filter 的同一個訊號），也是 comparator 的輸入；$e_{\\mathrm{det}}=(a-w)\\,u+\\varepsilon_{\\mathrm{det}}$ 是其中不含隨機雜訊的部分'), unit: '\\mathrm{fs}', firstSeen: '§5、§11' },
  { symbol: 'q[n]=\\mathrm{sign}(e[n])', meaning: '1-bit comparator 輸出', unit: '\\pm1', firstSeen: '§0', note: R('硬體 0/1 先映射 $q=2b-1$') },
  { symbol: 'K_q=\\sqrt{2/\\pi}/\\sigma_v', meaning: 'comparator 的統計小訊號增益', unit: '\\mathrm{fs}^{-1}', firstSeen: '§5.1' },
  { symbol: 'C=E[x\\,u]', meaning: 'code 與有效 regressor 的相關（決定極性）', firstSeen: '§6', note: R('單頻：$C=P_x|H|\\cos\\theta$') },
  { symbol: 'B=E[x\\,\\varepsilon_{\\mathrm{det}}]', meaning: '干擾與 code 的相關（決定 bias）', unit: '\\mathrm{fs}', firstSeen: '§11.4' },
  { symbol: 'G_k', meaning: R('GMAC block 平均 $\\tfrac1N\\sum_n q[n]\\,x[n-D]$，$k$ 為 block 索引'), firstSeen: '§0', note: <>sum 模式要再乘 <Rich text="$s=N$" />（average 時 <Rich text="$s=1$" />；<ErratumLink eid="E18" />）</> },
  { symbol: '\\eta_k,\\ \\sigma_\\eta^2', meaning: R('$G_k$ 的零均值隨機部分（GMAC 雜訊）與它的變異數，$\\sigma_\\eta^2\\approx P_x/N$'), firstSeen: '§12', note: <ErratumLink eid="E30" /> },
  { symbol: '\\mu', meaning: '學習率（average-mode GMAC）', unit: '\\mathrm{fs}', firstSeen: '§0' },
  { symbol: 'g=\\mu K_qC,\\ p=1-g', meaning: '正規化 loop gain 與 calibration pole（無因次）', firstSeen: '§8.2' },
  { symbol: 'd,\\ g^*(d)', meaning: R('係數 commit 延遲，與該延遲下的臨界 loop gain $g^*=2\\sin\\frac{\\pi}{4d+2}$'), unit: '\\mathrm{blocks},\\ 1', firstSeen: '§8.3' },
  { symbol: 'y_m', meaning: R('校正迴路的脈衝響應（第 $m$ 個 block 還剩多少），$\\sum_m y_m^2$ 是白雜訊的功率增益'), firstSeen: '推導 6' },
  { symbol: '\\sigma_w', meaning: R('係數 $w_k$ 在固定點附近的穩態 RMS（gain-equivalent，不是輸出 jitter）'), unit: '\\mathrm{fs}', firstSeen: '§12.1' },
  { symbol: '\\mathbf R,\\ \\tilde{\\mathbf R},\\ \\lambda_{\\min}', meaning: R('有效 regressor 的自相關矩陣 $\\mathbf R=E[\\mathbf u\\mathbf u^T]=|H|^2P_x\\tilde{\\mathbf R}$、正規化後的 $\\tilde{\\mathbf R}$（特徵值 $\\tilde\\lambda_i$）與最小特徵值'), firstSeen: '§9' },
  {
    symbol: '\\rho,\\ \\kappa',
    meaning: R('兩個 regressor 的零延遲相關係數 $\\rho=E[x_1x_2]/P_x$，與 condition number $\\kappa=\\lambda_{\\max}/\\lambda_{\\min}$'),
    firstSeen: '§9、§10.1',
    note: R('雙參數模型另外假設交叉相關 $E[x_iu_j]=C\\,\\tilde R_{ij}$（見體檢的「假設」）'),
  },
  {
    symbol: '\\psi_i,\\ r_{ij}[m]',
    meaning: R('同頻單頻 code $x_i=A\\cos(\\Omega n+\\psi_i)$ 的相位（$\\rho=\\cos(\\psi_2-\\psi_1)$），與兩個 code 在延遲 $m$ 的交叉相關 $r_{ij}[m]=E[x_i[n]\\,x_j[n+m]]$'),
    unit: '{}^\\circ,\\ 1',
    firstSeen: '推導 7',
    note: 'F-DB.6',
  },
  { symbol: '\\mathbf M', meaning: R('多參數的更新矩陣：$\\mathbf w_{k+1}=\\mathbf w_k+\\mathbf M\\,\\mathbf G_k$；一般 LMS $\\mathbf M=\\mu\\mathbf I$，preconditioned $\\mathbf M=\\mu\\tilde{\\mathbf R}^{-1}$'), unit: '\\mathrm{fs}', firstSeen: '§10' },
  { symbol: '\\boldsymbol\\xi=\\mathbf V^T\\boldsymbol\\delta', meaning: R('eigen-mode 座標下的參數誤差（$\\mathbf V$ 的欄是 $\\tilde{\\mathbf R}$ 的特徵向量）'), unit: '\\mathrm{fs}', firstSeen: '§10.1', note: <ErratumLink eid="E05" /> },
  { symbol: 'N,\\ f_s,\\ f_u=f_s/N', meaning: 'block 長度、comparator 取樣率、block 更新率', unit: '\\mathrm{samples},\\ \\mathrm{Hz},\\ \\mathrm{Hz}', firstSeen: '§0' },
  { symbol: '\\delta t[n],\\ \\sigma_{\\delta t}', meaning: R('DTC 實際的補償量 $w_k\\,x[n]$ 與需要的補償量 $a\\,x[n]$ 的差 $(w_k-a)\\,x[n]$，與它的 RMS（DTC-referred）'), unit: '\\mathrm{fs}', firstSeen: '§12.2', note: <>同一個 block 內 <Rich text="$w_k$" /> 不變（block rate 的係數以 ZOH 展開到每個 sample，<ErratumLink eid="E09" />）</> },
  { symbol: 'A_t,\\ \\beta', meaning: R('code tone 的 timing 幅度（peak）與對應的輸出相位調變指數 $\\beta=2\\pi f_{\\mathrm{out}}|T|A_t$'), unit: '\\mathrm{fs},\\ \\mathrm{rad}', firstSeen: '§12.4' },
  { symbol: 'f_{\\mathrm{out}},\\ |T|', meaning: 'PLL 輸出頻率，與 output transfer 在 tone 頻率偏移處的幅度', unit: '\\mathrm{Hz},\\ 1', firstSeen: '§12.3' },
  {
    symbol: '\\sigma_{\\delta t,\\max},\\ \\mathrm{Spur}_{\\max}',
    meaning: R('條件 6 的兩個預算：DTC-referred timing error RMS $\\sigma_{\\delta t}$ 的上限，與單 tone spur 的上限（體檢的控制項，illustrative 規格）'),
    unit: '\\mathrm{fs},\\ \\mathrm{dBc}',
    firstSeen: '動手體檢',
  },
  { symbol: 'k_{95}', meaning: R('平均暫態（相對於固定點）最後一次超過初值 5% 的下一個 block；$d=0$ 時是 $\\lceil\\ln0.05/\\ln|1-g_i|\\rceil$，$d\\ge1$ 時由平均遞迴逐 block 數出'), unit: '\\mathrm{blocks}', firstSeen: '推導 7、動手體檢' },
  { symbol: "g'", meaning: R('不含 $\\cos\\theta$ 的 loop gain $g\'=\\mu\\,s\\,K_qP_x|H|$（$g=g\'\\cos\\theta$）；只用在雙參數假設的對照（F-DB.6）'), firstSeen: '動手體檢' },
]

/**
 * 頁首只留這一行：按了捲到頁末的符號表（HashRouter 下不能用 href="#symbols"，那會被當成路由）。
 * onJump：頁內跳轉（預設 revealAnchor）；Beginner 模式符號表收在卡片裡，index.tsx 傳入的版本會先展開再捲。
 */
export function SymbolsJump({ onJump = revealAnchor }: { onJump?: (id: string) => void }) {
  return (
    <p className="dash-symbols-jump">
      <button type="button" className="dash-linkbtn" onClick={() => onJump(SYMBOLS_ANCHOR)}>
        本頁符號表在最後 ↓
      </button>
      <span className="dash-symbols-jump-note">每個符號第一次出現時，正文會先用一句話說明。</span>
    </p>
  )
}

/**
 * 頁末的符號表：排在「本頁必記」與頁尾說明之後，是整頁最後一個區塊。
 * folded（Beginner）：整張表（約 40 列、每列兩條公式）收成一張卡片，展開才渲染；符號表的內容主要是「一條方程式」那一節的符號，那一節在 Beginner 也是收合的。
 */
export const SymbolsSection = memo(function SymbolsSection({
  folded = false,
  open,
  onOpenChange,
}: {
  folded?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const table = <SymbolTable title="本頁符號（$n$ 為 comparator sample、$k$ 為 GMAC block）" rows={DASH_SYMBOLS} />
  return (
    <section id={SYMBOLS_ANCHOR} className="dash-symbols" aria-labelledby="dash-symbols-h">
      <h2 id="dash-symbols-h" className="dash-h2">
        本頁符號表
      </h2>
      <p className="dash-lead-sm">
        整頁用到的符號集中列在這裡，忘記某個符號時回來查：單位、在規格書第幾節第一次出現，以及有勘誤或同一個字母有兩種用法時本站採用的定義。全站的符號總表在{' '}
        <Link to="/formulas">Formula &amp; Unit Reference</Link>。{' '}
        <button type="button" className="dash-linkbtn" onClick={() => revealAnchor('dash-title')}>
          ↑ 回到頁首
        </button>
      </p>
      {folded ? (
        <FoldCard
          title={`${DASH_SYMBOLS.length} 個符號與單位`}
          desc="每個符號的意思、單位與第一次出現的位置；多半是「六條件一分鐘體檢」那一段用到的，讀完 Part B 再來查就好。"
          open={open}
          onOpenChange={onOpenChange}
        >
          {table}
        </FoldCard>
      ) : (
        table
      )}
    </section>
  )
})
