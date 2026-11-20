(function(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('../core.js') : root.PlayerCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PlayerHistoryBackup = api;
})(typeof window !== 'undefined' ? window : globalThis, function(C) {
  'use strict';
  const FORMAT = 'm3u8-player-history', VERSION = 1, MAX_BYTES = 2 * 1024 * 1024;
  function error(code) { const e = new Error(code); e.code = code; return e; }
  function create(history) {
    return {format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), history: C.cleanHistory(history)};
  }
  function validate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.format !== FORMAT) throw error('backupInvalid');
    if (value.version !== VERSION) throw error('backupVersionError');
    if (!Array.isArray(value.history) || value.history.length > 1000) throw error('backupInvalid');
    const rows = value.history.map(row => {
      if (!row || typeof row !== 'object' || typeof row.url !== 'string' || typeof row.title !== 'string' || row.title.length > 120 || !['hls','video'].includes(row.type) || typeof row.favorite !== 'boolean' || typeof row.live !== 'boolean') throw error('backupInvalid');
      if (['time','duration','updatedAt'].some(k => typeof row[k] !== 'number' || !Number.isFinite(row[k]) || row[k] < 0) || row.updatedAt > 8640000000000000) throw error('backupInvalid');
      let source; try { source = C.parseSource(row.url, row.type); } catch (_) { throw error('backupInvalid'); }
      return {...source, title: row.title, time: row.live ? 0 : row.time, duration: row.live ? 0 : row.duration, updatedAt: row.updatedAt, favorite: row.favorite, live: row.live};
    });
    // Deduplicate the backup first; do not silently discard invalid entries.
    return merge([], rows);
  }
  function parse(text) {
    let value; try { value = JSON.parse(String(text).replace(/^\uFEFF/, '')); } catch (_) { throw error('backupInvalid'); }
    return validate(value);
  }
  function merge(existing, imported) {
    const byUrl = new Map();
    for (const row of [...C.cleanHistory(existing), ...imported]) {
      const old = byUrl.get(row.url);
      const newer = old && old.updatedAt >= row.updatedAt ? old : row;
      byUrl.set(row.url, {...newer, favorite: Boolean(old?.favorite || row.favorite)});
    }
    return C.cleanHistory([...byUrl.values()]);
  }
  function summary(existing, imported) {
    const urls = new Set(existing.map(row => row.url));
    return {count: imported.length, duplicates: imported.filter(row => urls.has(row.url)).length, kept: merge(existing, imported).length};
  }
  return Object.freeze({FORMAT, VERSION, MAX_BYTES, create, validate, parse, merge, summary});
});
