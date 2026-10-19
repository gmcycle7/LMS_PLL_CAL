import { useMemo } from 'react'
import { Callout, ClaimTag, CodeBlock, Section, SourceTag, StepDerivation, Tex, TexBlock, ChRef } from '@/components'
import dtcSrc from '@/simulation/models/dtc.ts?raw'
import { dtcBitsFor, dtcCompensation, dtcEffectiveSigmaV, dtcKqRatio, dtcLsbFs, dtcQuantizationJitterRms, dtcRangeBudget } from '@/simulation/models/dtc'
import { DtcRangeExperiment } from '../experiments/DtcRangeExperiment'
import { ANTI_WINDUP, DTC_RANGE } from '../diagrams'
import { DerivationFold, f, FigRef, HandCalcBox, MermaidFig, mt, tx } from '../common'

const R = String.raw
const DTC_PATH = 'src/simulation/models/dtc.ts'

/** §5b 的例子（與 HC-04.9／HC-04.10、DtcRangeExperiment 的預設相同）：16 GHz 的 T_vco、ε = 20%、INL 500 fs、headroom 5%、σ_v = 100 fs */
export function dtcRangeNumbers(bits = 10) {
  const tFs = 62500
  const b = dtcRangeBudget({ tVcoFs: tFs, calRangeFrac: 0.2, inlPeakFs: 500, headroomFrac: 0.05, bits })
  const lsb = dtcLsbFs(b.rangeFs, bits)
  const sigmaV = 100
  const sat = dtcCompensation({ w: 90000, x: 0.95, t0Fs: b.t0Fs, lsbFs: lsb, bits })
  return { tFs, bits, b, lsb, sigmaQ: dtcQuantizationJitterRms(lsb), sigmaV, sigmaEff: dtcEffectiveSigmaV(sigmaV, lsb), ratio: dtcKqRatio(sigmaV, lsb), bitsFor: dtcBitsFor(b.rangeFs, sigmaV), sat }
}

