-- Team instances are the sole editable team/event/roster model. Legacy link
-- tables remain readable evidence and are never rewritten or dropped.
begin;
drop trigger validate_relation on public."tTeam";
create table public."tTeamIdentity" (
 id uuid primary key default gen_random_uuid(),
 created_at timestamptz not null default now(),
 owner_id uuid not null references public."tUser"(id)
);
create table public."tImageAsset" (
 id uuid primary key,
 storage_bucket text not null default 'image-library' check(storage_bucket='image-library'),
 storage_object_path text not null unique,
 display_name text not null check(length(btrim(display_name)) between 1 and 160),
 mime_type text not null check(mime_type='image/webp'),
 width integer not null check(width between 1 and 512),
 height integer not null check(height between 1 and 512),
 byte_size integer not null check(byte_size between 1 and 307200),
 content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
 owner_id uuid not null references public."tUser"(id),
 created_at timestamptz not null default now(),
 is_archived boolean not null default false,
 check(storage_object_path=id::text||'.webp')
);
alter table public."tTeam" add column team_identity_id uuid references public."tTeamIdentity"(id),
 add column cloned_from_team_id uuid references public."tTeam"(id),
 add column event_id uuid references public."tEvent"(id),
 add column logo_image_asset_id uuid references public."tImageAsset"(id),
 add column team_color_hex text not null default '#334155' check(team_color_hex ~ '^#[0-9A-Fa-f]{6}$'),
 add column revision integer not null default 0;
create index team_identity_idx on public."tTeam"(team_identity_id);
create index team_event_idx on public."tTeam"(event_id);
create index team_clone_idx on public."tTeam"(cloned_from_team_id);
create index team_logo_idx on public."tTeam"(logo_image_asset_id);
create table public."tTeamMember" (
 id uuid primary key default gen_random_uuid(),
 team_id uuid not null references public."tTeam"(id),
 fencer_id uuid not null references public."tFencer"(id),
 added_at timestamptz not null default now(),
 added_by uuid references public."tUser"(id),
 removed_at timestamptz,
 removed_by uuid references public."tUser"(id),
 check((removed_at is null)=(removed_by is null)),
 check(removed_at is null or removed_at>=added_at)
);
create unique index team_active_member on public."tTeamMember"(team_id,fencer_id) where removed_at is null;
create index team_member_fencer_idx on public."tTeamMember"(fencer_id);
create table public."tTeamLegacyMap" (
 id uuid primary key default gen_random_uuid(),
 legacy_team_id uuid not null references public."tTeam"(id),
 event_id uuid not null references public."tEvent"(id),
 team_id uuid not null unique references public."tTeam"(id),
 unique(legacy_team_id,event_id)
);
-- Ambiguous played multi-event data needs an explicit attribution review, never
-- an automatic rewrite of historical match references.
do $$ begin
 if exists(select 1 from public."tControlPointMatch" m cross join lateral
 (values(m.team_a_id),(m.team_b_id)) sides(team_id) where team_id is not null
 group by team_id having count(distinct m.event_id)>1) then
 raise exception 'Legacy team appears in multiple played/scheduled event match histories. Review team attribution before migrating; no data changed.';
 end if;
