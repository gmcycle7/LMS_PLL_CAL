import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useDebouncedValue } from '@/components'
import './formulas.css'
import { Gate, scrollToId, useFormulaAnchorHandler } from './common'
import { FORMULA_IDS } from './registry'
import { exactFormulaId, tokenize } from './search'
import { filterEntries, searchIndex } from './searchIndex'
import { IntroSection } from './sections/IntroSection'
import { SymbolsSection } from './sections/SymbolsSection'
import { UnitsSection } from './sections/UnitsSection'
import { QuickRefSection } from './sections/QuickRefSection'
import { RegistrySection } from './sections/RegistrySection'
import { LimitsSection } from './sections/LimitsSection'
import { GlossarySection } from './sections/GlossarySection'
import { CoverageSection, WrapupSection } from './sections/WrapupSection'
import { PageSymbolsSection } from './sections/PageSymbolsSection'

/**
 * Formula & Unit Reference（/formulas；規格 §0、附錄 A、附錄 B、術語）。
 *
 *   1 全站符號總表（§0 的修正版 + 符號衝突）      4 全站公式登錄（import.meta.glob 自動彙整）
 *   2 單位與時間索引約定（含換算器）                5 附錄 B：關鍵限制
 *   3 附錄 A：一頁公式速查（修正版）                6 術語表      7 思考題與必記      8 勘誤覆蓋（Research）
 *
 * 本頁自己新增的記號表（PageSymbolsSection，id="symbols"）放在頁面最底端，頁首只留一行連結（teaching-style §5）；全站符號總表是 §1。
 * 頁首的搜尋框同時過濾 1–6 段（AND 語意；中文／英文／TeX／Unicode 寫法互通，見 search.ts）。
 * 深連結：'#/formulas?q=ENBW'（搜尋）、'#/formulas?f=F-12.9'（定位到某條公式）、'#/formulas?preset=units-sum-vs-average'（換算器 preset）。
 * HashRouter 下不能用 <a href="#id"> 做頁內跳轉，所以目錄是按鈕（scrollToId）。
 */

/** 沒在搜尋時的說明：視覺上放在「試試」那一列，搜尋框的 status 區域只給螢幕閱讀器（formulas.css） */
const SEARCH_HELP = '輸入關鍵字會同時過濾下面六個段落（多個關鍵字以空白分隔，全部符合才顯示；按 / 聚焦、Esc 清除）'

const EXAMPLES = ['ENBW', 'μ 單位', 'sum average', 'E13', 'δ 極性', 'F-12.9', 'PE', 'rad/block', 'limit cycle']

const SECTION_NAV: { id: string; num: string; name: string; key: 'symbols' | 'units' | 'quick' | 'formulas' | 'limits' | 'glossary' | null }[] = [
  { id: 'fr-symbols', num: '1', name: '符號', key: 'symbols' },
  { id: 'fr-units', num: '2', name: '單位', key: 'units' },
  { id: 'fr-quick', num: '3', name: '速查', key: 'quick' },
  { id: 'fr-registry', num: '4', name: '公式登錄', key: 'formulas' },
  { id: 'fr-limits', num: '5', name: '限制', key: 'limits' },
  { id: 'fr-glossary', num: '6', name: '術語', key: 'glossary' },
  { id: 'fr-wrapup', num: '7', name: '思考題', key: null },
]

