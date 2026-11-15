"""Apply poses to independently editable SVG layers and rasterize in Inkscape."""
import math
import subprocess
from pathlib import Path
from xml.etree import ElementTree as ET

NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', NS)


def pivot(x, y, angle=0, sx=1, sy=1, dx=0, dy=0):
    return f'translate({x+dx:.3f} {y+dy:.3f}) rotate({angle:.3f}) scale({sx:.3f} {sy:.3f}) translate({-x} {-y})'


def frame(source, pose, index, count):
    svg = ET.parse(source)
    parts = {node.get('id'): node for node in svg.iter() if node.get('id')}
    phase = math.tau * index / count
    wave = math.sin(phase)
    breathing = (1 - math.cos(phase)) / 2
    turn = lean = lift = 0
    eyes = 'eyes'
    happy = False

    def set_part(name, *args, **kwargs):
        parts[name].set('transform', pivot(*args, **kwargs))

    set_part('tail', 44, 90, 4 * wave)
    set_part('scarf-tail', 47, 82, 5 * wave)
    if pose == 'idle':
        eyes = 'eye-closed' if index == 3 else 'eyes'
        set_part('head', 63, 84, -2 * wave, dy=-1.3 * breathing)
        set_part('torso', 63, 107, sy=1 + .022 * breathing)
    elif pose == 'walk':
        for name, x, offset in [('front-foot', 66, 0), ('hind-foot', 46, math.pi), ('back-foot', 76, math.pi / 2)]:
            swing = math.sin(phase + offset)
            set_part(name, x, 94, 23 * swing, dy=-6 * max(0, swing))
        set_part('head', 63, 84, -4 + 4 * wave, dx=2, dy=-2 * abs(wave))
        set_part('tail', 44, 90, -9 + 7 * wave)
        lean = 4
    elif pose == 'sit':
        set_part('torso', 60, 107, sx=1.05, sy=.72)
        set_part('hind-foot', 47, 104, -16, dx=-4)
        set_part('head', 63, 84, 5 + 2 * wave, dy=6)
        set_part('scarf', 60, 88, 3, dy=5)
        set_part('tail', 44, 90, -22 + 3 * wave, dy=6)
        eyes = 'eye-closed' if index == 3 else 'eyes'
    elif pose == 'sleep':
        set_part('torso', 67, 107, sx=1.17, sy=.61 + .035 * breathing, dx=10)
        set_part('tail', 44, 90, 146, sx=.92, sy=.95, dx=28, dy=-8)
        set_part('head', 55, 85, -26, .84, .82, -12, 16 - 2 * breathing)
        set_part('scarf', 61, 86, -20, .87, .8, -7, 12)
        eyes = 'eye-closed'
    elif pose == 'jump':
        lift = (0, 1, -7, -16, -21, -18, -11, -4, 1, 0)[index]
        set_part('torso', 62, 106, sy=1.06 if lift < -4 else 1 - .06 * lift)
        set_part('front-foot', 65, 93, -47 if lift < -4 else 0, dy=-3 if lift < -4 else 0)
        set_part('hind-foot', 46, 94, 29 if lift < -4 else 0)
        set_part('tail', 45, 91, -20 if lift < -4 else 0)
        happy = lift < -4
        lean = -6 if happy else 0
    elif pose == 'look':
        turn = (0, -3, -5, -4, 4, 6, 6, 3, 1, 0)[index]
        set_part('head', 63, 84, turn * 1.5, dx=turn * .47, dy=-abs(turn) * .38)
        set_part('gaze', 63, 62, dx=turn * .47)
    elif pose == 'grab':
        lift = -5 - 2 * breathing
        lean = -11 + 5 * wave
        set_part('front-foot', 64, 93, -25 + 11 * wave, dx=3)
        set_part('hind-foot', 46, 94, 27 - 9 * wave, dy=1)
        set_part('head', 63, 84, -8 + 3 * wave, dy=-1.5)
        set_part('tail', 44, 90, 15 - 8 * wave)
        eyes = 'eye-squint'
        happy = True

    set_part('root', 60, 106, lean, sx=.84, sy=.84, dx=3, dy=lift * .78 - (4 if pose == 'sleep' else 0))
    for name in ('eyes', 'eye-closed', 'eye-squint'):
        parts[name].set('visibility', 'visible' if name == eyes else 'hidden')
    parts['mouth'].set('visibility', 'hidden' if happy else 'visible')
    parts['smile'].set('visibility', 'visible' if happy else 'hidden')
    return svg


def render(output, timing):
    source = Path(__file__).with_name('character.svg')
    output.mkdir(parents=True, exist_ok=True)
    commands = []
    for pose, durations in timing.items():
        for index in range(len(durations)):
            target = output / f'{pose}-{index:02}'
            frame(source, pose, index, len(durations)).write(target.with_suffix('.svg'), encoding='utf-8')
            commands.append(f'file-open:{target.with_suffix(".svg")};export-filename:{target.with_suffix(".png")};export-do;file-close')
    beauty = output / 'beauty.png'
    commands.append(f'file-open:{output / "idle-00.svg"};export-width:600;export-filename:{beauty};export-do;file-close')
    subprocess.run(['inkscape', '--actions=' + ';'.join(commands)],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == '__main__':
    import argparse
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from motion import TIMING

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    render(parser.parse_args().output.resolve(), TIMING)
