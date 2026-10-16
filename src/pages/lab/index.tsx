import { useRef, type KeyboardEvent } from 'react'
import { AnchorLink, Callout, ClaimTag, ModelLevel, SourceTag, TestBadge, Tex } from '@/components'
import { Diagram, ErratumNote } from './common'
import { CHART_TAB_MAP } from './diagrams'
import { TAB_LABEL, TAB_ORDER, type TabId } from './logic'
import { S1Intro } from './sections/S1Intro'
import { S2Chain } from './sections/S2Chain'
import { S3Analysis } from './sections/S3Analysis'
import { S4Code } from './sections/S4Code'
import { S5Wrap } from './sections/S5Wrap'
import { PAGE_TOP_ANCHOR, SymbolsJump, SymbolsSection } from './sections/S6Symbols'
import { LabProvider, useLab } from './store'
import { CompareTab } from './tabs/CompareTab'
import { FcwSweepTab } from './tabs/FcwSweepTab'
import { MonteCarloTab } from './tabs/MonteCarloTab'
import { PipelineTab } from './tabs/PipelineTab'
import { TrainingTab } from './tabs/TrainingTab'
import './lab.css'

const TAB_HINT: Record<TabId, string> = {
  pipeline: '跑一次完整的 pipeline：看每一級的中間訊號、九級報告與輸出端的 jitter / spur。',
  fcw: '只換 FCW，其他不動：哪些通道極性會反、哪些沒有激勵、bias 與 spur 怎麼隨 FCW 變。',
  mc: '同一組參數跑很多個 seed：信賴區間，以及與平均模型（mean-field 軌跡）的比較。',
  training: '不跑迴路，只分析 code 序列：PSD、相關、Jacobian 的秩、殘差留下的 tone。',
  compare: '最多三組完整設定，用同一個 seed 成對比較。',
}

function TabBar() {
  const { tab, setTab, pipe, sweep, mc, training, compare } = useLab()
  const refs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({})
  const busy: Record<TabId, boolean> = { pipeline: pipe.running, fcw: sweep.running, mc: mc.running, training: training.running, compare: compare.running !== null }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TAB_ORDER.indexOf(tab)
    const next = e.key === 'ArrowRight' ? TAB_ORDER[(i + 1) % TAB_ORDER.length] : e.key === 'ArrowLeft' ? TAB_ORDER[(i + TAB_ORDER.length - 1) % TAB_ORDER.length] : null
    if (!next) return
    e.preventDefault()
    setTab(next)
    refs.current[next]?.focus()
  }
  return (
    <div className="lab-tabs-wrap">
      <div className="lab-tabs" role="tablist" aria-label="Unified Calibration Lab 分頁" onKeyDown={onKey}>
        {TAB_ORDER.map((t) => (
          <button
            key={t}
            ref={(el) => {
              refs.current[t] = el
            }}
            type="button"
            role="tab"
            id={`lab-tab-${t}`}
            aria-selected={tab === t}
            aria-controls="lab-tabpanel"
            tabIndex={tab === t ? 0 : -1}
            className={`lab-tab${tab === t ? ' is-active' : ''}`}
            onClick={() => setTab(t)}
          >
            {TAB_LABEL[t]}
            {busy[t] && <span className="c-spinner lab-tab-busy" aria-label="計算中" />}
          </button>
        ))}
      </div>
      <p className="small muted lab-tab-hint">{TAB_HINT[tab]}</p>
    </div>
  )
}

