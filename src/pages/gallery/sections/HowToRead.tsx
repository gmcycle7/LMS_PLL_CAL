import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Callout, ClaimTag, ModeGate, ModelLevel, Prereq, SourceTag, TestBadge, Tex, TexBlock } from '@/components'
import { ALL_PRESETS, presetHref } from '@/app/presets'
import { fixedXPole, runScalarLms } from '@/simulation/models/lms'
import { detectionWindow, matchCoverage } from '../consistency'
import { acceptHalfWidth, decimalsOf, EXACT_REL, extractNumbers, findExpectedMatch, PRECISE_REL, rawToTex, texArg, texNum, texRepr, type ExtractedNumber } from '../format'
import { Diagram, Steps } from '../common'
import { CHART_LMS_LOOP, CHART_MATCH_DECISION } from '../diagrams'

/** §2 可靠度示範用的假想誤差範圍 ε_max（10%） */
export const DEMO_EPS_MAX = 0.1

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const t = (x: number, sig = 6) => texNum(x, sig)
const pct = (x: number, sig = 3) => (Number.isFinite(x) ? `${texNum(100 * x, sig)}\\%` : '\\text{—}')

export interface HandRow {
  n: number
  w: number
  pred: number
  y: number
  e: number
  step: number
  wNext: number
  deltaNext: number
}

/** 規格 §1.2 的手算表：每一列都由 runScalarLms 的輸出組出來（不是手打的數字） */
export function handRows(a: number, w0: number, x: number, mu: number, steps = 3): { rows: HandRow[]; pole: number; w: Float64Array } {
  const run = runScalarLms({ variant: 'conventional', a, w0, mu, steps, x: { kind: 'fixed', value: x }, noiseSigma: 0 })
  const rows: HandRow[] = []
  for (let n = 0; n < steps; n++) {
    rows.push({ n, w: run.w[n], pred: run.w[n] * x, y: a * x, e: run.e[n], step: mu * run.e[n] * x, wNext: run.w[n + 1], deltaNext: a - run.w[n + 1] })
  }
  return { rows, pole: fixedXPole(mu, x), w: run.w }
}

interface DemoRow {
  label: string
  value: number
  hit: ExtractedNumber | null
}

