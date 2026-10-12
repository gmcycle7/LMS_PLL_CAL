import { useMemo } from 'react'
import { Callout, ClaimTag, CodeCompare, ModeGate, Quiz, Recap, Section, Tex, TexBlock } from '@/components'
import calNoiseSrc from '@/simulation/models/calNoise.ts?raw'
import { calLoop, spurBeta, spurDbcSmallAngle } from '@/simulation/models/calNoise'
import { Diagram, EX, EX_INPUT, Hand, SPUR, codeTable, md, sig } from '../common'
import { CHART_ENGINES, CHART_HAND_FLOW, CHART_HW_KNOBS } from '../diagrams'

const PATH = 'src/simulation/models/calNoise.ts'

export function S6Wrap() {
  const q = useMemo(() => {
    const half = calLoop({ ...EX_INPUT, mu: 5 })
    const n4 = calLoop({ ...EX_INPUT, N: 16384 })
    const wrong = Math.sqrt(EX.sw1Dc * EX.f3dbExact)
    const spur1 = spurDbcSmallAngle(spurBeta(13e9, 1))
    const codes = codeTable().rows.map((r) => r.inbandRms.toFixed(r.inbandRms < 0.01 ? 4 : 3)).join(' / ')
    const sumG = calLoop({ ...EX_INPUT, gmMode: 'sum' }).g
    return { half, n4, wrong, spur1, codes, sumG }
  }, [])

  return (
    <>
      <Section kind="explore" title="比較表：三個模擬引擎" level={3} id="ch12-engines">
        <p>
          {md(
            String.raw`LMS Noise Lab 用三個引擎模擬同一個校正迴路。它們的差別只有一個地方：每個 block 的 GMAC 輸出 $G$ 是怎麼產生的。`,
          )}
        </p>
        <Diagram chart={CHART_ENGINES} caption="三個模擬引擎只差在怎麼產生每個 block 的 GMAC 輸出，之後的更新完全相同。先比較三個藍色方塊。">
          <p>
            {md(
              String.raw`先看三欄各自的藍色方塊：(a) 用一條直線加上 Gaussian 雜訊 $\eta$；(b) 抽一次 Binomial 得到真的 1-bit 計數 $N_+$（$N$ 次判斷裡 $q\,x=+1$ 的次數；下面程式碼裡這個變數叫 k），所以 $G=(2N_+-N)/N$ 一定落在 $-1$ 到 $+1$ 之間；(c) 老老實實做 $N$ 個 sample。再看下面：三者都接到同一個更新 $\delta w\leftarrow\delta w+\mu G$，最後統計很多個 block 得到 $\sigma_w$ 與信賴區間。`,
            )}
          </p>
          <p>
            {md(
              String.raw`和下表的對照：圖上三個藍色方塊對應下表「每 block 做什麼」那一欄；(a) 的 $G=-K\,\delta w+\eta$ 就是 F-12.1，(b) 的機率 $\Phi(-C\,\delta w/\sigma_v)$ 是 §12.1 推導第三行的 $\Phi\big(C(a-w)/\sigma_v\big)$ 代入 $a-w=-\delta w$。`,
            )}
          </p>
        </Diagram>
        <div className="table-wrap">
          <table className="ch12-table">
            <thead>
              <tr>
                <th>引擎</th>
                <th>每 block 做什麼</th>
                <th>精確在哪</th>
                <th>近似在哪</th>
                <th>相對速度（{md('$N=4096$')}）</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>(a) 線性遞迴</td>
                <td>
                  <Tex>{String.raw`\delta w\leftarrow p\,\delta w+\mu\eta,\ \eta\sim\mathcal N(0,1/N)`}</Tex>
                </td>
                <td>就是 F-12.2 本身</td>
                <td>{md(String.raw`$K_q$ 線性化、Gaussian $\eta$（可選 colored $S_\eta$）`)}</td>
                <td>最快</td>
              </tr>
              <tr>
                <td>(b) Binomial Sign-LMS</td>
                <td>
                  <Tex>{String.raw`G=\tfrac{2\,\mathrm{Bin}(N,\Phi(-C\delta w/\sigma_v))-N}{N}`}</Tex>
                </td>
                <td>{md(String.raw`$x=\pm1$、Gaussian $v$ 時與逐 sample 同分布（含 S 曲線飽和）`)}</td>
                <td>{md(String.raw`只適用 $\pm1$ iid code、identity path $\times C$`)}</td>
                <td>快（每 block 一次精確 Binomial 抽樣）</td>
              </tr>
              <tr>
                <td>(c) 逐 sample（runBlockLms）</td>
                <td>{md('真的產生 $N$ 個 code、$v$、$q$，GMAC 累加')}</td>
                <td>任何 code / path / 延遲 / 量化（第 13 章）</td>
                <td>無（L1 模型本身）</td>
                <td>{md('慢（每 block $N$ 個 sample，約慢三個數量級）')}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <CodeCompare
          items={[
            { label: '(a) 線性化遞迴', source: calNoiseSrc, region: 'linearStep', path: PATH, note: String.raw`$G$ 是 $\delta w$ 的直線（小訊號）` },
            { label: '(b) Binomial Sign-LMS', source: calNoiseSrc, region: 'binomialStep', path: PATH, note: String.raw`$G$ 來自真的 1-bit 計數，$|G|\le1$` },
          ]}
          caption={String.raw`兩者在小訊號（$|C\,\delta w|\ll\sigma_v$：comparator 前的殘差遠小於 comparator 雜訊）時給出相同的係數雜訊（T13 測試兩者的 95% CI 都涵蓋 0.3992 fs）；差異在大偏差時才出現：線性版的 $G$ 沒有上限，偏差每個 block 平均乘上 $p$（$|p|<1$ 時指數收斂，$|p|>1$ 時才指數發散）；sign 版的 $|G|\le1$，每 block 最多走一個 learning-rate 步長。`}
        />
      </Section>

      <Section kind="explore" title="比較表：本章五組「看起來很像」的量" level={3}>
        <div className="table-wrap">
          <table className="ch12-table">
            <thead>
              <tr>
                <th>量</th>
                <th>本例值</th>
                <th>用途</th>
                <th>常見誤用</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  exact <Tex>{String.raw`f_{3\mathrm{dB}}`}</Tex>
                </td>
                <td>{(EX.f3dbExact / 1e3).toFixed(3)} kHz</td>
                <td>迴路追得多快（corner）</td>
                <td>標成「Noise BW」拿去積分（E06）</td>
              </tr>
              <tr>
                <td>ENBW</td>
                <td>{(EX.enbw / 1e3).toFixed(3)} kHz</td>
                <td>{md(String.raw`白雜訊積分：$\sigma^2=S^{(1)}(0)\cdot\mathrm{ENBW}$`)}</td>
                <td>和 −3 dB 混為一談</td>
              </tr>
              <tr>
                <td>
                  <Tex>{String.raw`\sigma_w`}</Tex>
                </td>
                <td>{EX.sigmaW.toFixed(4)} fs</td>
                <td>gain-equivalent 係數雜訊</td>
                <td>直接宣稱為 output jitter</td>
              </tr>
              <tr>
                <td>
                  <Tex>{String.raw`\delta t`}</Tex> in-band RMS
                </td>
                <td>依 code：{q.codes} fs</td>
                <td>乘上 code 後落在 PLL 頻寬內的部分</td>
                <td>忘了 code 會搬移 / 攤平頻譜</td>
              </tr>
              <tr>
                <td>{md(String.raw`$S_w(e^{j\Omega})$ vs $S^{(1)}(f)$`)}</td>
                <td>{md(String.raw`差 $10\log_{10}(f_r/2)$`)}</td>
                <td>DTFT 形式 vs 單邊 per-Hz</td>
                <td>{md(String.raw`代入 $\mathcal L(f)$ 時偏 93 dB（E28）`)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section kind="example" title="綜合手算：整條鏈自己走一遍" level={3} id="ch12-synthesis">
        <p>
          做思考題之前，先把本章的鏈從頭到尾親手算一次：comparator 雜訊 → pole → 係數雜訊 → 乘上三種 code 之後的 timing error。這一題把前面幾題串起來，每一步都是計算機按得出來的基本運算。
        </p>
        <Diagram chart={CHART_HAND_FLOW} caption="綜合手算的順序：前四步算出係數雜訊，後三步各乘上一種 code。格子裡的數字是範例的答案。">
          <p>
            {md(
              String.raw`先沿著直線由上往下算 (1) 到 (4)，得到係數雜訊 $\sigma_w$；再分三路，各算一種 code 的 $\delta t$ RMS。每一格只做計算機上的一兩個運算。`,
            )}
          </p>
          <p>
            {md(
              String.raw`和手算題的對照：圖上的編號就是下面手算題的計算順序（題目把 (3) 拆成兩步、(4) 先算 $\sigma_w^2$ 再開根號）；格子裡的數字是用預設值算出來的，可以拿來對答案。(1)、(2) 是 F-12.2 的 $p$，(4) 是 F-12.5 加 F-12.6，(5) 到 (7) 是 §12.6 的三個特例。`,
            )}
          </p>
        </Diagram>
        <Hand id="HC-12.8">
          {md(
            String.raw`把 $\mu$、$\sigma_v$、$N$、$f_s$、$f_{BW}$ 換成你自己設計的數字，先用紙筆和計算機算出三個 RMS，再對答案。想驗證思考題 2，可以回到 HC-12.3 把 $\mu$ 改成 $5$ fs 或把 $N$ 改成 $16384$。`,
          )}
        </Hand>
      </Section>

      <Section kind="example" title="思考題" level={3}>
        <Quiz
          title="思考題 1：Noise BW 的陷阱"
          question={
            <>
              某份報告寫「校正 Noise BW = {(EX.f3dbExact / 1e3).toFixed(2)} kHz」，並用 <Tex>{String.raw`\sigma_w=\sqrt{S_w^{(1)}(0)\cdot\mathrm{BW}}`}</Tex> 估計係數雜訊。會得到多少？
            </>
          }
          options={[
            { label: `${q.wrong.toFixed(3)} fs（低估約 ${((1 - q.wrong / EX.sigmaW) * 100).toFixed(0)}%）`, correct: true },
            { label: `${EX.sigmaW.toFixed(3)} fs（正確）` },
            { label: `${(EX.sigmaW * Math.SQRT2).toFixed(3)} fs（高估）` },
          ]}
          answer={
            <>
              <p>{md(String.raw`$S_w^{(1)}(0)=${sig(EX.sw1Dc, 5)}\ \mathrm{fs^2/Hz}$。乘上 $f_{3\mathrm{dB}}$ 得 $${sig(q.wrong ** 2, 5)}\ \mathrm{fs}^2$，開根號 $${sig(q.wrong, 4)}$ fs。`)}</p>
              <p>{md(String.raw`正確的是乘 ENBW：$${sig(EX.sw1Dc, 5)}\times${sig(EX.enbw, 6)}=${sig(EX.sigmaW2, 5)}\ \mathrm{fs}^2$，$\sigma_w=${sig(EX.sigmaW, 4)}$ fs。$\mathrm{ENBW}/f_{3\mathrm{dB}}\approx\pi/2$，所以變異數低估約 ${((1 - EX.f3dbExact / EX.enbw) * 100).toFixed(0)}%（E06、E10）。`)}</p>
            </>
          }
        />
        <Quiz
          title="思考題 2：learning rate 減半，或每 block 累加長度變 4 倍"
          question={<>{md(String.raw`從本例出發，(i) 把 $\mu$ 從 10 fs 減到 5 fs，(ii) 或把 $N$ 從 4096 加到 16384（$\mu$ 不變）。$\sigma_w$ 與收斂時間各變多少？`)}</>}
          answer={
            <>
              <p>
                {md(String.raw`(i) $p=${sig(q.half.p, 6)}$，$\sigma_w=${sig(q.half.sigmaW, 4)}$ fs（約 $1/\sqrt2$ 倍，因為 $\sigma_w^2\approx\mu\sigma_\eta^2/(2K)$），$\tau=${sig(q.half.tauBlocks, 4)}$ blocks（約 2 倍）。`)}
              </p>
              <p>
                {md(String.raw`(ii) $p$ 不變（$p$ 只跟 $\mu K$ 有關），$\sigma_\eta^2$ 變 $1/4$ ⇒ $\sigma_w=${sig(q.n4.sigmaW, 4)}$ fs（減半）；但 $f_u$ 變 1/4，所以以秒計的收斂時間 $\tau/f_u=${sig(q.n4.tauSeconds * 1e6, 4)}\ \mu\mathrm s$ 是原來的 4 倍。`)}
              </p>
            </>
          }
        />
        <Quiz
          title="思考題 3：哪一項會穿過 PLL？"
          question={
            <>
              Code 是非負的 DSM residue（<Tex>{String.raw`x=m+\tilde x,\ m>0`}</Tex>），係數有 10 kHz 的週期性擾動，PLL 頻寬 1 MHz。哪一個產物最容易出現在 output？
            </>
          }
          options={[
            { label: md(String.raw`$m\,\delta w$，在 10 kHz（落在 PLL 頻寬內，$|T|\approx1$）`), correct: true },
            { label: md(String.raw`$\tilde x\,\delta w$，在 DSM 高頻附近（被 $|T|^2$ 濾掉）`) },
            { label: '兩者都不會，因為 LMS 已收斂' },
          ]}
          answer={
            <p>
              {md(String.raw`$\delta t=m\,\delta w+\tilde x\,\delta w$：第一項保留 $\delta w$ 的低頻頻譜（10 kHz spur），直接被 $T$ 傳到輸出；第二項被搬到高頻、在 PD 看得到但被 $|T|^2$ 壓掉。所以 code centering 不只消除 bias（第 11 章），也消除這條直通路徑。`)}
            </p>
          }
        />
        <Quiz
          title="思考題 4：spur 計算"
          question={<>{md(String.raw`$f_{\mathrm{out}}=13$ GHz、$|T|=1$，$\delta t$ 的單頻成分 peak $A_t$ 從 0.5 fs 變成 1 fs，每個 spur 是多少 dBc？`)}</>}
          options={[{ label: `${q.spur1.toFixed(2)} dBc`, correct: true }, { label: `${(SPUR.dbc - 3.01).toFixed(2)} dBc` }, { label: `${(SPUR.dbc + 3.01).toFixed(2)} dBc` }]}
          answer={<p>{md(String.raw`振幅加倍 ⇒ $20\log_{10}2=+6.02$ dB：$${sig(SPUR.dbc, 5)}+6.02=${sig(q.spur1, 5)}$ dBc。功率加倍才是 +3 dB。`)}</p>}
        />
      </Section>

      <Recap
        title="這一課最重要的公式"
        formulas={[
          { label: md(String.raw`係數誤差遞迴（$\delta w=w-w^*$）`), tex: String.raw`\delta w_{k+1}=p\,\delta w_k+\mu\eta_k,\quad p=1-\mu K_qC` },
          { label: '雜訊轉移與 PSD（block rate）', tex: String.raw`H_{\eta\to w}=\frac{\mu}{z-p},\quad S_w=\frac{\mu^2S_\eta}{1-2p\cos\Omega+p^2}` },
          { label: '穩態係數雜訊', tex: String.raw`\sigma_w^2=\frac{\mu^2\sigma_\eta^2}{1-p^2}\approx\frac{\mu^2}{N(1-p^2)}` },
          { label: md(String.raw`頻寬：corner $\ne$ noise bandwidth`), tex: String.raw`f_{3\mathrm{dB}}=\frac{f_u}{\pi}\arcsin\frac{1-p}{2\sqrt p},\qquad \mathrm{ENBW}=\frac{f_u}{2}\cdot\frac{1-p}{1+p}` },
          { label: '乘法、multirate、輸出、spur', tex: String.raw`\delta t=x\,\delta w,\quad S^{(1)}_{\phi}=(2\pi f_{\mathrm{out}})^2|T|^2S^{(1)}_{\delta t},\quad \text{spur}=20\log_{10}\frac{\beta}{2}` },
        ]}
        points={[
          <>
            <Tex>{`\\sigma_w=${EX.sigmaW.toFixed(3)}\\ \\mathrm{fs}`}</Tex> 是 <strong>gain-equivalent</strong>，要乘上 code、經過 <Tex>T</Tex> 才是 output jitter。
          </>,
          <>
            −3 dB（{(EX.f3dbExact / 1e3).toFixed(2)} kHz）與 ENBW（{(EX.enbw / 1e3).toFixed(2)} kHz）不同；積分雜訊用 ENBW。exact −3 dB 只在 <Tex>{String.raw`p\ge3-2\sqrt2`}</Tex> 存在。
          </>,
          <>
            <Tex>{String.raw`\delta t=x\cdot\delta w`}</Tex> 是乘法：常數 code 留在低頻、tone code 搬到 <Tex>{String.raw`f_x\pm f_w`}</Tex>、白色 code 攤平。Code 的 DC 會造成低頻直通項。
          </>,
          <>{md(String.raw`block-rate 的 $S_w$ 放到 sample-rate 軸前要做 ZOH 換算（F-12.14）；DTFT PSD 換成單邊 per-Hz 要乘 $2/f_r$（否則 $\mathcal L$ 偏 93 dB）。`)}</>,
          <>{md(String.raw`PD 看 high-pass $H_{\mathrm{PD}}$、output 看 low-pass $T$：PD error 小 $\ne$ output noise 小。隨機係數雜訊是 skirt，只有相干成分才是 spur。`)}</>,
        ]}
      />

      <Section kind="diagram" title="連結到硬體" level={3} id="ch12-hardware">
        <p>
          {md(
            String.raw`把整章的雜訊鏈再畫一次，這次加上硬體上真正能調的東西：兩個暫存器（REG_GMAC_N 設定每個 block 累加的樣本數 $N$、REG_GAIN_STEP 設定 learning rate $\mu$）、DTC gain register 的位寬、code 的設計，以及 PLL 的頻寬。每個旋鈕只動到鏈上的某一格：`,
          )}
        </p>
        <Diagram chart={CHART_HW_KNOBS} caption="每個可以調的旋鈕動到雜訊鏈的哪一格：實線是雜訊走的路，虛線是旋鈕，藍色是硬體上可以調的東西。">
          <p>
            {md(
              String.raw`先由上往下看實線：comparator 前的雜訊經過 1-bit 判斷與平均變成 GMAC 雜訊 $\eta_k$，被校正迴路累積成係數雜訊 $\delta w_k$，乘上 code 變成 timing error $\delta t[n]$，最後經過 PLL 到輸出。再看五條藍色方塊拉出來的虛線：$N$ 決定 $\sigma_\eta^2$ 與 block rate $f_u$；$\mu$ 決定 pole $p$，也直接出現在 $\sigma_w^2$ 的分子；gain register 的位寬決定 $\delta w$ 是隨機雜訊還是量化的 limit cycle；code 的設計決定 $\delta t$ 的頻譜落在哪裡；PLL 頻寬決定 $T$ 放過哪些頻率。最後看由 $\sigma_v$ 拉到係數雜訊的那條虛線：1-bit 判斷之後，$\sigma_\eta^2\approx1/N$ 已經和 $\sigma_v$ 無關，$\sigma_v$ 是經由斜率 $K=K_qC=\sqrt{2/\pi}\,C/\sigma_v$ 進到 $p$，才影響 $\sigma_w$——雜訊越大、斜率越小、迴路拉回得越慢。`,
            )}
          </p>
          <p>
            {md(
              String.raw`和公式的對照：圖上實線的四個箭頭依序是 F-12.6（$\sigma_\eta^2\approx1/N$）、F-12.5（$\sigma_w^2$）、F-12.11（$\delta t=x\,\delta w$）與 F-12.17（對 $|T|^2S_{\delta t}$ 積分）；五個藍色方塊對應下面四個說明框（PLL 頻寬與 code 設計合在最後一個）。把 $K$ 代進 F-12.5 的第二種寫法 $\sigma_w^2=\mu\sigma_\eta^2/\big(K(2-\mu K)\big)$，就看得到 $\sigma_v$ 那條虛線：$\mu K\ll2$ 時 $\sigma_w^2\approx\mu\,\sigma_v\sqrt{\pi/2}\,/(2NC)$，和 $\sigma_v$、$\mu$ 成正比，和 $N$ 成反比。`,
            )}
          </p>
        </Diagram>
        <div className="ch12-hw">
          <Callout kind="info" title={md(String.raw`REG_GAIN_STEP（$\mu$）`)}>
            決定 <Tex>{'p'}</Tex> 與 <Tex>{String.raw`\sigma_w`}</Tex>：<Tex>{String.raw`\sigma_w\propto\sqrt\mu`}</Tex>、<Tex>{String.raw`\tau\propto1/\mu`}</Tex>。常見做法是 coarse（大 <Tex>{String.raw`\mu`}</Tex>）→ fine（小 <Tex>{String.raw`\mu`}</Tex>）的 gear-shifting（第 14 章）。
          </Callout>
          <Callout kind="info" title={md('REG_GMAC_N（$N$）')}>
            {md(String.raw`$\sigma_\eta^2\approx1/N$；average 與 sum 模式的 $\mu$ 差 $N$ 倍——RTL 若用 sum 而 $\mu$ 照 average 設計，$g$ 放大 $N$ 倍而發散（本例 $g=${sig(q.sumG, 4)}$，勘誤 E18）。`)}
          </Callout>
          <Callout kind="info" title="DTC gain register 位寬">
            <Tex>{String.raw`\sigma_w`}</Tex>（{EX.sigmaW.toFixed(2)} fs）若遠小於 gain LSB，量化誤差與 limit cycle 會主導（第 13 章），這時的「雜訊」是確定性的 spur 而不是 skirt。
          </Callout>
          <Callout kind="info" title="PLL 頻寬與 code 設計">
            Code centering（零均值）消除 <Tex>{String.raw`m\,\delta w`}</Tex> 直通；寬頻（白化）的 code 讓 gain noise 落到 PLL 頻寬外。
          </Callout>
        </div>
        <ModeGate min="research">
          <Callout kind="warn" title="Research 延伸（未驗證，Backlog）">
            {md(
              String.raw`一般的 colored / correlated GMAC noise（R1：以量測的 $S_\eta$ 代入 F-12.4，以 Lyapunov 方程求 $\sigma_w$；AR(1) 特例已在 §12.4 的 Research 框與 LMS Noise Lab 的 $r$ 控制項實作）、cyclostationary DSM × LMS（R2）、LMS 與直接 PD noise 的 cross-spectrum、以及 $x$ 與 $\delta w$ 不獨立時的修正。這些在本站標為`,
            )}{' '}
            <ClaimTag kind="research" />。
          </Callout>
        </ModeGate>
        <TexBlock>{String.raw`\underbrace{v}_{\sigma_v}\xrightarrow{K_q,\ N}\underbrace{\eta}_{\sigma_\eta^2\approx1/N}\xrightarrow{\mu/(z-p)}\underbrace{\delta w}_{\sigma_w}\xrightarrow{\times x}\underbrace{\delta t}_{\text{code 決定頻譜}}\xrightarrow{T(s)}\underbrace{\phi_{\mathrm{out}}}_{\text{skirt / spur}}`}</TexBlock>
      </Section>
    </>
  )
}
