import type { HandCalcDef } from '@/data/types'

/** 各章與各頁匯出的手算題（`handcalcs.ts` 內的 `HANDCALCS`）。彙整頁用，不需要中央清單。 */
const modules = {
  ...import.meta.glob<HandCalcDef[]>('../chapters/*/handcalcs.ts', { eager: true, import: 'HANDCALCS' }),
  ...import.meta.glob<HandCalcDef[]>('../pages/*/handcalcs.ts', { eager: true, import: 'HANDCALCS' }),
}

export const ALL_HANDCALCS: HandCalcDef[] = Object.values(modules)
  .flat()
  .filter(Boolean)
  .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))

export function handcalcById(id: string): HandCalcDef | undefined {
  return ALL_HANDCALCS.find((h) => h.id === id)
}

export function handcalcsForPage(page: string): HandCalcDef[] {
  return ALL_HANDCALCS.filter((h) => h.page === page)
}
