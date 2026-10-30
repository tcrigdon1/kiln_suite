# Kiln Suite

Kiln Suite is two free, open-source creative apps written from scratch in plain JavaScript and run straight from a folder in your browser: **Gesso**, a layered raster image editor, and **Cutline**, a multitrack non-linear video editor. Their workflows will feel familiar if you have used the mainstream image and video editors — layers, masks and adjustment layers on one side; a source/program monitor, a track-based timeline and an inspector on the other — but every line of code, every icon, the theme and the file formats are original.

> Kiln Suite is an independent project. It is not affiliated with, endorsed by or sponsored by Adobe Inc. "Photoshop" and "Premiere Pro" are trademarks of Adobe Inc. and are mentioned here only to describe the kind of workflow the apps follow.

There is nothing to install and no server: open `index.html`, and your files never leave your computer.

![Gesso](docs/gesso.png)

![Cutline](docs/cutline.png)

> Status: **1.0**. Both apps are feature-complete for everyday work and every feature below is covered by the end-to-end test suites, but this is a first public release — expect rough edges on unusual media and please report what you find (see [Contributing](#contributing)).

## Contents

- [Quick start](#quick-start)
- [What's in the box](#whats-in-the-box)
- [Gesso — features](#gesso--features)
- [Cutline — features](#cutline--features)
- [Keyboard reference](#keyboard-reference)
- [File formats](#file-formats)
- [Browser support and hardware](#browser-support-and-hardware)
- [Architecture](#architecture)
- [Tests](#tests)
- [Roadmap and known limits](#roadmap-and-known-limits)
- [Contributing](#contributing)
- [License](#license)

## Quick start

1. Download the [latest release](https://github.com/tcrigdon1/kiln_suite/releases) or clone this repository.
2. Double-click `Gesso/index.html` or `Cutline/index.html`.
3. Use **Chrome or Edge**. They have the best support for pen pressure, saving files in place (File System Access API) and hardware video encoding. See [Browser support](#browser-support-and-hardware) for what Firefox and Safari can and cannot do.

**Windows shortcuts:** double-click `tools\Create Desktop Shortcuts.bat` to get **Gesso** and **Cutline** on your desktop with their own icons. They open in Chrome or Edge as standalone windows — no tabs, no address bar, their own taskbar entries. Add `-StartMenu` on the command line for Start-menu entries as well. Nothing is written to the registry; the shortcuts point at the `index.html` files, so run it again if you move the folder.

The apps are plain HTML, CSS and JavaScript with no build step: edit a file, refresh the tab.

### Shortcuts the browser keeps for itself
Chrome and Edge reserve **Ctrl+N, Ctrl+T, Ctrl+W and Ctrl+Tab**, so the apps use alternatives:
- Gesso: **Ctrl+Alt+N** new document · **Ctrl+Alt+T** free transform · **Ctrl+Alt+W** close.
- Cutline: **Ctrl+Alt+N** new project · **Ctrl+Alt+Shift+N** new sequence · **Ctrl+Alt+T** new title at the playhead.

Every shortcut can be rebound in **Help ▸ Keyboard Shortcuts** (F1). Gesso's **View ▸ Full Screen** (F11) uses the Keyboard Lock API, so in full screen the browser's own shortcuts reach the app and Ctrl+T / Ctrl+N / Ctrl+W work as expected.

## What's in the box

```
Gesso/      the image editor — index.html, css/, js/ (≈ 60 files)
Cutline/    the video editor — index.html, css/, js/ (≈ 65 files)
shared/     theme.css (the common look), imagefx.js (81 adjustments and filters, used by both apps),
            animenc.js (GIF and APNG encoders)
tools/      Windows shortcut installer (.bat + .ps1)
docs/       screenshots
_tests/     Playwright end-to-end suites — 103 scripts that drive both apps with real mouse and keyboard input
```

By the numbers: Gesso has 44 tools, 207 commands, 18 panels and 81 adjustments/filters; Cutline has 11 timeline tools, 164 commands, 69 effects (57 picture, 12 audio), 33 transitions and 8 generators. Everything is reachable from the menus, the Command Palette (Ctrl+Shift+K in Gesso, Ctrl+Shift+P in Cutline) or a shortcut.

## Gesso — features

**Documents and layers**
- Any size and DPI, sRGB or Display P3, multiple documents in tabs; autosave with crash recovery, recent files, save-in-place.
- **Layer types**: pixel, text, shape (vector), adjustment, group (pass-through or isolated), embedded object (keeps the original pixels so repeated scaling never degrades), with per-layer opacity, fill opacity, 17 blend modes (Normal, Dissolve, Darken, Multiply, Color Burn, Lighten, Screen, Color Dodge, Overlay, Soft Light, Hard Light, Difference, Exclusion, Hue, Saturation, Color, Luminosity), and lock pixels / position / alpha.
- **Masks**: pixel masks with density and feather, "paint on mask" mode, clipping masks, **Blend If** (This Layer / Underlying on Gray, R, G or B with split handles), Quick Mask.
- **Layer Styles / Effects**: Drop Shadow, Inner Shadow, Outer Glow, Inner Glow, Stroke, Color Overlay, Gradient Overlay — stacked, editable and cached per layer.
- **Smart Filters**: a non-destructive filter stack with its own mask on embedded objects.
- **Layer Comps** (named visibility/position/appearance snapshots), **Layers panel filter** (by name or kind), Lock All, Stamp Visible, Trim Layer to Canvas, sparse layer storage (layers are only as large as their content; pixels moved off-canvas are kept).
- **Channels** and **Paths** panels; **History** panel with snapshots (also the source for the History Brush); **Performance** panel showing memory per layer.

**Selection**
- Rectangular and elliptical marquee, Lasso, Polygonal Lasso, **Magnetic Lasso** (live-wire edge snapping), Magic Wand, Select Brush, Color Range, **Select Subject**, **Refine Edge**, Quick Mask (Q).
- Feather, expand/contract, smooth, border, grow, similar, inverse, reselect, transform selection, save/load selections as channels.

**Painting and retouching**
- Pressure-sensitive **brush engine** (size, hardness, flow, opacity, spacing, angle/roundness, scatter, color and size jitter, wet edges, airbrush build-up, smoothing/stabilizer, symmetry painting), brush presets, **Define Brush** and **Define Pattern** from a selection.
- Brush, Pencil, Eraser, Paint Bucket, Gradient (linear, radial, angle, reflected, diamond, with an editor), Clone Brush, **Pattern Stamp**, **History Brush**, **Color Replacement**, Heal Brush, Spot Heal, **Remove** (lasso an object away), **Patch**, Smudge, Blur, Sharpen, Dodge, Burn, Sponge, **Flow Warp** (push, bloat, pinch, twirl).
- **Patch Fill** (fill a selection from its surroundings), Fill with foreground/background/pattern/content, Stroke selection.

**Transform and geometry**
- Free Transform with scale, rotate, skew, distort and **perspective**; **Mesh Warp**; numeric transform.
- Crop, **Perspective Crop** (rectify a skewed surface), **Straighten Image / Straighten Layer** from the Ruler tool, Image Size with resampling choices, Canvas Size, rotate and flip canvas, Trim.
- **Content-Aware Scale** (seam carving, with selection and skin-tone protection), **Auto-Align Layers**, **Merge Exposures** (exposure fusion), **Apply Image** (blend a layer or channel onto another).

**Color, adjustments and filters** (`shared/imagefx.js`)
- 22 adjustments as adjustment layers or direct edits: Brightness/Contrast, Levels, Curves, Exposure, Hue/Saturation, Color Balance, Vibrance, Black & White, Photo Filter, Channel Mixer, Invert, Posterize, Threshold, Gradient Map, Selective Color, Shadows/Highlights, Film Looks, Temperature/Tint, Desaturate, Auto Tone / Contrast / Color, plus **Match Color**, **Dehaze**, **Local Tone Mapping**, **Depth Blur** and an all-in-one **Develop** adjustment.
- 58 filters in a **Filter Gallery** with live preview: blurs (Gaussian, Box, Motion, Radial, Bokeh, Surface, Tilt-Shift), sharpen (Sharpen, Unsharp Mask, High Pass, Clarity), noise (Add Noise, Median, Dust & Scratches, Reduce Noise), stylize (Emboss, Find Edges, Glowing Edges, Solarize, Diffuse, Oil Paint, Posterize Edges, Wind, Tiles), distort (Twirl, Pinch, Spherize, Ripple, Wave, Polar Coordinates, ZigZag, Turbulence, Lens Correction), pixelate (Mosaic, Crystallize, Pointillize, Color Halftone, Mezzotint), render (Clouds, Difference Clouds, Vignette, Lens Flare), artistic (Cartoon, Pencil Sketch, Watercolor, Film Grain, Chromatic Aberration, Glitch, Duotone, CRT / Scanlines), channel ops, Offset, Maximum/Minimum, **Custom Kernel**, **Make Seamless**, **LUT** (.cube).
- **Histogram** panel (RGB / luminosity / per channel, log scale, clipping %, statistics), **Palette** panel (dominant colours, export as .gpl / CSS / JSON), clipping and gamut warnings, grayscale proof, Color and Swatches panels with recent colours, eyedropper with sample sizes.

**Type and vectors**
- Point and paragraph text, fonts from the system (local font access when the browser allows it), weight, italic, size, leading, tracking, underline, strike, caps and small caps, justify, faux italic; **text on a path or circle**, **Text Warp** presets (arc, bulge, flag, wave, …), **Convert Text to Shape**.
- Shapes: rectangle, rounded rectangle (per-corner radius), ellipse, polygon, star, line, custom shape, Pen and Node Selection; fills and strokes with solid colours or gradients, editable rotation, **Align / Distribute**, **Combine Shapes** (union, subtract, intersect, exclude), radial repeat, SVG import and export.

**Animation and automation**
- **Animation panel**: frame animation built from layer states, per-frame delay, tweening of position and opacity, playback in the canvas; export as **GIF**, **APNG** or **WebM**.
- **Actions** (record, play, batch over files or open documents), **Contact Sheet**, **Data-Driven Export** (one image per CSV row), **Export Layers / Layer Comps to files**, export presets (several sizes and formats in one go), **Color Look** export as .cube LUT or HALD image, Quick Export as PNG, Print.
- Workspace: dockable panels, saved layouts, Customize Toolbar, Command Palette, Welcome Tour, rulers, grid, guides and guide layouts, snapping, pixel grid, navigator, Hide Panels (Tab), full screen.

## Cutline — features

**Projects and media**
- Projects with multiple sequences, folders in the Library, project templates, merge another project, autosave versions, Project Manager (unused media, consolidate), relink by name or by hand.
- Import video, audio and images by drag and drop or the file picker; **10-hour recordings import in seconds** with streamed audio and background waveform generation; **proxies** (create per clip, toggle Use Proxies, export full-res); subclips; Find Highlights (loudness peaks).
- Generators: Title, Solid Color, Gradient, Adjustment Clip, Bars & Tone, Countdown, Timecode Burn-in, **Audio Spectrum**.

**Timeline and editing**
- Unlimited video and audio tracks, lock / mute / solo / hide, track targeting, snapping, linked selection, clip colours and notes, markers with colours and durations, sequence and clip markers, duration target.
- Tools: Selection, Track Select Forward, Ripple, Rolling, Rate Stretch, Razor, Slip, Slide, Hand, Zoom, Text.
- Three-point editing with Insert and Overwrite from the Source monitor, Lift and Extract, ripple delete, close gaps, split at playhead / all tracks / **at markers**, extend edit, nudge, trim to playhead, match frame, replace with library item, copy/paste attributes, freeze frame, speed/duration with reverse and pitch preservation, **speed ramps** with frame blending, **nested sequences**, **multicam** (sync by audio or markers, live grid cutting with the number keys, flatten).
- **Remove Silences**, **Detect Scene Cuts**, **Find Problem Frames** (gaps, flash frames, black stretches), **Align Clip Marker to Playhead** (sync a music drop to a picture beat), Beat / Transient Markers, marker import from CSV, YouTube chapters or plain timecode lists.

**Picture**
- **57 GPU effects** (WebGL 2, with a Canvas 2D fallback): colour (Brightness & Contrast, Exposure, Saturation & Vibrance, Hue Shift, Temperature & Tint, Lift/Gamma/Gain, Curves, Levels, Black & White, Sepia, Invert, Posterize, Duotone, Color Replace, **HSL Secondary**, **Color Match**, Thermal Camera), looks (Film Look, **Halation / Bloom**), blur and sharpen (Gaussian, Directional, Radial Zoom, Sharpen, Tilt-Shift, Glow, Soft Focus Glow, Radial Focus), stylize (Vignette, Film Grain, Chromatic Aberration, Glitch, Pixelate, Mirror, Kaleidoscope, Edge Detect, Emboss, Halftone Dots, Retro Scanlines, **RGB Split**, **Lens Flare**, **VHS Look**, **Cel Shade**, **Old Film**), distort (Lens Distortion, Wave Warp, Twirl, Bulge / Pinch, Camera Shake), keying (Chroma Key, Luma Key, Crop & Feather, Shape Mask, **Track Matte Key**), layer (Drop Shadow, Outline / Stroke, Letterbox Bars, Frame Fade).
- **33 transitions**: dissolves (Cross, Dip to Black / White / Color, Additive, Film, Luma Fade, Blur, **Light Leak**, **Film Burn**, **Ink Bleed**), wipes (Wipe, Barn Doors, Clock, Iris Round, Iris Box, Checker, **Page Turn**), motion (Slide, Push, Whip Pan, Zoom In, Zoom Out, Spin, **Cube Rotate**, **Zoom Swish**), stylized (Glitch Cut, Pixel Dissolve, Flash Cut, Ripple Morph) and three audio crossfades.
- Transform (position, scale, rotation, anchor, opacity, blend mode, flip, crop) and every effect parameter are **keyframable**, with easing presets (linear, ease in/out, smooth, snappy, overshoot, bounce, elastic, hold) and a **Graph Editor** with custom bezier curves; **masks** with feather, per-point animation and **motion tracking**; **Censor Region** (pixelate / blur / box that follows a subject); **Steady Cam** stabilization; **effect presets** (save, apply, import/export).

**Color**
- Grading panel with exposure, contrast, highlights/shadows/whites/blacks, temperature/tint, saturation/vibrance, **colour wheels** (lift/gamma/gain), **curves**, HSL Secondary, Match Color, Pick Neutral white balance, **scopes** (waveform, vectorscope, histogram, false color), .cube LUT import per clip or on an adjustment clip, **Export Grade as .cube LUT**.

**Audio**
- Mixer with per-track gain, pan, mute, solo and meters, master meter and **master limiter**; per-clip gain, fades, and effects.
- 12 effects: 3-Band EQ (with a draggable graph), Compressor, Reverb, Echo / Delay, High-Pass, Low-Pass, Telephone, Saturation / Drive, De-esser, Limiter, **Noise Reduction** (adaptive spectral denoiser), Noise Gate.
- **Voice Polish** one-click dialogue chain, **Normalize Loudness** (LUFS targets), **auto-ducking** of music under speech, audio scrubbing, source-monitor waveform, **voiceover recording** from the microphone, Audio Spectrum generator that reacts to the track under it.

**Titles and captions**
- Title designer with text and shape layers, fonts from the system, gradients, strokes, shadows, boxes, per-layer and **per-word / per-character animations**, progress bars, timecode burn-in; 11 presets (lower third, end credits roll, kinetic word pop, chapter card, …) and reusable **templates with fill-in fields**.
- Captions lane with SRT import and export, caption style presets, show/hide per sequence, YouTube chapter export from markers.

**Export and interchange**
- **WebCodecs export** to WebM (VP9 / VP8 / AV1), MP4 (H.264 / HEVC / AV1 when the browser can encode them), WAV, GIF, PNG frame and PNG sequence, contact sheet, SRT; delivery presets (YouTube 1080p / 4K, vertical short, podcast), estimated file size, in-to-out range, **batch export queue** that survives reloads, exports written straight to disk for long files.
- **Hardware encoders** (NVENC on GeForce, Quick Sync on Intel, AMF on Radeon) are requested first and software is the fallback; **Help ▸ GPU & Hardware Codecs** shows what your machine offers and the Export dialog says which encoder a format will get.
- **EDL (CMX 3600)** and **FCP 7 XML** export for handing a cut to another editor (clips, tracks, speed, markers; effects and transitions are not translated), render in-to-out preview cache, Pop Out Program Monitor for a second screen.

## Keyboard reference

The defaults — all rebindable in Help ▸ Keyboard Shortcuts (F1). Mac users: Ctrl is ⌘.

### Gesso

| Key | Action |
| --- | --- |
| Ctrl+Alt+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S | New / Open / Save / Save As |
| Ctrl+Alt+S, Ctrl+Alt+Shift+S | Export As… / Quick Export as PNG |
| Ctrl+Z, Ctrl+Shift+Z | Undo / Redo |
| Ctrl+Alt+T | Free Transform (Ctrl+Alt+Shift+T Mesh Warp) |
| Ctrl+J, Ctrl+Shift+J | New Layer via Copy / via Cut |
| Ctrl+G, Ctrl+Shift+G | Group / Ungroup layers |
| Ctrl+E, Ctrl+Shift+E | Merge Down / Merge Visible |
| Ctrl+Alt+G | Create / release clipping mask |
| Ctrl+] / Ctrl+[ (+Shift) | Bring forward / send backward (to front / back) |
| Ctrl+A, Ctrl+D, Ctrl+Shift+I | Select all / deselect / inverse |
| Shift+F6, Ctrl+Shift+F5 | Feather… / Patch Fill… |
| Q | Quick Mask |
| Ctrl+Alt+Shift+A | Select Subject |
| Ctrl+Alt+F | Repeat last filter (Ctrl+Alt+Shift+G Filter Gallery) |
| Ctrl+Alt+Shift+C | Content-Aware Scale |
| Ctrl+I, Ctrl+Shift+U, Ctrl+Shift+L | Invert / Desaturate / Auto Tone |
| Ctrl+0, Ctrl+1, Ctrl+= / Ctrl+- | Fit / 100 % / zoom in and out |
| Ctrl+R, Ctrl+', Ctrl+; | Rulers / Grid / Guides |
| Ctrl+H | Hide selection edges |
| X, D | Swap colours / default colours |
| [ ], Shift+[ ] | Brush size / hardness |
| Tab, F11 | Hide panels / full screen |
| Ctrl+Shift+K or F3 | Command Palette |
| V M L W C I G H Z B E S J R O Y T U P A | Tools — press again to cycle a group (Shift to go backwards) |

### Cutline

| Key | Action |
| --- | --- |
| Ctrl+Alt+N / Ctrl+O / Ctrl+S | New project / Open / Save |
| Ctrl+I, Ctrl+M | Import media / Export media |
| Space, J K L | Play-pause / shuttle |
| ← → (Shift) | Step 1 (5) frames; ↑ ↓ previous / next edit point |
| I, O, X, Alt+X | Mark In / Out / Clip / clear |
| , . | Insert / Overwrite from the Source monitor |
| ; ' | Lift / Extract In→Out |
| Ctrl+K, Ctrl+Shift+K | Split at playhead / all tracks |
| Q, W | Ripple trim start / end to playhead |
| E | Extend edit to playhead |
| Alt+← → (Shift) | Nudge clip 1 (5) frames |
| Ctrl+D, Ctrl+Shift+D | Default video / audio transition |
| Ctrl+R | Speed / Duration |
| Ctrl+L | Link / unlink |
| Ctrl+G | Nest selected clips |
| F | Match frame |
| M, Shift+M, Ctrl+Shift+M | Add marker / next / previous |
| 1–8 | Marker colour (multicam: cut to angle) |
| S | Snapping |
| = - \ | Zoom in / out / to fit |
| Ctrl+Alt+T | New title at the playhead |
| Ctrl+Alt+R | Render In to Out |
| Shift+0 | Multicam grid view |
| Ctrl+Shift+F | Full-screen preview |
| Ctrl+Shift+P or F3 | Command Palette |
| V A B N R C Y U H Z T | Tools: Selection, Track Select, Ripple, Rolling, Rate Stretch, Razor, Slip, Slide, Hand, Zoom, Text |

## File formats

| | Gesso | Cutline |
| --- | --- | --- |
| Project | `.kgesso` — JSON with the layer tree, masks, text, vectors, animation and history snapshots; pre-release `.kstrata` files still open | `.kcut` — JSON with sequences, clips, effects, keyframes, markers and captions; media is referenced by file name and relinked on open |
| Opens | PNG, JPEG, GIF, WebP, BMP, AVIF, SVG, `.cube` LUTs, `.gpl` palettes, CSV (data-driven export) | Anything the browser can decode: WebM, MP4/MOV, MKV, OGG, MP3, WAV, FLAC, AAC/M4A, Opus, PNG/JPEG/GIF/WebP, SRT, `.cube`, marker CSV |
| Exports | PNG, JPEG, WebP, SVG, GIF / APNG / WebM animation, `.cube` LUT, HALD PNG, `.gpl` / CSS / JSON palettes, print | WebM, MP4, WAV, GIF, PNG, PNG sequence, contact sheet, SRT, YouTube chapters, EDL, FCP 7 XML, `.cube` LUT, effect presets JSON |

Both project formats are documented at the top of `Gesso/js/app/fileio.js` and `Cutline/js/io/project-io.js` and are plain JSON you can read with any text editor.

## Browser support and hardware

| | Chrome / Edge (recommended) | Firefox | Safari |
| --- | --- | --- | --- |
| Editing, effects, playback | ✓ | ✓ | ✓ (WebGL 2) |
| Pen pressure and tilt | ✓ | ✓ | partial |
| Save in place (File System Access) | ✓ | downloads instead | downloads instead |
| Video export (WebCodecs) | ✓ | ✗ | partial (H.264 only) |
| Hardware encode/decode | ✓ | — | — |
| AudioWorklet effects (gate, limiter, denoise) | ✓ | ✓ | ✓ |
| Keyboard Lock in full screen | ✓ | ✗ | ✗ |

Cutline does its compositing on the GPU through WebGL 2 and falls back to Canvas 2D when WebGL is unavailable. Video decoding and encoding go through WebCodecs; **Edit ▸ Preferences ▸ Video codecs** chooses GPU-first (default), browser default or CPU only, and **Help ▸ GPU & Hardware Codecs** reports what the machine offers per codec and resolution. For NVENC on an RTX card export MP4 (H.264, HEVC or AV1 — VP9 encoding is CPU-only in Chrome); if everything shows "CPU only", check `chrome://gpu` → *Video Encode: Hardware accelerated* and your GPU driver.

Gesso works on 8-bit sRGB or Display P3 canvases; very large documents (above about 50 megapixels) are possible but depend on the browser's canvas memory limits.

## Architecture

Both apps are classic script-tag JavaScript: no modules, no bundler, no transpiler, no runtime dependencies, no CDN. Web Workers and AudioWorklets are created from Blob/data URLs so the apps keep working from `file://`.

```
Gesso/js/core      document model, layer tree, sparse canvases, compositor (dirty-rectangle, painting cache),
                   selection, paths, effects (layer styles), embedded objects, icons
Gesso/js/tools     one file per tool family: paint, select, transform, shapes, text, warp, meshwarp, measure, …
Gesso/js/ui        viewport, menus, panels (layers, properties, history, …), dialogs, colour picker, parameter UI
Gesso/js/app       commands and menus, file I/O, filters, vectors, animation, actions, automation, photomerge, LUTs

Cutline/js/core    util, bus, icons, GPU preferences
Cutline/js/model   project / sequence model, timeline operations, keyframes, history
Cutline/js/media   import, frame decoder (WebCodecs), demuxers, proxies, waveforms, streamed audio
Cutline/js/render  scene builder, GL compositor, 2D fallback, effects, transitions, titles, masks, tracker, spectrum
Cutline/js/playback engine (audio-clock driven), source providers, render cache
Cutline/js/audio   mixer, worklets, ducking, loudness
Cutline/js/ui      timeline, monitors, inspector, library, colour, audio panel, menus, commands, dialogs
Cutline/js/export  WebCodecs exporter, muxers, delivery presets, queue
Cutline/js/io      project files, EDL / XML interchange, marker import

shared/imagefx.js  adjustments and filters shared by both apps (pure functions over ImageData, worker-friendly)
shared/animenc.js  GIF (median-cut, dithering) and APNG encoders
shared/theme.css   the common look: colours, type, panels, menus, dialogs
```

Extension points are registries, so a feature is one file that registers itself: `S.Cmd.register` / `C.CMD.reg` for commands (menus, shortcuts and check marks come for free), `S.Tools.register`, `S.Panels.register`, `C.FX.reg` (an effect is a GLSL fragment plus a parameter list), `C.TR.reg`, `S.Filters`/`ImageFX.register`. Undo is snapshot-based in both apps (`doc.commit(name, fn)` in Gesso, `C.edit(name, fn)` in Cutline).

## Tests

The suites drive the real UI in headless Chromium through Playwright with mouse, keyboard and pen input; application state is read back but never written.

```
npm install          # Playwright + a Chromium build
npm run test:quick   # ~10-minute smoke pass over both apps
npm test             # all 103 scripts, run one at a time on purpose (2–3 h)
npm run test:media   # regenerates the one large test clip that is not kept in git (needs ffmpeg)
```
`_tests/README.md` lists the groups and how to run a single script. All test media is synthetic (ffmpeg test sources, generated images and tones).

## Roadmap and known limits

Planned follow-up work, roughly in order:

1. **Gesso**: view rotation; a GPU path for the compositor and the heaviest filters; 16-bit channels; ligature control (not possible with the browser's canvas text engine today); better tracing in Combine Shapes and Convert Text to Shape.
2. **Cutline**: dynamic (JKL) trimming; smoother reverse and fast shuttle on long-GOP files; keyframable audio effects; speech-to-text captions (needs a local model, which the no-dependency rule currently rules out); colour management for HDR sources.
3. **Both**: a plugin folder for third-party effects and tools; localisation; touch-screen layouts.

Known limits in 1.0: Firefox and Safari cannot export video (no WebCodecs); very long single-clip exports are limited by the browser's file-writing speed; EDL/XML export carries cuts and markers but not effects.

## Contributing

Bug reports, ideas and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first (plain JavaScript that runs from `file://`, tests for what you change, `npm run test:quick` before a PR), and please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

Kiln Suite is released under the [MIT License](LICENSE). © 2026 Thomas Rigdon.

Everything in this repository is original work: the application code, the `shared/` libraries, the icons, the theme, the project file formats, the screenshots in `docs/` and the test suites. No code was copied from other editors or libraries, and the apps load no third-party code at runtime.

- **Development dependency.** The test suites use [Playwright](https://playwright.dev) (Apache-2.0), installed by `npm install`; it is not part of the apps and is not distributed with them.
- **Test media.** Every clip, image and sound under `_tests/` is synthetic — ffmpeg test sources, generated images and tones — and is covered by the same MIT License; nothing is sampled from other works.
- **Fonts.** The apps use the fonts installed on your system and bundle none.
- **Trademarks.** "Kiln Suite", "Gesso" and "Cutline" are the names of this project. Adobe, Photoshop and Premiere Pro are trademarks of Adobe Inc.; NVENC and GeForce of NVIDIA Corporation; Quick Sync of Intel Corporation; Radeon and AMF of Advanced Micro Devices, Inc.; Chrome of Google LLC; Edge of Microsoft Corporation. They are mentioned only to describe compatibility and are not affiliated with this project.
