"""Recompute every original 100ms interval; reject forged provenance or eligibility."""
import json
import os
from PIL import Image
from contract import ROOT, KINDS, STATES, PLANS, LIMIT, QUALITY, INDICES, DURATIONS, sources, current, baseline, sha, measure, eligible, candidate_path


def check():
    manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf8'))
    assert manifest['task'] == 'DP-200' and manifest['appIntegrated'] is False and manifest['candidateAdopted'] is False
    assert manifest['sourceCommit'] == '1cbbc5b8780c35bb5d63d8d877aba9700d2413e9', 'published source commit'
    assert manifest['preparationCommit'] == '0e0d9dc7035db38c13f84dbceb5e1243916e85c1', 'local preparation commit'
    assert manifest['policy'] == {'characterLimitBytes': LIMIT, 'qualityLimit': QUALITY, 'indices': INDICES,
        'durationsMs': DURATIONS, 'recommendationRule': 'q75a100-preserve-matched-alpha',
        'plans': {key: list(value) for key, value in PLANS.items()}}, 'fixed encoding policy'
    assert [char['id'] for char in manifest['characters']] == list(KINDS), 'character inventory'
    expected = {candidate_path(kind, state, plan) for kind in KINDS for state in STATES for plan in PLANS}
    actual_paths = {path.relative_to(ROOT).as_posix() for path in (ROOT / 'candidates').rglob('*') if path.is_file()}
    assert actual_paths == expected, 'candidate inventory'
    for char in manifest['characters']:
        kind = char['id']
        assert char['baselinePackageBytes'] == baseline(kind), 'baseline package'
        assert set(char['clips']) == set(STATES), 'clip inventory'
        choices, total = {}, char['baselinePackageBytes']
        for state in STATES:
            paths, hashes = sources(kind, state)
            frames = [Image.open(path).convert('RGBA') for path in paths]
            clip = char['clips'][state]
            assert clip['inputSha256'] == hashes, 'published frame provenance'
            prior = current(kind, state)
            reference = measure(prior, frames)
            assert eligible(reference, prior.stat().st_size, state), 'current reference rejected'
            assert clip['reference'] == {'path': os.path.relpath(prior, ROOT).replace('\\', '/'),
                'bytes': prior.stat().st_size, 'sha256': sha(prior), 'measurement': reference}, 'published reference'
            assert set(clip['candidates']) == set(PLANS), 'plan inventory'
            pool = {'reference': prior.stat().st_size}
            for name, item in clip['candidates'].items():
                assert item['path'] == candidate_path(kind, state, name), 'fixed candidate path'
                path = ROOT / item['path']
                assert item['bytes'] == path.stat().st_size and item['sha256'] == sha(path), 'candidate bytes/hash'
                metrics = measure(path, frames)
                assert metrics['decodedDurationsMs'] == reference['decodedDurationsMs'], 'decoded phase timing changed'
                assert item['measurement'] == metrics, 'actual timeline measurements'
                accepted = eligible(metrics, path.stat().st_size, state)
                assert item['eligible'] is accepted, 'candidate eligibility'
                variants = item['variantBytes']
                assert set(variants) == {'False', 'True'} and all(type(n) is int and n > 0 for n in variants.values()), 'variant sizes'
                assert type(item['minimizeSize']) is bool and item['bytes'] == variants[str(item['minimizeSize'])] == min(variants.values()), 'selected variant size'
                if accepted:
                    pool[name] = item['bytes']
            selected = char['recommended'][state]
            assert selected in pool, 'recommended clip rejected'
            assert selected == 'q75a100', 'conservative recommendation changed'
            assert clip['candidates'][selected]['measurement']['maxMatchedFrameAlphaError'] == 0, 'recommended matched alpha changed'
            choices[state] = selected
            total += pool[choices[state]] - prior.stat().st_size
        assert char['recommended'] == choices, 'recommended choices'
        assert char['hypotheticalPackageBytes'] == total and total <= LIMIT, 'recommended character byte limit'
        assert char['remainingBytes'] == LIMIT-total, 'remaining bytes'
        print(kind, choices, total, 'remaining', LIMIT-total, flush=True)
    print('DP-200 provenance, timeline, alpha, quality and package gates passed', flush=True)


if __name__ == '__main__':
    check()
