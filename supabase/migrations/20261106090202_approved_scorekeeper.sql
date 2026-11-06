create schema if not exists scorekeeper_private;
revoke all on schema scorekeeper_private from public;
grant usage on schema scorekeeper_private to authenticated;

-- Retain app identities and attribution even if an Auth identity is removed.
alter table public."tUser" drop constraint "tUser_id_fkey";
alter table public."tUser" add column is_deleted boolean not null default false;
update public."tUser" set display_name='Administrator' where btrim(display_name)='';
alter table public."tUser" add constraint user_name_nonblank check(length(btrim(display_name)) between 1 and 120);
create unique index one_admin on public."tUser" ((app_role)) where app_role='admin';
-- Remove creator-coupled relationships; retain identity/mode validation separately.
do $$ declare r record; c text; begin
 for r in select conrelid::regclass tab, conname from pg_constraint where connamespace='public'::regnamespace and contype='f' and (confrelid='auth.users'::regclass or array_length(conkey,1)>1) loop
  execute format('alter table %s drop constraint %I',r.tab,r.conname);
 end loop;
 for r in select table_name from information_schema.columns c where table_schema='public' and column_name='owner_id' and exists(select 1 from information_schema.tables t where t.table_schema=c.table_schema and t.table_name=c.table_name and t.table_type='BASE TABLE') loop
  execute format('alter table public.%I add constraint retained_creator foreign key(owner_id) references public."tUser"(id)',r.table_name);
 end loop;
end $$;
alter table public."tEventTeam" add foreign key(event_id) references public."tEvent"(id), add foreign key(team_id) references public."tTeam"(id);
alter table public."tTeamFencer" add foreign key(team_id) references public."tTeam"(id),add foreign key(fencer_id) references public."tFencer"(id);
alter table public."tControlPointCall" add foreign key(match_id) references public."tControlPointMatch"(id),add foreign key(fencer_id) references public."tFencer"(id),add foreign key(team_id) references public."tTeam"(id);
alter table public."tControlPointTime" add foreign key(match_id) references public."tControlPointMatch"(id),add foreign key(team_id) references public."tTeam"(id);
alter table public."tControlPointMatch" add foreign key(event_id) references public."tEvent"(id),add foreign key(team_a_id) references public."tTeam"(id),add foreign key(team_b_id) references public."tTeam"(id);
alter table public."tTraditionalMatch" add foreign key(event_id) references public."tEvent"(id);

create function scorekeeper_private.can_use() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public."tUser" where id=auth.uid() and is_active and not must_change_password and not is_deleted)
 and (nullif(auth.jwt()->>'session_id','') is null or exists(select 1 from auth.sessions where id=(auth.jwt()->>'session_id')::uuid and user_id=auth.uid()));
$$;
create function scorekeeper_private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select scorekeeper_private.can_use() and exists(select 1 from public."tUser" where id=auth.uid() and app_role='admin');
$$;
revoke all on function scorekeeper_private.can_use(),scorekeeper_private.is_admin() from public;
grant execute on function scorekeeper_private.can_use(),scorekeeper_private.is_admin() to authenticated;

create table public."tAudit"(id uuid primary key default gen_random_uuid(), table_name text not null, record_id text not null, action text not null, actor_id uuid references public."tUser"(id), old_value jsonb, new_value jsonb, recorded_at timestamptz not null default now());
create function scorekeeper_private.audit() returns trigger language plpgsql security definer set search_path='' as $$
 begin insert into public."tAudit"(table_name,record_id,action,actor_id,old_value,new_value) values(tg_table_name,coalesce(to_jsonb(new)->>'id',to_jsonb(old)->>'id',to_jsonb(new)->>'event_id',to_jsonb(old)->>'event_id','configuration'),tg_op,auth.uid(),case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end); return coalesce(new,old); end;
$$;
create function scorekeeper_private.guard_user() returns trigger language plpgsql set search_path='' as $$
 begin if old.app_role='admin' and (tg_op='DELETE' or new.app_role<>'admin' or not new.is_active or new.is_deleted) then raise exception 'The sole Admin must remain active'; end if; return coalesce(new,old); end;
$$;
create trigger protect_admin before update or delete on public."tUser" for each row execute function scorekeeper_private.guard_user();

alter table public."tFencer" add column affiliation text not null default '',add column notes text not null default '',add column is_archived boolean not null default false,add column is_unregistered boolean not null default false;
create unique index one_unregistered on public."tFencer" ((is_unregistered)) where is_unregistered;
insert into public."tFencer"(owner_id,display_name,is_unregistered) select id,'Unregistered',true from public."tUser" where app_role='admin';
create function scorekeeper_private.guard_fencer() returns trigger language plpgsql set search_path='' as $$
 begin if tg_op='INSERT' and new.is_unregistered then raise exception 'Reserved identity cannot be created'; end if; if tg_op<>'INSERT' and old.is_unregistered then raise exception 'Reserved identity cannot be changed'; end if; return coalesce(new,old); end;
