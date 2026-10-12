import { useEffect, useMemo, useState } from 'react'
import { Tex, TexBlock, mathText, parseNumberInput, texNum, usePersistentState } from '@/components'
import { normSf } from '@/simulation/core'
import {
  HAND_CONSTANTS,
  PHI_DECIMALS,
  PHI_Z_MAX,
  dbConvert,
  dbRows,
  phiApproxRows,
  phiGrid,
  phiLinearLimit,
  phiLookup,
  phiLookupSteps,
  quantileRows,
  ratioRows,
  slopeOverestimateLimit,
} from '../tools'

const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean'
const fix = (x: number, places = PHI_DECIMALS): string => x.toFixed(places)
/** 帶正負號的誤差（TeX） */
const signed = (x: number, sig = 2): string => (x > 0 ? `+${texNum(x, sig)}` : texNum(x, sig))

/** Φ(z) 表：z = 0 … 3，每 0.1 一格（normCdf 計算，4 位小數）。練習卷的附錄也用這一張。 */
export function PhiTable() {
  const grid = useMemo(() => phiGrid(), [])
  return (
    <div className="table-wrap">
      <table className="wb-phi-table">
        <caption>
          <Tex>{String.raw`\Phi(z) = P(Z \le z),\quad Z\sim\mathcal N(0,1)`}</Tex>
          ：列是 <Tex>z</Tex> 的小數第一位，欄是整數部分。例如 <Tex>{String.raw`\Phi(1.3)`}</Tex> 在「.3」那一列、「1」那一欄。
        </caption>
        <thead>
          <tr>
            <th scope="col">
              <Tex>z</Tex>
            </th>
            {[0, 1, 2, 3].map((u) => (
              <th key={u} scope="col" className="num">
                {u}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((row) => (
            <tr key={row.tenths}>
              <th scope="row">.{row.tenths}</th>
              {row.cells.map((c, u) => (
                <td key={u} className="num" data-z={c ? c.z : undefined}>
                  {c ? fix(c.shown) : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 常用常數表（數值由 Math.* 算出） */
export function ConstantsTable() {
  return (
    <div className="table-wrap">
      <table className="wb-const-table">
        <thead>
          <tr>
            <th scope="col">常數</th>
            <th scope="col" className="num">
              數值
            </th>
            <th scope="col">用在哪裡</th>
          </tr>
        </thead>
        <tbody>
          {HAND_CONSTANTS.map((c) => (
            <tr key={c.key}>
              <td className="nowrap">
                <Tex>{c.tex}</Tex>
              </td>
              <td className="num">
                <Tex>{texNum(c.value, c.digits)}</Tex>
              </td>
              <td>{mathText(c.use)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 查表＋內插的小工具：輸入 z，照手算的做法一步一步內插，並與 normCdf 的值比較。 */
function PhiLookupTool() {
  const [text, setText] = useState('0.37')
  const z = parseNumberInput(text)
  const lookup = useMemo(() => (z === null ? null : phiLookup(z)), [z])
  const steps = useMemo(() => (lookup ? phiLookupSteps(lookup) : []), [lookup])
  return (
    <div className="wb-tool-calc">
      <label className="wb-inline-field">
        <span>
          查 <Tex>{String.raw`\Phi(z)`}</Tex>，<Tex>z =</Tex>
        </span>
        <input type="text" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} aria-label="要查表的 z" aria-invalid={z === null} />
      </label>
      {lookup === null ? (
        <p className="small wb-bad">請輸入數字，例如 0.37 或 -1.25。</p>
      ) : (
        <>
          <ol className="c-steps-list wb-lookup-steps">
            {steps.map((s, i) => (
              <li key={i} className="c-step">
                <div className="c-step-tex">
                  <TexBlock>{s.tex}</TexBlock>
                </div>
                <div className="c-step-why">{mathText(s.why)}</div>
              </li>
            ))}
          </ol>
          <p className="small muted">
            對照：網站用 <code>normCdf</code> 算出 <Tex>{String.raw`\Phi(${texNum(lookup.z, 6)}) = ${texNum(lookup.exact, 6)}`}</Tex>
            {!lookup.outOfTable && (
              <>
                ，查表內插的誤差是 <Tex>{signed(lookup.error)}</Tex>
              </>
            )}
            。
          </p>
        </>
      )}
    </div>
  )
}

/** dB ↔ 倍數的小工具 */
function DbTool() {
  const [text, setText] = useState('-3')
  const db = parseNumberInput(text)
  const row = db === null ? null : dbConvert(db)
  return (
    <div className="wb-tool-calc">
      <label className="wb-inline-field">
        <span>換算</span>
        <input type="text" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} aria-label="要換算的 dB 值" aria-invalid={db === null} />
        <span>
          <Tex>{String.raw`\mathrm{dB}`}</Tex>
        </span>
      </label>
      {row === null ? (
        <p className="small wb-bad">請輸入數字，例如 -3 或 20。</p>
      ) : (
        <TexBlock>
          {String.raw`\begin{aligned}10^{${texNum(row.db, 6)}/10} &= ${texNum(row.power, 5)}\ \text{（功率比）}\\ 10^{${texNum(row.db, 6)}/20} &= ${texNum(row.amplitude, 5)}\ \text{（振幅比）}\end{aligned}`}
        </TexBlock>
      )}
    </div>
  )
}

/**
 * 「手算工具」：隨時可展開的參考框（Φ 表、小 |z| 近似、常數、dB 換算）。
 * 展開／收合狀態記在 localStorage（不可用時只是不記）。
 */
export function HandTools() {
  const [open, setOpen] = usePersistentState<boolean>('lmspll.workbook.toolsOpen', true, isBoolean)
  const approx = useMemo(() => phiApproxRows(), [])
  const quantiles = useMemo(() => quantileRows(), [])
  const dbs = useMemo(() => dbRows(), [])
  const ratios = useMemo(() => ratioRows(), [])
  const absLimit = useMemo(() => phiLinearLimit(1e-3), [])
  const rel1 = useMemo(() => slopeOverestimateLimit(0.01), [])
  const rel5 = useMemo(() => slopeOverestimateLimit(0.05), [])
  return (
    <details className="wb-tools" id="wb-tools" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span className="wb-tools-title">手算工具</span>
        <span className="small muted">
          <Tex>{String.raw`\Phi(z)`}</Tex> 表、小 <Tex>|z|</Tex> 近似、常用常數、dB 換算（全部由程式當場算出）
        </span>
      </summary>

      <div className="wb-tools-grid">
        <section className="wb-tool" aria-labelledby="wb-tool-phi">
          <h4 id="wb-tool-phi">
            ① <Tex>{String.raw`\Phi(z)`}</Tex> 表（標準常態累積分布）
          </h4>
          <PhiTable />
          <ul className="small wb-tool-notes">
            <li>
              負的 <Tex>z</Tex>：<Tex>{String.raw`\Phi(-z) = 1 - \Phi(z)`}</Tex>。
            </li>
            <li>
              落在 <Tex>{String.raw`\pm z`}</Tex> 之內的機率：<Tex>{String.raw`P(|Z|\le z) = 2\Phi(z) - 1 = \operatorname{erf}(z/\sqrt{2})`}</Tex>；計算機有{' '}
              <Tex>{String.raw`\operatorname{erf}`}</Tex> 鍵時用 <Tex>{String.raw`\Phi(z) = \tfrac12\bigl[1 + \operatorname{erf}(z/\sqrt2)\bigr]`}</Tex>。
            </li>
            <li>
              comparator：誤差 <Tex>s</Tex>、雜訊 <Tex>{String.raw`\sigma_v`}</Tex> 時 <Tex>{String.raw`P(q=+1) = \Phi(s/\sigma_v)`}</Tex>、
              <Tex>{String.raw`E[q] = 2\Phi(s/\sigma_v) - 1`}</Tex>。
            </li>
            <li>
              <Tex>{String.raw`|z| > ${texNum(PHI_Z_MAX, 2)}`}</Tex>：<Tex>{String.raw`\Phi`}</Tex> 與 1 的差小於{' '}
              <Tex>{String.raw`1 - \Phi(${texNum(PHI_Z_MAX, 2)}) = ${texNum(normSf(PHI_Z_MAX), 3)}`}</Tex>。
            </li>
          </ul>
          <PhiLookupTool />
          <div className="table-wrap">
            <table className="wb-mini-table">
              <caption>
                反查（給機率求 <Tex>z</Tex>，由 <code>normInv</code> 計算）
              </caption>
              <tbody>
                <tr>
                  <th scope="row">
                    <Tex>{String.raw`\Phi(z)`}</Tex>
                  </th>
                  {quantiles.map((r) => (
                    <td key={r.p} className="num">
                      {texNum(r.p, 4)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">
                    <Tex>z</Tex>
                  </th>
                  {quantiles.map((r) => (
                    <td key={r.p} className="num">
                      {fix(r.z)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="wb-tool" aria-labelledby="wb-tool-approx">
          <h4 id="wb-tool-approx">
            ② 小 <Tex>|z|</Tex> 近似：不查表也能算
          </h4>
          {/* 排成兩行：寫成一行比桌機的半欄卡片寬 16px，框起來的結論會被切掉、底下多一條橫向捲軸 */}
          <TexBlock>{String.raw`\begin{aligned}\Phi(z) &= \frac12 + \frac{1}{\sqrt{2\pi}}\Bigl(z - \frac{z^3}{6} + \frac{z^5}{40} - \cdots\Bigr)\\[4pt] &\approx \boxed{\frac12 + \frac{z}{\sqrt{2\pi}}}\end{aligned}`}</TexBlock>
          <p className="small">
            只留第一項就是在 <Tex>z=0</Tex> 畫切線，斜率 <Tex>{String.raw`1/\sqrt{2\pi} = ${texNum(1 / Math.sqrt(2 * Math.PI), 4)}`}</Tex>。<Tex>{String.raw`z > 0`}</Tex> 時切線<strong>高估</strong>{' '}
            <Tex>{String.raw`\Phi`}</Tex>（下一項是負的；<Tex>{String.raw`z < 0`}</Tex> 時對稱地低估），誤差的大小約 <Tex>{String.raw`|z|^3/(6\sqrt{2\pi})`}</Tex>：
          </p>
          <div className="table-wrap">
            <table className="wb-approx-table">
              <thead>
                <tr>
                  <th scope="col" className="num">
                    <Tex>z</Tex>
                  </th>
                  <th scope="col" className="num">
                    <Tex>{String.raw`\Phi(z)`}</Tex> 精確
                  </th>
                  <th scope="col" className="num">
                    <Tex>{String.raw`\tfrac12 + z/\sqrt{2\pi}`}</Tex>
                  </th>
                  <th scope="col" className="num">
                    誤差
                  </th>
                  <th scope="col" className="num">
                    <Tex>{String.raw`2\Phi - 1`}</Tex> 高估
                  </th>
                  <th scope="col" className="num">
                    多留 <Tex>{String.raw`-z^3/6`}</Tex> 的誤差
                  </th>
                </tr>
              </thead>
              <tbody>
                {approx.map((r) => (
                  <tr key={r.z} data-z={r.z}>
                    <td className="num">{texNum(r.z, 3)}</td>
                    <td className="num">{fix(r.exact, 5)}</td>
                    <td className="num">{fix(r.linear, 5)}</td>
                    <td className="num">
                      <Tex>{signed(r.linearError)}</Tex>
                    </td>
                    <td className="num">
                      <Tex>{String.raw`${signed(100 * r.slopeOverestimate)}\%`}</Tex>
                    </td>
                    <td className="num">
                      <Tex>{signed(r.cubicError)}</Tex>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="small wb-tool-notes">
            <li>
              絕對誤差在 <Tex>{String.raw`10^{-3}`}</Tex> 以內的範圍：大約 <Tex>{String.raw`|z| \lesssim ${texNum(absLimit, 2)}`}</Tex>（剛好等於 <Tex>{String.raw`10^{-3}`}</Tex> 的點是{' '}
              <Tex>{String.raw`|z| = ${texNum(absLimit, 4)}`}</Tex>）。
            </li>
            <li>
              「<Tex>{String.raw`2\Phi-1`}</Tex> 高估」就是把 comparator 線性化成 <Tex>{String.raw`E[q]\approx K_q\,s`}</Tex>（
              <Tex>{String.raw`K_q = \sqrt{2/\pi}/\sigma_v`}</Tex>）時高估的比例：<Tex>{String.raw`|s|/\sigma_v = ${texNum(rel1, 3)}`}</Tex> 時高估 1%，
              <Tex>{String.raw`${texNum(rel5, 3)}`}</Tex> 時高估 5%。
            </li>
            <li>
              超過這個範圍就查左邊的表，或多留一項 <Tex>{String.raw`-z^3/6`}</Tex>（最右欄）。
            </li>
          </ul>
        </section>

        <section className="wb-tool" aria-labelledby="wb-tool-const">
          <h4 id="wb-tool-const">③ 常用常數與對數、角度換算</h4>
          <ConstantsTable />
          <p className="small muted">
            計算機只有 <Tex>{String.raw`\ln`}</Tex> 或只有 <Tex>{String.raw`\log_{10}`}</Tex> 時，用表中的 <Tex>{String.raw`\ln 10`}</Tex>、<Tex>{String.raw`\log_{10}e`}</Tex>{' '}
            互換；三角函數先確認計算機在 DEG 還是 RAD 模式。
          </p>
        </section>

        <section className="wb-tool" aria-labelledby="wb-tool-db">
          <h4 id="wb-tool-db">④ dB 換算</h4>
          {/* 排成兩行（定義一行、反過來解一行）：寫成一行約 630px，桌機的半欄卡片放不下。第二行用短箭頭與窄間距，手機（310px）也放得下 */}
          <TexBlock>{String.raw`\begin{gathered}\mathrm{dB} = 10\log_{10}\frac{P_2}{P_1} = 20\log_{10}\frac{A_2}{A_1}\\[4pt] \Leftrightarrow\ \ \frac{P_2}{P_1} = 10^{\mathrm{dB}/10},\ \ \frac{A_2}{A_1} = 10^{\mathrm{dB}/20}\end{gathered}`}</TexBlock>
          <div className="wb-db-tables">
            <div className="table-wrap">
              <table className="wb-db-table">
                <thead>
                  <tr>
                    <th scope="col" className="num">
                      <Tex>{String.raw`\mathrm{dB}`}</Tex>
                    </th>
                    <th scope="col" className="num">
                      功率比 <Tex>{String.raw`10^{\mathrm{dB}/10}`}</Tex>
                    </th>
                    <th scope="col" className="num">
                      振幅比 <Tex>{String.raw`10^{\mathrm{dB}/20}`}</Tex>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {dbs.map((r) => (
                    <tr key={r.db}>
                      <td className="num">
                        <Tex>{texNum(r.db, 3)}</Tex>
                      </td>
                      <td className="num">
                        <Tex>{texNum(r.power, 4)}</Tex>
                      </td>
                      <td className="num">
                        <Tex>{texNum(r.amplitude, 4)}</Tex>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-wrap">
              <table className="wb-db-table">
                <thead>
                  <tr>
                    <th scope="col" className="num">
                      倍數 <Tex>r</Tex>
                    </th>
                    <th scope="col" className="num">
                      <Tex>{String.raw`10\log_{10} r`}</Tex>（功率）
                    </th>
                    <th scope="col" className="num">
                      <Tex>{String.raw`20\log_{10} r`}</Tex>（振幅）
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ratios.map((r) => (
                    <tr key={r.tex}>
                      <td className="num">
                        <Tex>{r.tex}</Tex>
                      </td>
                      <td className="num">
                        <Tex>{String.raw`${texNum(r.db10, 4)}\ \mathrm{dB}`}</Tex>
                      </td>
                      <td className="num">
                        <Tex>{String.raw`${texNum(r.db20, 4)}\ \mathrm{dB}`}</Tex>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <DbTool />
          <p className="small muted">
            相乘的倍數換成 dB 之後相加；<Tex>{String.raw`\mathrm{dBc}`}</Tex> 是相對載波功率的 dB，<Tex>{String.raw`\mathrm{dBc/Hz}`}</Tex> 是每 1 Hz 頻寬內的相對功率。兩個<strong>不相關</strong>的功率相加要先換回倍數再加，不能直接加 dB。
          </p>
        </section>
      </div>
    </details>
  )
}

/**
 * 浮在右下角的「手算工具」：做題做到一半要查 Φ 表或常數時，不必捲回第 3 節。
 * 內容與第 3 節用同一組元件（同一份由程式算出的數字）；按 Esc 或「關閉」收起。列印時不出現。
 */
export function ToolsDock() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  return (
    <div className={`wb-dock wb-noprint${open ? ' open' : ''}`}>
      {open && (
        <div className="wb-dock-panel" id="wb-dock-panel" role="dialog" aria-label="手算工具（快速查表）">
          <div className="wb-dock-head">
            <strong>手算工具</strong>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              關閉
            </button>
          </div>
          <PhiTable />
          <p className="small">
            <Tex>{String.raw`\Phi(-z) = 1 - \Phi(z)`}</Tex>；<Tex>{String.raw`|z|`}</Tex> 很小時{' '}
            <Tex>{String.raw`\Phi(z)\approx \tfrac12 + z/\sqrt{2\pi}`}</Tex>（<Tex>{String.raw`1/\sqrt{2\pi} = ${texNum(1 / Math.sqrt(2 * Math.PI), 4)}`}</Tex>）。
          </p>
          <PhiLookupTool />
          <ConstantsTable />
          <DbTool />
        </div>
      )}
      <button type="button" className="btn btn-primary wb-dock-toggle" aria-expanded={open} aria-controls="wb-dock-panel" onClick={() => setOpen((v) => !v)}>
        {open ? '收起手算工具' : '手算工具'}
      </button>
    </div>
  )
}
