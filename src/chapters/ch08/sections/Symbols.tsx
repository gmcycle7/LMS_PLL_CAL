import { SymbolTable, Tex, type SymbolEntry } from '@/components'
import { ErratumNote, rich } from '../common'

/** 章末符號表的錨點 id（teaching-style §5：全站統一用 symbols）與章首那一行連結的 id */
export const SYMBOLS_ID = 'symbols'
export const SYMBOLS_LINK_ID = 'ch08-symbols-link'

const SYMBOLS: SymbolEntry[] = [
  { symbol: String.raw`\theta=\phi+\Omega D`, meaning: rich(String.raw`單頻相關的總相位（從 DTC code 到 PD 輸出的 PLL error path 相位 $\phi$，加上 code delay $D$ 造成的 $\Omega D$）`), unit: String.raw`\mathrm{deg}`, firstSeen: '§8.1', note: <ErratumNote id="E34">{rich(String.raw`$D$ 是 code delay（samples），不是 §8.4 的 feedthrough $d_s$`)}</ErratumNote> },
  { symbol: String.raw`\mathrm{wrap}_{180}(\theta)`, meaning: rich(String.raw`把角度折回 $[-180^\circ,180^\circ)$ 的函數，週期 $360^\circ$`), unit: String.raw`\mathrm{deg}`, firstSeen: '§8.1', note: <ErratumNote id="E20">{rich(String.raw`規格未定義值域，本章採 $((\theta+180^\circ)\bmod 360^\circ)-180^\circ$`)}</ErratumNote> },
  { symbol: String.raw`M_{\mathrm{polarity}}`, meaning: rich(String.raw`Polarity margin：$\theta$ 離 $\pm90^\circ$ 邊界還有多遠（只看更新方向）`), unit: String.raw`\mathrm{deg}`, firstSeen: '§8.1', note: rich(String.raw`等於 $\arcsin(\cos\theta)$`) },
  { symbol: String.raw`\psi`, meaning: rich(String.raw`折回後的角度 $\psi=\mathrm{wrap}_{180}(\theta)$（手算流程圖與 F-08.1 的推導用）`), unit: String.raw`\mathrm{deg}`, firstSeen: '§8.1', note: rich(String.raw`$-180^\circ\le\psi<180^\circ$；$M_{\mathrm{polarity}}=90^\circ-|\psi|$`) },
  { symbol: String.raw`\delta_k=a-w_k`, meaning: rich(String.raw`第 $k$ 個 block 的剩餘參數誤差`), unit: String.raw`\mathrm{fs}`, firstSeen: '§8.2', note: rich(String.raw`全站極性約定 $\delta=a-w$（§0）`) },
  { symbol: String.raw`G_k`, meaning: rich(String.raw`GMAC 第 $k$ 個 block 的平均相關輸出（average mode）`), unit: String.raw`1`, firstSeen: '§8.2', note: <ErratumNote id="E18">{rich(String.raw`sum mode 要再乘 $N$；§8.4 的 $G$ 以 $K\equiv1$ 正規化（與 $\delta$ 同單位）`)}</ErratumNote> },
  { symbol: String.raw`K=K_qC`, meaning: rich(String.raw`GMAC 平均輸出對 $\delta$ 的斜率（小誤差線性化）`), unit: String.raw`\mathrm{fs}^{-1}`, firstSeen: '§8.2', note: <ErratumNote id="E13">{rich(String.raw`§0 未定義 $K$，本站定義 $K=K_qC=-\partial E[G]/\partial w$`)}</ErratumNote> },
  { symbol: String.raw`\mu`, meaning: '學習率（每個 block 更新一次）', unit: String.raw`\mathrm{fs}`, firstSeen: '§8.2', note: <ErratumNote id="E13">{rich(String.raw`§8.4 中為 $K\equiv1$ 的正規化步長（無因次，等同 $g$）`)}</ErratumNote> },
  { symbol: String.raw`g=\mu K`, meaning: '正規化 loop gain（決定一切穩定性的無因次量）', unit: String.raw`1`, firstSeen: '§8.2' },
  { symbol: String.raw`\tau_{\mathrm{DTC}}[n]=T_0-w_k\,x[n]`, meaning: rich(String.raw`reference 端 DTC 的延遲：從固定的基準延遲 $T_0$ 往回扣補償量 $w_k\,x[n]$（reference edge 被提前——也就是少延遲——的時間）`), unit: String.raw`\mathrm{fs}`, firstSeen: '§8.2', note: rich(String.raw`DTC 只能延遲、不能提前；$T_0$ 是常數，被 PLL 當成靜態相位偏移吸收`) },
  { symbol: String.raw`z`, meaning: rich(String.raw`Z transform 變數；$z^{-1}$ ＝延遲一個 block`), unit: String.raw`1`, firstSeen: '§8.2' },
  { symbol: String.raw`L_{\mathrm{cal}}(z)`, meaning: 'Calibration loop 的開迴路增益（loop gain）', unit: String.raw`1`, firstSeen: '§8.2' },
  { symbol: String.raw`\omega`, meaning: rich(String.raw`block-rate 離散頻率，$\omega=2\pi f/f_u$，$0\le\omega\le\pi$`), unit: String.raw`\mathrm{rad/block}`, firstSeen: '§8.2', note: rich(String.raw`不是 comparator rate 的 $\Omega$（rad/sample）`) },
  { symbol: String.raw`\omega_c`, meaning: rich(String.raw`Gain crossover：$|L(e^{j\omega_c})|=1$ 的頻率`), unit: String.raw`\mathrm{rad/block}`, firstSeen: '§8.2' },
  { symbol: String.raw`\omega_{180}`, meaning: rich(String.raw`Phase crossover：$\angle L(e^{j\omega_{180}})=-180^\circ$ 的頻率`), unit: String.raw`\mathrm{rad/block}`, firstSeen: '§8.2', note: rich(String.raw`延遲模型 $\frac{\pi}{2d+1}$；二狀態模型 $\arccos\frac{1+r_s}{2}$`) },
  { symbol: String.raw`PM,\;GM,\;DM`, meaning: 'Phase margin、Gain margin、Delay margin', unit: String.raw`\mathrm{deg},\;\mathrm{dB},\;\mathrm{blocks}`, firstSeen: '§8.2' },
  { symbol: String.raw`d`, meaning: rich(String.raw`更新延遲：GMAC 結果要 $d$ 個 block 後才作用到 DTC`), unit: String.raw`\mathrm{blocks}`, firstSeen: '§8.3', note: <ErratumNote id="E34">{rich(String.raw`不是 §11 的 $d(x)$，也不是 code delay $D$，也不是 §8.4 的 feedthrough $d_s$`)}</ErratumNote> },
  { symbol: String.raw`P(z)`, meaning: '閉迴路特徵多項式（根 = 閉迴路 poles）', unit: String.raw`1`, firstSeen: '§8.3' },
  { symbol: String.raw`\rho`, meaning: 'Spectral radius：所有 pole（或 eigenvalue）絕對值的最大者', unit: String.raw`1`, firstSeen: '§8.3', note: rich(String.raw`$\rho<1\iff$ 線性模型穩定`) },
  { symbol: String.raw`g^{*}(d)`, meaning: rich(String.raw`延遲 $d$ 時的臨界增益`), unit: String.raw`1`, firstSeen: '§8.3' },
  { symbol: String.raw`\omega^{*}`, meaning: rich(String.raw`臨界時（$g=g^{*}(d)$）踩在單位圓上的那個根的角度，$\omega^{*}=\frac{\pi}{2d+1}$`), unit: String.raw`\mathrm{rad/block}`, firstSeen: '§8.3', note: rich(String.raw`等於延遲模型的 $\omega_{180}$；$g=g^{*}(d)$ 時 $\omega_c=\omega^{*}$`) },
  { symbol: String.raw`PM_d,\;GM_d`, meaning: rich(String.raw`含 $d$ 個 block 更新延遲時的 phase margin 與 gain margin`), unit: String.raw`\mathrm{deg},\;\mathrm{dB}`, firstSeen: '§8.3', note: rich(String.raw`$PM_d=90^\circ-(2d+1)\arcsin\frac g2$、$GM_d=\frac{g^{*}(d)}{g}$；$d=0$ 時回到 §8.2 的 $PM$、$GM$`) },
  { symbol: String.raw`N_{\mathrm{blk}}`, meaning: '模擬或觀察的 block 數（實驗中的「模擬長度」）', unit: String.raw`\mathrm{blocks}`, firstSeen: '實驗 1', note: <ErratumNote id="E34">{rich(String.raw`刻意不用 $K$：$K$ 已是 GMAC 斜率`)}</ErratumNote> },
  { symbol: String.raw`s_k`, meaning: rich(String.raw`抽象觀測狀態（主 PLL 對 $\delta$ 的「記憶」）`), unit: String.raw`\mathrm{fs}`, firstSeen: '§8.4', note: <ErratumNote id="E34">{rich(String.raw`不是 VCO 控制電壓，也不是 §5 的誤差 $s$`)}</ErratumNote> },
  { symbol: String.raw`r_s,\;b_s,\;c_s`, meaning: rich(String.raw`二狀態模型：觀測 pole、$\delta\to s$ 耦合、$s\to G$ 觀測增益（正規化後無因次）`), unit: String.raw`1`, firstSeen: '§8.4', note: <ErratumNote id="E31">{rich(String.raw`規格寫 $r,b,c$；改名避免與 §0 的 $\mathbf C$、§11 的 $c$ 衝突`)}</ErratumNote> },
  { symbol: String.raw`\mathbf A_s,\;\mathbf b_s,\;\mathbf c_s^{\mathsf T},\;d_s`, meaning: '一般化觀測 state-space：狀態矩陣、輸入、輸出、直通', unit: String.raw`1`, firstSeen: '§8.4', note: <ErratumNote id="E31">{rich(String.raw`規格寫 $\mathbf A,\mathbf B,\mathbf C,D$；$\mathbf c_s^{\mathsf T}$ 即規格的 $\mathbf C$（亦稱 $\mathbf C_{\mathrm{obs}}$），不是 §0 的相關矩陣 $\mathbf C=E[\mathbf x\mathbf u^{\mathsf T}]$`)}</ErratumNote> },
  { symbol: String.raw`\mathbf A_{\mathrm{comb}}`, meaning: rich(String.raw`把觀測狀態與 $\delta$ 合併後的閉迴路矩陣`), unit: String.raw`1`, firstSeen: '§8.4' },
  { symbol: String.raw`F(z)`, meaning: rich(String.raw`觀測轉移函數 $\delta\to G$（$F(1)$ 就是等效 $K$）`), unit: String.raw`1`, firstSeen: '§8.4' },
  { symbol: String.raw`g_{\mathrm{eff}}=\mu F(1)`, meaning: rich(String.raw`雙迴路的等效 loop gain：quasi-static 一階模型的 $g$`), unit: String.raw`1`, firstSeen: '§8.4', note: rich(String.raw`二狀態模型 $g_{\mathrm{eff}}=\frac{\mu b_sc_s}{1-r_s}$；完整模型要求 $g_{\mathrm{eff}}<1$`) },
  { symbol: String.raw`\mu_{\max}`, meaning: rich(String.raw`學習率上限：$\mu_{\max}=g^{*}(d)/K$（$\mu$ 超過它，線性平均模型就不穩定）`), unit: String.raw`\mathrm{fs}`, firstSeen: '綜合手算', note: rich(String.raw`入門課的例子（$\sigma_v=100$ fs、$C=1$）：$d=0$ 是 $250.66$ fs，$d=1$ 是 $125.33$ fs`) },
]

