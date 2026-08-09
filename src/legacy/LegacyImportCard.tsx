import { useLegacyImport } from './legacyImportContext';
import './legacyImport.css';

export function LegacyImportCard() {
  const { state, importLegacy } = useLegacyImport();

  if (state.status === 'missing') return null;

  return (
    <section className="legacy-import-card" aria-live="polite">
      <div>
        <h2>舊版日曆資料</h2>
        {state.status === 'checking' && <p>正在安全檢查 calpet.v2…</p>}
        {state.status === 'invalid' && (
          <p className="legacy-import-error">資料沒有通過驗證，未寫入任何內容。{state.message}</p>
        )}
        {state.status === 'imported' && (
          <p>
            已完成一次性匯入。原始 calpet.v2 仍保留在這台裝置，沒有被覆寫或刪除。
          </p>
        )}
        {(state.status === 'ready' || state.status === 'importing' || state.status === 'failed') && (
          <>
            <p>{previewText(state.preview)}</p>
            <p className="legacy-import-notice">
              AI 金鑰絕不匯入；舊附件與邀請人留待專屬功能處理。成功前原始資料保持不動。
            </p>
            {state.preview.remappedDuplicateIds > 0 && (
              <p>發現 {state.preview.remappedDuplicateIds} 個重複舊 ID，將以全新 ID 安全分開。</p>
            )}
            {state.status === 'ready' && !state.signedIn && <p>登入帳號後才能匯入雲端。</p>}
            {state.status === 'failed' && (
              <p className="legacy-import-error">匯入未完成：{state.message}</p>
            )}
          </>
        )}
      </div>
      {(state.status === 'ready' || state.status === 'failed') && (
        <button
          className="button primary"
          type="button"
          disabled={state.status === 'ready' ? !state.signedIn : false}
          onClick={() => void importLegacy()}
        >
          {state.status === 'failed' ? '重試匯入' : '匯入舊資料'}
        </button>
      )}
      {state.status === 'importing' && (
        <button className="button primary" type="button" disabled>
          匯入中…
        </button>
      )}
    </section>
  );
}

function previewText(preview: {
  calendars: number;
  events: number;
  todos: number;
  stickers: number;
}): string {
  return `可匯入 ${preview.calendars} 個日曆、${preview.events} 個行程、${preview.todos} 個待辦與 ${preview.stickers} 張貼圖。`;
}