export default function FormulasPage() {
  const [params, setParams] = useSearchParams()
  const urlQuery = params.get('q') ?? params.get('f') ?? ''
  const [query, setQuery] = useState(urlQuery)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLDivElement | null>(null)
  const onAnchorClick = useFormulaAnchorHandler()

  // ── URL ↔ 搜尋字串（replace，不產生一長串歷史紀錄）
  const lastSynced = useRef(urlQuery)
  useEffect(() => {
    if (urlQuery !== lastSynced.current) {
      lastSynced.current = urlQuery
      setQuery(urlQuery)
    }
  }, [urlQuery])
  const debounced = useDebouncedValue(query, 400)
  useEffect(() => {
    if (debounced === lastSynced.current) return
    lastSynced.current = debounced
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (debounced.trim()) next.set('q', debounced)
        else next.delete('q')
        next.delete('f')
        return next
      },
      { replace: true },
    )
  }, [debounced, setParams])

  // ── 過濾（輸入時延後，避免每敲一個字就重排數百條 KaTeX）
  const deferred = useDeferredValue(query)
  const tokens = useMemo(() => tokenize(deferred), [deferred])
  const searching = tokens.length > 0
  const idx = useMemo(() => searchIndex(), [])
  const hit = useMemo(
    () => ({
      symbols: filterEntries(idx.symbols, tokens),
      collisions: filterEntries(idx.collisions, tokens),
      units: filterEntries(idx.units, tokens),
      quick: filterEntries(idx.quick, tokens),
      formulas: filterEntries(idx.formulas, tokens),
      limits: filterEntries(idx.limits, tokens),
      glossary: filterEntries(idx.glossary, tokens),
    }),
    [idx, tokens],
  )
  const focusId = useMemo(() => exactFormulaId(deferred, FORMULA_IDS), [deferred])
  const total = hit.symbols.length + hit.collisions.length + hit.units.length + hit.quick.length + hit.formulas.length + hit.limits.length + hit.glossary.length
  const stale = deferred !== query

  // ── '/' 聚焦搜尋框、Esc 清除
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 公式登錄表的表頭要黏在搜尋列下面（position: sticky; top: topbar + 搜尋列高度）：把搜尋列的實際高度存成 CSS 變數。
  // 桌機一列約 50px，內容欄窄時目錄換到第二列（約 85px），所以要量，不能寫死。
  useLayoutEffect(() => {
    const bar = searchRef.current
    const root = rootRef.current
    if (!bar || !root) return
    const set = () => root.style.setProperty('--fr-search-h', `${Math.round(bar.getBoundingClientRect().height)}px`)
    set()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(set)
    ro.observe(bar)
    return () => ro.disconnect()
  }, [])

  const clear = useCallback(() => {
    setQuery('')
    inputRef.current?.focus()
  }, [])

  return (
    <div className="fr" ref={rootRef} data-testid="formulas-page" data-searching={searching ? 'true' : 'false'} onClick={onAnchorClick}>
      {/*
        搜尋列：一列（搜尋框 + 段落目錄），黏在 topbar 下面，只占約 50px（原本 113px，疊上 52px 的 topbar 是 165px 常駐）。
        內容欄太窄放不下時，目錄自己換到第二列。「符合 n 項」放在搜尋框裡面右側；沒在搜尋時的操作說明（多個關鍵字、/、Esc）
        移到下面不黏的「試試」那一列，只留給螢幕閱讀器（aria-describedby）這裡的完整句子。
      */}
      <div className="fr-search" role="search" ref={searchRef}>
        <div className="fr-search-row">
          <label htmlFor="fr-search-input" className="fr-search-label">
            搜尋
          </label>
          <div className="fr-search-field">
            <input
              id="fr-search-input"
              ref={inputRef}
              type="search"
              className="fr-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && query) {
                  e.preventDefault()
                  setQuery('')
                }
              }}
              placeholder="符號、術語、TeX、公式 ID、勘誤編號"
              aria-label="搜尋符號、單位、公式、限制與術語"
              aria-describedby="fr-search-status"
              autoComplete="off"
              spellCheck={false}
            />
            <span id="fr-search-status" className={`fr-search-status${searching && total === 0 ? ' fr-count-zero' : ''}`} role="status" aria-live="polite" aria-busy={stale}>
              {searching
                ? total === 0
                  ? '沒有符合的項目'
                  : focusId
                    ? `已在公式登錄標示 ${focusId}`
                    : `符合 ${total} 項`
                : SEARCH_HELP}
            </span>
            {query && (
              <button type="button" className="btn fr-search-clear" onClick={clear} aria-label="清除搜尋">
                清除
              </button>
            )}
          </div>
          <nav className="fr-toc" aria-label="本頁段落">
            {SECTION_NAV.map((s) => {
              const n = s.key ? hit[s.key].length + (s.key === 'symbols' ? hit.collisions.length : 0) : null
              return (
                <button key={s.id} type="button" className={`fr-toc-btn${searching && n === 0 ? ' is-empty' : ''}`} onClick={() => scrollToId(s.id)} disabled={searching && s.key === null}>
                  {/* 序號放在自己的 span：視窗 901–1100px（側欄還在、內容欄只有 550–750px）時 CSS 把它藏起來，搜尋列才排得進一列 */}
                  <span className="fr-toc-num">{s.num}</span> {s.name}
                  {searching && n !== null && <span className="fr-toc-count">{n}</span>}
                </button>
              )
            })}
          </nav>
        </div>
      </div>
      {!query && (
        <div className="fr-examples">
          <span className="small muted">試試：</span>
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className="fr-chip" onClick={() => setQuery(ex)}>
              {ex}
            </button>
          ))}
          <span className="small muted fr-examples-help" aria-hidden="true">
            {SEARCH_HELP}
          </span>
        </div>
      )}

      {!searching && <IntroSection />}
      <SymbolsSection rows={hit.symbols} collisions={hit.collisions} searching={searching} />
      <UnitsSection topics={hit.units} searching={searching} />
      <QuickRefSection rows={hit.quick} searching={searching} />
      <RegistrySection rows={hit.formulas} searching={searching} focusId={focusId} />
      <LimitsSection rows={hit.limits} searching={searching} />
      <GlossarySection rows={hit.glossary} searching={searching} />
      {!searching && (
        <>
          <WrapupSection />
          <Gate min="research">
            <CoverageSection />
          </Gate>
          <PageSymbolsSection />
        </>
      )}
    </div>
  )
}
