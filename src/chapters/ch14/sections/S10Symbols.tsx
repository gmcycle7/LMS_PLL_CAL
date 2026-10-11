import type { ReactNode } from 'react'
import { SymbolTable, Tex, type SymbolEntry } from '@/components'
import { md } from '../shared'

/** 章末符號表的錨點（docs/teaching-style.md §5：符號表放在每章最後，外層 id="symbols"）。 */
export const SYMBOLS_ID = 'symbols'

/** 捲到某個元素並把焦點移過去（HashRouter 下不能用 #anchor 連結，否則會改到路由）。 */
function scrollToId(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  el.focus({ preventScroll: true })
}

export const SYMBOLS: SymbolEntry[] = [
  {
    symbol: 'a',
    meaning: (
      <>
        DTC 真正需要的 gain（未知的正確答案）；追蹤時會隨 PVT 漂移，寫成 <Tex>{'a_k'}</Tex>
      </>
    ),
    unit: '\\mathrm{fs}',
    firstSeen: '章首',
  },
  { symbol: 'w_k', meaning: '第 k 個 block 使用的校正係數（gain register）', unit: '\\mathrm{fs}', firstSeen: '章首' },
  {
    symbol: '\\delta_k=a-w_k',
    meaning: '第 k 次更新後的剩餘係數誤差（register error）',
    unit: '\\mathrm{fs}',
    firstSeen: '章首',
    note: (
      <>
        全站約定 <Tex>{'\\delta=a-w'}</Tex>（§12 寫 <Tex>{'\\delta w=w-w^*'}</Tex>，差一個負號：雜訊項變號，二階矩相同）
      </>
    ),
  },
  { symbol: '\\delta_0', meaning: '開始校正時的初始誤差（確定值）', unit: '\\mathrm{fs}', firstSeen: '章首' },
  {
    symbol: 'G_k',
    meaning: (
      <>
        第 k 個 block 的 GMAC 平均輸出 <Tex>{'\\frac1N\\sum_n q[n]x[n]'}</Tex>
      </>
    ),
    unit: '—',
    firstSeen: '章首',
    note: 'average-mode（已除以 N），無因次',
  },
  {
    symbol: '\\mu',
    meaning: 'learning rate／gain_step（每 block 的更新倍率）',
    unit: '\\mathrm{fs}',
    firstSeen: '章首',
    note: (
      <>
        average-mode GMAC（<Tex>{'G'}</Tex> 無因次）時 <Tex>{'\\mu'}</Tex> 與 <Tex>{'w'}</Tex> 同單位（勘誤 E13）
      </>
    ),
  },
  { symbol: 'N', meaning: '每個 GMAC block 累加的 comparator 樣本數', unit: '—', firstSeen: '章首' },
  { symbol: 'B', meaning: '更新次數（GMAC block 數）', unit: '—', firstSeen: '章首' },
  { symbol: 'T=NB', meaning: '總比較次數（開機校正的時間預算乘上 comparator rate）', unit: '—', firstSeen: '章首' },
  { symbol: '\\sigma_v', meaning: 'comparator 前的雜訊 RMS', unit: '\\mathrm{fs}', firstSeen: '章首' },
  {
    symbol: 'x[n],\\ u[n]',
    meaning: (
      <>
        原始 code（regressor）與它經過 PLL 誤差路徑後的樣子；本章的相位模型 <Tex>{'u=c\\,x[n]+s\\,x[n-1]'}</Tex>
      </>
    ),
    unit: '—',
    firstSeen: '章首、先備知識',
  },
  {
    symbol: 'q[n],\\ v[n]',
    meaning: (
      <>
        1-bit comparator 輸出 <Tex>{'q=\\mathrm{sign}(\\delta u+v)=\\pm1'}</Tex> 與 comparator 前的雜訊樣本
      </>
    ),
    unit: '—,\\ \\mathrm{fs}',
    firstSeen: '章首、先備知識',
  },
  {
    symbol: 'K=K_qC',
    meaning: (
      <>
        GMAC 的平均斜率 <Tex>{'-\\partial E[G]/\\partial w'}</Tex>（<Tex>{'K>0'}</Tex> 才有恢復力）
      </>
    ),
    unit: '\\mathrm{fs}^{-1}',
    firstSeen: '§14.0',
    note: (
      <>
        勘誤 E13：§0 未定義 <Tex>{'K'}</Tex>，本站定義 <Tex>{'K:=K_qC'}</Tex>
      </>
    ),
  },
  { symbol: 'K_q=\\sqrt{2/\\pi}/\\sigma_v', meaning: '1-bit comparator 的小訊號增益（§5.1）', unit: '\\mathrm{fs}^{-1}', firstSeen: '§14.0' },
  {
    symbol: 'C=E[x\\,u]=|H|\\cos\\theta',
    meaning: '有效相關（誤差路徑在 code 頻帶的增益乘上相位的餘弦）',
    unit: '—',
    firstSeen: '§14.0',
    note: (
      <>
        <Tex>{'|\\theta|\\ge90^\\circ\\Rightarrow C\\le0'}</Tex>：極性錯誤（Ch06）
      </>
    ),
  },
  { symbol: 'g=\\mu K', meaning: '無因次迴路增益', unit: '—', firstSeen: '§14.0' },
  { symbol: 'p=1-g', meaning: '平均誤差的 pole（每 block 乘上的倍數）', unit: '—', firstSeen: '§14.0' },
  {
    symbol: '\\eta_k',
    meaning: (
      <>
        第 k 個 block 的 GMAC 雜訊（<Tex>{'G_k'}</Tex> 減去平均值）
      </>
    ),
    unit: '—',
    firstSeen: '§14.0',
    note: (
      <>
        <Tex>{'E[\\eta_k]=0'}</Tex>；不同 block 互相獨立
      </>
    ),
  },
  {
    symbol: '\\sigma_\\eta^2',
    meaning: (
      <>
        <Tex>{'\\eta'}</Tex> 的變異數；<Tex>{'x=\\pm1'}</Tex>、近鎖定時 <Tex>{'\\approx1/N'}</Tex>
      </>
    ),
    unit: '—',
    firstSeen: '§14.0',
    note: (
      <>
        精確值 <Tex>{'(1-m^2)/N'}</Tex>，<Tex>{'m=E[q\\,x]'}</Tex>
      </>
    ),
  },
  { symbol: 'f_s,\\ f_u=f_s/N', meaning: 'comparator 取樣率與 block（更新）率', unit: '\\mathrm{Hz}', firstSeen: '§14.0、§14.1' },
  { symbol: '\\tau=-1/\\ln|p|', meaning: '平均誤差的時間常數', unit: '\\text{blocks}', firstSeen: '§14.1' },
  { symbol: 'A=4BK^2\\delta_0^2/\\sigma_\\eta^2', meaning: '「初始誤差 ÷ 雜訊底」的無因次比', unit: '—', firstSeen: '§14.2' },
  {
    symbol: '\\epsilon',
    meaning: (
      <>
        相對縮減比：要求 <Tex>{'|E[\\delta_B]|\\le\\epsilon|\\delta_0|'}</Tex>，<Tex>{'0<\\epsilon<1'}</Tex>
      </>
    ),
    unit: '—',
    firstSeen: '§14.2',
    note: '勘誤 E16：不是絕對誤差（fs）',
  },
  { symbol: 'PM,\\ PM_t,\\ g_{\\max}', meaning: '一階 calibration loop 的 phase margin、其下限，與對應的最大迴路增益', unit: '^\\circ,\\ —', firstSeen: '§14.2' },
  {
    symbol: 'L(z)=g/(z-1),\\ \\omega_c',
    meaning: (
      <>
        校正迴路的開迴路轉移函數，與 <Tex>{'|L|=1'}</Tex> 的頻率（rad/block）；phase margin 就是在 <Tex>{'\\omega_c'}</Tex> 量到的
      </>
    ),
    unit: '—,\\ \\text{rad/block}',
    firstSeen: '先備知識（章首）、§14.2 (f)',
    note: (
      <>
        方塊圖見 §14.2 (f)：把回授線剪開，<Tex>{'\\times g'}</Tex> 與累加器 <Tex>{'1/(z-1)'}</Tex> 相乘
      </>
    ),
  },
  {
    symbol: 'r\\ (\\text{ramp})',
    meaning: (
      <>
        PVT ramp 漂移：<Tex>{'a'}</Tex> 每 block 增加的量
      </>
    ),
    unit: '\\mathrm{fs/block}',
    firstSeen: '§14.2',
  },
  { symbol: '\\sigma_\\zeta', meaning: 'random-walk 漂移每 block 的標準差', unit: '\\mathrm{fs}', firstSeen: '§14.2' },
  {
    symbol: 'S_w(e^{j\\Omega})',
    meaning: (
      <>
        係數雜訊 PSD（two-sided DTFT，<Tex>{'\\sigma_w^2=\\frac1{2\\pi}\\int_{-\\pi}^{\\pi}S_w\\,d\\Omega'}</Tex>）
      </>
    ),
    unit: '\\mathrm{fs^2/(cycle/block)}',
    firstSeen: '§14.2',
    note: (
      <>
        <Tex>{'\\Omega'}</Tex>（rad/block）以 block rate <Tex>{'f_u=f_s/N'}</Tex> 為準，不是 <Tex>{'f_s'}</Tex>
      </>
    ),
  },
  {
    symbol: 'K_{\\min},K_{\\max}',
    meaning: (
      <>
        所有 PVT／FCW corner 中最小、最大的 <Tex>{'K_i'}</Tex>（<Tex>{'i'}</Tex> = corner 編號）
      </>
    ),
    unit: '\\mathrm{fs}^{-1}',
    firstSeen: '§14.5',
    note: (
      <>
        勘誤 E13：<Tex>{'K_i=-\\partial E[G]/\\partial w\\,|_{\\text{corner }i}'}</Tex>，不是參數索引
      </>
    ),
  },
  { symbol: 'r=K_{\\min}/K_{\\max}', meaning: 'corner 散佈比（§14.5）', unit: '—', firstSeen: '§14.5', note: '§14.2 另以 r 表示 ramp 漂移（fs/block），依上下文與單位區分' },
  { symbol: '\\Delta,\\ M,\\ \\hat K', meaning: '量測斜率時的擾動大小、每側 block 數與斜率估計值', unit: '\\mathrm{fs},\\ —,\\ \\mathrm{fs^{-1}}', firstSeen: '§14.5' },
  {
    symbol: 'P_k,\\ k_0',
    meaning: (
      <>
        最佳排程下的 <Tex>{'E[\\delta_k^2]'}</Tex>（Kalman 變異數）與其起點偏移 <Tex>{'k_0=\\sigma_\\eta^2/(K^2\\delta_0^2)'}</Tex>
      </>
    ),
    unit: '\\mathrm{fs}^2,\\ —',
    firstSeen: '§14.6',
  },
]

