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

const SYMBOLS: SymbolEntry[] = [
  { symbol: 'x[n]', meaning: 'DTC / DSM code（GMAC 的 regressor）', unit: '—', firstSeen: '§11.0', note: m('正規化、無因次；$n$ = comparator sample') },
  { symbol: 'a', meaning: '真實線性 DTC gain', unit: '\\mathrm{t.u.}', firstSeen: '§11.0' },
  { symbol: 'w,\\ w_k,\\ w^*', meaning: m('校正 gain、第 $k$ 個 block 的值、固定點'), unit: '\\mathrm{t.u.}', firstSeen: '§11.0', note: m('$k$ = GMAC block；$\\delta=a-w$（全站約定）；相對固定點的偏移另記 $\\delta w=w-w^*$') },
  { symbol: 'e[n]', meaning: 'comparator 前的總誤差', unit: '\\mathrm{t.u.}', firstSeen: '§11.0' },
  { symbol: 'e_\\mathrm{det}(x;w)', meaning: m('確定性殘差 $(a-w)x+b+d(x)+\\varepsilon_{cc}$'), unit: '\\mathrm{t.u.}', firstSeen: '§11.0' },
  { symbol: 'b', meaning: 'PD / comparator 靜態 offset', unit: '\\mathrm{t.u.}', firstSeen: '§11.1' },
  { symbol: 'd(x)=c_2x^2+c_3x^3', meaning: 'DTC INL（code-dependent delay）', unit: '\\mathrm{t.u.}', firstSeen: '§11.2', note: <>{m('規格 §11.2 的 $c$ 改記 $c_3$')} <Erratum id="E12" /></> },
  { symbol: '\\varepsilon_{cc}[n]=\\kappa\\,x[n]', meaning: 'code-correlated deterministic error（DJ）', unit: '\\mathrm{t.u.}', firstSeen: '§11.3', note: <>{m('規格 §11 的 $u[n]$ 改名，避免與 $u=h*x$ 衝突')} <Erratum id="E12" /></> },
  { symbol: 'v[n],\\ \\sigma_v', meaning: m('Gaussian 雜訊與其標準差（與 $x$ 獨立）'), unit: '\\mathrm{t.u.}', firstSeen: '§11.0', note: <>{m('$\\sigma_v(x)$ 隨 code 時見')} <Erratum id="E17" /></> },
  { symbol: 'q[n]=\\operatorname{sign}(e[n])', meaning: m('1-bit comparator 輸出（$\\pm1$）'), unit: '—', firstSeen: '§11.A', note: m('MC 的 tie：$\\operatorname{sign}(0)=+1$') },
  { symbol: 'G_k', meaning: m('block 平均 GMAC $\\frac1N\\sum q\\,x$（MSE 時 $q\\to e$）'), unit: '—', firstSeen: '§11.A' },
  { symbol: 'K_q=\\sqrt{2/\\pi}/\\sigma_v', meaning: 'comparator 小訊號增益', unit: '\\mathrm{t.u.}^{-1}', firstSeen: '§11.A' },
  { symbol: 't(x)', meaning: m('per-code 零誤差 gain：$e_\\mathrm{det}(x;t)=0$'), unit: '\\mathrm{t.u.}', firstSeen: '§11.2' },
  { symbol: '\\varphi', meaning: '主迴路 DC null 加到 PD 的 static phase offset', unit: '\\mathrm{t.u.}', firstSeen: '§11.1', note: <>勘誤 <Erratum id="E03" /></> },
  { symbol: 'C=E[x\\,(h*x)]', meaning: '經 PLL 誤差路徑的有效相關（同 Ch06）', unit: '—', firstSeen: '§11.4', note: m('不是 §11 分子的 $E[x\\varepsilon_{cc}]$') },
  { symbol: 'B_\\mathrm{bias}', meaning: m('干擾 bias 項 $bE[x]+E[xd]+E[x\\varepsilon_{cc}]$'), unit: '\\mathrm{t.u.}', firstSeen: '§11.4' },
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
  { symbol: '\\mu,\\ g=\\mu S', meaning: m('學習率與正規化 loop gain（平均 pole $1-g$）'), unit: '\\mathrm{t.u.}\\ (\\text{Sign})', firstSeen: '§11.B', note: m('MSE-LMS 的 $\\mu$ 與 $S$ 都無因次；兩者的 $g=\\mu S$ 都無因次') },
]

/** Ch11：GMAC 歸零不代表 DTC Error 為零（規格 §11；勘誤 E01 / E03 / E11 / E12 / E17；T12）。 */
export default function Chapter11() {
  return (
    <div className="ch11">
      <p className="ch11-tags">
        <ModelLevel level="L1" /> <ModelLevel level="L2" /> <ClaimTag kind="exact" /> <ClaimTag kind="approx" /> <SourceTag kind="illustrative" /> <TestBadge id="T12" />
        <Erratum id="E01" />
        <Erratum id="E03" />
        <Erratum id="E11" />
        <Erratum id="E12" />
        <Erratum id="E13" />
        <Erratum id="E17" />
      </p>
      <SymbolTable
        rows={SYMBOLS}
        caption="t.u. = 本章統一的正規化時間單位（例如 1 fs 或 1 DTC LSB）；所有例子為示意（illustrative），不是晶片量測值。"
      />
      <IntroSection />
      <ModelSection />
      <FixedPointSection />
      <OffsetSection />
      <InlSection />
      <CorrelatedSection />
      <NearIntegerSection />
      <LabSection />
      <WrapSection />
    </div>
  )
}
