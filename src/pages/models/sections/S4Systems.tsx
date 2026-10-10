import { useMemo, useState } from 'react'
import pllSrc from '@/simulation/models/pll.ts?raw'
import dsmSrc from '@/simulation/models/dsm.ts?raw'
import dtcSrc from '@/simulation/models/dtc.ts?raw'
import {
  Callout,
  ClaimTag,
  CodeBlock,
  ModeGate,
  ModelLevel,
  ParamControl,
  Plot,
  Prereq,
  Section,
  SelectControl,
  Tex,
  TexBlock,
  useThemeTokens,
} from '@/components'
import { cAbs, cArg, cToString } from '@/simulation/core'
import { designDtLoop, loopFreqResponse, type DtLoopMethod } from '@/simulation/models/pll'
import { DsmStream } from '@/simulation/models/dsm'
import { dtcDelayFs, dtcInlDnl, dtcMapping, quantizeDtcCode, type DtcParams } from '@/simulation/models/dtc'
import { ChLink, ErratumNote, HandCalcSlot, Steps, fx, md, sig, texNum } from '../common'
import { texifyModelText } from '../experiments/modelText'

/** poles 的 TeX：共軛對合寫成 a\pm jb，其餘逐一列出（頁面文字用；數字仍來自 designDtLoop） */
function polesTex(poles: { re: number; im: number }[], digits = 5): string {
  const hasConjugate = (z: { re: number; im: number }): boolean => poles.some((q) => q !== z && Math.abs(q.re - z.re) < 1e-12 && Math.abs(q.im + z.im) < 1e-12)
  const out: string[] = []
  for (const z of poles) {
    if (z.im === 0) out.push(sig(z.re, digits))
    else if (!hasConjugate(z)) out.push(`${sig(z.re, digits)}${z.im < 0 ? '-' : '+'}j${sig(Math.abs(z.im), digits)}`)
    else if (z.im > 0) out.push(`${sig(z.re, digits)}\\pm j${sig(z.im, digits)}`)
  }
  return out.join(',\\;')
}

const OMEGA_GRID = Array.from({ length: 241 }, (_, i) => Math.PI * 10 ** (-4 + (4 * i) / 240))

