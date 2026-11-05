/* ==========================================================================
   bMAC Studio
   One script for every page. Each module no-ops when its markup is absent.
   ========================================================================== */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var coarse  = window.matchMedia('(hover: none), (pointer: coarse)').matches;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function $(s, c) { return (c || document).querySelector(s); }
  function $$(s, c) { return [].slice.call((c || document).querySelectorAll(s)); }

  /* ======================================================================
     PRELOADER — the square emblem alone, then it opens into the film.
     Gated on the first film segment only. Segments two and three keep
     streaming behind the curtain; nobody waits on 23MB to see a logo.
     ====================================================================== */
  function preloader(onReady) {
    var boot = $('#boot');
    var bar  = $('#bootBar');
    var pct  = $('#bootPct');
    if (!boot) { onReady(); return; }

    /* gate on the film's opening frame, not the whole sequence: the other
       119 keep arriving behind the curtain and the scrubber falls back to
       the nearest one that has landed. */
    var first = $('#filmCanvas') ? new Image() : null;
    var jobs  = 1 + (first ? 1 : 0);
    var done  = 0;
    var freed = false;

    function paint() {
      var p = Math.round(done / jobs * 100);
      if (bar) bar.style.width = p + '%';
      if (pct) pct.textContent = p;
    }
    function hit() { if (!freed) { done++; paint(); if (done >= jobs) release(); } }

    function release() {
      if (freed) return;
      freed = true;
      if (bar) bar.style.width = '100%';
      if (pct) pct.textContent = '100';
      setTimeout(function () {
        document.body.classList.remove('is-booting');
        document.body.classList.add('boot-done');
        onReady();
      }, 260);
    }

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(hit);
      setTimeout(hit, 2500);
    } else { hit(); }

    if (first) {
      var got = false;
      var seen = function () { if (!got) { got = true; hit(); } };
      first.onload = seen;
      first.onerror = seen;
      first.src = '/assets/frames/f1-00.jpg';
      setTimeout(seen, 5000);
    }

    setTimeout(release, 6500);
  }

  /* ======================================================================
     CLIENT REVIEWS
     A reader-driven scroller, not a scroll-pinned one. The buttons step by
     whole cards; everything else (trackpad, touch drag, arrow keys) is the
     browser's own horizontal scrolling, left alone.
     ====================================================================== */
  function reviews() {
    var root = $('.revs');
    if (!root) return;
    var track = $('.revs__track', root);
    var prev  = $('[data-rev="prev"]', root);
    var next  = $('[data-rev="next"]', root);
    var bar   = $('.revs__bar i', root);
    if (!track) return;

    function step() {
      var card = $('.rev', track);
      if (!card) return track.clientWidth;
      var gap = parseFloat(getComputedStyle(track).columnGap || '0') || 0;
      return card.getBoundingClientRect().width + gap;
    }

    function sync() {
      var max = track.scrollWidth - track.clientWidth;
      var p = max > 1 ? track.scrollLeft / max : 1;
      if (bar) bar.style.width = (p * 100).toFixed(1) + '%';
      /* 2px of slack: sub-pixel widths mean scrollLeft rarely lands exactly */
      if (prev) prev.disabled = track.scrollLeft <= 2;
      if (next) next.disabled = track.scrollLeft >= max - 2;
    }

    function go(dir) {
      track.scrollBy({ left: dir * step(), behavior: reduced ? 'auto' : 'smooth' });
    }
    if (prev) prev.addEventListener('click', function () { go(-1); });
    if (next) next.addEventListener('click', function () { go(1); });

    track.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(sync);
    sync();
  }

  /* ======================================================================
     THE FILM
     A pinned stage whose picture is decided entirely by scroll position.

     It paints one of 120 pre-decoded JPEGs onto a canvas rather than playing
     three <video> elements. That is not a stylistic choice: seeking these
     mp4s measured 90-260ms per step, and up to 1.8s for a jump, because
     their keyframes are seconds apart; only a re-encode with dense keyframes
     would change that. A 16ms frame budget cannot absorb a 200ms
     decode, which is exactly why the scrubbed version stuttered. Painting a
     bitmap that is already decoded costs almost nothing, and costs the same
     drawing backwards -- which is what scrolling up asks for.

     Nothing here touches the scroll itself: no preventDefault, no scroll
     hijacking, no programmatic scrolling. The page scrolls natively and this
     only reads where it got to.
     ====================================================================== */

  /* Frames live in assets/frames as three clips of 40. The ranges overlap by
     exactly FADE, so one clip reaches full opacity as the previous reaches
     zero and the join is a dissolve rather than a cut. `bias` is the vertical
     crop anchor: the ident is composed low in frame, so its crop is pushed
     down to keep the wordmark on very wide viewports. */
  var FILM_DIR  = '/assets/frames/';
  var FILM_FADE = 0.015;
  var FILM_SEGS = [
    { tag: 'f1', n: 40, a: 0.000, b: 0.330, bias: 0.62 },
    { tag: 'f2', n: 40, a: 0.315, b: 0.645, bias: 0.50 },
    { tag: 'f3', n: 40, a: 0.630, b: 0.950, bias: 0.50 }
  ];

  /* Loads the sequence in scroll order through a small pool, so the frames
     needed first arrive first. Every read falls back to the nearest frame
     that has actually arrived, so the canvas always has something to draw
     and never blanks part-way down. */
  function frameStore(onFirst) {
    var imgs = {}, firstDone = false;
    FILM_SEGS.forEach(function (s) { imgs[s.tag] = new Array(s.n); });

    var queue = [];
    FILM_SEGS.forEach(function (s) {
      for (var i = 0; i < s.n; i++) queue.push([s.tag, i]);
    });

    var at = 0, live = 0, POOL = 6;
    function pump() {
      while (live < POOL && at < queue.length) {
        var job = queue[at++];
        live++;
        (function (tag, i) {
          var im = new Image();
          im.decoding = 'async';
          im.onload = function () {
            imgs[tag][i] = im;
            if (!firstDone && tag === 'f1' && i === 0) {
              firstDone = true;
              if (onFirst) onFirst();
            }
            live--; pump();
          };
          im.onerror = function () { live--; pump(); };
          im.src = FILM_DIR + tag + '-' + (i < 10 ? '0' + i : i) + '.jpg';
        })(job[0], job[1]);
      }
    }
    pump();

    return {
      /* nearest arrived frame to i, searching outward from it */
      get: function (tag, i) {
        var a = imgs[tag];
        if (!a) return null;
        if (a[i]) return a[i];
        for (var d = 1; d < a.length; d++) {
          if (a[i - d]) return a[i - d];
          if (a[i + d]) return a[i + d];
        }
        return null;
      },
      ready: function () { return firstDone; }
    };
  }

  function film() {
    var section = $('#film');
    if (!section || reduced) return;

    var pin    = $('.film__pin', section);
    var canvas = $('#filmCanvas');
    var cue    = $('#filmCue');
    var rail   = $('#filmRail');
    var nav    = $('#nav');
    var scrim  = $('.film__scrim', section);
    if (!pin || !canvas || !canvas.getContext) return;

    var ctx = canvas.getContext('2d', { alpha: false });
    var raf = null, moved = false, cw = 0, ch = 0;
    var store = frameStore(function () { size(); });

    function size() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var r = canvas.getBoundingClientRect();
      var w = Math.max(1, Math.round(r.width  * dpr));
      var h = Math.max(1, Math.round(r.height * dpr));
      if (w !== cw || h !== ch) { cw = canvas.width = w; ch = canvas.height = h; }
      paint();
    }

    /* cover-fit with a vertical anchor: the canvas equivalent of
       object-fit:cover plus object-position:50% <bias> */
    function cover(img, bias) {
      var ir = img.width / img.height, cr = cw / ch, w, h;
      if (ir > cr) { h = ch; w = ch * ir; } else { w = cw; h = cw / ir; }
      ctx.drawImage(img, (cw - w) / 2, (ch - h) * bias, w, h);
    }

    function progress() {
      var run = section.offsetHeight - pin.offsetHeight;
      if (run <= 0) return 0;
      return clamp(-section.getBoundingClientRect().top / run, 0, 1);
    }

    /* the bar stays out of the film and arrives as it ends. Kept out of the
       painting so it holds even before a frame has landed or after the loop
       has stopped, e.g. when the page opens below the film on #contact. */
    function syncNav() { if (nav) nav.classList.toggle('is-quiet', progress() < 0.82); }

    function paint() {
      syncNav();
      if (!cw || !ch) return;
      var p = progress();
      var base = true, identOp = 0, drew = false;

      for (var i = 0; i < FILM_SEGS.length; i++) {
        var s = FILM_SEGS[i], op = 1;
        if (i > 0)                    op = Math.min(op, clamp((p - s.a) / FILM_FADE, 0, 1));
        if (i < FILM_SEGS.length - 1) op = Math.min(op, clamp((s.b - p) / FILM_FADE, 0, 1));
        if (p < s.a - FILM_FADE) op = 0;
        /* the last clip never drops out: past its end it holds the final frame
           of the house, which then scrolls away with the page */
        if (i < FILM_SEGS.length - 1 && p > s.b + FILM_FADE) op = 0;
        if (i === 0) identOp = op;
        if (op <= 0.004) continue;

        /* scroll position maps straight onto a frame index. No easing, so the
           sequence tracks the wheel exactly and reverses with it. */
        var local = clamp((p - s.a) / (s.b - s.a), 0, 1);
        var img = store.get(s.tag, Math.round(local * (s.n - 1)));
        if (!img) continue;

        /* the clip being left is the base; the one arriving dissolves over it */
        ctx.globalAlpha = base ? 1 : op;
        cover(img, s.bias);
        ctx.globalAlpha = 1;
        base = false; drew = true;
      }
      if (!drew) return;

      if (scrim) scrim.style.opacity = (1 - identOp).toFixed(3);

      /* the ident is a bright field: flip the cue and the cursor to ink */
      if (cue) cue.classList.toggle('on-light', identOp > 0.5);
      document.documentElement.classList.toggle('on-light', identOp > 0.5);

      if (rail) rail.style.width = (p * 100).toFixed(2) + '%';
      if (cue)  cue.style.opacity = moved ? 0 : clamp(1 - p / 0.03, 0, 1);
    }

    function loop() { paint(); raf = requestAnimationFrame(loop); }
    function startLoop() { if (!raf) loop(); }
    function stopLoop() { if (raf) { cancelAnimationFrame(raf); raf = null; } }

    /* rAF gated on visibility is the driver: programmatic scrolls, anchor
       jumps and restored scroll positions never fire scroll events, and a
       backgrounded tab should not be painting frames at all */
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        if (es[0].isIntersecting) startLoop(); else { stopLoop(); syncNav(); }
      }, { rootMargin: '120px' }).observe(section);
    } else { startLoop(); }

    window.addEventListener('resize', size, { passive: true });
    window.addEventListener('orientationchange', size);
    window.addEventListener('scroll', function () { moved = true; },
                            { passive: true, once: true });
    size();
  }

  /* ======================================================================
     HORIZONTAL RUNS
     Vertical scroll slides a track sideways inside a pinned section. The
     section height is measured from the track rather than guessed, so the
     run always ends exactly as the last panel reaches the right edge.

     Below 900px, and for reduced motion, the section un-pins and the track
     becomes an ordinary snap carousel — a thumb is better at that than at
     scrolling vertically to move something horizontally.
     ====================================================================== */
  function hruns() {
    var runs = $$('.hrun');
    if (!runs.length) return;

    var wide = window.matchMedia('(min-width: 901px)');

    runs.forEach(function (sec) {
      var pin   = $('.hrun__pin', sec);
      var vp    = $('.hrun__viewport', sec);
      var track = $('.hrun__track', sec);
      var bar   = $('.hrun__bar i', sec);
      if (!pin || !vp || !track) return;

      var travel = 0, target = 0, current = 0, raf = null, lastFrame = 0;

      function measure() {
        if (!wide.matches || reduced) {
          sec.classList.add('is-static');
          sec.style.height = '';
          track.style.transform = '';
          travel = 0;
          return;
        }
        sec.classList.remove('is-static');
        /* measure unshifted, or the last measurement feeds the next one */
        track.style.transform = 'translate3d(0,0,0)';
        travel = Math.max(0, track.scrollWidth - vp.clientWidth);
        sec.style.height = (pin.offsetHeight + travel) + 'px';
      }

      function readProgress() {
        var run = sec.offsetHeight - pin.offsetHeight;
        if (run <= 0) return 0;
        return clamp(-sec.getBoundingClientRect().top / run, 0, 1);
      }

      function paint() {
        if (!travel) return;
        current = lerp(current, target, 0.12);
        if (Math.abs(target - current) < 0.0002) current = target;
        track.style.transform = 'translate3d(' + (-current * travel).toFixed(2) + 'px,0,0)';
        if (bar) bar.style.width = (current * 100).toFixed(2) + '%';
      }

      function loop() {
        lastFrame = Date.now();
        target = readProgress(); paint();
        raf = requestAnimationFrame(loop);
      }
      function startLoop() {
        if (raf || !travel) return;
        /* Arriving from off-screen, or waking after the tab was throttled:
           the track belongs wherever the scroll position already puts it, so
           take up that position instead of easing in from a stale one. The
           easing is there to smooth continuous scrolling, not to animate the
           run into place on arrival. Without this, reloading mid-run slides
           the track in from the start. */
        if (Date.now() - lastFrame > 250) { target = current = readProgress(); paint(); }
        loop();
      }
      function stopLoop() { if (raf) { cancelAnimationFrame(raf); raf = null; } }

      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (es) {
          if (es[0].isIntersecting) { startLoop(); } else { stopLoop(); }
        }, { rootMargin: '200px' }).observe(sec);
      } else { startLoop(); }

      window.addEventListener('scroll', function () {
        target = readProgress();
        if (Date.now() - lastFrame > 250) current = target;   /* see film() */
        paint();
      }, { passive: true });

      var t = null;
      window.addEventListener('resize', function () {
        clearTimeout(t);
        t = setTimeout(function () {
          measure();
          target = current = readProgress();
          paint();
        }, 120);
      });

      measure();
      target = current = readProgress();
      paint();

      /* web fonts land after first layout and change the card heights, which
         changes nothing horizontally — but a late-loading image without
         intrinsic size would. Re-measure once everything has settled. */
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { measure(); paint(); });
      }
      window.addEventListener('load', function () { measure(); paint(); });
    });
  }

  /* ======================================================================
     ENQUIRY FORM
     The site is static, so there is no backend to post to. Set FORM_ENDPOINT
     to the URL of a form service such as Formspree or Basin and the form
     posts to it silently. (Netlify Forms cannot work here: it only runs on
     sites Netlify hosts, and this one is on GitHub Pages.) When it is set, give the
     form in index.html the same URL as its action, in place of the mailto:,
     so a visitor without JavaScript posts there too.
     Left empty, it falls back to composing the email in the visitor's own
     mail client, which works everywhere but depends on one being set up.
     ====================================================================== */
  var FORM_ENDPOINT = '';

  function enquiry() {
    var wrap   = $('#enqForm');
    var form   = $('#enqFormEl');
    var status = $('#enqStatus');
    var done   = $('#enqDone');
    if (!wrap || !form) return;

    var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    function field(el) { return el.closest('.field'); }
    function mark(el, bad) {
      var f = field(el);
      if (f) f.classList.toggle('is-bad', bad);
      el.setAttribute('aria-invalid', bad ? 'true' : 'false');
      return !bad;
    }

    function check() {
      var ok = [];
      ok.push(mark(form.name,  !form.name.value.trim()));
      ok.push(mark(form.email, !EMAIL.test(form.email.value.trim())));
      ok.push(mark(form.where, !form.where.value.trim()));
      ok.push(mark(form.type,  !form.type.value));
      return ok.every(Boolean);
    }

    /* clear a field's error the moment it is corrected, not on next submit */
    $$('input, select, textarea', form).forEach(function (el) {
      el.addEventListener('input',  function () { mark(el, false); });
      el.addEventListener('change', function () { mark(el, false); });
    });

    function values() {
      return {
        name:    form.name.value.trim(),
        email:   form.email.value.trim(),
        phone:   form.phone.value.trim(),
        where:   form.where.value.trim(),
        type:    form.type.value,
        message: form.message.value.trim()
      };
    }

    function sent() {
      wrap.classList.add('is-sent');
      if (done) done.focus && done.setAttribute('tabindex', '-1');
      if (done) done.focus();
    }

    function viaEmail(v) {
      var body = [
        'Name: '     + v.name,
        'Email: '    + v.email,
        'Phone: '    + (v.phone || '-'),
        'Location: ' + v.where,
        'Project: '  + v.type,
        '',
        v.message || '(no further detail)'
      ].join('\n');

      window.location.href = 'mailto:bruno@bmacstudio.co.uk'
        + '?subject=' + encodeURIComponent('Website enquiry — ' + v.type + ', ' + v.where)
        + '&body='    + encodeURIComponent(body);

      if (done) {
        done.innerHTML = '<h3>Nearly there.</h3><p>Your email app should have opened with '
          + 'the details already filled in — press send and it is with us. If nothing '
          + 'happened, email <a href="mailto:bruno@bmacstudio.co.uk">bruno@bmacstudio.co.uk</a> '
          + 'or call <a href="tel:+447492879494">07492 879494</a>.</p>';
      }
      sent();
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      /* a bot filling every field fills the honeypot too; look like a success
         and do nothing, rather than telling it which check it failed. Its name
         and label are deliberately ones browser autofill does not recognise:
         a field called "company" could be filled in for a real visitor, who
         would then get this false success and their enquiry would be lost. */
      if (form.hp_x && form.hp_x.value) { sent(); return; }

      if (!check()) {
        if (status) { status.textContent = 'Check the highlighted fields.'; status.classList.add('is-bad'); }
        var first = $('.field.is-bad input, .field.is-bad select', form);
        if (first) first.focus();
        return;
      }
      if (status) { status.textContent = ''; status.classList.remove('is-bad'); }

      var v = values();
      if (!FORM_ENDPOINT) { viaEmail(v); return; }

      if (status) status.textContent = 'Sending…';
      fetch(FORM_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(v)
      }).then(function (r) {
        if (!r.ok) throw new Error(r.status);
        if (status) status.textContent = '';
        sent();
      }).catch(function () {
        /* the endpoint is down or blocked: fall back rather than lose the lead */
        if (status) status.textContent = '';
        viaEmail(v);
      });
    });
  }

  /* ======================================================================
     REVEALS — structural entrances, fired once as each block arrives
     ====================================================================== */
  function reveals() {
    var items = $$('[data-rv],[data-stagger],[data-lines]');
    if (!items.length) return;

    if (reduced || !('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('in'); });
      return;
    }

    $$('[data-stagger]').forEach(function (g) {
      var step = parseInt(g.getAttribute('data-stagger'), 10) || 70;
      [].slice.call(g.children).forEach(function (c, i) {
        c.style.setProperty('--d', i * step + 'ms');
      });
    });
    $$('[data-lines]').forEach(function (g) {
      var step = parseInt(g.getAttribute('data-lines'), 10) || 95;
      $$('.ln', g).forEach(function (c, i) {
        var inner = c.querySelector('span');
        if (inner) inner.style.setProperty('--d', i * step + 'ms');
      });
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.06 });

    items.forEach(function (el) { io.observe(el); });
  }

  /* ======================================================================
     NAV
     ====================================================================== */
  function navigation() {
    var nav  = $('#nav');
    var hasFilm = $('#film');
    if (!nav) return;

    if (!hasFilm || reduced) nav.classList.remove('is-quiet');

    function onScroll() { nav.classList.toggle('is-solid', window.scrollY > 24); }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ======================================================================
     SERVICES DRAWER — a plan chest opening under the bar
     ====================================================================== */
  function drawer() {
    var btn = $('#svcBtn');
    var box = $('#svcDrawer');
    if (!btn || !box) return;

    var open = false, timer = null;

    function show() {
      clearTimeout(timer);
      box.hidden = false;
      void box.offsetHeight;
      box.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      open = true;
    }
    function hide() {
      box.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      open = false;
      timer = setTimeout(function () { if (!open) box.hidden = true; }, 720);
    }

    btn.addEventListener('click', function (e) { e.preventDefault(); if (open) { hide(); } else { show(); } });
    btn.addEventListener('mouseenter', show);

    /* The drawer sits behind the bar rather than inside it, so leaving the bar
       on the way down to a service must not close it. Close only once the
       pointer is outside both. Measured from the boxes, which ignore the
       clip-path, so a quick move while the drawer is still sliding open
       counts as inside too. */
    var bar = btn.closest('.nav');
    function inside(x, y) {
      return [bar, box].some(function (el) {
        if (!el) return false;
        var r = el.getBoundingClientRect();
        return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
      });
    }
    document.addEventListener('mousemove', function (e) {
      if (open && !inside(e.clientX, e.clientY)) hide();
    }, { passive: true });
    document.addEventListener('mouseout', function (e) {
      if (open && !e.relatedTarget) hide();   /* pointer left the window */
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) { hide(); btn.focus(); }
    });
    document.addEventListener('click', function (e) {
      if (open && !box.contains(e.target) && !btn.contains(e.target)) hide();
    });
  }

  /* ======================================================================
     MOBILE MENU
     ====================================================================== */
  function mobileMenu() {
    var btn  = $('#burger');
    var menu = $('#mobilemenu');
    if (!btn || !menu) return;

    var open = false, timer = null;

    function show() {
      clearTimeout(timer);
      menu.hidden = false;
      void menu.offsetHeight;               /* rAF is unreliable in a hidden tab */
      menu.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      btn.setAttribute('aria-label', 'Close menu');
      document.body.style.overflow = 'hidden';
      open = true;
    }
    function hide() {
      menu.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-label', 'Open menu');
      document.body.style.overflow = '';
      open = false;
      timer = setTimeout(function () { if (!open) menu.hidden = true; }, 600);
    }

    btn.addEventListener('click', function () { if (open) { hide(); } else { show(); } });
    $$('a', menu).forEach(function (a) { a.addEventListener('click', hide); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && open) hide(); });
  }

  /* ======================================================================
     SECTION RAIL — which part of a long page you are in
     ====================================================================== */
  function rail() {
    var links = $$('.body__rail a');
    if (!links.length || !('IntersectionObserver' in window)) return;

    var map = {};
    links.forEach(function (a) {
      var t = document.getElementById(a.getAttribute('href').slice(1));
      if (t) map[t.id] = a;
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var a = map[e.target.id];
        if (!a || !e.isIntersecting) return;
        links.forEach(function (l) { l.classList.remove('on'); });
        a.classList.add('on');
      });
    }, { rootMargin: '-25% 0px -60% 0px' });

    Object.keys(map).forEach(function (id) { io.observe(document.getElementById(id)); });
  }

  /* ======================================================================
     CURSOR — a small yellow square, eased, never floaty
     ====================================================================== */
  function cursor() {
    var el = $('#cur');
    if (!el || coarse || reduced) return;

    var HOT  = 'a, button, summary, .hcard, .shot, .appr__shot, [role="button"]';
    var TEXT = 'input, textarea, select, [contenteditable]';

    var x = window.innerWidth / 2, y = window.innerHeight / 2;
    var cx = x, cy = y, live = false;

    document.documentElement.classList.add('cursor-on');

    window.addEventListener('mousemove', function (e) {
      x = e.clientX; y = e.clientY;
      if (!live) { live = true; cx = x; cy = y; }

      var t = e.target;
      el.classList.toggle('hot', !!(t.closest && t.closest(HOT)));
      var overText = !!(t.closest && t.closest(TEXT));
      el.classList.toggle('on', !overText);
    }, { passive: true });

    window.addEventListener('mouseout', function (e) {
      if (!e.relatedTarget) el.classList.remove('on');
    });

    /* the square is yellow, which vanishes on a light ground. Half the page is
       paper now, so every paper band is a light zone -- not just the one
       yellow panel this used to look for. */
    var lightZones = $$('.band--paper, .pcta');
    function overLight() {
      if (document.documentElement.classList.contains('on-light')) return true;
      for (var i = 0; i < lightZones.length; i++) {
        var r = lightZones[i].getBoundingClientRect();
        if (cy >= r.top && cy <= r.bottom) return true;
      }
      return false;
    }

    (function tick() {
      cx = lerp(cx, x, 0.32);
      cy = lerp(cy, y, 0.32);
      el.style.transform = 'translate3d(' + cx.toFixed(2) + 'px,' + cy.toFixed(2) + 'px,0)';
      el.classList.toggle('inv', overLight());
      requestAnimationFrame(tick);
    })();
  }

  /* ======================================================================
     LANDING ON A #SECTION
     The browser jumps to the hash while the preloader is still up, before
     hruns() has set the sideways runs to their measured heights. On the
     homepage that moved #contact after the jump (2,250px down on a desktop,
     675px up on a phone), so every "Start an enquiry" missed the form. Jump
     again now the page is its real length. The boot locks scrolling until
     start() runs, so this does not pull anyone back from where they scrolled.
     ====================================================================== */
  function landOnHash() {
    var id = location.hash.slice(1);
    if (!id) return;
    /* a reload or Back keeps the position the browser restores */
    var entry = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    if (entry && entry.type !== 'navigate') return;
    var el;
    try { el = document.getElementById(decodeURIComponent(id)); } catch (e) { return; }
    if (!el) return;
    /* a jump, not a 2,000px glide: html carries scroll-behavior:smooth */
    var root = document.documentElement, was = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    el.scrollIntoView(true);
    root.style.scrollBehavior = was;
  }

  /* ======================================================================
     BOOT
     ====================================================================== */
  function start() {
    navigation();
    drawer();
    mobileMenu();
    rail();
    cursor();
    film();
    reviews();
    hruns();
    enquiry();
    reveals();
    landOnHash();   /* last: after hruns() has given the page its real length */
  }

  if (document.body && document.body.classList.contains('is-booting')) {
    preloader(start);
  } else {
    start();
  }
})();
