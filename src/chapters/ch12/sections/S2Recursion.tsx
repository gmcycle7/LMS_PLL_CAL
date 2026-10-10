import { useMemo } from 'react'
import type { Data, Layout } from 'plotly.js-dist-min'
import { Callout, ClaimTag, CodeBlock, ModeGate, Plot, Prereq, Section, Tex, TexBlock } from '@/components'
import calNoiseSrc from '@/simulation/models/calNoise.ts?raw'
import { calLoop, sigmaW2Colored, swDtft } from '@/simulation/models/calNoise'
import { EX, EX_INPUT, Erratum, Hand, Steps, md, sig } from '../common'

const ACF_LAYOUT: Partial<Layout> = { xaxis: { title: { text: 'lag ℓ [blocks]' } }, yaxis: { title: { text: 'R_w [fs²]' } } }

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
    return [{ x: l, y: l.map((x) => EX.sigmaW2 * EX.p ** Math.abs(x)), name: 'R_w[ℓ]', mode: 'lines+markers', marker: { size: 4 } }]
  }, [])
  // 入門課第 4 課的例子：同樣的 μ、σ_v，但 N = 10,000
  const lesson4 = useMemo(() => calLoop({ ...EX_INPUT, N: 10000 }), [])

  return (
    <>
      <Section kind="formula" title="§12.1 線性化：GMAC 輸出 = 恢復力 + 雜訊" level={3} id="ch12-linearize">
        <p>
          第 5 章已經知道：1-bit comparator 在雜訊下的平均輸出是一條 S 曲線，小訊號時近似直線，斜率 <Tex>{String.raw`K_q=\sqrt{2/\pi}/\sigma_v`}</Tex>。
          本章關心的是「收斂之後」：<Tex>{'w'}</Tex> 已經在固定點 <Tex>{'w^*'}</Tex> 附近，所以用相對固定點的偏差來寫：
        </p>
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
              why: md(String.raw`comparator 前的誤差：DTC gain 誤差 $a-w$ 乘上 code，經有效路徑 $C$，再加上雜訊（§0 約定）。`),
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
              why: md(String.raw`泰勒一階 $\operatorname{erf}(z)\approx 2z/\sqrt\pi$，條件是 $|C(a-w)|\ll\sigma_v$（小訊號）。`),
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
              why: md(String.raw`$(qx)^2=1\Rightarrow\operatorname{Var}(qx)=1-m^2$；$N$ 個獨立樣本平均，變異數除以 $N$；近平衡 $m\approx0$。`),
            },
          ]}
        />
        <p>
          <ClaimTag kind="approx" /> 這是小訊號、iid、Gaussian 的近似；<Tex>{'|C\\,\\delta w|'}</Tex> 必須遠小於 <Tex>{String.raw`\sigma_v`}</Tex>。本例{' '}
          <Tex>{`3\\sigma_w=${sig(3 * EX.sigmaW, 3)}\\ \\mathrm{fs}\\ll\\sigma_v=100\\ \\mathrm{fs}`}</Tex>，成立得非常好。條件依勘誤 <Erratum id="E30" /> 寫明：
          {md(String.raw`unit-RMS $\pm1$ code、identity path（$C=1$）、average-mode GMAC、白色 Gaussian $v$、近平衡 $\sigma_\eta^2\approx1/N$。`)}
        </p>
      </Section>

      <Section kind="formula" title="§12.1 係數誤差的遞迴" level={3} id="ch12-recursion">
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
        <Steps
          title={md(String.raw`$H_{\eta\to w}(z)$ 一步一步`)}
          steps={[
            { tex: String.raw`W(z)=\sum_{k\ge0}\delta w_kz^{-k},\qquad E(z)=\sum_{k\ge0}\eta_kz^{-k}`, why: '定義兩個數列的 Z-transform。' },
            { tex: String.raw`\sum_k\delta w_{k+1}z^{-k}=p\,W(z)+\mu E(z)`, why: md(String.raw`遞迴式兩邊乘 $z^{-k}$ 再對 $k$ 求和（線性）。`) },
            { tex: String.raw`z\big(W(z)-\delta w_0\big)=p\,W(z)+\mu E(z)`, why: '左邊用「超前一步」性質。' },
            { tex: String.raw`(z-p)\,W(z)=\mu E(z)`, why: md(String.raw`忽略初始狀態 $\delta w_0=0$（只看穩態雜訊傳遞）。`) },
            { tex: String.raw`H_{\eta\to w}(z)=\frac{W(z)}{E(z)}=\frac{\mu}{z-p}`, why: '轉移函數 = 輸出 / 輸入。' },
            { tex: String.raw`\frac{\mu}{z-p}=\frac{\mu z^{-1}}{1-pz^{-1}}=\mu z^{-1}\sum_{m\ge0}p^mz^{-m}`, why: md(String.raw`分子分母同除以 $z$，再用等比級數展開（$|z|>|p|$）。`) },
            { tex: String.raw`h_k=\mu\,p^{k-1}\quad(k\ge1),\qquad h_0=0`, why: md(String.raw`讀出 $z^{-k}$ 的係數：先延遲一個 block（$\eta_k$ 下一個 block 才影響 $w$），之後以 $p^k$ 衰減。`) },
          ]}
        />
        <TexBlock id="F-12.3" label="雜訊 → 係數">
          {String.raw`\boxed{H_{\eta\to w}(z)=\frac{\mu}{z-p}=\frac{\mu z^{-1}}{1-pz^{-1}}}`}
        </TexBlock>
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
        <Callout kind="info" title="注意取樣率">
          這個 PSD 定義在 <strong>block rate</strong> <Tex>{String.raw`f_u=f_s/N=${sig(EX.fu / 1e3, 7)}\ \mathrm{kHz}`}</Tex>，<Tex>{String.raw`\Omega`}</Tex> 的單位是 rad/block。
          之後要乘上 sample-rate 的 code 時，必須先轉換（§12.6、<Erratum id="E29" />）。
        </Callout>
        <Hand id="HC-12.2">
          {md(
            String.raw`挑一個頻率 $f$，把 $e^{j\Omega}-p$ 拆成實部與虛部，親手算出這一點的 $|H|^2$ 比 DC 低幾 dB、$S_w^{(1)}(f)$ 是多少。預設的 $f$ 是本例的 exact $-3$ dB 頻率——先猜答案應該是多少 dB，再動手算。`,
          )}
        </Hand>
      </Section>

      <Section kind="formula" title="§12.4 穩態變異：兩種推導" level={3} id="ch12-variance">
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
            { tex: String.raw`\sigma_w^2=\sigma_\eta^2\sum_{k\ge1}h_k^2`, why: '白雜訊通過濾波器：輸出變異數 = 輸入變異數 × 脈衝響應能量（各項獨立，變異數相加）。' },
            { tex: String.raw`=\sigma_\eta^2\mu^2\sum_{k\ge1}p^{2(k-1)}`, why: md(String.raw`代入 $h_k=\mu p^{k-1}$。`) },
            { tex: String.raw`=\sigma_\eta^2\mu^2\cdot\frac{1}{1-p^2}`, why: md(String.raw`公比 $p^2$ 的等比級數（$|p|<1$）。`) },
            {
              tex: String.raw`\frac1{2\pi}\int_{-\pi}^{\pi}\frac{\mu^2\sigma_\eta^2\,d\Omega}{1-2p\cos\Omega+p^2}=\frac{\mu^2\sigma_\eta^2}{1-p^2}`,
              why: md(`頻域版 Parseval：對 PSD 積分。數值核對（中點法 20000 點）$=${poisson.toPrecision(10)}\\ \\mathrm{fs}^2$，封閉式 $=${EX.sigmaW2.toPrecision(10)}\\ \\mathrm{fs}^2$。`),
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
        <p>代入本例：</p>
        <TexBlock>
          {String.raw`\begin{aligned}
1-p^2&=1-${sig(EX.p, 6)}^2=${sig(1 - EX.p ** 2, 6)}\\
\sigma_w^2&=\frac{10^2\cdot(1/4096)}{${sig(1 - EX.p ** 2, 6)}}=${sig(EX.sigmaW2, 6)}\ \mathrm{fs}^2\\
\sigma_w&=${sig(EX.sigmaW, 6)}\ \mathrm{fs}
\end{aligned}`}
        </TexBlock>
        <p>
          <ClaimTag kind="exact" />（在 F-12.1 的線性模型下）。<Tex>{String.raw`\mu`}</Tex> 小時 <Tex>{String.raw`2-\mu K\approx2`}</Tex>，所以{' '}
          <Tex>{String.raw`\sigma_w^2\approx\mu\sigma_\eta^2/(2K)`}</Tex>：<strong>
            <Tex>{String.raw`\sigma_w\propto\sqrt\mu`}</Tex>，收斂時間 <Tex>{String.raw`\tau\propto1/\mu`}</Tex>
          </strong>——這就是 learning rate 的基本取捨（第 14 章會最佳化它）。
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
