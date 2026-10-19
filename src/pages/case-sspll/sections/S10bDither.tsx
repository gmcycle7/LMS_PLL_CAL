import { useMemo, useState } from 'react'
import type { Data } from 'plotly.js-cartesian-dist-min'
import { Callout, CodeBlock, ModeGate, Plot, Quiz, Section, SelectControl, StepDerivation, Tex, useThemeTokens } from '@/components'
import {
  CODE_RANGE,
  CODE_SOURCES,
  codeVerdict,
  dqLineWeight,
  dqWhite,
  efoldVerdict,
  gammaEff,
  gosCode,
  inversionBands,
  kappaModeCode,
  kappaPhosCode,
  kernelMean,
  largeSignalCode,
  loopH,
  loopImpulse,
  mashFactors,
  rotFactor,
  type CodeSource,
} from '@/simulation/models/sspll'
import pyDither from '../../../../analysis/sspll/golden/sspll_golden/dither_interaction.py?raw'
import certSrc from '../codeCertificate.ts?raw'
import { CERT_NF, CERT_TAU, PM_SWEEP, certificateTable, interpThreshold, pmSweepRow, type CertStatus } from '../codeCertificate'
import { BAND, DITHER, DITHER_NUM, FREF_MHZ, LOOPS, SIM_CFG } from '../data'
import { Claim, DataTable, Diagram, FigRef, Formula, Hand, Kappa, ModelCode, Src, TryIt, fmtFs, fx, r, tx } from '../common'
import { CODE_LOOPS, CODE_LOOP_TEX, CODE_SOURCE_TEX, CODE_TAU, CodeSourceLab, codeSourceVerdict, type CodeLoopKey } from '../experiments/CodeSourceLab'

const PY_PATH = 'analysis/sspll/golden/sspll_golden/dither_interaction.py'
/** 時域 sim（sim_dither_extract.json）存的 κ_PHOS 的鍵 */
const SIM_KEY: Record<CodeLoopKey, string | null> = { L2: 'L2_pm60', L2_pm45: null, L3: 'L3_imp_pm60' }
const SOURCE_SHORT: Record<CodeSource, string> = { acc1: 'acc1（raw）', dq: 'dq', mash: 'MASH', rot4: 'rot4', rot8: 'rot8' }

/** κ_min 對 α 的掃描（closed form，100 個 α × 5 種 source）：kmax = 128 條線 + 等分佈尾項，和 1024 條只差 10⁻⁴ */
export function kappaMinSweep(loop: CodeLoopKey, nAlpha = 100): { alpha: number[]; kappaMin: Record<CodeSource, number[]> } {
  const lp = CODE_LOOPS[loop]
  const mean = kernelMean(gammaEff(lp)).re
  const alpha = Array.from({ length: nAlpha }, (_, i) => (0.5 * (i + 1)) / nAlpha)
  const kappaMin = Object.fromEntries(CODE_SOURCES.map((s) => [s, alpha.map((a) => kappaPhosCode(lp, a, s, 128, mean).kappaMin)])) as Record<CodeSource, number[]>
  return { alpha, kappaMin }
}

/** κ_min 對 α·f_ref 的圖：五種 code source、可選迴路；dead-zone 帶 ±τ 用兩條虛線標出 */
function KappaAlphaPlot() {
  const tokens = useThemeTokens()
  const [loop, setLoop] = useState<CodeLoopKey>('L2_pm45')
  const sweep = useMemo(() => kappaMinSweep(loop), [loop])
  const data: Data[] = useMemo(() => {
    const f = sweep.alpha.map((a) => a * FREF_MHZ)
    const out: Data[] = CODE_SOURCES.map((s, i) => ({ x: f, y: sweep.kappaMin[s], name: CODE_SOURCE_TEX[s], mode: 'lines', line: { color: tokens.series[i], width: s === 'mash' ? 2.6 : 1.8 } }))
    // golden 的 numeric（實際序列的線性相關）與時域 sim 的點
    const num = DITHER_NUM.numeric
    const alphas = DITHER_NUM._meta.selected_alphas
    const simKey = SIM_KEY[loop]
    for (const s of ['mash', 'dq'] as CodeSource[]) {
      const rows = num[`${loop}|${s}`]
      if (rows) out.push({ x: alphas.map((a) => a * FREF_MHZ), y: alphas.map((a) => rows[String(a)]?.kappa_min ?? null), name: `${SOURCE_SHORT[s]}：golden numeric（實際序列）`, mode: 'markers', marker: { size: 7, symbol: 'diamond-open', color: tokens.series[CODE_SOURCES.indexOf(s)] } })
      if (simKey && DITHER.dither[`${simKey}|${s}`]) {
        const sim = DITHER.dither[`${simKey}|${s}`]
        const xs = Object.keys(sim).map(Number)
        out.push({ x: xs.map((a) => a * FREF_MHZ), y: xs.map((a) => sim[String(a)].kP), name: `${SOURCE_SHORT[s]}：時域 sim（§11.4）`, mode: 'markers', marker: { size: 6, symbol: 'x', color: tokens.series[CODE_SOURCES.indexOf(s)] } })
      }
    }
    return out
  }, [sweep, loop, tokens])
  return (
    <div className="card">
      <div className="cs-inline-controls">
        <SelectControl label="迴路" value={loop} onChange={setLoop} options={(Object.keys(CODE_LOOPS) as CodeLoopKey[]).map((k) => ({ value: k, label: k === 'L2' ? 'L2（PM 60°）' : k === 'L2_pm45' ? 'L2 PM 45°' : 'L3' }))} />
      </div>
      <Plot
        title={`${CODE_LOOP_TEX[loop]}：五種 code source 的 $\\kappa_{\\min}=\\min_m\\mathrm{Re}\\,\\kappa_m$ 對 $\\alpha f_{ref}$（closed form，F-CS.27）`}
        data={data}
        xLog
        height={360}
        csvName={`sspll-code-kappa-min-${loop}`}
        layout={{
          xaxis: { title: { text: '$\\alpha\\cdot f_{\\mathrm{ref}}$ [MHz]' } },
          yaxis: { title: { text: '$\\kappa_{\\min}$（$>0$ restoring；$<0$ 反號）' }, range: [-0.45, 1.25] },
          shapes: [
            { type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 0, y1: 0, line: { color: tokens.textMuted, width: 1 } },
            { type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: CODE_TAU, y1: CODE_TAU, line: { color: tokens.textMuted, width: 1, dash: 'dot' } },
            { type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: -CODE_TAU, y1: -CODE_TAU, line: { color: tokens.textMuted, width: 1, dash: 'dot' } },
          ],
        }}
        caption={`線是 TS port 即時算的 closed form（$\\alpha=0.005\\ldots0.5$）；菱形是 golden 在實際序列上量的線性相關（numeric），叉是 §11.4 的時域 sim（只有 L2、L3 有）。兩條點線是 dead zone 的 $\\pm\\tau=\\pm${CODE_TAU}$。rot8 整條都是 1（看不出起伏），acc1 就是 §8 的 $\\kappa_{PHOS}$。`}
      />
    </div>
  )
}

