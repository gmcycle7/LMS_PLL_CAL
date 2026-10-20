import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge, badgeClass, ChapterFig, ErratumLink, mathText, ModelLevel, StepDerivation, Tex, TestBadge, type BadgeVariant, type Step } from '@/components'
import { useSettings, type LearningMode } from '@/app/settings'
import type { ModelLevelId, PresetEntry } from '@/data/types'
import { PAGES } from '@/app/registry'
import { levelsOf, SLOT_STATUS_LABEL, type SlotStatus } from './data'
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
        <span className={badgeClass('neutral', 'gal-steps-badge')}>逐步推導</span> {mathText(title)}
      </summary>
      <StepDerivation steps={rendered} result={result} />
    </details>
  )
}

/**
 * 方塊圖版位（docs/teaching-style.md §8）：共用的 ChapterFig（Mermaid 圖＋圖說＋「怎麼看這張圖」導讀）。
 * 數學符號留給 children 用 <Tex> 寫，並對照「圖上的 X 就是公式裡的 x」。`gal-diagram` 只是測試與審查腳本的 hook。
 */
export function Diagram({ chart, caption, ariaLabel, children }: { chart: string; caption: string; ariaLabel?: string; children?: ReactNode }) {
  return (
    <ChapterFig chart={chart} caption={caption} ariaLabel={ariaLabel} className="gal-diagram">
      {children}
    </ChapterFig>
  )
}

/** 數值顯示：數字一律經 KaTeX；NaN 顯示「不存在」並說明 */
export function NumTex({ value, sig = 6 }: { value: number | string; sig?: number }) {
  if (typeof value === 'string') return <Rich text={value} />
  if (Number.isNaN(value)) return <span className="gal-na" title="在這組參數下不存在或未定義（例如 |p| ≥ 1 時沒有穩態變異或頻寬）">不存在</span>
  return <Tex>{texNum(value, sig)}</Tex>
}

/** 勘誤標記：共用的 ErratumLink（連到驗證頁該條勘誤的 ?e= 深連結；提示取自 errata.json） */
export function ErratumChip({ eid }: { eid: string }) {
  return <ErratumLink id={eid} />
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

/** 頁內的 ok／warn／danger／muted → Badge variant（綠／琥珀描邊／紅／灰；顏色語意見 dev-conventions §2.1） */
export type GalKind = 'ok' | 'warn' | 'danger' | 'muted'
const GAL_VARIANT: Record<GalKind, BadgeVariant> = { ok: 'ok', warn: 'partial', danger: 'mismatch', muted: 'na' }

/** 狀態小標籤（`gal-status gal-status-<kind>` 只是測試的 hook，顏色與尺寸來自 Badge） */
export function GalStatus({ kind, children, status }: { kind: GalKind; children: ReactNode; status?: string }) {
  return (
    <Badge variant={GAL_VARIANT[kind]} className={`gal-status gal-status-${kind}`} data-status={status}>
      {children}
    </Badge>
  )
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
    <GalStatus kind={STATUS_KIND[status]} status={status}>
      {status === 'ok' ? '✓ ' : status === 'tests-missing' ? '△ ' : '✗ '}
      {SLOT_STATUS_LABEL[status]}
    </GalStatus>
  )
}

/** 預期文字比對的小圖示 */
export function MatchMark({ status, raw }: { status: 'match' | 'absent' | 'mismatch' | 'skip'; raw?: string }) {
  if (status === 'match')
    return (
      <Badge variant="ok" className="gal-match gal-match-ok" title={`預期文字中的「${raw ?? ''}」與重算值相符`}>
        ✓ {raw ? <Tex>{rawToTex(raw)}</Tex> : null}
      </Badge>
    )
  if (status === 'mismatch') return (
      <Badge variant="mismatch" className="gal-match gal-match-bad" title="這是必備數值，但預期文字中找不到相符的數字">
        ✗ 文字不符
      </Badge>
    )
  if (status === 'skip') return <span className="small muted">—</span>
  return <span className="small muted" title="預期文字沒有寫出這個量（不代表錯）">未列出</span>
}
