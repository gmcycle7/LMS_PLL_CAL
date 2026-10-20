# Model Assumptions & Known Limitations

本網站所有模型、數值、圖表皆為 **illustrative（教學示意）** 或 **simulation（本站模擬）**，不是任何晶片的量測數據，也不能取代 Spectre/AMS 或實測 sign-off。

## 1. 模型層級（規格 §15.1）

| Level | 模型 | 本站狀態 |
|---|---|---|
| L0 | Scalar exact LMS / Sign-Error LMS | 即時互動（Ch01–03） |
| L1 | Block GMAC + Gaussian comparator | 即時互動 + Monte Carlo（Ch05、Ch12、Lab） |
| L2 | DTC residue + H_PD / T | 即時互動（Ch06–08、Lab）；PLL 為線性化 type-II 模型 |
| L3 | Multi-parameter GOS/PHOS/Gain + Jacobian | 數值範例與互動（Ch09–10） |
| L4 | Noise PSD + output timing error + jitter | 線性化、平穩近似（Ch12）；cyclostationary 分析屬 Research Backlog R2 |
| L5 | Quantized / RTL-like control | 定點暫存器、rounding、saturation、量化策略（Ch13、Lab）；非 bit-true RTL |
| L6 | Advanced reference PLL / DSM / FCW | 僅 DSM（first-order、MASH 1-1-1）與線性化 PLL；事件級 PLL 屬 Backlog R7 |

**L0–L2 是教學模型；L4–L6 才接近架構 sign-off。** 本站的 L4–L6 皆為簡化版本，只能作為 sanity check 或下限估計。

## 2. 全站共用假設

1. Comparator 前雜訊預設為 iid Gaussian；colored / correlated noise 屬 Backlog R1。
2. Comparator 小訊號增益 `K_q = √(2/π)/σ_v` 只在 `|s| ≪ σ_v` 成立；大偏移時 S 曲線飽和。
3. PLL 主迴路以線性化模型表示：`H_PD = 1/(1+L)`、`T = L/(1+L)`；DTC 在 reference 輸入端，殘餘誤差在 PD 的 reference 輸入注入（見 §2a）。
4. Mean stability ≠ mean-square stability ≠ 機率性有界 ≠ 全域非線性穩定；每個結論都標註 `ClaimTag`。
5. 有限樣本 Monte Carlo 不能證明全域穩定，只能說「在指定條件與 seeds 下未觀察到發散」。
6. 時間單位預設 fs；相位 rad；PSD 預設 one-sided；`ℒ(f)=10log10(S_φ^(1)/2)`。
7. 量化誤差不一定是獨立白雜訊；決定性循環會產生 tones，需以時域模擬判斷。
8. 解析式（`C`、pole、mean-field 固定點、平均梯度）把校正係數當成在 `H_PD` 的記憶長度內不變（frozen weight／時間尺度分離：LMS 的時間常數約 `N/g` samples，`g = μ·K_q·C`，要遠大於主迴路的記憶長度）。`e_PD[n] = (a − w)·u[n] + v[n]`（`u = h * x`）只有 `w` 固定不動時是等式；`w` 在更新時真實的誤差是 `Σ_m h[m]·(a − w[n−m])·x[n−m] + v[n]`，兩者差 `Σ_{m≥1} h[m]·(w[n] − w[n−m])·x[n−m]`（例：`h = [1, −1]`、`x ≡ 1`、`a = 1`，`w` 由 0 跳到 1 的那一拍，真實值是 `−1`、簡化式給 `0`）。閉迴路模擬不做這個近似：先乘 `(a − w_k)`，再進狀態跨 block 持續的濾波器。

## 2a. 全站架構約定：DTC 在 reference 輸入端（2026-10-12 起）

使用者的晶片是 reference 端的 input DTC，所以全站的方塊圖與文字都照這個接法（規格 §4 的概念圖把 DTC 畫在 divider 之後、§12.3 的注入極性取 feedback 側；兩者的 `|H_PD|`、`|T|`、jitter、spur dBc 完全相同，差別只在下面第 4、5 點的寫法）。

