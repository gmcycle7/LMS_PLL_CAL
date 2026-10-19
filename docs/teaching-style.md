# 教學風格規範（全站必須遵守）

使用者明確要求（2026-10-10）：

> 盡可能多數學分析，數學都要 LaTeX 格式；最好一步一步的教；把核心的程式碼給我看，尤其是在比較不同演算法差異；數學符號也要列給我看；假設我只有微積分程度。
> 前面那種很簡單的教學我也需要（指 ChatGPT 對話中「把我當高中畢業生教」的入門課）。

## 1. 讀者起點：只會微積分

- 可以直接用：函數、極限、導數、偏導數、積分、泰勒展開、等比數列、複數基本運算、三角恆等式。
- **第一次出現就要從頭解釋**（用一個可展開的「先備知識」框，`Derivation` 或 `Callout`）：期望值 \(E[\cdot]\)、變異數、高斯分布與 \(\Phi\)、erf、中央極限定理、相關（correlation）、矩陣與特徵值、Z transform、離散時間頻率 \(\Omega\)、PSD、卷積、單位圓與 pole。
- 每個新名詞：中文 + 英文術語 + 一句白話直覺。

## 2. 每一課的固定節奏（參考使用者喜歡的入門課）

0. **系統地圖**：章首放 `<SystemMap focus={[...]} />`，標出本章在整個 PLL 校正系統中的位置（章首的固定順序見 §9：h1 → 本章要回答的問題 → 系統地圖 → 本章資訊 strip → 先備自檢）。
1. **一個問題**：用生活或黑盒子例子開場（例如「你只能觀察輸入輸出，不知道 \(a\)」）。
2. **先算一次**：用具體數字手算 2–3 步（例如 \(w_0=1, a=3, x=2, \mu=0.1 \Rightarrow w_1=1.8, w_2=2.28\)），用表格列出每一步。
3. **一步一步推導**：每個等號一行，用 `aligned` 對齊，**不可跳步**；每一步右側或下方用一句話說明「為什麼可以這樣做」（代入、展開、取期望值、利用獨立性、泰勒一階近似…）。
4. **動手觀察**：互動圖 + 「試試看」提示（例如「把 \(\mu\) 拉到 0.6，觀察發散」）。
5. **演算法比較**：表格 + 同一組資料的並排圖 + **核心程式碼並排**（見 §4）。
6. **注意假設**：`ClaimTag`（精確｜指定模型／近似｜需驗證／研究假說）與適用條件。
7. **思考題**：1–3 題，選擇題或計算題，答案與解析可展開。
8. **本課必記**：3–5 個 boxed 公式 + 「應該記住的 N 件事」。
9. **連結到 PLL**：這個數學在 DTC / GMAC / PLL 中對應什麼硬體。

## 3. 數學呈現

