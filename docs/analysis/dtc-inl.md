# DTC INL 校正（分段／LUT／多項式基底）與噪聲折返：推導全文

> 對應網站 Ch11b（`/ch/11b`，規格 §11 的延伸）。模型在 `src/simulation/models/dtcInl.ts`，Python golden 在 `golden/lms_pll_golden/dtc_inl.py`（`test_S11b_*`），vectors 在 `golden/vectors/dtc_inl_*.json`。所有晶片數字都是 **illustrative**（示例），不是任何晶片的量測值。
>
> 結論標籤：**【精確｜指定模型】** 在所述假設下數學上精確；**【近似｜需驗證】** 來自線性化或分布假設；**【研究假說】** 只有部分證據。

## 0. 假設清單

| # | 假設 | 用在 |
|---|---|---|
| A1 | 架構照 `docs/assumptions.md` §2a：DTC 在 reference 輸入端、從 $T_0$ 往回扣；回授只有 divider；comparator 取 PD 的輸出 $e[n]$ | 全部 |
| A2 | 正規化 code $x\in[-1,1]$：MASH 1-1-1 餘數 $x=r/2$、first-order $x=2(r+\tfrac12)$、uniform $x\sim U(-1,1)$ | 全部 |
| A3 | 靜態誤差路徑（identity path）：PLL 的 $H_\mathrm{PD}$ 已吸收進誤差（同 Ch11）；主迴路把常數 $T_0$ 與 $E[d]$ 當成靜態相位吸收 | §1–§3 |
| A4 | 雜訊 $v\sim\mathcal N(0,\sigma_v^2)$ 與 $x$ 獨立；Sign-LMS 的小訊號線性化 $E[q\mid e]\approx K_qe$，$K_q=\sqrt{2/\pi}/\sigma_v$，需 $\lvert e\rvert\ll\sigma_v$ | §3 |
| A5 | 折返：$x$ 零均值；Gaussian–Isserlis 需 $x$ Gaussian；精確式需 $x=\sum_kh_ku[n-k]$、$u$ iid（MASH：$u=s_3/M$ 視為 iid uniform，frac 遠離有理數） | §2 |
| A6 | 帶內功率 $P_\mathrm{in}=S(0)\cdot2\nu_B$ 需 $\nu_B=f_B/f_s\ll1$（折返後的 PSD 在帶內平坦） | §2 |
| A7 | uniform 的封閉式（$\lambda_k$、Hankel、LUT 近似誤差）只對 $x\sim U(-1,1)$；其他分布用樣本 $\mathbf R$ | §3 |
| A8 | mean-field 的穩態變異 $\operatorname{Var}(\xi_i)=\mu^2\lambda_i/(N(1-p_i^2))$ 需近平衡（misadjustment 小）；MC 後半段的樣本 std 在 $\tau\gtrsim$ 視窗長度時偏低 | §3 |

## 1. 誤差模型與 gain 校正後的殘餘

DTC 的延遲：$\tau_\mathrm{DTC}[n]=T_0-w\,x[n]-c(x[n])+d(x[n])$，$c(x)=\sum_{i=1}^P\theta_i\varphi_i(x)$ 是 INL 校正的補償量，$d(x)$ 是 INL（多延遲為正）。reference edge 的時間 $t_\mathrm{ref}'=\tau_\mathrm{DTC}$，feedback edge 早到 $a\,x$（$t_\mathrm{fb}=-a\,x$），PD 量 $t_\mathrm{ref}'-t_\mathrm{fb}$：

$$
e[n]=(a-w)\,x[n]+b+d(x[n])-c(x[n])+v[n]\qquad\text{【精確｜指定模型】（F-11B.1）}
$$

**gain 校正後的殘餘**（$d=d_2x^2+d_3x^3$）：gain 校正停在 $w^*-a=E[x\,d]/E[x^2]$（Ch11 F-11.4）。

- Gaussian $x$：$E[x^3]=0$、$E[x^4]=3\sigma^4$ ⇒ $w^*-a=3d_3\sigma^2$；殘餘 $r=d-(w^*-a)x-E[d]=d_2(x^2-\sigma^2)+d_3(x^3-3\sigma^2x)=d_2\sigma^2\mathrm{He}_2+d_3\sigma^3\mathrm{He}_3$，$E[r^2]=2d_2^2\sigma^4+6d_3^2\sigma^6$（Hermite 正交 $E[\mathrm{He}_p\mathrm{He}_q]=p!\delta_{pq}$）。【近似｜需驗證】（F-11B.2）
- uniform $x$：$E[x^2]=\tfrac13$、$E[x^4]=\tfrac15$、$E[x^6]=\tfrac17$ ⇒ $w^*-a=\tfrac35d_3$，$E[r^2]=d_2^2(\tfrac15-\tfrac19)+d_3^2(\tfrac17-2\cdot\tfrac35\cdot\tfrac15+\tfrac9{25}\cdot\tfrac13)=\tfrac{4d_2^2}{45}+\tfrac{4d_3^2}{175}$。【精確｜指定模型】（`uniformResidualAfterGain`）

