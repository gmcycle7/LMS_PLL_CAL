import { lazy, Suspense, useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Callout, ClaimTag, ModelLevel, SourceTag, Tex } from '@/components'
import { ALL_PRESETS, presetById } from '@/app/presets'
import { PREVIEWABLE_EXPERIMENTS } from './data'
import { AllPresets } from './sections/AllPresets'
import { Coverage } from './sections/Coverage'
import { HowToRead } from './sections/HowToRead'
import { Intro } from './sections/Intro'
import { RegressionBoard } from './sections/RegressionBoard'
import { RequiredGallery } from './sections/RequiredGallery'
import { JumpButton, scrollToId, SlotAudit, useSlotAudit } from './sections/SlotAudit'
import { SymbolsLink, SymbolsSection } from './sections/Symbols'
import { UnifiedView } from './sections/UnifiedView'
import { Wrapup } from './sections/Wrapup'
import './gallery.css'

// previews.ts 連同十幾個模型模組、以及 §7 的原始碼文字都不小：各自切成 lazy chunk，頁面先顯示、它們在背景載入
const Inspector = lazy(() => import('./sections/Inspector'))
const CodeSection = lazy(() => import('./sections/CodeSection'))

const TOC: { id: string; label: string }[] = [
  { id: 'gal-s1', label: '1 這一頁在做什麼' },
  { id: 'gal-s2', label: '2 一張卡片怎麼讀' },
  { id: 'gal-s3', label: '3 必備 12 個：稽核' },
  { id: 'gal-s4', label: '4 必備 12 個：逐一看' },
  { id: 'gal-s5', label: '5 一次重算' },
  { id: 'gal-s6', label: '6 Preset Inspector' },
  { id: 'gal-s7', label: '7 核心程式碼' },
  { id: 'gal-s8', label: '8 全部 preset 與篩選' },
  { id: 'gal-s9', label: '9 T-id 覆蓋率' },
  { id: 'gal-s10', label: '10 思考題與必記' },
  { id: 'symbols', label: '符號表（頁尾）' },
]

/** Inspector 預設選的 preset：§19.2 中第一個可預覽的；沒有就取任何一個可預覽的 */
function defaultInspectId(): string {
  const can = ALL_PRESETS.filter((p) => PREVIEWABLE_EXPERIMENTS.includes(p.experiment))
  return (can.find((p) => p.galleryIndex !== undefined) ?? can[0])?.id ?? ''
}

/**
 * Experiment Gallery（route /gallery；規格 §19.2）。
 *
 * 章節：1 這一頁在做什麼（preset 是什麼）→ 2 一張卡片怎麼讀（手算 #1、預期文字比對的數學 F-GA.1–3）→
 *       3 §19.2 的 12 個必備 preset 稽核 → 4 統一觀點（F-GA.4；以 #1、#7、#8、#12 做數值驗算）與 12 個實驗逐一說明 → 5 一次重算 →
 *       6 Preset Inspector（ExperimentShell：重算、比對、注入誤差的反面測試、匯出）→ 7 核心程式碼 →
 *       8 全部 preset 與篩選（頁面／層級／T-id／來源／關鍵字）→ 9 T-id 覆蓋率與資料健康檢查 → 10 思考題與必記 →
 *       頁尾：本頁符號表（id="symbols"；docs/teaching-style.md §5，頁首只留一行連結）。
 * 方塊圖：diagrams.ts 的 5 張（preset 的兩條路、#1 的 LMS 迴路、相符判據的判定流程、統一觀點的迴路、三個問題）。
 *
 * 資料：所有 preset 來自 ALL_PRESETS（src/data/presets/*.json），本頁不新增、不改寫；缺少的必備 preset 只標示「缺少」。
 * 數字：即時預覽、重算表與 Inspector 的每個數字都由 src/simulation/models 的函式當場算出（previews.ts）。
 * 網址：?page= &level= &t= &src= &q= &g=1 &pv=1 為篩選；?inspect=<preset id>（或 ?preset=<preset id>）讓 Inspector 直接選那個 preset。
 */
