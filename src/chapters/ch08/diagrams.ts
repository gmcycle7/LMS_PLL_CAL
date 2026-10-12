/**
 * Ch08 的 Mermaid 方塊圖原始碼（集中在這裡，diagrams.test.tsx 用真正的 mermaid parser 驗證語法，
 * 並把每張圖「照著畫的訊號流」和 stability.ts 的實際函式逐點比對）。
 *
 * 寫法約定（docs/teaching-style.md §3、§8）：
 * - 圖裡所有的數學都寫 LaTeX：雙引號標籤內 `$...$`（變數、下標、希臘字母、運算符號、度數、單位的負次方…），文字照常寫。
 *   共用的 <Mermaid> 會用 KaTeX 排版（每個含公式的標籤會被合併成單一的 `$$...$$`）。原始碼用 String.raw 樣板字串，反斜線只寫一次；
 *   標籤內不用 `\\`（Mermaid 會把它收成一個反斜線），換行用 <br/>。
 * - 標籤內避免 ASCII '<'、'>' 與 ';'：數學裡的大小於寫 `\lt`、`\gt`（文字裡用全形 ＜、＞），間距用 `\,` 而不是 `\;`，以免被 Mermaid 當成 HTML 或敘述分隔。
 * - 加法點是圓形節點 `$\Sigma$`，每一條進入的線都標上正負號：`$+$`（或 `$X\,(+)$`）、`$-$`（或 `$X\,(-)$`，X 是訊號名）。
 *   不要寫沒有 `$` 的半形 "+"（或以 "- "、"* "、"1. " 開頭）：Mermaid 11 會把標籤當成 markdown 清單，畫出「Unsupported markdown: list」。
 *   這種錯誤 parser 抓不到，所以測試另外用真正的 renderer（@/components/mermaidTestUtils）畫一次並檢查每一行標籤都還在。
 * - 延遲寫成 `z^{-1}`／`z^{-d}`，積分器寫成 `\mu/(z-1)`；時間索引 k 一律是 GMAC block，n 是 comparator sample。
 * - 節號 § 寫成 `$\S 8.2$`（KaTeX 的 \text 不認得 § 字元，會在 console 警告）。
 * - sequenceDiagram：Mermaid 的 sequence 圖只認得「每則訊息一段 `$$...$$`」，而且不會替 `$...$` 做前處理；
 *   所以每則訊息整句寫成一段 `$$\text{文字 } 公式 \text{ 文字}$$`，participant 的名稱不支援公式（寫成不含符號的文字）。
 * - 極性一律是 δ = a − w（全站約定 §0）。
 * - 標色：藍（focus）＝這張圖的主角；紅（warn）＝會出事的地方；綠（ok）＝通過。三種顏色在深淺主題都讀得清楚。
 * - 版面（docs/teaching-style.md §8）：桌機 1280px 要放進正文欄（自然寬約 1260px 以內，`node scripts/diagram-audit.mjs --routes /ch/08` 的「超出」要是 0）。
 *   太長的橫向流程改成 `flowchart TB`；連線標籤太寬時用 <br/> 分成兩行；含公式的節點要自己用 <br/> 換行（不會自動換行）。
 *   兩個互不相連的 subgraph，dagre 會把後宣告的放在上面（DUAL_SIGNAL_FLOW_CHART 因此先宣告 QS、再宣告 FULL）。
 * - 文字後面緊接的正負號（「在 $-1$ 與」「得到 $+60^\circ$」）KaTeX 會當成二元運算子而多出一格空白：寫 `\mathord{-}1`、`\mathord{+}60`。
 *   不要寫 `${-}1$`：樣板字串裡的 `${` 是插值。
 */
import type { SystemBlock } from '@/components'

const CLASS_DEFS = [
  '  classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff',
  '  classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff',
  '  classDef ok fill:#1d7a46,stroke:#0f4d2b,color:#ffffff',
].join('\n')

/**
 * 本章的三個模型：一階 → 加更新延遲 → 加觀測動態（雙迴路）→ 一般化。
 * 每一格的遞迴式與穩定條件和 F-08.2／F-08.3、F-08.7／F-08.8、F-08.10／F-08.11、F-08.13／F-08.14 逐字相同（下標 k 是 GMAC block）。
 */
