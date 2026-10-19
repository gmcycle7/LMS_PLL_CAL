import { NavLink, useInRouterContext } from 'react-router-dom'
import type { ChapterFrameMeta } from '@/app/chapterMeta'
import type { PageEntry } from '@/app/registry'
import { MODES, MODE_SHORT, useSettings } from '@/app/settings'
import { AnchorLink } from './links'
import { TestBadge } from './TestBadge'

export interface ChapterInfoStripProps {
  entry: Pick<PageEntry, 'specSections' | 'tests'>
  meta: ChapterFrameMeta
  /** 本頁（目前模式）畫出來的手算題元素 id，DOM 順序（PageFrame 從 .c-handcalc[id] 掃出來）；第一個就是「連到第一題」的目標 */
  handcalcIds?: readonly string[]
  /** 本頁有章末符號表（#symbols）才顯示「符號表 ↓」 */
  hasSymbols?: boolean
}

/** 閱讀時間的顯示：60 分以上換成「h 小時 m 分」（各章實測多半是好幾個小時） */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} 分`
  return m === 0 ? `${h} 小時` : `${h} 小時 ${m} 分`
}

/** 勘誤連結：驗證頁的勘誤瀏覽器，深連結到本章第一條（?e=Exx） */
function ErrataLink({ eids }: { eids: readonly string[] }) {
  const inRouter = useInRouterContext()
  const to = `/verification?e=${eids[0]}`
  const title = `本章負責的勘誤：${eids.join('、')}（驗證頁的勘誤瀏覽器）`
  const text = `勘誤 ${eids.length} 項`
  return inRouter ? (
    <NavLink to={to} title={title} data-errata={eids.join(',')}>
      {text}
    </NavLink>
  ) : (
    <a href={`#${to}`} title={title} data-errata={eids.join(',')}>
      {text}
    </a>
  )
}

/**
 * 章首的「本章資訊」strip（docs/teaching-style.md §9）：一行（可換行）的小字，放在開場問題與系統地圖之後——
 * 規格書 §、驗證 T-id（原本在 h1 上方的 eyebrow）、三種模式的預估閱讀時間（目前模式加粗）、
 * 勘誤 N 項（連到驗證頁的勘誤瀏覽器）、手算 N 題（連到本頁第一題）、符號表（連到章末 #symbols）。
 * 資料：registry（specSections、tests）、src/app/chapterMeta.ts（readingMinutes、errata）與 PageFrame 掃 DOM 得到的手算題。
 */
export function ChapterInfoStrip({ entry, meta, handcalcIds = [], hasSymbols = false }: ChapterInfoStripProps) {
  const { mode } = useSettings()
  const spec = entry.specSections ?? []
  const tests = entry.tests ?? []
  return (
    <nav className="c-chinfo" aria-label="本章資訊">
      <ul className="c-chinfo-list">
        {spec.length > 0 && (
          <li className="c-chinfo-item" data-item="spec">
            <span className="c-chinfo-label">規格書</span>
            <span>§{spec.join('、§')}</span>
          </li>
        )}
        {tests.length > 0 && (
          <li className="c-chinfo-item" data-item="tests">
            <span className="c-chinfo-label">驗證</span>
            {tests.map((t) => (
              <TestBadge key={t} id={t} />
            ))}
          </li>
        )}
        <li className="c-chinfo-item" data-item="reading">
          <span className="c-chinfo-label">閱讀時間</span>
          <span className="c-chinfo-modes" title="依畫面上看得到的中文字數（350 字／分）、獨立公式（0.2 分）、圖（0.5 分）與互動實驗（3 分）估算，四捨五入到 5 分鐘；三種模式各量一次">
            {MODES.map((m) => (
              <span key={m} className={`c-chinfo-mode${m === mode ? ' is-current' : ''}`} data-mode={m} aria-current={m === mode ? 'true' : undefined}>
                {MODE_SHORT[m]} {formatMinutes(meta.readingMinutes[m])}
              </span>
            ))}
          </span>
        </li>
        {meta.errata.length > 0 && (
          <li className="c-chinfo-item" data-item="errata">
            <ErrataLink eids={meta.errata} />
          </li>
        )}
        {handcalcIds.length > 0 && (
          <li className="c-chinfo-item" data-item="handcalcs">
            <AnchorLink id={handcalcIds[0]} title="跳到本章第一題帶入手算">
              手算 {handcalcIds.length} 題
            </AnchorLink>
          </li>
        )}
        {hasSymbols && (
          <li className="c-chinfo-item" data-item="symbols">
            <AnchorLink id="symbols" title="本章符號表在章末">
              符號表 ↓
            </AnchorLink>
          </li>
        )}
      </ul>
    </nav>
  )
}
