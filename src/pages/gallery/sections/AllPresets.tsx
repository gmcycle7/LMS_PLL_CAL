import { useCallback, useDeferredValue, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SelectControl, ToggleControl } from '@/components'
import type { PresetEntry } from '@/data/types'
import { ALL_PRESETS } from '@/app/presets'
import { PAGES } from '@/app/registry'
import { EMPTY_FILTERS, filterPresets, hasActiveFilter, pageOrder, PREVIEWABLE_EXPERIMENTS, T_IDS, type PresetFilters } from '../data'
import { pageNav } from '../common'
import { PresetCard } from './PresetCard'

const LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6'] as const
const SOURCES = ['illustrative', 'simulation', 'literature', 'measured'] as const
const PREVIEWABLE = new Set(PREVIEWABLE_EXPERIMENTS)

/** 篩選條件放在網址（#/gallery?page=/ch/05&level=L1&t=T04…），可直接分享 */
export function useGalleryFilters(): [PresetFilters, (patch: Partial<PresetFilters>) => void, () => void] {
  const [sp, setSp] = useSearchParams()
  const filters: PresetFilters = useMemo(
    () => ({
      page: sp.get('page') ?? '',
      level: sp.get('level') ?? '',
      test: sp.get('t') ?? '',
      source: sp.get('src') ?? '',
      q: sp.get('q') ?? '',
      galleryOnly: sp.get('g') === '1',
      previewOnly: sp.get('pv') === '1',
    }),
    [sp],
  )
  const set = useCallback(
    (patch: Partial<PresetFilters>) => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev)
          const f = { ...filters, ...patch }
          const put = (k: string, v: string) => (v ? next.set(k, v) : next.delete(k))
          put('page', f.page)
          put('level', f.level)
          put('t', f.test)
          put('src', f.source)
          put('q', f.q)
          put('g', f.galleryOnly ? '1' : '')
          put('pv', f.previewOnly ? '1' : '')
          return next
        },
        { replace: true },
      )
    },
    [filters, setSp],
  )
  const reset = useCallback(() => set(EMPTY_FILTERS), [set])
  return [filters, set, reset]
}

interface Group {
  key: string
  title: string
  presets: PresetEntry[]
}

/** 全部 preset：先列 §19.2 的 12 個，其餘依頁面（側欄順序）分組 */
export function AllPresets({ onInspect }: { onInspect: (id: string) => void }) {
  const [filters, setFilters, reset] = useGalleryFilters()
  const dFilters = useDeferredValue(filters)
  const paths = useMemo(() => PAGES.map((p) => p.path), [])
  const pageOptions = useMemo(() => {
    const used = [...new Set(ALL_PRESETS.map((p) => p.page))].sort((a, b) => pageOrder(a, paths) - pageOrder(b, paths))
    return [{ value: '', label: '全部頁面' }, ...used.map((p) => ({ value: p, label: `${pageNav(p).nav}（${ALL_PRESETS.filter((x) => x.page === p).length}）` }))]
  }, [paths])
  const shown = useMemo(() => filterPresets(ALL_PRESETS, dFilters, PREVIEWABLE), [dFilters])
  const groups: Group[] = useMemo(() => {
    const req = shown.filter((p) => p.galleryIndex !== undefined).sort((a, b) => (a.galleryIndex ?? 99) - (b.galleryIndex ?? 99))
    const rest = shown.filter((p) => p.galleryIndex === undefined)
    const byPage = new Map<string, PresetEntry[]>()
    for (const p of rest) byPage.set(p.page, [...(byPage.get(p.page) ?? []), p])
    const out: Group[] = []
    if (req.length) out.push({ key: 'required', title: '規格 §19.2 必備（galleryIndex 1–12；已在 §4 逐一說明）', presets: req })
    for (const page of [...byPage.keys()].sort((a, b) => pageOrder(a, paths) - pageOrder(b, paths))) {
      out.push({ key: page, title: pageNav(page).nav, presets: byPage.get(page) ?? [] })
    }
    return out
  }, [shown, paths])
  const active = hasActiveFilter(dFilters)
  return (
    <>
      <div className="gal-filters" role="search" aria-label="篩選 presets">
        <SelectControl label="頁面／章節" value={filters.page} onChange={(page) => setFilters({ page })} options={pageOptions} />
        <SelectControl
          label="模型層級"
          value={filters.level}
          onChange={(level) => setFilters({ level })}
          options={[{ value: '', label: '全部層級' }, ...LEVELS.map((l) => ({ value: l, label: l }))]}
          hint="規格 §15.1：L0 純量 → L6 進階 PLL；層級隨參數改變的實驗列出所有可能值"
        />
        <SelectControl
          label="驗收測試 T-id"
          value={filters.test}
          onChange={(test) => setFilters({ test })}
          options={[{ value: '', label: '全部' }, ...T_IDS.map((t) => ({ value: t, label: t })), { value: 'none', label: '沒有 T-id' }]}
        />
        <SelectControl
          label="來源"
          value={filters.source}
          onChange={(source) => setFilters({ source })}
          options={[{ value: '', label: '全部' }, ...SOURCES.map((s) => ({ value: s, label: s }))]}
        />
        <label className="gal-search">
          <span className="small">關鍵字</span>
          <input type="text" value={filters.q} placeholder="id、標題、說明或預期文字" onChange={(e) => setFilters({ q: e.target.value })} aria-label="關鍵字搜尋" />
        </label>
        <ToggleControl label="只看 §19.2 的 12 個" value={filters.galleryOnly} onChange={(galleryOnly) => setFilters({ galleryOnly })} />
        <ToggleControl label="只看可即時預覽的" value={filters.previewOnly} onChange={(previewOnly) => setFilters({ previewOnly })} />
        <button type="button" className="btn" onClick={reset} disabled={!hasActiveFilter(filters)}>
          清除篩選
        </button>
      </div>
      <p className="small muted gal-count" aria-live="polite">
        顯示 {shown.length} / {ALL_PRESETS.length} 個 preset（{groups.length} 組）{active ? '；篩選條件已寫進網址，可直接分享。' : '。'}
      </p>
      {shown.length === 0 && <p className="gal-empty">沒有符合條件的 preset。請放寬篩選或按「清除篩選」。</p>}
      {groups.map((g) => (
        <PresetGroup key={`${g.key}-${active ? 'f' : 'a'}`} group={g} defaultOpen={active || (g.key !== 'required' && g.presets.length <= 6)} onInspect={onInspect} />
      ))}
    </>
  )
}

/**
 * 一組 preset（可收合）。收合時不渲染卡片：全站兩百多個 preset 不必同時放進 DOM。
 * 沒有篩選時，§19.2 那一組預設收合（它們已經在 §4 逐一列出）。
 */
function PresetGroup({ group, defaultOpen, onInspect }: { group: Group; defaultOpen: boolean; onInspect: (id: string) => void }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <details className="gal-group" open={open} data-group={group.key} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span className="gal-group-title">{group.title}</span> <span className="small muted">（{group.presets.length}）</span>
      </summary>
      {open && (
        <div className="gal-group-body">
          {group.presets.map((p) => (
            <PresetCard key={p.id} preset={p} onInspect={onInspect} domId={`gal-all-${p.id}`} />
          ))}
        </div>
      )}
    </details>
  )
}
