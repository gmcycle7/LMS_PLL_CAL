import { Tex, type SymbolEntry } from '@/components'
import { Erratum, md } from './common'

/** 本章符號表（docs/teaching-style.md §5）。meaning 內的數學一律以 $…$ 寫成 KaTeX。 */
export const CH12_SYMBOLS: SymbolEntry[] = [
  {
    symbol: String.raw`w^*`,
    meaning: md(String.raw`LMS 固定點：$E[G\mid w=w^*]=0$ 的係數（有 bias 時 $w^*\ne a$，見第 11 章）`),
    unit: String.raw`\mathrm{fs}`,
    firstSeen: '§12.1',
  },
  {
    symbol: String.raw`\delta w_k=w_k-w^*`,
    meaning: md('第 $k$ 個 block 的係數偏差（相對固定點）'),
    unit: String.raw`\mathrm{fs}`,
    firstSeen: '§12.1',
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
    firstSeen: '§12.1',
    note: md('sum mode 要再乘 $N$（勘誤 E18）'),
  },
  { symbol: String.raw`\eta_k`, meaning: md(String.raw`GMAC 雜訊：$G_k$ 扣掉條件平均 $E[G_k\mid w_k]$ 後剩下的零均值部分`), unit: String.raw`1`, firstSeen: '§12.1' },
  {
    symbol: String.raw`\sigma_\eta^2`,
    meaning: md(String.raw`$\eta$ 的變異數；$\pm1$ code、近平衡時 $\approx1/N$（精確為 $(1-m^2)/N$）`),
    unit: String.raw`1`,
    firstSeen: '§12.1',
    note: <Erratum id="E30" />,
  },
  { symbol: 'm', meaning: md(String.raw`$q\,x$ 的條件平均 $E[q\,x\mid w]$（近平衡時 $\approx0$）`), unit: '1', firstSeen: '§12.1' },
  { symbol: String.raw`K_q=\sqrt{2/\pi}/\sigma_v`, meaning: '1-bit comparator 的小訊號統計增益（第 5 章）', unit: String.raw`\mathrm{fs}^{-1}`, firstSeen: '§12.1' },
  { symbol: String.raw`\sigma_v`, meaning: 'comparator 前白色 Gaussian 雜訊的 RMS', unit: String.raw`\mathrm{fs}`, firstSeen: '§12.0' },
  { symbol: 'C', meaning: md(String.raw`有效 code 相關 $E[x\,u]$（identity path、unit-RMS code 時 $=1$）`), unit: '1', firstSeen: '§12.1' },
  { symbol: String.raw`K=K_qC`, meaning: md(String.raw`GMAC 斜率：平均 $G$ 對 $\delta w$ 的斜率（取負號）`), unit: String.raw`\mathrm{fs}^{-1}`, firstSeen: '§12.1' },
  {
    symbol: String.raw`\mu`,
    meaning: md(String.raw`學習率（每 block 更新 $\mu G_k$）`),
    unit: String.raw`\mathrm{fs}`,
    firstSeen: '§12.1',
    note: md(String.raw`average mode；sum mode 的 $\mu$ 必須小 $N$ 倍`),
  },
  { symbol: String.raw`g=\mu K,\ p=1-g`, meaning: '無因次迴路增益與一階 pole', unit: '1', firstSeen: '§12.1' },
  { symbol: 'N', meaning: '每個 block 累加的 comparator 樣本數', unit: '1', firstSeen: '§12.1' },
  { symbol: 'f_s,\\ f_u=f_s/N', meaning: 'comparator 取樣率與 block update rate', unit: String.raw`\mathrm{Hz}`, firstSeen: '§12.1' },
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
  { symbol: String.raw`\sigma_w`, meaning: '係數雜訊 RMS（gain-equivalent，不是 output jitter）', unit: String.raw`\mathrm{fs}`, firstSeen: '§12.4' },
  { symbol: String.raw`\tau=-1/\ln p`, meaning: '收斂時間常數', unit: '\\mathrm{blocks}', firstSeen: '§12.4' },
  {
    symbol: String.raw`f_{3\mathrm{dB}}`,
    meaning: md(String.raw`$|H_{\eta\to w}|^2$ 降到 DC 一半的頻率（exact discrete）`),
    unit: String.raw`\mathrm{Hz}`,
    firstSeen: '§12.5',
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
    firstSeen: '§12.5',
    note: <Erratum id="E10" />,
  },
  { symbol: 'x[n]', meaning: 'DTC / DSM code（regressor）', unit: '1', firstSeen: '§12.6' },
  { symbol: String.raw`\delta t[n]=x[n]\delta w[n]`, meaning: 'DTC 實際多施加的延遲（gain noise 造成）', unit: String.raw`\mathrm{fs}`, firstSeen: '§12.6', note: <Erratum id="E33" /> },
  { symbol: String.raw`H_{\mathrm{PD}},\ T`, meaning: 'DTC 誤差到 PD residual（high-pass）與到 output（low-pass）的轉移', unit: '1', firstSeen: '§12.7' },
  { symbol: String.raw`f_{\mathrm{out}},\ \phi_{\mathrm{out}}`, meaning: 'PLL 輸出頻率與輸出相位', unit: String.raw`\mathrm{Hz},\ \mathrm{rad}`, firstSeen: '§12.7' },
  {
    symbol: String.raw`A_t,\ \beta`,
    meaning: md(String.raw`$A_t$：DTC 端 $\delta t$ 單頻成分的 peak；經 PLL 後 output timing tone 的 peak 是 $|T|A_t$。相位調變指數 $\beta=2\pi f_{\mathrm{out}}|T|A_t$`),
    unit: String.raw`\mathrm{fs},\ \mathrm{rad}`,
    firstSeen: '§12.8',
    note: md(String.raw`$|T|=1$ 時兩者相同（T15）`),
  },
  { symbol: String.raw`\mathcal L(f)`, meaning: md(String.raw`單邊 phase noise $10\log_{10}(S_\phi^{(1)}/2)$`), unit: String.raw`\mathrm{dBc/Hz}`, firstSeen: '§12.7', note: <Erratum id="E28" /> },
  {
    symbol: 'r',
    meaning: md(String.raw`（研究延伸）colored GMAC noise 的 lag-1 相關：$R_\eta[\ell]=\sigma_\eta^2r^{|\ell|}$；規格假設 $r=0$`),
    unit: '1',
    firstSeen: '§12.4',
  },
]
