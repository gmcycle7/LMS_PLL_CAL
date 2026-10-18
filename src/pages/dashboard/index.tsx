import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SourceTag, formulaDomId, useCases } from '@/components'
import { useSettings } from '@/app/settings'
import { useUrlPreset } from '@/app/presets'
import './dashboard.css'
import { conditionById } from './data'
import { EXPERIMENT_ID, builtinPreset, presetParams } from './presets'
import { DEFAULT_PARAMS, evaluateThesis, type ConditionId, type ThesisParams } from './thesisModel'
import { HealthCheck, type EvaluatedCase } from './experiment/HealthCheck'
import { Hero } from './sections/Hero'
import { OutcomesSection } from './sections/Outcomes'
import { SystemOverview } from './sections/SystemOverview'
import { SymbolsSection } from './sections/Symbols'
import { RoutesSection } from './sections/Routes'
import { ThesisSection } from './sections/Thesis'
import { ThesisFold } from './sections/ThesisFold'
import { foldKeyOf, type FoldKey } from './sections/foldIds'
import { MathSpine } from './sections/MathSpine'
import { ChapterGrid } from './sections/ChapterGrid'
import { GallerySection } from './sections/Gallery'
import { QuestionsSection } from './sections/Questions'
import { ModesSection } from './sections/Modes'
import { VerificationPanel } from './sections/Verification'
import { Wrapup } from './sections/Wrapup'
import { scrollToId, useProgress } from './ui'

/**
 * 展開收合卡片或載入 preset 之後的捲動：內容剛渲染（或途中才畫）的方塊圖（Mermaid，接近可視範圍才畫）與圖表會在之後幾百毫秒內把目標往下推，
 * 所以先直接跳到目標，再在 3 秒內用 ResizeObserver 盯著整頁：內容長高而目標位移時就重新對齊。
 * 讀者一旦自己捲動（wheel／touch／鍵盤）就停止，不跟讀者搶捲軸（與 components/links/anchor.ts 的 settleScroll 相同）。
 * 回傳的函式用來停止觀察（effect 的 cleanup）。
 */
function jumpAndSettle(id: string): () => void {
  const target = () => document.getElementById(id)
  target()?.scrollIntoView?.({ behavior: 'auto', block: 'start' })
  const body = document.querySelector('.dash')
  if (!body || typeof ResizeObserver === 'undefined') return () => undefined
  let anchorTop = target()?.getBoundingClientRect().top ?? 0
  const ro = new ResizeObserver(() => {
    const el = target()
    if (!el) return
    if (Math.abs(el.getBoundingClientRect().top - anchorTop) > 4) {
      el.scrollIntoView({ behavior: 'auto', block: 'start' })
      anchorTop = el.getBoundingClientRect().top
    }
  })
  ro.observe(body)
  const events = ['wheel', 'touchstart', 'keydown'] as const
  const stop = () => {
    window.clearTimeout(timer)
    ro.disconnect()
    for (const ev of events) window.removeEventListener(ev, stop)
  }
  for (const ev of events) window.addEventListener(ev, stop, { passive: true })
  const timer = window.setTimeout(stop, 3000)
  return stop
}

/**
 * Dashboard / Learning Roadmap（路由 /）。
 * 段落順序：Hero → 學完你能做什麼 → 系統地圖 → 三條學習路線 → 三種學習模式 → 六個條件／一條方程式／動手體檢 → 章節地圖 → 12 個實驗 → 15 個問題 → 驗證 → 本頁必記 → 符號表。
 * Beginner 模式（folded）把長的段落收起來：「六個條件／一條方程式／動手體檢」收成一張卡片（ThesisFold）、章節地圖縮成一張表、15 個問題只列問題（點開才看短答案）、
 * 綜合手算／思考題／本頁必記各收成一張卡片、符號表收成一張卡片；收起來的內容展開才渲染，新手首頁（1280 px 寬）因此從約 1.8 萬 px 縮到約 9 千 px。Engineer / Research 全部直接展開。
 * 六個條件的檢查表與「動手體檢」共用同一組 Case A/B/C 狀態與同一個計算核心 evaluateThesis。
 * 方塊圖（docs/teaching-style.md §8）：系統地圖（SystemMap，全部方塊）、六個條件的檢查流程、條件在迴路上的位置、線性化 block 方程式的訊號流。
 * 符號表在頁末（id="symbols"，sections/Symbols.tsx）；頁首只留一行「本頁符號表在最後 ↓」（docs/teaching-style.md §5）。
 */
