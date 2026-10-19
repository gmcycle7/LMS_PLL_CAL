/**
 * 跨章節共用的資料型別：公式登錄（Formula & Unit Reference 頁彙整）與實驗 preset（Experiment Gallery 彙整）。
 * 各章在自己的資料夾內 export，彙整頁用 import.meta.glob 收集，不需要中央清單。
 */
export type ClaimKind = 'exact' | 'approx' | 'research'
export type ModelLevelId = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6'
export type SourceKind = 'illustrative' | 'simulation' | 'literature' | 'measured'

/** 每章 `src/chapters/chNN/formulas.ts` 以 `export const FORMULAS: FormulaEntry[]` 匯出。 */
export interface FormulaEntry {
  /** 例如 'F-3.1'（章節號-序號），全站唯一 */
  id: string
  title: string
  /** KaTeX 原始碼 */
  tex: string
  /** 使用條件／假設（簡短） */
  conditions: string
  claim: ClaimKind
  level: ModelLevelId
  /** 規格書段落，例如 '3.1' */
  specSection: string
  /** 所在頁面路徑，例如 '/ch/03' */
  page: string
  /** 單位說明，例如 { mu: 'fs', K: 'fs^-1' } */
  units?: Record<string, string>
  /** 與勘誤相關時填入 validation.md 的條目 id */
  erratumId?: string
  /**
   * 「在哪個模型內精確」：claim 為 exact 時指的是哪個模型（線性小訊號、frozen weight、單頻、mean-field…）；
   * approx 時寫近似從哪個模型外推。一句話，支援 `$…$`。沒填時 /formulas 登錄表顯示該章 chapterMeta 的 models（docs/dev-conventions.md §5.1）。
   */
  assumes?: string
}

/** `src/data/presets/<id>.json` 的格式。 */
export interface PresetEntry {
  id: string
  title: string
  /** 規格 §19.2 的編號（1–12），其他 preset 省略 */
  galleryIndex?: number
  /** 例如 '/ch/06' 或 '/lab' */
  page: string
  /** 對應頁面中的 ExperimentShell id */
  experiment: string
  description: string
  params: Record<string, unknown>
  /** 載入後應看到的關鍵結果（文字，含數值），以及對應的測試 */
  expected: string
  tests?: string[]
  source: SourceKind
}

/* ───────────── 帶入手算（Hand calculation） ───────────── */

/** 手算題的一個輸入量。 */
export interface HandCalcInput {
  /** 程式內的 key，例如 'mu' */
  key: string
  /** TeX 符號，例如 '\\mu' */
  symbol: string
  /** 白話說明，例如 '學習率' */
  label: string
  /** 單位（TeX 或純文字），例如 '\\mathrm{fs}' */
  unit?: string
  /** 預設值（應與本章的 worked example 相同，方便對照） */
  default: number
  min?: number
  max?: number
  /** 只能是整數（例如 N、d） */
  integer?: boolean
  /**
   * 「換一題」時的隨機範圍：choices 優先；否則在 [min, max] 內以 step 為格點均勻抽樣。
   * 請選「手算友善」的數字（例如 0.05 的倍數、2 的冪次），不要抽出難以筆算的值。
   */
  practice?: { choices?: number[]; min?: number; max?: number; step?: number }
}

/** 帶入後的一步。 */
export interface HandCalcStep {
  /** 這一步的 TeX：左邊是符號式，右邊把數字代進去並算出結果，例如 'e_0 = y - w_0 x = 6 - 1\\times 2 = 4' */
  tex: string
  /** 為什麼這樣算／怎麼按計算機（支援 `$...$` 行內公式） */
  why: string
}

/** 最後要求的答案（可多個）。 */
export interface HandCalcResult {
  /** TeX 符號，例如 'w_1' */
  symbol: string
  /** 白話名稱，例如「更新後的係數」 */
  label?: string
  value: number
  unit?: string
  /** 顯示的有效位數（預設 5） */
  digits?: number
  /** 判定手算答案正確的容許誤差（預設相對 1%，並允許絕對 1e-9） */
  tolerance?: { abs?: number; rel?: number }
}

export interface HandCalcSolution {
  steps: HandCalcStep[]
  results: HandCalcResult[]
  /** 補充觀察，例如「|p| > 1 ⇒ 發散」（支援 `$...$`） */
  notes?: string[]
}

/**
 * 一題「帶入手算」。每章在 `src/chapters/chNN/handcalcs.ts` 以 `export const HANDCALCS: HandCalcDef[]` 匯出，
 * 章節內用 `<HandCalc def={...} />` 顯示；「手算練習簿」頁以 import.meta.glob 彙整。
 * solve() 內的數值必須呼叫 src/simulation 的實際函式（或與其交叉測試），不可另寫一套公式。
 */
export interface HandCalcDef {
  /** 'HC-03.1'（章-序號），全站唯一 */
  id: string
  title: string
  /** 所在頁面路徑，例如 '/ch/03' */
  page: string
  /** 對應的公式 ID（可省略） */
  formulaId?: string
  /** 通式（TeX，display mode） */
  formulaTex: string
  /** 難度：beginner 只需四則運算；engineer 需要計算機（開根號、log、三角函數）；research 需要查表或複數運算 */
  level: 'beginner' | 'engineer' | 'research'
  claim: ClaimKind
  inputs: HandCalcInput[]
  /** 輸入不合法或超出模型適用範圍時回傳原因（支援 `$...$`），否則回傳 null */
  validate?: (v: Record<string, number>) => string | null
  solve: (v: Record<string, number>) => HandCalcSolution
  /** 手算提示：例如「Φ(z) 在 |z| ≤ 0.1 時可用 0.5 + z/√(2π) 近似」（支援 `$...$`） */
  tips?: string[]
}
