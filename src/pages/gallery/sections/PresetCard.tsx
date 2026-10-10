import { lazy, Suspense, useState } from 'react'
import { Link } from 'react-router-dom'
import { ModeGate, SourceTag } from '@/components'
import type { PresetEntry } from '@/data/types'
import { presetHref } from '@/app/presets'
import { errataIn, experimentName, PREVIEWABLE_EXPERIMENTS } from '../data'
import { ErrataList, LevelBadges, PageLink, Rich, TestBadges } from '../common'

const PreviewPanel = lazy(() => import('./PreviewPanel'))

export function presetDomId(id: string): string {
  return `gal-preset-${id}`
}

/**
 * 一個 preset 的卡片：標題、說明、預期結果、T-id、來源、頁面、「載入並執行」連結，
 * 以及（實驗有純函式預覽時）可展開的即時預覽。preset 的文字由各章作者撰寫，原樣顯示（文字中若有 `$…$` 會以 KaTeX 顯示）。
 */
export function PresetCard({
  preset,
  onInspect,
  defaultOpen = false,
  domId,
}: {
  preset: PresetEntry
  onInspect?: (id: string) => void
  defaultOpen?: boolean
  /** DOM id（同一個 preset 在頁面上出現兩次時要不同） */
  domId?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const canPreview = PREVIEWABLE_EXPERIMENTS.includes(preset.experiment)
  const errata = errataIn(preset.title, preset.description, preset.expected)
  // presetHref 產生 HashRouter 路徑（例如 /ch/01?preset=…）；<Link> 會自動加上 #
  const href = presetHref(preset)
  return (
    <article className="gal-card" id={domId ?? presetDomId(preset.id)} data-preset={preset.id} data-gallery={preset.galleryIndex ?? undefined}>
      <header className="gal-card-head">
        {preset.galleryIndex !== undefined && <span className="gal-index" title={`規格 §19.2 第 ${preset.galleryIndex} 個必備 preset`}>#{preset.galleryIndex}</span>}
        <h4 className="gal-card-title">
          <Rich text={preset.title} />
        </h4>
      </header>
      <div className="c-tag-row gal-card-tags">
        <LevelBadges preset={preset} />
        <SourceTag kind={preset.source} />
        <TestBadges ids={preset.tests ?? []} />
        <ErrataList ids={errata} />
      </div>
      <dl className="gal-meta small">
        <dt>頁面</dt>
        <dd>
          <PageLink path={preset.page} />
        </dd>
        <dt>實驗</dt>
        <dd>
          {experimentName(preset.experiment)} <code className="gal-id">{preset.experiment}</code>
        </dd>
        <dt>preset id</dt>
        <dd>
          <code className="gal-id">{preset.id}</code>
        </dd>
      </dl>
      <p className="gal-desc">
        <Rich text={preset.description} />
      </p>
      <div className="gal-expected">
        <span className="gal-expected-label">預期結果（作者撰寫）</span>
        <span>
          <Rich text={preset.expected} />
        </span>
      </div>
      <ModeGate min="research">
        <details className="gal-params small">
          <summary>preset 參數（JSON，原樣）</summary>
          <pre className="mono">{JSON.stringify(preset.params, null, 2)}</pre>
        </details>
      </ModeGate>
      <div className="gal-actions">
        <Link className="btn btn-primary gal-run" to={href} data-href={href}>
          載入並執行 →
        </Link>
        {canPreview ? (
          <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? '收起即時預覽' : '即時預覽（真實模型函式）'}
          </button>
        ) : (
          <span className="small muted" title="這個實驗需要 worker 的長時間模擬或 Monte Carlo，Gallery 不在主執行緒重算">
            無 Gallery 預覽：請到原頁面執行
          </span>
        )}
        {canPreview && onInspect && (
          <button type="button" className="btn" onClick={() => onInspect(preset.id)}>
            在 Inspector 檢視／匯出
          </button>
        )}
      </div>
      {open && canPreview && (
        <Suspense fallback={<p className="small muted">載入模型模組並計算中…</p>}>
          <PreviewPanel preset={preset} />
        </Suspense>
      )}
    </article>
  )
}
