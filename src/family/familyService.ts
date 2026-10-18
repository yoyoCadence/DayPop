import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../lib/database.types';

export interface FamilyGroup { id: string; ownerId: string; name: string; createdAt: string; updatedAt: string }
export interface FamilyMember { userId: string; displayName: string; role: 'owner' | 'member'; joinedAt: string }
export interface FamilyInvitation { id: string; email: string; status: 'pending' | 'expired'; expiresAt: string; createdAt: string }
export interface FamilySnapshot { group: FamilyGroup | null; members: FamilyMember[]; invitations: FamilyInvitation[] }
export interface InvitationLink { id: string; token: string; expiresAt: string }
export interface InvitationPreview { id: string; groupId: string; groupName: string; inviterName: string; expiresAt: string }
export interface FamilyResult { snapshot: FamilySnapshot; invitation: InvitationLink | null }
export type FamilyCommand =
  | { kind: 'create'; name: string }
  | { kind: 'rename'; groupId: string; name: string }
  | { kind: 'invite'; groupId: string; email: string }
  | { kind: 'resend' | 'revoke'; groupId: string; invitationId: string }
  | { kind: 'accept' | 'decline'; token: string }
  | { kind: 'remove'; groupId: string; memberId: string }
  | { kind: 'leave' | 'dissolve'; groupId: string };

/** Separate, session-only service; family state never enters DayPopUserData/cache. */
export interface FamilyService {
  load(): Promise<FamilySnapshot>;
  preview(token: string): Promise<InvitationPreview>;
  command(command: FamilyCommand): Promise<FamilyResult>;
}
export class FamilyError extends Error {
  constructor(message: string) { super(message); this.name = 'FamilyError'; }
}
const INVALID_RESPONSE = '家庭資訊不完整，請重新整理後再試。';
const GENERIC_ERROR = '暫時無法完成家庭操作，請檢查連線後再試。';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const INVITATION_TOKEN = /^[0-9a-f]{64}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new FamilyError(INVALID_RESPONSE);
  return value as Record<string, unknown>;
}
function text(value: unknown, limit = 80): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || [...value].length > limit) throw new FamilyError(INVALID_RESPONSE);
  return value;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new FamilyError(INVALID_RESPONSE);
  return value;
}
function instant(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new FamilyError(INVALID_RESPONSE);
  return value;
}
function array(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw new FamilyError(INVALID_RESPONSE);
  return value;
}
function unique(values: string[]) {
  if (new Set(values).size !== values.length) throw new FamilyError(INVALID_RESPONSE);
}

export function parseFamilySnapshot(value: unknown, userId: string): FamilySnapshot {
  const raw = record(value);
  const members = array(raw.members, 6).map((item): FamilyMember => {
    const member = record(item);
    if (member.role !== 'owner' && member.role !== 'member') throw new FamilyError(INVALID_RESPONSE);
    return { userId: id(member.userId), displayName: text(member.displayName), role: member.role, joinedAt: instant(member.joinedAt) };
  });
  const invitations = array(raw.invitations, 20).map((item): FamilyInvitation => {
    const invitation = record(item);
    const email = text(invitation.email, 320);
    if (!EMAIL.test(email) || email !== email.toLowerCase() || (invitation.status !== 'pending' && invitation.status !== 'expired')) throw new FamilyError(INVALID_RESPONSE);
    return { id: id(invitation.id), email, status: invitation.status, expiresAt: instant(invitation.expiresAt), createdAt: instant(invitation.createdAt) };
  });
  unique(members.map(member => member.userId));
  unique(invitations.map(invitation => invitation.id));
  if (raw.group === null) {
    if (members.length || invitations.length) throw new FamilyError(INVALID_RESPONSE);
    return { group: null, members, invitations };
  }
  const item = record(raw.group);
  const group: FamilyGroup = { id: id(item.id), ownerId: id(item.ownerId), name: text(item.name), createdAt: instant(item.createdAt), updatedAt: instant(item.updatedAt) };
  if (!members.some(member => member.userId === userId) || members.filter(member => member.role === 'owner').length !== 1
    || !members.some(member => member.role === 'owner' && member.userId === group.ownerId)
    || (group.ownerId !== userId && invitations.length)
    || members.length + invitations.filter(invitation => invitation.status === 'pending').length > 6) throw new FamilyError(INVALID_RESPONSE);
  return { group, members, invitations };
}

