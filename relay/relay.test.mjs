import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {createRelay} from './server.mjs';
function inbox(ws){const queue=[],waiting=[];ws.on('message',bytes=>{const m=JSON.parse(bytes);if(waiting.length)waiting.shift()(m);else queue.push(m);});return()=>queue.length?Promise.resolve(queue.shift()):new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Message timeout')),2000);waiting.push(m=>{clearTimeout(timeout);resolve(m);});});}
async function client(url){const ws=new WebSocket(url);const next=inbox(ws);await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});return{ws,next,send:m=>ws.send(JSON.stringify(m))};}
async function closed(ws){if(ws.readyState===WebSocket.CLOSED)return;return new Promise(resolve=>ws.once('close',code=>resolve(code)));}
const state=(revision,type='state')=>({v:1,type,sessionId:'android',revision,positionMs:1500,speed:.5,playing:true,sentAt:Date.now()});
test('one-time short code pairs roles, commands and acknowledgements traverse real sockets',async()=>{
  const relay=await createRelay();try{
    const viewer=await client(relay.url);viewer.send({type:'create'});const created=await viewer.next();assert.match(created.code,/^[A-HJ-NP-Z2-9]{8}$/);
    const phone=await client(relay.url);phone.send({type:'join',code:created.code.slice(0,4)+'-'+created.code.slice(4)});const joined=await phone.next();assert.equal(joined.type,'joined');assert.equal((await viewer.next()).type,'paired');assert.equal((await phone.next()).type,'needState');
    for(const [i,type] of ['start','pause','resume','reset','speed'].entries()){phone.send(state(i,type));assert.equal((await viewer.next()).type,type);viewer.send({type:'ack',revision:i});assert.equal((await phone.next()).revision,i);}
    const duplicate=await client(relay.url);duplicate.send({type:'join',code:created.code});assert.equal(await closed(duplicate.ws),4003);
    viewer.ws.close();assert.equal((await phone.next()).type,'peerDisconnected');
    const restored=await client(relay.url);restored.send({type:'reconnect',role:'viewer',roomId:created.roomId,secret:created.secret});assert.equal((await restored.next()).type,'restored');assert.equal((await restored.next()).type,'paired');assert.equal((await phone.next()).type,'needState');
  }finally{await relay.close();}
});
test('expired pairing codes and invalid credentials are rejected without crashing the service',async()=>{
  const relay=await createRelay({pairMs:1});try{
    const viewer=await client(relay.url);viewer.send({type:'create'});const created=await viewer.next();await new Promise(resolve=>setTimeout(resolve,5));
    const expired=await client(relay.url);expired.send({type:'join',code:created.code});assert.equal(await closed(expired.ws),4003);
    const bad=await client(relay.url);bad.send({type:'reconnect',role:'viewer',roomId:created.roomId,secret:'é'.repeat(64)});assert.equal(await closed(bad.ws),4008);
    const again=await client(relay.url);again.send({type:'create'});assert.equal((await again.next()).type,'created');
  }finally{await relay.close();}
});
test('viewer cannot submit playback commands; unrelated rooms cannot receive them',async()=>{
  const relay=await createRelay();try{
    const viewer=await client(relay.url);viewer.send({type:'create'});await viewer.next();viewer.send(state(1,'start'));assert.equal(await closed(viewer.ws),4004);
    const bad=await client(relay.url);bad.send({type:'join',code:'WRONG123'});assert.equal(await closed(bad.ws),4003);
    const one=await client(relay.url);one.send({type:'create'});const created=await one.next();
    const other=await client(relay.url);other.send({type:'create'});await other.next();let leaked=false;other.ws.once('message',()=>{leaked=true;});
    const phone=await client(relay.url);phone.send({type:'join',code:created.code});await phone.next();await phone.next();await one.next();
    phone.send(state(2,'start'));assert.equal((await one.next()).type,'start');await new Promise(resolve=>setTimeout(resolve,25));assert.equal(leaked,false);
  }finally{await relay.close();}
});
test('health and asset routes expose no room credentials and reject other files',async()=>{
  const relay=await createRelay();try{
    const base=relay.url.replace('ws:','http:').replace('/rectangle','');
    assert.deepEqual(await (await fetch(base+'/health')).json(),{ok:true,build:'hybrid-piano-C1'});
    const page=await fetch(base+'/');assert.equal(page.status,200);assert.equal(page.headers.get('cache-control'),'no-store');
    assert.equal((await fetch(base+'/server.mjs')).status,404);
  }finally{await relay.close();}
});
test('piano room forwards bounded song/state packets and isolates rectangle controllers',async()=>{
  const relay=await createRelay();try{
    const viewer=await client(relay.url);viewer.send({type:'create',kind:'piano'});const created=await viewer.next();
    const wrong=await client(relay.url);wrong.send({type:'join',code:created.code});assert.equal(await closed(wrong.ws),4003);
    const phone=await client(relay.url);phone.send({type:'join',kind:'piano',code:created.code});await phone.next();await phone.next();await viewer.next();
    const packets=[{type:'loadSong',v:2,songId:'test',packetId:1,title:'Scale',count:1,groupCount:1,endMs:500},
      {type:'songChunk',songId:'test',packetId:2,offset:0,notes:[[60,0,500,1,0]]},
      {type:'lessonState',v:2,songId:'test',packetId:3,epoch:1,revision:1,positionMs:-2000,speed:.75,playing:true,waiting:false,mode:'wait',expectedIndex:0,confirmedThrough:-1,sentAt:Date.now(),showKeyboard:true}];
    for(const packet of packets){phone.send(packet);assert.deepEqual(await viewer.next(),packet);viewer.send({type:'lessonAck',packetId:packet.packetId});assert.equal((await phone.next()).packetId,packet.packetId);}
    phone.send({...packets[2],expectedIndex:1,confirmedThrough:-1,packetId:4});assert.equal(await closed(phone.ws),4004);
    const base=relay.url.replace('ws:','http:').replace('/rectangle','');assert.equal((await fetch(base+'/piano')).status,200);assert.equal((await fetch(base+'/piano.js')).status,200);
  }finally{await relay.close();}
});
