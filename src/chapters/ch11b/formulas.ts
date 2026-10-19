import type { FormulaEntry } from '@/data/types'

/**
 * Ch11b（§11 延伸：DTC INL 校正與噪聲折返）公式登錄。ID 格式 F-11B.n（Formula 頁的 ID 規則：F-<章>.<序>，章用大寫英數）。
 * 符號：正規化 code x ∈ [−1, 1]；INL d(x) = d_2x² + d_3x³ + A_s saw(x)；校正 c(x) = Σθ_iφ_i(x)；全站極性 δ = a − w。
 * title／conditions 內的數學一律寫成 `$…$`（Formula & Unit Reference 頁以 mathText 渲染；docs/teaching-style.md §3）。
 */
const page = '/ch/11b'

export const F = {
  errorModel: String.raw`\begin{aligned}
\tau_\mathrm{DTC}&=T_0-w\,x-c(x)+d(x)\\
e[n]&=(a-w)\,x[n]+b+d(x[n])-c(x[n])+v[n]\\
c(x)&=\sum_{i=1}^{P}\theta_i\,\varphi_i(x)
\end{aligned}`,
  hermite: String.raw`\begin{aligned}
d(x)&=d_2x^2+d_3x^3,\qquad x\sim\mathcal N(0,\sigma_x^2)\\
w^*-a&=3d_3\sigma_x^2\\
r(x)&=d_2\,(x^2-\sigma_x^2)+d_3\,(x^3-3\sigma_x^2x)\\
E[r^2]&=2d_2^2\sigma_x^4+6d_3^2\sigma_x^6
\end{aligned}`,
  isserlis: String.raw`R_{\mathrm{He}_p}[m]=p!\,R_x[m]^p\quad\Rightarrow\quad S_{\mathrm{He}_p}(0)=\sum_m R_{\mathrm{He}_p}[m]=p!\sum_{m=-\infty}^{\infty}R_x[m]^p`,
  mashAutocorr: String.raw`\begin{aligned}
r[n]&=-(1-z^{-1})^2\,u[n],\qquad u=\tfrac{s_3}{M}\sim\mathrm{iid}\ U(0,1)\\
R_r&=\tfrac1{12}[\,6,\,-4,\,1\,]\\
R_x&=\tfrac1{48}[\,6,\,-4,\,1\,],\qquad x=\tfrac r2,\qquad \sigma_x^2=\tfrac18\\
2\sum_mR_x[m]^2&=\tfrac{35}{576}
\end{aligned}`,
  exactLinear: String.raw`\begin{aligned}
S_2(0)&=2\sum_mR_x[m]^2+\kappa_4\Big(\sum_kh_k^2\Big)^2\\
h&=[-\tfrac12,\,1,\,-\tfrac12],\qquad \kappa_4=\tfrac1{80}-\tfrac3{144}=-\tfrac1{120}\\
\Rightarrow\ S_2(0)&=\tfrac{35}{576}-\tfrac{3}{160}=\tfrac{121}{2880}
\end{aligned}`,
  inband: String.raw`P_\mathrm{in}\approx S(0)\cdot2\nu_B=\big[d_2^2S_2(0)+d_3^2S_3(0)\big]\,\frac{2f_B}{f_s},\qquad \sigma_{t,\mathrm{in}}=\sqrt{P_\mathrm{in}},\qquad S^{(1)}(f)=\frac{2\,S(0)}{f_s}`,
  blockLms: String.raw`\begin{aligned}
\boldsymbol\vartheta_{b+1}&=\boldsymbol\vartheta_b+\mu\,\mathbf M\,\mathbf G_b,\qquad \mathbf G_b=\frac1N\sum_{n}q[n]\,\boldsymbol\psi[n]\\
E[\mathbf G]&\approx K_q\,\mathbf R\,(\boldsymbol\vartheta^*-\boldsymbol\vartheta),\qquad \mathbf R=E[\boldsymbol\psi\boldsymbol\psi^T]\\
\Rightarrow\ \boldsymbol\delta_{b+1}&=(\mathbf I-\mu K_q\mathbf M\mathbf R)\,\boldsymbol\delta_b
\end{aligned}`,
  piecewise: String.raw`\begin{aligned}
\varphi_k(x)&=\mathbb 1_k(x)\,x\\
\mathbf R&=\operatorname{diag}(\lambda_k),\qquad \lambda_k=E[x^2\mathbb 1_k(x)]=\frac{x_{k+1}^3-x_k^3}{6}\\
p_k&=1-\mu K_q\lambda_k,\qquad \tau_k=\frac1{\mu K_q\lambda_k},\qquad k_{95}=\Big\lceil\frac{\ln0.05}{\ln p_k}\Big\rceil
\end{aligned}`,
  lut: String.raw`\begin{aligned}
\varphi_j(x)&=\mathbb 1_j(x),\qquad \lambda_j=p_j=\tfrac1J\\
\tau_j&=\frac{J}{\mu K_q}\ \text{blocks},\qquad \frac{N\tau_j}{J}=\frac{N}{\mu K_q}\ \text{samples/bin per }\tau\\
n_\mathrm{eff}&=\frac{2N}{\mu K_q}
\end{aligned}`,
  variance: String.raw`\operatorname{Var}(\xi_i)=\frac{\mu^2\lambda_i}{N\,(1-p_i^2)}=\frac{\mu^2\lambda_i}{N\,g_i(2-g_i)}\approx\frac{\mu}{2K_qN},\qquad E[r^2]_\infty=\text{floor}^2+\sum_i\lambda_i\operatorname{Var}(\xi_i)`,
  polyR: String.raw`\begin{aligned}
&\varphi_m=x^m:\quad R_{mn}=E[x^{m+n}]=\frac{1}{m+n+1}\ (m+n\text{ 偶})\\
&\qquad\qquad\Rightarrow\ \kappa(\mathbf R)=67.6\ (M=3)\\[0.5em]
&\varphi_m=P_m:\quad R_{mn}=\frac{\delta_{mn}}{2m+1}\ \Rightarrow\ \kappa=7\\[0.5em]
&\varphi_m=\sqrt{2m+1}\,P_m:\quad \mathbf R=\mathbf I\ \Rightarrow\ \kappa=1
\end{aligned}`,
  gauge: String.raw`\begin{aligned}
\sum_k\mathbb 1_k(x)\,x=x\ &\Rightarrow\ \mathbf R_{[x,\,\varphi]}\,\begin{bmatrix}1\\-\mathbf 1\end{bmatrix}=\mathbf 0\quad(\text{分段}+\text{gain})\\
\sum_j\mathbb 1_j(x)=1\ &\Rightarrow\ \text{LUT 的整體 offset}\equiv b\quad(\text{LUT}+\text{PD offset})
\end{aligned}`,
  lutApprox: String.raw`\text{floor}^2=E\big[d'(x)^2\big]\frac{\Delta^2}{12},\qquad \Delta=\frac2J,\qquad E[d'^2]=\frac{4d_2^2}{3}+\frac{9d_3^2}{5}\ (\text{uniform }x)`,
  precond: String.raw`\begin{aligned}
\mathbf M&=\frac{\gamma}{K_q}\mathbf R^{-1}\ \Rightarrow\ \mathbf I-K_q\mathbf M\mathbf R=(1-\gamma)\mathbf I\\
\mathbf M&=\operatorname{diag}\!\Big(\frac{\gamma}{K_qR_{ii}}\Big)\ (\text{分段／LUT 時 }\mathbf R\text{ 對角}\Rightarrow\text{所有 pole}=1-\gamma)
\end{aligned}`,
}

