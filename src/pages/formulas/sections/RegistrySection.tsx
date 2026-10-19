import { useEffect, useMemo, useRef, useState } from 'react'
import { ClaimTag, mathText, Mermaid, ModelLevel, Section, SelectControl, TexBlock, ToggleControl } from '@/components'
import { CLAIM_LABEL, type ClaimKind, type ModelLevelId } from '@/components'
import { ALL_FORMULAS, registryStats, type RegistryRow } from '../registry'
import { chapterFrameMeta } from '@/app/chapterMeta'
import { ErrataList, FormulaLink, Gate, MatchCount, NoMatch, useMode, shortPageLabel } from '../common'
import { CHART_FORMULA_LINKS } from '../diagrams'
import { useNarrow } from '../useNarrow'

/**
 * (1) 全站公式登錄：import.meta.glob 收集所有 chapters/*\/formulas.ts 與 pages/*\/formulas.ts。
 * 搜尋（頁面頂端）之外，另有頁面／結論標籤／模型層級／勘誤四個篩選器。
 * 點「前往」會切到該頁並捲到 #formula-<id>（jump.ts）。
 */

const LEVELS: ModelLevelId[] = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6']
const PAGE_SIZE = 60
/** 登錄表的內容欄窄於這個寬度（px）就自動改成卡片檢視：兩欄表格在這個寬度以下，公式欄只剩 580px 不到，放不下的公式要折成三四行 */
export const REGISTRY_CARDS_BELOW = 720

/**
 * 「在哪個模型內精確」欄的文字（2026-10-19，depth 審查：1,320 個 exact 對 664 個 approx，讀者分不清依賴的是哪個模型）：
 * 公式自己有 `assumes` 就用它；沒有就退回該章 chapterMeta 的 models（章的預設），都沒有時回傳 null（工具頁沒有章節骨架）。
 */
export function formulaModelText(f: Pick<RegistryRow, 'assumes' | 'pageId'>): { text: string; fromChapter: boolean } | null {
  if (f.assumes) return { text: f.assumes, fromChapter: false }
  const meta = f.pageId ? chapterFrameMeta(f.pageId) : undefined
  if (!meta || meta.models.length === 0) return null
  return { text: meta.models.map((m) => m.label).join('、'), fromChapter: true }
}

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

