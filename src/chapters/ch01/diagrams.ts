import type { SystemBlock } from '@/components'
import { mermaidMathDelimiters } from '@/components/mermaidSource'

/**
 * Ch01 的方塊圖（docs/teaching-style.md §8）。每張圖是一個具名匯出的 Mermaid 原始碼字串，
 * diagrams.test.tsx 以真正的 mermaid parser 逐一解析、實際 render 一次，並核對圖上的數字與 src/simulation 的實際函式一致。
 *
 * 寫法約定：
 * - 圖內的數學一律寫 `$...$`（LaTeX），文字照常寫：節點與連線的雙引號標籤裡，`<Mermaid>` 會用 KaTeX 排版（和正文同一套樣式）。
 *   原始碼用 String.raw 樣板字串，TeX 的反斜線只寫一次；換行用 `<br/>`，標籤內不要用雙反斜線（Mermaid 會把它收成一個）。
 *   含括號、等號、斜線等字元的文字一律用雙引號包住。
 * - 節點文字不使用小於／大於符號（securityLevel: 'strict' 會把它們當成 HTML 標籤的開頭而吃掉文字），改用文字（「大於」「小於」）。
 * - 加法點是圓形節點 (("＋"))，每條進入的線標 "＋" 或 "−"（全形加號與減號 U+2212 就是符號本身，不算 Unicode 拼的數學）；
 *   乘法點寫 (("$\times$"))；延遲（暫存器）寫 $z^{-1}$。
 *   注意是全形的「＋」：Mermaid 11 把節點／連線文字當成 Markdown 處理，單獨一個半形加號會被當成清單符號，
 *   畫出來變成「Unsupported markdown: list」——parser 不會報錯，只有真的 render 才看得到（diagrams.test.tsx 有 render 檢查）。
 *   同理，文字不要以半形的減號、星號、井號或「1.」開頭。
 * - 誤差極性 $e = y - \hat y$、參數誤差 $\delta = a - w$（勘誤 E39）；本章全部是 sample rate（索引 $n$），沒有 block rate（$k$）的訊號。
 * - 圖說（caption）也支援 `$...$`：變數用 LaTeX，其餘是文字（ch01.test.tsx 會檢查 KaTeX 以外沒有 Unicode 拼的數學）。
 * - stateDiagram 的連線說明（冒號後面）不能加雙引號，共用的前處理不會轉換它；用 stateText() 把 `$...$` 併成單一的 `$$...$$`
 *   （和 mermaidMathDelimiters 對節點標籤做的事一樣）。state 的說明文字（state "..." as S）有雙引號，直接寫 `$...$`。
 * - 並排比較圖：最外層 flowchart LR、每一列一個 subgraph（各自 direction LR、彼此不連線），所以各列由上往下排、列內由左往右流。
 *   Mermaid 把彼此不相連的 subgraph 依「宣告的相反順序」由上往下排，所以原始碼裡**最後宣告的那一列在最上面**；
 *   DIAGRAMS 的 rows 欄位記錄讀者看到的由上到下順序，diagrams.test.tsx 以實際排版結果核對。
 * - 迴路圖：dagre 會把「第一個走回已經過節點」的連線當成回授線倒著畫，所以先宣告順向路徑、最後才宣告回授線。
 */

/** 章首系統地圖要標成藍色的方塊：1-bit comparator（§2 的 sign）＋ GMAC、步長、累加器（更新式的三個零件）。 */
export const SYSTEM_MAP_FOCUS: SystemBlock[] = ['cmp', 'gmac', 'scale', 'acc']

/** 系統地圖的圖說（預設圖說會列出方塊名稱；本章用自己的一句話，不含符號）。 */
export const SYSTEM_MAP_CAPTION =
  '系統地圖｜藍色是本章的主角：1-bit comparator、GMAC（相關器）、正規化與學習率、增益累加器。教學用概念架構，不是特定晶片的 netlist。'

/** 深淺主題都看得清楚的標色：focus＝這張圖的重點、warn＝有問題或會被拉走的路徑、ok＝正確或穩健的路徑。 */
const STYLE = `  classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff,stroke-width:2px
  classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff
  classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff`

/** stateDiagram 連線說明裡的 `$...$`（見檔頭）：整句併成單一的 `$$...$$`，文字部分包成 \text{…}。 */
const stateText = (text: string): string => mermaidMathDelimiters(`"${text}"`).slice(1, -1)

/** 圖 1-1：批次（先存、一次解完）vs 線上（來一筆、修一次）。原始碼由下往上寫：最後宣告的「批次」排在最上面（見檔頭）。 */
export const CHART_BATCH_VS_ONLINE = String.raw`flowchart LR
  subgraph ONLINE["線上 online（LMS）：來一筆，修一次"]
    direction LR
    O1["第 $n$ 筆<br/>$(x_n, y_n)$"] --> O2["① 預測<br/>$\hat y_n = w_n x_n$"]
    O2 --> O3["② 比較<br/>$e_n = y_n - \hat y_n$"]
    O3 --> O4["③ 修正<br/>$w_{n+1} = w_n + \mu\, e_n\, x_n$"]
    O4 -->|"只記住 $w$，資料用完就丟"| O2
  end
  subgraph BATCH["批次 batch：全部存起來，最後解一次"]
    direction LR
    B1["$N$ 筆資料<br/>$(x_i, y_i)$"] --> B2["記憶體<br/>$N$ 筆全部存起來"]
    B2 --> B3["算兩個總和<br/>$\sum x_i y_i$ 與 $\sum x_i^2$"]
    B3 --> B4["相除一次<br/>$w^* = \sum x_i y_i / \sum x_i^2$"]
  end
${STYLE}
  class B2,O4 focus`

