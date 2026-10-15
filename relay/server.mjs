import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { CommandClock } from './commands.js';

const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const token=()=>randomBytes(32).toString('hex');
const code=()=>Array.from(randomBytes(8),x=>alphabet[x&31]).join('');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&/^[a-f0-9]{64}$/.test(a)&&/^[a-f0-9]{64}$/.test(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const normalCode=value=>typeof value==='string'?value.toUpperCase().replace(/[\s-]/g,''):'';
const types=new Set(['state','start','pause','resume','reset','speed']);
export async function createRelay({port=0,host='127.0.0.1',pairMs=120000,roomMs=21600000}={}){
  const rooms=new Map(), codes=new Map(), connections=new Set();
  let attemptWindow=Date.now(), joins=0, shuttingDown=false;
  function send(ws,message){if(ws?.readyState!==WebSocket.OPEN)return;if(ws.bufferedAmount>8192){ws.close(1013,'Slow peer; reconnect');return;}ws.send(JSON.stringify(message));}
  function remove(room){rooms.delete(room.id);if(room.code)codes.delete(room.code);for(const role of ['viewer','controller'])room[role]?.close(4008,'Pairing expired; pair again');}
  const server=http.createServer(async(req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname;
    if(path==='/health'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"ok":true,"build":"rectangle-relay-B2"}');return;}
    const files={'/':['./index.html','text/html'],'/index.html':['./index.html','text/html'],'/viewer.js':['./viewer.js','text/javascript'],
      '/commands.js':['./commands.js','text/javascript'],'/timing.js':['./timing.js','text/javascript']};
    if(req.method!=='GET'||!files[path]){res.writeHead(404);res.end();return;}
    try{const [file,mime]=files[path];const bytes=await readFile(new URL(file,import.meta.url));res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
      'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'"});res.end(bytes);}catch{res.writeHead(500);res.end();}
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:4096,perMessageDeflate:false});
  server.on('upgrade',(req,socket,head)=>{
    const origin=req.headers.origin;
    const allowed=new Set([`https://${req.headers.host}`,`http://${req.headers.host}`]);
    if(shuttingDown||req.url!=='/rectangle'||connections.size>=64||(origin&&!allowed.has(origin))){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));
  });
  wss.on('connection',ws=>{
    connections.add(ws);ws.alive=true;let room=null,role=null,windowAt=Date.now(),count=0;
    const deadline=setTimeout(()=>{if(!room)ws.close(4003,'Authentication timeout');},10000);deadline.unref();
    ws.on('error',()=>{});ws.on('pong',()=>{ws.alive=true;});
    ws.on('message',(data,binary)=>{
      if(binary){ws.close(1003,'Text only');return;}
      if(Date.now()-windowAt>1000){windowAt=Date.now();count=0;}if(++count>40){ws.close(4004,'Rate limit');return;}
      let m;try{m=JSON.parse(data.toString());}catch{ws.close(4004,'Invalid JSON');return;}
      if(!m||typeof m!=='object'){ws.close(4004,'Invalid message');return;}
      if(!room){
        if(m.type==='create'){
          if(rooms.size>=32){ws.close(1013,'Capacity; try later');return;}
          let pairCode;do{pairCode=code();}while(codes.has(pairCode));
          room={id:randomBytes(16).toString('hex'),code:pairCode,created:Date.now(),last:Date.now(),paired:false,viewerSecret:token(),controllerSecret:token(),viewer:ws,controller:null};
          role='viewer';rooms.set(room.id,room);codes.set(pairCode,room);
          send(ws,{type:'created',roomId:room.id,secret:room.viewerSecret,code:pairCode,expiresInMs:pairMs});
        }else if(m.type==='join'){
          if(Date.now()-attemptWindow>60000){attemptWindow=Date.now();joins=0;}if(++joins>60){ws.close(4003,'Pairing rate limit');return;}
          const candidate=codes.get(normalCode(m.code));
          if(!candidate||Date.now()-candidate.created>pairMs||candidate.controller){ws.close(4003,'Invalid or expired code');return;}
          room=candidate;role='controller';room.controller=ws;room.paired=true;codes.delete(room.code);room.code=null;
          send(ws,{type:'joined',roomId:room.id,secret:room.controllerSecret});
        }else if(m.type==='reconnect'){
          const candidate=rooms.get(m.roomId);const r=m.role;
          if(!candidate||!['viewer','controller'].includes(r)||!equal(m.secret,candidate[`${r}Secret`])||Date.now()-candidate.created>roomMs){ws.close(4008,'Session expired; pair again');return;}
          room=candidate;role=r;const previous=room[role];room[role]=ws;previous?.close(4004,'Replaced by this device');
          send(ws,{type:'restored',role,paired:room.paired,code:role==='viewer'?room.code:null});
        }else{ws.close(4003,'Pair first');return;}
        clearTimeout(deadline);room.last=Date.now();
        if(room.viewer?.readyState===WebSocket.OPEN&&room.controller?.readyState===WebSocket.OPEN){send(room.viewer,{type:'paired'});send(room.controller,{type:'needState'});}
        return;
      }
      room.last=Date.now();
      if(role==='viewer'){
        const valid=(m.type==='ping'&&typeof m.id==='string'&&m.id.length<=40)||m.type==='snapshot'||(m.type==='ack'&&Number.isSafeInteger(m.revision)&&m.revision>=0);
        if(!valid){ws.close(4004,'Viewer operation denied');return;}
        if(!room.controller){send(ws,{type:'peerDisconnected'});return;}
        send(room.controller,m);
      }else{
        const valid=(types.has(m.type)&&new CommandClock().apply(m,0))||(m.type==='pong'&&typeof m.id==='string'&&m.id.length<=40&&Number.isFinite(m.serverUnixMs));
        if(!valid){ws.close(4004,'Controller operation denied');return;}
        send(room.viewer,m);
      }
    });
    ws.on('close',()=>{clearTimeout(deadline);connections.delete(ws);if(room&&room[role]===ws){room[role]=null;room.last=Date.now();send(room[role==='viewer'?'controller':'viewer'],{type:'peerDisconnected'});}});
  });
  const cleanup=setInterval(()=>{
    const now=Date.now();for(const room of rooms.values())if((!room.paired&&now-room.created>pairMs)||now-room.created>roomMs||(!room.viewer&&!room.controller&&now-room.last>300000))remove(room);
    for(const ws of connections){if(!ws.alive){ws.terminate();continue;}ws.alive=false;ws.ping();}
  },25000);cleanup.unref();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  return {server,url:`ws://127.0.0.1:${server.address().port}/rectangle`,async close(){shuttingDown=true;clearInterval(cleanup);for(const ws of connections)ws.terminate();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const relay=await createRelay({port:Number(process.env.PORT||8787),host:'0.0.0.0'});
  console.log('PianoLens rectangle relay ready'); // Never log codes, credentials, URLs or payloads.
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{await relay.close();process.exit(0);});
}

