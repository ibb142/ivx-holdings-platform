"""Build clearly labelled MP4 galleries from each deal's published images.

Requires Python 3, ffmpeg and ffprobe. These are image slideshows, not recorded
property tours. The manifest records the source URL and hash of every image.
"""
import hashlib
import argparse
import json
import pathlib
import subprocess
import tempfile
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'expo/ivxholding-landing/videos/galleries'
DEALS = {'perez-residence-001': 'PEREZ RESIDENCE', 'JV-202603-5190': 'IVX JACKSONVILLE PRIME'}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def build(catalog_path=None):
    if catalog_path:
        catalog = json.loads(pathlib.Path(catalog_path).read_text())['deals']
    else:
        with urllib.request.urlopen('https://api.ivxholding.com/api/deals', timeout=30) as response:
            catalog = json.load(response)['deals']
    assert set(DEALS).issubset({row['id'] for row in catalog}), 'Complete published catalog snapshot required'
    OUTPUT.mkdir(parents=True, exist_ok=True)
    videos = []
    with tempfile.TemporaryDirectory(prefix='ivx-gallery-') as tmp:
        for deal_id, title in DEALS.items():
            deal = next(row for row in catalog if row['id'] == deal_id)
            assert deal['published'] and deal['photos'], 'Published property images required'
            folder = pathlib.Path(tmp) / deal_id
            folder.mkdir()
            sources = []
            for index, url in enumerate(deal['photos']):
                prefix = f'https://kvclcdjmjghndxsngfzb.supabase.co/storage/v1/object/public/deal-photos/{deal_id}/'
                assert url.startswith(prefix), 'Image must belong to this property'
                with urllib.request.urlopen(url, timeout=30) as response:
                    assert response.headers.get_content_type().startswith('image/')
                    data = response.read()
                (folder / f'{index:02}.jpg').write_bytes(data)
                sources.append({'url': url, 'sha256': sha256(data)})
            (folder / 'title.txt').write_text(title, encoding='utf-8')
            (folder / 'label.txt').write_text('Galería de imágenes / Image gallery', encoding='utf-8')
            duration = len(sources) * 3
            target = folder / 'gallery.mp4'
            filters = (
                'scale=1280:620:force_original_aspect_ratio=decrease,'
                'pad=1280:720:(ow-iw)/2:20:color=0x111827,setsar=1,'
                f'drawtext=textfile={folder}/title.txt:fontcolor=white:fontsize=25:x=40:y=646,'
                f'drawtext=textfile={folder}/label.txt:fontcolor=0xcbd5e1:fontsize=19:x=40:y=682'
            )
            subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                            '-framerate', '1/3', '-i', str(folder / '%02d.jpg'),
                            '-vf', filters, '-r', '24', '-t', str(duration),
                            '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
                            '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
                            '-metadata', f'title={title} — Image gallery',
                            '-metadata', 'comment=Slideshow of published project images; not recorded property-tour footage.',
                            str(target)], check=True)
            probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(target)]))
            stream = probe['streams'][0]
            assert stream['codec_name'] == 'h264' and stream['pix_fmt'] == 'yuv420p'
            assert abs(float(probe['format']['duration']) - duration) < 0.1
            subprocess.run(['ffmpeg', '-v', 'error', '-i', str(target), '-f', 'null', '-'], check=True)
            data = target.read_bytes()
            digest = sha256(data)
            name = f'{deal_id.lower()}-image-gallery-{digest[:12]}.mp4'
            (OUTPUT / name).write_bytes(data)
            videos.append({'deal_id': deal_id, 'title': title,
                           'caption': f'{title} — Galería de imágenes / Image gallery',
                           'asset_type': 'image_gallery_video', 'recorded_footage': False,
                           'key': f'videos/galleries/{name}', 'content_type': 'video/mp4',
                           'sha256': digest, 'bytes': len(data), 'duration_seconds': duration,
                           'width': 1280, 'height': 720, 'fps': 24,
                           'thumbnail_url': sources[0]['url'], 'source_images': sources})
    (OUTPUT / 'manifest.json').write_text(json.dumps({'version': 1, 'videos': videos}, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(json.dumps([{'deal_id': row['deal_id'], 'key': row['key'], 'bytes': row['bytes'], 'duration_seconds': row['duration_seconds']} for row in videos]))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', help='Previously verified JSON response from /api/deals')
    build(parser.parse_args().catalog)
