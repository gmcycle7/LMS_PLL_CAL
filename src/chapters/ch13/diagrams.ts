/**
 * 第 13 章的方塊圖（Mermaid 原始碼；docs/teaching-style.md §8）。
 *
 * - 每張圖是一個具名匯出的字串；`DIAGRAMS` 是全章的清單（diagrams.test.tsx 逐一用真正的 mermaid parser 解析、
 *   在 jsdom 裡實際 render 一次，並把圖上的數字和 `src/simulation/models/quantizer.ts` 的結果比對）。
 * - 節點文字用 Unicode 數學符號（Mermaid 不渲染 KaTeX）。圖上的訊號名稱、正負號、箭頭方向與正文公式一致：
 *   `e = δw = y − w*`（本章顯示用的約定）、`δ = a − w = −δw`（§0 約定，勘誤 E49）、
 *   `v[n] = w_H[n] + r[n−1]`、`y[n] = Q_B(v[n])`、`r[n] = v[n] − y[n]`。
 * - 加法點與正號一律用全形的「＋」（U+FF0B）：Mermaid 11 會把每個標籤當成 Markdown，
 *   半形 `+`、`-`、`1.` 開頭的標籤會被判成清單而顯示「Unsupported markdown: list」。負號用「−」（U+2212）。
 * - 顏色：藍（focus）= 這張圖要看的方塊；紅（warn）= 會出問題的地方；綠（ok）= 安全 / 對策。深淺主題都看得清楚。
 */
import type { SystemBlock } from '@/components'

const STYLE = `
  classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff,stroke-width:2px
  classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff
  classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff`

/* ───────────────────────── §13.0 開場 ───────────────────────── */

/** （原有）6-bit gain code 的訊號流：高解析 accumulator → 量化策略 → 6-bit register → DTC。 */
export const CHART_SIGNAL_FLOW = `flowchart LR
  G["GMAC 平均 G_k"] --> ACC["LMS accumulator<br/>w_H（高解析）"]
  ACC --> Q{"量化策略<br/>A Freeze / B Toggle / C Stochastic<br/>D ΔΣ / E ΔΣ+dither"}
  Q --> REG["6-bit gain register<br/>y ∈ {0..63}"]
  REG --> DTC["DTC：延遲 = Δ_LSB·y·x[n]"]
  DSM["DSM residue x[n]"] --> DTC
  DTC --> PD["PD / comparator"] --> G
  DTC -. "δt = Δ_LSB·(y − w*)·x" .-> OUT["PLL output（經 T(f)）"]${STYLE}
  class Q focus`

/** 誤差的定義、單位換算與兩種正負號約定（F-13.1、勘誤 E13 / E49）。 */
export const CHART_ERROR_PATH = `flowchart LR
  Y["y[n]<br/>6-bit code（LSB）"] -- "＋" --> S1(("＋"))
  WS["w*<br/>理想係數 32.4（LSB）"] -- "−" --> S1
  S1 -- "e = δw = y − w*（LSB）" --> K["× Δ_LSB<br/>fs/LSB，示例 0.125"]
  K -- "gain 誤差（fs）" --> M(("×"))
  X["x[n]<br/>DSM residue"] --> M
  M -- "δt[n] = Δ_LSB·e[n]·x[n]（fs）" --> T["T(f)<br/>PLL low-pass"]
  T --> OUT["PLL 輸出的 jitter / spur"]
  WS -- "＋" --> S2(("＋"))
  Y -- "−" --> S2
  S2 -- "δ = a − w = w* − y = −δw" --> N0["§0 的約定<br/>同一個誤差，正負號相反"]${STYLE}
  class S1,K focus`

/* ───────────────────────── §13.1 方法 A ───────────────────────── */

/** 方法 A：只在凍結瞬間量化一次，之後完全不看 w_H。 */
export const CHART_FREEZE = `flowchart LR
  WH["w_H[n]<br/>LMS accumulator（高解析）"] -- "凍結瞬間取樣一次" --> LAT["latch：wFreeze = w* = 32.4<br/>之後不再更新"]
  WH -. "之後的變化被忽略" .-> LAT
  LAT --> Q["Q_B：⌊32.4 + ½⌋"]
  Q --> Y["y[n] = 32<br/>每個 n 都一樣"]
  Y -- "＋" --> S(("＋"))
  WS["w* = 32.4"] -- "−" --> S
  S -- "e[n] = y − w* = −0.4 LSB（常數）" --> DC["全部功率在 DC<br/>平方平均 0.16 LSB²，變異數 0"]${STYLE}
  class LAT focus`

