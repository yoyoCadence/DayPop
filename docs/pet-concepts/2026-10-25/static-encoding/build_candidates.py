import json
import os
import PIL
from PIL import Image, ImageDraw
from contract import ROOT, KINDS, STATES, PLANS, LIMIT, STATIC_LIMIT, QUALITY_LIMIT, inputs, baseline_bytes, output_path, measure, eligible, sha


def encode(reference, method, colors):
    if method == 'indexed':
        return reference.quantize(colors=colors, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    image = reference.convert('RGB').quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert('RGBA')
    image.putalpha(reference.getchannel('A'))
    return image


def main():
    manifest = {'task': 'DP-198', 'appIntegrated': False, 'candidateAdopted': False,
        'sourceCommit': 'e9d40a50f2d2b6714df0783b1d855e4eb203409c', 'pillowVersion': PIL.__version__,
        'policy': {'characterLimitBytes': LIMIT, 'staticLimitBytes': STATIC_LIMIT, 'qualityLimit': QUALITY_LIMIT,
            'alpha': 'exact at 120 and 60', 'plans': PLANS}, 'characters': []}
    for kind in KINDS:
        sources = inputs(kind)
        base = baseline_bytes(kind)
        char = {'id': kind, 'baselinePackageBytes': base, 'states': {}, 'recommended': 'rgb128'}
        totals = {plan: base - sum(path.stat().st_size for path in sources.values()) for plan in PLANS}
        for state, source in sources.items():
            reference = Image.open(source).convert('RGBA')
            row = {'source': os.path.relpath(source, ROOT).replace('\\', '/'), 'sourceSha256': sha(source),
                'sourceBytes': source.stat().st_size, 'candidates': {}}
            for plan, (method, colors) in PLANS.items():
                path = ROOT / output_path(kind, state, plan)
                path.parent.mkdir(parents=True, exist_ok=True)
                encode(reference, method, colors).save(path, format='PNG', optimize=True)
                metrics = measure(path, reference)
                row['candidates'][plan] = {'path': output_path(kind, state, plan), 'bytes': path.stat().st_size,
                    'sha256': sha(path), 'measurement': metrics, 'eligible': eligible(metrics)}
                totals[plan] += path.stat().st_size
            char['states'][state] = row
        char['hypotheticalPackageBytes'] = totals
        char['remainingBytes'] = LIMIT - totals['rgb128']
        manifest['characters'].append(char)
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    boards(manifest)


def boards(manifest):
    # True 60px Lanczos samples are enlarged with nearest only for inspection.
    columns = ['source', 'rgb256', 'rgb128', 'indexed256', 'indexed128']
    for name, color in (('light', '#f5f3ee'), ('dark', '#111827')):
        board = Image.new('RGB', (800, 1080), '#dddddd')
        draw = ImageDraw.Draw(board)
        for column, plan in enumerate(columns):
            draw.text((column * 160 + 10, 8), plan, fill='black')
        for index, (char, state) in enumerate((char, state) for char in manifest['characters'] for state in STATES):
            row = char['states'][state]
            draw.text((8, index * 175 + 28), char['id'] + ' / ' + state, fill='black')
            for column, plan in enumerate(columns):
                relative = row['source'] if plan == 'source' else row['candidates'][plan]['path']
                image = Image.open(ROOT / relative).convert('RGBA')
                small = image.resize((60, 60), Image.Resampling.LANCZOS)
                matte = Image.new('RGBA', (60, 60), color)
                sample = Image.alpha_composite(matte, small).convert('RGB').resize((120, 120), Image.Resampling.NEAREST)
                board.paste(sample, (column * 160 + 20, index * 175 + 48))
                label = 'original' if plan == 'source' else str(row['candidates'][plan]['bytes']) + ' bytes'
                draw.text((column * 160 + 8, index * 175 + 172), label, fill='black')
        board.save(ROOT / f'comparison-{name}.png', optimize=True)


if __name__ == '__main__':
    main()
