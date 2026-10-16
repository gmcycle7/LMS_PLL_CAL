import { useMemo } from 'react'
import { Quiz, Recap, Section, Tex, TexBlock, mathText, ChRef } from '@/components'
import { meanSquareFactor } from '@/simulation/models/lms'
import { CONVENTION_SHORT, corr2Eigs, criticalGain, delaySpectralRadius, gainScale, muForScale } from '../bridge'
import { Hand, num, r } from '../common'

/** 思考題用的數字（全部由程式計算） */
export const QUIZ = {
  q1: { muW: 0.05, Px: 2, rho: 0 },
  q2: { mu: 1, Ex2: 1, Ex4: 3 },
  q3: { g: 0.7, d: 2 },
} as const

export function quizNumbers() {
  const { lmax } = corr2Eigs(QUIZ.q1.Px, QUIZ.q1.rho)
  const ctx = { traceR: 2 * QUIZ.q1.Px, epsReg: 0, sigmaV: 1, N: 1, sumMode: false }
  const s = gainScale({ ...ctx, convention: 'widrow', mu: QUIZ.q1.muW, polarity: 1 })
  const muSite = muForScale(s, 'half', ctx)
  const q1 = { lmax, muSite, g: s * lmax, pole: 1 - s * lmax, boundW: muForScale(criticalGain(0) / lmax, 'widrow', ctx) }
  const q2 = { ms: meanSquareFactor(QUIZ.q2.mu, QUIZ.q2.Ex2, QUIZ.q2.Ex4), mean: 1 - QUIZ.q2.mu * QUIZ.q2.Ex2 }
  const q3 = { gStar: criticalGain(QUIZ.q3.d), radius: delaySpectralRadius(QUIZ.q3.g, QUIZ.q3.d) }
  return { q1, q2, q3 }
}

