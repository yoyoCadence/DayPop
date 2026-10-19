import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/authContext';
import { FamilyFrame } from './FamilyDialog';
import { familyFailure, familyTime } from './familyFormatting';
import { useFamilyServiceFactory, type FamilyServiceFactory } from './familyContext';
import type { FamilyService, InvitationPreview } from './familyService';
import { dismissInvitationIntent, useInvitationIntent } from './invitationStore';

export function FamilyInvitationGate({ timezone, onOpenAuth }: { timezone: string; onOpenAuth(): void }) {
  const intent = useInvitationIntent();
  const auth = useAuth();
  const factory = useFamilyServiceFactory();
  const [waitingToken, setWaitingToken] = useState<string | null>(null);
  const [completed, setCompleted] = useState<{ userId: string; message: string } | null>(null);
  function close() { setCompleted(null); dismissInvitationIntent(); }
  if (!intent) return completed && completed.userId === auth.user?.id ? <FamilyFrame title="家庭邀請" onClose={() => setCompleted(null)}>
    <p className="dialog-intro" role="status">{completed?.message}</p>
    <button className="button primary" type="button" onClick={() => setCompleted(null)}>完成</button>
  </FamilyFrame> : null;
  if (intent.kind === 'invalid') return <FamilyFrame title="家庭邀請" onClose={close}><p className="dialog-intro">邀請連結無效，請向家庭擁有者索取新連結。</p></FamilyFrame>;
  if (!auth.user) {
    if (waitingToken === intent.token) return null;
    return <FamilyFrame title="家庭邀請" onClose={close}>
      <p className="dialog-intro">請先使用收到邀請的 Email 帳號登入；登入後仍需確認加入，不會自動分享或上傳遊客資料。</p>
      {!intent.persisted ? <p className="family-help">這個瀏覽器無法保留邀請；登入後請重新開啟原連結。</p> : null}
      <button className="button primary" type="button" disabled={Boolean(auth.configurationError)} onClick={() => { setWaitingToken(intent.token); onOpenAuth(); }}>登入以查看邀請</button>
    </FamilyFrame>;
  }
  if (auth.sessionUnconfirmed || auth.initializing) return <FamilyFrame title="家庭邀請" onClose={close}>
    <p className="dialog-intro">需要連線確認登入後，才能查看或接受邀請。請稍後重新開啟連結。</p>
  </FamilyFrame>;
  return <InvitationConfirmation key={`${auth.user.id}:${intent.token}`} factory={factory} userId={auth.user.id} token={intent.token}
    email={auth.user.email ?? '目前帳號'} timezone={timezone} onClose={close} onComplete={message => {
      setCompleted({ userId: auth.user!.id, message }); dismissInvitationIntent();
    }} />;
}

function InvitationConfirmation({ factory, userId, token, email, timezone, onClose, onComplete }: {
  factory: FamilyServiceFactory; userId: string; token: string; email: string; timezone: string;
  onClose(): void; onComplete(message: string): void;
}) {
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const serviceRef = useRef<FamilyService | null>(null);
  const mounted = useRef(true);
  const pending = useRef(false);
  function service() { return serviceRef.current ??= factory(userId); }
  useEffect(() => {
    mounted.current = true;
    let active = true;
    Promise.resolve().then(() => (serviceRef.current ??= factory(userId)).preview(token)).then(data => { if (active) setPreview(data); })
      .catch(cause => { if (active) setError(familyFailure(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; mounted.current = false; };
  }, [factory, userId, token]);
  async function reload() {
    if (pending.current || loading) return;
    setLoading(true); setPreview(null); setError(null);
    try { const data = await service().preview(token); if (mounted.current) setPreview(data); }
    catch (cause) { if (mounted.current) setError(familyFailure(cause)); }
    finally { if (mounted.current) setLoading(false); }
  }
  async function decide(kind: 'accept' | 'decline') {
    if (pending.current || !preview || loading) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      const result = await service().command({ kind, token });
      if (mounted.current) onComplete(kind === 'accept' ? `已加入「${result.snapshot.group!.name}」。日曆內容仍由每位擁有者決定是否分享。` : '已拒絕這份邀請。');
    } catch (cause) { if (mounted.current) setError(familyFailure(cause)); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  return <FamilyFrame title="確認家庭邀請" busy={busy} onClose={() => { if (!pending.current) onClose(); }}>
    {loading ? <p role="status">正在確認邀請…</p> : null}
    {error ? <p className="family-feedback" role="alert">{error}</p> : null}
    {preview ? <>
      <p className="dialog-intro">{preview.inviterName} 邀請你加入「{preview.groupName}」。</p>
      <p className="family-help">受邀帳號：{email}<br />到期：{familyTime(preview.expiresAt, timezone)}</p>
      <p className="dialog-intro">加入不會自動分享你的日曆，也不會上傳遊客資料。每個帳號只能加入一個家庭。</p>
      <div className="family-actions">
        <button className="button secondary" type="button" disabled={busy} onClick={() => void decide('decline')}>拒絕邀請</button>
        <button className="button primary" type="button" disabled={busy} onClick={() => void decide('accept')}>{busy ? '處理中…' : '接受邀請'}</button>
      </div>
    </> : null}
    <div className="family-actions family-footer"><button type="button" className="button secondary" disabled={busy || loading} onClick={() => void reload()}>重新確認</button></div>
  </FamilyFrame>;
}
