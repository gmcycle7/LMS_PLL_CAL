import { SymbolTable, Tex, type SymbolEntry } from '@/components'
import { Erratum, LSB_FS_EXAMPLE, tx } from '../common'

/**
 * 本章符號表（docs/teaching-style.md §5：放在章末，外層 id="symbols"；章首只留一行連結）。
 * 正文中每個符號第一次出現時都先用一句話說明，這張表是「忘了再回來查」用的。
 */
export const SYMBOLS_ID = 'symbols'
/** 章首（「這次我們要回答的問題」）的錨點，符號表底下的「回到章首」用。 */
const TOP_ID = 'ch13-question'

const SYMBOLS: SymbolEntry[] = [
  { symbol: String.raw`w^*`, meaning: '理想（最佳）校正係數，本章例子 32.4', unit: String.raw`\mathrm{LSB}`, firstSeen: '§13.0', note: tx(String.raw`規格 §13 的 $w^*$；換成 fs 要乘 $\Delta_\mathrm{LSB}$`) },
  { symbol: String.raw`w_H[n]`, meaning: 'LMS 內部的高解析係數（accumulator 內容）', unit: String.raw`\mathrm{LSB}`, firstSeen: '§13.0', note: tx(String.raw`常數情境 $w_H=w^*$；時變情境 $w_H[n]=w^*+\delta w[n]$`) },
  { symbol: String.raw`y[n]`, meaning: '實體 6-bit gain code（DTC gain register 的值）', unit: String.raw`\mathrm{LSB}`, firstSeen: '§13.0', note: <Tex>{String.raw`y\in\{0,1,\dots,2^B-1\}`}</Tex> },
  { symbol: 'B', meaning: 'gain register 的位元數（本章 6）', firstSeen: '§13.0' },
  { symbol: String.raw`\Delta_\mathrm{LSB}`, meaning: '1 個 gain LSB 對應的 DTC gain', unit: String.raw`\mathrm{fs}/\mathrm{LSB}`, firstSeen: '§13.0', note: <><Erratum id="E13" />：規格原未給，本章示例 <Tex>{String.raw`${LSB_FS_EXAMPLE}\,\mathrm{fs/LSB}`}</Tex></> },
  { symbol: String.raw`Q_B(\cdot)`, meaning: tx(String.raw`$B$-bit 量化器：round-half-up $\lfloor v+\tfrac12\rfloor$ 或 floor $\lfloor v\rfloor$；超出 $[0,2^B-1]$ 時 saturate / wrap`), firstSeen: '§13.1' },
  { symbol: String.raw`\delta w=w-w^*`, meaning: '係數誤差（本章顯示用的約定）', unit: String.raw`\mathrm{LSB}`, firstSeen: '§13.0', note: <><Erratum id="E49" />：{tx(String.raw`§0 約定 $\delta=a-w=-\delta w$，正負號相反`)}</> },
  { symbol: String.raw`e[n]=y[n]-w^*`, meaning: 'code 誤差（gain error）', unit: String.raw`\mathrm{LSB}`, firstSeen: '§13.0' },
  { symbol: String.raw`\overline e,\;\overline{e^2}`, meaning: tx(String.raw`時間平均（DC 誤差）與平方平均（總誤差功率）；$\overline{e^2}=\overline e^{\,2}+$ 變異數`), unit: String.raw`\mathrm{LSB},\;\mathrm{LSB}^2`, firstSeen: '§13.1' },
  { symbol: 'p', meaning: <><Tex>{String.raw`w^*`}</Tex> 的小數部分 <Tex>{String.raw`\mathrm{frac}(w^*)`}</Tex>（<Tex>{String.raw`32.4\to0.4`}</Tex>）；也是 stochastic rounding 輸出 33 的機率</>, firstSeen: '§13.2', note: tx(String.raw`第 12 章的係數 pole $p$ 在本章改記為 $p_\mathrm{cal}$，避免衝突`) },
  { symbol: String.raw`L_t,\;h,\;n'`, meaning: tx(String.raw`toggle pattern 的週期、其中「進位」的個數（5 與 2），與這一拍在 pattern 裡的位置 $n'=n\bmod L_t$`), firstSeen: '§13.2' },
  { symbol: String.raw`s[n]`, meaning: tx(String.raw`toggle 的「進位指示」（0 或 1）：$y[n]=\lfloor w^*\rfloor+s[n]$`), firstSeen: '§13.2', note: tx(String.raw`stochastic rounding 的同一個角色記為 Bernoulli 變數 $X$`) },
  { symbol: String.raw`c_k,\;P_k`, meaning: tx(String.raw`週期誤差的第 $k$ 個傅立葉係數與 one-sided 線功率（頻率 $kf_u/q$）`), unit: String.raw`\mathrm{LSB},\;\mathrm{LSB}^2`, firstSeen: '§13.2' },
  { symbol: String.raw`f_u`, meaning: tx(String.raw`6-bit code 的更新率（每個 reference cycle 更新時 $f_u=f_\mathrm{ref}$；每個 GMAC block 更新時 $f_u=f_s/N$）`), unit: String.raw`\mathrm{Hz}`, firstSeen: '§13.2', note: <><Erratum id="E47" />：{tx(String.raw`規格的 $f_\mathrm{toggle}$ 未定義，本章一律用 $f_u$`)}</> },
  { symbol: String.raw`S_e^{(1)}(f),\;S_{\delta t}^{(1)}(f)`, meaning: tx(String.raw`code 誤差 $e$ 與 timing error $\delta t$ 的 one-sided PSD（每 Hz 的功率；從 $0$ 積到 Nyquist 頻率就是總功率）`), unit: String.raw`\mathrm{LSB}^2/\mathrm{Hz},\;\mathrm{fs}^2/\mathrm{Hz}`, firstSeen: '§13.3 / §13.5b' },
  { symbol: String.raw`f_s,\;N_\mathrm{upd}`, meaning: tx(String.raw`reference / DTC 取樣率；每 $N_\mathrm{upd}$ 個 reference cycle 更新一次 code（$f_u=f_s/N_\mathrm{upd}$）`), unit: String.raw`f_s:\ \mathrm{Hz}`, firstSeen: '§13.2', note: tx(String.raw`§13.2 的 ZOH 推導把保持的樣本數記為 $N_h$，與 $N_\mathrm{upd}$ 是同一個量`) },
  { symbol: String.raw`G_k\ (\text{GMAC})`, meaning: tx(String.raw`GMAC 第 $k$ 個 block 的平均（comparator 輸出乘上 code 的平均，第 4 章）；只出現在 §13.0 的訊號流圖`), firstSeen: '§13.0', note: tx(String.raw`與下一列的 ZOH 權重 $G_k$ 同名不同義：那裡的 $k$ 是譜線編號`) },
  { symbol: String.raw`G_k\ (\text{ZOH})`, meaning: tx(String.raw`ZOH 對第 $k$ 條譜線的權重（離散 sinc）：$G_k=\sin(\pi k/5)/\big(N_h\sin(\pi k/(5N_h))\big)$`), firstSeen: '§13.2', note: tx(String.raw`§13.2 圖與公式 F-13.5 專用；與 §13.0 的 GMAC 平均 $G_k$ 不同`) },
  { symbol: String.raw`\Omega=2\pi f/f_u`, meaning: '以 code 更新率為取樣率的離散時間頻率', unit: String.raw`\mathrm{rad/sample}`, firstSeen: '§13.4' },
  { symbol: String.raw`v[n],\;r[n]`, meaning: 'ΔΣ 量化器輸入與內部量化誤差（residual）', unit: String.raw`\mathrm{LSB}`, firstSeen: '§13.4', note: tx(String.raw`round-half-up 時 $r\in[-\tfrac12,\tfrac12)$；floor 時 $r\in[0,1)$（方法 D、沒有 overload；方法 E 加了峰對峰 $A$ 的 dither 後，範圍兩端各多 $\tfrac A2$）`) },
  { symbol: String.raw`\sigma_r^2`, meaning: tx(String.raw`$r$ 的變異數；白色近似取 $\tfrac1{12}$，常數 32.4 時實際為 0.08`), unit: String.raw`\mathrm{LSB}^2`, firstSeen: '§13.4', note: <Erratum id="E15" /> },
  { symbol: String.raw`\mathrm{NTF}(z)=1-z^{-1}`, meaning: '一階 noise transfer function', firstSeen: '§13.4' },
  { symbol: String.raw`q,\;m`, meaning: tx(String.raw`有理目標 $w=m/q$（最簡分數）；$q$ 也是 limit cycle 的週期`), firstSeen: '§13.4' },
  { symbol: String.raw`F,\;K`, meaning: tx(String.raw`$w_H$ 定點表示的小數位元數；$K=w_H\cdot2^F$ 為整數`), unit: String.raw`F:\ \mathrm{bit}`, firstSeen: '§13.1 / §13.4', note: tx(String.raw`§13.5b 的 $K$ 另指 DSM 的 FCW 整數（$\mathrm{frac}\cdot2^{20}$），以上下文區分`) },
  { symbol: String.raw`d[n],\;A,\;\sigma_d^2`, meaning: tx(String.raw`dither、其峰對峰寬度、變異數（RPDF：$A^2/12$；TPDF：$A^2/24$）`), unit: String.raw`\mathrm{LSB},\;\mathrm{LSB}^2`, firstSeen: '§13.4E' },
  { symbol: String.raw`u[n],\;e_q[n]`, meaning: tx(String.raw`加了 dither 的量化器輸入 $u=v+d$，與量化器本身的誤差 $e_q=y-u$`), unit: String.raw`\mathrm{LSB}`, firstSeen: '§13.4E', note: tx(String.raw`§13.3 PRBS 說明裡的 $P(u<p)$ 是另一個量：均勻落在 $[0,1)$ 的亂數（方塊圖上寫成 rand）`) },
  { symbol: String.raw`\delta w[n],\;\sigma_w,\;p_\mathrm{cal},\;\xi[n]`, meaning: tx(String.raw`LMS 更新雜訊（AR(1)）、其穩態 RMS、pole（第 12 章的 $p$），與驅動它的單位變異數白雜訊 $\xi[n]$`), unit: String.raw`\mathrm{LSB}`, firstSeen: '§13.0 / §13.5a' },
  { symbol: String.raw`\epsilon[n]=y[n]-w_H[n]`, meaning: tx(String.raw`量化誤差：只看量化器本身（不含 LMS 雜訊）；用 $\epsilon$ 是為了和有理分母 $q$、量化器誤差 $e_q$ 區分`), unit: String.raw`\mathrm{LSB}`, firstSeen: '§13.5a', note: tx(String.raw`$e=\epsilon+\delta w$`) },
  { symbol: String.raw`f_B=f_u/64`, meaning: '本章「頻帶內」的上緣（相當於 OSR = 32）：會被當成 static / 慢變 gain error 的頻段', unit: String.raw`\mathrm{Hz}`, firstSeen: '§13.5a' },
  { symbol: String.raw`P_\mathrm{in},\;p_0`, meaning: tx(String.raw`頻帶內（$0<f<f_B$）的量化誤差功率；$w^*$ 的小數部分（本例 0.4）。$p$ 則是會隨 $w_H[n]$ 擺動的瞬時小數部分`), unit: String.raw`\mathrm{LSB}^2`, firstSeen: '§13.5a' },
  { symbol: String.raw`x[n],\;\delta t[n]`, meaning: tx(String.raw`DSM residue（正規化 regressor，也就是 DTC 的 code）與 DTC 補償量的誤差 $\delta t=\Delta_\mathrm{LSB}\,e\,x$（多補償的時間：$\delta t>0$ 時 DTC 從 $T_0$ 扣得太多，reference edge 比該到的時刻早 $\delta t$）`), unit: String.raw`\delta t:\ \mathrm{fs}`, firstSeen: '§13.0', note: tx(String.raw`PD 量的是 reference 減 feedback，所以 PD 的輸出裡它是 $-\delta t$`) },
  { symbol: String.raw`e_\mathrm{PD}[n]`, meaning: tx(String.raw`PD 的輸出（送進 loop filter 的同一個訊號；1-bit comparator 取它的正負號）：$e_\mathrm{PD}=t_\mathrm{ref}'-t_\mathrm{fb}=(a-w)\,x+v=-\delta t+v$（$a=\Delta_\mathrm{LSB}\,w^*$、$w=\Delta_\mathrm{LSB}\,y$）`), unit: String.raw`\mathrm{fs}`, firstSeen: '§13.0', note: tx(String.raw`系統地圖上標 $e[n]$ 的就是它；本章的 $e=y-w^*$ 是 code 誤差，所以 PD 輸出改記 $e_\mathrm{PD}$`) },
  { symbol: String.raw`T_0,\;C_0`, meaning: tx(String.raw`reference 端 DTC 的基準延遲與對應的中心 code：DTC 只能延遲，所以延遲是 $T_0-w\,x[n]$、送進 DTC 的 code 是 $C_0-w\,x[n]$（補償量 $w\,x[n]$ 從基準往回扣）`), unit: String.raw`T_0:\ \mathrm{fs}`, firstSeen: '§13.0', note: tx(String.raw`$T_0$ 是常數，被 PLL 當成靜態相位偏移吸收，不影響任何會動的量`) },
  { symbol: String.raw`e_s[n]`, meaning: tx(String.raw`code 誤差以 ZOH 保持到 $f_s$ 的版本：$e_s[n]=e[\lfloor n/N_\mathrm{upd}\rfloor]$`), unit: String.raw`\mathrm{LSB}`, firstSeen: '§13.5b' },
  { symbol: String.raw`T(f),\;f_\mathrm{BW}`, meaning: tx(String.raw`從 DTC 的殘餘誤差（在 PD 的 reference 輸入注入）到 PLL output 的 closed-loop transfer（$\theta_\mathrm{out}=T\,\phi_\mathrm{dtc}$，$\phi_\mathrm{dtc}=-2\pi f_\mathrm{out}\,\delta t$，$f_\mathrm{out}$ 是 PLL 的輸出頻率；low-pass）與它的 $-3\,\mathrm{dB}$ 頻寬`), unit: String.raw`f_\mathrm{BW}:\ \mathrm{Hz}`, firstSeen: '§13.0 / §13.5b' },
  { symbol: String.raw`\sigma_{\delta t},\;\sigma_\mathrm{out}`, meaning: tx(String.raw`$\delta t$ 的 RMS（未經 PLL）與經 $|T(f)|^2$ 加權積分後的 output jitter（只含 $f\ge f_L$）`), unit: String.raw`\mathrm{fs}`, firstSeen: '§13.5b' },
  { symbol: String.raw`f_L,\;\sigma_\mathrm{slow},\;\overline{\delta t}`, meaning: tx(String.raw`$\sigma_\mathrm{out}$ 的積分下限（Welch 的頻率解析度 $f_s/N_\mathrm{seg}$）；比它慢的成分 RMS；整段紀錄的平均（靜態偏移，或分辨不出的慢差頻）`), unit: String.raw`\mathrm{Hz},\;\mathrm{fs},\;\mathrm{fs}`, firstSeen: '§13.5b' },
  { symbol: String.raw`P_\mathrm{code},\;P_\mathrm{DSM},\;P_\mathrm{mix}`, meaning: tx(String.raw`code 的 limit-cycle 週期、DSM residue 的週期，與混頻產物的週期 $P_\mathrm{mix}=\mathrm{lcm}(P_\mathrm{code}N_\mathrm{upd},\,P_\mathrm{DSM})$ 個 reference cycle`), unit: String.raw`\text{更新次數},\;\text{cycles},\;\text{cycles}`, firstSeen: '§13.5b' },
  { symbol: String.raw`\Delta y[n]=y[n]-y[n-1]`, meaning: tx(String.raw`一次更新的 code 跳動量；$\max|\Delta y|$ 是整段紀錄裡最大的一步`), unit: String.raw`\mathrm{LSB}`, firstSeen: '§13.6', note: tx(String.raw`gray 碼的單 bit 保證只在 $|\Delta y|\le1$ 時成立`) },
  { symbol: String.raw`\mathrm{gray}(n)=n\oplus\lfloor n/2\rfloor`, meaning: tx(String.raw`reflected-binary gray 碼（$\oplus$ 是逐 bit 的 XOR）：相鄰的兩個整數只差 1 個 bit`), firstSeen: '§13.6', note: tx(String.raw`例：$\mathrm{gray}(31)=010000_2$、$\mathrm{gray}(32)=110000_2$、$\mathrm{gray}(34)=110011_2$`) },
]