1. **訊號路徑**：`Reference clock → DTC → Phase detector → Loop filter → VCO / DCO`；回授是 `VCO → Divider / PMUX → Phase detector`。DTC 不在回授路徑上，回授路徑上只有 divider（或 phase mux）。
2. **小數除頻**：DSM／累加器的 carry 控制 divider（或 PMUX 選相位）；餘數（fractional residue）經 gain correction（code × w）控制 reference 端的 DTC。
3. **LMS 校正迴路的輸入**是 PD 的輸出 `e[n]`——就是送進 loop filter 的同一個節點。1-bit comparator 取它的正負號。圖上要從 PD 的輸出（PD → loop filter 那條線）分接，不是從 DTC、divider 或沒有標示的地方拉。雜訊 `v[n]` 是折算到這個節點（comparator 的輸入＝PD 的輸出）的等效雜訊，式子裡的 `e[n]` 已經包含它：系統地圖把 `v[n]` 畫成 comparator 的另一個輸入，章節的圖（例如圖 4-2）把它畫成 PD 後面的加法點，兩種畫法指的是同一件事。
4. **時間與正負號（數學不變）**：
   - regressor `x[n]` = DTC code = `s[n]/M ∈ [0, 1)`（累加器餘數），定義不變。
   - feedback（divider）edge 比理想時刻**早到** `a·x[n]`（`a` = 真實的 DTC gain——把這段早到的時間完全補掉時 `w` 該到的值，理想值 `T_vco`；`r[n] = −s[n]/M` 不變）。
   - reference 端的 DTC **只能延遲、不能提前**，所以它從一個固定的基準延遲 `T_0` 往回扣：`τ_DTC[n] = T_0 − w_k·x[n]`（有 INL 時是 `T_0 − w_k·x[n] + d(x)`：`d(x)` 定義成 DTC 在這個 code 的延遲偏離直線的量，多延遲為正，所以它以正號進入誤差，`e = (a − w_k)·x + d(x) + v`——和 `bias.ts`、`blockLms.ts`、Ch11 的 F-11.1 與 golden vector 的正負號一致）。code 越大延遲越短；數位端送進 DTC 的 code 是 `C_0 − w_k·x[n]`（`C_0` 是固定的中心值，等於把 code 取補數）。`T_0` 是常數，被 PLL 當成靜態相位偏移吸收，不影響任何會動的量。
   - 文字上把 `w_k·x[n]` 叫做 DTC 的**補償量**（reference edge 被提前——也就是少延遲——的時間），不要再寫成「DTC 插入的延遲」。
   - PD 量的是「（DTC 延遲後的）reference edge 減 feedback edge」：`e[n] = t_ref′[n] − t_fb[n] = (a − w_k)·x[n] + v[n]`。補償不足（`w < a`）時 reference 還是太晚，誤差為正。這和原來的式子一模一樣，所以**所有章節的數學、模型、hand calc 的數字與 golden vector 都不變**；要改的只有「哪一條 edge 被延遲」的敘述與圖。
   - 圖上進 PD 的兩條線有兩種標法，都符合上面的式子：入門章節（Ch00、Ch02、Ch03、Ch04 的平均模型、Ch05）標的是「這條輸入在 `e[n]` 裡的那一項」——feedback 線標 `＋a·x`（早到）、DTC 線標 `−w·x`（補償量：reference 少延遲），原因寫在括號或圖說裡；線性化 PLL 的圖（Ch06、Ch07、Ch11、Ch12、Lab、案例頁）標的是 PD 輸入端的極性——reference 輸入 `＋`、feedback 輸入 `−`。前者不是 PD 輸入端的極性，讀圖時以方塊裡的 `e[n] = t_ref′ − t_fb` 為準。
5. **線性化 PLL**：DTC 的殘餘誤差 `φ_dtc`（或時間 `δt`）在 PD 的 **reference 輸入端**注入：`e_PD = φ_dtc − θ_fb`，解出來 `e_PD = H_PD·φ_dtc`、`θ_out = T·φ_dtc`（都是正號）。`H_PD = 1/(1+L)`、`T = L/(1+L)`、`H_PD + T = 1` 不變。相位的正負號：全站把相位寫成「edge 的時間誤差 × `2π·f_out`」，**晚到為正**（和 `e[n] = t_ref′ − t_fb` 同一個方向）。Ch12 的 `δt = x·δw`（`δw = w − w*`，勘誤 E33）是 DTC **多補償**的時間——reference edge 早到 `δt`——所以它在 PD 的 reference 輸入是 `−δt`：`φ_dtc = −2π·f_out·δt`、`φ_out = θ_out = T·φ_dtc = −2π·f_out·T·δt`（F-12.16）。式子裡的負號來自 `δt` 的定義，不是 `T` 的正負號；`|T|²`、jitter、spur dBc 與它無關。
6. **使用者晶片的細節**（8 相 PMUX 在回授、input DTC 只補 `T_vco/8` 以內）在案例頁 `/case/sspll`；一般章節用上面的通用模型。

7. **INL 模型與符號（Ch11b，2026-10-19 起）**：Ch11b 把 INL 校正也放在 reference 端的 DTC 裡：`τ_DTC[n] = T_0 − w·x[n] − c(x[n]) + d(x[n])`，`c(x) = Σ_i θ_i φ_i(x)` 是 INL 校正的補償量（分段 one-hot × x、LUT one-hot、或多項式基底的線性組合，和 `w·x` 一樣從 `T_0` 往回扣），`d(x)` 仍是 DTC 在這個 code 多出來的延遲（多延遲為正，以正號進入誤差），所以 PD 量的是 `e[n] = (a − w)·x[n] + b + d(x[n]) − c(x[n]) + v[n]`（`src/simulation/models/dtcInl.ts`、F-11B.1）。Ch11b 的 `x` 是**正規化到 `[−1, 1]`** 的 code（MASH 1-1-1 的餘數 `r/2`、first-order 的 `2(r + ½)`、uniform 直接 `U(−1, 1)`），INL 係數 `d_2`、`d_3`（Ch11 的 `c_2`、`c_3`；`c` 在 Ch11b 留給補償量）與鋸齒振幅 `A_s` 以 `x = ±1` 處的 t.u. 計；`w = a` 時 `K = 1` 的分段結構就是 Ch11 的 gain LMS。噪聲折返用 Gaussian–Isserlis（`S_{He_p}(0) = p!·Σ_m R_x[m]^p`）加上線性過程的四階累積量修正（MASH：`S_2(0) = 2ΣR² + κ_4(Σh²)²`，`h = [−½, 1, −½]`、`κ_4 = −1/120`），Gaussian 式對 MASH code（峰度約 2.4）高估約 45%，三次項與鋸齒沒有封閉式、只有 Welch 量測；所有 Ch11b 的數字都是 illustrative。

