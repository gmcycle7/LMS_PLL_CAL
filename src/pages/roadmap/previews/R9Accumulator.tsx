import { useDeferredValue, useMemo, useState } from 'react'
import type { Data, Layout } from 'plotly.js-cartesian-dist-min'
import {
  ClaimTag,
  CodeCompare,
  ExperimentShell,
  HandCalc,
  ModeGate,
  ParamControl,
  Plot,
  Prereq,
  StepDerivation,
  Tex,
  TexBlock,
  ToggleControl,
  useThemeTokens,
  type ExperimentPreset,
  type MetricRow,
  ChRef,
} from '@/components'
import modelSrc from '../model.ts?raw'
import { roadmapHandCalc } from '../handcalcs'
import { accumulatorBits, saturateTwos, worstCaseAccumulate, worstCaseSafeCount, wrapTwos } from '../model'
import { ErratumNote, mergeParams, mt, Observe, PageRef, pl, TryIt, useRoadmapPresets } from '../common'

const EXP_ID = 'roadmap-r9-accumulator'
const PATH = 'src/pages/roadmap/model.ts'

interface R9Params {
  codeBits: number
  N: number
  accBits: number
  mostNeg: boolean
}

const DEFAULTS: R9Params = { codeBits: 6, N: 4096, accBits: 17, mostNeg: false }

const INLINE_PRESETS: ExperimentPreset[] = [
  { name: '6-bit × 4096、17-bit 累加器（golden negative test）', params: { ...DEFAULTS }, description: '126976 wrap 成 −4096' },
  { name: '6-bit × 4096、18-bit（對稱 code 剛好夠）', params: { ...DEFAULTS, accBits: 18 } },
  { name: '允許最負 code −32、18-bit', params: { ...DEFAULTS, accBits: 18, mostNeg: true }, description: '+32 × 4096 = 2^17 溢位一個 LSB' },
]

/** golden negative test（6-bit 對稱 code、17-bit 累加器）在最壞情況下放得下幾筆：內文引用的數字由 model 計算 */
const GOLDEN_SAFE = worstCaseSafeCount(DEFAULTS.codeBits, DEFAULTS.accBits, DEFAULTS.mostNeg)

// Plot 的 layout 是靜態的：放在模組層，避免每次 render 產生新物件而觸發 Plotly.react
const LAYOUT_ACC: Partial<Layout> = { xaxis: { title: { text: '$n$（已累加筆數）' } }, yaxis: { title: { text: '累加器值 [code LSB]' } } }

