# Tests

End-to-end suites that drive Gesso and Cutline in headless Chromium through Playwright, using real mouse, keyboard and pen input wherever possible (application state is read back with `page.evaluate`, never written).

```
npm install                       # Playwright + a Chromium build
npm test                          # every group, one script at a time (2–3 h)
npm run test:quick                # smoke pass over both apps (~10 min)
node _tests/run.js gesso         # or cutline, or any group name
node _tests/run.js --list         # the groups
node _tests/gesso/pass3/anim.js  # one script (run it from anywhere)
```

Groups: `gesso-core` (smoke → monkey tests), `gesso-pass2` (edge cases, extremes, pen input, warps, export, round trips), `gesso-pass3` (newer features and a cross-feature chain), `gesso-handson`; `cutline-core` (model, shaders, decoding, export, menus), `cutline-pass2` (edges, media, A/V sync, playback, proxies, audio, color), `cutline-pass3` (auto-cut, keyframes, interchange, presets, spectrum, command sweep, chain), `cutline-handson` (library → export through the UI).

Scripts print `ok - …` / `ASSERT FAIL - …` lines and end with `PASS` or `FAILURES`; `run.js` also treats a non-zero exit, `TEST ERROR` or `pageerror` as a failure and writes the full output to `_tests/out/`. Screenshots go to each suite's `shots/` folder (git-ignored). Run scripts **sequentially** — the suites are CPU-heavy and parallel runs cause timing flakes that are not real bugs.

Media: everything the suites need is in the repo except `cutline/pass2/media/sync5m.webm` (≈60 MB) and the 10-hour long-form set; `npm run test:media` regenerates the former with ffmpeg and `bash _tests/make-media.sh --longform` the latter (≈7.5 GB, used only by `cutline/longform/`, which is not part of `npm test`). All test media is synthetic (ffmpeg test sources, generated images and tones).

Paths are resolved from `_tests/env.js`, so the checkout can live anywhere; temporary files go to `$TMPDIR/kiln-tests` (override with `KILN_TEST_TMP`).
