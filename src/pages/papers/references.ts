/**
 * 規格書附錄 D 的 7 份文獻 + 背景教科書（Papers / Reading 頁的資料；純資料、無 React）。
 *
 * 書目核對（2026-10-10，同日複核一次）：
 *   - D1–D6 的作者、題名、出處、卷期、頁碼、日期、會議地點以各 DOI 的 Crossref 紀錄（api.crossref.org/works/<DOI>）核對；
 *     DOI 本身與規格書附錄 D 完全相同，沒有新增或改動任何 DOI。
 *   - D7 是課程講義，沒有 DOI。規格書給的 PDF 連結在核對日回傳 HTTP 404；課程頁仍列出同一講次的 2026 版（HTTP 200）。
 *   - 本站**沒有**逐頁核對論文內文。因此「文獻主張」只寫到題名本身可以確定的範圍，另外原樣列出規格書附錄 D 的描述，
 *     並標明「未經本站核對」。所有公式與數字都是本站自己推導、自己計算的（見 bridge.ts），不是論文的結果。
 *   - 教科書只列到書籍層級（作者、書名、出版社；只有確定時才寫版次或年份），不引用頁碼或章節編號。
 */

export type PaperId = 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6' | 'D7'
export type PaperKind = 'conference' | 'journal' | 'lecture'
export type ReadingLevel = 'intro' | 'intermediate' | 'advanced'

export const KIND_LABEL: Record<PaperKind, string> = {
  conference: '會議論文',
  journal: '期刊論文',
  lecture: '課程講義（非同行審查）',
}

export const LEVEL_LABEL: Record<ReadingLevel, string> = {
  intro: '入門',
  intermediate: '中階',
  advanced: '進階',
}

export interface PaperRef {
  id: PaperId
  /** 規格書附錄 D 的編號（1–7） */
  specIndex: number
  authors: string[]
  title: string
  /** 期刊 / 會議全名 */
  venue: string
  kind: PaperKind
  year: number
  /** 出版月份（Crossref published 日期） */
  month?: number
  volume?: string
  issue?: string
  /** 頁碼範圍，例如 '4029–4037' */
  pages?: string
  publisher?: string
  /** 會議地點（Crossref 有記錄時） */
  location?: string
  /** 與規格書附錄 D 完全相同的 DOI（小寫正規化前的原樣） */
  doi?: string
  /** 沒有 DOI 時的連結 */
  links?: { label: string; url: string; status?: string }[]
  /** 講義等非正式出版品在 BibTeX 的 howpublished（英文） */
  howpublished?: string
  /** 書目資料的核對來源 */
  verifiedBy: string
  /** 一句話：為什麼這個網站的讀者要讀它 */
  relevance: string
  /** 題名本身可以確定的「已發表主張」 */
  titleClaim: string
  /** 規格書附錄 D 的原文描述（本站未核對） */
  specNote: string
  /** 相關的本站頁面（src/app/registry.ts 的 id） */
  pages_: string[]
  level: ReadingLevel
  /** 建議閱讀順序（1 = 最先） */
  order: number
  /** 讀之前先準備的數學（對應頁面上的 Prereq 框） */
  prereqs: string[]
  /** 怎麼讀：要先找什麼、怎麼對到本站符號 */
  tips: string[]
  /** 與本站的哪些勘誤有關 */
  errata: string[]
}