8. **Acquisition 與校正 enable（Ch14 §14.6b，2026-10-19 起；`src/simulation/models/acquisition.ts`、`golden/lms_pll_golden/acquisition.py`）**：§14.7 狀態機的 LOCK 不再是固定長度的計數器，而是四個條件的 AND——頻率鎖定（FLL 一階模型 `Δf[n+1] = (1 − K_f)Δf[n] − K_f e_f[n]`、`K_f = K_vco g_f/(M f_ref)`，lock detect `|Δf̂| < f_tol` 連續 `N_ld` 個 reference 週期）∧ phase lock（`|θ| < θ_max` 連續 `N_pl`）∧ 迴路穩態（`W` 個週期的 rms < `rms_max`）∧ DTC 工作點在範圍內（§5b 的 `dtcRangeBudget`／`dtcCompensation`：補償 gain 在 `x` 兩端的 code 都不飽和）。時間單位是 reference 週期（每個 reference edge PD 取樣一次；校正 block = `N` 個週期），LOCK blocks = `⌈(n_enable + 1)/N⌉`。SSPD 用 `S(θ) = (T_vco/2π) sin(2πθ/T_vco)`：單調 `|θ| < T_vco/4`、不 cycle slip `|θ| < T_vco/2`，超出就折回相鄰的 VCO 週期；相位迴路是**一階（只有比例路徑）**的線性化 `θ[n+1] = θ[n] − g_p S(θ[n] + v[n]) + ΔT`、`g_p = 1 − exp(−2π f_BW/f_ref)`，殘餘頻率誤差的斜坡 `ΔT = Δf_h/(M f_ref²)` 留下靜態偏移 `θ_ss = ΔT/g_p`（Type-II 迴路會積掉，這裡保留最壞情況）；交棒時的相位 `θ_0` 是參數（最壞情況接近 `T_vco/2`），實際值由 FLL 交棒瞬間的 beat 相位決定。本節的 `θ`（fs）和 §14.0 的極性相位 `θ`（度）不是同一個量。lock detect 的誤判率假設估計樣本 iid Gaussian（counter 平均的相關樣本要換成有效樣本數）。狀態機 ACQ → PLOCK → CAL → HOLD／RECAL：失鎖（`|Δf̂| > f_unlock` 連續 `N_ul`）回 ACQ，slip 或 `|θ| ≥ θ_max` 進 HOLD、重新 phase lock 後 RECAL（block 級先 VERIFY）。§14.7 的 block 級狀態機目前只接「LOCK 長度由模型決定」與「失鎖視窗加上重新 acquisition 的時間」，HOLD／RECAL 的暫停尚未接到 block 級；FLL dead zone、PMUX 切相 glitch、Type-II 的積分路徑沒有建模。所有數字（4 GHz reference、M = 4、320 MHz 頻寬、K_vco = 2.5 MHz/LSB）都是 illustrative；確定性時間表與封閉式由 golden vector `acquisition_timeline` 交叉比對，Monte Carlo 不放進 vector。DTC 工作點檢查的 code 範圍 `dtcXRange = [−1, 1]`（`DEFAULT_ACQ`、golden 的 `dtc_x_range`）跟隨 Ch14 全章的 ±1 雙極 code，是第 4 點 `x = s/M ∈ [0, 1)` 約定的例外：`T_0 − w·x` 在 `x = −1` 時是多延遲 `w`，所以兩端都檢查不飽和；換成 `[0, 1)` 只需檢查 `x → 1` 那一端，預設 gain（0、100 fs）的結論不變。模型另把 SSPD 的倍頻模糊寫進去（wave 5 收尾）：enable 多一項倍頻捕獲 `|Δf̂| < f_ref/2`（頻率偵測的讀值；FLL 走 divider，數得出 `M`），相位迴路的斜坡用混疊後的 `Δf − k·f_ref`、`k = ⌊Δf/f_ref + ½⌋`（`harmonicCapture`／`harmonic_capture`）；`|Δf| < f_ref/2` 時 `k = 0`，既有數字逐位元不變。相位迴路是一階（只有比例路徑），Type-II 積分器會把靜態偏移 `θ_ss` 積掉，這裡保留它（最壞情況）。

9. **非理想 comparator：hysteresis 與 metastability（Ch05 §5b，2026-10-19 起；`src/simulation/models/comparator.ts` 檔尾、`blockLms.ts` 的 `comparator` 選項、`golden/lms_pll_golden/comparator.py`）**：comparator 仍然取 PD 輸出 `e[n]`，但 latch 有記憶與決策窗。有效門檻 `θ_a[n] = θ − q[n−1]·h`（上一拍判 +1 時門檻降到 `θ − h`，要掉到它以下才翻成 −1；`h` 是**半寬**，Roadmap R6 寫作全寬 `H = 2h`），`|e − θ_a| < ε` 的 sample 在決策時間 `T` 內解不出來（`ε = ε_0·exp(−T/τ_m)`，`τ_m` = latch 的再生時間常數；`ε_0`、`τ_m`、`T` 是 illustrative 的電路量）。metastable 的 sample 依政策進 GMAC：`drop`（不累加、除數仍是 `N`；解析式一律用它）、`hold`（沿用上一個輸出）、`late`（正確的正負號晚一拍、乘到 `x_ref[n+1]`，等效多一拍 code delay——Ch07）。解析：latch 狀態 `σ ∈ {±1}` 是兩狀態 Markov chain（`t₊ = Φ((s−θ−h−ε)/σ_v)`、`t₋ = Φ((θ−h−ε−s)/σ_v)`、`ν = 1 − t₊ − t₋`、`π₊ = t₊/(t₊+t₋)`），輸出 `y ∈ {+1, 0, −1}` 的自協方差 `Cov(y_n, y_{n+k}) = β·ν^(k−1)·Cov(y_n, σ_n)`，`Var(S_N)` 有封閉式（F-05.23）、`S_N` 的分布用 `(狀態, 和)` 上的 DP（精確）或 CLT（Markov 變異數）。工作點 `s = θ` 的結果：純遲滯的平穩斜率 `K_q(h) = φ(η)/(σ_v Φ(−η))`（`η = h/σ_v`，**隨 h 變大**），但 block 平均的雜訊是 iid 的 `(1+ν)/(1−ν)` 倍，資訊等效增益 `K_eff = K_q(h)·√((1−ν)/(1+ν)) ≤ K_q`（小 `η` 時損失是二階小量；`h = σ_v` 時所需 `N` 多 45%）；純 drop 的斜率 `K_q·exp(−ε²/(2σ_v²))`、`Var(y) = 1 − P_meta`（`P_meta = 2Φ(ε/σ_v) − 1 ≈ K_q·ε`），漏掉的是幾乎不帶資訊的樣本，所以每個 sample 的資訊反而略增。`h = ε = 0` 時所有函式回到 §5 的 iid 結果（`runComparatorMC`、`runBlockLms` 的預設路徑逐位元不變）。**限制**：`v` 仍是 iid Gaussian；metastable 時 latch 狀態不變、解出來的方向不偏向初始差的正負號；hold／late 只有模擬沒有封閉式；§2 第 2 點的 `K_q` 與 Ch12 的 `σ_w`（假設 `η_k` 獨立）在 `h > 0` 時要換成上述的斜率與雜訊因子，Roadmap R1 的有色 GMAC 雜訊就是這個相關。

