"""Draw original 40×40 palette sprites, plus vector-editable pixel masters."""
import argparse
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from motion import TIMING

PALETTE = {
    'ink': '#402139', 'amber': '#f4a34e', 'shade': '#c56848',
    'cream': '#fff3ce', 'fur_shadow': '#efc397', 'pink': '#ff926f',
    'berry': '#be3e50', 'light': '#ef6551', 'gold': '#ffdb63',
}


def sprite(pose, index, count):
    im = Image.new('RGBA', (40, 40))
    draw = ImageDraw.Draw(im)
    wave = math.sin(math.tau * index / count)
    head_x = head_y = 0
    feet = [(13, 29), (22, 29), (26, 30)]
    sleep = pose == 'sleep'
    blink = (pose == 'idle' and index == 3) or (pose == 'sit' and index == 3)
    smile = pose == 'jump' and 2 <= index <= 7
    grab = pose == 'grab'
    lift = (0, 1, -2, -5, -5, -4, -3, -2, 1, 0)[index] if pose == 'jump' else 0

    def polygon(points, tone, x=0, y=0, outline=False):
        draw.polygon([(a+x, b+y+lift) for a, b in points], fill=PALETTE[tone],
                     outline=PALETTE['ink'] if outline else None)

    def rectangle(x1, y1, x2, y2, tone, x=0, y=0):
        draw.rectangle((x1+x, y1+y+lift, x2+x, y2+y+lift), fill=PALETTE[tone])

    if pose == 'walk':
        feet = [(13 + round(3 * wave), 29 - max(0, round(2 * wave))),
                (22 - round(3 * wave), 29 + min(0, round(2 * wave))), (27, 29)]
        head_x, head_y = 1, -round(abs(wave))
    elif pose == 'sit':
        feet = [(12, 30), (22, 30), (27, 31)]
        head_y = 2 if index in {0, 1, 5} else 1
    elif sleep:
        feet = [(15, 30), (21, 30), (27, 30)]
        head_x, head_y = -3, 7 - round(1 - math.cos(math.tau * index / count))
    elif grab:
        feet = [(12 - round(2 * wave), 30), (23 + round(2 * wave), 28), (27, 27)]
        lift = -1
        head_x, head_y = round(wave), -1
    elif pose == 'look':
        head_x = (0, -1, -2, -2, 1, 1, 1, 1, 0, 0)[index]
        head_y = -int(abs(head_x) > 1)
    elif smile:
        feet = [(11, 28), (24, 27), (27, 26)]
        head_y = max(0, -2 - lift)

    if sleep:
        polygon([(22, 29), (25, 25), (30, 24), (33, 25), (36, 28), (36, 32), (33, 35), (23, 35)], 'amber', outline=True)
        polygon([(28, 25), (30, 25), (31, 28), (31, 32), (29, 34), (26, 34), (28, 31)], 'cream')
        rectangle(33, 29, 34, 32, 'shade')
    else:
        tail_y = round(2 * wave) + (1 if pose == 'sit' else 0)
        polygon([(14, 29), (10, 29), (8, 26), (8, 23), (6, 22), (4, 22), (3, 24),
                 (3, 28), (5, 31), (8, 33), (13, 33), (16, 32)], 'amber', y=tail_y, outline=True)
        polygon([(4, 24), (6, 23), (7, 24), (7, 26), (4, 27)], 'cream', y=tail_y)

    back = [(0, 0), (3, 0), (5, 2), (5, 4), (3, 5), (0, 5), (-1, 3)]
    polygon(back, 'fur_shadow', *feet[2], outline=True)
    polygon([(11, 24), (16, 22), (24, 23), (28, 26), (30, 30), (28, 33), (14, 34),
             (10, 31), (9, 28)], 'amber', x=1 if sleep else 0, outline=True)
    polygon([(12, 29), (16, 31), (24, 31), (28, 29), (28, 32), (14, 33), (11, 31)], 'shade')
    polygon(back, 'cream', *feet[0], outline=True)
    polygon(back, 'cream', *feet[1], outline=True)
    rectangle(feet[1][0]+2, feet[1][1]+3, feet[1][0]+3, feet[1][1]+3, 'fur_shadow')

    if not sleep:
        polygon([(12, 23), (27, 23), (27, 28), (22, 29), (19, 31), (16, 29), (12, 29),
                 (10, 27), (8, 29), (6, 27), (11, 24)], 'berry', outline=True)
        polygon([(13, 24), (25, 24), (24, 26), (21, 27), (15, 27)], 'light')
        rectangle(19, 26, 21, 28, 'gold')
        rectangle(20, 25, 20, 29, 'gold')

    x, y = head_x, head_y
    polygon([(8, 16), (9, 12), (9, 6), (11, 5), (14, 5), (17, 9), (22, 9),
             (25, 10), (28, 6), (31, 6), (33, 8), (33, 15), (35, 18), (35, 22),
             (33, 25), (30, 27), (13, 27), (9, 25), (7, 23), (6, 20)], 'cream', x, y, True)
    polygon([(10, 7), (13, 6), (16, 10), (18, 10), (17, 15), (13, 18), (8, 18),
             (10, 13)], 'amber', x, y)
    polygon([(23, 10), (25, 11), (29, 7), (31, 7), (32, 9), (32, 16), (34, 18),
             (28, 18), (25, 16)], 'amber', x, y)
    polygon([(11, 8), (13, 8), (15, 11), (12, 13), (11, 12)], 'pink', x, y)
    polygon([(29, 9), (31, 9), (31, 13), (27, 12)], 'pink', x, y)
    rectangle(11, 22, 13, 23, 'pink', x, y)
    rectangle(29, 22, 31, 23, 'pink', x, y)
    if sleep or blink:
        for eye in (15, 26):
            rectangle(eye-1, 19, eye+1, 19, 'ink', x, y)
            rectangle(eye, 20, eye, 20, 'ink', x, y)
    elif grab or smile:
        for eye in (15, 26):
            polygon([(eye-2, 19), (eye, 17), (eye+2, 19), (eye, 18)], 'ink', x, y)
    else:
        gaze = 1 if head_x > 1 else -1 if head_x < -1 else 0
        for eye in (15, 26):
            rectangle(eye-1+gaze, 17, eye+1+gaze, 20, 'ink', x, y)
            rectangle(eye+gaze, 17, eye+gaze, 17, 'cream', x, y)
    rectangle(20, 20, 21, 21, 'shade', x, y)
    polygon([(18, 22), (23, 22), (23, 24), (22, 25), (19, 25), (18, 24)], 'ink', x, y)
    rectangle(20, 23, 21, 24, 'pink' if smile or grab else 'cream', x, y)
    return im


