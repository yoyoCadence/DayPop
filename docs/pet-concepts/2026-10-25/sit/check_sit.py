"""Check actual static pixels, published inputs and fixed six-state budget trials."""
import json
from PIL import Image
from contract import ROOT, PREVIOUS, KINDS, published, baseline, sha, measure, eligible


def check():
    manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf8'))
    assert manifest['task'] == 'DP-202' and manifest['productionReady'] is False and manifest['appIntegrated'] is False
    assert manifest['appearanceApproved'] is True and manifest['sitPoseApproved'] is False
    assert manifest['sourceCommit'] == '0a0f3de91531b8c5f4c821ccc7455195d1a54099'
    assert manifest['preparationCommit'] == '250ee98e65900842dafed344f323c1ee52bad540'
    assert [c['id'] for c in manifest['characters']] == list(KINDS)
    inventory = {f'{folder}/{kind}/{name}' for kind in KINDS for folder,names in
                 (('frames', ('sit.png',)), ('previews', ('sit.png', 'sit-rgb128.png', 'sit-60.png'))) for name in names}
    inventory |= {f'source/{kind}.blend' for kind in KINDS}
    actual = {path.relative_to(ROOT).as_posix() for folder in ('frames','previews','source') for path in (ROOT/folder).rglob('*') if path.is_file()}
    assert actual == inventory, 'artifact inventory'
    for char in manifest['characters']:
        kind = char['id']
        original = published(kind)
        assert char['inputSource'] == '../../2026-10-23/motion/'+original['source']
        assert char['inputSourceSha256'] == sha(ROOT / char['inputSource']) == original['sha256'][original['source']], 'published Blender provenance'
        original_idle = original['clips']['idle']['frames'][0]
        assert char['idleReference'] == '../../2026-10-23/motion/'+original_idle
        assert char['idleReferenceSha256'] == sha(ROOT / char['idleReference']) == original['sha256'][original_idle], 'published idle provenance'
        assert char['camera'] == original['camera'] and char['anchor'] == original['anchor'], 'camera/anchor metadata'
        assert char['source'] == f'source/{kind}.blend' and char['frame'] == f'frames/{kind}/sit.png', 'fixed source paths'
        frame = Image.open(ROOT / char['frame']).convert('RGBA')
        assert frame.tobytes() != Image.open(ROOT / char['idleReference']).convert('RGBA').tobytes(), 'sit must differ from original idle'
        own = measure(ROOT / char['frame'], frame)
        assert own['alphaSafe120'] and own['alphaSafe60'], 'unsafe original PNG'
        assert set(char['candidates']) == {'originalPng', 'rgb128'}
        current = baseline(kind)
        assert char['baselinePackageBytes'] == current and char['characterLimitBytes'] == 196608
        for name, item in char['candidates'].items():
            filename = 'sit.png' if name == 'originalPng' else 'sit-rgb128.png'
            assert item['path'] == f'previews/{kind}/{filename}', 'fixed candidate path'
            path = ROOT / item['path']
            assert item['bytes'] == path.stat().st_size and item['sha256'] == sha(path), 'candidate bytes/hash'
            metrics = measure(path, frame)
            if name == 'rgb128':
                assert len(Image.open(path).convert('RGB').getcolors(maxcolors=14400)) <= 128, 'candidate palette'
            assert item['measurement'] == metrics, 'actual pixel measurement'
            total = current+path.stat().st_size
            assert item['sixStatePackageBytes'] == total, 'six-state package accounting'
            assert item['eligible'] is eligible(metrics, path.stat().st_size, total), 'candidate eligibility'
            assert metrics['alphaSafe120'] and metrics['alphaSafe60'] and all(metrics[f'maxAlphaError{s}'] == 0 for s in (120, 60)), 'exact alpha and safety'
            assert path.stat().st_size <= 16384, 'static PNG byte limit'
            assert all(v < .008 for k,v in metrics.items() if 'MeanAbsoluteError' in k), 'PNG color quality'
        assert (ROOT / char['candidates']['originalPng']['path']).read_bytes() == (ROOT / char['frame']).read_bytes(), 'native still bytes'
        assert char['preview60'] == f'previews/{kind}/sit-60.png'
        assert Image.open(ROOT / char['preview60']).convert('RGBA').tobytes() == frame.resize((60, 60), Image.Resampling.LANCZOS).tobytes(), 'true 60px preview'
        expected = {char['source'], char['frame'], char['preview60'], *[item['path'] for item in char['candidates'].values()]}
        assert set(char['sha256']) == expected and all(sha(ROOT / path) == digest for path,digest in char['sha256'].items()), 'artifact bytes/hash'
        assert char['remainingWithRgb128'] == 196608-char['candidates']['rgb128']['sixStatePackageBytes']
        print(kind, 'sit PNG/alpha/source/budget pass', char['remainingWithRgb128'], 'bytes remain for unresolved walk', flush=True)


if __name__ == '__main__':
    check()
