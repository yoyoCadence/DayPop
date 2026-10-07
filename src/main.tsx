import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthProvider } from './auth/AuthProvider';
import { SessionDataProvider } from './data/SessionDataProvider';
import { AppUpdateProvider } from './pwa/AppUpdateProvider';
import { ErrorBoundary } from './shell/ErrorBoundary';
import { RootErrorFallback } from './shell/RootErrorFallback';
import { ThemeProvider } from './theme/ThemeProvider';
import './theme/fonts.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Outermost, so a provider or the shell failing to render still leaves an
        explanation and a reload instead of a blank page. A single screen
        failing is caught closer in, by the boundary inside `App` — DP-139
        (`e2e/screen-error-boundary.spec.ts` covers this composition). */}
    <ErrorBoundary
      fallback={(caught) => (
        <RootErrorFallback {...caught} onReload={() => window.location.reload()} />
      )}
    >
      {/* Above `SessionDataProvider`, whose keyed remount would otherwise run the
          version check again on every cold start — DP-073. Keep it outside that
          provider: moving it back in is what caused the repeat, and no unit test
          covers this file's composition (`e2e/version-check.spec.ts` does). */}
      <AppUpdateProvider>
        <AuthProvider>
          <SessionDataProvider>
            <ThemeProvider>
              <App />
            </ThemeProvider>
          </SessionDataProvider>
        </AuthProvider>
      </AppUpdateProvider>
    </ErrorBoundary>
  </StrictMode>,
);
