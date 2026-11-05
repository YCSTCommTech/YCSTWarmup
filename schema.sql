-- =====================================================================
-- Warm-Ups — Supabase database setup
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Safe to run once on a fresh project.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Tables ----------------------------------------------------

-- A class (e.g. "Spanish 1 – Period 3"). Owned by one teacher login.
create table if not exists classes (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);

-- Students on a class roster. The PIN is how a student signs in each day.
create table if not exists students (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references classes(id) on delete cascade,
  name        text not null,
  pin         text not null check (pin ~ '^[0-9]{4}$'),
  created_at  timestamptz not null default now(),
  unique (class_id, pin)
);

-- A unit = one tab of the teacher's Google Sheet.
create table if not exists units (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);

-- Questions. qtype leaves room for future question types.
-- build_en = Spanish prompt, student builds the English sentence from tiles.
create table if not exists questions (
  id           uuid primary key default gen_random_uuid(),
  unit_id      uuid not null references units(id) on delete cascade,
  qtype        text not null default 'build_en',
  level        int  not null check (level between 1 and 5),
  prompt       text not null,
  answer       text not null,
  also_accept  text[] not null default '{}',
  decoys       text[] not null default '{}',
  glossary     jsonb  not null default '{}'::jsonb,
  notes        text,
  sort         int not null default 0
);

-- A warm-up session: the teacher prepares it ahead of time, opens it at
-- the start of class, and closes it at the end.
create table if not exists sessions (
  id              uuid primary key default gen_random_uuid(),
  class_id        uuid not null references classes(id) on delete cascade,
  unit_id         uuid not null references units(id) on delete cascade,
  title           text,
  status          text not null default 'ready' check (status in ('ready','open','closed')),
  target_correct  int  check (target_correct is null or target_correct > 0),
  time_limit_min  int  check (time_limit_min is null or time_limit_min > 0),
  start_level     int  not null default 2 check (start_level between 1 and 5),
  opened_at       timestamptz,
  closed_at       timestamptz,
  created_at      timestamptz not null default now()
);
-- Only one open warm-up per class at a time.
create unique index if not exists one_open_session_per_class
  on sessions(class_id) where status = 'open';

-- A student's run through one session.
create table if not exists participants (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references sessions(id) on delete cascade,
  student_id     uuid not null references students(id) on delete cascade,
  token          uuid not null default gen_random_uuid() unique,
  current_level  int  not null,
  joined_at      timestamptz not null default now(),
  last_seen      timestamptz not null default now(),
  finished_at    timestamptz,
  finish_reason  text,       -- 'target' | 'time'
  unique (session_id, student_id)
);

-- Every answer a student checks.
create table if not exists attempts (
  id              bigint generated always as identity primary key,
  participant_id  uuid not null references participants(id) on delete cascade,
  question_id     uuid references questions(id) on delete set null,
  level           int  not null,
  correct         boolean not null,
  response        text,
  hints           int not null default 0,
  ms              int,
  created_at      timestamptz not null default now()
);

create index if not exists attempts_participant_idx on attempts(participant_id);
create index if not exists participants_session_idx on participants(session_id);
create index if not exists questions_unit_idx on questions(unit_id);

-- ---------- Row-level security ----------------------------------------
-- Teachers (signed in) see only their own stuff.
-- Students never touch tables directly; they go through the functions below.

alter table classes      enable row level security;
alter table students     enable row level security;
alter table units        enable row level security;
alter table questions    enable row level security;
alter table sessions     enable row level security;
alter table participants enable row level security;
alter table attempts     enable row level security;

create policy "teacher owns classes" on classes for all to authenticated
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

create policy "teacher owns units" on units for all to authenticated
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

create policy "teacher owns students" on students for all to authenticated
  using (exists (select 1 from classes c where c.id = class_id and c.teacher_id = auth.uid()))
  with check (exists (select 1 from classes c where c.id = class_id and c.teacher_id = auth.uid()));

create policy "teacher owns questions" on questions for all to authenticated
  using (exists (select 1 from units u where u.id = unit_id and u.teacher_id = auth.uid()))
  with check (exists (select 1 from units u where u.id = unit_id and u.teacher_id = auth.uid()));

create policy "teacher owns sessions" on sessions for all to authenticated
  using (exists (select 1 from classes c where c.id = class_id and c.teacher_id = auth.uid()))
  with check (
    exists (select 1 from classes c where c.id = class_id and c.teacher_id = auth.uid())
    and exists (select 1 from units u where u.id = unit_id and u.teacher_id = auth.uid()));

create policy "teacher sees participants" on participants for select to authenticated
  using (exists (select 1 from sessions s join classes c on c.id = s.class_id
                 where s.id = session_id and c.teacher_id = auth.uid()));
create policy "teacher removes participants" on participants for delete to authenticated
  using (exists (select 1 from sessions s join classes c on c.id = s.class_id
                 where s.id = session_id and c.teacher_id = auth.uid()));

create policy "teacher sees attempts" on attempts for select to authenticated
  using (exists (select 1 from participants p join sessions s on s.id = p.session_id
                 join classes c on c.id = s.class_id
                 where p.id = participant_id and c.teacher_id = auth.uid()));

