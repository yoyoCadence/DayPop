import type { PetKind } from './petAssets';

/**
 * DP-248: the last image each character actually decoded in this document.
 * Every pose change mounts a new `DecodedArtwork` (and idle swaps component
 * entirely), and a new image needs at least one frame to decode even from the
 * cache. Showing this one meanwhile keeps the character on screen instead of
 * flashing the CSS fallback. Per kind, so a newly chosen partner never shows
 * the previous one; only a successful decode is remembered.
 */
export const lastDecoded = new Map<PetKind, string>();
/** Tests only: every test starts as a fresh document. */
export function forgetDecodedPetArtwork() { lastDecoded.clear(); }
