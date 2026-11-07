-- Direct phase registrations, durable schedule order, archived generations and transactional advancement.
alter table public."tEventPhase" add column revision integer not null default 0,
 add column workflow_enabled boolean not null default false,
 add column legacy_parent_phase_id uuid references public."tEventPhase"(id),
 add constraint phase_event_identity unique(id,event_id);
alter table public."tTraditionalMatch" add column match_sequence integer,
 add column schedule_ready boolean not null default true,
 add column is_bye boolean not null default false,
 add column phase_name_snapshot text;
create index phase_match_order on public."tTraditionalMatch"(phase_id,match_sequence,id) where not is_archived;
create table public."tPhaseRegistration"(
 phase_id uuid not null, event_id uuid not null, fencer_id uuid not null,
 seed integer check(seed between 1 and 128), registered_at timestamptz not null default now(),
 primary key(phase_id,fencer_id), unique(phase_id,seed),
 foreign key(phase_id,event_id) references public."tEventPhase"(id,event_id),
 foreign key(event_id,fencer_id) references public."tEventFencer"(event_id,fencer_id)
);
create index phase_registration_event on public."tPhaseRegistration"(event_id,fencer_id);
create table public."tPhaseOperation"(
 id uuid primary key,phase_id uuid not null references public."tEventPhase"(id),
 actor_id uuid not null references public."tUser"(id),recorded_at timestamptz not null default now(),
 action text not null,request_hash text not null,result jsonb not null
);
create index phase_operation_phase on public."tPhaseOperation"(phase_id,recorded_at);
alter table public."tPhaseRegistration" enable row level security;
alter table public."tPhaseOperation" enable row level security;
grant select,insert,update,delete on public."tPhaseRegistration" to authenticated;
grant select,insert on public."tPhaseOperation" to authenticated;
grant all on public."tPhaseRegistration",public."tPhaseOperation" to service_role;
create policy phase_registration_access on public."tPhaseRegistration" for all to authenticated using((select scorekeeper_private.can_use())) with check((select scorekeeper_private.can_use()));
create policy phase_operation_read on public."tPhaseOperation" for select to authenticated using((select scorekeeper_private.can_use()));
create policy phase_operation_append on public."tPhaseOperation" for insert to authenticated with check((select scorekeeper_private.can_use()) and actor_id=auth.uid());
create trigger phase_registration_audit after insert or update or delete on public."tPhaseRegistration" for each row execute function scorekeeper_private.audit();
create trigger phase_operation_audit after insert on public."tPhaseOperation" for each row execute function scorekeeper_private.audit();

-- Independent phases can run concurrently. Only actual bracket dependencies constrain play.
create or replace function scorekeeper_private.phase_order_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if new.preset_id is not null and not exists(select 1 from public."tMatchPreset" where id=new.preset_id and mode='traditional') then raise exception 'Choose a Traditional preset';end if;
 if tg_op='UPDATE' and new.lease_token is not null and new.lease_token is distinct from old.lease_token and not new.schedule_ready then raise exception 'Waiting for earlier bracket results';end if;
 if new.phase='running' and not new.schedule_ready then raise exception 'Waiting for earlier bracket results';end if;
 return new;
end $$;

-- Reconcile the legacy parent-phase/group hierarchy without deleting identities or evidence.
do $$ declare ph public."tEventPhase";g record;new_id uuid;mr record;begin
 perform set_config('scorekeeper.operation','v2',true);
 for ph in select * from public."tEventPhase" where kind='group' order by id loop
  for g in select * from public."tEventGroup" where phase_id=ph.id order by id loop
   if exists(select 1 from public."tTraditionalMatch" a join public."tTraditionalMatch" b on b.bracket_id=a.bracket_id where a.group_id=g.id and b.group_id is distinct from g.id) then
    raise exception 'Mixed-group legacy bracket requires explicit reconciliation before migration';
   end if;
   new_id=gen_random_uuid();
   insert into public."tEventPhase"(id,event_id,name,kind,position,preset_id,is_archived,legacy_parent_phase_id)
   values(new_id,ph.event_id,g.name,'group',ph.position,ph.preset_id,ph.is_archived,ph.id);
   update public."tBracket" set phase_id=new_id where id in(select bracket_id from public."tTraditionalMatch" where group_id=g.id);
   for mr in select id,lease_token from public."tTraditionalMatch" where group_id=g.id loop
    perform set_config('scorekeeper.claim',coalesce(mr.lease_token::text,''),true);
    update public."tTraditionalMatch" set phase_id=new_id,phase_name_snapshot=ph.name||' / '||g.name where id=mr.id;
   end loop;
   update public."tEventGroup" set phase_id=new_id where id=g.id;
  end loop;
  if exists(select 1 from public."tEventPhase" where legacy_parent_phase_id=ph.id) and not exists(select 1 from public."tTraditionalMatch" where phase_id=ph.id) then
   update public."tEventPhase" set is_archived=true where id=ph.id;
  end if;
 end loop;
end $$;
insert into public."tPhaseRegistration"(phase_id,event_id,fencer_id)
 select distinct p.id,p.event_id,gf.fencer_id from public."tEventGroupFencer" gf join public."tEventGroup" g on g.id=gf.group_id join public."tEventPhase" p on p.id=g.phase_id
 join public."tEventFencer" ef on ef.event_id=p.event_id and ef.fencer_id=gf.fencer_id on conflict do nothing;
insert into public."tPhaseRegistration"(phase_id,event_id,fencer_id)
 select distinct p.id,p.event_id,ef.fencer_id from public."tEventPhase" p join public."tTraditionalMatch" m on m.phase_id=p.id
 join public."tEventFencer" ef on ef.event_id=p.event_id and ef.fencer_id in(m.left_fencer_id,m.right_fencer_id) on conflict do nothing;
insert into public."tPhaseRegistration"(phase_id,event_id,fencer_id)
 select distinct p.id,p.event_id,ef.fencer_id from public."tBracket" b join public."tEventPhase" p on p.id=b.phase_id,
 jsonb_array_elements_text(b.graph->'entrants') f join public."tEventFencer" ef on ef.fencer_id=f.value::uuid
 where ef.event_id=p.event_id on conflict do nothing;
do $$ declare m record;begin
 perform set_config('scorekeeper.operation','v2',true);
 for m in select x.id,x.lease_token,p.name,row_number() over(partition by x.phase_id order by x.created_at,x.id)::int seq from public."tTraditionalMatch" x join public."tEventPhase" p on p.id=x.phase_id loop
  perform set_config('scorekeeper.claim',coalesce(m.lease_token::text,''),true);
  update public."tTraditionalMatch" set ledger_enabled=true,match_sequence=m.seq,phase_name_snapshot=coalesce(phase_name_snapshot,m.name),is_bye=false where id=m.id;
 end loop;
end $$;
update public."tEventPhase" set workflow_enabled=true;

