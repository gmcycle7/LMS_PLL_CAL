import { useMemo } from 'react'
import type { Data } from 'plotly.js-dist-min'
import {
  ClaimTag,
  CodeBlock,
  CodeCompare,
  Derivation,
  ModeGate,
  Plot,
  Prereq,
  Section,
  StepDerivation,
  Tex,
  TexBlock,
  useThemeTokens,
} from '@/components'
import { STEP, VARIANT_LABEL, huberPsi, lossValue, type LmsVariant, type TieRule } from '@/simulation/models/lms'
import { runVariantOnData, signErrorFixedPointRun, type LossData } from '@/simulation/models/lossCompare'
import lmsSrc from '@/simulation/models/lms.ts?raw'
import { ChapterHandCalc, Erratum, f, texNum, useChapterMode } from '../common'

const DH = 1 // 圖中的 Huber 門檻 δₕ
const CMP = { a: 3, x: 1, w: 1, mu: 0.2, huberDelta: 1 } // 入門課 Lesson 3 的單步比較
/** 勘誤 E40 的數值證據：T01 參數（a = 3, x = 2, w₀ = 1, μ = 0.1）、無雜訊，跑 Sign-Error LMS */
const TIE_DEMO = { a: 3, x: 2, w0: 1, mu: 0.1, steps: 40 }
const TIE_TEX: Record<TieRule, string> = { zero: '0', plus: '+1', minus: '-1' }
/** IEEE double：0 + 0.2 + 0.2 + 0.2 − 0.2 − 0.2 − 0.2 的實際結果（不是 0） */
const IEEE_RESIDUE = [0.2, 0.2, 0.2, -0.2, -0.2, -0.2].reduce((w, d) => w + d, 0)

