import { useCallback, useDeferredValue, useMemo, useState } from 'react'
import type { Data } from 'plotly.js-cartesian-dist-min'
import {
  Callout,
  ClaimTag,
  CodeBlock,
  ExperimentShell,
  ParamControl,
  Plot,
  Prereq,
  Section,
  SelectControl,
  SourceTag,
  StepDerivation,
  Tex,
  TexBlock,
  useThemeTokens,
  type MetricRow,
  ChRef,
} from '@/components'
import type { DsmKind } from '@/simulation/models/dsm'
import residueSrc from '../residue.ts?raw'
import { firstOrderAccumulator, residueSignals } from '../residue'
import { GAIN_ERROR_MODEL, RESIDUE_ACCUMULATOR } from '../diagrams'
import { DerivationFold, Erratum, f, FigRef, HandCalcBox, KpiRow, MermaidFig, tx, mt } from '../common'
import { texifyModelText } from '../modelText'
import { useCasePresets } from '../experiments/presetHooks'

const R = String.raw

/** 手算表的例子（illustrative 輸入；表內數字全部由 firstOrderAccumulator 計算） */
const HAND = { KF: 5, bits: 4, rows: 16 }
/** 規格 §15.3 的 output_frequency_hz = 13 GHz */
const FVCO_GHZ = 13

interface ResidueParams {
  kind: DsmKind
  frac: number
  bits: number
  length: number
  gainErrPct: number
  fvcoGHz: number
}

/**
 * 上下兩個子圖共用同一條 x 軸：x 軸要錨定在「下面那個」y 軸（y2），刻度與軸標題才會出現在整張圖的最底下；
 * 預設錨在上面的 y 軸，軸標題會落在兩個子圖中間、壓到下面子圖的曲線。
 */
const RESIDUE_LAYOUT = {
  xaxis: { title: { text: R`$n$（reference cycle）` }, anchor: 'y2' as const },
  yaxis: { title: { text: R`$y[n]$` }, domain: [0.78, 1], anchor: 'x' as const },
  yaxis2: { title: { text: 'fs' }, domain: [0, 0.68], anchor: 'x' as const },
}
const RESID_LAYOUT = { xaxis: { title: { text: R`$n$` } }, yaxis: { title: { text: 'fs' } } }

export const RESIDUE_ID = 'gmac-residue'
export const DEFAULT_RESIDUE: ResidueParams = { kind: 'first_order', frac: 0.3125, bits: 4, length: 64, gainErrPct: 1, fvcoGHz: FVCO_GHZ }

