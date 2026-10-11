import { SymbolTable, type SymbolEntry, Tex } from '@/components'
import { Erratum, JumpTo, jumpTo, mt } from '../common'

const R = String.raw

/** 章末符號表外層的 id（docs/teaching-style.md §5：符號表放在每章最後，章首只留一行連結）。 */
export const SYMBOLS_ID = 'symbols'

export const CH04_SYMBOLS: SymbolEntry[] = [
  { symbol: 'n', meaning: mt(R`comparator sample 索引（本章假設一個 reference cycle 一個 sample，$f_s=f_\mathrm{ref}$）`), firstSeen: '§1', note: mt(R`全站約定：$n$ = sample、$k$ = block`) },
  { symbol: 'k', meaning: mt(R`GMAC block 索引（第 $k$ 個 block 含 sample $n=kN,\dots,kN+N-1$）`), firstSeen: '§1' },
  { symbol: 'N', meaning: '每個 block 累加的 sample 數（GMAC 累加長度）', unit: R`\text{samples}`, firstSeen: '§1' },
  { symbol: R`f_s,\;f_u=f_s/N`, meaning: 'comparator 取樣率、校正更新率（block rate）', unit: R`\mathrm{Hz}`, firstSeen: '§3' },
  { symbol: R`N_\mathrm{int}`, meaning: mt(R`FCW 的整數部分：divider 每一拍至少數 $N_\mathrm{int}$ 個 VCO 週期（有 carry 時多數 1 個）`), firstSeen: '§2' },
  { symbol: R`\mathrm{frac},\;K_\mathrm{F}`, meaning: mt(R`FCW 的小數部分；累加器每拍加入的整數字 $K_\mathrm{F}$，$\mathrm{frac}=K_\mathrm{F}/M$`), firstSeen: '§2' },
  { symbol: R`M=2^{B_\mathrm{dsm}}`, meaning: mt(R`DSM 累加器的模數（$B_\mathrm{dsm}$ 位元）`), firstSeen: '§2' },
  { symbol: R`s[n],\;t[n]`, meaning: mt(R`DSM 累加器內容（整數 $0,\dots,M-1$）＝ DTC 要用的 code；$t[n]=s[n-1]+K_\mathrm{F}$ 是取模前的加法器輸出`), unit: R`\text{LSB}`, firstSeen: '§2' },
  { symbol: 'y[n]', meaning: '累加器 carry（divider 這一拍多除 1 個 VCO 週期）', unit: R`\{0,1\}`, firstSeen: '§2' },
  { symbol: 'r[n]', meaning: 'divider edge 的累積時間誤差（fractional residue），正 = 晚到', unit: R`T_\mathrm{vco}`, firstSeen: '§2', note: '與 dsm.ts 的 residue 相同' },
  { symbol: R`T_\mathrm{vco}`, meaning: mt(R`VCO 週期 $1/f_\mathrm{vco}$`), unit: R`\mathrm{fs}`, firstSeen: '§2' },
  { symbol: R`\varepsilon`, meaning: mt(R`DTC gain 的相對誤差 $(a-w)/a$（residue 實驗的控制項）`), unit: R`\%`, firstSeen: '§2' },
  { symbol: 'x[n]', meaning: mt(R`正規化後的 code / regressor（本章多用 $s[n]/M$ 或 $x_\mathrm{int}/2^{B_x-1}$）`), unit: R`\text{無因次}`, firstSeen: '§2', note: <><Erratum id="E13" />{mt(R`：$x$、$u$ 無因次，時間單位由 $a$、$w$ 承載`)}</> },
  { symbol: R`a,\;w_k`, meaning: mt(R`真實需要的 DTC gain、第 $k$ 個 block 使用的校正 gain`), unit: R`\mathrm{fs}/\text{unit code}`, firstSeen: '§2', note: <Erratum id="E13" /> },
  { symbol: R`\delta_k=a-w_k`, meaning: '剩餘 gain 誤差', unit: R`\mathrm{fs}/\text{unit code}`, firstSeen: '§2', note: <>{mt(R`全站約定 $\delta=a-w$ `)}<Erratum id="E32" /> <Erratum id="E39" /></> },
  { symbol: R`\tau_\mathrm{DTC}[n],\;e_\mathrm{det}[n]`, meaning: mt(R`DTC 必須補償的延遲 $x[n]\,T_\mathrm{vco}$；gain 有誤差時 PD 看到的確定性殘差 $\delta\,x[n]$（不含雜訊）`), unit: R`\mathrm{fs}`, firstSeen: '§2' },
  { symbol: R`H_\mathrm{PD},\;u[n]=(h*x)[n]`, meaning: 'DTC 誤差到 PD 的轉移函數、有效 regressor', unit: R`\text{同 }x`, firstSeen: '§3', note: <Erratum id="E13" /> },
  { symbol: R`v[n],\;\sigma_v`, meaning: 'comparator 前雜訊與其 RMS', unit: R`\mathrm{fs}`, firstSeen: '§3' },
  { symbol: R`b_\mathrm{off}`, meaning: 'comparator offset（只在系統圖 C 與一圈推導出現；Ch11 詳述）', unit: R`\mathrm{fs}`, firstSeen: '§3', note: <>{mt(R`規格 §11 寫 $b$；本章改名 $b_\mathrm{off}$，避免與 comparator 位元 $b[n]$ 衝突（同 `)}<Erratum id="E34" />{mt(R` 的符號去衝突原則）`)}</> },
  { symbol: 'e[n]', meaning: mt(R`comparator 前的 PD 誤差 $e=\delta\,u+b_\mathrm{off}+v$`), unit: R`\mathrm{fs}`, firstSeen: '§3' },
  { symbol: 'b[n]', meaning: mt(R`comparator 原始輸出位元，$b=1\Leftrightarrow e\ge0$`), unit: R`\{0,1\}`, firstSeen: '§4', note: <><Erratum id="E07" />{mt(R`：tie（$e=0$）判 $+1$`)}</> },
  { symbol: 'q[n]=2b[n]-1', meaning: '雙極性 comparator 輸出', unit: R`\{-1,+1\}`, firstSeen: '§4' },
  { symbol: R`x_\mathrm{ref}[n]`, meaning: mt(R`GMAC 實際相乘的對齊 code：$x[n-D]$ 或 filtered-x $u_f[n-D]$`), firstSeen: '§3' },
  { symbol: 'D', meaning: 'code 對齊延遲', unit: R`\text{samples}`, firstSeen: '§3', note: <><Erratum id="E34" />{mt(R`：§16.1 原寫 $d$，與更新延遲 $d$ 衝突`)}</> },
  { symbol: R`d,\;d_\mathrm{f}`, meaning: mt(R`更新延遲（block 結束到新 gain 生效）的整數部分與分數部分；commit 在 block 中途生效時 $d_\mathrm{f}=(P_c\bmod N)/N$`), unit: R`\text{blocks}`, firstSeen: '§3', note: mt(R`分數延遲不寫 $\varphi$：$\varphi(z)$ 保留給 Gaussian 密度`) },
  { symbol: R`P_c`, meaning: 'commit pipeline：block 結束到新 gain 寫入 register 的 sample 數', unit: R`\text{samples}`, firstSeen: '§3' },
  { symbol: R`g_\mathrm{crit}`, meaning: mt(R`平均模型由穩定變成不穩定的臨界 loop gain（$d=0$ 時為 2）`), firstSeen: '§3' },
  { symbol: R`\Phi(z),\;\varphi(z)`, meaning: '標準 Gaussian 的累積分布函數與機率密度', firstSeen: '§3' },
  { symbol: 'S_k', meaning: mt(R`GMAC 總和 $\sum q\,x_\mathrm{ref}$（sum）`), firstSeen: '§4', note: <><Erratum id="E07" /> <Erratum id="E18" />：總和用 <Tex>S</Tex></> },
  { symbol: R`G_k=S_k/N`, meaning: 'GMAC 平均（average，§0 定義）', firstSeen: '§4' },
  { symbol: R`m_q=E[q]`, meaning: mt(R`comparator 雙極性輸出的平均（$x\equiv1$ 時 $E[G]=m_q$）`), firstSeen: '§4', note: <><Erratum id="E34" />{mt(R`：規格 §5 寫 $m$`)}</> },
  { symbol: R`\mu`, meaning: '學習率（每個 block 的更新係數）', unit: R`\mathrm{fs}`, firstSeen: '§4', note: <><Erratum id="E13" />：average 模式下單位為 fs</> },
  { symbol: R`K_q=\sqrt{2/\pi}/\sigma_v`, meaning: '1-bit comparator 的小訊號增益', unit: R`\mathrm{fs}^{-1}`, firstSeen: '§4' },
  { symbol: R`C=E[x_\mathrm{ref}u]`, meaning: 'regressor 與有效 regressor 的相關', unit: R`\text{無因次}`, firstSeen: '§4' },
  { symbol: R`K=K_qC`, meaning: mt(R`GMAC 對 $\delta$ 的平均斜率 $-\partial E[G]/\partial w$`), unit: R`\mathrm{fs}^{-1}`, firstSeen: '§4', note: <Erratum id="E13" /> },
  { symbol: R`g,\;p=1-g`, meaning: mt(R`無因次 loop gain（average：$\mu K$；sum：$N\mu K$）與平均 pole`), firstSeen: '§4' },
  { symbol: R`w^*,\;\delta^*=a-w^*`, meaning: '固定點：平均更新為 0 時的 gain（穩態的平均值），以及它離真值的偏差', unit: R`\mathrm{fs}/\text{unit code}`, firstSeen: '§3' },
  { symbol: R`m_x,\;\sigma_x`, meaning: mt(R`code 的平均 $E[x]$ 與標準差（$E[x^2]=m_x^2+\sigma_x^2$）`), unit: R`\text{無因次}`, firstSeen: '§4' },
  { symbol: R`\xi=\delta/\sigma_v`, meaning: mt(R`正規化的 gain 誤差（忘了映射時的固定點 $\xi^*$ 只和 code 分布有關，F-04.16）`), unit: R`\text{無因次}`, firstSeen: '§4' },
  { symbol: R`B_x,\;x_\mathrm{int}`, meaning: 'code 位元數、有號整數 code', unit: R`\text{bits},\;\text{LSB}`, firstSeen: '§5' },
  { symbol: R`B_\mathrm{acc},\;M_x`, meaning: mt(R`GMAC 累加器（有號）位元數；單筆乘積的最大絕對值 $M_x=\max|q\,x_\mathrm{int}|$`), unit: R`\text{bits},\;\text{LSB}`, firstSeen: '§5' },
  { symbol: R`F_G,\;\ell=\log_2N-F_G`, meaning: '右移後保留的小數位元、實際右移量', unit: R`\text{bits}`, firstSeen: '§5' },
  { symbol: R`\Delta_G`, meaning: mt(R`正規化 $G$ 的 LSB $=2^{-F_G}/2^{B_x-1}$`), firstSeen: '§5' },
  { symbol: R`\rho,\;\bar\varepsilon`, meaning: mt(R`右移丟掉的餘數 $\rho=S\bmod2^\ell$；rounding 的平均誤差 $\bar\varepsilon$（單位：輸出 LSB）`), firstSeen: '§5' },
  { symbol: R`\chi(s)`, meaning: mt(R`floor 取整的平衡點附近的回復斜率（$s$ = 取整前雜訊的標準差除以取整後的 LSB；1 = 和沒有取整一樣，0 = dead zone）`), firstSeen: '§5' },
  { symbol: R`\Delta_W,\;R,\;\bar\varepsilon_W`, meaning: mt(R`$W$ 的 LSB；$R=\Delta_W/(\mu\Delta_G)$：$W$ 的格點比更新量的格點粗幾倍；更新量取整到 $\Delta_W$ 的平均誤差`), unit: R`\mathrm{fs}/\text{unit code},\;\text{—},\;\Delta_W`, firstSeen: '§5' },
  { symbol: R`\ell_W`, meaning: mt(R`更新量 $\mu G$ 加進 $W$ 之前再右移的位元數（$R=2^{\ell_W}$）`), unit: R`\text{bits}`, firstSeen: '§5' },
  { symbol: R`p_\mathrm{min}`, meaning: mt(R`最負 code $-2^{B_x-1}$ 出現的機率（條件取負 bug 的偏差來源）`), firstSeen: '§5' },
  { symbol: R`W,\;w_\mathrm{min},\;w_\mathrm{max}`, meaning: '高解析 gain accumulator、DTC 可實現的 gain 範圍（rail）', unit: R`\mathrm{fs}/\text{unit code}`, firstSeen: '§5' },
]

