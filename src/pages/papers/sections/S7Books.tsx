import { Callout, Section } from '@/components'
import { BOOK_TOPICS } from '../references'
import { PageChips, Question, RichText } from '../common'

/** §7：背景教科書（依主題；只列到書籍層級）。 */
export function S7Books() {
  return (
    <Section kind="example" level={2} title="7. 背景教科書（依主題）" id="papers-books">
      <Question>論文假設你已經會的東西（期望值、PSD、特徵值、Z transform、LMS 的標準分析），要去哪裡補？</Question>
      <Callout kind="info" title="引用範圍">
        下列教科書只列到<strong>書籍層級</strong>：作者、書名、出版社，版次或年份只在確定時寫出；本站不引用頁碼或章節編號，也不轉述書中的特定數字。版次不同時記號可能不同，請以你手上的版本為準。
      </Callout>
      {BOOK_TOPICS.map((t) => (
        <div key={t.id} className="papers-topic">
          <h3 className="papers-subhead">{t.topic}</h3>
          <p className="small muted">
            本站用到的地方：
            <RichText text={t.usedFor} />
          </p>
          <ul className="papers-books">
            {t.books.map((b) => (
              <li key={b.id} data-book={b.id}>
                <div>
                  {b.authors}, <cite>{b.title}</cite>. {b.publisher}
                  {b.edition ? `（${b.edition}）` : ''}.
                </div>
                <div className="small">
                  <RichText text={b.why} />
                </div>
                <div className="small">
                  搭配：
                  <PageChips ids={b.pages_} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Section>
  )
}
