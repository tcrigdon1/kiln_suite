/* =========================================================================
   Gesso — command registry + keyboard shortcut mapping.
   S.Cmd.register('edit.undo', { label, run, key:'Ctrl+Z', enabled, checked })
   Shortcuts are customizable (Help ▸ Keyboard Shortcuts) and saved in
   localStorage.  Key strings look like 'Ctrl+Shift+Z', 'Alt+F9', 'Delete'.
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso;
  const C = (S.Cmd = { map: {}, order: [] });
  let custom = S.store.get('shortcuts', {});

  C.register = function (id, def) {
    def.id = id;
    def.defaultKey = def.key || '';
    C.map[id] = def;
    C.order.push(id);
    return def;
  };
  C.get = (id) => C.map[id];
  C.keyOf = (id) => (id in custom ? custom[id] : (C.map[id] && C.map[id].defaultKey) || '');
  /** alternates are separated by '|' or by a comma followed by the next combo (so 'Ctrl+,' stays intact) */
  C.splitKeys = (k) => (k || '').split(/\|,(?=[A-Z])|,(?=[A-Z])|\|/).map((x) => C.normKey(x.trim())).filter(Boolean);
  /** canonical modifier order (Ctrl, Alt, Shift) so 'Ctrl+Shift+Alt+W' and 'Ctrl+Alt+Shift+W' are the same shortcut */
  C.normKey = function (k) {
    if (!k || k.indexOf('+') < 0) return k;
    const parts = k.split('+'); if (parts[parts.length - 1] === '') { parts.pop(); parts[parts.length - 1] += '+'; }
    const key = parts.pop(), mods = parts.map((m) => m === 'Cmd' || m === 'Meta' ? 'Ctrl' : m);
    return ['Ctrl', 'Alt', 'Shift'].filter((m) => mods.includes(m)).map((m) => m + '+').join('') + key;
  };
  C.keyLabel = function (id) {
    const k = C.keyOf(id);
    if (!k) return '';
    return C.splitKeys(k)[0].replace('Ctrl', S.util.isMac ? '⌘' : 'Ctrl');
  };
  C.setKey = function (id, key) {
    if (key === (C.map[id] && C.map[id].defaultKey)) delete custom[id]; else custom[id] = key;
    S.store.set('shortcuts', custom);
  };
  C.resetKeys = function () { custom = {}; S.store.set('shortcuts', custom); };
  /** commands that may run while a transform / warp / text edit is live without ending it */
  const LIVE_OK = /^(view\.|window\.|help\.|color\.|edit\.prefs|edit\.shortcuts|edit\.undo|edit\.redo|edit\.freeTransform|edit\.meshWarp|app\.|select\.quickMask$)/;
  C.run = function (id, arg) {
    const c = C.map[id];
    if (!c) { console.warn('Unknown command', id); return; }
    if (c.enabled && !c.enabled(arg)) return;
    // structural commands (delete layer, crop, save…) first end any interactive session so it cannot
    // keep writing into a layer that no longer exists or record itself on top of the new state
    if (!LIVE_OK.test(id) && S.App && S.App.commitSessions) S.App.commitSessions();
    try { return c.run(arg); } catch (e) { console.error(e); S.toast('Error: ' + e.message); }
  };

  /** KeyboardEvent → key string */
  C.eventKey = function (e) {
    let k;
    if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
    else if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
    else if (/^Numpad\d$/.test(e.code)) k = e.code.slice(6);
    else if (e.code === 'NumpadAdd') k = '+';
    else if (e.code === 'NumpadSubtract') k = '-';
    else if (e.code === 'Equal') k = '=';
    else if (e.code === 'Minus') k = '-';
    else if (e.code === 'BracketLeft') k = '[';
    else if (e.code === 'BracketRight') k = ']';
    else if (e.code === 'Quote') k = "'";
    else if (e.code === 'Semicolon') k = ';';
    else if (e.code === 'Backslash') k = '\\';
    else if (e.code === 'Comma') k = ',';
    else if (e.code === 'Period') k = '.';
    else if (e.code === 'Slash') k = '/';
    else if (e.code === 'Backquote') k = '`';
    else k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return null;
    let s = '';
    if (e.ctrlKey || e.metaKey) s += 'Ctrl+';
    if (e.altKey) s += 'Alt+';
    if (e.shiftKey) s += 'Shift+';
    return s + k;
  };
  /** Find command for a key string (supports comma separated alternates) */
  C.forKey = function (ks) {
    for (const id of C.order) {
      const k = C.keyOf(id);
      if (!k) continue;
      if (C.splitKeys(k).includes(ks)) return id;
    }
    return null;
  };
})();