/**
 * 圖 1-2：純量 LMS 的訊號流（原有的圖；加法點補上正負號，並先宣告預測那條路，讓「下一筆」成為往回畫的回授線）。
 * 下標寫成 $w_{n+1}$，避免「w_n+1」被誤讀成 $w_n + 1$。
 */
export const CHART_LMS_LOOP = String.raw`flowchart LR
  X["$x_n$（輸入 / DSM code）"] --> MUL["$\times w_n$（預測）"]
  MUL --> YH["$\hat y_n = w_n x_n$"]
  X --> BOX["黑盒子：$a\, x_n$"]
  BOX -- "＋" --> ADD(("＋"))
  V["$v_n$（雜訊）"] -- "＋" --> ADD
  ADD --> Y["$y_n$（量測）"]
  Y -- "＋" --> SUB(("＋"))
  YH -- "−" --> SUB
  SUB --> E["$e_n = y_n - \hat y_n$"]
  E --> UPD["$w_{n+1} = w_n + \mu\, e_n\, x_n$"]
  X --> UPD
  UPD -->|"下一筆"| MUL
${STYLE}
  class UPD focus`

/** 圖 1-3：從資料到成本——$(x, y)$ → 誤差 → 平方 → 平均 → $J_2(w)$ → 找最小。分成兩列，免得一長串縮得太小（原始碼由下往上寫）。 */
export const CHART_DATA_TO_COST = String.raw`flowchart LR
  subgraph COST["再把很多筆的誤差變成一個數，然後找最小"]
    direction LR
    E2["每一筆的誤差 $e$"] --> SQ["Squares<br/>平方：$e^2$"]
    SQ --> AV["Mean<br/>很多筆取平均：$E[e^2]$"]
    AV --> J["成本<br/>$J_2(w) = E[(y - w\, x)^2]$"]
    J --> MIN["Least<br/>換不同的 $w$，找最小"]
    MIN --> WS["最佳解 $w^*$"]
  end
  subgraph ERR["先算一筆資料的誤差"]
    direction LR
    X["輸入 $x$"] --> P["預測<br/>$\hat y = w\, x$"]
    W["你選的 $w$"] --> P
    Y["量測 $y$"] -- "＋" --> S(("＋"))
    P -- "−" --> S
    S --> E["誤差<br/>$e = y - w\, x$"]
  end
${STYLE}
  class SQ,AV,MIN focus`

/** 圖 1-4：同一組誤差、三種計分方式（模型 A：$\pm10$；模型 B：$\pm1$）。 */
export const CHART_SCORE_COMPARE = String.raw`flowchart LR
  A["模型 A 的誤差 $e$<br/>$+10$、$-10$、$+10$、$-10$"]
  B["模型 B 的誤差 $e$<br/>$+1$、$-1$、$+1$、$-1$"]
  A --> M1["直接平均<br/>$\operatorname{mean}(e)$"]
  B --> M1
  A --> M2["先取絕對值再平均<br/>$\operatorname{mean}(|e|)$"]
  B --> M2
  A --> M3["先平方再平均<br/>$\operatorname{mean}(e^2)$"]
  B --> M3
  M1 --> R1["A = 0、B = 0<br/>正負抵消，分不出好壞"]
  M2 --> R2["A = 10、B = 1<br/>分得出來（MAE）"]
  M3 --> R3["A = 100、B = 1<br/>分得出來，大誤差罰更重（MSE）"]
${STYLE}
  class R1 warn
  class R2,R3 ok
  class M3 focus`

/** 圖 1-5：手算流程——從資料表到 $w^*$（§1.0 的三筆含雜訊資料）。 */
export const CHART_WSTAR_CALC = String.raw`flowchart LR
  T["資料表（三筆）<br/>$x$：1、2、4<br/>$y$：3.2、5.7、12.5"]
  T --> C1["① 每筆算 $x_i^2$<br/>1、4、16"]
  T --> C2["② 每筆算 $x_i y_i$<br/>3.2、11.4、50"]
  C1 --> S1["③ 加總 $\sum x_i^2 = 21$<br/>（平均 $E[x^2] = 7$）"]
  C2 --> S2["④ 加總 $\sum x_i y_i = 64.6$<br/>（平均 $E[xy] = 21.5333$）"]
  S2 -- "分子" --> DIV["⑤ 相除"]
  S1 -- "分母" --> DIV
  DIV --> WS["$w^* = 64.6 / 21 = 3.07619$"]
${STYLE}
  class DIV,WS focus`

