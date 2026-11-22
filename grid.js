// =====================================================================
// Warm-Ups — spreadsheet-style editor for a deck's rows.
// One column per CSV column (numbered columns like wrong_def1–3 each get
// their own column), type straight into cells, zoom and wrap controls.
// Two modes:
//   'db'     — rows are saved items; Save writes changes to the database
//   'memory' — rows from a pasted sheet; collect() returns items to save
// Uses helpers from index.html (esc, toast, store, app, acts) and DECKS.
// =====================================================================
'use strict';

const Grids = {
  all: {},
  hooked: false,
  prefs() { return Object.assign({ z: 1, wrap: true, full: false }, store.get('grid') || {}); },
  setPrefs(p) { store.set('grid', Object.assign(this.prefs(), p)); },
  unsaved() { return Object.values(this.all).some(g => g.mode === 'db' && g.changes() > 0); },

  // Event hooks shared by every grid (registered into the page's handlers).
  handlers() {
    const G = el => this.all[el.dataset.g];
    return {
      gcell: el => G(el) && G(el).onCell(el),
      gzoom: el => G(el) && G(el).zoom(+el.dataset.d),
      gwrap: el => G(el) && G(el).toggle('wrap'),
      gfull: el => G(el) && G(el).toggle('full'),
      gadd: el => G(el) && G(el).addRow(),
      gdel: el => G(el) && G(el).delRow(+el.dataset.r),
      gexpand: el => G(el) && G(el).expand(+el.dataset.r),
      gsave: el => G(el) && G(el).save(),
      gdiscard: el => G(el) && G(el).discard(),
      gmodalSave: f => this.all[f.dataset.g] && this.all[f.dataset.g].modalSave(f),
      gmodalClose: () => { const m = document.getElementById('gmodal'); if (m) m.hidden = true; }
    };
  },

  hook() {
    if (this.hooked) return;
    this.hooked = true;
    // Enter moves down a row (cells are single-line values).
    app.addEventListener('keydown', e => {
      const t = e.target;
      if (!t.matches || !t.matches('textarea[data-input=gcell]') || e.key !== 'Enter') return;
      e.preventDefault();
      const g = this.all[t.dataset.g]; if (!g) return;
      const next = app.querySelector(`textarea[data-g="${t.dataset.g}"][data-r="${+t.dataset.r + (e.shiftKey ? -1 : 1)}"][data-c="${t.dataset.c}"]`);
      if (next) next.focus(); else if (!e.shiftKey) g.addRow(+t.dataset.c);
    });
    window.addEventListener('beforeunload', e => { if (this.unsaved()) { e.preventDefault(); e.returnValue = ''; } });
  }
};

class DeckGrid {
  constructor(gid, kind, rows, opts) {
    this.gid = gid; this.kind = kind; this.opts = opts || {};
    this.mode = this.opts.mode || 'db';
    const t = DECKS.TYPE[kind];
    // Expanded columns: [{key, i (index in a numbered column or -1), label, req, w}]
    this.cols = [];
    t.cols.forEach(c => {
      if (!c.count) this.cols.push({ key: c.key, i: -1, label: c.label, req: !!c.req, w: this.width(c.key) });
      else for (let i = 0; i < c.count; i++) this.cols.push({ key: c.key, i, label: `${c.label} ${i + 1}`, req: !!(c.min && i < c.min), w: this.width(c.key) });
    });
    this.rows = rows.map(r => this.wrap(r.row, r.id, r.sort, r.err));
    Grids.all[gid] = this;
    Grids.hook();
  }

  width(key) {
    const W = { term: 11, title: 13, item: 14, question: 20, prompt: 22, definition: 24, translation: 18, sentence: 20, reveal: 24,
      explanation: 18, wrong_def: 17, wrong: 12, correct: 12, category: 10, subcategory: 11, group: 10, level: 4.5,
      also_accept: 13, decoys: 10, word_tips: 16, notes: 13, image: 11, media: 11, constraint: 12, step: 11 };
    return W[key] || 12;
  }

  wrap(row, id, sort, err) {
    const r = {};
    this.cols.forEach(c => {
      if (c.i < 0) r[c.key] = row[c.key] == null ? '' : String(row[c.key]);
      else { if (!r[c.key]) r[c.key] = []; r[c.key][c.i] = (row[c.key] || [])[c.i] || ''; }
    });
    return { id: id || null, sort: sort == null ? null : sort, row: r, orig: JSON.stringify(r), deleted: false, err: err || null };
  }

