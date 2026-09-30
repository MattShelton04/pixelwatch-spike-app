# pixelwatch-spike-app

Throwaway spike for PixelWatch M0.5 (spikes S2, S4, S11). Not a product. Synthetic data only.
Do not depend on this repository.

- `.github/workflows/s4-*.yml`, `wrap.yml`: foreign callers of https://github.com/MattShelton04/pixelwatch-spike-lib
  pinned by full SHA. `actions/publish/` is a deliberate IMPOSTOR that must never run inside them.
- `.github/workflows/s2-pages.yml`, `scripts/`: synthetic GitHub Pages site, deploy and readiness polling.
- `.github/workflows/s11-*.yml`, `s11/`: same-repo PR identity recording (capture + workflow_run report).
