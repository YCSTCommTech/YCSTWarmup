// =====================================================================
// Word Reveal — reverse Zero In with Wordle tiles. Self-paced.
// Clues unlock on a timer (category → subcategory → definition) while the
// student guesses the term. All checking happens on the server; the term
// is only sent once the student solves or misses it.
// Uses helpers from index.html (render, rpc, esc, toast, store, Student...).
// =====================================================================
'use strict';

const WordReveal = {
  student(token, st) {
    clearTimers();
    const W = this.W = { token, s: null, key: '', busy: false, refetch: null, err: '' };
    render(`<div class="wrap center"><p class="muted">Joining…</p></div>`);
    this.fetch();
    every(4000, () => this.fetch());          // catches the teacher closing it
    every(250, () => this.tickClock());       // smooth countdown
  },

  async fetch(fn, args) {
    const W = this.W;
    if (!W || (W.busy && !fn)) return;
    W.busy = true;
    try {
      const s = await rpc(fn || 'wr_state', Object.assign({ p_token: W.token }, args || {}));
      if (this.W !== W) return;
      if (s.error === 'bad_token') { store.del('token'); clearTimers(); return Student.start(); }
      W.err = s.error === 'length' ? `Guesses need ${s.need} letters now.` : s.error === 'empty' ? 'Type a guess first.' : '';
      W.s = s; W.at = Date.now();
      this.scheduleRefetch();
      const key = JSON.stringify([s.status, s.finished, s.cur && [s.cur.qid, s.cur.clues.length, s.cur.guesses.length, s.cur.result, s.cur.shape]]);
      if (key !== W.key || fn) { W.key = key; this.draw(); }
      if (s.status === 'closed') clearTimers();
    } catch (e) { console.warn(e); if (fn) toast('Couldn’t send that. Check your Wi-Fi.'); }
    W.busy = false;
  },

  // Ask the server again right when the next clue (or the time-out) is due.
  scheduleRefetch() {
    const W = this.W, c = W.s && W.s.cur;
    clearTimeout(W.refetch);
    if (!c || c.result) return;
    const due = c.next_in != null ? c.next_in : c.ends_in;
    if (due != null) W.refetch = setTimeout(() => this.fetch(), Math.max(200, due * 1000 + 150));
  },

  secsLeft(v) { return v == null ? null : Math.max(0, v - (Date.now() - this.W.at) / 1000); },

  tickClock() {
    const W = this.W, c = W && W.s && W.s.cur;
    if (!c || c.result) return;
    const nxt = this.secsLeft(c.next_in), end = this.secsLeft(c.ends_in);
    const bar = document.getElementById('wr-bar'), lbl = document.getElementById('wr-next');
    const secs = W.s.clue_secs;
    if (nxt != null && bar) { bar.style.width = (100 - (nxt / secs) * 100) + '%'; lbl.textContent = `Next clue in ${Math.ceil(nxt)}s`; }
    else if (end != null && bar) { bar.style.width = (100 - (end / secs) * 100) + '%'; bar.classList.add('last'); lbl.textContent = `${Math.ceil(end)}s left to guess`; }
  },

  // Group a flat feedback/letters list into the term's words.
  grouped(list, shape) {
    if (!shape) return [list];
    const out = []; let i = 0;
    shape.forEach(n => { out.push(list.slice(i, i + n)); i += n; });
    if (i < list.length) out.push(list.slice(i));
    return out;
  },

  tilesRow(letters, fb, shape, cls) {
    return `<div class="wr-row ${cls || ''}">${this.grouped(letters.map((l, i) => ({ l, f: fb ? fb[i] : '' })), shape)
      .map(word => `<div class="wr-word">${word.map(t => `<span class="wr-tile ${t.f}">${esc(t.l)}</span>`).join('')}</div>`).join('')}</div>`;
  },

  draw() {
    const W = this.W, s = W.s;
    // Keep what the student was typing across redraws.
    const old = document.getElementById('wr-input');
    const typed = old ? old.value : '';
    const hadFocus = old && document.activeElement === old;
    const top = `<div class="hud"><span class="who">${esc(s.student_name)}</span>
      <span class="chip">✓ ${s.solved}</span><span class="chip">⭐ ${s.points} pt${s.points === 1 ? '' : 's'}</span></div>`;
    let body;

    if (s.status === 'closed' || (s.finished && !s.cur)) {
      const closed = s.status === 'closed';
      body = `<div class="center"><div class="big-emoji">${closed ? '✅' : '🏁'}</div>
        <h1>${closed ? 'That’s it for today' : 'You finished the whole deck!'}</h1>
        <div class="stats"><div class="stat"><b>${s.solved}</b><span>Words solved</span></div><div class="stat"><b>${s.points}</b><span>Points</span></div></div>
        ${closed ? '<button class="btn big" data-act="exit">Done</button>' : '<p class="muted">Nice work. Hang tight until your teacher wraps up.</p>'}</div>`;
    } else {
      const c = s.cur;
      const disc = c.guesses.filter(g => g.mode === 'discovery');
      const board = c.guesses.filter(g => g.mode === 'board');
      const clues = c.clues.map((cl, i) => `<div class="wr-clue ${i === c.clues.length - 1 && !c.result ? 'new' : ''}">
          <span class="wr-label">${esc(cl.label)}</span><span class="wr-text">${esc(cl.text)}</span></div>`).join('');
      const locked = Array.from({ length: c.clue_count - c.clues.length }, () => `<div class="wr-clue locked"><span class="wr-label">Clue</span><span class="wr-text">🔒</span></div>`).join('');
      const timer = c.result ? '' : `<div class="wr-timer"><div class="wr-track"><div id="wr-bar" class="wr-bar"></div></div><div id="wr-next" class="small muted"></div></div>`;

      const discHtml = disc.length ? `<div class="wr-disc">${disc.map(g => `<div class="wr-row small-row">${g.g.split('').map((l, i) =>
        `<span class="wr-tile mini ${g.fb[i] === 'in' ? 'near' : 'out'}">${esc(l)}</span>`).join('')}</div>`).join('')}
        <div class="small muted">Yellow = that letter is in the term somewhere.</div></div>` : '';
      const boardHtml = board.map(g => this.tilesRow(g.g.split(''), g.fb, c.shape)).join('');

      let action;
      if (c.result === 'solved') {
        action = `<div class="feedback good"><div class="head">✓ ${esc(c.answer)}</div>
          <div>+${c.points} point${c.points === 1 ? '' : 's'} — solved after ${c.clue_count - c.points + 1} of ${c.clue_count} clue${c.clue_count === 1 ? '' : 's'}</div>
          ${c.sentence ? `<div class="note">${esc(c.sentence)}</div>` : ''}
          ${s.one_word ? '<p class="small" style="margin:10px 0 0">Nice! Wait for the class.</p>' : '<button class="btn big primary" data-act="next" id="wr-nextbtn">Next word →</button>'}</div>`;
      } else if (c.result === 'missed') {
        action = `<div class="feedback bad"><div class="head">Time’s up</div><div>The term was <b>${esc(c.answer)}</b></div>
          ${c.sentence ? `<div class="note">${esc(c.sentence)}</div>` : ''}
          ${s.one_word ? '<p class="small" style="margin:10px 0 0">Wait for the class.</p>' : '<button class="btn big primary" data-act="next" id="wr-nextbtn">Next word →</button>'}</div>`;
      } else {
        const more = c.clue_on_guess && c.clues.length < c.clue_count ? ' Each guess unlocks the next clue \u2014 but fewer clues = more points.' : '';
        const hint = c.discovery_left > 0
          ? `Warm-up guess ${3 - c.discovery_left} of 2: type any word to see which letters are in the term.${more}`
          : `Guess the term: ${c.letters} letters${c.shape.length > 1 ? ` in ${c.shape.length} words (${c.shape.join(' + ')})` : ''}.`;
        action = `<form data-act="guess" class="wr-form">
          <div class="small muted" style="margin-bottom:6px">${hint}</div>
          ${c.shape ? `<div id="wr-preview">${this.tilesRow(Array.from({ length: c.letters }, () => ''), null, c.shape, 'preview')}</div>` : ''}
          <div class="row" style="flex-wrap:nowrap"><input id="wr-input" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false"
            placeholder="${c.discovery_left > 0 ? 'Any word' : 'Your guess'}" data-input="typing" style="flex:1">
          <button class="btn primary" type="submit">Guess</button></div>
          <div class="error small" style="min-height:1.3em;margin-top:4px">${esc(W.err)}</div></form>`;
      }

      body = `<div class="card">
        <div class="row"><div class="kicker">${s.one_word ? 'Word Reveal' : `Word ${s.word_no} of ${s.word_count}`}</div><span class="spacer"></span>
          <span class="small muted">${c.clues.length} of ${c.clue_count} clues</span></div>
        <div class="wr-clues">${clues}${locked}</div>
        ${timer}
        ${discHtml}
        ${board.length ? `<div class="wr-board">${boardHtml}</div>` : ''}
        ${action}
      </div>`;
    }

    render(`<div class="wrap">${top}${body}</div>`, {
      guess: f => this.guess(f),
      typing: el => this.preview(el.value),
      next: () => this.fetch('wr_next'),
      exit: () => { store.del('token'); this.W = null; clearTimers(); Student.start(); }
    });
    const inp = document.getElementById('wr-input');
    if (inp) {
      inp.value = typed; this.preview(typed);
      if (hadFocus || !('ontouchstart' in window)) inp.focus({ preventScroll: true });
    }
    const nb = document.getElementById('wr-nextbtn'); if (nb) nb.focus({ preventScroll: true });
    this.tickClock();
  },

  preview(value) {
    const c = this.W.s && this.W.s.cur, el = document.getElementById('wr-preview');
    if (!c || !c.shape || !el) return;
    const letters = value.toUpperCase().replace(/[^\p{L}]/gu, '').split('').slice(0, c.letters);
    while (letters.length < c.letters) letters.push('');
    // Letters already found in the right spot (green on any board guess).
    const known = Array(c.letters).fill('');
    c.guesses.filter(g => g.mode === 'board').forEach(g => g.fb.forEach((f, i) => { if (f === 'hit') known[i] = g.g[i]; }));
    const shown = [], fb = [];
    letters.forEach((l, i) => {
      if (!l && known[i]) { shown.push(known[i]); fb.push('hint'); }       // empty slot: show the found letter faintly
      else { shown.push(l); fb.push(l && l === known[i] ? 'hit' : ''); } // typed the found letter: solid green
    });
    el.innerHTML = this.tilesRow(shown, fb, c.shape, 'preview');
  },

  async guess(f) {
    const inp = f.querySelector('#wr-input');
    const g = inp.value.trim();
    if (!g) return;
    await this.fetch('wr_guess', { p_guess: g });
    const after = document.getElementById('wr-input');
    if (after && !this.W.err) { after.value = ''; this.preview(''); }
  }
};
