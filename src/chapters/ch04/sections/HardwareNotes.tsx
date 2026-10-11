import { useMemo, useState, type ReactNode } from 'react'
import type { Data } from 'plotly.js-dist-min'
import { ClaimTag, ParamControl, Plot, Section, StepDerivation, Tex, TexBlock, useThemeTokens } from '@/components'
import { AVERAGE_LOOP, CLEAR_BUG } from '../diagrams'
import { DerivationFold, FigRef, MermaidFig, mt, tx } from '../common'

const R = String.raw

/**
 * 平均模型下「每個 block 清除 S」與「忘了清除」的 δ_k（δ_0 = 1）。
 * 正確：δ_{k+1} = δ_k − gδ_k；忘了清除：δ_{k+1} = δ_k − g·Σ_{j≤k} δ_j。
 */
export function clearVsNoClear(g: number, blocks: number): { k: number[]; clear: number[]; noClear: number[]; radius: number } {
  const k: number[] = []
  const clear: number[] = []
  const noClear: number[] = []
  let dc = 1
  let dn = 1
  let acc = 0
  for (let i = 0; i <= blocks; i++) {
    k.push(i)
    clear.push(dc)
    noClear.push(dn)
    dc = dc - g * dc
    acc += dn
    dn = dn - g * acc
  }
  // z² − (2 − g)z + 1 = 0 的根的模（0 < g < 4 時為 1）
  const disc = (2 - g) ** 2 - 4
  const radius = disc < 0 ? 1 : Math.max(Math.abs((2 - g + Math.sqrt(disc)) / 2), Math.abs((2 - g - Math.sqrt(disc)) / 2))
  return { k, clear, noClear, radius }
}

const NOCLEAR_LAYOUT = { xaxis: { title: { text: R`block $k$` } }, yaxis: { title: { text: R`$E[\delta_k]/\delta_0$` } } }

