/**
 * Sign-off 頁的內容資料（規格 §16.2 Sign-off Matrix、§16.3 宣稱語句、§17 反面測試、附錄 B 十項限制）。
 *
 * 文字欄位支援行內數學：以 `$…$` 包住的片段會由 RichText 以 KaTeX 顯示（匯出 Markdown 時原樣保留）。
 * `criterion` 是獨立公式（TeX，不含 `$`）。數值一律不寫死在這裡：需要數字的地方以 NegativeSignatures 的 key
 * 指向 judges.ts 即時計算的結果。
 */
import type { ClaimKind } from '@/data/types'
import type { NegativeSignatures } from './judges'

/** 頁內或站內連結：`to` 以 '/' 開頭為路由（HashRouter），以 '#' 開頭為本頁錨點。 */
export interface LinkRef {
  to: string
  label: string
}

export interface SignoffCheck {
  id: string
  title: string
  /** 必須驗證的內容 */
  verify: string
  /** 判斷方式 */
  judge: string
  /** 判準（TeX，display） */
  criterion?: string
  /** 通過時能支持的結論強度 */
  claim: ClaimKind
  links: LinkRef[]
  /** 規格出處，例如 '§16.1-1' */
  spec?: string
  /** 相關勘誤（docs/validation.md） */
  errata?: string[]
}

export interface SignoffCase {
  id: string
  /** 顯示編號，例如 '1' */
  no: string
  title: string
  /** 規格 §16.2 表格的「必須驗證的內容」 */
  verify: string
  /** 規格 §16.2 表格的「判斷方式」 */
  judge: string
  /** 為什麼這一列不能省（一句話） */
  why: string
  /** 本頁的深入段落錨點 */
  anchor?: string
  checks: SignoffCheck[]
}

const THIS = (anchor: string, label: string): LinkRef => ({ to: `#${anchor}`, label })

/* ───────────────────────── §16.2 Sign-off Matrix（+ SSPLL 案例） ───────────────────────── */