/** 圖 1-6：Normal equation 畫成相關器——誤差乘輸入、平均、看是不是 0。先宣告誤差節點，「再調 w → 新的誤差」才會是往回畫的回授線。 */
export const CHART_NORMAL_EQ = String.raw`flowchart LR
  E["誤差 $e = y - w\, x$"] --> M(("$\times$"))
  X["輸入 $x$"] --> M
  M --> AV["很多筆取平均<br/>$E[\,\cdot\,]$"]
  AV --> C["誤差與輸入的相關<br/>$E[e\, x]$"]
  C --> Q{"$E[e\, x]$ 等於 0 嗎？"}
  Q -- "是" --> DONE["到達最佳解 $w^*$<br/>$E[e^*\, x] = 0$"]
  Q -- "否：誤差還跟著 $x$ 動" --> ADJ["再調 $w$<br/>平均更新量 $= \mu\, E[e\, x]$"]
  ADJ -->|"新的誤差"| E
${STYLE}
  class M,AV,C focus
  class DONE ok`

/** 圖 1-7：成本 = 雜訊底 + 二次碗（F-01.6）。 */
export const CHART_COST_SPLIT = String.raw`flowchart LR
  W["你選的 $w$"] -- "＋" --> D(("＋"))
  WS["最佳解 $w^*$"] -- "−" --> D
  D --> SQ["平方<br/>$(w - w^*)^2$"]
  SQ --> K["$\times\, \tfrac12\, E[x^2]$<br/>碗的曲率"]
  K -- "＋" --> S(("＋"))
  F["雜訊底 $J(w^*)$<br/>調 $w$ 消不掉"] -- "＋" --> S
  S --> J["成本 $J(w)$"]
${STYLE}
  class K focus
  class F warn`

/** 圖 1-8：$\tfrac12$ 與步長的等價——三種「對誰做 gradient descent」並排（勘誤 E41）。原始碼由下往上寫：畫出來是 本站 → 等價寫法 → 陷阱。 */
export const CHART_HALF_FACTOR = String.raw`flowchart LR
  subgraph R3["陷阱：對 $J_2$ 走步長 $\mu$"]
    direction LR
    C1["單筆成本<br/>$e^2$"] --> C2["對 $w$ 微分<br/>$-2\, e\, x$"]
    C2 --> C3["$\times\, (-\mu)$"]
    C3 --> C4["$\Delta w = 2\mu\, e\, x$<br/>步伐大 2 倍"]
  end
  subgraph R2["等價寫法：對 $J_2$ 走步長 $\mu/2$"]
    direction LR
    B1["單筆成本<br/>$e^2$"] --> B2["對 $w$ 微分<br/>$-2\, e\, x$"]
    B2 --> B3["$\times\, (-\mu/2)$"]
    B3 --> B4["$\Delta w = \mu\, e\, x$"]
  end
  subgraph R1["本站：對 $J = \tfrac12 J_2$ 走步長 $\mu$"]
    direction LR
    A1["單筆成本<br/>$\tfrac12\, e^2$"] --> A2["對 $w$ 微分<br/>$-e\, x$"]
    A2 --> A3["$\times\, (-\mu)$"]
    A3 --> A4["$\Delta w = \mu\, e\, x$"]
  end
${STYLE}
  class A4,B4 ok
  class C4 warn
  class A1,B3 focus`

/** 圖 1-9：平均而言，LMS 是把 w 拉向 w* 的一階負回授迴路。 */
export const CHART_MEAN_UPDATE = String.raw`flowchart LR
  WS["目標 $w^*$"] -- "＋" --> D(("＋"))
  D --> G["$\times\, \mu\, E[x^2]$"]
  G --> DW["平均更新量<br/>$E[\Delta w] = \mu\, E[x^2]\, (w^* - w)$"]
  DW -- "＋" --> ACC(("＋"))
  ACC --> Z["$z^{-1}$<br/>（存到下一筆）"]
  Z --> W["目前的 $w$"]
  W -- "＋" --> ACC
  W -- "−" --> D
${STYLE}
  class G focus`

/** 圖 1-10：手算流程——§1.4 的例子（$a = 3$、$w_0 = 1$、$x = 2$、$\mu = 0.1$，所以 $y = 6$）走兩步。原始碼由下往上寫：第 0 筆畫在上面。 */
export const CHART_HAND_FLOW = String.raw`flowchart LR
  subgraph S1["第 1 筆（$n = 1$）"]
    direction LR
    A1["目前的 $w_1 = 1.8$"] --> B1["① 預測<br/>$\hat y_1 = 1.8 \times 2 = 3.6$"]
    B1 --> C1["② 比較<br/>$e_1 = 6 - 3.6 = 2.4$"]
    C1 --> D1["③ 修正量<br/>$\Delta w_1 = 0.1 \times 2.4 \times 2 = 0.48$"]
    D1 --> N1["$w_2 = 1.8 + 0.48 = 2.28$"]
  end
  subgraph S0["第 0 筆（$n = 0$）"]
    direction LR
    A0["目前的 $w_0 = 1$"] --> B0["① 預測<br/>$\hat y_0 = 1 \times 2 = 2$"]
    B0 --> C0["② 比較<br/>$e_0 = 6 - 2 = 4$"]
    C0 --> D0["③ 修正量<br/>$\Delta w_0 = 0.1 \times 4 \times 2 = 0.8$"]
    D0 --> N0["$w_1 = 1 + 0.8 = 1.8$"]
  end
${STYLE}
  class N0,A1,N1 focus`

