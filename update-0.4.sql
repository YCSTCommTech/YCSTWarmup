-- =====================================================================
-- Warm-Ups v0.4 — deck library (6 deck types), folders, games per session
-- Run once in Supabase > SQL Editor, after update-0.3.sql. Safe to run again.
-- =====================================================================

-- ---------- Deck types + folders --------------------------------------
alter table units add column if not exists folder text not null default '';
alter table units drop constraint if exists units_kind_check;

-- Zero In word lists become Vocabulary decks.
update questions q set
  qtype = 'vocab',
  data = jsonb_build_object(
    'term', q.prompt,
    'definition', q.answer,
    'category', coalesce((select string_agg(x, ' / ') from jsonb_array_elements_text(q.data->'rounds'->0->'correct') x), ''),
    'subcategory', coalesce((select string_agg(x, ' / ') from jsonb_array_elements_text(q.data->'rounds'->1->'correct') x), ''),
    'wrong_def', coalesce(q.data->'rounds'->2->'wrong', '[]'::jsonb),
    'sentence', coalesce(q.data->>'sentence', ''),
    'image', coalesce(q.data->>'image', ''))
from units u
where u.id = q.unit_id and u.kind = 'zero_in' and q.data ? 'rounds';
update units set kind = 'vocab' where kind = 'zero_in';

alter table units add constraint units_kind_check
  check (kind in ('vocab', 'sentence', 'mcq', 'prompt', 'sort', 'order'));

-- Teachers can rename a deck and move it between folders.
revoke update on units from authenticated;
grant update (name, folder) on units to authenticated;

-- ---------- Which game a warm-up plays ---------------------------------
alter table sessions add column if not exists game text;
update sessions s set game = case when u.kind = 'vocab' then 'zero_in' else 'sentence_builder' end
  from units u where u.id = s.unit_id and s.game is null;
alter table sessions alter column game set default 'sentence_builder';
update sessions set game = 'sentence_builder' where game is null;
alter table sessions alter column game set not null;

-- ---------- Student functions ------------------------------------------
create or replace function play_state(p_token uuid)
returns json
language plpgsql security definer set search_path = public as $$
declare
  p    participants;
  sess sessions;
  sname text;
begin
  select * into p from participants where token = p_token;
  if not found then return json_build_object('error', 'bad_token'); end if;
  select * into sess from sessions where id = p.session_id;
  select name into sname from students where id = p.student_id;
  update participants set last_seen = now() where id = p.id;

  return json_build_object(
    'now', now(),
    'student_name', sname,
    'session', json_build_object(
      'id', sess.id, 'status', sess.status, 'title', sess.title, 'game', sess.game,
      'kind', case when sess.game = 'zero_in' then 'zero_in' else 'sentence' end,
      'target_correct', sess.target_correct, 'time_limit_min', sess.time_limit_min),
    'participant', json_build_object(
      'current_level', p.current_level, 'joined_at', p.joined_at,
      'finished_at', p.finished_at, 'finish_reason', p.finish_reason),
    -- Only the sentence builder grades on the device; other games never get answers.
    'questions', case when sess.game = 'sentence_builder' then (
      select coalesce(json_agg(json_build_object(
        'id', q.id, 'qtype', q.qtype, 'level', q.level, 'prompt', q.prompt,
        'answer', q.answer, 'also_accept', q.also_accept, 'decoys', q.decoys,
        'glossary', q.glossary) order by q.sort), '[]'::json)
      from questions q where q.unit_id = sess.unit_id) else '[]'::json end,
    'attempts', (
      select coalesce(json_agg(json_build_object(
        'question_id', a.question_id, 'correct', a.correct, 'level', a.level) order by a.id), '[]'::json)
      from attempts a where a.participant_id = p.id)
  );
end;
$$;

-- Zero In: the teacher's screen now stores each round's options and right
-- answers in sessions.live (students never read that table directly).
create or replace function zi_state(p_token uuid)
returns json
language plpgsql security definer set search_path = public as $$
declare
  p     participants;
  sess  sessions;
  lv    jsonb;
  q     questions;
  o     jsonb;
  mine  text;
  st    int;
  rev   boolean;
  sname text;