export const SIGNOFF_CASES: SignoffCase[] = [
  {
    id: 'basic',
    no: '1',
    title: '基本正確性',
    verify: String.raw`Error 極性、$w$ 更新方向`,
    judge: String.raw`freeze + $\pm\Delta w$ perturbation`,
    why: String.raw`方向錯了，其他分析（PM、noise、bias）全部沒有意義：$C\le0$ 時平均 pole $p=1-\mu K_qC>1$。`,
    anchor: 'so-polarity',
    checks: [
      {
        id: 'basic-bitmap',
        title: String.raw`0/1 → $\pm1$ 映射與 comparator 極性`,
        verify: String.raw`硬體位元 $b\in\{0,1\}$ 經 $q=2b-1$ 映射；PD 的正負定義與 $e=(a-w)u+v$ 一致；tie（$e=0$）規則與模型相同。`,
        judge: String.raw`用已知符號的刺激：凍結 $w=a-\Delta$（已知 $\delta=+\Delta$），量 $\bar G$，應有 $\mathrm{sign}(\bar G)=\mathrm{sign}(C\delta)$；再凍結 $w=a$，確認 $\bar G$ 不顯著異於 0（若 $\bar G\approx E[x]/2$，代表忘了 $2b-1$）。`,
        criterion: String.raw`\bar G\big|_{w=a-\Delta}>z\,\mathrm{se},\qquad \big|\bar G\big|_{w=a}\big|<z\,\mathrm{se}`,
        claim: 'approx',
        links: [THIS('so-polarity', String.raw`本頁：freeze $\pm\Delta w$ 量測實驗`), { to: '/ch/04', label: 'Ch04 位元編碼實驗' }, { to: '/ch/05', label: 'Ch05 Comparator Lab' }],
        spec: '§16.1-1',
        errata: ['E07', 'E40'],
      },
      {
        id: 'basic-perturb',
        title: String.raw`Freeze + $\pm\Delta w$ 斜率 $\hat S_\mathrm{GMAC}$`,
        verify: String.raw`凍結 $w$（不更新），在 $w\pm\Delta w$ 各量 $M$ 個 block 的 GMAC 平均，以中央差分求 $\hat S=\partial E[G]/\partial w$。`,
        judge: String.raw`$\hat K=-\hat S$ 必須顯著大於 0（$\hat K-z\,\mathrm{se}>0$），並與解析 $K_qC$ 比對；每個 mode、每個 FCW 都要量。$\Delta$ 建議 $\le0.3\sigma_v$（截斷偏差 $\approx-\Delta^2/(6\sigma_v^2)$）。`,
        criterion: String.raw`\hat K=-\frac{\bar G(w+\Delta)-\bar G(w-\Delta)}{2\Delta}>z\cdot\frac{\sigma_\eta}{\Delta\sqrt{2M}}`,
        claim: 'approx',
        links: [THIS('so-polarity', '本頁：Polarity Perturbation 實驗'), THIS('so-silicon', '本頁：矽上量測計畫（要讀幾個 block）'), { to: '/ch/06', label: 'Ch06 Polarity Explorer' }, { to: '/ch/14', label: String.raw`Ch14 Corner 區間（量測 $\hat K$）` }],
        spec: '§6、§16.2',
      },
      {
        id: 'basic-align',
        title: String.raw`Time／Code alignment（GMAC 用的 code delay $D$）`,
        verify: String.raw`sample $n$ 的 error 是否配對 code $n-D$；mode 切換後是否重新對齊。`,
        judge: String.raw`掃描 $D$ 量 $\hat C_D$；採用的 $D$ 必須落在 $\hat C_D>0$ 的窗內且離邊界有裕度。單頻 code 時窗以 $2\pi/\Omega$ 為週期；寬頻 code 用 $\sum_kh[k]R_{xx}[k-D]$。`,
        criterion: String.raw`C_D=\tfrac{A^2}{2}|H|\cos(\phi+\Omega D)>0\quad(0<\Omega<\pi)`,
        claim: 'exact',
        links: [{ to: '/ch/07', label: 'Ch07 Delay / Filtered-x Lab' }, THIS('so-polarity', '本頁：Case B（$D$ 錯位）')],
        spec: '§16.1-2',
        errata: ['E46', 'E34'],
      },
      {
        id: 'basic-scaling',
        title: String.raw`GMAC sum vs average 與 $\mu$ 的 scaling`,
        verify: String.raw`RTL 的 right shift、learning-rate 暫存器與模型 $g=\mu K$ 的對應；改 $N$ 時是否同步改 shift／$\mu$。`,
        judge: String.raw`從 RTL 抽出實際的 $G$ 定義與 shift 位數 $s$；有效比例 $N/2^s$ 必須為 1（或已併入 $\mu$）。sum 模式時 $g_\text{sum}=N\mu K$。`,
        criterion: String.raw`g_\text{avg}=\mu K_qC,\qquad g_\text{sum}=N\,\mu K_qC,\qquad g_\text{shift}=\frac{N}{2^s}\,\mu K_qC`,
        claim: 'exact',
        links: [{ to: '/ch/04', label: 'Ch04 GMAC RTL 資料流' }, { to: '/models', label: 'Behavioral Models & RTL' }, THIS('so-fixed', '本頁：Fixed-point 判斷器')],
        spec: '§16.1-4',
        errata: ['E18', 'E13'],
      },
      {
        id: 'basic-boundary',
        title: 'Update enable、block 邊界、Clear／Commit／Reset 時序',
        verify: String.raw`每個 block 恰好累加 $N$ 個 sample、最後一筆有算進去；先 commit 再 clear；reset 後第一個 block 不是半個 block。`,
        judge: String.raw`bit-true 比對：同一串 $q[n],x[n]$ 下，RTL 的 $G_k$ 與參考模型逐 block 完全相等（含第一個與最後一個 block）。`,
        claim: 'exact',
        links: [{ to: '/models', label: 'Behavioral Models（參考模型）' }],
        spec: '§16.1-7',
      },
    ],
  },
  {
    id: 'corner',
    no: '2',
    title: 'Corner',
    verify: 'TT/SS/FF、不同 V/T、不同 BW',
    judge: 'Jacobian、Poles、Noise、Bias',
    why: String.raw`同一個 $\mu$ 必須同時通過最慢與最快的 corner：$K=K_qC$ 隨 $\sigma_v$、$|H_\mathrm{PD}|$ 與相位改變。`,
    anchor: 'so-corner',
    checks: [
      {
        id: 'corner-K',
        title: String.raw`每個 corner 的 $\hat K^{(c)}$ 都顯著 $>0$`,
        verify: String.raw`在每個 PVT corner（含不同 PLL BW）做 freeze $\pm\Delta$ 量測。`,
        judge: String.raw`以保守值 $\hat K^{(c)}-z\,\mathrm{se}$ 作為 $K_{\min}$；任何 corner 不顯著 $>0$ ⇒ 該 corner 極性不確定，不能簽核。`,
        criterion: String.raw`K^{(c)}=-\frac{\partial E[G]}{\partial w}\Big|_{c}>0\quad\forall c`,
        claim: 'approx',
        links: [THIS('so-corner', '本頁：Corner 判斷器'), { to: '/ch/14', label: 'Ch14 Corner 區間' }],
        errata: ['E13'],
      },
      {
        id: 'corner-poles',
        title: String.raw`同一組 $(\mu,d)$ 在所有 corner 的 poles 與 PM`,
        verify: String.raw`更新延遲 $d$（commit latency，以 block 計）與每個 corner 的 $g_c=\mu K^{(c)}$。`,
        judge: String.raw`$g_c<g_\text{crit}(d)=2\sin\frac{\pi}{4d+2}$，且 $PM_c=90^\circ-(2d+1)\arcsin(g_c/2)\ge PM_t$；上限由最快的 corner（$K_{\max}$）決定。`,
        criterion: String.raw`0<\mu K_{\max}\le 2\sin\!\Big(\frac{90^\circ-PM_t}{2d+1}\Big)`,
        claim: 'exact',
        links: [THIS('so-corner', '本頁：Corner 判斷器'), { to: '/ch/08', label: 'Ch08 Phase Margin Lab' }],
        spec: '§8.2–8.3',
      },
      {
        id: 'corner-settle',
        title: String.raw`最慢 corner 在 $B$ 次更新內收斂`,
        verify: String.raw`相對縮減比 $\epsilon$（$0<\epsilon<1$，不是絕對誤差）與更新次數 $B$。`,
        judge: String.raw`$\mu\ge(1-\epsilon^{1/B})/K_{\min}$；區間非空 ⇔ $B\ge\ln\epsilon/\ln(1-K_{\min}/K_{\max})$（$d=0$、$PM_t=60^\circ$ 時）。`,
        criterion: String.raw`\frac{1-\epsilon^{1/B}}{K_{\min}}\le\mu\le\frac{1}{K_{\max}}`,
        claim: 'exact',
        links: [{ to: '/ch/14', label: 'Ch14 Corner 區間（E16）' }],
        spec: '§14.1',
        errata: ['E16'],
      },
      {
        id: 'corner-noise',
        title: String.raw`各 corner 的係數 RMS $\sigma_w$ 在預算內`,
        verify: String.raw`$\sigma_v$ 隨 corner 改變 ⇒ $K_q$、$p$、$\sigma_w$ 都改變。`,
        judge: String.raw`以解析式（$d=0$）或脈衝響應平方和（$d\ge1$）計算，並以多 seeds MC 的 95% CI 確認。`,
        criterion: String.raw`\sigma_w^2=\mu^2\sigma_\eta^2\sum_k h_k^2\ \overset{d=0}{=}\ \frac{\mu^2\sigma_\eta^2}{1-p^2},\qquad\sigma_\eta^2\approx\frac1N`,
        claim: 'approx',
        links: [THIS('so-corner', '本頁：Corner 判斷器'), { to: '/ch/12', label: 'Ch12 LMS Noise Lab' }],
        errata: ['E30'],
      },
      {
        id: 'corner-bias',
        title: '各 corner 的固定點偏差（INL、offset 隨 PVT 改變）',
        verify: String.raw`每個 corner 的 $w^*_c$ 與真值 $a_c$ 的差。`,
        judge: String.raw`以 mean-field 求根（$E[G(w^*)]=0$）並用 MC 驗證；$|w^*_c-a_c|$ 不超過預算。注意架構：主迴路是否強制 $E[q]=0$（E03）。`,
        criterion: String.raw`E\big[G(w^*_c)\big]=0,\qquad |w^*_c-a_c|\le\varepsilon_\text{bias}`,
        claim: 'approx',
        links: [{ to: '/ch/11', label: 'Ch11 Bias & INL Lab' }],
        errata: ['E01', 'E03'],
      },
      {
        id: 'corner-bw',
        title: String.raw`不同 PLL BW／$\zeta$／loop latency 的 $H_\mathrm{PD}$ 相位`,
        verify: String.raw`BW 改變 ⇒ $H_\mathrm{PD}(e^{j\Omega})$ 在 code 頻帶的相位改變 ⇒ $C$ 可能變號。`,
        judge: String.raw`用 DT 模型（$\Omega$ 單位 rad/sample）計算各 BW 的 $C$，不可把 $\Omega$ 代入 CT 的 $H(j\omega)$；polarity 邊界隨 $\omega_nT_s$ 與 $d$ 移動。`,
        claim: 'exact',
        links: [{ to: '/ch/06', label: 'Ch06 CT→DT 實驗' }],
        errata: ['E44'],
      },
    ],
  },
  {
    id: 'fcw',
    no: '3',
    title: 'FCW',
    verify: 'Integer、Near-Integer、Near-Grid、隨機 Rational',
    judge: String.raw`PSD、PE、$S_\mathrm{GMAC}$、spur`,
    why: String.raw`code 的統計（PSD、週期、DC）由 FCW 決定；$C(\mathrm{FCW})\to0$ 時固定點 $w^*\approx a+B_\text{bias}/C$ 被放大。`,
    checks: [
      {
        id: 'fcw-pe',
        title: String.raw`PE：每個 FCW 的滑動窗 $\lambda_{\min}(\mathbf R_{n_0})$`,
        verify: String.raw`對 FCW sweep 的每一點，計算滑動窗資訊矩陣的 $\lambda_{\min}$、$\kappa$、奇異值。`,
        judge: String.raw`$\lambda_{\min}$ 在所有窗都高於門檻；有限窗只能證明「量過的那些窗」，不能證明未來所有窗。`,
        criterion: String.raw`\alpha_\mathrm{PE}\mathbf I\preceq\sum_{n=n_0}^{n_0+N_0-1}\mathbf u[n]\mathbf u^T[n]\preceq\beta_\mathrm{PE}\mathbf I`,
        claim: 'exact',
        links: [{ to: '/ch/09', label: 'Ch09 PE / Eigen Lab' }],
        spec: '§9.1',
        errata: ['E35', 'E34'],
      },
      {
        id: 'fcw-C',
        title: String.raw`每個 FCW 的 $C(\mathrm{FCW})>0$ 且有裕度`,
        verify: String.raw`以 $\hat S_\mathrm{GMAC}$ 量測每個 FCW 的有效相關。`,
        judge: String.raw`integer／near-integer FCW 的 DSM code 週期短、可能有 DC，$C$ 甚至為 0；裕度不足者列入 keep-out。`,
        criterion: String.raw`\hat K(\mathrm{FCW})=K_q\hat C(\mathrm{FCW})>z\,\mathrm{se}`,
        claim: 'approx',
        links: [{ to: '/ch/06', label: 'Ch06 FCW sweep' }, THIS('so-polarity', '本頁：Polarity 實驗')],
      },
      {
        id: 'fcw-nearint',
        title: 'Near-integer／near-grid 的 bias 敏感度',
        verify: String.raw`$C\to0$ 而干擾 bias 項 $B_\text{bias}=bE[x]+E[xd]+E[x\varepsilon_{cc}]$ 不為 0。`,
        judge: String.raw`報告 $|B_\text{bias}/C|$ 隨 FCW 的曲線。它是線性化的值：把 $w=a+B_\text{bias}/C$ 代回去，comparator 前的確定性殘差 $\max_n|e_\text{det}[n]|>0.3\,\sigma_v$ 的 FCW 只是線性外推（Sign-LMS 可能沒有吸引的固定點，$w$ 漂到 rail），直接列入 keep-out；通過這個門檻、但 $C$ 很小的 FCW 還要再看 Ch11 §11.4 的殘餘比 $\gamma_\mathrm{lin}$。$C\le0$ 時 $w^*$ 是 repelling point（不可達），不是「偏差很大的解」。`,
        criterion: String.raw`w^*\approx a+\frac{B_\text{bias}}{C},\qquad C\to0^+\Rightarrow|w^*-a|\to\infty`,
        claim: 'approx',
        links: [{ to: '/ch/11', label: 'Ch11 Near-integer 段落' }, THIS('so-silicon', '本頁：矽上量測計畫（keep-out 怎麼量）')],
        spec: '§11.4',
        errata: ['E12'],
      },
      {
        id: 'fcw-spur',
        title: 'Spur 量測方法（coherent tone fit，不是單一 FFT 曲線）',
        verify: 'spur 頻率、peak amplitude、dBc 的量測程序。',
        judge: String.raw`已知頻率用 coherent tone fit 報 peak amplitude；FFT／Welch 必須標 window、segment、ENBW、one-/two-sided；DTFT 形式 PSD 需乘 $2/f_s$ 才是 one-sided。`,
        claim: 'exact',
        links: [{ to: '/ch/12', label: 'Ch12 Code Mixing Lab' }, { to: '/models', label: 'Models：FFT 陷阱' }],
        spec: '§15.5',
        errata: ['E28'],
      },
      {
        id: 'fcw-keepout',
        title: 'Keep-out FCW 清單與 freeze 策略',
        verify: String.raw`列出 $C$ 裕度不足、PE 不足或 spur 超標的 FCW。`,
        judge: String.raw`在這些 FCW 校正必須 freeze，或改用 training sequence（code randomization）；清單隨 PVT 重新產生。`,
        claim: 'research',
        links: [{ to: '/ch/14', label: 'Ch14 State machine' }, { to: '/roadmap', label: 'Roadmap R5 Training sequence' }],
      },
    ],
  },
  {
    id: 'noise',
    no: '4',
    title: 'Noise',
    verify: 'White、colored、correlated、comparator offset',
    judge: '多 seeds、confidence intervals',
    why: String.raw`一條模擬軌跡不是證據；統計結論要有信賴區間，而且模型的雜訊假設（白、獨立、零均值）要逐一核對。`,
    anchor: 'so-evidence',
    checks: [
      {
        id: 'noise-white',
        title: String.raw`$\sigma_w$：解析值 vs 多 seeds Monte Carlo`,
        verify: String.raw`T13 條件（unit-RMS code、identity path、average GMAC、$N=4096$、$\mu=10$ fs、$\sigma_v=100$ fs）與實際設計條件。`,
        judge: String.raw`解析值落在 MC 的 95% CI 內；註明 $\sigma_w$ 是 gain-equivalent（fs／unit code），不是 output jitter。`,
        criterion: String.raw`\sigma_w=\frac{\mu\,\sigma_\eta}{\sqrt{1-p^2}},\qquad p=1-\mu K_qC`,
        claim: 'approx',
        links: [{ to: '/ch/12', label: 'Ch12 LMS Noise Lab' }],
        errata: ['E30', 'E06', 'E10'],
      },
      {
        id: 'noise-colored',
        title: 'Colored／block 間相關的 GMAC 雜訊',
        verify: String.raw`量測 $S_\eta$ 的形狀與 block-to-block 相關，不預設白雜訊。`,
        judge: String.raw`用 $S_w=|H_{\eta\to w}|^2S_\eta$ 或 Lyapunov 方程計算，並與時域 MC 的 PSD 積分（Parseval）對照。`,
        criterion: String.raw`S_w(e^{j\Omega})=\big|H_{\eta\to w}(e^{j\Omega})\big|^2S_\eta(e^{j\Omega}),\quad H_{\eta\to w}(z)=\frac{\mu}{z-p}`,
        claim: 'approx',
        links: [{ to: '/ch/12', label: 'Ch12' }, { to: '/roadmap', label: 'Roadmap R1' }],
        errata: ['E29'],
      },
      {
        id: 'noise-offset',
        title: 'Comparator offset 的 bias（依架構而定）',
        verify: '主迴路的 DC 行為：無 DC null／shared BBPD（type-II 強制 $E[q]=0$）／linear PD + 獨立 comparator。',
        judge: String.raw`依架構選公式；shared BBPD 時 offset 被吸收成 static phase offset，分母由 $E[x^2]$ 變 $\mathrm{Var}(x)$；$\sigma_v$ 隨 code 改變時 centering 失效。`,
        criterion: String.raw`w^*\approx a+\frac{bE[x]}{E[x^2]}\ \ \text{vs}\ \ a+\frac{\mathrm{Cov}(x,d+\varepsilon_{cc})}{\mathrm{Var}(x)}`,
        claim: 'approx',
        links: [{ to: '/ch/11', label: 'Ch11 DC-null 實驗' }],
        spec: '§11.1',
        errata: ['E03', 'E17'],
      },
      {
        id: 'noise-seeds',
        title: '多 seeds 與信賴區間；heavy-tail 指標不用 sample SE',
        verify: '每個統計結論都附 seeds 數、CI 方法與 confidence level。',
        judge: String.raw`平均值用 Student-t CI；成功率用 Wilson；「0 次失效」用 Clopper–Pearson 上界；$\delta^2$ 有 heavy tail 時改用封閉式或分位數（E14）。`,
        criterion: String.raw`\bar x\pm t_{0.975,\,n-1}\frac{s}{\sqrt n},\qquad p_U=1-\alpha^{1/n}\ (k=0)`,
        claim: 'approx',
        links: [THIS('so-evidence', '本頁：證據強度實驗'), { to: '/ch/03', label: 'Ch03 Heavy-tail 示範' }],
        errata: ['E14'],
      },
      {
        id: 'noise-shared',
        title: '共用雜訊源的相關（主 PLL 直接路徑 vs LMS）',
        verify: 'DSM、reference、divider、comparator 與 LMS 狀態之間的共同源頭。',
        judge: String.raw`以 cross-spectrum 計算總雜訊，不可一律功率相加：$\sigma^2_{a+b}=\sigma_a^2+\sigma_b^2+2\rho_{ab}\sigma_a\sigma_b$。`,
        claim: 'research',
        links: [{ to: '/ch/12', label: 'Ch12' }, { to: '/roadmap', label: 'Roadmap R2' }],
        spec: '§16.1-12',
        errata: ['E33'],
      },
    ],
  },
  {
    id: 'nonlinear',
    no: '5',
    title: '非線性',
    verify: 'DTC INL、Clipping、BBPD Saturation',
    judge: 'fixed point、limit cycle、bias',
    why: String.raw`線性化只在小誤差成立；固定點、limit cycle、飽和都要用非線性（或 bit-true）模型確認。`,
    anchor: 'so-fixed',
    checks: [
      {
        id: 'nl-inl',
        title: String.raw`DTC INL 下的固定點（MSE vs Sign-LMS vs $\sigma_v$）`,
        verify: String.raw`code 分布、INL 形狀（$c_2,c_3$）、演算法（MSE 或 Sign-Error）與 $\sigma_v$。`,
        judge: String.raw`MSE-LMS：$w^*=a+c_3E[x^4]/E[x^2]$；Sign-LMS 依 $\sigma_v$ 落在 MSE 解與 $|x|$ 加權中位數之間——用 mean-field 求根並以 MC 驗證，不要直接拿 1.34 當驗收值。`,
        criterion: String.raw`w^*_\text{MSE}=a+c_3\frac{E[x^4]}{E[x^2]},\qquad \sum_x p_x\,x\,\mathrm{erf}\Big(\frac{e_\text{det}(x;w^*)}{\sqrt2\sigma_v}\Big)=0`,
        claim: 'exact',
        links: [{ to: '/ch/11', label: 'Ch11 Bias & INL Lab' }],
        spec: '§11.2',
        errata: ['E01', 'E11'],
      },
      {
        id: 'nl-sat',
        title: 'Comparator S 曲線飽和與大誤差的 slew-limited 收斂',
        verify: String.raw`初始誤差 $|\delta_0|$ 相對 $\sigma_v$ 的大小（coarse 階段）。`,
        judge: String.raw`$|\delta_0|\gtrsim0.5\sigma_v$ 時線性 $E[\delta_B^2]$ 公式低估；改用 MC 或 $B\gtrsim(|\delta_0|-\text{目標})/(\mu\max|x|)$ 粗估。`,
        criterion: String.raw`E[q]=\mathrm{erf}\Big(\frac{s}{\sqrt2\sigma_v}\Big)\ne K_qs\quad(|s|\gtrsim0.5\sigma_v)`,
        claim: 'approx',
        links: [{ to: '/ch/05', label: 'Ch05 Comparator Lab' }, { to: '/ch/14', label: 'Ch14 E48 驗證表' }],
        errata: ['E48'],
      },
      {
        id: 'nl-clip',
        title: 'DTC range clipping、register saturation 與 anti-windup',
        verify: '超出調整範圍時的行為與復原路徑。',
        judge: String.raw`注入超出範圍的 PVT 步階：不可永遠卡在 rail；離開 rail 後回到正確固定點；saturation 計數器有上報。`,
        claim: 'research',
        links: [{ to: '/lab', label: 'Calibration Lab' }, { to: '/models', label: 'Models（saturation 欄位）' }, THIS('so-silicon', '本頁：矽上量測計畫（飽和計數器）')],
        spec: '§16.1-8',
      },
      {
        id: 'nl-limit',
        title: 'Quantized state 的 limit cycle 與 rounding bias',
        verify: String.raw`internal fractional state 的位數 $F$、physical output 寬度、rounding mode（nearest／floor、tie 規則）。`,
        judge: String.raw`常數目標時一階 EFB 必有週期（有理數 $P/q$ ⇒ 週期 $q$；定點 ⇒ $2^F/\gcd$）；truncation 在 $\bar G\approx0$ 附近造成系統偏差。以 spur 與總誤差功率比較策略。`,
        criterion: String.raw`T_\text{lc}=\frac{2^F}{\gcd(K_F,2^F)},\qquad K_F=\mathrm{round}(w_H2^F)\bmod 2^F`,
        claim: 'exact',
        links: [THIS('so-fixed', '本頁：Fixed-point 判斷器'), { to: '/ch/13', label: 'Ch13 Quantized Gain Lab' }],
        spec: '§16.1-5、§16.1-6',
        errata: ['E15', 'E47'],
      },
      {
        id: 'nl-overflow',
        title: 'GMAC accumulator 位元數與 overflow 行為',
        verify: String.raw`輸入位元 $B_x$（含 sign）、累加長度 $N$、累加器位元 $B_\text{acc}$、wrap 或 saturate。`,
        judge: String.raw`最壞情況（全部 $+(2^{B_x-1}-1)$ 或全部 $-2^{B_x-1}$）不得 wrap；可能溢位時必須 saturate（至少不翻號）。`,
        criterion: String.raw`B_\text{acc}\ge B_x+\lceil\log_2N\rceil`,
        claim: 'exact',
        links: [THIS('so-fixed', '本頁：Fixed-point 判斷器'), { to: '/ch/04', label: 'Ch04 定點實驗' }],
        spec: '§16.1-3',
      },
    ],
  },
  {
    id: 'multi',
    no: '6',
    title: '多參數',
    verify: 'GOS/PHOS/Gain cross-coupling',
    judge: 'singular values、combined eigenvalues',
    why: '每個 loop 單獨穩定，不代表一起更新時穩定（T18）；缺乏資訊的方向也不會因為 preconditioner 而出現。',
    anchor: 'so-mimo',
    checks: [
      {
        id: 'multi-J',
        title: String.raw`量測 Jacobian $\hat{\mathbf J}$ 與其奇異值`,
        verify: String.raw`freeze 全部參數，逐一擾動 $w_j\pm\Delta_j$，同時記錄所有 GMAC。`,
        judge: String.raw`$\sigma_{\min}(\hat{\mathbf J})$ 要顯著大於 0 才算可辨識：以 Weyl 不等式取門檻 $z\,\|\mathrm{se}\|_F$；$\kappa(\hat{\mathbf J})$ 決定慢模式與雜訊放大；$\Delta_j$ 太大有截斷偏差（$\approx-\Delta_j^2/(6\sigma_v^2)$，數值見本頁 Polarity 段落）。`,
        criterion: String.raw`\hat J_{ij}=\frac{\bar G_i(\mathbf w+\Delta_j\mathbf e_j)-\bar G_i(\mathbf w-\Delta_j\mathbf e_j)}{2\Delta_j},\qquad \sigma_{\min}(\hat{\mathbf J})>z\,\|\mathrm{se}\|_F`,
        claim: 'approx',
        links: [THIS('so-sspll', '本頁：SSPLL 兩參數 Jacobian'), { to: '/ch/10', label: 'Ch10 MIMO Lab' }],
        spec: '§10.2',
      },
      {
        id: 'multi-eig',
        title: String.raw`聯合 eigenvalues：$\rho(\mathbf I+\mathbf M\mathbf J)<1$，且對 $\hat{\mathbf J}$ 誤差有裕度`,
        verify: String.raw`實際使用的 $\mathbf M$（由量測 $\hat{\mathbf J}$ 建構）與真實 plant $\mathbf J_\text{true}$。`,
        judge: String.raw`poles 一律以 $\mathrm{eig}(\mathbf I+\mathbf M(\hat{\mathbf J})\mathbf J_\text{true})$ 計算；近奇異時對 $\hat{\mathbf J}$ 誤差極敏感，需 regularization $\varepsilon_J$。`,
        criterion: String.raw`\rho\big(\mathbf I+\mathbf M\mathbf J_\text{true}\big)<1,\qquad \mathbf M=-\gamma(\hat{\mathbf J}^T\hat{\mathbf J}+\varepsilon_J\mathbf I)^{-1}\hat{\mathbf J}^T`,
        claim: 'exact',
        links: [THIS('so-mimo', '本頁：MIMO 判斷器'), { to: '/ch/10', label: 'Ch10 MIMO Lab' }],
        errata: ['E24', 'E22'],
      },
      {
        id: 'multi-gauge',
        title: 'Gauge／null space（GOS global offset vs one-hot PHOS）',
        verify: String.raw`raw-x domain 與經 $H_\mathrm{PD}$ 的 u-domain 的 eigenvalues。`,
        judge: String.raw`經 $H_\mathrm{PD}(1)=0$ 觀測時有 2 個零 eigenvalue；固定 reference phase 或 $\sum_ia_i=0$ 只處理 $a_i$ 的 gauge，global offset $b$ 需獨立觀測路徑或不更新。`,
        claim: 'exact',
        links: [{ to: '/ch/09', label: 'Ch09 Gauge one-hot 實驗' }],
        spec: '§9.2',
        errata: ['E04'],
      },
      {
        id: 'multi-dual',
        title: '主 PLL 與 LMS 的耦合（完整 eigenvalues）',
        verify: String.raw`把主迴路的慢狀態與 LMS 狀態合成 $\mathbf A_\text{combined}$。`,
        judge: String.raw`以完整模型判斷；在 Ch08 §8.4 的二狀態模型裡（下面的判準：主迴路一個慢狀態、誤差晚一個 block 才被 GMAC 看到），quasi-static 一階模型的界限恰好高估 2 倍（與 $r_s$ 無關），主因是 1 block 觀測延遲。其他觀測路徑不一定是 2 倍，不能用「除以 2」代替完整模型。`,
        criterion: String.raw`0<\mu b_sc_s<1-r_s\ \ (\text{full})\qquad\text{vs}\qquad 0<\mu b_sc_s<2(1-r_s)\ \ (\text{quasi-static})`,
        claim: 'exact',
        links: [{ to: '/ch/08', label: 'Ch08 Dual-Loop Explorer' }],
        spec: '§8.4',
        errata: ['E19', 'E31'],
      },
      {
        id: 'multi-noise',
        title: 'Preconditioner 的雜訊放大（per-parameter variance）',
        verify: String.raw`eigen-mode variance 與每個參數的 variance（不要混淆）。`,
        judge: String.raw`慢模式（$\lambda_i$ 小）被放大 $\propto1/\lambda_i$；以參數座標 $\mathrm{Cov}(\boldsymbol\delta)=\mathbf V\,\mathrm{diag}(\mathrm{Var}\,\xi_i)\mathbf V^T$ 對照規格。`,
        criterion: String.raw`\mathrm{Var}(\xi_i)\approx\frac{\gamma}{K_q^2N\lambda_i(2-\gamma)},\qquad \boldsymbol\xi=\mathbf V^T\boldsymbol\delta`,
        claim: 'approx',
        links: [{ to: '/ch/10', label: 'Ch10 Preconditioner' }],
        spec: '§10.1',
        errata: ['E37', 'E21', 'E05'],
      },
    ],
  },
  {
    id: 'strategy',
    no: '7',
    title: '校正策略',
    verify: 'background、freeze、coarse/fine、relock',
    judge: 'gain code + output PN/jitter/spur',
    why: String.raw`最後驗收的是 PLL 輸出（PN、jitter、spur），不是 GMAC 歸零；而且要在每個 mode 與每次 relock 之後都成立。`,
    checks: [
      {
        id: 'strat-fsm',
        title: 'State machine：coarse → fine → track／freeze 的切換條件',
        verify: String.raw`每個狀態的 $(\mu,N)$、退出條件與 timeout。`,
        judge: String.raw`退出條件有統計意義（例如 $|\bar G|<z\sigma_\eta$ 連續 $m$ 個 block）；coarse 階段的大步長以 MC（非線性 erf）驗證。`,
        claim: 'approx',
        links: [{ to: '/ch/14', label: 'Ch14 Cal State Machine' }],
        spec: '§14.2',
        errata: ['E48'],
      },
      {
        id: 'strat-relock',
        title: 'Lock loss、reset、mode 切換、PVT 突變時的 freeze／reinit',
        verify: '每個事件下 calibration register 的處置（保留、freeze、重置、重新 coarse）。',
        judge: '在 behavioral model 注入失鎖與 PVT 步階：校正不得在失鎖期間積分錯誤資訊；relock 後回到規格內的時間有上界。',
        claim: 'research',
        links: [{ to: '/ch/14', label: 'Ch14' }, { to: '/lab', label: 'Calibration Lab' }, THIS('so-silicon', '本頁：矽上量測計畫（lock-detect 與 enable 時序）')],
        spec: '§16.1-10',
      },
      {
        id: 'strat-modes',
        title: 'Injection ON/OFF、VCO 頻段、divider／PMUX pattern 各自的極性',
        verify: String.raw`每個 mode 的 error transfer $H_\mathrm{PD}$、$C$ 與更新符號。`,
        judge: String.raw`每個 mode 重做 freeze $\pm\Delta$ 的極性量測；不同 mode 的 $H_\mathrm{PD}$ 不能混用。`,
        claim: 'approx',
        links: [THIS('so-polarity', '本頁：Polarity 實驗'), { to: '/case/sspll', label: '案例：SSPLL GOS / PHOS' }],
        spec: '§16.1-11',
      },
      {
        id: 'strat-quant',
        title: String.raw`6-bit code 策略（freeze／toggle／stochastic／$\Delta\Sigma$／dither）`,
        verify: String.raw`目標值 $w_H$ 是否常數、code 更新率 $f_u$、ZOH 到 $f_s$ 的方式。`,
        judge: String.raw`常數目標時 1st-order $\Delta\Sigma$ 與 periodic toggle 是同一個週期循環（相同 spur、相同總誤差功率，見本頁 EFB 判斷器）；以 spur 與總誤差功率定量選擇。`,
        claim: 'exact',
        links: [{ to: '/ch/13', label: 'Ch13 Quantized Gain Lab' }, THIS('so-fixed', '本頁：EFB 週期')],
        spec: '§13',
        errata: ['E15', 'E47', 'E49'],
      },
      {
        id: 'strat-output',
        title: String.raw`Output 指標：gain code → $\delta t=x\,\delta w$ → PN／jitter／spur（經 $T$，不是 $H_\mathrm{PD}$）`,
        verify: String.raw`multirate：block-rate 的 $\delta w_k$ 以 ZOH（含 commit latency）展開到 $f_s$ 再乘 code。`,
        judge: String.raw`output 用 $T=L/(1+L)$（DTC 殘差在 PD 的 reference 輸入注入，$\theta_\text{out}=+T\,\phi_\text{dtc}$；$\delta t$ 是補償誤差，殘差是 $-\delta t$）；PSD 換算 one-sided；單 tone spur 以小角近似與 Bessel exact 對照。`,
        criterion: String.raw`\phi_\text{out}=-2\pi f_\text{out}\,T\,\delta t,\qquad \text{spur}\approx20\log_{10}(\pi f_\text{out}A_t)\ \ (|T|=1)`,
        claim: 'approx',
        links: [{ to: '/ch/12', label: 'Ch12 Code Mixing / Spur' }],
        spec: '§12.2–12.4',
        errata: ['E09', 'E28', 'E29', 'E33'],
      },
      {
        id: 'strat-cdc',
        title: 'Clock domain crossing 與 commit latency',
        verify: String.raw`comparator、GMAC、calibration register、DTC control 的 clock domain 與握手。`,
        judge: String.raw`量出實際 commit latency $d$（block），代入 $g<g_\text{crit}(d)$；同步器不得遺失或重複 commit。`,
        criterion: String.raw`g_\text{crit}(d)=2\sin\frac{\pi}{4d+2}`,
        claim: 'exact',
        links: [{ to: '/ch/08', label: 'Ch08 Phase Margin Lab' }, THIS('so-corner', '本頁：Corner 判斷器（含 $d$）')],
        spec: '§16.1-9',
      },
    ],
  },
  {
    id: 'sspll',
    no: '8',
    title: 'SSPLL GOS / PHOS 極性檢查',
    verify: 'GOS（DTC gain）與 PHOS（8 相 PMUX phase offset）各自的更新極性與交叉耦合',
    judge: String.raw`freeze + 逐一擾動 → $\hat{\mathbf J}$ 的對角符號、聯合 eigenvalues、gauge`,
    why: 'Sub-sampling PD 讓不同參數經過不同的有效路徑，其中一個參數的有效相關可能變號；只檢查 GOS 不代表 PHOS 也對。',
    anchor: 'so-sspll',
    checks: [
      {
        id: 'sspll-gos',
        title: String.raw`GOS loop 極性：$\hat J_{GG}<0$`,
        verify: String.raw`凍結 PHOS，只擾動 GOS（DTC gain）$\pm\Delta_G$。`,
        judge: String.raw`$-\hat J_{GG}-z\,\mathrm{se}>0$；與解析 $-K_qc_G$ 比對。`,
        criterion: String.raw`-\hat J_{GG}>z\,\mathrm{se}(\hat J_{GG})`,
        claim: 'approx',
        links: [THIS('so-sspll', '本頁：SSPLL 兩參數 Jacobian'), { to: '/case/sspll', label: '案例頁' }],
      },
      {
        id: 'sspll-phos',
        title: String.raw`PHOS loop 極性：每一相（或共用 loop）$\hat J_{PP}<0$`,
        verify: String.raw`凍結 GOS，擾動 PHOS（PMUX phase offset）$\pm\Delta_P$；8 相時每一相都要做。`,
        judge: String.raw`任何一相 $\hat J_{PP}$ 顯著 $>0$ ⇒ 該相在此模式下極性相反，必須反轉該 loop 的更新符號或修正 regressor 對應。`,
        criterion: String.raw`-\hat J_{PP}>z\,\mathrm{se}(\hat J_{PP})`,
        claim: 'approx',
        links: [THIS('so-sspll', '本頁：SSPLL 兩參數 Jacobian'), THIS('so-silicon', '本頁：矽上量測計畫（PMUX 相位強制、spur 反推殘差）'), { to: '/case/sspll', label: '案例頁' }],
      },
      {
        id: 'sspll-cross',
        title: String.raw`交叉項 $\hat J_{GP},\hat J_{PG}$ 與聯合 $\rho(\mathbf I+\mathbf M\hat{\mathbf J})<1$`,
        verify: 'GOS 與 PHOS regressor 的相關（同一個 PMUX 相位對應的 DTC code 分布）。',
        judge: String.raw`以量測 $\hat{\mathbf J}$ 與實際 $\mathbf M=\mathrm{diag}(\mu_G,\mu_P)$ 計算聯合 eigenvalues；單獨穩定 ≠ 聯合穩定。`,
        criterion: String.raw`\rho\big(\mathbf I+\mathrm{diag}(\mu_G,\mu_P)\,\hat{\mathbf J}\big)<1`,
        claim: 'exact',
        links: [THIS('so-sspll', '本頁：SSPLL 兩參數 Jacobian'), THIS('so-mimo', '本頁：MIMO 判斷器')],
      },
      {
        id: 'sspll-gauge',
        title: 'PHOS common-mode 與 global offset 的 gauge',
        verify: String.raw`8 相 one-hot offset 的平均與 global offset 是否同時更新。`,
        judge: String.raw`固定一個 reference phase 或強制 $\sum_ia_i=0$；global offset 經 $H_\mathrm{PD}(1)=0$ 不可觀察，不要在此路徑積分。`,
        claim: 'exact',
        links: [{ to: '/ch/09', label: 'Ch09 Gauge one-hot' }],
        errata: ['E04'],
      },
      {
        id: 'sspll-modes',
        title: '每個 SSPLL mode 重做上述檢查',
        verify: 'PMUX pattern、injection ON/OFF、VCO 頻段、divider 比。',
        judge: String.raw`每個 mode 一組 $\hat{\mathbf J}$；任何 mode 不通過 ⇒ 該 mode 必須 freeze 或使用 mode-specific 更新符號。`,
        claim: 'approx',
        links: [{ to: '/case/sspll', label: '案例頁' }],
        spec: '§16.1-11',
      },
    ],
  },
]