export const ROADMAP_CHART = String.raw`flowchart LR
  A["$\S 8.2$ 一階<br/>$\delta_{k+1} = (1-g)\,\delta_k$<br/>$0 \lt g \lt 2$"] -- "加上<br/>更新延遲 $d$" --> B["$\S 8.3$ 更新延遲<br/>$\delta_{k+1} = \delta_k - g\,\delta_{k-d}$<br/>$0 \lt g \lt 2\sin\frac{\pi}{4d+2}$"]
  B -- "加上<br/>觀測狀態 $s$" --> C["$\S 8.4$ 雙迴路<br/>$s_{k+1} = r_s\,s_k + b_s\,\delta_k$<br/>$\delta_{k+1} = \delta_k - \mu\,c_s\,s_k$<br/>$0 \lt \mu\,b_s\,c_s \lt 1 - r_s$"]
  C -- "$s$ 變成<br/>向量" --> D["一般化<br/>$\rho(\mathbf A_{\mathrm{comb}}) \lt 1$<br/>$L_{\mathrm{cal}} = \mu F(z)/(z-1)$"]`

/**
 * §8.1 單頻相關的兩條路徑：θ = φ + ΩD 從哪裡來（comparator rate，索引 n）。
 * E[x[n−D]·u[n]] = (A²/2)·|H|·cos θ；cos θ 的正負決定更新方向。
 * 全站架構約定（docs/assumptions.md §2a）：code 進 reference 端的 DTC，PLL error path 的終點是 PD 的輸出；
 * u[n] 就是 PD 輸出 e[n]（送進 loop filter 的同一個訊號），comparator／GMAC 取的是它，不是 DTC 或 divider 的某一點。
 */
export const POLARITY_PATH_CHART = String.raw`flowchart TB
  X(["單頻 code<br/>$x[n] = A\cos(\Omega n)$"]) --> H["PLL error path $H$<br/>從 DTC code 到 PD 輸出<br/>增益 $|H|$、相位 $\phi$"]
  X --> DLY["code delay<br/>延遲 $D$ 個 sample"]
  H -- "$u[n]$（PD 輸出）" --> M(("$\times$"))
  DLY -- "$x[n-D]$" --> M
  M -- "取平均" --> C["相關 $C = \frac{A^2}{2}\,|H|\cos\theta$<br/>$\theta = \phi + \Omega D$"]
  C --> Q{"$\cos\theta$ 的正負？<br/>$M = \arcsin(\cos\theta)$"}
  Q -- "$\gt 0$" --> POS["極性正確，$M \gt 0$<br/>$w$ 被拉向 $a$"]
  Q -- "$= 0$" --> ZERO["沒有恢復力，$M = 0$<br/>random walk"]
  Q -- "$\lt 0$" --> NEG["極性錯誤，$M \lt 0$<br/>$w$ 被推離 $a$"]
${CLASS_DEFS}
  class C focus
  class POS ok
  class NEG warn`

/**
 * §8.1 F-08.1 的手算順序（HC-08.1 的步驟）：ψ = wrap₁₈₀(θ) = ((θ + 180°) mod 360°) − 180°，M = 90° − |ψ| = arcsin(cos θ)。
 * 左邊那一條（由上往下）＝先折回再量距離；右邊綠色＝免折回的封閉式（結果相同）；中間紅色＝勘誤 E20 的反面教材（把週期錯當成 180°：M_錯 = 90° − (θ mod 180°)）。
 * 例：θ = −150° → 30° → 30° → ψ = −150° → M = −60°；錯誤寫法 −150° mod 180° = 30° → +60°。
 */
export const POLARITY_WRAP_CHART = String.raw`flowchart TB
  T(["相位 $\theta$（度）"]) --> A1["加 $180^\circ$"]
  A1 --> A2["除以 $360^\circ$<br/>取非負餘數"]
  A2 --> A3["減 $180^\circ$<br/>得到 $\psi = \mathrm{wrap}_{180}(\theta)$<br/>$-180^\circ \le \psi \lt 180^\circ$"]
  A3 --> A4["取絕對值 $|\psi|$"]
  A4 --> M["$M = 90^\circ - |\psi|$<br/>正的才有恢復力"]
  T -- "免折回的捷徑" --> S["$\arcsin(\cos\theta)$"]
  S -- "結果相同" --> M
  T -. "錯誤寫法（E20）" .-> B1["$\theta$ 除以 $180^\circ$ 取餘數<br/>週期錯當成 $180^\circ$"]
  B1 -.-> B2["$90^\circ$ 減掉餘數<br/>$\theta = -150^\circ$ 得到 $\mathord{+}60^\circ$<br/>正確是 $\mathord{-}60^\circ$"]
${CLASS_DEFS}
  class M focus
  class S ok
  class B1,B2 warn`