end $$;
insert into public."tTeamIdentity"(id,owner_id,created_at) select id,owner_id,created_at from public."tTeam";
update public."tTeam" set team_identity_id=id;
-- Keep the original TeamID for its first (or match-referenced) event. Additional
-- event entries receive fresh instance IDs, with an explicit legacy mapping.
do $$ declare t record; e record; chosen uuid; instance_id uuid; begin
 for t in select * from public."tTeam" order by created_at,id loop
  select event_id into chosen from public."tControlPointMatch" where team_a_id=t.id or team_b_id=t.id order by created_at limit 1;
  if chosen is null then select event_id into chosen from public."tEventTeam" where team_id=t.id order by added_at,event_id limit 1; end if;
  update public."tTeam" set event_id=chosen where id=t.id;
  if chosen is null then
   insert into public."tTeamMember"(team_id,fencer_id,added_by) select t.id,fencer_id,owner_id from public."tTeamFencer" where team_id=t.id;
  end if;
  for e in select event_id from public."tEventTeam" where team_id=t.id union select chosen where chosen is not null loop
   instance_id=t.id;
   if e.event_id<>chosen then
    instance_id=gen_random_uuid();
    -- Legacy paths are kept on the original team. Clones may reference that
    -- retained object without changing the old team-scoped upload validator.
    insert into public."tTeam"(id,owner_id,name,mode,team_identity_id,cloned_from_team_id,event_id,is_archived,image_url,image_path)
     values(instance_id,t.owner_id,t.name,t.mode,t.id,t.id,e.event_id,t.is_archived,t.image_url,t.image_path);
   end if;
   insert into public."tTeamLegacyMap"(legacy_team_id,event_id,team_id) values(t.id,e.event_id,instance_id);
   insert into public."tTeamMember"(team_id,fencer_id,added_by)
    select instance_id,fencer_id,t.owner_id from public."tEventTeamFencer" where team_id=t.id and event_id=e.event_id;
  end loop;
 end loop;
