import { useReminders } from './reminderContext';

export function ReminderWarning({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const reminders = useReminders();
  if (!reminders?.view.pendingCount || reminders.view.phase === 'busy' || reminders.view.phase === 'loading') return null;
  return <div className="family-feedback" role="status">
    部分裝置通知操作尚未確認。請保留連線，必要時重新登入原帳號確認停用。{' '}
    {onOpenSettings ? <button className="button secondary" type="button" onClick={onOpenSettings}>通知設定</button> : null}
  </div>;
}
