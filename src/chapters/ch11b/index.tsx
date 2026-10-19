import { ClaimTag, ModelLevel, SourceTag, SymbolTable, type SymbolEntry } from '@/components'
import { jumpTo, m } from './common'
import { IntroSection } from './sections/IntroSection'
import { FoldingSection } from './sections/FoldingSection'
import { StructuresSection } from './sections/StructuresSection'
import { BasisSection } from './sections/BasisSection'
import { IdentifiabilitySection } from './sections/IdentifiabilitySection'
import { WrapSection } from './sections/WrapSection'
import './chapter.css'

/**
 * 本章符號表（docs/teaching-style.md §5）：放在頁面最後（#symbols），章首只留一行跳轉。
 * 「首次出現」欄指正文第一次用一句話說明這個符號的地方。
 */
export const SYMBOLS: SymbolEntry[] = [
  { symbol: 'x[n]', meaning: m('正規化 DTC code $\\in[-1,1]$：MASH 餘數 $r/2$、first-order $2(r+\\tfrac12)$、uniform 直接 $U(-1,1)$'), unit: '—', firstSeen: '開場', note: m('與 Ch11 的 $x$ 同一個量，只是固定了範圍；$n$ = comparator sample') },
  { symbol: 'd(x)', meaning: m('DTC 的 INL：這個 code 比直線多出來的延遲，$d_2x^2+d_3x^3+A_s\\,\\mathrm{saw}_{K_s}(x)$'), unit: '\\mathrm{t.u.}', firstSeen: '開場', note: m('Ch11 的 $c_2x^2+c_3x^3$ 改記 $d_2$、$d_3$（$c$ 留給補償量）；以正號進入 $e$') },
  { symbol: 'c(x)=\\sum_i\\theta_i\\varphi_i(x)', meaning: m('INL 校正的補償量：參數 × regressor 的線性組合（從 $T_0$ 往回扣）'), unit: '\\mathrm{t.u.}', firstSeen: '開場' },
  { symbol: '\\theta_i,\\ \\boldsymbol\\vartheta,\\ \\boldsymbol\\vartheta^*', meaning: m('INL 參數、含 gain $w$ 的完整參數向量、LS 最佳解（$\\mathbf R\\boldsymbol\\vartheta^*=E[\\boldsymbol\\psi\\,\\text{target}]$）'), unit: '\\mathrm{t.u.}', firstSeen: '§11b.1' },
  { symbol: '\\varphi_i(x),\\ \\boldsymbol\\psi', meaning: m('第 $i$ 個 regressor 與 regressor 向量（分段 $\\mathbb 1_k x$、LUT $\\mathbb 1_j$、多項式 $x^m$ 或 $P_m$；含 gain 時第一個元素是 $x$）'), unit: '—', firstSeen: '§11b.1' },
  { symbol: '\\mathbb 1_k(x)', meaning: m('指示函數：$x$ 在第 $k$ 段為 1、否則 0'), unit: '—', firstSeen: '§11b.3' },
  { symbol: 'a,\\ w,\\ w_0,\\ b,\\ v,\\ \\sigma_v', meaning: m('真實 gain、校正 gain（固定或同時校正）與初值、PD／comparator offset、雜訊與其標準差'), unit: '\\mathrm{t.u.}', firstSeen: '§11b.1', note: m('同 Ch11；$\\delta=a-w$（全站約定）') },
  { symbol: 'e[n],\\ r(x)', meaning: m('PD 的輸出（comparator 的輸入）；gain 校正後的殘餘 INL $d-(w^*-a)x-E[d]$'), unit: '\\mathrm{t.u.}', firstSeen: '§11b.1' },
  { symbol: 'K,\\ J,\\ M,\\ P', meaning: '分段數、LUT 格數、多項式階數、參數總數', unit: '—', firstSeen: '§11b.3' },
  { symbol: '\\Delta,\\ \\bar x_j,\\ p_j', meaning: m('LUT 格寬 $2/J$、第 $j$ 格的中心、造訪機率'), unit: '—', firstSeen: '§11b.3' },
  { symbol: 'R_x[m],\\ S_x(\\nu),\\ \\nu,\\ \\nu_B', meaning: m('code 的自相關、PSD（DTFT 形式，$\\int S\\,d\\nu=\\sigma^2$）、正規化頻率 $f/f_s$、帶寬 $f_B/f_s$'), unit: '—', firstSeen: '§11b.2', note: m('one-sided per-Hz 由 $S^{(1)}=2S/f_s$ 換算（Ch12 F-12.10）') },
  { symbol: '\\mathrm{He}_p,\\ \\kappa_4,\\ h_k', meaning: m('第 $p$ 階 Hermite 多項式（$x^2-\\sigma^2$、$x^3-3\\sigma^2x$）、輸入 $u$ 的四階累積量（uniform $-1/120$）、MASH 的 FIR 係數 $[-\\tfrac12,1,-\\tfrac12]$'), unit: '—', firstSeen: '§11b.2' },
  { symbol: 'S_2(0),\\ S_3(0),\\ P_\\mathrm{in},\\ \\sigma_{t,\\mathrm{in}}', meaning: m('二次／三次分量在 DC 的 PSD（單位係數）、帶內折返功率與 rms'), unit: '\\mathrm{t.u.}^2,\\ \\mathrm{t.u.}', firstSeen: '§11b.2' },
  { symbol: '\\mathbf R,\\ \\lambda_i,\\ \\kappa', meaning: m('regressor 相關矩陣 $E[\\boldsymbol\\psi\\boldsymbol\\psi^T]$、特徵值（由大到小）、條件數 $\\lambda_{\\max}/\\lambda_{\\min}$'), unit: '—', firstSeen: '§11b.3', note: '同 Ch09／Ch10' },
  { symbol: 'K_q,\\ \\mu,\\ N,\\ b', meaning: m('comparator 小訊號增益 $\\sqrt{2/\\pi}/\\sigma_v$（MSE 為 1）、學習率、每 block sample 數、block 索引'), unit: '\\mathrm{t.u.}^{-1},\\ \\mathrm{t.u.},\\ \\text{—}', firstSeen: '§11b.3', note: m('本章 block 索引用 $b$（$k$ 留給段號）') },
  { symbol: 'g_i,\\ p_i,\\ \\tau_i,\\ k_{95}', meaning: m('第 $i$ 個模式的 loop gain $\\mu K_q\\lambda_i$、pole $1-g_i$、時間常數 $1/g_i$、衰減到 5% 的 block 數'), unit: '\\text{blocks}', firstSeen: '§11b.3' },
  { symbol: '\\xi_i,\\ \\boldsymbol\\delta,\\ \\boldsymbol\\eta', meaning: m('模式座標 $\\mathbf v_i^T\\boldsymbol\\delta$、參數誤差 $\\boldsymbol\\vartheta-\\boldsymbol\\vartheta^*$、GMAC 的抽樣雜訊（$\\operatorname{Cov}=\\mathbf R/N$）'), unit: '\\mathrm{t.u.}', firstSeen: '§11b.3' },
  { symbol: '\\text{floor},\\ E[r^2]_\\infty', meaning: m('結構的近似誤差 rms（LS 殘差）；收斂後的殘餘功率 $=\\text{floor}^2+$ misadjustment'), unit: '\\mathrm{t.u.}', firstSeen: '§11b.3' },
  { symbol: '\\mathbf M,\\ \\gamma', meaning: m('preconditioner 矩陣與其步長（對角 $\\gamma/(K_qR_{ii})$、完整 $(\\gamma/K_q)\\mathbf R^{-1}$）'), unit: '—', firstSeen: '§11b.3c', note: '同 Ch10 F-10.4／F-10.8' },
  { symbol: 'P_m(x),\\ T_m(x)', meaning: 'Legendre 與 Chebyshev 多項式（正交基底）', unit: '—', firstSeen: '§11b.3c' },
  { symbol: 'n_\\mathrm{eff}', meaning: m('LUT 每格的有效平均長度 $2N/(\\mu K_q)$'), unit: '\\text{samples}', firstSeen: '§11b.3' },
]

