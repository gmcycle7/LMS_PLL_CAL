import { Section, SymbolTable, type SymbolEntry } from '@/components'
import { JumpButton, M, SYMBOLS_ANCHOR } from '../common'

const r = String.raw

export const SYMBOLS: SymbolEntry[] = [
  { symbol: 'a_k', meaning: '網站即時算出的第 k 個數值（actual；瀏覽器內呼叫各章模型）', firstSeen: '§V.1' },
  { symbol: 'e_k', meaning: 'golden vector 的期望值（expected；Python / NumPy / SciPy 獨立重算）', firstSeen: '§V.1' },
  { symbol: r`\varepsilon_{\rm abs},\ \varepsilon_{\rm rel}`, meaning: '容忍度的絕對項與相對項（golden 檔的 tolerance.abs / rel）', unit: r`\text{同 }e_k\ /\ 1`, firstSeen: '§V.1' },
  { symbol: r`b_k=\varepsilon_{\rm abs}+\varepsilon_{\rm rel}|e_k|`, meaning: '第 k 個元素的容許誤差（bound）', unit: r`\text{同 }e_k`, firstSeen: '§V.1' },
  { symbol: r`r_k=|a_k-e_k|/b_k`, meaning: M(r`誤差佔容許量的比例；$r_k\le1$ 為通過（表中的 $|\Delta|/b$）`), unit: '1', firstSeen: '§V.2' },
  { symbol: r`\varepsilon_{\rm mach}=2^{-52}`, meaning: M(r`IEEE double 的機器精度（$\approx2.22\times10^{-16}$）`), unit: '1', firstSeen: '§V.1' },
  { symbol: r`d_n=\tilde w_n-w_n`, meaning: '浮點算出的值與精確值的差（捨入誤差的累積）', firstSeen: '§V.1' },
  { symbol: 'n', meaning: 'Monte Carlo 的獨立樣本數（comparator 決策數、block 數…）', firstSeen: '§V.3', note: '在 T01 的手算表中 n 是 LMS 的步數（依上下文）' },
  { symbol: r`\hat\theta,\ \theta`, meaning: 'Monte Carlo 的估計值，與它要比對的期望值（解析或 golden）', firstSeen: '§V.3' },
  { symbol: r`\mathrm{SE}`, meaning: M(r`標準誤 $\sqrt{\operatorname{Var}(\hat\theta)}$：估計值本身的標準差`), unit: r`\text{同 }\theta`, firstSeen: '§V.3' },
  { symbol: r`z=(\hat\theta-\theta)/\mathrm{SE}`, meaning: '估計值距離期望值幾個標準誤', unit: '1', firstSeen: '§V.3' },
  { symbol: r`z_{\rm crit}`, meaning: M(r`$z$ 的判定門檻（預設 4）`), unit: '1', firstSeen: '§V.3' },
  { symbol: r`\alpha=2[1-\Phi(z_{\rm crit})]`, meaning: '單一 MC 檢查「明明正確卻被判失敗」的機率（誤報率）', unit: '1', firstSeen: '§V.3' },
  { symbol: r`\nu,\ t,\ z_{\rm eq}`, meaning: M(r`SE 由 $\nu+1$ 個樣本估計時的自由度、Student-$t$ 統計量、尾機率相同的等效 $z$`), unit: '1', firstSeen: '§V.3' },
  { symbol: r`R,\ K`, meaning: M(r`獨立 chain 的條數 $R$；多 seed 校準的 seed 個數 $K$`), unit: '1', firstSeen: '§V.3', note: M(r`$K$ 在 Ch12 是 GMAC 斜率 $K_qC$；本頁只當「個數」用`) },
  { symbol: 'p', meaning: M(r`一階校正迴路的 pole（Ch12）；$\delta w_k$ 的 lag-$k$ 自相關是 $p^{k}$`), unit: '1', firstSeen: '§V.3', note: M(r`也用作 Bernoulli 機率（T04、T17）；兩者都在該式旁註明`) },
  { symbol: r`\Delta=a_k-e_k`, meaning: M(r`網站的值減 golden 的值（帶正負號）；表格欄位 $|\Delta|$ 是它的絕對值`), unit: r`\text{同 }e_k`, firstSeen: '§V.1' },
  { symbol: r`\eta_n,\ c`, meaning: M(r`第 $n$ 步所有浮點運算的捨入誤差總和，與「每步運算次數」等級的小常數（約 3–4）`), firstSeen: '§V.1', note: M(r`$\eta$ 在 Ch12 是 GMAC 雜訊、$c$ 在 Ch08 / Ch11 另有用途；本頁只在 §V.1 用這個意思`) },
  { symbol: r`\sigma,\ \sigma^2`, meaning: M(r`單一樣本 $X_i$ 的標準差與變異數（不是 comparator 的 $\sigma_v$，也不是係數雜訊 $\sigma_w$）`), unit: r`\text{同 }X_i`, firstSeen: '§V.3' },
  { symbol: r`\Phi(z),\ \varphi(z)`, meaning: '標準常態分布的累積分布函數（CDF）與機率密度（PDF）', unit: '1', firstSeen: '§V.3' },
  { symbol: r`\hat p`, meaning: M(r`由樣本數出來的比例（T04、T05、T17）`), unit: '1', firstSeen: '§V.3', note: M(r`T14 中 $\hat p$ 指 lag-1 自相關的估計值 $r_1$（pole 的估計）`) },
  { symbol: r`\bar x,\ c_i,\ s^2`, meaning: M(r`樣本平均、去掉平均的樣本 $c_i=x_i-\bar x$、樣本變異數 $s^2=\tfrac{1}{n-1}\sum c_i^2$`), firstSeen: '§V.3' },
  { symbol: r`\rho_k,\ r_1`, meaning: M(r`lag-$k$ 自相關係數（AR(1) 時 $\rho_k=p^k$）；$r_1=\sum c_ic_{i+1}/\sum c_i^2$ 是 lag-1 的樣本估計量`), unit: '1', firstSeen: '§V.3' },
  { symbol: r`S_1`, meaning: M(r`AR(1) 自相關的三角加權和 $\sum_{k=1}^{n-1}(n-k)p^k$（F-VF.6）`), unit: '1', firstSeen: '§V.3' },
  { symbol: r`\mu_4`, meaning: M(r`四階中央動差 $E[(X-E[X])^4]$（F-VF.9）`), firstSeen: '§V.3', note: M(r`與步長 $\mu$ 無關，只是統計學的慣用記號`) },
  { symbol: r`\bar z,\ s_z,\ Z_{\rm mean},\ Z_{\rm sd}`, meaning: M(r`$K$ 個 seed 的 $z$ 的平均與樣本標準差，以及由它們算出的兩個校準分數（F-VF.10）`), unit: '1', firstSeen: '§V.3' },
  { symbol: r`F_n(z),\ D`, meaning: M(r`$n$ 個 $z$ 的經驗分布函數，與 Kolmogorov–Smirnov 統計量 $D=\sup_z|F_n(z)-\Phi(z)|$`), unit: '1', firstSeen: '§V.3' },
  { symbol: r`g(\mu),\ \lambda(\mu)`, meaning: M(r`T03 的均方因子 $E[(1-\mu x^2)^2]$ 與樣本路徑的平均對數成長率 $E[\ln|1-\mu x^2|]$（Lyapunov exponent）`), unit: '1', firstSeen: '§V.3', note: M(r`$g$ 在 Ch08 是 loop gain $\mu K$；$\lambda$ 在 Ch09 是 eigenvalue——本頁寫成函數 $g(\mu)$、$\lambda(\mu)$ 以區別`) },
  { symbol: r`\mathrm{T01}\ldots\mathrm{T18}`, meaning: '規格 §17 的 Acceptance Reference Values（驗收項目）', firstSeen: '§V.2' },
  { symbol: r`\mathrm{E01}\ldots\mathrm{E49}`, meaning: 'docs/validation.md 的勘誤編號（網站一律採用修正後版本）', firstSeen: '§V.6' },
  {
    symbol: r`\delta=a-w`,
    meaning: '參數誤差的極性（全站約定）',
    unit: r`\mathrm{fs}`,
    note: M(r`規格 §3 寫 $\delta=w-a$；本站採 $a-w$（勘誤 E32 / E39），pole 不受影響`),
    firstSeen: '§V.2',
  },
]

/**
 * 頁尾的符號表：整頁最後一個區塊（§V.7 的思考題、必記與「連結到 PLL 晶片」之後；docs/teaching-style.md §5）。
 * 正文裡每個符號第一次出現時都已經就地說明；這裡是查閱用的總整理，頁首只留一行連結（SymbolsLink）。
 */
export function SymbolsSection() {
  return (
    <Section kind="formula" title="§V.8 本頁符號表" level={2} id={SYMBOLS_ANCHOR}>
      <p className="small muted">
        正文裡每個符號第一次出現時都已經就地說明；這裡把它們集中起來，方便回頭查單位、第一次出現的段落，以及和全站約定或勘誤的關係。 <JumpButton to="ver-intro">↑ 回到頁首</JumpButton>
      </p>
      <SymbolTable
        rows={SYMBOLS}
        title="本頁符號"
        caption="§V.n 指本頁的段落編號（V = Verification）。本頁的符號多半是「統計與數值分析」的符號；LMS / PLL 的符號沿用各章符號表。"
      />
    </Section>
  )
}
