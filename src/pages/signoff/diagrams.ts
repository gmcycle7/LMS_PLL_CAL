/**
 * Sign-off 頁的方塊圖（Mermaid 原始碼；docs/teaching-style.md §8）。
 *
 * 規則：
 * - 節點文字用 Unicode 數學符號（Mermaid 不渲染 KaTeX）；含括號、冒號、等號等特殊字元的文字一律用雙引號包住；
 *   標籤內不用 ASCII 的「<」（只允許 <br/>）與分號，大於／小於寫全形「＞」「＜」。
 * - 加法點用圓形節點「＋」，每條進來的邊標正負號：正號寫全形「＋」、負號寫「−」（U+2212）。
 *   Mermaid 11 把標籤當 Markdown：單獨的 ASCII「+」「-」會被當成清單，畫面上變成「Unsupported markdown: list」。
 * - 每張圖的訊號名稱、正負號、箭頭方向與取樣率（sample n／block k）都和頁面上的公式一致（δ = a − w；Ĝ 是 block 平均）；
 *   diagrams.test.ts 以真正的 mermaid 解析並畫出每一張，逐條核對。
 * - 顏色（深淺主題都看得清楚）：藍 = 這一段的主角；綠 = 通過／可 sign-off；紅 = 失敗／不可 sign-off；棕 = 對照用、容易被忽略的另一條路。
 */

const FOCUS = 'classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff,stroke-width:2px'
const ALT = 'classDef alt fill:#8a4b08,stroke:#5c3205,color:#ffffff,stroke-width:2px'
const PASS = 'classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff,stroke-width:2px'
const WARN = 'classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff,stroke-width:2px'

/**
 * §0：sign-off 的六道關卡（順序與頁面「六個條件」表一致：Identifiability → Polarity → Stability → Variance → Bias → System-level）。
 * 前面的量先算出來，後面的判準才有東西可用：有了 K（極性）才能算 g；迴路收斂了才有穩態的 σ_w 與固定點 w*；最後才換算到輸出。
 */
export const CHART_SIGNOFF_FLOW = `flowchart TB
  START(["量測前提：0/1 → ±1 映射、code delay D 對齊、<br/>GMAC sum／average 與 μ 的 scaling 一致（Matrix 第 1 個 case）"])
  Q1{"① Identifiability<br/>λ_min(R) ＞ 0、σ_min(Ĵ) ＞ z·‖se‖_F"}
  Q2{"② Polarity<br/>K̂ − z·se ＞ 0、diag(Ĵ) ＜ 0"}
  Q3{"③ Stability<br/>g ＜ g_crit(d)、ρ(I + M·J) ＜ 1"}
  Q4{"④ Variance<br/>σ_w ≤ σ_w,max"}
  Q5{"⑤ Bias<br/>|w* − a| ≤ ε_bias"}
  Q6{"⑥ System-level<br/>輸出 σ_δt 與 spur（經 T）在預算內"}
  OK(["六項都過，並寫明「穩定」的種類與證據範圍<br/>才可 sign-off"])
  BAD["不可 sign-off<br/>在 Matrix 記下失敗項目與理由，修正後重做"]
  START --> Q1
  Q1 -- "是" --> Q2
  Q2 -- "是" --> Q3
  Q3 -- "是" --> Q4
  Q4 -- "是" --> Q5
  Q5 -- "是" --> Q6
  Q6 -- "是" --> OK
  Q1 -- "否" --> BAD
  Q2 -- "否" --> BAD
  Q3 -- "否" --> BAD
  Q4 -- "否" --> BAD
  Q5 -- "否" --> BAD
  Q6 -- "否" --> BAD
  ${FOCUS}
  ${PASS}
  ${WARN}
  class Q2 focus
  class OK ok
  class BAD warn`

/**
 * §2：freeze ±Δ 量測極性（F-SO.1、F-SO.3）。
 * Ŝ = (Ḡ₊ − Ḡ₋)/(2Δ)、K̂ = −Ŝ、se(Ŝ) = σ_η/(Δ√(2M))；三分法判決就是 judges.ts 的 polarityVerdict。
 * Ḡ± 是 block 速率（索引 k）的 GMAC 平均，各 M 個 block。
 */
export const CHART_FREEZE_MEASURE = `flowchart LR
  FZ(["freeze：w 不自己更新<br/>在 w₀ 附近推兩個工作點"])
  UP["w = w₀ + Δ<br/>丟掉 settling 的 block<br/>量 M 個 block，平均得 Ḡ₊"]
  DN["w = w₀ − Δ<br/>丟掉 settling 的 block<br/>量 M 個 block，平均得 Ḡ₋"]
  D(("＋"))
  DIV["÷ 2Δ<br/>Ŝ = (Ḡ₊ − Ḡ₋)/(2Δ)"]
  NEG["× (−1)<br/>K̂ = −Ŝ"]
  SE(["標準誤<br/>se(Ŝ) = σ_η/(Δ√(2M))<br/>σ_η ≈ 1/√N"])
  V{"三分法判決<br/>（單邊倍數 z）"}
  PASS(["K̂ − z·se ＞ 0<br/>pass：極性正確"])
  REV(["K̂ + z·se ＜ 0<br/>reversed：極性錯誤"])
  INC(["其他<br/>inconclusive：加大 M、Δ，或換 FCW"])
  FZ --> UP
  FZ --> DN
  UP -- "＋（Ḡ₊）" --> D
  DN -- "−（Ḡ₋）" --> D
  D --> DIV
  DIV -- "Ŝ" --> NEG
  NEG -- "K̂" --> V
  SE -.-> V
  V --> PASS
  V --> REV
  V --> INC
  ${FOCUS}
  ${PASS}
  ${WARN}
  ${ALT}
  class DIV,NEG focus
  class PASS ok
  class REV warn
  class INC alt`

