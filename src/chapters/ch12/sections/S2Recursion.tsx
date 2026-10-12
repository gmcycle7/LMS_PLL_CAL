import { useMemo } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import { Callout, ClaimTag, CodeBlock, ModeGate, Plot, Prereq, Section, Tex, TexBlock } from '@/components'
import calNoiseSrc from '@/simulation/models/calNoise.ts?raw'
import { calLoop, sigmaW2Colored, swDtft } from '@/simulation/models/calNoise'
import { Diagram, EX, EX_INPUT, Erratum, Hand, Steps, TWO_TAP, TWO_TAP_SMALL, md, sig } from '../common'
import { CHART_COEF_LOOP, CHART_COLORED_ETA, CHART_GMAC_LINEAR, CHART_PSD_FILTER, CHART_UPDATE_LOOP, CHART_VAR_LOOP } from '../diagrams'

const ACF_LAYOUT: Partial<Layout> = { xaxis: { title: { text: String.raw`lag $\ell$ [blocks]` } }, yaxis: { title: { text: String.raw`$R_w$ [$\mathrm{fs}^2$]` } } }

export function S2Recursion() {
  const tradeoff = useMemo(
    () =>
      [2.5, 5, 10, 20, 40].map((mu) => {
        const lp = calLoop({ ...EX_INPUT, mu })
        return { mu, lp }
      }),
    [],
  )
  const poisson = useMemo(() => {
    // 數值核對：(1/2π)∫ S_w dΩ = σ_w²（中點法）
    const n = 20000
    let s = 0
    for (let i = 0; i < n; i++) s += swDtft(-Math.PI + ((i + 0.5) * 2 * Math.PI) / n, EX.input.mu, EX.p, EX.sigmaEta2)
    return s / n
  }, [])
  const colored = useMemo(
    () =>
      [-0.5, 0, 0.5, 0.9].map((r) => {
        const s2 = sigmaW2Colored(EX.input.mu, EX.sigmaEta2, EX.p, r)
        // 數值核對：(1/2π)∫ S_w dΩ（colored S_η），中點法
        const n = 40000
        let acc = 0
        for (let i = 0; i < n; i++) acc += swDtft(-Math.PI + ((i + 0.5) * 2 * Math.PI) / n, EX.input.mu, EX.p, EX.sigmaEta2, r)
        return { r, factor: (1 + EX.p * r) / (1 - EX.p * r), sigmaW: Math.sqrt(s2), parseval: Math.sqrt(acc / n) }
      }),
    [],
  )
  const acf = useMemo<Data[]>(() => {
    const l = Array.from({ length: 61 }, (_, i) => i - 30)
    return [{ x: l, y: l.map((x) => EX.sigmaW2 * EX.p ** Math.abs(x)), name: String.raw`$R_w[\ell]$`, mode: 'lines+markers', marker: { size: 4 } }]
  }, [])
  // 入門課第 4 課的例子：同樣的 μ、σ_v，但 N = 10,000
  const lesson4 = useMemo(() => calLoop({ ...EX_INPUT, N: 10000 }), [])

  return (
    <>
      <Section kind="formula" title="§12.1 線性化：GMAC 輸出 = 恢復力 + 雜訊" level={3} id="ch12-linearize">
        <p>
          第 5 章已經知道：1-bit comparator 在雜訊下的平均輸出是一條 S 曲線，小訊號時近似直線，斜率 <Tex>{String.raw`K_q=\sqrt{2/\pi}/\sigma_v`}</Tex>。
          本章關心的是「收斂之後」：<Tex>{'w'}</Tex> 已經在固定點 <Tex>{'w^*'}</Tex> 附近，所以用相對固定點的偏差{' '}
          <Tex>{String.raw`\delta w_k=w_k-w^*`}</Tex> 來寫。
        </p>
        <p>
          {md(
            String.raw`GMAC 在一個 block 裡做的事，是把 $N$ 個 sample 的 $q[n]\,x[n]$（1-bit 判斷乘上 code）平均成一個數 $G_k$。這個數可以拆成兩部分：一部分正比於係數偏差、方向永遠是把係數拉回固定點（恢復力，斜率 $K=K_qC$）；另一部分是每個 block 都不一樣、平均為零的起伏 $\eta_k$（GMAC 雜訊）。下圖的兩個框分別是實際電路與拆開之後的等效模型；圖中的 $a$ 是真實的 DTC gain，也就是 LMS 要學的目標。`,
          )}
        </p>
        <Diagram chart={CHART_GMAC_LINEAR} caption={String.raw`線性化 GMAC 的兩個框：實際電路（每個 sample 做一次）與近最佳點時的等效模型（每個 block 一個值）。注意等效模型加法點上的負號：$G_k\approx-K\,\delta w_k+\eta_k$。`}>
          <p>
            {md(
              String.raw`先看「實際電路」的框：gain 誤差 $a-w_k$ 乘上 code，加上雜訊 $v[n]$ 得到 comparator 的輸入 $e[n]$——它就是 PD 的輸出，也是送進 loop filter 的同一個訊號；comparator 只留下正負號 $q[n]$，再乘一次 code，平均 $N$ 筆得到 $G_k$。再看「等效模型」的框：整個實際電路被換成「$\delta w_k$ 乘上 $K$、以負號進入加法點，再加上雜訊 $\eta_k$」。最後看兩個框匯合的那一格：只有在小訊號、近最佳點時，兩個 $G_k$ 的平均與變異數才近似相同——這就是 F-12.1 裡那個 $\approx$ 的意思。`,
            )}
          </p>
          <p>
            {md(
              String.raw`和公式的對照：圖上的「$\times K$」加上加法點的負號，就是下面 F-12.1 的 $-K\,\delta w_k$；圖上的 $\eta_k$ 就是公式裡的 $\eta_k$。實際電路第一格的 $a-w_k=-\delta w_k$ 說明負號的來源：$\delta w$ 的定義是 $w-w^*$，和誤差 $a-w$ 的方向相反。`,
            )}
          </p>
        </Diagram>
        <TexBlock id="F-12.1" label="線性化 GMAC">
          {String.raw`\boxed{G_k\approx -K\,\delta w_k+\eta_k,\qquad K=K_qC,\qquad \delta w_k=w_k-w^*}`}
        </TexBlock>
        <Callout kind="warn" title={md(String.raw`極性：$\delta w$ 與 §0 的 $\delta$ 相反`)}>
          全站 §0 約定 <Tex>{String.raw`\delta_k=a-w_k`}</Tex>；本章沿用規格 §12 的 <Tex>{String.raw`\delta w_k=w_k-w^*`}</Tex>，兩者極性相反、參考點也不同：
          <Tex>{String.raw`a-w_k=(a-w^*)-\delta w_k`}</Tex>。在 <Tex>{'w^*=a'}</Tex> 的對稱情況，<Tex>{String.raw`\delta_k=-\delta w_k`}</Tex>。
          <Erratum id="E33" />
        </Callout>
        <Prereq title="Gaussian 分布、標準常態 CDF 與 erf">
          <p>
            雜訊 <Tex>{String.raw`v\sim\mathcal N(0,\sigma_v^2)`}</Tex> 的機率密度是 <Tex>{String.raw`\frac{1}{\sqrt{2\pi}\sigma_v}e^{-v^2/(2\sigma_v^2)}`}</Tex>。
            <Tex>{String.raw`\Phi(z)=P(\mathcal N(0,1)\le z)`}</Tex>，且 <Tex>{String.raw`2\Phi(z)-1=\operatorname{erf}(z/\sqrt2)`}</Tex>。
            小 <Tex>{'z'}</Tex> 時泰勒一階：<Tex>{String.raw`\operatorname{erf}(z)\approx\frac{2}{\sqrt\pi}z`}</Tex>。
          </p>
        </Prereq>
        <Steps
          title={md(String.raw`由 1-bit 相關推出線性化 GMAC（$x=\pm1$、identity path $\times C$）`)}
          steps={[
            {
              tex: String.raw`e[n]=C\,(a-w_k)\,x[n]+v[n],\qquad q[n]=\operatorname{sign}(e[n])`,
              why: md(
                String.raw`comparator 取的是 PD 的輸出 $e[n]$。PD 量的是「DTC 延遲後的 reference edge 減 feedback edge」，$e[n]=t_{\mathrm{ref}}'[n]-t_{\mathrm{fb}}[n]$：feedback（divider）edge 早到 $a\,x[n]$，reference 端的 DTC 補償 $w_k\,x[n]$——它只能延遲、不能提前，所以是把自己的延遲從固定的基準 $T_0$ 縮短這麼多（$\tau_{\mathrm{DTC}}=T_0-w_k\,x[n]$；常數 $T_0$ 被 PLL 當成靜態相位偏移吸收）——剩下 gain 誤差 $a-w_k$ 乘上 code；經有效路徑 $C$，再加上雜訊（§0 約定）。補償不足（$w_k<a$、$x>0$）時 reference edge 還是太晚，$e$ 為正。`,
              ),
            },
            {
              tex: String.raw`q[n]\,x[n]=\operatorname{sign}\big(C(a-w_k)+v[n]x[n]\big)`,
              why: md(String.raw`因為 $|x|=1$，$\operatorname{sign}(e)\,x=\operatorname{sign}(e\,x)$；而 $v\,x$ 與 $v$ 同分布（Gaussian 對稱）。`),
            },
            {
              tex: String.raw`E[q\,x\mid w_k]=2\Phi\!\Big(\frac{C(a-w_k)}{\sigma_v}\Big)-1=\operatorname{erf}\!\Big(\frac{C(a-w_k)}{\sqrt2\,\sigma_v}\Big)`,
              why: md(String.raw`取 $+1$ 的機率是 $P(v>-C(a-w))=\Phi(C(a-w)/\sigma_v)$；期望值 $=(+1)P+(-1)(1-P)=2P-1$。`),
            },
            {
              tex: String.raw`E[q\,x\mid w_k]\approx\sqrt{\tfrac{2}{\pi}}\,\frac{C(a-w_k)}{\sigma_v}=K_qC\,(a-w_k)`,
              why: md(
                String.raw`泰勒一階 $\operatorname{erf}(z)\approx 2z/\sqrt\pi$，條件是 $|C(a-w)|\ll\sigma_v$（小訊號）。$|C(a-w)|$ 就是 comparator 看到的確定性訊號 $C(a-w)\,x[n]$ 的振幅（因為 $|x|=1$、path 無記憶）。`,
              ),
            },
            {
              tex: String.raw`a-w_k=(a-w^*)-\delta w_k\ \Rightarrow\ E[G_k\mid w_k]\approx-K\,\delta w_k\quad(w^*=a)`,
              why: md(String.raw`代入 $\delta w$ 的定義；對稱、無 bias 時固定點 $w^*=a$，常數項消失（有 bias 時常數項由 $w^*$ 吸收）。`),
            },
            {
              tex: String.raw`\eta_k\equiv G_k-E[G_k\mid w_k],\qquad E[\eta_k]=0`,
              why: '把 GMAC 輸出拆成「條件平均」+「剩下的零均值擾動」，這就是 F-12.1 的定義。',
            },
            {
              tex: String.raw`\sigma_\eta^2=\operatorname{Var}\Big(\frac1N\sum_{n}q\,x\Big)=\frac{1-m^2}{N}\approx\frac1N`,
              why: md(String.raw`$m=E[q\,x\mid w_k]$ 是 $q\,x$ 的條件平均（上面第三行的結果）。$(qx)^2=1\Rightarrow\operatorname{Var}(qx)=1-m^2$；$N$ 個獨立樣本平均，變異數除以 $N$；近平衡 $m\approx0$。`),
            },
          ]}
        />
        <p>
          <ClaimTag kind="approx" /> 這是小訊號、iid、Gaussian 的近似；<Tex>{'|C\\,\\delta w|'}</Tex> 必須遠小於 <Tex>{String.raw`\sigma_v`}</Tex>。本例{' '}
          <Tex>{`3\\sigma_w=${sig(3 * EX.sigmaW, 3)}\\ \\mathrm{fs}\\ll\\sigma_v=100\\ \\mathrm{fs}`}</Tex>，成立得非常好。條件依勘誤 <Erratum id="E30" /> 寫明：
          {md(String.raw`unit-RMS $\pm1$ code、identity path（$C=1$）、average-mode GMAC、白色 Gaussian $v$、近平衡 $\sigma_\eta^2\approx1/N$。`)}
        </p>
        <p>
          <strong>適用範圍。</strong>
          {md(
            String.raw`「小訊號」要看的是 comparator 前整個確定性殘差的大小。把 code 經過誤差路徑之後、在 comparator 前造成的訊號記成 $u[n]$（每 1 fs 的 gain 誤差造成多少 fs；第 6 章的 F-06.1），comparator 的輸入就是 $e[n]=(a-w)\,u[n]+v[n]$（path 有記憶時，還要 $w$ 在 path 的記憶長度內近似不變，這個寫法才成立）；本節 $w^*=a$、沒有 offset，確定性殘差是 $-\delta w\,u[n]$。本節的模型 $x=\pm1$、$u[n]=C\,x[n]$ 讓 $|u[n]|$ 永遠等於 $|C|$，所以條件才能只寫成 $|C\,\delta w|\ll\sigma_v$。如果 code 不是 $\pm1$，或 path 有記憶（comparator 前的訊號還含有前幾拍的 code，第 6、7 章），就不能這樣簡化。code 不是 $\pm1$ 時，$|u[n]|$ 跟著 $|x[n]|$ 變，不再是常數 $|C|$；path 有記憶時差得更多：$C=E[x\,u]$ 只量到 $u$ 裡面和 $x[n]$ 相關的那一部分，$C$ 小不代表 $u$ 小。兩種情況都要改看 $|\delta w|\,u_{\max}\ll\sigma_v$（$u_{\max}=\max_n|u[n]|$ 是 $u$ 的峰值；這是充分條件）。第 6 章的近整數 FCW 就是實例：$C\to0^+$，但 $u$ 的峰值並不小（§6.4、F-06.19）。`,
          )}
        </p>
        <ModeGate min="engineer">
          <Callout kind="warn" title={md(String.raw`反例：$|C\,\delta w|$ 很小，comparator 卻已經飽和`)}>
            <p>
              {md(
                String.raw`取 $\pm1$ iid code，path 有兩個 tap：$u[n]=${TWO_TAP.c0}\,x[n]+x[n-1]$（幾乎是整條路徑晚一個 sample）。$x[n]$ 與 $x[n-1]$ 獨立，所以 $C=E[x\,u]=${TWO_TAP.C}$；但 $u$ 的峰值 $u_{\max}=${sig(TWO_TAP.uMax, 4)}$。令 $\delta w=${TWO_TAP.dw}$ fs、$\sigma_v=${TWO_TAP.sigmaV}$ fs：$|C\,\delta w|=${sig(TWO_TAP.C * TWO_TAP.dw, 3)}$ fs $\ll\sigma_v$，照 F-12.1 的寫法是小訊號，$E[G]\approx-K\,\delta w=-K_qC\,\delta w=-${sig(TWO_TAP.K / TWO_TAP.C, 3)}\times${TWO_TAP.C}\times${TWO_TAP.dw}=${sig(TWO_TAP.linear, 3)}$。`,
              )}
            </p>
            <p>
              {md(
                String.raw`實際上 comparator 的輸入是 $-\delta w\,u[n]+v[n]\approx-${TWO_TAP.dw}\,x[n-1]+v[n]$（單位 fs）：確定性的部分是雜訊 RMS 的 $${sig(TWO_TAP.dw / TWO_TAP.sigmaV, 3)}$ 倍，$q[n]$ 幾乎完全由 $x[n-1]$ 決定，而 $x[n-1]$ 與 $x[n]$ 獨立，所以 $E[q\,x]\approx0$。把 $(x[n],x[n-1])$ 的四種組合各算一次 erf 再平均（記 $d=\delta w/(\sqrt2\,\sigma_v)$）：`,
              )}
            </p>
            <TexBlock>
              {String.raw`\begin{aligned}
E[G\mid\delta w]&=-\tfrac12\Big[\operatorname{erf}\big(${sig(TWO_TAP.c1 + TWO_TAP.c0, 4)}\,d\big)-\operatorname{erf}\big(${sig(TWO_TAP.c1 - TWO_TAP.c0, 4)}\,d\big)\Big]=${sig(TWO_TAP.exact, 4)}\\
&\approx-K\,\delta w\,e^{-\delta w^2/(2\sigma_v^2)}=${sig(TWO_TAP.gauss, 4)}
\end{aligned}`}
            </TexBlock>
            <p>
              {md(
                String.raw`第二行的近似：兩個 erf 的引數只差 $${sig(2 * TWO_TAP.c0, 3)}\,d$，差值約等於 erf 在 $d$ 的斜率 $\tfrac{2}{\sqrt\pi}e^{-d^2}$ 乘上這個差。結果只有 F-12.1 預測值的 $${sig(TWO_TAP.ratio, 3)}$ 倍：恢復力等於消失。斜率 $K=K_qC$ 本身沒有錯（$\delta w\to0$ 時仍然成立），錯的是適用範圍：這條 path 要 $|\delta w|\,u_{\max}\ll\sigma_v$，也就是 $|\delta w|\ll1$ fs 才是線性，$\delta w=1$ fs 時恢復力已經只剩線性值的 $${sig(TWO_TAP.at1, 3)}$ 倍。用整個波形的判據一眼就看得出來：$|\delta w|\,u_{\max}=${sig(TWO_TAP.dw * TWO_TAP.uMax, 4)}$ fs $\gg\sigma_v$。任意大小偏差的完整 erf 平均是第 6 章的 F-06.19。`,
              )}
            </p>
          </Callout>
        </ModeGate>
        <ModeGate min="research">
          <p>
            <strong>判據的量化。</strong>
            {md(
              String.raw`$\pm1$ iid code、FIR path $u[n]=\sum_{m\ge0}h_m\,x[n-m]$（所以 $C=E[x\,u]=h_0$）：把 erf 多展開一階，$\operatorname{erf}(z)\approx\tfrac{2}{\sqrt\pi}\big(z-z^3/3\big)$，再對 code 平均，用到 $E[x\,u]=h_0$ 與 $E[x\,u^3]=h_0\big(h_0^2+3\sum_{m\ge1}h_m^2\big)$：`,
            )}
          </p>
          <TexBlock>
            {String.raw`E[G\mid\delta w]\approx-K\,\delta w\,\Big[1-\frac{\delta w^2}{6\sigma_v^2}\Big(h_0^2+3\sum_{m\ge1}h_m^2\Big)\Big],\qquad K=K_q\,h_0`}
          </TexBlock>
          <p>
            {md(
              String.raw`方括號裡的第二項是線性化的相對誤差（首項）。決定它大小的是 $h_0^2+3\sum_{m\ge1}h_m^2=3E[u^2]-2C^2$（$E[u^2]=\sum_{m\ge0}h_m^2$ 是 $u$ 的功率），不是只有 $C$：無記憶 path 時相對誤差是 $-(C\,\delta w)^2/(6\sigma_v^2)$，條件就是本節的 $|C\,\delta w|\ll\sigma_v$；有記憶時，後面那些 tap 帶進來的 code 和 $x[n]$ 獨立，不貢獻斜率，卻以三倍的權重把 comparator 推向飽和。上面反例的 path 在 $\delta w=${TWO_TAP_SMALL.dw}$ fs、$\sigma_v=${TWO_TAP.sigmaV}$ fs 時，首項是 $${sig(TWO_TAP_SMALL.lead, 3)}$（完整的 erf 平均給出的相對誤差是 $${sig(TWO_TAP_SMALL.exact, 3)}$）；同樣的 $\delta w$ 換成無記憶的 $u=${TWO_TAP.c0}\,x$，只有 $${sig(TWO_TAP_SMALL.scalarLead, 2)}$。這個展開也只在 $|\delta w|\,u_{\max}\lesssim\sigma_v$ 內有意義：把反例的 $\delta w=${TWO_TAP.dw}$ fs 代進去，首項是 $${sig(TWO_TAP_SMALL.leadAtCounterexample, 3)}$，早就不能用；更大的偏差要用 F-06.19 的完整平均。`,
            )}
          </p>
        </ModeGate>
      </Section>

      <Section kind="formula" title="§12.1 係數誤差的遞迴" level={3} id="ch12-recursion">
        <p>
          {md(
            String.raw`LMS 的更新是一個累加器：每個 block 把 $\mu G_k$ 加到係數上。把上一張圖的等效模型接到累加器前面，就得到一個有回授的迴圈——係數偏差越大，GMAC 給出的修正越大，方向相反。`,
          )}
        </p>
        <Diagram chart={CHART_UPDATE_LOOP} caption={String.raw`係數更新迴圈有兩個加法點：一個是累加器 $\delta w_{k+1}=\delta w_k+\mu G_k$，一個是 GMAC 的恢復力 $G_k=\eta_k-K\,\delta w_k$。先找到它們，再看兩條回授線各帶什麼符號。`}>
          <p>
            {md(
              String.raw`先看輸出直接送進延遲方塊 $z^{-1}$ 的那個加法點：這是累加器，下一個 block 的偏差 $\delta w_{k+1}$ 等於舊的偏差 $\delta w_k$ 加上 $\mu G_k$；延遲方塊把 $\delta w_{k+1}$ 留到下一個 block 才變成 $\delta w_k$。再看 $\eta_k$ 進入的那個加法點：$G_k$ 由雜訊 $\eta_k$ 減去 $K\,\delta w_k$ 得到，這條帶負號的回授線就是恢復力。`,
            )}
          </p>
          <p>
            {md(
              String.raw`和公式的對照：圖上的兩條回授線合起來就是下面推導最後一行的係數 $(1-\mu K)$——累加器那一條貢獻 $1$，恢復力那一條繞經 $\times K$、加法點的負號與 $\times\mu$，貢獻 $-\mu K$。圖上的 $\eta_k$ 經過加法點再乘上 $\mu$，就是公式裡的 $\mu\eta_k$。`,
            )}
          </p>
        </Diagram>
        <Steps
          title={md(String.raw`由更新式推出 $\delta w$ 的遞迴`)}
          steps={[
            { tex: String.raw`w_{k+1}=w_k+\mu G_k`, why: md(String.raw`Block Sign-LMS 的更新（average-mode，$\mu$ 的單位是 fs）。`) },
            { tex: String.raw`w_{k+1}-w^*=(w_k-w^*)+\mu G_k`, why: md(String.raw`兩邊同減常數 $w^*$。`) },
            { tex: String.raw`\delta w_{k+1}=\delta w_k+\mu\big(-K\delta w_k+\eta_k\big)`, why: md(String.raw`代入 $\delta w$ 的定義與 F-12.1。`) },
            { tex: String.raw`\delta w_{k+1}=(1-\mu K)\,\delta w_k+\mu\eta_k`, why: md(String.raw`把含 $\delta w_k$ 的項合併。`) },
          ]}
          result={String.raw`\delta w_{k+1}=p\,\delta w_k+\mu\eta_k,\qquad p=1-\mu K`}
        />
        <TexBlock id="F-12.2" label="係數誤差遞迴">
          {String.raw`\delta w_{k+1}=p\,\delta w_k+\mu\eta_k,\qquad p=1-\mu K=${sig(EX.p, 6)}\ (\text{本例})`}
        </TexBlock>
        <p>
          白話：每個 block，舊的偏差只留下 <Tex>{'p'}</Tex> 倍（被 LMS 拉回），再被新的 GMAC 雜訊推一下 <Tex>{String.raw`\mu\eta_k`}</Tex>。
          若改用 §0 的 <Tex>{String.raw`\delta=a-w`}</Tex>（<Tex>{'w^*=a'}</Tex> 時），遞迴變成 <Tex>{String.raw`\delta_{k+1}=p\delta_k-\mu\eta_k`}</Tex>：
          pole 相同、雜訊項變號，變異數完全一樣，但與直接 PD 路徑做 cross-spectrum 時相關係數會反號（E33）。
        </p>
      </Section>

      <Section kind="formula" title="§12.2 Z-transform：把遞迴變成轉移函數" level={3} id="ch12-ztransform">
        <Prereq title="Z-transform、延遲、等比級數">
          <p>
            數列 <Tex>{'x_0,x_1,x_2,\\dots'}</Tex> 的 Z-transform 是把它「編碼」成一個冪級數：<Tex>{String.raw`X(z)=\sum_{k\ge0}x_kz^{-k}`}</Tex>。
            <Tex>{String.raw`z^{-1}`}</Tex> 代表「晚一個 block」。
          </p>
          <ul>
            <li>
              <strong>超前一步</strong>：<Tex>{String.raw`\sum_k x_{k+1}z^{-k}=z\sum_k x_{k+1}z^{-(k+1)}=z\,(X(z)-x_0)`}</Tex>。
            </li>
            <li>
              <strong>等比級數</strong>：<Tex>{String.raw`\sum_{m\ge0}r^m=\frac1{1-r}`}</Tex>（<Tex>{'|r|<1'}</Tex>）。令 <Tex>{String.raw`r=pz^{-1}`}</Tex>：
              <Tex>{String.raw`\frac{1}{1-pz^{-1}}=\sum_{m\ge0}p^mz^{-m}`}</Tex>，也就是「數列 <Tex>{'p^m'}</Tex>」的 Z-transform。
            </li>
            <li>
              <strong>頻率響應</strong>：在單位圓上取 <Tex>{String.raw`z=e^{j\Omega}`}</Tex>，<Tex>{String.raw`\Omega`}</Tex>（rad/block）就是離散頻率；
              <Tex>{String.raw`\Omega=2\pi f/f_u`}</Tex>，<Tex>{String.raw`\Omega=\pi`}</Tex> 對應 Nyquist <Tex>{'f_u/2'}</Tex>。
            </li>
            <li>
              <strong>Pole</strong>：讓分母為 0 的 <Tex>{'z'}</Tex>。單一 pole <Tex>{'p'}</Tex> 的脈衝響應是 <Tex>{'p^k'}</Tex>，<Tex>{'|p|<1'}</Tex> 才會衰減（穩定）。
            </li>
          </ul>
        </Prereq>
        <p>
          {md(
            String.raw`上一節的兩條回授線可以合併成一條「乘上 $p$」。這樣整個校正迴路就是一個最簡單的一階迴圈：輸入是 $\mu\eta_k$，輸出是係數偏差。把這個迴圈整個包成一個方塊，就是雜訊到係數的轉移函數 $H_{\eta\to w}(z)$。`,
          )}
        </p>
        <Diagram chart={CHART_COEF_LOOP} caption={String.raw`一階係數雜訊迴圈 $\delta w_{k+1}=p\,\delta w_k+\mu\eta_k$：上面是時域的迴圈，下面是同一件事寫成一個方塊 $H(z)=\mu/(z-p)$。先看延遲方塊在迴圈的哪裡。`}>
          <p>
            {md(
              String.raw`先看「時域」的框：輸入 $\eta_k$ 乘上 $\mu$ 後進加法點；加法點的輸出是 $\delta w_{k+1}$，要經過 $z^{-1}$（延遲一個 block）才變成 $\delta w_k$，所以 $\eta_k$ 最快也要下一個 block 才影響係數。回授線把 $\delta w_k$ 乘上 $p$ 送回加法點。再看「z 域」的框：整個迴圈被包成一個方塊 $H(z)$。`,
            )}
          </p>
          <p>
            {md(
              String.raw`和公式的對照：加法點寫成式子就是 F-12.2 的 $\delta w_{k+1}=p\,\delta w_k+\mu\eta_k$。圖上從輸入到輸出的直線路徑（$\times\mu$ 再延遲）是 F-12.3 的分子 $\mu z^{-1}$；繞一圈的回授（$\times p$ 再延遲）是分母的 $1-pz^{-1}$。`,
            )}
          </p>
        </Diagram>
        <Steps
          title={md(String.raw`$H_{\eta\to w}(z)$ 一步一步`)}
          steps={[
            { tex: String.raw`W(z)=\sum_{k\ge0}\delta w_kz^{-k},\qquad E(z)=\sum_{k\ge0}\eta_kz^{-k}`, why: '定義兩個數列的 Z-transform。' },
            { tex: String.raw`\sum_k\delta w_{k+1}z^{-k}=p\,W(z)+\mu E(z)`, why: md(String.raw`遞迴式兩邊乘 $z^{-k}$ 再對 $k$ 求和（線性）。`) },
            { tex: String.raw`\sum_k\delta w_{k+1}z^{-k}=z\big(W(z)-\delta w_0\big)`, why: '同一個左邊，用「超前一步」性質改寫。' },
            { tex: String.raw`(z-p)\,W(z)=\mu E(z)`, why: md(String.raw`上兩行的右邊相等：$zW-z\,\delta w_0=pW+\mu E$；忽略初始狀態 $\delta w_0=0$（只看穩態雜訊傳遞），再移項。`) },
            { tex: String.raw`H_{\eta\to w}(z)=\frac{W(z)}{E(z)}=\frac{\mu}{z-p}`, why: '轉移函數 = 輸出 / 輸入。' },
            { tex: String.raw`\frac{\mu}{z-p}=\frac{\mu z^{-1}}{1-pz^{-1}}=\mu z^{-1}\sum_{m\ge0}p^mz^{-m}`, why: md(String.raw`分子分母同除以 $z$，再用等比級數展開（$|z|>|p|$）。`) },
            { tex: String.raw`h_k=\mu\,p^{k-1}\quad(k\ge1),\qquad h_0=0`, why: md(String.raw`讀出 $z^{-k}$ 的係數：先延遲一個 block（$\eta_k$ 下一個 block 才影響 $w$），之後以 $p^k$ 衰減。`) },
          ]}
        />
        <TexBlock id="F-12.3" label="雜訊 → 係數">
          {String.raw`\boxed{H_{\eta\to w}(z)=\frac{\mu}{z-p}=\frac{\mu z^{-1}}{1-pz^{-1}}}`}
        </TexBlock>
        <p>
          {md(
            String.raw`接下來把 $z$ 換成 $e^{j\Omega}$，看這個方塊對不同頻率的增益。$\Omega$ 是以 block 為單位的離散頻率（rad/block）：$\Omega=2\pi f/f_u$，其中 $f_u=f_s/N$ 是 block update rate；$\Omega=0$ 是 DC，$\Omega=\pi$ 是 block rate 的 Nyquist 頻率 $f_u/2$。`,
          )}
        </p>
        <Steps
          title={md(String.raw`在單位圓上的大小 $|H(e^{j\Omega})|^2$`)}
          steps={[
            { tex: String.raw`|H(e^{j\Omega})|^2=\frac{\mu^2}{|e^{j\Omega}-p|^2}`, why: md(String.raw`代入 $z=e^{j\Omega}$；$|\mu|^2=\mu^2$。`) },
            { tex: String.raw`|e^{j\Omega}-p|^2=(\cos\Omega-p)^2+\sin^2\Omega`, why: md(String.raw`Euler 公式 $e^{j\Omega}=\cos\Omega+j\sin\Omega$；複數 $a+jb$ 的絕對值平方是 $a^2+b^2$（實部平方加虛部平方）。`) },
            { tex: String.raw`=1-2p\cos\Omega+p^2`, why: md(String.raw`展開並用 $\cos^2\Omega+\sin^2\Omega=1$。`) },
            { tex: String.raw`|e^{j\Omega}-p|=|e^{-j\Omega}|\,|e^{j\Omega}-p|=|1-pe^{-j\Omega}|`, why: md(String.raw`$|e^{-j\Omega}|=1$，所以規格寫的 $|1-pe^{-j\Omega}|$ 是同一個量。`) },
            {
              tex: String.raw`|H(1)|=\frac{\mu}{1-p}=${sig(EX.input.mu / (1 - EX.p), 4)}\ \mathrm{fs},\qquad |H(-1)|=\frac{\mu}{1+p}=${sig(EX.input.mu / (1 + EX.p), 4)}\ \mathrm{fs}`,
              why: md(String.raw`$\Omega=0$（DC）與 $\Omega=\pi$（Nyquist）的值；$0<p<1$ 時 DC 大、Nyquist 小 ⇒ low-pass。`),
            },
          ]}
        />
      </Section>

      <Section kind="formula" title="§12.3 係數雜訊的 PSD" level={3} id="ch12-psd">
        <Prereq title={String.raw`自相關、PSD 與「濾波器把 PSD 乘上 $|H|^2$」`}>
          <p>
            廣義平穩（WSS）序列的<strong>自相關</strong> <Tex>{String.raw`R[\ell]=E[x_kx_{k+\ell}]`}</Tex> 只跟間隔 <Tex>{String.raw`\ell`}</Tex> 有關。
            <strong>PSD</strong> 是它的 DTFT：<Tex>{String.raw`S(e^{j\Omega})=\sum_\ell R[\ell]e^{-j\Omega\ell}`}</Tex>；反過來
            <Tex>{String.raw`R[\ell]=\frac1{2\pi}\int_{-\pi}^{\pi}S\,e^{j\Omega\ell}d\Omega`}</Tex>，特別是 <Tex>{String.raw`\sigma^2=R[0]=\frac1{2\pi}\int S\,d\Omega`}</Tex>。
          </p>
          <p>
            <strong>白雜訊</strong>：<Tex>{String.raw`R[\ell]=\sigma^2\delta[\ell]`}</Tex> ⇒ <Tex>{String.raw`S=\sigma^2`}</Tex>（平的）。
            <strong>濾波</strong>：<Tex>{String.raw`y=h*x`}</Tex> ⇒ <Tex>{String.raw`R_y[\ell]=\sum_{i,j}h_ih_jR_x[\ell+i-j]`}</Tex>，取 DTFT 後 <Tex>{String.raw`S_y=|H(e^{j\Omega})|^2S_x`}</Tex>。
          </p>
        </Prereq>
        <p>
          {md(
            String.raw`$S_w(e^{j\Omega})$ 是係數偏差 $\delta w$ 的功率頻譜密度（PSD）：它說明變異數在各個頻率上怎麼分布。GMAC 雜訊 $\eta$ 在 block 之間互相獨立，所以它的 PSD $S_\eta$ 是平的（白色）；通過上一節的方塊之後，每個頻率被乘上 $|H|^2$。`,
          )}
        </p>
        <Diagram chart={CHART_PSD_FILTER} caption={String.raw`白雜訊通過一階 low-pass，$S_w=|H|^2S_\eta$：輸入是平的，輸出低頻高、高頻低，曲線下的面積就是係數雜訊的變異數 $\sigma_w^2$。`}>
          <p>
            {md(
              String.raw`先由上往下看主線：平的 $S_\eta$ 乘上 $|H|^2$ 得到 $S_w$。再看掛在濾波器旁邊的兩個註記：$0<p<1$ 時 DC 的增益 $\mu^2/(1-p)^2$ 比 Nyquist 的 $\mu^2/(1+p)^2$ 大，所以輸出是 low-pass。最後看主線的最後兩格：把 $S_w$ 對 $\Omega$ 由 $-\pi$ 積到 $\pi$ 再除以 $2\pi$，就是下一小節的 $\sigma_w^2$。`,
            )}
          </p>
          <p>{md(String.raw`和公式的對照：圖上的「$\times|H|^2$」就是 F-12.4 的分式 $\mu^2/|1-pe^{-j\Omega}|^2$；主線終點的 $\sigma_w^2$ 是 F-12.5。`)}</p>
        </Diagram>
        <Steps
          title={md(String.raw`$S_w=|H|^2S_\eta$`)}
          steps={[
            { tex: String.raw`\delta w_k=\sum_{i\ge1}h_i\,\eta_{k-i}`, why: md(String.raw`穩態下 $\delta w$ 是 $\eta$ 經過濾波器 $h$（卷積）。`) },
            { tex: String.raw`S_w(e^{j\Omega})=|H_{\eta\to w}(e^{j\Omega})|^2S_\eta(e^{j\Omega})`, why: md(String.raw`「濾波器把 PSD 乘上 $|H|^2$」。`) },
            { tex: String.raw`=\frac{\mu^2S_\eta}{1-2p\cos\Omega+p^2}`, why: md(String.raw`代入上一節的 $|H|^2$。`) },
            { tex: String.raw`S_\eta=\sigma_\eta^2\ \Rightarrow\ S_w(e^{j\Omega})=\frac{\mu^2\sigma_\eta^2}{1-2p\cos\Omega+p^2}`, why: md(String.raw`$\eta$ 為 iid（白色）時 PSD 是常數 $\sigma_\eta^2$。`) },
          ]}
        />
        <TexBlock id="F-12.4" label="block-rate 係數 PSD">
          {String.raw`\boxed{S_w(e^{j\Omega})=\frac{\mu^2}{|1-pe^{-j\Omega}|^2}S_\eta(e^{j\Omega})}\qquad\Omega=2\pi f/f_u\ \ (\text{rad/block})`}
        </TexBlock>
        <Callout kind="info" title="注意取樣率與單位">
          這個 PSD 定義在 <strong>block rate</strong> <Tex>{String.raw`f_u=f_s/N=${sig(EX.fu / 1e3, 7)}\ \mathrm{kHz}`}</Tex>，<Tex>{String.raw`\Omega`}</Tex> 的單位是 rad/block。
          之後要乘上 sample-rate 的 code 時，必須先轉換（§12.6、<Erratum id="E29" />）。
          {md(
            String.raw`單位：這個 DTFT 形式的 $S_w$ 要「對 $\Omega$ 積分再除以 $2\pi$」才是變異數（$\sigma_w^2=\tfrac1{2\pi}\int_{-\pi}^{\pi}S_w\,d\Omega$），等於對 $\Omega/2\pi$（每個 block 轉幾圈，cycle/block）積分，所以它是「每 cycle/block」的密度，單位 $\mathrm{fs}^2/(\text{cycle/block})$；它不是每 rad/block 的密度——能直接對 $\Omega$ 積分的是 $S_w/(2\pi)$，本站不用。`,
          )}
          {md(
            String.raw`下面的手算題與 §12.5 會用到「單邊、每 Hz」的版本 $S_w^{(1)}(f)=\tfrac{2}{f_u}S_w(e^{j2\pi f/f_u})$：上標 $(1)$ 表示 one-sided，單位是 $\mathrm{fs}^2/\mathrm{Hz}$，對 $f$ 從 $0$ 積到 $f_u/2$ 就是變異數（換算的推導在 §12.6 的 F-12.10）。`,
          )}
        </Callout>
        <Hand id="HC-12.2">
          {md(
            String.raw`挑一個頻率 $f$，把 $e^{j\Omega}-p$ 拆成實部與虛部，親手算出這一點的 $|H|^2$ 比 DC 低幾 dB、$S_w^{(1)}(f)$ 是多少。預設的 $f$ 是本例的 exact $-3$ dB 頻率——先猜答案應該是多少 dB，再動手算。`,
          )}
        </Hand>
      </Section>

      <Section kind="formula" title="§12.4 穩態變異：兩種推導" level={3} id="ch12-variance">
        <p>
          {md(
            String.raw`係數抖動的大小 $\sigma_w^2$ 可以不經過頻域直接算：把「變異數」$V_k=E[\delta w_k^2]$ 自己當成一個訊號，它也繞著一個一階迴圈轉——每個 block 舊的變異只留下 $p^2$ 倍，同時被 GMAC 雜訊注入固定的一份 $\mu^2\sigma_\eta^2$。`,
          )}
        </p>
        <Diagram chart={CHART_VAR_LOOP} caption={String.raw`變異數自己的迴圈 $V_{k+1}=p^2V_k+\mu^2\sigma_\eta^2$：每個 block 注入固定的量、留下固定的比例，穩態就是注入的等於漏掉的。`}>
          <p>
            {md(
              String.raw`先看加法點的兩個輸入：一個是每個 block 新注入的 $\mu^2\sigma_\eta^2$，另一個是回授線帶回來的舊變異乘上 $p^2$。再看延遲方塊之後的兩格：穩態時 $V$ 不再變，把 $V_{k+1}=V_k=V$ 代進加法點的式子，就解出 $\sigma_w^2$。`,
            )}
          </p>
          <p>
            {md(
              String.raw`和公式的對照：加法點就是推導 A 第五行的 $V_{k+1}=p^2V_k+\mu^2\sigma_\eta^2$（也是章首手算表用的式子）；圖上的「$\times p^2$」是 $p^2V_k$，注入量是第二項；綠色那一格就是 F-12.5。`,
            )}
          </p>
        </Diagram>
        <Steps
          title="推導 A（時域）：變異數遞迴"
          steps={[
            { tex: String.raw`V_k\equiv E[\delta w_k^2]`, why: md(String.raw`定義第 $k$ 個 block 的均方偏差（$\delta w$ 平均為 0，所以就是變異數）。`) },
            { tex: String.raw`V_{k+1}=E\big[(p\,\delta w_k+\mu\eta_k)^2\big]`, why: '代入遞迴式。' },
            { tex: String.raw`=p^2E[\delta w_k^2]+2p\mu\,E[\delta w_k\eta_k]+\mu^2E[\eta_k^2]`, why: '展開平方，期望值是線性的。' },
            { tex: String.raw`E[\delta w_k\eta_k]=0`, why: md(String.raw`$\delta w_k$ 只由 $\eta_0\dots\eta_{k-1}$ 決定（因果），而 $\eta_k$ 與過去獨立且零均值。`) },
            { tex: String.raw`V_{k+1}=p^2V_k+\mu^2\sigma_\eta^2`, why: '剩下兩項（就是 §12 開頭手算表用的式子）。' },
            { tex: String.raw`V=p^2V+\mu^2\sigma_\eta^2`, why: md(String.raw`穩態 $V_{k+1}=V_k=V$（$|p|<1$ 時這個固定點存在且會被收斂到）。`) },
            { tex: String.raw`V(1-p^2)=\mu^2\sigma_\eta^2`, why: '移項。' },
          ]}
          result={String.raw`\sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2}`}
        />
        <Steps
          title="推導 B（Parseval / 脈衝響應能量）"
          steps={[
            { tex: String.raw`\sigma_w^2=\sigma_\eta^2\sum_{k\ge1}h_k^2`, why: md(String.raw`白雜訊通過濾波器：輸出變異數 $=$ 輸入變異數 $\times$ 脈衝響應能量（各項獨立，變異數相加）。`) },
            { tex: String.raw`=\sigma_\eta^2\mu^2\sum_{k\ge1}p^{2(k-1)}`, why: md(String.raw`代入 $h_k=\mu p^{k-1}$。`) },
            { tex: String.raw`=\sigma_\eta^2\mu^2\cdot\frac{1}{1-p^2}`, why: md(String.raw`公比 $p^2$ 的等比級數（$|p|<1$）。`) },
            {
              tex: String.raw`\frac1{2\pi}\int_{-\pi}^{\pi}S_w(e^{j\Omega})\,d\Omega=\frac{\mu^2\sigma_\eta^2}{1-p^2}`,
              why: md(`頻域版 Parseval：對 PSD（F-12.4 的 $S_w=\\mu^2\\sigma_\\eta^2/(1-2p\\cos\\Omega+p^2)$）積分。數值核對（中點法 20000 點）$=${poisson.toPrecision(10)}\\ \\mathrm{fs}^2$，封閉式 $=${EX.sigmaW2.toPrecision(10)}\\ \\mathrm{fs}^2$。`),
            },
          ]}
        />
        <ModeGate min="engineer">
          <Steps
            title={md(String.raw`附帶結果：自相關 $R_w[\ell]=\sigma_w^2p^{|\ell|}$`)}
            steps={[
              { tex: String.raw`R_w[\ell]=E[\delta w_k\,\delta w_{k+\ell}],\ \ell\ge0`, why: '定義。' },
              { tex: String.raw`\delta w_{k+\ell}=p^\ell\delta w_k+\sum_{i=0}^{\ell-1}p^{\ell-1-i}\mu\eta_{k+i}`, why: md(String.raw`把遞迴往前展開 $\ell$ 步。`) },
              { tex: String.raw`R_w[\ell]=p^\ell E[\delta w_k^2]+0=\sigma_w^2p^{\ell}`, why: md(String.raw`未來的 $\eta$ 與 $\delta w_k$ 無關；負 $\ell$ 由對稱性 $R[-\ell]=R[\ell]$。`) },
              {
                tex: String.raw`S_w(e^{j\Omega})=\sigma_w^2\sum_\ell p^{|\ell|}e^{-j\Omega\ell}=\frac{\sigma_w^2(1-p^2)}{1-2p\cos\Omega+p^2}`,
                why: '兩側等比級數相加（Poisson kernel），與 F-12.4 完全一致。',
              },
            ]}
          />
          <Plot
            title="係數雜訊的自相關（橫軸：block lag）"
            csvName="ch12-acf"
            height={220}
            data={acf}
            layout={ACF_LAYOUT}
            caption={md(String.raw`$R_w[\ell]=\sigma_w^2p^{|\ell|}$（解析式直接計算）。相關長度約 $\tau=-1/\ln p$ 個 block：係數雜訊是「慢的」、高度相關的雜訊，所以它的頻譜集中在低頻。`)}
          />
        </ModeGate>
        <TexBlock id="F-12.5" label="穩態係數雜訊">
          {String.raw`\boxed{\sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2}=\frac{\mu\,\sigma_\eta^2}{K(2-\mu K)}}\qquad(\text{因為 }1-p^2=(1-p)(1+p)=g(2-g))`}
        </TexBlock>
        <TexBlock id="F-12.6" label="Sign-GMAC 雜訊">
          {String.raw`\sigma_\eta^2=\frac{1-m^2}{N}\approx\frac1N\quad\Rightarrow\quad\sigma_w=\frac{\mu}{\sqrt{N(1-p^2)}}`}
        </TexBlock>
        <p>
          {md(
            String.raw`F-12.6 裡的 $m=E[q\,x\mid w]$ 是 $q\,x$ 的條件平均：係數剛好在固定點時 $m=0$，稍微偏離時也很小，所以 $\sigma_\eta^2\approx1/N$（$N$ 筆 $\pm1$ 的平均）。`,
          )}
        </p>
        <p>代入本例：</p>
        <TexBlock>
          {String.raw`\begin{aligned}
1-p^2&=1-${sig(EX.p, 6)}^2=${sig(1 - EX.p ** 2, 6)}\\
\sigma_w^2&=\frac{10^2/4096}{${sig(1 - EX.p ** 2, 6)}}=${sig(EX.sigmaW2, 6)}\ \mathrm{fs}^2\\
\sigma_w&=${sig(EX.sigmaW, 6)}\ \mathrm{fs}
\end{aligned}`}
        </TexBlock>
        <p>
          <ClaimTag kind="exact" />（在 F-12.1 的線性模型下）。<Tex>{String.raw`\mu`}</Tex> 小時 <Tex>{String.raw`2-\mu K\approx2`}</Tex>，所以{' '}
          <Tex>{String.raw`\sigma_w^2\approx\mu\sigma_\eta^2/(2K)`}</Tex>：<strong>
            <Tex>{String.raw`\sigma_w\propto\sqrt\mu`}</Tex>，收斂時間 <Tex>{String.raw`\tau\propto1/\mu`}</Tex>
          </strong>——這就是 learning rate 的基本取捨（第 14 章會最佳化它）。這裡的 <Tex>{String.raw`\tau=-1/\ln p`}</Tex> 是收斂時間常數：偏差衰減到{' '}
          <Tex>{String.raw`1/e\approx37\%`}</Tex> 需要的 block 數（因為 <Tex>{String.raw`p^{\tau}=e^{-1}`}</Tex>）。
        </p>
        <div className="table-wrap">
          <table className="ch12-table">
            <thead>
              <tr>
                <th className="num">
                  <Tex>{String.raw`\mu`}</Tex> [fs]
                </th>
                <th className="num">
                  <Tex>{String.raw`g=\mu K`}</Tex>
                </th>
                <th className="num">
                  <Tex>{'p'}</Tex>
                </th>
                <th className="num">
                  <Tex>{String.raw`\tau`}</Tex> [blocks]
                </th>
                <th className="num">
                  <Tex>{String.raw`\tau`}</Tex> [<Tex>{String.raw`\mu\mathrm s`}</Tex>]
                </th>
                <th className="num">
                  exact <Tex>{String.raw`f_{3\mathrm{dB}}`}</Tex> [kHz]
                </th>
                <th className="num">
                  <Tex>{String.raw`\sigma_w`}</Tex> [fs]
                </th>
              </tr>
            </thead>
            <tbody>
              {tradeoff.map(({ mu, lp }) => (
                <tr key={mu} className={mu === 10 ? 'ch12-hl' : undefined}>
                  <td className="num">{mu}</td>
                  <td className="num">{lp.g.toFixed(5)}</td>
                  <td className="num">{lp.p.toFixed(5)}</td>
                  <td className="num">{lp.tauBlocks.toFixed(2)}</td>
                  <td className="num">{(lp.tauSeconds * 1e6).toFixed(2)}</td>
                  <td className="num">{(lp.f3dbExact / 1e3).toFixed(3)}</td>
                  <td className="num">{lp.sigmaW.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          {md(String.raw`表格由 calLoop() 即時計算（$N=4096$、$\sigma_v=100$ fs、$C=1$、$f_s=4$ GHz）；$\mu$ 每加倍，$\sigma_w$ 約乘 $\sqrt2$、$\tau$ 約減半。`)}
        </p>
        <Hand id="HC-12.3">
          {md(
            String.raw`上表的任何一列都可以自己算出來：把 $\mu$ 換成 $2.5,\,5,\,20,\,40$ fs（或換成你的 $\sigma_v$、$N$、$f_s$），先用計算機算 $\sigma_w$ 與 $\tau$，再和表格對照。`,
          )}
        </Hand>
        <Callout kind="info" title={md(String.raw`$\mu$ 可以調多大？`)}>
          <p>
            {md(
              String.raw`穩態存在的條件是 $|p|<1$，也就是 $0<\mu K<2$：本例 $0<\mu<2/K=${sig(2 / EX.K, 5)}$ fs（第 3、8 章的穩定範圍；這是線性化模型的`,
            )}
            <strong>平均／均方穩定</strong>
            {md(
              String.raw`條件，不是「任何情況都穩定」）。$\mu K>1$ 時 $p<0$，係數每個 block 正負交替；$\mu K$ 越接近 2，$1-p^2\to0$，$\sigma_w$ 越大。實務上會留很大的餘裕（本例 $\mu K=${sig(EX.g, 3)}$）。`,
            )}
          </p>
          <p>
            {md(
              String.raw`入門課第 4 課的例子把累加長度改成 $N=10{,}000$（其餘相同）：$p$ 不變，$\sigma_w=\mu/\sqrt{N(1-p^2)}=${sig(lesson4.sigmaW, 4)}$ fs——由本頁同一個 calLoop() 算出，與該課的 0.255 fs 一致。`,
            )}{' '}
            <ClaimTag kind="exact" />
          </p>
        </Callout>
        <ModeGate min="research">
          <Callout kind="info" title={md(String.raw`Research：如果 GMAC 雜訊不是白色（colored $S_\eta$）`)}>
            <p>
              {md(
                String.raw`F-12.5 假設 $\eta_k$ 在 block 之間獨立。若 comparator 前雜訊有慢變成分（例如 flicker、供電耦合），相鄰 block 的 $\eta$ 會相關。最簡單的模型是 AR(1)：$R_\eta[\ell]=\sigma_\eta^2r^{|\ell|}$，$S_\eta(e^{j\Omega})=\sigma_\eta^2\frac{1-r^2}{1-2r\cos\Omega+r^2}$。`,
              )}{' '}
              <ClaimTag kind="research" />
            </p>
            <Diagram chart={CHART_COLORED_ETA} caption={String.raw`有相關的 GMAC 雜訊：先用一個一階迴圈把白雜訊變成 AR(1)，$\eta_k=r\,\eta_{k-1}+\sqrt{1-r^2}\,\sigma_\eta\,\varepsilon_k$，再送進同一個 LMS 閉迴路。先找那條回授線。`}>
              <p>
                {md(
                  String.raw`先看前半的小迴圈：白色的 $\varepsilon_k$ 進加法點，回授線把上一個 block 的 $\eta_{k-1}$ 乘上 $r$ 加回來，所以相鄰 block 的 $\eta$ 有相關（$r$ 就是 lag-1 相關係數）。再看後半：$\eta_k$ 進入和前面完全相同的 LMS 閉迴路 $H(z)$。兩個一階迴圈串在一起，$r>0$ 時雜訊的低頻比較多，剛好被 LMS 的 low-pass 放過，所以 $\sigma_w$ 變大。`,
                )}
              </p>
              <p>
                {md(
                  String.raw`和公式的對照：圖上的小迴圈就是下面推導第一行的 $\eta_k=r\,\eta_{k-1}+\sqrt{1-r^2}\,\sigma_\eta\,\varepsilon_k$（前面乘上 $\sqrt{1-r^2}$ 是為了讓 $\eta$ 的變異數維持 $\sigma_\eta^2$）；綠色那一格是推導的結果，$r=0$ 時退回 F-12.5。`,
                )}
              </p>
            </Diagram>
            <Steps
              title={md(String.raw`colored $\eta$ 下的 $\sigma_w^2$`)}
              steps={[
                { tex: String.raw`\eta_k=r\,\eta_{k-1}+\sqrt{1-r^2}\,\sigma_\eta\,\varepsilon_k,\qquad \varepsilon_k\sim\mathcal N(0,1)\ \text{iid}`, why: md(String.raw`AR(1) 產生器：變異數仍是 $\sigma_\eta^2$，相關係數每隔一個 block 乘 $r$。`) },
                { tex: String.raw`\delta w_k=\sum_{i\ge1}\mu p^{i-1}\eta_{k-i}`, why: md(String.raw`遞迴的穩態解（脈衝響應 $h_i=\mu p^{i-1}$）。`) },
                { tex: String.raw`E[\delta w_k\eta_k]=\sum_{i\ge1}\mu p^{i-1}\sigma_\eta^2r^{i}=\frac{\mu\sigma_\eta^2r}{1-pr}`, why: md(String.raw`$E[\eta_{k-i}\eta_k]=\sigma_\eta^2r^i$，再用等比級數（公比 $pr$）。白色時 $r=0$，這一項就是推導 A 裡被丟掉的 0。`) },
                { tex: String.raw`V=p^2V+2p\mu\,E[\delta w_k\eta_k]+\mu^2\sigma_\eta^2`, why: '推導 A 的第三行，但交叉項不再為 0。' },
                { tex: String.raw`V(1-p^2)=\mu^2\sigma_\eta^2\Big(1+\frac{2pr}{1-pr}\Big)=\mu^2\sigma_\eta^2\,\frac{1+pr}{1-pr}`, why: '代入、通分。' },
              ]}
              result={String.raw`\sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2}\cdot\frac{1+pr}{1-pr}`}
            />
            <div className="table-wrap">
              <table className="ch12-table">
                <thead>
                  <tr>
                    <th className="num">
                      <Tex>{'r'}</Tex>
                    </th>
                    <th className="num">
                      <Tex>{String.raw`\frac{1+pr}{1-pr}`}</Tex>
                    </th>
                    <th className="num">
                      <Tex>{String.raw`\sigma_w`}</Tex>（封閉式）[fs]
                    </th>
                    <th className="num">
                      <Tex>{String.raw`\sqrt{\frac1{2\pi}\int S_w\,d\Omega}`}</Tex>（數值）[fs]
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {colored.map((c) => (
                    <tr key={c.r} className={c.r === 0 ? 'ch12-hl' : undefined}>
                      <td className="num">{c.r}</td>
                      <td className="num">{c.factor.toFixed(4)}</td>
                      <td className="num">{c.sigmaW.toFixed(5)}</td>
                      <td className="num">{c.parseval.toFixed(5)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              {md(
                String.raw`$r>0$（慢變、正相關）會讓 $\sigma_w$ 變大——LMS 的 low-pass 正好讓低頻的 $S_\eta$ 通過；$r<0$ 則相反。此時 lag-1 自相關變成 $\rho_1=p+r(1-p^2)/(1+pr)$，用 $\hat p$ 推頻寬會偏差；$\sigma_w^2=S_w^{(1)}(0)\cdot\mathrm{ENBW}$ 也不再成立（PSD 形狀不再是 $|H|^2$）。LMS Noise Lab 的 $r$ 控制項用引擎 (a) 驗證這個結果。`,
              )}
            </p>
            <CodeBlock source={calNoiseSrc} region="coloredEta" path="src/simulation/models/calNoise.ts" title={String.raw`sigmaW2Colored：colored $\eta$ 的穩態變異`} />
          </Callout>
        </ModeGate>
      </Section>
    </>
  )
}
