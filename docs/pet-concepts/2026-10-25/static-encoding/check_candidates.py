import json
import os
from PIL import Image
from contract import ROOT, KINDS, STATES, PLANS, LIMIT, STATIC_LIMIT, QUALITY_LIMIT, inputs, baseline_bytes, output_path, measure, eligible, sha


def check():
    manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf8'))
    assert manifest['task'] == 'DP-198' and manifest['appIntegrated'] is False and manifest['candidateAdopted'] is False
    assert manifest['sourceCommit'] == 'e9d40a50f2d2b6714df0783b1d855e4eb203409c', 'source commit'
    assert manifest['policy'] == {'characterLimitBytes': LIMIT, 'staticLimitBytes': STATIC_LIMIT,
        'qualityLimit': QUALITY_LIMIT, 'alpha': 'exact at 120 and 60', 'plans': {key: list(value) for key, value in PLANS.items()}}
    assert [char['id'] for char in manifest['characters']] == list(KINDS), 'character inventory'
    expected_paths = {output_path(kind, state, plan) for kind in KINDS for state in STATES for plan in PLANS}
    actual_paths = {str(path.relative_to(ROOT)).replace('\\', '/') for path in (ROOT / 'candidates').rglob('*') if path.is_file()}
    assert actual_paths == expected_paths, 'candidate inventory'
    for char in manifest['characters']:
        kind = char['id']
        source = inputs(kind)
        base = baseline_bytes(kind)
        assert char['baselinePackageBytes'] == base
        assert set(char['states']) == set(STATES)
        totals = {plan: base - sum(path.stat().st_size for path in source.values()) for plan in PLANS}
        for state in STATES:
            row = char['states'][state]
            assert row['source'] == os.path.relpath(source[state], ROOT).replace('\\', '/'), 'fixed source path'
            assert row['sourceSha256'] == sha(source[state]), 'PNG provenance'
            assert row['sourceBytes'] == source[state].stat().st_size
            assert set(row['candidates']) == set(PLANS), 'plan inventory'
            reference = Image.open(source[state]).convert('RGBA')
            for plan, (method, colors) in PLANS.items():
                item = row['candidates'][plan]
                assert item['path'] == output_path(kind, state, plan), 'fixed output path'
                path = ROOT / item['path']
                assert item['sha256'] == sha(path) and item['bytes'] == path.stat().st_size, 'candidate bytes/hash'
                assert 0 < item['bytes'] <= STATIC_LIMIT, 'static byte limit'
                actual = measure(path, reference)
                assert actual['mode'] == ('P' if method == 'indexed' else 'RGBA'), 'PNG color mode'
                assert actual['rgbColors'] <= colors, 'palette color count'
                assert item['measurement'] == actual, 'actual pixel measurement'
                assert item['eligible'] is eligible(actual), 'eligibility must include exact alpha'
                totals[plan] += path.stat().st_size
        assert char['hypotheticalPackageBytes'] == totals, 'unique PNG package accounting'
        assert char['recommended'] == 'rgb128'
        assert all(char['states'][state]['candidates']['rgb128']['eligible'] for state in STATES), 'recommended PNG rejected'
        assert totals['rgb128'] <= LIMIT, 'recommended character byte limit'
        assert char['remainingBytes'] == LIMIT - totals['rgb128']
        print(kind, 'baseline', base, 'rgb128 package', totals['rgb128'], 'remaining', char['remainingBytes'])
    print('DP-198 candidate provenance, pixels, alpha, palette and byte gates passed')


if __name__ == '__main__':
    check()