二次 INL 與 $x$ 正交：gain 校正對它完全沒有作用。

## 2. 噪聲折返

### 2.1 Gaussian–Isserlis

零均值 Gaussian 平穩序列 $x$、自相關 $R_x[m]$。令 $y=x^2-\sigma^2$：

$$
R_y[m]=E[x_n^2x_{n+m}^2]-\sigma^4=(\sigma^4+2R_x[m]^2)-\sigma^4=2R_x[m]^2
$$

（Isserlis：四個變數的期望值拆成三種配對 $R[0]^2+R[m]^2+R[m]^2$）。DC 的 PSD 是自相關的總和：

$$
S_y(0)=\sum_mR_y[m]=2\sum_{m=-\infty}^{\infty}R_x[m]^2=2\int_{-1/2}^{1/2}S_x(\nu)^2d\nu
$$

$S_x(0)=0$（整形）不代表 $S_y(0)=0$：只要 $S_x$ 任何地方非零就折返。一般的 Hermite 分量（Mehler）：$R_{\mathrm{He}_p}[m]=p!\,R_x[m]^p$ ⇒ $S_{\mathrm{He}_p}(0)=p!\sum_mR_x[m]^p$。【近似｜需驗證】（F-11B.3）

### 2.2 MASH 1-1-1 的自相關

`dsm.ts`：$r=-(1-z^{-1})^2u$，$u=s_3/M$。A5 下 $u$ iid uniform(0,1)，$\sigma_u^2=1/12$；FIR 係數 $[1,-2,1]$ 的自相關 $[6,-4,1]$ ⇒ $R_r=\tfrac1{12}[6,-4,1]$，$\sigma_r^2=\tfrac12$。正規化 $x=r/2$：$R_x=\tfrac1{48}[6,-4,1]$，$\sigma_x^2=\tfrac18$，$h=[-\tfrac12,1,-\tfrac12]$。

$$
\sum_mR_x[m]^2=\frac{6^2+2\cdot4^2+2\cdot1^2}{48^2}=\frac{70}{2304},\qquad S_2^\mathrm{Gauss}(0)=\frac{35}{576},\qquad S_3^\mathrm{Gauss}(0)=6\cdot\frac{216-128+2}{48^3}=\frac{5}{1024}
$$

【近似｜需驗證】（F-11B.4；A5 的白色假設）

### 2.3 線性過程的精確式（非 Gaussian 修正）

$x=\sum_kh_ku[n-k]$、$u$ iid、四階累積量 $\kappa_4$：$\operatorname{cum}(x_n,x_n,x_{n+m},x_{n+m})=\kappa_4\sum_kh_k^2h_{k+m}^2$，所以

$$
\operatorname{Cov}(x_n^2,x_{n+m}^2)=2R_x[m]^2+\kappa_4\sum_kh_k^2h_{k+m}^2,\qquad
S_2(0)=2\sum_mR_x[m]^2+\kappa_4\Big(\sum_kh_k^2\Big)^2
$$

uniform(0,1)：$E[(u-\tfrac12)^4]=\tfrac1{80}$、$\kappa_4=\tfrac1{80}-\tfrac3{144}=-\tfrac1{120}$；$\sum h^2=\tfrac32$、$(\sum h^2)^2=\tfrac94$ ⇒ $S_2(0)=\tfrac{35}{576}-\tfrac3{160}=\tfrac{121}{2880}$。總功率（$m=0$ 項）：$\operatorname{Var}(x^2)=2\sigma^4+\kappa_4\sum_kh_k^4=\tfrac1{32}-\tfrac{9/8}{120}=0.021875$。【精確｜指定模型】（F-11B.5；golden 以 2M 樣本的 MA(2) 驗證 ±3%，真的跑 MASH 的 Welch 積分 ±8%）

Gaussian 式對 MASH 高估 $\tfrac{35/576}{121/2880}=1.446$（code 的峰度約 2.4）；uniform iid 的 code：精確 $\operatorname{Var}(x^2)=\tfrac15-\tfrac19=\tfrac4{45}$，Gaussian 式 $2\sigma^4=\tfrac29$ 高估 2.5 倍。三次項（$\mathrm{He}_3$）與鋸齒沒有寫出累積量修正，實驗 A 顯示 MASH 下三次項「量測／Gaussian」約 0.5。【研究假說】

### 2.4 帶內功率

