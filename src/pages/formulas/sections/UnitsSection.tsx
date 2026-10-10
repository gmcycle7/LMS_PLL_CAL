import { Callout, CodeBlock, CodeCompare, mathText, Section, Tex } from '@/components'
import unitsModelSrc from '../unitsModel.ts?raw'
import { UNIT_TOPICS, type UnitTopic } from '../searchIndex'
import { refValues, T13_SETUP } from '../refValues'
import { texNum } from '../format'
import { Collapsible, ErratumTag, MatchCount, NoMatch, scrollToId } from '../common'
import { UnitsCalculator } from '../experiments/UnitsCalculator'
import { IndexTopic, TimePhaseTopic } from './units/IndexTopic'
import { CodeUnitsTopic, MuUnitsTopic } from './units/GainTopic'
import { BandwidthTopic, MultirateTopic, PsdTopic } from './units/SpectrumTopic'
import { Topic } from './units/Topic'

/**
 * (6) 單位與時間索引約定（規格 §0、附錄 B 第 5 / 9 點；勘誤 E06、E09、E10、E13、E18、E26–E30、E33、E35、E44）。
 * 八個子題（UNIT_TOPICS）；搜尋時只顯示關鍵字符合的子題。
 */
const TOPIC_NO: Record<string, string> = { index: '2.1', timePhase: '2.2', muUnits: '2.3', codeUnits: '2.4', psd: '2.5', bw: '2.6', multirate: '2.7', calculator: '2.8' }

export function UnitsSection({ topics, searching }: { topics: UnitTopic[]; searching: boolean }) {
  const show = (id: string) => topics.some((t) => t.id === id)
  return (
    <Section kind="formula" level={2} id="fr-units" title="2　單位與時間索引約定">
      {!searching && (
        <p>
          同一個數字，換一個單位或換一條時間軸，意義就完全不同：<Tex>{String.raw`\mu=10`}</Tex> 是 10 fs 還是無因次的 10？「頻寬 12.9 kHz」是 corner 還是 noise bandwidth？PSD 是對 Hz 還是對 rad 積分？
          這一段把全站的約定一條一條推導出來，每個數字都用同一套核心現場計算，最後附一個可以自己代數字的換算器。
        </p>
      )}
      <div className="fr-section-bar">
        <MatchCount shown={topics.length} total={UNIT_TOPICS.length} active={searching} />
        <span className="fr-chip-row">
          {topics.map((t) => (
            <button key={t.id} type="button" className="fr-chip" onClick={() => scrollToId(`fr-unit-${t.id}`)} title={`捲到 §${TOPIC_NO[t.id]}`}>
              {TOPIC_NO[t.id]} {mathText(t.label)}
            </button>
          ))}
        </span>
      </div>
      {topics.length === 0 ? (
        <NoMatch what="單位子題" />
      ) : (
        <>
          {show('index') && <IndexTopic />}
          {show('timePhase') && <TimePhaseTopic />}
          {show('muUnits') && <MuUnitsTopic />}
          {show('codeUnits') && <CodeUnitsTopic />}
          {show('psd') && <PsdTopic />}
          {show('bw') && <BandwidthTopic />}
          {show('multirate') && <MultirateTopic />}
          {show('calculator') && <CalculatorTopic />}
        </>
      )}
    </Section>
  )
}

