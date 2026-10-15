import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {PGlite} from '@electric-sql/pglite';
import {PostgresStore,openNeonStore} from './postgres-store.mjs';
import {createLibraryServer} from './server.mjs';

const scale=await readFile(new URL('./test-scale.base64',import.meta.url),'utf8')
  .then(value=>Buffer.from(value.trim(),'base64'))
  .catch(()=>readFile(new URL('../validation/midi/PianoLens-scale-C4-C5.mid',import.meta.url)));
const summary={noteCount:8,duration:5.75};
async function open(file,limits){
  const db=await PGlite.create(file);
  const transport={
    query:async({text,params})=>(await db.query(text,params)).rows,
    transaction:statements=>db.transaction(async tx=>{
      const results=[];
      for(const {text,params} of statements)results.push((await tx.query(text,params)).rows);
      return results;
    }),
    close:()=>db.close(),
  };
  return {db,store:await new PostgresStore(transport,limits).initialize()};
}
async function fixture(limits,run){
  const root=path.resolve(os.tmpdir()),dir=await mkdtemp(path.join(root,'pianolens-postgres-test-'));
  const file=path.join(dir,'postgres');
  const f={...await open(file,limits),async restart(){await this.store.close();Object.assign(this,await open(file,limits));}};
  try{await run(f);}finally{
    await f.store.close();assert.equal(path.dirname(path.resolve(dir)),root);
    assert.ok(path.basename(dir).startsWith('pianolens-postgres-test-'));await rm(dir,{recursive:true,force:true});
  }
}
test('PostgreSQL: real SQL preserves bytes, timing, titles and hashed access across restart',()=>fixture({},async f=>{
  const lib=await f.store.create();
  const hostileTitle="Scale'); DROP TABLE pianolens_songs; --";
  const song=await f.store.add(lib.id,hostileTitle,scale,summary);
  const raw=(await f.db.query('SELECT read_hash,write_hash FROM pianolens_libraries')).rows[0];
  assert.notEqual(raw.read_hash,lib.readKey);assert.notEqual(raw.write_hash,lib.writeKey);
  await f.restart();await f.store.authorize(lib.id,lib.readKey);
  const downloaded=await f.store.song(lib.id,song.id);
  assert.equal(downloaded.midi,scale.toString('base64'));assert.equal(downloaded.duration,5.75);
  assert.equal(downloaded.title,hostileTitle);assert.equal(downloaded.noteCount,8);
  assert.equal((await f.store.list(lib.id))[0].bytes,scale.length);
  assert.equal(typeof (await f.store.list(lib.id))[0].created,'number');
}));
test('PostgreSQL: read/write permissions and library isolation match the local adapter',()=>fixture({},async f=>{
  const one=await f.store.create(),two=await f.store.create();
  await f.store.authorize(one.id,one.writeKey,true);
  await assert.rejects(f.store.authorize(one.id,one.readKey,true),{status:401});
  await assert.rejects(f.store.authorize(one.id,two.readKey),{status:401});
  await assert.rejects(f.store.authorize(one.id,'missing'),{status:401});
  const song=await f.store.add(one.id,'Scale',scale,summary);
  await assert.rejects(f.store.song(two.id,song.id),{status:404});
}));
test('PostgreSQL: concurrent duplicate uploads deduplicate and distinct uploads cannot exceed quota',()=>fixture({maxSongs:1,maxLibraries:1},async f=>{
  const lib=await f.store.create();await assert.rejects(f.store.create(),{status:429});
  const results=await Promise.all([f.store.add(lib.id,'One',scale,summary),f.store.add(lib.id,'Two',scale,summary)]);
  assert.equal(results[0].id,results[1].id);assert.equal(results.filter(r=>r.duplicate).length,1);
  await assert.rejects(f.store.add(lib.id,'Distinct',Buffer.concat([scale,Buffer.from([0])]),summary),{status:413});
  assert.equal((await f.store.list(lib.id)).length,1);
}));
test('PostgreSQL: storage byte caps reject writes without damaging saved files',()=>fixture({libraryBytes:scale.length,totalBytes:scale.length},async f=>{
  const one=await f.store.create(),two=await f.store.create();
  const song=await f.store.add(one.id,'Scale',scale,summary);
  await assert.rejects(f.store.add(two.id,'Over global limit',scale,summary),{status:507});
  await assert.rejects(f.store.add(one.id,'Over library limit',Buffer.concat([scale,Buffer.from([0])]),summary),{status:413});
  assert.equal((await f.store.song(one.id,song.id)).midi,scale.toString('base64'));
}));
test('PostgreSQL: HTTP upload uses real MIDI validation and read-only download',()=>fixture({},async f=>{
  const service=await createLibraryServer({store:f.store,createKey:'a'.repeat(64)});
  try{
    const create=await fetch(service.url+'/api/libraries',{method:'POST',headers:{'X-PianoLens-Setup':'a'.repeat(64)}});
    assert.equal(create.status,201);const lib=await create.json(),route=service.url+'/api/libraries/'+lib.id+'/songs';
    const upload=await fetch(route,{method:'POST',headers:{Authorization:'Bearer '+lib.writeKey,'Content-Type':'application/json'},body:JSON.stringify({title:'Postgres scale',midi:scale.toString('base64')})});
    assert.equal(upload.status,201);const song=await upload.json();assert.equal(song.noteCount,8);
    const downloaded=await fetch(route+'/'+song.id,{headers:{Authorization:'Bearer '+lib.readKey}});
    assert.equal((await downloaded.json()).midi,scale.toString('base64'));
    const denied=await fetch(route,{method:'POST',headers:{Authorization:'Bearer '+lib.readKey}});assert.equal(denied.status,401);
  }finally{
    // fixture owns the database; stop HTTP without closing it twice.
    await new Promise(resolve=>service.server.close(resolve));
  }
}));
test('Neon connection settings reject non-Neon or non-TLS destinations before networking',async()=>{
  await assert.rejects(openNeonStore('postgresql://user:secret@example.com/db?sslmode=require'));
  await assert.rejects(openNeonStore('postgresql://user:secret@ep-test.neon.tech/db'));
  await assert.rejects(openNeonStore('invalid'));
});