/** §10b：DSM dither、MASH 與 PMUX 隨機旋轉和 LMS 的交互——推導、判定式、為什麼 L2-PM45 搭 MASH 在 α = 0.03 發散（含實驗 D）。 */
export function S10bDither() {
  const hl = DITHER_NUM.headline
  const pm45 = CODE_LOOPS.L2_pm45
  // 即時計算的 headline 數字（TS port；與 ditherNumbers.json 的 headline 相同，sspll.test.ts 比對）
  const live = useMemo(() => {
    const f1 = mashFactors(1)
    const h45 = Array.from(loopImpulse(pm45, 3))
    const h60 = Array.from(loopImpulse(LOOPS.L2, 3))
    const a = 0.03
    const g45 = loopH(pm45, a).re
    const g60 = loopH(LOOPS.L2, a).re
    const terms = (h: number[], g: number) => [f1.phi2 * g, h[0] * f1.rtilde[0], h[1] * Math.cos(2 * Math.PI * a) * f1.rtilde[1], h[2] * Math.cos(4 * Math.PI * a) * f1.rtilde[2]]
    const t45 = terms(h45, g45)
    const t60 = terms(h60, g60)
    const v45 = codeVerdict(pm45, a, 'mash')
    const v60 = codeVerdict(LOOPS.L2, a, 'mash')
    return {
      f1,
      h45,
      h60,
      g45,
      g60,
      t45,
      t60,
      k45: kappaModeCode(pm45, a, 'mash', 1),
      k60: kappaModeCode(LOOPS.L2, a, 'mash', 1),
      raw45: kappaModeCode(pm45, a, 'acc1', 1),
      v45,
      v60,
      ls45: largeSignalCode(pm45, a, 'mash', 1, [1, 5], SIM_CFG),
      ls60: largeSignalCode(LOOPS.L2, a, 'mash', 1, [1, 5], SIM_CFG),
      // PM 45° 的反號帶（帶緣、谷底）與 MASH 掉進 dead zone 的頻率範圍（1 MHz 格點）；PM 60° 的帶用 data.ts 的 BAND
      band45: inversionBands(pm45)[0],
      dead45: (() => {
        let lo = Infinity
        let hi = -Infinity
        for (let f = 1; f <= 400; f++) {
          if (Math.abs(kappaPhosCode(pm45, f / FREF_MHZ, 'mash').kappaMin) <= CODE_TAU) {
            lo = Math.min(lo, f)
            hi = Math.max(hi, f)
          }
        }
        return { lo, hi }
      })(),
      // 試試看：L2、80 MHz 的 dq；PM 45° 帶緣之外 180 MHz 的 MASH
      dq80: kappaPhosCode(LOOPS.L2, 80 / FREF_MHZ, 'dq').kappaMin,
      mash180: kappaPhosCode(pm45, 180 / FREF_MHZ, 'mash').kappaMin,
      // 觀測窗（golden 的 MC：1500 blocks、N_τ = 25）內 F-CS.2 平均模型的倍數：closed form 與實際序列的線性相關（golden numeric）
      w45: efoldVerdict(kappaModeCode(pm45, a, 'mash', 1), 1500, 25),
      w45num: efoldVerdict(DITHER_NUM.numeric['L2_pm45|mash']['0.03'].kappa_min, 1500, 25),
      // 試試看：κ_∞ 判準的反例（preset code-l3-dq：L3、40 MHz、dq）與同一點的 MASH
      l3dq: codeSourceVerdict(CODE_LOOPS.L3, 0.01, 'dq'),
      l3mash: kappaPhosCode(LOOPS.L3, 0.01, 'mash').kappaMin,
      // 初始 PHOS 誤差（−ε，seed 7）在各模態的功率比例：DFT 的 |E_m|² / Σ_{m≥1}|E_m|²
      epsShare: (() => {
        const e = SIM_CFG.epsPs
        const p = Array.from({ length: 8 }, (_, m) => {
          let re = 0
          let im = 0
          for (let k = 0; k < 8; k++) {
            re += e[k] * Math.cos((2 * Math.PI * m * k) / 8)
            im -= e[k] * Math.sin((2 * Math.PI * m * k) / 8)
          }
          return re * re + im * im
        })
        const tot = p.slice(1).reduce((x, y) => x + y, 0)
        return p.map((x) => x / tot)
      })(),
      // 思考題 2：L2（PM 60°）的谷底（BAND.L2 的 fMin，約 83.8 MHz）
      valley: (() => {
        const av = (BAND.L2?.fMin ?? 83.8) / FREF_MHZ
        const g = loopH(LOOPS.L2, av).re
        const t = terms(h60, g)
        return { alpha: av, g, t, k: kappaModeCode(LOOPS.L2, av, 'mash', 1), min: Math.min(...kappaMinSweep('L2', 200).kappaMin.mash) }
      })(),
    }
  }, [pm45])
  const factors = useMemo(
    () =>
      [1, 2, 3, 4].map((m) => ({
        m,
        phi2: mashFactors(m).phi2,
        r1: mashFactors(m).rtilde[1],
        white: dqWhite(m),
        v0: dqLineWeight(m, 0),
        d4: rotFactor(4, m),
        d8: rotFactor(8, m),
      })),
    [],
  )
  const gosRows = useMemo(() => CODE_SOURCES.map((s) => ({ s, g: gosCode(LOOPS.L2, 0.03, s), num: DITHER_NUM.numeric[`L2|${s}`]['0.03'], sim: DITHER.dither[`L2_pm60|${s}`]?.['0.03']?.kG })), [])
  const cmp = DITHER_NUM.sim_compare
  const mcSum = DITHER_NUM.mc._summary
  const twoDz = mcSum.candidates.two_stage.dead_zone
  const headlineMc = DITHER_NUM.mc['L2_pm45|mash']['0.03']
  const hlGrowth = median(headlineMc.final_fs) / headlineMc.init_fs
  // κ_∞ 判準的兩個反例（審查指出）：最差模態的 κ_∞ 很負，golden 卻沒有任何 seed 發散
  const ceAcc = DITHER_NUM.mc['L3|acc1']['0.253']
  const ceDq = DITHER_NUM.mc['L3|dq']['0.01']
  const pm60Mc = DITHER_NUM.mc['L2|mash']['0.03']
  const simLms = DITHER.lms['L2_pm45|mash']?.['0.03|raw']?.final_phos_rms_fs
  const simLms60 = DITHER.lms['L2_pm60|mash']?.['0.03|raw']?.final_phos_rms_fs
  const cmpAlphas = ['0.01', '0.03', '0.253', '0.496']
  const tri = (loop: CodeLoopKey, s: CodeSource, a: string) => {
    const row = cmp[`${loop}|${s}`]?.[a]
    if (!row) return '—'
    return (
      <>
        <Kappa v={row.closed} digits={3} />／<Kappa v={row.numeric} digits={3} />／{row.sim !== undefined ? <Kappa v={row.sim} digits={3} /> : '—'}
      </>
    )
  }
  return (
    <Section kind="formula" level={2} title="10b. DSM dither、MASH 與 PMUX 隨機旋轉：為什麼 L2-PM45 搭 MASH 在 $\alpha=0.03$ 發散" id="cs-10b">
      <p>
        §11.4 的表（下一節）列了時域 sim 的結果：dithered quantizer 只「部分有效」、MASH 幾乎都修好、PMUX 隨機旋轉 8 相全部修好——但 L2-PM45 搭 MASH 在 <Tex>{r`\alpha=0.03`}</Tex>（120 MHz）仍發散到 {fmtFs(simLms)}，原本標成「理論無法解釋」的研究假說。這一節把 §8 的模態分析延伸到<strong>隨機化的 code</strong>，得到一條 closed form（F-CS.27）、判定式（F-CS.28）與「任何頻道都安全」的全頻道證書（F-CS.29，§10b.8），並用 golden 的 105 組（3 個迴路 × 5 種 source × 7 個 <Tex>{r`\alpha`}</Tex>）× 8 seeds 閉迴路驗證：F-CS.28 的線性段與多數一致 {mcSum.n_ok} 組、不一致 {mcSum.n_mismatch} 組、dead zone 不判 {mcSum.n_na} 組。dead zone 之後的結局還沒有解：本來想用 1-bit 大訊號斜率 <Tex>{r`\kappa_\infty`}</Tex> 當第二段判定，但它在 {mcSum.n_dead} 個 dead zone 案例裡 {twoDz.n_ok} 個一致、{twoDz.n_mismatch} 個不一致、{twoDz.n_na} 個不判（§10b.7），所以只當研究假說的提示。答案先講：
      </p>
      <Callout kind="info" title="一句話的答案">
        <p>
          隨機化只把 mode-1 regressor 的一部分功率從載波 <Tex>{r`\alpha f_{ref}`}</Tex> 攤到高頻（<Tex>{r`\mathrm{Re}\,H_{PD}\approx1`}</Tex> 的地方），<strong>留在載波上的比例</strong>是 code 隨機部分的特徵函數 <Tex>{r`\lvert\phi_1\rvert^2`}</Tex>：dq {fx(100 * dqLineWeight(1, 0), 0)}%、MASH {fx(100 * live.f1.phi2, 0)}%、rot4 {fx(100 * rotFactor(4, 1), 0)}%、rot8 0%。MASH 之下 <Tex>{`\\mathrm{Re}\\,\\kappa_1\\approx${tx(live.f1.phi2, 3)}\\,\\mathrm{Re}\\,H_{PD}(\\alpha)+${tx(live.f1.rtilde[0] + live.t45[2] + live.t45[3], 2)}`}</Tex>：PM 60° 在 120 MHz 的{' '}
          <Tex>{`\\mathrm{Re}\\,H_{PD}=${tx(live.g60, 3)}`}</Tex>，<Tex>{`\\kappa_1=${tx(live.k60, 3)}`}</Tex>（restoring）；PM 45° 的反號帶更深、更寬，120 MHz 正好在谷底附近（<Tex>{`\\mathrm{Re}\\,H_{PD}=${tx(live.g45, 3)}`}</Tex>），載波項 <Tex>{`${tx(live.t45[0], 3)}`}</Tex> 幾乎抵掉散開的正項，<Tex>{`\\kappa_1=${tx(live.k45, 4)}`}</Tex>——dead zone：恢復力只剩名義值的 {fx(100 * live.k45, 0)}%，LMS 校不回來。
          <Claim kind="approx">這一半有 closed form（F-CS.27），golden 逐項核對</Claim>
        </p>
        <p>
          至於為什麼誤差不是停在原地，而是 1500 blocks 長到初值的 {fx(hlGrowth, 1)} 倍（golden {headlineMc.n_div}/{headlineMc.n} 個 seeds 發散、本頁實驗 D 可重現），線性模型說不出來：它在這個觀測窗只預測慢慢縮到 <Tex>{`${tx(live.w45.growth, 2)}`}</Tex> 倍。1-bit 比較器的大訊號斜率 <Tex>{`\\kappa_\\infty=${tx(live.ls45.kappaInf, 3)}<0`}</Tex>（§10.4 的「持續時間」效應）是候選解釋，可是把它當判準，golden 的 {mcSum.n_dead} 個 dead zone 案例錯了 {twoDz.n_mismatch} 個。
          <Claim kind="research">dead zone 之後「長大」的機制</Claim>
        </p>
      </Callout>
      <Diagram id="code-sources" />
      <p>
        先看四格的共同點：不管隨機化加在哪裡，PMUX 的總指標 <Tex>{'P[n]'}</Tex>（整數，選相 <Tex>{r`p=P\bmod8`}</Tex>）加上 DTC 的 code <Tex>{'c[n]'}</Tex> 永遠等於理想的總相位 <Tex>{r`\Phi[n]=8n\alpha`}</Tex>（以 <Tex>{r`\Delta`}</Tex> 為單位）加一個常數——總補償量不變，變的只是「PMUX 多跳幾相、DTC 多補幾格」的分配，所以 DTC range 從 <Tex>{r`1\Delta`}</Tex> 變成 2、4、8 格。dq 在量化器前加一個均勻的 <Tex>{'u'}</Tex>：以機率 <Tex>{r`\rho`}</Tex> 多跳一相；MASH 把三級累加器的餘數 <Tex>{r`r=(1-z^{-1})^2e_3`}</Tex>（高通整形，<Tex>{r`\in(-2,2)`}</Tex>）交給 DTC；rot<Tex>{'M'}</Tex> 直接在指標後加一個 iid 的 <Tex>{r`m\in\{0..M-1\}`}</Tex>。
      </p>

      <h3>10b.1 一步一步：載波與散開</h3>
      <p>
        §8 把 one-hot regressor 拆成 DFT 模態 <Tex>{r`z_m[n]=e^{j2\pi mp[n]/8}`}</Tex>。因為 <Tex>{r`e^{j2\pi m\cdot8k/8}=1`}</Tex>，把 <Tex>{'p'}</Tex> 換成總指標 <Tex>{'P'}</Tex> 也一樣；再把 <Tex>{r`P=\Phi-\tilde c-`}</Tex> 常數代進去，載波和隨機部分就分開了：
      </p>
      <StepDerivation
        steps={[
          { tex: r`z_m[n]=e^{j2\pi mP[n]/8}`, why: <>模態 <Tex>{'m'}</Tex> 的 regressor（§8.1）；<Tex>{r`P\equiv p\pmod 8`}</Tex>，所以用 <Tex>{'P'}</Tex> 或 <Tex>{'p'}</Tex> 都一樣。</> },
          { tex: r`=e^{j2\pi m\Phi[n]/8}\,e^{-j2\pi m\tilde c[n]/8}\cdot\text{常數}=e^{j2\pi m\alpha n}\,u_m[n],\qquad u_m\equiv e^{-j\theta_m\tilde c},\ \theta_m=\tfrac{\pi m}{4}`, why: <><Tex>{r`\Phi/8=n\alpha`}</Tex>；<Tex>{r`\tilde c`}</Tex> 是 code 的隨機部分（偏移是常數相位，之後取模平方就不見了）。每一格 <Tex>{r`\Delta`}</Tex> 的 code 讓模態 <Tex>{'m'}</Tex> 轉 <Tex>{r`\theta_m`}</Tex>。</> },
          { tex: r`u_m=\phi_m+\tilde u_m,\qquad\phi_m\equiv E[u_m]=E\big[e^{-j\theta_m\tilde c}\big],\quad E[\tilde u_m]=0`, why: <>把 <Tex>{'u'}</Tex> 拆成平均（隨機變數 <Tex>{r`\tilde c`}</Tex> 的特徵函數在 <Tex>{r`\theta_m`}</Tex> 的值）與零均值的起伏。</> },
          { tex: r`S_{z_m}(f)=\lvert\phi_m\rvert^2\,\delta(f-m\alpha)+S_{\tilde u_m}(f-m\alpha),\qquad\lvert\phi_m\rvert^2+\textstyle\int S_{\tilde u_m}=1`, why: <>乘上載波只是把頻譜平移 <Tex>{r`m\alpha`}</Tex>；<Tex>{r`\lvert u\rvert=1`}</Tex> 所以總功率是 1：留在載波的 <Tex>{r`\lvert\phi\rvert^2`}</Tex> 加散開的 <Tex>{r`1-\lvert\phi\rvert^2`}</Tex>。</> },
          { tex: r`\mathrm{Re}\,\kappa_m=\big\langle\overline{z_m}\,(h_{PD}*z_m)\big\rangle=\sum_{k\ge0}h_{PD}[k]\,\mathrm{Re}\big(e^{-j2\pi m\alpha k}R_{u_m}[k]\big)`, why: <>§4.3／F-CS.3 的時域寫法：regressor 與「它通過迴路之後」的相關；<Tex>{r`R_{u}[k]=E[u[n]\overline{u[n-k]}]`}</Tex>。</> },
          { tex: r`=\lvert\phi_m\rvert^2\,\mathrm{Re}\,H_{PD}(\mathrm{frac}(m\alpha))+\sum_{k\ge0}h_{PD}[k]\cos(2\pi m\alpha k)\,\tilde R_m[k],\qquad\tilde R_m[k]\equiv R_{u_m}[k]-\lvert\phi_m\rvert^2`, why: <><Tex>{r`R_u[k]\to\lvert\phi\rvert^2`}</Tex>（<Tex>{'k'}</Tex> 大時獨立）那一部分加總成 <Tex>{r`\mathrm{Re}\,H_{PD}`}</Tex> 的 Fourier 級數；剩下的 <Tex>{r`\tilde R`}</Tex> 只有前幾個 <Tex>{'k'}</Tex> 非零（短記憶），而且 <Tex>{r`h_{PD}[0]=1`}</Tex> 讓 <Tex>{r`\tilde R[0]=1-\lvert\phi\rvert^2`}</Tex> 整個算進來、永遠是正的。</> },
        ]}
      />
      <Formula id="F-CS.26" />
      <p>
        <Claim kind="exact">
          給定 <Tex>{r`\tilde c`}</Tex> 的特徵函數與自相關，F-CS.26 在線性小訊號、凍結權重、<Tex>{'D=0'}</Tex> 的模型內精確；acc1（<Tex>{r`\tilde c=\rho`}</Tex> 鋸齒，<Tex>{r`\tilde R=0`}</Tex>）時退回 F-CS.13 的階梯線
        </Claim>
        這條式子就是 <FigRef id="code-path" /> 的路徑：載波落不落在反號帶、散開的部分永遠是正項、兩者相加才是 LMS 看到的符號。本節（與實驗 D）談正負、和 <Tex>{r`\pm\tau`}</Tex> 比大小的 <Tex>{r`\kappa_m`}</Tex>、<Tex>{r`\kappa_1`}</Tex>、<Tex>{r`\kappa_{\min}`}</Tex> 一律是實部 <Tex>{r`\mathrm{Re}\,\kappa_m`}</Tex>（F-CS.26 算的就是實部；虛部只讓模態旋轉，§8）。
      </p>
      <Diagram id="code-path" />

      <h3>
        10b.2 四種 code source 的 <Tex>{r`\lvert\phi_m\rvert^2`}</Tex> 與 <Tex>{r`\tilde R_m`}</Tex>
      </h3>
      <p>
        只剩一件事：算每一種隨機化的特徵函數。三種都可以紙筆做（HC-CS.11、HC-CS.12）：
      </p>
      <ul>
        <li>
          <strong>MASH 1-1-1</strong>：<Tex>{r`\tilde c=e_3[n]-2e_3[n-1]+e_3[n-2]`}</Tex>，把第三級的餘數 <Tex>{'e_3'}</Tex> 當成 iid 均勻 <Tex>{'[0,1)'}</Tex>。均勻數 <Tex>{'e'}</Tex> 的特徵函數是 <Tex>{r`\lvert E[e^{-jte}]\rvert=\mathrm{sinc}(t/2)`}</Tex>，獨立和的特徵函數相乘：<Tex>{r`\phi_m=\mathrm{sinc}^2(\theta_m/2)\,\mathrm{sinc}(\theta_m)`}</Tex>，<Tex>{'m=1'}</Tex> 時{' '}
          <Tex>{`\\lvert\\phi_1\\rvert^2=${tx(live.f1.phi2, 4)}`}</Tex>。相鄰兩拍 <Tex>{r`\tilde c[n]-\tilde c[n-1]`}</Tex> 的係數是 <Tex>{r`[1,-3,3,-1]`}</Tex>、隔兩拍是 <Tex>{r`[1,-2,0,2,-1]`}</Tex>，所以 <Tex>{r`\tilde R[1]`}</Tex>、<Tex>{r`\tilde R[2]`}</Tex> 也是 sinc 的乘積減 <Tex>{r`\lvert\phi\rvert^2`}</Tex>（<Tex>{`${tx(live.f1.rtilde[1], 4)}`}</Tex>、<Tex>{`${tx(live.f1.rtilde[2], 4)}`}</Tex>），<Tex>{r`k\ge3`}</Tex> 完全獨立。
        </li>
        <li>
          <strong>dithered quantizer</strong>：給定鋸齒 <Tex>{r`\rho`}</Tex>，PMUX 多跳一相的機率是 <Tex>{r`\rho`}</Tex>，regressor 的條件平均是 <Tex>{r`e^{-j\theta\rho}\big((1-\rho)+\rho e^{j\theta}\big)`}</Tex>——仍是 <Tex>{r`\rho`}</Tex> 的週期函數，Fourier 係數 <Tex>{'v_k'}</Tex> 給階梯線的權重，基波 <Tex>{r`\lvert v_0\rvert^2=\big(\tfrac{2(1-\cos\theta)}{\theta^2}\big)^2=W_1^2=0.902`}</Tex>；條件變異數 <Tex>{r`2\rho(1-\rho)(1-\cos\theta)`}</Tex> 對 <Tex>{r`\rho`}</Tex> 平均成白雜訊{' '}
          <Tex>{r`(1-\cos\theta)/3=0.098`}</Tex>。dither 把 raw 的 5% 高次階梯線變成白雜訊，但載波仍留 90%——所以「只部分有效」。
        </li>
        <li>
          <strong>PMUX 隨機旋轉 <Tex>{'M'}</Tex> 相</strong>：<Tex>{r`u=e^{-j\theta\rho}\,e^{j\theta m}`}</Tex>，iid 的 <Tex>{'m'}</Tex> 把每條階梯線乘上 <Tex>{r`\lvert D_M\rvert^2=\big\lvert\tfrac1M\sum_{r<M}e^{j\theta r}\big\rvert^2=\tfrac{\sin^2(M\theta/2)}{M^2\sin^2(\theta/2)}`}</Tex>，殺掉的功率變成白雜訊。<Tex>{'M=8'}</Tex> 時對每個 <Tex>{r`m\ne0`}</Tex> 都是 0：regressor 完全白化，<Tex>{r`\kappa_m=1`}</Tex>——這就是 sim 裡 rot8 不分 <Tex>{r`\alpha`}</Tex> 全部收斂到 4 fs 的原因；<Tex>{'M=4'}</Tex> 只殺掉 mode 2、4、6（<Tex>{r`\theta=\pi/2,\pi,3\pi/2`}</Tex>），mode 1 剩 43%。
        </li>
      </ul>
      <DataTable
        className="cs-num"
        caption="各模態的頻譜因子（只和 $\theta_m=\pi m/4$ 有關，與迴路、$\alpha$ 無關）。mode $8-m$ 與 mode $m$ 相同。"
        head={['$m$', 'MASH $\\lvert\\phi_m\\rvert^2$', 'MASH $\\tilde R_m[1]$', 'dq 白雜訊', 'dq $\\lvert v_0\\rvert^2$', 'rot4 $\\lvert D_4\\rvert^2$', 'rot8 $\\lvert D_8\\rvert^2$']}
        rows={factors.map((f) => [String(f.m), fx(f.phi2, 4), fx(f.r1, 4), fx(f.white, 4), fx(f.v0, 4), fx(f.d4, 4), fx(f.d8, 4)])}
      />
      <Formula id="F-CS.27" />
      <p>
        <Claim kind="approx">
          隨機部分當成 iid（MASH：<Tex>{'e_3'}</Tex> iid 均勻）；實際的 MASH 是確定性的三級累加器，近有理數 <Tex>{r`\alpha`}</Tex> 有 tone，closed form 與實際序列的線性相關最多差 {fx(cmp._summary.max_abs_diff_closed_numeric, 3)}、與時域 sim 最多差 {fx(cmp._summary.max_abs_diff_closed_sim, 3)}（下表）
        </Claim>
      </p>

      <h3>10b.3 數字：closed form／實際序列／時域 sim</h3>
      <DataTable
        className="cs-num"
        caption="每格三個數：closed form（TS port，F-CS.27）／golden 在實際序列上量的線性相關（$2^{17}$ 拍）／§11.4 的時域 sim（以各自的開迴路參考正規化）。全部是 $\kappa_{\min}$。"
        head={['迴路', 'source', ...cmpAlphas.map((a) => `$\\alpha=${a}$`)]}
        rows={(['L2', 'L3'] as CodeLoopKey[]).flatMap((lk) => (['dq', 'mash', 'rot4', 'rot8'] as CodeSource[]).map((s) => [lk === 'L2' ? 'L2（PM 60°）' : 'L3', SOURCE_SHORT[s], ...cmpAlphas.map((a) => tri(lk, s, a))]))}
      />
      <KappaAlphaPlot />
      <p>
        圖上的曲線形狀就是 F-CS.27：dq 幾乎貼著 acc1（載波留 90%，整條往上抬約 0.1）；MASH 大約是 <Tex>{`${tx(live.f1.phi2, 2)}\\,\\mathrm{Re}\\,H_{PD}(\\alpha)+0.3`}</Tex>；rot4 是 acc1 的 43% 再加 0.57。反號帶越深（PM 越小），MASH 的曲線就越接近 0——L2 PM 45° 在 {live.dead45.lo}–{live.dead45.hi} MHz 之間掉進 <Tex>{r`\pm\tau`}</Tex> 的 dead zone 帶，PM 60° 的最低點還有 {fx(live.valley.min, 3)}。
      </p>

      <h3>
        10b.4 為什麼是 L2-PM45、MASH、<Tex>{r`\alpha=0.03`}</Tex>：逐項算
      </h3>
      <DataTable
        className="cs-num"
        caption={`F-CS.26 第三行的四項（$\\alpha=0.03$、120 MHz；$h_{PD}[1..2]$ 由長除法，$\\mathrm{Re}\\,H_{PD}$ 由模型）。PM 45° 的載波項幾乎抵掉散開的正項。`}
        head={['', '$\\mathrm{Re}\\,H_{PD}(\\alpha)$', '載波 $\\lvert\\phi_1\\rvert^2\\,\\mathrm{Re}\\,H_{PD}$', '$k=0$：$\\tilde R[0]$', '$k=1$：$h[1]\\cos(2\\pi\\alpha)\\tilde R[1]$', '$k=2$', '$\\kappa_1$', 'raw 的 $\\kappa_1$', '判定']}
        rows={[
          ['L2 PM 45°', fx(live.g45, 4), <Kappa key="a" v={live.t45[0]} />, <Kappa key="b" v={live.t45[1]} />, <Kappa key="c" v={live.t45[2]} />, <Kappa key="d" v={live.t45[3]} />, <Kappa key="e" v={live.k45} />, <Kappa key="f" v={live.raw45} />, <strong key="g" className="cs-dead">dead zone</strong>],
          ['L2 PM 60°', fx(live.g60, 4), <Kappa key="a" v={live.t60[0]} />, <Kappa key="b" v={live.t60[1]} />, <Kappa key="c" v={live.t60[2]} />, <Kappa key="d" v={live.t60[3]} />, <Kappa key="e" v={live.k60} />, <Kappa key="f" v={kappaModeCode(LOOPS.L2, 0.03, 'acc1', 1)} />, <strong key="g" className="cs-pos">restoring</strong>],
        ]}
      />
      <p>
        兩個迴路的 <Tex>{r`\lvert\phi_1\rvert^2`}</Tex>、<Tex>{r`\tilde R`}</Tex> 完全相同，<Tex>{r`h_{PD}[1]`}</Tex>、<Tex>{r`h_{PD}[2]`}</Tex> 也差不多；差別全在 <Tex>{r`\mathrm{Re}\,H_{PD}(120\ \mathrm{MHz})`}</Tex>：PM 60° 的反號帶到 {fx(BAND.L2?.hi, 0)} MHz、谷底 <Tex>{tx(BAND.L2?.min ?? NaN, 3)}</Tex> 在 {fx(BAND.L2?.fMin, 0)} MHz，120 MHz 已經快出帶了（<Tex>{`${tx(live.g60, 3)}`}</Tex>）；PM 45° 的帶到 {fx(live.band45.fHi * FREF_MHZ, 0)} MHz、谷底 <Tex>{tx(live.band45.minReH, 3)}</Tex> 在 {fx(live.band45.fMin * FREF_MHZ, 0)} MHz，120 MHz 正在谷底旁邊。MASH 把載波的 {fx(100 * live.f1.rtilde[0], 0)}% 搬去高頻換來 <Tex>{`+${tx(live.t45[1] + live.t45[2] + live.t45[3], 2)}`}</Tex>，但剩下的 {fx(100 * live.f1.phi2, 0)}% 乘上 <Tex>{`${tx(live.g45, 3)}`}</Tex> 就是 <Tex>{`${tx(live.t45[0], 3)}`}</Tex>——剛好抵消。
      </p>
      <p>
        <strong>dead zone 之後</strong>：小訊號的恢復力 <Tex>{`\\kappa_1=${tx(live.k45, 4)}`}</Tex> 相當於實際時間常數約 <Tex>{`N_\\tau/\\mathrm{Re}\\,\\kappa_1\\approx${fx(25 / live.k45, 0)}`}</Tex> blocks。在 golden 的觀測窗（<Tex>{'B=1500'}</Tex> blocks、<Tex>{r`N_\tau=25`}</Tex>）裡，F-CS.2 的平均模型說這個模態只會縮到 <Tex>{`e^{-\\kappa_1B/N_\\tau}=${tx(live.w45.growth, 2)}`}</Tex> 倍（實際 MASH 序列上量到的 <Tex>{`\\kappa_1=${tx(DITHER_NUM.numeric['L2_pm45|mash']['0.03'].kappa_min, 3)}`}</Tex>，倍數 <Tex>{tx(live.w45num.growth, 2)}</Tex>）。可是 golden 的 {headlineMc.n} 個 seeds 全部長大，最終中位數是初值的 {fx(hlGrowth, 1)} 倍——<strong>線性理論解釋得了「校不回來」，解釋不了「長大」</strong>。
      </p>
      <p>
        候選解釋是 §10.4 的 1-bit 大訊號：初始 PHOS 誤差 173 fs 已接近 <Tex>{r`\sigma_v=200`}</Tex> fs，沿 mode-1 在實際 MASH 序列上算的 1-bit 相關（F-CS.20 的 <Tex>{r`\kappa_\infty`}</Tex>）PM 45° 是 <Tex>{`${tx(live.ls45.kappaInf, 3)}`}</Tex>、PM 60° 是 <Tex>{`${tx(live.ls60.kappaInf, 3)}`}</Tex>；Type-II 的 <Tex>{r`h_{PD}`}</Tex> 有一條長的負尾巴，面積小、持續時間長，線性看面積得到 0，sign 看持續時間得到負值。但是把「dead zone 時看 <Tex>{r`\kappa_\infty`}</Tex> 的正負號」當判準，golden 的 {mcSum.n_dead} 個 dead zone 案例只有 {twoDz.n_ok} 個一致、{twoDz.n_mismatch} 個不一致（§10b.7 的表）。兩個反例：L3、acc1、<Tex>{r`\alpha=0.253`}</Tex> 沿 mode {ceAcc.worst_mode} 的 <Tex>{`\\kappa_\\infty=${tx(ceAcc.kappa_inf_worst, 3)}`}</Tex>，{ceAcc.n} 個 seeds 有 {ceAcc.n_conv} 個收斂（初始誤差在 mode 4 的功率只有 {fx(100 * live.epsShare[4], 1)}%，mode 1＋7 佔 {fx(100 * (live.epsShare[1] + live.epsShare[7]), 0)}%：其餘模態一收斂，rms 就掉到 1/4 以下）；L3、dq、<Tex>{r`\alpha=0.01`}</Tex> 的 <Tex>{`\\kappa_\\infty=${tx(ceDq.kappa_inf_worst, 3)}`}</Tex>，{ceDq.n} 個 seeds 既不發散也不收斂（最終中位數 {fmtFs(median(ceDq.final_fs))}，初值 {fmtFs(ceDq.init_fs)}）。<Tex>{r`\kappa_\infty`}</Tex> 是「誤差全在這一個模態、振幅遠大於 <Tex>{r`\sigma_v`}</Tex>」的極限；閉迴路裡其他模態與 GOS 的誤差、比較器雜訊都會讓 sign 回到線性區——這個說法本身也還是假說。
      </p>
      <DataTable
        className="cs-num"
        caption="閉迴路：golden（Python）8 seeds × 1500 blocks（$N=512$、$N_\tau=25$）與原本 sim（8000 blocks）的結果。「發散」= 最終 PHOS rms 超過初值 173 fs 的 2 倍。"
        head={['', '$\\kappa_1$（closed form）', '判定（F-CS.28）', '$\\kappa_\\infty$（最差模態，提示）', 'golden：發散／收斂（8 seeds）', '最終 PHOS rms 中位數', '原 sim（8000 blocks）']}
        rows={[
          ['L2 PM 45° + MASH', <Kappa key="a" v={headlineMc.kappa_min} />, 'dead zone（不判）', <Kappa key="b" v={headlineMc.kappa_inf_worst} digits={3} />, `${headlineMc.n_div}／${headlineMc.n_conv}`, fmtFs(median(headlineMc.final_fs)), fmtFs(simLms)],
          ['L2 PM 60° + MASH', <Kappa key="a" v={pm60Mc.kappa_min} />, 'restoring', <Kappa key="b" v={pm60Mc.kappa_inf_worst} digits={3} />, `${pm60Mc.n_div}／${pm60Mc.n_conv}`, fmtFs(median(pm60Mc.final_fs)), fmtFs(simLms60)],
        ]}
      />
      <p>
        <Claim kind="approx">dead zone 的成因：載波保留率 × 反號帶深度（F-CS.27），只有 PM 45° 掉進去</Claim>{' '}
        <Claim kind="research">
          dead zone 之後「長大」的機制：<Tex>{r`\kappa_\infty<0`}</Tex> 是候選，golden 不支持它當判準
        </Claim>
        原本的研究假說「理論無法解釋」只拆掉一半：closed form 說明了為什麼只有 PM 45° 沒有恢復力；沒有恢復力之後為什麼會長大，仍是研究假說。數字的來源與容忍度：closed form（<Tex>{r`\kappa_1`}</Tex> 與四項）由 TS port 即時算出，和 golden 逐項核對到相對 <Tex>{r`10^{-9}`}</Tex>；<Tex>{r`\kappa_\infty`}</Tex> 是實際序列上的 1-bit 相關（<Tex>{'2^{16}'}</Tex> 拍），acc1／MASH 的序列與 Python 是同一個整數遞迴，沿 mode 1 與沿最差模態都核對到相對 <Tex>{r`10^{-7}`}</Tex>；dq／rot 的隨機數不同，只比統計（絕對 0.05）。
      </p>
      <Hand id="HC-CS.11">{r`把 $\alpha f_{ref}$ 換成你的頻道、$K_p$、$K_i$ 換成你的迴路，算 MASH 之下 mode-1 的 $\kappa_1$：先算三個 sinc、再算 $\tilde R$ 與 $h_{PD}[1..2]$，最後四項相加；答案和 F-CS.28 的判定一起出來。`}</Hand>

      <h3>10b.5 dither 攤平譜線、旋轉去相關：三種隨機化各留多少載波</h3>
      <p>
        同一點（L2 PM 45°、120 MHz）換成別的 code source：dq 的載波留 {fx(100 * hl.handcalc_dq.line_m1, 0)}%，<Tex>{`\\kappa_1=${tx(hl.handcalc_dq.kappa_1, 3)}`}</Tex>（反號——比 raw 的 <Tex>{`${tx(hl.handcalc_rot4.raw_kappa_1, 3)}`}</Tex> 好一點點而已）；rot4 留 {fx(100 * hl.handcalc_rot4.D2, 0)}%，<Tex>{`\\kappa_1=${tx(hl.handcalc_rot4.kappa_1, 3)}`}</Tex>（restoring）；rot8 留 0%，<Tex>{r`\kappa_1=1`}</Tex>。「攤平譜線」的意思是把階梯線的功率變成白雜訊（乘 <Tex>{r`h_{PD}[0]=1`}</Tex>，永遠是正項）；「去相關」的意思是 PMUX 指標的隨機跳動讓 one-hot regressor 和它自己的過去不再相關（<Tex>{r`\tilde R[k\ne0]=0`}</Tex>）。代價都寫在 DTC range：
        {CODE_SOURCES.map((s, i) => (
          <span key={s}>
            {i ? '、' : ''}
            {SOURCE_SHORT[s]} <Tex>{`${CODE_RANGE[s]}\\Delta`}</Tex>
          </span>
        ))}
        。
      </p>
      <Hand id="HC-CS.12">{r`同一點算 dq 與 rot$M$：dq 的白雜訊 $(1-\cos\theta_1)/3$ 與基波 $W_1^2$，rot 的 $\lvert D_M\rvert^2$；把 $M$ 從 4 改成 8，看 $\kappa_1$ 怎麼變成 1。`}</Hand>

      <h3>
        10b.6 GOS 那一邊：dq 把 code 白化、MASH 的 <Tex>{r`C_{GOS}`}</Tex> 與 <Tex>{r`\alpha`}</Tex> 無關
      </h3>
      <p>
        GOS 的 regressor 是 DTC code 本身。dq 的 <Tex>{r`c=\rho+1-b`}</Tex> 給定 <Tex>{r`\rho`}</Tex> 的條件平均恆為 1：鋸齒被抵消，只剩白雜訊（變異數 <Tex>{r`\tfrac16`}</Tex>），<Tex>{r`C_{GOS}=h_{PD}[0]/6`}</Tex>、<Tex>{r`\kappa_{GOS}=1`}</Tex>——對任何 <Tex>{r`\alpha`}</Tex>。MASH 的 <Tex>{r`c=(1-z^{-1})^2e_3+2`}</Tex> 是 MA(2)：<Tex>{r`\tilde R_c=[6,-4,1]/12`}</Tex>，<Tex>{r`C_{GOS}=(6h[0]-4h[1]+h[2])/12`}</Tex>，也與 <Tex>{r`\alpha`}</Tex> 無關、永遠為正（<Tex>{r`h[1]<0`}</Tex>）。rot 是鋸齒加白雜訊 <Tex>{r`(M^2-1)/12`}</Tex>。時域 sim 的 <Tex>{r`\kappa_G`}</Tex> 以 <Tex>{r`E[c^2]`}</Tex>（含偏移）正規化，所以數字小：
      </p>
      <DataTable
        className="cs-num"
        caption="L2（PM 60°）、$\alpha=0.03$ 的 GOS：closed form 的 $C_{GOS}$／實際序列的 $\langle\tilde c\,(h_{PD}*\tilde c)\rangle$／$\kappa_{GOS}=C/\mathrm{var}(c)$／$C/E[c^2]$ 對 sim 的 $\kappa_G$（sim 的參考含 $(1-a)$ 與 $\varepsilon_p/\Delta$ 的混合，差 3–8%）。"
        head={['source', '$C_{GOS}$ closed', '實際序列', '$\\mathrm{var}(c)$', '$\\kappa_{GOS}$', '$C/E[c^2]$', 'sim $\\kappa_G$']}
        rows={gosRows.map(({ s, g, num, sim }) => [SOURCE_SHORT[s], fx(g.C, 4), fx(num.gos_C, 4), fx(g.varC, 4), fx(g.kappa, 4), fx(g.kappaE2, 4), sim !== undefined ? fx(sim, 4) : '—'])}
      />

      <h3>10b.7 判定式</h3>
      <Formula id="F-CS.28" />
      <p>
        <Claim kind="approx">
          <Tex>{r`\tau=${CODE_TAU}`}</Tex> 是經驗門檻；判定只有線性段，dead zone 不判
        </Claim>
        用法：先用 F-CS.27 算 <Tex>{r`\kappa_{\min}`}</Tex>（實驗 D 的第一個指標）；<Tex>{r`\lvert\kappa_{\min}\rvert\le\tau`}</Tex> 時線性模型沒有恢復力，不預測結局。golden 把 105 組都跑了 8 個 seeds：線性段與多數一致 {mcSum.n_ok}、不一致 {mcSum.n_mismatch}、dead zone 不判 {mcSum.n_na}（其中 L2-PM45／MASH／0.03 就是 8/8 發散的那一組）。換了迴路（PVT 移動帶緣）只要重算 <Tex>{r`\mathrm{Re}\,H_{PD}(\alpha)`}</Tex>——<Tex>{r`\lvert\phi\rvert^2`}</Tex> 與 <Tex>{r`\tilde R`}</Tex> 不變。
      </p>
      <DeadZoneCandidates />
      <CodeSourceLab />
      <TryIt
        items={[
          <>
            預設（L2-PM45、120 MHz）：Case A 的 MASH 4 個 seeds 都往上爬（初值 173 fs，1500 blocks 後約 0.5–1 ps），Case B 的 rot8 幾十個 block 就降到 4 fs。Analytic 欄：A 在 dead zone，F-CS.28 不判（n/a；<Tex>{r`\kappa_\infty`}</Tex> 提示發散，但那只是研究假說）；B 由 closed form 判 restoring，和 MC 一致。Monte Carlo 欄和 golden 的 8 seeds 比。
          </>,
          <>把迴路換成 L2（PM 60°）：同一個 MASH、同一個 120 MHz 收斂——只有 <Tex>{r`\mathrm{Re}\,H_{PD}(\alpha)`}</Tex> 變了。</>,
          <>
            載入「L2、80 MHz：dq」：dq 的 <Tex>{r`\kappa_{\min}`}</Tex> 是 <Tex>{tx(live.dq80, 3)}</Tex>（反號），4/4 發散；raw 的 5% 高次線變成白雜訊只抬高 0.1，救不了帶內的頻道。
          </>,
          <>
            把 <Tex>{r`\alpha f_{ref}`}</Tex> 從 120 掃到 180 MHz（PM 45° 的帶緣 {fx(live.band45.fHi * FREF_MHZ, 0)} MHz 之外）：MASH 的 <Tex>{r`\kappa_{\min}`}</Tex> 由 {fx(live.k45, 2)} 升到 {fx(live.mash180, 2)}，判定變成 restoring、MC 全部收斂；中間 {live.dead45.lo}–{live.dead45.hi} MHz 是 dead zone。
          </>,
          <>
            把 seeds 數改成 2：4/4 變 2/2，Wilson 下界 0.34 含 ½，交叉比對變成 n/a——這就是為什麼預設要 4 個 seeds、golden 用 8 個。
          </>,
          <>
            載入「L3、40 MHz：dq 在 dead zone…」那一個 preset——<Tex>{r`\kappa_\infty`}</Tex> 判準的反例：dq 的 <Tex>{`\\kappa_{\\min}=${tx(live.l3dq.linear.kappaMin, 4)}`}</Tex> 在 dead zone，<Tex>{`\\kappa_\\infty=${tx(live.l3dq.kappaInf, 3)}`}</Tex>（提示發散），可是 seeds 都停在初值附近（golden {ceDq.n} 個 seeds：{ceDq.n_div} 個發散、{ceDq.n_conv} 個收斂）。如果照舊的兩段判定，Analytic 欄這裡會是 mismatch；現在 dead zone 不判，所以是 n/a。同一點的 MASH <Tex>{`\\kappa_{\\min}=${tx(live.l3mash, 3)}`}</Tex>，restoring、收斂。
          </>,
        ]}
      />

      <CertificateBlock />

      <h3>10b.9 思考題</h3>
      <Quiz
        title="思考題（選擇）：為什麼 rot4 在 $\alpha\approx\tfrac14$ 完全安全（$\kappa=1$），在 $\alpha=0.03$ 卻只有 0.56？"
        question={<>PMUX 隨機旋轉 4 相在 §11.4 的表裡：L2 <Tex>{r`\alpha=0.253`}</Tex> 的 <Tex>{r`\kappa_{PHOS}=1.00`}</Tex>，<Tex>{r`\alpha=0.03`}</Tex> 只有 0.56。原因是？</>}
        options={[
          { label: '$\\alpha\\approx\\tfrac14$ 時反號帶已經在很遠的低頻，任何 regressor 都安全' },
          { label: '$\\alpha\\approx\\tfrac14$ 最差的是 mode 2 與 mode 4（alias，§8.4），而 $D_4(\\theta)$ 在 $\\theta=\\pi/2$、$\\pi$ 剛好是 0：這兩個模態被完全白化；$\\alpha=0.03$ 最差的是 mode 1，$\\lvert D_4(\\pi/4)\\rvert^2=0.43$，只殺掉 57%', correct: true },
          { label: 'rot4 的 DTC range $4\\Delta$ 讓 GOS 的 regressor 變大，把 PHOS 的反號蓋過去' },
          { label: '因為 $\\alpha\\approx\\tfrac14$ 時 PMUX 每拍剛好跳 2 相，隨機數沒有作用' },
        ]}
        answer={
          <>
            <p>
              (B)。<Tex>{r`\lvert D_4(\theta_m)\rvert^2=\sin^2(2\theta_m)/(16\sin^2(\theta_m/2))`}</Tex>：<Tex>{'m=1'}</Tex> 是 {fx(rotFactor(4, 1), 3)}、<Tex>{'m=2'}</Tex> 是 {fx(rotFactor(4, 2), 3)}、<Tex>{'m=3'}</Tex> 是 {fx(rotFactor(4, 3), 3)}、<Tex>{'m=4'}</Tex> 是 {fx(rotFactor(4, 4), 3)}。<Tex>{r`\alpha\approx\tfrac14`}</Tex> 的危險模態是 mode 4（慢方波折回低頻）與 mode 2，它們的線全被殺掉、變成白雜訊（<Tex>{r`\kappa=1`}</Tex>）；mode 1 的載波在 1012 MHz 本來就在帶外。
              <Tex>{r`\alpha=0.03`}</Tex> 的危險模態是 mode 1，<Tex>{r`\lvert D_4\rvert^2=0.427`}</Tex> 還留 43% 的載波乘上負的 <Tex>{r`\mathrm{Re}\,H_{PD}`}</Tex>。(A) 錯：反號帶是迴路的性質，與 <Tex>{r`\alpha`}</Tex> 無關；(C) 錯：GOS 與 PHOS 在線性分析裡是分開的模態；(D) 錯：隨機數每拍都在加。
            </p>
          </>
        }
      />
      <Quiz
        title="思考題（計算）：L2（PM 60°）搭 MASH 在反號帶谷底 83.8 MHz 會不會出事？"
        question={
          <>
            用 F-CS.27 估 L2（PM 60°）在谷底 <Tex>{r`\alpha=${tx(live.valley.alpha, 5)}`}</Tex>（83.8 MHz，<Tex>{`\\mathrm{Re}\\,H_{PD}=${tx(live.valley.g, 4)}`}</Tex>）的 MASH mode-1 <Tex>{r`\kappa_1`}</Tex>，判斷安不安全；再說明為什麼 PM 60° 的 L2 搭 MASH 在任何 <Tex>{r`\alpha`}</Tex> 都安全。
          </>
        }
        answer={
          <>
            <p>
              四項：載波 <Tex>{`${tx(live.f1.phi2, 3)}\\times(${tx(live.valley.g, 4)})=${tx(live.valley.t[0], 4)}`}</Tex>，散開 <Tex>{`${tx(live.valley.t[1], 4)}${live.valley.t[2] >= 0 ? '+' : ''}${tx(live.valley.t[2], 4)}${live.valley.t[3] >= 0 ? '+' : ''}${tx(live.valley.t[3], 4)}`}</Tex>，合計 <Tex>{`\\kappa_1=${tx(live.valley.k, 4)}>\\tau`}</Tex>：restoring。谷底是 <Tex>{r`\mathrm{Re}\,H_{PD}`}</Tex> 最低的地方，載波項在這裡最負；散開的三項幾乎不隨 <Tex>{r`\alpha`}</Tex> 變（只有 <Tex>{r`\cos(2\pi\alpha k)`}</Tex>），所以 MASH 的 <Tex>{r`\kappa_1(\alpha)`}</Tex> 的最低點就在谷底附近——整條掃描的最小值是 <Tex>{`${tx(live.valley.min, 3)}`}</Tex>（上面的圖），離 dead zone 還有 <Tex>{`${tx(live.valley.min - CODE_TAU, 2)}`}</Tex>。散開的部分約 <Tex>{`s=${tx(live.valley.t[1] + live.valley.t[2] + live.valley.t[3], 3)}`}</Tex>：要掉進 dead zone 得讓載波項吃掉 <Tex>{r`s-\tau`}</Tex>，也就是 <Tex>{`\\mathrm{Re}\\,H_{PD}\\lesssim-(s-\\tau)/\\lvert\\phi_1\\rvert^2=${tx(-(live.valley.t[1] + live.valley.t[2] + live.valley.t[3] - CODE_TAU) / live.f1.phi2, 2)}`}</Tex>（PM 45° 的谷底 <Tex>{tx(live.band45.minReH, 3)}</Tex> 就到了）；要真的反號得 <Tex>{`\\mathrm{Re}\\,H_{PD}\\lesssim-s/\\lvert\\phi_1\\rvert^2=${tx(-(live.valley.t[1] + live.valley.t[2] + live.valley.t[3]) / live.f1.phi2, 2)}`}</Tex>。
            </p>
          </>
        }
      />
      <ModeGate min="engineer" summary="closed form、頻譜因子與 code 產生器的核心程式碼（TS，頁面即時執行）">
        <ModelCode region="kappaCode" title="closed form：每條線乘 $\mathrm{Re}\,H_{PD}$，再加短記憶修正（kappaModeCode；實驗 D 與 F-CS.27 的數字）" caption="每條線乘上該頻率的 $\mathrm{Re}\,H_{PD}$，散開的部分只用 $h_{PD}[0..2]$。" />
        <ModelCode region="codeFactors" title="四種 code source 的頻譜因子（sinc 的乘積、dq 的 Fourier 係數、rot 的 $D_M$）" />
        <ModelCode region="codeSequence" title="code 產生器：與 sim.py 的 SeqSource 同一套整數遞迴（MASH 的序列與 Python 逐位相同）" />
      </ModeGate>
      <ModeGate min="research" summary="dead zone 的候選提示 $\kappa_\infty$（研究假說）、觀測窗判準、多 seed 判定的程式碼與 Python golden">
        <ModelCode region="largeSignalCode" title="dead zone 的候選提示（研究假說）：實際序列上沿一個模態的 1-bit 相關 $\kappa_\infty$" />
        <ModelCode region="efoldVerdict" title="觀測窗的 e-folding 判準（§10b.7 的候選；不參與實驗 D 的 Analytic 欄）" />
        <ModelCode region="divergenceMc" title="多 seed 的閉迴路判定（實驗 D 在 Worker 裡跑的函式）" />
        <CodeBlock source={pyDither} region="kappa_code" lang="python" path={PY_PATH} title="Python golden 的同一段（results/dither_interaction.json 由 tools/dither_sweep.py 產生）" />
        <p className="small muted">
          Research 補充（code 序列）：TS 與 Python 的 acc1、MASH 序列是同一個整數遞迴（<Tex>{'2^{29}'}</Tex> 格點、32-bit 字長），numeric 欄逐位相同到 <Tex>{r`10^{-7}`}</Tex>；dq、rot 的隨機數不同（xoshiro128** vs PCG64），只比統計（0.05）。MASH 的 iid 假設在 <Tex>{r`\alpha=0.01`}</Tex> 最差（差 0.02）：那裡第一級的鋸齒週期只有 12.5 拍，第三級的餘數還有看得見的 tone。
        </p>
      </ModeGate>
      <Src>
        <code>analysis/sspll/golden/results/dither_interaction.json</code>（<code>tools/dither_sweep.py</code>：closed form、實際序列的線性相關、沿 mode 1 與最差模態的 <Tex>{r`\kappa_\infty`}</Tex>、105 組 × 8 seeds 的閉迴路、dead zone 候選判準的計分 <code>mc._summary.candidates</code>）、頁面讀的子集 <code>ditherNumbers.json</code>；時域 sim 的 <Tex>{r`\kappa`}</Tex> 與閉迴路來自 <code>results/sim_dither_extract.json</code>；TS port（<code>sspll.ts</code> 的 code source 區塊）在 <code>sspll.test.ts</code> 逐項比對。推導全文：<code>docs/analysis/sspll-dither-interaction.md</code>。
      </Src>
    </Section>
  )
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m])
}