/* ───────────────────────── §13.2 方法 B ───────────────────────── */

/** 方法 B：計數器 + Bresenham pattern（開迴路，沒有回授線）。F-13.3。 */
export const CHART_TOGGLE = `flowchart LR
  WH["w_H = 32.4"] --> SP["拆開：⌊w_H⌋ = 32<br/>小數 p = 0.4"]
  SP -- "p" --> H["h = round(p·L_t) = 2<br/>L_t = 5 次裡進位 2 次"]
  CNT["計數器 n′ = n mod L_t<br/>0, 1, 2, 3, 4, 0, …"] --> PAT["Bresenham pattern<br/>s = ⌊(n′+1)h/L_t⌋ − ⌊n′h/L_t⌋"]
  H --> PAT
  SP -- "＋ ⌊w_H⌋ = 32" --> ADD(("＋"))
  PAT -- "＋ s[n] = 0, 0, 1, 0, 1" --> ADD
  ADD --> Y["y[n] = 32, 32, 33, 32, 33<br/>平均 32.4"]${STYLE}
  class CNT,PAT focus`

/** 週期 5 的誤差怎麼變成兩條譜線（F-13.4、勘誤 E47）。 */
export const CHART_TOGGLE_SPECTRUM = `flowchart LR
  E["e[n] = y[n] − 32.4<br/>−0.4, −0.4, 0.6, −0.4, 0.6（週期 5）"] --> DFT["離散傅立葉係數 c_k<br/>k = 0, 1, 2, 3, 4"]
  DFT --> C0["k = 0：c₀ = 平均 = 0<br/>沒有 DC 誤差"]
  DFT --> C1["k = 1 與 4（共軛對）<br/>|c₁| = (√5 − 1)/10 = 0.1236"]
  DFT --> C2["k = 2 與 3（共軛對）<br/>|c₂| = (√5 + 1)/10 = 0.3236"]
  C1 -- "正負頻率合併：× 2" --> P1["f_u/5<br/>P₁ = 2|c₁|² = 0.03056 LSB²"]
  C2 -- "× 2" --> P2["2f_u/5（主 spur）<br/>P₂ = 2|c₂|² = 0.20944 LSB²"]
  P1 -- "＋" --> SUM(("＋"))
  P2 -- "＋" --> SUM
  SUM --> TOT["Parseval：總和 0.24 LSB²<br/>= p(1 − p)"]${STYLE}
  class P2 warn`

/** code 以 ZOH 保持到更快的取樣率：譜線複製到所有 k·f_u/5，並乘上離散 sinc² 權重（F-13.5）。 */
export const CHART_ZOH = `flowchart LR
  E["e[n]：每次 code 更新一個值<br/>取樣率 f_u，週期 5"] --> ZOH["ZOH：每個 code 保持 N_h 個 cycle<br/>z[m] = e[⌊m/N_h⌋]"]
  ZOH --> Z["z[m]：每個 reference cycle 一個值<br/>取樣率 f_s = N_h·f_u，週期 5·N_h"]
  Z --> L["譜線出現在所有 k·f_u/5<br/>k = 1, 2, 3, …（不只 k = 1, 2）"]
  ZOH -. "保持的頻率響應" .-> G["G_k = sin(πk/5) / (N_h·sin(πk/(5N_h)))<br/>離散 sinc，包絡隨 k 變小"]
  G --> P["P_k = 2·|c_(k mod 5)|²·G_k²"]
  L --> P
  G --> ZERO["k = 5, 10, …：G_k = 0<br/>ZOH 的零點，沒有譜線"]${STYLE}
  class ZOH focus`

/* ───────────────────────── §13.3 方法 C ───────────────────────── */

/** 方法 C：亂數 + 比較器決定要不要進位（F-13.6）。 */
export const CHART_STOCHASTIC = `flowchart LR
  WH["w_H = 32.4"] --> SP["拆開：⌊w_H⌋ = 32<br/>小數 p = 0.4"]
  RNG["亂數產生器（或 PRBS）<br/>rand[n] 均勻落在 0 到 1，每次獨立"] --> CMP{"rand[n] < p ?"}
  SP -- "p" --> CMP
  CMP -- "是，機率 p：X = 1" --> ADD(("＋"))
  CMP -- "否，機率 1 − p：X = 0" --> ADD
  SP -- "＋ ⌊w_H⌋ = 32" --> ADD
  ADD --> Y["y[n] = 32 + X[n]<br/>E[y] = 32.4，Var(y) = p(1 − p) = 0.24"]${STYLE}
  class RNG,CMP focus`

