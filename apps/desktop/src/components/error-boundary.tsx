import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary" role="alert">
          <div className="error-boundary-card">
            <h1>Something went wrong</h1>
            <pre>{this.state.error.message}</pre>
            {this.state.error.stack && <pre className="error-boundary-stack">{this.state.error.stack}</pre>}
            <button onClick={this.handleRetry}>Try again</button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
