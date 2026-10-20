/**
 * 勘誤索引：每條勘誤的嚴重度與區域（49 條）。
 *
 * 這個檔案是產物，不要手改——由 `node scripts/build-errata-index.mjs` 從 src/data/errata.json 推導；
 * src/data/errataIndex.test.ts 驗證它和 errata.json 一致（改了 errata.json 沒重跑，CI 的 unit job 會失敗）。
 *
 * 用途：行內的「勘誤 Exx」徽章（links/ErratumLink、chapter/ChapterErratum）只要嚴重度（顏色、浮動提示的「（嚴重）」）和區域，
 * 不需要完整文字；import 完整的 errata.json（約 75 KB）會讓它被打包進每一頁都會載入的主 chunk。
 * 需要 problem／correction／evidence 的頁面（驗證頁、Dashboard、Roadmap、Gallery）和 ChapterErratumNote（延後載入）才讀 errata.json。
 */

export type ErratumSeverity = 'high' | 'medium' | 'low'

export interface ErratumIndexEntry {
  severity: ErratumSeverity
  /** 勘誤所屬的區域（純文字，例如 '§11 Bias / INL'） */
  area: string
}

export const ERRATA_INDEX: Readonly<Record<string, ErratumIndexEntry>> = {
  E01: { severity: 'high', area: '§11 Bias / INL' },
  E02: { severity: 'high', area: '§5 Comparator' },
  E03: { severity: 'medium', area: '§11 Bias / INL' },
  E04: { severity: 'medium', area: '§9–10 PE / MIMO' },
  E05: { severity: 'medium', area: '§9–10 PE / MIMO' },
  E06: { severity: 'medium', area: '§12 Noise / Spur' },
  E07: { severity: 'medium', area: '全文符號與單位一致性' },
  E08: { severity: 'medium', area: '全文符號與單位一致性' },
  E09: { severity: 'medium', area: '全文符號與單位一致性' },
  E10: { severity: 'medium', area: '全文符號與單位一致性' },
  E11: { severity: 'medium', area: '全文符號與單位一致性' },
  E12: { severity: 'medium', area: '全文符號與單位一致性' },
  E13: { severity: 'medium', area: '全文符號與單位一致性' },
  E14: { severity: 'medium', area: 'Part A（§1–3）' },
  E15: { severity: 'medium', area: '§13–14 Quantization / Learning Rate' },
  E16: { severity: 'medium', area: '§13–14 Quantization / Learning Rate' },
  E17: { severity: 'low', area: '§11 Bias / INL' },
  E18: { severity: 'low', area: '§5 Comparator' },
  E19: { severity: 'low', area: '§8 Phase Margin / Dual Loop' },
  E20: { severity: 'low', area: '§8 Phase Margin / Dual Loop' },
  E21: { severity: 'low', area: '§9–10 PE / MIMO' },
  E22: { severity: 'low', area: '§9–10 PE / MIMO' },
  E23: { severity: 'low', area: '§9–10 PE / MIMO' },
  E24: { severity: 'low', area: '§9–10 PE / MIMO' },
  E25: { severity: 'low', area: '§9–10 PE / MIMO' },
  E26: { severity: 'low', area: '§12 Noise / Spur' },
  E27: { severity: 'low', area: '§12 Noise / Spur' },
  E28: { severity: 'low', area: '§12 Noise / Spur' },
  E29: { severity: 'low', area: '§12 Noise / Spur' },
  E30: { severity: 'low', area: '全文符號與單位一致性' },
  E31: { severity: 'low', area: '全文符號與單位一致性' },
  E32: { severity: 'low', area: '全文符號與單位一致性' },
  E33: { severity: 'low', area: '全文符號與單位一致性' },
  E34: { severity: 'low', area: '全文符號與單位一致性' },
  E35: { severity: 'low', area: '全文符號與單位一致性' },
  E36: { severity: 'low', area: '全文符號與單位一致性' },
  E37: { severity: 'low', area: '全文符號與單位一致性' },
  E38: { severity: 'low', area: 'Part A（§1–3）' },
  E39: { severity: 'low', area: 'Part A（§1–3）' },
  E40: { severity: 'low', area: 'Part A（§1–3）' },
  E41: { severity: 'low', area: 'Part A（§1–3）' },
  E42: { severity: 'low', area: 'Part A（§1–3）' },
  E43: { severity: 'low', area: 'Part A（§1–3）' },
  E44: { severity: 'low', area: '§6–7 Polarity / Delay / Filtered-x' },
  E45: { severity: 'low', area: '§6–7 Polarity / Delay / Filtered-x' },
  E46: { severity: 'low', area: '§6–7 Polarity / Delay / Filtered-x' },
  E47: { severity: 'low', area: '§13–14 Quantization / Learning Rate' },
  E48: { severity: 'low', area: '§13–14 Quantization / Learning Rate' },
  E49: { severity: 'low', area: '§13–14 Quantization / Learning Rate' },
}

/** 依編號（'E44'）取索引項；沒有這個編號回 undefined（含 'constructor' 之類的原型屬性名） */
export function erratumIndexEntry(id: string): ErratumIndexEntry | undefined {
  return Object.hasOwn(ERRATA_INDEX, id) ? ERRATA_INDEX[id] : undefined
}