/**
 * §3.5：從「掃了 n 個點、全部沒失效」到可以寫進報告的一句話（F-SO.8）。
 * k_f = 0：p_U = 1 − α^(1/n) ≈ −ln α / n；k_f ＞ 0：Clopper–Pearson。上界只對與試驗同分布的條件成立。
 */
export const CHART_EVIDENCE = `flowchart LR
  SW(["指定的 sweep<br/>FCW、corner、mode…<br/>共 n 次獨立試驗（獨立 seed）"])
  RUN["跑完整模擬<br/>用事先定好的失效判準"]
  CNT["數失效次數 k_f"]
  P0["k_f = 0：rule of three<br/>p_U = 1 − α^(1/n) ≈ −ln α / n"]
  CP["k_f ＞ 0：Clopper–Pearson<br/>p_U = 滿足 P(X ≤ k_f | n, p) ≥ α 的最大 p"]
  CLAIM(["可以寫：與 sweep 同分布的條件下，<br/>失效機率 ≤ p_U（信心 1 − α）"])
  NOT["不能寫：「所有條件都穩定」<br/>特定的 near-integer FCW 要另外列入 sweep"]
  SW --> RUN
  RUN --> CNT
  CNT -- "k_f = 0" --> P0
  CNT -- "k_f ＞ 0" --> CP
  P0 --> CLAIM
  CP --> CLAIM
  CLAIM -.-> NOT
  ${FOCUS}
  ${PASS}
  ${WARN}
  class P0,CP focus
  class CLAIM ok
  class NOT warn`

/**
 * §4：同一組 (μ, d) 要通過所有 corner（cornerJudge 的五項判準）。
 * K_c = K_q(σ_v,c)·cos θ_c、g_c = μ·K_c；z^(d+1) − z^d + g_c = 0 的根在單位圓內才有穩態，k₉₅ 與 σ_w 才有意義。
 */
export const CHART_CORNER_JUDGE = `flowchart LR
  MU(["同一組 (μ, d, N)<br/>硬體只有一個 μ"])
  CS(["corner 清單<br/>(σ_v,c, θ_c)：PVT、PLL BW、mode"])
  G["對每個 corner c：<br/>K_c = K_q(σ_v,c)·cos θ_c<br/>g_c = μ·K_c"]
  P["① 極性<br/>K_c ＞ 0"]
  ST["② 穩定<br/>z^(d+1) − z^d + g_c = 0 的根 |z| ＜ 1<br/>（g_c ＜ g_crit(d)）"]
  PM["③ 相位裕度<br/>PM_d(g_c) ≥ PM_t"]
  SET["④ 收斂<br/>k₉₅ ≤ B"]
  NS["⑤ 雜訊<br/>σ_w,c = μ·σ_η·√(Σ h²) ≤ σ_w,max"]
  ALL(["所有 corner × 五項判準都過<br/>這個 μ 才可行"])
  MU --> G
  CS --> G
  G --> P
  G --> ST
  G --> PM
  ST -- "ρ ＜ 1 才有穩態" --> SET
  ST -- "ρ ＜ 1 才有穩態" --> NS
  P --> ALL
  ST --> ALL
  PM --> ALL
  SET --> ALL
  NS --> ALL
  ${FOCUS}
  ${PASS}
  class ST focus
  class ALL ok`

/**
 * §7：多參數的線性化迴路（F-SO.7）。δw = w − w*；E[G_k] ≈ J·δw_k；w_(k+1) = w_k + M·G_k
 * ⇒ δw_(k+1) = δw_k + M·J·δw_k = (I + M·J)·δw_k。只看對角元素會漏掉交叉項。
 */
export const CHART_MIMO_LOOP = `flowchart LR
  X(["δw_k = w_k − w*<br/>向量：每個參數一個分量"])
  J["× J<br/>E[G_k] ≈ J·δw_k"]
  MM["× M<br/>更新矩陣：w_(k+1) = w_k + M·G_k"]
  S(("＋"))
  DLY["z⁻¹<br/>下一個 block"]
  DIAG["只看對角：1 + M_ii·J_ii<br/>（其他參數凍結時的 pole）"]
  RHO["一起更新：ρ(I + M·J) ＜ 1<br/>交叉項可以把 eigenvalue 推出單位圓"]
  X -- "＋" --> S
  X --> J
  J -- "E[G_k]" --> MM
  MM -- "＋（M·J·δw_k）" --> S
  S -- "δw_(k+1) = (I + M·J)·δw_k" --> DLY
  DLY --> X
  J -. "只取對角元素 J_ii" .-> DIAG
  S -. "整個矩陣的 eigenvalue" .-> RHO
  ${FOCUS}
  ${WARN}
  class J,MM,RHO focus
  class DIAG warn`

