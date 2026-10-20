import { useMemo } from 'react'
import { Callout, ClaimTag, MetricTable, ModeGate, SourceTag, StepDerivation, TestBadge, Tex, mathText, type MetricRow, ChRef } from '@/components'
import { cycleLines, ditherCompare, efCycle, prbs7, prbs7Words, prbsHalfLsbDither, prbsWordDither, type CycleLines, type EfCycle } from '../bridge'
import { BridgeCode, BridgeCompare, ErratumNote, FormulaAnchor, Hand, PrereqPsd, num, r, texNum } from '../common'

/** w_H = 32.4 LSB = 162/5（規格 §13；T16） */
export const WH = { num: 162, den: 5, value: 32.4 } as const
export const DITHER_SEED = 20261010
export const DITHER_N = 1 << 16
/** 1-bit ±½ LSB dither 用的分母（162/5 = 324/10）與 7-bit 字 dither 用的分母（lcm(5, 128) = 640） */
export const D5_BIT_DEN = 2 * WH.den
export const D5_WORD_DEN = 128 * WH.den
/** 譜線表只算功率超過這個門檻的線（濾掉 FFT 的捨入誤差） */
const LINE_FLOOR = 1e-9

const db10 = (x: number) => 10 * Math.log10(x)

export type D5CaseKey = 'none' | 'bitShaped' | 'bitInput' | 'wordShaped' | 'wordInput'

export interface D5Case {
  key: D5CaseKey
  /** 顯示名稱（`$…$` 為 TeX） */
  name: string
  cycle: EfCycle
  lines: CycleLines
  /** 非 DC、功率 > 1e−9 LSB² 的獨立譜線數 */
  nLines: number
}

export function d5Data() {
  const bits = prbs7()
  const ones = bits.reduce((s, b) => s + b, 0)
  const words = prbs7Words(bits)
  const bitDither = prbsHalfLsbDither(bits, D5_BIT_DEN)
  const wordDither = prbsWordDither(words, D5_WORD_DEN)
  const make = (key: D5CaseKey, name: string, cNum: number, den: number, ditherNum?: ArrayLike<number>, shaped = false): D5Case => {
    const cycle = efCycle(cNum, den, { ditherNum, shaped })
    const lines = cycleLines(cycle.cycle, WH.value)
    let nLines = 0
    for (let k = 1; k < lines.power.length; k++) if (lines.power[k] > LINE_FLOOR) nLines++
    return { key, name, cycle, lines, nLines }
  }
  const cases: D5Case[] = [
    make('none', '無 dither', WH.num, WH.den),
    make('bitShaped', r`1-bit PRBS-7（$\pm\tfrac12\ \mathrm{LSB}$），只加在量化器輸入`, 2 * WH.num, D5_BIT_DEN, bitDither, true),
    make('bitInput', r`1-bit PRBS-7（$\pm\tfrac12\ \mathrm{LSB}$），併入殘值`, 2 * WH.num, D5_BIT_DEN, bitDither, false),
    make('wordShaped', r`7-bit PRBS-7 字（127 個準位），只加在量化器輸入`, 128 * WH.num, D5_WORD_DEN, wordDither, true),
    make('wordInput', r`7-bit PRBS-7 字（127 個準位），併入殘值`, 128 * WH.num, D5_WORD_DEN, wordDither, false),
  ]
  const byKey = Object.fromEntries(cases.map((c) => [c.key, c])) as Record<D5CaseKey, D5Case>
  // 兩個「1-bit dither 其實沒有打散 limit cycle」的對照序列：floor 版的無 dither 循環、目標換成 c − ½ 的無 dither 循環
  const floorCycle = efCycle(WH.num, WH.den, { rounding: 'floor' })
  const shiftedCycle = efCycle(2 * WH.num - WH.den, D5_BIT_DEN)
  const shiftedLines = cycleLines(shiftedCycle.cycle, (2 * WH.num - WH.den) / D5_BIT_DEN)
  const wordMean = words.reduce((s, w) => s + w, 0) / words.length
  return {
    plain: byKey.none.cycle,
    plainLines: byKey.none.lines,
    cases,
    byKey,
    ones,
    L: bits.length,
    floorCycle,
    shiftedCycle,
    shiftedLines,
    wordMean,
    wordLevels: new Set(words).size,
  }
}

