/* Ninja: a small local chat bot for Nitin's site. No AI service and no server: it matches the
   visitor's question against the hand-written notes in ninja/knowledge.json, all in the browser.
   Edit knowledge.json to change what Ninja knows. */
(function () {
  'use strict';

  // ---------- engine (pure, testable in Node) ----------
  var STOP = {};
  ('a an the and or of to in on for with at by from is are was were be been am do does did what whats which who whom how can could would should where when why give tell me about his he him her she nitin nitins ninja you your i my it its this that these those any some there has have had get got please want know like also just really very more so if but not no yes').split(' ').forEach(function (w) { STOP[w] = 1; });

  function stem(w) {
    if (w.length < 4) return w;
    if (/ies$/.test(w)) return w.replace(/ies$/, 'y');
    if (/sses$/.test(w)) return w.slice(0, -2);
    if (/ing$/.test(w) && w.length > 5) return w.slice(0, -3);
    if (/ed$/.test(w) && w.length > 4) return w.slice(0, -2);
    if (/[^s]s$/.test(w)) w = w.slice(0, -1);
    if (w.length > 4 && /e$/.test(w)) w = w.slice(0, -1);
    return w;
  }

  function tokens(str) {
    return (String(str).toLowerCase().match(/[a-z0-9]+/g) || [])
      .filter(function (w) { return w.length > 1 && !STOP[w]; })
      .map(stem);
  }

  function norm(str) { return String(str).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }

  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var prev = [], prev2 = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      var cur = [i], best = i;
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
        if (cur[j] < best) best = cur[j];
      }
      if (best > max) return max + 1;
      prev2 = prev;
      prev = cur;
    }
    return prev[b.length];
  }

  function createEngine(kb) {
    var entries = kb.entries;
    var byId = {}, chipMap = {}, docs = [], titles = [], df = {};

    entries.forEach(function (e) {
      byId[e.id] = e;
      if (e.chip) chipMap[norm(e.chip)] = e.id;
      var w = {};
      function put(str, weight) {
        tokens(str).forEach(function (t) { if (!w[t] || w[t] < weight) w[t] = weight; });
      }
      put(e.title, 3); put(e.k, 2); put(e.ex || '', 1.5);
      var tt = tokens(e.title);
      titles.push({ set: tt, len: tt.length });
      docs.push(w);
      Object.keys(w).forEach(function (t) { df[t] = (df[t] || 0) + 1; });
    });

    var N = entries.length;
    var vocab = Object.keys(df);
    var WEAK = {};
    tokens('experience background information details').forEach(function (t) { WEAK[t] = 1; });
    function idf(t) { return Math.log(1 + N / df[t]); }

    function correct(t) {
      if (df[t] || t.length < 6) return t;
      var max = t.length >= 8 ? 2 : 1, best = t, bestD = max + 1;
      vocab.forEach(function (v) {
        if (v.length < 4) return;
        var d = lev(t, v, max);
        if (d < bestD || (d === bestD && d <= max && df[v] > (df[best] || 0))) { best = v; bestD = d; }
      });
      return bestD <= max ? best : t;
    }

    var routes = (kb.routes || []).map(function (r) { return [new RegExp(r[0], 'i'), r[1]]; });

    function pick(query) {
      var n = norm(query);
      if (chipMap[n]) return { id: chipMap[n], score: 99 };
      for (var ri = 0; ri < routes.length; ri++) {
        if (routes[ri][0].test(query)) return routes[ri][1] === 'none' ? null : { id: routes[ri][1], score: 98 };
      }
      var qt = tokens(query).map(correct);
      var seen = {};
      qt = qt.filter(function (t) { return seen[t] ? false : (seen[t] = 1); });
      if (!qt.length) return null;
      var best = null, bestScore = 0, scored = [];
      docs.forEach(function (w, i) {
        var s = 0;
        qt.forEach(function (t) { if (w[t]) s += idf(t) * w[t] * (WEAK[t] ? 0.4 : 1); });
        var th = qt.some(function (t) { return titles[i].set.indexOf(t) !== -1; }) ? 1 : 0;
        scored.push([entries[i].id, s, th, titles[i].len]);
      });
      scored.sort(function (a, b) { return (b[1] - a[1]) || (b[2] - a[2]) || (a[3] - b[3]); });
      best = scored[0][0]; bestScore = scored[0][1];
      if (bestScore < 2.2) return null;
      var second = scored[1] ? scored[1][1] : 0;
      var low = bestScore < 5 || second > 0.72 * bestScore;
      var s0 = scored[0], s1 = scored[1] || [0, 0, 0, 0];
      var amb = second > 0.92 * bestScore && !(s0[2] && (!s1[2] || s0[3] < s1[3]));
      var alts = scored.filter(function (x) { return x[1] >= 0.5 * bestScore && byId[x[0]].chip; }).slice(0, 3).map(function (x) { return x[0]; });
      return { id: best, score: bestScore, second: second, low: low, amb: amb, alts: alts };
    }

    function chipsFor(ids) {
      return ids.map(function (id) { return byId[id] && byId[id].chip; }).filter(Boolean);
    }

    function reply(query) {
      var hit = pick(query);
      if (!hit) return { text: kb.fallback, chips: chipsFor(kb.chips), id: null };
      var e = byId[hit.id];
      var text = e.a;
      if (e.links && e.links.length) {
        text += '\n' + e.links.map(function (l) { return '[' + l[0] + '](' + l[1] + ')'; }).join(' · ');
      }
      if (hit.amb && hit.alts.length > 1) {
        return { text: 'That could mean a few things. Did you mean one of these?', chips: chipsFor(hit.alts), id: null, amb: true, dbg: [hit.id, hit.score, hit.second, hit.alts] };
      }
      if (hit.low && hit.alts.length > 1) {
        return { text: text + '\nIf that is not what you meant, try one of these.', chips: chipsFor(hit.alts), id: e.id };
      }
      return { text: text, chips: chipsFor(e.related || []), id: e.id };
    }

    return { reply: reply, chipsFor: chipsFor };
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { createEngine: createEngine }; return; }
  if (typeof document === 'undefined') return;

  // ---------- widget ----------
  var scriptEl = document.currentScript;
  var KB_URL = new URL('knowledge.json', scriptEl ? scriptEl.src : location.href).href;
  var MAX_INPUT = 200;

  var engine = null;
  var kbPromise = null;
  var busy = false;
  var chipsRow = null;

  var css = [
    '.ninja-root{--n-bg:#101e35;--n-card:#162240;--n-text:#F5F7FA;--n-muted:#9db4d6;--n-accent:#0DCAD8;--n-bot:#1d2f52;--n-user:#028090;--n-user-text:#fff;--n-border:rgba(13,202,216,.35);--n-shadow:0 12px 40px rgba(0,0,0,.45);font-family:"Courier New",monospace;}',
    'body.formal .ninja-root{--n-bg:#ffffff;--n-card:#f4f8fd;--n-text:#1a2a4a;--n-muted:#5b6b85;--n-accent:#1d4ed8;--n-bot:#eaf1fb;--n-user:#1d4ed8;--n-user-text:#fff;--n-border:rgba(29,78,216,.3);--n-shadow:0 12px 40px rgba(26,42,74,.22);}',
    'body.formal .ninja-root.has-classical{font-family:"Avenir Next","Segoe UI",system-ui,-apple-system,sans-serif;}',
    '.ninja-launcher{position:fixed;left:18px;bottom:18px;z-index:150;display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:999px;border:1.5px solid var(--n-border);background:var(--n-bg);color:var(--n-text);font-weight:600;font-size:14px;line-height:1;font-family:inherit;cursor:pointer;box-shadow:var(--n-shadow);transition:transform .2s,border-color .2s;}',
    '.ninja-launcher:hover{transform:translateY(-2px);border-color:var(--n-accent);}',
    '.ninja-launcher:focus-visible,.ninja-send:focus-visible,.ninja-close:focus-visible,.ninja-chip:focus-visible{outline:2px solid var(--n-accent);outline-offset:2px;}',
    '.ninja-launcher .n-emoji{font-size:20px;line-height:1;}',
    '.ninja-launcher .n-tag{font-weight:400;color:var(--n-muted);}',
    '.ninja-panel{position:fixed;left:18px;bottom:18px;z-index:1000;width:370px;max-width:calc(100vw - 24px);height:min(560px,calc(100vh - 36px));display:none;flex-direction:column;background:var(--n-bg);color:var(--n-text);border:1.5px solid var(--n-border);border-radius:16px;box-shadow:var(--n-shadow);overflow:hidden;}',
    '.ninja-panel.open{display:flex;}',
    '.ninja-head{display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--n-card);border-bottom:1px solid var(--n-border);}',
    '.ninja-head .n-avatar{font-size:26px;line-height:1;}',
    '.ninja-head .n-title{font-weight:700;font-size:15px;}',
    '.ninja-head .n-sub{font-size:12px;color:var(--n-muted);}',
    '.ninja-head .n-grow{flex:1;min-width:0;}',
    '.ninja-close{background:none;border:none;color:var(--n-muted);font-size:22px;line-height:1;cursor:pointer;padding:4px 8px;border-radius:8px;}',
    '.ninja-close:hover{color:var(--n-text);}',
    '.ninja-log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;}',
    '.ninja-msg{max-width:88%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.5;word-wrap:break-word;overflow-wrap:anywhere;}',
    '.ninja-msg.bot{align-self:flex-start;background:var(--n-bot);border-bottom-left-radius:4px;}',
    '.ninja-msg.user{align-self:flex-end;background:var(--n-user);color:var(--n-user-text);border-bottom-right-radius:4px;}',
    '.ninja-msg a{color:var(--n-accent);text-decoration:underline;}',
    '.ninja-msg.user a{color:#fff;}',
    '.ninja-msg .n-line{display:block;}',
    '.ninja-msg .n-line+.n-line{margin-top:6px;}',
    '.ninja-chips{display:flex;flex-wrap:wrap;gap:6px;}',
    '.ninja-chip{font:inherit;font-size:12.5px;padding:6px 10px;border-radius:999px;border:1px solid var(--n-border);background:transparent;color:var(--n-text);cursor:pointer;text-align:left;}',
    '.ninja-chip:hover{background:var(--n-bot);}',
    '.ninja-typing{align-self:flex-start;display:flex;gap:4px;padding:12px 14px;background:var(--n-bot);border-radius:14px;border-bottom-left-radius:4px;}',
    '.ninja-typing span{width:6px;height:6px;border-radius:50%;background:var(--n-muted);animation:ninja-bounce 1s infinite ease-in-out;}',
    '.ninja-typing span:nth-child(2){animation-delay:.15s;}.ninja-typing span:nth-child(3){animation-delay:.3s;}',
    '@keyframes ninja-bounce{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-4px);opacity:1}}',
    '.ninja-form{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--n-border);background:var(--n-card);}',
    '.ninja-input{flex:1;min-width:0;font:inherit;font-size:14px;padding:9px 12px;border-radius:10px;border:1px solid var(--n-border);background:var(--n-bg);color:var(--n-text);}',
    '.ninja-input:focus{outline:none;border-color:var(--n-accent);}',
    '.ninja-send{font:inherit;font-weight:600;font-size:14px;padding:0 14px;border-radius:10px;border:none;background:var(--n-user);color:var(--n-user-text);cursor:pointer;}',
    '.ninja-send:disabled{opacity:.5;cursor:default;}',
    '.ninja-note{font-size:11px;color:var(--n-muted);text-align:center;padding:0 12px 8px;background:var(--n-card);}',
    '@media (max-width:480px){.ninja-panel{left:8px;bottom:8px;width:calc(100vw - 16px);height:calc(100vh - 16px);height:calc(100dvh - 16px);}.ninja-launcher{left:12px;bottom:12px;padding:8px 12px;font-size:12px;}.ninja-launcher .n-emoji{font-size:17px;}}'
  ].join('\n');

  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  var root = h('div', 'ninja-root');
  if (document.getElementById('classical-view')) root.classList.add('has-classical');

  var launcher = h('button', 'ninja-launcher');
  launcher.type = 'button';
  launcher.setAttribute('aria-expanded', 'false');
  launcher.setAttribute('aria-controls', 'ninja-panel');
  launcher.appendChild(h('span', 'n-emoji', '🥷'));
  var lt = h('span', null, 'Chat with Ninja ');
  lt.appendChild(h('span', 'n-tag', '(bot)'));
  launcher.appendChild(lt);

  var panel = h('div', 'ninja-panel');
  panel.id = 'ninja-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Chat with Ninja');

  var head = h('div', 'ninja-head');
  head.appendChild(h('span', 'n-avatar', '🥷'));
  var headText = h('div', 'n-grow');
  headText.appendChild(h('div', 'n-title', 'Ninja'));
  headText.appendChild(h('div', 'n-sub', "Ask about Nitin's research and projects"));
  head.appendChild(headText);
  var closeBtn = h('button', 'ninja-close', '×');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close chat');
  head.appendChild(closeBtn);

  var log = h('div', 'ninja-log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');

  var form = h('form', 'ninja-form');
  var input = h('input', 'ninja-input');
  input.type = 'text';
  input.maxLength = MAX_INPUT;
  input.placeholder = 'Ask Ninja something...';
  input.setAttribute('aria-label', 'Your question');
  input.autocomplete = 'off';
  var sendBtn = h('button', 'ninja-send', 'Send');
  sendBtn.type = 'submit';
  form.appendChild(input);
  form.appendChild(sendBtn);

  var note = h('div', 'ninja-note', 'Ninja is a small bot that answers from Nitin’s notes. It can miss things.');

  panel.appendChild(head);
  panel.appendChild(log);
  panel.appendChild(form);
  panel.appendChild(note);
  root.appendChild(launcher);
  root.appendChild(panel);

  // ---------- rendering (text only; links only for http/https) ----------
  var TOKEN_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?])|\*\*([^*]+)\*\*/g;

  function link(label, url) {
    var a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = label;
    return a;
  }

  function renderInline(parent, text) {
    var last = 0, m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(text)) !== null) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      if (m[2]) parent.appendChild(link(m[1], m[2]));
      else if (m[3]) parent.appendChild(link(m[3], m[3]));
      else if (m[4]) parent.appendChild(h('strong', null, m[4]));
      last = m.index + m[0].length;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  function addMessage(role, text) {
    var box = h('div', 'ninja-msg ' + role);
    text.split('\n').forEach(function (line) {
      if (!line.trim()) return;
      var row = h('span', 'n-line');
      var bullet = /^\s*[-*]\s+/.exec(line);
      if (bullet) {
        row.appendChild(document.createTextNode('• '));
        line = line.slice(bullet[0].length);
      }
      renderInline(row, line);
      box.appendChild(row);
    });
    log.appendChild(box);
    log.scrollTop = log.scrollHeight;
  }

  function clearChips() {
    if (chipsRow) { chipsRow.remove(); chipsRow = null; }
  }

  function showChips(labels) {
    clearChips();
    if (!labels.length) return;
    chipsRow = h('div', 'ninja-chips');
    labels.forEach(function (c) {
      var b = h('button', 'ninja-chip', c);
      b.type = 'button';
      b.addEventListener('click', function () { send(c); });
      chipsRow.appendChild(b);
    });
    log.appendChild(chipsRow);
    log.scrollTop = log.scrollHeight;
  }

  function showTyping() {
    var t = h('div', 'ninja-typing');
    t.appendChild(h('span')); t.appendChild(h('span')); t.appendChild(h('span'));
    log.appendChild(t);
    log.scrollTop = log.scrollHeight;
    return t;
  }

  // ---------- knowledge + chat ----------
  function loadEngine() {
    if (!kbPromise) {
      kbPromise = fetch(KB_URL).then(function (r) {
        if (!r.ok) throw new Error('kb');
        return r.json();
      }).then(function (kb) {
        engine = createEngine(kb);
        return kb;
      });
      kbPromise.catch(function () { kbPromise = null; });
    }
    return kbPromise;
  }

  function send(text) {
    text = (text || '').trim();
    if (!text || busy) return;
    busy = true;
    sendBtn.disabled = true;
    clearChips();
    input.value = '';
    addMessage('user', text);
    var typing = showTyping();

    Promise.all([
      loadEngine(),
      new Promise(function (res) { setTimeout(res, 450); })
    ]).then(function () {
      return engine.reply(text);
    }, function () {
      return { text: "I couldn't load my notes just now. Please try again in a moment, or use the Email me button on the page.", chips: [] };
    }).then(function (r) {
      typing.remove();
      addMessage('bot', r.text);
      showChips(r.chips || []);
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    });
  }

  function open() {
    panel.classList.add('open');
    launcher.style.display = 'none';
    launcher.setAttribute('aria-expanded', 'true');
    input.focus();
    loadEngine();
  }
  function close() {
    panel.classList.remove('open');
    launcher.style.display = '';
    launcher.setAttribute('aria-expanded', 'false');
    launcher.focus();
  }

  launcher.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  form.addEventListener('submit', function (e) { e.preventDefault(); send(input.value); });

  loadEngine().then(function (kb) {
    addMessage('bot', kb.greeting);
    showChips(engine.chipsFor(kb.chips));
  }, function () {
    addMessage('bot', "Hi, I'm Ninja. I couldn't load my notes just now, so try again in a moment.");
  });

  function mount() { document.body.appendChild(root); }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