## 3. 架構限制（本實作）

- 純前端：所有模擬在瀏覽器（Web Worker）執行，單次模擬長度受瀏覽器記憶體與時間限制；大型 sweep 會抽樣顯示。
- 未實作 FastAPI 後端（規格 §20.1 的建議）；Python 只用於 golden-model 回歸測試。
- 未實作 bit-true RTL、SystemVerilog assertions、AMS co-simulation（Backlog R9）。

## 4. 已知限制清單（2026-10-16 修訂）

**尚未實作（頁面上皆明確標示 `Not implemented`／pending，不標成 verified）**
- Bit-true 定點交叉比對：多數實驗的 Fixed-Point 欄為 `Not implemented`；只有 Ch04（GMAC 定點累加器）、Ch13（量化策略）、`blockLms` 的 gain register 有定點模型，且都不是 RTL bit-true。
- 高階 ΔΣ、非同步時脈的 ZOH、colored／measured `S_η`（僅 AR(1)）、cyclostationary DSM × LMS 交叉項、PD 直接路徑與 LMS 的 cross-spectrum（Research Backlog R1–R3）。
- 事件級 Fractional-N PLL 狀態空間模型、Injection-locked 模式、RLS／Kalman、RTL／AMS co-simulation（R7–R9）。

**模型層級的限制**
- PLL 一律為線性化模型；comparator 的小訊號增益 `K_q` 只在殘差遠小於 `σ_v` 時成立，大訊號結果另行標示。
- Monte Carlo 交叉比對是「在指定 seeds 與條件下一致」，不是全域穩定的證明。
- 首頁（Dashboard）的雙參數健康檢查假設交叉相關矩陣是 `E[x_i[n−D]·u_j[n]] = C·R̃_ij`（`R̃ = [[1, ρ], [ρ, 1]]`，`ρ` 是兩個 regressor 的零延遲相關係數，`C` 含路徑相位與 code delay）。`θ = φ + Ω·D = 0°` 時這是精確的；兩個固定的同頻單頻 code 在 `θ ≠ 0°` 時不滿足它——真值是 `P_x·|H|·cos(θ + ψ_j − ψ_i)`，特徵值 `P_x·|H|·(cos θ ± √(ρ² − sin²θ))`（F-DB.6）；`ρ² < sin²θ` 時是一對複數，同一個 `μ` 下的 `max|z|` 可以和 `C·R̃` 的結果差很多，甚至 `≥ 1`。計算核心維持 `C·R̃`，頁面另外列出固定同頻 code 的對照值並加註；`θ ≠ 0°` 時那個燈號不能當成實體 code 的穩定保證，完整的判斷要用實際的 Jacobian（Ch10）。
- SSPLL 案例：GOS 在 `D = 0` 不反號是數值結論（猜想，無一般證明）；PHOS mode-1「一定反號」的嚴格界限只對 `8 | Q` 或無理數 α 成立；反號帶緣只在標稱 loop gain 下成立，PVT 會移動帶緣；未建模 DTC INL、SSPD／DTC 範圍飽和、FLL 交互作用、comparator hysteresis。一階差分 regressor 對 Type-I 迴路在延遲 5 拍時不安全（使用者的設計約 1 拍，不受影響）。

