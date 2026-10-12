import { useRef, type CSSProperties } from 'react';
import { useDiagnosticsCopy } from './diagnostics';
import type { ErrorFallbackProps } from './ErrorBoundary';

export interface RootErrorFallbackProps extends ErrorFallbackProps {
  onReload(): void;
}

/**
 * Deliberately self-contained. This renders when a provider or the shell has
 * failed, so neither the theme tokens nor the shell stylesheet can be assumed;
 * the colours are 漫畫 light, the default theme and the page's first paint.
 */
const page: CSSProperties = {
  display: 'grid',
  minHeight: '100dvh',
  boxSizing: 'border-box',
  placeItems: 'center',
  padding: 24,
  background: '#ffffff',
  color: '#111111',
  fontFamily: 'system-ui, sans-serif',
};

const reload: CSSProperties = {
  border: '2px solid #111111',
  borderRadius: 10,
  background: '#e4002b',
  padding: '11px 18px',
  color: '#ffffff',
  fontSize: 15,
  fontWeight: 800,
};

const copyButton: CSSProperties = {
  display: 'block',
  marginTop: 12,
  border: '2px solid #111111',
  borderRadius: 8,
  background: '#ffffff',
  padding: '7px 12px',
  color: '#111111',
  fontSize: 12,
  fontWeight: 800,
};

const manualField: CSSProperties = {
  display: 'block',
  boxSizing: 'border-box',
  width: '100%',
  marginTop: 8,
  border: '2px solid #111111',
  borderRadius: 8,
  padding: '8px 10px',
  color: '#111111',
  // 16px keeps iOS Safari from zooming the page when the field takes focus.
  fontSize: 16,
  lineHeight: 1.5,
  resize: 'none',
};

/**
 * Last resort when the App cannot start at all — DP-139.
 *
 * There is no 再試一次 here: the tree above the screens failed, and rendering
 * it again in place would most likely fail the same way. A reload is the only
 * honest offer. Nothing on the device is read, written or sent. 複製診斷資訊
 * (DP-146) puts a report on the clipboard only when the user asks.
 */
export function RootErrorFallback({ error, onReload }: RootErrorFallbackProps) {
  const manualRef = useRef<HTMLTextAreaElement>(null);
  const diagnostics = useDiagnosticsCopy(error, '啟動', manualRef);
  return (
    <div role="alert" style={page}>
      <div style={{ maxWidth: 360 }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 20 }}>日蹦暫時無法啟動</h1>
        <p style={{ margin: '0 0 16px', fontSize: 14, lineHeight: 1.7 }}>
          App 啟動時發生錯誤。存在這台裝置或帳號裡的資料沒有被刪除。
        </p>
        <button type="button" onClick={onReload} style={reload}>
          重新載入
        </button>
        <details style={{ marginTop: 16, fontSize: 12, lineHeight: 1.7 }}>
          <summary>錯誤訊息</summary>
          <p style={{ margin: '6px 0 0', overflowWrap: 'anywhere' }}>{error.message || '（沒有訊息）'}</p>
        </details>
        <button type="button" onClick={() => void diagnostics.copy()} style={copyButton}>
          複製診斷資訊
        </button>
        {diagnostics.message && (
          <p role="status" style={{ margin: '8px 0 0', fontSize: 12, lineHeight: 1.6 }}>
            {diagnostics.message}
          </p>
        )}
        {diagnostics.status === 'manual' && (
          <textarea
            ref={manualRef}
            aria-label="診斷資訊"
            readOnly
            rows={5}
            value={diagnostics.text}
            style={manualField}
          />
        )}
      </div>
    </div>
  );
}