/** 讀者按下「本章符號表在最後」當時的捲動位置；符號表上方的「回到剛才讀到的地方」用它捲回去。 */
let returnY: number | null = null

/** 章首只留這一行：捲到章末的符號表（HashRouter 下不能用 href="#symbols"，那會改到路由）。 */
export function SymbolsLink() {
  return (
    <p className="ch04-symbols-link">
      <JumpTo
        target={SYMBOLS_ID}
        onJump={() => {
          returnY = window.scrollY
        }}
      >
        本章符號表在最後 ↓
      </JumpTo>
      <span className="muted">（每個符號第一次出現時，正文會先用一句話說明）</span>
    </p>
  )
}

function backToReading(): void {
  if (returnY === null) {
    jumpTo('ch04-question')
    return
  }
  window.scrollTo({ top: returnY, behavior: 'smooth' })
}

/** 章末的符號表：整頁最後一個區塊（在「本課必記」與「連結到 PLL」之後）。 */
export function SymbolsSection() {
  return (
    <section className="ch04-symbols" id={SYMBOLS_ID} aria-label="本章符號表">
      <p className="ch04-symbols-back">
        <button type="button" className="ch04-jump" onClick={backToReading}>
          ↑ 回到剛才讀到的地方
        </button>
      </p>
      <SymbolTable
        rows={CH04_SYMBOLS}
        title="本章符號表"
        caption={
          <>
            本章採用全站約定（規格 §0）與 docs/validation.md 的勘誤版本：<Erratum id="E07" /> <Erratum id="E13" /> <Erratum id="E18" />。時間索引：<Tex>n</Tex> = sample、<Tex>k</Tex> = block；極性{' '}
            <Tex>{R`\delta=a-w`}</Tex>。全站符號總表在 Formula & Unit Reference 頁。
          </>
        }
      />
    </section>
  )
}
