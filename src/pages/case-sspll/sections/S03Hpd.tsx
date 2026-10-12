import { ModeGate, Prereq, Section, StepDerivation, Tex } from '@/components'
import { H_IMPULSE, LOOP_KEYS } from '../data'
import { DataTable, Diagram, FigRef, ModelCode, Src, fx, r } from '../common'

/** §3 從比較點（PD 的輸入端）到 PD 的輸出：H_PD = 1/(1 + L) 的逐步推導與脈衝響應。外加誤差 u 在 PD 的 reference 輸入端（＋），迴路的修正 y 從 feedback 輸入端回來（−）。 */
export function S03Hpd() {
  return (
    <Section kind="formula" level={2} title="3. 從比較點到 PD 的輸出：$H_{PD}$ 的推導" id="cs-3">
      <Prereq title="Z transform、離散頻率 $\Omega$、頻率響應、卷積、pole">
        <ul>
          <li>
            <strong>離散時間訊號</strong>：每個 <Tex>{r`T_{ref}`}</Tex> 取一個值，記為 <Tex>{'x[n]'}</Tex>。
          </li>
          <li>
            <strong>延遲一拍</strong>：記為 <Tex>{r`z^{-1}`}</Tex>，意思是 <Tex>{r`(z^{-1}x)[n]=x[n-1]`}</Tex>。把 <Tex>{r`z^{-1}`}</Tex> 當成一個代數符號，就可以把「差分方程」寫成「多項式的除法」，這就是 <strong>Z transform</strong>。例如{' '}
            <Tex>{'y[n]=y[n-1]+x[n-1]'}</Tex>（累加器）寫成 <Tex>{r`Y=z^{-1}Y+z^{-1}X`}</Tex>，解出 <Tex>{r`Y/X=z^{-1}/(1-z^{-1})`}</Tex>。
          </li>
          <li>
            <strong>
              離散頻率 <Tex>{r`\Omega`}</Tex>
            </strong>
            ：輸入一個複弦波 <Tex>{r`x[n]=e^{j\Omega n}`}</Tex>，延遲一拍等於乘上 <Tex>{r`e^{-j\Omega}`}</Tex>。所以在單位圓上 <Tex>{r`z^{-1}=e^{-j\Omega}`}</Tex>，<Tex>{r`\Omega=2\pi f/f_{ref}\in[-\pi,\pi]`}</Tex>。
          </li>
          <li>
            <strong>頻率響應</strong>：線性非時變（LTI）系統對 <Tex>{r`e^{j\Omega n}`}</Tex> 的輸出是 <Tex>{r`H(e^{j\Omega})e^{j\Omega n}`}</Tex>。複數 <Tex>{'H'}</Tex> 的大小 <Tex>{r`\lvert H\rvert`}</Tex> 是增益，角度{' '}
            <Tex>{r`\angle H`}</Tex> 是相位；實部 <Tex>{r`\mathrm{Re}\,H=\lvert H\rvert\cos\angle H`}</Tex> 是「與輸入同相的部分」。
          </li>
          <li>
            <strong>卷積</strong>：<Tex>{'y=h*x'}</Tex> 的意思是 <Tex>{r`y[n]=\sum_m h[m]x[n-m]`}</Tex>；在頻域對應 <Tex>{'Y=HX'}</Tex>。
          </li>
          <li>
            <strong>pole（極點）與穩定</strong>：<Tex>{'H(z)'}</Tex> 分母的根叫 pole。所有 pole 都在單位圓內（<Tex>{r`\lvert z\rvert<1`}</Tex>）時，脈衝響應會衰減，系統穩定。
          </li>
        </ul>
      </Prereq>
      <p>
        設比較點（PD 的輸入端）收到的「外加誤差」是 <Tex>{'u[n]'}</Tex>（DTC 加 PMUX 的誤差，已依 §2 的極性約定折算到 PD 的 reference 輸入端；見 <FigRef id="injection" />），迴路產生的修正是 <Tex>{'y[n]'}</Tex>，從 PD 的 feedback 輸入端回來。主迴路是一個負回授：PD
        量到殘差，loop filter 與 VCO 把它變成修正量，下一拍再從誤差裡扣掉。
      </p>
      <Diagram id="hpd-loop" />
      <p>
        先看藍色的圓，它就是 PD（一個做減法的加法點）：它的輸出 <Tex>{r`e_{PD}[n]`}</Tex> 同時送到兩個地方——一路進主迴路的 loop filter（外框標著 <Tex>{'L(z)'}</Tex> 的那一塊），一路給 1-bit 比較器。所以校正迴路取的是 PD 的輸出，也就是送進 loop filter 的同一個訊號。再看 <Tex>{'L(z)'}</Tex> 的外框：殘差經過 loop filter、VCO（把頻率積分成相位）和 1 拍延遲之後，變成修正量 <Tex>{'y[n]'}</Tex>，以負號回到 PD。圖上的 PD 就是下面推導的第 1 步{' '}
        <Tex>{r`e_{PD}=u-y`}</Tex>；整個外框就是第 2 步的 <Tex>{'L(z)'}</Tex>（開迴路增益：從 <Tex>{r`e_{PD}`}</Tex> 繞一圈回到 <Tex>{'y'}</Tex> 的轉移函數）。三個迴路的外框裡各放什麼，見 §6 的 <FigRef id="three-loops" />。
      </p>
      <p>把圖寫成代數，PD 看到的殘差一步一步推：</p>
      <StepDerivation
        title="一步一步：誤差 → PD 的轉移函數"
        steps={[
          { tex: r`e_{PD}[n]=u[n]-y[n]`, why: 'PD（比較點）做減法：reference 輸入端的外加誤差，減去從 feedback 輸入端回來的迴路修正。' },
          { tex: r`Y(z)=L(z)\,E_{PD}(z)`, why: <>迴路把 PD 輸出經 loop filter、VCO（積分器）和 1 拍延遲送回來；這整條路徑記為 <Tex>{'L(z)'}</Tex>。</> },
          { tex: r`E_{PD}=U-L\,E_{PD}`, why: '把第 2 步代入第 1 步（Z transform 是線性的，可以逐項代入）。' },
          { tex: r`(1+L)\,E_{PD}=U`, why: <>把含 <Tex>{r`E_{PD}`}</Tex> 的項移到左邊。</> },
          { tex: r`E_{PD}=\frac{1}{1+L}\,U\;\equiv\;H_{PD}\,U`, why: <>兩邊除以 <Tex>{'(1+L)'}</Tex>。</> },
        ]}
        result={r`H_{PD}(z)=\frac{1}{1+L(z)}`}
      />
      <p>
        這裡的 <Tex>{r`H_{PD}`}</Tex> 就是你問的「DTC GOS／PHOS 誤差到 PD 輸出的 transfer function」。因為 <Tex>{'L'}</Tex> 嚴格 proper（至少 1 拍延遲），<Tex>{r`L(\infty)=0`}</Tex>，所以{' '}
        <Tex>{r`h_{PD}[0]=1`}</Tex>：<strong>誤差注入的當拍，PD 會原封不動看到它</strong>。這一點後面會變成一階差分對策的關鍵（§11）。同一組式子也給出迴路的修正 <Tex>{r`Y=L\,E_{PD}=T\,U`}</Tex>，<Tex>{r`T=L/(1+L)=1-H_{PD}`}</Tex>：外加誤差從 PD 的 reference
        輸入端進來，所以 <Tex>{r`E_{PD}=H_{PD}\,U`}</Tex> 與 <Tex>{r`Y=T\,U`}</Tex> 都是正號。
      </p>
      <h3>先算一次：三個迴路的脈衝響應</h3>
      <DataTable
        className="cs-num"
        head={['', ...[0, 1, 2, 3, 4, 5].map((i) => <Tex key={i}>{`h_{PD}[${i}]`}</Tex>)]}
        rows={LOOP_KEYS.map((k) => [k, ...H_IMPULSE[k].map((v) => fx(v, 5))])}
      />
      <p>
        直覺：誤差剛出現時 PD 全部看到，接著迴路把它「吃掉」，所以後面全是負值。Type-I 的負尾巴總和是 <Tex>{'-1'}</Tex>（<Tex>{r`\sum h=H(1)=0`}</Tex>）。Type-II 的負尾巴更長，還會稍微 overshoot（多一個 DC 零點）。這條「又長又小的負尾巴」就是反號的來源：
        regressor 若變化得很慢，尾巴的累積就會蓋過 <Tex>{r`h_{PD}[0]=1`}</Tex> 那一拍。
      </p>
      <Src>
        <code>loopImpulse</code>（<code>sspll.ts</code>）即時計算；與 golden 的 <code>worked_examples.json</code> 比對到 5 位小數。
      </Src>
      <ModeGate min="engineer">
        <ModelCode
          region="hpd"
          title="$H_{PD}$、$L$、$T$ 的頻率響應（網站實際執行的程式）"
          caption="$L(z)=b_L(z^{-1})/a_L(z^{-1})$，係數為 $z^{-1}$ 的升冪；$H_{PD}=a_L/(a_L+b_L)$、$T=b_L/(a_L+b_L)$，在 $z^{-1}=e^{-j2\pi f}$ 上以 Horner 法求值。"
        />
      </ModeGate>
    </Section>
  )
}
