import { SymbolTable, Tex, type SymbolEntry } from '@/components'
import { ErratumNote } from '../ErratumNote'

const r = String.raw

/** 符號表外層的錨點 id（docs/teaching-style.md §5：符號表放章末，章首只留一行連結）。 */
export const SYMBOLS_ANCHOR = 'symbols'

/** 本章符號，依第一次出現的小節排列（「首次出現」是正文中就地用一句話說明它的那一節）。 */
export const SYMBOLS: SymbolEntry[] = [
  { symbol: 'x[n]', meaning: '原始 DTC／DSM code（GMAC 的 raw regressor）', unit: r`\text{無因次}`, firstSeen: '§7.1', note: <>§0 約定；Lab 中正規化成 unit power <Tex>{r`E[x^2]=1`}</Tex></> },
  {
    symbol: 'A',
    meaning: <>單頻 code 的振幅：<Tex>{r`x[n]=A\cos(\Omega n)`}</Tex></>,
    unit: r`\text{無因次}`,
    firstSeen: '§7.1',
    note: <>§7.1–7.2 的手算用 <Tex>{'A=1'}</Tex>（<Tex>{r`C_D`}</Tex> 最大 0.5）；§7.5 與 Lab 用 unit power <Tex>{r`A=\sqrt2`}</Tex>（最大 1，所有 <Tex>{'C'}</Tex> 變 2 倍）</>,
  },
  {
    symbol: r`u[n]=(h*x)[n]`,
    meaning: '經 PLL 誤差路徑到達 PD 的有效 regressor（comparator 實際「看到」的 code）',
    unit: r`\text{無因次}`,
    firstSeen: '§7.1',
    note: <>§0 定義；§11 的干擾已改名 <Tex>{r`\varepsilon_{\mathrm{cc}}`}</Tex>（E12）</>,
  },
  {
    symbol: r`h[k],\ H(e^{j\Omega})=|H|e^{j\phi}`,
    meaning: 'reference 端 DTC 留下的殘餘誤差 → PD 輸出的脈衝響應與頻率響應',
    unit: '—',
    firstSeen: '§7.1、§7.2',
    note: (
      <>
        一律離散時間；不可代入 CT 的 <Tex>{r`H(j\omega)`}</Tex>（<ErratumNote id="E44" />）。誤差從 PD 的 reference 輸入注入，所以 <Tex>{r`H_{\mathrm{PD}}=1/(1+L)`}</Tex> 取正號（§7.5）。<Tex>{'h[k]'}</Tex>、<Tex>{r`\sum_k`}</Tex> 裡的 <Tex>{'k'}</Tex> 是 tap（延遲幾個
        sample）的編號，與 block 編號（只出現在下標 <Tex>{r`w_k,\ G_k,\ \delta_k`}</Tex>）無關
      </>
    ),
  },
  { symbol: r`\Omega`, meaning: '離散時間頻率（comparator 取樣率上）', unit: r`\mathrm{rad/sample}`, firstSeen: '§7.1', note: <Tex>{r`\Omega=2\pi f/f_s`}</Tex> },
  { symbol: r`\phi=\angle H(e^{j\Omega})`, meaning: <>誤差路徑在 code 頻率的相位；<Tex>{r`\phi<0`}</Tex> 表示 <Tex>{'u'}</Tex> 落後 <Tex>{'x'}</Tex></>, unit: r`\mathrm{rad}\ (\text{或 deg})`, firstSeen: '§7.1' },
  {
    symbol: 'D',
    meaning: 'GMAC code 的延遲（shift register 級數）',
    unit: r`\text{samples}`,
    firstSeen: '§7.1',
    note: <>本章 <Tex>{'D'}</Tex> 一律指延遲 code（相位 <Tex>{r`+\Omega D`}</Tex>）；§16.1 的 code delay 也改用 <Tex>{'D'}</Tex>（E34）</>,
  },
  { symbol: r`x_D[n]=x[n-D]`, meaning: 'delayed-x regressor', unit: r`\text{無因次}`, firstSeen: '§7.1' },
  { symbol: r`\theta=\mathrm{wrap}_{180}(\phi+\Omega D)`, meaning: <>殘餘相位；<Tex>{r`|\theta|<90^\circ`}</Tex> 才有正的恢復力</>, unit: r`\mathrm{deg}`, firstSeen: '§7.1' },
  { symbol: r`M_{\mathrm{pol}}=90^\circ-|\theta|`, meaning: 'polarity margin：殘餘相位離變號還有幾度', unit: r`\mathrm{deg}`, firstSeen: '§7.1', note: '§8.1 的自訂單頻指標，不是 Bode phase margin' },
  { symbol: r`C,\ C_D`, meaning: <>GMAC regressor 與 <Tex>{'u'}</Tex> 的相關 <Tex>{r`E[x_{\mathrm{ref}}u]`}</Tex>（決定更新極性）</>, unit: r`\text{無因次}`, firstSeen: '§7.1', note: <>單頻 unit-power code：<Tex>{r`A^2/2=1`}</Tex></> },
  { symbol: r`\delta=a-w`, meaning: <>剩餘 gain 誤差（<Tex>{'a'}</Tex>：真實 DTC gain，<Tex>{'w'}</Tex>：校正係數）</>, unit: r`\mathrm{fs}\ \text{per unit code}`, firstSeen: '§7.1', note: <>本章採 <Tex>{r`\delta=a-w`}</Tex>（§0；E32）</> },
  {
    symbol: r`T_0,\ \tau_{\mathrm{DTC}}[n]=T_0-w\,x[n]`,
    meaning: <>reference 端 DTC 的基準延遲與實際延遲；<Tex>{r`w\,x[n]`}</Tex> 是 DTC 的補償量（從 <Tex>{'T_0'}</Tex> 往回扣、把 reference edge 提前的時間）</>,
    unit: r`\mathrm{fs}`,
    firstSeen: '§7.1',
    note: <><Tex>{'T_0'}</Tex> 是常數，被 PLL 當成靜態相位偏移吸收；feedback（divider）edge 早到 <Tex>{r`a\,x[n]`}</Tex></>,
  },
  {
    symbol: r`t_{\mathrm{ref}}',\ t_{\mathrm{fb}}`,
    meaning: 'DTC 延遲後的 reference edge 與 feedback（divider）edge 的時刻；PD 量的是兩者的差',
    unit: r`\mathrm{fs}`,
    firstSeen: '§7.1',
    note: <>不計常數 <Tex>{'T_0'}</Tex>：PLL 不反應時 <Tex>{r`t_{\mathrm{ref}}'-t_{\mathrm{fb}}=(a-w)\,x[n]`}</Tex>；經過迴路後留下 <Tex>{r`(a-w)\,u[n]`}</Tex></>,
  },
  {
    symbol: r`e_{\mathrm{PD}}[n],\ v[n]`,
    meaning: <>PD 的輸出（PD 誤差；comparator 取的就是它，也就是送進 loop filter 的同一個訊號）、comparator 前的雜訊（標準差 <Tex>{r`\sigma_v`}</Tex>）</>,
    unit: r`\mathrm{fs}`,
    firstSeen: '§7.1',
    note: <>章首系統地圖上標成 <Tex>{'e[n]'}</Tex></>,
  },
  { symbol: r`q[n]=\mathrm{sign}(e_{\mathrm{PD}})`, meaning: '1-bit comparator 輸出', unit: r`\pm1`, firstSeen: '§7.1', note: <><Tex>{r`e\ge0\Rightarrow q=+1`}</Tex>（E07）</> },
  { symbol: r`G_k,\ N`, meaning: <>第 <Tex>{'k'}</Tex> 個 GMAC block 的平均相關輸出；每 block 的 sample 數</>, unit: r`\text{無因次}`, firstSeen: '§7.1', note: <><Tex>{'n'}</Tex>：sample，<Tex>{'k'}</Tex>：block（E35）</> },
  { symbol: r`\mu`, meaning: 'learning rate（gain_step，average 模式）', unit: r`\mathrm{fs}`, firstSeen: '§7.1' },
  { symbol: r`K_q=\sqrt{2/\pi}/\sigma_v`, meaning: '1-bit comparator 的小訊號增益', unit: r`\mathrm{fs^{-1}}`, firstSeen: '§7.1', note: 'Ch05' },
  { symbol: r`p,\ p_f`, meaning: <>平均更新 pole <Tex>{r`1-\mu K_qC`}</Tex>；filtered-x 時 <Tex>{'C'}</Tex> 換成 <Tex>{r`E[u\,u_f]`}</Tex></>, unit: '—', firstSeen: '§7.1、§7.4' },
  {
    symbol: r`g=\mu K_qC,\ \tau=-1/\ln|p|`,
    meaning: <>校正迴路的 loop gain（每個 block 修正掉的誤差比例，<Tex>{'p=1-g'}</Tex>）與時間常數</>,
    unit: r`-,\ \text{blocks}`,
    firstSeen: '§7.1',
  },
  { symbol: r`C'_D`, meaning: <>延遲 comparator 誤差時的相關 <Tex>{r`E[x[n]u[n-D]]`}</Tex>（相位 <Tex>{r`\phi-\Omega D`}</Tex>）</>, unit: r`\text{無因次}`, firstSeen: '§7.2' },
  {
    symbol: r`\omega_nT_s,\ \zeta,\ d`,
    meaning: 'Type-II DPLL 的正規化自然頻率、阻尼、額外 loop latency',
    unit: r`\mathrm{rad/sample},\ -,\ \text{samples}`,
    firstSeen: '§7.3',
    note: <>此 <Tex>{'d'}</Tex> 是 PLL loop latency（samples），不是 §8.3 的 GMAC 更新延遲（blocks）</>,
  },
  {
    symbol: r`\rho_{\mathrm{ref}}`,
    meaning: <>正規化相關 <Tex>{r`C/\sqrt{E[x_{\mathrm{ref}}^2]E[u^2]}`}</Tex>（每單位 regressor 功率的恢復力）</>,
    unit: r`[-1,1]`,
    firstSeen: '§7.3、§7.4',
    note: <>§7.3 的表先用到（寫成 <Tex>{r`\rho`}</Tex>），§7.4 正式定義</>,
  },
  { symbol: r`S_{xx}(e^{j\Omega}),\ R_x[m]`, meaning: 'code 的雙邊 DTFT PSD 與自相關', unit: r`\text{無因次}`, firstSeen: '§7.3', note: <><Tex>{r`\sigma_x^2=\frac1{2\pi}\int S_{xx}\,d\Omega`}</Tex>（E28）</> },
  {
    symbol: r`\rho_x`,
    meaning: <>AR(1) code 的係數：<Tex>{r`R_x[m]=\rho_x^{|m|}`}</Tex>（接近 1 = 低通）</>,
    unit: r`(-1,1)`,
    firstSeen: '§7.3',
    note: <>不要和正規化相關 <Tex>{r`\rho_{\mathrm{ref}}`}</Tex> 混淆</>,
  },
  {
    symbol: r`B,\ D_{\max},\ L_{\mathrm{FIR}}`,
    meaning: 'code 的位元數、delay line 的最大級數、FIR 模型的 tap 數（硬體成本用）',
    unit: r`\text{bits},\ \text{samples},\ \text{taps}`,
    firstSeen: '§7.3、§7.6',
  },
  { symbol: r`\hat H,\ \hat h`, meaning: '誤差路徑的模型（filtered-x 用）', unit: '—', firstSeen: '章首、§7.4', note: <ErratumNote id="E45" /> },
  { symbol: r`u_f=\hat h*x`, meaning: 'filtered-x regressor', unit: r`\text{無因次}`, firstSeen: '§7.4' },
  { symbol: r`x_{\mathrm{ref}}[n]`, meaning: <>GMAC 實際相乘的 regressor：<Tex>{'x'}</Tex>、<Tex>{'x_D'}</Tex> 或 <Tex>{r`u_f[n-D]`}</Tex></>, unit: r`\text{無因次}`, firstSeen: '§7.4' },
  { symbol: r`J(w)=\tfrac12E[e_{\mathrm{PD}}^2]`, meaning: 'PD 端的均方誤差（要最小化的 cost）', unit: r`\mathrm{fs^2}`, firstSeen: '§7.4' },
  {
    symbol: r`s[n]=(a-w)\,u[n]`,
    meaning: <>comparator 輸入中由 code 決定的部分（訊號；雜訊是 <Tex>{'v'}</Tex>）</>,
    unit: r`\mathrm{fs}`,
    firstSeen: '§7.4',
    note: <>與 Ch05 的 <Tex>{'s'}</Tex> 相同；不要和 §7.5 連續時間原型 <Tex>{r`H_{\mathrm{PD}}(s)`}</Tex> 的 Laplace 變數 <Tex>{'s'}</Tex> 混淆</>,
  },
  { symbol: r`\eta_k,\ \sigma_w`, meaning: <>GMAC 每個 block 的平均雜訊；穩態時 <Tex>{'w'}</Tex> 的標準差（抖動）</>, unit: r`-,\ \mathrm{fs}`, firstSeen: '§7.4', note: 'Ch12 的主題' },
  {
    symbol: r`\Delta`,
    meaning: <><Tex>{r`\hat H`}</Tex> 多算的額外 latency（<Tex>{r`\hat H=H\,z^{-\Delta}`}</Tex>）</>,
    unit: r`\text{samples}`,
    firstSeen: '§7.5',
  },
  { symbol: r`\nabla\equiv1-z^{-1}`, meaning: <>一階差分（backward difference）；§7.5 推導 DT 的 <Tex>{r`H_{\mathrm{PD}}(z)`}</Tex> 時使用</>, unit: '—', firstSeen: '§7.5' },
  { symbol: r`K_p=2\zeta\omega_nT_s,\ K_i=(\omega_nT_s)^2`, meaning: 'DPLL 的 PI loop filter 係數（E44 的 DT 參考模型）', unit: '—', firstSeen: '§7.5' },
  {
    symbol: r`\hat H_2=K_2\,(1-z^{-1})^2,\ K_2=1/(\hat\omega_nT_s)^2`,
    meaning: 'Type-II 的二次差分 regressor（低頻近似）與它的增益',
    unit: '—',
    firstSeen: '§7.5',
    note: <><Tex>{r`K_2=1/\hat K_i`}</Tex>；只影響 <Tex>{'g'}</Tex> 的大小，不影響極性</>,
  },
  { symbol: r`d_{\mathrm{upd}}`, meaning: <>GMAC 更新延遲（blocks；規格 §8.3 的 <Tex>{'d'}</Tex>）</>, unit: r`\text{blocks}`, firstSeen: '§7.10', note: 'Ch08 的主題' },
]

