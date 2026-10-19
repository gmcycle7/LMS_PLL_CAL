import type { LearningMode } from './settings'

/**
 * 章節頁的章首／章末骨架資料（docs/teaching-style.md §9、docs/dev-conventions.md §1.4）。
 * PageFrame 用它在每一章畫出：本章資訊 strip（ChapterInfoStrip）、先備自檢（PrereqCheck）與章末交棒（ChapterHandoff）；
 * 章節本身不再各自寫勘誤清單、手算索引、「符號表在最後」的連結與「下一章」的段落。
 *
 * 每個章節頁（ch00–ch14、ch11b、case-sspll）一筆；chapterMeta.test.ts 檢查：
 *   - 每個 group A／B／C 的頁面都有資料；
 *   - readingMinutes 是 5 的倍數、三種模式遞增；
 *   - errata 和 src/data/errata.json 裡 chapters 含本章的條目一致；
 *   - prereqs 2–4 條，指向存在的章與該章原始碼裡真的有的 id；
 *   - next 從 ch00 一路串到 ch14（case-sspll 掛在 ch07 之後、ch11b 掛在 ch11 之後），ch14 指向 sign-off 頁。
 */

/** 閱讀時間的估算係數（scratch 腳本 readingTime.mjs 與 estimateReadingMinutes 共用） */
export const READING_RATE = {
  /** 中文字／分鐘 */
  hanPerMinute: 350,
  /** 每條獨立公式（.katex-display）。0.5 分太長（手算題與推導的每一步都是一條公式，一章會算出 7 小時）；0.2 分 ≈ 掃一眼這一行在說什麼，推導本身的時間算在旁邊的中文說明裡 */
  formulaMinutes: 0.2,
  /** 每張圖（方塊圖 figure.c-mermaid 與 Plotly figure.c-plot） */
  figureMinutes: 0.5,
  /** 每個互動實驗（.c-exp） */
  experimentMinutes: 3,
} as const

export interface ReadingCounts {
  /** 畫面上看得到的中文字數（innerText 裡的漢字） */
  han: number
  /** 看得到的獨立公式數 */
  formulas: number
  /** 看得到的圖數 */
  figures: number
  /** 看得到的互動實驗數 */
  experiments: number
}

/** 分鐘 = 中文字數／350 + 0.2 × 公式 + 0.5 × 圖 + 3 × 實驗，四捨五入到 5 分鐘（最少 5） */
export function estimateReadingMinutes(c: ReadingCounts): number {
  const m = c.han / READING_RATE.hanPerMinute + READING_RATE.formulaMinutes * c.formulas + READING_RATE.figureMinutes * c.figures + READING_RATE.experimentMinutes * c.experiments
  return Math.max(5, Math.round(m / 5) * 5)
}

export interface ChapterPrereq {
  /** 一句自檢（支援 `$…$` 行內公式），例如「會算等比數列的和」 */
  label: string
  /** 該去複習的章：'00'–'14'、'11b' 或 '07b'（案例頁）；沒有對應章節（例如微積分本身）就不給 */
  ch?: string
  /** 小節標示，附在連結文字後，例如 '§1' */
  sec?: string
  /** 該章裡的錨點 id（元素的 id，例如 'fixed-x'）：給了就連到 `#/ch/03?a=fixed-x`，載入後會捲過去 */
  anchor?: string
}

export interface ChapterNext {
  /** 下一頁的 registry id：'ch05'、'case-sspll'、'signoff' */
  page: string
  /** 一句「下一章要解決什麼」（支援 `$…$`） */
  hook: string
}

/**
 * 「本章的『精確』是在哪個模型內」（2026-10-19，審查 depth：ClaimTag「精確｜指定模型」沒有說是哪個模型）。
 * 每章列 1–4 個：全站的模型層級 L0–L5（docs/assumptions.md §1）加上三個常見假設（frozen weight、單頻 regressor、mean-field）。
 * ChapterInfoStrip 顯示「本章的『精確』是在：…」一行（tooltip 列假設）；/formulas 的登錄表在公式沒有自己的 `assumes` 時顯示章的預設。
 */
