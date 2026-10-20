import { Fragment, useEffect, useState } from 'react'
import { Callout, ClaimTag, getTestStatus, ModelLevel, ModeGate, Section, SourceTag, TestBadge, Tex, type TestStatus } from '@/components'
import statusFile from '@/data/verification-status.json'
import type { AcceptanceId } from '@/simulation/models/acceptance'
import { ErratumChip, M, PassMark, useAcceptance, type AcceptanceRowResult } from '../common'
import { GOLDEN } from '../golden'
import { fmtFull, fmtNum, fmtNumeric, pick, ratioTex, texNum, tolTex } from '../format'
import type { HeadlineKey } from '../data'
import { useSettings } from '@/app/settings'
import { lazyPart, NearGate } from '../lazy'

// acceptance.ts 的原始碼文字另成一個 lazy chunk（見 AcceptanceRegion.tsx）；首屏模組不能 import 它（lazyBoundary.test.ts 會檢查）
const AcceptanceRegion = lazyPart(() => import('./AcceptanceRegion'))

const STATUS_FILE = statusFile as { generatedAt?: string; commit?: string; note?: string }

function Headline({ h, value }: { h: HeadlineKey; value: unknown }) {
  const v = pick(value as never, h.index)
  return (
    <div className="nowrap">
      <Tex>{h.tex}</Tex>
      {' = '}
      <span className="ver-mono">{v === null ? '—' : Array.isArray(v) ? fmtNumeric(v, h.digits ?? 6) : fmtNum(v, h.digits ?? 6)}</span>
      {h.unit && (
        <>
          {' '}
          <Tex>{h.unit}</Tex>
        </>
      )}
    </div>
  )
}