/**
 * 捲到指定 id 的元素。HashRouter 下不能用 `<a href="#symbols">`（會被當成路由），所以用按鈕 + scrollIntoView。
 * 使用者偏好「減少動態效果」時不做平滑捲動；捲到之後把焦點移過去，鍵盤與螢幕閱讀器使用者才知道位置變了。
 */
function scrollToId(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  el.focus?.({ preventScroll: true })
}

/** 章首只留這一行（teaching-style §5）：符號表移到章末，按一下捲過去。 */
export function SymbolsLink() {
  return (
    <p className="ch08-symbols-link small" id={SYMBOLS_LINK_ID} tabIndex={-1}>
      <button type="button" className="ch08-link-button" onClick={() => scrollToId(SYMBOLS_ID)}>
        本章符號表在最後 ↓
      </button>
      <span className="muted ch08-symbols-hint">每個符號第一次出現時，正文會先用一句話說明；想一次查全部再按這裡。</span>
    </p>
  )
}

/** 章末的本章符號表（頁面最後一個區塊；外層 id="symbols"）。 */
export function ChapterSymbols() {
  return (
    <section className="ch08-symbols" id={SYMBOLS_ID} tabIndex={-1} aria-label="本章符號表">
      <SymbolTable
        title="本章符號表（依第一次出現的順序）"
        rows={SYMBOLS}
        caption={
          <>
            全站約定見 Formula &amp; Unit Reference。本章的時間索引 <Tex>{'k'}</Tex> 一律是 GMAC block（更新率 <Tex>{'f_u=f_s/N'}</Tex>），頻率 <Tex>{'\\omega'}</Tex> 以 rad/block 計；只有
            §8.1 的 <Tex>{'\\Omega'}</Tex> 是 comparator rate（rad/sample）。
          </>
        }
      />
      <p className="small">
        <button type="button" className="ch08-link-button" onClick={() => scrollToId(SYMBOLS_LINK_ID)}>
          ↑ 回到章首
        </button>
      </p>
    </section>
  )
}

export { SYMBOLS }
