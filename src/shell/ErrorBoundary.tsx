import { Component, type ReactNode } from 'react';

export interface ErrorFallbackProps {
  /** Always an `Error`, so a fallback can show `.message` without checking. */
  error: Error;
  /** Renders the children again; the fallback returns if they still throw. */
  retry(): void;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback(props: ErrorFallbackProps): ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Stops a render error from blanking the App — DP-139.
 *
 * React unmounts the whole tree when an error escapes rendering. Without a
 * boundary that left a white page, and if the error came from stored data a
 * reload showed the same white page, with no way to reach 設定 and export.
 *
 * Two are mounted: one around the active tab screen in `App` (keyed by tab, so
 * another tab starts clean while the tab bar stays usable) and one around the
 * whole tree in `main.tsx` for a failure in a provider or the shell itself.
 *
 * This only catches and explains. It reports nothing anywhere: sending errors
 * off the device needs a service, a CSP change and a privacy note first, which
 * is the part of DP-034 still open. React already logs caught errors to the
 * console, so nothing is logged again here.
 *
 * A class because React has no hook for catching render errors.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(thrown: unknown): ErrorBoundaryState {
    return { error: thrown instanceof Error ? thrown : new Error(String(thrown)) };
  }

  retry = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    return error ? this.props.fallback({ error, retry: this.retry }) : this.props.children;
  }
}
