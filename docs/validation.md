# Validation：規格書驗算與勘誤紀錄

> 依規格 §21 主 Prompt：「若有推導不一致、數值錯誤、單位衝突或不適用的穩定性聲明，先列出問題並修正，在 docs/validation.md 留下修正紀錄。不要為了迎合文件而保留錯誤公式。」

## 方法

- 9 個稽核 agent 依章節分工，以 Python（NumPy 2.4 / SciPy 1.17）獨立重算規格書中**每一個**公式、數值、表格與穩定性聲明，共 **237** 項。
- 每個稽核者回報的問題，再由一個獨立的懷疑者 agent 重新推導、嘗試反駁；只有反駁失敗的問題才列為勘誤。
- 結果：確認 **49** 項勘誤（high 2、medium 14、low 33）；9 項被反駁（列於文末）。
- **核心結論**：規格書的 T01–T18 參考值在其「指定模型」下大多正確；主要問題在於定義不完整（tie rule、Noise BW 定義、K_q 正規化、sign(0)）、符號衝突（δ 極性、u、c、**C**、λ）、以及適用條件沒寫清楚（MSE vs Sign-LMS 的固定點、PLL DC null、multirate PSD）。網站一律以本文件的修正版本為準，並在對應公式旁以勘誤編號標示。

## 勘誤總表

