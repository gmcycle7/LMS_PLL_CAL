import { HandLink, Section, StepDerivation, Tex, TexBlock } from '@/components'
import { loopH } from '@/simulation/models/sspll'
import { FREF_MHZ, LOOPS, PARAMS, SUMMARY } from '../data'
import { Claim, DataTable, Diagram, Formula, Hand, Src, fx, r, tx, txs } from '../common'

const F_EX_MHZ = 20

/** §5 為什麼 Re H_PD 會變負：恆等式與「微分」直覺。 */
export function S05Identity() {
  const f = F_EX_MHZ / FREF_MHZ
  const W = 2 * Math.PI * f
  const Ki = Number(LOOPS.L2.params.Ki)
  const K = Number(LOOPS.L1.params.K)
  const corr1 = (1 - Math.cos(W)) / 2
  const corr2 = Math.cos(W) - 1
  const reL2 = loopH(LOOPS.L2, f).re
  const reL1 = loopH(LOOPS.L1, f).re
  const asym2 = -(W * W) / Ki
  const asym1 = ((2 - K) * W * W) / (2 * K * K)
  const cf = PARAMS.closed_forms
  const Kd = Number(LOOPS.L3.params.K)
  return (
    <Section kind="formula" level={2} title="5. 為什麼 $\mathrm{Re}\,H_{PD}$ 會變負：恆等式與「微分」直覺" id="cs-5">
      <h3>5.1 恆等式</h3>
      <p>
        §4 的結論是：每條譜線對梯度的貢獻，正負號看 <Tex>{r`\mathrm{Re}\,H_{PD}`}</Tex>（raw regressor 時 <Tex>{r`\Gamma_{\rm eff}=H_{PD}`}</Tex>）。<Tex>{r`H_{PD}=1/(1+L)`}</Tex> 的實部什麼時候是負的？不用真的去算 <Tex>{r`H_{PD}`}</Tex>，只要看開迴路增益 <Tex>{'L'}</Tex> 這個複數的實部：
      </p>
      <Diagram id="identity" />
      <p>
        先看菱形的判斷：在某個頻率上，<Tex>{'L'}</Tex> 的實部小於 <Tex>{'-1'}</Tex> 嗎？再看「是」那一條路：<Tex>{r`1+\mathrm{Re}\,L<0`}</Tex> 就是 <Tex>{r`\mathrm{Re}\,H_{PD}<0`}</Tex>（下面推導的第 2 步），接著 <Tex>{r`\mathrm{Re}\,T>1`}</Tex>（第 3 步），所以閉迴路增益{' '}
        <Tex>{r`\lvert T\rvert`}</Tex> 一定大於 1。換句話說，圖上紅色那一格（反號）只會出現在閉迴路頻率響應有 peaking 的地方——這是可以直接在量測到的 <Tex>{r`\lvert T\rvert`}</Tex> 曲線上找的線索。
      </p>
      <StepDerivation
        title="一步一步：反號的頻率條件"
        steps={[
          { tex: r`H_{PD}=\frac{1}{1+L}=\frac{\overline{1+L}}{\lvert1+L\rvert^2}`, why: '分子分母同乘共軛，分母變成正實數。' },
          { tex: r`\mathrm{Re}\,H_{PD}=\frac{1+\mathrm{Re}\,L}{\lvert1+L\rvert^2}`, why: '取實部；分母恆正，所以符號由分子決定。' },
          { tex: r`\mathrm{Re}\,T=1-\mathrm{Re}\,H_{PD}`, why: <><Tex>{r`T=L/(1+L)=1-H_{PD}`}</Tex>，兩邊取實部。</> },
          {
            tex: r`\mathrm{Re}\,H_{PD}<0\iff\mathrm{Re}\,L<-1\iff\mathrm{Re}\,T>1\ \Rightarrow\ \lvert T\rvert>1`,
            why: <>由前兩步直接得到；最後一步因為 <Tex>{r`\lvert T\rvert\ge\mathrm{Re}\,T`}</Tex>。</>,
          },
        ]}
      />
      <Formula id="F-CS.4" />
      <p>
        <Claim kind="exact">對任何 L 都成立</Claim>
        golden 在 40 萬點網格上檢查，0 個不一致；也沒有任何一點 <Tex>{r`\mathrm{Re}H<0`}</Tex> 而 <Tex>{r`\lvert T\rvert\le1`}</Tex>（本站的 <code>sspll.test.ts</code> 另以 TS port 重驗）。所以<strong>反號帶一定落在 closed-loop peaking 區裡</strong>。320 MHz 的 Type-II 迴路有 {fx(SUMMARY.L3.tPeakDb, 1)}–{fx(SUMMARY.L2.tPeakDb, 1)} dB 的 peaking（L3／L2），L1 則沒有 peaking——這就是 L1 沒有反號帶的原因。
      </p>
      <p>
        這個恆等式有一個好用的讀法：把複數 <Tex>{'L(e^{j\\Omega})'}</Tex> 隨 <Tex>{r`\Omega`}</Tex> 由 0 到 <Tex>{r`\pi`}</Tex> 在複數平面上畫成一條軌跡（這張圖叫 Nyquist 圖），<Tex>{r`\mathrm{Re}\,L<-1`}</Tex> 就是 <Tex>{'L(e^{j\\Omega})'}</Tex> 的軌跡跑到直線 <Tex>{r`\mathrm{Re}=-1`}</Tex> 左邊的那一段。Type-II 的雙積分器在低頻把 <Tex>{'L'}</Tex> 推向{' '}
        <Tex>{r`-\infty`}</Tex>（相位 −180°），所以一定有這一段。
      </p>

      <h3>5.2 低頻的「微分」直覺</h3>
      <p>
        為什麼 Type-II 一定有反號帶、Type-I 卻不一定？看低頻。低頻時開迴路增益很大（<Tex>{r`\lvert L\rvert\gg1`}</Tex>），所以 <Tex>{r`H_{PD}=1/(1+L)\approx1/L`}</Tex>：迴路裡有幾個積分器，<Tex>{'1/L'}</Tex> 就是幾次差分（積分器 <Tex>{r`1/(1-z^{-1})`}</Tex> 的倒數是差分{' '}
        <Tex>{r`1-z^{-1}`}</Tex>）。
      </p>
      <Diagram id="lowfreq" />
      <p>
        先看 Type-II 那一列：兩個積分器的倒數是兩次差分，慢誤差 <Tex>{'u'}</Tex> 被做了「二次差分」再除以積分增益 <Tex>{'K_i'}</Tex>；一個訊號和自己的二次差分方向相反（弦波微分兩次會多一個負號），所以紅色那兩格讓 PD 看到的殘差與誤差反向。再看 Type-I 那一列：只有一次差分，弦波微分一次是轉
        90°，與原訊號的相關是 0，符號要由更小的二階項決定（<Tex>{'K'}</Tex> 是 Type-I 的迴路增益）。圖上的兩個差分方塊相乘就是下面 Type-II 推導第 2 步分子的 <Tex>{r`(1-z^{-1})^2`}</Tex>，「<Tex>{r`\div(K_i z^{-1})`}</Tex>」是分母。分母裡的 <Tex>{r`z^{-1}`}</Tex> 來自迴路的 1
        拍延遲；除以 <Tex>{r`z^{-1}`}</Tex> 等於把訊號提前一拍，剛好把兩次差分對到中心，也就是第 2 步最後的 <Tex>{r`(z^{1/2}-z^{-1/2})^2`}</Tex>（中心二次差分 <Tex>{'u[n+1]-2u[n]+u[n-1]'}</Tex>）。它不改變「兩次差分 → 反向」的結論。這張圖是低頻近似 <Tex>{r`H_{PD}\approx1/L`}</Tex>{' '}
        的訊號流，不是實際的電路（實際電路不能提前）。
      </p>
      <p>
        <strong>
          先算一次（{F_EX_MHZ} MHz，<Tex>{`\\Omega=2\\pi\\cdot${F_EX_MHZ}/${FREF_MHZ}=${tx(W, 6)}`}</Tex>）
        </strong>
        ：
      </p>
      <DataTable
        className="cs-num"
        head={['量', '數值', '怎麼來的']}
        rows={[
          [<>一次差分的相關 <Tex>{r`\langle x[n](x[n]-x[n-1])\rangle`}</Tex></>, <Tex key="a">{`+${txs(corr1, 4)}`}</Tex>, <>弦波 <Tex>{r`x=\cos\Omega n`}</Tex>：<Tex>{r`\tfrac{1-\cos\Omega}{2}`}</Tex></>],
          [<>中心二次差分的相關 <Tex>{r`\langle x[n](x[n+1]-2x[n]+x[n-1])\rangle`}</Tex></>, <Tex key="b">{txs(corr2, 4)}</Tex>, <Tex key="b2">{r`\cos\Omega-1<0`}</Tex>],
          [<>L2：<Tex>{r`\mathrm{Re}\,H_{PD}`}</Tex></>, <Tex key="c">{tx(reL2, 5)}</Tex>, <>漸近式 <Tex>{`-\\Omega^2/K_i=${tx(asym2, 5)}`}</Tex></>],
          [<>L1：<Tex>{r`\mathrm{Re}\,H_{PD}`}</Tex></>, <Tex key="d">{`+${tx(reL1, 6)}`}</Tex>, <>漸近式 <Tex>{`(2-K)\\Omega^2/(2K^2)=+${tx(asym1, 6)}`}</Tex></>],
        ]}
      />
      <Src>
        即時計算（<code>loopH</code>）；與 golden 的 <code>worked_examples.json</code> 在測試中比對。
      </Src>

      <h4>Type-II（L2）的低頻推導</h4>
      <StepDerivation
        steps={[
          {
            tex: r`L=\frac{K_p z^{-1}}{1-z^{-1}}+\frac{K_i z^{-1}}{(1-z^{-1})^2}\;\approx\;\frac{K_i z^{-1}}{(1-z^{-1})^2}`,
            why: <><Tex>{r`\Omega\to0`}</Tex> 時雙積分項 <Tex>{r`\propto\Omega^{-2}`}</Tex>，比比例項 <Tex>{r`\propto\Omega^{-1}`}</Tex> 大。</>,
          },
          {
            tex: r`H_{PD}=\frac{1}{1+L}\approx\frac1L=\frac{(1-z^{-1})^2}{K_i z^{-1}}=\frac{(z^{1/2}-z^{-1/2})^2}{K_i}`,
            why: <><Tex>{r`\lvert L\rvert\gg1`}</Tex>，所以 <Tex>{r`1+L\approx L`}</Tex>；分子分母同乘 <Tex>{'z'}</Tex>。</>,
          },
          { tex: r`=\frac{(2j\sin\frac\Omega2)^2}{K_i}=-\frac{4\sin^2(\Omega/2)}{K_i}`, why: <>代入 <Tex>{r`z=e^{j\Omega}`}</Tex>：<Tex>{r`e^{j\Omega/2}-e^{-j\Omega/2}=2j\sin(\Omega/2)`}</Tex>。</> },
          { tex: r`\approx-\frac{\Omega^2}{K_i}\;<0`, why: <><Tex>{r`\sin x\approx x`}</Tex>（泰勒一階）。</> },
        ]}
      />
      <Formula id="F-CS.5" />
      <p>
        所以低頻時 PD 看到的是誤差的<strong>中心二次差分</strong>除以 <Tex>{'K_i'}</Tex>，也就是連續時間的 <Tex>{r`\frac{1}{K_i}\frac{d^2u}{dt^2}`}</Tex>。微積分告訴我們，對週期函數做分部積分：
      </p>
      <TexBlock>{r`\int_0^P x\,x''\,dt=\big[x\,x'\big]_0^P-\int_0^P (x')^2dt=-\int_0^P(x')^2dt<0`}</TexBlock>
      <p>
        （週期函數的邊界項 <Tex>{r`[x\,x']_0^P`}</Tex> 為 0。）<strong>任何訊號與自己的二次微分的相關都是負的</strong>。所以只要 regressor 的功率落在 <Tex>{r`\lvert L\rvert\gg1`}</Tex> 的低頻，Type-II 迴路就一定會讓 LMS 反號。無論 PM、latency
        是多少，這件事都避不掉。
        <Claim kind="exact">
          golden：<Tex>{r`\mathrm{Re}H(10^{-4}f_{ref})`}</Tex> 與 <Tex>{r`-\Omega^2/K_i`}</Tex> 的比值為 {fx(Number(cf.L2_lowf_ratio), 5)}；L3 為 <Tex>{r`-\Omega^2/K_d`}</Tex>，<Tex>{`K_d=(\\omega_cT)^2/\\sqrt b=${fx(Kd, 7)}`}</Tex>，比值{' '}
          {fx(Number(cf.L3_lowf_ratio), 5)}
        </Claim>
      </p>
      <Hand id="HC-CS.2">{r`上面的表是 $f=20$ MHz。換成你關心的頻率與你的 $K_i$，先手算 $-\Omega^2/K_i$，再看它和精確值差多少。`}</Hand>

      <h4>
        Type-I（L1，延遲 <Tex>{'d'}</Tex> 拍）的低頻推導
      </h4>
      <StepDerivation
        steps={[
          {
            tex: r`\frac1L=\frac{(1-z^{-1})z^{d}}{K}=\frac{e^{j\Omega(d-1)}(e^{j\Omega}-1)}{K}\approx\frac{j\Omega-\Omega^2(d-\frac12)}{K}`,
            why: <>泰勒展開到 <Tex>{r`\Omega^2`}</Tex>：<Tex>{r`e^{j\Omega(d-1)}(e^{j\Omega}-1)\approx(1+j\Omega(d-1))(j\Omega-\Omega^2/2)`}</Tex>。</>,
          },
          { tex: r`\begin{aligned}H_{PD}&=\frac{1}{1+L}=\frac{1/L}{1+1/L}\\[2pt]&\approx\frac1L-\frac1{L^2}\end{aligned}`, why: <><Tex>{r`\lvert1/L\rvert\ll1`}</Tex>，用 <Tex>{r`1/(1+x)\approx1-x`}</Tex>。</> },
          {
            tex: r`\mathrm{Re}\,H_{PD}\approx-\frac{\Omega^2(d-\frac12)}{K}+\frac{\Omega^2}{K^2}=\frac{\Omega^2}{K^2}\big[1-K(d-\tfrac12)\big]`,
            why: <><Tex>{r`1/L^2\approx(j\Omega)^2/K^2=-\Omega^2/K^2`}</Tex>；<Tex>{'1/L'}</Tex> 的 <Tex>{r`j\Omega/K`}</Tex> 是純虛數，不貢獻實部。</>,
          },
        ]}
      />
      <Formula id="F-CS.6" />
      <p>
        所以 Type-I 的 PD 在低頻看到的主要是<strong>一次微分</strong>（純虛數，<Tex>{r`\langle x\,x'\rangle=0`}</Tex>，不決定符號）。符號由兩個二階修正決定：迴路增益項 <Tex>{r`+\Omega^2/K^2`}</Tex> 對上延遲項{' '}
        <Tex>{r`-\Omega^2(d-\frac12)/K`}</Tex>。<Tex>{'d=1'}</Tex>、<Tex>{`K=${fx(K, 3)}`}</Tex> 時 <Tex>{`K(d-\\tfrac12)=${fx(K * 0.5, 3)}<1`}</Tex>，所以 L1 在低頻是正的。
        <Claim kind="exact" />
      </p>
      <p className="small muted">
        想代自己的 <Tex>{'K'}</Tex> 與 <Tex>{'d'}</Tex> 算一次？§6.1 的手算題 <HandLink id="HC-CS.3" /> 把判據、這個低頻近似與精確值放在同一題。
      </p>
    </Section>
  )
}
