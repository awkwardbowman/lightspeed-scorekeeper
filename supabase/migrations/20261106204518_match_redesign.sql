-- Additive operation ledger. Existing calls and match-time preset provenance survive.
alter table public."tTraditionalMatch"
 add column match_type text not null default 'standard' check(match_type in('standard','knockout')),
 add column is_overtime boolean not null default false,
 add column overtime_ms integer not null default 60000 check(overtime_ms between 1000 and 60000),
 add column clock_deadline timestamptz,
 add column result_override text check(result_override in('left','right','draw')),
 add column ledger_enabled boolean not null default false,
 add column key_snapshot jsonb not null default '{}';
create or replace function scorekeeper_private.validate_match() returns trigger language plpgsql set search_path='' as $$
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
 if tg_op='UPDATE' and (old.lease_until>now() or old.started_at is not null) and new.lease_token is not distinct from old.lease_token and current_setting('scorekeeper.claim',true) is distinct from coalesce(old.lease_token::text,'') then raise exception 'Claim this match before editing'; end if;
 if tg_op='UPDATE' then new.revision=old.revision+1; end if;
 return new;
end $$;

do $$ declare r record;begin for r in select id,lease_token from public."tTraditionalMatch" where bracket_id is not null and group_id is null loop perform set_config('scorekeeper.claim',coalesce(r.lease_token::text,''),true);update public."tTraditionalMatch" set match_type='knockout' where id=r.id;end loop;end $$;
-- Preserve old meaning of duration_ms. Remaining-time corrections may exceed it.
alter table public."tTraditionalMatch" drop constraint match_bounds;
alter table public."tTraditionalMatch" add constraint match_bounds check(duration_ms between 1000 and 10800000 and remaining_ms between 0 and 10800000 and (target_score is null or target_score between 1 and 10000)) not valid;
alter table public."tConfiguration" add column penalty_reasons jsonb not null default '["Safety","Power"]', add column overtime_ms integer not null default 60000 check(overtime_ms between 1000 and 60000);
alter table public."tConfiguration" add constraint penalty_reasons_valid check(jsonb_typeof(penalty_reasons)='array' and jsonb_array_length(penalty_reasons) between 1 and 40);
create table public."tMatchOperation"(
 id uuid primary key, match_id uuid not null references public."tTraditionalMatch"(id),
 sequence integer not null, actor_id uuid not null references public."tUser"(id), recorded_at timestamptz not null default now(),
 kind text not null, left_delta integer not null default 0, right_delta integer not null default 0,
 left_after integer not null check(left_after>=0), right_after integer not null check(right_after>=0),
 data jsonb not null default '{}', request_hash text not null, unique(match_id,sequence)
);
create index match_operation_order on public."tMatchOperation"(match_id,sequence);
alter table public."tMatchOperation" enable row level security;
grant select,insert on public."tMatchOperation" to authenticated;
grant all on public."tMatchOperation" to service_role;
create policy operation_read on public."tMatchOperation" for select to authenticated using ((select scorekeeper_private.can_use()));
create policy operation_append on public."tMatchOperation" for insert to authenticated with check ((select scorekeeper_private.can_use()) and actor_id=auth.uid());
-- Legacy calls retain their actual audit history; unavailable original post-call totals are explicitly labeled.
insert into public."tMatchOperation"(id,match_id,sequence,actor_id,recorded_at,kind,left_after,right_after,data,request_hash)
 select c.id,c.match_id,(-100000+row_number() over(partition by c.match_id order by c.recorded_at,c.id))::integer,
 coalesce((select a.actor_id from public."tAudit" a where a.record_id=c.id::text and a.action='INSERT' order by a.recorded_at limit 1),m.owner_id),
 c.recorded_at,'score',0,0,jsonb_build_object('callId',c.id,'side',c.side,'type',c.call_type,'points',c.points,'legacy',true,'isReversed',c.is_reversed,'snapshotUnavailable',true,'legacyReversal',(select jsonb_build_object('actor',a.actor_id,'recordedAt',a.recorded_at) from public."tAudit" a where a.record_id=c.id::text and a.new_value->>'is_reversed'='true' order by a.recorded_at desc limit 1)),'legacy'
 from public."tTraditionalCall" c join public."tTraditionalMatch" m on m.id=c.match_id;
