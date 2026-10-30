# Contributing to Kiln Suite

Thanks for taking an interest. This is a small project with a few firm rules that keep it easy to run and hack on.

## Ground rules
- **Plain JavaScript, no build step.** Everything loads from `index.html` with classic `<script>` tags and runs from `file://`. No ES modules, no bundlers, no TypeScript, no CDN or npm runtime dependencies. Workers and AudioWorklets are created from Blob/data URLs for the same reason.
- **Chrome/Edge first, degrade gracefully.** Feature-detect (`window.VideoEncoder`, `navigator.keyboard.lock`, …) and fall back or disable the UI rather than throwing.
- **Original work only.** Don't paste in code from other editors or libraries; don't use other products' names, icons, terms or file formats in the UI. Comparisons in docs are fine.
- **Keep the style.** Two-space indent, single quotes, semicolons, small files with a comment block at the top saying what the file owns. Gesso uses modern syntax (`const`, arrows); Cutline is deliberately ES5-flavoured in older files — match the file you're in.

## Where things live
```
Gesso/js/core     document model, layers, compositor, history
Gesso/js/tools    one file per tool family (paint, select, transform, …)
Gesso/js/ui       panels, menus, dialogs, viewport
Gesso/js/app      commands, menus, file I/O, feature modules
Cutline/js/model   project/sequence model, timeline ops, keyframes
Cutline/js/render  GL compositor, effects, transitions, titles, masks
Cutline/js/playback, audio, media, export, io, ui
shared/            theme.css, imagefx.js, animenc.js — used by both apps
```
New features register themselves: a command with `S.Cmd.register` / `C.CMD.reg`, a panel with `S.Panels.register`, an effect with `C.FX.reg`, a tool with `S.Tools.register`. Menus are built from the command registry, so a registered command gets its shortcut, label and check mark for free.

## Making a change
1. Open the app, reproduce the problem or sketch the feature.
2. Make the change; reload the tab to see it.
3. Add or extend a test in `_tests/` (see `_tests/README.md`). The suites drive the real UI with mouse and keyboard, so a test for a menu item, a dialog or a tool is usually 20–40 lines using the existing helpers.
4. Run `npm run test:quick` (10 minutes). For anything touching the compositor, the timeline model or the brush engine, run the relevant full group too (`node _tests/run.js gesso-pass2`, `cutline-core`, …).
5. Open a pull request that says what changed and why, with a screenshot or GIF for anything visual.

## Reporting bugs
Please include: browser and version, operating system, GPU (Help ▸ GPU & Hardware Codecs in Cutline), the steps to reproduce, and — if the console shows an error — the message. For Cutline media problems, the file's codec/container from `ffprobe` or MediaInfo helps a lot.

## License
By contributing you agree that your contribution is licensed under the MIT License that covers the project.
