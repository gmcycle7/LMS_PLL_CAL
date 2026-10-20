import { Callout, ClaimTag, CodeBlock, CodeCompare, extractRegion, ModeGate, Tex } from '@/components'
import presetsSrc from '@/app/presets.ts?raw'
import lmsSrc from '@/simulation/models/lms.ts?raw'
import polaritySrc from '@/simulation/models/polarity.ts?raw'
import stabilitySrc from '@/simulation/models/stability.ts?raw'
import peSrc from '@/simulation/models/pe.ts?raw'
import mimoSrc from '@/simulation/models/mimo.ts?raw'
import previewsSrc from '../previews.ts?raw'
import consistencySrc from '../consistency.ts?raw'
import formatSrc from '../format.ts?raw'
import { ErratumChip, Rich } from '../common'

/** §7 用到的 region（index.test.tsx 逐一用 extractRegion 檢查存在，名稱打錯會在測試就失敗） */
export const CODE_REGIONS: { file: string; region: string }[] = [
  { file: 'lms', region: 'fixedXPole' },
  { file: 'polarity', region: 'calPole' },
  { file: 'stability', region: 'delayCharPoly' },
  { file: 'stability', region: 'delayStable' },
  { file: 'stability', region: 'dualLoopCharPoly' },
  { file: 'pe', region: 'eigenModes' },
  { file: 'mimo', region: 'mScalar' },
  { file: 'mimo', region: 'mFull' },
  { file: 'mimo', region: 'blockUpdate' },
  { file: 'previews', region: 'previewPreset' },
  { file: 'previews', region: 'previewScalarLms' },
  { file: 'previews', region: 'previewPolarityTone' },
  { file: 'previews', region: 'previewDelayFx' },
  { file: 'previews', region: 'previewPm' },
  { file: 'previews', region: 'previewDualLoop' },
  { file: 'previews', region: 'previewPe' },
  { file: 'previews', region: 'previewMimo' },
  { file: 'consistency', region: 'checkExpected' },
  { file: 'consistency', region: 'detectionWindow' },
  { file: 'consistency', region: 'matchCoverage' },
  { file: 'format', region: 'extractNumbers' },
  { file: 'format', region: 'findExpectedMatch' },
]

/**
 * region 內符合 pattern 的行號（1-based）。共用模型檔（唯讀）裡有些 region 沒有 `// ← 差異` 註解，
 * 用這個把「算出 pole 的那一行」交給 CodeBlock 的 highlight 標出來；行號由原始碼當場找，不寫死。
 * 找不到（原始碼改寫了）時回傳空陣列——index.test.tsx 會檢查每個 KEY_LINES 都至少找到一行。
 */
export function keyLines(source: string, region: string, pattern: RegExp): number[] {
  try {
    return extractRegion(source, region)
      .split('\n')
      .map((line, i) => (pattern.test(line) ? i + 1 : 0))
      .filter((n) => n > 0)
  } catch {
    return []
  }
}