/** §8.1 → §8.2：設計審查的兩關——polarity margin（方向）與 calibration phase margin（動態）是兩個不同的檢查 */
export const TWO_MARGINS_CHART = String.raw`flowchart TB
  START(["設計審查：calibration loop 會收斂嗎？"]) --> C1["第 1 關：Polarity margin（$\S 8.1$）<br/>只看更新方向，與 $\mu$ 無關<br/>頻率軸：code 的 $\Omega$（rad/sample）"]
  C1 --> Q1{"$M = \arcsin(\cos\theta) \gt 0$？"}
  Q1 -- "否" --> F1["方向反了：平均誤差單調漂移<br/>調小 $\mu$ 沒有用<br/>修法：delay alignment、filtered-x（Ch07）"]
  Q1 -- "是" --> C2["第 2 關：Calibration phase margin（$\S 8.2$–$8.4$）<br/>看迴路動態，由 $g$ 與延遲決定<br/>頻率軸：block 的 $\omega$（rad/block）"]
  C2 --> Q2{"閉迴路 poles 全在單位圓內？"}
  Q2 -- "否" --> F2["迴路自己振盪發散<br/>調小 $\mu$ 有用<br/>修法：降 $g = \mu K$、縮短更新延遲 $d$"]
  Q2 -- "是" --> PASS["兩關都過：線性平均模型穩定<br/>接著看 PM、GM、DM 還剩多少"]
${CLASS_DEFS}
  class C1,C2 focus
  class F1,F2 warn
  class PASS ok`

/** §8.2 一階 calibration loop（block rate；δ = a − w）：單位回授 + 離散積分器 μ/(z−1) */
export const FIRST_ORDER_CHART = String.raw`flowchart LR
  A(["目標 $a$"]) -- "$+$" --> S(("$\Sigma$"))
  S -- "$\delta_k = a - w_k$" --> K["GMAC 平均斜率<br/>$K = K_q\,C$"]
  K -- "$G_k = K\,\delta_k$" --> I["暫存器 = 積分器<br/>$\mu/(z-1)$"]
  I -- "$w_k\,(-)$" --> S
${CLASS_DEFS}
  class I focus`

/** §8.2 在 δ 處把迴路剪開：繞一圈的乘積就是 L_cal(z) = g/(z−1)；回到 Σ 走 − 端，所以回來的是 −L_cal·δ_in */
export const LOOP_CUT_CHART = String.raw`flowchart LR
  IN(["在 $\delta$ 處剪開迴路<br/>注入測試弦波 $\delta_{\mathrm{in}}$"]) --> K["$\times K$<br/>GMAC 斜率"]
  subgraph LG["開迴路增益 $L_{\mathrm{cal}}(z) = g/(z-1)$，$g = \mu K$"]
    K -- "$G$" --> MU["$\times \mu$<br/>學習率"]
    MU --> INT["$1/(z-1)$<br/>積分器"]
  end
  INT -- "$w$" --> OUT(["回到 $\Sigma$ 的 $-$ 端<br/>$\delta_{\mathrm{out}} = -L_{\mathrm{cal}}(z)\,\delta_{\mathrm{in}}$"])
  OUT -.-> RD["$L_{\mathrm{cal}} = -1$ 時<br/>$\delta_{\mathrm{out}} = \delta_{\mathrm{in}}$：自己振盪<br/>PM、GM 量的是<br/>$L_{\mathrm{cal}}$ 離 $\mathord{-}1$ 多遠"]
${CLASS_DEFS}
  class INT focus`

