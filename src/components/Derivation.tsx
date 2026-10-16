import { isValidElement, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useOptionalSettings } from './optionalSettings'
import { ScrollRegion } from './ScrollRegion'
import { Tex, mathText } from './Tex'
import { ClaimTag, ModelLevel } from './Tags'
import { IconChevron } from './icons'
import { MODEL_LEVEL_INFO } from './labels'
import type { ClaimKind, ModelLevelId } from './types'

/** 符號表的一列；symbol 為 TeX 原始碼 */
export interface SymbolRow {
  symbol: string
  meaning: ReactNode
  unit?: ReactNode
}

export interface DerivationProps {
  title: ReactNode
  /** 推導內容（可混用文字、<TexBlock>） */
  derivation: ReactNode
  /** 符號表：可傳 SymbolRow[] 自動排版，或任意 ReactNode */
  symbols?: SymbolRow[] | ReactNode
  /** 單位說明：可傳 { 量: 單位 } 或任意 ReactNode */
  units?: Record<string, string> | ReactNode
  /** 假設：字串陣列會排成清單 */
  assumptions?: string[] | ReactNode
  level?: ModelLevelId
  claim?: ClaimKind
  /** 對應公式 ID（顯示於標題旁） */
  formulaId?: string
  /** 覆寫預設展開狀態；未指定時 Research 模式預設展開，其餘模式預設收合 */
  defaultOpen?: boolean
}

type TabKey = 'derivation' | 'symbols' | 'units' | 'assumptions' | 'level'

const TAB_LABEL: Record<TabKey, string> = {
  derivation: 'Derivation 推導',
  symbols: 'Symbols 符號',
  units: 'Units 單位',
  assumptions: 'Assumptions 假設',
  level: 'Model Level 模型層級',
}

function isSymbolRows(v: unknown): v is SymbolRow[] {
  return Array.isArray(v) && v.every((r) => r && typeof r === 'object' && !isValidElement(r) && 'symbol' in r)
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string')
}

function isUnitRecord(v: unknown): v is Record<string, string> {
  return (
    !!v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    !isValidElement(v) &&
    Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string')
  )
}

/**
 * 可展開的推導面板，含 Derivation / Symbols / Units / Assumptions / Model Level 分頁（規格 §18.4）。
 * 預設：Beginner / Engineer 收合、Research 展開；使用者手動切換後以手動狀態為準。
 */
export function Derivation({
  title,
  derivation,
  symbols,
  units,
  assumptions,
  level,
  claim,
  formulaId,
  defaultOpen,
}: DerivationProps) {
  const settings = useOptionalSettings()
  const [manualOpen, setManualOpen] = useState<boolean | null>(null)
  const open = manualOpen ?? defaultOpen ?? settings?.mode === 'research'
  const baseId = useId()
  const panelId = `${baseId}-panel`

  const tabs: TabKey[] = ['derivation']
  if (symbols !== undefined && symbols !== null) tabs.push('symbols')
  if (units !== undefined && units !== null) tabs.push('units')
  if (assumptions !== undefined && assumptions !== null) tabs.push('assumptions')
  if (level) tabs.push('level')

  const [active, setActive] = useState<TabKey>('derivation')
  const current = tabs.includes(active) ? active : 'derivation'
  const tabRefs = useRef<Partial<Record<TabKey, HTMLButtonElement | null>>>({})

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = tabs.indexOf(current)
    let next = i
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    else return
    e.preventDefault()
    setActive(tabs[next])
    tabRefs.current[tabs[next]]?.focus()
  }

  const renderPanel = (key: TabKey): ReactNode => {
    switch (key) {
      case 'derivation':
        return derivation
      case 'symbols':
        return isSymbolRows(symbols) ? (
          <ScrollRegion className="table-wrap" label="符號表（可左右捲動）">
            <table className="c-derivation-table">
              <thead>
                <tr>
                  <th>符號</th>
                  <th>意義</th>
                  <th>單位</th>
                </tr>
              </thead>
              <tbody>
                {symbols.map((r) => (
                  <tr key={r.symbol}>
                    <td>
                      <Tex>{r.symbol}</Tex>
                    </td>
                    <td>{r.meaning}</td>
                    <td>{r.unit ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        ) : (
          (symbols as ReactNode)
        )
      case 'units':
        return isUnitRecord(units) ? (
          <ScrollRegion className="table-wrap" label="單位表（可左右捲動）">
            <table className="c-derivation-table">
              <thead>
                <tr>
                  <th>量</th>
                  <th>單位</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(units).map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        ) : (
          (units as ReactNode)
        )
      case 'assumptions':
        return isStringArray(assumptions) ? (
          <ul className="c-assumption-list">
            {assumptions.map((a) => (
              <li key={a}>{mathText(a)}</li>
            ))}
          </ul>
        ) : (
          (assumptions as ReactNode)
        )
      case 'level':
        return level ? (
          <div>
            <p>
              <ModelLevel level={level} showName />
            </p>
            <p className="small">
              時間基準：{MODEL_LEVEL_INFO[level].timebase}；要驗證的能力：{MODEL_LEVEL_INFO[level].verifies}。
            </p>
            <p className="small muted">
              教學用的 L0–L2 與可做架構 sign-off 的 L4–L6 必須分清楚；簡化解析模型只能當下限或 sanity check。
            </p>
          </div>
        ) : null
    }
  }

  return (
    <div className={`c-derivation${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="c-derivation-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setManualOpen(!open)}
      >
        <span className="c-derivation-chevron">
          <IconChevron size={14} />
        </span>
        <span className="c-derivation-title">{mathText(title)}</span>
        {formulaId && <span className="c-formula-id">({formulaId})</span>}
        <span className="c-derivation-hint">{open ? '收合' : '展開推導'}</span>
      </button>
      {open && (
        <div className="c-derivation-body" id={panelId}>
          {(claim || level) && (
            <div className="c-tag-row">
              {level && <ModelLevel level={level} />}
              {claim && <ClaimTag kind={claim} />}
            </div>
          )}
          {tabs.length > 1 && (
            <div className="c-tabs" role="tablist" aria-label="推導面板分頁">
              {tabs.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  id={`${baseId}-tab-${t}`}
                  aria-selected={current === t}
                  aria-controls={`${baseId}-tabpanel`}
                  tabIndex={current === t ? 0 : -1}
                  className={`c-tab${current === t ? ' is-active' : ''}`}
                  ref={(el) => {
                    tabRefs.current[t] = el
                  }}
                  onClick={() => setActive(t)}
                  onKeyDown={onTabKey}
                >
                  {TAB_LABEL[t]}
                </button>
              ))}
            </div>
          )}
          <div
            className="c-tabpanel"
            role={tabs.length > 1 ? 'tabpanel' : undefined}
            id={`${baseId}-tabpanel`}
            aria-labelledby={tabs.length > 1 ? `${baseId}-tab-${current}` : undefined}
          >
            {renderPanel(current)}
          </div>
        </div>
      )}
    </div>
  )
}
