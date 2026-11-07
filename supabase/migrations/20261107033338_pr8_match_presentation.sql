-- PR #8: additive preset type, calendar dates, and partial audited Admin corrections.
-- Existing presets deterministically become Standard. Bracket/phase type stays authoritative.
alter table public."tMatchPreset" add column match_type text not null default 'standard' check(match_type in('standard','knockout'));
-- Keep original timestamp columns intact for provenance and old read-only clients.
-- Previous editors explicitly labeled UTC: project those dates in UTC, never session/browser time.
alter table public."tEvent" add column start_date date, add column end_date date;
update public."tEvent" set start_date=(starts_at at time zone 'UTC')::date,end_date=(ends_at at time zone 'UTC')::date;
-- Retain inconsistent legacy dates for explicit repair; reject invalid new/changed dates.
create function scorekeeper_private.event_calendar_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if (tg_op='INSERT' or new.start_date is distinct from old.start_date or new.end_date is distinct from old.end_date)
  and new.start_date is not null and new.end_date is not null and new.end_date<new.start_date then raise exception 'End Date must not be before Start Date';end if;
 return new;
end $$;
create trigger event_calendar_guard before insert or update on public."tEvent" for each row execute function scorekeeper_private.event_calendar_guard();
grant update(start_date,end_date) on public."tEvent" to authenticated;
-- Existing RLS and audit triggers apply to both additive changes.
create or replace function public.match_command(p_id uuid,p_token uuid,p_revision integer,p_request uuid,p_action text,p_data jsonb default '{}') returns jsonb
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
   m.match_type=case when m.group_id is null and (m.bracket_id is not null or exists(select 1 from public."tEventPhase" where id=m.phase_id and kind in('single','double'))) then 'knockout' else 'standard' end;
  end if;
  m.duration_ms=(p_data->>'durationMs')::integer;m.remaining_ms=m.duration_ms;
  m.target_score=(p_data->>'targetScore')::integer;m.preset_id=(p_data->>'presetId')::uuid;
  if m.preset_id is not null then
   select * into preset from public."tMatchPreset" where id=m.preset_id and mode='traditional' and not is_archived for share;
   if not found then raise exception 'Choose an active Traditional preset';end if;
   if m.event_id is not null and preset.match_type<>m.match_type then raise exception 'Preset Match Type conflicts with the event phase; choose a compatible preset or Custom';end if;
   if m.duration_ms<>preset.duration_ms or m.target_score is distinct from preset.target_score or (m.event_id is null and m.match_type<>preset.match_type) then raise exception 'Preset settings changed; reload the preset or choose Custom';end if;
   meta=meta||jsonb_build_object('presetSnapshot',to_jsonb(preset));
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
 preset_id=m.preset_id,duration_ms=m.duration_ms,remaining_ms=m.remaining_ms,target_score=m.target_score,phase=m.phase,end_reason=m.end_reason,started_at=m.started_at,ended_at=m.ended_at,
 finalized_at=m.finalized_at,winner_side=m.winner_side,result_override=m.result_override,match_type=m.match_type,is_overtime=m.is_overtime,overtime_ms=m.overtime_ms,clock_deadline=m.clock_deadline,
 ledger_enabled=true,key_snapshot=m.key_snapshot,lease_until=now()+interval '90 seconds',updated_at=now() where id=m.id returning * into m;
 insert into public."tMatchOperation"(id,match_id,sequence,actor_id,kind,left_delta,right_delta,left_after,right_after,data,request_hash)
 values(p_request,m.id,m.revision,auth.uid(),p_action,ld,rd,ls,rs,meta||jsonb_build_object('after',to_jsonb(m)-'lease_token'),hash);
 return jsonb_build_object('revision',m.revision,'id',m.id);
end $$;
revoke all on function public.match_command(uuid,uuid,integer,uuid,text,jsonb) from public,anon;
grant execute on function public.match_command(uuid,uuid,integer,uuid,text,jsonb) to authenticated;