/** §8.2 手算流程：g → pole、ω_c → ∠L → PM → DM，以及 GM（F-08.3 … F-08.6） */
export const PM_FLOW_CHART = String.raw`flowchart LR
  G(["$g = \mu K$"]) --> P["pole $p = 1 - g$<br/>穩定 $\iff 0 \lt g \lt 2$"]
  G --> WC["$\omega_c = 2\arcsin\frac{g}{2}$<br/>（$|L| = 1$ 的頻率）"]
  WC --> ANG["$\angle L(\omega_c) = -90^\circ - \omega_c/2$"]
  ANG --> PM["$PM = 180^\circ + \angle L(\omega_c)$<br/>$= 90^\circ - \arcsin\frac{g}{2}$"]
  PM --> DM["$DM = PM[\mathrm{rad}] / \omega_c$<br/>（單位：blocks）"]
  WC --> DM
  G --> GM["$GM = 2/g$<br/>（$\omega = \pi$ 處 $|L| = g/2$）"]
${CLASS_DEFS}
  class PM focus`

/** §8.3 同一個迴路，暫存器輸出要再等 d 個 block 才作用到 DTC：L(z) = g·z⁻ᵈ/(z−1) */
export const DELAY_LOOP_CHART = String.raw`flowchart LR
  A(["目標 $a$"]) -- "$+$" --> S(("$\Sigma$"))
  S -- "$\delta_{k-d} = a - w_{k-d}$" --> K["GMAC 平均斜率<br/>$K = K_q\,C$"]
  K -- "$G_k = K\,\delta_{k-d}$" --> I["暫存器 = 積分器<br/>$\mu/(z-1)$"]
  I -- "$w_k$" --> D["更新延遲 $z^{-d}$<br/>shadow register<br/>$\to$ commit $\to$ DTC"]
  D -- "$w_{k-d}\,(-)$" --> S
${CLASS_DEFS}
  class D warn`

/**
 * §8.3 pipeline 時序（d = 1 的例子，與正文的時序表逐格相同）：block k 的 DTC 用的是 w_{k−1}。
 * 架構約定（docs/assumptions.md §2a）：GMAC 的輸入是 PD 的輸出（經 comparator 取正負號），不是直接從 DTC 拉；
 * 所以「DTC → GMAC」那則訊息寫明是「PD 輸出裡的誤差」——DTC 用的係數決定 PD 輸出裡還剩多少誤差。
 * 訊息不要再加長（例如加「這個 block，」）：sequence 圖會跟著把兩條生命線拉開，整張圖超過正文欄就被縮小。
 * sequenceDiagram 的訊息只認得一段 `$$...$$`：整句寫進 \text{} 與公式的混合；participant 名稱不支援公式，所以只寫文字。
 */
export const PIPELINE_SEQ_CHART = String.raw`sequenceDiagram
  participant D as DTC（正在使用的係數）
  participant G as GMAC（累加整個 block 的 sample）
  participant R as 係數暫存器
  Note over D,R: $$\text{block } k \text{ 開始，暫存器最新值是 } w_k$$
  R-->>D: $$\text{DTC 拿到的卻是 } w_{k-1} \text{（晚 } d = 1 \text{ 個 block）}$$
  D->>G: $$\text{PD 輸出裡的誤差是 } \delta_{k-1} = a - w_{k-1}$$
  G->>R: $$G_k = K\,\delta_{k-1}$$
  R->>R: $$w_{k+1} = w_k + \mu\,G_k$$
  Note over D,R: $$\text{block } k+1 \text{ 開始，暫存器最新值是 } w_{k+1}$$
  R-->>D: $$\text{DTC 拿到 } w_k$$
  D->>G: $$\text{PD 輸出裡的誤差是 } \delta_k = a - w_k$$
  G->>R: $$G_{k+1} = K\,\delta_k$$
  R->>R: $$w_{k+2} = w_{k+1} + \mu\,G_{k+1}$$`

/** §8.3 g 由小變大時，特徵式 z^(d+1) − z^d + g 的主導根怎麼走（狀態流程） */
export const ROOT_STATES_CHART = String.raw`flowchart LR
  S0(["$g \to 0^+$<br/>慢根 $z \approx 1 - g$<br/>快根在 $z \approx 0$ 附近"]) -- "$g$ 變大" --> S1(["主導根是正實根<br/>$\delta_k$ 不變號<br/>不 overshoot"])
  S1 -- "過 overshoot<br/>門檻" --> S2(["主導根是<br/>共軛複數對<br/>會 overshoot<br/>仍收斂，$\rho \lt 1$"])
  S2 -- "$g = g^*(d)$" --> S3(["根踩在單位圓上<br/>角度<br/>$\omega^* = \pi/(2d+1)$<br/>$PM_d = 0$，臨界"])
  S3 -- "$g \gt g^*(d)$" --> S4(["根跑到圓外<br/>振盪發散<br/>$\rho \gt 1$"])
${CLASS_DEFS}
  class S1 ok
  class S2 focus
  class S3,S4 warn`