A6 下 $P_\mathrm{in}\approx S(0)\cdot2\nu_B$，one-sided per-Hz $S^{(1)}=2S(0)/f_s$（Ch12 F-12.10、勘誤 E28）。例：$d_2=20$ t.u.、$\nu_B=0.01$：Gaussian $400\cdot\tfrac{35}{576}\cdot0.02=0.4861$，精確 $400\cdot\tfrac{121}{2880}\cdot0.02=0.3361$ t.u.²（rms 0.580），占殘餘總功率 $8.75$ 的 3.84%。$x$ 自己在帶內的功率是 $\int_{-\nu_B}^{\nu_B}\tfrac{16\sin^4\pi\nu}{48}d\nu=O(\nu_B^5)\approx\tfrac{2\pi^4}{15}\nu_B^5$（$\nu_B=0.01$ 時約 $1.3\times10^{-9}$）。【近似｜需驗證】（F-11B.6）

## 3. 三種校正結構的 LMS

### 3.1 多參數 block LMS 的 mean-field

$\boldsymbol\vartheta_{b+1}=\boldsymbol\vartheta_b+\mu\mathbf M\mathbf G_b$，$\mathbf G_b=\tfrac1N\sum_nq[n]\boldsymbol\psi[n]$。A4：$E[q\mid x]\approx K_qe_\mathrm{det}$，$e_\mathrm{det}=\boldsymbol\psi^T(\boldsymbol\vartheta^*-\boldsymbol\vartheta)+r(x)$，$E[\boldsymbol\psi r]=\mathbf0$（LS 殘差正交）⇒ $E[\mathbf G]=K_q\mathbf R(\boldsymbol\vartheta^*-\boldsymbol\vartheta)$，$\boldsymbol\delta_{b+1}=(\mathbf I-\mu K_q\mathbf M\mathbf R)\boldsymbol\delta_b$。scalar（$\mathbf M=\mathbf I$）：pole $1-\mu K_q\lambda_i$，$k_{95,i}=\lceil\ln0.05/\ln p_i\rceil$。MSE-LMS：$K_q=1$。【近似｜需驗證】（F-11B.7）

### 3.2 分段線性

$\varphi_k=\mathbb 1_k(x)x$ ⇒ $\mathbf R=\operatorname{diag}(\lambda_k)$，$\lambda_k=E[x^2\mathbb 1_k]$；uniform：$\lambda_k=(x_{k+1}^3-x_k^3)/6$，$\sum_k\lambda_k=\tfrac13$。$K=8$：$\lambda_8=(1-0.75^3)/6=0.096354$、$\lambda_5=0.25^3/6=0.0026042$，比 37。$\mu=2$、$\sigma_v=10$、$N=64$：$K_q=0.0797885$，$g_8=0.015376$，$k_{95}=194$，$\sigma_{w_8}=0.4442$；第 5 段 $k_{95}=7208$。【精確｜指定模型】（F-11B.8；`dtc_inl_segments.json`）

### 3.3 LUT

$\varphi_j=\mathbb 1_j$ ⇒ $\lambda_j=p_j$（uniform $1/J$）；$\tau_j=J/(\mu K_q)$；一個 $\tau_j$ 內每格看到 $N\tau_jp_j=N/(\mu K_q)$ 個樣本（與 $J$ 無關）；有效平均長度 $n_\mathrm{eff}=1/(K_q^2\operatorname{Var}(\theta_j))\approx2N/(\mu K_q)$。$J=64$：$\tau_j=401.06$ blocks、$k_{95}=1200$、每格每 $\tau$ 401 個樣本、$n_\mathrm{eff}=802$、$\sigma_\theta=0.4428$。【精確｜指定模型】（F-11B.9）

