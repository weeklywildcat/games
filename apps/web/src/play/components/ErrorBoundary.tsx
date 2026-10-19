import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Last line of defense for an unattended board: if anything throws while
 * rendering, show a calm message and reload the page a few seconds later
 * instead of leaving a blank screen.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  private timer: number | undefined;

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Wildcat Games recovered from a render error", error, info.componentStack);
    this.timer = window.setTimeout(() => window.location.reload(), 4000);
  }

  override componentWillUnmount() {
    window.clearTimeout(this.timer);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="status-screen" role="alert">
        <div className="status-screen-card">
          <h1 className="display">One sec…</h1>
          <p>The arcade hit a snag and is resetting itself.</p>
        </div>
      </div>
    );
  }
}
