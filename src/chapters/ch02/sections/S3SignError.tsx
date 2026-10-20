import { useMemo } from 'react'
import { Callout, ClaimTag, CodeBlock, Derivation, ModeGate, Prereq, Quiz, Section, StepDerivation, Tex, TexBlock, ChRef, ChapterErratum } from '@/components'
import lmsSrc from '@/simulation/models/lms.ts?raw'
import sgdSrc from '@/simulation/models/sgd.ts?raw'
import { conventionalStep, signErrorStep, type TieRule } from '@/simulation/models/lms'
import { GEAR_FLOOR_RATIO, IMPULSIVE_EPS, IMPULSIVE_K, noiseMedian, noiseOps, noisePdfAt, runSignErrorFixedX, signErrorLimitCycle, stepsToTravel, type NoiseKind } from '@/simulation/models/sgd'
import { ChapterLink, Diagram, HandCalcSlot, TieLabel, f4, DerivFold, tm } from '../common'
import { LimitCycleBand } from '../experiments/LimitCycleBand'

const TIES: TieRule[] = ['zero', 'plus', 'minus']

/** 精確算術的穩態：凍結在一點，或在兩點之間跳（集合用 KaTeX 排版；IEEE double 的原始輸出另用等寬字顯示）。 */
function exactSet(lc: { frozen: boolean; lo: number; hi: number }) {
  return lc.frozen ? (
    <>
      凍結在 <Tex>{f4(lc.lo)}</Tex>
    </>
  ) : (
    <Tex>{String.raw`\{${f4(lc.lo)},\ ${f4(lc.hi)}\}`}</Tex>
  )
}

/** 本章四種雜訊形狀（都正規化成標準差 σ_v）：名稱、PDF 與「怎麼讓標準差等於 σ_v」。數值欄由 sgd.ts 的 noiseOps 計算。 */
const NOISE_SHAPES: { kind: NoiseKind; name: string; pdf: string; scale: string }[] = [
  { kind: 'gaussian', name: 'Gaussian（常態）', pdf: String.raw`\dfrac{1}{\sqrt{2\pi}\,\sigma_v}\,\mathrm{e}^{-t^2/(2\sigma_v^2)}`, scale: String.raw`\text{—}` },
  { kind: 'laplacian', name: 'Laplacian（雙指數）', pdf: String.raw`\dfrac{1}{2b}\,\mathrm{e}^{-|t|/b}`, scale: String.raw`b=\sigma_v/\sqrt2` },
  {
    kind: 'impulsive',
    name: 'Impulsive（contaminated Gaussian）',
    pdf: String.raw`${1 - IMPULSIVE_EPS}\,\mathcal N(0,\sigma_b^2)+${IMPULSIVE_EPS}\,\mathcal N\big(0,(${IMPULSIVE_K}\sigma_b)^2\big)`,
    scale: String.raw`\sigma_b=\sigma_v/\sqrt{${1 - IMPULSIVE_EPS}+${IMPULSIVE_EPS}\cdot${IMPULSIVE_K}^2}`,
  },
  { kind: 'skewed', name: 'Skewed（中心化指數，偏斜）', pdf: String.raw`\dfrac{1}{\sigma_v}\,\mathrm{e}^{-(1+t/\sigma_v)}\quad(t\ge-\sigma_v)`, scale: String.raw`v=\sigma_v(T-1),\ T\text{：指數分布}` },
]

