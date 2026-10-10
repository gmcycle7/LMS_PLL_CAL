import { useEffect, useMemo, useState } from 'react'
import { ClaimTag, mathText, ModelLevel, Section, SelectControl, TexBlock, ToggleControl } from '@/components'
import { CLAIM_LABEL, type ClaimKind, type ModelLevelId } from '@/components'
import { ALL_FORMULAS, registryStats, type RegistryRow } from '../registry'
import { ErrataList, FormulaLink, Gate, MatchCount, NoMatch, useMode, shortPageLabel } from '../common'

/**
 * (1) 全站公式登錄：import.meta.glob 收集所有 chapters/*\/formulas.ts 與 pages/*\/formulas.ts。
 * 搜尋（頁面頂端）之外，另有頁面／結論標籤／模型層級／勘誤四個篩選器。
 * 點「前往」會切到該頁並捲到 #formula-<id>（jump.ts）。
 */

const LEVELS: ModelLevelId[] = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6']
const PAGE_SIZE = 60

export function registryDomId(id: string): string {
  return `fr-ref-${id.replace(/[^\w-]/g, '_')}`
}

export interface RegistryFilters {
  page: string
  claim: 'all' | ClaimKind
  level: 'all' | ModelLevelId
  erratum: string
}

export const DEFAULT_FILTERS: RegistryFilters = { page: 'all', claim: 'all', level: 'all', erratum: 'all' }

/** 篩選器（純函式，方便測試） */
export function applyRegistryFilters(rows: readonly RegistryRow[], f: RegistryFilters): RegistryRow[] {
  return rows.filter(
    (r) =>
      (f.page === 'all' || r.page === f.page) &&
      (f.claim === 'all' || r.claim === f.claim) &&
      (f.level === 'all' || r.level === f.level) &&
      (f.erratum === 'all' || (f.erratum === 'with' ? !!r.erratumId : f.erratum === 'without' ? !r.erratumId : r.erratumId === f.erratum)),
  )
}