**和 §2a 架構約定有關、刻意保留的差異（數字不動，頁面上都有說明；前兩條是 2026-10-12 加的，第三條是 2026-10-16 加的）**
- Unified Lab（`blockLms.ts`／`unifiedLab.ts`，`/lab` 頁）的 regressor 正負號**已提供選項**（2026-10-19，wave 5）：`LabParams.regressorSign = 'spec'` 照 §2a 用 `x = s/M ≥ 0`（一階 DSM 時是 `[0, 1)` 的鋸齒），`'legacy'` 是原本的 DSM 原始餘數 `r[n] = −s[n]/M`（未置中的一階 DSM 為 `x ≤ 0`）。**預設值與既有的 9 個 Pipeline／FCW／MC／Compare `lab-*` preset 仍是 legacy**（preset 的參數明寫 `"regressorSign": "legacy"`；`lab-training-code-compare` 不用 `LabParams`），原因：(1) `blockLms.ts`（Models 頁、Ch04 等章的 GMAC 實驗共用）與 golden vector T13–T15 都是 `r` 的約定；(2) 帶 offset／`c₂`／comparator offset 的 preset 的預期文字（固定點、bias 的方向）是相對 `r` 的 `e_DTC` 寫的，換成 spec 要整段改寫，數字的意義也會變。兩者只差 `x → −x`：spec 的模擬就是「`a`、`w₀`、`c₃` 變號的 legacy」再把 `w` 變號讀出（IEEE 的負號對稱，逐位元；`unifiedLab.test.ts` 與 Pipeline 分頁的跨級一致性用變號的 `runBlockLms` 鏡像守著），所以 `w_k` 的收斂、`G_k`、`σ_w`、jitter RMS、PSD、spur dBc 完全相同。legacy 時 `/lab` 畫出與匯出的 `x`、`e_DTC`、`u_pd`、`t_out`、`q` 是鏡像的，`o_DTC`、`c₂`、`b` 的正負號是相對 legacy 的 `e_DTC` 定義的。新的 preset（`lab-user-sspll-pmux8`）用 spec。legacy＋單一 gain 由 `runBlockLms` 執行（數字與 wave 4 一位都不變），其餘組合（spec、8 相 PMUX）由 `unifiedLab.ts` 的 `runLabLoop` 執行；參數面板第 ② 組有一句說明，`/lab` §5b.1 有逐步推導。
- Ch11 勘誤 E17 的 code-dependent jitter 例子沿用勘誤的數字：jitter 最小的 code 取 `x_j = −2`（`σ_v` 隨 code 變大）。reference 端的 DTC 延遲是 `T_0 − w·x`，code 越大延遲越短，物理上 jitter 最小的應該是最大的 code（`x_j = +2`）；鏡像之後固定點由 `0.9601` 變成 `1.0399`（偏移大小不變、方向相反）。Ch11 該例（code-dependent jitter 的加權圖）下方的「方向的提醒」與互動實驗的 `x_j` 控制項都有說明，preset `bias-jitter-centering` 與 E17 的數字不動。
- 案例頁 `/case/sspll` 的 `ε_k`（PMUX 第 `k` 相的 phase offset）以 feedback edge **早到**為正，和 `ρΔ` 一樣是 DTC 該補的量，`w_k` 加在 DTC 的補償量裡；§2a 第 5 點的「相位」則是以**晚到**為正（那是 edge 的相位誤差，這裡的 `ε_k` 是 DTC 該補的時間，兩者的對象不同）。`analysis/sspll` 的 `sim/sim.py`（`e_inj` 的 docstring）與 `sim/README.md` 從 2026-10-16 起照同一個讀法寫（早到、補償量、`u = t_ref′ − t_fb`）；之前寫的是「PMUX 第 `p` 相晚到 `ε_p`」。`u = cΔ + ε_p − (1−a)(1+w_g)(cΔ + w_p)` 的式子與所有數字不變，哪一種讀法才對由真實電路決定；改讀成「晚到為正」只會改變 `ε_k` 的正負號約定，以及案例頁 §2「極性約定」框裡 `w_k ← w_k − μqr` 的那一句註記，不影響任何結論。

**呈現與驗證方式的限制**
- 版面檢查以 jsdom 測試與瀏覽器 DOM 量測（桌面與 375 px）為主，沒有逐頁人工截圖審閱；列印的練習卷未在實體紙張上驗證（很長的代入式可能超出直式頁寬，建議橫式或縮放 80%）。
- 列印：一章用 Ctrl／⌘+P 印出的是隱藏頁面外框（頂列、側欄、目錄、搜尋、浮動按鈕）、強制淺色主題、所有收合內容（`<details>`、推導框、思考題解析）都展開的版本；新增 `position: fixed` 的元素要加 `no-print` class（`src/styles/styles.test.ts` 會擋）。圖是接近可視範圍才畫的，Ctrl／⌘+P 會先等到圖都畫完才開列印對話框（最多 15 s）；從瀏覽器選單列印不等，沒畫好的圖會印出補救說明。
- 方塊圖（Mermaid）的節點、連線與群組標題和 Plotly 的軸標題、圖例都已用 LaTeX 排版（Mermaid 經 KaTeX，Plotly 經 `plotMath.ts` 轉成 Plotly 能畫的偽 HTML），但 Plotly 的部分只支援斜體、上下標與常用符號，不是完整的 KaTeX；方塊圖的版面（節點重疊、換行）只在 jsdom 以估計字寬驗證，並在瀏覽器抽查數頁，未逐張人工審閱；其餘文字以 LaTeX 為原則（多數章節有測試檢查標題、指標名稱、警告中沒有 Unicode 拼湊的公式，但未逐字人工審閱）。
- 手算題顯示的每一步採精確十進位運算（等同紙筆結果），答案框則是模擬函式的回傳值；兩者由測試逐題比對一致。極端輸入（12 位以上刻意相消的小數）下兩者可能在末幾位不同。
- 所有晶片數值皆為 illustrative；文獻（Papers 頁）只作背景閱讀，不是本站數值的量測來源。