/** §3 MAE ⇒ Sign-Error LMS；sign(0)、limit cycle、遞減步長。 */
export function S3SignError() {
  const hand = useMemo(() => {
    const l1 = conventionalStep({ w: 1, x: 1, y: 3, mu: 0.2 })
    const s1 = signErrorStep({ w: 1, x: 1, y: 3, mu: 0.2 })
    const l2 = conventionalStep({ w: l1.w, x: 1, y: 3, mu: 0.2 })
    const s2 = signErrorStep({ w: s1.w, x: 1, y: 3, mu: 0.2 })
    return { l1, s1, l2, s2 }
  }, [])
  const lc = useMemo(() => signErrorLimitCycle(3, 1, 0, 0.4, 'plus'), [])
  // 把上面的手算例子（a = 3、x = 1、w₀ = 1、μ = 0.2）繼續走下去：|δ₀|/h = 10 是整數 ⇒ 精確算術下第 10 步剛好踩到 a
  const handOn = useMemo(() => {
    const ex = signErrorLimitCycle(3, 1, 1, 0.2, 'plus')
    const w = runSignErrorFixedX(3, 1, 1, 30, 0.2, { kind: 'constant', n0: 1 }, 'plus')
    return { ex, w10: w[10], tail: [...new Set([w[29], w[30]])].sort((u, v) => u - v) }
  }, [])
  const tieRows = useMemo(
    () =>
      TIES.map((tie) => {
        const exact = signErrorLimitCycle(3, 2, 1, 0.125, tie)
        const dy = runSignErrorFixedX(3, 2, 1, 40, 0.125, { kind: 'constant', n0: 1 }, tie)
        const t01 = runSignErrorFixedX(3, 2, 1, 40, 0.1, { kind: 'constant', n0: 1 }, tie)
        const t01exact = signErrorLimitCycle(3, 2, 1, 0.1, tie)
        const set = (w: Float64Array) => [...new Set([w[38], w[39], w[40]].map((v) => String(v)))].join(', ')
        return { tie, exact, dy: set(dy), t01: set(t01), t01exact }
      }),
    [],
  )
  const reach = useMemo(
    () => ({
      slow: stepsToTravel(3, 0.01, 1, { kind: 'harmonic', n0: 10 }, 5_000_000),
      ok: stepsToTravel(3, 0.4, 1, { kind: 'harmonic', n0: 20 }),
    }),
    [],
  )
  // 四種雜訊形狀在 σ_v = 1 時的 f_v(0)、中位數、E[sign v]（全部由模型的封閉式計算）
  const shapes = useMemo(
    () =>
      NOISE_SHAPES.map((sh) => {
        const n = { kind: sh.kind, sigma: 1, outlierProb: 0, outlierSize: 0 }
        return { ...sh, f0: noisePdfAt(n, 0), med: noiseMedian(n), signV: noiseOps(n).signMean(0) }
      }),
    [],
  )
  // 思考題 3：a = 3、x = 1、μ = 0.4、w₀ = 0.2（|a − w₀|/h = 7，剛好踩到）——精確算術的解析解 vs IEEE double 的實際模擬
  const q3 = useMemo(
    () =>
      TIES.map((tie) => {
        const ex = signErrorLimitCycle(3, 1, 0.2, 0.4, tie)
        const w = runSignErrorFixedX(3, 1, 0.2, 20, 0.4, { kind: 'constant', n0: 1 }, tie)
        return { tie, ex, w7: w[7], tail: [...new Set([w[19], w[20]])].sort((u, v) => u - v) }
      }),
    [],
  )

  return (
    <section id="ch02-s3">
      <h2>§3 MAE ⇒ Sign-Error LMS（只需要誤差的正負號）</h2>

      <Section id="ch02-sign-intuition" kind="intuition" title="硬體只告訴你「太高」或「太低」">
        <p>
          PLL 校正裡，誤差 <Tex>{'e'}</Tex> 是一個幾 fs 的時間差，量它的大小需要 TDC；但一顆 comparator / bang-bang PD 只輸出
          <Tex>{'q=\\operatorname{sign}(e)\\in\\{+1,-1\\}'}</Tex>（<Tex>{'\\operatorname{sign}'}</Tex> 取正負號：正數給 <Tex>{'+1'}</Tex>、負數給 <Tex>{'-1'}</Tex>；<Tex>{'q'}</Tex> 就是這顆 comparator 的 1-bit 輸出）。如果更新只能用 <Tex>{'q'}</Tex>，等於在最小化什麼？答案是絕對誤差 <Tex>{'|e|'}</Tex>（MAE，<ChRef ch="01">Ch01</ChRef>）。
        </p>
      </Section>

      <Prereq title="次梯度（subgradient）：$|e|$ 在 $e=0$ 的尖角怎麼微分？">
        <p>
          <Tex>{'|t|'}</Tex> 在 <Tex>{'t>0'}</Tex> 的導數是 <Tex>{'+1'}</Tex>，在 <Tex>{'t<0'}</Tex> 是 <Tex>{'-1'}</Tex>，在 <Tex>{'t=0'}</Tex> 有尖角：左導數 <Tex>{'-1'}</Tex>、右導數 <Tex>{'+1'}</Tex>，沒有唯一的切線。但任何斜率 <Tex>{'s\\in[-1,1]'}</Tex> 的直線 <Tex>{'\\ell(t)=s\\,t'}</Tex> 都在圖形下方、並在 0 碰到它——這些 <Tex>{'s'}</Tex> 叫做<strong>次梯度</strong>，集合 <Tex>{'\\partial|t|\\,\\big|_{t=0}=[-1,1]'}</Tex>。凸函數沿任何次梯度的反方向走一小步，與最小值的距離不會變遠，這就足夠做「下山」。
        </p>
        <p>
          所以 <Tex>{'\\operatorname{sign}(0)'}</Tex> 可以是 <Tex>{'[-1,1]'}</Tex> 中任何值——<strong>必須自己規定</strong>。這不是小事，下面會看到它改變結果。
        </p>
      </Prereq>

      <Section id="ch02-subgradient" kind="formula" title="推導：MAE 的隨機次梯度">
        <p>先看結果長什麼樣子：把 §2 的 LMS 迴圈拿來，只在誤差後面插進一顆 comparator。</p>
        <Diagram id="sign-error-loop">
          <p>
            {tm(
              String.raw`先看藍色的方塊：誤差 $e[n]$ 進入更新器之前先通過 $\operatorname{sign}(\cdot)$，只剩下 $+1$ 或 $-1$——這就是 1-bit comparator，輸出叫做 $q[n]$。再看它後面的「$\times\,x[n]$」：因為 $q[n]$ 只有 $\pm1$，這個乘法不需要乘法器，只是「$q=+1$ 時加 $x$、$q=-1$ 時減 $x$」（條件取負，conditional negation）。其餘的方塊——黑盒子、預測、$\times\mu$、累加、$z^{-1}$——和 §2 那張 LMS 迴圈圖完全相同，兩張圖可以對照著看。`,
            )}
          </p>
          <p>{tm(String.raw`圖上的 $q[n]=\operatorname{sign}(e[n])$ 與 $\Delta w[n]$，就是下面 F-02.6 裡的 $\operatorname{sign}(e_n)$ 與 $\mu\operatorname{sign}(e_n)\,x_n$。下面的推導說明：這個迴圈其實是在對絕對誤差 $|e|$ 做梯度下降。`)}</p>
        </Diagram>
        <DerivFold>
          <StepDerivation
            steps={[
              { tex: String.raw`j(w)=|e|,\qquad e=y-wx`, why: '單筆絕對誤差（MAE 的單筆版本）' },
              { tex: String.raw`\frac{d|e|}{de}=\operatorname{sign}(e)\quad(e\neq0)`, why: tm('$|e|$ 的斜率：$e>0$ 時 $+1$，$e<0$ 時 $-1$') },
              { tex: String.raw`\frac{de}{dw}=-x`, why: tm('$e=y-wx$ 對 $w$ 微分') },
              { tex: String.raw`\frac{dj}{dw}=\operatorname{sign}(e)\cdot(-x)=-\operatorname{sign}(e)\,x`, why: '連鎖律' },
              { tex: String.raw`w_{n+1}=w_n-\mu\frac{dj}{dw}=w_n+\mu\operatorname{sign}(e_n)\,x_n`, why: '沿負（次）梯度走一步' },
            ]}
          />
        </DerivFold>
        <TexBlock id="F-02.6">{String.raw`\boxed{w_{n+1}=w_n+\mu\,\operatorname{sign}(e_n)\,x_n}\qquad\operatorname{sign}(0)\text{：數學 }0\text{；comparator }\pm1`}</TexBlock>
        <p>
          和 LMS 唯一的差別：<Tex>{'e_n'}</Tex> 換成 <Tex>{'\\operatorname{sign}(e_n)'}</Tex>。更新量不再與誤差大小成正比，而是<strong>固定大小</strong> <Tex>{'\\mu|x_n|'}</Tex>，只有方向由誤差決定。
          <ChapterErratum id="E40" />
        </p>
      </Section>

      <Section id="ch02-sign-hand" kind="example" title={tm('先算一次：$a=3,\\ x=1,\\ w_0=1,\\ \\mu=0.2$')}>
        <div className="table-wrap">
          <table className="ch02-table">
            <thead>
              <tr>
                <th>步</th>
                <th>LMS：<Tex>{'e'}</Tex></th>
                <th>LMS：<Tex>{'\\Delta w=\\mu e x'}</Tex></th>
                <th>LMS：<Tex>{'w'}</Tex></th>
                <th>Sign-Error：<Tex>{'\\operatorname{sign}(e)'}</Tex></th>
                <th>Sign-Error：<Tex>{'\\Delta w=\\mu\\operatorname{sign}(e)x'}</Tex></th>
                <th>Sign-Error：<Tex>{'w'}</Tex></th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1</td>
                <td className="num">{f4(hand.l1.e)}</td>
                <td className="num">{f4(hand.l1.dw)}</td>
                <td className="num">{f4(hand.l1.w)}</td>
                <td className="num">{f4(Math.sign(hand.s1.e))}</td>
                <td className="num">{f4(hand.s1.dw)}</td>
                <td className="num">{f4(hand.s1.w)}</td>
              </tr>
              <tr>
                <td>2</td>
                <td className="num">{f4(hand.l2.e)}</td>
                <td className="num">{f4(hand.l2.dw)}</td>
                <td className="num">{f4(hand.l2.w)}</td>
                <td className="num">{f4(Math.sign(hand.s2.e))}</td>
                <td className="num">{f4(hand.s2.dw)}</td>
                <td className="num">{f4(hand.s2.w)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          離目標遠時 LMS 走大步（誤差 2 ⇒ 走 0.4），Sign-Error 永遠走 <Tex>{'\\mu|x|=0.2'}</Tex>。靠近目標時正好相反：LMS 的步伐自動變小，Sign-Error 還是 0.2——所以它會<strong>衝過頭</strong>。
        </p>
      </Section>

      <Section id="ch02-limit-cycle" kind="formula" title="固定步長停不下來：limit cycle 的精確解">
        <p>
          每一步都走固定的距離，靠近目標時一定會衝過頭、再被拉回來。固定 <Tex>{'x'}</Tex>、沒有雜訊時，這個「來回跳」可以畫成一張只有三個狀態的圖：
        </p>
        <Diagram id="limit-cycle">
          <p>
            {tm(
              String.raw`先看「等速接近」這個狀態：離 $a$ 還遠時，每一步都朝 $a$ 靠近同樣的距離 $h=\mu|x|$（步長乘上輸入的大小，和誤差多大無關）。走了 $n_c$ 步之後（$n_c$：還沒越過 $a$ 之前能走的整步數），剩下的距離 $\rho$ 已經不到一步，進入紅色的兩個狀態。再看紅色的兩格：從「還沒越過 $a$」再走一步 $h$ 就會越過 $a$；越過之後誤差變號，下一步往回走同樣的 $h$，剛好回到原來的點——所以永遠在這兩點之間來回跳（週期 2）。若起點離 $a$ 本來就不到一步（$n_c=0$），就直接從紅色的狀態開始。`,
            )}
          </p>
          <p>
            {tm(
              String.raw`圖上的 $\delta_0=a-w_0$ 是起點的參數誤差，$\operatorname{sgn}(\delta_0)$ 是它的正負號（起點在 $a$ 的哪一邊）；兩個紅色狀態裡的 $w$ 值，就是下面 F-02.10 大括號裡的兩個點。這張圖假設 $0<\rho<h$；$\rho=0$（剛好踩到 $a$）的情況在後面另外畫。`,
            )}
          </p>
        </Diagram>
        <DerivFold>
          <StepDerivation
            title={tm('固定 $x$、無雜訊（精確算術）')}
            steps={[
              { tex: String.raw`e_n=y-w_nx=(a-w_n)\,x=\delta_n\,x`, why: tm('代入 $y=ax$；$\\delta=a-w$（全站極性）') },
              { tex: String.raw`\operatorname{sign}(e_n)\,x=\operatorname{sign}(\delta_n)\operatorname{sign}(x)\,x=\operatorname{sign}(\delta_n)\,|x|`, why: tm('$\\operatorname{sign}(\\delta x)=\\operatorname{sign}(\\delta)\\operatorname{sign}(x)$，而 $\\operatorname{sign}(x)\\,x=|x|$') },
              { tex: String.raw`\delta_{n+1}=\delta_n-h\operatorname{sign}(\delta_n),\qquad h\equiv\mu|x|`, why: tm('代入更新式：每步朝 0 靠近固定的 $h$') },
              { tex: String.raw`n_c=\Big\lfloor\tfrac{|\delta_0|}{h}\Big\rfloor,\qquad \rho=|\delta_0|-n_c\,h\in[0,h)`, why: tm('前 $n_c$ 步都還沒越過 $a$，每步縮短 $h$；$\\rho$ 是剩下「不到一步」的距離（$\\lfloor\\cdot\\rfloor$ 是無條件捨去）') },
              { tex: String.raw`\delta_{n_c}=\operatorname{sgn}(\delta_0)\,\rho`, why: tm('走了 $n_c$ 步：距離由 $|\\delta_0|$ 變成 $\\rho$，方向還沒變') },
              { tex: String.raw`0<\rho<h:\quad\delta_{n_c+1}=\operatorname{sgn}(\delta_0)(\rho-h)`, why: tm('再走一步：$\\rho-h<0$，越過 $a$、變號，離 $a$ 的距離是 $h-\\rho<h$（$\\rho=0$ 的情況另外討論）') },
              { tex: String.raw`\delta_{n_c+2}=\delta_{n_c+1}+\operatorname{sgn}(\delta_0)\,h=\operatorname{sgn}(\delta_0)\,\rho=\delta_{n_c}`, why: tm('變號後往回走同樣的 $h$：回到原處 $\\Rightarrow$ 週期 2，永遠在這兩點之間跳') },
            ]}
          />
        </DerivFold>
        <TexBlock id="F-02.10">{String.raw`\boxed{w_n\in\big\{a-\operatorname{sgn}(\delta_0)\,\rho,\;a+\operatorname{sgn}(\delta_0)(h-\rho)\big\},\qquad |\delta_n|<h=\mu|x|\quad(n\ge n_c,\ 0<\rho<h)}`}</TexBlock>
        <p>
          例：<Tex>{'a=3,\\ x=1,\\ \\mu=0.4,\\ w_0=0'}</Tex>：<Tex>{String.raw`h=0.4,\ n_c=\lfloor 3/0.4\rfloor=${lc.entryStep},\ \rho=3-${lc.entryStep}\times0.4=${f4(3 - lc.lo)}`}</Tex>，所以 <Tex>{String.raw`w_n\in\{${f4(lc.lo)},\,${f4(lc.hi)}\}`}</Tex>，時間平均 {f4(lc.mean)}。 <ClaimTag kind="exact" />
          注意時間平均 <Tex>{String.raw`a+\operatorname{sgn}(\delta_0)\,(\tfrac h2-\rho)`}</Tex> 一般<strong>不等於</strong> <Tex>{'a'}</Tex>（本例 <Tex>{'\\rho=h/2'}</Tex> 才剛好等於）：偏差可達 <Tex>{'\\pm h/2'}</Tex>，由起點決定。
        </p>
        <HandCalcSlot id="HC-02.2">
          換一組 <Tex>{'a,\\ x,\\ w_0,\\ \\mu'}</Tex>，先自己算出 <Tex>{'n_c'}</Tex>、<Tex>{'\\rho'}</Tex> 和最後來回跳的兩個點，再對答案；算完可以把同一組數字填進下方「動手觀察」的實驗，看模擬是不是停在同樣的兩點。
        </HandCalcSlot>
        <p>
          若 <Tex>{'\\rho=0'}</Tex>（剛好踩到 <Tex>{'a'}</Tex>），下一步的 <Tex>{'e=0'}</Tex>——結果由 <Tex>{'\\operatorname{sign}(0)'}</Tex> 決定：
        </p>
        <Diagram id="tie-rule">
          <p>
            {tm(
              String.raw`先看菱形：誤差剛好是 0 時，$\operatorname{sign}(0)$ 沒有唯一的答案（上面的先備知識框說過，它可以是 $[-1,1]$ 裡的任何值），必須自己規定。再看三條分支：規定成 $0$（數學慣例），更新量是 0，$w$ 永遠停在 $a$；規定成 $+1$ 或 $-1$（comparator 一定要輸出其中一個），$w$ 會被推離 $a$ 一步，下一步誤差不再是 0、又被拉回 $a$，於是在兩點之間跳。`,
            )}
          </p>
          <p>{tm(String.raw`圖上的 $\Delta w=\pm\mu\,x$ 就是把 $\operatorname{sign}(e_n)=\pm1$ 代進 F-02.6 的結果；兩個跳動點的間距仍然是 $h=\mu|x|$。`)}</p>
        </Diagram>
        <p>
          上面手算的例子（<Tex>{'a=3,\\ x=1,\\ w_0=1,\\ \\mu=0.2'}</Tex>）繼續走下去就是這種情況：<Tex>{String.raw`|\delta_0|/h=2/0.2=10`}</Tex> 是整數，精確算術下第 {handOn.ex.entryStep} 步 <Tex>{'w=3'}</Tex>；comparator 慣例（tie 輸出 <Tex>{'+1'}</Tex>）會在 <Tex>{String.raw`\{${f4(handOn.ex.lo)},\ ${f4(handOn.ex.hi)}\}`}</Tex> 之間跳。但實際用 IEEE double 跑，<Tex>{'w_{10}'}</Tex> = <code>{String(handOn.w10)}</code>，最後在 <code>{`{${handOn.tail.map((v) => String(v)).join(', ')}}`}</code> 之間跳——浮點捨入讓結果又不一樣。下表用另一組參數把三種慣例都列出來：
        </p>
        <div className="table-wrap">
          <table className="ch02-table">
            <caption className="ch02-note">
              {tm('$a=3,\\ x=2,\\ w_0=1$。左：$\\mu=0.125$（步長 $h=0.25$ 是二進位精確數）；右：T01 的 $\\mu=0.1$（$h=0.2$ 不是二進位精確數）。數值由 signErrorLimitCycle() 與 runSignErrorFixedX() 計算。')}
            </caption>
            <thead>
              <tr>
                <th>
                  <Tex>{'\\operatorname{sign}(0)'}</Tex> 慣例
                </th>
                <th>{tm('$\\mu=0.125$ 解析（精確算術）')}</th>
                <th>{tm('$\\mu=0.125$ IEEE double 模擬')}</th>
                <th>{tm('$\\mu=0.1$ 解析（精確算術）')}</th>
                <th>{tm('$\\mu=0.1$ IEEE double 模擬')}</th>
              </tr>
            </thead>
            <tbody>
              {tieRows.map((r) => (
                <tr key={r.tie}>
                  <td>
                    <TieLabel tie={r.tie} />
                  </td>
                  <td>{exactSet(r.exact)}</td>
                  <td className="mono">{`{${r.dy}}`}</td>
                  <td>{exactSet(r.t01exact)}</td>
                  <td className="mono">{`{${r.t01}}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Callout kind="warn" title={<>浮點誤差也是一種 tie 慣例 <ChapterErratum id="E40" /></>}>
          <Tex>{'\\mu=0.1'}</Tex> 時，從 <Tex>{'w_0=1'}</Tex> 把步長 <Tex>{'h=0.2'}</Tex> 逐步累加 10 次（<Tex>{String.raw`1+0.2+\cdots+0.2`}</Tex>），IEEE double 得到的是 <code>3.0000000000000004</code>，<Tex>{'e'}</Tex> 是一個 <Tex>{'-10^{-15}'}</Tex> 量級的負數而不是 0，三種慣例都變成在 <Tex>{'2.8'}</Tex> 附近與 <code>3.0000000000000004</code> 之間跳。所以：模擬要明定 tie 規則、不可依賴 <code>Math.sign(0) = 0</code>；驗證「收斂到中位數」時容忍度至少取 <Tex>{'\\mu|x|'}</Tex>，並在報告記錄 tie 慣例與算術（exact／double／fixed-point）。
        </Callout>
      </Section>

      <Section id="ch02-band-lab" kind="explore" title="動手觀察：跳動帶與遞減步長">
        <LimitCycleBand />
      </Section>

      <Section id="ch02-psi" kind="formula" title={tm('有雜訊時：平均更新方向 $\\psi(w)$ 與線性化增益')}>
        <Prereq title="CDF、PDF 與 Gaussian（第一次出現）">
          <p>
            隨機變數 <Tex>{'v'}</Tex> 的<strong>累積分布函數（CDF）</strong> <Tex>{'F_v(t)=P(v\\le t)'}</Tex>，<strong>機率密度（PDF）</strong> <Tex>{"f_v(t)=F_v'(t)"}</Tex>。Gaussian（常態）<Tex>{'v\\sim\\mathcal N(0,\\sigma^2)'}</Tex>：<Tex>{'f_v(t)=\\frac{1}{\\sqrt{2\\pi}\\sigma}\\mathrm{e}^{-t^2/(2\\sigma^2)}'}</Tex>，<Tex>{'F_v(t)=\\Phi(t/\\sigma)'}</Tex>，其中 <Tex>{'\\Phi'}</Tex> 是標準常態 CDF（直立的 <Tex>{'\\mathrm{e}\\approx2.718'}</Tex> 是自然對數的底；斜體的 <Tex>{'e'}</Tex> 在本章永遠是誤差）。
            <strong>中位數</strong>是 <Tex>{'F_v(m)=\\tfrac12'}</Tex> 的點：一半的機率在它左邊、一半在右邊；對稱分布的中位數 = 平均（本章的對稱雜訊都是 0）。
          </p>
        </Prereq>
        <Prereq title="本章用到的四種雜訊形狀：同一個標準差、不同的「尖」與「尾巴」">
          <p>
            為了比較「雜訊形狀」而不是「雜訊大小」，四種雜訊都調成同一個標準差 <Tex>{'\\sigma_v'}</Tex>、平均都是 0。差別在中心有多尖（<Tex>{'f_v(0)'}</Tex>）、尾巴有多重、以及是否對稱：
          </p>
          <div className="table-wrap">
            <table className="ch02-table">
              <thead>
                <tr>
                  <th>形狀</th>
                  <th>
                    PDF <Tex>{'f_v(t)'}</Tex>
                  </th>
                  <th>
                    讓標準差等於 <Tex>{'\\sigma_v'}</Tex> 的參數
                  </th>
                  <th className="num">
                    <Tex>{'f_v(0)\\,\\sigma_v'}</Tex>
                  </th>
                  <th className="num">
                    <Tex>{'\\operatorname{med}(v)/\\sigma_v'}</Tex>
                  </th>
                  <th className="num">
                    <Tex>{'E[\\operatorname{sign}v]'}</Tex>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shapes.map((r) => (
                  <tr key={r.kind}>
                    <td>{r.name}</td>
                    <td>
                      <Tex>{r.pdf}</Tex>
                    </td>
                    <td>
                      <Tex>{r.scale}</Tex>
                    </td>
                    <td className="num">{f4(r.f0)}</td>
                    <td className="num">{f4(Math.abs(r.med) < 1e-12 ? 0 : r.med)}</td>
                    <td className="num">{f4(Math.abs(r.signV) < 1e-12 ? 0 : r.signV)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <StepDerivation
            title={tm('例：Laplacian 的 $b$ 為什麼是 $\\sigma_v/\\sqrt2$（分部積分）')}
            steps={[
              { tex: String.raw`\operatorname{Var}(v)=\int_{-\infty}^{\infty}t^2\,\frac{1}{2b}\mathrm{e}^{-|t|/b}\,dt=\frac1b\int_0^\infty t^2\mathrm{e}^{-t/b}\,dt`, why: tm('平均為 0，所以變異數就是 $E[v^2]$；被積函數是偶函數，只算右半邊再乘 2') },
              { tex: String.raw`\int_0^\infty t^2\mathrm{e}^{-t/b}\,dt=\Big[-b\,t^2\mathrm{e}^{-t/b}\Big]_0^\infty+2b\int_0^\infty t\,\mathrm{e}^{-t/b}\,dt=2b\int_0^\infty t\,\mathrm{e}^{-t/b}\,dt`, why: tm('分部積分（$u=t^2$、$dv=\\mathrm{e}^{-t/b}dt$）；邊界項在兩端都是 0') },
              { tex: String.raw`\int_0^\infty t\,\mathrm{e}^{-t/b}\,dt=\Big[-b\,t\,\mathrm{e}^{-t/b}\Big]_0^\infty+b\int_0^\infty \mathrm{e}^{-t/b}\,dt=b^2`, why: '再分部積分一次' },
              { tex: String.raw`\operatorname{Var}(v)=\frac1b\cdot2b\cdot b^2=2b^2=\sigma_v^2\;\Rightarrow\;b=\frac{\sigma_v}{\sqrt2},\qquad f_v(0)=\frac{1}{2b}=\frac{1}{\sqrt2\,\sigma_v}`, why: tm('同樣的 $\\sigma_v$ 下，Laplacian 在 0 的密度是 Gaussian 的 $\\sqrt\\pi\\approx1.77$ 倍——中心比較尖') },
            ]}
          />
          <p>
            Impulsive 是「混合」：95% 的樣本來自窄的 Gaussian（標準差 <Tex>{'\\sigma_b'}</Tex>），5% 來自寬 10 倍的 Gaussian（偶發大突波）；整體標準差仍是 <Tex>{'\\sigma_v'}</Tex>，所以中心反而很尖。偏斜雜訊 <Tex>{'v=\\sigma_v(T-1)'}</Tex>：<Tex>{'T'}</Tex> 是指數分布（PDF <Tex>{'\\mathrm{e}^{-t}'}</Tex>、<Tex>{'t\\ge0'}</Tex>），平均與標準差都是 1，所以 <Tex>{'v'}</Tex> 平均 0、標準差 <Tex>{'\\sigma_v'}</Tex>；但中位數由 <Tex>{String.raw`F_v(m)=1-\mathrm{e}^{-(1+m/\sigma_v)}=\tfrac12`}</Tex> 解出 <Tex>{String.raw`m=\sigma_v(\ln2-1)\approx-0.307\,\sigma_v`}</Tex>——
            <strong>平均與中位數不同</strong>，這正是 §4 用來分辨 LMS 與 sign 類演算法的工具。實驗裡另外可以加「單邊 outlier」：每筆以機率 <Tex>{'p_{\\rm out}'}</Tex> 在 <Tex>{'v'}</Tex> 上加一個固定的 <Tex>{'s'}</Tex>（平均變成 <Tex>{'p_{\\rm out}s'}</Tex>，中位數幾乎不動）。
          </p>
        </Prereq>
        <p>
          有雜訊時，單獨一步往哪邊走是隨機的，所以改問「平均」：站在某個 <Tex>{'w'}</Tex> 上，平均來說會往哪邊走、走多快？把它記成
          <Tex>{String.raw`\psi(w)=E[\Delta w]/\mu`}</Tex>（平均更新方向）；<Tex>{String.raw`\psi(w^*)=0`}</Tex> 的點 <Tex>{'w^*'}</Tex> 就是固定點（平均來說不再移動的地方）。
        </p>
        <Diagram id="mean-field">
          <p>
            {tm(
              String.raw`先看「真實的迴路」那一框：參數誤差 $d=a-w$（就是 $\delta$，只是取平均時把它當成一個固定的數；和 Ch08 的 update delay 無關）乘上 $x$、加上雜訊 $v$ 得到誤差 $e$，通過紅色的 $\operatorname{sign}(\cdot)$ 只剩 $\pm1$，再乘上 $x$（兩個「$\times x$」用的是同一筆 $x$，所以圖上從同一個來源接出去）、取平均，得到 $\psi_{\rm SE}(w)$（下標 SE：Sign-Error）。紅色那一格是硬的非線性，不能直接用線性系統的工具分析。再看「等效」那一框：只要 $|d\,x|$ 遠小於雜訊的大小 $\sigma_v$，「加雜訊、取 sign、取平均」這一串合起來就像一個線性增益——藍色的 $K_q=2f_v(0)$（$f_v(0)$ 是雜訊在 0 的機率密度，見上面的先備知識框）；再乘上 $E[x^2]$ 就是整條路徑的增益。`,
            )}
          </p>
          <p>{tm(String.raw`圖上兩個框的輸入與輸出相同（前者精確、後者是小誤差時的近似）；等效那一框裡兩格的乘積 $K_q\,E[x^2]$ 就是 F-02.12 的 $K_{\rm SE}$。`)}</p>
        </Diagram>
        <DerivFold>
          <StepDerivation
            title="Sign-Error 的平均更新方向（mean-field）"
            steps={[
              { tex: String.raw`e=(a-w)\,x+v=d\,x+v,\qquad d\equiv a-w`, why: '同 §2' },
              { tex: String.raw`E[\operatorname{sign}(e)\mid x]=P(v>-dx)-P(v<-dx)=1-2F_v(-dx)`, why: tm('固定 $x$，只對雜訊平均；連續雜訊 $P(e=0)=0$，tie 慣例不影響平均') },
              { tex: String.raw`\psi_{\rm SE}(w)\equiv E[\operatorname{sign}(e)\,x]=E_x\big[x\,(1-2F_v(-dx))\big]`, why: tm('再對 $x$ 平均') },
              { tex: String.raw`1-2F_v(-dx)\approx 2f_v(0)\,dx\quad(|dx|\ll\sigma_v)`, why: tm('$F_v(-dx)\\approx F_v(0)-f_v(0)\\,dx$，且對稱雜訊 $F_v(0)=\\tfrac12$') },
              { tex: String.raw`\psi_{\rm SE}(w)\approx 2f_v(0)\,E[x^2]\,d=K_{\rm SE}\,(a-w)`, why: tm('代回去：靠近 $a$ 時像一個增益為 $K_{\\rm SE}$ 的 LMS') },
            ]}
          />
        </DerivFold>
        <TexBlock id="F-02.12">{String.raw`\boxed{K_{\rm SE}=2f_v(0)\,E[x^2]\;\overset{\text{Gaussian}}{=}\;\sqrt{\frac{2}{\pi}}\,\frac{E[x^2]}{\sigma_v}=K_q\,E[x^2]}`}</TexBlock>
        <p>
          <ClaimTag kind="approx" /> 這個 <Tex>{'\\sqrt{2/\\pi}/\\sigma_v'}</Tex> 就是 <ChapterLink ch="05">Ch05</ChapterLink> 1-bit comparator 的等效小訊號增益 <Tex>{'K_q'}</Tex>：雜訊把硬梆梆的 sign 函數「平均」成一條斜率有限的 S 曲線（erf），靠近 0 時像線性。雜訊在這裡是<strong>幫手</strong>（像 dither），它讓 Sign-Error 的平均行為變得平滑；代價是每一步仍然是 <Tex>{'\\pm\\mu|x|'}</Tex> 的隨機跳動。
        </p>
        <p>
          對稱雜訊時 <Tex>{'1-2F_v(-dx)'}</Tex> 與 <Tex>{'dx'}</Tex> 同號，所以 <Tex>{'\\psi_{\\rm SE}(w)=0'}</Tex> 只發生在 <Tex>{'d=0'}</Tex>：固定點 <Tex>{'w^*=a'}</Tex>。雜訊<strong>不對稱</strong>時就不一定了——那是 §4 的主題。
        </p>
      </Section>

      <Section id="ch02-decay" kind="formula" title={tm('修正方法：遞減步長 $\\mu_n=\\mu_0/(1+n/n_0)$')}>
        <p>
          固定步長的兩個「停不下來」：無雜訊時帶寬 <Tex>{'h=\\mu|x|'}</Tex>；有雜訊時穩態變異 <Tex>{'\\propto\\mu'}</Tex>。兩者都正比於 <Tex>{'\\mu'}</Tex>，所以讓 <Tex>{'\\mu_n\\to0'}</Tex>。這裡 <Tex>{'\\mu_n'}</Tex> 是第 <Tex>{'n'}</Tex> 步用的步長，<Tex>{'\\mu_0'}</Tex> 是起始步長，<Tex>{'n_0'}</Tex> 是時間常數（走到第 <Tex>{'n_0'}</Tex> 步時步長剛好減半）。但不能降得太快：
        </p>
        <Diagram id="step-schedule">
          <p>
            {tm(
              String.raw`先看藍色的排程器：它只看步數 $n$，輸出這一步要用的步長 $\mu[n]$；$n$ 越大、$\mu[n]$ 越小。中間的乘法與累加和 Sign-Error 的迴圈相同，只是固定的 $\mu$ 換成了 $\mu[n]$。再看綠色與紅色的兩格，它們是排程必須同時滿足的兩筆帳。綠色：每一步最多走 $\mu[n]\,|x|$，全部加起來就是「最遠能走到哪裡」——這個總和必須是無限大，不然起點太遠就永遠走不到。紅色：每一步都把一筆變異為 $\mu[n]^2\sigma_\eta^2$ 的雜訊加進 $w$（$\sigma_\eta^2$：單步更新方向的變異，叫做梯度雜訊變異），這個總和必須有限，抖動才會停下來。`,
            )}
          </p>
          <p>{tm(String.raw`圖上的兩筆帳就是 F-02.11 的 $\sum\mu_n=\infty$ 與 $\sum\mu_n^2<\infty$；排程器裡的式子就是 F-02.11 的第一項。`)}</p>
        </Diagram>
        <DerivFold>
          <StepDerivation
            title="Robbins–Monro 條件從哪來"
            steps={[
              { tex: String.raw`|w_N-w_0|\le\sum_{n<N}\mu_n|x_n|`, why: tm('Sign-Error 每步最多移動 $\\mu_n|x_n|$（三角不等式）') },
              { tex: String.raw`\sum_n\mu_n=\infty`, why: tm('否則總移動距離有上限：起點離 $w^*$ 太遠就永遠走不到（stall）') },
              { tex: String.raw`\operatorname{Var}\bigl(\sum_n\mu_n\eta_n\bigr)=\sigma_\eta^2\sum_n\mu_n^2<\infty`, why: tm('獨立的梯度雜訊 $\\eta_n$ 被 $\\mu_n$ 加權累加：變異有限，抖動才會收斂') },
              { tex: String.raw`\sum_{n=0}^{N-1}\frac{\mu_0}{1+n/n_0}\approx\int_0^N\frac{\mu_0\,dn}{1+n/n_0}=\mu_0n_0\ln\!\Big(1+\frac{N}{n_0}\Big)`, why: tm('和用積分近似：發散（$\\sum\\mu_n=\\infty$），但只以 $\\ln N$ 的速度') },
              { tex: String.raw`\sum_n\frac{\mu_0^2}{(1+n/n_0)^2}\approx\mu_0^2n_0<\infty`, why: tm('$\\int_0^\\infty dn/(1+n/n_0)^2=n_0$：收斂') },
              { tex: String.raw`\mu_0n_0|x|\ln\!\Big(1+\frac{N}{n_0}\Big)\ge D\iff N\ge n_0\big(\mathrm{e}^{D/(\mu_0n_0|x|)}-1\big)`, why: tm('要走完距離 $D=|a-w_0|$ 需要的步數：對 $D$ 是指數！') },
            ]}
          />
        </DerivFold>
        <TexBlock id="F-02.11">{String.raw`\boxed{\mu_n=\frac{\mu_0}{1+n/n_0},\qquad \sum\mu_n=\infty,\ \ \sum\mu_n^2<\infty,\qquad N_{\rm reach}\approx n_0\big(\mathrm{e}^{D/(\mu_0n_0|x|)}-1\big)}`}</TexBlock>
        <p>
          <ClaimTag kind="approx" /> 數字：<Tex>{'\\mu_0=0.4,\\ n_0=20,\\ D=3'}</Tex>：<Tex>{'D/(\\mu_0n_0)=0.375'}</Tex>，實際只要 {reach.ok} 步；但 <Tex>{'\\mu_0=0.01,\\ n_0=10'}</Tex>：<Tex>{'D/(\\mu_0n_0)=30'}</Tex>，需要 <Tex>{'\\approx10\\,\\mathrm{e}^{30}'}</Tex> 步（程式在 <Tex>{'5\\times10^6'}</Tex> 步內{Number.isFinite(reach.slow) ? `需要 ${reach.slow} 步` : '走不到'}）。工程規則：<strong>先用固定的 <Tex>{'\\mu'}</Tex> 粗調到 <Tex>{'w^*'}</Tex> 附近，再開始衰減</strong>（gear-shift：每 <Tex>{'n_0'}</Tex> 步右移一位，並設下限 <Tex>{'\\mu_{\\min}'}</Tex> 以保留追蹤 PVT 漂移的能力，<ChRef ch="14">Ch14</ChRef>）。
        </p>
        <Diagram id="gear-shift">
          <p>
            {tm(
              String.raw`先看「粗調」：前 $n_0$ 步用最大的步長 $\mu_0$，等速趕路。再看「換檔」：每過 $n_0$ 步把步長右移一位（除以 2）——硬體上只是改變 shift 的位數，不需要除法器。最後停在「追蹤」：步長降到下限 $\mu_{\min}$ 就不再變小，保留追蹤溫度與電壓漂移的能力。`,
            )}
          </p>
          <p>
            {tm(
              String.raw`圖上的三個狀態就是本站模擬用的 gear 排程（sgd.ts 裡 stepSize() 的 gear 分支）：$\mu_n=\max\!\big(\mu_0\,2^{-\lfloor n/n_0\rfloor},\ \mu_{\min}\big)$，本站取 $\mu_{\min}=\mu_0/${1 / GEAR_FLOOR_RATIO}$（最多右移 ${Math.log2(1 / GEAR_FLOOR_RATIO)} 位）。和上一張圖的排程 $\mu_0/(1+n/n_0)$ 相比，它是階梯狀地變小，而且有下限——所以它不滿足「總和有限」那筆帳，穩態仍有一點抖動，換來的是追蹤能力。`,
            )}
          </p>
        </Diagram>
        <HandCalcSlot id="HC-02.3">
          這一題需要工程計算機的 <Tex>{'\\ln'}</Tex> 與 <Tex>{'\\mathrm{e}^x'}</Tex>。換成你自己的 <Tex>{'\\mu_0,\\ n_0,\\ D'}</Tex>，先算第 <Tex>{'n'}</Tex> 步的步長與帶寬，再算走完距離 <Tex>{'D'}</Tex> 要幾步；把 <Tex>{'D'}</Tex> 加倍再算一次，親手感受「指數代價」。
        </HandCalcSlot>
        <ModeGate min="research">
          <Derivation
            title={tm('研究：$\\mu_n\\approx c/n$ 的收斂速率（為什麼需要 $2cK>1$）')}
            formulaId="F-02.17"
            claim="approx"
            level="L0"
            defaultOpen
            derivation={
              <>
                <StepDerivation
                  steps={[
                    { tex: String.raw`\delta_{n+1}\approx\Big(1-\frac{cK}{n}\Big)\delta_n+\frac{c}{n}\eta_n,\qquad c=\mu_0n_0`, why: tm('線性化（F-02.12），$n\\gg n_0$ 時 $\\mu_n\\approx c/n$') },
                    { tex: String.raw`V_{n+1}\approx\Big(1-\frac{2cK}{n}\Big)V_n+\frac{c^2\sigma_\eta^2}{n^2},\qquad V_n\equiv E[\delta_n^2]`, why: tm('平方後取期望；$\\eta_n$ 與 $\\delta_n$ 獨立、零均值；丟掉 $V_n/n^2$ 項') },
                    { tex: String.raw`V_n=\frac{A}{n}\;\Rightarrow\;\frac{A}{n}-\frac{A}{n^2}\approx\frac{A}{n}-\frac{2cKA}{n^2}+\frac{c^2\sigma_\eta^2}{n^2}`, why: tm('猜 $V_n=A/n$，並用 $1/(n+1)\\approx1/n-1/n^2$') },
                    { tex: String.raw`A\,(2cK-1)=c^2\sigma_\eta^2\;\Rightarrow\;E[\delta_n^2]\approx\frac{c^2\sigma_\eta^2}{(2cK-1)\,n}`, why: tm('比較 $1/n^2$ 的係數；需要 $2cK>1$，否則 $V_n$ 衰減得比 $1/n$ 慢（約 $n^{-2cK}$）') },
                  ]}
                />
                <TexBlock id="F-02.17">{String.raw`E[\delta_n^2]\approx\frac{c^2\sigma_\eta^2}{(2cK-1)\,n}\quad(2cK>1)`}</TexBlock>
              </>
            }
            assumptions={[String.raw`線性化（$\mu_n x^2\ll\sigma_v$）`, String.raw`$\eta_n$ iid、與 $\delta_n$ 獨立`, String.raw`只看 $n\gg n_0$ 的漸近行為`]}
          />
        </ModeGate>
      </Section>

      <ModeGate min="engineer">
        <Section id="ch02-sign-code" kind="formula" title="核心程式碼：步長排程與 Sign-Error 單步">
          <CodeBlock source={sgdSrc} region="stepSchedule" path="src/simulation/models/sgd.ts" />
          <CodeBlock
            source={sgdSrc}
            region="harmonicReach"
            path="src/simulation/models/sgd.ts"
            caption={String.raw`手算題 HC-02.3 用的兩個封閉式（F-02.11）：把和換成積分（和 $\ge$ 積分），所以距離略為低估，實際步數不超過近似值的無條件進位 $\lceil N_{\rm reach}\rceil$；逐步累加的精確值由 travelDistance() 與 stepsToTravel() 計算。`}
          />
          <CodeBlock source={lmsSrc} region="sign" path="src/simulation/models/lms.ts" caption={String.raw`$\operatorname{sign}(0)$ 的慣例寫死在函式參數裡（E40），不依賴 JavaScript 的 Math.sign(0)。`} />
          <CodeBlock source={sgdSrc} region="limitCycle" path="src/simulation/models/sgd.ts" caption="上方 limit-cycle 表格與實驗的解析值就是這段。" />
        </Section>
      </ModeGate>

      <Quiz
        title="思考題 3（剛好踩到）"
        question={
          <>
            <Tex>{'a=3,\\ x=1,\\ \\mu=0.4,\\ w_0=0.2'}</Tex>，無雜訊、精確算術。Sign-Error 最後在哪裡跳動？
          </>
        }
        options={[
          { label: <Tex>{String.raw`\text{一定是 }\{2.8,\ 3.2\}`}</Tex> },
          {
            label: (
              <>
                取決於 <Tex>{String.raw`\operatorname{sign}(0)`}</Tex> 的慣例：凍結在 <Tex>{'3'}</Tex>、<Tex>{String.raw`\{3,\ 3.4\}`}</Tex> 或 <Tex>{String.raw`\{2.6,\ 3\}`}</Tex>
              </>
            ),
            correct: true,
          },
          { label: '會收斂到 3' },
          { label: '會發散' },
        ]}
        answer={
          <>
            <p>
              <Tex>{String.raw`|a-w_0|/h=2.8/0.4=7`}</Tex> 是整數，<Tex>{'\\rho=0'}</Tex>：精確算術下第 7 步剛好 <Tex>{String.raw`w=3,\ e=0`}</Tex>，下一步由 <Tex>{String.raw`\operatorname{sign}(0)`}</Tex> 決定。右欄是用 IEEE double 實際跑 <code>runSignErrorFixedX()</code> 的結果：<Tex>{String.raw`0.2+7\times0.4`}</Tex> 的累加未必剛好是 3（E40）。
            </p>
            <div className="table-wrap">
              <table className="ch02-table">
                <thead>
                  <tr>
                    <th>慣例</th>
                    <th>精確算術（解析）</th>
                    <th className="num">
                      IEEE：<Tex>{'w_7'}</Tex>
                    </th>
                    <th>IEEE：最後兩步</th>
                  </tr>
                </thead>
                <tbody>
                  {q3.map((r) => (
                    <tr key={r.tie}>
                      <td>
                        <TieLabel tie={r.tie} />
                      </td>
                      <td>{exactSet(r.ex)}</td>
                      <td className="num mono">{String(r.w7)}</td>
                      <td className="mono">{`{${r.tail.map((v) => String(v)).join(', ')}}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        }
      />
    </section>
  )
}
