import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/** 頁面或實驗元件出錯時顯示中文錯誤，而不是整站白畫面。 */
export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', this.props.label ?? '', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="callout callout-danger" role="alert">
          <strong>{this.props.label ? `${this.props.label}：` : ''}元件執行錯誤</strong>
          <p>{this.state.error.message}</p>
          <button type="button" className="btn" onClick={() => this.setState({ error: null })}>
            重試
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
