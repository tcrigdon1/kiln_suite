# Changelog

## 1.0.0 — 2026-10-30 — first public release

The first release of the Kiln Suite: **Gesso** (layered image editor) and **Cutline** (multitrack video editor), under the MIT License.

### Highlights
- Windows icons (`Gesso/gesso.ico`, `Cutline/cutline.ico`) and a one-click desktop/Start-menu shortcut installer (`tools/Create Desktop Shortcuts.bat`) that opens each app as its own window.
- Both apps run from a folder in Chrome or Edge with no build step and no dependencies.
- Shared `imagefx.js` (22 adjustments, 58 filters) and `animenc.js` (GIF/APNG) libraries.
- Playwright end-to-end suites for both apps (`npm test`), made portable in this release (`_tests/env.js`, `_tests/run.js`, `_tests/make-media.sh`).

### Gesso
- Document model with sparse layer storage (layers and masks are only as large as their content).
- Pixel, text, shape, adjustment, group and embedded-object layers; masks, clipping masks, Blend If, layer styles, Layer Comps, Smart Filters.
- Selection tools including Magnetic Lasso, Select Subject, Refine Edge and Quick Mask.
- Brush engine with pressure, stabilizer, symmetry, jitter, wet edges; History Brush, Color Replacement, Pattern Stamp, Flow Warp, Patch Fill, Remove.
- Free Transform with perspective, Mesh Warp, Content-Aware Scale, Perspective Crop, Straighten, Auto-Align Layers, Merge Exposures, Apply Image.
- Filter Gallery, LUT import/export (.cube and HALD), Histogram and Palette panels, Make Seamless.
- Type: paragraph/point text, text on a path, Text Warp, Convert Text to Shape. Vector: per-corner radius, gradients, Align/Distribute, Combine Shapes, SVG import/export.
- Frame animation with tweening; GIF/APNG/WebM export.
- Actions and batch processing, Contact Sheet, Data-Driven Export, Export Layers/Comps, export presets, Command Palette, Welcome Tour, Display P3 option.

### Cutline
- Multitrack timeline with ripple/roll/slip/slide trimming, nested and multicam sequences, subclips, speed ramps, markers, duration target.
- 70+ GPU effects and 30+ transitions, masks with tracking, Track Matte Key, Censor Region, Steady Cam, effect presets, Graph Editor with bezier easing.
- Color grading with wheels/curves, HSL Secondary, Match Color, scopes, .cube LUT in and out.
- Audio mixer with EQ, compressor, gate, de-esser, limiter, spectral Noise Reduction, Voice Polish, Normalize Loudness, auto-ducking, master limiter, Audio Spectrum generator.
- Title designer with templates and animations, caption import/export and styling, timecode burn-in.
- Export via WebCodecs (WebM, MP4, GIF, WAV, PNG, contact sheet) with hardware encoders when available, delivery presets, batch queue, render cache, EDL and FCP 7 XML interchange, marker import.
- Remove Silences, Detect Scene Cuts, Split at Markers, Find Problem Frames, Pop Out Program Monitor.
- Long-file support: 10-hour recordings, streamed audio, background waveforms, proxies.

### Fixed in the release pass
- The image editor was renamed from Strata to **Gesso** before release to steer clear of an existing graphics-software mark; `.kstrata` projects still open and are saved as `.kgesso`.
- Gesso context menus could trigger their first item on the right-button release (platforms that fire `contextmenu` on mousedown); the Command Palette in Cutline now registers as a dialog; Cutline's Match Frame no longer crashes on a nested sequence.
- View-menu toggles in Cutline now show their check mark (a shared `CMD.menuItem` builder carries `checked` for every registered command).
- Gesso shortcut matcher canonicalises modifier order; the Clipping Warning shortcut no longer collides with Close All (it is now Ctrl+Alt+Shift+H).
- Brush strokes after rotate/flip no longer paint through a stale canvas transform.
- Magnetic Lasso works on a bounded, reduced-resolution cost map so a far cursor cannot freeze the page.
- Panel layout no longer corrupts when an unknown panel id is shown.