create trigger operation_guard before insert or update or delete on public."tMatchOperation" for each row execute function scorekeeper_private.guard_call();
-- No UPDATE/DELETE grants or policies: a reversal is a new event.
create trigger operation_audit after insert on public."tMatchOperation" for each row execute function scorekeeper_private.audit();

-- Keep existing column order/types so dependent security-invoker views survive.
create or replace view public."vMatchResults" with(security_invoker=true) as
select m.id,m.owner_id,m.event_name,m.round_name,m.left_fencer_id,m.right_fencer_id,m.left_name,m.right_name,m.duration_ms,m.remaining_ms,m.target_score,m.phase,m.end_reason,m.created_at,m.started_at,m.ended_at,m.updated_at,m.mode,m.event_id,m.preset_id,m.phase_id,m.group_id,m.bracket_id,m.slot_key,m.is_archived,m.is_void,m.revision,m.referee_id,m.lease_token,m.lease_until,m.winner_side,m.finalized_at,coalesce(l.display_name,m.left_name) current_left_name,coalesce(r.display_name,m.right_name) current_right_name,
 coalesce(s.left_score,0) left_score,coalesce(s.right_score,0) right_score,
 case when m.finalized_at is null or m.is_void or m.is_archived then 'incomplete'
 when coalesce(s.left_score,0)=coalesce(s.right_score,0) and m.winner_side is null and m.match_type='standard' then 'draw'
 when m.result_override='draw' then 'draw'
 when coalesce(s.left_score,0)=coalesce(s.right_score,0) and m.winner_side is null then 'incomplete' else 'result' end outcome,m.match_type,m.is_overtime,m.overtime_ms,m.clock_deadline,m.result_override,m.ledger_enabled,m.key_snapshot,clock_timestamp() server_now
from public."tTraditionalMatch" m
left join public."tFencer" l on l.id=m.left_fencer_id and not l.is_unregistered
left join public."tFencer" r on r.id=m.right_fencer_id and not r.is_unregistered
left join (select match_id,sum(ld)::bigint left_score,sum(rd)::bigint right_score from (
select match_id,case when side='left' then points else 0 end ld,case when side='right' then points else 0 end rd from public."tTraditionalCall" where not is_reversed
union all select match_id,left_delta,right_delta from public."tMatchOperation") all_scores group by match_id) s on s.match_id=m.id;

