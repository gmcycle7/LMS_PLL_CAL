import { useMemo, useState } from 'react'
import type { Data, Layout } from 'plotly.js-cartesian-dist-min'
import { Callout, ClaimTag, CodeBlock, CodeCompare, ModeGate, ModelLevel, ParamControl, Plot, Section, StepDerivation, Tex, TexBlock, useThemeTokens, ChRef, ChapterErratum } from '@/components'
import biasSrc from '@/simulation/models/bias.ts?raw'
import { KQ_FACTOR, buildCodeDistribution, comparatorMean, eDet, signFixedPoint, type ErrorModel } from '@/simulation/models/bias'
import { F } from '../formulas'
import { ModeDetails, m, texNum } from '../common'
import { Fig, FigRef } from '../Fig'
import { Hand } from '../Hand'

const PATH = 'src/simulation/models/bias.ts'
const S_LAYOUT: Partial<Layout> = { xaxis: { title: { text: '$e$（t.u.）' } }, yaxis: { title: { text: String.raw`$E[q \mid e]$` }, range: [-1.15, 1.15] } }

/** 從 GMAC 歸零推出固定點 w*（MSE 精確、Sign 線性化），並畫出 comparator S 曲線上的殘差位置。 */
export function FixedPointSection() {
  const tokens = useThemeTokens()
  const [sigma, setSigma] = useState(0.3)
  const five = useMemo(() => buildCodeDistribution({ kind: 'five_level' }), [])
  const model: ErrorModel = useMemo(() => ({ a: 1, b: 0, c2: 0, c3: 0.1, kappa: 0, sigmaV: sigma }), [sigma])
  const wStar = useMemo(() => signFixedPoint(model, five).w, [model, five])
  const res = useMemo(() => five.values.map((x) => ({ x, e: eDet(x, wStar, model) })), [five, wStar, model])
  const maxRes = Math.max(...res.map((r) => Math.abs(r.e)))
  // 「你會發現」的兩個對照點（由 mean-field 根即時計算，不手寫）
  const ref = useMemo(() => {
    const at = (s: number) => {
      const md: ErrorModel = { a: 1, b: 0, c2: 0, c3: 0.1, kappa: 0, sigmaV: s }
      const w = signFixedPoint(md, five).w
      return { w, q1: comparatorMean(eDet(1, w, md), s), q2: comparatorMean(eDet(2, w, md), s) }
    }
    return { s1: at(1), s005: at(0.05) }
  }, [five])

  const data: Data[] = useMemo(() => {
    const span = Math.max(4 * sigma, 1.2 * maxRes, 0.3)
    const es = Array.from({ length: 241 }, (_, i) => -span + (2 * span * i) / 240)
    const kq = KQ_FACTOR / sigma
    return [
      { x: es, y: es.map((e) => comparatorMean(e, sigma)), mode: 'lines', name: String.raw`$E[q \mid e] = \operatorname{erf}(e / (\sqrt{2}\,\sigma_v))$`, line: { color: tokens.series[0], width: 2 } },
      { x: es, y: es.map((e) => Math.max(-1.5, Math.min(1.5, kq * e))), mode: 'lines', name: String.raw`切線 $K_q \cdot e$（線性化）`, line: { color: tokens.series[1], dash: 'dash' } },
      {
        x: res.map((r) => r.e),
        y: res.map((r) => comparatorMean(r.e, sigma)),
        mode: 'text+markers',
        text: res.map((r) => `$x=${r.x}$`),
        textposition: 'top center',
        name: String.raw`5 個 code 在 $w^*$ 的殘差`,
        marker: { color: tokens.series[2], size: 9 },
      },
    ]
  }, [sigma, res, maxRes, tokens])

  return (
    <Section kind="formula" title="11.A 固定點從哪裡來：GMAC 歸零的條件" level={2} id="ch11-fixed-point">
      <p>
        Block LMS 每收集 <Tex>{'N'}</Tex> 個 comparator sample 才更新一次 gain（<Tex>{'n'}</Tex> 是 sample 的索引、<Tex>{'k'}</Tex> 是 block 的索引、
        <Tex>{'N'}</Tex> 是每個 block 的 sample 數）。先看 <FigRef id="lms-loop" /> 上面那一列（每個 sample 跑一次）：code <Tex>{'x[n]'}</Tex> 產生誤差{' '}
        <Tex>{'e[n]'}</Tex>，comparator 取正負號 <Tex>{'q[n]'}</Tex>，再乘回 <Tex>{'x[n]'}</Tex>；再看下面那一列（每個 block 才跑一次）：<Tex>{'N'}</Tex>{' '}
        個乘積在藍色方塊平均成 <Tex>{'G_k'}</Tex>，乘上學習率 <Tex>{'\\mu'}</Tex>，加到上一個 block 的 <Tex>{'w_k'}</Tex> 上；新的值延遲一個 block
        後，沿著回授線回到上面一列去改誤差。
      </p>
      <Fig id="lms-loop" />
      <p>
        把這個迴圈寫成公式（圖上的「<Tex>{'\\times\\mu'}</Tex>」與加法點是第一式，藍色方塊是第二式，<Tex>{'z^{-1}'}</Tex> 表示新的{' '}
        <Tex>{'w'}</Tex> 要到下一個 block 才生效）：
      </p>
      <TexBlock>{String.raw`w_{k+1}=w_k+\mu\,G_k,\qquad G_k=\frac1N\sum_{n\in\text{block }k}q[n]\,x[n]`}</TexBlock>
      <p className="small">
        <Tex>{'w_k'}</Tex> 是第 <Tex>{'k'}</Tex> 個 block 使用的校正 gain；<Tex>{'G_k'}</Tex> 是這個 block 的 GMAC 平均輸出（<Tex>{'q\\,x'}</Tex> 的平均，無因次）；
        <Tex>{'\\mu'}</Tex> 是學習率（step size；Sign-LMS 時它把無因次的 <Tex>{'G_k'}</Tex> 換算成 gain 的單位 t.u.）。
      </p>
      <p>
        <Tex>{'\\mu'}</Tex> 很小時，<Tex>{'w'}</Tex> 跟著「平均更新量」<Tex>{'\\mu\\,E[G](w)'}</Tex> 慢慢走（<ChRef ch="12">Ch12</ChRef> 再處理它在平均值附近的抖動）。所以 LMS 最後停下來的地方，就是
        <strong>平均 GMAC 等於 0 的 w</strong>：
      </p>
      <TexBlock>{String.raw`\boxed{E[G](w^*)=E\big[q\,x\big]\Big|_{w=w^*}=0}\qquad(\text{還需 }dE[G]/dw<0\text{ 才是吸引的固定點})`}</TexBlock>
      <p>
        注意這個條件只說「<Tex>{'q'}</Tex> 與 <Tex>{'x'}</Tex> 正交」（相乘再平均等於 0；<Tex>{'E[x]=0'}</Tex> 或 <Tex>{'E[q]=0'}</Tex>{' '}
        時也就是不相關，用語見 §11.0 的先備知識框），完全沒說 <Tex>{'e=0'}</Tex>。接下來對兩種 GMAC 分別解它。
      </p>
      <p className="small">
        這裡的「穩定／吸引」是<strong>平均動態（mean-field）的局部吸引</strong>：另外還需要離散更新本身不發散，也就是{' '}
        <Tex>{String.raw`0<g=\mu S<2`}</Tex>（<Tex>{String.raw`S=-dE[G]/dw`}</Tex> 是平均 GMAC 對 <Tex>{'w'}</Tex> 的恢復斜率，<Tex>{'g'}</Tex> 是正規化的 loop
        gain；<ChRef ch="03">Ch03</ChRef>、<ChRef ch="08">Ch08</ChRef>），而有限的 <Tex>{'\\mu'}</Tex> 會讓 <Tex>{'w'}</Tex> 在{' '}
        <Tex>{'w^*'}</Tex> 附近隨機抖動（<ChRef ch="12">Ch12</ChRef>）。本章只回答「平均停在哪裡」。
      </p>
      <p className="small">
        {m(
          '方框裡的條件 $E[G](w^*)=0$ 把 $E[G](w)$ 當成 $w$ 的連續函數（例如 MSE-LMS，或 $\\sigma_v>0$ 的 Sign-LMS）。如果 $\\sigma_v=0$ 而且 code 只取有限個值，$E[G](w)$ 是階梯函數，可以直接由正跳到負，沒有任何一點等於 0。這時固定點 $w^*$ 改指 $E[G]$ 由正變負的位置（$w<w^*$ 時 $E[G]>0$、$w>w^*$ 時 $E[G]<0$）：$w$ 一般不會停住，而是在 $w^*$ 兩側以 $O(\\mu)$ 的幅度來回跳，GMAC 的時間平均仍然是 0。§11.2 情境 (3) 的 1.4 就是這種情況。',
        )}
      </p>

      <p>
        先看全貌（<FigRef id="mse-vs-sign" />）。先看沒有上色的 MSE-LMS 那一支：多位元的 <Tex>{'e'}</Tex> 直接乘 <Tex>{'x'}</Tex>，平均 GMAC 對{' '}
        <Tex>{'w'}</Tex> 是一條直線，所以固定點是一次方程的解。再看藍色的 Sign-LMS 那一支：多了「只留正負號」與「對雜訊平均」兩步，comparator 的平均輸出變成 S 形的{' '}
        <Tex>{String.raw`\operatorname{erf}`}</Tex>（error function，§11.0 的先備知識框），平均 GMAC 對 <Tex>{'w'}</Tex> 變成曲線；它最後落在哪裡，要看雜訊{' '}
        <Tex>{'\\sigma_v'}</Tex> 相對於殘差有多大（最下面三個出口）。
      </p>
      <Fig id="mse-vs-sign" />
      <p className="small">
        圖上的 <Tex>{String.raw`E[q\mid x]=\operatorname{erf}(\cdot)`}</Tex> 就是下面的公式 F-11.2（<Tex>{String.raw`E[q\mid x]`}</Tex>：code 固定為{' '}
        <Tex>{'x'}</Tex> 時 <Tex>{'q'}</Tex> 對雜訊的平均）；綠色方塊裡的 <Tex>{'w^*'}</Tex> 就是 F-11.4；<Tex>{'K_q'}</Tex> 是 erf 在原點的斜率（comparator
        的小訊號增益）。
      </p>

      <h3>情境 1：MSE-LMS（GMAC 用多位元的 e）</h3>
      <p>
        <FigRef id="bias-correlators" /> 把下面的推導畫成五個平行的相關器。先看左欄：<Tex>{'e[n]'}</Tex> 的五項；各自乘上 <Tex>{'x'}</Tex>{' '}
        取平均後變成右欄。再看加法點：五個平均以正號相加就是 <Tex>{'E[G]'}</Tex>。藍色那一項含有 <Tex>{'w'}</Tex>（對 <Tex>{'w'}</Tex> 的斜率是{' '}
        <Tex>{'-E[x^2]'}</Tex>），是把 <Tex>{'w'}</Tex> 拉回來的恢復力；其餘各項不含 <Tex>{'w'}</Tex>，令總和為 0 之後，它們除以 <Tex>{'E[x^2]'}</Tex>{' '}
        就是 <Tex>{'w^*-a'}</Tex> 的 bias。圖上右欄的五個方塊，就是推導第三行的五項。
      </p>
      <Fig id="bias-correlators" />
      <ModeDetails title={m('一步一步推導：$E[x\\,e]=0\\Rightarrow w^*$')}>
        <StepDerivation
          steps={[
            { tex: String.raw`E[G](w)=E[x\,e]`, why: m('MSE-LMS 的 GMAC 是 $e\\,x$ 的平均（$q$ 換成 $e$）。') },
            {
              tex: String.raw`=E\big[x\big((a-w)x+b+d(x)+\varepsilon_{cc}+v\big)\big]`,
              why: '代入總誤差模型 F-11.1。',
            },
            {
              tex: String.raw`=(a-w)E[x^2]+b\,E[x]+E[x\,d(x)]+E[x\,\varepsilon_{cc}]+E[x\,v]`,
              why: m('期望值是線性的：逐項拆開；$a-w$ 與 $b$ 是常數可以提出來。'),
            },
            {
              tex: String.raw`\begin{aligned}E[x\,v]&=E[x]\,E[v]\\&=E[x]\cdot0=0\end{aligned}`, // 兩行：手機的欄寬放不下一整行（只差 2px 也會多出一條捲軸）
              why: m('$v$ 與 $x$ 獨立 ⇒ 乘積的平均 = 平均的乘積；$v$ 零均值。'),
            },
            {
              tex: String.raw`0=(a-w^*)E[x^2]+b\,E[x]+E[x\,d(x)]+E[x\,\varepsilon_{cc}]`,
              why: m('固定點的定義：在 $w=w^*$ 時平均 GMAC 為 0。'),
            },
            {
              tex: String.raw`(w^*-a)\,E[x^2]=b\,E[x]+E[x\,d(x)]+E[x\,\varepsilon_{cc}]`,
              why: m('把含 $w^*$ 的項移到左邊（兩邊同加 $(w^*-a)E[x^2]$）。'),
            },
            {
              tex: String.raw`w^*=a+\frac{b\,E[x]+E[x\,d(x)]+E[x\,\varepsilon_{cc}]}{E[x^2]}`,
              why: m('兩邊除以 $E[x^2]$（需 $E[x^2]>0$：code 必須有激勵，否則不可辨識）。'),
            },
            {
              tex: String.raw`\frac{dE[G]}{dw}=-E[x^2]<0`,
              why: m('對 $w$ 微分：斜率為負 ⇒ $w>w^*$ 時 $G<0$ 把 $w$ 推回來，固定點是吸引的。'),
            },
          ]}
        />
      </ModeDetails>
      <p>
        對 MSE-LMS 而言這是<strong>一次方程的精確解</strong> <ClaimTag kind="exact" />（指定模型：PD 的 DC 沒有被主迴路消除，見 §11.1 / 勘誤 E03）。
      </p>

      <h3>情境 2：Sign-LMS（GMAC 只用 1-bit 的 q）</h3>
      <p>
        Sign-LMS 與 MSE-LMS 唯一的差別就是 comparator，所以先把 comparator 的三種寫法並排看（<FigRef id="comparator-model" />）。先看第一排（實際電路）：確定性殘差{' '}
        <Tex>{String.raw`e_\mathrm{det}`}</Tex> 加上雜訊 <Tex>{'v'}</Tex> 得到 <Tex>{'e'}</Tex>，comparator 只留下正負號 <Tex>{'q=\\pm1'}</Tex>，乘上{' '}
        <Tex>{'x'}</Tex> 後 <Tex>{'N'}</Tex> 個取平均。再看第二排：固定 code <Tex>{'x'}</Tex>、把雜訊 <Tex>{'v'}</Tex> 平均掉，comparator 就變成一條 S 形曲線{' '}
        <Tex>{String.raw`\operatorname{erf}`}</Tex>（精確）—— 對應下面推導的第 1–4 行（先對雜訊平均、再對 code 平均）。最後看第三排：只要每個 code 的{' '}
        <Tex>{String.raw`|e_\mathrm{det}|`}</Tex> 都遠小於 <Tex>{String.raw`\sigma_v`}</Tex>，S 形曲線在原點附近就可以用斜率 <Tex>{'K_q'}</Tex> 的直線取代（近似）—— 對應推導的第
        5–7 行。三排只有藍色的 comparator 那一塊不同，後面「乘上 <Tex>{'x'}</Tex> 再平均」完全一樣。
      </p>
      <Fig id="comparator-model" />
      <ModeDetails title={m('一步一步推導：$E[x\\,q]$ 與 erf，以及線性化在什麼條件下成立')}>
        <StepDerivation
          steps={[
            {
              tex: String.raw`q=\operatorname{sign}\big(e_\mathrm{det}(x;w)+v\big),\qquad v\sim\mathcal N(0,\sigma_v^2)`,
              why: m('1-bit comparator 只輸出誤差的正負號；確定性部分 $e_\\mathrm{det}$ 由 code 決定，$v$ 是隨機的。'),
            },
            {
              tex: String.raw`P(q=+1\mid x)=P\big(v>-e_\mathrm{det}\big)=\Phi\!\Big(\frac{e_\mathrm{det}}{\sigma_v}\Big)`,
              why: m('$q=+1\\Leftrightarrow v>-e_\\mathrm{det}$；Gaussian 對稱，$P(v>-s)=P(v<s)=\\Phi(s/\\sigma_v)$（$\\Phi$ 是標準常態分布的累積機率，§11.0 的先備知識框）。'),
            },
            {
              tex: String.raw`E[q\mid x]=(+1)\Phi+(-1)(1-\Phi)=2\Phi\!\Big(\frac{e_\mathrm{det}}{\sigma_v}\Big)-1=\operatorname{erf}\!\Big(\frac{e_\mathrm{det}}{\sqrt2\,\sigma_v}\Big)`,
              why: m('只有兩個結果的平均；最後一步用先備知識 $2\\Phi(z)-1=\\operatorname{erf}(z/\\sqrt2)$。這一步是精確的（F-11.2）。'),
            },
            {
              tex: String.raw`E[G](w)=E[q\,x]=E\big[x\,E[q\mid x]\big]=E\Big[x\,\operatorname{erf}\!\Big(\frac{e_\mathrm{det}(x;w)}{\sqrt2\,\sigma_v}\Big)\Big]`,
              why: 'tower property：先對雜訊平均，再對 code 平均。這就是 mean-field GMAC，Lab 用 root finding 直接解它。',
            },
            {
              tex: String.raw`\operatorname{erf}\!\Big(\frac{s}{\sqrt2\sigma_v}\Big)=\underbrace{\frac{\sqrt{2/\pi}}{\sigma_v}}_{K_q}\Big(s-\frac{s^3}{6\sigma_v^2}+\cdots\Big)`,
              why: m('erf 的泰勒展開代入 $z=s/(\\sqrt2\\sigma_v)$：一次項係數就是 comparator 小訊號增益 $K_q$。'),
            },
            {
              tex: String.raw`E[q\,x]\approx K_q\,E\big[x\,e_\mathrm{det}\big]=K_q\,E[x\,e]`,
              why: m('只保留一次項（需每個 code 的 $|e_\\mathrm{det}|\\ll\\sigma_v$）；再用 $E[xv]=0$ 把 $e_\\mathrm{det}$ 換回 $e$。'),
            },
            {
              tex: String.raw`0=K_q\,E[x\,e]\Big|_{w^*}\;\Rightarrow\;\text{與 MSE-LMS 同一個 }w^*`,
              why: m('$K_q>0$ 是常數，不影響零點的位置 ⇒ 一階近似下 Sign-LMS 與 MSE-LMS 停在同一點。'),
            },
          ]}
        />
      </ModeDetails>
      <TexBlock id="F-11.2" label={m('Comparator 條件平均（Gaussian $v$，精確）')}>
        {F.condMean}
      </TexBlock>
      <TexBlock id="F-11.4" label="GMAC 固定點（MSE：精確；Sign：一階近似，條件見下）">
        {F.fixedPoint}
      </TexBlock>
      <p className="ch11-tags">
        <span>MSE-LMS</span> <ClaimTag kind="exact" /> <span>Sign-LMS</span> <ClaimTag kind="approx" /> <ModelLevel level="L1" />
      </p>

      <Callout kind="warn" title={m('「小誤差」指的是整個確定性殘差，不只是 $|a-w|$')}>
        <ChapterErratum id="E01" />
        <TexBlock id="F-11.3">{F.linearize}</TexBlock>
        <p>
          規格書寫「高斯 Noise 主導且小誤差時」。真正需要小的是 <strong>{m('$w^*$ 處每一個 code 的整個確定性殘差')}</strong>{' '}
          <Tex>{String.raw`e_\mathrm{det}(x;w^*)=(a-w^*)x+b+d(x)+\varepsilon_{cc}`}</Tex>，而不只是 <Tex>{'|a-w|'}</Tex>。§11.2 的例子在 <Tex>{'w^*'}</Tex> 處{' '}
          <Tex>{String.raw`\max|e_\mathrm{det}|=0.24`}</Tex>：要讓 Sign-LMS 的固定點與 1.34 相差小於 <Tex>{'10^{-3}'}</Tex>，需要{' '}
          <Tex>{String.raw`\sigma_v\gtrsim0.59`}</Tex>（約 2.5 倍最大殘差）。
        </p>
      </Callout>
      <Hand id="HC-11.2">
        {m('拿一個殘差和一個 $\\sigma_v$，親手查一次 $\\Phi$ 表，看 $K_q$ 線性化差多少（預設是 §11.2 例子的最大殘差 0.24 與 $\\sigma_v=1$）。')}
      </Hand>

      <h3>動手看：殘差落在 S 曲線的哪裡？</h3>
      <p>
        下圖是 comparator 的平均輸出 <Tex>{String.raw`E[q\mid e]=\operatorname{erf}(e/\sqrt2\sigma_v)`}</Tex> 與它在原點的切線 <Tex>{'K_q e'}</Tex>。標記點是 §11.2
        例子（5 個 code、<Tex>{'a=1'}</Tex>、<Tex>{'c_3=0.1'}</Tex>）在 Sign-LMS 固定點 <Tex>{String.raw`w^*(\sigma_v)`}</Tex> 的五個殘差。點落在直線段上 ⇒ 線性化成立；落到彎曲／飽和段 ⇒{' '}
        <Tex>{'K_q'}</Tex> 近似失效，固定點離開 1.34。
      </p>
      <ParamControl
        label={String.raw`$\sigma_v$（comparator 前雜訊）`}
        value={sigma}
        onChange={setSigma}
        min={0.01}
        max={3}
        log
        unit="t.u."
        reg="Behavioral：comparator input noise sigma_v"
        hint={m('試試 0.05（$x=\\pm1$ 飽和、$x=\\pm2$ 停在 $E[q\\mid x]\\approx\\pm0.5$）、0.3、1')}
      />
      <Plot
        title={String.raw`Comparator S 曲線與 $w^*=${texNum(wStar)}$ 處的殘差（$\max|e_\mathrm{det}|/\sigma_v=${texNum(maxRes / sigma, 3)}$）`}
        data={data}
        layout={S_LAYOUT}
        height={300}
        csvName="ch11-s-curve"
        caption={String.raw`由 erf 與 mean-field 根即時計算；虛線超出 $\pm1.5$ 的部分已截掉。`}
      />
      <p className="small muted">
        {m(
          `你會發現：$\\sigma_v=1$ 時五個點都貼著切線（$w^*=${texNum(ref.s1.w)}$）。$\\sigma_v=0.05$ 時 $w^*=${texNum(ref.s005.w)}$：code $x=\\pm1$ 的殘差被 erf 壓成 $E[q\\mid x=\\pm1]=\\mp${texNum(Math.abs(ref.s005.q1), 4)}$（飽和，只剩正負號資訊），而 code $x=\\pm2$ 的殘差很小、停在 $E[q\\mid x=\\pm2]=\\pm${texNum(Math.abs(ref.s005.q2), 4)}$ —— 因為平衡條件 $E[x\\,q]=\\tfrac25\\big(1\\cdot E[q\\mid1]+2\\cdot E[q\\mid2]\\big)=0$ 要求 $E[q\\mid2]=-\\tfrac12E[q\\mid1]$。固定點因此往無雜訊的 1.4 靠近。`,
        )}
      </p>

      <h3>
        <Tex>{'w^*'}</Tex> 的三個來源
      </h3>
      <div className="table-wrap">
        <table className="ch11-table">
          <thead>
            <tr>
              <th>Bias 項</th>
              <th>公式</th>
              <th>何時為 0</th>
              <th>本章段落</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Offset</td>
              <td>
                <Tex>{String.raw`b\,E[x]/E[x^2]`}</Tex>
              </td>
              <td>
                <Tex>{'E[x]=0'}</Tex>（且 <Tex>{'\\sigma_v'}</Tex> 與 code 無關），或 comparator 就是共用的 BBPD（<Tex>{'E[q]=0'}</Tex>）；線性 PD + 獨立 comparator 反而放大（勘誤 E03）
              </td>
              <td>§11.1</td>
            </tr>
            <tr>
              <td>INL</td>
              <td>
                <Tex>{String.raw`E[x\,d(x)]/E[x^2]`}</Tex>
              </td>
              <td>
                <Tex>{'d(x)'}</Tex> 與 <Tex>{'x'}</Tex> 正交（例如對稱 code 下的偶次 INL）
              </td>
              <td>§11.2</td>
            </tr>
            <tr>
              <td>Correlated</td>
              <td>
                <Tex>{String.raw`E[x\,\varepsilon_{cc}]/E[x^2]`}</Tex>
              </td>
              <td>
                <Tex>{String.raw`\varepsilon_{cc}`}</Tex> 與 <Tex>{'x'}</Tex> 正交（相乘再平均等於 0）
              </td>
              <td>§11.3</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="small">
        例：對稱 5-level code 下 <Tex>{String.raw`E[x\cdot c_2x^2]=c_2E[x^3]=0`}</Tex>，所以二階 INL 不會造成 gain bias；但對非負的 DSM residue（<Tex>{'E[x^3]\\neq0'}</Tex>
        ）就會。
      </p>

      <h3>核心程式碼：兩種 GMAC 的平均只差一行</h3>
      <CodeCompare
        items={[
          { label: 'MSE-LMS 的平均 GMAC', source: biasSrc, region: 'meanGmacMse', path: PATH, note: '$E[x\\,e]$：多位元 $e$ 直接乘 $x$；雜訊平均後消失，$G(w)$ 是直線。' },
          {
            label: 'Sign-LMS 的平均 GMAC',
            source: biasSrc,
            region: 'meanGmacSign',
            path: PATH,
            note: '$E[x\\operatorname{erf}(e/(\\sqrt2\\sigma_v))]$：1-bit $q$ 的條件平均是 erf；連續 code 需在 $e=0$ 處切開積分。',
          },
        ]}
        caption="兩個函式就是 Lab 的 mean-field 計算核心（同一份原始碼，?raw 匯入）。"
      />
      <CodeBlock source={biasSrc} region="comparatorMean" path={PATH} title={String.raw`comparatorMean：$E[q\mid x]=\operatorname{erf}\big(s/(\sqrt2\,\sigma)\big)$`} />

      <ModeGate min="research">
        <Callout kind="info" title="Research：mean-field 的嚴格意義">
          <p>
            「平均 GMAC 的根」是小步長平均動態（ODE method）的平衡點：<Tex>{String.raw`\dot w=\mu\,E[G](w)`}</Tex>。對有限的 <Tex>{'\\mu'}</Tex>，block LMS 的時間平均{' '}
            <Tex>{'\\bar w'}</Tex> 與 <Tex>{'w^*'}</Tex> 之間還有一個小偏差：Sign-LMS 的 <Tex>{'E[G](w)'}</Tex> 有曲率，<Tex>{'w'}</Tex> 的抖動會被「整流」成{' '}
            <Tex>{String.raw`G''(w^*)\operatorname{Var}(w)/(2S)`}</Tex>（§11.B 的 F-11.16 有推導；MSE-LMS 的 <Tex>{'E[G]'}</Tex> 是直線，沒有這一項）；無雜訊時則是{' '}
            <Tex>{'O(\\mu)'}</Tex> 的 limit cycle。Lab 的 Analytic ↔ Monte Carlo 比對會把這個估計值算進容許量。另外，iid code 與「v 與 x 獨立」是兩個獨立的假設：DSM
            residue 是確定性序列，靠時間平均（ergodic）取代 ensemble 平均；若 v 與 code 相關（例如 supply ripple 同時調變 DTC 與 comparator），就不屬於本章的類別 ①。
          </p>
        </Callout>
      </ModeGate>
    </Section>
  )
}