function ResidueExplorer() {
  const [p, setP] = useState<ResidueParams>(DEFAULT_RESIDUE)
  const applyShared = useCallback((v: Record<string, unknown>) => setP({ ...DEFAULT_RESIDUE, ...(v as Partial<ResidueParams>) }), [])
  const { presets, load } = useCasePresets<never>({ experiment: RESIDUE_ID, applyShared })
  const dp = useDeferredValue(p)
  const tokens = useThemeTokens()
  const { sig, error } = useMemo(() => {
    try {
      return { sig: residueSignals(dp), error: null as string | null }
    } catch (e) {
      return { sig: null, error: (e as Error).message }
    }
  }, [dp])
  // 交叉比對：本頁的 firstOrderAccumulator（手算表用）vs dsm.ts runDsm
  const check = useMemo(() => {
    if (!sig || dp.kind !== 'first_order') return null
    const rows = firstOrderAccumulator(sig.K, dp.bits, dp.length)
    let maxDiff = 0
    let maxTele = 0
    rows.forEach((r, i) => {
      maxDiff = Math.max(maxDiff, Math.abs(r.residue * sig.tvcoFs - sig.edgeErrFs[i]), Math.abs(r.y - sig.y[i]) * sig.tvcoFs)
      maxTele = Math.max(maxTele, Math.abs(r.cumErr - r.residue))
    })
    return { maxDiff, maxTele }
  }, [sig, dp])

  const warnings: string[] = []
  if (error) warnings.push(`參數錯誤：${error}`)
  if (sig) warnings.push(...sig.warnings.map(texifyModelText))
  if (sig && Math.abs(sig.fracEff - dp.frac) > 1e-12)
    warnings.push(R`$\mathrm{frac}=${tx(dp.frac, 8)}$ 無法以 ${dp.bits}-bit 精確表示，實際平均為 $K_\mathrm{F}/M=${sig.K}/${sig.M}=${tx(sig.fracEff, 6)}$（FCW 量化誤差 → 平均頻率偏移）`)
  if (sig && sig.K === 0) warnings.push(R`$K_\mathrm{F}=0$：整數 FCW，累加器永遠不溢位、residue $r[n]\equiv0$ —— DTC 沒有東西要補償，GMAC 也缺乏激勵（Persistent Excitation，Ch09）`)

  const maxResid = sig ? sig.residualFs.reduce((a, v) => Math.max(a, Math.abs(v)), 0) : NaN
  const metrics: MetricRow[] = sig
    ? [
        { name: R`$K_\mathrm{F}/M$`, value: `${sig.K} / ${sig.M}`, note: 'FCW 小數字量化結果' },
        { name: R`$\mathrm{frac}_\mathrm{eff}=K_\mathrm{F}/M$`, value: sig.fracEff, digits: 8, formulaId: 'F-04.1' },
        { name: R`$T_\mathrm{vco}$`, value: sig.tvcoFs, unit: 'fs', digits: 6 },
        { name: 'residue 週期', value: sig.period > 0 ? sig.period : '未偵測到（> length/2）', unit: 'cycles' },
        { name: R`$r[n]$ 範圍`, value: `[${f(sig.residueRange[0])}, ${f(sig.residueRange[1])}]`, unit: R`$T_\mathrm{vco}$`, claim: 'exact' },
        { name: R`$\max|e_\mathrm{det}|$（PD 殘差）`, value: maxResid, unit: 'fs', formulaId: 'F-04.2', note: R`DTC gain 相對誤差 $\varepsilon$ 時 $=|\varepsilon|\cdot\max|\tau_\mathrm{need}|$` },
      ]
    : []

  const data = useMemo<Data[]>(
    () =>
      sig
        ? [
            { x: sig.n, y: sig.y, name: R`$y[n]$（carry）`, mode: 'lines', line: { shape: 'hv', color: tokens.series[0] }, yaxis: 'y' },
            { x: sig.n, y: sig.edgeErrFs, name: R`feedback（divider）edge 誤差 $r[n]\,T_\mathrm{vco}$`, mode: 'lines+markers', marker: { size: 4 }, line: { color: tokens.series[1] }, yaxis: 'y2' },
            { x: sig.n, y: sig.dtcNeedFs, name: R`DTC 需要的補償量 $\tau_\mathrm{need}$`, mode: 'lines', line: { dash: 'dot', color: tokens.series[2] }, yaxis: 'y2' },
          ]
        : [],
    [sig, tokens],
  )
  const residData = useMemo<Data[]>(
    () => (sig ? [{ x: sig.n, y: sig.residualFs, name: 'PD 殘差', mode: 'lines+markers', marker: { size: 4 }, line: { color: tokens.series[3] } }] : []),
    [sig, tokens],
  )

  return (
    <ExperimentShell
      id={RESIDUE_ID}
      source="simulation"
      title="Fractional residue explorer：DSM → DTC 要補償什麼"
      level="L2"
      claim="exact"
      description={
        <>
          由 <code>dsm.ts</code> 產生 carry <Tex>y[n]</Tex> 與 residue <Tex>r[n]</Tex>，換算成 fs：feedback（divider）edge 早到多少，reference 端的 DTC 就需要補償多少（<Tex>{R`\tau_\mathrm{need}`}</Tex>）。再假設 DTC gain 有相對誤差 <Tex>{R`\varepsilon`}</Tex>，看 PD 會看到多大的殘差 <Tex>{R`(a-w)x[n]`}</Tex>。
        </>
      }
      assumptions={[
        R`一個 reference cycle 對應一個 comparator sample（$f_s=f_\mathrm{ref}$）`,
        R`累加器初值 $s[-1]=0$、無 dither；$r[n]>0$ 表示 feedback（divider）edge 晚到`,
        R`DTC 在 reference 輸入端、線性：延遲 $\tau_\mathrm{DTC}=T_0-w\,x[n]$，實際的補償量 $w\,x[n]=(1-\varepsilon)\,\tau_\mathrm{need}[n]$；INL / offset 不計（Ch11）`,
        R`$T_\mathrm{vco}=1/f_\mathrm{vco}$；MASH 1-1-1 的 residue 為 $-(1-z^{-1})^2s_3/M$，$\tau_\mathrm{need}$ 可正可負，需要 DTC offset（基準延遲 $T_0$ 兩邊都要留範圍）`,
      ]}
      params={{ ...p }}
      units={{ frac: '—', bits: 'bits', length: 'cycles', gainErrPct: '%', fvcoGHz: 'GHz' }}
      warnings={warnings}
      metrics={metrics}
      crossCheck={{
        analytic:
          check === null
            ? { status: 'n/a', note: 'MASH 1-1-1 沒有本頁手算版本；只顯示 dsm.ts 結果' }
            : {
                status: check.maxDiff < 1e-6 && check.maxTele < 1e-12 ? 'ok' : 'mismatch',
                note: `本頁 firstOrderAccumulator vs dsm.ts：max 差 ${f(check.maxDiff, 3)} fs；telescoping 恆等式誤差 ${f(check.maxTele, 3)}`,
              },
        monteCarlo: { status: 'n/a', note: '確定性序列（無 dither）' },
        fixedPoint: { status: 'n/a', note: 'DSM 本身即整數運算（dsm.ts 以整數累加，無浮點漂移）' },
      }}
      actions={{ onReset: () => setP(DEFAULT_RESIDUE) }}
      presets={presets}
      onLoadPreset={(pr) => load(pr.params)}
      exportData={(): Record<string, ArrayLike<number>> => (sig ? { n: sig.n, y: sig.y, edge_err_fs: sig.edgeErrFs, dtc_need_fs: sig.dtcNeedFs, residual_fs: sig.residualFs } : {})}
      controls={
        <>
          <SelectControl
            label="DSM 架構"
            value={p.kind}
            onChange={(kind) => setP({ ...p, kind })}
            options={[
              { value: 'first_order', label: '一階累加器' },
              { value: 'mash111', label: 'MASH 1-1-1' },
            ]}
            reg="REG_DSM_MODE"
          />
          <ParamControl label={mt(R`$\mathrm{frac}$（FCW 小數）`)} ariaLabel="frac（FCW 小數）" value={p.frac} onChange={(frac) => setP({ ...p, frac })} min={0} max={0.999999} step={0.0001} reg="REG_FCW_FRAC" hint={mt(R`會被量化成 $K_\mathrm{F}/2^{B_\mathrm{dsm}}$`)} />
          <ParamControl label={mt(R`$B_\mathrm{dsm}$（累加器位元）`)} ariaLabel="B_dsm（累加器位元）" value={p.bits} onChange={(bits) => setP({ ...p, bits })} min={2} max={24} integer clampOnBlur unit="bits" reg="DSM_ACC_WIDTH" />
          <ParamControl label="長度" value={p.length} onChange={(length) => setP({ ...p, length })} min={8} max={4096} integer clampOnBlur unit="cycles" reg="behavioral: sequence length" />
          <ParamControl label={mt(R`DTC gain 相對誤差 $\varepsilon$`)} ariaLabel="DTC gain 相對誤差 ε" value={p.gainErrPct} onChange={(gainErrPct) => setP({ ...p, gainErrPct })} min={-20} max={20} step={0.01} unit="%" reg="behavioral: (a − w)/a" />
          <ParamControl label={mt(R`$f_\mathrm{vco}$`)} ariaLabel="f_vco" value={p.fvcoGHz} onChange={(fvcoGHz) => setP({ ...p, fvcoGHz })} min={0.1} max={100} step={0.01} unit="GHz" reg="behavioral: output_frequency_hz" />
        </>
      }
    >
      <Plot title={R`carry $y[n]$、feedback edge 誤差與 DTC 需要的補償量`} data={data} layout={RESIDUE_LAYOUT} height={420} csvName="ch04-residue" />
      <Plot
        title={R`DTC gain 誤差 $\varepsilon$ 時 PD 看到的殘差 $(a-w)\,x[n]$`}
        data={residData}
        layout={RESID_LAYOUT}
        height={240}
        csvName="ch04-residual"
        caption={mt(R`這條曲線就是 LMS 的「訊號」：它和 code $x[n]$ 成正比，比例係數 $a-w$ 正是要校正的 gain 誤差。`)}
      />
    </ExperimentShell>
  )
}

