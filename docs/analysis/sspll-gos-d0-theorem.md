# GOS 在 $D=0$ 不反號：從猜想到定理（案例頁 §7b 的推導全文）

> 補充 `docs/analysis/sspll-gos-phos-polarity.md` §7.2 與 §19 第 1 條（2026-10-19）。那份文件把「$D=0$、raw regressor、線性化之下 GOS 對任何 $\alpha$ 都不反號」列為**研究假說**（11 個迴路、每個 152,096 個有理 $\beta$、0 個反例，但沒有一般證明）。本文把它補成定理：L1 一行證完；L2／L3 給出可計算的證書，在 $\beta\in[\beta_0,1-\beta_0]$ 上成立（$\beta_0=0.016$，golden 以更大的 $M$ 推到 $2^{-10}$）；只剩 $\beta<\beta_0$ 用既有的漸近式收尾，標成近似。
>
> **數字來源**：`analysis/sspll/golden/sspll_golden/gos_certificate.py`（`tools/gos_certificate.py` → `results/gos_certificate.json`；`test_sspll_gos_certificate.py` 9 個測試）。TS port 在 `src/pages/case-sspll/gosTheorem.ts`，`gosTheorem.test.ts` 逐項與 JSON 比對到 $10^{-9}$。頁面上的數字由 TS port 即時算出。
>
> **結論標籤**：【精確｜指定模型】＝在所述模型內數學上成立（含電腦輔助的不等式，浮點誤差 $\sim10^{-13}$ 遠小於最小的下界）；【近似｜需驗證】＝漸近式加數值檢查，不是證明。

## 0. 模型與要證的命題

與主文件 §4、§7 相同：線性小訊號 PLL（$H_{PD}=1/(1+L)$，LTI、穩定、$L$ 嚴格 proper）、相關器延遲 $D=0$、raw regressor、凍結權重（時間尺度分離）。GOS 的 regressor 是鋸齒 $\rho[n]=\mathrm{frac}(n\beta)$，$\beta=\mathrm{frac}(8\alpha)$。sign-error LMS 對 GOS 權重的平均斜率是諧波和（主文件 F-CS.11）：

$$
C(\beta)=\sum_{m\ge1}w_m\,g\big(\mathrm{frac}(m\beta)\big),\qquad w_m=\frac{1}{2\pi^2m^2},\qquad g(f)\equiv\mathrm{Re}\,H_{PD}(e^{j2\pi f}).
$$

**要證**：$C(\beta)>0$ 對所有 $\beta\in(0,1)$（$\beta=0$ 時 $\rho\equiv0$，GOS 不可觀測，不在命題內）。

兩個馬上用得到的性質：

1. $g$ 以 1 為週期、是偶函數（$h_{PD}$ 為實數）：$g(f)=\sum_{n\ge0}h_{PD}[n]\cos(2\pi fn)$。
2. $C(\beta)=C(1-\beta)$：$\mathrm{frac}(m(1-\beta))=1-\mathrm{frac}(m\beta)$（或 0），而 $g(1-f)=g(f)$。所以只要證 $\beta\in(0,\tfrac12]$。

有理數 $\beta=a/b$ 時這個和等於主文件的精確週期式 $\sum_{k=1}^{b-1}g(k/b)/(4b^2\sin^2(\pi k/b))$（$\sum_{m\equiv\pm k\,(b)}1/m^2=(\pi/b)^2/\sin^2(\pi k/b)$），所以命題對有理與無理 $\beta$ 都是同一個式子。【精確｜指定模型】

## 1. L1：一行證明

主文件 §6.1 的 closed form（F-CS.7）：

$$
\mathrm{Re}\,H_{PD}(f)=\frac{(2-K)(1-\cos2\pi f)}{\lvert1-(1-K)e^{-j2\pi f}\rvert^2}\ \ge0\quad(0<K<2),
$$

等號只在 $f\in\mathbb Z$。於是

$$
C(\beta)=\sum_{m\ge1}\underbrace{w_m}_{>0}\underbrace{\mathrm{Re}\,H_{PD}(\mathrm{frac}(m\beta))}_{\ge0}\ \ge\ w_1\,\mathrm{Re}\,H_{PD}(\beta)>0\qquad(\beta\notin\mathbb Z).
$$

1. 分子是兩個非負數的積，分母是模的平方。
2. 非負項的和不小於其中任何一項；$\beta\notin\mathbb Z$ 時第一項嚴格為正。

這就是主文件 §9 PSD 定理（$\mathrm{Re}\,\Gamma_{\rm eff}\ge0$ 處處成立 ⇒ 所有特徵值的實部 $\ge0$）在單一 regressor 上的樣子，只是這裡多了「嚴格大於 0」。L1 加延遲 $d\ge5$ 或 200 MHz 寄生極點之後有反號帶（§6.1 的表），一行證明就不再適用，要走 §2 的證書（golden 對這兩個變形也跑了，都通過）。【精確｜指定模型】（F-CS.24；`typeI_positive`／`gosTypeIPositive`）

