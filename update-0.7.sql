-- =====================================================================
-- Warm-Ups v0.7 — Word Reveal: each guess unlocks the next clue
-- (or the clue timer runs out, whichever comes first). Each clue gets a
-- fresh timer window. Teachers can turn this off per warm-up.
-- Run once in Supabase > SQL Editor, after update-0.5.sql. Safe to run again.
-- =====================================================================

-- Work out which clue is showing and when it appeared.
-- Walks through the student's guesses in order: the timer advances a clue
-- every `secs` seconds; with clue_on_guess, each guess also advances one.
create or replace function _wr_progress(cur jsonb, n int, secs int, on_guess boolean, at timestamptz)
returns jsonb
language plpgsql stable as $$
declare
  s  int := 1;
  ts timestamptz := (cur->>'started')::timestamptz;
  gt timestamptz;
  g  jsonb;
begin
  for g in select x from jsonb_array_elements(coalesce(cur->'guesses', '[]'::jsonb)) x loop
    gt := coalesce((g->>'t')::timestamptz, ts);
    if gt > at then exit; end if;
    while s < n and ts + make_interval(secs => secs) <= gt loop s := s + 1; ts := ts + make_interval(secs => secs); end loop;
    if on_guess and s < n then s := s + 1; ts := gt; end if;
  end loop;
  while s < n and ts + make_interval(secs => secs) <= at loop s := s + 1; ts := ts + make_interval(secs => secs); end loop;
  return jsonb_build_object('s', s, 'ts', ts);
end;
$$;

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
  pr   jsonb;
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
    pr := _wr_progress(cur, n, secs, coalesce((sess.live->>'clue_on_guess')::boolean, true), now());
    if (pr->>'s')::int >= n and now() >= (pr->>'ts')::timestamptz + make_interval(secs => secs) then
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
  pr    jsonb;
  ts    timestamptz;
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
  pr := _wr_progress(cur, n, secs, coalesce((sess.live->>'clue_on_guess')::boolean, true), now());
  ts := (pr->>'ts')::timestamptz;
  shown := case when done then n else (pr->>'s')::int end;

  c := jsonb_build_object(
    'qid', q.id,
    'clues', (select coalesce(jsonb_agg(x order by i), '[]'::jsonb) from jsonb_array_elements(clues) with ordinality as e(x, i) where i <= shown),
    'clue_count', n,
    -- each clue gets a fresh timer window; a guess can also unlock the next clue
    'next_in', case when not done and shown < n then round(extract(epoch from ts - now())::numeric + secs, 1) end,
    'ends_in', case when not done then round(extract(epoch from ts - now())::numeric + secs * (n - shown + 1), 1) end,
    'clue_on_guess', coalesce((sess.live->>'clue_on_guess')::boolean, true),
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
  pr    jsonb;
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
  secs := greatest(5, coalesce((sess.live->>'clue_secs')::int, 20));
  n := jsonb_array_length(_wr_clues(q));
  -- which clue was showing when this guess was made
  pr := _wr_progress(cur, n, secs, coalesce((sess.live->>'clue_on_guess')::boolean, true), now());
  stage := (pr->>'s')::int;

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
          || jsonb_build_array(jsonb_build_object('g', g, 't', now(), 'fb', fb, 'mode', case when ng < 2 and g <> word then 'discovery' else 'board' end)));
  insert into wr_guesses (participant_id, question_id, guess) values (p.id, q.id, g);

  if g = word then
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

revoke execute on function _wr_tick(uuid), _wr_view(uuid) from public, anon, authenticated;
revoke execute on function _wr_progress(jsonb, int, int, boolean, timestamptz) from public, anon, authenticated;
grant execute on function wr_guess(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
