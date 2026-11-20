(() => {
  'use strict';
  const data = window.PlayerLocale;
  if (!data) throw new Error('Missing locale data');
  const t = (key, values = {}) => {
    const message = data.messages[key];
    if (message === undefined) throw new Error('Missing translation: ' + key);
    return message.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? '{' + name + '}'));
  };
  window.PlayerI18n = Object.freeze({ t, locale: data.locale, playerMessages: data.player });
  const menu = document.querySelector('.language-menu');
  document.addEventListener('click', event => { if (!menu.contains(event.target)) menu.open = false; });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary').focus(); }
  });
})();
