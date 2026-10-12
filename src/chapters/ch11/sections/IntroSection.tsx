import { useMemo } from 'react'
import { Callout, ClaimTag, Section, SourceTag, StepDerivation, SystemMap, Tex, TexBlock } from '@/components'
import { buildCodeDistribution, eDet, meanGmacMse, perCodeGain, type ErrorModel } from '@/simulation/models/bias'
import { chop, num, signed, m, texNum } from '../common'
import { SYSTEM_MAP_FOCUS } from '../diagrams'
import { Fig, FigRef } from '../Fig'
import { Hand } from '../Hand'

const CUBIC: ErrorModel = { a: 1, b: 0, c2: 0, c3: 0.1, kappa: 0, sigmaV: 0 }

/** §11 開場：問題、系統地圖、先算一次、誤差來源圖（方塊圖的 Mermaid 原始碼在 ../diagrams.ts）。 */
export function IntroSection() {
  const five = useMemo(() => buildCodeDistribution({ kind: 'five_level' }), [])
  const rows = useMemo(
    () =>
      five.values.map((x) => {
        const y = CUBIC.a * x + CUBIC.c3 * x ** 3 // 這個 code 需要的補償量：feedback edge 早到的 a·x 加上 DTC 的 INL
        return { x, y, t: x !== 0 ? perCodeGain(x, CUBIC) : Number.NaN, e1: eDet(x, 1, CUBIC), e134: eDet(x, 1.34, CUBIC) }
      }),
    [five],
  )
  const g = (w: number) => chop(meanGmacMse(w, CUBIC, five)) // 1.34 處的 −1.1e−16 是浮點捨入
  const g1 = g(1)
  const g12 = g(1.2)
  const g134 = g(1.34)
  const g14 = g(1.4)

  return (
    <>
      <Callout kind="info" title="這一課要回答的問題">
        <p className="ch11-lead">
          LMS 已經穩定收斂、GMAC 的平均輸出也已經歸零了。這時 DTC 的 timing error 一定是 0 嗎？
        </p>
        <p>
          答案是<strong>不一定</strong>。GMAC 只會讓「誤差和 code 的相關」<Tex>{String.raw`E[x\,e]`}</Tex>（或 Sign-LMS 的 <Tex>{String.raw`E[x\,q]`}</Tex>
          ）歸零；它不知道誤差從哪裡來，也不保證每一個 code 的誤差都是 0。這一課要算清楚：LMS 最後停在哪裡（固定點{' '}
          <Tex>{'w^*'}</Tex>）、偏了多少（bias）、以及這個答案跟演算法（MSE / Sign）、雜訊大小、主 PLL 架構有什麼關係。
        </p>
        <p className="small">
          先認識這幾個符號（完整的符號表在本章最後）：<Tex>{'x[n]'}</Tex> 是第 <Tex>{'n'}</Tex> 個 comparator sample 的 DTC code（DSM 的 fractional
          residue，已正規化、無因次），也是 GMAC 用來做相關的 regressor；<Tex>{'e[n]'}</Tex> 是 PD 的輸出，也就是 comparator 前的總 timing error；
          <Tex>{String.raw`q[n]=\operatorname{sign}(e[n])`}</Tex> 是 1-bit comparator 的輸出（<Tex>{'\\pm1'}</Tex>）；<Tex>{'w'}</Tex> 是校正電路目前使用的 gain，
          <Tex>{'w^*'}</Tex> 是它最後停下來的值；<Tex>{String.raw`E[\cdot]`}</Tex> 是期望值，也就是「很多次的平均」（§11.0 有先備知識框）。
        </p>
      </Callout>
      <SystemMap focus={SYSTEM_MAP_FOCUS} />
      <p>
        <strong>你在這裡：</strong>藍色方塊是這一課的主角 —— 誤差進來的三個地方（DTC 的 gain 與 INL、PD 的 offset 與耦合、comparator 前的雜訊{' '}
        <Tex>{'v[n]'}</Tex>），以及只看得到「誤差與 code 的相關」的 1-bit comparator、GMAC 與 gain accumulator。前面幾課假設誤差只有「gain 不對」這一項；這一課把
        offset、INL、code-correlated 干擾與雜訊全部加進來，算出 gain accumulator 的 <Tex>{'w'}</Tex> 最後停在哪裡，以及它離真實的 DTC gain 多遠。
      </p>

      <Section kind="intuition" title="直覺：用一條直線去貼一條彎曲的 DTC 曲線" level={2} id="ch11-intuition">
        <p>
          先把物理圖像講一次（全站的接法：DTC 在 reference 的輸入端，回授路徑上只有 divider）。小數除頻讓 feedback（divider）edge 比理想時刻早到{' '}
          <Tex>{'a\\,x'}</Tex>（<Tex>{'a'}</Tex> 是真實的 DTC gain，也就是校正 gain <Tex>{'w'}</Tex> 應該到的值）。reference 端的 DTC 把 reference edge
          也提前去對齊；它只能延遲、不能提前，所以是從一個固定的基準延遲 <Tex>{'T_0'}</Tex> 往回扣：
          <Tex>{String.raw`\tau_\mathrm{DTC}=T_0-w\,x`}</Tex>，<Tex>{'w\\,x'}</Tex> 叫做 DTC 的<strong>補償量</strong>。PD 量的是「DTC 延遲後的 reference edge 減
          feedback edge」：<Tex>{String.raw`e=t_\mathrm{ref}'-t_\mathrm{fb}=(a-w)\,x`}</Tex>（常數 <Tex>{'T_0'}</Tex> 只讓 PLL
          鎖定的相位整個平移，不出現在 <Tex>{'e'}</Tex> 裡）。
        </p>
        <p>
          如果 DTC 是一條完美的直線，<Tex>{'w=a'}</Tex> 就能讓每個 code 都對齊。但真實的 DTC 稍微彎曲：code <Tex>{'x'}</Tex> 的延遲比直線多出{' '}
          <Tex>{'c_3x^3'}</Tex>（<Tex>{'c_3'}</Tex> 是三階 INL 的係數，INL 指 delay 偏離直線的部分），所以要讓這個 code 的誤差為 0，需要的補償量是{' '}
          <Tex>{String.raw`y(x)=a\,x+c_3x^3`}</Tex> —— 一條彎曲線。校正電路只能調
          <strong>一個</strong>數字 —— 線性 gain <Tex>{'w'}</Tex>，補償量只能是直線 <Tex>{'w\\,x'}</Tex>。一條直線不可能同時貼齊一條彎曲線上的所有點，所以
          LMS 只能找一個「最划算」的折衷斜率。問題是：<strong>「最划算」是用什麼標準？</strong> 這個標準由演算法決定，不由物理決定。
        </p>
      </Section>

      <Section kind="example" title={m('先算一次：5 個 code、$a=1$、$c_3=0.1$')} level={2} id="ch11-hand">
        <p>
          code 等機率取 <Tex>{String.raw`x\in\{-2,-1,0,1,2\}`}</Tex>，需要的補償量 <Tex>{String.raw`y(x)=x+0.1x^3`}</Tex>（單位 t.u.）。每個 code 自己「想要」的 gain 是{' '}
          <Tex>{String.raw`t(x)=y(x)/x`}</Tex>：
        </p>
        <div className="table-wrap">
          <table className="ch11-table">
            <thead>
              <tr>
                <th>
                  code <Tex>{'x'}</Tex>
                </th>
                <th>
                  需要的補償量 <Tex>{'y(x)'}</Tex>
                </th>
                <th>
                  per-code gain <Tex>{'t(x)=y/x'}</Tex>
                </th>
                <th>
                  <Tex>{'w=1'}</Tex> 時 <Tex>{'e=y-wx'}</Tex>
                </th>
                <th>
                  <Tex>{'w=1.34'}</Tex> 時 <Tex>{'e'}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.x}>
                  <td className="num">{r.x}</td>
                  <td className="num">{signed(r.y, 4)}</td>
                  <td className="num">{Number.isFinite(r.t) ? num(r.t, 4) : m('—（$x=0$ 不提供資訊）')}</td>
                  <td className="num">{signed(r.e1, 4)}</td>
                  <td className="num">{signed(r.e134, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          code <Tex>{'\\pm1'}</Tex> 想要 1.1，code <Tex>{'\\pm2'}</Tex> 想要 1.4 —— <strong>沒有任何一個 w 能讓所有誤差同時為 0</strong>。那 LMS 會停在哪裡？它停在 GMAC
          的平均輸出 <Tex>{'E[G]'}</Tex> 等於 0 的地方。這裡先用最單純的 MSE-LMS（GMAC 直接把多位元的 <Tex>{'e'}</Tex> 乘上 <Tex>{'x'}</Tex> 再平均，
          <Tex>{String.raw`E[G]=E[x\,e]`}</Tex>；只用正負號 <Tex>{'q'}</Tex> 的 Sign-LMS 留到 §11.A）。
        </p>
        <p>
          先看 <FigRef id="gmac-zero" /> 上半部：<Tex>{'w=1.34'}</Tex> 時，五個 code 各有自己的殘差 <Tex>{'e'}</Tex>，各自乘上自己的 <Tex>{'x'}</Tex>；再看下半部：GMAC
          把五個乘積取平均，正負剛好抵銷成 0。圖上每個方塊裡的 <Tex>{String.raw`x\cdot e`}</Tex>，就是下面第三行推導方括號裡的五個乘積；綠色方塊就是該行等號右邊的 0。
        </p>
        <Fig id="gmac-zero" />
        <p>
          同樣的算法換四個 <Tex>{'w'}</Tex> 各做一次，看 <Tex>{'E[G]'}</Tex> 的正負號怎麼變（數字由本站模型即時計算）：
        </p>
        <StepDerivation
          steps={[
            {
              tex: String.raw`w=1:\quad E[x\,e]=\tfrac15\big[(-2)(-0.8)+(-1)(-0.1)+0+(1)(0.1)+(2)(0.8)\big]=${texNum(g1, 6)}`,
              why: m('代入 $w=1$ 的殘差，逐項相乘再平均（5 個 code 各 $1/5$）。結果為正 ⇒ $w$ 會往上調。'),
            },
            {
              tex: String.raw`w=1.2:\quad E[x\,e]=${texNum(g12, 6)}>0`,
              why: m('仍為正：$w$ 繼續變大。'),
            },
            {
              tex: String.raw`w=1.34:\quad E[x\,e]=\tfrac15\big[(-2)(-0.12)+(-1)(0.24)+0+(1)(-0.24)+(2)(0.12)\big]=${texNum(g134, 6)}`,
              why: m('四個非零乘積 $+0.24,\\,-0.24,\\,-0.24,\\,+0.24$ 正好抵銷：GMAC 歸零，LMS 停在這裡。'),
            },
            {
              tex: String.raw`w=1.4:\quad E[x\,e]=${texNum(g14, 6)}<0`,
              why: m('超過 1.34 後變號，$w$ 會被推回來 ⇒ 1.34 是（平均動態意義下）吸引的固定點。'),
            },
          ]}
        />
        <p>
          在 <Tex>{'w=1.34'}</Tex> 處 GMAC 的平均已經是 0，但是表的最後一欄沒有任何一個殘差是 0：code <Tex>{'\\pm1'}</Tex> 還剩 <Tex>{'\\mp0.24'}</Tex>，code{' '}
          <Tex>{'\\pm2'}</Tex> 還剩 <Tex>{'\\pm0.12'}</Tex>。
        </p>
        <TexBlock>{String.raw`\boxed{E[x\,e]=0\quad\not\Rightarrow\quad e[n]=0}`}</TexBlock>
        <p className="small muted">
          <ClaimTag kind="exact" /> {m('在「$x$ 等機率取 5 值、無雜訊、GMAC $=E[x\\,e]$」的指定模型中可代數驗證。')} <SourceTag kind="illustrative" />
        </p>
        <Hand id="HC-11.1">
          {m('上面的表與四行推導，換成你自己的 $a$、$c_3$ 和任意一個 $w$ 再算一次：先算 $x=1,2$ 兩個殘差，再算 $E[x\\,e]$ 與 $E[e^2]$。')}
        </Hand>
      </Section>

      <Section kind="diagram" title="誤差從哪裡進來？" level={2} id="ch11-diagram">
        <p>
          剛才的例子只有 INL 一種誤差。實際的電路裡，comparator 前的誤差有好幾個來源。先看 <FigRef id="error-sources" /> 上半部的 PD：它是一個減法點，量的是{' '}
          <Tex>{String.raw`t_\mathrm{ref}'-t_\mathrm{fb}`}</Tex>。Reference clock 先經過 DTC 才進 PD，到達的時間是{' '}
          <Tex>{String.raw`t_\mathrm{ref}'=T_0-w\,x+d(x)`}</Tex>（補償量 <Tex>{'w\\,x'}</Tex> 由 gain correction 送來；<Tex>{'d(x)'}</Tex> 是 DTC 的
          INL，也就是延遲偏離直線的量）；回授路徑上只有 divider，它的 edge 早到 <Tex>{'a\\,x'}</Tex>，也就是{' '}
          <Tex>{String.raw`t_\mathrm{fb}=-a\,x`}</Tex>。兩者相減：<Tex>{String.raw`(T_0-w\,x+d(x))-(-a\,x)=(a-w)\,x+d(x)+T_0`}</Tex>；常數{' '}
          <Tex>{'T_0'}</Tex> 只讓鎖定的相位整個平移，不算進誤差。PD／comparator 的 offset <Tex>{'b'}</Tex>、與 code 成正比的干擾{' '}
          <Tex>{String.raw`\varepsilon_{cc}=\kappa x`}</Tex>、隨機雜訊 <Tex>{'v'}</Tex> 也在這裡加進來，總和就是 PD 的輸出 <Tex>{'e[n]'}</Tex> ——
          下一節公式 F-11.1 的五項。
        </p>
        <p>
          再看 PD 下面：PD 的輸出分成兩路，一路送進主迴路的 loop filter，另一路給 LMS 校正迴路。comparator 取的是 PD 的輸出{' '}
          <Tex>{'e[n]'}</Tex>，也就是送進 loop filter 的同一個訊號，只留下正負號 <Tex>{'q'}</Tex>；GMAC 把 <Tex>{'q'}</Tex> 乘上 <Tex>{'x'}</Tex> 後累加成{' '}
          <Tex>{'G'}</Tex>，最後回頭去改 <Tex>{'w'}</Tex>（<Tex>{'\\mu'}</Tex> 是學習率，<Tex>{'N'}</Tex> 是每次更新所平均的 sample 數）。右邊的 DSM
          同時做三件事：carry 控制 divider、餘數 <Tex>{'x[n]'}</Tex> 送進 gain correction、同一個 <Tex>{'x[n]'}</Tex> 當 GMAC 的 regressor。
        </p>
        <p>
          圖上的虛線是主 PLL 的回授：loop filter 積分後控制 VCO，VCO 的輸出經 divider 回到 PD —— 回授路徑上沒有別的東西。主迴路的修正讓 feedback edge 再早到{' '}
          <Tex>{String.raw`\varphi`}</Tex>（static phase offset，單位 t.u.），也就是 <Tex>{String.raw`t_\mathrm{fb}=-a\,x-\varphi`}</Tex>，相減後{' '}
          <Tex>{'e[n]'}</Tex> 多了一項 <Tex>{String.raw`+\varphi`}</Tex>，這是 §11.1 的主迴路 DC null。如果 PD 本身就是 1-bit 的 BBPD，comparator 就是
          PD，送進 loop filter 的就是 <Tex>{'q'}</Tex>。
        </p>
        <Fig id="error-sources" />
        <p>
          GMAC 的硬體只做一件事：把 comparator 輸出 <Tex>{'q'}</Tex> 乘上 code <Tex>{'x'}</Tex> 再累加（<Tex>{'q=\\pm1'}</Tex> 時就是「依 <Tex>{'q'}</Tex> 選{' '}
          <Tex>{'+x'}</Tex> 或 <Tex>{'-x'}</Tex>」的
          conditional negate + adder）。凡是和 <Tex>{'x'}</Tex> 相關的誤差，不論來自 DTC INL、comparator offset 還是 DSM pattern 耦合，在 GMAC 眼裡都和「gain 不對」
          長得一樣。這就是本章所有 bias 的共同根源。
        </p>
      </Section>
    </>
  )
}
