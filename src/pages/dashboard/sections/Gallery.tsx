import { memo, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Badge, SourceTag, TestBadge } from '@/components'
import { ALL_PRESETS, presetHref } from '@/app/presets'
import { PAGES } from '@/app/registry'
import type { PresetEntry } from '@/data/types'
import { shortCode } from '../data'
import { Rich, plainTip } from '../ui'

/** 規格 §19.2 的 12 個必備 presets（galleryIndex 1–12），依編號排序；每個編號只取第一個 */
export function galleryPresets(all: PresetEntry[] = ALL_PRESETS): PresetEntry[] {
  const seen = new Set<number>()
  return all
    .filter((p) => typeof p.galleryIndex === 'number' && p.galleryIndex >= 1 && p.galleryIndex <= 12)
    .sort((a, b) => (a.galleryIndex as number) - (b.galleryIndex as number) || a.id.localeCompare(b.id))
    .filter((p) => (seen.has(p.galleryIndex as number) ? false : (seen.add(p.galleryIndex as number), true)))
}

/** 12 個必備實驗的捷徑：清單由 src/data/presets/*.json 自動彙整，點擊即帶著參數打開對應章節的互動實驗 */
export const GallerySection = memo(function GallerySection() {
  const items = useMemo(() => galleryPresets(), [])
  const experiments = useMemo(() => new Set(ALL_PRESETS.map((p) => p.experiment)).size, [])
  const missing = Array.from({ length: 12 }, (_, i) => i + 1).filter((n) => !items.some((p) => p.galleryIndex === n))
  return (
    <section id="dash-gallery" aria-labelledby="dash-gallery-h">
      <h2 id="dash-gallery-h" className="dash-h2">
        12 個必備實驗：一鍵載入 <span className="dash-h2-kicker">規格 §19.2</span>
      </h2>
      <p className="dash-lead-sm">
        不想從頭讀？每張卡片會<strong>帶著參數</strong>打開對應章節的互動實驗（網址含 <code>?preset=…</code>，可以直接分享）。卡片下方是載入後應該看到的關鍵結果，你可以自己驗證它。全站目前有 {ALL_PRESETS.length} 個 presets、涵蓋 {experiments} 個互動實驗。 <SourceTag kind="illustrative" />
      </p>
      <ol className="dash-gal-grid">
        {items.map((p) => {
          const page = PAGES.find((x) => x.path === p.page)
          return (
            <li key={p.id} className="dash-gal-card">
              <Link to={presetHref(p)} className="dash-gal-link" title={plainTip(p.description)}>
                <span className="dash-gal-n" aria-hidden="true">
                  {p.galleryIndex}
                </span>
                <span className="dash-gal-title">
                  <Rich text={p.title} />
                </span>
              </Link>
              <div className="dash-gal-expected" title={plainTip(p.expected)}>
                <Rich text={p.expected} />
              </div>
              <div className="dash-badges">
                <Badge className="dash-chip">{page ? (shortCode(page.id) ?? page.nav) : p.page}</Badge>
                {(p.tests ?? []).map((t) => (
                  <TestBadge key={t} id={t} />
                ))}
              </div>
            </li>
          )
        })}
      </ol>
      {missing.length > 0 && (
        <p className="small muted">
          尚未提供的編號：{missing.join('、')}（對應章節的 preset 檔尚未加入 <code>src/data/presets/</code>；狀態：pending）。
        </p>
      )}
      <p style={{ marginTop: 10 }}>
        <Link to="/gallery" className="btn">
          到 Experiment Gallery 看全部 presets →
        </Link>
      </p>
    </section>
  )
})