function DtLoopPanel() {
  const [wnTs, setWnTs] = useState(0.1)
  const [zeta, setZeta] = useState(0.7)
  const [d, setD] = useState(1)
  const [method, setMethod] = useState<DtLoopMethod>('dpll')
  const tokens = useThemeTokens()
  const des = useMemo(() => designDtLoop({ wnTs, zeta, loopDelay: d, method }), [wnTs, zeta, d, method])
  const fr = useMemo(() => loopFreqResponse(des, OMEGA_GRID), [des])
  const magDb = useMemo(() => fr.Hpd.map((z) => 20 * Math.log10(Math.max(cAbs(z), 1e-300))), [fr])
  const phaseDeg = useMemo(() => fr.Hpd.map((z) => (cArg(z) * 180) / Math.PI), [fr])
  // Re{H_PD} = 0 的第一個交越（polarity 邊界）
  const boundary = useMemo(() => {
    for (let i = 1; i < fr.Hpd.length; i++) {
      if (fr.Hpd[i - 1].re < 0 && fr.Hpd[i].re >= 0) {
        const t = -fr.Hpd[i - 1].re / (fr.Hpd[i].re - fr.Hpd[i - 1].re)
        return OMEGA_GRID[i - 1] + t * (OMEGA_GRID[i] - OMEGA_GRID[i - 1])
      }
    }
    return NaN
  }, [fr])
  const data = useMemo(
    () => [
      { x: OMEGA_GRID, y: magDb, name: '|H_PD| [dB]', mode: 'lines' as const, line: { color: tokens.series[0] } },
      { x: OMEGA_GRID, y: phaseDeg, name: '∠H_PD [deg]', mode: 'lines' as const, yaxis: 'y2', line: { color: tokens.series[1], dash: 'dot' as const } },
    ],
    [magDb, phaseDeg, tokens],
  )
  const layout = useMemo(
    () => ({
      xaxis: { title: { text: 'Ω [rad/sample]' }, type: 'log' as const },
      yaxis: { title: { text: '|H_PD| [dB]' } },
      yaxis2: { title: { text: '相位 [deg]' }, overlaying: 'y' as const, side: 'right' as const, range: [-180, 180] },
      shapes: Number.isFinite(boundary)
        ? [{ type: 'line' as const, x0: boundary, x1: boundary, y0: 0, y1: 1, yref: 'paper' as const, line: { color: tokens.series[2], dash: 'dash' as const, width: 1.5 } }]
        : [],
    }),
    [boundary, tokens],
  )
  return (
    <div className="models-panel">
      <div className="models-controls">
        <ParamControl
          label={md('$\\omega_nT_s$（正規化自然頻率）')}
          ariaLabel="omega_n T_s（正規化自然頻率）"
          value={wnTs}
          onChange={setWnTs}
          min={0.001}
          max={1}
          log
          unit="rad/sample"
          reg="Behavioral：pll_error_path.parameters.wn_ts"
          hint={md('JSON 合法範圍 $(0,2]$；$>0.3$ 時 DT 與 CT 原型失準（E44）')}
        />
        <ParamControl label={md('$\\zeta$（阻尼）')} ariaLabel="zeta（阻尼）" value={zeta} onChange={setZeta} min={0.1} max={3} step={0.01} unit="—" reg="Behavioral：pll_error_path.parameters.zeta" />
        <ParamControl
          label={md('額外 loop latency $d$')}
          ariaLabel="額外 loop latency d"
          value={d}
          onChange={setD}
          min={0}
          max={8}
          step={1}
          integer
          clampOnBlur
          unit="samples"
          reg="Behavioral：pll_error_path.parameters.loop_delay"
        />
        <SelectControl
          label="離散化方法"
          value={method}
          onChange={setMethod}
          options={[
            { value: 'dpll', label: 'dpll（直接差分方程，預設）' },
            { value: 'bilinear', label: 'bilinear（Tustin 對照）' },
          ]}
          reg="Behavioral：pll_error_path.parameters.method"
        />
      </div>
      <div className="table-wrap">
        <table className="models-table models-num">
          <tbody>
            <tr>
              <th>
                <Tex>{'K_p=2\\zeta\\omega_nT_s'}</Tex>
              </th>
              <td>{sig(des.Kp, 6)}</td>
              <th>
                <Tex>{'K_i=(\\omega_nT_s)^2'}</Tex>
              </th>
              <td>{sig(des.Ki, 6)}</td>
            </tr>
            <tr>
              <th>
                <Tex>{'L(z)'}</Tex> 分子（<Tex>{'z^{-1}'}</Tex> 升冪）
              </th>
              <td className="mono">[{des.L.b.map((v) => sig(v, 5)).join(', ')}]</td>
              <th>
                <Tex>{'L(z)'}</Tex> 分母
              </th>
              <td className="mono">[{des.L.a.map((v) => sig(v, 5)).join(', ')}]</td>
            </tr>
            <tr>
              <th>
                特徵多項式 <Tex>{'1+L'}</Tex> 分母
              </th>
              <td className="mono" colSpan={3}>
                [{des.Hpd.a.map((v) => sig(v, 6)).join(', ')}]
              </td>
            </tr>
            <tr>
              <th>closed-loop poles</th>
              <td className="mono" colSpan={3}>
                {des.poles.map((z) => cToString(z, 5)).join('；')}
              </td>
            </tr>
            <tr>
              <th>spectral radius</th>
              <td>{sig(des.spectralRadius, 6)}</td>
              <th>穩定</th>
              <td>{des.stable ? '是（所有 pole 在單位圓內）' : '否'}</td>
            </tr>
            <tr>
              <th>
                polarity 邊界 <Tex>{'\\mathrm{Re}\\,H_\\mathrm{PD}=0'}</Tex>
              </th>
              <td colSpan={3}>
                {Number.isFinite(boundary) ? (
                  <>
                    <Tex>{`\\Omega_b=${texNum(boundary, 5)}\\,\\text{rad/sample}=${texNum(boundary / wnTs, 4)}\\,\\omega_nT_s`}</Tex>（CT 原型為 <Tex>{'\\omega_n'}</Tex>，E44）
                  </>
                ) : (
                  '在格點範圍內沒有交越'
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {des.warnings.length > 0 && (
        <Callout kind="danger" title="設計警告">
          <ul className="models-tight">
            {des.warnings.map((w) => (
              <li key={w}>{md(texifyModelText(w))}</li>
            ))}
          </ul>
        </Callout>
      )}
      <Plot
        title="$H_\mathrm{PD}(e^{j\Omega})$：振幅與相位（虛線為 $\mathrm{Re}\,H_\mathrm{PD}=0$ 的 polarity 邊界）"
        data={data}
        layout={layout}
        height={300}
        csvName="models-dt-hpd"
        caption="$\Omega$ 為 comparator 取樣率上的 rad/sample；相位越過 $\pm90^\circ$ 的頻帶，單頻相關 $C$ 會變號（Ch06）。"
      />
    </div>
  )
}

function useDsmTable() {
  return useMemo(() => {
    const s = new DsmStream({ kind: 'first_order', frac: 0.3, bits: 4 })
    const rows: { n: number; inp: number; y: number; qe: number; r: number; st: number }[] = []
    for (let n = 0; n < 16; n++) {
      const y = s.step()
      rows.push({ n, inp: s.input, y, qe: s.quantError, r: s.residue, st: -s.M * s.residue })
    }
    return { rows, M: s.M, K: s.K, fracEff: s.fracEff }
  }, [])
}

const DTC_EXAMPLE: DtcParams = { gainFs: 250, offsetFs: 1000, c2: 0.2, bits: 6, rounding: 'nearest' }
const DTC_CODES = [-3, 0, 10.4, 10.5, 31.49, 63, 70.2]

function useDtcTable() {
  return useMemo(() => {
    const rows = DTC_CODES.map((c) => {
      const qn = quantizeDtcCode(c, DTC_EXAMPLE)
      const qt = quantizeDtcCode(c, { ...DTC_EXAMPLE, rounding: 'truncate' })
      return {
        c,
        qn: qn.code,
        sat: qn.saturated,
        qt: qt.code,
        ideal: dtcMapping(c, DTC_EXAMPLE),
        delayN: dtcDelayFs(c, DTC_EXAMPLE),
        delayT: dtcDelayFs(c, { ...DTC_EXAMPLE, rounding: 'truncate' }),
      }
    })
    const inl = dtcInlDnl(DTC_EXAMPLE)
    // 10.5 的兩種 rounding 差一個 code：τ(11) − τ(10)
    const step1011 = dtcMapping(11, DTC_EXAMPLE) - dtcMapping(10, DTC_EXAMPLE)
    return { rows, inl, step1011 }
  }, [])
}

/** §4 L2 的三塊積木：DT PLL、DSM residue、DTC mapping */
export function S4Systems() {
  const dsm = useDsmTable()
  const dtc = useDtcTable()
  const ex = useMemo(() => designDtLoop({ wnTs: 0.1, zeta: 0.7, loopDelay: 1 }), [])
  // 同一組 ω_nT_s、ζ 但 d = 0：特徵式是二次式，可以手算（HC-MD.1 的預設數字）
  const ex0 = useMemo(() => designDtLoop({ wnTs: 0.1, zeta: 0.7, loopDelay: 0 }), [])
  return (
    <section aria-labelledby="models-s4">
      <h2 id="models-s4">4｜L2 的三塊積木：DT 主 PLL、DSM residue、DTC mapping</h2>
      <p>
        <ModelLevel level="L2" /> 比 L1 多了「code 從哪裡來（DSM）」、「誤差經過什麼路徑才到 comparator（主 PLL）」與「code 怎麼變成延遲（DTC）」。JSON 的{' '}
        <code>pll_error_path</code>、<code>seeded_pattern</code>、<code>gain_register</code> 就是在選這三塊積木。下面三段程式都是網站實際執行的版本。
      </p>

      <Section kind="formula" title="4.1 離散時間主 PLL：從 $L(z)$ 到 $H_\mathrm{PD}(z)$ 的係數" level={3}>
        <Prereq title="從 $s$ 到 $z$：為什麼不能把 $\Omega$ 直接代進 $H(j\omega)$">
          <p>
            連續時間的 <Tex>{'H(s)'}</Tex> 描述的是「每秒」的動態；comparator 每 <Tex>{'T_s'}</Tex> 取樣一次，序列的動態要用 <Tex>{'H(z)'}</Tex> 描述，頻率響應是{' '}
            <Tex>{'H(e^{j\\Omega})'}</Tex>，<Tex>{'\\Omega=\\omega T_s'}</Tex>（rad/sample）。兩者只在 <Tex>{'\\omega_nT_s\\ll1'}</Tex> 且沒有額外 latency 時接近；直接代入{' '}
            <Tex>{'H(j\\Omega)'}</Tex> 會把 rad/sample 與 rad/s 混用，polarity 邊界也會算錯 <ErratumNote id="E44" />。
          </p>
        </Prereq>
        <Steps
          title="$L(z)$ 的分子分母（DPLL 差分方程，$d$ 為額外 latency）"
          steps={[
            { tex: String.raw`L(z)=\Bigl(K_p+\frac{K_i}{1-z^{-1}}\Bigr)\cdot\frac{z^{-(1+d)}}{1-z^{-1}}`, why: 'PI loop filter 乘上 DCO 相位累加器 $z^{-1}/(1-z^{-1})$，再加 $d$ 個 sample 的額外延遲。' },
            { tex: String.raw`=\frac{K_p(1-z^{-1})+K_i}{1-z^{-1}}\cdot\frac{z^{-(1+d)}}{1-z^{-1}}`, why: '把 PI 通分。' },
            { tex: String.raw`=\frac{\bigl[(K_p+K_i)-K_pz^{-1}\bigr]z^{-(1+d)}}{1-2z^{-1}+z^{-2}}`, why: '展開分子，並用 $(1-z^{-1})^2=1-2z^{-1}+z^{-2}$。程式中 numL[d+1] 放 $K_p+K_i$、numL[d+2] 放 $-K_p$、denL 為 $[1,-2,1]$。' },
            { tex: String.raw`H_\mathrm{PD}(z)=\frac{1}{1+L(z)}=\frac{\mathrm{den}_L(z)}{\mathrm{den}_L(z)+\mathrm{num}_L(z)}`, why: '上下同乘 $\\mathrm{den}_L$；程式中 char = dL + nL（補零到同長度後逐項相加）。' },
            { tex: String.raw`h_\mathrm{PD}[0]=\lim_{z\to\infty}H_\mathrm{PD}(z)=1`, why: '$\\mathrm{num}_L$ 從 $z^{-(1+d)}$ 開始（嚴格因果），所以 char 的首項與 $\\mathrm{den}_L$ 相同；白色 $x$ 時 $C=h_\\mathrm{PD}[0]\\,\\sigma_x^2=\\sigma_x^2>0$（精確）。' },
          ]}
        />
        <TexBlock id="F-15.8" label="離散時間主 PLL（直接 DPLL 差分方程）">
          {String.raw`L(z)=\Bigl(K_p+\frac{K_i}{1-z^{-1}}\Bigr)\frac{z^{-(1+d)}}{1-z^{-1}},\;K_p=2\zeta\omega_nT_s,\;K_i=(\omega_nT_s)^2,\;H_\mathrm{PD}=\frac{1}{1+L}`}
        </TexBlock>
        <p>
          手算：<Tex>{'\\omega_nT_s=0.1,\\;\\zeta=0.7,\\;d=1'}</Tex> 時 <Tex>{`K_p=${sig(ex.Kp, 4)},\\;K_i=${sig(ex.Ki, 4)}`}</Tex>，特徵多項式（<Tex>{'z^{-1}'}</Tex> 升冪）
          <Tex>{`[${ex.Hpd.a.map((v) => sig(v, 4)).join(',\\,')}]`}</Tex>，也就是 <Tex>{`z^3-2z^2+${sig(ex.Hpd.a[2], 4)}z${sig(ex.Hpd.a[3], 4)}=0`}</Tex>，poles 為 <Tex>{`z=${polesTex(ex.poles)}`}</Tex>（spectral radius <Tex>{`\\rho=${sig(ex.spectralRadius, 6)}`}</Tex>）。<ClaimTag kind="exact" />
        </p>
        <p className="small">
          <Tex>{'d=0'}</Tex> 時 <Tex>{'z^{-(1+d)}=z^{-1}'}</Tex>，特徵式只有二次：<Tex>{`z^2+(K_p+K_i-2)z+(1-K_p)=z^2${sig(ex0.Hpd.a[1], 4)}z+${sig(ex0.Hpd.a[2], 4)}=0`}</Tex>，poles 為 <Tex>{`z=${polesTex(ex0.poles)}`}</Tex>（<Tex>{`\\rho=${sig(ex0.spectralRadius, 6)}`}</Tex>）——可以用二次公式手算。多 1 個 sample 的 latency 就變成上面的三次式，這也是為什麼 RTL 的 pipeline 延遲一定要放進模型。
        </p>
        <HandCalcSlot id="HC-MD.1">
          換成你的 <Tex>{'\\omega_nT_s'}</Tex> 與 <Tex>{'\\zeta'}</Tex>，用二次公式把兩個 closed-loop pole 算出來，再把下面面板的 <Tex>{'d'}</Tex> 設成 0 對答案。
        </HandCalcSlot>
        <CodeBlock source={pllSrc} region="designDtLoop" path="src/simulation/models/pll.ts" title="core:designDtLoop" caption="dpll 分支就是上面的推導；bilinear 分支是 Tustin 對照（$h_\mathrm{PD}[0]\ne1$）。JSON 的 pll_error_path.kind = 'type2_dt' 會呼叫這裡。" />
        <DtLoopPanel />
      </Section>

      <Section kind="formula" title="4.2 DSM phase residue：DTC 到底要補什麼" level={3}>
        <p>
          Fractional-N divider 每個 reference cycle 除以 <Tex>{'N_\\mathrm{int}+y[n]'}</Tex>，理想是 <Tex>{'N_\\mathrm{int}+\\mathrm{frac}'}</Tex>。多除或少除的部分累積成時間誤差——這就是 DTC 要抵消的
          residue <Tex>{'r[n]'}</Tex>，也就是 GMAC 的 regressor 來源。
        </p>
        <Steps
          title="一階累加器的 residue 是 telescoping sum"
          steps={[
            { tex: String.raw`t=s[n-1]+\mathrm{in}[n],\quad y[n]=\mathbb 1[t\ge M],\quad s[n]=t-M\,y[n]`, why: '累加器溢位時進位 $y=1$ 並減掉 $M$（下方 core:dsmStep 的第 3–9 行）。' },
            { tex: String.raw`M\,y[n]=\mathrm{in}[n]-\bigl(s[n]-s[n-1]\bigr)`, why: '把第三式移項：$s[n]-s[n-1]=\\mathrm{in}[n]-M\\,y[n]$。' },
            { tex: String.raw`y[n]-\frac{\mathrm{in}[n]}{M}=-\frac{s[n]-s[n-1]}{M}`, why: '兩邊除以 $M$。這就是一階 noise shaping：$(1-z^{-1})$ 作用在累加器內容上。' },
            { tex: String.raw`r[n]=\sum_{m=0}^{n}\Bigl(y[m]-\frac{\mathrm{in}[m]}{M}\Bigr)=-\frac{s[n]-s[-1]}{M}`, why: '相鄰項互相抵消（telescoping），只剩頭尾。' },
            { tex: String.raw`s[n]\in[0,M)\;\Rightarrow\;r[n]\in\Bigl(-1+\tfrac{s[-1]}{M},\,\tfrac{s[-1]}{M}\Bigr]`, why: '累加器內容有界，所以 residue 恆有界（零初值時 $r[n]\\in(-1,0]$）——不會隨時間漂移。' },
          ]}
        />
        <TexBlock id="F-15.9" label="DSM phase residue（一階）">
          {String.raw`r[n]=\sum_{m=0}^{n}\Bigl(y[m]-\frac{\mathrm{in}[m]}{M}\Bigr)=\frac{s[-1]-s[n]}{M}\in(-1,1)\;[T_\mathrm{vco}]`}
        </TexBlock>
        <p>
          先算一次：<Tex>{`B=4\\Rightarrow M=${dsm.M}`}</Tex>，<Tex>{`\\mathrm{frac}=0.3\\Rightarrow K_\\mathrm{FCW}=\\mathrm{round}(0.3\\times16)=${dsm.K}`}</Tex>（實際平均{' '}
          <Tex>{`${dsm.K}/${dsm.M}=${dsm.fracEff}`}</Tex>）。下表由 <code>DsmStream</code> 逐步產生；<Tex>{'s[n]'}</Tex> 欄由 <Tex>{'s[n]=-M\\,r[n]'}</Tex> 反推（<Tex>{'s[-1]=0'}</Tex>）。
        </p>
        <div className="table-wrap">
          <table className="models-table models-num">
            <thead>
              <tr>
                <th>
                  <Tex>{'n'}</Tex>
                </th>
                {dsm.rows.map((r) => (
                  <th key={r.n}>{r.n}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>
                  <Tex>{'\\mathrm{in}[n]'}</Tex>
                </th>
                {dsm.rows.map((r) => (
                  <td key={r.n}>{r.inp}</td>
                ))}
              </tr>
              <tr>
                <th>
                  <Tex>{'s[n]'}</Tex>
                </th>
                {dsm.rows.map((r) => (
                  <td key={r.n}>{fx(r.st, 0)}</td>
                ))}
              </tr>
              <tr>
                <th>
                  <Tex>{'y[n]'}</Tex>
                </th>
                {dsm.rows.map((r) => (
                  <td key={r.n}>{r.y}</td>
                ))}
              </tr>
              <tr>
                <th>
                  <Tex>{'r[n]'}</Tex> [<Tex>{'T_\\mathrm{vco}'}</Tex>]
                </th>
                {dsm.rows.map((r) => (
                  <td key={r.n}>{fx(r.r, 4)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small">
          你會發現：16 個 cycle 裡 <Tex>{'y=1'}</Tex> 出現 {dsm.rows.reduce((a, r) => a + r.y, 0)} 次（等於 <Tex>{'K_\\mathrm{FCW}'}</Tex>），residue 走完一個週期 <Tex>{`M/\\gcd(K_\\mathrm{FCW},M)=${dsm.M}`}</Tex> 後回到 0，且永遠在{' '}
          <Tex>{'(-1,0]'}</Tex> 內。程式以整數 <Tex>{'R[n]=\\sum(My-\\mathrm{in})'}</Tex> 累加後再除以 <Tex>{'M'}</Tex>，所以長時間模擬也沒有浮點漂移。MASH 1-1-1 的推導見 <ChLink to="/ch/04">Ch04</ChLink>。
        </p>
        <CodeBlock source={dsmSrc} region="dsmStep" path="src/simulation/models/dsm.ts" title="core:dsmStep（含 core:dsmResidue）" caption="MASH 1-1-1 分支：$y=c_1+(1-z^{-1})c_2+(1-z^{-1})^2c_3$（三級進位的組合）；residue 的累加方式相同。" highlight={[33, 36]} />
      </Section>

      <Section kind="formula" title="4.3 DTC mapping：code → delay（量化、飽和、非線性）" level={3}>
        <p>
          DTC 把整數 code 轉成延遲。行為模型分兩步：先量化（rounding）與飽和到實體範圍，再套增益、offset、二階／三階與 INL 查表。JSON 的 <code>gain_register</code>（quantize_physical）與{' '}
          <code>dtc_nonlinearity</code> 就是這兩步在正規化 code 上的版本。
        </p>
        <TexBlock id="F-15.10" label="DTC code → delay">
          {String.raw`\tau(c)=g_\mathrm{DTC}\,\hat c+o+c_2\hat c^2+c_3\hat c^3+\mathrm{INL}(\hat c),\quad \hat c=\mathrm{sat}\bigl(Q(c)\bigr)`}
        </TexBlock>
        <p>
          先算一次（<Tex>{'g_\\mathrm{DTC}=250\\,\\mathrm{fs/LSB},\\;o=1000\\,\\mathrm{fs},\\;c_2=0.2\\,\\mathrm{fs/LSB^2}'}</Tex>，6-bit unsigned，範圍 0…63）：
        </p>
        <div className="table-wrap">
          <table className="models-table models-num">
            <thead>
              <tr>
                <th>
                  輸入 code <Tex>{'c'}</Tex>
                </th>
                <th>
                  理想 <Tex>{'\\tau(c)'}</Tex>（不量化）[fs]
                </th>
                <th>
                  nearest 的 <Tex>{'\\hat c'}</Tex>
                </th>
                <th>
                  <Tex>{'\\tau(\\hat c)'}</Tex> [fs]
                </th>
                <th>
                  truncate 的 <Tex>{'\\hat c'}</Tex>
                </th>
                <th>
                  <Tex>{'\\tau(\\hat c)'}</Tex> [fs]
                </th>
                <th>飽和？</th>
              </tr>
            </thead>
            <tbody>
              {dtc.rows.map((r) => (
                <tr key={r.c}>
                  <td>{r.c}</td>
                  <td>{fx(r.ideal, 2)}</td>
                  <td>{r.qn}</td>
                  <td>{fx(r.delayN, 2)}</td>
                  <td>{r.qt}</td>
                  <td>{fx(r.delayT, 2)}</td>
                  <td>{r.sat ? '是（rail）' : '否'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small">
          注意 10.5：round-half-up 進位到 11、truncate 留在 10，兩者差一整個 code，延遲差 <Tex>{`\\tau(11)-\\tau(10)=${sig(dtc.step1011, 5)}\\,\\mathrm{fs}`}</Tex>（比 <Tex>{'g_\\mathrm{DTC}=250\\,\\mathrm{fs}'}</Tex> 多出的部分來自 <Tex>{'c_2'}</Tex>）；<Tex>{'-3'}</Tex> 與 70.2 被夾到 rail，之後 LMS 再怎麼推也不會動（§9 第 8 項 anti-windup）。<Tex>{'c_2'}</Tex> 造成的 endpoint-fit INL
          最大 <Tex>{`${sig(dtc.inl.maxAbsInlLsb, 4)}\\,\\mathrm{LSB}`}</Tex>（<code>dtcInlDnl</code> 計算）——這種非線性會讓 LMS 的固定點偏離「平均 gain」（<ChLink to="/ch/11">Ch11</ChLink>）。
        </p>
        <HandCalcSlot id="HC-MD.2">
          換一個 code、換成你的 DTC 增益與位元數，親手做一次「量化 → 飽和 → 套 mapping」；範例數字就是上表 <Tex>{'c=10.5'}</Tex> 那一列。
        </HandCalcSlot>
        <CodeBlock source={dtcSrc} region="dtcQuantize" path="src/simulation/models/dtc.ts" title="core:dtcQuantize" />
        <CodeBlock source={dtcSrc} region="dtcMapping" path="src/simulation/models/dtc.ts" title="core:dtcMapping" />
        <ModeGate min="engineer">
          <Callout kind="info" title="正規化 code 與實體 code 的關係">
            blockLms 在<strong>正規化</strong> code <Tex>{'x'}</Tex>（無因次）上工作，gain 單位是 fs per unit code；DTC 的實體 code 則是整數 LSB。兩者以 <code>gain_register.lsb_fs</code>
            （E13 建議的 gain_lsb_fs）換算：實體 gain code <Tex>{'=\\mathrm{round}(w/\\Delta_\\mathrm{LSB})'}</Tex>。不寫明這個換算，§13 的「6-bit 量化」就無法接到 §12 的 0.399 fs <ErratumNote id="E13" />。
          </Callout>
        </ModeGate>
      </Section>
    </section>
  )
}