/* ───────────────────────── §17 反面測試 ───────────────────────── */

export interface NegativeTest {
  id: string
  title: string
  /** 怎麼注入錯誤 */
  inject: string
  /** 正確的網站／RTL 應該看到什麼 */
  expect: string
  /** 數學特徵：取自 negativeSignatures() 的 key 與顯示格式 */
  signature: { key: keyof NegativeSignatures; label: string; digits?: number; unit?: string }[]
  /** 對應的 T-id（golden 也以此命名） */
  tId?: string
  /** 是否為規格 §17 原列項目（否 = 本站補充，來自 golden test_NEG_*） */
  fromSpec: boolean
  links: LinkRef[]
  errata?: string[]
}

export const NEGATIVE_TESTS: NegativeTest[] = [
  {
    id: 'neg-polarity',
    title: '極性反轉',
    inject: String.raw`comparator 輸出取反（$q\to-q$），或 PD 極性定義相反。`,
    expect: String.raw`平均 pole $p=1+\mu K>1$：誤差指數成長（sign-LMS 先局部指數發散，再以約 $\mu(2A/\pi)|\cos\theta|$ 線性漂移）。UI 必須顯示「$C\le0$：更新極性錯誤…」，不能只寫「發散」。`,
    signature: [{ key: 'reversedPolarityPole', label: String.raw`p=1+\mu K_qC`, digits: 7 }],
    tId: 'T06',
    fromSpec: true,
    links: [{ to: '/ch/06', label: 'Ch06' }, THIS('so-polarity', '本頁 Case C')],
  },
  {
    id: 'neg-pe',
    title: '完全缺乏 PE',
    inject: String.raw`兩個 regressor 完全相同（$\rho=1$），或 code 不含某參數的資訊。`,
    expect: String.raw`$\lambda_{\min}(\mathbf R)=0$：沿 $[1,-1]/\sqrt2$ 沒有恢復力，參數組合永遠停在初值（或被雜訊推著漂移）。UI 顯示「$\lambda_{\min}=0$：不可辨識」，而不是「收斂很慢」。`,
    signature: [{ key: 'missingPeEigMin', label: String.raw`\lambda_{\min}(\mathbf R),\ \rho=1`, digits: 4 }],
    tId: 'T10',
    fromSpec: true,
    links: [{ to: '/ch/09', label: 'Ch09' }],
  },
  {
    id: 'neg-misalign',
    title: 'Code misalignment',
    inject: String.raw`$H=1$（$\phi=0$），但 GMAC 的 code 錯位 $D=4$ sample（$\Omega=\pi/6$）。`,
    expect: String.raw`$C_D=\tfrac12\cos(\Omega D)=\tfrac12\cos120^\circ<0$：路徑本身沒有相移，光是錯位就讓更新反向。`,
    signature: [{ key: 'misalignedCD4', label: String.raw`C_{D=4}`, digits: 6 }],
    tId: 'T07',
    fromSpec: true,
    links: [{ to: '/ch/07', label: 'Ch07' }, THIS('so-polarity', '本頁 Case B')],
    errata: ['E46'],
  },
  {
    id: 'neg-scaling',
    title: '$N$ 改變卻忘記 scaling',
    inject: String.raw`RTL 用 sum（沒有 $/N$），或 $\mu$ 依 $N_0=4096$ 補償後把 $N$ 改成 $32N_0$ 卻沒重算。`,
    expect: String.raw`有效 $g$ 乘 $N$：sum 模式 $g$ 與 pole 遠超出 $(0,2)$；改 $N$ 未重算時 $g>2$ 同樣發散。sign-LMS 的 $|G|\le N$ 讓它不會數值爆掉，而是大幅擺盪——UI 要用解析 $g$ 判斷，不能只看「沒有 NaN」。`,
    signature: [
      { key: 'sumModeGainMultiplier', label: String.raw`G_\text{sum}/G_\text{avg}`, digits: 6 },
      { key: 'gSumMode', label: String.raw`g_\text{sum}=N\mu K`, digits: 5 },
      { key: 'poleSumMode', label: String.raw`p_\text{sum}=1-g_\text{sum}`, digits: 5 },
      { key: 'gWrongNScaling', label: String.raw`g\ (N=32N_0)`, digits: 4 },
    ],
    tId: 'T13',
    fromSpec: true,
    links: [{ to: '/ch/12', label: 'Ch12' }, { to: '/ch/04', label: 'Ch04' }],
    errata: ['E18', 'E30'],
  },
  {
    id: 'neg-overflow',
    title: '定點 Overflow',
    inject: String.raw`6-bit 有號輸入 × 累加 4096 筆，但累加器只有 17 bit（wrap）。`,
    expect: String.raw`需要 $6+\lceil\log_2 4096\rceil$ bit；全部 $+31$ 時 17-bit wrap 成負值——正相關被讀成負，更新方向錯誤。saturate 至少不翻號。`,
    signature: [
      { key: 'gmacBitsRequired', label: String.raw`B_\text{acc,min}`, digits: 6 },
      { key: 'gmacSumExact', label: String.raw`\sum q x\ (\text{exact})`, digits: 8 },
      { key: 'gmacWrapped17', label: String.raw`\text{wrap}_{17}`, digits: 8 },
      { key: 'gmacSaturated17', label: String.raw`\text{sat}_{17}`, digits: 8 },
    ],
    fromSpec: true,
    links: [{ to: '/ch/04', label: 'Ch04 定點實驗' }, THIS('so-fixed', '本頁 Fixed-point')],
  },
  {
    id: 'neg-bitsign',
    title: String.raw`錯誤位元符號（0/1 沒有映射成 $\pm1$）`,
    inject: String.raw`直接把 $b\in\{0,1\}$ 當 $q$。code 帶 DC：$x\in\{-1,-0.5,0,0.5,1,1.5\}$ 等機率，$\sigma_v=100$ fs。`,
    expect: String.raw`$w=a$ 時平均更新 $E[bx]=E[x]/2\ne0$，固定點被推離 $a$；零均值 code 時只是增益減半（更隱蔽）。`,
    signature: [
      { key: 'wrongEncodingUpdateAtTruth', label: String.raw`E[b\,x]\big|_{w=a}`, digits: 6 },
      { key: 'wrongEncodingShiftFs', label: String.raw`w^*-a`, digits: 6, unit: 'fs' },
    ],
    tId: 'T04',
    fromSpec: true,
    links: [{ to: '/ch/04', label: 'Ch04 位元編碼' }, THIS('so-polarity', '本頁：mapping 選項')],
    errata: ['E07'],
  },
  {
    id: 'neg-path',
    title: 'PLL 誤差路徑與輸出路徑混淆',
    inject: String.raw`用 $H_\mathrm{PD}$ 估 output PN，或用 $T$ 判斷更新極性。`,
    expect: String.raw`$H_\mathrm{PD}+T=1$：低頻 $|H_\mathrm{PD}|$ 很小但 $|T|\approx1$——PD error 小 ≠ output noise 小。`,
    signature: [
      { key: 'hpdAt01', label: String.raw`|H_\mathrm{PD}(j0.1\omega_n)|`, digits: 5 },
      { key: 'tAt01', label: String.raw`|T(j0.1\omega_n)|`, digits: 5 },
      { key: 'pathIdentityResidual', label: String.raw`|H_\mathrm{PD}+T-1|`, digits: 3 },
    ],
    fromSpec: true,
    links: [{ to: '/ch/12', label: 'Ch12 PD vs output' }, { to: '/ch/06', label: 'Ch06' }],
    errata: ['E44'],
  },
  {
    id: 'neg-alias',
    title: '低取樣率的 aliasing',
    inject: String.raw`$0.6f_s$ 的 tone 以 $f_s$ 取樣（例如 GMAC／code 以 block rate 觀察 sample-rate 現象）。`,
    expect: String.raw`它出現在 $0.4f_s$，兩個取樣序列逐點相同——Nyquist 以上的相關性會被誤判成另一個頻率的相關性。`,
    signature: [
      { key: 'aliasOf06', label: String.raw`f_\text{alias}/f_s`, digits: 6 },
      { key: 'aliasMaxDiff', label: String.raw`\max_n|\cos(1.2\pi n)-\cos(0.8\pi n)|`, digits: 2 },
    ],
    fromSpec: true,
    links: [{ to: '/models', label: 'Models：FFT 陷阱' }],
    errata: ['E29'],
  },
  {
    id: 'neg-formula',
    title: '模型公式有錯，UI 卻顯示成功',
    inject: String.raw`故意把 PM 公式漏掉 $/2$，或把 $\sigma_w$ 分母寫成 $(1-p)$。`,
    expect: String.raw`Analytic／Monte Carlo 交叉比對必須顯示 mismatch（MetricTable ✗）；只有「公式自己跟自己比」的測試抓不到這種錯。`,
    signature: [
      { key: 'pmRight', label: String.raw`PM\ (g=1)`, digits: 6, unit: '°' },
      { key: 'pmWrong', label: String.raw`PM_\text{wrong}`, digits: 6, unit: '°' },
      { key: 'sigmaWRight', label: String.raw`\sigma_w`, digits: 5, unit: 'fs' },
      { key: 'sigmaWWrong', label: String.raw`\sigma_{w,\text{wrong}}`, digits: 5, unit: 'fs' },
    ],
    fromSpec: true,
    links: [{ to: '/verification', label: 'T01–T18 驗證頁' }, THIS('so-negative', '本頁：交叉比對示範')],
  },
  {
    id: 'neg-wrap',
    title: 'Polarity margin 的 wrap 寫錯（本站補充）',
    inject: String.raw`把 $\mathrm{wrap}_{180}(\theta)$ 實作成 $\theta\bmod180^\circ$。`,
    expect: String.raw`$\theta=200^\circ$ 正確 $M=-70^\circ$（極性錯誤），錯誤實作顯示 $+70^\circ$；建議直接用 $M=\arcsin(\cos\theta)$。`,
    signature: [
      { key: 'margin200', label: String.raw`M(200^\circ)`, digits: 6, unit: '°' },
      { key: 'margin200Naive', label: String.raw`M_\text{mod180}(200^\circ)`, digits: 6, unit: '°' },
      { key: 'marginM150', label: String.raw`M(-150^\circ)`, digits: 6, unit: '°' },
      { key: 'marginM150Naive', label: String.raw`M_\text{mod180}(-150^\circ)`, digits: 6, unit: '°' },
    ],
    fromSpec: false,
    links: [{ to: '/ch/08', label: 'Ch08' }],
    errata: ['E20'],
  },
  {
    id: 'neg-saturation',
    title: 'Comparator 大偏移使 $K_q$ 失效（本站補充）',
    inject: String.raw`$s=500$ fs、$\sigma_v=100$ fs，仍用 $E[q]\approx K_qs$。`,
    expect: String.raw`真實 $E[q]$ 飽和在 1 以下，線性外插卻給出 $>1$ 的不可能值；coarse 階段必須用 erf 模型。`,
    signature: [
      { key: 'eqAt500', label: String.raw`\mathrm{erf}\big(s/(\sqrt2\sigma_v)\big)`, digits: 8 },
      { key: 'kqTimesS500', label: String.raw`K_qs`, digits: 5 },
    ],
    fromSpec: false,
    links: [{ to: '/ch/05', label: 'Ch05' }],
    errata: ['E48'],
  },
  {
    id: 'neg-gauge',
    title: 'One-hot + global offset 同時更新（本站補充）',
    inject: String.raw`4 相 one-hot offset $a_i$ 與 global offset $b$ 一起以 LMS 更新。`,
    expect: String.raw`$b'=b+\kappa_g$、$a_i'=a_i-\kappa_g$ 輸出完全相同：$\mathbf R$ 有零 eigenvalue（null 向量 $[1,-1,-1,-1,-1]$）；固定 reference phase 後才可辨識。`,
    signature: [{ key: 'gaugeEigMin', label: String.raw`\lambda_{\min}(\mathbf R_{5\times5})`, digits: 3 }],
    fromSpec: false,
    links: [{ to: '/ch/09', label: 'Ch09 Gauge' }],
    errata: ['E04'],
  },
]