-- ---------- Student functions (no login, PIN-based) -------------------

-- Class list for the student start screen.
create or replace function list_classes()
returns table (id uuid, name text)
language sql security definer set search_path = public stable as $$
  select c.id, c.name from classes c order by c.name;
$$;

-- Student taps their class and types their PIN.
-- Returns {token,...} if a warm-up is open, {error:'not_open', student_name}
-- if the PIN is right but the teacher hasn't opened it yet, or {error:'bad_pin'}.
create or replace function join_session(p_class uuid, p_pin text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  s    students;
  sess sessions;
  p    participants;
begin
  select * into s from students where class_id = p_class and pin = p_pin;
  if not found then
    return json_build_object('error', 'bad_pin');
  end if;

  select * into sess from sessions
   where class_id = p_class and status = 'open'
   order by opened_at desc limit 1;
  if not found then
    return json_build_object('error', 'not_open', 'student_name', s.name);
  end if;

  insert into participants (session_id, student_id, current_level)
  values (sess.id, s.id, sess.start_level)
  on conflict (session_id, student_id) do update set last_seen = now()
  returning * into p;

  return json_build_object('token', p.token, 'student_name', s.name);
end;
$$;

-- Everything the student's device needs to run the warm-up.
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
      'id', sess.id, 'status', sess.status, 'title', sess.title,
      'target_correct', sess.target_correct, 'time_limit_min', sess.time_limit_min),
    'participant', json_build_object(
      'current_level', p.current_level, 'joined_at', p.joined_at,
      'finished_at', p.finished_at, 'finish_reason', p.finish_reason),
    'questions', (
      select coalesce(json_agg(json_build_object(
        'id', q.id, 'qtype', q.qtype, 'level', q.level, 'prompt', q.prompt,
        'answer', q.answer, 'also_accept', q.also_accept, 'decoys', q.decoys,
        'glossary', q.glossary) order by q.sort), '[]'::json)
      from questions q where q.unit_id = sess.unit_id),
    'attempts', (
      select coalesce(json_agg(json_build_object(
        'question_id', a.question_id, 'correct', a.correct, 'level', a.level) order by a.id), '[]'::json)
      from attempts a where a.participant_id = p.id)
  );
end;
$$;

-- Internal: totals + finish checks for one participant.
create or replace function _participant_summary(p_id uuid)
returns json
language plpgsql security definer set search_path = public as $$
declare
  p    participants;
  sess sessions;
  n_correct int;
  n_total   int;
begin
  select * into p from participants where id = p_id;
  select * into sess from sessions where id = p.session_id;
  select count(*) filter (where correct), count(*) into n_correct, n_total
    from attempts where participant_id = p.id;

  if p.finished_at is null then
    if sess.target_correct is not null and n_correct >= sess.target_correct then
      update participants set finished_at = now(), finish_reason = 'target' where id = p.id
        returning * into p;
    elsif sess.time_limit_min is not null
          and now() >= p.joined_at + make_interval(mins => sess.time_limit_min) then
      update participants set finished_at = now(), finish_reason = 'time' where id = p.id
        returning * into p;
    end if;
  end if;

  return json_build_object(
    'status', sess.status,
    'correct', n_correct, 'total', n_total,
    'level', p.current_level,
    'finished', p.finished_at is not null,
    'finish_reason', p.finish_reason);
end;
$$;

-- Student checks an answer. The device grades it and reports the new level.
create or replace function submit_attempt(
  p_token uuid, p_question uuid, p_level int, p_correct boolean,
  p_response text, p_new_level int, p_hints int default 0, p_ms int default null)
returns json
language plpgsql security definer set search_path = public as $$
declare
  p    participants;
  sess sessions;
begin
  select * into p from participants where token = p_token;
  if not found then return json_build_object('error', 'bad_token'); end if;
  select * into sess from sessions where id = p.session_id;

  if sess.status <> 'open' or p.finished_at is not null then
    return _participant_summary(p.id);
  end if;

  insert into attempts (participant_id, question_id, level, correct, response, hints, ms)
  values (p.id, p_question, greatest(1, least(5, p_level)), p_correct,
          left(p_response, 500), coalesce(p_hints, 0), p_ms);

  update participants
     set current_level = greatest(1, least(5, p_new_level)), last_seen = now()
   where id = p.id;

  return _participant_summary(p.id);
end;
$$;

-- Polled every few seconds by the student's device.
create or replace function session_status(p_token uuid)
returns json
language plpgsql security definer set search_path = public as $$
declare p participants;
begin
  select * into p from participants where token = p_token;
  if not found then return json_build_object('error', 'bad_token'); end if;
  update participants set last_seen = now() where id = p.id;
  return _participant_summary(p.id);
end;
$$;

-- Lock the internal helper away from the public API.
revoke execute on function _participant_summary(uuid) from public, anon, authenticated;

grant execute on function list_classes()                         to anon, authenticated;
grant execute on function join_session(uuid, text)                to anon, authenticated;
grant execute on function play_state(uuid)                        to anon, authenticated;
grant execute on function submit_attempt(uuid, uuid, int, boolean, text, int, int, int) to anon, authenticated;
grant execute on function session_status(uuid)                    to anon, authenticated;
