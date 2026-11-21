// =====================================================================
// Zero In — teacher-paced vocab game.
// Pick a word (vote or wheel) → Round 1 general → Round 2 specific →
// Round 3 definition → final card. The teacher's screen drives every step;
// the current step lives in sessions.live, students follow along by polling.
// Uses the helpers defined in index.html (render, rpc, q, sb, esc, every...).
// =====================================================================
'use strict';

const ZeroIn = {
  PROMPTS: ['Which area does this word belong to?', 'Narrow it down:', 'What does it mean?'],
  ROUND_NAMES: ['General', 'More specific', 'Definition'],

  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  },

  // ===================================================================
  // TEACHER (projector + controls)
  // ===================================================================
  async host(s) {
    const H = this.H = {
      s,
      words: await q(sb.from('questions').select('id,prompt,answer,data').eq('unit_id', s.unit_id).order('sort')),
      live: Object.assign({ phase: 'pick', seq: 0, played: [] }, s.live || {}),
      counts: {}, answered: 0, joined: 0, animateSpin: false
    };
    H.byId = new Map(H.words.map(w => [w.id, w]));
    if (H.live.phase === 'ended') H.live.phase = 'pick'; // reopened after ending
    if (!H.live.played) H.live.played = [];
    await this.poll();
    this.drawHost();
    let busy = false;
    every(1500, async () => {
      if (busy || this.H !== H || !document.getElementById('zi-proj')) return;
      busy = true;
      try { const before = JSON.stringify([H.counts, H.answered, H.joined]); await this.poll(); if (JSON.stringify([H.counts, H.answered, H.joined]) !== before) this.drawHost(); }
      catch (e) { console.warn(e); }
      busy = false;
    });
  },

  // Answer counts for the current step + how many students have joined.
  async poll() {
    const H = this.H, lv = H.live;
    const { count } = await sb.from('participants').select('id', { count: 'exact', head: true }).eq('session_id', H.s.id);
    H.joined = count || 0;
    H.counts = {}; H.answered = 0;
    if (lv.phase === 'vote') {
      const rows = await q(sb.from('zi_votes').select('choice, participants!inner(session_id)').eq('step', lv.seq).eq('participants.session_id', H.s.id));
      rows.forEach(r => { H.counts[r.choice] = (H.counts[r.choice] || 0) + 1; });
      H.answered = rows.length;
    } else if (lv.phase === 'round') {
      const rows = await q(sb.from('attempts').select('response, participants!inner(session_id)').eq('step', lv.seq).eq('participants.session_id', H.s.id));
      rows.forEach(r => { H.counts[r.response] = (H.counts[r.response] || 0) + 1; });
      H.answered = rows.length;
    }
  },

  async save(next) {
    const H = this.H;
    const live = Object.assign({}, next, { played: next.played || H.live.played });
    await q(sb.from('sessions').update({ live }).eq('id', H.s.id));
    H.live = live;
    await this.poll();
    this.drawHost();
  },

  unplayed() { return this.H.words.filter(w => !this.H.live.played.includes(w.id)); },
  nextSeq() { return (this.H.live.seq || 0) + 1; },

  async startVote() {
    const pool = this.shuffle(this.unplayed()).slice(0, 3);
    if (!pool.length) return;
    if (pool.length === 1) return this.startWord(pool[0].id);
    await this.save({ phase: 'vote', seq: this.nextSeq(), cands: pool.map(w => ({ id: w.id, word: w.prompt })), revealed: false });
  },

  async startWheel(cands) {
    const pool = cands || this.unplayed().map(w => ({ id: w.id, word: w.prompt }));
    if (!pool.length) return;
    await this.save({ phase: 'wheel', seq: this.nextSeq(), cands: pool, winner: null, angle: 0 });
  },

  async spin() {
    const lv = this.H.live;
    if (lv.winner) return;
    const n = lv.cands.length, idx = Math.floor(Math.random() * n), seg = 360 / n;
    this.H.animateSpin = true;
    await this.save(Object.assign({}, lv, { winner: lv.cands[idx].id, angle: 360 * 6 + (360 - (idx * seg + seg / 2)) }));
  },

  async startWord(id) {
    const w = this.H.byId.get(id);
    const rd = w.data.rounds[0];
    await this.save({
      phase: 'round', seq: this.nextSeq(), qid: id, r: 0, revealed: false,
      options: this.shuffle(rd.correct.concat(rd.wrong)),
      played: this.H.live.played.concat(id)
    });
  },

  async reveal() {
    const H = this.H, lv = H.live;
    await this.poll();
    const next = Object.assign({}, lv, { revealed: true });
    if (lv.phase === 'vote') {
      const max = Math.max(0, ...lv.cands.map(c => H.counts[c.id] || 0));
      next.winners = lv.cands.filter(c => (H.counts[c.id] || 0) === max).map(c => c.id);
    }
    await this.save(next);
  },

  async next() {
    const H = this.H, lv = H.live;
    if (lv.phase === 'vote') {
      const top = lv.cands.filter(c => lv.winners.includes(c.id));
      return top.length > 1 ? this.startWheel(top) : this.startWord(top[0].id);
    }
    if (lv.phase === 'wheel') return this.startWord(lv.winner);
    if (lv.phase === 'round' && lv.r < 2) {
      const rd = H.byId.get(lv.qid).data.rounds[lv.r + 1];
      return this.save({ phase: 'round', seq: this.nextSeq(), qid: lv.qid, r: lv.r + 1, revealed: false, options: this.shuffle(rd.correct.concat(rd.wrong)) });
    }
    if (lv.phase === 'round') return this.save({ phase: 'final', seq: this.nextSeq(), qid: lv.qid });
  },

  async toPick() { await this.save({ phase: 'pick', seq: this.nextSeq() }); },
  async resetWords() { await this.save({ phase: 'pick', seq: this.nextSeq(), played: [] }); },

  async end() {
    if (!confirm('End Zero In for today? Students will see their totals.')) return;
    await q(sb.from('sessions').update({ status: 'closed', closed_at: new Date().toISOString(), live: Object.assign({}, this.H.live, { phase: 'ended' }) }).eq('id', this.H.s.id));
    clearTimers(); this.H = null;
    Teacher.route(location.hash);
  },

  bars(opts, isCorrect, revealed) {
    const H = this.H;
    const total = opts.reduce((n, o) => n + (H.counts[o.key] || 0), 0) || 1;
    return `<div class="zi-opts">${opts.map(o => {
      const n = H.counts[o.key] || 0, ok = revealed && isCorrect(o.key);
      return `<div class="zi-opt ${ok ? 'correct' : ''}"><div class="bar" style="width:${revealed ? Math.round(n / total * 100) : 0}%"></div>
        <div class="txt">${esc(o.label)}${ok ? ' <span class="ck">✓</span>' : ''}</div><div class="cnt">${revealed ? n : ''}</div></div>`;
    }).join('')}</div>`;
  },

  wheelSvg(cands) {
    const n = cands.length, r = 150, cols = ['#0f766e', '#115e59', '#64748b', '#0d9488', '#334155', '#134e4a'];
    let svg = '';
    cands.forEach((c, i) => {
      const a0 = (i / n) * 2 * Math.PI - Math.PI / 2, a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
      const x0 = r + r * Math.cos(a0), y0 = r + r * Math.sin(a0), x1 = r + r * Math.cos(a1), y1 = r + r * Math.sin(a1);
      const mid = (a0 + a1) / 2, tx = r + r * 0.55 * Math.cos(mid), ty = r + r * 0.55 * Math.sin(mid);
      const fs = Math.min(15, 210 / Math.max(6, c.word.length));
      svg += n === 1 ? `<circle cx="${r}" cy="${r}" r="${r}" fill="${cols[0]}"/>`
        : `<path d="M${r},${r} L${x0},${y0} A${r},${r} 0 ${n === 2 ? 1 : 0},1 ${x1},${y1} Z" fill="${cols[i % cols.length]}" stroke="#fff" stroke-width="2"/>`;
      svg += `<text x="${tx}" y="${ty}" fill="#fff" font-size="${fs}" font-weight="800" text-anchor="middle" dominant-baseline="middle" transform="rotate(${mid * 180 / Math.PI},${tx},${ty})">${esc(c.word)}</text>`;
    });
    return svg;
  },

  drawHost() {
    const H = this.H, lv = H.live, s = H.s;
    const btn = (label, act, cls) => `<button class="btn ${cls || ''}" data-act="${act}">${esc(label)}</button>`;
    let proj = '', ctl = '';
    const waiting = `${H.answered}/${H.joined} answered · counts hidden until you reveal`;

    if (lv.phase === 'pick') {
      const left = this.unplayed().length;
      proj = `<div class="zi-tag">Ready</div><div class="zi-big">Zero In</div>
        <div class="zi-prompt">Pick how we choose the next word.</div>
        <div class="zi-pool">${H.words.map(w => `<span class="zi-chip ${lv.played.includes(w.id) ? 'played' : ''}">${esc(w.prompt)}</span>`).join('')}</div>
        <div class="zi-status">${left} word${left === 1 ? '' : 's'} left · ${H.joined} student${H.joined === 1 ? '' : 's'} joined</div>`;
      ctl = left ? btn('Vote', 'vote', 'primary big') + btn('Wheel', 'wheel', 'primary big') + btn('End for today', 'end')
        : btn('Play the list again', 'resetWords', 'primary big') + btn('End for today', 'end');
    } else if (lv.phase === 'vote') {
      const max = lv.revealed ? Math.max(0, ...lv.cands.map(c => H.counts[c.id] || 0)) : 0;
      const tied = lv.revealed && (lv.winners || []).length > 1;
      proj = `<div class="zi-tag">Vote</div><div class="zi-big" style="font-size:clamp(28px,4vw,44px)">Which word do we zero in on?</div>
        ${this.bars(lv.cands.map(c => ({ key: c.id, label: c.word })), k => (H.counts[k] || 0) === max && (lv.winners || []).includes(k), lv.revealed)}
        <div class="zi-status">${lv.revealed ? (tied ? 'Tie! The wheel breaks it.' : 'Winner locked in.') : waiting}</div>`;
      ctl = lv.revealed ? btn(tied ? 'Spin to break the tie' : 'Start round 1', 'next', 'primary big')
        : btn('Reveal', 'reveal', 'primary big') + btn('Back', 'toPick');
    } else if (lv.phase === 'wheel') {
      const win = lv.winner ? lv.cands.find(c => c.id === lv.winner) : null;
      const startAngle = H.animateSpin ? 0 : (lv.angle || 0);
      proj = `<div class="zi-tag">Wheel</div>
        <div class="zi-wheel"><div class="zi-pointer"></div><svg id="zi-svg" viewBox="0 0 300 300" style="transform:rotate(${startAngle}deg)">${this.wheelSvg(lv.cands)}</svg></div>
        <div class="zi-winner" id="zi-winner">${win && !H.animateSpin ? esc(win.word) : ''}</div>`;
      ctl = !lv.winner ? btn('Spin', 'spin', 'primary big') + btn('Back', 'toPick')
        : `<span id="zi-start" ${H.animateSpin ? 'style="visibility:hidden"' : ''}>${btn('Start round 1', 'next', 'primary big')}</span>`;
    } else if (lv.phase === 'round') {
      const w = H.byId.get(lv.qid), rd = w.data.rounds[lv.r];
      proj = `<div class="zi-tag">Round ${lv.r + 1} of 3 · ${this.ROUND_NAMES[lv.r]}</div>
        <div class="zi-big">${esc(w.prompt)}</div><div class="zi-prompt">${this.PROMPTS[lv.r]}</div>
        ${this.bars(lv.options.map(o => ({ key: o, label: o })), k => rd.correct.includes(k), lv.revealed)}
        <div class="zi-status">${lv.revealed ? `${H.answered} answered` : waiting}</div>`;
      ctl = lv.revealed ? btn(lv.r < 2 ? `Next: Round ${lv.r + 2}` : 'Show the definition', 'next', 'primary big')
        : btn('Reveal', 'reveal', 'primary big') + btn('Skip word', 'toPick');
    } else if (lv.phase === 'final') {
      const w = H.byId.get(lv.qid);
      proj = `<div class="zi-tag">Zeroed in</div><div class="zi-big">${esc(w.prompt)}</div>
        <div class="zi-def">${esc(w.answer)}</div>
        ${w.data.sentence ? `<div class="zi-sent">${esc(w.data.sentence)}</div>` : ''}
        ${w.data.image ? `<img class="zi-img" src="${esc(w.data.image)}" alt="">` : ''}`;
      ctl = this.unplayed().length ? btn('Next word: Vote', 'vote', 'primary big') + btn('Next word: Wheel', 'wheel', 'primary big') + btn('End for today', 'end')
        : btn('End for today', 'end', 'primary big') + btn('Back to word list', 'toPick');
    }

    Teacher.shell('', `
      <p class="small"><a href="#/teacher">← Warm-ups</a> · ${esc(s.classes?.name || '')} · ${esc(s.units?.name || '')}</p>
      ${lv.phase === 'pick' ? `<div class="join-banner" style="margin-bottom:14px">Students go to <code>${esc(studentUrl())}</code>, pick <b>${esc(s.classes?.name || 'their class')}</b>, and type their PIN.</div>` : ''}
      <div class="zi-proj" id="zi-proj">${proj}</div>
      <div class="zi-controls">${ctl}<span class="spacer"></span><button class="btn" data-act="full">⛶ Full screen</button></div>
    `, {
      vote: () => this.startVote().catch(fail),
      wheel: () => this.startWheel().catch(fail),
      spin: () => this.spin().catch(fail),
      reveal: () => this.reveal().catch(fail),
      next: () => this.next().catch(fail),
      toPick: () => this.toPick().catch(fail),
      resetWords: () => this.resetWords().catch(fail),
      end: () => this.end().catch(fail),
      full: () => { const el = document.getElementById('zi-proj'); if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen(); }
    }, true);

    if (lv.phase === 'wheel' && lv.winner && H.animateSpin) {
      H.animateSpin = false;
      const svg = document.getElementById('zi-svg');
      requestAnimationFrame(() => requestAnimationFrame(() => { svg.style.transform = `rotate(${lv.angle}deg)`; }));
      setTimeout(() => {
        const win = lv.cands.find(c => c.id === lv.winner);
        const wEl = document.getElementById('zi-winner'), sEl = document.getElementById('zi-start');
        if (wEl) wEl.textContent = win ? win.word : '';
        if (sEl) sEl.style.visibility = 'visible';
      }, 4200);
    }
  },

  // ===================================================================
  // STUDENT
  // ===================================================================
  student(token, st) {
    clearTimers();
    const Z = this.Z = { token, name: st.student_name, state: null, key: '' };
    const tick = async () => {
      if (this.Z !== Z) return;
      try {
        const s = await rpc('zi_state', { p_token: token });
        if (s.error) { store.del('token'); clearTimers(); return Student.start(); }
        Z.state = s;
        const key = JSON.stringify(s);
        if (key !== Z.key) { Z.key = key; this.drawStudent(); }
        if (s.status === 'closed') clearTimers();
      } catch (e) { console.warn(e); }
    };
    render(`<div class="wrap center"><p class="muted">Joining…</p></div>`);
    tick();
    every(1500, tick);
  },

  async tap(choice) {
    const Z = this.Z, s = Z.state;
    if (!s || s.mine || s.revealed) return;
    s.mine = choice; Z.key = ''; this.drawStudent();
    try {
      const r = await rpc('zi_answer', { p_token: Z.token, p_step: s.seq, p_choice: choice });
      if (r.error === 'too_late') toast('Too late — that round is closed');
    } catch (e) { toast('Couldn’t send that. Check your Wi-Fi.'); s.mine = null; this.drawStudent(); }
  },

  drawStudent() {
    const Z = this.Z, s = Z.state;
    const top = `<div class="hud"><span class="who">${esc(s.student_name || Z.name)}</span><span class="chip">Zero In</span></div>`;
    let body;
    if (s.status === 'closed') {
      body = `<div class="center"><div class="big-emoji">✅</div><h1>That’s it for today</h1>
        <div class="stats"><div class="stat"><b>${s.correct_total}</b><span>Correct</span></div><div class="stat"><b>${s.answered_total}</b><span>Answered</span></div></div>
        <button class="btn big" data-act="exit">Done</button></div>`;
    } else if (s.phase === 'vote' && !s.revealed) {
      body = `<div class="card"><div class="kicker">Vote</div><h2 style="margin-top:6px">Which word do we zero in on?</h2>
        ${s.cands.map(c => `<button class="zi-s-opt ${s.mine === c.id ? 'sel' : ''}" data-act="pick" data-v="${esc(c.id)}" ${s.mine ? 'disabled' : ''}>${esc(c.word)}</button>`).join('')}
        <p class="small muted center">${s.mine ? 'Vote in — eyes on the board' : 'Tap one'}</p></div>`;
    } else if (s.phase === 'round' && !s.revealed) {
      body = `<div class="card"><div class="kicker">Round ${s.r + 1} of 3</div><div class="zi-s-word">${esc(s.word)}</div>
        <p class="muted" style="margin:0 0 12px">${this.PROMPTS[s.r]}</p>
        ${s.options.map(o => `<button class="zi-s-opt ${s.mine === o ? 'sel' : ''}" data-act="pick" data-v="${esc(o)}" ${s.mine ? 'disabled' : ''}>${esc(o)}</button>`).join('')}
        <p class="small muted center">${s.mine ? 'Locked in — wait for the reveal' : 'Tap your answer'}</p></div>`;
    } else if (s.phase === 'round') {
      const ok = s.mine && (s.correct || []).includes(s.mine);
      body = `<div class="card"><div class="kicker">Round ${s.r + 1} of 3</div><div class="zi-s-word">${esc(s.word)}</div>
        <div class="feedback ${ok ? 'good' : 'bad'}"><div class="head">${!s.mine ? 'No answer' : ok ? '✓ Nailed it' : '✗ Not this time'}</div>
        ${s.mine && !ok ? `<div>You said: ${esc(s.mine)}</div>` : ''}<div>Answer: <b>${(s.correct || []).map(esc).join(' or ')}</b></div></div>
        <p class="small muted center" style="margin-top:12px">Look up — the class results are on the board.</p></div>`;
    } else if (s.phase === 'final') {
      body = `<div class="card"><div class="kicker">Zeroed in</div><div class="zi-s-word">${esc(s.word)}</div>
        <p style="font-size:1.15rem;font-weight:700">${esc(s.definition)}</p>
        ${s.sentence ? `<div class="zi-sent" style="font-size:1rem">${esc(s.sentence)}</div>` : ''}
        <p class="small muted center" style="margin-top:14px">Write it down ✍️</p></div>`;
    } else if (s.phase === 'wheel' || s.phase === 'vote') {
      body = `<div class="center" style="margin-top:60px"><div class="big-emoji">👀</div><h1>Eyes on the board</h1></div>`;
    } else {
      body = `<div class="center" style="margin-top:50px"><div class="big-emoji">⏳</div><h1>Hang tight</h1>
        <p class="muted">Your teacher is setting up.</p>
        <p style="margin:22px 0"><span class="waiting-dot"></span><span class="waiting-dot"></span><span class="waiting-dot"></span></p></div>`;
    }
    render(`<div class="wrap">${top}${body}</div>`, {
      pick: el => this.tap(el.dataset.v),
      exit: () => { store.del('token'); this.Z = null; Student.start(); }
    });
  }
};
