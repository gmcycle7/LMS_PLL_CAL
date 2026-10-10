/**
 * 「六條件一分鐘體檢」的 presets。
 * src/data/presets/ 不屬於 Dashboard，因此這裡內建一份；若日後有人新增 experiment = 'dashboard-thesis-check'
 * 的 PresetEntry JSON，頁面會透過 presetsForExperiment / useUrlPreset 一併載入（參數先經 sanitizeParams 檢查）。
 */
import { DEFAULT_PARAMS, PARAM_RANGE, type ThesisParams } from './thesisModel'

export const EXPERIMENT_ID = 'dashboard-thesis-check'

export interface ThesisPreset {
  id: string
  /** 純文字名稱（preset 下拉選單、匯出報告用；<select> 無法排版 TeX） */
  name: string
  /** 同一個名稱的 TeX 版（$…$ 為 TeX）；頁面內文（條件卡片的「載入反例」）使用 */
  rich?: string
  /** 純文字說明：只用在 title 屬性（下拉選單與按鈕的 tooltip），瀏覽器不會排版 TeX，所以這裡保留 Unicode 符號 */
  description: string
  /** 只列出與預設值不同的參數 */
  patch: Partial<ThesisParams>
  /** 預期哪個條件失敗（測試用；undefined 代表全部通過） */
  expectFail?: string[]
}

export const THESIS_PRESETS: ThesisPreset[] = [
  {
    id: 'thesis-t13',
    name: 'T13 標準例：六項全過',
    description: 'σ_v = 100 fs、N = 4096、μ = 10 fs、unit-RMS code、identity path：p ≈ 0.92021、σ_w ≈ 0.399 fs。',
    patch: {},
  },
  {
    id: 'thesis-phase120',
    name: 'φ = 120°：極性錯誤（T06）',
    rich: '$\\phi=120^\\circ$：極性錯誤（T06）',
    description: 'PLL error transfer 的相位讓 C < 0：正的 μ 反而發散。',
    patch: { phiDeg: 120, Px: 0.5 },
    expectFail: ['polarity', 'stability', 'variance', 'bias', 'system'],
  },
  {
    id: 'thesis-delay-fix',
    name: 'φ = −120°、Ω = π/6、D = 4：用 code delay 修回（T07）',
    description: 'θ = φ + ΩD = 0°，單頻相關回到最大。',
    patch: { phiDeg: -120, omega: Math.PI / 6, D: 4, Px: 0.5 },
  },
  {
    id: 'thesis-rho099',
    name: 'ρ = 0.99：慢模式（T10 / T11）',
    description: '兩個參數高度相關：λ_min = 0.01、κ = 199，弱方向要幾千個 block。',
    patch: { twoParam: true, rho: 0.99 },
  },
  {
    id: 'thesis-rho099-precond',
    name: 'ρ = 0.99 + preconditioner：快了，但弱方向雜訊放大',
    rich: '$\\rho=0.99$ ＋ preconditioner：快了，但弱方向雜訊放大',
    description: 'M = μR̃⁻¹：所有 mode 一樣快，但弱方向的係數雜訊功率放大 1/λ̃_min（目前 code 下的 δt 卻看不出來）。',
    patch: { twoParam: true, rho: 0.99, update: 'precond' },
    expectFail: ['variance'],
  },
  {
    id: 'thesis-no-pe',
    name: 'ρ = 1：完全不可辨識',
    rich: '$\\rho=1$：完全不可辨識',
    description: '兩個 regressor 完全相同：(1, −1) 方向凍結在初值。',
    patch: { twoParam: true, rho: 1 },
    expectFail: ['identifiability', 'bias', 'system'],
  },
  {
    id: 'thesis-sum-mode',
    name: 'GMAC sum 模式忘了 /N（反面測試）',
    description: '有效 g 放大 N = 4096 倍：g ≈ 326.8，pole ≈ −325.8。',
    patch: { gmacMode: 'sum' },
    expectFail: ['stability', 'variance', 'system'],
  },
  {
    id: 'thesis-latency',
    name: 'μ = 100 fs + 2 blocks commit latency',
    rich: '$\\mu=100\\,\\mathrm{fs}$ ＋ 2 個 block 的 commit latency',
    description: 'g ≈ 0.798 > g*(2) = 0.618：只因為更新晚了兩個 block 就發散。',
    patch: { mu: 100, d: 2 },
    expectFail: ['stability', 'variance', 'system'],
  },
  {
    id: 'thesis-small-c',
    name: 'φ = 85°：C 很小，bias 被放大',
    description: 'C = cos 85° ≈ 0.087：同樣 B = 0.1 fs，Δw = B/C ≈ 1.15 fs；g 變小，σ_w ∝ 1/√g 也變大。',
    patch: { phiDeg: 85 },
    expectFail: ['variance', 'bias', 'system'],
  },
  {
    id: 'thesis-bias-only',
    name: 'B = 1.5 fs：GMAC 歸零，gain 卻偏了 1.5 fs',
    rich: '$B=1.5\\,\\mathrm{fs}$：GMAC 歸零，gain 卻偏了 $1.5\\,\\mathrm{fs}$',
    description: '極性、穩定、σ_w 全部過關，但 code 相關的干擾讓固定點移到 a + B/C = a + 1.5 fs：收斂得很漂亮，收斂到錯的地方。',
    patch: { B: 1.5 },
    expectFail: ['bias', 'system'],
  },
  {
    id: 'thesis-spur-t15',
    name: '13 GHz、0.5 fs peak tone（T15）',
    rich: '$13\\,\\mathrm{GHz}$ 輸出、$0.5\\,\\mathrm{fs}$ peak tone（T15）',
    description: 'A = 1（P_x = 1/2）、B = 0.25 fs ⇒ Δw = 0.5 fs ⇒ spur ≈ −93.8 dBc；把 spur 上限設 −95 dBc 看 system-level 失敗。',
    patch: { Px: 0.5, B: 0.25, spurLimit: -95 },
    expectFail: ['system'],
  },
]

export function presetParams(p: ThesisPreset): ThesisParams {
  return { ...DEFAULT_PARAMS, ...p.patch }
}

/** 內建 preset（也可用網址 `#/?preset=<id>` 載入） */
export function builtinPreset(id: string | null | undefined): ThesisPreset | undefined {
  return id ? THESIS_PRESETS.find((p) => p.id === id) : undefined
}

/**
 * 外部（URL / JSON）來的參數只保留型別正確、在合法範圍內的欄位，避免舊版 preset 寫入不相容的值。
 */
export function sanitizeParams(raw: unknown): Partial<ThesisParams> {
  if (!raw || typeof raw !== 'object') return {}
  const src = raw as Record<string, unknown>
  const out: Partial<ThesisParams> = {}
  for (const key of Object.keys(DEFAULT_PARAMS) as (keyof ThesisParams)[]) {
    const v = src[key]
    if (v === undefined) continue
    if (key === 'gmacMode') {
      if (v === 'average' || v === 'sum') out.gmacMode = v
    } else if (key === 'update') {
      if (v === 'scalar' || v === 'precond') out.update = v
    } else if (key === 'twoParam') {
      if (typeof v === 'boolean') out.twoParam = v
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      const [lo, hi] = PARAM_RANGE[key]
      if (v >= lo && v <= hi) (out as Record<string, number>)[key] = v
    }
  }
  if (out.N !== undefined) out.N = Math.round(out.N)
  if (out.D !== undefined) out.D = Math.round(out.D)
  if (out.d !== undefined) out.d = Math.round(out.d)
  return out
}
