import type { ReactNode } from 'react'
import { Callout, Section, Tex } from '@/components'
import { W1, loopF3dB } from '@/simulation/models/sspll'
import { BAND, FREF_MHZ, GOS_SCAN, LOOP_KEYS, LOOPS, PARAMS, PRED, P_ONLY, REMEDY, SUMMARY, SURE, SURE_GOLDEN, type LoopKey } from '../data'
import { Claim, DataTable, Diagram, FigRef, Formula, Src, fp, fx, intervalsText, r } from '../common'

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
        PD（比較器）看到的不是誤差本身 <Tex>{'u'}</Tex>（DTC 與 PMUX 在相位比較點注入的時間誤差），而是被主 PLL 迴路「高通」過的殘差 <Tex>{r`e_{PD}`}</Tex>。先看圖，再看公式：
      </p>
      <Diagram id="answer" />
      <p>
        先由左往右看主線：誤差 <Tex>{'u[n]'}</Tex> 要先經過藍色的主迴路才到比較器，所以比較器的輸出 <Tex>{r`q[n]=\pm1`}</Tex> 反映的是殘差 <Tex>{r`e_{PD}`}</Tex>，不是 <Tex>{'u'}</Tex>（<Tex>{'v'}</Tex> 是比較器輸入端的雜訊）。再看乘法點：GMAC 把 <Tex>{'q[n]'}</Tex> 和{' '}
        <strong>regressor</strong> <Tex>{'r_i[n]'}</Tex> 相乘再取平均，得到「權重該往哪邊修」的平均梯度。regressor 是 LMS 拿來相乘的已知數位序列，這裡是 DTC 的 code 與 PMUX 的 one-hot（選到哪一相）。圖上的藍色方塊就是下面公式裡的 <Tex>{r`H_{PD}`}</Tex>，它輸出箭頭上的{' '}
        <Tex>{r`e_{PD}=h_{PD}*u`}</Tex> 就是公式的第一式：<Tex>{r`h_{PD}`}</Tex> 是迴路對一個脈衝誤差的響應，<Tex>{'*'}</Tex> 是卷積，<Tex>{'L'}</Tex> 是開迴路增益，<Tex>{'T'}</Tex> 是閉迴路響應。
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
          <strong>Type-II 迴路</strong>：只要迴路是 Type-II（兩個積分器），在 DC 附近一定有 <Tex>{r`\mathrm{Re}\,H_{PD}\approx-\Omega^2/K_i<0`}</Tex>（<Tex>{r`\Omega=2\pi f/f_{ref}`}</Tex> 是每拍轉過的角度，單位 rad/sample；<Tex>{'K_i'}</Tex> 是迴路積分路徑的增益）。白話說，PD 看到的是誤差的「二次微分」，而任何訊號與自己的二次微分的相關都是負的。所以從 DC
          開始的反號帶<strong>無法消除，只能變窄</strong>。
          <Claim kind="exact" />
        </li>
        <li>
          <strong>Type-I 迴路（L1，標稱模型）</strong>：沒有反號帶，<Tex>{r`\mathrm{Re}\,H_{PD}\ge0`}</Tex>。但這不是 Type-I 天生免疫：只要迴路延遲 <Tex>{'d'}</Tex> 拍且 <Tex>{r`K(d-\tfrac12)>1`}</Tex>（<Tex>{'K'}</Tex> 是 Type-I 的迴路增益），或有寄生極點（<Tex>{'p'}</Tex> 是它在 <Tex>{'z'}</Tex> 平面上的位置，不是 PMUX 的索引）且{' '}
          <Tex>{r`K(\tfrac12+\tfrac{p}{1-p})>1`}</Tex>，也會出現反號帶。
          <Claim kind="exact" />
        </li>
      </ul>

      <h3>0.3 兩種 regressor 的結果</h3>
      <p>
        下面用 <Tex>{r`\kappa`}</Tex> 表示<strong>正規化的恢復斜率</strong>：沒有迴路（<Tex>{r`H_{PD}\equiv1`}</Tex>）時 <Tex>{r`\kappa=1`}</Tex>；<Tex>{r`\kappa>0`}</Tex> 會收斂，<Tex>{r`\kappa<0`}</Tex> 就是反號，<Tex>{r`\lvert\kappa\rvert`}</Tex> 很小則是
        dead zone（不收斂、會漂移）。
      </p>
      <ul>
        <li>
          <strong>PHOS（8 相 PMUX 偏差）</strong>：regressor 是 8 個 one-hot（PMUX 選到第 <Tex>{'k'}</Tex> 相時第 <Tex>{'k'}</Tex> 個為 1，其餘為 0），它們的平均梯度矩陣是 circulant，可以拆成 8 個模態（mode）各自分析。mode-1 有 {fx(W1 * 100, 0)}%（基波權重{' '}
          <Tex>{`W_1=${fx(W1, 4)}`}</Tex>）的權重落在 PMUX 的旋轉頻率 <Tex>{r`\alpha f_{ref}`}</Tex>。
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
          <strong>GOS（DTC 增益誤差）</strong>：regressor 是鋸齒波 <Tex>{r`\rho[n]`}</Tex>（DTC 的細調 code，§2），功率分散到全頻帶的高次諧波。
          <ul>
            <li>
              相關器延遲 <Tex>{'D'}</Tex> 是 GMAC 用的 regressor 比 code 晚的拍數（<Tex>{'r[n]=x[n-D]'}</Tex>，正確值是 0）。在 <Tex>{'D=0'}</Tex> 時，三個迴路都<strong>沒有</strong>反號：{nScanLoops} 個迴路、每個 {nBeta.toLocaleString()} 個有理{' '}
              <Tex>{r`\beta`}</Tex>（<Tex>{r`\beta=\mathrm{frac}(8\alpha)`}</Tex> 是鋸齒的基頻，§7），找到 {nNegTotal} 個反例——但目前沒有證明。
              <Claim kind="research" />
            </li>
            <li>
              Type-II 在 near-grid（<Tex>{r`\alpha\approx k/8`}</Tex>）時只會變成 dead zone，<Tex>{r`\kappa_{GOS}=12C\approx12\beta^2/K_i`}</Tex>（<Tex>{'C'}</Tex> 是 §4 定義的平均梯度斜率）。
            </li>
            <li>
              若 <Tex>{'D=+1'}</Tex>（相關器晚一拍），GOS 會反號。
            </li>
          </ul>
        </li>
      </ul>

      <h3>0.4 結論總表</h3>
      <p className="small muted">
        <Tex>{r`\alpha f_{ref}`}</Tex> 一律折到 <Tex>{r`[0,2000]\ \mathrm{MHz}`}</Tex>，也就是 <Tex>{r`\min(\alpha,1-\alpha)f_{ref}`}</Tex>。表中的記號：PM 是 phase margin；<Tex>{r`b=1+C_1/C_2`}</Tex> 與 <Tex>{r`\omega_cT_{ref}`}</Tex> 是 CPPLL 的極零點比與交越頻率（§6.3）；
        <Tex>{r`\tau`}</Tex> 是判定門檻（<Tex>{r`\kappa<-\tau`}</Tex> 才算反號）；<Tex>{'A'}</Tex> 是誤差的振幅，<Tex>{r`A\to\infty`}</Tex> 是 1-bit 比較器完全飽和的大訊號極限（§10.4）。
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
      <p className="small muted">
        每個對策改的是哪一個方塊，§11 的 <FigRef id="remedy-g" /> 畫在同一張圖上。下面的 <Tex>{'x'}</Tex> 是原本的 regressor，<Tex>{'r'}</Tex> 是 GMAC 實際拿來相乘的版本；<Tex>{'K_p'}</Tex>、<Tex>{'K_i'}</Tex> 是 Type-II 迴路的比例與積分增益。
      </p>
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
          <strong>filtered-x</strong>：用迴路的數位模型 <Tex>{r`\hat H_{PD}`}</Tex> 先濾 regressor。BW 差 <Tex>{r`\pm20\%`}</Tex> 也安全；但若用 Type-I 模型去配 Type-II 迴路，需要 <Tex>{`\\hat K>${fx(kHatCrit, 4)}`}</Tex>。代價是 9 條 IIR 必須以 4 GHz 全速運作。
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
          讓相關器延遲 <Tex>{r`D\ne0`}</Tex>（<Tex>{`\\min\\mathrm{Re}\\,\\Gamma=${REMEDY.L2.d1.toFixed(2)}`}</Tex>；<Tex>{r`\Gamma`}</Tex> 是 §4.3 的有效 kernel，也就是 <Tex>{r`H_{PD}`}</Tex> 乘上 regressor 前置濾波的共軛，它的實部為負就會反號），或改用二階差分 regressor（<Tex>{`\\min\\mathrm{Re}\\,\\Gamma=${REMEDY.L2.diff2.toFixed(2)}`}</Tex>，L2）。也<strong>不要</strong>
          在帶內頻道用經驗把更新符號翻過來：反號只對 mode-1 成立，其他模態與其他頻道會跟著錯（§16 題 2）。
        </p>
      </Callout>
    </Section>
  )
}
