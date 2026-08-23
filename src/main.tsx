import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthProvider } from './auth/AuthProvider';
import { SessionDataProvider } from './data/SessionDataProvider';
import { AppUpdateProvider } from './pwa/AppUpdateProvider';
import { ThemeProvider } from './theme/ThemeProvider';
import './theme/fonts.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
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
  </StrictMode>,
);
