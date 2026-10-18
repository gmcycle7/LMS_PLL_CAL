import { useMemo, type ReactNode } from 'react'
import type { Data, Layout } from 'plotly.js-cartesian-dist-min'
import {
  ClaimTag,
  CodeCompare,
  ModeGate,
  Plot,
  Prereq,
  Section,
  SourceTag,
  StepDerivation,
  Tex,
  TexBlock,
  useThemeTokens,
  type CodeCompareItem,
} from '@/components'
import { useSettings } from '@/app/settings'
import { VARIANT_LABEL, conventionalStep, runScalarLms, signErrorStep, type LmsVariant, type TieRule } from '@/simulation/models/lms'
import lmsSrc from '@/simulation/models/lms.ts?raw'
import { comparatorTeaser, directionProbabilityClt, signTieDemo } from '../model'
import { num, pct, texNum, texRes } from '../format'
import { ChapterDiagram, ChapterHandCalc, ErratumNote, ErratumRef, FigRef, Observe, PageLink } from '../common'

const COMPARE_SEED = 20261010
/** 固定的版面物件（模組層級，避免每次 render 產生新參照而讓 Plot 重畫） */
const COMPARE_LAYOUT: Partial<Layout> = { xaxis: { title: { text: '$n$' } }, yaxis: { title: { text: '$w_n$' } } }
const VARIANTS: LmsVariant[] = ['conventional', 'sign_error', 'sign_sign']
/** 同一組資料的三種更新比較（ChatGPT 入門課第 3 課的設定） */
const CMP = { a: 3, w0: 1, mu: 0.05, steps: 300, sigmaV: 0.3 }
/** 勘誤 E40 示範：T01 的 a、w0、x，兩個步長 */
const TIE = { a: 3, w0: 1, x: 2, steps: 40, muExact: 0.125, muT01: 0.1 }
/** 「同一步、兩種更新」的手算例：a = 3, x = 1, w = 1, μ = 0.2（ChatGPT 入門課第 3 課；HC-00.7 的預設值） */
export const SIGN_ONE_STEP = { w: 1, x: 1, y: 3, mu: 0.2 }
/** 比較器預告：1 fs 誤差、100 fs RMS 雜訊（規格 §5） */
const COMP = { sFs: 1, sigmaFs: 100 }
const TIE_LABEL: Record<TieRule, ReactNode> = {
  zero: (
    <>
      <Tex>{'\\mathrm{sign}(0)=0'}</Tex>（數學次梯度）
    </>
  ),
  plus: (
    <>
      <Tex>{'\\mathrm{sign}(0)=+1'}</Tex>（硬體 comparator：平手時輸出 <Tex>{'+1'}</Tex>）
    </>
  ),
  minus: (
    <>
      <Tex>{'\\mathrm{sign}(0)=-1'}</Tex>（硬體 comparator：平手時輸出 <Tex>{'-1'}</Tex>）
    </>
  ),
}

/** 把 tail 的值整理成「停在 3」或「在 2.75 與 3 之間跳」這種描述（由模擬結果產生）。 */
function describeTail(tail: number[]): ReactNode {
  const vals = [...new Set(tail)].sort((p, q) => p - q)
  if (vals.length === 1) return <>停在 <Tex>{texRes(vals[0], 17)}</Tex></>
  return (
    <>
      在 {vals.map((v, i) => (
        <span key={v}>
          <Tex>{texRes(v, 17)}</Tex>
          {i < vals.length - 1 ? ' 與 ' : ''}
        </span>
      ))}{' '}
      之間跳
    </>
  )
}

