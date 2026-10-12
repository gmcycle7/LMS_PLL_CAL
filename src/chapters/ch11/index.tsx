import { ClaimTag, ModelLevel, SourceTag, SymbolTable, TestBadge, type SymbolEntry } from '@/components'
import { Erratum, m } from './common'
import { IntroSection } from './sections/IntroSection'
import { ModelSection } from './sections/ModelSection'
import { FixedPointSection } from './sections/FixedPointSection'
import { OffsetSection } from './sections/OffsetSection'
import { InlSection } from './sections/InlSection'
import { CorrelatedSection } from './sections/CorrelatedSection'
import { NearIntegerSection } from './sections/NearIntegerSection'
import { LabSection } from './sections/LabSection'
import { WrapSection } from './sections/WrapSection'
import './chapter.css'

/**
 * 本章符號表（docs/teaching-style.md §5）：放在頁面最後（#symbols），章首只留一行跳轉。
 * 「首次出現」欄指正文第一次用一句話說明這個符號的地方。
 */
const SYMBOLS: SymbolEntry[] = [
  { symbol: 'x[n]', meaning: 'DTC / DSM code（GMAC 的 regressor）', unit: '—', firstSeen: '開場', note: m('正規化、無因次；$n$ = comparator sample') },
  { symbol: 'a', meaning: m('真實線性 DTC gain：feedback edge 早到 $a\\,x$，$w$ 應該校正到的值'), unit: '\\mathrm{t.u.}', firstSeen: '直覺' },
  { symbol: 'w,\\ w_k,\\ w^*', meaning: m('校正 gain（DTC 的補償量是 $w\\,x$）、第 $k$ 個 block 的值、固定點'), unit: '\\mathrm{t.u.}', firstSeen: '開場', note: m('$k$ = GMAC block；$\\delta=a-w$（全站約定）；相對固定點的偏移另記 $\\delta w=w-w^*$') },
  { symbol: 'e[n]', meaning: 'PD 的輸出：comparator 前的總誤差（送進 loop filter 的同一個節點）', unit: '\\mathrm{t.u.}', firstSeen: '開場' },
  {
    symbol: "T_0,\\ \\tau_\\mathrm{DTC},\\ t_\\mathrm{ref}',\\ t_\\mathrm{fb}",
    meaning: m("reference 端 DTC 的基準延遲（常數）與延遲 $\\tau_\\mathrm{DTC}=T_0-w\\,x$；DTC 延遲後的 reference edge 與 feedback（divider）edge 的時間，PD 量的是 $t_\\mathrm{ref}'-t_\\mathrm{fb}$"),
    unit: '\\mathrm{t.u.}',
    firstSeen: '直覺',
    note: m('$T_0$ 只讓鎖定的相位整個平移，不出現在 $e[n]$ 裡'),
  },
  { symbol: 'N', meaning: m('每個 GMAC block 的 comparator sample 數（$w$ 每 $N$ 個 sample 更新一次）'), unit: '—', firstSeen: '§11.A' },
  { symbol: 'e_\\mathrm{det}(x;w)', meaning: m('確定性殘差 $(a-w)x+b+d(x)+\\varepsilon_{cc}$'), unit: '\\mathrm{t.u.}', firstSeen: '§11.0' },
  { symbol: 'b', meaning: 'PD / comparator 靜態 offset', unit: '\\mathrm{t.u.}', firstSeen: '§11.0' },
  { symbol: 'd(x)=c_2x^2+c_3x^3', meaning: m('DTC INL：延遲偏離直線的量（code-dependent delay）；$c_2$、$c_3$ 是二階、三階係數'), unit: '\\mathrm{t.u.}', firstSeen: '§11.0', note: <>{m('規格 §11.2 的 $c$ 改記 $c_3$')} <Erratum id="E12" /></> },
  { symbol: '\\varepsilon_{cc}[n]=\\kappa\\,x[n]', meaning: m('code-correlated deterministic error（DJ）；$\\kappa$ 是耦合係數'), unit: '\\mathrm{t.u.}', firstSeen: '§11.0', note: <>{m('規格 §11 的 $u[n]$ 改名，避免與 $u=h*x$ 衝突')} <Erratum id="E12" /></> },
  { symbol: 'v[n],\\ \\sigma_v', meaning: m('Gaussian 雜訊與其標準差（與 $x$ 獨立）'), unit: '\\mathrm{t.u.}', firstSeen: '§11.0', note: <>{m('$\\sigma_v(x)$ 隨 code 時見')} <Erratum id="E17" /></> },
  { symbol: 'q[n]=\\operatorname{sign}(e[n])', meaning: m('1-bit comparator 輸出（$\\pm1$）'), unit: '—', firstSeen: '開場', note: m('MC 的 tie：$\\operatorname{sign}(0)=+1$') },
  { symbol: 'G_k', meaning: m('block 平均 GMAC $\\frac1N\\sum q\\,x$（MSE 時 $q\\to e$）'), unit: '—', firstSeen: '§11.A' },
  { symbol: 'K_q=\\sqrt{2/\\pi}/\\sigma_v', meaning: 'comparator 小訊號增益（平均輸出對輸入的斜率）', unit: '\\mathrm{t.u.}^{-1}', firstSeen: '§11.0' },
  { symbol: 't(x)', meaning: m('per-code 零誤差 gain：$e_\\mathrm{det}(x;t)=0$'), unit: '\\mathrm{t.u.}', firstSeen: '先算一次' },
  { symbol: 'B(x)', meaning: m('gain 項以外的確定性誤差 $b+d(x)+\\varepsilon_{cc}(x)$'), unit: '\\mathrm{t.u.}', firstSeen: '§11.1', note: 'F-11.12' },
  { symbol: '\\varphi', meaning: m('主迴路 DC null 加到 PD 的 static phase offset：經 VCO、divider 讓 feedback edge 再早到 $\\varphi$，誤差多一項 $+\\varphi$'), unit: '\\mathrm{t.u.}', firstSeen: '§11.1', note: <>勘誤 <Erratum id="E03" /></> },
  { symbol: 'k_\\varphi', meaning: m('主迴路積分路徑（servo）每個 sample 的步長：$\\varphi\\leftarrow\\varphi-k_\\varphi q$'), unit: '\\mathrm{t.u.}', firstSeen: '§11.1' },
  { symbol: 'e_\\mathrm{PD}', meaning: m('線性 PD 看到的誤差（不含獨立 comparator 自己的 offset $b$）；§11.4 指經過主迴路後出現在 PD 輸出的誤差'), unit: '\\mathrm{t.u.}', firstSeen: '§11.1' },
  { symbol: '\\bar\\varphi,\\ \\tilde\\varphi,\\ \\sigma_\\varphi', meaning: m('servo 輸出的平均值、抖動，以及抖動的標準差'), unit: '\\mathrm{t.u.}', firstSeen: '§11.1' },
  { symbol: 'h,\\ H_\\mathrm{PD}(z)', meaning: m('主 PLL 誤差路徑的脈衝響應與轉移函數（$H_\\mathrm{PD}=1/(1+L)$）：從 PD 的 reference 輸入端注入的擾動到 PD 輸出'), unit: '—', firstSeen: '§11.4' },
  { symbol: '\\beta[n]', meaning: m('到達 PD 的其他確定性誤差（不經過 $H_\\mathrm{PD}$ 的部分）'), unit: '\\mathrm{t.u.}', firstSeen: '§11.4' },
  { symbol: 'C=E[x\\,(h*x)]', meaning: '經 PLL 誤差路徑的有效相關（同 Ch06）', unit: '—', firstSeen: '§11.4', note: m('不是 §11 分子的 $E[x\\varepsilon_{cc}]$') },
  { symbol: 'B_\\mathrm{bias}', meaning: m('干擾 bias 項 $bE[x]+E[xd]+E[x\\varepsilon_{cc}]$'), unit: '\\mathrm{t.u.}', firstSeen: '§11.4' },
  { symbol: '\\Omega,\\ \\Omega_k,\\ \\Omega_n', meaning: m('離散時間頻率、第 $k$ 條諧波的頻率、主迴路自然頻率 $\\omega_nT_s$'), unit: '\\mathrm{rad/sample}', firstSeen: '§11.4' },
  {
    symbol: 'S=-\\partial E[G]/\\partial w',
    meaning: m('GMAC 的恢復斜率（$S>0$ 才是吸引的固定點）；Sign：$S\\approx K_qE[x^2]$，MSE：$S=E[x^2]$'),
    note: (
      <>
        {m('與全站的 $K=K_qC$ 是同一個量；規格 §11.4 與 Ch04／Ch08 量測用的 $S_\\mathrm{GMAC}=\\partial E[G]/\\partial w=-S$（正確極性時為負）')} <Erratum id="E13" />
      </>
    ),
    unit: '\\mathrm{t.u.}^{-1}\\ (\\text{Sign})',
    firstSeen: '§11.A',
  },
  {
    symbol: '\\sigma_\\mathrm{eff}',
    meaning: m('DC null 模式下 comparator 實際感受到的雜訊：$\\sigma_\\mathrm{eff}^2=\\sigma_v^2+\\operatorname{Var}(\\varphi)$（servo 的 $\\varphi$ 抖動也是 dither）'),
    unit: '\\mathrm{t.u.}',
    firstSeen: '§11.1',
    note: '本站延伸（以 Monte Carlo 驗證）',
  },
  { symbol: '\\eta_k', meaning: m('第 $k$ 個 block 的 GMAC 抽樣雜訊（零均值，變異數約 $E[x^2]/N$）：$G_k=E[G](w_k)+\\eta_k$'), unit: '—', firstSeen: '§11.B' },
  { symbol: "G''(w^*)", meaning: m('平均 GMAC 曲線 $E[G](w)$ 在固定點的二階導數（曲率）；MSE-LMS 的 $E[G]$ 是直線，$G\'\'=0$'), unit: '\\mathrm{t.u.}^{-2}', firstSeen: '§11.B' },
  { symbol: '\\Delta,\\ \\hat S', meaning: m('量測斜率時凍結 gain 的小偏移 $\\Delta$，以及恢復斜率的估計 $\\hat S=(G_--G_+)/(2\\Delta)$（$G_\\pm$ 是 $w\\pm\\Delta$ 處量到的平均 GMAC）'), unit: '\\mathrm{t.u.},\\ \\mathrm{t.u.}^{-1}', firstSeen: '§11.4', note: <>{m('$\\hat S=-\\hat S_\\mathrm{GMAC}$')} <Erratum id="E13" /></> },
  { symbol: '\\mathrm{frac},\\ K,\\ P', meaning: m('FCW 的小數部分、16-bit 累加器的整數碼 $K=\\mathrm{frac}\\cdot2^{16}$，以及 first-order DSM residue 的週期 $P=2^{16}/\\gcd(K,2^{16})$'), unit: '\\mathrm{samples}\\ (P)', firstSeen: '§11.4' },
  { symbol: '\\mu,\\ g=\\mu S', meaning: m('學習率與正規化 loop gain（平均 pole $1-g$）'), unit: '\\mathrm{t.u.}\\ (\\text{Sign})', firstSeen: '§11.A', note: m('MSE-LMS 的 $\\mu$ 與 $S$ 都無因次；兩者的 $g=\\mu S$ 都無因次') },
]