function LabTabs() {
  const { tab } = useLab()
  return (
    <section aria-labelledby="lab-s7" id="lab-experiments">
      <h2 id="lab-s7">7｜動手做：Unified Calibration Lab</h2>
      <p>
        五個分頁共用同一份模擬核心（<code>src/simulation/models/unifiedLab.ts</code>，在 Web Worker 執行）。Pipeline、FCW sweep、Monte Carlo 三個分頁共用同一組「基準參數」；Training 與 Compare
        各有自己的設定。切換分頁不會中斷正在跑的計算，也不會清掉結果。
      </p>
      <Diagram
        chart={CHART_TAB_MAP}
        caption="五個分頁各自回答一個問題：跑一次看細節、只換 FCW、換很多個 seed、只分析 code、三組設定並排。它們讀的參數不同，但最後都呼叫同一份模擬核心。"
        ariaLabel="五個分頁的關係圖：Pipeline、FCW sweep、Monte Carlo 共用基準參數，Training 與 Compare 各有自己的設定，五個分頁都呼叫同一份模擬核心"
      >
        <p>
          先看「基準參數」那一框：Pipeline、FCW sweep、Monte Carlo 讀的是同一組，所以在其中一個分頁改了 <Tex>{'\\mu'}</Tex> 或 FCW，另外兩個分頁也跟著變。Training 與 Compare 各有自己的設定，不受影響。
        </p>
        <p>
          圖上的 <Tex>{'\\alpha'}</Tex> 是 FCW 的小數部分，<Tex>C</Tex> 是 §4.6 的相關（它的正負決定更新極性）。五個分頁最後都接到藍色那一塊，所以各分頁的數字可以直接互相對照。
        </p>
      </Diagram>
      <div className="small lab-tryit">
        試試看：
        <ol>
          <li>
            <strong>Pipeline</strong>（預設：MASH 1-1-1、Type-II <Tex>{'2\\,\\mathrm{MHz}'}</Tex>）：<Tex>{'w_k'}</Tex> 約 12 個 block 收斂到 <Tex>{'a=3\\,\\mathrm{fs}'}</Tex> 附近；「跨級一致性」是綠的；輸出端的 RMS 遠小於{' '}
            <Tex>{'\\sigma_w'}</Tex>（MASH 的 code 幾乎都在 PLL 頻寬外）。
          </li>
          <li>
            把 code 來源改成<strong>一階 DSM</strong>、frac 改成 <Tex>{'0.01'}</Tex>（<Tex>{'f_1=40\\,\\mathrm{MHz}'}</Tex>，在 PLL 頻寬外）：<Tex>C</Tex> 掉到 0.25、<Tex>{'\\tau'}</Tex> 變成約 50 個 block，gain-noise 的輸出 RMS 從{' '}
            <Tex>{'10^{-3}\\,\\mathrm{fs}'}</Tex> 以下跳到約 <Tex>{'0.3\\,\\mathrm{fs}'}</Tex>——因為 unit_rms 的一階 residue 有 <Tex>{'\\bar x\\approx-0.87'}</Tex> 的 DC，gain 的抖動直接穿過 <Tex>T</Tex>。
          </li>
          <li>
            再把正規化從 unit_rms 改成 <strong>standardize</strong>（去掉 DC）：<Tex>C</Tex> 回到 1、gain-noise 的輸出 RMS 小了一個數量級以上。
          </li>
          <li>
            載入 preset「近整數 FCW」（frac <Tex>{'=10^{-4}'}</Tex>）：<Tex>C</Tex> 只剩約 0.012、<Tex>{'\\tau'}</Tex> 上千個 block，輸出端出現一根 <Tex>{'400\\,\\mathrm{kHz}'}</Tex> 的 fractional spur，toneFit
            與封閉式對得上。按「執行至收斂」，它會告訴你需要的 block 數超過上限。
          </li>
          <li>
            載入 preset「固定點不是常數」（一階 DSM、<Tex>{'\\alpha=0.3'}</Tex>、comparator offset <Tex>{'20\\,\\mathrm{fs}'}</Tex>）：<Tex>{'w_k'}</Tex> 收斂之後還在緩慢起伏，那不是雜訊——每個 block 的固定點{' '}
            <Tex>{'w^*_k'}</Tex> 自己在擺動。圖例裡把「線性時不變模型」打開，對照 mean-field 平均軌跡（§5.2）。
          </li>
          <li>
            <strong>FCW sweep</strong>：載入 preset「delayed regressor 的 sign flip」，看 <Tex>C</Tex> 在哪些 FCW 掉到 0 以下。
          </li>
          <li>
            <strong>反面測試</strong>：GMAC 模式改成 sum（不改 <Tex>{'\\mu'}</Tex>）、<Tex>{'\\mu'}</Tex> 改成負的、編碼改成「0/1 未映射」——每一種都會有說明原因的警告，而不是只顯示「無法計算」。
          </li>
        </ol>
      </div>
      <TabBar />
      <div role="tabpanel" id="lab-tabpanel" aria-labelledby={`lab-tab-${tab}`} className="lab-tabpanel" data-tab={tab}>
        {tab === 'pipeline' && <PipelineTab />}
        {tab === 'fcw' && <FcwSweepTab />}
        {tab === 'mc' && <MonteCarloTab />}
        {tab === 'training' && <TrainingTab />}
        {tab === 'compare' && <CompareTab />}
      </div>
    </section>
  )
}

