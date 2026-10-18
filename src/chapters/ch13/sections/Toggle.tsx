import { useMemo } from 'react'
import type { Data } from 'plotly.js-cartesian-dist-min'
import {
  Callout,
  ClaimTag,
  Mermaid,
  Plot,
  Prereq,
  Section,
  StepDerivation,
  Tex,
  TexBlock,
  useThemeTokens,
} from '@/components'
import { lineSpectrum, toggleCycle, zohGain2, zohLines } from '@/simulation/models/quantizer'
import { Erratum, Fold, Hand, db, fx, tx } from '../common'
import { CHART_TOGGLE, CHART_TOGGLE_SPECTRUM, CHART_ZOH } from '../diagrams'

export function ToggleSection() {
  const tokens = useThemeTokens()
  const r = useMemo(() => {
    const spread = toggleCycle(32.4, 5, 'spread')
    const clustered = toggleCycle(32.4, 5, 'clustered')
    const eS = spread.map((y) => y - 32.4)
    const eC = clustered.map((y) => y - 32.4)
    const lS = lineSpectrum(eS)
    const lC = lineSpectrum(eC)
    const parseval = eS.reduce((a, x) => a + x * x, 0) / 5
    const zoh = zohLines(eS, 64, 8)
    // Parseval 檢查：N_h = 64 時所有 k = 1 … 5·64/2 的 ZOH 線功率總和（應等於時域功率）
    const zohTotal = zohLines(eS, 64, 5 * 64).reduce((a, l) => a + l.power, 0)
    const rows: { n: number; y: number; e: number; cum: number; mean: number }[] = []
    let cum = 0
    spread.forEach((y, i) => {
      cum += y
      rows.push({ n: i, y, e: y - 32.4, cum, mean: cum / (i + 1) })
    })
    return { lS, lC, parseval, zoh, zohTotal, rows }
  }, [])

  const barData = useMemo<Data[]>(
    () => [
      {
        type: 'bar',
        x: [0.2, 0.4],
        y: [r.lS[1].power, r.lS[2].power],
        name: 'spread [32,32,33,32,33]',
        marker: { color: tokens.series[0] },
      },
      {
        type: 'bar',
        x: [0.2, 0.4],
        y: [r.lC[1].power, r.lC[2].power],
        name: 'clustered [32,32,32,33,33]',
        marker: { color: tokens.series[3] },
      },
    ],
    [r, tokens],
  )

  return (
    <Section kind="formula" title="§13.2 方法 B：在 32 與 33 之間週期切換" level={2} id="ch13-toggle">
      <p>
        想要平均 32.4，就讓 5 次裡有 2 次輸出 33、3 次輸出 32。規格用的序列是 <Tex>{String.raw`[32,32,33,32,33]`}</Tex>。把 <Tex>{'w^*'}</Tex> 拆成整數部分{' '}
        <Tex>{String.raw`\lfloor w^*\rfloor=32`}</Tex> 與小數部分 <Tex>{String.raw`p=\mathrm{frac}(w^*)=0.4`}</Tex>：<Tex>{'p'}</Tex> 就是「有多少比例的時間要輸出上面那一階」。
      </p>
      <Mermaid
        chart={CHART_TOGGLE}
        caption="方法 B 的方塊圖。先看最上面：$w_H$ 被拆成整數 32 與小數 $p$，$p$ 決定一個週期裡要進位幾次；再看藍色兩塊：一個計數器加一個固定的 pattern。整張圖沒有從輸出拉回來的線（開迴路）。"
      />
      <p className="small ch13-figwalk">
        圖上的 <Tex>{'L_t'}</Tex> 是 pattern 的週期（本例 5）、<Tex>{'h'}</Tex> 是一個週期裡「進位」（輸出 33）的次數、<Tex>{String.raw`n'=n\bmod L_t`}</Tex> 是這一拍在 pattern 裡的位置（計數器的值）、<Tex>{'s[n]'}</Tex> 是每一拍的進位指示（0 或 1）。圖中把 <Tex>{'w_H'}</Tex> 當成常數 <Tex>{String.raw`w^*=32.4`}</Tex>。圖上 pattern 方塊裡的式子就是下面公式 F-13.3 的{' '}
        <Tex>{String.raw`\lfloor(n'+1)h/L_t\rfloor-\lfloor n'h/L_t\rfloor`}</Tex>，輸出 <Tex>{String.raw`y[n]=\lfloor w^*\rfloor+s[n]`}</Tex>。因為沒有回授，這個電路不知道自己的平均對不對：<Tex>{'pL_t'}</Tex> 不是整數時就會留下 static error。
      </p>
      <p>先手算平均：</p>
      <div className="table-wrap">
        <table className="ch13-table" aria-label="toggle pattern 的逐點手算：code、誤差、累積和與到目前的平均">
          <thead>
            <tr>
              <th>
                <Tex>{'n'}</Tex>
              </th>
              <th>
                <Tex>{'y[n]'}</Tex>
              </th>
              <th>
                <Tex>{'e[n]=y[n]-32.4'}</Tex>
              </th>
              <th>
                累積和 <Tex>{String.raw`\sum_{m\le n}y[m]`}</Tex>
              </th>
              <th>到目前的平均</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((row) => (
              <tr key={row.n}>
                <td>{row.n}</td>
                <td>{row.y}</td>
                <td>{fx(row.e, 1)}</td>
                <td>{row.cum}</td>
                <td>{fx(row.mean, 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TexBlock>{String.raw`\overline{w}=\frac{3\cdot32+2\cdot33}{5}=\frac{162}{5}=32.4\qquad(\text{DC 誤差}=0)`}</TexBlock>
      <p>
        <ClaimTag kind="exact" /> 平均完全正確。但「到目前的平均」在 32 與 32.4 之間擺動，每 5 個 sample 才回到 32.4：這個<strong>週期性</strong>就是頻譜上的譜線。
      </p>

      <Fold title="這個 pattern 怎麼產生？Bresenham（均勻分散）公式">
        <p>
          令 <Tex>{String.raw`L_t=5`}</Tex> 為 pattern 週期、<Tex>{String.raw`h=\mathrm{round}(pL_t)=\mathrm{round}(0.4\times5)=2`}</Tex> 為「進位」次數，把 <Tex>{'h'}</Tex> 個 1 盡量平均地撒在 <Tex>{'L_t'}</Tex> 個位置：
        </p>
        <TexBlock id="F-13.3">{String.raw`y[n]=\lfloor w^*\rfloor+\Big\lfloor\frac{(n'+1)h}{L_t}\Big\rfloor-\Big\lfloor\frac{n'h}{L_t}\Big\rfloor,\qquad n'=n\bmod L_t`}</TexBlock>
        <StepDerivation
          steps={[
            { tex: String.raw`n'=0:\ \lfloor 2/5\rfloor-\lfloor 0\rfloor=0-0=0`, why: tx(String.raw`代入 $h=2$、$L_t=5$。`) },
            { tex: String.raw`n'=1:\ \lfloor 4/5\rfloor-\lfloor 2/5\rfloor=0-0=0`, why: '同上。' },
            { tex: String.raw`n'=2:\ \lfloor 6/5\rfloor-\lfloor 4/5\rfloor=1-0=1`, why: tx(String.raw`累積的 $n'h/L_t$ 越過一個整數 $\Rightarrow$ 進位一次。`) },
            { tex: String.raw`n'=3:\ \lfloor 8/5\rfloor-\lfloor 6/5\rfloor=1-1=0`, why: '同上。' },
            { tex: String.raw`n'=4:\ \lfloor 10/5\rfloor-\lfloor 8/5\rfloor=2-1=1`, why: tx(String.raw`一個週期內的進位總數 $=\lfloor L_th/L_t\rfloor=h=2$（相鄰項相消）。`) },
          ]}
          result={String.raw`y=[32,32,33,32,33]`}
        />
        <p>
          差分的和會「伸縮相消」：<Tex>{String.raw`\sum_{n'=0}^{L_t-1}(\lfloor (n'+1)h/L_t\rfloor-\lfloor n'h/L_t\rfloor)=h`}</Tex>，所以平均恆為{' '}
          <Tex>{String.raw`\lfloor w^*\rfloor+h/L_t`}</Tex>。當 <Tex>{String.raw`pL_t`}</Tex> 不是整數時（例如 <Tex>{'w^*=32.43'}</Tex>），平均只能到 <Tex>{'1/L_t'}</Tex> 的解析度：static error{' '}
          <Tex>{String.raw`|h/L_t-p|\le 1/(2L_t)`}</Tex>。
        </p>
      </Fold>
      <Hand id="HC-13.2">
        換一個 <Tex>{'w^*'}</Tex> 或 <Tex>{'L_t'}</Tex>（例如 <Tex>{'w^*=32.45'}</Tex>、<Tex>{'L_t=8'}</Tex>），先自己算出進位次數 <Tex>{'h'}</Tex>、逐格寫出 pattern，再算平均與 DC 誤差——看看{' '}
        <Tex>{'pL_t'}</Tex> 不是整數時會留下多少 static error。
      </Hand>

      <h3>
        頻譜：平均正確 <Tex>{String.raw`\ne`}</Tex> 頻譜理想（勘誤 E47）
      </h3>
      <p>
        把誤差 <Tex>{String.raw`e[n]=y[n]-32.4=[-0.4,-0.4,0.6,-0.4,0.6]`}</Tex> 看成週期 5 的訊號。週期訊號只會在{' '}
        <Tex>{String.raw`f=k\,f_u/5`}</Tex> 有能量（離散譜線）。規格說「<Tex>{String.raw`f_\mathrm{toggle}/5`}</Tex> 及其諧波」，但 <Tex>{String.raw`f_\mathrm{toggle}`}</Tex> 沒有定義；本章令 <Tex>{'f_u'}</Tex> 為{' '}
        <strong>6-bit code 的更新率</strong>（
        <Erratum id="E47" />）。
      </p>
      <Mermaid
        chart={CHART_TOGGLE_SPECTRUM}
        caption={String.raw`週期 5 的誤差怎麼變成兩條譜線。先看中間三個分支：$k=0$ 是平均（0），$k=1$ 與 $4$、$k=2$ 與 $3$ 各自合成一條實頻率的譜線；再看最下面：兩條線的功率相加剛好是時域的 $0.24\,\mathrm{LSB}^2$，紅色那條（$2f_u/5$）才是主 spur。`}
      />
      <p className="small ch13-figwalk">
        圖上的 <Tex>{'c_k'}</Tex> 是誤差在頻率 <Tex>{String.raw`kf_u/5`}</Tex> 的成分（傅立葉係數，定義見下面的先備知識），就是公式裡的 <Tex>{String.raw`c_k=\tfrac15\sum_n e[n]e^{-j2\pi kn/5}`}</Tex>；圖上的 <Tex>{String.raw`\times2`}</Tex> 就是線功率{' '}
        <Tex>{String.raw`P_k=2|c_k|^2`}</Tex> 裡的 2（正、負頻率各一份）。下面的推導就是照著圖由上往下算一次。
      </p>
      <Prereq title="複數指數、週期序列的 DFT 與 Parseval">
        <p>
          Euler 公式：<Tex>{String.raw`e^{j\theta}=\cos\theta+j\sin\theta`}</Tex>，所以 <Tex>{String.raw`\cos\theta=\frac{e^{j\theta}+e^{-j\theta}}2`}</Tex>、
          <Tex>{String.raw`|e^{j\theta}|=1`}</Tex>。週期 <Tex>{'q'}</Tex> 的序列可以寫成 <Tex>{'q'}</Tex> 個複數正弦的和（離散傅立葉級數）：
        </p>
        <TexBlock>{String.raw`e[n]=\sum_{k=0}^{q-1}c_k\,e^{j2\pi kn/q},\qquad c_k=\frac1q\sum_{n=0}^{q-1}e[n]\,e^{-j2\pi kn/q}`}</TexBlock>
        <p>
          <Tex>{'c_k'}</Tex> 就是頻率 <Tex>{String.raw`f=kf_u/q`}</Tex> 的成分。<Tex>{'e'}</Tex> 是實數時 <Tex>{String.raw`c_{q-k}=\overline{c_k}`}</Tex>（共軛），正負頻率合起來是一條 <Tex>{String.raw`2|c_k|\cos(2\pi kn/q+\angle c_k)`}</Tex> 的實弦波，其功率（平方平均）為 <Tex>{String.raw`(2|c_k|)^2/2=2|c_k|^2`}</Tex>。Parseval 定理：<Tex>{String.raw`\frac1q\sum_n|e[n]|^2=\sum_k|c_k|^2`}</Tex>，也就是「時域功率 = 各頻率功率的和」。
        </p>
      </Prereq>
      <StepDerivation
        title="一步一步算譜線（只用等比級數與 Euler 公式）"
        steps={[
          { tex: String.raw`c_k=\frac15\sum_{n=0}^{4}e[n]\,e^{-j2\pi kn/5}`, why: '週期 5 序列的離散傅立葉係數（定義，見上方先備知識）。' },
          { tex: String.raw`e[n]=-0.4+s[n],\qquad s=[0,0,1,0,1]`, why: tx(String.raw`把誤差拆成常數 $-0.4$ 加上「進位指示」$s[n]$。`) },
          { tex: String.raw`\sum_{n=0}^{4}e^{-j2\pi kn/5}=\frac{1-e^{-j2\pi k}}{1-e^{-j2\pi k/5}}=0\quad(k=1,2,3,4)`, why: tx(String.raw`等比級數求和；分子 $e^{-j2\pi k}=1$，所以常數項對 $k\ne0$ 沒有貢獻。`) },
          { tex: String.raw`c_k=\frac15\big(e^{-j2\pi k\cdot2/5}+e^{-j2\pi k\cdot4/5}\big)`, why: tx(String.raw`只剩 $s[n]=1$ 的兩項（$n=2,4$）。`) },
          { tex: String.raw`c_k=\frac15e^{-j6\pi k/5}\big(e^{j2\pi k/5}+e^{-j2\pi k/5}\big)=\frac25\cos\!\Big(\frac{2\pi k}{5}\Big)e^{-j6\pi k/5}`, why: tx(String.raw`提出兩個指數的「中點」$e^{-j2\pi k\cdot3/5}$，再用 Euler：$e^{j\theta}+e^{-j\theta}=2\cos\theta$。`) },
          { tex: String.raw`|c_1|=\tfrac25\cos72^\circ=${fx(r.lS[1].mag, 6)}=\tfrac{\sqrt5-1}{10},\qquad |c_2|=\tfrac25|\cos144^\circ|=${fx(r.lS[2].mag, 6)}=\tfrac{\sqrt5+1}{10}`, why: tx(String.raw`取絕對值（$|e^{-j\phi}|=1$）；$\cos72^\circ=(\sqrt5-1)/4$ 是黃金比例的三角恆等式。`) },
          { tex: String.raw`P_1=2|c_1|^2=${fx(r.lS[1].power, 5)},\qquad P_2=2|c_2|^2=${fx(r.lS[2].power, 5)}\ \ \mathrm{LSB}^2`, why: tx(String.raw`實數序列 $c_{5-k}=\overline{c_k}$ $\Rightarrow$ $k$ 與 $5-k$ 是同一條實頻率的正負兩邊，one-sided 線功率要乘 2。`) },
          { tex: String.raw`P_1+P_2=${fx(r.lS[1].power + r.lS[2].power, 5)}=\frac15\sum e[n]^2=\frac{3(0.16)+2(0.36)}{5}=${fx(r.parseval, 5)}`, why: 'Parseval：各譜線功率的和 = 時域平均功率（檢查計算沒錯）。' },
        ]}
        result={String.raw`P(f_u/5)=${fx(r.lS[1].power, 5)}\,\mathrm{LSB}^2,\quad P(2f_u/5)=${fx(r.lS[2].power, 5)}\,\mathrm{LSB}^2,\quad \text{總和}=p(1-p)=${fx(r.parseval, 2)}`}
      />
      <TexBlock id="F-13.4">{String.raw`c_k=\frac1q\sum_{n=0}^{q-1}e[n]e^{-j2\pi kn/q},\qquad P_k=2|c_k|^2\ (0<k<q/2),\qquad \sum_kP_k=\frac1q\sum_ne[n]^2`}</TexBlock>
      <Callout kind="ok" title="重點（勘誤 E47）">
        主 Spur 在 <strong><Tex>{String.raw`2f_u/5`}</Tex></strong>，比 <Tex>{String.raw`f_u/5`}</Tex> 高 {db(r.lS[2].power / r.lS[1].power)} dB；<Tex>{String.raw`f_u/5`}</Tex> 只佔總功率的{' '}
        {fx((100 * r.lS[1].power) / r.parseval, 1)}%。在以 <Tex>{'f_u'}</Tex> 取樣的離散時間裡只有這兩條獨立譜線（<Tex>{String.raw`k=3,4`}</Tex> 是 <Tex>{String.raw`k=2,1`}</Tex> 的鏡像）。同樣 3 個 32、2 個 33，換成 clustered 排列 <Tex>{'[32,32,32,33,33]'}</Tex> 會把 <Tex>{String.raw`${fx(r.lC[1].power, 5)}\,\mathrm{LSB}^2`}</Tex> 移到 <Tex>{String.raw`f_u/5`}</Tex>（下圖）。 <ClaimTag kind="exact" />
      </Callout>
      <Plot
        title={String.raw`Toggle 誤差的譜線功率（以 $f_u$ 取樣）`}
        ariaLabel="Toggle 誤差的譜線功率（以 code 更新率 f_u 取樣）"
        data={barData}
        height={260}
        csvName="ch13-toggle-lines"
        layout={{
          barmode: 'group',
          xaxis: { title: { text: String.raw`$f / f_u$` }, tickvals: [0.2, 0.4], ticktext: [String.raw`$f_u/5$`, String.raw`$2f_u/5$`] },
          yaxis: { title: { text: String.raw`線功率 [$\mathrm{LSB}^2$]` } },
        }}
        caption={
          <>
            由 <code>lineSpectrum()</code>（一個週期的精確 DFT）計算。兩種排列的總功率都是 <Tex>{String.raw`${fx(r.parseval, 2)}\,\mathrm{LSB}^2`}</Tex>，只是分配不同。
          </>
        }
      />

      {/* 不放在 ModeGate 內：F-13.5 的錨點在所有模式都要存在（Beginner 時 Fold 預設收合） */}
      <Fold title={<>code 以 ZOH 保持到更快的取樣率時：<Tex>{String.raw`\mathrm{sinc}^2`}</Tex> 權重（勘誤 E47）</>}>
        <p>
          若 code 以 <Tex>{'f_u'}</Tex> 更新，但 DTC 以 <Tex>{String.raw`f_s=N_hf_u`}</Tex> 取樣（每個 code 保持 <Tex>{'N_h'}</Tex> 個 reference cycle；<Tex>{'N_h'}</Tex> 就是實驗裡的 <Tex>{String.raw`N_\mathrm{upd}`}</Tex>），保持（zero-order hold）會把譜線複製到所有 <Tex>{String.raw`k f_u/5`}</Tex>（<Tex>{String.raw`k\ne5m`}</Tex>），並乘上離散 <Tex>{String.raw`\mathrm{sinc}^2`}</Tex> 權重：
        </p>
        <Mermaid
          chart={CHART_ZOH}
          caption="code 更新得比 DTC 取樣慢時。先看藍色的 ZOH：同一個 code 被重複 $N_h$ 次；再看下面兩支：左支是譜線被複製到所有 $k f_u/5$，右支是每一條乘上離散 sinc 的平方，$k$ 是 5 的倍數時剛好落在零點。"
        />
        <p className="small ch13-figwalk">
          注意兩個索引：圖上的 <Tex>{'e[n]'}</Tex> 以「第幾次 code 更新」<Tex>{'n'}</Tex> 為索引（取樣率 <Tex>{'f_u'}</Tex>），<Tex>{'z[m]'}</Tex> 以「第幾個 reference cycle」<Tex>{'m'}</Tex> 為索引（取樣率 <Tex>{'f_s'}</Tex>）。圖上的{' '}
          <Tex>{'G_k'}</Tex> 就是下面公式的權重，圖上的 <Tex>{'P_k'}</Tex> 就是 <Tex>{String.raw`P_k^{\mathrm{ZOH}}`}</Tex>。
        </p>
        <TexBlock id="F-13.5">{String.raw`P_k^{\mathrm{ZOH}}=2|c_{k\bmod 5}|^2\,G_k^2,\qquad G_k=\frac{\sin(\pi k/5)}{N_h\sin(\pi k/(5N_h))}`}</TexBlock>
        <StepDerivation
          title={<>推導 <Tex>{String.raw`\mathrm{sinc}^2`}</Tex> 權重（等比級數 + Euler）</>}
          steps={[
            { tex: String.raw`z[m]=e\big[\lfloor m/N_h\rfloor\big],\qquad c'_k=\frac1{5N_h}\sum_{m=0}^{5N_h-1}z[m]\,e^{-j2\pi km/(5N_h)}`, why: tx(String.raw`保持後的序列 $z$ 週期為 $5N_h$；$c'_k$ 是它在 $f=kf_u/5$ 的傅立葉係數（$k$ 可以超過 5）。`) },
            { tex: String.raw`m=nN_h+i\;\Rightarrow\;c'_k=\underbrace{\frac15\sum_{n=0}^{4}e[n]e^{-j2\pi kn/5}}_{c_{k\bmod5}}\cdot\frac1{N_h}\sum_{i=0}^{N_h-1}e^{-j2\pi ki/(5N_h)}`, why: tx(String.raw`把索引拆成「第 $n$ 個 code」與「保持中的第 $i$ 個樣本」（$0\le i<N_h$）；同一個 code 內 $z$ 不變，可以提出來。`) },
            { tex: String.raw`\frac1{N_h}\sum_{i=0}^{N_h-1}e^{-j\theta i}=\frac1{N_h}\,\frac{1-e^{-j\theta N_h}}{1-e^{-j\theta}},\qquad\theta=\frac{2\pi k}{5N_h}`, why: tx(String.raw`等比級數 $\sum_{i=0}^{N-1}a^i=(1-a^N)/(1-a)$，公比 $a=e^{-j\theta}$。`) },
            { tex: String.raw`\Big|\frac{1-e^{-j\theta N_h}}{N_h(1-e^{-j\theta})}\Big|=\frac{|\sin(\theta N_h/2)|}{N_h|\sin(\theta/2)|}=\frac{|\sin(\pi k/5)|}{N_h|\sin(\pi k/(5N_h))|}=|G_k|`, why: tx(String.raw`$|1-e^{-jx}|=2|\sin(x/2)|$（和 NTF 推導同一個 Euler 技巧），代入 $\theta N_h/2=\pi k/5$。`) },
            { tex: String.raw`P_k^{\mathrm{ZOH}}=2|c'_k|^2=2|c_{k\bmod5}|^2G_k^2\quad(0<k<5N_h/2)`, why: tx(String.raw`one-sided 線功率；$k$ 為 5 的非零倍數時 $\sin(\pi k/5)=0$，是 ZOH 的零點。$N_h\to\infty$ 時 $G_k\to\mathrm{sinc}(k/5)$。`) },
          ]}
        />
        <p className="small">
          下表 <Tex>{'N_h=64'}</Tex>（由 <code>zohLines()</code> 計算，功率最大的 8 條）：
        </p>
        <div className="table-wrap">
          <table className="ch13-table">
            <thead>
              <tr>
                <th>
                  <Tex>{'k'}</Tex>
                </th>
                <th>頻率</th>
                <th>
                  <Tex>{'G_k^2'}</Tex>
                </th>
                <th>
                  線功率 <Tex>{String.raw`P_k^{\mathrm{ZOH}}\ [\mathrm{LSB}^2]`}</Tex>
                </th>
              </tr>
            </thead>
            <tbody>
              {r.zoh.map((l) => (
                <tr key={l.k}>
                  <td>{l.k}</td>
                  <td>
                    <Tex>{String.raw`${l.k}f_u/5`}</Tex>
                  </td>
                  <td>{fx(zohGain2(l.k, 5, 64), 5)}</td>
                  <td>{fx(l.power, 5)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small">
          所有 <Tex>{'k'}</Tex> 的總和仍是 <Tex>{String.raw`${fx(r.zohTotal, 4)}\,\mathrm{LSB}^2`}</Tex>（Parseval；由全部 <Tex>{String.raw`k=1,\dots,5N_h/2`}</Tex> 的線功率加總算出）。<Tex>{String.raw`k=5,10,\dots`}</Tex> 被 ZOH
          的零點 <Tex>{String.raw`\sin(\pi k/5)=0`}</Tex> 完全消掉。 <ClaimTag kind="exact" />
        </p>
      </Fold>
      <Hand id="HC-13.3">
        上面的推導用了 Euler 公式把兩項合成一個 <Tex>{String.raw`\cos`}</Tex>；手算時更直接的做法是把實部、虛部分開加。先用預設的 <Tex>{'[32,32,33,32,33]'}</Tex>（<Tex>{String.raw`n_a=2,\ n_b=4`}</Tex>）算{' '}
        <Tex>{'k=2'}</Tex>，再把 <Tex>{'k'}</Tex> 改成 1、把兩個 33 改成相鄰（<Tex>{String.raw`n_a=3,\ n_b=4`}</Tex>），親手確認「主線在哪裡」取決於排列（<Erratum id="E47" />）。
      </Hand>

    </Section>
  )
}