export type ChapterModelId = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'frozen-weight' | 'single-tone' | 'mean-field'

export interface ChapterModel {
  id: ChapterModelId
  /** 顯示名稱，例如「線性小訊號 PLL（L2）」 */
  label: string
  /** 一句話：這個模型假設了什麼（支援 `$…$`；放進 aria／title 前要經 accessibleText） */
  assumes: string
}

/** 全站共用的模型清單：各章用 id 引用，label／assumes 全站一致 */
export const CHAPTER_MODEL_CATALOG: Record<ChapterModelId, ChapterModel> = {
  L0: { id: 'L0', label: '純量 LMS（L0）', assumes: '純量 LMS、每個 sample 更新一次，沒有 comparator 也沒有主 PLL 迴路；$x$ 固定或 iid' },
  L1: { id: 'L1', label: 'Block GMAC + Gaussian comparator（L1）', assumes: 'comparator 前雜訊 iid Gaussian，$E[q]\\approx K_qe$ 只在 $|e|\\ll\\sigma_v$ 成立（$K_q=\\sqrt{2/\\pi}/\\sigma_v$）' },
  L2: { id: 'L2', label: '線性小訊號 PLL（L2）', assumes: '主迴路線性化：$H_{\\mathrm{PD}}=1/(1+L)$、$T=L/(1+L)$，DTC 殘差從 PD 的 reference 端注入' },
  L3: { id: 'L3', label: '多參數線性平均模型（L3）', assumes: 'Jacobian $\\mathbf J$ 與相關矩陣 $\\mathbf R$ 在工作點附近當常數；各參數的誤差都在小訊號區' },
  L4: { id: 'L4', label: '雜訊 PSD 的線性化（L4）', assumes: '係數雜訊與輸出 jitter 用線性、平穩（WSS）的 PSD 傳遞；cyclostationary 交叉項不計' },
  L5: { id: 'L5', label: '定點暫存器（L5）', assumes: 'rounding／saturation／wrap 逐位元計算，餘數近似均勻（雜訊當 dither）；不是 bit-true RTL' },
  'frozen-weight': { id: 'frozen-weight', label: '凍結權重（frozen weight）', assumes: '時間尺度分離：$w$ 在 $H_{\\mathrm{PD}}$ 的記憶長度內視為常數（LMS 時間常數 $N/g$ 遠大於主迴路記憶）' },
  'single-tone': { id: 'single-tone', label: '單頻 regressor', assumes: 'regressor 是單一頻率的弦波，$C=\\tfrac{A^2}{2}|H|\\cos\\phi$；多頻時改用功率加權的 $\\mathrm{Re}\\,H$' },
  'mean-field': { id: 'mean-field', label: '平均（mean-field）模型', assumes: '把 $E[\\cdot]$ 移進遞迴、忽略 $w$ 與 $x$ 的相關：均值收斂 ≠ 均方穩定 ≠ 機率性有界' },
} as const

/**
 * `FormulaEntry.assumes` 的預設文字：「模型標籤：假設」，多個模型用「；」接起來（第一個是公式自己的層級，後面是它額外依賴的假設）。
 * 各章 formulas.ts 逐條寫 `assumes: modelAssumes('L1')`——文字只有 CHAPTER_MODEL_CATALOG 一份，改假設時所有公式一起跟著變；
 * 這條公式的條件比模型更特別時，直接寫一句自己的話（Ch04、案例頁、Sign-off 就是這樣）。
 */
export function modelAssumes(...ids: ChapterModelId[]): string {
  return ids.map((id) => `${CHAPTER_MODEL_CATALOG[id].label}：${CHAPTER_MODEL_CATALOG[id].assumes}`).join('；')
}

/** 從清單取一個模型（可以用章節自己的一句話覆寫 assumes） */
export function chapterModel(id: ChapterModelId, assumes?: string): ChapterModel {
  const m = CHAPTER_MODEL_CATALOG[id]
  return assumes ? { ...m, assumes } : m
}

