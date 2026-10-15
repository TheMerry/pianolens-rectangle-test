import http from 'node:http';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Worker} from 'node:worker_threads';
import {timingSafeEqual} from 'node:crypto';
import {LibraryStore,HttpError} from './store.mjs';
const MAX_FILE=5_000_000,MAX_BODY=6_700_000;
function validate(bytes){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./validate-worker.mjs',import.meta.url),{workerData:bytes,resourceLimits:{maxOldGenerationSizeMb:64}});
    let settled=false;const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate();error?reject(error):resolve(value);};
    const timer=setTimeout(()=>finish(new HttpError(422,'MIDI validation took too long')),3000);
    worker.once('message',m=>m.error?finish(new HttpError(422,m.error)):finish(null,m));
    worker.once('error',()=>finish(new HttpError(422,'MIDI could not be processed within the resource limit')));
    worker.once('exit',()=>{if(!settled)finish(new HttpError(422,'MIDI validation interrupted'));});
  });
}
async function body(req){
  if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new HttpError(415,'JSON upload required');
  if(Number(req.headers['content-length'])>MAX_BODY)throw new HttpError(413,'MIDI exceeds 5 MB');
  let size=0;const parts=[];for await(const part of req){size+=part.length;if(size>MAX_BODY)throw new HttpError(413,'MIDI exceeds 5 MB');parts.push(part);}
  try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new HttpError(400,'Invalid upload');}
}
export async function createLibraryServer({file,store:providedStore,host='127.0.0.1',port=0,origins=['https://pianolens-standalone.onrender.com'],limits,createLimit=10,createKey,validateMidi=validate}={}){
  if(!file&&!providedStore)throw Error('Explicit database store required');
  if(createKey&&!/^[a-f0-9]{64}$/.test(createKey))throw Error('Invalid private setup key');
  const store=providedStore||new LibraryStore(file,limits),allowed=new Set(origins);let active=0,createAt=Date.now(),creates=0;
  const server=http.createServer(async(req,res)=>{
    const reply=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(JSON.stringify(value));};
    try{
      const origin=req.headers.origin;
      if(origin&&!allowed.has(origin))throw new HttpError(403,'Origin is not permitted');
      if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
      if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Authorization,Content-Type,X-PianoLens-Setup');res.writeHead(204);res.end();return;}
      if(req.url==='/health'&&req.method==='GET'){reply(200,{ok:true,build:'library-v1'});return;}
      if(req.url==='/api/libraries'&&req.method==='POST'){
        const supplied=req.headers['x-pianolens-setup'];
        if(createKey&&(typeof supplied!=='string'||!/^[a-f0-9]{64}$/.test(supplied)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(createKey))))throw new HttpError(401,'Open your private setup link to create a library');
        if(Date.now()-createAt>3600000){createAt=Date.now();creates=0;}if(++creates>createLimit)throw new HttpError(429,'Please wait before creating another library');
        reply(201,await store.create());return;
      }
      const match=/^\/api\/libraries\/([a-f0-9]{32})\/songs(?:\/([a-f0-9]{32}))?$/.exec(req.url||'');
      if(!match)throw new HttpError(404,'Not found');
      const [,libraryId,songId]=match,token=/^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization||'')?.[1];
      await store.authorize(libraryId,token,req.method!=='GET');
      if(req.method==='GET'){reply(200,songId?await store.song(libraryId,songId):{songs:await store.list(libraryId)});return;}
      if(req.method!=='POST'||songId)throw new HttpError(405,'Method not allowed');
      if(active>=2)throw new HttpError(429,'Another upload is being checked; try again shortly');
      active++;
      try{
        const data=await body(req);
        if(typeof data.title!=='string'||!data.title.trim()||data.title.length>120)throw new HttpError(400,'Use a song title of 1–120 characters');
        if(typeof data.midi!=='string'||data.midi.length>6_666_668||!data.midi.length||data.midi.length%4||/[^A-Za-z0-9+/=]/.test(data.midi))throw new HttpError(400,'Invalid MIDI encoding');
        const bytes=Buffer.from(data.midi,'base64');
        if(bytes.toString('base64')!==data.midi)throw new HttpError(400,'Invalid MIDI encoding');
        if(bytes.length>MAX_FILE)throw new HttpError(413,'MIDI exceeds 5 MB');
        if(bytes.length<14||bytes.subarray(0,4).toString('ascii')!=='MThd')throw new HttpError(422,'Choose a standard .mid or .midi file');
        const summary=await validateMidi(bytes),result=await store.add(libraryId,data.title.trim(),bytes,summary);
        reply(result.duplicate?200:201,{...result,...summary});
      }finally{active--;}
    }catch(error){if(!res.writableEnded)reply(error instanceof HttpError?error.status:500,{error:error instanceof HttpError?error.message:'Library service unavailable'});}
  });
  server.requestTimeout=20000;server.headersTimeout=10000;
  server.maxConnections=64;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  return {server,url:`http://127.0.0.1:${server.address().port}`,async close(){await new Promise(resolve=>server.close(resolve));await store.close();}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  // Hosted deployments use external durable storage, never Render's ephemeral disk.
  // Explicit SQLite paths remain available for local development and existing tests.
  const directory=process.env.PIANOLENS_DATA_DIR,connection=process.env.DATABASE_URL;
  if(!connection&&!directory)throw Error('Set DATABASE_URL for free persistent storage');
  const createKey=process.env.PIANOLENS_CREATE_KEY;if(!/^[a-f0-9]{64}$/.test(createKey||''))throw Error('Set a private 256-bit PIANOLENS_CREATE_KEY');
  let store;
  if(connection){
    try{const {openNeonStore}=await import('./postgres-store.mjs');store=await openNeonStore(connection);}
    catch{console.error('Persistent database unavailable; verify the Neon connection in server settings.');process.exit(1);}
  }else await mkdir(directory,{recursive:true});
  const service=await createLibraryServer({store,file:store?undefined:path.join(directory,'library.sqlite'),host:'0.0.0.0',port:Number(process.env.PORT||8790),createKey,origins:(process.env.PIANOLENS_ORIGINS||'https://pianolens-standalone.onrender.com').split(',')});
  console.log('PianoLens MIDI library ready'); // Never log credentials, URLs, MIDI contents or names.
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await service.close();process.exit(0);});
}
