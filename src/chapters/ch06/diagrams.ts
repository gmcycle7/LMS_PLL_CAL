/**
 * 第 06 章的方塊圖（docs/teaching-style.md §8）。每張圖的 Mermaid 原始碼都是具名匯出的常數；
 * diagrams.test.tsx 先用真正的 mermaid parser 解析，再用共用的 renderMermaidForTest（@/components/mermaidTestUtils）真的畫一次，
 * 並逐張核對圖上的訊號名稱、正負號、延遲的位置與取樣率是否和正文公式一致。
 *
 * 圖裡的數學一律是 LaTeX（使用者要求，2026-10-11）：
 *  - 節點與連線的雙引號標籤裡，數學寫 `$...$`、文字照常寫，例如 A["誤差 $e[n]$"]、X -- "$\mu$" --> Y；共用的 <Mermaid> 元件會用 KaTeX 排版
 *    （同一個標籤裡的文字與公式會合併成單一的 `$$...$$`，所以 `<br/>` 分行、文字混公式都可以）。
 *  - 原始碼用 String.raw 樣板字串，TeX 的反斜線只寫一次；標籤內不可以用 `\\`（Mermaid 會把它收成一個反斜線）。
 *  - 標籤裡的 "<" 一律寫 `\lt`（寫 `<` 會被 Mermaid 轉成 `&lt;` 而讓 KaTeX 出錯）；">" 寫 `\gt`；卷積的星號寫 `\ast`。
 *  - 正負號：加法點是全形「＋」；連線標籤單獨的正號／負號直接寫全形「＋」與「−」（U+2212），
 *    標籤裡還有公式時負號也放進公式：`$-$（回授 $\varphi_{\mathrm{fb}} = L\,e_{\mathrm{PD}}$）`（文字裡的 U+2212 KaTeX 不認得）。
 *  - 標籤裡有公式時，整個標籤會變成 KaTeX 的 \text{…} 加公式：文字裡的「→」「§」「−」（U+2212）這類 KaTeX 文字模式不認得的符號
 *    會讓 KaTeX 在 console 警告，所以寫成 `$\to$`、`$\S$`、`$-$`（沒有公式的純文字標籤不經過 KaTeX，照寫即可）；圈號 ①②… 例外，照寫（KaTeX 只警告，仍照原樣畫出）。
 *  - 其餘的 Mermaid 限制不變：標籤不要以 ">"、"1. "、"# " 開頭；sequenceDiagram 的訊息文字不可含 ";" 與 "#"；
 *    進加法點的每一條線都以「＋」或「−」（或 `$-$`）開頭。
 *  - sequenceDiagram：訊息與 Note 的公式要寫成完整的 `$$...$$`（一則訊息只能有一段，文字用 \text{}）；
 *    participant 名稱與 loop 標題不支援公式（真的畫一次會殘留 `$$` 或把 HTML 拆壞），所以那兩處只用文字，不放符號。
 *  - 圖內極性一律 δ = a − w；sample 索引 n、block 索引 k；e_PD 已含雜訊 v（q = sign(e_PD)）。
 *  - 架構照全站約定（docs/assumptions.md §2a）：DTC 在 reference 輸入端，「DTC 誤差 ε」從 PD 的 reference 輸入（加法點的＋）進來，
 *    回授 φ_fb 經 divider 從 feedback 輸入（加法點的−）進來，所以 e_PD = ε − φ_fb = H_PD·ε（正號）；回授路徑裡沒有 DTC。
 *    校正迴路（comparator／GMAC）的輸入取自 PD 的輸出，也就是送進 loop filter 的同一個訊號。
 *  - 圖說與正文不描述「左邊／右邊」這類由自動排版決定的位置（除非連線方向保證它），改用方塊的名稱或顏色指認。
 *
 * 版面（docs/teaching-style.md §8）：桌機（1280px）上每張圖要放進正文欄、不橫向捲動，自然寬度約 1260px 以內（`node scripts/diagram-audit.mjs --routes /ch/06`）。
 *  - 太寬的圖用 `<br/>` 把長標籤換行（含公式的標籤不會自動換行；沒有公式的標籤超過約 200px 才自動換行）；圖 6.10 是兩個 subgraph 各排成一列、上下疊
 *    （`T1 ~~~ T2` 是 subgraph 層級的隱形連線；subgraph 裡只要有節點連到外面，它自己的 direction 就會失效，所以列與列之間不能有節點對節點的連線）。
 *  - 有回授的圖（圖 6.4）把回授的終點節點放在最前面宣告：Mermaid（dagre）會把「走回頭」的那條連線找出來反轉，宣告順序決定它選哪一條，
 *    先宣告回授的終點，回授線就會沿著旁邊繞回上面，不會穿過別的方塊。
 *  - 時序圖（圖 6.24）的寬度由 participant 之間的訊息寬度決定：訊息在 `$$...$$` 裡用 `\begin{gathered}…\cr…\end{gathered}` 分行；
 *    `Note over 單一 participant` 的寬度是照原始碼的字數算的（和公式畫出來多寬無關），所以那一行的 TeX 要寫短、不換行；`Note right of` 則照畫出來的寬度算。
 *
 * 圖說（caption）同樣支援 `$...$`；逐項的「圖上的 X 就是公式裡的 x」對照寫在圖下方的正文（<ChapterDiagram> 的 children）。
 */

/** 本章共用的節點配色（深淺主題都看得清楚）：focus = 本圖主角、warn = 極性出錯、ok = 正常、zero = 沒有資訊／邊界。 */
const STYLE = `  classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff
  classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff
  classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff
  classDef zero fill:#8a5a00,stroke:#5c3c00,color:#ffffff`

/* ───────────────────────────── §1 ───────────────────────────── */

/** 圖 6.1：§1 的比喻畫成訊號流——你推的（x）和 comparator 看到的（u）走不同的路，相乘平均後的正負號決定方向。 */
export const CHART_TWO_PATHS = String.raw`flowchart TB
  X["你喊的口令<br/>code $x[n]$"] --> H["山谷 = 主 PLL 的誤差路徑 $h$<br/>變小聲，而且晚到"]
  H -- "回音 $u[n]$" --> M(("$\times$"))
  X -- "原始 $x[n]$（沒經過山谷）" --> M
  M -- "$x[n]\,u[n]$" --> AVG["對很多拍取平均"]
  AVG --> C{"平均值 $C$ 的正負"}
  C -- "正：回音大致同拍" --> OK["判斷正確<br/>往真實 gain $a$ 修正"]
  C -- "負：回音晚了大半拍" --> BAD["判斷相反<br/>越修越遠"]
${STYLE}
  class H focus
  class OK ok
  class BAD warn`

/* ───────────────────────────── §2 ───────────────────────────── */

/** 圖 6.2：卷積 u = h∗x 畫成 tapped delay line（z⁻¹ = 延遲一個 sample）。 */
export const CHART_TAPPED_DELAY = String.raw`flowchart TB
  X["輸入 $x[n]$"] --> G0["$\times\,h[0]$"]
  X --> Z1["$z^{-1}$"]
  Z1 -- "$x[n-1]$" --> G1["$\times\,h[1]$"]
  Z1 --> Z2["$z^{-1}$"]
  Z2 -- "$x[n-2]$" --> G2["$\times\,h[2]$，之後依此類推"]
  G0 -- "＋" --> S(("＋"))
  G1 -- "＋" --> S
  G2 -- "＋" --> S
  S --> U["輸出 $u[n] = h[0]\,x[n] + h[1]\,x[n-1] + h[2]\,x[n-2] + \cdots$"]
${STYLE}
  class Z1,Z2 focus`

