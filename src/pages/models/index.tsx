import { ClaimTag, ModelLevel, SourceTag, TestBadge, Tex } from '@/components'
import { BlockLmsJsonLab } from './experiments/BlockLmsJsonLab'
import { S1Intro } from './sections/S1Intro'
import { S2Levels } from './sections/S2Levels'
import { S3Reference } from './sections/S3Reference'
import { S4Systems } from './sections/S4Systems'
import { S5Params } from './sections/S5Params'
import { S6Outputs } from './sections/S6Outputs'
import { S7Spur } from './sections/S7Spur'
import { S8Hardware } from './sections/S8Hardware'
import { S9Statements } from './sections/S9Statements'
import { S10Wrap } from './sections/S10Wrap'
import { ErratumNote } from './common'
import { SPEC_NUMBERS } from './refNumbers'
import './models.css'

/** 固定小數位（頁面文字用） */
const f4 = (x: number): string => x.toPrecision(4)

/**
 * Part D「Behavioral Models、RTL 與 Sign-off」（route /models；規格 §15、§16）。
 *
 * 章節：1 開場問題與符號表 → 2 模型層級 L0–L6（§15.1）→ 3 參考 Block Sign-LMS（§15.2：偽程式 vs 實際程式、手算、
 *       pole / σ_w / 頻寬 / 延遲臨界增益的逐步推導）→ 4 DT PLL、DSM residue、DTC mapping → 5 §15.3 參數表 →
 *       6 JSON Lab → 7 §15.4 標準輸出（7.1 AR(1) 有效樣本數）→ 8 §15.5 FFT 檢查表 → 9 §16.1 十二項硬體檢查、GMAC datapath、§16.2 矩陣 →
 *       10 §16.3 語句測驗 → 11 綜合手算、思考題與必記。
 * 實驗：block-lms-json（L1 / L2 / L5）、fft-spur-pitfalls（L4）、gmac-datapath-sizing（L5）。
 * 帶入手算（handcalcs.ts，ID 前綴 HC-MD）：只出本頁獨有的六題——DT PLL 的 poles（§4.1）、DTC mapping（§4.3）、AR(1) 有效樣本數（§7.1）、
 *       FFT 雜訊底與洩漏（§8.1）、Welch 主瓣積分與 dBc/Hz（§8.2）、綜合題（§11）。K_q→g→p、σ_w、頻寬、延遲 PM、accumulator 位元數、
 *       截斷偏差在 Ch12 / Ch08 / Ch04 已有手算題，本頁在對應推導後以 HandCalcPointer 指路，不重複出題。
 * 共用模型（blockLms.ts、pll.ts）回傳的警告／假設是 Unicode 純文字，顯示前經 experiments/modelText.ts 逐句換成 `$...$`。
 * 勘誤：E07（tie）、E13（單位、gain_lsb_fs）、E18（sum/average）、E30（T13 前提）、E34（D vs d）、E36（用字）、
 *       E06 / E26 / E27（頻寬）、E44（CT/DT）、E01 / E03（固定點）等；頁內以「勘誤 Exx」連到 #/verification。
 * 文字規範：數學一律 KaTeX（JSX 用 <Tex>，字串用 `$...$`；JSX 屬性字串內的 TeX 用單一反斜線），見 index.test.tsx 的檢查。
 */
export default function ModelsPage() {
  return (
    <div className="models-page">
      <div className="c-tag-row models-head-tags">
        <ModelLevel level="L1" />
        <ModelLevel level="L2" />
        <ModelLevel level="L4" />
        <ModelLevel level="L5" />
        <ClaimTag kind="exact" />
        <ClaimTag kind="approx" />
        <SourceTag kind="simulation" />
        <TestBadge id="T13" />
        <TestBadge id="T14" />
      </div>
      <S1Intro />
      <S2Levels />
      <S3Reference />
      <S4Systems />
      <S5Params />
      <section aria-labelledby="models-s6">
        <h2 id="models-s6">6｜動手做：Block Sign-LMS JSON Lab</h2>
        <p>
          把 §15.3 的 JSON 直接貼進來跑。左側快速控制項與文字框雙向同步；所有欄位都經 zod 檢查（錯誤以「欄位路徑：原因」顯示）；模擬在 Web Worker 執行，結果附解析預測、Monte Carlo 與定點對照。tie 規則{' '}
          <Tex>{'e\\ge0\\Rightarrow q=+1'}</Tex>
          <ErratumNote id="E07" />，T13 的前提（unit-RMS <Tex>{'\\pm1'}</Tex> code、identity path、average GMAC）見 <ErratumNote id="E30" />。
        </p>
        <div className="small models-tryit">
          試試看（preset 下拉選單在實驗框上方）：
          <ol className="models-tight">
            <li>
              預設（§15.3 原文）：模擬的 <Tex>{'\\sigma_w'}</Tex> 應接近預測的 <Tex>{`${f4(SPEC_NUMBERS.sigmaW)}\\,\\mathrm{fs}`}</Tex>，指標表的「Δ」欄顯示差距與容忍度。
            </li>
            <li>
              preset「反面：sum GMAC…」：<Tex>{`g=${f4(SPEC_NUMBERS.gSum)}`}</Tex>，<Tex>{'w'}</Tex> 在兩個值之間大振幅跳動。
            </li>
            <li>
              preset「T06…」（<Tex>{'C<0'}</Tex>）：<Tex>{'w'}</Tex> 被推離 <Tex>{'a'}</Tex>（一開始指數成長，comparator 飽和後變成等速漂移）；再換成 preset「T07…」（<Tex>{'D=4'}</Tex> 對齊）：同一類 path 加上 4 個 sample 的 code 延遲就收斂。
            </li>
            <li>
              preset「L5：… limit cycle」（<Tex>{'\\sigma_v=0'}</Tex>）：開了 quantize_physical 後，實體 code 每個 block toggle 一次。
            </li>
            <li>
              把 <Tex>{'\\mu'}</Tex> 從 10 慢慢加到 300 fs：<Tex>{'g'}</Tex> 越過 2 時出現「一階模型不穩定」的警告；再把 <Tex>{'d'}</Tex> 設成 1，看臨界值降到 1。
            </li>
            <li>
              把 JSON 改壞（例如 <code>"gm_mode": "avg"</code>）看繁體中文錯誤訊息。
            </li>
          </ol>
        </div>
        <BlockLmsJsonLab />
      </section>
      <S6Outputs />
      <S7Spur />
      <S8Hardware />
      <S9Statements />
      <S10Wrap />
    </div>
  )
}
