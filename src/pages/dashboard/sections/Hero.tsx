import { memo, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Callout, SourceTag, Tex } from '@/components'
import { PAGES } from '@/app/registry'
import { SIX_CONDITIONS } from '../data'
import { handExample } from '../previews'
import { summarizeErrata, summarizeTests } from '../summaries'
import { scrollToId } from '../ui'

const TOC: { id: string; label: string }[] = [
  { id: 'dash-routes', label: '三條學習路線' },
  { id: 'dash-thesis', label: '六個條件' },
  { id: 'dash-spine', label: '一條方程式' },
  { id: 'dash-check', label: '動手體檢' },
  { id: 'dash-chapters', label: '章節地圖' },
  { id: 'dash-gallery', label: '12 個實驗' },
  { id: 'dash-questions', label: '15 個問題' },
  { id: 'dash-modes', label: '學習模式' },
  { id: 'dash-verify', label: '驗證與勘誤' },
  { id: 'dash-recap', label: '本頁必記' },
]

const fmt = (x: number, d = 4) => Number(x.toPrecision(d)).toString()

/** Hero：網站目標、最終教學主旨、「從這裡開始」卡片與快速統計 */
export const Hero = memo(function Hero() {
  const h = useMemo(() => handExample(), [])
  const errata = useMemo(() => summarizeErrata(), [])
  const tests = useMemo(() => summarizeTests(), [])
  const chapters = PAGES.filter((p) => /^ch\d\d$/.test(p.id) || p.id.startsWith('case-')).length
  const start = PAGES.find((p) => p.id === 'ch00')

  // 第一課的三個動作：預測 → 比較 → 修正（runScalarLms 實際算出來的兩步）
  const rows = [0, 1].map((n) => ({
    n,
    w: h.w[n],
    yhat: h.w[n] * h.x,
    e: h.e[n],
    dw: h.mu * h.e[n] * h.x,
    next: h.w[n + 1],
  }))

  return (
    <header className="dash-hero" aria-labelledby="dash-title">
      <div>
        <div className="dash-kicker">Interactive Textbook &amp; Calibration Lab</div>
        <h1 id="dash-title" className="dash-title">
          LMS × Fractional-N PLL Calibration Lab
        </h1>
        <p className="dash-subtitle">從微積分一路走到 DTC / GOS / PHOS 校正、noise、spur 與 sign-off 的互動教科書。</p>
        <p>
          這個網站把 LMS / Sign-LMS 的數學、DTC-based fractional-N PLL 的校正架構，以及晶片驗證需要的 noise、bias、quantization、spur
          分析放在<strong>同一條推導鏈</strong>上。每一條曲線都由網站內的公式或模擬即時計算，可以調參、重跑、下載；每個結論都標明它是
          精確、近似，還是研究假說。
        </p>
        <div className="dash-thesis-line">
          <strong>最終教學主旨：</strong>成功的 calibration 必須<strong>同時</strong>滿足六個條件——
          <div className="dash-thesis-pills">
            {SIX_CONDITIONS.map((c) => (
              <button key={c.id} type="button" className="dash-pill" onClick={() => scrollToId(`dash-cond-${c.id}`)}>
                <span className="dash-pill-n" style={{ background: `var(${c.color})` }}>
                  {c.n}
                </span>
                {c.zh}
              </button>
            ))}
          </div>
        </div>
        <div className="dash-stats">
          <div className="dash-stat">
            <div className="dash-stat-v">{chapters}</div>
            <div className="dash-stat-l">章節（含案例）</div>
          </div>
          <div className="dash-stat">
            <div className="dash-stat-v">{tests.byId.length}</div>
            <div className="dash-stat-l">Acceptance tests，{tests.counts.pass} 個 verified</div>
          </div>
          <div className="dash-stat">
            <div className="dash-stat-v">{errata.total}</div>
            <div className="dash-stat-l">規格勘誤（high {errata.bySeverity.high}）</div>
          </div>
          <div className="dash-stat">
            <div className="dash-stat-v">3</div>
            <div className="dash-stat-l">學習模式，共用同一計算核心</div>
          </div>
        </div>
      </div>

      <aside className="dash-start" aria-labelledby="dash-start-title">
        <div className="dash-start-label">從這裡開始</div>
        <h2 id="dash-start-title">{start?.nav ?? '00 入門'}</h2>
        <p className="small">
          黑盒子 <Tex>{'y=ax'}</Tex>，你只看得到輸入輸出、不知道 <Tex>{'a'}</Tex>。LMS 只做三件事：
          <strong>預測 → 比較 → 修正</strong>。用 <Tex>{`a=${h.a},\\ x=${h.x},\\ w_0=${h.w[0]},\\ \\mu=${h.mu}`}</Tex>{' '}
          手算兩步（數字由網站的 LMS 程式實際算出）：
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <Tex>{'n'}</Tex>
                </th>
                <th>
                  <Tex>{'\\hat y=w_nx'}</Tex>
                </th>
                <th>
                  <Tex>{'e_n=y-\\hat y'}</Tex>
                </th>
                <th>
                  <Tex>{'\\mu e_nx'}</Tex>
                </th>
                <th>
                  <Tex>{'w_{n+1}'}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.n}>
                  <td>{r.n}</td>
                  <td>{fmt(r.yhat)}</td>
                  <td>{fmt(r.e)}</td>
                  <td>{fmt(r.dw)}</td>
                  <td>
                    <strong>{fmt(r.next)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          每一步誤差都乘上 <Tex>{`p=1-\\mu x^2=${fmt(h.pole)}`}</Tex>，所以 <Tex>{'w_n\\to a'}</Tex>。接下來 {chapters - 1} 章就是在問：換成 PLL
          裡的 1-bit comparator、相位、雜訊與 6-bit 暫存器之後，這件事還成立嗎？
        </p>
        {start && (
          <Link to={start.path} className="dash-cta">
            開始第一課 →
          </Link>
        )}
      </aside>

      <div style={{ gridColumn: '1 / -1', minWidth: 0 }}>
        <Callout kind="info" title={null}>
          <SourceTag kind="illustrative" /> 本站所有晶片數值（例如 <Tex>{'\\sigma_v=100\\,\\mathrm{fs}'}</Tex>、
          <Tex>{'f_s=4\\,\\mathrm{GHz}'}</Tex>、<Tex>{'f_{\\mathrm{out}}=13\\,\\mathrm{GHz}'}</Tex>）都是 <strong>illustrative 示例</strong>
          ，不是任何晶片的量測數據；它們只用來說明公式與趨勢。
        </Callout>
        <nav className="dash-toc" aria-label="本頁段落">
          {TOC.map((t) => (
            <button key={t.id} type="button" onClick={() => scrollToId(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  )
})
