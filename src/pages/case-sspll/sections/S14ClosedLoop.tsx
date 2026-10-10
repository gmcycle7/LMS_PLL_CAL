import { CodeCompare, ModeGate, Section, Tex } from '@/components'
import { MODEL_PATH, MODEL_SRC, PY_SOURCES, TryIt, r } from '../common'
import { ClosedLoopLms } from '../experiments/ClosedLoopLms'

/** §14 程式與動手：閉迴路 sign-error LMS 的核心（含實驗 C）。 */
export function S14ClosedLoop() {
  return (
    <Section kind="explore" level={2} title="14. 動手：閉迴路 sign-error LMS 的核心" id="cs-14">
      <p>
        前面的結論都是「平均梯度的符號」。這一節用<strong>真的 1-bit 比較器</strong>把它跑出來：每一拍注入 <Tex>{r`u[n]=\rho\Delta+\varepsilon_p-(1-a)(1+w_g)(\rho\Delta+w_p)`}</Tex>，通過 <Tex>{r`h_{PD}`}</Tex>，加上雜訊取 sign，與 regressor 相乘累加成 GMAC，每{' '}
        <Tex>{'N'}</Tex> 拍更新一次權重。不同對策<strong>只差在 regressor 是怎麼來的</strong>（§11.8 的那幾個函式）；P-only 則是把迴路換掉。
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
