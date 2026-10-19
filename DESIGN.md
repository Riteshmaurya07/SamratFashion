# THREADVIBE Design System & Visual Authority

## Aesthetic Philosophy
- **Style**: Contemporary Indian Men's Streetwear & Editorial Fashion Lookbook.
- **Tone**: Bold, architectural, disciplined, confident, and merchandise-focused.
- **Anti-Patterns Banned**: No generic AI floating cards, no decorative colorful blobs, no glassmorphism on every surface, no `border-l-4` side-tabs, no tacky `animate-bounce`, and no unreadable low-contrast text.

## Color System
- **Ink Black (Primary Dark)**: `#09090b` (Deep ink black for high-impact typography, dark capsules, primary buttons, and navbar bar).
- **Surface & Background**:
  - `background`: `#fafafa` (Warm neutral paper tone)
  - `surface-container-lowest`: `#ffffff` (Card background & dialog surface)
  - `surface-container-low`: `#f5f5f7` (Secondary container)
  - `surface-container-high`: `#e4e5e8` (Badges, tags, and inputs)
- **Cobalt Accent**:
  - `primary`: `#0f4cd9` (Electric cobalt blue for interactive states, key CTAs, and active navigation)
  - `primary-container`: `#0f4cd9`
  - `primary-fixed-dim`: `#b4c5ff`
- **Neutral Boundaries & Text**:
  - `on-surface`: `#09090b` (High-contrast body text & display titles)
  - `on-surface-variant`: `#52525b` (Charcoal secondary copy)
  - `outline`: `#71717a` (Muted borders & icons)
  - `outline-variant`: `#e4e4e7` (Hairline architectural grid lines, 30–60% opacity)
  - `error`: `#dc2626` (Validation & cancellation states)
  - `success`: `#059669` (Delivered, in-stock, and discount badges)

## Typography Scale
- **Display & Headlines (`font-headline-lg`, `font-headline-sm`)**:
  - Font: `Hanken Grotesk` (`var(--font-hanken-grotesk)`), sans-serif.
  - Tracking: `-0.035em` for display uppercase, `-0.025em` for section titles.
  - Character: Bold architectural proportions inspired by modern Japanese & European streetwear publications.
- **Body & Information (`font-body-md`, `font-body-sm`)**:
  - Font: `Inter` (`var(--font-inter)`), sans-serif.
  - Tracking: `-0.011em` for clean readability across variant descriptions and size guides.
- **Technical Garment Specifications & Badges (`font-label-caps`)**:
  - Font: `JetBrains Mono` (`var(--font-jetbrains-mono)`), monospace.
  - Tracking: `0.08em` to `0.2em` uppercase letter-spacing for drop IDs (`DROP 01`), fabric weight (`240+ GSM`), pricing (`₹1,299`), and SKU codes.

## Component Principles
- **Buttons**:
  - Primary: Solid `#09090b` with crisp white text, slight hover shift to `#18181b`, rounded-md (`0.375rem`), font-mono text-xs uppercase.
  - Cobalt Accent: `#0f4cd9` for primary purchase actions (`BUY IT NOW`, `PLACE ORDER & PAY`).
  - Outline: Hairline border `border-outline-variant/60` with hover inversion.
- **Product Cards**:
  - Aspect ratio: Fixed 3:4 streetwear crop.
  - Imagery: Full-bleed primary image with smooth `group-hover:scale-105` zoom and secondary image cross-fade.
  - Metadata: Clean title, real variant tags (`240 GSM // HEAVYWEIGHT`), bold currency with verified discount chip, isolated wishlist heart toggle.
- **Elevation**:
  - Flat, border-driven layout with subtle hover elevation (`streetwear-card`).
  - Shadows restricted to `shadow-sm` and `shadow-[0_16px_36px_-12px_rgba(9,9,11,0.08)]`.
