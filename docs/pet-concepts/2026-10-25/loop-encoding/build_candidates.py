"""Re-encode the existing 22 held slots; retain every experiment, including failures."""
import io
import json
import os
from PIL import Image, __version__
from contract import ROOT, KINDS, STATES, PLANS, LIMIT, QUALITY, INDICES, DURATIONS, sources, current, baseline, sha, measure, eligible, candidate_path

manifest = {'task': 'DP-200', 'appIntegrated': False, 'candidateAdopted': False,
            'sourceCommit': '1cbbc5b8780c35bb5d63d8d877aba9700d2413e9',
            'preparationCommit': '0e0d9dc7035db38c13f84dbceb5e1243916e85c1', 'pillowVersion': __version__,
            'policy': {'characterLimitBytes': LIMIT, 'qualityLimit': QUALITY,
                       'indices': INDICES, 'durationsMs': DURATIONS,
                       'recommendationRule': 'q75a100-preserve-matched-alpha',
                       'plans': {key: list(value) for key, value in PLANS.items()}}, 'characters': []}
for kind in KINDS:
    char = {'id': kind, 'baselinePackageBytes': baseline(kind), 'clips': {}}
    for state in STATES:
        paths, hashes = sources(kind, state)
        frames = [Image.open(path).convert('RGBA') for path in paths]
        prior = current(kind, state)
        clip = {'inputSha256': hashes, 'reference': {'path': os.path.relpath(prior, ROOT).replace('\\', '/'),
                'bytes': prior.stat().st_size, 'sha256': sha(prior), 'measurement': measure(prior, frames)}, 'candidates': {}}
        for plan, (quality, alpha_quality) in PLANS.items():
            variants = {}
            for minimize in (False, True):
                buffer = io.BytesIO()
                selected = [frames[i] for i in INDICES]
                selected[0].save(buffer, format='WEBP', save_all=True, append_images=selected[1:], duration=DURATIONS,
                    loop=0, quality=quality, alpha_quality=alpha_quality, method=6, minimize_size=minimize)
                variants[minimize] = buffer.getvalue()
            minimize = min(variants, key=lambda key: len(variants[key]))
            path = ROOT / candidate_path(kind, state, plan)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(variants[minimize])
            metrics = measure(path, frames)
            clip['candidates'][plan] = {'path': path.relative_to(ROOT).as_posix(), 'bytes': path.stat().st_size,
                'sha256': sha(path), 'minimizeSize': minimize, 'variantBytes': {str(k): len(v) for k, v in variants.items()},
                'measurement': metrics, 'eligible': eligible(metrics, path.stat().st_size, state)}
        char['clips'][state] = clip
    choices = {}
    for state in STATES:
        clip = char['clips'][state]
        candidate = clip['candidates']['q75a100']
        assert candidate['eligible'] and candidate['measurement']['maxMatchedFrameAlphaError'] == 0
        choices[state] = 'q75a100'
    total = char['baselinePackageBytes']
    for state, choice in choices.items():
        if choice != 'reference':
            total += char['clips'][state]['candidates'][choice]['bytes'] - char['clips'][state]['reference']['bytes']
    char.update(recommended=choices, hypotheticalPackageBytes=total, remainingBytes=LIMIT-total)
    manifest['characters'].append(char)
    print(kind, choices, total, 'remaining', LIMIT-total, flush=True)
(ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf8')
