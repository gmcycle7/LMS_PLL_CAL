import { useMemo } from 'react'
import { ClaimTag, Quiz, Recap, Tex, TexBlock } from '@/components'
import { accBitsExact, truncationEquilibrium, worstCaseAccumulate } from '../experiments/gmacMath'
import { ChLink, HandCalcSlot, md, sig, texNum } from '../common'
import { SPEC_NUMBERS, gCritical, pmDeg } from '../refNumbers'

/** §11 思考題與本頁必記 */
export function S10Wrap() {
  const n = SPEC_NUMBERS
  const ex = useMemo(() => {
    const sym = accBitsExact(6, 4096, 'symmetric')
    const full = accBitsExact(6, 4096, 'full')
    const short = worstCaseAccumulate(6, 4096, 'symmetric', sym - 1, 1)
    const fullWorst = worstCaseAccumulate(6, 4096, 'full', full, 1)
    const t0 = truncationEquilibrium({ bx: 6, log2N: 12, gFracBits: 0, rounding: 'floor', sigmaV: 100 })
    return { sym, full, short, fullWorst, t0 }
  }, [])
  const B = Math.log(0.01) / Math.log(n.p)
  // 思考題 5：d = 1 時要保留 PM ≥ 45° 的最大 g：90° − 3·asin(g/2) = 45° ⇒ g = 2 sin 15°
  const gPm45 = 2 * Math.sin(Math.PI / 12)
  const muPm45 = gPm45 / n.K
  return (
    <section aria-labelledby="models-s11">
      <h2 id="models-s11">11｜綜合手算、思考題與本頁必記</h2>
      <p>
        先做一題綜合手算，回答 §1 的開場問題：把 §3.4 的 <Tex>{'\\sigma_w'}</Tex>（L1 浮點模型）和 §9.2 的截斷偏差 <Tex>{'\\delta^*'}</Tex>（L5 RTL）用同一組數字算出來、放在一起比，再決定 RTL 要保留幾個小數 bit。做完再做思考題。全站的手算題彙整在{' '}
        <ChLink to="/workbook">手算練習簿</ChLink>。
      </p>
      <HandCalcSlot id="HC-MD.6">
        換成你的 <Tex>{'\\sigma_v'}</Tex>、<Tex>{'\\mu'}</Tex>、code 位元數與 block 長度：你的 RTL 要保留幾個小數 bit，gain 才不會被右移截斷「推歪」到看得出來？
      </HandCalcSlot>
      <Quiz
        title="思考題 1：accumulator 位元數"
        question={
          <>
            GMAC 的 regressor 是 6-bit 有號 code，但編碼保證不會出現 <Tex>{'-32'}</Tex>（symmetric，範圍 <Tex>{'-31\\ldots31'}</Tex>）；每個 block 累加 <Tex>{'N=4096'}</Tex> 筆 <Tex>{'q\\cdot x'}</Tex>。最少需要幾 bit 的有號
            accumulator 才保證不溢位？
          </>
        }
        options={[{ label: String(ex.sym - 1) }, { label: String(ex.sym), correct: true }, { label: String(ex.full) }, { label: '24' }]}
        answer={
          <>
            <TexBlock>{String.raw`|S|\le 4096\times31=${ex.short.exact}\le2^{${ex.sym - 1}}-1=${2 ** (ex.sym - 1) - 1}\;\Rightarrow\;A-1=${ex.sym - 1},\;A=${ex.sym}`}</TexBlock>
            <p>
              {ex.sym - 1} bits 的上限只有 <Tex>{`2^{${ex.sym - 2}}-1=${2 ** (ex.sym - 2) - 1}`}</Tex>，會把 <Tex>{`${ex.short.exact}`}</Tex> wrap 成 <Tex>{`${ex.short.wrapped}`}</Tex>（符號翻轉）。若 code 可以是{' '}
              <Tex>{'-32'}</Tex>（full range），條件取負會產生 <Tex>{'+32'}</Tex>，總和 <Tex>{`${ex.fullWorst.exact}`}</Tex> 剛好超過 {ex.sym}-bit 的上限，需要 {ex.full} bits（§9.1）。
            </p>
          </>
        }
      />
      <Quiz
        title="思考題 2：sum 還是 average？"
        question={
          <>
            演算法團隊以 average GMAC 調好 <Tex>{'\\mu=10\\,\\mathrm{fs}'}</Tex>（<Tex>{`g=${texNum(n.g, 4)}`}</Tex>）。RTL 為了省掉右移，讓積分器直接加 <Tex>{'\\mu S_k'}</Tex>（sum），<Tex>{'\\mu'}</Tex> 不變。新的
            loop gain 是多少？
          </>
        }
        options={[{ label: sig(n.g, 4) }, { label: '2' }, { label: sig(n.gSum, 4), correct: true }, { label: sig(n.g / n.N, 4) }]}
        answer={
          <>
            <TexBlock>{String.raw`g_\mathrm{sum}=N\,g_\mathrm{avg}=4096\times${texNum(n.g, 5)}=${texNum(n.gSum, 5)},\quad p=1-g_\mathrm{sum}=${texNum(n.poleSum, 5)}`}</TexBlock>
            <p>
              遠超過 2，線性模型發散；sign-LMS 的 <Tex>{'|G|'}</Tex> 有界，所以實際上變成大振幅 period-2 振盪。修正：<Tex>{'\\mu'}</Tex> 改成 <Tex>{`\\mu/N=${texNum(10 / n.N, 4)}\\,\\mathrm{fs}`}</Tex>
              ，或把右移放回去（F-16.4）。用 JSON Lab 的 preset「反面：sum GMAC 卻沿用 average 的 <Tex>{'\\mu'}</Tex>」親眼看。
            </p>
          </>
        }
      />
      <Quiz
        title="思考題 3：截斷偏差"
        question={
          <>
            同樣是 6-bit symmetric code、<Tex>{'N=4096'}</Tex>、<Tex>{'\\sigma_v=100\\,\\mathrm{fs}'}</Tex>，RTL 用算術右移 12 bits（floor）求平均、不保留小數 bit。真值 <Tex>{'a=3\\,\\mathrm{fs}'}</Tex>，gain
            平均會停在哪裡？
          </>
        }
        options={[
          { label: md('$3\\,\\mathrm{fs}$（GMAC 歸零就代表正確）') },
          { label: md(`$${sig(3 - n.sigmaW, 3)}\\,\\mathrm{fs}$（差一個 $\\sigma_w$）`) },
          { label: md(`$${sig(3 - ex.t0.deltaStar, 3)}\\,\\mathrm{fs}$`), correct: true },
          { label: md(`$${sig(3 + ex.t0.deltaStar, 3)}\\,\\mathrm{fs}$`) },
        ]}
        answer={
          <>
            <TexBlock>{String.raw`\delta^*\approx\frac{\Delta_G}{2K}=\frac{1/32}{2\times${texNum(ex.t0.derived.K, 5)}}=${texNum(ex.t0.approxDeltaStar, 4)}\,\mathrm{fs}\quad(\text{精確 mean-field }${texNum(ex.t0.deltaStar, 4)}\,\mathrm{fs})`}</TexBlock>
            <p>
              floor 平均截掉半個 LSB，迴路只好讓真實 <Tex>{'G'}</Tex> 平均停在 <Tex>{'+\\tfrac12'}</Tex> LSB——也就是 <Tex>{'\\delta=a-w>0'}</Tex>，
              <Tex>{`w^*=a-\\delta^*\\approx${sig(3 - ex.t0.deltaStar, 3)}\\,\\mathrm{fs}`}</Tex>。方向是「<Tex>{'w'}</Tex> 偏小」，因為 floor 永遠往下截。改用 round half up 或保留小數 bit（§9.2）。
            </p>
          </>
        }
      />
      <Quiz
        title="思考題 4：relock 之後多久才算校正好？（計算題）"
        question={
          <>
            §15.3 範例（<Tex>{`p=${texNum(n.p, 6)}`}</Tex>、<Tex>{`f_u=${texNum(n.fu / 1e3, 7)}\\,\\mathrm{kHz}`}</Tex>）。PLL relock 後 gain 誤差是 <Tex>{'\\sigma_w'}</Tex> 的 100 倍，要降到{' '}
            <Tex>{'\\sigma_w'}</Tex> 量級需要幾個 block？多少時間？
          </>
        }
        answer={
          <>
            <TexBlock>{String.raw`p^B=0.01\;\Rightarrow\;B=\frac{\ln0.01}{\ln p}=${texNum(B, 4)}\ \text{blocks},\qquad t=\frac{B}{f_u}=${texNum((B / n.fu) * 1e6, 4)}\,\mu\mathrm{s}`}</TexBlock>
            <p>
              這是線性平均模型的估計 <ClaimTag kind="approx" />。若初始誤差遠大於 <Tex>{'\\sigma_v'}</Tex>，comparator 飽和、每個 block 最多走 <Tex>{'\\mu\\max|x|'}</Tex>，實際更慢（E48；
              <ChLink to="/ch/14">Ch14</ChLink>）。
            </p>
          </>
        }
      />
      <Quiz
        title="思考題 5：commit 延遲吃掉多少 margin？（計算題）"
        question={
          <>
            RTL 的 gain commit 比模型晚 <Tex>{'d=1'}</Tex> 個 block。§15.3 範例的 <Tex>{`g=${texNum(n.g, 4)}`}</Tex> 還剩多少 phase margin？若要求 <Tex>{'\\mathrm{PM}\\ge45^\\circ'}</Tex>，<Tex>{'\\mu'}</Tex>{' '}
            最大可以設多少？
          </>
        }
        answer={
          <>
            <TexBlock>{String.raw`\mathrm{PM}=90^\circ-(2d+1)\arcsin\frac g2=90^\circ-3\times${texNum((Math.asin(n.g / 2) * 180) / Math.PI, 4)}^\circ=${texNum(pmDeg(n.g, 1), 4)}^\circ\quad(d=0\text{ 時 }${texNum(pmDeg(n.g, 0), 4)}^\circ)`}</TexBlock>
            <TexBlock>{String.raw`90^\circ-3\arcsin\frac g2\ge45^\circ\;\Rightarrow\;g\le2\sin15^\circ=${texNum(gPm45, 4)}\;\Rightarrow\;\mu\le\frac{g}{K_qC}=\frac{${texNum(gPm45, 4)}}{${texNum(n.K, 5)}}=${texNum(muPm45, 4)}\,\mathrm{fs}`}</TexBlock>
            <p>
              範例的 <Tex>{'g'}</Tex> 很小，所以延遲 1 個 block 只損失 <Tex>{`${texNum(pmDeg(n.g, 0) - pmDeg(n.g, 1), 3)}^\\circ`}</Tex>；但穩定上限已由 <Tex>{'g<2'}</Tex> 降到{' '}
              <Tex>{`g<${texNum(gCritical(1), 4)}`}</Tex>（§3.4）。這是一階平均模型的 PM <ClaimTag kind="exact" />，不是含主 PLL 耦合的完整 PM（<ChLink to="/ch/08">Ch08</ChLink>）。
            </p>
          </>
        }
      />
      <Recap
        title="本頁最重要的公式"
        formulas={[
          { label: '參考 Block Sign-LMS（F-15.1）', tex: String.raw`G_k=\frac1N\sum_{n\in k}q[n]x_\mathrm{ref}[n],\quad w_{k+1}=w_k+\mu G_k` },
          { label: '平均遞迴與穩定界（F-15.3、F-15.4）', tex: String.raw`\delta_{k+1}=p\,\delta_k-\mu\eta_k,\;p=1-\mu K_qC;\quad 0<g<2\sin\tfrac{\pi}{4d+2}` },
          { label: '穩態係數雜訊（F-15.5）', tex: String.raw`\sigma_w^2=\frac{\mu^2E[x_\mathrm{ref}^2]/N}{1-p^2}` },
          { label: 'Accumulator 位元數（F-16.1）', tex: String.raw`B_\mathrm{acc}=1+\bigl\lceil\log_2(N M_x+1)\bigr\rceil;\quad N=2^L:\;B_x+L\;(\text{symmetric}),\;B_x+L+1\;(\text{full})` },
          { label: '截斷偏差（F-16.3）', tex: String.raw`\delta^*\approx\frac{\Delta_G}{2K}\;(\text{floor})` },
        ]}
        points={[
          <>模型層級決定結論能推廣到哪裡：L0–L2 是教學與 sanity check，L4–L6 才接近 sign-off，而本站的 L4–L6 都是簡化版。</>,
          <>
            頁面上的程式碼就是網站執行的程式碼；規格偽程式與實作的差異（DTC 誤差才進 <Tex>{'H_\\mathrm{PD}'}</Tex>、更新延遲 <Tex>{'d'}</Tex>、offset、sum/average、定點）都會改變數字。
          </>,
          <>
            RTL 的每一個等號都要問：幾 bit？誰先誰後？怎麼 round？<Tex>{'N=2^L'}</Tex> 時 symmetric code 的 accumulator 是 <Tex>{'B_x+L'}</Tex> bits，full range 要再多 1 bit。
          </>,
          <>
            floor 截斷會把 gain 推離真值 <Tex>{'\\Delta_G/(2K)'}</Tex>，而且與 <Tex>{'\\sigma_v'}</Tex> 成正比；GMAC 歸零不代表沒有偏差。
          </>,
          <>一條 FFT 不能證明有或沒有 spur；寫明 window、紀錄長度、coherent、RBW、one/two-sided、peak/RMS、dBc 或 dBc/Hz，並用 coherent tone fit 交叉確認。</>,
        ]}
      />
      <p className="small">
        下一步：<ChLink to="/verification">T01–T18 驗證狀態與勘誤</ChLink>、<ChLink to="/signoff">Sign-off Checklist</ChLink>、<ChLink to="/lab">Unified Calibration Lab</ChLink>。
      </p>
    </section>
  )
}