/** 候選判準表裡「迴路|source|α」的顯示（L2_pm45 → L2-PM45，分隔改全形斜線） */
const caseKey = (k: string): string => k.replace('L2_pm45', 'L2-PM45').replace(/\|/g, '／')
type Counts = { n_ok: number; n_mismatch: number; n_na: number }
const counts = (x: Counts): string => `${x.n_ok}／${x.n_mismatch}／${x.n_na}`

/**
 * §10b.7：dead zone 的候選判準在 golden 105 組 × 8 seeds 上的計分（ditherNumbers.json 的 mc._summary.candidates，
 * tools/dither_sweep.py 的 score_candidates；sspll.test.ts 用 TS 的 twoStageCandidate／efoldVerdict 逐格重算）。
 */
function DeadZoneCandidates() {
  const s = DITHER_NUM.mc._summary
  const c = s.candidates
  const w = c.efold
  const hl = DITHER_NUM.mc['L2_pm45|mash']['0.03']
  const gHl = efoldVerdict(hl.kappa_min, s.n_blocks, 25).growth
  const decided = (x: Counts) => x.n_ok + x.n_mismatch
  return (
    <>
      <DataTable
        className="cs-num"
        caption={`dead zone 的候選判準（golden：${s.seeds.length} seeds × ${s.n_blocks} blocks；「一致／不一致／不判」用同一套 Wilson 規則）。只有第一列是 F-CS.28；其餘三列只拿來計分，不參與實驗 D 的 Analytic 欄。`}
        head={['候選判準', '105 組：一致／不一致／不判', `${s.n_dead} 個 dead zone`]}
        rows={[
          ['F-CS.28：線性段（本頁採用）', `${s.n_ok}／${s.n_mismatch}／${s.n_na}`, `0／0／${s.n_dead}`],
          ['兩段：dead zone 看最差模態的 $\\kappa_\\infty$', counts(c.two_stage), counts(c.two_stage.dead_zone)],
          ['兩段：dead zone 看 mode 1 的 $\\kappa_\\infty$', counts(c.two_stage_m1), counts(c.two_stage_m1.dead_zone)],
          ['觀測窗：$e^{-\\kappa_{\\min}B/N_\\tau}$ 和 $2$、$\\tfrac14$ 比', counts(w), counts(w.dead_zone)],
        ]}
      />
      <ul className="small">
        <li>
          兩段（最差模態）不一致的 {c.two_stage.mismatches.length} 組（迴路／source／<Tex>{r`\alpha`}</Tex>）：{c.two_stage.mismatches.map(caseKey).join('、')}。
        </li>
        <li>
          兩段（mode 1）不一致的 {c.two_stage_m1.mismatches.length} 組：{c.two_stage_m1.mismatches.map(caseKey).join('、')}。
        </li>
        <li>觀測窗：{w.mismatches.length ? w.mismatches.map(caseKey).join('、') : '沒有不一致的組'}。</li>
      </ul>
      <p>
        讀法：<Tex>{r`\kappa_\infty`}</Tex> 的兩條在 dead zone 多判了 {decided(c.two_stage.dead_zone)}／{decided(c.two_stage_m1.dead_zone)} 組，卻錯了 {c.two_stage.dead_zone.n_mismatch}／{c.two_stage_m1.dead_zone.n_mismatch} 組——錯的全是「<Tex>{r`\kappa_\infty`}</Tex> 很負、MC 卻收斂或停住」，沒有反過來的。所以頁面上 <Tex>{r`\kappa_\infty`}</Tex> 只當提示。
        <Claim kind="research">dead zone 之後的結局：<Tex>{r`\kappa_\infty`}</Tex> 當判準被 golden 否決，機制未解</Claim>
      </p>
      <p>
        觀測窗那一列就是 F-CS.2 的平均模型本身：模態 <Tex>{'m'}</Tex> 每個 block 乘 <Tex>{r`e^{-\kappa_m/N_\tau}`}</Tex>，<Tex>{'B'}</Tex> 個 block 後最慢的模態乘 <Tex>{r`G=e^{-\kappa_{\min}B/N_\tau}`}</Tex>。<Tex>{r`G<\tfrac14`}</Tex> 時每個模態都至少縮那麼多，「收斂」是模型的推論；<Tex>{'G>2'}</Tex> 只保證最慢的模態長大，誤差的 rms 還要看它佔多少。換成門檻就是 <Tex>{`\\kappa_{\\min}<-N_\\tau\\ln2/B=-${tx(w.kappa_div, 4)}`}</Tex> 或 <Tex>{`\\kappa_{\\min}>N_\\tau\\ln4/B=${tx(w.kappa_conv, 4)}`}</Tex>：它在 105 組 {w.n_mismatch} 個不一致、在 dead zone 多判了 {w.dead_zone.n_ok} 組，等於說 <Tex>{r`\tau=0.05`}</Tex> 偏保守、真正的門檻依觀測窗而定。可是 headline 那一點 <Tex>{`G=${tx(gHl, 2)}`}</Tex> 仍在不判區，而且方向和 MC（{hl.n_div}/{hl.n} 發散）相反：它也解釋不了「長大」。
        <Claim kind="approx">觀測窗的讀法：平均模型、比較器在線性區、只看最慢的模態</Claim>
      </p>
    </>
  )
}

