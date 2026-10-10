import { useMemo } from 'react'
import { Mermaid, Quiz, Recap, Section, Tex } from '@/components'
import { conventionalStep, signErrorStep, signSignStep } from '@/simulation/models/lms'
import { ChapterLink, ErrataNote, HandCalcSlot, f4, tm } from '../common'
import { HANDCALCS } from '../handcalcs'

const PLL_LOOP = `flowchart LR
  DSM["DSM 殘差 code x[n]"] --> DTC["DTC（gain 估計 w）"]
  DTC --> PD["PD / comparator：q[n] = sign(e[n])"]
  PD --> GMAC["GMAC：G_k = (1/N)·Σ q[n]·x[n]"]
  DSM --> GMAC
  GMAC --> UPD["w ← w + μ·G_k（shift）"]
  UPD --> DTC`

/** §6 連到 PLL、思考題、本課必記。 */
export function S6Wrap() {
  const q = useMemo(() => {
    const inp = { w: 2, x: -3, y: -9, mu: 0.1, tie: 'plus' as const }
    return { l: conventionalStep(inp), se: signErrorStep(inp), ss: signSignStep(inp) }
  }, [])

  return (
    <section>
      <h2 id="ch02-s6">§6 連到 PLL、思考題與本課必記</h2>

      <Section kind="diagram" title="這一章的數學在 DTC 校正裡是什麼">
        <Mermaid chart={PLL_LOOP} caption="Block Sign-Error LMS（示意）：comparator 只給誤差的正負號，GMAC 做 conditional negation 累加，block 結束時更新一次。" />
        <div className="table-wrap">
          <table className="ch02-table">
            <thead>
              <tr>
                <th>本章符號</th>
                <th>PLL / DTC 校正中的硬體</th>
                <th>說明</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <Tex>{'e[n]'}</Tex>
                </td>
                <td>DTC 殘餘時間誤差（fs）</td>
                <td>看不到大小，只看得到 comparator 的輸出</td>
              </tr>
              <tr>
                <td>
                  <Tex>{'\\operatorname{sign}(e)'}</Tex>
                </td>
                <td>
                  BBPD / comparator 的 <Tex>{'q=2b-1'}</Tex>
                </td>
                <td>
                  tie（metastability、剛好相等）怎麼映射必須明定 <ErrataNote id="E40" />
                </td>
              </tr>
              <tr>
                <td>
                  <Tex>{'x[n]'}</Tex>
                </td>
                <td>DSM 殘差 / PHOS / GOS code</td>
                <td>零均值、對稱的 code 讓偏斜雜訊不造成 bias（§4）</td>
              </tr>
              <tr>
                <td>
                  <Tex>{'\\operatorname{sign}(e)\\,x'}</Tex>
                </td>
                <td>GMAC 的 conditional negation</td>
                <td>
                  沒有乘法器；<Tex>{'N'}</Tex> 筆累加後更新 = mini-batch（§2）
                </td>
              </tr>
              <tr>
                <td>
                  <Tex>{'\\operatorname{sign}(e)\\operatorname{sign}(x)'}</Tex>
                </td>
                <td>XOR + up/down counter</td>
                <td>
                  最省，但目標不同（<Tex>{'r=y/x'}</Tex> 的不加權中位數）。code 的幅度固定時（<Tex>{'x=\\pm A'}</Tex>）兩者等價：
                  <Tex>{String.raw`\operatorname{sign}(e)\,x=A\operatorname{sign}(e)\operatorname{sign}(x)`}</Tex>，只差步長倍數 <Tex>{'A'}</Tex>；多參數見 <ChapterLink ch="10">Ch10</ChapterLink>
                </td>
              </tr>
              <tr>
                <td>
                  <Tex>{'K_{\\rm SE}=2f_v(0)E[x^2]'}</Tex>
                </td>
                <td>
                  comparator 增益 <Tex>{'K_q=\\sqrt{2/\\pi}/\\sigma_v'}</Tex> 乘上 code 功率 <Tex>{'E[x^2]'}</Tex>
                </td>
                <td>
                  決定校正迴路的 pole <Tex>{'1-\\mu K'}</Tex>（<ChapterLink ch="05">Ch05</ChapterLink>、<ChapterLink ch="08">Ch08</ChapterLink>）
                </td>
              </tr>
              <tr>
                <td>
                  <Tex>{'\\mu_n'}</Tex> 排程
                </td>
                <td>gear-shift FSM（右移位數隨時間增加）</td>
                <td>
                  先粗調、再細調，保留 <Tex>{'\\mu_{\\min}'}</Tex> 追蹤 PVT（<ChapterLink ch="14">Ch14</ChapterLink>）
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section kind="example" title="綜合手算：把這一章的公式串成一條設計流程">
        <p>
          真正設計 1-bit 校正迴路時，會把這一章的幾條公式連起來用：comparator 增益 <Tex>{'K_q'}</Tex>（§3）→ Sign-Error 的線性化增益 <Tex>{'K_{\\rm SE}'}</Tex>（F-02.12）→ pole 與時間常數
          → 穩態抖動（F-02.13）→ 和多位元 LMS 比較（F-02.14、F-02.16）。
        </p>
        <HandCalcSlot id="HC-02.8">
          給定 comparator 輸入端的雜訊 <Tex>{'\\sigma_v'}</Tex>、code 幅度 <Tex>{'A'}</Tex> 與步長 <Tex>{'\\mu'}</Tex>，先用紙筆和計算機走完整條流程（需要一次 <Tex>{'\\ln'}</Tex> 與兩次開根號），
          再對答案；然後把 <Tex>{'\\mu'}</Tex> 減半，看 <Tex>{'\\tau'}</Tex> 與 <Tex>{'\\sigma_w'}</Tex> 各變成幾倍。
        </HandCalcSlot>
        <p className="ch02-note" data-handcalc-pointer="workbook">
          本章共 {HANDCALCS.length} 題帶入手算（{HANDCALCS[0].id}–{HANDCALCS[HANDCALCS.length - 1].id}），分別緊跟在對應的推導後面；全站的題目彙整在
          <a href="#/workbook">「手算練習簿」頁</a>，可以隨機出題、列印練習卷。
        </p>
      </Section>

      <Quiz
        title="思考題 6（三種更新，一步）"
        question={
          <>
            <Tex>{'w=2,\\ x=-3,\\ y=-9,\\ \\mu=0.1'}</Tex>。<strong>Sign-Sign</strong> 更新一步後的 <Tex>{'w'}</Tex> 是多少？
          </>
        }
        options={[{ label: f4(q.l.w) }, { label: f4(q.se.w) }, { label: f4(q.ss.w), correct: true }, { label: f4(2 - 0.1) }]}
        answer={
          <>
            <Tex>{String.raw`e=y-wx=-9-2\times(-3)=${f4(q.ss.e)}`}</Tex>。LMS：<Tex>{String.raw`2+0.1\times(${f4(q.l.e)})\times(-3)=${f4(q.l.w)}`}</Tex>；
            Sign-Error：<Tex>{String.raw`2+0.1\times(-1)\times(-3)=${f4(q.se.w)}`}</Tex>；Sign-Sign：<Tex>{String.raw`2+0.1\times(-1)\times(-1)=${f4(q.ss.w)}`}</Tex>。
            三者方向相同（都往真值 3 走），只有步伐大小不同：LMS 正比於 <Tex>{'|e||x|'}</Tex>，Sign-Error 正比於 <Tex>{'|x|'}</Tex>，Sign-Sign 固定 <Tex>{'\\mu'}</Tex>。
          </>
        }
      />

      <Recap
        title="這一課最重要的公式"
        formulas={[
          { label: 'Gradient Descent 與步長上限（二次成本精確）', tex: String.raw`\boxed{w_{n+1}=w_n-\mu J'(w_n),\qquad 0<\mu<\frac{2}{J''}}` },
          { label: tm('LMS = 對 $\\tfrac12E[e^2]$ 的 SGD（單筆梯度不偏）'), tex: String.raw`\boxed{E[-e_nx_n\mid w_n]=J'(w_n)\;\Rightarrow\;w_{n+1}=w_n+\mu e_nx_n}` },
          { label: 'Sign-Error / Sign-Sign', tex: String.raw`\boxed{w_{n+1}=w_n+\mu\operatorname{sign}(e_n)x_n,\qquad w_{n+1}=w_n+\mu\operatorname{sign}(e_n)\operatorname{sign}(x_n)}` },
          { label: tm('固定點：$r=y/x$ 的 $x^2$ 加權平均、$|x|$ 加權中位數、中位數'), tex: String.raw`\boxed{E[e\,x]=0,\quad E[\operatorname{sign}(e)\,x]=0,\quad E[\operatorname{sign}(e)\operatorname{sign}(x)]=0}` },
          { label: 'Limit cycle 與遞減步長（Robbins–Monro）', tex: String.raw`\boxed{|\delta_n|<\mu|x|\ (\text{固定 }\mu),\qquad \mu_n=\frac{\mu_0}{1+n/n_0}:\ \sum\mu_n=\infty,\ \sum\mu_n^2<\infty}` },
          { label: 'Sign-Error 的線性化增益（連到 comparator）', tex: String.raw`\boxed{K_{\rm SE}=2f_v(0)E[x^2]\overset{\text{Gauss}}{=}K_qE[x^2]}` },
        ]}
        points={[
          <>Gradient descent 沿著切線往下；能走多大步由曲率 <Tex>{"J''"}</Tex> 決定，<Tex>{"\\mu=1/J''"}</Tex> 是 Newton 步。成本要含 <Tex>{'\\tfrac12'}</Tex>，斜率才與 LMS 更新同 scaling（E41）。</>,
          <>LMS 是 SGD：單筆梯度不偏（因為 <Tex>{'w_n'}</Tex> 與第 <Tex>{'n'}</Tex> 筆資料獨立），但在谷底仍有 <Tex>{'\\sigma_v^2P_x'}</Tex> 的梯度雜訊，所以固定 <Tex>{'\\mu'}</Tex> 永遠會抖。</>,
          <>Sign-Error 是 MAE 的隨機次梯度：只要 1-bit comparator 與 conditional negation；固定 <Tex>{'\\mu'}</Tex> 時在 <Tex>{'\\pm\\mu|x|'}</Tex> 帶內跳，<Tex>{'\\operatorname{sign}(0)'}</Tex> 與浮點捨入要明定（E40）。</>,
          <>Sign-Sign 是另一個演算法（<Tex>{'y/x'}</Tex> 的不加權中位數），不是 Sign-Error 的簡化版（E43）。判斷固定點是否偏離 <Tex>{'a'}</Tex>：看 <Tex>{String.raw`\psi(a)=E[\operatorname{sign}v]E[x]`}</Tex>（F-02.18）；雜訊的平均不等於中位數、而且 <Tex>{'E[x]\\neq0'}</Tex> 時，三個固定點一般都不同。</>,
          <>同收斂速度下 Sign-Error 的變異是 LMS 的 <Tex>{'1/(4f_v(0)^2\\sigma_v^2)'}</Tex> 倍：Gaussian 多 57%，重尾雜訊反而更準。</>,
        ]}
      />

      <Section kind="assumptions" title="下一個值得研究的問題">
        <ul className="ch02-try">
          <li>
            1 fs 的誤差埋在 100 fs 的雜訊裡，sign 還剩多少資訊？要累加幾筆？→ <ChapterLink ch="05">Ch05</ChapterLink>
          </li>
          <li>
            隨機 <Tex>{'x'}</Tex> 時「平均收斂」與「均方收斂」的界為什麼不同？→ <ChapterLink ch="03">Ch03</ChapterLink>
          </li>
          <li>
            regressor 先經過 PLL 的 error transfer（有相位）再進 comparator，<Tex>{'E[\\operatorname{sign}(e)x]'}</Tex> 會不會變號？→ <ChapterLink ch="06">Ch06</ChapterLink>、<ChapterLink ch="07">Ch07</ChapterLink>
          </li>
          <li>
            GMAC 歸零（<Tex>{'E[qx]=0'}</Tex>）時 DTC 誤差真的是零嗎？→ <ChapterLink ch="11">Ch11</ChapterLink>
          </li>
          <li>
            係數只有 6 bit 時 limit cycle 會變成什麼樣的 spur？→ <ChapterLink ch="13">Ch13</ChapterLink>
          </li>
        </ul>
      </Section>
    </section>
  )
}