/**
 * 圖 6.3：DTC 在 reference 輸入端，它的殘餘誤差 ε 從 PD 的 reference 輸入（＋）進來，divider 的回授 φ_fb 從 feedback 輸入（−）進來
 * （全站約定，docs/assumptions.md §2a）；加法點就是 PD，e_PD = ε − φ_fb。同一個迴路的兩個輸出 H_PD = 1/(1+L) 與 T = L/(1+L)，都是正號。
 * 回授路徑（L 那一塊）裡只有 loop filter、DCO、divider，沒有 DTC。輸出 1 是 PD 的輸出，也是校正迴路的 comparator 取訊號的地方。
 */
export const CHART_PLL_INJECTION = String.raw`flowchart TB
  EPS["reference 端 DTC 的殘餘時間誤差 $\varepsilon$<br/>從 PD 的 reference 輸入端進來"] -- "＋" --> SUM(("＋"))
  SUM -- "$e_{\mathrm{PD}} = \varepsilon - \varphi_{\mathrm{fb}}$" --> L["開迴路 $L$<br/>loop filter $\to$ DCO 積分 $\to$ divider<br/>回到 PD 的 feedback 輸入端"]
  L -- "$-$（回授 $\varphi_{\mathrm{fb}} = L\,e_{\mathrm{PD}}$）" --> SUM
  SUM -- "從這裡看" --> O1["輸出 1：PD 的輸出（殘差），comparator 取這裡<br/>$e_{\mathrm{PD}} = \varepsilon/(1+L) = H_{\mathrm{PD}}\,\varepsilon$"]
  L -- "從這裡看" --> O2["輸出 2：PLL 追掉的部分<br/>$\varphi_{\mathrm{fb}} = \varepsilon L/(1+L) = T\,\varepsilon$"]
  O1 -.- NOTE["同一個迴路的兩個輸出：$H_{\mathrm{PD}} + T = 1$<br/>低頻 $L$ 很大：$H_{\mathrm{PD}}$ 趨近 0，$T$ 趨近 1<br/>高頻 $L$ 趨近 0：$H_{\mathrm{PD}}$ 趨近 1，$T$ 趨近 0"]
  O2 -.- NOTE
${STYLE}
  class O1 focus`

/**
 * 圖 6.4：完整的誤差路徑——DTC 誤差 → H_PD → PD 的輸出 → comparator → GMAC（乘原始 x[n−D]）→ 更新 w。
 * 對應 F-06.1 e_PD[n] ≈ (a − w_k)·u[n] + v[n] 與 §3 的 G_k = (1/N) Σ q[n]·x[n−D]、w_(k+1) = w_k + μ·G_k。
 * 校正迴路的輸入取自 PD 的輸出（藍色方塊的輸出，也就是送進 loop filter 的同一個訊號；docs/assumptions.md §2a 第 3 點），
 * 再加上 comparator 前的雜訊 v 才是 comparator 的輸入 e_PD。
 */
export const CHART_ERROR_PATH = String.raw`flowchart TB
  W["校正值 $w_k$<br/>每個 block 更新一次"]
  A["真實 gain $a$"]
  A -- "＋" --> DS(("＋"))
  W -- "−" --> DS
  DS -- "$\delta_k = a - w_k$" --> MUL(("$\times$"))
  X["code $x[n]$"] --> MUL
  MUL -- "DTC 誤差 $\varepsilon[n] = \delta_k\,x[n]$" --> HPD["主 PLL 的誤差路徑<br/>PD 的 reference 輸入 $\to$ PD 的輸出<br/>$H_{\mathrm{PD}} = 1/(1+L)$"]
  HPD -- "＋ PD 的輸出（約等於 $\delta_k\,u[n]$，$u = h \ast x$）" --> ADD(("＋"))
  V(["comparator 前的雜訊 $v[n]$"]) -- "＋" --> ADD
  ADD -- "$e_{\mathrm{PD}}[n]$" --> CMP["1-bit comparator<br/>$q[n] = \operatorname{sign}(e_{\mathrm{PD}}[n])$"]
  CMP -- "$q[n] = \pm 1$" --> COR(("$\times$"))
  X --> DLY["GMAC 的 code delay<br/>$z^{-D}$"]
  DLY -- "原始 $x[n-D]$，沒經過 $H_{\mathrm{PD}}$" --> COR
  COR --> AVG["GMAC：每 $N$ 個 sample 平均一次<br/>$G_k = \frac{1}{N}\sum q[n]\,x[n-D]$"]
  AVG -- "$G_k$" --> UPD["更新 $w_{k+1} = w_k + \mu\,G_k$"]
  UPD -- "下一個 block 才生效" --> W
${STYLE}
  class HPD focus
  class COR warn`

/* ───────────────────────────── §3 ───────────────────────────── */

/** 圖 6.5：GMAC 的平均輸出——comparator 的平均特性（erf）在小訊號是一條斜率 K_q 的直線，大誤差時飽和。 */
export const CHART_GMAC_MEAN = String.raw`flowchart TB
  ED["誤差的確定部分<br/>$e_{\mathrm{det}}[n] = \delta_k\,u[n]$"] --> ERF["comparator 的平均輸出<br/>$E[q] = \mathrm{erf}\big(e_{\mathrm{det}}/(\sqrt{2}\,\sigma_v)\big)$"]
  ERF -- "小訊號：約等於 $K_q\,e_{\mathrm{det}}[n]$" --> M(("$\times$"))
  XD["GMAC 的 regressor<br/>$x[n-D]$"] --> M
  M --> AVG["block 平均 $\frac{1}{N}\sum$"]
  AVG --> EG["$E[G_k] \approx K_q\,\delta_k\,C_D$<br/>$C_D = x[n-D]\,u[n]$ 的平均"]
  ERF -. "大誤差：$\mathrm{erf}$ 飽和成 $\pm 1$" .-> SAT["只剩正負號<br/>平均更新不再和 $\delta$ 成正比（$\S$6.4 但書 1）"]
${STYLE}
  class EG focus
  class SAT zero`

/** 圖 6.6：平均更新的一階迴圈 E[δ_(k+1)] = E[δ_k] − μ·K_q·C·E[δ_k]（block rate）。 */
export const CHART_POLE_LOOP = String.raw`flowchart LR
  D["平均誤差 $E[\delta_k]$"] -- "＋" --> S(("＋"))
  D --> KC["$\times\,K_qC$"]
  KC -- "$E[G_k]$" --> MU["$\times\,\mu$"]
  MU -- "−" --> S
  S -- "$E[\delta_{k+1}]$" --> Z["$z^{-1}$<br/>等一個 block"]
  Z --> D
${STYLE}
  class KC focus`