/** 各章要填的資料（readingMinutes 由 reading 算出，不手填） */
export interface ChapterFrameMetaInput {
  /** 三種學習模式各量一次的內容量（scratch 腳本 readingTime.mjs 對 dev server 量：畫面上看得到的中文字數、獨立公式、圖、實驗） */
  reading: Record<LearningMode, ReadingCounts>
  /** 本章負責的勘誤（docs/validation.md 的 Exx；= errata.json 裡 chapters 含本章的條目） */
  errata: string[]
  /** 「進來之前你應該會」：2–4 條 */
  prereqs: ChapterPrereq[]
  /** 本章的「精確」是在哪些模型內（1–4 個；ChapterInfoStrip 顯示、/formulas 登錄表當預設） */
  models: ChapterModel[]
  /** 章末交棒：下一頁與它要解決的問題 */
  next: ChapterNext
}

export interface ChapterFrameMeta extends ChapterFrameMetaInput {
  /** 三種學習模式的預估閱讀時間（分鐘，5 的倍數）＝ estimateReadingMinutes(reading[mode]) */
  readingMinutes: Record<LearningMode, number>
}

/**
 * reading：2026-10-19 以 scripts/reading-time.mjs 對開發伺服器量三種模式（ch04、case-sspll 在 wave 4 depth-small 重量：§5b 與 §7b；ch11b 在整合時重量，其他章為章首骨架那一輪的量測）——
 * 整頁慢慢捲一遍讓延後載入的區塊長出來，再數 article.page 裡看得到的漢字（innerText）、.katex-display、figure.c-mermaid／figure.c-plot、.c-exp
 * （收合的 <details> 與 ModeGate 之外的內容不算）。重量方法見 docs/dev-conventions.md §1.4；分鐘數由 estimateReadingMinutes 算出。
 */
