import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { failed: boolean }

/** React errors do not reliably reach window.onerror, so report them explicitly. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }
  static getDerivedStateFromError(): State { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    void window.researchNotebook.diagnostics.reportError({ severity: 'error', category: 'react.render', message: error.message || 'React rendering failed', stack: error.stack, context: { componentStack: info.componentStack } }).catch(() => undefined)
  }
  render(): ReactNode { return this.state.failed ? <main role="alert"><h1>Something went wrong</h1><p>The error was saved to local diagnostics. Restart the application to continue.</p></main> : this.props.children }
}
