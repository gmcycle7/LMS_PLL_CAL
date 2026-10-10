import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { mathText, TexBlock } from '@/components'
import { useSettings, type LearningMode } from '@/app/settings'
import {
  ACCEPTANCE_IDS,
  compareToGolden,
  computeErrataEvidence,
  computeNegativeValues,
  evaluateMutants,
  runAllAcceptance,
  type AcceptanceComputation,
  type AcceptanceId,
  type AcceptanceValues,
  type ErratumEvidence,
  type GoldenComparison,
  type IndependentCheck,
  type MutantResult,
} from '@/simulation/models/acceptance'
import { ACCEPTANCE_ROWS, type AcceptanceRowMeta } from './data'
import { GOLDEN, GOLDEN_NEGATIVE } from './golden'
import { erratumById, erratumHref, SEVERITY_LABEL } from './errata'
import { ERRATA_MATH } from './errataMath'
import { FORMULAS } from './formulas'
import { texToPlain } from './format'

/**
 * 驗證頁的共用狀態與小元件（ver- 前綴；不放進共用層）。
 * 確定性的 T01–T18 計算、反面測試、mutant 與勘誤證據只做一次（數十 ms），由 Provider 分給各段落。
 */

export interface AcceptanceRowResult {
  meta: AcceptanceRowMeta
  comp: AcceptanceComputation | null
  cmp: GoldenComparison | null
  error: string | null
}

/** 某勘誤在驗收表中的即時比對（T-id + 第二條獨立路徑） */
export interface ErratumLiveCheck {
  tid: AcceptanceId
  check: IndependentCheck
}

export interface AcceptanceState {
  rows: AcceptanceRowResult[]
  byId: Record<AcceptanceId, AcceptanceRowResult>
  negative: GoldenComparison
  /** computeNegativeValues 丟出例外時的訊息（此時 negative 的每個 key 都是「未計算」） */
  negativeError: string | null
  mutants: MutantResult[]
  /** 勘誤的數值證據（errata.json 引用的數字，以章節模型即時重算） */
  evidence: ErratumEvidence[]
  evidenceByEid: Record<string, ErratumEvidence[]>
  /** 勘誤 → 驗收表中標註了它的獨立比對 */
  checksByEid: Record<string, ErratumLiveCheck[]>
  evidencePassed: number
  evidenceError: string | null
  totalMs: number
  keysTotal: number
  keysPassed: number
  keysFailed: number
  keysMissing: number
  rowsPassed: number
  checksTotal: number
  checksPassed: number
}

const Ctx = createContext<AcceptanceState | null>(null)

/** 執行全部確定性驗收（純計算；可在測試中直接呼叫） */
export function computeAcceptanceState(now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())): AcceptanceState {
  const t0 = now()
  const { results, errors } = runAllAcceptance(now)
  const totalMs = now() - t0
  const rows: AcceptanceRowResult[] = ACCEPTANCE_ROWS.map((meta) => {
    const comp = results.find((r) => r.id === meta.id) ?? null
    return {
      meta,
      comp,
      cmp: comp ? compareToGolden(GOLDEN[meta.id], comp.values) : null,
      error: errors[meta.id] ?? null,
    }
  })
  const byId = Object.fromEntries(rows.map((r) => [r.meta.id, r])) as Record<AcceptanceId, AcceptanceRowResult>
  // 反面測試的即時值：某個章節模型丟錯時，全部 key 回報「未計算」（incomplete），並把原因顯示在 §V.4——驗證頁不可因此整頁壞掉
  let negativeValues: AcceptanceValues = {}
  let negativeError: string | null = null
  try {
    negativeValues = computeNegativeValues()
  } catch (e) {
    negativeError = e instanceof Error ? e.message : String(e)
  }
  const negative = compareToGolden(GOLDEN_NEGATIVE, negativeValues)
  const mutants = evaluateMutants(GOLDEN)
  let evidence: ErratumEvidence[] = []
  let evidenceError: string | null = null
  try {
    evidence = computeErrataEvidence()
  } catch (e) {
    evidenceError = e instanceof Error ? e.message : String(e) // 某個章節模型丟錯：誠實顯示，不讓整頁壞掉
  }
  const evidenceByEid: Record<string, ErratumEvidence[]> = {}
  for (const e of evidence) (evidenceByEid[e.eid] ??= []).push(e)
  const checksByEid: Record<string, ErratumLiveCheck[]> = {}
  let keysTotal = 0
  let keysPassed = 0
  let keysFailed = 0
  let keysMissing = 0
  let checksTotal = 0
  let checksPassed = 0
  for (const r of rows) {
    if (r.cmp) {
      keysTotal += r.cmp.keys.length
      keysPassed += r.cmp.passed
      keysFailed += r.cmp.failed
      keysMissing += r.cmp.missing
    } else {
      keysTotal += Object.keys(GOLDEN[r.meta.id].expected).length
      keysMissing += Object.keys(GOLDEN[r.meta.id].expected).length
    }
    for (const c of r.comp?.checks ?? []) {
      checksTotal++
      if (c.pass) checksPassed++
      for (const eid of c.errata) (checksByEid[eid] ??= []).push({ tid: r.meta.id, check: c })
    }
  }
  return {
    rows,
    byId,
    negative,
    negativeError,
    mutants,
    evidence,
    evidenceByEid,
    checksByEid,
    evidencePassed: evidence.filter((e) => e.pass).length,
    evidenceError,
    totalMs,
    keysTotal,
    keysPassed,
    keysFailed,
    keysMissing,
    rowsPassed: rows.filter((r) => r.cmp?.status === 'pass').length,
    checksTotal,
    checksPassed,
  }
}

