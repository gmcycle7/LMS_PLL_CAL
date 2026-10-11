import { Section, SourceTag, Tex } from '@/components'
import { ChapterDiagram, FigRef, PageLink } from '../common'

/** §0.8 為什麼 LMS 重要？ */
export function WhyMattersSection() {
  return (
    <Section kind="diagram" level={2} id="ch00-why-matters" title="§0.8 為什麼 LMS 這麼重要？">
      <p>
        同一個「預測 → 比較 → 修正」迴圈，幾乎出現在所有需要「邊用邊校正」的系統裡。抽象成方塊圖，結構永遠一樣：
      </p>
      <ChapterDiagram name="CHART_ADAPTIVE_LOOP">
        <p>
          先看藍色的可調係數 <Tex>{'w'}</Tex>：輸入 <Tex>{'x'}</Tex> 經過它變成預測 <Tex>{'\\hat y'}</Tex>，在相加點以 <code>(−)</code> 進入，和以 <code>(+)</code> 進入的{' '}
          <Tex>{'y'}</Tex> 相減得到誤差 <Tex>{'e'}</Tex>。再看回授的那半圈：<Tex>{'e'}</Tex> 和 <Tex>{'x'}</Tex> 進乘法器（把兩個訊號相乘再累加，工程上叫做「相關」correlation），乘上{' '}
          <Tex>{'\\mu'}</Tex> 累加之後回去修正 <Tex>{'w'}</Tex>。
        </p>
        <p>
          這張圖只是把 §0.1 的 <FigRef name="CHART_BLACKBOX_MODEL" />（相減得到 <Tex>{'e'}</Tex>）和 §0.3 的 <FigRef name="CHART_LMS_ACCUMULATOR" />（<Tex>{'\\mu e x'}</Tex>{' '}
          累加）接成一圈；圖上的「相關 <code>e·x</code>」「× μ，再累加」合起來就是 <Tex>{'w_{n+1}=w_n+\\mu e_nx_n'}</Tex>。下面四個應用只是把 <Tex>{'x'}</Tex>、<Tex>{'e'}</Tex>、
          <Tex>{'w'}</Tex> 換成不同的實體訊號。
        </p>
      </ChapterDiagram>

      <div className="grid-2" id="ch00-app-cards">
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
      <p>
        現在回到章首的系統地圖。本章的黑盒子，在 PLL 裡每一個符號都有實體的對應——先把 §0.1 的模型換上 PLL 的名字，再看它接成的迴圈：
      </p>
      <ChapterDiagram name="CHART_BLACKBOX_TO_PLL">
        <p>
          先看最左邊：輸入 <Tex>{'x'}</Tex> 是 ΔΣ 調變器（DSM）每個週期留下的量化殘差，也就是送給 DTC 的 code <code>x[n]</code>。它分成兩條路：深灰色那條乘上未知的{' '}
          <Tex>{'a'}</Tex>——把這個 code 完全抵消所需要的「正確的 DTC gain」（單位 fs/code），<Tex>{'a\\,x_n'}</Tex> 就是量化造成、該被抵消掉的時間誤差；藍色那條乘上我們的猜測{' '}
          <Tex>{'w'}</Tex>——gain register 裡的值，<Tex>{'w\\,x_n'}</Tex> 是 DTC 實際補償掉的量。再看相加點：前者以 <code>(+)</code>、後者以 <code>(−)</code> 進入，再加上
          phase detector（PD）與比較器前的雜訊 <Tex>{'v'}</Tex>（紅色），輸出就是 PD 量到的殘留誤差。
        </p>
        <p>
          圖上的 <code>e[n] = (a − w)·x[n] + v[n]</code> 就是本章一直在用的 <Tex>{'e=(a-w)x+v'}</Tex>。和 <FigRef name="CHART_BLACKBOX_MODEL" /> 只有一個差別：那裡有兩個相加點，
          <Tex>{'y'}</Tex> 和 <Tex>{'\\hat y'}</Tex> 都看得到；PLL 裡「相減」是 DTC 在時間軸上直接做掉的，所以 <Tex>{'y'}</Tex> 與 <Tex>{'\\hat y'}</Tex> 都不會單獨出現，我們只量得到{' '}
          <Tex>{'e'}</Tex>。幸好 LMS 的修正量 <Tex>{'\\mu e x'}</Tex> 本來就只需要 <Tex>{'e'}</Tex> 和 <Tex>{'x'}</Tex>。
        </p>
      </ChapterDiagram>
      <ChapterDiagram name="CHART_PLL_LOOP">
        <p>
          先看「主 PLL 路徑」那一框：DSM 的殘差 <code>x[n]</code> 進 DTC，DTC 依 <Tex>{'w\\cdot x'}</Tex> 產生補償延遲；PD 量到補償後剩下的誤差 <code>e[n]</code>
          （就是上一張圖的輸出）。再看「LMS 校正迴路」那一框的藍色三格：比較器只留下正負號，記為 <Tex>{'q_n=\\mathrm{sign}(e_n)'}</Tex>（<Tex>{'+1'}</Tex> 或{' '}
          <Tex>{'-1'}</Tex>）；GMAC 把 <Tex>{'N'}</Tex> 筆 <Tex>{'q_nx_n'}</Tex> 取平均，記為 <Tex>{'G_k'}</Tex>；最後每 <Tex>{'N'}</Tex> 筆更新一次 <Tex>{'w'}</Tex>。
          最後看兩框之間的兩條線：主路徑把 <code>e[n]</code>、<code>x[n]</code> 交給校正迴路，校正迴路把 <Tex>{'w'}</Tex> 交回 DTC——這就是「預測 → 比較 → 修正」那一圈。
        </p>
        <p>
          注意圖上有兩種索引：<code>[n]</code> 是每一筆取樣（sample），<code>[k]</code> 是每 <Tex>{'N'}</Tex> 筆組成的一個 block——<code>x[n]、e[n]、q[n]</code> 每筆都在變，
          <code>G[k]、w[k]</code> 每個 block 才變一次。圖上的「<code>w[k+1] = w[k] + μ·G[k]</code>」就是本章的 <Tex>{'w_{n+1}=w_n+\\mu e_nx_n'}</Tex> 做了兩個替換：
          <Tex>{'e_n'}</Tex> 只留下正負號 <Tex>{'q_n'}</Tex>，而且先平均 <Tex>{'N'}</Tex> 筆（<Tex>{'G_k'}</Tex>）才更新一次。§0.9 會解釋這兩件事。
        </p>
      </ChapterDiagram>
      <p id="ch00-pll-walk">
        和 §0.2 的三個動作逐一對照：<strong>預測</strong>＝DTC 依 <Tex>{'w\\cdot x'}</Tex> 產生補償延遲；<strong>比較</strong>＝PD 量到補償後殘留的相位誤差{' '}
        <Tex>{'e=(a-w)x+v'}</Tex>，比較器只回報 <Tex>{'\\mathrm{sign}(e)'}</Tex>；<strong>修正</strong>＝GMAC 累加{' '}
        <Tex>{'\\mathrm{sign}(e)\\cdot x'}</Tex>，再乘上 <Tex>{'\\mu'}</Tex>（通常是右移）更新 gain register。真正的難題在於：比較器只有 1 bit、
        PD 看到的不是原始 <Tex>{'x'}</Tex> 而是經過 PLL 迴路濾波的版本、更新有延遲、係數只有 6 bit……這些都是後面章節的主題。
      </p>
    </Section>
  )
}