function CalculatorTopic() {
  const t = refValues().tryIt
  return (
    <Topic id="calculator" no="2.8" title="動手換算：單位與頻寬換算器">
      <p>
        前面七個子題的公式全部接在一起：左邊輸入<strong>帶單位</strong>的量，右邊看每一步的數值與單位。預設值是 T13／T14 的條件；按「Run」會用固定 seed 跑 Monte Carlo，
        檢查線性公式算出的 <Tex>{String.raw`\sigma_w`}</Tex> 與真正的 1-bit 迴路是否一致。
      </p>
      <Callout kind="info" title="試試看">
        <ol className="fr-compact">
          <li>
            載入 preset「Sum vs Average」，看 Case B：同一個 <Tex>{String.raw`\mu=${T13_SETUP.mu}\,\mathrm{fs}`}</Tex> 在 sum mode 下 <Tex>{'g'}</Tex> 變成 <Tex>{texNum(t.gSum)}</Tex>。按 Run，Case B 的 Monte
            Carlo 會標成「不做判定」並解釋原因。
          </li>
          <li>
            把 <Tex>{'N'}</Tex> 從 {T13_SETUP.N} 改成 {t.N2}：<Tex>{'g'}</Tex> 與 <Tex>{'p'}</Tex> 不變，但 <Tex>{String.raw`f_{3\mathrm{dB}}`}</Tex>（Hz）變 4 倍、<Tex>{String.raw`\sigma_w`}</Tex> 變 2 倍。想一想為什麼。
          </li>
          <li>
            把 <Tex>{String.raw`\mu`}</Tex> 拉到 <Tex>{String.raw`${t.muNo3db}\,\mathrm{fs}`}</Tex>（<Tex>{String.raw`g=${texNum(t.gNo3db, 3)}`}</Tex>）：exact −3 dB 消失，<Tex>{'(1-p)'}</Tex> 近似卻還在吐數字。再拉到{' '}
            <Tex>{String.raw`${t.muHighPass}\,\mathrm{fs}`}</Tex>（<Tex>{String.raw`g=${texNum(t.gHighPass, 3)}`}</Tex>）：變成 high-pass。
          </li>
          <li>
            把 <Tex>{String.raw`\sigma_v`}</Tex> 從 <Tex>{String.raw`${T13_SETUP.sigmaV}\,\mathrm{fs}`}</Tex> 降到 <Tex>{String.raw`${texNum(t.sigmaUnstable)}\,\mathrm{fs}`}</Tex>：comparator 雜訊<strong>變小</strong>，迴路反而
            <strong>不穩定</strong>（<Tex>{'K_q'}</Tex> 與 <Tex>{String.raw`\sigma_v`}</Tex> 成反比，同一個 <Tex>{String.raw`\mu`}</Tex> 的 <Tex>{String.raw`g=${texNum(t.gUnstable, 4)}`}</Tex> 超過 2）。
          </li>
          <li>
            把 <Tex>{'C'}</Tex> 改成 −0.5：所有單位都還是對的，但 <Tex>{'p>1'}</Tex>——單位正確不代表極性正確。
          </li>
          <li>Monte Carlo 引擎在「精確 1-bit」與「線性 AR(1)」之間切換（seed 不變），比較兩者的 z 分數。</li>
        </ol>
      </Callout>
      <UnitsCalculator />
      <h4 className="fr-sub">核心程式碼：兩個 Monte Carlo 引擎只差這兩行</h4>
      <p className="small">
        線性引擎模擬的是「公式假設的世界」（Gaussian 的 <Tex>{String.raw`\eta`}</Tex>、不會飽和的恢復力）；1-bit 引擎模擬的是「硬體實際做的事」（<Tex>{'N'}</Tex> 次比較、結果有界）。
        兩者在小訊號時應該給出相同的 <Tex>{String.raw`\sigma_w`}</Tex>——這正是交叉比對在檢查的事（<ErratumTag eid="E30" />）。
      </p>
      <CodeCompare
        caption="src/pages/formulas/unitsModel.ts（本頁的換算器實際執行的程式）。1-bit 引擎的 signGmacBlock 來自第 14 章的 optimizer.ts：$\sum q\,x=2\,\mathrm{Bin}(N,\Phi(C\delta/\sigma_v))-N$。"
        items={[
          { label: '線性 AR(1) 引擎', source: unitsModelSrc, region: 'mcLinearStep', path: 'src/pages/formulas/unitsModel.ts', note: '$\\delta_{k+1}=p\\,\\delta_k+\\mu\\eta_k$：每一步都是 $\\delta$ 的線性函數。' },
          { label: '精確 1-bit 引擎', source: unitsModelSrc, region: 'mcSignStep', path: 'src/pages/formulas/unitsModel.ts', note: '$\\delta_{k+1}=\\delta_k-\\mu G_k$，$|G_k|\\le1$：大誤差時每個 block 只能走 $\\mu$。' },
        ]}
      />
      <Collapsible
        title={
          <>
            核心程式碼：<Tex>{String.raw`|H|^2`}</Tex> 與累積功率比例 <Tex>{'F(f)'}</Tex>（圖上的兩條曲線）
          </>
        }
      >
        <CodeBlock source={unitsModelSrc} region="normalizedH2" path="src/pages/formulas/unitsModel.ts" caption="分母寫成 $(1-p)^2+4p\sin^2(\Omega/2)$：$\Omega\to0$、$p\to1$ 時不會有相消誤差。" />
        <CodeBlock
          source={unitsModelSrc}
          region="cumulativePower"
          path="src/pages/formulas/unitsModel.ts"
          caption="$F(f)=\frac2\pi\arctan\!\big(\frac{1+p}{1-p}\tan\frac\Omega2\big)$：在 $f_{3\mathrm{dB}}$ 處約 $\tfrac12$。封閉式已在 unitsModel.test.ts 與數值積分比對。"
        />
      </Collapsible>
      <Collapsible
        title={
          <>
            核心程式碼：Analytic 交叉比對怎麼「不用封閉式」求 <Tex>{String.raw`f_{3\mathrm{dB}}`}</Tex>（二分法）
          </>
        }
      >
        <CodeBlock
          source={unitsModelSrc}
          region="f3dbBisection"
          path="src/pages/formulas/unitsModel.ts"
          caption="封閉式（§2.6 的 $\arcsin$）與這個二分法互相驗算。方程式寫成 $4p\sin^2(\Omega/2)=(1-p)^2$ 是為了避免相消：慢迴路的 $\Omega_{3\mathrm{dB}}\approx1-p$ 很小，直接算 $1-2p\cos\Omega+p^2$ 會把有效位數減光。"
        />
        <p className="small">
          交叉比對的容差是相對 <Tex>{String.raw`10^{-8}`}</Tex>；<Tex>{'p'}</Tex> 很接近 <Tex>{String.raw`\pm1`}</Tex> 時再加上 <Tex>{String.raw`1-|p|`}</Tex> 本身的捨入誤差界（
          <Tex>{String.raw`\approx32\,\varepsilon_{\mathrm{mach}}/(1-|p|)`}</Tex>，<Tex>{String.raw`\varepsilon_{\mathrm{mach}}=${texNum(Number.EPSILON, 2)}`}</Tex>）——那是浮點數的極限，不是兩條公式不一致。
        </p>
      </Collapsible>
    </Topic>
  )
}
