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
- Unified Lab（`blockLms.ts`／`unifiedLab.ts`，`/lab` 頁）的 code 是 DSM 的原始餘數 `r[n] = −s[n]/M`（未置中的一階 DSM 為 `x ≤ 0`），和 §2a 的 `x = s/M ≥ 0` 差一個負號。模型的 `e_DTC = (a − w_app)·x` 因此和 §2a 的 `t_ref′ − t_fb` 反號：`/lab` 畫出與匯出的 `x`、`e_DTC`、`u_pd`、`t_out`、`q` 是鏡像的，`o_DTC`、`c₂`、`b` 的正負號是相對模型的 `e_DTC` 定義的。`w_k` 的收斂、`G_k`、jitter RMS、PSD、spur dBc 不受影響（gain 項與 regressor 一起變號）。改成 `x = −r` 會動到帶 offset／`c₂` 的 preset 與 golden vector，所以保留；`/lab` §4.3 與兩個檔頭有說明。
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
- `/lab` 的 Fixed-Point 欄（Monte Carlo 與 FCW sweep 分頁）：開啟定點暫存器時，每一段 seeds／FCW 再用 `quantize = false` 跑一次同 seed 的浮點對照（執行時間加倍），比的是**內部暫存器** `w` 後半段平均的成對差（Pipeline 分頁比的是實體 gain `wPhys`，兩者差一個捨入到實體 LSB 的量；容差 `1 LSB + 4 SE` 已含）。sweep 只在「每點再跑閉迴路」時才有對照（開迴路量與定點無關，標 `n/a`）。「一致」仍只代表「在這些 seeds、這個 LSB 下定點沒有系統性偏離浮點」，不是 bit-true。
- Ch02 Batch-vs-SGD 的 Monte Carlo 欄：12 個 seeds（各自重抽資料與洗牌順序），統計 SGD 最後的 `w − w_LS`，判定 `|mean| ≤ 4·se`。模型是「固定步長 SGD 在經驗最小平方解附近無偏抖動」：重新洗牌造成的固定點偏移 `∝ μ Σx_i³ r_i / Σx_i²` 對資料集取期望為 0，但是 `O(μ²)` 項沒有算進容差；transient 沒消失（更新次數 < 8/(μ P̂_x)）或發散時標 `n/a`。
- 本節開頭「多數實驗的 Fixed-Point 欄為 `Not implemented`」在 2026-10-19 之後只對沒有定點模型的實驗成立，而且那些格子改標 `n/a` 並附原因；真正的功能缺口（例如 MIMO 判斷器的定點係數量化、SSPLL Jacobian 的定點 GMAC）仍標 `Not implemented` 並指向 roadmap。
