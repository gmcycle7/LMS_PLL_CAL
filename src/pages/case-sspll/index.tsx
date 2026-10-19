import { Callout, ClaimTag, ModelLevel, SourceTag, Tex, mathText } from '@/components'
import { useSettings } from '@/app/settings'
import { BAND, PARAMS, SIM_CFG } from './data'
import { fx, r, scrollToId } from './common'
import { S00Conclusion } from './sections/S00Conclusion'
import { PageMap, S01Roadmap } from './sections/S01Roadmap'
import { S02Architecture } from './sections/S02Architecture'
import { S03Hpd } from './sections/S03Hpd'
import { S04MeanUpdate } from './sections/S04MeanUpdate'
import { S05Identity } from './sections/S05Identity'
import { S06Loops } from './sections/S06Loops'
import { S07Gos } from './sections/S07Gos'
import { S08Phos } from './sections/S08Phos'
import { S09Joint } from './sections/S09Joint'
import { S10Sim } from './sections/S10Sim'
import { S11Remedies } from './sections/S11Remedies'
import { S12FiniteStep, S13Offset } from './sections/S12S13'
import { S14ClosedLoop } from './sections/S14ClosedLoop'
import { S15Checklist } from './sections/S15Checklist'
import { S16Quiz, S17Recap } from './sections/S16Wrapup'
import { S21Symbols, SYMBOLS_ANCHOR } from './sections/S21Symbols'
import './case-sspll.css'

/** 目錄：[錨點 id, 標題]；編號就是陣列索引（0–21）。符號表在最後（docs/teaching-style.md §5）。 */
const TOC: [string, string][] = [
  ['cs-0', '0. 先講結論'],
  ['cs-1', '1. 本章路線圖'],
  ['cs-2', '2. 架構：誤差從哪裡進來'],
  ['cs-3', '3. $H_{PD}$ 的推導'],
  ['cs-4', '4. 為什麼是 $\\mathrm{Re}\\,H_{PD}$ 決定符號'],
  ['cs-5', '5. 恆等式與「微分」直覺'],
  ['cs-6', '6. 三個迴路與反號帶（實驗 A）'],
  ['cs-7', '7. GOS：鋸齒 regressor'],
  ['cs-8', '8. PHOS：circulant 與 DFT 模態（實驗 B）'],
  ['cs-9', '9. $9\\times9$ 耦合與 PSD 定理'],
  ['cs-10', '10. 模擬證據'],
  ['cs-11', '11. 對策與核心程式碼'],
  ['cs-12', '12. 有限步長'],
  ['cs-13', '13. 比較器 DC offset'],
  ['cs-14', '14. 閉迴路 LMS（實驗 C）'],
  ['cs-15', '15. checklist 與 keep-out 配方'],
  ['cs-16', '16. 思考題'],
  ['cs-17', '17. 本課必記'],
  ['cs-18', '18. 連結到 PLL 硬體'],
  ['cs-19', '19. 仍未驗證的部分'],
  ['cs-20', '20. 檔案與重現方式'],
  [SYMBOLS_ANCHOR, '21. 本章符號表'],
]

/**
 * 案例頁 /case/sspll：DTC 的 GOS 與 PMUX 的 PHOS 經過 H_PD = 1/(1 + L) 之後，sign-error LMS 為什麼會「反號」而不收斂。
 * 內容依 docs/analysis/sspll-gos-phos-polarity.md（已完成並經對抗審查的分析）；數字來自 src/data/sspll/*.json、
 * analysis/sspll/golden/results/*.json 與 TS port（src/simulation/models/sspll.ts）的即時計算。
 */