/* ───────────────────────── §13.4 方法 D ───────────────────────── */

/** 一階 error-feedback ΔΣ 迴圈：加法器、Q、相減、z⁻¹（訊號 v、y、r）。 */
export const CHART_EFB_LOOP = `flowchart LR
  WH["w_H[n]<br/>高解析係數"] -- "＋" --> A1(("＋"))
  A1 -- "v[n] = w_H[n] + r[n−1]" --> Q["Q_6：⌊v + ½⌋<br/>6-bit 量化器"]
  Q -- "y[n]" --> OUT["y[n]<br/>6-bit code，送到 DTC"]
  A1 -- "＋ v[n]" --> A2(("＋"))
  Q -- "− y[n]" --> A2
  A2 -- "r[n] = v[n] − y[n]" --> Z["z⁻¹<br/>r 暫存器 s.r"]
  Z -- "＋ r[n−1]" --> A1${STYLE}
  class A2,Z focus`

/** 常數 32.4（round-half-up、r[−1] = 0）的週期 5 limit cycle：r 的狀態圖。 */
export const CHART_LIMIT_CYCLE = `stateDiagram-v2
  direction LR
  state "r = 0" as R0
  state "r = 0.4" as R1
  state "r = −0.2" as R2
  state "r = 0.2" as R3
  state "r = −0.4" as R4
  [*] --> R0 : 起點 r[−1] = 0
  R0 --> R1 : v = 32.4 → y = 32
  R1 --> R2 : v = 32.8 → y = 33
  R2 --> R3 : v = 32.2 → y = 32
  R3 --> R4 : v = 32.6 → y = 33
  R4 --> R0 : v = 32.0 → y = 32`

/** 訊號路徑（增益 1）與誤差路徑（NTF = 1 − z⁻¹）：F-13.7、F-13.9。 */
export const CHART_NTF_PATHS = `flowchart LR
  WH["W_H(z)<br/>訊號：高解析係數"] -- "＋，訊號路徑增益 1" --> S(("＋"))
  R["R(z)<br/>量化誤差 r"] --> NTF["NTF(z) = 1 − z⁻¹<br/>現在的 r 減掉上一次的 r"]
  NTF -- "−" --> S
  S --> Y["Y(z) = W_H(z) − (1 − z⁻¹)·R(z)"]
  NTF -. "低頻 f ≪ f_u" .-> LO["|NTF|² ≈ (2πf/f_u)²<br/>誤差被壓得很小，每 decade +20 dB"]
  NTF -. "Nyquist f = f_u/2" .-> HI["|NTF|² = 4，也就是 +6 dB<br/>誤差被推到高頻"]${STYLE}
  class NTF focus`

/** 同一個迴圈換個畫法：r 是 (w_H − y) 的累加器，有界 ⇒ 平均追得上（F-13.12）。 */
export const CHART_TELESCOPING = `flowchart LR
  WH["w_H[n]"] -- "＋" --> D0(("＋"))
  Y["y[n]"] -- "−" --> D0
  D0 -- "w_H[n] − y[n]" --> ACC["累加器 1/(1 − z⁻¹)<br/>r[n] = r[n−1] + (w_H[n] − y[n])"]
  ACC -- "r[n]，沒有 overload 時 |r| ≤ ½" --> B["N 次加總只剩頭尾<br/>Σ(y − w_H) = r[−1] − r[N−1]"]
  B --> AVG["除以 N<br/>平均誤差的大小 ≤ 1/N"]${STYLE}
  class ACC focus`

/** limit cycle 週期怎麼算（F-13.8、勘誤 E15）。 */
export const CHART_PERIOD_FLOW = `flowchart TB
  W["常數 w_H"] --> T{"w_H 怎麼表示？"}
  T -- "精確有理數" --> R1["約分成最簡分數 m/q<br/>32.4 = 162/5"]
  R1 --> P1["週期 = q = 5"]
  T -- "定點，F 個小數 bit" --> F1["K = round(w_H·2^F)<br/>F = 10：K = 33178"]
  F1 --> F2["取小數部分：K mod 2^F = 410"]
  F2 --> F3["g = gcd(410, 1024) = 2"]
  F3 --> P2["週期 = 2^F / g = 512"]${STYLE}
  class P1,P2 focus`

/* ───────────────────────── §13.4E 方法 E ───────────────────────── */