$$;
create trigger protect_unregistered before insert or update or delete on public."tFencer" for each row execute function scorekeeper_private.guard_fencer();
alter table public."tMatchPreset" add column is_archived boolean not null default false;
alter table public."tMatchPreset" drop constraint preset_unique_name_per_owner_mode;
create unique index preset_shared_name on public."tMatchPreset"(mode,lower(name)) where not is_archived;
alter table public."tTeam" add column is_archived boolean not null default false,add column image_url text,add column image_path text;
alter table public."tEvent" add column competition_format text not null default 'individual' check(competition_format in ('individual','team')),add column status text not null default 'draft' check(status in ('draft','active','completed','archived')),add column preset_id uuid references public."tMatchPreset"(id);
create table public."tEventFencer"(event_id uuid references public."tEvent"(id),fencer_id uuid references public."tFencer"(id),primary key(event_id,fencer_id));
create table public."tEventTeamFencer"(event_id uuid,team_id uuid,fencer_id uuid references public."tFencer"(id),primary key(event_id,team_id,fencer_id),foreign key(event_id,team_id) references public."tEventTeam"(event_id,team_id));
create table public."tEventPhase"(id uuid primary key default gen_random_uuid(),event_id uuid not null references public."tEvent"(id),name text not null check(length(btrim(name))>0),kind text not null check(kind in ('group','single','double')),position integer not null,preset_id uuid references public."tMatchPreset"(id),is_archived boolean not null default false);
create table public."tEventGroup"(id uuid primary key default gen_random_uuid(),phase_id uuid not null references public."tEventPhase"(id),name text not null check(length(btrim(name))>0));
create table public."tEventGroupFencer"(group_id uuid references public."tEventGroup"(id),fencer_id uuid references public."tFencer"(id),primary key(group_id,fencer_id));
create table public."tBracket"(id uuid primary key default gen_random_uuid(),phase_id uuid not null references public."tEventPhase"(id),format text not null check(format in ('single','double','group')),graph jsonb not null,is_archived boolean not null default false,created_at timestamptz not null default now());
create table public."tConfiguration"(id boolean primary key default true check(id),tiebreakers jsonb not null default '[]',key_mappings jsonb not null default '{}',version integer not null default 1,updated_at timestamptz not null default now());
insert into public."tConfiguration"(id) values(true);
create table public."tEventFinalization"(id uuid primary key default gen_random_uuid(),event_id uuid not null references public."tEvent"(id),standings jsonb not null,configuration jsonb not null,actor_id uuid not null references public."tUser"(id),created_at timestamptz not null default now());

alter table public."tTraditionalMatch" drop constraint matches_no_same_fencer;
alter table public."tTraditionalMatch" add column preset_id uuid references public."tMatchPreset"(id),add column phase_id uuid references public."tEventPhase"(id),add column group_id uuid references public."tEventGroup"(id),add column bracket_id uuid references public."tBracket"(id),add column slot_key text,add column is_archived boolean not null default false,add column is_void boolean not null default false,add column revision integer not null default 0,add column referee_id uuid references public."tUser"(id),add column lease_token uuid,add column lease_until timestamptz,add column winner_side text check(winner_side in ('left','right')),add column finalized_at timestamptz;
alter table public."tTraditionalCall" add column is_reversed boolean not null default false;
create unique index bracket_slot on public."tTraditionalMatch"(bracket_id,slot_key);

-- A single active, authorized app scope. Creator IDs no longer constrain collaboration.
do $$ declare r record; t text; begin
 for r in select tablename,policyname from pg_policies where schemaname='public' loop execute format('drop policy %I on public.%I',r.policyname,r.tablename); end loop;
 for t in select tablename from pg_tables where schemaname='public' loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  if t='tUser' then
   execute 'create policy read_user on public."tUser" for select to authenticated using (id=auth.uid() or (select scorekeeper_private.is_admin()))';
  else
   execute format('create policy shared_read on public.%I for select to authenticated using ((select scorekeeper_private.can_use()))',t);
  end if;
  if t not in ('tUser','tAudit','tEventFinalization') then
   execute format('grant insert,update,delete on public.%I to authenticated',t);
   execute format('create policy shared_insert on public.%I for insert to authenticated with check ((select scorekeeper_private.can_use()))',t);
   execute format('create policy shared_update on public.%I for update to authenticated using ((select scorekeeper_private.can_use())) with check ((select scorekeeper_private.can_use()))',t);
   execute format('create policy admin_delete on public.%I for delete to authenticated using ((select scorekeeper_private.is_admin()))',t);
  end if;
  if t<>'tAudit' then execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function scorekeeper_private.audit()',t); end if;
 end loop;
end $$;
-- Membership rows may be removed by managers; their immutable audits retain provenance.
do $$ declare t text; begin foreach t in array array['tEventFencer','tEventTeam','tEventTeamFencer','tEventGroupFencer'] loop
 execute format('create policy remove_membership on public.%I for delete to authenticated using ((select scorekeeper_private.can_use()))',t);
end loop; end $$;

