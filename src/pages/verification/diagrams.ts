/**
 * Verification 頁的方塊圖原始碼（docs/teaching-style.md §8；diagrams.test.tsx 以真正的 mermaid 解析並「畫出來」逐一檢查）。
 *
 * 規則：
 * - 節點文字用 Unicode 數學符號（Mermaid 不渲染 KaTeX）；含括號、等號、絕對值符號、斜線的文字一律用雙引號包住。
 * - 加法點是圓形節點，文字寫全形「＋」；每條進來的邊以「＋」或「−」（U+2212）開頭。
 *   Mermaid 11 把標籤當 Markdown：單獨的 ASCII「+」「-」會被當成清單，畫面上變成「Unsupported markdown: list」。
 * - 顏色在深淺主題下都看得清楚：藍 = 本張圖的主角、綠 = 通過、紅 = 不通過／出錯、棕 = 需要小心的分支。
 * - 四張圖各對應程式裡的一個函式或一份資料，測試會逐一核對：
 *     CHART_TOLERANCE   ↔ src/simulation/models/acceptance.ts 的 toleranceBound／diffNumeric（F-VF.1）
 *     CHART_PIPELINE    ↔ golden/、src/simulation/models/、scripts/verify.mjs、src/data/verification-status.json
 *     CHART_STATUS      ↔ scripts/verify.mjs 的 statusOf（測試直接執行那個函式，走過四種組合）
 *     CHART_ERRATA_FLOW ↔ docs/validation.md、src/data/errata.json、acceptance.ts 的 computeErrataEvidence（F-VF.13）
 */
import { ERRATA } from './errata'

const FOCUS = 'classDef focus fill:#1f5fa8,stroke:#0d3b6e,color:#ffffff,stroke-width:2px'
const ALT = 'classDef alt fill:#8a4b08,stroke:#5c3205,color:#ffffff,stroke-width:2px'
const PASS = 'classDef pass fill:#1d7a46,stroke:#0f4d2b,color:#ffffff,stroke-width:2px'
const WARN = 'classDef warn fill:#b42318,stroke:#7a160f,color:#ffffff,stroke-width:2px'

/**
 * §V.1：一個元素怎麼判定通過（F-VF.1；與 numpy.isclose 同一條規則）。
 * Δ = a_k − e_k（網站為正、golden 為負）；b_k = ε_abs + ε_rel·|e_k|；通過 ⇔ |Δ| ≤ b_k。
 * 上排是誤差，下排是容許量；e_k 同時進入兩條路，這就是「接近 0 靠絕對項、很大靠相對項」的原因。
 */
export const CHART_TOLERANCE = `flowchart LR
  A(["a_k<br/>網站即時算出<br/>（actual）"]) -- "＋" --> D(("＋"))
  E(["e_k<br/>golden 的期望值<br/>（expected）"]) -- "−" --> D
  D -- "a_k − e_k" --> ABS["取絕對值<br/>|Δ| = |a_k − e_k|"]
  ABS --> CMP{"|Δ| ≤ b_k ？"}
  E --> AE["|e_k|"]
  AE --> REL["× ε_rel<br/>相對項"]
  REL -- "＋ ε_rel·|e_k|" --> B(("＋"))
  EA(["ε_abs<br/>絕對項"]) -- "＋" --> B
  B -- "b_k = ε_abs + ε_rel·|e_k|" --> CMP
  CMP -- "是" --> OK["通過"]
  CMP -- "否" --> BAD["不一致"]
  ${FOCUS}
  ${PASS}
  ${WARN}
  class B focus
  class OK pass
  class BAD warn`

