import { Quiz, Recap, Section, Tex } from '@/components'
import { W1, loopF3dB, typeIIFinv } from '@/simulation/models/sspll'
import { BAND, FREF_MHZ, GOS_SCAN, LOOPS, PARAMS, PRED, P_ONLY, SIM_CFG } from '../data'
import { Claim, DataTable, Diagram, fx, intervalsText, r, tx } from '../common'

/** §16 思考題 */
export function S16Quiz() {
  const Kp = Number(LOOPS.L2.params.Kp)
  const Ki = Number(LOOPS.L2.params.Ki)
  const ratio = (2 * Ki) / (2 * (2 - Kp))
  const root = Math.sqrt(ratio)
  const asin = Math.asin(root)
  const fNew = typeIIFinv(Kp, 2 * Ki) * FREF_MHZ
  const fOld = BAND.L2?.hi ?? NaN
  const n1 = PRED.large_signal_counts.L1.raw['A=inf'].periodic
  return (
    <Section kind="example" level={2} title="16. 思考題" id="cs-16">
      <Quiz
        title="思考題 1（計算）"
        question={
          <>
            把 L2 的 <Tex>{'K_i'}</Tex> 加倍、<Tex>{'K_p'}</Tex> 不變，反號帶上緣變成多少？這時一階差分還安全嗎？
          </>
        }
        answer={
          <>
            <p>
              用 §6.2 的 closed form：<Tex>{`f_{inv}=\\frac{${FREF_MHZ}}{\\pi}\\arcsin\\sqrt{\\frac{2K_i}{2(2-K_p)}}=\\frac{${FREF_MHZ}}{\\pi}\\arcsin\\sqrt{${tx(ratio, 6)}}=\\frac{${FREF_MHZ}}{\\pi}\\arcsin(${tx(root, 5)})=\\frac{${FREF_MHZ}}{\\pi}\\cdot${tx(asin, 5)}\\approx${tx(fNew, 0)}\\ \\mathrm{MHz}`}</Tex>
              （原本 {fx(fOld, 1)} MHz）。
            </p>
            <p>
              積分增益越大，雙積分器主導的頻段越寬，反號帶就越寬。一階差分：<Tex>{`K_i'=${tx(2 * Ki, 4)}\\le2K_p=${tx(2 * Kp, 3)}`}</Tex>，且 <Tex>{`K_p+K_i'/2=${tx(Kp + Ki, 3)}\\le2`}</Tex>，仍然安全（margin{' '}
              <Tex>{`K_p-K_i'/2=${tx(Kp - Ki, 4)}`}</Tex>）。可以在實驗 A 勾選「直接指定 <Tex>{'K_p'}</Tex>、<Tex>{'K_i'}</Tex>」驗證。
            </p>
          </>
        }
      />
      <Quiz
        title="思考題 2（選擇）"
        question={
          <>
            某 Type-II SSPLL 在 <Tex>{r`\alpha f_{ref}=300`}</Tex> MHz（帶外）校準得很好。切到 <Tex>{r`\alpha f_{ref}=60`}</Tex> MHz 的頻道後 PHOS 開始漂移。以下哪個做法<strong>錯誤</strong>？
          </>
        }
        options={[
          { label: '改用一階差分 regressor' },
          { label: '在 60 MHz 頻道把 PHOS 的更新符號反過來', correct: true },
          { label: 'freeze（切到帶內頻道時不再更新）' },
          { label: 'filtered-x' },
        ]}
        answer={
          <ul>
            <li>
              <strong>(B) 是錯的。</strong>反號只對 mode-1（以及 mode-7）成立，其他模態（<Tex>{r`\mathrm{Re}\,\kappa_{2..4}>0`}</Tex>）仍是正的。整個翻號會讓 m2–m4 發散。
            </li>
            <li>換到別的頻道後，m1 也會跟著錯。</li>
            <li>(A)、(D) 由 PSD 定理保證；(C) 在物理上可行，但無法追蹤 PVT。</li>
          </ul>
        }
      />
      <Quiz
        title="思考題 3（概念）"
        question={
          <>
            為什麼大訊號下 L1 的 {n1} 個反向 <Tex>{r`\alpha`}</Tex> 全部是 GOS、全部在 <Tex>{'k/8'}</Tex> 正下方，而改用 <code>ac</code> 後就消失了？
          </>
        }
        answer={
          <>
            <p>
              near-grid 時 <Tex>{r`\rho`}</Tex> 是慢斜坡，平均值約 1/2。Type-I 的 <Tex>{r`h_{PD}`}</Tex> 有長的負尾巴：
            </p>
            <ul>
              <li>
                小訊號（面積）時 <Tex>{r`C\approx\beta/(2K)>0`}</Tex>，仍然 restoring。
              </li>
              <li>
                1-bit 相關看的是<strong>同號的時間比例</strong>。raw regressor 的大 DC 讓 <Tex>{r`\langle\mathrm{sgn}(y)\,\rho\rangle`}</Tex> 被那條長尾巴的「持續時間」主導，於是變號。
              </li>
              <li>
                去掉 DC（<code>ac</code>）後，regressor 正負各半，持續時間效應抵消。
              </li>
            </ul>
            <p>
              為什麼只在 <Tex>{'k/8'}</Tex>「正下方」？那裡 <Tex>{r`\beta=\mathrm{frac}(8\alpha)\to1`}</Tex>，<Tex>{r`\rho`}</Tex> 是緩慢<strong>下降</strong>的斜坡，每 <Tex>{r`1/(1-\beta)`}</Tex> 拍向上跳回一次。Type-I 對斜率為 <Tex>{'s'}</Tex> 的斜坡，穩態響應是{' '}
              <Tex>{r`s\cdot S_\infty=s/K`}</Tex>。下降斜坡的 <Tex>{r`s=-(1-\beta)<0`}</Tex>，所以 <Tex>{'y'}</Tex> 大部分時間是負的；而 raw 的 <Tex>{r`\rho`}</Tex> 恆為正，於是 <Tex>{r`\langle\mathrm{sgn}(y)\rho\rangle<0`}</Tex>。在 <Tex>{'k/8'}</Tex>{' '}
              正上方，斜坡是上升的，<Tex>{'y'}</Tex> 大部分時間為正，所以不反號。線性相關兩側對稱（<Tex>{r`C(\beta)=C(1-\beta)>0`}</Tex>），只有 1-bit 相關才看得出方向。
            </p>
          </>
        }
      />
    </Section>
  )
}