export function ResidueSection() {
  const rows = useMemo(() => firstOrderAccumulator(HAND.KF, HAND.bits, HAND.rows), [])
  const M = 2 ** HAND.bits
  const frac = HAND.KF / M
  const tvco = 1e6 / FVCO_GHZ
  const exMax = useMemo(() => {
    const ex = residueSignals({ kind: 'first_order', frac, bits: HAND.bits, length: 64, gainErrPct: 1, fvcoGHz: FVCO_GHZ })
    return ex.residualFs.reduce((a, v) => Math.max(a, Math.abs(v)), 0)
  }, [frac])
  return (
    <Section kind="formula" title="§2 Fractional residue：DTC 到底要補償什麼？" level={2} id="ch04-residue">
      <p>
        <strong>一個問題：</strong>divider 只能數整數個 VCO 週期，但我們要它平均除 <Tex>{R`N_\mathrm{int}+\mathrm{frac}`}</Tex>（<Tex>{R`N_\mathrm{int}`}</Tex> 是 FCW 的整數部分，
        <Tex>{R`\mathrm{frac}\in[0,1)`}</Tex> 是小數部分）。DSM 的做法是「這一拍除 <Tex>{R`N_\mathrm{int}`}</Tex>，下一拍除 <Tex>{R`N_\mathrm{int}+1`}</Tex>」輪流切換，讓平均剛好對。代價是：每一拍 divider 送回 PD 的 edge（feedback edge）都比理想時刻早一點或晚一點。這個時間誤差是<strong>確定的、可以算出來的</strong>——它就在 DSM 累加器裡。DTC 的工作就是把它補掉：DTC 在 reference 的輸入端，把 reference edge 也挪動同樣的量，PD 看到的兩條 edge 就重新對齊。
      </p>

      <h3>先看方塊圖：一階累加器就是 residue generator</h3>
      <p>
        最簡單的 DSM 只有一個加法器和一個暫存器。小數 <Tex>{R`\mathrm{frac}`}</Tex> 先寫成整數：<Tex>{R`\mathrm{frac}=K_\mathrm{F}/M`}</Tex>，其中 <Tex>{R`M=2^{B_\mathrm{dsm}}`}</Tex> 是{' '}
        <Tex>{R`B_\mathrm{dsm}`}</Tex>-bit 累加器的模數（數到 <Tex>M</Tex> 就溢位），<Tex>{R`K_\mathrm{F}`}</Tex> 是每一拍加進去的整數（FCW 小數字）。
      </p>
      <MermaidFig
        chart={RESIDUE_ACCUMULATOR}
        caption={R`一階累加器（藍色的加法點、溢位判斷、暫存器）＝ fractional residue generator。看溢位判斷的兩個輸出：carry $y[n]$ 去控制 divider，餘數 $s[n]$ 一邊存回暫存器、一邊除以 $M$ 變成 DTC 的 code $x[n]$。再看最下面兩條 edge 在 PD 相遇：divider 的 feedback edge 直接進 PD；DTC 在 reference 那一側，從基準延遲 $T_0$ 少延遲一點，把 reference edge 也提前同樣的量。`}
        ariaLabel="一階 DSM 累加器：加法器、暫存器、carry 到 divider、餘數到 DTC code；reference clock 經過 DTC 之後，和 divider 的 feedback edge 在 PD 相遇"
      />
      <p>
        <strong>先看</strong>最上面的加法點：每個 reference cycle（索引 <Tex>n</Tex>）把暫存器裡上一拍的內容 <Tex>{R`s[n-1]`}</Tex> 加上 <Tex>{R`K_\mathrm{F}`}</Tex>，得到 <Tex>{R`t[n]`}</Tex>。
        <strong>再看</strong>中間的溢位判斷：<Tex>{R`t[n]\ge M`}</Tex> 就輸出進位 <Tex>{R`y[n]=1`}</Tex>（divider 這一拍多除一個 VCO 週期）並減掉 <Tex>M</Tex>；留下的餘數 <Tex>{R`s[n]`}</Tex> 存回暫存器（圖上的{' '}
        <Tex>{R`z^{-1}`}</Tex> 就是「延遲一拍」）。<strong>最後看</strong>下半部，兩條 edge 在 PD 相遇：divider 送回來的 feedback edge 比理想時刻早到 <Tex>{R`s[n]/M`}</Tex> 個 VCO 週期（一個 VCO 週期是 <Tex>{R`T_\mathrm{vco}=1/f_\mathrm{vco}`}</Tex>），它直接進 PD，不經過 DTC。要讓兩條 edge 對齊，reference edge 也要提前同樣多，所以把同一個 <Tex>{R`s[n]`}</Tex> 除以 <Tex>M</Tex> 當成 code <Tex>{R`x[n]`}</Tex>，交給 reference 路徑上的 DTC。
      </p>
      <p>
        DTC 只能延遲、不能提前，怎麼「提前」？做法是先給它一個固定的基準延遲 <Tex>{R`T_0`}</Tex>，再依 code <strong>少延遲</strong>一點：<Tex>{R`\tau_\mathrm{DTC}[n]=T_0-x[n]\,T_\mathrm{vco}`}</Tex>（code 越大，延遲越短）。少延遲的這一段就是 reference edge 被提前的時間，叫做 DTC 的<strong>補償量</strong>。PD 量的是「DTC 延遲後的 reference edge」減「feedback edge」的時間差 <Tex>{R`t_\mathrm{ref}'-t_\mathrm{fb}`}</Tex>；<Tex>{R`T_0`}</Tex> 是常數，PLL 把它當成靜態相位偏移吸收掉，所以 PD 看到的只剩兩個「提前量」的差——補償量剛好等於 feedback edge 早到的時間時，差是 0。
      </p>
      <p className="small">
        圖和公式的對應：加法點輸出線上的 <Tex>{R`t[n]=s[n-1]+K_\mathrm{F}`}</Tex> 是下面推導的第 1 步；溢位判斷方塊裡的三行是第 2 步；divider 到 PD 那條線上的{' '}
        <Tex>{R`r[n]=-s[n]/M`}</Tex> 就是 F-04.1 的 residue（feedback edge 的累積時間誤差，單位 <Tex>{R`T_\mathrm{vco}`}</Tex>，負值 = 早到）；DTC 方塊裡的{' '}
        <Tex>{R`\tau_\mathrm{DTC}[n]=T_0-x[n]\,T_\mathrm{vco}`}</Tex> 是 F-04.2 在 gain 剛好正確（<Tex>{R`w=a=T_\mathrm{vco}`}</Tex>）時的樣子，其中 <Tex>{R`x[n]\,T_\mathrm{vco}`}</Tex> 就是需要的補償量 <Tex>{R`\tau_\mathrm{need}[n]`}</Tex>。
      </p>

      <h3>先算一次（手算表）</h3>
      <p>
        取 4-bit 累加器 <Tex>{R`M=2^4=16`}</Tex>，FCW 小數字 <Tex>{R`K_\mathrm{F}=${HAND.KF}`}</Tex>，所以 <Tex>{R`\mathrm{frac}=${HAND.KF}/16=${frac}`}</Tex>{' '}
        <SourceTag kind="illustrative" />。每一拍：先加 <Tex>{R`K_\mathrm{F}`}</Tex>，滿 16 就進位（carry <Tex>{R`y=1`}</Tex>）並減 16。表格由左到右就是 <FigRef chart={RESIDUE_ACCUMULATOR} /> 由上到下的訊號：暫存器輸出 <Tex>{R`s[n-1]`}</Tex> → 加法點輸出 <Tex>{R`t`}</Tex> → carry <Tex>{R`y[n]`}</Tex> → 餘數 <Tex>{R`s[n]`}</Tex>。
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <Tex>n</Tex>
              </th>
              <th>
                <Tex>{R`s[n-1]`}</Tex>
              </th>
              <th>
                <Tex>{R`t=s[n-1]+K_\mathrm{F}`}</Tex>
              </th>
              <th>
                <Tex>{R`y[n]`}</Tex>
              </th>
              <th>
                <Tex>{R`s[n]`}</Tex>
              </th>
              <th>
                <Tex>{R`\sum_{m\le n}(y[m]-\mathrm{frac})`}</Tex>
              </th>
              <th>
                <Tex>{R`-s[n]/M`}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.n}>
                <td className="num">{r.n}</td>
                <td className="num">{r.sPrev}</td>
                <td className="num">{r.t}</td>
                <td className="num">{r.y}</td>
                <td className="num">{r.s}</td>
                <td className="num">{f(r.cumErr, 6)}</td>
                <td className="num">{f(r.residue, 6)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        表格由下方 <code>firstOrderAccumulator</code> 實際計算。注意最後兩欄<strong>每一列都相等</strong>：逐拍累加的時間誤差，恰好等於 <Tex>{R`-s[n]/M`}</Tex>（累加器內容除以 <Tex>M</Tex> 再加負號）。16 拍之後 <Tex>{R`s`}</Tex> 回到 0，序列以週期 <Tex>{R`M/\gcd(K_\mathrm{F},M)=16`}</Tex> 重複；16 拍中有 {rows.filter((r) => r.y === 1).length} 次 carry，平均 <Tex>{R`${rows.filter((r) => r.y === 1).length}/16=${frac}=\mathrm{frac}`}</Tex>。
      </p>
      <CodeBlock source={residueSrc} region="firstOrderAccumulator" path="src/chapters/ch04/residue.ts" caption="手算表與交叉比對用的一階累加器（與 dsm.ts 逐點比對，見 residue.test.ts）" />

      <DerivationFold title="為什麼最後兩欄相等？一步一步推導 telescoping">
        <StepDerivation
          steps={[
            { tex: R`t[n]=s[n-1]+K_\mathrm{F}`, why: '累加器每個 reference cycle 加入一次 FCW 小數字。' },
            { tex: R`y[n]=\begin{cases}1,&t[n]\ge M\\0,&t[n]<M\end{cases},\qquad s[n]=t[n]-M\,y[n]`, why: mt(R`溢位就輸出 carry 並減掉 $M$，留下的餘數存回累加器。`) },
            { tex: R`M\,y[n]=t[n]-s[n]=K_\mathrm{F}-\bigl(s[n]-s[n-1]\bigr)`, why: mt(R`把第 1 式代入第 2 式的 $s[n]=t[n]-M\,y[n]$，移項。`) },
            { tex: R`y[n]-\mathrm{frac}=-\frac{s[n]-s[n-1]}{M}`, why: mt(R`兩邊除以 $M$，並用 $\mathrm{frac}=K_\mathrm{F}/M$。`) },
            { tex: R`\sum_{m=0}^{n}\bigl(y[m]-\mathrm{frac}\bigr)=-\frac{1}{M}\sum_{m=0}^{n}\bigl(s[m]-s[m-1]\bigr)`, why: mt(R`把第 0 拍到第 $n$ 拍全部加起來（等號兩邊各自相加）。`) },
            { tex: R`=-\frac{s[n]-s[-1]}{M}`, why: mt(R`右邊是 telescoping sum：相鄰項 $+s[m]$ 與 $-s[m]$ 互相抵消，只剩頭尾。`) },
            { tex: R`r[n]:=T_\mathrm{vco}^{-1}\cdot t_\mathrm{err}[n]=\sum_{m=0}^{n}\bigl(y[m]-\mathrm{frac}\bigr)`, why: mt(R`每一拍 divider 實際數了 $N_\mathrm{int}+y[m]$ 個 VCO 週期、理想是 $N_\mathrm{int}+\mathrm{frac}$；多數的部分逐拍累積成 feedback edge 的時間誤差（單位 $T_\mathrm{vco}$，正 = 晚到）。`) },
            { tex: R`s[-1]=0\;\Rightarrow\;r[n]=-\frac{s[n]}{M}\in(-1,\,0]`, why: mt(R`零初值時，feedback（divider）edge 永遠早到 $s[n]/M$ 個 VCO 週期，而且有界（$0\le s<M$）。`) },
          ]}
          result={R`\tau_\mathrm{need}[n]=-r[n]\,T_\mathrm{vco}=\frac{s[n]}{M}\,T_\mathrm{vco}\in[0,\,T_\mathrm{vco})`}
        />
        <p className="small">
          <ClaimTag kind="exact" /> 在「一階累加器、無 dither、<Tex>{R`f_s=f_\mathrm{ref}`}</Tex>」的指定模型下這是恆等式，不是近似。結果的 <Tex>{R`\tau_\mathrm{need}[n]`}</Tex> 是<strong>需要的補償量</strong>：feedback edge 早到多少，reference edge 就要提前多少（reference 端的 DTC 從基準延遲 <Tex>{R`T_0`}</Tex> 少延遲這麼多）。
        </p>
      </DerivationFold>

      <TexBlock id="F-04.1" label="feedback（divider）edge 的累積時間誤差（fractional residue）">
        {R`\boxed{r[n]=\sum_{m=0}^{n}\bigl(y[m]-\mathrm{frac}\bigr)=-\frac{s[n]-s[-1]}{M}}\quad[T_\mathrm{vco}]`}
      </TexBlock>

      <Prereq title={R`Z transform 與 $z^{-1}$：只是「延遲一拍」的記號`}>
        <p>
          把序列 <Tex>{R`s[n]`}</Tex> 寫成 <Tex>{R`S(z)=\sum_n s[n]z^{-n}`}</Tex>，則「延遲一拍」<Tex>{R`s[n-1]`}</Tex> 對應 <Tex>{R`z^{-1}S(z)`}</Tex>（把求和的 index
          平移一格即可證明）。所以第 4 步可以寫成
        </p>
        <TexBlock>{R`y[n]-\mathrm{frac}=-\frac{1}{M}\bigl(1-z^{-1}\bigr)\,s[n]\quad(z^{-1}\text{ 作用在序列上 = 延遲一拍})`}</TexBlock>
        <p>
          這就是一階 DSM 的 noise transfer function <Tex>{R`(1-z^{-1})`}</Tex>：量化誤差被一階差分「推到高頻」。離散時間頻率 <Tex>{R`\Omega`}</Tex> 是每個 sample
          前進的相位（rad/sample，<Tex>{R`\Omega=2\pi f/f_\mathrm{ref}`}</Tex>）；正弦序列 <Tex>{R`e^{j\Omega n}`}</Tex> 延遲一拍等於乘上 <Tex>{R`e^{-j\Omega}`}</Tex>，所以把{' '}
          <Tex>{R`z=e^{j\Omega}`}</Tex> 代入，
          <Tex>{R`|1-e^{-j\Omega}|=2|\sin(\Omega/2)|`}</Tex>，低頻趨近 0（每 decade +20 dB）。residue <Tex>r</Tex> 是 <Tex>{R`y-\mathrm{frac}`}</Tex> 的累加（乘上 <Tex>{R`1/(1-z^{-1})`}</Tex>），剛好把差分抵消，所以 <Tex>{R`r=-s/M`}</Tex>：residue 本身<strong>沒有</strong>被 noise shaping，它就是累加器內容。MASH 1-1-1 則是 <Tex>{R`r=-(1-z^{-1})^2s_3/M`}</Tex>，範圍 <Tex>{R`|r|<2`}</Tex>（dsm.ts 檔頭）。
        </p>
      </Prereq>

      <h3>連到 LMS：DTC gain 誤差就是 regressor 的係數</h3>
      <p>
        DTC 把數位 code 變成延遲，而且它在 <strong>reference 的輸入端</strong>。設 code 為 <Tex>{R`x[n]=s[n]/M`}</Tex>（無因次）。feedback（divider）edge 比理想時刻早到 <Tex>{R`a\,x[n]`}</Tex>（理想時{' '}
        <Tex>{R`a=T_\mathrm{vco}`}</Tex>，單位 fs per unit code <Erratum id="E13" />），所以真正需要的補償量是 <Tex>{R`a\,x[n]`}</Tex>。DTC 實際用的 gain 是 <Tex>w</Tex>，它從基準延遲 <Tex>{R`T_0`}</Tex> 往回扣的是 <Tex>{R`w\,x[n]`}</Tex>：
      </p>
      <TexBlock>{R`\tau_\mathrm{DTC}[n]=T_0-w\,x[n]`}</TexBlock>
      <p>
        code 越大，延遲越短；數位端實際送進 DTC 的 code 是 <Tex>{R`C_0-w\,x[n]`}</Tex>（<Tex>{R`C_0`}</Tex> 是固定的中心值，等於把 code 取補數）。<Tex>{R`w\,x[n]`}</Tex> 就是 DTC 的<strong>補償量</strong>：reference edge 被提前（也就是少延遲）的時間。
        <Tex>{R`T_0`}</Tex> 是常數，PLL 把它當成靜態相位偏移吸收掉，不影響任何會動的量。把它拿掉之後，以同一個理想時刻 <Tex>{R`t_\mathrm{id}[n]`}</Tex> 當基準，寫出兩條 edge 到達 PD 的時刻：第一行是 reference edge（被 DTC 提前 <Tex>{R`w\,x[n]`}</Tex>），第二行是 feedback edge（早到 <Tex>{R`a\,x[n]`}</Tex>）。PD 量的是「DTC 延遲後的 reference edge」減「feedback edge」，也就是第三行：
      </p>
      {/* 三行只放式子、說明寫在上面的文字裡：式子旁邊再加中文註解的話，手機（375 px）上這一塊會比欄寬多出兩百多 px，平白多一條橫向捲軸 */}
      <TexBlock>{R`\begin{aligned}t_\mathrm{ref}'[n]&=t_\mathrm{id}[n]-w\,x[n]\\t_\mathrm{fb}[n]&=t_\mathrm{id}[n]-a\,x[n]\\t_\mathrm{ref}'[n]-t_\mathrm{fb}[n]&=(a-w)\,x[n]\end{aligned}`}</TexBlock>
      <p>
        補償不足（<Tex>{R`w<a`}</Tex>）時 reference edge 還是太晚，誤差為正；這和規格 §6 的 <Tex>{R`e_\mathrm{DTC}=(a-w)x`}</Tex> 一致。
      </p>
      <MermaidFig
        chart={GAIN_ERROR_MODEL}
        caption={R`DTC gain 誤差的數學模型：同一個 code $x[n]$ 走兩條路，一條乘未知的 $a$（需要補的量：feedback edge 早到的時間），一條乘可調的 $w$（藍色，實際補的量：DTC 把 reference edge 提前的時間）；看加法點兩條線的正負號——PD 的輸出只看得到兩者的差 $(a-w)\,x[n]$。`}
        ariaLabel="code 乘 a 減去 code 乘 w，得到 PD 看到的殘差 delta 乘 x"
      />
      <p>
        <strong>先看</strong>最上面：兩條路的輸入是同一個已知的 code <Tex>{R`x[n]`}</Tex>。<strong>再看</strong>加法點：乘 <Tex>a</Tex> 的那條標「<Tex>{R`+`}</Tex>」（feedback edge 早到的時間 <Tex>{R`a\,x[n]`}</Tex>），乘{' '}
        <Tex>w</Tex> 的那條標「<Tex>{R`-`}</Tex>」（DTC 的補償量 <Tex>{R`w\,x[n]`}</Tex>：reference edge 被提前的時間）。PD 量的是 reference edge 減 feedback edge，兩個「提前量」相減剩下 <Tex>{R`(a-w)\,x[n]`}</Tex>；把係數記成 <Tex>{R`\delta=a-w`}</Tex>（<strong>剩餘的 gain 誤差</strong>，全站約定的極性：
        <Tex>{R`\delta>0`}</Tex> 表示 <Tex>w</Tex> 還太小）。圖上加法點的輸出 <Tex>{R`e_\mathrm{det}[n]`}</Tex>（下標 det = deterministic，不含雜訊的確定性殘差）就是下面公式框起來的那一項：
      </p>
      <TexBlock id="F-04.2" label={mt(R`需要的補償量、reference 端 DTC 的延遲與 gain 誤差造成的殘差（$\delta=a-w$）`)}>
        {R`\tau_\mathrm{need}[n]=\frac{s[n]}{M}T_\mathrm{vco},\qquad\tau_\mathrm{DTC}[n]=T_0-w\,x[n],\qquad \boxed{e_\mathrm{det}[n]=(a-w)\,x[n]=\delta\,x[n]}`}
      </TexBlock>
      <p>
        這正是 <ChRef ch="00">Ch00</ChRef>–<ChRef ch="03">Ch03</ChRef> 的 <Tex>{R`y=ax`}</Tex> 黑盒子：<Tex>x</Tex> 已知（DSM 累加器），<Tex>a</Tex> 未知（DTC 的類比 gain 隨 PVT 變）。數字感 <SourceTag kind="illustrative" />：<Tex>{R`f_\mathrm{vco}=${FVCO_GHZ}\,\mathrm{GHz}\Rightarrow T_\mathrm{vco}=${tx(tvco, 6)}\,\mathrm{fs}`}</Tex>；DTC gain 只錯 1%，PD 殘差最大就有 <Tex>{R`${tx(exMax, 4)}\,\mathrm{fs}`}</Tex>（上例 64 拍的最大值），比典型 comparator 雜訊 <Tex>{R`\sigma_v=100\,\mathrm{fs}`}</Tex> 還大。這就是為什麼 DTC gain 必須在背景持續校正。
      </p>
      <KpiRow
        items={[
          { label: <Tex>{R`T_\mathrm{vco}`}</Tex>, value: `${f(tvco, 6)} fs`, note: <Tex>{R`f_\mathrm{vco}=${FVCO_GHZ}\,\mathrm{GHz}`}</Tex> },
          { label: '1% gain 誤差的最大殘差', value: `${f(exMax, 4)} fs`, note: <Tex>{R`=0.01\times\max_n\tau_\mathrm{need}[n]`}</Tex> },
          { label: '需要的補償量範圍', value: <Tex>{R`[0,\,T_\mathrm{vco})`}</Tex>, note: '一階 DSM、零初值' },
        ]}
      />
      <HandCalcBox id="HC-04.1">
        把 <Tex>{R`K_\mathrm{F}`}</Tex>、累加器位元數和 <Tex>{R`f_\mathrm{vco}`}</Tex> 換成你自己那顆 PLL 的數字，先在紙上讓累加器走 5 拍、算出 <Tex>{R`r[4]`}</Tex> 和最大的補償量，再展開下面的步驟對答案（預設值就是上面手算表的 <Tex>{R`K_\mathrm{F}=${HAND.KF},\;M=${M}`}</Tex>）。
      </HandCalcBox>
      <Callout kind="warn" title="code 的 DC 成分會在後面出問題">
        <Tex>{R`x[n]=s[n]/M\in[0,1)`}</Tex> 的平均約 <Tex>{R`\tfrac12`}</Tex>，<strong>不是零均值</strong>。在 §4 我們會看到：如果 comparator 的 0/1 沒有映射成 <Tex>{R`\pm1`}</Tex>，這個 DC 會直接變成 gain
        偏差；<ChRef ch="11">Ch11</ChRef> 也會看到 comparator offset 與 PLL 的 DC null 如何和它交互作用（勘誤 E03）。實務上常把累加器 MSB 反相，得到以 0 為中心的有號 code。
      </Callout>
      <ResidueExplorer />
    </Section>
  )
}