/** §0.9 預告：只看誤差的正負號也能學嗎？ */
export function SignTeaserSection() {
  const { atLeast } = useSettings()
  const tokens = useThemeTokens()
  // 一步的手算比較（SIGN_ONE_STEP）
  const one = useMemo(() => {
    const s = SIGN_ONE_STEP
    return { s, lms: conventionalStep(s), sign: signErrorStep(s) }
  }, [])
  // 同一組資料比較三種更新（Gaussian x、σ_v = 0.3、μ = 0.05、同 seed）
  const runs = useMemo(
    () =>
      VARIANTS.map((variant) => ({
        variant,
        r: runScalarLms({
          variant,
          a: CMP.a,
          w0: CMP.w0,
          mu: CMP.mu,
          steps: CMP.steps,
          x: { kind: 'gaussian', sigma: 1 },
          noiseSigma: CMP.sigmaV,
          tie: 'plus',
          seed: COMPARE_SEED,
        }),
      })),
    [],
  )
  const compareData: Data[] = useMemo(() => {
    const n = Array.from({ length: CMP.steps + 1 }, (_, i) => i)
    return [
      ...runs.map(({ variant, r }, i) => ({ x: n, y: Array.from(r.w), name: VARIANT_LABEL[variant], mode: 'lines' as const, line: { color: tokens.series[i] } })),
      { x: [0, CMP.steps], y: [CMP.a, CMP.a], name: String.raw`真實 $a = ${texRes(CMP.a)}$`, mode: 'lines' as const, line: { dash: 'dash' as const, color: tokens.textMuted } },
    ]
  }, [runs, tokens])

  // 勘誤 E40：sign(0) 慣例；μ = 0.125 在二進位可精確表示，μ = 0.1 不行
  const tieExact = useMemo(() => signTieDemo({ a: TIE.a, w0: TIE.w0, x: TIE.x, mu: TIE.muExact, steps: TIE.steps }), [])
  const tieT01 = useMemo(() => signTieDemo({ a: TIE.a, w0: TIE.w0, x: TIE.x, mu: TIE.muT01, steps: TIE.steps }), [])
  // μ = 0.1 時一路加 μ·x = 0.2 上去，第一次越過 a 的那個 double（不是剛好 3）
  const t01Overshoot = useMemo(() => Math.max(...tieT01.zero.tail), [tieT01])
  const comp = useMemo(() => comparatorTeaser(COMP.sFs, COMP.sigmaFs), [])
  const nList = [101, 1001, 10001]
  // CLT 推導的數值例：取 N = 10001
  const cltN = nList[nList.length - 1]
  const cltZ = (comp.meanQ * Math.sqrt(cltN)) / Math.sqrt(1 - comp.meanQ * comp.meanQ)

  const codeItems: CodeCompareItem[] = [
    { label: 'Conventional LMS', source: lmsSrc, region: 'conventionalStep', path: 'src/simulation/models/lms.ts', note: '用誤差的大小：需要多位元的 $e$。' },
    { label: 'Sign-Error LMS', source: lmsSrc, region: 'signErrorStep', path: 'src/simulation/models/lms.ts', note: String.raw`只用 $\mathrm{sign}(e)$：1-bit 比較器就夠。` },
  ]
  if (atLeast('engineer')) {
    codeItems.push({ label: 'Sign-Sign LMS', source: lmsSrc, region: 'signSignStep', path: 'src/simulation/models/lms.ts', note: '連 $x$ 也只剩正負號。' })
  }

  return (
    <Section kind="intuition" level={2} id="ch00-sign" title="§0.9 預告：只知道誤差的「正負號」也能學嗎？">
      <p>
        在 PLL 裡，PD 輸出的相位誤差 <Tex>{'e'}</Tex> 通常只被一顆 <strong>1-bit 比較器</strong>看見：它只告訴你「早了還是晚了」（<Tex>{'+1'}</Tex> 或{' '}
        <Tex>{'-1'}</Tex>），不告訴你差多少。把比較器的輸出記為 <Tex>{'q_n=\\mathrm{sign}(e_n)'}</Tex>：<Tex>{'e_n>0'}</Tex> 時是 <Tex>{'+1'}</Tex>、
        <Tex>{'e_n<0'}</Tex> 時是 <Tex>{'-1'}</Tex>。把更新式裡的 <Tex>{'e'}</Tex> 換成它的正負號，就是 <strong>Sign-Error LMS</strong>。先看兩者的硬體差在哪裡：
      </p>
      <ChapterDiagram name="CHART_LMS_VS_SIGN">
        <p>
          先看「Conventional LMS」那一框：要算 <Tex>{'e[n]\\,x[n]'}</Tex>，誤差必須是多位元的數字（前面要有 ADC 或 TDC），而且要一個真正的乘法器（紅色）。再看「Sign-Error
          LMS」那一框：誤差先進 1-bit 比較器變成 <Tex>{'q[n]'}</Tex>，「乘法」就退化成藍色的<strong>條件變號</strong>——<Tex>{'q_n=+1'}</Tex> 時原封不動送出 <Tex>{'x_n'}</Tex>，
          <Tex>{'q_n=-1'}</Tex> 時送出 <Tex>{'-x_n'}</Tex>。兩框從「<Tex>{'\\times\\,\\mu'}</Tex>」開始完全相同。
        </p>
        <p>
          圖上兩條送進「<Tex>{'\\times\\,\\mu'}</Tex>」的線 <Tex>{'e[n]\\,x[n]'}</Tex> 與 <Tex>{'q[n]\\,x[n]'}</Tex>，就是下面兩條更新式裡唯一不同的那個因子：<Tex>{'e_n\\,x_n'}</Tex> 與{' '}
          <Tex>{'\\mathrm{sign}(e_n)\\,x_n'}</Tex>。
        </p>
      </ChapterDiagram>
      <div id="ch00-sign-formula">
        <TexBlock>{String.raw`w_{n+1}=w_n+\mu\,\mathrm{sign}(e_n)\,x_n\qquad\text{vs.}\qquad w_{n+1}=w_n+\mu\,e_n\,x_n`}</TexBlock>
      </div>
      <StepDerivation
        title={
          <>
            同一步、兩種更新（<Tex>{`a=${texNum(one.s.y / one.s.x)},\\ x=${one.s.x},\\ w=${one.s.w},\\ \\mu=${one.s.mu}`}</Tex>，<Tex>{`y=ax=${texNum(one.s.y)}`}</Tex>）
          </>
        }
        steps={[
          { tex: String.raw`e=y-wx=${texNum(one.s.y)}-${texNum(one.s.w)}\times${texNum(one.s.x)}=${texNum(one.lms.e)}`, why: '兩者的誤差一樣。' },
          {
            tex: String.raw`\text{LMS: }w\leftarrow ${texNum(one.s.w)}+${texNum(one.s.mu)}\times${texNum(one.lms.e)}\times${texNum(one.s.x)}=${texRes(one.lms.w)}`,
            why: '誤差大，步伐就大。',
          },
          {
            tex: String.raw`\text{Sign: }w\leftarrow ${texNum(one.s.w)}+${texNum(one.s.mu)}\times\mathrm{sign}(${texNum(one.sign.e)})\times${texNum(one.s.x)}=${texRes(one.sign.w)}`,
            why: '不管誤差多大，步伐固定（只看方向）。',
          },
        ]}
      />
      <CodeCompare items={codeItems} caption="三段都是 src/simulation/models/lms.ts 的實際程式碼；標「← 差異」的那一行就是唯一不同的地方。" />
      <ChapterHandCalc id="HC-00.7">
        把 <Tex>{'w,\\ x,\\ y,\\ \\mu'}</Tex> 換成你自己的數字，先用紙筆各算一步，看看這一次是 LMS 還是 Sign-Error 走得比較遠（提示：比較{' '}
        <Tex>{'|e|'}</Tex> 和 <Tex>{'1'}</Tex>），再和網站對答案。
      </ChapterHandCalc>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>演算法</th>
              <th>更新量</th>
              <th>需要的誤差資訊</th>
              <th>對應的目標</th>
              <th>行為</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Conventional LMS</td>
              <td>
                <Tex>{'\\mu\\,e\\,x'}</Tex>
              </td>
              <td>
                <Tex>{'e'}</Tex> 的大小與正負（多位元 ADC/TDC）
              </td>
              <td>
                最小化 <Tex>{'\\tfrac12E[e^2]'}</Tex>（MSE）
              </td>
              <td>越接近越慢，可平滑收斂；outlier 影響大</td>
            </tr>
            <tr>
              <td>Sign-Error LMS</td>
              <td>
                <Tex>{'\\mu\\,\\mathrm{sign}(e)\\,x'}</Tex>
              </td>
              <td>只要正負號（1-bit 比較器）</td>
              <td>
                最小化 <Tex>{'E|e|'}</Tex>（MAE）
              </td>
              <td>
                固定步長，在答案附近 <Tex>{'\\pm\\mu|x|'}</Tex> 跳動
              </td>
            </tr>
            <tr>
              <td>Sign-Sign LMS</td>
              <td>
                <Tex>{'\\mu\\,\\mathrm{sign}(e)\\,\\mathrm{sign}(x)'}</Tex>
              </td>
              <td>
                <Tex>{'e'}</Tex> 與 <Tex>{'x'}</Tex> 都只要正負號
              </td>
              <td>
                只有一個係數時等於最小化 <Tex>{'E\\big[|e|/|x|\\big]'}</Tex>（因為 <Tex>{'\\tfrac{d}{dw}\\tfrac{|e|}{|x|}=-\\mathrm{sign}(e)\\,\\mathrm{sign}(x)'}</Tex>）；多個係數時沒有對應的單一成本函數
              </td>
              <td>
                硬體最省；丟掉 <Tex>{'x'}</Tex> 的幅度資訊
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <Plot
        title={String.raw`同一組資料、三種更新（Gaussian $x$、$\sigma_v=${CMP.sigmaV}$、$\mu=${CMP.mu}$、同 seed）`}
        ariaLabel="同一組資料、三種更新的 w_n 軌跡"
        csvName="ch00-variant-compare"
        data={compareData}
        layout={COMPARE_LAYOUT}
        height={280}
        caption={
          <>
            由 <code>runScalarLms</code> 對三種 variant 各跑一次（同一個 seed，所以三者看到完全相同的 <Tex>{'x_n'}</Tex> 與 <Tex>{'v_n'}</Tex>；
            <Tex>{'\\mathrm{sign}(0)'}</Tex> 取 <Tex>{'+1'}</Tex>）。
          </>
        }
      />
      <p className="small">
        <SourceTag kind="simulation" /> 三者都走向 <Tex>{`a=${texNum(CMP.a)}`}</Tex>，但路徑不同：Sign 類的步伐不隨誤差縮小，所以接近答案後的抖動與收斂速度由 <Tex>{'\\mu'}</Tex> 直接決定。兩者最後停的位置也不一定相同（MSE 的最佳點是平均、MAE 是中位數），<PageLink id="ch01" /> 與 <PageLink id="ch02" /> 會仔細比較。
      </p>

      <h3>
        <Tex>{'\\mathrm{sign}(0)'}</Tex> 要定義清楚
      </h3>
      <p>
        當 <Tex>{'e'}</Tex> 剛好是 0 時，<Tex>{'\\mathrm{sign}(0)'}</Tex> 該是多少？數學上的次梯度取 0，硬體比較器卻只能輸出{' '}
        <Tex>{'\\pm1'}</Tex>。用 <code>runScalarLms</code> 跑 Sign-Error（
        <Tex>{`a=${texNum(TIE.a)},\\ w_0=${texNum(TIE.w0)},\\ x=${texNum(TIE.x)}`}</Tex>，<Tex>{String(TIE.steps)}</Tex> 步），看最後 4 個{' '}
        <Tex>{'w'}</Tex>（每一步固定走 <Tex>{'\\pm\\mu|x|'}</Tex>）：
      </p>
      <div className="table-wrap">
        <table className="ch00-num-table">
          <thead>
            <tr>
              <th>
                <Tex>{'\\mathrm{sign}(0)'}</Tex> 慣例
              </th>
              <th className="num">
                <Tex>{`\\mu=${TIE.muExact}`}</Tex>（二進位可精確表示）
              </th>
              <th className="num">
                <Tex>{`\\mu=${TIE.muT01}`}</Tex>（T01 參數，浮點誤差）
              </th>
            </tr>
          </thead>
          <tbody>
            {(['zero', 'plus', 'minus'] as TieRule[]).map((t) => (
              <tr key={t}>
                <td>{TIE_LABEL[t]}</td>
                <td className="num">{tieExact[t].tail.map((v) => String(v)).join(', ')}</td>
                <td className="num ch00-num-list">{tieT01[t].tail.map((v) => String(v)).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ErratumNote eid="E40">
        <Tex>{'\\mathrm{sign}(0)'}</Tex> 的慣例必須明定：<Tex>{`\\mu=${TIE.muExact}`}</Tex>（步長 <Tex>{`\\mu x=${texNum(TIE.muExact * TIE.x)}`}</Tex>{' '}
        是 2 的負次方）時 <Tex>{'w'}</Tex> 會剛好落在 <Tex>{texNum(TIE.a)}</Tex>、<Tex>{'e=0'}</Tex>，三種慣例分別{' '}
        {(['zero', 'plus', 'minus'] as TieRule[]).map((t, i) => (
          <span key={t}>
            「{describeTail(tieExact[t].tail)}」{i < 2 ? '／' : ''}
          </span>
        ))}
        ；<Tex>{`\\mu=${TIE.muT01}`}</Tex> 時，從 <Tex>{texNum(TIE.w0)}</Tex> 一路加 <Tex>{`\\mu x=${texNum(TIE.muT01 * TIE.x)}`}</Tex>{' '}
        在浮點下第一次越過時落在 <code>{String(t01Overshoot)}</code>（不是剛好 <Tex>{texNum(TIE.a)}</Tex>：0.1、0.2 都無法用二進位精確表示），<Tex>{'e'}</Tex>{' '}
        永遠不會剛好是 0，三種慣例看起來一樣。模擬不可依賴 <code>Math.sign(0) = 0</code> 的隱含行為；本站的 <code>sgn(v, tie)</code> 一律明確指定。
      </ErratumNote>

      <h3>1-bit 比較器 + 很多筆平均 = GMAC</h3>
      <p>
        §0.7 說「平均可以把雜訊壓下去」。把它用在 1-bit 的 <Tex>{'q=\\mathrm{sign}(e)'}</Tex> 上：假設真正的誤差只有{' '}
        <Tex>{`s=${texNum(COMP.sFs)}\\,\\mathrm{fs}`}</Tex>，但比較器前的雜訊有 <Tex>{`\\sigma_v=${texNum(COMP.sigmaFs)}\\,\\mathrm{fs}`}</Tex> RMS。
      </p>
      <Prereq title={String.raw`用到的機率：Gaussian 的累積分布函數 $\Phi$ 與中央極限定理（CLT）`}>
        <p>
          <Tex>{'\\Phi(z)=P(Z\\le z)'}</Tex> 是標準常態 <Tex>{'Z\\sim\\mathcal N(0,1)'}</Tex> 的累積分布函數（§0.7 的高斯先備知識框）。兩個性質：對稱{' '}
          <Tex>{'P(Z>-z)=\\Phi(z)'}</Tex>；縮放 <Tex>{'v=\\sigma_vZ\\Rightarrow P(v>-s)=\\Phi(s/\\sigma_v)'}</Tex>。
        </p>
        <p>
          <strong>CLT</strong>：<Tex>{'N'}</Tex> 個 iid 的量 <Tex>{'Z_i'}</Tex>（平均 <Tex>{'m_Z'}</Tex>、變異數 <Tex>{'\\sigma_Z^2'}</Tex>）加總成{' '}
          <Tex>{'S_N=\\sum_{i=1}^{N}Z_i'}</Tex>，當 <Tex>{'N'}</Tex> 夠大時近似 <Tex>{'\\mathcal N(Nm_Z,\\,N\\sigma_Z^2)'}</Tex>（平均 <Tex>{'\\propto N'}</Tex>、標準差{' '}
          <Tex>{'\\propto\\sqrt N'}</Tex>，正是 §0.7 的 <Tex>{'1/\\sqrt N'}</Tex> 法則）。這是近似，不是等式：<Tex>{'q=\\pm1'}</Tex> 的和其實是二項分布，精確值與平手（tie）規則在 <PageLink id="ch05" />。
        </p>
      </Prereq>
      <p>
        誤差比雜訊小 <Tex>{`${texNum(COMP.sigmaFs / COMP.sFs)}`}</Tex> 倍，比較器的每一個輸出幾乎都是雜訊決定的。那一點點方向資訊藏在哪裡、要怎麼拿出來？先看訊號怎麼流：
      </p>
      <ChapterDiagram name="CHART_COMPARATOR_AVERAGE">
        <p>
          先看「單獨一筆」那一框：很小的 <Tex>{'s'}</Tex>（圖上設 <Tex>{'s>0'}</Tex>；<Tex>{'s<0'}</Tex> 時左右對稱、方向相反）加上很大的雜訊 <Tex>{'v'}</Tex>（紅色）才是比較器真正看到的 <Tex>{'e'}</Tex>，所以單獨一個輸出 <Tex>{'q'}</Tex>{' '}
          幾乎是丟銅板。但比較器輸出 <Tex>{'+1'}</Tex> 的機率比一半多一點點，所以 <Tex>{'q'}</Tex> 的平均不是 0，而是一個很小的正數，記為 <Tex>{'m_q=E[q]'}</Tex>
          ——這就是兩框之間那條線上寫的東西。再看「累加 N 筆」那一框：把 <Tex>{'N'}</Tex> 筆 <Tex>{'q'}</Tex> 加起來的<strong>總和</strong>記為 <Tex>{'S_N'}</Tex>。最後看綠色那一格：只要 <Tex>{'S_N'}</Tex> 的平均 <Tex>{'Nm_q'}</Tex> 比它的標準差大得多，<Tex>{'S_N'}</Tex> 的正負號就幾乎一定和 <Tex>{'s'}</Tex> 相同。
        </p>
        <p>
          圖上寫的每一個統計量，就是下面推導的一行：比較器那格的「<Tex>{'\\Phi(s/\\sigma_v)'}</Tex>」是第 1 步、兩框之間的「平均 <Tex>{'m_q'}</Tex>」是第 2 步、累加那格的「<Tex>{'S_N'}</Tex>{' '}
          的平均與標準差」是第 4 步、綠色那格是第 5 步的結果。<Tex>{'\\Phi'}</Tex> 是標準常態的累積分布函數（上面的先備知識框）。
        </p>
      </ChapterDiagram>
      <div id="ch00-comparator-steps">
        <StepDerivation
          title={
            <>
              單一比較器輸出的統計，與累加 <Tex>{'N'}</Tex> 筆後判斷正負號的機率（<Tex>{'S_N'}</Tex> 是<strong>總和</strong>；它相當於 <Tex>{'x\\equiv1'}</Tex> 時 GMAC
              的累加值，除以 <Tex>{'N'}</Tex> 才是全站定義的平均 <Tex>{'G=S_N/N'}</Tex>，兩者正負號相同）
            </>
          }
          steps={[
            {
              tex: String.raw`P(q=+1)=P(s+v>0)=P(v>-s)=\Phi\!\left(\frac{s}{\sigma_v}\right)=\Phi\!\left(\frac{${texNum(COMP.sFs)}}{${texNum(COMP.sigmaFs)}}\right)=${num(comp.pPlus, 6)}`,
              why: (
                <>
                  比較器看到 <Tex>{'e=s+v'}</Tex>，<Tex>{'v\\sim\\mathcal N(0,\\sigma_v^2)'}</Tex>；用上面的對稱與縮放性質。幾乎是丟銅板。
                </>
              ),
            },
            {
              tex: String.raw`m_q\equiv E[q]=(+1)\,\Phi+(-1)\,(1-\Phi)=2\Phi\!\left(\frac{s}{\sigma_v}\right)-1=${num(comp.meanQ, 5)}`,
              why: (
                <>
                  期望值的定義（離散：值 <Tex>{'\\times'}</Tex> 機率再相加）。這一點點正的平均，就是 1-bit 輸出裡保留的「方向資訊」。
                </>
              ),
            },
            {
              tex: String.raw`\operatorname{Var}(q)=E[q^2]-m_q^2=1-m_q^2`,
              why: (
                <>
                  <Tex>{'q^2\\equiv1'}</Tex>。
                </>
              ),
            },
            {
              tex: String.raw`S_N=\sum_{i=1}^{N}q_i\;\approx\;\mathcal N\!\left(Nm_q,\;N(1-m_q^2)\right)`,
              why: (
                <>
                  <Tex>{'q_i'}</Tex> iid，用 CLT：平均相加、（獨立）變異數相加。
                </>
              ),
            },
            {
              tex: String.raw`P(S_N>0)\approx P\!\left(Z>-\frac{Nm_q}{\sqrt{N(1-m_q^2)}}\right)=\Phi\!\left(\frac{m_q\sqrt N}{\sqrt{1-m_q^2}}\right)`,
              why: (
                <>
                  標準化 <Tex>{'Z=(S_N-Nm_q)/\\sqrt{N(1-m_q^2)}'}</Tex>，再用對稱性質。<Tex>{'N'}</Tex> 取奇數時 <Tex>{'S_N'}</Tex> 不可能為 0（沒有平手，<ErratumRef eid="E02" />）。
                </>
              ),
            },
            {
              tex: String.raw`N=${cltN}:\quad \frac{m_q\sqrt N}{\sqrt{1-m_q^2}}=${texNum(cltZ, 4)}\;\Rightarrow\;P\approx\Phi(${texNum(cltZ, 4)})=${num(directionProbabilityClt(comp.meanQ, cltN), 4)}`,
              why: (
                <>
                  代入數字（由 <code>directionProbabilityClt</code> 計算）。訊號 <Tex>{'\\propto N'}</Tex>、雜訊 <Tex>{'\\propto\\sqrt N'}</Tex>，所以{' '}
                  <Tex>{'N'}</Tex> 越大越確定。
                </>
              ),
            },
          ]}
        />
      </div>
      <p>
        累加筆數與「正負號判斷正確」機率的關係（CLT 近似，奇數 <Tex>{'N'}</Tex>）：
      </p>
      <div className="table-wrap">
        <table className="ch00-num-table">
          <thead>
            <tr>
              <th className="num">
                累加筆數 <Tex>{'N'}</Tex>
              </th>
              <th className="num">
                <Tex>{'z=m_q\\sqrt N/\\sqrt{1-m_q^2}'}</Tex>
              </th>
              <th className="num">
                <Tex>{'P(S_N>0)\\approx\\Phi(z)'}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            {nList.map((n) => (
              <tr key={n}>
                <td className="num">{n.toLocaleString('en-US')}</td>
                <td className="num">{num((comp.meanQ * Math.sqrt(n)) / Math.sqrt(1 - comp.meanQ * comp.meanQ), 4)}</td>
                <td className="num">{pct(directionProbabilityClt(comp.meanQ, n), 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small">
        <ClaimTag kind="approx" /> Gaussian 雜訊 + CLT 近似；精確的 binomial 計算、平手規則與 Monte Carlo 在 <PageLink id="ch05" />。
      </p>
      <ErratumNote eid="E18">
        規格 §5 把 <Tex>{'N'}</Tex> 筆 <Tex>{'q_i'}</Tex> 的<strong>總和</strong>寫成 <Tex>{'G_N'}</Tex>，和 §0 的 block <strong>平均</strong>{' '}
        <Tex>{'G_k=\\frac1N\\sum q_nx_n'}</Tex> 用了同一個字母，兩者差 <Tex>{'N'}</Tex> 倍。本站把總和記為 <Tex>{'S_N'}</Tex>、<Tex>{'E[q]'}</Tex> 記為{' '}
        <Tex>{'m_q'}</Tex>：<Tex>{'E[S_N]=Nm_q,\\ \\operatorname{Var}(S_N)=N(1-m_q^2)'}</Tex>；換成平均則是{' '}
        <Tex>{'E[G]=m_q,\\ \\operatorname{Var}(G)=(1-m_q^2)/N'}</Tex>。判斷方向的機率 <Tex>{'P(S_N>0)=P(G>0)'}</Tex> 與尺度無關。
      </ErratumNote>
      <p>
        硬體上，先把 <Tex>{'N'}</Tex> 筆 <Tex>{'q_n x_n'}</Tex> 累加（GMAC），再更新一次係數。時間索引也跟著分開：<Tex>{'n'}</Tex> 是比較器取樣，
        <Tex>{'k'}</Tex> 是 GMAC block（每 <Tex>{'N'}</Tex> 筆取樣組成一個 block）；第 <Tex>{'k'}</Tex> 個 block 的平均記為 <Tex>{'G_k'}</Tex>：
      </p>
      <ChapterDiagram name="CHART_GMAC_BLOCK">
        <p>
          先看「每個 sample」那一框：比較器輸出 <Tex>{'q[n]'}</Tex> 和 <Tex>{'x[n]'}</Tex> 相乘（硬體上就是 <FigRef name="CHART_LMS_VS_SIGN" /> 的條件變號），一筆一筆加進累加器。再看兩框之間的那條線與「每個 block」那一框：累加器每 <Tex>{'N'}</Tex> 筆才把總和交出來一次，除以 <Tex>{'N'}</Tex> 得到 <Tex>{'G[k]'}</Tex>，乘上 <Tex>{'\\mu'}</Tex>{' '}
          後加進 gain register——這一框裡的「相加點加上 <Tex>{'z^{-1}'}</Tex>」和 §0.3 的 <FigRef name="CHART_LMS_ACCUMULATOR" /> 是同一個累加器，只是這裡的 <Tex>{'z^{-1}'}</Tex>{' '}
          延遲的是一個 block，不是一筆取樣。
        </p>
        <p>
          圖上藍色的「<Tex>{'\\sum'}</Tex> 累加 <Tex>{'N'}</Tex> 筆」與「總和 <Tex>{'\\div N'}</Tex>」合起來就是下面第一條式子 <Tex>{'G_k=\\frac1N\\sum q_nx_n'}</Tex>（也就是 §0.7{' '}
          <FigRef name="CHART_NOISE_AVERAGING" /> 的平均器）；相加點的兩個輸入 <Tex>{'(+)\\ w[k]'}</Tex>、<Tex>{'(+)\\ \\mu\\,G[k]'}</Tex> 就是第二條式子 <Tex>{'w_{k+1}=w_k+\\mu G_k'}</Tex>。
        </p>
      </ChapterDiagram>
      <div id="ch00-gmac-formula">
        <TexBlock>{String.raw`G_k=\frac1N\sum_{n\in\text{block }k}q_n\,x_n,\qquad w_{k+1}=w_k+\mu\,G_k`}</TexBlock>
      </div>
      <Observe>
        這就是 PLL 校正的核心：<strong>1-bit 誤差 <Tex>{'\\times'}</Tex> regressor，累加 <Tex>{'N'}</Tex> 筆，乘上 <Tex>{'\\mu'}</Tex>，更新 gain</strong>。它和本章的 LMS 只有兩個差別——誤差只剩正負號、更新前先平均。<PageLink id="ch02" /> 會推導 Sign-Error LMS，<PageLink id="ch04" /> 畫出完整的 DSM → DTC → PD → GMAC 訊號流，
        <PageLink id="ch05" /> 計算 1-bit 比較器的等效增益 <Tex>{'K_q=\\sqrt{2/\\pi}/\\sigma_v'}</Tex>。
      </Observe>
      <ModeGate min="research">
        <p className="small">
          （Research）注意 Sign-Error 的固定點由 <Tex>{'E[\\mathrm{sign}(e)\\,x]=0'}</Tex> 決定，一般不等於 MSE 的 <Tex>{'E[e\\,x]=0'}</Tex>；有雜訊時兩者的差距取決於 <Tex>{'\\sigma_v'}</Tex> 與殘差的相對大小（<ErratumRef eid="E01" />，<PageLink id="ch11" />）。
        </p>
      </ModeGate>
    </Section>
  )
}
