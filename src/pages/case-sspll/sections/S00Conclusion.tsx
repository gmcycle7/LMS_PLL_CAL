import type { ReactNode } from 'react'
import { Callout, Section, Tex } from '@/components'
import { W1, loopF3dB } from '@/simulation/models/sspll'
import { BAND, FREF_MHZ, GOS_SCAN, LOOP_KEYS, LOOPS, PARAMS, PRED, P_ONLY, REMEDY, SUMMARY, SURE, SURE_GOLDEN, type LoopKey } from '../data'
import { Claim, DataTable, Formula, Src, fp, fx, intervalsText, r } from '../common'

const scanLoops = Object.entries(GOS_SCAN).filter(([k, v]) => !k.startsWith('_') && typeof v === 'object')
const nScanLoops = scanLoops.length
const nBeta = scanLoops[0]?.[1].n_beta ?? 0
const nNegTotal = scanLoops.reduce((a, [, v]) => a + v.n_negative, 0)

function cell(k: LoopKey, fn: (k: LoopKey) => ReactNode): ReactNode {
  return fn(k)
}

/** §0 先講結論：一句話回答、哪裡會反號、結論總表、對策排序。表內數字全部由 params.json／TS port 取得。 */
export function S00Conclusion() {
  const map = PARAMS.map_j4096
  const kHatCrit = PARAMS.remedy_kernels.fx_typeI_model.K_hat_critical
  const pOnlyBw = { L2: loopF3dB(P_ONLY.L2) * FREF_MHZ, L3a: loopF3dB(P_ONLY.L3) * FREF_MHZ, L3b: loopF3dB(P_ONLY.L3exact) * FREF_MHZ }

  const rows: [ReactNode, (k: LoopKey) => ReactNode][] = [
    [
      '參數',
      (k) =>
        k === 'L1' ? (
          <Tex>{`K=${fp(Number(LOOPS.L1.params.K), 6)}`}</Tex>
        ) : k === 'L2' ? (
          <Tex>{`K_p=${fp(Number(LOOPS.L2.params.Kp), 6)},\\ K_i=${fp(Number(LOOPS.L2.params.Ki), 6)}`}</Tex>
        ) : (
          <Tex>{`b=${fp(Number(LOOPS.L3.params.b), 5)},\\ \\omega_cT_{ref}=${fp(Number(LOOPS.L3.params.wc), 6)}`}</Tex>
        ),
    ],
    [<>PM／<Tex>{r`\lvert T\rvert`}</Tex> peaking</>, (k) => `${fx(SUMMARY[k].pmDeg, 2)}°／${fx(Math.max(0, SUMMARY[k].tPeakDb), 3)} dB`],
    [
      <><Tex>{r`\mathrm{Re}\,H_{PD}<0`}</Tex> 的頻帶</>,
      (k) => {
        const b = BAND[k]
        return b ? (
          <>
            <strong>0–{fx(b.hi, 3)} MHz</strong>，最低 {fx(b.min, 4)} @ {fx(b.fMin, 1)} MHz
          </>
        ) : (
          '無'
        )
      },
    ],
    [
      'PHOS mode-1「一定反號」區（嚴格界限）',
      (k) => {
        if (k === 'L1') return SURE.L1.sure ? '有' : '無'
        const s = SURE_GOLDEN[k].sure_MHz
        return <strong>{`${fx(s[0], 2)}–${fx(s[1], 2)} MHz`}</strong>
      },
    ],
    [
      <>PHOS 反號（<Tex>{r`\alpha=j/4096`}</Tex> 精確 map，<Tex>{r`\tau=10^{-2}`}</Tex>）</>,
      (k) => {
        const m = map[k]
        return m['bands_tau0.01'].length ? (
          <>
            {intervalsText(m['bands_tau0.01'])} MHz，最差 <Tex>{`\\kappa=${m.worst_kP.toFixed(4)}`}</Tex> @ {fx(m.worst_at_MHz, 1)} MHz
          </>
        ) : (
          '無'
        )
      },
    ],
    [
      <>PHOS alias dead zone（<Tex>{r`\tau=10^{-3}`}</Tex>）</>,
      (k) => {
        const alias = map[k]['bands_tau0.001'].filter(([lo]) => lo > 200)
        return alias.length ? `${intervalsText(alias, 0)} MHz` : '無'
      },
    ],
    [
      <>GOS（<Tex>{'D=0'}</Tex>）</>,
      (k) => (map[k].n_gos_neg === 0 ? (k === 'L1' ? '不反號' : '不反號；near-grid 為 dead zone') : `有 ${map[k].n_gos_neg} 個負值`),
    ],
    [
      <>大訊號（1-bit，<Tex>{r`A\to\infty`}</Tex>）反向 <Tex>{r`\alpha`}</Tex> 數（fine grid 500 點）</>,
      (k) => {
        const n = PRED.large_signal_counts[k].raw['A=inf'].periodic
        return k === 'L1' ? `${n}（全部是 GOS，在 k/8 正下方）` : String(n)
      },
    ],
  ]

  return (
    <Section kind="intuition" level={2} title="0. 先講結論" id="cs-0">
      <h3>0.1 一句話回答</h3>
      <p>
        PD（比較器）看到的不是誤差本身 <Tex>{'u'}</Tex>，而是被迴路「高通」過的殘差：
      </p>
      <Formula id="F-CS.1" />
      <p>
        sign-error LMS 的平均梯度，等於「regressor 在每一條譜線上的功率」對 <Tex>{r`\mathrm{Re}\,H_{PD}`}</Tex> 做的<strong>加權平均</strong>。只要 regressor 的功率主要落在{' '}
        <Tex>{r`\mathrm{Re}\,H_{PD}<0`}</Tex> 的頻帶，更新方向就會整個反過來，LMS 不但不收斂，反而會把權重推離正確值。
      </p>

      <h3>0.2 哪裡會反號</h3>
      <ul>
        <li>
          <strong>反號的頻率條件</strong>：<Tex>{r`\mathrm{Re}\,H_{PD}<0 \iff \mathrm{Re}\,L<-1 \iff \mathrm{Re}\,T>1`}</Tex>。這個帶子一定落在 <Tex>{r`\lvert T\rvert>1`}</Tex> 的 peaking 區裡。
          <Claim kind="exact" />
        </li>
        <li>
          <strong>Type-II 迴路</strong>：只要迴路是 Type-II（兩個積分器），在 DC 附近一定有 <Tex>{r`\mathrm{Re}\,H_{PD}\approx-\Omega^2/K_i<0`}</Tex>。白話說，PD 看到的是誤差的「二次微分」，而任何訊號與自己的二次微分的相關都是負的。所以從 DC
          開始的反號帶<strong>無法消除，只能變窄</strong>。
          <Claim kind="exact" />
        </li>
        <li>
          <strong>Type-I 迴路（L1，標稱模型）</strong>：沒有反號帶，<Tex>{r`\mathrm{Re}\,H_{PD}\ge0`}</Tex>。但這不是 Type-I 天生免疫：只要延遲 <Tex>{'d'}</Tex> 拍且 <Tex>{r`K(d-\tfrac12)>1`}</Tex>，或有寄生極點且{' '}
          <Tex>{r`K(\tfrac12+\tfrac{p}{1-p})>1`}</Tex>，也會出現反號帶。
          <Claim kind="exact" />
        </li>
      </ul>

      <h3>0.3 兩種 regressor 的結果</h3>
      <ul>
        <li>
          <strong>PHOS（8 相 PMUX 偏差）</strong>：regressor 是 8 個 one-hot，矩陣是 circulant。mode-1 有 {fx(W1 * 100, 0)}%（<Tex>{`W_1=${fx(W1, 4)}`}</Tex>）的權重落在 PMUX 的旋轉頻率 <Tex>{r`\alpha f_{ref}`}</Tex>。
          <ul>
            <li>
              當 <Tex>{r`\alpha f_{ref}`}</Tex> 落在反號帶內，PHOS LMS 就會反號（數字見下表）。
            </li>
            <li>
              <Tex>{r`\alpha\approx\tfrac14`}</Tex>、<Tex>{r`\tfrac12`}</Tex> 附近有 alias 造成的 dead zone；<Tex>{r`\alpha\to0`}</Tex> 時也是 dead zone（<Tex>{r`\lvert\kappa\rvert\lesssim5\times10^{-3}`}</Tex>）。
            </li>
          </ul>
        </li>
        <li>
          <strong>GOS（DTC 增益誤差）</strong>：regressor 是鋸齒波 <Tex>{r`\rho[n]`}</Tex>，功率分散到全頻帶的高次諧波。
          <ul>
            <li>
              在相關器延遲 <Tex>{'D=0'}</Tex> 時，三個迴路都<strong>沒有</strong>反號：{nScanLoops} 個迴路、每個 {nBeta.toLocaleString()} 個有理 <Tex>{r`\beta`}</Tex>，找到 {nNegTotal} 個反例——但目前沒有證明。
              <Claim kind="research" />
            </li>
            <li>
              Type-II 在 near-grid（<Tex>{r`\alpha\approx k/8`}</Tex>）時只會變成 dead zone，<Tex>{r`12C\approx12\beta^2/K_i`}</Tex>。
            </li>
            <li>
              若 <Tex>{'D=+1'}</Tex>（相關器晚一拍），GOS 會反號。
            </li>
          </ul>
        </li>
      </ul>

      <h3>0.4 結論總表</h3>
      <p className="small muted">
        <Tex>{r`\alpha f_{ref}`}</Tex> 一律折到 <Tex>{r`[0,2000]\ \mathrm{MHz}`}</Tex>，也就是 <Tex>{r`\min(\alpha,1-\alpha)f_{ref}`}</Tex>。
      </p>
      <DataTable
        head={['', 'L1 SSPLL Type-I', 'L2 SSPLL Type-II（PM 60°）', 'L3 CPPLL（3 階 Type-II，impulse-invariant）']}
        rows={rows.map(([label, fn]) => [label, ...LOOP_KEYS.map((k) => cell(k, fn))])}
      />
      <Src>
        前三列由本頁的 TS port（<code>sspll.ts</code>）即時計算，並在 <code>sspll.test.ts</code> 與 golden 逐項比對；其餘來自 golden 輸出的 <code>params.json</code>（mode-1 界限、<Tex>{r`j/4096`}</Tex> 精確 map）與{' '}
        <code>pred_vs_sim.json</code>。
      </Src>

      <h3>0.5 對策（排序；理論、時域 replica、閉迴路 LMS 三方一致）</h3>
      <ol className="cs-rank">
        <li>
          <strong>
            一階差分 regressor <Tex>{r`r[n]=x[n]-x[n-1]`}</Tex>
          </strong>
          ：任何 <Tex>{r`\alpha`}</Tex> 都可證明不反號，條件有 closed form（Type-II：<Tex>{r`K_i\le2K_p`}</Tex> 且 <Tex>{r`K_p+K_i/2\le2`}</Tex>）。regressor 是 zero-mean，所以對比較器 offset 也免疫。硬性前提是 code→比較器的延遲對齊{' '}
          <Tex>{'D=0'}</Tex>。
          <Claim kind="exact" />
        </li>
        <li>
          <strong>filtered-x</strong>：用 <Tex>{r`\hat H_{PD}`}</Tex> 先濾 regressor。BW 差 <Tex>{r`\pm20\%`}</Tex> 也安全；但若用 Type-I 模型去配 Type-II 迴路，需要 <Tex>{`\\hat K>${fx(kHatCrit, 4)}`}</Tex>。代價是 9 條 IIR 必須以 4 GHz 全速運作。
        </li>
        <li>
          <strong>校準時 hold 住積分路徑（P-only）</strong>，同時用 zero-mean regressor：迴路暫時變成 Type-I。代價是只能做 foreground 校準、BW 改變（{fx(pOnlyBw.L2, 0)}／{fx(pOnlyBw.L3a, 0)}–{fx(pOnlyBw.L3b, 0)} MHz），而且需要 dual-path
          或數位 loop filter 才做得到。
        </li>
        <li>
          <strong>PMUX 隨機旋轉／MASH</strong>：目前只有 sim 證據。
        </li>
        <li>
          <strong>keep-out 頻道或 freeze</strong>：keep-out 清單必須用大訊號 map 列，並留 PVT margin。
        </li>
      </ol>
      <Callout kind="danger" title="不要做">
        <p>
          讓相關器延遲 <Tex>{r`D\ne0`}</Tex>（<Tex>{`\\min\\mathrm{Re}\\,\\Gamma=${REMEDY.L2.d1.toFixed(2)}`}</Tex>），或改用二階差分 regressor（<Tex>{`\\min\\mathrm{Re}\\,\\Gamma=${REMEDY.L2.diff2.toFixed(2)}`}</Tex>，L2）。也<strong>不要</strong>
          在帶內頻道用經驗把更新符號翻過來：反號只對 mode-1 成立，其他模態與其他頻道會跟著錯（§16 題 2）。
        </p>
      </Callout>
    </Section>
  )
}