/** 方法 E：dither 只加在量化器輸入；回授的 r 以未加 dither 的 v 為基準（F-13.10）。 */
export const CHART_DITHER_LOOP = `flowchart LR
  WH["w_H[n]"] -- "＋" --> A1(("＋"))
  A1 -- "＋ v[n] = w_H[n] + r[n−1]" --> A3(("＋"))
  DI["dither d[n]<br/>零平均亂數，峰對峰寬度 A"] -- "＋" --> A3
  A3 -- "u[n] = v[n] + d[n]" --> Q["Q_6：⌊u + ½⌋"]
  Q -- "y[n]" --> OUT["y[n]<br/>6-bit code，送到 DTC"]
  A1 -- "＋ v[n]，不含 d" --> A2(("＋"))
  Q -- "− y[n]" --> A2
  A2 -- "r[n] = v[n] − y[n]" --> Z["z⁻¹<br/>r 暫存器"]
  Z -- "＋ r[n−1]" --> A1${STYLE}
  class DI,A3 focus`

/* ───────────────────────── 五策略比較 ───────────────────────── */

/** 五種策略並排：送進共用量化器的東西不同；藍色 = 有誤差回授（閉迴路）。 */
export const CHART_FIVE_STRATEGIES = `flowchart LR
  WH["w_H[n]<br/>高解析係數"] --> SA["A Freeze<br/>v = 凍結時的 w*，不再看 w_H"]
  WH --> SB["B Toggle<br/>v = ⌊w_H⌋ + pattern(n mod L_t)"]
  WH --> SC["C Stochastic<br/>v = ⌊w_H⌋ + (rand < p)"]
  WH --> SD["D ΔΣ<br/>v = w_H + r[n−1]"]
  WH --> SE["E ΔΣ + dither<br/>量化 v + d，v = w_H + r[n−1]"]
  CNT["計數器 n"] -.-> SB
  RNG["亂數 / PRBS"] -.-> SC
  RNG -.-> SE
  SA --> Q["共用的 Q_B<br/>四捨五入 + saturate"]
  SB --> Q
  SC --> Q
  SD --> Q
  SE --> Q
  Q --> Y["y[n]<br/>6-bit code"]
  Q -. "r[n] = v − y，經 z⁻¹ 回授" .-> SD
  Q -. "r[n] = v − y，經 z⁻¹ 回授" .-> SE${STYLE}
  class SD,SE focus`

/** 同樣的功率、不同的頻率分布：「平均正確 ≠ 頻譜理想」。 */
export const CHART_POWER_SPLIT = `flowchart LR
  T["只用 32 與 33、平均 32.4<br/>總誤差功率一定是 p(1 − p) = 0.24 LSB²"] --> BD["B Toggle、D ΔΣ（常數輸入）<br/>兩條譜線：0.03056 在 f_u/5、0.20944 在 2f_u/5"]
  T --> SC["C Stochastic<br/>白色：0 到 f_u/2 一樣高，PSD = 2p(1 − p)/f_u"]
  SA["A Freeze：只用 32<br/>0.16 LSB²"] --> ADC["全部在 DC<br/>static error −0.4 LSB"]
  SE["E ΔΣ + dither（寬度 1 LSB）<br/>用到 31 到 34，總功率變大（白色近似 1/3 LSB²）"] --> EHF["沒有譜線<br/>被 1 − z⁻¹ 推到高頻，低頻很小"]${STYLE}
  class BD warn`

/** Quantized Gain Lab 算了什麼：從參數到 σ_out 的資料流。 */
export const CHART_LAB_PIPELINE = `flowchart LR
  PRM["參數：w*、位元數、rounding、seed"] --> WH["lmsTarget：產生 w_H[n]<br/>常數，或加 LMS 雜訊 / PVT 漂移"]
  WH --> ST["量化策略 A 到 E<br/>每個 Case 選一種"]
  ST --> Y["y[n]<br/>6-bit code"]
  Y --> PER["週期偵測<br/>limit-cycle period"]
  Y --> ERR["e = y − w*"]
  ERR --> SPEC["譜線表與 Welch PSD<br/>DC 誤差、總功率、頻帶內功率"]
  ERR --> MIX["ZOH 保持 N_upd 個 cycle<br/>再 × x[n] × Δ_LSB"]
  MIX --> TF["乘上 |T(f)|² 再積分"]
  TF --> SIG["σ_out（fs）"]${STYLE}
  class ST focus`

/* ───────────────────────── §13.5a 時變 w_H ───────────────────────── */

