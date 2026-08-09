import { createContext, useContext } from 'react';
import type { LegacyImportPreview } from './legacyImport';

export type LegacyImportState =
  | { status: 'checking' }
  | { status: 'missing' }
  | { status: 'invalid'; message: string }
  | { status: 'ready'; preview: LegacyImportPreview; signedIn: boolean }
  | { status: 'importing'; preview: LegacyImportPreview }
  | { status: 'imported'; importedAt: string }
  | { status: 'failed'; message: string; preview: LegacyImportPreview };

export interface LegacyImportContextValue {
  state: LegacyImportState;
  importLegacy(): Promise<void>;
}

export const LegacyImportContext = createContext<LegacyImportContextValue | null>(null);

export function useLegacyImport(): LegacyImportContextValue {
  const value = useContext(LegacyImportContext);
  if (!value) throw new Error('useLegacyImport 必須在 LegacyImportProvider 內使用。');
  return value;
}
