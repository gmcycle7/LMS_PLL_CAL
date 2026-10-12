import { useMemo } from 'react'
import type { Data } from 'plotly.js-dist-min'
import {
  Callout,
  ClaimTag,
  Mermaid,
  ModeGate,
  Plot,
  Section,
  StepDerivation,
  Tex,
  useThemeTokens,
} from '@/components'
import {
  STRATEGIES,
  STRATEGY_LABEL,
  lineSpectrum,
  makeCtx,
  makeGrid,
  runQuantLab,
  simulateStrategy,
} from '@/simulation/models/quantizer'
import { DEFAULT_LAB_PARAMS, Fold, fx, ntex, num, tx } from '../common'
import { CHART_ANTIWINDUP, CHART_CDC, CHART_SAT_WRAP } from '../diagrams'

function hamming(a: number, b: number): number {
  let x = (a ^ b) >>> 0
  let c = 0
  while (x) {
    c += x & 1
    x >>>= 1
  }
  return c
}

/** saturate / wrap 示範的更新次數（5 的倍數：63.4 = 317/5 的週期 5 剛好整除，40% 才是精確值）。 */
const WRAP_LEN = 500

/** 63.3 持續 1000 次後跳回 62.0：有 / 無 anti-windup 的恢復。 */
function windupDemo() {
  const grid = makeGrid(63.3, 'fixed', 16)
  const W = new Float64Array(2000)
  for (let i = 0; i < 2000; i++) W[i] = i < 1000 ? grid.W0 : 62 * grid.D
  const run = (aw: boolean) => {
    const ctx = makeCtx({ ...DEFAULT_LAB_PARAMS, antiWindup: aw }, grid, 'deltaSigma', 1)
    const sim = simulateStrategy('deltaSigma', W, ctx, { freezeW: grid.W0, integer: true })
    let stuck = 0
    for (let i = 1000; i < 2000 && sim.y[i] === 63; i++) stuck++
    return { sim, stuck, rPeak: Math.max(...Array.from(sim.r.subarray(0, 1000), Math.abs)) }
  }
  return { off: run(false), on: run(true) }
}

