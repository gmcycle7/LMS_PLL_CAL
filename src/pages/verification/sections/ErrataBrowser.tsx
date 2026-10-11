import { useEffect, useMemo, useState } from 'react'
import { Callout, ClaimTag, CodeBlock, ModeGate, Section, SourceTag, Tex, TexBlock } from '@/components'
import { useSettings } from '@/app/settings'
import acceptanceSrc from '@/simulation/models/acceptance.ts?raw'
import validationMd from '../../../../docs/validation.md?raw'
import {
  chapterHref,
  chapterLabel,
  countBySeverity,
  DEFAULT_FILTER,
  distinctAreas,
  distinctChapters,
  ERRATA,
  ERRATA_META,
  erratumHref,
  filterErrata,
  mentionedTests,
  parseRefuted,
  parseValidationStats,
  passesFilter,
  SEVERITIES,
  SEVERITY_LABEL,
  testRowHref,
  type Erratum,
  type ErrataFilter,
  type Severity,
} from '../errata'
import { ERRATA_MATH } from '../errataMath'
import { testsForErratum } from '../data'
import { Diagram, FBlock, M, PassMark, useAcceptance, type ErratumLiveCheck } from '../common'
import { CHART_ERRATA_FLOW } from '../diagrams'
import type { ErratumEvidence } from '@/simulation/models/acceptance'
import { texNum } from '../format'

/** 勘誤 → 相關驗收 T-id：驗收表的對照 ∪ 勘誤內文提到的 T-id */
export function relatedTests(e: Erratum): string[] {
  return [...new Set([...testsForErratum(e.eid), ...mentionedTests(e)])].sort()
}

const REFUTED = parseRefuted(validationMd)
const STATS = parseValidationStats(validationMd)
const r = String.raw

function CopyLink({ eid }: { eid: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    try {
      const url = `${window.location.origin}${window.location.pathname}${erratumHref(eid)}`
      void navigator.clipboard
        ?.writeText(url)
        .then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
        .catch(() => undefined)
    } catch {
      /* 沒有 clipboard（例如非 https）：忽略 */
    }
  }
  return (
    <button type="button" className="btn ver-btn-small" onClick={copy} aria-label={`複製勘誤 ${eid} 的連結`}>
      {copied ? '已複製' : '複製連結'}
    </button>
  )
}

/** 即時值的顯示：比引用多兩位小數，方便看出四捨五入後是否一致 */
function liveDigits(e: ErratumEvidence): string {
  const d = Math.max(0, e.refText.includes('.') ? e.refText.split('.')[1].length : 0)
  if (Number.isInteger(e.value) && d === 0) return String(e.value)
  return e.value.toFixed(Math.min(d + 2, 17))
}

