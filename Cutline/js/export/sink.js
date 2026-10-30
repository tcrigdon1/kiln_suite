/* Cutline — export output sinks. Muxers write sequentially and patch a few header bytes at the end.
   FileSink streams to a FileSystemWritableFileStream (from showSaveFilePicker / a directory handle) with explicit
   positions, so nothing but the in-flight writes is held in memory and the header patches are real seeks.
   BlobSink is the fallback: data is consolidated into Blob parts every few MB (Blobs can be paged to disk by the
   browser); only the small header parts that get patched stay as plain byte arrays. */
(function () {
  'use strict';
  var C = window.Cutline;

  function asParts(data) { return Array.isArray(data) ? data : [data]; }
  function partsLen(parts) { var n = 0; parts.forEach(function (p) { n += p.byteLength != null ? p.byteLength : p.size; }); return n; }

  function FileSink(writable, name) {
    this.w = writable; this.name = name; this.pos = 0; this.size = 0; this.q = Promise.resolve(); this.pending = 0; this.err = null; this.kind = 'file';
    this.HIGH = 24 * 1048576;
  }
  FileSink.prototype._do = function (position, parts) {
    var self = this, len = partsLen(parts);
    this.pending += len;
    var data = parts.length === 1 && parts[0].byteLength != null ? parts[0] : new Blob(parts);
    this.q = this.q.then(function () {
      if (self.err) return;
      return self.w.write({ type: 'write', position: position, data: data });
    }).then(function () { self.pending -= len; }, function (e) { self.pending -= len; self.err = self.err || e; });
    return this.q;
  };
  // append (data: Uint8Array | Blob | array of those); patchable is ignored (any byte can be rewritten)
  FileSink.prototype.write = function (data) {
    var parts = asParts(data), at = this.pos, len = partsLen(parts);
    this.pos += len; this.size = Math.max(this.size, this.pos);
    return this._do(at, parts);
  };
  FileSink.prototype.patch = function (position, bytes) { return this._do(position, [bytes]); };
  // resolves when buffered writes drop below the high-water mark (back-pressure for the export loop)
  FileSink.prototype.ready = function () {
    var self = this;
    if (this.err) return Promise.reject(this.err);
    if (this.pending < this.HIGH) return Promise.resolve();
    return new Promise(function (res, rej) { (function wait() { if (self.err) rej(self.err); else if (self.pending < self.HIGH / 2) res(); else setTimeout(wait, 5); })(); });
  };
  FileSink.prototype.close = function () {
    var self = this;
    return this.q.then(function () { if (self.err) throw self.err; return self.w.close(); }).then(function () { return { file: true, size: self.size, name: self.name }; });
  };
  FileSink.prototype.abort = function () {
    var self = this;
    this.err = this.err || new Error('aborted');
    return this.q.catch(function () { }).then(function () { if (self.w.abort) return self.w.abort(); return self.w.close(); }).catch(function () { });
  };

  function BlobSink(type) {
    this.type = type || 'application/octet-stream'; this.kind = 'blob';
    this.parts = []; // {start, len, u8?, blob?, patchable}
    this.loose = []; this.looseLen = 0; this.looseStart = 0; this.pos = 0; this.size = 0;
    this.CONSOLIDATE = 8 * 1048576;
  }
  BlobSink.prototype._flushLoose = function () {
    if (!this.loose.length) return;
    this.parts.push({ start: this.looseStart, len: this.looseLen, blob: new Blob(this.loose) });
    this.loose = []; this.looseLen = 0;
  };
  BlobSink.prototype.write = function (data, patchable) {
    var parts = asParts(data), len = partsLen(parts);
    if (patchable) {
      this._flushLoose();
      var u8 = parts.length === 1 && parts[0].byteLength != null ? parts[0] : null;
      if (!u8) { u8 = new Uint8Array(len); var o = 0; parts.forEach(function (p) { u8.set(p, o); o += p.byteLength; }); }
      this.parts.push({ start: this.pos, len: len, u8: u8, patchable: true });
    } else {
      if (!this.loose.length) this.looseStart = this.pos;
      for (var i = 0; i < parts.length; i++) this.loose.push(parts[i]);
      this.looseLen += len;
      if (this.looseLen >= this.CONSOLIDATE) this._flushLoose();
    }
    this.pos += len; this.size = this.pos;
    return Promise.resolve();
  };
  BlobSink.prototype.patch = function (position, bytes) {
    for (var i = 0; i < this.parts.length; i++) {
      var p = this.parts[i];
      if (p.u8 && position >= p.start && position + bytes.length <= p.start + p.len) { p.u8.set(bytes, position - p.start); return Promise.resolve(); }
    }
    return Promise.reject(new Error('BlobSink: patch outside a patchable part @' + position));
  };
  BlobSink.prototype.ready = function () { return Promise.resolve(); };
  BlobSink.prototype.close = function () {
    this._flushLoose();
    var blob = new Blob(this.parts.map(function (p) { return p.u8 || p.blob; }), { type: this.type });
    this.parts = [];
    return Promise.resolve({ blob: blob, size: blob.size });
  };
  BlobSink.prototype.abort = function () { this.parts = []; this.loose = []; return Promise.resolve(); };

  C.FileSink = FileSink;
  C.BlobSink = BlobSink;
})();
