import { Fragment, useMemo, type MouseEvent } from 'react'
import { MathText, ModeGate, Quiz, Recap, Section, StepDerivation, Tex } from '@/components'
import { conventionalStep } from '@/simulation/models/lms'
import { poleTable, samplesForTargetStd } from '../model'
import { POLE_BEHAVIOUR_TEX, num, texNum, texRes } from '../format'
import { ErratumRef, InlineMath, PageLink } from '../common'
import { LEARNING_MAP, ROUTES } from '../learningMap'

/** 思考題 1 的參數（ChatGPT 入門課第 1 課）。 */
export const QUIZ1 = { w: 2, x: -3, y: -9, mu: 0.1 }
/** 思考題 2：x = 2，哪個 μ 會發散？ */
export const QUIZ2_X = 2
export const QUIZ2_MUS = [0.05, 0.25, 0.45, 0.55]
/** 思考題 3：單筆 std 與目標 */
export const QUIZ3 = { s1: 2, target: 0.05 }

/** §0.11 思考題。 */
export function QuizSection() {
  const q1 = useMemo(() => conventionalStep(QUIZ1), [])
  // 誘答選項各自代表一種常見錯誤（由同樣的數字算出）
  const forgotXSign = QUIZ1.w + QUIZ1.mu * q1.e * Math.abs(QUIZ1.x) // 忘了 x 的負號
  const noX = QUIZ1.w + QUIZ1.mu * Math.abs(q1.e) // 只用 |e|、沒乘 x
  const exactA = QUIZ1.y / QUIZ1.x // 直接跳到 y/x
  const q1Options = [forgotXSign, q1.w, exactA, noX]
  const yhat1 = QUIZ1.w * QUIZ1.x
  const yhatNew = q1.w * QUIZ1.x
  const q2 = useMemo(() => poleTable(QUIZ2_X, QUIZ2_MUS), [])
  const q2MuMax = 2 / (QUIZ2_X * QUIZ2_X)
  const q2Osc = q2.find((r) => r.behaviour === 'oscillating')
  const n3 = samplesForTargetStd(QUIZ3.s1, QUIZ3.target) // ⌈(s₁/target)²⌉（與 HC-00.5 同一個函式）
  const q3Options = [QUIZ3.s1 / QUIZ3.target, (QUIZ3.s1 / (2 * QUIZ3.target)) ** 2, n3, (QUIZ3.s1 / (QUIZ3.target / 2)) ** 2]

  return (
    <Section kind="example" level={2} id="ch00-quiz" title="§0.11 思考題">
      <Quiz
        title="思考題 1（必做）"
        question={
          <>
            目前 <Tex>{`w=${QUIZ1.w}`}</Tex>，這次輸入 <Tex>{`x=${QUIZ1.x}`}</Tex>，黑盒子回答 <Tex>{`y=${QUIZ1.y}`}</Tex>，學習率{' '}
            <Tex>{`\\mu=${QUIZ1.mu}`}</Tex>。用 LMS 更新一次後，<Tex>{'w'}</Tex> 變成多少？
          </>
        }
        options={q1Options.map((v) => ({ label: num(v), correct: v === q1.w }))}
        answer={
          <>
            <StepDerivation
              steps={[
                { tex: String.raw`\hat y=wx=${texNum(QUIZ1.w)}\times${texNum(QUIZ1.x)}=${texRes(yhat1)}`, why: '① 預測。' },
                {
                  tex: String.raw`e=y-\hat y=${texNum(QUIZ1.y)}-${texNum(yhat1)}=${texRes(q1.e)}`,
                  why: (
                    <>
                      ② 比較：誤差為{q1.e < 0 ? '負' : '正'}，預測 <Tex>{texRes(yhat1)}</Tex> 比實際 <Tex>{texRes(QUIZ1.y)}</Tex>{' '}
                      {q1.e < 0 ? '大' : '小'}。
                    </>
                  ),
                },
                {
                  tex: String.raw`\Delta w=\mu e x=${texNum(QUIZ1.mu)}\times${texNum(q1.e)}\times${texNum(QUIZ1.x)}=${texRes(q1.dw)}`,
                  why: (
                    <>
                      ③ 負 <Tex>{'\\times'}</Tex> 負 <Tex>{'='}</Tex> 正：<Tex>{'x<0'}</Tex> 時，想讓 <Tex>{'\\hat y'}</Tex> 變小，<Tex>{'w'}</Tex> 反而要變大。
                    </>
                  ),
                },
                { tex: String.raw`w\leftarrow ${texNum(QUIZ1.w)}+${texNum(q1.dw)}=${texRes(q1.w)}`, why: '更新（由 conventionalStep 計算）。' },
              ]}
            />
            <p className="small">
              誘答選項：<strong>{num(forgotXSign)}</strong> 是忘了 <Tex>{'x'}</Tex> 的負號（用了 <Tex>{'|x|'}</Tex>）；<strong>{num(exactA)}</strong>{' '}
              是直接算 <Tex>{'y/x'}</Tex>（那需要 <Tex>{`\\mu=1/x^2\\approx${num(1 / (QUIZ1.x * QUIZ1.x), 4)}`}</Tex> 才會一步到位）；
              <strong>{num(noX)}</strong> 是只用 <Tex>{'|e|'}</Tex> 而沒乘 <Tex>{'x'}</Tex>。檢查：新的預測{' '}
              <Tex>{`${texNum(q1.w)}\\times${texNum(QUIZ1.x)}=${texRes(yhatNew)}`}</Tex> 比 <Tex>{texRes(yhat1)}</Tex> 更接近{' '}
              <Tex>{texRes(QUIZ1.y)}</Tex>，方向對了。
            </p>
          </>
        }
      />
      <Quiz
        title="思考題 2"
        question={
          <>
            固定 <Tex>{`x=${QUIZ2_X}`}</Tex>、沒有雜訊。下列哪一個學習率會讓 LMS <strong>發散</strong>？
          </>
        }
        options={q2.map((r) => ({ label: <Tex>{`\\mu=${texNum(r.mu)}`}</Tex>, correct: r.behaviour === 'divergent' }))}
        answer={
          <>
            <p>
              用 <Tex>{`p=1-\\mu x^2=1-${texNum(QUIZ2_X * QUIZ2_X)}\\mu`}</Tex>，收斂需要{' '}
              <Tex>{`|p|<1\\iff0<\\mu<2/x^2=${texNum(q2MuMax)}`}</Tex>：
            </p>
            <ul>
              {q2.map((r) => (
                <li key={r.mu}>
                  <Tex>{`\\mu=${texNum(r.mu)}\\Rightarrow p=${texRes(r.p)}`}</Tex>：<MathText>{POLE_BEHAVIOUR_TEX[r.behaviour]}</MathText>
                </li>
              ))}
            </ul>
            {q2Osc && (
              <p className="small">
                注意 <Tex>{`\\mu=${texNum(q2Osc.mu)}`}</Tex> 雖然「每一步都跳到 <Tex>{'a'}</Tex> 的另一邊」（<Tex>{`p=${texRes(q2Osc.p)}<0`}</Tex>），仍然收斂（
                <Tex>{`|p|=${texNum(Math.abs(q2Osc.p))}<1`}</Tex>）；震盪不等於發散。
              </p>
            )}
          </>
        }
      />
      <Quiz
        title="思考題 3"
        question={
          <>
            固定 <Tex>{'w'}</Tex> 時，單筆 <Tex>{'e\\cdot x'}</Tex> 的標準差是 <Tex>{`s_1=${QUIZ3.s1}`}</Tex>。要讓 <Tex>{'N'}</Tex> 筆（iid）平均的標準差不超過{' '}
            <Tex>{`${QUIZ3.target}`}</Tex>，至少需要幾筆？
          </>
        }
        options={q3Options.map((v) => ({ label: num(v, 7), correct: v === n3 }))}
        answer={
          <>
            <StepDerivation
              steps={[
                {
                  tex: String.raw`\frac{s_1}{\sqrt N}\le ${QUIZ3.target}`,
                  why: (
                    <>
                      <Tex>{'1/\\sqrt N'}</Tex> 法則（F-00.8）。
                    </>
                  ),
                },
                { tex: String.raw`\sqrt N\ge\frac{${QUIZ3.s1}}{${QUIZ3.target}}=${texNum(QUIZ3.s1 / QUIZ3.target)}`, why: '移項。' },
                { tex: String.raw`N\ge ${texNum((QUIZ3.s1 / QUIZ3.target) ** 2)}`, why: '兩邊都是正數，平方不改變不等號方向。' },
                { tex: String.raw`N_{\min}=\lceil ${texNum((QUIZ3.s1 / QUIZ3.target) ** 2)}\rceil=${n3}`, why: '筆數必須是整數，取上整（ceiling）。' },
              ]}
            />
            <p className="small">
              誘答選項：{num(QUIZ3.s1 / QUIZ3.target)} 是以為雜訊和 <Tex>{'N'}</Tex> 成反比（<Tex>{'s_1/N'}</Tex>，忘了開根號）；
              {num(q3Options[1])} 是目標 <Tex>{texNum(2 * QUIZ3.target)}</Tex> 的答案，{num(q3Options[3])} 是目標{' '}
              <Tex>{texNum(QUIZ3.target / 2)}</Tex> 的答案——雜訊每降 2 倍，資料就要多 4 倍。
            </p>
          </>
        }
      />
      <ModeGate min="engineer">
        <Quiz
          title="思考題 4（Engineer）"
          question={
            <>
              有人把成本寫成 <Tex>{'J=E[(y-wx)^2]'}</Tex>（沒有 <Tex>{'\\tfrac12'}</Tex>），用它的曲率推「固定 <Tex>{'x'}</Tex> 時{' '}
              <Tex>{'\\mu'}</Tex> 的穩定上限」。他會得到什麼？實際的 LMS 更新{' '}
              <Tex>{'w\\leftarrow w+\\mu ex'}</Tex> 真正的上限又是多少？
            </>
          }
          options={[
            { label: <Tex>{'\\text{都是 }2/x^2'}</Tex> },
            { label: <Tex>{'\\text{他得到 }1/x^2\\text{，實際是 }2/x^2'}</Tex>, correct: true },
            { label: <Tex>{'\\text{他得到 }2/x^2\\text{，實際是 }1/x^2'}</Tex> },
            { label: <Tex>{'\\text{都是 }1/x^2'}</Tex> },
          ]}
          answer={
            <p>
              沒有 <Tex>{'\\tfrac12'}</Tex> 的成本曲率是 <Tex>{"\\tfrac{d^2}{dw^2}(y-wx)^2=2x^2"}</Tex>，GD 穩定界是 <Tex>{'2/\\text{曲率}=1/x^2'}</Tex>；但 LMS 更新量 <Tex>{'\\mu ex'}</Tex> 對應的是{' '}
              <Tex>{'\\tfrac12e^2'}</Tex>（曲率 <Tex>{'x^2'}</Tex>），真正的界是 <Tex>{'2/x^2'}</Tex>（§0.6 的等比數列推導）。這就是 <ErratumRef eid="E41" />：
              成本與更新量必須用同一個 scaling。
            </p>
          }
        />
      </ModeGate>
    </Section>
  )
}