/** w_H[n] = w* + δw[n]（AR(1) 的 LMS 雜訊）；code 誤差拆成 e = ε + δw。 */
export const CHART_TIME_VARYING = `flowchart LR
  XI["白雜訊 ξ[n]<br/>獨立、零平均、變異數 1"] --> AR["AR(1)：δw[n+1] = p_cal·δw[n] + g·ξ[n]<br/>一階 low-pass，g = √(1 − p_cal²)·σ_w"]
  AR -- "＋ δw[n]，RMS = σ_w" --> S1(("＋"))
  WS["w* = 32.4"] -- "＋" --> S1
  S1 -- "w_H[n] = w* + δw[n]" --> QS["量化策略 B / C / D / E"]
  QS -- "＋ y[n]" --> S2(("＋"))
  S1 -- "− w_H[n]" --> S2
  S2 -- "＋ ε[n] = y[n] − w_H[n]，量化誤差" --> S3(("＋"))
  AR -- "＋ δw[n]，LMS 地板" --> S3
  S3 --> OUT["e[n] = y[n] − w* = ε[n] + δw[n]<br/>code 誤差"]${STYLE}
  class QS focus`

/** 頻帶內量化誤差：白色（一次方）vs 一階塑形（三次方）。F-13.13。 */
export const CHART_INBAND = `flowchart TB
  subgraph CW["C Stochastic：白色誤差"]
    direction LR
    C1["每次的變異數 p(1 − p)<br/>平均 E[p(1 − p)] ≈ p₀(1 − p₀) − σ_w²"] --> C2["PSD 是平的<br/>高度 2·E[p(1 − p)]/f_u"]
    C2 --> C3["頻帶內 = 高度 × 寬度 f_B<br/>P_in = 2·E[p(1 − p)]·(f_B/f_u)"]
  end
  subgraph DS["D ΔΣ：被 1 − z⁻¹ 塑形的誤差"]
    direction LR
    D1["r 的變異數 σ_r²<br/>白色近似取 1/12"] --> D2["PSD ≈ (2πf/f_u)²·2σ_r²/f_u<br/>低頻時隨 f² 變小"]
    D2 --> D3["積分到 f_B：f² 的積分是 f_B³/3<br/>P_in ≈ (8π²/3)·σ_r²·(f_B/f_u)³"]
  end
  C3 --> CMP["f_B/f_u = 1/64：一次方對三次方<br/>約 6×10⁻³ 對 8×10⁻⁶ LSB²"]
  D3 --> CMP${STYLE}
  class C3,D3 focus`

/* ───────────────────────── §13.5b 六個準則 ───────────────────────── */

/** code 誤差到 output jitter 的路徑：ZOH → 乘上 DSM residue → Δ_LSB → |T(f)|²（F-13.11）。 */
export const CHART_MIXING_PATH = `flowchart LR
  Y["y[k]<br/>6-bit code，每 N_upd 個 cycle 更新（f_u）"] -- "＋" --> S(("＋"))
  WS["w*"] -- "−" --> S
  S -- "e[k] = y[k] − w*" --> ZOH["ZOH：保持 N_upd 個 cycle<br/>e_s[n] = e[⌊n/N_upd⌋]"]
  ZOH -- "e_s[n]，每個 reference cycle（f_s）" --> M(("×"))
  X["x[n]<br/>DSM residue（f_s）"] --> M
  M --> K["× Δ_LSB"]
  K -- "δt[n] = Δ_LSB·e_s[n]·x[n]（fs）" --> T["|T(f)|²<br/>PLL closed-loop low-pass"]
  T --> OUT["σ_out² = ∫ |T|²·S_δt df<br/>output jitter"]${STYLE}
  class M focus`

/** 一個具體的差頻：2f_s/5 的 code tone 乘上 DSM residue 的第 51 次諧波，落在 f_s/640 = 156 kHz。 */
export const CHART_TONE_MIXING = `flowchart LR
  E["code 誤差的 tone<br/>f_e = 2f_s/5 = 40 MHz，遠在通帶外"] --> M(("×"))
  X["DSM residue 的第 51 次諧波<br/>f_x = 51·f_s/128 = 39.84 MHz"] --> M
  M -- "差頻" --> DF["|f_x − f_e| = f_s/640 = 156 kHz"]
  M -- "和頻" --> SF["f_x + f_e = 79.84 MHz<br/>取樣後摺到 20.16 MHz"]
  DF -- "低於 f_BW = 1 MHz" --> IN["通過 T(f)<br/>變成 output jitter / spur"]
  SF -- "高於 f_BW = 1 MHz" --> NO["被 T(f) 濾掉"]${STYLE}
  class DF,IN warn
  class NO ok`

