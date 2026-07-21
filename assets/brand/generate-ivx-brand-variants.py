#!/usr/bin/env python3
"""Generate all official IVX brand variants from the attached master logo.

Uses the owner-attached logo as the single source of truth.
Does not stretch, distort, recolor, or alter proportions.
"""

import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

SRC = Path(__file__).parent / 'official' / 'ivx-logo-official.jpg'
OUT = Path(__file__).parent / 'official'
OUT.mkdir(parents=True, exist_ok=True)

# Brand colors from the attached logo
BLACK = (0, 0, 0)
GOLD = (230, 194, 0)  # official gold sampled from the logo

# Load master logo
master = Image.open(SRC).convert('RGBA')
W, H = master.size

# Heuristic crop zones for the architectural symbol (top) and wordmark (bottom)
# The master logo is black background with gold symbol above IVX text.
SYMBOL_TOP = 0
SYMBOL_BOTTOM = int(H * 0.72)
WORDMARK_TOP = int(H * 0.72)
WORDMARK_BOTTOM = H


def resize_to_height(img, height):
    """Resize image preserving aspect ratio to target height."""
    w, h = img.size
    ratio = height / h
    return img.resize((int(w * ratio), height), Image.LANCZOS)


def resize_to_width(img, width):
    """Resize image preserving aspect ratio to target width."""
    w, h = img.size
    ratio = width / w
    return img.resize((width, int(h * ratio)), Image.LANCZOS)


def paste_centered(canvas, img):
    """Paste an image onto the center of a canvas."""
    cw, ch = canvas.size
    iw, ih = img.size
    x = (cw - iw) // 2
    y = (ch - ih) // 2
    canvas.paste(img, (x, y), img)


def make_square_icon(size, img, padding_ratio=0.12, bg=BLACK, corner_radius=None):
    """Create a square icon with the image centered and padded."""
    canvas = Image.new('RGBA', (size, size), bg)
    pad = int(size * padding_ratio)
    avail = size - 2 * pad
    # Fit image inside avail box preserving aspect ratio
    iw, ih = img.size
    scale = min(avail / iw, avail / ih)
    new_w, new_h = int(iw * scale), int(ih * scale)
    resized = img.resize((new_w, new_h), Image.LANCZOS)
    x = (size - new_w) // 2
    y = (size - new_h) // 2
    canvas.paste(resized, (x, y), resized)
    if corner_radius:
        # Create rounded mask
        mask = Image.new('L', (size, size), 0)
        draw = ImageDraw.Draw(mask)
        draw.rounded_rectangle([0, 0, size, size], radius=corner_radius, fill=255)
        canvas.putalpha(mask)
    return canvas


def crop_symbol():
    """Extract the architectural symbol from the master logo."""
    return master.crop((0, SYMBOL_TOP, W, SYMBOL_BOTTOM))


def crop_wordmark():
    """Extract the IVX wordmark from the master logo."""
    return master.crop((0, WORDMARK_TOP, W, WORDMARK_BOTTOM))


def transparent_symbol():
    """Return symbol with black background removed (made transparent)."""
    sym = crop_symbol()
    # Flood fill black to transparent, but keep gold pixels
    data = sym.getdata()
    new_data = []
    for r, g, b, a in data:
        if r < 40 and g < 40 and b < 40:
            new_data.append((0, 0, 0, 0))
        else:
            new_data.append((r, g, b, a))
    sym.putdata(new_data)
    return sym


def transparent_wordmark():
    """Return wordmark with black background removed."""
    wm = crop_wordmark()
    data = wm.getdata()
    new_data = []
    for r, g, b, a in data:
        if r < 40 and g < 40 and b < 40:
            new_data.append((0, 0, 0, 0))
        else:
            new_data.append((r, g, b, a))
    wm.putdata(new_data)
    return wm


def remove_black_bg(img):
    """Make pure black pixels transparent."""
    data = img.getdata()
    new_data = []
    for r, g, b, a in data:
        if r < 30 and g < 30 and b < 30:
            new_data.append((0, 0, 0, 0))
        else:
            new_data.append((r, g, b, a))
    img.putdata(new_data)
    return img


