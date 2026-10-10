import { useMemo, type ReactNode } from 'react'
import {
  ClaimTag,
  CodeBlock,
  Derivation,
  Mermaid,
  ModeGate,
  Section,
  SourceTag,
  StepDerivation,
  Tex,
  TexBlock,
} from '@/components'
import { useSettings } from '@/app/settings'
import { conventionalStep } from '@/simulation/models/lms'
import { CLEAN_DATA, NOISY_DATA, leastSquaresGain, lmsOnData, ratioTable } from '../model'
import { num } from '../format'
import { ChapterHandCalc, Observe } from '../common'
import modelSrc from '../model.ts?raw'

/** §0.1 黑盒子：先看乾淨資料，再看含雜訊資料。 */
export function BlackBoxSection() {
  const { atLeast } = useSettings()
  const clean = useMemo(() => ratioTable(CLEAN_DATA), [])
  const noisy = useMemo(() => ratioTable(NOISY_DATA), [])
  const ls = useMemo(() => leastSquaresGain(NOISY_DATA), [])
  const ratios = noisy.map((r) => r.ratio)
  const spread = Math.max(...ratios) - Math.min(...ratios)
  // 固定 μ 時，把三筆資料一輪一輪餵給 LMS：每輪結束時的 w 會停在最小平方解附近 O(μ) 的範圍
  const cyclic = useMemo(
    () =>
      [0.02, 0.005, 0.001].map((mu) => {
        const trace = lmsOnData(NOISY_DATA, 1, mu, 3000)
        return { mu, w: trace[trace.length - 1] }
      }),
    [],
  )

  return (
    <Section kind="intuition" level={2} id="ch00-blackbox" title="§0.1 一個黑盒子問題">
      <p>
        想像桌上有一個打不開的黑盒子（例如一顆你不知道確切增益的 DTC、放大器或感測器）。你可以餵它一個輸入{' '}
        <Tex>{'x'}</Tex>，然後讀到輸出 <Tex>{'y'}</Tex>。盒子裡面其實只做一件事：把輸入乘上一個固定的數{' '}
        <Tex>{'a'}</Tex>。可是 <Tex>{'a'}</Tex> 是多少，沒有人告訴你。
      </p>
      <div className="ch00-blackbox" role="img" aria-label="黑盒子示意：x 進、y 出，內部 a 未知">
        <span className="ch00-blackbox-io">
          輸入 <Tex>{'x'}</Tex>
        </span>
        <span className="ch00-blackbox-arrow" aria-hidden="true">
          →
        </span>
        <span className="ch00-blackbox-box">
          <Tex>{'\\times\\,a\\;(?)'}</Tex>
        </span>
        <span className="ch00-blackbox-arrow" aria-hidden="true">
          →
        </span>
        <span className="ch00-blackbox-io">
          輸出 <Tex>{'y'}</Tex>
        </span>
      </div>

      <h3>情況一：資料很乾淨</h3>
      <p>
        你做了三次實驗，得到下面三筆資料。每一筆都自己算一次「如果只看這一筆，<Tex>{'a'}</Tex> 應該是多少」，也就是{' '}
        <Tex>{'y/x'}</Tex>：
      </p>
      <RatioTable
        rows={clean}
        caption={
          <>
            乾淨資料：每一筆的 <Tex>{'y/x'}</Tex> 都一樣
          </>
        }
      />
      <p>
        三筆都說 <Tex>{`a=${num(clean[0].ratio)}`}</Tex>，一眼就看出答案。這時根本不需要任何演算法。
      </p>

      <h3>情況二：資料有雜訊（真實世界）</h3>
      <p>
        真實量測一定有雜訊：比較器有熱雜訊、時脈有 jitter、ADC 有量化誤差。於是盒子的行為變成
      </p>
      <TexBlock
        id="F-00.1"
        label={
          <>
            黑盒子模型：<Tex>{'v'}</Tex> 是量測雜訊；<Tex>{'\\hat y'}</Tex> 是我們用目前的猜測 <Tex>{'w'}</Tex> 做出的預測；<Tex>{'e'}</Tex> 是誤差
          </>
        }
      >
        {String.raw`y=ax+v,\qquad \hat y=wx,\qquad e=y-\hat y`}
      </TexBlock>
      <p>同樣做三次實驗：</p>
      <RatioTable
        rows={noisy}
        caption={
          <>
            含雜訊資料：每一筆的 <Tex>{'y/x'}</Tex> 都不一樣
          </>
        }
      />
      <p>
        三個「單筆猜測」分別是 {ratios.map((r, i) => (
          <span key={i}>
            <Tex>{num(r)}</Tex>
            {i < ratios.length - 1 ? '、' : ''}
          </span>
        ))}
        ，最大和最小差了 <Tex>{num(spread, 4)}</Tex>。
        <strong>
          沒有任何一筆資料能直接告訴你 <Tex>{'a'}</Tex>。
        </strong>
        我們需要一個方法，把很多筆「各自有點錯」的資料，慢慢整合成一個好的估計。
      </p>
      <p>這裡有兩條路：</p>
      <ol>
        <li>
          <strong>批次（batch）</strong>：先把所有資料收集起來，一次解出讓總平方誤差最小的 <Tex>{'w'}</Tex>，也就是
          最小平方法（least squares）。這三筆資料的答案是{' '}
          <Tex>{String.raw`\frac{${num(ls.sxy)}}{${num(ls.sxx)}}\approx ${num(ls.w, 5)}`}</Tex>（公式見下方 F-00.10）。
        </li>
        <li>
          <strong>線上（online）</strong>：資料一筆一筆進來，每來一筆就把 <Tex>{'w'}</Tex> 修正一點點，不必儲存舊資料。這就是{' '}
          <strong>LMS</strong>（Least Mean Squares）。
        </li>
      </ol>
      <TexBlock
        id="F-00.10"
        label={
          <>
            批次最小平方解（一次看完全部資料）；需 <Tex>{'\\sum_i x_i^2>0'}</Tex>，否則不可辨識
          </>
        }
      >
        {String.raw`\hat a_{\mathrm{LS}}=\arg\min_w\sum_i\left(y_i-wx_i\right)^2=\frac{\sum_i x_iy_i}{\sum_i x_i^2}`}
      </TexBlock>
      <p>
        硬體幾乎都選第二條路：資料（例如 PLL 中每個 reference cycle 的比較器輸出）永遠在進來、晶片沒有空間存一大堆資料、
        也不想做除法，而且 <Tex>{'a'}</Tex> 還會隨溫度、電壓緩慢漂移（PVT drift），需要一直追蹤。
      </p>

      <Derivation
        title="（Engineer）批次最小平方解從哪裡來？——一次微分就夠"
        formulaId="F-00.10"
        level="L0"
        claim="exact"
        defaultOpen={atLeast('engineer')}
        derivation={
          <>
            <StepDerivation
              steps={[
                {
                  tex: String.raw`S(w)=\sum_{i}\left(y_i-wx_i\right)^2`,
                  why: (
                    <>
                      定義：把每一筆的誤差平方加起來，當作「這個 <Tex>{'w'}</Tex> 有多差」的分數。
                    </>
                  ),
                },
                {
                  tex: String.raw`\frac{dS}{dw}=\sum_i 2\left(y_i-wx_i\right)\cdot\left(-x_i\right)`,
                  why: (
                    <>
                      對每一項用 chain rule：<Tex>{"(u^2)'=2u\\,u'"}</Tex>，而 <Tex>{'u=y_i-wx_i'}</Tex> 對 <Tex>{'w'}</Tex> 的導數是{' '}
                      <Tex>{'-x_i'}</Tex>。
                    </>
                  ),
                },
                {
                  tex: String.raw`\frac{dS}{dw}=-2\sum_i x_iy_i+2w\sum_i x_i^2`,
                  why: (
                    <>
                      把括號乘開、把和 <Tex>{'w'}</Tex> 無關的部分提出來。
                    </>
                  ),
                },
                {
                  tex: String.raw`\frac{dS}{dw}=0\;\Longrightarrow\;w\sum_i x_i^2=\sum_i x_iy_i`,
                  why: (
                    <>
                      <Tex>{'S(w)'}</Tex> 是開口向上的拋物線（二次項係數 <Tex>{'\\sum_i x_i^2>0'}</Tex>），最低點的斜率為 0。
                    </>
                  ),
                },
                {
                  tex: String.raw`\hat a_{\mathrm{LS}}=\frac{\sum_i x_iy_i}{\sum_i x_i^2}=\frac{${num(ls.sxy)}}{${num(ls.sxx)}}=${num(ls.w, 8)}`,
                  why: (
                    <>
                      兩邊除以 <Tex>{'\\sum_i x_i^2'}</Tex>（需要 <Tex>{'\\sum_i x_i^2>0'}</Tex>：至少要有一筆 <Tex>{'x_i\\ne0'}</Tex>，否則{' '}
                      <Tex>{'a'}</Tex> 完全不可辨識）。數字由程式即時計算。
                    </>
                  ),
                },
              ]}
            />
            <p className="small">
              <ClaimTag kind="exact" /> 這是「一次看完全部資料」的最佳解。LMS 的目標也是它（平均意義下），只是改成一筆一筆地逼近。
            </p>
            <CodeBlock source={modelSrc} region="leastSquares" path="src/chapters/ch00/model.ts" />
            <ModeGate min="research">
              <p className="small">
                <strong>（Research）固定 <Tex>{'\\mu'}</Tex>、反覆循環同一組資料時，LMS 會停在哪？</strong> 下表把三筆資料一輪一輪餵給
                <code>conventionalStep</code> 3000 輪，記錄最後一輪結束時的 <Tex>{'w'}</Tex>：
              </p>
              <div className="table-wrap">
                <table className="ch00-num-table">
                  <thead>
                    <tr>
                      <th className="num">
                        <Tex>{'\\mu'}</Tex>
                      </th>
                      <th className="num">
                        每輪結束時的 <Tex>{'w'}</Tex>
                      </th>
                      <th className="num">
                        與 <Tex>{'\\hat a_{\\mathrm{LS}}'}</Tex> 的差
                      </th>
                      <th className="num">
                        <Tex>{'(w-\\hat a_{\\mathrm{LS}})/\\mu'}</Tex>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {cyclic.map((c) => (
                      <tr key={c.mu}>
                        <td className="num">{num(c.mu)}</td>
                        <td className="num">{num(c.w, 8)}</td>
                        <td className="num">{num(c.w - ls.w, 4)}</td>
                        <td className="num">{num((c.w - ls.w) / c.mu, 4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="small">
                最後一欄幾乎是常數，所以差距大約與 <Tex>{'\\mu'}</Tex> 成正比（<ClaimTag kind="approx" />）：固定步長的線上演算法在有限資料上不會「精確」收斂，
                而是在最佳解附近一個 <Tex>{'O(\\mu)'}</Tex> 的範圍內循環。<Tex>{'\\mu'}</Tex> 越小越準、但越慢——這是整個網站反覆出現的取捨。
              </p>
            </ModeGate>
          </>
        }
        symbols={[
          { symbol: 'S(w)', meaning: '總平方誤差（批次成本）' },
          { symbol: '\\hat a_{\\mathrm{LS}}', meaning: '最小平方估計' },
        ]}
        assumptions={
          <ul>
            <li>資料固定、可全部儲存</li>
            <li>
              <Tex>{'\\sum_i x_i^2>0'}</Tex>
            </li>
          </ul>
        }
      />
      <ChapterHandCalc id="HC-00.3">
        預設的三筆就是上面那組含雜訊的資料。把它們換成你自己的三組 <Tex>{'(x,\\ y)'}</Tex>（例如手邊量到的數字），先在紙上列出{' '}
        <Tex>{'x_iy_i'}</Tex> 與 <Tex>{'x_i^2'}</Tex> 兩欄、各自加總再相除，然後切到「看帶入過程」逐行對照，或按「對答案」。
      </ChapterHandCalc>
    </Section>
  )
}

function RatioTable({ rows, caption }: { rows: { x: number; y: number; ratio: number }[]; caption: ReactNode }) {
  return (
    <div className="table-wrap">
      <table className="ch00-num-table">
        <caption className="small muted">{caption}</caption>
        <thead>
          <tr>
            <th className="num">
              <Tex>{'x'}</Tex>
            </th>
            <th className="num">
              <Tex>{'y'}</Tex>
            </th>
            <th className="num">
              只看這一筆的猜測 <Tex>{'y/x'}</Tex>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.x}-${r.y}`}>
              <td className="num">{num(r.x)}</td>
              <td className="num">{num(r.y)}</td>
              <td className="num">{num(r.ratio, 6)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const LOOP_CHART = `flowchart LR
  X["輸入 x"] --> P["① 預測 ŷ = w·x"]
  P --> C["② 比較 e = y − ŷ"]
  Y["黑盒子輸出 y"] --> C
  C --> U["③ 修正 w ← w + μ·e·x"]
  X --> U
  U -->|"下一筆資料"| P`

/** §0.2 三個動作：預測 → 比較 → 修正。 */
export function LoopSection() {
  // 四種正負組合：直接呼叫 lms.ts 的 conventionalStep（w = 0 ⇒ e = y），看 Δw 的正負
  const mu = 0.1
  const cases = useMemo(
    () =>
      [
        { e: 1, x: 2 },
        { e: 1, x: -2 },
        { e: -1, x: 2 },
        { e: -1, x: -2 },
        { e: 1, x: 0 },
      ].map(({ e, x }) => ({ e, x, dw: conventionalStep({ w: 0, x, y: e, mu }).dw })),
    [],
  )
  return (
    <Section kind="diagram" level={2} id="ch00-loop" title="§0.2 三個動作：預測 → 比較 → 修正">
      <p>LMS 每收到一筆資料，只做三件事：</p>
      <ol>
        <li>
          <strong>預測</strong>：用目前的猜測算出 <Tex>{'\\hat y_n=w_nx_n'}</Tex>。
        </li>
        <li>
          <strong>比較</strong>：和真正的輸出比，得到誤差 <Tex>{'e_n=y_n-\\hat y_n'}</Tex>。
        </li>
        <li>
          <strong>修正</strong>：依照「錯多少、往哪錯」把 <Tex>{'w'}</Tex> 推一小步。
        </li>
      </ol>
      <Mermaid chart={LOOP_CHART} caption="LMS 的迴圈：每一筆資料走一圈（示意）" ariaLabel="預測、比較、修正三個步驟組成的迴圈" />

      <h3>修正的方向怎麼決定？</h3>
      <p>
        關鍵在於：要讓預測 <Tex>{'\\hat y=wx'}</Tex> 變大，<Tex>{'w'}</Tex> 該變大還是變小，取決於 <Tex>{'x'}</Tex> 的正負。
        下表每一列都是用 <code>conventionalStep</code>（<Tex>{`\\mu=${mu}`}</Tex>）真正算出來的更新量：
      </p>
      <div className="table-wrap">
        <table className="ch00-num-table">
          <thead>
            <tr>
              <th className="num">
                <Tex>{'e'}</Tex>
              </th>
              <th className="num">
                <Tex>{'x'}</Tex>
              </th>
              <th>預測太大還是太小？</th>
              <th>
                想修正預測，<Tex>{'w'}</Tex> 應該…
              </th>
              <th className="num">
                <Tex>{'\\Delta w=\\mu e x'}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr key={`${c.e}/${c.x}`}>
                <td className="num">{num(c.e)}</td>
                <td className="num">{num(c.x)}</td>
                <td>
                  {c.e > 0 ? '太小' : '太大'}（<Tex>{c.e > 0 ? 'y>\\hat y' : 'y<\\hat y'}</Tex>）
                </td>
                <td>{directionText(c.e, c.x)}</td>
                <td className={`num ${c.dw > 0 ? 'pos' : c.dw < 0 ? 'neg' : ''}`}>{num(c.dw)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Observe>
        <Tex>{'\\Delta w'}</Tex> 的正負永遠等於 <Tex>{'e\\cdot x'}</Tex> 的正負，正好就是「該修的方向」。乘上 <Tex>{'x'}</Tex>{' '}
        自動處理了方向；而 <Tex>{'x=0'}</Tex> 時更新量為 0——這筆資料本來就沒告訴我們任何關於 <Tex>{'a'}</Tex> 的事。§0.6
        會用微積分證明這不是巧合。
      </Observe>
    </Section>
  )
}

/** 方向表的說明文字：要讓 ŷ = w·x 往 y 靠，w 該往哪走（四種正負組合 + x = 0）。 */
function directionText(e: number, x: number): ReactNode {
  const yhat = <Tex>{'\\hat y'}</Tex>
  const w = <Tex>{'w'}</Tex>
  if (x === 0)
    return (
      <>
        怎麼改 {w} 都不影響 <Tex>{'\\hat y=0\\cdot w=0'}</Tex>：這筆資料沒有 <Tex>{'a'}</Tex> 的資訊
      </>
    )
  const up = e > 0 // 預測要變大
  const wUp = up === x > 0 // x > 0 時 w 與 ŷ 同向；x < 0 時反向
  return (
    <>
      {yhat} 要變{up ? '大' : '小'}；<Tex>{x > 0 ? 'x>0' : 'x<0'}</Tex> 時 <Tex>{'\\partial\\hat y/\\partial w=x'}</Tex>{' '}
      {x > 0 ? '為正' : '為負'} → {w} 變{wUp ? '大' : '小'}
    </>
  )
}

/** §0.3 更新公式。 */
export function UpdateFormulaSection() {
  return (
    <Section kind="formula" level={2} id="ch00-update" title="§0.3 LMS 更新公式">
      <p>把三個動作寫成一行，就是整個網站最重要的公式：</p>
      <TexBlock
        id="F-00.2"
        label={
          <>
            LMS（Least Mean Squares）更新式；<Tex>{'n'}</Tex> 是第幾筆資料（sample index）
          </>
        }
      >
        {String.raw`\boxed{w_{n+1}=w_n+\mu\,e_n\,x_n},\qquad e_n=y_n-w_nx_n`}
      </TexBlock>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>這一項</th>
              <th>名稱</th>
              <th>白話</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <Tex>{'w_n'}</Tex>
              </td>
              <td>目前的猜測（weight / coefficient）</td>
              <td>
                到第 <Tex>{'n'}</Tex> 筆資料為止，我們認為 <Tex>{'a'}</Tex> 大概是多少。硬體上就是一個暫存器（例如 DTC gain register）。
              </td>
            </tr>
            <tr>
              <td>
                <Tex>{'e_n'}</Tex>
              </td>
              <td>誤差（error）</td>
              <td>這次猜錯多少、往哪個方向錯。</td>
            </tr>
            <tr>
              <td>
                <Tex>{'x_n'}</Tex>
              </td>
              <td>輸入／regressor</td>
              <td>
                這筆資料對 <Tex>{'w'}</Tex> 有多「敏感」：<Tex>{'\\partial\\hat y/\\partial w=x'}</Tex>。它決定修正的方向與份量。
              </td>
            </tr>
            <tr>
              <td>
                <Tex>{'\\mu'}</Tex>
              </td>
              <td>學習率（learning rate / step size）</td>
              <td>每次修正走多大步。太小學得慢，太大會「修過頭」甚至發散（§0.5、§0.6）。硬體上常是右移 <Tex>{'k'}</Tex> 位元（<Tex>{'\\mu=2^{-k}'}</Tex>）。</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="small">
        <ClaimTag kind="exact" /> 這是演算法的定義，不是近似。<SourceTag kind="illustrative" /> 本章所有數字都是教學例，沒有單位（無因次）；
        在 PLL 校正中 <Tex>{'a,w'}</Tex> 的單位是 fs／code，<Tex>{'\\mu'}</Tex> 的單位要跟著 scaling 一起寫清楚（見 Ch04、Ch12）。
      </p>
    </Section>
  )
}
