import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createLibraryServer} from './server.mjs';
const scale=await readFile(new URL('./test-scale.base64',import.meta.url),'utf8').then(value=>Buffer.from(value.trim(),'base64')).catch(()=>readFile(new URL('../validation/midi/PianoLens-scale-C4-C5.mid',import.meta.url)));
async function fixture(options,run){
  const parent=path.resolve(os.tmpdir()),dir=await mkdtemp(path.join(parent,'pianolens-library-test-')),file=path.join(dir,'library.sqlite');
  const config={file,origins:['https://player.example'],...options};
  const value={service:await createLibraryServer(config),async restart(){await this.service.close();this.service=await createLibraryServer(config);},async request(route,{method='GET',key,body,headers={}}={}){
    return fetch(this.service.url+route,{method,headers:{...(key?{Authorization:'Bearer '+key}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  }};
  try{await run(value);}finally{await value.service.close();assert.equal(path.dirname(path.resolve(dir)),parent);assert.ok(path.basename(dir).startsWith('pianolens-library-test-'));await rm(dir,{recursive:true,force:true});}
}
const create=async f=>{const response=await f.request('/api/libraries',{method:'POST',body:{}});assert.equal(response.status,201);return response.json();};
const route=lib=>'/api/libraries/'+lib.id+'/songs';
const upload=(f,lib,midi=scale,title='Test scale')=>f.request(route(lib),{method:'POST',key:lib.writeKey,body:{title,midi:midi.toString('base64')}});
test('upload, list and download use real MIDI validation; retries deduplicate',()=>fixture({},async f=>{
  const lib=await create(f),response=await upload(f,lib);assert.equal(response.status,201);const added=await response.json();assert.equal(added.noteCount,8);
  const again=await upload(f,lib);assert.equal(again.status,200);assert.equal((await again.json()).id,added.id);
  const listed=await(await f.request(route(lib),{key:lib.readKey})).json();assert.equal(listed.songs.length,1);assert.equal(listed.songs[0].title,'Test scale');assert.equal(listed.songs[0].noteCount,8);
  assert.ok(!JSON.stringify(listed).includes(lib.writeKey));assert.ok(!JSON.stringify(listed).includes(lib.readKey));
  const song=await(await f.request(route(lib)+'/'+added.id,{key:lib.readKey})).json();assert.deepEqual(Buffer.from(song.midi,'base64'),scale);
}));
test('uploaded files and hashed access survive a server restart',()=>fixture({},async f=>{
  const lib=await create(f),song=await(await upload(f,lib)).json();await f.restart();
  const listed=await(await f.request(route(lib),{key:lib.readKey})).json();assert.equal(listed.songs[0].id,song.id);
  const downloaded=await(await f.request(route(lib)+'/'+song.id,{key:lib.readKey})).json();assert.equal(downloaded.midi,scale.toString('base64'));
}));
test('read-only links cannot upload and libraries cannot read each other',()=>fixture({},async f=>{
  const one=await create(f),two=await create(f),song=await(await upload(f,one)).json();
  assert.equal((await f.request(route(one))).status,401);
  assert.equal((await f.request(route(one),{key:two.readKey})).status,401);
  assert.equal((await f.request(route(one),{method:'POST',key:one.readKey,body:{title:'Denied',midi:scale.toString('base64')}})).status,401);
  assert.equal((await f.request(route(two)+'/'+song.id,{key:two.readKey})).status,404);
}));
test('invalid MIDI, unsupported format, excessive size and note counts are rejected',()=>fixture({},async f=>{
  const lib=await create(f);assert.equal((await upload(f,lib,Buffer.from('<html>not MIDI</html>'))).status,422);
  const format=Buffer.from(scale);format[9]=2;assert.equal((await upload(f,lib,format)).status,422);
  assert.equal((await upload(f,lib,Buffer.alloc(5_000_001))).status,413);
  const track=Buffer.concat([...Array.from({length:20001},()=>Buffer.from([0,0x90,60,80,1,0x80,60,0])),Buffer.from([0,255,47,0])]);
  const header=Buffer.from([77,84,104,100,0,0,0,6,0,0,0,1,1,224,77,84,114,107,0,0,0,0]);header.writeUInt32BE(track.length,18);
  assert.equal((await upload(f,lib,Buffer.concat([header,track]))).status,422);
  const invalid=await f.request(route(lib),{method:'POST',key:lib.writeKey,body:{title:'Bad encoding',midi:'!!!!'}});assert.equal(invalid.status,400);
  assert.equal((await(await f.request(route(lib),{key:lib.readKey})).json()).songs.length,0);
}));
test('quotas are enforced without corrupting existing songs',()=>fixture({limits:{maxSongs:1}},async f=>{
  const lib=await create(f);assert.equal((await upload(f,lib)).status,201);
  const distinct=Buffer.from(scale);distinct[distinct.indexOf(Buffer.from([0x90,60]))+1]=61;
  assert.equal((await upload(f,lib,distinct,'Second song')).status,413);
  assert.equal((await(await f.request(route(lib),{key:lib.readKey})).json()).songs.length,1);
}));
test('CORS is exact, preflight is bounded, and library creation is rate limited',()=>fixture({createLimit:1},async f=>{
  const denied=await f.request('/health',{headers:{Origin:'https://untrusted.example'}});assert.equal(denied.status,403);assert.equal(denied.headers.get('access-control-allow-origin'),null);
  const allowed=await f.request('/health',{headers:{Origin:'https://player.example'}});assert.equal(allowed.status,200);assert.equal(allowed.headers.get('access-control-allow-origin'),'https://player.example');
  assert.equal((await f.request('/api/libraries',{method:'OPTIONS',headers:{Origin:'https://player.example'}})).status,204);
  await create(f);assert.equal((await f.request('/api/libraries',{method:'POST',body:{}})).status,429);
}));
test('concurrent validation is bounded and releases capacity after completing',()=>fixture({validateMidi:()=>new Promise(resolve=>releases.push(()=>resolve({noteCount:8,duration:6})))},async f=>{
  const lib=await create(f),one=upload(f,lib),two=upload(f,lib);const until=Date.now()+3000;
  while(releases.length<2&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(releases.length,2);
  assert.equal((await upload(f,lib)).status,429);for(const release of releases.splice(0))release();
  assert.deepEqual([(await one).status,(await two).status].sort(),[200,201]);
}));
const releases=[];
test('production-style setup key prevents strangers creating libraries',()=>fixture({createKey:'a'.repeat(64)},async f=>{
  assert.equal((await f.request('/api/libraries',{method:'POST',body:{}})).status,401);
  assert.equal((await f.request('/api/libraries',{method:'POST',body:{},headers:{'X-PianoLens-Setup':'b'.repeat(64)}})).status,401);
  assert.equal((await f.request('/api/libraries',{method:'POST',body:{},headers:{'X-PianoLens-Setup':'a'.repeat(64)}})).status,201);
}));
