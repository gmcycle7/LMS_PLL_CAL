import { useMemo } from 'react'
import {
  ClaimTag,
  CodeBlock,
  Derivation,
  MetricTable,
  ModeGate,
  Section,
  StepDerivation,
  Tex,
  TexBlock,
  TestBadge,
} from '@/components'
import { useSettings } from '@/app/settings'
import { fixedXPole } from '@/simulation/models/lms'
import lmsSrc from '@/simulation/models/lms.ts?raw'
import {
  closedFormW,
  doubleMinusExact,
  exactLmsTrace,
  fractionToNumber,
  fractionToString,
  handCalcRows,
  ulpOf,
  type HandCalcParams,
} from '../model'
import { num, signed, texNum, texRes } from '../format'
import { ChapterHandCalc, ErratumNote, ErratumRef, Observe } from '../common'
import modelSrc from '../model.ts?raw'

/** 規格 §1.2 / T01 的手算例子。 */
export const HAND_CALC_PARAMS: HandCalcParams = { a: 3, w0: 1, x: 2, mu: 0.1, steps: 6 }

/**
 * 手算表本體（T01 render-level 測試直接渲染這個元件）：
 * 每一格都來自 handCalcRows → lms.ts 的 conventionalStep，不是手打的數字。
 */
export function HandCalcTable({ params = HAND_CALC_PARAMS }: { params?: HandCalcParams }) {
  const rows = useMemo(() => handCalcRows(params), [params])
  return (
    <div className="table-wrap">
      <table className="ch00-num-table" data-testid="ch00-hand-calc">
        <caption className="small muted">
          <Tex>{`a=${texNum(params.a)}\\ (\\text{未知}),\\ w_0=${texNum(params.w0)},\\ x=${texNum(params.x)},\\ y=ax=${texNum(params.a * params.x)},\\ \\mu=${texNum(params.mu)}`}</Tex>
        </caption>
        <thead>
          <tr>
            <th className="num">
              <Tex>{'n'}</Tex>
            </th>
            <th className="num">
              <Tex>{'w_n'}</Tex>
            </th>
            <th className="num">
              <Tex>{'\\hat y_n=w_nx'}</Tex>
            </th>
            <th className="num">
              <Tex>{'e_n=y-\\hat y_n'}</Tex>
            </th>
            <th className="num">
              <Tex>{'\\Delta w_n=\\mu e_nx'}</Tex>
            </th>
            <th className="num">
              <Tex>{'w_{n+1}'}</Tex>
            </th>
            <th className="num">
              <Tex>{'\\delta_n=a-w_n'}</Tex>
            </th>
            <th className="num">
              <Tex>{'\\delta_{n+1}/\\delta_n'}</Tex>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.n} data-testid={`ch00-hand-row-${r.n}`}>
              <td className="num">{r.n}</td>
              <td className="num" data-col="w">
                {num(r.w)}
              </td>
              <td className="num">{num(r.yhat)}</td>
              <td className="num" data-col="e">
                {num(r.e)}
              </td>
              <td className="num">{num(r.dw)}</td>
              <td className="num" data-col="wNext">
                {num(r.wNext)}
              </td>
              <td className="num" data-col="delta">
                {signed(r.delta)}
              </td>
              <td className="num">{Number.isFinite(r.ratio) ? num(r.ratio) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** §0.4 先算一次：手算表。 */
export function HandCalcSection() {
  const { atLeast } = useSettings()
  const p = HAND_CALC_PARAMS
  const rows = useMemo(() => handCalcRows(p), [p])
  const exact = useMemo(() => exactLmsTrace({ ...p, steps: 5 }), [p])
  // 每一列：double（conventionalStep）、最接近精確值的 double、兩者差幾個 ulp、與精確有理數的真正差距
  const exactRows = useMemo(
    () =>
      exact.map((f, n) => {
        const dbl = n === 0 ? p.w0 : rows[n - 1].wNext
        const nearest = fractionToNumber(f) // 兩個整數相除：IEEE 保證正確捨入到最接近的 double
        const ulps = (dbl - nearest) / ulpOf(nearest)
        return { n, f, dbl, nearest, ulps, diff: doubleMinusExact(dbl, f) }
      }),
    [exact, rows, p.w0],
  )
  const w2row = exactRows[2]
  const pole = fixedXPole(p.mu, p.x)
  const y = p.a * p.x
  const [r0, r1] = rows

  // 遞迴（conventionalStep）vs 封閉解 w_n = a − (a − w0)pⁿ
  const metrics = [1, 2, 5].map((n) => ({
    name: `$w_{${n}}$`,
    value: n === 1 ? r0.wNext : n === 2 ? r1.wNext : rows[n - 1].wNext,
    analytic: closedFormW(p.a, p.w0, p.x, p.mu, n),
    tolerance: 1e-12,
    toleranceMode: 'abs' as const,
    formulaId: 'F-00.6',
    claim: 'exact' as const,
    digits: 12,
    note: '遞迴（conventionalStep）vs 封閉解',
  }))

  return (
    <Section kind="example" level={2} id="ch00-hand" title="§0.4 先算一次：用數字手算兩步">
      <p>
        黑盒子裡其實是 <Tex>{`a=${texNum(p.a)}`}</Tex>（我們假裝不知道）。從很差的猜測 <Tex>{`w_0=${texNum(p.w0)}`}</Tex> 開始，
        每次都餵 <Tex>{`x=${texNum(p.x)}`}</Tex>，盒子回答 <Tex>{`y=${texNum(y)}`}</Tex>（先不加雜訊），學習率{' '}
        <Tex>{`\\mu=${texNum(p.mu)}`}</Tex>。 <TestBadge id="T01" />
      </p>

      <StepDerivation
        title={
          <>
            第 1 筆資料（<Tex>{'n=0'}</Tex>）
          </>
        }
        steps={[
          { tex: String.raw`\hat y_0=w_0x=${texNum(p.w0)}\times${texNum(p.x)}=${texNum(r0.yhat)}`, why: '① 預測：用目前的猜測乘上輸入。' },
          { tex: String.raw`e_0=y-\hat y_0=${texNum(y)}-${texNum(r0.yhat)}=${texNum(r0.e)}`, why: '② 比較：誤差為正，表示預測太小。' },
          {
            tex: String.raw`\Delta w_0=\mu e_0x=${texNum(p.mu)}\times${texNum(r0.e)}\times${texNum(p.x)}=${texNum(r0.dw)}`,
            why: (
              <>
                ③ 修正量：<Tex>{'e_0'}</Tex> 與 <Tex>{'x'}</Tex> 都是正的，所以 <Tex>{'w'}</Tex> 要變大。
              </>
            ),
          },
          {
            tex: String.raw`w_1=w_0+\Delta w_0=${texNum(p.w0)}+${texNum(r0.dw)}=${texRes(r0.wNext)}`,
            why: (
              <>
                更新：新的猜測離 <Tex>{`a=${texNum(p.a)}`}</Tex> 近了一些。
              </>
            ),
          },
        ]}
      />
      <StepDerivation
        title={
          <>
            第 2 筆資料（<Tex>{'n=1'}</Tex>）
          </>
        }
        steps={[
          {
            tex: String.raw`\hat y_1=w_1x=${texNum(r1.w)}\times${texNum(p.x)}=${texRes(r1.yhat)}`,
            why: (
              <>
                用剛剛更新過的 <Tex>{'w_1'}</Tex> 預測。
              </>
            ),
          },
          { tex: String.raw`e_1=y-\hat y_1=${texNum(y)}-${texNum(r1.yhat)}=${texNum(r1.e)}`, why: '誤差還是正的，但比上一次小。' },
          {
            tex: String.raw`\Delta w_1=\mu e_1x=${texNum(p.mu)}\times${texNum(r1.e)}\times${texNum(p.x)}=${texNum(r1.dw)}`,
            why: '誤差變小，修正量也跟著變小——這是 LMS 會「自動減速」的原因。',
          },
          { tex: String.raw`w_2=w_1+\Delta w_1=${texNum(r1.w)}+${texNum(r1.dw)}=${texNum(r1.wNext)}`, why: '第二次更新。' },
        ]}
      />

      <p>同樣的步驟重複下去，就得到下面的表（每一格都由程式即時算出）：</p>
      <HandCalcTable />
      <ErratumNote eid="E39">
        表中的參數誤差一律用 <Tex>{'\\delta_n=a-w_n'}</Tex>（全站約定），所以是{' '}
        {rows.slice(0, 3).map((r, i) => (
          <span key={r.n}>
            <Tex>{signed(r.delta).replace('−', '-')}</Tex>
            {i < 2 ? '、' : ''}
          </span>
        ))}
        ……。規格 §3 原本寫 <Tex>{'\\delta_n=w_n-a'}</Tex>，數值會正負相反；遞迴式 <Tex>{'\\delta_{n+1}=(1-\\mu x^2)\\delta_n'}</Tex>{' '}
        對兩種極性都成立。
      </ErratumNote>

      <Observe>
        <ul className="ch00-goals">
          <li>
            誤差 <Tex>{'e_n'}</Tex> 一直縮小：<Tex>{rows.slice(0, 4).map((r) => texNum(r.e, 4)).join('\\to ') + '\\to\\cdots'}</Tex>
          </li>
          <li>
            最後一欄是常數 <Tex>{`${texNum(pole)}`}</Tex>：每一步，剩下的誤差都只剩上一步的 <Tex>{`${num(pole * 100)}\\%`}</Tex>。這個數正是{' '}
            <Tex>{`1-\\mu x^2=1-${texNum(p.mu)}\\times${texNum(p.x)}^2=${texNum(pole)}`}</Tex>，§0.6 會證明它。
          </li>
          <li>
            <Tex>{'w_n'}</Tex> 越來越接近 <Tex>{texNum(p.a)}</Tex>，但（在這個 <Tex>{'\\mu'}</Tex> 下，<Tex>{'0<p<1'}</Tex>）任何有限步都不會剛好等於{' '}
            <Tex>{texNum(p.a)}</Tex>：<Tex>{'\\delta_n=p^n\\delta_0\\ne0'}</Tex>。
          </li>
        </ul>
      </Observe>

      <ChapterHandCalc id="HC-00.1">
        上面的表是網站替你算的。現在把 <Tex>{'w_0,\\ x,\\ y,\\ \\mu'}</Tex> 換成你自己的數字，先用紙筆照「預測 → 比較 → 修正」算兩步，再切到「看帶入過程」逐行對照；
        也可以按「換一題」讓網站出數字、你來算。
      </ChapterHandCalc>

      <TexBlock
        id="F-00.6"
        label={
          <>
            封閉解（固定 <Tex>{'x'}</Tex>、無雜訊）：不必一步一步算，也能直接知道第 <Tex>{'n'}</Tex> 步的 <Tex>{'w_n'}</Tex>
          </>
        }
      >
        {String.raw`w_n=a-(a-w_0)\,(1-\mu x^2)^n\;=\;${texNum(p.a)}-${texNum(p.a - p.w0)}\times${texNum(pole)}^{\,n}`}
      </TexBlock>

      <h3>這張表背後的程式碼</h3>
      <p>
        頁面上的數字不是另外手打的：表格呼叫下面這段 <code>conventionalStep</code>——它就是整個網站所有 LMS 模擬共用的同一份程式碼。
      </p>
      <CodeBlock source={lmsSrc} region="conventionalStep" path="src/simulation/models/lms.ts" caption="標「← 差異」的那一行是 Conventional LMS 和 Sign-Error LMS 唯一不同的地方（§0.9）。" />
      <CodeBlock source={modelSrc} region="handCalc" path="src/chapters/ch00/model.ts" caption="手算表：每一列呼叫一次 conventionalStep。" />

      <Derivation
        title="（Engineer）封閉解的推導與交叉比對"
        formulaId="F-00.6"
        level="L0"
        claim="exact"
        defaultOpen={atLeast('engineer')}
        derivation={
          <>
            <p>
              從表格最後一欄看到 <Tex>{`\\delta_{n+1}=${texNum(pole)}\\,\\delta_n`}</Tex>。重複代入就是等比數列：
            </p>
            <StepDerivation
              steps={[
                {
                  tex: String.raw`\delta_n=p^n\delta_0,\qquad p=1-\mu x^2=${texNum(pole)}`,
                  why: (
                    <>
                      每一步乘上同一個 <Tex>{'p'}</Tex>（§0.6 證明）。
                    </>
                  ),
                },
                {
                  tex: String.raw`a-w_n=p^n\,(a-w_0)`,
                  why: (
                    <>
                      代入 <Tex>{'\\delta_n=a-w_n'}</Tex> 的定義（<ErratumRef eid="E39" /> 的極性）。
                    </>
                  ),
                },
                { tex: String.raw`w_n=a-(a-w_0)\,p^n=${texNum(p.a)}-${texNum(p.a - p.w0)}\times${texNum(pole)}^n`, why: '移項，得到封閉解。' },
              ]}
            />
            <MetricTable rows={metrics} caption="遞迴與封閉解的交叉比對（絕對容忍 $10^{-12}$）" />
          </>
        }
        assumptions={
          <ul>
            <li>
              固定 <Tex>{'x'}</Tex>、無雜訊 <Tex>{'v=0'}</Tex>
            </li>
            <li>
              <Tex>{'\\mu'}</Tex>、<Tex>{'x'}</Tex> 為常數
            </li>
          </ul>
        }
      />

      <ModeGate min="research">
        <h3>（Research）精確有理數驗算</h3>
        <p>
          用 BigInt 分數重算同一個遞迴（<Tex>{'\\mu=1/10'}</Tex> 以分數表示，不經過二進位浮點）：
        </p>
        <div className="table-wrap">
          <table className="ch00-num-table">
            <thead>
              <tr>
                <th className="num">
                  <Tex>{'n'}</Tex>
                </th>
                <th className="num">
                  精確 <Tex>{'w_n'}</Tex>
                </th>
                <th className="num">IEEE double（conventionalStep）</th>
                <th className="num">最接近精確值的 double</th>
                <th className="num">差幾個 ulp</th>
                <th className="num">double − 精確（真正的差）</th>
              </tr>
            </thead>
            <tbody>
              {exactRows.map((r) => (
                <tr key={r.n}>
                  <td className="num">{r.n}</td>
                  <td className="num">{fractionToString(r.f)}</td>
                  <td className="num">{String(r.dbl)}</td>
                  <td className="num">{String(r.nearest)}</td>
                  <td className="num">{num(r.ulps, 3)}</td>
                  <td className="num">{r.diff === 0 ? '0' : num(r.diff, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small">
          <ClaimTag kind="exact" /> <Tex>{`w_1=${fractionToString(exactRows[1].f)},\\ w_2=${fractionToString(w2row.f)}`}</Tex>。double 版本的{' '}
          <Tex>{'w_2'}</Tex> 印出來是 <code>{String(w2row.dbl)}</code>，而最接近 <Tex>{fractionToString(w2row.f)}</Tex> 的 double 是{' '}
          <code>{String(w2row.nearest)}</code>：兩者差 <Tex>{texRes(w2row.ulps, 3)}</Tex> 個 ulp（此處 1 ulp{' '}
          <Tex>{`=${texRes(ulpOf(w2row.nearest), 3)}`}</Tex>）；與精確有理數本身的距離則是 <Tex>{texRes(w2row.diff, 4)}</Tex>
          （以 BigInt 精確相減後才轉成小數）。浮點的每一次乘法、加法都會捨入，誤差會累積，所以 T01 的自動測試用{' '}
          <Tex>{'10^{-12}'}</Tex> 的絕對容忍度，而不是要求 <code>=== 2.28</code>。
        </p>
        <CodeBlock source={modelSrc} region="exactTrace" path="src/chapters/ch00/model.ts" />
      </ModeGate>
    </Section>
  )
}