/** §2：一張卡片怎麼讀（手算 #1），以及「重算值 vs 預期文字」比對的數學 */
export function HowToRead() {
  const p1 = ALL_PRESETS.find((p) => p.galleryIndex === 1)
  // 輸入條件：有 #1 的 preset 就用它的 params；沒有時用規格 §1.2 / T01 的輸入（這些是「輸入」，結果一律由 runScalarLms 算）
  const a = num(p1?.params.a, 3)
  const w0 = num(p1?.params.w0, 1)
  const x = num(p1?.params.x, 2)
  const mu = num(p1?.params.mu, 0.1)
  const hand = useMemo(() => handRows(a, w0, x, mu, 3), [a, w0, x, mu])
  const expected = p1?.expected ?? ''
  const nums = useMemo(() => extractNumbers(expected), [expected])
  const demo: DemoRow[] = useMemo(
    () =>
      [
        { label: 'w_1', value: hand.w[1] },
        { label: 'w_2', value: hand.w[2] },
        { label: 'p=1-\\mu x^2', value: hand.pole },
      ].map((d) => ({ ...d, hit: findExpectedMatch(d.value, nums, 1.001, true) })),
    [hand, nums],
  )
  const w2 = demo[1]
  const w2Win = w2.hit ? detectionWindow(w2.value, w2.hit, 1) : null
  // 文字中寫成「短數字」（不夠精確，只接受相等）的必備數值：由目前的預期文字當場判斷，不寫死是哪幾個
  const shortOnes = demo.filter((d) => d.hit && d.hit.tol > PRECISE_REL * Math.abs(d.hit.value))
  // 文字中 w₂ 的寫法（讀自 preset；#1 缺少時退回重算值取 3 位有效數字）
  const w2Text = w2.hit ? rawToTex(w2.hit.raw) : texNum(hand.w[2], 3)

  return (
    <section aria-labelledby="gal-s2" className="gal-section">
      <h2 id="gal-s2">2｜先算一次：一張卡片怎麼讀</h2>
      <p>
        用規格 §19.2 的第 1 個 preset 當例子：<Tex>{`w_0=${t(w0)},\\ a=${t(a)},\\ x=${t(x)},\\ \\mu=${t(mu)}`}</Tex>。黑盒子的輸出是 <Tex>{'y=ax'}</Tex>，你不知道 <Tex>{'a'}</Tex>，只能拿自己的猜測{' '}
        <Tex>{'w'}</Tex> 去預測、比較、修正。
      </p>

      <h3>2.1 手算三步</h3>
      <div className="c-tag-row">
        <ModelLevel level="L0" />
        <ClaimTag kind="exact" />
        <SourceTag kind="illustrative" />
        <TestBadge id="T01" />
      </div>
      <Diagram
        chart={CHART_LMS_LOOP}
        caption="preset #1 的 LMS 迴路：預測、比較、修正，再把新的猜測留到下一步。藍色方塊決定每次修正多少。"
        ariaLabel="LMS 迴路方塊圖：輸入經黑盒子得到量測值、經目前的猜測得到預測值，兩者相減得到誤差，乘上步長與輸入後加回猜測"
      >
        <p>
          <strong>先看</strong>左半邊的兩條路：同一個輸入 <Tex>{'x'}</Tex> 往上經過黑盒子，得到量測值 <Tex>{'y_n=ax'}</Tex>；往下乘上你目前的猜測 <Tex>{'w_n'}</Tex>，得到預測值 <Tex>{'w_nx'}</Tex>
          。兩者在加法點相減（量測為正、預測為負），就是誤差 <Tex>{'e_n'}</Tex>。
        </p>
        <p>
          <strong>再看</strong>右半邊：誤差乘上藍色方塊的 <Tex>{'\\mu x'}</Tex> 變成修正量，加回原本的 <Tex>{'w_n'}</Tex> 得到新的猜測 <Tex>{'w_{n+1}'}</Tex>；<Tex>{'z^{-1}'}</Tex>{' '}
          是「延遲一步」，表示新的猜測留到下一步才拿去預測。<Tex>{'\\mu'}</Tex> 叫步長（learning rate）：每次只修正誤差的一部分。圖上的兩個加法點，就是下面這兩條式子。
        </p>
      </Diagram>
      <TexBlock>{String.raw`e_n=y_n-w_nx=(a-w_n)\,x,\qquad w_{n+1}=w_n+\mu\,e_n\,x`}</TexBlock>
      <div className="table-wrap">
        <table className="gal-table gal-num-table">
          <caption className="small muted">下表每一格都由 <code>runScalarLms</code>（網站 LMS Playground 用的同一個函式）算出</caption>
          <thead>
            <tr>
              <th>
                <Tex>{'n'}</Tex>
              </th>
              <th>
                目前猜測 <Tex>{'w_n'}</Tex>
              </th>
              <th>
                預測 <Tex>{'w_nx'}</Tex>
              </th>
              <th>
                量測 <Tex>{'y_n=ax'}</Tex>
              </th>
              <th>
                誤差 <Tex>{'e_n'}</Tex>
              </th>
              <th>
                修正量 <Tex>{'\\mu e_nx'}</Tex>
              </th>
              <th>
                新猜測 <Tex>{'w_{n+1}'}</Tex>
              </th>
              <th>
                剩餘誤差 <Tex>{'\\delta_{n+1}=a-w_{n+1}'}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            {hand.rows.map((r) => (
              <tr key={r.n}>
                <td>{r.n}</td>
                {[r.w, r.pred, r.y, r.e, r.step, r.wNext, r.deltaNext].map((v, i) => (
                  <td key={i}>
                    <Tex>{t(v, 8)}</Tex>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Steps
        title="為什麼誤差每一步都乘上同一個數"
        steps={[
          { tex: String.raw`e_n=y_n-w_nx=ax-w_nx=(a-w_n)\,x=\delta_n\,x`, why: '把 $y_n=ax$ 代入；定義 $\\delta_n=a-w_n$（真值減猜測）。' },
          { tex: String.raw`w_{n+1}=w_n+\mu\,e_n\,x=w_n+\mu x^2\,\delta_n`, why: '把上一行的 $e_n$ 代入更新式。' },
          { tex: String.raw`\delta_{n+1}=a-w_{n+1}=a-w_n-\mu x^2\delta_n=(1-\mu x^2)\,\delta_n`, why: '兩邊用 $a$ 去減；$a-w_n$ 就是 $\\delta_n$，提出公因式。' },
          {
            tex: `p=1-\\mu x^2=1-${texArg(mu)}\\times${texArg(x)}^2=${t(hand.pole)}`,
            why: '代入這個 preset 的數字（由 fixedXPole 算出）：每一步誤差剩下 $p$ 倍，這個倍數叫 pole。',
          },
          {
            tex: `\\delta_n=p^{\\,n}\\delta_0:\\quad ${t(a - w0)}\\ \\to\\ ${hand.rows.map((r) => t(r.deltaNext, 6)).join('\\ \\to\\ ')}`,
            why: '等比數列；$|p|<1$ 所以誤差趨近 0，也就是 $w_n\\to a$。',
          },
        ]}
        result={String.raw`\delta_n=(1-\mu x^2)^n\,\delta_0,\qquad \text{收斂}\iff 0<\mu<\frac{2}{x^2}`}
      />
      <Prereq title="pole 與等比數列：為什麼「$|p|<1$」就是收斂">
        <p>
          數列 <Tex>{'\\delta_{n+1}=p\\,\\delta_n'}</Tex> 的解是 <Tex>{'\\delta_n=p^n\\delta_0'}</Tex>（每一步都乘 <Tex>{'p'}</Tex>）。高中學過：<Tex>{'|p|<1'}</Tex> 時 <Tex>{'p^n\\to0'}</Tex>；
          <Tex>{'|p|>1'}</Tex> 時 <Tex>{'|p^n|\\to\\infty'}</Tex>；<Tex>{'p<0'}</Tex> 時正負交替。控制理論把這個「每步乘上的倍數」叫做 <strong>pole（極點）</strong>；之後遇到多個狀態時，倍數變成一個矩陣{' '}
          <Tex>{'\\mathbf A'}</Tex>，要看的是它的每個 <strong>eigenvalue（特徵值）</strong>是不是都在複數平面的單位圓 <Tex>{'|z|<1'}</Tex> 內。細節在{' '}
          <Link to="/ch/03">第 3 章</Link>與<Link to="/ch/08">第 8 章</Link>。
        </p>
      </Prereq>

      <h3>2.2 卡片上的每個部分</h3>
      <dl className="gal-anatomy">
        <dt>標題、說明</dt>
        <dd>各章作者寫的文字，原樣顯示。</dd>
        <dt>層級、來源、T-id 徽章</dt>
        <dd>
          模型層級 L0–L6（規格 §15.1）告訴你這個例子用了多簡化的模型；來源標籤說明數字是示意（illustrative）還是模擬（simulation）；T-id 徽章的狀態讀自{' '}
          <code>src/data/verification-status.json</code>，只有 TypeScript 與 Python golden 兩邊的測試都通過才顯示 verified。
        </dd>
        <dt>預期結果</dt>
        <dd>載入後應該看到的數字。它是文字，由人撰寫——所以需要 §2.3 的檢查。</dd>
        <dt>載入並執行</dt>
        <dd>
          到原頁面並套用參數{p1 ? <>（例如 <Link to={presetHref(p1)}>#1 → LMS Playground</Link>）</> : null}。完整的圖、Monte Carlo 與匯出都在那裡。
        </dd>
        <dt>即時預覽</dt>
        <dd>在 Gallery 內直接呼叫模型函式重算關鍵數字，附上代入數字的逐步推導、一張小圖，以及和預期文字的逐項比對。</dd>
      </dl>

      <h3>2.3 怎麼判斷「重算值」和「預期文字」一致</h3>
      <p>
        文字寫 <Tex>{`w_2=${w2Text}`}</Tex>，電腦算出 <Tex>{`\\hat y=${texRepr(hand.w[2])}`}</Tex>。兩者「一樣」嗎？要先講清楚文字的 <Tex>{w2Text}</Tex> 代表多大的範圍。
      </p>
      <p>
        以下把模型函式當場算出來的值記為 <Tex>{'\\hat y'}</Tex>（<strong>重算值</strong>），把預期文字裡寫的那個數字記為 <Tex>{'y_{\\mathrm t}'}</Tex>（t 代表 text）。判定分三步，先看流程，再看每一步的推導：
      </p>
      <Diagram
        chart={CHART_MATCH_DECISION}
        caption="相符判據的判定流程：先由文字的小數位數算出捨入半寬，再決定接受半寬，最後比較重算值與文字數字的差距。綠色是相符，紅色是對不上。"
        ariaLabel="相符判據流程圖：捨入半寬、是否夠精確、是否必備數值、接受半寬、重算值與文字數字的差距是否在接受半寬內"
      >
        <p>
          <strong>先看</strong>左上角：文字數字 <Tex>{'y_{\\mathrm t}'}</Tex> 寫到小數 <Tex>{'n_{\\mathrm d}'}</Tex> 位（科學記號的指數是 <Tex>{'e'}</Tex>），最後一位的半個單位就是
          <strong>捨入半寬</strong> <Tex>{'\\Delta_{\\mathrm t}'}</Tex>。<strong>再看</strong>第一個菱形：<Tex>{'\\Delta_{\\mathrm t}'}</Tex> 不超過 <Tex>{'|y_{\\mathrm t}|'}</Tex> 的{' '}
          <Tex>{`${texNum(100 * PRECISE_REL)}\\%`}</Tex> 才算「夠精確」，這時<strong>接受半寬</strong> <Tex>{'W=k_{\\mathrm{tol}}\\Delta_{\\mathrm t}'}</Tex>（<Tex>{'k_{\\mathrm{tol}}'}</Tex>{' '}
          是容差倍數，原意是 1）；不夠精確的短數字只在「必備數值」時才比，而且要求重算值就等於它。
        </p>
        <p>
          圖上最後一個菱形就是 F-GA.1 的不等式 <Tex>{'|\\hat y-y_{\\mathrm t}|\\le W'}</Tex>；兩條進入它的路徑只差在 <Tex>{'W'}</Tex> 取哪一個值。
        </p>
      </Diagram>
      <Steps
        title="從四捨五入的定義推出相符判據"
        open
        steps={[
          {
            tex: String.raw`y_{\mathrm t}=m\times10^{e},\ m\ \text{寫到小數}\ n_{\mathrm d}\ \text{位}\;\Rightarrow\;\text{真值}\in\big[y_{\mathrm t}-\Delta_{\mathrm t},\ y_{\mathrm t}+\Delta_{\mathrm t}\big),\quad \Delta_{\mathrm t}=\tfrac12\,10^{\,e-n_{\mathrm d}}`,
            why: '四捨五入的定義：所有會被寫成同一個數字的實數，形成寬度為「最後一位的一個單位」的區間；$\\Delta_{\\mathrm t}$ 是它的一半（捨入半寬）。',
          },
          {
            tex: String.raw`\text{相符}\iff|\hat y-y_{\mathrm t}|\le k_{\mathrm{tol}}\,\Delta_{\mathrm t}`,
            why: '重算值落在那個區間內，文字就是它的正確捨入。$k_{\\mathrm{tol}}=1$ 是原意；程式用 $1.001$ 吸收浮點誤差。',
          },
          {
            tex: w2.hit
              ? `y_{\\mathrm t}=${rawToTex(w2.hit.raw)},\\ n_{\\mathrm d}=${decimalsOf(w2.hit)}\\Rightarrow\\Delta_{\\mathrm t}=${t(w2.hit.tol)};\\quad|\\hat y-y_{\\mathrm t}|=${t(Math.abs(w2.value - w2.hit.value), 3)}\\le${t(w2.hit.tol)}\\ \\checkmark`
              : String.raw`\text{（目前找不到 }w_2\text{ 對應的文字數字）}`,
            why: '代入 #1 的數字（由 extractNumbers 與 findExpectedMatch 當場算出）：差距只有浮點捨入的大小。',
          },
          {
            tex: String.raw`\Delta_{\mathrm t}\le ${PRECISE_REL}\,|y_{\mathrm t}|\quad(\text{約 3 位有效數字以上})`,
            why: '額外要求「夠精確」：像「$2$」這種數字，$1.5$ 到 $2.5$ 都會被寫成它，對得上也不算證據。',
          },
          {
            tex: String.raw`\text{短數字（不夠精確）}:\quad |\hat y-y_{\mathrm t}|\le ${texNum(EXACT_REL)}\,\max(1,|y_{\mathrm t}|)`,
            why: '教科書例子裡的短數字多半是精確值（$1.8=9/5$、$0.6=1-0.4$）。對必備數值，Gallery 接受「重算值就等於它」，但不接受「四捨五入後剛好是它」。',
          },
        ]}
      />
      <TexBlock id="F-GA.1">{String.raw`\text{相符}\iff|\hat y-y_{\mathrm t}|\le W,\qquad W=\begin{cases}k_{\mathrm{tol}}\,\Delta_{\mathrm t},&\Delta_{\mathrm t}\le0.01\,|y_{\mathrm t}|\ \ (\text{夠精確})\\[2pt]10^{-9}\max(1,|y_{\mathrm t}|),&\text{否則（只接受相等；限必備數值）}\end{cases}`}</TexBlock>
      <div className="c-tag-row">
        <ClaimTag kind="exact" />
        <span className="small muted">判據本身是定義；它檢查的是「文字是不是重算值的正確捨入」，不是「模型對不對」。</span>
      </div>
      {p1 ? (
        <div className="table-wrap">
          <table className="gal-table gal-num-table">
            <caption className="small muted">
              #1 的預期文字經 <code>extractNumbers</code> 抽出 {nums.length} 個數字；下表是三個必備數值的比對（全部當場計算）
            </caption>
            <thead>
              <tr>
                <th>量</th>
                <th>
                  重算值 <Tex>{'\\hat y'}</Tex>
                </th>
                <th>
                  文字 <Tex>{'y_{\\mathrm t}'}</Tex>
                </th>
                <th>
                  捨入半寬 <Tex>{'\\Delta_{\\mathrm t}'}</Tex>
                </th>
                <th>夠精確？</th>
                <th>
                  接受半寬 <Tex>{'W'}</Tex>
                </th>
                <th>
                  <Tex>{'|\\hat y-y_{\\mathrm t}|'}</Tex>
                </th>
                <th>結果</th>
              </tr>
            </thead>
            <tbody>
              {demo.map((d) => (
                <tr key={d.label} data-demo={d.label}>
                  <td>
                    <Tex>{d.label}</Tex>
                  </td>
                  <td>
                    <Tex>{texRepr(d.value)}</Tex>
                  </td>
                  <td>{d.hit ? <Tex>{rawToTex(d.hit.raw)}</Tex> : '—'}</td>
                  <td>{d.hit ? <Tex>{t(d.hit.tol)}</Tex> : '—'}</td>
                  <td>{d.hit ? (d.hit.tol <= PRECISE_REL * Math.abs(d.hit.value) ? '是' : '否（短數字）') : '—'}</td>
                  <td>{d.hit ? <Tex>{t(acceptHalfWidth(d.hit, 1, true), 3)}</Tex> : '—'}</td>
                  <td>{d.hit ? <Tex>{t(Math.abs(d.value - d.hit.value), 3)}</Tex> : '—'}</td>
                  <td>{d.hit ? <span className="gal-match gal-match-ok">✓ 相符</span> : <span className="gal-match gal-match-bad">✗ 找不到</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Callout kind="danger" title="缺少規格 §19.2 #1 的 preset">
          找不到 <code>galleryIndex: 1</code> 的 preset，所以這裡沒有預期文字可以示範比對；上面的手算表仍由 <code>runScalarLms</code> 以規格 §1.2 的輸入算出。
        </Callout>
      )}
      <ModeGate min="engineer">
        <details className="gal-details">
          <summary>抽數字的規則（科學記號、百分比、千分位、不算數的編號）</summary>
          <ul className="small">
            <li>
              科學記號：<Tex>{'4.0841\\times10^{-5}'}</Tex> 的 <Tex>{'n_{\\mathrm d}=4,\\ e=-5'}</Tex>，所以 <Tex>{'\\Delta_{\\mathrm t}=\\tfrac12 10^{-9}'}</Tex>。
            </li>
            <li>
              百分比：<Tex>{'78.75\\%'}</Tex> 同時當作 <Tex>{'78.75'}</Tex> 與 <Tex>{'0.7875'}</Tex>（半寬也除以 100），因為模型輸出的機率是 0 到 1 之間的數。
            </li>
            <li>
              千分位逗號：<Tex>{'42{,}499'}</Tex> 讀成 <Tex>{'42499'}</Tex>。
            </li>
            <li>
              緊接在英文字母、底線或 § 之後的數字（T06、E30、F-06.15、§12.1）是編號，不算結果；上標（<Tex>{'x^2'}</Tex> 的 2）也不算。
            </li>
            <li>符號是結論的一部分：<Tex>{'C=-0.25'}</Tex> 不會被 <Tex>{'+0.25'}</Tex> 對到。</li>
          </ul>
        </details>
      </ModeGate>

      {/* 2.4 在三種模式都顯示（F-GA.2、F-GA.3 的錨點要一直存在）；推導在 Beginner 模式預設收合 */}
      <>
        <h3>2.4 這個檢查有多可靠</h3>
        <p>
          假設模型被改壞了，算出來的不是 <Tex>{'\\hat y'}</Tex> 而是 <Tex>{'\\hat y(1+\\varepsilon)'}</Tex>（相對誤差 <Tex>{'\\varepsilon'}</Tex>）。檢查會不會抓到？
        </p>
        <Steps
          title="偵測視窗：解一個絕對值不等式"
          steps={[
            { tex: String.raw`|\hat y(1+\varepsilon)-y_{\mathrm t}|\le W`, why: '錯誤的重算值「仍然相符」的條件（$W$ 是 F-GA.1 的接受半寬）。' },
            { tex: String.raw`y_{\mathrm t}-W\le\hat y(1+\varepsilon)\le y_{\mathrm t}+W`, why: '絕對值不等式 $|u|\\le W$ 等價於 $-W\\le u\\le W$，再把 $y_{\\mathrm t}$ 移項。' },
            { tex: String.raw`\frac{y_{\mathrm t}-W-\hat y}{\hat y}\le\varepsilon\le\frac{y_{\mathrm t}+W-\hat y}{\hat y}`, why: '各項減去 $\\hat y$ 再除以 $\\hat y$（假設 $\\hat y>0$；負數時不等號方向對調）。' },
            {
              tex: w2.hit && w2Win ? `w_2:\\quad ${pct(w2Win.lo)}\\le\\varepsilon\\le${pct(w2Win.hi)}` : String.raw`\text{（#1 缺少，無法代入數字）}`,
              why: '代入 #1 的 $w_2$（detectionWindow 當場算出）：模型誤差超過這個範圍，$w_2$ 就對不上文字。',
            },
          ]}
        />
        <TexBlock id="F-GA.2">{String.raw`\boxed{\ \text{仍相符}\iff\frac{y_{\mathrm t}-W-\hat y}{\hat y}\le\varepsilon\le\frac{y_{\mathrm t}+W-\hat y}{\hat y}\quad(\hat y>0)\ }`}</TexBlock>
        <p>
          視窗內的誤差抓不到——那是文字精度的極限，文字寫幾位，檢查就只能精確到幾位。更麻煩的是<strong>巧合</strong>：錯誤的值雖然離開了原本那個數字，卻剛好對到文字裡的<em>另一個</em>數字。假設{' '}
          <Tex>{'\\varepsilon'}</Tex> 在 <Tex>{'[-\\varepsilon_{\\max},\\varepsilon_{\\max}]'}</Tex> 均勻分布，把每個文字數字的接受區間 <Tex>{'I_i'}</Tex> 都換到 <Tex>{'\\varepsilon'}</Tex> 軸，「仍然對到某個數字」的機率就是這些區間聯集的長度占全長的比例：
        </p>
        <TexBlock id="F-GA.3">{String.raw`P_{\text{match}}(\varepsilon_{\max})=\frac{1}{2\varepsilon_{\max}}\left|\,\bigcup_i I_i\cap[-\varepsilon_{\max},\varepsilon_{\max}]\right|,\qquad I_i=\left[\frac{y_{\mathrm t,i}-W_i-\hat y}{\hat y},\ \frac{y_{\mathrm t,i}+W_i-\hat y}{\hat y}\right]`}</TexBlock>
        <div className="c-tag-row">
          <ClaimTag kind="approx" />
          <span className="small muted">「誤差均勻分布」是假設，不是量測；它只用來比較不同文字的檢查強度。</span>
        </div>
        {p1 && (
          <div className="table-wrap">
            <table className="gal-table gal-num-table">
              <caption className="small muted">
                #1 的三個必備數值，<Tex>{`\\varepsilon_{\\max}=${pct(DEMO_EPS_MAX)}`}</Tex>（由 <code>detectionWindow</code> 與 <code>matchCoverage</code> 當場計算）
              </caption>
              <thead>
                <tr>
                  <th>量</th>
                  <th>
                    偵測視窗 <Tex>{'\\varepsilon'}</Tex>
                  </th>
                  <th>
                    <Tex>{'P'}</Tex>（對到原本的數字）
                  </th>
                  <th>
                    <Tex>{'P'}</Tex>（巧合對到別的數字）
                  </th>
                </tr>
              </thead>
              <tbody>
                {demo.map((d) => {
                  if (!d.hit) return null
                  const win = detectionWindow(d.value, d.hit, 1)
                  const cov = matchCoverage(d.value, nums, d.hit, DEMO_EPS_MAX, 1)
                  return (
                    <tr key={d.label} data-reliability={d.label}>
                      <td>
                        <Tex>{d.label}</Tex>
                      </td>
                      <td>
                        <Tex>{`[${pct(win.lo)},\\ ${pct(win.hi)}]`}</Tex>
                      </td>
                      <td>
                        <Tex>{pct(cov.self)}</Tex>
                      </td>
                      <td>
                        <Tex>{pct(cov.other)}</Tex>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="small">
          讀法：{w2.hit && w2Win ? (
            <>
              <Tex>{'w_2'}</Tex> 的文字寫到小數 {decimalsOf(w2.hit)} 位，所以落在 <Tex>{`[${pct(w2Win.lo)},\\ ${pct(w2Win.hi)}]`}</Tex> 以內的模型誤差看不出來；
            </>
          ) : null}
          {shortOnes.length > 0 && (
            <>
              {shortOnes.map((d, i) => (
                <span key={d.label}>
                  {i > 0 ? '、' : ''}
                  <Tex>{d.label}</Tex>
                </span>
              ))}{' '}
              在文字中是短數字（捨入半寬超過數值的 <Tex>{`${texNum(100 * PRECISE_REL)}\\%`}</Tex>），Gallery 要求重算值就等於它，所以視窗窄到只剩浮點誤差。
            </>
          )}
          要讓檢查更靈敏，唯一的辦法是 preset 作者把預期文字多寫幾位有效數字。
        </p>
      </>
      <Callout kind="warn" title="這個檢查不是什麼">
        <ul>
          <li>
            <strong>不是 Monte Carlo 驗證</strong>：Gallery 預覽只做封閉式或確定性的短模擬。隨機模擬與信賴區間在原頁面的 Web Worker 執行。
          </li>
          <li>
            <strong>不是獨立驗證</strong>：重算用的就是網站自己的模型函式。獨立的檢查是 Python golden model（<code>golden/</code>），結果顯示在 T-id 徽章與{' '}
            <a href="#/verification">驗證頁</a>。
          </li>
          <li>
            <strong>只看數字，不讀語意</strong>：文字說「收斂」而模型其實發散，比對不會知道——所以預覽另外用模型函式的結果給出判定（例如「<Tex>{'C\\le0'}</Tex>：更新極性錯誤」）。
          </li>
          <li>
            <strong>只有 12 個必備 preset 宣告了「必備數值」</strong>。其餘 preset 只報告找得到的相符數字，找不到不代表錯。
          </li>
        </ul>
      </Callout>
    </section>
  )
}