/** 圖 1-11：固定 x、無雜訊時的參數誤差迴路——繞一圈的增益是 $\mu x^2$，所以 $p = 1 - \mu x^2$。 */
export const CHART_DELTA_LOOP = String.raw`flowchart LR
  A["真值 $a$"] -- "＋" --> D(("＋"))
  D --> DL["參數誤差<br/>$\delta_n = a - w_n$"]
  DL --> X1["$\times\, x$"]
  X1 --> E["誤差<br/>$e_n = \delta_n\, x$"]
  E --> X2["$\times\, \mu\, x$"]
  X2 --> DW["更新量<br/>$\Delta w_n = \mu\, x^2\, \delta_n$"]
  DW -- "＋" --> ACC(("＋"))
  ACC --> Z["$z^{-1}$（暫存器）<br/>輸出 $w_n$"]
  Z -- "＋" --> ACC
  Z -- "−" --> D
${STYLE}
  class X1,X2 focus`

/** 圖 1-12：雜訊怎麼進到 w——一階遞迴濾波器 $\tilde w_{n+1} = p\, \tilde w_n + \mu\, x\, v_n$。 */
export const CHART_NOISE_LOOP = String.raw`flowchart LR
  V["雜訊 $v_n$<br/>零均值、標準差 $\sigma_v$"] --> G["$\times\, \mu\, x$<br/>每步注入的量"]
  G -- "＋" --> S(("＋"))
  S --> Z["$z^{-1}$"]
  Z --> WT["偏離平均的量<br/>$\tilde w_n = w_n - E[w_n]$"]
  WT --> P["$\times\, p$<br/>$p = 1 - \mu\, x^2$"]
  P -- "＋" --> S
${STYLE}
  class P focus`

/** 圖 2-1：MSE／MAE／Huber 三條更新管線並排，差別只在 $\psi$ 那一格（原樣／取正負號／截斷）。原始碼由下往上寫：畫出來是 Conventional → Sign-Error → Huber。 */
export const CHART_PSI_PIPELINES = String.raw`flowchart LR
  subgraph PH["Huber LMS（$\rho_H$：小誤差平方、大誤差線性）"]
    direction LR
    H1["誤差 $e$"] --> H2["$\psi_H$：截在 $\pm\delta_H$<br/>$\psi = \operatorname{clip}(e, -\delta_H, \delta_H)$"]
    H2 --> H3["$\times\, \mu\, x$"]
    H3 --> H4["$\Delta w = \mu\, \operatorname{clip}(e)\, x$"]
  end
  subgraph PA["Sign-Error LMS（MAE：$\rho_1 = |e|$ 絕對值）"]
    direction LR
    A1["誤差 $e$"] --> A2["$\psi_1$：只留正負號<br/>$\psi = \operatorname{sign}(e)$"]
    A2 --> A3["$\times\, \mu\, x$"]
    A3 --> A4["$\Delta w = \mu\, \operatorname{sign}(e)\, x$"]
  end
  subgraph PM["Conventional LMS（MSE：$\rho_2 = \tfrac12 e^2$）"]
    direction LR
    M1["誤差 $e$"] --> M2["$\psi_2$：原樣通過<br/>$\psi = e$"]
    M2 --> M3["$\times\, \mu\, x$"]
    M3 --> M4["$\Delta w = \mu\, e\, x$"]
  end
${STYLE}
  class M2,A2,H2 focus`

/** 圖 2-2：$\operatorname{sign}(e)$ 的判斷流程與 $e = 0$ 的 tie 慣例（lms.ts 的 sgn(v, tie)；勘誤 E40）。 */
export const CHART_SIGN_TIE = String.raw`flowchart TB
  E["誤差 $e$"] --> Q{"$e$ 和 0 比"}
  Q -- "$e$ 大於 0" --> P["$\operatorname{sign}(e) = +1$"]
  Q -- "$e$ 小於 0" --> N["$\operatorname{sign}(e) = -1$"]
  Q -- "$e$ 剛好等於 0（尖點）" --> T{"用哪個 tie 慣例？<br/>次梯度可以是 $[-1, 1]$ 裡任何值"}
  T -- "zero：數學次梯度" --> T0["$\operatorname{sign}(0) = 0$<br/>這一步不動"]
  T -- "plus：comparator" --> T1["$\operatorname{sign}(0) = +1$"]
  T -- "minus：comparator" --> T2["$\operatorname{sign}(0) = -1$"]
${STYLE}
  class T focus`

/**
 * 圖 2-3 的例子：與 §2.2.1 單步比較表同一個起點（$w = 1$、$x = 1$、$\mu = 0.2$、$\delta_H = 1$），只把量測從正常的 $a x = 3$ 換成一筆 outlier 21。
 * 正文（Losses.tsx）用這組數字呼叫 lms.ts 的 step 函數；diagrams.test.tsx 核對圖上的數字與它一致。
 */
export const OUTLIER_DEMO = { w: 1, x: 1, mu: 0.2, huberDelta: 1, yNormal: 3, y: 21 } as const