export const PAPERS: PaperRef[] = [
  {
    id: 'D1',
    specIndex: 1,
    authors: ['Tuan Minh Vo'],
    title: 'Analysis of LMS Gain Variation in DTC-Based Fractional-N Digital PLLs',
    venue: '2019 IEEE Asia Pacific Conference on Postgraduate Research in Microelectronics and Electronics (PrimeAsia)',
    kind: 'conference',
    year: 2019,
    month: 11,
    pages: '5–8',
    publisher: 'IEEE',
    location: 'Bangkok, Thailand',
    doi: '10.1109/PRIMEASIA47521.2019.8950679',
    verifiedBy: 'Crossref 紀錄（2026-10-10）',
    relevance: String.raw`和本站主題最直接相關：在 DTC-based fractional-N digital PLL 裡，LMS 校正出來的 DTC gain 在穩態附近會變動（gain variation）。適合拿來對照本站 Ch12 的係數雜訊模型（$\sigma_w$）以及它經 DSM code 混頻後對 PLL 輸出的影響。`,
    titleClaim: '題名：對 DTC-based fractional-N digital PLL 中的 LMS gain variation 進行分析。',
    specNote: '研究 DTC PLL 中 LMS Gain Variation 的統計/頻譜分析。',
    pages_: ['ch04', 'ch05', 'ch12', 'ch14'],
    level: 'intermediate',
    order: 3,
    prereqs: ['期望值與變異數', 'Gaussian 與 $K_q$', 'Z transform 與 pole', 'PSD'],
    tips: [
      '先找三件事：(1) 論文的 gain variation 指的是係數本身的變動，還是換算成輸出 jitter；(2) LMS 是線性 LMS、sign-error 或 sign-sign，更新率與累加長度各是多少；(3) 用了哪一個 PLL 轉移函數。',
      String.raw`把這三件事對到本站 Ch12 的 $\delta w_k$、$\mu$、$N$、$H_{\eta\to w}$ 之後再比較公式；單位（$\mathrm{fs}$、$\mathrm{rad}$、$\mathrm{LSB}$）要先統一。`,
      String.raw`本站 Ch12 的 $\sigma_w$ 是 illustrative 參數下的 gain-equivalent 數字（數值見下方面板），不是這篇論文的結果，也不是 output jitter。`,
    ],
    errata: ['E06', 'E09', 'E10', 'E30'],
  },
  {
    id: 'D2',
    specIndex: 2,
    authors: ['Rufus Fraanje', 'Michel Verhaegen', 'Stephen J. Elliott'],
    title: 'Robustness of the Filtered-X LMS Algorithm—Part I: Necessary Conditions for Convergence and the Asymptotic Pseudospectrum of Toeplitz Matrices',
    venue: 'IEEE Transactions on Signal Processing',
    kind: 'journal',
    year: 2007,
    month: 8,
    volume: '55',
    issue: '8',
    pages: '4029–4037',
    publisher: 'IEEE',
    doi: '10.1109/TSP.2007.896083',
    verifiedBy: 'Crossref 紀錄（2026-10-10）',
    relevance: String.raw`Filtered-x LMS（FxLMS）在誤差路徑模型不準時的收斂必要條件。本站的 GMAC 改用 delayed-x 或 filtered-x 時（Ch07）就是 FxLMS 的結構，PLL 的 $H_{\mathrm{PD}}$ 扮演誤差路徑；多參數時還要看矩陣的特徵值（Ch09、Ch10）。`,
    titleClaim: '題名：給出 Filtered-X LMS 收斂的必要條件，並與 Toeplitz 矩陣的 asymptotic pseudospectrum 相連；題名標明這是 Part I。',
    specNote: '介紹 Filtered-x Path Model 與 Cross-Correlation 特徵值/穩定性。',
    pages_: ['ch06', 'ch07', 'case-sspll', 'ch08', 'ch10'],
    level: 'advanced',
    order: 5,
    prereqs: ['相關（correlation）', '矩陣與特徵值', 'Z transform 與 pole', 'PSD'],
    tips: [
      '數學最重的一篇：需要矩陣特徵值、Z transform，以及 Toeplitz 矩陣（由自相關 $R_x[i-j]$ 排成的矩陣）。建議讀完本站 Ch06–Ch07 的單頻與多頻相關判據、Ch09 的 eigenvalue 之後再讀。',
      String.raw`主動控制（active control）文獻常把「從控制輸出到誤差感測器」的路徑稱為 secondary path，並以加 hat 的符號表示它的模型；對應本站的 $H_{\mathrm{PD}}$ 與 $\hat H$。各篇記號不同，以原文定義為準。`,
      '注意「必要條件」與「充分條件」的差別：必要條件不成立一定不收斂；成立也不保證收斂。本站的單頻 $C>0$ 判據同樣只是必要條件。',
    ],
    errata: ['E44', 'E45', 'E46'],
  },
  {
    id: 'D3',
    specIndex: 3,
    authors: ['Michael A. Vaudrey', 'William T. Baumann', 'William R. Saunders'],
    title: 'Stability and operating constraints of adaptive LMS-based feedback control',
    venue: 'Automatica',
    kind: 'journal',
    year: 2003,
    month: 4,
    volume: '39',
    issue: '4',
    pages: '595–605',
    publisher: 'Elsevier',
    doi: '10.1016/S0005-1098(02)00288-1',
    verifiedBy: 'Crossref 紀錄（2026-10-10）',
    relevance: String.raw`回授型（feedback）adaptive LMS 控制的穩定性與操作限制。本站的校正迴路與主 PLL 形成雙迴路，更新延遲也會縮小穩定區間（Ch08）；這篇是控制領域的對照讀物，提醒「單頻 $\pm90^\circ$ 的極性判據」不等於完整的穩定性分析。`,
    titleClaim: '題名：探討以 LMS 為基礎的 adaptive feedback control 的穩定性（stability）與操作限制（operating constraints）。',
    specNote: '說明回授型 Adaptive LMS 不可只依靠 ±90° 的簡化判據。',
    pages_: ['ch06', 'ch07', 'ch08', 'case-sspll'],
    level: 'intermediate',
    order: 4,
    prereqs: ['Z transform 與 pole', '相位裕度（PM）'],
    tips: [
      String.raw`先複習本站 Ch08：$L(z)=g\,z^{-d}/(z-1)$、PM 與更新延遲的臨界增益 $g^*(d)$。`,
      '讀的時候確認論文的「穩定」是對哪一個模型而言：線性化的平均模型、含 plant dynamics 的完整回授，還是含雜訊的隨機系統。',
    ],
    errata: ['E19', 'E20'],
  },
  {
    id: 'D4',
    specIndex: 4,
    authors: ['Rishabh Gurbaxani', 'Cicero S. Vaucher', 'Masoud Babaie'],
    title: '12.1 A 74fs-Jitter, −59dBc-Spur Fractional-N DPLL Using a Supply-Resilient Time-Amplifying Dual-Ramp DTC',
    venue: '2026 IEEE International Solid-State Circuits Conference (ISSCC)',
    kind: 'conference',
    year: 2026,
    month: 2,
    pages: '208–210',
    publisher: 'IEEE',
    location: 'San Francisco, CA, USA',
    doi: '10.1109/ISSCC49663.2026.11409328',
    verifiedBy: 'Crossref 紀錄（2026-10-10）；題名前的「12.1」是 ISSCC 的論文編號',
    relevance:
      '近期的 DTC-based fractional-N DPLL 晶片實例。規格書把它列為 DTC code randomization 與 near-integer 校正準確度／收斂的參考。適合在讀完本站 Ch04、Ch09、Ch11、Ch13 之後，看真實晶片如何處理 DTC 非理想、spur 與校正。',
    titleClaim:
      '題名報告的量測結果：74 fs jitter、−59 dBc spur；架構關鍵字：supply-resilient、time-amplifying dual-ramp DTC。這些是作者的量測主張，本站沒有使用、也無法重現。',
    specNote: 'DTC Code Randomization、Near-Integer calibration accuracy/convergence。',
    pages_: ['ch04', 'ch09', 'ch11', 'ch13', 'lab'],
    level: 'advanced',
    order: 8,
    prereqs: ['PSD', '相關（correlation）', '矩陣與特徵值'],
    tips: [
      'ISSCC 論文篇幅很短（頁數見上方書目），通常只放關鍵電路圖、架構與量測摘要；細節要配合作者其他著作或發表材料。',
      '讀的時候分清楚哪些數字是量測（measured）、哪些是模擬，以及 jitter 的積分頻寬、spur 是在哪一個 FCW 量到的。',
      String.raw`本站不使用其中任何數字：本站的 $\sigma_w$、spur 例子都是 illustrative，模型層級也不同。`,
    ],
    errata: ['E17'],
  },
  {
    id: 'D5',
    specIndex: 5,
    authors: ['Michael Peter Kennedy', 'Hongjia Mo', 'Brian Fitzgibbon'],
    title: 'Spurious tones in digital delta-sigma modulators resulting from pseudorandom dither',
    venue: 'Journal of the Franklin Institute',
    kind: 'journal',
    year: 2015,
    month: 8,
    volume: '352',
    issue: '8',
    pages: '3325–3344',
    publisher: 'Elsevier',
    doi: '10.1016/j.jfranklin.2015.01.012',
    verifiedBy: 'Crossref 紀錄（2026-10-10）',
    relevance:
      '數位 ΔΣ modulator（DDSM）即使加入 pseudorandom dither，仍可能出現 spurious tones。本站 Ch13 討論 6-bit gain 的 ΔΣ／dither 與 limit cycle，Ch04 的 DSM code 本身也是決定性、週期性的序列。',
    titleClaim: '題名：pseudorandom dither 本身可能在 digital delta-sigma modulator 中造成 spurious tones。',
    specNote: 'PRBS/DDSM 週期性與 Spurs 的限制。',
    pages_: ['ch13', 'ch04', 'ch12'],
    level: 'intermediate',
    order: 6,
    prereqs: ['DFT 與線譜', 'PSD'],
    tips: [
      String.raw`先讀本站 Ch13 的 $w_H=32.4\ \mathrm{LSB}$ 例子與下方「有限狀態 $\Rightarrow$ 最終週期」的推導，再讀這篇對 PRBS dither 的分析。`,
      '注意區分：dither 讓「平均」的頻譜變平，和「每一條譜線都消失」是兩回事；週期性的 dither 產生的仍然是線譜。',
    ],
    errata: ['E15', 'E47'],
  },
  {
    id: 'D6',
    specIndex: 6,
    authors: ['Zhichao Tan', 'Roberto Maurino', 'Robert Adams', 'Khiem Nguyen'],
    title: 'Subtractive dithering technique for delta-sigma modulator',
    venue: '2017 IEEE International Symposium on Circuits and Systems (ISCAS)',
    kind: 'conference',
    year: 2017,
    month: 5,
    pages: '1–4',
    publisher: 'IEEE',
    location: 'Baltimore, MD, USA',
    doi: '10.1109/ISCAS.2017.8050371',
    verifiedBy: 'Crossref 紀錄（2026-10-10）',
    relevance:
      'ΔΣ modulator 的 subtractive dithering。對照本站 Ch13：一般（non-subtractive）dither 把 tone 打散，但總誤差功率增加；subtractive dither 在下游把 dither 減回去。',
    titleClaim: '題名：提出一種用於 delta-sigma modulator 的 subtractive dithering technique。',
    specNote: 'Dither、Idle Tones 與 Noise Trade-off。',
    pages_: ['ch13'],
    level: 'intermediate',
    order: 7,
    prereqs: ['期望值與變異數', 'DFT 與線譜'],
    tips: [
      String.raw`先讀下方 subtractive vs non-subtractive 的本站推導（誤差功率 $1/12$ vs $f(1-f)$，單位 $\mathrm{LSB}^2$），再看論文在 ΔΣ 結構中如何把 dither 減回去。`,
      '對應到 DTC gain register 時要問：減回 dither 的那一步需要比 1 LSB 更細的解析度，硬體上由誰提供？',
    ],
    errata: ['E15'],
  },
  {
    id: 'D7',
    specIndex: 7,
    authors: ['D. P. Mandic'],
    title: 'Statistical Signal Processing & Inference — Adaptive Filters Lecture 7',
    venue: 'Imperial College London 課程講義（Statistical Signal Processing and Inference）',
    howpublished: 'Lecture slides, Imperial College London',
    kind: 'lecture',
    year: 2025,
    links: [
      {
        label: '規格書所列 PDF（2025）',
        url: 'https://www.commsp.ee.ic.ac.uk/~mandic/ASP_Slides/SSPI_Lecture_7_Adaptive_Filters_2025.pdf',
        status: '2026-10-10 核對時回傳 HTTP 404',
      },
      {
        label: '課程頁（列出目前版本的各講次）',
        url: 'https://www.commsp.ee.ic.ac.uk/~mandic/courses.htm',
        status: '2026-10-10 可連線；列出「Lecture 7: Adaptive Estimation and Inference」',
      },
      {
        label: '課程頁目前連到的 Lecture 7 PDF（2026 版）',
        url: 'https://www.commsp.ee.ic.ac.uk/~mandic/SSPI_Slides/SSPI_Lecture_7_Adaptive_Filters_2026.pdf',
        status: '2026-10-10 可連線（檔案大於 10 MB）；內容未經本站核對',
      },
    ],
    verifiedBy: '課程頁核對（2026-10-10）；講義沒有 DOI',
    relevance: 'LMS 的 mean / mean-square 收斂與 eigenvalue 分析的講義，數學門檻最低，適合當第一份外部讀物，用來複習本站 Ch03、Ch09 的推導。',
    titleClaim: '講義主題（依規格書題名與課程頁）：adaptive filters / adaptive estimation，屬於 Statistical Signal Processing and Inference 課程第 7 講。',
    specNote: 'LMS Mean/Mean-Square、Eigenvalue-based 收斂分析。',
    pages_: ['ch03', 'ch09', 'ch10', 'ch14'],
    level: 'intro',
    order: 1,
    prereqs: ['期望值與變異數', '矩陣與特徵值'],
    tips: [
      String.raw`講義的符號可能和本站不同：誤差極性、$\mu$ 是否帶 2 倍、regressor 是行向量還是列向量。先用本頁 §4「同一個 LMS，三種寫法」對照。`,
      '講義是課程材料，不是同行審查的論文；版本每年更新，引用時寫明你讀的是哪一年的版本。',
    ],
    errata: ['E05', 'E08', 'E14', 'E23', 'E41'],
  },
]

