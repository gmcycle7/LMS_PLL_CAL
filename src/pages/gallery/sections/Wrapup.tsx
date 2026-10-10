import { Link } from 'react-router-dom'
import { Callout, Quiz, Recap, SourceTag, Tex, TexBlock } from '@/components'
import { acceptHalfWidth, decimalsOf, extractNumbers, findExpectedMatch, PRECISE_REL, texNum } from '../format'
import { Rich } from '../common'
import { JumpButton } from './SlotAudit'

const t = (x: number, sig = 6) => texNum(x, sig)

/** 思考題 1 的題目輸入（假想的重算值與兩種寫法；答案由 findExpectedMatch 當場判定） */
export const QUIZ1 = { yhat: 0.39919, precise: '0.399', coarse: '0.40' }
/** 思考題 4 的題目輸入 */
export const QUIZ4 = { g: 0.5, lambdaMin: 0.01, frac: 0.05 }

export function quiz1Answer() {
  const [p] = extractNumbers(QUIZ1.precise)
  const [c] = extractNumbers(QUIZ1.coarse)
  return {
    p,
    c,
    pMatch: findExpectedMatch(QUIZ1.yhat, [p], 1.001, true) !== null,
    cMatch: findExpectedMatch(QUIZ1.yhat, [c], 1.001, true) !== null,
    pPrecise: p.tol <= PRECISE_REL * Math.abs(p.value),
    cPrecise: c.tol <= PRECISE_REL * Math.abs(c.value),
  }
}

export function quiz4Answer() {
  const pole = 1 - QUIZ4.g * QUIZ4.lambdaMin
  const real = Math.log(QUIZ4.frac) / Math.log(Math.abs(pole))
  return { pole, real, blocks: Math.ceil(real) }
}

/** 12 個例子對應到 SSPLL 的 GOS / PHOS 校正（對應關係是示意，不是晶片量測） */
const SSPLL_MAP: { loop: string; presets: string; why: string }[] = [
  { loop: 'GOS（input DTC 的 gain 誤差）', presets: '#1、#2', why: '最基本的一個係數、一個 1-bit PD：先確認「預測 → 比較 → 修正」與 $K_q$。' },
  { loop: 'GOS', presets: '#3、#4', why: 'PD 看到的是經過 PLL error path 的 $u$。迴路頻寬很寬時，code 能量所在頻率的相位 $\\varphi$ 可以超過 $90^\\circ$，raw regressor 的相關 $C$ 就變號。' },
  { loop: 'GOS', presets: '#7、#8、#9、#10', why: 'DTC 的 INL 讓 GMAC 歸零點偏離真值；係數雜訊乘上 code 變成 spur；gain code 位元數有限。' },
  { loop: 'PHOS（8 相 PMUX 的各相 offset）', presets: '#6、#11', why: '各相的 regressor 是 one-hot：彼此相關、加總恆為 1，所以有一個共模方向學不到（gauge）。' },
  { loop: 'GOS 與 PHOS 一起開', presets: '#5、#12', why: '兩個迴路各自單獨調都穩定，不代表一起開也穩定：要看整個矩陣的 eigenvalue。' },
]

