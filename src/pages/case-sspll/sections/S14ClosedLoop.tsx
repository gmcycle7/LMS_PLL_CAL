import { CodeCompare, ModeGate, Section, Tex } from '@/components'
import { Diagram, FigRef, MODEL_PATH, MODEL_SRC, PY_SOURCES, TryIt, r } from '../common'
import { ClosedLoopLms } from '../experiments/ClosedLoopLms'

/**
 * 圖 sim-loop 的方塊對應到 runSspllLms 的哪幾行（逐字引用 sspll.ts；diagrams.test.tsx 檢查這些字串確實在原始碼的 signLmsBlock region 裡，
 * 程式改了測試就會提醒這裡要跟著改）。
 */
export const SIM_LOOP_CODE = {
  inject: 'u = c * Dl + eps[p] - gain * (c * Dl + W[l][p])',
  compare: 'q = Math.sign(e + sig * noise[l].normal() + uOs)',
  updateGos: 'wg[l] += (muG * G[l][0]) / nBlk',
  updatePhos: 'W[l][k] += (muP * G[l][1 + k]) / nBlk',
} as const

/** §14 程式與動手：閉迴路 sign-error LMS 的核心（含實驗 C）。 */
export function S14ClosedLoop() {
  return (
    <Section kind="explore" level={2} title="14. 動手：閉迴路 sign-error LMS 的核心" id="cs-14">
      <p>
        前面的結論都是「平均梯度的符號」。這一節用<strong>真的 1-bit 比較器</strong>把它跑出來：每一拍注入 <Tex>{r`u[n]=\rho\Delta+\varepsilon_p-(1-a)(1+w_g)(\rho\Delta+w_p)`}</Tex>，通過 <Tex>{r`h_{PD}`}</Tex>，加上雜訊取 sign，與 regressor 相乘累加成 GMAC，每{' '}
        <Tex>{'N'}</Tex> 拍更新一次權重。不同對策<strong>只差在 regressor 是怎麼來的</strong>（§11.8 的那幾個函式）；P-only 則是把迴路換掉。
      </p>
      <Diagram id="sim-loop" />
      <p>
        由上往下就是程式每一拍的順序。先看加法點：注入的誤差 <Tex>{'u[n]'}</Tex> 是「該補的量加上 PMUX 的偏差」減掉「DTC 實際補上的量」——也就是主迴路還沒反應時，§2 的 <Tex>{r`t_{ref}'-t_{fb}`}</Tex> 去掉常數 <Tex>{'T_0'}</Tex> 之後的部分（DTC 的延遲是 <Tex>{'T_0'}</Tex> 減掉補償量）。這裡用的是 §10.1 的物理注入模型，不是 §2 的理想模型：DTC 的增益 <Tex>{'(1-a)(1+w_g)'}</Tex> 同時乘在 code 與 PHOS 的修正值 <Tex>{'w_p'}</Tex> 上；把 <Tex>{'a'}</Tex>、<Tex>{'w_g'}</Tex>、<Tex>{'w_p'}</Tex>、<Tex>{r`\varepsilon_p`}</Tex> 都當成小量、只留一階，就回到 §2 的 <Tex>{r`u\approx(a-w_g)\rho\Delta+(\varepsilon_p-w_p)`}</Tex>（<Tex>{'w_p'}</Tex>{' '}
        是這一拍被選到的那一相的權重，<Tex>{r`\varepsilon_p`}</Tex> 是那一相的偏差）。再看比較器之後：<Tex>{'q[n]'}</Tex> 乘上藍色方塊產生的 <Tex>{'r[n]'}</Tex> 累加進 GMAC，每 <Tex>{'N'}</Tex> 拍把累加值除以 <Tex>{'N'}</Tex>、乘上步長加進權重，新的權重再回到 DTC 的補償量——這條回授線就是 §4{' '}
        <FigRef id="lms-loop" /> 的那一圈。圖上的加法點對應下面程式的 <code>{SIM_LOOP_CODE.inject}</code>，比較器對應 <code>{SIM_LOOP_CODE.compare}</code>，最後一格對應 <code>{SIM_LOOP_CODE.updateGos}</code> 與{' '}
        <code>{SIM_LOOP_CODE.updatePhos}</code>（<code>c</code> 是 <Tex>{r`\rho`}</Tex>、<code>Dl</code> 是 <Tex>{r`\Delta`}</Tex>、<code>l</code> 是獨立雜訊 lane 的編號）；GOS 與 PHOS 的步長 <Tex>{r`\mu_g`}</Tex>、<Tex>{r`\mu_p`}</Tex> 分開設定。
      </p>
      <CodeCompare
        items={[
          { label: 'TypeScript（網站執行）：runSspllLms', source: MODEL_SRC, region: 'signLmsBlock', path: MODEL_PATH, note: '實驗 C 在 Web Worker 中執行的就是這個函式。' },
          { label: 'Python golden：run_sign_lms', source: PY_SOURCES.simulator.source, region: 'sign_lms_block', lang: 'python', path: PY_SOURCES.simulator.path, note: '文件 §10.5、§13 的閉迴路數字由它產生（向量化、numpy RNG）。' },
        ]}
        layout="tabs"
        caption={r`兩者是同一個演算法：$q=\mathrm{sign}(e_{PD}+v+u_{os})$、$w\mathrel{+}=\mu\cdot\mathrm{mean}(q\,r)$；步長以開迴路時間常數 $N_\tau$ 決定，並對 regressor 功率做 NLMS 式正規化。隨機數產生器不同，所以逐點數值不同。`}
      />
      <ClosedLoopLms />
      <TryIt
        items={[
          <>
            預設（L2、80 MHz）載入後會自動跑一次：Case A（raw）的 PHOS 誤差一路往上爬，逼近 <Tex>{r`\Delta=T_{vco}/8`}</Tex> 的虛線（把 block 數加到 3000 就會穿過去）；Case B（一階差分）與 C（filtered-x）在幾百個 block 內降到 10 fs 以下。三者用同一顆比較器、同一組雜訊設定，只差
            regressor。交叉比對的 Monte Carlo 欄會拿即時模擬與 golden 存檔在同一個 block 的數值相比。
          </>,
          <>把迴路換成 L1（Type-I）：raw 也收斂——反號是迴路（<Tex>{r`H_{PD}`}</Tex>）造成的，不是 LMS 的錯。</>,
          <>載入「帶外：raw 正常、D = +1 與 2diff 把它弄壞」：原本好好的頻道，相關器晚一拍就發散。</>,
          <>載入「比較器 offset 25 fs」：raw 的 PHOS rms 看起來很好，但指標裡的「PHOS 共模」一直漂——eig(C) 看不到這件事（§13）。</>,
          <>
            把 <Tex>{r`N_\tau`}</Tex> 從 25 改成 5（步長變 5 倍）：收斂變快、殘餘抖動變大。再把 <Tex>{r`\alpha f_{ref}`}</Tex> 設為 132 MHz（mode-1 的 <Tex>{r`\kappa`}</Tex> 剛由負轉正的地方：<Tex>{r`\mathrm{Re}\,\kappa>0`}</Tex> 但很小、虛部卻不小）、Case A 用 raw：<Tex>{r`N_\tau=25`}</Tex> 時收斂，
            <Tex>{r`N_\tau=5`}</Tex> 時指標「有限步長的平均模型」超過 1，PHOS 誤差反而變大（§12）。這時 golden 存檔的條件不同，Monte Carlo 欄會顯示 n/a。
          </>,
          <>換一個 seed 重跑：發散／收斂的結論不變，細節不同——這是隨機模擬，結論要看趨勢與多個 seed。</>,
        ]}
      />
      <ModeGate min="research">
        <p className="small muted">
          Research 註記：TS port 的雜訊用 <code>createRng(seed).fork('comparator-noise-ℓ')</code>（xoshiro128**），golden 用 numpy 的 PCG64；步長正規化用前 <Tex>{'2^{15}'}</Tex> 拍（去掉前 <Tex>{'2^{12}'}</Tex> 拍）的 regressor 功率，與 golden 相同。這個模型是線性、無界的：沒有 SSPD 的正弦特性、DTC
          range、cycle slip 或 FLL。
        </p>
      </ModeGate>
    </Section>
  )
}