function LiveEvidence({ items, checks }: { items: ErratumEvidence[]; checks: ErratumLiveCheck[] }) {
  if (items.length === 0 && checks.length === 0) return null
  return (
    <div className="ver-live" data-testid="erratum-live">
      <div className="ver-live-title">
        本頁即時重算的證據 <SourceTag kind="simulation" />
      </div>
      {items.length > 0 && (
        <div className="table-wrap">
          <table className="ver-table">
            <thead>
              <tr>
                <th>量</th>
                <th>網站即時值</th>
                <th>文件引用</th>
                <th>
                  <Tex>{r`|\Delta|`}</Tex>
                </th>
                <th>判定</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={`${e.label}-${e.refText}`}>
                  <td className="ver-wide">
                    {M(e.label)}
                    <div className="small muted">
                      <code>{e.call}</code>
                    </div>
                  </td>
                  <td className="num">{liveDigits(e)}</td>
                  <td className="num">{e.refText}</td>
                  <td className="num">{e.value === e.reference ? '0' : <Tex>{texNum(Math.abs(e.value - e.reference), 2)}</Tex>}</td>
                  <td>
                    <PassMark pass={e.pass} label={e.pass ? '一致' : undefined} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {checks.length > 0 && (
        <ul className="small ver-live-checks">
          {checks.map(({ tid, check }) => (
            <li key={`${tid}-${check.label}`}>
              <a className="ver-chip" href={testRowHref(tid)} title={`跳到驗收表 ${tid}`}>
                {tid}
              </a>{' '}
              {M(check.label)} <PassMark pass={check.pass} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ErratumCard({ e, target, evidence, checks }: { e: Erratum; target: boolean; evidence: ErratumEvidence[]; checks: ErratumLiveCheck[] }) {
  const { atLeast } = useSettings()
  const tests = relatedTests(e)
  const math = ERRATA_MATH[e.eid]
  return (
    <article id={e.eid} className={`ver-erratum sev-${e.severity}${target ? ' ver-target' : ''}`} tabIndex={-1} aria-label={`勘誤 ${e.eid}`} data-testid={`erratum-${e.eid}`}>
      <div className="ver-erratum-head">
        <a className="ver-erratum-id" href={erratumHref(e.eid)}>
          {e.eid}
        </a>
        <span className={`ver-chip ver-chip-${e.severity}`}>{SEVERITY_LABEL[e.severity]}</span>
        <span className="small">{e.area}</span>
        <span className="ver-erratum-key">{e.id}</span>
        <CopyLink eid={e.eid} />
      </div>
      <div className="ver-chips">
        {e.chapters.map((c) => {
          const href = chapterHref(c)
          return href ? (
            <a key={c} className="ver-chip" href={href}>
              {chapterLabel(c)}
            </a>
          ) : (
            <span key={c} className="ver-chip">
              {chapterLabel(c)}
            </span>
          )
        })}
        {tests.map((t) => (
          <a key={t} className="ver-chip" href={testRowHref(t)} title={`跳到驗收表 ${t}`}>
            {t}
          </a>
        ))}
      </div>
      {math && (
        <div className="ver-em" data-testid="erratum-math">
          <p className="ver-em-gist">{M(math.gist)}</p>
          <div className="ver-em-grid">
            {math.spec && (
              <div className="ver-em-cell ver-em-spec">
                <div className="ver-em-label">規格原文</div>
                <TexBlock>{math.spec}</TexBlock>
              </div>
            )}
            <div className="ver-em-cell ver-em-fix">
              <div className="ver-em-label">網站採用的修正</div>
              <TexBlock>{math.fix}</TexBlock>
            </div>
          </div>
        </div>
      )}
      <LiveEvidence items={evidence} checks={checks} />
      <details open={target || atLeast('engineer')} key={`t-${target}-${atLeast('engineer')}`}>
        <summary>docs/validation.md 原文（位置／問題／修正）</summary>
        <dl>
          <dt>位置</dt>
          <dd>{M(e.location)}</dd>
          <dt>問題</dt>
          <dd>{M(e.problem)}</dd>
          <dt>修正</dt>
          <dd>{M(e.correction)}</dd>
        </dl>
      </details>
      <details open={target || atLeast('research')} key={`e-${target}-${atLeast('research')}`}>
        <summary>數值證據（原文）</summary>
        <p className="small" style={{ overflowWrap: 'anywhere' }}>
          {e.evidence}
        </p>
      </details>
    </article>
  )
}

/** §V.6 勘誤瀏覽器（src/data/errata.json） */
export function ErrataBrowser({ focusEid }: { focusEid: string | null }) {
  const st = useAcceptance()
  const [filter, setFilter] = useState<ErrataFilter>(DEFAULT_FILTER)
  const areas = useMemo(() => distinctAreas(ERRATA), [])
  const chapters = useMemo(() => distinctChapters(ERRATA), [])
  const counts = useMemo(() => countBySeverity(ERRATA), [])
  const hasLive = useMemo(() => {
    const set = new Set([...Object.keys(st.evidenceByEid), ...Object.keys(st.checksByEid)])
    return (eid: string) => set.has(eid)
  }, [st])
  const nLive = ERRATA.filter((e) => hasLive(e.eid)).length
  // 深連結的勘誤若被目前的篩選擋住，先清除篩選，確保它一定看得到。
  // 只在「連結目標改變」時做一次：之後使用者自己調整篩選（即使把目標濾掉）不可再被這個 effect 蓋回去。
  useEffect(() => {
    const e = ERRATA.find((x) => x.eid === focusEid)
    if (e) setFilter((f) => (passesFilter(e, f, relatedTests, hasLive) ? f : DEFAULT_FILTER))
  }, [focusEid, hasLive])
  const shown = useMemo(() => filterErrata(ERRATA, filter, relatedTests, hasLive), [filter, hasLive])
  const set = <K extends keyof ErrataFilter>(k: K, v: ErrataFilter[K]) => setFilter((f) => ({ ...f, [k]: v }))
  const unknown = focusEid && !ERRATA.some((x) => x.eid === focusEid)
  const evFailed = st.evidence.filter((e) => !e.pass)

  return (
    <Section kind="assumptions" title="§V.6 勘誤瀏覽器：規格書哪裡錯了、網站怎麼改" level={2} id="ver-errata">
      <p>
        規格書是本網站的藍圖，但它也會錯。docs/validation.md 用{STATS.auditors !== null ? ` ${STATS.auditors} 個` : '多個'}稽核 agent 以 Python 重算規格的
        {STATS.claims !== null ? ` ${STATS.claims} 項` : '每一項'}公式、數值與穩定性聲明，再由獨立的懷疑者 agent 嘗試反駁；反駁失敗的{' '}
        <strong>{ERRATA.length} 項</strong>列為勘誤（high {counts.high}、medium {counts.medium}、low {counts.low}），另有 {REFUTED.length} 項被反駁而不列入。網站
        <strong>一律採用修正後的版本</strong>；各章出現「勘誤 Exx」標記的地方都連到這裡。
      </p>
      <Diagram
        chart={CHART_ERRATA_FLOW}
        caption="一項聲明怎麼變成勘誤卡片：稽核者重算、懷疑者反駁，反駁失敗才列入；網站再用它修正各章，部分勘誤另有瀏覽器即時重算的證據。"
        ariaLabel="勘誤的流程：規格書的聲明由稽核 agent 用 Python 重算；一致就不需要勘誤；不一致再交給獨立的懷疑者反駁，反駁成功不列為勘誤，反駁失敗才成為勘誤，寫進 errata.json，網站採用修正後版本並顯示勘誤卡片"
      >
        <p>
          <strong>先看</strong>
          上半的兩個菱形：稽核 agent 的 Python 重算結果和規格書<strong>不一致</strong>，還要再過一關——獨立的懷疑者嘗試反駁；反駁成功的意見放進「被反駁」清單（本節最後），<strong>反駁失敗</strong>
          才成為藍色的勘誤 Exx。<strong>再看</strong>
          下半：勘誤寫進 <code>errata.json</code> 之後分兩條路——網站各章一律採用修正後的版本，並放上連到本頁的「勘誤 Exx」標記；另外，有數字可以重算的勘誤，由{' '}
          <code>computeErrataEvidence()</code> 在你的瀏覽器裡重算文件引用的數字。兩條路在本頁的勘誤卡片會合。
        </p>
      </Diagram>
      <p>每張卡片由上而下：</p>
      <ol>
        <li>
          <strong>數學重點（KaTeX）</strong>：一句話摘要，加上「規格原文 → 網站採用的修正」兩條公式。這是本站把原文的核心整理成 LaTeX 的版本；式中的數字取自原文。
        </li>
        <li>
          <strong>本頁即時重算的證據</strong>：{Object.keys(st.evidenceByEid).length} 項勘誤共 {st.evidence.length} 個數字由瀏覽器呼叫章節模型重算，和文件引用的數字比到「引用時寫到的小數位數」；目前{' '}
          <strong>
            {st.evidencePassed} / {st.evidence.length}
          </strong>{' '}
          個一致。另外列出驗收表（§V.2）中標註了該勘誤的獨立比對。合計 {nLive} / {ERRATA.length} 項勘誤有即時內容；其餘 {ERRATA.length - nLive}{' '}
          項是文字、記號或需要長時間 Monte Carlo 的勘誤，本頁只引用原文，不宣稱已重算。
        </li>
        <li>
          <strong>docs/validation.md 原文</strong>：位置、問題、修正與數值證據（原文以純文字書寫公式，這裡原樣引用）。
        </li>
      </ol>
      <FBlock id="F-VF.13" />
      <p className="small">
        例：文件寫 <Tex>{r`P(S_{100}>0)=0.492050`}</Tex>（6 位小數），網站算出的值必須落在 <Tex>{r`0.492050\pm0.51\times10^{-6}`}</Tex> 內。容許誤差不是我們挑的，而是由文件自己的精度決定——
        這樣「證據」才有檢定力：把引用的最後一位改掉，比對就會失敗（<code>acceptance.test.ts</code> 有這個反面測試）。 <ClaimTag kind="exact" />
      </p>
      <ModeGate min="engineer">
        <CodeBlock
          source={acceptanceSrc}
          region="parseQuotedNumber"
          path="src/simulation/models/acceptance.ts"
          title="core:parseQuotedNumber（引用精度規則；F-VF.13）"
          caption="每一項證據的 refText 都必須逐字出現在 errata.json 該勘誤的文字裡（測試會檢查），所以參考值不是另外手寫的。"
        />
      </ModeGate>
      {st.evidenceError && (
        <Callout kind="danger" title="勘誤證據計算失敗">
          {st.evidenceError}（某個章節模型丟出例外；其餘內容不受影響）
        </Callout>
      )}
      {evFailed.length > 0 && (
        <Callout kind="danger" title={`${evFailed.length} 個勘誤證據與文件引用不一致`}>
          {evFailed.map((e) => `${e.eid}（引用 ${e.refText}）`).join('、')}。這表示章節模型或 errata.json 改變了；請展開該勘誤查看差距。
        </Callout>
      )}
      <p className="small muted">
        資料來源：<code>src/data/errata.json</code>（{ERRATA_META.date}；{ERRATA_META.generatedFrom}）。可直接連結某一項：<code>#/verification?e=E05</code>。
      </p>
      {unknown && (
        <Callout kind="warn" title={`找不到勘誤 ${focusEid}`}>
          連結指定的勘誤編號不存在；目前共有 E01–E{String(ERRATA.length).padStart(2, '0')}。
        </Callout>
      )}
      <div className="ver-filters" role="search" aria-label="勘誤篩選">
        <label>
          嚴重度
          <select value={filter.severity} onChange={(ev) => set('severity', ev.target.value as Severity | 'all')}>
            <option value="all">全部（{ERRATA.length}）</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {SEVERITY_LABEL[s]}（{counts[s]}）
              </option>
            ))}
          </select>
        </label>
        <label>
          範圍
          <select value={filter.area} onChange={(ev) => set('area', ev.target.value)}>
            <option value="all">全部範圍</option>
            {areas.map((a) => (
              <option key={a} value={a}>
                {a}（{ERRATA.filter((e) => e.area === a).length}）
              </option>
            ))}
          </select>
        </label>
        <label>
          章節
          <select value={filter.chapter} onChange={(ev) => set('chapter', ev.target.value)}>
            <option value="all-chapters">全部章節</option>
            {chapters.map((c) => (
              <option key={c} value={c}>
                {c === 'all' ? '全文（符號／單位一致性）' : chapterLabel(c)}（{ERRATA.filter((e) => e.chapters.includes(c)).length}）
              </option>
            ))}
          </select>
        </label>
        <label>
          搜尋
          <input type="search" value={filter.query} placeholder="例如 K_q、tie、ENBW、1.34" onChange={(ev) => set('query', ev.target.value)} />
        </label>
        <label className="ver-check">
          <input type="checkbox" checked={filter.onlyAcceptance} onChange={(ev) => set('onlyAcceptance', ev.target.checked)} />
          只看與 T01–T18 相關
        </label>
        <label className="ver-check">
          <input type="checkbox" checked={filter.onlyLive} onChange={(ev) => set('onlyLive', ev.target.checked)} />
          只看有即時重算證據（{nLive}）
        </label>
        <div>
          <button type="button" className="btn ver-btn-small" onClick={() => setFilter(DEFAULT_FILTER)}>
            清除篩選
          </button>
        </div>
      </div>
      <p className="small" aria-live="polite" data-testid="errata-count">
        顯示 {shown.length} / {ERRATA.length} 項
      </p>
      {shown.length === 0 && <p className="muted">沒有符合條件的勘誤。</p>}
      <div className="ver-errata-list">
        {shown.map((e) => (
          <ErratumCard key={e.eid} e={e} target={e.eid === focusEid} evidence={st.evidenceByEid[e.eid] ?? []} checks={st.checksByEid[e.eid] ?? []} />
        ))}
      </div>
      <ModeGate min="research">
        <h3 id="ver-refuted">被反駁的 {REFUTED.length} 項稽核意見（不列為勘誤）</h3>
        <p className="small">
          稽核者提出、但獨立的懷疑者重新推導後認為「規格在指定條件下並沒有錯」的意見。列在這裡是為了透明：它們多半是記號整潔度的建議，或規格其實已經在別處說明。以下文字是
          docs/validation.md 的原文（來源檔的理由欄在約 500 字處截斷，部分為英文）。
        </p>
        <div className="table-wrap">
          <table className="ver-table" data-testid="refuted-table">
            <thead>
              <tr>
                <th>id</th>
                <th>範圍</th>
                <th>規格中的位置（原文）</th>
              </tr>
            </thead>
            <tbody>
              {REFUTED.map((x) => (
                <tr key={x.id}>
                  <td className="ver-mono">{x.id}</td>
                  <td className="ver-mid">{x.area}</td>
                  <td className="ver-wide">
                    {x.location}
                    <details>
                      <summary className="small muted">反駁理由（原文）</summary>
                      <p className="small" style={{ overflowWrap: 'anywhere' }}>
                        {x.reason}
                      </p>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ModeGate>
      <p className="small muted" style={{ marginTop: 12 }}>
        讀法提示：完整的逐步推導在各章（例如 E02 的 tie 規則在 <a href="#/ch/05">Ch05</a>、E14 的三種穩定界限 <Tex>{r`\mu<\tfrac23,\ 2,\ 2.4212`}</Tex> 在 <a href="#/ch/03">Ch03</a>、E06 的 ENBW 在{' '}
        <a href="#/ch/12">Ch12</a>）；本頁只列出每項勘誤的重點與證據。
      </p>
    </Section>
  )
}