  get(r, c) { const x = r.row[c.key]; return c.i < 0 ? x : (x[c.i] || ''); }
  set(r, c, v) { if (c.i < 0) r.row[c.key] = v; else r.row[c.key][c.i] = v; }
  compact(row) {
    const o = {};
    DECKS.TYPE[this.kind].cols.forEach(c => { o[c.key] = c.count ? (row[c.key] || []).map(s => s.trim()).filter(Boolean) : String(row[c.key] || '').trim(); });
    return o;
  }
  blank(r) { return this.cols.every(c => !String(this.get(r, c)).trim()); }
  isDirty(r) { return !r.id ? !this.blank(r) : (r.deleted || JSON.stringify(r.row) !== r.orig); }
  changes() { return this.rows.filter(r => this.isDirty(r)).length; }
  live() { return this.rows.filter(r => !r.deleted && !(r.id === null && this.blank(r))); }

  // ---------- rendering ----------
  mount(el) {
    this.el = typeof el === 'string' ? document.getElementById(el) : el;
    Object.assign(acts, Grids.handlers());
    this.draw();
  }

  toolbar() {
    const p = Grids.prefs(), n = this.changes(), bad = this.rows.filter(r => r.err && !r.deleted).length;
    return `<div class="gbar">
      <div class="gzoom"><button type="button" class="btn small-btn" data-act="gzoom" data-g="${this.gid}" data-d="-1" aria-label="Smaller">−</button>
        <span class="small" style="min-width:3.2em;text-align:center;font-weight:800">${Math.round(p.z * 100)}%</span>
        <button type="button" class="btn small-btn" data-act="gzoom" data-g="${this.gid}" data-d="1" aria-label="Bigger">+</button></div>
      <button type="button" class="chip-btn ${p.wrap ? 'on' : ''}" data-act="gwrap" data-g="${this.gid}">Wrap text</button>
      ${this.opts.fullToggle ? `<button type="button" class="chip-btn ${p.full ? 'on' : ''}" data-act="gfull" data-g="${this.gid}">Full width</button>` : ''}
      <span class="small muted">${this.live().length} row${this.live().length === 1 ? '' : 's'}${bad ? ` · <b class="error">${bad} need${bad === 1 ? 's' : ''} fixing</b>` : ''}</span>
      <span class="spacer"></span>
      ${this.mode === 'db' ? (n ? `<span class="gdirty">${n} unsaved change${n === 1 ? '' : 's'}</span>
        <button type="button" class="btn small-btn" data-act="gdiscard" data-g="${this.gid}">Undo all</button>
        <button type="button" class="btn small-btn primary" data-act="gsave" data-g="${this.gid}">Save changes</button>` : '<span class="small muted">All changes saved</span>') : ''}
    </div>`;
  }

  rowHtml(r, ri) {
    const p = Grids.prefs();
    const cls = [r.deleted ? 'deleted' : '', r.err && !r.deleted ? 'err' : '', !r.deleted && this.isDirty(r) ? 'dirty' : ''].join(' ');
    return `<tr class="${cls}" ${r.err && !r.deleted ? `title="${esc(r.err)}"` : ''}>
      <td class="rn">${ri + 1}</td>
      ${this.cols.map((c, ci) => `<td><textarea rows="1" wrap="${p.wrap ? 'soft' : 'off'}" spellcheck="false" data-input="gcell" data-g="${this.gid}" data-r="${ri}" data-c="${ci}"
        ${r.deleted ? 'disabled' : ''} aria-label="${esc(c.label)}, row ${ri + 1}">${esc(this.get(r, c))}</textarea></td>`).join('')}
      <td class="ract">${r.deleted
        ? `<button type="button" class="link" data-act="gdel" data-g="${this.gid}" data-r="${ri}">Undo</button>`
        : `<button type="button" class="gicon" title="Open in a form" data-act="gexpand" data-g="${this.gid}" data-r="${ri}">⤢</button>
           <button type="button" class="gicon" title="Delete row" data-act="gdel" data-g="${this.gid}" data-r="${ri}">✕</button>`}</td>
    </tr>`;
  }