export function NonIdealSection() {
  const tokens = useThemeTokens()
  const wrap = useMemo(() => {
    const go = (overflow: 'wrap' | 'saturate') =>
      runQuantLab({
        params: { ...DEFAULT_LAB_PARAMS, target: 63.4, overflow, length: WRAP_LEN, mixing: false },
        cases: [{ id: 'D', strategy: 'deltaSigma', lmsNoise: false, nUpd: 1 }],
        compareAll: false,
      }).runs[0]
    return { w: go('wrap'), s: go('saturate') }
  }, [])
  const wd = useMemo(windupDemo, [])
  const cdc = useMemo(() => {
    const lab = runQuantLab({ params: { ...DEFAULT_LAB_PARAMS, mixing: false, length: 4096, traceLen: 4096 }, cases: [], compareAll: true, compareScenario: { lmsNoise: true, nUpd: 1 } })
    return lab.compare.map((r) => {
      let trans = 0
      let multi = 0
      let maxH = 0
      for (let i = 1; i < r.trace.y.length; i++) {
        if (r.trace.y[i] === r.trace.y[i - 1]) continue
        trans++
        const h = hamming(r.trace.y[i], r.trace.y[i - 1])
        if (h > 1) multi++
        if (h > maxH) maxH = h
      }
      return { strategy: r.strategy, trans, multi, maxH, rate: r.metrics.toggleRate, fu: r.fu, min: r.metrics.codeMin, max: r.metrics.codeMax }
    })
  }, [])
  const prbsSeeds = useMemo(() => {
    return [1, 2, 3].map((seed) => {
      const grid = makeGrid(32.4, 'rational', 0)
      const ctx = makeCtx({ ...DEFAULT_LAB_PARAMS, randomSource: 'prbs', prbsBits: 7 }, grid, 'stochastic', seed)
      const W = new Float64Array(127).fill(grid.W0)
      const sim = simulateStrategy('stochastic', W, ctx, { freezeW: grid.W0, integer: true })
      const ls = lineSpectrum(Array.from(sim.y, (y) => y - 32.4))
      const top = ls.filter((l) => l.k > 0).sort((a, b) => b.power - a.power)[0]
      return { seed, first: Array.from(sim.y.subarray(0, 12), (y) => y - 32).join(''), topK: top.k, topP: top.power, total: ls.reduce((a, l) => a + l.power, 0) }
    })
  }, [])
  const wdData = useMemo<Data[]>(() => {
    const x = Array.from({ length: 2000 }, (_, i) => i)
    return [
      { x, y: Array.from(wd.off.sim.y), name: '無 anti-windup', line: { shape: 'hv', color: tokens.series[1], width: 1.5 } },
      { x, y: Array.from(wd.on.sim.y), name: '有 anti-windup', line: { shape: 'hv', color: tokens.series[2], width: 1.5, dash: 'dot' } },
    ]
  }, [wd, tokens])

  return (
    <Section kind="assumptions" title="§13.6 工程上必須額外處理的非理想" level={2} id="ch13-nonideal">
      <h3>1. Saturation vs wrap、anti-windup</h3>
      <p>
        <Tex>{'w_H'}</Tex> 靠近或超出 code 範圍 <Tex>{String.raw`[0,\,2^B-1]=[0,63]`}</Tex> 時，量化器算出來的整數放不進 6 個 bit（overflow）。硬體有兩種處理方式：<strong>saturate</strong>（夾在邊界）或 <strong>wrap</strong>（只留低 6 bit，把進位丟掉）。
      </p>
      <Mermaid
        chart={CHART_SAT_WRAP}
        caption="超出 6-bit 範圍時的兩種行為（例：$w^*=63.4$ 的 ΔΣ）。先看紅色的 wrap 分支：64 被繞回 0，gain 瞬間消失；再看綠色的 saturate 分支：code 安全地停在 63，但誤差暫存器 $r$ 會一直累積（windup），需要 anti-windup。"
      />
      <p className="small ch13-figwalk">
        圖上的 <Tex>{String.raw`64\bmod64=0`}</Tex> 就是下一段的「進位被丟掉」；圖上 saturate 分支的 <Tex>{'r[n]=v-63'}</Tex> 來自 ΔΣ 的 <Tex>{'r=v-y'}</Tex>（§13.4），<Tex>{'y'}</Tex> 被夾在 63 之後每一拍多出{' '}
        <Tex>{String.raw`w_H-63`}</Tex>。下面兩段是這兩個分支的模擬數字。
      </p>
      <p>
        <Tex>{'w^*=63.4'}</Tex> 超出 6-bit 範圍時：saturate 讓 code 停在 63（code 範圍 {wrap.s.metrics.codeMin}–{wrap.s.metrics.codeMax}）；wrap（無號數模{' '}
        <Tex>{'2^B'}</Tex> 溢位，硬體把進位丟掉：<Tex>{String.raw`64\bmod64=0`}</Tex>）則讓 code 在 {wrap.w.metrics.codeMax} 與 {wrap.w.metrics.codeMin} 之間跳：{WRAP_LEN} 次更新中有{' '}
        {wrap.w.metrics.overflow} 次（{fx((100 * wrap.w.metrics.overflow) / WRAP_LEN, 1)}%，理論上是小數部分 <Tex>{String.raw`\mathrm{frac}(63.4)=40\%`}</Tex>）量化結果為 64 而被繞回 0，平均 code 只剩{' '}
        {fx(wrap.w.metrics.meanCode, 2)}（<Tex>{String.raw`\approx0.6\times63=37.8`}</Tex>）——gain 瞬間崩到 0，相當於 DTC 校正整個消失。 <ClaimTag kind="exact" />
      </p>
      <p>
        saturate 的 ΔΣ 在 overload 時還有第二個問題：<Tex>{String.raw`r`}</Tex> 會一直累積（windup）。飽和時 <Tex>{'y=63'}</Tex>，所以{' '}
        <Tex>{String.raw`r[n]=r[n-1]+(63.3-63)=r[n-1]+0.3`}</Tex>，每次多 0.3 LSB。下圖 <Tex>{String.raw`w_H`}</Tex> 先停在 63.3 一千次、再跳回 62.0：沒有 anti-windup 時{' '}
        <Tex>{String.raw`|r|`}</Tex> 最大 {fx(wd.off.rPeak, 1)} LSB（<Tex>{String.raw`\approx0.3\times1000`}</Tex>），跳回後 <Tex>{String.raw`r`}</Tex> 每次只減 1，code
        還卡在 63 長達 <strong>{wd.off.stuck}</strong> 次更新；有 anti-windup（<Tex>{String.raw`r`}</Tex> 夾回 <Tex>{String.raw`[-\tfrac12,\tfrac12]`}</Tex>）只卡 {wd.on.stuck} 次。
      </p>
      <Mermaid
        chart={CHART_ANTIWINDUP}
        caption="anti-windup 夾在哪裡。和 §13.4 的 ΔΣ 迴圈比，只多了藍色的一塊：$r$ 存回暫存器之前先夾回正常範圍，overload 結束後才不必花幾百拍把累積的 $r$ 消掉。"
      />
      <p className="small ch13-figwalk">
        圖上藍色的 clamp 就是程式碼 <code>residual()</code> 裡 <code>antiWindup</code> 的那一段（把 <Tex>{'r'}</Tex> 夾在 <code>rLo</code> 與 <code>rHi</code> 之間，round-half-up 且沒有 dither 時是 <Tex>{String.raw`\pm\tfrac12`}</Tex>）。下圖的兩條線就是這張圖有、沒有藍色方塊的差別。
      </p>
      <Plot
        title={String.raw`Overload 後的恢復：$\Delta\Sigma$ windup`}
        ariaLabel="Overload 後的恢復：ΔΣ windup"
        data={wdData}
        height={240}
        csvName="ch13-windup"
        layout={{ xaxis: { title: { text: String.raw`$n$` } }, yaxis: { title: { text: String.raw`code $y$` } } }}
        caption={
          <>
            由 <code>simulateStrategy('deltaSigma')</code> 計算（定點 <Tex>{'F=16'}</Tex>、saturate）：前 1000 次 <Tex>{'w_H=63.3'}</Tex>，之後 <Tex>{'w_H=62.0'}</Tex>。
          </>
        }
      />

      <h3>2. Rounding、truncation、stochastic rounding 的差別</h3>
      <StepDerivation
        steps={[
          { tex: String.raw`\lfloor w\rfloor-w=-\mathrm{frac}(w)\in(-1,0]`, why: '無記憶 truncation（直接丟掉小數 bit）永遠往下偏。' },
          { tex: String.raw`E[\lfloor w\rfloor-w]=-\int_0^1u\,du=-\tfrac12\,\mathrm{LSB}`, why: tx(String.raw`若 $w$ 的小數部分在 $[0,1)$ 均勻（PVT 下未知），平均偏 $-\tfrac12$ LSB：truncation 有系統性 bias。`) },
          { tex: String.raw`E\big[\lfloor w+\tfrac12\rfloor-w\big]=0,\qquad E\big[y_{\mathrm{SR}}-w\big]=0`, why: tx(String.raw`round-half-up 在同樣的平均意義下無偏；stochastic rounding 對每一個 $w$ 都無偏（$E[y\,|\,w]=w$）。`) },
        ]}
      />
      <p className="small">
        對 ΔΣ 而言 floor 與 round 只差相位與 <Tex>{'r'}</Tex> 的範圍（因為誤差被回授），但「直接截掉 accumulator 的低位元」就是上面的 <Tex>{String.raw`-\tfrac12\,\mathrm{LSB}`}</Tex> bias。 <ClaimTag kind="exact" />
      </p>

      <h3>3. Dead zone</h3>
      <p>
        (a) 高解析 accumulator 直接取整（§13.1 的 dead-zone 推導）：小於半個 LSB 的變化看不見。(b) LMS 本身：若每次更新量 <Tex>{String.raw`|\mu G_k|`}</Tex> 小於{' '}
        <Tex>{'w_H'}</Tex> 的最小解析度 <Tex>{String.raw`2^{-F}`}</Tex> 的一半，<Tex>{'w_H'}</Tex> 根本不動（stall）。所以 <Tex>{'F'}</Tex> 要夠大：<Tex>{String.raw`2^{-F}\ll\mu\,\min|G|`}</Tex>，而 6-bit 輸出的解析度由量化策略處理，不要讓兩者混在一起。 <ClaimTag kind="approx" />
      </p>

      <h3>4. DTC glitch / switching kick 與跨 clock domain（CDC）</h3>
      <p>
        每次 code 改變都會產生一次 code-dependent 的 settling / kick；切換越多、跳越大，動態干擾越多。6-bit code 跨 clock domain 時還要注意<strong>多個 bit 同時翻轉</strong>：
        <Tex>{String.raw`31\to32`}</Tex> 是 <code>011111 → 100000</code>，6 個 bit 全翻（Hamming 距離 6），若在轉換瞬間被另一個 domain 取樣，可能讀到 0–63 的任何值。下表（<Tex>{'w_H'}</Tex> 含 LMS 雜訊，4096 次更新）：
      </p>
      <Mermaid
        chart={CHART_CDC}
        caption="6-bit code 跨 clock domain。先看上面的路：31 變 32 時 6 個 bit 同時翻，另一個 clock 若剛好在這瞬間取樣，可能讀到任何值（紅色）；再看下面的路：改用 gray 碼後一次只翻 1 個 bit，最壞只差 1 LSB（綠色）。"
      />
      <p className="small ch13-figwalk">
        圖上的「幾個 bit 同時翻」就是下表的 Hamming 距離（兩個 code 的二進位表示有幾個 bit 不同）；表中「多 bit 翻轉的切換」數的是每次 code 改變時 Hamming 距離大於 1 的次數。
      </p>
      <div className="table-wrap">
        <table className="ch13-table" aria-label="各策略的 code 範圍、切換率、多 bit 翻轉次數與最大 Hamming 距離">
          <thead>
            <tr>
              <th>策略</th>
              <th>code 範圍</th>
              <th>切換率 [次/更新]</th>
              <th>
                每秒切換次數（<Tex>{String.raw`\text{切換率}\times f_u`}</Tex>，<Tex>{String.raw`f_u=${ntex(DEFAULT_LAB_PARAMS.fs, 3)}\,\mathrm{Hz}`}</Tex>）
              </th>
              <th>多 bit 翻轉的切換</th>
              <th>最大 Hamming 距離</th>
            </tr>
          </thead>
          <tbody>
            {cdc.map((c) => (
              <tr key={c.strategy}>
                <td className="nowrap">{STRATEGY_LABEL[c.strategy]}</td>
                <td>
                  {c.min}–{c.max}
                </td>
                <td>{fx(c.rate, 3)}</td>
                <td>{num(c.rate * c.fu, 3)}</td>
                <td>
                  {c.multi} / {c.trans}
                </td>
                <td>{c.maxH}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small">
        處理方式：在 code domain 產生、在 DTC domain 以同步 handshake 或 gray / thermometer 編碼傳遞；更新時刻對齊 reference edge。若兩個 clock 非同步（<Tex>{String.raw`f_s/f_u`}</Tex> 不是整數），ZOH
        的保持長度會在 <Tex>{String.raw`\lfloor f_s/f_u\rfloor`}</Tex> 與 <Tex>{String.raw`\lceil f_s/f_u\rceil`}</Tex> 之間抖動，<Tex>{String.raw`\mathrm{sinc}^2`}</Tex> 權重與譜線位置都會改變（aliasing）。本站<strong>沒有</strong>模擬非同步 ZOH（Not implemented）。 <ClaimTag kind="research" />
      </p>

      <h3>5. Dither randomness、PRBS 長度與 initial seed</h3>
      <p>
        PRBS-7 換不同 seed：一個週期內每個非零 7-bit 字仍各出現一次，只是起點不同；又因 <Tex>{String.raw`\gcd(7,127)=1`}</Tex>，不同起點的字序列彼此只差時間平移，所以輸出也只是<strong>時間平移</strong>，譜線大小完全一樣：
      </p>
      <div className="table-wrap">
        <table className="ch13-table" aria-label="PRBS-7 不同 seed 的輸出：前 12 個 code、最大譜線與總功率">
          <thead>
            <tr>
              <th>seed</th>
              <th>
                前 12 個 <Tex>{'y[n]-32'}</Tex>
              </th>
              <th>
                最大譜線 <Tex>{'k'}</Tex>（<Tex>{String.raw`\times f_u/127`}</Tex>）
              </th>
              <th>
                線功率 <Tex>{String.raw`[\mathrm{LSB}^2]`}</Tex>
              </th>
              <th>
                總功率（含 <Tex>{String.raw`\mathrm{DC}^2`}</Tex>）<Tex>{String.raw`[\mathrm{LSB}^2]`}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            {prbsSeeds.map((r) => (
              <tr key={r.seed}>
                <td>{r.seed}</td>
                <td className="mono">{r.first}</td>
                <td>{r.topK}</td>
                <td>{num(r.topP, 6)}</td>
                <td>{fx(r.total, 6)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small">
        也就是說 seed 不能「修掉」短 PRBS 的 tone；要嘛加長 N，要嘛接受 <Tex>{String.raw`f_u/(2^N-1)`}</Tex> 間距的細密譜線。 <ClaimTag kind="exact" />
      </p>

      <h3>6. 定點暫存器溢位</h3>
      <p>
        ΔΣ 的 <Tex>{String.raw`v=w_H+r`}</Tex> 範圍是 <Tex>{String.raw`[-\tfrac12-\tfrac A2,\;2^B-\tfrac12+\tfrac A2]`}</Tex>（<Tex>{String.raw`0\le w_H\le2^B-1`}</Tex>、<Tex>{String.raw`|r|\le\tfrac12+\tfrac A2`}</Tex>），以 <Tex>{'F'}</Tex> 個小數 bit 表示需要至少{' '}
        <Tex>{String.raw`B+F+1`}</Tex> bit（<Tex>{'B'}</Tex> 個整數 bit、<Tex>{'F'}</Tex> 個小數 bit、1 個符號 bit；因為 <Tex>{'A<1'}</Tex> 時 <Tex>{String.raw`|v|<2^B`}</Tex>）。
        <Tex>{String.raw`A\ge1`}</Tex> LSB 時上界 <Tex>{String.raw`2^B-\tfrac12+\tfrac A2\ge2^B`}</Tex>，要再加 guard bit：dither 越大、guard bit 越多。accumulator 本身溢位等於 wrap（第 1 點），是最嚴重的失效。{' '}
        <ClaimTag kind="exact" />
      </p>

      <h3>7. 高階 ΔΣ 的 stability / overload</h3>
      <Callout kind="warn" title="Not implemented（研究延伸 R3）">
        二階以上的 error-feedback（例如 <Tex>{String.raw`\mathrm{NTF}=(1-z^{-1})^2`}</Tex>）不能直接套用一階的結論：<Tex>{String.raw`r`}</Tex> 不再自動有界、靠近 0 或 63 時容易 overload、limit cycle 結構也不同，必須以
        behavioral / bit-true 模擬單獨驗證（規格 §13.6）。本站目前<strong>沒有</strong>實作高階 quantizer。 <ClaimTag kind="research" />
      </Callout>

      <ModeGate min="engineer">
        <Fold title="Sign-off 檢查清單（本章）">
          <ol className="small">
            <li><Tex>{String.raw`Q_B`}</Tex> 的 rounding / tie 規則、<Tex>{String.raw`r`}</Tex> 的範圍在 RTL 與 behavioral model 一致（bit-true 比對，不用浮點）。</li>
            <li>overflow 一律 saturate；ΔΣ 有 anti-windup；<Tex>{String.raw`w_H`}</Tex> 範圍檢查：有 dither 時距離 code 邊界至少留 <Tex>{'A'}</Tex> LSB（<Tex>{String.raw`A\le w_H<2^B-1-A`}</Tex>，見 §13.4E）。</li>
            <li>常數輸入（含 LMS 凍結後）的 limit-cycle 週期與線功率：以 <Tex>{String.raw`2^F/\gcd`}</Tex> 與精確 DFT 計算，確認不落在 PLL 頻寬內或已被 dither 打散；接上 DSM 後連初始相位都要一起檢查（§13.5b）。</li>
            <li>code 更新率與 DTC domain 的 CDC：同步、單 bit 翻轉或 handshake。</li>
            <li>PRBS 長度、seed、週期與 bias 有記錄；換 seed 不能當作消除 tone 的手段。</li>
            <li>以同一 DSM 序列、同一 seed 做五策略 paired comparison，並同時跑常數與 LMS 雜訊兩種情境（勘誤 E15）。</li>
          </ol>
        </Fold>
      </ModeGate>
      <p className="small muted">本節所有數字由 quantizer.ts 即時計算；共 {STRATEGIES.length} 種策略。</p>
    </Section>
  )
}
