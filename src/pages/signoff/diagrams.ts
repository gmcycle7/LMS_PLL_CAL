/**
 * Sign-off 頁的方塊圖（Mermaid 原始碼；docs/teaching-style.md §8）。
 *
 * 規則：
 * - 圖內的數學一律寫 LaTeX（使用者要求，2026-10-11）：節點與連線的「雙引號標籤」裡把數學放在 `$...$`，文字照常寫，
 *   由共用的 <Mermaid> 用 KaTeX 排版。所以每張圖的原始碼都用 `String.raw`（TeX 的反斜線只寫一次）；
 *   標籤內不寫 `\\`（Mermaid 會收成一個反斜線），換行用 <br/>；含括號、冒號、等號等特殊字元的標籤一律用雙引號包住。
 *   標籤內不用 ASCII 的「<」（只允許 <br/>）與分號：大於／小於在 `$...$` 內寫 `\gt`、`\lt`，不用 `\;`（thin space 寫 `\,`）。
 *   矩陣與向量寫粗體（`\mathbf J`、`\delta\mathbf w`），與頁面公式一致；單位與名稱（FCW、GMAC、corner、sweep…）照舊寫成文字。
 * - 加法點用圓形節點「＋」，每條進來的邊標正負號：正號寫全形「＋」、負號寫「−」（U+2212）；
 *   正負號後面還有說明文字時，負號寫成 `$-$`（KaTeX 的文字模式不認得 U+2212，會在主控台警告）。
 *   Mermaid 11 把標籤當 Markdown：單獨的 ASCII「+」「-」會被當成清單，畫面上變成「Unsupported markdown: list」。
 * - 每張圖的訊號名稱、正負號、箭頭方向與取樣率（sample $n$／block $k$）都和頁面上的公式一致（$\delta = a - w$；$\bar G$ 是 block 平均）；
 *   diagrams.test.ts 以真正的 mermaid 解析並畫出每一張，逐條核對。
 * - 版面（teaching-style §8「版面寬度」）：桌機正文欄約 900 px，圖的自然寬度要在約 1260 px 以內，所以全部用 flowchart TB（橫向 LR 的長鏈會寬到 1500–2000 px）；
 *   節點與連線都留在節點層級（不用 subgraph 折行），順序、標籤與極性不變。
 * - 顏色（深淺主題都看得清楚）：藍 = 這一段的主角；綠 = 通過／可 sign-off；紅 = 失敗／不可 sign-off；棕 = 對照用、容易被忽略的另一條路。
 */

const FOCUS = 'classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff,stroke-width:2px'
const ALT = 'classDef alt fill:#8a4b08,stroke:#5c3205,color:#ffffff,stroke-width:2px'
const PASS = 'classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff,stroke-width:2px'
const WARN = 'classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff,stroke-width:2px'

/**
 * 圈圈數字 ①–⑥：KaTeX 的文字模式沒有 U+2460…（含公式的標籤整個交給 KaTeX，會警告而且量不到寬度），
 * 所以標籤裡的圈圈數字改用 `\textcircled`（文字放進 \text{} 才合法）。
 */
export const CIRC: readonly string[] = [1, 2, 3, 4, 5, 6].map((n) => String.raw`$\text{\textcircled{${n}}}$`)

/**
 * §0：sign-off 的六道關卡（順序與頁面「六個條件」表一致：Identifiability → Polarity → Stability → Variance → Bias → System-level）。
 * 前面的量先算出來，後面的判準才有東西可用：有了 $K$（極性）才能算 $g$；迴路收斂了才有穩態的 $\sigma_w$ 與固定點 $w^*$；最後才換算到輸出。
 */
