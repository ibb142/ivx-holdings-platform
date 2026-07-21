# IVX Global Brand Governance

**Effective:** 2026-07-21  
**Owner:** Ivan Perez (iperez4242@gmail.com)  
**Authority:** This document is the single source of truth for all IVX brand marks. Any deviation requires written owner approval.

## 1. Official Brand Mark

The only approved IVX logo is the owner-attached official mark:

- **Master file:** `expo/assets/images/ivx-logo-master.png` (1024×1024 PNG)
- **Fallback:** `expo/assets/images/ivx-logo-master.jpg` (500×500 JPG)
- **R2 archive:** `https://r2-pub.rork.com/attachments/fihl8u1x8zaj0lz8vc6nb.jpg`

No other logo, symbol, crown, wordmark, or illustration may be used to represent IVX Holdings, IVX IA, or any IVX product without owner approval.

## 2. Permitted Variants

All brand variants are generated from the master logo and stored in `expo/assets/images/`. They are loaded through the centralized `IVXBrandLogo` component or `expo/constants/brand.ts` tokens.

| Variant | Use case | Source |
|---|---|---|
| `ivx-logo-master.png` | Default, splash, icon | Master |
| `ivx-logo-symbol.png` | Favicon, small badges, app icon symbol | Derived from master |
| `ivx-logo-wordmark.png` | Documents, email headers | Derived from master |
| `ivx-logo-horizontal.png` | Navbars, landing header | Generated horizontal layout |
| `ivx-logo-stacked.png` | Business cards, social profiles | Generated stacked layout |
| `ivx-logo-transparent.png` | Overlays on dark backgrounds | Derived from master |
| `ivx-logo-dark.png` / `ivx-logo-light.png` | Theme-aware contexts | Derived from master |

## 3. Prohibited Uses

- Alternate logos, crowns, shields, or generic real-estate icons as brand marks.
- Text-only “IVX” or “IVXHOLDINGS” marks without the official symbol.
- Stretched, distorted, recolored, or cropped versions of the logo outside the approved variants.
- Rork, Lovable, or third-party co-branding marks on IVX surfaces.
- External hot-linked logo assets (use the local `expo/assets/images/` copies or owner-controlled S3 paths).

## 4. Color Tokens

Use only the official palette defined in `expo/constants/brand.ts` and `expo/constants/colors.ts`:

- `primaryBlack` — `#000000` (backgrounds, primary surfaces)
- `officialGold` — `#E6C200` (brand accents, emphasis)
- `secondaryGold` — `#FFD700` (highlights, CTAs)
- `goldLight` — `#FFF2A3` (subtle gold surfaces)
- `textWhite` — `#FFFFFF` (primary text on dark)
- `mutedGray` — `#909090` (secondary/muted text)

## 5. Implementation Rules

1. **Mobile app:** Always import the logo via `IVXBrandLogo` or `IVX_LOGO_SOURCE` from `@/constants/brand`. Never hardcode a remote URL.
2. **Landing page:** Use `/ivx-logo-master.png` (or the generated horizontal/stacked variant) served from the same S3 origin as the landing page. Update the S3 asset when the master logo changes.
3. **Documents / email:** Use `ivx-logo-wordmark.png` or `ivx-logo-horizontal.png`.
4. **App factory:** All new IVX apps must inherit the master logo and brand tokens from this repository. No custom logos may be generated without owner approval.
5. **QA:** Any screen added to the app must be checked against this document before release.

## 6. Change Control

- Any logo swap, color change, or new variant requires owner approval.
- Approved changes are committed to `expo/assets/images/`, `expo/constants/brand.ts`, `expo/components/IVXBrandLogo.tsx`, and this document.
- After a brand change, run the Brand Audit script (`expo/scripts/brand-audit.mjs`) and deploy the landing page + mobile app.

## 7. Brand Audit Script

`expo/scripts/brand-audit.mjs` scans the repository for:
- Old logo URLs (`pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev`)
- Crown icons (`Crown` from `lucide-react-native`)
- Hardcoded remote logo URLs
- Non-brand colors outside the approved palette

Run it before every release.

## 8. Contacts

- Owner: Ivan Perez <iperez4242@gmail.com>
- Brand implementation: IVX IA engineering team
- Escalation: Owner approval required for any exception.