/** §17 本課必記、§18 連結到 PLL 硬體、§19 仍未驗證的部分、§20 檔案與重現方式 */
export function S17Recap() {
  const b2 = BAND.L2
  const b3 = BAND.L3
  const m = PARAMS.map_j4096
  const scanLoops = Object.entries(GOS_SCAN).filter(([k, v]) => !k.startsWith('_') && typeof v === 'object')
  const pBw = [loopF3dB(P_ONLY.L3) * FREF_MHZ, loopF3dB(P_ONLY.L3exact) * FREF_MHZ]
  return (
    <>
      <Section kind="formula" level={2} title="17. 本課必記" id="cs-17">
        <Recap
          title="這一課最重要的公式"
          formulas={[
            { tex: r`\boxed{H_{PD}=\frac{1}{1+L}}\qquad\boxed{\mathrm{Re}H_{PD}<0\iff\mathrm{Re}L<-1\iff\mathrm{Re}T>1}`, label: '誤差到 PD 的轉移函數與反號恆等式' },
            { tex: r`\boxed{C_{ij}=\sum_\nu\overline{c^i_\nu}c^j_\nu\,\Gamma_{\rm eff}(f_\nu),\ \ \Gamma_{\rm eff}=H_{PD}\overline G}`, label: r`LMS 的平均梯度矩陣：regressor 功率對 $\Gamma_{\rm eff}$ 的加權和` },
            { tex: r`\boxed{\text{Type-II 低頻：}\ \mathrm{Re}H_{PD}\approx-\frac{\Omega^2}{K_i}}\qquad\boxed{f_{inv}=\frac{f_{ref}}{\pi}\arcsin\sqrt{\frac{K_i}{2(2-K_p)}}}`, label: 'Type-II 的反號帶從 DC 開始，上緣有 closed form' },
            { tex: `\\boxed{\\mathrm{Re}\\,\\kappa_1\\approx${tx(W1, 4)}\\,\\mathrm{Re}H_{PD}(\\alpha f_{ref})}`, label: 'PHOS mode-1：PMUX 旋轉頻率落在帶內就反號' },
            { tex: r`\boxed{\text{1diff 安全}\iff1-\cos\Omega+\mathrm{Re}\{(1-e^{-j\Omega})L\}\ge0\quad(\text{Type-II：}K_i\le2K_p,\ K_p+\tfrac{K_i}{2}\le2)}`, label: '一階差分 regressor 的安全條件' },
          ]}
          points={[
            <>
              LMS 的符號由「regressor 功率」對 <Tex>{r`\mathrm{Re}\,H_{PD}`}</Tex> 的加權平均決定，不是由 <Tex>{r`\lvert H_{PD}\rvert`}</Tex> 決定；減小 <Tex>{r`\mu`}</Tex> 改不了符號。
            </>,
            <>
              Type-II（含 CPPLL）的 PD 在低頻看到誤差的二次微分，而 <Tex>{r`\langle x\,x''\rangle<0`}</Tex>，所以從 DC 開始的反號帶無法避免。L2 為 0–{fx(b2?.hi ?? NaN, 1)} MHz、L3 為 0–{fx(b3?.hi ?? NaN, 1)} MHz。
            </>,
            <>
              PHOS mode-1 的頻率就是 PMUX 旋轉頻率 <Tex>{r`\alpha f_{ref}`}</Tex>。它落在帶內時就反號：L2 約 {intervalsText(m.L2['bands_tau0.01'], 0)} MHz、L3 約 {intervalsText(m.L3['bands_tau0.01'], 0)} MHz。<Tex>{r`\alpha\to0`}</Tex>、<Tex>{r`\tfrac14`}</Tex>、
              <Tex>{r`\tfrac12`}</Tex> 附近是 dead zone。
            </>,
            <>
              GOS 在 <Tex>{'D=0'}</Tex> 時（數值上）不反號；相關器晚一拍就會反號。
            </>,
            <>
              一階差分 regressor 把 <Tex>{r`\Gamma_{\rm eff}`}</Tex> 變成處處 <Tex>{r`\mathrm{Re}\ge0`}</Tex>（三個標稱迴路都成立；一般迴路要檢查上面的 <Tex>{r`g(\Omega)\ge0`}</Tex>），對任何 <Tex>{r`\alpha`}</Tex> 都安全，又 zero-mean。硬性前提是延遲對齊。
            </>,
            <>大訊號（1-bit）看持續時間而不是面積：raw 的 keep-out 必須用大訊號 map。</>,
            <>
              比較器 offset 是 forcing 項，不在 <Tex>{r`\mathrm{eig}(C)`}</Tex> 裡：非 zero-mean 的 regressor 一定偏，PHOS 共模一定漂移。
            </>,
          ]}
        />
      </Section>

      <Section kind="diagram" level={2} title="18. 連結到 PLL 硬體" id="cs-18">
        <p>
          前面的數學量在晶片上各是哪一塊電路？先看校正路徑上的數位硬體，再用下面的表逐項對照。
        </p>
        <Diagram id="hardware" />
        <p>
          先看 code 這一條路：分數累加器的高 3 位是 PMUX 的 select（<Tex>{'p[n]'}</Tex>，解碼成 8 條 one-hot 就是 PHOS 的 regressor），其餘低位是 DTC 的 code（<Tex>{r`\rho[n]`}</Tex>，GOS 的 regressor）；兩者要各自經過 pipeline 對齊到比較器的輸出（<Tex>{'D=0'}</Tex>），再各做一次「暫存器 + 減法器」的一階差分，才進 GMAC。再看比較器這一條路：它接在 SSPD 的
          hold 節點——那就是 PD 的輸出 <Tex>{r`e_{PD}`}</Tex>，和送進 SSCP／loop filter 的是同一個訊號——輸出的 1 bit 和 9 條 regressor 相乘累加；權重更新後要 clamp 在 DTC 的範圍內，再併進 DTC 的補償量（送進 DTC 的 code 是固定的中心值 <Tex>{'C_0'}</Tex> 減去它，§2）。兩個藍色方塊就是採用一階差分時硬體上要做對的兩件事，其他方塊原本就有。
        </p>
        <DataTable
          head={['數學量', '硬體']}
          rows={[
            [<Tex key="a">{r`H_{PD}=1/(1+L)`}</Tex>, 'SSPD 取樣值（或 CPPLL 的 PFD／CP 輸出）相對於注入誤差的閉迴路響應；比較器接在 SSPD 的 hold 節點（PD 的輸出，和送進 loop filter 的是同一個訊號）'],
            [<><Tex>{'L'}</Tex> 的 1 拍延遲</>, 'SSPD 取樣 → SSCP／gm → VCO 控制電壓生效'],
            [<Tex key="a">{r`K_p,\ K_i`}</Tex>, <>SSCP 比例路徑的 <Tex>{r`g_m R`}</Tex> 與積分電容（或數位 loop filter 的係數）乘上 <Tex>{r`K_{vco}`}</Tex> 與 SSPD 斜率 <Tex>{r`A\omega_{vco}`}</Tex>；PVT 會移動它們</>],
            [<><Tex>{r`\rho[n]`}</Tex>／<Tex>{'p[n]'}</Tex></>, '分數累加器的低位（DTC code）／高 3 位（PMUX select）'],
            [<Tex key="a">{'D'}</Tex>, 'DTC code 與 PMUX select 到比較器的數位 pipeline 延遲（兩者可能在不同 clock domain）'],
            [<Tex key="a">{r`G=1-z^{-1}`}</Tex>, '每條 regressor 一個暫存器與一個減法器（GMAC 前）'],
            ['filtered-x', <>9 條以 <Tex>{r`f_{ref}`}</Tex> 運作的數位 IIR，複製 <Tex>{r`\hat H_{PD}`}</Tex></>],
            ['P-only', '校準時凍結積分路徑：需要 dual-path loop filter 或數位 LF'],
            [<Tex key="a">{r`u_{os}`}</Tex>, '比較器 offset、SSPD／SSCP 的 DC、CP mismatch、Type-I 的 static phase error'],
            [<Tex key="a">{r`\Delta=T_{vco}/8`}</Tex>, <>PMUX 相位間隔，也是 DTC 補償量的範圍（插圖值 {SIM_CFG.deltaPs} ps）</>],
          ]}
        />
      </Section>

      <Section kind="assumptions" level={2} title="19. 仍未驗證的部分（誠實清單）" id="cs-19">
        <ol className="cs-checklist">
          <li>
            <strong>
              GOS 在 <Tex>{'D=0'}</Tex> 不反號
            </strong>
            ：{scanLoops.length} 個迴路、每個 {scanLoops[0]?.[1].n_beta.toLocaleString()} 個 <Tex>{r`\beta`}</Tex>、{scanLoops.reduce((a, [, v]) => a + v.n_negative, 0)} 個反例，但沒有一般證明。
            <Claim kind="research" />
          </li>
          <li>
            <strong>大訊號判據的範圍有限</strong>：只沿 6 個方向算割線斜率與 <Tex>{r`\kappa_\infty`}</Tex>，不是完整的非線性穩定域；吸引域邊界與模態耦合都沒有涵蓋。實際的反號幅度門檻約為 <Tex>{r`\sigma_v`}</Tex>，而{' '}
            {fx(SIM_CFG.sigmaPs * 1000, 0)} fs 是插圖值。
            <Claim kind="approx" />
          </li>
          <li>
            <strong>dead zone 的符號沒有意義</strong>：近整數、<Tex>{r`\tfrac14`}</Tex>、<Tex>{r`\tfrac12`}</Tex> 附近的 <Tex>{r`\lvert\kappa_{PHOS}\rvert\lesssim5\times10^{-3}`}</Tex>，符號隨 step response 尾巴、<Tex>{r`\sigma_v`}</Tex>、探測幅度而變。
          </li>
          <li>
            <strong>
              <Tex>{r`8\nmid Q`}</Tex> 的「一定反號」
            </strong>
            只有數值證據（非 normal 矩陣）。
            <Claim kind="approx" />
          </li>
          <li>
            <strong>1diff 的硬體前提</strong>：GOS 與 PHOS 兩條路徑的延遲對齊尚未在電路上驗證。比較器前級極點太低、或迴路延遲很長（L1 延遲 5 拍）時會失效（§11.1 的即時計算；後者是 TS port 的補充計算，golden 未涵蓋）；sampler 的 charge-sharing 記憶只有背景的 physics 審查檢查過，本頁沒有重算。
          </li>
          <li>
            <strong>P-only</strong>：<Tex>{r`C_1\gg C_2`}</Tex> 模型與精確 <Tex>{r`R\parallel C_2`}</Tex> 的 BW 不同（{fx(pBw[0], 0)} MHz 對 {fx(pBw[1], 0)} MHz）；放開積分路徑時的 transient 沒有模擬。
          </li>
          <li>
            <strong>MASH 與 PMUX 隨機旋轉</strong>：只有 sim 證據；L2-PM45 搭配 MASH 在 <Tex>{r`\alpha=0.03`}</Tex> 的發散無法解釋；隨機序列的交叉譜理論沒有做。
            <Claim kind="research" />
          </li>
          <li>
            <strong>latency 的解讀</strong>：本文假設「1 拍延遲」就是 <Tex>{'L'}</Tex> 中的 <Tex>{r`z^{-1}`}</Tex>（等效 CT 延遲 <Tex>{'T/2'}</Tex>），而且 <Tex>{'D=0'}</Tex> 已對齊。若硬體在 SSPD 之後還有<strong>額外</strong>一整拍：重新設計時帶緣變{' '}
            {fx(PARAMS.sensitivity.L2_lat2_redesign.bands[0][1], 1)} MHz；不重新設計時帶緣 {fx(PARAMS.sensitivity.L2_lat2_fixedKpKi.bands[0][1], 1)} MHz、PM {fx(PARAMS.sensitivity.L2_lat2_fixedKpKi.PM_deg, 0)}°。定性結論不變（Type-II 低頻反號；1diff、P-only
            安全）。分數拍延遲的帶緣依延遲模型而定，本文不引用。
          </li>
          <li>
            <strong>比較器 offset 的 near-grid 行為</strong>：zm 在 <Tex>{r`u_{os}=100`}</Tex> fs 時是否失控，取決於有理 <Tex>{r`\alpha`}</Tex> 的側別與 seed（§13），屬於邊際行為。
            <Claim kind="approx" />
          </li>
          <li>
            <strong>沒有建模的項目</strong>：DTC INL、PMUX offset 的 PVT 時變、LMS 字長、SSPD 正弦增益以外的非線性、SSPD／DTC 範圍飽和的動態、FLL dead zone 與校準的交互、PMUX 切換 glitch、CPPLL 在 PMUX wrap 時的 cycle-swallow、比較器 hysteresis 或 metastability
            造成的記憶。（golden 的 <code>params.json</code> 也列了：{PARAMS.assumptions.not_modelled.join('、')}。）
          </li>
          <li>
            <strong>本頁的即時模擬（實驗 C）</strong>是線性、無界模型的 TS port，沒有做 fixed-point 交叉比對；它與 golden 用不同的隨機數，只在統計上一致。
          </li>
          <li>
            <strong>輸出 spur／jitter（§15.4）</strong>只用線性化的 <Tex>{'T'}</Tex> 與小角 PM：沒有 SSPD 的正弦非線性、沒有 reference spur、沒有 VCO 本身的 phase noise；PVT 只掃了 loop gain 的角落，PMUX offset 的時變沒有建模。穩態權重雜訊（F-CS.23）假設 GMAC 雜訊白色、由比較器主導，只在 TS 模擬上核對過（2000–8000 blocks、4 lanes 時 1.5% 內），沒有 golden 的對應。
            <Claim kind="approx" />
          </li>
        </ol>
      </Section>

      <Section kind="example" level={2} title="20. 檔案與重現方式" id="cs-20">
        <DataTable
          head={['檔案', '內容']}
          rows={[
            [<code key="a">docs/analysis/sspll-gos-phos-polarity.md</code>, '完整的分析文件（本頁的來源；經過對抗審查）'],
            [<code key="a">analysis/sspll/golden/sspll_golden/</code>, 'Python golden model（loops、regressors、predictions、simulator）'],
            [<code key="a">analysis/sspll/golden/test_sspll_*.py</code>, <>64 個 <code>test_SSPLL_*</code>（<code>npm run golden:sspll</code>）</>],
            [<code key="a">analysis/sspll/golden/results/*.json</code>, '文件的數字、手算例、GOS 猜想掃描、sim 的 MASH／隨機旋轉結果'],
            [<code key="a">src/data/sspll/params.json</code>, `參數、假設、約定、closed form、帶緣、對策 kernel（golden ${PARAMS.generated.golden_version}，${PARAMS.generated.date}）`],
            [<code key="a">src/data/sspll/hpd_L{'{1,2,3}'}.json</code>, <><Tex>{r`H_{PD}`}</Tex> 網格（1500 點）與各對策的 <Tex>{r`\mathrm{Re}\Gamma`}</Tex></>],
            [<code key="a">src/data/sspll/signmap_L{'{1,2,3}'}.json</code>, '$\\alpha$ sign map（2000 點）：GOS、PHOS 各模態、大訊號、各對策'],
            [<code key="a">src/data/sspll/pred_vs_sim.json</code>, '預測與模擬的對照、計數、LMS 軌跡'],
            [<code key="a">src/simulation/models/sspll.ts</code>, 'TS port（本頁所有即時計算）：迴路設計、$H_{PD}$、ergodic／精確週期的 $\\kappa$、大訊號 $\\kappa_\\infty$、對策 kernel、閉迴路 LMS'],
            [<code key="a">src/simulation/models/sspll.test.ts</code>, <><code>SSPLL: …</code> 測試：TS port 逐項對照 golden 的 JSON（<code>npx vitest run src/simulation/models/sspll.test.ts</code>）</>],
          ]}
        />
      </Section>
    </>
  )
}