export function paperById(id: PaperId): PaperRef {
  const p = PAPERS.find((x) => x.id === id)
  if (!p) throw new Error(`找不到文獻 ${id}`)
  return p
}

/** DOI → https://doi.org/ 連結（DOI 的保留字元 ( ) 不需要編碼，doi.org 直接解析）。 */
export function doiUrl(doi: string): string {
  return `https://doi.org/${doi}`
}

/** 頁碼範圍 → 頁數（'4029–4037' → 9）；無法解析時回傳 null。 */
export function pageCount(pages?: string): number | null {
  if (!pages) return null
  const m = /^(\d+)\s*[–-]\s*(\d+)$/.exec(pages)
  if (!m) return null
  const a = Number(m[1])
  const b = Number(m[2])
  return b >= a ? b - a + 1 : null
}

const MONTH = ['', 'Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.']

/** IEEE 風格的一行引用（不含 DOI；DOI 另外以連結顯示）。 */
export function formatCitation(p: PaperRef): string {
  const authors = p.authors.length <= 2 ? p.authors.join(' and ') : `${p.authors.slice(0, -1).join(', ')}, and ${p.authors[p.authors.length - 1]}`
  const parts = [`${authors}, “${p.title},”`, p.kind === 'conference' ? `in ${p.venue},` : `${p.venue},`]
  if (p.location) parts.push(`${p.location},`)
  if (p.volume) parts.push(`vol. ${p.volume},`)
  if (p.issue) parts.push(`no. ${p.issue},`)
  if (p.pages) parts.push(`pp. ${p.pages},`)
  parts.push(`${p.month ? `${MONTH[p.month]} ` : ''}${p.year}.`)
  return parts.join(' ')
}

