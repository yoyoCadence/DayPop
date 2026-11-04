import p0idlewebp from '../../assets/pet-collection/marshmallow-cat-idle.webp';
import p0walkwebp from '../../assets/pet-collection/marshmallow-cat-walk.webp';
import p0lookwebp from '../../assets/pet-collection/marshmallow-cat-look.webp';
import p0sleepwebp from '../../assets/pet-collection/marshmallow-cat-sleep.webp';
import p0jumpwebp from '../../assets/pet-collection/marshmallow-cat-jump.webp';
import p0idlepng from '../../assets/pet-collection/marshmallow-cat-idle.png';
import p0sitpng from '../../assets/pet-collection/marshmallow-cat-sit.png';
import p0grabpng from '../../assets/pet-collection/marshmallow-cat-grab.png';
import p0sleeppng from '../../assets/pet-collection/marshmallow-cat-sleep.png';
import p1idlewebp from '../../assets/pet-collection/honey-bear-idle.webp';
import p1walkwebp from '../../assets/pet-collection/honey-bear-walk.webp';
import p1lookwebp from '../../assets/pet-collection/honey-bear-look.webp';
import p1sleepwebp from '../../assets/pet-collection/honey-bear-sleep.webp';
import p1jumpwebp from '../../assets/pet-collection/honey-bear-jump.webp';
import p1idlepng from '../../assets/pet-collection/honey-bear-idle.png';
import p1sitpng from '../../assets/pet-collection/honey-bear-sit.png';
import p1grabpng from '../../assets/pet-collection/honey-bear-grab.png';
import p1sleeppng from '../../assets/pet-collection/honey-bear-sleep.png';
import p2idlewebp from '../../assets/pet-collection/peach-bunny-idle.webp';
import p2walkwebp from '../../assets/pet-collection/peach-bunny-walk.webp';
import p2lookwebp from '../../assets/pet-collection/peach-bunny-look.webp';
import p2sleepwebp from '../../assets/pet-collection/peach-bunny-sleep.webp';
import p2jumpwebp from '../../assets/pet-collection/peach-bunny-jump.webp';
import p2idlepng from '../../assets/pet-collection/peach-bunny-idle.png';
import p2sitpng from '../../assets/pet-collection/peach-bunny-sit.png';
import p2grabpng from '../../assets/pet-collection/peach-bunny-grab.png';
import p2sleeppng from '../../assets/pet-collection/peach-bunny-sleep.png';

/** Native Blender seven-state packages; device preference wiring is separate. */
export const COLLECTION_ASSETS = {
  marshmallow_cat: {
    idle: { still: p0idlepng, animation: p0idlewebp },
    walk: { still: p0idlepng, animation: p0walkwebp },
    look: { still: p0idlepng, animation: p0lookwebp, durationMs: 1600 },
    sit: { still: p0sitpng },
    sleep: { still: p0sleeppng, animation: p0sleepwebp },
    jump: { still: p0idlepng, animation: p0jumpwebp, durationMs: 1000 },
    grab: { still: p0grabpng },
  },
  honey_bear: {
    idle: { still: p1idlepng, animation: p1idlewebp },
    walk: { still: p1idlepng, animation: p1walkwebp },
    look: { still: p1idlepng, animation: p1lookwebp, durationMs: 1600 },
    sit: { still: p1sitpng },
    sleep: { still: p1sleeppng, animation: p1sleepwebp },
    jump: { still: p1idlepng, animation: p1jumpwebp, durationMs: 1000 },
    grab: { still: p1grabpng },
  },
  peach_bunny: {
    idle: { still: p2idlepng, animation: p2idlewebp },
    walk: { still: p2idlepng, animation: p2walkwebp },
    look: { still: p2idlepng, animation: p2lookwebp, durationMs: 1600 },
    sit: { still: p2sitpng },
    sleep: { still: p2sleeppng, animation: p2sleepwebp },
    jump: { still: p2idlepng, animation: p2jumpwebp, durationMs: 1000 },
    grab: { still: p2grabpng },
  },
};

