import { useMemo } from 'react'
import { Callout, ClaimTag, Derivation, Mermaid, ModeGate, Prereq, Section, StepDerivation, Tex, TexBlock, ChapterErratum } from '@/components'
import { bestToneDelay, toneBlockCorr, toneCorrCodeDelay, toneCorrErrorDelay } from '@/simulation/models/filteredX'
import { CHART_BLOCK_AVERAGE, CHART_DELAY_SIDE, CHART_MIXER_AVERAGE } from '../diagrams'
import { FoldSteps } from '../FoldSteps'
import { Hand } from '../Hand'
import { fx, RAD, tx } from '../util'

const PHI = -120 * RAD
const OMEGA = Math.PI / 6
const r = String.raw

/** §7.2：C_D 的逐步推導、延遲方向的符號約定、E46 的邊界與有限 N。 */
export function S2DelayDerivation() {
  const bestCode = bestToneDelay(PHI, OMEGA, 11, 'code')
  const bestErr = bestToneDelay(PHI, OMEGA, 11, 'error')
  const bestCodeLead = bestToneDelay(120 * RAD, OMEGA, 11, 'code')
  const bestErrLead = bestToneDelay(120 * RAD, OMEGA, 11, 'error')
  const tone = { A: 1, mag: 1, phiRad: PHI, omega: OMEGA }
  const blockRows = useMemo(
    () =>
      [
        { omega: 0.01, N: 64 },
        { omega: Math.PI / 6, N: 64 },
        { omega: Math.PI - 0.01, N: 64 },
        { omega: Math.PI - 0.01, N: 1024 },
        { omega: 0.01, N: 4096 },
      ].map((row) => ({ ...row, ...toneBlockCorr({ A: 1, mag: 1, phiRad: PHI, omega: row.omega, D: 0, N: row.N, n0: 0 }) })),
    [],
  )

  return (
    <Section
      kind="formula"
      level={2}
      title={
        <>
          7.2 推導 <Tex>{'C_D'}</Tex>：延遲 <Tex>{'D'}</Tex> 個 sample 等於把相位轉 <Tex>{r`\Omega D`}</Tex>
        </>
      }
      id="ch07-derivation"
    >
      <Prereq title="離散時間頻率、頻率響應（frequency response）與歐拉公式">
        <p>
          <strong>離散時間頻率</strong>（discrete-time frequency）<Tex>{'\\Omega'}</Tex> 的單位是 rad/sample：每經過一個 sample，相位前進 <Tex>{'\\Omega'}</Tex>。若取樣率是 <Tex>{'f_s'}</Tex>、實際頻率是 <Tex>{'f'}</Tex>，則
          <Tex>{r`\Omega=2\pi f/f_s`}</Tex>，所以 <Tex>{r`0<\Omega<\pi`}</Tex> 對應 <Tex>{r`0<f<f_s/2`}</Tex>。
        </p>
        <p>
          <strong>歐拉公式</strong>（Euler）：<Tex>{r`e^{j\theta}=\cos\theta+j\sin\theta`}</Tex>，所以
          <Tex>{r`\cos\theta=\mathrm{Re}\{e^{j\theta}\}`}</Tex>。用它可以證明「正弦波進 LTI 濾波器，出來還是同頻的正弦波，只被放大
          <Tex>{'|H|'}</Tex>、平移相位 <Tex>{'\\phi'}</Tex>」：
        </p>
        <StepDerivation
          steps={[
            {
              tex: r`u[n]=\sum_{k\ge0}h[k]\,x[n-k]`,
              why: (
                <>
                  濾波器（卷積 convolution）的定義：輸出是過去輸入的加權和，<Tex>{'h[k]'}</Tex> 為脈衝響應（impulse response）。這裡的 <Tex>{'k'}</Tex>
                  只是「幾個 sample 以前」的編號，不是 GMAC 的 block 編號。
                </>
              ),
            },
            {
              tex: r`=\sum_{k}h[k]\,A\cos\big(\Omega(n-k)\big)=\mathrm{Re}\Big\{A\,e^{j\Omega n}\sum_k h[k]\,e^{-j\Omega k}\Big\}`,
              why: (
                <>
                  代入 <Tex>{r`x[n]=A\cos(\Omega n)=\mathrm{Re}\{Ae^{j\Omega n}\}`}</Tex>；<Tex>{'h[k]'}</Tex> 是實數，可以把
                  <Tex>{r`\mathrm{Re}\{\cdot\}`}</Tex> 提到外面。
                </>
              ),
            },
            {
              // 兩行：寫成一行時在手機（375 px）上只比欄位寬 4 px，會多出一條沒有用途的橫向捲軸
              tex: r`\begin{aligned}H(e^{j\Omega})&\equiv\sum_k h[k]\,e^{-j\Omega k}\\&=|H|\,e^{j\phi}\end{aligned}`,
              why: (
                <>
                  定義頻率響應（DTFT；也就是 Z transform 在單位圓 <Tex>{r`z=e^{j\Omega}`}</Tex> 上的值），並寫成極座標。
                </>
              ),
            },
            {
              tex: r`u[n]=\mathrm{Re}\{A|H|e^{j(\Omega n+\phi)}\}=A|H|\cos(\Omega n+\phi)`,
              why: (
                <>
                  把 <Tex>{'H'}</Tex> 的極座標代回去；<Tex>{r`\phi<0`}</Tex> 表示 <Tex>{'u'}</Tex> 落後 <Tex>{'x'}</Tex>。
                </>
              ),
            },
          ]}
        />
        <p className="small muted">
          這裡的 <Tex>{r`H(e^{j\Omega})`}</Tex> 是<strong>離散時間</strong>響應；不可以把 <Tex>{'\\Omega'}</Tex> 直接代入連續時間的
          <Tex>{r`H(j\omega)`}</Tex>。{' '}
          <ChapterErratum id="E44" detail={<>
            規格 §7 寫成 <Tex>{r`H_{\mathrm{PD}}(\Omega)`}</Tex>，本站一律寫 <Tex>{r`H(e^{j\Omega})`}</Tex>，<Tex>{'\\Omega'}</Tex> 為 rad/sample。
          </>} />
        </p>
      </Prereq>

      <h3 className="ch07-subhead">先看圖：GMAC 的「相乘再平均」是一個相位偵測器</h3>
      <p>
        推導之前先看訊號怎麼流。兩個<strong>同頻</strong>的 <Tex>{r`\cos`}</Tex> 相乘，會變成一個不隨時間變的常數，加上一個兩倍頻的 <Tex>{r`\cos`}</Tex>；平均器把兩倍頻的那一項平均掉，只留下常數——而那個常數只和兩個訊號的<strong>相位差</strong>有關。這就是為什麼 GMAC 的輸出會隨 <Tex>{'D'}</Tex> 變號。
      </p>
      <Mermaid
        chart={CHART_MIXER_AVERAGE}
        caption={r`GMAC = 乘法器 + 平均器：相乘之後分成「不隨 $n$ 變的項」（藍色）與「兩倍頻的項」；長時間平均只留下藍色那一項，它就是 $C_D$。`}
      />
      <p>
        先看進乘法器的兩個輸入：延遲過的 code <Tex>{'x[n-D]'}</Tex> 和 PD 端的 <Tex>{'u[n]'}</Tex>，頻率相同、相位不同。再看乘法器分出的兩項：藍色的那一項不隨
        <Tex>{'n'}</Tex> 變，原封不動通過平均器；另一項以兩倍的頻率 <Tex>{r`2\Omega`}</Tex> 振盪，平均後正負抵消。圖上藍色方塊就是下面推導第 5 步括號裡的第一項
        <Tex>{r`\cos(\phi+\Omega D)`}</Tex>，「兩倍頻的項」是第二項；平均器就是公式裡的 <Tex>{r`E[\cdot]`}</Tex>，最後的輸出就是推導最後框起來的 <Tex>{'C_D'}</Tex>。
      </p>

      <h3 className="ch07-subhead">逐步推導（延遲 GMAC 的 code）</h3>
      <FoldSteps
        steps={[
          { tex: r`x[n]=A\cos(\Omega n)`, why: '單頻 code（training tone，或 DSM code 的一條主要譜線）。' },
          { tex: r`u[n]=A|H|\cos(\Omega n+\phi)`, why: '經過 DTC → PD 的誤差路徑（見上面的先備知識；穩態，暫態已消失）。' },
          {
            tex: r`x_D[n]\equiv x[n-D]=A\cos(\Omega n-\Omega D)`,
            why: (
              <>
                GMAC 讀 shift register 第 <Tex>{'D'}</Tex> 級：把 <Tex>{'n'}</Tex> 換成 <Tex>{'n-D'}</Tex>。
              </>
            ),
          },
          { tex: r`x_D[n]\,u[n]=A^2|H|\cos(\Omega n-\Omega D)\cos(\Omega n+\phi)`, why: 'GMAC 每個 sample 做的乘法（先不看 comparator 的 sign）。' },
          {
            tex: r`=\frac{A^2|H|}{2}\Big[\cos(\phi+\Omega D)+\cos(2\Omega n+\phi-\Omega D)\Big]`,
            why: (
              <>
                積化和差 <Tex>{r`\cos\alpha\cos\beta=\tfrac12[\cos(\alpha-\beta)+\cos(\alpha+\beta)]`}</Tex>，取
                <Tex>{r`\alpha=\Omega n+\phi`}</Tex>、<Tex>{r`\beta=\Omega n-\Omega D`}</Tex>：<Tex>{r`\alpha-\beta=\phi+\Omega D`}</Tex>、
                <Tex>{r`\alpha+\beta=2\Omega n+\phi-\Omega D`}</Tex>。
              </>
            ),
          },
          {
            tex: r`E\big[\cos(2\Omega n+\psi)\big]=0\qquad(0<\Omega<\pi)`,
            why: (
              <>
                兩倍頻的項在一個週期內正負抵消（下面用等比數列證明）；與 <Tex>{'n'}</Tex> 無關的常數 <Tex>{r`\cos(\phi+\Omega D)`}</Tex> 留下來。
              </>
            ),
          },
        ]}
        result={r`C_D=E\big[x[n-D]\,u[n]\big]=\frac{A^2}{2}\,|H|\cos(\phi+\Omega D)`}
      />
      <TexBlock id="F-07.2" label="Delay Alignment 單頻相關（規格 §7 boxed）">
        {r`C_D=\frac{A^2}{2}\,|H|\cos(\phi+\Omega D),\qquad p_D=1-\mu K_qC_D`}
      </TexBlock>
      <p>
        <ClaimTag kind="exact" /> 條件：單頻、<Tex>{r`0<\Omega<\pi`}</Tex>、<Tex>{'E'}</Tex> 為長時間平均（或整數週期平均；或把起始相位當成隨機、對很多次實驗取平均的 ensemble average）。{' '}
        <ChapterErratum id="E46" detail={<>
          規格的 boxed 公式沒有寫出這些條件；<Tex>{'\\Omega'}</Tex> 在邊界與有限 <Tex>{'N'}</Tex> 的情形見本節後段。
        </>} />
      </p>
      <Hand id="HC-07.2">
        把剛推導出來的公式代一次數字。預設值是 T07 的例子（答案 <Tex>{r`C_4=0.5`}</Tex>）；換成你自己的 <Tex>{'A'}</Tex>、<Tex>{'|H|'}</Tex>、
        <Tex>{r`\phi`}</Tex>、<Tex>{r`\Omega`}</Tex>、<Tex>{'D'}</Tex>，先用計算機算，再對答案。最後三步的 <Tex>{r`\theta'`}</Tex>、<Tex>{r`C'_D`}</Tex>（延遲放在 comparator
        那一側）是下面「符號約定」要講的對照，可以先算、看完下一段再回來。
      </Hand>

      <Derivation
        title="為什麼兩倍頻的項會平均成 0？（等比數列）"
        level="L1"
        claim="exact"
        derivation={
          <StepDerivation
            steps={[
              {
                tex: r`\frac1M\sum_{n=0}^{M-1}\cos(2\Omega n+\psi)=\mathrm{Re}\Big\{\frac{e^{j\psi}}{M}\sum_{n=0}^{M-1}\big(e^{j2\Omega}\big)^n\Big\}`,
                why: (
                  <>
                    把 cos 寫成 <Tex>{r`e^{j\cdot}`}</Tex> 的實部，變成公比 <Tex>{r`r=e^{j2\Omega}`}</Tex> 的等比數列。
                  </>
                ),
              },
              {
                tex: r`\sum_{n=0}^{M-1}r^n=\frac{1-r^M}{1-r}\quad(r\ne1)`,
                why: (
                  <>
                    等比數列求和；<Tex>{r`0<\Omega<\pi`}</Tex> 時 <Tex>{r`r=e^{j2\Omega}\ne1`}</Tex>。
                  </>
                ),
              },
              {
                tex: r`|1-e^{j2\Omega M}|=2|\sin(\Omega M)|,\qquad|1-e^{j2\Omega}|=2|\sin\Omega|`,
                why: (
                  <>
                    <Tex>{r`1-e^{j2a}=-2j\sin(a)\,e^{ja}`}</Tex>，取絕對值。
                  </>
                ),
              },
              {
                tex: r`\Big|\frac1M\sum_{n=0}^{M-1}\cos(2\Omega n+\psi)\Big|\le\frac{|\sin\Omega M|}{M|\sin\Omega|}\le\frac{1}{M|\sin\Omega|}\xrightarrow{M\to\infty}0`,
                why: (
                  <>
                    <Tex>{r`|\mathrm{Re}\{z\}|\le|z|`}</Tex>；分子有界、分母隨 <Tex>{'M'}</Tex> 線性成長。<Tex>{'\\Omega'}</Tex> 接近 0 或
                    <Tex>{'\\pi'}</Tex> 時 <Tex>{r`|\sin\Omega|`}</Tex> 很小，需要更長的平均。
                  </>
                ),
              },
            ]}
          />
        }
      />

      <h3 className="ch07-subhead">
        符號約定：延遲 code 還是延遲 error？兩者的 <Tex>{r`\Omega D`}</Tex> 符號相反
      </h3>
      <p>
        硬體上有兩個地方可以放 delay：在 GMAC 的 <strong>code 輸入</strong>（本站的 <Tex>{'D'}</Tex>、JSON 的 <code>gm_code_delay_samples</code>），或在 <strong>comparator 輸出</strong>（讓 <Tex>{'q'}</Tex> 晚一點進 GMAC，等效於延遲 PD 誤差）。先看圖，再看只差一行的推導：
      </p>
      <Mermaid
        chart={CHART_DELAY_SIDE}
        caption={r`同一個延遲方塊（藍色）放在乘法器的哪一側：做法 A 放在 code 側，殘餘相位是 $\phi+\Omega D$；做法 B 放在 comparator 輸出側，殘餘相位是 $\phi-\Omega D$。`}
      />
      <p>
        先看做法 A：藍色的延遲在 code 這一側，乘法器算的是 <Tex>{r`q[n]\,x[n-D]`}</Tex>——code 被往後拉 <Tex>{r`\Omega D`}</Tex>，去追一個<strong>落後</strong>的誤差路徑。再看做法 B：同一個延遲移到 comparator 輸出這一側，乘法器算的是 <Tex>{r`q[n-D]\,x[n]`}</Tex>——被往後拉的變成誤差，等於讓 code 相對<strong>提前</strong>了
        <Tex>{r`\Omega D`}</Tex>，適合超前的誤差路徑。圖上兩個結果方塊裡的 <Tex>{r`\phi+\Omega D`}</Tex> 與 <Tex>{r`\phi-\Omega D`}</Tex>，就是 F-07.2 與下面 F-07.3 的
        <Tex>{r`\cos`}</Tex> 裡面的角度。
      </p>
      <FoldSteps
        title="延遲 comparator 誤差（另一種做法）"
        steps={[
          {
            // 索引裡的減號寫成 {-}（不留運算子間距）：原本在手機（375 px）上只比欄位寬 2 px，會多出一條沒有用途的橫向捲軸
            tex: r`u[n{-}D]=A|H|\cos(\Omega n-\Omega D+\phi)`,
            why: (
              <>
                把 <Tex>{'u'}</Tex> 的 <Tex>{'n'}</Tex> 換成 <Tex>{'n-D'}</Tex>：誤差路徑的輸出再晚 <Tex>{'D'}</Tex> 個 sample。
              </>
            ),
          },
          {
            tex: r`x[n]\,u[n-D]=\frac{A^2|H|}{2}\Big[\cos(\phi-\Omega D)+\cos(2\Omega n+\phi-\Omega D)\Big]`,
            why: (
              <>
                同樣的積化和差，<Tex>{r`\alpha=\Omega n-\Omega D+\phi`}</Tex>、<Tex>{r`\beta=\Omega n`}</Tex>：<Tex>{r`\alpha-\beta=\phi-\Omega D`}</Tex>。
              </>
            ),
          },
        ]}
        result={r`C'_D=E\big[x[n]\,u[n-D]\big]=\frac{A^2}{2}\,|H|\cos(\phi-\Omega D)`}
      />
      <TexBlock id="F-07.3" label={<>延遲 comparator 誤差：相位是 <Tex>{r`\phi-\Omega D`}</Tex></>}>
        {r`C'_D=\frac{A^2}{2}|H|\cos(\phi-\Omega D)\qquad\text{vs.}\qquad C_D=\frac{A^2}{2}|H|\cos(\phi+\Omega D)`}
      </TexBlock>
      <div className="table-wrap">
        <table className="ch07-table">
          <thead>
            <tr>
              <th>延遲放在哪裡</th>
              <th>GMAC 計算</th>
              <th>殘餘相位</th>
              <th>適合補償</th>
              <th className="num">
                <Tex>{r`\phi=-120^\circ`}</Tex> 的最佳 <Tex>{'D'}</Tex>
              </th>
              <th className="num">
                <Tex>{r`\phi=+120^\circ`}</Tex> 的最佳 <Tex>{'D'}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>code（GMAC 輸入）</td>
              <td>
                <Tex>{r`\sum q[n]\,x[n-D]`}</Tex>
              </td>
              <td>
                <Tex>{r`\phi+\Omega D`}</Tex>
              </td>
              <td>
                誤差路徑<strong>落後</strong>（<Tex>{r`\phi<0`}</Tex>）
              </td>
              <td className="num">
                {bestCode.D}（<Tex>{r`\theta=${tx(bestCode.thetaDeg, 0)}^\circ`}</Tex>）
              </td>
              <td className="num">
                {bestCodeLead.D}（<Tex>{r`\theta=${tx(bestCodeLead.thetaDeg, 0)}^\circ`}</Tex>）
              </td>
            </tr>
            <tr>
              <td>comparator 輸出（error）</td>
              <td>
                <Tex>{r`\sum q[n-D]\,x[n]`}</Tex>
              </td>
              <td>
                <Tex>{r`\phi-\Omega D`}</Tex>
              </td>
              <td>
                誤差路徑<strong>超前</strong>（<Tex>{r`\phi>0`}</Tex>）
              </td>
              <td className="num">
                {bestErr.D}（<Tex>{r`\theta=${tx(bestErr.thetaDeg, 0)}^\circ`}</Tex>）
              </td>
              <td className="num">
                {bestErrLead.D}（<Tex>{r`\theta=${tx(bestErrLead.thetaDeg, 0)}^\circ`}</Tex>）
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <Callout kind="warn" title="把延遲放錯邊會怎樣？">
        <p>
          <Tex>{r`\phi=-120^\circ`}</Tex> 時延遲 error 4 個 sample：<Tex>{r`\theta=-120^\circ-120^\circ=-240^\circ\equiv120^\circ`}</Tex>，
          <Tex>{r`C'_4=${tx(toneCorrErrorDelay(tone, 4), 4)}`}</Tex>——和完全不延遲一樣是負的（反向更新）；而延遲 code 4 個 sample 得到 <Tex>{r`C_4=${tx(toneCorrCodeDelay(tone, 4), 4)}`}</Tex>。單頻時兩種做法都能「繞一圈」對齊（相位以 <Tex>{r`360^\circ`}</Tex> 為週期，延遲 error 8 個 sample 也行），但 <Tex>{'D'}</Tex> 不同；RTL 或 behavioral model 把延遲方向寫反，是很常見的 bug。本章的 Lab 同時畫出兩條曲線。這也是規格 §17 要求的反面測試「Code misalignment」：<Tex>{'H=1'}</Tex> 卻多延遲了 code 4 個 sample，
          <Tex>{r`C_4=\tfrac12\cos120^\circ=-0.25`}</Tex>。
        </p>
        <p className="small">
          這兩個數字（<Tex>{r`C_4=0.5`}</Tex>、<Tex>{r`C'_4=-0.25`}</Tex>）就是上面手算題 HC-07.2 的第 5 步與第 8 步；把 <Tex>{'D'}</Tex> 改成 8 再算一次，會看到延遲 error
          8 個 sample 也能對齊。
        </p>
      </Callout>

      <ModeGate min="engineer">
        <h3 className="ch07-subhead">
          邊界情況 1：<Tex>{r`\Omega=0`}</Tex> 或 <Tex>{'\\pi'}</Tex>
        </h3>
        <p>
          回到本節開頭那張「乘法器 + 平均器」的圖：當 <Tex>{r`\Omega=0`}</Tex> 或 <Tex>{r`\pi`}</Tex>，「兩倍頻的項」
          <Tex>{r`\cos(2\Omega n+\psi)=\cos\psi`}</Tex> 對每個 <Tex>{'n'}</Tex> 都一樣（<Tex>{r`2\pi n`}</Tex> 是整圈），它根本不振盪，平均器平均不掉。另外實係數 <Tex>{'h'}</Tex> 在這兩個頻率的響應
          <Tex>{r`H(e^{j0})=\sum_k h[k]`}</Tex>、<Tex>{r`H(e^{j\pi})=\sum_k(-1)^kh[k]`}</Tex> 都是實數，只能有
          <Tex>{r`\phi\in\{0^\circ,180^\circ\}`}</Tex>：{' '}
          <ChapterErratum id="E46" />
        </p>
        <StepDerivation
          steps={[
            {
              tex: r`x_D[n]u[n]=\frac{A^2|H|}{2}\big[\cos(\phi+\Omega D)+\cos(\phi-\Omega D)\big]`,
              why: (
                <>
                  <Tex>{r`\Omega\in\{0,\pi\}`}</Tex> 時 <Tex>{r`2\Omega n\equiv0\pmod{2\pi}`}</Tex>，第二項變成常數 <Tex>{r`\cos(\phi-\Omega D)`}</Tex>。
                </>
              ),
            },
            {
              tex: r`=A^2|H|\cos\phi\,\cos(\Omega D)`,
              why: (
                <>
                  和差化積 <Tex>{r`\cos(a+b)+\cos(a-b)=2\cos a\cos b`}</Tex>。
                </>
              ),
            },
          ]}
          result={r`C_D=A^2\,H(e^{j\Omega})\cos(\Omega D)\quad(\Omega\in\{0,\pi\})`}
        />
        <TexBlock id="F-07.5" label={<><Tex>{r`\Omega=0`}</Tex> 或 <Tex>{r`\pi`}</Tex> 的邊界（E46）</>}>{r`\begin{aligned}&C_D=A^2\,H(e^{j\Omega})\cos(\Omega D),\quad H(e^{j\Omega})\in\mathbb R\quad(\Omega\in\{0,\pi\});\\&\text{例：交替碼 }x[n]=A(-1)^n\Rightarrow C_D=A^2H(e^{j\pi})(-1)^D\end{aligned}`}</TexBlock>
        <p>
          這是一般公式的 <strong>2 倍</strong>。<ClaimTag kind="exact" /> 若用「<Tex>{'|H|'}</Tex>、<Tex>{'\\phi'}</Tex>、<Tex>{'\\Omega'}</Tex>
          三個獨立滑桿」合成 <Tex>{'u'}</Tex>，在 <Tex>{r`\Omega=\pi`}</Tex> 選 <Tex>{r`\phi=120^\circ`}</Tex> 會得到實數濾波器不可能產生的訊號，解析值與 Monte Carlo 也會差 2 倍。本章的 Lab 把 <Tex>{'\\Omega'}</Tex> 限制在 <Tex>{r`(0,\pi)`}</Tex> 內，並用真實的 2-tap FIR 產生
          <Tex>{'H'}</Tex>。
        </p>

        <h3 className="ch07-subhead">
          邊界情況 2：有限 <Tex>{'N'}</Tex> 的 GMAC block
        </h3>
        <p>
          GMAC 只平均 <Tex>{'N'}</Tex> 個 sample（單一 block：<Tex>{r`n=n_0,\dots,n_0+N-1`}</Tex>）。先看圖：它和本節開頭「乘法器 + 平均器」那張圖只差在平均器。
        </p>
        <Mermaid
          chart={CHART_BLOCK_AVERAGE}
          caption={r`只平均一個 block 的 $N$ 個 sample：不隨 $n$ 變的項（藍色）照舊；兩倍頻的項（紅色）不再剛好抵消，變成一個乘上 $\sin(N\Omega)/(N\sin\Omega)$ 的 ripple。`}
        />
        <p>
          先看藍色方塊：不隨 <Tex>{'n'}</Tex> 變的 <Tex>{r`\cos(\phi+\Omega D)`}</Tex> 不管平均幾個 sample 都原封不動。再看紅色方塊：兩倍頻的項這次只在 <Tex>{'N'}</Tex> 個 sample 上平均，等比數列的和不再為零，結果等於「把 <Tex>{'n'}</Tex> 換成 block 的中點 <Tex>{r`n_0+(N-1)/2`}</Tex>」再乘上 <Tex>{r`\sin(N\Omega)/(N\sin\Omega)`}</Tex>。這兩項相加，就是下面 F-07.6 中括號裡的第一項與第二項；
          <Tex>{'N'}</Tex> 越大、<Tex>{r`|\sin\Omega|`}</Tex> 越大，第二項（ripple）越小，長時間平均時趨近 0，回到 F-07.2。把上面的等比數列結果代入，單一 block 的相關部分確切等於：
        </p>
        <TexBlock id="F-07.6">{r`\bar G_k=\frac{A^2|H|}{2}\Big[\cos(\phi+\Omega D)+\cos\big(2\Omega n_0+\Omega(N-1)+\phi-\Omega D\big)\,\frac{\sin N\Omega}{N\sin\Omega}\Big]`}</TexBlock>
        <p>
          ripple 上界 <Tex>{r`\tfrac{A^2|H|}{2}\min\!\big(1,\tfrac{1}{N|\sin\Omega|}\big)`}</Tex>（因為 <Tex>{r`|\sin N\Omega|\le N|\sin\Omega|`}</Tex>，取 min 比 validation 引用的未截斷上界更緊）。下表（<Tex>{r`\phi=-120^\circ`}</Tex>、<Tex>{'A=|H|=1'}</Tex>、<Tex>{'D=0'}</Tex>、
          <Tex>{'n_0=0'}</Tex>）由上式即時計算：
        </p>
        <div className="table-wrap">
          <table className="ch07-table">
            <thead>
              <tr>
                <th className="num">
                  <Tex>{'\\Omega'}</Tex>
                </th>
                <th className="num">
                  <Tex>{'N'}</Tex>
                </th>
                <th className="num">單一 block 值</th>
                <th className="num">長時間值</th>
                <th className="num">ripple 上界</th>
                <th>判讀</th>
              </tr>
            </thead>
            <tbody>
              {blockRows.map((row, i) => (
                <tr key={i}>
                  <td className="num">{fx(row.omega, 4)}</td>
                  <td className="num">{row.N}</td>
                  <td className="num">{fx(row.exact, 5)}</td>
                  <td className="num">{fx(row.longRun, 5)}</td>
                  <td className="num">{fx(row.rippleBound, 5)}</td>
                  <td>
                    {row.rippleBound >= Math.abs(row.longRun)
                      ? '上界不小於訊號：單一 block 可能變號'
                      : row.rippleBound > 0.1 * Math.abs(row.longRun)
                        ? 'ripple 明顯'
                        : 'ripple 可忽略'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          <Tex>{r`N|\sin\Omega|`}</Tex> 很小（<Tex>{'\\Omega'}</Tex> 接近 0 或 <Tex>{'\\pi'}</Tex>、或 <Tex>{'N'}</Tex> 太短）時，單一 block 的符號可能翻轉；但 LMS 是很多 block 的累積，長時間仍回到 <Tex>{r`\cos(\phi+\Omega D)`}</Tex>。工程建議：讓 <Tex>{'N'}</Tex> 是 code 週期的整數倍，或
          <Tex>{r`N\gg1/|\sin\Omega|`}</Tex>。<ClaimTag kind="exact" />
        </p>
      </ModeGate>
    </Section>
  )
}