/** 第一次 render（量到容器寬度之前）的猜測：手機寬度先用卡片，避免先畫一次表格再換掉 */
function initialNarrow(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 760px)').matches
  } catch {
    return false
  }
}

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
  // 卡片檢視：讀者按過開關就照讀者的；沒按過就依內容欄寬度自動決定（桌機視窗 1000px 時內容欄也只有 650px，所以不看視窗寬度）
  const [cardsChoice, setCardsChoice] = useState<boolean | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const narrow = useNarrow(bodyRef, REGISTRY_CARDS_BELOW, initialNarrow())
  const cards = cardsChoice ?? narrow
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
          所有章節與頁面登錄的公式（<span className="mono">src/chapters/*/formulas.ts</span>、<span className="mono">src/pages/*/formulas.ts</span>）在這裡自動彙整，共 <strong>{ALL_FORMULAS.length}</strong> 條。每一條都有：ID、名稱、TeX、使用條件、「在哪個模型內精確」（公式自己登錄的一句話，沒有就是該章章首列的模型）、結論標籤、模型層級、規格段落、所在頁面，以及（若與規格原文不同）勘誤編號。點 <strong>前往</strong> 會切換到該頁並捲到公式本身（錨點 <span className="mono">#formula-ID</span>）。
        </p>
      )}
      {!searching && (
        <Mermaid
          chart={CHART_FORMULA_LINKS}
          caption="一個公式 ID 的旅程：章節的 formulas.ts 登錄（藍色是彙整後的 $\mathtt{ALL\_FORMULAS}$，也就是下面這張表）→ 按「前往」跳到該章的 #formula-ID 錨點；與規格原文不同的公式帶勘誤編號 Exx，紅色的 errata.json 提供 tooltip 摘要並連到驗證頁。"
        />
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
        <ToggleControl label="卡片檢視（窄螢幕）" value={cards} onChange={setCardsChoice} />
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
      <div ref={bodyRef} className="fr-reg-body">
        {filtered.length === 0 ? (
          <NoMatch what="公式" />
        ) : (
          /*
            兩欄、不橫向捲動：原本六欄的表格比內容欄寬 1.4 倍，最右邊的「標籤」「規格」被切在畫面外、也沒有任何提示。
            現在左欄是「ID 與位置」（ID 在上、前往連結在下），右欄是整條公式：第一行是名稱，右上角是標籤、模型層級、規格段落與勘誤，
            接著是公式本身與使用條件。公式欄拿到內容欄約 85% 的寬度，放不下的獨立公式在最外層的等號／運算子後面換行（formulas.css）。
            外框不是捲動容器（.fr-reg-wrap { overflow: visible }）：表頭才能 position: sticky，黏在搜尋列下面。
          */
          <div className={`table-wrap fr-reg-wrap${cards ? ' fr-cards' : ''}`}>
            <table className="fr-table fr-reg-table fr-sticky-head">
              <thead>
                <tr>
                  <th>ID 與位置</th>
                  <th>
                    <span className="fr-reg-th">
                      <span>名稱、公式與使用條件</span>
                      <span className="fr-reg-th-side">標籤、規格、勘誤</span>
                    </span>
                  </th>
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.page + g.rows[0].id}>
                  <tr className="fr-group-row">
                    <th colSpan={2} scope="colgroup">
                      {g.nav} <span className="muted small">（{g.page}）</span>
                    </th>
                  </tr>
                  {g.rows.map((f) => (
                    <tr key={f.id} id={registryDomId(f.id)} className={f.id === focusId ? 'fr-focus' : undefined} data-formula-row={f.id}>
                      <td data-label="ID 與位置" className="fr-reg-id">
                        <div className="fr-reg-idbox">
                          <span className="mono nowrap fr-reg-idtext">{f.id}</span>
                          <FormulaLink id={f.id}>前往 {f.pageId ? shortPageLabel(f.pageId, f.pageNav) : f.page}</FormulaLink>
                        </div>
                      </td>
                      {/*
                        使用條件放在公式的正下方（同一格），不另外佔一欄：條件用公式欄的寬度換行，
                        另外佔一欄時它只拿得到最小寬度，四五百字的條件會排成六七百 px 高的細長條。
                      */}
                      <td data-label="名稱、公式與使用條件" className="fr-reg-formula">
                        <div className="fr-reg-head">
                          <div className="fr-f-title">{mathText(f.title)}</div>
                          <div className="fr-reg-meta">
                            <ClaimTag kind={f.claim} />
                            <ModelLevel level={f.level} />
                            <span className="fr-reg-spec nowrap">規格 §{f.specSection}</span>
                            {f.erratumId && <ErrataList ids={[f.erratumId]} />}
                          </div>
                        </div>
                        <TexBlock>{f.tex}</TexBlock>
                        {showSource && mode === 'research' && <code className="fr-tex-src">{f.tex}</code>}
                        <div className="fr-reg-cond">
                          <span className="fr-reg-cond-label">使用條件</span>
                          {mathText(f.conditions)}
                          {(() => {
                            const m = formulaModelText(f)
                            return (
                              m && (
                                <div className="fr-reg-model small" data-model-source={m.fromChapter ? 'chapter' : 'formula'}>
                                  <span className="fr-reg-model-label">{f.claim === 'exact' ? '在哪個模型內精確' : f.claim === 'approx' ? '近似所依賴的模型' : '依賴的模型'}</span>
                                  {mathText(m.text)}
                                  {m.fromChapter && <span className="muted">（本章預設）</span>}
                                </div>
                              )
                            )
                          })()}
                          {f.units && (
                            <div className="fr-units small muted">
                              單位：
                              {Object.entries(f.units)
                                .map(([k, v]) => `${k} [${v}]`)
                                .join('、')}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </div>
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
          TeX 由各章作者登錄；「名稱」與「使用條件」是各章登錄時填的說明文字（其中的行內 LaTeX 會以 KaTeX 顯示，其餘照原樣列出，所以可能含 Unicode 數學符號）。標籤定義見頁首；模型層級 L0–L6 見 §6 術語表。公式的完整推導、圖與互動實驗在各章頁面上；這裡只做索引與交叉查核。
        </p>
      )}
    </Section>
  )
}