function previewFromResponse(value: unknown): InvitationPreview {
  const raw = record(value);
  return { id: id(raw.id), groupId: id(raw.groupId), groupName: text(raw.groupName), inviterName: text(raw.inviterName), expiresAt: instant(raw.expiresAt) };
}
function token(value: string) {
  if (!INVITATION_TOKEN.test(value)) throw new FamilyError('邀請連結無效，請向家庭擁有者索取新連結。');
  return value;
}
function name(value: string) {
  const normalized = value.trim();
  if (!normalized || [...normalized].length > 80) throw new FamilyError('群組名稱請填 1 到 80 個字。');
  return normalized;
}
function payload(command: FamilyCommand): Json {
  if (command.kind === 'create') return { name: name(command.name) };
  if (command.kind === 'accept' || command.kind === 'decline') return { token: token(command.token) };
  if (!('groupId' in command)) throw new FamilyError('這項家庭操作無法完成，請重新整理後再試。');
  const groupId = id(command.groupId);
  switch (command.kind) {
    case 'rename': return { groupId, name: name(command.name) };
    case 'invite': {
      const email = command.email.trim().toLowerCase();
      if (!EMAIL.test(email) || email.length > 320) throw new FamilyError('請填寫有效的 Email。');
      return { groupId, email };
    }
    case 'resend': case 'revoke': return { groupId, invitationId: id(command.invitationId) };
    case 'remove': return { groupId, memberId: id(command.memberId) };
    case 'leave': case 'dissolve': return { groupId };
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  family_sign_in_required: '請先登入，再使用家庭功能。',
  family_email_unverified: '請先完成帳號的 Email 驗證，再開啟邀請連結。',
  family_email_mismatch: '請使用收到邀請的 Email 帳號登入，再重新開啟連結。',
  family_invitation_unavailable: '邀請已失效、過期或使用過，請向家庭擁有者索取新連結。',
  family_already_member: '這個帳號已加入家庭，請先重新整理；若要加入另一個家庭，請先退出。',
  family_full: '家庭的六個名額已使用或保留，請先撤銷不需要的邀請。',
  family_owner_required: '只有家庭擁有者可以執行這項操作，請重新整理家庭資訊。',
  family_owner_must_dissolve: '家庭擁有者需先解散家庭，不能直接退出或移除自己。',
  family_group_changed: '家庭資格已變更，請重新整理後再試。',
  family_invalid_name: '群組名稱請填 1 到 80 個字。',
  family_invalid_email: '請填寫有效的 Email。',
  family_invalid_command: '這項家庭操作無法完成，請重新整理後再試。',
};
async function request(call: PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>): Promise<unknown> {
  try {
    const response = await call;
    if (response.error) {
      if (['PGRST202', '42883', '42P01'].includes(response.error.code ?? '')) throw new FamilyError('家庭功能尚未啟用，請稍後再試。');
      throw new FamilyError(ERROR_MESSAGES[response.error.message ?? ''] ?? GENERIC_ERROR);
    }
    return response.data;
  } catch (cause) {
    if (cause instanceof FamilyError) throw cause;
    throw new FamilyError(GENERIC_ERROR);
  }
}

export class SupabaseFamilyService implements FamilyService {
  constructor(private readonly client: SupabaseClient<Database>, private readonly userId: string) {}
  async load() {
    return parseFamilySnapshot(await request(this.client.rpc('family_snapshot')), this.userId);
  }
  async preview(rawToken: string) {
    return previewFromResponse(await request(this.client.rpc('family_invitation_preview', { p_token: token(rawToken) })));
  }
  async command(command: FamilyCommand): Promise<FamilyResult> {
    const raw = record(await request(this.client.rpc('family_command', { p_action: command.kind, p_payload: payload(command) })));
    const snapshot = parseFamilySnapshot(raw.snapshot, this.userId);
    if (command.kind === 'create' && (!snapshot.group || snapshot.group.ownerId !== this.userId)) throw new FamilyError(INVALID_RESPONSE);
    if (command.kind === 'accept' && (!snapshot.group || !snapshot.members.some(member => member.userId === this.userId && member.role === 'member'))) throw new FamilyError(INVALID_RESPONSE);
    if ((command.kind === 'leave' || command.kind === 'dissolve') && snapshot.group !== null) throw new FamilyError(INVALID_RESPONSE);
    if ('groupId' in command && command.kind !== 'leave' && command.kind !== 'dissolve'
      && (!snapshot.group || snapshot.group.id !== command.groupId || snapshot.group.ownerId !== this.userId)) throw new FamilyError(INVALID_RESPONSE);
    let invitation: InvitationLink | null = null;
    if (command.kind === 'invite' || command.kind === 'resend') {
      const item = record(raw.invitation);
      invitation = { id: id(item.id), token: token(text(item.token, 64)), expiresAt: instant(item.expiresAt) };
      const row = snapshot.invitations.find(entry => entry.id === invitation!.id && entry.status === 'pending');
      if (!row || (command.kind === 'invite' && row.email !== command.email.trim().toLowerCase())
        || (command.kind === 'resend' && invitation.id !== command.invitationId)) throw new FamilyError(INVALID_RESPONSE);
    } else if (raw.invitation !== null) throw new FamilyError(INVALID_RESPONSE);
    return { snapshot, invitation };
  }
}
