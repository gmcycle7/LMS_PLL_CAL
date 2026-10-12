import { useMemo } from 'react'
import { Callout, ModeGate, Quiz, Recap, Tex, TexBlock } from '@/components'
import { makeTone } from '@/simulation/models/unifiedLab'
import { ChLink, md, texNum } from '../common'
import { anchorNumbers, seNumbers, spurNumbers } from '../numbers'

const T = String.raw

/** §8–§9：思考題（含解析，數字即時計算）、本頁必記、可以怎麼宣稱、下一步。 */
export function S5Wrap() {
  const a100 = useMemo(() => anchorNumbers(100), [])
  const a200 = useMemo(() => anchorNumbers(200), [])
  const se = useMemo(() => seNumbers(a100.sigmaW, a100.p, 1000), [a100])
  const q3 = useMemo(() => {
    const s = Math.sqrt(3) // unit_rms、P → ∞：1/√(1/3)
    const A1 = 1 / Math.PI
    const dA = 0.2
    const amp = dA * s * A1
    return { s, A1, dA, amp, tone: makeTone(4e5, amp, 12e9, 'closed-form') }
  }, [])
  const sp = useMemo(() => spurNumbers(), [])
  const dev = 0.09
  return (
    <>
      <section aria-labelledby="lab-s8">
        <h2 id="lab-s8">8｜思考題</h2>
        <Quiz
          title="思考題 1（計算）"
          question={
            <>
              例 B 的設定（<Tex>{`\\mu=${a100.mu}\\,\\mathrm{fs},\\ N=${a100.N}`}</Tex>、<Tex>{'\\pm1'}</Tex> code、無 PLL）。把 comparator 雜訊從 <Tex>{'100\\,\\mathrm{fs}'}</Tex> 加倍成{' '}
              <Tex>{'200\\,\\mathrm{fs}'}</Tex>，其他都不動。穩態的 <Tex>{'\\sigma_w'}</Tex> 會怎麼變？
            </>
          }
          options={[
            { label: <>加倍（約 {texNumText(2 * a100.sigmaW)} fs）：雜訊加倍，抖動就加倍</> },
            { label: <>不變：<Tex>{'q=\\pm1'}</Tex>，GMAC 的雜訊 <Tex>{'\\sigma_\\eta^2=1/N'}</Tex> 與 <Tex>{'\\sigma_v'}</Tex> 無關</> },
            { label: <>變成約 {texNumText(a200.sigmaW)} fs（約 <Tex>{'\\sqrt2'}</Tex> 倍）</>, correct: true },
            { label: <>減半：雜訊越大，dither 效果越好</> },
          ]}
          answer={
            <>
              <p>
                第二個選項說對了一半：<Tex>{'\\sigma_\\eta^2\\approx1/N'}</Tex> 確實不變。但 <Tex>{'\\sigma_v'}</Tex> 加倍讓 <Tex>{'K_q=\\sqrt{2/\\pi}/\\sigma_v'}</Tex> 減半，迴路增益 <Tex>g</Tex>{' '}
                跟著減半、pole 更靠近 1，雜訊被平均得更久但也累積得更多：
              </p>
              <TexBlock>{T`\sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2}=\frac{\mu^2\sigma_\eta^2}{g(2-g)}\approx\frac{\mu\,\sigma_\eta^2}{2K_q}\quad(g\ll1)\ \Rightarrow\ \sigma_w\propto\frac{1}{\sqrt{K_q}}\propto\sqrt{\sigma_v}`}</TexBlock>
              <p>
                數字：<Tex>{`g:\\ ${texNum(a100.g, 4)}\\to${texNum(a200.g, 4)}`}</Tex>，<Tex>{`\\tau:\\ ${texNum(a100.tau, 4)}\\to${texNum(a200.tau, 4)}`}</Tex> blocks，
                <Tex>{`\\sigma_w:\\ ${texNum(a100.sigmaW, 4)}\\to${texNum(a200.sigmaW, 4)}\\,\\mathrm{fs}`}</Tex>（比值 <Tex>{texNum(a200.sigmaW / a100.sigmaW, 4)}</Tex>，略小於 <Tex>{'\\sqrt2'}</Tex> 是因為{' '}
                <Tex>{'2-g'}</Tex> 那一項）。代價是收斂時間加倍。在 Pipeline 分頁載入「T13 錨點」再把 <Tex>{'\\sigma_v'}</Tex> 改成 200 就能驗證。
              </p>
            </>
          }
        />
        <Quiz
          title="思考題 2（觀念）"
          question={
            <>
              FCW sweep 顯示某個 FCW 的 <Tex>{'C=E[x_{\\mathrm{ref}}u_x]<0'}</Tex>（極性錯誤）。下面哪一個動作<strong>可以</strong>把極性修正回來？
            </>
          }
          options={[
            { label: <>把 <Tex>{'\\mu'}</Tex> 減半，讓迴路「慢一點、穩一點」</> },
            { label: <>把 GMAC 的 <Tex>N</Tex> 加倍，多平均一些</> },
            { label: <>降低 comparator 雜訊 <Tex>{'\\sigma_v'}</Tex></> },
            { label: <>改變 GMAC 的 code delay <Tex>D</Tex>，或改用 filtered-x regressor</>, correct: true },
          ]}
          answer={
            <>
              <p>
                <Tex>C</Tex> 是「GMAC 用的 regressor」與「PD 實際看到的 code」之間的相關，只由 code 的頻譜、<Tex>{'H_{\\mathrm{PD}}'}</Tex> 與 regressor 的選擇決定：
              </p>
              <TexBlock>{T`C_D=E\bigl[x[n-D]\;u_x[n]\bigr]=\sum_k h[k]\,R_x[k-D]`}</TexBlock>
              <p>
                <Tex>{'\\mu'}</Tex>、<Tex>N</Tex>、<Tex>{'\\sigma_v'}</Tex> 都不在式子裡。它們只改變 <Tex>{'g=\\mu K_qC'}</Tex> 的<strong>大小</strong>：<Tex>{'C<0'}</Tex> 時 pole 是{' '}
                <Tex>{'p=1+\\mu K_q|C|>1'}</Tex>，<Tex>{'\\mu'}</Tex> 減半只是讓它發散得慢一點。要改變符號，必須改 regressor（<Tex>D</Tex> 或 filtered-x）、改 code（換 FCW、換成 MASH）或改{' '}
                <Tex>{'H_{\\mathrm{PD}}'}</Tex>（PLL 的型式 / 頻寬）。把 <Tex>{'\\mu'}</Tex> 的符號反過來也行，但那只對這一個 FCW 有效。
              </p>
            </>
          }
        />
        <Quiz
          title="思考題 3（計算）"
          question={
            <>
              一階 DSM 的近整數通道，<Tex>{'f_1'}</Tex> 在 PLL 頻寬內（<Tex>{'|T(f_1)|\\approx1'}</Tex>），unit_rms 正規化（<Tex>{'s=\\sqrt3'}</Tex>），校正後殘留{' '}
              <Tex>{`|a-\\bar w|=${q3.dA}\\,\\mathrm{fs}`}</Tex>，<Tex>{'f_{\\mathrm{out}}=12\\,\\mathrm{GHz}'}</Tex>。fractional spur 大約是多少？
            </>
          }
          options={[
            { label: <>約 {texNumText(q3.tone.dbc + 20, 4)} dBc</> },
            { label: <>約 {texNumText(q3.tone.dbc + 6.02, 4)} dBc</> },
            { label: <>約 {texNumText(q3.tone.dbc, 4)} dBc</>, correct: true },
            { label: <>約 {texNumText(q3.tone.dbc - 20, 4)} dBc</> },
          ]}
          answer={
            <>
              <TexBlock>
                {T`\begin{aligned}A_{\mathrm{spur}}&=|a-\bar w|\;s\;A_1\;|T|=${q3.dA}\times\sqrt3\times\frac1\pi\times1=${texNum(q3.amp, 4)}\ \mathrm{fs}\\[2pt]\beta&=2\pi f_{\mathrm{out}}A_{\mathrm{spur}}=2\pi\times12\times10^{9}\times${texNum(q3.amp, 4)}\times10^{-15}=${texNum(2 * Math.PI * 12e9 * q3.amp * 1e-15, 4)}\ \mathrm{rad}\\[2pt]\mathrm{SSB}&\approx20\log_{10}\frac\beta2=${texNum(q3.tone.dbc, 5)}\ \mathrm{dBc}\end{aligned}`}
              </TexBlock>
              <p>
                常見的錯：忘了除以 2（每一邊的 sideband 是 <Tex>{'\\beta/2'}</Tex>，差 6 dB）；把 RMS 當 peak（差 3 dB）；或忘了把 fs 換成秒（差 300 dB，通常一眼看得出來）。這個數字是行為模型的估計（示意），不是量測值。
              </p>
            </>
          }
        />
        <Quiz
          title="思考題 4（判讀）"
          question={
            <>
              例 B 的設定，跑一個 seed、2000 個 block，後半段 1000 個 block 的平均是 <Tex>{`\\bar w=${texNum(a100.a + dev, 4)}\\,\\mathrm{fs}`}</Tex>（<Tex>{`a=${a100.a}`}</Tex>）。可以說這個校正有{' '}
              <Tex>{`+${dev}\\,\\mathrm{fs}`}</Tex> 的 bias 嗎？
            </>
          }
          options={[
            { label: <>可以：標準誤差是 <Tex>{`\\sigma_w/\\sqrt{1000}=${texNum(se.naive, 3)}\\,\\mathrm{fs}`}</Tex>，<Tex>{`${dev}\\,\\mathrm{fs}`}</Tex> 是它的 {texNumText(dev / se.naive, 3)} 倍</> },
            { label: <>不行：正確的標準誤差約 <Tex>{`${texNum(se.se, 3)}\\,\\mathrm{fs}`}</Tex>，<Tex>{`${dev}\\,\\mathrm{fs}`}</Tex> 只有 {texNumText(dev / se.se, 3)} 倍</>, correct: true },
            { label: <>不行：sign-LMS 永遠沒有 bias</> },
          ]}
          answer={
            <>
              <p>
                <Tex>{'w_k'}</Tex> 是 pole <Tex>{`${texNum(a100.p, 4)}`}</Tex> 的 AR(1)，相鄰樣本高度相關。§5.2 的結果：
              </p>
              <TexBlock>{T`\mathrm{SE}(\bar w)\approx\frac{\sigma_w}{\sqrt m}\sqrt{\frac{1+\rho}{1-\rho}}=${texNum(se.naive, 3)}\times${texNum(se.ratio, 3)}=${texNum(se.se, 3)}\ \mathrm{fs}`}</TexBlock>
              <p>
                1000 個 block 只相當於約 <Tex>{texNum(se.nEffMean, 3)}</Tex> 個獨立樣本。<Tex>{`${dev}\\,\\mathrm{fs}`}</Tex> 是 <Tex>{texNum(dev / se.se, 3)}</Tex> 個標準誤差，完全在抽樣誤差內。要回答「有沒有 bias」，用 Monte
                Carlo 分頁跑 16 個以上的 seed 看信賴區間。第三個選項也是錯的：有 INL、offset 或 0/1 編碼錯誤時 sign-LMS 的固定點確實會偏（第 11 章）。
              </p>
            </>
          }
        />
      </section>

      <section aria-labelledby="lab-s9">
        <h2 id="lab-s9">9｜本頁必記</h2>
        <Recap
          title="整條 pipeline 最重要的六個公式"
          formulas={[
            { tex: T`H_{\mathrm{PD}}=\frac{1}{1+L},\qquad T=1-H_{\mathrm{PD}}`, label: '同一個 DTC 誤差（從 PD 的 reference 輸入進來）的兩條路：PD 的輸出是 high-pass，輸出端是 low-pass' },
            { tex: T`E[G_k]\approx K_q\,C\,\delta_k,\qquad C=E[x_{\mathrm{ref}}\,u_x],\quad u_x=H_{\mathrm{PD}}\{x\}`, label: '$C$ 的正負決定更新極性；$\\mu$、$N$、$\\sigma_v$ 改不了它的符號' },
            { tex: T`g=\mu K_qC,\qquad z^{d+1}-z^d+g=0,\qquad \sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2}`, label: '迴路增益、含延遲的 pole、係數的穩態抖動' },
            { tex: T`\operatorname{Var}\bigl(T\{\delta w\,x\}\bigr)\approx\sigma_w^2\bigl(\bar x^{\,2}+\operatorname{Var}(T\{\tilde x\})\bigr)`, label: 'gain 抖動「乘上」code 才是輸出 jitter；code 的 DC 讓它直接穿過 $T$' },
            { tex: T`A_{\mathrm{spur}}=|a-\bar w|\,s\,A_1\,|T(f_1)|,\qquad \mathrm{SSB}\approx20\log_{10}(\pi f_{\mathrm{out}}A_{\mathrm{spur}})`, label: '一階 DSM 的 fractional spur：殘留的 gain 誤差 $\\times$ 鋸齒的基頻 $\\times$ PLL 的 output transfer' },
            { tex: T`\operatorname{Var}(\bar w_m)\approx\frac{\sigma_w^2}{m}\cdot\frac{1+\rho}{1-\rho}`, label: '單一 seed 的平均沒有想像中準：有效樣本數是 $m(1-\\rho)/(1+\\rho)$' },
          ]}
          points={[
            <>
              <strong>兩條路不能混</strong>：校正迴路的輸入是 PD 的輸出 <Tex>{'H_{\\mathrm{PD}}\\{e_{\\mathrm{DTC}}\\}'}</Tex>（送進 loop filter 的同一個訊號），使用者看到的是 <Tex>{'T\\{e_{\\mathrm{DTC}}\\}'}</Tex>。PD
              幾乎看不到的慢速成分，輸出端全部看得到。
            </>,
            <>
              <strong>極性是 code × PLL × regressor 的性質</strong>：同一顆晶片換一個 FCW，<Tex>C</Tex> 就可能從正變負。所以要做 FCW sweep，不是只驗一個通道。
            </>,
            <>
              <strong>三個「歸零」不是同一件事</strong>：GMAC 歸零（<Tex>{'E[G]=0'}</Tex>）<Tex>{'\\not\\Rightarrow'}</Tex> gain 誤差歸零（<Tex>{'w^*=a'}</Tex>）<Tex>{'\\not\\Rightarrow'}</Tex> 輸出乾淨（還有{' '}
              <Tex>{'\\sigma_w'}</Tex> 的抖動與 INL）。
            </>,
            <>
              <strong>穩定不等於學得到</strong>：<Tex>{'\\rho<1'}</Tex> 但 <Tex>{'\\lambda_{\\min}\\approx0'}</Tex> 或 <Tex>{'C\\to0^+'}</Tex> 時，迴路「穩定」卻要等上千個 block，bias 還被 <Tex>{'1/C'}</Tex> 放大。
            </>,
            <>
              <strong>每個「一致」都要有判據</strong>：跨級一致性是逐位元（容差 0）；mean <Tex>w</Tex> 用 AR(1) 的標準誤差；<Tex>{'\\sigma_w'}</Tex> 樣本不夠就標「不適用」而不是硬給綠燈。
            </>,
          ]}
        />

        <h3>用 Lab 的結果可以怎麼說、不可以怎麼說</h3>
        <div className="grid-2">
          <Callout kind="ok" title="可以這樣寫">
            <ul className="small">
              <li>{md(`「在這個線性 DT PLL 模型、這組參數下，$C>0$ 且 $\\rho=${texNum(a100.p, 2)}<1$：一階平均模型在固定點附近收斂。」`)}</li>
              <li>{md('「16 個 seeds 的 mean $w$ 的 95% 信賴區間包含線性模型的預測；沒有 run 發散或飽和。」')}</li>
              <li>{md('「FCW sweep 掃了 $n$ 個點，其中 $m$ 個 $C\\le0$（列出是哪幾個 $\\alpha$）；這些通道需要不同的 code delay 或 filtered-x。」')}</li>
              <li>{md(`「行為模型估計：殘留 $${sp.deltaA}\\,\\mathrm{fs}$ 的 gain 誤差在 $\\alpha=${texNum(sp.frac)}$ 的通道對應約 $${texNum(sp.tone.dbc, 4)}\\,\\mathrm{dBc}$ 的 fractional spur（線性 PLL、只計 DTC 殘差）。」`)}</li>
            </ul>
          </Callout>
          <Callout kind="danger" title="不可以這樣寫">
            <ul className="small">
              <li>「Lab 顯示收斂，所以這顆晶片在所有 FCW、所有 corner 都會收斂。」</li>
              <li>{md('「GMAC 輸出為零，所以 DTC gain 沒有誤差、spur 都消失了。」')}</li>
              <li>「模擬的 spur 是多少 dBc，所以量測也會是多少 dBc。」（模型沒有 INL、mismatch、supply coupling）</li>
              <li>「重播一致，所以模型是對的。」（它只證明兩份程式算的是同一件事）</li>
            </ul>
          </Callout>
        </div>
        <ModeGate min="research">
          <Callout kind="info" title="Research：這個整合模型還缺什麼">
            <ul className="small">
              <li>
                {md(
                  '**多速率與注入點**：本頁照全站的約定——DTC 在 reference 輸入端，$e_{\\mathrm{DTC}}$ 從 PD 的 reference 輸入注入（$u_{\\mathrm{pd}}=+H_{\\mathrm{PD}}\\{e_{\\mathrm{DTC}}\\}$、$t_{\\mathrm{out}}=+T\\{e_{\\mathrm{DTC}}\\}$），而且 $f_s=f_{\\mathrm{ref}}$。$f_s\\ne f_{\\mathrm{ref}}$、sub-sampling PD 的增益與脈衝形狀都會改變 $H_{\\mathrm{PD}}$ 的相位（第 6、7 章與案例頁）。如果殘差改從 PD 的另一個輸入（回授那一側）進來，$u_{\\mathrm{pd}}$ 與 $t_{\\mathrm{out}}$ 只會一起變號，$|H_{\\mathrm{PD}}|$、$|T|$、jitter 與 spur 都不變。',
                )}
              </li>
              <li>{md('**shared BBPD**：$q$ 就是主迴路的 phase detector 時，$E[q]=0$ 被主迴路強制，offset 不再造成 gain bias，固定點公式裡的 $E[x^2]$ 也換成 $\\mathrm{Var}(x)$（等效的 $C$ 變小；E03）。本頁的 comparator 是獨立觀測路徑。')}</li>
              <li>{md('**多參數閉迴路**：GOS / PHOS / gain 同時更新時的耦合與 preconditioner（第 9、10 章）；這裡只有線性化的秩分析。')}</li>
              <li>{md('**非 Gaussian、相關的雜訊**：VCO / reference 的 colored noise 也會進到 comparator，且與主迴路的殘差相關（規格附錄 C 的 R1、R6）。')}</li>
            </ul>
          </Callout>
        </ModeGate>
        <p>
          下一步：<ChLink to="/gallery">Experiment Gallery</ChLink>（所有 preset）、<ChLink to="/signoff">Sign-off Checklist</ChLink>（把這些檢查排成矩陣）、
          <ChLink to="/verification">T01–T18 驗證狀態與勘誤</ChLink>、<ChLink to="/case/sspll">SSPLL 案例</ChLink>（寬頻迴路下 GOS / PHOS 的極性）、<ChLink to="/roadmap">Research Backlog</ChLink>。
        </p>
      </section>
    </>
  )
}

/** 純文字的數字（選項文字用；與 texNum 同樣的有效位數） */
function texNumText(v: number, d = 4): string {
  return Number.isFinite(v) ? String(Number(v.toPrecision(d))).replace('-', '−') : String(v)
}
