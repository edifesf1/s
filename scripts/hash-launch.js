/* EdifesfPlayer - abertura por URL no hash + resolução de arquivos Raw do GitHub */
(function () {
  "use strict";

  var raw = window.location.hash.slice(1).trim();
  if (!raw) return;

  // Compatível com #https://... e #url=https://...
  if (raw.indexOf("url=") === 0) raw = raw.slice(4);
  if (!/^https?:\/\//i.test(raw)) return;

  function isGithubRawList(url) {
    try {
      var parsed = new URL(url);
      return parsed.hostname.toLowerCase() === "raw.githubusercontent.com" &&
        parsed.pathname.indexOf("/linksm3u8/") !== -1;
    } catch (_) {
      return false;
    }
  }

  function extractStreamUrl(content) {
    var text = String(content || "").replace(/^\uFEFF/, "").trim();
    if (!text) return "";

    // Se o próprio arquivo já for uma playlist HLS, não a trate como um atalho.
    if (/^#EXTM3U\b/i.test(text)) return "";

    var lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line.charAt(0) === "#") continue;

      // Aceita URL simples, inclusive com tokens e query string.
      line = line.replace(/^['"]|['"]$/g, "").trim();
      if (/^https?:\/\//i.test(line)) {
        try {
          return new URL(line).href;
        } catch (_) {
          return "";
        }
      }
    }
    return "";
  }

  function launch(url) {
    window.PlayerLaunch = {
      url: url,
      title: "",
      type: "auto",
      autoplay: true,
      theater: true,
      resume: false
    };
    // O app original já registra este evento e inicia a reprodução.
    window.dispatchEvent(new Event("player:launch"));
  }

  if (!isGithubRawList(raw)) {
    launch(raw);
    return;
  }

  // O Raw do GitHub contém o endereço real da transmissão.
  fetch(raw, { method: "GET", mode: "cors", cache: "no-store" })
    .then(function (response) {
      if (!response.ok) throw new Error("GitHub Raw respondeu HTTP " + response.status);
      return response.text();
    })
    .then(function (content) {
      var stream = extractStreamUrl(content);
      if (!stream) {
        // Se não for um arquivo-atalho de URL, usa o próprio endereço como manifesto.
        launch(raw);
        return;
      }
      launch(stream);
    })
    .catch(function (error) {
      console.error("EdifesfPlayer: não foi possível resolver o arquivo Raw do GitHub:", error);
      // Mantém o comportamento anterior como fallback.
      launch(raw);
    });
})();