/** §V.5：一個 T-id 從「寫測試」到「顯示 verified」要走過的路（只有 TestBadge 讀 verification-status.json）。 */
export const CHART_PIPELINE = `flowchart LR
  S["規格 §17<br/>T01–T18"] --> V["docs/validation.md<br/>${ERRATA.length} 項勘誤"]
  V --> PY["Python golden<br/>NumPy / SciPy"]
  PY --> J["golden/vectors<br/>Txx.json"]
  PY --> PT["pytest<br/>test_Txx_…"]
  J --> TS["Vitest<br/>it('Txx: …')"]
  M["各章 TS 模型<br/>lms / comparator / …"] --> TS
  M --> PG["本頁即時重算<br/>acceptance.ts"]
  J --> PG
  TS --> VR["scripts/verify.mjs"]
  PT --> VR
  VR --> SJ["verification-status.json"]
  SJ --> B["TestBadge<br/>只有 pass = verified"]
  ${FOCUS}
  ${PASS}
  class VR focus
  class B pass`

/**
 * §V.5：verify.mjs 的 statusOf(ts, py)。先看失敗，再看兩邊是否都有通過的測試。
 * 測試直接執行 statusOf，對 (ts.failed, ts.passed, py.failed, py.passed) 的組合逐一走一次這張圖。
 */
export const CHART_STATUS = `flowchart TD
  TS["TypeScript 端<br/>title 以「Txx:」開頭的 it()"] --> Q1{"任何一邊<br/>有失敗的測試？"}
  PY["Python 端<br/>函式名稱 test_Txx_…"] --> Q1
  Q1 -- "有" --> F["✗ fail<br/>verify 結束碼 1"]
  Q1 -- "沒有" --> Q2{"兩邊都有<br/>通過的測試？"}
  Q2 -- "是" --> P["✓ pass<br/>才顯示 verified"]
  Q2 -- "否" --> Q3{"至少一邊<br/>有通過的測試？"}
  Q3 -- "是" --> PA["◐ partial<br/>只有一邊"]
  Q3 -- "否" --> MI["○ missing<br/>pending"]
  ${PASS}
  ${WARN}
  ${ALT}
  class P pass
  class F warn
  class PA alt`

/**
 * §V.6：規格書的一項聲明怎麼變成網站上的一張勘誤卡片，以及「即時重算證據」只有部分勘誤才有。
 * 上半是 docs/validation.md 的稽核流程（稽核者重算 → 懷疑者反駁），下半是網站怎麼用它（errata.json → 各章標記與本頁卡片）。
 */
export const CHART_ERRATA_FLOW = `flowchart LR
  SPEC["規格書的一項聲明<br/>公式、數值或穩定性"] --> AUD["稽核 agent<br/>用 Python 重算"]
  AUD --> Q1{"重算結果<br/>與規格一致？"}
  Q1 -- "一致" --> OK["不需要勘誤"]
  Q1 -- "不一致" --> SK{"獨立的懷疑者<br/>能反駁嗎？"}
  SK -- "能反駁" --> REF["已反駁<br/>不列為勘誤"]
  SK -- "反駁失敗" --> E["勘誤 Exx<br/>docs/validation.md"]
  E --> J["src/data/errata.json"]
  J --> SITE["網站一律採用修正後版本<br/>各章的「勘誤 Exx」標記連到本頁"]
  J --> EV["computeErrataEvidence()<br/>部分勘誤：重算文件引用的數字"]
  EV --> CARD["本頁的勘誤卡片<br/>#/verification?e=Exx"]
  SITE --> CARD
  ${FOCUS}
  ${PASS}
  ${ALT}
  class E focus
  class OK pass
  class REF alt`

/** 本頁全部的圖（名稱、所在段落、原始碼），依頁面上出現的順序。 */
export const VERIFICATION_CHARTS: { name: string; section: string; chart: string }[] = [
  { name: 'CHART_TOLERANCE', section: '§V.1', chart: CHART_TOLERANCE },
  { name: 'CHART_PIPELINE', section: '§V.5', chart: CHART_PIPELINE },
  { name: 'CHART_STATUS', section: '§V.5', chart: CHART_STATUS },
  { name: 'CHART_ERRATA_FLOW', section: '§V.6', chart: CHART_ERRATA_FLOW },
]
