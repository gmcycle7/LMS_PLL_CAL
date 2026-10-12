import { Section, Tex } from '@/components'
import { W1 } from '@/simulation/models/sspll'
import { BAND, LOOP_KEYS, PARAMS, REMEDY, SIGNMAP, SURE_GOLDEN, mapIntervalsBelow } from '../data'
import { DataTable, Diagram, Hand, Src, fx, intervalsText, r, tx } from '../common'

/** §15 設計 checklist 與 α keep-out 配方。 */
export function S15Checklist() {
  const S = PARAMS.sensitivity
  const web = PARAMS.signmap_summary
  const pvt = (k: 'L2' | 'L3') => [S[`${k}_gain0.6`].bands[0][1], S[`${k}_gain1.5`].bands[0][1]]
  const lowEdge = (k: 'L2' | 'L3') => PARAMS.map_j4096[k]['bands_tau0.01'][0]?.[0]
  const hi2 = BAND.L2?.hi ?? NaN
  // near-grid（α ≈ 1/8、3/8：α·f_ref ≈ 500、1500 MHz）的大訊號反號區間，直接由 signmap_L2.json 的 LSinf／LSinf_ac 欄取出
  const nearGrid = (col: number[]) => [...mapIntervalsBelow(col, SIGNMAP.L2.f_MHz, -1e-3, 420, 580), ...mapIntervalsBelow(col, SIGNMAP.L2.f_MHz, -1e-3, 1420, 1580)]
  const ngRaw = nearGrid(SIGNMAP.L2.LSinf)
  const ngAc = nearGrid(SIGNMAP.L2.LSinf_ac)
  return (
    <Section kind="assumptions" level={2} title="15. 設計 checklist 與 $\alpha$ keep-out 配方" id="cs-15">
      <h3>15.1 設計 checklist</h3>
      <ol className="cs-checklist">
        <li>
          <strong>
            先算你的 <Tex>{r`\mathrm{Re}H_{PD}(f)`}</Tex>
          </strong>
          ：用實際的 <Tex>{'L(z)'}</Tex>，含延遲、寄生極點、取樣映射；也要涵蓋 PVT 的 loop-gain 角落（例如 <Tex>{r`\times0.6`}</Tex>–<Tex>{r`\times1.5`}</Tex>）。實驗 A 可以直接改這些參數。
        </li>
        <li>
          <strong>迴路型態</strong>：Type-II（含 CPPLL）一定有從 DC 開始的反號帶。Type-I 要檢查 <Tex>{r`K(d-\tfrac12)<1`}</Tex> 與 <Tex>{r`K(\tfrac12+\tfrac p{1-p})<1`}</Tex>。
        </li>
        <li>
          <strong>相關器延遲</strong>：GOS 與 PHOS 的 code→比較器延遲要<strong>各自</strong>精確對齊，<Tex>{'D=0'}</Tex>。若 <Tex>{r`D=\pm1`}</Tex>，<Tex>{`\\min\\mathrm{Re}\\,\\Gamma\\approx${tx(REMEDY.L2.d1, 1)}`}</Tex>，幾乎所有 <Tex>{r`\alpha`}</Tex> 都會反號。
        </li>
        <li>
          <strong>regressor</strong>：首選 1diff。檢查 Type-II 的 <Tex>{r`K_i\le2K_p`}</Tex>、<Tex>{r`K_p+K_i/2\le2`}</Tex>，以及比較器前級頻寬 <Tex>{r`\ge0.5`}</Tex> GHz；迴路延遲超過 1 拍或有寄生極點時，直接算 margin{' '}
          <Tex>{r`\min_\Omega\,[1-\cos\Omega+\mathrm{Re}\{(1-e^{-j\Omega})L\}]\ge0`}</Tex>（實驗 A）。
        </li>
        <li>
          <strong>zero-mean</strong>：沒用 1diff 時，GOS 至少用 <code>ac</code>，PHOS 減 1/8。比較器要做 offset trim；CPPLL 尤其如此。
        </li>
        <li>
          <strong>step size</strong>：若不是 1diff 或 fx，帶緣附近要滿足 <Tex>{r`\mathrm{Re}\kappa>\lvert\kappa\rvert^2/(2N_\tau)`}</Tex>。1diff 有 disc constant，<Tex>{`N_\\tau>${tx(1 / (2 * Math.min(...LOOP_KEYS.map((k) => REMEDY[k].disc))), 1)}`}</Tex> blocks 即可。
        </li>
        <li>
          <strong>大訊號</strong>：raw／ac 的 keep-out 必須用 <Tex>{r`A\to\infty`}</Tex> 的 map 列；1diff 與 fx 在大訊號下也是 0 反號。
        </li>
        <li>
          <strong>飽和保護</strong>：加 weight clamp（DTC range）與 lock detector，因為「發散」在硬體上是飽和或失鎖。
        </li>
        <li>
          <strong>極性</strong>：在 <Tex>{r`H\equiv1`}</Tex>（或 <Tex>{r`\alpha f_{ref}`}</Tex> 遠高於迴路頻寬、<Tex>{r`\mathrm{Re}H\approx1`}</Tex> 的頻道，例如 <Tex>{r`\alpha=0.137`}</Tex>）驗證更新方向正確。<strong>不要</strong>在帶內頻道用經驗翻正負號，否則帶外所有頻道都會變成錯號。
        </li>
      </ol>

      <h3>
        15.2 <Tex>{r`\alpha`}</Tex> keep-out 配方（給 raw 或 <code>ac</code> regressor 用）
      </h3>
      <p>
        keep-out 的意思是：列出一張「不要在這些頻道更新權重」的清單。要不要把某個頻道 <Tex>{r`\alpha`}</Tex> 列進去，照下面的流程問四個問題；每個六角形判斷框的細節（門檻怎麼算、PVT 怎麼留 margin）在流程圖後面的清單裡。
      </p>
      <Diagram id="keepout" />
      <p>
        先看第一個判斷框（六角形）：regressor 若已經換成一階差分（延遲對齊 <Tex>{'D=0'}</Tex>、margin <Tex>{r`\min_\Omega g\ge0`}</Tex>，§11.1）或 filtered-x（模型與迴路的相位差不超過 90°，§11.2），直接結束，不需要 keep-out。再看 ①②③ 三個檢查，它們對應三種不同的機制：① 是 PMUX 的旋轉頻率 <Tex>{'f_{rot}'}</Tex> 落在 mode-1 的反號帶（清單第 1–3
        步；<Tex>{'h'}</Tex> 是 <Tex>{r`\mathrm{Re}\,H_{PD}`}</Tex>）；② 是 <Tex>{r`\alpha`}</Tex> 靠近 <Tex>{r`\tfrac14`}</Tex> 或 <Tex>{r`\tfrac12`}</Tex> 時，mode 4 或 mode 2 的基波被 alias 回反號帶（第 4 步）；③ 是 <Tex>{r`\alpha`}</Tex> 靠近 <Tex>{'k/8'}</Tex> 時 GOS 的鋸齒變得很慢，遇到 offset
        或大訊號就會反向（第 5 步）。任何一個答「是」，這個頻道就不更新（沿用在安全頻道校準好的權重），或換對策。
      </p>
      <ol className="cs-recipe">
        <li>
          <strong>mode-1 主帶。</strong> 計算 <Tex>{r`h(f)=\mathrm{Re}H_{PD}(f)`}</Tex> 與 <Tex>{r`M=\max_f h`}</Tex>。「一定反號」：<Tex>{r`h(\alpha f_{ref})<-(1-W_1)M/W_1`}</Tex>（<Tex>{`W_1=${tx(W1, 4)}`}</Tex>）；「mode-1 可能反號」：
          <Tex>{r`W_1h(\alpha f_{ref})+(1-W_1)\min h<0`}</Tex>。本設計：
          {(['L2', 'L3'] as const)
            .map((k) => `${k} 一定反號 ${fx(SURE_GOLDEN[k].sure_MHz[0], 2)}–${fx(SURE_GOLDEN[k].sure_MHz[1], 2)} MHz、可能反號到 ${fx(SURE_GOLDEN[k].impossible_above_MHz, 2)} MHz`)
            .join('；')}
          。
        </li>
        <li>
          <strong>PVT margin。</strong> 對每個 loop-gain 角落重做步驟 1 再取聯集。L2 在 <Tex>{r`\times0.6`}</Tex>–<Tex>{r`\times1.5`}</Tex> 時，<Tex>{r`\mathrm{Re}H<0`}</Tex> 的帶緣從 {fx(pvt('L2')[0], 1)} 移到 {fx(pvt('L2')[1], 1)} MHz，所以 keep-out 上緣至少要到{' '}
          <strong>{Math.ceil(pvt('L2')[1])} MHz</strong>。L3 為 {fx(pvt('L3')[0], 1)}–{fx(pvt('L3')[1], 1)} MHz。
        </li>
        <li>
          <strong>近整數 dead zone。</strong> <Tex>{r`\alpha f_{ref}\lesssim`}</Tex> 帶的下緣（L2 約 {fx(lowEdge('L2'), 0)} MHz、L3 約 {fx(lowEdge('L3'), 0)} MHz）屬於 <Tex>{r`\lvert\kappa_{PHOS}\rvert\lesssim5\times10^{-3}`}</Tex> 的 dead zone：小訊號會漂移，大訊號會反向。
          <strong>全部列入</strong>，也就是 keep-out 從 0 MHz 開始。
        </li>
        <li>
          <strong>alias 區。</strong> 對每一條重要的線 <Tex>{r`\ell`}</Tex>（權重 <Tex>{r`w_\ell`}</Tex>）檢查 <Tex>{r`\mathrm{frac}(\ell\alpha)f_{ref}`}</Tex> 是否落在反號帶：<Tex>{r`\alpha\approx\tfrac14`}</Tex> 時 m4 的頻率是{' '}
          <Tex>{r`4\lvert\alpha-\tfrac14\rvert f_{ref}`}</Tex>；<Tex>{r`\alpha\approx\tfrac12`}</Tex> 時 m2 是 <Tex>{r`2\lvert\alpha-\tfrac12\rvert f_{ref}`}</Tex>，m4 是 <Tex>{r`4\lvert\alpha-\tfrac12\rvert f_{ref}`}</Tex>。例：L2 的帶上緣 {fx(hi2, 1)} MHz 對應{' '}
          <Tex>{`\\lvert\\alpha-\\tfrac14\\rvert f_{ref}<${tx(hi2 / 4, 1)}`}</Tex> MHz、<Tex>{`\\lvert\\alpha-\\tfrac12\\rvert f_{ref}<${tx(hi2 / 2, 1)}`}</Tex> MHz。
        </li>
        <li>
          <strong>near-grid GOS（只在大訊號或有 offset 時）。</strong> <Tex>{r`\alpha\approx k/8`}</Tex>（<Tex>{r`\beta=\mathrm{frac}(8\alpha)\to0`}</Tex> 或 <Tex>{r`\to1`}</Tex>）時，GOS 小訊號是 dead zone，大訊號會反向。L2 raw 的大訊號 map：{intervalsText(ngRaw)} MHz；<code>ac</code> 時為 {intervalsText(ngAc)} MHz（Type-II 只去平均還不夠）。L1 只有這一類（{web.L1.n_large_signal_inverted}{' '}
          點；改用 <code>ac</code> 後剩 {web.L1.n_large_signal_inverted_ac} 點）。
        </li>
        <li>
          <strong>查網站資料核對。</strong> <code>signmap_L*.json</code> 的 <code>LSinf</code>、<code>LSinf_ac</code> 欄（<Tex>{r`<-10^{-3}`}</Tex> 即列入），以及 <code>summary.large_signal_inverted_MHz</code>——也就是實驗 B 熱圖的「大訊號 <Tex>{r`\kappa_\infty`}</Tex>」那兩列。
        </li>
      </ol>
      <p>本設計（raw，大訊號 <Tex>{r`A\to\infty`}</Tex>，網站的 1 MHz midpoint 網格，<strong>未加 PVT margin</strong>）的 keep-out 總結：</p>
      <DataTable
        head={['迴路', <>keep-out（<Tex>{r`\min(\alpha,1-\alpha)f_{ref}`}</Tex>，MHz）</>, '點數（raw／ac）']}
        rows={LOOP_KEYS.map((k) => [k, intervalsText(web[k].large_signal_inverted_MHz), `${web[k].n_large_signal_inverted}／${web[k].n_large_signal_inverted_ac}`])}
      />
      <p>
        改用 1diff 或 fx 時<strong>不需要 keep-out</strong>（三個標稱迴路的線性與大訊號都是 0 反號），只需滿足 checklist 的第 3、4 項——包括第 4 項的 margin <Tex>{r`\min_\Omega g\ge0`}</Tex>：它依賴你的迴路延遲與 PM（§11.1 的補充）。
      </p>
      <Src>
        <code>params.json</code>（<code>signmap_summary</code>、<code>sensitivity</code>、<code>map_j4096</code>）與 TS port 的 <code>mode1SureBand</code>。
      </Src>

      <h3>15.3 綜合手算：拿一個頻道把流程走一次</h3>
      <p>
        做思考題之前，先把整章串起來算一次：給定 <Tex>{r`\alpha`}</Tex> 與迴路的 <Tex>{r`K_p,\ K_i`}</Tex>，算出 PMUX 的旋轉頻率、GOS 鋸齒的基頻、反號帶上緣，判斷這個頻道在不在帶內，最後檢查一階差分這個對策能不能用。
      </p>
      <Diagram id="handcalc" />
      <p>
        先看從輸入分出去的四條線：① 旋轉頻率、② 鋸齒基頻、③ 帶緣、⑤ margin 各自只用到輸入，可以分開算。再看藍色的 ④：把 ① 減掉 ③，負的就是在反號帶內。圖上 ①②③⑤ 的式子就是下面手算題開頭列出的公式，④ 是手算題裡 <Tex>{'f_{rot}-f_{inv}'}</Tex> 那一步；手算題把 ③ 拆成「先算比值、開根號、按{' '}
        <Tex>{r`\arcsin`}</Tex>、乘上 <Tex>{r`f_{ref}/\pi`}</Tex>」四小步，把 ⑤ 拆成兩次減法。
      </p>
      <Hand id="HC-CS.8">{r`預設是 §8.1 的例子（L2、$\alpha=0.021$）。換成你晶片的頻道與增益，先用紙筆和計算機算出五個答案，再對照下面的結論。`}</Hand>
    </Section>
  )
}