export const CHART_SIGNOFF_FLOW = String.raw`flowchart TB
  START(["量測前提：$0/1 \to \pm 1$ 映射、<br/>code delay $D$ 對齊、<br/>GMAC sum／average 與 $\mu$ 的 scaling 一致<br/>（Matrix 第 1 個 case）"])
  Q1{"${CIRC[0]} Identifiability<br/>$\lambda_{\min}(\mathbf R) \gt 0$、<br/>$\sigma_{\min}(\hat{\mathbf J}) \gt z\cdot\lVert\mathrm{se}\rVert_F$"}
  Q2{"${CIRC[1]} Polarity<br/>$\hat K - z\cdot\mathrm{se} \gt 0$、<br/>$\mathrm{diag}(\hat{\mathbf J}) \lt 0$"}
  Q3{"${CIRC[2]} Stability<br/>$g \lt g_{\mathrm{crit}}(d)$、<br/>$\rho(\mathbf I + \mathbf M\mathbf J) \lt 1$"}
  Q4{"${CIRC[3]} Variance<br/>$\sigma_w \le \sigma_{w,\max}$"}
  Q5{"${CIRC[4]} Bias<br/>$\lvert w^* - a\rvert \le \varepsilon_{\mathrm{bias}}$"}
  Q6{"${CIRC[5]} System-level<br/>輸出 $\sigma_{\delta t}$ 與 spur<br/>（經 $T$）在預算內"}
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
 * §2：freeze $\pm\Delta$ 量測極性（F-SO.1、F-SO.3）。
 * $\hat S = (\bar G_+ - \bar G_-)/(2\Delta)$、$\hat K = -\hat S$、$\mathrm{se}(\hat S) = \sigma_\eta/(\Delta\sqrt{2M})$；三分法判決就是 judges.ts 的 polarityVerdict。
 * $\bar G_\pm$ 是 block 速率（索引 $k$）的 GMAC 平均，各 $M$ 個 block。
 */
export const CHART_FREEZE_MEASURE = String.raw`flowchart TB
  FZ(["freeze：$w$ 不自己更新<br/>在 $w_0$ 附近推兩個工作點"])
  UP["$w = w_0 + \Delta$<br/>丟掉 settling 的 block<br/>量 $M$ 個 block，平均得 $\bar G_+$"]
  DN["$w = w_0 - \Delta$<br/>丟掉 settling 的 block<br/>量 $M$ 個 block，平均得 $\bar G_-$"]
  D(("＋"))
  DIV["$\div 2\Delta$<br/>$\hat S = (\bar G_+ - \bar G_-)/(2\Delta)$"]
  NEG["$\times (-1)$<br/>$\hat K = -\hat S$"]
  SE(["標準誤<br/>$\mathrm{se}(\hat S) = \sigma_\eta/(\Delta\sqrt{2M})$<br/>$\sigma_\eta \approx 1/\sqrt{N}$"])
  V{"三分法判決<br/>（單邊倍數 $z$）"}
  PASS(["$\hat K - z\cdot\mathrm{se} \gt 0$<br/>pass：極性正確"])
  REV(["$\hat K + z\cdot\mathrm{se} \lt 0$<br/>reversed：極性錯誤"])
  INC(["其他<br/>inconclusive：加大 $M$、$\Delta$，或換 FCW"])
  FZ --> UP
  FZ --> DN
  UP -- "＋（$\bar G_+$）" --> D
  DN -- "$-$（$\bar G_-$）" --> D
  D --> DIV
  DIV -- "$\hat S$" --> NEG
  NEG -- "$\hat K$" --> V
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
 * §3.5：從「掃了 $n$ 個點、全部沒失效」到可以寫進報告的一句話（F-SO.8）。
 * $k_f = 0$：$p_U = 1 - \alpha^{1/n} \approx -\ln\alpha / n$；$k_f \gt 0$：Clopper–Pearson。上界只對與試驗同分布的條件成立。
 */
