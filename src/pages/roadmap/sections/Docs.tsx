import { Callout, getTestStatus } from '@/components'
import { PAGES } from '@/app/registry'
import { ALL_PRESETS } from '@/app/presets'
import errataData from '@/data/errata.json'
import { ALL_T_IDS, DOCS, DOD, ITEMS, VALIDATION_DOC } from '../data'
import { ErratumTag, PageRef, Rich } from '../common'

interface ErratumLite {
  eid: string
  severity: 'high' | 'medium' | 'low'
  area: string
}

/** errata.json 的統計（由資料計算，不手寫數字）。 */
export function errataSummary(list: ErratumLite[] = (errataData as { errata: ErratumLite[] }).errata) {
  const bySeverity = { high: 0, medium: 0, low: 0 }
  const byArea = new Map<string, number>()
  for (const e of list) {
    bySeverity[e.severity]++
    byArea.set(e.area, (byArea.get(e.area) ?? 0) + 1)
  }
  return { total: list.length, bySeverity, byArea: [...byArea.entries()].sort((a, b) => b[1] - a[1]), high: list.filter((e) => e.severity === 'high').map((e) => e.eid) }
}

/** 本頁研究項目引用的勘誤（去重、排序） */
export function roadmapErrata(): string[] {
  return [...new Set(ITEMS.flatMap((i) => i.errata))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
}

/** DoD 的可計算部分 */
export function dodComputed() {
  const chapters = PAGES.filter((p) => /^ch(0[1-9]|1[0-4])$/.test(p.id)).length
  const tPass = ALL_T_IDS.filter((t) => getTestStatus(t).status === 'pass').length
  const galleryIdx = new Set(ALL_PRESETS.map((p) => p.galleryIndex).filter((g): g is number => typeof g === 'number' && g >= 1 && g <= 12))
  return { chapters, tPass, presets: ALL_PRESETS.length, gallery: galleryIdx.size }
}

export function Docs() {
  const e = errataSummary()
  const used = roadmapErrata()
  const d = dodComputed()
  const dodValue: Record<number, string> = {
    2: `registry 中有 ${d.chapters} / 14 個主章節頁（ch01–ch14），另有入門 ch00；內容完整度需人工審查`,
    5: `${d.tPass} / 18 個 T-id 兩邊皆通過（其餘 partial / pending，見驗證頁）`,
    6: `已登錄 ${d.presets} 個 presets；規格 §19.2 的 Gallery 編號 1–12 中已有 ${d.gallery} 個；可載入 / 下載需人工確認`,
  }
  return (
    <>
      <h3>規格勘誤（docs/validation.md）</h3>
      <p>
        規格書經過逐項重算（共 {VALIDATION_DOC.checks} 項聲明），確認 <strong>{e.total}</strong> 項勘誤：high {e.bySeverity.high}、medium {e.bySeverity.medium}、low {e.bySeverity.low}；另有 {VALIDATION_DOC.refuted} 項疑點經反駁後不列為勘誤。網站一律採用修正後的版本，並在對應位置標示「勘誤 Exx」，點擊即到 <PageRef id="verification" />（依編號列出完整的問題、修正與數值證據）。
      </p>
      <p className="small">
        high：
        {e.high.map((id) => (
          <ErratumTag key={id} eid={id} />
        ))}
        {' · '}本頁研究項目引用的勘誤（{used.length} 項）：
        {used.map((id) => (
          <ErratumTag key={id} eid={id} />
        ))}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>領域</th>
              <th>勘誤數</th>
            </tr>
          </thead>
          <tbody>
            {e.byArea.map(([area, n]) => (
              <tr key={area}>
                <td>{area}</td>
                <td>{n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>文件</h3>
      <p className="small muted">文件位於專案原始碼中（靜態網站不會發佈 docs/ 目錄）；有站內對應頁面者附連結。</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>路徑</th>
              <th>內容</th>
              <th>站內對應</th>
            </tr>
          </thead>
          <tbody>
            {DOCS.map((doc) => (
              <tr key={doc.path}>
                <td>
                  <code>{doc.path}</code>
                  <div className="small">{doc.title}</div>
                </td>
                <td>
                  <Rich text={doc.purpose} />
                </td>
                <td>{doc.page ? <PageRef id={doc.page} /> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Definition of Done（規格 §20.5）</h3>
      <Callout kind="info" title="本表只陳述可計算的事實">
        「需人工確認」代表本頁無法從資料判斷，必須在瀏覽器（桌面與 375 px 手機、深淺主題）中檢查；它不是「已完成」。
      </Callout>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>要求</th>
              <th>目前可計算的狀態</th>
              <th>相關頁面</th>
            </tr>
          </thead>
          <tbody>
            {DOD.map((item) => (
              <tr key={item.n} data-dod={item.n}>
                <td>{item.n}</td>
                <td>{item.text}</td>
                <td>{dodValue[item.n] ?? '需人工確認'}</td>
                <td>
                  {(item.where ?? []).map((id, i) => (
                    <span key={id}>
                      {i > 0 && '、'}
                      <PageRef id={id} />
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
