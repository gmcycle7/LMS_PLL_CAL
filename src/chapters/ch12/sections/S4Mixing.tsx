import { useMemo } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import { Callout, ClaimTag, CodeBlock, ModeGate, Plot, Prereq, Section, Tex, TexBlock } from '@/components'
import calNoiseSrc from '@/simulation/models/calNoise.ts?raw'
import { swDtft, swOneSided, swZohOneSided } from '@/simulation/models/calNoise'
import { Diagram, EX, Erratum, Hand, Steps, md, sig } from '../common'
import {
  CHART_BLOCK_TIMING,
  CHART_DC_FEEDTHROUGH,
  CHART_GAIN_MULT,
  CHART_MIX_DOMAINS,
  CHART_PSD_UNITS,
  CHART_THREE_CODES,
  CHART_TONE_MIXER,
  CHART_ZOH_TWO_STEP,
} from '../diagrams'

const PATH = 'src/simulation/models/calNoise.ts'
const ZOH_LAYOUT: Partial<Layout> = {
  xaxis: { title: { text: '$f$ [kHz]' } },
  yaxis: { title: { text: String.raw`PSD [dB re $\mathrm{fs}^2/\mathrm{Hz}$]` }, range: [-140, -40] },
}

export function S4Mixing() {
  const zoh = useMemo(() => {
    const n = 1400
    const fMax = 3.5 * EX.fu
    const f = Array.from({ length: n }, (_, i) => (i / (n - 1)) * fMax)
    const { mu } = EX.input
    // block-rate PSD 是以 f_u 為週期的（DTFT）：f > f_u/2 的部分是 image（虛線）
    const block = f.map((ff) => 10 * Math.log10(swOneSided(ff, mu, EX.p, EX.sigmaEta2, EX.fu)))
    const zohDb = f.map((ff) => 10 * Math.log10(Math.max(swZohOneSided(ff, EX.input.fs, EX.input.N, mu, EX.p, EX.sigmaEta2), 1e-40)))
    const inBase = f.map((ff, i) => (ff <= EX.fu / 2 ? block[i] : NaN))
    const images = f.map((ff, i) => (ff > EX.fu / 2 ? block[i] : NaN))
    const fk = f.map((x) => x / 1e3)
    const traces: Data[] = [
      { x: fk, y: inBase, name: String.raw`block-rate $S_w^{(1)}$（$0 \ldots f_u/2$）`, mode: 'lines' },
      { x: fk, y: images, name: 'block-rate DTFT 的週期 image', mode: 'lines', line: { dash: 'dot' } },
      { x: fk, y: zohDb, name: String.raw`ZOH sample-rate $S^{(1)}$（E09）`, mode: 'lines' },
    ]
    return traces
  }, [])
  // 先算一次：x = cos(2π·100 kHz·t)、δw = 1 fs·cos(2π·10 kHz·t) 在幾個時刻的乘積，與「90 kHz + 110 kHz 各 0.5 fs」逐點比較
  const hand = useMemo(() => {
    const fx = 1e5
    const fw = 1e4
    return [0, 1, 2.5, 5, 12.5, 25].map((tUs) => {
      const t = tUs * 1e-6
      const x = Math.cos(2 * Math.PI * fx * t)
      const dw = Math.cos(2 * Math.PI * fw * t) // fs
      const sum = 0.5 * Math.cos(2 * Math.PI * (fx + fw) * t) + 0.5 * Math.cos(2 * Math.PI * (fx - fw) * t)
      return { tUs, x, dw, prod: x * dw, sum }
    })
  }, [])
  const offsetDb = 10 * Math.log10(EX.input.fs / 2)
  // 反面：把 block-rate S_w（rad/block）直接當 sample-rate PSD（rad/sample）
  const wrongRatio =
    swZohOneSided(5e3, EX.input.fs, EX.input.N, EX.input.mu, EX.p, EX.sigmaEta2) /
    ((2 / EX.input.fs) * swDtft((2 * Math.PI * 5e3) / EX.input.fs, EX.input.mu, EX.p, EX.sigmaEta2))

  return (
    <>
      <Section kind="intuition" title="§12.6 乘號不是加號" level={3} id="ch12-mixing">
        <p>
          係數 <Tex>{'w'}</Tex> 是 DTC 的 <strong>gain</strong>：reference 端的 DTC 補償量 = <Tex>{'w\\cdot x[n]'}</Tex>（DTC 只能延遲、不能提前，所以實際延遲是從固定的基準延遲{' '}
          <Tex>{'T_0'}</Tex> 往回扣：<Tex>{String.raw`\tau_{\mathrm{DTC}}[n]=T_0-w\,x[n]`}</Tex>）。所以 gain 的抖動不是「加」在輸出上，而是<strong>乘</strong>上當下的 code。
          就像一首歌的音量旋鈕以 10 Hz 輕輕抖動：你聽到的不是一個 10 Hz 的聲音，而是每個音符旁邊多出 ±10 Hz 的邊帶。
        </p>
        <p>
          {md(
            String.raw`把這句話畫成方塊圖：$x[n]$ 是第 $n$ 個 sample 的 DTC code，$w[n]$ 是當下 DTC 實際使用的係數，它等於固定點 $w^*$ 加上抖動 $\delta w[n]$；多補償的時間記作 $\delta t[n]$。`,
          )}
        </p>
        <Diagram chart={CHART_GAIN_MULT} caption={String.raw`係數是 gain，所以它的抖動要先乘上 code 才變成 timing error：$\delta t[n]=x[n]\,\delta w[n]$。先找乘號，再看乘開之後的兩項。`}>
          <p>
            {md(
              String.raw`先看加法點：DTC 用的係數是固定點 $w^*$ 加上抖動 $\delta w[n]$。再看乘號：整個係數乘上 code $x[n]$ 才是 DTC 的補償量——reference edge 被提前（少延遲）的時間；DTC 的實際延遲是 $\tau=T_0-w[n]\,x[n]$，$T_0$ 是固定的基準延遲。最後看乘號之後：乘開分成兩項，$w^*x[n]$ 是本來就要補的量，$x[n]\,\delta w[n]$ 是多補的。`,
            )}
          </p>
          <p>
            {md(
              String.raw`和公式的對照：圖上紅色那一格就是下面 F-12.11 的 $\delta t[n]=x[n]\,\delta w[n]$；$\delta w[n]$ 那一格寫的「每 $N$ 個 sample 才換一次值」說的是 F-12.11 的第二式（block 與 sample 的關係，細節在本節後面的 multirate 小節）。`,
            )}
          </p>
        </Diagram>
        <TexBlock id="F-12.11" label="gain noise → timing error">
          {String.raw`\boxed{\delta t[n]=x[n]\,\delta w[n]},\qquad \delta w[n]=\delta w_{\lfloor (n-n_c)/N\rfloor}`}
        </TexBlock>
        <p>
          第二式說明 block 與 sample 的關係：係數每 <Tex>N</Tex> 個 sample 才更新一次（zero-order hold，ZOH），<Tex>{'n_c'}</Tex> 是 commit / apply latency <Erratum id="E09" />。
          極性：<Tex>{String.raw`\delta t`}</Tex> 是 reference 端的 DTC <strong>多補償</strong>的時間，reference edge 因此比該到的時刻早 <Tex>{String.raw`\delta t`}</Tex>；PD 量的是 reference edge 減 feedback
          edge，所以殘餘 timing error 中對應的項是 <Tex>{String.raw`-x[n]\,\delta w[n]`}</Tex>，
          和直接 PD 路徑做 cross-spectrum 時必須用一致的極性 <Erratum id="E33" />。
        </p>
      </Section>

      <Section kind="example" title="先算一次：兩個 cos 相乘，逐點看" level={3}>
        <p>
          {md(
            String.raw`規格 §12.4 的例子：code 是 100 kHz 的正弦 $x(t)=\cos(2\pi\cdot100\,\mathrm{kHz}\cdot t)$，係數被一個 10 kHz 的週期性干擾調變 $\delta w(t)=1\ \mathrm{fs}\cdot\cos(2\pi\cdot10\,\mathrm{kHz}\cdot t)$。乘法器對這兩個頻率做的事，先用一張圖看結果：`,
          )}
        </p>
        <Diagram chart={CHART_TONE_MIXER} caption={String.raw`乘法器把兩個頻率變成差頻與和頻：進去的是 100 kHz 和 10 kHz，出來的是 90 kHz 和 110 kHz，各拿到一半的振幅 $AB/2$。`}>
          <p>
            {md(
              String.raw`先看乘號的兩個輸入：code 的頻率 $f_x$ 是 100 kHz、振幅 $A=1$；係數擾動的頻率 $f_w$ 是 10 kHz、振幅 $B=1$ fs。再看乘號的輸出：只有差頻 $f_x-f_w$ 與和頻 $f_x+f_w$ 兩個頻率，各拿到一半的振幅 $AB/2$；原本的 100 kHz 與 10 kHz 都不見了（紅色那一格）。`,
            )}
          </p>
          <p>{md(String.raw`和公式的對照：圖上的 $A$、$B$、$f_x$、$f_w$ 就是後面 F-12.12 裡的同名符號，兩個輸出方塊就是 F-12.12 右邊的兩個 $\cos$ 項。`)}</p>
        </Diagram>
        <p>{md(String.raw`用數字驗證：直接在幾個時刻把兩者相乘，再和「一根 110 kHz 加一根 90 kHz、各 0.5 fs」的和比較：`)}</p>
        <div className="table-wrap">
          <table className="ch12-table">
            <thead>
              <tr>
                <th className="num">
                  <Tex>{'t'}</Tex> [<Tex>{String.raw`\mu\mathrm s`}</Tex>]
                </th>
                <th className="num">
                  <Tex>{'x(t)'}</Tex>
                </th>
                <th className="num">
                  <Tex>{String.raw`\delta w(t)`}</Tex> [fs]
                </th>
                <th className="num">
                  <Tex>{String.raw`x\cdot\delta w`}</Tex> [fs]
                </th>
                <th className="num">
                  <Tex>{String.raw`0.5\cos(2\pi\cdot110\mathrm k\,t)+0.5\cos(2\pi\cdot90\mathrm k\,t)`}</Tex> [fs]
                </th>
              </tr>
            </thead>
            <tbody>
              {hand.map((r) => (
                <tr key={r.tUs}>
                  <td className="num">{r.tUs}</td>
                  <td className="num">{r.x.toFixed(5)}</td>
                  <td className="num">{r.dw.toFixed(5)}</td>
                  <td className="num">{r.prod.toFixed(5)}</td>
                  <td className="num">{r.sum.toFixed(5)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          最後兩欄每一列都相同：乘積裡<strong>沒有</strong> 100 kHz，也沒有 10 kHz，只有 90 kHz 與 110 kHz 兩個頻率。下面用三角恆等式說明為什麼一定如此。
        </p>
      </Section>

      <Section kind="formula" title={String.raw`單頻 $\times$ 單頻：積化和差`} level={3}>
        <Prereq title="三角恆等式">
          <p>
            <Tex>{String.raw`\cos(a+b)=\cos a\cos b-\sin a\sin b`}</Tex>，<Tex>{String.raw`\cos(a-b)=\cos a\cos b+\sin a\sin b`}</Tex>。兩式相加即得積化和差。
          </p>
        </Prereq>
        <Steps
          title={md(String.raw`$x=A\cos(2\pi f_xt)$、$\delta w=B\cos(2\pi f_wt)$`)}
          steps={[
            { tex: String.raw`\cos(a+b)+\cos(a-b)=2\cos a\cos b`, why: '把上面兩個和角公式相加，sin 項抵消。' },
            { tex: String.raw`\cos a\cos b=\tfrac12\big[\cos(a+b)+\cos(a-b)\big]`, why: '兩邊除以 2。' },
            {
              tex: String.raw`\delta t(t)=AB\cos(2\pi f_xt)\cos(2\pi f_wt)=\frac{AB}{2}\big[\cos2\pi(f_x+f_w)t+\cos2\pi(f_x-f_w)t\big]`,
              why: md(String.raw`令 $a=2\pi f_xt$、$b=2\pi f_wt$。`),
            },
            {
              tex: String.raw`A=1,\ B=1\ \mathrm{fs},\ f_x=100\ \mathrm{kHz},\ f_w=10\ \mathrm{kHz}:\ \ 0.5\ \mathrm{fs}\ @\ 90\ \mathrm{kHz},\ \ 0.5\ \mathrm{fs}\ @\ 110\ \mathrm{kHz}`,
              why: md(String.raw`規格 §12.4 的例子：$AB/2=0.5$ fs，兩根線在 $f_x\pm f_w$；原本的 10 kHz 與 100 kHz 都「不」出現。`),
            },
          ]}
        />
        <TexBlock id="F-12.12" label="積化和差">
          {String.raw`A\cos(2\pi f_xt)\cdot B\cos(2\pi f_wt)=\frac{AB}{2}\big[\cos2\pi(f_x+f_w)t+\cos2\pi(f_x-f_w)t\big]`}
        </TexBlock>
        <p>
          <ClaimTag kind="exact" /> 這兩根 0.5 fs 的線由下方 Code Mixing Lab 的時域乘積 + coherent tone fit 驗證（T15）。
        </p>
        <Hand id="HC-12.6">
          {md(
            String.raw`這一題只要加、減、乘、除以 2：把 $A$、$B$、$f_x$、$f_w$ 換成你的數字，先寫下兩根 tone 的頻率與 peak；再把 code 的 DC 成分 $m$ 設成 $0.5$，看 $f_w$ 那裡多出什麼。`,
          )}
        </Hand>
      </Section>

      <Section kind="formula" title={String.raw`隨機 $\times$ 隨機：自相關相乘、PSD 卷積`} level={3}>
        <Prereq title="獨立與卷積">
          <p>
            兩個隨機量<strong>獨立</strong>時，乘積的期望值等於期望值的乘積：<Tex>{String.raw`E[XY]=E[X]E[Y]`}</Tex>。
            兩個函數的<strong>卷積</strong> <Tex>{String.raw`(f\circledast g)(\Omega)=\int f(\nu)g(\Omega-\nu)\,d\nu`}</Tex>：把一個頻譜「拖著另一個」掃過去。
            時域相乘 ⇔ 頻域卷積（DTFT 版本要除以 <Tex>{'2\\pi'}</Tex>，積分範圍一個週期）。
          </p>
          <p>
            <strong>Dirac delta</strong> <Tex>{String.raw`\delta(\nu-\nu_0)`}</Tex>：一根位於 <Tex>{String.raw`\nu_0`}</Tex>、無限窄、面積為 1 的尖峰，定義性質是「取樣」：
            <Tex>{String.raw`\int f(\nu)\,\delta(\nu-\nu_0)\,d\nu=f(\nu_0)`}</Tex>。純正弦波或常數的功率全部集中在單一頻率，所以它們的 PSD 就是 delta；和 delta 做卷積 = 把另一個函數<strong>平移</strong>到{' '}
            <Tex>{String.raw`\nu_0`}</Tex>。（注意：這裡的 <Tex>{String.raw`\delta(\cdot)`}</Tex> 是函數，和本章的係數偏差 <Tex>{String.raw`\delta w`}</Tex>、timing error <Tex>{String.raw`\delta t`}</Tex> 無關。）
          </p>
        </Prereq>
        <p>
          {md(
            String.raw`真正的係數雜訊不是單一頻率，而是隨機的。這時不能再一根一根 tone 相乘，要改用統計量：自相關 $R[\ell]$（相隔 $\ell$ 個 sample 的兩個值平均有多像）與它的 DTFT，也就是 PSD $S$。同一個乘法在這三種描述裡長得不一樣：`,
          )}
        </p>
        <Diagram chart={CHART_MIX_DOMAINS} caption={String.raw`同一個乘法的三種看法：時域相乘，自相關也相乘（$R_{\delta t}=R_xR_w$），到了頻域變成卷積（$S_{\delta t}=\tfrac1{2\pi}S_x\circledast S_w$）。由上往下看三個框。`}>
          <p>
            {md(
              String.raw`先看最上面的框：每個 sample 把 code 和係數抖動相乘。再看中間的框：取期望值之後，因為 $x$ 與 $\delta w$ 獨立，自相關也只是相乘。最後看最下面的框：自相關做 DTFT 變成 PSD，「相乘」就變成「卷積之後除以 $2\pi$」。`,
            )}
          </p>
          <p>
            {md(
              String.raw`和公式的對照：最上面的框就是 F-12.11，也是下面推導第 1 行期望值裡的乘積；中間的框是第 1–2 行的結論 $R_{\delta t}=R_xR_w$（F-12.13 的前半）；最下面的框是第 3–6 行，輸出就是 F-12.13 的 $S_{\delta t}$，兩個輸入是 code 的 PSD $S_x$ 與已經換到 sample rate 的 $S_w^{(f_s)}$，圖上線旁的「除以 $2\pi$」就是積分前面的 $\tfrac1{2\pi}$。`,
            )}
          </p>
        </Diagram>
        <Steps
          title={md(String.raw`$R_{\delta t}=R_xR_w$ ⇒ $S_{\delta t}=\frac1{2\pi}S_x\circledast S_w$`)}
          steps={[
            { tex: String.raw`R_{\delta t}[\ell]=E\big[x[n]\delta w[n]\;x[n+\ell]\delta w[n+\ell]\big]`, why: '自相關的定義。' },
            { tex: String.raw`=E\big[x[n]x[n+\ell]\big]\;E\big[\delta w[n]\delta w[n+\ell]\big]=R_x[\ell]\,R_w[\ell]`, why: md(String.raw`假設 $x$ 與 $\delta w$ 「獨立」，把四個因子分成兩組各自取期望值。`) },
            { tex: String.raw`S_{\delta t}(e^{j\Omega})=\sum_\ell R_x[\ell]R_w[\ell]e^{-j\Omega\ell}`, why: 'PSD = 自相關的 DTFT。' },
            { tex: String.raw`=\sum_\ell\Big[\frac1{2\pi}\int_{-\pi}^{\pi}S_x(e^{j\nu})e^{j\nu\ell}d\nu\Big]R_w[\ell]e^{-j\Omega\ell}`, why: md(String.raw`把 $R_x$ 寫成它的逆 DTFT。`) },
            { tex: String.raw`=\frac1{2\pi}\int_{-\pi}^{\pi}S_x(e^{j\nu})\Big[\sum_\ell R_w[\ell]e^{-j(\Omega-\nu)\ell}\Big]d\nu`, why: '交換求和與積分（絕對收斂）。' },
            { tex: String.raw`=\frac1{2\pi}\int_{-\pi}^{\pi}S_x(e^{j\nu})\,S_w(e^{j(\Omega-\nu)})\,d\nu`, why: md(String.raw`中括號就是 $S_w$ 在 $\Omega-\nu$ 的值。`) },
          ]}
        />
        <TexBlock id="F-12.13" label="獨立過程相乘">
          {String.raw`R_{\delta t}[\ell]=R_x[\ell]R_w[\ell],\qquad \boxed{S_{\delta t}(e^{j\theta})=\frac1{2\pi}\int_{-\pi}^{\pi}S_x(e^{j\nu})\,S_w^{(f_s)}(e^{j(\theta-\nu)})\,d\nu}`}
        </TexBlock>
        <p>
          {md(
            String.raw`F-12.13 的頻率變數寫成 $\theta$：以 sample 為單位的離散頻率，$\theta=2\pi f/f_s$（rad/sample），用來和 block rate 的 $\Omega=2\pi f/f_u$ 區分——同一個 $f$，$\theta=\Omega/N$。上標 $(f_s)$ 表示這個 $S_w$ 已經換成 sample-rate 的版本（怎麼換見下面的 multirate 小節）。上面推導裡的 $\Omega$、$\nu$ 在這一小節也都是 sample-rate 的頻率。`,
          )}
        </p>
        <Callout kind="warn" title="兩個關鍵假設">
          (1) <Tex>{'x'}</Tex> 與 <Tex>{String.raw`\delta w`}</Tex> 獨立——真實 LMS 中 <Tex>{String.raw`\delta w`}</Tex> 是由同一個 code 算出來的，兩者有相關；
          (2) 卷積裡必須用 <strong>sample-rate</strong> 的 <Tex>{String.raw`S_w^{(f_s)}`}</Tex>（下一小節），不能直接放 block-rate 的 <Tex>{'S_w'}</Tex>。 <ClaimTag kind="approx" />
          <Erratum id="E09" />
          <Erratum id="E29" />
        </Callout>
        <p>
          {md(
            String.raw`卷積的結果完全取決於 code 的頻譜 $S_x$ 長什麼樣子。三種最常見的 code——常數（平均值 $m$）、單頻（振幅 $A$、頻率 $f_x$）、白色（變異數 $\sigma_x^2$）——給出三種截然不同的結果：`,
          )}
        </p>
        <Diagram chart={CHART_THREE_CODES} caption="同一份係數雜訊乘上三種 code：留在低頻、搬到 code 的頻率兩側，或攤平成寬頻。">
          <p>
            {md(
              String.raw`先看乘號之前：係數雜訊的 PSD 集中在低頻。再看三條分支：常數 code 只把它乘上 $m^2$，頻譜原地不動；單頻 code 把它複製到 $f_x$ 的兩側，每一邊拿到 $A^2/4$；白色 code 把總功率 $\sigma_x^2\sigma_w^2$ 平均攤在 $0$ 到 $f_s/2$。`,
            )}
          </p>
          <p>
            {md(
              String.raw`和公式的對照：三條分支末端的三格依序是下面三個特例的結論（寫成單邊 per-Hz 的形式），也就是後面程式碼裡的 dcTerm、toneTerm、whiteTerm 三行；格子裡的 $S_w$ 指 ZOH 之後的 $S^{(1)}_{w,\mathrm{zoh}}$。`,
            )}
          </p>
        </Diagram>
        <Steps
          title="三種 code 的特例"
          steps={[
            {
              tex: String.raw`x\equiv m:\quad S_x=2\pi m^2\delta(\nu)\ \Rightarrow\ S_{\delta t}=m^2\,S_w^{(f_s)}(e^{j\theta})`,
              why: md(String.raw`常數 code 的頻譜是一根 DC；卷積只是把 $S_w$ 乘上 $m^2$——係數雜訊「原封不動留在低頻」。`),
            },
            {
              tex: String.raw`x=A\cos(\theta_xn+\varphi):\quad S_x=\frac{\pi A^2}{2}\big[\delta(\nu-\theta_x)+\delta(\nu+\theta_x)\big]`,
              why: md(String.raw`隨機相位 $\varphi$ 的正弦波：$R_x[\ell]=\tfrac{A^2}{2}\cos\theta_x\ell$，DTFT 是兩根 delta。`),
            },
            {
              tex: String.raw`\Rightarrow\ S_{\delta t}=\frac{A^2}{4}\big[S_w^{(f_s)}(e^{j(\theta-\theta_x)})+S_w^{(f_s)}(e^{j(\theta+\theta_x)})\big]`,
              why: md(String.raw`卷積 delta = 平移：低頻的係數雜訊被「搬到 $\pm f_x$」，每邊功率 $\tfrac{A^2}{4}\sigma_w^2$。`),
            },
            {
              tex: String.raw`x\ \text{白色}\ (\pm1):\quad S_x=\sigma_x^2\ \Rightarrow\ S_{\delta t}=\sigma_x^2\cdot\frac1{2\pi}\int S_w^{(f_s)}d\nu=\sigma_x^2\sigma_w^2`,
              why: md(String.raw`白色 code 把 $\delta w$ 的功率「攤平」到整個 $0\ldots f_s/2$，任何窄頻帶裡只剩一小部分。`),
            },
          ]}
        />
        <p>
          程式裡用的是<strong>單邊 per-Hz</strong> 版本（換算見下方 F-12.10，取樣率 <Tex>{'f_r=f_s'}</Tex>）。把上面三個特例各乘 <Tex>{'2/f_s'}</Tex>、並把{' '}
          <Tex>{String.raw`\theta\mp\theta_x`}</Tex> 寫成 <Tex>{String.raw`f\mp f_x`}</Tex>，一般的 <Tex>{String.raw`x[n]=m+A\cos(\theta_xn+\varphi)+\text{白色}`}</Tex> 就是三項相加（三個成分互不相關，交叉項為 0）：
        </p>
        <TexBlock>
          {String.raw`\begin{aligned}
S^{(1)}_{w,\mathrm{zoh}}(f)&\equiv\frac{2}{f_s}\,S_w^{(f_s)}\big(e^{j2\pi|f|/f_s}\big)\\[2pt]
S^{(1)}_{\delta t}(f)&=\underbrace{m^2\,S^{(1)}_{w,\mathrm{zoh}}(f)}_{\text{常數（DC）項}}+\underbrace{\frac{A^2}{4}\Big[S^{(1)}_{w,\mathrm{zoh}}(f-f_x)+S^{(1)}_{w,\mathrm{zoh}}(f+f_x)\Big]}_{\text{tone 項}}+\underbrace{\sigma_x^2\,\sigma_w^2\cdot\frac{2}{f_s}}_{\text{白色項}}
\end{aligned}`}
        </TexBlock>
        <p>
          {md(
            String.raw`核對：對 $f$ 從 $0$ 積到 $f_s/2$，三項分別給 $m^2\sigma_w^2$、$\tfrac{A^2}{2}\sigma_w^2$、$\sigma_x^2\sigma_w^2$，總和 $E[x^2]\,\sigma_w^2$（Parseval；本站測試以數值積分核對到 $10^{-6}$）。下面這段就是網站實際執行的程式碼，三行註解對應三個底括號：`,
          )}
        </p>
        <CodeBlock
          source={calNoiseSrc}
          region="mixPsd"
          path={PATH}
          title={String.raw`dtPsdOneSided：三種 code 的 $\delta t$ PSD（網站實際執行）`}
          caption="三行分別對應常數（DC）項、tone 項、白色項；Sw 已是 ZOH 後的 sample-rate PSD（swZohOneSided）。"
        />
        <p>
          {md(
            String.raw`實際的 code 通常同時有平均值與變動的部分。把它拆成 $x[n]=m+\tilde x[n]$——$m$ 是 code 的平均（DC 成分），$\tilde x[n]$ 是扣掉平均之後零均值的部分——乘法就分成兩路，兩路的命運完全不同：`,
          )}
        </p>
        <Diagram chart={CHART_DC_FEEDTHROUGH} caption={String.raw`code 拆成平均值與零均值兩部分，各自乘上係數雜訊，$\delta t=m\,\delta w+\tilde x\,\delta w$：紅色那一路留在低頻，會直接穿過 PLL 到輸出。`}>
          <p>
            {md(
              String.raw`先看 code 被拆成的兩格：DC 成分 $m$ 與零均值成分 $\tilde x[n]$。再看兩個乘號：同一個係數雜訊 $\delta w[n]$ 分別乘上這兩部分——乘上常數 $m$ 的那一路（紅色）頻譜原地不動、留在低頻；乘上 $\tilde x$ 的那一路被搬到 $\tilde x$ 所在的頻率。最後看加法點之後：PLL 到輸出是 low-pass，低頻的 $m\,\delta w$ 幾乎全部通過，$\tilde x\,\delta w$ 只有落在 PLL 頻寬內的部分會留下。綠色那一格是對策：把 code 置中（$m=0$），紅色這一路就消失。`,
            )}
          </p>
          <p>
            {md(
              String.raw`和公式的對照：加法點就是下面框裡的 $\delta t=m\,\delta w+\tilde x\,\delta w$；兩條進入加法點的線各自的 PSD 是 $m^2S_w$ 與 $\tfrac1{2\pi}S_{\tilde x}\circledast S_w$，前者就是上面程式碼的 dcTerm；圖上的 $|T|^2$ 是 §12.7 的 F-12.15 與 F-12.17。`,
            )}
          </p>
        </Diagram>
        <Callout kind="info" title={md(String.raw`Code 有 DC 就有直通項 $m\,\delta w$`)}>
          若 <Tex>{String.raw`x=m+\tilde x`}</Tex>（例如非負的 DSM residue），則 <Tex>{String.raw`\delta t=m\,\delta w+\tilde x\,\delta w`}</Tex>，
          <Tex>{String.raw`S_{\delta t}=m^2S_w+\frac1{2\pi}S_{\tilde x}\circledast S_w`}</Tex>（交叉項因 <Tex>{String.raw`E[\tilde x]=0`}</Tex> 與獨立而消失）。
          <Tex>{String.raw`m\,\delta w`}</Tex> 落在 PLL 的 low-pass <Tex>{'T'}</Tex> 通帶內，直接變成 output jitter——這是 code centering 的另一個理由（第 11 章是 bias 的理由）。
        </Callout>
      </Section>

      <Section kind="formula" title="Multirate：block-rate 的係數雜訊怎麼放到 sample-rate 軸上" level={3} id="ch12-multirate">
        <p>
          <Tex>{String.raw`\delta w_k`}</Tex> 每個 block 一個值（取樣率 <Tex>{'f_u'}</Tex>），code 每個 sample 一個值（取樣率 <Tex>{'f_s=Nf_u'}</Tex>）。
          先看誰在什麼時候動：
        </p>
        <Diagram chart={CHART_BLOCK_TIMING} caption={String.raw`誰在什麼時候動：comparator 與 DTC 每個 sample 都在動，係數每個 block（$N$ 個 sample）才換一次。三條橫帶由上到下是 comparator 與 GMAC、LMS、DTC，每條橫帶由左往右是時間。`}>
          <p>
            {md(
              String.raw`先看最上面那條橫帶：GMAC 花 $N$ 個 sample 累加出一個 $G_k$。再看中間那條：block 結束時 LMS 才更新一次係數。最後看最下面那條：新係數延遲 $n_c$ 個 sample 後套用到 DTC，接下來 $N$ 個 sample 都是同一個值，這就是 zero-order hold（ZOH）。`,
            )}
          </p>
          <p>
            {md(
              String.raw`和公式的對照：圖上「延遲 $n_c$ 個 sample 後套用、保持 $N$ 個 sample」就是 F-12.11 第二式的 $\delta w[n]=\delta w_{\lfloor(n-n_c)/N\rfloor}$——sample 索引 $n$ 先減掉延遲，再除以 $N$ 取整數，得到它所屬的 block 索引 $k$。`,
            )}
          </p>
        </Diagram>
        <p>
          把 <Tex>{String.raw`\delta w_k`}</Tex> 保持 <Tex>N</Tex> 個 sample（ZOH）可以拆成兩步：先<strong>插零上取樣</strong>，再通過長度 <Tex>N</Tex> 的<strong>boxcar 濾波器</strong>。
        </p>
        <Diagram chart={CHART_ZOH_TWO_STEP} caption={String.raw`把保持 $N$ 個 sample 拆成兩步：先插零，再用 boxcar 把零補成同一個值。線上標的是每一步之後的 PSD。`}>
          <p>
            {md(
              String.raw`先看兩個藍色方塊：步驟 1 在兩個係數值之間插入 $N-1$ 個零，頻率軸被壓縮 $N$ 倍、功率除以 $N$；步驟 2 的 boxcar 把每個值重複 $N$ 次，PSD 再乘上它的頻率響應 $|B|^2$。再看乘號：換到 sample rate 之後，才能和同樣是 sample rate 的 code 相乘。`,
            )}
          </p>
          <p>
            {md(
              String.raw`和公式的對照：兩條線上的因子相乘就是 F-12.14——$\tfrac1N S_w(e^{jN\theta})$ 來自步驟 1，$\big[\sin(N\theta/2)/\sin(\theta/2)\big]^2$ 來自步驟 2。圖上的 $\theta$ 是 rad/sample，$\Omega=N\theta$ 是 rad/block。`,
            )}
          </p>
        </Diagram>
        <Steps
          title={md(String.raw`$S_w^{(f_s)}$ 的推導（block 相位隨機的時間平均）`)}
          steps={[
            { tex: String.raw`u[n]=\begin{cases}\delta w_k,&n=kN\\0,&\text{其他}\end{cases}`, why: md(String.raw`插零上取樣：每 $N$ 個 sample 只有一個非零值。`) },
            { tex: String.raw`\bar R_u[\ell]=\begin{cases}\tfrac1N R_w[\ell/N],&N\mid\ell\\0,&\text{其他}\end{cases}`, why: md(String.raw`對 $n$ 取時間平均（等價於 block 相位均勻隨機）：只有 $1/N$ 的 sample 是非零的。`) },
            { tex: String.raw`\bar S_u(e^{j\theta})=\sum_\ell\bar R_u[\ell]e^{-j\theta\ell}=\frac1N\sum_mR_w[m]e^{-jN\theta m}=\frac1NS_w(e^{jN\theta})`, why: md(String.raw`令 $\ell=mN$；頻率被壓縮 $N$ 倍（$\Omega=N\theta$）。`) },
            { tex: String.raw`b[r]=1\ (0\le r<N)\ \Rightarrow\ |B(e^{j\theta})|^2=\Big|\sum_{r=0}^{N-1}e^{-j\theta r}\Big|^2=\Big[\frac{\sin(N\theta/2)}{\sin(\theta/2)}\Big]^2`, why: md(String.raw`ZOH = 與 boxcar 卷積；等比級數求和得 Dirichlet kernel。`) },
            { tex: String.raw`S_w^{(f_s)}(e^{j\theta})=|B|^2\,\bar S_u=\frac1N\Big[\frac{\sin(N\theta/2)}{\sin(\theta/2)}\Big]^2S_w^{(f_u)}(e^{jN\theta})`, why: md(String.raw`濾波器把 PSD 乘上 $|B|^2$。`) },
            { tex: String.raw`\frac1{2\pi}\int_{-\pi}^{\pi}|B|^2d\theta=\sum_r b[r]^2=N`, why: md(String.raw`Parseval：白色 $S_w$ 時總功率不變（$\tfrac1N\cdot N=1$）；一般 $S_w$ 時本站數值積分核對到 $10^{-7}$。`) },
            {
              tex: String.raw`\theta\to0:\ S_w^{(f_s)}\to N\,S_w(1)\ \Rightarrow\ \frac{2}{f_s}NS_w(1)=\frac{2}{f_u}S_w(1)=S_w^{(1)}(0)`,
              why: '低頻的 per-Hz 位準與 block-rate 版本相同——同一個物理量，只是換了取樣率。',
            },
          ]}
        />
        <TexBlock id="F-12.14" label="ZOH multirate PSD">
          {String.raw`\boxed{S_w^{(f_s)}(e^{j\theta})=\frac1N\left[\frac{\sin(N\theta/2)}{\sin(\theta/2)}\right]^2S_w^{(f_u)}(e^{jN\theta})}\qquad\theta=\frac{2\pi f}{f_s}=\frac{\Omega}{N}`}
        </TexBlock>
        <CodeBlock source={calNoiseSrc} region="zohPsd" path={PATH} title="swZohDtft：ZOH 後的 sample-rate PSD" />
        <Plot
          title="係數雜訊 PSD：block-rate 與 ZOH 後的 sample-rate 版本"
          csvName="ch12-zoh-psd"
          height={300}
          data={zoh}
          layout={ZOH_LAYOUT}
          caption={md(
            `由 swOneSided / swZohOneSided 計算（$f_u$ = ${(EX.fu / 1e3).toFixed(4)} kHz、$N=4096$；one-sided、單位 dB re $\\mathrm{fs}^2/\\mathrm{Hz}$；block-rate 曲線的取樣率是 $f_u$、ZOH 曲線的取樣率是 $f_s$）。ZOH 保留了 $0\\ldots f_u/2$ 的主瓣，並在 $k f_u$ 附近留下被 Dirichlet 核壓低、且在 $k f_u$ 正好為零的 image——這就是 step 造成的高頻能量。`,
          )}
        />
        <Callout kind="danger" title={md(String.raw`反面測試：直接把 block-rate $S_w$ 放到 sample-rate 軸`)}>
          若把 <Tex>{String.raw`S_w(e^{j\Omega})`}</Tex>（rad/block）當成 <Tex>{String.raw`S(e^{j\theta})`}</Tex>（rad/sample）代入 F-12.13，頻率軸錯 <Tex>{'N'}</Tex> 倍、
          低頻 skirt 的位準也差了好幾個數量級（本例 <Tex>{'f=5\\ \\mathrm{kHz}'}</Tex> 處，正確的 <Tex>{'S^{(1)}'}</Tex> 是錯誤代入值的 {sig(wrongRatio, 4)} 倍，量級約 <Tex>{'N'}</Tex>）。序列本身是 cyclostationary，
          F-12.14 是時間平均 PSD。<Erratum id="E09" />
          <Erratum id="E29" />
        </Callout>
      </Section>

      <Section kind="formula" title="PSD 正規化：DTFT 形式 ↔ 單邊 per-Hz ↔ phase noise" level={3} id="ch12-psdnorm">
        <p>
          {md(
            String.raw`到目前為止的 PSD 都寫成 DTFT 形式（對 $\Omega$ 或 $\theta$ 積分再除以 $2\pi$ 得到變異數）。量測儀器與 phase noise 規格用的卻是「單邊、每 Hz」的 PSD，以及 $\mathcal L(f)$——離載波 $f$ 處、每 1 Hz 頻寬內的單邊帶雜訊功率相對載波的比值，單位 dBc/Hz。三者之間各差一個固定的係數：`,
          )}
        </p>
        <Diagram chart={CHART_PSD_UNITS} caption={String.raw`PSD 的三次換算：先換成單邊每赫茲（乘 $2/f_r$），再換成輸出相位，最後才是 phase noise $\mathcal L(f)$。注意每一格的單位。`}>
          <p>
            {md(
              String.raw`先由上往下看主線：DTFT 形式的 PSD 乘上 $2/f_r$ 變成單邊 per-Hz；再乘上 $(2\pi f_{\mathrm{out}})^2|T|^2$ 變成輸出相位的 PSD（$f_{\mathrm{out}}$ 是 PLL 輸出頻率，$T$ 是下一節的 PLL 轉移函數）；除以 2 再取 dB 就是 $\mathcal L(f)$。再看前兩格裡各寫的一行積分：兩種形式算變異數的方式不同——DTFT 形式要對 $\Omega$ 積分再除以 $2\pi$，單邊 per-Hz 直接對 $f$ 積分。`,
            )}
          </p>
          <p>
            {md(
              String.raw`和公式的對照：圖上第一個箭頭是 F-12.10 的前半，最後一個箭頭是後半；中間那個箭頭是下一節的 F-12.16。虛線註記的 $f_r$ 就是 F-12.10 裡的 $f_r$：這個序列自己的取樣率。`,
            )}
          </p>
        </Diagram>
        <Steps
          title="換算一次就好，但一定要換"
          steps={[
            { tex: String.raw`\sigma^2=\frac1{2\pi}\int_{-\pi}^{\pi}S(e^{j\Omega})\,d\Omega`, why: '本章（DTFT 形式）的正規化。' },
            { tex: String.raw`\Omega=2\pi f/f_r,\quad d\Omega=\frac{2\pi}{f_r}df\ \Rightarrow\ \sigma^2=\int_{-f_r/2}^{f_r/2}\frac{S(e^{j2\pi f/f_r})}{f_r}df`, why: md(String.raw`變數變換成 Hz；$f_r$ 是這個序列的取樣率。`) },
            { tex: String.raw`=\int_0^{f_r/2}\underbrace{\frac{2}{f_r}S(e^{j2\pi f/f_r})}_{S^{(1)}(f)}df`, why: md(String.raw`實數訊號的 PSD 對 $f$ 偶對稱，負頻率折到正頻率（×2）。`) },
            {
              tex: String.raw`10\log_{10}\frac{S}{S^{(1)}}=10\log_{10}\frac{f_s}{2}=${sig(offsetDb, 4)}\ \mathrm{dB}\ \ (f_s=4\ \mathrm{GHz})`,
              why: md(`若忘了這一步，$\\mathcal L(f)$ 會偏 ${offsetDb.toFixed(1)} dB——這不是小錯。`),
            },
            {
              tex: String.raw`\mathcal L(f)=10\log_{10}\frac{S^{(1)}_\phi(f)}{2}\ \ \mathrm{dBc/Hz}`,
              why: md(String.raw`單邊相位 PSD 一半在上邊帶、一半在下邊帶；單邊帶 phase noise 取一半（小角近似）。`),
            },
          ]}
        />
        <TexBlock id="F-12.10" label="PSD 正規化">
          {String.raw`S^{(1)}(f)=\frac{2}{f_r}\,S\big(e^{j2\pi f/f_r}\big),\ \ 0<f<\tfrac{f_r}{2};\qquad \mathcal L(f)=10\log_{10}\frac{S_\phi^{(1)}(f)}{2}`}
        </TexBlock>
        <p>
          block 量（<Tex>{String.raw`S_w`}</Tex>）用 <Tex>{'f_r=f_u'}</Tex>；sample 量（<Tex>{String.raw`S_{\delta t}`}</Tex>）用 <Tex>{'f_r=f_s'}</Tex>。本站每張 PSD 圖都標示
          one-sided / two-sided、取樣率與單位 <Erratum id="E28" />。
        </p>
        <ModeGate min="research">
          <Callout kind="info" title="Research：cyclostationary 與 cross-spectrum">
            ZOH 的 <Tex>{String.raw`\delta w[n]`}</Tex> 的自相關依 <Tex>{'n \\bmod N'}</Tex> 週期變化（cyclostationary）。F-12.14 只描述它的時間平均；若 code 本身也與 block
            邊界同步（例如週期為 N 的約數的 DSM pattern），交叉的 cyclic spectrum 可能產生離散線，這屬 Research Backlog R2。同樣地，<Tex>{String.raw`\delta w`}</Tex> 由
            <Tex>{String.raw`q\cdot x`}</Tex> 產生，與 <Tex>{'x'}</Tex> 及直接 PD noise 有相關，完整 noise budget 要含 cross-spectrum（R1）。
          </Callout>
        </ModeGate>
      </Section>
    </>
  )
}