/**
 * Unified Calibration Lab（route /lab；規格 §19「Unified Lab」「Training Sequence Lab」、§15.4 輸出、§20.6 P5）。
 *
 * 章節：1 開場 → 2 九級訊號鏈（方塊圖、每級的式子 / 模型層級 / 對應章節）→ 3 數字先行的手算例（DSM residue、T13 錨點）→
 *       4 九級的逐步推導（F-LAB.1–12）→ 5 判讀工具（跨級一致性、AR(1) 標準誤差、mean-field 平均軌跡、PE、斜率量測、信賴區間、Jacobian；F-LAB.13–18）→
 *       6 核心程式碼（?raw + #region）與比較表 → 7 Lab（五個分頁）→ 8 思考題 → 9 必記與可宣稱的語句 → 頁末：本頁符號表（id="symbols"；頁首只留一行連結，docs/teaching-style.md §5）。
 * 方塊圖（diagrams.ts，共 5 張）：§2 九級訊號鏈、§4.4 兩條路、§4.7 更新迴路、§4.9 輸出端的兩個成分、§7 五個分頁。
 * 實驗（ExperimentShell id）：unified-lab、unified-lab-fcw、unified-lab-mc、training-sequence-lab、unified-lab-compare。
 * 模擬核心：src/simulation/models/unifiedLab.ts（迴路本身由 blockLms.ts 的 runBlockLms 執行）。
 * 勘誤：E01（小訊號）、E03 / E04（DC null、offset 不可辨識）、E06 / E26 / E27（頻寬）、E07（tie）、E09 / E28 / E29（PSD 速率與正規化）、
 *       E13（單位）、E30（T13 前提）、E32 / E33（極性）、E34 / E35（符號與索引）、E44（CT/DT）、E45（filtered-x）；頁內以「勘誤 Exx」連到 #/verification。
 * 文字規範：數學一律 KaTeX；JSX 屬性字串內的 TeX 用單一反斜線、JS 字串用雙反斜線（index.test.tsx 會檢查）。
 */
export default function LabPage() {
  return (
    <LabProvider>
      <div className="lab-page">
        <div className="c-tag-row lab-head-tags" id={PAGE_TOP_ANCHOR}>
          <ModelLevel level="L1" />
          <ModelLevel level="L2" />
          <ModelLevel level="L3" />
          <ModelLevel level="L4" />
          <ModelLevel level="L5" />
          <ClaimTag kind="exact" />
          <ClaimTag kind="approx" />
          <ClaimTag kind="research" />
          <SourceTag kind="simulation" />
          <TestBadge id="T13" />
          <TestBadge id="T14" />
          <TestBadge id="T15" />
        </div>
        <Callout kind="info" title="這一頁怎麼讀">
          <p>
            想直接動手：<AnchorLink id="lab-experiments">跳到第 7 節的 Lab</AnchorLink>。想先知道每個數字怎麼來：照順序讀第 1–6 節（每個推導一步一行，只需要微積分）。本站與規格書不同之處以「
            <ErratumNote id="E13" />」這樣的小註標示，點了會到驗證頁。
          </p>
        </Callout>
        <SymbolsJump />
        <S1Intro />
        <S2Chain />
        <S3Analysis />
        <S4Code />
        <LabTabs />
        <S5Wrap />
        <SymbolsSection />
      </div>
    </LabProvider>
  )
}