- **所有數學一律 KaTeX/LaTeX**（`Tex` 行內、`TexBlock` 獨立），內文不得用純文字或 Unicode 拼湊公式（例如不要寫「w(n+1)=w(n)+μex」）。
- **字串屬性也要用 LaTeX**：共用元件的字串屬性（`ExperimentShell` 的 title／description／warnings／assumptions、`MetricRow.name`／`note`／`unit`、`Plot` 的 title／caption、`Section`／`Derivation`／`Callout`／`Prereq`／`Quiz`／`Recap` 的標題、`CodeBlock`／`CodeCompare` 的 title／caption／label／note、`ParamControl`／`SelectControl`／`ToggleControl` 的 label／hint／unit、`Mermaid` 的 caption）支援 `$...$` 行內公式，例如 `'C ≤ 0：$p = 1-\\mu K_q C > 1$，更新極性錯誤'`。不要在這些字串裡用 Unicode 拼公式（`σ_w`、`μK_q`、`δ²`…），一律改寫成 `$\\sigma_w$`。
- **圖裡面的數學也要用 LaTeX**（使用者要求，2026-10-11：「數學公式包含圖片裡面的數學公式都要用類似 latex 的格式」）：
  - **方塊圖（Mermaid）**：節點與連線的雙引號標籤裡，數學一律寫 `$...$`，文字照常寫，例如 `A["誤差 $e[n] = y[n] - \\hat y[n]$"]`、`X -- "$\\mu$" --> Y`。共用的 `Mermaid` 元件會用 KaTeX 排版（和正文同一套樣式）。圖的原始碼用 `String.raw` 樣板字串，反斜線就不用寫兩次。限制：標籤內不要用 `\\\\`（Mermaid 會把它收成一個反斜線；換行用 `<br/>`）；`stateDiagram`／`sequenceDiagram` 的文字與 subgraph 標題是否支援公式，以 `renderMermaidForTest` 的結果為準（`mathCount`、文字中不可殘留 `$`），不支援就改用文字敘述或改畫成 flowchart。
  - **互動圖表（Plotly）**：軸標題、圖例名稱（trace `name`）、annotation、`ticktext`、`hovertemplate` 裡的數學也寫 `$...$`，例如 `'學習率 $\\mu$'`、`'$\\sigma_w$ (fs)'`、`'$|H_{\\mathrm{PD}}|$ (dB)'`。`Plot` 元件會轉成斜體符號與真正的上下標（`plotMath.ts`；分數以行內 `a/b` 顯示）。不支援的 TeX 指令會原樣顯示指令名稱，所以圖表字串只用基本指令（希臘字母、上下標、`\\frac`、`\\sqrt`、`\\hat`／`\\bar`、`\\mathrm`、`\\text`、常見運算符號）。
  - 下拉選單的 `<option>` 文字、匯出檔的欄名、aria-label 是純文字，不放公式。
  - 無障礙名稱（aria-label、title、aria-valuetext、`<option>`）一律用 `accessibleText`，不用 `stripMathDelimiters`；`CodeCompare` 的分頁標籤可以含 `$…$`。
- 重要結果用 `\boxed{}`；推導用 `\begin{aligned} … \end{aligned}`。
- 有單位的量要寫單位（\(\mathrm{fs}\)、\(\mathrm{fs}^{-1}\)、\(\mathrm{Hz}\)），並註明時間索引 \(n\)（sample）／\(k\)（block）。
- 盡量多數學分析：除了規格書的公式，補上中間推導、邊界情況、數值驗算，以及「如果假設不成立會怎樣」。

## 4. 核心程式碼

- 頁面上顯示的程式碼**必須就是網站實際執行的程式碼**：在 `src/simulation/**` 內用
  `// #region core:<name>` … `// #endregion` 標出核心段落，頁面用 `CodeBlock`（`?raw` 匯入 + region 擷取）顯示，不可另外手寫一份「示意版」。
- 比較不同演算法時（LMS vs Sign-Error vs Sign-Sign；raw-x vs delayed-x vs filtered-x；scalar vs NLMS vs preconditioned vs regularized；freeze vs toggle vs stochastic rounding vs ΔΣ vs ΔΣ+dither…），用並排的程式碼分頁，並**標出差異的那一行**（行內註解 `// ← 差異：…`）。
- 可附 Python 等價版本（來自 `golden/`，同樣用 `?raw` 匯入），讓讀者對照。

## 5. 數學符號表（放在每章最後）

- 使用者要求（2026-10-10）：「每一章的數學符號表都放在最後面」。符號表（`SymbolTable`）一律放在**章末**：在「本課必記」（Recap）與章末交棒（§9 的 `ChapterHandoff`）之後、頁面最底端，外層加 `id="symbols"`；章首不放符號表。章首通往符號表的連結（「符號表 ↓」）由 PageFrame 的本章資訊 strip 提供（§9），各章**不再**自己寫「本章符號表在最後 ↓」那一行。
- 內容不變：符號（LaTeX）、意義、單位、第一次出現的段落、與全站約定（規格 §0）的關係。
- 有勘誤或符號衝突時（見 `docs/validation.md`，例如 \(\delta=a-w\) 的極性、\(u\)、\(c\)、\(\lambda\) 的衝突），在表內註明本章採用的定義。
- 因為符號表移到最後，正文中**每個符號第一次出現時要就地用一句話說明**（不能只靠符號表）。
- 全站符號總表在 Formula & Unit Reference 頁。

## 6. 難度分層

三種模式共用同一計算核心，只改變呈現。內容用 `ModeGate min="engineer"`／`min="research"` 分層（目前模式低於 `min` 就不渲染）；沒有包 `ModeGate` 的內容所有模式都看得到。