end $$;
alter table public."tTeam" alter column team_identity_id set not null;
-- Read access follows the existing shared Management/Admin account gate. New
-- writes go through checked commands; no direct client writes to core records.
do $$ declare t text; begin
 foreach t in array array['tTeamIdentity','tImageAsset','tTeamMember','tTeamLegacyMap'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy shared_read on public.%I for select to authenticated using ((select scorekeeper_private.can_use()))',t);
  execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function scorekeeper_private.audit()',t);
 end loop;
 foreach t in array array['tTeam','tTeamFencer','tEventTeam','tEventTeamFencer'] loop
  execute format('revoke insert,update,delete on public.%I from authenticated',t);
 end loop;
end $$;
create table scorekeeper_private.team_receipt (
 id uuid primary key, actor_id uuid not null, request jsonb not null, response jsonb not null
);
revoke all on scorekeeper_private.team_receipt from public,anon,authenticated;

create function scorekeeper_private.team_assignment_lock(p_team uuid) returns text
language sql stable security definer set search_path='' as $$
 select case
 when exists(select 1 from public."tControlPointMatch" m where (team_a_id=p_team or team_b_id=p_team)
  and (started_at is not null or ended_at is not null or phase<>'ready'
   or exists(select 1 from public."tControlPointCall" where match_id=m.id)
   or exists(select 1 from public."tControlPointTime" where match_id=m.id)))
 then 'Team has match participation; clone the team for another event.'
 when exists(select 1 from public."tEventFinalization" f join public."tTeam" t on t.event_id=f.event_id where t.id=p_team)
 then 'Team belongs to frozen event history; clone the team for another event.'
 when exists(select 1 from public."tControlPointMatch" where team_a_id=p_team or team_b_id=p_team)
 then 'Detach or regenerate scheduled fixtures before changing the event; alternatively clone this team.'
 end;
$$;
revoke all on function scorekeeper_private.team_assignment_lock(uuid) from public,anon,authenticated;
create view public."vTeamInstances" with(security_invoker=true) as
 select t.*, case
 when exists(select 1 from public."tControlPointMatch" m where team_a_id=t.id or team_b_id=t.id)
 or exists(select 1 from public."tEventFinalization" f where f.event_id=t.event_id)
 then true else false end assignment_locked
 from public."tTeam" t;
grant select on public."vTeamInstances" to authenticated;

create function public.team_command(p_request_id uuid,p_action text,p_team uuid,p_revision integer default null,p_values jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare t public."tTeam"; source public."tTeam"; e public."tEvent"; result jsonb; req jsonb;
 receipt scorekeeper_private.team_receipt; identity_id uuid; skipped jsonb='[]'; lock_reason text; new_event uuid; member_id uuid;
begin
 if not scorekeeper_private.can_use() then raise exception 'Active Management account required'; end if;
 req=jsonb_build_object('action',p_action,'team',p_team,'revision',p_revision,'values',p_values);
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into receipt from scorekeeper_private.team_receipt where id=p_request_id;
 if found then
  if receipt.actor_id<>auth.uid() or receipt.request<>req then raise exception 'Request ID already used'; end if;
  return receipt.response;
 end if;
 if p_action in ('create','clone') then
  if p_action='clone' then
   select * into source from public."tTeam" where id=(p_values->>'source_id')::uuid for update;
   if not found then raise exception 'Source team not found'; end if;
   if p_values ? 'mode' and p_values->>'mode'<>source.mode::text then raise exception 'Clone must keep the source scoring mode'; end if;
   identity_id=source.team_identity_id;
   select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.display_name)),'[]') into skipped
    from public."tTeamMember" m join public."tFencer" f on f.id=m.fencer_id
    where m.team_id=source.id and m.removed_at is null and (f.is_archived or f.is_unregistered);
  else
   identity_id=gen_random_uuid();
   insert into public."tTeamIdentity"(id,owner_id) values(identity_id,auth.uid());
  end if;
  insert into public."tTeam"(id,owner_id,name,mode,team_identity_id,cloned_from_team_id,logo_image_asset_id,team_color_hex,image_url,image_path)
   values(p_team,auth.uid(),coalesce(p_values->>'name',source.name),coalesce(p_values->>'mode',source.mode::text,'traditional')::public.scorekeeper_mode,
    identity_id,source.id,source.logo_image_asset_id,coalesce(source.team_color_hex,'#334155'),source.image_url,source.image_path);
  if p_action='clone' then
   insert into public."tTeamMember"(team_id,fencer_id,added_by)
    select p_team,f.id,auth.uid() from public."tTeamMember" m join public."tFencer" f on f.id=m.fencer_id
    where m.team_id=source.id and m.removed_at is null and not f.is_archived and not f.is_unregistered;
  end if;
 end if;
 select * into t from public."tTeam" where id=p_team for update;
 if not found then raise exception 'Team not found'; end if;
 if p_action not in ('create','clone') and p_revision is distinct from t.revision then
  raise exception 'Team changed on another device. Reload before saving.';
 end if;
 if p_action in ('create','clone','edit') then
  new_event=case when p_values ? 'event_id' then nullif(p_values->>'event_id','')::uuid else t.event_id end;
  if new_event is distinct from t.event_id then
   lock_reason=scorekeeper_private.team_assignment_lock(t.id);
   if lock_reason is not null then raise exception '%',lock_reason; end if;
  end if;
  if new_event is not null then
   select * into e from public."tEvent" where id=new_event for update;
   -- Unchanged legacy assignments remain editable even when originally attached
   -- to an individual/archived event. New assignments must be eligible.
   if new_event is distinct from t.event_id and (not found or e.competition_format<>'team' or e.mode<>t.mode or e.status not in ('draft','active')) then
    raise exception 'Choose an active or draft team-format event with the same scoring mode';
   end if;
   if exists(select 1 from public."tEventFinalization" where event_id=new_event) and new_event is distinct from t.event_id then
    raise exception 'Event has frozen history; choose a new event';
   end if;
  end if;
  if p_values ? 'logo_image_asset_id' and nullif(p_values->>'logo_image_asset_id','') is not null then
   perform 1 from public."tImageAsset" where id=(p_values->>'logo_image_asset_id')::uuid and (not is_archived or id=t.logo_image_asset_id) for share;
   if not found then raise exception 'Choose an active image asset'; end if;
  end if;
  if p_values ? 'mode' and p_values->>'mode'<>t.mode::text then raise exception 'Team scoring mode is fixed; create another team'; end if;
  if p_values ? 'image_url' and nullif(p_values->>'image_url','') is not null and p_values->>'image_url' !~ '^https://[^/@]+([/:][^@]*)?$' then raise exception 'Use an HTTPS image URL'; end if;
  update public."tTeam" set name=coalesce(p_values->>'name',t.name),event_id=new_event,
   logo_image_asset_id=case when p_values ? 'logo_image_asset_id' then nullif(p_values->>'logo_image_asset_id','')::uuid else t.logo_image_asset_id end,
   team_color_hex=coalesce(p_values->>'team_color_hex',t.team_color_hex),
   image_url=case when p_values ? 'image_url' then nullif(p_values->>'image_url','') else t.image_url end,
   image_path=case when p_values->>'clear_legacy_image'='true' then null else t.image_path end,
   revision=revision+1,updated_at=clock_timestamp() where id=p_team returning * into t;
 elsif p_action in ('archive','restore') then
  update public."tTeam" set is_archived=p_action='archive',revision=revision+1,updated_at=clock_timestamp() where id=p_team returning * into t;
 elsif p_action='add_member' then
  perform 1 from public."tFencer" where id=(p_values->>'fencer_id')::uuid and not is_archived and not is_unregistered for share;
  if not found then raise exception 'Choose an active registered fencer'; end if;
  if t.is_archived then raise exception 'Restore this team before adding members'; end if;
  insert into public."tTeamMember"(team_id,fencer_id,added_by) values(t.id,(p_values->>'fencer_id')::uuid,auth.uid());
  update public."tTeam" set revision=revision+1,updated_at=clock_timestamp() where id=p_team returning * into t;
 elsif p_action='remove_member' then
  update public."tTeamMember" set removed_at=clock_timestamp(),removed_by=auth.uid()
   where team_id=t.id and id=(p_values->>'membership_id')::uuid and removed_at is null returning id into member_id;
  if not found then raise exception 'Membership is no longer active. Reload the roster.'; end if;
  update public."tTeam" set revision=revision+1,updated_at=clock_timestamp() where id=p_team returning * into t;
 else raise exception 'Unknown team action';
 end if;
 result=jsonb_build_object('team',to_jsonb(t),'skipped',skipped);
 insert into scorekeeper_private.team_receipt values(p_request_id,auth.uid(),req,result);
 return result;