/**
 * §8：從 gain code 的偏差到輸出 spur／jitter（§8 的逐步推導）。
 * δt[n] = x[n]·δw[n]（block 速率 k 的 δw_k 以 ZOH 展開到 sample 速率 n，含 commit latency n_c）；
 * 輸出路徑用 T = L/(1+L)（不是 H_PD）；φ_out = −2π f_out·T·δt；tone 時 β = 2π f_out·A_t·|T(f_m)|，spur ≈ 20 log₁₀(β/2)。
 */
export const CHART_OUTPUT_PATH = `flowchart LR
  W(["δw_k：係數偏差<br/>（block 速率，索引 k）"])
  ZOH["ZOH 展開到 sample 速率<br/>δw[n] = δw_⌊(n − n_c)/N⌋<br/>n_c = commit latency"]
  X(["code x[n]"])
  MUL(("×"))
  T["輸出 transfer<br/>T = L/(1+L)（不是 H_PD）"]
  PH["× (−2π f_out)<br/>φ_out = −2π f_out·T·δt"]
  BETA["單一 tone δt = A_t·cos(2π f_m t)：<br/>β = 2π f_out·A_t·|T(f_m)|"]
  SPUR["spur ≈ 20 log₁₀(J₁(β)/J₀(β))<br/>≈ 20 log₁₀(β/2)"]
  JIT["隨機分量 → 輸出 PN／jitter<br/>（δt 的 PSD 經 |T|² 與 (2π f_out)²）"]
  W --> ZOH
  ZOH -- "δw[n]" --> MUL
  X --> MUL
  MUL -- "δt[n] = x[n]·δw[n]" --> T
  T -- "T·δt" --> PH
  PH -- "φ_out" --> BETA
  BETA --> SPUR
  PH -- "φ_out" --> JIT
  ${FOCUS}
  ${ALT}
  class T focus
  class SPUR,JIT alt`

/**
 * §9：反面測試的兩道防線。上排：故意注入錯誤，確認模擬／RTL／UI 都出現預期的數學特徵與解釋型警告。
 * 下排：公式與獨立的時域 Monte Carlo 交叉比對（σ_w = μσ_η/√(1−p²) 對 MC；漏掉平方的 √(1−p) 版本要被抓出來）。
 */
export const CHART_NEGATIVE_CHECKS = `flowchart LR
  INJ(["注入錯誤<br/>極性反轉、N 改變忘記 scaling、overflow…"])
  SIM["模擬／RTL／UI 照常執行"]
  SIG["數學特徵（本頁即時計算）<br/>pole、g 乘上 N、wrap 後的值…"]
  WARN(["應該出現解釋型警告<br/>而不是一條漂亮的收斂曲線"])
  FORM["路徑 A：解析公式<br/>σ_w = μσ_η/√(1 − p²)"]
  TD["路徑 B：獨立的時域 Monte Carlo<br/>多個 seeds，Student-t 95% CI"]
  CMP{"差距在容許誤差內？<br/>（容許誤差 = CI 半寬）"}
  OK(["✓ 交叉比對通過"])
  BAD(["✗ 公式或模擬有錯<br/>例：分母寫成 √(1 − p) 會落在這裡"])
  INJ --> SIM
  SIM --> SIG
  SIG --> WARN
  FORM --> CMP
  TD --> CMP
  CMP -- "是" --> OK
  CMP -- "否" --> BAD
  ${FOCUS}
  ${PASS}
  ${WARN}
  class SIG focus
  class OK ok
  class BAD warn`

/** 頁面上的圖（依出現順序）；diagrams.test.ts 逐一解析並畫出，index.test.tsx 核對頁面真的畫了這幾張。 */
export const SIGNOFF_CHARTS: { name: string; section: string; chart: string }[] = [
  { name: 'CHART_SIGNOFF_FLOW', section: '§0', chart: CHART_SIGNOFF_FLOW },
  { name: 'CHART_FREEZE_MEASURE', section: '§2', chart: CHART_FREEZE_MEASURE },
  { name: 'CHART_EVIDENCE', section: '§3.5', chart: CHART_EVIDENCE },
  { name: 'CHART_CORNER_JUDGE', section: '§4', chart: CHART_CORNER_JUDGE },
  { name: 'CHART_MIMO_LOOP', section: '§7', chart: CHART_MIMO_LOOP },
  { name: 'CHART_OUTPUT_PATH', section: '§8', chart: CHART_OUTPUT_PATH },
  { name: 'CHART_NEGATIVE_CHECKS', section: '§9', chart: CHART_NEGATIVE_CHECKS },
]