/** 捲到章末符號表的按鈕（外觀像連結；用 button 而不是 href="#symbols"，HashRouter 下後者會被當成路由）。 */
export function SymbolsLink({ children }: { children: ReactNode }) {
  return (
    <button type="button" className="ch14-linkbtn" onClick={() => scrollToId(SYMBOLS_ID)}>
      {children}
    </button>
  )
}

/** 章首的一行：符號表在最後。 */
export function SymbolsJump() {
  return (
    <p className="ch14-symbols-jump small">
      <SymbolsLink>本章符號表在最後 ↓</SymbolsLink>
      <span className="muted">（正文中每個符號第一次出現時，會先用一句話說明。）</span>
    </p>
  )
}

/** 章末（頁面最後一個區塊）：本章符號表，外層 id="symbols"。 */
export function S10Symbols() {
  return (
    <section id={SYMBOLS_ID} className="ch14-symbols" aria-label="本章符號表" tabIndex={-1}>
      <SymbolTable
        rows={SYMBOLS}
        caption={md(String.raw`本章極性一律 $\delta=a-w$；$K$、$\mu$ 的單位依 average-mode GMAC（$G$ 無因次）。「首次出現」欄是正文第一次用一句話說明該符號的地方。`)}
      />
      <p className="small">
        <button type="button" className="ch14-linkbtn" onClick={() => scrollToId('ch14-top')}>
          ↑ 回到章首
        </button>
      </p>
    </section>
  )
}
