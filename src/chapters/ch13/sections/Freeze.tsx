import { useMemo } from 'react'
import type { Data } from 'plotly.js-dist-min'
import {
  Callout,
  ClaimTag,
  Mermaid,
  ModeGate,
  Plot,
  Prereq,
  Section,
  StepDerivation,
  Tex,
  TexBlock,
  useThemeTokens,
} from '@/components'
import { makeCtx, makeGrid, quantize, toggleK } from '@/simulation/models/quantizer'
import { DEFAULT_LAB_PARAMS, Erratum, Fold, Hand, LSB_FS_EXAMPLE, fx, tx } from '../common'
import { CHART_FREEZE } from '../diagrams'

/** 靜態（DC）誤差 vs w*：A（nearest）、B（L_t = 5 的 pattern 平均）、D（ΔΣ，精確有理數 → 0） */
function staticErrorCurves() {
  const w: number[] = []
  const a: number[] = []
  const b: number[] = []
  const d: number[] = []
  const s = { n: 0, r: 0, wFreeze: 0, overflow: 0, windup: 0 }
  for (let i = 0; i <= 600; i++) {
    const wi = 31 + (3 * i) / 600
    const grid = makeGrid(wi, 'fixed', 16) // 2^-16 的格點足以畫圖
    const ctx = makeCtx(DEFAULT_LAB_PARAMS, grid, 'freeze', 1)
    const y = quantize(grid.W0, s, ctx)
    const { lo, k } = toggleK(grid.represented, 5)
    w.push(wi)
    a.push(y - wi)
    b.push(lo + k / 5 - wi)
    d.push(grid.represented - wi)
  }
  return { w, a, b, d }
}

