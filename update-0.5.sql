-- =====================================================================
-- Warm-Ups v0.5 — Word Reveal (reverse Zero In + Wordle tiles)
-- Each student works through a Vocabulary deck at their own pace.
-- Clues appear on a timer (category -> subcategory -> definition) while
-- they guess the term with Wordle-style letter feedback.
-- The term never leaves the server until the student solves or misses it.
-- Run once in Supabase > SQL Editor, after update-0.4.sql. Safe to run again.
-- =====================================================================

-- Each student's progress through the deck.
alter table participants add column if not exists wr jsonb not null default '{}'::jsonb;

-- Every guess (for the teacher's detail view).
create table if not exists wr_guesses (
  id             bigint generated always as identity primary key,
  participant_id uuid not null references participants(id) on delete cascade,
  question_id    uuid references questions(id) on delete set null,
  guess          text not null,
  created_at     timestamptz not null default now()
);
create index if not exists wr_guesses_participant_idx on wr_guesses(participant_id);
alter table wr_guesses enable row level security;
drop policy if exists "teacher sees guesses" on wr_guesses;
create policy "teacher sees guesses" on wr_guesses for select to authenticated
  using (exists (select 1 from participants p join sessions s on s.id = p.session_id
                 join classes c on c.id = s.class_id
                 where p.id = participant_id and c.teacher_id = auth.uid()));

-- ---------- Helpers (not callable by students) --------------------------
-- Letters only, upper case: "Depth of field" -> "DEPTHOFFIELD"
create or replace function _wr_norm(t text) returns text
language sql immutable as $$ select upper(regexp_replace(coalesce(t, ''), '[^[:alpha:]]', '', 'g')) $$;

-- Letter counts of each word in the term: "Depth of field" -> [5,2,5]
create or replace function _wr_shape(t text) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(length(w) order by ord), '[]'::jsonb)
  from unnest(regexp_split_to_array(regexp_replace(coalesce(t, ''), '[^[:alpha:][:space:]-]', '', 'g'), '[[:space:]-]+'))
       with ordinality as x(w, ord)
  where length(w) > 0
$$;

-- Clues for a term, in order. Category/subcategory are skipped if blank.
create or replace function _wr_clues(q questions) returns jsonb
language sql immutable as $$
  select (case when coalesce(q.data->>'category', '') <> ''
               then jsonb_build_array(jsonb_build_object('label', 'Category', 'text', q.data->>'category')) else '[]'::jsonb end)
      || (case when coalesce(q.data->>'subcategory', '') <> ''
               then jsonb_build_array(jsonb_build_object('label', 'Subcategory', 'text', q.data->>'subcategory')) else '[]'::jsonb end)
      || jsonb_build_array(jsonb_build_object('label', 'Definition', 'text', q.answer))
$$;

-- Letter feedback. Discovery guesses (first two) can be any length and only
-- say whether each letter is in the term. After that it's Wordle:
-- hit = right letter, right spot; near = in the term, wrong spot; out = not in it.
create or replace function _wr_feedback(word text, guess text, discovery boolean) returns jsonb
language plpgsql immutable as $$
declare
  w text[] := regexp_split_to_array(word, '');
  g text[] := regexp_split_to_array(guess, '');
  res text[];
  pool text[] := '{}';
  i int; k int;
begin
  if guess = '' then return '[]'::jsonb; end if;
  if discovery then
    select array_agg(case when position(c in word) > 0 then 'in' else 'out' end order by ord)
      into res from unnest(g) with ordinality as x(c, ord);
    return to_jsonb(res);
  end if;
  res := array_fill('out'::text, array[array_length(g, 1)]);
  for i in 1 .. array_length(g, 1) loop
    if g[i] = w[i] then res[i] := 'hit'; else pool := pool || w[i]; end if;
  end loop;
  for i in 1 .. array_length(g, 1) loop
    if res[i] <> 'hit' then
      k := array_position(pool, g[i]);
      if k is not null then
        res[i] := 'near';
        pool := pool[1:k-1] || pool[k+1:];
      end if;
    end if;
  end loop;
  return to_jsonb(res);
end;
$$;

