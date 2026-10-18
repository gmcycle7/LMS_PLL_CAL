import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { waitAndReveal } from '@/components'
import { ACCEPTANCE_IDS, type AcceptanceId } from '@/simulation/models/acceptance'
import { AcceptanceProvider, SymbolsLink } from './common'
import { erratumById } from './errata'
import { Intro } from './sections/Intro'
import { AcceptanceTable } from './sections/AcceptanceTable'
import { MonteCarloLab } from './sections/MonteCarloLab'
import { NegativeTests } from './sections/NegativeTests'
import { HowItWorks } from './sections/HowItWorks'
import { ErrataBrowser } from './sections/ErrataBrowser'
import { Wrapup } from './sections/Wrapup'
import { SymbolsSection } from './sections/Symbols'
import './verification.css'

/** 深連結參數：?e=E05（勘誤）或 ?t=T05（驗收列）。大小寫不拘；不合法時回傳 null。 */
export function parseDeepLink(params: URLSearchParams): { eid: string | null; tid: AcceptanceId | null } {
  const eRaw = params.get('e')?.trim().toUpperCase() ?? null
  const tRaw = params.get('t')?.trim().toUpperCase() ?? null
  const eid = eRaw && /^E\d{2}$/.test(eRaw) ? eRaw : null
  const tid = tRaw && (ACCEPTANCE_IDS as readonly string[]).includes(tRaw) ? (tRaw as AcceptanceId) : null
  return { eid, tid }
}

/**
 * 等目標出現（勘誤卡片在 lazy 載入的 §V.6 裡，要等那一節的 chunk 下載完）才捲過去、給焦點。
 * waitAndReveal 的第一次檢查排在 setTimeout 之後，所以一定晚於 PageFrame 的 scrollTo(0, 0)；
 * 捲到之後版面還會變（Plotly／Mermaid 延後渲染、lazy 區塊長出來），它會在 2 秒內把目標拉回原位。
 */
function useScrollToId(domId: string | null) {
  useEffect(() => {
    if (!domId) return
    return waitAndReveal(domId, { timeoutMs: 10_000 })
  }, [domId])
}

/**
 * Verification 頁（規格 §17 + docs/validation.md）：
 *   §V.1 先算一次（浮點與容忍度） §V.2 T01–T18 即時驗收（瀏覽器內呼叫各章模型 vs golden vectors）
 *   §V.3 Monte Carlo（Web Worker）與多 seed 校準 §V.4 反面測試與 mutation §V.5 驗證管線
 *   §V.6 勘誤瀏覽器（#/verification?e=E05 深連結；KaTeX 公式 + 即時重算的證據） §V.7 必記與思考題
 *   §V.8 本頁符號表（頁尾，id="symbols"；docs/teaching-style.md §5，頁首只留一行連結）
 * 方塊圖的原始碼在 ./diagrams.ts（容忍度判定、驗證管線、四種狀態、勘誤流程）。
 * 公式登錄在 ./formulas.ts（F-VF.n）；所有數值由 @/simulation/models/acceptance 即時計算。
 */
export default function VerificationPage() {
  const [params] = useSearchParams()
  const { eid, tid } = parseDeepLink(params)
  const scrollTarget = eid && erratumById(eid) ? eid : tid
  useScrollToId(scrollTarget)
  return (
    <AcceptanceProvider>
      <div className="ver" data-testid="verification-page">
        <SymbolsLink />
        <Intro />
        <AcceptanceTable focusId={tid} />
        <MonteCarloLab />
        <NegativeTests />
        <HowItWorks />
        <ErrataBrowser focusEid={eid} />
        <Wrapup />
        <SymbolsSection />
      </div>
    </AcceptanceProvider>
  )
}