end $$;
revoke all on function public.team_command(uuid,text,uuid,integer,jsonb) from public,anon;
grant execute on function public.team_command(uuid,text,uuid,integer,jsonb) to authenticated;
-- Prevent event edits from invalidating an assignment behind the team workflow.
create function scorekeeper_private.protect_team_event() returns trigger language plpgsql set search_path='' as $$ begin
 if row(new.mode,new.competition_format) is distinct from row(old.mode,old.competition_format)
 and exists(select 1 from public."tTeam" where event_id=old.id) then
 raise exception 'Unassign eligible teams or create a new event before changing scoring mode/format'; end if;
 return new;
end $$;
create trigger protect_team_event before update on public."tEvent" for each row execute function scorekeeper_private.protect_team_event();
revoke all on function scorekeeper_private.protect_team_event() from public,anon,authenticated;

-- Freeze team appearance and exact membership alongside existing event results.
alter table public."tEventFinalization" add column team_snapshot jsonb;
create function scorekeeper_private.freeze_teams() returns trigger language plpgsql security definer set search_path='' as $$ begin
 new.team_snapshot=coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('members',
  coalesce((select jsonb_agg(to_jsonb(m)||jsonb_build_object('fencer_name',f.display_name)) from public."tTeamMember" m join public."tFencer" f on f.id=m.fencer_id where m.team_id=t.id and m.removed_at is null),'[]'::jsonb))) from public."tTeam" t where t.event_id=new.event_id),'[]'::jsonb);
 return new;
end $$;
create trigger freeze_teams before insert on public."tEventFinalization" for each row execute function scorekeeper_private.freeze_teams();
revoke all on function scorekeeper_private.freeze_teams() from public,anon,authenticated;

