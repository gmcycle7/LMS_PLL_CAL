import { useMemo } from 'react'
import { Callout, Quiz, Recap, Section, StepDerivation, Tex, TexBlock } from '@/components'
import { refValues, T13_SETUP } from '../refValues'
import { errataCoverage } from '../coverage'
import { SEVERITY_LABEL } from '../errata'
import { texHz, texNum, texPct } from '../format'
import { ErratumTag, FormulaLinks, Gate, PageLink } from '../common'

/**
 * 7 思考題與本頁必記；（Research）8 勘誤覆蓋表。
 * 題目的數字都由 refValues() 計算。
 */
export function WrapupSection() {
  const r = refValues()
  const lp = r.loop
  const u = r.units
  const N = T13_SETUP.N
  return (
    <Section kind="example" level={2} id="fr-wrapup" title="7　思考題與本頁必記">
      <Quiz
        title="思考題 1：Sum 還是 Average？"
        question={
          <>
            硬體的 GMAC accumulator 直接輸出 <Tex>{`N=${N}`}</Tex> 筆的<strong>總和</strong>，韌體卻沿用 average 模式設計的 <Tex>{String.raw`\mu=10\,\mathrm{fs}`}</Tex>（
            <Tex>{String.raw`K=${texNum(lp.K, 5)}\,\mathrm{fs^{-1}}`}</Tex>）。實際的 loop gain <Tex>{'g'}</Tex> 是多少？
          </>
        }
        options={[
          { label: <Tex>{texNum(lp.g)}</Tex> },
          { label: <Tex>{texNum(lp.gSum)}</Tex>, correct: true },
          { label: <Tex>{texNum(lp.g / N)}</Tex> },
          { label: <Tex>{texNum(lp.g * Math.sqrt(N))}</Tex> },
        ]}
        answer={
          <>
            <StepDerivation
              steps={[
                { tex: String.raw`G^{\mathrm{sum}}=N\,G^{\mathrm{avg}}`, why: '總和是平均的 N 倍。' },
                { tex: String.raw`g=\mu K N=${T13_SETUP.mu}\times${texNum(lp.K, 5)}\times${N}=${texNum(lp.gSum)}`, why: '更新式沒變，所以有效步長乘 N。' },
                { tex: String.raw`p=1-g=${texNum(lp.pSum)}`, why: <>遠在單位圓外：線性模型每個 block 誤差放大 <Tex>{texNum(Math.abs(lp.pSum))}</Tex> 倍。</> },
              ]}
            />
            <p>
              要修正就把步長除以 <Tex>{'N'}</Tex>：<Tex>{String.raw`\mu^{\mathrm{sum}}=${texNum(u.muSumEquivalent)}\,\mathrm{fs}`}</Tex>。選 <Tex>{texNum(lp.g * Math.sqrt(N))}</Tex> 的人把「雜訊以{' '}
              <Tex>{String.raw`\sqrt N`}</Tex> 成長」和「訊號以 <Tex>{'N'}</Tex> 成長」弄混了（<ErratumTag eid="E18" />）。
            </p>
          </>
        }
      />
      <Quiz
        title="思考題 2：用哪個頻寬積分？"
        question={
          <>
            你量到係數雜訊在低頻的單邊 PSD 是 <Tex>{String.raw`S_w^{(1)}(0)=${texNum(lp.sw1Dc)}\,\mathrm{fs^2/Hz}`}</Tex>，資料表寫「校正頻寬 <Tex>{texHz(lp.f3dbExact)}</Tex>」。
            請估計 <Tex>{String.raw`\sigma_w`}</Tex>。（提示：先問那個「頻寬」是哪一種。）
          </>
        }
        answer={
          <>
            <p>
              資料表的數字是 −3 dB corner。直接相乘會得到 <Tex>{String.raw`\sqrt{${texNum(lp.sw1Dc)}\times${texNum(lp.f3dbExact, 5)}}=${texNum(lp.sigmaFromF3db)}\,\mathrm{fs}`}</Tex>——
              <strong>這是錯的</strong>，因為 corner 以下只有大約一半的雜訊功率。白雜訊積分要用 ENBW：
            </p>
            <TexBlock>{String.raw`\mathrm{ENBW}=\frac{f_u}{2}\cdot\frac{1-p}{1+p}=${texHz(lp.enbw, 5)}\ \Rightarrow\ \sigma_w=\sqrt{S_w^{(1)}(0)\cdot\mathrm{ENBW}}=${texNum(lp.sigmaW)}\ \mathrm{fs}`}</TexBlock>
            <p>
              兩者差 <Tex>{texPct(1 - lp.sigmaFromF3db / lp.sigmaW, 3)}</Tex>（<ErratumTag eid="E06" />）。只知道 corner、不知道 <Tex>{'p'}</Tex> 時，慢迴路可以用{' '}
              <Tex>{String.raw`\mathrm{ENBW}\approx\frac\pi2f_{3\mathrm{dB}}`}</Tex> 估（本例 <Tex>{String.raw`\times${texNum(lp.enbwOverF3db)}`}</Tex>）。
            </p>
          </>
        }
      />
      <Quiz
        title="思考題 3：fs 換成 rad"
        question={
          <>
            <Tex>{String.raw`\sigma_w=${texNum(lp.sigmaW)}\,\mathrm{fs}`}</Tex>，PLL 的 <Tex>{String.raw`f_{\mathrm{ref}}=${texHz(u.fRef)}`}</Tex>、<Tex>{String.raw`f_{\mathrm{out}}=${texHz(r.spur.fOut)}`}</Tex>。
            在<strong>輸出端</strong>它對應幾 rad？
          </>
        }
        options={[
          { label: <Tex>{String.raw`${texNum(lp.sigmaW * u.radPerFsRef)}\,\mathrm{rad}`}</Tex> },
          { label: <Tex>{String.raw`${texNum(u.sigmaWRad)}\,\mathrm{rad}`}</Tex>, correct: true },
          { label: <Tex>{String.raw`${texNum(u.sigmaWRad * 1000)}\,\mathrm{rad}`}</Tex> },
          { label: '時間和相位不能換算' },
        ]}
        answer={
          <>
            <p>
              <Tex>{String.raw`\phi=2\pi f_{\mathrm{out}}\,\Delta t=2\pi\times${texNum(r.spur.fOut)}\times${texNum(lp.sigmaW)}\times10^{-15}=${texNum(u.sigmaWRad)}\,\mathrm{rad}`}</Tex>。第一個選項用了{' '}
              <Tex>{String.raw`f_{\mathrm{ref}}`}</Tex>（那是 PD 端的相位，差 <Tex>{String.raw`f_{\mathrm{out}}/f_{\mathrm{ref}}=${texNum(u.divRatio)}`}</Tex> 倍）；第三個漏了 <Tex>{String.raw`10^{-15}`}</Tex> 裡的三個數量級（把 fs 當成 ps）。
            </p>
            <p>
              更重要的是：這個數字<strong>還不是</strong> output jitter。<Tex>{String.raw`\sigma_w`}</Tex> 是 gain-equivalent 的係數雜訊，要先乘上 code（<Tex>{String.raw`\delta t=x\,\delta w`}</Tex>）、
              再經過 PLL 的 low-pass <Tex>{'T'}</Tex>，才是輸出看到的時間誤差（第 12 章）。
            </p>
          </>
        }
      />
      <Quiz
        title="思考題 4：code 換了尺度"
        question={
          <>
            模型裡的 code 是 unit-RMS，RTL 的 code 放大成 <Tex>{String.raw`k_x=${u.scale.kx}`}</Tex> 倍（以 LSB 計）。要維持同一個 pole，<Tex>{String.raw`\mu`}</Tex> 的數值該怎麼改？
          </>
        }
        options={[
          { label: <>不用改</> },
          { label: <>除以 <Tex>{`k_x=${u.scale.kx}`}</Tex></> },
          { label: <>除以 <Tex>{`k_x^2=${u.scale.kx ** 2}`}</Tex></>, correct: true },
          { label: <>乘以 <Tex>{`k_x=${u.scale.kx}`}</Tex></> },
        ]}
        answer={
          <>
            <p>
              code 在迴路裡出現<strong>兩次</strong>：一次在 GMAC 的乘法（<Tex>{String.raw`G\to k_xG`}</Tex>），一次在 DTC 把係數變成延遲的地方（<Tex>{String.raw`w\to w/k_x`}</Tex>）。所以{' '}
              <Tex>{String.raw`C=E[xu]\to k_x^2C`}</Tex>，<Tex>{String.raw`\mu`}</Tex> 要除以 <Tex>{'k_x^2'}</Tex>：
            </p>
            <TexBlock>{String.raw`\mu'=\frac{${T13_SETUP.mu}}{${u.scale.kx ** 2}}=${texNum(u.scale.muScaled)},\qquad g'=\mu'K_qC'=${texNum(u.scale.gScaled, 5)}=g`}</TexBlock>
            <p>
              不改的話 <Tex>{String.raw`g=${texNum(u.scale.gIfMuNotRescaled)}`}</Tex>，超過 2。這和 Part A 的結論是同一件事：<Tex>{String.raw`\mu_{\max}=2/x^2`}</Tex>，輸入放大 <Tex>{'k_x'}</Tex> 倍，步長上限縮小{' '}
              <Tex>{'k_x^2'}</Tex> 倍（<ErratumTag eid="E13" />）。
            </p>
          </>
        }
      />
      <Gate min="engineer">
        <Quiz
          title="思考題 5（Engineer）：這個迴路的 −3 dB 頻寬是多少？"
          question={
            <>
              某個設定下 <Tex>{'g=0.9'}</Tex>（<Tex>{'p=0.1'}</Tex>），<Tex>{String.raw`f_u=${texHz(lp.fu, 6)}`}</Tex>。同事用 <Tex>{String.raw`(1-p)f_u/2\pi`}</Tex> 算出 <Tex>{texHz((0.9 * lp.fu) / (2 * Math.PI))}</Tex>。這個答案對嗎？
            </>
          }
          options={[{ label: '對，這就是 −3 dB 頻寬' }, { label: <>差不多，exact 值只差幾個百分比</> }, { label: '不對：這個迴路沒有 −3 dB 點', correct: true }]}
          answer={
            <>
              <p>
                −3 dB 點要存在，必須 <Tex>{String.raw`\sin(\Omega/2)=\frac{1-p}{2\sqrt p}\le1`}</Tex>，即 <Tex>{String.raw`p\ge3-2\sqrt2\approx${texNum(lp.pMin3db)}`}</Tex>。<Tex>{'p=0.1'}</Tex> 時{' '}
                <Tex>{String.raw`\frac{0.9}{2\sqrt{0.1}}=${texNum(0.9 / (2 * Math.sqrt(0.1)))}>1`}</Tex>：<Tex>{String.raw`|H|^2`}</Tex> 從 DC 到 Nyquist 只掉了{' '}
                <Tex>{String.raw`\big(\tfrac{1+p}{1-p}\big)^2=${texNum((1.1 / 0.9) ** 2)}`}</Tex> 倍（不到 2 倍），所以沒有 corner（<ErratumTag eid="E27" />）。
              </p>
              <p>
                近似公式照樣會吐出一個數字，而且看起來很合理——這正是危險的地方。這時該報的是 ENBW：<Tex>{String.raw`\frac{f_u}{2}\cdot\frac{0.9}{1.1}=${texHz((lp.fu / 2) * (0.9 / 1.1))}`}</Tex>。
              </p>
            </>
          }
        />
      </Gate>

      <Recap
        title="這一頁最重要的公式"
        formulas={[
          { label: '極性：兩種「誤差」參考點不同、號誌相反', tex: String.raw`\boxed{\delta_k=a-w_k}\qquad\boxed{\delta w_k=w_k-w^*}` },
          { label: '單位鏈：帶單位的 $\\mu$ 變成無因次的 $g$（sum mode 再乘 $N$）', tex: String.raw`\boxed{K=K_qC\ [\mathrm{fs^{-1}}],\qquad g=\mu K\ [1],\qquad p=1-g}` },
          { label: '時間 ↔ 相位（一定要寫出是哪個頻率）', tex: String.raw`\boxed{\phi=2\pi f\,\Delta t}` },
          { label: 'PSD：DTFT 形式 ↔ 單邊 per-Hz（$f_r$ 是該序列的取樣率）', tex: String.raw`\boxed{S^{(1)}(f)=\frac{2}{f_r}\,S\big(e^{j2\pi f/f_r}\big)}` },
          {
            label: '兩種頻寬：corner 描述追蹤速度，ENBW 用來積分雜訊',
            tex: String.raw`\boxed{f_{3\mathrm{dB}}=\frac{f_u}{\pi}\arcsin\frac{1-p}{2\sqrt p}\quad(p\ge3-2\sqrt2),\qquad \mathrm{ENBW}=\frac{f_u}{2}\cdot\frac{1-p}{1+p}}`,
          },
        ]}
        points={[
          <>
            看到 <Tex>{String.raw`\delta`}</Tex> 先問是 <Tex>{'a-w'}</Tex> 還是 <Tex>{'w-w^*'}</Tex>；遞迴的 pole 不受影響，但圖上的正負號和 cross-spectrum 會反。
          </>,
          <>
            看到 <Tex>{String.raw`\mu`}</Tex> 先問三件事：<Tex>{'w'}</Tex> 的單位、GMAC 是 sum 還是 average、<Tex>{'K_q'}</Tex> 有沒有被正規化成 1。最後算出的 <Tex>{'g'}</Tex> 必須無因次。
          </>,
          <>
            索引分三種：<Tex>{'n'}</Tex>（sample，<Tex>{'f_s'}</Tex>）、<Tex>{'k'}</Tex>（block，<Tex>{'f_u=f_s/N'}</Tex>）、<Tex>{'m'}</Tex>（PVT）。同一個頻率在兩條軸上的角頻率差 <Tex>{'N'}</Tex> 倍。
          </>,
          <>
            fs 和 rad 不能直接比較；PSD 的數字要連同「單邊／雙邊、per-Hz／per-rad、哪個取樣率」一起報。
          </>,
          <>
            −3 dB corner 不是 noise bandwidth：corner 以下只有一半的雜訊。而且 <Tex>{String.raw`p<3-2\sqrt2`}</Tex> 時 corner 根本不存在。
          </>,
          <>
            單位全部正確，不代表迴路會收斂：還要 <Tex>{'C>0'}</Tex>（極性，第 6–7 章）、<Tex>{'0<g<g^*(d)'}</Tex>（穩定，第 8 章）、足夠的 PE（第 9 章）。
          </>,
        ]}
      />
      <Callout kind="info" title="連結到 PLL：這些約定在硬體的哪裡？">
        <p>
          <Tex>{String.raw`\mu`}</Tex> 的單位藏在「<span className="mono">REG_LMS_MU</span> 的 1 LSB 等於多少 fs」；sum／average 藏在 accumulator 輸出的右移量；<Tex>{'k_x'}</Tex> 藏在 DSM residue 送進 GMAC 的小數點位置；{' '}
          <Tex>{'n_c'}</Tex> 是 gain register 的 commit 時序；<Tex>{String.raw`\Delta_{\mathrm{LSB}}`}</Tex> 是 DTC gain DAC 的解析度。Design review 時把這五個數字寫成明確的換算式（
          <PageLink id="signoff" />），就能避免這一頁列出的大部分錯誤。下一步：<PageLink id="ch12" /> 把 <Tex>{String.raw`\sigma_w`}</Tex> 一路推到 PLL 輸出的 jitter 與 spur；<PageLink id="ch14" /> 用這條單位鏈設計{' '}
          <Tex>{String.raw`\mu`}</Tex> 與 <Tex>{'N'}</Tex>。
        </p>
      </Callout>
    </Section>
  )
}