/** 頁內捲動到章末的符號表。HashRouter 下 href="#symbols" 會被當成路由，所以用按鈕 + scrollIntoView（jsdom 沒有這個函式，用可選呼叫）。 */
function scrollToSymbols() {
  document.getElementById(SYMBOLS_ANCHOR)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
}

/** 章首的一行連結：「本章符號表在最後 ↓」。 */
export function SymbolsLink() {
  return (
    <p className="ch07-symlink">
      <button type="button" className="ch07-symlink-btn" onClick={scrollToSymbols}>
        本章符號表在最後 ↓
      </button>
      <span className="ch07-symlink-note">每個符號第一次出現時，正文會先用一句話說明。</span>
    </p>
  )
}

/** 章末的符號表（Recap 之後、頁面最底端）。 */
export function S8Symbols() {
  return (
    <section id={SYMBOLS_ANCHOR} className="ch07-symbols" aria-labelledby="ch07-symbols-title">
      <h2 id="ch07-symbols-title" className="ch07-symbols-title">
        本章符號表
      </h2>
      <p className="small muted">
        正文裡每個符號第一次出現時都已經就地說明；這裡是完整清單，方便回頭查單位、第一次出現的小節，以及和全站約定（規格 §0）或勘誤的關係。
      </p>
      <SymbolTable
        rows={SYMBOLS}
        title="本章符號（依第一次出現的小節排列）"
        caption={
          <>
            時間索引：<Tex>{'n'}</Tex> = comparator sample、<Tex>{'k'}</Tex> = GMAC block。本章例子皆為 illustrative，非晶片量測；所有表格數字由
            <code>src/simulation/models/filteredX.ts</code> 即時計算。
          </>
        }
      />
    </section>
  )
}