/** 圖 6.7：C 的決策樹——C > 0 小 μ 收斂、C = 0 沒有資訊、C < 0 任何 μ 都發散。 */
export const CHART_C_DECISION = String.raw`flowchart TB
  Q{"相關 $C$ 是正、零還是負？<br/>$C = x[n-D]\,u[n]$ 的平均"}
  Q -- "$C \gt 0$" --> P1["$p = 1 - \mu K_qC$，小於 1"]
  Q -- "$C = 0$" --> P2["$p = 1$"]
  Q -- "$C \lt 0$" --> P3["$p = 1 + \mu K_q|C|$，大於 1"]
  P1 --> R1["$0 \lt \mu \lt 2/(K_qC)$ 時平均收斂<br/>$\mu$ 決定速度與雜訊"]
  P2 --> R2["沒有恢復力：$w$ 隨雜訊 random walk<br/>GMAC 裡沒有 $\delta$ 的資訊"]
  P3 --> R3["任何 $\mu \gt 0$ 都平均發散<br/>$\mu$ 只改速度，改不了方向"]
  R3 --> FIX["要改的是 $C$ 本身<br/>delay alignment 或 filtered-x（第 07 章）"]
${STYLE}
  class R1 ok
  class R2 zero
  class R3 warn`

/* ───────────────────────────── §4 ───────────────────────────── */

/** 圖 6.8：單頻的相量流程——x → |H|∠φ → u → 乘 x[n−D] → 平均 → (A²/2)|H|cos(φ+ΩD)。 */
export const CHART_TONE_FLOW = String.raw`flowchart TB
  X["單頻 code<br/>$x[n] = A\cos(\Omega n)$"] --> H["主 PLL 路徑在頻率 $\Omega$ 的響應<br/>振幅 $\times\,|H|$，相位 $+\,\phi$"]
  X --> DL["GMAC 的 code delay $z^{-D}$<br/>相位 $-\,\Omega D$"]
  H -- "$u[n] = A\,|H|\cos(\Omega n + \phi)$" --> M(("$\times$"))
  DL -- "$x[n-D] = A\cos(\Omega n - \Omega D)$" --> M
  M -- "積化和差" --> DC["常數項<br/>$\frac{A^2}{2}|H|\cos(\phi + \Omega D)$"]
  M -- "積化和差" --> AC["兩倍頻項<br/>$\frac{A^2}{2}|H|\cos(2\Omega n + \phi - \Omega D)$"]
  DC -- "留下來" --> AVG["block 平均 $\frac{1}{N}\sum$"]
  AC -- "平均成 0" --> AVG
  AVG --> C["$C_D = \frac{A^2}{2}|H|\cos(\phi + \Omega D)$<br/>正負號只看 $\cos(\phi + \Omega D)$"]
${STYLE}
  class H focus
  class C focus`

/** 圖 6.9：單頻公式的適用範圍（E46）——Ω 在 (0, π) 內、等於 0 或 π、或靠近邊界而 N 有限。 */
export const CHART_TONE_EDGES = String.raw`flowchart TB
  P["每個 sample 的乘積<br/>$x[n-D]\,u[n] = \frac{A^2|H|}{2}\big(\cos(\phi + \Omega D) + \cos(2\Omega n + \phi - \Omega D)\big)$"]
  P --> Q{"$\Omega$ 落在哪裡？<br/>GMAC 一個 block 平均幾個 sample？"}
  Q -- "$0 \lt \Omega \lt \pi$，而且 $N$ 夠大" --> A1["兩倍頻項平均成 0<br/>$C_D = \frac{A^2}{2}|H|\cos(\phi + \Omega D)$"]
  Q -- "$\Omega = 0$ 或 $\pi$" --> A2["$2\Omega n$ 是 $2\pi$ 的整數倍<br/>兩倍頻項變成常數，不會平均掉<br/>$C_D = A^2 H\cos(\Omega D)$：一般式的 2 倍"]
  Q -- "$\Omega$ 靠近 0 或 $\pi$，$N$ 有限" --> A3["兩倍頻項來不及平均掉<br/>ripple 上界 $\frac{A^2|H|}{2}\min\big(1,\,1/(N|\sin\Omega|)\big)$<br/>單一 block 的符號可能翻"]
${STYLE}
  class A1 ok
  class A2 zero
  class A3 warn`

/* ───────────────────────────── §5 ───────────────────────────── */

/**
 * 圖 6.10：Type-I 與 Type-II 的比較（CT 原型）——一個積分器 vs 兩個；低頻看到一次微分 vs 二次微分。
 * 版面：兩個 subgraph 上下疊（Type-I 在上），各自 direction LR 排成一列；`T1 ~~~ T2` 是 subgraph 層級的隱形連線，只負責叫 Mermaid 把兩列上下排，
 * 而不是節點對節點的連線（那樣會讓 subgraph 內的 direction 失效）。左右並排的話整張圖寬約 1260px，字會被縮到 70%。
 */
export const CHART_LOOP_TYPES = String.raw`flowchart TB
  subgraph T1["Type-I：迴路裡一個積分器"]
    direction LR
    E1["DTC 誤差 $\varepsilon$"] -- "＋" --> S1(("＋"))
    S1 -- "$e_{\mathrm{PD}}$" --> K1["比例增益 $\omega_c$"]
    K1 --> I1["DCO：積分 $1/s$"]
    I1 -- "$-\varphi_{\mathrm{fb}}$" --> S1
    S1 -. "從 $e_{\mathrm{PD}}$ 看" .-> R1["$H_{\mathrm{PD}} = s/(s + \omega_c)$<br/>低頻約 $s/\omega_c$：一次微分<br/>$\operatorname{Re}H$ 恆正：只會變慢"]
  end
  subgraph T2["Type-II：迴路裡兩個積分器"]
    direction LR
    E2["DTC 誤差 $\varepsilon$"] -- "＋" --> S2(("＋"))
    S2 -- "$e_{\mathrm{PD}}$" --> PI["PI 濾波器：比例 + 積分<br/>$2\zeta\omega_n + \omega_n^2/s$"]
    PI --> I2["DCO：積分 $1/s$"]
    I2 -- "$-\varphi_{\mathrm{fb}}$" --> S2
    S2 -. "從 $e_{\mathrm{PD}}$ 看" .-> R2["$H_{\mathrm{PD}} = s^2/(s^2 + 2\zeta\omega_n s + \omega_n^2)$<br/>低頻約 $s^2/\omega_n^2$：二次微分<br/>$\omega \lt \omega_n$ 時 $\operatorname{Re}H$ 為負：會變號"]
  end
  T1 ~~~ T2
${STYLE}
  class PI focus
  class R1 ok
  class R2 warn`

/** 圖 6.11：Type-II 在低頻像二次微分器——C ≈ E[x·x″]/ω_n² = −E[(x′)²]/ω_n² < 0；Type-I 只微分一次。 */
export const CHART_DOUBLE_DIFF = String.raw`flowchart TB
  X["慢速 code $x(t)$<br/>頻率遠低於 $\omega_n$"] --> D1["微分 $d/dt$"]
  D1 -- "$x'$" --> D2["再微分 $d/dt$"]
  D2 -- "$x''$" --> G["$\times\,1/\omega_n^2$"]
  G -- "PD 看到 $u \approx x''/\omega_n^2$" --> M(("$\times$"))
  X -- "GMAC 乘的是原始 $x$" --> M
  M --> AVG["時間平均"]
  AVG --> C["$C \approx E[x\,x'']/\omega_n^2 = -E[(x')^2]/\omega_n^2$<br/>一定是負的"]
  D1 -. "Type-I 只微分一次：$u \approx x'/\omega_c$" .-> T1["$E[x\,x'] = 0$<br/>一階沒有相關，二階才出現正的小量"]
${STYLE}
  class D2 focus
  class C warn
  class T1 ok`

