import { createClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../lib/database.types';
import { FamilyError, SupabaseFamilyService, parseFamilySnapshot } from './familyService';

const OWNER = '00000000-0000-4000-8000-000000000471';
const MEMBER = '00000000-0000-4000-8000-000000000473';
const GROUP = '00000000-0000-4000-8000-000000000479';
const NOW = '2026-10-18T00:00:00+00:00';
const TOKEN = 'a'.repeat(64);
export function familyFixture() {
  return {
    group: { id: GROUP, ownerId: OWNER, name: '家庭', createdAt: NOW, updatedAt: NOW },
    members: [{ userId: OWNER, displayName: '家長', role: 'owner', joinedAt: NOW }],
    invitations: [],
  };
}

function remote(response: unknown, status = 200) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(response), {
    status, headers: { 'Content-Type': 'application/json' },
  }));
  const client = createClient<Database>('https://family-test.example.invalid', 'synthetic-publishable-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetcher },
  });
  return { service: new SupabaseFamilyService(client, OWNER), fetcher };
}
afterEach(() => vi.restoreAllMocks());

describe('family response boundary', () => {
  it('accepts an empty account state and strips unknown fields from valid projections', () => {
    expect(parseFamilySnapshot({ group: null, members: [], invitations: [] }, OWNER).group).toBeNull();
    const raw = familyFixture();
    const parsed = parseFamilySnapshot({ ...raw, token: TOKEN, auth: { email: 'hidden@example.test' } }, OWNER);
    expect(parsed).toEqual(raw);
    expect(JSON.stringify(parsed)).not.toContain(TOKEN);
  });
  it('rejects malformed, partial and inconsistent families rather than inventing empty state', () => {
    const raw = familyFixture();
    for (const value of [null, {}, { group: null, members: raw.members, invitations: [] },
      { ...raw, members: [] }, { ...raw, members: [...raw.members, ...raw.members] },
      { ...raw, group: { ...raw.group, ownerId: MEMBER } },
      { ...raw, members: [{ ...raw.members[0], role: 'admin' }] },
      { ...raw, group: { ...raw.group, updatedAt: 'bad-date' } }]) {
      expect(() => parseFamilySnapshot(value, OWNER)).toThrow(FamilyError);
    }
    expect(() => parseFamilySnapshot(raw, MEMBER)).toThrow(FamilyError);
  });
  it('rejects recipient email lists leaked to a member', () => {
    const raw = familyFixture();
    const member = { userId: MEMBER, displayName: '家人', role: 'member', joinedAt: NOW };
    expect(() => parseFamilySnapshot({ ...raw, members: [...raw.members, member], invitations: [{
      id: GROUP, email: 'someone@example.test', status: 'pending', expiresAt: NOW, createdAt: NOW,
    }] }, MEMBER)).toThrow(FamilyError);
  });
});

describe('SupabaseFamilyService', () => {
  it('loads through the actual supabase-js RPC serialization boundary', async () => {
    const { service, fetcher } = remote(familyFixture());
    expect(await service.load()).toEqual(familyFixture());
    expect(String(fetcher.mock.calls[0]![0])).toContain('/rpc/family_snapshot');
  });
  it('normalizes an invite and sends only allowlisted command fields', async () => {
    const { service, fetcher } = remote({ snapshot: { ...familyFixture(), invitations: [{ id: GROUP, email: 'family@example.test', status: 'pending', expiresAt: NOW, createdAt: NOW }] }, invitation: { id: GROUP, token: TOKEN, expiresAt: NOW } });
    const result = await service.command({ kind: 'invite', groupId: GROUP, email: ' FAMILY@example.test ' });
    expect(result.invitation?.token).toBe(TOKEN);
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toEqual({
      p_action: 'invite', p_payload: { groupId: GROUP, email: 'family@example.test' },
    });
  });
  it('rejects bad tokens and input before any request', async () => {
    const { service, fetcher } = remote({});
    await expect(service.command({ kind: 'accept', token: 'broken' })).rejects.toThrow(FamilyError);
    await expect(service.command({ kind: 'create', name: ' ' })).rejects.toThrow(FamilyError);
    await expect(service.command({ kind: 'invite', groupId: GROUP, email: 'bad-email' })).rejects.toThrow(FamilyError);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not report success for a missing invitation or malformed snapshot', async () => {
    const { service } = remote({ snapshot: familyFixture(), invitation: null });
    await expect(service.command({ kind: 'invite', groupId: GROUP, email: 'family@example.test' })).rejects.toThrow(FamilyError);
    const broken = remote({ snapshot: {}, invitation: null });
    await expect(broken.service.command({ kind: 'create', name: '家庭' })).rejects.toThrow(FamilyError);
  });
  it('maps a verified email mismatch without rendering raw server details', async () => {
    const { service } = remote({ code: 'P0001', message: 'family_email_mismatch', details: 'secret@example.test' }, 400);
    await expect(service.preview(TOKEN)).rejects.toThrow('請使用收到邀請的 Email 帳號登入');
  });
  it('does not leak an arbitrary database error to the screen', async () => {
    const { service } = remote({ code: '42501', message: 'private-event-title@example.test' }, 403);
    await expect(service.load()).rejects.toThrow('暫時無法完成家庭操作');
  });
  it('reports missing migrations as unavailable, rather than an empty family', async () => {
    const { service } = remote({ code: 'PGRST202', message: 'missing function' }, 404);
    await expect(service.load()).rejects.toThrow('家庭功能尚未啟用');
  });
  it('does not claim an acceptance or departure that the response did not confirm', async () => {
    await expect(remote({ snapshot: { group: null, members: [], invitations: [] }, invitation: null }).service.command({ kind: 'accept', token: TOKEN })).rejects.toThrow(FamilyError);
    await expect(remote({ snapshot: familyFixture(), invitation: null }).service.command({ kind: 'leave', groupId: GROUP })).rejects.toThrow(FamilyError);
  });
});
