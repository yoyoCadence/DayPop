import { createDomainId } from '../domain/types';
import { FamilyError, type FamilyCommand, type FamilyResult, type FamilyService, type FamilySnapshot, type InvitationLink } from '../family/familyService';

// UI test double only. It proves no RLS properties; real authorization is tested
// with pgTAP against the migration, not by copying policy predicates here.
export const E2E_FAMILY_TOKEN = 'c'.repeat(64);
const OTHER_OWNER = '00000000-0000-4000-8000-00000000047a';
const INCOMING_GROUP = '00000000-0000-4000-8000-00000000047b';
export class FakeFamilyService implements FamilyService {
  state: FamilySnapshot = { group: null, members: [], invitations: [] };
  readonly calls: FamilyCommand[] = [];
  failNext = false;
  loseNextResponse = false;
  constructor(readonly userId: string) {}
  async load() { return structuredClone(this.state); }
  async preview(token: string) {
    if (token !== E2E_FAMILY_TOKEN) throw new FamilyError('邀請已失效、過期或使用過，請向家庭擁有者索取新連結。');
    return { id: INCOMING_GROUP, groupId: INCOMING_GROUP, groupName: '家人的家庭', inviterName: '家人甲', expiresAt: new Date(Date.now() + 86400000).toISOString() };
  }
  async command(command: FamilyCommand): Promise<FamilyResult> {
    this.calls.push(structuredClone(command));
    if (this.failNext) { this.failNext = false; throw new FamilyError('暫時無法完成家庭操作，請檢查連線後再試。'); }
    const now = new Date().toISOString();
    let invitation: InvitationLink | null = null;
    switch (command.kind) {
      case 'create':
        if (!this.state.group) this.state = {
          group: { id: createDomainId(), ownerId: this.userId, name: command.name.trim(), createdAt: now, updatedAt: now },
          members: [{ userId: this.userId, displayName: '測試家人', role: 'owner', joinedAt: now }], invitations: [],
        };
        break;
      case 'rename': this.state.group!.name = command.name.trim(); break;
      case 'invite': case 'resend': {
        const existing = command.kind === 'resend' ? this.state.invitations.find(row => row.id === command.invitationId)
          : this.state.invitations.find(row => row.email === ('email' in command ? command.email.trim().toLowerCase() : ''));
        const id = existing?.id ?? createDomainId();
        const token = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
        const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
        if (existing) { existing.status = 'pending'; existing.expiresAt = expiresAt; }
        else this.state.invitations.push({ id, email: command.kind === 'invite' ? command.email.trim().toLowerCase() : '', status: 'pending', expiresAt, createdAt: now });
        invitation = { id, token, expiresAt };
        break;
      }
      case 'revoke': this.state.invitations = this.state.invitations.filter(row => row.id !== command.invitationId); break;
      case 'remove': this.state.members = this.state.members.filter(row => row.userId !== command.memberId); break;
      case 'leave': case 'dissolve': this.state = { group: null, members: [], invitations: [] }; break;
      case 'accept':
        await this.preview(command.token);
        this.state = { group: { id: INCOMING_GROUP, name: '家人的家庭', ownerId: OTHER_OWNER, createdAt: now, updatedAt: now }, members: [
          { userId: OTHER_OWNER, displayName: '家人甲', role: 'owner', joinedAt: now },
          { userId: this.userId, displayName: '測試家人', role: 'member', joinedAt: now },
        ], invitations: [] };
        break;
      case 'decline': await this.preview(command.token); break;
    }
    if (this.loseNextResponse) { this.loseNextResponse = false; throw new FamilyError('暫時無法完成家庭操作，請檢查連線後再試。'); }
    return { snapshot: structuredClone(this.state), invitation };
  }
}
