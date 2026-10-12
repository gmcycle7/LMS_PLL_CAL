import { SymbolTable, Tex, type SymbolEntry } from '@/components'
import { Erratum } from './common'

/**
 * 本章符號表（docs/teaching-style.md §5）：放在章末（Recap 與延伸之後、頁面最底端），外層 id="symbols"；
 * 章首只留一行「本章符號表在最後 ↓」。因為表不在章首，正文中每個符號第一次出現時都就地用一句話說明，
 * 「首次出現」欄就是那一句話所在的段落。
 */

const T = (tex: string) => <Tex>{tex}</Tex>

/** 章末符號表的錨點 id（HashRouter 下不能用 href="#symbols"：那會被當成路由，所以用按鈕捲動）。 */
export const SYMBOLS_ANCHOR = 'symbols'

export const CH05_SYMBOLS: SymbolEntry[] = [
  {
    symbol: 's',
    meaning: '要辨識正負號的固定誤差（PLL 中是 DTC 補償的殘差在 PD 輸出留下的時間誤差：補償不足時為正、補償過頭時為負）',
    unit: '\\mathrm{fs}',
    firstSeen: '開場、§0',
    note: <>本章 regressor {T('x\\equiv1')}，所以 {T('s=\\delta=a-w')}（全站約定 {T('\\delta=a-w')}）</>,
  },
  {
    symbol: 'v,\\;\\sigma_v',
    meaning: 'comparator 前的 Gaussian 雜訊與其 RMS',
    unit: '\\mathrm{fs}',
    firstSeen: '開場、§0',
    note: <>{T('v\\sim\\mathcal N(0,\\sigma_v^2)')}，iid（時間相關的情形見章末 Research 延伸）</>,
  },
  {
    symbol: '\\theta',
    meaning: 'comparator threshold／offset',
    unit: '\\mathrm{fs}',
    firstSeen: '§0',
    note: <>硬體慣例 {T('e\\ge\\theta\\Rightarrow q=+1')}（規格 §15.2）；理想 {T('\\theta=0')}</>,
  },
  { symbol: 'e=s+v', meaning: 'comparator 輸入（PLL 中就是 PD 的輸出，也是送進 loop filter 的同一個訊號）', unit: '\\mathrm{fs}', firstSeen: '§0' },
  {
    symbol: 'x',
    meaning: 'regressor（DTC code／相位選擇等，乘在誤差上的已知訊號）',
    firstSeen: '§0',
    note: <>本章固定 {T('x\\equiv1')}；一般情形留到 Ch06–Ch11</>,
  },
  { symbol: 'n,\\;k', meaning: '時間索引：comparator sample 與 GMAC block', firstSeen: '§0', note: <>{T('k')} 在 §7 另作格點編號、在 §6 另作 Monte Carlo 判對次數，依上下文區分</> },
  { symbol: 'b', meaning: '硬體 comparator 輸出的 0/1 位元', unit: '0/1', firstSeen: '§0、§2', note: <>{T('q=2b-1')}</> },
  {
    symbol: 'q',
    meaning: '1-bit comparator 的雙極性輸出',
    unit: '\\pm1',
    firstSeen: '開場、§0',
    note: <>硬體 0/1 位元 {T('b')} 必須先映射 {T('q=2b-1')}（規格 §0）</>,
  },
  { symbol: 'p', meaning: T('P(q=+1)'), firstSeen: '§1', note: <>本章 {T('p')} 專指機率；Ch12/Ch14 的迴路 pole 本章改寫 {T('p_{\\mathrm{cal}}')}</> },
  {
    symbol: 'm\\;(\\equiv m_q)',
    meaning: <>{T('E[q]')}，單一樣本的平均（「訊號」）</>,
    firstSeen: '§1、§2',
    note: (
      <>
        全站符號表寫作 {T('m_q')}，以免與 §12 的 code DC 衝突；本章只有這一個 {T('m')}，公式中簡寫成 {T('m')}，兩者是同一個量 <Erratum id="E34" />
      </>
    ),
  },
  { symbol: 'r', meaning: <>標準化誤差 {T('(s-\\theta)/\\sigma_v')}</>, firstSeen: '§1' },
  { symbol: '\\Phi,\\;\\varphi', meaning: '標準常態分布的 CDF 與 PDF', firstSeen: '§1' },
  { symbol: '\\operatorname{erf}', meaning: 'error function', firstSeen: '§2' },
  { symbol: 'N', meaning: '累加的樣本數（comparator 決策次數）', unit: '\\text{samples}', firstSeen: '開場、§0', note: <>時間索引 {T('n')} = comparator sample</> },
  {
    symbol: 'K',
    meaning: <>{T('N')} 個樣本中 {T('q=+1')} 的個數，{T('K\\sim\\mathrm{Bin}(N,p)')}</>,
    firstSeen: '§3',
    note: <>本章 {T('K')} 只代表計數（勘誤 E02 的寫法），與 §8/§12 的迴路增益 {T('K=K_qC')} 無關</>,
  },
  {
    symbol: 'S_N',
    meaning: <>comparator 輸出的總和 {T('\\sum_i q_i=2K-N')}</>,
    firstSeen: '§0、§3',
    note: (
      <>
        規格 §5 原寫 {T('G_N')}；本章改用 {T('S_N')}，保留 {T('G')} 給 §0 的 block 平均 <Erratum id="E07" /> <Erratum id="E18" />
      </>
    ),
  },
  {
    symbol: 'G=S_N/N',
    meaning: <>平均（§0 的 {T('G_k=\\frac1N\\sum qx')} 在 {T('x\\equiv1')} 時）</>,
    firstSeen: '§3',
    note: <>sum 與 average 差 {T('N')} 倍</>,
  },
  {
    symbol: '\\eta',
    meaning: <>{T('q')} 或 {T('G_k')} 扣掉平均後的零均值「量化雜訊」</>,
    firstSeen: '§3',
    note: <>§3 寫 {T('\\eta_i=q_i-m')}；§7 寫 {T('\\eta_n')}（逐 sample）、§9 寫 {T('\\eta_k')}（block 平均，{T('\\operatorname{Var}\\approx1/N')}）</>,
  },
  { symbol: '\\sigma_S', meaning: <>{T('S_N')} 的標準差 {T('\\mathrm{SD}(S_N)=\\sqrt{N(1-m^2)}')}</>, firstSeen: '§3.2' },
  { symbol: '\\mathrm{SNR}_{\\mathrm{stat}}', meaning: <>統計 SNR {T('=E[S_N]/\\mathrm{SD}(S_N)')}</>, firstSeen: '§1、§3' },
  {
    symbol: 'P_{\\text{target}},\\;z',
    meaning: <>目標正確率，與對應的 {T('z=\\Phi^{-1}(P_{\\text{target}})')}，例如 95% → 1.645</>,
    firstSeen: '直覺（路線圖）、§4',
  },
  { symbol: 'K_q', meaning: <>comparator 的小訊號統計增益 {T('dE[q]/ds')}</>, unit: '\\mathrm{fs}^{-1}', firstSeen: '直覺、§5' },
  {
    symbol: 'd_k,\\;s^*',
    meaning: <>只取 {T('S_N')} 正負號的硬體決策 {T('d_k\\in\\{+1,-1,0\\}')}，與其迴路平衡點 {T('s^*')}</>,
    unit: '\\mathrm{fs}',
    firstSeen: '§3.3（tie 決策樹）、§3.4（Engineer）',
    note: <>{T('s^*')} 的單位是 fs；{T('d_k')} 無因次</>,
  },
  { symbol: 'T', meaning: 'Monte Carlo 的獨立 trials 數', firstSeen: '§6（實驗）', note: <>與全站的 closed-loop {T('T=L/(1+L)')} 無關</> },
  {
    symbol: 'k,\\;\\hat P',
    meaning: <>Monte Carlo 中判對的次數，與估計的判對率 {T('\\hat P=k/T')}</>,
    firstSeen: '§6（實驗）',
    note: <>{T('k')} 在 §9 另作 GMAC block 索引、在 §7 作格點編號，依上下文區分</>,
  },
  {
    symbol: 'k_{\\mathrm{lo}},\\;k_{\\mathrm{hi}}',
    meaning: <>MC 計數的接受域（精確 Binomial 每側尾機率 {T('<\\Phi(-4)')}）</>,
    firstSeen: '§6（實驗）',
    note: 'Analytic ↔ Monte Carlo 交叉比對的判準',
  },
  { symbol: 'a,\\;w', meaning: '理想係數與目前的校正係數', unit: '\\mathrm{fs}', firstSeen: '§0', note: <>{T('x\\equiv1')} 時 {T('s=a-w')}</> },
  {
    symbol: '\\delta=a-w',
    meaning: '剩餘參數誤差',
    unit: '\\mathrm{fs}',
    firstSeen: '§0、§7',
    note: <>全站約定 {T('\\delta=a-w')}（不是 {T('w-a')}）</>,
  },
  {
    symbol: '\\mu',
    meaning: '學習率（每次更新的步長）',
    unit: '\\mathrm{fs}',
    firstSeen: '直覺（路線圖）、§3、§7',
    note: (
      <>
        §7 為逐 sample 更新（等於 {T('N=1')} 的 block）；§9 為 average-mode GMAC 的 block 更新，單位同為 fs。規格／ChatGPT 課程中的 {T('\\alpha')} 本站一律寫{' '}
        {T('\\mu')} <Erratum id="E13" /> <Erratum id="E34" />
      </>
    ),
  },
  {
    symbol: 'g=\\mu K_q',
    meaning: <>無因次的 normalized loop gain（{T('x\\equiv1')} 時 {T('C=1')}，所以 {T('K=K_q')}）</>,
    firstSeen: '§7',
    note: <>一般情形 {T('g=\\mu K_qC')}</>,
  },
  {
    symbol: 'p_{\\mathrm{cal}}=1-g',
    meaning: '校正迴路的（線性化）pole',
    firstSeen: '直覺（路線圖）、§5、§7、§9',
    note: <>Ch12/Ch14 寫作 {T('p')}；穩定條件 {T('0<\\mu<\\mu_{\\max}=2/K_q')}</>,
  },
  {
    symbol: '\\tau',
    meaning: <>迴路的時間常數 {T('\\approx1/g')}（精確 {T('-1/\\ln|1-g|')}）</>,
    unit: '\\text{samples / blocks}',
    firstSeen: '§7',
    note: '§7 逐 sample 更新時單位是 samples；§9 block 更新時是 blocks',
  },
  {
    symbol: 'w_k,\\;u_k,\\;\\bar u_k,\\;\\pi_k',
    meaning: <>§7 的格點 {T('w_k=w_0+k\\mu')}、往上／往下一步的機率、穩態（時間平均）機率</>,
    firstSeen: '§7（Engineer）',
    note: <>{T('E_\\pi[\\cdot]')} 表示以 {T('\\pi_k')} 加權的平均（穩態下的時間平均）</>,
  },
  { symbol: '\\sigma_w', meaning: '收斂後係數的穩態 RMS（coefficient noise）', unit: '\\mathrm{fs}', firstSeen: '直覺（路線圖）、§9' },
  {
    symbol: 'C',
    meaning: <>regressor 與誤差路徑輸出的相關量（一般情形 {T('K=K_qC')}）</>,
    firstSeen: '§5',
    note: <>本章 {T('x\\equiv1')}，所以 {T('C=1')}；Ch06 詳述</>,
  },
  {
    symbol: 'f_s,\\;f_u',
    meaning: <>comparator 取樣率與 GMAC 更新率 {T('f_u=f_s/N')}</>,
    unit: '\\mathrm{Hz}',
    firstSeen: '§4、§9',
    note: <>{T('f_s')} 不保證等於 {T('f_{\\mathrm{ref}}')}（規格 §0）</>,
  },
  {
    symbol: 'T_{\\mathrm{blk}},\\;t_\\tau',
    meaning: <>一個 GMAC block 的時間 {T('N/f_s')}，與換成秒的時間常數 {T('\\tau\\,T_{\\mathrm{blk}}')}</>,
    unit: '\\mathrm{s}',
    firstSeen: '綜合手算',
  },
  {
    symbol: '\\rho,\\;N_{\\mathrm{eff}}',
    meaning: <>雜訊相鄰樣本的相關係數，與等效獨立樣本數</>,
    firstSeen: '注意假設、章末延伸（Research）',
    note: '推導只在 Research 模式出現',
  },
]

