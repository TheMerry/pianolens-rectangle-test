import { CommandClock } from './commands.js';
import { rectangleAt } from './timing.js';
const canvas=document.getElementById('display'),ctx=canvas.getContext('2d',{alpha:false}),clock=new CommandClock();
let socket=null,credentials=null,pairCode=null,status='Connecting…',paired=false,overlay=true,handle=null,retry=null,deadline=null,bucket=-1,dirty=true,attempt=0,offset=null,ping=null,lastReport=0;
const report={build:'rectangle-relay-B2',connectionStatus:status,received:0,rejected:0,reconnects:0,lastRevision:null,lastPingRoundTripMs:null,lastCommandAgeEstimateMs:null,rafCallbacks:0,draws:0,drawCpuMaxMs:0,startedAtUnixMs:Date.now(),opticalFps:null};
try{credentials=JSON.parse(sessionStorage.getItem('pianolens.relay.viewer')||'null');}catch{}
const setStatus=value=>{status=value;report.connectionStatus=value;dirty=true;};
function clear(){clearTimeout(retry);clearTimeout(deadline);retry=deadline=null;}
function suspend(){clear();clock.freeze(performance.now());const old=socket;socket=null;old?.close(1000,'Surface hidden');setStatus('Paused while hidden');if(handle!==null)cancelAnimationFrame(handle);handle=null;}
function connect(){
  if(document.hidden||socket)return;
  setStatus('Connecting…');let ws;
  try{ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/rectangle`);}catch{setStatus('Browser refused connection');return;}
  socket=ws;paired=false;offset=null;
  deadline=setTimeout(()=>{if(socket===ws)ws.close();},15000);
  ws.onopen=()=>{if(socket!==ws)return;ws.send(JSON.stringify(credentials?{type:'reconnect',role:'viewer',...credentials}:{type:'create'}));};
  ws.onmessage=({data})=>{
    if(socket!==ws||typeof data!=='string'||data.length>4096)return;let m;try{m=JSON.parse(data);}catch{return;}
    if(m.type==='created'){
      credentials={roomId:m.roomId,secret:m.secret};pairCode=m.code;attempt=0;clearTimeout(deadline);deadline=null;
      try{sessionStorage.setItem('pianolens.relay.viewer',JSON.stringify(credentials));}catch{}
      setStatus('Enter this code on your phone');
    }else if(m.type==='restored'){
      pairCode=m.code;clearTimeout(deadline);deadline=null;attempt=0;setStatus(m.paired?'Waiting for phone to reconnect':'Enter this code on your phone');
    }else if(m.type==='paired'){
      paired=true;pairCode=null;overlay=false;setStatus('Phone connected');
      ping={id:Date.now().toString(),wall:Date.now(),mono:performance.now()};ws.send(JSON.stringify({type:'ping',id:ping.id}));
    }else if(m.type==='peerDisconnected'){
      paired=false;overlay=true;clock.freeze(performance.now());setStatus('Phone disconnected · Select to pair again');
    }else if(m.type==='pong'&&ping&&m.id===ping.id&&Number.isFinite(m.serverUnixMs)){
      const rtt=performance.now()-ping.mono;offset=m.serverUnixMs-(ping.wall+rtt/2);report.lastPingRoundTripMs=rtt;ping=null;ws.send('{"type":"snapshot"}');
    }else{
      const age=offset===null?0:Date.now()+offset-m.sentAt;
      if(paired&&clock.apply(m,performance.now(),Number.isFinite(age)?age:0)){
        report.received++;report.lastRevision=m.revision;report.lastCommandAgeEstimateMs=offset===null?null:Math.max(0,age);dirty=true;
        ws.send(JSON.stringify({type:'ack',revision:m.revision}));
      }else report.rejected++;
    }
  };
  ws.onerror=()=>{if(socket===ws)setStatus('Connection error · retrying');};
  ws.onclose=({code})=>{
    if(socket!==ws)return;socket=null;clear();paired=false;overlay=true;clock.freeze(performance.now());
    if(code===4008){credentials=null;pairCode=null;try{sessionStorage.removeItem('pianolens.relay.viewer');}catch{}setStatus('Pairing expired · getting new code');}
    else if(code===4003||code===4004){setStatus('Connection rejected · reopen this Web App');return;}
    else setStatus('Disconnected · rectangle frozen');
    if(!document.hidden){report.reconnects++;retry=setTimeout(connect,Math.min(30000,1000*2**Math.min(attempt++,5))+Math.random()*250);}
  };
}
function frame(now){
  handle=null;if(document.hidden)return;report.rafCallbacks++;const next=Math.floor(now*30/1000);
  if(now-lastReport>=1000){canvas.dataset.connection=JSON.stringify(report);lastReport=now;}
  if(next!==bucket&&(dirty||clock.playing)){
    const start=performance.now();ctx.fillStyle='#000';ctx.fillRect(0,0,600,600);
    const r=rectangleAt(clock.value(now));ctx.fillStyle='#fff';ctx.fillRect(r.x,r.y,r.width,r.height);
    if(overlay||!paired){ctx.textAlign='center';ctx.fillStyle='#fff';ctx.font='22px sans-serif';ctx.fillText(status,300,90,560);
      if(pairCode){ctx.font='bold 48px monospace';ctx.fillText(pairCode.slice(0,4)+'–'+pairCode.slice(4),300,165);ctx.font='20px sans-serif';ctx.fillText('PianoLens phone app → Internet connection',300,210,560);}
      else if(paired){ctx.font='18px sans-serif';ctx.fillText(`Received ${report.received} · revision ${report.lastRevision??'—'} · RTT ${report.lastPingRoundTripMs?.toFixed(0)??'—'} ms`,300,140,560);}
    }
    report.draws++;report.drawCpuMaxMs=Math.max(report.drawCpuMaxMs,performance.now()-start);dirty=false;bucket=next;
  }
  handle=requestAnimationFrame(frame);
}
function showStatus(){
  if(!paired&&!pairCode&&socket?.readyState===WebSocket.OPEN){credentials=null;try{sessionStorage.removeItem('pianolens.relay.viewer');}catch{}socket.close(1000,'New pairing requested');return;}
  overlay=!overlay;dirty=true;
}
canvas.addEventListener('click',showStatus);canvas.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showStatus();}});canvas.focus({preventScroll:true});
document.addEventListener('visibilitychange',()=>{if(document.hidden)suspend();else{connect();if(handle===null)handle=requestAnimationFrame(frame);}});
addEventListener('pagehide',suspend);addEventListener('pageshow',()=>{if(!document.hidden){connect();if(handle===null)handle=requestAnimationFrame(frame);}});
// Device-local DOM diagnostics are updated only while visible; they contain no secrets or code.
if(!document.hidden){connect();handle=requestAnimationFrame(frame);}
