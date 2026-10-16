import { Callout, Mermaid, ModeGate, SourceTag, Tex, ChRef } from '@/components'
import type { PresetEntry } from '@/data/types'
import { ALL_PRESETS } from '@/app/presets'
import { PREVIEWABLE_EXPERIMENTS } from '../data'
import { PRESET_FLOW } from '../diagrams'
import { JumpButton } from './SlotAudit'

/** preset JSON 的欄位說明（與 src/data/types.ts 的 PresetEntry 一致；index.test.tsx 檢查欄位齊全）。範例值直接讀 #1 的 JSON。 */
export const PRESET_FIELDS: { field: keyof PresetEntry; type: string; meaning: string }[] = [
  { field: 'id', type: 'string', meaning: '全站唯一的名字，也是檔名與網址參數' },
  { field: 'title', type: 'string', meaning: '卡片標題（作者寫的）' },
  { field: 'galleryIndex', type: '1–12（可省略）', meaning: '規格 §19.2 的編號；只有 12 個必備 preset 才有' },
  { field: 'page', type: '路徑', meaning: '這個實驗在哪一頁' },
  { field: 'experiment', type: 'string', meaning: '該頁中 ExperimentShell 的 id；useUrlPreset 用它判斷「這個 preset 是不是給我的」' },
  { field: 'description', type: 'string', meaning: '這組參數要示範什麼' },
  { field: 'params', type: 'object', meaning: '要套用的參數（每個實驗自己定義欄位）' },
  { field: 'expected', type: 'string', meaning: '載入後應該看到的關鍵結果（含數值）——Gallery 會拿它和重算值比對' },
  { field: 'tests', type: 'T-id[]（可省略）', meaning: '對應規格 §17 的驗收測試' },
  { field: 'source', type: 'illustrative | simulation | literature | measured', meaning: '數字的來源；沒有任何 preset 是晶片量測' },
]

/** JSON 欄位值的精簡顯示（太長就截斷；欄位不存在顯示「（省略）」） */
export function fieldExample(p: PresetEntry | undefined, field: keyof PresetEntry, max = 64): string {
  if (!p) return '—'
  const v = p[field]
  if (v === undefined) return '（省略）'
  const s = JSON.stringify(v)
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** §1：這一頁在做什麼、一個 preset 是什麼（本頁符號表在頁尾：sections/Symbols.tsx） */
export function Intro() {
  const total = ALL_PRESETS.length
  const nExp = new Set(ALL_PRESETS.map((p) => p.experiment)).size
  const nPage = new Set(ALL_PRESETS.map((p) => p.page)).size
  const nPreview = ALL_PRESETS.filter((p) => PREVIEWABLE_EXPERIMENTS.includes(p.experiment)).length
  const nGallery = new Set(ALL_PRESETS.filter((p) => p.galleryIndex !== undefined).map((p) => p.galleryIndex)).size
  const first = ALL_PRESETS.find((p) => p.galleryIndex === 1)
  const sources = [...new Set(ALL_PRESETS.map((p) => p.source))]
  return (
    <section aria-labelledby="gal-s1" className="gal-section">
      <h2 id="gal-s1">1｜這一頁在做什麼</h2>
      <div className="gal-question">
        <div className="gal-question-label">一個問題</div>
        <p>
          你讀完<ChRef ch="08">第 8 章</ChRef>，想自己重現「靜態預測穩定、完整模型卻發散」。那一頁有十幾個滑桿——到底要把 <Tex>{'r,\\ b,\\ c,\\ \\mu'}</Tex> 設成多少，又應該看到什麼數字才算「重現成功」？
        </p>
      </div>
      <p>
        <strong>Preset（預設實驗）</strong>就是這個問題的答案：一個小小的 JSON 檔，記下「哪一頁的哪個實驗、參數各是多少、載入後應該看到什麼」。Experiment Gallery 把全站的 preset 收在一起，做三件事：
      </p>
      <ol>
        <li>
          <strong>列出來</strong>：目前共 <strong>{total}</strong> 個 preset，分布在 {nPage} 個頁面的 {nExp} 個實驗；其中規格 §19.2 指定的必備 preset 有 {nGallery} / 12 個（
          <JumpButton domId="gal-s3">§3 逐一稽核</JumpButton>）。
        </li>
        <li>
          <strong>一鍵載入</strong>：每張卡片的「載入並執行」會帶你到原頁面，並把參數套進那個實驗（網址多了 <code>?preset=id</code>）。
        </li>
        <li>
          <strong>當場重算</strong>：{nPreview} 個 preset 的實驗有純函式的模型（封閉式或短的確定性模擬），Gallery 直接呼叫<em>同一組</em>模型函式把關鍵數字算出來，再和 preset 的「預期結果」文字逐項比對（
          <JumpButton domId="gal-s2">§2 說明比對的數學</JumpButton>）。
        </li>
      </ol>
      <Callout kind="info" title="這一頁的數字從哪來">
        卡片上的<strong>標題、說明、預期結果</strong>是各章作者寫在 preset JSON 裡的文字，Gallery 原樣顯示；<strong>即時預覽裡的每一個數字</strong>都是你的瀏覽器當場用{' '}
        <code>src/simulation/models</code> 的函式算的，沒有任何一個是手打的。目前 preset 的來源標籤有：
        {sources.map((k) => (
          <span key={k} className="gal-source-count">
            <SourceTag kind={k} /> {ALL_PRESETS.filter((p) => p.source === k).length} 個
          </span>
        ))}
        {sources.includes('measured') ? '。' : '——沒有任何一個是晶片量測。'}
      </Callout>

      <h3>1.1 一個 preset 長什麼樣子</h3>
      <div className="table-wrap">
        <table className="gal-table gal-fields-table">
          <thead>
            <tr>
              <th>欄位</th>
              <th>型別</th>
              <th>意義</th>
              <th>#1 的實際內容{first ? '' : '（#1 缺少）'}</th>
            </tr>
          </thead>
          <tbody>
            {PRESET_FIELDS.map((f) => (
              <tr key={f.field}>
                <td>
                  <code>{f.field}</code>
                </td>
                <td className="small">{f.type}</td>
                <td>{f.meaning}</td>
                <td className="small mono gal-json-cell">{fieldExample(first, f.field)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Mermaid chart={PRESET_FLOW} caption="一個 preset 的兩條路：按「載入並執行」到原頁面做完整實驗；「即時預覽」在 Gallery 內用同一組模型函式重算，並與預期文字比對。" ariaLabel="preset 從 JSON 到卡片、到原頁面或即時預覽的流程圖" />
      <ModeGate min="engineer">
        <p className="small">
          為什麼要「重算再比對」？因為 preset 的預期文字是人寫的，模型程式之後可能被修改。規格 §17 末段要求一種反面測試：<strong>「模型公式有錯，UI 卻顯示成功」</strong>。如果 Gallery
          只是把文字印出來，模型改壞了也看不出來；重算並比對之後，任何一個必備數值對不上，卡片就會顯示 mismatch（<JumpButton domId="gal-s6">§6 的 Inspector</JumpButton> 可以親手注入誤差來驗證這件事）。
        </p>
      </ModeGate>
    </section>
  )
}
