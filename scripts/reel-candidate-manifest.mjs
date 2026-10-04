import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { execFileSync } from 'node:child_process';
export const manifestPath='infra/reel-render-sandbox/candidate-manifest.json';
const dockerfilePath='infra/reel-render-sandbox/Dockerfile';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function candidateManifest() {
  const dockerfile=await readFile(dockerfilePath,'utf8'), entries=[];
  async function add(source,destination){ if(source===manifestPath)return;
    if((await stat(source)).isDirectory()){for(const child of (await readdir(source)).sort())await add(posix.join(source,child),posix.join(destination,child));}
    else entries.push({source,destination,sha256:sha(await readFile(source))});
  }
  for(const line of dockerfile.split('\n').filter(l=>l.startsWith('COPY '))){const fields=line.trim().split(/\s+/).slice(1);const destination=fields.pop();
    assert(!fields.some(f=>/[*$]/.test(f)),'Uncontrolled Docker COPY');
    for(const source of fields){ const dir=(await stat(source).catch(()=>null))?.isDirectory();
      const target=posix.resolve('/app',destination);
      await add(source,dir?target:fields.length>1||destination.endsWith('/')?posix.join(target,posix.basename(source)):target);
    }
  }
  entries.sort((a,b)=>a.destination.localeCompare(b.destination));assert.equal(new Set(entries.map(e=>e.destination)).size,entries.length);
  // Every relative JS import in runtime source must resolve to another manifested input.
  const included=new Set(entries.map(e=>e.source));
  for(const e of entries.filter(e=>/\.(js|mjs)$/.test(e.source))){const source=await readFile(e.source,'utf8');
    for(const m of source.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)) assert(included.has(posix.normalize(posix.join(posix.dirname(e.source),m[1]))),`Missing runtime import ${e.source} → ${m[1]}`);
  }
  assert(included.has(dockerfilePath));assert(included.has('.dockerignore'));
  assert(included.has('public/reel-editor/fonts/DejaVuSans.ttf'));assert(included.has('server/reel-sandbox-runner/package-lock.json'));
  const sourceSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const baseImage=dockerfile.match(/^FROM (node:[^\s]+@sha256:[0-9a-f]{64})$/m)?.[1];assert(baseImage);
  return {schemaVersion:'reel-candidate-source-manifest-v1',sourceSha,baseImage,qualification:'candidate-only',entries};
}
const mode=process.argv[2];
if(mode==='check'||mode==='prepare'){const manifest=await candidateManifest();const bytes=JSON.stringify(manifest,null,2)+'\n';
  if(mode==='prepare')await writeFile(manifestPath,bytes);
  console.log(JSON.stringify({sourceSha:manifest.sourceSha,inputs:manifest.entries.length,manifestSha256:sha(bytes),qualification:manifest.qualification}));
}else if(mode==='verify'){
  const image=process.argv[3];assert(image);const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  const inspect=JSON.parse(execFileSync('docker',['image','inspect',image],{encoding:'utf8'}))[0];
  assert.equal(inspect.Config.Labels['org.opencontainers.image.revision'],manifest.sourceSha);
  assert.equal(inspect.Config.Labels['io.servicescope.reel.runner-contract'],'reel-sandbox-authority-v1');
  assert.equal(inspect.Config.Labels['io.servicescope.reel.candidate-manifest'],sha(await readFile(manifestPath)));
  const script=`const fs=require('fs'),crypto=require('crypto');const m=JSON.parse(fs.readFileSync('/app/candidate-manifest.json'));for(const e of m.entries)e.actualSha256=crypto.createHash('sha256').update(fs.readFileSync(e.destination)).digest('hex');console.log(JSON.stringify(m));`;
  const actual=JSON.parse(execFileSync('docker',['run','--rm','--network','none','--entrypoint','node',image,'-e',script],{encoding:'utf8'}));
  assert.equal(actual.sourceSha,manifest.sourceSha);assert.equal(actual.entries.length,manifest.entries.length);
  for(let i=0;i<manifest.entries.length;i++){const {actualSha256,...entry}=actual.entries[i];assert.deepEqual(entry,manifest.entries[i]);assert.equal(actualSha256,entry.sha256);}
  // Record installed runtime package tree, independently of development node_modules.
  const dependencies=execFileSync('docker',['run','--rm','--network','none','--entrypoint','npm',image,'ls','--omit=dev','--all','--json'],{encoding:'utf8'});
  const systemPackages=execFileSync('docker',['run','--rm','--network','none','--entrypoint','dpkg-query',image,'-W','-f=${Package}=${Version}\n'],{encoding:'utf8'});
  const nodeVersion=execFileSync('docker',['run','--rm','--network','none','--entrypoint','node',image,'--version'],{encoding:'utf8'}).trim();
  console.log(JSON.stringify({sourceSha:manifest.sourceSha,baseImage:manifest.baseImage,imageIdentity:inspect.Id,manifestSha256:sha(await readFile(manifestPath)),verifiedInputs:manifest.entries.length,nodeVersion,installedDependencies:JSON.parse(dependencies),systemPackages,qualification:'candidate-only',manifestVerification:'PASS'}));
}else if(process.argv[1]?.endsWith('reel-candidate-manifest.mjs'))throw new Error('USAGE check|prepare|verify image');
