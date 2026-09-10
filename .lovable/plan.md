# Scanner and dashboard interface update

## What will change
- Replace the current six dashboard styles with four mobile layouts matching the requested structures: horizontal controls, hero with three controls, vertical side controls, and a tappable settings list.
- Keep the selected layout saved while moving between Home, MetaTrader, and Settings.
- Make Start and the floating robot control open a compact bottom pop-up instead of covering the whole app.
- Rebuild Chart Scanner as a visible sequence: uploaded chart preview, live-analysis checklist and progress, signal details, then a fixed Execute button.
- Keep execution disabled until a secure live-execution service is connected; never expose its private key in the app.

## Interface choices
The settings list will include the supplied names and map them across the three dashboard structures, with an Active indicator and immediate switching:
- Crimson Navigator
- Navigator Plus
- Pablo Crimson
- Pablo Elite
- Quantum Blue
- Darkweb AI
- Supreme Equinox
- Ultron Mega
- EA Cloud

## Technical details
- Update the saved layout model and remove old layout IDs from the selection screen.
- Recompose the Home route around three reusable dashboard structures and named visual presets.
- Add compact animated overlays with a dimmed backdrop that preserve the visible dashboard.
- Add deterministic scanner demo results and progress UI now; live signal analysis and order execution remain safely blocked until the execution provider and API details are supplied.
- Keep existing app sign-in, licensing, payment, robot, and MetaTrader state unchanged.

## Verification
- Check each layout selection persists without reloading.
- Check scanner upload → scan progress → signal details → execute state on mobile.
- Check Start/floating control overlays do not cover the full app.
- Confirm the app compiles and has no runtime errors.