- Beginner 模式：只看到沒有包 `ModeGate` 的內容——直覺、手算、方塊圖、互動實驗；推導框（`Derivation`）預設收合，但一鍵可展開。
- Engineer 模式：再加上 `min="engineer"` 的內容——推導、假設、單位、硬體對應；**每個公式旁的適用／限制條件要在這個模式就看得到**，不要只放在 Research。
- Research 模式：再加上 `min="research"` 的內容——嚴格條件、反例、Monte Carlo 細節、相關文獻。
- `Derivation` 預設只在 Research 模式展開（使用者手動切換優先），個別推導框可以用 `defaultOpen` 覆寫。

## 7. 帶入手算（使用者要求：「可以手算會比較有感覺」）

- 每章為**每一個重要公式**提供「帶入手算」題（`HandCalc` 元件 + `src/chapters/chNN/handcalcs.ts` 匯出 `HANDCALCS: HandCalcDef[]`；型別在 `@/data/types`，範本見 `src/chapters/ch00/handcalcs.ts`）。每章至少 4 題，重要章節 6–8 題。
- 使用者輸入自己的數字 → 逐步顯示「符號式 = 代入數字 = 結果」，每一步一句說明；也可切到「自己算算看」先用紙筆算再對答案，並可「換一題」隨機出數字。
- **每一步都要是人用紙筆＋一般工程計算機做得到的**：一次只做一種運算（一次乘法、一次開根號、一次查表）；需要 $\Phi(z)$、$\mathrm{erf}$、$\arcsin$、$\log$ 時在 `tips` 說明怎麼按計算機或用哪個近似（例如 $|z|\le0.1$ 時 $\Phi(z)\approx 0.5+z/\sqrt{2\pi}$），複數運算拆成實部／虛部分開算。
- `solve()` 的數值必須來自 `src/simulation` 的實際函式（或在測試中與其逐一比對），不可另寫一套可能不一致的公式；`inputs[].default` 用本章 worked example 的數字，讓手算結果能和文中表格、T-id 測試對上。
- `practice` 範圍選「手算友善」的數字（整數、0.05 的倍數、2 的冪次），並用 `validate` 擋掉模型不適用的組合（例如 $C\le0$、$g\ge2$），訊息要解釋原因。
- 題目放在對應推導的正後方（先看推導 → 馬上代數字算一次），章末「思考題」之前再放一題綜合手算。
- 全站題目彙整在「手算練習簿」頁（`/workbook`），可隨機出題、列印練習卷。

## 8. 方塊圖（使用者要求：「多加一些方塊圖讓我好理解」）

- **每個主要概念都要有一張方塊圖**，放在文字說明之後、公式推導之前（先看圖知道訊號怎麼流，再看數學）。每章至少 5 張（含章首的系統地圖），重要章節 8 張以上。
- 圖的種類（依內容選用，使用 `Mermaid` 元件的 flowchart；節點與連線標籤裡的數學一律寫 `$...$`，由 KaTeX 排版）：
  1. **系統地圖**（章首）：`<SystemMap focus={['cmp','gmac']} />`，全站同一張圖、藍色標出本章主角。這張圖是手排的 SVG（三條泳道、連線只走水平／垂直、沒有交叉），不經過 Mermaid；測試要檢查主角時用 `systemMapModel(focus)`。
  2. **數學模型方塊圖**：把方程式畫成訊號流，例如 `x → [× a] → (+) ← v`、`e = y − ŷ`；加法點用圓形節點，正負號寫全形「＋」與減號「−」（U+2212），例如 `S(("＋"))`、連線標籤 `-- "−" -->`；延遲用 `["z⁻¹"]`，積分器用 `["1/(z−1)"]`。**不要用單獨的半形 `+`／`-` 當標籤**：Mermaid 11 會把它當成 Markdown 清單，畫出「Unsupported markdown: list」（共用的 `Mermaid` 元件會自動替換，但原始碼仍應直接寫對）。
  3. **演算法迴圈圖**：更新式畫成迴圈（預測 → 比較 → 修正 → 延遲回授），標出每條線上的訊號名稱與極性（+／−）。
  4. **路徑／轉移函數圖**：誤差注入點、`H_PD`、`T`、comparator、GMAC 的串接，標出取樣率（`n`／`k`）。
  5. **比較圖**：兩三種架構並排（raw-x／delayed-x／filtered-x；scalar／preconditioned；freeze／toggle／ΔΣ），差異的方塊用 `classDef` 標色。
  6. **手算流程圖**：一題綜合手算的計算順序（先算什麼、再算什麼），方便跟著做。
  7. **狀態機／時序圖**：校正流程、clock domain、block 邊界（可用 `stateDiagram-v2` 或 `sequenceDiagram`）。