/** 圖 2-3：同一筆 outlier（$w = 1$、$x = 1$、$\mu = 0.2$、$\delta_H = 1$，量測 $y = 21$）流過三條管線。 */
export const CHART_OUTLIER_FLOW = String.raw`flowchart LR
  O["一筆 outlier<br/>$y = 21$（正常是 3）"] --> E["誤差<br/>$e = 21 - 1 \times 1 = 20$"]
  E --> P2["Conventional<br/>$\psi_2 = e = 20$"]
  E --> P1["Sign-Error<br/>$\psi_1 = \operatorname{sign}(e) = +1$"]
  E --> PH["Huber<br/>$\psi_H = \operatorname{clip}(e, -1, 1) = +1$"]
  P2 --> D2["$\Delta w = 0.2 \times 20 \times 1 = 4$<br/>$w$ 從 1 跳到 5"]
  P1 --> D1["$\Delta w = 0.2 \times 1 \times 1 = 0.2$<br/>$w$ 從 1 到 1.2"]
  PH --> DH["$\Delta w = 0.2 \times 1 \times 1 = 0.2$<br/>$w$ 從 1 到 1.2"]
${STYLE}
  class P2,P1,PH focus
  class D2 warn
  class D1,DH ok`

/** 圖 2-4：平均 vs 中位數的判斷流程（資料 $\{0, 0, 0, 10\}$、$x \equiv 1$）。 */
export const CHART_MEAN_VS_MEDIAN = String.raw`flowchart TB
  D["資料 0、0、0、10<br/>只估一個常數 $w$（$x \equiv 1$）"] --> C{"用哪一種成本？"}
  C -- "MSE：平方" --> S1["斜率 $= w - \text{平均}$<br/>$= w - 2.5$"]
  S1 --> R1["斜率剛好是 0 的地方<br/>$w^* = \text{平均} = 2.5$"]
  C -- "MAE：絕對值" --> S2["$\text{斜率} = (\text{下面的筆數} - \text{上面的筆數}) / 4$"]
  S2 --> Q{"$w$ 的下面和上面<br/>哪一邊的資料多？"}
  Q -- "上面多：斜率為負" --> UP["$w$ 往上移"]
  Q -- "下面多：斜率為正" --> DN["$w$ 往下移"]
  UP --> Q
  DN --> Q
  Q -- "斜率在這裡由負變正" --> R2["停：$w^* = \text{中位數} = 0$"]
${STYLE}
  class R1,R2 ok
  class S1,S2 focus`

/** 圖 2-5：$x \equiv 1$ 時兩個逐筆更新的迴路並排——LMS 是「會漏的平均器」，Sign-Error 是「上下數的計數器」。原始碼由下往上寫：LMS 畫在上面。 */
export const CHART_ONLINE_LOOPS = String.raw`flowchart LR
  subgraph SL["Sign-Error LMS（$x \equiv 1$）：每步固定走 $\mu$，停在中位數附近"]
    direction LR
    SY["$y_n$"] -- "＋" --> SS(("＋"))
    SS --> SE["$e_n = y_n - w_n$"]
    SE --> SP["$\operatorname{sign}(e_n)$<br/>$\times\, \mu$"]
    SP -- "＋" --> SA(("＋"))
    SA --> SZ["$z^{-1}$<br/>輸出 $w_n$"]
    SZ -- "＋" --> SA
    SZ -- "−" --> SS
  end
  subgraph LL["Conventional LMS（$x \equiv 1$）：步伐正比於誤差，停在平均"]
    direction LR
    LY["$y_n$"] -- "＋" --> LS(("＋"))
    LS --> LE["$e_n = y_n - w_n$"]
    LE --> LP["原樣通過<br/>$\times\, \mu$"]
    LP -- "＋" --> LA(("＋"))
    LA --> LZ["$z^{-1}$<br/>輸出 $w_n$"]
    LZ -- "＋" --> LA
    LZ -- "−" --> LS
  end
${STYLE}
  class LP,SP focus`

/** 圖 2-6：Sign-Error 在 $\{0, 0, 0, 10\}$ 上的格點 Markov 鏈（$\operatorname{sign}(0) = 0$、$w_0 = 0$；F-01.16）。 */
export const CHART_LATTICE_CHAIN = String.raw`stateDiagram-v2
  direction LR
  state "$w = 0$（中位數）" as S0
  state "$w = \mu$" as S1
  state "$w = 2\mu$" as S2
  state "$w = 3\mu\, \ldots$" as S3
  S0 --> S0: ${stateText(String.raw`抽到 0（機率 $3/4$），$e = 0$，不動`)}
  S0 --> S1: ${stateText(String.raw`抽到 10（機率 $1/4$），往上`)}
  S1 --> S0: ${stateText(String.raw`抽到 0（$3/4$），往下`)}
  S1 --> S2: ${stateText(String.raw`抽到 10（$1/4$），往上`)}
  S2 --> S1: ${stateText(String.raw`$3/4$`)}
  S2 --> S3: ${stateText(String.raw`$1/4$`)}
  S3 --> S2: ${stateText(String.raw`$3/4$`)}
  classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff
  class S0 focus`

/** 圖 2-7：連續雜訊下 Sign-Error 的線性化等效迴路——comparator 平均起來像增益 $K_q$。 */
export const CHART_SIGN_LINEARIZED = String.raw`flowchart LR
  D["離中位數多遠<br/>$d_n = w_n - m$"] --> K["$\operatorname{sign}$ 的平均行為<br/>$\times\, (-K_q)$，$K_q = 2\, f(m)$"]
  K -- "＋" --> S(("＋"))
  XI["決策抖動 $\xi_n$<br/>零均值、每步能量約 1"] -- "＋" --> S
  S --> SN["這一步的方向<br/>$s_n = +1$ 或 $-1$"]
  SN --> MU["$\times\, \mu$"]
  MU -- "＋" --> ACC(("＋"))
  ACC --> Z["$z^{-1}$"]
  Z --> D
  D -- "＋" --> ACC
${STYLE}
  class K focus`

