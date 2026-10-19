import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useModalFocus } from '../shell/useModalFocus';
import { ViewportLayer } from '../shell/ViewportLayer';
import type { FamilyServiceFactory } from './familyContext';
import { FamilyError, type FamilyCommand, type FamilyService, type FamilySnapshot, type InvitationLink } from './familyService';
import { invitationUrl } from './invitationIntent';
import { familyFailure, familyTime } from './familyFormatting';
import './family.css';

export function FamilyFrame({ title, busy = false, onClose, children,closeLabel='關閉家庭視窗' }: {
  title: string; busy?: boolean; onClose(): void; children: ReactNode;closeLabel?:string;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalFocus(layer, { onEscape: () => { if (!busy) onClose(); } });
  return <ViewportLayer>
    <div ref={layer} className="dialog-backdrop family-backdrop" role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="auth-dialog family-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy}>
        <button className="auth-close" type="button" aria-label={closeLabel} disabled={busy} onClick={onClose}>×</button>
        <h2 id={titleId}>{title}</h2>
        {children}
      </section>
    </div>
  </ViewportLayer>;
}
type Confirmation = { command: FamilyCommand; title: string; description: string; label: string };

export function FamilyDialog({ factory, userId, timezone, onClose,onChanged }: {
  factory: FamilyServiceFactory; userId: string; timezone: string; onClose(): void;onChanged?():void;
}) {
  const [snapshot, setSnapshot] = useState<FamilySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState('家庭');
  const [email, setEmail] = useState('');
  const [generated, setGenerated] = useState<InvitationLink | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const mounted = useRef(true);
  const pending = useRef(false);
  const serviceRef = useRef<FamilyService | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  function service() { return serviceRef.current ??= factory(userId); }

  useEffect(() => {
    mounted.current = true;
    let active = true;
    // The factory may throw for an unavailable configuration; that is a load
    // failure, never permission to show a new-family form over unknown state.
    Promise.resolve().then(() => (serviceRef.current ??= factory(userId)).load()).then(data => {
      if (active) { setSnapshot(data); setName(data.group?.name ?? '家庭'); }
    }).catch(cause => { if (active) setError(familyFailure(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; mounted.current = false; };
  }, [factory, userId]);
  useEffect(() => {
    if (confirmation) cancel.current?.focus();
    else if (!busy && document.activeElement === document.body) body.current?.querySelector<HTMLElement>('input,button')?.focus();
  }, [busy, confirmation]);

  async function refresh() {
    if (pending.current || loading) return;
    setLoading(true); setError(null); setGenerated(null);
    try {
      const data = await service().load();
      if (mounted.current) setSnapshot(data);
    } catch (cause) { if (mounted.current) setError(familyFailure(cause)); }
    finally { if (mounted.current) setLoading(false); }
  }
  async function run(command: FamilyCommand) {
    if (pending.current || loading) return;
    pending.current = true; setBusy(true); setError(null); setNotice(null);
    if (['invite', 'resend', 'revoke', 'leave', 'dissolve'].includes(command.kind)) setGenerated(null);
    try {
      const result = await service().command(command);
      onChanged?.();
      if (!mounted.current) return;
      setSnapshot(result.snapshot); setConfirmation(null);
      if (['create', 'rename', 'leave', 'dissolve'].includes(command.kind)) setName(result.snapshot.group?.name ?? '家庭');
      setGenerated(result.invitation);
      if (result.invitation) { setEmail(''); setNotice('邀請連結已產生，請自行傳給受邀者；App 不會寄信。'); }
      else setNotice(command.kind === 'dissolve' ? '家庭已解散，日曆內容已保留。' : command.kind === 'leave' ? '已退出家庭，日曆內容已保留。' : '家庭資訊已更新。');
    } catch (cause) {
      if (mounted.current) setError(`${familyFailure(cause)}${cause instanceof FamilyError ? ' 輸入內容已保留。' : ''}`);
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  function close() {
    if (pending.current) return;
    if (confirmation) { setConfirmation(null); setError(null); } else onClose();
  }
  const group = snapshot?.group;
  const isOwner = group?.ownerId === userId;
  const reserved = snapshot ? snapshot.members.length + snapshot.invitations.filter(item => item.status === 'pending').length : 0;
  const disabled = busy || loading;
  return <FamilyFrame title={confirmation?.title ?? '家庭群組'} busy={busy} onClose={close}>
    <div ref={body}>
      {error ? <p className="family-feedback" role="alert">{error}</p> : null}
      {notice && !confirmation ? <p className="family-feedback" role="status">{notice}</p> : null}
      {confirmation ? <>
        <p className="dialog-intro">{confirmation.description}</p>
        <div className="family-actions">
          <button ref={cancel} type="button" className="button secondary" disabled={busy} onClick={close}>取消</button>
          <button type="button" className="button primary" disabled={busy} onClick={() => void run(confirmation.command)}>{busy ? '處理中…' : confirmation.label}</button>
        </div>
      </> : <>
        <p className="dialog-intro">每個帳號可加入一個家庭，最多六位成員。加入家庭不會自動分享日曆。</p>
        {loading ? <p role="status">正在讀取家庭資訊…</p> : null}
        {snapshot ? <fieldset className="family-fields" disabled={disabled}>
          {!group ? <form className="auth-form" onSubmit={event => { event.preventDefault(); void run({ kind: 'create', name }); }}>
            <label htmlFor="family-name">群組名稱<input id="family-name" value={name} maxLength={160} required onChange={event => setName(event.target.value)} /></label>
            <button className="button primary" type="submit">{busy ? '建立中…' : '建立家庭'}</button>
          </form> : <>
            {isOwner ? <form className="auth-form" onSubmit={event => { event.preventDefault(); void run({ kind: 'rename', groupId: group.id, name }); }}>
              <label htmlFor="family-name">群組名稱<input id="family-name" value={name} maxLength={160} required onChange={event => setName(event.target.value)} /></label>
              <button type="submit" className="button secondary">儲存群名</button>
            </form> : <h3 className="family-group-name">{group.name}</h3>}
            <h3>家庭成員（{snapshot.members.length}／6）</h3>
            <ul className="family-list" aria-label="家庭成員">
              {snapshot.members.map(member => <li key={member.userId}>
                <span>{member.displayName}{member.userId === userId ? '（你）' : ''}・{member.role === 'owner' ? '擁有者' : '成員'}</span>
                {isOwner && member.role === 'member' ? <button className="button secondary" type="button" onClick={() => setConfirmation({
                  command: { kind: 'remove', groupId: group.id, memberId: member.userId }, title: '移除家庭成員', label: '確認移除',
                  description: `移除 ${member.displayName} 後，彼此不再透過這個家庭取得日曆權限。不會刪除任何人的日曆內容。`,
                })}>移除</button> : null}
              </li>)}
            </ul>
            {isOwner ? <>
              <h3>邀請家人</h3>
              <p className="family-help">已使用或保留 {reserved}／6 個名額。有效邀請會保留名額七天；重發會讓舊連結失效。</p>
              <form className="auth-form" onSubmit={event => { event.preventDefault(); void run({ kind: 'invite', groupId: group.id, email }); }}>
                <label htmlFor="family-email">受邀 Email<input id="family-email" type="email" autoComplete="email" autoCapitalize="none" value={email} maxLength={320} required onChange={event => setEmail(event.target.value)} /></label>
                <button className="button primary" type="submit" disabled={reserved >= 6}>產生邀請連結</button>
              </form>
              {generated ? <InviteLink key={generated.token} value={invitationUrl(generated.token)} expiresAt={familyTime(generated.expiresAt, timezone)} /> : null}
              <h3>最近邀請</h3>
              {snapshot.invitations.length ? <ul className="family-list" aria-label="最近邀請">
                {snapshot.invitations.map(invitation => <li key={invitation.id}>
                  <div><strong>{invitation.email}</strong><p>{invitation.status === 'expired' ? '已過期' : '等待接受'}・{familyTime(invitation.expiresAt, timezone)}</p></div>
                  <div className="family-actions">
                    <button className="button secondary" type="button" onClick={() => void run({ kind: 'resend', groupId: group.id, invitationId: invitation.id })}>重發連結</button>
                    <button className="button secondary" type="button" onClick={() => setConfirmation({
                      command: { kind: 'revoke', groupId: group.id, invitationId: invitation.id }, title: '撤銷邀請', label: '確認撤銷',
                      description: `撤銷給 ${invitation.email} 的邀請後，原連結不能再使用，保留的名額會釋出。`,
                    })}>撤銷邀請</button>
                  </div>
                </li>)}
              </ul> : <p className="family-help">目前沒有等待接受或過期的邀請。</p>}
            </> : null}
            <p className="family-help">日曆分享由每位擁有者在設定中明確開啟；加入家庭不會自動分享。</p>
            <button type="button" className="button secondary" onClick={() => setConfirmation({
              command: { kind: isOwner ? 'dissolve' : 'leave', groupId: group.id },
              title: isOwner ? '解散家庭' : '退出家庭', label: isOwner ? '確認解散' : '確認退出',
              description: isOwner ? '解散會使全部成員與邀請失去家庭資格，不會刪除任何人的日曆內容。重新加入後需重新開啟分享。' : '退出會撤銷你與這個家庭的日曆分享資格，不會刪除任何人的日曆內容。重新加入需要新邀請。',
            })}>{isOwner ? '解散家庭' : '退出家庭'}</button>
          </>}
        </fieldset> : null}
        <div className="family-actions family-footer"><button type="button" className="button secondary" disabled={disabled} onClick={() => void refresh()}>重新整理</button></div>
      </>}
    </div>
  </FamilyFrame>;
}

function InviteLink({ value, expiresAt }: { value: string; expiresAt: string }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); }
    catch { input.current?.focus(); input.current?.select(); }
  }
  return <div className="family-link">
    <label htmlFor="family-invitation-link">邀請連結（只限受邀 Email 接受）</label>
    <textarea ref={input} id="family-invitation-link" value={value} readOnly rows={3} onFocus={event => event.target.select()} />
    <p className="family-help">到期：{expiresAt}。關閉視窗後需重發才能取得新連結。</p>
    <button type="button" className="button secondary" onClick={() => void copy()}>{copied ? '已複製' : '複製邀請連結'}</button>
  </div>;
}