  draw() {
    if (!this.el) return;
    const p = Grids.prefs();
    const errs = this.rows.map((r, i) => r.err && !r.deleted ? `Row ${i + 1}: ${r.err}` : null).filter(Boolean);
    this.el.innerHTML = `${this.toolbar()}
      ${errs.length ? `<div class="notice bad-notice small" style="margin-bottom:8px">${errs.slice(0, 6).map(esc).join(' · ')}${errs.length > 6 ? ` · …${errs.length - 6} more` : ''}</div>` : ''}
      <div class="gscroll ${p.wrap ? '' : 'nowrap'}" style="--gz:${p.z}">
        <table class="gtable" style="width:${3 + 4.6 + this.cols.reduce((n, c) => n + c.w, 0)}em">
          <colgroup><col style="width:3em">${this.cols.map(c => `<col style="width:${c.w}em">`).join('')}<col style="width:4.6em"></colgroup>
          <thead><tr><th class="rn">#</th>${this.cols.map(c => `<th title="${esc(c.key + (c.i >= 0 ? c.i + 1 : ''))}">${esc(c.label)}${c.req ? ' <span class="req">*</span>' : ''}</th>`).join('')}<th></th></tr></thead>
          <tbody>${this.rows.map((r, ri) => this.rowHtml(r, ri)).join('')}</tbody>
        </table>
      </div>
      ${this.opts.canAdd !== false ? `<button type="button" class="btn small-btn" style="margin-top:8px" data-act="gadd" data-g="${this.gid}">+ Add row</button>` : ''}
      <div id="gmodal" class="modal" hidden></div>`;
    if (this.opts.fullToggle) { const w = this.el.closest('.wrap'); if (w) w.classList.toggle('full', p.full); }
    this.fitAll();
  }

  fitAll() { if (Grids.prefs().wrap) this.el.querySelectorAll('textarea[data-input=gcell]').forEach(t => this.fit(t)); }
  fit(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }

  refreshBar() {
    const bar = this.el.querySelector('.gbar');
    if (bar) bar.outerHTML = this.toolbar();
  }

  // ---------- editing ----------
  onCell(t) {
    const r = this.rows[+t.dataset.r], c = this.cols[+t.dataset.c];
    const v = t.value.replace(/[\r\n]+/g, ' ');
    if (v !== t.value) t.value = v;
    this.set(r, c, v);
    if (r.err) { r.err = DECKS.checkRow(this.kind, this.compact(r.row)); t.closest('tr').classList.toggle('err', !!r.err); }
    t.closest('tr').classList.toggle('dirty', this.isDirty(r));
    if (Grids.prefs().wrap) this.fit(t);
    this.refreshBar();
    if (this.opts.onChange) this.opts.onChange(this);
  }

  addRow(focusCol) {
    this.rows.push(this.wrap({}, null, null, null));
    this.draw();
    const ri = this.rows.length - 1;
    const t = this.el.querySelector(`textarea[data-r="${ri}"][data-c="${focusCol || 0}"]`);
    if (t) { t.focus(); t.scrollIntoView({ block: 'nearest' }); }
  }

  delRow(ri) {
    const r = this.rows[ri];
    if (!r.id) { this.rows.splice(ri, 1); }
    else r.deleted = !r.deleted;
    this.draw();
    if (this.opts.onChange) this.opts.onChange(this);
  }

  zoom(d) {
    const z = Math.round(Math.min(1.6, Math.max(0.5, Grids.prefs().z + d * 0.1)) * 10) / 10;
    Grids.setPrefs({ z });
    this.draw();
  }

  toggle(k) { Grids.setPrefs({ [k]: !Grids.prefs()[k] }); this.draw(); }

  discard() {
    if (!confirm('Undo all unsaved changes?')) return;
    this.rows = this.rows.filter(r => r.id).map(r => Object.assign(r, { row: JSON.parse(r.orig), deleted: false, err: null }));
    this.draw();
  }

  // Validate rows; marks errors and returns true if all good.
  validate() {
    let ok = true;
    this.rows.forEach(r => {
      if (r.deleted || (r.id === null && this.blank(r))) { r.err = null; return; }
      r.err = DECKS.checkRow(this.kind, this.compact(r.row));
      if (r.err) ok = false;
    });
    return ok;
  }

