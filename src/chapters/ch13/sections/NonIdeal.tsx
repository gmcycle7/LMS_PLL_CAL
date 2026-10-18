import { useMemo } from 'react'
import type { Data } from 'plotly.js-cartesian-dist-min'
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
  ChRef,
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
import { cdcStats, grayDecode, grayEncode, hamming, mixedSamples, mixedWords } from '../cdc'
import { DEFAULT_LAB_PARAMS, Fold, fx, ntex, num, tx } from '../common'
import { CHART_ANTIWINDUP, CHART_CDC, CHART_SAT_WRAP } from '../diagrams'

/** 6-bit 的位元字串（高位在左），例如 31 → 011111。 */
const b6 = (n: number) => n.toString(2).padStart(6, '0')

/**
 * §13.6 第 4 點的手算用到的 gray 碼數字：由 cdc.ts 算出（cdc.test.ts 逐一核對），不手寫。
 * 例子：相鄰的 31 → 32，以及一次跳 3 LSB 的 31 → 34（策略 E 實際會出現的跳動）。
 */
function grayHandCalc() {
  /** gray(n) 的定義式代入數字：n 的二進位 ⊕ ⌊n/2⌋ 的二進位（eq 是等號的寫法：多行對齊時傳 `&=`）。 */
  const xorLine = (n: number, eq = '=') => String.raw`\mathrm{gray}(${n})${eq}${b6(n)}_2\oplus${b6(n >>> 1)}_2=${b6(grayEncode(n))}_2`
  const g31 = grayEncode(31)
  const g34 = grayEncode(34)
  // 取樣瞬間 bit 5 還是舊值、其餘 bit 已經是新值時讀到的字
  const mixed = (g31 & 0b100000) | (g34 & 0b011111)
  // 解碼規則逐位展開：b_5 = g_5，b_k = b_{k+1} ⊕ g_k
  const g = b6(mixed).split('').map(Number)
  const b = [g[0]]
  const terms = [String(g[0])]
  for (let k = 1; k < 6; k++) {
    terms.push(String.raw`${b[k - 1]}\oplus${g[k]}`)
    b.push(b[k - 1] ^ g[k])
  }
  return {
    xorLine,
    g31: b6(g31),
    g34: b6(g34),
    h32: hamming(g31, grayEncode(32)),
    h34: hamming(g31, g34),
    mixed: b6(mixed),
    mixedValue: grayDecode(mixed),
    decodeChain: String.raw`${b6(mixed)}_2:\ b_5b_4b_3b_2b_1b_0=${terms.join(String.raw`,\ `)}=${b.join('')}_2=${grayDecode(mixed)}`,
    words: mixedWords(31, 34, 'gray').map((m) => ({ word: b6(m.word), value: m.value })),
    samples: mixedSamples(31, 34, 'gray'),
    adjacent: mixedSamples(31, 32, 'gray'),
  }
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
    return lab.compare.map((r) => ({ strategy: r.strategy, ...cdcStats(r.trace.y), rate: r.metrics.toggleRate, fu: r.fu, min: r.metrics.codeMin, max: r.metrics.codeMax }))
  }, [])
  // 「讀表」文字用到的兩列（D 與 E）；數字全部取自上面的模擬結果
  const cdcD = cdc.find((c) => c.strategy === 'deltaSigma')!
  const cdcE = cdc.find((c) => c.strategy === 'deltaSigmaDither')!
  const gh = useMemo(grayHandCalc, [])
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
        <Tex>{String.raw`31\to32`}</Tex> 是 <code>011111 → 100000</code>，6 個 bit 全翻（Hamming 距離 6），若在轉換瞬間被另一個 domain 取樣，可能讀到 0–63 的任何值。
      </p>
      <Mermaid
        chart={CHART_CDC}
        caption={String.raw`6-bit code 跨 clock domain。先看最上面的路：31 變 32 時二進位的 6 個 bit 同時翻，另一個 clock 若剛好在這瞬間取樣，可能讀到任何值（紅色）；再看中間的路：同樣是 31 變 32，改用 gray 碼後只翻 1 個 bit，只會讀到 31 或 32（綠色）——這個保證只對相鄰的 code（一次只變 1 個 LSB，$|\Delta y|=1$）成立；最後看最下面的路：一次跳 3 LSB 的 31 變 34，gray 碼翻 3 個 bit，可能讀到 28 到 35（紅色）。`}
      />
      <p className="small ch13-figwalk">
        圖上的「幾個 bit 同時翻」就是下表的 Hamming 距離（兩個 code 的位元表示有幾個 bit 不同）。圖上最下面那條路的「一次跳 3 LSB」，對應下表的「一次最多跳幾個 LSB」（<Tex>{String.raw`\max|\Delta y|`}</Tex>，其中{' '}
        <Tex>{String.raw`\Delta y[n]=y[n]-y[n-1]`}</Tex> 是一次更新的 code 跳動量）。下表用二進位與 gray 碼各算一次「多 bit 翻轉的切換」：code 改變時 Hamming 距離大於 1 的次數。
      </p>
      <p>
        gray 碼的保證有一個前提：<strong>只有相鄰的兩個 code（<Tex>{String.raw`|\Delta y|=1`}</Tex>）才保證只差 1 個 bit</strong>。用定義直接算一次：
      </p>
      <StepDerivation
        title="手算：gray 碼什麼時候只翻 1 個 bit？"
        steps={[
          {
            tex: String.raw`\mathrm{gray}(n)=n\oplus\lfloor n/2\rfloor`,
            why: tx(String.raw`gray 碼的定義：把 $n$ 的二進位右移一位（就是 $\lfloor n/2\rfloor$），再和原本的 $n$ 逐 bit 做 XOR（$\oplus$：兩個 bit 相同得 0、不同得 1）。`),
          },
          {
            tex: String.raw`\begin{aligned}${gh.xorLine(31, '&=')}\\ ${gh.xorLine(32, '&=')}\end{aligned}`,
            why: tx(String.raw`相鄰的 31 與 32：兩個 gray 碼只有最高位不同（Hamming 距離 ${gh.h32}）。取樣時這一個 bit 不是舊值就是新值，所以只會讀到 ${gh.adjacent.join(' 或 ')}。`),
          },
          {
            tex: gh.xorLine(34),
            why: tx(String.raw`一次跳 3 LSB 的 $31\to34$：和 $\mathrm{gray}(31)=${gh.g31}_2$ 比，bit 5、bit 1、bit 0 共 ${gh.h34} 個 bit 不同（Hamming 距離 ${gh.h34}；最右邊是 bit 0）。`),
          },
          {
            tex: String.raw`b_5=g_5,\qquad b_k=b_{k+1}\oplus g_k\quad(k=4,3,\dots,0)`,
            why: tx(String.raw`解碼規則（gray 碼 $g_5g_4\cdots g_0$ 轉回二進位 $b_5b_4\cdots b_0$）：最高位照抄，其餘每一位是「上一個算出來的二進位 bit」和「這一位的 gray bit」做 XOR。`),
          },
          {
            tex: gh.decodeChain,
            why: tx(String.raw`${gh.h34} 個不同的 bit 各自可能是舊值或新值。例如 bit 5 還是舊的 0、bit 1 與 bit 0 已經是新的 1，接收端就讀到 $${gh.mixed}_2$，解碼是 ${gh.mixedValue}。`),
          },
          {
            tex: String.raw`2^{${gh.h34}}=${gh.words.length}\ \text{種取樣結果}\ \Rightarrow\ \{${gh.samples.join(',')}\}`,
            why: tx(String.raw`${gh.words.length} 種新舊組合全部解碼：${gh.words.map((m) => String.raw`$${m.word}\to${m.value}$`).join('、')}。${gh.samples[0]} 比舊值 31 還低 ${31 - gh.samples[0]} LSB，已經不是「最壞差 1 LSB」。`),
          },
        ]}
      />
      <p className="small">
        一般規則（對任何位元數都成立）：<Tex>{String.raw`|\Delta y|=1`}</Tex> 時 gray 碼恰好翻 1 個 bit；<Tex>{String.raw`|\Delta y|=2`}</Tex> 時恰好翻 2 個 bit；<Tex>{String.raw`|\Delta y|=3`}</Tex> 時翻 1 個或 3 個（較小的那個 code 是偶數時翻 1 個，例如{' '}
        <Tex>{String.raw`32\to35`}</Tex>；是奇數時翻 3 個，例如 <Tex>{String.raw`31\to34`}</Tex>）。所以 gray 碼「最壞差 1 LSB」的保證只在每次更新 <Tex>{String.raw`|\Delta y|\le1`}</Tex> 時成立；能不能用，要先看量化策略一次最多跳幾個 LSB。{' '}
        <ClaimTag kind="exact" />
      </p>
      <p className="small">
        下表是五種策略在同一個情境下的統計（<Tex>{'w_H'}</Tex> 含 LMS 雜訊、4096 次更新、同一個亂數種子）：
      </p>
      <div className="table-wrap">
        <table className="ch13-table" aria-label="各策略的 code 範圍、切換率、一次最大跳動量、二進位與 gray 碼的多 bit 翻轉次數、二進位的最大 Hamming 距離">
          <thead>
            <tr>
              <th>策略</th>
              <th>code 範圍</th>
              <th>切換率 [次/更新]</th>
              <th>
                每秒切換次數（<Tex>{String.raw`\text{切換率}\times f_u`}</Tex>，<Tex>{String.raw`f_u=${ntex(DEFAULT_LAB_PARAMS.fs, 3)}\,\mathrm{Hz}`}</Tex>）
              </th>
              <th>
                一次最多跳幾個 LSB（<Tex>{String.raw`\max|\Delta y|`}</Tex>）
              </th>
              <th>多 bit 翻轉的切換（二進位）</th>
              <th>最大 Hamming 距離（二進位）</th>
              <th>多 bit 翻轉的切換（gray 碼）</th>
            </tr>
          </thead>
          <tbody>
            {cdc.map((c) => (
              <tr key={c.strategy}>
                <td className="nowrap">{STRATEGY_LABEL[c.strategy]}</td>
                <td className="nowrap">
                  {c.min}–{c.max}
                </td>
                <td>{fx(c.rate, 3)}</td>
                <td>{num(c.rate * c.fu, 3)}</td>
                <td>{c.maxStep}</td>
                <td className="nowrap">
                  {c.multi} / {c.trans}
                </td>
                <td>{c.maxH}</td>
                <td className="nowrap">
                  {c.grayMulti} / {c.trans}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small">
        讀表：這是同一個亂數種子的一次模擬，不是保證。B、C 這次每一步都只跳 1 LSB，改用 gray 碼後沒有多 bit 翻轉；但 <Tex>{'w_H'}</Tex> 帶著 LMS 雜訊，在兩次更新之間跨過整數時，B、C 也可能一次跳 2 LSB（換一個亂數種子重跑就可能出現）。D 有 {cdcD.multiStep} 次跳 2 LSB 以上（最多一次跳 {cdcD.maxStep} LSB）。E 的 {cdcE.trans} 次切換裡有 {cdcE.multiStep} 次跳 2 LSB 以上，改用 gray 碼後仍有 {cdcE.grayMulti} 次是多 bit 翻轉（二進位那一欄是 {cdcE.multi} 次）：兩種編碼都沒有把多 bit 翻轉消掉。差別在最壞情況：二進位一次最多翻 {cdcE.maxH} 個 bit，可能讀到離新舊值很遠的 code；gray 碼最多翻 {cdcE.grayMaxH} 個 bit，就是上面手算的{' '}
        <Tex>{String.raw`31\to34`}</Tex>。
      </p>
      <p className="small">處理方式要先看兩件事：兩個 clock 是否同步，以及 code 一次更新最多跳幾個 LSB（下面是設計準則；本站只統計 code 的跳動，沒有模擬跨 domain 的取樣）。</p>
      <ol className="small">
        <li>
          同步（<Tex>{String.raw`f_s/f_u`}</Tex> 是整數、相位固定）：把更新時刻對齊 reference edge，當成一般的同步路徑檢查 timing，不需要特別編碼。
        </li>
        <li>
          非同步，而且電路保證每次更新 <Tex>{String.raw`|\Delta y|\le1`}</Tex>：可以用 gray 碼。條件是 gray 值直接由暫存器輸出（中間沒有組合邏輯）、每個 bit 各自經過同步器，而且各 bit 的路徑延遲差（bus skew）有約束：常用的保守規則是小於兩個 clock 週期中較短的那一個；這樣接收端只會讀到舊值或新值。「保證」不能只靠上表沒看到：
          <Tex>{'w_H'}</Tex> 固定不動時（LMS 凍結後）B、C、D 只在相鄰的兩個 code 之間切換，條件成立；<Tex>{'w_H'}</Tex> 還在動時，會切換的四種策略都不保證 <Tex>{String.raw`|\Delta y|\le1`}</Tex>（上表的 D、E 已經出現，B、C 只是這次沒出現），除非電路另外限制一次最多改變 1 個 code（本站沒有模擬這種限制）。
        </li>
        <li>
          非同步，而且一次可能跳 2 LSB 以上（E；以及 <Tex>{'w_H'}</Tex> 還在動、又沒有上述限制的 B、C、D）：gray 碼的保證不成立，要用 handshake——6-bit code 先在暫存器裡保持不動，用一條單 bit 的 request 訊號（單一個 bit 沒有新舊混合的問題）經同步器通知 DTC domain 取樣，收到 acknowledge 之後才允許下一次更新——或使用 asynchronous FIFO。handshake 的等待時間要算進更新延遲（<ChRef ch="04">第 4 章</ChRef>的 latency 計算、<ChRef ch="08">第 8 章</ChRef>的 phase margin）。
        </li>
      </ol>
      <p className="small">
        thermometer 碼（6-bit 的值需要 <Tex>{String.raw`2^B-1=63`}</Tex> 條線，第 <Tex>{'k'}</Tex> 條在 <Tex>{String.raw`y\ge k`}</Tex> 時是 1）也不能只看名稱：只有在接收端「數有幾個 1」時（例如直接控制 63 個等權重的單位元件），任何步長下讀到的值才都落在新舊值之間。若接收端用別的電路把它解碼回二進位，取樣到的中間樣式會解出什麼，要看解碼電路。例如{' '}
        <Tex>{String.raw`31\to34`}</Tex> 途中讀到「第 1 到 31 條與第 33 條是 1、第 32 與第 34 條是 0」：數 1 的個數得到 32；但「每個 1 到 0 的邊界各自查表、再把結果 OR 起來」的解碼器，會把 31 與 33 兩個邊界合成{' '}
        <Tex>{String.raw`011111_2\ \mathrm{OR}\ 100001_2=111111_2=63`}</Tex>。
      </p>
      <p className="small">
        若兩個 clock 非同步（<Tex>{String.raw`f_s/f_u`}</Tex> 不是整數），ZOH 的保持長度會在 <Tex>{String.raw`\lfloor f_s/f_u\rfloor`}</Tex> 與 <Tex>{String.raw`\lceil f_s/f_u\rceil`}</Tex> 之間抖動，<Tex>{String.raw`\mathrm{sinc}^2`}</Tex> 權重與譜線位置都會改變（aliasing）。本站<strong>沒有</strong>模擬非同步 ZOH（Not implemented）。 <ClaimTag kind="research" />
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
            <li>
              code 更新率與 DTC domain 的 CDC：同步設計對齊 reference edge；非同步時，只有電路保證每次更新 <Tex>{String.raw`|\Delta y|\le1`}</Tex> 才可用 gray 碼（暫存器直接輸出、每個 bit 有同步器、bus skew 有約束）；可能跳 2 LSB 以上的（例如策略 E）用 handshake 或 asynchronous FIFO。模擬裡看到 <Tex>{String.raw`\max|\Delta y|=1`}</Tex> 不算保證。
            </li>
            <li>PRBS 長度、seed、週期與 bias 有記錄；換 seed 不能當作消除 tone 的手段。</li>
            <li>以同一 DSM 序列、同一 seed 做五策略 paired comparison，並同時跑常數與 LMS 雜訊兩種情境（勘誤 E15）。</li>
          </ol>
        </Fold>
      </ModeGate>
      <p className="small muted">本節的模擬數字由 quantizer.ts 即時計算（gray 碼與 Hamming 距離的統計由 cdc.ts 計算）；共 {STRATEGIES.length} 種策略。</p>
    </Section>
  )
}