/** 頁內跳轉：HashRouter 下不能用 href="#id"（會被當成路由），改用 scrollIntoView；jsdom 沒有 scrollIntoView，所以用可選呼叫。 */
function jumpTo(id: string, focusId = id) {
  document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  document.getElementById(focusId)?.focus?.({ preventScroll: true }) // 鍵盤／螢幕閱讀器的焦點跟著過去
}

/** Ch11：GMAC 歸零不代表 DTC Error 為零（規格 §11；勘誤 E01 / E03 / E11 / E12 / E17；T12）。 */
export default function Chapter11() {
  return (
    <div className="ch11" id="ch11-top">
      <p className="ch11-tags">
        <ModelLevel level="L1" /> <ModelLevel level="L2" /> <ClaimTag kind="exact" /> <ClaimTag kind="approx" /> <SourceTag kind="illustrative" /> <TestBadge id="T12" />
        <Erratum id="E01" />
        <Erratum id="E03" />
        <Erratum id="E11" />
        <Erratum id="E12" />
        <Erratum id="E13" />
        <Erratum id="E17" />
      </p>
      <p className="ch11-symbols-link">
        <button type="button" className="ch11-jump" id="ch11-symbols-jump" onClick={() => jumpTo('symbols')}>
          本章符號表在最後 ↓
        </button>
      </p>
      <IntroSection />
      <ModelSection />
      <FixedPointSection />
      <OffsetSection />
      <InlSection />
      <CorrelatedSection />
      <NearIntegerSection />
      <LabSection />
      <WrapSection />
      <section id="symbols" className="ch11-symbols" tabIndex={-1} aria-label="本章符號表">
        <SymbolTable
          rows={SYMBOLS}
          title="本章符號表"
          caption="t.u. = 本章統一的正規化時間單位（例如 1 fs 或 1 DTC LSB）；所有例子為示意（illustrative），不是晶片量測值。「首次出現」是正文第一次用一句話說明該符號的段落。"
        />
        <p className="ch11-symbols-back">
          <button type="button" className="ch11-jump" onClick={() => jumpTo('ch11-top', 'ch11-symbols-jump')}>
            ↑ 回到章首
          </button>
        </p>
      </section>
    </div>
  )
}
