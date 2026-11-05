# Warm-Ups

Adaptive class warm-ups. First module: Spanish sentence builder — students read (and hear) a Spanish sentence and rebuild it in English from word tiles. Difficulty moves 1–5 as they go.

- **Students:** open the site → pick their class → type their 4-digit PIN. They can only start once the teacher opens the warm-up.
- **Teachers:** `…/#/teacher` → sign in → set up classes, units and warm-ups; open/close them; watch live; see results.

## One-time setup (about 10 minutes)

1. **Supabase project.** supabase.com → New project (a new one, separate from JARVIS).
2. **Database.** SQL Editor → New query → paste all of `schema.sql` → Run. Then do the same with `update-0.2.sql`.
3. **Teacher logins.** Authentication → Users → Add user → Create new user, once per teacher.
   - Email: `lastname@warmup.local` (or a real email). They sign in with just `lastname`.
   - Password: anything. Tick **Auto Confirm User**.
   - On first sign-in each teacher sets the name students see (e.g. "Sra. López").
   - Classes, rosters and results belong to one teacher. **Units are shared**: every teacher can use and edit them; only the teacher who made a unit can delete it, and not once it's been used in a warm-up.
4. **Turn off public sign-ups.** Authentication → Sign In / Providers → turn off "Allow new users to sign up".
5. **Connect the site.** Project Settings → API. Copy the Project URL and the anon / publishable key into `config.js`.
6. **Publish.** GitHub repo → Settings → Pages → Deploy from branch → `main` / root.

## Using it

1. **Classes** → add a class → paste names (one per line). Each student gets a PIN. "Print PIN cards" makes cut-out cards.
2. **Units** → paste a Google Sheet tab (or upload it as CSV). "Add the sample unit" loads 20 test questions.
3. **Warm-ups** → pick class + unit, set the goal (correct answers), time limit (minutes) and starting level → Save for later.
4. When class starts → **Open now**. Students waiting on the PIN screen start automatically.
5. **Close warm-up** at the end. Results stay on that warm-up's page; tap a student to see every answer.
6. **Classes → Results** shows every warm-up the class has done: students down the side, days across the top. Tap a day for its full results. "Copy for spreadsheet" copies the grid (correct answers per day, "absent" if they didn't join).

### How a student finishes
Whichever comes first: they hit the goal, their time runs out (counted from when *they* joined), or the teacher closes it.

### How difficulty moves
Two correct at a level → up one. Two wrong at a level → down one. Questions come from the student's level first, then the nearest level. Decoy tiles appear at levels 4–5.

### Score
- **Accuracy** = correct ÷ answered
- **Goal** = correct ÷ goal
- **Points** = sum of the levels of the questions they got right (rewards harder work)

## Google Sheet template

One tab per unit. Header row:

| level | spanish | english | also_accept | decoys | glossary | notes |
|---|---|---|---|---|---|---|
| 2 | Mi hermano tiene doce años. | My brother is twelve years old | My brother is twelve | has \| sister | hermano = brother \| tiene = has | Spanish "has" years |

- **level** 1–5 (required)
- **spanish**, **english** (required). Tiles are made from the English words.
- **also_accept** other correct answers, separated by `|`. They must be buildable from the tiles (plus decoys).
- **decoys** extra wrong tiles, separated by `|` (only shown at levels 4–5).
- **glossary** word tips shown when a student taps an underlined Spanish word: `word = meaning`, separated by `|`. Phrases work too (`me gusta = I like`).
- **notes** shown after the student answers.

Aim for at least 3 questions per level so the difficulty steps have room to work.

`sample-unit.csv` is a filled-in example — in Google Sheets: File → Import → Upload.

## Files
- `index.html` — the app (student + teacher)
- `logic.js` — grading, difficulty, question picking, sheet import
- `config.js` — Supabase connection
- `schema.sql` — database tables, security rules, student functions
- `update-0.2.sql` — teacher profiles, shared units, class results archive
- `sample-unit.csv` — sample unit / template
