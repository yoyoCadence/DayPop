import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthProvider } from './auth/AuthProvider';
import { SessionDataProvider } from './data/SessionDataProvider';
import { ThemeProvider } from './theme/ThemeProvider';
import './theme/fonts.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <SessionDataProvider>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </SessionDataProvider>
    </AuthProvider>
  </StrictMode>,
);
