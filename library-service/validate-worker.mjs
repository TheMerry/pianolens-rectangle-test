import {parentPort,workerData} from 'node:worker_threads';
import {loadMidi} from './midi.js';
try{
  const notes=loadMidi(new Uint8Array(workerData));
  if(notes.length>20000)throw Error('This player supports up to 20,000 notes per song');
  const duration=notes.reduce((end,n)=>Math.max(end,n.startTime+n.duration),0);
  if(!Number.isFinite(duration)||duration>86400)throw Error('Song duration exceeds 24 hours');
  parentPort.postMessage({noteCount:notes.length,duration});
}catch(error){parentPort.postMessage({error:String(error.message||'Invalid MIDI file').slice(0,180)});}
