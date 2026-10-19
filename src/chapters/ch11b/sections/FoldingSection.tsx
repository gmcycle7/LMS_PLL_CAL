import { useMemo } from 'react'
import { Callout, ClaimTag, CodeBlock, ModeGate, Prereq, Section, StepDerivation, Tex, TexBlock, ChRef, FormulaLink } from '@/components'
import dtcInlSrc from '@/simulation/models/dtcInl.ts?raw'
import { MASH_CODE_AUTOCORR, MASH_CODE_FIR, UNIFORM_KAPPA4, foldedPsdDc, foldedPsdDcLinearProcess, foldingPrediction, inbandPower, linearProcessSquaredVariance } from '@/simulation/models/dtcInl'
import { FoldingLab } from '../experiments/FoldingLab'
import { ModeDetails, m, num, texNum } from '../common'
import { F } from '../formulas'
import { Fig, FigRef } from '../Fig'
import { Hand } from '../Hand'

const PATH = 'src/simulation/models/dtcInl.ts'

/** §11b.2 噪聲折返：Isserlis、MASH 的自相關、精確式、帶內功率、實驗 A。 */
export function FoldingSection() {
  const n = useMemo(() => {
    const R = MASH_CODE_AUTOCORR
    const sumR2 = R[0] ** 2 + 2 * R[1] ** 2 + 2 * R[2] ** 2
    const s2g = foldedPsdDc(R, 2)
    const s3g = foldedPsdDc(R, 3)
    const h2 = MASH_CODE_FIR.reduce((s, h) => s + h * h, 0)
    const s2 = foldedPsdDcLinearProcess(R, MASH_CODE_FIR, UNIFORM_KAPPA4)
    const pred = foldingPrediction(R, { d2: 20, d3: 0 }, 0.01)
    const pinExact = inbandPower(400 * s2, 0.01)
    const total = 400 * linearProcessSquaredVariance(R[0], MASH_CODE_FIR, UNIFORM_KAPPA4)
    return { R, sumR2, s2g, s3g, h2, corr: UNIFORM_KAPPA4 * h2 * h2, s2, pred, pinExact, rmsExact: Math.sqrt(pinExact), total, frac: pinExact / total }
  }, [])

  return (
    <Section kind="formula" title="11b.2 噪聲折返：為什麼 INL 非校不可" level={2} id="ch11b-folding">
      <p>
        MASH 1-1-1 把量化雜訊整形到高頻（<ChRef ch="04">Ch04</ChRef>：餘數的 PSD 以 40 dB/dec 往低頻下降，<ChRef ch="13">Ch13</ChRef> F-13.9 的 <Tex>{'|1-e^{-j\\Omega}|^2=4\\sin^2(\\Omega/2)'}</Tex>），PLL 的 <Tex>{'T(f)'}</Tex> 再把高頻濾掉——這是 fractional-N 能用的前提。線性的 gain 誤差 <Tex>{'(a-w)x'}</Tex> 只是把這個整形過的頻譜乘上常數，帶內還是幾乎沒有東西。但 <Tex>{'d_2x^2'}</Tex> 不一樣：<Tex>{'x'}</Tex> 乘 <Tex>{'x'}</Tex> 是<strong>混頻</strong>（<ChRef ch="12">Ch12</ChRef> F-12.12 的積化和差）——兩個高頻分量相乘，差頻落在 DC 附近。整形的雜訊被「折」回帶內。
      </p>
      <Prereq title="自相關、PSD 與 Isserlis 定理（只需要期望值與積分）">
        <p>
          零均值平穩序列 <Tex>{'x[n]'}</Tex> 的<strong>自相關</strong> <Tex>{'R_x[m]=E[x[n]\\,x[n+m]]'}</Tex>（<Tex>{'R_x[0]=\\sigma_x^2'}</Tex>，對稱 <Tex>{'R_x[-m]=R_x[m]'}</Tex>）；它的 <strong>PSD</strong> 是自相關的 Fourier 轉換{' '}
          <Tex>{String.raw`S_x(\nu)=\sum_mR_x[m]e^{-j2\pi\nu m}`}</Tex>（Wiener–Khinchin），<Tex>{'\\nu=f/f_s\\in[-\\tfrac12,\\tfrac12]'}</Tex>，<Tex>{String.raw`\int S_x\,d\nu=\sigma_x^2`}</Tex>。在 DC 的值特別簡單：<Tex>{String.raw`S_x(0)=\sum_mR_x[m]`}</Tex>。
        </p>
        <p>
          <strong>Isserlis（Wick）定理</strong>：零均值聯合 Gaussian 的四個變數，<Tex>{'E[x_1x_2x_3x_4]=E[x_1x_2]E[x_3x_4]+E[x_1x_3]E[x_2x_4]+E[x_1x_4]E[x_2x_3]'}</Tex>——高階動差全部拆成兩兩配對。它是下面所有「平方的自相關」的來源。非 Gaussian 時多出來的那一項叫<strong>四階累積量</strong> <Tex>{'\\kappa_4=E[u^4]-3\\sigma_u^4'}</Tex>（Gaussian 為 0；uniform 為負）。
        </p>
      </Prereq>
      <p>
        <FigRef id="folding-path" /> 是整條路徑。先看左邊：白色的 <Tex>{'u=s_3/M'}</Tex> 經 <Tex>{'(1-z^{-1})^2'}</Tex> 整形成 <Tex>{'x'}</Tex>。再看分岔：線性項（綠色）守住整形，被 <Tex>{'T'}</Tex> 濾掉；二次項（紅色）的 PSD 變成 <Tex>{'S_x'}</Tex> 和自己的卷積，在 DC 不再是 0；藍色的帶內部分經主迴路直接變成輸出 jitter。
      </p>
      <Fig id="folding-path" />
      <StepDerivation
        title={m('平方之後的自相關：Gaussian–Isserlis')}
        steps={[
          { tex: String.raw`y[n]=x[n]^2-\sigma_x^2\qquad(\text{DC }\sigma_x^2\text{ 被主迴路吸收})`, why: m('二次 INL 去掉平均之後的部分（F-11B.2 的 $\\mathrm{He}_2$）。') },
          { tex: String.raw`R_y[m]=E\big[x_n^2x_{n+m}^2\big]-\sigma_x^4=\big(\sigma_x^4+2R_x[m]^2\big)-\sigma_x^4=2R_x[m]^2`, why: m('Isserlis：$E[x_nx_nx_{n+m}x_{n+m}]$ 的三種配對 $=R[0]^2+R[m]^2+R[m]^2$。') },
          { tex: String.raw`S_y(0)=\sum_mR_y[m]=2\sum_{m=-\infty}^{\infty}R_x[m]^2=2\int_{-1/2}^{1/2}S_x(\nu)^2\,d\nu`, why: m('DC 的 PSD 是自相關的總和；Parseval 把它寫成 $S_x$ 平方的積分——$S_x$ 在 DC 是 0 沒有用，只要 $S_x$ 在任何地方不是 0，$S_y(0)$ 就不是 0。這就是折返。') },
          { tex: String.raw`\text{同理 }\mathrm{He}_3=x^3-3\sigma_x^2x:\quad R[m]=6R_x[m]^3\ \Rightarrow\ S(0)=6\sum_mR_x[m]^3`, why: m('Mehler 公式：第 $p$ 階 Hermite 分量的自相關是 $p!\\,R_x[m]^p$（$x^3$ 的線性部分 $3\\sigma^2x$ 已被 gain 吸收，不在這裡）。') },
        ]}
      />
      <TexBlock id="F-11B.3" label={m('Hermite 分量的折返（Gaussian）')}>
        {F.isserlis}
      </TexBlock>
      <p className="ch11b-tags">
        <ClaimTag kind="approx" /> {m('需要 $x$ 零均值 Gaussian；bounded 的 DSM code 不是，修正在 F-11B.5。')}
      </p>
      <p>
        接著要 MASH code 的自相關。<ChRef ch="04">Ch04</ChRef> 的 dsm.ts 告訴我們餘數是 <Tex>{'r=-(1-z^{-1})^2\\,s_3/M'}</Tex>；把第三級累加器 <Tex>{'s_3/M'}</Tex> 當成 iid uniform（變異數 <Tex>{'1/12'}</Tex>），FIR 係數 <Tex>{'[1,-2,1]'}</Tex> 的自相關是 <Tex>{'[6,-4,1]'}</Tex>：
      </p>
      <StepDerivation
        steps={[
          { tex: String.raw`R_r[m]=\frac1{12}\sum_kh_kh_{k+m},\quad h=[1,-2,1]:\quad R_r=\tfrac1{12}[\,6,\,-4,\,1\,],\qquad\sigma_r^2=\tfrac12`, why: m('FIR 輸出的自相關 = 係數的自相關 × 輸入的變異數（白色輸入）；$1+4+1=6$、$-2-2=-4$、$1$。') },
          { tex: String.raw`x=\tfrac r2:\quad R_x=\tfrac1{48}[\,6,\,-4,\,1\,]=[\,${texNum(n.R[0], 6)},\ ${texNum(n.R[1], 6)},\ ${texNum(n.R[2], 6)}\,],\qquad\sigma_x^2=\tfrac18`, why: m('正規化到 $[-1,1]$：除以半寬 2，自相關除以 4。') },
          { tex: String.raw`\sum_mR_x[m]^2=R_0^2+2R_1^2+2R_2^2=${texNum(n.sumR2, 6)}=\tfrac{70}{2304},\qquad S_2^\mathrm{Gauss}(0)=2\sum R_x^2=${texNum(n.s2g, 6)}=\tfrac{35}{576}`, why: m('代進 F-11B.3（$p=2$）；用分數算 $6^2+2\\cdot4^2+2\\cdot1^2=70$。') },
          { tex: String.raw`S_3^\mathrm{Gauss}(0)=6\sum R_x^3=6\big(\tfrac{216-128+2}{48^3}\big)=${texNum(n.s3g, 6)}=\tfrac5{1024}`, why: m('三次項（$p=3$）：負的 $R_1$ 立方是負的，所以折返比二次項弱得多。') },
        ]}
      />
      <TexBlock id="F-11B.4" label={m('MASH 1-1-1 的 code 自相關與 Gaussian 折返位準')}>
        {F.mashAutocorr}
      </TexBlock>
      <p className="ch11b-tags">
        <ClaimTag kind="approx" /> {m('$s_3/M$ 是否白色取決於 FCW：frac $=0.618$ 這類「遠離有理數」的值很接近；frac $=0.3$ 的 code 落在 $1/10$ 的格點上（實驗 A 會警告）。')}
      </p>
      <p>
        但 uniform 不是 Gaussian。幸好 <Tex>{'x'}</Tex> 是「iid 輸入經 FIR」的線性過程，四階累積量的傳播有封閉式：<Tex>{'\\operatorname{cum}(x_n,x_n,x_{n+m},x_{n+m})=\\kappa_4\\sum_kh_k^2h_{k+m}^2'}</Tex>。加總所有 <Tex>{'m'}</Tex>：
      </p>
      <StepDerivation
        steps={[
          { tex: String.raw`\operatorname{Cov}(x_n^2,x_{n+m}^2)=2R_x[m]^2+\kappa_4\sum_kh_k^2h_{k+m}^2`, why: m('Gaussian 項（Isserlis）加上輸入的四階累積量沿著 FIR 傳下來的項；$u$ 是 Gaussian 時 $\\kappa_4=0$ 就回到 F-11B.3。') },
          { tex: String.raw`\sum_m\sum_kh_k^2h_{k+m}^2=\Big(\sum_kh_k^2\Big)^2=\big(\tfrac14+1+\tfrac14\big)^2=\tfrac94`, why: m('兩個指標各自跑遍所有值（卷積在 DC 的值 = 兩個和的乘積）；$x=r/2$ 的 FIR 是 $[-\\tfrac12,1,-\\tfrac12]$。') },
          { tex: String.raw`\kappa_4=E[(u-\tfrac12)^4]-3\sigma_u^4=\tfrac1{80}-\tfrac3{144}=-\tfrac1{120}`, why: m('uniform(0,1) 的中心四階動差 $1/80$、變異數 $1/12$：負的累積量（sub-Gaussian，沒有長尾）。') },
          { tex: String.raw`S_2(0)=\tfrac{35}{576}+\Big(-\tfrac1{120}\Big)\tfrac94=${texNum(n.s2g, 6)}${n.corr < 0 ? '-' : '+'}${texNum(Math.abs(n.corr), 6)}=${texNum(n.s2, 6)}=\tfrac{121}{2880}`, why: m('精確式比 Gaussian 少 31%：bounded 的 code 沒有 Gaussian 的大偏移，平方之後的起伏也小。') },
        ]}
      />
      <TexBlock id="F-11B.5" label={m('線性過程的精確折返位準')}>
        {F.exactLinear}
      </TexBlock>
      <p className="ch11b-tags">
        <ClaimTag kind="exact" /> {m('在「$u$ iid uniform、FIR $h$」的指定模型中精確；實驗 A 的 Welch 量測與它相差在 ±8% 內（Welch 的統計誤差）。')}
      </p>
      <p>
        最後一步是「帶內有多少」。折返後的 PSD 在 DC 附近是平的（它是 <Tex>{'S_x'}</Tex> 的自卷積，曲率來自 <Tex>{'\\nu^4'}</Tex> 的整形，在 <Tex>{'\\nu\\ll1'}</Tex> 可忽略），所以帶內功率就是位準乘上寬度 <Tex>{'2\\nu_B'}</Tex>；換成 one-sided per-Hz 要除以 <Tex>{'f_s/2'}</Tex>（<ChRef ch="12">Ch12</ChRef> F-12.10、勘誤 E28）：
      </p>
      <TexBlock id="F-11B.6" label={m('帶內折返功率')}>
        {F.inband}
      </TexBlock>
      <p className="ch11b-tags">
        <ClaimTag kind="approx" /> {m(`$\\nu_B\\ll1$。例：$d_2=20$ t.u.、$\\nu_B=0.01$：Gaussian 式 $P_\\mathrm{in}=${texNum(n.pred.Pin, 5)}$、精確式 $${texNum(n.pinExact, 5)}$ t.u.$^2$（rms $${texNum(n.rmsExact, 4)}$ t.u.），占殘餘 INL 總功率 $${texNum(n.total, 4)}$ 的 $${texNum(100 * n.frac, 3)}\\%$。`)}
      </p>
      <Callout kind="warn" title="這一塊雜訊和 Ch12 的 coefficient noise 不同">
        <p>
          <ChRef ch="12">Ch12</ChRef> 的 <Tex>{'\\delta t=x\\,\\delta w'}</Tex> 是「係數抖動 × code」，頻譜是 <Tex>{'S_{\\delta w}'}</Tex> 與 <Tex>{'S_x'}</Tex> 的卷積（F-12.13），而 <Tex>{'\\delta w'}</Tex> 本身是低頻的。這裡的折返是「code × code」：<strong>沒有任何係數在動</strong>，INL 完全確定，雜訊還是會出現在帶內——因為 code 自己的高頻雜訊透過非線性自我混頻。只要 <Tex>{'d(x)'}</Tex> 不是直線，這一項就在；gain 校正做得再好也拿不掉它。這就是 INL 校正存在的理由。
        </p>
      </Callout>
      <Hand id="HC-11B.1">{m('把 $d_2$、$f_B$、$f_s$ 換成你的數字，從 MASH 的自相關一路算到帶內 rms。')}</Hand>
      <ModeDetails title={m('Research：三次項、鋸齒與 first-order 的差別；為什麼 Gaussian 式對 MASH 高估 45%')} openFrom="research">
        <ul>
          <li>{m('三次 INL：$\\mathrm{He}_3$ 的 Gaussian 折返位準 $6\\sum R^3=5/1024$ 比二次的 $35/576$ 小一個量級（負的 $R_1$ 立方相消），而且 $d_3$ 有 $\\tfrac35$（uniform）或 $3\\sigma^2$（Gaussian）的部分被 gain 吸收——所以三次 INL 的主要危害是 Ch11 的 bias，不是折返。三次項的 $\\kappa_4$／$\\kappa_6$ 修正沒有寫出封閉式，實驗 A 顯示「量測／Gaussian」的比值（約 0.5）。')}</li>
          <li>{m('鋸齒狀 segment error：$A_s\\,\\mathrm{saw}(x)$ 在 $x$ 裡有所有階的 Fourier 分量，沒有封閉式；它的自相關拖得很長（code 在格點附近慢慢漂移），lag 有限的自相關加總不可靠，只看 Welch。')}</li>
          <li>{m('first-order DSM：餘數是週期性鋸齒，不是雜訊，$d(x)$ 的「折返」是譜線（Ch13 F-13.4 的 Parseval），Gaussian–Isserlis 完全不適用。')}</li>
          <li>{m('Gaussian 式高估的原因：MASH code 的峰度約 2.4（三個 uniform 疊加還沒到 Gaussian 的 3），平方的起伏比 Gaussian 小；$\\kappa_4<0$ 的修正正好補上。uniform iid 的 code 更極端（峰度 1.8）：$\\operatorname{Var}(x^2)=4/45$ 對上 Gaussian 的 $2/9$，高估 2.5 倍。')}</li>
        </ul>
        <CodeBlock source={dtcInlSrc} region="foldedPsdDc" path={PATH} title="Gaussian–Isserlis 的折返位準（網站實際執行的程式）" caption={String.raw`$p!\sum_mR[m]^p$：lag $\pm m$ 各算一次。`} />
        <CodeBlock source={dtcInlSrc} region="foldedPsdDcExact" path={PATH} title="線性過程的精確式" caption={String.raw`Gaussian 項加 $\kappa_4(\sum h^2)^2$；MASH 的 $h=[-\tfrac12,1,-\tfrac12]$、$\kappa_4=-1/120$。`} />
      </ModeDetails>
      <ModeGate min="engineer">
        <p className="small muted">
          Engineer 提醒：<FormulaLink id="F-11B.6">F-11B.6</FormulaLink> 的 <Tex>{'P_\\mathrm{in}'}</Tex> 是 PD 輸入端的 timing error 功率；到輸出要再乘 <Tex>{'|T(f)|^2'}</Tex>（帶內 <Tex>{'\\approx1'}</Tex>），所以輸出 jitter 的貢獻就是 <Tex>{'\\sqrt{P_\\mathrm{in}}'}</Tex>（<ChRef ch="12">Ch12</ChRef> F-12.17）。例子的 {num(n.rmsExact, 3)} t.u. 若 t.u. = fs，就是 {num(n.rmsExact, 3)} fs 的 in-band jitter——與{' '}
          <ChRef ch="12">Ch12</ChRef> T13 的 coefficient-noise jitter 0.399 fs 同一個量級。
        </p>
      </ModeGate>
      <FoldingLab />
      <Callout kind="ok" title="試試看">
        <ol>
          <li>{m('預設（MASH、$d_2=20$、frac 0.618）：帶內折返 rms 約 0.58 t.u.，與精確式一致（✓）；Gaussian 預測 0.70。把 $d_2$ 加倍，帶內功率變 4 倍。')}</li>
          <li>{m('把 code 改成 uniform：$x$ 的 PSD 變平、$d(x)$ 的 PSD 也平——沒有「折返」可言，帶內就是總功率的 $2\\nu_B$；Gaussian 式高估 2.5 倍。')}</li>
          <li>{m('把 $d_2$ 歸零、$d_3=20$：gain 吸收約 $6$（uniform 的 $\\tfrac35d_3$ 對 MASH 是 $d_3E[x^4]/E[x^2]\\approx0.3d_3$），帶內折返小一個量級。')}</li>
          <li>{m('frac 改成 0.3：警告「code 落在格點上」，$x$ 的 PSD 出現譜線，Welch 的帶內功率偏離精確式。')}</li>
          <li>{m('鋸齒 $A_s=5$、$K_s=8$：沒有封閉式，看 PSD——鋸齒的折返集中在哪些頻率？')}</li>
        </ol>
      </Callout>
    </Section>
  )
}
