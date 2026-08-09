import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useDayPopDataState } from '../data/dataContext';
import type { Database, Json } from '../lib/database.types';
import { getAppStorage, type StorageLike } from '../storage/browserStorage';
import {
  buildLegacyImportPlan,
  fingerprintLegacyData,
  LEGACY_STORAGE_KEY,
  legacyPlanToPayload,
} from './legacyImport';
import { LegacyImportContext, type LegacyImportState } from './legacyImportContext';

interface LegacyImportProviderProps {
  accountId: string | null;
  client?: SupabaseClient<Database>;
  storage?: StorageLike;
}

/** Owns preview/status/RPC state while the main data provider owns the refreshed snapshot. */
export function LegacyImportProvider({
  accountId,
  client,
  storage,
  children,
}: PropsWithChildren<LegacyImportProviderProps>) {
  const dataContext = useDayPopDataState();
  const activeStorage = storage ?? getAppStorage();
  const raw = useMemo(() => activeStorage.getItem(LEGACY_STORAGE_KEY), [activeStorage]);
  const planResult = useMemo(() => {
    if (raw === null || dataContext.state.status !== 'ready') return null;
    try {
      return { plan: buildLegacyImportPlan(raw, dataContext.state.data), error: null };
    } catch (error) {
      return {
        plan: null,
        error: error instanceof Error ? error.message : '舊版資料驗證失敗。',
      };
    }
  }, [dataContext.state, raw]);
  const [remoteState, setRemoteState] = useState<
    | { status: 'idle' }
    | { status: 'checking' }
    | { status: 'available' }
    | { status: 'imported'; importedAt: string }
    | { status: 'failed'; message: string }
  >({ status: 'idle' });
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId || !client || raw === null || !planResult?.plan) {
      return;
    }
    let active = true;
    void client
      .from('profiles')
      .select('legacy_imported_at')
      .eq('id', accountId)
      .single()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setRemoteState((current) =>
            current.status === 'imported'
              ? current
              : { status: 'failed', message: `無法確認匯入狀態：${error.message}` },
          );
        } else if (data.legacy_imported_at) {
          setRemoteState({ status: 'imported', importedAt: data.legacy_imported_at });
        } else {
          setRemoteState((current) =>
            current.status === 'imported' ? current : { status: 'available' },
          );
        }
      });
    return () => {
      active = false;
    };
  }, [accountId, client, planResult, raw]);

  const importLegacy = useCallback(async () => {
    if (!accountId || !client || raw === null || !planResult?.plan || importing) return;
    setImportError(null);
    setImporting(true);
    try {
      const fingerprint = await fingerprintLegacyData(raw);
      const { data, error } = await client.rpc('import_legacy_daypop', {
        p_fingerprint: fingerprint,
        p_payload: legacyPlanToPayload(planResult.plan) as unknown as Json,
      });
      if (error) throw new Error(error.message);
      const importedAt = importResultTimestamp(data) ?? new Date().toISOString();
      setRemoteState({ status: 'imported', importedAt });
      dataContext.refresh();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '匯入失敗，遠端資料未變更。');
    } finally {
      setImporting(false);
    }
  }, [accountId, client, dataContext, importing, planResult, raw]);

  const state = useMemo<LegacyImportState>(() => {
    if (raw === null) return { status: 'missing' };
    if (dataContext.state.status !== 'ready') return { status: 'checking' };
    if (planResult?.error) return { status: 'invalid', message: planResult.error };
    if (!planResult?.plan) return { status: 'checking' };
    if (importing) return { status: 'importing', preview: planResult.plan.preview };
    if (importError) return { status: 'failed', message: importError, preview: planResult.plan.preview };
    if (!accountId) return { status: 'ready', preview: planResult.plan.preview, signedIn: false };
    if (remoteState.status === 'imported') return remoteState;
    if (remoteState.status === 'failed') {
      return { status: 'failed', message: remoteState.message, preview: planResult.plan.preview };
    }
    if (remoteState.status !== 'available') return { status: 'checking' };
    return { status: 'ready', preview: planResult.plan.preview, signedIn: true };
  }, [accountId, dataContext.state.status, importError, importing, planResult, raw, remoteState]);

  const value = useMemo(() => ({ state, importLegacy }), [importLegacy, state]);
  return <LegacyImportContext.Provider value={value}>{children}</LegacyImportContext.Provider>;
}

function importResultTimestamp(value: Json): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const importedAt = value.imported_at;
  return typeof importedAt === 'string' ? importedAt : null;
}
