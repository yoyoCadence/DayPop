import { PET_ASSETS } from './calendar/petAssets';
import type { PetKind } from '../domain/types';
import { useSyncExternalStore } from 'react';

function subscribeOnline(change: () => void) {
  window.addEventListener('online', change); window.addEventListener('offline', change);
  return () => { window.removeEventListener('online', change); window.removeEventListener('offline', change); };
}

const choices: { kind: PetKind; name: string }[] = [
  { kind: 'marshmallow_cat', name: '棉花貓' },
  { kind: 'honey_bear', name: '蜂蜜熊' },
  { kind: 'peach_bunny', name: '蜜桃兔' },
  { kind: 'moon_cat', name: '月光貓' },
  { kind: 'orbit_ufo', name: '軌道噗' },
];

export function PetChoices({ value, saving, onChange }: { value: PetKind; saving: boolean; onChange(kind: PetKind): void }) {
  // Selection remains available offline even when preview PNGs have never been
  // visited/cached. Do not issue five guaranteed-to-fail image requests then.
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine);
  return <fieldset className="set-pet-choices" disabled={saving}>
    <legend className="set-pref-field-label">選擇夥伴</legend>
    <div className="set-pet-grid">
      {choices.map(({ kind, name }) => <label className="set-pet-choice" key={kind}>
        <input type="radio" name="pet-kind" value={kind} checked={value === kind} onChange={() => onChange(kind)} />
        {online ? <img src={PET_ASSETS[kind].idle!.still} width="72" height="72" alt="" loading="lazy" />
          : <span className="set-pet-preview-placeholder" aria-hidden="true">🐾</span>}
        <span>{name}</span>
      </label>)}
    </div>
  </fieldset>;
}