| 編號 | 嚴重度 | 範圍 | 位置（摘要） |
|---|---|---|---|
| E01 | high | §11 Bias / INL | §11.2「e=(a-w)x+cx³ … w*=a+cE[x⁴]/E[x²]=1.34」與「單係數 LMS 的最佳擬合 Gain 是 1.34」；§17 T12；§19.2 Pre… |
| E02 | high | §5 Comparator | §5，公式「P(G_N>0)≈Φ(m√N/√(1−m²))」及表格「正確辨識固定正 Error 方向的近似機率」的 N=100 / 1,000 / 10,000 三列 |
| E03 | medium | §11 Bias / INL | §11 開頭「在本段假設 PLL 動態已吸收到誤差路徑；先用靜態表達」及 boxed w*；§11.1 w*=a+bE[x]/E[x²] |
| E04 | medium | §9–10 PE / MIMO | §9.2「PLL DC Error Suppression 可能使 Common-Mode 更難觀察」及「處理方式：固定一個 Phase 當 Reference、強制 Σa_i=0… |
| E05 | medium | §9–10 PE / MIMO | §10.1「一般 LMS μ=0.5 的慢模式 Pole 為 0.995（約 598 次）；取 M=0.5R^{-1} 時，所有模式 Pole 為 0.5」 |
| E06 | medium | §12 Noise / Spur | §12.1 示例「校正 Noise BW 約 12.9 kHz（近似）」與 §17 T14「Noise BW 約 12.9 kHz」 |
| E07 | medium | 全文符號與單位一致性 | §5「對 G_N=Σ_{i=1}^N q_i…P(G_N>0)」及表格；§0「q[n]=sign(e[n])」；§15.2「q=+1.0 if e>=0」 |
| E08 | medium | 全文符號與單位一致性 | §10.1「一般 LMS μ=0.5 的慢模式 Pole 為 0.995…取 M=0.5R⁻¹ 時，所有模式 Pole 為 0.5…反矩陣元素約 ±25」 |
| E09 | medium | 全文符號與單位一致性 | §12.2「δt[n]=x[n]δw[n]」及「S_δt(e^{jΩ})=(1/2π)∫S_x(e^{jν})S_w(e^{j(Ω−ν)})dν」；附錄 A 同列 |
| E10 | medium | 全文符號與單位一致性 | §12.1「校正 Noise BW 約 12.9 kHz（近似）」；§12「f_cal,BW≈(1−p)/(2π)f_u≈(−ln p)/(2π)f_u」；T14「Noise BW… |
| E11 | medium | 全文符號與單位一致性 | §19.2 preset 7「a=1,c_3=.1：三階 INL，最佳線性 Gain 1.34」；§11.2 用 c、T12 用 c |
| E12 | medium | 全文符號與單位一致性 | §11「e[n]=(a−w)x[n]+b+d(x[n])+u[n]+v[n]」；§11.3「若 u[n]=cx[n]」；§11.4「w*=a+B/C」 |
| E13 | medium | 全文符號與單位一致性 | §0 表 u 列「和 PD Error 單位一致」；§8.2/§12/§14.1/附錄 A 的 K；§12.1「μ=10 fs」；§8.4/T09「μ=1.2」；§13「w*=32… |
| E14 | medium | Part A（§1–3） | §3.1 Mean vs Mean-Square（「Mean Condition 為 0<μ<2，Mean-Square Condition 更嚴格為 0<μ<2/3」）、T03，… |
| E15 | medium | §13–14 Quantization / Learning Rate | §13.4「常數有理輸入時，仍可能產生週期性序列」及 §13.5 五策略比較 |
| E16 | medium | §13–14 Quantization / Learning Rate | §14.1「要求 B 次更新將平均誤差降至 ε」及 boxed (1−ε^{1/B})/K_min ≤ μ ≤ 1/K_max |
| E17 | low | §11 Bias / INL | §11.1「Code Centering 可以降低這種交叉耦合」；§11.3 標題「Code-Correlated Jitter」（內文只處理 deterministic u=cx… |
| E18 | low | §5 Comparator | §0 符號表「G_k = (1/N)Σqx」 對照 §5「G_N=Σ_{i=1}^N q_i」與「Var(G_N)=N(1−m²)」 |
| E19 | low | §8 Phase Margin / Dual Loop | §8.4 標題「主 PLL 與 LMS 的耦合／時間尺度分離」與「若假設觀測已完全穩態…一階模型認為 0<μ<2。但…完整模型的範圍為 0<μ<1」 |
| E20 | low | §8 Phase Margin / Dual Loop | §8.1 公式 $M_{\mathrm{polarity}}=90^\circ-\|\mathrm{wrap}_{180}(\theta)\|$ |
| E21 | low | §9–10 PE / MIMO | §10.1「但反矩陣元素約 ±25，很容易放大 GMAC Noise」 |
| E22 | low | §9–10 PE / MIMO | §10「(R+λI)^{-1}」、§10.1「λ_i」、§10.2「(J^TJ+λI)^{-1}」「σ_i²+λ」、§19 MIMO LMS 控制「λ」 |
| E23 | low | §9–10 PE / MIMO | §9 例子「ρ=0.99, μ=0.5 … 598 次更新」、T11、§19 PE / Eigen Lab（控制只有 ρ, μ, N_0） |
| E24 | low | §9–10 PE / MIMO | §10.2「Jacobian 若在固定點附近有效，該 Regularized Pseudoinverse 的每個非零 Singular Value σ_i 對應平均 Pole p_… |
| E25 | low | §9–10 PE / MIMO | §10.3 標題「三種架構比較」 |
| E26 | low | §12 Noise / Spur | §12 「f_cal,BW≈(1−p)/(2π)·f_u≈−ln p/(2π)·f_u」，以及 §12.1 示例的 12.9 kHz |
| E27 | low | §12 Noise / Spur | §12 「當 p 不夠靠近 1 時，應使用 exact discrete-time −3 dB 頻率，而不是把近似硬套。」 |
| E28 | low | §12 Noise / Spur | §12.2 離散 S_δt(e^{jΩ}) 與 §12.3 單邊連續 S_δt^(1)(f)、L(f)、σ_t,out² 之間 |
| E29 | low | §12 Noise / Spur | §12.2 S_δt(e^{jΩ})=(1/2π)∫S_x(e^{jν})S_w(e^{j(Ω−ν)})dν，其中沿用 §12 的 S_w |
| E30 | low | 全文符號與單位一致性 | §17 T13「100 fs noise，N=4096，μ=10 fs：p≈.92021、σ_w≈.399 fs」 |
| E31 | low | 全文符號與單位一致性 | §8.4「G_k=C s_k+Dδ_k」與「A_combined=[[A,B],[−μC,1−μD]]」 |
| E32 | low | 全文符號與單位一致性 | §3「代入 LMS 更新，令 δ_n=w_n−a」 |
| E33 | low | 全文符號與單位一致性 | §12「定義 δw_k=w_k−w*」；§12.2「δt[n]=x[n]δw[n]」；§13.1「Static Error 為 −0.4 LSB」；附錄 A「DTC Timing … |
| E34 | low | 全文符號與單位一致性 | §8.4 c,r,b；§9.2「b'=b+c」；§11.2 c；§19「c_2,c_3」；§13.4 v[n],r[n],y[n]；§8.3 d、§11 d(x)、§16.1「Co… |
| E35 | low | 全文符號與單位一致性 | §9.1「對所有 k：Σ_{n=k}^{k+N_0−1}」及「R_k」；§7「w_{k+1}=w_k+μE[q[n]u_f[n]]」；§13.4 quantizer 的 n；附錄 … |
| E36 | low | 全文符號與單位一致性 | §2.3 表「連 Regessor 幅度也丟掉」；§15.1 L6「仿真與物理模型比對」；§13.2「周期 5」、§15.1「周期性」、T16「周期 5」、附錄 B 第 10 點「… |
| E37 | low | 全文符號與單位一致性 | §10.1「Var(δ_i)≈γ/(K_q²Nλ_i(2−γ))」 |
| E38 | low | Part A（§1–3） | §3.1「假設樣本 x_n 為 iid、且和前一輪係數誤差獨立」、T03「（依獨立模型）」 |
| E39 | low | Part A（§1–3） | §3「令 δ_n=w_n−a」vs §0 約定表「δ_k=a−w_k（注意極性）」 |
| E40 | low | Part A（§1–3） | §2.2「e=0 處不具唯一導數，可用次梯度」、§2.3 Sign-Error 列，以及 §0 q[n]=sign(e[n]) ∈ {+1,−1} |
| E41 | low | Part A（§1–3） | §1 J2(w)=E[(y−wx)^2] 與 §1.1 j_n=½e_n^2、「LMS 是…近似平均成本 J2 的 Gradient Descent」 |
| E42 | low | Part A（§1–3） | §3.1「**均方誤差**（先無外加量測雜訊）：E[δ_{n+1}^2]=…」 |
| E43 | low | Part A（§1–3） | §2.3 表格 Sign-Sign LMS 列「連 Regessor 幅度也丟掉」 |
| E44 | low | §6–7 Polarity / Delay / Filtered-x | §6.1 「H_PD(s)=s²/(s²+2ζω_ns+ω_n²)…在 ω=0.3ω_n，H≈-0.0815+j0.0376，相位約 155.2°」；搭配 §6.1 的 H(e^{… |
| E45 | low | §6–7 Polarity / Delay / Filtered-x | §7 Filtered-x：「w_{k+1}=w_k+μE[q[n]u_f[n]]」與「若 Ĥ=H，小誤差下 E[qu]≈K_q(a-w)E[u²]」 |
| E46 | low | §6–7 Polarity / Delay / Filtered-x | §6.1 boxed E[xu]=(A²/2)\|H\|cosφ；§7 boxed C_D=(A²/2)\|H\|cos(φ+ΩD)；T06/T07；§19 Polarity Ex… |
| E47 | low | §13–14 Quantization / Learning Rate | §13.2「五週期 Toggle 帶有 f_toggle/5 及其諧波成分」 |
| E48 | low | §13–14 Quantization / Learning Rate | §14 boxed E[δ_B²]≈δ0²p^{2B}+μ²σ_η²(1−p^{2B})/(1−p²)，以及 §14.2 Coarse Calibration |
| E49 | low | §13–14 Quantization / Learning Rate | §13.1「選 w=32，Static Error 為 −0.4 LSB」 |

## 勘誤細節

### E01｜§11 Bias / INL｜high（`bias-inl-signlms-label`）

**位置**：§11.2「e=(a-w)x+cx³ … w*=a+cE[x⁴]/E[x²]=1.34」與「單係數 LMS 的最佳擬合 Gain 是 1.34」；§17 T12；§19.2 Preset 7；§11「在高斯 Noise 主導且小誤差時」

**問題**：1.34 是 MSE-LMS（E[xe]=0）的精確固定點，也是 Sign-LMS 在 Gaussian noise σ_v 遠大於殘差時的極限值。但 §11.2 的模型本身沒有 v[n]，本節與網站的主體又是 1-bit Sign-LMS。無雜訊時 Sign-LMS 的固定點由 E[x·sign(e)]=0 決定，是 MAE／|x| 加權中位數解 w=1.4，不是 1.34；中等雜訊時固定點落在 1.34 與 1.4 之間。照字面實作的 Bias & INL Lab 會收斂到約 1.4 或約 1.37，T12 會失敗，或被誤判為 bug。另外，§11 所說的「小誤差」不明確：真正需要小的是 w* 處整個 deterministic residual (a-w*)x+b+d(x)+u 相對 σ_v 的大小，不只是 |a-w|。

**修正（網站採用）**：§11.2 改寫為三個明確情境：(1) MSE-LMS（GMAC=E[xe]）：w*=a+c·E[x⁴]/E[x²]=67/50=1.34，標 [精確｜指定模型]。(2) Sign-LMS + 與 code 獨立的 Gaussian v（σ_v 為常數）：w*≈1.34，標 [近似｜需驗證]。「小誤差」的意思是 w* 處整個 deterministic residual e_det(x)=(a−w*)x+b+d(x)+u 要遠小於 σ_v，而不只是 |a−w| 小。本例 max|e_det|=0.24；要讓誤差 <1e-3，需 σ_v≳0.59。修正式為 w*≈1.34+3.456×10⁻⁴/σ_v²（σ_v≳0.2 時有效）。(3) 無雜訊 Sign-LMS（MAE 次梯度）：w*=1.4，即 |x| 加權中位數，MAE=0.12、MSE=0.036，標 [精確｜指定模型]，並註明會出現 O(μ) 的 limit cycle。T12 拆成三項：T12a MSE-LMS→1.34（解析，高精度）；T12b Sign-LMS、σ_v=1→mean-field 1.340346（MC 多 seeds 附 CI）；T12c Sign-LMS、σ_v=0→1.4。Preset 7 與 Bias & INL Lab 要加上「演算法（MSE / Sign）」和「σ_v」兩個控制項，並在 w* 旁邊顯示對應標籤，以及 σ_v=0.05/0.1/0.3/1 時的參考值 1.38314/1.36658/1.34385/1.34035。

**數值證據**：mean-field 根 Σx·erf(((1-w)x+0.1x³)/(√2σ_v))=0（mpmath 40 位）：σ_v=0 → 1.4；0.01 → 1.396628；0.05 → 1.383138；0.1 → 1.366577；0.2 → 1.348560；0.3 → 1.343850；0.5 → 1.341385；1 → 1.340346；10 → 1.3400035。Block sign-LMS MC（N=16，400 條 seeded chains，4000 burn-in 加 16000 個平均 block）：σ=0 為 1.399786（μ=5e-4），σ=0.05 為 1.383102±0.000013，σ=0.1 為 1.366509±0.000026，σ=0.3 為 1.343824±0.000058，σ=1 為 1.340385±0.000168（95% CI）。無雜訊 GMAC：w∈(1.1,1.4) 時 G=+0.4，w>1.4 時 G=-1.2。

### E02｜§5 Comparator｜high（`comparator-tie-even-N`）

**位置**：§5，公式「P(G_N>0)≈Φ(m√N/√(1−m²))」及表格「正確辨識固定正 Error 方向的近似機率」的 N=100 / 1,000 / 10,000 三列

**問題**：G_N=Σq_i 在偶數 N 時有 P(G_N=0)>0 的 tie，但標題公式寫的是嚴格的 P(G_N>0)。不加 continuity correction 的 CLT 式，在偶數 N 時近似的其實是 P(G_N>0)+½P(G_N=0)（tie 用公平隨機決定），奇數 N 時才等於 P(G_N>0)。表格三列都用偶數 N，所以數字跟它宣稱的事件不一致。N=100 最嚴重：嚴格成功率只有 49.2%，低於 50%，跟「53.2% 正確」的教學訊息方向相反。而且任何確定性的 tie 規則（G=0 不更新、或 sign(0)=+1 的 57.1%）都得不到 53.2%。網站的 Monte Carlo 若照文字實作 G_N>0，會和表格相差 4 個百分點，超出信賴區間，看起來像「模型公式有錯，UI 卻顯示成功」。

**修正（網站採用）**：§5 改寫如下：

「對 G_N=Σ_{i=1}^N q_i（q_i∈{±1}，iid），K=#{q_i=+1}~Binomial(N,p)，p=Φ(s/σ_v)，G_N=2K−N。N 為偶數時 G_N=0（tie）的機率不為零，必須指定 decision rule。下表 N 取奇數，因此沒有 tie，P(G_N>0)=P(K>N/2)。」

CLT 近似式保留 Φ(m√N/√(1−m²))，並註明：奇數 N 時它近似 P(G_N>0)；偶數 N 時它近似的是 P(G_N>0)+½P(G_N=0)（random tie-break）。偶數 N 若要嚴格的 P(G_N>0)，改用 Φ((Nm−1)/√(N(1−m²)))。標籤 [近似｜需驗證]。

表格改為：N=101 → 53.2%；N=1,001 → 60.0%；N=10,001 → 78.8%；N≈42,500（奇數 42,499 起）→ 95%；N≈85,000（奇數 85,011 起）→ 99%。exact binomial 值標 [精確｜指定模型]，CLT 值標 [近似｜需驗證]。

另加一個 tie 對照框（偶數 N、exact binomial），分列 P(G>0) / P(G=0) / P(G<0)：N=100 為 49.20% / 7.93% / 42.86%；N=1000 為 58.74% / 2.44% / 38.82%；N=10000 為 78.46% / 0.58% / 20.96%。並說明：「若 G=0 時不更新，N=100 時正確方向只有 49.2%，錯誤 42.9%，不動 7.9%；若硬體 sign(0)=+1，則正確率為 57.1%。網站 Comparator Lab 必須讓使用者選擇 tie rule，Monte Carlo 與解析曲線要用同一條 rule。」

**數值證據**：p=Φ(0.01)=0.503989356、m=0.0079787126。exact binomial 嚴格 P(G>0)：N=100 為 0.492050（P(G=0)=0.079336）、N=1000 為 0.587359、N=10000 為 0.784624。CLT：0.531798 / 0.599602 / 0.787535。tie 平分：0.531718 / 0.599576 / 0.787525。奇數 N=101 / 1001 / 10001：0.532034 / 0.599674 / 0.787548。直接 Gaussian MC（seed 20261010）：N=100 P(G>0)=0.49344 [0.49189, 0.49499]；N=1000 0.58931 [0.58626, 0.59236]；N=10000 0.78040 [0.77466, 0.78614]。三個 CI 都不含表格值。

### E03｜§11 Bias / INL｜medium（`bias-pll-dc-null`）

**位置**：§11 開頭「在本段假設 PLL 動態已吸收到誤差路徑；先用靜態表達」及 boxed w*；§11.1 w*=a+bE[x]/E[x²]

**問題**：靜態式隱含一個假設：b 以及 x 相關項的 DC 分量原封不動到達 comparator。但 §4 架構中同一個 PD/BBPD 同時驅動 PLL loop filter 和 q，§0 也定義 H_PD=1/(1+L)，其 DC 增益為 0。在 type-II（含 integral path）的 BBPD-PLL 中，lock 時迴路會強制 E[q]=0，把 b 吸收成 static phase offset，GMAC 因此等效於使用 centered regressor。這時一階 bias 與 b 無關，變成 w*≈a+[Cov(x,d)+Cov(x,u)]/Var(x)，分母也從 E[x²] 變成 Var(x)。對非負的 DSM residue x∈[0,1)，E[x²]=1/3 而 Var(x)=1/12，差 4 倍，這也影響 K=K_qC。若網站直接把 §11.1 套用到 shared-BBPD 架構，會顯示一個實際上不存在的 offset gain bias。

**修正（網站採用）**：§11 開頭補上適用條件：boxed w* 只在「PD 誤差的 DC 不被主 PLL 消除」時成立，例如校正期間主迴路 frozen、迴路沒有 integral path，或 x 已零均值。另外列出兩個 closed-loop 版本，都標 [近似｜需驗證]：(B) q 就是主 PLL 的 BBPD，且主迴路為 type-II：E[q]=0 被強制，w*≈a+Cov(x,d+u)/Var(x)。b 會被吸收成 static phase offset，不會變成 gain bias。(C) 主迴路由線性 PD/TDC 鎖定（E[e_PD]=0），另有一個帶 offset b 的獨立 comparator 觀察 e_PD：w*≈a+[bE[x]+Cov(x,d+u)]/Var(x)。此時 offset 造成的 bias 反而比靜態式大（例：x∈{0,1,2,3}、b=0.5 時，靜態式 1.214 對 1.59）。§11.1 的「假 Gain Bias」要註明依架構而定，並提醒：非負 residue x∈[0,1) 的 E[x²]=1/3，而 Var(x)=1/12。Bias & INL Lab 加一個「主迴路 DC null 模式：none / shared BBPD (E[q]=0) / linear PD + separate comparator」的切換，三個公式並列，各附 MC 驗證。

**數值證據**：MC 以 integral servo φ←φ-k_p·q 模擬 shared BBPD（x∈{0,1,2,3}、σ_v=1、a=1，200 chains）。只有 offset（b=0.5，d=0）時：無 servo 1.2140±0.0002（spec 式 1.2143，mean-field 1.2141），有 servo 1.0000±0.0003。只有 INL（b=0，d=0.1x²）時：無 servo 1.2570±0.0002（spec 式 a+0.1·E[x³]/E[x²]=1.2571），有 servo 1.2999±0.0003（Cov 式 a+0.1·3.75/1.25=1.3000）。

### E04｜§9–10 PE / MIMO｜medium（`mimo-gauge-dc`）

**位置**：§9.2「PLL DC Error Suppression 可能使 Common-Mode 更難觀察」及「處理方式：固定一個 Phase 當 Reference、強制 Σa_i=0…」

**問題**：以本文 §6 的 H_PD(s)=s²/(s²+2ζω_ns+ω_n²)（H_PD(0)=0）觀測時，Global Offset 的 regressor 是常數 1，經 PD path 後穩態 u_b≡0；且 Σ_i x_i=1 使 Σ_i u_i=h*1=0。有效 R_u 因此有兩個零 eigenvalue（b 方向與 a_i common-mode），b 是「完全不可觀察」而非「更難觀察」。此時固定 reference phase 或 Σa_i=0 只能消除 a_i 的 gauge，b 仍無法辨識；網站若在 u-domain 算 eigenvalues 會看到 2 個零，與文字的 1 維 gauge 不符。

**修正（網站採用）**：§9.2 末段改為：「若 GOS/PHOS 是經 H_PD(z=1)=0 的 error transfer（Type-I/II PLL，DC Error 被抑制）觀測，Global Offset b 在穩態完全不可觀察（u_b→0），且 Σ_iu_i=0。有效 R_u 與 C 的 null space 從 1 維（c,−c,−c,−c,−c）變成 2 維（b 方向、a_i common-mode）。固定 Reference Phase 或強制 Σa_i=0 只處理 a_i 的 gauge，b 仍無法辨識；若仍讓 w_b 積分，在 Comparator Offset 或 Noise 下會漂移甚至飽和。b 必須靠獨立觀測路徑（PLL 外的 TDC／參考比較或 open-loop 量測），或乾脆不在此路徑更新（常數 b 在 output 只是固定相位）。」四相 One-Hot Lab 要同時顯示 raw-x 與 u-domain 的 eigenvalues。

**數值證據**：Monte Carlo（uniform one-hot, T=400,000, bilinear H_PD, ω_n=0.05 rad/sample, ζ=0.7）：raw-x R eig=[~0, 0.2496, 0.2500, 0.2504, 1.2500]；u-domain R_u eig=[−8.6e-17, 6.0e-31, 0.2453, 0.2458, 0.2462]；R_u[b,b]=6.0e-31；RMS(Σ_i u_i)=5.0e-15；H_PD(z=1)=0.0。

### E05｜§9–10 PE / MIMO｜medium（`mimo-kq-scaling`）

**位置**：§10.1「一般 LMS μ=0.5 的慢模式 Pole 為 0.995（約 598 次）；取 M=0.5R^{-1} 時，所有模式 Pole 為 0.5」

**問題**：§10 的模型是 G≈K_q R(a−w)、M=γ(K_qR)^{-1}。在此模型下 M=μI 的 pole 為 1−μK_qλ_i，M=0.5R^{-1} 的 pole 為 1−0.5K_q。10.1 的數字（0.995、598、0.5、5 次）沿用 §9 不含 K_q 的 conventional LMS，只在 K_q=1（或 μ 已吸收 K_q）時成立；與 §5 的 K_q=0.00797885 fs^-1 一起使用會差兩個數量級。

**修正（網站採用）**：§10.1 改為：「本例採正規化 K_q=1（μ 代表無單位 loop gain μK_q）。一般 LMS M=μI 的 Pole 為 1−μK_qλ_i；μK_q=0.5 時慢模式 Pole 0.995（約 598 blocks 下降 95%）。取 M=0.5(K_qR)^{-1}（γ=0.5）時，所有模式 Pole 為 0.5（5 blocks 下降 95%）。」另加註：若改用 §5 的 K_q=0.00797885 fs^-1 而 μ=0.5 fs，慢 Pole=0.99996011（約 75,091 blocks）。MIMO Lab 要顯示 g_i=μK_qλ_i，並標示單位：K_q 為 fs^-1，μ 為 fs。

**數值證據**：K_q=√(2/π)/100=0.0079788456 fs^-1、μ=0.5、λ_min=0.01：慢 pole=0.99996011，95% 衰減需 ⌈log0.05/log(0.99996011)⌉=75,091 次（不是 598）；M=0.5R^{-1}（未除 K_q）時 pole=1−0.5K_q=0.99601（不是 0.5）。

### E06｜§12 Noise / Spur｜medium（`noise-bw-label`）

**位置**：§12.1 示例「校正 Noise BW 約 12.9 kHz（近似）」與 §17 T14「Noise BW 約 12.9 kHz」

**問題**：12.9 kHz 其實是 H_{η→w} 的 −3 dB（half-power）corner frequency，不是 equivalent noise bandwidth（ENBW）。網站若把它標成「Noise BW」，再用 S_w^(1)(0)×BW 估算積分雜訊，σ_w 會被低估約 20%。這和同一節的 σ_w=0.399 fs 互相矛盾。

**修正（網站採用）**：§12.1 示例改為「校正迴路 −3 dB 頻寬 f_3dB≈12.93 kHz（exact discrete；−ln p 近似 12.92 kHz）」。另列一行「Equivalent Noise Bandwidth（one-sided）ENBW=(f_u/2)·(1−p)/(1+p)≈20.29 kHz（≈(π/2)·f_3dB），σ_w²=S_w^(1)(0)·ENBW [精確｜指定模型]」。§17 T14 改為：f_u=976.5625 kHz、f_3dB=12.931 kHz、ENBW=20.289 kHz，並驗證 √(S_w^(1)(0)·ENBW)=σ_w=0.3992 fs。網站上不得把 f_3dB 標成「Noise BW」。

**數值證據**：p=0.920211544、f_u=976562.5 Hz：exact f_3dB=12931.28 Hz；ENBW=20289.02 Hz（數值積分確認；MC Welch 估計約 20.46 kHz）。sqrt(S^(1)(0)·f_3dB)=0.31869 fs，而 sqrt(S^(1)(0)·ENBW)=0.39919 fs，後者等於 σ_w。

### E07｜全文符號與單位一致性｜medium（`notation-G-sum-tie-sec5`）

**位置**：§5「對 G_N=Σ_{i=1}^N q_i…P(G_N>0)」及表格；§0「q[n]=sign(e[n])」；§15.2「q=+1.0 if e>=0」

**問題**：(1) §0 定義 G_k=(1/N)Σqx 是 average，§5 的 G_N 卻是 sum，而且沒有乘 x。(2) N 為偶數時 G_N=0 的 tie 沒有規則；sign(0) 在 §0（數學上為 0）和 §15.2（e≥0→+1）也不一致。N=100 時 tie 機率約 7.9%，Monte Carlo 頁面會顯示 49.2% 或 57.1%，表格卻寫 53.2%。

**修正（網站採用）**：§5 改用 S_N=Σ_{i=1}^N q_i（x≡1 時 G=S_N/N），避免與 §0 的 G_k 混淆。表格標題改為「CLT 近似（S_N=0 時以 1/2 機率判對，等同 tie 平分）」，並加註 N 為偶數時須定義 tie 規則。exact Binomial 下 P(S_N>0)/P(S_N≥0) 為：N=100 → 49.2%/57.1%；N=1000 → 58.7%/61.2%；N=10000 → 78.5%/79.0%。Comparator Lab 的 MC 必須使用相同的 tie 規則與表格比對。

**數值證據**：exact Binomial (p=0.5039894) 下 P(G>0)/P(G≥0)：N=100 為 0.4920/0.5714；N=1000 為 0.5874/0.6118；N=10000 為 0.7846/0.7904。對應 CLT 值為 0.5318/0.5996/0.7875。

### E08｜全文符號與單位一致性｜medium（`notation-Kq-missing-sec10.1`）

**位置**：§10.1「一般 LMS μ=0.5 的慢模式 Pole 為 0.995…取 M=0.5R⁻¹ 時，所有模式 Pole 為 0.5…反矩陣元素約 ±25」

**問題**：§10 自己的模型是 G≈K_qR(a−w)，理想 preconditioner 是 M=γ(K_qR)⁻¹。文中 0.995 和 0.5 兩個數值卻隱含 K_q≡1。另外 ±25 是 M=0.5R⁻¹ 的元素，不是 R⁻¹ 的元素。MIMO Lab 若用 §5 的 K_q 計算，結果會和文字對不上。

**修正（網站採用）**：§10.1 改為：「以 μK_q=0.5 的正規化（或沿用 §9 conventional LMS，K_q≡1）：一般 LMS 慢模式 Pole 0.995，95% 衰減約 598 次；取 M=0.5(K_qR)⁻¹ 時所有模式 Pole 為 0.5（5 次下降 95%）。此時 K_qM 的元素約 +25.13/−24.87（R⁻¹ 為 +50.25/−49.75），容易放大 GMAC Noise。若誤用 M=0.5R⁻¹ 而 K_q=0.00798 fs⁻¹，Pole 只到 0.996，約需 750 blocks。」

**數值證據**：K_q=0.00797885 fs⁻¹ 且 μ=0.5 時，慢 pole=0.99996011，95% 衰減約需 75,100 blocks；M=0.5R⁻¹ 時 pole=0.99601。R⁻¹=[[50.2513,−49.7487],[−49.7487,50.2513]]。

### E09｜全文符號與單位一致性｜medium（`notation-multirate-sec12.2`）

**位置**：§12.2「δt[n]=x[n]δw[n]」及「S_δt(e^{jΩ})=(1/2π)∫S_x(e^{jν})S_w(e^{j(Ω−ν)})dν」；附錄 A 同列

**問題**：§12 的 δw_k 和 S_w(e^{jΩ}) 都定義在 block rate f_u（Ω 對 f_u 正規化），§12.2 卻用 sample index n，並把 S_w 直接放進 sample-rate 卷積。δw[n] 和 δw_k 之間沒有定義映射（ZOH 加 commit latency）。網站若直接套用，頻率軸和 PSD 位準都會錯。

**修正（網站採用）**：§12.2 先定義 δw[n]=δw_{⌊(n−n_c)/N⌋}（ZOH，n_c 為 commit/apply latency）。在 block 相位隨機、時間平均的條件下，sample-rate PSD 為 S_w^{(f_s)}(e^{jΩ})=(1/N)[sin(NΩ/2)/sin(Ω/2)]²·S_w^{(f_u)}(e^{jNΩ})，再代入 S_δt(e^{jΩ})=(1/2π)∫S_x(e^{jν})S_w^{(f_s)}(e^{j(Ω−ν)})dν。註明：(1) 不可把 §12 的 block-rate S_w 直接放到 sample-rate 軸，否則 tone 附近的 skirt 位準約差 N 倍；(2) 實際序列為 cyclostationary，此式只是時間平均 PSD。

**數值證據**：ZOH 模擬（N=16、p=0.92、2^18 blocks、Welch）：用上述公式時量測/理論中位數比為 0.995；把 §12 的 S_w 直接放到 sample-rate 軸時比值為 0.0745。

### E10｜全文符號與單位一致性｜medium（`notation-noise-BW-label-sec12-T14`）

**位置**：§12.1「校正 Noise BW 約 12.9 kHz（近似）」；§12「f_cal,BW≈(1−p)/(2π)f_u≈(−ln p)/(2π)f_u」；T14「Noise BW 約 12.9 kHz」

**問題**：12.9 kHz 是 −3 dB corner，而且只和 −ln p 近似或 exact 解吻合；文中先寫的 (1−p) 近似會得到 12.40 kHz。一般「Noise BW」指 equivalent noise bandwidth (ENBW)，數值約 20.3 kHz。若拿 12.9 kHz 去積分白雜訊，variance 會低估約 36%。

**修正（網站採用）**：§12.1 改為「校正 −3 dB 頻寬 f_cal,3dB≈12.93 kHz（exact：acos[(1+p²−2(1−p)²)/(2p)]·f_u/(2π)；−ln p 近似 12.92 kHz；(1−p) 近似 12.40 kHz）；one-sided equivalent noise bandwidth ENBW=f_u(1−p)/(2(1+p))≈20.29 kHz（白雜訊積分用此值）」。T14 期望值改為「f_u=976.5625 kHz；f_cal,3dB≈12.93 kHz（exact）；ENBW≈20.29 kHz」，並列出 tolerance。

**數值證據**：p=0.9202115、f_u=976562.5 Hz：exact −3 dB=12931.3 Hz；−ln p 近似 12923.8 Hz；(1−p) 近似 12401.1 Hz；ENBW one-sided 20289.0 Hz（比值 1.569≈π/2）。

### E11｜全文符號與單位一致性｜medium（`notation-preset7-distribution`）

**位置**：§19.2 preset 7「a=1,c_3=.1：三階 INL，最佳線性 Gain 1.34」；§11.2 用 c、T12 用 c

**問題**：1.34 只有在 x 於 {−2,−1,0,1,2} 等機率分布時才成立，preset 卻沒有寫出這個分布。§15.3 JSON 預設的 code_normalization 是 unit_rms，用預設分布跑會得到不同的 w*，網站會把 1.34 當成錯的期望值。另外 c 和 c_3 的命名不一致。

**修正（網站採用）**：preset 7 改為：「a=1、c_3=0.1，x 於 {−2,−1,0,1,2} 等機率、identity path、Gaussian comparator noise 主導（σ_v≫|e|）或 conventional LMS：三階 INL，最佳線性 Gain w*=a+c_3E[x⁴]/E[x²]=1.34。注意：±1 code 時為 1.10，unit Gaussian code 為 1.30；無雜訊 Sign-Error LMS 的固定點為 1.40。」§11.2 與 T12 統一使用 c_3。

**數值證據**：w*=a+c_3E[x⁴]/E[x²]：五值分布得 1.34；unit-variance Gaussian 得 1.30；±1 code 得 1.10。exact sign-LMS 固定點（σ=0.5..100）為 1.3414→1.3400。

### E12｜全文符號與單位一致性｜medium（`notation-u-collision-sec11`）

**位置**：§11「e[n]=(a−w)x[n]+b+d(x[n])+u[n]+v[n]」；§11.3「若 u[n]=cx[n]」；§11.4「w*=a+B/C」

**問題**：§0 把 u[n] 定義為 filtered regressor (h*x)，§11 卻拿 u[n] 當 code-correlated disturbance。於是 §11 boxed 公式分子的 E[xu] 指 disturbance 相關，§6 和 §11.4 分母的 C=E[xu] 指 polarity gain，同一個式子兩種意義。§11.3 的「u=cx」也很容易被讀成「filtered regressor 增益 c」。

**修正（網站採用）**：§11 的干擾改名為 ε_cc[n]（code-correlated disturbance），係數改用 κ：e[n]=(a−w)x[n]+b+d(x[n])+ε_cc[n]+v[n]；固定點 w*=a+(bE[x]+E[xd(x)]+E[xε_cc])/E[x²]。§11.3 改為「若 ε_cc[n]=κx[n]，則 E[xε_cc]=κE[x²]，w*=a+κ」。§11.2 的 c 改為 c_3（與 §19 一致）。§11.4 註明「此處 C=E[x(h*x)] 同 §6，B 為干擾 bias 項 B_bias=bE[x]+E[xd]+E[xε_cc]」。

**數值證據**：§11.3 的 w*=a+c 可以驗證，但 §11.4 必須用 §6 的 C=E[x(h*x)]，兩處的 E[xu] 不是同一個量。

### E13｜全文符號與單位一致性｜medium（`notation-units-mu-w-K-u`）

**位置**：§0 表 u 列「和 PD Error 單位一致」；§8.2/§12/§14.1/附錄 A 的 K；§12.1「μ=10 fs」；§8.4/T09「μ=1.2」；§13「w*=32.4 LSB」；§15.3 JSON gain_* 欄位

**問題**：(1) §0 說 u 和 PD error 同單位，但 §15.2 寫「Code/regressor normalized」，§12.1 又用 μ=10 fs、σ_w 單位 fs，表示 u 無因次、a 和 w 單位為 fs。(2) K 在 §8.2、§12、§14.1 和附錄 A 都有用到，§0 卻沒有定義。§12 直接把 K 寫成 K_q 的數值，實際是 K=K_q·C（C=1）。(3) 同一個 μ 在 T09 是無因次 1.2，在 T13 是 10 fs。(4) §13 的 w 用 LSB，但全文沒有給 fs/LSB 換算，所以 6-bit 量化結果無法接到 §12 的 0.399 fs。(5) §14.1 的「K_i=−∂E[G_i]/∂w」中 i 指 corner，卻寫得像參數索引。

**修正（網站採用）**：§0 修正如下：u[n]=(h*x)[n] 與 x 同單位（正規化 code 時無因次）；PD error 的時間單位由係數承載，a、w 的單位為 [PD error]/[code]（例：fs/unit-RMS code）。新增 K:=K_q·C=−∂E[G]/∂w，單位 fs⁻¹（x 無因次時）；g:=μK 為無因次 normalized loop gain；μ 的單位為 [w]/[G]，average-mode GMAC 下為 fs。§8.2–8.4 與 T09 註明「μ 為 K≡1 的正規化步長（即 g）」。§13 補上 DTC gain LSB 尺寸 Δ_LSB [fs/LSB]，JSON 加 gain_lsb_fs 欄位。§14.1 改寫為 K^{(c)}=−∂E[G]/∂w|_{corner c}，K_min/K_max 為各 corner 的最小與最大值。

**數值證據**：u 無因次時 g=10 fs×0.0079788 fs⁻¹=0.0797885，p=0.9202115，和 §12.1 吻合。若照 §0 讓 u 帶 fs，C=E[xu] 帶 fs，g 會帶 fs² 單位，不再是無因次。

### E14｜Part A（§1–3）｜medium（`partA-01`）

**位置**：§3.1 Mean vs Mean-Square（「Mean Condition 為 0<μ<2，Mean-Square Condition 更嚴格為 0<μ<2/3」）、T03，以及 §17「隨機統計則使用多 seeds 和信賴界限」

**問題**：規格只分 mean 與 mean-square stability，沒有說明 sample-path（almost-sure）收斂的界限不同，而且大得多。Gaussian 純量 LMS 中，0<μ<2.4213 時單一路徑幾乎必然收斂；但 μ>2/3 時 E[δ^2] 發散，μ>2 時連 E[δ] 也發散。網站互動實驗通常畫的是單一或少數 sample path，或少量 seeds 的樣本平均。這樣在 μ=0.8~2.3 會看到「收斂」，與 2/3 界限相矛盾，使用者會誤以為公式錯了。另外 δ^2 是 heavy-tailed，用長時間樣本平均加 CI 去驗證 T03 會得到錯誤結論。

**修正（網站採用）**：在 §3.1 末尾補上第三種結論並加標籤：「**Almost-sure（樣本路徑）收斂**（無外加雜訊、x_n iid）：充要條件為 E[log|1−μx²|]<0。x~N(0,1) 時約為 0<μ<2.4212 [精確｜指定模型；數值積分]。所以三種界限不同：mean 0<μ<2、mean-square 0<μ<2/3、almost-sure 0<μ≈2.42。μ 介於 2/3 和 2.42 之間時，E[δ_n²] 會發散，但幾乎每條樣本路徑仍收斂到 0。E[δ²] 被極少數 heavy-tail 路徑主導。若有外加雜訊，這個區間內 δ_n 會收斂到一個 stationary 分布，但它的二階矩無限大（heavy tail，Kesten 型）。」T03 改成用封閉式驗證：g(μ)=E[(1−μx²)²]=1−2μ+3μ²，g(2/3)=1；或用單步 Monte Carlo 估計 E[(1−μx²)²]（變異數有限）。**不可**用長時間 δ_n² 的樣本平均加 sample-std CI 驗證 2/3 界限，因為 heavy tail 會讓 sample SE 嚴重低估（μ=0.8、n=5 時真實 SE 約為 sample SE 的 6 倍）。互動圖要分開畫三條曲線並各自標註：解析 E[δ_n]=(1−μP_x)^n δ0、解析 E[δ_n²]=g(μ)^n δ0²，以及 Monte Carlo 的 |δ_n| 中位數與 10/90% 分位數。

**數值證據**：λ(μ)=E log|1−μx^2| 數值積分（scipy quad，χ²₁）：μ=2/3 → −0.486440，μ=1 → −0.416992，μ=2 → −0.116247，μ=2.5 → +0.020625；零點 μ_as=2.421249521。MC（seed 1，1e4 seeds，N=200）：μ=0.8 時理論 log10 E[δ^2]=+24.11，樣本平均 log10=−48.31，100% 路徑 |δ|<1e-3；μ=2.0（mean pole=−1）時仍有 83.25% 路徑 |δ|<1e-3。μ=0.8、n=5、2e6 seeds：MC E[δ^2]=3.287±0.276，理論 4.0075，95% CI 沒有涵蓋真值。單步 MC：g(2/3)=1.00051±0.00136（正確）。

### E15｜§13–14 Quantization / Learning Rate｜medium（`quant-02`）

**位置**：§13.4「常數有理輸入時，仍可能產生週期性序列」及 §13.5 五策略比較

**問題**：這段寫成「可能」，語氣過弱。對常數 w_H=32.4，一階 EFB quantizer 必然進入週期 5 的 limit cycle，而且輸出就是方法 B 的同一個循環序列：rounding 給 32,33,32,33,32，floor 給 32,32,33,32,33，對任何初始 r 皆然。因此在靜態目標下，方法 D 與方法 B 的頻譜、Spur、總誤差功率（0.24 LSB²）完全相同；網站若把 D 呈現為「noise-shaped、無音調」就是錯的。此外，NTF 搭配 white-uniform 假設會預測總誤差功率 2/12=0.1667 LSB²，實際是 0.24 LSB²。Q_6 的 rounding mode（nearest/floor、tie 規則）也沒有定義，會影響序列相位與 r 的範圍（[−0.5,0.5] vs [0,1)）。另外 fixed-point 下 32.4 無法精確表示，週期會變成 2^F/gcd，而不是 5。

**修正（網站採用）**：§13.4 末句改為：「[精確｜指定模型] 一階 EFB 對常數有理輸入 c=P/q（最簡分數）必然進入週期 q 的 limit cycle。這對任何初始 r 都成立；r[0] 超出 quantizer 範圍時，最多有 1 個 sample 的 transient。原因是 r[n]=frac(r[0]+nc)。c=32.4=162/5 時週期為 5：floor 輸出 [32,32,33,32,33]，與方法 B 完全相同；round-half-up 輸出 [32,33,32,33,32]，為其循環移位。兩者頻譜相同：f_u/5 為 0.03056 LSB²，2f_u/5 為 0.20944 LSB²，總誤差功率 0.24 LSB²（不是 white-uniform 模型預測的 2/12≈0.167 LSB²），DC 誤差為 0。因此對靜態目標，方法 D 不會比方法 B 少 Tone；只有在 w_H 隨時間變化（例如 LMS 更新噪聲）或加入 dither 時，兩者才有差異。若 w_H 為 F 個小數 bit 的定點數，常數輸入的週期為 2^F/gcd(K,2^F)，其中 K 為 w_H·2^F 的整數值。例如 F=10 時 32.4 量化為 32.400390625，週期 512。」

另外需明定 Q_6 為 floor 或 round-half-up，以及 r 的範圍（[0,1) 或 [−0.5,0.5)）。§13.5 也應註明：五策略比較須同時跑「w_H 常數」與「w_H 含 LMS 噪聲」兩種情境，並在常數情境下把 D≡B 作為 acceptance check。

**數值證據**：Exact rational 模擬：rounding y=32,33,32,33,32 (r=2/5,−1/5,1/5,−2/5,0)；floor y=32,32,33,32,33 (r=2/5,4/5,1/5,3/5,0)；r0∈{0.1,−0.3,1/7,0.49} 皆週期 5。EFB 譜線：f_u/5 0.0305573、2f_u/5 0.209443 LSB²（與方法 B 相同）。總誤差功率 0.24 vs white model 0.16667；var(r)=0.08 vs 1/12。Fixed-point F=8/10/12 偵測週期 128/512/2048。w_H=63.3 時 1000 步後 |r|=300（overload）。

### E16｜§13–14 Quantization / Learning Rate｜medium（`quant-03`）

**位置**：§14.1「要求 B 次更新將平均誤差降至 ε」及 boxed (1−ε^{1/B})/K_min ≤ μ ≤ 1/K_max

**問題**：這個 boxed 區間只在 ε 是相對比例（|E[δ_B]| ≤ ε|δ0|，0<ε<1）時才正確。原文「降至 ε」容易被讀成絕對誤差（fs 或 LSB）：若網站讓使用者輸入 ε=1 fs，μ_min 會算成 0，若輸入 ε>1，μ_min 甚至變成負值。原文也沒有給出區間非空的明確條件，也沒提醒：這只約束平均誤差，ε|δ0| 若低於噪聲底 σ_w，RMS 仍然達不到。

**修正（網站採用）**：§14.1 改為：「若固定更新極性 K_i=−∂E[G_i]/∂w>0，並在理想一階、無額外延遲的線性模型中，要求 B 次更新後 |E[δ_B]|≤ε|δ_0|（ε 為無因次的相對縮減比例，0<ε<1；若規格給的是絕對誤差 e_abs，則用 ε=e_abs/|δ_0|）。」boxed 區間標示為 [精確｜線性一階無延遲模型]。

並補上：「區間非空 ⟺ 1−ε^{1/B}≤K_min/K_max ⟺ B≥ln ε/ln(1−K_min/K_max)。例：K_min/K_max=1/3、ε=0.01 → B≥12。此條件只約束平均誤差；若目標是 RMS，還須以 §14 的 E[δ_B²] 檢查噪聲項 μ²σ_η²(1−p^{2B})/(1−p²) 是否低於目標²。」

網站的輸入欄位應命名為「相對縮減比 ε (0<ε<1)」，並拒絕 ε≥1 的輸入。

**數值證據**：暴力驗證 1.22M 組參數 0 mismatch（ε 相對時）。非空條件例：K_min/K_max=1/3、ε=0.01 → B≥11.358（取 12）；K_min/K_max=0.5、ε=0.001 → B≥9.966（取 10）。K_min=0.004、K_max=0.012、B=12、ε=0.01 → μ∈[79.677, 83.333]。K_min=0.00797885、B=30：ε=0.02（相對）→ μ_min=15.3226 fs；誤把 ε=1 fs 代入 → μ_min=0。

### E17｜§11 Bias / INL｜low（`bias-code-dependent-jitter`）

**位置**：§11.1「Code Centering 可以降低這種交叉耦合」；§11.3 標題「Code-Correlated Jitter」（內文只處理 deterministic u=cx）；§11 前提「高斯 Noise 主導」

**問題**：§11 的公式隱含 σ_v 為與 code 無關的常數。實際 DTC 的 random jitter 會隨 delay code 增加。在 Sign-LMS 中，局部增益 K_q(x)=√(2/π)/σ_v(x) 會隨 code 變化，固定點因此變成 1/σ_v(x) 加權：w*≈a+E[xB(x)/σ_v(x)]/E[x²/σ_v(x)]。此時 centering（E[x]=0）不再能消除 offset bias；MSE-LMS 則不受影響。另外，零均值的 code-dependent jitter 本身不會產生 bias，只會重新加權其他 bias 項。若網站把 §11.3 的「jitter」實作成 random jitter，就會顯示錯誤的 bias 數字。

**修正（網站採用）**：§11 前提把「v：與 Code 不相關的 Random Noise」改成「v 與 x 獨立，σ_v 不隨 code 改變（Gaussian）」。補一段 [近似｜需驗證]：若 σ_v=σ_v(x)（例如 DTC random jitter 隨 delay code 增加），Sign-LMS 的固定點變成 1/σ_v(x) 加權，w*≈a+E[x·B(x)/σ_v(x)]/E[x²/σ_v(x)]，其中 B(x)=b+d(x)+u。此時 code centering（E[x]=0）不保證 offset 不造成 gain bias；MSE-LMS 不受這個影響。零均值的 code-dependent jitter 本身不產生 bias，只會重新加權其他 bias 項。§11.3 標題改成「Code-Correlated Deterministic Error（DJ）與 Identifiability」，或在內文註明 u 是 deterministic，不是 random jitter。可選：Research 模式的 Bias Lab 增加 σ_v(x) 選項，並顯示加權公式。

**數值證據**：x∈{-2..2}，σ_v(x)=√(1+0.25(x+2)²)=[1, 1.118, 1.414, 1.803, 2.236]。b=0.2、d=0（centered x）時：sign-LMS 線性化 0.9601、mean-field 0.9601、MC 0.9599±0.0003；σ_v 為常數 1 時為 1.0000，MSE-LMS 為 1.0000。cubic c=0.1 加 b=0.2 時：sign-LMS 1.3008（MC 1.3007±0.0003），σ_v 為常數時 1.3403，MSE-LMS 為 1.3400。

### E18｜§5 Comparator｜low（`comparator-G-sum-vs-average`）

**位置**：§0 符號表「G_k = (1/N)Σqx」 對照 §5「G_N=Σ_{i=1}^N q_i」與「Var(G_N)=N(1−m²)」

**問題**：§0 把 G 定義為 block 平均（下標 k 是 block index），§5 卻用同一個字母 G、下標 N 表示總和，Var 公式也只對總和成立。方向機率不受尺度影響，但 Comparator Lab 的 accum histogram 與信賴區間動畫若照 §0 實作成平均值，再套 Var=N(1−m²)，誤差帶會差 N² 倍（標準差差 N 倍）。§0 自己也強調 sum/average 差 N 倍。

**修正（網站採用）**：§5 改用 S_N=Σ_{i=1}^N q_i（sum），並註明：「這相當於 §0 中 x≡1 時的 GMAC 總和；依 §0 的平均定義，G=S_N/N。」公式寫成：E[S_N]=Nm，Var(S_N)=N(1−m²)；若用平均：E[G]=m，Var(G)=(1−m²)/N。方向判斷 P(S_N>0)=P(G>0)，與尺度無關。網站 Comparator Lab 的 histogram／信賴區間軸標示 sum 或 average，並與 §4.2 的 sum/average 切換連動。

**數值證據**：N=10000、m=0.0079787：sum 時 E=79.787、SD=99.997；average 時 E=0.0079787、SD=0.0099997。兩者差 N 倍。

### E19｜§8 Phase Margin / Dual Loop｜low（`margin-dual-loop-latency-attribution`）

**位置**：§8.4 標題「主 PLL 與 LMS 的耦合／時間尺度分離」與「若假設觀測已完全穩態…一階模型認為 0<μ<2。但…完整模型的範圍為 0<μ<1」

**問題**：數值本身全部正確，但歸因有歧義。在這個二維模型裡，完整穩定上界 μbc<1−r 恰好是 quasi-static 上界 μbc<2(1−r) 的一半，而且與 r（主迴路有多快）無關。所以「簡化模型高估 2 倍」的主因，是模型內建的一個 block 觀測延遲（s_{k+1} 由 δ_k 驅動，G_k=c·s_k），不只是時間尺度分離不足。r=0（主迴路瞬間穩態）時，模型正好退化成 §8.3 的 d=1 純延遲，界限仍是 g<1，不是 2。若網站讓使用者調 r，並暗示「主 PLL 更快就能回到 0<μ<2」，會產生誤導。

**修正（網站採用）**：在 §8.4 範例後補充，並標 [精確｜指定模型]：「一般而言，對 |r|<1、bc>0、μ>0，特徵方程 z²−(1+r)z+r+μbc=0 的完整穩定範圍為 0<μbc<1−r；quasi-static（s=bδ/(1−r)）一階模型給出 0<μbc<2(1−r)。兩者恰好差 2 倍，而且與 r 無關，所以把主 PLL 調得更快（r→0）並不會讓簡化模型的界限變對。差異來自模型裡 sample→observe 的一個 block latency：G_k 用的是 s_k，而 s_k 由 δ_{k−1} 驅動。r=0 時正好退化成 §8.3 d=1 的 δ_{k+1}=δ_k−g·δ_{k−1}，g=μbc<1。」另補 [近似｜需驗證]：「時間尺度分離近似（慢 pole ≈ 1−μbc/(1−r)）只在 μbc ≪ (1−r)²/4 時成立，本例為 μ ≪ 0.05。μ>0.05 後，完整模型的 poles 變成 0.9±j·√(0.2μ−0.01) 的複數對，|z|=√(0.8+0.2μ)≥0.9，收斂速度遠慢於簡化模型的預測。例如 μ=0.5 時，簡化 pole 為 0.5，完整模型 ρ=0.9487。」網站的 Dual-Loop Explorer 應同時顯示 (1−r)/(bc) 與 2(1−r)/(bc) 兩條界線。

**數值證據**：以 bisection 求完整上界：(r,b,c)=(0.8,0.2,1)→1.0000；(0,0.5,1)→2.0000；(0.5,0.3,2)→0.83333；(−0.5,0.4,1)→3.7500；(0.95,0.05,1)→1.0000；(0.99,0.01,1)→1.0000。全部等於 (1−r)/(bc)，也全部是 2(1−r)/(bc) 的 1/2。r=.8 時：μ=0.05 的 full poles 為重根 0.9（簡化模型給 0.95）；μ=0.5 的 full ρ=0.9487（簡化 pole 0.5）；μ=0.8 的 full ρ=0.9798（簡化 0.2）。

### E20｜§8 Phase Margin / Dual Loop｜low（`margin-wrap180-undefined`）

**位置**：§8.1 公式 $M_{\mathrm{polarity}}=90^\circ-|\mathrm{wrap}_{180}(\theta)|$

**問題**：wrap_180 沒有定義輸出範圍。如果實作者照字面寫成 θ mod 180°（輸出落在 [0,180)），那麼 θ 在 (−180°,−90°) 或 (180°,270°) 時 M_polarity 的符號會反過來，網站會把「極性錯誤、平均發散」顯示成「有正的 Polarity Margin」。

**修正（網站採用）**：在 §8.1 公式下補上定義：「wrap_180(θ) ≜ ((θ+180°) mod 360°) − 180° ∈ [−180°,180°)（週期是 360°，不是 180°；mod 取非負餘數）。等價的免 wrap 封閉式為 M_polarity = arcsin(cos θ)（以度表示，值域 [−90°, 90°]），網站實作建議直接用這個式子。M_polarity>0 ⇔ cosθ>0（有恢復力）；M_polarity=0（θ=±90°）表示單頻相關 C=0，沒有平均恢復力；M_polarity<0 表示極性錯誤，平均發散。」並在 §17 加一個反面測試：θ=200° 應得 M=−70°，θ=−150° 應得 M=−60°。

**數值證據**：θ=−150°：正確 wrap 得 M=−60°（cosθ=−0.866，極性錯誤）；mod-180 實作得 M=+60°。θ=200°：正確 M=−70°，mod-180 得 +70°。在 2×10^5 個隨機 θ 上，arcsin(cosθ) 與正確 wrap 公式的差 ≤4.0e−15。

### E21｜§9–10 PE / MIMO｜low（`mimo-inverse-magnitude`）

**位置**：§10.1「但反矩陣元素約 ±25，很容易放大 GMAC Noise」

**問題**：R^{-1} 本身的元素約 ±50，不是 ±25；約 ±25 的是 M=0.5R^{-1}，且符號固定為對角正、非對角負。此外 Noise 放大的正確量是 M 在慢 eigenvector 上的增益 γ/(K_qλ_min)=50（非元素大小），網站 Matrix Inspector 算出 R^{-1} 時會與文字矛盾。

**修正（網站採用）**：改為：「R^{-1}≈[[+50.25,−49.75],[−49.75,+50.25]]；M=0.5R^{-1} 的元素約 +25.13／−24.87。M 沿慢 Eigenvector 的增益為 γ/(K_qλ_min)=50（K_q=1），快模式只有 0.251，所以 GMAC Noise 主要在慢模式被放大。同 N 下慢模式穩態 variance 約 33.3/N，對比一般 LMS μ=0.5 的 0.25/N。」

**數值證據**：1/(1−ρ²)=50.2512563、−ρ/(1−ρ²)=−49.7487437；eig(0.5R^{-1})=50、0.2512563。K_q=1、γ=μ=0.5 時慢模式穩態 variance：preconditioned 33.333/N vs plain LMS μ²λ/(N(1−(1−μλ)²))=0.25063/N，放大 133.0 倍；trace 放大 44.8 倍（33.50/N vs 0.748/N）。

### E22｜§9–10 PE / MIMO｜low（`mimo-lambda-symbol`）

**位置**：§10「(R+λI)^{-1}」、§10.1「λ_i」、§10.2「(J^TJ+λI)^{-1}」「σ_i²+λ」、§19 MIMO LMS 控制「λ」

**問題**：λ 同時代表 R 的 eigenvalue（λ_i、λ_min）與 regularization 參數，且兩種 regularization 的 λ 單位不同：R+λI 中 λ 與 R 同單位，J^TJ+λI 中 λ 與 J² 同單位（匹配模型下 = K_q²·R²）。同一 Lab 同時顯示 λ_min 與 λ 滑桿時容易誤讀，且兩種 regularizer 的 pole 公式不同。

**修正（網站採用）**：Regularization 改用 ε，並分開兩種：(1) M=γ(K_q(R+ε_RI))^{-1}，Pole=1−γλ_i/(λ_i+ε_R)；(2) M=−γ(J^TJ+ε_JI)^{-1}J^T，Pole=1−γσ_i²/(σ_i²+ε_J)，匹配模型下 σ_i=K_qλ_i。λ_i 只保留給 R 的 eigenvalues。§19 MIMO LMS 的控制改為「ε_R 或 ε_J（標示單位）」，並加入 §0 符號表。

**數值證據**：匹配模型 J=−K_qR：σ_i=K_qλ_i，兩種 regularizer 的 poles 分別為 1−γλ_i/(λ_i+ε_R) 與 1−γK_q²λ_i²/(K_q²λ_i²+ε_J)，同一數值的 λ 給出不同 pole。

### E23｜§9–10 PE / MIMO｜low（`mimo-ms-vs-mean`）

**位置**：§9 例子「ρ=0.99, μ=0.5 … 598 次更新」、T11、§19 PE / Eigen Lab（控制只有 ρ, μ, N_0）

**問題**：0.995 與 598 是 mean (ensemble) recursion 的結果。若網站的 PE/Eigen Lab 依 §19 只提供 ρ, μ, N_0 而以 per-sample（N=1）Gaussian regressor 跑 LMS，μ=0.5 在 mean-square 意義下是發散的，模擬會出現與「598 次收斂」矛盾的爆衝；另外對 ±1 sparse-flip codes，個別軌跡呈階梯式歸零，只有 ensemble 平均才依 0.995^k 衰減。

**修正（網站採用）**：T11 與 §9 範例加上標籤 [精確｜mean recursion]，並註明「598 blocks 指 block-averaged（GMAC N 足夠大）的平均誤差；per-sample（N=1）Gaussian regressor 下 μ=0.5 在 mean-square 意義是發散的（MS spectral radius≈1.98），N≥2 時約 0.9925，N=256 時約 0.99003」。PE / Eigen Lab 的控制項要加入 GMAC block 長度 N，並同時顯示 mean 與 mean-square 的 spectral radius。

**數值證據**：Gaussian u、R=[[1,.99],[.99,1]]、μ=0.5 的 MS 轉移矩陣 spectral radius：N=1 → 1.9801（發散）；N=2 → 0.99254；N=16 → 0.99003。MC N=1（2000 chains, 200 steps）：median‖δ‖=0.036 但 E‖δ‖²=4.64（初值 2）。±1 codes per-sample：個別軌跡在第一次 flip（機率 0.005/sample）時直接歸零。

### E24｜§9–10 PE / MIMO｜low（`mimo-pinv-model-mismatch`）

**位置**：§10.2「Jacobian 若在固定點附近有效，該 Regularized Pseudoinverse 的每個非零 Singular Value σ_i 對應平均 Pole p_i=1−γσ_i²/(σ_i²+λ)」

**問題**：此 pole 公式只在 M 由與 plant 完全相同的 J 建構時成立（Ĵ=J）。實務上 M 用量測 Ĵ（有 noise、PVT drift）時 poles 為 eig(I+M(Ĵ)J)，在近奇異 J 時對估計誤差極敏感，λ=0 可能直接失穩；原文只要求「線性化有效」，未提 Ĵ≠J。

**修正（網站採用）**：在公式後加註：「此 Pole 公式在 M 以與 plant 相同的 J 建構（Ĵ=J）時為 [精確｜指定模型]。實務上 M 由量測 Ĵ 建構，Poles 必須以 eig(I+M(Ĵ)J_true) 計算；在近奇異 J 時對 Ĵ 誤差非常敏感（例：ρ=.99、Ĵ 用 ρ̂=.996、γ=1、λ=0 → Pole −1.5 發散；λ=1e-4 → 0.003、0.655）。λ 的作用之一就是提供對 Ĵ 誤差的 robustness。」MIMO Lab 要加入 Ĵ 誤差設定。

**數值證據**：J_true=−[[1,.99],[.99,1]]：Ĵ 用 ρ̂=0.94、γ=.5、λ=0 → poles 0.487、0.917（公式預期 0.5、0.5）；ρ̂=0.995、γ=1 → −1.000（臨界）；ρ̂=0.996、γ=1 → −1.5（發散）；同條件 λ=1e-4 → 0.003、0.655（穩定），λ=1e-3 → 0.003、0.961。

### E25｜§9–10 PE / MIMO｜low（`mimo-table-title`）

**位置**：§10.3 標題「三種架構比較」

**問題**：表格實際有 4 列（Scalar LMS、NLMS/Sign-NLMS、Regularized Preconditioner、Sequential Calibration），而下方網站互動只列「原始/Regularized/Sequential」三種，標題與內容不一致。

**修正（網站採用）**：§10.3 標題改為「四種架構比較」（或「架構比較」）。網站互動加入 NLMS/Sign-NLMS 比較模式；若暫不實作，明確顯示 `Not implemented`，使互動與表格一致。

**數值證據**：表格列數=4；互動說明列出 3 種。

### E26｜§12 Noise / Spur｜low（`noise-bw-approx`）

**位置**：§12 「f_cal,BW≈(1−p)/(2π)·f_u≈−ln p/(2π)·f_u」，以及 §12.1 示例的 12.9 kHz

**問題**：這兩個近似在本例 p=0.92021 下差 4.2%，不能用「≈」直接串在一起。12.9 kHz 只與 −ln p 版（12.924 kHz）和 exact 值（12.931 kHz）相符。若網站照第一個寫出的公式 (1−p)/(2π)·f_u 實作，會顯示 12.40 kHz，T14 會失敗或顯示不一致。(1−p) 版的相對誤差約為 −(1−p)/2。

**修正（網站採用）**：§12 改寫為：f_3dB≈(−ln p)/(2π)·f_u（p→1 時）≈(1−p)/(2π)·f_u（一階近似，相對誤差約 −(1−p)/2）[近似｜需驗證]。本例：exact 12.931 kHz；−ln p 版 12.924 kHz（−0.06%）；(1−p) 版 12.401 kHz（−4.1%）。網站主要顯示 exact 值，近似值並列並附相對誤差百分比。T14 的參考值採 exact。

**數值證據**：(1−p)/(2π)·f_u=12401.10 Hz（相對 exact −4.100%）；−ln p/(2π)·f_u=12923.83 Hz（−0.058%）；exact=12931.28 Hz；(1−p)/√p 近似=12927.56 Hz。

### E27｜§12 Noise / Spur｜low（`noise-bw-exact-domain`）

**位置**：§12 「當 p 不夠靠近 1 時，應使用 exact discrete-time −3 dB 頻率，而不是把近似硬套。」

**問題**：文中沒有給 exact −3 dB 的公式，也沒有說明它在什麼範圍存在。0<p<3−2√2（μK>0.8284）時，|H|² 在 Nyquist 仍高於 DC 的一半，−3 dB 點不存在；網站直接套 arccos 會得到 NaN。−1<p<0 時傳遞函數是 high-pass，「頻寬」的意義不同。p=0 時為 flat。

**修正（網站採用）**：§12 補上：Ω_3dB=arccos(1−(1−p)²/(2p))，f_3dB=(f_u/2π)·Ω_3dB [精確｜指定模型]，適用範圍 3−2√2≤p<1（即 0<μK≤2√2−2≈0.828）。UI 規則：0<p<3−2√2 時顯示「−3 dB 點不存在（Nyquist f_u/2 以內衰減不足 3 dB）」；p=0 標示 flat；−1<p<0 標示「high-pass，不適用 low-pass BW」；|p|≥1（μK≤0 或 μK≥2）標示不穩定，不顯示 BW。

**數值證據**：p_min=3−2√2=0.171573，對應 μK=0.828427。本例 Ω_3dB=0.08319965 rad/block → 12931.28 Hz。DC 與 Nyquist 的增益比為 ((1+p)/(1−p))²，需 ≥2 才有 −3 dB 點。

### E28｜§12 Noise / Spur｜low（`noise-psd-normalization`）

**位置**：§12.2 離散 S_δt(e^{jΩ}) 與 §12.3 單邊連續 S_δt^(1)(f)、L(f)、σ_t,out² 之間

**問題**：§12/§12.2 的 PSD 是 DTFT 形式（σ²=(1/2π)∫S dΩ，單位 s²/(rad/sample)）；§12.3 則使用單邊、s²/Hz 的 S^(1)(f)。兩者之間缺少換算式。網站若把 §12.2 的結果直接代入 §12.3，L(f) 會偏移 10log10(f_s/2)，在 f_s=4 GHz 時約 93 dB。

**修正（網站採用）**：在 §12.2 與 §12.3 之間補上換算：若 σ²=(1/2π)∫_{−π}^{π}S(e^{jΩ})dΩ，則 S^(1)(f)=(2/f_s)·S(e^{j2πf/f_s})，0<f<f_s/2（s²/Hz）；block-rate 量（如 S_w）改用 2/f_u，0<f<f_u/2。範例：S_w^(1)(0)=2μ²σ_η²/((1−p)²f_u)，且 ∫_0^{f_u/2}S_w^(1)df=σ_w²。每張 PSD 圖都要標示 one-sided/two-sided、取樣率（f_s 或 f_u）與單位（s²/Hz、fs²/Hz、rad²/Hz、dBc/Hz）。測試加入 Parseval 核對：積分功率等於時域方差。

**數值證據**：10log10(f_s/2)=93.01 dB（f_s=4 GHz）。以 ENBW 驗證：用 S^(1)(0)=2μ²σ_η²/((1−p)²f_u)，乘上 ENBW 後恰好得到 σ_w=0.39919 fs，確認 2/f_u 因子正確。

### E29｜§12 Noise / Spur｜low（`noise-sw-rate`）

**位置**：§12.2 S_δt(e^{jΩ})=(1/2π)∫S_x(e^{jν})S_w(e^{j(Ω−ν)})dν，其中沿用 §12 的 S_w

**問題**：§12 的 S_w 定義在 block rate（Ω 單位為 rad/block、對應 f_u），而 δt[n] 在 DTC sample rate f_s。同一個符號 S_w 若直接放進 sample-rate 卷積，頻率軸會錯 N=4096 倍，還會漏掉 ZOH hold 造成的 sinc² 形狀與在 f_u 倍數附近的 images。文中雖提到 multirate，但公式本身沒有標示速率。

**修正（網站採用）**：§12.2 增加定義：δw[n]=δw_{⌊n/N⌋}（ZOH hold）。它是 cyclostationary；使用 phase-randomized 的時間平均 PSD：S_w^{(s)}(e^{jθ})=(1/N)·[sin(Nθ/2)/sin(θ/2)]²·S_w(e^{jNθ})，θ 為 rad/sample，S_w 為 §12 的 block-rate PSD [精確｜指定模型（時間平均）]。卷積式改用 S_w^{(s)}，並註明此式忽略 x 與 δw 的相關性和 cyclostationary cross-terms [近似｜需驗證]。所有 PSD 圖的頻率軸必須標明是 f_u（block）還是 f_s（sample）。

**數值證據**：12.93 kHz corner 在 block 軸為 Ω=0.08320 rad/block，在 sample 軸為 2.031×10⁻⁵ rad/sample。ZOH 公式 MC 驗證（N=16、p=0.8、400 次）：PSD 比值中位數 0.99935，總功率 2.7778 與 block 方差相同。

### E30｜全文符號與單位一致性｜low（`notation-T13-conditions`）

**位置**：§17 T13「100 fs noise，N=4096，μ=10 fs：p≈.92021、σ_w≈.399 fs」

**問題**：T13 漏掉本文 §12.1 必要的前提：E[x²]=C=1（unit-RMS code、identity path）、average-mode GMAC、σ_η²=1/N（iid、近平衡）。若改成 sum mode 或其他 code 分布，期望值就不成立，但測試仍會被當作通過。

**修正（網站採用）**：T13 的輸入條件補為：「σ_v=100 fs white Gaussian，unit-RMS code，identity path（C=E[x²]=1），gm_mode=average，N=4096，μ=10 fs，近平衡 σ_η²≈1/N」。期望值：p≈0.92021；σ_w≈0.3992 fs（analytic），MC 以多 seeds 的 95% CI 判定。

**數值證據**：analytic σ_w=0.399186 fs；MC 為 0.3977±0.0017 fs（8 seeds）。sum mode 下 g=326.81，pole=−325.81，會發散。

### E31｜全文符號與單位一致性｜low（`notation-boldC-statespace-sec8.4`）

**位置**：§8.4「G_k=C s_k+Dδ_k」與「A_combined=[[A,B],[−μC,1−μD]]」

**問題**：粗體 C 在 §0 和附錄 A（原始 MIMO 更新）是 E[xu^T]，在 §8.4 卻是 state-space 輸出矩陣。D 在 §7、§8.1（θ=φ+ΩD）和 JSON gm_code_delay_samples 是 GMAC code delay，在 §8.4 卻是 feedthrough。Formula & Unit Reference 頁若做成全站 symbol glossary，§8.4 會被連到錯的定義。

**修正（網站採用）**：§8.4 的一般化式改用 (A_s, b_s, c_sᵀ, d_s)：s_{k+1}=A_s s_k+b_s δ_k；G_k=c_sᵀ s_k+d_s δ_k；δ_{k+1}=δ_k−μG_k；A_combined=[[A_s, b_s],[−μc_sᵀ, 1−μd_s]]；F(z)=d_s+c_sᵀ(zI−A_s)⁻¹b_s。二狀態範例的 r,b,c 也同步改為 r_s,b_s,c_s，避免與 §0 的 C、§7 的 D 衝突。

**數值證據**：二狀態範例對應 A_s=0.8, b_s=0.2, c_s=1, d_s=0。F(1)=c_sb_s/(1−A_s)=1，和 §8.2 的 K=1 一致。

### E32｜全文符號與單位一致性｜low（`notation-delta-polarity-sec3`）

**位置**：§3「代入 LMS 更新，令 δ_n=w_n−a」

**問題**：§3 的 δ 極性和 §0「δ_k=a−w_k（注意極性）」相反。遞迴式是線性齊次，所以兩種極性都長一樣。但網站要求三種模式共用同一個計算核心（§18.2），第 3 章和第 8/9 章畫出的 δ trace 會反號。

**修正（網站採用）**：§3 改為「代入 LMS 更新，令 δ_n=a−w_n（與 §0 一致），則 e_n=δ_n x，δ_{n+1}=δ_n−μe_n x=(1−μx²)δ_n」。§3.1 的 E[δ]、E[δ²] 沿用同一定義（結果不變）。

**數值證據**：用 §1.2 的例子 a=3, w0=1：§0 定義下 δ0=+2，§3 定義下 δ0=−2。遞迴 p=1−μx² 不受影響（μ=0.1, x=2 時 p=0.6）。

### E33｜全文符號與單位一致性｜low（`notation-deltaw-polarity-sec12`）

**位置**：§12「定義 δw_k=w_k−w*」；§12.2「δt[n]=x[n]δw[n]」；§13.1「Static Error 為 −0.4 LSB」；附錄 A「DTC Timing Error」

**問題**：δw=w−w* 的極性和 §0 的 δ=a−w 相反，參考點也不同（w* 和 a；§11 已說明 w*≠a）。因此 δt=(w−w*)x 和 §6 的 e_DTC=(a−w)x 差一個負號（w*=a 時）。§12.3 要求含 Cross-Spectrum（直接 PD 路徑與 LMS 的相關），若混用 e_DTC 和 δt，相關係數會反號。

**修正（網站採用）**：在 §0 新增一列：δw_k=w_k−w*，表示相對 LMS 固定點 w* 的係數偏差，極性與 δ 相反，且 a−w_k=(a−w*)−δw_k。§12.2 改為「DTC 補償量的擾動（多補償的時間）δt[n]=x[n]δw[n]；對應的殘餘 timing error 貢獻為 −x[n]δw[n]（w*=a 時即 e_DTC 中的 gain-noise 項）。計算與直接 PD 路徑的 cross-spectrum 時須使用一致極性」。§13.1 改為「Static Error：w−w*=−0.4 LSB」。

**數值證據**：取 w*=a=3、w=3.4、x=1：e_DTC=(a−w)x=−0.4，δt=x·δw=+0.4。

### E34｜全文符號與單位一致性｜low（`notation-symbol-collisions-misc`）

**位置**：§8.4 c,r,b；§9.2「b'=b+c」；§11.2 c；§19「c_2,c_3」；§13.4 v[n],r[n],y[n]；§8.3 d、§11 d(x)、§16.1「Code n−d」；§11.4 B、§12.2 B、§14 B；§5 m、§12.2 m、附錄 B m；§0 α、§9.1 α,β、§12.4 β；§10 λ_i 與正規化 λ；§5 s、Laplace s、§8.4 s_k

**問題**：同一個符號在不同章節代表不同物理量，會讓 symbol glossary、tooltip 和參數 JSON 發生歧義。例如 §13.4 的 v[n] 和 §0 的 comparator noise 同名。§16.1 用 d 表示 code delay，和 §8.3 的 update delay（blocks）衝突，而 §7 和 JSON 用 D。§10 同一節中 λ_i 是 eigenvalue，λ 又是 regularization。§0 列出 α 為學習率，但全文只在 §9.1 以 PE 下界的意義出現。

**修正（網站採用）**：統一改名：§13.4 的 v[n],r[n],y[n] 改為 ν_q[n]、r_q[n]、y_Q[n]；§0 刪除「α 為學習率」，或註明 α 僅用於 §9.1 的 PE 下界（改名 α_PE、β_PE）；§10 的 regularization 改為 λ_reg；§11.2 用 c_3，§11.3 用 κ，§9.2 的 gauge 常數改 κ_g；§16.1 改為「Code n−D」（與 §7、JSON 一致）；§11.4 改為 B_bias，§12.2 振幅改為 A_w，§14 的 block 數改為 N_blk；§5 改為 m_q=E[q]，§12.2 改為 x̄（code DC）。

**數值證據**：在全文 grep 符號出現位置確認；以上皆為定義衝突，數值本身未受影響。

### E35｜全文符號與單位一致性｜low（`notation-time-index`）

**位置**：§9.1「對所有 k：Σ_{n=k}^{k+N_0−1}」及「R_k」；§7「w_{k+1}=w_k+μE[q[n]u_f[n]]」；§13.4 quantizer 的 n；附錄 B 第 5 點

**問題**：附錄 B 規定 n 為 comparator sample、k 為 GMAC update、m 為 PVT 時間軸，但 §9.1 把 k 當成 sample 窗口起點。§7 把 block index 和期望值、sample index 混在同一式。§13.4 的更新可能每個 reference cycle 一次，也可能每個 GMAC block 一次（§13.5 第 5 點），卻統一用 n。m 又在 §5 和 §12.2 另作他用。

**修正（網站採用）**：§9.1 改為：存在 N_0 與 α_PE,β_PE>0，使得對所有 n_0 都有 α_PE I⪯Σ_{n=n_0}^{n_0+N_0−1}u[n]uᵀ[n]⪯β_PE I；R_{n_0}=(1/N_0)Σ_{n=n_0}^{n_0+N_0−1}u[n]uᵀ[n]。§7 改為 w_{k+1}=w_k+μG_k^{(f)}，其中 G_k^{(f)}=(1/N)Σ_{n∈block k}q[n]u_f[n]（mean dynamics 另寫 E[G_k^{(f)}]）。§13.4 註明 quantizer 的時脈：per GMAC block 用 k，per reference cycle 用 n。

**數值證據**：在全文 grep 索引用法確認；屬一致性問題。

### E36｜全文符號與單位一致性｜low（`notation-typos`）

**位置**：§2.3 表「連 Regessor 幅度也丟掉」；§15.1 L6「仿真與物理模型比對」；§13.2「周期 5」、§15.1「周期性」、T16「周期 5」、附錄 B 第 10 點「PRBS 周期」

**問題**：「Regessor」是 Regressor 的拼字錯誤。「仿真」是簡體中文用語，不符合 zh-TW。「周期」和「週期」在全文混用。

**修正（網站採用）**：第 126 行「Regessor」改為「Regressor」；第 825 行「仿真與物理模型比對」改為「模擬與物理模型比對」；第 716、825、956、1238 行的「周期」統一改為「週期」。

**數值證據**：整理全文英文詞彙清單，只有「Regessor」一處拼錯。

### E37｜全文符號與單位一致性｜low（`notation-var-mode-vs-param-sec10.1`）

**位置**：§10.1「Var(δ_i)≈γ/(K_q²Nλ_i(2−γ))」

**問題**：這裡的 δ_i 是第 i 個 eigen-mode 座標，但 §0 和 §10 的下標 i 都指第 i 個參數。網站若照字面把它當第 i 個參數的 variance 顯示，數值會差很多。

**修正（網站採用）**：改寫為：令 ξ=Vᵀδ（V 為 R 的 eigenvectors），則 Var(ξ_i)≈γ/(K_q²Nλ_i(2−γ))；參數座標下 Cov(δ)≈γ/(K_q²N(2−γ))·R⁻¹=V·diag(Var(ξ_i))·Vᵀ。例：ρ=0.99、γ=0.5、N=4096、σ_v=100 fs 時，mode variance 為 127.8 與 0.642，每個參數的 variance 為 64.2 fs²（依 w 的單位）。

**數值證據**：ρ=0.99, γ=0.5, N=4096, K_q=0.0079788 時，mode variance 為 127.83（λ=0.01）和 0.642（λ=1.99），每個參數的 variance 為 64.24。MC 400k blocks：mode 127.40/0.643，參數 64.03/64.01。

### E38｜Part A（§1–3）｜low（`partA-02`）

**位置**：§3.1「假設樣本 x_n 為 iid、且和前一輪係數誤差獨立」、T03「（依獨立模型）」

**問題**：在 iid 純量 regressor 下，δ_n 只依賴 x_0..x_{n−1}（以及獨立的雜訊），所以與 x_n 獨立是自動成立的，mean 與 mean-square 遞迴都是精確式，不是 independence approximation。依 §0.1 規則，網站可能把它誤標成 [近似｜需驗證]。反過來，Part B 的有效 regressor u=h*x 有時間相關，這時獨立性才真的是近似。

**修正（網站採用）**：§3.1 首句改為：「假設 x_n 為 iid（E[x⁴] 有限），且外加雜訊（若有）為零均值、與 x 獨立。此時 x_n 與 δ_n 自動獨立（δ_n 只由 δ_0 與 x_0…x_{n−1} 決定），以下 mean 與 mean-square 遞迴為精確式 [精確｜指定模型]。」T03 的「（依獨立模型）」改為「（iid 純量 x 模型，精確）」。再加註：「若 regressor 有時間相關（tapped delay line、Part B 的 u=h*x），x_n 與 δ_n 不再獨立，同樣公式降為 independence approximation [近似｜需驗證]。」

**數值證據**：MC（2e6 路徑，seed 20261010），μ=0.5、n=5：E[δ5]=0.03133±0.00068，精確值 0.5^5=0.03125；E[δ5^2]=0.2406±0.0168，精確值 0.75^5=0.2373，都在 CI 內。

### E39｜Part A（§1–3）｜low（`partA-03`）

**位置**：§3「令 δ_n=w_n−a」vs §0 約定表「δ_k=a−w_k（注意極性）」

**問題**：§0 宣告全站統一用 δ=a−w，§3 卻改成 δ=w−a。遞迴 δ_{n+1}=(1−μx^2)δ_n 對符號不變，但網站若在逐步表或圖上顯示 δ，數值正負會相反，與其他章節（例如 Part B 的 δ_{k+1}≈(I−μK_qC)δ_k 和 polarity 討論）不一致。

**修正（網站採用）**：§3 改為「代入 LMS 更新，令 δ_n=a−w_n（與 §0 約定一致）」，並加註：「此遞迴對 δ 的極性不變，但網站顯示 δ 數值時一律用 a−w」。例：T01 的 δ0, δ1, δ2 = +2, +1.2, +0.72。

**數值證據**：sympy 驗證兩種定義下 δ_{n+1}−(1−μx^2)δ_n 都等於 0。T01 例子：δ=w−a 時 δ0,δ1,δ2 = −2, −1.2, −0.72；δ=a−w 時 = +2, +1.2, +0.72。

### E40｜Part A（§1–3）｜low（`partA-04`）

**位置**：§2.2「e=0 處不具唯一導數，可用次梯度」、§2.3 Sign-Error 列，以及 §0 q[n]=sign(e[n]) ∈ {+1,−1}

**問題**：sign(0) 的慣例有兩套：§0 的 comparator 只輸出 ±1，§2.2 的數學 subgradient 允許 sign(0)=0（JavaScript 的 Math.sign(0)=0）。網站的 Sign-Error 實驗剛好用到會產生 e=0 的資料（T01 參數、y=[0,0,0,10] 有重複的 0），所以顯示的穩態值會因慣例和浮點誤差而不同，差距達 O(μ)。

**修正（網站採用）**：在 §2.2 加註：「sign(0) 的慣例必須明定。數學 subgradient 模式用 sign(0)=0。硬體 comparator 模式（§0）只輸出 ±1，tie 映射到 +1 或 −1，可設定且預設與硬體一致。模擬中不可直接依賴 Math.sign(0)=0，也要注意浮點誤差會讓 e 在 0 附近隨機變號。」在 §19 MSE vs MAE 模組的「目標平均/中位數」驗證中加註：「Sign-Error 固定步長的穩態只會落在中位數附近約 ±μ|x| 的帶內，時間平均會因 tie 慣例與算術（exact／IEEE double／fixed-point）偏移 O(μ)。驗證容忍度至少取 μ|x|，並在報告中記錄 tie 慣例。」

**數值證據**：T01 參數（a=3, x=2, w0=1, μ=0.1）跑 Sign-Error：精確算術加 sign(0)=0 時凍結在 3.0；sign(0)=+1 時在 {3.0, 3.2} 循環；sign(0)=−1 時在 {2.8, 3.0} 循環；IEEE double 下 1+10·0.2=3.0000000000000004，在 {2.8, 3.0000000000000004} 循環。y=[0,0,0,10]、μ=0.2、隨機抽樣（seed 7，4e5 步）的時間平均 w：sign(0)=0 → 0.1003（Markov 穩態理論 μ/2=0.1），+1 → 0.1997（理論 μ=0.2），−1 → 0.0004（理論 0）。

### E41｜Part A（§1–3）｜low（`partA-05`）

**位置**：§1 J2(w)=E[(y−wx)^2] 與 §1.1 j_n=½e_n^2、「LMS 是…近似平均成本 J2 的 Gradient Descent」

**問題**：J2 沒有 ½，單筆成本 j_n 卻有 ½，兩者的梯度差 2 倍。LMS 其實是對 ½J2（或對 J2 用步長 μ/2）的 SGD。網站的 Cost Curve 若畫 J2 並以 μ 示範 gradient descent，畫出的切線斜率和步長會比實際 LMS 更新大 2 倍；若有人用 J2 的 Hessian（2P_x）推步長界，會得到 1/P_x 而不是 2/P_x。

**修正（網站採用）**：§1 改為 J2(w)=½E[(y−wx)²]（argmin 不變），讓單筆成本 j_n=½e_n² 的期望值剛好等於 J2。或者保留原式並明寫：「LMS 更新等於對 J2 以步長 μ/2 做隨機梯度下降：w_{n+1}=w_n−(μ/2)∇̂J2。」網站 Cost Curve 與 gradient 圖的斜率標註，要與實際更新量 μex 使用同一個 scaling。

**數值證據**：sympy：d(e^2)/dw = 2x(wx−y)，d(½e^2)/dw = x(wx−y)。對 ½J2 用步長 μ 做 GD 的平均穩定界為 0<μ<2/P_x（符合 §3.1）；對 J2 用步長 μ 則為 0<μ<1/P_x。

### E42｜Part A（§1–3）｜low（`partA-06`）

**位置**：§3.1「**均方誤差**（先無外加量測雜訊）：E[δ_{n+1}^2]=…」

**問題**：這裡的 E[δ^2] 是係數的 mean-square deviation（MSD），不是 §1 的 MSE 成本 J2=E[e^2]。網站若把 E[δ^2] 的曲線標成「均方誤差 / MSE」會造成混淆，尤其加入雜訊或 P_x≠1 時兩者數值不同。

**修正（網站採用）**：§3.1「**均方誤差**（先無外加量測雜訊）」改為「**係數均方偏差 MSD** E[δ²]（先無外加量測雜訊）；注意它不是 §1 的 MSE 成本 J2=E[e²]」。補充：「iid x、雜訊零均值且與 x 獨立時，E[e²]=P_x·E[δ²]+σ_v² [精確｜指定模型]。有雜訊時穩態 MSD=μP_xσ_v²/(2P_x−μE[x⁴])，在同一個 μ=2P_x/E[x⁴] 處發散。」網站圖例請分別標「MSD E[δ²]」與「MSE E[e²]」。

**數值證據**：推導：e=−δx+v ⇒ E[e^2]=E[δ^2]P_x+σ_v^2。固定 x=2、μ=0.1、σ_v=1（2e5 路徑，seed 5）：var(w) MC=0.06271，理論 μσ_v^2/(2−μx^2)=0.0625。

### E43｜Part A（§1–3）｜low（`partA-08`）

**位置**：§2.3 表格 Sign-Sign LMS 列「連 Regessor 幅度也丟掉」

**問題**：'Regessor' 拼錯，網站會原文顯示。

**修正（網站採用）**：§2.3 表格 Sign-Sign LMS 列改為「連 Regressor 幅度也丟掉，別和 Sign-Error 混淆」。

**數值證據**：§0 與全文其他地方都寫 'regressor'。

### E44｜§6–7 Polarity / Delay / Filtered-x｜low（`polarity-ct-dt-mapping`）

**位置**：§6.1 「H_PD(s)=s²/(s²+2ζω_ns+ω_n²)…在 ω=0.3ω_n，H≈-0.0815+j0.0376，相位約 155.2°」；搭配 §6.1 的 H(e^{jΩ})、§6.2 的 H_PD(e^{jΩ}) 與 §7 的 H_PD(Ω)

**問題**：§6.1 的相關公式與 §6.2/§7 的積分都是 discrete-time（Ω 為 rad/sample，在 comparator sample rate 上），但唯一的數值例子用 continuous-time H_PD(s) 在 ω=0.3ω_n 求值，且全文沒有說明 CT→DT mapping（Ω=ωT_s、T_s 是 f_ref 還是 f_s、loop latency、DTC 注入的 pulse shape）。§7 寫成 H_PD(Ω) 更容易讓實作者直接代入 H_PD(jΩ)，把 rad/sample 與 rad/s 混用。另外 H_PD(∞)=1（有 direct feedthrough），impulse-invariant 取樣的 aliasing 和不收斂，不能把 CT high-pass 直接取樣成 DT。這個例子本身的符號結論不受影響，但網站若用 CT 式畫 polarity 邊界或計算多頻 C，數值會偏掉。

**修正（網站採用）**：§6.1 的例子後補註：「此為 continuous-time 參考模型，數值 [近似｜ω_nT_s≪1、無額外 loop latency]，對應 Ω=ωT_s（T_s 為 comparator/PD 取樣週期；若 f_s≠f_ref 必須另做 multirate 推導）。」§6.2 和 §7 的積分一律寫成 S_xx(e^{jΩ})、H_PD(e^{jΩ})，Ω 單位為 rad/sample。§7 的 H_PD(Ω)、S_xx(Ω) 一併改成 e^{jΩ} 形式。另外提供網站用的 DT 參考模型（假設 PLL loop 與 comparator 同一取樣率）：H_PD(z)=1/(1+L(z))，L(z)=(K_p+K_i/(1-z^{-1}))·z^{-(1+d)}/(1-z^{-1})，d 為額外 loop latency。K_p=2ζω_nT_s、K_i=(ω_nT_s)²，只在 ω_nT_s≪1 時與 CT 式對應。網站要計算 C、C_D 或畫 polarity 邊界時，必須用 H(e^{jΩ}) 或 FIR h[n]，不可代入 H(jΩ)。並在說明中註明：L(z) 嚴格因果時 h[0]=1，所以白色 x 下 C=σ_x²>0（精確）；Re{H}=0 的邊界會隨 ω_nT_s 和 d 偏離 ω_n（例如 ω_nT_s=0.3、d=1 時約 1.49ω_n）。

**數值證據**：Ω=0.3ω_nT 的相位：CT 為 155.2249°。DT 在 d=0 時為 155.240°/155.378°/155.700°（ω_nT=0.01/0.1/0.3），d=1 時為 155.426°/157.238°/161.281°。Re{H}=0 的 polarity 邊界在 CT 是 ω_n；ω_nT=0.1 時 DT 移到 1.037ω_n(d=0)/1.122ω_n(d=1)，ω_nT=0.3 時移到 1.131ω_n/1.493ω_n。ω=ω_n 處的相位在 CT 是 90°，ω_nT=0.3 時 DT 為 98.90°(d=0)/120.67°(d=1)。白色 x 下，naive 代入 H_c(jΩ/T) 得 C=0.93097σ²，DT 則恰為 h[0]σ²=1.00000σ²。1 階 high-pass x 下為 0.99628 vs 1.07500(d=0)/1.00000(d=1)。

### E45｜§6–7 Polarity / Delay / Filtered-x｜low（`polarity-fx-mismatch`）

**位置**：§7 Filtered-x：「w_{k+1}=w_k+μE[q[n]u_f[n]]」與「若 Ĥ=H，小誤差下 E[qu]≈K_q(a-w)E[u²]」

**問題**：(1) 更新式用期望值寫成，且把 sample index n 和 block index k 混在一起。這是平均 ODE，不是可實作的 block 更新，也違反附錄 B 第 5 點「時域索引嚴格分開」。(2) 規格只給 Ĥ=H 的情形，也沒有說明 E[qu] 中的 u 實際應為 regressor u_f。網站 filtered-x 模式若有模型誤差滑桿，照字面會一律顯示 1-μK_qE[u²] 這個 pole，即使 Ĥ≠H，數字仍會誤導。

**修正（網站採用）**：將 §7 更新式改為可實作的 block 形式：G_k=(1/N)Σ_{n∈block k} q[n]u_f[n]，w_{k+1}=w_k+μG_k（平均 ODE 另寫為 E[G_k]，並標示 [近似｜小誤差、Gaussian v、長時間平均]）。補上一般 model mismatch 公式：E[G_k]≈K_q(a-w_k)·E[u u_f]，E[u u_f]=(1/2π)∫_{-π}^{π}S_xx(e^{jΩ})Re{H_PD(e^{jΩ})Ĥ*(e^{jΩ})}dΩ，平均 pole p_f=1-μK_qE[u u_f]。只有 Ĥ=H 時才退化為 E[u²]≥0。若主要激勵頻帶上 |∠H_PD-∠Ĥ|>90°（例如 Ĥ 少算或多算幾個 sample 的 latency），E[u u_f] 可能 ≤0，filtered-x 同樣會反向更新。網站的 filtered-x 模式若允許 Ĥ≠H，Analytic pole 一律用 E[u u_f]，不可用 E[u²] 或 E[u_f²]。

**數值證據**：9-tap 以內的 FIR h、AR(1) x、δ=5 fs、σ_v=100 fs。Ĥ=H 時 MC E[q u_f]=7.41239e-2±6.9e-4，K_qδE[u²]=7.41554e-2。Ĥ=H·z⁻³ 時 MC 2.96895e-2±4.8e-4，K_qδE[u u_f]=2.97552e-2，此時 E[u u_f]=0.7459，而 E[u²]=1.8588（差 2.49 倍）。

### E46｜§6–7 Polarity / Delay / Filtered-x｜low（`polarity-tone-edge-cases`）

**位置**：§6.1 boxed E[xu]=(A²/2)|H|cosφ；§7 boxed C_D=(A²/2)|H|cos(φ+ΩD)；T06/T07；§19 Polarity Explorer（|H|,φ,Ω,D 獨立滑桿）

**問題**：單頻公式只在 0<Ω<π 且 E[·] 為無限長時間平均（或隨機初相 ensemble）時成立，但規格沒有寫出這些條件。Ω=0 或 π 時 cos(2Ωn+φ) 項不會平均掉，實際值是 A²|H|cosφ，是公式的 2 倍。實數 h 在 Ω=0、π 也無法產生 φ≠0°/180°；若網站用獨立滑桿合成 u=A|H|cos(Ωn+φ)，Analytic 值與 Monte Carlo 會差 2 倍。GMAC 使用有限 N 的 block average 時還有 ripple，在 Ω 接近 0 或 π（例如 H_PD 例子的 Ω=0.3ω_nT）時很明顯。

**修正（網站採用）**：在 §6.1、§7 的 boxed 公式和附錄 A 旁加註「[精確｜單頻、0<Ω<π、長時間平均或整數週期平均]」。Ω=0 或 π 時，實數 h 只能讓 H(e^{jΩ}) 為實數（φ∈{0°,180°}），此時 C_D=A²·H(e^{jΩ})·cos(ΩD)，是一般公式的 2 倍（例如交替碼 x=A(-1)^n 時 C_D=A²H(e^{jπ})(-1)^D）。Polarity Explorer 在 Ω=0、π 時要禁止選非 0°/180° 的 φ，或自動切換到上式。有限 N block（n=n0…n0+N-1）時，可額外顯示 G_k 的單頻確切值：(A²|H|/2)[cos(φ+ΩD)+cos(2Ωn0+Ω(N-1)+φ-ΩD)·sin(NΩ)/(N sinΩ)]，ripple 上界為 (A²|H|/2)·min(1, 1/(N|sinΩ|))。並說明 N|sinΩ| 很小時，單一 block 的符號可能翻轉，但多 block 平均會回到上述長時間平均值。

**數值證據**：A=|H|=1：Ω=π、φ=0° 時時間平均 +1.0000，公式 +0.5000。Ω=π、φ=120°（合成 u）時 -0.5000，公式 -0.2500。φ=-120°、N=64：Ω=0.01 的 block 值 -0.20045、Ω=π-0.01 的 block 值 -0.67655，理想值皆為 -0.25，上界 0.78126。N=1024、Ω=π-0.01 時 -0.28451（上界 0.04883）。

### E47｜§13–14 Quantization / Learning Rate｜low（`quant-01`）

**位置**：§13.2「五週期 Toggle 帶有 f_toggle/5 及其諧波成分」

**問題**：f_toggle 未定義（code 更新率？toggle 次數？），且描述會讓網站把 f/5 當主 Spur。實際上 [32,32,33,32,33] 的主要能量在第 2 諧波 2f/5，f/5 只佔約 13%。在 code 更新率 f_upd 的離散時間觀點中只有 f/5 與 2f/5 兩條獨立譜線（k=3,4 為鏡像）；只有在 ZOH 保持到較高的 f_s 時，更高的 k·f_upd/5 才會出現。

**修正（網站採用）**：§13.2 改寫為：「令 f_u 為 6-bit code 的更新率（若 code 每個 reference cycle 更新，則為 f_ref；若每個 GMAC block 更新，則為 f_s/N）。週期 5 序列 [32,32,33,32,33] 的誤差 e=w−32.4 在離散時間（以 f_u 取樣）中只有兩條獨立譜線：f_u/5 為 peak 0.2472 LSB（功率 0.03056 LSB²），2f_u/5 為 peak 0.6472 LSB（功率 0.20944 LSB²）。主要 Tone 在 2f_u/5，比 f_u/5 高 8.36 dB，總功率 0.24 LSB²，DC 誤差為 0。若 code 以 ZOH 保持到更高的取樣率，k·f_u/5（k≠5m）都會出現，並帶 sinc² 權重。同樣是 3 個 32、2 個 33，排列順序會改變能量分配，例如 [32,32,32,33,33] 會把 0.20944 LSB² 移到 f_u/5。這些成分再與 DSM Code 相乘，可能出現 Spurs。」[精確｜指定模型]。T16 建議增列：f_u/5 功率 0.03056 LSB²、2f_u/5 功率 0.20944 LSB²、總和 0.24 LSB²。

**數值證據**：DFT of e=[−0.4,−0.4,0.6,−0.4,0.6]：|X1|=0.618034、|X2|=1.618034；powers 0.0305573/0.209443，sum 0.24000；10log10 ratio 8.3595 dB。ZOH N=64：k=1 0.02674、k=2 0.11998、k=3 0.05333、k=4 0.00167、k=7 0.00981 LSB²，總和 0.24。

### E48｜§13–14 Quantization / Learning Rate｜low（`quant-04`）

**位置**：§14 boxed E[δ_B²]≈δ0²p^{2B}+μ²σ_η²(1−p^{2B})/(1−p²)，以及 §14.2 Coarse Calibration

**問題**：在線性 iid 模型下，此式是 exact（不論 η 分布，p 為負也成立）；對 1-bit Sign-LMS 則只在 |δ0| ≪ σ_v 時近似成立，原文未給適用範圍。δ0 大時 comparator erf 飽和，每個 block 的步長被限制在 μ·max|x|（slew-limited），公式會嚴重低估 E[δ_B²]。§14.1 的 μ 區間與 §14.2 Coarse Calibration（大 δ0、大步長）正落在這個失效區。另外 p²=1（g=0 或 g=2）時分母為 0，原文未處理。

**修正（網站採用）**：§14 boxed 式改標：「[精確｜線性化 iid 模型]（δ_{k+1}=pδ_k+μη_k，η 零均值、與 δ 獨立，任意分布皆成立）；對 1-bit Sign-LMS 為 [近似｜需驗證]。」

並補上適用範圍：「以 T13 參數做 Monte Carlo（σ_v=100 fs、N=4096、μ=10 fs、B=30），|δ0|≲0.2σ_v 時誤差約 ≤1%；δ0=0.5σ_v 時低估約 5%，δ0=σ_v 低估約 17%，δ0=2σ_v 低估約 52%，δ0=4σ_v 低估約 92%。|δ0|≳0.5σ_v（例如 §14.2 的 Coarse Calibration）時，comparator 飽和、每個 block 的步長受 μ·max|x| 限制（slew-limited），應改用 B≳(|δ0|−目標)/(μ·max|x|) 粗估，或直接以 Monte Carlo 計算。」

另補一句：「g=0 時（p=1）E[δ_B²]=δ0²+Bμ²σ_η²；g≥2 時不穩定，不適用此式。」

**數值證據**：T13 參數 (σ_v=100 fs, N=4096, μ=10 fs, g=0.079788)，200k trials、B=30：δ0=10 fs → MC 0.84531±0.00306 vs 0.83944（−0.7%）；δ0=50 → 18.013 vs 17.188（−4.6%）；δ0=100 → 82.30 vs 68.28（−17.0%）；δ0=200 → 569.9 vs 272.6（−52.2%）；δ0=400 → 12887 vs 1090（−91.5%）；δ0=400 時 E[δ_30] MC=113.5 fs vs 線性 p^Bδ0=33.0 fs。線性模型 MC 4 組配置 z-score 皆在 ±1.3 內。

### E49｜§13–14 Quantization / Learning Rate｜low（`quant-05`）

**位置**：§13.1「選 w=32，Static Error 為 −0.4 LSB」

**問題**：誤差的正負號取決於定義：§0 規定 δ=a−w，此時誤差為 +0.4 LSB；§12 的 δw=w−w* 才是 −0.4 LSB。網站若依 §0 的全域約定顯示，會與本文數字相反。

**修正（網站採用）**：§13.1 改為：「選 w=32，係數誤差 w−w*=−0.4 LSB（依 §0 約定即 δ=a−w=+0.4 LSB）；static error power 為 0.16 LSB²，全部集中在 DC（對比方法 B/C 的 0.24 LSB²，但 B/C 的 DC 誤差為 0）。」網站 UI 在顯示此誤差時，需同時標出所用的 sign convention（δ=a−w 或 δw=w−w*）。

**數值證據**：32−32.4 = −0.4；32.4−32 = +0.4；(0.4)² = 0.16 LSB²（freeze 的 MSE，對比 toggle/stochastic 的 0.24 LSB²）。

## 已反駁（不列為勘誤）

- `partA-07`（Part A（§1–3））：§1「希望根據一筆一筆進來的 (x,y)，逐步估計 a」與 J2 的 w*=argmin — 反駁理由：The algebra is correct: w*=E[xy]/E[x²]=a+E[xv]/E[x²]. But §1–3 never state w*=a under noise. §1.2 and §3 work noise-free, and 'sample noise' in an LMS Playground means zero-mean noise by convention. Bias, offset and correlated error are covered on purpose in Part C §11 and in the Part B comparator-offset discussion. The Sign-Error fixed point is labeled the 'MAE 目標' in §2.3, so it is already distinguished from a. A careful engineer would not get a wrong number from §1 as written. A nonzero-mean 
- `comparator-T05-tie-tolerance`（§5 Comparator）：§17 T05「上述 comparator、N≈42500｜方向判斷成功率約 95%（iid/CLT）」，以及 §5 表格「約 42,500 → 95%」「約 85,000 → 99%」 — 反駁理由：I reproduced the numbers. The CLT gives N_95=42497.29 and N_99=85007.26. With exact binomial and strict G>0, N=42500 gives 0.949501; with random tie-break it gives 0.950002; N=42501 gives 0.950006. The smallest N reaching 95% is 42499 for odd N or tie-split, and 42750 for strict even N. For 99% it is 85011 and 85260. But T05 says 「N≈42500｜方向判斷成功率約 95%（iid/CLT）」, which explicitly marks it as an approximate CLT check. The §17 preamble already says tolerance must be set by the implementation and th
- `margin-notation-D-C-collision`（§8 Phase Margin / Dual Loop）：§8.1「θ=φ+ΩD」（D=delay）對照 §8.4「G_k=Cs_k+Dδ_k」「A_combined=[[A,B],[−μC,1−μD]]」「F(z)=D+C(zI−A)^{-1}B」；§0 約定表「C = E[xu^T]」 — 反駁理由：符號重複使用確實存在：§7、§8.1 的 D 是 delay（samples），§8.4 的 D 是 state-space feedthrough；§0 的粗體 C=E[xu^T]，§8.4 的粗體 C 卻是 output matrix。不過 §8.4 在 G_k=C s_k+Dδ_k 中已經就地定義了這兩個符號，而且 (A,B,C,D) 是所有控制工程師都認得的標準 state-space 記號，細心的工程師不會因此算錯任何數字。網站方面，Dual-Loop Explorer 的參數是 r,b,c,μ（見 §18 第 1033 行），Phase Margin Lab 的參數是 g,d，都沒有把 C 或 D 當成 UI 參數或共用 parameter key。附錄 A 公式速查也沒有收錄 §8.4 的 state-space 式，所以不會出現 tooltip 誤標。auditor 描述的「parameter store 共用 key 導致錯標」只是假設的實作失誤，spec 並沒有這樣要求。結論：這是記號整潔度的建議，不是會導致錯誤數字或宣稱的缺陷。
- `mimo-var-validity`（§9–10 PE / MIMO）：§10.1「Var(δ_i)≈γ/(K_q²Nλ_i(2−γ))」 — 反駁理由：Derivation verified. In eigen-coordinates the preconditioned recursion is δ_i'=(1−γ)δ_i−(γ/(K_qλ_i))η_i with Var(η_i)=λ_i/N. That gives γ²/(K_q²Nλ_i·γ(2−γ))=γ/(K_q²Nλ_i(2−γ)). My MC (σ_v=1, sign comparator, Gaussian u) gives ratios of 1.001 and 1.002 for ρ=.99, γ=.5, N=256, and 0.998 for ρ=.9, γ=.1, N=64. The 0.835 ratio at γ=1.5, N=64 comes from comparator saturation, which violates the explicitly stated '近平衡' assumption. Non-Gaussian, temporally correlated codes violate the stated '理想獨立、高斯' as
- `mimo-counterexample-mechanism`（§9–10 PE / MIMO）：§10.2「反例：J=[[−1,2],[2,−1]] … M=0.2I 產生 Pole 1.2、0.4，因此一起更新時發散」及 §19.2 Preset 12 — 反駁理由：The numbers are correct: eig(J)=+1, −3, and eig(I+0.2J)=1.2, 0.4. The counterexample sits in §10.2, the measured-Jacobian section. A measured J=−K_qC with C=E[xu^T] is explicitly allowed to be non-symmetric and indefinite (§0 table), so it does not have to come from the matched R model. The claims 'each loop alone is stable (single-loop pole 0.8), together they diverge' and Preset 12's description are accurate. The spec never says that reducing μ fixes it. Pointing out that it is a polarity (C<0
- `mimo-pe-stochastic`（§9–10 PE / MIMO）：§9.1「存在窗口長度 N_0 及常數 α,β>0，對所有 k：αI⪯Σu u^T⪯βI」 — 反駁理由：§9.1 gives the standard deterministic (uniform) PE definition. That is the appropriate definition for DSM/FCW-derived codes and LFSR training sequences, which are deterministic or periodic. The spec already warns that a finite measurement window cannot prove PE for all future windows. It does not prescribe a pass/fail test on λ_min(R_k). The auditor's 60% rank-deficient-window figure (I get 0.995^99≈0.609) comes from an extreme ρ=.99 sparse-flip model, in which those windows genuinely carry no e
- `bias-nearint-branch`（§11 Bias / INL）：§11.4「若 C(FCW)→0，而干擾 Bias B 不為零，線性化固定點 w*=a+B/C 可能異常敏感」 — 反駁理由：The auditor's math is right, but the spec already covers both concerns. My exact enumeration of the toy model gives: C=0.04, B=0.1 → root−a=2.5, S=−0.00694 vs −K_qC=−0.0319; C=0.2, B=0.4 → S=−0.0408 vs −0.1596; C=−0.2 → S=+0.127, i.e. repelling. Point (1), a C<0 repelling root: §6 already states that C<0 makes positive-μ updates diverge. §19 explicitly requires 「C≤0 不可只寫『無法計算』，而要標出 polarity 問題」. §11.4 item 1 lists 「有效 GMAC Sensitivity / Polarity」. Point (2), weaker restoring slope at a heavily b
- `bias-symbol-c-collision`（§11 Bias / INL）：§11.2「e=(a-w)x+cx³, a=1,c=0.1」與 §11.3「若 u[n]=cx[n]，… w*=a+c」；§19 Bias & INL Lab 控制項「b,c_2,c_3」 — 反駁理由：The spec does reuse c in §11.2 and §11.3, but the website controls already separate them. §19 names the Bias & INL Lab controls b, c_2, c_3, and Preset 7 uses c_3=0.1. §11.3's coupling coefficient is a local illustrative symbol, not a lab control. Symbol reuse is common across this spec (b and c also mean different things in §8.4 and §9.2), so this is a notation preference. The 1.44 scenario requires an implementer to merge a parameter the spec already renamed to c_3 with an unrelated one. That 
- `notation-appendixA-notation`（全文符號與單位一致性）：附錄 A「原始 Code Correlation：C=E[x(H*x)]」；「原始 MIMO 更新：δ_{k+1}≈(I−μK_qC)δ_k」；「Jacobian 更新：A=I+MJ」；「一階 LMS PM：g=μK」 — 反駁理由：附錄 A 的公式都正確。G=(1/N)Σq𝐱≈K_qE[𝐱𝐮ᵀ](𝐚−𝐰)=K_q𝐂𝛅，所以 𝛅_{k+1}≈(𝐈−μK_q𝐂)𝛅_k 與 §0 一致；A=I+MJ 與 §10.2 的 A_cal 推導一致；T18 的 eigenvalue 為 1.2/0.4，J 的 eigenvalue 為 +1/−3，皆已驗證。H*x 對 h*x、δ 沒加粗、A 對 A_cal 都只是記號風格，不會讓工程師或網站算錯。K 未在 §0 定義的問題已併入 notation-units-mu-w-K-u。可選擇性順手清理。

## 未通過「correct」的個別聲明（含已併入上方勘誤者）

### Part A（§1–3）（檢查 26 項）

- [imprecise] §1 模型 y=ax+v, ŷ=wx, e=y−ŷ；J2(w)=E[(y−wx)^2], w*=argmin J2：w* = E[xy]/E[x^2] = a + E[xv]/E[x^2]；只有在 E[x v]=0 且 E[x^2]>0 時 w*=a。規格沒寫出這個條件
- [imprecise] §1.1 「LMS 是…近似平均成本 J2 的 Gradient Descent」：∂(e^2)/∂w = 2x(wx−y)，所以 LMS 其實是 ½J2 的 SGD，或等於對 J2 用步長 μ/2 的 SGD；兩者相差 2 倍
- [ambiguous] §3.1 隱含的穩定性分類（mean vs mean-square）：Lyapunov exponent λ(μ)=E log|1−μx^2| 在 0<μ<μ_as=2.421250 時為負，因此樣本路徑在 μ<2.4213 時幾乎必然收斂；在 μ=1/3: −0.4201，2/3: −0.4864，1: −0.4170，2: −0.1162，2.5: +0.0206。速度最快的 a.s. 收斂在 μ≈0.5855
- [imprecise] §17 T03 的 Monte Carlo 驗證方式：μ=0.8、N=200、1e4 seeds：理論 log10 E[δ^2]=+24.11，樣本平均 log10=−48.31，中位數 log10|δ|=−40.28。μ=0.8、n=5、2e6 seeds：MC 3.287±0.276，理論 4.0075（重尾使 CI 失效）
- [imprecise] §3.1 「假設…且和前一輪係數誤差獨立」/ T03「依獨立模型」：iid 純量 x 下 δ_n 只依賴 x_0..x_{n−1}，獨立性自動成立，遞迴是精確的（見上方 MC）；只有在相關 regressor（u=h*x、tapped delay line）時才是近似

### §5 Comparator（檢查 18 項）

- [error] §5 'P(G_N>0)≈Φ(m√N/√(1-m²))'：N 為奇數時，這個式子剛好等於 continuity-corrected CLT，非常準（N=101：CLT 0.531956，exact 0.532034）。N 為偶數時它近似的是 P(G>0)+½P(G=0)，不是嚴格的 P(G>0)。N=100：CLT 0.531798，exact strict P(G>0)=0.492050，P(G=0)=0.079336。偶數 N 的嚴格版 continuity-corrected 應為 Φ((Nm-1)/√(N(1-m²)))=0.491937
- [error] §5 table row N=100 → 53.2%：嚴格 G_N>0 的 exact binomial：49.2050%（低於 50%）；P(G=0)=7.9336%；P(G<0)=42.8614%。53.2% 只在兩種情況成立：tie 用公平隨機決定（53.1718%），或 N=101（53.2034%）。若 tie 判為正（G≥0，即 sign(0)=+1）則為 57.1386%。MC（4e5 trials）：P(G>0)=0.49344 [0.49189, 0.49499]，P(G=0)=0.07956 [0.07872, 0.08040]
- [error] §5 table row N=1,000 → 60.0%：嚴格 exact：58.7359%；P(G=0)=2.4435%；P(G<0)=38.8207%；CLT 59.9602%；tie 平分 59.9576%；N=1001 為 59.9674%。MC（1e5 trials）：P(G>0)=0.58931 [0.58626, 0.59236]，信賴區間不含 60.0%
- [imprecise] §5 table row N=10,000 → 78.8%：嚴格 exact：78.4624%；P(G=0)=0.5803%；CLT 78.7535%；tie 平分 78.7525%；N=10001 為 78.7548%。MC（2e4 trials）：0.78040 [0.77466, 0.78614]，信賴區間不含 78.75%
- [ambiguous] §5 parity behaviour (implicit)：嚴格 P(G_N>0) 會隨奇偶 N 呈鋸齒狀：N=1 為 0.503989，N=2 為 0.254005，N=3 為 0.505984，N=4 為 0.318508，N=99 為 0.531718，N=100 為 0.492050，N=101 為 0.532034，N=102 為 0.492758
- [ambiguous] §17 T05：CLT 0.950005；exact 嚴格偶數 N=42500 為 0.949501（若 assertion 寫 ≥0.95 會失敗）；tie 平分 0.950002；N=42501 為 0.950006；P(G=0)=0.001001

### §6–7 Polarity / Delay / Filtered-x（檢查 18 項）

- [imprecise] §6.1 boxed E[xu]=(A²/2)|H|cosφ：0<Ω<π 且 E 為無限時間平均（或隨機初相）時正確；Ω=0 或 π 時為 A²|H|cosφ（2 倍）；有限 N block 誤差上界 (A²|H|/2)/(N|sinΩ|)
- [ambiguous] §6.1→§6.2/§7 使用 CT H_PD(s) 於 DT 相關：未給 CT→DT mapping。DT Type-II（L(z)=(K_p+K_i/(1-z⁻¹))z^{-1-d}/(1-z⁻¹)，K_p=2ζω_nT，K_i=(ω_nT)²）在 Ω=0.3ω_nT：d=0 → 155.240°(ω_nT=0.01)/155.378°(0.1)/155.700°(0.3)；d=1 → 155.426°/157.238°/161.281°。範例符號結論不變，但 Re{H}=0 邊界由 ω_n 移至 1.037ω_n(d=0)/1.122ω_n(d=1) @ω_nT=0.1，1.131/1.493ω_n @0.3
- [imprecise] §7 filtered-x 更新式 w_{k+1}=w_k+μE[q[n]u_f[n]] 與 Ĥ≠H 情形：可實作者應為 G_k=(1/N)Σ_{n∈block k} q[n]u_f[n]；Ĥ≠H 時平均增益為 K_q(a-w)(1/2π)∫S_xx Re{HĤ*}dΩ：Ĥ=Hz⁻³ 時 E[uu_f]=0.7459（≠E[u²]=1.8588），MC 2.96895e-2 vs 預測 2.97552e-2

### §8 Phase Margin / Dual Loop（檢查 27 項）

- [ambiguous] 8.1 wrap_180(θ) 記號：正確的 [−180°,180°) wrap：θ=−150° → M=−60°；若誤實作成 θ mod 180°：M=+60°（cos(−150°)=−0.866，實際極性錯誤）；θ=200° 時正確 M=−70°，mod-180 版本卻得 +70°
- [ambiguous] 8.4 標題「時間尺度分離」與例子的歸因：完整上界 (1−r)/(bc) 恰為 quasi-static 上界 2(1−r)/(bc) 的 1/2，對所有 r 都成立（r=−0.5, 0, 0.5, 0.8, 0.95, 0.99 皆以 bisection 確認）；r=0 時正好退化成 §8.3 的 d=1 情況。慢 pole 的近似 1−μ 只在 μ≪(1−r)²/(4bc)=0.05 時成立
- [ambiguous] 8.1/8.4 記號 D 與 C：§8.1 θ=φ+ΩD 中 D 是 delay（單位 samples）；§8.4 G_k=Cs_k+Dδ_k 中 D 是無因次的 feedthrough gain；§0 定義 C=E[xu^T]（correlation），§8.4 的 C 卻是 output matrix

### §9–10 PE / MIMO（檢查 28 項）

- [imprecise] T11 / §9 mean-square 意涵：Mean recursion 正確；但 per-sample (N=1) Gaussian regressor 的 mean-square recursion spectral radius=1.9801（MS 發散）；block N=2 時 0.99254、N≥4 時≈0.99003（穩定）。±1 sparse-flip codes 每條軌跡呈階梯式歸零，只有 ensemble mean 依 0.995^k 衰減
- [ambiguous] §9.1 PE 定義：作為 deterministic PE 定義正確；但對 iid/隨機 ±1 codes，固定 N0 的 degenerate 窗口必然（a.s.）出現。ρ=.99 的 ±1 模型、N0=100：60.0% 的窗口 λ_min(R_k)=0（理論 0.995^100=0.6058）
- [imprecise] §9.2 處理方式：raw-x domain 下正確；但經 H_PD(1)=0 的 PD path 後 R_u 有兩個零 eigenvalue（b 與 a_i common-mode），前兩種約束只解 a_i gauge，b 仍不可辨識
- [imprecise] §9.2 DC suppression：以本文 §6 H_PD(s)=s²/(s²+2ζω_n s+ω_n²) 的 bilinear 版本（ω_n=0.05 rad/sample, ζ=0.7, T=400k）：R_u eig=[~-9e-17, 6e-31, 0.2453, 0.2458, 0.2462]，R_u[b,b]=6e-31，RMS(Σu_i)=5e-15 → 完全不可觀察，不是「更難」
- [ambiguous] §10.1 一般 LMS μ=.5 慢 pole 0.995 / 598 次：僅在 K_q=1（μ 代表 μK_q）時成立；用 §5 的 K_q=0.00797885/fs：慢 pole=0.99996011，95% 需 75,091 次
- [ambiguous] §10.1 M=0.5R^{-1}：K_q=1 時正確（log0.05/log0.5=4.32→5；0.5^4=0.0625、0.5^5=0.03125）；與 M=γ(K_qR)^{-1} 不一致：K_q=0.00797885 時 pole=1-0.5K_q=0.99601
- [error] §10.1 反矩陣元素約 ±25：R^{-1}=[[50.2513,-49.7487],[-49.7487,50.2513]]；0.5R^{-1}=[[25.1256,-24.8744],[-24.8744,25.1256]]；M 的 eigenvalues=50（慢模式）與 0.2513
- [error] §10.3 表格標題：表格有 4 列：Scalar LMS、NLMS/Sign-NLMS、Regularized Preconditioner、Sequential Calibration

### §11 Bias / INL（檢查 19 項）

- [imprecise] §11 boxed w*=a+(bE[x]+E[xd]+E[xu])/E[x²]：代數正確；對 Sign-LMS 只在 σ_v ≫ 固定點處的確定性殘差 max|e_det(x;w*)| 時成立（不只是 |a-w| 要小），並且假設主 PLL 的 DC null 不作用在 comparator 決策上（見 bias-pll-dc-null）
- [ambiguous] §11.1 w*=a+bE[x]/E[x²]：作為開迴路特例是正確的，而且數值上很穩健：x∈{0,1,2,3}、σ_v=1 時，b=0.5σ 的 exact/linear 比為 0.9992，b=3σ 時為 0.9764；x∈{0,1} 時完全精確。MC（b=0.5）：1.2140±0.0002，公式為 1.2143。但若主 PLL 以 shared BBPD 做 integral 而強制 E[q]=0，MC 得 1.0000±0.0003，b 這一項消失
- [imprecise] §11.1「Code Centering 可以降低這種交叉耦合」：σ_v 為常數時，w=a 對任意 b 都是精確固定點（G(a)=erf(b/√2σ)E[x]=0）。σ_v 隨 code 變化時則不成立：σ_v(x)=√(1+0.25(x+2)²)、b=0.2、x∈{-2..2} 的 sign-LMS w*=0.9601（MC 0.9599±0.0003），MSE-LMS 仍為 1.0000
- [ambiguous] §11.2 w*=a+cE[x⁴]/E[x²]=1.34：MSE-LMS 精確值為 67/50=1.34。Sign-LMS 的 mean-field 固定點：σ_v=0 時 1.4（MAE 解），0.01 時 1.39663，0.05 時 1.38314，0.1 時 1.36658，0.2 時 1.34856，0.3 時 1.34385，0.5 時 1.34139，1 時 1.340346，2 時 1.340086，10 時 1.3400035。block sign-LMS MC（R=400 條 seeded chains）全部吻合，例如 σ=0.1 為 1.366509±0.000026，σ=1 為 1.340385±0.000168，σ=0 為 1.39979
- [ambiguous] §11.2「最佳擬合 Gain … 這是可解釋的最小化結果」：1.34 最小化的是 MSE：w=1 時 MSE=0.26，w=1.34 時 0.0288，w=1.4 時 0.036。MAE 的最小值在 w=1.4（MAE 0.12，而 1.34 時為 0.144），也就是無雜訊 sign-LMS 收斂到的值
- [ambiguous] §11.3 符號 c：若網站以同一個 c 驅動兩者，w*=1+0.1·3.4+0.1=1.44，不是 1.34；§19 的 Lab 只有 b、c_2、c_3 的控制項
- [ambiguous] §17 T12：MSE-LMS 下精確為 1.34；Sign-LMS 則依 σ_v 而定（σ_v=0 時 1.4，σ_v=1 時 1.340346）。誤差在 1e-3 以內需 σ_v≥0.588（2.45 倍最大殘差），在 1% bias（0.0034）以內需 σ_v≥0.319
- [ambiguous] §19.2 Preset 7「a=1,c_3=.1：三階 INL，最佳線性 Gain 1.34」：同上：必須指定 MSE-LMS，或指定 sign-LMS 及 σ_v

### §12 Noise / Spur（檢查 30 項）

- [imprecise] §12 f_cal,BW≈(1−p)/(2π)·f_u≈−ln p/(2π)·f_u：p=0.9202115：(1−p) 版為 12401.10 Hz；−ln p 版為 12923.83 Hz；exact −3 dB 為 12931.28 Hz。(1−p) 版相對 exact 偏差 −4.10%，−ln p 版偏差 −0.058%
- [ambiguous] §12 「當 p 不夠靠近 1 時，應使用 exact discrete-time −3 dB 頻率」：exact 公式為 f_3dB=(f_u/2π)·arccos(1−(1−p)²/(2p))，只在 3−2√2≈0.171573≤p<1 時存在（即 μK≤0.828427）；文中沒有給公式，也沒有說明它的存在範圍
- [imprecise] §12.1 「校正 Noise BW 約 12.9 kHz（近似）」；T14 「Noise BW 約 12.9 kHz」：12.9 kHz 是 −3 dB corner（exact 12.9313 kHz、−ln p 版 12.9238 kHz），不是 noise-equivalent bandwidth。單邊 ENBW=(f_u/2)(1−p)/(1+p)=20289.02 Hz（數值積分確認）；MC 估計約 20.46 kHz。用 (1−p) 公式則得 12.40 kHz

### §13–14 Quantization / Learning Rate（檢查 23 項）

- [ambiguous] §13.1 Freeze：w−w* = −0.4 LSB（§12 的 δw 定義）；但 §0 定義 δ=a−w = +0.4 LSB。誤差功率 0.16 LSB²，全部在 DC
- [imprecise] §13.2 頻譜描述：以 code 更新率 f_upd 為取樣率：只有兩條獨立譜線。f_upd/5：peak 0.247214 LSB（=0.8cos(2π/5)），power 0.0305573 LSB²；2f_upd/5：peak 0.647214 LSB（=0.8|cos(4π/5)|），power 0.209443 LSB²；2f/5 比 f/5 高 8.3595 dB；兩者合計 0.24。若改用 [32,32,32,33,33] 排列，功率對調（f/5 為 0.209443）。若以 ZOH 保持 N=64 個 f_s 樣本，k·f_upd/5 (k≠5m) 皆出現：k=1 0.02674、k=2 0.11998、k=3 0.05333、k=4 0.00167、k=7 0.00981 LSB²，總和仍 0.24
- [imprecise] §13.4 常數輸入 Limit Cycle：一階 EFB 對常數 32.4 必然為週期 5：rounding Q6、r[−1]=0 → 32,33,32,33,32（r=2/5,−1/5,1/5,−2/5,0）；floor Q6 → 32,32,33,32,33（正好等於方法 B）。任何初始 r 皆週期 5（測 r0=0.1,−0.3,1/7,0.49）。譜線與方法 B 完全相同：f_u/5 0.0305573、2f_u/5 0.209443 LSB²。總誤差功率 0.24 LSB²，而 white-uniform 線性模型預測 2/12=0.16667（var(r)=0.08≠1/12）。Fixed-point F bits：32.4 無法精確表示，F=10 → 32.400390625、週期 512；F=12 → 週期 2048；F=16 → 週期 32768。float64 下每 2e6 步 r 漂移僅 2.8e-9，輸出實務上維持週期 5
- [imprecise] §14 公式對 Sign-LMS 的適用範圍：T13 參數 (σ_v=100 fs,N=4096,μ=10 fs,p=0.920212) 的 1-bit sign-LMS MC (200k trials)：δ0=10 fs,B=30：MC 0.84531±0.00306 vs 0.83944 (−0.7%)；δ0=50,B=30：18.013 vs 17.188 (−4.6%)；δ0=100,B=30：82.30 vs 68.28 (−17.0%)；δ0=200,B=30：569.9 vs 272.6 (−52.2%)；δ0=400,B=30：12887 vs 1090 (−91.5%)；穩態 σ_w MC 0.399427 vs 0.399186
- [ambiguous] §14 公式邊界：g=0 或 g=2 (p²=1) 時為 0/0，正確極限為 δ0²+Bμ²σ_η²；需特別處理
- [ambiguous] §14.1 下界：僅當 ε 為相對比例 |E[δ_B]|≤ε|δ0| 時正確；若 ε 以 fs 絕對值輸入（例如 ε=1 fs）會得到 μ_min=0。例：K_min=0.00797885、B=30、ε=0.02 (相對) → μ_min=15.3226 fs

### 全文符號與單位一致性（檢查 48 項）

- [error] §0 vs §3「令 δ_n=w_n−a」：§3 用 δ=w−a，和 §0 相反。遞迴式 δ_{n+1}=(1−μx²)δ_n 是線性齊次，兩種極性都成立，但 trace 會反號：用 §1.2 的例子 (a=3, w0=1)，§0 定義下 δ0=+2，§3 定義下 δ0=−2
- [imprecise] §5 表 N=100/1000/10000：CLT 為 0.53180/0.59960/0.78753；exact Binomial 嚴格 P(G>0) 為 0.49205/0.58736/0.78462，P(G≥0) 為 0.57139/0.61179/0.79043。N 為偶數時有 tie，CLT 值大約等於「tie 對半分」
- [error] §8.4 vs §0 / 附錄 A：§8.4 的 C 是 state-space 輸出矩陣，D 是 feedthrough；§0 和附錄 A 的 C=E[xu^T]，§7 的 D 是 code delay
- [error] §10.1：依 §10 自己的模型 G≈K_qR(a−w)，pole=1−μK_qλ。用 K_q=0.0079788 fs⁻¹ 時慢 pole=0.99996011（95% 約要 75,100 blocks）；M=0.5R⁻¹ 時 pole=1−0.5K_q=0.99601。只有 K_q≡1 時文中數值才成立
- [imprecise] §10.1：R⁻¹ 元素為 +50.2513/−49.7487；M=0.5R⁻¹ 的元素才是 +25.1256/−24.8744
- [ambiguous] §10.1：公式本身對 eigen-mode 正確（MC 400k blocks：127.40 vs 127.83；0.6429 vs 0.6424）。但若讀成第 i 個參數就錯：ρ=.99, γ=.5, N=4096 時每個參數的 Var 是 64.24（MC 64.03/64.01），不是 127.8 或 0.64
- [error] §11 / §11.3：§0 中 u 是 filtered regressor (h*x)，§11 中 u 是 code-correlated disturbance。§11.4 的 w*=a+B/C 裡 C=E[xu] 用的是 §6 的意義
- [imprecise] §12.1 / T14：exact −3 dB=12.931 kHz；−ln p 近似=12.924 kHz；(1−p) 近似=12.401 kHz；one-sided ENBW=f_u(1−p)/(2(1+p))=20.289 kHz
- [ambiguous] §12.2：§12 的 S_w 定義在 block rate f_u。ZOH 模擬 (N=16, p=0.92)：把 S_w 直接放到 sample-rate 軸，量測/理論=0.0745；改用 (1/N)[sin(NΩ/2)/sin(Ω/2)]²S_w(e^{jNΩ}) 後比值=0.995
- [error] §0 u 列 vs §15.2 / §12.1：§15.2 寫「Code/regressor normalized」，且 μ=10 fs、σ_w 單位 fs，表示 u 無因次、w 單位為 fs。若照 §0 讓 u 帶 fs，g=μK 會變成 fs² 而不是無因次的 0.0797885
- [error] §0 vs §8.2/§12/§14.1/附錄 A：§0 只定義 K_q；K 實際應為 K_q·C=−∂E[G]/∂w=0.0079788 fs⁻¹（C=1）
- [error] §5 vs §0：§5 的 G_N=Σq_i 是 sum，而且沒有乘 x
- [ambiguous] §0 vs §15.2：§0 寫 sign(e)，數學上 sign(0)=0；§15.2 則把 e>=0 映射為 +1
- [ambiguous] §19.2 preset 7：需要 x 在 {−2..2} 上均勻分布。用 JSON 預設 unit-RMS Gaussian code 得 1.30；±1 code 得 1.10
- [imprecise] 附錄 A：數值和公式都對。符號問題：寫成 H*x 而非 h*x；δ、I 沒用粗體；原始 MIMO 那列在 §10 沒有推導；A 和本文的 A_cal 名稱不同；K 沒有定義
- [imprecise] §17 T01–T18：T01–T12、T15–T18 的數值都重算通過；T13 缺前提條件；T14 的「Noise BW」標籤有誤
- [error] §2.3 表：「Regessor」應為「Regressor」


## 實作階段新增的發現（不在規格書內，由審查與手算驗證找到）

| 來源 | 發現 | 處理 |
|---|---|---|
| SSPLL 分析（[analysis/sspll](../analysis/sspll/)） | Type-II 迴路（含 CPPLL）低頻 `H_PD ≈ (1−z⁻¹)²/K_i`，`Re H_PD < 0`：L2 為 0–134.82 MHz、L3 為 0–117.28 MHz；PHOS mode-1 在 `α·f_ref` 落入 32.7–125.3 MHz（L2）時反號 | 寫成案例頁與 [docs/analysis/sspll-gos-phos-polarity.md](analysis/sspll-gos-phos-polarity.md) |
| SSPLL 分析 | 「二階差分 regressor」與「相關器延遲 D≠0」是有害的對策；一階差分才是推薦作法 | 同上（對策排序） |
| 案例頁審查 | 一階差分 regressor 並非對所有迴路安全：Type-I、延遲 5 拍時 margin −0.0789（`g(Ω)=1−cos Ω+K cos(dΩ)`） | 案例頁 §11.1 加上閉式條件與警告 |
| SSPLL 物理審查 | comparator 的 DC offset 是 forcing 項，不在 `eig(C)` 內；raw（非 zero-mean）regressor 會偏差或漂移 | 案例頁 §13；所有對策都要求 zero-mean regressor |
| Ch01 手算驗證 | Sign-Error 穩態標準差近似式的適用條件原本只檢查 `μf ≤ 0.1`，在 `ε≈0.5` 時誤差達 34% | 改用二階修正導出的 `κ ≤ 0.2` 條件 |
| Ch03 手算驗證 | `ln ε / ln|p|` 恰為整數時，所需步數多算一步（顯示 `⌈2⌉ = 3`） | `scalarStability.ts` 加入整數容差並補測試 |
| Ch00 手算驗證 | `samplesForTargetStd` 的保護項用了相對 `1e-9`，大比值時少算樣本數 | 改為 `16·ε` 並補測試 |
| 手算元件 | 科學記號的數字直接加上次方會產生 KaTeX「Double superscript」錯誤；浮點殘差（`1.4e-17`）被顯示成結果 | 各章以精確十進位運算產生顯示步驟，負數與科學記號底數加括號 |
| 使用者指定的架構（2026-10-12） | 規格 §4 的概念圖把 DTC 畫在 divider 之後（回授路徑），§12.3 的注入極性取 feedback 側；使用者的晶片是 reference 端的 input DTC，而且 LMS 的輸入取自 PD 的輸出 | 全站的系統地圖、各章方塊圖與文字改成 `Reference → DTC → PD`、回授只有 divider；正負號約定見 [assumptions.md §2a](assumptions.md)：`τ_DTC = T_0 − w·x`、`e = t_ref′ − t_fb = (a − w)x + v`、`e_PD = H_PD·φ_dtc`。數學、模型與 golden vector 不變 |
