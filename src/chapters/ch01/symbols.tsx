import { SymbolTable, Tex, type SymbolEntry } from '@/components'
import { Erratum } from './common'

/**
 * 本章符號表（docs/teaching-style.md §5）：放在章末（Recap 之後、頁面最底端），外層 id="symbols"；
 * 章首只留一行「本章符號表在最後 ↓」。因為表不在章首，正文中每個符號第一次出現時都就地用一句話說明。
 */
export const SYMBOLS: SymbolEntry[] = [
  {
    symbol: 'a',
    meaning: '黑盒子裡真正的係數（未知）',
    unit: String.raw`[y]/[x]`,
    firstSeen: '§1.0',
    note: (
      <>
        PLL 中例如 DTC 的真實 gain（fs / code）：feedback edge 比理想時刻早到 <Tex>{'ax'}</Tex>
      </>
    ),
  },
  {
    symbol: 'x,\\ x_n',
    meaning: (
      <>
        輸入／regressor（第 <Tex>{'n'}</Tex> 筆）
      </>
    ),
    unit: String.raw`[x]`,
    firstSeen: '§1.0',
    note: 'PLL 中為正規化 DSM code（累加器餘數，也是 DTC 的 code），通常無因次',
  },
  { symbol: 'y,\\ y_n', meaning: '量測到的輸出', unit: String.raw`[y]`, firstSeen: '§1.0' },
  { symbol: 'v,\\ v_n', meaning: '量測雜訊', unit: String.raw`[y]`, firstSeen: '§1.0', note: <>本章（除思考題 4 的反例）假設零均值、與 <Tex>{'x'}</Tex> 獨立</> },
  {
    symbol: 'w,\\ w_n',
    meaning: (
      <>
        我們可以調的參數（第 <Tex>{'n'}</Tex> 次更新前）
      </>
    ),
    unit: String.raw`[y]/[x]`,
    firstSeen: '§1.0',
    note: (
      <>
        PLL 中為 gain register 的內容；reference 端 DTC 的補償量是 <Tex>{'wx'}</Tex>
      </>
    ),
  },
  {
    symbol: '\\hat y=wx',
    meaning: (
      <>
        用目前的 <Tex>{'w'}</Tex> 做的預測
      </>
    ),
    unit: String.raw`[y]`,
    firstSeen: '§1.0',
  },
  {
    symbol: 'e=y-wx',
    meaning: '誤差（error）＝量測 − 預測',
    unit: String.raw`[y]`,
    firstSeen: '§1.0',
    note: (
      <>
        全站約定 <Tex>{String.raw`e=y-\hat y`}</Tex>（規格 §0）；PLL 中是 PD 的輸出（送進 loop filter 的同一個訊號）
      </>
    ),
  },
  {
    symbol: 'n',
    meaning: 'sample 索引（第幾筆資料／第幾次更新）',
    firstSeen: '§1.0',
    note: (
      <>
        <Tex>{'k'}</Tex> 保留給 GMAC block（Part B）；§1.3 的 GD 迭代也用 <Tex>{'k'}</Tex>
      </>
    ),
  },
  { symbol: 'N', meaning: '資料筆數／更新次數', firstSeen: '§1.0', note: <>GMAC 的累加長度也記作 <Tex>{'N'}</Tex>（Part B）</> },
  {
    symbol: String.raw`T_0,\ \tau_{\mathrm{DTC}}`,
    meaning: (
      <>
        reference 端 DTC 的固定基準延遲 <Tex>{'T_0'}</Tex>，與實際的延遲 <Tex>{String.raw`\tau_{\mathrm{DTC}}=T_0-w_nx_n`}</Tex>（DTC 只能延遲，所以從{' '}
        <Tex>{'T_0'}</Tex> 往回扣補償量 <Tex>{'w_nx_n'}</Tex>；code 越大延遲越短）
      </>
    ),
    unit: String.raw`[y]`,
    firstSeen: '§1.0.1',
    note: (
      <>
        只有「連結到 PLL」用到；<Tex>{'T_0'}</Tex> 是常數，被 PLL 當成靜態相位偏移吸收
      </>
    ),
  },
  {
    symbol: String.raw`t_{\mathrm{ref}}',\ t_{\mathrm{fb}}`,
    meaning: (
      <>
        PD 比較的兩條 edge 的時間（以理想時刻當零點）：經過 DTC 的 reference edge <Tex>{String.raw`t_{\mathrm{ref}}'=-w_nx_n`}</Tex>、divider 回授來的 feedback edge{' '}
        <Tex>{String.raw`t_{\mathrm{fb}}=-ax_n`}</Tex>
      </>
    ),
    unit: String.raw`[y]`,
    firstSeen: '§1.0.1',
    note: (
      <>
        PD 量 <Tex>{String.raw`e_n=t_{\mathrm{ref}}'-t_{\mathrm{fb}}=(a-w_n)\,x_n+v_n`}</Tex>；只有「連結到 PLL」用到
      </>
    ),
  },
  { symbol: 'E[\\cdot]', meaning: '期望值（很多次的平均）', firstSeen: '§1.1', note: '見先備知識框' },
  {
    symbol: String.raw`\arg\min_w J(w)`,
    meaning: (
      <>
        「讓 <Tex>{'J(w)'}</Tex> 最小的那個 <Tex>{'w'}</Tex>」（不是最小值本身）
      </>
    ),
    firstSeen: '§1.1',
  },
  {
    symbol: 'J(w)=\\tfrac12E[(y-wx)^2]',
    meaning: (
      <>
        MSE 成本（本站含 <Tex>{String.raw`\tfrac12`}</Tex>）
      </>
    ),
    unit: String.raw`[y]^2`,
    firstSeen: '§1.2',
    note: (
      <>
        規格寫 <Tex>{'J_2=E[(y-wx)^2]'}</Tex>，argmin 相同；<Erratum id="E41" />
      </>
    ),
  },
  { symbol: 'j_n=\\tfrac12e_n^2', meaning: '單筆成本', unit: String.raw`[y]^2`, firstSeen: '§1.3', note: <Tex>{'E[j_n]=J(w)'}</Tex> },
  {
    symbol: String.raw`J_{\text{MSE}},\ J_{\text{MAE}},\ J_{\text{Huber}}`,
    meaning: (
      <>
        三種損失的平均成本 <Tex>{String.raw`E[\rho_2(e)]`}</Tex>、<Tex>{String.raw`E[\rho_1(e)]`}</Tex>、<Tex>{String.raw`E[\rho_H(e)]`}</Tex>
      </>
    ),
    firstSeen: '§2.3',
    note: (
      <>
        <Tex>{String.raw`J_{\text{MSE}}=J=\tfrac12J_2`}</Tex>（含 <Tex>{String.raw`\tfrac12`}</Tex>）；<Tex>{'J_2'}</Tex> 專指規格沒有{' '}
        <Tex>{String.raw`\tfrac12`}</Tex> 的版本
      </>
    ),
  },
  {
    symbol: 'w^*',
    meaning: (
      <>
        讓成本最小的 <Tex>{'w'}</Tex>（最佳解）
      </>
    ),
    unit: String.raw`[y]/[x]`,
    firstSeen: '§1.2',
    note: (
      <>
        MSE：<Tex>{'E[xy]/E[x^2]'}</Tex>；MAE：（加權）中位數
      </>
    ),
  },
  { symbol: 'P_x=E[x^2]', meaning: '輸入功率', unit: String.raw`[x]^2`, firstSeen: '§1.2', note: '拋物線的曲率' },
  {
    symbol: String.raw`q_n=\operatorname{sign}(e_n)`,
    meaning: (
      <>
        1-bit comparator（BBPD）輸出的誤差正負號；硬體上 <Tex>{String.raw`\operatorname{sign}(0)`}</Tex> 只能是 <Tex>{String.raw`\pm1`}</Tex>
      </>
    ),
    unit: '-',
    firstSeen: '§1.2.1',
    note: (
      <>
        PLL 對應：comparator 取 PD 輸出 <Tex>{'e'}</Tex> 的正負號，即 Sign-Error LMS 的 <Tex>{String.raw`\operatorname{sign}(e)`}</Tex>；<Erratum id="E40" />
      </>
    ),
  },
  {
    symbol: '\\mu',
    meaning: '學習率（step size）',
    unit: String.raw`1/[x]^2`,
    firstSeen: '§1.3',
    note: (
      <>
        Conventional／Huber LMS 的單位；Sign-Error 是 <Tex>{String.raw`[y]/[x]^2`}</Tex>、Sign-Sign 是 <Tex>{String.raw`[y]/[x]`}</Tex>（
        <Tex>{String.raw`\operatorname{sign}(\cdot)`}</Tex> 無因次）。本章例題的 <Tex>{'x'}</Tex>、<Tex>{'y'}</Tex> 都是純數字；硬體暫存器{' '}
        <code>REG_LMS_MU</code>
      </>
    ),
  },
  {
    symbol: String.raw`\Delta w_n`,
    meaning: (
      <>
        第 <Tex>{'n'}</Tex> 步的更新量：<Tex>{String.raw`w_{n+1}=w_n+\Delta w_n`}</Tex>
      </>
    ),
    unit: String.raw`[y]/[x]`,
    firstSeen: '§1.0',
    note: (
      <>
        LMS：<Tex>{String.raw`\mu e_nx_n`}</Tex>；一般損失：<Tex>{String.raw`\mu\,\psi(e_n)\,x_n`}</Tex>（§2.1）
      </>
    ),
  },
  {
    symbol: 'z^{-1}',
    meaning: '方塊圖上的「延遲一筆」：暫存器，這一筆算出的值下一筆才用到',
    firstSeen: '§1.3',
    note: '圖 1-9、1-11、1-12、2-5、2-7 的回授迴路；Z transform 與 pole 的正式說明在 Ch03',
  },
  {
    symbol: '\\delta_n=a-w_n',
    meaning: '剩餘參數誤差',
    unit: String.raw`[y]/[x]`,
    firstSeen: '§1.4',
    note: (
      <>
        本章採 <Tex>{'a-w'}</Tex>（規格 §3 寫 <Tex>{'w-a'}</Tex>）；<Erratum id="E39" />
      </>
    ),
  },
  {
    symbol: 'p=1-\\mu x^2',
    meaning: (
      <>
        固定 <Tex>{'x'}</Tex> 時的離散 pole（每步誤差乘上的倍數）
      </>
    ),
    firstSeen: '§1.4',
    note: (
      <>
        <Tex>{'|p|<1'}</Tex> ⇔ 收斂
      </>
    ),
  },
  { symbol: '\\sigma_v', meaning: 'Gaussian 雜訊標準差', unit: String.raw`[y]`, firstSeen: '§1.4.1' },
  {
    symbol: '\\rho(e),\\ \\psi(e)',
    meaning: (
      <>
        損失函數與其導數 <Tex>{String.raw`\psi=d\rho/de`}</Tex>（influence function）
      </>
    ),
    firstSeen: '§2.1',
    note: (
      <>
        下標 <Tex>{'2,1,H'}</Tex> = MSE、MAE、Huber
      </>
    ),
  },
  {
    symbol: '\\delta_H',
    meaning: 'Huber 門檻',
    unit: String.raw`[y]`,
    firstSeen: '§2.1',
    note: (
      <>
        下標 H：與參數誤差 <Tex>{String.raw`\delta_n`}</Tex> 不同
      </>
    ),
  },
  {
    symbol: '\\operatorname{sign}(\\cdot)',
    meaning: (
      <>
        取正負號；<Tex>{String.raw`\operatorname{sign}(0)`}</Tex> 的慣例必須明定
      </>
    ),
    firstSeen: '§2.2',
    note: (
      <>
        <Tex>{String.raw`0\ /\ {+1}\ /\ {-1}`}</Tex>；<Erratum id="E40" />
      </>
    ),
  },
  { symbol: '\\partial f(e_0)', meaning: '次梯度（subgradient）集合', firstSeen: '§2.2', note: '見先備知識框' },
  {
    symbol: String.raw`\operatorname{clip}(e,-\delta_H,\delta_H)`,
    meaning: (
      <>
        把 <Tex>{'e'}</Tex> 截在 <Tex>{String.raw`[-\delta_H,\delta_H]`}</Tex> 之內（超出就取端點）
      </>
    ),
    unit: String.raw`[y]`,
    firstSeen: '§2.1',
    note: (
      <>
        Huber 的 <Tex>{'\\psi_H'}</Tex>
      </>
    ),
  },
  { symbol: String.raw`\#\{\cdot\}`, meaning: '滿足括號內條件的資料筆數', firstSeen: '§2.3', note: 'MAE 的導數 = 計數差' },
  {
    symbol: 'P(\\cdot)',
    meaning: '事件的機率（重複很多次時，該事件發生的比例）',
    firstSeen: '§2.3.1',
    note: (
      <>
        例：從 <Tex>{String.raw`\{0,0,0,10\}`}</Tex> 等機率抽，<Tex>{String.raw`P(y=0)=\tfrac34`}</Tex>
      </>
    ),
  },
  {
    symbol: '\\overline w',
    meaning: (
      <>
        <Tex>{'w_n'}</Tex> 的長時間平均（穩態時間平均）
      </>
    ),
    unit: String.raw`[y]/[x]`,
    firstSeen: '§2.3.1',
  },
  {
    symbol: '\\pi_k,\\ u_k,\\ d_k',
    meaning: '格點 Markov 鏈的穩態機率、往上／往下的機率',
    firstSeen: '§2.3.1',
    note: (
      <>
        Research 模式；推導裡的 <Tex>{String.raw`M=10/\mu`}</Tex> 是 <Tex>{'w=10'}</Tex> 那一格的編號
      </>
    ),
  },
  {
    symbol: String.raw`\tilde v=y-ax`,
    meaning: (
      <>
        §2 的總雜訊：Gaussian 雜訊 <Tex>{'v'}</Tex> 加上 outlier <Tex>{'o'}</Tex>（沒有 outlier 時就是 <Tex>{'v'}</Tex>）
      </>
    ),
    unit: String.raw`[y]`,
    firstSeen: '§2.3.2',
    note: (
      <>
        程式碼中的變數名是 <code>n</code>（noise）
      </>
    ),
  },
  {
    symbol: 'F(t),\\ f(t)',
    meaning: '累積分布函數（CDF）與機率密度（PDF）',
    unit: String.raw`-,\ 1/[y]`,
    firstSeen: '§2.3.2',
    note: (
      <>
        <Tex>{"f=F'"}</Tex>；<Tex>{String.raw`f_{\tilde v}`}</Tex> 是總雜訊 <Tex>{String.raw`\tilde v`}</Tex> 的密度；見先備知識框
      </>
    ),
  },
  {
    symbol: String.raw`K_q=2f_{\tilde v}(t^*)`,
    meaning: 'Sign-Error 在連續雜訊下的等效小訊號增益',
    unit: String.raw`1/[y]`,
    firstSeen: '§2.3.2',
    note: (
      <>
        Gaussian：<Tex>{String.raw`\sqrt{2/\pi}/\sigma_v`}</Tex>，即規格 §0、§5.1 的 comparator 增益（Ch05）
      </>
    ),
  },
  {
    symbol: String.raw`m,\ d_n,\ s_n,\ \xi_n`,
    meaning: (
      <>
        資料的中位數、<Tex>{'w_n'}</Tex> 離中位數的距離 <Tex>{'d_n=w_n-m'}</Tex>、Sign-Error 這一步的方向 <Tex>{String.raw`s_n=\pm1`}</Tex>、它扣掉平均後的零均值抖動
      </>
    ),
    unit: String.raw`[y],\ [y],\ -,\ -`,
    firstSeen: '§2.3.2',
    note: (
      <>
        圖 2-7 的線性化迴路：<Tex>{String.raw`s_n=-K_qd_n+\xi_n`}</Tex>（<Tex>{String.raw`x\equiv1`}</Tex>）
      </>
    ),
  },
  {
    symbol: '\\varepsilon,\\ s,\\ o',
    meaning: (
      <>
        outlier 的機率、大小，以及實際加進量測的 outlier 值 <Tex>{'o'}</Tex>（機率 <Tex>{String.raw`\varepsilon`}</Tex> 是 <Tex>{'+s'}</Tex>，其餘是 0）
      </>
    ),
    unit: String.raw`-,\ [y],\ [y]`,
    firstSeen: '§2.3.2',
    note: (
      <>
        MSE vs MAE Lab 的控制項；圖 2-8。此處的 <Tex>{'s'}</Tex> 不是 <Tex>{String.raw`s_n`}</Tex>（Sign-Error 這一步的方向）
      </>
    ),
  },
  {
    symbol: String.raw`\kappa`,
    meaning: (
      <>
        擴散近似（F-01.18）的有效性指標：近似的 std 比精確值小約 <Tex>{String.raw`\kappa/4`}</Tex>
      </>
    ),
    firstSeen: '§2.3.2',
    note: (
      <>
        <Tex>{String.raw`\kappa=(1+z^2)\,x^2\operatorname{Var}(w_\infty)/\sigma_v^2`}</Tex>；綜合手算以 <Tex>{String.raw`\kappa\le0.2`}</Tex> 為界
      </>
    ),
  },
  { symbol: '\\Phi(\\cdot)', meaning: '標準常態 CDF', firstSeen: '§2.4', note: 'Research 模式；見先備知識框' },
  {
    symbol: 'G',
    meaning: (
      <>
        GMAC 的輸出：<Tex>{String.raw`\sum_n q_nx_n`}</Tex>（或除以筆數的平均）；gain update 是 <Tex>{String.raw`w\leftarrow w+\mu G`}</Tex>
      </>
    ),
    firstSeen: '§2.6',
    note: '本章沒有 block rate（k）的訊號；GMAC 的 block 索引從 Part B 開始',
  },
]

