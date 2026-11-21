-- =====================================================================
-- Warm-Ups v0.3 — Zero In (teacher-paced vocab game)
-- Run once in Supabase > SQL Editor, after schema.sql and update-0.2.sql.
-- Safe to run again.
-- =====================================================================

-- Units are either a sentence-builder unit or a Zero In word list.
alter table units add column if not exists kind text not null default 'sentence';
alter table units drop constraint if exists units_kind_check;
alter table units add constraint units_kind_check check (kind in ('sentence', 'zero_in'));

-- Zero In rounds live in questions.data:
--   { "rounds": [ {"correct": [...], "wrong": [...]}, x3 ], "sentence": "...", "image": "..." }
-- questions.prompt = the word, questions.answer = the definition.
alter table questions add column if not exists data jsonb not null default '{}'::jsonb;

-- The teacher's screen drives the game; its current state is stored here.
alter table sessions add column if not exists live jsonb not null default '{}'::jsonb;

-- Each Zero In round answer is one attempt, tagged with the round's step number.
-- One answer per student per step (no changing answers).
alter table attempts add column if not exists step int;
create unique index if not exists attempts_one_per_step
  on attempts(participant_id, step) where step is not null;

-- Word votes (not graded).
create table if not exists zi_votes (
  participant_id uuid not null references participants(id) on delete cascade,
  step           int  not null,
  choice         uuid not null,
  created_at     timestamptz not null default now(),
  primary key (participant_id, step)
);
alter table zi_votes enable row level security;
drop policy if exists "teacher sees votes" on zi_votes;
create policy "teacher sees votes" on zi_votes for select to authenticated
  using (exists (select 1 from participants p join sessions s on s.id = p.session_id
                 join classes c on c.id = s.class_id
                 where p.id = participant_id and c.teacher_id = auth.uid()));

-- ---------- Sentence builder: never send Zero In answers to devices ----
create or replace function play_state(p_token uuid)
returns json
language plpgsql security definer set search_path = public as $$
declare
  p    participants;
  sess sessions;
  ukind text;
  sname text;
begin
  select * into p from participants where token = p_token;
  if not found then return json_build_object('error', 'bad_token'); end if;
  select * into sess from sessions where id = p.session_id;
  select kind into ukind from units where id = sess.unit_id;
  select name into sname from students where id = p.student_id;
  update participants set last_seen = now() where id = p.id;

  return json_build_object(
    'now', now(),
    'student_name', sname,
    'session', json_build_object(
      'id', sess.id, 'status', sess.status, 'title', sess.title, 'kind', ukind,
      'target_correct', sess.target_correct, 'time_limit_min', sess.time_limit_min),
    'participant', json_build_object(
      'current_level', p.current_level, 'joined_at', p.joined_at,
      'finished_at', p.finished_at, 'finish_reason', p.finish_reason),
    'questions', case when ukind = 'sentence' then (
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

-- ---------- Zero In: what a student's device sees ----------------------
-- Correct answers are only included after the teacher reveals.
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
  rnd   int;
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
    if rev then o := o || jsonb_build_object('winners', coalesce(lv->'winners', '[]'::jsonb)); end if;
  elsif lv->>'phase' in ('round', 'final') then
    select * into q from questions where id = nullif(lv->>'qid', '')::uuid;
    rnd := coalesce((lv->>'r')::int, 0);
    o := o || jsonb_build_object('word', q.prompt, 'r', rnd);
    if lv->>'phase' = 'round' then
      select a.response into mine from attempts a where a.participant_id = p.id and a.step = st;
      o := o || jsonb_build_object('options', coalesce(lv->'options', '[]'::jsonb), 'mine', mine);
      if rev then o := o || jsonb_build_object('correct', q.data->'rounds'->rnd->'correct'); end if;
    else
      o := o || jsonb_build_object('definition', q.answer,
        'sentence', q.data->>'sentence', 'image', q.data->>'image');
    end if;
  end if;
  return o;
end;
$$;

-- ---------- Zero In: a student taps an answer or a vote -----------------
create or replace function zi_answer(p_token uuid, p_step int, p_choice text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  p    participants;
  sess sessions;
  lv   jsonb;
  q    questions;
  rnd  int;
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
    select * into q from questions where id = nullif(lv->>'qid', '')::uuid;
    rnd := coalesce((lv->>'r')::int, 0);
    ok := coalesce((q.data->'rounds'->rnd->'correct') ? p_choice, false);
    insert into attempts (participant_id, question_id, level, correct, response, step)
    values (p.id, q.id, rnd + 1, ok, left(p_choice, 500), p_step)
    on conflict (participant_id, step) where step is not null do nothing;

  else
    return json_build_object('error', 'not_answering');
  end if;

  update participants set last_seen = now() where id = p.id;
  return json_build_object('ok', true);
end;
$$;

grant execute on function play_state(uuid)             to anon, authenticated;
grant execute on function zi_state(uuid)               to anon, authenticated;
grant execute on function zi_answer(uuid, int, text)   to anon, authenticated;

notify pgrst, 'reload schema';