/** Research：49 項勘誤各自出現在本頁的哪些表、以及哪些登錄公式 */
export function CoverageSection() {
  const cov = useMemo(() => errataCoverage(), [])
  const onPageAll = cov.every((c) => c.onPage > 0)
  return (
    <Section kind="assumptions" level={2} id="fr-coverage" title="8　勘誤覆蓋表（Research）">
      <p>
        <PageLink id="verification" /> 列出的 {cov.length} 項勘誤（docs/validation.md）中，每一項在本頁各表被引用的次數，以及全站公式登錄中帶有該勘誤註記的公式。 「本頁」欄為 0 代表這項勘誤還沒有反映在符號表、速查表、限制或術語中
        {onPageAll ? '（目前沒有這種情況）' : ''}；「公式」欄空白代表沒有任何章節把它登錄在公式上（可能只影響文字敘述或測試）。
      </p>
      <details className="fr-collapsible">
        <summary>
          展開 {cov.length} 項勘誤的覆蓋情形（符號 / 單位 / 速查 / 限制 / 術語 / 公式）
        </summary>
        <div className="fr-collapsible-body">
          <div className="table-wrap">
            <table className="fr-table fr-cov-table">
              <thead>
                <tr>
                  <th>勘誤</th>
                  <th>嚴重度</th>
                  <th>範圍</th>
                  <th>符號</th>
                  <th>單位</th>
                  <th>速查</th>
                  <th>限制</th>
                  <th>術語</th>
                  <th>登錄公式</th>
                </tr>
              </thead>
              <tbody>
                {cov.map((c) => (
                  <tr key={c.eid} className={c.onPage === 0 ? 'fr-cov-missing' : undefined} data-cov={c.eid}>
                    <td data-label="勘誤">
                      <ErratumTag eid={c.eid} />
                    </td>
                    <td data-label="嚴重度">{SEVERITY_LABEL[c.severity] ?? c.severity}</td>
                    <td data-label="範圍">{c.area}</td>
                    <td data-label="符號" className="num">
                      {c.symbols}
                    </td>
                    <td data-label="單位" className="num">
                      {c.units}
                    </td>
                    <td data-label="速查" className="num">
                      {c.quick}
                    </td>
                    <td data-label="限制" className="num">
                      {c.limits}
                    </td>
                    <td data-label="術語" className="num">
                      {c.glossary}
                    </td>
                    <td data-label="登錄公式">
                      <FormulaLinks ids={c.formulas} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </Section>
  )
}