create function scorekeeper_private.phase_guard() returns trigger language plpgsql set search_path='' as $$
declare pid uuid;begin
 if tg_table_name='tEventPhase' then
  if tg_op='DELETE' then raise exception 'Archive phases; never delete their history';end if;
  if (new.workflow_enabled or (tg_op='UPDATE' and old.workflow_enabled)) and current_setting('scorekeeper.phase',true) is distinct from new.id::text then raise exception 'Use the versioned phase command';end if;
  if tg_op='UPDATE' and old.workflow_enabled and (new.event_id<>old.event_id or not new.workflow_enabled) then raise exception 'Phase event and protocol are immutable';end if;
 else
  pid=coalesce(new.phase_id,old.phase_id);
  if current_setting('scorekeeper.phase',true) is distinct from pid::text then raise exception 'Use the versioned phase command';end if;
  if tg_table_name='tPhaseOperation' and tg_op<>'INSERT' then raise exception 'Phase operations are immutable';end if;
 end if;
 return coalesce(new,old);
end $$;
create trigger phase_guard before insert or update or delete on public."tEventPhase" for each row execute function scorekeeper_private.phase_guard();
create trigger registration_guard before insert or update or delete on public."tPhaseRegistration" for each row execute function scorekeeper_private.phase_guard();
create trigger phase_receipt_guard before insert or update or delete on public."tPhaseOperation" for each row execute function scorekeeper_private.phase_guard();

create function scorekeeper_private.phase_match_guard() returns trigger language plpgsql set search_path='' as $$
declare ph public."tEventPhase";begin
 if new.phase_id is null then return new;end if;
 select * into ph from public."tEventPhase" where id=new.phase_id;
 if ph.event_id is distinct from new.event_id then raise exception 'Match phase belongs to a different event';end if;
 if not ph.workflow_enabled then return new;end if;
 if tg_op='INSERT' or row(new.phase_id,new.left_fencer_id,new.right_fencer_id,new.match_type,new.preset_id,new.duration_ms,new.target_score,new.match_sequence,new.is_archived,new.is_bye,new.schedule_ready) is distinct from row(old.phase_id,old.left_fencer_id,old.right_fencer_id,old.match_type,old.preset_id,old.duration_ms,old.target_score,old.match_sequence,old.is_archived,old.is_bye,old.schedule_ready) then
  if current_setting('scorekeeper.phase',true) is distinct from ph.id::text and current_setting('scorekeeper.operation',true) is distinct from 'v2' then raise exception 'Use phase scheduling or match commands';end if;
  if exists(select 1 from unnest(array[new.left_fencer_id,new.right_fencer_id]) f where f is not null and not exists(select 1 from public."tPhaseRegistration" r where r.phase_id=ph.id and r.fencer_id=f)) then raise exception 'Competitor is not registered in this phase';end if;
 end if;
 if tg_op='INSERT' then new.phase_name_snapshot=ph.name;new.ledger_enabled=true;end if;
 if tg_op='UPDATE' and old.started_at is not null and (new.phase_id is distinct from old.phase_id or new.phase_name_snapshot is distinct from old.phase_name_snapshot) then raise exception 'Played phase attribution is immutable';end if;
 return new;
end $$;
create trigger phase_match_guard before insert or update on public."tTraditionalMatch" for each row execute function scorekeeper_private.phase_match_guard();

-- Resolve partial slots and byes as well as completed results. No changes means no revision bump.
create or replace function public.sync_bracket(p_bracket uuid) returns void language plpgsql security invoker set search_path='' as $$
declare b public."tBracket";n jsonb;src jsonb;sm public."tTraditionalMatch";m public."tTraditionalMatch";s text;f uuid;l uuid;r uuid;resolved boolean;ready boolean;bye boolean;v boolean;ev uuid;begin
 -- The migration owner may reconcile legacy graphs; API roles still require an active account.
 if current_user<>'postgres' and not scorekeeper_private.can_use() then raise exception 'Active account required';end if;
 select p.event_id into ev from public."tBracket" x join public."tEventPhase" p on p.id=x.phase_id where x.id=p_bracket;
 perform 1 from public."tEvent" where id=ev for update;
 select * into b from public."tBracket" where id=p_bracket and not is_archived for update;
 if not found then raise exception 'Bracket not active';end if;
 if not exists(select 1 from public."tEvent" where id=ev and status in('draft','active')) then raise exception 'Reopen this event before changing its matches';end if;
 perform set_config('scorekeeper.phase',b.phase_id::text,true);
 perform set_config('scorekeeper.operation','v2',true);
 for n in select value from jsonb_array_elements(b.graph->'nodes') loop
  l=null;r=null;ready=true;
  foreach s in array array['left','right'] loop
   src=n->s;f=null;resolved=true;
   if src ? 'seed' then f=(b.graph->'entrants'->>((src->>'seed')::int))::uuid;
   else
    select * into sm from public."tTraditionalMatch" where bracket_id=b.id and slot_key=src->>'match';
    if not found then raise exception 'Missing bracket dependency';end if;
    if sm.is_bye then
     f=case when src->>'outcome'='winner' then coalesce(sm.left_fencer_id,sm.right_fencer_id) else null end;
    elsif sm.finalized_at is null or sm.is_void or sm.winner_side is null then resolved=false;
    else f=case when (src->>'outcome'='winner')=(sm.winner_side='left') then sm.left_fencer_id else sm.right_fencer_id end;
    end if;
   end if;
   ready=ready and resolved;
   if s='left' then l=f;else r=f;end if;
  end loop;
  if coalesce((n->>'reset')::boolean,false) and ready then
   select * into sm from public."tTraditionalMatch" where bracket_id=b.id and slot_key='GF';
   if sm.winner_side='left' then l=null;r=null;end if;
  end if;
  bye=ready and (l is null or r is null);
  select * into m from public."tTraditionalMatch" where bracket_id=b.id and slot_key=n->>'key' for update;
  if not found then raise exception 'Missing bracket fixture';end if;
  if m.started_at is not null and (m.left_fencer_id is distinct from l or m.right_fencer_id is distinct from r) then raise exception 'Played downstream match conflicts with corrected result; regenerate bracket';end if;
  v=bye or (m.is_void and not m.is_bye);
  if row(m.left_fencer_id,m.right_fencer_id,m.schedule_ready,m.is_bye,m.is_void) is distinct from row(l,r,ready and not bye,bye,v) then
   if m.lease_until>now() then raise exception 'A downstream referee claim must be released before changing its participants';end if;
   perform set_config('scorekeeper.claim',coalesce(m.lease_token::text,''),true);
   update public."tTraditionalMatch" set left_fencer_id=l,right_fencer_id=r,left_name=coalesce((select display_name from public."tFencer" where id=l),case when ready then 'Bye' else 'Awaiting winner' end),right_name=coalesce((select display_name from public."tFencer" where id=r),case when ready then 'Bye' else 'Awaiting winner' end),schedule_ready=ready and not bye,is_bye=bye,is_void=v,lease_token=null,lease_until=null where id=m.id;
  end if;
 end loop;
