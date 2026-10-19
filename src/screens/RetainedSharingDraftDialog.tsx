import { FamilyFrame } from '../family/FamilyDialog';
import type { RetainedSharingDraft } from '../data/retainedSharingDraft';

export function RetainedSharingDraftDialog({drafts,onDiscard,onClose}:{drafts:readonly RetainedSharingDraft[];onDiscard(key:string):void;onClose():void}) {
  return <FamilyFrame title="未保存的輸入" closeLabel="關閉未保存輸入" onClose={onClose}>
    <p className="dialog-intro">原本的編輯位置已關閉，輸入仍保留在本次使用的記憶體。可選取複製，再存到自己的日曆；登出或關閉 App 會清除。</p>
    {drafts.length===0?<p className="family-help">目前沒有未保存的輸入。</p>:drafts.map(draft=><div className="family-link" key={draft.key}>
      <label>{draft.label}<textarea aria-label={draft.label} readOnly rows={3} value={draft.value} onFocus={event=>event.currentTarget.select()}/></label>
      <button className="button secondary" type="button" onClick={()=>onDiscard(draft.key)}>捨棄這份輸入</button>
    </div>)}
  </FamilyFrame>;
}