def vector_master(frames):
    rows = ['<svg xmlns="http://www.w3.org/2000/svg" width="400" height="280" viewBox="0 0 400 280" shape-rendering="crispEdges">',
            '<title>果粒貓 · Editable 40px frame atlas</title>']
    for pose, sprites in frames.items():
        y = list(frames).index(pose) * 40
        rows.append(f'<g id="{pose}" transform="translate(0 {y})">')
        for i, frame in enumerate(sprites):
            rows.append(f'<g id="{pose}-{i:02}" transform="translate({i*40} 0)">')
            colors = {}
            for py in range(40):
                px = 0
                while px < 40:
                    color = frame.getpixel((px, py))
                    end = px+1
                    while end < 40 and frame.getpixel((end, py)) == color:
                        end += 1
                    if color[3]:
                        fill = '#%02x%02x%02x' % color[:3]
                        colors.setdefault(fill, []).append(f'M{px} {py}h{end-px}v1H{px}z')
                    px = end
            for fill, segments in colors.items():
                path = ''.join(segments)
                rows.append(f'<path fill="{fill}" d="{path}"/>')
            rows.append('</g>')
        rows.append('</g>')
    return '\n'.join(rows + ['</svg>\n'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--svg', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    frames = {}
    for pose, durations in TIMING.items():
        frames[pose] = []
        for i in range(len(durations)):
            frame = sprite(pose, i, len(durations))
            frames[pose].append(frame)
            frame.resize((120, 120), Image.Resampling.NEAREST).save(args.output / f'{pose}-{i:02}.png')
    args.svg.write_text(vector_master(frames))
    frames['idle'][0].resize((600, 600), Image.Resampling.NEAREST).save(args.output / 'beauty.png')
    (args.svg.parent / 'palette.json').write_text(json.dumps(PALETTE, indent=2) + '\n')


if __name__ == '__main__':
    main()
