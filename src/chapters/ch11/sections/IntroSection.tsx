import { useMemo } from 'react'
import { Callout, ClaimTag, Mermaid, Section, SourceTag, StepDerivation, Tex, TexBlock } from '@/components'
import { buildCodeDistribution, eDet, meanGmacMse, perCodeGain, type ErrorModel } from '@/simulation/models/bias'
import { chop, num, signed, m, texNum } from '../common'
import { Hand } from '../Hand'

const CUBIC: ErrorModel = { a: 1, b: 0, c2: 0, c3: 0.1, kappa: 0, sigmaV: 0 }

const SYSTEM = `flowchart LR
  DSM["DSM residue<br/>code x[n]"] --> DTC["DTC<br/>delay = a·x + d(x)"]
  W["gain 暫存器 w"] --> COMP["補償 −w·x"]
  DTC --> SUM(("Σ"))
  COMP --> SUM
  B["PD / comparator offset b"] --> SUM
  ECC["code-correlated 干擾 ε_cc = κ·x"] --> SUM
  V["random noise v"] --> SUM
  SUM -->|"e[n]"| Q["1-bit comparator<br/>q = sign(e)"]
  SUM -.->|"同一個 PD"| LF["主 PLL loop filter<br/>（積分路徑：DC null）"]
  LF -.->|"static phase offset φ"| SUM
  Q --> GMAC["GMAC：G = (1/N)Σ q·x"]
  DSM --> GMAC
  GMAC --> UPD["w ← w + μ·G"]
  UPD --> W`

/** §11 開場：問題、先算一次、系統圖。 */
export function IntroSection() {
  const five = useMemo(() => buildCodeDistribution({ kind: 'five_level' }), [])
  const rows = useMemo(
    () =>
      five.values.map((x) => {
        const y = CUBIC.a * x + CUBIC.c3 * x ** 3 // 真實 delay
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
      </Callout>

      <Section kind="intuition" title="直覺：用一條直線去貼一條彎曲的 DTC 曲線" level={2} id="ch11-intuition">
        <p>
          想像一顆 DTC，真實的 delay 不是完美的直線 <Tex>{'a\\,x'}</Tex>，而是稍微彎曲：<Tex>{String.raw`a\,x+c_3x^3`}</Tex>（三階 INL）。校正電路只能調
          <strong>一個</strong>數字 —— 線性 gain <Tex>{'w'}</Tex>，用 <Tex>{'w\\,x'}</Tex> 去抵消 delay。一條直線不可能同時貼齊一條彎曲線上的所有點，所以
          LMS 只能找一個「最划算」的折衷斜率。問題是：<strong>「最划算」是用什麼標準？</strong> 這個標準由演算法決定，不由物理決定。
        </p>
      </Section>

      <Section kind="example" title={m('先算一次：5 個 code、$a=1$、$c_3=0.1$')} level={2} id="ch11-hand">
        <p>
          code 等機率取 <Tex>{String.raw`x\in\{-2,-1,0,1,2\}`}</Tex>，真實 delay <Tex>{String.raw`y(x)=x+0.1x^3`}</Tex>（單位 t.u.）。每個 code 自己「想要」的 gain 是{' '}
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
                  真實 delay <Tex>{'y(x)'}</Tex>
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
          code <Tex>{'\\pm1'}</Tex> 想要 1.1，code <Tex>{'\\pm2'}</Tex> 想要 1.4 —— <strong>沒有任何一個 w 能讓所有誤差同時為 0</strong>。接著看 MSE-LMS 的平均 GMAC{' '}
          <Tex>{String.raw`E[G]=E[x\,e]`}</Tex> 在不同 w 的值（表內數字由本站模型即時計算）：
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
        <Mermaid
          chart={SYSTEM}
          caption="Comparator 前的誤差 e[n] 是多個來源的總和；GMAC 只看到 q 與 x 的相關，看不到來源。虛線：若 comparator 就是主 PLL 的 BBPD，主迴路的積分路徑會把 DC 消掉（勘誤 E03，§11.1）。"
        />
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
