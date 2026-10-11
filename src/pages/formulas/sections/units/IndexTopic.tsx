import { Callout, ClaimTag, CodeBlock, Mermaid, Prereq, SourceTag, StepDerivation, Tex, TexBlock } from '@/components'
import calNoiseSrc from '@/simulation/models/calNoise.ts?raw'
import { refValues, T13_SETUP } from '../../refValues'
import { texHz, texNum } from '../../format'
import { Collapsible, ErratumTag, FormulaLinks, Gate, PageLinks } from '../../common'
import { CHART_RATE_DOMAINS } from '../../diagrams'
import { TimelineDiagram } from './TimelineDiagram'
import { Topic } from './Topic'

/**
 * 2.1 時間索引 n / k / m 與取樣率；2.2 時間 fs ↔ 相位 rad ↔ UI。
 * 所有數字由 refValues()（站內核心）計算。
 */
export function IndexTopic() {
  const r = refValues()
  const u = r.units
  const N = T13_SETUP.N
  return (
    <Topic id="index" no="2.1" title="時間索引 $n$ / $k$ / $m$：先問「這一步」是哪一種步">
      <p>
        <strong>一個問題：</strong>有人說「LMS 跑了 100 步就收斂」。這 100 步是 100 次 comparator 比較（<Tex>{String.raw`${texNum((100 * u.samplePeriodPs) / 1000)}\,\mathrm{ns}`}</Tex>），還是 100 次係數更新（
        <Tex>{String.raw`${texNum(100 * u.blockPeriodUs)}\,\mu\mathrm{s}`}</Tex>）？在 <Tex>{`N=${N}`}</Tex> 的系統裡兩者差了 {N} 倍。所以全站把時間軸分成三種索引，
        <strong>一條式子裡只能出現一種</strong>（規格附錄 B 第 5 點；<ErratumTag eid="E35" />）。
      </p>
      <div className="table-wrap">
        <table className="fr-table fr-index-table">
          <thead>
            <tr>
              <th>索引</th>
              <th>什麼時候加 1</th>
              <th>速率</th>
              <th>T13 示例的一步有多長</th>
              <th>這個軸上的角頻率</th>
              <th>用它編號的量</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td data-label="索引">
                <Tex>{'n'}</Tex>（sample）
              </td>
              <td data-label="何時 +1">每做一次 comparator 比較</td>
              <td data-label="速率">
                <Tex>{String.raw`f_s=${texHz(T13_SETUP.fs)}`}</Tex>
              </td>
              <td data-label="一步">
                <Tex>{String.raw`1/f_s=${texNum(u.samplePeriodPs)}\,\mathrm{ps}`}</Tex>
              </td>
              <td data-label="角頻率">
                <Tex>{String.raw`\theta=2\pi f/f_s`}</Tex>（rad/sample）
              </td>
              <td data-label="量">
                <Tex>{String.raw`x[n],\ u[n],\ e[n],\ v[n],\ q[n],\ \delta t[n]`}</Tex>
              </td>
            </tr>
            <tr>
              <td data-label="索引">
                <Tex>{'k'}</Tex>（block）
              </td>
              <td data-label="何時 +1">
                每累加 <Tex>{'N'}</Tex> 筆、更新一次係數
              </td>
              <td data-label="速率">
                <Tex>{String.raw`f_u=f_s/N=${texHz(r.loop.fu, 7)}`}</Tex>
              </td>
              <td data-label="一步">
                <Tex>{String.raw`N/f_s=${texNum(u.blockPeriodUs)}\,\mu\mathrm{s}`}</Tex>
              </td>
              <td data-label="角頻率">
                <Tex>{String.raw`\Omega=2\pi f/f_u`}</Tex>（rad/block）
              </td>
              <td data-label="量">
                <Tex>{String.raw`w_k,\ \delta_k,\ \delta w_k,\ G_k,\ \eta_k`}</Tex>
              </td>
            </tr>
            <tr>
              <td data-label="索引">
                <Tex>{'m'}</Tex>（tracking）
              </td>
              <td data-label="何時 +1">每做一次背景追蹤（PVT 漂移）</td>
              <td data-label="速率">由設計決定，遠慢於 <Tex>{'f_u'}</Tex></td>
              <td data-label="一步">ms 到 s 的量級</td>
              <td data-label="角頻率">—</td>
              <td data-label="量">
                <Tex>{String.raw`a_m,\ K^{(c)}`}</Tex>（真實參數與 GMAC 斜率隨 corner 改變）
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        <strong>先看圖：</strong>上面的表格說「哪個量用哪個索引」；下圖把同一件事畫成訊號流。左邊的 sample rate 每個 <Tex>{'n'}</Tex> 都有一筆 <Tex>{'e[n]'}</Tex>、<Tex>{'q[n]'}</Tex>；
        累加 <Tex>{'N'}</Tex> 筆之後才得到右邊 block rate 的一筆 <Tex>{'G_k'}</Tex>，更新 <Tex>{'w_k'}</Tex>；要回到 sample rate 就得用 ZOH 把 <Tex>{'w_k'}</Tex> 重複 <Tex>{'N'}</Tex> 次。
      </p>
      <Mermaid
        chart={CHART_RATE_DOMAINS}
        caption="兩條時間軸：$e[n]$、$q[n]$ 在 sample rate（索引 $n$，$f_s$）；$G_k$、$w_k$、$\delta_k$ 在 block rate（索引 $k$，$f_u=f_s/N$）。藍色的累加是 sample → block，綠色的 ZOH 是 block → sample；虛線的 $\delta_k$ 在整個 block 內保持不變，其實也是一次 ZOH。"
      />
      <Prereq title="離散時間的角頻率：rad/sample 與 rad/block">
        <p>
          以取樣率 <Tex>{'f_r'}</Tex> 對頻率 <Tex>{'f'}</Tex> 的弦波取樣（第 <Tex>{'n'}</Tex> 個樣本的時間是 <Tex>{'t=n/f_r'}</Tex>）：
        </p>
        <TexBlock>{String.raw`\cos(2\pi f\,t)\Big|_{t=n/f_r}=\cos\!\Big(\frac{2\pi f}{f_r}\,n\Big)=\cos(\Omega n),\qquad \Omega\triangleq\frac{2\pi f}{f_r}`}</TexBlock>
        <p>
          <Tex>{String.raw`\Omega`}</Tex> 的意思是「每走一個樣本，相位前進幾 rad」。<Tex>{String.raw`\Omega=\pi`}</Tex>（每個樣本變號一次）是這條序列能表示的最高頻率{' '}
          <Tex>{'f=f_r/2'}</Tex>（Nyquist）。同一個 <Tex>{'f'}</Tex> 放到取樣率不同的兩條軸上，角頻率就不同：T14 的 corner <Tex>{String.raw`f_{3\mathrm{dB}}=${texHz(r.loop.f3dbExact)}`}</Tex> 在 block
          軸（<Tex>{'f_r=f_u'}</Tex>）是 <Tex>{String.raw`\Omega=${texNum(r.loop.omega3dbBlock)}\,\mathrm{rad/block}`}</Tex>，在 sample 軸（<Tex>{'f_r=f_s'}</Tex>）是{' '}
          <Tex>{String.raw`\theta=${texNum(r.loop.theta3dbSample)}\,\mathrm{rad/sample}`}</Tex>，兩者差 <Tex>{`N=${N}`}</Tex> 倍。
        </p>
      </Prereq>
      <TimelineDiagram />
      <TexBlock>{String.raw`\boxed{k=\Big\lfloor\frac{n}{N}\Big\rfloor}\qquad \text{block }k\text{ 涵蓋 }n=kN,\ kN+1,\ \ldots,\ kN+N-1`}</TexBlock>
      <Prereq title="地板函數 $\lfloor\cdot\rfloor$ 與零階保持（ZOH）">
        <p>
          <Tex>{String.raw`\lfloor y\rfloor`}</Tex> 是「不超過 <Tex>{'y'}</Tex> 的最大整數」：<Tex>{String.raw`\lfloor2.44\rfloor=2`}</Tex>、
          <Tex>{String.raw`\lfloor1.95\rfloor=1`}</Tex>。把慢的序列 <Tex>{'w_k'}</Tex> 放到快的時間軸上，最簡單的做法是「下一個值來之前一直保持舊值」，這叫零階保持（zero-order hold）：
          <Tex>{String.raw`w[n]=w_{\lfloor n/N\rfloor}`}</Tex>，也就是每個 <Tex>{'w_k'}</Tex> 重複 <Tex>{'N'}</Tex> 次。
        </p>
      </Prereq>
      <StepDerivation
        title={
          <>
            先算一次：<Tex>{`n=${u.exampleN}`}</Tex> 的那一筆比較，用的是哪一個係數？
          </>
        }
        steps={[
          {
            tex: String.raw`k=\Big\lfloor\frac{${u.exampleN}}{${N}}\Big\rfloor=\lfloor${texNum(u.exampleN / N, 4)}\rfloor=${u.exampleK}`,
            why: (
              <>
                代入 <Tex>{String.raw`k=\lfloor n/N\rfloor`}</Tex>：這筆樣本屬於 block {u.exampleK}。
              </>
            ),
          },
          {
            tex: String.raw`${u.exampleK}\times${N}=${u.exampleBlockStart}\ \le\ ${u.exampleN}\ \le\ ${u.exampleBlockEnd}=${u.exampleK}\times${N}+${N}-1`,
            why: <>驗算：block {u.exampleK} 的第一筆與最後一筆 sample 把它夾在中間。</>,
          },
          {
            tex: String.raw`w[n]=w_{\lfloor (n-n_c)/N\rfloor}\ \Rightarrow\ \Big\lfloor\frac{${u.exampleN}-${u.exampleNc}}{${N}}\Big\rfloor=\lfloor${texNum((u.exampleN - u.exampleNc) / N, 4)}\rfloor=${u.exampleKWithLatency}`,
            why: (
              <>
                若新係數算出來後還要 <Tex>{`n_c=${u.exampleNc}`}</Tex> 個 sample 才寫進 DTC（commit latency），這一筆實際用的還是 <Tex>{`w_{${u.exampleKWithLatency}}`}</Tex>，不是{' '}
                <Tex>{`w_{${u.exampleK}}`}</Tex>。
              </>
            ),
          },
        ]}
      />
      <p>有了三種索引，全站的更新式都寫成「每一項的索引都對得上」的形式：</p>
      <TexBlock>{String.raw`\begin{aligned}
G_k&=\frac1N\sum_{n=kN}^{kN+N-1}q[n]\,x[n-D] &&\text{（sample 軸上累加；}D\text{：code delay，單位 samples）}\\
w_{k+1}&=w_k+\mu\,G_{k-d} &&\text{（block 軸上更新；}d\text{：更新延遲，單位 blocks）}\\
w[n]&=w_{\lfloor (n-n_c)/N\rfloor} &&\text{（回到 sample 軸；}n_c\text{：commit latency，單位 samples）}
\end{aligned}`}</TexBlock>
      <Callout kind="warn" title="三個「延遲」是三個不同的量">
        <p>
          <Tex>{'D'}</Tex>（samples）是為了對齊 code 與 PD 誤差而刻意加的延遲，影響的是更新<strong>極性</strong>（<Tex>{'C_D'}</Tex>，第 6–7 章）；<Tex>{'d'}</Tex>（blocks）是算出{' '}
          <Tex>{'G'}</Tex> 到係數生效之間多等的 block 數，影響的是<strong>穩定範圍</strong>（<Tex>{String.raw`g^*(d)=2\sin\frac{\pi}{4d+2}`}</Tex>，第 8 章）；<Tex>{'n_c'}</Tex>{' '}
          （samples）是硬體的 commit／apply latency，<Tex>{String.raw`n_c\ge N`}</Tex> 時就等效成 <Tex>{String.raw`d\ge1`}</Tex>。規格 §16.1 的「Code <Tex>{'n-d'}</Tex>」指的是 <Tex>{'D'}</Tex>（
          <ErratumTag eid="E34" />）。
        </p>
      </Callout>
      <Collapsible title="規格裡哪些式子把索引寫混了？（勘誤 E35 的三處）">
        <ul>
          <li>
            §7 的 Filtered-x 更新 <Tex>{String.raw`w_{k+1}=w_k+\mu E[q[n]u_f[n]]`}</Tex>：等號左邊是 block 索引，右邊卻有期望值和 sample 索引，實作者不知道要累加什麼。改寫成可實作的{' '}
            <Tex>{String.raw`w_{k+1}=w_k+\mu G_k^{(f)}`}</Tex>、<Tex>{String.raw`G_k^{(f)}=\frac1N\sum_{n\in k}q[n]u_f[n]`}</Tex>，平均動態另外寫 <Tex>{String.raw`E[G_k^{(f)}]`}</Tex>。
          </li>
          <li>
            §9.1 的 PE 窗口寫「對所有 <Tex>{'k'}</Tex>：<Tex>{String.raw`\sum_{n=k}^{k+N_0-1}`}</Tex>」：<Tex>{'k'}</Tex> 被拿來當 sample 窗口的起點。改成 sample 索引 <Tex>{'n_0'}</Tex>：
            <Tex>{String.raw`\sum_{n=n_0}^{n_0+N_0-1}\mathbf u[n]\mathbf u^T[n]`}</Tex>。
          </li>
          <li>
            §13.4 的量化器一律用 <Tex>{'n'}</Tex>，但它可能每個 GMAC block 更新一次（用 <Tex>{'k'}</Tex>），也可能每個 reference cycle 更新一次（用 <Tex>{'n'}</Tex>）；兩者的 tone 頻率差{' '}
            <Tex>{'N'}</Tex> 倍，必須註明時脈。
          </li>
        </ul>
        <p className="small">
          另外，<Tex>{'f_s'}</Tex>（comparator 取樣率）<strong>不保證</strong>等於 <Tex>{String.raw`f_{\mathrm{ref}}`}</Tex>；兩者不同時 PLL 迴路與 comparator 不在同一個時間軸上，
          <Tex>{String.raw`H_{\mathrm{PD}}(e^{j\Omega})`}</Tex> 必須另做 multirate 推導（<ErratumTag eid="E44" />）。本站的 DT 參考模型假設兩者相同（次取樣 PLL 每個 reference 週期比較一次，正是這種情況）。
        </p>
      </Collapsible>
      <div className="fr-topic-foot small">
        <ClaimTag kind="exact" /> <SourceTag kind="illustrative" /> <PageLinks ids={['ch04', 'ch07', 'ch09', 'ch12']} /> <FormulaLinks ids={['F-04.3', 'F-08.8', 'F-12.11']} />
      </div>
    </Topic>
  )
}

