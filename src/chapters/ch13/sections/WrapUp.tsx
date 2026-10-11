import { useMemo } from 'react'
import { ClaimTag, Mermaid, ModeGate, Quiz, Recap, Section, StepDerivation, Tex, TexBlock } from '@/components'
import { bernoulliMoments, efbConstant, efbPeriod, lineSpectrum, makeGrid } from '@/simulation/models/quantizer'
import { Erratum, Hand, fx, tx } from '../common'
import { CHART_HARDWARE_MAP, CHART_SYNTHESIS_FLOW } from '../diagrams'

export function WrapUp() {
  const q = useMemo(() => {
    const o = efbConstant({ target: 32.25, steps: 12 })
    const rot = [33, 32, 33, 32, 32].map((y) => y - 32.4)
    const ls = lineSpectrum(rot)
    const m = bernoulliMoments(32, 0.25)
    const g12 = makeGrid(32.4, 'fixed', 12)
    return { o, ls, m, p12: efbPeriod(g12.W0, g12.D), K12: g12.W0 }
  }, [])

  return (
    <>
      <Section kind="example" title="綜合手算：把整章串起來" level={2} id="ch13-synthesis">
        <p>
          做思考題之前，先用一題把本章的公式串起來：同一個 <Tex>{'w^*=32.4'}</Tex>，Freeze、兩階切換（toggle / stochastic）與 ΔΣ 各留下多少 fs 的誤差？「總 RMS」與「頻帶內」是兩種不同的比法，答案的排序剛好相反。
        </p>
        <Mermaid
          chart={CHART_SYNTHESIS_FLOW}
          caption={String.raw`綜合手算的計算順序（預設數字）。先看左支（藍色）：Freeze 與兩階切換的「總 RMS」，Freeze 比較小；再看右邊兩支（綠色）：只算「頻帶內」時，Stochastic 剩 $0.0099\,\mathrm{fs}$、ΔΣ 只剩 $0.00036\,\mathrm{fs}$，排序反過來。`}
        />
        <p className="small ch13-figwalk">
          圖上每一格對應下面手算題的一到三個步驟：<Tex>{String.raw`\Delta_\mathrm{LSB}\,|\delta w|\,x_\mathrm{rms}`}</Tex> 是公式裡的 <Tex>{String.raw`\sigma_{\delta t}^{(A)}`}</Tex>，<Tex>{String.raw`e_\mathrm{rms}`}</Tex> 是兩階切換的 RMS code 誤差{' '}
          <Tex>{String.raw`\sqrt{p_0(1-p_0)}`}</Tex>，兩個 <Tex>{String.raw`P_\mathrm{in}`}</Tex> 是 §13.5a 公式 F-13.13 的頻帶內功率（<Tex>{String.raw`x_\mathrm{rms}`}</Tex> 是 DSM residue 的 RMS，<Tex>{'p_0'}</Tex> 是 <Tex>{'w^*'}</Tex> 的小數部分）。
        </p>
        <Hand id="HC-13.8">
          先照預設的數字（就是本章一路用的 worked example）用紙筆和計算機算出四個答案，再把 <Tex>{'w^*'}</Tex> 換成 32.5、<Tex>{String.raw`\Delta_\mathrm{LSB}`}</Tex> 換成你的 DTC 的 LSB，看結論會不會改變。
        </Hand>
      </Section>

      <Section kind="example" title="思考題" level={2} id="ch13-quiz">
        <Quiz
          title="思考題 1（計算）"
          question={
            <>
              <Tex>{String.raw`w_H=32.25\,\mathrm{LSB}`}</Tex>（常數）、round-half-up、<Tex>{'r[-1]=0'}</Tex> 的一階 ΔΣ，limit cycle 週期是多少？（選完再想：一個週期內輸出幾次 33？）
            </>
          }
          options={[{ label: '2' }, { label: '4', correct: true }, { label: '5' }, { label: '沒有週期（noise shaping 會打散）' }]}
          answer={
            <>
              <p>
                <Tex>{String.raw`32.25=\tfrac{129}{4}`}</Tex>（最簡分數，<Tex>{'q=4'}</Tex>）<Tex>{String.raw`\Rightarrow`}</Tex> 週期 4；平均必須是 32.25，所以 4 次裡有 1 次 33。模擬前 8 點：
                <Tex>{`y=[${q.o.y.slice(0, 8).join(',')}]`}</Tex>，<Tex>{`r=[${q.o.r.slice(0, 4).map((v) => fx(v, 2)).join(',')}]`}</Tex>，然後重複（注意 <Tex>{'v[1]=32.5'}</Tex> 是 tie，round-half-up
                進位到 33，所以整數運算很重要）。<Erratum id="E15" />
              </p>
              <TexBlock>{String.raw`r[n]\equiv(n+1)\cdot0.25\pmod 1\;\Rightarrow\;\text{週期}=4`}</TexBlock>
            </>
          }
        />
        <Quiz
          title="思考題 2（觀念）"
          question={
            <>
              把 toggle pattern 換成循環移位的 <Tex>{'[33,32,33,32,32]'}</Tex>，<Tex>{'f_u/5'}</Tex> 與 <Tex>{'2f_u/5'}</Tex> 的線功率會改變嗎？
            </>
          }
          options={[{ label: '會，順序不同頻譜就不同' }, { label: '不會，循環移位只改變相位', correct: true }, { label: '只有 DC 會改變' }]}
          answer={
            <>
              <p>
                循環移位 <Tex>{String.raw`e[n]\to e[n-n_0]`}</Tex> 讓 <Tex>{String.raw`c_k\to c_k e^{-j2\pi kn_0/5}`}</Tex>，大小不變（<Tex>{String.raw`|e^{-j\theta}|=1`}</Tex>）。計算：
                <Tex>{String.raw`P_1=${fx(q.ls[1].power, 5)},\ P_2=${fx(q.ls[2].power, 5)}\,\mathrm{LSB}^2`}</Tex>，與 <Tex>{'[32,32,33,32,33]'}</Tex> 完全相同。這也是為什麼 round-half-up 的 ΔΣ（B 的循環移位）code
                頻譜與 B 相同。但 <Tex>{'[32,32,32,33,33]'}</Tex> 不是循環移位（兩個 33 相鄰），所以能量分配不同（<Erratum id="E47" />）。
              </p>
            </>
          }
        />
        <Quiz
          title="思考題 3（計算）"
          question={
            <>
              <Tex>{'w^*=32.25'}</Tex> 用 stochastic rounding（ideal 亂數），code noise 的變異數與 RMS？若 <Tex>{String.raw`f_u=1\,\mathrm{MHz}`}</Tex>，one-sided PSD 高度是多少？
            </>
          }
          answer={
            <StepDerivation
              steps={[
                { tex: String.raw`p=0.25,\quad\mathrm{Var}=p(1-p)=0.25\times0.75=${fx(q.m.variance, 4)}\,\mathrm{LSB}^2`, why: 'Bernoulli 變異數。' },
                { tex: String.raw`\sigma=\sqrt{0.1875}=${fx(q.m.rms, 4)}\,\mathrm{LSB}`, why: '開根號。' },
                { tex: String.raw`S^{(1)}=\frac{2(0.1875)}{10^6}=${fx((2 * q.m.variance) / 1e6 * 1e7, 3)}\times10^{-7}\ \mathrm{LSB^2/Hz}`, why: tx(String.raw`白色、one-sided：$2\,\mathrm{Var}/f_u$。`) },
              ]}
            />
          }
        />
        <ModeGate min="engineer">
          <Quiz
            title="思考題 4（研究）"
            question={
              <>
                <Tex>{'w_H'}</Tex> 用 <Tex>{'F=12'}</Tex> 個小數 bit 表示 32.4，一階 ΔΣ 的週期是多少？主 tone 大約在哪裡？
              </>
            }
            options={[{ label: '5' }, { label: '1024' }, { label: String(q.p12), correct: true }, { label: '4096' }]}
            answer={
              <p>
                <Tex>{String.raw`K=\mathrm{round}(32.4\cdot2^{12})=${q.K12},\ K\bmod4096=${q.K12 % 4096},\ \gcd=${4096 / q.p12}\Rightarrow\text{週期}=4096/${4096 / q.p12}=${q.p12}`}</Tex>。
                實際值 <Tex>{String.raw`K/2^{12}=${fx(q.K12 / 4096, 10)}`}</Tex>，小數部分仍非常接近 0.4，所以主 tone 在 <Tex>{'2f_u/5'}</Tex> 附近，旁邊多出間距{' '}
                <Tex>{String.raw`f_u/${q.p12}`}</Tex> 的 sideband（§13.4 <Tex>{'F=10'}</Tex> 的例子同理）。<ClaimTag kind="exact" />
              </p>
            }
          />
        </ModeGate>
      </Section>

      <Recap
        title="這一章最重要的公式"
        formulas={[
          { label: tx(String.raw`Freeze 的 static error（$\delta w=w-w^*$ 約定；$\delta=a-w$ 反號，勘誤 E49）`), tex: String.raw`\boxed{\delta w=Q_B(w^*)-w^*=-0.4\,\mathrm{LSB},\quad E[\delta w^2]=0.16\,\mathrm{LSB}^2\ (\text{DC})}` },
          { label: '週期序列的線功率（E47）', tex: String.raw`\boxed{P_k=2|c_k|^2:\ P(f_u/5)=0.03056,\ P(2f_u/5)=0.20944,\ \textstyle\sum=0.24\,\mathrm{LSB}^2}` },
          { label: 'Stochastic rounding', tex: String.raw`\boxed{E[y]=\lfloor w\rfloor+p,\quad\mathrm{Var}(y)=p(1-p)=0.24\,\mathrm{LSB}^2}` },
          { label: '一階 EFB ΔΣ', tex: String.raw`\boxed{y[n]=w_H[n]+r[n-1]-r[n],\quad\mathrm{NTF}=1-z^{-1}}` },
          { label: 'Limit cycle 週期（E15）', tex: String.raw`\boxed{w_H=\tfrac mq\Rightarrow q;\qquad w_H=\tfrac K{2^F}\Rightarrow\tfrac{2^F}{\gcd(K\bmod2^F,2^F)}}` },
        ]}
        points={[
          <>
            平均正確 <Tex>{String.raw`\ne`}</Tex> 頻譜理想：只用 32/33、平均 32.4 的任何方案，總誤差功率都是 <Tex>{String.raw`p(1-p)=0.24\,\mathrm{LSB}^2`}</Tex>；差別只在頻率分布（Freeze 則是{' '}
            <Tex>{String.raw`0.16\,\mathrm{LSB}^2`}</Tex> 全在 DC）。
          </>,
          <>
            Toggle 的主 spur 在 <Tex>{'2f_u/5'}</Tex>（<Tex>{String.raw`0.20944\,\mathrm{LSB}^2`}</Tex>），不是 <Tex>{'f_u/5'}</Tex>；<Tex>{'f_u'}</Tex> 必須定義為 code 更新率（E47）。
          </>,
          <>
            常數有理輸入 <Tex>{'m/q'}</Tex> 時，一階 ΔΣ 必然進入週期 <Tex>{'q'}</Tex> 的 limit cycle，32.4 時與 toggle 是同一個循環（E15）；定點時週期{' '}
            <Tex>{String.raw`2^F/\gcd(K\bmod2^F,2^F)`}</Tex>。
          </>,
          <>
            ΔΣ 的優勢在時變 <Tex>{'w_H'}</Tex>：telescoping 讓平均追上 <Tex>{'w_H'}</Tex>、頻帶內幾乎只剩 LMS 雜訊；dither 打散 tone，代價是總功率與 code 擺幅。
          </>,
          <>
            LSB 要換成 fs（<Tex>{String.raw`\Delta_\mathrm{LSB}`}</Tex>，E13）、誤差要標正負號約定（E49）；最後要看 code 誤差 <Tex>{String.raw`\times`}</Tex> DSM residue 經 <Tex>{'T(f)'}</Tex> 的結果（limit cycle 的 tone 可能被混回通帶，而且會隨 FCW
            改變），並處理 saturate、anti-windup、CDC、PRBS。
          </>,
        ]}
      />

      <Section kind="diagram" title="連結到 PLL：這些數學在硬體的哪裡？" level={2} id="ch13-pll">
        <Mermaid
          chart={CHART_HARDWARE_MAP}
          caption="校正邏輯（code 更新率的 clock domain）到 DTC 與 PLL 輸出的路徑。先看左邊的框：LMS accumulator 與量化策略都在 $f_u$ domain；再看跨到右邊的那條線：6-bit code 要經過 CDC 才到 $f_s$ domain 的 gain register。"
          ariaLabel="LMS accumulator 經量化策略產生 6-bit code，跨 clock domain 到 DTC gain register，與 DSM residue 一起決定 DTC 延遲，再經 PLL 的 low-pass 到輸出"
        />
        <p className="small">
          量化誤差 <Tex>{String.raw`e=y-w^*`}</Tex> 乘上 DSM residue <Tex>{'x[n]'}</Tex>，再經 <Tex>{'T(f)'}</Tex> 到輸出；更新率 <Tex>{'f_u'}</Tex> 決定 tone 落在 <Tex>{'T(f)'}</Tex> 的通帶或阻帶。
        </p>
        <ul>
          <li>
            <Tex>{String.raw`\Delta_\mathrm{LSB}`}</Tex>：DTC gain DAC 的 LSB（fs / unit code）。LSB 越小，量化誤差越不重要；與第 12 章的 <Tex>{String.raw`\sigma_w`}</Tex> 比較才能判斷誰主導。
          </li>
          <li>
            <Tex>{'f_u'}</Tex>：每個 reference cycle 更新（toggle / limit-cycle 的 code tone 在 <Tex>{String.raw`kf_\mathrm{ref}/5`}</Tex>，本身在 <Tex>{'T(f)'}</Tex> 之外；但它與 DSM residue 的諧波混頻後，差頻會落回通帶——§13.5b
            的例子裡這反而是最大的成分）或每個 GMAC block 更新（code tone 在 <Tex>{String.raw`kf_\mathrm{ref}/(5N)`}</Tex>，直接落在 PLL 頻寬內）。哪一個比較差取決於 FCW，要先確認紀錄長於混頻週期{' '}
            <Tex>{String.raw`\mathrm{lcm}(P_\mathrm{code}N_\mathrm{upd},P_\mathrm{DSM})`}</Tex> 再比較。
          </li>
          <li>
            量化策略是一小塊 RTL：Freeze = 一個暫存器；ΔΣ = 一個 <Tex>{'B+F+1'}</Tex> bit 加法器與 <Tex>{'r'}</Tex> 暫存器；dither / stochastic = 再加一個 PRBS。
          </li>
        </ul>
        <p className="small muted">
          下一個值得研究的問題：在真實的 FCW 與 DSM（MASH 1-1-1）下，code 誤差 <Tex>{String.raw`\times`}</Tex> residue 的 cyclostationary 頻譜（規格附錄 C R2、R3），以及高階 ΔΣ quantizer 的 stability。
        </p>
      </Section>
    </>
  )
}
