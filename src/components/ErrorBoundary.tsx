import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary__icon">!</div>
          <h1 className="error-boundary__title">Something went wrong</h1>
          <p className="error-boundary__message">
            An unexpected error occurred. Please reload the page and try again.
          </p>
          {this.state.error && (
            <pre className="error-boundary__detail">{this.state.error.message}</pre>
          )}
          <button className="btn btn-primary" onClick={this.handleReload}>
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
