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
        version check a second time on every cold start — DP-073. */}
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
