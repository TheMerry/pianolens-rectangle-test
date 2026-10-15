import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {HttpError} from './errors.mjs';
export {HttpError} from './errors.mjs';
const id=()=>randomBytes(16).toString('hex'),key=()=>randomBytes(32).toString('hex');
const digest=value=>createHash('sha256').update(value).digest();
export class LibraryStore{
  constructor(file,{maxLibraries=32,maxSongs=50,libraryBytes=50_000_000,totalBytes=250_000_000}={}){
    this.limits={maxLibraries,maxSongs,libraryBytes,totalBytes};this.db=new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS libraries(id TEXT PRIMARY KEY,read_hash BLOB NOT NULL,write_hash BLOB NOT NULL,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS songs(id TEXT PRIMARY KEY,library_id TEXT NOT NULL REFERENCES libraries(id),title TEXT NOT NULL,midi BLOB NOT NULL,sha TEXT NOT NULL,note_count INTEGER NOT NULL,duration REAL NOT NULL,created INTEGER NOT NULL,UNIQUE(library_id,sha));`);
  }
  create(){
    if(this.db.prepare('SELECT count(*) n FROM libraries').get().n>=this.limits.maxLibraries)throw new HttpError(429,'Library capacity reached');
    const value={id:id(),readKey:key(),writeKey:key()};
    this.db.prepare('INSERT INTO libraries VALUES(?,?,?,?)').run(value.id,digest(value.readKey),digest(value.writeKey),Date.now());return value;
  }
  authorize(libraryId,token,write=false){
    if(!/^[a-f0-9]{32}$/.test(libraryId)||!/^[a-f0-9]{64}$/.test(token||''))throw new HttpError(401,'Library access link required');
    const row=this.db.prepare('SELECT read_hash,write_hash FROM libraries WHERE id=?').get(libraryId),hash=digest(token);
    if(!row||!(timingSafeEqual(hash,row.write_hash)||(!write&&timingSafeEqual(hash,row.read_hash))))throw new HttpError(401,'Library access link is invalid');
  }
  list(libraryId){return this.db.prepare('SELECT id,title,note_count AS noteCount,duration,created,length(midi) AS bytes FROM songs WHERE library_id=? ORDER BY created DESC,id').all(libraryId);}
  song(libraryId,songId){
    if(!/^[a-f0-9]{32}$/.test(songId))throw new HttpError(404,'Song not found');
    const row=this.db.prepare('SELECT id,title,midi,note_count AS noteCount,duration FROM songs WHERE library_id=? AND id=?').get(libraryId,songId);
    if(!row)throw new HttpError(404,'Song not found');return {...row,midi:Buffer.from(row.midi).toString('base64')};
  }
  add(libraryId,title,bytes,summary){
    const sha=digest(bytes).toString('hex'),existing=this.db.prepare('SELECT id FROM songs WHERE library_id=? AND sha=?').get(libraryId,sha);
    if(existing)return {id:existing.id,duplicate:true};
    const usage=this.db.prepare('SELECT count(*) n,coalesce(sum(length(midi)),0) bytes FROM songs WHERE library_id=?').get(libraryId);
    const total=this.db.prepare('SELECT coalesce(sum(length(midi)),0) bytes FROM songs').get().bytes;
    if(usage.n>=this.limits.maxSongs||usage.bytes+bytes.length>this.limits.libraryBytes)throw new HttpError(413,'Library limit reached (50 songs / 50 MB)');
    if(total+bytes.length>this.limits.totalBytes)throw new HttpError(507,'Song storage is full');
    const songId=id();this.db.prepare('INSERT INTO songs VALUES(?,?,?,?,?,?,?,?)').run(songId,libraryId,title,bytes,sha,summary.noteCount,summary.duration,Date.now());
    return {id:songId,duplicate:false};
  }
  close(){this.db.close();}
}
