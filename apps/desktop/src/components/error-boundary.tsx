import { Component, type ErrorInfo, type ReactNode } from "react";

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Burrete shell crashed", error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="app-shell" data-theme="dark">
        <div className="shell-error">
          <h1>Burrete could not render this window.</h1>
          <p>{this.state.error.message}</p>
          <div className="shell-error-actions">
            <button type="button" onClick={this.handleRetry}>Try again</button>
            <button type="button" onClick={this.handleReload}>Reload window</button>
          </div>
        </div>
      </main>
    );
  }
}