/**
 * §8.3 相位預算（F-08.9）：PM = 180° + ∠L(ω_c)，L = K·[μ/(z−1)]·z⁻ᵈ，∠L(ω) = 0° − (90° + ω/2) − d·ω。
 * 方塊依 DELAY_LOOP_CHART 繞一圈的順序排列，線上寫的是「還剩多少相位」；ω_c = 2·arcsin(g/2) 與 d 無關（延遲不改 |L|）。
 * 所以 PM_d = 90° − ω_c/2 − d·ω_c = 90° − (2d+1)·arcsin(g/2)；PM_d = 0 ⇔ g = g*(d)。
 */
export const PHASE_BUDGET_CHART = String.raw`flowchart TB
  B0(["相位預算 $180^\circ$<br/>$PM = 180^\circ + \angle L(\omega_c)$"]) --> KK["GMAC 斜率 $K \gt 0$<br/>不吃相位"]
  KK -- "剩 $180^\circ$" --> INT["積分器 $\mu/(z-1)$<br/>落後 $90^\circ + \omega_c/2$"]
  INT -- "剩 $90^\circ - \omega_c/2$" --> DLY["更新延遲 $z^{-d}$<br/>落後 $d\,\omega_c$"]
  DLY -- "剩 $90^\circ - \omega_c/2 - d\,\omega_c$" --> PM["$PM_d = 90^\circ - (2d+1)\arcsin\frac{g}{2}$"]
  WC["交越頻率 $\omega_c = 2\arcsin\frac{g}{2}$<br/>延遲不改變 $|L|$，所以與 $d$ 無關"] -.-> INT
  WC -.-> DLY
  PM -- "$PM_d = 0$ 時的 $g$" --> CR["臨界增益 $g^*(d) = 2\sin\frac{\pi}{4d+2}$<br/>$GM_d = g^*(d)/g$：$g$ 離它還差幾倍"]
${CLASS_DEFS}
  class PM focus
  class DLY,CR warn`

/** §8.4 二狀態模型（方程式版）：觀測狀態 s 有記憶（pole r_s，藍色），GMAC 只看得到 s_k（不含 δ_k） */
export const DUAL_LOOP_CHART = String.raw`flowchart LR
  D(["$\delta_k$"]) --> O["觀測動態<br/>$s_{k+1} = r_s\,s_k + b_s\,\delta_k$"]
  O -- "$s_k$" --> C["GMAC<br/>$G_k = c_s\,s_k$"]
  C -- "$G_k$" --> U["暫存器<br/>$\delta_{k+1} = \delta_k - \mu\,G_k$"]
  U -- "到下一個 block" --> D
${CLASS_DEFS}
  class O focus`

/**
 * §8.4 訊號流版：上＝完整二狀態模型（藍色那一圈是有記憶的觀測狀態 s）；
 * 下＝quasi-static 把那一圈換成常數增益 F(1) = b_s·c_s/(1−r_s)（紅色）。
 * 兩者的暫存器（δ_{k+1} = δ_k − μ·G_k）完全相同。
 */
export const DUAL_SIGNAL_FLOW_CHART = String.raw`flowchart LR
  subgraph QS["Quasi-static 近似：$s$ 那一圈換成常數增益，沒有記憶"]
    direction LR
    QZD["$z^{-1}$"] -- "$\delta_k$" --> QF["$\times F(1) = b_s\,c_s/(1-r_s)$"]
    QF -- "$G_k$" --> QM["$\times \mu$"]
    QM -- "$\mu\,G_k\,(-)$" --> QI(("$\Sigma$"))
    QZD -- "$\delta_k\,(+)$" --> QI
    QI -- "$\delta_{k+1}$" --> QZD
  end
  subgraph FULL["完整二狀態模型：觀測狀態 $s$ 有記憶（pole $r_s$）"]
    direction LR
    FZD["$z^{-1}$"] -- "$\delta_k$" --> FB["$\times b_s$"]
    FB -- "$+$" --> FS(("$\Sigma$"))
    FS -- "$s_{k+1}$" --> FZ["$z^{-1}$"]
    FZ -- "$s_k$" --> FR["$\times r_s$"]
    FR -- "$+$" --> FS
    FZ -- "$s_k$" --> FC["$\times c_s$"]
    FC -- "$G_k$" --> FM["$\times \mu$"]
    FM -- "$\mu\,G_k\,(-)$" --> FI(("$\Sigma$"))
    FZD -- "$\delta_k\,(+)$" --> FI
    FI -- "$\delta_{k+1}$" --> FZD
  end
${CLASS_DEFS}
  class FB,FS,FZ,FR focus
  class QF warn`

