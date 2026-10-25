"""Sequential real-file/metadata negative controls, always restoring bytes."""
import copy
import json
import subprocess
import sys
from PIL import Image
from contract import ROOT, STATES, inputs, measure, sha
from check_candidates import check


def main():
    files = [ROOT / 'manifest.json', *(ROOT / 'candidates').rglob('*.png')]
    backups = {path: path.read_bytes() for path in files}
    original = json.loads(backups[ROOT / 'manifest.json'])

    def restore():
        for path, content in backups.items():
            path.write_bytes(content)

    def refresh(manifest, state='idle'):
        char = manifest['characters'][0]
        item = char['states'][state]['candidates']['rgb128']
        path = ROOT / item['path']
        item['sha256'], item['bytes'] = sha(path), path.stat().st_size
        item['measurement'] = measure(path, Image.open(inputs('moon_cat')[state]).convert('RGBA'))
        item['eligible'] = all(item['measurement'][f'alphaSafe{size}'] and item['measurement'][f'maxAlphaError{size}'] == 0 for size in (120, 60))
        char['hypotheticalPackageBytes']['rgb128'] = char['baselinePackageBytes'] - sum(row['sourceBytes'] for row in char['states'].values()) + sum(row['candidates']['rgb128']['bytes'] for row in char['states'].values())
        char['remainingBytes'] = 196608 - char['hypotheticalPackageBytes']['rgb128']

    def candidate(manifest, state='idle'):
        return ROOT / manifest['characters'][0]['states'][state]['candidates']['rgb128']['path']

    def missing(m):
        candidate(m).unlink()

    def wrong_source(m):
        m['characters'][0]['states']['idle']['sourceSha256'] = '0' * 64

    def wrong_mode(m):
        path = candidate(m)
        Image.open(path).convert('RGB').save(path, optimize=True)
        refresh(m)

    def alpha_border(m):
        path = candidate(m)
        image = Image.open(path).convert('RGBA')
        image.putpixel((0, 60), (0, 0, 0, 1))
        image.save(path, optimize=True)
        refresh(m)

    def changed_alpha(m):
        path = candidate(m)
        image = Image.open(path).convert('RGBA')
        point = next((x, y) for y in range(120) for x in range(120) if image.getpixel((x, y))[3] == 255)
        pixel = image.getpixel(point)
        image.putpixel(point, (*pixel[:3], 254))
        image.save(path, optimize=True)
        refresh(m)

    def forged_eligible(m):
        m['characters'][0]['states']['idle']['candidates']['indexed256']['eligible'] = True

    def static_limit(m):
        path = candidate(m)
        path.write_bytes(path.read_bytes() + b'\0' * 5000)
        refresh(m)

    def character_limit(m):
        for state in STATES:
            path = candidate(m, state)
            path.write_bytes(path.read_bytes() + b'\0' * 2000)
            refresh(m, state)

    controls = [('missing inventory', missing), ('forged source hash', wrong_source), ('wrong PNG mode', wrong_mode),
        ('one alpha pixel on border', alpha_border), ('one alpha unit inside', changed_alpha),
        ('forged indexed eligibility', forged_eligible), ('real static byte excess', static_limit),
        ('real character byte excess', character_limit)]
    try:
        for label, mutate in controls:
            restore()
            manifest = copy.deepcopy(original)
            mutate(manifest)
            (ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf8')
            run = subprocess.run([sys.executable, '-X', 'utf8', str(ROOT / 'check_candidates.py')], capture_output=True, encoding='utf8')
            assert run.returncode != 0 and 'AssertionError' in run.stderr, (label, run.stdout, run.stderr)
            print(label + ' rejected: ' + run.stderr.splitlines()[-1], flush=True)
    finally:
        restore()
        assert all(path.read_bytes() == content for path, content in backups.items()), 'restore mismatch'
        print('All 25 files restored byte-for-byte', flush=True)
    check()


if __name__ == '__main__':
    main()
