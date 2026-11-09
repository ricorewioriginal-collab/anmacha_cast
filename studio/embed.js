// AnMaCha Cast – Widget mit einer Zeile auf der eigenen Website einbinden:
// <script src="https://dein-server/embed.js" data-station="main" data-widget="requests" async></script>
// data-widget: hoerer | requests | messages | voice | voting | polls | forms | player; optional data-theme="light",
// data-accent="ff4081", data-height="640", data-lautfm="stationsname" (Player eines laut.fm-Senders).
(() => {
  const me = /** @type {HTMLScriptElement|null} */ (document.currentScript);
  if (!me) return;
  const origin = new URL(me.src).origin + new URL(me.src).pathname.replace(/\/embed\.js$/, '');
  const d = me.dataset;
  const kinds = /** @type {Record<string, [string, string, number]>} */ ({
    hoerer: ['hoerer', '', 720], requests: ['hoerer', 'requests', 640], messages: ['hoerer', 'messages', 520], voice: ['hoerer', 'voice', 480],
    voting: ['hoerer', 'voting', 640], polls: ['hoerer', 'polls', 420], forms: ['hoerer', 'forms', 640], player: ['widget', '', 170],
  });
  const [page, only, h] = kinds[d.widget ?? 'requests'] ?? kinds.requests;
  const q = new URLSearchParams();
  if (page === 'widget' && d.lautfm) q.set('lautfm', d.lautfm);
  else q.set(page === 'widget' ? 'station' : 's', d.station ?? 'main');
  if (only) q.set('only', only);
  if (d.theme === 'light') q.set('theme', 'light');
  if (d.accent) q.set('accent', d.accent.replace(/[^0-9a-f]/gi, ''));
  const f = document.createElement('iframe');
  f.src = `${origin}/${page}.html?${q}`;
  f.title = 'AnMaCha Cast';
  f.loading = 'lazy';
  if (page === 'hoerer' && (!only || only === 'voice')) f.allow = 'microphone';
  f.style.cssText = `width:100%;max-width:640px;height:${Number(d.height) || h}px;border:0;display:block`;
  me.after(f);
})();