begin
  select * into p from participants where token = p_token;
  if not found then return json_build_object('error', 'bad_token'); end if;
  select * into sess from sessions where id = p.session_id;
  select name into sname from students where id = p.student_id;
  update participants set last_seen = now() where id = p.id;

  lv  := coalesce(sess.live, '{}'::jsonb);
  st  := nullif(lv->>'seq', '')::int;
  rev := coalesce((lv->>'revealed')::boolean, false);
  o := jsonb_build_object(
    'status', sess.status, 'student_name', sname,
    'phase', coalesce(lv->>'phase', 'pick'), 'seq', st, 'revealed', rev,
    'correct_total', (select count(*) filter (where a.correct) from attempts a where a.participant_id = p.id),
    'answered_total', (select count(*) from attempts a where a.participant_id = p.id));

  if lv->>'phase' = 'vote' then
    select v.choice::text into mine from zi_votes v where v.participant_id = p.id and v.step = st;
    o := o || jsonb_build_object('cands', coalesce(lv->'cands', '[]'::jsonb), 'mine', mine);
  elsif lv->>'phase' in ('round', 'final') then
    select * into q from questions where id = nullif(lv->>'qid', '')::uuid;
    o := o || jsonb_build_object('word', q.prompt, 'r', coalesce((lv->>'r')::int, 0),
      'total', coalesce((lv->>'total')::int, 3), 'prompt', lv->>'prompt');
    if lv->>'phase' = 'round' then
      select a.response into mine from attempts a where a.participant_id = p.id and a.step = st;
      o := o || jsonb_build_object('options', coalesce(lv->'options', '[]'::jsonb), 'mine', mine);
      if rev then o := o || jsonb_build_object('correct', coalesce(lv->'correct', '[]'::jsonb)); end if;
    else
      o := o || jsonb_build_object('definition', q.answer,
        'sentence', q.data->>'sentence', 'image', q.data->>'image');
    end if;
  end if;
  return o;
end;
$$;

create or replace function zi_answer(p_token uuid, p_step int, p_choice text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  p    participants;
  sess sessions;
  lv   jsonb;
  ok   boolean;
begin
  select * into p from participants where token = p_token;
  if not found then return json_build_object('error', 'bad_token'); end if;
  select * into sess from sessions where id = p.session_id;
  lv := coalesce(sess.live, '{}'::jsonb);

  if sess.status <> 'open'
     or nullif(lv->>'seq', '')::int is distinct from p_step
     or coalesce((lv->>'revealed')::boolean, false) then
    return json_build_object('error', 'too_late');
  end if;

  if lv->>'phase' = 'vote' then
    if not exists (select 1 from jsonb_array_elements(coalesce(lv->'cands', '[]'::jsonb)) c
                   where c->>'id' = p_choice) then
      return json_build_object('error', 'bad_choice');
    end if;
    insert into zi_votes (participant_id, step, choice)
    values (p.id, p_step, p_choice::uuid) on conflict do nothing;

  elsif lv->>'phase' = 'round' then
    if not (coalesce(lv->'options', '[]'::jsonb) ? p_choice) then
      return json_build_object('error', 'bad_choice');
    end if;
    ok := coalesce(lv->'correct', '[]'::jsonb) ? p_choice;
    insert into attempts (participant_id, question_id, level, correct, response, step)
    values (p.id, nullif(lv->>'qid', '')::uuid, coalesce((lv->>'r')::int, 0) + 1, ok, left(p_choice, 500), p_step)
    on conflict (participant_id, step) where step is not null do nothing;

  else
    return json_build_object('error', 'not_answering');
  end if;

  update participants set last_seen = now() where id = p.id;
  return json_build_object('ok', true);
end;
$$;

grant execute on function play_state(uuid)           to anon, authenticated;
grant execute on function zi_state(uuid)             to anon, authenticated;
grant execute on function zi_answer(uuid, int, text) to anon, authenticated;

notify pgrst, 'reload schema';