const CERT_PATH = 'src/pages/case-sspll/codeCertificate.ts'
/** 表格裡的證書結論（短）：全頻道 restoring／不會反號（可能有 dead zone）／不說話（要回到 F-CS.28 掃） */
const STATUS_ZH: Record<CertStatus, string> = { 'restoring-all': '全頻道 restoring', 'never-inverted': '不會反號', inconclusive: '不說話' }
const LOOP_HEAD: Record<CodeLoopKey, string> = { L2: 'L2（PM 60°）', L2_pm45: 'L2 PM 45°', L3: 'L3' }

/** §10b.8：全頻道證書（F-CS.29）——把 §7b 的 g_min 證書延伸到 code source；三個迴路的表與 MASH 的 PM 掃描（全部即時計算，codeCertificate.test.ts 與 golden 比對） */
function CertificateBlock() {
  const table = useMemo(() => certificateTable(CODE_LOOPS), [])
  const rows = useMemo(() => PM_SWEEP.map(pmSweepRow), [])
  const pmCert = interpThreshold(PM_SWEEP, rows.map((x) => x.lb.mash), CERT_TAU)
  const pmDead = interpThreshold(PM_SWEEP, rows.map((x) => x.mashScan.min), CERT_TAU)
  const c = table.L2.certs.mash
  const f1 = mashFactors(1)
  const hGrid = 0.5 / (CERT_NF - 1)
  const slack = (c.Lg * hGrid) / 2
  const t = [f1.phi2 * c.gMin, f1.rtilde[0], Math.abs(c.h[1]) * Math.abs(f1.rtilde[1]), Math.abs(c.h[2]) * Math.abs(f1.rtilde[2])]
  const lb1 = t[0] + t[1] - t[2] - t[3]
  const pm45 = table.L2_pm45
  const range = (r: [number, number] | null) => (r ? `${r[0]}–${r[1]} MHz` : '無')
  return (
    <>
      <h3>10b.8 全頻道的證書：哪個 PM 之後 MASH 對任何頻道都安全</h3>
      <p>
        F-CS.28 一次判一個頻道。設計時想問的是「這個迴路搭這種 code source，<strong>任何</strong> <Tex>{r`\alpha`}</Tex> 都安全嗎？」——把 §7b 的證書工具延伸過來就能回答。§7b 已經給了 <Tex>{r`g=\mathrm{Re}\,H_{PD}`}</Tex> 在所有頻率的有證明下界 <Tex>{r`g_{\min}`}</Tex>（細格點的最小值減 <Tex>{r`L_gh/2`}</Tex>，<Tex>{r`L_g=2\pi\sum_nn\lvert h_{PD}[n]\rvert`}</Tex>）；F-CS.27 的每一項不是「線的權重 × <Tex>{'g'}</Tex>」就是「<Tex>{r`h_{PD}[k]\cos(\cdot)\tilde R[k]`}</Tex>」，兩種都可以用最壞情況壓住：
      </p>
      <StepDerivation
        steps={[
          { tex: r`\mathrm{Re}\,\kappa_m(\alpha)=\sum_\ell w_\ell\,g\big(\mathrm{frac}(\ell\alpha)\big)+\sum_{k\ge0}h_{PD}[k]\cos(2\pi m\alpha k)\,\tilde R_m[k]`, why: <>F-CS.26 第三行的一般形：acc1、dq、rot 有很多條階梯線 <Tex>{r`\ell\equiv m\pmod8`}</Tex>，MASH 只有載波 <Tex>{r`\ell=m`}</Tex> 一條；<Tex>{r`w_\ell\ge0`}</Tex>。</> },
          { tex: r`\sum_\ell w_\ell\,g\big(\mathrm{frac}(\ell\alpha)\big)\ \ge\ W_m\,g_{\min},\qquad W_m\equiv\sum_\ell w_\ell`, why: <>每條線都落在某個頻率上，那裡 <Tex>{r`g\ge g_{\min}`}</Tex>（§7b 的下界）；權重非負，所以整串和不小於「總權重 × <Tex>{r`g_{\min}`}</Tex>」。<Tex>{r`W_m`}</Tex>：acc1 是 1、dq 是 <Tex>{r`1-\tilde R_m[0]`}</Tex>、rot<Tex>{'M'}</Tex> 是 <Tex>{r`\lvert D_M\rvert^2`}</Tex>、MASH 是 <Tex>{r`\lvert\phi_m\rvert^2`}</Tex>。</> },
          { tex: r`\sum_{k\ge0}h_{PD}[k]\cos(2\pi m\alpha k)\,\tilde R_m[k]\ \ge\ \tilde R_m[0]-\sum_{k\ge1}\lvert h_{PD}[k]\rvert\,\lvert\tilde R_m[k]\rvert`, why: <><Tex>{'k=0'}</Tex> 那一項是 <Tex>{r`h_{PD}[0]\tilde R_m[0]=\tilde R_m[0]`}</Tex>（<Tex>{r`\cos0=1`}</Tex>，迴路至少 1 拍延遲）；其餘各項用 <Tex>{r`\lvert\cos\rvert\le1`}</Tex> 取最壞的正負號。</> },
          { tex: r`\Rightarrow\ \mathrm{Re}\,\kappa_m(\alpha)\ \ge\ \mathrm{LB}_m\equiv W_m\,g_{\min}+\tilde R_m[0]-\sum_{k\ge1}\lvert h_{PD}[k]\rvert\,\lvert\tilde R_m[k]\rvert\quad\text{對所有 }\alpha`, why: <>兩個下界相加；右邊和 <Tex>{r`\alpha`}</Tex> 無關。<Tex>{r`\min_m\mathrm{LB}_m>\tau`}</Tex> 就是「每一個頻道都 restoring」的證書，<Tex>{r`\ge-\tau`}</Tex> 是「沒有頻道反號」。</> },
        ]}
      />
      <Formula id="F-CS.29" />
      <p>
        <Claim kind="exact">在 F-CS.27 的模型內下界沒有近似（acc1、dq、rot 的模型本身精確）</Claim> <Claim kind="approx">對 MASH 的結論繼承 <Tex>{'e_3'}</Tex> iid 的近似；<Tex>{r`\tau`}</Tex> 是經驗門檻</Claim>
      </p>
      <p>代 L2（PM 60°）、MASH、mode 1 的數字（全部由 TS port 即時算出；<code>codeCertificate.test.ts</code> 與 golden 的 <code>dither_certificate.json</code> 比對到相對 <Tex>{r`10^{-6}`}</Tex>）：</p>
      <StepDerivation
        steps={[
          { tex: `\\begin{aligned}g_{\\min}&=\\min_jg(f_j)-\\tfrac{L_gh}{2}=${tx(c.gridMin, 5)}-\\tfrac{${tx(c.Lg, 2)}\\times${tx(hGrid * 1e5, 2)}\\times10^{-5}}{2}\\\\&=${tx(c.gridMin, 5)}-${tx(slack * 1e4, 2)}\\times10^{-4}=${tx(c.gMin, 5)}\\end{aligned}`, why: <>§7b 的工具（<code>gosLipschitz</code>、<code>gosKernelMin</code>）：<Tex>{`n_f=${CERT_NF}`}</Tex> 個格點，格距 <Tex>{r`h=0.5/(n_f-1)`}</Tex>；谷底在 {fx(c.fAtMin * FREF_MHZ, 1)} MHz。任何頻率離某個格點不超過 <Tex>{r`h/2`}</Tex>，<Tex>{'g'}</Tex> 的斜率不超過 <Tex>{'L_g'}</Tex>。</> },
          { tex: `W_1\\,g_{\\min}=\\lvert\\phi_1\\rvert^2g_{\\min}=${tx(f1.phi2, 4)}\\times(${tx(c.gMin, 4)})=${tx(t[0], 4)}`, why: <>MASH 只有載波一條線，權重就是載波保留率（HC-CS.11 算過的 <Tex>{r`\lvert\phi_1\rvert^2`}</Tex>）。</> },
          { tex: `\\lvert h_{PD}[1]\\rvert\\,\\lvert\\tilde R_1[1]\\rvert=${tx(Math.abs(c.h[1]), 4)}\\times${tx(Math.abs(f1.rtilde[1]), 4)}=${tx(t[2], 4)}`, why: <>相鄰兩拍的殘餘相關乘上 <Tex>{r`h_{PD}[1]=-(K_p+K_i)`}</Tex> 的大小；實際的正負號在某些 <Tex>{r`\alpha`}</Tex> 是有利的（HC-CS.11 那一項是正的），證書一律當成不利。</> },
          { tex: `\\lvert h_{PD}[2]\\rvert\\,\\lvert\\tilde R_1[2]\\rvert=${tx(Math.abs(c.h[2]), 4)}\\times${tx(Math.abs(f1.rtilde[2]), 4)}=${tx(t[3], 4)}`, why: <>隔兩拍那一項；<Tex>{r`k\ge3`}</Tex> 的 <Tex>{r`\tilde R=0`}</Tex>。</> },
          { tex: `\\mathrm{LB}_1=${tx(t[0], 4)}+${tx(t[1], 4)}-${tx(t[2], 4)}-${tx(t[3], 4)}=${tx(lb1, 4)}${lb1 > CERT_TAU ? '>' : '\\le'}\\tau=${CERT_TAU}`, why: <>四項相加。mode 2–7 的下界更大（載波保留率小、散開的白雜訊多），所以 <Tex>{`\\min_m\\mathrm{LB}_m=\\mathrm{LB}_1`}</Tex>：L2（PM 60°）搭 MASH 對<strong>每一個</strong>頻道都 restoring——§10b.9 的思考題 2 用掃描得到的結論，這裡一行證完（在 F-CS.27 的模型內）。</> },
        ]}
      />
      <DataTable
        className="cs-num"
        caption="三個迴路 × 五種 code source 的全頻道證書 $\min_m\mathrm{LB}_m$（F-CS.29，最差模態都是 $m=1$ 或 $7$）。「全頻道 restoring」＝下界 $>\tau$；「不會反號」＝下界 $\ge-\tau$，仍可能有 dead zone；「不說話」＝要回到 F-CS.28 逐一掃。最後一列是 MASH 的 $\kappa_{\min}$ 在 1 MHz 格點（到 2000 MHz）掃描的最小值、所在頻率與 dead zone 範圍。"
        head={['source', ...(Object.keys(LOOP_HEAD) as CodeLoopKey[]).map((k) => LOOP_HEAD[k])]}
        rows={[
          ...CODE_SOURCES.map((s) => [SOURCE_SHORT[s], ...(Object.keys(LOOP_HEAD) as CodeLoopKey[]).map((k) => `${fx(table[k].certs[s].lbMin, 3)}（${STATUS_ZH[table[k].certs[s].status]}）`)]),
          ['MASH 掃描', ...(Object.keys(LOOP_HEAD) as CodeLoopKey[]).map((k) => `${fx(table[k].mashScan.min, 3)}（${table[k].mashScan.fMHzAtMin} MHz）；${range(table[k].mashScan.deadMHz)}`)],
        ]}
      />
      <p>
        讀法：rot8 恆為 1、rot4 在三個迴路都有證書（載波只剩 43%）；MASH 在 L2（PM 60°）與 L3 有證書，PM 45° 沒有——那裡的掃描找到 {range(pm45.mashScan.deadMHz)} 的 dead zone，正是 §10b.4 的 120 MHz 所在；acc1 的下界就是 <Tex>{r`g_{\min}`}</Tex> 本身，dq 只攤掉 10%，下界幾乎是 <Tex>{r`0.9\,g_{\min}`}</Tex>，證書都不成立（它們在帶內真的會反號，F-CS.28）。
      </p>
      <DataTable
        className="cs-num"
        caption={`PM 掃描：L2 在每個 PM 重新設計到 320 MHz（1 拍延遲；PM ${PM_SWEEP[0]}° 的 $K_p=${tx(rows[0].Kp, 4)}$、$K_i=${tx(rows[0].Ki, 4)}$，PM ${PM_SWEEP[PM_SWEEP.length - 1]}° 的 $K_p=${tx(rows[rows.length - 1].Kp, 4)}$、$K_i=${tx(rows[rows.length - 1].Ki, 4)}$），MASH、rot4、dq 的全頻道下界與 MASH 的 $\\kappa_{\\min}$ 掃描（1 MHz 格點）。$g_{\\min}$ 隨 PM 變小而變深，MASH 的下界跟著掉。`}
        head={['PM', '$g_{\\min}$（谷底）', 'MASH $\\mathrm{LB}$', '證書', 'MASH 掃描 $\\min\\kappa_{\\min}$', 'dead zone', 'rot4 $\\mathrm{LB}$', 'dq $\\mathrm{LB}$']}
        rows={rows.map((x) => [`${x.pm}°`, `${fx(x.gMin, 3)}（${fx(x.fAtMin * FREF_MHZ, 0)} MHz）`, fx(x.lb.mash, 3), STATUS_ZH[x.statusMash], `${fx(x.mashScan.min, 3)}（${x.mashScan.fMHzAtMin} MHz）`, range(x.mashScan.deadMHz), fx(x.lb.rot4, 3), fx(x.lb.dq, 3)])}
      />
      <p>
        <strong>哪個 PM</strong>（1 拍延遲的 Type-II、320 MHz；數字是 illustrative 的設計）：MASH 的證書在 PM <Tex>{r`\gtrsim`}</Tex> {fx(pmCert, 1)}° 成立——每個頻道都 restoring，不必逐一掃；PM <Tex>{r`\lesssim`}</Tex> {fx(pmDead, 1)}° 時一定找得到 dead zone 頻道（線性模型沒有恢復力；之後是停住還是長大，目前是研究假說，§10b.7）；兩者之間證書不說話，但 1 MHz 的掃描說每個頻道仍是 restoring。門檻是表列值的線性內插；golden 用二分法得到 58.5° 與 47.9°（<code>tools/dither_certificate.py</code>，兩者差 0.1° 以內）。
        <Claim kind="approx">門檻建立在 F-CS.27 的 iid 近似與經驗的 <Tex>{r`\tau`}</Tex> 上；PVT 讓帶緣移動時要用實際的 <Tex>{r`g_{\min}`}</Tex> 重算</Claim>
      </p>
      <ModeGate min="engineer" summary="全頻道證書的核心程式碼（TS，頁面即時執行）">
        <CodeBlock source={certSrc} region="codeCertificate" path={CERT_PATH} title="全頻道證書：每條線取 $g_{\min}$、每個 $\cos$ 取最壞情況（codeCertificate.ts）" />
      </ModeGate>
      <ModeGate min="research" summary="Python golden 的同一段">
        <CodeBlock source={pyDither} region="code_certificate" lang="python" path={PY_PATH} title="Python golden 的同一段（results/dither_certificate.json 由 tools/dither_certificate.py 產生）" />
      </ModeGate>
    </>
  )
}
