import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ClaimTag, Tex, randomSeed, revealAnchor, usePersistentState } from '@/components'
import type { HandCalcDef } from '@/data/types'
import { preloadModule, useModule } from '../verification/lazy'
import { loadBank } from './bank'
import {
  EMPTY_STATS,
  countByLevel,
  filterHandcalcs,
  filtersToParams,
  groupByChapter,
  isLevel,
  isWorkbookStats,
  parseFilters,
  parseSeed,
  parseTab,
  statsReducer,
  type Filters,
  type StatsAction,
  type WorkbookStats,
  type WorkbookTab,
} from './logic'
import { Browse, FilterBar } from './sections/Browse'
import { HandTools, ToolsDock } from './sections/HandTools'
import { CHART_BANK } from './diagrams'
import { Intro, Pending } from './sections/Intro'
import { Diagram } from './sections/common'
import { RandomPractice } from './sections/RandomPractice'
import { WorksheetBuilder } from './sections/Worksheet'
import './workbook.css'

/**
 * 全站手算題（各章 handcalcs.ts 的彙整，連同它們 solve() 呼叫的模型，約 600 KB gzip）在背景載入：
 * 頁面先畫出標題、目錄、手算工具這些不依賴題庫的部分，題庫載完才補上題數、說明裡的例題與題庫本身。
 * 首屏模組（本檔與它靜態 import 的檔案）不能靜態 import '@/app/handcalcs'，lazyBoundary.test.ts 會檢查。
 */
void preloadModule(loadBank)

/** 題庫尚未載入時的空陣列（固定的參考，useMemo 的相依才不會每次都變） */
const NO_DEFS: readonly HandCalcDef[] = []

/** 作答統計存在 localStorage 的 key（usePersistentState；storage 不可用時只在這次瀏覽有效） */
export const STATS_KEY = 'lmspll.workbook.stats'

const TAB_LABEL: Record<WorkbookTab, string> = {
  browse: '題庫瀏覽',
  practice: '隨機練習',
  sheet: '練習卷（可列印）',
}
const TAB_ORDER: WorkbookTab[] = ['browse', 'practice', 'sheet']

/**
 * 手算練習簿（route /workbook）。
 *
 * 章節：1 為什麼要手算 → 2 怎麼用（含一題示範、各難度需要的計算機功能）→ 3 手算工具（Φ 表、近似、常數、dB）→
 *       4 題庫：題庫瀏覽（依章節分組、篩選、搜尋，點開是完整的 <HandCalc compact />）／隨機練習（seed 可見、作答統計）／練習卷（可列印，附逐步解答）。
 *
 * 資料：題目全部來自 ALL_HANDCALCS（各章 handcalcs.ts），本頁不新增公式；詳解一律由 def.solve() 當場算出。
 * 網址：?ch=<章節 id> &level=<beginner|engineer|research> &q=<關鍵字> 為篩選；?tab=practice|sheet 選分頁；
 *       ?hc=<題號> 直接展開並捲到那一題；?seed=<整數> 指定隨機練習的起始 seed。
 */