/** 反面測試也進入 review 狀態（case id 'negative'），讓匯出的報告記錄「是否已執行」。 */
export const NEGATIVE_CASE: SignoffCase = {
  id: 'negative',
  no: '9',
  title: '反面測試（§17）',
  verify: '故意注入規格 §17 列出的錯誤，確認模擬、RTL 與 UI 都會「失敗得正確」',
  judge: '每一項都要看到預期的數學特徵與解釋型警告',
  why: '只測「正確的情況會通過」，抓不到公式錯但 UI 顯示成功的情境。',
  anchor: 'so-negative',
  checks: NEGATIVE_TESTS.map((t) => ({
    id: t.id,
    title: t.title,
    verify: t.inject,
    judge: t.expect,
    claim: 'exact' as ClaimKind,
    links: t.links,
    spec: t.fromSpec ? '§17' : 'golden test_NEG',
    errata: t.errata,
  })),
}

/** 匯出／進度統計用的完整列表。 */
export const ALL_CASES: SignoffCase[] = [...SIGNOFF_CASES, NEGATIVE_CASE]

/* ───────────────────────── 附錄 B：十項限制 ───────────────────────── */

export interface Limitation {
  no: number
  title: string
  /** 規格的陳述（白話） */
  body: string
  /** 數學說明（TeX） */
  math: string
  /** sign-off 時該怎麼做 */
  action: string
  links: LinkRef[]
  errata?: string[]
}