export function RegistrySection({ rows, searching, focusId }: { rows: RegistryRow[]; searching: boolean; focusId: string | null }) {
  const { mode } = useMode()
  const [filters, setFilters] = useState<RegistryFilters>(DEFAULT_FILTERS)
  const [cards, setCards] = useState<boolean>(() => {
    try {
      return typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 760px)').matches
    } catch {
      return false
    }
  })
  const [showSource, setShowSource] = useState(false)
  const [limit, setLimit] = useState(PAGE_SIZE)

  const pages = useMemo(() => {
    const seen = new Map<string, string>()
    for (const r of ALL_FORMULAS) if (!seen.has(r.page)) seen.set(r.page, r.pageNav)
    return [...seen]
  }, [])
  const errataOptions = useMemo(() => [...new Set(ALL_FORMULAS.map((r) => r.erratumId).filter((e): e is string => !!e))].sort(), [])

  const filtered = useMemo(() => applyRegistryFilters(rows, filters), [rows, filters])
  const filtersActive = filters.page !== 'all' || filters.claim !== 'all' || filters.level !== 'all' || filters.erratum !== 'all'
  const stats = useMemo(() => registryStats(filtered), [filtered])

  // 精確 ID 查詢：確保那一列在顯示範圍內並捲過去
  const focusIndex = focusId ? filtered.findIndex((r) => r.id === focusId) : -1
  const effectiveLimit = focusIndex >= limit ? focusIndex + 1 : limit
  const visible = filtered.slice(0, effectiveLimit)
  useEffect(() => {
    if (!focusId) return
    const el = document.getElementById(registryDomId(focusId))
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  }, [focusId])

  // 分組（依頁面）
  const groups: { page: string; nav: string; pageId: string | null; rows: RegistryRow[] }[] = []
  for (const r of visible) {
    const g = groups[groups.length - 1]
    if (g && g.page === r.page) g.rows.push(r)
    else groups.push({ page: r.page, nav: r.pageNav, pageId: r.pageId, rows: [r] })
  }

  const set = (patch: Partial<RegistryFilters>) => {
    setFilters((f) => ({ ...f, ...patch }))
    setLimit(PAGE_SIZE)
  }

  return (
    <Section kind="formula" level={2} id="fr-registry" title="4　全站公式登錄（Formula Registry）">
      {!searching && (
        <p>
          所有章節與頁面登錄的公式（<span className="mono">src/chapters/*/formulas.ts</span>、<span className="mono">src/pages/*/formulas.ts</span>）在這裡自動彙整，
          共 <strong>{ALL_FORMULAS.length}</strong> 條。每一條都有：ID、名稱、TeX、使用條件、結論標籤、模型層級、規格段落、所在頁面，以及（若與規格原文不同）勘誤編號。
          點 <strong>前往</strong> 會切換到該頁並捲到公式本身（錨點 <span className="mono">#formula-ID</span>）。
        </p>
      )}
      <div className="fr-filters">
        <SelectControl
          label="頁面"
          value={filters.page}
          onChange={(v) => set({ page: v })}
          options={[{ value: 'all', label: '全部頁面' }, ...pages.map(([p, nav]) => ({ value: p, label: nav }))]}
        />
        <SelectControl
          label="結論標籤"
          value={filters.claim}
          onChange={(v) => set({ claim: v as RegistryFilters['claim'] })}
          options={[{ value: 'all', label: '全部' }, ...(['exact', 'approx', 'research'] as ClaimKind[]).map((c) => ({ value: c, label: CLAIM_LABEL[c] }))]}
        />
        <SelectControl
          label="模型層級"
          value={filters.level}
          onChange={(v) => set({ level: v as RegistryFilters['level'] })}
          options={[{ value: 'all', label: '全部' }, ...LEVELS.map((l) => ({ value: l, label: l }))]}
        />
        <SelectControl
          label="勘誤"
          value={filters.erratum}
          onChange={(v) => set({ erratum: v })}
          options={[
            { value: 'all', label: '全部' },
            { value: 'with', label: '有勘誤註記' },
            { value: 'without', label: '無勘誤' },
            ...errataOptions.map((e) => ({ value: e, label: e })),
          ]}
        />
        <ToggleControl label="卡片檢視（窄螢幕）" value={cards} onChange={setCards} />
        <Gate min="research">
          <ToggleControl label="顯示 TeX 原始碼" value={showSource} onChange={setShowSource} />
        </Gate>
        {filtersActive && (
          <button type="button" className="btn" onClick={() => set(DEFAULT_FILTERS)}>
            清除篩選
          </button>
        )}
      </div>
      <div className="fr-reg-summary small">
        <MatchCount shown={filtered.length} total={ALL_FORMULAS.length} active={searching || filtersActive} />
        <Gate min="engineer">
          <span className="muted">
            {' '}
            · {(['exact', 'approx', 'research'] as ClaimKind[]).map((c) => `${CLAIM_LABEL[c]} ${stats.byClaim[c]}`).join('、')}
            {' '}
            · {LEVELS.filter((l) => stats.byLevel[l]).map((l) => `${l}×${stats.byLevel[l]}`).join(' ')}
            {' '}
            · 有勘誤註記 {stats.withErratum}
          </span>
        </Gate>
      </div>
      {filtered.length === 0 ? (
        <NoMatch what="公式" />
      ) : (
        <div className={`table-wrap fr-reg-wrap${cards ? ' fr-cards' : ''}`}>
          <table className="fr-table fr-reg-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>名稱與公式</th>
                <th>使用條件</th>
                <th>標籤</th>
                <th>規格</th>
                <th>位置</th>
                <th>勘誤</th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.page + g.rows[0].id}>
                <tr className="fr-group-row">
                  <th colSpan={7} scope="colgroup">
                    {g.nav} <span className="muted small">（{g.page}）</span>
                  </th>
                </tr>
                {g.rows.map((f) => (
                  <tr key={f.id} id={registryDomId(f.id)} className={f.id === focusId ? 'fr-focus' : undefined} data-formula-row={f.id}>
                    <td data-label="ID" className="nowrap mono">
                      {f.id}
                    </td>
                    <td data-label="名稱與公式" className="fr-reg-formula">
                      <div className="fr-f-title">{mathText(f.title)}</div>
                      <TexBlock>{f.tex}</TexBlock>
                      {showSource && mode === 'research' && <code className="fr-tex-src">{f.tex}</code>}
                    </td>
                    <td data-label="使用條件" className="fr-reg-cond">
                      {mathText(f.conditions)}
                      {f.units && (
                        <div className="fr-units small muted">
                          單位：
                          {Object.entries(f.units)
                            .map(([k, v]) => `${k} [${v}]`)
                            .join('、')}
                        </div>
                      )}
                    </td>
                    <td data-label="標籤">
                      <span className="fr-tag-col">
                        <ClaimTag kind={f.claim} />
                        <ModelLevel level={f.level} />
                      </span>
                    </td>
                    <td data-label="規格" className="nowrap">
                      §{f.specSection}
                    </td>
                    <td data-label="位置" className="nowrap">
                      <FormulaLink id={f.id}>前往 {f.pageId ? shortPageLabel(f.pageId, f.pageNav) : f.page}</FormulaLink>
                    </td>
                    <td data-label="勘誤">
                      <ErrataList ids={f.erratumId ? [f.erratumId] : []} />
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
      {filtered.length > visible.length && (
        <div className="fr-more">
          <span className="small muted">
            已顯示 {visible.length} / {filtered.length} 條
          </span>
          <button type="button" className="btn" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
            再顯示 {Math.min(PAGE_SIZE, filtered.length - visible.length)} 條
          </button>
          <button type="button" className="btn" onClick={() => setLimit(filtered.length)}>
            全部顯示
          </button>
        </div>
      )}
      {!searching && (
        <p className="small muted">
          TeX 由各章作者登錄；「名稱」與「使用條件」欄是各章登錄時填的說明文字（其中的行內 LaTeX 會以 KaTeX 顯示，其餘照原樣列出，所以可能含 Unicode 數學符號）。標籤定義見頁首；模型層級 L0–L6 見 §6 術語表。
          公式的完整推導、圖與互動實驗在各章頁面上；這裡只做索引與交叉查核。
        </p>
      )}
    </Section>
  )
}
