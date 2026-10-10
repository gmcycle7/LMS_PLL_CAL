import { useMemo } from 'react'
import { Callout, ModelLevel, TestBadge } from '@/components'
import type { ModelLevelId } from '@/data/types'
import { ALL_PRESETS } from '@/app/presets'
import { PAGES } from '@/app/registry'
import { countBy, EXPERIMENT_META, levelsOf, pageOrder, PREVIEWABLE_EXPERIMENTS, T_SPEC, testCoverage } from '../data'
import { ErrataList, pageNav, Rich } from '../common'

const LEVELS: ModelLevelId[] = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6']

/** 表格內的頁面簡稱：章節寫 Ch05，其他頁面用側欄名稱 */
function shortPage(path: string): string {
  const m = /^\/ch\/(\d{2})$/.exec(path)
  return m ? `Ch${m[1]}` : pageNav(path).nav
}

/** 規格 §17 的 18 個 T-id 各有幾個 preset 可以「一鍵重現」，以及資料健康檢查 */
export function Coverage() {
  const rows = useMemo(() => testCoverage(ALL_PRESETS), [])
  const paths = useMemo(() => PAGES.map((p) => p.path), [])
  const byLevel = useMemo(() => countBy(ALL_PRESETS, (p) => levelsOf(p).levels), [])
  const bySource = useMemo(() => countBy(ALL_PRESETS, (p) => p.source), [])
  const byPage = useMemo(() => [...countBy(ALL_PRESETS, (p) => p.page).entries()].sort((a, b) => pageOrder(a[0], paths) - pageOrder(b[0], paths)), [paths])
  const previewable = ALL_PRESETS.filter((p) => PREVIEWABLE_EXPERIMENTS.includes(p.experiment)).length
  const unregistered = ALL_PRESETS.filter((p) => !paths.includes(p.page))
  const unknownExp = [...new Set(ALL_PRESETS.filter((p) => !EXPERIMENT_META[p.experiment]).map((p) => p.experiment))]
  const noPreset = rows.filter((r) => r.presets === 0)
  const maxPage = Math.max(1, ...byPage.map(([, n]) => n))
  return (
    <>
      <p>
        共 <strong>{ALL_PRESETS.length}</strong> 個 preset、{new Set(ALL_PRESETS.map((p) => p.experiment)).size} 個實驗、{byPage.length} 個頁面；其中{' '}
        <strong>{previewable}</strong> 個可以在 Gallery 內用真實模型函式即時預覽。
      </p>
      {noPreset.length > 0 && (
        <Callout kind="warn" title="沒有 preset 的 T-id">
          {noPreset.map((r) => r.id).join('、')} 目前沒有任何 preset 帶這個編號：數值仍由單元測試驗證（徽章），但讀者無法從 Gallery 一鍵重現。
        </Callout>
      )}
      <div className="table-wrap">
        <table className="gal-cov-table">
          <thead>
            <tr>
              <th>T-id</th>
              <th>規格 §17 的條件</th>
              <th>期望值（已依勘誤）</th>
              <th className="num">preset 數</th>
              <th className="num">其中 §19.2</th>
              <th>頁面</th>
              <th>測試狀態</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-tid={r.id} data-count={r.presets}>
                <td className="nowrap">
                  <strong>{r.id}</strong>
                </td>
                <td>
                  <Rich text={T_SPEC[r.id].input} />
                </td>
                <td>
                  <Rich text={T_SPEC[r.id].expect} /> <ErrataList ids={T_SPEC[r.id].errata ?? []} />
                </td>
                <td className="num">{r.presets}</td>
                <td className="num">{r.gallery}</td>
                <td className="small">{r.pages.map(shortPage).join('、') || '—'}</td>
                <td>
                  <TestBadge id={r.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid-2 gal-stats">
        <div>
          <h4>依模型層級</h4>
          <ul className="gal-bars">
            {LEVELS.map((l) => (
              <li key={l}>
                <ModelLevel level={l} />
                <span className="gal-bar" style={{ width: `${(100 * (byLevel.get(l) ?? 0)) / ALL_PRESETS.length}%` }} aria-hidden="true" />
                <span className="small">{byLevel.get(l) ?? 0}</span>
              </li>
            ))}
          </ul>
          <p className="small muted">層級隨參數改變的實驗（例如 Bias Lab 的 DC null）依 preset 參數判斷；判斷不了的列出全部可能值，所以總數可能大於 preset 數。</p>
          <h4>依來源</h4>
          <ul className="small">
            {[...bySource.entries()].map(([k, n]) => (
              <li key={k}>
                {k}：{n}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4>依頁面</h4>
          <ul className="gal-bars">
            {byPage.map(([page, n]) => (
              <li key={page}>
                <span className="gal-bar-label small">{pageNav(page).nav}</span>
                <span className="gal-bar" style={{ width: `${(60 * n) / maxPage}%` }} aria-hidden="true" />
                <span className="small">{n}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <h4>資料健康檢查</h4>
      <ul className="small">
        <li>
          頁面不在網站目錄的 preset：
          {unregistered.length ? <span className="gal-bad">{unregistered.map((p) => `${p.id}（${p.page}）`).join('、')}</span> : '無'}
        </li>
        <li>Gallery 未登錄層級的實驗：{unknownExp.length ? unknownExp.join('、') : '無'}（未登錄的實驗不猜層級，只顯示「層級未登錄」）</li>
      </ul>
    </>
  )
}