/** Sign-off 前的檢查：紀錄長度有沒有涵蓋一整個混頻週期（FCW 陷阱）。 */
export const CHART_RECORD_CHECK = `flowchart TB
  PC["P_code：code 的 limit-cycle 週期<br/>本例 5 次更新"] --> L["混頻週期 P_mix = lcm(P_code·N_upd, P_DSM)<br/>單位：reference cycle"]
  PD["P_DSM：DSM residue 的週期<br/>2^20 / gcd(K, 2^20) 個 cycle"] --> L
  L --> C{"紀錄長度 ≥ P_mix？"}
  C -- "是。frac = 13/128：P_mix = 640" --> OKN["混頻產物都在 f_s/640 的倍數上，高於 f_L<br/>σ_out 可信"]
  C -- "否。frac = 0.1：P_mix = 2621440" --> BAD["最大的產物比紀錄還慢<br/>看起來像靜態偏移，σ_out 被低估"]
  BAD --> FIX["模擬一整個混頻週期<br/>看區塊平均的慢階梯 σ_slow"]${STYLE}
  class OKN ok
  class BAD warn`

/** 沿著 §13.5 六個準則的選擇流程（教學用的思考順序，不是 sign-off 規則）。 */
export const CHART_DECISION = `flowchart TB
  ST["要把 w_H 放進 6-bit code"] --> Q1{"準則 1、4<br/>能接受最多 ½ LSB 的 static error<br/>而且不必追 PVT 漂移？"}
  Q1 -- "能" --> SA["A Freeze<br/>沒有 code tone、不切換"]
  Q1 -- "不能" --> Q2{"w_H 會一直變嗎？<br/>背景 LMS 持續更新"}
  Q2 -- "會，LMS 雜訊本身就像 dither" --> SD["D ΔΣ<br/>平均追上 w_H，頻帶內量化誤差很小"]
  Q2 -- "不會，常數或已凍結" --> Q3{"準則 2、6<br/>limit cycle 的 tone 乘上 DSM residue<br/>差頻會落進 T(f) 通帶？"}
  Q3 -- "不會" --> SBD["B Toggle 或 D ΔΣ<br/>常數時是同一個循環"]
  Q3 -- "會，或不確定" --> Q4{"準則 3<br/>能接受 code 擺到 31 到 34<br/>與較大的總功率？"}
  Q4 -- "能" --> SE["E ΔΣ + dither<br/>打散 tone，低頻仍被塑形"]
  Q4 -- "不能" --> SC["C Stochastic<br/>只用兩階、白色，頻帶內地板較高"]
  SA --> V["準則 5：用實際的 FCW、N_upd、T(f) 模擬確認<br/>紀錄要長於混頻週期"]
  SD --> V
  SBD --> V
  SE --> V
  SC --> V${STYLE}
  class V focus`

/* ───────────────────────── §13.6 非理想 ───────────────────────── */

/** 超出 6-bit 範圍時：saturate（夾住，但 r 會 windup）對 wrap（進位被丟掉，code 掉到 0）。 */
export const CHART_SAT_WRAP = `flowchart LR
  V["v[n] = 63.4 + r[n−1]<br/>有些拍四捨五入得到 64，超出 0 到 63"] --> OV{"overflow 怎麼處理？"}
  OV -- "saturate" --> SAT["y = 63<br/>夾在最大 code"]
  OV -- "wrap：丟掉進位" --> WR["y = 64 mod 64 = 0<br/>gain 瞬間崩到 0"]
  SAT --> RS["r[n] = v − 63，每次多 0.4<br/>一直累積：windup"]
  RS --> AW["對策：anti-windup<br/>把 r 夾回 −½ 到 ½"]
  WR --> RW["40% 的更新輸出 0<br/>平均 code ≈ 0.6 × 63 = 37.8"]${STYLE}
  class WR,RW warn
  class SAT,AW ok`

/** anti-windup 夾在哪裡：r 存回暫存器之前（對應程式碼的 residual()）。 */
export const CHART_ANTIWINDUP = `flowchart LR
  WH["w_H[n]<br/>例：63.3，超出範圍"] -- "＋" --> A1(("＋"))
  A1 -- "v[n]" --> Q["Q_6 + saturate<br/>y 最大只能 63"]
  Q -- "y[n]" --> OUT["y[n] = 63"]
  A1 -- "＋ v[n]" --> A2(("＋"))
  Q -- "− y[n]" --> A2
  A2 -- "r = v − y，overload 時每次多 0.3" --> CL["anti-windup clamp<br/>r 夾在 −½ 到 ½"]
  CL --> Z["z⁻¹<br/>r 暫存器"]
  Z -- "＋ r[n−1]" --> A1${STYLE}
  class CL focus`

