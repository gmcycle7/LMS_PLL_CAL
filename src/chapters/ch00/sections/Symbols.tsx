import { Section, SymbolTable, Tex, type SymbolEntry } from '@/components'
import { ErratumNote, ErratumRef, PageLink, scrollToId } from '../common'

/** 章末符號表外層的 DOM id（docs/teaching-style.md §5：全站每一章都用 `symbols`）。 */
export const SYMBOLS_ANCHOR = 'symbols'
/** 章首（本章最外層 div）的 DOM id：符號表旁的「回到章首」捲回這裡。 */
export const CHAPTER_TOP_ANCHOR = 'ch00-top'

/**
 * 本章符號（docs/teaching-style.md §5）。
 * 「首次出現」是正文第一次用一句話說明這個符號的段落——符號表在章末，所以正文不能只靠這張表。
 */
export const SYMBOLS: SymbolEntry[] = [
  {
    symbol: 'x,\\ x_n',
    meaning: (
      <>
        輸入（regressor）：第 <Tex>{'n'}</Tex> 筆餵進黑盒子的值
      </>
    ),
    unit: '\\text{無因次（教學例）}',
    firstSeen: '§0.1',
    note: 'PLL 中為 DSM 殘差／DTC code',
  },
  { symbol: 'y,\\ y_n', meaning: '黑盒子的輸出（量測值）', unit: '[y]', firstSeen: '§0.1' },
  { symbol: 'a', meaning: '黑盒子內部的真實參數（未知）', unit: '[y]/[x]', firstSeen: '§0.1', note: 'PLL 中為真實 DTC gain（fs/code）' },
  { symbol: 'v,\\ v_n', meaning: '量測雜訊，零均值', unit: '[y]', firstSeen: '§0.1' },
  { symbol: 'w,\\ w_n', meaning: '我們目前的猜測（可調係數 / weight）', unit: '[y]/[x]', firstSeen: '§0.1', note: '硬體上的 gain register' },
  { symbol: '\\hat y_n=w_nx_n', meaning: '預測', unit: '[y]', firstSeen: '§0.1' },
  { symbol: 'e_n=y_n-\\hat y_n', meaning: '誤差：預測錯多少、往哪錯', unit: '[y]', firstSeen: '§0.1' },
  {
    symbol: '\\hat a_{\\mathrm{LS}}',
    meaning: '批次最小平方估計：一次看完全部資料算出的最佳係數',
    unit: '[y]/[x]',
    firstSeen: '§0.1',
  },
  {
    symbol: 'x[n],\\ w[k]',
    meaning: (
      <>
        方塊圖裡的寫法：方括號是時間索引，<Tex>{'x[n]=x_n'}</Tex>、<Tex>{'w[k]=w_k'}</Tex>
      </>
    ),
    firstSeen: '章首圖例',
    note: 'Mermaid 的圖不排版 KaTeX，所以圖上用方括號代替下標',
  },
  {
    symbol: '\\mu',
    meaning: '學習率（learning rate / step size）',
    unit: '[w]/([e][x])',
    firstSeen: '§0.2',
    note: (
      <>
        本章教學例無因次；硬體常為 <Tex>{'2^{-k}'}</Tex>（右移 <Tex>{'k'}</Tex> 位元）
      </>
    ),
  },
  {
    symbol: 'n',
    meaning: '第幾筆資料（sample index）',
    firstSeen: '§0.2',
    note: (
      <>
        全站：<Tex>{'n'}</Tex> = comparator sample、<Tex>{'k'}</Tex> = GMAC block（§0.8、§0.9）
      </>
    ),
  },
  {
    symbol: '\\Delta w_n=\\mu e_nx_n',
    meaning: (
      <>
        這一步的更新量：<Tex>{'w_{n+1}=w_n+\\Delta w_n'}</Tex>
      </>
    ),
    unit: '[w]',
    firstSeen: '§0.2',
  },
  {
    symbol: '\\delta_n=a-w_n',
    meaning: '參數誤差：還差多少',
    unit: '[w]',
    firstSeen: '§0.4',
    note: (
      <>
        全站極性 <Tex>{'a-w'}</Tex>（<ErratumRef eid="E39" />：規格 §3 原寫 <Tex>{'w-a'}</Tex>）
      </>
    ),
  },
  {
    symbol: 'p=1-\\mu x^2',
    meaning: (
      <>
        固定 <Tex>{'x'}</Tex> 時參數誤差每步乘上的倍數（pole）
      </>
    ),
    unit: '\\text{無因次}',
    firstSeen: '§0.4',
    note: '§0.6 證明',
  },
  {
    symbol: '\\sigma_v',
    meaning: (
      <>
        雜訊 <Tex>{'v'}</Tex> 的標準差（RMS）
      </>
    ),
    unit: '[y]',
    firstSeen: '§0.5',
  },
  {
    symbol: '\\mu_{\\max}=2/x^2',
    meaning: (
      <>
        固定 <Tex>{'x'}</Tex>、無雜訊時學習率的穩定上限：<Tex>{'0<\\mu<\\mu_{\\max}'}</Tex> 才收斂
      </>
    ),
    unit: '[w]/([e][x])',
    firstSeen: '§0.6',
    note: '§0.5 的 μ 地圖用同一個界（F-00.5）',
  },
  {
    symbol: 'j_n=\\tfrac12e_n^2',
    meaning: '單筆成本',
    unit: '[y]^2',
    firstSeen: '§0.6',
    note: (
      <>
        含 <Tex>{'\\tfrac12'}</Tex>，微分後與更新量 <Tex>{'\\mu ex'}</Tex> 同 scaling（<ErratumRef eid="E41" />）
      </>
    ),
  },
  {
    symbol: 'J(w)=\\tfrac12E[(y-wx)^2]',
    meaning: '平均成本（MSE 的一半）',
    unit: '[y]^2',
    firstSeen: '§0.6',
    note: (
      <>
        規格 §1 的 <Tex>{'J_2'}</Tex> 沒有 <Tex>{'\\tfrac12'}</Tex>；argmin 相同（<ErratumRef eid="E41" />）
      </>
    ),
  },
  { symbol: 'E[\\cdot]', meaning: '期望值：做很多次取平均會趨近的值', firstSeen: '§0.6', note: '先備知識框在 §0.7' },
  { symbol: '\\operatorname{Var}(\\cdot),\\ \\sigma', meaning: '變異數／標準差：抖動有多大', firstSeen: '§0.7' },
  {
    symbol: 's_1',
    meaning: (
      <>
        單筆 <Tex>{'e\\,x'}</Tex> 的標準差
      </>
    ),
    unit: '[y][x]',
    firstSeen: '§0.7',
  },
  {
    symbol: 'N,\\ \\bar G_N',
    meaning: (
      <>
        平均的筆數；<Tex>{'N'}</Tex> 筆 <Tex>{'e\\,x'}</Tex> 的平均 <Tex>{'\\bar G_N=\\frac1N\\sum e_ix_i'}</Tex>
      </>
    ),
    firstSeen: '§0.7',
  },
  {
    symbol: '\\Phi(z)',
    meaning: (
      <>
        標準常態的累積分布函數 <Tex>{'P(Z\\le z)'}</Tex>
      </>
    ),
    firstSeen: '§0.7',
    note: '先備知識框（§0.7、§0.9）',
  },
  {
    symbol: 'M',
    meaning: 'Monte Carlo 的獨立試驗次數',
    firstSeen: '§0.7',
  },
  {
    symbol: '\\tau,\\ N_{\\mathrm{eq}}',
    meaning: (
      <>
        時間常數 <Tex>{'\\tau=-1/\\ln|p|'}</Tex>（暫態衰減到 <Tex>{'1/e'}</Tex> 的步數）；等效平均長度{' '}
        <Tex>{'N_{\\mathrm{eq}}=\\frac{1+p}{1-p}'}</Tex>
      </>
    ),
    unit: '\\text{samples}',
    firstSeen: '§0.7',
    note: 'Engineer 模式的推導',
  },
  {
    symbol: '\\mathrm{sign}(e),\\ q',
    meaning: (
      <>
        誤差的正負號；1-bit 比較器輸出 <Tex>{'q\\in\\{+1,-1\\}'}</Tex>
      </>
    ),
    firstSeen: '§0.8',
    note: (
      <>
        <Tex>{'\\mathrm{sign}(0)'}</Tex> 慣例必須明定（<ErratumRef eid="E40" />）；硬體 0/1 先映射 <Tex>{'q=2b-1'}</Tex>
      </>
    ),
  },
  {
    symbol: 'k,\\ G_k',
    meaning: (
      <>
        block 索引 <Tex>{'k'}</Tex>（每 <Tex>{'N'}</Tex> 筆一個 block）；GMAC：第 <Tex>{'k'}</Tex> 個 block 的 <Tex>{'q\\,x'}</Tex> 平均{' '}
        <Tex>{'G_k=\\frac1N\\sum q_nx_n'}</Tex>
      </>
    ),
    firstSeen: '§0.8',
    note: (
      <>
        若硬體用總和要再乘 <Tex>{'N'}</Tex>
      </>
    ),
  },
  {
    symbol: 's,\\ m_q,\\ S_N',
    meaning: (
      <>
        §0.9 比較器例子：比較器前真正的誤差 <Tex>{'s'}</Tex>；1-bit 輸出的平均 <Tex>{'m_q=E[q]'}</Tex>；<Tex>{'N'}</Tex> 筆輸出的<strong>總和</strong>{' '}
        <Tex>{'S_N=\\sum_{i=1}^{N}q_i'}</Tex>
      </>
    ),
    unit: '\\mathrm{fs},\\ \\text{無因次},\\ \\text{無因次}',
    firstSeen: '§0.9',
    note: (
      <>
        規格 §5 原寫 <Tex>{'G_N'}</Tex>、<Tex>{'m'}</Tex>（<ErratumRef eid="E18" />）；平均 <Tex>{'G=S_N/N'}</Tex>
      </>
    ),
  },
  {
    symbol: "\\kappa,\\ \\varepsilon_{cc},\\ v'",
    meaning: (
      <>
        §0.10 反例：與 code 相關的干擾 <Tex>{'\\varepsilon_{cc}=\\kappa x'}</Tex>（係數 <Tex>{'\\kappa'}</Tex>）；<Tex>{"v'"}</Tex> 是與 <Tex>{'x'}</Tex>{' '}
        無關的雜訊，<Tex>{"v=\\varepsilon_{cc}+v'"}</Tex>
      </>
    ),
    unit: '[y]/[x],\\ [y],\\ [y]',
    firstSeen: '§0.10',
    note: (
      <>
        規格 §11.3 原寫 <Tex>{'u=cx'}</Tex>，與 filtered regressor <Tex>{'u=h*x'}</Tex> 撞名（<ErratumRef eid="E12" />）
      </>
    ),
  },
  {
    symbol: 'w^*',
    meaning: (
      <>
        平均更新量為 0 的位置：LMS 平均收斂到的值（<Tex>{'E[v\\,x]=0'}</Tex> 時等於 <Tex>{'a'}</Tex>）
      </>
    ),
    unit: '[y]/[x]',
    firstSeen: '§0.10',
    note: (
      <>
        <Tex>{'w^*-a'}</Tex> 就是 calibration bias（Ch11）
      </>
    ),
  },
  {
    symbol: 'n_{1\\%}=\\left\\lceil\\dfrac{\\ln 0.01}{\\ln|p|}\\right\\rceil',
    meaning: (
      <>
        誤差降到起始值 1% 所需的步數（<Tex>{'|p|^{n}\\le0.01'}</Tex> 的最小整數 <Tex>{'n'}</Tex>）
      </>
    ),
    unit: '\\text{samples}',
    firstSeen: '§0.10',
    note: '綜合手算 HC-00.8 的第 ② 步',
  },
]