export default function GalleryPage() {
  const audit = useSlotAudit()
  const [sp] = useSearchParams()
  // ?inspect=<id>；也接受 ?preset=<id>（與各章「載入並執行」同一個參數名稱）
  const linked = sp.get('inspect') ?? sp.get('preset')
  const linkedOk = !!linked && !!presetById(linked) && PREVIEWABLE_EXPERIMENTS.includes(presetById(linked)?.experiment ?? '')
  const [selected, setSelected] = useState<string>(() => (linkedOk && linked ? linked : defaultInspectId()))
  const inspect = useCallback((id: string) => {
    setSelected(id)
    scrollToId('gal-s6')
  }, [])
  return (
    <div className="gal-page">
      <div className="c-tag-row gal-head-tags">
        <ModelLevel level="L0" />
        <ModelLevel level="L1" />
        <ModelLevel level="L2" />
        <ModelLevel level="L3" />
        <ModelLevel level="L4" />
        <ModelLevel level="L5" />
        <ClaimTag kind="exact" />
        <ClaimTag kind="approx" />
        <SourceTag kind="illustrative" />
        <SourceTag kind="simulation" />
      </div>
      <nav className="gal-toc" aria-label="本頁目錄">
        {TOC.map((t) => (
          <JumpButton key={t.id} domId={t.id}>
            {t.label}
          </JumpButton>
        ))}
      </nav>
      <SymbolsLink />

      <Intro />
      <HowToRead />

      <section aria-labelledby="gal-s3" className="gal-section">
        <h2 id="gal-s3">3｜規格 §19.2 的 12 個必備 preset：稽核</h2>
        <SlotAudit audit={audit} />
      </section>

      <section aria-labelledby="gal-s4" className="gal-section">
        <h2 id="gal-s4">4｜12 個必備實驗：三個問題，逐一看</h2>
        <UnifiedView audit={audit} />
        <h3>4.1 逐一說明</h3>
        <p className="small muted">
          每一格依序是：規格原文的條件與現象、網站依勘誤採用的說法、核心公式、硬體對應與失效條件，最後是 preset 卡片。按「即時預覽」會載入模型模組並當場重算。
        </p>
        <RequiredGallery audit={audit} onInspect={inspect} />
      </section>

      <section aria-labelledby="gal-s5" className="gal-section">
        <h2 id="gal-s5">5｜一次重算：回歸檢查表</h2>
        <p>
          把必備的 12 個（或全部可預覽的）preset 一口氣用模型函式重算，逐一和預期文字比對。這是規格 §17 末段反面測試「模型公式有錯，UI 卻顯示成功」的日常版本：任何人改了 <code>src/simulation/models</code>{' '}
          之後，到這裡按一下就知道有沒有哪個教科書數字跑掉了。
        </p>
        <RegressionBoard audit={audit} onInspect={inspect} />
      </section>

      <section aria-labelledby="gal-s6" className="gal-section">
        <h2 id="gal-s6">6｜Preset Inspector：重算、比對、親手弄壞它</h2>
        <p>
          選一個 preset，看它的每一個重算值、代入數字的推導，以及和預期文字的逐項比對。工程師模式以上另有兩個控制項：<strong>容差倍數</strong> <Tex>{'k_{\\mathrm{tol}}'}</Tex>，以及<strong>注入相對誤差</strong>{' '}
          <Tex>{'\\varepsilon'}</Tex>——把所有重算值乘上 <Tex>{'(1+\\varepsilon)'}</Tex>，親眼確認比對真的會失敗。
        </p>
        <Suspense fallback={<p className="small muted gal-loading">載入模型模組中…</p>}>
          <Inspector selected={selected} onSelect={setSelected} />
        </Suspense>
      </section>

      <section aria-labelledby="gal-s7" className="gal-section">
        <h2 id="gal-s7">7｜核心程式碼：頁面上看到的就是正在執行的</h2>
        <p>
          這一節把「載入 preset」「即時預覽」「比對」三件事的實際程式列出來，並把六種模型算 pole 的程式並排比較（差異行以底色標出）。
        </p>
        <Suspense fallback={<p className="small muted gal-loading">載入原始碼中…</p>}>
          <CodeSection />
        </Suspense>
      </section>

      <section aria-labelledby="gal-s8" className="gal-section">
        <h2 id="gal-s8">8｜全部 preset 與篩選</h2>
        <p>
          全站 {ALL_PRESETS.length} 個 preset。可依<strong>頁面／章節</strong>、<strong>模型層級</strong>、<strong>T-id</strong>、來源與關鍵字篩選；篩選條件寫在網址上，可以直接分享。沒有篩選時各組預設收合（6 個以內的組展開）。
        </p>
        <AllPresets onInspect={inspect} />
      </section>

      <section aria-labelledby="gal-s9" className="gal-section">
        <h2 id="gal-s9">9｜T-id 覆蓋率與資料健康檢查</h2>
        <Coverage />
        <Callout kind="info" title="T-id 徽章不是由這一頁判定的">
          徽章狀態來自 <code>npm run verify</code>（Vitest 與 Python golden 兩邊的測試結果）。Gallery 的比對是另一道獨立的防線：它確認「preset 的文字」與「現在的模型」沒有分家。
        </Callout>
      </section>

      <Wrapup />
      <SymbolsSection />
    </div>
  )
}
