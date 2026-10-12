import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ClaimTag, mathText, ModelLevel, SourceTag, SymbolTable, SystemMap, Tex, TestBadge, type SystemBlock } from '@/components'
import './chapter.css'
import { HANDCALCS } from './handcalcs'
import { Erratum, JumpTo } from './shared'
import { CH06_SYMBOLS } from './symbols'
import { S1Intro } from './sections/S1Intro'
import { S2WhyU } from './sections/S2WhyU'
import { S3GmacPole } from './sections/S3GmacPole'
import { S4SingleTone } from './sections/S4SingleTone'
import { S5LoopTypes } from './sections/S5LoopTypes'
import { S6MultiTone } from './sections/S6MultiTone'
import { S7Lab } from './sections/S7Lab'
import { S8Recap } from './sections/S8Recap'

const TOC: [string, ReactNode][] = [
  ['ch06-s1', '§1 一個問題：你推的和 comparator 看到的不同'],
  ['ch06-s2', <>§2 為什麼 PD 看到 <Tex>{'u=h*x'}</Tex></>],
  ['ch06-s3', <>§3 <Tex>{'G\\approx K_q(a-w)C'}</Tex> 與 <Tex>{'p=1-\\mu K_qC'}</Tex></>],
  ['ch06-s4', <>§4 單頻：<Tex>{'\\tfrac{A^2}{2}|H|\\cos\\phi'}</Tex>（E46）</>],
  ['ch06-s5', '§5 Type-I vs Type-II、二次微分、CT↔DT（E44）'],
  ['ch06-s6', '§6 多頻判據與近整數 FCW'],
  ['ch06-s7', '§7 動手：Polarity Explorer'],
  ['ch06-s8', '§8 比較、綜合手算、思考題與本課必記'],
  ['symbols', '本章符號表（章末）'],
]

/**
 * 系統地圖上標成藍色的方塊：reference 輸入端的 DTC（誤差的來源）、主 PLL 迴路（PD、loop filter、VCO、回授的 divider——
 * PD 的輸出是被它濾過的誤差）與校正迴路裡做相關的 comparator、GMAC（comparator 取的是 PD 的輸出）。
 */
const SYSTEM_FOCUS: SystemBlock[] = ['dtc', 'pd', 'lf', 'vco', 'div', 'cmp', 'gmac']

