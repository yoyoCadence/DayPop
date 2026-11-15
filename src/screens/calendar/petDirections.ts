import type { PetAsset, PetPose } from './petAssets';
import idle0_png from '../../assets/pet-directions/manga-cat-idle.png?no-inline';
import idle1_png from '../../assets/pet-directions/pixel-cat-idle.png?no-inline';
import idle2_png from '../../assets/pet-directions/mecha-spirit-idle.png?no-inline';
import idle3_png from '../../assets/pet-directions/red-panda-idle.png?no-inline';

const poses: PetPose[] = ['idle', 'walk', 'sit', 'sleep', 'jump', 'look', 'grab'];

// Production pose files share a directory and a character digest. Vite
// emits the companion files next to the imported poster (see vite.config).
function character(idle: string): Record<PetPose, PetAsset> {
  const cut = idle.lastIndexOf('-idle');
  const stem = idle.slice(0, cut);
  const png = idle.slice(cut + 5);
  const webp = png.replace('.png', '.webp');
  return Object.fromEntries(poses.map(pose => [pose, {
    still: `${stem}-${pose}${png}`, animation: `${stem}-${pose}${webp}`,
    durationMs: pose === 'look' ? 1600 : pose === 'jump' ? 1000 : undefined,
  }])) as Record<PetPose, PetAsset>;
}

export const DIRECTION_ASSETS = {
  manga_cat: character(idle0_png),
  pixel_cat: character(idle1_png),
  mecha_spirit: character(idle2_png),
  red_panda: character(idle3_png),
};
