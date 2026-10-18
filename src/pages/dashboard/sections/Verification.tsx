import { memo, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { TestBadge, TEST_STATUS_LABEL, type TestStatus } from '@/components'
import { computePreviews, evenNTie } from '../previews'
import { SEVERITIES, SEVERITY_LABEL, summarizeErrata, summarizeTests, type Severity } from '../summaries'
import { Rich, verificationPath } from '../ui'

const SEV_COLOR: Record<Severity, string> = { high: 'var(--danger)', medium: 'var(--warn)', low: 'var(--info)' }
const STATUS_ORDER: TestStatus[] = ['pass', 'partial', 'fail', 'missing']

/** 高嚴重度勘誤的一句話摘要（依 errata.json 的 id；未列者顯示原始位置描述）。$…$ 為 TeX；數字由 previews 即時計算。 */
function highShort(id: string): string | undefined {
  if (id === 'bias-inl-signlms-label') {
    const P = computePreviews()
    return `INL 例的 $${P.inl.wMse.toFixed(2)}$ 只屬於 MSE-LMS；無雜訊 Sign-LMS 收斂到 $|x|$ 加權中位數 $${P.inl.wSign0.toFixed(1)}$，中等雜訊介於兩者之間`
  }
  if (id === 'comparator-tie-even-N') {
    const t = evenNTie(100)
    return `偶數 $N$ 的平手（tie）讓表格數字與它宣稱的事件不一致：$N=${t.N}$ 時嚴格 $P(G_N>0)=${(100 * t.strict).toFixed(1)}\\%$，另有 $${(100 * t.tie).toFixed(1)}\\%$ 平手`
  }
  return undefined
}

/** 驗證與勘誤摘要：勘誤數依嚴重度、T01–T18 狀態（來自 verify 腳本產生的 JSON） */
export const VerificationPanel = memo(function VerificationPanel() {
  const errata = useMemo(() => summarizeErrata(), [])
  const tests = useMemo(() => summarizeTests(), [])
  const gen = tests.generatedAt ? new Date(tests.generatedAt) : undefined
  return (
    <section id="dash-verify" aria-labelledby="dash-verify-h">
      <h2 id="dash-verify-h" className="dash-h2">
        驗證與勘誤 <span className="dash-h2-kicker">規格 §17、docs/validation.md</span>
      </h2>
      <p className="dash-lead-sm">
        規格書的每個公式與數值都被獨立重算過；推導不一致、定義不完整或適用條件沒寫清楚的地方列為勘誤，網站一律採用修正版，並在相關公式旁標示「勘誤 Exx」（點一下會直接跳到驗證頁的那一條）。
      </p>
      <div className="dash-verif">
        <div className="dash-panel">
          <h3>規格勘誤 {errata.total} 項</h3>
          <div className="dash-sevbar" role="img" aria-label={SEVERITIES.map((s) => `${SEVERITY_LABEL[s]} ${errata.bySeverity[s]} 項`).join('、')}>
            {SEVERITIES.map((s) => (
              <span key={s} style={{ width: `${(100 * errata.bySeverity[s]) / Math.max(1, errata.total)}%`, background: SEV_COLOR[s] }} />
            ))}
          </div>
          <div className="dash-sev-legend">
            {SEVERITIES.map((s) => (
              <span key={s}>
                <span className="dash-dot" style={{ background: SEV_COLOR[s], marginRight: 5 }} aria-hidden="true" />
                {SEVERITY_LABEL[s]} <b>{errata.bySeverity[s]}</b>
              </span>
            ))}
          </div>
          <p className="small" style={{ marginBottom: 4 }}>
            <strong>高嚴重度（會讓實作或測試直接出錯）：</strong>
          </p>
          <ul className="small" style={{ marginTop: 0 }}>
            {errata.high.map((e) => (
              <li key={e.eid}>
                <Link to={verificationPath(e.eid)} title={e.correction}>
                  {e.eid}
                </Link>{' '}
                {e.area}：<Rich text={highShort(e.id) ?? e.location} />
              </li>
            ))}
          </ul>
          <p className="small muted">
            依領域：
            {errata.byArea.map((a, i) => (
              <span key={a.area}>
                {i > 0 && '、'}
                {a.area} {a.count}
              </span>
            ))}
          </p>
          <Link to="/verification" className="btn btn-primary">
            看完整勘誤總表 →
          </Link>
        </div>

        <div className="dash-panel">
          <h3>Acceptance tests T01–T18</h3>
          <div className="dash-tcounts">
            {STATUS_ORDER.map((s) => (
              <span key={s}>
                {TEST_STATUS_LABEL[s]} <b>{tests.counts[s]}</b>
              </span>
            ))}
          </div>
          <div className="dash-tgrid">
            {tests.byId.map((t) => (
              <div key={t.id} title={t.description}>
                <TestBadge id={t.id} />
                <div>
                  <Link to={verificationPath(t.id)} aria-label={`${t.id}：到驗證頁看輸入與期望值`}>
                    {t.section ?? '期望值'} →
                  </Link>
                </div>
              </div>
            ))}
          </div>
          <p className="small muted">
            <strong>verified</strong> 只在 TypeScript 測試與 Python golden model 兩邊都通過時顯示；<strong>partial</strong> 表示只有一邊有通過的測試；
            <strong>pending</strong> 表示尚無結果。狀態由 <code>npm run verify</code> 產生
            {gen && !Number.isNaN(gen.getTime()) ? `（最近一次：${gen.toISOString().slice(0, 10)}）` : ''}，網站不會把未完成的項目標成已驗證。
          </p>
          <Link to="/verification" className="btn">
            看每個 T-id 的輸入與期望值 →
          </Link>
        </div>
      </div>
    </section>
  )
})