/** 第 06 章：PLL Error Transfer 的相位會讓 LMS 發散嗎？（規格 §6、§6.1、§6.2；入門課第 6 課） */
export default function Chapter06() {
  return (
    <div className="ch06">
      <p className="ch06-lead">
        前五章假設 comparator 直接看到 DTC 的誤差。實際上 comparator 取的是 PD 的輸出：DTC 在 reference 的輸入端，它沒補乾淨的誤差一進 PD，主
        PLL 的回授就開始追它、修它，所以 PD 輸出的是被主 PLL 濾過的誤差：大小變了，相位也轉了。這一章證明：
        <strong>
          只要 PLL 讓誤差轉超過 <Tex>{'90^\\circ'}</Tex>，用原始 code 做相關的 GMAC 就會往錯的方向更新
        </strong>
        ；並推導什麼樣的 PLL、什麼樣的 code 會發生這件事。
      </p>
      <div className="ch06-tags">
        <ModelLevel level="L2" showName />
        <ClaimTag kind="exact" />
        <ClaimTag kind="approx" />
        <SourceTag kind="illustrative" />
        <TestBadge id="T06" />
        <Erratum id="E44" />
        <Erratum id="E46" />
      </div>
      <p className="small ch06-symbols-link">
        <JumpTo target="symbols">本章符號表在最後 ↓</JumpTo>（每個符號第一次出現時，正文會先用一句話說明；章末的表可以查單位與全站約定。）
      </p>
      <SystemMap
        focus={SYSTEM_FOCUS}
        caption="系統地圖：藍色是本章的主角——reference 輸入端的 DTC、主 PLL 迴路（phase detector、loop filter、VCO、回授路徑上的 divider）與校正迴路的 1-bit comparator、GMAC。教學用概念架構，不是特定晶片的 netlist。"
      />
      <p className="ch06-map-note">
        <strong>你在這裡：</strong>最上面那條泳道的藍色方塊分成兩部分：reference 輸入端的 DTC，和它後面那一圈主 PLL 迴路（phase detector → loop filter → VCO → divider
        → 回到 phase detector；回授路徑上只有 divider）。DTC 沒補乾淨的時間誤差從 PD 的 reference 輸入端進來，迴路就開始追、開始修。
        下面兩個藍色方塊（1-bit comparator、GMAC）則是校正迴路裡「拿誤差的正負號去和原始 code <Tex>{'x[n]'}</Tex> 做相關」的部分；comparator 取的是 PD 的輸出——圖上那一對同名的標籤{' '}
        <Tex>{'e[n]'}</Tex>，也就是送進 loop filter 的同一個訊號（本章記作 <Tex>{'e_{\\mathrm{PD}}[n]'}</Tex>；地圖上另外畫進 comparator 的雜訊{' '}
        <Tex>{'v[n]'}</Tex>，從 §2 的 F-06.1 起也併進 <Tex>{'e_{\\mathrm{PD}}'}</Tex> 裡）。前幾章把「DTC 的誤差」和「PD 的輸出」當成同一個東西；
        <strong>這一章補上兩者之間被省略的方塊</strong>——主 PLL 對 DTC 誤差的轉移函數 <Tex>{'H_{\\mathrm{PD}}=1/(1+L)'}</Tex>（從 PD 的 reference 輸入到 PD 的輸出；<Tex>{'L'}</Tex>{' '}
        是主 PLL 的開迴路增益）——並說明它把誤差的相位轉過 <Tex>{'90^\\circ'}</Tex> 之後，GMAC 的更新方向為什麼會反過來。
      </p>
      <nav className="ch06-toc" aria-label="本章目錄">
        <strong>本章目錄</strong>
        <ol>
          {TOC.map(([id, label]) => (
            <li key={id}>
              <JumpTo target={id}>{label}</JumpTo>
            </li>
          ))}
        </ol>
      </nav>
      <div className="ch06-handcalc-index" aria-label="本章的帶入手算題">
        <p>
          <strong>帶入手算（{HANDCALCS.length} 題）</strong>
          ：每個重要公式後面都有一題，可以換成你自己的數字、先用紙筆和計算機算，再逐步對答案；也可以切到「自己算算看」或按「換一題」。全站題目彙整在{' '}
          <Link to="/workbook">手算練習簿</Link>。步驟裡的中間值顯示 6 位有效數字，比答案框的 5 位多留一位「保護位數」：手算時也請把中間值多留一位，
          最後一步再四捨五入，答案才不會因為連續捨入而差在最後一兩位。兩個很接近的數相減時前幾位會互相抵消（例如 HC-06.7 的{' '}
          <Tex>{'C_1+C_2'}</Tex>），那幾步會自動多顯示幾位；每一步畫面上的數字照按計算機，都算得出下一個等號。
        </p>
        <ol>
          {HANDCALCS.map((h) => (
            <li key={h.id}>
              <JumpTo target={`handcalc-${h.id}`}>{h.id}</JumpTo> {mathText(h.title)}
            </li>
          ))}
        </ol>
      </div>
      <S1Intro />
      <S2WhyU />
      <S3GmacPole />
      <S4SingleTone />
      <S5LoopTypes />
      <S6MultiTone />
      <S7Lab />
      <S8Recap />
      {/* 符號表放在章末（docs/teaching-style.md §5）；章首的「本章符號表在最後 ↓」與目錄最後一項會捲到這裡 */}
      <div className="ch06-symbols" id="symbols">
        <SymbolTable
          rows={CH06_SYMBOLS}
          caption={
            <>
              全站約定見 Formula &amp; Unit Reference。本章 <Tex>{'\\delta=a-w'}</Tex>；<Tex>{'C'}</Tex> 指 <Tex>{'E[x[n-D]\\,u[n]]'}</Tex>（§11 的
              code-correlated disturbance 已改名 <Tex>{'\\varepsilon_{cc}'}</Tex>，<Erratum id="E12" />）。「首次出現」欄是正文第一次用到並就地解釋這個符號的小節。
            </>
          }
        />
        <p className="small">
          <JumpTo target="ch06-s1">↑ 回到 §1</JumpTo>
        </p>
      </div>
    </div>
  )
}