export function FreezeSection() {
  const tokens = useThemeTokens()
  const curves = useMemo(staticErrorCurves, [])
  const nums = useMemo(() => {
    const grid = makeGrid(32.4, 'rational', 0)
    const y = quantize(grid.W0, { n: 0, r: 0, wFreeze: 0, overflow: 0, windup: 0 }, makeCtx(DEFAULT_LAB_PARAMS, grid, 'freeze', 1))
    const dw = y - 32.4
    return { y, dw, pow: dw * dw, fs: dw * LSB_FS_EXAMPLE }
  }, [])
  const data = useMemo<Data[]>(
    () => [
      { x: curves.w, y: curves.a, name: String.raw`(A) Freeze：$Q(w^*) - w^*$`, line: { color: tokens.series[4], width: 2 } },
      { x: curves.w, y: curves.b, name: String.raw`(B) Toggle $L_t = 5$：平均 $- w^*$`, line: { color: tokens.series[0], width: 1.5, dash: 'dot' } },
      { x: curves.w, y: curves.d, name: String.raw`(D) $\Delta\Sigma$：平均 $- w^*$`, line: { color: tokens.series[1], width: 1.5 } },
    ],
    [curves, tokens],
  )

  return (
    <Section kind="formula" title="§13.1 方法 A：Freeze 在最近的 code" level={2} id="ch13-freeze">
      <p>
        最直覺的做法：LMS 收斂後，把 <Tex>{String.raw`w^*`}</Tex> 四捨五入成最近的整數 code，然後<strong>凍結</strong>（不再改變）。四捨五入這個動作記為{' '}
        <Tex>{String.raw`Q_B(\cdot)`}</Tex>：<Tex>{'B'}</Tex>-bit 量化器，預設是 round-half-up <Tex>{String.raw`\lfloor v+\tfrac12\rfloor`}</Tex>，結果超出 <Tex>{String.raw`[0,\,2^B-1]`}</Tex> 時夾住（saturate）。
      </p>
      <Mermaid
        chart={CHART_FREEZE}
        caption="方法 A 的方塊圖。先看藍色的 latch：只在凍結的瞬間取樣一次，之後 $w_H$ 怎麼變都不看（虛線）；再看右邊：輸出是常數，所以誤差也是常數，全部功率都在 DC。"
      />
      <p className="small ch13-figwalk">
        圖上的 latch 就是程式碼裡的 <code>s.wFreeze</code>；圖上相減點的輸出就是下面公式的 <Tex>{String.raw`e[n]=y-w^*`}</Tex>（也就是 <Tex>{String.raw`\delta w`}</Tex>）。注意整張圖<strong>沒有任何會動的東西</strong>：沒有計數器、沒有亂數、沒有回授——這是它和後面四種方法最大的不同。
      </p>
      <Prereq title="平均、期望值、平方平均與「功率」">
        <p>
          一串數 <Tex>{'e[0],\\dots,e[N-1]'}</Tex> 的平均 <Tex>{String.raw`\overline e=\frac1N\sum e[n]`}</Tex>；平方平均 <Tex>{String.raw`\overline{e^2}=\frac1N\sum e[n]^2`}</Tex>{' '}
          叫做（平均）<strong>功率</strong>。功率可以拆成兩部分：
        </p>
        <TexBlock>{String.raw`\overline{e^2}=\underbrace{\overline e^{\,2}}_{\text{DC 功率}}+\underbrace{\overline{(e-\overline e)^2}}_{\text{變異數（交流功率）}}`}</TexBlock>
        <p>
          證明：展開 <Tex>{String.raw`\overline{(e-\overline e)^2}=\overline{e^2}-2\overline e\cdot\overline e+\overline e^{\,2}=\overline{e^2}-\overline e^{\,2}`}</Tex>。Freeze 的功率全在 DC；後面的 toggle / ΔΣ 則是 DC 為 0、全部在交流。
        </p>
        <p>
          <strong>期望值</strong> <Tex>{'E[X]'}</Tex>：隨機量 <Tex>{'X'}</Tex> 的每個可能值乘上其機率再加總（連續時是 <Tex>{String.raw`\int x\,f(x)\,dx`}</Tex>，<Tex>{'f'}</Tex> 為機率密度），直覺上就是「做很多次的平均」。
          對確定的序列，本章用時間平均 <Tex>{String.raw`\overline e`}</Tex>；Freeze 的誤差是常數，所以 <Tex>{String.raw`E[\delta w^2]=\overline{e^2}=0.16`}</Tex>。§13.3 會再用 Bernoulli 例子詳細練習。
        </p>
      </Prereq>
      <StepDerivation
        title={<>手算：<Tex>{'w^*=32.4'}</Tex> 時的 Freeze</>}
        steps={[
          { tex: String.raw`y=Q_6(w^*)=\lfloor 32.4+0.5\rfloor=${nums.y}`, why: 'round-half-up 的定義（見上方先備知識）。' },
          { tex: String.raw`e[n]=y-w^*=${nums.y}-32.4=${fx(nums.dw, 1)}\,\mathrm{LSB}\quad(\text{每一個 }n)`, why: 'code 不再改變，所以每個時刻的誤差都一樣。' },
          { tex: String.raw`\overline{e}=\frac1N\sum_{n=0}^{N-1}e[n]=${fx(nums.dw, 1)}\,\mathrm{LSB}`, why: '常數的平均就是它自己：這是 static（DC）誤差。' },
          { tex: String.raw`\overline{e^2}=(${fx(nums.dw, 1)})^2=${fx(nums.pow, 2)}\,\mathrm{LSB}^2,\qquad \overline{e^2}-\overline{e}^{\,2}=0`, why: tx(String.raw`總誤差功率 $${fx(nums.pow, 2)}\,\mathrm{LSB}^2$，變異數為 0 $\Rightarrow$ 全部能量都在 DC（$f=0$）。`) },
          { tex: String.raw`\delta w\cdot\Delta_\mathrm{LSB}=${fx(nums.dw, 1)}\times${LSB_FS_EXAMPLE}=${fx(nums.fs, 3)}\,\mathrm{fs}`, why: tx(String.raw`換成時間單位（E13）；依 §0 的 $\delta=a-w$ 則是 $+${fx(-nums.fs, 3)}\,\mathrm{fs}$（E49）。`) },
        ]}
        result={String.raw`\delta w_A=Q_B(w^*)-w^*=${fx(nums.dw, 1)}\,\mathrm{LSB},\qquad E[\delta w_A^2]=${fx(nums.pow, 2)}\,\mathrm{LSB}^2\ (\text{全在 DC})`}
      />
      <TexBlock id="F-13.2">{String.raw`y=Q_B(w^*),\qquad \delta w=y-w^*=${fx(nums.dw, 1)}\,\mathrm{LSB}\;\;(\delta=a-w=+${fx(-nums.dw, 1)}\,\mathrm{LSB})`}</TexBlock>
      <p>
        <ClaimTag kind="exact" /> <Erratum id="E49" /> 規格寫「Static Error 為 <Tex>{String.raw`-0.4\,\mathrm{LSB}`}</Tex>」只在 <Tex>{String.raw`\delta w=w-w^*`}</Tex> 的約定下成立；本章所有表格都同時標出約定。
      </p>
      <Hand id="HC-13.1">
        把 <Tex>{'w^*'}</Tex> 換成別的數（例如 25.5、47.8）、<Tex>{String.raw`\Delta_\mathrm{LSB}`}</Tex> 換成你的 DTC 的值，先用紙筆算出 code、<Tex>{String.raw`\delta w`}</Tex>{' '}
        與換成 fs 的誤差，再對答案；兩種正負號約定（<Tex>{String.raw`\delta w=w-w^*`}</Tex> 與 <Tex>{String.raw`\delta=a-w`}</Tex>）都寫一次。
      </Hand>

      <Callout kind="warn" title="Freeze 的代價：gain 誤差乘上 DSM residue">
        <p>
          DTC 真正注入的 timing error 是 <Tex>{String.raw`\delta t[n]=x[n]\cdot\delta w\cdot\Delta_\mathrm{LSB}`}</Tex>（§12.2）。Freeze 時 <Tex>{String.raw`\delta w`}</Tex>{' '}
          是常數，所以 <Tex>{String.raw`\delta t`}</Tex> 就是 DSM residue <Tex>{'x[n]'}</Tex> 的<strong>縮小版</strong>：<Tex>{'x'}</Tex> 有什麼譜線（fractional spur），<Tex>{String.raw`\delta t`}</Tex>{' '}
          就有同樣頻率的譜線，振幅乘上
          {' '}
          <Tex>{String.raw`|\delta w|\Delta_\mathrm{LSB}=${fx(Math.abs(nums.fs), 3)}\,\mathrm{fs}`}</Tex>（<Tex>{'x'}</Tex> 正規化為 unit RMS 時）。所以 static gain error 不只是「平均偏一點」，而是會產生 periodic
          spurs 的 residual phase error。
        </p>
        <p className="small">
          優點：code 永遠不切換，所以沒有 code toggle noise、沒有 DTC switching glitch（§13.6），也沒有 gain code 本身的譜線。
        </p>
      </Callout>

      <Fold title="深入：Dead zone —— 直接把高解析 accumulator 取整，會發生什麼？">
        <p>
          如果硬體不是「凍結」，而是每次更新都直接 <Tex>{String.raw`y[n]=Q_B(w_H[n])`}</Tex>（無記憶 rounding，沒有誤差回授），那麼任何
          <Tex>{String.raw`w^*\in[31.5,\,32.5)`}</Tex> 都輸出 32：小於半個 LSB 的變化完全看不見，這就是 <strong>dead zone</strong>。
        </p>
        <StepDerivation
          steps={[
            { tex: String.raw`e(w^*)=\mathrm{round}(w^*)-w^*\in[-\tfrac12,\tfrac12)`, why: 'rounding 誤差最多半個 LSB（鋸齒波，見下圖紫線）。' },
            { tex: String.raw`E[e^2]=\int_{-1/2}^{1/2}e^2\,de=\Big[\frac{e^3}{3}\Big]_{-1/2}^{1/2}=\frac1{24}+\frac1{24}=\frac1{12}`, why: tx(String.raw`若 $w^*$ 在一個 LSB 內「平均分布」（PVT 下的未知位置），誤差均勻分布在 $[-\tfrac12,\tfrac12)$，機率密度為 1；期望值 $E[\cdot]$（見上方先備知識）就是這個積分。`) },
            { tex: String.raw`\sigma_e=\frac1{\sqrt{12}}\approx${fx(1 / Math.sqrt(12), 4)}\,\mathrm{LSB}`, why: tx(String.raw`開根號；這是「均勻量化雜訊」$1/12$ 的來源——但對某一顆晶片，誤差是固定值，不是雜訊。`) },
          ]}
        />
        <p>
          PVT 漂移時，Freeze / dead zone 要等 <Tex>{'w^*'}</Tex> 越過 32.5 才會改變 code，所以追蹤能力（§13.5 第 4 點）最差。toggle 把解析度提升到
          <Tex>{String.raw`1/L_t`}</Tex>（<Tex>{'L_t'}</Tex> 是 toggle pattern 的週期，§13.2，圖中取 5；藍點線，誤差 <Tex>{String.raw`\le\frac1{2L_t}=0.1\,\mathrm{LSB}`}</Tex>），而 ΔΣ 的平均在精確算術下完全等於 <Tex>{'w^*'}</Tex>（紅線恆為 0，見 §13.4 的 telescoping）。
        </p>
        <Plot
          title={String.raw`靜態（DC）誤差 vs $w^*$：Freeze 的鋸齒、Toggle 的 $1/L_t$ 階梯、ΔΣ 為 0`}
          ariaLabel="靜態（DC）誤差對理想係數 w* 的關係：Freeze 的鋸齒、Toggle 的階梯、ΔΣ 為 0"
          data={data}
          height={280}
          csvName="ch13-static-error-vs-target"
          layout={{ xaxis: { title: { text: String.raw`$w^*$ [LSB]` } }, yaxis: { title: { text: String.raw`平均 code $- w^*$ [LSB]` } } }}
          caption={
            <>
              由 <code>quantize()</code> 與 <code>toggleK()</code> 逐點計算（<Tex>{'w_H'}</Tex> 用 <Tex>{'F=16'}</Tex> 個小數 bit 的定點格點；<Tex>{'F'}</Tex> 是小數位元數，§13.4）；縱軸採 <Tex>{String.raw`\delta w=w-w^*`}</Tex> 約定（<Tex>{String.raw`\delta=a-w`}</Tex> 則上下顛倒）。
            </>
          }
        />
        <ModeGate min="research">
          <p className="small">
            <ClaimTag kind="exact" /> <Tex>{'1/12'}</Tex> 只有在「<Tex>{'w^*'}</Tex> 在 LSB 內均勻分布」的 ensemble 意義下成立；對固定的 <Tex>{'w^*'}</Tex>，誤差是確定值{' '}
            <Tex>{String.raw`\mathrm{round}(w^*)-w^*`}</Tex>。把它當成白雜訊（並套用 <Tex>{'1/12'}</Tex> 的 PSD）是另一個更強的假設，對常數輸入不成立（見 §13.4、
            <Erratum id="E15" />）。
          </p>
        </ModeGate>
      </Fold>

    </Section>
  )
}