export const CHART_EVIDENCE = String.raw`flowchart TB
  SW(["指定的 sweep<br/>FCW、corner、mode…<br/>共 $n$ 次獨立試驗（獨立 seed）"])
  RUN["跑完整模擬<br/>用事先定好的失效判準"]
  CNT["數失效次數 $k_f$"]
  P0["$k_f = 0$：rule of three<br/>$p_U = 1 - \alpha^{1/n} \approx -\ln\alpha / n$"]
  CP["$k_f \gt 0$：Clopper–Pearson<br/>$p_U =$ 滿足 $P(X \le k_f \mid n, p) \ge \alpha$<br/>的最大 $p$"]
  CLAIM(["可以寫：與 sweep 同分布的條件下，<br/>失效機率 $\le p_U$（信心 $1 - \alpha$）"])
  NOT["不能寫：「所有條件都穩定」<br/>特定的 near-integer FCW 要另外列入 sweep"]
  SW --> RUN
  RUN --> CNT
  CNT -- "$k_f = 0$" --> P0
  CNT -- "$k_f \gt 0$" --> CP
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
 * §4：同一組 $(\mu, d)$ 要通過所有 corner（cornerJudge 的五項判準）。
 * $K_c = K_q(\sigma_{v,c})\cos\theta_c$、$g_c = \mu K_c$；$z^{d+1} - z^d + g_c = 0$ 的根在單位圓內才有穩態，$k_{95}$ 與 $\sigma_w$ 才有意義。
 */
export const CHART_CORNER_JUDGE = String.raw`flowchart TB
  MU(["同一組 $(\mu, d, N)$<br/>硬體只有一個 $\mu$"])
  CS(["corner 清單<br/>$(\sigma_{v,c}, \theta_c)$：PVT、PLL BW、mode"])
  G["對每個 corner $c$：<br/>$K_c = K_q(\sigma_{v,c})\cdot\cos\theta_c$<br/>$g_c = \mu\cdot K_c$"]
  P["${CIRC[0]} 極性<br/>$K_c \gt 0$"]
  PM["${CIRC[2]} 相位裕度<br/>$\mathrm{PM}_d(g_c) \ge \mathrm{PM}_t$"]
  ST["${CIRC[1]} 穩定<br/>$z^{d+1} - z^d + g_c = 0$ 的根 $\lvert z\rvert \lt 1$<br/>（$g_c \lt g_{\mathrm{crit}}(d)$）"]
  SET["${CIRC[3]} 收斂<br/>$k_{95} \le B$"]
  NS["${CIRC[4]} 雜訊<br/>$\sigma_{w,c} = \mu\cdot\sigma_\eta\cdot\sqrt{\sum h^2} \le \sigma_{w,\max}$"]
  ALL(["所有 corner $\times$ 五項判準都過<br/>這個 $\mu$ 才可行"])
  MU --> G
  CS --> G
  G --> P
  G --> PM
  G --> ST
  ST -- "$\rho \lt 1$ 才有穩態" --> SET
  ST -- "$\rho \lt 1$ 才有穩態" --> NS
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
 * §7：多參數的線性化迴路（F-SO.7）。$\delta\mathbf w = \mathbf w - \mathbf w^*$；$E[\mathbf G_k] \approx \mathbf J\,\delta\mathbf w_k$；$\mathbf w_{k+1} = \mathbf w_k + \mathbf M\,\mathbf G_k$
 * ⇒ $\delta\mathbf w_{k+1} = \delta\mathbf w_k + \mathbf M\mathbf J\,\delta\mathbf w_k = (\mathbf I + \mathbf M\mathbf J)\,\delta\mathbf w_k$。只看對角元素會漏掉交叉項。
 */
export const CHART_MIMO_LOOP = String.raw`flowchart TB
  X(["$\delta\mathbf w_k = \mathbf w_k - \mathbf w^*$<br/>向量：每個參數一個分量"])
  J["$\times \mathbf J$<br/>$E[\mathbf G_k] \approx \mathbf J\cdot\delta\mathbf w_k$"]
  MM["$\times \mathbf M$<br/>更新矩陣：$\mathbf w_{k+1} = \mathbf w_k + \mathbf M\cdot\mathbf G_k$"]
  S(("＋"))
  DLY["$z^{-1}$<br/>下一個 block"]
  DIAG["只看對角：$1 + M_{ii}\cdot J_{ii}$<br/>（其他參數凍結時的 pole）"]
  RHO["一起更新：$\rho(\mathbf I + \mathbf M\cdot\mathbf J) \lt 1$<br/>交叉項可以把 eigenvalue 推出單位圓"]
  X -- "＋" --> S
  X --> J
  J -- "$E[\mathbf G_k]$" --> MM
  MM -- "＋（$\mathbf M\cdot\mathbf J\cdot\delta\mathbf w_k$）" --> S
  S -- "$\delta\mathbf w_{k+1} = (\mathbf I + \mathbf M\cdot\mathbf J)\cdot\delta\mathbf w_k$" --> DLY
  DLY --> X
  J -. "只取對角元素 $J_{ii}$" .-> DIAG
  S -. "整個矩陣的 eigenvalue" .-> RHO
  ${FOCUS}
  ${WARN}
  class J,MM,RHO focus
  class DIAG warn`

