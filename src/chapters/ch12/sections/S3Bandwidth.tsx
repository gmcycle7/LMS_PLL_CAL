import { useMemo } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import { Callout, ClaimTag, CodeBlock, CodeCompare, ModeGate, Plot, Prereq, Section, Tex, TexBlock } from '@/components'
import calNoiseSrc from '@/simulation/models/calNoise.ts?raw'
import pyNoiseSrc from '../../../../golden/lms_pll_golden/noise.py?raw'
import { bw3dbExact, bw3dbNegLnP, bw3dbOneMinusP, enbwOneSided, P_MIN_3DB, bwRegime } from '@/simulation/models/calNoise'
import { Diagram, EX, Erratum, Hand, Steps, md, regimeLabel, relPct, sig } from '../common'
import { CHART_BW_READOUTS, CHART_BW_REGIME, CHART_LEVEL_WIDTH } from '../diagrams'

const PATH = 'src/simulation/models/calNoise.ts'
const HNORM_LAYOUT: Partial<Layout> = {
  xaxis: { title: { text: '$f / f_u$' } },
  yaxis: { title: { text: String.raw`$|H(f)|^2/|H(0)|^2$ [dB]` }, range: [-45, 25] },
}

export function S3Bandwidth() {
  const wrongSigma = Math.sqrt(EX.sw1Dc * EX.f3dbExact)
  // 封閉式 S_w^(1)(0) = πσ_v²/(C²f_s)：與 μ、N 無關（獨立於 calLoop 的 sw1Dc，用來互相核對）
  const swDcClosed = (Math.PI * EX.input.sigmaV ** 2) / (EX.input.C ** 2 * EX.input.fs)
  const curves = useMemo(() => {
    const ps = [0.99, EX.p, 0.6, P_MIN_3DB, 0.1, -0.3]
    const n = 600
    const x = Array.from({ length: n }, (_, i) => 1e-4 * Math.pow(0.5 / 1e-4, i / (n - 1))) // f/f_u
    const traces: Data[] = ps.map((p) => ({
      x,
      y: x.map((r) => {
        const om = 2 * Math.PI * r
        return 10 * Math.log10((1 - p) ** 2 / (1 - 2 * p * Math.cos(om) + p * p))
      }),
      name: p === EX.p ? `$p = ${p.toFixed(5)}$（本例）` : p === P_MIN_3DB ? String.raw`$p = 3 - 2\sqrt{2}$（邊界）` : `$p = ${p}$`,
      mode: 'lines',
    }))
    traces.push({ x: [1e-4, 0.5], y: [-3.0103, -3.0103], name: '$-3$ dB', mode: 'lines', line: { dash: 'dot', color: '#888' } })
    return traces
  }, [])
  const regimeRows = useMemo(
    () =>
      [0.01, EX.g, 0.3, 2 * Math.SQRT2 - 2, 0.9, 1, 1.4, 2.1].map((g) => {
        const p = 1 - g
        const fu = EX.fu
        return {
          g,
          p,
          regime: bwRegime(p, 1),
          exact: bw3dbExact(p, fu) / fu,
          omp: bw3dbOneMinusP(p, fu) / fu,
          nlp: bw3dbNegLnP(p, fu) / fu,
          enbw: enbwOneSided(p, fu) / fu,
        }
      }),
    [],
  )
  const fmtR = (v: number) => (Number.isFinite(v) ? v.toExponential(3) : '—')

  return (
    <>
      <Section kind="example" title="§12.5 頻寬：同一個迴路，四個不同的數字" level={3} id="ch12-bandwidth">
        <p>
          規格說「校正 Noise BW 約 12.9 kHz」。驗算後發現這句話把兩件事混在一起 <Erratum id="E06" />
          <Erratum id="E10" />：12.9 kHz 其實是 <Tex>{String.raw`|H_{\eta\to w}|^2`}</Tex> 的 <strong>−3 dB corner</strong>；
          用來積分白雜訊的「noise bandwidth」（ENBW，equivalent noise bandwidth，等效雜訊頻寬）是另一個數。這裡的{' '}
          <Tex>{String.raw`f_{3\mathrm{dB}}`}</Tex> 指功率降到 DC 一半的頻率；兩者讀的是上一節同一條 <Tex>{String.raw`|H_{\eta\to w}|^2`}</Tex> 曲線，只是問的問題不同：
        </p>
        <Diagram chart={CHART_BW_READOUTS} caption="同一個濾波器的四種讀法：其中三個都在回答功率掉一半的頻率，ENBW 回答的是另一個問題。">
          <p>
            {md(
              String.raw`先看最上面：四個數字讀的是同一條 $|H|^2$ 曲線。再看分岔：讀法 A 問「功率掉到 DC 的一半是在哪個頻率」，藍色是精確解，另外兩個是它的近似；讀法 B 問「白雜訊通過之後的總功率，等於多寬的理想矩形」，答案是 ENBW。最後看綠色：只有 ENBW 可以乘上低頻位準 $S_w^{(1)}(0)$ 得到 $\sigma_w^2$。`,
            )}
          </p>
          <p>
            {md(
              String.raw`和公式的對照：圖上四個帶數字的方塊就是下表的四列，分別對應後面的 F-12.7（exact）、F-12.8（兩個近似）與 F-12.9（ENBW）；圖中的 $f_u=f_s/N$ 是 block update rate，$p=1-\mu K$ 是 pole。`,
            )}
          </p>
        </Diagram>
        <p>把四個數字並排：</p>
        <div className="table-wrap">
          <table className="ch12-table">
            <thead>
              <tr>
                <th>定義</th>
                <th>公式</th>
                <th className="num">本例 [kHz]</th>
                <th className="num">相對 exact</th>
                <th>標籤</th>
              </tr>
            </thead>
            <tbody>
              <tr className="ch12-hl">
                <td>exact −3 dB（discrete）</td>
                <td>
                  <Tex>{String.raw`\tfrac{f_u}{\pi}\arcsin\tfrac{1-p}{2\sqrt p}`}</Tex>
                </td>
                <td className="num">{(EX.f3dbExact / 1e3).toFixed(4)}</td>
                <td className="num">0</td>
                <td>
                  <ClaimTag kind="exact" />
                </td>
              </tr>
              <tr>
                <td>
                  <Tex>{String.raw`-\ln p`}</Tex> 近似
                </td>
                <td>
                  <Tex>{String.raw`\tfrac{-\ln p}{2\pi}f_u`}</Tex>
                </td>
                <td className="num">{(EX.f3dbNegLnP / 1e3).toFixed(4)}</td>
                <td className="num">{relPct(EX.f3dbNegLnP, EX.f3dbExact)}%</td>
                <td>
                  <ClaimTag kind="approx" />
                </td>
              </tr>
              <tr>
                <td>
                  <Tex>{'(1-p)'}</Tex> 近似
                </td>
                <td>
                  <Tex>{String.raw`\tfrac{1-p}{2\pi}f_u`}</Tex>
                </td>
                <td className="num">{(EX.f3dbOneMinusP / 1e3).toFixed(4)}</td>
                <td className="num">{relPct(EX.f3dbOneMinusP, EX.f3dbExact)}%</td>
                <td>
                  <ClaimTag kind="approx" />
                </td>
              </tr>
              <tr>
                <td>one-sided ENBW（積分用）</td>
                <td>
                  <Tex>{String.raw`\tfrac{f_u}{2}\cdot\tfrac{1-p}{1+p}`}</Tex>
                </td>
                <td className="num">{(EX.enbw / 1e3).toFixed(4)}</td>
                <td className="num">
                  <Tex>{`\\times${(EX.enbw / EX.f3dbExact).toFixed(4)}`}</Tex>
                </td>
                <td>
                  <ClaimTag kind="exact" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          其中 <Tex>{String.raw`f_u=f_s/N=4\ \mathrm{GHz}/4096=${sig(EX.fu / 1e3, 7)}\ \mathrm{kHz}`}</Tex>、<Tex>{`p=${sig(EX.p, 8)}`}</Tex>（T14）。
          「約 12.9 kHz」只和 exact 與 <Tex>{String.raw`-\ln p`}</Tex> 吻合；<Tex>{'(1-p)'}</Tex> 版是 {(EX.f3dbOneMinusP / 1e3).toFixed(2)} kHz（差{' '}
          {relPct(EX.f3dbOneMinusP, EX.f3dbExact, 2)}%）<Erratum id="E26" />。
        </p>
      </Section>

      <Section kind="formula" title="Exact discrete-time −3 dB：一步一步解出來" level={3}>
        <Steps
          title={md(String.raw`解 $|H(e^{j\Omega})|^2=\tfrac12|H(1)|^2$`)}
          steps={[
            { tex: String.raw`|H(e^{j\Omega})|^2=\frac{\mu^2}{1-2p\cos\Omega+p^2},\qquad |H(1)|^2=\frac{\mu^2}{(1-p)^2}`, why: md(String.raw`上一節的結果；$\Omega=0$ 時分母是 $(1-p)^2$。`) },
            { tex: String.raw`\frac{\mu^2}{1-2p\cos\Omega+p^2}=\frac12\cdot\frac{\mu^2}{(1-p)^2}`, why: md('「−3 dB」= 功率降到一半（$10\\log_{10}\\tfrac12=-3.0103$ dB）。') },
            { tex: String.raw`1-2p\cos\Omega+p^2=2(1-p)^2`, why: md(String.raw`兩邊取倒數、消去 $\mu^2$。`) },
            { tex: String.raw`\cos\Omega=\frac{1+p^2-2(1-p)^2}{2p}=1-\frac{(1-p)^2}{2p}`, why: md(String.raw`移項；把 $1+p^2=(1-p)^2+2p$ 代入化簡。`) },
            { tex: String.raw`1-\cos\Omega=2\sin^2\frac{\Omega}{2}=\frac{(1-p)^2}{2p}`, why: md(String.raw`半角公式 $1-\cos\Omega=2\sin^2(\Omega/2)$。`) },
            { tex: String.raw`\sin\frac{\Omega_{3\mathrm{dB}}}{2}=\frac{1-p}{2\sqrt p}`, why: md(String.raw`開根號（$0<p<1$，取正值）。這個寫法在 $p\to1$ 時比 $\arccos$ 數值穩定。`) },
            {
              tex: String.raw`f_{3\mathrm{dB}}=\frac{\Omega_{3\mathrm{dB}}}{2\pi}f_u=\frac{f_u}{\pi}\arcsin\frac{1-p}{2\sqrt p}=${sig(EX.f3dbExact, 7)}\ \mathrm{Hz}`,
              why: md(String.raw`$\Omega$ 是 rad/block，乘 $f_u/(2\pi)$ 換成 Hz。`),
            },
          ]}
        />
        <TexBlock id="F-12.7" label="exact −3 dB">
          {String.raw`\boxed{\Omega_{3\mathrm{dB}}=2\arcsin\frac{1-p}{2\sqrt p}=\arccos\!\Big(1-\frac{(1-p)^2}{2p}\Big),\qquad 3-2\sqrt2\le p<1}`}
        </TexBlock>
        <p>
          {md(
            String.raw`F-12.7 後面的範圍 $3-2\sqrt2\le p<1$ 不是裝飾：pole 落在別的區域時，這個濾波器根本不是「會掉 3 dB 的 low-pass」。先用下面的流程判斷型態，再決定哪一種頻寬有意義（網站程式 bwRegime() 對 $p$ 的判斷就是這個順序）：`,
          )}
        </p>
        <Diagram chart={CHART_BW_REGIME} caption={String.raw`先用 pole $p=1-\mu K$ 判斷濾波器的型態，再決定能不能報頻寬。只有最下面綠色那一格可以報精確的 $-3$ dB 頻率。`}>
          <p>
            {md(
              String.raw`先由上往下問四個問題：是不是不穩定、是不是 high-pass、是不是完全平的、衰減夠不夠 3 dB。再看四個紅色出口：它們都不能報 $-3$ dB 頻寬，但近似公式在這些區域仍然會算出一個數字，這正是要小心的地方。`,
            )}
          </p>
          <p>
            {md(
              String.raw`和公式的對照：圖上最後一個判斷 $p\ge3-2\sqrt2$ 就是 F-12.7 的存在範圍；括號裡用迴路增益 $\mu K=1-p$ 寫的條件是同一件事。下面的推導說明 $3-2\sqrt2$ 這個數怎麼來。`,
            )}
          </p>
        </Diagram>
        <Steps
          title="它在什麼時候存在？"
          steps={[
            { tex: String.raw`\frac{1-p}{2\sqrt p}\le1`, why: md(String.raw`$\arcsin$ 的引數不能超過 1（等價地：Nyquist 處仍高於一半功率就沒有 −3 dB 點）。`) },
            { tex: String.raw`(1-p)^2\le4p\iff p^2-6p+1\le0`, why: md('兩邊平方（皆非負）並展開。') },
            { tex: String.raw`3-2\sqrt2\le p\le3+2\sqrt2`, why: md(String.raw`二次式的兩根 $3\pm2\sqrt2$；與 $p<1$ 合併。`) },
            {
              tex: String.raw`p_{\min}=3-2\sqrt2=${sig(P_MIN_3DB, 6)}\iff \mu K\le2\sqrt2-2=${sig(2 * Math.SQRT2 - 2, 6)}`,
              why: md(String.raw`等價條件：DC 與 Nyquist 的增益比 $\big(\tfrac{1+p}{1-p}\big)^2\ge2$。`),
            },
          ]}
        />
        <Callout kind="warn" title="−3 dB 點不存在的區域（E27）">
          <Tex>{String.raw`0<p<3-2\sqrt2`}</Tex>：low-pass 但衰減不足 3 dB，網站顯示「−3 dB 點不存在」；<Tex>{'p=0'}</Tex>：flat；
          <Tex>{String.raw`-1<p<0`}</Tex>：high-pass，low-pass 的頻寬定義不適用；<Tex>{String.raw`|p|\ge1`}</Tex>：不穩定，不顯示頻寬。
          近似公式在這些區域仍會「給出數字」——這正是要警告的地方。<Erratum id="E27" />
        </Callout>
      </Section>

      <Section kind="formula" title="兩個近似從哪來、誤差多大" level={3}>
        <Prereq title="泰勒展開（對數、反正弦、負半次方）">
          <p>
            令 <Tex>{String.raw`\varepsilon=1-p`}</Tex>（很小）。<Tex>{String.raw`-\ln(1-\varepsilon)=\varepsilon+\tfrac{\varepsilon^2}{2}+\tfrac{\varepsilon^3}{3}+\cdots`}</Tex>；
            <Tex>{String.raw`\arcsin s=s+\tfrac{s^3}{6}+\cdots`}</Tex>；<Tex>{String.raw`(1-\varepsilon)^{-1/2}=1+\tfrac{\varepsilon}{2}+\tfrac{3\varepsilon^2}{8}+\cdots`}</Tex>。
          </p>
        </Prereq>
        <Steps
          title={md(String.raw`exact、$-\ln p$、$(1-p)$ 的關係`)}
          steps={[
            { tex: String.raw`\Omega_{3\mathrm{dB}}=2\arcsin\frac{\varepsilon}{2\sqrt{1-\varepsilon}}\approx\frac{\varepsilon}{\sqrt{1-\varepsilon}}`, why: md(String.raw`小角 $\arcsin s\approx s$（誤差 $\mathcal O(\varepsilon^3)$）。`) },
            { tex: String.raw`\frac{\varepsilon}{\sqrt{1-\varepsilon}}=\varepsilon+\frac{\varepsilon^2}{2}+\frac{3\varepsilon^3}{8}+\cdots`, why: md(String.raw`用 $(1-\varepsilon)^{-1/2}$ 的展開。`) },
            { tex: String.raw`-\ln p=\varepsilon+\frac{\varepsilon^2}{2}+\frac{\varepsilon^3}{3}+\cdots`, why: md(String.raw`與上一行的前兩項完全相同 ⇒ $-\ln p$ 是二階準確的近似。`) },
            { tex: String.raw`1-p=\varepsilon`, why: md(String.raw`只保留一階 ⇒ 相對誤差 $\approx-\varepsilon/2=-(1-p)/2$。`) },
            {
              tex: String.raw`\frac{f_{(1-p)}}{f_{3\mathrm{dB}}}-1=${relPct(EX.f3dbOneMinusP, EX.f3dbExact, 4)}\%\quad\text{vs}\quad-\frac{1-p}{2}=${sig((-(1 - EX.p) / 2) * 100, 4)}\%`,
              why: '本例數值核對（兩者只差高階項）。',
            },
            {
              tex: String.raw`\Omega_{3\mathrm{dB}}=2\Big(s+\frac{s^3}{6}+\cdots\Big)\Big|_{s=\frac{\varepsilon}{2\sqrt{1-\varepsilon}}}=\varepsilon+\frac{\varepsilon^2}{2}+\Big(\frac38+\frac1{24}\Big)\varepsilon^3+\cdots`,
              why: md(String.raw`把 $\arcsin$ 的三次項也留下：$2\cdot\tfrac{s^3}{6}=\tfrac{\varepsilon^3}{24}+\mathcal O(\varepsilon^4)$，所以 exact 的三次係數是 $\tfrac38+\tfrac1{24}=\tfrac5{12}$。`),
            },
            {
              tex: String.raw`\frac{-\ln p}{\Omega_{3\mathrm{dB}}}-1\approx\Big(\frac13-\frac5{12}\Big)\varepsilon^2=-\frac{(1-p)^2}{12}=${sig((-((1 - EX.p) ** 2) / 12) * 100, 3)}\%\quad\text{vs 實際}\ ${relPct(EX.f3dbNegLnP, EX.f3dbExact, 3)}\%`,
              why: md(String.raw`$-\ln p$ 的三次係數是 $\tfrac13$，與 exact 的 $\tfrac5{12}$ 差 $-\tfrac1{12}$ ⇒ 相對誤差是「二階小量」$-(1-p)^2/12$；剩下的差距來自四次以上的項。`),
            },
          ]}
        />
        <p>
          <strong>−ln p 的物理意義</strong>：若把每個 block 的衰減 <Tex>{'p'}</Tex> 看成連續時間指數衰減 <Tex>{String.raw`e^{-\omega_cT_u}`}</Tex>（<Tex>{String.raw`T_u=1/f_u`}</Tex>），
          則 <Tex>{String.raw`\omega_c=-f_u\ln p`}</Tex>，一階 RC 的 −3 dB 就是 <Tex>{String.raw`\omega_c/(2\pi)`}</Tex>——這就是 impulse-invariant 映射 <Tex>{String.raw`z=e^{sT_u}`}</Tex>。
          <ClaimTag kind="approx" />（需 <Tex>{String.raw`p\to1`}</Tex>）。
        </p>
        <TexBlock id="F-12.8" label="兩個近似">
          {String.raw`f_{3\mathrm{dB}}\approx\frac{-\ln p}{2\pi}f_u\ \ (\text{二階準確，誤差}\approx-\tfrac{(1-p)^2}{12})\qquad f_{3\mathrm{dB}}\approx\frac{1-p}{2\pi}f_u\ \ (\text{一階，誤差}\approx-\tfrac{1-p}{2})`}
        </TexBlock>
        <Hand id="HC-12.4">
          {md(
            String.raw`同一個 $p$ 用三種公式各算一次 $-3$ dB 頻率，親眼看它們差多少。換成 $p=0.5$ 再算：$(1-p)$ 版會低估約三成；換成 $p=0.1$，網站會告訴你為什麼 exact 解不存在。`,
          )}
        </Hand>
      </Section>

      <Section kind="formula" title="ENBW：積分雜訊時要用的「寬度」" level={3}>
        <p>
          想像一個理想的矩形濾波器：通帶高度等於 <Tex>{'|H(1)|^2'}</Tex>、寬度為 ENBW，讓<strong>白雜訊通過後的總功率</strong>與真實濾波器相同。這個寬度才是「noise bandwidth」。
        </p>
        <p>
          {md(
            String.raw`於是係數雜訊的變異數可以寫成「高度 × 寬度」：高度是 PSD 在低頻的位準 $S_w^{(1)}(0)$，寬度是 ENBW。把兩者各自由什麼決定畫出來，會發現一件重要的事——learning rate $\mu$ 只出現在寬度裡：`,
          )}
        </p>
        <Diagram chart={CHART_LEVEL_WIDTH} caption={String.raw`係數雜訊的變異數等於位準乘寬度，$\sigma_w^2=S_w^{(1)}(0)\cdot\mathrm{ENBW}$：位準由 comparator 的雜訊決定，寬度由學習率決定。`}>
          <p>
            {md(
              String.raw`先看由 comparator 雜訊開始的那一條（圖的左半）：輸入端雜訊的單邊 PSD $2\sigma_v^2/f_s$，乘上 1-bit 的代價 $\pi/2$、除以 $C^2$，就是係數雜訊在低頻的位準——裡面沒有 $\mu$，也沒有 $N$。再看右半那一條：$\mu$ 與 $N$ 只透過 $p=1-\mu K$ 和 $f_u=f_s/N$ 出現在寬度 ENBW 裡。最後看乘號：兩者相乘就是 $\sigma_w^2$。`,
            )}
          </p>
          <p>
            {md(
              String.raw`和公式的對照：圖上的「位準」是下面 F-12.19 的 $S_w^{(1)}(0)$，「寬度」是 F-12.9 的 ENBW，乘號之後的「面積」就是 F-12.9 後半的 $\sigma_w^2=S_w^{(1)}(0)\cdot\mathrm{ENBW}$。`,
            )}
          </p>
        </Diagram>
        <Steps
          title="One-sided ENBW 的封閉式"
          steps={[
            { tex: String.raw`\mathrm{ENBW}\equiv\frac{1}{|H(1)|^2}\int_0^{f_u/2}|H(e^{j2\pi f/f_u})|^2\,df`, why: md(String.raw`定義：把真實 $|H|^2$ 的面積換成等高矩形的寬度（單邊，$0\ldots f_u/2$）。`) },
            { tex: String.raw`\int_0^{f_u/2}S_w^{(1)}(f)\,df=\sigma_w^2`, why: md(String.raw`單邊 PSD 的面積就是變異數（$S^{(1)}=\tfrac{2}{f_u}S$，見 F-12.10）。`) },
            { tex: String.raw`S_w^{(1)}(f)=S_w^{(1)}(0)\,\frac{|H(e^{j2\pi f/f_u})|^2}{|H(1)|^2}`, why: md(String.raw`白色 $\eta$ 時，PSD 的形狀就是 $|H|^2$ 的形狀。`) },
            { tex: String.raw`\Rightarrow\ \sigma_w^2=S_w^{(1)}(0)\cdot\mathrm{ENBW}`, why: '代入定義。' },
            { tex: String.raw`S_w^{(1)}(0)=\frac{2}{f_u}\cdot\frac{\mu^2\sigma_\eta^2}{(1-p)^2}`, why: md(String.raw`$\Omega=0$ 的 DTFT PSD 乘 $2/f_u$。`) },
            { tex: String.raw`\mathrm{ENBW}=\frac{\sigma_w^2}{S_w^{(1)}(0)}=\frac{\mu^2\sigma_\eta^2}{1-p^2}\cdot\frac{f_u(1-p)^2}{2\mu^2\sigma_\eta^2}`, why: '相除。' },
            { tex: String.raw`=\frac{f_u}{2}\cdot\frac{(1-p)^2}{(1-p)(1+p)}=\frac{f_u}{2}\cdot\frac{1-p}{1+p}`, why: md(String.raw`$1-p^2=(1-p)(1+p)$，約掉一個 $(1-p)$。`) },
            {
              tex: String.raw`\frac{\mathrm{ENBW}}{f_{3\mathrm{dB}}}\xrightarrow{p\to1}\frac{f_u(1-p)/4}{f_u(1-p)/(2\pi)}=\frac{\pi}{2}`,
              why: md(String.raw`一階 low-pass 的經典結果；本例 $\mathrm{ENBW}/f_{3\mathrm{dB}}=${sig(EX.enbw / EX.f3dbExact, 5)}$。`),
            },
          ]}
        />
        <TexBlock id="F-12.9" label="ENBW 與積分雜訊">
          {String.raw`\boxed{\mathrm{ENBW}=\frac{f_u}{2}\cdot\frac{1-p}{1+p}=${sig(EX.enbw, 7)}\ \mathrm{Hz},\qquad \sigma_w^2=S_w^{(1)}(0)\cdot\mathrm{ENBW}}`}
        </TexBlock>
        <Steps
          title={md(String.raw`多看一步：低頻位準 $S_w^{(1)}(0)$ 與 $\mu$、$N$ 都無關`)}
          steps={[
            { tex: String.raw`S_w^{(1)}(0)=\frac{2}{f_u}\cdot\frac{\mu^2\sigma_\eta^2}{(1-p)^2}`, why: '上面推導的第五行。' },
            { tex: String.raw`=\frac{2}{f_u}\cdot\frac{\mu^2\cdot\tfrac1N}{(\mu K)^2}=\frac{2}{N f_u K^2}`, why: md(String.raw`代入 $1-p=\mu K$ 與 $\sigma_\eta^2=1/N$；$\mu^2$ 上下約掉。`) },
            { tex: String.raw`=\frac{2}{f_sK^2}`, why: md(String.raw`$Nf_u=f_s$：$N$ 也消失了。`) },
            {
              tex: String.raw`=\frac{2}{f_s}\cdot\frac{\pi\sigma_v^2}{2C^2}=\underbrace{\frac{\pi}{2}}_{\text{1-bit 的代價}}\cdot\underbrace{\frac{2\sigma_v^2}{f_s}}_{v\text{ 的單邊 PSD}}\cdot\frac{1}{C^2}`,
              why: md(String.raw`代入 $K=K_qC=\sqrt{2/\pi}\,C/\sigma_v$。白色 $v$（取樣率 $f_s$）的單邊 PSD 是 $2\sigma_v^2/f_s$（F-12.10）。`),
            },
            {
              tex: String.raw`=\frac{\pi\cdot(${sig(EX.input.sigmaV, 4)}\ \mathrm{fs})^2}{${sig(EX.input.C, 3)}^2\cdot ${sig(EX.input.fs, 2)}\ \mathrm{Hz}}=${sig(swDcClosed, 6)}\ \mathrm{fs^2/Hz}`,
              why: md(`本例數值；calLoop() 由第一行直接算出的值是 $${sig(EX.sw1Dc, 6)}$，兩者相同。`),
            },
          ]}
          result={String.raw`S_w^{(1)}(0)=\frac{\pi\sigma_v^2}{C^2f_s}`}
        />
        <TexBlock id="F-12.19" label="係數雜訊的低頻位準">
          {String.raw`\boxed{S_w^{(1)}(0)=\frac{2}{f_sK^2}=\frac{\pi}{2}\cdot\frac{2\sigma_v^2}{f_s}\cdot\frac{1}{C^2}=\frac{\pi\sigma_v^2}{C^2f_s}}\qquad\Rightarrow\qquad\sigma_w^2=\frac{\pi\sigma_v^2}{C^2f_s}\cdot\mathrm{ENBW}`}
        </TexBlock>
        <p>
          {md(
            String.raw`白話：在校正迴路的頻寬內，係數雜訊的 PSD 就是「comparator 輸入端的雜訊 PSD」除以 $C^2$，再乘上 1-bit 量化的代價 $\pi/2$（$\approx1.96$ dB，第 5 章的 $K_q$）。$\mu$ 改變的只有`,
          )}
          <strong>頻寬</strong>
          {md(
            String.raw`：$\mathrm{ENBW}=\tfrac{f_u}{2}\cdot\tfrac{\mu K}{2-\mu K}\approx\tfrac{\mu Kf_u}{4}\propto\mu$。所以 $\sigma_w^2=S_w^{(1)}(0)\cdot\mathrm{ENBW}\propto\mu$——這就是「$\sigma_w\propto\sqrt\mu$」的頻域解釋；$N$ 加大時位準不變、但 $f_u=f_s/N$ 變小讓 ENBW 變窄。`,
          )}{' '}
          <ClaimTag kind="exact" />
          {md(String.raw`（線性模型、白色 $\eta$、$\sigma_\eta^2=1/N$）`)}
        </p>
        <Callout kind="danger" title={md(String.raw`反面例子：把 $f_{3\mathrm{dB}}$ 當 Noise BW`)}>
          <Tex>{String.raw`\sqrt{S_w^{(1)}(0)\cdot f_{3\mathrm{dB}}}=${sig(wrongSigma, 5)}\ \mathrm{fs}`}</Tex>，比正確的 <Tex>{`${sig(EX.sigmaW, 5)}\\ \\mathrm{fs}`}</Tex> 低{' '}
          {((1 - wrongSigma / EX.sigmaW) * 100).toFixed(1)}%（變異數低估 {((1 - (wrongSigma / EX.sigmaW) ** 2) * 100).toFixed(1)}%）。所以本站<strong>絕不</strong>把
          <Tex>{String.raw`f_{3\mathrm{dB}}`}</Tex> 標成「Noise BW」。<Erratum id="E06" />
          <Erratum id="E10" />
        </Callout>
        <Hand id="HC-12.5">
          {md(
            String.raw`先算 ENBW，再乘上低頻位準 $S_w^{(1)}(0)$，看是不是剛好回到 $\sigma_w$；詳解最後一併列出「誤用 $f_{3\mathrm{dB}}$」會低估多少。換成你的 $p$、$\sigma_v$、$f_s$ 先自己算一次。`,
          )}
        </Hand>
      </Section>

      <Section kind="explore" title="程式碼比較：三種 −3 dB 定義 + ENBW" level={3}>
        <p>
          下面是網站實際執行的程式碼（<code>{PATH}</code>）。四個函式的輸入都是 <Tex>{'(p,f_u)'}</Tex>，差異只在標了「← 差異」的那幾行：
          exact 版多了一個<strong>存在範圍</strong>判斷；兩個近似版只差 <Tex>{'1-p'}</Tex> 與 <Tex>{'-\\ln p'}</Tex>；ENBW 是完全不同的物理量。
        </p>
        <CodeCompare
          layout="tabs"
          items={[
            { label: 'Exact −3 dB', source: calNoiseSrc, region: 'bwExact', path: PATH, note: String.raw`解 $|H|^2=\tfrac12|H(1)|^2$；$p<3-2\sqrt2$ 時回傳 NaN（E27）` },
            { label: '一階近似', source: calNoiseSrc, region: 'bwOneMinusP', path: PATH, note: String.raw`$\Omega_{3\mathrm{dB}}\approx1-p$：一階泰勒，誤差 $\approx-(1-p)/2$（E26）` },
            { label: '指數映射近似', source: calNoiseSrc, region: 'bwNegLnP', path: PATH, note: String.raw`$\Omega_{3\mathrm{dB}}\approx-\ln p$：等效連續時間 pole；二階準確，誤差 $\approx-(1-p)^2/12$` },
            { label: 'ENBW', source: calNoiseSrc, region: 'enbw', path: PATH, note: String.raw`$\mathrm{ENBW}=\tfrac{f_u}{2}\cdot\tfrac{1-p}{1+p}$：積分用的寬度，不是 −3 dB（E06）` },
          ]}
          caption={String.raw`四個函式都在 calLoop() 中被呼叫；T14 測試把它們與 Python golden 向量比對到相對誤差 $10^{-10}$。`}
        />
        <ModeGate min="research">
          <details className="ch12-fold">
            <summary>
              Python golden model（獨立實作：<code>bw_exact_3db_closed</code>、<code>enbw_one_sided_closed</code>、<code>simulate_block_sign_lms_bpsk</code>…）
            </summary>
            <CodeBlock
              source={pyNoiseSrc}
              lang="python"
              path="golden/lms_pll_golden/noise.py"
              title="noise.py（NumPy / SciPy）"
              caption={String.raw`TypeScript（calNoise.ts）與 Python 兩個獨立實作；Vitest 讀 golden/vectors/T13–T15.json 交叉比對（T13 絕對 $10^{-12}$、T14 相對 $10^{-10}$、T15 絕對 $10^{-9}$）。`}
            />
          </details>
        </ModeGate>
        <Plot
          title="正規化頻率響應與 −3 dB 線（block rate）"
          csvName="ch12-hnorm"
          height={300}
          xLog
          data={curves}
          layout={HNORM_LAYOUT}
          caption={md(
            String.raw`由 $|H|^2/|H(1)|^2=(1-p)^2/(1-2p\cos\Omega+p^2)$ 直接計算（block rate，橫軸 $f/f_u$）。$p=3-2\sqrt2$ 的曲線剛好在 Nyquist（$f/f_u=0.5$）碰到 −3 dB；$p=0.1$ 從未降到 −3 dB；$p=-0.3$ 是 high-pass（高頻反而變大）。`,
          )}
        />
        <div className="table-wrap">
          <table className="ch12-table">
            <thead>
              <tr>
                <th className="num">
                  <Tex>{String.raw`\mu K`}</Tex>
                </th>
                <th className="num">
                  <Tex>{'p'}</Tex>
                </th>
                <th>型態</th>
                <th className="num">
                  exact <Tex>{String.raw`f_{3\mathrm{dB}}/f_u`}</Tex>
                </th>
                <th className="num">
                  <Tex>{String.raw`(1-p)/(2\pi)`}</Tex>
                </th>
                <th className="num">
                  <Tex>{String.raw`-\ln p/(2\pi)`}</Tex>
                </th>
                <th className="num">
                  <Tex>{String.raw`\mathrm{ENBW}/f_u`}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              {regimeRows.map((r) => (
                <tr key={r.g} className={r.regime === 'lowpass' ? undefined : 'ch12-bad'}>
                  <td className="num">{r.g.toFixed(4)}</td>
                  <td className="num">{r.p.toFixed(4)}</td>
                  <td>{regimeLabel(r.regime)}</td>
                  <td className="num">{fmtR(r.exact)}</td>
                  <td className="num">{fmtR(r.omp)}</td>
                  <td className="num">{fmtR(r.nlp)}</td>
                  <td className="num">{fmtR(r.enbw)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ModeGate min="engineer">
          <p className="small muted">
            {md(
              String.raw`$\mu K=0.9$：近似公式仍輸出 $${sig(bw3dbOneMinusP(0.1, 1), 4)}\,f_u$，但 exact 解不存在——UI 若只顯示近似值會誤導。$p<0$（high-pass）時 $\mathrm{ENBW}/f_u>\tfrac12$：它以 DC 增益為參考，而 DC 正是 high-pass 增益最小的地方，所以「等效寬度」超過 Nyquist；$\sigma_w^2=S_w^{(1)}(0)\cdot\mathrm{ENBW}$ 仍然成立，但已不能稱為頻寬。$\mu K\ge2$ 時 ENBW 也不存在（沒有穩態）。`,
            )}
          </p>
        </ModeGate>
      </Section>
    </>
  )
}