/** BibTeX 的 key：第一作者姓氏（小寫、去掉非字母）+ 年份 + 規格書編號，例如 'fraanje2007d2'。 */
export function bibtexKey(p: PaperRef): string {
  const family = p.authors[0].split(' ').slice(-1)[0]
  return `${family.toLowerCase().replace(/[^a-z]/g, '')}${p.year}${p.id.toLowerCase()}`
}

const BIB_MONTH = ['', 'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * 把文字欄位轉成可以直接貼進 .bib 用 LaTeX 編譯的形式（只做符號轉寫，不改內容）：
 *   反斜線以外的 LaTeX 特殊字元 & % # _ $ 加上反斜線（D7 題名裡的 & 不跳脫會編譯失敗）；
 *   em dash（U+2014）→ `---`、en dash（U+2013）→ `--`、Unicode 減號（U+2212）→ ASCII `-`
 *   （D4 的 Crossref 題名本來就是 ASCII 的 `-59dBc`；pdfLaTeX 預設不認得 U+2212）。
 * URL 與 DOI 不經過這個函式（它們的 `_`、`~`、`%` 必須原樣保留）。
 */
export function latexEscape(text: string): string {
  return text
    .replace(/([&%#_$])/g, '\\$1')
    .replace(/\u2014/g, '---')
    .replace(/\u2013/g, '--')
    .replace(/\u2212/g, '-')
}

/**
 * 由上面核對過的欄位產生 BibTeX（不新增任何欄位）。題名以雙層大括號保留大小寫；頁碼用 BibTeX 慣用的 `--`；
 * 文字欄位經 latexEscape() 轉成純 ASCII 的 LaTeX 寫法。
 * 講義沒有 DOI：輸出 @misc，howpublished 放課程名稱，url 放核對日仍可連線的連結。
 */
export function toBibtex(p: PaperRef): string {
  const type = p.kind === 'journal' ? 'article' : p.kind === 'conference' ? 'inproceedings' : 'misc'
  const fields: [string, string][] = [
    ['author', latexEscape(p.authors.join(' and '))],
    ['title', `{${latexEscape(p.title)}}`],
  ]
  if (p.kind === 'journal') fields.push(['journal', latexEscape(p.venue)])
  if (p.kind === 'conference') fields.push(['booktitle', latexEscape(p.venue)])
  if (p.kind === 'lecture') {
    fields.push(['howpublished', latexEscape(p.howpublished ?? p.venue)])
    // 規格書給的 PDF 連結已失效時，改放核對日仍可連線的第一個連結
    const live = p.links?.find((l) => !/404/.test(l.status ?? '')) ?? p.links?.[0]
    if (live) fields.push(['url', live.url])
  }
  if (p.volume) fields.push(['volume', p.volume])
  if (p.issue) fields.push(['number', p.issue])
  if (p.pages) fields.push(['pages', p.pages.replace(/[–-]/, '--')])
  if (p.location) fields.push(['address', latexEscape(p.location)])
  if (p.publisher) fields.push(['publisher', latexEscape(p.publisher)])
  fields.push(['year', String(p.year)])
  if (p.doi) fields.push(['doi', p.doi])
  const body = fields.map(([k, v]) => `  ${k} = {${v}},`).join('\n')
  const month = p.month ? `\n  month = ${BIB_MONTH[p.month]},` : ''
  return `@${type}{${bibtexKey(p)},\n${body}${month}\n}`
}

/** 依建議閱讀順序排列 */
export const PAPERS_BY_ORDER: PaperRef[] = [...PAPERS].sort((a, b) => a.order - b.order)

// ───────────────────────── 背景教科書（書籍層級） ─────────────────────────

export interface BookRef {
  id: string
  authors: string
  title: string
  /** 出版社；版次或年份只在確定時寫 */
  publisher: string
  edition?: string
  /** 為什麼讀、讀哪一類主題（不引用章節編號） */
  why: string
  pages_: string[]
}

export interface BookTopic {
  id: string
  topic: string
  /** 這個主題在本站哪裡第一次用到 */
  usedFor: string
  books: BookRef[]
}

export const BOOK_TOPICS: BookTopic[] = [
  {
    id: 'lms',
    topic: 'LMS / NLMS / RLS（自適應濾波主教材）',
    usedFor: String.raw`Ch00–Ch03 的 LMS 推導、mean / mean-square 穩定；Ch10 的 preconditioning（RLS 以遞迴估計的 $\mathbf R^{-1}$ 取代純量步長，和 $\mathbf M=\gamma\mathbf R^{-1}$ 的想法相同）`,
    books: [
      {
        id: 'widrow-stearns',
        authors: 'B. Widrow and S. D. Stearns',
        title: 'Adaptive Signal Processing',
        publisher: 'Prentice-Hall',
        edition: '1985',
        why: String.raw`LMS 原創者之一寫的教科書；更新式用 $2\mu$ 的寫法（見本頁 §4「同一個 LMS，三種寫法」），幾何直覺很多，適合第一次接觸 performance surface 與 eigenvalue spread。`,
        pages_: ['ch01', 'ch03', 'ch09'],
      },
      {
        id: 'haykin',
        authors: 'S. Haykin',
        title: 'Adaptive Filter Theory',
        publisher: 'Prentice Hall／Pearson',
        edition: '多個版次',
        why: '最常被引用的研究所教材：Wiener filter、steepest descent、LMS、NLMS、RLS、Kalman 一路推導。注意書中的 $u(n)$ 是輸入向量，和本站的 $u[n]$（經 PLL 誤差路徑的 regressor）不同。',
        pages_: ['ch03', 'ch09', 'ch10', 'ch14'],
      },
      {
        id: 'sayed-2003',
        authors: 'A. H. Sayed',
        title: 'Fundamentals of Adaptive Filtering',
        publisher: 'Wiley／IEEE Press',
        edition: '2003',
        why: '以 energy conservation 的觀點統一分析 LMS 家族的 mean-square 行為與穩態誤差；數學較嚴謹，適合 Research 模式的讀者。',
        pages_: ['ch03', 'ch12', 'ch14'],
      },
      {
        id: 'sayed-2008',
        authors: 'A. H. Sayed',
        title: 'Adaptive Filters',
        publisher: 'Wiley／IEEE Press',
        edition: '2008',
        why: '同一作者的另一本教材，可用來查單一主題（例如 NLMS 與 RLS 的比較）。',
        pages_: ['ch03', 'ch10'],
      },
      {
        id: 'diniz',
        authors: 'P. S. R. Diniz',
        title: 'Adaptive Filtering: Algorithms and Practical Implementation',
        publisher: 'Springer',
        edition: '多個版次',
        why: '涵蓋多種 LMS 變形（包含 quantized-error／sign 類）與有限字長效應，偏實作，適合對照本站的 1-bit GMAC 與定點議題。',
        pages_: ['ch02', 'ch10'],
      },
    ],
  },
  {
    id: 'prob',
    topic: '機率與隨機過程（期望值、Gaussian、相關、PSD）',
    usedFor: String.raw`Ch05 的 comparator 統計（$\Phi$、$\mathrm{erf}$、CLT）、Ch06 的相關、Ch12 的 PSD`,
    books: [
      {
        id: 'papoulis',
        authors: 'A. Papoulis and S. U. Pillai',
        title: 'Probability, Random Variables, and Stochastic Processes',
        publisher: 'McGraw-Hill',
        edition: '第 4 版，2002',
        why: '隨機變數、期望值、相關函數、功率頻譜密度的標準參考書；查定義與定理用。',
        pages_: ['ch05', 'ch06', 'ch12'],
      },
      {
        id: 'kay',
        authors: 'S. M. Kay',
        title: 'Fundamentals of Statistical Signal Processing, Volume I: Estimation Theory',
        publisher: 'Prentice Hall',
        edition: '1993',
        why: '估計理論（偏差、變異數、最小平方、Cramér–Rao 下界）；本站 Ch11 的 bias 與 Ch12 的 variance 可以放進這個框架理解。',
        pages_: ['ch11', 'ch12', 'ch14'],
      },
    ],
  },
  {
    id: 'dsp',
    topic: '離散時間訊號（Z transform、DTFT、DFT）',
    usedFor: String.raw`Ch06–Ch08 的 $H(e^{j\Omega})$、pole、PM；Ch12–Ch13 的頻譜與線譜`,
    books: [
      {
        id: 'oppenheim',
        authors: 'A. V. Oppenheim and R. W. Schafer',
        title: 'Discrete-Time Signal Processing',
        publisher: 'Prentice Hall／Pearson',
        edition: '多個版次',
        why: String.raw`Z transform、DTFT、DFT、取樣與濾波器的標準教材；本站所有 $\Omega$（rad/sample）的定義與它一致。`,
        pages_: ['ch06', 'ch08', 'ch12', 'ch13'],
      },
    ],
  },
  {
    id: 'linalg',
    topic: '線性代數（特徵值、特徵向量、SVD）',
    usedFor: 'Ch09 的 persistent excitation、Ch10 的 Jacobian 與 preconditioner',
    books: [
      {
        id: 'strang',
        authors: 'G. Strang',
        title: 'Introduction to Linear Algebra',
        publisher: 'Wellesley-Cambridge Press',
        edition: '多個版次',
        why: '從零開始講特徵值、對稱矩陣、SVD，非常適合只學過微積分的讀者。',
        pages_: ['ch09', 'ch10'],
      },
    ],
  },
  {
    id: 'control',
    topic: 'Filtered-x、主動控制與 adaptive control（回授中的 LMS）',
    usedFor: 'Ch06–Ch08 的極性、delayed-x / filtered-x、雙迴路；D2、D3 的背景',
    books: [
      {
        id: 'elliott',
        authors: 'S. J. Elliott',
        title: 'Signal Processing for Active Control',
        publisher: 'Academic Press',
        edition: '2001',
        why: 'Filtered-x LMS 與主動控制的系統性教材；作者也是 D2 的共同作者之一。',
        pages_: ['ch07', 'ch08'],
      },
      {
        id: 'kuo-morgan',
        authors: 'S. M. Kuo and D. R. Morgan',
        title: 'Active Noise Control Systems: Algorithms and DSP Implementations',
        publisher: 'Wiley',
        edition: '1996',
        why: 'FxLMS 的實作導向教材：secondary path 建模、延遲與步長的實務。',
        pages_: ['ch07'],
      },
      {
        id: 'astrom',
        authors: 'K. J. Åström and B. Wittenmark',
        title: 'Adaptive Control',
        publisher: 'Addison-Wesley',
        edition: '第 2 版，1995',
        why: '控制觀點的 adaptive 系統：參數估計與回授迴路一起動時的穩定性問題。',
        pages_: ['ch08'],
      },
    ],
  },
  {
    id: 'dsm',
    topic: 'ΔΣ、量化與 dither',
    usedFor: 'Ch04 的 DSM code、Ch13 的 limit cycle / dither / noise shaping；D5、D6 的背景',
    books: [
      {
        id: 'schreier-temes',
        authors: 'R. Schreier and G. C. Temes',
        title: 'Understanding Delta-Sigma Data Converters',
        publisher: 'Wiley／IEEE Press',
        edition: '2005；第 2 版（S. Pavan、R. Schreier、G. C. Temes）2017',
        why: 'ΔΣ 調變、noise transfer function、idle tones 的標準教材。',
        pages_: ['ch04', 'ch13'],
      },
    ],
  },
  {
    id: 'pll',
    topic: 'PLL 與全數位頻率合成',
    usedFor: 'Ch04 的 DSM → DTC → PD 訊號流、Ch06 的 PLL error transfer',
    books: [
      {
        id: 'gardner',
        authors: 'F. M. Gardner',
        title: 'Phaselock Techniques',
        publisher: 'Wiley',
        edition: '第 3 版，2005',
        why: 'PLL 迴路動態、type / order、transfer function 的經典教材。',
        pages_: ['ch04', 'ch06'],
      },
      {
        id: 'staszewski',
        authors: 'R. B. Staszewski and P. T. Balsara',
        title: 'All-Digital Frequency Synthesizer in Deep-Submicron CMOS',
        publisher: 'Wiley',
        edition: '2006',
        why: '全數位 PLL（ADPLL）的架構與數位校正觀念，適合連到本站的 DPLL / DTC 情境。',
        pages_: ['ch04'],
      },
    ],
  },
]

/** 閱讀路線圖（Mermaid flowchart；diagram 測試以真正的 mermaid parser 驗證語法）。 */
export const READING_PATH_CHART = `flowchart TD
  S0["本站 Ch00–Ch03：LMS、mean / mean-square"] --> D7["D7 Mandic 講義：eigenvalue 與收斂"]
  D7 --> TB["教科書的 LMS 章節：Widrow & Stearns / Haykin / Sayed"]
  TB --> D1["D1 Vo 2019：DTC PLL 的 LMS gain variation"]
  S1["本站 Ch04、Ch05、Ch12"] --> D1
  TB --> D3["D3 Vaudrey et al. 2003：回授 LMS 的穩定性"]
  S2["本站 Ch06–Ch08"] --> D3
  D3 --> D2["D2 Fraanje et al. 2007：FxLMS 收斂必要條件"]
  S3["本站 Ch09–Ch10"] --> D2
  S4["本站 Ch13"] --> D5["D5 Kennedy et al. 2015：PRBS dither 的 spurs"]
  D5 --> D6["D6 Tan et al. 2017：subtractive dither"]
  D1 --> D4["D4 Gurbaxani et al. 2026：DTC DPLL 晶片實例"]
  D2 --> D4
  D6 --> D4`
