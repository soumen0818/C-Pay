# App color themes

C-Pay follows the operating-system light or dark appearance setting. `ThemeProvider`
uses React Native's `useColorScheme` and supplies the active semantic palette to
navigation and every screen. Component styles are created through
`createThemedStyles`, so an appearance change is applied without restarting the app.
For reusable components that may render outside a theme-aware screen, use the
`useThemedStyles(factory)` hook so the component subscribes directly to the active
palette and recreates its styles when the appearance changes.

All app colors must be defined in `App/src/constants/theme.ts`. UI code should use
semantic tokens such as `background`, `surface`, `surfaceElevated`, `textPrimary`,
`textMuted`, and `border` instead of literal color values.

## Contrast verification

The core text pairs were checked using the WCAG 2.x relative-luminance formula.
Ratios are rounded down to two decimals.

| Theme | Foreground | Background | Ratio | WCAG AA normal text |
| --- | --- | --- | ---: | --- |
| Light | `textPrimary` (`#111827`) | `surface` (`#FFFFFF`) | 17.74:1 | Pass |
| Light | `textMuted` (`#475569`) | `surface` (`#FFFFFF`) | 7.58:1 | Pass |
| Light | `textPrimary` (`#111827`) | `background` (`#F6F8FB`) | 16.67:1 | Pass |
| Light | `textInverse` (`#FFFFFF`) | `primary` (`#2563EB`) | 5.17:1 | Pass |
| Dark | `textPrimary` (`#F8FAFC`) | `surface` (`#111827`) | 16.96:1 | Pass |
| Dark | `textMuted` (`#CBD5E1`) | `surface` (`#111827`) | 11.95:1 | Pass |
| Dark | `textPrimary` (`#F8FAFC`) | `background` (`#0B1120`) | 18.00:1 | Pass |
| Dark | `textInverse` (`#FFFFFF`) | `primaryDark` (`#2563EB`) | 5.17:1 | Pass |

Borders and disabled controls are not used as the sole carrier of readable text.

## Readability and accessibility constraints

- Keep visible text at 11 points or larger. Hidden native input text may use a
  different size only when fully transparent and represented by a visible,
  accessible control.
- Use semantic theme tokens for text and surfaces. Check each foreground and
  background pair in both palettes; do not assume a light-mode color has enough
  contrast in dark mode.
- Give every icon-only or otherwise ambiguous touch target an accessibility label
  and role. Keep touch targets large enough to activate comfortably.
- Keep QR modules black on a fixed white background whenever QR sharing is added.

## Light/dark review checklist

- [ ] Review every changed screen in light mode.
- [ ] Review every changed screen in dark mode.
- [ ] Check text, icons, status colors, borders, and disabled states against their
  actual backgrounds.
- [ ] Confirm visible text is at least 11 points and touch targets have useful
  accessibility labels and roles.