- **架構一律照 `docs/assumptions.md` §2a**：DTC 畫在 reference 輸入端（`Reference → DTC → PD`），回授路徑只有 divider／PMUX；LMS 校正迴路（comparator）的輸入從 **PD 的輸出**拉；DTC 的作用寫成「補償量 $w_k x[n]$（從基準延遲 $T_0$ 往回扣）」，PD 量的是 $e[n] = t_{\mathrm{ref}}' - t_{\mathrm{fb}} = (a - w_k)x[n] + v[n]$。
- 每張圖要有圖說（一句話說明要看什麼），且圖上的訊號名稱、正負號、箭頭方向必須和正文公式一致（審查時逐一核對）。
- 每張圖都要在測試裡**真的畫一次**，不能只過 parser（parser 抓不到「Unsupported markdown」這類問題）：各章的 `diagrams.test.tsx`（jsdom 環境）用 `@/components/mermaidTestUtils` 的 `installMermaidSvgShim` 與 `renderMermaidForTest(chart)`，逐張斷言畫出來的文字不含 `Unsupported markdown`、節點數不超過上限。節點文字含括號、冒號、引號等特殊字元時用雙引號包住。
- 圖說（`caption`）與圖內標籤的數學一律用 `$...$` LaTeX；測試要斷言畫出來的文字裡沒有殘留的 `$`，而且 KaTeX 以外的文字沒有 Unicode 拼的數學。
- 圖不要過大：單張不超過約 14 個節點；太大就拆成兩張。
- **版面寬度**：桌機（視窗 1280px）上圖要完整放進正文欄，不需要橫向捲動——自然寬度約 1260px 以內（`node scripts/diagram-audit.mjs --routes /ch/NN` 的「超出」要是 0），高度盡量不超過 1400px。太寬的橫向流程改成直向（`flowchart TB`）、用上下兩個 `direction LR` 的 subgraph 折成兩列，或把長標籤用 `<br/>` 換行（含數學的標籤不會自動換行）。手機上圖會在自己的外框內橫向捲動，右上角有「放大」可以全螢幕檢視。
- **外觀**由共用元件統一處理（`mermaidTheme.ts`：白底圓角節點、虛線圓角群組、連線標籤是小膠囊；外框是有細點格線的圖紙），各圖**不要**自己指定節點底色或字型；要強調時只用規範的 `classDef`（`focus` 藍、`warn` 紅、`ok` 綠…，白字配深色底）。
- **Mermaid 排版的幾個眉角**（這一輪整理時實際踩到的）：
  - subgraph 裡只要有一個節點連到框外，這個 subgraph 自己的 `direction` 就會被忽略。要把長鏈折成上下兩列，列與列之間要連 subgraph 本身（`ROW1 --> ROW2`），或用看不見的連線 `ROW1 ~~~ ROW2` 只決定上下順序；跨列的訊號線若必須是節點對節點，就改用整張 `flowchart TB`。
  - subgraph 的標題只有一行的高度（約 200px 就換行），所以標題只寫一行文字；公式與條件放進框內的節點。
  - 兩個來源各自接到兩個加法點（正負號不同）時，直向排版會交叉、正負號標籤會相撞：用 `A ~~~ B` 把其中一個往下推一層可以解開。測試數連線時要略過這種看不見的線。
  - `stateDiagram-v2` 的自我轉移（`A --> A`）會畫成又長又細的尖角，盡量把那句話寫進狀態的說明文字裡。
  - 沒有「反向箭頭」的連線語法（`A <-- B` 不是合法的邊），回授要寫成來源 → 目的。
  - 很大的菱形（判斷式太長）改用六角形 `{{"…"}}`，比較不佔高度。