create function scorekeeper_private.validate_match() returns trigger language plpgsql set search_path='' as $$
declare unreg uuid; e public."tEvent"; begin
 select id into unreg from public."tFencer" where is_unregistered;
 if new.left_fencer_id=new.right_fencer_id and new.left_fencer_id<>unreg then raise exception 'Select two different registered fencers'; end if;
 if new.event_id is not null then
  select * into e from public."tEvent" where id=new.event_id;
  if e.mode<>'traditional' or e.competition_format<>'individual' then raise exception 'This event format is not enabled'; end if;
  if e.status<>'active' and (tg_op='INSERT' or row(new.phase,new.left_fencer_id,new.right_fencer_id,new.is_archived,new.is_void) is distinct from row(old.phase,old.left_fencer_id,old.right_fencer_id,old.is_archived,old.is_void)) then raise exception 'Activate or reopen this event first'; end if;
  if new.left_fencer_id=unreg or new.right_fencer_id=unreg then raise exception 'Event competitors must be registered'; end if;
  if exists(select 1 from unnest(array[new.left_fencer_id,new.right_fencer_id]) f where f is not null and not exists(select 1 from public."tEventFencer" x where x.event_id=new.event_id and x.fencer_id=f)) then raise exception 'Competitor is not registered for this event'; end if;
 end if;
 if new.phase='running' or new.started_at is not null then
  if new.left_fencer_id is null or new.right_fencer_id is null then raise exception 'Both competitors are required'; end if;
 end if;
 if tg_op='UPDATE' and (old.lease_until>now() or old.started_at is not null) and new.lease_token is not distinct from old.lease_token and current_setting('scorekeeper.claim',true) is distinct from old.lease_token::text then raise exception 'Claim this match before editing'; end if;
 if tg_op='UPDATE' then new.revision=old.revision+1; end if;
 return new;
end $$;
create trigger validate_match before insert or update on public."tTraditionalMatch" for each row execute function scorekeeper_private.validate_match();

create function public.claim_match(p_id uuid,p_token uuid,p_takeover boolean default false) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public."tTraditionalMatch"; begin
 select * into m from public."tTraditionalMatch" where id=p_id for update;
 if not found then raise exception 'Match not found'; end if;
 if m.lease_token=md5(p_token::text)::uuid and m.referee_id is distinct from auth.uid() then raise exception 'Match belongs to another referee'; end if;
 if m.is_archived or m.is_void then raise exception 'Archived or void match is read only'; end if;
 if m.lease_token is distinct from md5(p_token::text)::uuid and m.lease_token is not null and (m.lease_until>now() or not p_takeover) then raise exception 'Match claimed. Wait for expiry, then explicitly recover it.'; end if;
 perform set_config('scorekeeper.claim',coalesce(m.lease_token::text,''),true);
 update public."tTraditionalMatch" set lease_token=md5(p_token::text)::uuid,referee_id=auth.uid(),lease_until=now()+interval '90 seconds' where id=p_id returning * into m;
 return to_jsonb(m);
end $$;
create function public.save_match(p_match jsonb,p_calls jsonb,p_token uuid,p_revision integer,p_finalize boolean default false) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public."tTraditionalMatch"; c jsonb; ls integer; rs integer; begin
 select * into m from public."tTraditionalMatch" where id=(p_match->>'id')::uuid for update;
 if not found or m.is_archived or m.is_void then raise exception 'Match unavailable'; end if;
 if m.lease_token is distinct from md5(p_token::text)::uuid or m.referee_id<>auth.uid() or m.lease_until<=now() then raise exception 'Referee claim expired; recover before saving'; end if;
 if m.revision<>p_revision then raise exception 'Match changed on another device. Reload before saving.'; end if;
 perform set_config('scorekeeper.claim',md5(p_token::text)::uuid::text,true);
 if jsonb_typeof(p_calls)<>'array' or jsonb_array_length(p_calls)>10000 then raise exception 'Invalid calls'; end if;
 for c in select value from jsonb_array_elements(p_calls) loop
  insert into public."tTraditionalCall"(id,match_id,side,call_type,points,match_time_ms,recorded_at) values((c->>'id')::uuid,m.id,c->>'side',c->>'type',(c->>'points')::smallint,(c->>'matchTimeMs')::integer,(c->>'timestamp')::timestamptz)
  on conflict(id) do update set is_reversed=false where public."tTraditionalCall".match_id=m.id and public."tTraditionalCall".side=excluded.side and public."tTraditionalCall".call_type=excluded.call_type and public."tTraditionalCall".points=excluded.points;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_calls) x left join public."tTraditionalCall" c on c.id=(x->>'id')::uuid where c.match_id is distinct from m.id or c.side<>x->>'side' or c.call_type<>x->>'type' or c.points<>(x->>'points')::int) then raise exception 'Call identity cannot be reassigned'; end if;
 update public."tTraditionalCall" set is_reversed=true where match_id=m.id and not is_reversed and id not in(select (x->>'id')::uuid from jsonb_array_elements(p_calls) x);
 select coalesce(sum(points) filter(where side='left'),0),coalesce(sum(points) filter(where side='right'),0) into ls,rs from public."tTraditionalCall" where match_id=m.id and not is_reversed;
 if p_finalize and p_match->>'phase'<>'ended' then raise exception 'End the match first'; end if;
 if p_finalize and m.bracket_id is not null and m.group_id is null and ls=rs and nullif(p_match->>'winnerSide','') is null then raise exception 'Resolve the elimination tiebreak before finalizing'; end if;
 update public."tTraditionalMatch" set
 left_name=p_match->>'leftName',right_name=p_match->>'rightName',
 left_fencer_id=case when m.started_at is null then (p_match->>'leftFencerId')::uuid else m.left_fencer_id end,
 right_fencer_id=case when m.started_at is null then (p_match->>'rightFencerId')::uuid else m.right_fencer_id end,
 preset_id=case when m.started_at is null then (p_match->>'presetId')::uuid else m.preset_id end,
 duration_ms=case when m.started_at is null then (p_match->>'durationMs')::integer else m.duration_ms end,
 target_score=case when m.started_at is null then (p_match->>'targetScore')::integer else m.target_score end,
 remaining_ms=(p_match->>'remainingMs')::integer,phase=p_match->>'phase',end_reason=p_match->>'endReason',
 started_at=coalesce(m.started_at,(p_match->>'startedAt')::timestamptz),ended_at=(p_match->>'endedAt')::timestamptz,
 winner_side=case when ls>rs then 'left' when rs>ls then 'right' else nullif(p_match->>'winnerSide','') end,
 finalized_at=case when p_finalize then now() else null end,lease_until=now()+interval '90 seconds',updated_at=now()
 where id=m.id returning * into m;
 return to_jsonb(m);