## 2. L2、L3：可計算的證書

$g$ 在 $0<f<f_{inv}$ 為負（L2：0–134.82 MHz，谷底 $-0.2053$ 在 83.8 MHz），諧波和有正有負，必須算。無限多個 $\beta$、無限多項，靠三個零件變成有限的工作。

### 2.1 零件 (1)：$g$ 的 Lipschitz 常數

$$
\begin{aligned}
g(f)&=\sum_{n\ge0}h_{PD}[n]\cos(2\pi fn) && \text{(1)}\\
g'(f)&=-2\pi\sum_{n\ge1}n\,h_{PD}[n]\sin(2\pi fn) && \text{(2)}\\
\lvert g'(f)\rvert&\le2\pi\sum_{n\ge1}n\,\lvert h_{PD}[n]\rvert\equiv L_g && \text{(3)}
\end{aligned}
$$

1. 頻率響應是脈衝響應的 Fourier 級數；迴路穩定所以 $\sum\lvert h\rvert<\infty$，取實部得餘弦級數。
2. 逐項微分（$\sum n\lvert h[n]\rvert<\infty$，幾何衰減，所以可以）。
3. 三角不等式、$\lvert\sin\rvert\le1$。

前 $N$ 項直接把脈衝響應遞迴出來相加；$n>N$ 的尾項用極點的留數展開壓住：$H_{PD}(z)=B(z)/A(z)$（$z$ 的多項式，極點 $\lambda_i$ 單根、不在原點）時 $h[n]=\sum_ic_i\lambda_i^n$（$n\ge1$），$c_i=B(\lambda_i)/(\lambda_iA'(\lambda_i))$，於是

$$
\sum_{n>N}n\,\lvert h[n]\rvert\le\sum_i\lvert c_i\rvert\sum_{n>N}n\rho_i^n=\sum_i\lvert c_i\rvert\,\frac{\rho_i^{N+1}\big((N+1)(1-\rho_i)+\rho_i\big)}{(1-\rho_i)^2},\qquad\rho_i=\lvert\lambda_i\rvert<1 .
$$

程式先用留數展開重現 $h[n]$（$1\le n<60$）並與遞迴比對（差 $<10^{-10}$），對不上（重根、原點極點）就回報「尾項無法壓住」、證書拒絕給出結論。$N=4096$ 時三個標稱迴路的尾項都 $<10^{-30}$。數字：L1 $L_g=16.159$、L2 $49.0885$、L3 $50.9714$；細格點差分量到的最大斜率在 $0.3L_g$ 與 $L_g$ 之間（`test_SSPLL_gos_theorem_lipschitz_is_a_bound`）。

### 2.2 零件 (2)：截斷和對 $\beta$ 的 Lipschitz 常數

$$
C_M(\beta)\equiv\sum_{m=1}^{M}w_m\,g(m\beta)
$$

（用週期性把 $\mathrm{frac}$ 拿掉；wrap 的瞬間 $g(1)=g(0)$，所以 $\beta\mapsto g(m\beta)$ 連續且斜率 $\le mL_g$）。

$$
\lvert C_M(\beta)-C_M(\beta')\rvert\le\sum_{m\le M}w_m\,mL_g\,\lvert\beta-\beta'\rvert=\frac{L_g}{2\pi^2}\Big(\sum_{m\le M}\frac1m\Big)\lvert\beta-\beta'\rvert\equiv\Lambda_M\lvert\beta-\beta'\rvert,\qquad\Lambda_M=\frac{L_gH_M}{2\pi^2}.
$$

$H_M$ 是調和數。注意完整的和沒有 Lipschitz 常數（$\sum 1/m$ 發散），所以一定要截斷。L2、$M=1000$：$H_M=7.4855$、$\Lambda_M=18.615$。

### 2.3 零件 (3)：尾項的下界

$$
\sum_{m>M}w_m\,g(\mathrm{frac}(m\beta))\ \ge\ g_{\min}\,T_M,\qquad T_M=\sum_{m>M}w_m=\frac{\zeta(2,M+1)}{2\pi^2}\le\frac{1}{2\pi^2M},\qquad g_{\min}\le\min_fg(f).
$$

$g_{\min}$ 的取法：在 $f_j=j/(2(n_f-1))$（$n_f=200001$）上取最小值，再減 $L_gh/2$（任何 $f$ 離某個格點不超過 $h/2$，零件 (1) 保證 $g$ 在這段內最多掉 $L_gh/2$），只取 $\le0$ 的部分。L2：格點最小值 $-0.20529$（83.8 MHz），$g_{\min}=-0.20536$，$T_{1000}=5.06\times10^{-5}$，尾項最多扣 $1.04\times10^{-5}$。

### 2.4 一步

在格點 $\beta_i$：

$$
\mathrm{LB}_i\equiv C_M(\beta_i)+g_{\min}T_M\ \le\ C(\beta_i).
$$

若 $\mathrm{LB}_i>0$，則對 $\beta\in[\beta_i,\beta_i+\mathrm{LB}_i/\Lambda_M]$：

$$
C(\beta)\ \ge\ C_M(\beta)+g_{\min}T_M\ \ge\ C_M(\beta_i)-\Lambda_M\lvert\beta-\beta_i\rvert+g_{\min}T_M=\mathrm{LB}_i-\Lambda_M\lvert\beta-\beta_i\rvert\ >0
$$

（最後一個不等式在區間內部嚴格成立；右端點 $\beta_{i+1}$ 由下一步直接重算）。

### 2.5 走完整段

$\beta_{i+1}=\beta_i+\mathrm{LB}_i/\Lambda_M$，從 $\beta_0$ 走到 $\tfrac12$（終點也直接算一次）。每一步都 $\mathrm{LB}_i>0$ ⇒ $C(\beta)>0$ 於 $[\beta_0,\tfrac12]$，再由對稱性得 $[\beta_0,1-\beta_0]$。步數約 $\int_{\beta_0}^{1/2}\Lambda_M\,d\beta/C(\beta)$；near-grid 的 $C\approx\beta^2/K_i$ 讓步數 $\approx K_i\Lambda_M(1/\beta_0-2)$，$\beta_0$ 減半步數加倍，而尾項 $\lvert g_{\min}\rvert T_M$ 必須小於 $\beta_0^2/K_i$，所以 $M$ 要乘 4——這就是 $\beta\to0$ 永遠要靠漸近式收尾的原因。

### 2.6 結果

| 迴路（`results/gos_certificate.json`） | $L_g$ | $g_{\min}$ | $\Lambda_{1000}$ | 步數 | 最小 $\mathrm{LB}$（在 $\beta$） | $12\,\mathrm{LB}$ |
|---|---|---|---|---|---|---|
| L1 | 16.159 | $-2.0\times10^{-5}$ | 6.128 | 39 | $1.916\times10^{-2}$（0.016） | 0.230 |
| L2 | 49.089 | $-0.20536$ | 18.615 | 126 | $6.628\times10^{-3}$（0.016） | 0.0795 |
| L3 | 50.971 | $-0.16167$ | 19.329 | 122 | $1.023\times10^{-2}$（0.016） | 0.123 |
| L2 PM 45° | 84.528 | $-0.38546$ | 32.055 | 240 | $4.320\times10^{-3}$ | 0.0518 |
| L2 PM 75° | 36.572 | $-0.05288$ | 13.869 | 87 | $1.573\times10^{-2}$ | 0.189 |
| L2 延遲 2 拍 | 58.607 | $-0.09991$ | 22.225 | 132 | $2.174\times10^{-2}$ | 0.261 |
| L3 PM 45°／55°／halfT | 70.01／55.76／60.89 | $-0.284$／$-0.195$／$-0.180$ | 26.55／21.14／23.09 | 174／134／142 | $7.35\times10^{-3}$／$9.21\times10^{-3}$／$1.18\times10^{-2}$ | 0.088／0.110／0.142 |
| L1 延遲 5（有反號帶） | 516.30 | $-0.01688$ | 195.79 | 1168 | $3.443\times10^{-2}$ | 0.413 |
| L1 + 200 MHz 極點（有反號帶） | 69.20 | $-0.02271$ | 26.24 | 159 | $1.917\times10^{-2}$ | 0.230 |

全部 11 個迴路（就是主文件 §7.2 密集掃描的迴路）在 $\beta\in[0.016,\tfrac12]$ 上通過；最小的下界都在 $\beta_0$（Type-II 的 near-grid dead zone）。延伸：L2 以 $M=16000$ 從 $\beta_0=2^{-10}$ 走到 $\tfrac12$，1168 步，最小 $\mathrm{LB}=2.11\times10^{-5}$（$\approx\beta_0^2/K_i=2.49\times10^{-5}$ 減尾項）；L3 822 步、$3.48\times10^{-5}$。【精確｜指定模型】（F-CS.25；`certificate`／`gosCertificate`）

### 2.7 證書失敗不是反例

$\mathrm{LB}_i\le0$ 只表示截斷太短或步長不夠（例如把 $\beta_0$ 設成 $10^{-3}$ 卻只用 $M=1000$：尾項 $1.04\times10^{-5}$ 已經比 $\beta_0^2/K_i=2.6\times10^{-5}$ 的一半大，第一個格點就失敗）。真的反例會在精確的有理數掃描（`gosConjectureScan`）裡以負值出現。負面測試：相關器晚一拍（$D=1$）的 kernel $\mathrm{Re}\,\Gamma_{\rm eff}$ 在 $\beta=1/64$ 的精確值為負，同一套零件的單點下界為負，證書在第一步就報失敗（`test_SSPLL_gos_theorem_certificate_fails_honestly_for_D1`）。

### 2.8 浮點與「精確」

證書裡的每一個量都是有限個浮點運算的結果：$C_M$（最多 16000 項的和，相對誤差 $\sim10^{-13}$）、$g_{\min}$、$L_g$、$T_M$。最小的 $\mathrm{LB}$ 是 $2\times10^{-5}$（延伸）或 $6.6\times10^{-3}$（標稱），比浮點誤差大 $10^{8}$ 倍以上；真正嚴格的區間算術不會改變結論。TS 與 Python 兩套實作用不同的加總順序，結果相同到 $10^{-9}$（步數差 $\le2$）。

## 3. $\beta<\beta_0$：漸近式收尾（近似）

主文件 §7.2 的慢鋸齒展開：$C\approx\frac\beta2(S_\infty-2S_D)-\beta^2\sum_mm\,s[m]$；Type-II、$D=0$ 時 $S_\infty=S_D=0$，$C\approx\beta^2/K_i>0$。推導只留 $\beta$ 的前兩階、沒有誤差項的界限，所以是近似。數值檢查（精確的有理數式 ÷ 漸近式，L2）：

| $\beta$ | $1/64$ | $1/128$ | $1/256$ | $1/512$ | $1/1000$ |
|---|---|---|---|---|---|
| 比值 $C/(\beta^2/K_i)$ | 0.99959 | 1.00000 | 1.00000 | 1.00000 | 1.00000 |

【近似｜需驗證】（`test_SSPLL_gos_theorem_small_beta_asymptote_ratio`）。主文件 §19 第 1 條因此改讀成：「$\beta\in[\beta_0,1-\beta_0]$ 上是定理；$\beta<\beta_0$ 仍只有漸近式與數值，$\beta_0$ 隨 $M$ 可以往下推。」

## 4. 手算（HC-CS.10）：單點證書

同一套零件在一個 $\beta$ 上、只用前 4 條諧波，紙筆就做得到（L2、$\beta=0.25$）：

| 步驟 | 式子 | 數字 |
|---|---|---|
| 折回的頻率 | $f_m=\mathrm{frac}(m\beta)$ | $0.25,\,0.5,\,0.75,\,0$ |
| 各項 | $w_mg_m=\frac{g_m}{2\pi^2m^2}$，$g_m=\mathrm{Re}\,H_{PD}(f_m)$（§6.4 的表：1000 MHz 1.16044、2000 MHz 1.18123；$f=0$ 給 0） | $0.058789,\,0.014960,\,0.006532,\,0$ |
| 截斷和 | $C_4$ | $0.080281$ |
| 尾項權重 | $T_4=\big(\pi^2/6-(1+\tfrac14+\tfrac19+\tfrac1{16})\big)/(2\pi^2)$ | $0.0112124$ |
| 尾項下界 | $g_{\min}T_4=-0.20536\times0.0112124$ | $-0.0023025$ |
| 下界 | $\mathrm{LB}=C_4+g_{\min}T_4$ | $0.077979$（$12\,\mathrm{LB}=0.9357$） |
| Lipschitz | $\Lambda_4=L_gH_4/(2\pi^2)=49.0885\times2.08333/19.7392$ | $5.18094$ |
| 一步 | $\delta=\mathrm{LB}/\Lambda_4$ | $0.015051$ |

所以 $C_{GOS}>0$ 於 $[0.235,0.265]$；完整證書只是把這件事從 $\beta_0$ 做到 $\tfrac12$，每一步換下一個 $\beta$ 重算。

## 5. 檔案

| 檔案 | 內容 |
|---|---|
| `analysis/sspll/golden/sspll_golden/gos_certificate.py` | 零件與證書（`#region core:` typeI_positive、lipschitz、certificate） |
| `analysis/sspll/golden/tools/gos_certificate.py` | 11 個迴路 + 延伸 + 單點 + 漸近比值 → `results/gos_certificate.json` |
| `analysis/sspll/golden/test_sspll_gos_certificate.py` | 9 個 `test_SSPLL_gos_theorem_*` |
| `src/pages/case-sspll/gosTheorem.ts`、`gosTheorem.test.ts` | TS port 與 golden 比對 |
| `src/pages/case-sspll/sections/S07bTheorem.tsx` | 頁面 §7b（F-CS.24、F-CS.25、HC-CS.10、圖 CS「gos-theorem」） |