end $$;

-- A canonical graph is built on the server; client-supplied graphs cannot invent dependencies.
create function scorekeeper_private.phase_graph(entrants jsonb,kind text) returns jsonb language plpgsql set search_path='' as $$
declare nodes jsonb='[]';n int=jsonb_array_length(entrants);sz int=2;rounds int=1;rr int;i int;k int;cnt int;lr int;seed_order int[]=array[1,2];next_order int[];a jsonb;b jsonb;begin
 if n not between 2 and 128 then raise exception 'Choose 2–128 registered participants';end if;
 if kind='group' then
  select jsonb_agg(jsonb_build_object('key','R'||x.seq,'left',jsonb_build_object('seed',x.i),'right',jsonb_build_object('seed',x.j)) order by x.seq) into nodes from (select a.seed i,b.seed j,row_number() over(order by a.seed,b.seed) seq from generate_series(0,n-2) a(seed) cross join lateral generate_series(a.seed+1,n-1) b(seed)) x;
 else
  while sz<n loop sz=sz*2;rounds=rounds+1;next_order='{}';foreach i in array seed_order loop next_order=next_order||array[i,sz+1-i];end loop;seed_order=next_order;end loop;
  for rr in 1..rounds loop
   cnt=sz/(2^rr)::int;
   for i in 0..cnt-1 loop
    a=case when rr=1 then jsonb_build_object('seed',seed_order[i*2+1]-1) else jsonb_build_object('match','W'||(rr-1)||'.'||(i*2),'outcome','winner') end;
    b=case when rr=1 then jsonb_build_object('seed',seed_order[i*2+2]-1) else jsonb_build_object('match','W'||(rr-1)||'.'||(i*2+1),'outcome','winner') end;
    nodes=nodes||jsonb_build_array(jsonb_build_object('key','W'||rr||'.'||i,'left',a,'right',b));
   end loop;
  end loop;
  if kind='double' then
   if rounds=1 then nodes=nodes||jsonb_build_array(jsonb_build_object('key','GF','left',jsonb_build_object('match','W1.0','outcome','winner'),'right',jsonb_build_object('match','W1.0','outcome','loser')));
   else
    for i in 0..sz/4-1 loop nodes=nodes||jsonb_build_array(jsonb_build_object('key','L1.'||i,'left',jsonb_build_object('match','W1.'||(i*2),'outcome','loser'),'right',jsonb_build_object('match','W1.'||(i*2+1),'outcome','loser')));end loop;
    for rr in 2..rounds loop
     cnt=sz/(2^rr)::int;lr=2*rr-2;
     for i in 0..cnt-1 loop nodes=nodes||jsonb_build_array(jsonb_build_object('key','L'||lr||'.'||i,'left',jsonb_build_object('match','L'||(lr-1)||'.'||i,'outcome','winner'),'right',jsonb_build_object('match','W'||rr||'.'||(cnt-1-i),'outcome','loser')));end loop;
     if rr<rounds then for i in 0..cnt/2-1 loop nodes=nodes||jsonb_build_array(jsonb_build_object('key','L'||(lr+1)||'.'||i,'left',jsonb_build_object('match','L'||lr||'.'||(i*2),'outcome','winner'),'right',jsonb_build_object('match','L'||lr||'.'||(i*2+1),'outcome','winner')));end loop;end if;
    end loop;
    nodes=nodes||jsonb_build_array(jsonb_build_object('key','GF','left',jsonb_build_object('match','W'||rounds||'.0','outcome','winner'),'right',jsonb_build_object('match','L'||(2*rounds-2)||'.0','outcome','winner')));
   end if;
   nodes=nodes||jsonb_build_array(jsonb_build_object('key','RESET','left',jsonb_build_object('match','GF','outcome','winner'),'right',jsonb_build_object('match','GF','outcome','loser'),'reset',true));
  end if;
 end if;
 return jsonb_build_object('entrants',entrants,'nodes',nodes);
end $$;
revoke all on function scorekeeper_private.phase_graph(jsonb,text) from public;
grant execute on function scorekeeper_private.phase_graph(jsonb,text) to authenticated;
alter table public."tEventPhase" add column preset_snapshot jsonb;
alter table public."tTraditionalMatch" add column phase_settings_snapshot jsonb;
do $$ declare x record;begin for x in select p.id,to_jsonb(r) snap from public."tEventPhase" p join public."tEvent" e on e.id=p.event_id join public."tMatchPreset" r on r.id=coalesce(p.preset_id,e.preset_id) loop
 perform set_config('scorekeeper.phase',x.id::text,true);update public."tEventPhase" set preset_snapshot=x.snap where id=x.id;
end loop;end $$;