const RAW: Record<string, ChapterFrameMetaInput> = {
  ch00: {
    reading: {
      beginner: { han: 18857, formulas: 358, figures: 29, experiments: 2 },
      engineer: { han: 20738, formulas: 403, figures: 30, experiments: 2 },
      research: { han: 21169, formulas: 403, figures: 30, experiments: 2 },
    },
    errata: [],
    prereqs: [
      { label: '會對一個變數求導數（例如把 $\\tfrac12(y-wx)^2$ 對 $w$ 微分）' },
      { label: '知道等比數列 $r^n$ 在 $|r|<1$ 時會趨近 0' },
      { label: '知道把很多筆有雜訊的數字平均起來，起伏會變小' },
    ],
    models: [chapterModel('L0')],
    next: { page: 'ch01', hook: 'LMS 名字裡的 Least、Mean、Squares 各是什麼意思？一定要用平方嗎——換成絕對值，答案會停在另一個地方。' },
  },
  ch01: {
    reading: {
      beginner: { han: 20190, formulas: 356, figures: 38, experiments: 2 },
      engineer: { han: 21891, formulas: 440, figures: 38, experiments: 2 },
      research: { han: 23119, formulas: 457, figures: 39, experiments: 2 },
    },
    errata: ['E14', 'E38', 'E39', 'E40', 'E41', 'E42', 'E43'],
    prereqs: [
      { label: '會寫出 LMS 的三個動作與更新式 $w_{n+1}=w_n+\\mu e_nx_n$', ch: '00', sec: '§0.3', anchor: 'ch00-update' },
      { label: '知道 pole $p=1-\\mu x^2$：$\\mu$ 太大誤差會發散', ch: '00', sec: '§0.6', anchor: 'ch00-pole-derivation' },
      { label: '知道 $E[\\cdot]$ 是「做很多次的平均」、雜訊平均後縮小 $1/\\sqrt N$', ch: '00', sec: '§0.7', anchor: 'ch00-noise' },
    ],
    models: [chapterModel('L0')],
    next: { page: 'ch02', hook: '更新量 $\\mu e x$ 到底從哪裡來？從用完整坡度的 gradient descent，一路簡化到只用兩個正負號的 Sign-Sign，每一步丟掉了什麼。' },
  },
  ch02: {
    reading: {
      beginner: { han: 21586, formulas: 479, figures: 37, experiments: 5 },
      engineer: { han: 23380, formulas: 479, figures: 37, experiments: 5 },
      research: { han: 23682, formulas: 484, figures: 37, experiments: 5 },
    },
    errata: ['E14', 'E38', 'E39', 'E40', 'E41', 'E42', 'E43'],
    prereqs: [
      { label: '會對成本 $J(w)=\\tfrac12E[(y-wx)^2]$ 求導數、找到拋物線的最低點 $w^*$', ch: '01', sec: '§1.2', anchor: 'ch01-s12' },
      { label: '知道 MSE 的最佳解是平均、MAE 的最佳解是中位數', ch: '01', sec: '§2.3', anchor: 'ch01-s23' },
      { label: '會用數字把 LMS 更新兩步算出來', ch: '00', sec: '§0.4', anchor: 'ch00-hand' },
    ],
    models: [chapterModel('L0'), chapterModel('mean-field')],
    next: { page: 'ch03', hook: '$\\mu$ 要多小才會收斂？固定輸入時是一條等比數列；輸入變成隨機之後，「收斂」有三種不同的意思，界限可以差好幾倍。' },
  },
  ch03: {
    reading: {
      beginner: { han: 19978, formulas: 452, figures: 41, experiments: 3 },
      engineer: { han: 21333, formulas: 459, figures: 41, experiments: 3 },
      research: { han: 22091, formulas: 461, figures: 41, experiments: 3 },
    },
    errata: ['E14', 'E38', 'E39', 'E40', 'E41', 'E42', 'E43'],
    prereqs: [
      { label: '會算等比數列的和與極限（$|r|<1$ 時 $r^n\\to0$）', ch: '00', sec: '§0.6', anchor: 'ch00-pole-derivation' },
      { label: '知道 gradient descent 的步長上限從曲率來', ch: '02', sec: '§1', anchor: 'ch02-s1' },
      { label: '知道期望值 $E[\\cdot]$ 與變異數的定義', ch: '01', sec: '§1.1', anchor: 'ch01-s11' },
    ],
    models: [chapterModel('L0'), chapterModel('mean-field')],
    next: { page: 'ch04', hook: '把黑盒子打開：DSM → DTC → PD → GMAC → gain update 的訊號在晶片裡怎麼流，哪一個方塊對應 LMS 的哪一個動作。' },
  },
  ch04: {
    reading: {
      beginner: { han: 11883, formulas: 408, figures: 35, experiments: 5 },
      engineer: { han: 29459, formulas: 589, figures: 35, experiments: 5 },
      research: { han: 30187, formulas: 593, figures: 35, experiments: 5 },
    },
    errata: [],
    prereqs: [
      { label: '會寫 LMS 更新式，知道 $e\\cdot x$ 就是梯度的方向', ch: '02', sec: '§2', anchor: 'ch02-s2' },
      { label: '知道 Sign-Error LMS 只用誤差的正負號 $\\operatorname{sign}(e)$', ch: '02', sec: '§3', anchor: 'ch02-s3' },
      { label: '知道固定 $x$ 時 pole $p=1-\\mu x^2$ 決定收斂快慢', ch: '03', sec: '§1', anchor: 'fixed-x' },
    ],
    models: [chapterModel('L1'), chapterModel('L5'), chapterModel('frozen-weight')],
    next: { page: 'ch05', hook: 'comparator 只給 1 bit，雜訊又比誤差大 100 倍：方向的資訊還在嗎？要累加幾次才看得出來？$K_q$ 從這裡來。' },
  },
  ch05: {
    reading: {
      beginner: { han: 18197, formulas: 437, figures: 36, experiments: 2 },
      engineer: { han: 20074, formulas: 466, figures: 39, experiments: 2 },
      research: { han: 21755, formulas: 517, figures: 41, experiments: 2 },
    },
    errata: ['E02', 'E18'],
    prereqs: [
      { label: '知道 GMAC 把 $q[n]\\,x[n]$ 累加 $N$ 筆、每個 block 才更新一次係數', ch: '04' },
      { label: '知道 Sign-Error LMS 的更新只用 $\\operatorname{sign}(e)$', ch: '02', sec: '§3', anchor: 'ch02-s3' },
      { label: '會算期望值與變異數（平均值與離散程度）', ch: '03', sec: '§2', anchor: 'random-mean' },
    ],
    models: [chapterModel('L1')],
    next: { page: 'ch06', hook: 'comparator 取的是 PD 的輸出，而 PD 在主 PLL 迴路裡：PLL 把誤差的相位轉過 $90^\\circ$ 之後，GMAC 就往錯的方向更新。' },
  },
  ch06: {
    reading: {
      beginner: { han: 22700, formulas: 505, figures: 40, experiments: 3 },
      engineer: { han: 25876, formulas: 506, figures: 40, experiments: 3 },
      research: { han: 27903, formulas: 536, figures: 40, experiments: 3 },
    },
    errata: ['E44', 'E45', 'E46'],
    prereqs: [
      { label: '會算 $K_q=\\sqrt{2/\\pi}/\\sigma_v$ 與 block 迴路的 pole $p=1-\\mu K_q$', ch: '05', sec: '§5、§7' },
      { label: '知道等比數列 $p^k$：$|p|<1$ 才收斂', ch: '03', sec: '§1', anchor: 'fixed-x' },
      { label: '知道「兩個訊號相乘再平均」是相關，$E[\\cdot]$ 是平均', ch: '03', sec: '§2', anchor: 'random-mean' },
      { label: '知道主 PLL 的回授（loop filter → VCO → divider）會去追 PD 看到的誤差', ch: '04' },
    ],
    models: [chapterModel('L2'), chapterModel('single-tone'), chapterModel('frozen-weight')],
    next: { page: 'ch07', hook: '極性反了，調小 $\\mu$ 也救不回來：把 GMAC 的 code 延遲幾拍（delay alignment），或先用 PLL 的模型濾一次（filtered-x）——哪一招什麼時候有效？' },
  },
  ch07: {
    reading: {
      beginner: { han: 17179, formulas: 402, figures: 27, experiments: 1 },
      engineer: { han: 20766, formulas: 451, figures: 31, experiments: 1 },
      research: { han: 21351, formulas: 461, figures: 31, experiments: 1 },
    },
    errata: ['E44', 'E45', 'E46'],
    prereqs: [
      { label: '會算單頻 code 的相關 $C=\\tfrac{A^2}{2}|H|\\cos\\phi$ 與它的正負', ch: '06', sec: '§4', anchor: 'ch06-s4' },
      { label: '知道 $p=1-\\mu K_qC$：$C<0$ 任何正的 $\\mu$ 都發散', ch: '06', sec: '§3', anchor: 'ch06-s3' },
      { label: '知道 PD 看到的是被 $H_{\\mathrm{PD}}$ 濾過的 code $u=h*x$', ch: '06', sec: '§2', anchor: 'ch06-s2' },
    ],
    models: [chapterModel('L2'), chapterModel('single-tone'), chapterModel('frozen-weight')],
    next: { page: 'case-sspll', hook: '用在一顆真的晶片上：subsampling PLL 的 GOS（DTC gain）與 PHOS（8 相 PMUX）兩種 regressor，為什麼一個反號、一個不反號？' },
  },
  'case-sspll': {
    reading: {
      beginner: { han: 40268, formulas: 642, figures: 50, experiments: 3 },
      engineer: { han: 41607, formulas: 642, figures: 50, experiments: 3 },
      research: { han: 41705, formulas: 642, figures: 50, experiments: 3 },
    },
    errata: [],
    prereqs: [
      { label: '會由 $\\mathrm{Re}\\,H_{\\mathrm{PD}}<0$ 的頻帶判斷相關 $C$ 會不會變號', ch: '06', sec: '§4', anchor: 'ch06-s4' },
      { label: '知道多頻 code 的判據：把 regressor 的功率拆到各頻率再加權', ch: '06', sec: '§6', anchor: 'ch06-s6' },
      { label: '知道 delay alignment 只對準一個頻率、filtered-x 需要 PLL 的模型', ch: '07', sec: '§7.5', anchor: 'ch07-mismatch' },
    ],
    models: [chapterModel('L2'), chapterModel('L3'), chapterModel('frozen-weight')],
    next: { page: 'ch08', hook: '極性對了、$0<g<2$ 也滿足，校正迴路就一定穩嗎？更新延遲與主 PLL 的觀測動態會把穩定範圍縮一半。' },
  },
  ch08: {
    reading: {
      beginner: { han: 17979, formulas: 445, figures: 35, experiments: 2 },
      engineer: { han: 20365, formulas: 456, figures: 35, experiments: 2 },
      research: { han: 20880, formulas: 463, figures: 35, experiments: 2 },
    },
    errata: ['E19', 'E20'],
    prereqs: [
      { label: '會算 block 迴路的 loop gain $g=\\mu K_qC$ 與 pole $1-g$', ch: '06', sec: '§3', anchor: 'ch06-s3' },
      { label: '知道 $H_{\\mathrm{PD}}=1/(1+L)$ 把誤差濾過、轉了相位', ch: '06', sec: '§2', anchor: 'ch06-s2' },
      { label: '知道 $z^{-1}$ 是延遲一拍、pole 在單位圓內才穩定', ch: '03', sec: '§1', anchor: 'fixed-x' },
    ],
    models: [chapterModel('L1'), chapterModel('L2'), chapterModel('mean-field')],
    next: { page: 'ch09', hook: '迴路穩定、GMAC 也歸零，每個參數就學對了嗎？多參數時輸入要在每一個方向都持續有能量——persistent excitation。' },
  },
  ch09: {
    reading: {
      beginner: { han: 21556, formulas: 450, figures: 34, experiments: 2 },
      engineer: { han: 22576, formulas: 454, figures: 34, experiments: 2 },
      research: { han: 23104, formulas: 454, figures: 34, experiments: 2 },
    },
    errata: ['E04', 'E05', 'E21', 'E22', 'E23', 'E24', 'E25'],
    prereqs: [
      { label: '會算單參數 LMS 的 pole $1-g$ 與降到 5% 要幾個 block', ch: '08', sec: '§8.2', anchor: 'ch08-first-order' },
      { label: '知道 $K_q$ 的來源與單位（$\\mathrm{fs}^{-1}$）', ch: '05', sec: '§5' },
      { label: '知道 $H_{\\mathrm{PD}}(z=1)=0$：主 PLL 會把 DC 誤差吃掉', ch: '06', sec: '§5', anchor: 'ch06-s5' },
    ],
    models: [chapterModel('L3'), chapterModel('mean-field')],
    next: { page: 'ch10', hook: '好幾個 LMS loop 共用同一個 comparator：$\\mathbf R$ 的 eigenvalue 讓某個方向慢上百倍，更新矩陣 $\\mathbf M$ 要怎麼選才不會把雜訊放大？' },
  },
  ch10: {
    reading: {
      beginner: { han: 21347, formulas: 437, figures: 34, experiments: 1 },
      engineer: { han: 22902, formulas: 456, figures: 34, experiments: 1 },
      research: { han: 23229, formulas: 457, figures: 34, experiments: 1 },
    },
    errata: ['E04', 'E05', 'E21', 'E22', 'E23', 'E24', 'E25'],
    prereqs: [
      { label: '會算 $\\mathbf R$ 的 eigenvalue，知道 $\\lambda_{\\min}$ 決定最慢的模式', ch: '09', anchor: 'ch09-mean' },
      { label: '知道 PE 的定義與不可辨識（$\\lambda_{\\min}=0$）', ch: '09', sec: '§9.1', anchor: 'ch09-pe' },
      { label: '會算 $g=\\mu K_q\\lambda$ 與一階迴路的 pole', ch: '08', sec: '§8.2', anchor: 'ch08-first-order' },
    ],
    models: [chapterModel('L3'), chapterModel('mean-field')],
    next: { page: 'ch11', hook: 'GMAC 歸零不代表 DTC 誤差為零：offset、INL 與主迴路的 DC null 會把固定點 $w^*$ 推離真值 $a$。' },
  },
  ch11: {
    reading: {
      beginner: { han: 24815, formulas: 502, figures: 34, experiments: 3 },
      engineer: { han: 27172, formulas: 519, figures: 34, experiments: 3 },
      research: { han: 28033, formulas: 520, figures: 34, experiments: 3 },
    },
    errata: ['E01', 'E03', 'E17'],
    prereqs: [
      { label: '知道 Sign-LMS 的固定點由 $E[x\\,\\operatorname{sign}(e)]=0$ 決定', ch: '02', sec: '§3', anchor: 'ch02-s3' },
      { label: '會算 $K_q$，知道線性化 $E[q]\\approx K_q e$ 只在小誤差時成立', ch: '05', sec: '§5' },
      { label: '知道 $H_{\\mathrm{PD}}(z=1)=0$：主迴路把 DC 誤差吃掉', ch: '06', sec: '§5', anchor: 'ch06-s5' },
    ],
    models: [chapterModel('L1'), chapterModel('mean-field')],
    next: { page: 'ch11b', hook: 'gain 校正收斂、GMAC 歸零，但每個 code 的 INL $d(x)$ 還留在 PD 的輸出裡：它會把 MASH 推到高頻的量化雜訊折回帶內嗎？要校掉它需要幾個參數，分段／LUT／多項式哪一種划算？' },
  },
  ch11b: {
    reading: {
      beginner: { han: 11508, formulas: 196, figures: 14, experiments: 3 },
      engineer: { han: 11680, formulas: 196, figures: 14, experiments: 3 },
      research: { han: 12446, formulas: 196, figures: 14, experiments: 3 },
    },
    errata: [],
    prereqs: [
      { label: '知道 gain 校正的固定點 $w^*$ 與 bias 從哪裡來：GMAC 歸零不代表每個 code 的誤差為零', ch: '11', sec: '§11.A', anchor: 'ch11-fixed-point' },
      { label: '會算 $\\mathbf R=E[\\mathbf x\\mathbf x^T]$ 的 eigenvalue，知道 $\\lambda_{\\min}$ 決定最慢的模式', ch: '09', anchor: 'ch09-mean' },
      { label: '知道 preconditioning：更新矩陣 $\\mathbf M$ 把各方向的步長拉齊', ch: '10', sec: '§10.3', anchor: 'ch10-update-matrix' },
    ],
    models: [chapterModel('L3'), chapterModel('mean-field'), chapterModel('frozen-weight')],
    next: { page: 'ch12', hook: '收斂之後係數還在抖：comparator 的雜訊經 GMAC 變成 $\\sigma_w$，乘上 code、穿過 PLL 之後，是 jitter 還是一根 spur？' },
  },
  ch12: {
    reading: {
      beginner: { han: 20799, formulas: 523, figures: 36, experiments: 3 },
      engineer: { han: 22616, formulas: 528, figures: 37, experiments: 3 },
      research: { han: 23508, formulas: 546, figures: 38, experiments: 3 },
    },
    errata: ['E06', 'E26', 'E27', 'E28', 'E29'],
    prereqs: [
      { label: '會算 $K_q$ 與 block 迴路的 pole $p=1-\\mu K_q$', ch: '05', sec: '§5、§7' },
      { label: '知道一階迴路的頻寬與 phase margin 怎麼從 $g$ 算', ch: '08', sec: '§8.2', anchor: 'ch08-first-order' },
      { label: '知道固定點 $w^*$ 與 bias 從哪裡來', ch: '11', anchor: 'ch11-fixed-point' },
      { label: '知道 $H_{\\mathrm{PD}}=1/(1+L)$ 與 $T=L/(1+L)$ 是誤差的兩個出口', ch: '06', sec: '§2', anchor: 'ch06-s2' },
    ],
    models: [chapterModel('L4'), chapterModel('L1'), chapterModel('frozen-weight')],
    next: { page: 'ch13', hook: 'gain register 只有 6 bit：$w^*=32.4$ 要 freeze、toggle、dither 還是 $\\Delta\\Sigma$？平均正確不等於頻譜理想。' },
  },
  ch13: {
    reading: {
      beginner: { han: 21207, formulas: 479, figures: 42, experiments: 1 },
      engineer: { han: 23673, formulas: 486, figures: 42, experiments: 1 },
      research: { han: 24224, formulas: 490, figures: 42, experiments: 1 },
    },
    errata: ['E15', 'E16', 'E47', 'E48', 'E49'],
    prereqs: [
      { label: '知道係數的偏差怎麼乘上 code 變成 timing error：$\\delta t=x\\,\\delta w$', ch: '12', sec: '§12.6', anchor: 'ch12-mix' },
      { label: '知道 PSD、tone 與 PLL 低通 $T(f)$ 的關係', ch: '12', sec: '§12.7', anchor: 'ch12-pll' },
      { label: '知道 DSM 累加器怎麼產生 fractional residue', ch: '04' },
    ],
    models: [chapterModel('L5')],
    next: { page: 'ch14', hook: '$\\mu$、$N$ 與更新幾次 $B$ 到底怎麼選？最快收斂、最小終點 RMS、最少 spur、最佳 PVT 追蹤，各自的答案都不同。' },
  },
  ch14: {
    reading: {
      beginner: { han: 21402, formulas: 437, figures: 39, experiments: 3 },
      engineer: { han: 22702, formulas: 438, figures: 39, experiments: 3 },
      research: { han: 23338, formulas: 441, figures: 39, experiments: 3 },
    },
    errata: ['E15', 'E16', 'E47', 'E48', 'E49'],
    prereqs: [
      { label: '會算 $g=\\mu K$、pole $1-g$ 與降到 5% 要幾個 block', ch: '08', sec: '§8.2', anchor: 'ch08-first-order' },
      { label: '會算穩態係數雜訊 $\\sigma_w^2=\\mu^2\\sigma_\\eta^2/(1-p^2)$', ch: '12', sec: '§12.1', anchor: 'ch12-sigma' },
      { label: '知道量化策略（freeze／toggle／dither／$\\Delta\\Sigma$）各把誤差放在哪個頻率', ch: '13', anchor: 'ch13-criteria' },
    ],
    models: [chapterModel('L1'), chapterModel('mean-field')],
    next: { page: 'signoff', hook: '把十五章的結論變成可以簽核的清單：哪些結論是精確的、哪些需要驗證，以及晶片量測要量什麼。' },
  },
}

export const CHAPTER_FRAME_META: Record<string, ChapterFrameMeta> = Object.fromEntries(
  Object.entries(RAW).map(([id, m]) => [
    id,
    { ...m, readingMinutes: { beginner: estimateReadingMinutes(m.reading.beginner), engineer: estimateReadingMinutes(m.reading.engineer), research: estimateReadingMinutes(m.reading.research) } },
  ]),
)

export function chapterFrameMeta(pageId: string): ChapterFrameMeta | undefined {
  return CHAPTER_FRAME_META[pageId]
}

/** 從 ch00 沿著 next 走出來的章節順序（測試用；走到不在表裡的頁面（sign-off）就停） */
export function chapterChain(start = 'ch00'): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  let cur: string | undefined = start
  while (cur && CHAPTER_FRAME_META[cur] && !seen.has(cur)) {
    out.push(cur)
    seen.add(cur)
    cur = CHAPTER_FRAME_META[cur].next.page
  }
  return out
}
