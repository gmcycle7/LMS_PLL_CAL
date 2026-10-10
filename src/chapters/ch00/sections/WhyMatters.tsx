import { Mermaid, Section, SourceTag, Tex } from '@/components'
import { PageLink } from '../common'

const ADAPTIVE_LOOP = `flowchart LR
  X["參考輸入 x（regressor）"] --> F["可調係數 w（濾波器 / 增益）"]
  F --> P["預測 ŷ"]
  D["期望 / 量到的 y"] --> S(("比較"))
  P --> S
  S --> E["誤差 e = y − ŷ"]
  E --> M["相關 e·x（乘法）"]
  X --> M
  M --> A["× μ，累加"]
  A -->|"修正"| F`

const PLL_LOOP = `flowchart LR
  DSM["DSM 量化殘差 x"] --> DTC["DTC：延遲 = w·x"]
  DTC --> PD["相位偵測器 PD"]
  REF["參考時脈"] --> PD
  PD --> CMP["1-bit 比較器 q = sign(e)"]
  CMP --> G["GMAC：G_k = (1/N)·Σ q·x（N 筆一個 block）"]
  DSM --> G
  G --> U["每個 block 更新：w ← w + μ·G_k"]
  U --> DTC`

/** §0.8 為什麼 LMS 重要？ */
export function WhyMattersSection() {
  return (
    <Section kind="diagram" level={2} id="ch00-why-matters" title="§0.8 為什麼 LMS 這麼重要？">
      <p>
        同一個「預測 → 比較 → 修正」迴圈，幾乎出現在所有需要「邊用邊校正」的系統裡。抽象成方塊圖，結構永遠一樣：
      </p>
      <Mermaid chart={ADAPTIVE_LOOP} caption="一般化的 LMS 自適應迴圈（示意）" ariaLabel="參考輸入經可調係數產生預測，與期望值比較得到誤差，誤差與輸入相關後累加修正係數" />

      <div className="grid-2">
        <div className="card ch00-app-card">
          <h4>主動降噪耳機（ANC）</h4>
          <p>
            外側麥克風收到的環境噪音是 <Tex>{'x'}</Tex>，耳道內麥克風量到的殘餘噪音是 <Tex>{'e'}</Tex>，LMS 調整一組 FIR 係數{' '}
            <Tex>{'\\mathbf w'}</Tex> 產生「反相噪音」。因為喇叭到耳道之間還有一段聲學路徑，實務上要用 <strong>Filtered-x LMS</strong>——
            正是 <PageLink id="ch07" /> 處理 PLL error path 的同一個問題。
          </p>
        </div>
        <div className="card ch00-app-card">
          <h4>高速 SerDes 等化器（FFE / DFE）</h4>
          <p>
            接收端的取樣值（FFE）或過去判定的位元（DFE）是 <Tex>{'x'}</Tex>，slicer 的誤差是 <Tex>{'e'}</Tex>，tap 係數是{' '}
            <Tex>{'\\mathbf w'}</Tex>。為了省電路，通常只用誤差的正負號：<strong>Sign-Error / Sign-Sign LMS</strong>（<PageLink id="ch02" />）。
          </p>
        </div>
        <div className="card ch00-app-card">
          <h4>PLL / DTC 校正（本網站主角）</h4>
          <p>
            Fractional-N PLL 用 DTC 抵消 ΔΣ 調變器的量化相位誤差；DTC 的增益 <Tex>{'w'}</Tex>（fs／code）必須和真實值{' '}
            <Tex>{'a'}</Tex> 一致。量化殘差是 <Tex>{'x'}</Tex>，相位偵測器後的 1-bit 比較器給出 <Tex>{'\\mathrm{sign}(e)'}</Tex>，
            GMAC 把 <Tex>{'\\mathrm{sign}(e)\\cdot x'}</Tex> 累加後更新 <Tex>{'w'}</Tex>（<PageLink id="ch04" />、<PageLink id="ch05" />）。
          </p>
        </div>
        <div className="card ch00-app-card">
          <h4>AI 的 SGD（隨機梯度下降）</h4>
          <p>
            訓練神經網路的 SGD，就是把 §0.6 的「對單筆成本微分、往下坡走一步」用在幾百萬個參數上。mini-batch 平均 <Tex>{'N'}</Tex> 筆梯度再更新，
            和 GMAC 累加 <Tex>{'N'}</Tex> 筆再更新是同一件事；learning rate 就是 <Tex>{'\\mu'}</Tex>。
          </p>
        </div>
      </div>

      <h3>
        對照表：<Tex>{'x'}</Tex>、<Tex>{'e'}</Tex>、<Tex>{'w'}</Tex> 在不同系統裡是什麼
      </h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>應用</th>
              <th>
                輸入 <Tex>{'x'}</Tex>
              </th>
              <th>
                誤差 <Tex>{'e'}</Tex>
              </th>
              <th>
                學的東西 <Tex>{'w'}</Tex>
              </th>
              <th>
                硬體上的 <Tex>{'\\mu e x'}</Tex>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>ANC 耳機</td>
              <td>參考麥克風訊號（經 secondary path 濾波）</td>
              <td>誤差麥克風</td>
              <td>反相 FIR 係數</td>
              <td>DSP 乘加</td>
            </tr>
            <tr>
              <td>SerDes FFE / DFE</td>
              <td>取樣值 / 過去判定位元</td>
              <td>slicer error（常只取正負號）</td>
              <td>tap 權重</td>
              <td>XOR + up/down counter</td>
            </tr>
            <tr>
              <td>DTC gain 校正</td>
              <td>DSM 量化殘差（DTC code）</td>
              <td>PD 後的相位誤差，經 1-bit 比較器</td>
              <td>DTC gain（fs/code）</td>
              <td>conditional negate + accumulator（GMAC）+ shift</td>
            </tr>
            <tr>
              <td>SGD（AI）</td>
              <td>特徵 / 上一層輸出</td>
              <td>loss 對輸出的梯度</td>
              <td>網路權重</td>
              <td>GPU 矩陣乘法</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="small">
        <SourceTag kind="illustrative" /> 上表是概念對應，實際架構細節（例如 FFE 是否用 sign-sign、DTC 校正的 regressor 是否先正規化）依設計而異。
      </p>

      <h3>連結到 PLL：本網站的主迴圈</h3>
      <Mermaid chart={PLL_LOOP} caption="DTC gain 校正迴圈（簡化示意；完整版含 PLL error transfer，見 Ch04、Ch06）" ariaLabel="DSM 殘差驅動 DTC，PD 與比較器產生誤差正負號，GMAC 累加後更新 DTC 增益" />
      <p>
        和 §0.2 的三個動作逐一對照：<strong>預測</strong>＝DTC 依 <Tex>{'w\\cdot x'}</Tex> 產生補償延遲；<strong>比較</strong>＝PD 量到補償後殘留的相位誤差{' '}
        <Tex>{'e=(a-w)x+v'}</Tex>，比較器只回報 <Tex>{'\\mathrm{sign}(e)'}</Tex>；<strong>修正</strong>＝GMAC 累加{' '}
        <Tex>{'\\mathrm{sign}(e)\\cdot x'}</Tex>，再乘上 <Tex>{'\\mu'}</Tex>（通常是右移）更新 gain register。真正的難題在於：比較器只有 1 bit、
        PD 看到的不是原始 <Tex>{'x'}</Tex> 而是經過 PLL 迴路濾波的版本、更新有延遲、係數只有 6 bit……這些都是後面章節的主題。
      </p>
    </Section>
  )
}