近似誤差：格內 $d(x)-\theta_j^*\approx d'(\bar x_j)(x-\bar x_j)$，$E[(x-\bar x_j)^2\mid j]=\Delta^2/12$ ⇒ $\text{floor}^2=E[d'^2]\Delta^2/12$，$E[d'^2]=\tfrac{4d_2^2}{3}+\tfrac{9d_3^2}{5}$。$d_2=20$：$J=8$ 為 1.667、$J=64$ 為 0.2083（golden 對 200k 格點直接計算 ±1%）。【近似｜需驗證】（F-11B.13）

### 3.4 穩態變異與 misadjustment

$\mathbf G_b=K_q\mathbf R(\boldsymbol\vartheta^*-\boldsymbol\vartheta_b)+\boldsymbol\eta_b$，Sign：$\operatorname{Cov}(\boldsymbol\eta)=E[q^2\boldsymbol\psi\boldsymbol\psi^T]/N=\mathbf R/N$（MSE 乘 $\sigma_v^2+\text{floor}^2$）。模式座標 $\xi_i=\mathbf v_i^T\boldsymbol\delta$：一階遞迴 ⇒ $\operatorname{Var}(\xi_i)=\mu^2\lambda_i/(N(1-p_i^2))\approx\mu/(2K_qN)$（$g_i\ll1$，與 $\lambda_i$ 無關）；$E[r^2]_\infty=\text{floor}^2+\sum_i\lambda_i\operatorname{Var}(\xi_i)$。【近似｜需驗證】（F-11B.10；TS 的 MC 對預測 ±20–25%，Python 的 LUT Sign-LMS ±25%）

### 3.5 多項式基底與條件數

monomial：$R_{mn}=E[x^{m+n}]=1/(m+n+1)$（$m+n$ 偶）。$M=3$ 拆成偶 $\begin{bmatrix}1&\tfrac13\\\tfrac13&\tfrac15\end{bmatrix}$ 與奇 $\begin{bmatrix}\tfrac13&\tfrac15\\\tfrac15&\tfrac17\end{bmatrix}$ 分塊，2×2 特徵值 $(\operatorname{tr}\pm\sqrt{\operatorname{tr}^2-4\det})/2$：$1.1207,\ 0.0793$ 與 $0.4596,\ 0.01658$ ⇒ $\kappa=67.60$（4×4 Jacobi 直接算也是 67.60）。Legendre：$E[P_mP_n]=\delta_{mn}/(2m+1)$ ⇒ $\kappa=7$；normalized $\sqrt{2m+1}P_m$ ⇒ $\mathbf R=\mathbf I$；Chebyshev 在 uniform 權重下不正交，$\kappa=5.94$。同一個 $d=20x^2+10x^3$、$\mu K_q\lambda_{\max}=0.1$ 的 mean-field $k_{95}$：560／131／29／125 blocks（`dtc_inl_basis.json`）。preconditioner $\mathbf M=(\gamma/K_q)\mathbf R^{-1}$ ⇒ 所有 pole $1-\gamma$；對角版在 $\mathbf R$ 對角時等價（分段／LUT 的「每段自己的 $\mu_k$」），misadjustment 變成 $P\gamma/(K_q^2N(2-\gamma))$。【精確｜指定模型】（F-11B.11、F-11B.14）

## 4. 可辨識性

- **缺乏樣本**：$\lambda_k\propto$ 段內 regressor 功率；MASH 的 $x$ 集中在 $\lvert x\rvert\lesssim0.6$，$K=8$ 外側段的 $p_k$ 千分之幾；frac 接近有理數（0.3 ⇒ $r\bmod1$ 只有 10 個值）時 LUT 有永遠空的格（$\lambda=0$，pole 恰為 1：不可辨識，不是發散）。修法：等機率分段、只校正有樣本的範圍、訓練序列（Ch09 PE）。
- **Gauge**：$\sum_k\mathbb 1_kx=x$ ⇒ 分段（或含 $x$ 項的多項式）與 gain $w$ 同時校正時 $\mathbf R_{[x,\varphi]}[1,-\mathbf 1]^T=\mathbf 0$，奇異；LUT 的 $\sum_j\mathbb 1_j=1$ 與 PD offset $b$ 共線，與 $x$ 只是幾乎共線（$x\ne\sum\bar x_j\mathbb 1_j$，$J=16$ 時 $\kappa\approx1.9\times10^3$）。總補償量仍唯一（殘餘照樣收斂），個別參數沿 null 方向隨機漫步（Ch09 F-09.19）。修法：凍結 $w$ 再開 INL 校正、LUT 減平均、多項式從 $m=2$ 起。【精確｜指定模型】（F-11B.12）

## 5. 驗證方式與數字來源

| 數字 | 來源 | 驗證 |
|---|---|---|
| $35/576$、$5/1024$、$121/2880$、$-1/120$、$4/45$ | `dtc_inl.py` 分數 | `test_S11b_*` 以 `Fraction` 精確核對；TS `dtcInl.test.ts` rel 1e-12 |
| MASH Welch 帶內功率 | `mash111_residue`（Python，與 `dsm.ts` 同一個 MASH）+ SciPy Welch；TS `foldingAnalysis` | 兩邊各對精確式 ±8% |
| $\lambda_k$、$k_{95}$、$\sigma_w$、LUT 封閉式 | `segment_closed_form`／`lut_closed_form` | vectors rel 1e-12，整數 $k_{95}$ 完全相同 |
| Hankel／Legendre／Chebyshev 的 $\mathbf R$、$\kappa$、$k_{95}$ | numpy.polynomial 精確積分；TS Simpson 2000 格 | rel 1e-9；$\theta^*$ abs 1e-9 |
| MC 收斂與穩態 | TS `simulateInlLms`（seed 固定）；Python `simulate_lut_sign_lms` | 各自對 mean-field + misadjustment（不跨語言比 MC，RNG 不同） |

未做：三次項與鋸齒的折返封閉式、時變 INL 的追蹤、定點 LUT、主迴路 DC null 下的 gauge（只在文字中說明）、hat 函數（連續 piecewise-linear）的結構。