const ITEMS: { n: number; title: ReactNode; wrong: ReactNode; check: ReactNode; here: string }[] = [
  {
    n: 1,
    title: mt(R`Comparator polarity（0/1 → $\pm1$、PD 正負）`),
    wrong: (
      <>
        忘了 <Tex>{R`q=2b-1`}</Tex>：增益 <Tex>{R`\times\tfrac12`}</Tex>、偏差約 <Tex>{R`E[x_\mathrm{ref}]/K`}</Tex>（單邊 code 時根本沒有固定點）；PD 極性反了：pole <Tex>{R`1+\mu K>1`}</Tex>，平均誤差發散
      </>
    ),
    check: mt(R`freeze 迴路，對 $w$ 加 $\pm\Delta w$，量 $S_\mathrm{GMAC}=(G_+-G_-)/(2\Delta w)$ 的正負號`),
    here: '§4、gmac-bit-encoding 實驗',
  },
  {
    n: 2,
    title: mt(R`Time / code alignment（誤差 $n$ 對應 code $n-D$）`),
    wrong: (
      <>
        錯 <Tex>D</Tex> 個 sample：<Tex>{R`C_D=E[x[n-D]\,u[n]]`}</Tex> 可能變小甚至變號
      </>
    ),
    check: mt(R`掃 $D$、量 $C_D$；mode 切換後重新對齊`),
    here: 'Ch07（delay alignment / filtered-x）',
  },
  {
    n: 3,
    title: 'GMAC accumulator bits',
    wrong: (
      <>
        <Tex>{R`B_\mathrm{acc}<1+\lceil\log_2(NM_x+1)\rceil`}</Tex>（F-04.9）：開機時 wrap、變號；在 <Tex>{R`B_x`}</Tex> bits 內取負：最負 code 的乘積變號，<Tex>{R`w^*-a\approx-p_\mathrm{min}/K`}</Tex>（F-04.15）
      </>
    ),
    check: mt(R`最壞情況 + 開機（$|\delta|\gg\sigma_v$）模擬；bit-true 比對`),
    here: '§4、§5.1、§5.4、gmac-fixed-point 面板 A / C',
  },
  {
    n: 4,
    title: mt(R`GMAC sum vs average（右移與 $\mu$ 的 scaling）`),
    wrong: (
      <>
        同一個 <Tex>{R`\mu`}</Tex> 但少了 <Tex>{R`\div N`}</Tex>：<Tex>{R`g_\mathrm{sum}=Ng_\mathrm{avg}`}</Tex>
      </>
    ),
    check: mt(R`量 step response 的 pole，與 $1-\mu K$ 比較；文件寫清楚 $\mu$ 的意義`),
    here: '§4、gmac-signal-flow（A/B/C）',
  },
  {
    n: 5,
    title: 'Rounding / truncation',
    wrong: (
      <>
        floor：<Tex>{R`w^*-a\approx-(1-2^{-\ell})\Delta_G/(2K)`}</Tex>，與 <Tex>{R`\mu`}</Tex> 無關
      </>
    ),
    check: '同 seed 的定點 vs 浮點 paired 模擬；量平均差',
    here: '§5.3、gmac-fixed-point 面板 B / C',
  },
  {
    n: 6,
    title: 'Quantized calibration state（內部小數 vs 實體 code）',
    wrong: (
      <>
        <Tex>W</Tex> 的小數位元不夠（LSB <Tex>{R`\Delta_W`}</Tex> 太粗）且更新量用 floor 對齊：<Tex>{R`w^*-a\approx-\Delta_W/(2g)`}</Tex>，<Tex>{R`\mu`}</Tex> 越小越糟（F-04.18）；實體 gain 只有幾個 bit：limit cycle、dead zone、spur
      </>
    ),
    check: mt(R`$\Delta_W\le2g\,\delta_\mathrm{tol}$ 或 half-even；把 $\mu$ 減半看偏差是否加倍；實體量化策略（$\Delta\Sigma$ / dither）`),
    here: '§5.6、gmac-fixed-point「第二個截斷點」preset；實體 code 的量化見 Ch13',
  },
  {
    n: 7,
    title: 'Update enable 與 block boundary',
    wrong: (
      <>
        最後一筆沒算進來（gain <Tex>{R`\times(N-1)/N`}</Tex>）；<strong>忘了清除 S</strong>：迴路變成無阻尼振盪器
      </>
    ),
    check: 'RTL sim 數每個 block 的 sample 數；clear / commit / reset 的 cycle 對齊；bit-true 比對',
    here: '本節下方推導',
  },
  {
    n: 8,
    title: 'Saturation / anti-windup',
    wrong: (
      <>
        只在輸出 clamp：<Tex>W</Tex> 越積越深，回復時間 <Tex>{R`\approx(W_\mathrm{peak}-w_\mathrm{max})/(\mu K|a'-w_\mathrm{max}|)`}</Tex>（F-04.12）；<Tex>W</Tex> wrap：gain 從一個 rail 跳到另一個
      </>
    ),
    check: mt(R`讓 $a$ 先超出範圍再回來，量回復時間並與 F-04.12 比較`),
    here: '§5.5、gmac-fixed-point「anti-windup」preset',
  },
]