/** 圖 6.12：網站用的 DT Type-II 迴路（F-06.10）——PI（比例 + 累加器）、latency z^−d、DCO z⁻¹/(1−z⁻¹)。 */
export const CHART_DT_LOOP = String.raw`flowchart TB
  E["DTC 誤差 $\varepsilon[n]$"] -- "＋" --> S(("＋"))
  S -- "$e_{\mathrm{PD}}[n]$" --> KP["比例路徑 $K_p$"]
  S -- "$e_{\mathrm{PD}}[n]$" --> KI["積分路徑：累加器<br/>$K_i/(1 - z^{-1})$"]
  KP -- "＋" --> S2(("＋"))
  KI -- "＋" --> S2
  S2 --> ZD["額外 latency $z^{-d}$"]
  ZD --> DCO["DCO：把控制量累加成相位，下一拍才生效<br/>$z^{-1}/(1 - z^{-1})$"]
  DCO -- "$-\varphi_{\mathrm{fb}}[n]$" --> S
${STYLE}
  class KI,DCO focus`

/** 圖 6.13：CT 原型 ↔ DT 迴路的對應（E44）——積分器、PI 係數、頻率軸、延遲，以及什麼時候 CT 夠準。 */
export const CHART_CT_DT_MAP = String.raw`flowchart LR
  C1["CT：積分器 $1/s$"] -- "$1 - z^{-1} \approx s\,T_s$" --> D1["DT：累加器 $1/(1 - z^{-1})$"]
  C2["CT：PI 濾波器<br/>$2\zeta\omega_n + \omega_n^2/s$"] -- "係數乘 $T_s$、$T_s^2$" --> D2["DT：$K_p + K_i/(1 - z^{-1})$<br/>$K_p = 2\zeta\omega_nT_s$<br/>$K_i = (\omega_nT_s)^2$"]
  C3["CT：頻率 $\omega$<br/>單位 rad/s"] -- "$\Omega = \omega T_s$" --> D3["DT：$\Omega$，單位 rad/sample<br/>在單位圓 $z = e^{j\Omega}$ 上求值"]
  C4["CT：迴路沒有延遲"] -- "真實迴路多出" --> D4["DT：$z^{-(1+d)}$<br/>DCO 一拍，再加 latency $d$ 拍"]
  D1 --> V{"$\omega_nT_s$ 遠小於 1<br/>而且 $d = 0$？"}
  D2 --> V
  D3 --> V
  D4 --> V
  V -- "是" --> Y["CT 原型夠準<br/>Type-II 的變號邊界<br/>在 $\omega_n$"]
  V -- "否" --> N["DT 的相位多轉一些<br/>邊界移到<br/>約 1.00 到 1.49 倍 $\omega_n$（E44）"]
${STYLE}
  class D1,D2,D3,D4 focus
  class Y ok
  class N zero`

/**
 * 圖 6.14：手算題 HC-06.6 的計算順序——由 −3 dB 頻寬求 ω_n·T_s，再算 K_p、K_i 與 code 的 ν（圈號 = 手算題的步驟編號）。
 * ν 和 1 比用的是 CT 原型的邊界（F-06.8）；DT 的邊界略高於 1（E44，圖 6.13）。
 */
export const CHART_BW_FLOW = String.raw`flowchart TB
  IN["輸入：$f_{\mathrm{ref}}$、$-3\,\mathrm{dB}$ 頻寬 $\mathrm{BW}$、$\zeta$、code 的頻率 $f$"] --> R["① $\mathrm{BW}/f_{\mathrm{ref}}$"]
  IN --> B["② $\beta = 1 + 2\zeta^2$<br/>③ $\sqrt{\beta^2 + 1}$"]
  B --> C3["④ $c_{3\mathrm{dB}} = \omega_{3\mathrm{dB}}/\omega_n = \sqrt{\beta + \sqrt{\beta^2 + 1}}$"]
  R --> WN["⑤ $\omega_nT_s = 2\pi\,(\mathrm{BW}/f_{\mathrm{ref}})/c_{3\mathrm{dB}}$"]
  C3 --> WN
  WN --> KP["⑥ $K_p = 2\zeta\,\omega_nT_s$"]
  WN --> KI["⑦ $K_i = (\omega_nT_s)^2$"]
  IN --> OM["⑧ $\Omega = 2\pi f/f_s$，$f_s = f_{\mathrm{ref}}$"]
  WN --> NU["⑨ $\nu = \Omega/(\omega_nT_s)$"]
  OM --> NU
  NU --> Q{"$\nu$ 和 1 比"}
  Q -- "$\nu$ 小於 1" --> NEG["這個頻率落在 Type-II 的反相頻帶<br/>$\operatorname{Re}H$ 為負：單頻 code 的 raw-$x$ 會變號"]
  Q -- "$\nu$ 大於 1" --> POS["這個頻率在 $\omega_n$ 以上<br/>CT 原型的 $\operatorname{Re}H$ 為正（DT 的邊界略高於 1）"]
${STYLE}
  class WN,NU focus
  class NEG warn
  class POS ok`

/* ───────────────────────────── §6 ───────────────────────────── */

/** 圖 6.15：頻譜加權——每條譜線的功率乘上該頻率的 Re H，全部加起來就是 C。 */
export const CHART_SPECTRAL_WEIGHT = String.raw`flowchart LR
  L1["低頻的譜線 $\Omega_1$（低於 $\omega_nT_s$）<br/>功率 $P_1$"] --> M1["$\times\operatorname{Re}H(\Omega_1)$<br/>Type-II：負的"]
  L2["$\omega_nT_s$ 附近的譜線 $\Omega_2$<br/>功率 $P_2$"] --> M2["$\times\operatorname{Re}H(\Omega_2)$<br/>Type-II：接近 0"]
  L3["高頻的譜線 $\Omega_3$（遠高於 $\omega_nT_s$）<br/>功率 $P_3$"] --> M3["$\times\operatorname{Re}H(\Omega_3)$<br/>接近 $+1$"]
  M1 -- "＋（值為負）" --> S(("＋"))
  M2 -- "＋" --> S
  M3 -- "＋（值為正）" --> S
  S --> C["$C = P_1\operatorname{Re}H(\Omega_1) + P_2\operatorname{Re}H(\Omega_2) + P_3\operatorname{Re}H(\Omega_3)$<br/>連續頻譜：$C = \frac{1}{2\pi}\int S_{xx}\operatorname{Re}H\,d\Omega$"]
${STYLE}
  class M1 warn
  class M3 ok
  class C focus`

/** 圖 6.16：一般式的兩個精確特例——白色 code（只剩 h[D]）與單頻 code（回到 §4）。 */
export const CHART_SPECIAL_CASES = String.raw`flowchart TB
  G["一般式的兩種寫法<br/>$C_D = \sum_k h[k]\,R_x[k-D] = \frac{1}{2\pi}\int S_{xx}\operatorname{Re}\big(H e^{j\Omega D}\big)\,d\Omega$"]
  G -- "白色 code：$R_x$ 只在間隔 0 不為零" --> W["只剩 $k = D$ 那一項<br/>$C_D = h[D]\,\sigma_x^2$"]
  W --> W0["$D = 0$：$h[0] = 1$<br/>$C = \sigma_x^2$，一定是正的"]
  G -- "單頻 code：$S_{xx}$ 只有兩條線" --> T["$C_D = \frac{A^2}{2}|H|\cos(\phi + \Omega_0 D)$<br/>就是 $\S$4 的單頻公式"]
${STYLE}
  class W0 ok`

