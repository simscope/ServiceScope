import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { checkCaptionBehavior } from './reel-caption-behavior-tests.mjs';

// Tiny deterministic hook/element driver for this component, not a browser or provider.
// Bundle the actual TSX; only React scheduling, icons and external API transports are isolated.
export async function checkCaptionComponent() {
  checkCaptionBehavior();
  const calls={publish:0,reconcile:0}, slots=[], pending=[]; let index=0, changed=false, tree;
  const hooks={
    useState(initial){const i=index++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;
      return [slots[i],value=>{const next=typeof value==='function'?value(slots[i]):value;if(next!==slots[i]){slots[i]=next;changed=true;}}];},
    useRef(initial){const i=index++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
    useEffect(fn,deps){const i=index++;if(!slots[i]||deps.some((v,n)=>v!==slots[i].deps[n])){pending.push(()=>{slots[i]?.cleanup?.();slots[i]={deps,cleanup:fn()};});}},
    element:(type,props)=>({type,props}),
    load:async()=>({configured:true,connected:true,facebookPublishingEnabled:true,facebookPageName:'ServiceScope',lastReelPublication:null,activeReelPublication:null}),
    publish:async()=>{calls.publish++;throw new Error('DISPATCH_FORBIDDEN');},reconcile:async()=>{calls.reconcile++;throw new Error('DISPATCH_FORBIDDEN');},
  };
  const output=await build({entryPoints:['src/components/portal/FacebookReelPublishPanel.tsx'],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',plugins:[{name:'isolated-caption',setup(b){
    b.onResolve({filter:/^(react(?:\/jsx-runtime)?|lucide-react)$|features\/meta-publishing\/clientApi$/},a=>({path:a.path,namespace:'isolated'}));
    b.onLoad({filter:/.*/,namespace:'isolated'},a=>({contents:a.path==='react'?`export const {useState,useRef,useEffect}=globalThis.driver;`:a.path==='react/jsx-runtime'?`export const jsx=globalThis.driver.element, jsxs=jsx, Fragment='fragment';`:a.path==='lucide-react'?`export const CheckCircle2='icon',Film='icon',RefreshCw='icon',X='icon';`:`export const loadFacebookPublishingStatus=globalThis.driver.load,publishFacebookReel=globalThis.driver.publish,reconcileFacebookReel=globalThis.driver.reconcile;`}));
  }}]});
  const sandbox={driver:hooks,exports:{},module:{exports:{}},console,crypto:{randomUUID:()=>`isolated-intent`}};sandbox.exports=sandbox.module.exports;
  vm.runInNewContext(output.outputFiles[0].text,sandbox);const Component=sandbox.module.exports.FacebookReelPublishPanel;
  let props={companyId:'company',jobId:'job',renderJobId:'render',videoUrl:'local-fixture',canPublish:true};
  async function render(){for(let pass=0;pass<15;pass++){changed=false;index=0;tree=Component(props);while(pending.length)pending.shift()();await Promise.resolve();if(!changed)return;}throw new Error('HOOK_RENDER_LOOP');}
  function nodes(value,out=[]){if(!value||typeof value!=='object')return out;if(Array.isArray(value)){value.forEach(v=>nodes(v,out));return out;}if(value.type){out.push(value);nodes(value.props?.children,out);}return out;}
  const text=v=>typeof v==='string'?v:Array.isArray(v)?v.map(text).join(''):v?.props?text(v.props.children):'';
  const button=name=>nodes(tree).find(n=>n.type==='button'&&text(n).includes(name));
  const textarea=()=>nodes(tree).find(n=>n.type==='textarea');const checkbox=()=>nodes(tree).find(n=>n.type==='input'&&n.props.type==='checkbox');
  async function click(name){assert(button(name),name);button(name).props.onClick();await render();}
  await render();await click('Prepare new Reel publication');assert.equal(textarea().props.value,'');assert.equal(checkbox().props.checked,false);
  await click('Cancel');props={...props,renderJobId:'render-2',initialCaption:'Exact editor Facebook caption'};await render();
  await click('Prepare new Reel publication');assert.equal(textarea().props.value,'Exact editor Facebook caption');
  checkbox().props.onChange({target:{checked:true}});await render();assert.equal(checkbox().props.checked,true);
  props={...props,initialCaption:'Late unseen replacement'};await render();assert.equal(textarea().props.value,'Exact editor Facebook caption');
  textarea().props.onChange({target:{value:'Manual caption'}});await render();assert.equal(checkbox().props.checked,false);
  props={...props,initialCaption:'Async caption'};await render();assert.equal(textarea().props.value,'Manual caption');await render();assert.equal(textarea().props.value,'Manual caption');
  for(const field of ['companyId','jobId','renderJobId']){props={...props,[field]:props[field]+'-new',initialCaption:'New scoped caption'};await render();assert.equal(textarea(),undefined);assert(!slots.some(s=>s?.current==='isolated-intent'));await click('Prepare new Reel publication');assert.equal(textarea().props.value,'New scoped caption');assert.equal(checkbox().props.checked,false);}
  await click('Cancel');props={...props,renderJobId:'async-untouched',initialCaption:undefined};await render();props={...props,initialCaption:'Loaded before review'};await render();
  await click('Prepare new Reel publication');assert.equal(textarea().props.value,'Loaded before review');assert.equal(checkbox().props.checked,false);
  assert.deepEqual(calls,{publish:0,reconcile:0});
  console.log('PASS actual Reel publish component A–G with isolated transports: object reset, default/editor caption, rerender/async/viewed/user-edit protection and zero publish/reconcile calls.');
}
if(process.argv[1]?.endsWith('reel-caption-component-tests.mjs'))await checkCaptionComponent();