/**
 * §8.4 三種觀測模型並排（E19 的歸因）：F(z) = b_s·c_s/(z−r_s) = z⁻¹ × 低通 b_s·c_s/(1 − r_s·z⁻¹)。
 * (a) 只留 DC 增益；(b) 只有低通、沒有 latency（反事實）；(c) 完整模型 = latency × 低通。
 * 每一列最右邊那格不是訊號處理方塊，而是「G 接上同一個暫存器 δ_{k+1} = δ_k − μ·G_k 之後」閉迴路的穩定上界。
 */
export const LATENCY_SPLIT_CHART = String.raw`flowchart LR
  D(["$\delta$"]) --> A1["(a) quasi-static<br/>$\times F(1) = b_s\,c_s/(1-r_s)$<br/>沒有相位"]
  A1 -- "$G$" --> A2["接上暫存器後的上界<br/>$\mu\,b_s\,c_s \lt 2(1-r_s)$<br/>也就是 $g_{\mathrm{eff}} \lt 2$"]
  D --> B1["(b) 只有低通（反事實）<br/>$b_s\,c_s/(1 - r_s\,z^{-1})$"]
  B1 -- "$G$" --> B2["接上暫存器後的上界<br/>$\mu\,b_s\,c_s \lt 2(1+r_s)$<br/>$r_s \gt 0$ 時比 (a) 還寬"]
  D --> CZ["(c) 完整模型<br/>$z^{-1}$：一個 block 的 latency"]
  CZ --> C1["同一個低通<br/>$b_s\,c_s/(1 - r_s\,z^{-1})$"]
  C1 -- "$G$" --> C2["接上暫存器後的上界<br/>$\mu\,b_s\,c_s \lt 1-r_s$<br/>也就是 $g_{\mathrm{eff}} \lt 1$：只有 (a) 的一半"]
${CLASS_DEFS}
  class CZ,C2 warn`

/**
 * §8.4 μ 由小到大的四個區間（F-08.11、F-08.12；P(z) = z² − (1+r_s)z + (r_s + μ·b_s·c_s)）：
 *   μ·b_s·c_s ＜ (1−r_s)²/4        兩個實根（都在 r_s 與 1 之間）；μ → 0 時慢根 → 1 − g_eff，quasi-static 可信
 *   (1−r_s)²/4 ＜ … ＜ 1−r_s       共軛複數根，|z|² = r_s + μ·b_s·c_s（μ 越大越慢）；quasi-static 的 pole 1 − g_eff ∈ (0, 1) 卻越來越小
 *   1−r_s ＜ … ＜ 2(1−r_s)         |z| ＞ 1 發散；quasi-static 的 pole ∈ (−1, 0)，還以為穩定
 *   … ＞ 2(1−r_s)                  兩個模型都不穩定
 * 「本例」＝ Gallery #5 的 r_s = 0.8、b_s·c_s = 0.2：三個門檻是 μ = 0.05、1、2（測試用 analyzeDualLoop 驗證）。
 */
export const DUAL_REGIMES_CHART = String.raw`flowchart TB
  R1(["完整：兩個實根（一快一慢）<br/>quasi-static：pole $= 1 - g_{\mathrm{eff}}$<br/>$\mu$ 遠小於門檻時兩者一致"]) -- "$\mu\,b_s\,c_s$ 超過 $(1-r_s)^2/4$<br/>本例 $\mu = 0.05$" --> R2(["完整：共軛複數根<br/>模數 $|z| = \sqrt{r_s + \mu\,b_s\,c_s}$<br/>$\mu$ 越大越慢<br/>quasi-static：以為越來越快"])
  R2 -- "超過 $1 - r_s$<br/>本例 $\mu = 1$" --> R3(["完整：$|z| \gt 1$，振盪發散<br/>quasi-static：還以為穩定<br/>（pole 在 $\mathord{-}1$ 與 $0$ 之間）"])
  R3 -- "超過 $2(1 - r_s)$<br/>本例 $\mu = 2$" --> R4(["兩個模型都不穩定"])
${CLASS_DEFS}
  class R1 ok
  class R2 focus
  class R3,R4 warn`