/** 圖 6.17：時域路線（F-06.12）與頻域路線（F-06.11）算的是同一個 C_D。 */
export const CHART_TWO_ROUTES = String.raw`flowchart TB
  P["主 PLL 的誤差路徑 $H_{\mathrm{PD}}$"]
  X["code $x[n]$"]
  HK["脈衝響應 $h[k]$"]
  RX["自相關 $R_x[\ell]$"]
  HW["頻率響應 $H(e^{j\Omega})$"]
  TD["時域路線<br/>$\sum_k h[k]\,R_x[k-D]$"]
  SXX["功率頻譜 $S_{xx}$"]
  FD["頻域路線<br/>$\frac{1}{2\pi}\int S_{xx}\operatorname{Re}\big(H e^{j\Omega D}\big)\,d\Omega$"]
  C["同一個 $C_D$"]
  P --> HW
  P --> HK
  X --> SXX
  X --> RX
  HK <-. "DTFT" .-> HW
  RX <-. "Wiener–Khinchin" .-> SXX
  HK --> TD
  RX --> TD
  SXX --> FD
  HW --> FD
  TD --> C
  FD --> C
${STYLE}
  class C focus`

/** 圖 6.18：近整數 FCW 把 regressor 的能量搬進 Type-II 的反相頻帶（Δ = Ω₀/(ω_n·T_s) ≪ 1）。 */
export const CHART_NEAR_INTEGER = String.raw`flowchart TB
  FCW["FCW = 整數 + $\mathrm{frac}$<br/>$\mathrm{frac}$ 很小：近整數"] --> DSM["一階 DSM 累加器"]
  DSM --> SAW["residue $x[n]$ 是慢鋸齒<br/>每 $1/\mathrm{frac}$ 個 sample 折返一次"]
  SAW --> F0["基頻 $\Omega_0 = 2\pi\,\mathrm{frac}$<br/>第 $k$ 次諧波的功率正比於 $1/k^2$"]
  F0 --> Q{"$\Delta = \Omega_0/(\omega_nT_s)$<br/>和 1 比"}
  Q -- "$\Delta$ 遠大於 1" --> OUT["所有諧波都在迴路頻寬外<br/>$\operatorname{Re}H$ 接近 $+1$：$C$ 接近 $\sigma_x^2$"]
  Q -- "$\Delta$ 遠小於 1：近整數" --> IN["低次諧波掉進 $\operatorname{Re}H$ 為負的頻帶<br/>regressor 的能量被搬進反相頻帶"]
  IN --> NET["低頻的負貢獻，和折返跳變帶來的高頻尾巴（正）<br/>幾乎抵消：$C/\sigma_x^2 \approx \frac{3}{\pi^2}\Delta^2$，是很小的正數"]
${STYLE}
  class IN warn
  class NET zero
  class OUT ok`

/** 圖 6.19：近整數時的三層結論——D = 0 小訊號不變號、誤差超過 δ_c 變號、D > frac/K_i 小訊號就變號。 */
export const CHART_NEAR_INTEGER_TREE = String.raw`flowchart TB
  S0["近整數 FCW + Type-II<br/>主迴路 + 一階 DSM 鋸齒"] --> Q1{"GMAC 的 code delay $D$？"}
  Q1 -- "$D = 0$：完全對齊" --> Q2{"誤差 $|\delta|$ 和<br/>basin 半徑 $\delta_c$ 比"}
  Q1 -- "$1 \le D \le d+1$：<br/>regressor 落後" --> Q3{"$D$ 和門檻<br/>$\mathrm{frac}/K_i$ 比"}
  Q2 -- "$|\delta|$ 小於 $\delta_c$" --> A1["小訊號：<br/>$C/\sigma_x^2 \approx 12\,\mathrm{frac}^2/K_i$<br/>正的但趨近 0：不變號<br/>恢復力消失"]
  Q2 -- "$|\delta|$ 大於 $\delta_c$" --> A2["但書 1：comparator 飽和<br/>平均更新反向，離開 basin"]
  Q3 -- "$D$ 大於 $\mathrm{frac}/K_i$" --> A3["但書 2：<br/>$C_D/\sigma_x^2 \approx -12\,\mathrm{frac}\,D + 12\,\mathrm{frac}^2/K_i$<br/>負的：小訊號就變號"]
  Q3 -- "$D$ 小於 $\mathrm{frac}/K_i$" --> A4["$C_D$ 仍是正的：還沒翻"]
${STYLE}
  class A1 zero
  class A2,A3 warn
  class A4 ok`

/** 圖 6.20：鋸齒自相關 F-06.17 的來源——過了 ℓ 個 sample 有沒有折返；一次項來自折返。 */
export const CHART_SAW_AUTOCORR = String.raw`flowchart TB
  TH["現在的鋸齒相位 $\theta$：0 到 1 均勻分布<br/>$x[n] = \theta - \frac{1}{2}$"] --> ADV["過了 $\ell$ 個 sample<br/>相位前進 $t = \ell\,\mathrm{frac}$ 的小數部分"]
  ADV --> Q{"$\theta + t$ 超過 1 了嗎？"}
  Q -- "沒有（機率 $1 - t$）" --> NW["沒折返<br/>$x[n+\ell] = \theta + t - \frac{1}{2}$"]
  Q -- "有（機率 $t$）" --> WR["折返：多一個 $-1$<br/>$x[n+\ell] = \theta + t - \frac{3}{2}$"]
  NW --> AV["對 $\theta$ 平均 $x[n]\,x[n+\ell]$"]
  WR --> AV
  AV --> R["$R_x[\ell]/\sigma_x^2 = 1 - 6t(1 - t)$<br/>$t$ 很小時約 $1 - 6t$：一次項來自折返"]
${STYLE}
  class WR warn
  class R focus`

/** 圖 6.21：方法 1 的動差展開——自相關的常數／一次／二次項各乘上 m₀、m₁、m₂；Type-II 的 m₀ = m₁ = 0。 */
export const CHART_MOMENTS = String.raw`flowchart TB
  R["近整數時的鋸齒自相關<br/>$R_x[k]/\sigma_x^2 \approx 1 - 6\,\mathrm{frac}\,k + 6\,\mathrm{frac}^2k^2$"]
  R --> T0["常數項 $1$<br/>乘上 $m_0$ = 所有 $h[k]$ 的和"]
  R --> T1["一次項 $-6\,\mathrm{frac}\,k$<br/>乘上 $m_1$ = $k\,h[k]$ 的和"]
  R --> T2["二次項 $+6\,\mathrm{frac}^2k^2$<br/>乘上 $m_2$ = $k^2h[k]$ 的和"]
  T0 -- "＋（Type-II：$m_0 = 0$，DC 被追掉）" --> S(("＋"))
  T1 -- "＋（Type-II：$m_1 = 0$，斜坡也被追掉）" --> S
  T2 -- "＋（$m_2 = 2/K_i$）" --> S
  S --> C["$C/\sigma_x^2 \approx 12\,\mathrm{frac}^2/K_i = \frac{3}{\pi^2}\Delta^2$<br/>只剩一個正的二階小量"]
${STYLE}
  class T0,T1 zero
  class C focus`