export function AcceptanceProvider({ children }: { children: ReactNode }) {
  const state = useMemo(() => computeAcceptanceState(), [])
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>
}

export function useAcceptance(): AcceptanceState {
  const s = useContext(Ctx)
  if (!s) throw new Error('useAcceptance 必須在 <AcceptanceProvider> 之內使用')
  return s
}

export const ALL_IDS = ACCEPTANCE_IDS

/** 含 `$…$` 行內 TeX 的字串 → KaTeX（共用層的 mathText；acceptance.ts 與 data.ts 的說明文字都用這種標記） */
export const M = (text: string): ReactNode => mathText(text)

/** 「勘誤 Exx」小標：連到同頁的勘誤卡片（#/verification?e=Exx，HashRouter 相容） */
export function ErratumChip({ eid }: { eid: string }) {
  const e = erratumById(eid)
  const gist = ERRATA_MATH[eid]?.gist
  const tip = e ? `${eid}（${SEVERITY_LABEL[e.severity]}）：${gist ? texToPlain(gist) : e.area}` : `${eid}：找不到此勘誤`
  return (
    <a className={`ver-chip ${e ? `ver-chip-${e.severity}` : 'ver-chip-erratum'}`} href={erratumHref(eid)} title={tip} data-erratum={eid}>
      勘誤 {eid}
    </a>
  )
}

/** 通過 / 失敗 / 未計算 的標記 */
export function PassMark({ pass, label }: { pass: boolean | null; label?: string }) {
  if (pass === null) return <span className="ver-miss">○ {label ?? '未計算'}</span>
  return pass ? <span className="ver-pass">✓ {label ?? '通過'}</span> : <span className="ver-fail">✗ {label ?? '不一致'}</span>
}

const RANK: Record<LearningMode, number> = { beginner: 0, engineer: 1, research: 2 }

/** 依學習模式決定預設展開的推導框：Beginner 收合（一鍵展開），Engineer 以上展開 */
export function Expand({ title, children, openFrom = 'engineer', badge = '推導' }: { title: ReactNode; children: ReactNode; openFrom?: LearningMode; badge?: string }) {
  const { mode } = useSettings()
  const open = RANK[mode] >= RANK[openFrom]
  return (
    <details className="c-prereq" open={open} key={`${mode}-${openFrom}`}>
      <summary>
        <span className="c-prereq-badge">{badge}</span> {typeof title === 'string' ? M(title) : title}
      </summary>
      <div className="c-prereq-body">{children}</div>
    </details>
  )
}

const FORMULA_BY_ID = Object.fromEntries(FORMULAS.map((f) => [f.id, f]))

/**
 * 已登錄公式的獨立區塊：TeX 直接取自 formulas.ts（頁面與 Formula & Unit Reference 頁顯示同一份），
 * 錨點 id="formula-F-VF.n"。label 省略時用登錄的標題。
 */
export function FBlock({ id, label }: { id: string; label?: ReactNode }) {
  const f = FORMULA_BY_ID[id]
  if (!f) throw new Error(`FBlock：公式 ${id} 沒有登錄在 src/pages/verification/formulas.ts`)
  return (
    <TexBlock id={id} label={label ?? M(f.title)}>
      {f.tex}
    </TexBlock>
  )
}

/** StepDerivation 的步驟：why 以 `$…$` 標記行內 TeX */
export function steps(list: { tex: string; why: string }[]): { tex: string; why: ReactNode }[] {
  return list.map((s) => ({ tex: s.tex, why: M(s.why) }))
}