export const FORMULAS: FormulaEntry[] = [
  {
    id: 'F-11B.1',
    title: 'INL 校正的誤差模型：補償量 $w\\,x+c(x)$ 從 $T_0$ 往回扣',
    tex: F.errorModel,
    conditions: 'DTC 在 reference 輸入端（docs/assumptions.md §2a）；$x\\in[-1,1]$ 為正規化 code；$d(x)$ 是 DTC 在這個 code 多出來的延遲；$v$ 與 $x$ 獨立；靜態誤差路徑',
    claim: 'exact',
    level: 'L1',
    specSection: '11',
    page,
    units: { e: 't.u.', d: 't.u.', c: 't.u.', theta: 't.u.', x: '—' },
  },
  {
    id: 'F-11B.2',
    title: 'gain 校正吸收 $3d_3\\sigma_x^2$，剩下的殘餘 INL 是 Hermite 分量',
    tex: F.hermite,
    conditions: '$x$ 零均值 Gaussian；$d_2$ 的 DC $d_2\\sigma_x^2$ 被主迴路當成靜態相位吸收；一般對稱分布用 $w^*-a=d_3E[x^4]/E[x^2]$（Ch11 F-11.8），uniform 時 $E[r^2]=4d_2^2/45+4d_3^2/175$',
    claim: 'approx',
    level: 'L1',
    specSection: '11',
    page,
  },
  {
    id: 'F-11B.3',
    title: 'Gaussian–Isserlis：非線性把整形雜訊折回帶內',
    tex: F.isserlis,
    conditions: '$x$ 零均值 Gaussian、自相關 $R_x[m]$；$\\mathrm{He}_2=x^2-\\sigma^2$、$\\mathrm{He}_3=x^3-3\\sigma^2x$（Mehler 公式）；非 Gaussian 的 code 要加累積量修正（F-11B.5）',
    claim: 'approx',
    level: 'L4',
    specSection: '11',
    page,
  },
  {
    id: 'F-11B.4',
    title: 'MASH 1-1-1 residue 的自相關與 Gaussian 折返位準 $35/576$',
    tex: F.mashAutocorr,
    conditions: '第三級累加器 $s_3/M$ 視為 iid uniform（frac 遠離有理數時成立；frac $=0.3$ 這類短週期會讓 code 落在 $1/10$ 格點上）；$x$ 本身的 PSD 在 DC 為 0（40 dB/dec），$x^2$ 的不是',
    claim: 'approx',
    level: 'L4',
    specSection: '11',
    page,
  },
  {
    id: 'F-11B.5',
    title: '線性過程的精確式：Gaussian 項 + uniform 的 $\\kappa_4$ 修正 $=121/2880$',
    tex: F.exactLinear,
    conditions: '$x=\\sum_kh_ku[n-k]$、$u$ iid（任何分布）、$\\kappa_4=E[(u-\\bar u)^4]-3\\sigma_u^4$；對 MASH 的 $u\\sim U(0,1)$ 精確。$\\kappa_4<0$：bounded 的 code 折返得比 Gaussian 少（本例少 30%）',
    claim: 'exact',
    level: 'L4',
    specSection: '11',
    page,
  },
  {
    id: 'F-11B.6',
    title: '帶內折返功率 $P_\\mathrm{in}\\approx S(0)\\cdot2\\nu_B$',
    tex: F.inband,
    conditions: '$\\nu_B=f_B/f_s\\ll1$，折返後的 PSD 在帶內近似平坦；$d_2$、$d_3$ 兩項互不相關（奇偶）；one-sided per-Hz 由 $S^{(1)}=2S/f_s$ 換算（Ch12 F-12.10）',
    claim: 'approx',
    level: 'L4',
    specSection: '11',
    page,
    units: { P_in: 't.u.^2', S: 't.u.^2·sample', f_B: 'Hz' },
  },
  {
    id: 'F-11B.7',
    title: '多參數 block Sign-LMS 的更新式與小訊號 mean-field',
    tex: F.blockLms,
    conditions: 'Sign：$q=\\operatorname{sign}(e)$、$K_q=\\sqrt{2/\\pi}/\\sigma_v$；MSE：$q=e$、$K_q=1$；需 $|e|\\ll\\sigma_v$（Ch11 F-11.3）；$\\mathbf M=\\mathbf I$ 為 scalar LMS（Ch10 F-10.2）',
    claim: 'approx',
    level: 'L3',
    specSection: '11',
    page,
  },
  {
    id: 'F-11B.8',
    title: '分段線性：每段自己的 gain，$\\mathbf R$ 對角、$\\lambda_k\\propto$ 段內的 $E[x^2]$',
    tex: F.piecewise,
    conditions: '$K$ 段等寬、$x\\sim U(-1,1)$ 時的封閉式；MASH 的 $x$ 集中在中間，外側段的 $\\lambda_k$ 更小。靠近 $x=0$ 的段 $\\lambda_k\\propto x^2$ 很小：$K=8$ 時最內段比最外段慢 37 倍',
    claim: 'exact',
    level: 'L3',
    specSection: '11',
    page,
  },
  {
    id: 'F-11B.9',
    title: 'LUT：每格一個修正值，時間常數 $J/(\\mu K_q)$ 與每格的有效樣本數',
    tex: F.lut,
    conditions: '$J$ 格等寬、造訪機率 $p_j$（uniform 時 $1/J$）；$n_\\mathrm{eff}$ 是「直接平均 $n$ 個 1-bit 樣本」達到同樣變異數所需的樣本數（$\\operatorname{Var}=1/(nK_q^2)$ 對上 F-11B.10）',
    claim: 'exact',
    level: 'L3',
    specSection: '11',
    page,
  },
  {
    id: 'F-11B.10',
    title: '穩態變異與 misadjustment：$\\operatorname{Var}(\\xi_i)\\approx\\mu/(2K_qN)$ 與 $\\lambda_i$ 無關',
    tex: F.variance,
    conditions: 'Sign：$\\operatorname{Var}(\\eta_i)=\\lambda_i/N$（$q^2=1$）；MSE：乘上 $\\sigma_v^2+\\text{floor}^2$；$g_i=\\mu K_q\\lambda_i\\ll1$ 時與 $\\lambda_i$ 無關（Ch10 F-10.7 的 $m_i=\\mu K_q$）；floor 是結構的近似誤差（F-11B.13）',
    claim: 'approx',
    level: 'L3',
    specSection: '11',
    page,
    units: { 'Var(xi)': 't.u.^2' },
  },
  {
    id: 'F-11B.11',
    title: '多項式基底的相關矩陣：monomial 是 Hankel（條件數 67.6），Legendre 對角（7），normalized Legendre 單位矩陣（1）',
    tex: F.polyR,
    conditions: '$x\\sim U(-1,1)$、$M=3$；Chebyshev 在 uniform 權重下不正交（條件數 5.9）；MASH 的 $x$ 不是 uniform，Legendre 只是「接近」對角——條件數要用實際 code 的樣本 $\\mathbf R$ 算（實驗 C）。同一個 $\\mu K_q\\lambda_{\\max}$ 下最慢／最快模式的 $k_{95}$ 比約為 $\\kappa$（Ch09 F-09.7、Ch10 F-10.5）',
    claim: 'exact',
    level: 'L3',
    specSection: '11',
    page,
  },
  {
    id: 'F-11B.12',
    title: 'Gauge：分段的 $\\sum_k\\varphi_k=x$ 與 gain 共線；LUT 的整體 offset 與 PD offset 不可分',
    tex: F.gauge,
    conditions: '分段或含 $x$ 項的多項式與 gain $w$ 同時校正 $\\Rightarrow\\mathbf R$ 奇異（$\\lambda_{\\min}=0$，Ch09 F-09.13）；LUT 的 $\\sum_j\\mathbb 1_j=1$ 與 offset $b$ 共線，與 $x$ 只是幾乎共線（條件數 $\\propto J^2$）；總補償量仍唯一，只有參數的分配不唯一',
    claim: 'exact',
    level: 'L3',
    specSection: '11',
    page,
  },
  {
    id: 'F-11B.13',
    title: 'LUT 每格存一個常數的近似誤差（結構的 floor）',
    tex: F.lutApprox,
    conditions: '$d$ 在一格內近似直線（格內殘差 $\\approx d\'(x)(x-\\bar x_j)$，uniform 分布的均方 $\\Delta^2/12$）；鋸齒狀 segment error 的跳變不在內；$J=64$、$d_2=20$：floor $=0.208$',
    claim: 'approx',
    level: 'L3',
    specSection: '11',
    page,
    units: { floor: 't.u.', Delta: '—' },
  },
  {
    id: 'F-11B.14',
    title: 'Preconditioner：完整 $\\mathbf R^{-1}$ 讓所有 pole $=1-\\gamma$；分段／LUT 的對角 $\\mathbf R$ 只要每段自己的 $\\mu_k$',
    tex: F.precond,
    conditions: '$\\mathbf R$ 正定、$\\hat{\\mathbf R}=\\mathbf R$（Ch10 F-10.4、F-10.8）；對角化只在 $\\mathbf R$ 本來就對角（分段、LUT、正交基底）時等價於完整版；弱方向的雜訊同時被放大（Ch10 F-10.6）',
    claim: 'exact',
    level: 'L3',
    specSection: '11',
    page,
  },
]