export const LIMITATIONS: Limitation[] = [
  {
    no: 1,
    title: 'PLL 的 $H(z)$ 並非一種通用定義',
    body: 'PLL error transfer、DTC 輸入到 PD、gain register 到 phase error、noise 到 output，都是不同的路徑，必須依注入位置推導。',
    math: String.raw`H_\mathrm{PD}=\frac{1}{1+L}\ \ne\ T=\frac{L}{1+L}\ \ne\ H_{\eta\to w}=\frac{\mu}{z-p}`,
    action: '每個檢查項目都寫明用的是哪一條路徑、哪一個注入點、哪一個取樣率（$f_s$ 或 $f_u$）。',
    links: [{ to: '/ch/06', label: 'Ch06' }, { to: '/ch/12', label: 'Ch12' }],
    errata: ['E44', 'E29'],
  },
  {
    no: 2,
    title: '純相位差法不等於完整 PM',
    body: String.raw`$\cos\phi>0$ 只是單頻相關性的正負條件；閉迴路動態仍要算 poles／PM（含更新延遲）。`,
    math: String.raw`\cos(\phi+\Omega D)>0\ \not\Rightarrow\ \rho<1;\qquad PM_d=90^\circ-(2d+1)\arcsin\frac g2`,
    action: 'polarity margin 當必要條件；穩定性另以 poles（含 $d$）判斷。',
    links: [{ to: '/ch/08', label: 'Ch08' }],
    errata: ['E20'],
  },
  {
    no: 3,
    title: 'White Gaussian comparator 的增益不是全域常數',
    body: String.raw`大偏移時 S 曲線飽和；$K_q$ 取決於 operating point、threshold $\theta$ 與 noise PDF。`,
    math: String.raw`K_q(s)=\frac{\partial E[q]}{\partial s}=\sqrt{\frac2\pi}\frac{1}{\sigma_v}\,e^{-(s-\theta)^2/(2\sigma_v^2)}\ \le\ K_q(\theta)`,
    action: String.raw`在實際 operating point 量 $\hat K$；coarse 階段用大訊號（erf）模型或 MC。`,
    links: [{ to: '/ch/05', label: 'Ch05' }],
    errata: ['E48'],
  },
  {
    no: 4,
    title: 'Noise 並非一定互相獨立',
    body: 'DSM、reference／divider、comparator 與 LMS 狀態可能共用源頭，不能一律功率相加。',
    math: String.raw`\sigma_{a+b}^2=\sigma_a^2+\sigma_b^2+2\rho_{ab}\sigma_a\sigma_b,\qquad -1\le\rho_{ab}\le1`,
    action: '共用源頭時以 cross-spectrum 或共同時域模擬計算。',
    links: [{ to: '/ch/12', label: 'Ch12' }, { to: '/roadmap', label: 'Roadmap R1–R2' }],
  },
  {
    no: 5,
    title: '時域索引嚴格分開',
    body: String.raw`$n$ 為 comparator sample、$k$ 為 GMAC update、$m$ 為更慢的 PVT tracking；頻率軸也要分 $f_s$ 與 $f_u=f_s/N$。`,
    math: String.raw`n\ (f_s),\qquad k=\Big\lfloor\frac{n-n_c}{N}\Big\rfloor\ (f_u=f_s/N),\qquad m\ (\text{PVT})`,
    action: '每張圖、每個公式標明索引與取樣率；跨速率時寫出 ZOH 與 commit latency。',
    links: [{ to: '/formulas', label: 'Formula & Unit Reference' }],
    errata: ['E35', 'E09'],
  },
  {
    no: 6,
    title: '損失函數與最佳點不完全相同',
    body: String.raw`MSE 的 GMAC 固定點是 $E[ex]=0$；Sign-Error 的固定點是 $E[\mathrm{sign}(e)x]=0$，一般不等價。`,
    math: String.raw`E[e\,x]=0\ \ (\text{MSE})\qquad\text{vs}\qquad E[\mathrm{sign}(e)\,x]=0\ \ (\text{Sign-Error})`,
    action: String.raw`驗收值依實際演算法與 $\sigma_v$ 計算（mean-field），並標註是哪一個固定點。無雜訊、code 只取有限個值時 $E[\mathrm{sign}(e)x]$ 是 $w$ 的階梯函數：固定點是它由正變負的位置，不一定有讓它 $=0$ 的 $w$（Ch11 §11.2）。`,
    links: [{ to: '/ch/11', label: 'Ch11' }, { to: '/ch/02', label: 'Ch02' }],
    errata: ['E01'],
  },
  {
    no: 7,
    title: 'PE 是資訊存在的條件，不保證輸出雜訊低',
    body: '近 singular 的資訊矩陣會讓係數雜訊很大；preconditioner 只能加速，不能製造資訊。',
    math: String.raw`\mathrm{Var}(\xi_i)\propto\frac{1}{\lambda_i},\qquad \frac{\mathrm{Var}(\xi_{\min})}{\mathrm{Var}(\xi_{\max})}=\frac{\lambda_{\max}}{\lambda_{\min}}=\kappa(\mathbf R)`,
    action: String.raw`同時報 $\lambda_{\min}$（可辨識）與 per-parameter variance（雜訊代價）。`,
    links: [{ to: '/ch/09', label: 'Ch09' }, { to: '/ch/10', label: 'Ch10' }],
    errata: ['E37'],
  },
  {
    no: 8,
    title: '有限樣本 Monte Carlo 不能證明全域穩定',
    body: '應與解析模型、pole／eigenvalue、最差條件測試結合；MC 只能給出「失效機率的上界」。',
    math: String.raw`P(\text{0 失效}\mid p)=(1-p)^n\le\alpha\ \Rightarrow\ p_U=1-\alpha^{1/n}\approx\frac{-\ln\alpha}{n}`,
    action: '報告 seeds 數、掃描範圍與 $p_U$；不要寫「已證明穩定」。',
    links: [THIS('so-evidence', '本頁：證據強度')],
    errata: ['E14'],
  },
  {
    no: 9,
    title: 'Normalized code、gain register 單位不可混淆',
    body: String.raw`一個正規化的 1 可以是 1 LSB、1 UI、1 ps 或 unit RMS，都會改變 $\mu$ 的單位與數值。`,
    math: String.raw`g=\mu K_qC\ \ (\text{無因次}),\qquad [\mu]=\frac{[w]}{[G]},\qquad [K_q]=\mathrm{fs}^{-1}`,
    action: String.raw`每個 $\mu$ 都附單位與 scaling（average／sum、code 正規化方式）；同時顯示 raw $\mu$ 與 $g$。`,
    links: [{ to: '/formulas', label: 'Formula & Unit Reference' }],
    errata: ['E13', 'E05'],
  },
  {
    no: 10,
    title: '量化誤差不一定等效獨立白雜訊',
    body: '決定性循環、PRBS 週期、限幅與非線性會產生 tones／spurs，需要 time-domain simulation。',
    math: String.raw`\text{一階 EFB、常數 }c=P/q\ \Rightarrow\ \text{週期 }q;\qquad \overline{e^2}\ne\tfrac{2}{12}\ \text{(white NTF 模型)}`,
    action: '以時域序列檢查週期與譜線；比較實際總誤差功率與白雜訊模型。',
    links: [{ to: '/ch/13', label: 'Ch13' }, THIS('so-fixed', '本頁 Fixed-point')],
    errata: ['E15', 'E47', 'E36'],
  },
]

