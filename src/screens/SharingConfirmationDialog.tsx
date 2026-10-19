import { useId,useRef } from 'react';
import type { SharingConfirmation } from '../data/dataContext';
import { ViewportLayer } from '../shell/ViewportLayer';
import { useModalFocus } from '../shell/useModalFocus';
import '../family/family.css';

/** All shared deletion/move entry points use the same awaited confirmation. */
export function SharingConfirmationDialog({request}:{request:SharingConfirmation}) {
  const layer=useRef<HTMLDivElement>(null);const titleId=useId();const descriptionId=useId();
  useModalFocus(layer,{onEscape:request.onCancel});
  return <ViewportLayer><div ref={layer} className="dialog-backdrop family-backdrop sharing-confirm-backdrop" role="presentation"
    onMouseDown={event=>{if(event.target===event.currentTarget)request.onCancel();}}>
    <section className="auth-dialog family-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
      <h2 id={titleId}>{request.title}</h2><p className="dialog-intro" id={descriptionId}>{request.message}</p>
      <div className="family-actions"><button className="button secondary" type="button" autoFocus onClick={request.onCancel}>取消</button>
        <button className="button primary" type="button" onClick={request.onConfirm}>{request.confirmLabel}</button></div>
    </section>
  </div></ViewportLayer>;
}