/** 圖 6.22：但書 1——步階響應的正瓣（高窄）先被 erf 壓扁，負瓣（矮長）勝出，E[G] 在 δ_c 變號。 */
export const CHART_STEP_LOBES = String.raw`flowchart TB
  J["鋸齒折返一次<br/>等於在 PD 前加一個步階"] --> SR["Type-II 的步階響應 $s[k]$<br/>所有 $s[k]$ 加起來等於 0"]
  SR --> POS["正瓣：高而窄<br/>從 $s[0] = 1$ 開始"]
  SR --> NEG["負瓣：矮而長<br/>過衝之後慢慢回到 0"]
  POS --> E1["$|\delta u|$ 大：$\mathrm{erf}$ 先飽和<br/>正的貢獻被壓扁"]
  NEG --> E2["$|\delta u|$ 小：還在線性區<br/>負的貢獻隨 $\delta$ 等比例長大"]
  E1 -- "＋（值為正）" --> S(("＋"))
  E2 -- "＋（值為負）" --> S
  S --> R{"平均更新 $E[G]$ 和 $\delta$ 同號嗎？"}
  R -- "$|\delta|$ 小於 $\delta_c$：同號" --> A["把 $\delta$ 拉回 0"]
  R -- "$|\delta|$ 大於 $\delta_c$：反號" --> B["把 $\delta$ 往外推"]
${STYLE}
  class POS,A ok
  class NEG,B warn`

/** 圖 6.23：但書 2——regressor 落後 D ≥ 1 個 sample 時，折返尖峰乘到折返「前」的鋸齒頂部，抵消不掉。 */
export const CHART_DELAY_MISALIGN = String.raw`flowchart TB
  J["鋸齒折返：$x$ 從頂部跳到底部<br/>PD 當拍看到尖峰 $h[0] = 1$，之後是 PLL 追趕的尾巴（面積 $-1$）"]
  J --> D0["$D = 0$<br/>尖峰乘到折返之後的 $x$：底部"]
  J --> D1["$D$ 至少 1<br/>尖峰乘到折返之前的 $x$：頂部"]
  D0 --> R0["尾巴也乘到差不多同樣的底部值<br/>一階互相抵消，只剩 $+12\,\mathrm{frac}^2/K_i$"]
  D1 --> R1["頂部和底部差了一整個峰對峰<br/>抵消不掉，多出 $-12\,\mathrm{frac}\,D$"]
${STYLE}
  class R0 zero
  class R1 warn`

/* ───────────────────────────── §7 ───────────────────────────── */

/**
 * 圖 6.24：一個 GMAC block 的時序（sequenceDiagram）——loop 框內是 sample rate（索引 n，共 N 次），框外是 block rate（索引 k）。
 * 逐行對應 polarity.ts 的 simulateSignLmsChain（core:signLmsBlock）：
 *   d = a − w；e = pd.step(d·x[n]) + σ_v·noise；q = sign(e)；acc += q·ref[n]（ref[n] = x[n−D]）；G_k = acc/N；w += μ·G_k。
 * 訊息與 Note 的公式是完整的 `$$...$$`（文字用 \text{}）；participant 名稱與 loop 標題不支援公式，只用文字。
 * 架構（docs/assumptions.md §2a）：DTC 在 reference 輸入端；「主 PLL 的誤差路徑」的輸出就是 PD 的輸出，comparator 的輸入從那裡來。
 */
export const CHART_BLOCK_TIMING = String.raw`sequenceDiagram
  participant DTC as reference<br/>輸入端的 DTC
  participant PLL as 主 PLL 的誤差路徑<br/>（到 PD 的輸出）
  participant CMP as 1-bit comparator
  participant GMAC as GMAC 累加器
  participant W as 校正值的暫存器
  Note over DTC,W: $$\text{block }k\text{ 開始，這個 block 內 }w_k\text{ 固定，累加器 acc 歸零}$$
  loop sample rate，每個 sample 做一次，做滿一個 block 的 sample 數
    DTC->>PLL: $$\begin{gathered}\text{DTC 誤差 }\varepsilon[n]\cr = (a - w_k)\,x[n]\end{gathered}$$
    PLL->>CMP: $$\begin{gathered}e_{\mathrm{PD}}[n] =\cr (h \ast \varepsilon)[n] + v[n]\end{gathered}$$
    CMP->>GMAC: $$\begin{gathered}q[n] =\cr \operatorname{sign}(e_{\mathrm{PD}}[n])\end{gathered}$$
    Note right of GMAC: $$\begin{gathered}\mathrm{acc} \leftarrow\cr \mathrm{acc} + q[n]\,x[n-D]\end{gathered}$$
  end
  GMAC->>W: $$\begin{gathered}\text{block rate，}\cr \text{每個 block 一次，}\cr G_k = \mathrm{acc}/N\end{gathered}$$
  Note over W: $$w_{k+1}=w_k+\mu G_k$$
  W-->>DTC: $$\text{block }k+1\text{ 改用 }w_{k+1}$$`

/* ───────────────────────────── §8 ───────────────────────────── */

/** 圖 6.25：三種 GMAC regressor 並排——raw-x、delayed-x、filtered-x；差異的方塊標色。 */
export const CHART_REGRESSORS = String.raw`flowchart TB
  X["code $x[n]$"] --> M1(("$\times$"))
  X --> DL["延遲 $z^{-D}$"]
  X --> HH["主 PLL 的模型 $\hat h$"]
  DL -- "$x[n-D]$" --> M2(("$\times$"))
  HH -- "$u_f = \hat h \ast x$" --> M3(("$\times$"))
  Q["comparator 的 $q[n]$<br/>誤差裡的 code 是 $u = h \ast x$"] --> M1
  Q --> M2
  Q --> M3
  M1 -- "block 平均" --> C1["raw-x（本章）<br/>相關 $C = x\,u$ 的平均：<br/>可正可負"]
  M2 -- "block 平均" --> C2["delayed-x<br/>相關 $C_D = x[n-D]\,u[n]$ 的平均：<br/>只對準一個頻率"]
  M3 -- "block 平均" --> C3["filtered-x<br/>相關 = $u\,u_f$ 的平均：<br/>模型準時等於 $u^2$ 的平均，<br/>不會是負的"]
${STYLE}
  class DL,HH focus
  class C1 warn
  class C3 ok`