/** 章末符號表外層的 id（章首那一行捲動到這裡）。 */
export const SYMBOLS_ANCHOR = 'symbols'
/** 章首（§1.0）的錨點 id：符號表下方的「回到章首」捲動到這裡。 */
export const CHAPTER_TOP_ANCHOR = 'ch01-s10'

/** 捲動到頁面上的某個 id。本站是 HashRouter，href="#symbols" 會被當成路由，所以用 scrollIntoView，不改網址。 */
function scrollToId(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  // jsdom 與很舊的瀏覽器沒有 scrollIntoView：用 ?. 保護
  el.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  // 把鍵盤焦點也帶過去（螢幕閱讀器會從這裡接著唸）；preventScroll 避免打斷平滑捲動
  el.focus?.({ preventScroll: true })
}

/** 章首的一行：「本章符號表在最後 ↓」。 */
export function SymbolsJump() {
  return (
    <p className="ch01-symbols-jump">
      <button type="button" className="ch01-linklike" onClick={() => scrollToId(SYMBOLS_ANCHOR)} aria-controls={SYMBOLS_ANCHOR}>
        本章符號表在最後 ↓
      </button>
    </p>
  )
}

/** 章末的符號表（頁面最後一個區塊）。 */
export function SymbolsSection() {
  return (
    <section id={SYMBOLS_ANCHOR} className="ch01-symbols" aria-label="本章符號表" tabIndex={-1}>
      <SymbolTable
        rows={SYMBOLS}
        caption={
          <>
            首次出現的段落編號對應本頁的小節。<Tex>{'\\delta'}</Tex> 的極性、<Tex>{'J'}</Tex> 的 <Tex>{String.raw`\tfrac12`}</Tex>、
            <Tex>{String.raw`\operatorname{sign}(0)`}</Tex> 皆依 docs/validation.md 勘誤。
          </>
        }
      />
      <p className="ch01-symbols-back">
        <button type="button" className="ch01-linklike" onClick={() => scrollToId(CHAPTER_TOP_ANCHOR)}>
          ↑ 回到章首
        </button>
      </p>
    </section>
  )
}
