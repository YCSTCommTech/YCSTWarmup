// =====================================================================
// Warm-Ups — deck types. Pure logic (no page or database code).
// A deck is a spreadsheet: one row per item, columns set by its type.
// Games say which deck type they play.
// =====================================================================
(function (root) {
  'use strict';
  const WU = root.WU || (typeof require !== 'undefined' ? require('./logic.js') : null);

  // ---------- Deck types ----------
  // col: key (CSV header), label, req (required), count (numbered columns:
  // key1, key2...), min (how many of a numbered column are required), hint.
  const TYPES = [
    {
      id: 'vocab', name: 'Vocabulary', icon: '📖',
      blurb: 'A term and what it means.',
      main: 'term', second: 'definition',
      cols: [
        { key: 'term', label: 'Term', req: true, hint: 'The word or phrase.' },
        { key: 'definition', label: 'Definition', req: true, hint: 'What it means. This is the answer students zero in on.' },
        { key: 'category', label: 'Category', hint: 'Broad area, e.g. Photo. Two right answers: Photo / Video. Keep to 3–6 categories per deck.' },
        { key: 'subcategory', label: 'Subcategory', hint: 'A narrower group inside the category, e.g. Exposure.' },
        { key: 'wrong_def', label: 'Wrong definition', count: 3, hint: 'Optional near-misses. Leave blank and games borrow other terms’ definitions.' },
        { key: 'sentence', label: 'Example sentence', hint: 'The term used in context. Shown at the end.' },
        { key: 'image', label: 'Image link', hint: 'Optional link to a picture.' }
      ],
      examples: [
        { term: 'Aperture', definition: 'The opening in the lens that controls how much light gets in and the depth of field', category: 'Photo / Video', subcategory: 'Exposure', wrong_def: ['How long the shutter stays open', 'How sensitive the sensor is to light', 'How zoomed in the lens is'], sentence: 'Open the aperture to f/1.8 to blur the background.', image: '' },
        { term: 'Bleed', definition: 'Artwork that extends past the trim line so there are no white edges', category: 'Print', subcategory: 'Trim & layout', wrong_def: ['The safe area inside the trim where text should stay', '', ''], sentence: 'Push the background 1/8 inch past the edge.', image: '' }
      ],
      aiRules: 'category is the broad area (use 3–6 different categories across the whole deck; two right answers are written "Photo / Video"). subcategory is a narrower group inside it. wrong_def1–3 are believable near-miss definitions, ideally of related terms, never silly. sentence uses the term in a realistic way. Leave image blank.'
    },
    {
      id: 'sentence', name: 'Sentence pairs', icon: '🗣️',
      blurb: 'A sentence and its translation.',
      main: 'sentence', second: 'translation',
      cols: [
        { key: 'level', label: 'Level', req: true, hint: 'Difficulty from 1 (easiest) to 5.' },
        { key: 'sentence', label: 'Sentence', req: true, hint: 'The sentence students read and hear (e.g. Spanish).' },
        { key: 'translation', label: 'Translation', req: true, hint: 'What students build from word tiles (e.g. English).' },
        { key: 'also_accept', label: 'Also accept', hint: 'Other correct translations, separated by |' },
        { key: 'decoys', label: 'Decoy words', hint: 'Extra wrong tiles shown at levels 4–5, separated by |' },
        { key: 'word_tips', label: 'Word tips', hint: 'Shown when a student taps a word: perro = dog | tengo = I have' },
        { key: 'notes', label: 'Notes', hint: 'Shown after the student answers.' }
      ],
      examples: [
        { level: '1', sentence: 'Tengo un perro.', translation: 'I have a dog', also_accept: '', decoys: 'cat | has', word_tips: 'tengo = I have | perro = dog', notes: '' },
        { level: '2', sentence: 'Mi hermano tiene doce años.', translation: 'My brother is twelve years old', also_accept: 'My brother is twelve', decoys: 'has | sister', word_tips: 'tiene = has | años = years', notes: 'Spanish says you "have" years' }
      ],
      aiRules: 'level is 1–5 (aim for at least 3 sentences at each level). translation is the most natural English. also_accept lists other correct translations separated by " | ". decoys are 2–3 plausible wrong English words separated by " | ". word_tips gives the key words as "word = meaning" separated by " | ". notes is an optional one-line grammar tip.'
    },
    {
      id: 'mcq', name: 'Multiple choice', icon: '☑️',
      blurb: 'A question with one right answer.',
      main: 'question', second: 'correct',
      cols: [
        { key: 'question', label: 'Question', req: true },
        { key: 'correct', label: 'Correct answer', req: true },
        { key: 'wrong', label: 'Wrong answer', count: 3, min: 1, hint: 'At least one. Make them believable.' },
        { key: 'image', label: 'Image link', hint: 'Optional, for "what is this?" questions.' },
        { key: 'explanation', label: 'Explanation', hint: 'Why the answer is right. Shown after.' },
        { key: 'level', label: 'Level', hint: 'Optional difficulty 1–5.' }
      ],
      examples: [
        { question: 'Which file format keeps a logo sharp at any size?', correct: 'SVG', wrong: ['JPG', 'PNG', 'GIF'], image: '', explanation: 'SVG is a vector format.', level: '2' },
        { question: 'What does ISO control?', correct: 'How sensitive the sensor is to light', wrong: ['How long the shutter stays open', 'How wide the lens opens', ''], image: '', explanation: '', level: '1' }
      ],
      aiRules: 'wrong1–3 are believable wrong answers of the same kind as the correct one. explanation is one short sentence. level is 1–5.'
    },
    {
      id: 'prompt', name: 'Prompt and reveal', icon: '💡',
      blurb: 'An open question, then the expert answer.',
      main: 'prompt', second: 'reveal',
      cols: [
        { key: 'prompt', label: 'Prompt', req: true, hint: 'What students think about or pitch.' },
        { key: 'reveal', label: 'Reveal', req: true, hint: 'The pro answer or what actually happened.' },
        { key: 'media', label: 'Image or video link', hint: 'Optional example to show.' },
        { key: 'constraint', label: 'Constraint', hint: 'Optional limit, e.g. "$0 and a phone".' }
      ],
      examples: [
        { prompt: 'How would you make a shot look like it was filmed underwater, without water?', reveal: 'Pros use "dry for wet": haze, blue-green light through a rippled sheet, and slow-motion movement.', media: '', constraint: 'One light and a phone' }
      ],
      aiRules: 'prompt is an open question students can brainstorm about. reveal explains how professionals actually do it in 2–3 sentences. constraint is an optional fun limit.'
    },
    {
      id: 'sort', name: 'Sort into groups', icon: '🗂️',
      blurb: 'Items that each belong in a group.',
      main: 'item', second: 'group',
      cols: [
        { key: 'item', label: 'Item', req: true },
        { key: 'group', label: 'Group', req: true, hint: 'Use the exact same group names on every row.' }
      ],
      examples: [{ item: 'Logo for a billboard', group: 'Vector' }, { item: 'Photo of a sunset', group: 'Raster' }],
      aiRules: 'Use 2–4 groups and spell each group name exactly the same on every row.'
    },
    {
      id: 'order', name: 'Put in order', icon: '🔢',
      blurb: 'Steps that go in a set order.',
      main: 'title', second: null,
      cols: [
        { key: 'title', label: 'Title', req: true, hint: 'What the steps are for.' },
        { key: 'step', label: 'Step', count: 8, min: 2, hint: 'In the correct order. Use as many as you need.' }
      ],
      examples: [{ title: 'Export a video for YouTube', step: ['Finish the edit', 'Mark in and out points', 'Choose an H.264 preset', 'Set the output name and folder', 'Export', '', '', ''] }],
      aiRules: 'Each row is one process. Put the steps in the correct order, 3–8 steps, one short action each. Leave unused step columns blank.'
    }
  ];
  const TYPE = Object.fromEntries(TYPES.map(t => [t.id, t]));

  // ---------- Games ----------
  const GAMES = [
    { id: 'sentence_builder', name: 'Sentence Builder', deck: 'sentence', icon: '🧩',
      blurb: 'Students rebuild the translation from word tiles. Difficulty adapts as they go. Self-paced.' },
    { id: 'zero_in', name: 'Zero In', deck: 'vocab', icon: '🎯',
      blurb: 'You run it from the board: pick a word, then category → subcategory → definition, revealing each round.' },
    { id: 'word_reveal', name: 'Word Reveal', deck: 'vocab', icon: '\uD83D\uDD0E',
      blurb: 'Reverse Zero In. Clues appear on a timer while students guess the term with Wordle tiles. Self-paced.' }
  ];
  const GAME = Object.fromEntries(GAMES.map(g => [g.id, g]));
  const SOON = {
    vocab: ['Flashcards', 'Matching'],
    sentence: ['Reverse builder', 'Listen and type'],
    mcq: ['Quiz race', 'Adaptive quiz'],
    prompt: ['How would you make it?', 'Quick write'],
    sort: ['Bucket sort'],
    order: ['Sequence it']
  };

  // ---------- Columns ----------
  const normHead = h => String(h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const ALIASES = {
    sentence: { spanish: 'sentence', prompt: 'sentence', english: 'translation', answer: 'translation',
      difficulty: 'level', glossary: 'word_tips', word_info: 'word_tips', alternates: 'also_accept', distractors: 'decoys' },
    vocab: { word: 'term', meaning: 'definition' },
    mcq: { answer: 'correct', right_answer: 'correct' }
  };

  // Header list for a type (numbered columns expanded).
  function headers(type, countsUsed) {
    const out = [];
    TYPE[type].cols.forEach(c => {
      if (!c.count) { out.push(c.key); return; }
      const n = Math.max(c.min || 0, (countsUsed && countsUsed[c.key]) || c.count);
      for (let i = 1; i <= n; i++) out.push(c.key + i);
    });
    return out;
  }

  // Map each sheet column index to {key, n} for a type.
  function mapHeader(type, headRow) {
    const t = TYPE[type], alias = ALIASES[type] || {};
    const keys = new Set(t.cols.map(c => c.key));
    return headRow.map(h => {
      let k = normHead(h);
      if (alias[k]) k = alias[k];
      if (keys.has(k)) return { key: k, n: 0 };
      const m = k.match(/^(.*?)_?(\d+)$/);
      if (m) {
        let base = alias[m[1]] || m[1];
        if (keys.has(base) && t.cols.find(c => c.key === base).count) return { key: base, n: +m[2] };
      }
      return null;
    });
  }

  // Guess which type a sheet is from its header.
  function detectType(rows) {
    if (!rows.length) return null;
    let best = null, bestScore = 0;
    TYPES.forEach(t => {
      const map = mapHeader(t.id, rows[0]).filter(Boolean);
      const found = new Set(map.map(m => m.key));
      const req = t.cols.filter(c => c.req || c.min).map(c => c.key);
      if (!req.every(k => found.has(k))) return;
      const score = found.size * 10 + req.length;
      if (score > bestScore) { bestScore = score; best = t.id; }
    });
    return best;
  }

  function cleanText(text) {
    // AI tools often wrap CSV in ``` fences.
    return String(text || '').replace(/^\s*```[a-z]*\s*\n/i, '').replace(/\n```\s*$/,'');
  }

  // ---------- Rows <-> items ----------
  // An item is what's saved in the questions table.
  const splitBar = s => String(s || '').split('|').map(x => x.trim()).filter(Boolean);
  function parseTips(s) {
    const out = {};
    splitBar(s).forEach(e => { const m = e.match(/^([^=:]+)[=:](.+)$/); if (m) out[WU.glossKey(m[1])] = m[2].trim(); });
    return out;
  }

  function rowToItem(type, row, sort) {
    const t = TYPE[type];
    if (type === 'sentence') {
      return {
        qtype: 'build_en', level: Math.min(5, Math.max(1, parseInt(row.level, 10) || 1)),
        prompt: row.sentence, answer: row.translation,
        also_accept: splitBar(row.also_accept), decoys: splitBar(row.decoys), glossary: parseTips(row.word_tips),
        notes: row.notes || null, data: {}, sort
      };
    }
    const lv = parseInt(row.level, 10);
    return {
      qtype: type, level: lv >= 1 && lv <= 5 ? lv : 1,
      prompt: row[t.main], answer: t.second ? row[t.second] : (row.step || []).filter(Boolean).join(' → '),
      data: row, sort
    };
  }

  function itemToRow(type, it) {
    if (type === 'sentence') {
      return {
        level: String(it.level), sentence: it.prompt, translation: it.answer,
        also_accept: (it.also_accept || []).join(' | '), decoys: (it.decoys || []).join(' | '),
        word_tips: Object.entries(it.glossary || {}).map(([k, v]) => `${k} = ${v}`).join(' | '),
        notes: it.notes || ''
      };
    }
    const row = Object.assign({}, it.data || {});
    TYPE[type].cols.forEach(c => { if (c.count && !Array.isArray(row[c.key])) row[c.key] = []; if (!c.count && row[c.key] == null) row[c.key] = ''; });
    return row;
  }

  // Check one row; returns an error string or null.
  function checkRow(type, row) {
    const t = TYPE[type];
    for (const c of t.cols) {
      if (c.req && !String(row[c.key] || '').trim()) return `needs ${c.label.toLowerCase()}`;
      if (c.min && (row[c.key] || []).filter(Boolean).length < c.min) return `needs at least ${c.min} ${c.label.toLowerCase()}${c.min > 1 ? 's' : ''}`;
    }
    if (type === 'sentence') {
      const lv = parseInt(row.level, 10);
      if (!(lv >= 1 && lv <= 5)) return 'level must be 1–5';
    }
    return null;
  }

  // Parse pasted/uploaded text into items for a type.
  function importText(type, text) {
    const rows = WU.parseTable(cleanText(text));
    if (!rows.length) return { items: [], errors: ['The sheet looks empty.'], detected: null };
    const detected = detectType(rows);
    const t = TYPE[type];
    const map = mapHeader(type, rows[0]);
    const found = new Set(map.filter(Boolean).map(m => m.key));
    const missing = t.cols.filter(c => (c.req || c.min) && !found.has(c.key)).map(c => c.count ? c.key + '1' : c.key);
    if (missing.length) {
      const hint = detected && detected !== type ? ` This looks like a ${TYPE[detected].name} sheet.` : '';
      return { items: [], errors: [`Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.${hint}`], detected };
    }
    const items = [], errors = [];
    rows.slice(1).forEach((r, i) => {
      const row = {};
      t.cols.forEach(c => { row[c.key] = c.count ? [] : ''; });
      map.forEach((m, ci) => {
        if (!m) return;
        const v = String(r[ci] == null ? '' : r[ci]).trim();
        if (m.n) row[m.key][m.n - 1] = v; else row[m.key] = v;
      });
      t.cols.forEach(c => { if (c.count) row[c.key] = Array.from(row[c.key], x => x || '').filter(Boolean); });
      if (t.cols.every(c => c.count ? !row[c.key].length : !row[c.key])) return; // blank row
      const err = checkRow(type, row);
      if (err) { errors.push(`Row ${i + 2}: ${err}.`); return; }
      items.push(rowToItem(type, row, items.length));
    });
    if (!items.length && !errors.length) errors.push('No rows found under the header row.');
    return { items, errors, detected };
  }

  // ---------- CSV out ----------
  const csvCell = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };

  function rowsToCsv(type, rows) {
    const used = {};
    TYPE[type].cols.filter(c => c.count).forEach(c => {
      used[c.key] = Math.max(c.count, ...rows.map(r => (r[c.key] || []).length));
    });
    const head = headers(type, used);
    const lines = rows.map(r => {
      const cells = [];
      TYPE[type].cols.forEach(c => {
        if (!c.count) { cells.push(csvCell(r[c.key])); return; }
        for (let i = 0; i < used[c.key]; i++) cells.push(csvCell((r[c.key] || [])[i] || ''));
      });
      return cells.join(',');
    });
    return [head.join(',')].concat(lines).join('\n') + '\n';
  }

  function templateCsv(type) { return rowsToCsv(type, TYPE[type].examples); }
  function itemsToCsv(type, items) { return rowsToCsv(type, items.map(it => itemToRow(type, it))); }

  // ---------- AI prompts ----------
  function aiPromptNew(type) {
    const t = TYPE[type];
    return `Make a CSV file for a classroom "${t.name}" deck about: [TOPIC — e.g. what your class is studying].

Use exactly these columns, in this order, with this header row:
${headers(type).join(',')}

Rules:
- ${t.cols.filter(c => c.req || c.min).map(c => c.count ? `${c.key}1${c.min > 1 ? '–' + c.key + c.min : ''}` : c.key).join(', ')} must be filled in on every row.
- ${t.aiRules}
- Put any cell that contains a comma in double quotes.
- Make 15–20 rows.
- Reply with only the CSV, no other text.`;
  }

  function aiPromptFill(type, items) {
    const t = TYPE[type];
    return `Here is a CSV for a classroom "${t.name}" deck. Fill in any EMPTY cells. Don't change cells that already have something in them, and keep the same columns and row order.

Rules: ${t.aiRules}
Put any cell that contains a comma in double quotes. Reply with only the full CSV, no other text.

${itemsToCsv(type, items)}`;
  }

  // ---------- Which games a deck can play ----------
  // Returns [{game, ok, note}] for games that play this deck type.
  function playable(type, items) {
    return GAMES.filter(g => g.deck === type).map(g => {
      if (g.id === 'sentence_builder') {
        if (!items.length) return { game: g, ok: false, note: 'Add at least one sentence.' };
        const n = [0, 0, 0, 0, 0]; items.forEach(x => n[(x.level || 1) - 1]++);
        return { game: g, ok: true, note: n.some(x => x < 3) ? 'Tip: 3+ sentences at each level makes the difficulty steps work best.' : '' };
      }
      if (g.id === 'zero_in') {
        if (items.length < 2) return { game: g, ok: false, note: 'Add at least 2 terms.' };
        const rows = items.map(it => it.data || {});
        const cats = new Set(rows.flatMap(r => splitSlash(r.category)));
        const notes = [];
        if (cats.size < 2) notes.push('add categories (2+ different ones) to get the category round');
        if (!rows.some(r => r.subcategory)) notes.push('add subcategories to get the "more specific" round');
        return { game: g, ok: true, note: notes.length ? 'Plays with fewer rounds — ' + notes.join('; ') + '.' : '' };
      }
      if (g.id === 'word_reveal') {
        if (!items.length) return { game: g, ok: false, note: 'Add at least one term.' };
        const rows = items.map(it => it.data || {});
        return { game: g, ok: true, note: rows.some(r => r.category || r.subcategory) ? '' : 'Only the definition will show as a clue \u2014 add categories/subcategories for more clues.' };
      }
      return { game: g, ok: true, note: '' };
    });
  }

  // ---------- Zero In: build the rounds for one term ----------
  const splitSlash = s => String(s || '').split(/\s+\/\s+/).map(x => x.trim()).filter(Boolean);
  function shuffle(arr, rand) {
    rand = rand || Math.random;
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  function zeroInPlan(item, allItems, rand) {
    const d = item.data || {}, rows = allItems.map(x => ({ id: x.id, d: x.data || {}, def: x.answer }));
    const plan = [];
    const cat = splitSlash(d.category);
    const allCats = [...new Set(rows.flatMap(r => splitSlash(r.d.category)))];
    if (cat.length && allCats.length >= 2) {
      const wrong = shuffle(allCats.filter(c => !cat.includes(c)), rand).slice(0, Math.max(1, 5 - cat.length));
      plan.push({ name: 'General', prompt: 'Which area does this word belong to?', correct: cat, options: shuffle(cat.concat(wrong), rand) });
    }
    const sub = splitSlash(d.subcategory);
    if (sub.length) {
      const same = rows.filter(r => r.id !== item.id && splitSlash(r.d.category).some(c => cat.includes(c))).flatMap(r => splitSlash(r.d.subcategory));
      const other = rows.filter(r => r.id !== item.id).flatMap(r => splitSlash(r.d.subcategory));
      const pool = [...new Set(shuffle(same, rand).concat(shuffle(other, rand)))].filter(s => !sub.includes(s));
      if (pool.length) plan.push({ name: 'More specific', prompt: 'Narrow it down:', correct: sub, options: shuffle(sub.concat(pool.slice(0, 3)), rand) });
    }
    const def = item.answer;
    const own = (d.wrong_def || []).filter(Boolean).filter(w => w !== def);
    const sameDefs = rows.filter(r => r.id !== item.id && splitSlash(r.d.category).some(c => cat.includes(c))).map(r => r.def);
    const otherDefs = rows.filter(r => r.id !== item.id).map(r => r.def);
    const wrong = [...new Set(own.concat(shuffle(sameDefs, rand), shuffle(otherDefs, rand)))].filter(w => w && w !== def).slice(0, 3);
    plan.push({ name: 'Definition', prompt: 'What does it mean?', correct: [def], options: shuffle([def].concat(wrong), rand) });
    return plan;
  }

  const api = { TYPES, TYPE, GAMES, GAME, SOON, headers, mapHeader, detectType, importText, rowToItem, itemToRow,
    checkRow, itemsToCsv, templateCsv, aiPromptNew, aiPromptFill, playable, zeroInPlan, splitSlash, normHead };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DECKS = api;
})(typeof window !== 'undefined' ? window : this);