/** 章首只留這一行：按了捲到章末的符號表（HashRouter 下不能用 href="#symbols"，那會被當成路由）。 */
export function SymbolsJump() {
  return (
    <p className="ch00-symbols-jump">
      <button type="button" className="ch00-link-button" onClick={() => scrollToId(SYMBOLS_ANCHOR)}>
        本章符號表在最後 ↓
      </button>
    </p>
  )
}

/** §0.14 本章符號表：放在全章最後（Recap 與學習地圖之後），SymbolTable 是頁面的最後一個區塊。 */
export function SymbolsSection() {
  return (
    <Section kind="formula" level={2} id={SYMBOLS_ANCHOR} title="§0.14 本章符號表">
      <p>
        全章用到的符號集中列在這裡，忘記某個符號時回來查。正文裡每個符號第一次出現時都已經用一句話說明過；「首次出現」欄告訴你是在哪一段。{' '}
        <button type="button" className="ch00-link-button" onClick={() => scrollToId(CHAPTER_TOP_ANCHOR)}>
          ↑ 回到章首
        </button>
      </p>
      <ErratumNote eid="E39">
        本章所有 <Tex>{'\\delta'}</Tex> 一律為 <Tex>{'\\delta=a-w'}</Tex>（與規格 §0 一致；規格 §3 的 <Tex>{'w-a'}</Tex> 已更正）。
      </ErratumNote>
      <SymbolTable
        rows={SYMBOLS}
        caption={
          <>
            <Tex>{'[y]'}</Tex>、<Tex>{'[x]'}</Tex> 表示 <Tex>{'y'}</Tex>、<Tex>{'x'}</Tex> 的單位；本章的數字例皆無因次（§0.9 的比較器例子用 fs）。全站符號總表見{' '}
            <PageLink id="formulas">Formula &amp; Unit Reference</PageLink> 頁。
          </>
        }
      />
    </Section>
  )
}