/** §0.12 本課必記。 */
export function RecapSection() {
  return (
    <Section kind="formula" level={2} id="ch00-recap" title="§0.12 本課必記">
      <Recap
        formulas={[
          { label: 'LMS 更新（預測 → 比較 → 修正）', tex: String.raw`\boxed{w_{n+1}=w_n+\mu\,e_n\,x_n},\quad e_n=y_n-w_nx_n` },
          {
            label: (
              <>
                <Tex>{'e\\,x'}</Tex> 就是負的梯度（成本帶 <Tex>{'\\tfrac12'}</Tex>，<ErratumRef eid="E41" />）
              </>
            ),
            tex: String.raw`\boxed{\frac{d}{dw}\tfrac12e^2=-e\,x}` },
          {
            label: (
              <>
                固定 <Tex>{'x'}</Tex>：等比數列與穩定條件（<Tex>{'\\delta=a-w'}</Tex>，<ErratumRef eid="E39" />）
              </>
            ),
            tex: String.raw`\boxed{\delta_{n+1}=(1-\mu x^2)\delta_n,\;\; 0<\mu<\tfrac{2}{x^2}}` },
          {
            label: (
              <>
                有雜訊時的平均方向（<Tex>{'E[vx]=0'}</Tex>）
              </>
            ),
            tex: String.raw`\boxed{E[e\,x]=(a-w)\,E[x^2]}` },
          {
            label: (
              <>
                平均 <Tex>{'N'}</Tex> 筆的雜訊
              </>
            ),
            tex: String.raw`\boxed{\operatorname{std}(\bar G_N)=s_1/\sqrt N}` },
        ]}
        points={[
          <>
            LMS 只做三件事：用 <Tex>{'w'}</Tex> <strong>預測</strong>、和真實輸出<strong>比較</strong>、依 <Tex>{'e\\cdot x'}</Tex> <strong>修正</strong>。
          </>,
          <>
            <Tex>{'e\\cdot x'}</Tex> 不是湊出來的：它是單筆成本 <Tex>{'\\tfrac12e^2'}</Tex> 對 <Tex>{'w'}</Tex> 的負梯度（chain rule 一步得到）。
          </>,
          <>
            <Tex>{'\\mu'}</Tex> 決定速度與穩定：固定 <Tex>{'x'}</Tex> 時 pole <Tex>{'p=1-\\mu x^2'}</Tex>；<Tex>{'0<\\mu<2/x^2'}</Tex> 才收斂，太大會修過頭甚至發散；<Tex>{'\\mu<0'}</Tex> 是極性錯誤（往上坡走），<Tex>{'\\mu=0'}</Tex> 則完全不更新。
          </>,
          <>
            雜訊不改變平均方向（<Tex>{'E[vx]=0'}</Tex> 時），但會讓每一步抖動；平均 <Tex>{'N'}</Tex> 筆，雜訊只降 <Tex>{'\\sqrt N'}</Tex> 倍；LMS 的穩態抖動{' '}
            <Tex>{'\\operatorname{Var}(w_\\infty)=\\mu\\sigma_v^2/(2-\\mu x^2)'}</Tex>，<Tex>{'\\mu'}</Tex> 越小越準但越慢。
          </>,
          <>
            PLL 的 DTC 校正就是 LMS：1-bit 比較器給 <Tex>{'\\mathrm{sign}(e)'}</Tex>，GMAC 累加 <Tex>{'q\\cdot x'}</Tex>，<Tex>{'\\mu'}</Tex> 是右移——後面每一章都在處理這個迴圈的非理想。
          </>,
        ]}
      />
    </Section>
  )
}