- 改完圖要**實際看一次**：`node scripts/screenshots.mjs --routes /ch/NN --shots all-mermaid` 截圖逐張檢查（文字有沒有被切掉或重疊、連線有沒有不必要的交叉、字會不會太小），再用 `node scripts/diagram-audit.mjs --routes /ch/NN` 確認寬度。這幾支腳本的旗標與「改了畫面要附上哪些檢查」見 `docs/dev-conventions.md` §8。

## 9. 章首／章末骨架（2026-10-19 起，由 PageFrame 統一提供）

審查發現（pedagogy）：每章開頭先看到「規格書 §x · 驗證 Txx」、勘誤清單與手算題索引，真正的問題與第一張圖反而排在後面；章與章之間沒有交棒；跳章進來的讀者不會被攔下；也沒有閱讀時間。從這一輪起，章首與章末的固定結構由 `src/app/PageFrame.tsx` 依 `src/app/chapterMeta.ts` 的資料畫出來，章節本身只負責「問題 → 系統地圖」的順序，不再各自寫勘誤清單、手算索引、「符號表在最後」的連結或「下一章」的段落。

**章首的順序（每一章都一樣）**

1. `h1`（PageFrame；h1 上方不再有「規格書 §／驗證 T」的 eyebrow）。
2. **本章要回答的問題**：章節自己的第一個區塊（各章既有的「這次我們要回答的問題」callout／`.chNN-question`／導言段落）。它必須是章節 root 的第一個子元素，前面不放標籤列、目錄或任何索引。
3. **系統地圖**：`<SystemMap focus={…} />`（本頁第一張 `figure.c-mermaid`），緊接在問題之後；圖後面那一段「你在這裡：藍色方塊是本章的主角」加上 class **`c-map-note`**（可以和章節自己的 class 並用，例如 `className="ch05-system-map-note c-map-note"`）。
4. **本章資訊 strip**（`ChapterInfoStrip`，PageFrame 插在 3 之後）：規格書 §、驗證 T-id、三種模式的預估閱讀時間（目前模式加粗）、勘誤 N 項（連到驗證頁的勘誤瀏覽器）、手算 N 題（連到本頁第一題）、符號表 ↓（連到 `#symbols`）。
5. **模式提示**（原本在 h1 下方那一行，現在跟著 strip）。
6. **進來之前你應該會**（`PrereqCheck`）：2–4 條一句話的自檢，每條一個連結指到該去複習的章或小節；三種模式都展開。
7. 之後才是章節自己的標籤列（`ModelLevel`／`ClaimTag`／`TestBadge`／`Erratum`）、本章目錄、「怎麼讀方塊圖」等，然後進入正文。

**章末**：思考題、本課必記（Recap）、連結到 PLL／延伸 → **下一章要解決什麼**（`ChapterHandoff`，PageFrame 插在 `#symbols` 之前）→ 本章符號表（`#symbols`，頁面最後一個區塊）。

**怎麼運作**：PageFrame 在章節掛上來的同一個 commit 裡找「第一張 `figure.c-mermaid`（與緊接著的 `.c-map-note`）」和 `#symbols`，各放一個自己的 `<div data-chapter-slot>`，用 `createPortal` 把元件畫進去；章節重畫時 React 只動它自己建的節點，插槽留在原位；`MutationObserver` 會在 DOM 變動（模式切換、延後渲染）後重掃，所以「手算 N 題」數的是目前模式真的畫出來的 `.c-handcalc`。頁面上沒有圖／沒有 `#symbols` 時退回「內容前面／內容後面」。

**各章要做的事**：（a）問題區塊放第一、系統地圖放第二、地圖後的說明段落加 `c-map-note`；（b）刪掉自己寫的「本章符號表在最後 ↓」、清單式的勘誤索引與手算題索引（解釋勘誤**內容**的段落保留，例如 Ch01／Ch02 的「本章套用的勘誤」說明框）；（c）在 `src/app/chapterMeta.ts` 補一筆（欄位見 `docs/dev-conventions.md` §1.4）；（d）測試裡斷言 `root.firstElementChild` 是問題、`figure.c-sysmap` 緊接其後、`.c-map-note` 緊接圖後，並以 `expect(...本章符號表在最後...).toBeNull()` 守住不再出現舊的那一行。元件 API 見 `docs/dev/infra-api.md`。