-- A separate bucket preserves existing 2 MB team-images objects and paths while
-- enforcing stricter limits for all new immutable library uploads.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('image-library','image-library',false,307200,array['image/webp']) on conflict(id) do update
 set public=false,file_size_limit=307200,allowed_mime_types=array['image/webp'];
drop policy scorekeeper_image_insert on storage.objects;
drop policy scorekeeper_image_delete on storage.objects;
-- Only the trusted image endpoint may upload; no client overwrite/delete paths.
create policy library_image_read on storage.objects for select to authenticated
 using(bucket_id='image-library' and (select scorekeeper_private.can_use())
 and exists(select 1 from public."tImageAsset" where storage_object_path=name));
create function public.archive_image_asset(p_id uuid,p_archived boolean) returns void
 language plpgsql security definer set search_path='' as $$ begin
 if not scorekeeper_private.can_use() then raise exception 'Active Management account required'; end if;
 update public."tImageAsset" set is_archived=p_archived where id=p_id;
 if not found then raise exception 'Image not found'; end if;
end $$;
revoke all on function public.archive_image_asset(uuid,boolean) from public,anon;
grant execute on function public.archive_image_asset(uuid,boolean) to authenticated;
create table scorekeeper_private.image_upload (
 id uuid primary key, actor_id uuid not null references public."tUser"(id),
 content_hash text not null, created_at timestamptz not null default now()
);
revoke all on scorekeeper_private.image_upload from public,anon,authenticated;
create function public.reserve_image_upload(p_id uuid,p_hash text,p_actor uuid) returns void
 language plpgsql security definer set search_path='' as $$ declare r scorekeeper_private.image_upload; begin
 if not exists(select 1 from public."tUser" where id=p_actor and is_active and not is_deleted and not must_change_password) then raise exception 'Account is no longer active'; end if;
 insert into scorekeeper_private.image_upload(id,actor_id,content_hash) values(p_id,p_actor,p_hash) on conflict(id) do nothing;
 select * into r from scorekeeper_private.image_upload where id=p_id for update;
 if r.actor_id<>p_actor or r.content_hash<>p_hash then raise exception 'Upload ID already used'; end if;
end $$;
revoke all on function public.reserve_image_upload(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.reserve_image_upload(uuid,text,uuid) to service_role;
-- Trusted upload inserts are audited with the actual verified uploader.
create function public.register_image_asset(p_id uuid,p_name text,p_width integer,p_height integer,p_size integer,p_hash text,p_actor uuid)
 returns jsonb language plpgsql security definer set search_path='' as $$ declare a public."tImageAsset"; begin
 if not exists(select 1 from public."tUser" where id=p_actor and is_active and not is_deleted and not must_change_password) then raise exception 'Account is no longer active'; end if;
 perform 1 from scorekeeper_private.image_upload where id=p_id and actor_id=p_actor and content_hash=p_hash for update;
 if not found then raise exception 'Upload reservation required'; end if;
 select * into a from public."tImageAsset" where id=p_id for update;
 if found then
  if a.owner_id<>p_actor or a.content_hash<>p_hash then raise exception 'Upload ID already used'; end if;
  return to_jsonb(a);
 end if;
 insert into public."tImageAsset"(id,storage_object_path,display_name,mime_type,width,height,byte_size,content_hash,owner_id)
 values(p_id,p_id::text||'.webp',p_name,'image/webp',p_width,p_height,p_size,p_hash,p_actor) returning * into a;
 -- service-role calls have no end-user auth.uid(); explicitly retain attribution.
 insert into public."tAudit"(table_name,record_id,action,actor_id,new_value) values('tImageAsset',a.id::text,'UPLOAD',p_actor,to_jsonb(a));
 return to_jsonb(a);
end $$;
revoke all on function public.register_image_asset(uuid,text,integer,integer,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.register_image_asset(uuid,text,integer,integer,integer,text,uuid) to service_role;
commit;
