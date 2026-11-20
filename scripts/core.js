
/* EdifesfPlayer - Core */
const HISTORY_KEY = "m3u8play.history.v2";
const PREFS_KEY = "m3u8play.preferences.v2";
const MAX_HISTORY = 50;

function inputError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function parseSource(value, format = "auto", pageProtocol = "") {
  const raw = String(value || "").trim();

  if (!raw) {
    throw inputError("urlEmpty", "Informe uma URL.");
  }

  if (raw.length > 16384) {
    throw inputError("urlLong", "A URL é muito longa.");
  }

  let url;

  try {
    url = new URL(raw);
  } catch {
    throw inputError("urlInvalid", "Informe uma URL HTTP ou HTTPS válida.");
  }

  if (!["https:", "http:"].includes(url.protocol)) {
    throw inputError("urlProtocol", "Somente HTTP e HTTPS são suportados.");
  }

  if (url.username || url.password) {
    throw inputError("urlCredentials", "A URL não pode conter credenciais.");
  }

  if (pageProtocol === "https:" && url.protocol === "http:") {
    throw inputError("urlHttps", "Use uma URL HTTPS nesta página.");
  }

  const type =
    format === "hls" ? "hls" :
    format === "video" ? "video" :
    /\.(mp4|webm|og[gv]|mov|m4v)$/i.test(url.pathname) ? "video" :
    "hls";

  return {
    url: url.href,
    type
  };
}

export function sourceTitle(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();

    return (last ? decodeURIComponent(last) : u.hostname).slice(0, 120);
  } catch {
    return "Vídeo sem nome";
  }
}

export function sourceHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "Fonte desconhecida";
  }
}

export function finite(value, fallback = 0) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function cleanHistory(value) {
  if (!Array.isArray(value)) return [];

  const byUrl = new Map();

  for (const item of value.slice(0, 1000)) {
    if (!item || typeof item !== "object") continue;

    try {
      const source = parseSource(item.url, item.type);

      const row = {
        ...source,
        title: typeof item.title === "string"
          ? item.title.slice(0, 120)
          : sourceTitle(source.url),
        time: finite(item.time),
        duration: finite(item.duration),
        updatedAt: Math.min(
          finite(item.updatedAt),
          8640000000000000
        ),
        favorite: item.favorite === true,
        live: item.live === true
      };

      if (row.live) {
        row.time = 0;
        row.duration = 0;
      }

      if (
        !byUrl.has(row.url) ||
        byUrl.get(row.url).updatedAt < row.updatedAt
      ) {
        byUrl.set(row.url, row);
      }
    } catch {
      // Ignora registros inválidos.
    }
  }

  return [...byUrl.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_HISTORY);
}

export function upsertHistory(rows, item) {
  return cleanHistory([
    item,
    ...rows.filter(row => row.url !== item.url)
  ]);
}

export function resumeTime(item, duration, live = false) {
  const time = finite(item?.time);

  return !live &&
    !item?.live &&
    Number.isFinite(duration) &&
    time >= 5 &&
    time < duration - 5
      ? time
      : 0;
}

export function formatTime(value) {
  const seconds = Math.floor(finite(value));
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor(seconds / 60) % 60;

  return `${hours ? hours + ":" : ""}${
    hours ? String(mins).padStart(2, "0") : mins
  }:${String(seconds % 60).padStart(2, "0")}`;
}

export function toVtt(text) {
  const clean = String(text)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();

  if (!clean) {
    throw inputError("subtitleEmpty", "Arquivo de legenda vazio.");
  }

  if (
    !/\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}\s+-->\s+\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}/.test(clean)
  ) {
    throw inputError("subtitleInvalid", "Formato de legenda inválido.");
  }

  if (/^WEBVTT(?:\s|$)/.test(clean)) return clean;

  return "WEBVTT\n\n" +
    clean.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
}

export {
  HISTORY_KEY,
  PREFS_KEY,
  MAX_HISTORY
};