/** Ch11b：DTC INL 校正（分段／LUT／多項式基底）與噪聲折返（§11 的延伸）。 */
export default function Chapter11b() {
  return (
    <div className="ch11b" id="ch11b-top" tabIndex={-1}>
      {/* 章首骨架（teaching-style §9）：問題區塊與系統地圖先出現（IntroSection）；標籤列接在地圖的「你在這裡」之後。
          勘誤索引、手算索引與「符號表在最後」的連結由 PageFrame 依 chapterMeta 畫（本章沒有勘誤）。 */}
      <IntroSection
        afterMap={
          <>
            <p className="ch11b-tags">
              <ModelLevel level="L1" /> <ModelLevel level="L3" /> <ModelLevel level="L4" /> <ClaimTag kind="exact" /> <ClaimTag kind="approx" /> <ClaimTag kind="research" /> <SourceTag kind="illustrative" />
            </p>
            <p className="ch11b-status small muted">本章是規格 §11 的延伸（規格沒有 INL 校正與折返的推導）；所有晶片數字都是 illustrative 示例。</p>
          </>
        }
      />
      <FoldingSection />
      <StructuresSection />
      <BasisSection />
      <IdentifiabilitySection />
      <WrapSection />
      <section id="symbols" className="ch11b-symbols" tabIndex={-1} aria-label="本章符號表">
        <SymbolTable rows={SYMBOLS} title="本章符號表" caption="t.u. = 正規化時間單位（例如 1 fs）；x 無因次（正規化到 [−1, 1]）；所有例子為 illustrative。「首次出現」是正文第一次用一句話說明該符號的段落。" />
        <p className="ch11b-symbols-back">
          <button type="button" className="ch11b-jump no-print" onClick={() => jumpTo('ch11b-top')}>
            ↑ 回到章首
          </button>
        </p>
      </section>
    </div>
  )
}