/* ───────────────────────── §16.3 何時可以宣稱穩定 ───────────────────────── */

export type StabilityKind = 'mean' | 'mean-square' | 'almost-sure' | 'local-linear' | 'probabilistic' | 'empirical' | 'overclaim'

export const STABILITY_KIND_LABEL: Record<StabilityKind, string> = {
  mean: '平均收斂（mean）',
  'mean-square': '均方穩定（mean-square）',
  'almost-sure': '幾乎必然收斂（almost-sure）',
  'local-linear': '局部線性穩定（local linear）',
  probabilistic: '機率性有界（bounded in probability）',
  empirical: '經驗性（指定 sweep／seeds 未觀察到失效）',
  overclaim: '過度宣稱',
}

export interface ClaimStatement {
  id: string
  ok: boolean
  /** 語句本身（可含 $…$） */
  text: string
  /** 'spec' = 規格 §16.3 原句；'site' = 本站補充 */
  source: 'spec' | 'site'
  kind: StabilityKind
  /** 這句話「說了什麼」——精確的數學意義 */
  means: string
  /** 數學（TeX） */
  math: string
  /** 沒有說什麼／為什麼錯 */
  caveat: string
  claim: ClaimKind
}

export const STATEMENTS: ClaimStatement[] = [
  {
    id: 'st-mean',
    ok: true,
    source: 'spec',
    text: String.raw`在明定的一階平均模型、$0<g<2$ 下，局部平均誤差漸近收斂。`,
    kind: 'mean',
    means: String.raw`對期望值 $E[\delta_k]$ 的線性遞迴成立：每個 block 乘上 $p=1-g$，$|p|<1\Leftrightarrow0<g<2$。`,
    math: String.raw`E[\delta_{k+1}]=(1-g)\,E[\delta_k]\ \Rightarrow\ E[\delta_k]=(1-g)^kE[\delta_0]\to0\iff 0<g<2`,
    caveat: String.raw`沒有說變異數有界、沒有說大誤差時（erf 飽和）成立、沒有說 $d\ge1$ 時成立（那時要 $g<g_\text{crit}(d)$）。`,
    claim: 'exact',
  },
  {
    id: 'st-eig',
    ok: true,
    source: 'spec',
    text: '在此固定點的線性化雙迴路模型中，所有 closed-loop eigenvalues 都位於 unit circle 內。',
    kind: 'local-linear',
    means: String.raw`Lyapunov 間接法：線性化矩陣的 spectral radius $<1$ ⇒ 存在某個鄰域，從其中出發的軌跡指數收斂到固定點。`,
    math: String.raw`\rho\Big(\frac{\partial F}{\partial\mathbf s}\Big|_{\mathbf s^*}\Big)<\bar\rho<1\ \Rightarrow\ \exists\,r,c>0:\ \|\mathbf s_0-\mathbf s^*\|<r\Rightarrow\|\mathbf s_k-\mathbf s^*\|\le c\,\bar\rho^{\,k}\,\|\mathbf s_0-\mathbf s^*\|`,
    caveat: String.raw`鄰域大小 $r$ 未知；不保證全域；固定點本身可能有 bias；模型（$\mathbf A_\text{combined}$）要與實際硬體一致。`,
    claim: 'exact',
  },
  {
    id: 'st-sweep',
    ok: true,
    source: 'spec',
    text: '指定的 FCW／PVT sweep、Monte Carlo seeds 均未觀察到溢位或發散。',
    kind: 'empirical',
    means: String.raw`只對「掃過的條件」與「抽過的 seeds」成立；若把每個 seed 看成獨立試驗，0 次失效可推出失效機率的上界。`,
    math: String.raw`k=0\ \text{次失效 / }n\ \text{次}\ \Rightarrow\ P(\text{失效})\le1-\alpha^{1/n}\ \ (\text{信心 }1-\alpha)`,
    caveat: '沒有涵蓋未掃描的 FCW／PVT；上界只對與試驗同分布的隨機條件有效；heavy-tail 指標（$E[\\delta^2]$）可能在少數路徑才爆。',
    claim: 'approx',
  },
  {
    id: 'st-pm60',
    ok: false,
    source: 'spec',
    text: String.raw`Phase Margin 大於 $60^\circ$，因此所有 Sign-LMS、所有 FCW 都保證校正正確。`,
    kind: 'overclaim',
    means: String.raw`PM 是「一個 operating point、一個 $C$、一個 $K$」的線性化指標。`,
    math: String.raw`PM=90^\circ-\arcsin\frac{g}{2},\quad g=\mu K_qC(\mathrm{FCW})\\ \text{（每個 FCW 的 }C\text{ 都不同，甚至可為負）}`,
    caveat: String.raw`$C(\mathrm{FCW})$ 可能變號（極性錯誤時 PM 根本無意義）；sign-LMS 的 $K_q$ 隨 operating point 改變；「校正正確」還包含 bias、可辨識性、量化——PM 一個都沒有回答。`,
    claim: 'research',
  },
  {
    id: 'st-gmac0',
    ok: false,
    source: 'spec',
    text: 'GMAC output 等於零，因此 DTC gain 沒有偏差且 spurs 都消失。',
    kind: 'overclaim',
    means: String.raw`$E[G]=0$ 只定義了固定點 $w^*$，而 $w^*\ne a$（INL、offset、code-correlated error）。`,
    math: String.raw`E[G(w^*)]=0\ \Rightarrow\ w^*\approx a+\frac{B_\text{bias}}{C}\ne a;\qquad \delta t[n]=x[n]\,\delta w[n]\ \text{仍產生 spur}`,
    caveat: 'GMAC 歸零是「LMS 停在哪」，不是「DTC 正確」；spur 來自係數抖動 × code 的頻譜混合與殘餘 INL。',
    claim: 'research',
  },
  {
    id: 'st-ms',
    ok: true,
    source: 'site',
    text: String.raw`在 iid 純量 Gaussian regressor、無外加雜訊的模型中，$0<\mu<2/3$ 時 $E[\delta_n^2]\to0$（mean-square stable）。`,
    kind: 'mean-square',
    means: String.raw`二階矩遞迴的係數 $g_2(\mu)=E[(1-\mu x^2)^2]<1$。iid 純量 $x$ 時這條遞迴是精確的（E38）。`,
    math: String.raw`E[\delta_{n+1}^2]=\underbrace{(1-2\mu P_x+\mu^2E[x^4])}_{g_2(\mu)}E[\delta_n^2],\quad g_2<1\iff0<\mu<\frac{2P_x}{E[x^4]}=\frac23`,
    caveat: '只對指定的 regressor 分布；$u=h*x$ 有時間相關時降為 independence approximation。',
    claim: 'exact',
  },
  {
    id: 'st-as',
    ok: true,
    source: 'site',
    text: String.raw`在同一模型中，$0<\mu<\mu_\text{as}$ 時樣本路徑幾乎必然收斂；但 $2/3<\mu<\mu_\text{as}$ 時 $E[\delta^2]$ 發散。`,
    kind: 'almost-sure',
    means: String.raw`almost-sure 收斂由 Lyapunov 指數 $\lambda(\mu)=E[\log|1-\mu x^2|]<0$ 決定，與二階矩不同。`,
    math: String.raw`\frac1n\log|\delta_n|=\frac1n\sum_{i<n}\log|1-\mu x_i^2|\ \xrightarrow{\text{a.s.}}\ \lambda(\mu)`,
    caveat: String.raw`有外加雜訊時，這個區間內 $\delta_n$ 收斂到一個二階矩無限大的 stationary 分布（heavy tail）。`,
    claim: 'exact',
  },
  {
    id: 'st-mc-ms',
    ok: false,
    source: 'site',
    text: String.raw`200 個 seeds 的軌跡都收斂，所以這組 $\mu$ 是 mean-square stable。`,
    kind: 'overclaim',
    means: '把「樣本路徑收斂」（almost-sure 的經驗證據）誤當成「二階矩有界」。',
    math: String.raw`\lambda(\mu)<0\ \ \not\Rightarrow\ \ g_2(\mu)<1\qquad(\text{例：}\mu=0.8\text{ 時 }\lambda<0\text{ 但 }g_2>1)`,
    caveat: String.raw`$E[\delta^2]$ 被極少數 heavy-tail 路徑主導，有限 seeds 幾乎看不到；用封閉式 $g_2(\mu)$ 或單步 MC 驗證（E14）。`,
    claim: 'research',
  },
  {
    id: 'st-prob',
    ok: true,
    source: 'site',
    text: String.raw`在均方有界的條件下，任一時刻 $|\delta_k|>b$ 的機率不超過 $E[\delta_k^2]/b^2$。`,
    kind: 'probabilistic',
    means: 'Chebyshev（Markov）不等式把二階矩上界轉成機率上界：這就是「機率性有界」。',
    math: String.raw`P(|\delta_k|\ge b)\le\frac{E[\delta_k^2]}{b^2}\le\frac{\sup_kE[\delta_k^2]}{b^2}`,
    caveat: '上界通常很鬆；只有在 MS 有界成立時才能用（先要有 MS 結論）。',
    claim: 'exact',
  },
  {
    id: 'st-delay',
    ok: false,
    source: 'site',
    text: String.raw`$\mu$ 取在 $0<\mu K<2$ 之內，所以 commit latency 為 2 個 block 的硬體也穩定。`,
    kind: 'overclaim',
    means: String.raw`$0<g<2$ 只對 $d=0$ 成立；更新延遲 $d$ 讓臨界增益下降。`,
    math: String.raw`z^{d+1}-z^d+g=0,\qquad g_\text{crit}(d)=2\sin\frac{\pi}{4d+2}\ \Rightarrow\ g_\text{crit}(2)<1`,
    caveat: '一定要用實際的 $d$（CDC、pipeline、commit 時序）計算。',
    claim: 'research',
  },
  {
    id: 'st-always',
    ok: false,
    source: 'site',
    text: 'LMS 一定穩定。',
    kind: 'overclaim',
    means: '沒有說是哪一種穩定、在哪個模型、哪些條件下——規格 §0.1 明文禁止。',
    math: String.raw`\text{mean}\ne\text{mean-square}\ne\text{a.s.}\ne\text{local linear}\ne\text{global nonlinear}`,
    caveat: '必須說明是平均收斂、均方穩定、機率性有界、局部線性穩定，還是全域非線性。',
    claim: 'research',
  },
]