/** §0.13 學習地圖：附錄 E 的 15 個問題分別在哪一章回答。 */
export function LearningMapSection() {
  return (
    <Section kind="diagram" level={2} id="ch00-map" title="§0.13 學習地圖：15 個問題在哪裡回答">
      <p>
        整個網站最後要能回答下面 15 個問題（規格附錄 E）。標 <span className="ch00-here">本章</span> 的題目，這一課已經給了入門版答案；其餘的請照連結前往。
      </p>
      <div className="table-wrap">
        <table className="ch00-map">
          <thead>
            <tr>
              <th>#</th>
              <th>問題</th>
              <th>主要回答</th>
              <th>補充</th>
            </tr>
          </thead>
          <tbody>
            {LEARNING_MAP.map((m) => {
              const main = m.pages[0]
              const others = m.pages.slice(1).filter((p) => p !== 'ch00')
              const hereLink = m.here ? (
                <a href="#/ch/00" className="ch00-here" onClick={(ev) => scrollToAnchor(ev, m.here!)}>
                  本章 {m.hereLabel ?? ''}
                </a>
              ) : null
              const supplements = [...(main !== 'ch00' && hereLink ? [hereLink] : []), ...others.map((p) => <PageLink key={p} id={p} />)]
              return (
                <tr key={m.q}>
                  <td>{m.q}</td>
                  <td>
                    <InlineMath text={m.question} />
                  </td>
                  <td>{main === 'ch00' ? hereLink : <PageLink id={main} />}</td>
                  <td>
                    {supplements.map((el, i) => (
                      <Fragment key={i}>
                        {el}
                        {i < supplements.length - 1 && '、'}
                      </Fragment>
                    ))}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <h3>三條學習路線</h3>
      <ul className="ch00-routes">
        {ROUTES.map((r) => (
          <li key={r.name}>
            <strong>{r.name}</strong>
            <br />
            {r.pages.map((p, i) => (
              <Fragment key={p}>
                <PageLink id={p} />
                {i < r.pages.length - 1 && ' → '}
              </Fragment>
            ))}
          </li>
        ))}
      </ul>
      <p className="small">
        下一課 <PageLink id="ch01" /> 會回答「為什麼叫 Least <em>Mean</em> <em>Squares</em>」，並比較平方與絕對值兩種成本。
      </p>
    </Section>
  )
}

/**
 * HashRouter 下 href="#xxx" 會被當成路由，所以連結本身指向本章（#/ch/00，新分頁開啟也不會 404），
 * 點擊時再捲動到頁內段落。
 */
function scrollToAnchor(ev: MouseEvent<HTMLAnchorElement>, hash: string) {
  const el = document.getElementById(hash.slice(1))
  if (!el) return
  ev.preventDefault()
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