export function HardwareNotesSection() {
  const [g, setG] = useState(0.2)
  const tokens = useThemeTokens()
  const r = useMemo(() => clearVsNoClear(g, 80), [g])
  const data = useMemo<Data[]>(
    () => [
      { x: r.k, y: r.clear, name: R`每個 block 清除 $S$（正確）`, mode: 'lines+markers', marker: { size: 3 }, line: { color: tokens.series[0] } },
      { x: r.k, y: r.noClear, name: R`忘了清除 $S$`, mode: 'lines+markers', marker: { size: 3 }, line: { color: tokens.series[1] } },
    ],
    [r, tokens],
  )
  const theta = g > 0 && g < 4 ? Math.acos((2 - g) / 2) : NaN
  return (
    <Section kind="assumptions" title="§6 RTL 檢查清單（規格 §16.1 第 1–8 項）" level={2} id="ch04-notes">
      <p>
        規格 §16.1 列出 RTL 必須檢查的硬體細節。前 8 項都和本章的訊號流直接相關；下表把每一項「錯了會怎樣」寫成數學，並指出在哪裡可以親手看到。
        第 9–12 項（CDC、lock / reacquire、injection modes、noise tracing）見 Behavioral Models & RTL 頁。
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>項目</th>
              <th>錯了會怎樣</th>
              <th>怎麼檢查</th>
              <th>本站對應</th>
            </tr>
          </thead>
          <tbody>
            {ITEMS.map((it) => (
              <tr key={it.n}>
                <td className="num">{it.n}</td>
                <td>
                  <strong>{it.title}</strong>
                </td>
                <td className="small">{it.wrong}</td>
                <td className="small">{it.check}</td>
                <td className="small">{it.here}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>
        第 7 項：忘了在 block 邊界清除 <Tex>S</Tex>
      </h3>
      <p>
        如果 <Tex>S</Tex> 沒有在每個 block 結束時清為 0，第 <Tex>k</Tex> 次更新用到的是 <Tex>{R`S_0+S_1+\dots+S_k`}</Tex>。看起來只是「多累加了一點」，
        其實把迴路從一階變成二階，而且<strong>對任何 <Tex>{R`\mu`}</Tex> 都不會收斂</strong>。
      </p>
      <MermaidFig
        chart={CLEAR_BUG}
        caption={R`忘了清除 $S$ 的後果：GMAC 累加器自己變成第二個積分器（紅色）。左欄是正確的一階迴路，右欄多串了一個 $1/(1-z^{-1})$；看兩欄最下面那一格的遞迴式差在哪裡。`}
        ariaLabel="正確清除 S 的一階迴路，與忘了清除 S 時兩個積分器串接的二階迴路"
      />
      <p>
        兩欄畫的都是 <FigRef chart={AVERAGE_LOOP} /> 的順向路徑（由 gain 誤差 <Tex>{R`\delta_k`}</Tex> 到 <Tex>{R`w_k`}</Tex>；回授同樣是 <Tex>{R`\delta=a-w`}</Tex>，沒有重畫）。<strong>先看左欄</strong>：<Tex>{R`\delta_k`}</Tex> 乘 <Tex>K</Tex>、乘{' '}
        <Tex>{R`\mu`}</Tex>，經過 gain accumulator 這<strong>一個</strong>積分器，得到一階遞迴 <Tex>{R`\delta_{k+1}=(1-g)\,\delta_k`}</Tex>（<Tex>{R`g=\mu K`}</Tex>）。<strong>再看右欄</strong>的紅色方塊：<Tex>S</Tex>{' '}
        沒清除，它輸出的是從開機到現在所有 block 的總和 <Tex>{R`S_0+S_1+\dots+S_k`}</Tex>——這正是一個累加器 <Tex>{R`1/(1-z^{-1})`}</Tex>。兩個積分器串在同一個迴路裡，相位落後加起來是 180°，
        回授永遠來得太晚；右欄最下面的二階遞迴式就是下面的 F-04.13，它的特徵方程兩根都落在單位圓上（不衰減也不發散的邊界）。
      </p>
      <DerivationFold title="累積總和讓 pole 落在單位圓上">
        <StepDerivation
          steps={[
            { tex: R`w_{k+1}=w_k+\frac{\mu}{N}\sum_{j=0}^{k}S_j\;\Rightarrow\;\delta_{k+1}=\delta_k-g\sum_{j=0}^{k}\delta_j`, why: mt(R`取平均並代入 $E[S_j]=NK\delta_j$，$g=\mu K$。`) },
            { tex: R`\delta_{k+1}-\delta_k=-g\,\Sigma_k,\qquad\Sigma_k:=\sum_{j=0}^{k}\delta_j`, why: mt(R`把累積和記成 $\Sigma_k$（大寫，避免和雜訊的 $\sigma$ 混淆）。`) },
            { tex: R`(\delta_{k+1}-\delta_k)-(\delta_k-\delta_{k-1})=-g(\Sigma_k-\Sigma_{k-1})=-g\,\delta_k`, why: mt(R`把相鄰兩個 $k$ 的式子相減，$\Sigma_k-\Sigma_{k-1}=\delta_k$。`) },
            { tex: R`\delta_{k+1}-(2-g)\,\delta_k+\delta_{k-1}=0`, why: '整理成二階線性遞迴。' },
            { tex: R`z^2-(2-g)z+1=0\;\Rightarrow\;z_1z_2=1`, why: mt(R`令 $\delta_k=z^k$；兩根之積等於常數項 1。`) },
            { tex: R`0<g<4:\;z_{1,2}=e^{\pm j\theta},\;\cos\theta=1-\tfrac g2,\;|z|=1`, why: mt(R`判別式 $(2-g)^2-4=g(g-4)<0\Rightarrow$ 共軛複根，模為 $\sqrt{z_1z_2}=1$：無阻尼振盪，週期 $2\pi/\theta$ 個 block。`) },
            { tex: R`g=4:\;z_1=z_2=-1;\qquad g>4:\;z_1z_2=1\text{ 且兩根為相異實數}\Rightarrow|z_1|>1>|z_2|`, why: mt(R`$g=4$ 是單位圓上的重根，解含 $k(-1)^k$ 項，線性成長；$g>4$ 時一根在圓外，指數發散。所以 $g\ge4$ 都發散。`) },
          ]}
          result={R`\text{沒有任何 }\mu>0\text{ 能讓 }E[\delta_k]\to0`}
        />
        <p className="small">
          <ClaimTag kind="exact" /> 在平均線性模型下精確（F-04.13）。實際的 sign-LMS 加上雜訊後是一個在 <Tex>a</Tex> 附近大幅擺盪、永不收斂的迴路。
        </p>
      </DerivationFold>
      <TexBlock id="F-04.13" label="忘了清除 GMAC accumulator：無阻尼振盪">
        {R`\delta_{k+1}-(2-g)\,\delta_k+\delta_{k-1}=0\;\Rightarrow\;z^2-(2-g)z+1=0,\;|z_{1,2}|=1\;(0<g<4)`}
      </TexBlock>
      <div className="ch04-mini">
        <ParamControl label={mt(R`$g=\mu K$（正規化 loop gain）`)} ariaLabel="g = μK（正規化 loop gain）" value={g} onChange={setG} min={0.001} max={3.99} step={0.001} reg="behavioral: normalized loop gain" />
        <Plot
          title={R`平均誤差 $E[\delta_k]/\delta_0$（$g=${tx(g, 4)}$；忘了清除時 $|z|=${tx(r.radius, 4)}$、振盪週期 $2\pi/\theta=${tx((2 * Math.PI) / theta, 4)}$ blocks）`}
          data={data}
          layout={NOCLEAR_LAYOUT}
          height={260}
          csvName="ch04-noclear"
          caption="由平均模型遞迴直接計算（不是 Monte Carlo）。"
        />
      </div>
      <p className="small">
        另一個常見的 block 邊界錯誤是 off-by-one：只累加 <Tex>{R`N-1`}</Tex> 筆卻仍右移 <Tex>{R`\log_2N`}</Tex>，等效增益變成 <Tex>{R`(N-1)/N`}</Tex>（可忽略）；
        但若多累加了下一個 block 的第一筆，而那一筆已經用了新的 <Tex>w</Tex>，就相當於 §3 的分數延遲。
      </p>
    </Section>
  )
}
