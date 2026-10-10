import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Callout, downloadText, SelectControl, Tex, toCsv } from '@/components'
import type { PresetEntry } from '@/data/types'
import { ALL_PRESETS } from '@/app/presets'
import { checkExpected } from '../consistency'
import { PREVIEWABLE_EXPERIMENTS, type SlotAudit } from '../data'
import type { PreviewOutcome } from '../previews'
import { Rich } from '../common'
import { JumpButton } from './SlotAudit'
import { presetDomId } from './PresetCard'

export type BoardScope = 'gallery' | 'all'
export type BoardStatus = 'ok' | 'mismatch' | 'n/a' | 'unsupported' | 'error' | 'missing'

export interface BoardRow {
  id: string
  galleryIndex?: number
  status: BoardStatus
  /** 必備數值：相符數／總數 */
  requiredMatched: number
  requiredTotal: number
  /** 非必備但在文字中找到夠精確相符數字的個數 */
  optionalMatched: number
  metrics: number
  ms: number
  /** 模型函式結果的一句話摘要（$…$ 為 TeX）或錯誤訊息 */
  text: string
  /** 預覽判定中最嚴重的一級 */
  worst: 'ok' | 'info' | 'warn' | 'danger' | null
}

const STATUS_LABEL: Record<BoardStatus, string> = {
  ok: '✓ 與預期文字一致',
  mismatch: '✗ 與預期文字不一致',
  'n/a': '— 沒有宣告必備數值',
  unsupported: '— 這組參數不在預覽範圍',
  error: '✗ 模型函式丟出錯誤',
  missing: '✗ 缺少 preset',
}
const STATUS_KIND: Record<BoardStatus, 'ok' | 'warn' | 'danger' | 'muted'> = { ok: 'ok', mismatch: 'danger', 'n/a': 'muted', unsupported: 'muted', error: 'danger', missing: 'danger' }
const WORST_ORDER = ['ok', 'info', 'warn', 'danger'] as const

/** 一個 preset 的重算結果 → 一列（純函式；RegressionBoard 與測試共用） */
export function toBoardRow(p: PresetEntry, o: PreviewOutcome): BoardRow {
  const base = { id: p.id, galleryIndex: p.galleryIndex, requiredMatched: 0, requiredTotal: 0, optionalMatched: 0, metrics: 0, ms: 0, worst: null }
  if (o.status === 'unsupported') return { ...base, status: 'unsupported', text: o.reason }
  if (o.status === 'error') return { ...base, status: 'error', text: o.message }
  const chk = checkExpected(p, o.result.metrics)
  const req = chk.rows.filter((r) => r.required)
  const worst = o.result.verdicts.reduce<BoardRow['worst']>((w, v) => (w === null || WORST_ORDER.indexOf(v.kind) > WORST_ORDER.indexOf(w) ? v.kind : w), null)
  return {
    id: p.id,
    galleryIndex: p.galleryIndex,
    status: chk.status,
    requiredMatched: req.filter((r) => r.status === 'match').length,
    requiredTotal: req.length + chk.missingKeys.length,
    optionalMatched: chk.rows.filter((r) => !r.required && r.status === 'match').length,
    metrics: o.result.metrics.length,
    ms: o.ms,
    text: o.result.summary,
    worst,
  }
}

const WORST_LABEL: Record<NonNullable<BoardRow['worst']>, string> = { ok: '模型判定：正常', info: '模型判定：有提示', warn: '模型判定：有警告', danger: '模型判定：失穩／不可辨識' }

/**
 * §5：一次重算。按下按鈕才載入 previews（與所有模型模組），在主執行緒逐一重算並讓出控制權（每個 preset 之間 await 一次），
 * 所以頁面不會卡住，也可以中途停止。結果可下載 CSV。
 */
