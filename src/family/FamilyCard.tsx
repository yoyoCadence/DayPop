import { useState } from 'react';
import { useAuth } from '../auth/authContext';
import { FamilyDialog } from './FamilyDialog';
import { useFamilyServiceFactory } from './familyContext';

export function FamilyCard({ timezone, onOpenAuth }: { timezone: string; onOpenAuth(): void }) {
  const auth = useAuth();
  const factory = useFamilyServiceFactory();
  const [open, setOpen] = useState(false);
  return <>
    <div className="dp-section-label">家庭群組</div>
    <div className="dp-account-blocks">
      <section className="family-card">
        <div><strong>和家人一起安排生活</strong><p>{auth.sessionUnconfirmed
          ? '需要連線確認登入後，才能查看或管理家庭。'
          : '每個帳號可加入一個家庭；加入後不會自動分享日曆。遊客資料仍留在這台裝置。'}</p></div>
        <button className="button secondary" type="button" disabled={Boolean(auth.configurationError || auth.sessionUnconfirmed)}
          onClick={() => auth.user ? setOpen(true) : onOpenAuth()}>{auth.user ? '管理家庭' : '登入使用家庭'}</button>
      </section>
    </div>
    {open && auth.user && !auth.sessionUnconfirmed ? <FamilyDialog key={auth.user.id} factory={factory} userId={auth.user.id} timezone={timezone} onClose={() => setOpen(false)} /> : null}
  </>;
}
