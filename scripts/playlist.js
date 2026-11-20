
/* EdifesfPlayer - Playlist */

import { parseSource, sourceTitle } from "./core.js";

export const QUEUE_KEY = "m3u8play.queue.v1";
export const OPTIONS_KEY = "m3u8play.queue-options.v1";
export const QUEUE_LIMIT = 100;

export function cleanQueue(rows, protocol = "https:") {
  const items = new Map();

  if (!Array.isArray(rows)) return [];

  for (const row of rows.slice(0, 1000)) {
    try {
      const source = parseSource(row?.url, row?.type, protocol);

      if (!items.has(source.url)) {
        items.set(source.url, {
          ...source,
          title:
            typeof row.title === "string" && row.title.trim()
              ? row.title.trim().slice(0, 120)
              : sourceTitle(source.url)
        });
      }
    } catch (_) {
      // Ignora URLs inválidas.
    }

    if (items.size === QUEUE_LIMIT) break;
  }

  return [...items.values()];
}

export function parseBatch(text, existing = [], protocol = "https:") {
  const lines = String(text)
    .split(/\r?\n/)
    .map((text, index) => ({
      text: text.trim(),
      line: index + 1
    }))
    .filter(row => row.text);

  if (!lines.length) return { error: "queueEmpty" };

  if (lines.length > 1000 || String(text).length > 2 * 1024 * 1024) {
    return { error: "queueFull" };
  }

  const items = cleanQueue(existing, protocol);
  const seen = new Set(items.map(item => item.url));

  let added = 0;
  let duplicates = 0;

  for (const row of lines) {
    const named =
      !/^https?:\/\//i.test(row.text) &&
      /^(.*?)\s+\|\s+(https?:\/\/.*)$/i.exec(row.text);

    let source;

    try {
      source = parseSource(
        named ? named[2] : row.text,
        "auto",
        protocol
      );
    } catch (error) {
      return {
        error: "queueInvalid",
        line: row.line,
        reason: error.code || "urlInvalid"
      };
    }

    if (seen.has(source.url)) {
      duplicates++;
      continue;
    }

    if (items.length === QUEUE_LIMIT) {
      return { error: "queueFull" };
    }

    seen.add(source.url);
    added++;

    items.push({
      ...source,
      title:
        named && named[1].trim()
          ? named[1].trim().slice(0, 120)
          : sourceTitle(source.url)
    });
  }

  return {
    items,
    added,
    duplicates
  };
}

