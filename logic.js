// Warm-Ups — pure logic (no page or database code), shared by the app and tests.
(function (root) {
  'use strict';

  // ---------- Spreadsheet import ----------

  // Parses CSV (downloaded from Google Sheets) or tab-separated text
  // (copied straight out of Google Sheets and pasted).
  function parseTable(text) {
    text = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const firstLine = text.split('\n')[0] || '';
    const delim = firstLine.includes('\t') ? '\t' : ',';
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
        } else cell += ch;
      } else if (ch === '"' && cell === '') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => String(c).trim() !== ''));
  }

  const HEADER_ALIASES = {
    level: ['level', 'difficulty', 'diff'],
    prompt: ['spanish', 'prompt', 'sentence', 'spanish sentence'],
    answer: ['english', 'answer', 'english answer', 'translation'],
    also_accept: ['also_accept', 'also accept', 'alternates', 'alternate answers', 'also'],
    decoys: ['decoys', 'decoy', 'decoy tiles', 'distractors'],
    glossary: ['glossary', 'word info', 'words', 'word notes', 'vocab'],
    notes: ['notes', 'teacher notes', 'note'],
    qtype: ['type', 'question type', 'qtype']
  };

  function parseList(s) {
    return String(s || '').split('|').map(x => x.trim()).filter(Boolean);
  }

  // "gato = cat (noun, m.) | negro = black (adj.)" -> { gato: "cat (noun, m.)", negro: "black (adj.)" }
  function parseGlossary(s) {
    const out = {};
    parseList(s).forEach(entry => {
      const m = entry.match(/^([^=:]+)[=:](.+)$/);
      if (m) out[glossKey(m[1])] = m[2].trim();
    });
    return out;
  }

  function rowsToQuestions(rows) {
    const errors = [];
    if (!rows.length) return { questions: [], errors: ['The sheet looks empty.'] };
    const header = rows[0].map(h => String(h).trim().toLowerCase());
    const col = {};
    for (const key in HEADER_ALIASES) {
      const idx = header.findIndex(h => HEADER_ALIASES[key].includes(h));
      if (idx >= 0) col[key] = idx;
    }
    ['level', 'prompt', 'answer'].forEach(k => {
      if (col[k] === undefined) errors.push(`Missing a "${HEADER_ALIASES[k][0]}" column.`);
    });
    if (errors.length) return { questions: [], errors };

    const questions = [];
    rows.slice(1).forEach((r, i) => {
      const get = k => (col[k] === undefined ? '' : String(r[col[k]] || '').trim());
      const lineNo = i + 2;
      const prompt = get('prompt'), answer = get('answer');
      if (!prompt && !answer) return;
      const level = parseInt(get('level'), 10);
      if (!(level >= 1 && level <= 5)) { errors.push(`Row ${lineNo}: level must be 1–5.`); return; }
      if (!prompt || !answer) { errors.push(`Row ${lineNo}: needs both Spanish and English.`); return; }
      questions.push({
        qtype: get('qtype') || 'build_en',
        level, prompt, answer,
        also_accept: parseList(get('also_accept')),
        decoys: parseList(get('decoys')),
        glossary: parseGlossary(get('glossary')),
        notes: get('notes') || null,
        sort: questions.length
      });
    });
    if (!questions.length && !errors.length) errors.push('No questions found under the header row.');
    return { questions, errors };
  }

  // ---------- Sentences ----------

  const PUNCT = /[.,!?;:"“”¿¡«»()]/g;

  function tokenize(sentence) {
    return String(sentence || '').replace(/[’‘]/g, "'").replace(PUNCT, ' ')
      .split(/\s+/).filter(Boolean);
  }

  function norm(s) {
    return tokenize(s).join(' ').toLowerCase();
  }

  function glossKey(word) {
    return String(word || '').replace(/[’‘]/g, "'").replace(PUNCT, '').trim().toLowerCase();
  }

  function isCorrect(builtWords, q) {
    const got = norm(builtWords.join(' '));
    if (!got) return false;
    return [q.answer].concat(q.also_accept || []).some(a => norm(a) === got);
  }

  // ---------- Adaptive difficulty ----------
  // 2 correct at a level -> up one; 2 wrong at a level -> down one.
  // Counters reset whenever the level changes.
  function nextLevel(st, correct) {
    let { level, c, w } = st;
    let change = 0;
    if (correct) {
      c++;
      if (c >= 2) { if (level < 5) { level++; change = 1; } c = 0; w = 0; }
    } else {
      w++;
      if (w >= 2) { if (level > 1) { level--; change = -1; } c = 0; w = 0; }
    }
    return { level, c, w, change };
  }

  // Pick the next question: unseen at the current level first, then the
  // nearest level, then repeats (missed ones first). Never the same one twice in a row.
  function pickQuestion(questions, level, attempts, lastId, rand) {
    rand = rand || Math.random;
    if (!questions.length) return null;
    const seen = new Map(), missed = new Set();
    (attempts || []).forEach(a => {
      seen.set(a.question_id, (seen.get(a.question_id) || 0) + 1);
      if (!a.correct) missed.add(a.question_id);
    });
    const pool = questions.length > 1 ? questions.filter(q => q.id !== lastId) : questions;
    const pickFrom = arr => arr[Math.floor(rand() * arr.length)];

    for (let d = 0; d <= 4; d++) {
      const fresh = pool.filter(q => Math.abs(q.level - level) === d && !seen.has(q.id));
      if (fresh.length) return pickFrom(fresh);
    }
    let best = [], bestScore = Infinity;
    pool.forEach(q => {
      const score = Math.abs(q.level - level) * 10 + (seen.get(q.id) || 0) - (missed.has(q.id) ? 3 : 0);
      if (score < bestScore) { bestScore = score; best = [q]; }
      else if (score === bestScore) best.push(q);
    });
    return pickFrom(best);
  }

  function shuffle(arr, rand) {
    rand = rand || Math.random;
    const a = arr.slice();
    for (let tries = 0; tries < 6; tries++) {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      if (a.length < 3 || a.some((x, i) => x !== arr[i])) break;
    }
    return a;
  }

  // Tiles for a sentence-builder question. Decoys join in at level 4+.
  function buildTiles(q, rand) {
    const words = tokenize(q.answer).map((w, i) => ({ id: 'a' + i, w }));
    const decoys = q.level >= 4 ? (q.decoys || []).map((w, i) => ({ id: 'd' + i, w })) : [];
    return shuffle(words.concat(decoys), rand);
  }

  // ---------- Scoring ----------
  function summarize(attempts, target) {
    const total = attempts.length;
    const correct = attempts.filter(a => a.correct).length;
    const points = attempts.filter(a => a.correct).reduce((s, a) => s + a.level, 0);
    const top = attempts.filter(a => a.correct).reduce((m, a) => Math.max(m, a.level), 0);
    return {
      total, correct, points, topLevel: top,
      accuracy: total ? Math.round((correct / total) * 100) : null,
      completion: target ? Math.min(100, Math.round((correct / target) * 100)) : null
    };
  }

  const api = { parseTable, rowsToQuestions, parseList, parseGlossary, tokenize, norm, glossKey,
    isCorrect, nextLevel, pickQuestion, shuffle, buildTiles, summarize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WU = api;
})(typeof window !== 'undefined' ? window : this);
