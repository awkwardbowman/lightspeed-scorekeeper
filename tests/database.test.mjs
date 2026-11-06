process.on('uncaughtException',e=>{console.error(e.message, e.detail??'',e.hint??'',e.query??'');process.exit(1);});
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const db=new PGlite();
const admin=randomUUID(),manager=randomUUID(),other=randomUUID(),outsider=randomUUID();
const sessions=new Map([admin,manager,other,outsider].map(id=>[id,randomUUID()]));
await db.exec(`create role anon;create role supabase_auth_admin;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;grant usage on schema auth to authenticated;grant execute on all functions in schema auth to authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;`);
await db.exec(await readFile(new URL('./schema-baseline.sql',import.meta.url),'utf8'));
for(const id of [admin,manager,other,outsider])await db.query('insert into auth.users values($1);',[id]);
for(const [id,s] of sessions)await db.query('insert into auth.sessions values($1,$2)',[s,id]);
for(const id of [admin,manager,other])await db.query('insert into public."tUser"(id,email,display_name,app_role) values($1,$2,$3,$4)',[id,`${id}@test.invalid`,id===admin?'Maya':'Management',id===admin?'admin':'management']);
await db.exec('alter table public."tFencer" enable row level security;create policy legacy_owner on public."tFencer" for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());');
const preserved=randomUUID();await db.query('insert into public."tFencer"(id,owner_id,display_name) values($1,$2,$3)',[preserved,admin,'Existing fencer']);
for(const file of (await readdir(new URL('../supabase/migrations',import.meta.url))).sort()){
 try{await db.exec(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));}catch(e){console.error('Migration failed:',e.message,e.position,e.query?.slice(Math.max(0,Number(e.position)-250),Number(e.position)+250));throw e;}
}
async function auth(id){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,session_id:sessions.get(id)})]);await db.exec('set role authenticated');}
async function root(){await db.exec('reset role');await db.query("select set_config('request.jwt.claims','{}',false)");}
async function q(sql,args=[]){return (await db.query(sql,args)).rows;}
async function reject(sql,args=[],pattern){await assert.rejects(()=>db.query(sql,args),pattern);}
await db.exec('set role supabase_auth_admin');assert.equal((await db.query("select public.scorekeeper_block_email('{}') result")).rows[0].result.error.http_code,403);await db.exec('reset role');
await auth(manager);
assert.equal((await q('select * from public."tFencer" where id=$1',[preserved])).length,1,'shared cross-creator read');
await db.query('update public."tFencer" set notes=$1 where id=$2',['Shared edit',preserved]);
const f1=randomUUID(),f2=randomUUID();
await db.query('insert into public."tFencer"(id,owner_id,display_name) values($1,$2,$3),($4,$2,$3)',[f1,manager,'Duplicate name',f2]);
assert.equal((await q('select * from public."tFencer" where display_name=$1',['Duplicate name'])).length,2);
await db.query('delete from public."tFencer" where id=$1',[f1]);assert.equal((await q('select * from public."tFencer" where id=$1',[f1])).length,1,'management cannot permanently delete');
await reject('update public."tFencer" set owner_id=$1 where id=$2',[other,f1],/creator cannot be changed/);
await reject('insert into public."tAudit"(table_name,record_id,action) values(\'x\',\'x\',\'x\')',[],/permission denied/);
const unreg=(await q('select id from public."tFencer" where is_unregistered'))[0].id;
await reject('update public."tFencer" set display_name=\'Fake\' where id=$1',[unreg],/Reserved/);
const m=randomUUID(),token=randomUUID();
await db.query('insert into public."tTraditionalMatch"(id,owner_id,left_fencer_id,right_fencer_id) values($1,$2,$3,$3)',[m,manager,unreg]);
await reject('insert into public."tTraditionalMatch"(owner_id,left_fencer_id,right_fencer_id) values($1,$2,$2)',[manager,f1],/different registered fencers/);
let claim=(await q('select public.claim_match($1,$2) c',[m,token]))[0].c;
const call={id:randomUUID(),side:'left',type:'counter',points:5,matchTimeMs:180000,timestamp:new Date().toISOString()};
let match={id:m,leftName:'Typed A',rightName:'Typed B',leftFencerId:unreg,rightFencerId:unreg,durationMs:180000,remainingMs:170000,targetScore:null,phase:'paused',endReason:null,startedAt:new Date().toISOString(),endedAt:null};
async function save(calls,final=false){const r=(await q('select public.save_match($1,$2,$3,$4,$5) m',[JSON.stringify(match),JSON.stringify(calls),token,claim.revision,final]))[0].m;claim=r;return r;}
await save([call]);assert.equal((await q('select left_score from public."vMatchResults" where id=$1',[m]))[0].left_score,5);
await save([call]);assert.equal((await q('select count(*)::int n from public."tTraditionalCall" where match_id=$1',[m]))[0].n,1,'retry idempotency');
await reject('select public.save_match($1,$2,$3,$4,false)',[JSON.stringify(match),'[]',token,0],/changed on another device/);
await auth(other);await reject('select public.claim_match($1,$2)',[m,randomUUID()],/claimed/);
const exposed=(await q('select lease_token from public."tTraditionalMatch" where id=$1',[m]))[0].lease_token;
await reject('select public.claim_match($1,$2)',[m,exposed],/claimed/);
await reject('update public."tTraditionalMatch" set lease_token=$1,referee_id=$2 where id=$3',[randomUUID(),other,m],/claim|Claim/);
await auth(manager);await save([]);assert.equal((await q('select left_score from public."vMatchResults" where id=$1',[m]))[0].left_score,0,'undo reverses transactionally');
assert.ok((await q('select * from public."tAudit" where record_id=$1',[call.id])).length>=2,'immutable call audit retained');
await save([call]);match={...match,phase:'ended',endReason:'manual',endedAt:new Date().toISOString()};await save([call],true);assert.equal((await q('select outcome from public."vMatchResults" where id=$1',[m]))[0].outcome,'incomplete','manual stopping does not assume a result');
match={...match,endReason:'time',remainingMs:0};await save([call],true);
assert.equal((await q('select count(*)::int n from public."vFencerStatistics" where fencer_id=$1',[unreg]))[0].n,0);
await root();await db.query('update public."tUser" set is_active=false where id=$1',[manager]);await auth(manager);
assert.equal((await q('select count(*)::int n from public."tFencer"'))[0].n,0,'disabled old access token is denied');
await reject('insert into public."tFencer"(owner_id,display_name) values($1,\'Denied\')',[manager],/row-level security/);
await root();await db.query('update public."tUser" set is_active=true,must_change_password=true where id=$1',[manager]);await auth(manager);
assert.equal((await q('select count(*)::int n from public."tFencer"'))[0].n,0,'temporary password gate denies domain data');
assert.equal((await q('select public.account_status() p'))[0].p.must_change_password,true);
await root();await db.query('update public."tUser" set must_change_password=false where id=$1',[manager]);await auth(outsider);
assert.equal((await q('select count(*)::int n from public."tFencer"'))[0].n,0,'unprovisioned Auth user denied');
await auth(admin);await reject('update public."tUser" set app_role=\'management\' where id=$1',[admin],/permission denied/);
const preset=randomUUID(),event=randomUUID(),phase=randomUUID();
await db.query('insert into public."tMatchPreset"(id,owner_id,name) values($1,$2,\'Standard\')',[preset,admin]);
await db.query('insert into public."tEvent"(id,owner_id,name,mode,preset_id) values($1,$2,\'Test event\',\'traditional\',$3)',[event,admin,preset]);
await q('select public.set_event_status($1,\'active\')',[event]);
await db.query('insert into public."tEventFencer" values($1,$2),($1,$3)',[event,f1,f2]);
await reject('insert into public."tEventFencer" values($1,$2)',[event,unreg],/registered fencer/);
await db.query('insert into public."tEventPhase"(id,event_id,name,kind,position) values($1,$2,\'Final\',\'single\',1)',[phase,event]);
const graph={entrants:[f1,f2],nodes:[{key:'W1.0',left:{seed:0},right:{seed:1}}]};
let b=(await q('select public.generate_bracket($1,$2,\'single\') id',[phase,JSON.stringify(graph)]))[0].id;
await q('select public.sync_bracket($1)',[b]);
const scheduled=(await q('select * from public."tTraditionalMatch" where bracket_id=$1',[b]))[0];assert.equal(scheduled.started_at,null);assert.equal(scheduled.ended_at,null);assert.equal(scheduled.left_fencer_id,f1);
await q('select public.generate_bracket($1,$2,\'single\')',[phase,JSON.stringify(graph)]);
assert.equal((await q('select is_archived from public."tTraditionalMatch" where id=$1',[scheduled.id]))[0].is_archived,true,'regeneration archives all old records');
// Freeze an empty event independently of the active bracket event.
const empty=randomUUID();await db.query('insert into public."tEvent"(id,owner_id,name,mode) values($1,$2,\'Empty\',\'traditional\')',[empty,admin]);
await q('select public.set_event_status($1,\'completed\')',[empty]);const snapshot=(await q('select configuration from public."tEventFinalization" where event_id=$1',[empty]))[0].configuration;
await db.query('update public."tConfiguration" set tiebreakers=\'["differential","points_for"]\'');assert.deepEqual((await q('select configuration from public."tEventFinalization" where event_id=$1',[empty]))[0].configuration,snapshot,'frozen config remains unchanged');
await reject('update public."tConfiguration" set key_mappings=\'{"toggle":"a","undo":"a"}\'',[],/unique single/);
await root();await db.query('delete from auth.sessions where user_id=$1',[other]);await auth(other);assert.equal((await q('select public.account_status() p'))[0].p,null,'revoked sessions blocked');
await root();await db.query('update public."tAccountPolicy" set email_ready=true');
await auth(manager);await q('select public.reserve_invitation($1)',['new-person@test.invalid']);
await reject('select public.set_invitations_paused(true)',[],/Only Admin/);
await reject('update public."tAccountPolicy" set invitations_paused=false',[],/permission denied/);
await auth(admin);await q('select public.set_invitations_paused(true)');
await auth(manager);await reject('select public.reserve_invitation($1)',['paused@test.invalid'],/paused/);
assert.ok((await q('select public.account_status() p'))[0].p.is_active,'pausing invitations does not block existing accounts');
await auth(admin);await q('select public.set_invitations_paused(false)');
await auth(manager);await q('select public.reserve_invitation($1)',['resumed@test.invalid']);
await root();await db.query('update public."tUser" set is_active=false where id=$1',[manager]);
await auth(manager);await reject('select public.reserve_invitation($1)',['disabled@test.invalid'],/active account/);
await root();await db.query('update public."tUser" set is_active=true where id=$1',[manager]);
console.log('PASS: migration, shared RLS, disabled/revoked/password gates, immutable audits, atomic/idempotent scoring, referee conflict, registered IDs, brackets and frozen standings.');
await db.close();
