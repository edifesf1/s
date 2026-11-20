/* Abre automaticamente a URL colocada diretamente depois de # */
(function () {
  "use strict";
  var raw = window.location.hash.slice(1);
  if (!raw) return;

  // Compatível com #https://site/video.m3u8 e com #url=https://site/video.m3u8
  if (raw.indexOf("url=") === 0) raw = raw.slice(4);
  if (!/^https?:\/\//i.test(raw)) return;

  window.PlayerLaunch = {
    url: raw,
    title: "",
    type: "auto",
    autoplay: true,
    theater: true,
    resume: false
  };
})();