/** 跨 clock domain：31 → 32 時 6 個 bit 同時翻轉；gray 碼只翻 1 個 bit。 */
export const CHART_CDC = `flowchart LR
  A["code domain（f_u）<br/>y：31 → 32"] -- "二進位 011111 → 100000<br/>6 個 bit 同時翻" --> S{"DTC domain 剛好在<br/>轉換瞬間取樣？"}
  S -- "是" --> BAD["可能讀到 0 到 63 的任何值<br/>gain 瞬間錯很多"]
  S -- "否" --> GOOD["讀到正確的 32"]
  A -- "改用 gray 碼 010000 → 110000<br/>只翻 1 個 bit" --> SAFE["最壞只差 1 LSB<br/>或用 handshake 同步"]${STYLE}
  class BAD warn
  class SAFE ok`

/* ───────────────────────── 章末 ───────────────────────── */

/** 綜合手算 HC-13.8 的計算順序（預設數字）。 */
export const CHART_SYNTHESIS_FLOW = `flowchart TB
  IN["已知：w* = 32.4、Δ_LSB = 0.125 fs/LSB、x_rms = 1<br/>σ_w = 0.2 LSB、f_u/f_B = 64"] --> A1["A Freeze：y = ⌊32.4 + ½⌋ = 32<br/>δw = −0.4 LSB"]
  A1 --> A2["Δ_LSB·|δw|·x_rms = 0.05 fs<br/>全在 DC，所以也全在頻帶內"]
  IN --> S1["兩階切換 B / C / D：p₀ = 0.4<br/>e_rms = √(0.4 × 0.6) = 0.490 LSB"]
  S1 --> S2["總 RMS：0.125 × 0.490 = 0.0612 fs<br/>比 Freeze 大"]
  S1 --> C1["C：E[p(1 − p)] ≈ 0.24 − 0.2² = 0.20<br/>P_in = 2 × 0.20 / 64 = 6.25×10⁻³ LSB²"]
  C1 --> C2["頻帶內：0.125 × √P_in = 0.00988 fs"]
  S1 --> D1["D：P_in ≈ 2.193 × (1/64)³<br/>= 8.37×10⁻⁶ LSB²"]
  D1 --> D2["頻帶內：0.125 × √P_in = 3.62×10⁻⁴ fs"]${STYLE}
  class A2,S2 focus
  class C2,D2 ok`

/** （原有）校正邏輯到 DTC 與 PLL 輸出的硬體路徑。 */
export const CHART_HARDWARE_MAP = `flowchart LR
  subgraph CAL["校正邏輯（f_u domain）"]
    LMS["LMS accumulator w_H<br/>（B+F bit）"] --> QS["量化策略<br/>Q_B / toggle / PRBS / ΔΣ / dither"]
  end
  QS -- "6-bit code（CDC：同步 / gray）" --> REG["DTC gain register<br/>（f_s domain，ZOH N_upd）"]
  REG --> DTC["DTC delay = Δ_LSB·y·x[n]"]
  DSM["DSM residue x[n]"] --> DTC
  DTC --> LOOP["PLL：PD → LF → VCO"]
  LOOP -- "T(f)：low-pass" --> OUT["Output phase noise / spur"]${STYLE}
  class QS focus`

export type DiagramKind = 'flowchart' | 'state'

export interface DiagramDef {
  /** 匯出的常數名稱（也用來在測試訊息裡指出是哪一張） */
  name: string
  chart: string
  kind: DiagramKind
  /** 所在的原始檔（相對於 src/chapters/ch13/） */
  file: string
  /** 是否為這次新增（false = 原本就有、只是搬到這個檔案） */
  added: boolean
}

