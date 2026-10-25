"""Sequential actual PNG/metadata negative controls with exact restoration."""
import copy
import json
import subprocess
import sys
from PIL import Image
from contract import ROOT, sha, measure, eligible
from check_sit import check


def main():
    original = json.loads((ROOT/'manifest.json').read_text(encoding='utf8'))
    paths = {ROOT/'manifest.json', *[ROOT/path for char in original['characters'] for path in char['sha256']]}
    backup = {path:path.read_bytes() for path in paths}

    def restore():
        for path, data in backup.items():
            path.write_bytes(data)

    def candidate(m):
        return ROOT/m['characters'][0]['candidates']['rgb128']['path']

    def refresh(m, pixels=True):
        char = m['characters'][0]
        reference = Image.open(ROOT/char['frame']).convert('RGBA')
        for item in char['candidates'].values():
            path = ROOT/item['path']
            item.update(bytes=path.stat().st_size, sha256=sha(path))
            if pixels:
                item['measurement'] = measure(path, reference)
                item['sixStatePackageBytes'] = char['baselinePackageBytes']+item['bytes']
                item['eligible'] = eligible(item['measurement'], item['bytes'], item['sixStatePackageBytes'])
        char['remainingWithRgb128'] = 196608-char['candidates']['rgb128']['sixStatePackageBytes']
        char['sha256'] = {path:sha(ROOT/path) for path in char['sha256']}

    def missing(m):
        candidate(m).unlink()

    def frozen(m):
        char = m['characters'][0]
        data = (ROOT/char['idleReference']).read_bytes()
        (ROOT/char['frame']).write_bytes(data)
        (ROOT/char['candidates']['originalPng']['path']).write_bytes(data)
        frame = Image.open(ROOT/char['frame']).convert('RGBA')
        image = frame.convert('RGB').quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert('RGBA')
        image.putalpha(frame.getchannel('A'))
        image.save(candidate(m), optimize=True)
        frame.resize((60,60), Image.Resampling.LANCZOS).save(ROOT/char['preview60'], optimize=True)
        refresh(m)

    def border(m):
        path = candidate(m);image = Image.open(path).convert('RGBA')
        image.putpixel((0,60),(0,0,0,1));image.save(path,optimize=True);refresh(m)

    def alpha(m):
        path = candidate(m);image = Image.open(path).convert('RGBA')
        point = next((x,y) for y in range(120) for x in range(120) if image.getpixel((x,y))[3]==255)
        pixel = image.getpixel(point);image.putpixel(point,(*pixel[:3],254));image.save(path,optimize=True);refresh(m)

    def dimensions(m):
        Image.open(candidate(m)).resize((60,60),Image.Resampling.LANCZOS).save(candidate(m),optimize=True);refresh(m,pixels=False)

    def source(m):
        m['characters'][0]['inputSourceSha256'] = '0'*64

    def palette(m):
        char = m['characters'][0]
        candidate(m).write_bytes((ROOT/char['frame']).read_bytes());refresh(m)
        assert len(Image.open(candidate(m)).convert('RGB').getcolors(maxcolors=14400))>128

    def excess(m):
        path = candidate(m);path.write_bytes(path.read_bytes()+b'\0'*(16385-path.stat().st_size));refresh(m)

    def total(m):
        m['characters'][0]['candidates']['rgb128']['sixStatePackageBytes'] += 1

    controls = [('missing candidate',missing),('idle masquerading as sit',frozen),('border alpha=1',border),
        ('internal alpha changed by one',alpha),('wrong dimensions',dimensions),('forged published source',source),
        ('wrong palette',palette),('real static PNG excess',excess),('forged package total',total)]
    try:
        for label, mutate in controls:
            restore();manifest=copy.deepcopy(original);mutate(manifest)
            (ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')
            run = subprocess.run([sys.executable,'-X','utf8',str(ROOT/'check_sit.py')],capture_output=True,encoding='utf8')
            assert run.returncode!=0 and 'AssertionError' in run.stderr,(label,run.stdout,run.stderr)
            print(label+' rejected: '+run.stderr.splitlines()[-1],flush=True)
    finally:
        restore()
        assert all(path.read_bytes()==data for path,data in backup.items()),'restore mismatch'
        print(f'All {len(backup)} artifacts restored byte-for-byte',flush=True)
    check()


if __name__=='__main__':
    main()
