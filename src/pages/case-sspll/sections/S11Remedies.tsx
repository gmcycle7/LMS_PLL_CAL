import { useMemo, type ReactNode } from 'react'
import { Callout, CodeCompare, ModeGate, Section, StepDerivation, Tex, mathText } from '@/components'
import {
  analyseAlpha,
  gammaEff,
  inversionBands,
  kernelMean,
  kernelMin,
  loopF3dB,
  loopH,
  loopMargins,
  makeL1,
  makeL2,
  oneDiffMargin,
  phosLambdaHarmonic,
  typeILatencyCriterion,
  typeIPoleCriterion,
  type SspllLoop,
} from '@/simulation/models/sspll'
import { DITHER, FREF_MHZ, LOOP_KEYS, LOOPS, PARAMS, PRED, P_ONLY, REMEDY, SIM_CFG, type LoopKey } from '../data'
import { Claim, DataTable, Formula, GoldenCode, Hand, Kappa, MODEL_PATH, MODEL_SRC, ModelCompare, PY_SOURCES, Sci, Src, fmtFs, fs, fx, intervalsText, r, tx } from '../common'

/** 比較器前級單極點（f_c）之後的一階差分 kernel：min_f Re{H_PD·H_c·(1 − e^{jΩ})}，H_c = (1 − p)/(1 − p z⁻¹) */
function oneDiffWithComparatorPole(loop: SspllLoop, fcMHz: number): { hc0: number; min: number; fMinMHz: number; negLoMHz: number | null; negHiMHz: number | null } {
  const p = Math.exp((-2 * Math.PI * fcMHz) / FREF_MHZ)
  let min = Infinity
  let fMin = 0
  let lo: number | null = null
  let hi: number | null = null
  const n = 8000
  for (let i = 1; i <= n; i++) {
    const f = (0.5 * i) / n
    const W = 2 * Math.PI * f
    const H = loopH(loop, f)
    // H_c = (1 − p)/(1 − p e^{−jΩ})
    const dr = 1 - p * Math.cos(W)
    const di = p * Math.sin(W)
    const dd = dr * dr + di * di
    const cr = ((1 - p) * dr) / dd
    const ci = (-(1 - p) * di) / dd
    const hr = H.re * cr - H.im * ci
    const hi2 = H.re * ci + H.im * cr
    // × conj(1 − e^{−jΩ}) = (1 − cos Ω) − j sin Ω
    const g = hr * (1 - Math.cos(W)) + hi2 * Math.sin(W)
    if (g < min) {
      min = g
      fMin = f
    }
    if (g < -1e-9) {
      if (lo === null) lo = f
      hi = f
    }
  }
  return { hc0: 1 - p, min, fMinMHz: fMin * FREF_MHZ, negLoMHz: lo === null ? null : lo * FREF_MHZ, negHiMHz: hi === null ? null : hi * FREF_MHZ }
}

/** filtered-x 的 Type-I 模型掃描格點：α·f_ref = 10.5, 11.5, …, 199.5 MHz（signmap 的格點；Re Γ 的負區都在 120 MHz 以下） */
const FX_SCAN_MHZ = Array.from({ length: 190 }, (_, i) => 10.5 + i)

/**
 * filtered-x 用 Type-I 模型 K̂ 配 L2：在 FX_SCAN_MHZ 上以 ergodic 諧波和計算 κ_PHOS = 8 min_m Re λ_m，
 * 回傳最小值、所在頻率與 κ_PHOS < 0 的區間。
 */
function fxTypeIScan(kHat: number): { min: number; fMinMHz: number; neg: [number, number][] } {
  const G = gammaEff(LOOPS.L2, 'fx:typeI', { typeI: makeL1({ K: kHat }) })
  const mean = kernelMean(G)
  let min = Infinity
  let fMinMHz = 0
  const neg: [number, number][] = []
  let prevNeg = false
  for (const f of FX_SCAN_MHZ) {
    const lam = phosLambdaHarmonic(f / FREF_MHZ, G, 1024, mean)
    let k = Infinity
    for (let m = 1; m <= 4; m++) k = Math.min(k, 8 * lam[m].re) // λ_{8−m} = conj(λ_m)
    if (k < min) {
      min = k
      fMinMHz = f
    }
    if (k < 0) {
      if (prevNeg) neg[neg.length - 1][1] = f
      else neg.push([f, f])
    }
    prevNeg = k < 0
  }
  return { min, fMinMHz, neg }
}

/** filtered-x 模型掃描（params.json 的鍵）的顯示名稱 */
const FX_MODEL_LABEL: Record<string, ReactNode> = {
  exact: 'exact（L2 自己的模型）',
  L2pm45: 'L2 PM 45° 的模型',
  L2pm75: 'L2 PM 75° 的模型',
  L2lat2: 'L2 延遲 2 拍的模型',
  'Ki x0.5': <Tex>{r`K_i\times0.5`}</Tex>,
  'Ki x2': <Tex>{r`K_i\times2`}</Tex>,
  'Kp x0.5': <Tex>{r`K_p\times0.5`}</Tex>,
  'Kp x2': <Tex>{r`K_p\times2`}</Tex>,
  'gain x0.5': <>loop gain <Tex>{r`\times0.5`}</Tex></>,
  'gain x2': <>loop gain <Tex>{r`\times2`}</Tex></>,
  'gain x3': <>loop gain <Tex>{r`\times3`}</Tex></>,
}

