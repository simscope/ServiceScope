import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { PGlite } from '@electric-sql/pglite';
import { createEditorHandler } from '../server/reel-editor/service.js';
import { createRenderRepository } from '../server/reel-render-jobs/repository.js';
import { authorizeReelForRender } from '../server/reel-renderer/authorization.js';
import { newDraft } from '../src/features/reel-editor/presentation.js';
import { serializeSandboxAuthority, reelSandboxEditorAssetSchemaVersion } from '../server/reel-sandbox-runtime/contracts.js';

// Temporary PostgreSQL WASM database only. Actual application migrations/RPC bodies;
// transport adapts to SQL, not successful SQL mocks. JWT verification and PostgREST are not exercised.
export async function editorIntegrationSmoke(outputRoot) {
  const db = new PGlite();
  const company='22222222-2222-4222-8222-222222222222', job='11111111-1111-4111-8111-111111111111', actor='33333333-3333-4333-8333-333333333333', photo='44444444-4444-4444-8444-444444444444', analysis='55555555-5555-4555-8555-555555555555';
  try {
    const isolated = await readFile('scripts/reel-editor-sql-tests.mjs','utf8');
    let bootstrap = isolated.slice(isolated.indexOf('await db.exec(`')+15, isolated.indexOf('create table public.company_reel_creative_plans'));
    bootstrap = bootstrap.replace(/create function auth.uid\(\)[^;]+;/, () => "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;");
    await db.exec(bootstrap);
    await db.exec(`alter table public.company_users add column id uuid, add column name text;
      create function auth.email() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.email',true),'')$$;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create function public.can_access_company(target uuid) returns boolean language sql stable as $$select exists(select 1 from public.companies where id=target and owner_email=auth.email())$$;`);
    for (const name of ['20260809234500_reel_render_jobs.sql','20260811022000_reel_renderer_v2_contract.sql','20260814143000_reel_render_controlled_pipeline.sql','20260927190000_reel_failed_render_retry.sql','20261004090000_reel_manager_editor_v2.sql'])
      await db.exec(await readFile(`supabase/migrations/${name}`,'utf8'));
    await db.query('insert into auth.users values($1,$2)',[actor,'manager@example.invalid']);
    await db.query('insert into public.companies values($1,$2)',[company,'manager@example.invalid']);
    await db.query("insert into public.jobs(id,company_id,status) values($1,$2,'Completed')",[job,company]);
    await db.query("insert into public.company_profiles(company_id,display_name,ai_public_display_name,ai_cta_guidance) values($1,'ServiceScope','ServiceScope','')",[company]);
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="#143d53"/><g stroke="#fff" stroke-width="5">'+Array.from({length:20},(_,i)=>`<path d="M${i*80} 0V1200 M0 ${i*60}H1600"/>`).join('')+'</g><circle cx="800" cy="600" r="250" fill="#f6be52"/></svg>';
    const bytes=await sharp(Buffer.from(svg)).png().toBuffer(), sha=createHash('sha256').update(bytes).digest('hex');
    await db.query("insert into public.job_attachments values($1,$2,$3,'photo','image/png',$4,'fixture','photo.png',now())",[photo,job,company,bytes.length]);
    await db.query("insert into public.company_media_analysis_runs values($1,'completed')",[analysis]);
    await db.query("insert into public.company_media_analysis_attachment_results values($1,$1,$2,$3,$4,decode($5,'hex'),'analyzed',false,'passed',now())",[analysis,photo,company,job,sha]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.email',$2,false)",[actor,'manager@example.invalid']);
    const rpcNames=new Set(['get_company_reel_editor_context','commit_company_reel_editor_draft','commit_company_reel_editor_approval','begin_company_reel_render_request','build_company_reel_editor_context','claim_company_reel_render_job']);
    async function rpc(name,args,role) {
      assert(rpcNames.has(name)); const keys=Object.keys(args); assert(keys.every(k=>/^p_[a-z_]+$/.test(k)));
      await db.exec(`set role ${role}`);
      try { const r=await db.query(`select * from public.${name}(${keys.map((k,i)=>`${k} => $${i+1}`).join(',')})`,Object.values(args).map(x=>typeof x==='object'?JSON.stringify(x):x));
        return ['get_company_reel_editor_context','commit_company_reel_editor_draft','commit_company_reel_editor_approval','build_company_reel_editor_context'].includes(name)?Object.values(r.rows[0])[0]:r.rows;
      } finally { await db.exec('reset role'); }
    }
    const client={authenticate:async header=>{assert.equal(header,'Bearer isolated-fixture');return {token:'isolated-fixture',userId:actor};},
      userRpc:(name,args)=>rpc(name,args,'authenticated'), adminRpc:(name,args)=>rpc(name,args,'service_role'),
      select:async(table,query)=>{ assert(['company_reel_editor_drafts','company_reel_creative_plans','company_reel_creative_plan_approvals'].includes(table));const params=new URLSearchParams(query);const values=[],where=[];
        for(const [k,v] of params) if(v.startsWith('eq.')){assert(/^[a-z_]+$/.test(k));values.push(v.slice(3));where.push(`${k}=$${values.length}`);}assert(where.length);
        return (await db.query(`select * from public.${table} where ${where.join(' and ')} limit 1`,values)).rows;},
      downloadBounded:async(bucket,path)=>{assert.equal(bucket,'fixture');assert.equal(path,'photo.png');return bytes;},
      dispatch:()=>{throw new Error('EXTERNAL_DISPATCH_FORBIDDEN');}};
    const handler=createEditorHandler({client});
    async function api(operation,extra={}){ const res=await handler(new Request('http://isolated.invalid/api/reel-editor',{method:'POST',headers:{authorization:'Bearer isolated-fixture'},body:JSON.stringify({jobId:job,operation,...extra})}));const body=await res.json();assert.equal(res.status,200,JSON.stringify(body));return body; }
    const draft=newDraft(job,[{attachmentId:photo}]);draft.brief.problem='Loose fitting found.';draft.brief.work='The fitting was secured.';
    draft.scenes[0].frames=60;draft.scenes[0].text.headline=draft.brief.work;draft.scenes[0].text.factRefs=['work'];draft.scenes[0].text.disappear=60;
    const saved=await api('save',{draft,expectedRevision:0,confirmBrief:true}); assert.equal(saved.row.brief_confirmation.actorId,actor);
    const approved=await api('approve',{expectedRevision:1}); const reload=await api('load');assert.deepEqual(reload.row.approval,approved.row.approval);assert.equal(reload.row.approvalApplicable,true);
    const args={p_creative_plan_id:approved.row.approval.creativePlanId,p_expected_plan_revision:approved.row.approval.revision};
    const requested=await rpc('begin_company_reel_render_request',args,'authenticated');assert.equal(requested[0].status,'queued');
    assert.equal((await rpc('begin_company_reel_render_request',args,'authenticated'))[0].render_job_id,requested[0].render_job_id);
    const repository=createRenderRepository(client), claim=await repository.claim(requested[0].render_job_id);assert(claim);
    const authority=await repository.loadAuthority(claim);authorizeReelForRender(authority);
    const serialized=serializeSandboxAuthority({plan:authority.plan,context:authority.context});
    assert(!serialized.includes('manager@example.invalid'));assert(!serialized.includes('photo.png'));
    if(outputRoot){const root=resolve(outputRoot);await mkdir(join(root,'input'),{recursive:true});await mkdir(join(root,'output'),{recursive:true});
      await writeFile(join(root,'authority.json'),serialized);await writeFile(join(root,'input','asset-1.bin'),bytes);
      await writeFile(join(root,'assets.json'),JSON.stringify({schemaVersion:reelSandboxEditorAssetSchemaVersion,authoritySha256:createHash('sha256').update(serialized).digest('hex'),assets:[{attachmentId:photo,path:'input/asset-1.bin',size:bytes.length,sha256:sha}]}));}
    console.log('PASS isolated v2: actual editor API handler → actual draft/approval/context/render-request/claim SQL → repository bytes/privacy → authorization → serialized canonical-runner input; idempotency PASS; no dispatch. JWT/PostgREST/deployed E2E not exercised.');
    return authority;
  } finally { await db.close(); }
}
if(process.argv[1]?.endsWith('reel-editor-integration-smoke.mjs')) await editorIntegrationSmoke(process.argv[2]);