export default function CaseSspllPage() {
  const { mode } = useSettings()
  const A = PARAMS.assumptions
  return (
    <div className="case-sspll">
      <blockquote className="cs-question">
        <strong>你的問題：</strong>「DTC 的 GOS error 跟 PHOS 的 error 到 PD 輸出的 transfer function 怎麼讓這些 LMS loop 改變符號，讓他不會收斂？」——subsampling PLL，closed-loop −3 dB 頻寬 320 MHz；並把 Type-I SSPLL、Type-II SSPLL 與傳統 CPPLL
        放在一起比較。
      </blockquote>
      <PageMap />
      <p className="cs-lead">
        <strong>本頁設定</strong>：reference 頻率 <Tex>{`f_{ref}=${A.f_ref_Hz / 1e9}\\ \\mathrm{GHz}`}</Tex>（週期 <Tex>{`T_{ref}=${A.T_ref_ps}\\ \\mathrm{ps}`}</Tex>，以下把一個 <Tex>{r`T_{ref}`}</Tex> 稱為「一拍」）；閉迴路響應 <Tex>{r`T=L/(1+L)`}</Tex>（<Tex>{'L'}</Tex>{' '}
        是主迴路的開迴路增益）的 −3 dB 頻寬為 <Tex>{`${A.closed_loop_3dB_Hz / 1e6}\\ \\mathrm{MHz}`}</Tex>；SSPD 取樣到 VCO 控制生效的延遲為 1 個 reference cycle；分數除頻由 feedback 端的 <strong>8 相 PMUX</strong> 加上 reference 端的 <strong>input DTC</strong> 實現，頻率控制字{' '}
        <Tex>{r`\mathrm{FCW}=N_{int}+\alpha`}</Tex> 的小數部分記為 <Tex>{r`\alpha`}</Tex>。GOS = DTC 的 gain error；PHOS = PMUX 每一相的 phase offset。
      </p>
      <p className="small muted">
        時間索引有兩種：寫成 <Tex>{'x[n]'}</Tex> 的量每拍一個值，<Tex>{'n'}</Tex> 是比較器的取樣索引；每 <Tex>{'N'}</Tex> 拍（一個 GMAC block）才更新一次的量用 block 索引 <Tex>{'k'}</Tex>，圖上寫成 <Tex>{'[k]'}</Tex>，公式裡寫成 <Tex>{r`\delta_k\to\delta_{k+1}`}</Tex>。另外{' '}
        <Tex>{r`\varepsilon_k`}</Tex>、<Tex>{'w_k'}</Tex> 的下標 <Tex>{'k'}</Tex> 是 PMUX 的相位編號（0 到 7），看上下文分辨。
      </p>
      <div className="c-tag-row">
        <ModelLevel level="L2" /> <ModelLevel level="L3" /> <ClaimTag kind="exact" /> <ClaimTag kind="approx" /> <ClaimTag kind="research" /> <SourceTag kind="illustrative" /> <SourceTag kind="simulation" />
      </div>
      <p className="small muted">
        結論標籤與分析文件一一對應：<ClaimTag kind="exact" /> 在所述模型與假設下數學上精確；<ClaimTag kind="approx" /> 來自線性化、數值掃描或模擬，在模型外需要驗證；<ClaimTag kind="research" /> 目前只有部分證據，還沒有證明。比較器輸入雜訊的標準差 <Tex>{`\\sigma_v=${fx(SIM_CFG.sigmaPs * 1000, 0)}`}</Tex> fs、VCO 頻率 <Tex>{`f_{vco}=${A.f_vco_Hz_illustrative / 1e9}`}</Tex> GHz 等是插圖值，不是你的晶片量測。
      </p>
      {mode === 'beginner' && (
        <Callout kind="info" title="入門模式：先抓住四句話">
          <ol>
            <li>
              PD 看到的不是誤差本身，而是被迴路「吃過」的殘差：<Tex>{r`e_{PD}=h_{PD}*u`}</Tex>，<Tex>{r`H_{PD}=1/(1+L)`}</Tex>。這裡 <Tex>{'u'}</Tex> 是 DTC 與 PMUX 注入的時間誤差，<Tex>{r`e_{PD}`}</Tex> 是 PD 看到的殘差，<Tex>{r`h_{PD}`}</Tex> 是迴路對一個脈衝誤差的響應（
              <Tex>{'*'}</Tex> 是卷積），<Tex>{'L'}</Tex> 是開迴路增益。
            </li>
            <li>
              LMS 只管「regressor 和 PD 殘差是不是同向」（regressor 是 LMS 拿來和比較器輸出相乘的已知數位序列，這裡是 DTC 的 code 與 PMUX 的選相）。Type-II 迴路在低頻把殘差變成誤差的<strong>二次微分</strong>——方向相反。regressor 若主要在那個頻帶（L2：0–{fx(BAND.L2?.hi ?? NaN, 0)} MHz）振動，LMS 就往反方向學。
            </li>
            <li>
              PMUX 以 <Tex>{r`\alpha f_{ref}`}</Tex> 旋轉：這個頻率落在帶內，PHOS 就反號。GOS 的鋸齒功率分散在全頻帶，所以（延遲對齊時）不反號。
            </li>
            <li>
              最便宜的修法：把 regressor 換成一階差分 <Tex>{r`r[n]=x[n]-x[n-1]`}</Tex>（<Tex>{'x'}</Tex> 是原本的 regressor，<Tex>{'r'}</Tex> 是 GMAC 實際拿來相乘的版本）。推導可以先收起來，直接玩 §6、§8、§14 的三個實驗。
            </li>
          </ol>
        </Callout>
      )}
      <nav aria-label="本頁目錄">
        <ol className="cs-toc" start={0}>
          {TOC.map(([id, label], i) => (
            <li key={id} value={i}>
              <button type="button" className="cs-linkbtn" onClick={() => scrollToId(id)}>
                {mathText(label.replace(/^\d+\.\s*/, ''))}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <S00Conclusion />
      <S01Roadmap />
      <S02Architecture />
      <S03Hpd />
      <S04MeanUpdate />
      <S05Identity />
      <S06Loops />
      <S07Gos />
      <S08Phos />
      <S09Joint />
      <S10Sim />
      <S11Remedies />
      <S12FiniteStep />
      <S13Offset />
      <S14ClosedLoop />
      <S15Checklist />
      <S16Quiz />
      <S17Recap />
      {/* 符號表放在頁面最後（docs/teaching-style.md §5）；章首「本章資訊」的「符號表 ↓」與章末交棒由 PageFrame 提供 */}
      <S21Symbols />
    </div>
  )
}
