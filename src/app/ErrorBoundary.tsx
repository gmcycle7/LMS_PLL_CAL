import { Component, type ErrorInfo, type ReactNode } from 'react'
import { clearChunkReloadFlag, isChunkLoadError } from './lazyRetry'

interface State {
  error: Error | null
}

interface Props {
  children: ReactNode
  label?: string
  /** 整頁重新載入的動作（測試時可替換） */
  reload?: () => void
}

/**
 * 頁面或實驗元件出錯時顯示中文錯誤，而不是整站白畫面。
 * 程式檔案載入失敗（部署後舊 hash 404）時，「重試」只會讓 React.lazy 再丟出同一個快取的錯誤，
 * 所以改成「重新載入頁面」按鈕並真的 reload。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', this.props.label ?? '', error, info.componentStack)
  }

  private reload = () => {
    clearChunkReloadFlag()
    ;(this.props.reload ?? (() => window.location.reload()))()
  }

  render() {
    const { error } = this.state
    if (error) {
      const prefix = this.props.label ? `${this.props.label}：` : ''
      if (isChunkLoadError(error)) {
        return (
          <div className="callout callout-danger" role="alert" data-error-kind="chunk">
            <strong>{prefix}這一頁的程式檔案載入失敗</strong>
            <p>可能是網站剛更新、或網路暫時中斷，請重新載入頁面再試一次。</p>
            <p className="small muted">{error.message}</p>
            <button type="button" className="btn btn-primary" onClick={this.reload}>
              重新載入頁面
            </button>
          </div>
        )
      }
      return (
        <div className="callout callout-danger" role="alert" data-error-kind="runtime">
          <strong>{prefix}元件執行錯誤</strong>
          <p>{error.message}</p>
          <button type="button" className="btn" onClick={() => this.setState({ error: null })}>
            重試
          </button>{' '}
          <button type="button" className="btn" onClick={this.reload}>
            重新載入頁面
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
