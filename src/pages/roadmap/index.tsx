import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Callout, ClaimTag, ModelLevel, ModeGate, Section, SourceTag, SymbolTable } from '@/components'
import './roadmap.css'
import { ITEMS, itemById, type ItemId } from './data'
import { ROADMAP_SYMBOLS } from './symbols'
import { ErratumTag, JumpButton, mt, PageRef, SYMBOLS_ANCHOR, SymbolsLink } from './common'
import { Intro } from './sections/Intro'
import { Overview } from './sections/Overview'
import { cardDomId, ItemCard } from './sections/ItemCard'
import { Phases } from './sections/Phases'
import { Docs } from './sections/Docs'
import { FormulaList, Methods, Wrapup } from './sections/Wrapup'

/**
 * Research Backlog / Roadmap（規格附錄 C R1–R10 + SSPLL 案例 + docs/implementation_plan.md 的 P0–P5）。
 * 研究項目一律不標 verified；每張卡片的「數學預覽」只在展開時才計算。
 * 預覽的 Monte Carlo 都是固定 seed、在主執行緒執行（預設設定下每個實驗 ≤ ~2e5 個樣本；burn-in 不足時標示「不判定」）。
 * 深連結：`#/roadmap?item=R4` 會展開並捲到 R4。
 * 每個預覽（R3 與 SSPLL 除外）在推導之後有一題「帶入手算」（handcalcs.ts 的 HC-RM.n）。
 * 符號表放在頁尾（§8，id="symbols"；docs/teaching-style.md §5），頁首只留一行連結；方塊圖的原始碼在 diagrams.ts。
 */
export default function RoadmapPage() {
  const [params] = useSearchParams()
  const [open, setOpen] = useState<Set<ItemId>>(() => {
    const id = params.get('item')
    return new Set(id && itemById(id) ? [id as ItemId] : [])
  })
  const [scrollTo, setScrollTo] = useState<ItemId | null>(() => {
    const id = params.get('item')
    return id && itemById(id) ? (id as ItemId) : null
  })

  useEffect(() => {
    const id = params.get('item')
    if (id && itemById(id)) {
      setOpen((s) => (s.has(id as ItemId) ? s : new Set(s).add(id as ItemId)))
      setScrollTo(id as ItemId)
    }
  }, [params])

  useEffect(() => {
    if (!scrollTo) return
    const el = document.getElementById(cardDomId(scrollTo))
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    setScrollTo(null)
  }, [scrollTo])

  const toggle = useCallback((id: ItemId) => {
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }, [])

  const openAndJump = useCallback((id: ItemId) => {
    setOpen((s) => (s.has(id) ? s : new Set(s).add(id)))
    setScrollTo(id)
  }, [])

  return (
    <article className="rm">
      <div className="c-tag-row">
        <ClaimTag kind="research" />
        <SourceTag kind="illustrative" />
        <ModelLevel level="L1" />
        <ModelLevel level="L4" />
        <ModelLevel level="L6" />
      </div>
      <p>
        規格附錄 C 的十個研究題目（R1–R10），加上使用者實際遇到的 <a href="#/case/sspll">SSPLL 8 相 PMUX + input DTC 極性案例</a>（4 GHz reference、閉迴路頻寬 320 MHz），以及網站本身的實作階段 P0–P5。
        每個題目列出：目標、為什麼重要、需要的數學、本站已經有的部分（連結）與還沒做的部分，並附一個可以動手算的<strong>數學預覽</strong>。
      </p>
      <Callout kind="warn" title="誠實聲明">
        這一頁上的研究項目沒有任何一個是 verified；狀態只有 partial / pending / not started / in analysis。預覽中的公式在註明的簡化模型內推導，並以「封閉式 vs 數值 vs Monte Carlo」交叉驗算，
        但研究題目本身仍未完成。所有數值皆為 illustrative / simulation，不是量測。
      </Callout>
      <SymbolsLink />
      <ModeGate min="engineer">
        <Callout kind="info" title="本頁採用的全站勘誤">
          <ErratumTag eid="E13" /> {mt(String.raw`單位：$u$ 無因次、$w$ 與 $\mu$ 為 fs、$K=K_qC$；`)}
          <ErratumTag eid="E22" /> {mt(String.raw`正則化寫 $\varepsilon$；`)}
          <ErratumTag eid="E28" /> PSD 正規化；
          <ErratumTag eid="E33" /> {mt(String.raw`$\delta w=w-w^*$。`)}
          點擊到 <PageRef id="verification" /> 看完整說明。
        </Callout>
      </ModeGate>

      <Section kind="intuition" title="0. 這一頁要回答的問題" level={2} id="rm-start">
        <Intro />
      </Section>

      <Section kind="diagram" title="1. 總覽：狀態、模型層級與依賴" level={2} id="rm-overview">
        <Overview onOpen={openAndJump} />
      </Section>

      <Section kind="formula" title="2. 研究項目：目標、數學、已有與待辦" level={2} id="rm-items">
        <p className="small muted">
          每張卡片下方的按鈕展開「數學預覽」：逐步推導、<strong>帶入手算</strong>（把你自己的數字代進這一頁的公式，用紙筆與工程計算機一步一步算，再對答案）、互動實驗（可匯出 CSV / JSON / HTML 報告）、核心程式碼與 Research 模式的延伸。
          R3 的手算題在 <PageRef id="ch13">第 13 章</PageRef>、SSPLL 的在<a href="#/case/sspll">案例頁</a>，這裡不重複。
        </p>
        {ITEMS.map((it) => (
          <ItemCard key={it.id} item={it} open={open.has(it.id)} onToggle={() => toggle(it.id)} />
        ))}
      </Section>

      <Section kind="example" title="3. 方法比較：同一個數，用不同算法驗算" level={2} id="rm-methods">
        <Methods />
      </Section>

      <Section kind="assumptions" title="4. 實作階段 P0–P5 與驗收條件" level={2} id="rm-phases">
        <Phases />
      </Section>

      <Section kind="assumptions" title="5. 文件、勘誤與 Definition of Done" level={2} id="rm-docs">
        <Docs />
      </Section>

      <Section kind="explore" title="6. 思考題與本頁必記" level={2} id="rm-wrap">
        <Wrapup />
      </Section>

      <Section kind="formula" title="7. 本頁公式登錄（F-R1.1 … F-SS.6）" level={2} id="rm-formulas">
        <p className="small muted">
          與 <code>src/pages/roadmap/formulas.ts</code> 同一份資料；每個 ID 只在這裡出現一次，作為 <PageRef id="formulas" /> 的錨點。
        </p>
        <FormulaList />
      </Section>

      <Section kind="formula" title="8. 本頁符號表" level={2} id={SYMBOLS_ANCHOR}>
        <p className="small muted">
          正文與各預覽裡每個符號第一次出現時都已經就地說明；這裡把它們集中起來，方便回頭查單位、第一次出現的項目，以及和全站約定或勘誤的關係。{' '}
          <JumpButton to="rm-start">↑ 回到頁首</JumpButton>
        </p>
        <SymbolTable
          rows={ROADMAP_SYMBOLS}
          title="本頁符號"
          caption={mt(String.raw`時間索引：$n$ 是 comparator sample（取樣率 $f_s$，SSPLL 中即 $f_{\mathrm{ref}}$），$k$ 是 GMAC block（更新率 $f_u=f_s/N$）。PSD 預設單邊 per-Hz。局部符號只在標示的項目內有效。`)}
        />
      </Section>
    </article>
  )
}
