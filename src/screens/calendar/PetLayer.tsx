export interface PetLayerProps {
  /** Open todo count, shown as the badge the原檔 puts on the pet. */
  badge: number;
  petName: string;
}

/**
 * App 內浮動寵物 — position only (DP-051).
 *
 * The原檔 floats the pet in a zero-height layer pinned above the tab bar and
 * moves it with a seven-state machine (`idle`/`walk`/`sit`/`sleep`/`jump`/
 * `look`/`grab`), drag handling and a speech bubble. DP-040 owns all of that,
 * together with the real assets from `寵物素材規範 Pet Asset Spec.md`.
 *
 * What DP-051 fixes is the geometry the rest of the calendar has to live with:
 * the layer inset, the 60 × 60 footprint, the resting position and the badge.
 * The CSS character keeps the原檔's proportions and outline so the FAB and the
 * month grid are laid out against the real thing rather than a placeholder.
 */
export function PetLayer({ badge, petName }: PetLayerProps) {
  return (
    <div className="cal-pet-layer" aria-hidden="true">
      <div className="cal-pet" title={petName}>
        <div className="cal-pet-body">
          <div className="cal-pet-shadow" />
          <div className="cal-pet-head">
            <div className="cal-pet-ear left" />
            <div className="cal-pet-ear right" />
            <div className="cal-pet-eye left" />
            <div className="cal-pet-eye right" />
            <div className="cal-pet-cheek left" />
            <div className="cal-pet-cheek right" />
            <div className="cal-pet-mouth" />
          </div>
          <div className="cal-pet-foot left" />
          <div className="cal-pet-foot right" />
        </div>
        {badge > 0 && <div className="cal-pet-badge">{badge}</div>}
      </div>
    </div>
  );
}