/** 圖 6.26：綜合手算 HC-06.8 的計算順序（圈號 = 手算題的步驟編號）。 */
export const CHART_HANDCALC_FLOW = String.raw`flowchart TB
  IN["輸入：$\mathrm{frac}$、$\omega_nT_s$、$d$、$D$、$\mu$、$\sigma_v$"] --> KI["① $K_i = (\omega_nT_s)^2$"]
  IN --> DEL["② $\Delta = 2\pi\,\mathrm{frac}/(\omega_nT_s)$<br/>遠小於 1 才算近整數"]
  IN --> TD["③ $t_D = D\,\mathrm{frac}$<br/>④ $R_x[D]/\sigma_x^2 = 1 - 6\,t_D(1 - t_D)$"]
  KI --> DS["⑤ 門檻 $D^\star = \mathrm{frac}/K_i$"]
  IN --> T1["⑥ 一階項 $-12\,\mathrm{frac}\,D$"]
  KI --> T2["⑦ 二階項 $+12\,\mathrm{frac}^2/K_i$"]
  T1 -- "＋" --> S(("＋"))
  T2 -- "＋" --> S
  S --> CD["⑧ $C_D/\sigma_x^2$ = ⑥ + ⑦"]
  DS -. "$D$ 大於 $D^\star$ 時 ⑧ 是負的" .-> CD
  IN --> KQ["⑨ $K_q = \sqrt{2/\pi}/\sigma_v$"]
  CD --> G["⑩ $g = \mu K_qC_D$"]
  KQ --> G
  G --> P["⑪ $p = 1 - g$<br/>$p$ 大於 1 就是平均發散"]
${STYLE}
  class CD focus
  class P focus`

/* ───────────────────────────── 登錄 ───────────────────────────── */

/** teaching-style §8 的圖種（timing = 時序圖；其餘都是 flowchart） */
export type DiagramKind = 'model' | 'loop' | 'path' | 'compare' | 'decision' | 'timing' | 'handcalc'

export interface ChapterDiagram {
  /** 'D-06.n'（依出現順序編號；頁面錨點為 #diagram-D-06.n） */
  id: string
  /** 圖號 '6.n' */
  no: string
  /** 所在的節（ChapterSection 的 id） */
  section: string
  kind: DiagramKind
  /** 短標題（純文字） */
  title: string
  /** 圖說：一句話說明要看什麼。符號寫成 `$...$`（<Mermaid caption> 會交給 KaTeX），不用 Unicode 拼公式。 */
  caption: string
  chart: string
}

type Def = Omit<ChapterDiagram, 'id' | 'no'>