export default function DashboardPage() {
  const { mode } = useSettings()
  const cases = useCases<ThesisParams>({ ...DEFAULT_PARAMS })
  const progress = useProgress()
  // 拖動滑桿時讓 React 先更新輸入框，再重算（d > 0 的慢 mode 需要數值加總）
  const deferred = useDeferredValue(cases.cases)
  const evaluated = useMemo<EvaluatedCase[]>(
    () => deferred.map((c) => ({ id: c.id, seriesIndex: c.seriesIndex, result: evaluateThesis(c.params) })),
    [deferred],
  )
  const active = evaluated.find((e) => e.id === cases.activeId) ?? evaluated[0]

  // Beginner：長的段落收在卡片裡（foldIds.ts 列出哪些 id 在哪一張卡片）；指到卡片裡面的頁內跳轉要先展開、等內容渲染出來再捲
  const folded = mode === 'beginner'
  // 網址的深連結：?preset=（體檢的內建 preset 或 experiment = EXPERIMENT_ID 的 preset，由 HealthCheck 套用參數）、
  // ?a=／?f=（PageFrame 的 AnchorDeepLink 等目標元素出現再捲過去）。第一次造訪的預設模式是 Beginner，分享出去的連結必須看得到目標：
  // 指到卡片裡面的錨點一開始就展開那一張；preset 則在載入後跳到體檢（Beginner 先展開再捲）。
  const [search] = useSearchParams()
  const urlPreset = useUrlPreset(EXPERIMENT_ID)
  const rawPreset = search.get('preset')
  const presetId = rawPreset && (builtinPreset(rawPreset) || urlPreset) ? rawPreset : null
  const f = search.get('f')
  const deepId = f ? formulaDomId(f) : search.get('a')
  const [openFolds, setOpenFolds] = useState<ReadonlySet<FoldKey>>(() => {
    const key = folded && deepId !== null ? foldKeyOf(deepId) : null
    return new Set(key ? [key] : [])
  })
  const setFold = useCallback(
    (key: FoldKey, next: boolean) =>
      setOpenFolds((prev) => {
        if (prev.has(key) === next) return prev
        const out = new Set(prev)
        if (next) out.add(key)
        else out.delete(key)
        return out
      }),
    [],
  )
  const onThesisOpenChange = useCallback((next: boolean) => setFold('thesis', next), [setFold])
  const onHandcalcOpenChange = useCallback((next: boolean) => setFold('handcalc', next), [setFold])
  const onSymbolsOpenChange = useCallback((next: boolean) => setFold('symbols', next), [setFold])
  // 網址 ?a=dash-q-N 指到的那一題：Beginner 的題目要自己展開（問題在 <li> 上、答案在它的 <details> 裡，祖先展開幫不上忙）
  const openQ = useMemo(() => {
    const m = deepId === null ? null : /^dash-q-(\d+)$/.exec(deepId)
    return m ? Number(m[1]) : null
  }, [deepId])
  // jump 保持同一個函式（Hero、SystemOverview 都是 memo），最新的 folded / openFolds 走 ref
  const foldState = useRef({ folded, openFolds })
  foldState.current = { folded, openFolds }
  const pendingJump = useRef<string | null>(null)
  const jump = useCallback(
    (id: string) => {
      const s = foldState.current
      const key = s.folded ? foldKeyOf(id) : null
      if (key && !s.openFolds.has(key)) {
        pendingJump.current = id
        setFold(key, true)
      } else scrollToId(id)
    },
    [setFold],
  )
  useEffect(() => {
    const id = pendingJump.current
    if (!id) return
    const key = foldKeyOf(id)
    if (folded && key && !openFolds.has(key)) return
    pendingJump.current = null
    return jumpAndSettle(id)
  }, [folded, openFolds])
  // 網址帶著體檢的 preset：跳到體檢。PageFrame 換頁時會 scrollTo(0, 0)（父層的 effect 在子層之後跑），所以延後一個 macrotask；
  // 卡片收合時先展開（展開後的 effect 會跳），否則直接跳並重新對齊（途中才畫的方塊圖會把目標往下推）
  useEffect(() => {
    if (!presetId) return
    let stop: (() => void) | undefined
    const t = window.setTimeout(() => {
      const s = foldState.current
      if (s.folded && !s.openFolds.has('thesis')) jump('dash-check')
      else stop = jumpAndSettle('dash-check')
    }, 0)
    return () => {
      window.clearTimeout(t)
      stop?.()
    }
  }, [presetId, jump])

  // 條件卡片的「載入反例」：把會讓該條件失敗的內建 preset 套到目前的 case，再捲到體檢看原因
  const { update } = cases
  const loadExample = useCallback(
    (id: ConditionId) => {
      const preset = builtinPreset(conditionById(id).example)
      if (!preset) return
      update(presetParams(preset))
      jump('dash-check')
    },
    [update, jump],
  )

  const thesis = (
    <>
      <ThesisSection checks={active.result.checks} caseId={active.id} onLoadExample={loadExample} />
      <MathSpine />
      <section id="dash-check" aria-label="六條件一分鐘體檢">
        <HealthCheck cases={cases} evaluated={evaluated} />
      </section>
    </>
  )

  return (
    <div className="dash">
      <Hero onJump={jump} />
      <OutcomesSection />
      <SystemOverview onJump={jump} />
      <RoutesSection progress={progress} />
      <ModesSection />
      {folded ? (
        <ThesisFold open={openFolds.has('thesis')} onOpenChange={onThesisOpenChange}>
          {thesis}
        </ThesisFold>
      ) : (
        thesis
      )}
      <ChapterGrid progress={progress} compact={folded} />
      <GallerySection />
      <QuestionsSection folded={folded} openQ={openQ} />
      <VerificationPanel />
      <Wrapup folded={folded} handcalcOpen={openFolds.has('handcalc')} onHandcalcOpenChange={onHandcalcOpenChange} />
      <p className="dash-footnote">
        <SourceTag kind="illustrative" /> 本頁所有數值（雜訊、頻率、預算、spur 上限）都是 illustrative 示例，用來說明公式與趨勢，不是任何晶片的量測或規格。「動手體檢」的燈號來自局部線性化的平均模型，內建的 Monte Carlo 只涵蓋單參數、無 bias、無定點量化的情況；要宣稱穩定或可 sign-off，請依 Sign-off
        Checklist 以完整的 behavioral simulation、Monte Carlo 與 RTL 驗證。
      </p>
      <SymbolsSection folded={folded} open={openFolds.has('symbols')} onOpenChange={onSymbolsOpenChange} />
    </div>
  )
}