end $$;
create function scorekeeper_private.guard_call() returns trigger language plpgsql set search_path='' as $$
declare m public."tTraditionalMatch"; begin select * into m from public."tTraditionalMatch" where id=coalesce(new.match_id,old.match_id);
 if m.lease_token is null or current_setting('scorekeeper.claim',true) is distinct from m.lease_token::text then raise exception 'Use transactional match save'; end if;
 return coalesce(new,old); end $$;
create trigger guard_call before insert or update or delete on public."tTraditionalCall" for each row execute function scorekeeper_private.guard_call();

create view public."vMatchResults" with(security_invoker=true) as
select m.*,coalesce(l.display_name,m.left_name) current_left_name,coalesce(r.display_name,m.right_name) current_right_name,
 coalesce(s.left_score,0) left_score,coalesce(s.right_score,0) right_score,
 case when m.finalized_at is null or m.is_void or m.is_archived then 'incomplete'
 when coalesce(s.left_score,0)=coalesce(s.right_score,0) and m.winner_side is null and m.end_reason='time' then 'draw'
 when m.end_reason='manual' then 'incomplete'
 when coalesce(s.left_score,0)=coalesce(s.right_score,0) and m.winner_side is null then 'incomplete' else 'result' end outcome
from public."tTraditionalMatch" m
left join public."tFencer" l on l.id=m.left_fencer_id and not l.is_unregistered
left join public."tFencer" r on r.id=m.right_fencer_id and not r.is_unregistered
left join (select match_id,sum(points) filter(where side='left') left_score,sum(points) filter(where side='right') right_score from public."tTraditionalCall" where not is_reversed group by match_id) s on s.match_id=m.id;
create view public."vFencerResults" with(security_invoker=true) as
 select m.id match_id,m.event_id,m.group_id,f.id fencer_id,f.display_name,
 case when m.left_fencer_id=f.id then m.left_score else m.right_score end points_for,
 case when m.left_fencer_id=f.id then m.right_score else m.left_score end points_against,
 case when m.outcome='result' and ((m.left_fencer_id=f.id and m.winner_side='left') or (m.right_fencer_id=f.id and m.winner_side='right')) then 1 else 0 end wins,
 case when m.outcome='result' and ((m.left_fencer_id=f.id and m.winner_side='right') or (m.right_fencer_id=f.id and m.winner_side='left')) then 1 else 0 end losses,
 case when m.outcome='draw' then 1 else 0 end draws
 from public."vMatchResults" m join public."tFencer" f on f.id in(m.left_fencer_id,m.right_fencer_id) and not f.is_unregistered where not m.is_archived and not m.is_void and m.outcome in('draw','result');
create view public."vFencerStatistics" with(security_invoker=true) as
 select fencer_id,display_name,case when event_id is null then 'standalone' else 'event' end scope,count(*) matches,sum(wins) wins,sum(losses) losses,sum(draws) draws,sum(points_for) points_for,sum(points_against) points_against from public."vFencerResults" group by fencer_id,display_name,event_id is null;
grant select on public."vMatchResults",public."vFencerResults",public."vFencerStatistics" to authenticated;