create function public.match_command(p_id uuid,p_token uuid,p_revision integer,p_request uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare m public."tTraditionalMatch"; before_m public."tTraditionalMatch"; op public."tMatchOperation"; target public."tMatchOperation";
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
   m.match_type=case when m.group_id is null and (m.bracket_id is not null or exists(select 1 from public."tEventPhase" where id=m.phase_id and kind in('single','double'))) then 'knockout' else 'standard' end;
  end if;
  m.duration_ms=(p_data->>'durationMs')::integer;m.remaining_ms=m.duration_ms;
  m.target_score=(p_data->>'targetScore')::integer;m.preset_id=(p_data->>'presetId')::uuid;
  m.round_name=coalesce(p_data->>'roundName',m.round_name);
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
   if (p_data->>'leftScore')::int<0 or (p_data->>'rightScore')::int<0 or (p_data->>'leftScore')::int>30000 or (p_data->>'rightScore')::int>30000 then raise exception 'Scores out of bounds';end if;
   ld=(p_data->>'leftScore')::int-ls;rd=(p_data->>'rightScore')::int-rs;
   if ld<>0 or rd<>0 then m.started_at=coalesce(m.started_at,now());end if;
   m.remaining_ms=(p_data->>'remainingMs')::int;m.target_score=(p_data->>'targetScore')::int;
   m.result_override=case when p_data->>'outcome'='incomplete' then null else nullif(p_data->>'outcome','') end;
   if p_data->>'outcome'='incomplete' then m.phase='paused';m.finalized_at=null;m.ended_at=null;m.end_reason=null;end if;
   if p_data->>'resume'='true' then m.phase='paused';m.finalized_at=null;m.ended_at=null;m.end_reason=null;end if;
  elsif p_action='complete' then
   m.started_at=coalesce(m.started_at,now());m.phase='ended';m.end_reason='manual';m.ended_at=now();m.finalized_at=now();
  elsif p_action='incomplete' then
   m.phase='paused';m.finalized_at=null;m.ended_at=null;m.end_reason=null;m.result_override=null;
  end if;
 else raise exception 'Unknown match operation';
 end if;
 ls=ls+ld;rs=rs+rd;
 if ls<0 or rs<0 or ld is null or rd is null then raise exception 'Correction would make a score negative or invalid';end if;
 -- Limit overtime edits to its configured maximum; normal remaining time may exceed the original preset.
 if m.is_overtime and m.remaining_ms>m.overtime_ms then raise exception 'Overtime is capped at its configured duration';end if;
 if m.remaining_ms<0 or m.remaining_ms>10800000 then raise exception 'Remaining time must be between zero and three hours';end if;
 if p_action not in('prepare','incomplete') and coalesce(p_data->>'outcome','')<>'incomplete' then
  if m.remaining_ms=0 or (m.target_score is not null and greatest(ls,rs)>=m.target_score) or (m.is_overtime and ls<>rs and p_action in('score','penalty')) then
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
 preset_id=m.preset_id,duration_ms=m.duration_ms,remaining_ms=m.remaining_ms,target_score=m.target_score,phase=m.phase,end_reason=m.end_reason,started_at=m.started_at,ended_at=m.ended_at,
 finalized_at=m.finalized_at,winner_side=m.winner_side,result_override=m.result_override,match_type=m.match_type,is_overtime=m.is_overtime,overtime_ms=m.overtime_ms,clock_deadline=m.clock_deadline,
 ledger_enabled=true,key_snapshot=m.key_snapshot,lease_until=now()+interval '90 seconds',updated_at=now() where id=m.id returning * into m;
 insert into public."tMatchOperation"(id,match_id,sequence,actor_id,kind,left_delta,right_delta,left_after,right_after,data,request_hash)
 values(p_request,m.id,m.revision,auth.uid(),p_action,ld,rd,ls,rs,meta||jsonb_build_object('after',to_jsonb(m)-'lease_token'),hash);
 return jsonb_build_object('revision',m.revision,'id',m.id);
end $$;
revoke all on function public.match_command(uuid,uuid,integer,uuid,text,jsonb) from public,anon;
grant execute on function public.match_command(uuid,uuid,integer,uuid,text,jsonb) to authenticated;
-- Old clients must not overwrite matches using the new ledger protocol.
alter function public.save_match(jsonb,jsonb,uuid,integer,boolean) rename to save_match_legacy;
create function public.save_match(p_match jsonb,p_calls jsonb,p_token uuid,p_revision integer,p_finalize boolean default false) returns jsonb language plpgsql security invoker set search_path='' as $$ begin
 if exists(select 1 from public."tTraditionalMatch" where id=(p_match->>'id')::uuid and ledger_enabled) then raise exception 'Reload to use the updated match controls';end if;
 return public.save_match_legacy(p_match,p_calls,p_token,p_revision,p_finalize);
end $$;
revoke all on function public.save_match(jsonb,jsonb,uuid,integer,boolean) from public,anon;
grant execute on function public.save_match(jsonb,jsonb,uuid,integer,boolean) to authenticated;
create or replace function scorekeeper_private.guard_lease() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.lease_token is not null or new.finalized_at is not null or new.started_at is not null or new.phase<>'ready' then raise exception 'New matches must be scheduled and unplayed'; end if;
 else
  if old.ledger_enabled and current_setting('scorekeeper.operation',true) is distinct from 'v2' and (to_jsonb(new)-array['lease_token','lease_until','referee_id','revision','updated_at','is_archived','is_void']) is distinct from (to_jsonb(old)-array['lease_token','lease_until','referee_id','revision','updated_at','is_archived','is_void']) then raise exception 'Use versioned match operations';end if;
  if current_setting('scorekeeper.claim',true) is distinct from coalesce(old.lease_token::text,'') then raise exception 'Use match claim/save operations'; end if;
 end if;
 return new;
end $$;
create or replace function scorekeeper_private.guard_call() returns trigger language plpgsql set search_path='' as $$
declare m public."tTraditionalMatch"; begin select * into m from public."tTraditionalMatch" where id=coalesce(new.match_id,old.match_id);
 if m.ledger_enabled and current_setting('scorekeeper.operation',true) is distinct from 'v2' then raise exception 'Use versioned match operations';end if;
 if tg_table_name='tMatchOperation' and current_setting('scorekeeper.operation',true) is distinct from 'v2' then raise exception 'Use versioned match operations';end if;
 if m.lease_token is null or current_setting('scorekeeper.claim',true) is distinct from m.lease_token::text then raise exception 'Use transactional match save'; end if;
 return coalesce(new,old); end $$;
create or replace function public.sync_bracket(p_bracket uuid) returns void language plpgsql security invoker set search_path='' as $$
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
    if (srcrow.finalized_at is null or srcrow.winner_side is null) and not srcrow.is_void then resolved=false;
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
create or replace view public."vFencerScoring" with(security_invoker=true) as
 select f.id fencer_id,case when m.event_id is null then 'standalone' else 'event' end scope,c.call_type,c.points::smallint points,count(*) calls,sum(c.points)::bigint total_points
 from public."vMatchResults" m join (
 select match_id,side,call_type,points::integer points from public."tTraditionalCall" where not is_reversed
 union all select match_id,'left',case when kind='penalty' then 'Card penalty' when kind='reverse' then 'Penalty / override reversal' else 'Admin override' end,left_delta from public."tMatchOperation" where left_delta<>0
 union all select match_id,'right',case when kind='penalty' then 'Card penalty' when kind='reverse' then 'Penalty / override reversal' else 'Admin override' end,right_delta from public."tMatchOperation" where right_delta<>0
 ) c on c.match_id=m.id join public."tFencer" f on f.id=case when c.side='left' then m.left_fencer_id else m.right_fencer_id end and not f.is_unregistered
 where m.outcome in('draw','result') and not m.is_archived and not m.is_void group by f.id,m.event_id is null,c.call_type,c.points;
-- Shared account lookup; editing remains restricted to the trusted account endpoint.
drop policy read_user on public."tUser";
create policy read_user on public."tUser" for select to authenticated using ((select scorekeeper_private.can_use()) or id=auth.uid());

create function scorekeeper_private.match_type_default() returns trigger language plpgsql set search_path='' as $$begin
 if new.group_id is null and (new.bracket_id is not null or exists(select 1 from public."tEventPhase" where id=new.phase_id and kind in('single','double'))) then new.match_type='knockout';end if;return new;end $$;
create trigger a_match_type before insert on public."tTraditionalMatch" for each row execute function scorekeeper_private.match_type_default();

create function scorekeeper_private.validate_match_configuration() returns trigger language plpgsql set search_path='' as $$begin
 if exists(select 1 from jsonb_array_elements(new.penalty_reasons) r where jsonb_typeof(r)<>'string' or length(btrim(r#>>'{}')) not between 1 and 80) or (select count(*)<>count(distinct r) from jsonb_array_elements(new.penalty_reasons) r) then raise exception 'Use unique nonblank penalty reasons up to 80 characters';end if;return new;end $$;
create trigger validate_match_configuration before update on public."tConfiguration" for each row execute function scorekeeper_private.validate_match_configuration();

-- Legacy running snapshots have no trusted deadline. Recover them paused, preserving recorded remaining time.
do $$ declare r record;begin for r in select id,lease_token from public."tTraditionalMatch" where phase='running' and not ledger_enabled loop perform set_config('scorekeeper.claim',coalesce(r.lease_token::text,''),true);update public."tTraditionalMatch" set phase='paused' where id=r.id;end loop;end $$;