/** 圖 2-8（Research）：污染資料的產生模型 $y = a + v + o$，以及平均／中位數各被拉走多少（F-01.17）。 */
export const CHART_CONTAM_MODEL = String.raw`flowchart LR
  A["真值 $a$"] -- "＋" --> S(("＋"))
  V["Gaussian 雜訊 $v$<br/>零均值、標準差 $\sigma$"] -- "＋" --> S
  O["outlier $o$<br/>機率 $\varepsilon$ 是 $+s$，其餘是 0"] -- "＋" --> S
  S --> Y["量測 $y = a + v + o$"]
  Y --> ME["平均（MSE、LMS 的目標）<br/>$a + \varepsilon\, s$：$s$ 多大就被拉多遠"]
  Y --> MD["中位數（MAE、Sign-Error 的目標）<br/>$a + m$：$m$ 幾乎與 $s$ 無關"]
${STYLE}
  class ME warn
  class MD ok`

/** 圖 2-9：該用哪一種演算法？由硬體給的誤差資訊決定。 */
export const CHART_ALGO_CHOICE = String.raw`flowchart TB
  Q1{"硬體給你什麼誤差資訊？"}
  Q1 -- "多位元（ADC / TDC）：知道誤差大小" --> Q2{"資料裡有 outlier 嗎？"}
  Q1 -- "只有 1 bit（comparator / BBPD）：只知道正負" --> Q3{"regressor $x$ 的大小還留著嗎？"}
  Q2 -- "幾乎沒有" --> A1["Conventional LMS<br/>$\Delta w = \mu\, e\, x$<br/>目標：平均（MSE）"]
  Q2 -- "有" --> A2["Huber LMS<br/>$\Delta w = \mu\, \operatorname{clip}(e)\, x$<br/>目標：Huber 位置"]
  Q3 -- "留著（多位元 code）" --> A3["Sign-Error LMS<br/>$\Delta w = \mu\, \operatorname{sign}(e)\, x$<br/>目標：加權中位數（MAE）"]
  Q3 -- "也只剩正負號" --> A4["Sign-Sign LMS<br/>$\Delta w = \mu\, \operatorname{sign}(e)\, \operatorname{sign}(x)$<br/>目標：$y/x$ 的不加權中位數"]
${STYLE}
  class A3 focus`

/** 圖 2-10：綜合手算（HC-01.8）的計算順序；數字是預設輸入 $a = 3$、$\sigma_v = 1$、$\varepsilon = 0.1$、$s = 20$、$\mu = 0.05$。原始碼由下往上寫：LMS 畫在上面。 */
export const CHART_HC8_FLOW = String.raw`flowchart LR
  subgraph HS["Sign-Error LMS：追中位數"]
    direction LR
    S1["⑦⑧ 查常態表<br/>$q = 1 / (2 (1 - \varepsilon)) = 0.55556$<br/>$z = \Phi^{-1}(q) = 0.13971$"] --> S2["⑨⑩ 偏移<br/>$m = \sigma_v\, z = 0.13971$<br/>時間平均約 $a + m = 3.1397$"]
    S2 --> S3["⑪⑫ 中位數處的密度<br/>$\varphi(z) = 0.39507$<br/>$f = (1 - \varepsilon)\, \varphi(z) / \sigma_v = 0.35556$"]
    S3 --> S4["⑬⑭ 抖動<br/>$\operatorname{Var} = \mu / (4 f) = 0.035156$<br/>$\operatorname{std} = 0.1875$"]
  end
  subgraph HL["Conventional LMS：追平均"]
    direction LR
    L1["①② 偏移<br/>$\varepsilon\, s = 0.1 \times 20 = 2$<br/>$E[w_\infty] = a + \varepsilon\, s = 5$"] --> L2["③④ 總雜訊的變異數<br/>$\varepsilon (1 - \varepsilon)\, s^2 = 36$<br/>$\operatorname{Var}(\tilde v) = \sigma_v^2 + 36 = 37$"]
    L2 --> L3["⑤⑥ 抖動<br/>$\operatorname{Var} = \mu \operatorname{Var}(\tilde v) / (2 - \mu) = 0.94872$<br/>$\operatorname{std} = 0.97402$"]
  end
${STYLE}
  class L1,L3 warn
  class S2,S4 ok`

export type DiagramKind = '數學模型' | '演算法迴圈' | '比較圖' | '手算流程' | '判斷流程' | '狀態機'

export interface Ch01Diagram {
  /** 例如 'D-01.3'（章內 <BlockDiagram id="D-01.3"> 使用） */
  id: string
  /** 圖號，例如「圖 1-3」（§1 的圖編 1-x、§2 的圖編 2-x） */
  label: string
  /** 一句話的名稱（回報與測試用；純文字） */
  name: string
  kind: DiagramKind
  /** 所在小節的錨點 id */
  section: string
  /** Mermaid 原始碼 */
  chart: string
  /** 圖說：一句話說明要看什麼（文字；變數寫 `$...$`，不含 Unicode 拼的數學） */
  caption: string
  /** 這張圖在說明哪一條公式（F-01.x）：圖必須排在該公式之前（先看圖、再看數學） */
  formula?: string
  /** 並排比較圖：讀者看到的各列（subgraph 標題的開頭），由上到下；導讀文字的「上面／下面／第幾列」以此為準 */
  rows?: string[]
  /** 只在 Research 模式顯示（放在 ModeGate 內） */
  researchOnly?: boolean
}

