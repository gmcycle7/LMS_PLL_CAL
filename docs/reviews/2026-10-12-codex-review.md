# LMS PLL Calibration Lab 技術審查與 Claude Code 驗證清單

審查日期：2026-10-12（Asia/Taipei）  
對象：[LMS × Fractional-N PLL Calibration Lab](https://gmcycle7.github.io/LMS_PLL_CAL/#/)  
版本：網站頁尾 `v0.1.0 / 0109463`，對應 [commit 01094638d1617025c98ef55e6c7dba8086104cde](https://github.com/gmcycle7/LMS_PLL_CAL/tree/01094638d1617025c98ef55e6c7dba8086104cde)。後續版本若已修改，請以新版重新判定。

## 審查結論

網站的主幹推導大致正確，且已認真處理多個容易出錯的地方：LMS 與 Sign-LMS 的差別、mean／mean-square／almost-sure 穩定性、comparator tie、DTC INL 的 MSE 與 MAE 最佳值、PLL 誤差與輸出路徑、ZOH 與單邊 PSD。它適合作為電機系大學畢業生的進階自學材料，不需要整站重寫。

主要缺口是**有些近似或受限模型，到了公式總表、摘要或互動結果，變成較強的「精確／已通過」結論**。其中有兩個優先修正的可重現例子：near-integer 預設案例的 B/C 並非實際 Sign-LMS 固定點；一般矩陣與含延遲模型的 95% 收斂時間低估。另有一個雙參數首頁模型需要先釐清交叉頻譜假設，因為對固定同頻正交 code 會給出相反的穩定判定。

本報告列 14 個主要驗證項目及 9 個較小修正項目。這不是把所有模型限制都當成錯誤：有限頻寬、線性化 PLL、未做 RTL bit-true、未完整處理 cyclostationary cross-spectrum 等，網站已聲明的研究限制，沒有另列為缺失。

## 請 Claude Code 如何使用

把這份檔案放在 LMS_PLL_CAL repository 中，以下文字可直接作為工作指令：

> 請先核對目前 commit 與報告審查版本的差異。逐項處理 R01–R14 和 C01–C09：檢查引用的原始碼、用反例重現，再判定「確認需修」「新版已修」「僅需補條件」「不成立」或「需討論模型意圖」。不要直接把審查意見視為真理，也不要為了讓反例通過而修改已正確的核心模型。先處理 R01、R02，再釐清 R12；其餘依影響排序。每項留下推導、實測輸出、修改檔案、必要測試與不修改的理由。公式、正文、公式總表、圖說、手算與互動工具必須同步；近似條件要在 Engineer 模式的公式旁可見。最後產生逐項驗證結果。這個審查不要求部署或發布。

建議建立這張追蹤表：

| ID | 判定 | 重現結果 | 修改或不改理由 | 驗收測試 |
|---|---|---|---|---|
| R01…R14 / C01…C09 | 待驗證 |  |  |  |

優先度在本報告中的意思：P1 是優先修正的結果誤判或模型缺口；P2 是影響理解／實作的公式或條件問題；P3 是局部術語與呈現一致性。它們不是網站既有 E01–E49 勘誤的編號。

## 範圍與實際驗證

以微積分、線性代數、機率、訊號與系統、基礎回授控制為讀者背景；不假設讀者修過研究所適應性濾波或 RFIC 設計。允許局部用高中程度的算例，只要求簡化時仍保留正確的符號、因果與適用條件。

- 靜態交叉審查 Ch00–Ch14、SSPLL 案例的主要公式／推導／互動計算核心，及相關 tests、formula registry、首頁摘要與整合 Lab。瀏覽器確認公開版本，抽查首頁與 Lab 的實際呈現。
- 在公開 repository 的暫存副本執行 `python3 -m pytest golden analysis/sspll/golden -q`：**211 passed，41.98 秒**。
- 執行 `npx vitest run src/simulation src/pages/dashboard/thesisModel.test.ts --reporter=dot`：**36 files / 1,155 tests passed，46.24 秒**。
- 另外直接呼叫現有函式驗證 R02、R08、R12、R14；用獨立 NumPy/SciPy、有理數和位元運算驗證 R01、R04、R05。本文末尾提供可複製的重現程式。
- 沒有重跑整站全部 UI 測試或逐張審閱 400 多張圖；沒有進行電晶體模擬或 RTL 驗證。上述通過數字是本次實際執行的子集，不是沿用 README 的全套測試宣稱。

因此，既有測試通過與本報告的反例可以同時成立：很多測試驗證既定公式能否被正確計算，還需測試公式的適用條件是否在 UI 中被越界使用。

## 主要問題索引

| ID | 優先度 | 位置 | 判定重點 |
|---|---|---|---|
| R01 | P1 | Ch11 near-integer | 預設 B/C 不是 nonlinear GMAC 零點 |
| R02 | P1 | Ch10、首頁 | spectral radius 不能直接給一般模型的精確 settling time |
| R03 | P2 | Ch07 | filtered-x 公式漏額外 D，可能把相關正負判反 |
| R04 | P2 | Ch13 | Gray CDC 缺相鄰 code 更新條件 |
| R05 | P2 | Ch11 | MAE minimizer 與單值 sign 更新零點混淆 |
| R06 | P2 | Ch07、09、12、SSPLL | 線性化與 frozen-weight 條件在跨頁傳遞時遺失 |
| R07 | P2 | Ch09 | 負 rho 的 condition number 公式缺絕對值 |
| R08 | P2 | Ch01 | 忽略格點鏈上邊界的近似被標 exact |
| R09 | P2 | SSPLL | C/var(rho) 與 12C 的正規化不一致 |
| R10 | P2 | SSPLL | 複數 kappa 被直接拿來作實數上下界比較 |
| R11 | P2 | Ch04 | half-even 零偏差缺 tie 商奇偶條件 |
| R12 | P1，先確認假設 | 首頁雙參數 | 只有 rho 不足以決定經 PLL 相位後的完整 Jacobian |
| R13 | P2 | 首頁 | 六個面向並非數學上互相獨立 |
| R14 | P2 | 首頁 | 符合預算不等於校正後輸出變好 |

定位使用審查 commit 的 repository-relative `path:line`，可直接在 Claude Code 搜尋。各章公開網址形式為 `https://gmcycle7.github.io/LMS_PLL_CAL/#/ch/XX`；SSPLL 為 `#/case/sspll`。公式 ID 可在網站 Formula & Unit Reference 搜尋。

## R01 Near-integer 預設案例把失效的線性外推當成固定點

- 分類：**已用獨立反例確認的適用性／呈現錯誤**；優先度 P1。不是 C 算錯，也不是 F-11.14 在自身假設內錯誤。
- Route：[Ch11](https://gmcycle7.github.io/LMS_PLL_CAL/#/ch/11)，§11.4、experiment `bias-near-integer`。
- 位置：[src/chapters/ch11/sections/NearIntegerSection.tsx:43](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/chapters/ch11/sections/NearIntegerSection.tsx#L43) 預設、`:56` FCW 範圍、`:82` 把曲線稱為 `|w*-a|=|B/C|`、`:94` 固定點指標、`:110–141` 只驗 C 的頻域／時域一致；`src/simulation/models/bias.ts:1706–1769` 無條件輸出 `B/c.cFreq`；測試 `src/simulation/models/bias.test.ts:626–655` 只測 C 和 B/C，未測 nonlinear GMAC。

**可重現數字。** 保持網頁預設 `wnTs=.02, zeta=.707, loopDelay=1, kappaDirect=.01, sigmaV=1`，掃描第一點 `frac=3e-4` 經 16-bit FCW 量化後是 `20/65536=.00030517578125`。以整週期的標準化 DSM residue x 和同一 Hpd 算得：

| 量 | 獨立 NumPy/SciPy 結果 |
|---|---:|
| C=E[xu], u=Hpd*x | 0.0027939677342546155 |
| 網頁線性候選 w−a=B/C | 3.5791394000002064 |
| 該候選的 max abs(e_det)/sigma | 12.381202177368403 |
| 該候選的 E[x erf(e_det/(sqrt(2) sigma))] | **+0.048818774808059906** |

這裡 `e_det=−(B/C)u+.01x`。最後一列離 0 很遠，故該候選**不是**此頁 Gaussian comparator 模型的 mean-field 固定點。原站 Ch11 F-11.3 已正確要求整個 deterministic residual 遠小於 sigma；預設 near-integer 圖恰好違反它。原 UI 已標 `approx`、assumptions 也寫了 Kq 線性化，且固定點驗證為 `not-implemented`。本項不是指網站宣稱非線性驗證通過，而是預設展示的 w* 曲線未指出哪些點已超出適用範圍；泛用近似標籤不足以說明這些具體失效點。

C 的兩條獨立算法一致，只能支持 C 的數值，不能驗證套入 erf 線性化後的固定點。實驗目前把 Monte Carlo 說成「確定性序列（無隨機性），不需要」也容易讓讀者以為整個 Sign-LMS 結論已被核驗；實際上 code 是確定性的，但 comparator 的 sigmaV=1。

**建議修法。** 保留 C 的正確數字與趨勢。將超出範圍的 B/C 明確標「線性外推，非已驗證固定點」，同時顯示 max abs(e_det)/sigma 和 nonlinear mean GMAC。可選擇遮罩失效區，或另外以 erf 條件平均找根並驗證斜率；不要直接把 C>0 解釋成遠離線性區的固定點必然吸引。若不打算實作非線性求根，改預設干擾幅度讓整張圖留在線性區，也是合理教學選擇。

**驗收。** 上述預設第一點應明確標示超出近似的適用範圍；C 的交叉檢查 pass 不得被解讀為非線性固定點 pass。另一控制點 frac≈.05 時 `C≈1.0313861671, B/C≈.00969568947, max abs(e)/sigma≈.0021539`，nonlinear G≈−8.55e−12，應被接受。若新增非線性求根，檢查 G(root) 本身，不只檢查 bracket 變號。

獨立重現程式見本文末尾（不 import 網站模型）。其核心 Hpd 與網站相同：`(1-z^-1)^2 / [(1-z^-1)^2+(Kp+Ki)z^-2-Kp z^-3]`。

## R02 一般矩陣與含延遲模型的 95% 收斂時間不精確

**位置**

- `/ch/10`，[src/simulation/models/mimo.ts:1002](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/simulation/models/mimo.ts#L1002)，`blocks95: stable ? stepsToDecay(rho) : null`。
- [src/chapters/ch10/experiments/MimoLab.tsx:410](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/chapters/ch10/experiments/MimoLab.tsx#L410) 把結果呈現成「95% 收斂 blocks k95」，`claim: 'exact'`。
- [src/chapters/ch10/formulas.ts:57](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/chapters/ch10/formulas.ts#L57)（F-10.5）本來只屬單一模式，但應用擴大到一般 J。
- 首頁 `/`：[src/pages/dashboard/thesisModel.ts:185](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/pages/dashboard/thesisModel.ts#L185)、`:186`、`:524`，用主導根半徑計算 `t95Blocks`。

**問題與反例 A：網站自己允許的一般 Jacobian**

設 `Jn = [[-1,2],[0,-1]]`、scalar `muKq=0.5`，則

```text
A = I + 0.5 Jn = [[0.5, 1],[0,0.5]],  ρ(A)=0.5.
A^k = [[2^-k, k·2^{-(k-1)}],[0,2^-k]].
```

網站回傳 `ceil(ln .05 / ln .5)=5`；但 δ0=(0,1) 時：

```text
δ5 = (0.3125,0.03125), ||δ5||₂ / ||δ0||₂ = 0.3140586 > 0.05.
δ8 ratio = 0.062622 > 0.05;
δ9 ratio = 0.0352105 < 0.05.
```

此時 poles 正確、穩定判斷正確，錯的是把漸近指數衰減率當作有限時間包絡。非正規矩陣的 eigenvectors 不必正交，Jordan block 還會有 k·p^k。這是合法的 J-mode plant，`buildPlant` 回傳 `errors: []`，不是非法輸入。

**反例 B：首頁延遲 d=1 的 repeated root（主代理另外核對）**

`δ[k+1]=δ[k]−gδ[k−1]`，取 `d=1,g=1/4`，根是雙根 1/2。若歷史 `δ[-1]=δ[0]=1`，精確

```text
δ[k]=(1+k/2)·2^-k.
k=5: 0.109375; k=6: 0.0625; k=7: 0.03515625.
```

首頁以 radius=0.5 報 5 blocks，但該歷史需 7 blocks。`r^k` 根本不是原始誤差包絡。

**建議修正**

1. 明確定義需求是「最慢 eigen-mode 的漸近速率」、「這組初始條件首次到達 5%」或「所有未來都維持 5% 內的 settling time」。三者不可共用一個 exact 名稱。
2. 一般矩陣用 `||A^k||₂` 給全初值的 worst-case 衰減，或直接算 `||A^k δ0||₂/||δ0||₂`；若要 settling，必須排除之後再超過閾值。
3. 含延遲用實際 augmented state / 指定的初始歷史遞推。
4. 若保留 `ceil(log .05 / log ρ)`，標為漸近 pole 指標；對正規矩陣／單一純量模式才可給 exact decay guarantee。保留 `ρ(A)<1` 的漸近穩定結論。
5. 順帶稽核 `mimo.ts:1442` 以同一 radius 估 burn-in 的保證範圍，但尚未單獨證明其造成 MC 錯誤，因此本項不是另一個 confirmed bug。

**驗收**：上述 J 案例不再宣稱 5 blocks 已收斂 95%；對 δ0=(0,1) 應得 9（指定軌跡）或依所選 norm criterion 給正確結果。首頁 d=1,g=.25、constant initial history 應得 7。對 A=.5 I 仍是 5。圖表／公式註記與 computed metric 同步。

一手背景：[Reuter, transient effects in matrix powers](https://arxiv.org/abs/1909.05931)；此來源只支持 eigenvalues 無法單獨控制 nonnormal transient 的原理，數值反例為本次直接推導並執行程式驗證。

## R03 Filtered-x 平均斜率公式遺漏額外延遲

- 嚴重度：P2（有條件會直接把更新極性判反）；可信度：高。
- 頁面：`/ch/07`，F-07.10、F-07.11、F-07.12、F-07.13。
- 定位：[src/chapters/ch07/formulas.ts:108](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/chapters/ch07/formulas.ts#L108)、`:119`、`:131`；[src/chapters/ch07/sections/S4Gradient.tsx:195](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/chapters/ch07/sections/S4Gradient.tsx#L195)。
- 證據：F-07.10 實作寫 `G_k=(1/N)Σ q[n]u_f[n-D]`，但 F-07.11 寫 `E[G]≈Kq δ E[u u_f]`，F-07.12 的頻域積分也沒有 `exp(jΩD)`，且宣稱 `Hhat=H` 時 `E[u²]≥0`、`rho=1`。前面確實曾說圖上為 D=0，但後來明文允許額外 D，公式 registry 的 conditions 也未限定 D=0。
- 正確式：令 `C_f(D)=E[u[n]u_f[n-D]]`，則 `C_f(D)=(1/2π)∫Sxx Re{H Hhat* exp(jΩD)}dΩ`；平均 pole 為 `1-μKq C_f(D)`。完美模型仍須額外 D=0（或把實際全部 timing 誤差納入模型一致地定義）才得到 `E[u²]`。
- 最小反例：`H=Hhat=1`、`x[n]=cos(πn/2)`、D=2。`u_f[n-2]=-u[n]`，所以 `C_f(2)=-1/2`、rho=-1，任何小的正步長都平均反向；沒有 D 的式子卻預測 `+1/2`、rho=1。
- 程式現況：[src/simulation/models/filteredX.ts:16](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/simulation/models/filteredX.ts#L16) 與 `:18` 已正確包含 D 並要求 D=0；`:292` 的 `multiToneCorrFiltered` 也正確乘 `exp(jΩD)`。這是教材／公式與程式不一致，**不要把程式的 D 項刪掉來配合公式**。
- 建議驗證：把上述反例放入模型直接計算，結果應為 -0.5；再確認 F-07.11/12、圖說與 rho 敘述統一明寫 D=0，或全面改用 `C_f(D)`。

## R04 Gray CDC 的保證不能直接延伸到多 LSB 更新

- 分類：**重要假設遺漏／章內工程矛盾**；建議 P2。
- Route：`#/ch/13`，§13.6 第 4 點 CDC；關聯 §13.4E。
- 位置：`src/chapters/ch13/sections/NonIdeal.tsx:171–173` 圖說「gray 後一次只翻 1 bit，最壞差 1 LSB」、`:211` 建議用 handshake 或 gray/thermometer；`src/chapters/ch13/diagrams.ts:351–356`；與 [src/chapters/ch13/sections/Dither.tsx:242](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/chapters/ch13/sections/Dither.tsx#L242) 明示策略 E 可能一次跳 2 或 3 LSB 相衝突。

31→32 這個**具體相鄰例子**的 Gray 編碼是對的，請保留。問題是把它推成 gain code bus 的通用處理方式。Gray `g(n)=n xor (n>>1)` 只有相鄰整數保證 Hamming distance 1；例如 31→34 是 `010000→110011`，仍有 3 bits 改變，混合取樣甚至可能組成 `010011`（解碼29），已不是最壞1 LSB。LMS/dither 的 code bus 會跳多步，因此不符合前提。

**建議。** 分開說明編碼性質與跨時脈實作條件：相鄰整數的 Gray code 只有一個 bit 不同；要將此性質用於 CDC，仍須正確的 source 註冊、接收同步與 bus skew 約束。任意多 LSB gain 更新不能套用相鄰碼的保證，應使用穩定 data + request/ack handshake，或有完整協定的 CDC/FIFO。Thermometer 亦不能單靠名稱保證多步更新安全。圖中的31→32保留為受限例子，頁面 general advice 加上條件。

**驗收。** 增一個31→34反例／文字檢查；不得宣稱策略 E 的多 LSB 更新直接 Gray 化即可安全。可保留網站「未實作 asynchronous ZOH」的研究標示。

一次來源：[Intel, Constraining CDC Paths](https://www.intel.com/content/www/us/en/docs/programmable/683243/25-1/constraining-cdc-paths.html) 強調 multibit CDC 的 timing constraints；[Intel Agilex Embedded Memory User Guide](https://cdrdv2-public.intel.com/705385/ug-ag-memory-19-3-683241-705385.pdf) 說明 Gray counter 單 bit transition 和 bus skew 的條件。反例本身可直接位元計算，無須依賴引用。

## R05 Weighted median 與單值 sign 更新的零點必須區分

- 分類：**確定數學矛盾**；建議 P2。正確答案 `1.4` 應保留。
- Route：`#/ch/11`，§11.2 無雜訊例、F-11.10；formula reference 也受影響。
- 位置：[src/chapters/ch11/formulas.ts:20](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/chapters/ch11/formulas.ts#L20) 的 `weightedMedian`；`src/chapters/ch11/sections/InlSection.tsx:286–297`「中位數令 sign 加總為 0／abs 導數」；同檔 `:303–311` 推導和 F-11.10；`src/chapters/ch11/sections/FixedPointSection.tsx:87–89` 定義 fixed point 為 E[G]=0；[src/simulation/models/bias.ts:150](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/simulation/models/bias.ts#L150) 和 [src/chapters/ch11/experiments/BiasInlLab.tsx:747](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/chapters/ch11/experiments/BiasInlLab.tsx#L747) 宣稱 tie 只影響測度零的點；`src/simulation/models/bias.ts:459–466` 把不連續的 bracket 變號點回傳 status=ok。

**反例就是網站自己的例子。** x=−2,−1,0,1,2 等機率，a=1、c3=.1、sigma=0。以有理數精確算 w=7/5：

- e_det=(0,+.3,0,−.3,0)。
- mean-field 的 sign(0)=0：E[x sign(e)]=−.4。
- 硬體 tie=+1：兩個 x=±2 的 tie 貢獻相消，E[x q] 仍然=−.4。
- w 從左側接近 1.4 時 G=+.4；從右側接近時 G=−1.2。因此是跨過 0 的**跳躍**，不代表 G(1.4)=0。

`1.4` 的正確意義是 MAE 最小值（加權中位數），以及小步長更新所圍繞的非光滑吸引位置。最佳化條件是 `0 ∈ ∂J(w*)`，不是選定 sign(0)=0 後一定有 `J'(w*)=0`。本例 `J(w)=.4|1.1−w|+.8|1.4−w|`，`∂J(1.4)=[−.4,1.2]` 確實含 0。網站後段已正確說實際不會停在 1.4 而有 O(mu) limit cycle；應使前面定義、公式 registry、求根狀態與這段一致。

另外「tie 只影響測度為 0 的點」在連續 noise/code 下通常成立，在此離散五階 code + sigma=0 不成立：x=±2 的總機率=.4，外加 x=0。建議直接說 tie 可能有正機率質量，精確 mean-field 需指定 tie convention；MAE 最小點改用次梯度判斷。

**驗收。** 用 Fraction 避免浮點把 e=0 翻成正負，確認上面 G(1.4)=−.4；教材不得再宣稱它同時為單值 G 的 exact root。可讓求解器回傳 `jump-attractor`／`MAE-minimizer` 而非 `root`，或至少在展示時區別這兩種狀態。維持 1.34 MSE、1.4 MAE 與兩側 +.4/−1.2 的正確結果。

一次來源：[Stanford EE364b, Subgradients](https://stanford.edu/class/ee364b/lectures/subgradients_notes.pdf)，abs 在 0 的次梯度為區間，凸最小化條件為 0 落在次微分集合。

## R06 近似與條件不能在下一條公式變成無條件精確

本項合併三處同類問題；共同修正是明示模型層級與成立條件，並不是把所有等號機械式換成約等號。

### R06a Ch09 的 Sign-LMS 平均遞迴

**位置**

- `/ch/09`、公式總表：`src/chapters/ch09/formulas.ts:35–39`（F-09.3），`claim: 'exact'`，conditions 只有 block 獨立，未限制 linear detector 或小訊號。
- 同檔 F-09.2 已正確標 approx，F-09.16 已給 Gaussian regressor 的 Bussgang 精確式。
- `src/chapters/ch09/sections/MeanRecursion.tsx:112–121`：第 112 行用 `≈`，115 行「把兩種偵測器寫成同一個形式」就換成 `=`，後續 boxed recursion 沒保留近似符號。128–129 行警語有補充線性／1-bit 區別，但公式資料庫仍給 exact。

**證明**

令單參數、u~N(0,1)、v~N(0,1)、δ0=1，μ=.1。真實 sign 更新：

```text
E[sign(uδ0+v)u] = sqrt(2/π)/sqrt(2) = 1/sqrt(π) = .5641895835.
E[δ1] = 1 − .1/sqrt(π) = .9435810416.
```

F-09.3 以 `Kq=sqrt(2/π)` 卻給 `.9202115439`。資料 iid、與 δ0 獨立皆成立，差異來自小訊號線性化而不是 independence approximation。網站自己的 F-09.16 正好就是正確依據。

**建議**：F-09.3 和衍生 pole 公式改成「linear detector 精確；sign detector 局部近似」，sign 情況用 `≈`。也可拆成兩筆公式，讓 formula registry 不把 mixed claim 標 exact。

**驗收**：查 formula reference / Ch09 主頁均顯示相同條件。大 δ 用 Bussgang 精確 mean drift，δ→0 才逼近 KqRδ。不要把 `E[f(δ)]` 又換成 `f(Eδ)` 而不標 mean-field 近似。

### R06b Ch07 和 SSPLL 的 frozen-weight 假設

- 嚴重度：P2（影響讀者理解 PLL 記憶及快速 adaptation 的有效範圍）；可信度：高。
- 頁面：`/ch/06` F-06.1 vs `/ch/07` F-07.1/F-07.9；同類問題出現在 `/case/sspll` §4 的卷積提出權重。
- 定位：[src/chapters/ch06/formulas.ts:14](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/chapters/ch06/formulas.ts#L14)、`:15`；[src/chapters/ch07/formulas.ts:12](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/chapters/ch07/formulas.ts#L12)–`:14`；[src/chapters/ch07/sections/S4Gradient.tsx:27](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/chapters/ch07/sections/S4Gradient.tsx#L27)；[src/pages/case-sspll/sections/S04MeanUpdate.tsx:117](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/pages/case-sspll/sections/S04MeanUpdate.tsx#L117)（搜尋式子 `h_PD*(sum δ_j x_j)=sum δ_j(h_PD*x_j)` 可定位）。
- 證據：第 06 章正確寫 `H*((a-w)x) ≈ (a-w_k)(H*x)`，且條件是 w 在 h 的記憶長度內近似常數。第 07 章相同式子變成等號、claim exact，conditions 只剩 LTI 與雜訊獨立，甚至強調狀態跨 block 持續。LTI 只允許「時間不變的係數」提出卷積；block 内固定不代表卷積記憶內固定。
- 正確通式：`e[n]=Σ_m h[m](a-w[n-m])x[n-m]+v[n]`。只有 frozen w，或充分慢的 adaptation，才能變成 `≈(a-w[n])Σh[m]x[n-m]+v[n]`。對固定參數代價函數推 `dJ/dw=-E[e u]` 本身可精確成立，但要明確說是在 frozen-parameter 模型內的導數，不是完整動態權重歷史的即時導數。
- 最小反例：`h=[1,-1]`、x 恒為 1、a=1。w 由上一拍 0 跳到本拍 1。真實 `h*((a-w)x)=0-1=-1`，而 `(a-w)(h*x)=0*(1-1)=0`。差異恰來自舊權重仍留在誤差路徑記憶中。
- 程式現況：[src/simulation/models/blockLms.ts:1253](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/simulation/models/blockLms.ts#L1253)–`:1256` 先算當拍 `dt=coef*x` 再進有狀態 filter，順序是正確的；Ch08 也有説明 quasi-static 失效。SSPLL §12 (`sections/S12S13.tsx:45`) 後面才補時間尺度分離。
- 建議驗證：將 F-07.1 的 exact 條件明定 frozen w，或改成與 F-06.1 同一個近似式；SSPLL 在第一次提出 δ 時就補前提。補用上述兩拍反例說明，不需把整章升級為控制理論研究所教材。

### R06c Ch12 的小訊號判據不可只看相關係數 C

[src/chapters/ch12/formulas.ts:15](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/chapters/ch12/formulas.ts#L15)（F-12.1）使用 `|C δw|≪sigmaV`；正文 `sections/S2Recursion.tsx:91`–`:144` 採 `x=±1`、memoryless `u=Cx`，在此特定模型下合理。但一般 `C=E[x(h*x)]` 很小，並不代表 comparator 看到的 waveform 很小。

例如 iid ±1 code、`u[n]=.001x[n]+x[n−1]`，C=.001；`δw=10,sigmaV=1` 時 Cδw=.01 看似小，真實訊號卻約±10，已飽和。請在公式總表補上 ±1／memoryless 條件；一般路徑檢查整個 deterministic residual 的幅度。驗收應讓此兩 tap 反例無法被誤認為小訊號區，並保留原本正確的 scalar lab。


## R07 負相關時的 condition number 公式缺少絕對值

**位置**

- `/ch/09`、公式總表，`src/chapters/ch09/formulas.ts:58–59`（F-09.5），`κ=(1+ρ)/(1−ρ)`，未限定 ρ≥0。
- [src/chapters/ch09/experiments/peLabState.ts:44](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/chapters/ch09/experiments/peLabState.ts#L44) 等 `PE_LIMITS.rho=[-1,1]`，互動明確允許負相關。
- [src/simulation/models/pe.ts:156](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/simulation/models/pe.ts#L156) 是正確的排序 eigenvalue ratio，勿改壞。

**反例**：ρ=−.5 時 R 的 eigenvalues 為 {.5,1.5}，κ₂(R)=3。登錄式給 1/3。ρ=−1 更會給 0，而 R 奇異、κ=∞。

**修正**：`λmax=1+|ρ|, λmin=1−|ρ|, κ=(1+|ρ|)/(1−|ρ|)` for |ρ|<1；|ρ|=1 為∞。`λ1=1+ρ`、`λ2=1−ρ` 配對固定 eigenvectors 的公式本身仍正確，不必改；只要別把 λ1 無條件叫最大值。

**驗收**：ρ=±.5 均得到 κ=3，ρ=±.99 均199，ρ=±1 均∞；主文、公式總表與 lab 數值相符。

## R08 Sign-LMS 格點平均忽略上邊界卻標示精確

**位置**

- `/ch/01`，`src/chapters/ch01/formulas.ts:165–170`（F-01.16）：equal sign 與 `claim:'exact'`。
- `src/chapters/ch01/sections/MedianExample.tsx:710–725`：說右邊每一格 down=3/4、up=1/4；說換 tie 只改 w=0，忽略 w=10 的 tie。
- 同檔 `:435–441`（Research 模式推導）其實明寫 w≥10 的機率很小、「以下忽略」。因此這是主文／公式與隱藏推導的矛盾，不是作者完全不知道截斷。
- [src/simulation/models/lossCompare.ts:772](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/simulation/models/lossCompare.ts#L772) 的 `signErrorLatticeStationary` 反而正確包含有限上邊界，應保留。

**可重現反例**

x=1；y 每筆 iid 取 {0,0,0,10}；w0=0；μ=5；精確算術。全部符合登錄條件。zero tie 時只會在 {0,5,10}：

```text
π=(9/13,3/13,1/13), E[w]=25/13=1.923076923 ≠ μ/2=2.5.
```

網站本身 lattice 函式給：

| tie | exact mean | F-01.16 宣稱 |
|---|---:|---:|
| 0 | 1.923076923 | 2.5 |
| +1 | 4.423076923 | 5 |
| −1 | −0.576923077 | 0 |

zero tie 且 `M=10/μ` 為正整數，有限鏈精確值是

```text
E[w] = μ [ r/(1−r) − (M+1)r^(M+1)/(1−r^(M+1)) ], r=1/3.
```

`μ/2` 只是第二項可忽略時的近似。預設小 μ 的修正小於 double 精度，所以既有測試看不見；不應據此說它數學上 exact。

**建議**：保留易懂的幾何鏈推導，但把 `=` 改 `≈`、標明 μ≪10、忽略 upper-boundary mass；大步長用現有 lattice 計算。對高中讀者說「此例 μ 很小，到 10 幾乎不會發生，所以近似忽略」即可，不必搬完整有限鏈公式到主文。tie 會改變所有與資料值重合的格點，不只有 0。

**驗收**：μ=5 測例比對 exact lattice；μ=.02 時近似仍正確到顯示精度；formula registry claim 與 Research 推導一致。

## R09 SSPLL GOS 的正規化與 DC 基準需要一致

- 嚴重度：P2（正規化數值可差 25% 以上；不會單靠正的 scaling 改變反號圖）；可信度：高。
- 頁面：`/case/sspll` F-CS.11、§7.1。
- 定位：[src/pages/case-sspll/formulas.ts:120](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/pages/case-sspll/formulas.ts#L120)–`:121`；[src/pages/case-sspll/sections/S07Gos.tsx:86](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/pages/case-sspll/sections/S07Gos.tsx#L86)、`:95`；對照程式 [src/simulation/models/sspll.ts:1421](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/simulation/models/sspll.ts#L1421)、`:1452`、`:2000`、`:2030`。
- 證據：公式寫 `κ_GOS=C_GOS/var(ρ)=12C_GOS`，條件包含 `α` 有理且 8|Q。對 `β=a/b` 最簡分數，ρ 取 b 個等距值，`varρ=(b²-1)/(12b²)`，只有無理／長週期極限才是 1/12。程式的 `kappaRational` 正確除以實際 covariance，`analyseAlpha` 則回傳 12C；教材未把兩者區分。
- 可重現反例：α=1/16，β=1/2，ρ 交替 0、1/2，所以 varρ=1/16。取合法 Type-I K=1/2，`H(0)=0`、`H(π)=4/3`，因此 `C=(1/16)(4/3)=1/12`。`12C=1`，但 `C/varρ=4/3`，兩個 κ 並不相等。
- 另一個範圍問題：§7.1 說 `H≡1` 時 `12C=1`。這只對**先移除 DC 的 regressor/AC 功率基準**成立。原始 rho 在 [0,1) 均勻且 H=1 時，`C=Eρ²=1/3`，因此 12C=4；網站的 closed-loop 譜線公式之所以能忽略 DC，是因為 H(0)=0，不能直接拿來替換成 H≡1 卻繼續忽略 DC。
- 建議驗證：α=1/16 用 `cPeriodic`／`kappaRational` 與 `analyseAlpha` 比對，明確區分「12C 的固定尺度指標」與「除實際 varρ 的 κ」。反號結果通常保持不變，所以不應為了修文字重算／推翻全部 signmap。開迴路基準請直接聲明先去平均，或寫清楚只比較 AC 功率。

## R10 SSPLL 複數 kappa 的上下界應明確取實部

- 嚴重度：P2（公式矛盾，尤其後續有限步長需虛部）；可信度：高。
- 頁面：`/case/sspll` F-CS.13、F-CS.14、§8.1/§8.2 與 §12。
- 定位：[src/pages/case-sspll/formulas.ts:140](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/pages/case-sspll/formulas.ts#L140)、`:150`；[src/pages/case-sspll/sections/S08Phos.tsx:96](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/pages/case-sspll/sections/S08Phos.tsx#L96) 的實部近似方框，另見同檔 `:112` 的 κ 定義切換；[src/pages/case-sspll/sections/S12S13.tsx:31](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/pages/case-sspll/sections/S12S13.tsx#L31)。
- 證據：F-CS.13 定義 `κ_m=8λ_m=Σw_l Γ(lα)`，一般是複數。F-CS.14 卻寫 `real lower bound ≤ κ_1 ≤ real upper bound`；§8.1 又寫 `κ_1≈W1 ReH+其他實數貢獻`。§12 同時正確提醒 κ 可以是複數，並使用 `Re κ > |κ|²/(2Nτ)`。
- 反例：合法 Type-I `K=0.5`、α=1/8（Q=8，occupancy 均勻）。一個 PHOS 模態的 `κ_1=H(e^{jπ/4})=0.8092564302+j0.6512392831`（DFT 索引方向相反時為共軛，不影響問題）。複數無法與兩個實數作通常意義的 ≤ 比較。
- 正確改法：保留 `κ_m=8λ_m`，所有反號上下界與只畫實部的表格使用 `Re κ_m`；或另定實數 `κ_m^(R)=8Reλ_m`，但不可在有限步長式誤用它取代複數 κ。
- 程式現況：[src/simulation/models/sspll.ts:1995](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/simulation/models/sspll.ts#L1995) 保留 Complex[]，`:2028`、`:2032`–`:2033` 的最差模態／界限只取實部，這是對的。
- 建議驗證：搜尋所有 κ_m/κ_1 的表格與公式，確認當用於排序、正負、上下界時明寫 Re；用帶虛部的例子驗證有限步長公式仍保留 |κ|²。

## R11 Half-even 平均零誤差需要額外的 tie 條件

- 嚴重度：P2/P3（數學聲稱過強；一般高雜訊近 Gaussian 例子不一定受影響）；可信度：高。
- 頁面：`/ch/04` F-04.10、§固定點／右移。
- 定位：[src/chapters/ch04/formulas.ts:111](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/chapters/ch04/formulas.ts#L111)–`:112`；[src/chapters/ch04/sections/FixedPoint.tsx:272](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/chapters/ch04/sections/FixedPoint.tsx#L272)、`:277`；[src/simulation/models/gmac.ts:350](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/simulation/models/gmac.ts#L350)、`:363`。
- 證據：教材說在「餘數均勻」前提下 half-even 的平均誤差精確為 0；推導直接加入「奇偶各半」。但餘數均勻並不代表 tie 發生時的商奇偶各半，程式 helper 也無條件回傳 0。
- 最小反例：右移 ℓ=2，令 `S=8K+R`，R 均勻於 {0,1,2,3}，K 獨立取任意整數分布。`S mod4` 完全均勻，商為 2K（恒為偶數）。half-even 輸出的誤差依序 0、-1/4、-1/2、+1/4，平均 -1/8 LSB。K 可以分布很廣，讓 σS≫4；大 RMS 本身也不能補足 tie 奇偶條件。
- 正確條件：除均勻餘數外，需 `P(j為偶數 | R=2^(ℓ-1))=P(j為奇數 | R=2^(ℓ-1))`。或直接聲明 S 在模 `2^(ℓ+1)` 上近均勻。一般式的 tie 貢獻為 `(1/2)[P(tie 且 j奇)-P(tie 且 j偶)]`。
- 建議驗證：用上述 4 點／加上多個 K 的枚舉驗證，再補條件與 helper documentation。`shiftRound` 的 half-even 實作不一定有 bug；要修的是理論適用條件，不是將 half-even 換成別的 rounding。



## R12 雙參數單頻模型需要補上交叉頻譜假設

**優先度 P1；判定：缺少關鍵假設，對固定同頻正交 code 可重現錯誤的穩定判定。**

位置：[首頁](https://gmcycle7.github.io/LMS_PLL_CAL/#/)，[src/pages/dashboard/thesisModel.ts:8](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/pages/dashboard/thesisModel.ts#L8)、`:348`、`:502`。模型以兩個單頻 code 的零延遲相關係數 `rho`，直接把平均恢復矩陣寫成 `C R̃`。但零延遲相關不足以決定通過有相位的 H 後的交叉相關。

令 `x₁=√2 cos(Ωn)`、`x₂=√2 sin(Ωn)`，則 `Rₓ=I`、`rho=0`。若 H 在此頻率為 `exp(jφ)`，實際

```text
E[x uᵀ] = [[cosφ, sinφ], [-sinφ, cosφ]]
```

並非 `cosφ I`。取 `φ=60°`、`μKq=1.5`、`D=d=0`、`Px=|H|=1`：網站計算的 spectral radius 為 `0.25`、stable=true；實際平均矩陣 `I−μKq E[xuᵀ]` 的 radius 是 `√1.75 = 1.3228756555`，不穩定。以上網站輸出已直接呼叫現有 `evaluateThesis` 重現。

這不表示 `C R̃` 永遠不能用：若另假設各通道交叉頻譜為實對稱、正交相位交叉項為零，或使用適當隨機幅相 ensemble，該簡化可成立。但固定 code 的時間平均不會自動等於這個 ensemble。

**建議：** 明示並落實此額外假設；或以真正的 `E[x_ref uᵀ]` 計算 Jacobian；或把首頁限制成單參數／無相位差的示例。不要只以 `rho` 推出任意多參數 PLL 的穩定性。

**驗收：** 加入正交同頻反例；選擇保留簡化模型時，介面必須說明該輸入情境不在適用範圍，不能顯示成一般實體 code 的穩定保證。

## R13 六個面向需要分別檢查，不代表數學上互相獨立

**優先度 P2；判定：確定的邏輯用語過強。**

位置：[src/pages/dashboard/sections/Thesis.tsx:27](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/pages/dashboard/sections/Thesis.tsx#L27)、`:41`，`sections/Wrapup.tsx:142`。頁面把六條件稱為彼此獨立，並說通過其中五個仍可能在第六個失敗。

在網站自己的 scalar 模型中，`μ>0`、`Kq>0`，平均穩定 `|1−μKq C|<1` 已經推出 `C>0`。所以「穩定」和「正確極性」有邏輯關係。程式也在不可辨識、極性錯誤或不穩定時，直接令 system-level 判定失敗（`thesisModel.ts:760`）。「前五項不保證第六項」只能證明那一個方向的非充分性，不能證明六項互相獨立。

**建議：** 改成「六個需要分別檢查的面向，彼此有關聯；單看 GMAC 歸零、PM 或係數變異，不能取代完整檢查。」保留檢查表與反例，移除獨立性的普遍斷言。

**驗收：** 首頁、recap、圖說與測試快照一起調整；保留 `stability ⇒ polarity` 在指定 scalar 正步長模型中的推導。

## R14 在預算內與真正改善輸出是不同判斷

**優先度 P2；判定：介面結論超過實際計算範圍。**

位置：[src/pages/dashboard/data.ts:130](https://github.com/gmcycle7/LMS_PLL_CAL/blob/01094638d1617025c98ef55e6c7dba8086104cde/src/pages/dashboard/data.ts#L130)、`:132`；`thesisModel.ts:545`–`:553`、`:764`–`:773`。

第六張卡片問 PLL 輸出是否變好，但程式只檢查 DTC-referred RMS 是否低於預算及單 tone spur 是否低於上限，沒有比較校正前後。它也沒有把隨機 timing-error PSD 經完整 `T(f)` 後積分成 PLL output jitter；程式僅將 `Tmag` 用於單 tone spur。其他位置已正確把 `sigmaDt` 稱為 DTC-referred，因此應修正這張卡片的結論範圍。

可重現反例：沿用首頁預設值，令 `B=0,w0MinusA=0`。校正前 gain 已完全正確，這個模型的 gain-error timing 為 0；開啟固定步長追蹤後，網站預測 `sigmaDtRand=0.39918614299 fs`，第六條仍顯示「通過」。這代表滿足 1 fs 預算，不能證明優於校正前。

**建議：** 最小修改是改名為「本模型下的殘餘誤差／spur 是否在預算內」，並在卡片旁明示 timing 是 DTC-referred。若保留「真正改善 PLL 輸出」，就需增加相同 FCW、相同頻帶、相同雜訊源下的 before/after 基準及完整輸出傳遞。

**驗收：** 上述已完美校正的例子不得顯示「改善」；允許顯示「符合預算」。輸出 jitter 與 DTC-referred RMS 不混用。


## 較小修正項目

這些項目大多只需補條件或改文字；除非新增反例顯示實際運算有錯，不建議改寫數值核心。

| ID | 位置 | 問題與建議驗收 |
|---|---|---|
| C01 | Ch10 `sections/S2UpdateMatrix.tsx:392` | 「最小 eigenvalue 決定收斂速度」只在適當小步長時成立。一般看 `maxᵢ\|1−gλᵢ\|`。λ={1.5,.5},g=1.2 時 poles={−.8,.4}，λmax 對應的震盪模式才最慢。與本章 `handcalcs.ts:295` 已正確的提示一致化。 |
| C02 | Ch13 F-13.12，`formulas.ts:131` | Telescoping 給出 `\|平均誤差\|=\|r首−r尾\|/N`；僅知道 r 有界，不能把常數定為1。常數 1/N 要再假設無 dither、單位量化步階且首尾 r 在同一寬1區間。N=1,wH=32.4,r初=0,A=2,d=−.99 可輸出31、誤差−1.4，雖無 overload 卻超過1。正文方法 D 已有 ±.5 條件；公式總表應同步帶入，保留 telescoping identity。 |
| C03 | Ch12 `formulas.ts:47`–`:53`、Ch14 F-14.11、Formula 頁 `sections/units/SpectrumTopic.tsx:85` | `variance=(1/2π)∫S(Ω)dΩ` 的 S 與「每 rad/block」密度不要同名混用。若定 `S_rad=S/(2π)` 才能直接對 dΩ 積分。統一慣例及標籤；已正確的 one-sided per-Hz 換算 `2S(2πf/fu)/fu` 不要因此多乘2π。 |
| C04 | Ch11 `sections/InlSection.tsx:196` | 表格 x=0 的 e0 明明為0，文字應由「沒有一個是0」改成「並非全部為0」。 |
| C05 | Ch11 `sections/InlSection.tsx:258`–`:260` | erf 的 Maclaurin 級數對所有有限引數收斂；小 sigma 下三階式失準應稱「低階截斷不準」，不能說整個 Taylor 級數不收斂。 |
| C06 | 首頁 `data.ts:82`、`sections/MathSpine.tsx:408` | 雙迴路步長上限是準靜態一半，應明指 Ch08 指定二狀態、舊觀測值更新模型；不要寫成所有 PLL 雙迴路的通則。Ch08 本身的 Jury 結果保持。 |
| C07 | SSPLL F-CS.18、§12 | 遞迴 pole=`1−1/Nτ` 的精確 e-folding time 是 `−1/ln\|1−1/Nτ\|`。Nτ=5 時為4.4814 blocks，請將 Nτ 稱為名義／小步長時間常數；有限步長穩定不等式保持。 |
| C08 | SSPLL `sections/S02Architecture.tsx:57` | 從實際乘法 `(1−a)(1+wg)` 化成誤差 `(a−wg)` 時，第一次出現就標「忽略 a·wg 的一階近似」。精確補償是 `wg=a/(1−a)`。後段 §14 已說明，將條件前移即可。 |
| C09 | Ch01 `sections/Parabola.tsx:416`、F-01.5 | `E[e*x]=0` 通用名稱是正交；covariance=0 還需要均值條件。例如 x={1,2},v={1,−1},a=0 等機率，w*=−.2，E[e*x]=0 但 Cov(e,x)=−.45。若本段已限定 v 與 x 獨立且零均值，簡稱不相關可成立；否則以正交為主詞。 |

## 以電機系大學畢業生為讀者的改進方向

不需要把所有小例子變成完整研究論文。保留「先算數字，再推導」與 Beginner／Engineer／Research 的分層，但調整以下四點：

1. **Engineer 模式應就地看到限制。** 小訊號、iid、frozen weights、mean-field、單頻、D=0、未量化等條件，放在使用它的公式旁。完整證明可以收在 Research，成立條件不應只藏在那裡。
2. **每個跨章轉換留一句橋接。** 從 `e=(a−w)x` 到 `e≈(a−w)(h*x)`，從 linear detector 到 sign detector，從 scalar pole 到 general matrix，從係數 RMS 到 output jitter，各說明新增了哪個假設、哪個量仍相同。
3. **把驗證徽章綁定到明確聲稱。** 「時域與頻域的 C 相同」只驗證 C；「Gaussian comparator 固定點」要查 E[G]；「95% settling」要檢查軌跡／範數。不要把旁支子計算通過等同整個推論鏈通過。
4. **高中範例可以近似，但名稱應準確。** μ很小、忽略極小的尾端機率等，用一句白話即可；不必為了易讀把約等號改成等號、把最小值稱成一般導數零點。

## 已核對正確而應保留的內容

以下清單避免後續修正造成新的錯誤：

- **LMS 的成本、梯度與極性。** `J=½E[e²]`、`δ=a−w`、`w+=μex` 一致；sign-error、sign-data、sign-sign 與 NLMS 不應混為一談。可與 [MathWorks LMS 演算法定義](https://www.mathworks.com/help/dsp/ref/lmsfilter.html) 交叉核對。
- **穩定性有不同意義。** scalar iid Gaussian 的 mean 上限 `2/Px`、mean-square 上限 `2/(3Px)` 與無加性雜訊下 almost-sure 上限約 `2.4212/Px` 不矛盾。單一路徑衰減但 ensemble 二階矩增加是可能的；不能把 Gaussian regressor 換成固定 x 的判據。
- **Comparator 統計與 tie。** Gaussian noise 的 erf、`Kq=√(2/π)/sigmaV`、偶數 N 的 binomial tie、sum／average 的 N 倍 scaling，主要推導正確。
- **MSE 與 MAE 的不同目標。** 五階 code 的三階 INL 例，MSE 最佳 gain=1.34、MAE 加權中位數=1.4；R05 只修正「單值 GMAC 零點」的說法，不能把1.4改回1.34。
- **PLL 兩條觀測路徑。** 在指定誤差注入約定下，`H_PD=1/(1+L)`、`T=L/(1+L)` 正確；比較節點殘差與 output jitter 不可互換。
- **Code delay 的符號。** `E[x[n−D]u[n]]` 的單頻相位是 `φ+ΩD`；不要因 delay 自身是負相位，就把這裡的加號改成減號。
- **純更新延遲的界限。** `g*=2sin(π/(4d+2))` 和 `PMd=90°−(2d+1)asin(g/2)` 在指定平均模型下正確；R02 修正 finite-time 指標，不推翻其漸近穩定性。
- **SSPLL 的有向推論。** 反號可推出 `Re T>1` 和 `|T|>1`，逆向未必成立；一階差分安全條件及 nominal signmap 不應因正規化文字問題而整批否定。GOS 不反號的數值猜想也不能擅自升級為定理。
- **雜訊與頻譜換算。** AR(1) 的係數 PSD、穩態 variance、−3dB 與 ENBW 的區別、ZOH time-averaged PSD、單邊 per-Hz 轉換主要正確。相位／時間 jitter 及指定頻帶積分概念可參照 [Analog Devices 的 jitter 與 phase noise 說明](https://www.analog.com/en/resources/technical-articles/clock-clk-jitter-and-phase-noise-conversion.html)。
- **量化策略的取捨。** 常數32.4的一階 EFB 週期5、stochastic rounding variance=.24、PRBS可能仍有譜線、dither可能增加帶外功率等說法正確。不要套獨立均勻白量化雜訊去抹掉已確認的 limit cycle。
- **Ch14 的有限時域最佳化。** bias²+variance、ramp／random-walk 的小步長條件與確定步長 schedule 推導，這次核對未發現主要代數錯誤；不應把指定線性模型的最佳值宣稱成所有非線性估計器的普遍資訊下界。

## 可直接執行的獨立反例

下列程式需要 Python、NumPy、SciPy，不 import 網站程式。它驗證反例的數學；Claude Code 還需用相同輸入呼叫網站函式和確認 UI／formula registry。穩定判據正確但有限時間估算錯誤的原理，也可參照 [Reuter 的 nonnormal matrix powers 原論文](https://arxiv.org/abs/1909.05931)。

```python
"""Independent counterexamples for review; does not import website algorithms."""
from fractions import Fraction
from math import gcd
import numpy as np
from scipy.special import erf

# Ch11: exact periodic DSM + frequency-domain Hpd, then nonlinear Gaussian comparator.
wn, zeta, b, sigma = .02, .707, .01, 1.
kp, ki = 2*zeta*wn, wn**2
M, K = 65536, 20
P = M // gcd(K, M)
residue = -((K*np.arange(1, P+1)) % M) / M
x = (residue-residue.mean()) / residue.std()
theta = 2*np.pi*np.fft.fftfreq(P)
q = np.exp(-1j*theta)
H = (1-q)**2 / ((1-q)**2 + (kp+ki)*q**2 - kp*q**3)
u = np.fft.ifft(np.fft.fft(x)*H).real
C = np.mean(x*u)
bias = b/C
e = -bias*u + b*x
G = np.mean(x*erf(e/(np.sqrt(2)*sigma)))
print('NI frac=', K/M, 'C=', C, 'linear bias=', bias)
print('NI max|e|/sigma=', np.max(abs(e))/sigma, 'nonlinear E[G]=', G)
assert abs(C-.0027939677342546155)<1e-12
assert abs(G-.04881877480806)<1e-10

# Ch11: exact arithmetic avoids floating-point tie ambiguity at the MAE minimizer.
xs = [Fraction(k) for k in [-2,-1,0,1,2]]
es = [(1-Fraction(7,5))*x+Fraction(1,10)*x**3 for x in xs]
sign0 = lambda t: 1 if t>0 else -1 if t<0 else 0
tieplus = lambda t: 1 if t>=0 else -1
for label, sign in [('mean-field sign(0)=0',sign0),('hardware tie+1',tieplus)]:
    g = sum(x*sign(e) for x,e in zip(xs,es))/5
    print('Median', label, 'e=', es, 'G(1.4)=', g)
    assert g == Fraction(-2,5)

# Ch13: Gray encoding only guarantees adjacent-value transitions.
gray = lambda n: n ^ (n>>1)
a,c = 31,34
print('Gray',a,format(gray(a),'06b'),'->',c,format(gray(c),'06b'),'Hamming=',(gray(a)^gray(c)).bit_count())
assert (gray(a)^gray(c)).bit_count() == 3


# R02: general matrix, repeated eigenvalue, and delayed scalar history.
A = np.array([[.5, 1.], [0., .5]])
d0 = np.array([0., 1.])
reported = int(np.ceil(np.log(.05)/np.log(.5)))
assert reported == 5
assert np.linalg.norm(np.linalg.matrix_power(A, 5) @ d0) > .3
assert np.linalg.norm(np.linalg.matrix_power(A, 8) @ d0) > .05
assert np.linalg.norm(np.linalg.matrix_power(A, 9) @ d0) < .05
assert (1+5/2)*2**(-5) == .109375
assert (1+6/2)*2**(-6) > .05 > (1+7/2)*2**(-7)

# R03: perfect filtered-x model, but additional D reverses correlation.
n = np.arange(16)
u = np.cos(np.pi*n/2)
assert np.isclose(np.mean(u*np.roll(u, 2)), -.5)

# R06a: exact first-step sign drift for scalar Gaussian u,v and delta=1.
actual_mean_delta = 1-.1/np.sqrt(np.pi)
linearized_mean_delta = 1-.1*np.sqrt(2/np.pi)
print('R06a exact / linearized:', actual_mean_delta, linearized_mean_delta)
assert abs(actual_mean_delta-linearized_mean_delta) > .02

# R07: condition number must not fall below 1 for negative correlation.
R = np.array([[1., -.5], [-.5, 1.]])
assert np.isclose(np.linalg.cond(R), 3.)

# R08: stationary finite lattice with y={0,0,0,10}, mu=5, zero tie.
Pmarkov = np.array([[.75, .25, 0.], [.75, 0., .25], [0., .75, .25]])
pi = np.array([9.,3.,1.])/13
assert np.allclose(pi @ Pmarkov, pi)
assert np.isclose(pi @ np.array([0.,5.,10.]), 25/13)

# R09: rational-code normalization and R11: half-even residue balance.
var_rho, Cgos = 1/16, 1/12
assert np.isclose(Cgos/var_rho, 4/3) and np.isclose(12*Cgos, 1)
shift_errors = [round(r/4)-r/4 for r in range(4)]
assert np.mean(shift_errors) == -.125

# R12: covariance I does not remove quadrature cross-correlation.
phi, muKq = np.pi/3, 1.5
Ccross = np.array([[np.cos(phi), np.sin(phi)],
                   [-np.sin(phi), np.cos(phi)]])
true_radius = max(abs(np.linalg.eigvals(np.eye(2)-muKq*Ccross)))
assert np.isclose(true_radius, np.sqrt(1.75)) and true_radius > 1
print('R12 true radius:', true_radius, 'separable-model radius:', abs(1-muKq*np.cos(phi)))
print('All independent counterexample assertions passed.')
```

本次直接呼叫網站既有函式的對照輸出如下；這些數字不是上面獨立程式自行假定的網站結果：

```text
mimo buildPlant errors: []
analyzeRule A = [[0.5,1],[0,0.5]], rho=0.5, blocks95=5
signErrorLatticeStationary(mu=5):
  zero tie mean=1.923076923076923
  plus tie mean=4.4230769230769225
  minus tie mean=-0.5769230769230766
evaluateThesis(d=1,g=.25): slowT95Blocks=5
evaluateThesis(twoParam=true,rho=0,phi=60°,muKq=1.5):
  maxRadius=.25, stable=true
evaluateThesis(defaults except B=0,w0MinusA=0):
  sigmaDtRand=.39918614299092875 fs, system.state='ok'
```

## 修正後的驗收順序

1. 先確認 R01、R02 的反例目前可重現；R12 先用明文模型假設決定要補限制或改 Jacobian。
2. 針對被修改的數學聲稱加入最小回歸測試，測反例與正常對照，不只 snapshot 某個既定字串。
3. 保留原有 numerical tests 與 Python golden tests；檢查正文、formula registry、圖說、手算、互動輸出是否共用相同條件。
4. 在 Engineer 模式走一次涉及修改的頁面；Beginner 模式仍應保留簡短前提，不要求讀者開 Research 才發現公式不適用。
5. 在逐項結果中明確記錄哪些只修文字、哪些改計算、哪些維持原狀及其理由。不要以測試總數或所有徽章變綠代替逐項驗證。