/** 一個 T-id 的展開內容：每個 golden key 的比對、第二條獨立路徑、呼叫的模型與實際程式碼 */
function RowDetail({ row }: { row: AcceptanceRowResult }) {
  const { atLeast } = useSettings()
  const research = atLeast('research')
  const g = GOLDEN[row.meta.id]
  const digits = research ? 12 : 7
  return (
    <div className="ver-detail" data-testid={`detail-${row.meta.id}`}>
      <div className="c-tag-row" style={{ marginBottom: 6 }}>
        <ClaimTag kind={row.meta.claim} /> <ModelLevel level={row.meta.level} /> <SourceTag kind="simulation" />{' '}
        <span className="small muted">
          規格 {row.meta.specSection}｜golden 檔的說明（原文）：{g.description_zh}
        </span>
      </div>
      {row.meta.correctedNote && <p className="small">勘誤後補充：{M(row.meta.correctedNote)}</p>}
      {row.error && (
        <Callout kind="danger" title="計算失敗">
          {row.error}
        </Callout>
      )}
      {row.cmp && (
        <div className="table-wrap">
          <table className="ver-table">
            <caption className="small muted" style={{ textAlign: 'left', captionSide: 'top' }}>
              golden/vectors/{row.meta.id}.json 的每一個 expected key（共 {row.cmp.keys.length} 個；{row.cmp.passed} 個通過、{row.cmp.failed} 個不一致、{row.cmp.missing}{' '}
              個未計算）
            </caption>
            <thead>
              <tr>
                <th>key</th>
                <th>
                  Golden（Python）<Tex>{'e_k'}</Tex>
                </th>
                <th>
                  網站即時值（TS）<Tex>{'a_k'}</Tex>
                </th>
                <th>
                  最大 <Tex>{r`|\Delta|`}</Tex>
                </th>
                <th>容忍度</th>
                <th>
                  <Tex>{r`r=|\Delta|/b`}</Tex>
                </th>
                <th>判定</th>
              </tr>
            </thead>
            <tbody>
              {row.cmp.keys.map((k) => (
                <tr key={k.key}>
                  <td className="ver-mono">{k.key}</td>
                  <td className="ver-mono ver-mid">{fmtNumeric(k.expected, digits, research ? 24 : 6)}</td>
                  <td className="ver-mono ver-mid">{fmtNumeric(k.actual, digits, research ? 24 : 6)}</td>
                  <td className="num">{k.diff ? k.diff.maxAbsDiff === 0 ? '0' : <Tex>{texNum(k.diff.maxAbsDiff, 3)}</Tex> : '—'}</td>
                  <td className="small nowrap">
                    <Tex>{tolTex(k.tol)}</Tex>
                    {k.overridden ? '（覆寫）' : ''}
                  </td>
                  <td className="num">
                    <Tex>{ratioTex(k.diff?.worstRatio)}</Tex>
                  </td>
                  <td>
                    <PassMark pass={k.pass} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {row.comp && row.comp.checks.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="ver-table">
            <caption className="small muted" style={{ textAlign: 'left', captionSide: 'top' }}>
              第二條獨立計算路徑（不經過 golden 檔；標有「勘誤」的列同時是該勘誤的即時證據）
            </caption>
            <thead>
              <tr>
                <th>比對</th>
                <th>路徑 1</th>
                <th>路徑 2</th>
                <th>
                  <Tex>{r`|\Delta|`}</Tex>
                </th>
                <th>容許</th>
                <th>判定</th>
              </tr>
            </thead>
            <tbody>
              {row.comp.checks.map((c) => {
                const d = Math.abs(c.primary - c.secondary)
                return (
                  <tr key={c.label}>
                    <td className="ver-wide">
                      {M(c.label)}
                      <div className="small muted">{M(c.method)}</div>
                      {c.errata.length > 0 && (
                        <div className="ver-chips">
                          {c.errata.map((e) => (
                            <ErratumChip key={e} eid={e} />
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="num">{research ? fmtFull(c.primary) : fmtNum(c.primary, 9)}</td>
                    <td className="num">{research ? fmtFull(c.secondary) : fmtNum(c.secondary, 9)}</td>
                    <td className="num">{d === 0 ? '0' : <Tex>{texNum(d, 2)}</Tex>}</td>
                    <td className="num">{c.tol === 0 ? '完全相等' : <Tex>{texNum(c.tol, 2)}</Tex>}</td>
                    <td>
                      <PassMark pass={c.pass} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="small" style={{ marginTop: 8 }}>
        呼叫的章節模型：
        {row.comp?.calls.map((c) => (
          <code key={c} style={{ marginRight: 6 }}>
            {c}
          </code>
        ))}
        {row.comp?.ms !== undefined && <span className="muted">（本機計算 {fmtNum(row.comp.ms, 3)} ms）</span>}
      </p>
      {g.notes && <p className="small muted">Golden 註記（golden/vectors 原文）：{g.notes}</p>}
      <ModeGate min="engineer" summary="本列實際執行的程式碼（呼叫各章模型、整理成 golden 的 key）">
        <NearGate label="本列實際執行的程式碼" minHeight={240} kind="code">
          <AcceptanceRegion
            region={row.meta.id}
            title={`core:${row.meta.id}（本列實際執行的程式碼）`}
            caption="這段只負責呼叫各章模型並整理成 golden 的 key；公式本身在各章的模型檔裡（上方「呼叫的章節模型」）。"
          />
        </NearGate>
      </ModeGate>
    </div>
  )
}

const r = String.raw

function statusCounts(): Record<TestStatus, number> {
  const out: Record<TestStatus, number> = { pass: 0, partial: 0, fail: 0, missing: 0 }
  for (let i = 1; i <= 18; i++) out[getTestStatus(`T${String(i).padStart(2, '0')}`).status]++
  return out
}

/** §V.2 T01–T18 即時驗收表 */
export function AcceptanceTable({ focusId }: { focusId?: AcceptanceId | null }) {
  const st = useAcceptance()
  const [open, setOpen] = useState<Set<string>>(() => new Set(focusId ? [focusId] : []))
  useEffect(() => {
    if (focusId) setOpen((s) => (s.has(focusId) ? s : new Set([...s, focusId])))
  }, [focusId])
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const counts = statusCounts()
  const allOpen = open.size === st.rows.length

  return (
    <Section kind="explore" title="§V.2 T01–T18 即時驗收表" level={2} id="ver-table">
      <p>
        每一列：<strong>輸入條件</strong>與<strong>規格期望</strong>照抄規格 §17；<strong>修正後期望</strong>取自 docs/validation.md 的勘誤；
        <strong>即時計算</strong>是你的瀏覽器剛剛呼叫各章模型算出的；<strong>Golden</strong> 是 Python 產生的 JSON；<strong>即時判定</strong>逐一比對 golden 的<em>每一個</em>{' '}
        key（不只表上顯示的兩個），每個 key 都要 <Tex>{r`r_k=|a_k-e_k|/b_k\le1`}</Tex>；最後一欄是自動測試的狀態（由 <code>npm run verify</code> 寫入）。按「展開」看全部
        key、第二條獨立路徑與實際程式碼。
      </p>
      <div className="ver-summary" role="group" aria-label="即時驗收摘要">
        <div className="ver-kpi">
          <div className="ver-kpi-label">即時驗收（列）</div>
          <div className="ver-kpi-value" data-testid="rows-passed">
            {st.rowsPassed} / {st.rows.length}
          </div>
          <div className="ver-kpi-note">全部 key 都在容忍度內</div>
        </div>
        <div className="ver-kpi">
          <div className="ver-kpi-label">golden key</div>
          <div className="ver-kpi-value">
            {st.keysPassed} / {st.keysTotal}
          </div>
          <div className="ver-kpi-note">
            不一致 {st.keysFailed}、未計算 {st.keysMissing}
          </div>
        </div>
        <div className="ver-kpi">
          <div className="ver-kpi-label">第二條獨立路徑</div>
          <div className="ver-kpi-value">
            {st.checksPassed} / {st.checksTotal}
          </div>
          <div className="ver-kpi-note">封閉式 / 數值 / 時域交叉</div>
        </div>
        <div className="ver-kpi">
          <div className="ver-kpi-label">勘誤的數值證據</div>
          <div className="ver-kpi-value">
            {st.evidencePassed} / {st.evidence.length}
          </div>
          <div className="ver-kpi-note">validation.md 引用的數字即時重算（§V.6）</div>
        </div>
        <div className="ver-kpi">
          <div className="ver-kpi-label">瀏覽器計算時間</div>
          <div className="ver-kpi-value">{fmtNum(st.totalMs, 3)} ms</div>
          <div className="ver-kpi-note">18 項確定性計算（主執行緒）</div>
        </div>
        <div className="ver-kpi">
          <div className="ver-kpi-label">自動測試狀態</div>
          <div className="ver-kpi-value" style={{ fontSize: '1em' }}>
            pass {counts.pass}・partial {counts.partial}・fail {counts.fail}・pending {counts.missing}
          </div>
          <div className="ver-kpi-note">verification-status.json：{STATUS_FILE.generatedAt ?? '未知時間'}</div>
        </div>
      </div>
      {st.rowsPassed < st.rows.length && (
        <Callout kind="danger" title="有驗收項目不一致">
          {st.rows
            .filter((row) => row.cmp?.status !== 'pass')
            .map((row) => `${row.meta.id}（${row.cmp ? `${row.cmp.failed} 個 key 不一致、${row.cmp.missing} 個未計算` : row.error}）`)
            .join('；')}
          。這表示某章的模型或 golden vector 改變了；請展開該列看是哪個 key、差多少。
        </Callout>
      )}
      <Callout kind="info" title="兩種「通過」不一樣">
        「即時判定」是本頁剛剛在你的瀏覽器裡算的（同一套規則，但不經過測試框架）；「測試狀態」徽章來自 <code>src/data/verification-status.json</code>，只有在{' '}
        <code>npm run verify</code> 同時跑過 Vitest（<code>it(&apos;T05: …&apos;)</code>）與 pytest（<code>test_T05_…</code>）且兩邊都通過時才是 <strong>verified</strong>
        。狀態檔不會因為你打開網頁而更新——它的時間戳記是上面那個；若徽章顯示 partial 而即時判定全綠，代表「程式是對的，但狀態檔還沒重新產生」，需要重跑一次 verify。
      </Callout>
      <p>
        <button type="button" className="btn ver-btn-small" onClick={() => setOpen(allOpen ? new Set() : new Set(st.rows.map((row) => row.meta.id)))}>
          {allOpen ? '全部收合' : '全部展開'}
        </button>
      </p>
      <div className="table-wrap">
        <table className="ver-table" data-testid="acceptance-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>輸入條件</th>
              <th>規格期望（§17）</th>
              <th>修正後期望（勘誤）</th>
              <th>即時計算（TS）</th>
              <th>容忍度</th>
              <th>即時判定</th>
              <th>Golden（Python）</th>
              <th>測試狀態</th>
            </tr>
          </thead>
          <tbody>
            {st.rows.map((row) => {
              const id = row.meta.id
              const g = GOLDEN[id]
              const isOpen = open.has(id)
              const nOver = Object.keys(g.tolerance_overrides ?? {}).length
              return (
                <Fragment key={id}>
                  <tr className={focusId === id ? 'ver-row-target' : undefined} data-row={id}>
                    <td>
                      <div className="ver-tid" id={id}>
                        {id}
                      </div>
                      <div className="small muted">{M(row.meta.title)}</div>
                      <button type="button" className="btn ver-btn-small" aria-expanded={isOpen} aria-label={`${isOpen ? '收合' : '展開'} ${id}`} onClick={() => toggle(id)} style={{ marginTop: 4 }}>
                        {isOpen ? '收合' : '展開'}
                      </button>
                    </td>
                    <td className="ver-wide">
                      <Tex>{row.meta.inputTex}</Tex>
                      <div className="small muted">{row.meta.specSection}</div>
                    </td>
                    <td className="ver-mid">
                      <Tex>{row.meta.specTex}</Tex>
                    </td>
                    <td className="ver-wide">
                      {row.meta.correctedTex ? <Tex>{row.meta.correctedTex}</Tex> : <span className="muted">與規格相同</span>}
                      {row.meta.errata.length > 0 && (
                        <div className="ver-chips">
                          {row.meta.errata.map((e) => (
                            <ErratumChip key={e} eid={e} />
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="ver-mid">
                      {row.comp ? row.meta.headline.map((h) => <Headline key={`${h.key}-${h.index ?? ''}`} h={h} value={row.comp!.values[h.key]} />) : <span className="ver-fail">計算失敗</span>}
                    </td>
                    <td className="small nowrap">
                      <Tex>{tolTex(g.tolerance)}</Tex>
                      {nOver > 0 && <div className="muted">（{nOver} 個 key 覆寫）</div>}
                    </td>
                    <td>
                      <PassMark pass={row.cmp ? (row.cmp.status === 'pass' ? true : row.cmp.failed > 0 ? false : null) : false} label={row.cmp ? `${row.cmp.passed}/${row.cmp.keys.length} key` : '錯誤'} />
                    </td>
                    <td className="ver-mid">
                      {row.meta.headline.map((h) => (
                        <Headline key={`${h.key}-${h.index ?? ''}`} h={h} value={g.expected[h.key]} />
                      ))}
                    </td>
                    <td>
                      <TestBadge id={id} />
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="ver-detail-row">
                      <td colSpan={9}>
                        <RowDetail row={row} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        連結到某一列：<code>#/verification?t=T05</code>（會自動展開並捲動到該列）。對應的章節頁面：
        {st.rows.map((row) => (
          <Fragment key={row.meta.id}>
            {' '}
            <a href={`#${row.meta.chapters[0].path}`}>
              {row.meta.id}→{row.meta.chapters[0].label}
            </a>
          </Fragment>
        ))}
      </p>
    </Section>
  )
}