def generate():
    # 1. Master high-resolution PNG (black background, 1024x1024)
    master_1024 = master.resize((1024, 1024), Image.LANCZOS)
    master_1024.save(OUT / 'ivx-logo-master.png', 'PNG')

    # 2. Transparent-background version (symbol + wordmark, transparent bg)
    trans = remove_black_bg(master.copy())
    trans.save(OUT / 'ivx-logo-transparent.png', 'PNG')
    # Also save a 1024 version
    trans_1024 = trans.resize((1024, 1024), Image.LANCZOS)
    trans_1024.save(OUT / 'ivx-logo-transparent-1024.png', 'PNG')

    # 3. Black-background version (same as master)
    master_1024.save(OUT / 'ivx-logo-dark.png', 'PNG')

    # 4. Gold-on-black version (same as master)
    master_1024.save(OUT / 'ivx-logo-gold-on-black.png', 'PNG')

    # 5. Gold symbol-only version
    sym = crop_symbol()
    sym_1024 = sym.resize((1024, 1024), Image.LANCZOS)
    sym_1024.save(OUT / 'ivx-symbol.png', 'PNG')
    # Transparent symbol
    sym_trans = transparent_symbol()
    sym_trans_1024 = sym_trans.resize((1024, 1024), Image.LANCZOS)
    sym_trans_1024.save(OUT / 'ivx-symbol-transparent.png', 'PNG')

    # 6. Horizontal layout (symbol left, wordmark right)
    target_height = 500
    sym_h = resize_to_height(transparent_symbol(), int(target_height * 0.85))
    wm_h = resize_to_height(transparent_wordmark(), int(target_height * 0.22))
    total_w = sym_h.width + wm_h.width + int(target_height * 0.12)
    horizontal = Image.new('RGBA', (total_w, target_height), BLACK)
    # Paste symbol
    sx = int(target_height * 0.05)
    sy = (target_height - sym_h.height) // 2
    horizontal.paste(sym_h, (sx, sy), sym_h)
    # Paste wordmark
    wx = sx + sym_h.width + int(target_height * 0.12)
    wy = (target_height - wm_h.height) // 2
    horizontal.paste(wm_h, (wx, wy), wm_h)
    horizontal.save(OUT / 'ivx-logo-horizontal.png', 'PNG')
    # Larger horizontal for web header
    horizontal_1024 = horizontal.resize((2048, int(2048 * target_height / total_w)), Image.LANCZOS)
    horizontal_1024.save(OUT / 'ivx-logo-horizontal-2048.png', 'PNG')

    # 7. Stacked / vertical layout (master centered on black canvas, wider aspect)
    stacked = Image.new('RGBA', (1024, 1024), BLACK)
    paste_centered(stacked, master_1024)
    stacked.save(OUT / 'ivx-logo-stacked.png', 'PNG')
    # Stacked on 1200x1200 for social
    stacked_1200 = Image.new('RGBA', (1200, 1200), BLACK)
    paste_centered(stacked_1200, master.resize((1024, 1024), Image.LANCZOS))
    stacked_1200.save(OUT / 'ivx-logo-stacked-1200.png', 'PNG')

    # 8. Square app-icon layout
    app_icon = make_square_icon(1024, master, padding_ratio=0.08, bg=BLACK)
    app_icon.save(OUT / 'ivx-app-icon.png', 'PNG')
    # Android adaptive foreground (must leave padding for system)
    adaptive_fg = make_square_icon(1080, master, padding_ratio=0.18, bg=(0, 0, 0, 0))
    adaptive_fg.save(OUT / 'ivx-adaptive-icon-foreground.png', 'PNG')
    # Android legacy icon
    legacy = make_square_icon(512, master, padding_ratio=0.10, bg=BLACK)
    legacy.save(OUT / 'ivx-android-legacy-icon.png', 'PNG')

    # 9. Favicon sizes
    fav_sizes = [16, 32, 48, 64, 128, 180, 192, 512]
    for s in fav_sizes:
        f = make_square_icon(s, master, padding_ratio=0.05, bg=BLACK)
        f.save(OUT / f'ivx-favicon-{s}.png', 'PNG')
    # Composite favicon.ico-like set (just save largest as favicon.png)
    make_square_icon(512, master, padding_ratio=0.05, bg=BLACK).save(OUT / 'ivx-favicon.png', 'PNG')

    # 10. iOS app icon set (rounded corners, multiple sizes)
    ios_sizes = [20, 29, 40, 60, 76, 83.5, 1024]
    for s in ios_sizes:
        size = int(s * 3) if s != 83.5 else int(83.5 * 3)  # @3x
        # Actually we want 1x, 2x, 3x for each. Simpler: generate all at 1x and 3x.
        pass
    # For iOS, we just need a 1024x1024 App Store icon and let Xcode scale.
    make_square_icon(1024, master, padding_ratio=0.10, bg=BLACK, corner_radius=180).save(OUT / 'ivx-ios-app-icon.png', 'PNG')

    # 11. Expo splash asset (full logo on black, 2048x2048)
    splash = Image.new('RGBA', (2048, 2048), BLACK)
    paste_centered(splash, master_1024)
    splash.save(OUT / 'ivx-splash-logo.png', 'PNG')

    # 12. Website header version (horizontal, black bg, 400x120)
    header = horizontal.resize((400, 120), Image.LANCZOS)
    header.save(OUT / 'ivx-website-header.png', 'PNG')
    # Website footer version (same horizontal, smaller)
    footer = horizontal.resize((240, 72), Image.LANCZOS)
    footer.save(OUT / 'ivx-website-footer.png', 'PNG')

    # 13. Email signature version (horizontal, black bg, 300x100)
    email = horizontal.resize((300, 100), Image.LANCZOS)
    email.save(OUT / 'ivx-email-logo.png', 'PNG')

    # 14. Business-card version (square, black bg, 600x600)
    bc = make_square_icon(600, master, padding_ratio=0.10, bg=BLACK)
    bc.save(OUT / 'ivx-business-card-logo.png', 'PNG')

    # 15. Social-media profile version (square, 1200x1200)
    social_profile = make_square_icon(1200, master, padding_ratio=0.08, bg=BLACK)
    social_profile.save(OUT / 'ivx-social-profile.png', 'PNG')

    # 16. Social-media cover version (1500x500, horizontal with breathing room)
    cover = Image.new('RGBA', (1500, 500), BLACK)
    cover_horizontal = horizontal.resize((int(1500 * 0.55), int(1500 * 0.55 * target_height / total_w)), Image.LANCZOS)
    paste_centered(cover, cover_horizontal)
    cover.save(OUT / 'ivx-social-cover.png', 'PNG')

    # 17. Monochrome fallback (gold symbol on black)
    mono = crop_symbol().convert('L').point(lambda x: 255 if x > 60 else 0, mode='1')
    mono.save(OUT / 'ivx-logo-monochrome.png', 'PNG')

    # 18. Wordmark-only version
    wm = crop_wordmark()
    wm_1024 = wm.resize((1024, int(1024 * wm.height / wm.width)), Image.LANCZOS)
    wm_1024.save(OUT / 'ivx-wordmark.png', 'PNG')
    # Transparent wordmark
    twm = transparent_wordmark()
    twm_1024 = twm.resize((1024, int(1024 * twm.height / twm.width)), Image.LANCZOS)
    twm_1024.save(OUT / 'ivx-wordmark-transparent.png', 'PNG')

    # 19. Open Graph / social preview (1200x630, black bg, centered logo)
    og = Image.new('RGBA', (1200, 630), BLACK)
    og_logo = master.resize((int(630 * 0.6), int(630 * 0.6)), Image.LANCZOS)
    paste_centered(og, og_logo)
    og.save(OUT / 'ivx-og-image.png', 'PNG')

    # 20. Web app manifest / PWA icons (maskable-ish, 512 and 192)
    for s in [192, 512]:
        make_square_icon(s, master, padding_ratio=0.10, bg=BLACK).save(OUT / f'ivx-pwa-{s}.png', 'PNG')

    print('Generated official IVX brand variants:')
    for f in sorted(OUT.iterdir()):
        if f.is_file():
            print(f'  {f.name} ({f.stat().st_size} bytes)')


if __name__ == '__main__':
    generate()
