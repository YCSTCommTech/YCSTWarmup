-- =====================================================================
-- Warm-Ups v0.2 — teacher profiles, shared units, class results archive
-- Run once in Supabase > SQL Editor (after schema.sql has been run).
-- Safe to run again.
-- =====================================================================

-- ---------- Teacher profiles -----------------------------------------
create table if not exists teachers (
  id            uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  display_name  text not null check (length(trim(display_name)) > 0),
  created_at    timestamptz not null default now()
);
alter table teachers enable row level security;

drop policy if exists "teachers see teachers" on teachers;
drop policy if exists "teacher creates own profile" on teachers;
drop policy if exists "teacher edits own profile" on teachers;
create policy "teachers see teachers" on teachers for select to authenticated using (true);
create policy "teacher creates own profile" on teachers for insert to authenticated with check (id = auth.uid());
create policy "teacher edits own profile" on teachers for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ---------- Shared units + questions ---------------------------------
-- Every teacher can see and use every unit and edit its questions.
-- Only the teacher who made a unit can delete it.
drop policy if exists "teacher owns units" on units;
drop policy if exists "teachers see units" on units;
drop policy if exists "teacher adds units" on units;
drop policy if exists "teachers rename units" on units;
drop policy if exists "owner deletes unit" on units;
create policy "teachers see units" on units for select to authenticated using (true);
create policy "teacher adds units" on units for insert to authenticated with check (teacher_id = auth.uid());
create policy "teachers rename units" on units for update to authenticated using (true) with check (true);
create policy "owner deletes unit" on units for delete to authenticated using (teacher_id = auth.uid());
-- Renaming is the only edit allowed on a unit row (owner can't be changed).
revoke update on units from authenticated;
grant update (name) on units to authenticated;

drop policy if exists "teacher owns questions" on questions;
drop policy if exists "teachers share questions" on questions;
create policy "teachers share questions" on questions for all to authenticated using (true) with check (true);

-- A teacher's warm-up can use anyone's unit, but only their own class.
drop policy if exists "teacher owns sessions" on sessions;
create policy "teacher owns sessions" on sessions for all to authenticated
  using (exists (select 1 from classes c where c.id = class_id and c.teacher_id = auth.uid()))
  with check (exists (select 1 from classes c where c.id = class_id and c.teacher_id = auth.uid()));

-- A unit that has been used in a warm-up can't be deleted (keeps every
-- teacher's grading records safe).
alter table sessions drop constraint if exists sessions_unit_id_fkey;
alter table sessions add constraint sessions_unit_id_fkey
  foreign key (unit_id) references units(id) on delete restrict;

-- ---------- Student class list shows the teacher's name ---------------
drop function if exists list_classes();
create function list_classes()
returns table (id uuid, name text, teacher_name text)
language sql security definer set search_path = public stable as $$
  select c.id, c.name, coalesce(t.display_name, '')
    from classes c left join teachers t on t.id = c.teacher_id
   where length(trim(c.name)) > 0
   order by coalesce(t.display_name, ''), c.name;
$$;
grant execute on function list_classes() to anon, authenticated;

-- ---------- Class results archive -----------------------------------
-- One call returns every warm-up for a class plus each student's totals.
-- Runs with the teacher's own permissions, so it only works for their classes.
create or replace function class_history(p_class uuid)
returns json
language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'sessions', coalesce((
      select json_agg(json_build_object(
        'id', s.id, 'title', s.title, 'status', s.status,
        'date', coalesce(s.opened_at, s.created_at),
        'target', s.target_correct, 'unit', u.name)
        order by coalesce(s.opened_at, s.created_at) desc)
      from sessions s join units u on u.id = s.unit_id
      where s.class_id = p_class and s.status <> 'ready'), '[]'::json),
    'results', coalesce((
      select json_agg(json_build_object(
        'session_id', p.session_id, 'student_id', p.student_id,
        'finish', p.finish_reason, 'correct', t.n_correct, 'total', t.n_total))
      from participants p
      join sessions s on s.id = p.session_id
      cross join lateral (
        select count(*) filter (where a.correct) as n_correct, count(*) as n_total
        from attempts a where a.participant_id = p.id) t
      where s.class_id = p_class), '[]'::json)
  );
$$;
revoke execute on function class_history(uuid) from public, anon;
grant execute on function class_history(uuid) to authenticated;
