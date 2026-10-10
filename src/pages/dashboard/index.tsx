import { useCallback, useDeferredValue, useMemo } from 'react'
import { SourceTag, useCases } from '@/components'
import './dashboard.css'
import { conditionById } from './data'
import { builtinPreset, presetParams } from './presets'
import { DEFAULT_PARAMS, evaluateThesis, type ConditionId, type ThesisParams } from './thesisModel'
import { HealthCheck, type EvaluatedCase } from './experiment/HealthCheck'
import { Hero } from './sections/Hero'
import { RoutesSection } from './sections/Routes'
import { ThesisSection } from './sections/Thesis'
import { MathSpine } from './sections/MathSpine'
import { ChapterGrid } from './sections/ChapterGrid'
import { GallerySection } from './sections/Gallery'
import { QuestionsSection } from './sections/Questions'
import { ModesSection } from './sections/Modes'
import { VerificationPanel } from './sections/Verification'
import { Wrapup } from './sections/Wrapup'
import { scrollToId, useProgress } from './ui'

/**
 * Dashboard / Learning Roadmap（路由 /）。
 * 六個條件的檢查表與「動手體檢」共用同一組 Case A/B/C 狀態與同一個計算核心 evaluateThesis。
 */
export default function DashboardPage() {
  const cases = useCases<ThesisParams>({ ...DEFAULT_PARAMS })
  const progress = useProgress()
  // 拖動滑桿時讓 React 先更新輸入框，再重算（d > 0 的慢 mode 需要數值加總）
  const deferred = useDeferredValue(cases.cases)
  const evaluated = useMemo<EvaluatedCase[]>(
    () => deferred.map((c) => ({ id: c.id, seriesIndex: c.seriesIndex, result: evaluateThesis(c.params) })),
    [deferred],
  )
  const active = evaluated.find((e) => e.id === cases.activeId) ?? evaluated[0]
  // 條件卡片的「載入反例」：把會讓該條件失敗的內建 preset 套到目前的 case，再捲到體檢看原因
  const { update } = cases
  const loadExample = useCallback(
    (id: ConditionId) => {
      const preset = builtinPreset(conditionById(id).example)
      if (!preset) return
      update(presetParams(preset))
      scrollToId('dash-check')
    },
    [update],
  )

  return (
    <div className="dash">
      <Hero />
      <RoutesSection progress={progress} />
      <ThesisSection checks={active.result.checks} caseId={active.id} onLoadExample={loadExample} />
      <MathSpine />
      <section id="dash-check" aria-label="六條件一分鐘體檢">
        <HealthCheck cases={cases} evaluated={evaluated} />
      </section>
      <ChapterGrid progress={progress} />
      <GallerySection />
      <QuestionsSection />
      <ModesSection />
      <VerificationPanel />
      <Wrapup />
      <p className="dash-footnote">
        <SourceTag kind="illustrative" /> 本頁所有數值（雜訊、頻率、預算、spur 上限）都是 illustrative 示例，用來說明公式與趨勢，不是任何晶片的量測或規格。
        「動手體檢」的燈號來自局部線性化的平均模型，內建的 Monte Carlo 只涵蓋單參數、無 bias、無定點量化的情況；要宣稱穩定或可 sign-off，請依 Sign-off
        Checklist 以完整的 behavioral simulation、Monte Carlo 與 RTL 驗證。
      </p>
    </div>
  )
}