const DEFS: Def[] = [
  {
    section: 'ch06-s1',
    kind: 'path',
    title: '你推的，和 comparator 看到的，走不同的路',
    caption: String.raw`看兩條路：原始 code $x[n]$ 直接送到乘法器，另一份先經過主 PLL（藍色）才變成回音 $u[n]$；兩者相乘平均後的正負號，決定校正往對的還是錯的方向走。`,
    chart: CHART_TWO_PATHS,
  },
  {
    section: 'ch06-s2',
    kind: 'model',
    title: '卷積就是一排延遲加權再相加',
    caption: String.raw`看藍色的延遲方塊：輸出 $u[n]$ 是「現在與過去幾拍的輸入」各乘上一個權重再加起來，權重 $h[k]$ 就是脈衝響應。`,
    chart: CHART_TAPPED_DELAY,
  },
  {
    section: 'ch06-s2',
    kind: 'loop',
    title: 'DTC 誤差從 PD 的 reference 輸入端進來，同一個迴路的兩個輸出',
    caption: String.raw`先看加法點，它就是 PD：DTC 的殘餘誤差從 reference 輸入（正號）進來，divider 的回授從 feedback 輸入（負號）進來，PD 的輸出是兩者相減，$e_{\mathrm{PD}}=\varepsilon-\varphi_{\mathrm{fb}}$；再看兩個輸出，從加法點後面看是 PD 的輸出（藍色，轉移函數 $H_{\mathrm{PD}}$，校正迴路的 comparator 取的就是它），從迴路後面看是 PLL 追掉的部分（轉移函數 $T$），兩者相加等於進來的誤差。`,
    chart: CHART_PLL_INJECTION,
  },
  {
    section: 'ch06-s2',
    kind: 'path',
    title: '完整的誤差路徑與校正迴路',
    caption: String.raw`跟著誤差走一圈：DTC 誤差從 PD 的 reference 輸入端進主 PLL（藍色），comparator 取的是 PD 的輸出，所以它看到的是被主 PLL 濾過的誤差；但 GMAC 的乘法器（紅色）拿的是沒經過主 PLL、只延遲過的原始 code $x[n-D]$。從 code 到紅色乘法器每個 sample $n$ 跑一次，GMAC 之後每個 block $k$ 才更新一次。`,
    chart: CHART_ERROR_PATH,
  },
  {
    section: 'ch06-s3',
    kind: 'model',
    title: 'GMAC 的平均輸出',
    caption: String.raw`看 comparator 那一塊：平均來說它把誤差通過一條 S 形曲線 $\mathrm{erf}$；誤差小時曲線是斜率 $K_q$ 的直線，GMAC 的平均輸出就正比於誤差乘上相關 $C_D$（藍色），誤差大時曲線飽和（虛線）。`,
    chart: CHART_GMAC_MEAN,
  },
  {
    section: 'ch06-s3',
    kind: 'loop',
    title: '平均誤差的一階迴圈',
    caption: String.raw`看藍色方塊的正負：$C>0$ 時，減號那條支路是負回授，誤差每個 block 縮小；$C<0$ 時負負得正，變成正回授。繞一圈的倍數就是 pole $p=1-\mu K_qC$。`,
    chart: CHART_POLE_LOOP,
  },
  {
    section: 'ch06-s3',
    kind: 'decision',
    title: '相關的正負決定三種結局',
    caption: String.raw`從上往下讀：只有 $C>0$ 時 learning rate $\mu$ 才有得選；$C=0$ 沒有資訊，$C<0$（紅色）時任何正的 $\mu$ 都發散，要改的是 $C$ 本身。`,
    chart: CHART_C_DECISION,
  },
  {
    section: 'ch06-s4',
    kind: 'path',
    title: '單頻的相量流程',
    caption: String.raw`看兩條支路各自加了多少相位：主 PLL 路徑加上 $\phi$，code delay 減掉 $\Omega D$；相乘後只有常數項撐過平均，它的正負號只看 $\cos(\phi+\Omega D)$。`,
    chart: CHART_TONE_FLOW,
  },
  {
    section: 'ch06-s4',
    kind: 'decision',
    title: '單頻公式什麼時候成立',
    caption: String.raw`看兩倍頻項的下場：一般情況平均成零（綠色）；$\Omega=0$ 或 $\pi$ 時它變成常數（公式變兩倍）；靠近這兩個頻率而 block 長度 $N$ 有限時，單一 block 的符號可能翻（紅色）。`,
    chart: CHART_TONE_EDGES,
  },
  {
    section: 'ch06-s5',
    kind: 'compare',
    title: 'Type-I 與 Type-II 的比較',
    caption: String.raw`比較兩個迴路裡的積分器數量：Type-I 只有 DCO 一個，Type-II 多了 PI 濾波器的積分（藍色）；所以低頻時 Type-I 的 PD 看到 code 的一次微分，Type-II 看到二次微分。`,
    chart: CHART_LOOP_TYPES,
  },
  {
    section: 'ch06-s5',
    kind: 'model',
    title: 'Type-II 在低頻像二次微分器',
    caption: String.raw`看藍色的第二次微分：PD 看到的是慢速 code 的彎曲程度 $u\approx x''/\omega_n^2$，它和原始 code 的相關一定是負的；虛線是只微分一次的 Type-I，一階相關剛好是零。`,
    chart: CHART_DOUBLE_DIFF,
  },
  {
    section: 'ch06-s5',
    kind: 'loop',
    title: '網站使用的離散時間 Type-II 迴路',
    caption: String.raw`找出兩個藍色的累加器（PI 的積分路徑與 DCO）：它們就是連續時間原型的兩個積分器；DCO 那一塊自帶一拍延遲 $z^{-1}$，它前面還串著 $d$ 拍的額外 latency $z^{-d}$。`,
    chart: CHART_DT_LOOP,
  },
  {
    section: 'ch06-s5',
    kind: 'compare',
    title: '連續時間原型與離散時間迴路的對應',
    caption: String.raw`四條有標籤的箭頭各連接一組對應：起點是連續時間原型的一項，終點（藍色）是它在離散時間迴路裡的樣子；最後的菱形說明什麼時候可以放心用連續時間的公式：$\omega_nT_s\ll1$ 而且 $d=0$。`,
    chart: CHART_CT_DT_MAP,
  },
  {
    section: 'ch06-s5',
    kind: 'handcalc',
    title: '從頻寬到迴路係數的計算順序',
    caption: String.raw`圈號就是手算題 HC-06.6 的步驟編號：先把 $-3\,\mathrm{dB}$ 頻寬換成自然頻率 $\omega_nT_s$（藍色），由它算出離散時間迴路的 $K_p$ 與 $K_i$；再把 code 的頻率換成 $\nu$（藍色），和 1 比，就知道它是不是落在 Type-II 的反相頻帶。`,
    chart: CHART_BW_FLOW,
  },
  {
    section: 'ch06-s6',
    kind: 'model',
    title: '頻譜加權',
    caption: String.raw`每一列是一條譜線：功率 $P_m$（一定是正的）乘上那個頻率的 $\operatorname{Re}H$（可正可負），三列加起來就是相關 $C$；低頻那一列（紅色）在 Type-II 是負的。`,
    chart: CHART_SPECTRAL_WEIGHT,
  },
  {
    section: 'ch06-s6',
    kind: 'decision',
    title: '兩個精確的特例',
    caption: String.raw`同一個一般式套到兩種最簡單的 code：白色 code 只剩脈衝響應的一個點 $h[D]$（$D=0$ 時一定為正，綠色），單頻 code 則回到上一節的公式。`,
    chart: CHART_SPECIAL_CASES,
  },
  {
    section: 'ch06-s6',
    kind: 'compare',
    title: '時域路線與頻域路線',
    caption: String.raw`一條路線走時域（自相關 $R_x$ 配脈衝響應 $h$），另一條走頻域（功率頻譜 $S_{xx}$ 配頻率響應 $H$）；虛線表示每一對都是同一件東西的兩種表示，所以最後得到同一個 $C_D$。`,
    chart: CHART_TWO_ROUTES,
  },
  {
    section: 'ch06-s6',
    kind: 'path',
    title: '近整數 FCW 把 regressor 的能量搬進反相頻帶',
    caption: String.raw`從上往下：FCW 的小數 $\mathrm{frac}$ 越小，residue 鋸齒越慢、基頻 $\Omega_0$ 越低；$\Delta\ll1$ 時（紅色），低次諧波掉進 $\operatorname{Re}H<0$ 的頻帶，和高頻尾巴的正貢獻幾乎抵消。`,
    chart: CHART_NEAR_INTEGER,
  },
  {
    section: 'ch06-s6',
    kind: 'decision',
    title: '近整數時的三層結論',
    caption: String.raw`先問 code delay $D$ 是不是零，再問誤差 $|\delta|$ 大不大：只有「完全對齊而且誤差很小」那一格不變號（但恢復力消失）；紅色的兩格都會讓平均更新反向。`,
    chart: CHART_NEAR_INTEGER_TREE,
  },
  {
    section: 'ch06-s6',
    kind: 'model',
    title: '鋸齒自相關從哪裡來',
    caption: String.raw`看菱形的兩個出口：兩個 sample 之間沒有折返時兩個值一起移動；有折返（紅色）時差了一整個峰對峰，這個機率正比於間隔 $\ell$，所以自相關多出一個一次項。`,
    chart: CHART_SAW_AUTOCORR,
  },
  {
    section: 'ch06-s6',
    kind: 'model',
    title: '動差展開後三項各自的下場',
    caption: String.raw`自相關的常數項、一次項、二次項各自乘上脈衝響應的一個動差 $m_0$、$m_1$、$m_2$；Type-II 讓 $m_0=m_1=0$（棕色），所以只剩最後一個正的二階小量。`,
    chart: CHART_MOMENTS,
  },
  {
    section: 'ch06-s6',
    kind: 'path',
    title: '誤差一大，正瓣先被壓扁',
    caption: String.raw`步階響應 $s[k]$ 分成高而窄的正瓣（綠色）與矮而長的負瓣（紅色），小訊號時兩者的貢獻幾乎抵消；誤差變大時 comparator 先讓正瓣飽和，負瓣勝出，平均更新就反向。`,
    chart: CHART_STEP_LOBES,
  },
  {
    section: 'ch06-s6',
    kind: 'compare',
    title: 'regressor 晚一個 sample 會發生什麼',
    caption: String.raw`比較兩條支路：$D=0$ 時折返的尖峰和後面的尾巴乘到差不多同樣的值而抵消；$D\ge1$ 時尖峰乘到折返前的頂部，抵消不掉（紅色）。`,
    chart: CHART_DELAY_MISALIGN,
  },
  {
    section: 'ch06-s7',
    kind: 'timing',
    title: '一個 GMAC block 的時序',
    caption: String.raw`看 loop 框：框裡的三個箭頭每個 sample $n$ 發生一次（共 $N$ 次），這段時間 $w_k$ 固定不動——reference 端的 DTC 留下誤差、主 PLL 把它濾成 PD 的輸出、comparator 取 PD 輸出的正負號；框外的箭頭每個 block $k$ 才發生一次——先把累加的結果平均成 $G_k$，再更新成 $w_{k+1}$。`,
    chart: CHART_BLOCK_TIMING,
  },
  {
    section: 'ch06-s8',
    kind: 'compare',
    title: '三種 GMAC regressor',
    caption: String.raw`三個乘法器拿的都是同一個 comparator 輸出 $q[n]$，差別只在另一個輸入：原始 code $x[n]$、延遲後的 $x[n-D]$（藍色方塊的輸出）、或經過 PLL 模型的 $u_f=\hat h*x$（藍色方塊的輸出）。`,
    chart: CHART_REGRESSORS,
  },
  {
    section: 'ch06-s8',
    kind: 'handcalc',
    title: '綜合手算的計算順序',
    caption: String.raw`圈號就是手算題的步驟編號：先算迴路的積分增益 $K_i$，再算一階項與二階項，相加得到 $C_D/\sigma_x^2$（藍色），最後接上 comparator 增益 $K_q$ 算出 pole $p$。`,
    chart: CHART_HANDCALC_FLOW,
  },
]

/** 本章全部的方塊圖（不含章首的 SystemMap），依出現順序編號。 */
export const CH06_DIAGRAMS: ChapterDiagram[] = DEFS.map((d, i) => ({ ...d, id: `D-06.${i + 1}`, no: `6.${i + 1}` }))

export function diagramById(id: string): ChapterDiagram {
  const d = CH06_DIAGRAMS.find((x) => x.id === id)
  if (!d) throw new Error(`第 06 章找不到方塊圖 ${id}`)
  return d
}