function R9Experiment() {
  const [P, setP] = useState<R9Params>(DEFAULTS)
  const tokens = useThemeTokens()
  const presets = useRoadmapPresets(EXP_ID, INLINE_PRESETS, (pr) => setP((prev) => mergeParams(prev, pr)))
  const dP = useDeferredValue(P)
  const codeBits = Math.round(dP.codeBits)
  const N = Math.round(dP.N)
  const accBits = Math.round(dP.accBits)
  const req = accumulatorBits(codeBits, N, dP.mostNeg)
  const wc = worstCaseAccumulate(codeBits, N, accBits, dP.mostNeg)
  const nSafe = worstCaseSafeCount(codeBits, accBits, dP.mostNeg)
  // 交叉比對：逐筆累加找到的第一次溢位，應該就是封閉式的 n_safe + 1（不溢位時兩邊都說「沒有」）
  const overflowOk = wc.firstOverflowAt === (nSafe < N ? nSafe + 1 : null)
  const flipped = Math.sign(wc.wrapped) !== Math.sign(wc.trueSum) && wc.trueSum !== 0

  const series = useMemo(() => {
    const pts = Math.min(N, 1024)
    const step = N / pts
    const n: number[] = []
    const t: number[] = []
    const w: number[] = []
    const s: number[] = []
    for (let i = 0; i <= pts; i++) {
      const k = Math.round(i * step)
      n.push(k)
      t.push(k * req.maxProduct)
      w.push(wrapTwos(k * req.maxProduct, accBits))
      s.push(saturateTwos(k * req.maxProduct, accBits))
    }
    return { n, t, w, s }
  }, [N, req.maxProduct, accBits])
  const traj: Data[] = useMemo(
    () => [
      { x: series.n, y: series.t, name: '真實總和（無限位寬）', mode: 'lines', line: { color: tokens.textMuted, dash: 'dash' } },
      { x: series.n, y: series.w, name: `wrap（${accBits} bits）`, mode: 'lines', line: { color: tokens.series[0] } },
      { x: series.n, y: series.s, name: `saturate（${accBits} bits）`, mode: 'lines', line: { color: tokens.series[1] } },
    ],
    [series, accBits, tokens],
  )

  const warnings: string[] = []
  if (accBits < req.bitsRequired)
    warnings.push(
      String.raw`$W_{\mathrm{acc}}=${accBits}<${req.bitsRequired}$：最壞情況在第 ${wc.firstOverflowAt} 筆溢位。wrap 把 ${wc.trueSum} 變成 ${wc.wrapped}${flipped ? '（符號翻轉，更新方向相反，正好發生在誤差最大的時候）' : ''}；saturate 卡在 ${wc.saturated}（符號保留，但大小錯）。`,
    )
  if (dP.mostNeg)
    warnings.push(
      String.raw`允許最負 code $${-(2 ** (codeBits - 1))}$：$q=-1$ 時 conditional negate 得到 $+${2 ** (codeBits - 1)}$，比正最大值 ${2 ** (codeBits - 1) - 1} 多 1——需要多 1 個累加器 bit，或把 code 範圍限制為對稱。`,
    )

  const metrics: MetricRow[] = [
    { name: String.raw`$\max|q\,x|$`, value: req.maxProduct, unit: 'code LSB', formulaId: 'F-R9.1', claim: 'exact' },
    { name: String.raw`最壞總和 $N\max|q\,x|$`, value: req.maxSum, unit: 'code LSB' },
    { name: String.raw`需要的 signed 位寬 $W_{\mathrm{acc}}$`, value: req.bitsRequired, unit: 'bits', formulaId: 'F-R9.1', claim: 'exact' },
    { name: '目前位寬', value: accBits, unit: 'bits' },
    { name: 'wrap 結果', value: wc.wrapped, unit: 'code LSB', analytic: wrapTwos(wc.trueSum, accBits), tolerance: 0 },
    { name: 'saturate 結果', value: wc.saturated, unit: 'code LSB' },
    { name: String.raw`最壞情況下不溢位最多能累加幾筆 $n_{\mathrm{safe}}=\lfloor(2^{W_{\mathrm{acc}}-1}-1)/\max|q\,x|\rfloor$`, value: nSafe, unit: 'samples', claim: 'exact' },
    {
      name: '第一次溢位在第幾筆（逐筆累加）',
      value: wc.firstOverflowAt ?? '不溢位',
      unit: 'samples',
      analytic: wc.firstOverflowAt !== null ? nSafe + 1 : undefined,
      tolerance: wc.firstOverflowAt !== null ? 0 : undefined,
      note: String.raw`封閉式：$n_{\mathrm{safe}}+1$（$n_{\mathrm{safe}}\ge N$ 時不溢位）`,
    },
  ]

  return (
    <ExperimentShell
      id={EXP_ID}
      title="R9 預覽：GMAC 累加器位寬、wrap 與 saturate（bit-true）"
      level="L5"
      claim="exact"
      description={<>最壞情況：<Tex>{'N'}</Tex> 筆 <Tex>{'q\\cdot x'}</Tex> 全部同號且最大，逐筆以 two’s complement 累加（整數運算）。</>}
      assumptions={[
        String.raw`$q\in\{\pm1\}$（bipolar；勘誤 E07：tie 取 $+1$）、$x$ 為 $W_x$-bit two’s complement`,
        String.raw`conditional negate：$q=-1$ 時取 $-x$`,
        '只看累加器；右移取平均、rounding 見第 4 章',
      ]}
      params={{ codeBits, N, accBits, mostNeg: dP.mostNeg }}
      units={{ codeBits: 'bits', N: 'samples', accBits: 'bits' }}
      metrics={metrics}
      warnings={warnings}
      crossCheck={{
        analytic: {
          status: wc.wrapped === wrapTwos(wc.trueSum, accBits) && overflowOk ? 'ok' : 'mismatch',
          note: String.raw`逐筆 wrap 累加 = 總和一次 wrap（模運算的同態）；第一次溢位的位置 $=n_{\mathrm{safe}}+1$`,
        },
        monteCarlo: { status: 'n/a', note: '確定性計算，沒有隨機量' },
        fixedPoint: { status: 'ok', note: String.raw`整數運算即 bit-true（數值 $\le2^{53}$）` },
      }}
      actions={{ onReset: () => setP(DEFAULTS) }}
      presets={presets}
      onLoadPreset={(pr) => setP((prev) => mergeParams(prev, pr.params))}
      exportData={() => ({ n: series.n, true_sum: series.t, wrap: series.w, saturate: series.s })}
      controls={
        <>
          <ParamControl {...pl('$W_x$（code 位寬）', 'W_x（code 位寬）')} value={P.codeBits} onChange={(v) => setP({ ...P, codeBits: v })} min={2} max={12} integer clampOnBlur unit="bits" reg="REG_GMAC_X 位寬" />
          <ParamControl {...pl('$N$（累加筆數）', 'N（累加筆數）')} value={P.N} onChange={(v) => setP({ ...P, N: v })} min={2} max={65536} log integer clampOnBlur unit="samples" reg="REG_GMAC_N" />
          <ParamControl {...pl(String.raw`$W_{\mathrm{acc}}$（累加器位寬）`, 'W_acc（累加器位寬）')} value={P.accBits} onChange={(v) => setP({ ...P, accBits: v })} min={4} max={40} integer clampOnBlur unit="bits" reg="REG_GMAC_ACC 位寬" />
          <ToggleControl label="code 範圍含最負值（完整 two’s complement）" value={P.mostNeg} onChange={(v) => setP({ ...P, mostNeg: v })} reg="RTL：code range（對稱 / 完整 two’s complement）" />
        </>
      }
    >
      <Plot title="最壞情況的累加軌跡：wrap vs saturate vs 真實" data={traj} layout={LAYOUT_ACC} height={300} csvName="r9-accumulator" />
    </ExperimentShell>
  )
}