export function LossesSection() {
  const tokens = useThemeTokens()
  const { atLeast } = useChapterMode()

  const plots = useMemo(() => {
    const es = Array.from({ length: 241 }, (_, i) => -3 + (6 * i) / 240)
    const rho: Data[] = [
      { x: es, y: es.map((e) => lossValue('mse', e)), name: 'ρ₂ = ½e²（MSE）', mode: 'lines', line: { color: tokens.series[0] } },
      { x: es, y: es.map((e) => lossValue('mae', e)), name: 'ρ₁ = |e|（MAE）', mode: 'lines', line: { color: tokens.series[1] } },
      { x: es, y: es.map((e) => lossValue('huber', e, DH)), name: `ρₕ（δₕ = ${DH}）`, mode: 'lines', line: { color: tokens.series[2], dash: 'dash' } },
    ]
    const neg = es.filter((e) => e < 0)
    const pos = es.filter((e) => e > 0)
    const psi: Data[] = [
      { x: es, y: es, name: 'ψ₂ = e', mode: 'lines', line: { color: tokens.series[0] } },
      { x: [...neg, null, ...pos], y: [...neg.map(() => -1), null, ...pos.map(() => 1)], name: 'ψ₁ = sign(e)', mode: 'lines', line: { color: tokens.series[1] } },
      { x: [0, 0], y: [-1, 1], name: 'e = 0：次梯度集合 [−1, 1]', mode: 'lines', line: { color: tokens.series[1], dash: 'dot' } },
      { x: es, y: es.map((e) => huberPsi(e, DH)), name: 'ψₕ = clip(e, ±δₕ)', mode: 'lines', line: { color: tokens.series[2], dash: 'dash' } },
    ]
    // 次梯度示意：|e| 與幾條過原點、斜率 g ∈ [−1, 1] 的支撐線
    const sub: Data[] = [
      { x: es, y: es.map(Math.abs), name: '|e|', mode: 'lines', line: { color: tokens.series[1], width: 3 } },
      ...[-1, -0.5, 0, 0.5, 1].map((g, i) => ({
        x: es,
        y: es.map((e) => g * e),
        name: `g = ${g}`,
        mode: 'lines' as const,
        line: { color: tokens.series[(i % 4) + 2], dash: 'dot' as const, width: 1.2 },
      })),
      { x: es, y: es.map((e) => 1.4 * e), name: 'g = 1.4（不是次梯度）', mode: 'lines', line: { color: tokens.textMuted, dash: 'dash', width: 1 } },
    ]
    return { rho, psi, sub }
  }, [tokens])

  // E40：同一組無雜訊資料（y ≡ a·x），三種 tie 慣例 × 兩種算術，列出最後 8 步出現過的 w 值（穩態的「循環集合」）
  const tieDemo = useMemo(() => {
    const N = TIE_DEMO.steps
    const data: LossData = {
      x: new Float64Array(N).fill(TIE_DEMO.x),
      y: new Float64Array(N).fill(TIE_DEMO.a * TIE_DEMO.x),
      outlier: new Uint8Array(N),
    }
    const cycle = (w: Float64Array) => Array.from(new Set(Array.from(w.slice(-8)))).sort((p, q) => p - q).map(String)
    return (['zero', 'plus', 'minus'] as TieRule[]).map((tie) => ({
      tie,
      fixed: cycle(signErrorFixedPointRun(data, { w0: TIE_DEMO.w0, mu: TIE_DEMO.mu, tie })!.w),
      ieee: cycle(runVariantOnData('sign_error', data, { w0: TIE_DEMO.w0, mu: TIE_DEMO.mu, tie, huberDelta: 1 }).w),
    }))
  }, [])

  const oneStep = useMemo(
    () =>
      (['conventional', 'sign_error', 'huber', 'sign_sign'] as LmsVariant[]).map((v) => ({
        v,
        out: STEP[v]({ w: CMP.w, x: CMP.x, y: CMP.a * CMP.x, mu: CMP.mu, tie: 'zero', huberDelta: CMP.huberDelta }),
      })),
    [],
  )

  const chain = (
    <StepDerivation
      title={
        <>
          任何損失 <Tex>{String.raw`\rho(e)`}</Tex> 都給出同一種形式的更新
        </>
      }
      steps={[
        { tex: String.raw`j_n=\rho(e_n),\qquad e_n=y_n-wx_n`, why: '單筆成本換成一般的損失函數' },
        {
          tex: String.raw`\frac{\partial j_n}{\partial w}=\rho'(e_n)\cdot\frac{\partial e_n}{\partial w}=\psi(e_n)\cdot(-x_n)`,
          why: (
            <>
              連鎖律（同 §1.3）；把 <Tex>{String.raw`\rho'`}</Tex> 記成 <Tex>{'\\psi'}</Tex>（influence function），<Tex>{String.raw`\partial e_n/\partial w=-x_n`}</Tex>
            </>
          ),
        },
        { tex: String.raw`w_{n+1}=w_n-\mu\frac{\partial j_n}{\partial w}=w_n+\mu\,\psi(e_n)\,x_n`, why: 'Gradient descent：往梯度反方向走一步' },
      ]}
    />
  )

  const absDeriv = (
    <StepDerivation
      title={
        <>
          <Tex>{'|e|'}</Tex> 的導數（分段來看）
        </>
      }
      steps={[
        { tex: String.raw`e>0:\ |e|=e\ \Rightarrow\ \tfrac{d}{de}|e|=+1`, why: '正數的絕對值就是自己' },
        { tex: String.raw`e<0:\ |e|=-e\ \Rightarrow\ \tfrac{d}{de}|e|=-1`, why: '負數的絕對值是相反數' },
        { tex: String.raw`e=0:\ \lim_{h\to0^+}\tfrac{|h|}{h}=+1\ne-1=\lim_{h\to0^-}\tfrac{|h|}{h}`, why: '左右導數不相等，所以 0 處不可微（V 字的尖點）' },
        {
          tex: String.raw`\Rightarrow\ \Delta w=\mu\,\operatorname{sign}(e)\,x`,
          why: (
            <>
              代入 <Tex>{String.raw`\psi_1=\operatorname{sign}(e)`}</Tex>（<Tex>{'e\\ne0'}</Tex>）：這就是 Sign-Error LMS（規格 §2.2）；<Tex>{'e=0'}</Tex> 怎麼辦見下方
            </>
          ),
        },
      ]}
    />
  )

  const huberCheck = (
    <StepDerivation
      title={
        <>
          Huber 在 <Tex>{String.raw`|e|=\delta_H`}</Tex> 處接得剛剛好
        </>
      }
      steps={[
        { tex: String.raw`\rho_H(\delta_H^-)=\tfrac12\delta_H^2,\qquad \rho_H(\delta_H^+)=\delta_H\big(\delta_H-\tfrac12\delta_H\big)=\tfrac12\delta_H^2`, why: '函數值相同，所以連續' },
        { tex: String.raw`\rho_H'(\delta_H^-)=e\big|_{e=\delta_H}=\delta_H,\qquad \rho_H'(\delta_H^+)=\delta_H\cdot1=\delta_H`, why: '左右導數相同，所以一階可微（沒有尖點）' },
        {
          tex: String.raw`\psi_H(e)=\operatorname{clip}(e,-\delta_H,\delta_H)=\begin{cases}e,&|e|\le\delta_H\\ \delta_H\operatorname{sign}(e),&|e|>\delta_H\end{cases}`,
          why: (
            <>
              小誤差像 LMS（平滑、精準），大誤差像 Sign-Error（影響力有上限）。注意 <Tex>{'\\psi_H'}</Tex> 在 <Tex>{String.raw`\pm\delta_H`}</Tex>{' '}
              有轉折，所以 <Tex>{'\\rho_H'}</Tex> 只有一階連續（<Tex>{'C^1'}</Tex>），二階導數不連續
            </>
          ),
        },
      ]}
    />
  )

  return (
    <>
      <Section kind="intuition" title="2.1 可以用絕對值嗎？可以——但目標與更新律都會跟著變" level={2} id="ch01-s21">
        <p className="ch01-lead">
          §1.1 說「平方」是為了不讓正負抵消。絕對值也做得到。<strong>選哪一種誤差指標，就決定了演算法要找的「最佳解」是哪一個，以及每一步怎麼更新</strong>
          （規格 §2）。我們比較三種損失：
        </p>
        <TexBlock
          id="F-01.10"
          label={
            <>
              三種損失（<Tex>{'\\delta_H'}</Tex> 為 Huber 門檻，與參數誤差 <Tex>{'\\delta'}</Tex> 不同）
            </>
          }
        >
          {String.raw`\rho_2(e)=\tfrac12e^2,\qquad \rho_1(e)=|e|,\qquad \rho_H(e)=\begin{cases}\tfrac12e^2,&|e|\le\delta_H\\ \delta_H\big(|e|-\tfrac12\delta_H\big),&|e|>\delta_H\end{cases}`}
        </TexBlock>
        {atLeast('engineer') ? chain : <Derivation title="連鎖律：一般損失的更新式" derivation={chain} level="L0" claim="exact" />}
        <TexBlock id="F-01.11" label="統一更新式">
          {String.raw`\boxed{\Delta w=\mu\,\psi(e)\,x},\qquad \psi_2=e,\quad \psi_1=\operatorname{sign}(e),\quad \psi_H=\operatorname{clip}(e,-\delta_H,\delta_H)`}
        </TexBlock>
        <p className="small">
          <ClaimTag kind="exact" /> 這只是連鎖律：任何（次）可微的損失都給出「<Tex>{String.raw`\mu\times\psi(e)\times x`}</Tex>」形式的更新；三種演算法的差別全部藏在{' '}
          <Tex>{'\\psi'}</Tex> 裡。
        </p>
        <div className="ch01-two">
          <Plot title="損失 $\rho(e)$" ariaLabel="三種損失函數 ρ(e)" data={plots.rho} layout={{ xaxis: { title: { text: 'e' } }, yaxis: { title: { text: 'ρ' } } }} height={260} csvName="ch01-rho" />
          <Plot title="$\psi(e)=d\rho/de$（更新量正比於它）" ariaLabel="三種損失的導數 ψ(e)" data={plots.psi} layout={{ xaxis: { title: { text: 'e' } }, yaxis: { title: { text: 'ψ' } } }} height={260} csvName="ch01-psi" />
        </div>
        <div className="table-wrap">
          <table className="ch01-table">
            <thead>
              <tr>
                <th>比較項目</th>
                <th>MSE（L2）</th>
                <th>MAE（L1）</th>
                <th>Huber</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>大誤差的懲罰</td>
                <td>
                  平方成長（<Tex>{String.raw`\rho_2(10)=${texNum(lossValue('mse', 10))}`}</Tex>）
                </td>
                <td>
                  線性成長（<Tex>{String.raw`\rho_1(10)=${texNum(lossValue('mae', 10))}`}</Tex>）
                </td>
                <td>
                  先平方、超過 <Tex>{'\\delta_H'}</Tex> 後線性（<Tex>{String.raw`\delta_H=1:\ \rho_H(10)=${texNum(lossValue('huber', 10, 1))}`}</Tex>）
                </td>
              </tr>
              <tr>
                <td>
                  在 <Tex>{'e=0'}</Tex> 可微？
                </td>
                <td>可（平滑）</td>
                <td>否（尖點，用次梯度）</td>
                <td>可（一階連續）</td>
              </tr>
              <tr>
                <td>單步更新需要的資訊</td>
                <td>誤差的大小與正負（多位元 ADC）</td>
                <td>只要正負（1-bit comparator）</td>
                <td>
                  誤差大小（但截在 <Tex>{String.raw`\pm\delta_H`}</Tex>）
                </td>
              </tr>
              <tr>
                <td>
                  單筆 outlier 的影響力 <Tex>{String.raw`|\psi|`}</Tex>
                </td>
                <td>
                  無上限（<Tex>{String.raw`\propto|e|`}</Tex>）
                </td>
                <td>
                  上限 <Tex>{'1'}</Tex>
                </td>
                <td>
                  上限 <Tex>{'\\delta_H'}</Tex>
                </td>
              </tr>
              <tr>
                <td>常數估計的最佳解（§2.3）</td>
                <td>平均值</td>
                <td>中位數</td>
                <td>
                  Huber M-estimate：<Tex>{String.raw`\delta_H\to0`}</Tex> 趨近中位數、<Tex>{String.raw`\delta_H\to\infty`}</Tex> 趨近平均（§2.3 的例子落在兩者之間，但一般資料不保證）
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        kind="formula"
        title={
          <>
            2.2 <Tex>{'|e|'}</Tex> 在 0 不能微分怎麼辦？次梯度與 <Tex>{String.raw`\operatorname{sign}(0)`}</Tex>（勘誤 E40）
          </>
        }
        level={2}
        id="ch01-s22"
      >
        {atLeast('engineer') ? absDeriv : <Derivation title="$|e|$ 的導數" derivation={absDeriv} level="L0" claim="exact" />}
        <Prereq title="次梯度（subgradient）：尖點上的「斜率」">
          <p>
            可微的凸函數在每一點都有一條切線，整條曲線都在切線上方。尖點沒有唯一切線，但仍有<strong>很多條</strong>「整條曲線都在它上方」的直線。
            這些直線的斜率都叫<strong>次梯度</strong>：
          </p>
          <TexBlock>{String.raw`g\in\partial f(e_0)\iff f(e)\ge f(e_0)+g\,(e-e_0)\quad\text{對所有 }e`}</TexBlock>
          <StepDerivation
            title={
              <>
                求 <Tex>{'|e|'}</Tex> 在 0 的次梯度集合
              </>
            }
            steps={[
              {
                tex: String.raw`|e|\ge|0|+g\,(e-0)=g\,e\quad\text{對所有 }e`,
                why: (
                  <>
                    套定義，<Tex>{'e_0=0'}</Tex>
                  </>
                ),
              },
              {
                tex: String.raw`e=1:\ 1\ge g;\qquad e=-1:\ 1\ge-g`,
                why: (
                  <>
                    代兩個特別的 <Tex>{'e'}</Tex>，得到必要條件 <Tex>{String.raw`-1\le g\le1`}</Tex>
                  </>
                ),
              },
              {
                tex: String.raw`|g|\le1\Rightarrow g\,e\le|g||e|\le|e|`,
                why: (
                  <>
                    反過來（充分條件），只要 <Tex>{String.raw`|g|\le1`}</Tex>，不等式對所有 <Tex>{'e'}</Tex> 成立
                  </>
                ),
              },
              { tex: String.raw`\partial|e|\,\big|_{e=0}=[-1,\,1]`, why: '結論：0 處的次梯度是一整段區間' },
            ]}
          />
          <Plot
            title="$|e|$ 與過原點的直線 $g\,e$：$|g|\le1$ 的都在 V 字下方"
            ariaLabel="絕對值函數與過原點的直線：斜率絕對值不超過 1 的都在 V 字下方"
            data={plots.sub}
            layout={{ xaxis: { title: { text: 'e' } }, yaxis: { title: { text: '' }, range: [-3, 3.2] } }}
            height={250}
            csvName="ch01-subgradient"
          />
          <p className="small">
            在可微點，次梯度集合只有一個元素，就是普通的導數。凸函數的最小值條件因此變成 <Tex>{String.raw`0\in\partial J(w^*)`}</Tex>
            ——§2.3 會用它證明中位數是 MAE 的最小值。
          </p>
        </Prereq>
        <TexBlock
          id="F-01.12"
          label={
            <>
              <Tex>{String.raw`\operatorname{sign}(0)`}</Tex> 的慣例必須明定
            </>
          }
        >
          {String.raw`\partial|e|\,\big|_{e=0}=[-1,\,1],\qquad \operatorname{sign}(0)\in\Big\{\underbrace{0}_{\text{數學次梯度}},\ \underbrace{+1,\ -1}_{\text{硬體 comparator}}\Big\}`}
        </TexBlock>
        <p>
          <ClaimTag kind="exact" /> <Erratum id="E40" /> 規格 §0 的 comparator 只輸出 <Tex>{String.raw`\pm1`}</Tex>，§2.2 的數學次梯度允許{' '}
          <Tex>{String.raw`\operatorname{sign}(0)=0`}</Tex>。本站在 <code>lms.ts</code> 的 <code>sgn(v, tie)</code> 明確選擇（下方程式碼），
          <strong>
            不依賴 JavaScript 的 <code>Math.sign(0) === 0</code>
          </strong>
          。這不是吹毛求疵：§2.3 的資料 <Tex>{String.raw`\{0,0,0,10\}`}</Tex> 有重複的 0，<Tex>{'e=0'}</Tex> 會真的發生，三種慣例的穩態時間平均差了{' '}
          <Tex>{String.raw`O(\mu)`}</Tex>（§2.3.1 精確算出 <Tex>{String.raw`\mu/2,\ \mu,\ 0`}</Tex>）；而且 IEEE double 連加{' '}
          <Tex>{String.raw`\pm\mu`}</Tex> 會讓「剛好 0」變成 <Tex>{texNum(IEEE_RESIDUE, 3)}</Tex>（例如{' '}
          <Tex>{String.raw`0.2+0.2+0.2-0.2-0.2-0.2`}</Tex>，由程式即時計算），慣例悄悄失效（見 MSE vs MAE Lab 的長時間研究）。
        </p>
        <p>
          <strong>先用數字看一次</strong>：把 §1.4 的手算例（<Tex>{String.raw`a=${TIE_DEMO.a},\ x=${TIE_DEMO.x},\ w_0=${TIE_DEMO.w0},\ \mu=${TIE_DEMO.mu}`}</Tex>
          ，無雜訊）改用 Sign-Error LMS。每步走 <Tex>{String.raw`\mu|x|=${texNum(TIE_DEMO.mu * TIE_DEMO.x)}`}</Tex>，第{' '}
          {Math.round((TIE_DEMO.a - TIE_DEMO.w0) / (TIE_DEMO.mu * TIE_DEMO.x))} 步剛好到{' '}
          <Tex>{'w=3'}</Tex>、<Tex>{'e=0'}</Tex>——接下來怎麼走，完全由 <Tex>{String.raw`\operatorname{sign}(0)`}</Tex> 慣例與算術決定：
        </p>
        <div className="table-wrap">
          <table className="ch01-table">
            <thead>
              <tr>
                <th>
                  <Tex>{String.raw`\operatorname{sign}(0)`}</Tex> 慣例
                </th>
                <th>
                  精確算術（整數 code）：穩態出現的 <Tex>{'w'}</Tex>
                </th>
                <th>
                  IEEE double 連加（<code>signErrorStep</code>）：穩態出現的 <Tex>{'w'}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              {tieDemo.map((r) => (
                <tr key={r.tie}>
                  <td>
                    <Tex>{TIE_TEX[r.tie]}</Tex>
                  </td>
                  <td className="mono">{`{${r.fixed.join(', ')}}`}</td>
                  <td className="mono">{`{${r.ieee.join(', ')}}`}</td>
                </tr>
              ))}
            </tbody>
            <caption>
              由 <code>signErrorFixedPointRun</code>（整數 code）與 <code>lms.ts</code> 的 <code>signErrorStep</code> 跑 {TIE_DEMO.steps} 步，列出最後 8 步出現過的值。
              精確算術下 <Tex>{String.raw`\operatorname{sign}(0)=0`}</Tex> 會凍結在 3；comparator 慣例則在兩格之間來回。IEEE double 連加十次{' '}
              <Tex>{'0.2'}</Tex> 得到的不是 3，所以 <Tex>{'e=0'}</Tex> 根本不會發生，三種慣例給出同一個循環——慣例「悄悄失效」。這就是勘誤 E40 的數值證據。
            </caption>
          </table>
        </div>
        <CodeBlock source={lmsSrc} region="sign" path="src/simulation/models/lms.ts" title="sgn(v, tie)：明定 $\operatorname{sign}(0)$ 的 tie 慣例" />
        {atLeast('engineer') ? huberCheck : <Derivation title="Huber 的連續性檢查" derivation={huberCheck} level="L0" claim="exact" />}
        <CodeBlock source={lmsSrc} region="huberPsi" path="src/simulation/models/lms.ts" title="Huber 的 $\psi$ 函數：小誤差原樣通過、大誤差截斷" />
      </Section>

      <Section kind="example" title="2.2.1 三種演算法的核心程式碼並排（差異行已標出）" level={3} id="ch01-s221">
        <p>
          四個 step 函數的介面完全相同，<strong>只差在「誤差怎麼變成更新量」那一行</strong>：
          <Tex>{String.raw`\Delta w=\mu\,e\,x`}</Tex>、<Tex>{String.raw`\mu\operatorname{sign}(e)\,x`}</Tex>、
          <Tex>{String.raw`\mu\operatorname{clip}(e,\pm\delta_H)\,x`}</Tex>、<Tex>{String.raw`\mu\operatorname{sign}(e)\operatorname{sign}(x)`}</Tex>。頁面顯示的就是網站實際執行的{' '}
          <code>lms.ts</code>：
        </p>
        <CodeCompare
          items={[
            { label: 'Conventional（MSE）', source: lmsSrc, region: 'conventionalStep', path: 'src/simulation/models/lms.ts', note: '更新量用到誤差的大小：需要多位元的誤差' },
            { label: 'Sign-Error（MAE）', source: lmsSrc, region: 'signErrorStep', path: 'src/simulation/models/lms.ts', note: '更新量只用誤差的正負號：1-bit 誤差就夠' },
            { label: 'Huber', source: lmsSrc, region: 'huberStep', path: 'src/simulation/models/lms.ts', note: '誤差先經過截斷（clip）再用' },
            { label: 'Sign-Sign', source: lmsSrc, region: 'signSignStep', path: 'src/simulation/models/lms.ts', note: '誤差與輸入都只剩正負號' },
          ]}
          caption="標黃的行就是差異（行內註解 ← 差異）。"
        />
        <p>
          同一個起點（<Tex>{String.raw`a=${CMP.a},\ x=${CMP.x},\ w=${CMP.w},\ \mu=${CMP.mu}`}</Tex>，所以{' '}
          <Tex>{`e=y-wx=${texNum(oneStep[0].out.e)}`}</Tex>）走一步（入門課 Lesson 3 的例子，由上面的函數即時計算）：
        </p>
        <div className="table-wrap">
          <table className="ch01-table">
            <thead>
              <tr>
                <th>演算法</th>
                <th className="num">
                  <Tex>{'e'}</Tex>
                </th>
                <th className="num">
                  <Tex>{String.raw`\Delta w`}</Tex>
                </th>
                <th className="num">
                  新的 <Tex>{'w'}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              {oneStep.map(({ v, out }) => (
                <tr key={v}>
                  <td>{VARIANT_LABEL[v]}</td>
                  <td className="num">{f(out.e, 6)}</td>
                  <td className="num">{f(out.dw, 6)}</td>
                  <td className="num">{f(out.w, 6)}</td>
                </tr>
              ))}
            </tbody>
            <caption>
              LMS 的步伐和誤差成正比（<Tex>{String.raw`e=${texNum(oneStep[0].out.e)}\Rightarrow\Delta w=${texNum(oneStep[0].out.dw)}`}</Tex>）；Sign-Error
              不管誤差多大都只走 <Tex>{String.raw`\mu|x|=${texNum(Math.abs(oneStep[1].out.dw))}`}</Tex>；Huber（<Tex>{String.raw`\delta_H=${CMP.huberDelta}`}</Tex>）把{' '}
              <Tex>{String.raw`e=${texNum(oneStep[2].out.e)}`}</Tex> 截成 <Tex>{texNum(huberPsi(oneStep[2].out.e, CMP.huberDelta))}</Tex>，這一步走{' '}
              <Tex>{texNum(oneStep[2].out.dw)}</Tex>。
            </caption>
          </table>
        </div>
        <ChapterHandCalc id="HC-01.5">
          換一個誤差自己走一步：先算 <Tex>{'e'}</Tex>，再分別換成 <Tex>{'e'}</Tex>、<Tex>{String.raw`\operatorname{sign}(e)`}</Tex>、
          <Tex>{String.raw`\operatorname{clip}(e,\pm\delta_H)`}</Tex>。預設就是上表的例子；把 <Tex>{'y'}</Tex> 改成 <Tex>{'21'}</Tex>（outlier）或{' '}
          <Tex>{'1.5'}</Tex>（小誤差）看看三者的差別。
        </ChapterHandCalc>
        <div className="table-wrap">
          <table className="ch01-table">
            <thead>
              <tr>
                <th>方法</th>
                <th>更新量</th>
                <th>只需 Error Sign？</th>
                <th>注意</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Conventional LMS</td>
                <td>
                  <Tex>{String.raw`\mu ex`}</Tex>
                </td>
                <td>否</td>
                <td>MSE，受 outlier 影響較大</td>
              </tr>
              <tr>
                <td>Sign-Error LMS</td>
                <td>
                  <Tex>{String.raw`\mu\operatorname{sign}(e)x`}</Tex>
                </td>
                <td>是</td>
                <td>
                  MAE 目標；固定步長在最佳值附近以 <Tex>{String.raw`\pm\mu|x|`}</Tex> 的步伐跳動（不會停）；<Tex>{String.raw`\operatorname{sign}(0)`}</Tex> 慣例需明定
                </td>
              </tr>
              <tr>
                <td>Sign-Sign LMS</td>
                <td>
                  <Tex>{String.raw`\mu\operatorname{sign}(e)\operatorname{sign}(x)`}</Tex>
                </td>
                <td>是</td>
                <td>
                  連 Regressor 幅度也丟掉，別和 Sign-Error 混淆 <Erratum id="E43" />
                </td>
              </tr>
              <tr>
                <td>Huber LMS</td>
                <td>
                  <Tex>{String.raw`\mu\operatorname{clip}(e,\pm\delta_H)x`}</Tex>
                </td>
                <td>
                  否（需要 <Tex>{'|e|'}</Tex> 與 <Tex>{'\\delta_H'}</Tex> 比較）
                </td>
                <td>小誤差像 LMS、大誤差像 Sign-Error；規格 §2 列為「後續可做」，本站已實作</td>
              </tr>
            </tbody>
            <caption>規格 §2.3 表格（依勘誤 E43 修正拼字）＋ Huber 列。</caption>
          </table>
        </div>
        <ModeGate min="research">
          <p className="small">
            <ClaimTag kind="exact" /> Sign-Sign 的固定點由 <Tex>{String.raw`E[\operatorname{sign}(e)\operatorname{sign}(x)]=0`}</Tex> 決定，一般而言不等於
            Sign-Error 的 <Tex>{String.raw`E[\operatorname{sign}(e)\,x]=0`}</Tex>（以 <Tex>{'|x|'}</Tex> 加權的中位數）。理由：<Tex>{'x\\ne0'}</Tex> 時{' '}
            <Tex>{String.raw`\tfrac{\partial}{\partial w}\tfrac{|y-wx|}{|x|}=-\operatorname{sign}(e)\operatorname{sign}(x)`}</Tex>，所以 Sign-Sign 是{' '}
            <Tex>{String.raw`E\big|\tfrac{y}{x}-w\big|`}</Tex> 的隨機次梯度法——目標是 <Tex>{'y/x'}</Tex> 的<strong>不加權</strong>中位數。當{' '}
            <Tex>{'|x|'}</Tex> 為常數（例如 <Tex>{String.raw`\pm1`}</Tex> code）時兩者相同。
            數值例：<Tex>{String.raw`\Delta w=${texNum(oneStep[3].out.dw, 6)}`}</Tex>（<Tex>{'x=1'}</Tex> 時與 Sign-Error 一樣）。
          </p>
        </ModeGate>
      </Section>
    </>
  )
}