**交叉比對欄的補充（2026-10-19 修訂；欄位語意見 `docs/dev-conventions.md` §9）**
- Sign-off 的 Corner 判斷器：`ρ` 與 `k₉₅` 都由特徵式 `z^{d+1} − z^d + g = 0` 的 `d + 1` 個極點算出——`k₉₅` 用極點的模態展開 `y_k = Σ c_i λ_i^k`（重根補 `k λ^k` 項）逐步求值（`stability.settleFromPoles`），「之後不再超過 5%」由三角不等式上界 `Σ|c_{i,p}| k^p ρ_i^k ≤ 0.05`（`ρ_i = |λ_i|`，重根才有 `p ≥ 1` 的項）證明；和首頁 `settleDelayed` 逐 block 遞推的數字相同（`stability.test.ts` 在 `d = 0…6` 的整個穩定區逐點比對，差 < 1 步）。只用 `ρ` 的 `⌈ln 0.05 / ln ρ⌉` 是近似（忽略留數與振盪），頁面另列不判定。極慢的 mode（證明需要的步數超過 2×10⁶）仍退回漸近估計並標 `≥`。
- `/lab` 的 Fixed-Point 欄（Monte Carlo 與 FCW sweep 分頁）：開啟定點暫存器時，每一段 seeds／FCW 再用 `quantize = false` 跑一次同 seed 的浮點對照（只重跑迴路，code 與 seed 無關時沿用 prepare；實測 FCW sweep −18%、MC −7% 到 −24% 的時間，見下方 wave 5 的說明），比的是**內部暫存器** `w` 後半段平均的成對差（Pipeline 分頁比的是實體 gain `wPhys`，兩者差一個捨入到實體 LSB 的量；容差 `1 LSB + 4 SE` 已含）。sweep 只在「每點再跑閉迴路」時才有對照（開迴路量與定點無關，標 `n/a`）。「一致」仍只代表「在這些 seeds、這個 LSB 下定點沒有系統性偏離浮點」，不是 bit-true。
- Ch02 Batch-vs-SGD 的 Monte Carlo 欄：12 個 seeds（各自重抽資料與洗牌順序），統計 SGD 最後的 `w − w_LS`，判定 `|mean| ≤ 4·se`。模型是「固定步長 SGD 在經驗最小平方解附近無偏抖動」：重新洗牌造成的固定點偏移 `∝ μ Σx_i³ r_i / Σx_i²` 對資料集取期望為 0，但是 `O(μ²)` 項沒有算進容差；transient 沒消失（更新次數 < 8/(μ P̂_x)）或發散時標 `n/a`。
- 本節開頭「多數實驗的 Fixed-Point 欄為 `Not implemented`」在 2026-10-19 之後只對沒有定點模型的實驗成立，而且那些格子改標 `n/a` 並附原因；真正的功能缺口（例如 MIMO 判斷器的定點係數量化、SSPLL Jacobian 的定點 GMAC）仍標 `Not implemented` 並指向 roadmap。

**2026-10-19 補充（depth 審查）**
- 「精確｜指定模型」指定的是哪個模型：每章章首的本章資訊 strip 列出 `src/app/chapterMeta.ts` 的 `models`（L0–L5 加 frozen weight／單頻／mean-field 三個假設，tooltip 是各自的一句假設），`/formulas` 的登錄表每條公式多一行「在哪個模型內精確」（公式自己的 `assumes`，沒有就是該章的預設）。
- SSPLL 案例的「GOS 在 `D = 0` 不反號」從猜想變成定理（`docs/analysis/sspll-gos-d0-theorem.md`、案例頁 §7b、F-CS.24／25）：L1 由 `Re H_PD ≥ 0` 一行證完；L2／L3 用電腦輔助證書（截斷和直接算、尾項以 `g_min` 壓住、Lipschitz 常數 `L_g = 2πΣn|h_PD[n]|` 把格點接起來）證明 `β ∈ [β_0, 1 − β_0]`（`β_0 = 0.016`，golden 以 `M = 16000` 推到 `2^-10`）；只剩 `β < β_0` 用慢鋸齒漸近式 `C ≈ β²/K_i` 收尾（近似）。§4 第一段「GOS 在 D = 0 不反號是數值結論（猜想，無一般證明）」自此只對 `β < β_0`（與對稱的 `β > 1 − β_0`）成立。證書失敗不是反例；換迴路（PVT、延遲、寄生極點）要重跑（§7.2 密集掃描的 11 個迴路都通過）。
- DTC 本身的範圍、LSB、量化抖動與 `T_0` 預算（Ch04 §5b、`src/simulation/models/dtc.ts` 的 `dtcRangeBudget`／`dtcQuantizationJitterRms`／`dtcCompensation`、F-04.19／20）：補償量取整到 `Δ = R/(2^B − 1)` 的格點，`e_q` 均勻時 `σ_q = Δ/√12` 與 comparator 雜訊相加（`σ_v,eff² = σ_v² + Δ²/12`，`K_q` 等比例縮小）；`R ≥ T_vco(1 + ε_cal) + INL_pk + 2h`、`T_0 = h + INL_pk + T_vco(1 + ε_cal)`；code 夾住時 `∂e/∂w = 0`，sign-LMS 的 `q·x` 更新沒有梯度可跟、要 freeze（和 gain accumulator 的 anti-windup 同一個原則）。「均勻的 `e_q`」要 code 夠亂：整數 FCW 或 near-grid 時是確定性圖案（Ch13）。
- Sign-off §4b 的 PVT corner 表把三種效應放在同一個迴路（案例頁的 L2、GOS 鋸齒 regressor）上：`σ_v` 改 `K_q`、主迴路增益倍率 `s_c`（不重新設計）改帶緣與 regressor 的有效相關 `κ_c = 12 C_GOS(β)`（兩者相乘才是 `K_c`）、溫度讓 `a` 漂移（重新收斂 `k_re` 由 `settleFromPoles` 算、斜坡落後 `δ_lag = ȧ/(f_u g_c)`）；corner 的 `σ_v`、`s_c`、TC 都是 illustrative。

