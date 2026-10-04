import assert from 'node:assert/strict';
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { frameSvg } from '../src/features/reel-editor/presentation.js';
const root=resolve('.tmp/reel-manager-editor-v1');
const browser=JSON.parse(await readFile(join(root,'browser-comparison.json'),'utf8'));
const state=JSON.parse(await readFile(join(root,'state.json'),'utf8'));
await sharp({text:{text:'Register',font:'DejaVu Sans 58',fontfile:fileURLToPath(new URL('../public/reel-editor/fonts/DejaVuSans.ttf',import.meta.url))}}).png().toBuffer();
const media=new Map();
for(let i=1;i<=3;i++)media.set(`fixture-${i}`,{width:1600,height:1200,url:`/__reel-editor/media/${i}`});
const normalize=svg=>svg.replace(/<([a-z]+)([^<>]*)\/>/g,'<$1$2></$1>');
for(const entry of browser){assert.equal(entry.video.time,entry.frame/30);assert.equal(entry.video.duration,12);assert.equal(normalize(entry.svg),normalize(frameSvg(state.snapshot.draft,media,entry.frame)),`browser frame ${entry.frame} differs from approved snapshot`);}
const filter=browser.map(entry=>`eq(n\\,${entry.frame})`).join('+');
const child=spawn(resolve('.tmp/reel-editor-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe'),['-y','-hide_banner','-loglevel','error','-i',join(root,'demo.mp4'),'-vf',`select=${filter}`,'-vsync','0','-frames:v','6',join(root,'export-frame-%02d.png')],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let stderr='';child.stderr.on('data',b=>{stderr+=b;});await new Promise((resolveDone,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolveDone():reject(new Error(stderr)));});
const results=[],tiles=[];
for(let i=0;i<browser.length;i++){
  let svg=browser[i].svg;
  for(let n=1;n<=3;n++)svg=svg.replaceAll(`/__reel-editor/media/${n}`,`data:image/png;base64,${(await readFile(join(root,`fixture-${n}.png`))).toString('base64')}`);
  const preview=await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer();
  const decoded=await sharp(join(root,`export-frame-${String(i+1).padStart(2,'0')}.png`)).removeAlpha().raw().toBuffer();
  assert.equal(preview.length,decoded.length);let sum=0;for(let n=0;n<preview.length;n++)sum+=Math.abs(preview[n]-decoded[n]);const mae=sum/preview.length;
  assert(mae<2,`Unexpected preview/export raster difference at frame ${browser[i].frame}: ${mae}`);
  results.push({frame:browser[i].frame,time:browser[i].video.time,approvedSvgMatch:true,meanAbsoluteRgbError:mae});
  tiles.push({input:await sharp(preview,{raw:{width:1080,height:1920,channels:3}}).resize(180,320).png().toBuffer(),left:i*180,top:40});
  tiles.push({input:await sharp(decoded,{raw:{width:1080,height:1920,channels:3}}).resize(180,320).png().toBuffer(),left:i*180,top:400});
}
const captions=browser.map((entry,i)=>`<text x="${i*180+10}" y="28" fill="white" font-family="DejaVu Sans" font-size="18">${entry.video.time}s</text>`).join('');
tiles.push({input:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="760">${captions}<text x="10" y="385" fill="white" font-family="DejaVu Sans" font-size="18">Decoded MP4 (top: raster of actual browser SVG state)</text></svg>`),left:0,top:0});
await sharp({create:{width:1080,height:760,channels:3,background:'#102736'}}).composite(tiles).png().toFile(join(root,'comparison-contact-sheet.png'));
await writeFile(join(root,'preview-export-comparison.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
