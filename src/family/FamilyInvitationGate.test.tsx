import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FamilyInvitationGate } from './FamilyInvitationGate';
import { FamilyServiceContext, type FamilyServiceFactory } from './familyContext';
import { FamilyError, type FamilyService, type InvitationPreview } from './familyService';
import { dismissInvitationIntent } from './invitationStore';

const USER = '00000000-0000-4000-8000-000000000471';
const OTHER = '00000000-0000-4000-8000-000000000472';
const GROUP = '00000000-0000-4000-8000-000000000479';
const TOKEN = 'e'.repeat(64);
const NOW = '2026-10-18T00:00:00Z';
let auth: { user: { id: string; email: string } | null; sessionUnconfirmed: boolean; initializing: boolean; configurationError: null };
vi.mock('../auth/authContext', () => ({ useAuth: () => auth }));
let root: Root; let container: HTMLDivElement;
beforeEach(() => {
  dismissInvitationIntent();
  window.history.replaceState(null, '', `/#family-invite=${TOKEN}`);
  auth = { user: null, sessionUnconfirmed: false, initializing: false, configurationError: null };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); dismissInvitationIntent(); window.history.replaceState(null, '', '/'); });
function service(): FamilyService {
  return { load: vi.fn(), preview: vi.fn(async () => ({ id: GROUP, groupId: GROUP, groupName: '家人的家', inviterName: '家人', expiresAt: NOW })),
    command: vi.fn(async () => ({ snapshot: { group: { id: GROUP, name: '家人的家', ownerId: OTHER, createdAt: NOW, updatedAt: NOW }, members: [
      { userId: OTHER, role: 'owner' as const, displayName: '家人', joinedAt: NOW }, { userId: USER, role: 'member' as const, displayName: '你', joinedAt: NOW },
    ], invitations: [] }, invitation: null })) };
}
async function render(factory: FamilyServiceFactory, onOpenAuth = vi.fn(), authOpen = false) {
  await act(async () => root.render(<FamilyServiceContext.Provider value={factory}><FamilyInvitationGate timezone="Asia/Taipei" authOpen={authOpen} onOpenAuth={onOpenAuth} /></FamilyServiceContext.Provider>));
  return onOpenAuth;
}
function button(text: string) { return [...container.querySelectorAll('button')].find(item => item.textContent === text)!; }

describe('family invitation Auth boundary', () => {
  it('waits behind an already open Auth dialog without reading or dismissing the invitation', async () => {
    const factory = vi.fn(() => service());
    const open = vi.fn();
    await render(factory, open, true);
    const pending = sessionStorage.getItem('daypop.pending-family-invitation');
    expect(pending).not.toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(factory).not.toHaveBeenCalled();
    await render(factory, open, false);
    expect(button('登入以查看邀請')).toBeDefined();
    expect(sessionStorage.getItem('daypop.pending-family-invitation')).toBe(pending);
    expect(factory).not.toHaveBeenCalled();
  });
  it('returns to the same pending invitation after cancelling login, without constructing a service', async () => {
    const factory = vi.fn(() => service());
    const open = await render(factory);
    const pending = sessionStorage.getItem('daypop.pending-family-invitation');
    expect(pending).not.toBeNull();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await act(async () => button('登入以查看邀請').click());
      await render(factory, open, true);
      expect(container.querySelector('[role="dialog"]')).toBeNull();
      await render(factory, open, false);
      expect(button('登入以查看邀請')).toBeDefined();
      expect(sessionStorage.getItem('daypop.pending-family-invitation')).toBe(pending);
      expect(factory).not.toHaveBeenCalled();
    }
    expect(open).toHaveBeenCalledTimes(2);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="關閉家庭視窗"]')!.click());
    expect(sessionStorage.getItem('daypop.pending-family-invitation')).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
  it('renders no modal for a guest with no invitation or completed action', async () => {
    window.history.replaceState(null, '', '/');
    const factory = vi.fn(() => service());
    await render(factory);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });
  it('does not construct a client or request anything for a guest or unconfirmed session', async () => {
    const factory = vi.fn(() => service());
    const open = await render(factory);
    expect(factory).not.toHaveBeenCalled();
    await act(async () => button('登入以查看邀請').click());
    expect(open).toHaveBeenCalledOnce();
    expect(factory).not.toHaveBeenCalled();
    auth = { ...auth, user: { id: USER, email: 'family@example.test' }, sessionUnconfirmed: true };
    await render(factory);
    expect(container.textContent).toContain('需要連線確認登入');
    expect(factory).not.toHaveBeenCalled();
  });
  it('waits for an explicit acceptance after login and then clears the intent', async () => {
    const remote = service();
    const factory = vi.fn(() => remote);
    await render(factory);
    auth = { ...auth, user: { id: USER, email: 'family@example.test' } };
    await render(factory);
    expect(remote.preview).toHaveBeenCalledWith(TOKEN);
    expect(remote.command).not.toHaveBeenCalled();
    await act(async () => button('接受邀請').click());
    expect(remote.command).toHaveBeenCalledWith({ kind: 'accept', token: TOKEN });
    expect(container.textContent).toContain('已加入「家人的家」');
    expect(sessionStorage.getItem('daypop.pending-family-invitation')).toBeNull();
  });
  it('ignores an old account preview after identity changes', async () => {
    let finish!: (value: InvitationPreview) => void;
    const old = service(); old.preview = vi.fn(() => new Promise<InvitationPreview>(resolve => { finish = resolve; }));
    const next = service(); next.preview = vi.fn().mockRejectedValue(new FamilyError('請使用收到邀請的 Email 帳號登入，再重新開啟連結。'));
    const factory = vi.fn(userId => userId === USER ? old : next);
    auth = { ...auth, user: { id: USER, email: 'family@example.test' } };
    await render(factory);
    auth = { ...auth, user: { id: OTHER, email: 'other@example.test' } };
    await render(factory);
    await act(async () => finish({ id: GROUP, groupId: GROUP, groupName: 'OLD PRIVATE NAME', inviterName: 'PRIVATE', expiresAt: NOW }));
    expect(container.textContent).not.toContain('OLD PRIVATE NAME');
    expect(container.textContent).toContain('請使用收到邀請的 Email');
    expect(next.command).not.toHaveBeenCalled();
  });
});