/**
 * §8：從 gain code 的偏差到輸出 spur／jitter（§8 的逐步推導）。
 * $\delta t[n] = x[n]\,\delta w[n]$（block 速率 $k$ 的 $\delta w_k$ 以 ZOH 展開到 sample 速率 $n$，含 commit latency $n_c$）；
 * 輸出路徑用 $T = \frac{L}{1+L}$（不是 $H_{\mathrm{PD}}$）；$\varphi_{\mathrm{out}} = -2\pi f_{\mathrm{out}}\,T\,\delta t$；tone 時 $\beta = 2\pi f_{\mathrm{out}} A_t\,\lvert T(f_m)\rvert$，spur $\approx 20\log_{10}(\beta/2)$。
 */
export const CHART_OUTPUT_PATH = String.raw`flowchart TB
  W(["$\delta w_k$：係數偏差<br/>（block 速率，索引 $k$）"])
  ZOH["ZOH 展開到 sample 速率<br/>$\delta w[n] = \delta w_{\lfloor (n - n_c)/N\rfloor}$<br/>$n_c$ = commit latency"]
  X(["code $x[n]$"])
  MUL(("$\times$"))
  T["輸出 transfer<br/>$T = \frac{L}{1+L}$（不是 $H_{\mathrm{PD}}$）"]
  PH["$\times (-2\pi f_{\mathrm{out}})$<br/>$\varphi_{\mathrm{out}} = -2\pi f_{\mathrm{out}}\cdot T\cdot\delta t$"]
  BETA["單一 tone $\delta t = A_t\cdot\cos(2\pi f_m t)$：<br/>$\beta = 2\pi f_{\mathrm{out}}\cdot A_t\cdot\lvert T(f_m)\rvert$"]
  SPUR["spur $\approx 20\log_{10}(J_1(\beta)/J_0(\beta))$<br/>$\approx 20\log_{10}(\beta/2)$"]
  JIT["隨機分量 $\to$ 輸出 PN／jitter<br/>（$\delta t$ 的 PSD 經 $\lvert T\rvert^2$ 與 $(2\pi f_{\mathrm{out}})^2$）"]
  W --> ZOH
  ZOH -- "$\delta w[n]$" --> MUL
  X --> MUL
  MUL -- "$\delta t[n] = x[n]\cdot\delta w[n]$" --> T
  T -- "$T\cdot\delta t$" --> PH
  PH -- "$\varphi_{\mathrm{out}}$" --> BETA
  BETA --> SPUR
  PH -- "$\varphi_{\mathrm{out}}$" --> JIT
  ${FOCUS}
  ${ALT}
  class T focus
  class SPUR,JIT alt`

/**
 * §9：反面測試的兩道防線（TB 版面：兩條互不相連的流程左右並排）。左邊：故意注入錯誤，確認模擬／RTL／UI 都出現預期的數學特徵與解釋型警告。
 * 右邊：公式與獨立的時域 Monte Carlo 交叉比對（$\sigma_w = \mu\sigma_\eta/\sqrt{1-p^2}$ 對 MC；漏掉平方的 $\sqrt{1-p}$ 版本要被抓出來）。
 */
export const CHART_NEGATIVE_CHECKS = String.raw`flowchart TB
  INJ(["注入錯誤<br/>極性反轉、$N$ 改變忘記 scaling、<br/>overflow…"])
  SIM["模擬／RTL／UI 照常執行"]
  SIG["數學特徵（本頁即時計算）<br/>pole、$g$ 乘上 $N$、wrap 後的值…"]
  WARN(["應該出現解釋型警告<br/>而不是一條漂亮的收斂曲線"])
  FORM["路徑 A：解析公式<br/>$\sigma_w = \mu\sigma_\eta/\sqrt{1 - p^2}$"]
  TD["路徑 B：獨立的時域<br/>Monte Carlo<br/>多個 seeds，<br/>Student-t 95% CI"]
  CMP{"差距在容許誤差內？<br/>（容許誤差 = CI 半寬）"}
  OK(["$\checkmark$ 交叉比對通過"])
  BAD(["$\times$ 公式或模擬有錯<br/>例：分母寫成 $\sqrt{1 - p}$ 會落在這裡"])
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