/** 頁面上「何時可以宣稱穩定」的五種語意定義（表格用）。 */
export interface StabilityNotion {
  kind: StabilityKind
  definition: string
  proofObject: string
  evidence: string
}

export const STABILITY_NOTIONS: StabilityNotion[] = [
  {
    kind: 'mean',
    definition: String.raw`\lim_{k\to\infty}E[\boldsymbol\delta_k]=\mathbf 0`,
    proofObject: String.raw`平均遞迴 $E[\boldsymbol\delta_{k+1}]=\mathbf A_\text{mean}E[\boldsymbol\delta_k]$，$\rho(\mathbf A_\text{mean})<1$`,
    evidence: '封閉式 pole；MC 的 ensemble mean（附 CI）',
  },
  {
    kind: 'mean-square',
    definition: String.raw`\sup_kE\big[\|\boldsymbol\delta_k\|^2\big]<\infty`,
    proofObject: String.raw`二階矩遞迴（$\mathbf P_{k+1}=\mathcal L(\mathbf P_k)+\mathbf Q$）的 spectral radius $<1$`,
    evidence: String.raw`封閉式 $g_2(\mu)$ 或單步 MC；不要用長時間 $\delta^2$ 樣本平均（heavy tail）`,
  },
  {
    kind: 'almost-sure',
    definition: String.raw`P\Big(\lim_{k\to\infty}\boldsymbol\delta_k=\mathbf 0\Big)=1`,
    proofObject: String.raw`Lyapunov 指數 $\lambda=E[\log|1-\mu x^2|]<0$（純量）`,
    evidence: String.raw`數值積分 $\lambda(\mu)$；大量樣本路徑的收斂比例（只是佐證）`,
  },
  {
    kind: 'probabilistic',
    definition: String.raw`\forall\varepsilon>0\ \exists b:\ \sup_kP(\|\boldsymbol\delta_k\|>b)\le\varepsilon`,
    proofObject: 'MS 有界 + Chebyshev；或其他尾機率上界',
    evidence: '二階矩上界；分位數（附 CI）',
  },
  {
    kind: 'local-linear',
    definition: String.raw`\rho\big(\partial F/\partial\mathbf s|_{\mathbf s^*}\big)<1`,
    proofObject: String.raw`在固定點線性化（Jacobian、$\mathbf A_\text{combined}$、$\mathbf I+\mathbf M\mathbf J$）`,
    evidence: String.raw`量測 $\hat{\mathbf J}$ 後的 eigenvalues（附對 $\hat{\mathbf J}$ 誤差的敏感度）`,
  },
  {
    kind: 'empirical',
    definition: String.raw`\text{在條件集合 }\mathcal S\text{ 與 seeds }\{s_i\}_{i=1}^n\text{ 上 0 失效}`,
    proofObject: '無（只是觀察）；可換算 Clopper–Pearson 上界',
    evidence: 'sweep 清單、seeds、失效判準、$p_U$',
  },
]