create function public.phase_command(p_request uuid,p_event uuid,p_phase uuid,p_revision integer,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare e public."tEvent";ph public."tEventPhase";before_ph public."tEventPhase";preset public."tMatchPreset";receipt public."tPhaseOperation";m record; f uuid;bid uuid;mid uuid; graph jsonb;entrants jsonb;node jsonb; seq int;count_changed int=0;hash text;result jsonb;begin
 if not scorekeeper_private.can_use() then raise exception 'Active account required';end if;
 select * into e from public."tEvent" where id=p_event for update;
 if not found then raise exception 'Event unavailable';end if;
 select * into ph from public."tEventPhase" where id=p_phase for update;
 hash=md5(jsonb_build_object('event',p_event,'phase',p_phase,'revision',p_revision,'action',p_action,'data',p_data)::text);
 select * into receipt from public."tPhaseOperation" where id=p_request;
 if found then
  if receipt.actor_id<>auth.uid() or receipt.request_hash<>hash then raise exception 'Request identity cannot be reassigned';end if;
  return receipt.result;
 end if;
 if e.status not in('draft','active') then raise exception 'Reopen this event before changing its phases';end if;
 if e.mode<>'traditional' or e.competition_format<>'individual' then raise exception 'Phase execution supports individual Traditional events';end if;
 if p_action='create' then
  if ph.id is not null then raise exception 'Phase already exists';end if;
  ph.id=p_phase;ph.event_id=e.id;ph.name=btrim(p_data->>'name');ph.kind=p_data->>'kind';ph.position=coalesce((p_data->>'position')::int,1);ph.preset_id=(p_data->>'presetId')::uuid;ph.workflow_enabled=true;ph.revision=0;ph.is_archived=false;
 else
  if ph.id is null or ph.event_id<>p_event or not ph.workflow_enabled then raise exception 'Phase unavailable';end if;
  if ph.revision is distinct from p_revision then raise exception 'Phase changed on another device. Reload before saving.';end if;
  if ph.is_archived and p_action<>'restore' then raise exception 'Restore this phase first';end if;
 end if;
 before_ph=ph;
 perform set_config('scorekeeper.phase',ph.id::text,true);
 perform set_config('scorekeeper.operation','v2',true);
 if p_action in('create','edit') then
  ph.name=btrim(coalesce(p_data->>'name',ph.name));ph.kind=coalesce(p_data->>'kind',ph.kind);ph.position=coalesce((p_data->>'position')::int,ph.position);
  if p_data ? 'presetId' then ph.preset_id=(p_data->>'presetId')::uuid;end if;
  if ph.name is null or length(ph.name) not between 1 and 120 or ph.kind not in('group','single','double') or ph.position not between 1 and 10000 then raise exception 'Choose a name, format and valid order';end if;
  select * into preset from public."tMatchPreset" where id=coalesce(ph.preset_id,e.preset_id) and not is_archived and mode='traditional' for share;
  if not found then raise exception 'Choose an active Traditional phase preset';end if;
  if p_data ? 'presetUpdatedAt' and (p_data->>'presetUpdatedAt')::timestamptz is distinct from preset.updated_at then raise exception 'Preset changed on another device. Reload before saving.';end if;
  if ph.kind in('single','double') and preset.match_type<>'knockout' then raise exception 'Elimination phases require a Knockout preset';end if;
  ph.preset_snapshot=to_jsonb(preset);ph.preset_id=preset.id;
  if p_action='edit' and ph.kind<>before_ph.kind and exists(select 1 from public."tTraditionalMatch" where phase_id=ph.id and not is_archived) then raise exception 'A phase with a schedule cannot change its format; create a separate phase';end if;
  if p_action='create' then
   insert into public."tEventPhase"(id,event_id,name,kind,position,preset_id,preset_snapshot,workflow_enabled) values(ph.id,e.id,ph.name,ph.kind,ph.position,ph.preset_id,ph.preset_snapshot,true);
  elsif ph.preset_snapshot is distinct from before_ph.preset_snapshot then
   for m in select * from public."tTraditionalMatch" where phase_id=ph.id and not is_archived and started_at is null and (not is_void or is_bye) order by id for update loop
    if m.lease_until>now() then raise exception 'Release unplayed referee claims before changing phase settings';end if;
    perform set_config('scorekeeper.claim',coalesce(m.lease_token::text,''),true);
    update public."tTraditionalMatch" set preset_id=preset.id,duration_ms=preset.duration_ms,remaining_ms=preset.duration_ms,target_score=preset.target_score,match_type=preset.match_type,phase_settings_snapshot=ph.preset_snapshot,lease_token=null,lease_until=null where id=m.id;
    count_changed=count_changed+1;
   end loop;
  end if;
 elsif p_action='register' then
  f=(p_data->>'fencerId')::uuid;
  if not exists(select 1 from public."tEventFencer" ef join public."tFencer" x on x.id=ef.fencer_id where ef.event_id=e.id and ef.fencer_id=f and not x.is_archived and not x.is_unregistered) then raise exception 'Register an active fencer for this event first';end if;
  insert into public."tPhaseRegistration"(phase_id,event_id,fencer_id,seed) values(ph.id,e.id,f,(p_data->>'seed')::int)
   on conflict(phase_id,fencer_id) do update set seed=excluded.seed;
 elsif p_action='unregister' then
  f=(p_data->>'fencerId')::uuid;
  if exists(select 1 from public."tTraditionalMatch" where phase_id=ph.id and not is_archived and not is_void and f in(left_fencer_id,right_fencer_id)) or exists(select 1 from public."tBracket" b,jsonb_array_elements_text(b.graph->'entrants') x where b.phase_id=ph.id and not b.is_archived and x.value=f::text) then raise exception 'Archive or regenerate the current schedule before removing a participant';end if;
  delete from public."tPhaseRegistration" where phase_id=ph.id and fencer_id=f;
 elsif p_action in('generate','archive_schedule') then
  if p_data->>'confirmArchive' is distinct from 'true' then raise exception 'Confirm archival of every current phase match';end if;
  if ph.preset_snapshot is null then raise exception 'Set a compatible phase preset first';end if;
  if p_action='generate' then
  select coalesce(jsonb_agg(r.fencer_id order by r.seed), '[]') into entrants from public."tPhaseRegistration" r join public."tFencer" f on f.id=r.fencer_id where r.phase_id=ph.id and not f.is_archived and not f.is_unregistered;
  if exists(select 1 from public."tPhaseRegistration" where phase_id=ph.id and seed is null) then raise exception 'Assign a unique seed to every phase participant';end if;
  if jsonb_array_length(entrants)<>(select count(*) from public."tPhaseRegistration" where phase_id=ph.id) then raise exception 'Resolve inactive phase participants before generating';end if;
  graph=scorekeeper_private.phase_graph(entrants,ph.kind);
  end if;
  for m in select * from public."tTraditionalMatch" where phase_id=ph.id and not is_archived order by id for update loop
   if m.lease_until>now() or m.phase='running' then raise exception 'Pause running matches and release all phase referee claims before regenerating';end if;
   perform set_config('scorekeeper.claim',coalesce(m.lease_token::text,''),true);
   update public."tTraditionalMatch" set is_archived=true,lease_token=null,lease_until=null where id=m.id;
   count_changed=count_changed+1;
  end loop;
  update public."tBracket" set is_archived=true where phase_id=ph.id and not is_archived;
  if p_action='generate' then
  bid=gen_random_uuid();insert into public."tBracket"(id,phase_id,format,graph) values(bid,ph.id,ph.kind,graph);
  seq=0;
  for node in select value from jsonb_array_elements(graph->'nodes') loop
   seq=seq+1;
   insert into public."tTraditionalMatch"(owner_id,event_id,event_name,phase_id,phase_name_snapshot,phase_settings_snapshot,bracket_id,slot_key,round_name,match_sequence,schedule_ready,preset_id,duration_ms,remaining_ms,target_score,match_type)
   values(auth.uid(),e.id,e.name,ph.id,ph.name,ph.preset_snapshot,bid,node->>'key',node->>'key',seq,false,(ph.preset_snapshot->>'id')::uuid,(ph.preset_snapshot->>'duration_ms')::int,(ph.preset_snapshot->>'duration_ms')::int,(ph.preset_snapshot->>'target_score')::int,ph.preset_snapshot->>'match_type');
  end loop;
  perform public.sync_bracket(bid);
  end if;
 elsif p_action='manual' then
  if ph.preset_snapshot is null then raise exception 'Set a compatible phase preset first';end if;
  mid=gen_random_uuid();
  insert into public."tTraditionalMatch"(id,owner_id,event_id,event_name,phase_id,phase_name_snapshot,phase_settings_snapshot,left_fencer_id,right_fencer_id,left_name,right_name,match_sequence,preset_id,duration_ms,remaining_ms,target_score,match_type)
  values(mid,auth.uid(),e.id,e.name,ph.id,ph.name,ph.preset_snapshot,(p_data->>'leftId')::uuid,(p_data->>'rightId')::uuid,(select display_name from public."tFencer" where id=(p_data->>'leftId')::uuid),(select display_name from public."tFencer" where id=(p_data->>'rightId')::uuid),coalesce((select max(match_sequence) from public."tTraditionalMatch" where phase_id=ph.id and not is_archived),0)+1,(ph.preset_snapshot->>'id')::uuid,(ph.preset_snapshot->>'duration_ms')::int,(ph.preset_snapshot->>'duration_ms')::int,(ph.preset_snapshot->>'target_score')::int,ph.preset_snapshot->>'match_type');
 elsif p_action in('archive','restore') then
  if p_action='archive' and exists(select 1 from public."tTraditionalMatch" where phase_id=ph.id and not is_archived and not is_void and (finalized_at is null or lease_until>now())) then raise exception 'Finish or archive the phase schedule before archiving its setup';end if;
  ph.is_archived=p_action='archive';
 else raise exception 'Unknown phase action';end if;
 update public."tEventPhase" set name=ph.name,kind=ph.kind,position=ph.position,preset_id=ph.preset_id,preset_snapshot=ph.preset_snapshot,is_archived=ph.is_archived,revision=revision+1 where id=ph.id returning * into ph;
 result=jsonb_build_object('phaseId',ph.id,'revision',ph.revision,'bracketId',bid,'matchId',mid,'affectedMatches',count_changed);
 insert into public."tPhaseOperation"(id,phase_id,actor_id,action,request_hash,result) values(p_request,ph.id,auth.uid(),p_action,hash,result||jsonb_build_object('before',to_jsonb(before_ph),'after',to_jsonb(ph)));
 return result;
end $$;
revoke all on function public.phase_command(uuid,uuid,uuid,integer,text,jsonb) from public,anon;
grant execute on function public.phase_command(uuid,uuid,uuid,integer,text,jsonb) to authenticated;

create or replace function scorekeeper_private.match_command_before_phases(p_id uuid,p_token uuid,p_revision integer,p_request uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare m public."tTraditionalMatch"; before_m public."tTraditionalMatch"; preset public."tMatchPreset"; op public."tMatchOperation"; target public."tMatchOperation";
 ls integer;rs integer;ld integer=0;rd integer=0; amount integer; side text; winner text; result text; hash text; meta jsonb; cid uuid;
begin
 if not scorekeeper_private.can_use() then raise exception 'Active account required'; end if;
 select * into m from public."tTraditionalMatch" where id=p_id for update;
 if not found or m.is_archived or m.is_void then raise exception 'Match unavailable'; end if;
 if m.referee_id is distinct from auth.uid() or m.lease_token is distinct from md5(p_token::text)::uuid then raise exception 'Claim this match before editing'; end if;
 hash=md5(jsonb_build_object('action',p_action,'data',p_data)::text);
 select * into op from public."tMatchOperation" where id=p_request;
 if found then
  if op.match_id<>m.id or op.actor_id<>auth.uid() or op.request_hash<>hash then raise exception 'Request identity cannot be reassigned'; end if;
  return jsonb_build_object('revision',m.revision,'id',m.id);
 end if;
 if m.lease_until<=now() then raise exception 'Referee claim expired; explicitly recover'; end if;
 if m.revision<>p_revision then raise exception 'Match changed on another device. Reload before saving.'; end if;
 if m.event_id is not null and not exists(select 1 from public."tEvent" where id=m.event_id and status='active') then raise exception 'Reopen this event before changing its matches'; end if;
 before_m=m;
 perform set_config('scorekeeper.claim',m.lease_token::text,true);
 perform set_config('scorekeeper.operation','v2',true);
 select left_score,right_score into ls,rs from public."vMatchResults" where id=m.id;
 meta=p_data || jsonb_build_object('before',to_jsonb(m)-'lease_token');
 m.ledger_enabled=true;
 if p_action='prepare' then
  if m.started_at is not null or m.finalized_at is not null then raise exception 'Participants are locked'; end if;
  if m.event_id is null then
   m.left_fencer_id=(p_data->>'leftFencerId')::uuid;m.right_fencer_id=(p_data->>'rightFencerId')::uuid;
   m.left_name=btrim(p_data->>'leftName');m.right_name=btrim(p_data->>'rightName');
   m.match_type=coalesce(p_data->>'matchType','standard');
  else
   m.match_type=case when m.phase_settings_snapshot is not null then m.match_type when m.group_id is null and (m.bracket_id is not null or exists(select 1 from public."tEventPhase" where id=m.phase_id and kind in('single','double'))) then 'knockout' else 'standard' end;
  end if;
  if m.phase_id is not null then select name into m.phase_name_snapshot from public."tEventPhase" where id=m.phase_id;end if;
  m.duration_ms=(p_data->>'durationMs')::integer;m.remaining_ms=m.duration_ms;
  m.target_score=(p_data->>'targetScore')::integer;m.preset_id=(p_data->>'presetId')::uuid;
  if m.preset_id is not null then
   if m.phase_settings_snapshot is not null and m.preset_id=before_m.preset_id then
    if m.duration_ms<>(m.phase_settings_snapshot->>'duration_ms')::int or m.target_score is distinct from (m.phase_settings_snapshot->>'target_score')::int or m.match_type<>m.phase_settings_snapshot->>'match_type' then raise exception 'Phase settings are locked; choose Custom for an explicit match override';end if;
    meta=meta||jsonb_build_object('presetSnapshot',m.phase_settings_snapshot);
   else
   select * into preset from public."tMatchPreset" where id=m.preset_id and mode='traditional' and not is_archived for share;
   if not found then raise exception 'Choose an active Traditional preset';end if;
   if m.event_id is not null and preset.match_type<>m.match_type then raise exception 'Preset Match Type conflicts with the event phase; choose a compatible preset or Custom';end if;
   if m.duration_ms<>preset.duration_ms or m.target_score is distinct from preset.target_score or (m.event_id is null and m.match_type<>preset.match_type) then raise exception 'Preset settings changed; reload the preset or choose Custom';end if;
   meta=meta||jsonb_build_object('presetSnapshot',to_jsonb(preset));
   end if;
  end if;
  if m.event_id is not null then m.round_name=coalesce(p_data->>'roundName',m.round_name);end if;
  select key_mappings,overtime_ms into m.key_snapshot,m.overtime_ms from public."tConfiguration" where id;
  m.phase='paused';
 elsif p_action='start' then
  if m.phase='running' or m.finalized_at is not null or m.remaining_ms<=0 then raise exception 'Match cannot start; use Admin Mode to correct it'; end if;
  m.started_at=coalesce(m.started_at,now());m.phase='running';m.clock_deadline=now()+m.remaining_ms*interval '1 millisecond';
 elsif p_action in('pause','checkpoint','expire') then
  if m.phase='running' then
   m.remaining_ms=case when m.clock_deadline is null then m.remaining_ms else greatest(0,ceil(extract(epoch from(m.clock_deadline-now()))*1000))::integer end;
   if p_action='expire' and m.remaining_ms>0 then raise exception 'Clock has not expired'; end if;
   if p_action<>'checkpoint' or m.remaining_ms=0 then m.phase='paused';m.clock_deadline=null; end if;
  elsif p_action='expire' then raise exception 'Clock is not running';
  end if;
 elsif p_action in('score','penalty','reverse','admin','complete','incomplete') then
  if m.phase='running' then raise exception 'Pause before scoring or changing the match'; end if;
  if p_action in('score','penalty') then
   if m.finalized_at is not null then raise exception 'Use Admin Mode to reopen or correct a completed match'; end if;
   side=p_data->>'side';amount=(p_data->>'points')::integer;
   if side is null or side not in('left','right') or amount is null then raise exception 'Choose a side and points'; end if;
   m.started_at=coalesce(m.started_at,now());
   if p_action='score' then
    if not ((amount=1 and p_data->>'type'='indirect') or (amount=3 and p_data->>'type'='clean') or (amount=5 and p_data->>'type'='counter')) then raise exception 'Invalid quick score'; end if;
    cid=p_request;
    insert into public."tTraditionalCall"(id,match_id,side,call_type,points,match_time_ms,recorded_at) values(cid,m.id,side,p_data->>'type',amount,m.remaining_ms,now());
    meta=meta||jsonb_build_object('callId',cid);
    if side='left' then ls=ls+amount;else rs=rs+amount;end if;
   else
    if p_data->>'card' is null or p_data->>'reason' is null or p_data->>'card' not in('Yellow','Red','Black','Double Black') or amount not between 0 and 10000 or not exists(select 1 from public."tConfiguration" c,jsonb_array_elements_text(c.penalty_reasons) reason where reason=p_data->>'reason') then raise exception 'Choose a configured reason, card and valid points';end if;
    -- side identifies the SANCTIONED fencer, so credit the opposite side.
    if side='left' then rd=amount;else ld=amount;end if;
    meta=meta||jsonb_build_object('sanctionedFencerId',case when side='left' then m.left_fencer_id else m.right_fencer_id end,'eventId',m.event_id,'creditedSide',case when side='left' then 'right' else 'left' end);
   end if;
  elsif p_action='reverse' then
   select * into target from public."tMatchOperation" where id=(p_data->>'operationId')::uuid and match_id=m.id;
   if not found or target.kind not in('score','penalty','admin') or exists(select 1 from public."tMatchOperation" where match_id=m.id and kind='reverse' and data->>'operationId'=target.id::text) then raise exception 'Operation cannot be reversed'; end if;
   if target.kind='score' then
    update public."tTraditionalCall" set is_reversed=true where id=(target.data->>'callId')::uuid and not is_reversed;
    if not found then raise exception 'Call already reversed';end if;
    if target.data->>'side'='left' then ls=ls-(target.data->>'points')::int;else rs=rs-(target.data->>'points')::int;end if;
   else ld=-target.left_delta;rd=-target.right_delta;end if;
  elsif p_action='admin' then
   -- Region-specific corrections retain every omitted value, including official outcome.
   if p_data ? 'leftScore' then
    if p_data->>'leftScore' is null or (p_data->>'leftScore')::int not between 0 and 30000 then raise exception 'Scores out of bounds';end if;
    ld=(p_data->>'leftScore')::int-ls;
   end if;
   if p_data ? 'rightScore' then
    if p_data->>'rightScore' is null or (p_data->>'rightScore')::int not between 0 and 30000 then raise exception 'Scores out of bounds';end if;
    rd=(p_data->>'rightScore')::int-rs;
   end if;
   if ld<>0 or rd<>0 then m.started_at=coalesce(m.started_at,now());end if;
   if p_data ? 'remainingMs' then
    if p_data->>'remainingMs' is null then raise exception 'Remaining time required';end if;
    m.remaining_ms=(p_data->>'remainingMs')::int;
   end if;
   if p_data ? 'targetScore' then m.target_score=(p_data->>'targetScore')::int;end if;
   if p_data ? 'outcome' then
    if coalesce(p_data->>'outcome','') not in('','left','right','draw','incomplete') then raise exception 'Invalid outcome';end if;
    m.result_override=case when p_data->>'outcome'='incomplete' then null else nullif(p_data->>'outcome','') end;
    if p_data->>'outcome' in('left','right','draw') then
     m.started_at=coalesce(m.started_at,now());m.phase='ended';m.end_reason='manual';m.ended_at=coalesce(m.ended_at,now());m.finalized_at=coalesce(m.finalized_at,now());
     meta=meta||jsonb_build_object('scoreDerivedWinner',case when ls+ld>rs+rd then 'left' when rs+rd>ls+ld then 'right' else 'draw' end);
    end if;
   end if;
   if p_data->>'outcome'='incomplete' or p_data->>'resume'='true' then m.phase='paused';m.finalized_at=null;m.ended_at=null;m.end_reason=null;end if;
   if row(ld,rd,m.remaining_ms,m.target_score,m.result_override,m.phase,m.finalized_at) is not distinct from row(0,0,before_m.remaining_ms,before_m.target_score,before_m.result_override,before_m.phase,before_m.finalized_at) then
    return jsonb_build_object('revision',m.revision,'id',m.id);
   end if;
  elsif p_action='complete' then
   m.started_at=coalesce(m.started_at,now());m.phase='ended';m.end_reason='manual';m.ended_at=now();m.finalized_at=now();
  elsif p_action='incomplete' then
   m.phase='paused';m.finalized_at=null;m.ended_at=null;m.end_reason=null;m.result_override=null;
  end if;
 else raise exception 'Unknown match operation';
 end if;
 if m.phase<>'running' then m.clock_deadline=null;end if;
 ls=ls+ld;rs=rs+rd;
 if ls<0 or rs<0 or ld is null or rd is null then raise exception 'Correction would make a score negative or invalid';end if;
 -- Limit overtime edits to its configured maximum; normal remaining time may exceed the original preset.
 if m.is_overtime and m.remaining_ms>m.overtime_ms then raise exception 'Overtime is capped at its configured duration';end if;
 if m.remaining_ms<0 or m.remaining_ms>10800000 then raise exception 'Remaining time must be between zero and three hours';end if;
 if p_action not in('prepare','incomplete') and coalesce(p_data->>'outcome','')<>'incomplete' then
  if m.finalized_at is null and (m.remaining_ms=0 or (m.target_score is not null and greatest(ls,rs)>=m.target_score) or (m.is_overtime and ls<>rs and p_action in('score','penalty'))) then
   m.phase='ended';m.clock_deadline=null;m.end_reason=case when m.remaining_ms=0 then 'time' else 'target' end;m.ended_at=now();m.finalized_at=now();
   if m.match_type='knockout' and ls=rs and m.result_override is null and m.remaining_ms=0 and not m.is_overtime then
    m.is_overtime=true;m.remaining_ms=m.overtime_ms;m.phase='paused';m.finalized_at=null;m.ended_at=null;m.end_reason=null;
   end if;
  end if;
 end if;
 winner=case when m.result_override='draw' then null when m.result_override in('left','right') then m.result_override when ls>rs then 'left' when rs>ls then 'right' else null end;
 if m.match_type='knockout' and winner is null and m.finalized_at is not null then m.finalized_at=null;m.phase='ended';end if;
 m.winner_side=winner;
 -- Correcting upstream winners must not silently reassign participants in played descendants.
 if before_m.finalized_at is not null and (before_m.winner_side is distinct from m.winner_side or m.finalized_at is null) and m.bracket_id is not null and exists(
 with recursive descendants(slot) as (
 select n->>'key' from public."tBracket" b,jsonb_array_elements(b.graph->'nodes') n where b.id=m.bracket_id and (n->'left'->>'match'=m.slot_key or n->'right'->>'match'=m.slot_key)
 union
 select n->>'key' from descendants d,public."tBracket" b,jsonb_array_elements(b.graph->'nodes') n where b.id=m.bracket_id and (n->'left'->>'match'=d.slot or n->'right'->>'match'=d.slot)
 ) select 1 from public."tTraditionalMatch" x where x.bracket_id=m.bracket_id and x.slot_key in(select slot from descendants) and x.started_at is not null) then raise exception 'Played bracket matches depend on this result. Reconcile or regenerate the bracket first.'; end if;
 update public."tTraditionalMatch" set left_fencer_id=m.left_fencer_id,right_fencer_id=m.right_fencer_id,left_name=m.left_name,right_name=m.right_name,round_name=m.round_name,
 phase_name_snapshot=m.phase_name_snapshot,preset_id=m.preset_id,duration_ms=m.duration_ms,remaining_ms=m.remaining_ms,target_score=m.target_score,phase=m.phase,end_reason=m.end_reason,started_at=m.started_at,ended_at=m.ended_at,
 finalized_at=m.finalized_at,winner_side=m.winner_side,result_override=m.result_override,match_type=m.match_type,is_overtime=m.is_overtime,overtime_ms=m.overtime_ms,clock_deadline=m.clock_deadline,
 ledger_enabled=true,key_snapshot=m.key_snapshot,lease_until=now()+interval '90 seconds',updated_at=now() where id=m.id returning * into m;
 insert into public."tMatchOperation"(id,match_id,sequence,actor_id,kind,left_delta,right_delta,left_after,right_after,data,request_hash)
 values(p_request,m.id,m.revision,auth.uid(),p_action,ld,rd,ls,rs,meta||jsonb_build_object('after',to_jsonb(m)-'lease_token'),hash);
 return jsonb_build_object('revision',m.revision,'id',m.id);
end $$;

revoke all on function scorekeeper_private.match_command_before_phases(uuid,uuid,integer,uuid,text,jsonb) from public,anon;
grant execute on function scorekeeper_private.match_command_before_phases(uuid,uuid,integer,uuid,text,jsonb) to authenticated;
create or replace function public.match_command(p_id uuid,p_token uuid,p_revision integer,p_request uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare m public."tTraditionalMatch";result jsonb;begin
 if not scorekeeper_private.can_use() then raise exception 'Active account required';end if;
 select * into m from public."tTraditionalMatch" where id=p_id;
 if m.event_id is not null then perform 1 from public."tEvent" where id=m.event_id for update;end if;
 if m.phase_id is not null then perform 1 from public."tEventPhase" where id=m.phase_id for update;end if;
 if m.bracket_id is not null then perform 1 from public."tBracket" where id=m.bracket_id for update;end if;
 if not m.schedule_ready and p_action in('prepare','start','score','penalty','complete','admin') then raise exception 'Waiting for earlier bracket results';end if;
 result=scorekeeper_private.match_command_before_phases(p_id,p_token,p_revision,p_request,p_action,p_data);
 if m.bracket_id is not null and exists(select 1 from public."tEventPhase" where id=m.phase_id and workflow_enabled) and exists(select 1 from public."tEvent" where id=m.event_id and status<>'completed') then perform public.sync_bracket(m.bracket_id);end if;
 return result;
end $$;
revoke all on function public.match_command(uuid,uuid,integer,uuid,text,jsonb) from public,anon;
grant execute on function public.match_command(uuid,uuid,integer,uuid,text,jsonb) to authenticated;

create or replace view public."vMatchResults" with(security_invoker=true) as
select m.id,m.owner_id,m.event_name,m.round_name,m.left_fencer_id,m.right_fencer_id,m.left_name,m.right_name,m.duration_ms,m.remaining_ms,m.target_score,m.phase,m.end_reason,m.created_at,m.started_at,m.ended_at,m.updated_at,m.mode,m.event_id,m.preset_id,m.phase_id,m.group_id,m.bracket_id,m.slot_key,m.is_archived,m.is_void,m.revision,m.referee_id,m.lease_token,m.lease_until,m.winner_side,m.finalized_at,coalesce(l.display_name,m.left_name) current_left_name,coalesce(r.display_name,m.right_name) current_right_name,
 coalesce(s.left_score,0) left_score,coalesce(s.right_score,0) right_score,
 case when m.finalized_at is null or m.is_void or m.is_archived then 'incomplete'
 when coalesce(s.left_score,0)=coalesce(s.right_score,0) and m.winner_side is null and m.match_type='standard' then 'draw'
 when m.result_override='draw' then 'draw'
 when coalesce(s.left_score,0)=coalesce(s.right_score,0) and m.winner_side is null then 'incomplete' else 'result' end outcome,m.match_type,m.is_overtime,m.overtime_ms,m.clock_deadline,m.result_override,m.ledger_enabled,m.key_snapshot,clock_timestamp() server_now,m.match_sequence,m.schedule_ready,m.is_bye,m.phase_name_snapshot,m.phase_settings_snapshot,coalesce((select name from public."tEventPhase" where id=m.phase_id),m.phase_name_snapshot) phase_name
from public."tTraditionalMatch" m
left join public."tFencer" l on l.id=m.left_fencer_id and not l.is_unregistered
left join public."tFencer" r on r.id=m.right_fencer_id and not r.is_unregistered
left join (select match_id,sum(ld)::bigint left_score,sum(rd)::bigint right_score from (
select match_id,case when side='left' then points else 0 end ld,case when side='right' then points else 0 end rd from public."tTraditionalCall" where not is_reversed
union all select match_id,left_delta,right_delta from public."tMatchOperation") all_scores group by match_id) s on s.match_id=m.id;

create view public."vEventPhases" with(security_invoker=true) as
 select p.*,coalesce(p.preset_snapshot->>'name','Preset Required') preset_name,
 coalesce(p.preset_snapshot->>'match_type',case when p.kind='group' then 'standard' else 'knockout' end) match_type,
 (p.preset_snapshot->>'duration_ms')::int duration_ms,(p.preset_snapshot->>'target_score')::int target_score,
 (select count(*)::int from public."tPhaseRegistration" where phase_id=p.id) participant_count,
 coalesce(s.total,0)::int match_count,coalesce(s.done,0)::int completed_count,
 case when coalesce(s.total,0)=0 then 'empty' when s.done=s.total then 'complete' when s.started>0 then 'active' else 'scheduled' end state
 from public."tEventPhase" p left join lateral(
 select count(*) total,count(*) filter(where m.finalized_at is not null and m.outcome in('result','draw')) done,
 count(*) filter(where m.started_at is not null or m.finalized_at is not null) started
 from public."vMatchResults" m where m.phase_id=p.id and not m.is_archived and not m.is_void
 ) s on true;
grant select on public."vEventPhases" to authenticated;

create function public.phase_standings(p_phase uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 with totals as(
 select f.id,f.display_name,coalesce(sum(r.wins),0) wins,coalesce(sum(r.losses),0) losses,coalesce(sum(r.draws),0) draws,count(r.match_id) matches,coalesce(sum(r.points_for),0) points_for,coalesce(sum(r.points_for-r.points_against),0) differential
 from public."tPhaseRegistration" pr join public."tFencer" f on f.id=pr.fencer_id
 left join (select r.* from public."vFencerResults" r join public."vMatchResults" m on m.id=r.match_id where m.phase_id=p_phase) r on r.fencer_id=f.id
 where pr.phase_id=p_phase group by f.id
 ),ranked as(select t.*,(select jsonb_agg(case k.value #>> '{}' when 'differential' then t.differential when 'points_for' then t.points_for else 0 end order by k.ordinality) from public."tConfiguration" c,jsonb_array_elements(c.tiebreakers) with ordinality k where c.id) tie_values from totals t)
 select coalesce(jsonb_agg(to_jsonb(r) order by wins desc,tie_values desc nulls last,display_name,id),'[]'::jsonb) from ranked r;
$$;
revoke all on function public.phase_standings(uuid) from public,anon;
grant execute on function public.phase_standings(uuid) to authenticated;
alter table public."tEventFinalization" add column phase_snapshot jsonb not null default '[]';
create function scorekeeper_private.freeze_phases() returns trigger language plpgsql set search_path='' as $$
begin
 select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('participants',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('name',f.display_name)),'[]') from public."tPhaseRegistration" r join public."tFencer" f on f.id=r.fencer_id where r.phase_id=p.id),'standings',public.phase_standings(p.id),'brackets',(select coalesce(jsonb_agg(to_jsonb(b)),'[]') from public."tBracket" b where b.phase_id=p.id and not b.is_archived),'matches',(select coalesce(jsonb_agg(to_jsonb(m)),'[]') from public."vMatchResults" m where m.phase_id=p.id and not m.is_archived)) order by p.position,p.id),'[]') into new.phase_snapshot from public."vEventPhases" p where p.event_id=new.event_id and not p.is_archived;
 return new;
end $$;
create trigger freeze_phases before insert on public."tEventFinalization" for each row execute function scorekeeper_private.freeze_phases();
create or replace function public.void_match(p_id uuid) returns void language plpgsql security invoker set search_path='' as $$
declare m public."tTraditionalMatch";begin
 if not scorekeeper_private.can_use() then raise exception 'Active account required';end if;
 select * into m from public."tTraditionalMatch" where id=p_id;
 perform 1 from public."tEvent" where id=m.event_id for update;
 perform 1 from public."tEventPhase" where id=m.phase_id for update;
 perform 1 from public."tBracket" where id=m.bracket_id for update;
 select * into m from public."tTraditionalMatch" where id=p_id for update;
 if not found then raise exception 'Match not found';end if;
 if m.is_archived or m.is_bye then raise exception 'Match is read only';end if;
 if m.lease_until>now() or m.phase='running' then raise exception 'Pause and release the active referee claim before voiding';end if;
 perform set_config('scorekeeper.claim',coalesce(m.lease_token::text,''),true);
 update public."tTraditionalMatch" set is_void=true where id=p_id;
 if m.bracket_id is not null and exists(select 1 from public."tEventPhase" where id=m.phase_id and workflow_enabled) and exists(select 1 from public."tEvent" where id=m.event_id and status<>'completed') then perform public.sync_bracket(m.bracket_id);end if;
end $$;

create or replace function scorekeeper_private.validate_match() returns trigger language plpgsql set search_path='' as $$
declare unreg uuid; e public."tEvent"; begin
 select id into unreg from public."tFencer" where is_unregistered;
 if new.left_fencer_id=new.right_fencer_id and new.left_fencer_id<>unreg then raise exception 'Select two different registered fencers'; end if;
 if new.event_id is not null then
  select * into e from public."tEvent" where id=new.event_id;
  if e.mode<>'traditional' or e.competition_format<>'individual' then raise exception 'This event format is not enabled'; end if;
  if e.status<>'active' and (tg_op='INSERT' or row(new.phase,new.left_fencer_id,new.right_fencer_id,new.is_archived,new.is_void) is distinct from row(old.phase,old.left_fencer_id,old.right_fencer_id,old.is_archived,old.is_void)) and not (e.status='draft' and new.phase='ready' and new.started_at is null and exists(select 1 from public."tEventPhase" where id=new.phase_id and workflow_enabled)) then raise exception 'Activate or reopen this event first'; end if;
  if new.left_fencer_id=unreg or new.right_fencer_id=unreg then raise exception 'Event competitors must be registered'; end if;
  if exists(select 1 from unnest(array[new.left_fencer_id,new.right_fencer_id]) f where f is not null and not exists(select 1 from public."tEventFencer" x where x.event_id=new.event_id and x.fencer_id=f)) then raise exception 'Competitor is not registered for this event'; end if;
 end if;
 if new.phase='running' or new.started_at is not null then
  if new.left_fencer_id is null or new.right_fencer_id is null then raise exception 'Both competitors are required'; end if;
 end if;
 if tg_op='UPDATE' and (old.lease_until>now() or old.started_at is not null) and new.lease_token is not distinct from old.lease_token and current_setting('scorekeeper.claim',true) is distinct from coalesce(old.lease_token::text,'') then raise exception 'Claim this match before editing'; end if;
 if tg_op='UPDATE' then new.revision=old.revision+1; end if;
 return new;
end $$;
create or replace function scorekeeper_private.match_type_default() returns trigger language plpgsql set search_path='' as $$begin
 if new.phase_settings_snapshot is not null then new.match_type=new.phase_settings_snapshot->>'match_type';
 elsif new.group_id is null and (new.bracket_id is not null or exists(select 1 from public."tEventPhase" where id=new.phase_id and kind in('single','double'))) then new.match_type='knockout';end if;
 return new;
end $$;

-- Initialize readiness/byes for live legacy graphs before any new client can claim an unresolved slot.
-- Frozen/archived graphs retain their original historical rows. Conflicts abort for reconciliation.
do $$ declare b record;begin
 for b in select x.id from public."tBracket" x join public."tEventPhase" p on p.id=x.phase_id join public."tEvent" e on e.id=p.event_id where not x.is_archived and e.status in('draft','active') order by e.id,p.id,x.id loop
  perform public.sync_bracket(b.id);
 end loop;
end $$;
