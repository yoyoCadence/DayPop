"""Mutate actual trial files sequentially, synchronise metadata, restore every byte."""
import copy
import json
import subprocess
import sys
from PIL import Image
from contract import ROOT, sources, sha, measure, eligible, decode
from check_candidates import check


def main():
    files = [ROOT / 'manifest.json', *(ROOT / 'candidates').rglob('*.webp')]
    backup = {path: path.read_bytes() for path in files}
    original = json.loads(backup[ROOT / 'manifest.json'])

    def restore():
        for path, content in backup.items():
            path.write_bytes(content)

    def entry(manifest, state='idle'):
        return manifest['characters'][0]['clips'][state]['candidates']['q75a100']

    def path(manifest, state='idle'):
        return ROOT / entry(manifest, state)['path']

    def refresh(manifest, state='idle'):
        item = entry(manifest, state)
        target = path(manifest, state)
        frames = [Image.open(p).convert('RGBA') for p in sources('moon_cat', state)[0]]
        item.update(bytes=target.stat().st_size, sha256=sha(target), measurement=measure(target, frames))
        item['eligible'] = eligible(item['measurement'], item['bytes'], state)
        item['variantBytes'] = {str(item['minimizeSize']): item['bytes'], str(not item['minimizeSize']): item['bytes']+1}
        char = manifest['characters'][0]
        char['hypotheticalPackageBytes'] = char['baselinePackageBytes'] + sum(
            clip['candidates']['q75a100']['bytes']-clip['reference']['bytes'] for clip in char['clips'].values())
        char['remainingBytes'] = 196608-char['hypotheticalPackageBytes']

    def encode(manifest, transform=lambda image: image, loop=0, alter_duration=False, shift_phase=False):
        target = path(manifest)
        decoded = decode(target)
        frames = [transform(frame.copy()) for _, _, frame in decoded]
        durations = [duration for _, duration, _ in decoded]
        if alter_duration:
            durations[0] += 200
        if shift_phase:
            durations[0], durations[5] = durations[5], durations[0]
        frames[0].save(target, format='WEBP', save_all=True, append_images=frames[1:], duration=durations,
                       loop=loop, lossless=True, method=0)
        entry(manifest).update(bytes=target.stat().st_size, sha256=sha(target))

    def missing(m):
        path(m).unlink()

    def provenance(m):
        hashes = m['characters'][0]['clips']['idle']['inputSha256']
        hashes[next(iter(hashes))] = '0'*64

    def static(m):
        Image.new('RGBA', (120, 120)).save(path(m), format='WEBP', lossless=True)
        entry(m).update(bytes=path(m).stat().st_size, sha256=sha(path(m)))

    def loop(m):
        encode(m, loop=1)

    def duration(m):
        encode(m, alter_duration=True)

    def phase(m):
        encode(m, shift_phase=True)
        refresh(m)

    def border(m):
        def add_pixel(image):
            image.putpixel((0, 60), (255, 255, 255, 1))
            return image
        encode(m, transform=add_pixel)
        refresh(m)
        assert not entry(m)['measurement']['alphaSafe120']

    def color(m):
        encode(m, transform=lambda image: image.transpose(Image.Transpose.FLIP_LEFT_RIGHT))
        refresh(m)
        assert not entry(m)['eligible']

    def excess(m):
        target = path(m, 'sleep')
        target.write_bytes(target.read_bytes()+b'\0'*(65537-target.stat().st_size))
        refresh(m, 'sleep')
        assert not entry(m, 'sleep')['eligible']

    def eligibility(m):
        entry(m)['eligible'] = False

    def total(m):
        m['characters'][0]['hypotheticalPackageBytes'] += 1

    controls = [('missing candidate', missing), ('forged published frame hash', provenance),
        ('static instead of animation', static), ('wrong loop', loop), ('wrong duration', duration),
        ('same total but changed phase', phase), ('one alpha pixel on border', border),
        ('mirrored timeline with refreshed metrics', color), ('real sleep byte excess', excess),
        ('forged eligibility', eligibility), ('forged package total', total)]
    try:
        for label, mutate in controls:
            restore()
            manifest = copy.deepcopy(original)
            mutate(manifest)
            (ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf8')
            run = subprocess.run([sys.executable, '-X', 'utf8', str(ROOT / 'check_candidates.py')], capture_output=True, encoding='utf8')
            assert run.returncode != 0 and 'AssertionError' in run.stderr, (label, run.stdout, run.stderr)
            print(label+' rejected: '+run.stderr.splitlines()[-1], flush=True)
    finally:
        restore()
        assert all(path.read_bytes() == content for path, content in backup.items()), 'restore mismatch'
        print(f'All {len(backup)} files restored byte-for-byte', flush=True)
    check()


if __name__ == '__main__':
    main()