**2026-10-19 補充（depth-dither：DSM dither／MASH／PMUX 隨機旋轉 × LMS）**
- 案例頁 §11.4 原本把「PMUX 隨機旋轉／MASH」列為**只有 sim 證據**，「L2-PM45 搭 MASH 在 `α = 0.03` 發散」標成研究假說（理論無法解釋）。自此改由案例頁 §10b 的判定式負責（推導全文 `docs/analysis/sspll-dither-interaction.md`、F-CS.26–28、實驗 D `sspll-code-source`）：任何滿足 `P + c = Φ + 常數` 的 code source（PMUX 總指標 `P`、DTC code `c`），模態 `m` 的斜率是「載波保留率 `|φ_m|²` × `Re H_PD(frac(mα))`」加上散開部分 `Σ_k h_PD[k]·cos(2πmαk)·R̃_m[k]`（F-CS.26：線性小訊號、凍結權重、`D = 0` 的模型內精確）；四種 source 的 `|φ_m|²` 與 `R̃_m` 有 closed form（F-CS.27：mode 1 的載波保留率 MASH 0.731、dq 0.90、rot4 0.43、rot8 0），**近似**在「隨機部分 iid」（MASH 的 `e_3` iid 均勻；實際序列在近有理數 `α` 有 tone，closed form 與實際序列的線性相關最多差 0.021、與時域 sim 存檔最多差 0.008）。判定（F-CS.28）：`κ_min < −τ` 反號、`κ_min > τ` restoring、`|κ_min| ≤ τ`（`τ = 0.05`，經驗門檻）是 dead zone：線性模型在這裡沒有恢復力，**不做判定**（n/a；原本「改看大訊號 `κ_∞`」的第二段已撤回，見本節最後一條）。L2-PM45／MASH／120 MHz：`κ_1 = 0.731 × (−0.382) + 0.301 = +0.021`（dead zone，沒有恢復力）；`κ_∞ = −0.258` 只是「之後為什麼長大」的研究假說提示，不是判準；PM 60° 的同一點 `Re H_PD = −0.095`、`κ_1 = +0.238`（restoring）。golden（`analysis/sspll/golden/tools/dither_sweep.py` → `analysis/sspll/golden/results/dither_interaction.json`，TS port 在 `src/simulation/models/sspll.ts` 的 code source 區塊）105 組（3 個迴路 × 5 種 source × 7 個 `α`）× 8 seeds 的閉迴路：判定與 MC 多數（發散比例的 95% Wilson 區間不含 ½）一致 87 組、不一致 0 組、dead zone 不判 18 組。
- **仍是限制**：`κ_∞` 只沿一個模態、不含 GOS 耦合，dead zone 的結局是近似的裁判、不是證明；`τ` 隨 `N_τ` 與模擬長度而定；LSB dither 沒有納入（sim 已顯示它無效）；dither 之後 DTC range 變成 2–8 倍，DTC 量化雜訊與 spur 沒有算；DSM 量化雜訊經 PD 進 comparator 的 cyclostationary 交叉項（本節「尚未實作」第二條）仍未做——§10b 只處理 regressor 的相關。所有迴路與晶片數字都是 illustrative。

**2026-10-19 補充（wave 5：`/lab` 的使用者架構，§5b）**
- 8 相 PMUX + GOS（`architecture = 'pmux8_gos'`，9 個權重）：累加器跑 `8α`（單位 `Δ = T_vco/8`），整數部分選 PMUX 相位、小數部分（DSM 跑在 `8α mod 1`）給 DTC；PHOS 的 8 個 offset `ε_p` 是固定圖樣（`analysis/sspll/sim` 的 seed-7，去共模）× 可調 RMS，數字都是 illustrative；`ε_p` 以 feedback edge **早到**為正（和案例頁同一個讀法，見上面第三條）。沒有建模：PMUX 切相的 glitch、DTC 範圍飽和（`pmuxOrder = 'random'` 時 DTC 要多 `7Δ`，Lab 不檢查）、各相不同的 DTC INL。9 個權重共用同一組定點暫存器設定。
- 共模 `Σ_p 1_p = 1` 經 `H_PD(1) = 0` 後不可觀測：8 個 PHOS 權重一起偏同一個常數沒有恢復力，會隨機漫步、由初值與暫態決定，不是收斂值。Lab 的條件數、PE、9 權重的 `σ` 預測（離散 Lyapunov）與 mean `w`／`σ` 的交叉比對都在可觀測子空間上算（PHOS 先去共模）；`none` 路徑（`H_PD = 1`）共模可觀測，不去共模。`σ` 預測假設 GMAC 雜訊 iid（`Cov(η) = R_ψ/N`），MASH code 下略低估（交叉比對的 SE 取預測與實測殘差較大者）；增廣維度 `9(d + 1) > 40`（更新延遲 `d ≥ 4`）時不解共變異。平均模型不穩定（`ρ ≥ 1`，例如一階 DSM 的 PHOS mode-1 落在反號帶）時，sign-LMS 的 `G` 有界、表現為大振幅振盪而不是數值發散：穩定性檢查改成「模擬的可觀測殘差也不收斂」才算一致，mean `w`／`σ` 標 `n/a`。MASH 與隨機旋轉讓 PHOS 不反號：Lab 給的是這一組參數的數值結果（9 權重的 mean-field 線性化 + 模擬）；一般的判定式在案例頁 §10b（上面 depth-dither 那一條：載波保留率 × `Re H_PD` 加上散開部分，`|κ_min| ≤ τ` 是 dead zone——例如 L2-PM45 搭 MASH 在 `α = 0.03` 仍會發散），Lab 沒有算 §10b 的大訊號 `κ_∞`：`lab-user-sspll-pmux8`（L3、PM 60°、MASH）的 FCW sweep 在線性化裡 `min Re λ` 全部 > 0，但旋轉頻率落在反號帶內的點只剩帶外的 20–30%，這些點要用案例頁的實驗 D（`sspll-code-source`）確認是不是 dead zone。
- 三階 CPPLL（`pll = 'cppll3'`）：impulse-invariant 的線性模型（和案例頁 L3 相同；`r_p = √b` 時係數逐位相同），不含 CP 的電流不匹配、漏電與 SSPD 的非線性；以二分法調 `ω_c` 讓實際 DT 的 `|T|` −3 dB 等於設定值，PM 與第三極點比是連續時間的設計值（sampled-data 的 crossover 與 PM 另列）。每一種主迴路的 `PllDesign` 都附上反號帶（`inversionBands`，只在迴路穩定時算）；Type-II 與 CPPLL 從 DC 起有一段，這是 PLL 卡片上的資訊性註記，只有 9 權重的 `min Re λ ≤ 0` 才是警告。
- 同 seed 浮點對照（Fixed-Point 欄）從 wave 5 起**只重跑迴路**：FCW sweep 在同一次 worker 呼叫裡每點多跑一次 `quantize = false` 的閉迴路（序列統計、斜率 MC、9 權重分析不重算）；Monte Carlo 的 legacy 路徑沿用每個 seed 的 `runBlockLms` 已經算好的 normalization 與解析量，用 `runLabLoop` 重跑迴路（legacy、單一 gain 時與 `runBlockLms` 逐位元相同，`unifiedLab.test.ts` 比對「整段 `quantize = false` 再跑一次」的結果）；新引擎每個 seed 只 prepare 一次，code 與 seed 無關（DSM 無 dither、不是 iid、PMUX 不隨機旋轉）時直接沿用 `base.seed` 的 prepare。上面「執行時間加倍」那一句因此不再成立（實測見 `docs/dev/infra-api.md` 的 wave 5 lab-architecture 一節）。