/** §8 思考題、§9 本頁必記 */
export function S8Wrapup() {
  const q = useMemo(quizNumbers, [])
  return (
    <>
      <Section kind="explore" level={2} title="8. 綜合手算與思考題" id="papers-quiz">
        <p>
          先用紙筆把這一頁的三個動作串起來做一次：換算書上的步長（§4）、找出最慢的 eigen-mode（D7）、算它要幾步（§5 實驗的第一個 preset 就是這組數字）。做完再看後面的思考題。
        </p>
        <Hand id="HC-PR.8" />
        <Quiz
          title="思考題 1：換算步長"
          question={
            <>
              一本 Widrow 型教科書的例子用 <Tex>{r`\mu_W=${QUIZ.q1.muW}`}</Tex>，兩個 tap 的 <Tex>{r`\mathbf R=${QUIZ.q1.Px}\mathbf I`}</Tex>。換成本站{' '}
              {mathText(CONVENTION_SHORT.half)}的步長是多少？平均意義下穩定嗎？
            </>
          }
          options={[
            {
              label: (
                <>
                  本站 <Tex>{r`\mu=\mu_W/2=${num(QUIZ.q1.muW / 2, 4)}`}</Tex>，穩定
                </>
              ),
            },
            {
              label: (
                <>
                  本站 <Tex>{r`\mu=2\mu_W=${num(q.q1.muSite, 4)}`}</Tex>，穩定
                </>
              ),
              correct: true,
            },
            {
              label: (
                <>
                  本站 <Tex>{r`\mu=2\mu_W=${num(q.q1.muSite, 4)}`}</Tex>，不穩定
                </>
              ),
            },
            {
              label: (
                <>
                  本站 <Tex>{r`\mu=\mu_W=${num(QUIZ.q1.muW, 4)}`}</Tex>（不用換算），穩定
                </>
              ),
            },
          ]}
          answer={
            <>
              <TexBlock>{r`\mu=2\mu_W=${num(q.q1.muSite, 4)},\qquad g_{\max}=\mu\lambda_{\max}=${num(q.q1.muSite, 4)}\times${num(q.q1.lmax, 4)}=${num(q.q1.g, 4)},\qquad p=1-g_{\max}=${num(q.q1.pole, 4)}`}</TexBlock>
              <Tex>{r`|p|<1`}</Tex>，平均收斂。用 Widrow 自己的界限檢查也一樣：<Tex>{r`\mu_W=${QUIZ.q1.muW}<1/\lambda_{\max}=${num(q.q1.boundW, 4)}`}</Tex>。
            </>
          }
        />
        <Quiz
          title="思考題 2：論文只證明了 mean 收斂"
          question={
            <>
              某講義證明 <Tex>{r`E[\delta_n]\to0`}</Tex>，例子用 <Tex>{r`\mu=${QUIZ.q2.mu}`}</Tex>、iid Gaussian <Tex>{'x'}</Tex>（
              <Tex>{r`E[x^2]=${QUIZ.q2.Ex2}`}</Tex>）、無雜訊。
              <Tex>{r`E[\delta_n^2]`}</Tex> 會怎樣？
            </>
          }
          options={[
            { label: '和平均一樣，一步歸零' },
            {
              label: (
                <>
                  每步乘上 <Tex>{num(q.q2.ms, 4)}</Tex>，發散
                </>
              ),
              correct: true,
            },
            {
              label: (
                <>
                  每步乘上 <Tex>{r`1/3`}</Tex>，收斂
                </>
              ),
            },
            { label: '資訊不足，無法判斷' },
          ]}
          answer={
            <>
              <TexBlock>{r`\frac{E[\delta_{n+1}^2]}{E[\delta_n^2]}=1-2\mu E[x^2]+\mu^2E[x^4]=1-2\cdot${QUIZ.q2.mu}\cdot${QUIZ.q2.Ex2}+${QUIZ.q2.mu}^2\cdot${QUIZ.q2.Ex4}=${num(q.q2.ms, 4)},\qquad \frac{E[\delta_{n+1}]}{E[\delta_n]}=1-\mu E[x^2]=${num(q.q2.mean, 4)}`}</TexBlock>
              平均一步歸零，均方卻每步加倍：mean 收斂不能推出 mean-square 收斂（見本頁 §6、<ChRef ch="03">Ch03</ChRef>）。
            </>
          }
        />
        <Quiz
          title="思考題 3：極性正確就安全嗎？"
          question={
            <>
              單頻相位 <Tex>{r`\theta=0^\circ`}</Tex>（<Tex>{'C>0'}</Tex>），正規化 loop gain <Tex>{r`g=${QUIZ.q3.g}`}</Tex>，更新延遲{' '}
              <Tex>{r`d=${QUIZ.q3.d}`}</Tex> 個 block。平均誤差會收斂嗎？
            </>
          }
          options={[
            {
              label: (
                <>
                  會，因為 <Tex>{r`|\theta|<90^\circ`}</Tex>
                </>
              ),
            },
            {
              label: (
                <>
                  會，因為 <Tex>{'g<2'}</Tex>
                </>
              ),
            },
            {
              label: (
                <>
                  不會，因為 <Tex>{r`g>g^*(${QUIZ.q3.d})`}</Tex>
                </>
              ),
              correct: true,
            },
          ]}
          answer={
            <>
              <TexBlock>{r`g^*(${QUIZ.q3.d})=2\sin\frac{\pi}{${4 * QUIZ.q3.d + 2}}=${num(q.q3.gStar, 5)}<${QUIZ.q3.g},\qquad |z|_{\max}=${num(q.q3.radius, 5)}>1`}</TexBlock>
              <Tex>{r`\pm90^\circ`}</Tex> 只保證方向對；有延遲時 loop gain 的上限從 <Tex>{'2'}</Tex> 縮到 <Tex>{r`g^*(d)`}</Tex>（本頁 D3 面板、<ChRef ch="08">Ch08</ChRef>）。
            </>
          }
        />
        <Quiz
          title="思考題 4：可以拿論文的數字驗證本站嗎？"
          question={<>D4 的題名寫 74 fs jitter；本站 <ChRef ch="12">Ch12</ChRef> 算出的係數 RMS 也是 fs 等級。可以用 D4 的數字當本站 <ChRef ch="12">Ch12</ChRef> 的驗證嗎？</>}
          options={[
            { label: '可以，單位都是 fs' },
            { label: '不行：一個是晶片量測的輸出 jitter，一個是 illustrative 參數下 gain-equivalent 的係數雜訊，模型與物理量都不同', correct: true },
            {
              label: (
                <>
                  可以，只要再乘上 <Tex>{r`\sqrt2`}</Tex>
                </>
              ),
            },
          ]}
          answer={
            <>
              本站的數字由本站模型推導並以 golden model 交叉驗算，文獻不是它的量測來源（本頁 §1）。從係數雜訊到輸出 jitter 還要經過 code 混頻、ZOH 與 PLL output
              transfer（<ChRef ch="12">Ch12</ChRef>）。
            </>
          }
        />
      </Section>
      <Section kind="formula" level={2} title="9. 本頁必記" id="papers-recap">
        <Recap
          title="讀文獻前，這幾個式子要隨身帶著"
          formulas={[
            { tex: r`\boxed{\mu_{\text{本站}}=2\mu_W}`, label: `${CONVENTION_SHORT.half} vs ${CONVENTION_SHORT.widrow}（F-PR.1）` },
            {
              tex: r`\boxed{s_{\mathrm{NLMS}}\approx\frac{\tilde\mu}{\epsilon_{\mathrm{reg}}+\mathrm{tr}\,\mathbf R},\qquad s_{\mathrm{GMAC}}=\mu K_q}`,
              label: r`把 NLMS 與 1-bit GMAC 換成同一個 $s$（近似；F-PR.2、F-PR.3）`,
            },
            { tex: r`\boxed{p_i=1-s\lambda_i,\qquad g^*(d)=2\sin\frac{\pi}{4d+2}}`, label: 'eigen-mode pole 與更新延遲的臨界增益（F-PR.11、F-PR.4）' },
            { tex: r`\boxed{C=\frac1{2\pi}\int_{-\pi}^{\pi}S_{xx}(e^{j\Omega})\,\mathrm{Re}\{H(e^{j\Omega})\}\,d\Omega}`, label: '多頻的極性判據（PSD 加權總和；F-PR.6）' },
            { tex: r`\boxed{\sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2}}`, label: '係數雜訊（gain-equivalent，不是 output jitter；F-PR.8）' },
          ]}
          points={[
            '文獻是延伸閱讀，不是本站數字的量測來源，也不替本站的模型 sign-off。',
            <>
              先換算寫法再比較數字：<Tex>{r`\mu`}</Tex> 有沒有 2 倍、有沒有正規化、有沒有吸收 <Tex>{'K_q'}</Tex>。
            </>,
            '「收斂」要問清楚是 mean、mean-square、almost-sure、局部線性還是全域。',
            '極性正確只是必要條件；更新延遲與 eigenvalue spread 決定能不能又穩又快。',
            '週期性的 dither 產生的仍是線譜；subtractive dither 的代價是下游要有更細的解析度。',
          ]}
        />
      </Section>
    </>
  )
}