/** 沒有「← 差異」註解的 region：要標出的關鍵行（以內容比對，不寫死行號） */
export const KEY_LINES: { file: 'lms' | 'polarity' | 'stability' | 'mimo' | 'consistency'; region: string; pattern: RegExp }[] = [
  { file: 'lms', region: 'fixedXPole', pattern: /return 1 - mu \* x \* x/ },
  { file: 'polarity', region: 'calPole', pattern: /return 1 - mu \* Kq \* C/ },
  { file: 'stability', region: 'delayCharPoly', pattern: /p\[d \+ 1\] \+= g/ },
  { file: 'stability', region: 'dualLoopCharPoly', pattern: /return \[1, -\(1 \+ r\), r \+ mu \* b \* cs\]/ },
  { file: 'mimo', region: 'blockUpdate', pattern: /delta\.map\(/ },
  { file: 'consistency', region: 'detectionWindow', pattern: /const [ab] = \(hit\.value/ },
  { file: 'consistency', region: 'matchCoverage', pattern: /unionLength\(/ },
]
const KEY_SOURCES = { lms: lmsSrc, polarity: polaritySrc, stability: stabilitySrc, mimo: mimoSrc, consistency: consistencySrc }
/** 某個 region 的關鍵行號（KEY_LINES 沒登錄的 region 回傳 undefined：該 region 已有「← 差異」註解） */
export function keyLinesOf(file: keyof typeof KEY_SOURCES, region: string): number[] | undefined {
  const k = KEY_LINES.find((x) => x.file === file && x.region === region)
  return k ? keyLines(KEY_SOURCES[file], region, k.pattern) : undefined
}

const POLE_ROWS: { model: string; states: string; gain: string; pole: string; stable: string; smallerMu: string }[] = [
  { model: 'L0 固定 $x$ 的 LMS（#1）', states: '$1$', gain: '$x^2\\ge0$', pole: '$p=1-\\mu x^2$', stable: '$0<\\mu<2/x^2$', smallerMu: '有用' },
  { model: 'L2 單頻、raw regressor（#3）', states: '$1$', gain: '$K_qC$，$C<0$', pole: '$p=1+\\mu K_q|C|$', stable: '不存在（任何 $\\mu>0$ 都 $p>1$）', smallerMu: '沒用：只會發散得慢一點' },
  { model: 'L2 單頻、延遲 $D$（#4）', states: '$1$', gain: '$K_qC_D$，$C_D>0$', pole: '$p=1-\\mu K_qC_D$', stable: '$0<\\mu<2/(K_qC_D)$', smallerMu: '有用' },
  { model: 'L1 更新延遲 $d$ 個 block', states: '$d+1$', gain: '$g=\\mu K$', pole: '$z^{d+1}-z^d+g=0$ 的根', stable: '$0<g<2\\sin\\frac{\\pi}{4d+2}$', smallerMu: '有用' },
  { model: 'L2 雙迴路（#5）', states: '$2$', gain: '$\\mu bc$', pole: '$z^2-(1+r)z+(r+\\mu bc)=0$ 的根', stable: '$0<\\mu bc<1-r$', smallerMu: '有用（quasi-static 會高估 2 倍）' },
  { model: 'L3 兩個相關的參數（#6）', states: '$P$', gain: '$g\\lambda_i$', pole: '$p_i=1-g\\lambda_i$', stable: '$0<g<2/\\lambda_{\\max}$', smallerMu: '$\\lambda_{\\min}=0$ 的方向永遠不動（#11）' },
  { model: 'L3 一般 Jacobian（#12）', states: '$P$', gain: '$-\\mathbf M\\mathbf J$', pole: '$\\operatorname{eig}(\\mathbf I+\\mathbf M\\mathbf J)$', stable: '$\\rho(\\mathbf I+\\mathbf M\\mathbf J)<1$', smallerMu: '$\\mathbf J$ 有正 eigenvalue 且 $\\mathbf M=\\mu\\mathbf I$ 時沒用' },
]

function PoleTable() {
  const cell = (text: string) => <Rich text={text} />
  return (
    <div className="table-wrap">
      <table className="gal-table">
        <caption className="small muted">同一個問題「pole 在哪裡」在不同模型的答案</caption>
        <thead>
          <tr>
            <th>模型（對應的 preset）</th>
            <th>狀態數</th>
            <th>「增益」是什麼</th>
            <th>pole</th>
            <th>平均收斂的條件</th>
            <th>
              發散時把 <Tex>{'\\mu'}</Tex> 縮小有用嗎
            </th>
          </tr>
        </thead>
        <tbody>
          {POLE_ROWS.map((r) => (
            <tr key={r.model}>
              <td>{cell(r.model)}</td>
              <td>{cell(r.states)}</td>
              <td>{cell(r.gain)}</td>
              <td>{cell(r.pole)}</td>
              <td>{cell(r.stable)}</td>
              <td>{cell(r.smallerMu)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * §7：核心程式碼。全部以 ?raw 匯入原始檔、用 #region core:<name> 擷取——頁面上看到的就是瀏覽器正在執行的那幾行。
 * （default export：index.tsx 以 React.lazy 載入，讓原始碼文字不進入 Gallery 的首屏 chunk。）
 */
export default function CodeSection() {
  return (
    <>
      <h3>7.1 「載入並執行」做了什麼</h3>
      <p>
        卡片上的連結是 <code>presetHref(preset)</code> 產生的路徑；原頁面的實驗用 <code>useUrlPreset(experimentId)</code> 讀網址上的 <code>?preset=id</code>，只有 <code>experiment</code> 欄位相符才套用。整個機制只有這個檔案：
      </p>
      <CodeBlock source={presetsSrc} path="src/app/presets.ts" title="preset 的收集、連結與載入" caption="ALL_PRESETS 以 import.meta.glob 自動收集 src/data/presets/*.json：新增一個 JSON 檔，Gallery 就多一張卡片，不需要中央清單。" />

      <h3>7.2 「即時預覽」做了什麼</h3>
      <p>
        <code>previewPreset</code> 依 <code>experiment</code> 找到對應的預覽函式，把 <code>params</code> 交給模型函式。沒有預覽函式的實驗、或預覽函式不處理的模式，都<strong>明講「不支援」</strong>，不會猜一個數字。
      </p>
      <CodeBlock source={previewsSrc} region="previewPreset" path="src/pages/gallery/previews.ts" title="previewPreset：分派與誠實回報" />

      <h3>7.3 演算法比較：同一個問題「pole 在哪裡」，六種模型</h3>
      <p>
        §4 說 12 個例子有一半在問「走不走得回來」。下面先看<strong>模型函式本身</strong>（各章頁面與 Gallery 共用的同一份程式），再看 <strong>Gallery 怎麼呼叫它們</strong>。
      </p>
      <PoleTable />
      <div className="c-tag-row">
        <ClaimTag kind="exact" />
        <span className="small muted">各列在自己的模型內是精確的（平均遞迴）；K、g 的定義見 <ErratumChip eid="E13" />，延遲的兩個符號 <Tex>{'D'}</Tex>（samples）與 <Tex>{'d'}</Tex>（blocks）見 <ErratumChip eid="E34" />。</span>
      </div>
      <CodeCompare
        layout="tabs"
        caption="模型函式（src/simulation/models）：從一個數 $1-\mu x^2$，到多項式的根，到矩陣的 eigenvalue。每一頁以底色標出的那一行，就是這個模型與前一個模型不同的地方（算出 pole 的那一行）。"
        items={[
          { label: 'L0 固定輸入', source: lmsSrc, region: 'fixedXPole', highlight: keyLinesOf('lms', 'fixedXPole'), path: 'src/simulation/models/lms.ts', note: '$p=1-\\mu x^2$：一個乘法。增益 $x^2$ 不可能是負的，所以 L0 沒有極性問題。' },
          { label: 'L2 polarity', source: polaritySrc, region: 'calPole', highlight: keyLinesOf('polarity', 'calPole'), path: 'src/simulation/models/polarity.ts', note: '$p=1-\\mu K_qC$：形式一樣，但相關 $C$ 可以是負的——#3 的發散就在這一行。' },
          { label: 'L1 更新延遲（多項式）', source: stabilitySrc, region: 'delayCharPoly', highlight: keyLinesOf('stability', 'delayCharPoly'), path: 'src/simulation/models/stability.ts', note: '$\\delta_{k+1}=\\delta_k-g\\,\\delta_{k-d}$ 的特徵多項式 $z^{d+1}-z^d+g$。' },
          { label: 'L1 更新延遲（求根）', source: stabilitySrc, region: 'delayStable', path: 'src/simulation/models/stability.ts', note: '直接求 $d+1$ 個根，取最大的 $|z|$；$\\rho=1$ 標成 marginal，不算穩定。' },
          { label: 'L2 雙迴路', source: stabilitySrc, region: 'dualLoopCharPoly', highlight: keyLinesOf('stability', 'dualLoopCharPoly'), path: 'src/simulation/models/stability.ts', note: '兩個狀態 $[s;\\delta]$，所以是二次式 $z^2-(1+r)z+(r+\\mu bc)$；共軛複數根時 $|z|^2$ 就等於常數項 $r+\\mu bc$（#5）。' },
          { label: 'L3 eigen modes', source: peSrc, region: 'eigenModes', path: 'src/simulation/models/pe.ts', note: '每個 eigenvalue 一個 pole $p_i=1-g\\lambda_i$；$\\lambda=0$ 的方向 $p=1$（不可辨識）。' },
          { label: 'L3 MIMO（scalar 步長）', source: mimoSrc, region: 'mScalar', path: 'src/simulation/models/mimo.ts', note: '原始 LMS：$\\mathbf M_n=\\mu K_q\\mathbf I$，完全不看 Jacobian。#12 的發散來自這個選擇。' },
          { label: 'L3 MIMO（preconditioner）', source: mimoSrc, region: 'mFull', path: 'src/simulation/models/mimo.ts', note: 'Preconditioner：乘上 $\\hat{\\mathbf J}^{-1}$，$\\hat{\\mathbf J}=\\mathbf J$ 時所有 pole 都是 $1-\\gamma$。' },
          { label: 'L3 MIMO（一步更新）', source: mimoSrc, region: 'blockUpdate', highlight: keyLinesOf('mimo', 'blockUpdate'), path: 'src/simulation/models/mimo.ts', note: '所有規則共用的一步：$\\boldsymbol\\delta_{k+1}=\\boldsymbol\\delta_k-\\mathbf M\\mathbf G_k$，平均後就是 $(\\mathbf I+\\mathbf M\\mathbf J)\\boldsymbol\\delta_k$。' },
        ]}
      />
      <CodeCompare
        layout="tabs"
        caption="Gallery 的呼叫端（src/pages/gallery/previews.ts）：標出的那一行就是各模型算 pole 的地方。"
        items={[
          { label: '#1 純量 LMS', source: previewsSrc, region: 'previewScalarLms', path: 'src/pages/gallery/previews.ts', note: '同一組 $(a,w_0,x,\\sigma_v,\\text{seed})$ 對每個 $\\mu$ 跑一次 runScalarLms。' },
          { label: '#3 polarity', source: previewsSrc, region: 'previewPolarityTone', path: 'src/pages/gallery/previews.ts', note: '先用 2-tap FIR 做出指定的 $|H|e^{j\\varphi}$，再算 $C$ 與 pole。' },
          { label: '#4 delay / filtered-x', source: previewsSrc, region: 'previewDelayFx', path: 'src/pages/gallery/previews.ts', note: '三個 Case（raw / delayed / filtered）共用路徑與 code，只有 regressor 不同。' },
          { label: 'PM / 更新延遲', source: previewsSrc, region: 'previewPm', path: 'src/pages/gallery/previews.ts', note: '封閉式（PM、$g^*$）與求根（$\\rho$）並列，互相核對。' },
          { label: '#5 雙迴路', source: previewsSrc, region: 'previewDualLoop', path: 'src/pages/gallery/previews.ts', note: '完整模型與 quasi-static 用同一組參數各跑一次。' },
          { label: '#6 PE / eigen', source: previewsSrc, region: 'previewPe', path: 'src/pages/gallery/previews.ts', note: '解析（peAnalytic）加上平均軌跡（meanTrajectory）。' },
          { label: '#12 MIMO', source: previewsSrc, region: 'previewMimo', path: 'src/pages/gallery/previews.ts', note: '每個規則各算一次 $\\mathbf A=\\mathbf I+\\mathbf M\\mathbf J$ 的 eigenvalue。' },
        ]}
      />

      <h3>7.4 比對規則的程式</h3>
      <p>
        §2.3 的判據只有兩個函式：<code>acceptHalfWidth</code> 決定接受半寬 <Tex>{'W'}</Tex>，<code>findExpectedMatch</code> 找最接近的相符數字；<code>checkExpected</code> 再依「必備／非必備」決定找不到時的後果。
      </p>
      <CodeBlock source={formatSrc} region="findExpectedMatch" path="src/pages/gallery/format.ts" title="接受半寬與相符判據（F-GA.1）" />
      <CodeBlock
        source={consistencySrc}
        region="checkExpected"
        path="src/pages/gallery/consistency.ts"
        title="checkExpected：必備數值找不到就是 mismatch"
        caption="標出的兩行是必備與非必備數值唯一的差別。"
      />
      <ModeGate min="engineer" summary="兩個量（偵測視窗與巧合相符機率）的程式碼並排對照">
        <CodeCompare
          caption="§2.4 的兩個量：左邊是解不等式（F-GA.2），右邊是區間聯集的長度（F-GA.3）。"
          items={[
            { label: '偵測視窗', source: consistencySrc, region: 'detectionWindow', highlight: keyLinesOf('consistency', 'detectionWindow'), path: 'src/pages/gallery/consistency.ts', note: '$\\varepsilon\\in[(y_{\\mathrm t}-W-\\hat y)/\\hat y,\\ (y_{\\mathrm t}+W-\\hat y)/\\hat y]$' },
            { label: '巧合相符機率', source: consistencySrc, region: 'matchCoverage', highlight: keyLinesOf('consistency', 'matchCoverage'), path: 'src/pages/gallery/consistency.ts', note: '$P=|\\bigcup_iI_i\\cap[-\\varepsilon_{\\max},\\varepsilon_{\\max}]|/(2\\varepsilon_{\\max})$' },
          ]}
        />
      </ModeGate>
      <ModeGate min="research" summary="extractNumbers 的核心程式碼（從中文敘述抽出數字與捨入半寬）">
        <CodeBlock source={formatSrc} region="extractNumbers" path="src/pages/gallery/format.ts" title="extractNumbers：從中文敘述抽出數字與捨入半寬" caption="正規表示式的 lookbehind 排除編號（T06、F-06.15、§12.1）與上標；百分比同時加入 $y_{\mathrm t}$ 與 $y_{\mathrm t}/100$。" />
      </ModeGate>
      <Callout kind="info" title="為什麼不另外寫一份「示意版」程式">
        頁面上的程式碼若和實際執行的不同，讀者照著抄就會得到不同的數字。這裡每一段都是從原始檔擷取的（<code>?raw</code> 匯入 + <code>#region core:…</code>
        標記），原始檔一改，頁面就跟著改；region 名稱若打錯，會顯示錯誤框而且測試會失敗。
      </Callout>
    </>
  )
}