/** 捲到指定錨點並把鍵盤焦點移過去。HashRouter 下不能用 href="#id"（會改掉路由），所以用 scrollIntoView。 */
function scrollToId(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  // jsdom 沒有 scrollIntoView
  if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  el.focus({ preventScroll: true })
}

/** 章首的那一行：「本章符號表在最後 ↓」。 */
export function SymbolsLink() {
  return (
    <p className="small ch13-symbols-link">
      <button type="button" className="ch13-linklike" data-testid="ch13-symbols-link" onClick={() => scrollToId(SYMBOLS_ID)}>
        本章符號表在最後 ↓
      </button>
      <span className="muted">（每個符號第一次出現時，正文會先用一句話說明）</span>
    </p>
  )
}

/** 章末的符號表（整頁最後一塊）。 */
export function SymbolsSection() {
  return (
    <section id={SYMBOLS_ID} className="ch13-symbols" tabIndex={-1} aria-label="本章符號表">
      <SymbolTable
        rows={SYMBOLS}
        caption={
          <>
            全站約定見規格 §0。本章 code 一律以 LSB 為單位，換成時間要乘 <Tex>{String.raw`\Delta_\mathrm{LSB}`}</Tex>（<Erratum id="E13" />）；誤差顯示用{' '}
            <Tex>{String.raw`\delta w=w-w^*`}</Tex>，與 §0 的 <Tex>{String.raw`\delta=a-w`}</Tex> 正負號相反（<Erratum id="E49" />）。
          </>
        }
      />
      <p className="small">
        <button type="button" className="ch13-linklike" data-testid="ch13-symbols-top" onClick={() => scrollToId(TOP_ID)}>
          ↑ 回到章首
        </button>
      </p>
    </section>
  )
}