/** 本章全部方塊圖，依頁面出現順序排列（章首的系統地圖另由 <SystemMap> 產生，不在此表）。 */
export const DIAGRAMS: Ch01Diagram[] = [
  {
    id: 'D-01.1',
    label: '圖 1-1',
    name: '批次 vs 線上（LMS）',
    kind: '比較圖',
    section: 'ch01-s10',
    chart: CHART_BATCH_VS_ONLINE,
    rows: ['批次 batch', '線上 online'],
    caption: '兩種找係數的做法並排。上面那一列要把資料全部存起來才能算；下面那一列（LMS）只記住一個 $w$，每來一筆就修一次。',
  },
  {
    id: 'D-01.2',
    label: '圖 1-2',
    name: '純量 LMS 的訊號流',
    kind: '演算法迴圈',
    section: 'ch01-s101',
    chart: CHART_LMS_LOOP,
    caption:
      '純量 LMS 的訊號流（L0 模型）。PLL 對應：輸入是 DSM code、黑盒子的係數是 DTC gain 所在的誤差路徑、相減的是 PD／comparator、更新的是 GMAC + gain register。',
  },
  {
    id: 'D-01.3',
    label: '圖 1-3',
    name: '從資料到成本',
    kind: '數學模型',
    section: 'ch01-s11',
    chart: CHART_DATA_TO_COST,
    rows: ['先算一筆資料的誤差', '再把很多筆的誤差變成一個數'],
    caption: '從資料到成本：上面一列算出一筆資料的誤差，下面一列的三個藍色方塊由左到右就是 Squares、Mean、Least。每換一個 $w$，就算出一個成本。',
  },
  {
    id: 'D-01.4',
    label: '圖 1-4',
    name: '三種計分方式',
    kind: '比較圖',
    section: 'ch01-s111',
    chart: CHART_SCORE_COMPARE,
    caption: '同一組誤差送進三種計分方式。直接平均（紅色）分不出兩個模型的好壞；取絕對值或平方（綠色）才分得出來。',
  },
  {
    id: 'D-01.5',
    label: '圖 1-5',
    name: '從資料表算 w* 的順序',
    kind: '手算流程',
    section: 'ch01-s12',
    chart: CHART_WSTAR_CALC,
    formula: 'F-01.4',
    caption: '手算順序：資料表先變成兩欄（輸入的平方、輸入乘量測），各自加總，最後相除一次。',
  },
  {
    id: 'D-01.6',
    label: '圖 1-6',
    name: 'Normal equation = 相關器',
    kind: '演算法迴圈',
    section: 'ch01-s121',
    chart: CHART_NORMAL_EQ,
    formula: 'F-01.5',
    caption: 'Normal equation 畫成相關器：藍色三格把誤差乘上輸入再取平均；結果不是 0 就繼續調 $w$，是 0 就到了最佳解。',
  },
  {
    id: 'D-01.7',
    label: '圖 1-7',
    name: '成本 = 雜訊底 + 二次碗',
    kind: '數學模型',
    section: 'ch01-s121',
    chart: CHART_COST_SPLIT,
    formula: 'F-01.6',
    caption: '成本拆成兩條路：上面那條是離最佳解多遠的平方再乘上曲率（碗），下面那條是調 $w$ 也消不掉的雜訊底。',
  },
  {
    id: 'D-01.8',
    label: '圖 1-8',
    name: '二分之一與步長的等價',
    kind: '比較圖',
    section: 'ch01-s13',
    chart: CHART_HALF_FACTOR,
    rows: ['本站', '等價寫法', '陷阱'],
    formula: 'F-01.7',
    caption: '三種寫法並排。前兩列走出同一個更新量（綠色）；第三列的步伐大了兩倍（紅色），拿它的穩定界來設計 LMS 會白白少一半範圍。',
  },
  {
    id: 'D-01.9',
    label: '圖 1-9',
    name: '平均更新量的負回授迴路',
    kind: '演算法迴圈',
    section: 'ch01-s13',
    chart: CHART_MEAN_UPDATE,
    caption: '平均而言，LMS 是一個把 $w$ 拉向目標的負回授迴路：離目標越遠，平均修正量越大；到了目標就歸零。',
  },
  {
    id: 'D-01.10',
    label: '圖 1-10',
    name: '手算兩步的計算順序',
    kind: '手算流程',
    section: 'ch01-s14',
    chart: CHART_HAND_FLOW,
    rows: ['第 0 筆', '第 1 筆'],
    formula: 'F-01.8',
    caption: '手算流程：每一列是一筆資料，由左到右依序是預測、比較、修正。上一列算出的 w 就是下一列的起點。',
  },
  {
    id: 'D-01.11',
    label: '圖 1-11',
    name: '參數誤差迴路與 pole',
    kind: '演算法迴圈',
    section: 'ch01-s14',
    chart: CHART_DELTA_LOOP,
    formula: 'F-01.8',
    caption: '固定輸入、沒有雜訊時的誤差迴路。沿著迴路繞一圈會經過兩個藍色的乘法，它們的乘積就是每一步被修掉的比例。',
  },
  {
    id: 'D-01.12',
    label: '圖 1-12',
    name: '雜訊進入 w 的一階濾波器',
    kind: '數學模型',
    section: 'ch01-s141',
    chart: CHART_NOISE_LOOP,
    formula: 'F-01.9',
    caption: '雜訊怎麼進到 $w$：每一步注入一點新的雜訊，舊的偏離量乘上藍色方塊的倍數後留下來。兩者平衡時的大小就是穩態抖動。',
  },
  {
    id: 'D-01.13',
    label: '圖 2-1',
    name: '三條更新管線（原樣／正負號／截斷）',
    kind: '比較圖',
    section: 'ch01-s21',
    chart: CHART_PSI_PIPELINES,
    rows: ['Conventional LMS', 'Sign-Error LMS', 'Huber LMS'],
    formula: 'F-01.11',
    caption: '三種演算法的更新管線並排。只有藍色那一格不同：原樣通過、只留正負號、截斷。',
  },
  {
    id: 'D-01.14',
    label: '圖 2-2',
    name: 'sign 的判斷流程與 tie 慣例',
    kind: '判斷流程',
    section: 'ch01-s22',
    chart: CHART_SIGN_TIE,
    formula: 'F-01.12',
    caption: '取正負號的判斷流程。誤差不是 0 時沒有爭議；剛好是 0 時（藍色菱形）必須先講好用哪一個慣例。',
  },
  {
    id: 'D-01.15',
    label: '圖 2-3',
    name: '一筆 outlier 流過三條管線',
    kind: '比較圖',
    section: 'ch01-s221',
    chart: CHART_OUTLIER_FLOW,
    caption: '同一筆 outlier 流過三條管線。Conventional LMS 把整個誤差放進更新量（紅色），另外兩條把它限制在固定大小（綠色）。',
  },
  {
    id: 'D-01.16',
    label: '圖 2-4',
    name: '平均 vs 中位數的判斷流程',
    kind: '判斷流程',
    section: 'ch01-s23',
    chart: CHART_MEAN_VS_MEDIAN,
    formula: 'F-01.13',
    caption: '兩種成本各自怎麼找最低點。左邊解一個方程式就得到平均；右邊只要數一數上下各有幾筆、往資料多的那一邊移，移到斜率由負變正的地方就是中位數。',
  },
  {
    id: 'D-01.17',
    label: '圖 2-5',
    name: '逐筆更新的兩個迴路',
    kind: '比較圖',
    section: 'ch01-s231',
    chart: CHART_ONLINE_LOOPS,
    rows: ['Conventional LMS', 'Sign-Error LMS'],
    formula: 'F-01.15',
    caption: '兩個逐筆更新的迴路並排，只差藍色那一格。上面的步伐跟著誤差大小變，下面每一步都走固定大小。',
  },
  {
    id: 'D-01.18',
    label: '圖 2-6',
    name: 'Sign-Error 的格點 Markov 鏈',
    kind: '狀態機',
    section: 'ch01-s231',
    chart: CHART_LATTICE_CHAIN,
    formula: 'F-01.16',
    caption: 'Sign-Error 在這組資料上的狀態圖。每往右一格，往回走的機率都是往前走的三倍，所以大部分時間待在最左邊的中位數。',
  },
  {
    id: 'D-01.19',
    label: '圖 2-7',
    name: 'Sign-Error 的線性化等效迴路',
    kind: '演算法迴圈',
    section: 'ch01-s232',
    chart: CHART_SIGN_LINEARIZED,
    formula: 'F-01.18',
    caption: '連續雜訊下的等效迴路：只輸出正負號的方塊，平均起來像一個固定增益（藍色），剩下的部分當成每一步注入的抖動。',
  },
  {
    id: 'D-01.20',
    label: '圖 2-8',
    name: '污染資料模型',
    kind: '數學模型',
    section: 'ch01-s24',
    chart: CHART_CONTAM_MODEL,
    formula: 'F-01.17',
    caption: '污染資料怎麼產生，以及兩種目標各被拉走多少：平均（紅色）跟著 outlier 的大小跑，中位數（綠色）幾乎不受影響。',
    researchOnly: true,
  },
  {
    id: 'D-01.21',
    label: '圖 2-9',
    name: '演算法選擇流程',
    kind: '判斷流程',
    section: 'ch01-s26',
    chart: CHART_ALGO_CHOICE,
    caption: '該用哪一種演算法，由硬體給的誤差資訊決定。藍色是 PLL 校正迴路實際的位置：誤差只有一個位元，code 是多位元。',
  },
  {
    id: 'D-01.22',
    label: '圖 2-10',
    name: '綜合手算（HC-01.8）的計算順序',
    kind: '手算流程',
    section: 'ch01-s261',
    chart: CHART_HC8_FLOW,
    rows: ['Conventional LMS', 'Sign-Error LMS'],
    caption: '綜合手算的計算順序（圈號對應題目的步驟，數字是預設輸入的答案）。上面一列追平均，下面一列追中位數；每一列都是先算偏移、再算抖動。',
  },
]

/** 依 id 取出方塊圖（找不到就丟錯，避免頁面默默少一張圖）。 */
export function diagramOf(id: string): Ch01Diagram {
  const d = DIAGRAMS.find((x) => x.id === id)
  if (!d) throw new Error(`找不到方塊圖 ${id}`)
  return d
}
