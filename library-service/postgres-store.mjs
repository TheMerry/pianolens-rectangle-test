import {randomBytes, createHash, timingSafeEqual} from 'node:crypto';
import {HttpError} from './errors.mjs';

const id = () => randomBytes(16).toString('hex');
const key = () => randomBytes(32).toString('hex');
const digest = value => createHash('sha256').update(value).digest('hex');
const statement = (text, ...params) => ({text, params});
// All mutations take the same transaction lock. The following statements run
// with fresh READ COMMITTED snapshots, so concurrent uploads cannot exceed quotas.
const lock = statement('SELECT pg_advisory_xact_lock(72819406)');
const schema = [
  statement(`CREATE TABLE IF NOT EXISTS pianolens_libraries (
    id TEXT PRIMARY KEY, read_hash TEXT NOT NULL, write_hash TEXT NOT NULL, created BIGINT NOT NULL)`),
  statement(`CREATE TABLE IF NOT EXISTS pianolens_songs (
    id TEXT PRIMARY KEY, library_id TEXT NOT NULL REFERENCES pianolens_libraries(id),
    title TEXT NOT NULL, midi BYTEA NOT NULL, sha TEXT NOT NULL,
    note_count INTEGER NOT NULL, duration DOUBLE PRECISION NOT NULL, created BIGINT NOT NULL,
    UNIQUE(library_id, sha))`),
];

export class PostgresStore {
  constructor(transport, {maxLibraries=32, maxSongs=50, libraryBytes=50_000_000, totalBytes=250_000_000}={}) {
    this.transport = transport;
    this.limits = {maxLibraries, maxSongs, libraryBytes, totalBytes};
  }
  async initialize() { await this.transport.transaction([lock, ...schema]); return this; }
  async create() {
    const value = {id:id(), readKey:key(), writeKey:key()};
    const results = await this.transport.transaction([lock, statement(
      `INSERT INTO pianolens_libraries (id,read_hash,write_hash,created)
       SELECT $1,$2,$3,$4 WHERE (SELECT count(*) FROM pianolens_libraries) < $5 RETURNING id`,
      value.id, digest(value.readKey), digest(value.writeKey), Date.now(), this.limits.maxLibraries)]);
    if (!results[1].length) throw new HttpError(429, 'Library capacity reached');
    return value;
  }
  async authorize(libraryId, token, write=false) {
    if (!/^[a-f0-9]{32}$/.test(libraryId) || !/^[a-f0-9]{64}$/.test(token||''))
      throw new HttpError(401, 'Library access link required');
    const [row] = await this.transport.query(statement(
      'SELECT read_hash,write_hash FROM pianolens_libraries WHERE id=$1', libraryId));
    const hash = Buffer.from(digest(token));
    if (!row || !(timingSafeEqual(hash, Buffer.from(row.write_hash)) ||
      (!write && timingSafeEqual(hash, Buffer.from(row.read_hash)))))
      throw new HttpError(401, 'Library access link is invalid');
  }
  async list(libraryId) {
    const rows = await this.transport.query(statement(
      `SELECT id,title,note_count AS "noteCount",duration,created,octet_length(midi) AS bytes
       FROM pianolens_songs WHERE library_id=$1 ORDER BY created DESC,id`, libraryId));
    return rows.map(row => ({...row, created:Number(row.created)}));
  }
  async song(libraryId, songId) {
    if (!/^[a-f0-9]{32}$/.test(songId)) throw new HttpError(404, 'Song not found');
    const [row] = await this.transport.query(statement(
      `SELECT id,title,encode(midi,'base64') AS midi,note_count AS "noteCount",duration
       FROM pianolens_songs WHERE library_id=$1 AND id=$2`, libraryId, songId));
    if (!row) throw new HttpError(404, 'Song not found');
    // PostgreSQL's base64 encoder inserts line breaks after 76 characters.
    return {...row, midi:row.midi.replace(/\s/g, '')};
  }
  async add(libraryId, title, bytes, summary) {
    const sha = digest(bytes), songId = id();
    const results = await this.transport.transaction([
      lock,
      statement('SELECT id FROM pianolens_songs WHERE library_id=$1 AND sha=$2', libraryId, sha),
      statement(`SELECT count(*)::integer AS n,coalesce(sum(octet_length(midi)),0)::bigint AS bytes
        FROM pianolens_songs WHERE library_id=$1`, libraryId),
      statement('SELECT coalesce(sum(octet_length(midi)),0)::bigint AS bytes FROM pianolens_songs'),
      statement(`INSERT INTO pianolens_songs (id,library_id,title,midi,sha,note_count,duration,created)
        SELECT $1,$2,$3,decode($4,'base64'),$5,$6,$7,$8
        WHERE NOT EXISTS (SELECT 1 FROM pianolens_songs WHERE library_id=$2 AND sha=$5)
        AND (SELECT count(*) FROM pianolens_songs WHERE library_id=$2) < $9
        AND (SELECT coalesce(sum(octet_length(midi)),0) FROM pianolens_songs WHERE library_id=$2) + $10 <= $11
        AND (SELECT coalesce(sum(octet_length(midi)),0) FROM pianolens_songs) + $10 <= $12
        RETURNING id`, songId, libraryId, title, bytes.toString('base64'), sha,
        summary.noteCount, summary.duration, Date.now(), this.limits.maxSongs,
        bytes.length, this.limits.libraryBytes, this.limits.totalBytes),
    ]);
    if (results[1].length) return {id:results[1][0].id, duplicate:true};
    if (results[4].length) return {id:songId, duplicate:false};
    const usage = results[2][0];
    if (Number(usage.n) >= this.limits.maxSongs || Number(usage.bytes)+bytes.length > this.limits.libraryBytes)
      throw new HttpError(413, 'Library limit reached (50 songs / 50 MB)');
    throw new HttpError(507, 'Song storage is full');
  }
  async close() { await this.transport.close?.(); }
}

export async function openNeonStore(connectionString, limits) {
  let url;
  try { url = new URL(connectionString); } catch { throw Error('Set a valid Neon DATABASE_URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname.endsWith('.neon.tech') ||
      !url.username || !url.password || !['require','verify-full'].includes(url.searchParams.get('sslmode')))
    throw Error('DATABASE_URL must be a TLS-enabled Neon PostgreSQL connection');
  const {neon} = await import('@neondatabase/serverless');
  const sql = neon(connectionString);
  const transport = {
    query: ({text,params}) => sql.query(text, params, {fetchOptions:{signal:AbortSignal.timeout(15000)}}),
    transaction: statements => sql.transaction(statements.map(({text,params}) => sql.query(text,params)),
      {isolationLevel:'ReadCommitted', fetchOptions:{signal:AbortSignal.timeout(15000)}}),
  };
  return new PostgresStore(transport, limits).initialize();
}