const DITHER_ALPHAS = ['0.01', '0.03', '0.253', '0.496']
const DITHER_ROWS: [string, string, ReactNode][] = [
  ['dq', 'dithered quantizer', <Tex key="r">{r`2\Delta`}</Tex>],
  ['mash', 'MASH-1-1-1', <Tex key="r">{r`4\Delta=T_{vco}/2`}</Tex>],
  ['rot4', 'PMUX 隨機旋轉 $M=4$', <Tex key="r">{r`4\Delta`}</Tex>],
  ['rot8', 'PMUX 隨機旋轉 $M=8$', <Tex key="r">{r`8\Delta=T_{vco}`}</Tex>],
]

/** §11 對策：每一種都有代價與自己的失效模式（含核心程式碼並排）。 */
export function S11Remedies() {
  const Kp = Number(LOOPS.L2.params.Kp)
  const Ki = Number(LOOPS.L2.params.Ki)
  const RK = PARAMS.remedy_kernels
  const lowPm = useMemo(
    () =>
      [40, 35, 30].flatMap((pm) => {
        try {
          const lp = makeL2({ pm })
          return [{ pm, ratio: Number(lp.params.Ki) / Number(lp.params.Kp), margin: oneDiffMargin(lp).min }]
        } catch {
          return []
        }
      }),
    [],
  )
  const slope = useMemo(() => {
    const G1 = gammaEff(LOOPS.L2, '1diff')
    const G0 = gammaEff(LOOPS.L2, 'raw')
    return { d1: Math.log(G1(2e-4).re / G1(1e-4).re) / Math.LN2, raw: Math.log(G0(2e-4).re / G0(1e-4).re) / Math.LN2 }
  }, [])
  const latMargins = useMemo(
    () =>
      [2, 3, 4, 5].map((d) => {
        const lp = makeL1({ lat: d })
        const km = kernelMin(lp, '1diff')
        return { d, K: Number(lp.params.K), margin: oneDiffMargin(lp).min, pm: loopMargins(lp).pmDeg, minGamma: km.min, fMinMHz: km.fAtMin * FREF_MHZ }
      }),
    [],
  )
  const fxScan = useMemo(() => [0.12, 0.1, 0.05].map((k) => ({ k, ...fxTypeIScan(k) })), [])
  const twoDiff = useMemo(() => ({ inBand: analyseAlpha(LOOPS.L2, 0.021, '2diff').kappaPhos, outBand: analyseAlpha(LOOPS.L2, 0.137, '2diff').kappaPhos }), [])
  const cmpPole = useMemo(() => LOOP_KEYS.map((k) => ({ k, a: oneDiffWithComparatorPole(LOOPS[k], 500), b: oneDiffWithComparatorPole(LOOPS[k], 250) })), [])
  const pOnly = [
    { name: <>L2：hold 積分器（Type-I，<Tex>{'K=K_p'}</Tex>）</>, loop: P_ONLY.L2, crit: typeILatencyCriterion(Number(P_ONLY.L2.params.K), 1), critTex: r`K_p(d-\tfrac12)` },
    { name: <>L3：<Tex>{r`C_1\gg C_2`}</Tex> 近似</>, loop: P_ONLY.L3, crit: typeIPoleCriterion(Number(P_ONLY.L3.params.A), Number(P_ONLY.L3.params.p)), critTex: r`A(\tfrac12+\tfrac{p}{1-p})` },
    { name: <>L3：精確 <Tex>{r`R\parallel C_2`}</Tex></>, loop: P_ONLY.L3exact, crit: typeIPoleCriterion(Number(P_ONLY.L3exact.params.A), Number(P_ONLY.L3exact.params.p)), critTex: r`A(\tfrac12+\tfrac{p}{1-p})` },
  ]
  const fxI = RK.fx_typeI_model
  const kHats = Object.keys(fxI)
    .filter((k) => k.startsWith('K_hat='))
    .map((k) => ({ k: k.slice(6), v: fxI[k] as { min: number; neg_up_to_MHz: number | null } }))
  const cosKeys = ['exact', 'L2pm45', 'L2pm75', 'L2lat2', 'Ki x0.5', 'Ki x2', 'Kp x0.5', 'Kp x2', 'gain x0.5', 'gain x2', 'gain x3']
  const mashRange = (key: string): string => {
    const vals = Object.values(DITHER.lms[key] ?? {}).map((x) => x.final_phos_rms_fs)
    return vals.length ? `${fx(Math.min(...vals), 1)}–${fx(Math.max(...vals), 1)} fs` : '–'
  }
  const frz = DITHER.freeze
  const oneDiffFinals = ['L2|0.02|1diff', 'L2|0.496|1diff', 'L2|0.253|1diff'].map((k) => PRED.lms[k].final_phos_rms_fs)
  const lsInf = (k: LoopKey, v: string): number | undefined => (PRED.large_signal_counts[k] as Record<string, { 'A=inf': { periodic: number } } | undefined>)[v]?.['A=inf'].periodic
  return (
    <Section kind="formula" level={2} title="11. 對策：每一種都有代價與自己的失效模式" id="cs-11">
      <h3>
        11.1 一階差分 regressor：<Tex>{r`r[n]=x[n]-x[n-1]`}</Tex>（推薦 ①）
      </h3>
      <StepDerivation
        title={mathText(r`一步一步：為什麼 $\mathrm{Re}\,\Gamma_{1d}\ge0$`)}
        steps={[
          { tex: r`\Gamma_{1d}=H_{PD}\,\overline{(1-e^{-j\Omega})}=H_{PD}\,(1-e^{j\Omega})`, why: <><Tex>{r`G=1-z^{-1}`}</Tex>，所以 <Tex>{r`\overline G=1-e^{j\Omega}`}</Tex>。</> },
          {
            tex: r`\mathrm{Re}\,\Gamma_{1d}=\frac{\mathrm{Re}\{(1-e^{j\Omega})(1+\overline L)\}}{\lvert1+L\rvert^2}=\frac{1-\cos\Omega+\mathrm{Re}\{(1-e^{-j\Omega})L\}}{\lvert1+L\rvert^2}`,
            why: <>分子分母同乘 <Tex>{r`\overline{1+L}`}</Tex>；分子實部 <Tex>{r`=\mathrm{Re}(1-e^{j\Omega})+\mathrm{Re}\{\overline{(1-e^{-j\Omega})L}\}`}</Tex>。</>,
          },
          {
            tex: r`(1-z^{-1})L_2=K_pz^{-1}+\frac{K_iz^{-1}}{1-z^{-1}}\ \Rightarrow\ \mathrm{Re}=K_p\cos\Omega-\frac{K_i}{2}`,
            why: <>代入 L2；差分把一個積分器「消掉」。用 §6.2 的 <Tex>{r`\mathrm{Re}\frac{z^{-1}}{1-z^{-1}}=-\frac12`}</Tex>。</>,
          },
          { tex: r`g(\Omega)=1-\frac{K_i}{2}-(1-K_p)\cos\Omega\ \ge\ 1-\frac{K_i}{2}-\lvert1-K_p\rvert`, why: <>合併；<Tex>{r`\cos\Omega`}</Tex> 的係數取最壞情況。</> },
          {
            tex: r`\text{安全}\iff K_i\le2K_p\ \ \text{且}\ \ K_p+\frac{K_i}{2}\le2`,
            why: <>分 <Tex>{r`K_p\le1`}</Tex>（最小值 <Tex>{r`K_p-K_i/2\ge0`}</Tex>）與 <Tex>{'K_p>1'}</Tex>（最小值 <Tex>{r`2-K_p-K_i/2\ge0`}</Tex>）兩種情況。</>,
          },
        ]}
      />
      <Formula id="F-CS.16" />
      <p>
        <strong>數值</strong>（TS port 即時計算）：
      </p>
      <ul>
        <li>
          margin <Tex>{r`\min g`}</Tex>：{LOOP_KEYS.map((k) => `${k} ${fx(REMEDY[k].margin, 4)}`).join('、')}（L2 的 closed form <Tex>{`K_p-K_i/2=${tx(Kp - Ki / 2, 5)}`}</Tex>）。<Tex>{r`\min\mathrm{Re}\Gamma_{1d}`}</Tex>：
          {LOOP_KEYS.map((k, i) => (
            <span key={k}>
              {i ? '、' : ''}
              {k} {REMEDY[k].diff1 > -1e-12 ? <Tex>{r`\ge0`}</Tex> : <Sci v={REMEDY[k].diff1} sig={2} />}
            </span>
          ))}
          （數值容許 <Tex>{r`10^{-12}`}</Tex>）。
        </li>
        <li>
          由 §9 的定理，這對<strong>任何 <Tex>{r`\alpha`}</Tex>、任何 <Tex>{'Q'}</Tex> 的 joint <Tex>{r`9\times9`}</Tex> 都成立</strong>。
          <Claim kind="exact" />
        </li>
        <li>
          證據：小訊號 fine 500 點 {PRED.counts.L2['1diff'].sim_phos_inv} 反號（sim 與理論）；網站 2000 點 map 上 PHOS 與 GOS 都是 {PARAMS.signmap_summary.L2.n_inverted_kP_1diff + PARAMS.signmap_summary.L2.n_inverted_kG_1diff} 反號；大訊號（fine 500 點）
          <Tex>{'A=1'}</Tex> ps、5 ps、<Tex>{r`\infty`}</Tex> 都是 {lsInf('L2', '1diff') ?? '—'}。
        </li>
        <li>
          低 PM 也安全：L2 在 PM {lowPm.map((x) => `${x.pm}`).join('／')}° 時 <Tex>{`K_i/K_p=${lowPm.map((x) => tx(x.ratio, 3)).join('/')}<2`}</Tex>，margin 為 {lowPm.map((x) => fx(x.margin, 3)).join('／')}。
        </li>
      </ul>
      <Hand id="HC-CS.6">{r`把你的 $K_p$、$K_i$ 代進去，兩個 margin 都只要加減法；先自己算，再看它和上面「TS port 即時計算」的 margin 是否一致。`}</Hand>
      <p>
        <strong>更強的保證（有限步長）</strong>：若 <Tex>{r`\mathrm{Re}\Gamma\ge c\lvert\Gamma\rvert^2`}</Tex> 對所有 <Tex>{'f'}</Tex> 成立，由 Cauchy–Schwarz 可得 <Tex>{r`\mathrm{Re}\lambda\ge c\lvert\lambda\rvert^2/(v^HRv)`}</Tex>（<Tex>{'R'}</Tex> 為 regressor
        相關矩陣）。所以只要 <Tex>{r`\mu K_q\lambda_{max}(R)<2c`}</Tex>，block 更新就平均穩定，與 <Tex>{r`\alpha`}</Tex> 無關。一階差分的 disc constant 為 <Tex>{`c=`}</Tex> {LOOP_KEYS.map((k) => `${fx(REMEDY[k].disc, 3)}（${k}）`).join('、')}。若 PHOS occupancy 均勻，並以 raw regressor 在{' '}
        <Tex>{r`H\equiv1`}</Tex> 時的時間常數 <Tex>{r`N_\tau`}</Tex> 表示步長，條件就是 <Tex>{`N_\\tau>1/(2c)\\approx${tx(1 / (2 * Math.min(...LOOP_KEYS.map((k) => REMEDY[k].disc))), 1)}`}</Tex> blocks。
        <Claim kind="exact" />
      </p>
      <Callout kind="ok" title="直覺">
        <p>
          <Tex>{r`x[n]-x[n-1]`}</Tex> 只在 PMUX 換相、或鋸齒 wrap 的那一拍非零。<Tex>{r`h_{PD}[0]=1`}</Tex> 代表那一拍 PD 看到的就是誤差步階本身，與迴路後面的動態（那條長負尾巴）無關，所以符號一定對。
        </p>
      </Callout>
      <DataTable
        caption="一階差分的代價與失效模式。"
        head={['項目', '內容']}
        rows={[
          ['硬體', '每條 regressor 一個 register 與一個減法，約 9 個；幾乎免費'],
          [
            <strong key="h">硬性前提</strong>,
            <>
              code→比較器的延遲必須精確對齊（<Tex>{'D=0'}</Tex>）。錯一拍（<code>1diffD:±1</code>）就會失效。GOS（ref 端 DTC code）與 PHOS（fb 端 PMUX select）在硬體上可能屬於不同 clock domain，要<strong>分別</strong>對齊
            </>,
          ],
          [
            <Tex key="h">{r`h_{PD}[0]=1`}</Tex>,
            <>
              <strong>不是</strong>必要條件。比較器前級有單極點 <Tex>{'f_c'}</Tex> 時（TS 即時計算 <Tex>{r`\min_f\mathrm{Re}\{H_{PD}H_c(1-e^{j\Omega})\}`}</Tex>）：<Tex>{'f_c'}</Tex> = 0.5 GHz（<Tex>{`h_c[0]=${tx(cmpPole[0].a.hc0, 3)}`}</Tex>）時{' '}
              {cmpPole.map((x) => `${x.k} ${x.a.min >= -1e-9 ? '安全' : `min ${fx(x.a.min, 4)}`}`).join('、')}；<Tex>{'f_c'}</Tex> = 0.25 GHz（<Tex>{`h_c[0]=${tx(cmpPole[0].b.hc0, 3)}`}</Tex>）時{' '}
              {cmpPole
                .map((x) => `${x.k} ${x.b.min >= -1e-9 ? '安全' : `失效（${fx(x.b.negLoMHz, 0)}–${fx(x.b.negHiMHz, 0)} MHz 為負，min ${fx(x.b.min, 4)} @ ${fx(x.b.fMinMHz, 0)} MHz）`}`)
                .join('、')}
            </>,
          ],
          [
            '迴路延遲',
            <>
              上面的 closed form 只適用 1 拍延遲的 Type-II。延遲更長（或有寄生極點、其他取樣映射）時，要直接檢查 <Tex>{r`g(\Omega)=1-\cos\Omega+\mathrm{Re}\{(1-e^{-j\Omega})L\}\ge0`}</Tex>：L1 延遲 {latMargins[latMargins.length - 1].d} 拍（PM{' '}
              {fx(latMargins[latMargins.length - 1].pm, 0)}°）時 margin 是 {fx(latMargins[latMargins.length - 1].margin, 3)}，<strong>1diff 也會反號</strong>——推導與數字見表格下方的補充
            </>,
          ],
          ['LPTV', '8 相 SSPD 振幅失配 10% 加上 DTC 保持時間調變時，背景的 physics 審查（analysis/sspll/challenge_physics）報告 1diff 的 min Re eig 仍全部 > 0；本頁沒有重算這一項'],
          [
            '慢',
            <>
              對 Type-II，<Tex>{r`\mathrm{Re}\Gamma_{1d}\propto\Omega^4`}</Tex>（TS：低頻 log-log 斜率 {fx(slope.d1, 3)}；raw 為 {fx(slope.raw, 3)}）。所以 <Tex>{r`\alpha\to0`}</Tex> 時收斂很慢：L2 <Tex>{r`\alpha=0.002`}</Tex> 收斂到{' '}
              {fmtFs(PRED.lms['L2|0.002|1diff'].final_phos_rms_fs)}（其他 <Tex>{r`\alpha`}</Tex>：{fx(Math.min(...oneDiffFinals), 1)}–{fx(Math.max(...oneDiffFinals), 1)} fs）
            </>,
          ],
          ['額外好處', <><strong>zero-mean</strong>：完全不受比較器 offset 影響（§13）</>],
        ]}
      />

      <h4>補充：迴路延遲超過 1 拍時，1diff 的保證要重新檢查</h4>
      <p>
        「一階差分安全」的條件是 <Tex>{r`g(\Omega)\ge0`}</Tex>，它依賴迴路。以 Type-I、延遲 <Tex>{'d'}</Tex> 拍為例（<Tex>{r`L=Kz^{-d}/(1-z^{-1})`}</Tex>）：
      </p>
      <StepDerivation
        title={mathText(r`一步一步：Type-I、延遲 $d$ 拍的 $g(\Omega)$`)}
        steps={[
          { tex: r`(1-z^{-1})\,L=K\,z^{-d}`, why: <>差分 regressor 的 <Tex>{r`(1-z^{-1})`}</Tex> 剛好把迴路的積分器消掉，只剩增益與延遲。</> },
          { tex: r`\mathrm{Re}\{(1-e^{-j\Omega})L\}=\mathrm{Re}\{K\,e^{-jd\Omega}\}=K\cos(d\Omega)`, why: <>代入 <Tex>{r`z^{-1}=e^{-j\Omega}`}</Tex>，取實部。</> },
          { tex: r`g(\Omega)=1-\cos\Omega+K\cos(d\Omega)`, why: <>代入 <Tex>{r`g(\Omega)=1-\cos\Omega+\mathrm{Re}\{(1-e^{-j\Omega})L\}`}</Tex>。</> },
          {
            tex: r`d=1:\ g=1-(1-K)\cos\Omega\ \ge\ K>0;\qquad d\ge2:\ g\Big(\tfrac{\pi}{d}\Big)=1-\cos\tfrac{\pi}{d}-K`,
            why: <><Tex>{'d=1'}</Tex> 時恆正（<Tex>{'0<K<2'}</Tex>）。<Tex>{r`d\ge2`}</Tex> 時，延遲讓 <Tex>{r`K\cos(d\Omega)`}</Tex> 在 <Tex>{r`\Omega=\pi/d`}</Tex> 變成 <Tex>{'-K'}</Tex>，而 <Tex>{r`1-\cos(\pi/d)`}</Tex> 隨 <Tex>{'d'}</Tex> 變小：只要 <Tex>{r`K>1-\cos(\pi/d)`}</Tex> 就有負值。</>,
          },
        ]}
      />
      <DataTable
        className="cs-num"
        head={[<>延遲 <Tex>{'d'}</Tex>（都重新調到 320 MHz）</>, <Tex key="k">{'K'}</Tex>, 'PM', <Tex key="c">{r`1-\cos(\pi/d)`}</Tex>, <>margin <Tex>{r`\min_\Omega g`}</Tex></>, <Tex key="g">{r`\min_f\mathrm{Re}\,\Gamma_{1d}`}</Tex>]}
        rows={latMargins.map((x) => [
          String(x.d),
          fx(x.K, 4),
          `${fx(x.pm, 1)}°`,
          fx(1 - Math.cos(Math.PI / x.d), 4),
          <Kappa key="m" v={x.margin} digits={4} tol={0} />,
          x.minGamma > -1e-12 ? '$\\ge0$' : <strong key="g" className="cs-neg">{`${fx(x.minGamma, 3)} @ ${fx(x.fMinMHz, 0)} MHz`}</strong>,
        ])}
        caption="由 TS port 即時計算（oneDiffMargin、kernelMin）。延遲越長、為了維持 320 MHz 而剩下的 PM 越小，margin 越薄；5 拍時變成負的。"
      />
      <p>
        <Claim kind="exact">closed form；數值掃描與它一致（sspll.test.ts）</Claim>
        這一項是本頁的補充計算，分析文件沒有涵蓋；審查時另以 golden 的 <code>loops.py</code> 抽查 <Tex>{'d=5'}</Tex>，結果相同。寄生極點（200／250 MHz）、L2 延遲 2 拍、L3 的 halfT／zoh 映射則都滿足 <Tex>{r`\min\mathrm{Re}\,\Gamma_{1d}\ge0`}</Tex>（同樣在測試中）。你的晶片若在 SSPD
        之後還有額外的 pipeline 延遲，請用實驗 A 的指標「一階差分的 margin」確認。
      </p>

      <h3>
        11.2 filtered-x：<Tex>{r`r=\hat h_{PD}*x`}</Tex>（②）
      </h3>
      <Formula id="F-CS.17" />
      <p>
        模型精確時 <Tex>{r`\Gamma_{fx}=\lvert H\rvert^2\ge0`}</Tex>。模型不準時，看兩者相位差的 <Tex>{r`\min_f\cos\Delta\phi`}</Tex>（&gt; 0 才安全）：
      </p>
      <DataTable
        className="cs-num"
        head={[<>模型 <Tex>{r`\hat H`}</Tex></>, <>對 L2 的 <Tex>{r`\min\cos\Delta\phi`}</Tex></>, <>對 L3 的 <Tex>{r`\min\cos\Delta\phi`}</Tex></>]}
        rows={cosKeys.map((k) => [FX_MODEL_LABEL[k] ?? k, fx(RK.fx_typeII_model_min_cos[`L2|${k}`], 3), fx(RK.fx_typeII_model_min_cos[`L3|${k}`], 3)])}
      />
      <p>
        Type-II 形狀的模型都很 robust（最差 {fx(Math.min(...Object.values(RK.fx_typeII_model_min_cos)), 3)}）。BW <Tex>{r`\pm20\%`}</Tex> 的模型在 fine 500 點上 sim 與理論都是 {PRED.counts.L2['fx:bw0.8'].sim_phos_inv + PRED.counts.L2['fx:bw1.2'].sim_phos_inv} 反號；exact 模型在網站的 2000 點 map 上也是{' '}
        {PARAMS.signmap_summary.L2.n_inverted_kP_fx} 反號。
      </p>
      <Callout kind="warn" title="陷阱：拿 Type-I 模型去配 Type-II 迴路">
        <p>
          在 DC 的相位裕度是 0：<Tex>{r`\angle H_{II}\to180^\circ`}</Tex>、<Tex>{r`\angle\hat H_I\to90^\circ`}</Tex>，符號由 <Tex>{r`\Omega^4[\tfrac12+K_p/K_i-1/\hat K]`}</Tex> 決定，必須{' '}
          <Tex>{`\\hat K>1/(K_p/K_i+\\tfrac12)=${tx(fxI.K_hat_critical, 4)}`}</Tex>。
        </p>
        <DataTable
          className="cs-num"
          head={[<Tex key="k">{r`\hat K`}</Tex>, ...kHats.map((x) => x.k)]}
          rows={[
            [<Tex key="m">{r`\min\mathrm{Re}\{H\overline{\hat H}\}`}</Tex>, ...kHats.map((x) => (x.v.min > -1e-12 ? '$\\ge0$' : <Kappa key={x.k} v={x.v.min} digits={5} tol={0} />))],
            ['負值延伸到 [MHz]', ...kHats.map((x) => (x.v.neg_up_to_MHz === null ? '–' : fx(x.v.neg_up_to_MHz, 1)))],
          ]}
        />
        <p>
          <Claim kind="exact" />
        </p>
        <p>
          <strong>臨界值是「保證」的界線，不是「一低於就反號」的界線。</strong>
          <Tex>{r`\hat K`}</Tex> 略低於臨界值時 kernel 的負值很小，PHOS 其餘的譜線還救得回來。TS port 在 <Tex>{`\\alpha f_{ref}=${FX_SCAN_MHZ[0]}\\text{–}${FX_SCAN_MHZ[FX_SCAN_MHZ.length - 1]}`}</Tex> MHz（每 1 MHz 一點）掃 L2 的{' '}
          <Tex>{r`\kappa_{PHOS}`}</Tex>：
        </p>
        <DataTable
          className="cs-num"
          head={[<Tex key="k">{r`\hat K`}</Tex>, <>最小 <Tex>{r`\kappa_{PHOS}`}</Tex></>, <><Tex>{r`\kappa_{PHOS}<0`}</Tex> 的 <Tex>{r`\alpha f_{ref}`}</Tex> [MHz]</>]}
          rows={fxScan.map((x) => [String(x.k), <><Kappa v={x.min} digits={4} tol={0} /> @ {fx(x.fMinMHz, 1)} MHz</>, x.neg.length ? <strong key="n" className="cs-neg">{intervalsText(x.neg)}</strong> : '無（全為正）'])}
          caption="沒有反號時，最小值出現在掃描的下緣——那是近整數方向的 dead zone（§8.4），與模型好壞無關。"
        />
        <p>
          <Claim kind="approx">TS port 的數值掃描（ergodic 諧波和）；分析文件只列了 kernel 的最小值</Claim>
        </p>
      </Callout>
      <p>
        <strong>代價</strong>：9 條 IIR 必須在 4 GHz（250 ps/cycle）全速更新 state。GMAC 的相關運算可以降頻或平行化，但 IIR state 不能降頻。若用 Type-I／Type-II 模型，<Tex>{r`\hat H(1)=0`}</Tex>，濾波後的 regressor 沒有 DC，所以對 offset 也免疫。效果與 1diff
        相當或略好（L2 <Tex>{r`\alpha=0.002`}</Tex>：{fmtFs(PRED.lms['L2|0.002|fx:exact'].final_phos_rms_fs)} 對 {fmtFs(PRED.lms['L2|0.002|1diff'].final_phos_rms_fs)}），但成本高很多。
      </p>

      <h3>11.3 校準時 hold 住積分路徑（P-only）＋ zero-mean regressor（③）</h3>
      <DataTable
        className="cs-num"
        head={['hold 之後的迴路', '判據', '判據值（需 $<1$）', <Tex key="f">{r`f_{3dB}`}</Tex>, 'PM', <Tex key="r">{r`\min\mathrm{Re}H`}</Tex>]}
        rows={pOnly.map((x) => {
          const bands = inversionBands(x.loop)
          return [x.name, <Tex key="c">{x.critTex}</Tex>, fx(x.crit, 4), `${fx(loopF3dB(x.loop) * FREF_MHZ, 2)} MHz`, `${fx(loopMargins(x.loop).pmDeg, 2)}°`, bands.length ? <Kappa key="b" v={bands[0].minReH} /> : '$\\ge0$（掃描：無反號帶）']
        })}
      />
      <p>
        L2 凍結積分器之後是 Type-I，判據遠小於 1，所以 <Tex>{r`\mathrm{Re}H\ge0`}</Tex>；BW 從 320 MHz 變成 {fx(loopF3dB(P_ONLY.L2) * FREF_MHZ, 2)} MHz。L3 hold 住 <Tex>{'C_1'}</Tex> 時，安全的理由<strong>不是</strong>「變成 Type-I」（Type-I 加極點也可能反號，§6.1），而是
        closed form 的判據 &lt; 1。
        <Claim kind="exact" />
      </p>
      <p>
        <strong>大訊號仍需 zero-mean GOS</strong>：<Tex>{r`A\to\infty`}</Tex> 時，P-only + raw 在 L2／L3 仍有 {lsInf('L2', 'P-only|raw')}／{lsInf('L3', 'P-only|raw')} 個 <Tex>{r`\alpha`}</Tex> 反向（幾乎全是 GOS near-grid）。改用 <code>ac</code> 後是 {lsInf('L2', 'P-only|ac')}／
        {lsInf('L3', 'P-only|ac')}。
      </p>
      <p>
        <strong>代價與限制</strong>（物理面）：
      </p>
      <ol>
        <li>
          單一路徑的類比 R–<Tex>{r`C_1\parallel C_2`}</Tex>（或單一 SSCP）<strong>不能</strong>只靠一個開關 hold 積分路徑，需要 dual-path loop filter、buffer 或數位 loop filter。
        </li>
        <li>
          只能做 <strong>foreground</strong> 校準：校準期間 BW 與 PM 不同，迴路是 Type-I，所以無法在背景追蹤 PVT。
        </li>
        <li>
          Type-I 在頻率漂移下有 static phase error <Tex>{r`e_{ss}=(\Delta f/f)T_{ref}/K_p`}</Tex>。它與 raw one-hot 的平均值 1/8 耦合，會讓 PHOS 共模一直漂移，所以 <strong>PHOS 也要去平均</strong>（<code>zm</code>）。
        </li>
        <li>放開積分路徑時會有 transient（沒有模擬）。</li>
      </ol>

      <h3>11.4 PMUX 隨機旋轉／MASH（④，只有 sim 證據）</h3>
      <DataTable
        className="cs-num"
        head={['方法', 'DTC range', ...DITHER_ALPHAS.map((a) => `L2 $\\alpha=${a}$`), 'L3 $\\alpha=0.01$']}
        rows={DITHER_ROWS.map(([key, label, range]) => [
          label,
          range,
          ...DITHER_ALPHAS.map((a) => <Kappa key={a} v={DITHER.dither[`L2_pm60|${key}`]?.[a]?.kP} digits={3} />),
          <Kappa key="l3" v={DITHER.dither[`L3_imp_pm60|${key}`]?.['0.01']?.kP} digits={3} />,
        ])}
        caption={<>sim 的 <Tex>{r`\kappa_{PHOS}`}</Tex>（以各自的開迴路參考正規化）。一階累加器（raw，DTC range <Tex>{r`1\Delta`}</Tex>）在這些 <Tex>{r`\alpha`}</Tex> 反號或為 dead zone（§10）。</>}
      />
      <p>
        閉迴路 LMS：MASH 與 rot8 在 L2／L3 的 7 個 <Tex>{r`\alpha`}</Tex> 都收斂（L2 MASH {mashRange('L2_pm60|mash')}、rot8 {mashRange('L2_pm60|rot8')}；L3 MASH {mashRange('L3_imp_pm60|mash')}），
        <strong>
          但 L2-PM45 搭配 MASH 在 <Tex>{r`\alpha=0.03`}</Tex> 發散到 {fmtFs(DITHER.lms['L2_pm45|mash']?.['0.03|raw']?.final_phos_rms_fs)}
        </strong>
        ，目前理論無法解釋。
        <Claim kind="research" />
      </p>
      <p>代價：DTC range 要 2–8 倍、會多出 quantization 雜訊。隨機序列的交叉譜理論沒有做。</p>

      <h3>11.5 keep-out／freeze（⑤）</h3>
      <p>
        在安全的 <Tex>{r`\alpha`}</Tex> 校準好之後凍結，切到帶內頻道時不再更新。sim 的 freeze 實驗：先在 <Tex>{r`\alpha=0.137`}</Tex> 收斂到 PHOS {fmtFs(frz['L2_pm60|phase2|frozen']?.['0.01|raw']?.phos_initial_fs)}，再切到 <Tex>{r`\alpha=0.01`}</Tex>／0.03。
      </p>
      <ul>
        <li>
          LMS 繼續跑：L2 變成 {fmtFs(frz['L2_pm60|phase2|lms_on']?.['0.01|raw']?.phos_final_fs)}／{fmtFs(frz['L2_pm60|phase2|lms_on']?.['0.03|raw']?.phos_final_fs)}；L3 在 <Tex>{r`\alpha=0.01`}</Tex> 變成{' '}
          {fmtFs(frz['L3_imp_pm60|phase2|lms_on']?.['0.01|raw']?.phos_final_fs)}（<Tex>{r`\alpha=0.03`}</Tex> 對 L3 在帶外，維持 {fmtFs(frz['L3_imp_pm60|phase2|lms_on']?.['0.03|raw']?.phos_final_fs)}）。
        </li>
        <li>
          凍結：三個迴路都維持 {fmtFs(frz['L2_pm60|phase2|frozen']?.['0.01|raw']?.phos_final_fs)}。
        </li>
      </ul>
      <p>GOS 與 PHOS 是硬體常數，與頻道無關，所以這在物理上可行；但無法背景追蹤溫度漂移。keep-out 清單請見 §15。</p>

      <h3>11.6 有害的「對策」</h3>
      <DataTable
        className="cs-num"
        head={['變形', <><Tex>{r`\min\mathrm{Re}\Gamma`}</Tex>（L2／L3）</>, 'fine 500 點反號（L2，PHOS／GOS）', '閉迴路（L2 $\\alpha=0.137$）']}
        rows={[
          [
            <>相關器延遲 <Tex>{'D=+1'}</Tex></>,
            <>
              <strong className="cs-neg">{fx(REMEDY.L2.d1, 4)}</strong>／{fx(REMEDY.L3.d1, 4)}（<Tex>{r`=-H_{PD}(\tfrac12)`}</Tex>）
            </>,
            `${PRED.counts.L2['D:1'].sim_phos_inv}／${PRED.counts.L2['D:1'].sim_gos_inv}`,
            <>PHOS {fmtFs(PRED.lms['L2|0.137|D:1'].final_phos_rms_fs)}、GOS {fmtFs(PRED.lms['L2|0.137|D:1'].final_gos_fs)}</>,
          ],
          [
            '二階差分',
            `${fx(REMEDY.L2.diff2, 4)}／${fx(REMEDY.L3.diff2, 4)}`,
            `${PRED.counts.L2['2diff'].sim_phos_inv}／${PRED.counts.L2['2diff'].sim_gos_inv}`,
            <>PHOS {fmtFs(PRED.lms['L2|0.137|2diff'].final_phos_rms_fs)}</>,
          ],
        ]}
      />
      <p>
        <Claim kind="exact" />
        在 generic <Tex>{r`\alpha`}</Tex>，PMUX 指標每拍都在換，錯一拍等於把 regressor 換成另一相。二階差分在 <Tex>{r`f_{ref}/4`}</Tex> 以下、<Tex>{r`H\approx1`}</Tex> 的頻段相位接近 <Tex>{r`\pi`}</Tex>，會把原本安全的 <Tex>{r`\alpha`}</Tex> 反向。（第 7 章 §7.5 的「Type-II 二次差分 regressor」是<strong>低頻</strong>近似：在 Type-II 的帶內它確實像 filtered-x——L2 在 84 MHz 的{' '}
        <Tex>{`\\kappa_{PHOS}=${fs(twoDiff.inBand, 3).replace('−', '-')}`}</Tex>——但帶外的頻道被它弄反，例如 548 MHz 的 <Tex>{`\\kappa_{PHOS}=${fs(twoDiff.outBand, 3).replace('−', '-')}`}</Tex>。PMUX 的旋轉頻率會隨頻道跑遍整個頻帶，所以不能用。）
      </p>

      <h3>11.7 對策比較總表</h3>
      <DataTable
        head={['對策', '線性：任何 $\\alpha$ 都安全？', <>大訊號 <Tex>{r`A\to\infty`}</Tex>（L1／L2／L3 反向數）</>, '對 offset', '硬體代價', '主要失效模式']}
        rows={[
          ['raw', '否（Type-II 帶內）', LOOP_KEYS.map((k) => lsInf(k, 'raw')).join('／'), '會偏（GOS）／共模漂移（PHOS）', '–', '–'],
          [<strong key="a">1diff</strong>, <><strong>是</strong>（<Tex>{r`\min_\Omega g\ge0`}</Tex> 時；三個標稱迴路都成立）</>, LOOP_KEYS.map((k) => lsInf(k, '1diff')).join('／'), '免疫', '極低', <>D 對齊（GOS、PHOS 分開）；比較器極點太低；迴路延遲太長（L1 延遲 5 拍）；<Tex>{r`\alpha\to0`}</Tex> 很慢</>],
          [<strong key="a">filtered-x</strong>, <>是（只要 <Tex>{r`\lvert\Delta\phi\rvert\le90^\circ`}</Tex>）</>, LOOP_KEYS.map((k) => lsInf(k, 'fx:exact')).join('／'), '免疫（Type-I/II 模型）', '9 條 4 GHz IIR', <>Type-I 模型的 <Tex>{`\\hat K<${tx(fxI.K_hat_critical, 4)}`}</Tex></>],
          [<strong key="a">P-only + zm</strong>, `是（判據 ${fx(pOnly[0].crit, 2)}／${fx(pOnly[1].crit, 2)}）`, `–／${lsInf('L2', 'P-only|ac')}／${lsInf('L3', 'P-only|ac')}（以 ac 計算）`, 'zm 才免疫', 'hold 開關、dual-path LF', '只能 foreground；BW 改變；transient'],
          ['隨機旋轉／MASH', 'sim：大多安全', 'sim：大多安全', '–', 'DTC range $\\times2$–$\\times8$', 'L2-PM45 MASH $\\alpha=0.03$ 發散（未解）'],
          ['keep-out／freeze', '迴避', '需大訊號清單', '–', '頻道規劃', '無法追蹤 PVT；清單要涵蓋 PVT'],
          ['$D\\ne0$、2diff', <strong key="a" className="cs-neg">有害</strong>, '–', '–', '–', '大面積反號'],
        ]}
      />

      <h3>11.8 核心程式碼並排</h3>
      <p>
        下面每一段都是網站<strong>實際執行</strong>的程式（<code>{MODEL_PATH}</code>）：實驗 C 的閉迴路 LMS 每一拍就是呼叫其中一個函式產生 GMAC 的 regressor <Tex>{'r[n]'}</Tex>。不同對策<strong>只差在標示「← 差異」的那幾行</strong>。
      </p>
      <ModelCompare
        items={[
          { label: 'raw', region: 'regRaw', note: '$G=1$：Type-II 帶內會反號。' },
          { label: '一階差分（推薦）', region: 'regDiff1', note: '$G=1-z^{-1}$：只多一個 register 和一個減法。' },
          { label: 'filtered-x', region: 'regFx', note: '$G=\\hat H_{PD}$：每條 regressor 一個以 $f_{ref}$ 運作的 IIR。' },
        ]}
        caption="推薦的兩種對策與 raw 的差別。"
      />
      <ModelCompare
        items={[
          { label: 'ac／zm（zero-mean）', region: 'regZeroMean', note: '線性的 $C$ 不變，但對比較器 offset 與大訊號有差（§13、§10）。' },
          { label: 'D:k（相關器延遲，有害）', region: 'regDelay', note: '$G=z^{-D}$：$\\min\\mathrm{Re}\\,\\Gamma=-H_{PD}(\\tfrac12)$。' },
          { label: '二階差分（有害）', region: 'regDiff2', note: '$G=(1-z^{-1})^2$：$f_{ref}/4$ 以下相位接近 $\\pi$。' },
        ]}
        caption="zero-mean 與兩種有害的變形。"
      />
      <ModeGate min="engineer">
        <p>
          頻域的同一件事——前置濾波 <Tex>{'G'}</Tex> 與有效 kernel <Tex>{r`\Gamma_{\rm eff}=H_{PD}\overline G`}</Tex>，TS port 與 Python golden 並排：
        </p>
        <CodeCompare
          items={[
            { label: 'TypeScript（網站執行）：variantG', source: MODEL_SRC, region: 'variantG', path: MODEL_PATH },
            { label: 'Python golden：variant_G', source: PY_SOURCES.regressors.source, region: 'variant_G', lang: 'python', path: PY_SOURCES.regressors.path },
          ]}
        />
        <CodeCompare
          items={[
            { label: 'TypeScript：gammaEff', source: MODEL_SRC, region: 'gammaEff', path: MODEL_PATH },
            { label: 'Python golden：gamma_eff', source: PY_SOURCES.predictions.source, region: 'gamma_eff', lang: 'python', path: PY_SOURCES.predictions.path },
          ]}
        />
        <GoldenCode file="regressors" region="gmac_variants" title="Python golden：時域的 regressor 變體（apply_variant）" caption="golden 的閉迴路 LMS 與 sim replica 都用這一段；TS 版把每個分支拆成上面的獨立函式。" />
      </ModeGate>
      <Src>
        對策的 kernel 由 TS port 即時計算（<code>kernelMin</code>、<code>oneDiffMargin</code>、<code>discConstant</code>），測試中與 <code>params.json</code> 的 <code>remedy_kernels</code> 比對；filtered-x 模型掃描、MASH／隨機旋轉與 freeze 來自 golden 的{' '}
        <code>params.json</code>、<code>results/sim_dither_extract.json</code>；sim 物理模型 <Tex>{`\\Delta=${SIM_CFG.deltaPs}`}</Tex> ps。
      </Src>
    </Section>
  )
}
