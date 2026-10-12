import type { ReactNode } from 'react'
import { Callout, ClaimTag, ModelLevel, Section, Tex, type ModelLevelId } from '@/components'
import { ChLink, Diagram, ErratumNote, md } from '../common'
import { LEVEL_CHART } from '../diagrams'

interface LevelRow {
  level: ModelLevelId
  model: ReactNode
  timebase: string
  verifies: ReactNode
  /** 本站實作程度 */
  status: 'full' | 'partial' | 'none'
  site: ReactNode
  where: ReactNode
  cannot: ReactNode
}

/** 七個層級與本站的實作程度（diagrams.test.tsx 用它核對階梯圖的顏色）。 */
export const LEVEL_ROWS: LevelRow[] = [
  {
    level: 'L0',
    model: 'Scalar exact LMS / Sign-Error LMS',
    timebase: '每 sample',
    verifies: md('MSE/MAE、固定 $x$、一步更新'),
    status: 'full',
    site: 'lms.ts、lossCompare.ts、scalarStability.ts：精確遞迴、mean / mean-square / almost-sure 三種界',
    where: (
      <>
        <ChLink to="/ch/00">Ch00</ChLink>–<ChLink to="/ch/03">Ch03</ChLink>
      </>
    ),
    cannot: '任何硬體效應（comparator、block、PLL）',
  },
  {
    level: 'L1',
    model: 'Block GMAC + Gaussian Comparator',
    timebase: '每 sample + block',
    verifies: md('$N$、$\\mu$、統計增益 $K_q$、sample correlation'),
    status: 'full',
    site: 'blockLms.ts（identity path、iid / Gaussian / uniform code）、comparator.ts、calNoise.ts',
    where: (
      <>
        <ChLink to="/ch/05">Ch05</ChLink>、<ChLink to="/ch/12">Ch12</ChLink>、本頁 §6 JSON Lab
      </>
    ),
    cannot: '主 PLL 動態、colored / correlated noise、comparator 非理想',
  },
  {
    level: 'L2',
    model: md('DTC Residue + $H_\\mathrm{PD}$ / $T$'),
    timebase: 'reference / comparator clock',
    verifies: 'phase shift、delay alignment、polarity、FCW',
    status: 'partial',
    site: md('線性化 DT type-II PLL（pll.ts）、single-tone / FIR / IIR path、DSM residue（dsm.ts）、filtered-x；$H_\\mathrm{PD}$ 狀態跨 block 持續'),
    where: (
      <>
        <ChLink to="/ch/06">Ch06</ChLink>–<ChLink to="/ch/08">Ch08</ChLink>、<ChLink to="/lab">Lab</ChLink>、本頁 JSON Lab（path 不是 identity 時）
      </>
    ),
    cannot: md('BBPD 非線性 PLL、$f_s\\ne f_\\mathrm{ref}$ 的多速率、注入耦合模式'),
  },
  {
    level: 'L3',
    model: 'Multi-Parameter GOS/PHOS/Gain + Jacobian',
    timebase: 'sample + block',
    verifies: 'PE、cross-coupling、SVD、preconditioner',
    status: 'partial',
    site: md('mimo.ts、pe.ts：$2\\times2$ / 4 相數值範例、Jacobian 反例（T18）；JSON Lab 只有單一 gain，沒有多參數'),
    where: (
      <>
        <ChLink to="/ch/09">Ch09</ChLink>、<ChLink to="/ch/10">Ch10</ChLink>、<ChLink to="/case/sspll">SSPLL 案例</ChLink>
      </>
    ),
    cannot: '真實 GOS/PHOS 電路的 Jacobian（需量測）',
  },
  {
    level: 'L4',
    model: 'Noise PSD + Output Timing Error + Jitter',
    timebase: '多速率',
    verifies: 'phase noise、spur、相干性、output transfer',
    status: 'partial',
    site: md('線性化、平穩近似：block-rate AR(1) → ZOH → 乘上 code → $T(z)$（calNoise.ts）；本頁 §8 的 FFT 量測示範'),
    where: (
      <>
        <ChLink to="/ch/12">Ch12</ChLink>、本頁 §8
      </>
    ),
    cannot: 'cyclostationary 的 DSM 與 LMS 雜訊交互作用（Backlog R2）、與 PLL 直接路徑的 cross-spectrum',
  },
  {
    level: 'L5',
    model: 'Quantized / RTL-like Control',
    timebase: '精確 clock cycles',
    verifies: 'overflow、rounding、update latency、limit cycle',
    status: 'partial',
    site: '定點 gain register（blockLms quantize_physical）、bit-true GMAC（gmac.ts：條件取負、wrap、右移 rounding）、量化策略（quantizer.ts）',
    where: (
      <>
        <ChLink to="/ch/04">Ch04</ChLink>、<ChLink to="/ch/13">Ch13</ChLink>、本頁 §9
      </>
    ),
    cannot: 'bit-true RTL、SystemVerilog assertions、CDC（Backlog R9：Not implemented）',
  },
  {
    level: 'L6',
    model: 'Advanced reference PLL / DSM / FCW',
    timebase: 'PLL time step 或 reference events',
    verifies: (
      <>
        週期性、fractional pattern、模擬與物理模型比對 <ErratumNote id="E36">（原文「周期／仿真」）</ErratumNote>
      </>
    ),
    status: 'none',
    site: '只有 DSM（first-order、MASH 1-1-1）與線性化 PLL；事件級 PLL 未實作',
    where: <ChLink to="/roadmap">Research Backlog R7</ChLink>,
    cannot: '任何需要 Spectre / AMS 或量測的結論',
  },
]

