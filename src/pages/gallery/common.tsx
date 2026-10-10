import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { mathText, ModelLevel, StepDerivation, Tex, TestBadge, type Step } from '@/components'
import { useSettings, type LearningMode } from '@/app/settings'
import type { ModelLevelId, PresetEntry } from '@/data/types'
import { PAGES } from '@/app/registry'
import { erratumInfo, levelsOf, SLOT_STATUS_LABEL, type SlotStatus } from './data'
import { rawToTex, texNum } from './format'

/** 含 `$…$` 的字串：文字照常、`$…$` 以 KaTeX 顯示（所有數學一律 LaTeX；與共用元件的 mathText 同一套規則） */
export function Rich({ text }: { text: string }) {
  const node = useMemo(() => mathText(text), [text])
  return <>{node}</>
}

/** 與 useSettings().atLeast 相同，但在 SettingsProvider 之外不丟錯（預設視為 engineer） */
export function useAtLeast(min: LearningMode): boolean {
  try {
    return useSettings().atLeast(min)
  } catch {
    return min !== 'research'
  }
}

/**
 * 逐步推導外包一層可收合的框：Beginner 預設收合（一鍵展開），Engineer / Research 預設展開（docs/teaching-style.md §6）。
 * steps 的 why 可以是含 `$…$` 的字串。
 */
export function Steps({ title, steps, result, open }: { title: string; steps: { tex: string; why: ReactNode }[]; result?: string; open?: boolean }) {
  const engineer = useAtLeast('engineer')
  const rendered: Step[] = steps.map((s) => ({ tex: s.tex, why: mathText(s.why) }))
  return (
    <details className="gal-steps" open={open ?? engineer}>
      <summary>
        <span className="gal-steps-badge">逐步推導</span> {mathText(title)}
      </summary>
      <StepDerivation steps={rendered} result={result} />
    </details>
  )
}

/** 數值顯示：數字一律經 KaTeX；NaN 顯示「不存在」並說明 */
export function NumTex({ value, sig = 6 }: { value: number | string; sig?: number }) {
  if (typeof value === 'string') return <Rich text={value} />
  if (Number.isNaN(value)) return <span className="gal-na" title="在這組參數下不存在或未定義（例如 |p| ≥ 1 時沒有穩態變異或頻寬）">不存在</span>
  return <Tex>{texNum(value, sig)}</Tex>
}

/** 勘誤標記：連到 #/verification（驗證頁依 id 列出勘誤） */
export function ErratumChip({ eid }: { eid: string }) {
  const info = erratumInfo(eid)
  const title = info ? `勘誤 ${eid}（${info.severity}）：${info.area}——${info.slug}` : `勘誤 ${eid}`
  return (
    <a className="gal-erratum" href="#/verification" title={title} data-eid={eid}>
      勘誤 {eid}
    </a>
  )
}

export function ErrataList({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null
  return (
    <span className="gal-errata">
      {ids.map((id) => (
        <ErratumChip key={id} eid={id} />
      ))}
    </span>
  )
}

export function TestBadges({ ids }: { ids: string[] }) {
  if (ids.length === 0) return <span className="small muted">（無 T-id）</span>
  return (
    <span className="gal-tests">
      {ids.map((id) => (
        <TestBadge key={id} id={id} />
      ))}
    </span>
  )
}

/** 模型層級：動態者列出可能值並註明 */
export function LevelBadges({ preset }: { preset: PresetEntry }) {
  const lv = levelsOf(preset)
  if (!lv.known) return <span className="gal-level-unknown small muted" title="這個 experiment id 尚未登錄在 Gallery 的 EXPERIMENT_META">層級未登錄</span>
  return (
    <span className="gal-levels" title={lv.dynamic ? '層級隨參數改變；列出所有可能值' : undefined}>
      {lv.levels.map((l: ModelLevelId) => (
        <ModelLevel key={l} level={l} />
      ))}
      {lv.dynamic && <span className="small muted">（依設定）</span>}
    </span>
  )
}

/** 頁面路徑 → 側欄名稱（不在 registry 的直接顯示路徑並標示） */
export function pageNav(path: string): { nav: string; registered: boolean } {
  const e = PAGES.find((p) => p.path === path)
  return e ? { nav: e.nav, registered: true } : { nav: path, registered: false }
}

export function PageLink({ path }: { path: string }) {
  const { nav, registered } = pageNav(path)
  if (!registered) return <span className="gal-bad">{path}（不在網站目錄）</span>
  return <Link to={path}>{nav}</Link>
}

const STATUS_KIND: Record<SlotStatus, 'ok' | 'warn' | 'danger'> = {
  ok: 'ok',
  missing: 'danger',
  duplicate: 'danger',
  'page-unregistered': 'danger',
  'page-mismatch': 'danger',
  'experiment-mismatch': 'danger',
  'tests-missing': 'warn',
}

export function SlotStatusChip({ status }: { status: SlotStatus }) {
  return (
    <span className={`gal-status gal-status-${STATUS_KIND[status]}`} data-status={status}>
      {status === 'ok' ? '✓ ' : status === 'tests-missing' ? '△ ' : '✗ '}
      {SLOT_STATUS_LABEL[status]}
    </span>
  )
}

/** 預期文字比對的小圖示 */
export function MatchMark({ status, raw }: { status: 'match' | 'absent' | 'mismatch' | 'skip'; raw?: string }) {
  if (status === 'match')
    return (
      <span className="gal-match gal-match-ok" title={`預期文字中的「${raw ?? ''}」與重算值相符`}>
        ✓ {raw ? <Tex>{rawToTex(raw)}</Tex> : null}
      </span>
    )
  if (status === 'mismatch') return <span className="gal-match gal-match-bad" title="這是必備數值，但預期文字中找不到相符的數字">✗ 文字不符</span>
  if (status === 'skip') return <span className="small muted">—</span>
  return <span className="small muted" title="預期文字沒有寫出這個量（不代表錯）">未列出</span>
}
