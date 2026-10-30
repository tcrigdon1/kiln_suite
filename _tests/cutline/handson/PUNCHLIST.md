# Cutline hands-on QA punch list

All of this was found by driving the app the way an editor would: real mouse drags (with intermediate moves), keyboard,
clicks on visible controls and menus, the visible import control's file chooser, and file drops onto the Library and
the timeline. Viewports were 1600×900 and 1366×768. Every step was screenshotted (`shots/`) and the screenshots were
checked by eye. Run the suite with `bash run-handson.sh`. It has 16 scripts and fails on any console error or page error.

Severity scale: **crash** > **broken** > **wrong** > **awkward** > **cosmetic**.

## Fixed

| # | What I did | What happened | Expected | Severity | Status |
|---|---|---|---|---|---|
| 1 | Dragged a clip sideways on V2 (or A2) | The clip dropped onto **V1**, overwrote what was there and cut the V1 clip in two. Any multi-step drag of a clip that isn't on the bottom track did this. Cause: the track offset was found by object identity, and live edits replace the project objects with clones. | The clip stays on its track | broken (data loss) | **fixed**: tracks are compared by id (`timeline-view.js` moveDrag; drop targets too) |
| 2 | Dropped a file from the OS onto the timeline | The file was imported **twice**. The window-level drop handler fired as well. | One import | broken | **fixed**: the timeline drop stops propagation |
| 3 | Dragged the fade-in handle (top-left corner) of an audio clip that had no fade | The clip **was trimmed** instead. Edge trimming always won over the fade handle. | A fade is created | broken | **fixed**: the fade handle wins in the top band of the audio body |
| 4 | Dragged a Color wheel (or added a curve point) on a clip with no grade yet | Hue/X/Y were written as **NaN**. The panel rebuilt itself mid-drag, so the drag kept writing through a detached canvas with a 0×0 rect. | The grade follows the drag | broken | **fixed**: a stable panel signature, plus guards against detached canvases |
| 5 | Pressed Ctrl+T / Ctrl+N (new title / new sequence) in Chrome or Edge | The browser keeps these keys, so nothing happened in the app | A working shortcut | broken | **fixed**: **Ctrl+Alt+T** new title at the playhead, **Ctrl+Alt+Shift+N** new sequence (**Ctrl+Alt+N** new project already existed). They show in the Sequence menu, Effects › New Title › Blank Title, Library › New Item, the shortcuts dialog, Quick Start and the README. No default is bound to Ctrl+N/T/W any more. |
| 6 | At 1366×768, looked at the timeline | The tool column was taller than the panel and pushed the grid row past it. The **Text tool button, the bottom track and the timeline's horizontal scrollbar were clipped and could not be reached.** | Everything reachable | broken (at that size) | **fixed**: `grid-template-rows: minmax(0,1fr)` and compressible tool buttons. Asserted: all tools visible, and the wheel scrolls A3 fully into view. |
| 7 | At 1600×900 (the default), looked at the monitor bars | The Source V/A drag handles were hidden. In the Program monitor, Safe margins, Grid, Zoom, Loop and Playback resolution were hidden. **Zoom could not be reached at all.** | The controls are reachable | broken / awkward | **fixed**: the V/A handles stay visible (icon-less) down to a 290 px bar. Both monitors have a new **⋯** overflow menu (Program: Loop, Safe Margins, Grid, Zoom, Playback Resolution, Add Marker, Export Frame; Source: Clear In/Out, Use Video/Use Audio). Dragging the source picture now respects the V/A toggles. The source step buttons hide below 350 px so the bar fits at 1366. |
| 8 | Ripple Delete on a gap left after lifting an A/V pair, while music on A2 spanned the gap | Only V1 rippled. **The linked audio on A1 stayed put: out of sync.** | Every track that is empty in the gap ripples | wrong | **fixed**: all unlocked tracks that are empty in that range ripple. A toast names the tracks that couldn't ripple. |
| 9 | Slide tool (U) on a linked video clip | Only the video slid, so the audio went **out of sync** | The linked audio slides too | wrong | **fixed**: linked partners slide by the same clamped amount (Alt slides just one) |
| 10 | Marquee-selected 5 clips, then clicked one clip and pressed Ctrl+C | All 5 were copied. A plain click inside a multi-selection kept the whole selection. | The click selects just that clip (and its linked partner) | wrong | **fixed**: a click without a drag narrows the selection; dragging still moves the group |
| 11 | Chroma Key eyedropper clicked on the green area | It picked **#9504ce**, the background showing through the already-keyed pixels, so the green came back | Pick the source green | wrong | **fixed**: samples one synchronous render with this clip's keyers bypassed |
| 12 | Extract (') with In/Out set, then Ctrl+Z | The first undo only restored the Out point. Extract was two history steps. | One undo restores it | wrong | **fixed**: one history step |
| 13 | Imported a 60 fps WebM | Detected as **62.5 fps**, and 30 fps files sometimes read as 29.97. The mismatch prompt said 62.5, and "Match Clip" would have made a 62.5 fps sequence. | 60 / 30 / 29.97 detected correctly | wrong | **fixed**: the rate comes from the container's frame timestamps across the whole file, with a better playback-based fallback. Asserted 60, 25, 30, 29.97 (NTSC test file). |
| 14 | Hold K and tap L (or J) | Playback started shuttling | Step one frame | wrong | **fixed** |
| 15 | Title clip scaled to 50% and rotated 20°, then dragged its text or double-clicked it in the Program monitor | Outlines, hit-testing, dragging and the inline editor all assumed an untransformed clip (known weak spot a) | They follow the clip transform | wrong | **fixed**: new `Scene.mapPoint`/`unmapPoint`. Outlines are drawn as transformed quads. The drag delta is measured in the title's own frame (asserted to 0.01%). The inline editor sits over the transformed text. Layer keyframes are honoured. |
| 16 | Right-clicked a transition right after an undo | Nothing happened until the next redraw. The transition's hit rect (`_rect`) was stored on the model, so it also leaked into saved `.kcut` files and undo snapshots. | The menu opens. The model stays clean. | wrong | **fixed**: non-enumerable property, redrawn on demand when missing |
| 17 | Parked on a frame of a newly visited clip (after a razor cut, or mid-transition) | The Program monitor flashed **black** until that clip's video decoded | Hold the previous picture | awkward | **fixed**: rendering is deferred while a needed video has no picture yet (gives up after 1.5 s) |
| 18 | Dropped several effects in a row from the Effects tab | Each drop switched the panel to the Inspector, so I had to switch back every time | Stay in the browser | awkward | **fixed**: stays on Effects, and the Inspector tab pulses |
| 19 | Track-height drag on a track header's bottom edge | The handle was effectively 3 px (half of it was clipped by `overflow:hidden`) and almost impossible to hit | An easy grab | awkward | **fixed**: a 6 px handle inside the header, highlighted on hover |
| 20 | Moved linked video away from its audio with Alt-drag | Nothing showed that the pair was out of sync | A sync indicator | awkward (missing) | **fixed**: red offset badge (e.g. **+10f** / **−10f**) on both clips |
| 21 | Chose MP4 H.264 in the export dialog in headless Chromium (no H.264 encoder) | The dialog said only "not supported in this browser" | A clear way forward | awkward | **fixed**: the message reads "H.264 encoding is not available in this browser. Choose WebM (VP9) or MP4 (VP9) instead.", the format list marks it "(not available)", and Export stays disabled |
| 22 | Clicked Cancel during an export | No feedback until the encoder loop noticed | Immediate feedback | awkward | **fixed**: "Cancelling…" shows and the button is disabled. Cancelling was verified to produce no download. |
| 23 | Library tab strip at 1366 (also tight at 1600) | "HISTORY" was clipped | All tabs visible | cosmetic | **fixed** (tighter tab padding, tab strips scroll if ever needed) |
| 24 | Rebound Razor to E in the shortcuts dialog | The tool button tooltip still said "Razor (C)" | The tooltip follows the binding | cosmetic | **fixed** |
| 25 | Inspector parameter labels like "Spill Suppre…" and "Anim. Durati…" | Truncated, with no way to read the full name | Full name available | cosmetic | **fixed**: tooltip with the full label |
| 26 | Transparent PNG in the Library | Thumbnail drawn on black | A transparency checkerboard | cosmetic | **fixed** |

## Not fixed (and why)

| # | Observation | Severity | Why not |
|---|---|---|---|
| A | Transform handles sitting exactly on the frame edge are half-clipped by the Program stage, and a clip moved partly off-frame has unreachable corner handles at Fit | cosmetic | Fixing it means re-basing all the overlay math on a padded canvas, which risks the on-canvas transform code. Workaround: ⋯ › Zoom › 50%, which is now reachable. |
| B | Mixer faders stretch the full panel height, and the MASTER dB readout sits lower than the track readouts (no M/S buttons under it) | cosmetic | It works. Left as is. |
| C | Library list view needs horizontal scrolling to see FPS/Size at the default 300 px width | awkward | It scrolls. Widening the Library or using Properties works. |
| D | Ctrl+K with linked selection on also cuts a selected clip's linked partner even if the partner's track is untargeted | by design | Keeps the A/V link consistent. Untargeted, unlinked tracks are left alone (asserted). |
| E | Insert Freeze Frame ripples every unlocked track, including unrelated music | by design | Keeps everything downstream in sync. Lock a track to protect it. |
| F | End parks on the frame after the last clip (black) | by design | Standard editor behaviour. The last frame is at End then ←. |
| G | Native File System Access save/open dialogs are not exercised | test limitation | Headless Chromium can't show them. The suite hides that API with an init script, so the app uses its `<a download>` / `<input type=file>` fallbacks (the same path Firefox takes). |

## Verified working (no change needed)

Welcome → new 1080p30 project. Import by button and by drop. Grid/list views, search, folders (create, rename, drag in, open, breadcrumb). Hover scrub. Properties.
Source monitor: open, scrub, I/O keys, Insert (,), Overwrite (.), mid-clip insert ripple, V-only/A-only handle drags, picture drag, Space/K, audio waveform view.
Timeline: library drops (linked A/V; no-audio clip stays video-only), move, snapping to the playhead, edge trims, razor, Ctrl+K, lift, gap select + ripple delete, ripple/rolling/slip/slide/rate-stretch tools, Alt-drag, marquee, copy/paste, add/delete tracks, mute/solo/hide/lock (a locked clip won't move), track height, Ctrl+wheel and \ zoom, markers (M, edit dialog, drag on the ruler, Shift+M).
Playback: Space, JKL (2×, reverse), arrows, Home/End, Up/Down, stops at the end and Space restarts. Frames differ over time, and meters move and fall back.
Program: click-select, on-canvas move/scale/rotate, safe margins, zoom, full screen, reset transform.
Inspector: scrubbing labels, typing values, sliders, undo per property, keyframes (stopwatch, interpolation, ease menu, lane drag, prev/next, add a key by dragging in the monitor, timeline diamond drag).
Effects: search, drag onto a clip, params, reorder, bypass, remove, double-click to apply, adjustment clip (B&W affects the tracks below).
Transitions: drop Cross Dissolve and Wipe on cuts, drag an edge (centre alignment doubles the change), inspector, Ctrl+D, Ctrl+Shift+D, audio transition drop, a video transition refused on audio, context-menu delete.
Titles: New Item › Lower Third, T-tool click (placed at the click point, tool resets), inline edit, font/size/colour/stroke/box/animation, credits roll scrolls, Ctrl+Alt+T.
Color: workspace, all four scopes render, saturation, wheels, curves, reset.
Audio: faders, pan, clip volume line (ns-resize cursor), fade handles, audio effect, Normalize (+27.9 dB on a −28.5 dBFS file), voiceover recording from the fake mic (placed at the playhead).
Captions: SRT import (timings at 30 fps), edit text and end time, drag on the caption lane, export SRT.
Undo/redo through many steps, Ctrl+Y, History jumps back and forward.
Save (Ctrl+S download), unsaved indicator, reload → autosave recovery, fresh profile → open → Relink dialog → multi-file relink by name, bad file → "Cannot open project".
Export: verified with ffprobe/ffmpeg (see the report). Mixed media: 4K fit, vertical pillarbox, 60/25 fps conform, transparent PNG over video, Match Clip for vertical.
Shortcuts dialog (filter, rebind, conflict toast, persists, reset), Preferences (still duration, snapping default), dividers and double-click reset, workspaces, Window › Source Monitor, 1366×768 layout and Export dialog fit. Every right-click menu item (67) was clicked without errors.
