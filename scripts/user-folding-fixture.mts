import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
const root=process.cwd();
const manifest=JSON.parse(readFileSync('manifest.json','utf8'));
const mock=`const handlers=new Set(),changes=new Set(),pending=new Map(),channel=new BroadcastChannel('chatfolder-fixture');
const defaultSettings={enabled:true,defaultCollapsed:true,userEnabled:true,userLines:1};
function current(){return {...defaultSettings,...JSON.parse(localStorage.getItem('foldSettings')||'{}')}}
function notify(oldValue,newValue){const changed={};for(const key of Object.keys(defaultSettings))if(oldValue[key]!==newValue[key])changed[key]={oldValue:oldValue[key],newValue:newValue[key]};changes.forEach(fn=>fn(changed,'local'))}
channel.onmessage=event=>{const m=event.data;if(m.request){for(const fn of handlers)fn(m.request,{},response=>channel.postMessage({id:m.id,response}))}else{const resolve=pending.get(m.id);if(resolve){pending.delete(m.id);resolve(m.response)}}};
addEventListener('storage',e=>{if(e.key==='foldSettings')notify({...defaultSettings,...JSON.parse(e.oldValue||'{}')},current())});
globalThis.chrome={runtime:{getManifest:()=>({version:'${manifest.version}'}),onMessage:{addListener:fn=>handlers.add(fn),removeListener:fn=>handlers.delete(fn)}},storage:{local:{get:async defaults=>({...defaults,...current()}),set:async delta=>{const old=current();localStorage.setItem('foldSettings',JSON.stringify({...old,...delta}));notify(old,current())}},onChanged:{addListener:fn=>changes.add(fn),removeListener:fn=>changes.delete(fn)}},tabs:{query:async()=>[{id:1,url:'https://chatgpt.com/c/fixture'}],sendMessage:async(id,request)=>{if(handlers.size){let response;for(const fn of handlers)fn(request,{},r=>response=r);return response}return await new Promise(resolve=>{const id=crypto.randomUUID();pending.set(id,resolve);channel.postMessage({id,request});setTimeout(()=>{if(pending.has(id)){pending.delete(id);resolve(undefined)}},1500)})},reload:async()=>{}},scripting:{executeScript:async()=>[{frameId:0,result:{extensionVersion:'${manifest.version}',pageVersion:'${manifest.version}'}}],insertCSS:async()=>{}}};`;
const allowed=new Set(['/tests/fixtures/user-folding.html','/popup/popup.html','/popup/popup.css','/build/popup/popup.js',...manifest.content_scripts[0].js.map((p:string)=>'/'+p)]);
createServer((req,res)=>{
  const path=new URL(req.url||'/','http://localhost').pathname;
  if(path==='/runtime.js'){res.setHeader('Content-Type','text/javascript');res.end(mock);return}
  if(!allowed.has(path)){res.writeHead(404).end();return}
  let text=readFileSync(join(root,path.slice(1)),'utf8');
  if(path.endsWith('.html'))text=text.replace('</head>','<script src="/runtime.js"></script></head>');
  if(path.includes('user-folding.html'))text=text.replace('</body>',manifest.content_scripts[0].js.slice(0,-1).map((p:string)=>'<script src="/'+p+'"></script>').join('')+'<script>const resolve=ChatFold.resolve;ChatFold.resolve=()=>resolve({hostname:"chatgpt.com"});</script><script src="/'+manifest.content_scripts[0].js.at(-1)+'"></script></body>');
  res.setHeader('Content-Type',path.endsWith('.html')?'text/html;charset=utf-8':path.endsWith('.css')?'text/css':'text/javascript');res.end(text);
}).listen(29848,'127.0.0.1',()=>console.log('Fixture: http://127.0.0.1:29848/tests/fixtures/user-folding.html'));