/** §10：思考題、本頁必記、連到 PLL */
export function Wrapup() {
  const q1 = quiz1Answer()
  const q4 = quiz4Answer()
  return (
    <section aria-labelledby="gal-s10" className="gal-section">
      <h2 id="gal-s10">10｜思考題、必記與下一步</h2>

      <Quiz
        title="思考題 1（計算）：文字要寫幾位才算數"
        question={
          <>
            某個必備數值的重算值是 <Tex>{`\\hat y=${t(QUIZ1.yhat)}\\,\\mathrm{fs}`}</Tex>。(a) 預期文字寫「<Tex>{QUIZ1.precise}</Tex>」；(b) 預期文字寫「<Tex>{QUIZ1.coarse}</Tex>」。兩種寫法各會被判為相符還是不相符？
          </>
        }
        answer={
          <>
            <p>
              (a) <Tex>{`n_{\\mathrm d}=${decimalsOf(q1.p)}\\Rightarrow\\Delta_{\\mathrm t}=${t(q1.p.tol)}`}</Tex>；<Tex>{`\\Delta_{\\mathrm t}/|y_{\\mathrm t}|=${t(q1.p.tol / q1.p.value, 3)}\\le${PRECISE_REL}`}</Tex>，
              {q1.pPrecise ? '夠精確' : '不夠精確'}，所以 <Tex>{`W=${t(acceptHalfWidth(q1.p, 1, true), 3)}`}</Tex>；<Tex>{`|\\hat y-y_{\\mathrm t}|=${t(Math.abs(QUIZ1.yhat - q1.p.value), 3)}`}</Tex>
              ，<strong>{q1.pMatch ? '相符' : '不相符'}</strong>。
            </p>
            <p>
              (b) <Tex>{`n_{\\mathrm d}=${decimalsOf(q1.c)}\\Rightarrow\\Delta_{\\mathrm t}=${t(q1.c.tol)}`}</Tex>；<Tex>{`\\Delta_{\\mathrm t}/|y_{\\mathrm t}|=${t(q1.c.tol / q1.c.value, 3)}`}</Tex>
              {q1.cPrecise ? '，夠精確' : <>，超過 <Tex>{String(PRECISE_REL)}</Tex>：不夠精確</>}，接受半寬縮成 <Tex>{`W=${t(acceptHalfWidth(q1.c, 1, true), 3)}`}</Tex>（只接受相等）；<Tex>{`|\\hat y-y_{\\mathrm t}|=${t(Math.abs(QUIZ1.yhat - q1.c.value), 3)}`}</Tex>
              ，<strong>{q1.cMatch ? '相符' : '不相符'}</strong>。
            </p>
            <p className="small">
              重點：(b) 的文字「四捨五入後沒有錯」，但只有兩位有效數字，<Tex>{`${t(q1.c.value - q1.c.tol, 4)}`}</Tex> 到 <Tex>{`${t(q1.c.value + q1.c.tol, 4)}`}</Tex>{' '}
              之間的任何值都會被寫成它，不足以當作模型正確的證據。以上數字由 <code>extractNumbers</code>、<code>acceptHalfWidth</code>、<code>findExpectedMatch</code> 當場算出。
            </p>
          </>
        }
      />

      <Quiz
        title="思考題 2：極性錯了，縮小步長有用嗎"
        question={
          <>
            #3 的相關 <Tex>{'C<0'}</Tex>，正的 <Tex>{'\\mu'}</Tex> 讓平均誤差發散。把 <Tex>{'\\mu'}</Tex> 縮小成原來的 <Tex>{'1/10'}</Tex> 會怎樣？
          </>
        }
        options={[
          { label: '變成穩定，只是收斂變慢' },
          { label: '仍然發散，只是變慢', correct: true },
          { label: '變成等幅振盪' },
          { label: '係數完全不動' },
        ]}
        answer={
          <>
            <TexBlock>{String.raw`p=1-\mu K_qC=1+\mu K_q|C|>1\quad\text{對所有 }\mu>0`}</TexBlock>
            <p>
              <Tex>{'K_q>0'}</Tex>、<Tex>{'C<0'}</Tex>，所以 <Tex>{'-\\mu K_qC'}</Tex> 恆為正：<Tex>{'\\mu'}</Tex> 再小，pole 也只是從右邊靠近 1，不會跨進單位圓。要修的是<strong>符號</strong>——把 regressor 延遲{' '}
              <Tex>{'D'}</Tex> 個 sample 讓 <Tex>{'\\cos(\\varphi+\\Omega D)>0'}</Tex>（#4）、改用 filtered-x，或把更新極性反過來。可以按 #3 的「載入並執行」到 Polarity Explorer，把 <Tex>{'\\mu'}</Tex> 調小親自驗證。
            </p>
          </>
        }
      />

      <Quiz
        title="思考題 3：跑得夠久，就學得到真值嗎"
        question={
          <>
            #11 的模型是 <Tex>{'y=b+\\sum_i a_ix_i'}</Tex>，<Tex>{'x_i'}</Tex> 是 one-hot（每個 sample 恰有一個是 1）。LMS 的 pole 都穩定，跑一百萬個 block 之後，<Tex>{'(b,a_0,\\dots,a_3)'}</Tex> 會收斂到真值嗎？
          </>
        }
        options={[
          { label: '會，只要步長夠小' },
          { label: '不會：只收斂到「與真值差一個 gauge 平移」的某一組，停在哪一組由初值決定', correct: true },
          { label: '不會：係數會發散' },
          { label: '會，但只有 b 會收斂' },
        ]}
        answer={
          <>
            <TexBlock>{String.raw`(b+c)+\sum_i(a_i-c)\,x_i=b+\sum_ia_ix_i+c\Big(1-\sum_ix_i\Big)=b+\sum_ia_ix_i`}</TexBlock>
            <p>
              因為 <Tex>{'\\sum_ix_i=1'}</Tex>，把 <Tex>{'b'}</Tex> 加 <Tex>{'c'}</Tex>、每個 <Tex>{'a_i'}</Tex> 減 <Tex>{'c'}</Tex>，輸出一模一樣——資料分不出這兩組參數。對應的方向{' '}
              <Tex>{'\\mathbf n\\propto(1,-1,-1,-1,-1)'}</Tex> 滿足 <Tex>{'\\mathbf R_x\\mathbf n=\\mathbf 0'}</Tex>（<Tex>{'\\lambda_{\\min}=0'}</Tex>），那個方向的 pole 恰好是 1：不發散，也永遠不動。穩定（問題 (1)）不代表學得到（問題 (2)）。
            </p>
          </>
        }
      />

      <Quiz
        title="思考題 4（計算）：慢模式要等多久"
        question={
          <>
            <Tex>{`g=\\mu K_q=${t(QUIZ4.g)}`}</Tex>、<Tex>{`\\lambda_{\\min}=${t(QUIZ4.lambdaMin)}`}</Tex>。慢模式的誤差要幾個 block 才會降到初值的 <Tex>{`${t(100 * QUIZ4.frac)}\\%`}</Tex>？
          </>
        }
        answer={
          <>
            <TexBlock>{`p_{\\text{slow}}=1-g\\lambda_{\\min}=${t(q4.pole)},\\qquad |p|^k\\le${t(QUIZ4.frac)}\\iff k\\ge\\frac{\\ln ${t(QUIZ4.frac)}}{\\ln ${t(q4.pole)}}=${t(q4.real, 6)}\\;\\Rightarrow\\;k=${q4.blocks}`}</TexBlock>
            <p>
              取對數時 <Tex>{'\\ln|p|<0'}</Tex>，所以不等號方向翻轉。這是 #6 的數字（由 <code>Math.log</code> 當場算出）；注意它是平均（mean）遞迴的結論，而且前提是 <Tex>{'K_q'}</Tex> 正規化為 1。
            </p>
          </>
        }
      />

      <Quiz
        title="思考題 5：「模型判定失穩」但「比對結果一致」"
        question={<>§5 的重算表中，#3、#5、#12 的「模型判定」是失穩，「比對結果」卻是一致。這代表什麼？</>}
        options={[
          { label: '網站有 bug：失穩就應該判為不一致' },
          { label: '這三個 preset 本來就要示範發散；模型算出的發散程度與預期文字寫的數字相符', correct: true },
          { label: '比對沒有真的執行' },
          { label: '預期文字寫錯了' },
        ]}
        answer={
          <p>
            兩欄回答的是不同的問題。「模型判定」是模型函式對<strong>這組參數</strong>的結論（pole 在單位圓外）；「比對結果」是<strong>重算值與文字是否相同</strong>。一個好的反面教材，正是「模型確實發散、而且發散得和文字說的一樣」。反過來，如果有人把{' '}
            <code>calPole</code> 的符號改錯，#3 會變成「模型判定正常、比對不一致」——比對抓到的就是這種情況。
          </p>
        }
      />

      <Recap
        title="這一頁最重要的公式"
        formulas={[
          { label: '預期文字的相符判據（接受半寬 $W$ 見 F-GA.1）', tex: String.raw`\boxed{\ |\hat y-y_{\mathrm t}|\le W,\qquad \Delta_{\mathrm t}=\tfrac12\,10^{\,e-n_{\mathrm d}}\ }` },
          { label: '三個問題（線性化的平均模型）', tex: String.raw`\boxed{\ \rho(\mathbf A)<1,\qquad \boldsymbol\delta_\infty=(\mathbf I-\mathbf A)^{-1}\mathbf b,\qquad \sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2}\ }` },
          { label: '1-bit 校正迴路的 pole', tex: String.raw`\boxed{\ p=1-\mu K_qC,\qquad K_q=\frac{\sqrt{2/\pi}}{\sigma_v}\ }` },
          { label: '多參數：一起更新時要看整個矩陣', tex: String.raw`\boxed{\ \boldsymbol\delta_{k+1}=(\mathbf I+\mathbf M\mathbf J)\,\boldsymbol\delta_k,\qquad \rho(\mathbf I+\mathbf M\mathbf J)<1\ }` },
        ]}
        points={[
          <>一個 preset = 頁面 + 實驗 + 參數 + 預期結果；Gallery 自動收集所有 JSON，缺少的必備 preset 只會被標成「缺少」。</>,
          <>卡片上的文字是人寫的；即時預覽的數字是瀏覽器當場用模型函式算的。兩者要逐項比對，才抓得到「模型改壞了，畫面卻照樣顯示成功」。</>,
          <>文字寫幾位有效數字，比對就只能精確到幾位；少於約 3 位的數字不足以當證據。</>,
          <>12 個例子只在問三個問題：走不走得回來（pole）、停在哪裡（固定點）、停下來後抖多大（雜訊）。</>,
          <>「模型判定失穩」和「比對不一致」是兩回事：前者是物理結論，後者才是程式或文字出錯。</>,
        ]}
      />

      <h3>連結到 PLL：這 12 個例子在晶片上是哪些旋鈕</h3>
      <div className="c-tag-row">
        <SourceTag kind="illustrative" />
        <span className="small muted">對應關係是概念上的整理，不是任何晶片的量測結果。</span>
      </div>
      <p>
        以 subsampling PLL 為例：input DTC 的 gain 誤差由一個迴路校正（GOS），8 相 PMUX 的各相 offset 由另一組迴路校正（PHOS）。12 個 preset 各自對應其中一個會出問題的環節；完整的案例分析在{' '}
        <Link to="/case/sspll">07b 案例：SSPLL 的 GOS / PHOS 極性</Link>。
      </p>
      <div className="table-wrap">
        <table className="gal-table">
          <thead>
            <tr>
              <th>校正迴路</th>
              <th>相關 preset</th>
              <th>在硬體上的意義</th>
            </tr>
          </thead>
          <tbody>
            {SSPLL_MAP.map((r) => (
              <tr key={r.presets}>
                <td>{r.loop}</td>
                <td className="nowrap">{r.presets}</td>
                <td>
                  <Rich text={r.why} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Callout kind="info" title="下一步">
        <ul>
          <li>
            想看每個 T-id 的獨立驗證（TypeScript 與 Python golden 各自計算）與全部勘誤：<a href="#/verification">T01–T18 驗證狀態</a>。
          </li>
          <li>
            想自己組一個新的實驗：<Link to="/models">Behavioral Models</Link> 的 Block Sign-LMS JSON Lab，或 <Link to="/lab">Calibration Lab</Link>。
          </li>
          <li>
            想知道「什麼時候可以宣稱穩定」：<Link to="/signoff">Sign-off Checklist</Link>。
          </li>
          <li>
            回到本頁的<JumpButton domId="gal-s8">全部 preset 與篩選</JumpButton>。
          </li>
        </ul>
      </Callout>
    </section>
  )
}
