/* Cutline — IndexedDB helpers: autosave snapshots and small-media cache. */
(function () {
  'use strict';
  var C = window.Cutline;
  var DB_NAME = 'cutline', DB_VER = 1, dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      if (!window.indexedDB) { rej(new Error('no indexedDB')); return; }
      var r;
      try { r = indexedDB.open(DB_NAME, DB_VER); } catch (e) { rej(e); return; }
      r.onupgradeneeded = function () {
        var db = r.result;
        if (!db.objectStoreNames.contains('media')) db.createObjectStore('media');
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
    dbp.catch(function () { dbp = null; });
    return dbp;
  }
  function tx(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(store, mode), s = t.objectStore(store), out;
        var r = fn(s);
        if (r) r.onsuccess = function () { out = r.result; };
        t.oncomplete = function () { res(out); };
        t.onerror = function () { rej(t.error); };
        t.onabort = function () { rej(t.error); };
      });
    });
  }
  var S = C.Store = {};
  S.mediaKey = function (m) { return (m.file || m.name) + '|' + m.size + '|' + (m.lastModified || 0); };
  S.putMedia = function (key, blob) { return tx('media', 'readwrite', function (s) { return s.put(blob, key); }).catch(function (e) { console.warn('[Cutline] media cache put failed', e); }); };
  S.getMedia = function (key) { return tx('media', 'readonly', function (s) { return s.get(key); }).catch(function () { return null; }); };
  S.mediaKeys = function () { return tx('media', 'readonly', function (s) { return s.getAllKeys(); }).catch(function () { return []; }); };
  S.delMedia = function (key) { return tx('media', 'readwrite', function (s) { return s.delete(key); }).catch(function () {}); };
  S.put = function (key, v) { return tx('kv', 'readwrite', function (s) { return s.put(v, key); }).catch(function () {}); };
  S.get = function (key) { return tx('kv', 'readonly', function (s) { return s.get(key); }).catch(function () { return null; }); };
  S.del = function (key) { return tx('kv', 'readwrite', function (s) { return s.delete(key); }).catch(function () {}); };
})();
