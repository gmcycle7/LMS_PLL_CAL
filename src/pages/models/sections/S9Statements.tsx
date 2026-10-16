import { useState, type ReactNode } from 'react'
import { ClaimTag, Section, Tex, ChRef } from '@/components'
import { ChLink, ErratumNote, md, sig } from '../common'
import { SPEC_NUMBERS, gCritical } from '../refNumbers'

export interface Statement {
  id: string
  /** 語句（可含 $...$） */
  text: string
  /** true = 可以這樣宣稱（✅）；false = 不可以（❌） */
  ok: boolean
  /** 規格 §16.3 原文例句 */
  fromSpec?: boolean
  why: ReactNode
}

const n = SPEC_NUMBERS

export const STATEMENTS: Statement[] = [
  {
    id: 's1',
    text: '在明定的一階平均模型、$0<g<2$ 下，局部平均誤差漸近收斂。',
    ok: true,
    fromSpec: true,
    why: (
      <>
        指明了模型（一階平均）、條件（<Tex>{'0<g<2'}</Tex>）與收斂的種類（平均、局部）。這是 <Tex>{'|1-g|<1'}</Tex> 的直接結論 <ClaimTag kind="exact" />。
      </>
    ),
  },
  {
    id: 's2',
    text: '在此固定點的線性化雙迴路模型中，所有 closed-loop eigenvalues 都位於 Unit Circle 內。',
    ok: true,
    fromSpec: true,
    why: (
      <>
        宣稱範圍限定在「此固定點」「線性化」「雙迴路模型」，結論是可計算、可重現的 eigenvalue 條件（<ChLink to="/ch/08">Ch08</ChLink>）。
      </>
    ),
  },
  {
    id: 's3',
    text: '指定的 FCW/PVT sweep、Monte Carlo seeds 均未觀察到溢位或發散。',
    ok: true,
    fromSpec: true,
    why: '這是觀察陳述，不是證明：列出了掃過的範圍與 seeds，沒有推廣到範圍外。',
  },
  {
    id: 's4',
    text: 'Phase Margin 大於 $60^\\circ$，因此所有 Sign-LMS、所有 FCW 都保證校正正確。',
    ok: false,
    fromSpec: true,
    why: (
      <>
        PM 是線性化一階模型的指標；sign-LMS 是非線性的，不同 FCW 的 code 統計不同（<Tex>{'C'}</Tex> 甚至可能變號），而且 PM 不談 bias 與 spur。「所有」與「保證」都超出模型能證明的範圍。
      </>
    ),
  },
  {
    id: 's5',
    text: 'GMAC Output 等於零，因此 DTC Gain 沒有偏差且 Spurs 都消失。',
    ok: false,
    fromSpec: true,
    why: (
      <>
        GMAC 平均為零只代表到了固定點 <Tex>{'w^*'}</Tex>；offset、INL、截斷（§9.2）都會讓 <Tex>{'w^*\\ne a'}</Tex>。spur 還取決於 gain noise 乘上 code 後經 PLL transfer 的結果（<ChRef ch="12">Ch12</ChRef>）<ErratumNote id="E01" />。
      </>
    ),
  },
  {
    id: 's6',
    text: 'LMS 一定穩定，所以不需要檢查 learning rate。',
    ok: false,
    why: md('沒有說明是哪一種穩定（平均、均方、機率性有界、局部線性、全域非線性），而且 $g\\ge2$、更新延遲、$C\\le0$ 都會讓它不收斂。'),
  },
  {
    id: 's7',
    text: `在 §15.3 範例（iid $\\pm1$ code、identity path、$\\sigma_v=100\\,\\mathrm{fs}$、$N=4096$、$\\mu=10\\,\\mathrm{fs}$、average GMAC）的 L1 線性化模型中，穩態係數雜訊 $\\sigma_w\\approx${sig(n.sigmaW, 3)}\\,\\mathrm{fs}$（gain-equivalent），需以多 seed Monte Carlo 的信賴區間驗證。`,
    ok: true,
    why: (
      <>
        寫明了模型層級、所有前提（E30 要求的 code 分布、path、gm_mode）、單位意義，並標示為需驗證的近似 <ClaimTag kind="approx" />。
      </>
    ),
  },
  {
    id: 's8',
    text: '$g=1.5<2$，所以就算 gain commit 延遲 1 個 block 也一定穩定。',
    ok: false,
    why: (
      <>
        有 <Tex>{'d=1'}</Tex> 個 block 延遲時臨界增益是 <Tex>{`2\\sin(\\pi/6)=${sig(gCritical(1), 4)}`}</Tex>，<Tex>{'g=1.5'}</Tex> 已經不穩定（§3.4、<ChRef ch="08">Ch08</ChRef>）。
      </>
    ),
  },
  {
    id: 's9',
    text: `校正迴路的 Noise BW 約 $${sig(n.f3db / 1e3, 4)}\\,\\mathrm{kHz}$，用它乘上白雜訊 PSD 就得到 $\\sigma_w^2$。`,
    ok: false,
    why: (
      <>
        <Tex>{`${sig(n.f3db / 1e3, 4)}\\,\\mathrm{kHz}`}</Tex> 是 <Tex>{'-3\\,\\mathrm{dB}'}</Tex> 頻寬；白雜訊積分要用 <Tex>{`\\mathrm{ENBW}=${sig(n.enbw / 1e3, 4)}\\,\\mathrm{kHz}`}</Tex>，否則{' '}
        <Tex>{'\\sigma_w^2'}</Tex> 低估約 {sig(100 * (1 - n.f3db / n.enbw), 3)}%（§3.4 的推導）<ErratumNote id="E06" />。
      </>
    ),
  },
  {
    id: 's10',
    text: '在 Gaussian 純量 LMS 中，$\\mu=1.5$ 的單一 sample path 收斂了，所以 $\\mu=1.5$ 是均方穩定的。',
    ok: false,
    why: (
      <>
        均方界是 <Tex>{'\\mu<2/3'}</Tex>；<Tex>{'\\mu'}</Tex> 在 <Tex>{'2/3'}</Tex> 與約 <Tex>{'2.42'}</Tex> 之間時幾乎每條路徑收斂、但 <Tex>{'E[\\delta^2]'}</Tex> 發散（heavy tail）
        <ErratumNote id="E14" />。
      </>
    ),
  },
  {
    id: 's11',
    text: '在單頻 code、$0<\\Omega<\\pi$、長時間平均、小訊號（$|\\delta u|\\ll\\sigma_v$）的線性化平均模型中，$C=\\tfrac{A^2}{2}|H|\\cos\\varphi$；$C<0$ 時正的 learning rate 使平均誤差以 pole $1+\\mu K_q|C|>1$ 指數遠離固定點，$C=0$ 時平均誤差不收斂。',
    ok: true,
    why: (
      <>
        條件完整（單頻、<Tex>{'\\Omega'}</Tex> 不在 0 或 <Tex>{'\\pi'}</Tex>、長時間平均）<ErratumNote id="E46" />，結論限定在「小訊號線性化的平均誤差」，而且把 <Tex>{'C<0'}</Tex>（pole <Tex>{'>1'}</Tex>）與 <Tex>{'C=0'}</Tex>（pole{' '}
        <Tex>{'=1'}</Tex>，random walk）分開說 <ClaimTag kind="exact" />。少了「小訊號」就不對了：誤差長大到 <Tex>{'|\\delta u|\\gtrsim\\sigma_v'}</Tex> 後 comparator 飽和，1-bit sign-LMS 每個 block 最多走{' '}
        <Tex>{'\\mu\\max|x_\\mathrm{ref}|'}</Tex>，發散由指數變成等速漂移（JSON Lab 的 T06 preset 看得到這個轉折）<ErratumNote id="E48" />。
      </>
    ),
  },
  {
    id: 's12',
    text: '用 4096 點 FFT 看到一根 $-90\\,\\mathrm{dBc}$ 的峰，所以 PLL 輸出有 $-90\\,\\mathrm{dBc}$ 的 spur。',
    ok: false,
    why: '沒有 window、coherent/noncoherent、RBW、one/two-sided、peak/RMS、dBc 或 dBc/Hz 等條件；可能是洩漏、雜訊尖峰或 scalloping（§8）。',
  },
  {
    id: 's13',
    text: 'RTL 的 GMAC accumulator 用 $B_x+\\lceil\\log_2N\\rceil$ bits，所以任何 code 都不會溢位。',
    ok: false,
    why: (
      <>
        只對 symmetric code 成立；full-range code 條件取負會產生 <Tex>{'+2^{B_x-1}'}</Tex>，<Tex>{'N'}</Tex> 為 2 的冪時需要多 1 bit（§9.1）。
      </>
    ),
  },
  {
    id: 's14',
    text: 'JSON Lab 跑了 8 個 seed 都收斂到 $a$ 附近，所以這個校正迴路對任何初始條件、任何 code 都全域穩定。',
    ok: false,
    why: (
      <>
        有限樣本的 Monte Carlo 只能寫成第 3 句那樣的觀察陳述：「在指定條件與 seeds 下未觀察到發散」。它沒有涵蓋其他初始誤差（大誤差時 sign-LMS 是 slew-limited）、其他 code 統計（<Tex>{'C'}</Tex>{' '}
        可能變號）或飽和後的行為；全域非線性穩定需要另外的論證 <ClaimTag kind="research" />。
      </>
    ),
  },
]