/**
 * 捲到章末的符號表，並把鍵盤焦點移過去（jsdom 沒有 scrollIntoView，所以用可選呼叫）。
 * 本章很長，上方的圖（Mermaid／Plotly）是延遲載入的：載入後版面會被推開，所以稍後再對齊兩次——
 * 使用者一旦自己捲動、點擊或按鍵就不再干涉。
 */
export function scrollToSymbols() {
  const el = document.getElementById(SYMBOLS_ANCHOR)
  if (!el) return
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  el.focus?.({ preventScroll: true })
  const events = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const
  const timers = [600, 1500].map((ms) => window.setTimeout(() => document.getElementById(SYMBOLS_ANCHOR)?.scrollIntoView?.({ block: 'start' }), ms))
  const stop = () => {
    timers.forEach((t) => window.clearTimeout(t))
    events.forEach((ev) => window.removeEventListener(ev, stop))
  }
  events.forEach((ev) => window.addEventListener(ev, stop, { passive: true }))
  window.setTimeout(stop, 1600)
}

/** 章首的一行連結：符號表在最後。 */
export function SymbolsLink() {
  return (
    <p className="ch05-symbols-link">
      <button type="button" className="ch05-linkbtn" onClick={scrollToSymbols}>
        本章符號表在最後 ↓
      </button>
      <span className="ch05-note">（每個符號第一次出現時，正文會先用一句話說明）</span>
    </p>
  )
}

/** 章末（頁面最後一個區塊）的符號表。 */
export function ChapterSymbols() {
  return (
    <section id={SYMBOLS_ANCHOR} className="ch05-symbols-end" tabIndex={-1} aria-label="本章符號表">
      <h2>本章符號表</h2>
      <p className="ch05-note">
        查表用：正文中每個符號第一次出現時已就地說明，「首次出現」欄就是那一句話所在的段落；與全站約定或勘誤有關的地方寫在備註欄。
      </p>
      <SymbolTable
        rows={CH05_SYMBOLS}
        caption={
          <>
            時間索引：<Tex>{'n'}</Tex> = comparator sample；<Tex>{'k'}</Tex> = GMAC block（本章大多只用到 <Tex>{'n'}</Tex>，§9 的 block 迴路用 <Tex>{'k'}</Tex>）。所有時間量預設{' '}
            <Tex>{'\\mathrm{fs}'}</Tex>。全站符號總表在 Formula &amp; Unit Reference 頁。
          </>
        }
      />
    </section>
  )
}