/** 全章的 Mermaid 圖（依頁面上的出現順序）；章首另有一張全站共用的 <SystemMap>。 */
export const DIAGRAMS: DiagramDef[] = [
  { name: 'CHART_SIGNAL_FLOW', chart: CHART_SIGNAL_FLOW, kind: 'flowchart', file: 'sections/Intro.tsx', added: false },
  { name: 'CHART_ERROR_PATH', chart: CHART_ERROR_PATH, kind: 'flowchart', file: 'sections/Intro.tsx', added: true },
  { name: 'CHART_FREEZE', chart: CHART_FREEZE, kind: 'flowchart', file: 'sections/Freeze.tsx', added: true },
  { name: 'CHART_TOGGLE', chart: CHART_TOGGLE, kind: 'flowchart', file: 'sections/Toggle.tsx', added: true },
  { name: 'CHART_TOGGLE_SPECTRUM', chart: CHART_TOGGLE_SPECTRUM, kind: 'flowchart', file: 'sections/Toggle.tsx', added: true },
  { name: 'CHART_ZOH', chart: CHART_ZOH, kind: 'flowchart', file: 'sections/Toggle.tsx', added: true },
  { name: 'CHART_STOCHASTIC', chart: CHART_STOCHASTIC, kind: 'flowchart', file: 'sections/Stochastic.tsx', added: true },
  { name: 'CHART_EFB_LOOP', chart: CHART_EFB_LOOP, kind: 'flowchart', file: 'sections/DeltaSigma.tsx', added: true },
  { name: 'CHART_LIMIT_CYCLE', chart: CHART_LIMIT_CYCLE, kind: 'state', file: 'sections/DeltaSigma.tsx', added: true },
  { name: 'CHART_NTF_PATHS', chart: CHART_NTF_PATHS, kind: 'flowchart', file: 'sections/DeltaSigma.tsx', added: true },
  { name: 'CHART_TELESCOPING', chart: CHART_TELESCOPING, kind: 'flowchart', file: 'sections/DeltaSigma.tsx', added: true },
  { name: 'CHART_PERIOD_FLOW', chart: CHART_PERIOD_FLOW, kind: 'flowchart', file: 'sections/DeltaSigma.tsx', added: true },
  { name: 'CHART_DITHER_LOOP', chart: CHART_DITHER_LOOP, kind: 'flowchart', file: 'sections/Dither.tsx', added: true },
  { name: 'CHART_FIVE_STRATEGIES', chart: CHART_FIVE_STRATEGIES, kind: 'flowchart', file: 'sections/CodeComparison.tsx', added: true },
  { name: 'CHART_POWER_SPLIT', chart: CHART_POWER_SPLIT, kind: 'flowchart', file: 'sections/CodeComparison.tsx', added: true },
  { name: 'CHART_LAB_PIPELINE', chart: CHART_LAB_PIPELINE, kind: 'flowchart', file: 'index.tsx', added: true },
  { name: 'CHART_TIME_VARYING', chart: CHART_TIME_VARYING, kind: 'flowchart', file: 'sections/TimeVarying.tsx', added: true },
  { name: 'CHART_INBAND', chart: CHART_INBAND, kind: 'flowchart', file: 'sections/TimeVarying.tsx', added: true },
  { name: 'CHART_MIXING_PATH', chart: CHART_MIXING_PATH, kind: 'flowchart', file: 'sections/Criteria.tsx', added: true },
  { name: 'CHART_TONE_MIXING', chart: CHART_TONE_MIXING, kind: 'flowchart', file: 'sections/Criteria.tsx', added: true },
  { name: 'CHART_RECORD_CHECK', chart: CHART_RECORD_CHECK, kind: 'flowchart', file: 'sections/Criteria.tsx', added: true },
  { name: 'CHART_DECISION', chart: CHART_DECISION, kind: 'flowchart', file: 'sections/Criteria.tsx', added: true },
  { name: 'CHART_SAT_WRAP', chart: CHART_SAT_WRAP, kind: 'flowchart', file: 'sections/NonIdeal.tsx', added: true },
  { name: 'CHART_ANTIWINDUP', chart: CHART_ANTIWINDUP, kind: 'flowchart', file: 'sections/NonIdeal.tsx', added: true },
  { name: 'CHART_CDC', chart: CHART_CDC, kind: 'flowchart', file: 'sections/NonIdeal.tsx', added: true },
  { name: 'CHART_SYNTHESIS_FLOW', chart: CHART_SYNTHESIS_FLOW, kind: 'flowchart', file: 'sections/WrapUp.tsx', added: true },
  { name: 'CHART_HARDWARE_MAP', chart: CHART_HARDWARE_MAP, kind: 'flowchart', file: 'sections/WrapUp.tsx', added: false },
]

/** 章首系統地圖要標成藍色的方塊：gain accumulator → 有限位元量化 → gain correction（code × w）。 */
export const SYSTEM_MAP_FOCUS: SystemBlock[] = ['acc', 'qnt', 'gc']