type Answer = Record<string, boolean | undefined>

/** §10 §16.3 何時可以宣稱穩定：互動 ✅ / ❌ 測驗 */
export function S9Statements() {
  const [ans, setAns] = useState<Answer>({})
  const answered = STATEMENTS.filter((s) => ans[s.id] !== undefined)
  const correct = answered.filter((s) => ans[s.id] === s.ok).length
  const extra = STATEMENTS.filter((s) => !s.fromSpec).length
  return (
    <section aria-labelledby="models-s10">
      <h2 id="models-s10">10｜「何時可以宣稱穩定」：語句測驗（§16.3）</h2>
      <p>
        工程報告裡的一句話，必須說清楚<strong>哪個模型、什麼條件、哪一種收斂</strong>。規格 §16.3 給了 3 個可以寫的例句（✅）與 2 個不可以寫的例句（❌）；下面再加上 {extra} 句本站常見的說法。先自己判斷，再看解析。
      </p>
      <Section kind="explore" title="判斷每一句：✅ 可以宣稱 / ❌ 不可以" level={3}>
        <div className="models-score" aria-live="polite">
          已作答 {answered.length} / {STATEMENTS.length}，答對 {correct}
          {answered.length > 0 && (
            <button type="button" className="btn" onClick={() => setAns({})}>
              重新作答
            </button>
          )}
        </div>
        <ol className="models-statements">
          {STATEMENTS.map((s) => {
            const a = ans[s.id]
            const done = a !== undefined
            const right = done && a === s.ok
            return (
              <li key={s.id} className={`models-statement${done ? (right ? ' is-right' : ' is-wrong') : ''}`} data-statement={s.id}>
                <div className="models-statement-text">
                  「{md(s.text)}」{s.fromSpec && <span className="models-spec-tag">規格例句</span>}
                </div>
                <div className="models-statement-btns" role="group" aria-label="判斷">
                  <button type="button" className={`btn${a === true ? ' btn-primary' : ''}`} aria-pressed={a === true} data-answer="ok" onClick={() => setAns((o) => ({ ...o, [s.id]: true }))}>
                    ✅ 可以
                  </button>
                  <button type="button" className={`btn${a === false ? ' btn-primary' : ''}`} aria-pressed={a === false} data-answer="no" onClick={() => setAns((o) => ({ ...o, [s.id]: false }))}>
                    ❌ 不可以
                  </button>
                </div>
                {done && (
                  <div className="models-statement-why">
                    <strong>{right ? '答對了。' : '再想想。'}</strong> 正確答案：{s.ok ? '✅ 可以宣稱' : '❌ 不可以宣稱'}。{s.why}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      </Section>
      <Section kind="assumptions" title="寫穩定性宣稱的四個要素" level={3}>
        <ol>
          <li>
            <strong>模型</strong>：L 幾？一階平均、線性化雙迴路、還是 bit-true？
          </li>
          <li>
            <strong>條件</strong>：code 分布、path、gm_mode、<Tex>{'N,\\ \\mu,\\ \\sigma_v,\\ d,\\ D'}</Tex>……（E30：少一個就可能讓期望值失效）。
          </li>
          <li>
            <strong>收斂的種類</strong>：平均收斂、均方穩定、機率性有界、局部線性穩定或全域非線性——不可以只寫「穩定」。
          </li>
          <li>
            <strong>證據</strong>：<ClaimTag kind="exact" /> 代數推導、<ClaimTag kind="approx" /> 近似加上 Monte Carlo（seeds 與 CI）、<ClaimTag kind="research" /> 需要 SPICE 或量測。
          </li>
        </ol>
      </Section>
    </section>
  )
}