/**
 * §8.4 一般化 state-space：觀測（A_s、b_s、c_sᵀ、d_s）＝ F(z)，暫存器＝積分器（δ 座標：δ_{k+1} = δ_k − μ·G_k）。
 * 兩個框串成一圈就是 L_cal(z) = μ·F(z)/(z−1)。
 */
export const STATE_SPACE_CHART = String.raw`flowchart TB
  DK(["$\delta_k$"]) --> BS
  DK --> DS
  subgraph OBS["觀測動態 $F(z) = d_s + \mathbf c_s^{\mathsf T}(z\mathbf I - \mathbf A_s)^{-1}\mathbf b_s$"]
    BS["$\mathbf b_s$"] -- "$+$" --> SS(("$\Sigma$"))
    SS -- "$s_{k+1}$" --> ZS["$z^{-1}$"]
    ZS -- "$s_k$" --> AS["$\mathbf A_s$"]
    AS -- "$+$" --> SS
    ZS -- "$s_k$" --> CT["$\mathbf c_s^{\mathsf T}$"]
    CT -- "$+$" --> SG(("$\Sigma$"))
    DS["$d_s$（直通）"] -- "$+$" --> SG
  end
  subgraph REG["暫存器 = 積分器（$\delta$ 座標）"]
    MU["$\times \mu$"] -- "$\mu\,G_k\,(-)$" --> SD(("$\Sigma$"))
    SD -- "$\delta_{k+1}$" --> ZD["$z^{-1}$"]
    ZD -- "$\delta_k\,(+)$" --> SD
  end
  SG -- "$G_k$" --> MU
  ZD -- "回授" --> DK
${CLASS_DEFS}
  class AS,BS,CT,DS focus`

/** §8.4 穩定性檢查流程：組 A_comb → 求 eigenvalue → 是否都在單位圓內（與 combinedMatrix／analyzeGeneral 的步驟相同） */
export const STABILITY_CHECK_CHART = String.raw`flowchart TB
  IN(["輸入：$\mathbf A_s$、$\mathbf b_s$、$\mathbf c_s^{\mathsf T}$、$d_s$ 與 $\mu$"]) --> BUILD["組合併矩陣 $\mathbf A_{\mathrm{comb}}$<br/>上列：$\mathbf A_s$、$\mathbf b_s$<br/>下列：$\mathord{-}\mu\,\mathbf c_s^{\mathsf T}$、$1 - \mu\,d_s$"]
  BUILD --> EIG["求全部 eigenvalue $\lambda_i$<br/>（也就是閉迴路 poles）"]
  EIG --> RHO["$\rho = \max_i |\lambda_i|$"]
  RHO --> Q{"$\rho$ 和 $1$ 比？"}
  Q -- "$\rho \lt 1$" --> PASS["線性平均模型穩定<br/>再讀 $L_{\mathrm{cal}} = \mu F(z)/(z-1)$ 的 PM、GM"]
  Q -- "$\rho = 1$" --> MARG["臨界：不能當成穩定"]
  Q -- "$\rho \gt 1$" --> FAIL["不穩定<br/>降 $\mu$，或改善觀測動態 $F(z)$"]
  PASS --> TD["時域再驗一次<br/>跑 300 個 block 以上，疊上 $\rho^k$ 包絡"]
${CLASS_DEFS}
  class BUILD focus
  class PASS ok
  class MARG,FAIL warn`