const STATUS_LABEL: Record<LevelRow['status'], string> = {
  full: '✅ 已實作',
  partial: '◐ 部分（簡化版）',
  none: '✗ Not implemented（僅部分元件）',
}

/** §2 模型層級 L0–L6（規格 §15.1）與本站實作程度 */
export function S2Levels() {
  return (
    <section aria-labelledby="models-s2">
      <h2 id="models-s2">2｜模型層級 L0–L6：每一層多了什麼、本站做到哪裡（§15.1）</h2>
      <p>
        「模型層級」回答的是：<strong>這個模擬裡有哪些物理效應，所以它的結論可以推廣到哪裡</strong>。越高層的模型包含越多效應，但也越慢、越難推導；低層模型則可以寫出封閉式（例如{' '}
        <Tex>{'p=1-\\mu K_qC'}</Tex>），適合建立直覺與 sanity check。
      </p>
      <Diagram
        chart={LEVEL_CHART}
        caption="模型層級的階梯：每個箭頭代表在前一層之上再加一種效應。L0–L2 為教學模型，L4–L6 才接近架構 sign-off。綠色是本站已完整實作的層級，紅色是未實作，其餘是簡化版。"
        ariaLabel="模型層級 L0 到 L6 的包含關係圖"
      >
        <p>
          先看最長的那條主線：L0（一個係數、每個 sample 更新）→ L1（加上 1-bit comparator 與 block 平均）→ L2（加上主 PLL 的兩條路）。到 L2 之後分成三個方向，各自回答不同的問題：L3 問「好幾個參數一起學會不會互相干擾」，L4 問「輸出的
          jitter / spur 是多少」，L5 問「定點之後還對不對」。
        </p>
        <p>
          圖上的 <Tex>{'H_\\mathrm{PD}'}</Tex> 是 DTC 的殘餘誤差到 phase detector 輸出的轉移函數、<Tex>{'T'}</Tex> 是到 PLL 輸出的轉移函數（§4.1）。DTC 在 reference 的輸入端，殘餘誤差從 PD 的 reference
          輸入進入主 PLL，所以兩條路都是正號（<Tex>{'e_\\mathrm{PD}=H_\\mathrm{PD}\\,\\phi_\\mathrm{dtc}'}</Tex>、<Tex>{'\\theta_\\mathrm{fb}=T\\,\\phi_\\mathrm{dtc}'}</Tex>，推導在 §4.1）。下面的表逐列說明每一層驗證什麼、本站做到哪裡。
        </p>
      </Diagram>
      <div className="table-wrap">
        <table className="models-table models-levels">
          <thead>
            <tr>
              <th>層級</th>
              <th>模型（規格）</th>
              <th>時間基準</th>
              <th>要驗證的能力</th>
              <th>本站實作</th>
              <th>在哪裡</th>
              <th>不能用它宣稱的事</th>
            </tr>
          </thead>
          <tbody>
            {LEVEL_ROWS.map((r) => (
              <tr key={r.level} className={`models-level-${r.status}`}>
                <td>
                  <ModelLevel level={r.level} />
                </td>
                <td>{r.model}</td>
                <td>{r.timebase}</td>
                <td>{r.verifies}</td>
                <td>
                  <span className={`models-status models-status-${r.status}`}>{STATUS_LABEL[r.status]}</span>
                  <div className="small">{r.site}</div>
                </td>
                <td>{r.where}</td>
                <td className="small">{r.cannot}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Callout kind="warn" title="教學用 L0–L2 不等於可做 sign-off 的 L4–L6">
        簡化解析模型（例如一階 <Tex>{'0<g<2'}</Tex>）可以當作<strong>下限或 sanity check</strong>，但不能冒稱與 Spectre / AMS 等效。本站的 L4–L6 都是簡化版本：L4 是線性化、平穩近似；L5 不是 bit-true RTL；L6 沒有事件級 PLL。
        <ClaimTag kind="exact" /> 只代表「在指定模型中可代數推導」，不是「晶片保證」。
      </Callout>
      <Section kind="assumptions" title="怎麼選層級？" level={3}>
        <ul>
          <li>
            問「<Tex>{'\\mu'}</Tex> 該設多大、<Tex>{'N'}</Tex> 該設多大」→ <ModelLevel level="L1" /> 的封閉式就夠（Ch12、Ch14），再用 L1 Monte Carlo 驗證。
          </li>
          <li>
            問「PLL 的 phase shift 會不會讓更新反向」→ 至少 <ModelLevel level="L2" />：必須有<strong>狀態持續</strong>的 <Tex>{'H_\\mathrm{PD}(z)'}</Tex>，不能每個 block 重置。
          </li>
          <li>
            問「RTL 會不會 overflow、截斷會不會偏」→ <ModelLevel level="L5" />：必須逐 clock、逐 bit（§9）。
          </li>
          <li>
            問「output spur 是多少 dBc」→ <ModelLevel level="L4" /> 以上，而且量測方法本身要寫清楚（§8）。
          </li>
        </ul>
      </Section>
    </section>
  )
}
