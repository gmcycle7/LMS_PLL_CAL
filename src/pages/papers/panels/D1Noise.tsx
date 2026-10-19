import { useMemo } from 'react'
import { Callout, ClaimTag, MetricTable, ModeGate, SourceTag, StepDerivation, Tex, TexBlock, type MetricRow, ChRef } from '@/components'
import { calNoise, poleFromEnbw, poleFromF3db } from '../bridge'
import { BridgeCode, ErratumNote, FormulaAnchor, Hand, PageChips, PrereqExpectation, PrereqGaussianKq, PrereqPole, r, texNum } from '../common'

/** T13 / T14 的 illustrative 參數（規格 §12.1；勘誤 E30 補上的前提）。 */
export const D1_PARAMS = { sigmaV: 100, N: 4096, mu: 10, C: 1, fs: 4e9 } as const

/** 「反過來讀」的例子：把 T14 的 exact −3 dB 頻率當成論文上的「頻寬 B」，分別以 −3 dB 與 ENBW 兩種讀法換回 p。 */
export function d1Inverse() {
  const n = calNoise(D1_PARAMS)
  const B = n.f3dbExact
  const pA = poleFromF3db(B, n.fu)
  const pB = poleFromEnbw(B, n.fu)
  return { B, fu: n.fu, pA, gA: 1 - pA, pB, gB: 1 - pB, ratio: (1 - pA) / (1 - pB) }
}