  // Items ready to save, in grid order.
  collect() {
    if (!this.validate()) { this.draw(); return null; }
    return this.live().map((r, i) => DECKS.rowToItem(this.kind, this.compact(r.row), i));
  }

  async save() {
    if (!this.validate()) { this.draw(); toast('Some rows need fixing first (shown in red)'); return; }
    const unit = this.opts.unitId;
    const maxSort = Math.max(-1, ...this.rows.filter(r => r.id).map(r => r.sort || 0));
    const dels = this.rows.filter(r => r.id && r.deleted).map(r => r.id);
    const ups = this.rows.filter(r => r.id && !r.deleted && JSON.stringify(r.row) !== r.orig)
      .map(r => Object.assign({ id: r.id, unit_id: unit }, DECKS.rowToItem(this.kind, this.compact(r.row), r.sort)));
    let next = maxSort + 1;
    const ins = this.rows.filter(r => !r.id && !r.deleted && !this.blank(r))
      .map(r => Object.assign({ unit_id: unit }, DECKS.rowToItem(this.kind, this.compact(r.row), next++)));
    try {
      if (dels.length) await q(sb.from('questions').delete().in('id', dels));
      if (ups.length) await q(sb.from('questions').upsert(ups));
      if (ins.length) await q(sb.from('questions').insert(ins));
      toast('Saved');
      this.rows.forEach(r => { r.orig = JSON.stringify(r.row); });   // so the reload doesn't warn
      if (this.opts.onSaved) this.opts.onSaved();
    } catch (e) { fail(e); }
  }

  // ---------- one row in a form (handy on phones / long text) ----------
  expand(ri) {
    const r = this.rows[ri], t = DECKS.TYPE[this.kind];
    const longKeys = ['definition', 'sentence', 'translation', 'explanation', 'reveal', 'prompt', 'question', 'notes', 'word_tips'];
    const field = c => {
      if (c.count) return `<fieldset class="field"><legend>${esc(c.label)}s ${c.min ? `<span class="req">at least ${c.min}</span>` : ''}</legend>
          ${c.hint ? `<div class="hint">${esc(c.hint)}</div>` : ''}
          ${Array.from({ length: c.count }, (_, i) => `<input type="text" name="${c.key}__${i}" value="${esc((r.row[c.key] || [])[i] || '')}" placeholder="${esc(c.label)} ${i + 1}">`).join('')}</fieldset>`;
      const v = esc(r.row[c.key] || '');
      const input = longKeys.includes(c.key) ? `<textarea name="${c.key}" rows="2">${v}</textarea>` : `<input type="text" name="${c.key}" value="${v}">`;
      return `<label class="field"><span>${esc(c.label)} ${c.req ? '<span class="req">required</span>' : ''}</span>${input}${c.hint ? `<div class="hint">${esc(c.hint)}</div>` : ''}</label>`;
    };
    const m = document.getElementById('gmodal');
    m.innerHTML = `<div class="modal-card"><form class="stack" data-act="gmodalSave" data-g="${this.gid}" data-r="${ri}">
      <div class="row"><h2 style="margin:0">Row ${ri + 1}</h2><span class="spacer"></span><button class="link" type="button" data-act="gmodalClose">Close</button></div>
      ${t.cols.map(field).join('')}
      <div class="row"><button class="btn primary" type="submit">Done</button><button class="btn" type="button" data-act="gmodalClose">Cancel</button></div>
      ${this.mode === 'db' ? '<p class="small muted">Then click <b>Save changes</b> above the table.</p>' : ''}
    </form></div>`;
    m.hidden = false;
    const first = m.querySelector('input, textarea'); if (first) first.focus();
  }

  modalSave(f) {
    const r = this.rows[+f.dataset.r];
    DECKS.TYPE[this.kind].cols.forEach(c => {
      if (c.count) for (let i = 0; i < c.count; i++) r.row[c.key][i] = f.elements[`${c.key}__${i}`].value.trim();
      else r.row[c.key] = f.elements[c.key].value.trim();
    });
    if (r.err) r.err = DECKS.checkRow(this.kind, this.compact(r.row));
    document.getElementById('gmodal').hidden = true;
    this.draw();
    if (this.opts.onChange) this.opts.onChange(this);
  }
}
