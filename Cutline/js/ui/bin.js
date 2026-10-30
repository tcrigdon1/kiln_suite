/* Cutline — Library (media bin): import, folders, list/grid views, thumbnails, search, sort, drag to timeline. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, h = U.h, P = C.P;
  var B = C.Bin = { view: U.lsGet('bin.view', 'grid'), sort: U.lsGet('bin.sort', 'name'), folder: null, sel: [], query: '' };

  var TYPE_ICON = { video: 'film', audio: 'audio', image: 'image', gen: 'title', folder: 'folder', seq: 'sequence' };
  function genIcon(m) { return { title: 'title', solid: 'solid', gradient: 'gradient', adjust: 'adjust', bars: 'bars', countdown: 'countdown', tcburn: 'countdown' }[m.gen.kind] || 'title'; }
  B.iconFor = function (m) { return m.type === 'gen' ? genIcon(m) : TYPE_ICON[m.type] || 'film'; };
  B.currentFolder = function () { return B.folder; };

  B.init = function (pane) {
    B.pane = pane;
    var fileInput = h('input', { type: 'file', multiple: true, accept: 'video/*,audio/*,image/*,.mkv,.mov,.mp4,.webm,.wav,.mp3,.m4a,.flac,.ogg,.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg', style: { display: 'none' }, id: 'cl-import-input' });
    fileInput.addEventListener('change', function () { var f = Array.prototype.slice.call(fileInput.files); fileInput.value = ''; C.Media.importFiles(f, B.folder); });
    B.fileInput = fileInput;
    var search = h('input', { type: 'text', placeholder: 'Search library…' });
    search.addEventListener('input', function () { B.query = search.value.trim().toLowerCase(); B.render(); });
    search.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Escape') { search.value = ''; B.query = ''; B.render(); search.blur(); } });
    var viewBtnL = C.ui.iconBtn('list', 'List view', function () { setView('list'); }, { cls: 'sm', tipPos: 'bottom' });
    var viewBtnG = C.ui.iconBtn('gridview', 'Grid view', function () { setView('grid'); }, { cls: 'sm', tipPos: 'bottom' });
    function setView(v) { B.view = v; U.lsSet('bin.view', v); viewBtnL.classList.toggle('active', v === 'list'); viewBtnG.classList.toggle('active', v === 'grid'); B.render(); }
    var tb = h('div.bin-toolbar',
      C.ui.iconBtn('import', 'Import media (Ctrl+I)', function () { B.importDialog(); }, { cls: 'sm', tipPos: 'bottom' }),
      C.ui.iconBtn('plus', 'New item', function (e, b) { var r = b.getBoundingClientRect(); C.ui.menu(B.newItemMenu(), r.left, r.bottom + 2); }, { cls: 'sm', tipPos: 'bottom' }),
      C.ui.iconBtn('foldernew', 'New folder', function () { B.newFolder(); }, { cls: 'sm', tipPos: 'bottom' }),
      h('div.bin-search', { html: C.icon('search') }, search),
      C.ui.iconBtn('sliders', 'Sort', function (e, b) {
        var r = b.getBoundingClientRect();
        C.ui.menu([['name', 'Name'], ['type', 'Type'], ['duration', 'Duration'], ['added', 'Date Added'], ['size', 'File Size']].map(function (s) {
          return { label: s[1], checked: B.sort === s[0], action: function () { B.sort = s[0]; U.lsSet('bin.sort', s[0]); B.render(); } };
        }), r.left, r.bottom + 2);
      }, { cls: 'sm', tipPos: 'bottom' }),
      viewBtnL, viewBtnG);
    B.crumbs = h('div.bin-crumbs');
    B.body = h('div.bin-body');
    pane.appendChild(fileInput); pane.appendChild(tb); pane.appendChild(B.crumbs); pane.appendChild(B.body);
    setView(B.view);
    C.ui.fileDrop(pane, function (files) { C.Media.importFiles(files, B.folder); });
    B.body.addEventListener('pointerdown', function (e) {
      C.state.focus = 'bin';
      if (e.target === B.body || e.target.classList.contains('bin-grid')) { B.sel = []; B.renderSel(); }
    });
    B.body.addEventListener('contextmenu', function (e) {
      if (e.target.closest('.bin-item')) return;
      e.preventDefault();
      C.ui.menu([{ label: 'Import Media…', action: B.importDialog }, { label: 'New Folder', action: B.newFolder }, '-'].concat(B.newItemMenu()), e.clientX, e.clientY);
    });
    ['media', 'media:update', 'changed', 'film', 'sequence', 'peaks', 'media:progress'].forEach(function (ev) {
      C.bus.on(ev, U.debounce(function (x) {
        if (ev === 'changed' && x && x.live) return;
        if (ev === 'changed' || ev === 'film' || ev === 'peaks' || ev === 'media:progress') { var sg = B.signature(); if (sg === B.lastSig) return; }
        B.render();
      }, 60));
    });
  };

  B.importDialog = function () { if (!C.state.project) return; B.fileInput.click(); };
  B.newItemMenu = function () {
    var p = !C.state.project;
    return [
      { label: 'Title', sub: [{ label: 'Blank Title', action: function () { C.A.newGen('title'); } }, { label: 'Blank Title at Playhead', kbd: C.CMD.keyLabel('newTitle'), action: function () { C.A.addTitleAtPlayhead(); } }, '-'].concat(C.Titles.PRESETS.map(function (pr) { return { label: pr.name, action: function () { C.A.newGen('title', pr.id); } }; })), disabled: p },
      { label: 'Solid Color', action: function () { C.A.newGen('solid'); }, disabled: p },
      { label: 'Gradient', action: function () { C.A.newGen('gradient'); }, disabled: p },
      { label: 'Adjustment Clip', action: function () { C.A.newGen('adjust'); }, disabled: p },
      { label: 'Bars & Tone', action: function () { C.A.newGen('bars'); }, disabled: p },
      { label: 'Countdown', action: function () { C.A.newGen('countdown'); }, disabled: p },
      { label: 'Timecode Burn-in', action: function () { C.A.newGen('tcburn'); }, disabled: p },
      { label: 'Audio Spectrum', action: function () { C.A.newGen('spectrum'); }, disabled: p },
      '-', { label: 'Sequence…', kbd: C.CMD.keyLabel('newSeq'), action: function () { C.A.newSequence(); }, disabled: p }
    ];
  };
  B.newFolder = function () {
    if (!C.state.project) return;
    var name = 'Folder ' + (C.state.project.folders.length + 1), id = U.uid('f');
    C.edit('New Folder', function (s, prj) { prj.folders.push({ id: id, name: name, parent: B.folder }); });
    B.render();
    setTimeout(function () { B.beginRename(id); }, 30);
  };

  function sortItems(arr) {
    var k = B.sort;
    return arr.sort(function (a, b) {
      if (k === 'type') return (a.type + a.name).localeCompare(b.type + b.name);
      if (k === 'duration') return (P.isStill(b) ? 0 : b.duration || 0) - (P.isStill(a) ? 0 : a.duration || 0);
      if (k === 'added') return (b.added || 0) - (a.added || 0);
      if (k === 'size') return (b.size || 0) - (a.size || 0);
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
  }
  B.items = function () {
    var prj = C.state.project; if (!prj) return { folders: [], media: [], seqs: [] };
    var q = B.query;
    if (q) {
      return {
        folders: [], seqs: prj.sequences.filter(function (s) { return s.name.toLowerCase().indexOf(q) >= 0; }),
        media: sortItems(prj.media.filter(function (m) { return m.type !== 'nest' && (m.name.toLowerCase().indexOf(q) >= 0 || (m.type === 'gen' && m.gen.kind.indexOf(q) >= 0)); }))
      };
    }
    return {
      folders: prj.folders.filter(function (f) { return (f.parent || null) === B.folder; }).sort(function (a, b) { return a.name.localeCompare(b.name); }),
      seqs: B.folder ? [] : prj.sequences,
      media: sortItems(prj.media.filter(function (m) { return (m.folder || null) === B.folder; }))
    };
  };

  function durLabel(m) {
    if (m.sub) return U.fmtDur(m.sub.out - m.sub.in);
    if (m.type === 'image') return 'Still';
    if (m.type === 'gen') return m.gen.kind === 'adjust' ? 'Adj' : U.fmtDur(m.stillDur || C.prefs.stillDur);
    return U.fmtDur(m.duration);
  }
  function thumbNode(m) {
    var rt = C.MRT[m.id];
    var t = h('div.thumb' + (m.type === 'image' ? '.checker' : '')); // stills may be transparent: show a checkerboard behind them
    var subThumb = m.sub && C.Media.thumbAt ? C.Media.thumbAt(m.id, m.sub.in + 0.5, 1) : null;
    if ((subThumb || (rt && rt.thumb)) && m.type !== 'audio') { var c = subThumb || rt.thumb; var cv = h('canvas'); cv.width = c.width; cv.height = c.height; cv.getContext('2d').drawImage(c, 0, 0); t.appendChild(cv); }
    else if (m.type === 'audio' && rt && rt.peaks) t.appendChild(waveThumb(rt.peaks, m.sub ? m.sub.in : 0, m.sub ? m.sub.out : (m.duration || rt.peaks.duration || (rt.peaks.min.length / rt.peaks.rate))));
    else t.appendChild(h('span', { html: C.icon(B.iconFor(m), 'big') }));
    return t;
  }
  function waveThumb(pk, a, b) {
    var c = h('canvas'); c.width = 160; c.height = 90;
    var g = c.getContext('2d'); g.fillStyle = '#1c140c'; g.fillRect(0, 0, 160, 90);
    g.strokeStyle = '#f0a04a'; g.beginPath();
    var span = Math.max(1e-6, b - a);
    for (var x = 0; x < 160; x++) {
      var sp = C.Media.peakSpan(pk, a + x / 160 * span, a + (x + 1) / 160 * span);
      g.moveTo(x + 0.5, 45 - sp.hi * 40); g.lineTo(x + 0.5, 45 - sp.lo * 40 + 1);
    }
    g.stroke();
    return c;
  }
  // background work on long media (container indexing, waveform pass) shown on the item
  function progressBadge(m) {
    var rt = C.MRT[m.id]; if (!rt || m.sub) return null;
    var pk = rt.peaks, txt = null, k = 0;
    if (rt.status === 'loading' && rt.indexing != null && rt.indexing < 1) { txt = 'Indexing ' + Math.floor(rt.indexing * 100) + '%'; k = rt.indexing; }
    else if (rt.stream && (!pk || pk.done < 1)) { k = pk ? pk.done : 0; txt = 'Waveform ' + Math.floor(k * 100) + '%'; }
    if (!txt) return null;
    return h('div.bin-prog', { title: 'Analysing audio in the background (cached for next time)' }, h('div.bin-prog-fill', { style: { width: (k * 100).toFixed(1) + '%' } }), h('span', txt));
  }

  B.signature = function () {
    var p = C.state.project; if (!p) return '';
    return JSON.stringify([p.name, p.media.map(function (m) { var rt = C.MRT[m.id]; return [m.id, m.name, m.folder, m.stillDur, (m.markers || []).length, rt ? rt.status + (rt.thumb ? 1 : 0) + (rt.url || '') + (rt.peaks ? Math.floor((rt.peaks.done || 0) * 50) : '') + (rt.indexing != null ? Math.floor(rt.indexing * 50) : '') : 'x']; }), p.folders, p.sequences.map(function (q) { var hsh = 0; q.clips.forEach(function (c) { hsh = (hsh * 31 + c.start * 7 + c.dur * 13 + c.trackId.length) % 1000000007; }); return [q.id, q.name, P.seqDuration(q), q.clips.length, hsh]; })]);
  };
  B.render = function () {
    if (!B.body) return;
    // A rename box is open: don't rebuild the list under the user's cursor (background events such as
    // proxy progress would otherwise remove the input while its blur handler is still running). Redraw after.
    if (B.renaming) { B.renderPending = true; return; }
    B.lastSig = B.signature();
    var prj = C.state.project;
    U.clear(B.body); U.clear(B.crumbs);
    if (!prj) return;
    // crumbs
    var path = [], f = B.folder;
    while (f) { var fo = prj.folders.filter(function (x) { return x.id === f; })[0]; if (!fo) { B.folder = null; break; } path.unshift(fo); f = fo.parent; }
    var root = h('span.crumb' + (B.folder ? '' : '.cur'), prj.name);
    root.addEventListener('click', function () { B.folder = null; B.render(); });
    dropTarget(root, null);
    B.crumbs.appendChild(root);
    path.forEach(function (fo, i) {
      B.crumbs.appendChild(h('span', '›'));
      var cr = h('span.crumb' + (i === path.length - 1 ? '.cur' : ''), fo.name);
      cr.addEventListener('click', function () { B.folder = fo.id; B.render(); });
      dropTarget(cr, fo.id);
      B.crumbs.appendChild(cr);
    });
    var cnt = prj.media.length;
    B.crumbs.appendChild(h('span', { style: { marginLeft: 'auto' } }, cnt + ' item' + (cnt === 1 ? '' : 's')));
    var it = B.items();
    if (!it.media.length && !it.folders.length && !B.folder && !B.query && !prj.media.length) {
      var em = h('div.bin-empty', { html: C.icon('import') }, h('div', h('b', 'Import media'), h('br'), 'Drop video, audio or image files here, or click to browse.'));
      em.addEventListener('click', B.importDialog);
      B.body.appendChild(em);
      return;
    }
    var all = [];
    it.folders.forEach(function (fo) { all.push({ kind: 'folder', obj: fo }); });
    it.seqs.forEach(function (s) { all.push({ kind: 'seq', obj: s }); });
    it.media.forEach(function (m) { all.push({ kind: 'media', obj: m }); });
    if (B.view === 'grid') {
      var grid = h('div.bin-grid');
      all.forEach(function (x) { grid.appendChild(gridItem(x)); });
      B.body.appendChild(grid);
    } else {
      var tbl = h('table.bin-list'), thead = h('tr');
      [['name', 'Name'], ['type', 'Type'], ['duration', 'Duration'], [null, 'Resolution'], [null, 'FPS'], ['size', 'Size']].forEach(function (c) {
        var th = h('th', c[1] + (B.sort === c[0] ? ' ▾' : ''));
        if (c[0]) th.addEventListener('click', function () { B.sort = c[0]; U.lsSet('bin.sort', c[0]); B.render(); });
        thead.appendChild(th);
      });
      tbl.appendChild(thead);
      all.forEach(function (x) { tbl.appendChild(listItem(x)); });
      B.body.appendChild(tbl);
    }
    B.renderSel();
  };

  function itemId(x) { return x.obj.id; }
  function wire(el, x) {
    var id = itemId(x);
    el.setAttribute('data-id', id);
    el.addEventListener('pointerdown', function (e) {
      if (e.button === 2 && B.sel.indexOf(id) >= 0) return;
      if (e.ctrlKey || e.metaKey) { var i = B.sel.indexOf(id); if (i >= 0) B.sel.splice(i, 1); else B.sel.push(id); }
      else if (e.shiftKey && B.sel.length) {
        var ids = U.$$('[data-id]', B.body).map(function (n) { return n.getAttribute('data-id'); });
        var a = ids.indexOf(B.sel[B.sel.length - 1]), b = ids.indexOf(id);
        B.sel = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
      } else if (B.sel.indexOf(id) < 0) B.sel = [id];
      B.renderSel();
      if (x.kind === 'media') C.bus.emit('bin:select', id);
    });
    // a plain click (no drag) on an item that is part of a multi-selection selects just that item
    el.addEventListener('click', function (e) {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      if (B.sel.length > 1 && B.sel.indexOf(id) >= 0) { B.sel = [id]; B.renderSel(); }
    });
    el.addEventListener('dblclick', function () {
      if (x.kind === 'folder') { B.folder = id; B.sel = []; B.render(); }
      else if (x.kind === 'seq') C.A.switchSequence(id);
      else if (C.Source) C.Source.open(id);
    });
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); if (B.sel.indexOf(id) < 0) { B.sel = [id]; B.renderSel(); } C.ui.menu(contextItems(x), e.clientX, e.clientY); });
    if (x.kind === 'seq') {
      el.draggable = true;
      el.addEventListener('dragstart', function (e) {
        var cur = P.seq();
        if (cur && P.seqContains(id, cur.id)) { e.preventDefault(); C.toast('A sequence cannot be nested inside itself'); return; }
        var nm = P.nestMedia(id, true);
        e.dataTransfer.setData('application/x-cutline-media', JSON.stringify([nm.id]));
        e.dataTransfer.setData('text/plain', 'cutline:' + nm.id);
        e.dataTransfer.effectAllowed = 'copy';
        C.state.dragMedia = { ids: [nm.id], video: true, audio: true };
      });
      el.addEventListener('dragend', function () { C.state.dragMedia = null; C.bus.emit('dragend'); });
    }
    if (x.kind !== 'seq') {
      el.draggable = true;
      el.addEventListener('dragstart', function (e) {
        var ids = B.sel.indexOf(id) >= 0 ? B.sel.slice() : [id];
        var mediaIds = ids.filter(function (i) { return P.media(i); });
        var folderIds = ids.filter(function (i) { return !P.media(i); });
        e.dataTransfer.setData('application/x-cutline-media', JSON.stringify(mediaIds));
        e.dataTransfer.setData('application/x-cutline-folders', JSON.stringify(folderIds));
        e.dataTransfer.setData('text/plain', 'cutline:' + mediaIds.join(','));
        e.dataTransfer.effectAllowed = 'copyMove';
        C.state.dragMedia = { ids: mediaIds, video: true, audio: true };
        var rt = mediaIds.length === 1 && C.MRT[mediaIds[0]];
        if (rt && rt.thumb) { var ghost = h('canvas'); ghost.width = 96; ghost.height = 54; ghost.getContext('2d').drawImage(rt.thumb, 0, 0, 96, 54); ghost.style.position = 'fixed'; ghost.style.left = '-200px'; document.body.appendChild(ghost); e.dataTransfer.setDragImage(ghost, 48, 27); setTimeout(function () { ghost.remove(); }, 0); }
      });
      el.addEventListener('dragend', function () { C.state.dragMedia = null; C.bus.emit('dragend'); });
    }
    if (x.kind === 'folder') dropTarget(el, id);
  }
  function dropTarget(el, folderId) {
    el.addEventListener('dragover', function (e) { if (Array.prototype.indexOf.call(e.dataTransfer.types, 'application/x-cutline-media') >= 0) { e.preventDefault(); el.classList.add('drop-hot'); } });
    el.addEventListener('dragleave', function () { el.classList.remove('drop-hot'); });
    el.addEventListener('drop', function (e) {
      el.classList.remove('drop-hot');
      var ids = JSON.parse(e.dataTransfer.getData('application/x-cutline-media') || '[]');
      var fids = JSON.parse(e.dataTransfer.getData('application/x-cutline-folders') || '[]').filter(function (f) { return f !== folderId; });
      if (!ids.length && !fids.length) return;
      e.preventDefault(); e.stopPropagation();
      C.edit('Move to Folder', function (s, prj) {
        ids.forEach(function (i) { var m = P.media(i); if (m) m.folder = folderId; });
        fids.forEach(function (f) { var fo = prj.folders.filter(function (x) { return x.id === f; })[0]; if (fo && !isAncestor(prj, f, folderId)) fo.parent = folderId; });
      });
      B.render();
    });
  }
  function isAncestor(prj, a, b) { while (b) { if (a === b) return true; var fo = prj.folders.filter(function (x) { return x.id === b; })[0]; b = fo ? fo.parent : null; } return false; }

  function badgeType(x) {
    if (x.kind === 'folder') return h('span.tbadge.t-folder', { html: C.icon('folder') });
    if (x.kind === 'seq') return h('span.tbadge.t-seq', { html: C.icon('sequence') });
    var m = x.obj; return h('span.tbadge.t-' + m.type, { html: C.icon(B.iconFor(m)) });
  }
  function gridItem(x) {
    var el = h('div.bin-item'), thumb;
    if (x.kind === 'folder') {
      thumb = h('div.thumb', { html: C.icon('folder', 'big') });
      thumb.firstChild.style.stroke = 'var(--warn)';
      var n = C.state.project.media.filter(function (m) { return m.folder === x.obj.id; }).length;
      thumb.appendChild(h('span.badge', n + ''));
    } else if (x.kind === 'seq') {
      thumb = h('div.thumb');
      thumb.appendChild(seqMinimap(x.obj));
      thumb.appendChild(h('span.badge', U.fmtDur(P.seqDuration(x.obj) / x.obj.fps)));
    } else {
      var m = x.obj;
      thumb = thumbNode(m);
      thumb.appendChild(h('span.badge', durLabel(m)));
      if (m.sub) thumb.appendChild(h('span.sub-badge', { title: 'Subclip of ' + (P.media(m.sub.of) || {}).name }, 'SUB'));
      if (m.type === 'video' && C.Proxy) {
        if (C.Proxy.busy(m)) thumb.appendChild(h('span.sub-badge.px-badge', { title: 'Proxy transcoding…' }, 'PX ' + Math.round((C.Proxy.jobs[C.Media.base(m).id].progress || 0) * 100) + '%'));
        else if (C.Proxy.has(m)) { var pxi = C.MRT[C.Media.base(m).id].proxy; thumb.appendChild(h('span.sub-badge.px-badge' + (C.prefs.useProxies === false ? '.off' : ''), { title: 'Proxy ' + pxi.w + '×' + pxi.h + ' (' + U.fmtSize(pxi.size) + ')' + (C.prefs.useProxies === false ? ' — proxies are off (View menu)' : '') }, 'PX')); }
      }
      if ((m.markers || []).length) thumb.appendChild(h('span.mk-badge', { title: m.markers.length + ' marker(s) on this media' }, '◆ ' + m.markers.length));
      var pb = progressBadge(m); if (pb) thumb.appendChild(pb);
      if (!C.Media.isOnline(m)) thumb.appendChild(h('div.offline-badge', 'OFFLINE'));
      else if (C.MRT[m.id] && C.MRT[m.id].status === 'loading') thumb.appendChild(h('div.offline-badge', { style: { background: 'rgba(20,18,16,.6)', color: 'var(--text-1)' } }, 'LOADING…'));
      if (m.type === 'video') hoverScrub(thumb, m);
    }
    thumb.appendChild(badgeType(x));
    el.appendChild(thumb);
    el.appendChild(h('div.name', { title: x.obj.name }, x.obj.name));
    wire(el, x);
    return el;
  }
  function hoverScrub(thumb, m) {
    var line = null;
    thumb.addEventListener('mousemove', function (e) {
      var rt = C.MRT[m.id]; if (!rt || !rt.film || !rt.film.length) return;
      var r = thumb.getBoundingClientRect(), k = U.clamp((e.clientX - r.left) / r.width, 0, 1);
      var a = m.sub ? m.sub.in : 0, b = m.sub ? m.sub.out : m.duration;
      var fr = m.sub || C.Media.isLong(m) ? C.Media.thumbAt(m.id, a + k * (b - a), Math.max(1, (b - a) / 60)) : C.Media.filmFrame(m.id, k * m.duration);
      var cv = thumb.querySelector('canvas');
      if (cv && fr) { var g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height); g.drawImage(fr, 0, 0, cv.width, cv.height); }
      if (!line) { line = h('div.scrub-line'); thumb.appendChild(line); }
      line.style.left = (k * 100) + '%';
    });
    thumb.addEventListener('mouseleave', function () {
      var rt = C.MRT[m.id], cv = thumb.querySelector('canvas');
      if (cv && rt && rt.thumb) { var g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height); g.drawImage(rt.thumb, 0, 0, cv.width, cv.height); }
      if (line) { line.remove(); line = null; }
    });
  }
  // Mini timeline drawing used as the thumbnail of a sequence
  function seqMinimap(s) {
    var c = h('canvas'); c.width = 160; c.height = 90;
    var g = c.getContext('2d');
    g.fillStyle = '#141210'; g.fillRect(0, 0, 160, 90);
    var tracks = P.vtracks(s).slice().reverse().concat(P.atracks(s)), n = tracks.length || 1;
    var dur = Math.max(1, P.seqDuration(s)), rh = Math.min(12, (90 - 16) / n);
    var y0 = (90 - rh * n) / 2;
    tracks.forEach(function (t, i) {
      var y = y0 + i * rh;
      g.fillStyle = i % 2 ? '#1c1916' : '#1f1c18'; g.fillRect(6, y, 148, rh - 1);
      s.clips.forEach(function (cl) {
        if (cl.trackId !== t.id) return;
        var m = P.media(cl.mediaId);
        g.fillStyle = cl.kind === 'audio' ? '#b77632' : (m && m.type === 'gen' ? '#7d9a3c' : m && m.type === 'nest' ? '#4b7f63' : '#2c8e83');
        g.fillRect(6 + cl.start / dur * 148, y + 1, Math.max(1.5, cl.dur / dur * 148 - 0.5), rh - 3);
      });
    });
    if (!s.clips.length) { g.fillStyle = '#5a5047'; g.font = '11px sans-serif'; g.textAlign = 'center'; g.fillText('empty', 80, 49); }
    return c;
  }
  function listItem(x) {
    var tr = h('tr.bin-item'), o = x.obj;
    var icon = h('span', { html: C.icon(x.kind === 'folder' ? 'folder' : x.kind === 'seq' ? 'sequence' : B.iconFor(o), 'ti') });
    icon.className = x.kind === 'folder' ? 't-folder' : x.kind === 'seq' ? 't-seq' : 't-' + o.type;
    var nameCell = h('td', icon, h('span.nm', o.name));
    if (x.kind === 'media' && !C.Media.isOnline(o)) nameCell.appendChild(h('span', { style: { color: 'var(--danger)', fontSize: '10px', fontWeight: 700 } }, 'OFFLINE'));
    if (x.kind === 'media' && o.sub) nameCell.appendChild(h('span.sub-badge.inline', 'SUB'));
    if (x.kind === 'media') { var pb2 = progressBadge(o); if (pb2) { pb2.classList.add('inline'); nameCell.appendChild(pb2); } }
    tr.appendChild(nameCell);
    if (x.kind === 'folder') { tr.appendChild(h('td', 'Folder')); tr.appendChild(h('td', '')); tr.appendChild(h('td', '')); tr.appendChild(h('td', '')); tr.appendChild(h('td', '')); }
    else if (x.kind === 'seq') { tr.appendChild(h('td', 'Sequence')); tr.appendChild(h('td', U.fmtDur(P.seqDuration(o) / o.fps))); tr.appendChild(h('td', o.w + '×' + o.h)); tr.appendChild(h('td', o.fps + '')); tr.appendChild(h('td', '')); }
    else {
      tr.appendChild(h('td', o.sub ? 'Subclip' : o.type === 'gen' ? C.Media.GEN_NAMES[o.gen.kind] : o.type[0].toUpperCase() + o.type.slice(1)));
      tr.appendChild(h('td', durLabel(o)));
      tr.appendChild(h('td', o.w && o.type !== 'audio' ? o.w + '×' + o.h : '—'));
      tr.appendChild(h('td', o.fps ? String(o.fps) : '—'));
      tr.appendChild(h('td', U.fmtSize(o.size)));
    }
    wire(tr, x);
    return tr;
  }
  B.renderSel = function () {
    U.$$('[data-id]', B.body).forEach(function (n) { n.classList.toggle('sel', B.sel.indexOf(n.getAttribute('data-id')) >= 0); });
  };
  B.selectAll = function () { B.sel = U.$$('[data-id]', B.body).map(function (n) { return n.getAttribute('data-id'); }); B.renderSel(); };
  B.beginRename = function (id) {
    var el = U.$('[data-id="' + id + '"]', B.body); if (!el) return;
    var nm = el.querySelector('.name, .nm'); if (!nm) return;
    var prj = C.state.project, obj = P.media(id) || prj.folders.filter(function (f) { return f.id === id; })[0] || P.seqById(id);
    if (!obj) return;
    var inp = h('input.bin-rename', { type: 'text', value: obj.name });
    nm.textContent = ''; nm.appendChild(inp); inp.focus(); inp.select();
    var done = false;
    B.renaming = true;
    function finish(ok) {
      if (done) return; done = true;
      B.renaming = false; B.renderPending = false;
      var v = inp.value.trim();
      if (ok && v && v !== obj.name) C.edit('Rename', function () {
        var o = P.media(id) || C.state.project.folders.filter(function (f) { return f.id === id; })[0] || P.seqById(id); if (!o) return;
        // a Library item can be given any display name; the file it came from is remembered for relinking (and the cache key)
        if (o.type && o.type !== 'gen' && o.type !== 'nest' && !o.sub && !o.file) o.file = o.name;
        o.name = v;
        if (o.type === 'nest') { var sq = P.seqById(o.seqId); if (sq) sq.name = v; }
      });
      B.render(); C.bus.emit('sequence');
    }
    inp.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
    inp.addEventListener('blur', function () { finish(true); });
    inp.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
  };
  B.deleteSelected = function () {
    var prj = C.state.project; if (!prj || !B.sel.length) return;
    var media = B.sel.filter(function (id) { return P.media(id); });
    var folders = B.sel.filter(function (id) { return prj.folders.some(function (f) { return f.id === id; }); });
    var used = media.filter(function (id) { return prj.sequences.some(function (s) { return s.clips.some(function (c) { return c.mediaId === id; }); }); });
    function go() {
      if (media.length) C.Media.removeMedia(media);
      if (folders.length) C.edit('Delete Folder', function (s, p) {
        folders.forEach(function (fid) {
          p.media.forEach(function (m) { if (m.folder === fid) m.folder = null; });
          p.folders.forEach(function (f) { if (f.parent === fid) f.parent = null; });
        });
        p.folders = p.folders.filter(function (f) { return folders.indexOf(f.id) < 0; });
      });
      B.sel = []; B.render();
    }
    if (used.length) C.ui.confirm(used.length + ' item(s) are used in sequences. Deleting them will also remove their clips.', 'Delete').then(function (ok) { if (ok) go(); });
    else go();
  };
  function contextItems(x) {
    var id = itemId(x), items = [];
    if (x.kind === 'media') {
      var m = x.obj;
      items.push({ label: 'Open in Source Monitor', action: function () { C.Source.open(id); } });
      items.push({ label: 'Insert at Playhead', action: function () { C.Source.open(id); C.A.sourceEdit('insert'); } });
      items.push({ label: 'Overwrite at Playhead', action: function () { C.Source.open(id); C.A.sourceEdit('overwrite'); } });
      if (m.type === 'video') items.push({ label: 'New Sequence from Clip', action: function () { C.A.sequenceFromClip(id); } });
      var selMedia = B.sel.filter(function (i) { return P.media(i); });
      if (selMedia.length > 1 || m.sub) items.push({ label: 'New Sequence from Selected Items', action: function () { C.A.sequenceFromItems(selMedia.length ? selMedia : [id]); } });
      if (selMedia.length > 1) items.push({ label: 'New Multicam Sequence…', action: function () { C.Multicam.dialog(selMedia); } });
      if ((m.type === 'video' || m.type === 'audio') && !m.sub) items.push({ label: 'Find Highlights…', action: function () { C.A.findHighlightsDialog(id); } });
      if ((m.markers || []).length) items.push({ label: 'Show Markers (' + m.markers.length + ')', action: function () { C.ui.showLeftTab('markers'); C.Side.markerFilter = 'source'; C.Side.renderMarkers(); } });
      items.push({ label: 'Select Clips Using This Item', action: function () { C.A.selectByMedia(id); } });
      if (P.selectedClips().length) items.push({ label: 'Replace Selected Timeline Clip' + (P.selectedClips().length > 1 ? 's' : '') + ' with This', action: function () { C.A.replaceClip(id); } });
      items.push('-');
      if (!C.Media.isOnline(m)) items.push({ label: 'Relink…', action: function () { C.IO.relinkDialog(); } });
      if (P.isStill(m)) items.push({ label: 'Set Still Duration…', action: function () {
        C.ui.prompt('Default duration (seconds)', String(m.stillDur || C.prefs.stillDur)).then(function (v) { if (v == null) return; var n = parseFloat(v); if (n > 0) C.edit('Still Duration', function () { P.media(id).stillDur = n; }); else C.toast('Enter a duration greater than 0 seconds'); B.render(); });
      } });
      items.push({ label: 'Properties…', action: function () { B.properties(m); } });
    } else if (x.kind === 'seq') {
      items.push({ label: 'Open Sequence', action: function () { C.A.switchSequence(id); } });
      items.push({ label: 'Insert as Nested Clip at Playhead', action: function () { C.A.insertNest(id); } });
      items.push({ label: 'Sequence Settings…', action: function () { C.ui.sequenceDialog(x.obj); } });
      items.push({ label: 'Duplicate Sequence', action: function () {
        C.edit('Duplicate Sequence', function (s, prj) { var ns = U.clone(x.obj); ns.id = U.uid('seq'); ns.name = x.obj.name + ' copy'; prj.sequences.push(ns); });
        C.bus.emit('sequence');
      } });
      if (C.state.project.sequences.length > 1) items.push({ label: 'Delete Sequence', action: function () {
        C.ui.confirm('Delete sequence "' + x.obj.name + '"?', 'Delete').then(function (ok) {
          if (!ok) return;
          C.edit('Delete Sequence', function (s, prj) { prj.sequences = prj.sequences.filter(function (q) { return q.id !== id; }); if (prj.activeSeq === id) prj.activeSeq = prj.sequences[0].id; });
          C.bus.emit('sequence'); C.bus.emit('changed', {});
        });
      } });
    } else {
      items.push({ label: 'Open Folder', action: function () { B.folder = id; B.render(); } });
    }
    (B.extraItems || []).forEach(function (fn) { try { var ex = fn(x); if (ex && ex.length) { if (items[items.length - 1] !== '-') items.push('-'); ex.forEach(function (it) { items.push(it); }); } } catch (e) { console.warn('[Cutline] library menu extra failed', e); } });
    items.push('-');
    items.push({ label: 'Rename', action: function () { B.beginRename(id); } });
    if (x.kind !== 'seq') items.push({ label: 'Delete', action: B.deleteSelected });
    return items;
  }
  B.properties = function (m) {
    var bm = C.Media.base(m), rt = C.MRT[bm.id] || {}, pi = rt.probe;
    var rows = [['Name', m.name], ['Type', m.sub ? 'Subclip of ' + bm.name : m.type === 'gen' ? C.Media.GEN_NAMES[m.gen.kind] : m.type],
      ['Duration', P.isStill(m) ? 'Still' : m.sub ? U.fmtDur(m.sub.out - m.sub.in) + ' (' + U.fmtTC(Math.round(m.sub.in * (bm.fps || 30)), bm.fps || 30) + ' → ' + U.fmtTC(Math.round(m.sub.out * (bm.fps || 30)), bm.fps || 30) + ')' : U.fmtDur(m.duration) + ' (' + (m.duration || 0).toFixed(3) + ' s)'],
      ['Resolution', m.w ? m.w + ' × ' + m.h : '—'], ['Frame rate', m.fps ? m.fps + ' fps' + (m.vfr ? ' (variable, avg ' + m.fpsAvg + ' — conformed to the sequence rate on export)' : '') : 'unknown'],
      ['Codecs', pi ? [pi.video && (pi.video.codec || pi.video.codecId), pi.audio && (pi.audio.codec || pi.audio.codecId)].filter(Boolean).join(' + ') + ' (' + pi.container + ')' : '—'],
      ['Audio', m.hasAudio ? (m.channels ? m.channels + ' ch' : 'yes') + (rt.stream ? ' — streamed (long media)' + (rt.peaks ? ', waveform ' + Math.floor((rt.peaks.done || 0) * 100) + '%' : '') : '') : 'none'],
      ['File size', U.fmtSize(m.size || bm.size)], ['MIME', m.mime || bm.mime || '—'], ['Status', C.Media.isOnline(m) ? 'Online' : 'Offline']];
    var g = h('div.form-grid');
    rows.forEach(function (r) { g.appendChild(h('label', r[0])); g.appendChild(h('div', { style: { fontFamily: 'var(--mono)', fontSize: '11px' } }, String(r[1]))); });
    C.ui.dialog({ title: 'Properties', body: g, buttons: [{ label: 'Close', primary: true }] });
  };
})();
