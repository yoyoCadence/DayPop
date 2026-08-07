import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthProvider } from './auth/AuthProvider';
import { DataProvider } from './data/DataProvider';
import { ThemeProvider } from './theme/ThemeProvider';
import './theme/fonts.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        {/* Below AuthProvider: DP-026 picks the adapter from the session. */}
        <DataProvider>
          <App />
        </DataProvider>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