export function RegressionBoard({ audit, onInspect }: { audit: SlotAudit[]; onInspect: (id: string) => void }) {
  const [scope, setScope] = useState<BoardScope>('gallery')
  const [rows, setRows] = useState<BoardRow[] | null>(null)
  const [doneScope, setDoneScope] = useState<BoardScope | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)
  const token = useRef(0)
  useEffect(
    () => () => {
      token.current++ // 卸載時讓進行中的迴圈自行結束
    },
    [],
  )

  const targets = useMemo(() => {
    const previewable = ALL_PRESETS.filter((p) => PREVIEWABLE_EXPERIMENTS.includes(p.experiment))
    return { gallery: ALL_PRESETS.filter((p) => p.galleryIndex !== undefined), all: previewable }
  }, [])
  const missing = useMemo(() => audit.filter((a) => a.status === 'missing'), [audit])

  const run = useCallback(async () => {
    const my = ++token.current
    const list = targets[scope]
    setRunning(true)
    setError(null)
    setRows([])
    setProgress({ done: 0, total: list.length })
    try {
      const { previewPreset } = await import('../previews')
      const out: BoardRow[] = []
      for (let i = 0; i < list.length; i++) {
        if (token.current !== my) return
        out.push(toBoardRow(list[i], previewPreset(list[i])))
        setRows([...out])
        setProgress({ done: i + 1, total: list.length })
        await new Promise((r) => setTimeout(r, 0)) // 讓出主執行緒：畫面可更新、可按停止
      }
      if (token.current === my) setDoneScope(scope)
    } catch (e) {
      if (token.current === my) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (token.current === my) setRunning(false)
    }
  }, [scope, targets])

  const stop = useCallback(() => {
    token.current++
    setRunning(false)
  }, [])

  const shown: BoardRow[] = useMemo(() => {
    if (!rows) return []
    if ((doneScope ?? scope) !== 'gallery' || running) return rows
    // §19.2 範圍：把缺少的編號也列出來（不補資料，只標示缺少）
    const miss: BoardRow[] = missing.map((m) => ({
      id: `（#${m.slot.index} 缺少）`,
      galleryIndex: m.slot.index,
      status: 'missing',
      requiredMatched: 0,
      requiredTotal: 0,
      optionalMatched: 0,
      metrics: 0,
      ms: 0,
      text: m.issues.join(' '),
      worst: null,
    }))
    return [...rows, ...miss].sort((a, b) => (a.galleryIndex ?? 99) - (b.galleryIndex ?? 99))
  }, [rows, missing, doneScope, scope, running])

  const count = (s: BoardStatus) => shown.filter((r) => r.status === s).length
  const totalMs = shown.reduce((s, r) => s + r.ms, 0)
  const finished = rows !== null && !running && doneScope !== null
  const bad = count('mismatch') + count('error') + count('missing')

  const exportCsv = () => {
    const csv = toCsv({
      preset_id: shown.map((r) => r.id),
      gallery_index: shown.map((r) => r.galleryIndex ?? ''),
      status: shown.map((r) => r.status),
      required_matched: shown.map((r) => r.requiredMatched),
      required_total: shown.map((r) => r.requiredTotal),
      optional_matched: shown.map((r) => r.optionalMatched),
      metrics: shown.map((r) => r.metrics),
      model_verdict: shown.map((r) => r.worst ?? ''),
      ms: shown.map((r) => Number(r.ms.toFixed(2))),
      summary: shown.map((r) => r.text),
    })
    downloadText('gallery-recompute.csv', 'text/csv', csv, { bom: true })
  }

  return (
    <div className="gal-board" data-board-scope={doneScope ?? scope}>
      <div className="gal-board-controls">
        <SelectControl<BoardScope>
          label="範圍"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'gallery', label: `規格 §19.2 的必備 preset（${targets.gallery.length} 個）` },
            { value: 'all', label: `全部可預覽的 preset（${targets.all.length} 個）` },
          ]}
          reg="BEH_GALLERY_RECOMPUTE_SCOPE"
          disabled={running}
        />
        {running ? (
          <button type="button" className="btn" onClick={stop}>
            停止
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => void run()} data-action="recompute">
            全部重算
          </button>
        )}
        <button type="button" className="btn" onClick={exportCsv} disabled={!finished || shown.length === 0}>
          下載 CSV
        </button>
        <span className="small muted" aria-live="polite">
          {running ? `計算中 ${progress.done} / ${progress.total}…` : finished ? `完成：${shown.length} 列，模型計算共 ${totalMs.toFixed(0)} ms` : '尚未執行（按「全部重算」才會載入模型模組）'}
        </span>
      </div>
      {error && (
        <Callout kind="danger" title="重算中斷">
          {error}
        </Callout>
      )}
      {finished && (
        <Callout kind={bad > 0 ? 'danger' : 'ok'} title={bad > 0 ? `有 ${bad} 個需要處理` : '全部通過'}>
          與預期文字一致 {count('ok')} 個；不一致 {count('mismatch')} 個；模型函式錯誤 {count('error')} 個
          {doneScope === 'gallery' ? `；缺少 ${count('missing')} 個` : `；沒有宣告必備數值 ${count('n/a')} 個；不在預覽範圍 ${count('unsupported')} 個`}。
          {doneScope === 'all' && '「沒有宣告必備數值」的 preset 只確認模型函式能算出結果，並列出文字中找得到的相符數字。'}
        </Callout>
      )}
      {shown.length > 0 && (
        <div className="table-wrap">
          <table className="gal-table gal-board-table">
            <thead>
              <tr>
                <th>#</th>
                <th>preset</th>
                <th>模型函式算出的摘要</th>
                <th className="num">必備數值相符</th>
                <th className="num">其他相符</th>
                <th>模型判定</th>
                <th className="num">耗時</th>
                <th>比對結果</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} data-board-row={r.id} data-status={r.status}>
                  <td className="num">{r.galleryIndex ?? ''}</td>
                  <td>
                    {r.status === 'missing' ? (
                      <span className="gal-bad">{r.id}</span>
                    ) : (
                      <>
                        {r.galleryIndex !== undefined ? (
                          <JumpButton domId={presetDomId(r.id)}>
                            <code className="gal-id">{r.id}</code>
                          </JumpButton>
                        ) : (
                          <code className="gal-id">{r.id}</code>
                        )}{' '}
                        {r.status !== 'unsupported' && (
                          <button type="button" className="gal-linkbtn small" onClick={() => onInspect(r.id)} title="在 §6 的 Preset Inspector 檢視逐項比對">
                            檢視
                          </button>
                        )}
                      </>
                    )}
                  </td>
                  <td className="small gal-board-summary">
                    <Rich text={r.text} />
                  </td>
                  <td className="num">{r.requiredTotal > 0 ? `${r.requiredMatched} / ${r.requiredTotal}` : '—'}</td>
                  <td className="num">{r.status === 'ok' || r.status === 'mismatch' || r.status === 'n/a' ? r.optionalMatched : '—'}</td>
                  <td className="small">{r.worst ? <span className={`gal-status gal-status-${r.worst === 'info' ? 'muted' : r.worst}`}>{WORST_LABEL[r.worst]}</span> : '—'}</td>
                  <td className="num nowrap">{r.ms > 0 ? `${r.ms.toFixed(1)} ms` : '—'}</td>
                  <td>
                    <span className={`gal-status gal-status-${STATUS_KIND[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted">
        「模型判定」是模型函式自己的結論（例如 <Tex>{'C\\le0'}</Tex> 時回報極性錯誤），和「比對結果」是兩回事：#3、#5、#12 本來就是要示範發散，所以模型判定為失穩、比對結果為一致，才是正確的組合。
      </p>
    </div>
  )
}