export default function R9Preview() {
  return (
    <div className="rm-preview">
      <Prereq title="Two’s complement：W 個 bit 能表示什麼">
        <p>
          {mt('$W$')}-bit two’s complement 的範圍是 <Tex>{'[-2^{W-1},\\ 2^{W-1}-1]'}</Tex>：負的那邊多一個。<Tex>{'-x=\\bar x+1'}</Tex>（各 bit 反相再加一），所以最負值 <Tex>{'-2^{W-1}'}</Tex> 取負後是 <Tex>{'+2^{W-1}'}</Tex>，在同樣的 {mt('$W$')} 個 bit 裡放不下。溢位時硬體只保留低 {mt('$W$')} 個 bit，相當於對 <Tex>{'2^W'}</Tex> 取模（wrap）。 <ChRef ch="04">第 4 章</ChRef> §5 有逐 bit 的例子（<PageRef id="ch04">第 4 章</PageRef>）。
        </p>
      </Prereq>
      <StepDerivation
        title="一步一步推導：累加器需要幾個 bit"
        steps={[
          { tex: String.raw`x\in[-2^{W_x-1},\ 2^{W_x-1}-1],\qquad q\in\{+1,-1\}`, why: 'code 與 comparator 決策（bipolar）。' },
          { tex: String.raw`q=+1:\ qx\in[-2^{W_x-1},\ 2^{W_x-1}-1];\qquad q=-1:\ qx\in[-(2^{W_x-1}-1),\ 2^{W_x-1}]`, why: <>取負把區間翻過來；最負值翻成 <Tex>{'+2^{W_x-1}'}</Tex>。</> },
          { tex: String.raw`\Big|\sum_{n=1}^{N}q_nx_n\Big|\le N\cdot\max|qx|`, why: '三角不等式；所有項同號時取等號（最壞情況：誤差很大、comparator 一直輸出同號）。' },
          { tex: String.raw`N\max|qx|\le2^{W_\mathrm{acc}-1}-1`, why: <>signed 累加器的正上限。</> },
          { tex: String.raw`\text{對稱 code}:\ N(2^{W_x-1}-1)<N\,2^{W_x-1}\Rightarrow W_\mathrm{acc}=W_x+\log_2N\ \text{足夠}`, why: <><Tex>{'N'}</Tex> 為 2 的冪。</> },
          { tex: String.raw`\text{含最負 code}:\ N\,2^{W_x-1}=2^{W_x-1+\log_2N}>2^{W_x-1+\log_2N}-1\Rightarrow W_\mathrm{acc}=W_x+\log_2N+1`, why: '剛好多出 1 個 LSB，就要多 1 個 bit。' },
          { tex: String.raw`\mathrm{wrap}_W(v)=\big((v+2^{W-1})\bmod2^W\big)-2^{W-1}`, why: <>溢位時只剩低 <Tex>{'W'}</Tex> 個 bit。</> },
        ]}
        result={String.raw`W_x=6,\ N=4096:\ \text{對稱 }18\text{ bits；含 }-32\text{ 時 }19\text{ bits}\qquad(\text{F-R9.1})`}
      />
      <p>
        <ClaimTag kind="exact" /> golden negative test：<Tex>{'31\\times4096=126976'}</Tex> 在 17-bit 下 wrap 成 <Tex>{'-4096'}</Tex>——符號翻轉，LMS 往錯的方向更新。
        <ErratumNote eid="E13">{String.raw`$\mu$、$w$、$G$ 的單位與 LSB 換算必須寫清楚，否則位寬無從計算。`}</ErratumNote>
      </p>
      <p>
        什麼時候溢位、溢位後存到什麼，也都能用整數算出來。最壞情況每筆都加 <Tex>{'M=\\max|q\\,x|'}</Tex>，第 <Tex>{'n'}</Tex> 筆後的總和是 <Tex>{'nM'}</Tex>；正上限是 <Tex>{'U=2^{W_\\mathrm{acc}-1}-1'}</Tex>，所以最多放得下 <Tex>{'n_{\\mathrm{safe}}'}</Tex> 筆，第 <Tex>{'n_{\\mathrm{safe}}+1'}</Tex> 筆第一次溢位：
      </p>
      <TexBlock>{String.raw`n_{\mathrm{safe}}=\Big\lfloor\frac{2^{W_\mathrm{acc}-1}-1}{\max|q\,x|}\Big\rfloor,\qquad \mathrm{sat}_W(v)=\min\big(2^{W-1}-1,\ \max(-2^{W-1},\ v)\big)`}</TexBlock>
      <p className="small muted">
        golden negative test 的數字：<Tex>{`n_{\\mathrm{safe}}=\\lfloor65535/31\\rfloor=${GOLDEN_SAFE}`}</Tex>，block 才過一半（第 {GOLDEN_SAFE + 1} 筆）就溢位——wrap 從那一刻起輸出錯的值，saturate 則卡在上限（符號保留、大小錯）。「需要幾個 bit」的手算在 <PageRef id="ch04">第 4 章</PageRef>（HC-04.6）；下面這一題算的是「第幾筆溢位、兩種處理各存到多少」。
      </p>
      <HandCalc def={roadmapHandCalc('HC-RM.9')} />
      <R9Experiment />
      <TryIt
        items={[
          <>預設 17 bits：wrap 的軌跡在溢位那一刻跳到負值；改成 18 bits，三條線重合到最後。</>,
          <>打開「最負 code」：18 bits 又不夠了（差 1 個 LSB）；這是 RTL 常見的漏網之魚。</>,
          <>把 <Tex>{'N'}</Tex> 加倍：需要的位寬多 1。</>,
        ]}
      />
      <Observe>
        bit-true 問題可以完全用整數算術推理；R9 的待辦是把整條 RTL（GMAC、右移、gain register、commit 時序、CDC）做成逐 cycle 可比對的 reference model，再寫 SystemVerilog assertions，並與 AMS 波形對照。
      </Observe>
      <h4>核心程式碼：溢位的兩種處理</h4>
      <CodeCompare
        items={[
          { label: 'wrap', source: modelSrc, region: 'wrap', path: PATH, note: '硬體預設：只保留低位元。' },
          { label: 'saturate', source: modelSrc, region: 'saturate', path: PATH, note: '需要額外的比較器，但符號正確。' },
          { label: '位寬公式', source: modelSrc, region: 'accumulatorBits', path: PATH, note: '最負 code 會多需要 1 bit。' },
        ]}
      />
      <ModeGate min="research">
        <h4>Research：bit-true 之外</h4>
        <ul>
          <li>
            clock-domain crossing 帶來的 commit latency 等效於更新延遲 <Tex>{'d'}</Tex>：<Tex>{'PM_d=90^\\circ-(2d+1)\\arcsin(g/2)'}</Tex>（<PageRef id="ch08">第 8 章</PageRef>）。
          </li>
          <li>SystemVerilog assertion 範例（待寫）：累加器不溢位、{mt(String.raw`$\mathrm{sign}(G)$`)} 與浮點 golden 一致、tie 規則、commit 只在 block 邊界發生。</li>
          <li>AMS / Spectre 對照需要量測的 S 曲線（R6）與 DTC 非線性；Behavioral 模型只能給下限。<ClaimTag kind="research" /></li>
        </ul>
      </ModeGate>
    </div>
  )
}