create function public.standings(p_event uuid,p_group uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$
 with totals as(select f.id,f.display_name,coalesce(sum(r.wins),0) wins,coalesce(sum(r.losses),0) losses,coalesce(sum(r.draws),0) draws,count(r.match_id) matches,coalesce(sum(r.points_for),0) points_for,coalesce(sum(r.points_for-r.points_against),0) differential
 from public."tEventFencer" ef join public."tFencer" f on f.id=ef.fencer_id left join public."vFencerResults" r on r.fencer_id=f.id and r.event_id=p_event and (p_group is null or r.group_id=p_group)
 where ef.event_id=p_event and (p_group is null or exists(select 1 from public."tEventGroupFencer" gf where gf.group_id=p_group and gf.fencer_id=f.id)) group by f.id), ranked as(
 select t.*, (select jsonb_agg(case k.value #>> '{}' when 'differential' then t.differential when 'points_for' then t.points_for else 0 end order by k.ordinality) from public."tConfiguration" c,jsonb_array_elements(c.tiebreakers) with ordinality k where c.id=true) tie_values from totals t)
 select coalesce(jsonb_agg(to_jsonb(r) order by wins desc,tie_values desc nulls last,display_name,id),'[]'::jsonb) from ranked r;
$$;
create function public.set_event_status(p_event uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not scorekeeper_private.can_use() then raise exception 'Not authorized'; end if;
 perform 1 from public."tEvent" where id=p_event for update;
 if p_status='completed' then
  if exists(select 1 from public."tTraditionalMatch" where event_id=p_event and not is_archived and not is_void and (finalized_at is null or lease_until>now() and phase='running')) then raise exception 'Complete or void all current matches first'; end if;
  insert into public."tEventFinalization"(event_id,standings,configuration,actor_id) select p_event,public.standings(p_event),to_jsonb(c),auth.uid() from public."tConfiguration" c where id=true;
 end if;
 update public."tEvent" set status=p_status where id=p_event;
end $$;
-- Status changes must use the snapshot-producing transaction.
revoke update on public."tEvent" from authenticated;
grant update(name,mode,starts_at,ends_at,description,competition_format,preset_id) on public."tEvent" to authenticated;
revoke all on function public.claim_match(uuid,uuid,boolean),public.save_match(jsonb,jsonb,uuid,integer,boolean),public.standings(uuid,uuid),public.set_event_status(uuid,text) from public,anon;
grant execute on function public.claim_match(uuid,uuid,boolean),public.save_match(jsonb,jsonb,uuid,integer,boolean),public.standings(uuid,uuid),public.set_event_status(uuid,text) to authenticated;
create function scorekeeper_private.guard_lease() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.lease_token is not null or new.finalized_at is not null or new.started_at is not null or new.phase<>'ready' then raise exception 'New matches must be scheduled and unplayed'; end if;
 else
  if current_setting('scorekeeper.claim',true) is distinct from coalesce(old.lease_token::text,'') then raise exception 'Use match claim/save operations'; end if;
 end if;
 return new;
end $$;
create trigger guard_lease before insert or update on public."tTraditionalMatch" for each row execute function scorekeeper_private.guard_lease();
create function scorekeeper_private.config_guard() returns trigger language plpgsql set search_path='' as $$
declare k text; v jsonb; seen text[]='{}'; begin
 if jsonb_typeof(new.tiebreakers)<>'array' or exists(select 1 from jsonb_array_elements_text(new.tiebreakers) x where x not in('differential','points_for')) or (select count(*)<>count(distinct x) from jsonb_array_elements_text(new.tiebreakers) x) then raise exception 'Invalid tiebreak order'; end if;
 for k,v in select * from jsonb_each(new.key_mappings) loop
  if k not in ('toggle','undo','left.indirect.1','left.indirect.3','left.indirect.5','left.clean.1','left.clean.3','left.clean.5','left.counter.1','left.counter.3','left.counter.5','right.indirect.1','right.indirect.3','right.indirect.5','right.clean.1','right.clean.3','right.clean.5','right.counter.1','right.counter.3','right.counter.5') or jsonb_typeof(v)<>'string' or length(v#>>'{}')<>1 or (v#>>'{}') !~ '^[a-z0-9 ]$' or (v#>>'{}')=any(seen) then raise exception 'Use unique single letters, digits or Space for shortcuts'; end if;
  seen=array_append(seen,v#>>'{}');
 end loop;
 new.version=old.version+1;new.updated_at=now();return new;
end $$;
create trigger validate_config before update on public."tConfiguration" for each row execute function scorekeeper_private.config_guard();
revoke insert,delete on public."tConfiguration" from authenticated;

create function public.generate_bracket(p_phase uuid,p_graph jsonb,p_format text,p_group uuid default null) returns uuid language plpgsql security invoker set search_path='' as $$
declare ph public."tEventPhase"; e public."tEvent"; preset public."tMatchPreset"; b uuid; n jsonb; f uuid; oldm record; begin
 select * into ph from public."tEventPhase" where id=p_phase for update;
 select * into e from public."tEvent" where id=ph.event_id;
 if e.status<>'active' or e.competition_format<>'individual' or e.mode<>'traditional' then raise exception 'Activate an individual Traditional event'; end if;
 if p_format not in('single','double','group') or (p_format='group' and p_group is null) or (p_format<>'group' and ph.kind<>p_format) then raise exception 'Bracket format does not match phase'; end if;
 if p_group is not null and not exists(select 1 from public."tEventGroup" where id=p_group and phase_id=p_phase) then raise exception 'Wrong group'; end if;
 if jsonb_typeof(p_graph->'entrants')<>'array' or jsonb_array_length(p_graph->'entrants') not between 2 and 128 or jsonb_typeof(p_graph->'nodes')<>'array' or jsonb_array_length(p_graph->'nodes')>8128 then raise exception 'Invalid bracket'; end if;
 for f in select value::uuid from jsonb_array_elements_text(p_graph->'entrants') loop
  if not exists(select 1 from public."tEventFencer" where event_id=e.id and fencer_id=f) or (p_group is not null and not exists(select 1 from public."tEventGroupFencer" where group_id=p_group and fencer_id=f)) then raise exception 'Entrant is not registered in this phase/group'; end if;
 end loop;
 if exists(select 1 from public."tTraditionalMatch" m join public."tBracket" b on b.id=m.bracket_id where b.phase_id=p_phase and not b.is_archived and (p_group is null or m.group_id=p_group) and m.lease_until>now()) then raise exception 'Wait until all referee claims expire before regenerating'; end if;
 -- Whole prior generations are archived, retaining played results and immutable audits.
 for oldm in select m.id,m.lease_token from public."tTraditionalMatch" m join public."tBracket" b on b.id=m.bracket_id where b.phase_id=p_phase and not b.is_archived and (p_group is null or m.group_id=p_group) for update of m loop
  perform set_config('scorekeeper.claim',coalesce(oldm.lease_token::text,''),true);
  update public."tTraditionalMatch" set is_archived=true where id=oldm.id;
 end loop;
 update public."tBracket" set is_archived=true where phase_id=p_phase and not is_archived and (p_group is null or id in(select bracket_id from public."tTraditionalMatch" where group_id=p_group));
 select * into preset from public."tMatchPreset" where id=coalesce(ph.preset_id,e.preset_id) and not is_archived and mode='traditional';
 if not found then raise exception 'Select an active Traditional default preset'; end if;
 insert into public."tBracket"(phase_id,format,graph) values(p_phase,p_format,p_graph) returning id into b;
 for n in select value from jsonb_array_elements(p_graph->'nodes') loop
  insert into public."tTraditionalMatch"(owner_id,event_id,event_name,phase_id,group_id,bracket_id,slot_key,round_name,preset_id,duration_ms,remaining_ms,target_score) values(auth.uid(),e.id,e.name,ph.id,p_group,b,n->>'key',n->>'key',preset.id,preset.duration_ms,preset.duration_ms,preset.target_score);
 end loop;
 return b;
end $$;

create function public.sync_bracket(p_bracket uuid) returns void language plpgsql security invoker set search_path='' as $$
declare b public."tBracket"; n jsonb; src jsonb; srcrow public."tTraditionalMatch"; m public."tTraditionalMatch"; side text; f uuid; l uuid; r uuid; resolved boolean; allresolved boolean; begin
 select * into b from public."tBracket" where id=p_bracket and not is_archived for update;
 if not found then raise exception 'Bracket not active'; end if;
 for n in select value from jsonb_array_elements(b.graph->'nodes') loop
  l=null;r=null;allresolved=true;
  foreach side in array array['left','right'] loop
   src=n->side;f=null;resolved=true;
   if src ? 'seed' then f=(b.graph->'entrants'->>((src->>'seed')::int))::uuid;
   else
    select * into srcrow from public."tTraditionalMatch" where bracket_id=b.id and slot_key=src->>'match';
    if srcrow.finalized_at is null and not srcrow.is_void then resolved=false;
    elsif srcrow.is_void and srcrow.left_fencer_id is not null and srcrow.right_fencer_id is not null then resolved=false;
    elsif srcrow.is_void then f=case when src->>'outcome'='winner' then coalesce(srcrow.left_fencer_id,srcrow.right_fencer_id) else null end;
    else f=case when (src->>'outcome'='winner')=(srcrow.winner_side='left') then srcrow.left_fencer_id else srcrow.right_fencer_id end;
    end if;
   end if;
   allresolved=allresolved and resolved;
   if side='left' then l=f;else r=f;end if;
  end loop;
  select * into m from public."tTraditionalMatch" where bracket_id=b.id and slot_key=n->>'key' for update;
  if m.lease_until>now() then continue; end if;
  if m.started_at is not null and (m.left_fencer_id is distinct from l or m.right_fencer_id is distinct from r) then raise exception 'Played downstream match conflicts with corrected result; regenerate bracket'; end if;
  if m.started_at is null and allresolved then
   perform set_config('scorekeeper.claim',coalesce(m.lease_token::text,''),true);
   if coalesce((n->>'reset')::boolean,false) then
    select * into srcrow from public."tTraditionalMatch" where bracket_id=b.id and slot_key='GF';
    -- Winner-bracket champion on GF's left needs only one win; no reset in that case.
    if srcrow.winner_side='left' then l=null;r=null; end if;
   end if;
   update public."tTraditionalMatch" set left_fencer_id=l,right_fencer_id=r,left_name=coalesce((select display_name from public."tFencer" where id=l),'Bye'),right_name=coalesce((select display_name from public."tFencer" where id=r),'Bye'),is_void=(l is null or r is null) where id=m.id;
  end if;
 end loop;
end $$;
revoke all on function public.generate_bracket(uuid,jsonb,text,uuid),public.sync_bracket(uuid) from public,anon;
grant execute on function public.generate_bracket(uuid,jsonb,text,uuid),public.sync_bracket(uuid) to authenticated;
-- Referee claims can be released after a successful checkpoint.
create function public.release_match(p_id uuid,p_token uuid) returns void language plpgsql security invoker set search_path='' as $$ begin
 perform set_config('scorekeeper.claim',md5(p_token::text)::uuid::text,true);
 update public."tTraditionalMatch" set lease_until=now(),lease_token=null where id=p_id and lease_token=md5(p_token::text)::uuid and referee_id=auth.uid();
end $$;
revoke all on function public.release_match(uuid,uuid) from public,anon;
grant execute on function public.release_match(uuid,uuid) to authenticated;
create function public.account_status() returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(u) from public."tUser" u where u.id=auth.uid() and auth.uid() is not null and (nullif(auth.jwt()->>'session_id','') is null or exists(select 1 from auth.sessions s where s.id=(auth.jwt()->>'session_id')::uuid and s.user_id=auth.uid()));
$$;
revoke all on function public.account_status() from public,anon;
grant execute on function public.account_status() to authenticated;
create function public.revoke_account_sessions(p_id uuid) returns void language sql security definer set search_path='' as $$ delete from auth.sessions where user_id=p_id $$;
revoke all on function public.revoke_account_sessions(uuid) from public,anon,authenticated;
grant execute on function public.revoke_account_sessions(uuid) to service_role;
create function scorekeeper_private.validate_relation() returns trigger language plpgsql set search_path='' as $$
declare e public."tEvent"; f public."tFencer"; t public."tTeam"; event_uuid uuid; begin
 if tg_table_name='tEvent' then
  if new.preset_id is not null and not exists(select 1 from public."tMatchPreset" where id=new.preset_id and mode=new.mode and not is_archived) then raise exception 'Event preset has incompatible mode'; end if;
  if tg_op='UPDATE' and old.status<>'draft' and (new.mode<>old.mode or new.competition_format<>old.competition_format) then raise exception 'Event mode and format are fixed after draft'; end if;
 elsif tg_table_name='tEventFencer' then
  if exists(select 1 from public."tFencer" where id=new.fencer_id and (is_unregistered or is_archived)) then raise exception 'Choose an active registered fencer'; end if;
 elsif tg_table_name='tEventTeam' then
  select * into e from public."tEvent" where id=new.event_id;select * into t from public."tTeam" where id=new.team_id;
  if e.mode<>t.mode or new.mode<>e.mode then raise exception 'Event and team modes must match'; end if;
 elsif tg_table_name='tEventGroupFencer' then
  select p.event_id into event_uuid from public."tEventPhase" p join public."tEventGroup" g on g.phase_id=p.id where g.id=new.group_id;
  if not exists(select 1 from public."tEventFencer" where event_id=event_uuid and fencer_id=new.fencer_id) then raise exception 'Register the competitor for this event first'; end if;
  if exists(select 1 from public."tEventGroupFencer" x join public."tEventGroup" gx on gx.id=x.group_id join public."tEventGroup" gn on gn.id=new.group_id where gx.phase_id=gn.phase_id and x.fencer_id=new.fencer_id and x.group_id<>new.group_id) then raise exception 'Competitor already belongs to another group in this phase'; end if;
 elsif tg_table_name='tTeam' then
  if new.image_url is not null and new.image_url !~ '^https://[^/@]+([/:][^@]*)?$' then raise exception 'Use an HTTPS image URL'; end if;
  if new.image_path is not null and split_part(new.image_path,'/',1)<>new.id::text then raise exception 'Image must belong to this team'; end if;
 end if;
 return new;
end $$;
do $$ declare t text; begin foreach t in array array['tEvent','tEventFencer','tEventTeam','tEventGroupFencer','tTeam'] loop execute format('create trigger validate_relation before insert or update on public.%I for each row execute function scorekeeper_private.validate_relation()',t);end loop;end $$;
create function scorekeeper_private.creator_immutable() returns trigger language plpgsql set search_path='' as $$ begin
 if tg_op='INSERT' and auth.uid() is not null then new.owner_id=auth.uid();
 elsif tg_op='UPDATE' and new.owner_id<>old.owner_id then raise exception 'Original creator cannot be changed'; end if;return new;end $$;
do $$ declare t text; begin for t in select table_name from information_schema.columns c where table_schema='public' and column_name='owner_id' and exists(select 1 from information_schema.tables t where t.table_schema=c.table_schema and t.table_name=c.table_name and t.table_type='BASE TABLE') loop execute format('create trigger creator_immutable before insert or update on public.%I for each row execute function scorekeeper_private.creator_immutable()',t);end loop;end $$;
-- A retained shared team image, never a public bucket.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('team-images','team-images',false,2097152,array['image/png','image/jpeg','image/webp']) on conflict(id) do nothing;
create policy scorekeeper_image_read on storage.objects for select to authenticated using(bucket_id='team-images' and (select scorekeeper_private.can_use()));
create policy scorekeeper_image_insert on storage.objects for insert to authenticated with check(bucket_id='team-images' and (select scorekeeper_private.can_use()) and exists(select 1 from public."tTeam" t where t.id::text=split_part(name,'/',1) and not t.is_archived));
create policy scorekeeper_image_delete on storage.objects for delete to authenticated using(bucket_id='team-images' and (select scorekeeper_private.is_admin()));
create function scorekeeper_private.phase_order_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if new.phase='running' and new.phase_id is not null and exists(
  select 1 from public."tEventPhase" p join public."tEventPhase" current_phase on current_phase.id=new.phase_id join public."tTraditionalMatch" m on m.phase_id=p.id
  where p.event_id=current_phase.event_id and p.position<current_phase.position and not p.is_archived and not m.is_archived and not m.is_void and m.finalized_at is null
 ) then raise exception 'Finish or void earlier phase matches first';end if;
 if new.preset_id is not null and not exists(select 1 from public."tMatchPreset" where id=new.preset_id and mode='traditional') then raise exception 'Choose a Traditional preset';end if;
 return new;
end $$;
create trigger phase_order_guard before insert or update on public."tTraditionalMatch" for each row execute function scorekeeper_private.phase_order_guard();
alter table public."tEventFinalization" add column group_standings jsonb not null default '{}',add column participants jsonb not null default '[]';
create or replace function public.set_event_status(p_event uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not scorekeeper_private.can_use() then raise exception 'Not authorized'; end if;
 perform 1 from public."tEvent" where id=p_event for update;
 if not found then raise exception 'Event not found';end if;
 if p_status='completed' then
  perform 1 from public."tTraditionalMatch" where event_id=p_event for update;
  perform 1 from public."tConfiguration" where id=true for share;
  if exists(select 1 from public."tTraditionalMatch" where event_id=p_event and not is_archived and not is_void and finalized_at is null) then raise exception 'Complete or void all current matches first'; end if;
  insert into public."tEventFinalization"(event_id,standings,configuration,actor_id,group_standings,participants)
  select p_event,public.standings(p_event),to_jsonb(c),auth.uid(),
  coalesce((select jsonb_object_agg(g.id::text,jsonb_build_object('name',g.name,'standings',public.standings(p_event,g.id))) from public."tEventGroup" g join public."tEventPhase" ph on ph.id=g.phase_id where ph.event_id=p_event and not ph.is_archived),'{}'),
  coalesce((select jsonb_agg(to_jsonb(f)) from public."tEventFencer" ef join public."tFencer" f on f.id=ef.fencer_id where ef.event_id=p_event),'[]')
  from public."tConfiguration" c where id=true;
 end if;
 update public."tEvent" set status=p_status where id=p_event;
end $$;
create view public."vFencerScoring" with(security_invoker=true) as
 select f.id fencer_id,case when m.event_id is null then 'standalone' else 'event' end scope,c.call_type,c.points,count(*) calls,sum(c.points) total_points
 from public."vMatchResults" m join public."tTraditionalCall" c on c.match_id=m.id and not c.is_reversed
 join public."tFencer" f on f.id=case when c.side='left' then m.left_fencer_id else m.right_fencer_id end and not f.is_unregistered
 where m.outcome in('draw','result') and not m.is_archived and not m.is_void group by f.id,m.event_id is null,c.call_type,c.points;
grant select on public."vFencerScoring" to authenticated;
create function public.void_match(p_id uuid) returns void language plpgsql security invoker set search_path='' as $$
declare m public."tTraditionalMatch";begin
 select * into m from public."tTraditionalMatch" where id=p_id for update;
 if not found then raise exception 'Match not found';end if;
 if m.lease_until>now() then raise exception 'Release the active referee claim before voiding';end if;
 perform set_config('scorekeeper.claim',coalesce(m.lease_token::text,''),true);
 update public."tTraditionalMatch" set is_void=true where id=p_id;
end $$;
revoke all on function public.void_match(uuid) from public,anon;
grant execute on function public.void_match(uuid) to authenticated;
-- Bound match settings and participant-name snapshots at the database as well as in forms.
alter table public."tTraditionalMatch" add constraint match_bounds check(duration_ms between 1000 and 10800000 and remaining_ms<=duration_ms and (target_score is null or target_score between 1 and 10000)) not valid;
alter table public."tTraditionalMatch" add constraint match_names check(length(btrim(left_name)) between 1 and 120 and length(btrim(right_name)) between 1 and 120) not valid;
-- Undefined Control Point mechanics remain unavailable for writes in the initial release.
revoke insert,update,delete on public."tControlPointMatch",public."tControlPointCall",public."tControlPointTime" from authenticated;
-- The trusted account endpoint alone manages retained user identities and audit inserts.
grant select,insert,update,delete on all tables in schema public to service_role;
-- Configure this free-tier Send Email hook in Auth before release. Returning an
-- error prevents the built-in recovery/magic-link mail path from bypassing the
-- academy's Admin-managed credentials workflow. It sends nothing externally.
create function public.scorekeeper_block_email(event jsonb) returns jsonb language sql immutable security invoker set search_path='' as $$
 select '{"error":{"http_code":403,"message":"Email sign-in and recovery are disabled. Contact the academy administrator."}}'::jsonb;
$$;
revoke all on function public.scorekeeper_block_email(jsonb) from public,anon,authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.scorekeeper_block_email(jsonb) to supabase_auth_admin;
