import { useState, type ReactNode } from 'react'
import { useSettings, type LearningMode } from '@/app/settings'
import { HandCalc, mathText } from '@/components'
import { HANDCALCS } from './handcalcs'

/**
 * 第 06 章共用的小元件（只在本章使用；若其他章需要可上移到 @/components）。
 */

const RANK: Record<LearningMode, number> = { beginner: 0, engineer: 1, research: 2 }

/** useSettings() 的安全版：在 SettingsProvider 之外（單元測試）回傳 null（同 components/optionalSettings 的做法）。 */
function useSettingsSafe(): { mode: LearningMode } | null {
  try {
    return useSettings()
  } catch {
    return null
  }
}

/** 目前學習模式是否至少為 min；在 SettingsProvider 之外視為 engineer。 */
export function useModeAtLeast(min: LearningMode): boolean {
  const mode = useSettingsSafe()?.mode ?? 'engineer'
  return RANK[mode] >= RANK[min]
}

/** 勘誤小標：連到驗證頁（列出所有勘誤 id）。 */
export function Erratum({ id, children }: { id: string; children?: ReactNode }) {
  return (
    <a className="ch06-erratum" href="#/verification" title={`勘誤 ${id}：網站採用 docs/validation.md 的修正版本`}>
      勘誤 {id}
      {children ? <span className="ch06-erratum-note">：{children}</span> : null}
    </a>
  )
}

/** 頁內跳轉（HashRouter 下不能用 href="#id"，改用 scrollIntoView）。 */
export function JumpTo({ target, children }: { target: string; children: ReactNode }) {
  return (
    <button
      type="button"
      className="ch06-jump"
      onClick={() => document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
    >
      {children}
    </button>
  )
}

/**
 * 可收合的推導框：Engineer / Research 模式預設展開，Beginner 預設收合（一鍵展開）。
 * docs/teaching-style.md §6。title 為字串時支援 `$...$` 行內公式（與共用元件的標題一致）。
 */
export function StepBox({ title, children, min = 'engineer' }: { title: ReactNode; children: ReactNode; min?: LearningMode }) {
  const open = useModeAtLeast(min)
  const [manual, setManual] = useState<boolean | null>(null)
  const isOpen = manual ?? open
  return (
    <details
      className="ch06-stepbox"
      open={isOpen}
      onToggle={(e) => {
        const next = (e.currentTarget as HTMLDetailsElement).open
        if (next !== isOpen) setManual(next)
      }}
    >
      <summary>
        <span className="ch06-stepbox-badge">推導</span> {mathText(title)}
      </summary>
      <div className="ch06-stepbox-body">{children}</div>
    </details>
  )
}

/**
 * 本章的「帶入手算」題（docs/teaching-style.md §7）：依 id 取用 handcalcs.ts 的定義，
 * 前面加一句邀請讀者換數字、先用紙筆算的引導（lead 支援 `$...$`）。
 */
export function ChapterHandCalc({ id, lead }: { id: string; lead?: ReactNode }) {
  const def = HANDCALCS.find((h) => h.id === id)
  if (!def) throw new Error(`第 06 章找不到手算題 ${id}`)
  return (
    <div className="ch06-handcalc">
      <p className="small ch06-handcalc-lead">
        <strong>換你算：</strong>
        {mathText(lead ?? '把下面的數字換成你自己的，先用紙筆和計算機算一次，再和網站逐步對答案。')}
      </p>
      <HandCalc def={def} />
    </div>
  )
}

/** 小數格式（有效位數），NaN/∞ 顯示為 — */
export function f(x: number | null | undefined, digits = 4): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—'
  if (x === 0) return '0'
  const ax = Math.abs(x)
  if (ax >= 1e5 || ax < 1e-4) return x.toExponential(Math.max(0, digits - 1))
  return Number(x.toPrecision(digits)).toString()
}

/** 固定小數位 */
export function fx(x: number, d = 4): string {
  return Number.isFinite(x) ? x.toFixed(d) : '—'
}

/** 角度 [deg] */
export function degOf(rad: number): number {
  return (rad * 180) / Math.PI
}

export function radOf(deg: number): number {
  return (deg * Math.PI) / 180
}

/** 章節段落標題（含錨點 id，供目錄使用） */
export function ChapterSection({ id, title, kicker, children }: { id: string; title: ReactNode; kicker?: string; children: ReactNode }) {
  return (
    <section className="ch06-section" id={id} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="ch06-h2">
        {kicker && <span className="ch06-kicker">{kicker}</span>}
        {title}
      </h2>
      {children}
    </section>
  )
}
