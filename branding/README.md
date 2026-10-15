# Kura Vault brand

A 蔵 (*kura*) is the thick-walled Japanese storehouse that kept a family's
valuables safe from fire and theft. The mark shows one from the gable end,
with a keyhole for a door.

Two details make it a kura and not a generic house with a lock: the curved
eaves, and the thin gap between the roof and the walls. That gap stands for
the kura's raised, ventilated outer roof (置き屋根, *okiyane*).

## Files

| File | Use |
|---|---|
| `logo-tile.svg` | Master app icon: off-white mark on a full indigo square |
| `logo-mark.svg` / `logo-mark-light.svg` | Bare mark, indigo or off-white, on a transparent background |
| `logo-mono.svg` | Single-colour mark, for one-colour printing and system tints |
| `logo-lockup.svg` / `logo-lockup-light.svg` | Mark with the "Kura Vault" wordmark, for light or dark backgrounds |
| `adaptive-foreground.svg` / `adaptive-monochrome.svg` | Android adaptive icon layers, sized for the 66 dp safe zone |
| `favicon.svg` | Rounded tile for browsers |
| `play-feature-graphic.svg` | Google Play feature graphic (1024 × 500) |
| `export/` | PNG renders of the above, plus the macOS icon, splash images and the GitHub social preview |
| `tools/` | The script that draws all of the above |

For Google Play, upload `export/play-icon-512.png` as the app icon and
`export/play-feature-graphic-1024x500.png` as the feature graphic. The icon is
a full square on purpose: Google Play adds the rounded corners and shadow. The
feature graphic has no alpha channel, as Play requires.

For the repository's social preview on GitHub, upload
`export/github-social-1280x640.png` under Settings → General → Social preview.

## Colour

| Name | Hex | Role |
|---|---|---|
| Aizome | `#233A5E` | Primary. Indigo dye (藍染) |
| Plaster | `#F2ECE1` | Mark on indigo. Lime-plastered walls |
| Ink | `#141A24` | Text, dark backgrounds |
| Aizome light | `#9FB4D6` | Accent on dark backgrounds |

Contrast: plaster on aizome 9.7:1, aizome on white 11.4:1, aizome light on
ink 8.3:1.

## Type

The wordmark is Inter SemiBold ([SIL Open Font License](https://openfontlicense.org)).
It is converted to outlines in the SVGs, so no font file ships with them.

## Usage

- Keep clear space around the mark equal to the height of the keyhole.
- Minimum size: 16 px for the tile, 24 px for the bare mark.
- Don't stretch, rotate or recolour the mark beyond the colours above. Don't
  add effects or put it on a busy photo.
- Don't remove the gap under the roof. It is what makes the mark recognisable.

## Regenerating

The mark is defined once, as geometry on a 1024 grid, in `tools/mark.mjs`.
`tools/build.mjs` draws every SVG and PNG here from it, and also writes the web
client's `favicon.svg` and `apple-touch-icon.png`.

1. Download [Inter 4.0](https://github.com/rsms/inter/releases/tag/v4.0) and
   copy `Inter-SemiBold.otf` and `Inter-Medium.otf` from `extras/otf/` into
   `tools/fonts/`.
2. In `tools/`, run `pnpm install` and then `pnpm build`.
3. Regenerate the app icons and splash screens. In `app/`, run
   `dart run flutter_launcher_icons` and then
   `dart run flutter_native_splash:create`.

The web client draws the mark inline in `web/src/components/brand/KuraMark.tsx`,
and the app draws it in `app/lib/core/widgets/kura_mark.dart`. If you change
the geometry, update both.

## Licence

The mark was drawn from scratch from basic geometric shapes. It uses no stock
or third-party artwork.

The artwork in this directory is released under the same MIT licence as the
rest of the repository. You may use it to refer to Kura Vault, for example in
articles, package listings or links to the project.

The name and logo identify the official project. Please don't use them in a
way that suggests a fork, a hosted service or another product is official or
endorsed by the Kura Vault authors.