export function DtcRangeSection() {
  const n = useMemo(() => dtcRangeNumbers(10), [])
  const rows = useMemo(() => [8, 9, 10, 11, 12].map((bits) => dtcRangeNumbers(bits)), [])
  return (
    <Section kind="formula" title={mt(R`§5b DTC 的範圍、LSB、量化抖動與 $T_0$ 預算`)} level={2} id="ch04-dtc-range">
      <p>
        §5 看的是 GMAC 與 gain accumulator 的位元；真正把補償量做成時間的是 DTC，它也只有 <Tex>{R`B_\mathrm{dtc}`}</Tex> 個 bit：延遲範圍 <Tex>R</Tex>、1 LSB 的時間 <Tex>{R`\Delta`}</Tex>、取整造成的量化抖動、code 夾住的飽和，以及「<Tex>{R`T_0`}</Tex>{' '}
        要放在哪裡」。這些數字全站之前只有 Ch11 的 INL 和 Ch13 的 gain register 提過一半；這一節把它們放在一起，和 §5 的定點 GMAC 一樣逐一推導。
      </p>
      <MermaidFig
        chart={DTC_RANGE}
        caption={R`DTC 的一拍：$T_0$ 預算決定範圍與基準（最上面），想要的延遲 $T_0-w\,x$ 取整到 $\Delta$ 的格點（藍色：均勻的量化誤差 $e_q$），在範圍內就送出（綠色），超出就夾住（紅色：$\partial e/\partial w=0$，sign-LMS 沒有梯度可跟）。看最下面：$e_q$ 和 comparator 雜訊一起進入 $e[n]$。`}
        ariaLabel="DTC 的範圍預算、補償量取整到 LSB 格點、code 飽和時梯度為零，以及量化抖動進入 PD 誤差"
      />
      <p>
        <strong>先看</strong>最上面的預算：<Tex>{R`x\in[0,1)`}</Tex> 所以補償量最多一個 <Tex>{R`T_\mathrm{vco}`}</Tex>（<Tex>{R`a=T_\mathrm{vco}`}</Tex>），校正要能到 <Tex>{R`a(1\pm\varepsilon)`}</Tex>，再加 INL 的最壞偏離與兩端的 headroom，就是 DTC 要做得出來的範圍 <Tex>R</Tex>；<Tex>{R`T_0`}</Tex>{' '}
        放在「最大補償量」的上面，往回扣到底時還剩 headroom。<strong>再看</strong>藍色方塊：<Tex>{R`T_0-w\,x`}</Tex> 不會剛好是 <Tex>{R`\Delta`}</Tex> 的整數倍，取整丟掉的 <Tex>{R`e_q`}</Tex> 在 <Tex>{R`\pm\Delta/2`}</Tex> 內均勻——這和 §5.3 的右移餘數是同一回事，只是這次單位是 fs。
        <strong>最後看</strong>紅色方塊：code 夾在 0 或 <Tex>{R`2^{B_\mathrm{dtc}}-1`}</Tex> 時 PD 看到的誤差不再隨 <Tex>w</Tex> 變，GMAC 的 <Tex>{R`q\,x`}</Tex> 卻照樣累加——和 <FigRef chart={ANTI_WINDUP} /> 的 windup 是同一件事。
      </p>

      <h3>1. LSB 與量化抖動：它們怎麼進入 comparator？</h3>
      <DerivationFold title={mt(R`$\Delta$、$\sigma_q=\Delta/\sqrt{12}$ 與 $K_q$ 的折損`)}>
        <StepDerivation
          steps={[
            { tex: R`\Delta=\frac{R}{2^{B_\mathrm{dtc}}-1}`, why: mt(R`$2^{B_\mathrm{dtc}}$ 個 code 之間有 $2^{B_\mathrm{dtc}}-1$ 個間隔，範圍 $R$ 平分。`) },
            { tex: R`\tau_q=\Delta\cdot\mathrm{round}\Big(\frac{T_0-w\,x}{\Delta}\Big)=T_0-w\,x+e_q,\qquad e_q\in\Big(-\frac\Delta2,\frac\Delta2\Big]`, why: mt(R`nearest 取整：實際延遲和想要的延遲差不超過半個 LSB（truncate 則是 $(-\Delta,0]$，平均多一個 $-\Delta/2$ 的 offset，被主 PLL 當成靜態相位吸收）。`) },
            { tex: R`E[e_q^2]=\frac1\Delta\int_{-\Delta/2}^{\Delta/2}e^2\,de=\frac1\Delta\cdot\frac{2}{3}\Big(\frac\Delta2\Big)^3=\frac{\Delta^2}{12}\;\Rightarrow\;\sigma_q=\frac{\Delta}{\sqrt{12}}`, why: mt(R`code 夠「亂」（DSM 餘數）時 $e_q$ 在一個 LSB 內均勻分布；積分 $e^2$ 得 $e^3/3$。`) },
            { tex: R`e[n]=t_\mathrm{ref}'-t_\mathrm{fb}=(a-w)\,x[n]+e_q[n]+v[n]`, why: mt(R`$e_q$ 跟著 DTC 的延遲一起進入 reference edge，所以和 §2 的殘差、§3 的雜訊 $v$ 加在同一個節點（F-04.2）。`) },
            { tex: R`\sigma_{v,\mathrm{eff}}^2=\sigma_v^2+\frac{\Delta^2}{12},\qquad K_{q,\mathrm{eff}}=\frac{\sqrt{2/\pi}}{\sigma_{v,\mathrm{eff}}}=K_q\cdot\frac{\sigma_v}{\sigma_{v,\mathrm{eff}}}`, why: mt(R`$e_q$ 與 $v$ 獨立、變異數相加；comparator 的小訊號增益（§3、Ch05）只看 $e[n]$ 總共有多少雜訊，所以等比例變小。`) },
          ]}
          result={R`\frac{K_{q,\mathrm{eff}}}{K_q}=\frac{1}{\sqrt{1+\Delta^2/(12\sigma_v^2)}}\;\;\Rightarrow\;\;\Delta\le\sigma_v\ \text{時折損}<4\%`}
        />
        <p className="small">
          <ClaimTag kind="exact" /> 均勻的 <Tex>{R`e_q`}</Tex>、與 <Tex>v</Tex> 獨立。<ClaimTag kind="approx" /> 「均勻」要 code 夠亂：FCW 是整數或 near-grid（<Tex>{R`\beta`}</Tex> 很小）時 <Tex>{R`e_q`}</Tex> 是確定性的圖案，變成 tone 而不是白雜訊（<ChRef ch="13">Ch13</ChRef> 的 limit cycle、<ChRef ch="11b">Ch11b</ChRef> 的折返）。
        </p>
      </DerivationFold>
      <TexBlock id="F-04.19" label={mt(R`DTC 的 LSB、量化抖動與它對 $K_q$ 的影響`)}>
        {R`\Delta=\frac{R}{2^{B_\mathrm{dtc}}-1},\qquad\sigma_q=\frac{\Delta}{\sqrt{12}},\qquad\boxed{\sigma_{v,\mathrm{eff}}^2=\sigma_v^2+\frac{\Delta^2}{12}},\qquad\frac{K_{q,\mathrm{eff}}}{K_q}=\frac{\sigma_v}{\sigma_{v,\mathrm{eff}}}`}
      </TexBlock>
      <p>
        數字（16 GHz 的 VCO：<Tex>{R`T_\mathrm{vco}=${tx(n.tFs / 1000, 3)}\,\mathrm{ps}`}</Tex>、<Tex>{R`\varepsilon=20\%`}</Tex>、<Tex>{R`\mathrm{INL}_\mathrm{pk}=500\,\mathrm{fs}`}</Tex>、headroom 5%、<Tex>{R`\sigma_v=${n.sigmaV}\,\mathrm{fs}`}</Tex>）<SourceTag kind="illustrative" />：<Tex>{R`R=${tx(n.b.rangeFs, 5)}\,\mathrm{fs}`}</Tex>。位元數對 <Tex>{R`\Delta`}</Tex>、<Tex>{R`\sigma_q`}</Tex> 與折損：
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th><Tex>{R`B_\mathrm{dtc}`}</Tex></th>
              <th><Tex>{R`\Delta`}</Tex> [fs]</th>
              <th><Tex>{R`\sigma_q`}</Tex> [fs]</th>
              <th><Tex>{R`\sigma_{v,\mathrm{eff}}`}</Tex> [fs]</th>
              <th><Tex>{R`K_{q,\mathrm{eff}}/K_q`}</Tex></th>
              <th>夠用？</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.bits}>
                <td className="num">{r.bits}</td>
                <td className="num">{f(r.lsb, 4)}</td>
                <td className="num">{f(r.sigmaQ, 4)}</td>
                <td className="num">{f(r.sigmaEff, 4)}</td>
                <td className="num">{f(r.ratio, 4)}</td>
                <td>{r.ratio >= 0.96 ? '折損 < 4%' : r.ratio >= 0.9 ? '可用，但折損 > 4%' : '折損太大'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        要讓 <Tex>{R`\Delta\le\sigma_v`}</Tex> 需要 <Tex>{R`B_\mathrm{dtc}\ge\lceil\log_2(R/\sigma_v+1)\rceil=${n.bitsFor}`}</Tex> bits；再多的位元對 <Tex>{R`K_q`}</Tex> 幾乎沒有幫助（折損的變異數每 bit 除以 4），但對 Ch13 的 gain register 量化與 Ch11 的 INL 校正仍有用。
      </p>
      <HandCalcBox id="HC-04.9">
        把 <Tex>{R`T_\mathrm{vco}`}</Tex>、<Tex>{R`\varepsilon`}</Tex>、INL、headroom 換成你的規格，先算出範圍 <Tex>R</Tex>，再試幾個位元數，看 <Tex>{R`\sigma_q`}</Tex> 什麼時候降到 <Tex>{R`\sigma_v`}</Tex> 的三分之一以下。
      </HandCalcBox>

      <h3>
        2. <Tex>{R`T_0`}</Tex> 預算與飽和：補償量放不進去時會怎樣？
      </h3>
      <DerivationFold title={mt(R`$T_0$ 要放在哪裡；code 夾住時 $\partial e/\partial w=0$`)}>
        <StepDerivation
          steps={[
            { tex: R`0\le w\,x<a(1+\varepsilon)\cdot1=T_\mathrm{vco}(1+\varepsilon)`, why: mt(R`$x\in[0,1)$、校正要能到 $a(1+\varepsilon)$：補償量的最大值。`) },
            { tex: R`\tau=T_0-w\,x\in\big(T_0-T_\mathrm{vco}(1+\varepsilon),\;T_0\big]`, why: mt(R`reference 端的 DTC 從 $T_0$ 往回扣（全站約定）：補償量為 0 時停在 $T_0$，最大時降到 $T_0-T_\mathrm{vco}(1+\varepsilon)$。`) },
            { tex: R`T_0-T_\mathrm{vco}(1+\varepsilon)\ge h+\mathrm{INL}_\mathrm{pk},\qquad T_0+h\le R`, why: mt(R`下面要留 headroom 與 INL 的餘裕（INL 讓實際延遲偏離直線），上面也留 headroom；兩式合起來就是 F-04.20 的 $R$ 與 $T_0$。`) },
            { tex: R`\text{code}=\mathrm{clamp}\Big(\mathrm{round}\Big(\frac{T_0-w\,x}{\Delta}\Big),\,0,\,2^{B_\mathrm{dtc}}-1\Big)`, why: mt(R`超出範圍只能夾住（和 §5.1 的 saturate 一樣，至少方向不會反）。`) },
            { tex: R`\text{夾住時：}\ e=\underbrace{a\,x-(T_0-\tau_\mathrm{clamp})}_{\text{與 }w\text{ 無關}}+v\ \Rightarrow\ \frac{\partial e}{\partial w}=0`, why: mt(R`DTC 送出的延遲固定在 rail，$w$ 再怎麼變 PD 都看不到；可是 $q=\mathrm{sign}(e)\ne0$，sign-LMS 的 $\mu\,q\,x$ 照樣累加——方向資訊是假的。`) },
            { tex: R`\text{freeze：}\ w_{k+1}=w_k+\mu\,G_k\cdot\mathbb 1[\text{block 內沒有飽和}]`, why: mt(R`正確做法：飽和旗標為 1 時不更新（或只累加沒飽和的拍），和 §5.5 的 anti-windup 是同一個原則。`) },
          ]}
          result={R`R\ge T_\mathrm{vco}(1+\varepsilon)+\mathrm{INL}_\mathrm{pk}+2h,\qquad T_0=h+\mathrm{INL}_\mathrm{pk}+T_\mathrm{vco}(1+\varepsilon)`}
        />
        <p className="small">
          <ClaimTag kind="exact" /> 預算是最壞情況的不等式；「夾住時梯度為 0」是定義。<ClaimTag kind="approx" /> 飽和期間 sign-LMS 的行為（windup 多快、回來要多久）用 §5.5 的 <Tex>{R`T_\mathrm{unwind}`}</Tex> 估，大訊號下只是量級。
        </p>
      </DerivationFold>
      <TexBlock id="F-04.20" label={mt(R`$T_0$ 預算與飽和：補償範圍 $\ge$ 一個 VCO 週期加校正餘裕；夾住時梯度為 0`)}>
        {R`\begin{gathered}\boxed{R\ge T_\mathrm{vco}(1+\varepsilon_\mathrm{cal})+\mathrm{INL}_\mathrm{pk}+2h}\\[4pt]\begin{aligned}T_0&=h+\mathrm{INL}_\mathrm{pk}+T_\mathrm{vco}(1+\varepsilon_\mathrm{cal})\\[4pt]\frac{\partial e}{\partial w}&=\begin{cases}-x,&\text{沒飽和}\\0,&\text{code 夾住}\end{cases}\end{aligned}\end{gathered}`}
      </TexBlock>
      <p>
        數字（同上）<SourceTag kind="illustrative" />：<Tex>{R`T_0=${tx(n.b.t0Fs, 5)}\,\mathrm{fs}`}</Tex>、<Tex>{R`R=${tx(n.b.rangeFs, 5)}\,\mathrm{fs}`}</Tex>。把 gain 推到 <Tex>{R`w=90000\,\mathrm{fs}`}</Tex>（<Tex>{R`1.44\,a`}</Tex>，超過 <Tex>{R`1+\varepsilon`}</Tex>）、<Tex>{R`x=0.95`}</Tex>：想要的延遲{' '}
        <Tex>{R`T_0-w\,x=${tx(n.sat.wantFs, 5)}\,\mathrm{fs}<0`}</Tex>，code 夾在 {n.sat.code}、誤差 <Tex>{R`${tx(n.sat.errorFs, 5)}\,\mathrm{fs}`}</Tex>、<Tex>{R`\partial e/\partial w=${n.sat.dEdw}`}</Tex>——這一拍 GMAC 收到的 <Tex>{R`q\,x`}</Tex> 不是梯度。
      </p>
      <Callout kind="warn" title="DTC 飽和與 gain accumulator 飽和是兩個不同的 rail">
        §5.5 的 <Tex>{R`[w_\mathrm{min},w_\mathrm{max}]`}</Tex> 是 gain 的範圍；這裡的 <Tex>{R`[0,2^{B_\mathrm{dtc}}-1]`}</Tex> 是每一拍 code 的範圍，取決於 <Tex>{R`w\,x`}</Tex> 而不是 <Tex>w</Tex> 本身——<Tex>w</Tex> 在範圍內、<Tex>x</Tex> 接近 1 的那幾拍仍可能夾住。RTL 要把 DTC 的飽和旗標送回 GMAC（那幾拍不累加，或整個 block freeze），否則偏大的 <Tex>w</Tex> 會被假的梯度推得更偏。
      </Callout>
      <HandCalcBox id="HC-04.10">
        用 HC-04.9 的 <Tex>{R`T_0`}</Tex> 與 <Tex>{R`\Delta`}</Tex>，挑一拍的 <Tex>x</Tex> 與目前的 <Tex>w</Tex>，自己算這一拍的 code、量化誤差與梯度；把 <Tex>w</Tex> 推到 <Tex>{R`T_0/x`}</Tex> 以上看它夾住。
      </HandCalcBox>
      <DtcRangeExperiment />
      <CodeBlock source={dtcSrc} region="dtcRangeBudget" path={DTC_PATH} title={R`$T_0$ 預算：範圍、基準延遲、LSB 與量化抖動（F-04.20、F-04.19）`} />
      <CodeBlock source={dtcSrc} region="dtcQuantizationJitter" path={DTC_PATH} title={R`量化抖動 $\Delta/\sqrt{12}$ 與有效的 $\sigma_v$、$K_q$ 折損`} />
      <CodeBlock source={dtcSrc} region="dtcCompensation" path={DTC_PATH} title={R`一拍：$T_0-w\,x$ 取整、夾住、$\partial e/\partial w$`} />
    </Section>
  )
}
