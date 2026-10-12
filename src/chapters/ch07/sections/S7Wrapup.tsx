import { useMemo } from 'react'
import { Callout, ClaimTag, Mermaid, ModeGate, Quiz, Recap, Section, SourceTag, StepDerivation, Tex, TexBlock } from '@/components'
import { cArg } from '@/simulation/core'
import { freqz } from '@/simulation/signal'
import { designDtLoop } from '@/simulation/models/pll'
import {
  analyticCorr,
  bestToneDelay,
  empiricalCorr,
  pathTransfer,
  rawPolarityBoundary,
  secondDiffResponse,
  secondDiffTransfer,
  toneCorrCodeDelay,
  type FxCodeSpec,
} from '@/simulation/models/filteredX'
import { CHART_BRINGUP } from '../diagrams'
import { DEG, fx, RAD, signClass, tx } from '../util'

/** 「代入一組寬頻 PLL 的數字」的假設（illustrative）：reference = comparator 取樣率、T(s) 的 −3 dB 頻寬、阻尼、training tone */
const WIDE = { fsHz: 4e9, fbwHz: 320e6, zeta: 0.7, toneHz: 50e6, fracs: [0.3, 0.05, 0.01], seed: 20261010 }

const r = String.raw

/** §7.7–7.9：思考題、本課必記、連結到 PLL 硬體與下一步。 */
export function S7Wrapup() {
  const q1 = bestToneDelay(-90 * RAD, 45 * RAD, 7, 'code')
  const q1err = bestToneDelay(-90 * RAD, 45 * RAD, 7, 'error')
  const q2 = toneCorrCodeDelay({ A: 1, mag: 1, phiRad: 0, omega: Math.PI / 6 }, 3)
  // 思考題 3：Type-II（ω_nT_s = 0.1、ζ = 0.7、d = 0）在 Ω = π/6 的相位與二次差分的相位差（由 freqz 計算）
  const q3 = useMemo(() => {
    const H = pathTransfer({ kind: 'type2_dt', wnTs: 0.1, zeta: 0.7, loopDelay: 0 })
    const om = Math.PI / 6
    const phH = cArg(freqz(H.b, H.a, [om])[0]) * DEG
    const ph2 = cArg(secondDiffResponse(om)) * DEG
    const err = ((((phH - ph2 + 180) % 360) + 360) % 360) - 180
    const code = { kind: 'sinusoid' as const, omega: om }
    return {
      phH,
      ph2,
      err,
      cSd: analyticCorr({ code, h: H, g: secondDiffTransfer(100), D: 0 }) as number,
      cRaw: analyticCorr({ code, h: H, g: null, D: 0 }) as number,
    }
  }, [])
  // ── 寬頻 PLL 的數字例子：loop latency d = 0、1、2（全部由 designDtLoop / freqz / empiricalCorr 計算）──
  const wide = useMemo(
    () =>
      [0, 1, 2].map((d) => {
        const des = designDtLoop({ fbw: WIDE.fbwHz, fs: WIDE.fsHz, zeta: WIDE.zeta, loopDelay: d })
        const path = { kind: 'type2_dt' as const, wnTs: des.wnTs, zeta: WIDE.zeta, loopDelay: d }
        const H = pathTransfer(path)
        const om = (2 * Math.PI * WIDE.toneHz) / WIDE.fsHz
        const z = freqz(H.b, H.a, [om])[0]
        const best = bestToneDelay(cArg(z), om, 400)
        const edge = rawPolarityBoundary(path)
        // DSM code 沒有封閉式 PSD：raw-x 的正規化相關用與 Lab 相同的 code 序列算經驗值。
        // 迴路不穩定時 empiricalCorr 會丟出說明性錯誤：那一格顯示「—」，不讓整頁壞掉
        const rhoRaw = (code: FxCodeSpec): number => {
          try {
            return empiricalCorr({ path, code, mode: 'raw', seed: WIDE.seed }).rho
          } catch {
            return NaN
          }
        }
        return {
          d,
          wnTs: des.wnTs,
          radius: des.spectralRadius,
          stable: des.stable,
          edgeMHz: edge === null ? NaN : (edge * WIDE.fsHz) / (2 * Math.PI) / 1e6,
          toneOmega: om,
          phH: cArg(z) * DEG,
          rhoTone: Math.cos(cArg(z)),
          D: best.D,
          rhoMash: rhoRaw({ kind: 'mash111', frac: 0.3 }),
          rhoDsm1: WIDE.fracs.map((frac) => rhoRaw({ kind: 'dsm1', frac })),
        }
      }),
    [],
  )
  return (
    <>
      <Section kind="explore" level={2} title="7.8 思考題" id="ch07-quiz">
        <Quiz
          title="思考題 1（計算）"
          question={
            <>
              誤差路徑在 code 頻率 <Tex>{r`\Omega=45^\circ/\text{sample}`}</Tex> 的相位是 <Tex>{r`\phi=-90^\circ`}</Tex>。若在 GMAC 的 <strong>code</strong> 端延遲，
              最小的正確 <Tex>{'D'}</Tex> 是多少？
            </>
          }
          options={[{ label: '1' }, { label: '2', correct: true }, { label: '6' }, { label: '8' }]}
          answer={
            <>
              <StepDerivation
                steps={[
                  { tex: r`\theta=\phi+\Omega D=-90^\circ+45^\circ D`, why: <>延遲的是 code，所以相位加 <Tex>{r`\Omega D`}</Tex>（F-07.2）。</> },
                  { tex: r`\theta=0\ \Rightarrow\ D=2`, why: <>解方程式；<Tex>{'D=2'}</Tex> 時 <Tex>{r`\cos\theta=1`}</Tex>，相關最大。</> },
                ]}
              />
              <p>
                程式計算：最佳 <Tex>{`D=${q1.D}`}</Tex>，<Tex>{r`\theta=${tx(q1.thetaDeg, 0)}^\circ`}</Tex>。若把延遲放在 comparator（error）端，要
                <Tex>{`D=${q1err.D}`}</Tex>（<Tex>{r`-90^\circ-45^\circ\times6=-360^\circ`}</Tex>）——方向相反、數字不同。
              </p>
            </>
          }
        />
        <Quiz
          title="思考題 2（模型誤差）"
          question={
            <>
              T07 的單頻例子（<Tex>{r`\Omega=\pi/6`}</Tex>）改用 filtered-x，但 <Tex>{r`\hat H=H\,z^{-3}`}</Tex>（模型多算了 3 個 sample 的 latency）。閉迴路會怎樣？
            </>
          }
          options={[
            { label: <>和 <Tex>{r`\hat H=H`}</Tex> 一樣收斂，只是慢一點</> },
            { label: <>沒有平均恢復力，<Tex>{'w'}</Tex> 隨雜訊漂移</>, correct: true },
            { label: <>發散，因為相位差 <Tex>{r`120^\circ`}</Tex></> },
            { label: <>不受影響：filtered-x 永遠 <Tex>{r`E[u^2]\ge0`}</Tex></> },
          ]}
          answer={
            <p>
              相位差 <Tex>{r`\angle H-\angle\hat H=\Omega\Delta=30^\circ\times3=90^\circ`}</Tex>，所以
              <Tex>{r`E[u\,u_f]=|H|^2\tfrac{A^2}{2}\cos90^\circ=0`}</Tex>（F-07.12）：pole <Tex>{r`p_f=1`}</Tex>，沒有恢復力。<Tex>{r`\Delta=4`}</Tex> 才是 <Tex>{r`120^\circ`}</Tex>、發散。
              「<Tex>{r`E[u^2]\ge0`}</Tex>」只在 <Tex>{r`\hat H=H`}</Tex>、<Tex>{'D=0'}</Tex> 時成立（E45）。對照：<Tex>{'H=1'}</Tex> 時 code 錯位 3 個 sample 也是
              <Tex>{r`C_3=${tx(q2, 4)}`}</Tex>。
            </p>
          }
        />
        <Quiz
          title="思考題 3（硬體選擇）"
          question={
            <>
              Type-II DPLL（<Tex>{r`\omega_nT_s=0.1`}</Tex>、<Tex>{r`\zeta=0.7`}</Tex>、<Tex>{'d=0'}</Tex>），GMAC 用一個 <Tex>{r`\Omega=\pi/6`}</Tex> 的 training tone。為了省面積，能不能用二次差分
              <Tex>{r`(1-z^{-1})^2`}</Tex> 取代完整的 <Tex>{r`\hat H`}</Tex>？
            </>
          }
          options={[
            { label: <>可以，二次差分就是 Type-II 的 <Tex>{r`H_{\mathrm{PD}}`}</Tex></> },
            { label: <>不行：這個頻率的相位差超過 <Tex>{r`90^\circ`}</Tex>；而且這時 raw-x 本來就是對的</>, correct: true },
            { label: <>可以，只要把 <Tex>{'\\mu'}</Tex> 加大</> },
          ]}
          answer={
            <p>
              二次差分只複製 <Tex>{r`H_{\mathrm{PD}}`}</Tex> 的<strong>低頻</strong>漸近線（相位 <Tex>{r`\pi-\Omega=${tx(q3.ph2, 0)}^\circ`}</Tex>），而
              <Tex>{r`\Omega=\pi/6`}</Tex> 已遠高於 <Tex>{r`\omega_nT_s`}</Tex>，真正的 <Tex>{r`\angle H_{\mathrm{PD}}=${tx(q3.phH, 1)}^\circ`}</Tex>：相位差
              <Tex>{r`${tx(q3.err, 1)}^\circ`}</Tex>，超過 F-07.15 的邊界，<Tex>{r`E[u\,u_f]=${tx(q3.cSd, 2)}<0`}</Tex>（unit-power code、<Tex>{r`K_2=100`}</Tex>），極性反過來
              （7.5 節的表；Lab preset「二次差分在中頻 tone 失效」）。這個頻率 <Tex>{r`H_{\mathrm{PD}}\approx1`}</Tex>，raw-x 的 <Tex>{r`C=${tx(q3.cRaw, 3)}`}</Tex> 已經是正的。
              <Tex>{'\\mu'}</Tex> 只改變大小，改不了符號。
            </p>
          }
        />
        <Quiz
          title="思考題 4（正規化相關與校正時間）"
          question={
            <>
              某 regressor 的正規化相關 <Tex>{r`\rho=0.5`}</Tex>。要和 filtered-x（<Tex>{r`\rho=1`}</Tex>）在<strong>同樣的收斂速度</strong> <Tex>{'g'}</Tex> 下得到同樣的
              穩態抖動 <Tex>{r`\sigma_w`}</Tex>，GMAC 的 <Tex>{'N'}</Tex> 要變成幾倍？
            </>
          }
          options={[{ label: '2 倍' }, { label: '4 倍', correct: true }, { label: <>不需要，只要調 <Tex>{'\\mu'}</Tex></> }]}
          answer={
            <>
              <TexBlock>{r`\sigma_w\approx\sqrt{\frac{g}{2N}}\frac{1}{K_q\sqrt{E[u^2]}\,|\rho|}\ \Rightarrow\ \sigma_w\propto\frac{1}{\sqrt N\,|\rho|}\ \Rightarrow\ N\propto\frac1{\rho^2}=4`}</TexBlock>
              <p>
                （7.4 節的推導，<ClaimTag kind="approx" />）固定 <Tex>{'g'}</Tex> 時 <Tex>{'\\mu'}</Tex> 已經被決定，不能再自由調整。
              </p>
            </>
          }
        />
      </Section>

      <Section kind="formula" level={2} title="7.9 本課必記" id="ch07-recap">
        <Recap
          formulas={[
            { label: <>(F-07.2) 延遲 code 的單頻相關［精確｜<Tex>{r`0<\Omega<\pi`}</Tex>，長時間平均］</>, tex: r`\boxed{C_D=\frac{A^2}{2}|H|\cos(\phi+\Omega D)}` },
            { label: '(F-07.3) 延遲 error：符號相反', tex: r`\boxed{C'_D=\frac{A^2}{2}|H|\cos(\phi-\Omega D)}` },
            { label: '(F-07.8) 多頻：PSD 加權（DT 形式，E44）', tex: r`\boxed{C_D=\frac1{2\pi}\int_{-\pi}^{\pi}S_{xx}\,\mathrm{Re}\{H(e^{j\Omega})e^{j\Omega D}\}\,d\Omega}` },
            { label: '(F-07.10/11) Filtered-x block 更新與平均 pole［近似］', tex: r`\boxed{w_{k+1}=w_k+\frac{\mu}{N}\sum_{n\in\text{block }k}q[n]\,u_f[n-D],\quad p_f=1-\mu K_q\,C_{f,D}}` },
            {
              label: (
                <>
                  (F-07.12) 有效相關 <Tex>{r`C_{f,D}=E[u[n]\,u_f[n-D]]`}</Tex>：模型誤差與額外延遲（E45）；<Tex>{'D=0'}</Tex> 時是 <Tex>{r`E[u\,u_f]`}</Tex>
                </>
              ),
              tex: r`\boxed{C_{f,D}=\frac1{2\pi}\int S_{xx}|H||\hat H|\cos(\angle H-\angle\hat H+\Omega D)\,d\Omega}`,
            },
          ]}
          points={[
            <>
              延遲 <Tex>{'D'}</Tex> 個 sample = 線性相位 <Tex>{r`e^{-j\Omega D}`}</Tex>：只能把<strong>一個</strong>頻率的相位轉正（T07：<Tex>{r`-120^\circ+4\times30^\circ=0^\circ`}</Tex>），
              正相關窗只有半個週期。
            </>,
            <>
              延遲放在 code 端是 <Tex>{r`+\Omega D`}</Tex>、放在 comparator 端是 <Tex>{r`-\Omega D`}</Tex>；寫反方向是常見 RTL bug。
            </>,
            <>
              真正的梯度 <Tex>{r`-E[e_{\mathrm{PD}}u]`}</Tex> 用的是 <Tex>{r`u=h*x`}</Tex>；filtered-x 用模型 <Tex>{r`u_f=\hat h*x`}</Tex> 近似它，
              <Tex>{r`\hat H=H`}</Tex>、<Tex>{'D=0'}</Tex> 時 <Tex>{r`E[u^2]\ge0`}</Tex>、<Tex>{r`\rho=1`}</Tex>（Cauchy–Schwarz 最佳）。
            </>,
            <>
              <Tex>{r`\hat H\ne H`}</Tex> 或 <Tex>{r`D\ne0`}</Tex> 時 pole 一律用 <Tex>{r`C_{f,D}=E\big[u[n]\,u_f[n-D]\big]`}</Tex>（<Tex>{'D=0'}</Tex> 時就是{' '}
              <Tex>{r`E[u\,u_f]`}</Tex>）；激勵頻帶上殘餘相位 <Tex>{r`|\angle H-\angle\hat H+\Omega D|<90^\circ`}</Tex> 是充分條件。latency 誤差最危險（線性相位隨頻率增長）。
            </>,
            <>
              Type-II 的二次差分 <Tex>{r`(1-z^{-1})^2`}</Tex> 是幾乎免費的低頻 <Tex>{r`\hat H`}</Tex>，但只適合<strong>窄頻</strong>、低頻（<Tex>{r`\Omega\lesssim\omega_nT_s`}</Tex>）的 tone；
              中頻 tone 變號，寬頻 code 即使低通也幾乎沒有恢復力（F-07.15／F-07.16）。
            </>,
          ]}
        />
      </Section>

      <Section kind="diagram" level={2} title="7.10 連結到 PLL 硬體，以及下一步" id="ch07-pll">
        <div className="table-wrap">
          <table className="ch07-table">
            <thead>
              <tr>
                <th>本章的數學</th>
                <th>DTC / GMAC / PLL 中的硬體</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <Tex>{'D'}</Tex>、<Tex>{r`x[n-D]`}</Tex>
                </td>
                <td>GMAC code 輸入前的 code FIFO／shift register 與 tap MUX（JSON：<code>gm_code_delay_samples</code>）</td>
              </tr>
              <tr>
                <td>
                  <Tex>{r`\hat H`}</Tex>、<Tex>{r`u_f`}</Tex>
                </td>
                <td>在 code 路徑上複製一份 DPLL 誤差路徑：loop filter 係數 <Tex>{r`K_p`}</Tex>、<Tex>{r`K_i`}</Tex> 與 pipeline latency（JSON：<code>filtered_x_model</code>）</td>
              </tr>
              <tr>
                <td>
                  <Tex>{r`(1-z^{-1})^2`}</Tex>
                </td>
                <td>兩個 code 暫存器 + 加法器；增益 <Tex>{r`1/(\omega_nT_s)^2`}</Tex> 併入 learning rate 的 shift</td>
              </tr>
              <tr>
                <td>
                  <Tex>{r`C`}</Tex> 的符號
                </td>
                <td>
                  bring-up 時可量測：把 <Tex>{'w'}</Tex> 固定在 <Tex>{r`w_0\pm\Delta w`}</Tex>，讀 GMAC 平均 <Tex>{r`G_\pm`}</Tex>，
                  <Tex>{r`S_{\mathrm{GMAC}}=(G_+-G_-)/(2\Delta w)\approx-K_qC`}</Tex>（課程第 6 課）；<Tex>{r`S_{\mathrm{GMAC}}<0`}</Tex> 才是正確極性
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>表中「<Tex>{r`C`}</Tex> 的符號」那一列，在 bring-up 時可以直接量出來；流程如下：</p>
        <Mermaid
          chart={CHART_BRINGUP}
          caption={r`bring-up 時量極性：把 $w$ 固定在 $w_0\pm\Delta w$，各讀一次 GMAC 的平均；斜率 $S\approx-K_qC$（藍色），$S<0$ 才是正確極性。`}
        />
        <p>
          先看兩個起點：把 <Tex>{'w'}</Tex> 手動固定在 <Tex>{r`w_0+\Delta w`}</Tex> 與 <Tex>{r`w_0-\Delta w`}</Tex>，各讀一次 GMAC 的長時間平均。因為 <Tex>{r`E[G_k]\approx K_qC\,(a-w)`}</Tex>，所以
          <Tex>{r`G_+\approx K_qC\,(a-w_0-\Delta w)`}</Tex>、<Tex>{r`G_-\approx K_qC\,(a-w_0+\Delta w)`}</Tex>。再看藍色方塊：兩者相減，<Tex>{r`a-w_0`}</Tex> 互相抵消，只剩 <Tex>{r`-2K_qC\,\Delta w`}</Tex>，
          除以 <Tex>{r`2\Delta w`}</Tex> 就是斜率 <Tex>{r`S\approx-K_qC`}</Tex>（和圖上藍色方塊寫的一樣是近似：小訊號線性化）。最後看六角形：<Tex>{r`K_q>0`}</Tex>，所以 <Tex>{r`S<0`}</Tex> 才表示 <Tex>{r`C>0`}</Tex>，可以閉迴路；否則回到 7.6 節的決策流程換一種 regressor。
        </p>
        <p>
          本章只處理「方向對不對」（polarity）與「每單位雜訊的恢復力」（<Tex>{'\\rho'}</Tex>）。方向對了之後，校正迴路本身還有自己的 phase margin：GMAC
          算出的修正量晚幾個 block 才生效（更新延遲），會縮小 <Tex>{'g'}</Tex> 的穩定範圍——這是 Ch08 的主題
          （<Tex>{r`L_{\mathrm{cal}}(z)=g/(z-1)`}</Tex>；GMAC 更新晚 <Tex>{r`d_{\mathrm{upd}}`}</Tex> 個 block 生效時臨界 <Tex>{r`g_{\mathrm{crit}}=2\sin\frac{\pi}{4d_{\mathrm{upd}}+2}`}</Tex>，
          規格 §8.3 記為 <Tex>{'d'}</Tex>；本章的 <Tex>{'d'}</Tex> 是 PLL loop latency，兩者不同）。filtered-x 的 <Tex>{'D'}</Tex> 與 <Tex>{r`\hat H`}</Tex> 的 latency
          不是這一種延遲：它們在 regressor 那一側（前饋），不在校正迴路的回授路徑上。在平均模型裡（<Tex>{'w'}</Tex> 慢變）它們只改變相關 <Tex>{r`C_{f,D}`}</Tex>（F-07.12）——同一個{' '}
          <Tex>{'\\mu'}</Tex> 下 <Tex>{r`g=\mu K_q\,C_{f,D}`}</Tex> 的大小，甚至正負號——不改變 <Tex>{'g'}</Tex> 的穩定上限。
        </p>
        <ModeGate min="engineer">
          <Callout
            kind="info"
            title={
              <>
                代入一組寬頻 PLL 的數字：reference <Tex>{r`f_{\mathrm{ref}}=f_s=4\ \mathrm{GHz}`}</Tex>、閉迴路頻寬 <Tex>{r`320\ \mathrm{MHz}`}</Tex>
              </>
            }
          >
            <p>
              頻寬是 reference 的 <Tex>{r`1/12.5`}</Tex>：把 <Tex>{r`320\ \mathrm{MHz}`}</Tex> 當成 <Tex>{r`T(s)`}</Tex> 的 <Tex>{r`-3\ \mathrm{dB}`}</Tex> 頻寬、<Tex>{r`\zeta=${WIDE.zeta}`}</Tex>，得到
              <Tex>{r`\omega_nT_s=${tx(wide[0].wnTs, 4)}`}</Tex> rad/sample——已經接近 E44 所說「連續時間原型明顯失準」的範圍，必須用離散時間的
              <Tex>{r`H_{\mathrm{PD}}(e^{j\Omega})`}</Tex>，而且 loop latency <Tex>{'d'}</Tex> 每多一拍結果就差很多：
            </p>
            <div className="table-wrap">
              <table className="ch07-table">
                <thead>
                  <tr>
                    <th className="num">
                      loop latency <Tex>{'d'}</Tex>
                    </th>
                    <th className="num">主迴路最大 pole 模</th>
                    <th className="num">
                      raw-x 極性邊界 <Tex>{r`f_b`}</Tex>
                    </th>
                    <th className="num">
                      <Tex>{r`${WIDE.toneHz / 1e6}\ \mathrm{MHz}`}</Tex> tone 的 <Tex>{r`\angle H_{\mathrm{PD}}`}</Tex>
                    </th>
                    <th className="num">
                      該 tone 的 raw-x <Tex>{r`\rho=\cos\phi`}</Tex>
                    </th>
                    <th className="num">
                      對齊它需要的 <Tex>{'D'}</Tex>
                    </th>
                    <th className="num">
                      MASH 1-1-1 code 的 raw-x <Tex>{'\\rho'}</Tex>
                    </th>
                    {WIDE.fracs.map((frac) => (
                      <th className="num" key={frac}>
                        一階 DSM、<Tex>{`\\mathrm{frac}=${frac}`}</Tex>
                        <br />（基頻 {fx(frac * (WIDE.fsHz / 1e6), 0)} MHz）的 raw-x <Tex>{'\\rho'}</Tex>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {wide.map((row) => (
                    <tr key={row.d}>
                      <td className="num">{row.d}</td>
                      <td className="num">
                        {fx(row.radius, 3)}
                        {row.stable ? '' : '（不穩定）'}
                      </td>
                      <td className="num">{fx(row.edgeMHz, 0)} MHz</td>
                      <td className="num">{fx(row.phH, 1)}°</td>
                      <td className={`num ${signClass(row.rhoTone)}`}>{fx(row.rhoTone, 3)}</td>
                      <td className="num">{row.D}</td>
                      <td className={`num ${signClass(row.rhoMash)}`}>{fx(row.rhoMash, 3)}</td>
                      {row.rhoDsm1.map((v, i) => (
                        <td key={WIDE.fracs[i]} className={`num ${signClass(v)}`}>
                          {fx(v, 3)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              讀表：(1) <Tex>{r`f_b`}</Tex> 是 <Tex>{r`\mathrm{Re}\{H_{\mathrm{PD}}\}`}</Tex> 由負變正的頻率——code 或 training tone 的能量若低於它，raw-x GMAC 的
              <Tex>{r`C<0`}</Tex>，gain 校正會反向更新；loop latency 多 1–2 拍，<Tex>{r`f_b`}</Tex> 就從 {fx(wide[0].edgeMHz, 0)} MHz 上移到 {fx(wide[2].edgeMHz, 0)} MHz
              （連續時間原型會告訴你邊界在 <Tex>{r`\omega_n/2\pi=${tx((wide[0].wnTs * WIDE.fsHz) / (2 * Math.PI) / 1e6, 0)}\ \mathrm{MHz}`}</Tex>，偏低）。
              (2) {WIDE.toneHz / 1e6} MHz 的 tone（<Tex>{r`\Omega=${tx(wide[0].toneOmega, 4)}`}</Tex>）相位接近 <Tex>{r`180^\circ`}</Tex>，delay alignment 要 {wide[2].D}–{wide[0].D}
              級的 code FIFO，而且只對這一個頻率有效。(3) DSM code 要看<strong>階數</strong>：MASH 1-1-1 的 residue 被 noise shaping 推到高頻
              （<Tex>{r`H_{\mathrm{PD}}\approx1`}</Tex>），不論 FCW 是多少 raw-x 的 <Tex>{'\\rho'}</Tex> 都接近 1，不需要補償。一階 DSM（phase accumulator）的 residue
              卻是基頻 <Tex>{r`\mathrm{frac}\cdot f_{\mathrm{ref}}`}</Tex> 的 sawtooth：FCW 的小數越靠近整數（near-integer，規格 §11.4），基頻越低於
              <Tex>{r`f_b`}</Tex>，PD 端只剩 sawtooth 跳變的高頻邊緣，和原始 code 幾乎不相關——<Tex>{'\\rho'}</Tex> 從 {fx(wide[0].rhoDsm1[0], 2)} 掉到
              {' '}{fx(wide[0].rhoDsm1[2], 2)}（<Tex>{'d=0'}</Tex>）；<Tex>{`d=2,\\ \\mathrm{frac}=${WIDE.fracs[1]}`}</Tex> 時是 {fx(wide[2].rhoDsm1[1], 3)}
              {wide[2].rhoDsm1[1] < 0 ? <strong>（變號：raw-x 反向更新）</strong> : null}。
            </p>
            <p>
              所以「GMAC 的極性對不對」取決於 <strong>code 的頻譜落在 <Tex>{r`f_b`}</Tex> 的哪一邊</strong>：同一顆晶片只是換了 channel（FCW）或 code pattern，
              raw-x 的恢復力就可能消失甚至翻號；filtered-x（<Tex>{r`\hat H=H`}</Tex>）在每一格都是 <Tex>{r`\rho=1`}</Tex>。Lab 的 preset「FCW 與一階 DSM code」可以直接看閉迴路。
              完整的 GOS／PHOS 分析見 <a href="#/case/sspll">案例頁：SSPLL 的 GOS / PHOS 極性</a>。 <ClaimTag kind="exact" /> <SourceTag kind="simulation" />
            </p>
            <p className="small muted">
              假設：Type-II 迴路、<Tex>{r`\zeta=${WIDE.zeta}`}</Tex>、PD／comparator 與 PLL 同一取樣率（E44 的 DT 參考模型）；DSM 各欄是 20-bit、無 dither 的 DTC phase residue
              （standardize），以 32,768 個 sample 的時間平均估計（MASH 一欄 <Tex>{r`\mathrm{frac}=0.3`}</Tex>；seed {WIDE.seed}）。這些是 illustrative 的行為模型數字，不是任何晶片的量測；實際迴路的 <Tex>{r`\zeta`}</Tex>、latency 與 pulse shape 要代入自己的設計值。
            </p>
          </Callout>
        </ModeGate>
        <p className="small muted">
          下一個值得研究的問題：<Tex>{r`\hat H`}</Tex> 能不能線上學？（用 code 與 PD 誤差的互相關估計 <Tex>{'h'}</Tex>，即 FxLMS 的 secondary-path identification；
          需要額外的 excitation 與第二個 LMS，兩個迴路的時間尺度分離見 Ch08 §8.4。）<ClaimTag kind="research" />
        </p>
        <p className="small muted">
          數字複習：T07 的 <Tex>{r`C_4=${tx(toneCorrCodeDelay({ A: 1, mag: 1, phiRad: -120 * RAD, omega: Math.PI / 6 }, 4), 4)}`}</Tex>、
          <Tex>{r`C_0=${tx(toneCorrCodeDelay({ A: 1, mag: 1, phiRad: -120 * RAD, omega: Math.PI / 6 }, 0), 4)}`}</Tex>（<Tex>{'A=|H|=1'}</Tex>）；
          思考題 1 的最佳 <Tex>{'D'}</Tex> = {fx(q1.D, 0)}。
        </p>
      </Section>
    </>
  )
}
