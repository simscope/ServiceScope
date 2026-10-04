import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { imageGeometry } from '../src/features/reel-editor/presentation.js';
const root = resolve('.tmp/reel-manager-editor-v1');
const ffmpeg = resolve('.tmp/reel-editor-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe');
const run = args => new Promise((resolveOutput, reject) => { const child = spawn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); const chunks = []; let error = ''; child.stdout.on('data', b => chunks.push(b)); child.stderr.on('data', b => { error += b; }); child.on('error', reject); child.on('close', code => code === 0 ? resolveOutput(Buffer.concat(chunks)) : reject(new Error(error))); });
if (process.argv.includes('--diagnostic')) {
  // One short diagnostic clip reproduces the legacy static (1 -> 1.025) preset.
  await run(['-y','-hide_banner','-loglevel','error','-loop','1','-i',join(root,'fixture-1.png'),'-vf',"scale=1440:2560:force_original_aspect_ratio=increase,crop=1440:2560,zoompan=z='1+0.025*on/119':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30,trim=duration=1,setpts=PTS-STARTPTS,setsar=1",'-an','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-threads','1','-movflags','+faststart',join(root,'legacy-static-diagnostic.mp4')]);
}
const state = JSON.parse(await readFile(join(root,'state.json'),'utf8'));
const files = ['legacy-static-diagnostic.mp4', ...(state.render?.status === 'completed' ? ['demo.mp4'] : [])];
const result = {};
for (const file of files) {
  const bytes = await run(['-hide_banner','-loglevel','error','-i',join(root,file),'-vf','format=rgb24,crop=1080:1:0:800','-frames:v',file==='demo.mp4'?'300':'30','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);
  const positions = [];
  for (let f = 0; f < Math.min(80, bytes.length / (1080 * 3)); f++) {
    const line = bytes.subarray(f*1080*3,(f+1)*1080*3);
    // Left white equipment border is x~100, distinct from the gray grid.
    let sum = 0, weight = 0;
    for (let x = 85; x < 135; x++) { const r=line[x*3],g=line[x*3+1],b=line[x*3+2]; if (r>225&&g>225&&b>225) { sum += x; weight++; } }
    positions.push(weight ? sum / weight : null);
  }
  result[file] = { positions, deltas: positions.slice(1).map((v,i) => v===null || positions[i]===null ? null : v-positions[i]) };
  if(file==='demo.mp4') {
    for(const [name,index,start,end,sourceX] of [['pan',1,100,185,800],['zoom',2,200,300,530]]) {
      const actual=[],expected=[]; const scene=state.snapshot.draft.scenes[index];
      for(let f=start;f<end;f++) {
        const g=imageGeometry(scene,{width:1600,height:1200},f-start,15);
        const ideal=g.x+sourceX*g.width/1600; expected.push(ideal);
        const line=bytes.subarray(f*3240,(f+1)*3240);let sum=0,weight=0;
        for(let x=Math.max(0,Math.floor(ideal-25));x<Math.min(1080,Math.ceil(ideal+25));x++){const r=line[x*3],green=line[x*3+1],b=line[x*3+2];if(r>225&&green>225&&b>225){sum+=x;weight++;}}
        if(!weight)throw new Error('MOTION_REFERENCE_NOT_FOUND');actual.push(sum/weight);
      }
      const deviation=actual.map((x,i)=>Math.abs(x-expected[i]+.5));
      const deltas=actual.slice(1).map((x,i)=>x-actual[i]);
      result[file][name]={frames:actual.length,maxGeometryDeviation:Math.max(...deviation),maximumReverseStep:Math.max(0,...deltas),positions:actual,deltas};
    }
  }
}
await writeFile(join(root,'motion-measurements.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(result).map(([name,data])=>[name,{samples:data.positions.length,range:[Math.min(...data.positions),Math.max(...data.positions)],deltas:[...new Set(data.deltas)],pan:data.pan?{frames:data.pan.frames,maxGeometryDeviation:data.pan.maxGeometryDeviation,maximumReverseStep:data.pan.maximumReverseStep}:undefined,zoom:data.zoom?{frames:data.zoom.frames,maxGeometryDeviation:data.zoom.maxGeometryDeviation,maximumReverseStep:data.zoom.maximumReverseStep}:undefined}]))));
