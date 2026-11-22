// =====================================================================
// Warm-Ups — teacher Library: decks of content for the games.
// Uses helpers from index.html (render, q, sb, esc, toast, fail, store, Teacher)
// and deck types from decks.js (DECKS).
// =====================================================================
'use strict';

const Library = {
  // ---------- small helpers ----------
  download(name, text) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },

  async copy(text, msg) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch (e2) { t.remove(); return toast('Couldn’t copy on this device'); }
      t.remove();
    }
    toast(msg || 'Copied');
  },

  fileName(name) { return (name || 'deck').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'deck'; },

  typePill(kind) {
    const t = DECKS.TYPE[kind] || { icon: '', name: kind };
    return `<span class="type-pill t-${esc(kind)}">${t.icon} ${esc(t.name)}</span>`;
  },

  // Quick "plays" list from item counts (the deck page does the full check).
  playsFor(kind, n) {
    const games = DECKS.GAMES.filter(g => g.deck === kind && (g.id === 'zero_in' ? n >= 2 : n >= 1));
    return games.map(g => g.name);
  },

  async loadDecks() {
    return q(sb.from('units').select('id,name,kind,folder,teacher_id,created_at,questions(count)').order('name'));
  },

  // ===================================================================
  // LIBRARY LIST
  // ===================================================================
  async list() {
    const decks = await this.loadDecks();
    const folders = [...new Set(decks.map(d => d.folder || ''))].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b));
    const kinds = DECKS.TYPES.filter(t => decks.some(d => d.kind === t.id));
    const filt = store.get('libFilter') || { type: 'all' };
    const card = d => {
      const n = d.questions?.[0]?.count ?? 0;
      const plays = this.playsFor(d.kind, n);
      const t = DECKS.TYPE[d.kind] || {};
      return `<a class="deck-card" href="#/teacher/deck/${d.id}" data-type="${esc(d.kind)}" data-text="${esc((d.name + ' ' + (d.folder || '') + ' ' + (t.name || '')).toLowerCase())}">
        <div class="row" style="gap:8px">${this.typePill(d.kind)}<span class="spacer"></span><span class="small muted">${n} item${n === 1 ? '' : 's'}</span></div>
        <div class="deck-name">${esc(d.name)}</div>
        <div class="small muted">by ${esc(Teacher.byline(d.teacher_id))}</div>
        <div class="deck-plays">${plays.length ? plays.map(p => `<span class="play-chip ok">▶ ${esc(p)}</span>`).join('')
          : `<span class="play-chip soon">${(DECKS.SOON[d.kind] || []).length ? 'Games coming soon' : 'No games yet'}</span>`}</div>
      </a>`;
    };
    Teacher.shell('library', `
      <div class="row" style="margin:8px 0 6px"><h1 style="margin:0">Library</h1><span class="spacer"></span>
        <a class="btn primary" href="#/teacher/new" style="text-decoration:none">+ New deck</a></div>
      <p class="muted" style="margin-top:4px">Decks are the content for your warm-ups. Every teacher can use every deck.</p>
      ${decks.length ? `
      <div class="lib-tools">
        <input type="search" placeholder="Search decks" data-input="filter" id="lib-search" aria-label="Search decks">
        <div class="chips">
          <button class="chip-btn ${filt.type === 'all' ? 'on' : ''}" data-act="ftype" data-t="all">All</button>
          ${kinds.map(t => `<button class="chip-btn ${filt.type === t.id ? 'on' : ''}" data-act="ftype" data-t="${t.id}">${t.icon} ${esc(t.name)}</button>`).join('')}
        </div>
      </div>
      ${folders.map(f => `<section class="folder" data-folder>
        <div class="section-title">📁 ${f ? esc(f) : 'No folder'}</div>
        <div class="deck-grid">${decks.filter(d => (d.folder || '') === f).map(card).join('')}</div>
      </section>`).join('')}
      <p id="lib-empty" class="muted" hidden>No decks match.</p>`
      : `<div class="card stack center" style="padding:36px">
          <div class="big-emoji">📚</div><h2>No decks yet</h2>
          <p class="muted">Start with a template, or add one of the samples.</p>
          <div class="row" style="justify-content:center"><a class="btn primary" href="#/teacher/new" style="text-decoration:none">+ New deck</a>
            <button class="btn" data-act="sampleVocab">Add Comm Tech vocab sample</button>
            <button class="btn" data-act="sampleSentence">Add Spanish sentences sample</button></div>
        </div>`}
    `, {
      ftype: el => { store.set('libFilter', { type: el.dataset.t }); app.querySelectorAll('.chip-btn').forEach(b => b.classList.toggle('on', b === el)); this.applyFilter(); },
      filter: () => this.applyFilter(),
      sampleVocab: () => this.addSample('vocab', 'vocab-sample.csv', 'Comm Tech vocab – Sample', 'Comm Tech'),
      sampleSentence: () => this.addSample('sentence', 'sample-unit.csv', 'Sample – La familia y la casa', 'Spanish')
    }, true);
    this.applyFilter();
  },

  applyFilter() {
    const type = (store.get('libFilter') || {}).type || 'all';
    const s = document.getElementById('lib-search');
    const text = s ? s.value.trim().toLowerCase() : '';
    let any = false;
    app.querySelectorAll('section[data-folder]').forEach(sec => {
      let shown = 0;
      sec.querySelectorAll('.deck-card').forEach(c => {
        const ok = (type === 'all' || c.dataset.type === type) && (!text || c.dataset.text.includes(text));
        c.hidden = !ok; if (ok) shown++;
      });
      sec.hidden = !shown; if (shown) any = true;
    });
    const e = document.getElementById('lib-empty'); if (e) e.hidden = any || !app.querySelector('section[data-folder]');
  },

  async addSample(kind, file, name, folder) {
    try {
      const text = await (await fetch(file, { cache: 'no-store' })).text();
      const res = DECKS.importText(kind, text);
      if (res.errors.length) return toast(res.errors[0]);
      await this.saveDeck({ name, folder, kind, items: res.items });
    } catch (e) { fail(e); }
  },

  async saveDeck({ name, folder, kind, items }) {
    const u = await q(sb.from('units').insert({ name, folder: folder || '', kind }).select().single());
    if (items.length) await q(sb.from('questions').insert(items.map(x => Object.assign({ unit_id: u.id }, x))));
    toast(`Saved ${items.length} item${items.length === 1 ? '' : 's'}`);
    location.hash = '#/teacher/deck/' + u.id;
  },

  // ===================================================================
  // NEW DECK
  // ===================================================================
  async create(kind) {
    const t = DECKS.TYPE[kind];
    if (!t) {
      return Teacher.shell('library', `
        <p class="small"><a href="#/teacher/library">← Library</a></p>
        <h1>What kind of deck?</h1>
        <p class="muted">Pick the shape of your content. Games that work the same way share a deck type, so one deck can feed several games.</p>
        <div class="type-grid">${DECKS.TYPES.map(x => {
          const games = DECKS.GAMES.filter(g => g.deck === x.id).map(g => g.name);
          const req = x.cols.filter(c => c.req || c.min).map(c => c.label.toLowerCase());
          return `<a class="type-card" href="#/teacher/new/${x.id}">
            <div class="type-icon">${x.icon}</div>
            <div class="deck-name">${esc(x.name)}</div>
            <div class="muted">${esc(x.blurb)}</div>
            <div class="small" style="margin-top:8px"><b>Needs:</b> ${esc(req.join(', '))}${x.cols.length > req.length ? ` <span class="muted">+ ${x.cols.length - req.length} optional</span>` : ''}</div>
            <div class="deck-plays">${games.map(g => `<span class="play-chip ok">▶ ${esc(g)}</span>`).join('')}
              ${(DECKS.SOON[x.id] || []).map(g => `<span class="play-chip soon">${esc(g)} · soon</span>`).join('')}</div>
          </a>`;
        }).join('')}</div>`);
    }
    const decks = await this.loadDecks();
    const folders = [...new Set(decks.map(d => d.folder).filter(Boolean))].sort();
    let last = null;
    Teacher.shell('library', `
      <p class="small"><a href="#/teacher/library">← Library</a> · <a href="#/teacher/new">Change deck type</a></p>
      <div class="row"><h1 style="margin:4px 0">New deck</h1>${this.typePill(kind)}</div>
      <p class="muted">${esc(t.blurb)}</p>

      <div class="card stack">
        <h2>1. Get the template</h2>
        ${this.columnGuide(kind)}
        <div class="row">
          <button class="btn" data-act="tpl">⬇ Download template</button>
          <button class="btn" data-act="ai">✨ Copy AI prompt</button>
        </div>
        <p class="small muted">In Google Sheets: <b>File → Import → Upload</b> the template, then fill it in. Or paste the AI prompt into ChatGPT, Claude or Gemini with your topic and paste its answer below. Check what it gives you — you can edit everything later.</p>
      </div>

      <form class="card stack" data-act="save" style="margin-top:14px">
        <h2>2. Add your content</h2>
        <div class="grid2">
          <label class="field"><span>Deck name</span><input type="text" name="name" required maxlength="80" placeholder="e.g. Unit 3 – Camera basics"></label>
          <label class="field"><span>Folder (course or unit)</span><input type="text" name="folder" list="folders" maxlength="60" placeholder="e.g. Comm Tech"></label>
        </div>
        <datalist id="folders">${folders.map(f => `<option value="${esc(f)}">`).join('')}</datalist>
        ${this.importFields()}
        <div class="row"><button class="btn" type="button" data-act="check">Check sheet</button>
          <button class="btn primary" type="submit">Save deck</button>
          <span class="spacer"></span><button class="link" type="button" data-act="empty">Start empty and add items here</button></div>
      </form>
    `, {
      tpl: () => this.download(`${kind}-template.csv`, DECKS.templateCsv(kind)),
      ai: () => this.copy(DECKS.aiPromptNew(kind), 'AI prompt copied — add your topic where it says [TOPIC]'),
      check: async () => { last = this.showPreview(kind, await this.readImport(kind)); },
      empty: async () => {
        const f = app.querySelector('form[data-act=save]');
        if (!f.name.value.trim()) { f.name.focus(); return toast('Give the deck a name first'); }
        try { await this.saveDeck({ name: f.name.value.trim(), folder: f.folder.value.trim(), kind, items: [] }); } catch (e) { fail(e); }
      },
      save: async f => {
        if (!last) last = this.showPreview(kind, await this.readImport(kind));
        if (!last) return;
        const items = last.collect();
        if (!items) return toast('Fix the rows shown in red first');
        if (!items.length) return toast('Add at least one row');
        try { delete Grids.all.prev; await this.saveDeck({ name: f.name.value.trim(), folder: f.folder.value.trim(), kind, items }); } catch (e) { fail(e); }
      }
    }, true);
  },

  columnGuide(kind) {
    const t = DECKS.TYPE[kind];
    return `<div class="table-wrap"><table class="guide">
      <tr><th>Column</th><th></th><th>What goes here</th></tr>
      ${t.cols.map(c => `<tr><td><code>${c.count ? `${c.key}1–${c.key}${c.count}` : c.key}</code></td>
        <td>${c.req ? '<span class="req">Required</span>' : c.min ? `<span class="req">At least ${c.min}</span>` : '<span class="small muted">Optional</span>'}</td>
        <td class="small">${esc(c.hint || c.label)}</td></tr>`).join('')}
    </table></div>`;
  },

  importFields() {
    return `<label class="field"><span>Paste from Google Sheets or an AI answer (select all the cells, copy, paste)</span>
        <textarea name="paste" spellcheck="false" placeholder="Paste here — the first row should be the column names"></textarea></label>
      <label class="field"><span>…or upload a CSV (Google Sheets: File → Download → CSV)</span><input type="file" name="file" accept=".csv,.tsv,.txt,text/csv"></label>
      <div id="preview"></div>`;
  },

  async readImport(kind) {
    const f = app.querySelector('textarea[name=paste]').closest('form, .card');
    let text = f.querySelector('textarea[name=paste]').value;
    const file = f.querySelector('input[name=file]').files[0];
    if (!text.trim() && file) text = await file.text();
    if (!text.trim()) return { items: [], errors: ['Paste your sheet or choose a file first.'] };
    return DECKS.importText(kind, text);
  },

  // Editable preview of a pasted sheet: every row, problems in red, fixable in place.
  showPreview(kind, res) {
    const el = document.getElementById('preview');
    if (!el) return null;
    if (!res.rows || !res.rows.length) {
      el.innerHTML = `<div class="notice bad-notice"><b>This sheet needs fixing:</b><br>${res.errors.slice(0, 8).map(esc).join('<br>')}</div>`;
      return null;
    }
    el.innerHTML = `<div id="prev-sum"></div><div id="prev-grid" style="margin-top:10px"></div>`;
    const summary = g => {
      const good = g.live().filter(r => !DECKS.checkRow(kind, g.compact(r.row)));
      const bad = g.live().length - good.length;
      const plays = DECKS.playable(kind, good.map((r, i) => Object.assign({ id: 'p' + i }, DECKS.rowToItem(kind, g.compact(r.row), i))));
      document.getElementById('prev-sum').innerHTML = `<div class="notice ${bad ? 'bad-notice' : 'good-notice'}">
        <b>${bad ? `${good.length} rows ready, ${bad} need${bad === 1 ? 's' : ''} fixing — edit them in the table below.` : `✓ ${good.length} row${good.length === 1 ? '' : 's'} ready.`}</b>
        ${plays.map(p => `<div class="small">${p.ok ? '▶' : '⚠'} ${esc(p.game.name)}${p.note ? ' — ' + esc(p.note) : ''}</div>`).join('')}
        <div class="small muted" style="margin-top:4px">You can edit any cell before saving.</div></div>`;
    };
    const g = new DeckGrid('prev', kind, res.rows.map(r => ({ row: r.row, err: r.err })), { mode: 'memory', onChange: summary });
    g.mount('prev-grid');
    summary(g);
    return g;
  },

  // ===================================================================
  // DECK PAGE
  // ===================================================================
  async deck(id) {
    const [d, items] = await Promise.all([
      q(sb.from('units').select('id,name,kind,folder,teacher_id,created_at').eq('id', id).single()),
      q(sb.from('questions').select('*').eq('unit_id', id).order('sort').order('level'))
    ]);
    const kind = d.kind;
    if (kind === 'sentence') items.sort((a, b) => a.level - b.level || a.sort - b.sort);
    const plays = DECKS.playable(kind, items);
    const soon = DECKS.SOON[kind] || [];
    const mine = d.teacher_id === Teacher.user.id;
    this.L = { d, items, kind };
    let prevGrid = null;
    this.guardHash = location.hash;

    Teacher.shell('library', `
      <p class="small"><a href="#/teacher/library">← Library</a>${d.folder ? ` · 📁 ${esc(d.folder)}` : ''}</p>
      <div class="row"><h1 style="margin:4px 0">${esc(d.name)}</h1>${this.typePill(kind)}
        <button class="link" data-act="rename">Rename / move</button></div>
      <p class="muted">${items.length} item${items.length === 1 ? '' : 's'} · by ${esc(Teacher.byline(d.teacher_id))} · shared with all teachers</p>

      <div class="plays-box">
        ${plays.map(p => `<div class="play-row"><span class="play-chip ${p.ok ? 'ok' : 'warn'}">${p.game.icon} ${esc(p.game.name)}</span>
          <span class="small ${p.ok ? 'muted' : 'error'}">${esc(p.note || (p.ok ? 'Ready to play.' : ''))}</span>
          ${p.ok ? `<span class="spacer"></span><button class="btn small-btn" data-act="run" data-g="${p.game.id}">Run it →</button>` : ''}</div>`).join('')}
        ${soon.length ? `<div class="play-row"><span class="small muted">Coming soon for this deck type:</span> ${soon.map(g => `<span class="play-chip soon">${esc(g)}</span>`).join('')}</div>` : ''}
      </div>

      <div class="deck-actions">
        <button class="btn" data-act="csv">⬇ Download CSV</button>
        <button class="btn" data-act="toggleUpd">⬆ Update from sheet</button>
        <button class="btn" data-act="ai">✨ Copy AI prompt</button>
        <span class="spacer"></span>
        ${mine ? '<button class="btn danger" data-act="del">Delete deck</button>' : ''}
      </div>

      <form class="card stack" id="upd" data-act="apply" hidden style="margin-top:14px">
        <h2>Update from sheet</h2>
        ${this.importFields()}
        <div class="row">
          <label class="radio"><input type="radio" name="mode" value="replace" checked> Replace all items</label>
          <label class="radio"><input type="radio" name="mode" value="append"> Add to the end</label>
        </div>
        <details><summary class="small">Column guide</summary>${this.columnGuide(kind)}</details>
        <div class="row"><button class="btn" type="button" data-act="check">Check sheet</button><button class="btn primary" type="submit">Apply</button></div>
      </form>

      <div class="section-title">Items · click any cell to edit · Enter moves down</div>
      <div id="deck-grid"></div>
      <div id="modal" class="modal" hidden></div>
    `, {
      run: el => { const r = store.get('run') || {}; store.set('run', Object.assign(r, { game: el.dataset.g, deck: d.id })); location.hash = '#/teacher'; },
      csv: () => this.download(`${this.fileName(d.name)}.csv`, DECKS.itemsToCsv(kind, items)),
      ai: () => this.copy(DECKS.aiPromptFill(kind, items), 'AI prompt copied, with this deck included'),
      toggleUpd: () => { const f = document.getElementById('upd'); f.hidden = !f.hidden; if (!f.hidden) f.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
      check: async () => { prevGrid = this.showPreview(kind, await this.readImport(kind)); },
      apply: async f => {
        if (!prevGrid) prevGrid = this.showPreview(kind, await this.readImport(kind));
        if (!prevGrid) return;
        const newItems = prevGrid.collect();
        if (!newItems) return toast('Fix the rows shown in red first');
        if (!newItems.length) return toast('No rows to add');
        if (Grids.unsaved() && !confirm('You have unsaved edits in the table. Updating from the sheet will discard them. Continue?')) return;
        const append = f.mode.value === 'append';
        if (!append && !confirm(`Replace all ${items.length} items with ${newItems.length} from the sheet?`)) return;
        try {
          const start = append ? Math.max(-1, ...items.map(x => x.sort)) + 1 : 0;
          if (!append) await q(sb.from('questions').delete().eq('unit_id', id));
          await q(sb.from('questions').insert(newItems.map((x, i) => Object.assign({}, x, { unit_id: id, sort: start + i }))));
          delete Grids.all.main;
          toast(append ? `Added ${newItems.length}` : 'Replaced'); this.deck(id);
        } catch (e) { fail(e); }
      },
      rename: () => this.renameModal(),
      closeModal: () => { document.getElementById('modal').hidden = true; },
      saveRename: f => this.saveRename(f),
      del: async () => {
        if (!confirm(`Delete ${d.name}?`)) return;
        try { delete Grids.all.main; await q(sb.from('units').delete().eq('id', id)); location.hash = '#/teacher/library'; }
        catch (e) {
          if (e.code === '23503') toast('This deck has been used in warm-ups, so it stays to keep those results.');
          else fail(e);
        }
      }
    }, true);

    delete Grids.all.prev;
    const grid = new DeckGrid('main', kind, items.map(it => ({ id: it.id, sort: it.sort, row: DECKS.itemToRow(kind, it) })),
      { mode: 'db', unitId: id, fullToggle: true, onSaved: () => this.deck(id) });
    grid.mount('deck-grid');
    if (!items.length) grid.addRow();
  },

  openModal(html) {
    const m = document.getElementById('modal');
    m.innerHTML = `<div class="modal-card">${html}</div>`;
    m.hidden = false;
    const first = m.querySelector('input, textarea'); if (first) first.focus();
  },

  async renameModal() {
    const { d } = this.L;
    const decks = await this.loadDecks();
    const folders = [...new Set(decks.map(x => x.folder).filter(Boolean))].sort();
    this.openModal(`<form class="stack" data-act="saveRename">
      <h2 style="margin:0">Rename / move</h2>
      <label class="field"><span>Deck name</span><input type="text" name="name" value="${esc(d.name)}" required maxlength="80"></label>
      <label class="field"><span>Folder</span><input type="text" name="folder" value="${esc(d.folder || '')}" list="folders2" maxlength="60" placeholder="Leave blank for no folder"></label>
      <datalist id="folders2">${folders.map(f => `<option value="${esc(f)}">`).join('')}</datalist>
      <div class="row"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-act="closeModal">Cancel</button></div>
    </form>`);
  },

  async saveRename(f) {
    const { d } = this.L;
    try { await q(sb.from('units').update({ name: f.name.value.trim(), folder: f.folder.value.trim() }).eq('id', d.id)); toast('Saved'); this.deck(d.id); }
    catch (e) { fail(e); }
  }
};
