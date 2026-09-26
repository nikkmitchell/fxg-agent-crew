import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportClientError } from "./client-errors";

/**
 * A CRASH IS A MESSAGE AND A WAY BACK, NOT A BLANK PAGE.
 *
 * There was no error boundary anywhere: one exception while drawing any part
 * of the room unmounted the whole app, leaving an empty page (and, in a
 * headset, an ended session) with nothing said and nothing reported. Now the
 * failing part is replaced by a sentence and a button to try again, and the
 * error goes to the server log (client-errors.ts).
 */
export class ErrorBoundary extends Component<
  { where: string; children: ReactNode; fallback?: (retry: () => void) => ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const withComponents = new Error(error.message);
    withComponents.name = error.name;
    withComponents.stack = `${error.stack ?? ""}\n--- components ---${info.componentStack ?? ""}`;
    reportClientError(withComponents, this.props.where);
  }

  private retry = () => this.setState({ failed: false });

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.retry);
    return (
      <section className="crash-notice" role="alert">
        <h2>Something here stopped working.</h2>
        <p>It has been reported. Try again, or reload the page if it keeps happening.</p>
        <p>
          <button type="button" onClick={this.retry}>Try again</button>{" "}
          <button type="button" onClick={() => location.reload()}>Reload</button>
        </p>
      </section>
    );
  }
}