/** D1 對應的本站推導：白色 GMAC 雜訊 → 係數變動 σ_w（Ch12）。 */
export function D1Noise() {
  const n = useMemo(() => calNoise(D1_PARAMS), [])
  const inv = useMemo(d1Inverse, [])
  const approxErr = (n.f3dbOneMinusP - n.f3dbExact) / n.f3dbExact
  const rows: MetricRow[] = [
    { name: r`$K_q$（comparator 小訊號增益）`, value: n.Kq, unit: '1/fs', claim: 'approx', note: r`小訊號線性化：$|\delta|\ll\sigma_v$` },
    { name: r`$g=\mu K_qC$（normalized loop gain）`, value: n.g, unit: '—', claim: 'exact', note: r`average-mode GMAC；$C=1$` },
    { name: r`$p=1-g$（平均 pole）`, value: n.p, unit: '—', claim: 'exact' },
    { name: r`$\sigma_\eta^2$（block 雜訊變異數）`, value: n.sigmaEta2, unit: '—', claim: 'approx', note: r`近平衡、iid、$E[x^2]=1$ 時約為 $1/N$` },
    { name: r`$\sigma_w$（穩態係數 RMS）`, value: n.sigmaW, unit: 'fs', claim: 'exact', note: '在上面的線性模型內精確；gain-equivalent，不是 output jitter' },
    { name: r`$f_u=f_s/N$（block update rate）`, value: n.fu, unit: 'Hz', claim: 'exact' },
    { name: r`$f_{3\mathrm{dB}}$（exact discrete）`, value: n.f3dbExact, unit: 'Hz', claim: 'exact' },
    { name: r`$f_{3\mathrm{dB}}$ 的 $-\ln p$ 近似：$\dfrac{-\ln p}{2\pi}f_u$`, value: n.f3dbNegLnP, unit: 'Hz', claim: 'approx' },
    {
      name: r`$f_{3\mathrm{dB}}$ 的 $(1-p)$ 近似：$\dfrac{1-p}{2\pi}f_u$`,
      value: n.f3dbOneMinusP,
      unit: 'Hz',
      claim: 'approx',
      note: `相對 exact 的誤差 $${(approxErr * 100).toFixed(1)}\\%$`,
    },
    { name: 'ENBW（one-sided）', value: n.enbw, unit: 'Hz', claim: 'exact', note: r`把白雜訊積分成 $\sigma_w^2$ 時要用這個頻寬` },
    { name: r`反面：sum 模式忘記除以 $N$ 時的 $g$`, value: n.gSum, unit: '—', claim: 'exact', note: `pole $=${n.pSum.toFixed(2)}$，立即發散` },
  ]
  return (
    <div className="papers-derived">
      <p>
        <SourceTag kind="illustrative" /> 以下是本站 <ChRef ch="12">Ch12</ChRef> 的推導與數字（參數 <Tex>{r`\sigma_v=100\ \mathrm{fs}`}</Tex>、<Tex>{'N=4096'}</Tex>、
        <Tex>{r`\mu=10\ \mathrm{fs}`}</Tex>、unit-RMS code、identity path <Tex>{'C=1'}</Tex>、<Tex>{r`f_s=4\ \mathrm{GHz}`}</Tex>；
        <ErratumNote id="E30">補上的前提</ErratumNote>）。它們<strong>不是</strong> D1 的結果；讀 D1 時拿來當「本站的版本」對照。
      </p>
      <PrereqExpectation />
      <PrereqGaussianKq />
      <PrereqPole />
      <FormulaAnchor id="F-PR.8">
        <StepDerivation
          title={
            <>
              穩態係數雜訊 <Tex>{r`\sigma_w^2`}</Tex>（定義 <Tex>{r`\delta w_k=w_k-w^*`}</Tex>，<ErratumNote id="E33" />）
            </>
          }
          steps={[
            {
              tex: r`G_k=K_qC\,(w^*-w_k)+\eta_k=-K_qC\,\delta w_k+\eta_k`,
              why: (
                <>
                  小訊號線性化：GMAC 的平均值與誤差成正比（<ChRef ch="05">Ch05</ChRef> 的 <Tex>{'K_q'}</Tex>），<Tex>{r`\eta_k`}</Tex> 是扣掉平均後剩下的零均值雜訊。
                </>
              ),
            },
            {
              tex: r`\delta w_{k+1}=\delta w_k+\mu G_k=(1-\mu K_qC)\,\delta w_k+\mu\eta_k=p\,\delta w_k+\mu\eta_k`,
              why: (
                <>
                  代入更新式 <Tex>{r`w_{k+1}=w_k+\mu G_k`}</Tex>，兩邊同減 <Tex>{'w^*'}</Tex>；令 <Tex>{r`g=\mu K_qC`}</Tex>、<Tex>{'p=1-g'}</Tex>。
                </>
              ),
            },
            {
              tex: r`E[\delta w_{k+1}^2]=p^2E[\delta w_k^2]+2p\mu\,E[\delta w_k\eta_k]+\mu^2E[\eta_k^2]`,
              why: '兩邊平方後取期望值；期望值是線性的。',
            },
            {
              tex: r`E[\delta w_k\eta_k]=0`,
              why: (
                <>
                  <Tex>{r`\delta w_k`}</Tex> 只由 <Tex>{r`\eta_0,\dots,\eta_{k-1}`}</Tex> 決定；<Tex>{r`\eta_k`}</Tex> 與過去獨立且平均為 0（iid block
                  雜訊的假設）。
                </>
              ),
            },
            {
              tex: r`\sigma_w^2=p^2\sigma_w^2+\mu^2\sigma_\eta^2`,
              why: (
                <>
                  穩態（<Tex>{'|p|<1'}</Tex>）時 <Tex>{r`E[\delta w_{k+1}^2]=E[\delta w_k^2]=\sigma_w^2`}</Tex>，並記 <Tex>{r`\sigma_\eta^2=E[\eta_k^2]`}</Tex>。
                </>
              ),
            },
          ]}
          result={r`\sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2}`}
        />
      </FormulaAnchor>
      <p>
        代入數字：<Tex>{r`g=10\times${texNum(n.Kq, 6)}=${texNum(n.g, 6)}`}</Tex>，<Tex>{r`p=${texNum(n.p, 8)}`}</Tex>，
        <Tex>{r`\sigma_w=\dfrac{10\cdot\sqrt{1/4096}}{\sqrt{1-p^2}}=${texNum(n.sigmaW, 6)}\ \mathrm{fs}`}</Tex> <ClaimTag kind="exact" />
        （在上面的線性化模型內）。
      </p>
      <MetricTable rows={rows} caption="由 src/pages/papers/bridge.ts 的 calNoise() 即時計算；測試以 golden/vectors/T13.json、T14.json 交叉比對" />
      <BridgeCode region="calNoise" caption="上表的每個數字都由這段程式計算（與 Ch12 的公式相同；測試對照 golden/vectors/T13.json、T14.json）" />
      <p className="small muted">
        想把 <Tex>{r`\sigma_w`}</Tex>、時間常數、<Tex>{r`-3\ \mathrm{dB}`}</Tex> 頻率與 ENBW 用自己的 <Tex>{r`\mu`}</Tex>、<Tex>{r`\sigma_v`}</Tex>、
        <Tex>{'N'}</Tex> 從頭手算一次，請做 <ChRef ch="12">Ch12</ChRef> 的帶入手算題（同一組 T13／T14 數字）；本頁不重複，只在下面多做一題「反過來讀文獻」。
        <PageChips ids={['ch12', 'workbook']} />
      </p>
      <Callout kind="warn" title="「頻寬 12.9 kHz」有四種定義，不能混用">
        <p>
          <Tex>{r`|H_{\eta\to w}(e^{j\Omega})|^2=\mu^2/|e^{j\Omega}-p|^2`}</Tex> 降到 DC 一半的頻率是 exact <Tex>{r`-3\ \mathrm{dB}`}</Tex> corner；把白雜訊積分成{' '}
          <Tex>{r`\sigma_w^2`}</Tex> 要用的是 ENBW，這個例子裡兩者差 <Tex>{r`${texNum(n.enbw / n.f3dbExact, 4)}`}</Tex> 倍（<Tex>{r`p\to1`}</Tex> 時趨近{' '}
          <Tex>{r`\pi/2`}</Tex>）。規格書把 <Tex>{r`12.9\ \mathrm{kHz}`}</Tex> 寫成「Noise BW」，本站依
          <ErratumNote id="E06" /> <ErratumNote id="E10" /> 分開標示。讀 D1 時也要確認它的「bandwidth」是哪一種。
        </p>
        <TexBlock id="F-PR.9">{r`\cos\Omega_{3\mathrm{dB}}=\frac{1+p^2-2(1-p)^2}{2p},\qquad \mathrm{ENBW}=\frac{\sigma_w^2}{S_w^{(1)}(0)}=\frac{f_u}{2}\cdot\frac{1-p}{1+p}`}</TexBlock>
      </Callout>
      <BridgeCode region="calBandwidths" caption="四種「頻寬」各一行；ENBW 那一行（標「← 差異」）和前三行算的不是同一個東西。" />
      <h4 className="papers-subhead">
        反過來讀：論文只給「頻寬 <Tex>{r`f_{\mathrm{BW}}`}</Tex>」時，怎麼換回 <Tex>{'p'}</Tex> 與 <Tex>{'g'}</Tex>
      </h4>
      <p>
        讀文獻時方向通常是反的：論文寫「LMS loop bandwidth <Tex>{r`=f_{\mathrm{BW}}`}</Tex>」，你想知道它相當於本站多大的 <Tex>{'g=1-p'}</Tex>。把上面兩個式子各自反解（
        <ClaimTag kind="exact" />
        ，同一個一階模型 <Tex>{r`H(z)=\mu/(z-p)`}</Tex>）：
      </p>
      <FormulaAnchor id="F-PR.15">
        <StepDerivation
          title={
            <>
              由頻寬反解 pole（<Tex>{r`0<f_{\mathrm{BW}}<f_u/2`}</Tex>）
            </>
          }
          steps={[
            {
              tex: r`1+p^2-2p\cos\Omega=(1-p)^2+2p\,(1-\cos\Omega)=(1-p)^2+4p\sin^2\frac{\Omega}{2}`,
              why: (
                <>
                  把半功率條件的左邊配成 <Tex>{r`(1-p)^2`}</Tex> 加一項；半角公式 <Tex>{r`1-\cos\Omega=2\sin^2(\Omega/2)`}</Tex>。
                </>
              ),
            },
            {
              tex: r`(1-p)^2+4p\,\beta^2=2(1-p)^2\ \Longrightarrow\ (1-p)^2=4p\,\beta^2,\qquad \beta\equiv\sin\frac{\Omega_{3\mathrm{dB}}}{2}=\sin\frac{\pi f_{\mathrm{BW}}}{f_u}`,
              why: (
                <>
                  讀法 (a)：<Tex>{r`f_{\mathrm{BW}}`}</Tex> 是 <Tex>{r`-3\ \mathrm{dB}`}</Tex> corner，<Tex>{r`\Omega_{3\mathrm{dB}}=2\pi f_{\mathrm{BW}}/f_u`}</Tex>。兩邊同減{' '}
                  <Tex>{r`(1-p)^2`}</Tex>。
                </>
              ),
            },
            {
              tex: r`1-p=2\beta\sqrt p\ \Longrightarrow\ t^2+2\beta\,t-1=0\ \ (t=\sqrt p)\ \Longrightarrow\ \sqrt p=\sqrt{1+\beta^2}-\beta`,
              why: (
                <>
                  <Tex>{r`0<p<1`}</Tex>、<Tex>{r`\beta>0`}</Tex>，開根號取正；再解 <Tex>{'t'}</Tex> 的一元二次方程式，取正根。
                  <Tex>{r`f_{\mathrm{BW}}\to f_u/2`}</Tex> 時 <Tex>{r`\beta\to1`}</Tex>、<Tex>{r`p\to(\sqrt2-1)^2=3-2\sqrt2`}</Tex>，正是 <ErratumNote id="E27" /> 的界限。
                </>
              ),
            },
            {
              tex: r`\mathrm{ENBW}=\frac{f_u}{2}\cdot\frac{1-p}{1+p}=f_{\mathrm{BW}}\ \Longrightarrow\ 1-p=\nu\,(1+p),\quad \nu\equiv\frac{2f_{\mathrm{BW}}}{f_u}\ \Longrightarrow\ p=\frac{1-\nu}{1+\nu}`,
              why: (
                <>
                  讀法 (b)：<Tex>{r`f_{\mathrm{BW}}`}</Tex> 是 one-sided ENBW。移項後是 <Tex>{'p'}</Tex> 的一次方程式。
                </>
              ),
            },
          ]}
          result={r`\text{(a) }\sqrt p=\sqrt{1+\beta^2}-\beta,\ \ \beta=\sin\frac{\pi f_{\mathrm{BW}}}{f_u};\qquad \text{(b) }p=\frac{1-\nu}{1+\nu},\ \ \nu=\frac{2f_{\mathrm{BW}}}{f_u}`}
        />
      </FormulaAnchor>
      <p>
        例：上表的 <Tex>{r`f_{3\mathrm{dB}}=${texNum(inv.B / 1e3, 5)}\ \mathrm{kHz}`}</Tex>（<Tex>{r`f_u=${texNum(inv.fu / 1e3, 7)}\ \mathrm{kHz}`}</Tex>）用讀法 (a) 換回{' '}
        <Tex>{r`p=${texNum(inv.pA, 6)}`}</Tex>、<Tex>{r`g=${texNum(inv.gA, 4)}`}</Tex>，就是原來的迴路；若把同一個數字誤當成 ENBW（讀法 (b)），會得到{' '}
        <Tex>{r`p=${texNum(inv.pB, 6)}`}</Tex>、<Tex>{r`g=${texNum(inv.gB, 4)}`}</Tex>，loop gain 只剩原來的 <Tex>{r`1/${texNum(inv.ratio, 4)}`}</Tex>。兩種讀法的 <Tex>{'g'}</Tex>{' '}
        比值在 <Tex>{r`f_{\mathrm{BW}}\ll f_u`}</Tex> 時趨近 <Tex>{r`\pi/2`}</Tex>，<Tex>{r`f_{\mathrm{BW}}`}</Tex> 越接近 Nyquist 越小（
        <Tex>{r`f_{\mathrm{BW}}\approx0.32f_u`}</Tex> 時兩者相同）。
      </p>
      <BridgeCode region="poleFromBandwidth" caption="兩種讀法各一個函式；測試以 calBandwidths() 來回驗算（先由 p 算頻寬，再由頻寬換回同一個 p）。" />
      <Hand id="HC-PR.4" />
      <ModeGate min="engineer" summary="從係數雜訊到 PLL 輸出還差的兩步（乘號與 ZOH，Ch12）">
        <Callout kind="info" title="從係數雜訊到 PLL 輸出：還差兩步（Ch12）">
          <p>
            reference 端 DTC 的補償誤差（多補償的時間：reference edge 少延遲、早到這麼多）是 <Tex>{r`\delta t[n]=x[n]\,\delta w[n]`}</Tex>：<strong>乘號</strong>，所以 code 的頻譜會和 <Tex>{r`\delta w`}</Tex>{' '}
            的低通頻譜捲積（混頻）。而且 <Tex>{r`\delta w_k`}</Tex> 活在 block rate <Tex>{'f_u'}</Tex>，要先以 ZOH 展開到 sample rate：
            <Tex>{r`\delta w[n]=\delta w_{\lfloor (n-n_c)/N\rfloor}`}</Tex>（<ErratumNote id="E09" />
            ）。之後再經 PLL 的 output transfer 才是輸出 jitter。所以 <Tex>{r`\sigma_w\approx${texNum(n.sigmaW, 3)}\ \mathrm{fs}`}</Tex> 只是 gain-equivalent
            的數字。
          </p>
        </Callout>
      </ModeGate>
    </div>
  )
}
