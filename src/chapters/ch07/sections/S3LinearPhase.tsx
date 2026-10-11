import { useMemo, type ReactNode } from 'react'
import type { Data } from 'plotly.js-dist-min'
import { Callout, ClaimTag, Mermaid, ModeGate, Plot, Prereq, Section, SourceTag, Tex, TexBlock } from '@/components'
import { cAbs, cArg } from '@/simulation/core'
import { freqz } from '@/simulation/signal'
import {
  analyticCorrSweep,
  bestToneDelay,
  multiToneCorr,
  multiToneCorrFiltered,
  pathTransfer,
  type FxPathSpec,
} from '@/simulation/models/filteredX'
import { CHART_DELAY_LINE, CHART_TWO_TONES, CHART_VOTING } from '../diagrams'
import { FoldSteps } from '../FoldSteps'
import { ErratumNote } from '../ErratumNote'
import { Hand } from '../Hand'
import { DEG, fx, RAD, signClass, tx } from '../util'

const r = String.raw
const TYPE2: FxPathSpec = { kind: 'type2_dt', wnTs: 0.1, zeta: 0.7, loopDelay: 0 }

/** §7.3：一個 delay 為什麼不能修所有頻率——delay = 線性相位；多頻與 PSD 積分。 */
export function S3LinearPhase() {
  // ── 圖 1：D = 4 固定，C_D(Ω)/(A²|H|/2) = cos θ(Ω) ──
  const fig1 = useMemo(() => {
    const n = 721
    const om = Array.from({ length: n }, (_, i) => 1e-4 + ((Math.PI - 2e-4) * i) / (n - 1))
    const fir = pathTransfer({ kind: 'single_tone', magnitude: 1, phaseDeg: -120, omega: Math.PI / 6 })
    const H = freqz(fir.b, fir.a, om)
    const ideal = om.map((o) => Math.cos(-120 * RAD + o * 4))
    const real = om.map((o, i) => Math.cos(cArg(H[i]) + o * 4))
    const omDeg = om.map((o) => o * DEG)
    const data: Data[] = [
      { x: omDeg, y: ideal, name: 'φ(Ω) ≡ −120°（理想化）', mode: 'lines' },
      { x: omDeg, y: real, name: '真實 2-tap FIR（只在 30° 是 −120°）', mode: 'lines' },
      { x: [30], y: [Math.cos(cArg(freqz(fir.b, fir.a, [Math.PI / 6])[0]) + (Math.PI / 6) * 4)], name: '設計點 Ω₀ = 30°/sample', mode: 'markers', marker: { size: 10, symbol: 'star' } },
    ]
    return { data }
  }, [])

  // ── 圖 2：Type-II，D = 119 對 Ω = 0.03 對齊；其他頻率 ──
  const t2 = useMemo(() => {
    const H = pathTransfer(TYPE2)
    const z = freqz(H.b, H.a, [0.03])[0]
    const best = bestToneDelay(cArg(z), 0.03, 400)
    const n = 1600
    const om = Array.from({ length: n }, (_, i) => Math.pow(10, Math.log10(0.004) + ((Math.log10(Math.PI) - Math.log10(0.004)) * i) / (n - 1)))
    const Hs = freqz(H.b, H.a, om)
    const cosD = om.map((o, i) => Math.cos(cArg(Hs[i]) + o * best.D))
    const cos0 = om.map((_, i) => Math.cos(cArg(Hs[i])))
    const data: Data[] = [
      { x: om, y: cos0, name: 'raw-x（D = 0）：cos ∠H', mode: 'lines' },
      { x: om, y: cosD, name: `delayed-x（D = ${best.D}）`, mode: 'lines' },
      { x: [0.03], y: [Math.cos(cArg(z) + 0.03 * best.D)], name: '對齊點 Ω = 0.03', mode: 'markers', marker: { size: 10, symbol: 'star' } },
    ]
    return { data, phaseDeg: cArg(z) * DEG, mag: cAbs(z), best }
  }, [])

  // ── 多頻例子（Type-II，兩個低頻 tone）──
  const mt = useMemo(() => {
    const H = pathTransfer(TYPE2)
    const tones = [
      { A: 1, omega: 0.03 },
      { A: 1, omega: 0.05 },
    ]
    const b1 = bestToneDelay(cArg(freqz(H.b, H.a, [0.03])[0]), 0.03, 400)
    const b2 = bestToneDelay(cArg(freqz(H.b, H.a, [0.05])[0]), 0.05, 400)
    const d1 = b1.D
    const d2 = b2.D
    let bestD = 0
    let bestC = -Infinity
    for (let D = 0; D <= 400; D++) {
      const c = multiToneCorr({ tones, h: H, D }).total
      if (c > bestC) {
        bestC = c
        bestD = D
      }
    }
    const fx0 = multiToneCorrFiltered({ tones, h: H, hHat: H })
    const Ex2 = tones.reduce((s, t) => s + (t.A * t.A) / 2, 0)
    // filtered-x（Ĥ = H）的 ρ：x_ref = u ⇒ E[x_ref²] = E[u·x_ref] = Σ(A²/2)|H|²
    const rhoFx = fx0 / Math.sqrt(fx0 * fx0)
    const mk = (key: string, label: ReactNode, D: number) => {
      const m = multiToneCorr({ tones, h: H, D })
      return { key, label, D, parts: m.parts, total: m.total, rho: m.total / Math.sqrt(Ex2 * fx0) }
    }
    const withD = (text: string, D: number) => (
      <>
        {text}（<Tex>{`D=${D}`}</Tex>）
      </>
    )
    const rows = [
      mk('raw', withD('raw-x', 0), 0),
      mk('tone1', withD('對 tone 1 對齊', d1), d1),
      mk('tone2', withD('對 tone 2 對齊', d2), d2),
      ...(bestD !== d1 && bestD !== d2 ? [mk('best', withD('0…400 中最佳', bestD), bestD)] : []),
    ]
    // 最佳 D 落在哪一圈：D ≈ D_i* + k_i·(2π/Ω_i)
    const lap = (b: typeof b1, om: number) => Math.round((bestD - b.continuous) / ((2 * Math.PI) / om))
    const info = multiToneCorr({ tones, h: H, D: 0 })
    const best = mk('best', null, bestD)
    return { rows, fx: fx0, rhoFx, phases: info.phasesDeg, mags: info.mags, d1, d2, bestD, best, k1: lap(b1, 0.03), k2: lap(b2, 0.05), b1, b2 }
  }, [])

  // ── 寬頻 code：C_D vs D（AR(1)）──
  const wide = useMemo(() => {
    const H = pathTransfer(TYPE2)
    const Ds = Array.from({ length: 121 }, (_, i) => i)
    const out: Data[] = []
    const stats: { rho: number; c0: number; bestD: number; cBest: number; minD: number; cMin: number; eu2: number }[] = []
    for (const rho of [0.5, 0.9, 0.99]) {
      const code = { kind: 'ar1' as const, rho }
      const c = analyticCorrSweep({ code, h: H, g: null, Ds }) as Float64Array
      out.push({ x: Ds, y: Array.from(c), name: `delayed-x，AR(1) ρ = ${rho}`, mode: 'lines' })
      let bestD = 0
      let minD = 0
      c.forEach((v, i) => {
        if (v > c[bestD]) bestD = i
        if (v < c[minD]) minD = i
      })
      const eu2 = (analyticCorrSweep({ code, h: H, g: H, Ds: [0] }) as Float64Array)[0]
      stats.push({ rho, c0: c[0], bestD, cBest: c[bestD], minD, cMin: c[minD], eu2 })
    }
    // 白色 code：C_D = h_PD[D]
    const white = analyticCorrSweep({ code: { kind: 'white_pm_one' }, h: H, g: null, Ds }) as Float64Array
    let whiteBest = 0
    white.forEach((v, i) => {
      if (v > white[whiteBest]) whiteBest = i
    })
    return { data: out, stats, whiteBest, white0: white[0], white1: white[1] }
  }, [])

  return (
    <Section kind="formula" level={2} title="7.3 為什麼一個 delay 不能修所有頻率：delay 只是線性相位" id="ch07-linear-phase">
      <p>
        上一節的修正之所以成功，是因為 code 只有<strong>一個頻率</strong>。延遲 <Tex>{'D'}</Tex> 個 sample 在頻率域是什麼？
      </p>
      <p>
        先看硬體長什麼樣子。延遲就是一條 shift register（delay line）：code 每個 sample 往後移一格，GMAC 用一個 MUX 選要讀第幾格（tap）。讀第 <Tex>{'D'}</Tex> 格，拿到的就是
        <Tex>{'D'}</Tex> 個 sample 以前的 code。
      </p>
      <Mermaid
        chart={CHART_DELAY_LINE}
        caption={r`Delay line + tap MUX（圖上畫 4 級）：每多經過一個藍色的 register，同一個頻率的相位就多落後 $\Omega$（線上標的是每個 tap 的相位），所以落後量與 $D$ 成正比；暫存器 REG_GMAC_DLY（名稱為示意）決定 MUX 讀哪一個 tap。`}
      />
      <p>
        先看串在一起的藍色 register：每一格是一級 <Tex>{'B'}</Tex>-bit 的暫存器（<Tex>{'B'}</Tex> 是 code 的位元數），圖上畫了 4 級，T07 的例子讀的是第 4 格。再看每一格接到 MUX 的線：線上標的
        <Tex>{r`0,\,-\Omega,\,-2\Omega,\dots`}</Tex> 是頻率 <Tex>{r`\Omega`}</Tex> 的 tone 在那一格的相位——每多一格固定多落後 <Tex>{r`\Omega`}</Tex>，所以落後量和
        <Tex>{'D'}</Tex> 成正比，也和頻率成正比。MUX 的輸出就是公式裡的 <Tex>{'x[n-D]'}</Tex>；下面的推導把「第 <Tex>{'D'}</Tex> 格的相位是 <Tex>{r`-\Omega D`}</Tex>」用 DTFT 寫出來，結果就是
        <Tex>{r`z^{-D}\leftrightarrow e^{-j\Omega D}`}</Tex>。
      </p>
      <Prereq title="Z 轉換（Z-transform）：用一個符號代表「延遲一個 sample」">
        <p>
          Z 轉換把序列寫成冪級數：<Tex>{r`X(z)=\sum_n x[n]\,z^{-n}`}</Tex>（<Tex>{'z'}</Tex> 是複數變數）。延遲一個 sample 的序列
          <Tex>{r`x[n-1]`}</Tex> 的 Z 轉換是 <Tex>{r`\sum_n x[n-1]z^{-n}=z^{-1}\sum_m x[m]z^{-m}=z^{-1}X(z)`}</Tex>，所以在方塊圖裡
          <Tex>{r`z^{-1}`}</Tex> 就是一個 register，<Tex>{r`z^{-D}`}</Tex> 是 <Tex>{'D'}</Tex> 級 shift register。濾波器寫成
          <Tex>{r`H(z)=B(z^{-1})/A(z^{-1})`}</Tex>（例如本章的 <Tex>{r`\hat H_2(z)=(1-z^{-1})^2`}</Tex> 就是 <Tex>{r`x[n]-2x[n-1]+x[n-2]`}</Tex>）。
          把 <Tex>{r`z=e^{j\Omega}`}</Tex>（單位圓上的點）代入就得到頻率響應 <Tex>{r`H(e^{j\Omega})`}</Tex>，也就是 DTFT。
          使 <Tex>{r`A(z^{-1})=0`}</Tex> 的 <Tex>{'z'}</Tex> 是 pole；所有 pole 都在單位圓內（<Tex>{r`|z|<1`}</Tex>），濾波器才穩定。
        </p>
      </Prereq>
      <FoldSteps
        steps={[
          { tex: r`X(e^{j\Omega})=\sum_n x[n]\,e^{-j\Omega n}`, why: 'DTFT（離散時間傅立葉轉換）的定義：把訊號拆成各頻率的成分。' },
          {
            tex: r`\sum_n x[n-D]\,e^{-j\Omega n}=\sum_m x[m]\,e^{-j\Omega(m+D)}`,
            why: (
              <>
                代換 <Tex>{'m=n-D'}</Tex>（求和範圍是全部整數，不變）。
              </>
            ),
          },
          {
            tex: r`=e^{-j\Omega D}\,X(e^{j\Omega})`,
            why: (
              <>
                <Tex>{r`e^{-j\Omega D}`}</Tex> 與 <Tex>{'m'}</Tex> 無關，提到求和外面。
              </>
            ),
          },
        ]}
        result={r`z^{-D}\;\longleftrightarrow\;e^{-j\Omega D}:\ |\cdot|=1,\quad\angle=-\Omega D`}
      />
      <p>
        延遲不改變振幅，只加上一個<strong>與頻率成正比</strong>的相位 <Tex>{r`-\Omega D`}</Tex>（線性相位，linear phase；斜率 <Tex>{'-D'}</Tex> 就是 group delay）。
        要讓<strong>每一個</strong>被激勵的頻率都對齊，需要
      </p>
      <TexBlock>{r`\theta(\Omega)=\phi(\Omega)+\Omega D\equiv0\pmod{2\pi}\quad\text{對所有被激勵的 }\Omega\quad\Longleftrightarrow\quad\phi(\Omega)=-\Omega D\pmod{2\pi}`}</TexBlock>
      <p>
        也就是說，<strong>誤差路徑本身必須是一個純延遲</strong>。PLL 的 <Tex>{r`H_{\mathrm{PD}}`}</Tex> 不是：Type-II 迴路在低頻相位接近
        <Tex>{r`180^\circ`}</Tex>（<Tex>{r`H_{\mathrm{PD}}\approx-(\Omega/\omega_nT_s)^2`}</Tex>），在高頻趨近 <Tex>{r`0^\circ`}</Tex>，中間是一條彎曲的相位曲線，
        不可能用一條直線 <Tex>{r`-\Omega D`}</Tex> 抵消。 <ClaimTag kind="exact" />
      </p>
      <p className="small muted">
        這裡與後面會用到的三個 PLL 參數：<Tex>{r`\omega_nT_s`}</Tex> 是主迴路的自然頻率（natural frequency）換算成每個 sample 轉幾 rad（大約是迴路頻寬的位置）；
        <Tex>{r`\zeta`}</Tex> 是阻尼（damping，決定頻率響應的峰有多高）；<Tex>{'d'}</Tex> 是迴路裡額外的 pipeline latency，單位是 sample（<Tex>{'d=0'}</Tex> 表示只有最基本的一拍）。
      </p>

      <h3 className="ch07-subhead">
        頻率容忍度：對準 <Tex>{'\\Omega_0'}</Tex> 之後，偏離多少就失效？
      </h3>
      <p>
        先用一張圖看「同一個 <Tex>{'D'}</Tex> 給兩個頻率用」會發生什麼事：
      </p>
      <Mermaid
        chart={CHART_TWO_TONES}
        caption={r`同一條 delay line（藍色，$D=4$）對兩個 tone：對準的 tone 1 投正票（綠），頻率兩倍的 tone 2 多轉了 $120^\circ$，投負票（紅）。這裡假設兩個頻率的 $\phi$ 相同，是最樂觀的情況。`}
      />
      <p>
        先看 tone 1 那一框：<Tex>{'D=4'}</Tex> 是為它選的，<Tex>{r`\theta_1=-120^\circ+4\times30^\circ=0^\circ`}</Tex>。再看 tone 2 那一框：delay line 只有一條，<Tex>{'D'}</Tex> 還是 4，但
        tone 2 每個 sample 轉 <Tex>{r`60^\circ`}</Tex>，同樣 4 格就轉了 <Tex>{r`240^\circ`}</Tex>，<Tex>{r`\theta_2=+120^\circ`}</Tex>、<Tex>{r`\cos\theta_2=-0.5`}</Tex>。圖上 tone 2 的
        <Tex>{r`\theta_2`}</Tex> 就是下面公式的 <Tex>{r`(\Omega-\Omega_0)D=(60^\circ-30^\circ)\times4`}</Tex>。兩票最後依各自的權重
        <Tex>{r`\tfrac{A_i^2}{2}|H_i|`}</Tex>（<Tex>{'A_i'}</Tex>、<Tex>{'|H_i|'}</Tex> 是第 <Tex>{'i'}</Tex> 個 tone 的振幅與誤差路徑增益）加總，總和是正是負要看誰的票比較重——稍後的 F-07.7。
      </p>
      <p>
        假設誤差路徑在附近的相位近似常數（最樂觀的情況），在 <Tex>{'\\Omega_0'}</Tex> 對齊（<Tex>{r`\phi+\Omega_0D=0`}</Tex>）後，換到 <Tex>{'\\Omega'}</Tex>：
      </p>
      <FoldSteps
        steps={[
          { tex: r`\theta(\Omega)=\phi+\Omega D=(\Omega-\Omega_0)D`, why: <>代入對齊條件 <Tex>{r`\phi=-\Omega_0D`}</Tex>。</> },
          {
            tex: r`C_D>0\iff|\theta|<\tfrac{\pi}{2}\iff|\Omega-\Omega_0|<\frac{\pi}{2D}`,
            why: <>相關的符號由 <Tex>{r`\cos\theta`}</Tex> 決定。</>,
          },
        ]}
      />
      <p>
        <Tex>{'D=4'}</Tex>、<Tex>{r`\Omega_0=30^\circ`}</Tex>：只有 <Tex>{r`|\Omega-30^\circ|<22.5^\circ`}</Tex>（<Tex>{r`7.5^\circ\sim52.5^\circ`}</Tex>/sample）安全。
        <strong>D 越大，容許的頻寬越窄</strong>。真實濾波器的 <Tex>{r`\phi(\Omega)`}</Tex> 本身也隨頻率變，下圖（由公式計算）比較理想化與真實 2-tap FIR：
      </p>
      <Plot
        title={r`$D=4$ 固定時的 $\cos\theta(\Omega)$：只有一段頻率是正的`}
        data={fig1.data}
        layout={{
          xaxis: { title: { text: 'Ω [deg/sample]' }, range: [0, 180] },
          yaxis: { title: { text: 'C_D(Ω) / (A²|H|/2) = cos θ' }, range: [-1.05, 1.05] },
          shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: 0, y1: 0, line: { dash: 'dot', width: 1 } }],
        }}
        height={300}
        csvName="ch07-fixed-delay-vs-omega"
        caption={
          <>
            <Tex>{r`\cos\theta(\Omega)=\cos\big(\phi(\Omega)+4\Omega\big)`}</Tex>；<Tex>{r`\phi(\Omega)`}</Tex> 為 2-tap FIR 的真實相位（<code>pll.singleToneFir</code>，設計於
            <Tex>{r`30^\circ/\text{sample}`}</Tex>）
          </>
        }
      />

      <h3 className="ch07-subhead">
        Type-II PLL 的例子：要對齊一個低頻 tone，需要 <Tex>{r`D\approx119`}</Tex>
      </h3>
      <p>
        用 E44 的離散時間 Type-II DPLL（<Tex>{r`\omega_nT_s=0.1`}</Tex>、<Tex>{r`\zeta=0.7`}</Tex>、<Tex>{'d=0'}</Tex>），
        code tone 在 <Tex>{r`\Omega=0.03=0.3\,\omega_nT_s`}</Tex>：
        <Tex>{r`\angle H_{\mathrm{PD}}=${tx(t2.phaseDeg, 3)}^\circ`}</Tex>、<Tex>{r`|H_{\mathrm{PD}}|=${tx(t2.mag, 4)}`}</Tex>。{' '}
        <ErratumNote id="E44">
          規格 §6.1 的 <Tex>{r`155.2^\circ`}</Tex> 是連續時間原型的值；DT 迴路在此為 <Tex>{r`${tx(t2.phaseDeg, 3)}^\circ`}</Tex>。
        </ErratumNote>
      </p>
      <TexBlock>{r`D^\star=\frac{(-\phi)\bmod 2\pi}{\Omega}=\frac{360^\circ-${tx(t2.phaseDeg, 3)}^\circ}{0.03\times180^\circ/\pi}=${tx(t2.best.continuous, 2)}\ \Rightarrow\ D=${t2.best.D}`}</TexBlock>
      <TexBlock id="F-07.4">{r`D^\star=\frac{(-\phi)\bmod 2\pi}{\Omega},\qquad \theta=\mathrm{wrap}_{180}(\phi+\Omega D),\qquad C_D>0\iff|\theta|<90^\circ`}</TexBlock>
      <Plot
        title={r`Type-II $H_{\mathrm{PD}}$：$D=${t2.best.D}$ 只在 $\Omega=0.03$ 附近一小段有效`}
        data={t2.data}
        layout={{
          xaxis: { title: { text: 'Ω [rad/sample]（log）' } },
          yaxis: { title: { text: 'cos θ(Ω)' }, range: [-1.05, 1.05] },
        }}
        xLog
        height={300}
        csvName="ch07-type2-delay119"
        caption={
          <>
            由 <code>designDtLoop</code> 的 <Tex>{r`H_{\mathrm{PD}}(e^{j\Omega})`}</Tex> 計算；<Tex>{`D=${t2.best.D}`}</Tex> 是 {t2.best.D} 級深的 code FIFO（每級
            <Tex>{'B'}</Tex> 個 flip-flop，<Tex>{'B'}</Tex> = code 位元數）
          </>
        }
      />
      <p>
        要 119 級的 code FIFO 才能對齊<strong>一個</strong>頻率；PLL 頻寬或 FCW 一變，<Tex>{'D'}</Tex> 就要重找。這就是規格說的
        「同一 Delay 對別的頻率不一定有效」。 <SourceTag />
      </p>
      <Hand id="HC-07.3">
        預設值就是上面的 Type-II 例子（答案 <Tex>{r`D^\star\approx119.04`}</Tex>、<Tex>{`D=${t2.best.D}`}</Tex>）。換成你自己的 <Tex>{r`\phi`}</Tex> 與
        <Tex>{r`\Omega`}</Tex>，只用乘除和四捨五入算出要幾級 shift register、殘餘相位多少、以及對準之後能容忍多少頻偏（上一小段的
        <Tex>{r`\pi/(2D)`}</Tex>）。
      </Hand>

      <h3 className="ch07-subhead">多頻 code：把每個頻率的貢獻加起來</h3>
      <p>
        code 不只一個頻率時，GMAC 的相關是「每個頻率各投一票」的總和。先看計算流程，再推導：
      </p>
      <Mermaid
        chart={CHART_VOTING}
        caption={r`$C_D$ 的計算流程：每個頻率的票有多重，看「code 功率乘上 $|H|$」；這一票是正是負，看藍色方塊的 $\cos(\phi+\Omega D)$。兩者相乘、全部加總後的符號，決定 pole 在 1 的哪一邊。`}
      />
      <p>
        先看標著「這一票有多重」的方塊：code 在這個頻率的功率（單一 tone 是 <Tex>{r`A_i^2/2`}</Tex>；寬頻 code 是功率譜密度 <Tex>{r`S_{xx}`}</Tex>，本節後面的先備知識會解釋），乘上誤差路徑的增益
        <Tex>{'|H|'}</Tex>。再看藍色方塊，它決定這一票是贊成還是反對，就是上一張圖每個 tone 的 <Tex>{r`\cos\theta`}</Tex>。兩者相乘是一個頻率的票，最後把所有頻率加起來：只有幾個 tone 時是求和（下面的 F-07.7），頻譜連續時是積分（再下面的
        F-07.8）——兩個公式是同一張圖，只是「加總」那一格的寫法不同。
      </p>
      <FoldSteps
        steps={[
          { tex: r`x[n]=\sum_i A_i\cos(\Omega_i n+\vartheta_i)`, why: <>幾個 tone 疊加（頻率互異、都在 <Tex>{r`(0,\pi)`}</Tex>）。</> },
          { tex: r`u[n]=\sum_i A_i|H_i|\cos(\Omega_i n+\vartheta_i+\phi_i),\quad H_i\equiv H(e^{j\Omega_i})`, why: <>LTI 系統對每個頻率各自乘上 <Tex>{'H_i'}</Tex>（疊加原理 superposition）。</> },
          {
            tex: r`x[n-D]\,u[n]=\sum_i\sum_j A_iA_j|H_j|\cos(\Omega_in-\Omega_iD+\vartheta_i)\cos(\Omega_jn+\vartheta_j+\phi_j)`,
            why: '兩個和相乘展開成雙重和。',
          },
          {
            tex: r`i\ne j:\ E\big[\cos((\Omega_i\pm\Omega_j)n+\cdots)\big]=0`,
            why: (
              <>
                積化和差後的頻率是 <Tex>{r`\Omega_i\pm\Omega_j\ne0`}</Tex>，與上一節同理平均為零（不同頻率彼此「不相關」）。
              </>
            ),
          },
          {
            tex: r`i=j:\ \frac{A_i^2|H_i|}{2}\cos(\phi_i+\Omega_iD)`,
            why: '同頻的項就是 7.2 節的單頻公式。',
          },
        ]}
        result={r`C_D=\sum_i\frac{A_i^2}{2}\,|H_i|\cos(\phi_i+\Omega_iD)`}
      />
      <TexBlock id="F-07.7">{r`C_D=\sum_i\frac{A_i^2}{2}\,|H(e^{j\Omega_i})|\cos\big(\phi_i+\Omega_iD\big)`}</TexBlock>
      <p>
        例：同一個 Type-II 迴路，兩個等振幅 tone <Tex>{r`\Omega_1=0.03`}</Tex>（<Tex>{r`\phi_1=${tx(mt.phases[0], 1)}^\circ`}</Tex>、
        <Tex>{r`|H_1|=${tx(mt.mags[0], 4)}`}</Tex>）與 <Tex>{r`\Omega_2=0.05`}</Tex>（<Tex>{r`\phi_2=${tx(mt.phases[1], 1)}^\circ`}</Tex>、
        <Tex>{r`|H_2|=${tx(mt.mags[1], 4)}`}</Tex>）。下表由 F-07.7 即時計算；最後一欄是正規化相關 <Tex>{r`\rho=C/\sqrt{E[x^2]E[u^2]}`}</Tex>（見 7.4 節，filtered-x 為 1）：
      </p>
      <div className="table-wrap">
        <table className="ch07-table">
          <thead>
            <tr>
              <th>延遲選擇</th>
              <th className="num">tone 1 貢獻</th>
              <th className="num">tone 2 貢獻</th>
              <th className="num">
                總和 <Tex>{'C_D'}</Tex>
              </th>
              <th className="num">
                <Tex>{'\\rho'}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            {mt.rows.map((row) => (
              <tr key={row.key} className={row.total < 0 ? 'ch07-row-bad' : ''}>
                <td>{row.label}</td>
                <td className={`num ${signClass(row.parts[0])}`}>{fx(row.parts[0], 5)}</td>
                <td className={`num ${signClass(row.parts[1])}`}>{fx(row.parts[1], 5)}</td>
                <td className={`num ${signClass(row.total)}`}>{fx(row.total, 5)}</td>
                <td className="num">{fx(row.rho, 3)}</td>
              </tr>
            ))}
            <tr className="ch07-row-hl">
              <td>
                filtered-x（<Tex>{r`\hat H=H`}</Tex>）
              </td>
              <td className="num" colSpan={2}>
                <Tex>{r`\sum_i\tfrac{A_i^2}{2}|H_i|^2`}</Tex>
              </td>
              <td className="num ch07-pos">{fx(mt.fx, 5)}</td>
              <td className="num">{fx(mt.rhoFx, 3)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        對 tone 1 對齊（<Tex>{`D=${mt.d1}`}</Tex>）時，tone 2 的貢獻是 <Tex>{tx(mt.rows[1].parts[1], 5)}</Tex>
        {mt.rows[1].parts[1] < 0 ? '（負的）' : ''}，總和 <Tex>{tx(mt.rows[1].total, 5)}</Tex>
        {mt.rows[1].total < 0 ? <strong>：仍然小於 0，LMS 反向更新</strong> : null}；對 tone 2 對齊（<Tex>{`D=${mt.d2}`}</Tex>）總和雖為
        <Tex>{tx(mt.rows[2].total, 5)}</Tex>，正規化相關只有 <Tex>{`\\rho=${tx(mt.rows[2].rho, 3)}`}</Tex>。在 0–400 中最好的是
        <Tex>{`D=${mt.bestD}`}</Tex>（<Tex>{`\\rho=${tx(mt.best.rho, 3)}`}</Tex>）：它約等於
        <Tex>{r`D_1^\star+${mt.k1}\cdot\tfrac{2\pi}{\Omega_1}=${tx(mt.b1.continuous + (mt.k1 * 2 * Math.PI) / 0.03, 1)}`}</Tex>，也約等於
        <Tex>{r`D_2^\star+${mt.k2}\cdot\tfrac{2\pi}{\Omega_2}=${tx(mt.b2.continuous + (mt.k2 * 2 * Math.PI) / 0.05, 1)}`}</Tex>——兩個 tone 碰巧在同一個
        <Tex>{'D'}</Tex> 附近同時對齊。這個巧合完全由兩個頻率的比例決定，而且要 {mt.bestD} 級的 code FIFO；Fractional-N 的 DSM code 頻譜隨
        FCW（channel）改變，它也跟著消失。 <ClaimTag kind="exact" /> <SourceTag />
      </p>
      <Hand id="HC-07.4">
        上表「對 tone 1 對齊」那一列可以自己算出來：預設值是表中兩個 tone 的 <Tex>{r`|H_i|`}</Tex>、<Tex>{r`\phi_i`}</Tex>（取到 4 位小數／2 位小數）與
        <Tex>{`D=${mt.d1}`}</Tex>。先用計算機算出兩個 tone 各自的貢獻再相加，看看總和的符號；然後換成你自己的兩個頻率試試。
      </Hand>

      <h3 className="ch07-subhead">無限多個頻率：PSD 加權積分</h3>
      <Prereq title="功率譜密度（PSD）與自相關（autocorrelation）">
        <p>
          隨機（但統計性質不隨時間改變，wide-sense stationary）的 code 可以想成「無限多個頻率、每個頻率分到一點功率」。
          <strong>自相關</strong> <Tex>{r`R_x[m]=E\big[x[n]\,x[n+m]\big]`}</Tex> 描述「相隔 <Tex>{'m'}</Tex> 個 sample 的兩個值有多像」；
          它的 DTFT 就是 <strong>PSD</strong>（power spectral density）：
        </p>
        <TexBlock>{r`S_{xx}(e^{j\Omega})=\sum_m R_x[m]\,e^{-j\Omega m},\qquad R_x[m]=\frac1{2\pi}\int_{-\pi}^{\pi}S_{xx}(e^{j\Omega})\,e^{j\Omega m}\,d\Omega`}</TexBlock>
        <p>
          特別是 <Tex>{r`E[x^2]=R_x[0]=\frac1{2\pi}\int S_{xx}\,d\Omega`}</Tex>：PSD 曲線下的面積就是總功率。單頻 <Tex>{r`A\cos(\Omega_0n)`}</Tex> 的 PSD
          是在 <Tex>{r`\pm\Omega_0`}</Tex> 的兩根譜線，各帶 <Tex>{r`A^2/4`}</Tex> 的功率。
        </p>
      </Prereq>
      <FoldSteps
        steps={[
          { tex: r`C_D=E\Big[x[n-D]\sum_k h[k]\,x[n-k]\Big]=\sum_k h[k]\,E\big[x[n-D]\,x[n-k]\big]`, why: '代入卷積；期望值是線性的，可以和求和交換順序。' },
          { tex: r`=\sum_k h[k]\,R_x[k-D]`, why: <>兩個時間點相差 <Tex>{r`(n-k)-(n-D)=D-k`}</Tex>，且 <Tex>{'R_x'}</Tex> 是偶函數。</> },
          {
            tex: r`=\frac1{2\pi}\int_{-\pi}^{\pi}S_{xx}(e^{j\Omega})\sum_kh[k]\,e^{j\Omega(k-D)}\,d\Omega`,
            why: <>把 <Tex>{'R_x[k-D]'}</Tex> 換成 PSD 的反轉換，再交換求和與積分。</>,
          },
          {
            tex: r`=\frac1{2\pi}\int_{-\pi}^{\pi}S_{xx}(e^{j\Omega})\,\overline{H(e^{j\Omega})\,e^{j\Omega D}}\,d\Omega`,
            why: (
              <>
                <Tex>{r`\sum_kh[k]e^{j\Omega k}=\overline{H(e^{j\Omega})}`}</Tex>（<Tex>{'h'}</Tex> 為實數），<Tex>{r`e^{-j\Omega D}=\overline{e^{j\Omega D}}`}</Tex>。
              </>
            ),
          },
          {
            tex: r`=\frac1{2\pi}\int_{-\pi}^{\pi}S_{xx}(e^{j\Omega})\,\mathrm{Re}\big\{H(e^{j\Omega})\,e^{j\Omega D}\big\}\,d\Omega`,
            why: (
              <>
                <Tex>{r`S_{xx}`}</Tex> 是實的偶函數，<Tex>{r`H(e^{-j\Omega})=\overline{H(e^{j\Omega})}`}</Tex>：虛部在 <Tex>{r`\pm\Omega`}</Tex> 互相抵消。
              </>
            ),
          },
        ]}
      />
      <TexBlock id="F-07.8" label={<>PSD 加權的 <Tex>{'C_D'}</Tex>（DT 形式，E44）</>}>
        {r`C_D=\frac1{2\pi}\int_{-\pi}^{\pi}S_{xx}(e^{j\Omega})\,\mathrm{Re}\big\{H(e^{j\Omega})\,e^{j\Omega D}\big\}\,d\Omega=\frac1{2\pi}\int_{-\pi}^{\pi}S_{xx}\,|H|\cos\big(\phi(\Omega)+\Omega D\big)\,d\Omega=\sum_k h[k]\,R_x[k-D]`}
      </TexBlock>
      <p>
        <ClaimTag kind="exact" /> 每個頻率依 <Tex>{r`S_{xx}|H|`}</Tex> 加權投票，票的正負由 <Tex>{r`\cos(\phi+\Omega D)`}</Tex> 決定。{' '}
        <ErratumNote id="E44">本站寫成 <Tex>{r`S_{xx}(e^{j\Omega})`}</Tex>、<Tex>{r`H(e^{j\Omega})`}</Tex>，並用時域 <Tex>{r`\sum_kh[k]R_x[k-D]`}</Tex> 交叉驗證。</ErratumNote>
        注意 <Tex>{r`e^{+j\Omega D}`}</Tex> 的符號：寫成 <Tex>{r`e^{-j\Omega D}`}</Tex> 等於延遲 error（測試檔有這個錯號回歸）。
      </p>
      <ModeGate min="engineer">
        <p>
          寬頻 code（AR(1)：<Tex>{r`R_x[m]=\rho_x^{|m|}`}</Tex>，<Tex>{r`E[x^2]=1`}</Tex>）經過同一個 Type-II 迴路，<Tex>{'C_D'}</Tex> 對 <Tex>{'D'}</Tex> 的曲線（由
          F-07.8 的時域形式 <Tex>{r`\sum_k h[k]R_x[k-D]`}</Tex> 計算）：
        </p>
        <Plot
          title={r`寬頻 code 的 $C_D$ vs $D$（Type-II，$\omega_nT_s=0.1$）：延遲大多只讓相關變小`}
          data={wide.data}
          layout={{
            xaxis: { title: { text: 'D [samples]' } },
            yaxis: { title: { text: 'C_D = E[x[n−D]·u[n]]' } },
            shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: 0, y1: 0, line: { dash: 'dot', width: 1 } }],
          }}
          height={300}
          csvName="ch07-wideband-cd"
          caption={
            <>
              由 <Tex>{r`C_D=\sum_kh[k]\,\rho_x^{|k-D|}`}</Tex> 計算（unit-power AR(1) code；<Tex>{'h'}</Tex> 為 <Tex>{r`H_{\mathrm{PD}}`}</Tex> 的脈衝響應）
            </>
          }
        />
        <div className="table-wrap">
          <table className="ch07-table">
            <thead>
              <tr>
                <th className="num">
                  <Tex>{r`\rho_x`}</Tex>
                </th>
                <th className="num">
                  <Tex>{'C_0'}</Tex>
                </th>
                <th className="num">
                  最大 <Tex>{'C_D'}</Tex>（在 <Tex>{'D'}</Tex>）
                </th>
                <th className="num">
                  最小 <Tex>{'C_D'}</Tex>（在 <Tex>{'D'}</Tex>）
                </th>
                <th className="num">
                  filtered-x <Tex>{r`E[u^2]`}</Tex>
                </th>
                <th className="num">
                  最佳 delayed-x 的 <Tex>{'\\rho'}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              {wide.stats.map((st) => (
                <tr key={st.rho}>
                  <td className="num">{st.rho}</td>
                  <td className={`num ${signClass(st.c0)}`}>{fx(st.c0, 5)}</td>
                  <td className="num">
                    {fx(st.cBest, 5)}（{st.bestD}）
                  </td>
                  <td className={`num ${signClass(st.cMin)}`}>
                    {fx(st.cMin, 5)}（{st.minD}）
                  </td>
                  <td className="num ch07-pos">{fx(st.eu2, 5)}</td>
                  <td className="num">{fx(st.cBest / Math.sqrt(st.eu2), 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Callout kind="info" title="讀圖">
          <p>
            寬頻 code 的 <Tex>{r`R_x[m]`}</Tex> 隨 <Tex>{'m'}</Tex> 衰減，延遲通常只把 code 和 <Tex>{'u'}</Tex>「錯開」，相關變小甚至變號
            {wide.stats.every((st) => st.cMin < 0) ? '（表中三種 code 的最小值都是負的）' : ''}。
            Type-II 的 <Tex>{r`h_{\mathrm{PD}}[0]=1`}</Tex>（迴路至少延遲一拍才反應，所以誤差的第一個 sample 原封不動到達 PD；E44），白色 code 的 <Tex>{r`C_D=h_{\mathrm{PD}}[D]`}</Tex>：
            <Tex>{r`C_0=${tx(wide.white0, 4)}`}</Tex>、<Tex>{r`C_1=${tx(wide.white1, 4)}`}</Tex>，最大值在 <Tex>{`D=${wide.whiteBest}`}</Tex>。
            <Tex>{r`\rho_x\to1`}</Tex> 時 code 能量擠到 DC 附近、越來越像單一低頻 tone，才會在某個大 <Tex>{'D'}</Tex> 得到比 <Tex>{'C_0'}</Tex> 大的值
            （<Tex>{r`\rho_x=${wide.stats[2].rho}`}</Tex>：<Tex>{`D=${wide.stats[2].bestD}`}</Tex>）——但那個 <Tex>{'D'}</Tex> 由 code 頻譜決定，
            而且最佳 delayed-x 的正規化相關 <Tex>{r`\rho=C_D/\sqrt{E[x^2]E[u^2]}`}</Tex> 依序只有{' '}
            {wide.stats.map((st, i) => (
              <span key={st.rho}>
                {i > 0 ? '、' : ''}
                <Tex>{tx(st.cBest / Math.sqrt(st.eu2), 3)}</Tex>
              </span>
            ))}
            ，都小於 filtered-x 的 1（7.4 節），code 越低頻差距越大（Type-II 把低頻 code 大幅衰減，又把它的相位轉到接近 <Tex>{r`180^\circ`}</Tex>）。
            Delay alignment 只對<strong>窄頻</strong> code 有意義。<ClaimTag kind="exact" />
          </p>
        </Callout>
      </ModeGate>
    </Section>
  )
}