export default function WorkbookPage() {
  const [sp, setSp] = useSearchParams()
  const bank = useModule(loadBank)
  const ready = bank !== null
  const all = bank?.ALL_HANDCALCS ?? NO_DEFS
  const groups = useMemo(() => groupByChapter(all), [all])
  const chapterKeys = useMemo(() => groups.map((g) => g.key), [groups])
  const levelCounts = useMemo(() => countByLevel(all), [all])

  const filters = useMemo(() => parseFilters(sp, chapterKeys), [sp, chapterKeys])
  const tab = parseTab(sp.get('tab'))
  const hc = sp.get('hc')
  const focusId = hc && bank?.handcalcById(hc) ? hc : null

  const filtered = useMemo(() => filterHandcalcs(all, filters), [all, filters])
  const filteredGroups = useMemo(() => groupByChapter(filtered), [filtered])

  const [stats, setStats] = usePersistentState<WorkbookStats>(STATS_KEY, EMPTY_STATS, isWorkbookStats)
  const dispatch = useCallback((a: StatsAction) => setStats((s) => statsReducer(s, a)), [setStats])

  // 隨機練習的起始 seed：網址有指定就用它，否則每次進來抽一個
  const [initialSeed] = useState(() => parseSeed(sp.get('seed') ?? '') ?? randomSeed())
  // 隨機練習第一次打開後就一直掛著（切到別的分頁時只是隱藏）：回來時題目、已填的答案與「這一題記過分了沒」都還在
  const [practiceMounted, setPracticeMounted] = useState(tab === 'practice')
  if (tab === 'practice' && !practiceMounted) setPracticeMounted(true)

  const setFilters = useCallback(
    (f: Filters) => {
      setSp(
        (prev) => {
          const next = filtersToParams(f, prev)
          next.delete('hc')
          return next
        },
        { replace: true },
      )
    },
    [setSp],
  )
  const setTab = useCallback(
    (t: WorkbookTab) => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (t === 'browse') next.delete('tab')
          else next.set('tab', t)
          next.delete('hc')
          return next
        },
        { replace: true },
      )
    },
    [setSp],
  )
  const jump = (t: WorkbookTab) => {
    setTab(t)
    revealAnchor('wb-s4')
  }

  // 練習卷的起始範圍：切到「練習卷」分頁的那一刻沿用目前的章節／難度篩選（沒有篩選 = 全部）；之後由練習卷自己的勾選框控制
  const sheetInitial = { chapters: filters.chapter ? [filters.chapter] : [], levels: isLevel(filters.level) ? [filters.level] : [] }

  return (
    <div className="wb-page">
      <div className="wb-top wb-noprint">
        <div className="c-tag-row wb-head-tags">
          <ClaimTag kind="exact" />
          <ClaimTag kind="approx" />
          <span className="small muted">每一題各自標示是精確式還是近似式；詳解的數字都來自網站實際執行的模擬函式。</span>
        </div>
        <p className="wb-lead">
          公式要代過數字才會變成自己的。這一頁把全站的「帶入手算」題收在一起：改成你的數字看每一步怎麼代、先用紙筆算再對答案、隨機抽題練習，或印成一份練習卷。全站的參數誤差一律是{' '}
          <Tex>{String.raw`\delta = a - w`}</Tex>（真實值減猜測）。
        </p>
        <nav className="wb-toc" aria-label="本頁目錄">
          <button type="button" className="btn" onClick={() => revealAnchor('wb-s1')}>
            1 為什麼要手算
          </button>
          <button type="button" className="btn" onClick={() => revealAnchor('wb-s2')}>
            2 怎麼用
          </button>
          <button type="button" className="btn" onClick={() => revealAnchor('wb-s3')}>
            3 手算工具
          </button>
          <button type="button" className="btn" onClick={() => jump('browse')}>
            4 題庫（{ready ? all.length : <Pending digits={3} />} 題）
          </button>
          <button type="button" className="btn" onClick={() => jump('practice')}>
            隨機練習
          </button>
          <button type="button" className="btn" onClick={() => jump('sheet')}>
            練習卷
          </button>
        </nav>

        <Intro all={all} groups={groups} demo={bank?.handcalcById('HC-00.1')} ready={ready} />

        <section aria-labelledby="wb-s3" className="wb-section">
          <h2 id="wb-s3">3｜手算工具：查表、近似與常數</h2>
          <p>
            需要 <Tex>{String.raw`\Phi(z)`}</Tex>、對數、dB 或角度換算時，回到這個框查。表上每一個數字都是載入頁面時由網站的數值函式算出來的（<code>normCdf</code>、<code>normInv</code>、
            <code>db10</code>／<code>db20</code>），沒有手打的值。做題做到一半時，右下角的「手算工具」按鈕可以隨時叫出同一張表。
          </p>
          <HandTools />
        </section>
      </div>

      <section aria-labelledby="wb-s4" className="wb-section wb-bank">
        <div className="wb-noprint">
          <h2 id="wb-s4">4｜題庫：瀏覽、隨機練習、練習卷</h2>
          <p>
            題庫有三種用法：逐章<strong>瀏覽</strong>、<strong>隨機練習</strong>（連題目一起隨機抽、記下作答統計），或自己選範圍印成<strong>練習卷</strong>。三者用的是同一批題目，詳解也都由同一個 <code>solve()</code> 當場算出。
          </p>
          <Diagram
            chart={CHART_BANK}
            caption="題目從各章的 handcalcs.ts 進來；瀏覽與隨機練習共用同一組篩選，練習卷自己選範圍；三種用法的詳解都由 solve() 算出（藍色）。"
            ariaLabel="題庫的結構圖：各章的手算題經過篩選後進入題庫瀏覽與隨機練習，練習卷自己選章節、難度與題數並可列印；三者的詳解都由 solve 呼叫模擬函式算出"
          >
            <p>
              <strong>先看</strong>
              左邊：題目只有一個來源（各章與各頁的 <code>handcalcs.ts</code>），本頁不新增公式。<code>?ch</code>、<code>?level</code>、<code>?q</code> 這三個網址參數就是篩選條件，所以篩好的畫面可以直接貼給別人。
            </p>
            <p>
              <strong>再看</strong>
              右邊：題庫瀏覽和隨機練習吃同一組篩選；練習卷則由你自己勾章節、難度與題數（虛線表示切到練習卷的那一刻會沿用目前的篩選當起點），印出來有空白作答區和逐步解答。三條路最後都接到藍色的 <code>def.solve()</code>，它呼叫 <code>src/simulation</code> 的模型函式，所以詳解的數字和各章的互動實驗是同一份計算。
            </p>
          </Diagram>
          <div className="wb-tabs" role="tablist" aria-label="題庫的使用方式">
            {TAB_ORDER.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                id={`wb-tab-${t}`}
                aria-selected={tab === t}
                aria-controls="wb-tabpanel"
                className={`wb-tab${tab === t ? ' active' : ''}`}
                onClick={() => setTab(t)}
              >
                {TAB_LABEL[t]}
              </button>
            ))}
          </div>
          {ready && tab !== 'sheet' && <FilterBar filters={filters} onChange={setFilters} groups={groups} levelCounts={levelCounts} shown={filtered.length} total={all.length} />}
        </div>

        <div role="tabpanel" id="wb-tabpanel" aria-labelledby={`wb-tab-${tab}`} className="wb-tabpanel" data-tab={tab} aria-busy={!ready || undefined}>
          {!ready && (
            <p className="small muted wb-loading" role="status">
              載入全站手算題中…
            </p>
          )}
          {ready && tab === 'browse' && <Browse groups={filteredGroups} solved={stats.solved} focusId={focusId} />}
          {ready && practiceMounted && (
            <div className="wb-noprint" hidden={tab !== 'practice'} data-testid="wb-practice-host">
              <RandomPractice pool={filtered} groups={groups} stats={stats} dispatch={dispatch} initialSeed={initialSeed} />
            </div>
          )}
          {ready && tab === 'sheet' && <WorksheetBuilder all={all} groups={groups} initial={sheetInitial} />}
        </div>
      </section>

      <ToolsDock />
    </div>
  )
}