const zero = (x: number) => (Math.abs(x) < 1e-12 ? 0 : x)

/** D5 對應的本站推導：常數目標的 limit cycle、有限狀態 ⇒ 週期 ⇒ 線譜、PRBS dither 加在哪裡（Ch13）。 */
export function D5Quant() {
  const d = useMemo(d5Data, [])
  const P = d.plain.period
  const lineRows = Array.from(d.plainLines.power)
    .map((pw, k) => ({ k, pw }))
    .filter((x) => x.k > 0)
  const base = d.plainLines.maxLinePower
  const bitS = d.byKey.bitShaped
  const bitI = d.byKey.bitInput
  const wordS = d.byKey.wordShaped
  const wordI = d.byKey.wordInput
  const imbalance = ((d.ones - (d.L - d.ones)) / d.L) * 0.5
  return (
    <div className="papers-derived">
      <p>
        <SourceTag kind="illustrative" /> 本站 <ChRef ch="13">Ch13</ChRef> 的例子：6-bit gain register 的目標是 <Tex>{r`w_H=${WH.value}\ \mathrm{LSB}=${WH.num}/${WH.den}`}</Tex>
        ，用一階 error-feedback（ΔΣ）quantizer <Tex>{r`v[n]=w_H+r[n-1],\ y[n]=Q(v[n]),\ r[n]=v[n]-y[n]`}</Tex>（round-half-up{' '}
        <Tex>{r`Q(v)=\lfloor v+\tfrac12\rfloor`}</Tex>、<Tex>{'r[-1]=0'}</Tex>）。先看沒有 dither 的情況；所有運算以整數分子精確執行。
      </p>
      <p>
        結果：週期 <Tex>{r`P=${P}`}</Tex>，循環 <Tex>{`[${d.plain.cycle.join(',')}]`}</Tex>；總誤差功率{' '}
        <Tex>{r`${num(d.plainLines.totalPower, 6)}\ \mathrm{LSB}^2`}</Tex>、DC 誤差 <Tex>{num(zero(d.plainLines.dcError), 4)}</Tex>（
        <ErratumNote id="E15">對常數目標，<Tex>{r`\Delta\Sigma`}</Tex> 與週期 toggle 是同一個循環，不是 noise-shaped 寬頻雜訊</ErratumNote>）。
      </p>
      <PrereqPsd />
      <div className="table-wrap">
        <table className="papers-table">
          <thead>
            <tr>
              <th className="num">
                bin <Tex>{'k'}</Tex>
              </th>
              <th className="num">
                頻率（以更新率 <Tex>{'f_u'}</Tex> 為單位）
              </th>
              <th className="num">peak 振幅 [LSB]</th>
              <th className="num">
                單邊功率 [<Tex>{r`\mathrm{LSB}^2`}</Tex>]
              </th>
              <th className="num">占總功率</th>
            </tr>
          </thead>
          <tbody>
            {lineRows.map((x) => (
              <tr key={x.k} className={x.k === d.plainLines.maxLineK ? 'papers-row-hl' : undefined}>
                <td className="num">{x.k}</td>
                <td className="num">
                  <Tex>{`${x.k}/${P}`}</Tex>
                </td>
                <td className="num mono">{num(2 * d.plainLines.amp[x.k], 5)}</td>
                <td className="num mono">{num(x.pw, 5)}</td>
                <td className="num mono">{num((100 * x.pw) / d.plainLines.totalPower, 4)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        主 tone 在 <Tex>{`${d.plainLines.maxLineK}f_u/${P}`}</Tex>（<ErratumNote id="E47" />
        ）。以 code 更新率取樣時只有這 {lineRows.length} 條獨立譜線；ZOH 到更高取樣率才會出現更高的諧波（<ChRef ch="13">Ch13</ChRef>）。
      </p>
      <FormulaAnchor id="F-PR.12">
        <StepDerivation
          title={
            <>
              為什麼一定是線譜：有限狀態 <Tex>{r`\Rightarrow`}</Tex> 最終週期（鴿籠原理）
            </>
          }
          steps={[
            {
              tex: r`s_n=\big(R_n,\ n\bmod L\big)\in\mathcal S,\qquad |\mathcal S|\le M\cdot L`,
              why: (
                <>
                  狀態 = 量化殘值的分子 <Tex>{r`R_n=r[n]\cdot\mathrm{den}`}</Tex> 與 dither 序列的相位。目標與 dither 都是有理數、量化器不 overload 時{' '}
                  <Tex>{'r'}</Tex> 有界（沒有 dither 時 <Tex>{r`r\in[-\tfrac12,\tfrac12)`}</Tex>；加了 dither 最多再寬一個 dither 的峰對峰值），所以{' '}
                  <Tex>{'R'}</Tex> 只有有限個（<Tex>{'M'}</Tex> 個）可能值；週期 <Tex>{'L'}</Tex> 的 PRBS 只有 <Tex>{'L'}</Tex> 個相位（沒有 dither 時{' '}
                  <Tex>{'L=1'}</Tex>）。
                </>
              ),
            },
            {
              tex: r`s_{n+1}=F(s_n),\qquad y_n=G(s_n)`,
              why: 'quantizer 與 PRBS 都是決定性的：下一個狀態與目前輸出只由目前狀態決定。',
            },
            {
              tex: r`\exists\ 0\le i<j\le|\mathcal S|:\ s_i=s_j`,
              why: (
                <>
                  <Tex>{r`|\mathcal S|+1`}</Tex> 個狀態放進 <Tex>{r`|\mathcal S|`}</Tex> 個盒子，至少有兩個相同（鴿籠原理）。
                </>
              ),
            },
            {
              tex: r`s_{i+m}=s_{j+m}\ \ (\forall m\ge0)\quad\Longrightarrow\quad y_{n+(j-i)}=y_n\ \ (\forall n\ge i)`,
              why: (
                <>
                  同一個狀態之後走同一條路；輸出由狀態決定，所以輸出從第 <Tex>{'i'}</Tex> 個 sample 起週期性。
                </>
              ),
            },
          ]}
          result={r`\text{週期序列}\ \Longrightarrow\ \text{頻譜只有 }\Omega_k=2\pi k/P\text{ 的譜線（spurs）}`}
        />
      </FormulaAnchor>
      <BridgeCompare
        caption="左：quantizer 的一步（整數分子運算）；右：用狀態第一次重複找出週期。上面的表就是用這兩段算的。"
        items={[
          { label: 'efStep', region: 'efStep', note: '一階 error feedback 的一步' },
          { label: 'efCycle', region: 'finiteStatePeriod', note: '鴿籠原理找週期' },
        ]}
      />
      <p>
        <ClaimTag kind="exact" />
        （有理數目標、週期 dither、不 overload）。dither 若來自週期 <Tex>{'L'}</Tex> 的 PRBS，它只是把狀態空間放大 <Tex>{'L'}</Tex> 倍，
        <strong>不會</strong>讓序列變成非週期。
      </p>
      <h4 className="papers-subhead">PRBS dither：加在哪裡、有幾個準位，結果差很多</h4>
      <p>dither <Tex>{r`\xi[n]`}</Tex> 有兩種常見的接法，程式上只差一行：</p>
      <ul>
        <li>
          <strong>只加在量化器輸入</strong>（本站 <ChRef ch="13">Ch13</ChRef> 的策略 E）：<Tex>{r`y[n]=Q(v[n]+\xi[n]),\ r[n]=v[n]-y[n]`}</Tex>，所以{' '}
          <Tex>{r`y[n]=w_H+r[n-1]-r[n]`}</Tex>。<Tex>{r`\xi`}</Tex> 藏在 <Tex>{'r'}</Tex> 裡，和量化誤差一起被 <Tex>{r`1-z^{-1}`}</Tex> 塑形，DC 誤差恆為 0。
        </li>
        <li>
          <strong>併入殘值</strong>（等效於把 <Tex>{r`\xi`}</Tex> 加在調變器輸入）：<Tex>{r`r[n]=v[n]+\xi[n]-y[n]`}</Tex>，所以{' '}
          <Tex>{r`y[n]=w_H+\xi[n]+r[n-1]-r[n]`}</Tex>。<Tex>{r`\xi`}</Tex> 原封不動出現在輸出，它的平均值就是輸出的 DC 誤差。
        </li>
      </ul>
      <BridgeCode region="efDitherStep" caption="兩種接法共用同一段程式；標「← 差異」的那一行決定 dither 會不會被塑形。" />
      <p>
        再比較兩種 PRBS-7（<Tex>{r`L=${d.L}`}</Tex>）dither：<strong>1-bit</strong>（<Tex>{r`\xi=\pm\tfrac12\ \mathrm{LSB}`}</Tex>，兩個準位相差整整 1 LSB）與{' '}
        <strong>7-bit 字</strong>（把 LFSR 連續 7 個 bit 當成 <Tex>{r`s[n]\in\{1,\dots,127\}`}</Tex>，取{' '}
        <Tex>{r`\xi[n]=(s[n]-64)/128\ \mathrm{LSB}`}</Tex>：{d.wordLevels} 個準位，<Tex>{r`\bar s=${num(d.wordMean, 6)}`}</Tex>，所以{' '}
        <Tex>{r`\bar\xi=${num(zero((d.wordMean - 64) / 128), 4)}`}</Tex>）。本站程式找到：
      </p>
      <div className="table-wrap">
        <table className="papers-table">
          <thead>
            <tr>
              <th>情況</th>
              <th className="num">週期</th>
              <th className="num">獨立譜線數</th>
              <th className="num">最大譜線（單邊）</th>
              <th className="num">最大譜線頻率</th>
              <th className="num">總誤差功率</th>
              <th className="num">DC 誤差 [LSB]</th>
            </tr>
          </thead>
          <tbody>
            {d.cases.map((row) => (
              <tr key={row.key} data-d5-case={row.key}>
                <td>{mathText(row.name)}</td>
                <td className="num mono">{row.cycle.period}</td>
                <td className="num mono">{row.nLines}</td>
                <td className="num mono">
                  {num(row.lines.maxLinePower, 4)} <Tex>{r`\mathrm{LSB}^2`}</Tex>
                  <br />
                  <span className="small muted">{row.key === 'none' ? '（基準）' : `（${num(zero(db10(row.lines.maxLinePower / base)), 3)} dB 相對無 dither）`}</span>
                </td>
                <td className="num">
                  <Tex>{`${row.lines.maxLineK}/${row.cycle.period}\\,f_u`}</Tex>
                </td>
                <td className="num mono">
                  {num(row.lines.totalPower, 4)} <Tex>{r`\mathrm{LSB}^2`}</Tex>
                </td>
                <td className="num mono">{num(zero(row.lines.dcError), 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>表裡有四件事值得記住：</p>
      <ol>
        <li>
          <strong>每一列都是週期序列</strong>：dither 只是把功率從 {d.byKey.none.nLines} 條線攤到最多 {Math.max(...d.cases.map((c) => c.nLines))} 條線，譜線沒有消失。
        </li>
        <li>
          <strong>1-bit dither 只加在量化器輸入時，limit cycle 原封不動</strong>：最大譜線仍是{' '}
          <Tex>{r`${num(bitS.lines.maxLinePower, 4)}\ \mathrm{LSB}^2`}</Tex>、仍在 <Tex>{r`${d.plainLines.maxLineK}f_u/${P}`}</Tex>，總誤差功率反而升到{' '}
          <Tex>{r`${num(bitS.lines.totalPower, 4)}\ \mathrm{LSB}^2`}</Tex>。原因見下方推導。
        </li>
        <li>
          <strong>1-bit dither 併入殘值時，只是換了一個 limit cycle</strong>：輸出恰好是「目標 <Tex>{r`w_H-\tfrac12=${num(WH.value - 0.5, 4)}`}</Tex> 的無 dither
          循環（週期 {d.shiftedCycle.period}，最大譜線 <Tex>{r`${num(d.shiftedLines.maxLinePower, 4)}\ \mathrm{LSB}^2`}</Tex>）」加上 PRBS 的{' '}
          <Tex>{r`0/1`}</Tex> bit。最大譜線變小是因為換了目標，不是因為被打散。而且 DC 誤差不是 0：最大長度 PRBS 一個週期有 {d.ones} 個 1、
          {d.L - d.ones} 個 0，<Tex>{r`\pm\tfrac12\ \mathrm{LSB}`}</Tex> 的平均是{' '}
          <Tex>{r`\tfrac{${d.ones}-${d.L - d.ones}}{${d.L}}\cdot\tfrac12=${num(imbalance, 4)}\ \mathrm{LSB}`}</Tex>，直接變成 gain 的靜態誤差（表中量到的 DC 誤差{' '}
          <Tex>{r`${num(zero(bitI.lines.dcError), 4)}\ \mathrm{LSB}`}</Tex> 就是它）。
        </li>
        <li>
          <strong>準位夠細的 dither 才真的打散 limit cycle</strong>：7-bit 字讓最大譜線降到{' '}
          <Tex>{r`${num(wordS.lines.maxLinePower, 3)}\ \mathrm{LSB}^2`}</Tex>（<Tex>{r`${num(db10(wordS.lines.maxLinePower / base), 3).replace('−', '-')}\ \mathrm{dB}`}</Tex>
          ）。但總誤差功率沒有變少：輸出只有 32 與 33 兩個 code、平均又恰為 <Tex>{r`${WH.value}`}</Tex> 時，誤差功率必為{' '}
          <Tex>{r`f(1-f)=${num(wordS.lines.totalPower, 4)}\ \mathrm{LSB}^2`}</Tex>；併入殘值時還會用到第三個 code，升到{' '}
          <Tex>{r`${num(wordI.lines.totalPower, 4)}\ \mathrm{LSB}^2`}</Tex>。
        </li>
      </ol>
      <FormulaAnchor id="F-PR.14">
        <StepDerivation
          title={
            <>
              為什麼 <Tex>{r`\pm\tfrac12\ \mathrm{LSB}`}</Tex> 的 1-bit dither 打不散 limit cycle（只加在量化器輸入的接法）
            </>
          }
          steps={[
            {
              tex: r`\xi[n]=b[n]-\tfrac12,\qquad b[n]\in\{0,1\}`,
              why: (
                <>
                  把 <Tex>{r`\pm\tfrac12`}</Tex> 寫成 PRBS 的 <Tex>{'0/1'}</Tex> bit 減 <Tex>{r`\tfrac12`}</Tex>。
                </>
              ),
            },
            {
              tex: r`y[n]=Q\big(v[n]+\xi[n]\big)=\big\lfloor v[n]+b[n]-\tfrac12+\tfrac12\big\rfloor=\lfloor v[n]\rfloor+b[n]`,
              why: (
                <>
                  round-half-up 是加 <Tex>{r`\tfrac12`}</Tex> 再取 floor；整數 <Tex>{'b[n]'}</Tex> 可以直接搬出 floor 外面。
                </>
              ),
            },
            {
              tex: r`r[n]=v[n]-y[n]=\varphi[n]-b[n],\qquad \varphi[n]\equiv v[n]-\lfloor v[n]\rfloor\in[0,1)`,
              why: (
                <>
                  殘值分成小數部分 <Tex>{r`\varphi`}</Tex> 與一個整數 <Tex>{'-b[n]'}</Tex>。
                </>
              ),
            },
            {
              tex: r`v[n]=w_H+r[n-1]=w_H+\varphi[n-1]-b[n-1]\ \Longrightarrow\ \varphi[n]=\mathrm{frac}\big(w_H+\varphi[n-1]\big)`,
              why: (
                <>
                  取小數部分時整數 <Tex>{'b[n-1]'}</Tex> 消失：<Tex>{r`\varphi`}</Tex> 的遞迴裡<strong>完全沒有 dither</strong>，和不加 dither 的 floor 版
                  quantizer 一模一樣。
                </>
              ),
            },
            {
              tex: r`y[n]=\big\lfloor w_H+\varphi[n-1]\big\rfloor-b[n-1]+b[n]=y_{\mathrm{floor}}[n]+\big(b[n]-b[n-1]\big)`,
              why: (
                <>
                  把上一步代回第二步；<Tex>{r`y_{\mathrm{floor}}`}</Tex> 是不加 dither、floor 量化的輸出（循環{' '}
                  <Tex>{`[${d.floorCycle.cycle.join(',')}]`}</Tex>，與上面的循環只差循環移位，譜線相同）。
                </>
              ),
            },
          ]}
          result={r`y[n]=y_{\mathrm{floor}}[n]+b[n]-b[n-1]\quad\Longrightarrow\quad\text{limit cycle 的譜線原封不動，只多出 PRBS 自己的譜線}`}
        />
      </FormulaAnchor>
      <p>
        <ClaimTag kind="exact" />
        （round-half-up、<Tex>{r`r[-1]=0`}</Tex>、令 <Tex>{'b[-1]=0'}</Tex>）。一般化的說法：dither 的各個準位若彼此相差<strong>整數個 LSB</strong>，quantizer
        的小數狀態就完全不受它影響。併入殘值的接法同理可得 <Tex>{r`y[n]=y_{w_H-1/2}[n]+b[n]`}</Tex>（<Tex>{r`y_{w_H-1/2}`}</Tex> 是目標{' '}
        <Tex>{r`w_H-\tfrac12`}</Tex> 的無 dither 輸出）。這兩個恆等式在測試中逐點驗證。
      </p>
      <Hand id="HC-PR.6" />
      <Callout kind="info" title="與 D5 的關係">
        這是本站的簡化模型（一階 EFB、單一 PRBS-7、常數目標），用來說明「週期性 dither 仍產生線譜」與「dither 的接法與準位數很重要」這兩個一般現象。D5 分析的是 digital ΔΣ
        modulator 中 pseudorandom dither 造成的 spurious tones，它的模型、結構與結論細節請讀原文，不要用本站的數字代替。
      </Callout>
    </div>
  )
}

export function d6Data() {
  return ditherCompare({ c: WH.value, n: DITHER_N, seed: DITHER_SEED })
}

/** D6 對應的本站推導：subtractive vs non-subtractive dither 的誤差功率（Ch13）。 */
export function D6Dither() {
  const res = useMemo(d6Data, [])
  const f = WH.value - Math.floor(WH.value)
  const rows: MetricRow[] = [
    {
      name: r`不加 dither：誤差功率 $(Q(c)-c)^2\ [\mathrm{LSB}^2]$（全部在 DC）`,
      value: res.none.power,
      claim: 'exact',
      note: `誤差恆為 $${res.none.mean.toFixed(4)}\\ \\mathrm{LSB}$`,
    },
    {
      name: r`non-subtractive：誤差功率 $f(1-f)\ [\mathrm{LSB}^2]$（MC）`,
      value: res.nonSubtractive.power,
      analytic: res.analytic.nonSubtractivePower,
      tolerance: 4 * res.nonSubtractive.sePower,
      claim: 'exact',
      note: `容許誤差 $=4\\,\\mathrm{SE}$（$\\mathrm{SE}=${texNum(res.nonSubtractive.sePower, 3)}$）`,
    },
    {
      name: 'non-subtractive：平均誤差（MC）',
      value: res.nonSubtractive.mean,
      analytic: 0,
      tolerance: 4 * res.nonSubtractive.seMean,
      unit: 'LSB',
      claim: 'exact',
      note: r`無偏：$E[y]=c$`,
    },
    {
      name: r`subtractive：誤差功率 $\tfrac1{12}\ [\mathrm{LSB}^2]$（MC）`,
      value: res.subtractive.power,
      analytic: res.analytic.subtractivePower,
      tolerance: 4 * res.subtractive.sePower,
      claim: 'exact',
      note: `容許誤差 $=4\\,\\mathrm{SE}$（$\\mathrm{SE}=${texNum(res.subtractive.sePower, 3)}$）`,
    },
    {
      name: 'subtractive：平均誤差（MC）',
      value: res.subtractive.mean,
      analytic: 0,
      tolerance: 4 * res.subtractive.seMean,
      unit: 'LSB',
      claim: 'exact',
    },
  ]
  return (
    <div className="papers-derived">
      <p>
        <SourceTag kind="simulation" /> 常數目標 <Tex>{r`c=w_H=32.4\ \mathrm{LSB}`}</Tex>（小數部分 <Tex>{r`f=${num(f, 4)}`}</Tex>），dither{' '}
        <Tex>{r`\xi\sim\mathcal U(-\tfrac12,\tfrac12)`}</Tex>（RPDF、寬 1 LSB），round-half-up 量化 <Tex>{r`Q(v)=\lfloor v+\tfrac12\rfloor`}</Tex>。Monte Carlo
        用 <Tex>{r`\mathrm{seed}=${DITHER_SEED}`}</Tex>、<Tex>{r`n=${DITHER_N}`}</Tex> 個樣本。
      </p>
      <FormulaAnchor id="F-PR.13">
        <StepDerivation
          title="non-subtractive 與 subtractive dither 的誤差功率"
          steps={[
            {
              tex: r`y=Q(c+\xi)=\big\lfloor c+(\xi+\tfrac12)\big\rfloor,\qquad \xi+\tfrac12\sim\mathcal U(0,1)`,
              why: (
                <>
                  round-half-up 就是加 <Tex>{r`\tfrac12`}</Tex> 再取 floor；均勻分布平移後仍是均勻分布。
                </>
              ),
            },
            {
              tex: r`P\big(y=\lfloor c\rfloor+1\big)=f,\qquad P\big(y=\lfloor c\rfloor\big)=1-f,\qquad f=c-\lfloor c\rfloor`,
              why: (
                <>
                  <Tex>{r`\lfloor c+U\rfloor`}</Tex> 只有兩個值；<Tex>{'U'}</Tex> 超過 <Tex>{'1-f'}</Tex> 時進位，機率是 <Tex>{'f'}</Tex>。
                </>
              ),
            },
            {
              tex: r`E[y]=\lfloor c\rfloor+f=c,\qquad E[(y-c)^2]=f(1-f)^2+(1-f)f^2=f(1-f)`,
              why: '兩點分布：平均無偏；平方誤差加權平均後因式分解。',
            },
            {
              tex: r`\hat y=Q(c+\xi)-\xi\quad\Longrightarrow\quad \hat y-c=Q(v)-v,\qquad v=c+\xi`,
              why: (
                <>
                  subtractive：在輸出端把同一個 <Tex>{r`\xi`}</Tex> 減回去，剩下的就是 <Tex>{'v'}</Tex> 的量化誤差。
                </>
              ),
            },
            {
              tex: r`Q(v)-v\sim\mathcal U\big(-\tfrac12,\tfrac12\big)\ \Longrightarrow\ E[(\hat y-c)^2]=\int_{-1/2}^{1/2}e^2\,de=\frac1{12}`,
              why: (
                <>
                  <Tex>{'v'}</Tex> 的小數部分在一個 LSB 內均勻分布、與 <Tex>{'c'}</Tex> 無關，所以量化誤差也均勻分布。
                </>
              ),
            },
          ]}
          result={r`\text{none: }(Q(c)-c)^2,\qquad \text{non-subtractive: }f(1-f),\qquad \text{subtractive: }\tfrac1{12}\ \ [\mathrm{LSB}^2]`}
        />
      </FormulaAnchor>
      <p>
        第 2、3 步其實就是規格 §13.3 的 stochastic rounding：以機率 <Tex>{r`f=${num(f, 4)}`}</Tex> 輸出 <Tex>{r`${Math.floor(WH.value) + 1}`}</Tex>、否則輸出{' '}
        <Tex>{r`${Math.floor(WH.value)}`}</Tex>，平均 <Tex>{r`${WH.value}`}</Tex>、變異數 <Tex>{r`f(1-f)=${num(res.analytic.nonSubtractivePower, 4)}\ \mathrm{LSB}^2`}</Tex>（驗收項{' '}
        <TestBadge id="T17" />
        ）。
      </p>
      <MetricTable rows={rows} caption="由 src/pages/papers/bridge.ts 的 ditherCompare() 計算；固定 seed 可重現" />
      <BridgeCode region="ditherCompare" />
      <Hand id="HC-PR.7" />
      <ModeGate min="engineer" summary="subtractive dither 的代價在哪裡">
        <Callout kind="warn" title="代價在哪裡（本站的工程解讀）">
          <p>
            <ClaimTag kind="research" /> subtractive 的 <Tex>{r`\tfrac1{12}\ \mathrm{LSB}^2`}</Tex> 不是免費的：「減回 <Tex>{r`\xi`}</Tex>」那一步需要比 1 LSB 更細的解析度。對 6-bit 的 DTC gain
            register 而言，等於要在下游（例如更細的 DTC 步階或更高解析度的數位路徑）實現 <Tex>{r`-\xi`}</Tex>；若做不到，就只能用
            non-subtractive，誤差功率反而比不加 dither 的 DC 誤差還大，只是不再集中在 DC 或單一譜線。D6 如何在 ΔΣ modulator 裡實現 subtractive
            dither，請讀原文。
          </p>
        </Callout>
      </ModeGate>
    </div>
  )
}
