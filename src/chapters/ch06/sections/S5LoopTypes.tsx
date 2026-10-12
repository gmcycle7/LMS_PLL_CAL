import { useMemo } from 'react'
import type { Data } from 'plotly.js-dist-min'
import {
  Callout,
  ClaimTag,
  CodeBlock,
  CodeCompare,
  ModeGate,
  Plot,
  Prereq,
  StepDerivation,
  Tex,
  TexBlock,
  useThemeTokens,
} from '@/components'
import polaritySrc from '@/simulation/models/polarity.ts?raw'
import pllSrc from '@/simulation/models/pll.ts?raw'
import { ctBandwidth3dB } from '@/simulation/models/pll'
import { compareCtDt, ctHpd, loopFreqFromBw, lowFreqReCoef } from '@/simulation/models/polarity'
import { CtDtExperiment } from '../experiments/CtDtExperiment'
import { ChapterDiagram, ChapterHandCalc, ChapterSection, Erratum, f, fx, StepBox } from '../shared'

const PATH = 'src/simulation/models/polarity.ts'

function phaseDeg(z: { re: number; im: number }): number {
  return (Math.atan2(z.im, z.re) * 180) / Math.PI
}

/** §5 H_PD 的 Type-I / Type-II 推導、二次微分的物理意義、CT↔DT（E44） */
export function S5LoopTypes() {
  const tokens = useThemeTokens()
  const h1 = ctHpd('typeI', 0.3)
  const h2 = ctHpd('typeII', 0.3, 0.7)
  const nu = 0.3
  const z = 0.7
  const den = (1 - nu * nu) ** 2 + (2 * z * nu) ** 2
  // §5.4 的頻寬換算（HC-06.6）：ω_3dB/ω_n 與預設 BW/f_ref = 0.01 的 ω_nT_s
  const c3dB = ctBandwidth3dB({ zeta: 0.7, wn: 1 })
  const wnDefault = loopFreqFromBw('typeII', 0.01, 0.7)

  // 圖：CT 原型的 Re{H} 與相位（由 ctHpd 封閉式計算）
  const fig = useMemo(() => {
    const n = 300
    const x = Array.from({ length: n }, (_, i) => 0.01 * Math.pow(1e4, i / (n - 1)))
    const curves: { name: string; type: 'typeI' | 'typeII'; zeta: number; color: string; dash?: 'dash' | 'dot' }[] = [
      { name: 'Type-I', type: 'typeI', zeta: 0.7, color: tokens.series[2] },
      { name: String.raw`Type-II $\zeta = 0.5$`, type: 'typeII', zeta: 0.5, color: tokens.series[3], dash: 'dot' },
      { name: String.raw`Type-II $\zeta = 0.7$`, type: 'typeII', zeta: 0.7, color: tokens.series[1] },
      { name: String.raw`Type-II $\zeta = 1.0$`, type: 'typeII', zeta: 1.0, color: tokens.series[4], dash: 'dash' },
    ]
    const re: Data[] = curves.map((c) => ({
      x,
      y: x.map((v) => ctHpd(c.type, v, c.zeta).re),
      name: c.name,
      mode: 'lines',
      line: { color: c.color, dash: c.dash },
    }))
    const ph: Data[] = curves.map((c) => ({
      x,
      y: x.map((v) => phaseDeg(ctHpd(c.type, v, c.zeta))),
      name: c.name,
      mode: 'lines',
      line: { color: c.color, dash: c.dash },
    }))
    return { re, ph }
  }, [tokens])

  // E44 表：Ω = 0.3ω_nT_s 的相位與 polarity 邊界（compareCtDt 即時計算）
  const e44 = useMemo(
    () =>
      [0, 1].flatMap((d) =>
        [0.01, 0.1, 0.3].map((w) => {
          const r = compareCtDt({ type: 'typeII', zeta: 0.7, wLTs: w, loopDelay: d })
          return { d, w, ph: r.dtPhaseAt03, nu0: r.dtBoundaryNu, white: r.whiteNaiveCt }
        }),
      ),
    [],
  )
  const ct03 = phaseDeg(h2)
  const zeroLine = { type: 'line' as const, xref: 'paper' as const, x0: 0, x1: 1, y0: 0, y1: 0, line: { color: tokens.textMuted, width: 1 } }

  return (
    <ChapterSection
      id="ch06-s5"
      kicker="§5"
      title={
        <>
          <Tex>{'H_{\\mathrm{PD}}=1/(1+L)'}</Tex>：Type-I 只會變慢，Type-II 會變號
        </>
      }
    >
      <p>
        §4 告訴我們：極性由 <Tex>{'\\cos\\phi=\\operatorname{Re}\\{H\\}/|H|'}</Tex> 的正負決定。所以問題變成：主 PLL 的 <Tex>{'H_{\\mathrm{PD}}'}</Tex>{' '}
        在哪些頻率 <Tex>{'\\operatorname{Re}\\{H\\}<0'}</Tex>？先用連續時間（CT）參考原型推導，最後再處理離散時間（DT）的修正（E44）。
      </p>
      <p>
        主 PLL 有兩種常見的結構，差別只在迴路裡有<strong>幾個積分器</strong>。DCO 把頻率積分成相位，所以每個 PLL 至少有一個；Type-II 的 PI
        迴路濾波器再多一個。積分器越多，PLL 把慢速誤差「追掉」得越乾淨——留給 PD 看的殘差也就越不像原本的 code。
      </p>
      <ChapterDiagram id="D-06.10">
        <p>
          先比較兩個迴路（各在自己的虛線框裡）的方塊。Type-I 的迴路濾波器只是一個比例增益 <Tex>{'\\omega_c'}</Tex>（開迴路交越頻率：<Tex>{'|L(j\\omega_c)|=1'}</Tex>），後面接 DCO 的積分{' '}
          <Tex>{'1/s'}</Tex>（乘上 <Tex>{'1/s'}</Tex> 就是對時間積分，見下面的先備知識），所以開迴路是 <Tex>{'L(s)=\\omega_c/s'}</Tex>。Type-II 把比例增益換成藍色的 PI
          濾波器（比例 + 積分），開迴路是 <Tex>{'L(s)=(2\\zeta\\omega_ns+\\omega_n^2)/s^2'}</Tex>，其中 <Tex>{'\\omega_n'}</Tex> 是自然頻率、<Tex>{'\\zeta'}</Tex>{' '}
          是阻尼比。再看兩個迴路各自從加法點用虛線拉出去的結果（綠色與紅色）——它們寫的是「從 <Tex>{'e_{\\mathrm{PD}}'}</Tex> 看」的轉移函數，和圖 6.3 的輸出 1
          是同一個位置：低頻時 Type-I 的 PD 看到 code 的<strong>一次微分</strong>，Type-II 看到<strong>二次微分</strong>。
        </p>
        <p>
          接法和圖 6.3 一樣：加法點就是 PD，DTC 誤差從它的 reference 輸入（「＋」）進來，回授 <Tex>{'\\varphi_{\\mathrm{fb}}'}</Tex> 從 feedback 輸入（「−」）回來。回授路徑上的
          divider 在線性化的相位模型裡只是一個固定的倍數，已經併進迴路增益（<Tex>{'\\omega_c'}</Tex>、<Tex>{'\\omega_n'}</Tex>）裡，所以圖上沒有另外畫；回授路徑上沒有 DTC。
        </p>
        <p>
          圖上兩個迴路各自套用 §2 的 <Tex>{'H_{\\mathrm{PD}}=1/(1+L)'}</Tex>，就得到 5.1 的 F-06.7（綠色那格）與 5.2 的 F-06.8（紅色那格）；「一次微分只會變慢、二次微分會變號」的原因在
          5.3。
        </p>
      </ChapterDiagram>

      <Prereq title={String.raw`Laplace 變數 $s$：乘上 $s$ 就是微分`}>
        <p>
          對 <Tex>{'e^{j\\omega t}'}</Tex> 微分：<Tex>{'\\frac{d}{dt}e^{j\\omega t}=j\\omega\\,e^{j\\omega t}'}</Tex>。所以在頻域裡「乘上 <Tex>{'s=j\\omega'}</Tex>」
          就等於「對時間微分」，乘上 <Tex>{'s^2'}</Tex> 就是二次微分，除以 <Tex>{'s'}</Tex> 就是積分。PLL 的 DCO 把頻率積分成相位，
          所以開迴路 <Tex>{'L(s)'}</Tex> 至少有一個 <Tex>{'1/s'}</Tex>；Type-II 的 PI 迴路濾波器再多一個。
        </p>
      </Prereq>

      <h3>
        5.1 Type-I：<Tex>{'L(s)=\\omega_c/s'}</Tex>
      </h3>
      <StepBox
        title={
          <>
            <Tex>{'\\operatorname{Re}H_{\\mathrm{PD}}'}</Tex> 永遠為正
          </>
        }
      >
        <StepDerivation
          steps={[
            {
              tex: String.raw`H_{\mathrm{PD}}(s)=\frac{1}{1+\omega_c/s}=\frac{s}{s+\omega_c}`,
              why: (
                <>
                  分子分母同乘 <Tex>{'s'}</Tex>。
                </>
              ),
            },
            {
              tex: String.raw`H(j\omega)=\frac{j\nu}{1+j\nu},\qquad\nu=\omega/\omega_c`,
              why: (
                <>
                  代入 <Tex>{'s=j\\omega'}</Tex>，分子分母同除以 <Tex>{'\\omega_c'}</Tex>。
                </>
              ),
            },
            {
              tex: String.raw`=\frac{j\nu(1-j\nu)}{(1+j\nu)(1-j\nu)}=\frac{\nu^2+j\nu}{1+\nu^2}`,
              why: (
                <>
                  乘上分母的共軛，讓分母變成實數 <Tex>{'1+\\nu^2'}</Tex>；<Tex>{'j\\cdot(-j)=1'}</Tex>。
                </>
              ),
            },
            {
              tex: String.raw`\operatorname{Re}H=\frac{\nu^2}{1+\nu^2}>0,\qquad\angle H=90^\circ-\tan^{-1}\nu\in(0^\circ,90^\circ)`,
              why: (
                <>
                  對所有 <Tex>{'\\nu>0'}</Tex> 實部都是正的；相位從 <Tex>{'90^\\circ'}</Tex> 降到 <Tex>{'0^\\circ'}</Tex>。
                </>
              ),
            },
          ]}
        />
        <TexBlock id="F-06.7">{String.raw`\boxed{\operatorname{Re}H_{\mathrm{PD}}^{\text{Type-I}}(j\omega)=\frac{\nu^2}{1+\nu^2}>0}`}</TexBlock>
        <p>
          在 <Tex>{'\\omega=0.3\\omega_c'}</Tex>：<Tex>{`H=${fx(h1.re, 4)}+j${fx(h1.im, 4)}`}</Tex>，相位 <Tex>{`${fx(phaseDeg(h1), 1)}^\\circ`}</Tex>：
          有效增益只剩 <Tex>{`\\cos(${fx(phaseDeg(h1), 1)}^\\circ)\\times|H|=${fx(h1.re, 4)}`}</Tex>——<strong>變慢，但不變號</strong>。
          <ClaimTag kind="exact" />（CT 原型、無額外 loop latency）
        </p>
      </StepBox>

      <ChapterHandCalc
        id="HC-06.4"
        lead={String.raw`任選一個頻率比 $\nu=\omega/\omega_c$，照上面四步把 $\operatorname{Re}H$、$\operatorname{Im}H$、$|H|$ 與相位算出來，確認實部永遠是正的；$\nu=0.3$ 就是上面的數字。`}
      />

      <h3>
        5.2 Type-II：<Tex>{'L(s)=(2\\zeta\\omega_n s+\\omega_n^2)/s^2'}</Tex>
      </h3>
      <StepBox
        title={
          <>
            <Tex>{'\\omega<\\omega_n'}</Tex> 時 <Tex>{'\\operatorname{Re}H_{\\mathrm{PD}}<0'}</Tex>
          </>
        }
      >
        <StepDerivation
          steps={[
            {
              tex: String.raw`H_{\mathrm{PD}}(s)=\frac{1}{1+\frac{2\zeta\omega_ns+\omega_n^2}{s^2}}=\frac{s^2}{s^2+2\zeta\omega_ns+\omega_n^2}`,
              why: (
                <>
                  分子分母同乘 <Tex>{'s^2'}</Tex>。
                </>
              ),
            },
            {
              tex: String.raw`H(j\omega)=\frac{-\nu^2}{1-\nu^2+j2\zeta\nu},\qquad\nu=\omega/\omega_n`,
              why: (
                <>
                  代入 <Tex>{'s=j\\omega'}</Tex>，<Tex>{'(j\\omega)^2=-\\omega^2'}</Tex>，分子分母同除以 <Tex>{'\\omega_n^2'}</Tex>。
                </>
              ),
            },
            {
              tex: String.raw`=\frac{-\nu^2\,(1-\nu^2-j2\zeta\nu)}{(1-\nu^2)^2+(2\zeta\nu)^2}`,
              why: (
                <>
                  乘上分母的共軛 <Tex>{'(1-\\nu^2)-j2\\zeta\\nu'}</Tex>。
                </>
              ),
            },
            {
              tex: String.raw`\operatorname{Re}H=\frac{-\nu^2(1-\nu^2)}{\Delta},\quad\operatorname{Im}H=\frac{2\zeta\nu^3}{\Delta},\quad\Delta=(1-\nu^2)^2+(2\zeta\nu)^2>0`,
              why: (
                <>
                  分開實部與虛部；<Tex>{'\\Delta'}</Tex> 是平方和，永遠為正。
                </>
              ),
            },
            {
              tex: String.raw`\operatorname{sign}(\operatorname{Re}H)=-\operatorname{sign}(1-\nu^2)\;\Rightarrow\;\operatorname{Re}H<0\iff\nu<1`,
              why: (
                <>
                  <Tex>{'\\nu^2'}</Tex> 與 <Tex>{'\\Delta'}</Tex> 都是正的，正負號只由 <Tex>{'(1-\\nu^2)'}</Tex> 決定。
                </>
              ),
            },
          ]}
        />
        <TexBlock id="F-06.8">{String.raw`\boxed{\operatorname{Re}H_{\mathrm{PD}}^{\text{Type-II}}(j\omega)=\frac{-\nu^2(1-\nu^2)}{(1-\nu^2)^2+(2\zeta\nu)^2}<0\quad\text{for }\omega<\omega_n}`}</TexBlock>
        <p>手算規格 §6.1 的例子 <Tex>{'\\nu=0.3,\\ \\zeta=0.7'}</Tex>：</p>
        <TexBlock>{String.raw`\begin{aligned}
1-\nu^2&=0.91,\qquad 2\zeta\nu=0.42,\qquad\Delta=0.91^2+0.42^2=${fx(den, 4)}\\
\operatorname{Re}H&=\frac{-0.09\times0.91}{${fx(den, 4)}}=${fx(h2.re, 5)},\qquad\operatorname{Im}H=\frac{0.09\times0.42}{${fx(den, 4)}}=${fx(h2.im, 5)}\\
\angle H&=180^\circ-\tan^{-1}\frac{${fx(h2.im, 5)}}{${fx(-h2.re, 5)}}=${fx(ct03, 2)}^\circ
\end{aligned}`}</TexBlock>
        <p>
          和規格與 golden vector T06（<Tex>{'-0.0815+j0.0376'}</Tex>、<Tex>{'155.2^\\circ'}</Tex>）一致。這個頻率的單頻 code，
          raw-x LMS 會<strong>反向更新</strong>；主 PLL 本身卻完全穩定。 <ClaimTag kind="exact" />（CT 原型）
        </p>
        <p className="small">
          <Erratum id="E44" />：這是連續時間參考模型。拿它來算離散時間的相關 <Tex>{'C'}</Tex> 只是 <ClaimTag kind="approx" />（需 <Tex>{'\\omega_nT_s\\ll1'}</Tex>、無額外 loop
          latency，對應 <Tex>{'\\Omega=\\omega T_s'}</Tex>，<Tex>{'T_s'}</Tex> 為 comparator / PD 取樣週期；<Tex>{'f_s\\ne f_{\\mathrm{ref}}'}</Tex> 時要另做 multirate 推導）。DT
          的正確做法與數值差異見 5.4。
        </p>
      </StepBox>

      <ChapterHandCalc
        id="HC-06.5"
        lead={String.raw`這就是上面的手算，拆成每一步只做一種運算。先用紙筆把規格的 $\nu=0.3$、$\zeta=0.7$ 算到 $-0.0815+j0.0376$、$155.2^\circ$，再換成你的 $\nu$ 與 $\zeta$（試試 $\nu=1$ 與 $\nu=2$）。`}
      />

      <p className="small">
        下面兩張圖把兩種迴路畫在一起。橫軸 <Tex>{'\\nu=\\omega/\\omega_L'}</Tex> 是以<strong>迴路頻率</strong> <Tex>{'\\omega_L'}</Tex> 正規化的頻率（Type-I 取{' '}
        <Tex>{'\\omega_L=\\omega_c'}</Tex>，Type-II 取 <Tex>{'\\omega_L=\\omega_n'}</Tex>）。
      </p>
      <div className="ch06-grid2">
        <Plot
          title={String.raw`CT 原型 $\operatorname{Re}\{H_{\mathrm{PD}}\}$`}
          ariaLabel="CT 原型 Re{H_PD} 對頻率比的圖"
          data={fig.re}
          xLog
          height={280}
          csvName="ch06-ct-re"
          layout={{ xaxis: { title: { text: String.raw`$\nu = \omega/\omega_L$` } }, yaxis: { title: { text: String.raw`$\operatorname{Re}\,H_{\mathrm{PD}}$` } }, shapes: [zeroLine] }}
          caption={String.raw`由封閉式 ctHpd() 計算。Type-I 恆正；Type-II 在 $\nu<1$ 為負，與 $\zeta$ 無關。`}
        />
        <Plot
          title={String.raw`CT 原型 $\angle H_{\mathrm{PD}}$ [deg]`}
          ariaLabel="CT 原型 H_PD 的相位對頻率比的圖"
          data={fig.ph}
          xLog
          height={280}
          csvName="ch06-ct-phase"
          layout={{
            xaxis: { title: { text: String.raw`$\nu = \omega/\omega_L$` } },
            yaxis: { title: { text: '相位 [deg]' } },
            shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: 90, y1: 90, line: { color: tokens.danger, dash: 'dot', width: 1 } }],
          }}
          caption={String.raw`紅色點線 = $90^\circ$：相位超過它就變號。Type-II 低頻趨近 $180^\circ$。`}
        />
      </div>

      <h3>5.3 物理意義：Type-II 的 PD 看到慢速誤差的「二次微分」</h3>
      <p>
        為什麼多一個積分器就會變號？白話：Type-II 連「等速變化」的誤差都追得掉（斜坡的穩態誤差是零），所以慢速 code 經過它之後，PD 只看得到 code 的
        <strong>彎曲程度</strong>（二次微分）。而一個訊號和自己的彎曲程度總是反相：正弦在波峰（值最大）時向下彎得最厲害（二次微分最負）。
      </p>
      <ChapterDiagram id="D-06.11">
        <p>
          先沿著主線走：慢速 code 被微分兩次（藍色是第二次），再除以 <Tex>{'\\omega_n^2'}</Tex>，就是 PD 看到的 <Tex>{'u'}</Tex>；GMAC 把它和原始的{' '}
          <Tex>{'x'}</Tex> 相乘再平均，得到紅色那一格。再看虛線的支線：Type-I 只微分一次就停了，而 <Tex>{'x'}</Tex> 和自己的一次微分 <Tex>{"x'"}</Tex>{' '}
          平均起來剛好不相關（綠色）。
        </p>
        <p>
          圖上的兩個 <Tex>{'d/dt'}</Tex> 就是公式 <Tex>{'H\\approx s^2/\\omega_n^2'}</Tex> 裡的 <Tex>{'s^2'}</Tex>（乘上 <Tex>{'s'}</Tex> 就是微分）；紅色那格的等號{' '}
          <Tex>{"E[x\\,x'']=-E[(x')^2]"}</Tex> 來自分部積分，是下面推導的第 4 步。
        </p>
      </ChapterDiagram>
      <StepBox title="為什麼兩個積分器會讓相關變負">
        <StepDerivation
          steps={[
            {
              tex: String.raw`\nu\ll1:\;H(s)=\frac{s^2}{\omega_n^2+2\zeta\omega_ns+s^2}\approx\frac{s^2}{\omega_n^2}`,
              why: (
                <>
                  低頻時分母由常數 <Tex>{'\\omega_n^2'}</Tex> 主導。
                </>
              ),
            },
            {
              tex: String.raw`u(t)\approx\frac{x''(t)}{\omega_n^2}`,
              why: (
                <>
                  乘上 <Tex>{'s^2'}</Tex> = 二次微分（上面的先備知識）。PLL 把慢速誤差「追掉」，剩下的是它的彎曲程度。
                </>
              ),
            },
            {
              tex: String.raw`C\approx\frac{E[x\,x'']}{\omega_n^2}`,
              why: (
                <>
                  代入 <Tex>{'C=E[x\\,u]'}</Tex>。
                </>
              ),
            },
            {
              tex: String.raw`\frac1T\int_0^Tx\,x''\,dt=\frac1T\big[x\,x'\big]_0^T-\frac1T\int_0^T(x')^2dt=-\overline{(x')^2}`,
              why: (
                <>
                  分部積分 <Tex>{"\\int f\\,g'=fg-\\int f'g"}</Tex>（取 <Tex>{'f=x'}</Tex>、<Tex>{"g=x'"}</Tex>）；週期訊號的邊界項 <Tex>{"x\\,x'"}</Tex> 在 0
                  與 <Tex>{'T'}</Tex> 相同而抵消（平穩過程同理：<Tex>{"E[x\\,x']=\\tfrac12\\tfrac{d}{dt}E[x^2]=0"}</Tex>）。
                </>
              ),
            },
            {
              tex: String.raw`C\approx-\frac{E[(x')^2]}{\omega_n^2}<0`,
              why: (
                <>
                  只要 code 不是常數，<Tex>{"x'"}</Tex> 不恆為 0 ⇒ 平方的平均 <Tex>{'>0'}</Tex>。
                </>
              ),
            },
          ]}
        />
        <TexBlock id="F-06.9">{String.raw`\boxed{\omega\ll\omega_n:\;u\approx\frac{x''}{\omega_n^2}\;\Rightarrow\;C\approx-\frac{E[(x')^2]}{\omega_n^2}<0}`}</TexBlock>
        <p>
          單頻驗算：<Tex>{"x=A\\cos\\omega t\\Rightarrow x''=-\\omega^2x"}</Tex>，<Tex>{"E[x\\,x'']=-\\omega^2A^2/2"}</Tex>，所以{' '}
          <Tex>{'C\\approx-\\tfrac{A^2}{2}\\nu^2'}</Tex>。在 <Tex>{'\\nu=0.3'}</Tex>：近似 <Tex>{`${fx(-0.5 * 0.09, 4)}`}</Tex>，精確{' '}
          <Tex>{`\\tfrac12\\operatorname{Re}H=${fx(0.5 * h2.re, 4)}`}</Tex>；加上二階修正{' '}
          <Tex>{'\\operatorname{Re}H\\approx-\\nu^2[1+(1-4\\zeta^2)\\nu^2]'}</Tex> 得 <Tex>{`${fx(-0.5 * 0.09 * (1 + (1 - 4 * 0.49) * 0.09), 4)}`}</Tex>。{' '}
          <ClaimTag kind="approx" />
        </p>
        <p>
          對照 Type-I：<Tex>{'H\\approx s/\\omega_c-s^2/\\omega_c^2'}</Tex>，所以{' '}
          <Tex>{"C\\approx E[x\\,x']/\\omega_c-E[x\\,x'']/\\omega_c^2=0+E[(x')^2]/\\omega_c^2>0"}</Tex>：一次微分和 <Tex>{'x'}</Tex> 正交（相關為 0），
          要到二階才出現一個<strong>正</strong>的小量——所以 Type-I 在低頻只會「很弱」，不會反號。
        </p>
        <ModeGate min="research">
          <p className="small">
            離散版（Research）：<Tex>{'(1-z^{-1})^2'}</Tex> 是二次差分 <Tex>{'\\Delta^2x[n]=x[n]-2x[n-1]+x[n-2]'}</Tex>，對完整週期有恆等式{' '}
            <Tex>{'E\\big[x[n-1]\\,\\Delta^2x[n]\\big]=-E\\big[(\\Delta x[n])^2\\big]'}</Tex>（離散的分部積分，單元測試驗證到 <Tex>{'10^{-12}'}</Tex>）。
          </p>
        </ModeGate>
      </StepBox>

      <div className="table-wrap">
        <table className="ch06-table">
          <thead>
            <tr>
              <th>比較</th>
              <th>Type-I</th>
              <th>Type-II</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>積分器數量</td>
              <td>1（DCO）</td>
              <td>2（PI 的 I + DCO）</td>
            </tr>
            <tr>
              <td>
                <Tex>{'H_{\\mathrm{PD}}(s)'}</Tex>
              </td>
              <td>
                <Tex>{'s/(s+\\omega_c)'}</Tex>
              </td>
              <td>
                <Tex>{'s^2/(s^2+2\\zeta\\omega_ns+\\omega_n^2)'}</Tex>
              </td>
            </tr>
            <tr>
              <td>低頻 PD 看到</td>
              <td>
                <Tex>{"u\\approx x'/\\omega_c"}</Tex>（一次微分）
              </td>
              <td>
                <Tex>{"u\\approx x''/\\omega_n^2"}</Tex>（二次微分）
              </td>
            </tr>
            <tr>
              <td>
                <Tex>{'\\operatorname{Re}H'}</Tex> 的正負
              </td>
              <td className="pos">恆正（CT、無 latency）</td>
              <td className="neg">
                <Tex>{'\\omega<\\omega_n'}</Tex> 為負
              </td>
            </tr>
            <tr>
              <td>
                <Tex>{'0.3\\,\\omega_L'}</Tex> 的相位
              </td>
              <td>
                <Tex>{`${fx(phaseDeg(h1), 1)}^\\circ`}</Tex>
              </td>
              <td>
                <Tex>{`${fx(ct03, 1)}^\\circ`}</Tex>
              </td>
            </tr>
            <tr>
              <td>對 raw-x LMS</td>
              <td>只會變慢（有效增益縮小）</td>
              <td>
                慢速 code 會變號 ⇒ 正 <Tex>{'\\mu'}</Tex> 發散
              </td>
            </tr>
            <tr>
              <td>DT 的例外（E44）</td>
              <td>
                latency 大到 <Tex>{'K(d+\\tfrac12)>1'}</Tex> 時低頻也變號（<Tex>{'K=\\omega_cT_s'}</Tex> 是 Type-I DPLL 的迴路增益，<Tex>{'d'}</Tex> 是額外的 loop
                latency，單位 sample；見 5.4）
              </td>
              <td>
                邊界隨 <Tex>{'\\omega_nT_s'}</Tex> 與 <Tex>{'d'}</Tex> 移到約 <Tex>{'1.00\\text{–}1.49\\,\\omega_n'}</Tex>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <CodeCompare
        items={[
          { label: 'CT 原型（封閉式）', source: polaritySrc, region: 'ctHpd', path: PATH, title: String.raw`CT 原型 $H_{\mathrm{PD}}(j\omega)$`, note: String.raw`$\operatorname{Re}H$、$\operatorname{Im}H$ 的封閉式；差異行是 Type-II 的變號來源` },
          { label: '低頻係數', source: polaritySrc, region: 'lowFreqRe', path: PATH, title: String.raw`低頻係數 $\kappa$`, note: String.raw`$\operatorname{Re}\{H\}\approx\kappa\,\big(\Omega/(\omega_LT_s)\big)^2$` },
        ]}
      />

      <h3>
        5.4 CT 原型 vs DT 迴路 <Erratum id="E44" />
      </h3>
      <p>
        規格 §6.1 用 CT 的 <Tex>{'H_{\\mathrm{PD}}(s)'}</Tex> 在 <Tex>{'\\omega=0.3\\omega_n'}</Tex> 求值，但 §6.1 的相關公式、§6.2 的積分都是<strong>離散時間</strong>
        （<Tex>{'\\Omega'}</Tex> 為 rad/sample，在 comparator 取樣率上）。全文沒有說明 CT → DT 的對應。網站採用的修正：
      </p>
      <ul>
        <li>
          CT 例子標為 <ClaimTag kind="approx" />：只在 <Tex>{'\\omega_nT_s\\ll1'}</Tex>、無額外 loop latency 時成立，對應關係 <Tex>{'\\Omega=\\omega T_s'}</Tex>。
        </li>
        <li>
          計算 <Tex>{'C'}</Tex>、<Tex>{'C_D'}</Tex> 或畫 polarity 邊界時，一律用 DT 的 <Tex>{'H(e^{j\\Omega})'}</Tex>，
          <strong>
            不可把 <Tex>{'\\Omega'}</Tex> 代入 <Tex>{'H(j\\omega)'}</Tex>
          </strong>
          。
        </li>
        <li>
          網站的 DT 參考模型（<code>pll.ts</code> 的 <code>designDtLoop</code>，本章另以 <code>polarity.ts</code> 的係數函式重現並交叉驗證）：
        </li>
      </ul>
      <ChapterDiagram id="D-06.12">
        <p>
          先找兩個藍色的累加器：PI 濾波器的積分路徑 <Tex>{'K_i/(1-z^{-1})'}</Tex>，和 DCO 的 <Tex>{'z^{-1}/(1-z^{-1})'}</Tex>——它們就是 CT
          原型的兩個積分器（累加就是離散時間的積分）。再看延遲：DCO 自帶一個 <Tex>{'z^{-1}'}</Tex>（這一拍算出的控制量，下一拍才變成相位），它前面還串著一塊{' '}
          <Tex>{'d'}</Tex> 拍的額外 latency <Tex>{'z^{-d}'}</Tex>（<Tex>{'d=0'}</Tex> 就是沒有這一塊）。一拍的時間是 PD / comparator 的取樣週期 <Tex>{'T_s'}</Tex>。最後看回授：DCO
          的輸出 <Tex>{'\\varphi_{\\mathrm{fb}}[n]'}</Tex> 以「−」號回到加法點，和圖 6.3 一樣是負回授：加法點是 PD，「＋」是 reference 輸入（DTC 誤差從這裡進來），「−」是
          feedback 輸入；回授路徑上 divider 的倍數已經併進 <Tex>{'K_p'}</Tex>、<Tex>{'K_i'}</Tex>，所以沒有另外畫，那裡也沒有 DTC。
        </p>
        <p>
          沿著迴路把方塊乘起來，<Tex>{'\\big(K_p+\\tfrac{K_i}{1-z^{-1}}\\big)\\cdot z^{-d}\\cdot\\tfrac{z^{-1}}{1-z^{-1}}'}</Tex>，就是下面的 F-06.10：
          <Tex>{'K_p'}</Tex> 是比例增益、<Tex>{'K_i'}</Tex> 是積分增益、<Tex>{'d'}</Tex> 是額外 latency 的拍數。Type-I 的 DT 版本只是把 PI 的兩條路換成一個比例增益{' '}
          <Tex>{'K=\\omega_cT_s'}</Tex>。
        </p>
      </ChapterDiagram>
      <TexBlock id="F-06.10">{String.raw`\boxed{L(z)=\Big(K_p+\frac{K_i}{1-z^{-1}}\Big)\frac{z^{-(1+d)}}{1-z^{-1}},\qquad K_p=2\zeta\omega_nT_s,\;K_i=(\omega_nT_s)^2}`}</TexBlock>
      <ChapterDiagram id="D-06.13">
        <p>
          逐列對照：每一條有標籤的箭頭從 CT 的一項指向它在 DT 裡的對應（藍色）。積分器那一條，CT 的 <Tex>{'1/s'}</Tex> 變成 DT 的累加器，因為{' '}
          <Tex>{'1-z^{-1}\\approx sT_s'}</Tex>；PI 濾波器那一條，兩個係數各乘上 <Tex>{'T_s'}</Tex> 與 <Tex>{'T_s^2'}</Tex>，變成無因次的 <Tex>{'K_p'}</Tex>、
          <Tex>{'K_i'}</Tex>；頻率那一條，頻率軸從 <Tex>{'\\omega'}</Tex>（rad/s）換成 <Tex>{'\\Omega=\\omega T_s'}</Tex>（rad/sample）；延遲那一條是 CT
          原型沒有、真實迴路一定有的 <Tex>{'z^{-(1+d)}'}</Tex>。最後看菱形：
          <Tex>{'\\omega_nT_s\\ll1'}</Tex> 而且 <Tex>{'d=0'}</Tex> 時 CT 與 DT 幾乎一樣；否則 DT 的相位比 CT 多轉一些，polarity 邊界就不在 <Tex>{'\\omega_n'}</Tex>。
        </p>
        <p>
          圖上積分器與 PI 濾波器那兩條就是下面推導框的第 3 到 5 步（把 F-06.10 的 <Tex>{'z'}</Tex> 換回 <Tex>{'s'}</Tex>）；最後一格「1.00 到 1.49 倍」的數字來自推導框裡的 E44 表。
        </p>
      </ChapterDiagram>
      <StepBox
        title={
          <>
            為什麼 <Tex>{'K_p=2\\zeta\\omega_nT_s,\\;K_i=(\\omega_nT_s)^2'}</Tex>：DT → CT 的極限
          </>
        }
      >
        <StepDerivation
          steps={[
            {
              tex: String.raw`\frac{z^{-1}}{1-z^{-1}}`,
              why: (
                <>
                  DCO 每個 reference cycle 把控制量累加成相位，而且要到下一拍才生效 ⇒ 嚴格因果（<Tex>{'h_{\\mathrm{PD}}[0]=1'}</Tex> 的來源）。
                </>
              ),
            },
            {
              tex: String.raw`K_p+\frac{K_i}{1-z^{-1}}`,
              why: (
                <>
                  PI loop filter：比例 + 累加（離散積分）。再乘 <Tex>{'z^{-d}'}</Tex> 代表額外的 pipeline latency。
                </>
              ),
            },
            {
              tex: String.raw`1-z^{-1}=1-e^{-sT_s}\approx sT_s,\qquad z^{-(1+d)}\approx1\quad(\omega T_s\ll1)`,
              why: (
                <>
                  <Tex>{'z=e^{sT_s}'}</Tex> 的一階泰勒展開 <Tex>{'e^{-sT_s}\\approx1-sT_s'}</Tex>。
                </>
              ),
            },
            { tex: String.raw`L\approx\Big(K_p+\frac{K_i}{sT_s}\Big)\frac{1}{sT_s}=\frac{(K_p/T_s)\,s+K_i/T_s^2}{s^2}`, why: '代入、整理。' },
            {
              tex: String.raw`=\frac{2\zeta\omega_n s+\omega_n^2}{s^2}`,
              why: (
                <>
                  令 <Tex>{'K_p/T_s=2\\zeta\\omega_n'}</Tex>、<Tex>{'K_i/T_s^2=\\omega_n^2'}</Tex>，就回到 CT 原型。
                </>
              ),
            },
          ]}
        />
        <p>
          反過來說：<Tex>{'\\omega_nT_s'}</Tex> 不夠小或 <Tex>{'d>0'}</Tex> 時，泰勒展開不準，DT 的相位比 CT 多轉一些（latency 造成的相位落後），
          polarity 邊界因此移動。下表由 <code>compareCtDt()</code> 即時計算（<Tex>{'\\zeta=0.7'}</Tex>），與 validation.md E44 的數值一致：
        </p>
        <div className="table-wrap">
          <table className="ch06-table ch06-table-wraphead">
            <thead>
              <tr>
                <th className="num">
                  <Tex>{'d'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'\\omega_nT_s'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'\\angle H(e^{j0.3\\omega_nT_s})'}</Tex>（CT <Tex>{`${fx(ct03, 3)}^\\circ`}</Tex>）
                </th>
                <th className="num">
                  polarity 邊界 <Tex>{'\\Omega_b/(\\omega_nT_s)'}</Tex>（CT 1）
                </th>
                <th className="num">
                  白色 code：錯誤代入 CT 的 <Tex>{'C/\\sigma_x^2'}</Tex>（正確值是 <Tex>{'1'}</Tex>）
                </th>
              </tr>
            </thead>
            <tbody>
              {e44.map((r) => (
                <tr key={`${r.d}-${r.w}`}>
                  <td className="num">{r.d}</td>
                  <td className="num">{r.w}</td>
                  <td className="num">
                    <Tex>{`${fx(r.ph, 3)}^\\circ`}</Tex>
                  </td>
                  <td className="num">{f(r.nu0, 4)}</td>
                  <td className="num">{fx(r.white, 5)}</td>
                </tr>
              ))}
            </tbody>
            <caption>
              DT 迴路嚴格因果 ⇒ <Tex>{'h[0]=1'}</Tex>，所以白色 code 的 <Tex>{'C=h[0]\\sigma_x^2=\\sigma_x^2'}</Tex> 是精確值（F-06.13）；把 <Tex>{'\\Omega'}</Tex> 代入 CT
              <Tex>{'H(j\\Omega/T_s)'}</Tex> 再積分會得到錯的數字。
            </caption>
          </table>
        </div>
      </StepBox>

      <p>
        <strong>實際設計時從哪裡開始算？</strong>手上通常只有主 PLL 的 closed-loop <Tex>{'-3\\,\\mathrm{dB}'}</Tex> 頻寬 <Tex>{'\\mathrm{BW}'}</Tex>、reference 頻率{' '}
        <Tex>{'f_{\\mathrm{ref}}'}</Tex> 與阻尼比 <Tex>{'\\zeta'}</Tex>，沒有 <Tex>{'\\omega_n'}</Tex>。下面這張圖把「頻寬 → <Tex>{'\\omega_nT_s'}</Tex> → <Tex>{'K_p'}</Tex>、
        <Tex>{'K_i'}</Tex> → 某個 code 頻率落在反相頻帶的哪一邊」排成計算順序；後面的推導框與手算題 HC-06.6 都照這個順序走。
      </p>
      <ChapterDiagram id="D-06.14">
        <p>
          跟著圈號算。先算 ①：頻寬除以 reference 頻率（本章所有結果只和這個比值有關，<Tex>{'T_s=1/f_{\\mathrm{ref}}'}</Tex>）。②、③、④ 只用到阻尼比{' '}
          <Tex>{'\\zeta'}</Tex>，算出 <Tex>{'-3\\,\\mathrm{dB}'}</Tex> 頻寬是自然頻率的幾倍，記作 <Tex>{'c_{3\\mathrm{dB}}=\\omega_{3\\mathrm{dB}}/\\omega_n'}</Tex>（
          <Tex>{`\\zeta=0.7`}</Tex> 時是 <Tex>{fx(c3dB, 4)}</Tex>）。再算 ⑤（藍色）：把 ① 乘上 <Tex>{'2\\pi'}</Tex> 變成每個 sample 的角度{' '}
          <Tex>{'\\omega_{3\\mathrm{dB}}T_s'}</Tex>，除以 ④ 就是 <Tex>{'\\omega_nT_s'}</Tex>；本章實驗預設的 <Tex>{'\\mathrm{BW}/f_{\\mathrm{ref}}=0.01'}</Tex> 得到{' '}
          <Tex>{`\\omega_nT_s=${f(wnDefault, 5)}`}</Tex>。⑥、⑦ 由它算出離散時間迴路的兩個係數。⑧、⑨ 是另一條支線：把 code 的頻率 <Tex>{'f'}</Tex> 換成每個 sample 的角度{' '}
          <Tex>{'\\Omega'}</Tex>，再除以 <Tex>{'\\omega_nT_s'}</Tex> 得到頻率比 <Tex>{'\\nu'}</Tex>（藍色）。最後看菱形：<Tex>{'\\nu<1'}</Tex> 時這個頻率落在 Type-II
          的反相頻帶（紅色）。
        </p>
        <p>
          圖上的 ④ 就是下面推導框的結果 <Tex>{'\\omega_{3\\mathrm{dB}}/\\omega_n=\\sqrt{\\beta+\\sqrt{\\beta^2+1}}'}</Tex>（<Tex>{'\\beta=1+2\\zeta^2'}</Tex>{' '}
          只是代號）；⑥、⑦ 就是 F-06.10 的 <Tex>{'K_p=2\\zeta\\omega_nT_s'}</Tex>、<Tex>{'K_i=(\\omega_nT_s)^2'}</Tex>；菱形比的 <Tex>{'\\nu'}</Tex> 就是 5.2 的 F-06.8 裡的{' '}
          <Tex>{'\\nu=\\omega/\\omega_n'}</Tex>。「和 1 比」是 CT 原型的邊界；DT 迴路的邊界略高於 1（圖 6.13 與上一個推導框裡的 E44 表）。若 <Tex>{'f'}</Tex> 是一階 DSM residue 的基頻，這個{' '}
          <Tex>{'\\nu'}</Tex> 就是 §6.4 要用的比值 <Tex>{'\\Delta'}</Tex>。注意菱形判斷的是<strong>單一頻率</strong>：真實的 code 有很多頻率，要用 §6 的加權平均才知道{' '}
          <Tex>{'C'}</Tex> 的正負（近整數鋸齒的基頻落在反相頻帶，小訊號卻不一定變號，見 §6.4）。
        </p>
      </ChapterDiagram>
      <StepBox title={String.raw`由 $-3\,\mathrm{dB}$ 頻寬求 $\omega_n$：實驗滑桿 $\mathrm{BW}/f_{\mathrm{ref}}$ 怎麼換成 $\omega_nT_s$`}>
        <p>
          設計 PLL 時手上通常是 closed-loop 頻寬，不是 <Tex>{'\\omega_n'}</Tex>。CT 原型的 closed-loop 轉移函數是{' '}
          <Tex>{'T=L/(1+L)=1-H_{\\mathrm{PD}}'}</Tex>，<Tex>{'-3\\,\\mathrm{dB}'}</Tex> 頻寬就是 <Tex>{'|T|^2=\\tfrac12'}</Tex> 的頻率：
        </p>
        <StepDerivation
          steps={[
            {
              tex: String.raw`T(j\omega)=\frac{2\zeta\omega_n s+\omega_n^2}{s^2+2\zeta\omega_n s+\omega_n^2}\Big|_{s=j\omega}=\frac{1+j2\zeta\nu}{1-\nu^2+j2\zeta\nu},\qquad\nu=\frac{\omega}{\omega_n}`,
              why: (
                <>
                  <Tex>{'T=L/(1+L)'}</Tex>，代入 <Tex>{'L=(2\\zeta\\omega_ns+\\omega_n^2)/s^2'}</Tex>；分子分母同除以 <Tex>{'\\omega_n^2'}</Tex>。
                </>
              ),
            },
            {
              tex: String.raw`|T|^2=\frac{1+4\zeta^2\nu^2}{(1-\nu^2)^2+4\zeta^2\nu^2}=\frac12`,
              why: '複數的大小平方 = 實部平方 + 虛部平方；分子、分母各自計算。',
            },
            {
              tex: String.raw`2+8\zeta^2\nu^2=1-2\nu^2+\nu^4+4\zeta^2\nu^2\;\Rightarrow\;\nu^4-2\,(1+2\zeta^2)\,\nu^2-1=0`,
              why: '交叉相乘、移項整理。',
            },
            {
              tex: String.raw`\nu^2=\beta+\sqrt{\beta^2+1},\qquad \beta=1+2\zeta^2`,
              why: (
                <>
                  把它當成 <Tex>{'\\nu^2'}</Tex> 的二次方程，用公式解；<Tex>{'\\nu^2>0'}</Tex> 所以取正根。
                </>
              ),
            },
          ]}
          result={String.raw`\frac{\omega_{3\mathrm{dB}}}{\omega_n}=\sqrt{1+2\zeta^2+\sqrt{(1+2\zeta^2)^2+1}}\quad(\zeta=0.7:\ ${fx(c3dB, 4)})`}
        />
        <p className="ch06-tags">
          <ClaimTag kind="exact" />
          <span className="small">
            CT 原型（<code>pll.ts</code> 的 <code>ctBandwidth3dB</code>）。本章實驗的 <Tex>{'\\mathrm{BW}/f_{\\mathrm{ref}}'}</Tex> 滑桿就是用它換算：
            <Tex>{'\\omega_nT_s=2\\pi(\\mathrm{BW}/f_{\\mathrm{ref}})\\big/(\\omega_{3\\mathrm{dB}}/\\omega_n)'}</Tex>；預設 <Tex>{'0.01'}</Tex> ⇒{' '}
            <Tex>{`\\omega_nT_s=${f(wnDefault, 5)}`}</Tex>。
          </span>
        </p>
      </StepBox>
      <ChapterHandCalc
        id="HC-06.6"
        lead={String.raw`把你的 PLL 的 $f_{\mathrm{ref}}$、頻寬、$\zeta$ 代進去，算出 $\omega_nT_s$、$K_p$、$K_i$；再放一個 code 頻率 $f$（例如一階 DSM residue 的基頻 $\mathrm{frac}\cdot f_{\mathrm{ref}}$），看它的 $\nu$ 是不是落在 Type-II 的反相頻帶（$\nu<1$）。`}
      />
      <CodeCompare
        items={[
          { label: 'Type-I DPLL', source: polaritySrc, region: 'dtTypeI', path: PATH, note: String.raw`一個積分器（DCO），迴路濾波器只是比例增益 $K$` },
          { label: 'Type-II DPLL', source: polaritySrc, region: 'dtTypeII', path: PATH, note: 'PI 濾波器多一個積分器；係數與 pll.ts designDtLoop 相同' },
        ]}
        caption={String.raw`兩種 DT 迴路的 $H_{\mathrm{PD}}$ 係數（$z^{-1}$ 升冪）。差異行：比例 vs PI。`}
      />
      <CodeBlock
        source={pllSrc}
        region="designDtLoop"
        path="src/simulation/models/pll.ts"
        title="共用的 DT 主迴路 designDtLoop（pll.ts）"
        caption="全站共用的 Type-II DT 迴路（blockLms 的 type2_dt 路徑也用它）。下方實驗的交叉比對欄即時檢查 dtTypeIICoeffs 與它的頻率響應一致。"
      />

      <ModeGate min="research">
        <StepBox
          title={
            <>
              （Research）Type-I 加上 loop latency 也會在低頻變號：<Tex>{'\\kappa=1-K(d+\\tfrac12)'}</Tex>
            </>
          }
          min="research"
        >
          <StepDerivation
            steps={[
              {
                tex: String.raw`H(e^{j\Omega})=\frac{1-e^{-j\Omega}}{1-e^{-j\Omega}+K\,e^{-j\Omega(1+d)}}`,
                why: (
                  <>
                    Type-I DPLL，<Tex>{'K=\\omega_cT_s'}</Tex>。
                  </>
                ),
              },
              {
                tex: String.raw`1-e^{-j\Omega}\approx j\Omega+\tfrac12\Omega^2,\qquad e^{-j\Omega(1+d)}\approx1-j\Omega(1+d)`,
                why: (
                  <>
                    泰勒展開到需要的階數（<Tex>{'\\operatorname{Re}H'}</Tex> 是 <Tex>{'\\Omega^2'}</Tex> 的量，分子要保留二階）。
                  </>
                ),
              },
              {
                tex: String.raw`\text{分母}\approx K+j\Omega\,\big(1-K(1+d)\big)`,
                why: (
                  <>
                    只保留到一階（分母的零階項 <Tex>{'K\\ne0'}</Tex>）。
                  </>
                ),
              },
              {
                tex: String.raw`\operatorname{Re}H\approx\frac{\operatorname{Re}\{(j\Omega+\frac12\Omega^2)(K-j\Omega(1-K(1+d)))\}}{K^2}=\frac{\Omega^2}{K^2}\Big(1-K\big(d+\tfrac12\big)\Big)`,
                why: (
                  <>
                    <Tex>{'\\operatorname{Re}H=\\operatorname{Re}\\{N\\overline{D}\\}/|D|^2'}</Tex>，<Tex>{'|D|^2\\approx K^2'}</Tex>；展開後收集 <Tex>{'\\Omega^2'}</Tex> 項：
                    <Tex>{'\\tfrac12\\Omega^2K+\\Omega^2(1-K(1+d))'}</Tex>。
                  </>
                ),
              },
            ]}
            result={String.raw`\operatorname{Re}H\approx\kappa\Big(\frac{\Omega}{\omega_cT_s}\Big)^2,\qquad\kappa=1-K\big(d+\tfrac12\big)`}
          />
          <p>
            穩定需要 <Tex>{'K<2\\sin(\\pi/(4d+2))'}</Tex>（與第 08 章 §8.3 的更新延遲是同一個特徵方程 <Tex>{'z^{d+1}-z^d+K=0'}</Tex>）。
            <Tex>{'d=0'}</Tex> 時 <Tex>{'\\kappa<0'}</Tex> 需要 <Tex>{'K>2'}</Tex>，已經不穩定，所以 <Tex>{'d=0'}</Tex> 的 Type-I 在低頻永遠不變號（與 F-06.7
            一致）；但{' '}
            <Tex>{'d=1'}</Tex> 時 <Tex>{'2/3<K<1'}</Tex> 就是「穩定、但慢速 code 會變號」的區間。CT 解讀：等效延遲{' '}
            <Tex>{'\\tau=(d+\\tfrac12)T_s'}</Tex>，<Tex>{'\\omega_c\\tau>1'}</Tex> 時 latency 的相位落後把 Type-I 推過 <Tex>{'90^\\circ'}</Tex>。 <ClaimTag kind="exact" />（低頻漸近，單元測試驗證）
          </p>
        </StepBox>
      </ModeGate>

      <Callout kind="info" title="試試看">
        <p>
          在下面的實驗把 <Tex>{'\\omega_LT_s'}</Tex> 設 0.3、<Tex>{'d'}</Tex> 設 1：Type-II 的邊界移到約{' '}
          <Tex>{`${f(e44.find((r) => r.d === 1 && r.w === 0.3)?.nu0 ?? NaN, 4)}\\,\\omega_n`}</Tex>。再切到 Type-I、<Tex>{'K=0.8,\\;d=1'}</Tex>：
          低頻出現 <Tex>{'\\operatorname{Re}H<0'}</Tex> 的頻帶（<Tex>{`\\kappa=1-0.8\\times1.5=${fx(lowFreqReCoef('typeI', 0.8, 1), 2)}`}</Tex>）。
        </p>
      </Callout>
      <CtDtExperiment />
      <CodeBlock source={polaritySrc} region="reSignBands" path={PATH} title={String.raw`找 $\operatorname{Re}\{H\}$ 的變號點（格點掃描 + 二分法）`} />
    </ChapterSection>
  )
}
