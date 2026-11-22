# Warm-Ups

Adaptive class warm-ups. First module: Spanish sentence builder — students read (and hear) a Spanish sentence and rebuild it in English from word tiles. Difficulty moves 1–5 as they go.

- **Students:** open the site → pick their class → type their 4-digit PIN. They can only start once the teacher opens the warm-up.
- **Teachers:** `…/#/teacher` → sign in → set up classes, units and warm-ups; open/close them; watch live; see results.

## One-time setup (about 10 minutes)

1. **Supabase project.** supabase.com → New project (a new one, separate from JARVIS).
2. **Database.** SQL Editor → New query → paste all of `schema.sql` → Run. Then do the same with `update-0.2.sql`, `update-0.3.sql`, `update-0.4.sql`, and `update-0.5.sql`, in that order.
3. **Teacher logins.** Authentication → Users → Add user → Create new user, once per teacher.
   - Email: `lastname@warmup.local` (or a real email). They sign in with just `lastname`.
   - Password: anything. Tick **Auto Confirm User**.
   - On first sign-in each teacher sets the name students see (e.g. "Sra. López").
   - Classes, rosters and results belong to one teacher. **Units are shared**: every teacher can use and edit them; only the teacher who made a unit can delete it, and not once it's been used in a warm-up.
4. **Turn off public sign-ups.** Authentication → Sign In / Providers → turn off "Allow new users to sign up".
5. **Connect the site.** Project Settings → API. Copy the Project URL and the anon / publishable key into `config.js`.
6. **Publish.** GitHub repo → Settings → Pages → Deploy from branch → `main` / root.

## How it's organized

The teacher page has three tabs:

- **Run** — pick a class, a game, and a deck → **Open now** (or save for later). Open and recent warm-ups are listed underneath.
- **Library** — all decks, grouped by folder (course or unit), with search and type filters. Every teacher can use and edit every deck; only the teacher who made a deck can delete it, and not once it's been used.
- **Classes** — rosters, PINs (printable cards), and the results archive for each class.

## Decks

A deck is a spreadsheet: one row per item. The deck **type** sets the columns, and each game plays one type, so a deck can feed every game of that type.

| Type | Required columns | Optional columns | Games |
|---|---|---|---|
| 📖 Vocabulary | `term, definition` | `category, subcategory, wrong_def1–3, sentence, image` | Zero In, Word Reveal · soon: Flashcards, Matching |
| 🗣️ Sentence pairs | `level, sentence, translation` | `also_accept, decoys, word_tips, notes` | Sentence Builder · soon: Reverse builder, Listen and type |
| ☑️ Multiple choice | `question, correct, wrong1` | `wrong2–3, image, explanation, level` | soon: Quiz race, Adaptive quiz |
| 💡 Prompt and reveal | `prompt, reveal` | `media, constraint` | soon: How would you make it?, Quick write |
| 🗂️ Sort into groups | `item, group` | | soon: Bucket sort |
| 🔢 Put in order | `title, step1, step2` | `step3–8` | soon: Sequence it |

**Making a deck:** Library → **+ New deck** → pick a type → **Download template** (or **Copy AI prompt**, paste it into ChatGPT/Claude/Gemini with your topic) → paste the filled sheet or upload the CSV → **Check sheet** → **Save deck**. You can also start empty and add items one at a time.

**Editing:** tap any item on the deck page to edit it, or **+ Add item**. To edit lots at once: **Download CSV** → edit in Google Sheets → **Update from sheet** (replace all, or add to the end). **Copy AI prompt** on a deck includes the whole deck and asks the AI to fill only the blank cells (e.g. missing wrong answers).

Lists use `|` inside one cell (`also_accept`, `decoys`, `word_tips`). Two right categories use ` / ` (`Photo / Video`).

## Games

### Sentence Builder (Sentence pairs decks)
Students read and hear a sentence and rebuild the translation from word tiles. Self-paced; difficulty moves 1–5 (two right → up, two wrong → down). A student finishes at the goal, at their time limit, or when you close it. Decoy tiles show at levels 4–5.

### Zero In (Vocabulary decks)
You run it from the board; students answer on their devices.
1. Pick a word by **Vote** (3 random words) or **Wheel**. A tied vote goes to the wheel.
2. **Category** round → **Subcategory** round → **Definition** round. Students lock in one answer; counts stay hidden until you tap **Reveal**.
3. Final card: term, definition, sentence, image.

Wrong answers are built from the deck: category options come from the deck's other categories, subcategory options prefer the same category, and definition options use `wrong_def1–3` if filled, otherwise other terms' definitions. A deck without categories or subcategories just plays fewer rounds.

### Word Reveal (Vocabulary decks)
Reverse Zero In, self-paced. Each student gets the deck in shuffled order. Clues appear on a timer (default 20 seconds each): **category → subcategory → definition**. After the definition they get one more turn of the timer, then the term is revealed and they move on.
- **Guessing:** the first two guesses can be any word and show which letters are in the term (yellow). From guess 3, the Wordle board appears with the term's letter count: green = right spot, yellow = wrong spot, gray = not in it.
- **Points:** solving during clue 1 of 3 = 3 points, clue 2 = 2, definition = 1, time up = 0.
- **One-word game:** everyone gets the same word (pick one or random); students who solve it wait for the class.
- **Options:** seconds per clue, optional time limit. All checking happens on the server, so the term never reaches the device until it's solved or missed.

### Score
- **Accuracy** = correct ÷ answered · **Goal** = correct ÷ goal (Sentence Builder) · **Points** = sum of the levels of right answers
- **Classes → Results** shows every warm-up for a class (students × days). "Copy for spreadsheet" copies the grid.

## Files
- `index.html` — the app (student + teacher)
- `logic.js` — grading, difficulty, question picking, sheet import
- `config.js` — Supabase connection
- `schema.sql` — database tables, security rules, student functions
- `update-0.2.sql` — teacher profiles, shared units, class results archive
- `update-0.3.sql` — Zero In
- `update-0.4.sql` — deck library, folders, game per warm-up
- `update-0.5.sql` — Word Reveal
- `wordreveal.js` — Word Reveal student screen
- `decks.js` — deck types, templates, import/export, AI prompts
- `library.js` — Library pages
- `zeroin.js` — Zero In teacher and student screens
- `vocab-sample.csv` — Comm Tech vocabulary sample
- `sample-unit.csv` — Spanish sentence pairs sample
