import { memo, useCallback, useId, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { APP_VERSION, Callout, ClaimTag, GIT_COMMIT, Section, TexBlock, downloadText, fileTimestamp, prettyJson, usePersistentState } from '@/components'
import { BadgeRow } from '@/components/Tags'
import { ALL_CASES, type SignoffCase, type SignoffCheck } from '../data'
import {
  FILTER_KEY,
  REVIEW_STATUSES,
  STATUS_LABEL,
  STORAGE_KEY,
  buildJson,
  buildMarkdown,
  emptyReview,
  getItem,
  isClosed,
  isReviewState,
  needsNote,
  parseReviewJson,
  setItem,
  setMeta,
  summarize,
  type CheckReview,
  type ReviewState,
  type ReviewStatus,
} from '../review'
import { ErratumTag, RichText, SiteLink, scrollToAnchor } from '../shared'

export type MatrixFilter = 'all' | 'open' | 'fail' | 'waived' | 'missing-note'

const FILTER_LABEL: Record<MatrixFilter, string> = {
  all: '全部',
  open: '尚未關閉',
  fail: '只看未通過',
  waived: '只看豁免',
  'missing-note': '缺理由',
}

function isFilter(v: unknown): v is MatrixFilter {
  return typeof v === 'string' && v in FILTER_LABEL
}

function visible(filter: MatrixFilter, it: CheckReview): boolean {
  switch (filter) {
    case 'open':
      return !isClosed(it.status)
    case 'fail':
      return it.status === 'fail'
    case 'waived':
      return it.status === 'waived'
    case 'missing-note':
      return needsNote(it)
    default:
      return true
  }
}

type OnItemChange = (id: string, patch: Partial<CheckReview>) => void

/** 狀態卡左上角的圖示（純裝飾；狀態文字在 <select> 與 aria-label 裡） */
const STATUS_ICON: Record<ReviewStatus, string> = { 'not-started': '○', 'in-progress': '◐', pass: '✓', fail: '✗', waived: 'W' }

/**
 * 一個判準一張「有狀態的卡片」：左色條與圖示跟著狀態走（通過＝綠、未通過＝紅、豁免＝琥珀、進行中＝藍、未填＝灰虛線），
 * 不再只靠 <select> 的 1px 邊框。狀態仍由同一個 <select> 改（原生鍵盤操作：Tab 進去、↑↓ 換狀態），存 localStorage lmspll.signoff.*。
 */
const CheckRow = memo(function CheckRow({ check, item, onItemChange }: { check: SignoffCheck; item: CheckReview; onItemChange: OnItemChange }) {
  const id = useId()
  const missing = needsNote(item)
  const onChange = (patch: Partial<CheckReview>) => onItemChange(check.id, patch)
  return (
    <div className={`so-check so-check--${item.status}`} data-check={check.id} data-status={item.status} role="group" aria-labelledby={`${id}-t`}>
      <div className="so-check-head">
        <span className="so-check-mark" aria-hidden="true">
          {STATUS_ICON[item.status]}
        </span>
        <div className="so-check-title" id={`${id}-t`}>
          <RichText text={check.title} />
        </div>
        <ClaimTag kind={check.claim} />
        <select
          className="so-status"
          data-status={item.status}
          aria-label={`狀態：${check.id}`}
          value={item.status}
          onChange={(e) => onChange({ status: e.target.value as ReviewStatus })}
        >
          {REVIEW_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      <dl className="so-check-grid">
        <dt>必須驗證</dt>
        <dd>
          <RichText text={check.verify} />
        </dd>
        <dt>判斷方式</dt>
        <dd>
          <RichText text={check.judge} />
        </dd>
        {check.criterion && (
          <>
            <dt>判準</dt>
            <dd>
              <TexBlock>{check.criterion}</TexBlock>
            </dd>
          </>
        )}
        <dt>本站工具</dt>
        <dd className="so-links">
          {check.links.map((l) => (
            <SiteLink key={l.to + l.label} link={l} />
          ))}
        </dd>
        {(check.spec || (check.errata && check.errata.length > 0)) && (
          <>
            <dt>出處</dt>
            <dd>
              <BadgeRow label={`出處：${check.id}`}>
                {check.spec && <span className="small muted">規格 {check.spec}</span>}
                {check.errata?.map((e) => <ErratumTag key={e} id={e} />)}
              </BadgeRow>
            </dd>
          </>
        )}
      </dl>
      <textarea
        className="so-note"
        data-missing={missing ? 'true' : 'false'}
        aria-label={`備註：${check.id}`}
        placeholder={item.status === 'fail' || item.status === 'waived' ? '必填：理由、追蹤編號、豁免依據' : '備註（量測條件、seeds、報告連結…）'}
        value={item.note}
        onChange={(e) => onChange({ note: e.target.value })}
      />
      <div className="so-check-head">
        {missing && <span className="so-note-warn">「{STATUS_LABEL[item.status]}」必須寫理由（豁免依據或追蹤編號），否則匯出的報告會標示缺理由。</span>}
        {item.updatedAt && <span className="so-updated">更新：{new Date(item.updatedAt).toLocaleString()}</span>}
      </div>
    </div>
  )
})

function CaseBlock({ c, state, filter, onChange }: { c: SignoffCase; state: ReviewState; filter: MatrixFilter; onChange: OnItemChange }) {
  const items = c.checks.map((k) => ({ k, it: getItem(state, k.id) }))
  const shown = items.filter(({ it }) => visible(filter, it))
  const closed = items.filter(({ it }) => isClosed(it.status)).length
  const fails = items.filter(({ it }) => it.status === 'fail').length
  return (
    <details className="so-case" open id={`so-case-${c.id}`} data-case={c.id}>
      <summary>
        <span className="so-case-title">
          {c.no}. {c.title}
        </span>
        <span className="small muted">
          <RichText text={c.verify} />
        </span>
        <span className="so-case-count">
          {closed}/{c.checks.length} 已關閉{fails > 0 ? ` · ${fails} 未通過` : ''}
        </span>
      </summary>
      <div className="so-case-body">
        <p className="so-case-spec">
          <strong>判斷方式：</strong>
          <RichText text={c.judge} />。<strong>為什麼：</strong>
          <RichText text={c.why} />
          {c.anchor && (
            <>
              {' '}
              <a href="#/signoff" onClick={(e) => { e.preventDefault(); scrollToAnchor(c.anchor as string) }}>
                → 本頁推導與實驗
              </a>
            </>
          )}
        </p>
        {shown.length === 0 && <p className="small muted">（此篩選條件下沒有項目）</p>}
        {shown.map(({ k, it }) => (
          <CheckRow key={k.id} check={k} item={it} onItemChange={onChange} />
        ))}
      </div>
    </details>
  )
}

/** 互動 Sign-off Matrix：每位讀者各自的狀態存在 localStorage（usePersistentState，存取皆有 try/catch）。 */
export function ReviewMatrix() {
  const [state, setState] = usePersistentState<ReviewState>(STORAGE_KEY, emptyReview, isReviewState)
  const [filter, setFilter] = usePersistentState<MatrixFilter>(FILTER_KEY, 'all', isFilter)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'danger'; text: string } | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const sum = useMemo(() => summarize(ALL_CASES, state), [state])
  const info = () => ({ now: new Date(), appVersion: APP_VERSION, gitCommit: GIT_COMMIT })
  const baseName = () => `signoff-review-${state.meta.project.trim() ? state.meta.project.trim().replace(/[\\/:*?"<>|\s]+/g, '-') + '-' : ''}${fileTimestamp()}`

  const onChange = useCallback<OnItemChange>((id, patch) => setState((s) => setItem(s, id, patch)), [setState])
  const exportMd = () => {
    try {
      downloadText(`${baseName()}.md`, 'text/markdown', buildMarkdown(ALL_CASES, state, info()))
      setMsg({ kind: 'ok', text: '已匯出 Markdown。' })
    } catch (e) {
      setMsg({ kind: 'danger', text: `匯出失敗：${(e as Error).message}` })
    }
  }
  const exportJson = () => {
    try {
      downloadText(`${baseName()}.json`, 'application/json', prettyJson(buildJson(ALL_CASES, state, info())))
      setMsg({ kind: 'ok', text: '已匯出 JSON（可再匯入）。' })
    } catch (e) {
      setMsg({ kind: 'danger', text: `匯出失敗：${(e as Error).message}` })
    }
  }
  const onImport = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    f.text()
      .then((text) => {
        const r = parseReviewJson(text, ALL_CASES)
        if (!r.ok) {
          setMsg({ kind: 'danger', text: `匯入失敗：${r.error}` })
          return
        }
        setState(r.state)
        setMsg({ kind: 'ok', text: `已匯入 ${r.imported} 項${r.ignored.length ? `；略過 ${r.ignored.length} 個未知項目（${r.ignored.slice(0, 5).join('、')}${r.ignored.length > 5 ? '…' : ''}）` : ''}。` })
      })
      .catch((err: unknown) => setMsg({ kind: 'danger', text: `讀檔失敗：${(err as Error).message}` }))
  }

  const pct = (n: number) => `${sum.total ? (100 * n) / sum.total : 0}%`
  const verdictKind = sum.verdict === 'blocked' ? 'danger' : sum.verdict === 'incomplete' ? 'warn' : sum.verdict === 'ready' ? 'ok' : 'info'
  /** 已判定 = 通過 + 未通過 + 豁免（進行中與未開始都還沒下判斷） */
  const decided = sum.counts.pass + sum.counts.fail + sum.counts.waived

  return (
    <Section kind="explore" level={2} title="1. Sign-off Matrix（規格 §16.2，互動）" id="so-matrix">
      <p>
        每一列對應規格 §16.2 的一個 case（外加 SSPLL GOS／PHOS 極性檢查與 §17 反面測試），每個 case 拆成可以獨立驗收的檢查項目：<strong>必須驗證什麼、怎麼判斷（含數學判準）、本站哪個章節或實驗可以幫你</strong>。你的狀態與備註只存在<strong>這個瀏覽器</strong>（localStorage；私密模式或停用儲存時不會保存，但頁面照常運作），可以匯出 Markdown 給 design review、或匯出 JSON 之後再匯入。
      </p>

      {/* 常駐的進度摘要：黏在頂列下方，捲到任何一張卡片都看得到（role=status：狀態一改就念一次） */}
      <div className="so-sticky" role="status" aria-live="polite" data-testid="so-sticky" data-verdict={sum.verdict}>
        <span className="so-sticky-main">
          已判定 <strong>{decided}</strong>／{sum.total}
        </span>
        <span className={`so-sticky-item${sum.counts.fail > 0 ? ' is-bad' : ''}`} data-count="fail">
          未通過 <strong>{sum.counts.fail}</strong>
        </span>
        <span className={`so-sticky-item${sum.missingNotes.length > 0 ? ' is-warn' : ''}`} data-count="missing-note">
          缺理由 <strong>{sum.missingNotes.length}</strong>
        </span>
        <span className="so-sticky-item" data-count="closed">
          已關閉 <strong>{sum.closed}</strong>
        </span>
        <span className="so-sticky-bar" aria-hidden="true">
          <span className="so-seg-pass" style={{ width: pct(sum.counts.pass) }} />
          <span className="so-seg-waived" style={{ width: pct(sum.counts.waived) }} />
          <span className="so-seg-fail" style={{ width: pct(sum.counts.fail) }} />
          <span className="so-seg-in-progress" style={{ width: pct(sum.counts['in-progress']) }} />
        </span>
      </div>

      <div className="card">
        <div className="so-meta">
          {(
            [
              ['project', '設計／專案名稱'],
              ['reviewer', 'Reviewer'],
              ['revision', 'Revision／Netlist 版本'],
              ['scope', '範圍／備註（PVT、FCW、mode）'],
            ] as const
          ).map(([k, label]) => (
            <label key={k}>
              {label}
              <input type="text" value={state.meta[k]} onChange={(e) => setState((s) => setMeta(s, { [k]: e.target.value }))} />
            </label>
          ))}
        </div>

        <div className="so-progress" role="img" aria-label={`進度：已關閉 ${sum.closed}／${sum.total}`}>
          <span className="so-seg-pass" style={{ width: pct(sum.counts.pass) }} />
          <span className="so-seg-waived" style={{ width: pct(sum.counts.waived) }} />
          <span className="so-seg-fail" style={{ width: pct(sum.counts.fail) }} />
          <span className="so-seg-in-progress" style={{ width: pct(sum.counts['in-progress']) }} />
        </div>
        <div className="so-legend">
          {REVIEW_STATUSES.map((s) => (
            <span key={s}>
              <i className={`so-seg-${s}`} />
              {STATUS_LABEL[s]} {sum.counts[s]}
            </span>
          ))}
          <span>
            合計 {sum.closed}/{sum.total} 已關閉
          </span>
        </div>
        <Callout kind={verdictKind} title="目前判定">
          <span data-testid="so-verdict">{sum.verdictText}</span>
        </Callout>
        <div className="table-wrap">
          <table className="c-table so-summary-table">
            <caption className="c-sr-only">各 case 的狀態數</caption>
            <thead>
              <tr>
                <th scope="col">Case</th>
                <th className="num">通過</th>
                <th className="num">豁免</th>
                <th className="num">未通過</th>
                <th className="num">進行中</th>
                <th className="num">未開始</th>
              </tr>
            </thead>
            <tbody>
              {sum.perCase.map((c) => (
                <tr key={c.caseId}>
                  <td>
                    <a href="#/signoff" onClick={(e) => { e.preventDefault(); scrollToAnchor(`so-case-${c.caseId}`) }}>
                      {c.title}
                    </a>
                  </td>
                  <td className="num">{c.counts.pass}</td>
                  <td className="num">{c.counts.waived}</td>
                  <td className="num">{c.counts.fail}</td>
                  <td className="num">{c.counts['in-progress']}</td>
                  <td className="num">{c.counts['not-started']}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="so-toolbar">
        <label className="small">
          篩選{' '}
          <select value={filter} onChange={(e) => setFilter(e.target.value as MatrixFilter)} aria-label="篩選檢查項目">
            {(Object.keys(FILTER_LABEL) as MatrixFilter[]).map((f) => (
              <option key={f} value={f}>
                {FILTER_LABEL[f]}
              </option>
            ))}
          </select>
        </label>
        <span className="so-spacer" />
        <button type="button" className="btn" onClick={exportMd}>
          匯出 Markdown
        </button>
        <button type="button" className="btn" onClick={exportJson}>
          匯出 JSON
        </button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          匯入 JSON
        </button>
        <input ref={fileRef} className="so-file-input" type="file" accept="application/json,.json" onChange={onImport} aria-label="選擇要匯入的 review JSON" tabIndex={-1} />
        {!confirmReset ? (
          <button type="button" className="btn" onClick={() => setConfirmReset(true)}>
            重設
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setState(emptyReview())
                setConfirmReset(false)
                setMsg({ kind: 'ok', text: '已清除本機的 review 狀態。' })
              }}
            >
              確定清除全部狀態
            </button>
            <button type="button" className="btn" onClick={() => setConfirmReset(false)}>
              取消
            </button>
          </>
        )}
      </div>
      {msg && (
        <Callout kind={msg.kind} title={null}>
          {msg.text}
        </Callout>
      )}

      {ALL_CASES.map((c) => (
        <CaseBlock key={c.id} c={c} state={state} filter={filter} onChange={onChange} />
      ))}
    </Section>
  )
}
