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

## 2a. 全站架構約定：DTC 在 reference 輸入端（2026-10-12 起）

使用者的晶片是 reference 端的 input DTC，所以全站的方塊圖與文字都照這個接法（規格 §4 的概念圖把 DTC 畫在 divider 之後、§12.3 的注入極性取 feedback 側；兩者的 `|H_PD|`、`|T|`、jitter、spur dBc 完全相同，差別只在下面第 4、5 點的寫法）。

1. **訊號路徑**：`Reference clock → DTC → Phase detector → Loop filter → VCO / DCO`；回授是 `VCO → Divider / PMUX → Phase detector`。DTC 不在回授路徑上，回授路徑上只有 divider（或 phase mux）。
2. **小數除頻**：DSM／累加器的 carry 控制 divider（或 PMUX 選相位）；餘數（fractional residue）經 gain correction（code × w）控制 reference 端的 DTC。
3. **LMS 校正迴路的輸入**是 PD 的輸出 `e[n]`——就是送進 loop filter 的同一個節點。1-bit comparator 取它的正負號。圖上要從 PD 的輸出（PD → loop filter 那條線）分接，不是從 DTC、divider 或沒有標示的地方拉。
4. **時間與正負號（數學不變）**：
   - regressor `x[n]` = DTC code = `s[n]/M ∈ [0, 1)`（累加器餘數），定義不變。
   - feedback（divider）edge 比理想時刻**早到** `a·x[n]`（`a` = 真實的 DTC gain，理想值 `T_vco`；`r[n] = −s[n]/M` 不變）。
   - reference 端的 DTC **只能延遲、不能提前**，所以它從一個固定的基準延遲 `T_0` 往回扣：`τ_DTC[n] = T_0 − w_k·x[n]`（有 INL 時是 `T_0 − (w_k·x[n] + INL·d(x))`）。code 越大延遲越短；數位端送進 DTC 的 code 是 `C_0 − w_k·x[n]`（`C_0` 是固定的中心值，等於把 code 取補數）。`T_0` 是常數，被 PLL 當成靜態相位偏移吸收，不影響任何會動的量。
   - 文字上把 `w_k·x[n]` 叫做 DTC 的**補償量**（reference edge 被提前——也就是少延遲——的時間），不要再寫成「DTC 插入的延遲」。
   - PD 量的是「（DTC 延遲後的）reference edge 減 feedback edge」：`e[n] = t_ref′[n] − t_fb[n] = (a − w_k)·x[n] + v[n]`。補償不足（`w < a`）時 reference 還是太晚，誤差為正。這和原來的式子一模一樣，所以**所有章節的數學、模型、hand calc 的數字與 golden vector 都不變**；要改的只有「哪一條 edge 被延遲」的敘述與圖。
5. **線性化 PLL**：DTC 的殘餘誤差 `φ_dtc`（或時間 `δt`）在 PD 的 **reference 輸入端**注入：`e_PD = φ_dtc − θ_fb`，解出來 `e_PD = H_PD·φ_dtc`、`θ_out = T·φ_dtc`（都是正號）。`H_PD = 1/(1+L)`、`T = L/(1+L)`、`H_PD + T = 1` 不變。
6. **使用者晶片的細節**（8 相 PMUX 在回授、input DTC 只補 `T_vco/8` 以內）在案例頁 `/case/sspll`；一般章節用上面的通用模型。

## 3. 架構限制（本實作）

- 純前端：所有模擬在瀏覽器（Web Worker）執行，單次模擬長度受瀏覽器記憶體與時間限制；大型 sweep 會抽樣顯示。
- 未實作 FastAPI 後端（規格 §20.1 的建議）；Python 只用於 golden-model 回歸測試。
- 未實作 bit-true RTL、SystemVerilog assertions、AMS co-simulation（Backlog R9）。

## 4. 已知限制清單（2026-10-10）

**尚未實作（頁面上皆明確標示 `Not implemented`／pending，不標成 verified）**
- Bit-true 定點交叉比對：多數實驗的 Fixed-Point 欄為 `Not implemented`；只有 Ch04（GMAC 定點累加器）、Ch13（量化策略）、`blockLms` 的 gain register 有定點模型，且都不是 RTL bit-true。
- 高階 ΔΣ、非同步時脈的 ZOH、colored／measured `S_η`（僅 AR(1)）、cyclostationary DSM × LMS 交叉項、PD 直接路徑與 LMS 的 cross-spectrum（Research Backlog R1–R3）。
- 事件級 Fractional-N PLL 狀態空間模型、Injection-locked 模式、RLS／Kalman、RTL／AMS co-simulation（R7–R9）。

**模型層級的限制**
- PLL 一律為線性化模型；comparator 的小訊號增益 `K_q` 只在殘差遠小於 `σ_v` 時成立，大訊號結果另行標示。
- Monte Carlo 交叉比對是「在指定 seeds 與條件下一致」，不是全域穩定的證明。
- SSPLL 案例：GOS 在 `D = 0` 不反號是數值結論（猜想，無一般證明）；PHOS mode-1「一定反號」的嚴格界限只對 `8 | Q` 或無理數 α 成立；反號帶緣只在標稱 loop gain 下成立，PVT 會移動帶緣；未建模 DTC INL、SSPD／DTC 範圍飽和、FLL 交互作用、comparator hysteresis。一階差分 regressor 對 Type-I 迴路在延遲 5 拍時不安全（使用者的設計約 1 拍，不受影響）。

**呈現與驗證方式的限制**
- 版面檢查以 jsdom 測試與瀏覽器 DOM 量測（桌面與 375 px）為主，沒有逐頁人工截圖審閱；列印的練習卷未在實體紙張上驗證（很長的代入式可能超出直式頁寬，建議橫式或縮放 80%）。
- 方塊圖（Mermaid）的節點文字與 Plotly 圖內的軸標題、圖例無法渲染 KaTeX，保留 Unicode 數學符號；方塊圖的版面（節點重疊、換行）只在 jsdom 以估計字寬驗證，並在瀏覽器抽查數頁，未逐張人工審閱；其餘文字以 LaTeX 為原則（多數章節有測試檢查標題、指標名稱、警告中沒有 Unicode 拼湊的公式，但未逐字人工審閱）。
- 手算題顯示的每一步採精確十進位運算（等同紙筆結果），答案框則是模擬函式的回傳值；兩者由測試逐題比對一致。極端輸入（12 位以上刻意相消的小數）下兩者可能在末幾位不同。
- 所有晶片數值皆為 illustrative；文獻（Papers 頁）只作背景閱讀，不是本站數值的量測來源。
