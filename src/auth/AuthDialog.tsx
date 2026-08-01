import { useState, type FormEvent } from 'react';
import { useAuth } from './authContext';

type AuthMode = 'signin' | 'signup' | 'forgot';

interface AuthDialogProps {
  open: boolean;
  onClose(): void;
}

export function AuthDialog({ open, onClose }: AuthDialogProps) {
  const auth = useAuth();
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'error' | 'success'; text: string } | null>(
    null,
  );

  if (!open && !auth.isPasswordRecovery) return null;

  const recoveryMode = auth.isPasswordRecovery;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    setBusy(true);
    try {
      if (recoveryMode) {
        if (newPassword.length < 8) throw new Error('新密碼至少需要 8 個字元。');
        await auth.updatePassword(newPassword);
        setFeedback({ kind: 'success', text: '密碼已更新。' });
        onClose();
      } else if (mode === 'forgot') {
        await auth.requestPasswordReset(email.trim());
        setFeedback({ kind: 'success', text: '重設信已寄出，請查看收件匣與垃圾郵件匣。' });
      } else if (mode === 'signup') {
        if (password.length < 8) throw new Error('密碼至少需要 8 個字元。');
        const result = await auth.signUp(email.trim(), password);
        if (result.needsEmailConfirmation) {
          setFeedback({ kind: 'success', text: '註冊完成，請先到 Email 點擊驗證連結。' });
        } else {
          onClose();
        }
      } else {
        await auth.signIn(email.trim(), password);
        onClose();
      }
    } catch (error) {
      setFeedback({ kind: 'error', text: humanizeAuthError(error) });
    } finally {
      setBusy(false);
    }
  }

  async function continueWithGoogle() {
    setFeedback(null);
    setBusy(true);
    try {
      await auth.signInWithGoogle();
    } catch (error) {
      setFeedback({ kind: 'error', text: humanizeAuthError(error) });
      setBusy(false);
    }
  }

  function close() {
    if (busy) return;
    if (recoveryMode) auth.dismissPasswordRecovery();
    onClose();
  }

  function selectMode(nextMode: AuthMode) {
    setMode(nextMode);
    setFeedback(null);
  }

  return (
    <div className="dialog-backdrop auth-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="auth-close" type="button" aria-label="關閉登入視窗" onClick={close}>×</button>
        <div className="dialog-eyebrow">DAYPOP ACCOUNT</div>
        <h2 id="auth-title">
          {recoveryMode ? '設定新密碼' : mode === 'forgot' ? '忘記密碼' : '保存你的日蹦資料'}
        </h2>
        <p className="dialog-intro">
          {recoveryMode
            ? '輸入新的登入密碼。'
            : mode === 'forgot'
              ? '輸入帳號 Email，我們會寄送安全的重設連結。'
              : '登入不會刪除或自動上傳目前的遊客資料；資料匯入會在後續由你確認。'}
        </p>

        {!recoveryMode && mode !== 'forgot' && (
          <div className="auth-tabs" role="tablist" aria-label="帳號操作">
            <button className={mode === 'signin' ? 'active' : ''} type="button" role="tab" aria-selected={mode === 'signin'} onClick={() => selectMode('signin')}>登入</button>
            <button className={mode === 'signup' ? 'active' : ''} type="button" role="tab" aria-selected={mode === 'signup'} onClick={() => selectMode('signup')}>註冊</button>
          </div>
        )}

        {!recoveryMode && mode !== 'forgot' && auth.googleEnabled && (
          <button className="google-auth-button" type="button" onClick={() => void continueWithGoogle()} disabled={busy}>
            使用 Google 帳號繼續
          </button>
        )}
        {!recoveryMode && mode !== 'forgot' && !auth.googleEnabled && (
          <p className="auth-provider-note">Google 登入尚未在此 Supabase 專案啟用，目前請使用 Email。</p>
        )}

        <form className="auth-form" onSubmit={submit}>
          {!recoveryMode && (
            <label>
              Email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required placeholder="you@example.com" />
            </label>
          )}
          {!recoveryMode && mode !== 'forgot' && (
            <label>
              密碼
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={mode === 'signup' ? 8 : undefined} required />
            </label>
          )}
          {recoveryMode && (
            <label>
              新密碼
              <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={8} required autoFocus />
            </label>
          )}

          {feedback && <p className={`auth-feedback ${feedback.kind}`} role="status">{feedback.text}</p>}

          <button className="button primary auth-submit" type="submit" disabled={busy}>
            {busy ? '處理中…' : recoveryMode ? '更新密碼' : mode === 'forgot' ? '寄送重設信' : mode === 'signup' ? '建立帳號' : '登入'}
          </button>
        </form>

        {!recoveryMode && mode === 'signin' && (
          <button className="auth-text-button" type="button" onClick={() => selectMode('forgot')}>忘記密碼？</button>
        )}
        {!recoveryMode && mode === 'forgot' && (
          <button className="auth-text-button" type="button" onClick={() => selectMode('signin')}>返回登入</button>
        )}
        {!recoveryMode && (
          <button className="auth-guest-button" type="button" onClick={close}>繼續使用遊客模式</button>
        )}
      </section>
    </div>
  );
}

function humanizeAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : '發生未預期的登入錯誤。';
  if (/invalid login credentials/i.test(message)) {
    return '帳號或密碼錯誤；若你原本使用 Google，請改用 Google 登入。';
  }
  if (/already registered|already been registered/i.test(message)) {
    return '此 Email 已註冊，請直接登入。';
  }
  if (/email not confirmed/i.test(message)) return '請先到 Email 完成帳號驗證。';
  if (/rate limit/i.test(message)) return '操作太頻繁，請稍後再試。';
  return message;
}