-- Bring a student's progress up to date: build their word order, start the
-- next word, and mark the current word missed if its time has run out.
create or replace function _wr_tick(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p    participants;
  sess sessions;
  vw   jsonb;
  cur  jsonb;
  q    questions;
  ord  jsonb;
  secs int;
  n    int;
  idx  int;
begin
  select * into p from participants where id = p_id for update;
  select * into sess from sessions where id = p.session_id;
  vw := coalesce(p.wr, '{}'::jsonb);
  secs := greatest(5, coalesce((sess.live->>'clue_secs')::int, 20));

  if not (vw ? 'order') then
    if coalesce((sess.live->>'one_word')::boolean, false) and (sess.live->>'word_id') is not null then
      ord := jsonb_build_array(sess.live->>'word_id');
    else
      select coalesce(jsonb_agg(id::text order by random()), '[]'::jsonb) into ord
        from questions where unit_id = sess.unit_id and coalesce(prompt, '') <> '';
    end if;
    vw := jsonb_build_object('order', ord, 'idx', 0, 'cur', null);
  end if;

  idx := (vw->>'idx')::int;
  if sess.status = 'open' and (vw->'cur' is null or vw->'cur' = 'null'::jsonb)
     and idx < jsonb_array_length(vw->'order') then
    vw := jsonb_set(vw, '{cur}', jsonb_build_object(
      'qid', vw->'order'->>idx, 'started', now(), 'guesses', '[]'::jsonb, 'result', null));
  end if;

  cur := vw->'cur';
  if cur is not null and cur <> 'null'::jsonb and (cur->>'result') is null then
    select * into q from questions where id = (cur->>'qid')::uuid;
    n := jsonb_array_length(_wr_clues(q));
    if now() >= (cur->>'started')::timestamptz + make_interval(secs => secs * n) then
      vw := jsonb_set(vw, '{cur,result}', '"missed"');
      insert into attempts (participant_id, question_id, level, correct, response, step)
      values (p.id, q.id, 0, false, '(ran out of time)', idx + 1)
      on conflict (participant_id, step) where step is not null do nothing;
    end if;
  end if;

  update participants set wr = vw, last_seen = now() where id = p.id;
  return vw;
end;
$$;

-- What the student's device sees.
create or replace function _wr_view(p_id uuid) returns json
language plpgsql security definer set search_path = public as $$
declare
  p     participants;
  sess  sessions;
  vw    jsonb;
  cur   jsonb;
  q     questions;
  clues jsonb;
  n     int;
  secs  int;
  el    numeric;
  shown int;
  done  boolean;
  o     jsonb;
  c     jsonb;
  sname text;
begin
  select * into p from participants where id = p_id;
  select * into sess from sessions where id = p.session_id;
  select name into sname from students where id = p.student_id;
  vw := p.wr;
  secs := greatest(5, coalesce((sess.live->>'clue_secs')::int, 20));
  o := jsonb_build_object(
    'status', sess.status, 'student_name', sname,
    'one_word', coalesce((sess.live->>'one_word')::boolean, false),
    'clue_secs', secs,
    'word_no', coalesce((vw->>'idx')::int, 0) + 1,
    'word_count', jsonb_array_length(coalesce(vw->'order', '[]'::jsonb)),
    'solved', (select count(*) filter (where a.correct) from attempts a where a.participant_id = p.id),
    'finished_words', (select count(*) from attempts a where a.participant_id = p.id),
    'points', (select coalesce(sum(a.level) filter (where a.correct), 0) from attempts a where a.participant_id = p.id),
    'time_left', case when sess.time_limit_min is not null
      then greatest(0, extract(epoch from (p.joined_at + make_interval(mins => sess.time_limit_min)) - now()))::int end);

  cur := vw->'cur';
  if cur is null or cur = 'null'::jsonb then
    return o || jsonb_build_object('finished', true);
  end if;

  select * into q from questions where id = (cur->>'qid')::uuid;
  clues := _wr_clues(q);
  n := jsonb_array_length(clues);
  el := extract(epoch from now() - (cur->>'started')::timestamptz);
  done := (cur->>'result') is not null;
  shown := case when done then n else least(n, floor(el / secs)::int + 1) end;

  c := jsonb_build_object(
    'qid', q.id,
    'clues', (select coalesce(jsonb_agg(x order by i), '[]'::jsonb) from jsonb_array_elements(clues) with ordinality as e(x, i) where i <= shown),
    'clue_count', n,
    'next_in', case when not done and shown < n then round(secs * shown - el, 1) end,
    'ends_in', case when not done then round(secs * n - el, 1) end,
    'guesses', coalesce(cur->'guesses', '[]'::jsonb),
    'discovery_left', greatest(0, 2 - jsonb_array_length(coalesce(cur->'guesses', '[]'::jsonb))),
    'result', cur->>'result');
  if done or jsonb_array_length(coalesce(cur->'guesses', '[]'::jsonb)) >= 2 then
    c := c || jsonb_build_object('shape', _wr_shape(q.prompt), 'letters', length(_wr_norm(q.prompt)));
  end if;
  if done then
    c := c || jsonb_build_object('answer', q.prompt, 'points', (cur->>'points')::int, 'sentence', q.data->>'sentence');
  end if;
  return o || jsonb_build_object('finished', false, 'cur', c);
end;
$$;

-- ---------- Student functions ------------------------------------------
create or replace function wr_state(p_token uuid) returns json
language plpgsql security definer set search_path = public as $$
declare p participants;
begin
  select * into p from participants where token = p_token;
  if not found then return json_build_object('error', 'bad_token'); end if;
  perform _wr_tick(p.id);
  return _wr_view(p.id);
end;
$$;

create or replace function wr_guess(p_token uuid, p_guess text) returns json
language plpgsql security definer set search_path = public as $$
declare
  p     participants;
  sess  sessions;
  vw    jsonb;
  cur   jsonb;
  q     questions;
  word  text;
  g     text;
  ng    int;
  fb    jsonb;
  n     int;
  secs  int;
  stage int;
  pts   int;
begin
  select * into p from participants where token = p_token;
  if not found then return json_build_object('error', 'bad_token'); end if;
  select * into sess from sessions where id = p.session_id;
  if sess.status <> 'open' then return _wr_view(p.id); end if;

  vw := _wr_tick(p.id);
  cur := vw->'cur';
  if cur is null or cur = 'null'::jsonb or (cur->>'result') is not null then return _wr_view(p.id); end if;

  select * into q from questions where id = (cur->>'qid')::uuid;
  word := _wr_norm(q.prompt);
  g := _wr_norm(left(p_guess, 80));
  if g = '' then return (_wr_view(p.id)::jsonb || '{"error":"empty"}')::json; end if;
  ng := jsonb_array_length(coalesce(cur->'guesses', '[]'::jsonb));

  if g = word then
    fb := to_jsonb(array_fill('hit'::text, array[length(word)]));
  elsif ng < 2 then
    fb := _wr_feedback(word, g, true);
  elsif length(g) <> length(word) then
    return (_wr_view(p.id)::jsonb || jsonb_build_object('error', 'length', 'need', length(word)))::json;
  else
    fb := _wr_feedback(word, g, false);
  end if;

  vw := jsonb_set(vw, '{cur,guesses}', coalesce(cur->'guesses', '[]'::jsonb)
          || jsonb_build_array(jsonb_build_object('g', g, 'fb', fb, 'mode', case when ng < 2 and g <> word then 'discovery' else 'board' end)));
  insert into wr_guesses (participant_id, question_id, guess) values (p.id, q.id, g);

  if g = word then
    secs := greatest(5, coalesce((sess.live->>'clue_secs')::int, 20));
    n := jsonb_array_length(_wr_clues(q));
    stage := least(n, floor(extract(epoch from now() - (cur->>'started')::timestamptz) / secs)::int + 1);
    pts := n - stage + 1;
    vw := jsonb_set(jsonb_set(vw, '{cur,result}', '"solved"'), '{cur,points}', to_jsonb(pts));
    insert into attempts (participant_id, question_id, level, correct, response, step)
    values (p.id, q.id, pts, true, g, (vw->>'idx')::int + 1)
    on conflict (participant_id, step) where step is not null do nothing;
  end if;

  update participants set wr = vw, last_seen = now() where id = p.id;
  return _wr_view(p.id);
end;
$$;

-- After solving or missing a word, move to the next one.
create or replace function wr_next(p_token uuid) returns json
language plpgsql security definer set search_path = public as $$
declare
  p    participants;
  sess sessions;
  vw   jsonb;
begin
  select * into p from participants where token = p_token;
  if not found then return json_build_object('error', 'bad_token'); end if;
  select * into sess from sessions where id = p.session_id;
  vw := _wr_tick(p.id);
  if (vw->'cur'->>'result') is not null and not coalesce((sess.live->>'one_word')::boolean, false) then
    vw := jsonb_set(jsonb_set(vw, '{idx}', to_jsonb((vw->>'idx')::int + 1)), '{cur}', 'null'::jsonb);
    update participants set wr = vw where id = p.id;
    perform _wr_tick(p.id);
  end if;
  return _wr_view(p.id);
end;
$$;

revoke execute on function _wr_tick(uuid), _wr_view(uuid) from public, anon, authenticated;
revoke execute on function _wr_feedback(text, text, boolean), _wr_clues(questions) from public, anon, authenticated;
grant execute on function wr_state(uuid)       to anon, authenticated;
grant execute on function wr_guess(uuid, text) to anon, authenticated;
grant execute on function wr_next(uuid)        to anon, authenticated;

notify pgrst, 'reload schema';