**2026-10-19 補充（depth-dither，續：全頻道證書）**
- 案例頁 §10b.8、F-CS.29（`src/pages/case-sspll/codeCertificate.ts`、`analysis/sspll/golden/tools/dither_certificate.py`）：用 §7b 的有證明下界 `g_min ≤ Re H_PD(f)`（所有 `f`），`Re κ_m(α) ≥ W_m·g_min + R̃_m[0] − Σ_{k≥1}|h_PD[k]|·|R̃_m[k]|` 對所有 `α` 成立（`W_m` = 線的總權重）；`min_m` 這個下界 `> τ` 就證明每個頻道都 restoring，不必逐一掃。L2（PM 60°）與 L3 搭 MASH、三個迴路搭 rot4／rot8 都有證書；PM 45° 的 MASH 沒有（掃描找到 98–131 MHz 的 dead zone）。1 拍延遲、320 MHz 的 Type-II 重新設計時，MASH 的證書在 PM ≥ 58.5° 成立、PM < 47.9° 一定有 dead zone 頻道（二分法）。下界在 F-CS.27 的模型內沒有近似，對 MASH 的結論與 PM 門檻繼承 `e_3` iid 的近似與經驗的 `τ`；PVT 移動帶緣時要用該角落的 `g_min` 重算。

**2026-10-19 更正（depth-dither 審查：dead zone 的第二段判定撤回）**
- 上面 depth-dither 第一條說「`|κ_min| ≤ τ` 是 dead zone，改看 `κ_∞`」「`κ_∞ = −0.258`，所以發散」，而「一致 87 組、不一致 0 組、dead zone 不判 18 組」只算了線性段。用 golden 的 18 個 dead zone 案例（各 8 seeds）計分，「dead zone 看最差模態的 `κ_∞` 正負號」是 6 個一致、8 個不一致、4 個不判（看 mode 1 的版本 7／3／8），錯的方向都是 `κ_∞` 很負、MC 卻收斂或停住（例如 L3、acc1、`α = 0.253` 沿 mode 4 的 `κ_∞ = −0.744`，8/8 收斂；L3、dq、`α = 0.01` 的 `κ_∞ = −0.173`，0/8 發散、0/8 收斂）。自此 F-CS.28 **只有線性段**：dead zone 一律不判（n/a），`κ_∞` 只當研究假說的提示（第二條「dead zone 的結局是近似的裁判」一併撤回）；實驗 D 的 Analytic 欄同樣處理（`analysis/sspll/golden/tools/dither_sweep.py` 的 `score_candidates` 把候選判準的計分寫進 `results/dither_interaction.json` 的 `mc._summary.candidates`，TS 的 `twoStageCandidate`／`efoldVerdict` 在 `sspll.test.ts` 逐格重算）。
- 因此「L2-PM45 搭 MASH 在 `α = 0.03` 發散」只解釋了一半：closed form 說明那一點為什麼沒有恢復力（`Re κ_1 = +0.021`，**近似**）；沒有恢復力之後為什麼是長大（golden 8/8，最終中位數是初值的 4.6 倍）而不是停住，仍是**研究假說**——線性平均模型在 1500 blocks 的觀測窗只預測縮到 0.29 倍。另一個候選讀法「觀測窗的 e-folding」（`G = e^{−κ_min·B/N_τ}` 和 2、1/4 比，等於依觀測窗而定的 `τ`：`N_τ ln2/B = 0.0116`、`N_τ ln4/B = 0.0231`）在 105 組 0 個不一致、多判 5 組，但 headline 那一點它也不判。
