import { Callout, ClaimTag, TexBlock } from '@/components'
import type { SlotAudit } from '../data'
import { ErrataList, Rich, SlotStatusChip } from '../common'
import { PresetCard } from './PresetCard'

/**
 * 規格 §19.2 的 12 個實驗，依編號排列。每一格：規格原文 → 網站依勘誤採用的說法 → 核心公式 → 硬體對應／失效條件 → preset 卡片。
 * 缺少的格子只顯示「缺少」，不會補資料。
 */
export function RequiredGallery({ audit, onInspect }: { audit: SlotAudit[]; onInspect: (id: string) => void }) {
  return (
    <div className="gal-required">
      {audit.map((a) => (
        <section key={a.slot.index} className="gal-slot" data-slot={a.slot.index} aria-labelledby={`gal-slot-h-${a.slot.index}`}>
          <h3 className="gal-slot-title" id={`gal-slot-h-${a.slot.index}`}>
            <span className="gal-index">#{a.slot.index}</span> <Rich text={a.slot.condition} />
            <span className="gal-slot-arrow"> → </span>
            <Rich text={a.slot.lesson} />
          </h3>
          <div className="c-tag-row">
            <ClaimTag kind={a.slot.claim} />
            <SlotStatusChip status={a.status} />
            <ErrataList ids={a.slot.errata} />
          </div>
          {a.slot.corrected && (
            <Callout kind="warn" title="網站採用的修正說法">
              <Rich text={a.slot.corrected} />
            </Callout>
          )}
          <div className="gal-slot-math">
            <TexBlock>{a.slot.keyFormula}</TexBlock>
            <dl className="gal-slot-dl small">
              <dt>硬體上是什麼</dt>
              <dd>
                <Rich text={a.slot.hardware} />
              </dd>
              <dt>什麼時候會失效</dt>
              <dd>
                <Rich text={a.slot.failure} />
              </dd>
            </dl>
          </div>
          {a.preset ? (
            <PresetCard preset={a.preset} onInspect={onInspect} />
          ) : a.found.length > 1 ? (
            <>
              <Callout kind="danger" title="同一編號有多個 preset">
                {a.issues.join(' ')}
              </Callout>
              {a.found.map((p) => (
                <PresetCard key={p.id} preset={p} onInspect={onInspect} />
              ))}
            </>
          ) : (
            <Callout kind="danger" title={`缺少規格 §19.2 #${a.slot.index} 的 preset`}>
              目前 <code>src/data/presets/</code> 中沒有 <code>galleryIndex: {a.slot.index}</code> 的 preset。規格對應的頁面是 {a.slot.pages.join(' / ')}、實驗{' '}
              {a.slot.experiments.join(' / ')}；這一格保持空白，等負責該章的作者建立，不由 Gallery 補假資料。
            </Callout>
          )}
        </section>
      ))}
    </div>
  )
}