export function TimePhaseTopic() {
  const r = refValues()
  const u = r.units
  return (
    <Topic id="timePhase" no="2.2" title="時間（fs）、相位（rad）與 UI：同一個誤差，三種單位">
      <p>
        <strong>一個問題：</strong>校正係數的雜訊是 <Tex>{String.raw`${texNum(r.loop.sigmaW)}\,\mathrm{fs}`}</Tex>，這是幾 rad？答案是「要先問在哪一個頻率的時脈上」。全站預設用{' '}
        <strong>時間（fs）</strong>記誤差，因為同一個時間誤差搬到不同節點時數值不變；換成相位時一定要寫出用的是哪個頻率，fs 與 rad 兩種量<strong>不可以直接相加或比較</strong>。
      </p>
      <StepDerivation
        title="從「延遲了一點點的時脈」推出換算式"
        steps={[
          { tex: String.raw`v(t)=\cos\!\big(2\pi f\,(t-\Delta t)\big)`, why: <>頻率 <Tex>{'f'}</Tex> 的時脈整個晚了 <Tex>{String.raw`\Delta t`}</Tex>。</> },
          { tex: String.raw`=\cos\!\big(2\pi f\,t-2\pi f\,\Delta t\big)`, why: '把括號乘開。' },
          {
            tex: String.raw`=\cos(2\pi f\,t-\phi),\qquad \phi\triangleq2\pi f\,\Delta t`,
            why: (
              <>
                定義相位誤差 <Tex>{String.raw`\phi`}</Tex>。單位：<Tex>{String.raw`\mathrm{Hz}\times\mathrm{s}`}</Tex> 是「幾個週期」（無因次），再乘上每個週期的 <Tex>{String.raw`2\pi\ \mathrm{rad}`}</Tex>。
              </>
            ),
          },
          {
            tex: String.raw`\phi\,[\mathrm{rad}]=2\pi\,f\,[\mathrm{Hz}]\times\Delta t\,[\mathrm{fs}]\times10^{-15}`,
            why: (
              <>
                <Tex>{String.raw`\Delta t`}</Tex> 以 fs 計時補上 <Tex>{String.raw`10^{-15}\,\mathrm{s/fs}`}</Tex>。以「單位間隔」計則是 <Tex>{String.raw`\Delta t/T=f\,\Delta t`}</Tex>（UI），
                <Tex>{String.raw`1\,\mathrm{UI}=2\pi\,\mathrm{rad}`}</Tex>。
              </>
            ),
          },
        ]}
        result={String.raw`\phi=2\pi f\,\Delta t\qquad\Longleftrightarrow\qquad \Delta t=\frac{\phi}{2\pi f}`}
      />
      <div className="table-wrap">
        <table className="fr-table fr-conv-table">
          <thead>
            <tr>
              <th>同一個時間誤差</th>
              <th>
                在 <Tex>{String.raw`f_{\mathrm{ref}}=${texHz(u.fRef)}`}</Tex>（PD／DTC 端）
              </th>
              <th>
                在 <Tex>{String.raw`f_{\mathrm{out}}=${texHz(r.spur.fOut)}`}</Tex>（PLL 輸出）
              </th>
              <th>說明</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td data-label="時間">
                <Tex>{String.raw`1\,\mathrm{fs}`}</Tex>
              </td>
              <td data-label="f_ref">
                <Tex>{String.raw`${texNum(u.radPerFsRef)}\,\mathrm{rad}`}</Tex>
              </td>
              <td data-label="f_out">
                <Tex>{String.raw`${texNum(r.spur.radPerFs)}\,\mathrm{rad}=${texNum(u.uiPerFsOut)}\,\mathrm{UI}`}</Tex>
              </td>
              <td data-label="說明">
                兩者差 <Tex>{String.raw`f_{\mathrm{out}}/f_{\mathrm{ref}}=${texNum(u.divRatio)}`}</Tex> 倍（除頻比）
              </td>
            </tr>
            <tr>
              <td data-label="時間">
                <Tex>{String.raw`\sigma_w=${texNum(r.loop.sigmaW)}\,\mathrm{fs}`}</Tex>
              </td>
              <td data-label="f_ref">
                <Tex>{String.raw`${texNum(r.loop.sigmaW * u.radPerFsRef)}\,\mathrm{rad}`}</Tex>
              </td>
              <td data-label="f_out">
                <Tex>{String.raw`${texNum(u.sigmaWRad)}\,\mathrm{rad}`}</Tex>
              </td>
              <td data-label="說明">
                T13 的係數雜訊；它是 gain-equivalent，還沒乘 code、還沒經過 <Tex>{'T'}</Tex>，<strong>不是</strong> output jitter
              </td>
            </tr>
            <tr>
              <td data-label="時間">
                <Tex>{String.raw`A_t=${r.spur.At}\,\mathrm{fs}`}</Tex>（peak）
              </td>
              <td data-label="f_ref">—</td>
              <td data-label="f_out">
                <Tex>{String.raw`\beta=${texNum(r.spur.beta)}\,\mathrm{rad}\Rightarrow${texNum(r.spur.dbc)}\,\mathrm{dBc}`}</Tex>
              </td>
              <td data-label="說明">T15 的 output timing tone（單一頻率、小角調變）</td>
            </tr>
          </tbody>
        </table>
      </div>
      <Callout kind="info" title="dB 的兩條規則">
        <p>
          <strong>振幅</strong>（fs、rad、V）取 <Tex>{String.raw`20\log_{10}`}</Tex>；<strong>功率或 PSD</strong>（<Tex>{String.raw`\mathrm{fs^2}`}</Tex>、
          <Tex>{String.raw`\mathrm{rad^2/Hz}`}</Tex>）取 <Tex>{String.raw`10\log_{10}`}</Tex>。相位調變指數 <Tex>{String.raw`\beta`}</Tex>（rad）是振幅，所以 spur 是{' '}
          <Tex>{String.raw`20\log_{10}(\beta/2)`}</Tex>；phase noise <Tex>{String.raw`\mathcal L(f)`}</Tex> 來自 PSD，所以是 <Tex>{String.raw`10\log_{10}(S_\phi^{(1)}/2)`}</Tex>（§2.5）。
        </p>
      </Callout>
      <Collapsible title={<>為什麼 spur 是 <Tex>{String.raw`20\log_{10}(\beta/2)`}</Tex>？（三角恆等式，一步一步）</>}>
        <StepDerivation
          steps={[
            {
              tex: String.raw`v(t)=\cos\!\big(\omega_0t+\beta\sin\omega_mt\big)`,
              why: (
                <>
                  載波 <Tex>{String.raw`\omega_0=2\pi f_{\mathrm{out}}`}</Tex> 被一個頻率 <Tex>{String.raw`\omega_m`}</Tex>、振幅 <Tex>{String.raw`\beta`}</Tex>（rad，peak）的相位 tone 調變。
                </>
              ),
            },
            {
              tex: String.raw`=\cos\omega_0t\,\cos(\beta\sin\omega_mt)-\sin\omega_0t\,\sin(\beta\sin\omega_mt)`,
              why: <>和角公式 <Tex>{String.raw`\cos(A+B)=\cos A\cos B-\sin A\sin B`}</Tex>。</>,
            },
            {
              tex: String.raw`\approx\cos\omega_0t-\beta\,\sin\omega_mt\,\sin\omega_0t`,
              why: (
                <>
                  小角近似（泰勒一階）：<Tex>{String.raw`\beta\ll1`}</Tex> 時 <Tex>{String.raw`\cos(\cdot)\approx1`}</Tex>、<Tex>{String.raw`\sin(\cdot)\approx(\cdot)`}</Tex>。
                </>
              ),
            },
            {
              tex: String.raw`=\cos\omega_0t+\frac\beta2\cos(\omega_0+\omega_m)t-\frac\beta2\cos(\omega_0-\omega_m)t`,
              why: <>積化和差 <Tex>{String.raw`\sin A\sin B=\tfrac12[\cos(A-B)-\cos(A+B)]`}</Tex>：兩根 sideband，振幅各是載波的 <Tex>{String.raw`\beta/2`}</Tex>。</>,
            },
            {
              tex: String.raw`\text{spur}=20\log_{10}\frac{\beta}{2}=20\log_{10}\frac{${texNum(r.spur.beta)}}{2}=${texNum(r.spur.dbc, 5)}\ \mathrm{dBc}`,
              why: (
                <>
                  代入 <Tex>{String.raw`\beta=2\pi f_{\mathrm{out}}A_t`}</Tex>（<Tex>{String.raw`|T|=1`}</Tex>）。不做小角近似的 Bessel 精確值是{' '}
                  <Tex>{String.raw`20\log_{10}(J_1(\beta)/J_0(\beta))=${texNum(r.spur.dbcBessel, 5)}\,\mathrm{dBc}`}</Tex>，兩者在這個 <Tex>{String.raw`\beta`}</Tex> 下完全一致。
                </>
              ),
            },
          ]}
        />
        <CodeBlock
          source={calNoiseSrc}
          region="spur"
          path="src/simulation/models/calNoise.ts"
          title="網站實際執行的換算（第 12 章與本頁共用）"
          caption="fsToRad(t, f) 就是 $2\pi f\,t\times10^{-15}$（src/simulation/core/units.ts）：全站不手寫 1e-15。"
        />
      </Collapsible>
      <Gate min="engineer">
        <p className="small">
          <strong>工程提醒：</strong>PD 端量到的相位（以 <Tex>{String.raw`f_{\mathrm{ref}}`}</Tex> 計）乘上除頻比才是輸出端的相位；但只要一路用 fs，就不需要記這個倍率——這是全站預設用 fs 的原因。
          Jitter RMS 由相位換回時間：<Tex>{String.raw`\sigma_t=\sigma_\phi/(2\pi f_{\mathrm{out}})`}</Tex>。
        </p>
      </Gate>
      <div className="fr-topic-foot small">
        <ClaimTag kind="exact" /> <ClaimTag kind="approx" /> <SourceTag kind="illustrative" /> <PageLinks ids={['ch05', 'ch12']} /> <FormulaLinks ids={['F-12.16', 'F-12.18']} />
      </div>
    </Topic>
  )
}
