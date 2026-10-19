import { TipBadge, type BadgeVariant } from './Tags'
import { getTestStatus, TEST_STATUS_LABEL, type TestStatus } from './testStatus'

export { getTestStatus, TEST_STATUS_LABEL, type TestStatus, type TestStatusInfo } from './testStatus'

const ICON: Record<TestStatus, string> = { pass: '✓', partial: '◐', fail: '✗', missing: '○' }
/** 狀態 → 徽章語意：verified 青綠帶 ✓（和「精確」的綠分開）、partial 琥珀描邊、fail 紅、pending 灰虛線 */
const VARIANT: Record<TestStatus, BadgeVariant> = { pass: 'verified', partial: 'partial', fail: 'fail', missing: 'pending' }

/**
 * 顯示 T-id 的驗證狀態。只有 status === 'pass'（TS 與 Python golden 皆通過）才顯示 verified。
 */
export function TestBadge({ id, file }: { id: string; file?: unknown }) {
  const info = getTestStatus(id, file)
  const summary =
    info.status === 'missing'
      ? `${id}：尚無測試結果（pending）。`
      : `${id}：TS ${info.tsPassed} 通過 / ${info.tsFailed} 失敗；Python ${info.pyPassed} 通過 / ${info.pyFailed} 失敗。`
  return (
    <TipBadge
      variant={VARIANT[info.status]}
      className={`c-test c-test-${info.status}`}
      data-status={info.status}
      tip={
        <>
          {summary}
          {info.names.length > 0 && (
            <span className="c-tip-list">
              {info.names.map((n) => (
                <span key={n} className="c-tip-item">
                  {n}
                </span>
              ))}
            </span>
          )}
        </>
      }
    >
      <span aria-hidden="true">{ICON[info.status]}</span> {id} {TEST_STATUS_LABEL[info.status]}
    </TipBadge>
  )
}
