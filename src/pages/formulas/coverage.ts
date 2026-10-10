import { ERRATA } from './errata'
import { ALL_FORMULAS } from './registry'
import { GLOBAL_SYMBOLS, SYMBOL_COLLISIONS } from './symbols'
import { QUICK_REF } from './appendixA'
import { LIMITATIONS } from './appendixB'
import { GLOSSARY } from './glossary'
import { UNIT_TOPICS } from './searchIndex'

/**
 * 每一項勘誤在本頁與全站公式登錄中被引用的次數（Research 模式的「勘誤覆蓋」表）。
 * 測試要求：49 項勘誤每一項至少在本頁的某個表（符號、附錄 A／B、術語、單位）或公式登錄中出現一次。
 */
export interface ErratumCoverage {
  eid: string
  severity: string
  area: string
  formulas: string[]
  symbols: number
  quick: number
  limits: number
  glossary: number
  units: number
  /** 本頁（不含公式登錄）的引用總數 */
  onPage: number
}

export function errataCoverage(): ErratumCoverage[] {
  return ERRATA.map((e) => {
    const has = (ids: readonly string[] | undefined) => (ids ?? []).includes(e.eid)
    const symbols = GLOBAL_SYMBOLS.filter((s) => has(s.errata)).length + SYMBOL_COLLISIONS.filter((c) => has(c.errata)).length
    const quick = QUICK_REF.filter((q) => has(q.errata)).length
    const limits = LIMITATIONS.filter((l) => has(l.errata)).length
    const glossary = GLOSSARY.filter((g) => has(g.errata)).length
    const units = UNIT_TOPICS.filter((u) => has(u.errata)).length
    return {
      eid: e.eid,
      severity: e.severity,
      area: e.area,
      formulas: ALL_FORMULAS.filter((f) => f.erratumId === e.eid).map((f) => f.id),
      symbols,
      quick,
      limits,
      glossary,
      units,
      onPage: symbols + quick + limits + glossary + units,
    }
  })
}
