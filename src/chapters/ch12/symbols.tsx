import { Tex, type SymbolEntry } from '@/components'
import { Erratum, md } from './common'

/**
 * 本章符號表（docs/teaching-style.md §5）：放在章末（index.tsx 的 #symbols），章首只留一行連結。
 * meaning 內的數學一律以 $…$ 寫成 KaTeX。firstSeen = 正文第一次用到、並就地用一句話說明這個符號的小節；
 * 「§12.0 → §12.7」表示章首的地圖（方塊圖的導讀）先用一句話交代，正式的定義或推導在箭頭後面的小節。
 */
const ROWS: SymbolEntry[] = [
  {
    symbol: String.raw`w^*`,
    meaning: md(String.raw`LMS 固定點：$E[G\mid w=w^*]=0$ 的係數（有 bias 時 $w^*\ne a$，見第 11 章）`),
    unit: String.raw`\mathrm{fs}`,
    firstSeen: '§12.0',
  },
  {
    symbol: 'a',
    meaning: '真實的 DTC gain（LMS 要學的目標；對稱、無 bias 時固定點就是它）',
    unit: String.raw`\mathrm{fs}`,
    firstSeen: '§12.1',
  },
  {
    symbol: String.raw`\delta w_k=w_k-w^*`,
    meaning: md('第 $k$ 個 block 的係數偏差（相對固定點）'),
    unit: String.raw`\mathrm{fs}`,
    firstSeen: '§12.0',
    note: (
      <>
        極性與 §0 的 <Tex>{String.raw`\delta_k=a-w_k`}</Tex> <strong>相反</strong>，且 <Tex>{String.raw`a-w_k=(a-w^*)-\delta w_k`}</Tex>
        <Erratum id="E33" />
      </>
    ),
  },
  {
    symbol: 'G_k',
    meaning: md(String.raw`GMAC 第 $k$ 個 block 的平均相關輸出 $\tfrac1N\sum q\,x$（average mode）`),
    unit: String.raw`1`,
    firstSeen: '§12.0 → §12.1',
    note: md('sum mode 要再乘 $N$（勘誤 E18）'),
  },
  { symbol: String.raw`\eta_k`, meaning: md(String.raw`GMAC 雜訊：$G_k$ 扣掉條件平均 $E[G_k\mid w_k]$ 後剩下的零均值部分`), unit: String.raw`1`, firstSeen: '§12.0' },
  {
    symbol: String.raw`\sigma_\eta^2`,
    meaning: md(String.raw`$\eta$ 的變異數；$\pm1$ code、近平衡時 $\approx1/N$（精確為 $(1-m^2)/N$）`),
    unit: String.raw`1`,
    firstSeen: '§12.0',
    note: <Erratum id="E30" />,
  },
  { symbol: 'm', meaning: md(String.raw`$q\,x$ 的條件平均 $E[q\,x\mid w]$（近平衡時 $\approx0$）`), unit: '1', firstSeen: '§12.1' },
  { symbol: String.raw`K_q=\sqrt{2/\pi}/\sigma_v`, meaning: '1-bit comparator 的小訊號統計增益（第 5 章）', unit: String.raw`\mathrm{fs}^{-1}`, firstSeen: '§12.0' },
  { symbol: String.raw`\sigma_v`, meaning: 'comparator 前白色 Gaussian 雜訊的 RMS', unit: String.raw`\mathrm{fs}`, firstSeen: '§12.0' },
  { symbol: String.raw`v[n],\ e[n],\ q[n]`, meaning: md(String.raw`comparator 前的雜訊、comparator 的輸入 $e=C(a-w)x+v$、1-bit 輸出 $q=\operatorname{sign}(e)$`), unit: String.raw`\mathrm{fs},\ \mathrm{fs},\ 1`, firstSeen: '§12.0 → §12.1' },
  { symbol: 'C', meaning: md(String.raw`有效 code 相關 $E[x\,u]$（$u$：code 在 comparator 前造成的訊號；identity path、unit-RMS code 時 $=1$）`), unit: '1', firstSeen: '§12.0' },
  { symbol: String.raw`K=K_qC`, meaning: md(String.raw`GMAC 斜率：平均 $G$ 對 $\delta w$ 的斜率（取負號）`), unit: String.raw`\mathrm{fs}^{-1}`, firstSeen: '§12.0' },
  {
    symbol: String.raw`\mu`,
    meaning: md(String.raw`學習率（每 block 更新 $\mu G_k$）`),
    unit: String.raw`\mathrm{fs}`,
    firstSeen: '§12.0',
    note: md(String.raw`average mode；sum mode 的 $\mu$ 必須小 $N$ 倍`),
  },
  { symbol: String.raw`g=\mu K,\ p=1-g`, meaning: '無因次迴路增益與一階 pole（每個 block 舊偏差留下的比例）', unit: '1', firstSeen: '§12.0' },
  { symbol: 'N', meaning: '每個 block 累加的 comparator 樣本數', unit: '1', firstSeen: '§12.0' },
  { symbol: 'f_s,\\ f_u=f_s/N', meaning: 'comparator 取樣率與 block update rate', unit: String.raw`\mathrm{Hz}`, firstSeen: '§12.0' },
  { symbol: 'V_k', meaning: md(String.raw`第 $k$ 個 block 的均方偏差 $E[\delta w_k^2]$（平均為 0，所以就是變異數）`), unit: String.raw`\mathrm{fs}^2`, firstSeen: '§12.0' },
  {
    symbol: String.raw`\Omega,\ \theta`,
    meaning: md(String.raw`離散頻率：$\Omega$ 以 block 為單位（rad/block，$\Omega=2\pi f/f_u$）；$\theta$ 以 sample 為單位（rad/sample，$\theta=2\pi f/f_s$）`),
    unit: String.raw`\mathrm{rad}`,
    firstSeen: '§12.2',
    note: (
      <>
        <Tex>{String.raw`\theta=\Omega/N`}</Tex>；兩者不可混用 <Erratum id="E29" />
      </>
    ),
  },
  { symbol: String.raw`H_{\eta\to w}(z)`, meaning: md(String.raw`$\eta$ 到 $\delta w$ 的轉移函數 $\mu/(z-p)$`), unit: String.raw`\mathrm{fs}`, firstSeen: '§12.2' },
  { symbol: 'h_k', meaning: md(String.raw`$H_{\eta\to w}$ 的脈衝響應：$h_k=\mu p^{k-1}$（$k\ge1$），$h_0=0$`), unit: String.raw`\mathrm{fs}`, firstSeen: '§12.2' },
  {
    symbol: String.raw`R[\ell]`,
    meaning: md(String.raw`自相關 $E[x_kx_{k+\ell}]$：相隔 $\ell$ 個樣本的兩個值平均有多像；下標標明是誰的（$R_w$、$R_x$、$R_{\delta t}$）`),
    unit: String.raw`\mathrm{fs}^2\ (R_w,\ R_{\delta t});\ 1\ (R_x)`,
    firstSeen: '§12.3',
    note: md(String.raw`$R[0]$ 就是變異數；PSD 是它的 DTFT`),
  },
  {
    symbol: String.raw`S_\eta(e^{j\Omega})`,
    meaning: md(String.raw`GMAC 雜訊 $\eta$ 的雙邊 DTFT PSD（block rate）；$\eta$ 在 block 之間獨立（白色）時是常數 $\sigma_\eta^2$`),
    unit: String.raw`1/(\mathrm{rad/block})`,
    firstSeen: '§12.3',
  },
  {
    symbol: String.raw`S_w(e^{j\Omega})`,
    meaning: md(String.raw`$\delta w$ 的雙邊 DTFT PSD（block rate）；$\sigma^2=\frac1{2\pi}\int_{-\pi}^{\pi}S\,d\Omega$`),
    unit: String.raw`\mathrm{fs}^2/(\mathrm{rad/block})`,
    firstSeen: '§12.3',
  },
  {
    symbol: String.raw`S^{(1)}(f)`,
    meaning: md(String.raw`單邊 per-Hz PSD：$\tfrac{2}{f_r}S(e^{j2\pi f/f_r})$，$f_r$ 為該序列的取樣率`),
    unit: String.raw`\mathrm{fs}^2/\mathrm{Hz}`,
    firstSeen: '§12.3',
    note: <Erratum id="E28" />,
  },
  {
    symbol: String.raw`S_w^{(f_s)}(e^{j\theta})`,
    meaning: md(String.raw`$\delta w$ 以 ZOH 保持到 sample rate 後的（時間平均）PSD`),
    unit: String.raw`\mathrm{fs}^2/(\mathrm{rad/sample})`,
    firstSeen: '§12.6',
    note: <Erratum id="E09" />,
  },
  {
    symbol: String.raw`S^{(1)}_{w,\mathrm{zoh}}(f)`,
    meaning: md(String.raw`ZOH 後係數雜訊的單邊 per-Hz PSD：$\tfrac{2}{f_s}S_w^{(f_s)}(e^{j2\pi|f|/f_s})$（對 $f$ 偶對稱、以 $f_s$ 為週期）`),
    unit: String.raw`\mathrm{fs}^2/\mathrm{Hz}`,
    firstSeen: '§12.6',
  },
  { symbol: 'n_c', meaning: 'commit / apply latency（係數算出到 DTC 實際套用的 sample 數）', unit: '\\mathrm{samples}', firstSeen: '§12.6' },
  {
    symbol: String.raw`u[n],\ \bar R_u,\ \bar S_u`,
    meaning: md(String.raw`（§12.6 的 multirate 推導）插零上取樣後的序列：$n=kN$ 時放 $\delta w_k$，其餘放 0；$\bar R_u$、$\bar S_u$ 是它對 $n$ 取時間平均的自相關與 PSD`),
    unit: String.raw`\mathrm{fs},\ \mathrm{fs}^2,\ \mathrm{fs}^2/(\mathrm{rad/sample})`,
    firstSeen: '§12.6',
    note: md(String.raw`和 $C=E[x\,u]$ 裡的 $u$（code 在 comparator 前造成的訊號）是不同的量`),
  },
  {
    symbol: String.raw`b[r],\ B(e^{j\theta})`,
    meaning: md(String.raw`長度 $N$ 的 boxcar（連續 $N$ 個 1）與它的頻率響應：$|B|^2=\big[\sin(N\theta/2)/\sin(\theta/2)\big]^2$；ZOH 等於「插零」之後再通過它`),
    unit: '1',
    firstSeen: '§12.6',
    note: md(String.raw`和係數 tone 的振幅 $B$ 是不同的量`),
  },
  { symbol: String.raw`\sigma_w`, meaning: '係數雜訊 RMS（gain-equivalent，不是 output jitter）', unit: String.raw`\mathrm{fs}`, firstSeen: '§12.0', note: '封閉式在 §12.4（F-12.5）' },
  { symbol: String.raw`\tau=-1/\ln p`, meaning: '收斂時間常數', unit: '\\mathrm{blocks}', firstSeen: '§12.4' },
  {
    symbol: String.raw`f_{3\mathrm{dB}}`,
    meaning: md(String.raw`$|H_{\eta\to w}|^2$ 降到 DC 一半的頻率（exact discrete）`),
    unit: String.raw`\mathrm{Hz}`,
    firstSeen: '§12.0 → §12.5',
    note: (
      <>
        不可稱為「Noise BW」 <Erratum id="E06" />
        <Erratum id="E27" />
      </>
    ),
  },
  {
    symbol: String.raw`\mathrm{ENBW}`,
    meaning: md(String.raw`單邊等效雜訊頻寬：白色 $\eta$ 時 $\sigma^2=S^{(1)}(0)\cdot\mathrm{ENBW}$`),
    unit: String.raw`\mathrm{Hz}`,
    firstSeen: '§12.0 → §12.5',
    note: <Erratum id="E10" />,
  },
  { symbol: 'x[n]', meaning: 'DTC / DSM code（regressor）', unit: '1', firstSeen: '§12.0' },
  {
    symbol: 'A,\\ f_x;\\ B,\\ f_w',
    meaning: md(String.raw`單頻 code $x=A\cos(2\pi f_xt)$ 的振幅與頻率；係數擾動 $\delta w=B\cos(2\pi f_wt)$ 的振幅與頻率`),
    unit: String.raw`1,\ \mathrm{Hz};\ \mathrm{fs},\ \mathrm{Hz}`,
    firstSeen: '§12.6',
  },
  { symbol: String.raw`m,\ \sigma_x^2`, meaning: md(String.raw`（§12.6 的 code 模型）code 的 DC 成分與白色成分的變異數`), unit: '1', firstSeen: '§12.6', note: md(String.raw`這裡的 $m$ 是 code 的平均，和 §12.1 的 $m=E[q\,x]$ 不同`) },
  {
    symbol: String.raw`\tilde x[n]`,
    meaning: md(String.raw`code 扣掉平均值之後的零均值部分：$x[n]=m+\tilde x[n]$`),
    unit: '1',
    firstSeen: '§12.6',
  },
  {
    symbol: String.raw`S_x,\ S_{\delta t}`,
    meaning: md(String.raw`code $x[n]$ 與 timing error $\delta t[n]$ 的 PSD（sample rate；DTFT 形式，加上標 $(1)$ 是單邊 per-Hz）`),
    unit: String.raw`1/(\mathrm{rad/sample}),\ \mathrm{fs}^2/(\mathrm{rad/sample})`,
    firstSeen: '§12.6',
  },
  {
    symbol: String.raw`S^{(1)}_{\phi,\mathrm{out}}(f)`,
    meaning: md(String.raw`輸出相位的單邊 per-Hz PSD：$(2\pi f_{\mathrm{out}})^2|T|^2S^{(1)}_{\delta t}$（代入時 fs 要換成秒）`),
    unit: String.raw`\mathrm{rad}^2/\mathrm{Hz}`,
    firstSeen: '§12.6 → §12.7',
  },
  { symbol: 'f_r', meaning: md(String.raw`某個序列自己的取樣率（block 量用 $f_u$、sample 量用 $f_s$）`), unit: String.raw`\mathrm{Hz}`, firstSeen: '§12.6' },
  { symbol: String.raw`\delta t[n]=x[n]\delta w[n]`, meaning: 'DTC 實際多施加的延遲（gain noise 造成）', unit: String.raw`\mathrm{fs}`, firstSeen: '§12.0 → §12.6', note: <Erratum id="E33" /> },
  { symbol: String.raw`H_{\mathrm{PD}},\ T`, meaning: 'DTC 誤差到 PD residual（high-pass）與到 output（low-pass）的轉移', unit: '1', firstSeen: '§12.0 → §12.7' },
  { symbol: 'L(s)', meaning: 'PLL 的開迴路增益（PD 增益 × loop filter × VCO 積分 ÷ 除數）', unit: '1', firstSeen: '§12.0 → §12.7' },
  {
    symbol: String.raw`\phi_{\mathrm{dtc}},\ e_{\mathrm{PD}},\ \theta_{\mathrm{out}}`,
    meaning: md(String.raw`§12.7 推導用的相位：DTC 誤差的等效相位 $2\pi f_{\mathrm{out}}\delta t$、PD 看到的誤差、PLL 輸出相位`),
    unit: String.raw`\mathrm{rad}`,
    firstSeen: '§12.7',
    note: md(String.raw`$\theta_{\mathrm{out}}$ 與 $\phi_{\mathrm{out}}$ 是同一個量`),
  },
  { symbol: String.raw`f_{\mathrm{out}},\ \phi_{\mathrm{out}}`, meaning: 'PLL 輸出頻率與輸出相位', unit: String.raw`\mathrm{Hz},\ \mathrm{rad}`, firstSeen: '§12.0 → §12.7' },
  { symbol: String.raw`\sigma_{t,\mathrm{out}}`, meaning: md(String.raw`輸出 timing jitter 的 RMS（$|T|^2S^{(1)}_{\delta t}$ 的積分開根號）`), unit: String.raw`\mathrm{fs}`, firstSeen: '§12.7' },
  { symbol: 'f_L,\\ f_H,\\ f_{BW}', meaning: md(String.raw`jitter 積分的下限與上限；$f_{BW}$ 是「in-band」的上限（理想 brick-wall 的 PLL 頻寬）`), unit: String.raw`\mathrm{Hz}`, firstSeen: '§12.7' },
  {
    symbol: String.raw`A_t,\ \beta`,
    meaning: md(String.raw`$A_t$：DTC 端 $\delta t$ 單頻成分的 peak；經 PLL 後 output timing tone 的 peak 是 $|T|A_t$。相位調變指數 $\beta=2\pi f_{\mathrm{out}}|T|A_t$`),
    unit: String.raw`\mathrm{fs},\ \mathrm{rad}`,
    firstSeen: '§12.8',
    note: md(String.raw`$|T|=1$ 時兩者相同（T15）`),
  },
  { symbol: 'f_m', meaning: md(String.raw`$\delta t$ 單頻成分的頻率（spur 離載波的距離）`), unit: String.raw`\mathrm{Hz}`, firstSeen: '§12.8' },
  { symbol: String.raw`\mathcal L(f)`, meaning: md(String.raw`單邊 phase noise $10\log_{10}(S_\phi^{(1)}/2)$`), unit: String.raw`\mathrm{dBc/Hz}`, firstSeen: '§12.6', note: <Erratum id="E28" /> },
  {
    symbol: 'r',
    meaning: md(String.raw`（研究延伸）colored GMAC noise 的 lag-1 相關：$R_\eta[\ell]=\sigma_\eta^2r^{|\ell|}$；規格假設 $r=0$`),
    unit: '1',
    firstSeen: '§12.4',
  },
  {
    symbol: String.raw`\varepsilon_k`,
    meaning: md(String.raw`（研究延伸）產生 colored $\eta$ 的白色驅動：$\eta_k=r\,\eta_{k-1}+\sqrt{1-r^2}\,\sigma_\eta\,\varepsilon_k$，$\varepsilon_k\sim\mathcal N(0,1)$`),
    unit: '1',
    firstSeen: '§12.4',
  },
  {
    symbol: 'N_+',
    meaning: md(String.raw`模擬引擎 (b)：一個 block 的 $N$ 次判斷裡 $q\,x=+1$ 的次數，$N_+\sim\mathrm{Bin}\big(N,\Phi(-C\,\delta w/\sigma_v)\big)$，於是 $G=(2N_+-N)/N$`),
    unit: '1',
    firstSeen: '§12.9',
    note: '程式碼裡的變數名稱是 k（和 block 索引無關）',
  },
]

/** '§12.6' → 6（沒有標示的排最後） */
function sectionOrder(row: SymbolEntry): number {
  const m = /§12\.(\d+)/.exec(row.firstSeen ?? '')
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY
}

/** 依「首次出現」的小節排序（同一小節內維持上面的書寫順序；Array.prototype.sort 是 stable sort）。 */
export const CH12_SYMBOLS: SymbolEntry[] = [...ROWS].sort((a, b) => sectionOrder(a) - sectionOrder(b))