/**
 * 總整理（比較表之前）：整章是同一個迴路 δ_k = a − w_k → F(z) → G_k → μ/(z−1) → w_k，只是「δ 到 G 的觀測路徑 F(z)」不同。
 *   §8.2  F(z) = K                    ⇒ L_cal = g/(z−1)
 *   §8.3  F(z) = K·z⁻ᵈ（G_k = K·δ_{k−d}）⇒ L = g·z⁻ᵈ/(z−1)
 *   §8.4  F(z) = b_s·c_s/(z − r_s)      ⇒ L_cal = μ·b_s·c_s/((z−1)(z−r_s))
 *   quasi-static：把 F(z) 換成常數 F(1)
 * 延遲在 DELAY_LOOP_CHART 畫在暫存器輸出（w_k → w_{k−d}），這裡併進 F(z)：a 是常數時兩種畫法的遞迴式相同（δ_{k+1} = δ_k − g·δ_{k−d}）。
 */
export const UNIFIED_LOOP_CHART = String.raw`flowchart LR
  A(["目標 $a$"]) -- "$+$" --> S(("$\Sigma$"))
  subgraph LG["繞一圈的乘積：$L_{\mathrm{cal}}(z) = \mu F(z)/(z-1)$"]
    F["觀測路徑 $F(z)$<br/>從 $\delta$ 到 $G$ 的全部動態"] -- "$G_k$" --> I["暫存器 = 積分器<br/>$\mu/(z-1)$"]
  end
  S -- "$\delta_k = a - w_k$" --> F
  I -- "$w_k\,(-)$" --> S
  M1["$\S 8.2$ 一階<br/>$F(z) = K$"] -.-> F
  M2["$\S 8.3$ 更新延遲 $d$<br/>$F(z) = K\,z^{-d}$"] -.-> F
  M3["$\S 8.4$ 雙迴路<br/>$F(z) = b_s\,c_s/(z - r_s)$"] -.-> F
  M4["quasi-static 近似<br/>把 $F(z)$ 換成常數 $F(1)$"] -.-> F
${CLASS_DEFS}
  class F focus
  class M4 warn`

/** 綜合手算（HC-08.8）的計算順序：σ_v、μ、C、d → K_q → K → g → p、g*(d)、μ_max、GM_d、PM_d */
export const SYNTHESIS_FLOW_CHART = String.raw`flowchart TB
  SV(["$\sigma_v$ [fs]"]) --> KQ["$K_q = \sqrt{2/\pi}\,/\,\sigma_v$<br/>$[\mathrm{fs}^{-1}]$"]
  KQ --> KK["$K = K_q\,C$<br/>$[\mathrm{fs}^{-1}]$"]
  CC(["$C$"]) --> KK
  KK --> G["$g = \mu K$<br/>（無因次）"]
  MU(["$\mu$ [fs]"]) --> G
  G --> P["$p = 1 - g$"]
  G --> GM["$GM_d = g^*(d)/g$"]
  G --> PM["$PM_d = 90^\circ - (2d+1)\arcsin\frac{g}{2}$"]
  KK --> MM["$\mu_{\max} = g^*(d)/K$<br/>[fs]"]
  DD(["$d$ [blocks]"]) --> GS["$g^*(d) = 2\sin\frac{\pi}{4d+2}$"]
  GS --> MM
  GS --> GM
  DD --> PM
${CLASS_DEFS}
  class G focus`

/** 本章全部的 Mermaid 原始碼（依頁面出現的順序）；章首另有一張全站共用的 <SystemMap>。 */
export const CH08_CHARTS = {
  ROADMAP_CHART,
  POLARITY_PATH_CHART,
  POLARITY_WRAP_CHART,
  TWO_MARGINS_CHART,
  FIRST_ORDER_CHART,
  LOOP_CUT_CHART,
  PM_FLOW_CHART,
  PIPELINE_SEQ_CHART,
  DELAY_LOOP_CHART,
  ROOT_STATES_CHART,
  PHASE_BUDGET_CHART,
  DUAL_LOOP_CHART,
  DUAL_SIGNAL_FLOW_CHART,
  LATENCY_SPLIT_CHART,
  DUAL_REGIMES_CHART,
  STATE_SPACE_CHART,
  STABILITY_CHECK_CHART,
  UNIFIED_LOOP_CHART,
  SYNTHESIS_FLOW_CHART,
} as const

export type Ch08ChartName = keyof typeof CH08_CHARTS

/** 章首 <SystemMap> 標成藍色的方塊：GMAC（量斜率 K）、÷N × μ（步長）、gain accumulator（積分器） */
export const SYSTEM_MAP_FOCUS: SystemBlock[] = ['gmac', 'scale', 'acc']
