import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createPool } from '../db/pool.js';
import { calibrationReport } from './calibration.js';
import { calibrationMetadataSql,calibrationRowsSql,decodeCalibrationRows } from './calibration-source.js';
import { calibrationMarkdown } from './calibration-view.js';
const argv=process.argv.slice(2),input=argv.indexOf('--input'),outIndex=argv.indexOf('--output-dir');
const outputDir=outIndex>=0?argv[outIndex+1]!:'reports';
let snapshot:{metadata:Record<string,unknown>;rows:Array<Record<string,unknown>>};
if(input>=0)snapshot=JSON.parse(await readFile(argv[input+1]!,'utf8'));
else {
 if(!process.env.DATABASE_URL)throw new Error('Use --input exported-snapshot.json or a read-only DATABASE_URL');
 const pool=createPool({DATABASE_URL:process.env.DATABASE_URL,DATABASE_SSL:process.env.DATABASE_SSL==='true',DB_POOL_MAX:1});const client=await pool.connect();
 try{await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');await client.query("SET LOCAL statement_timeout='60s'");
  const metadata=(await client.query(calibrationMetadataSql)).rows[0];const rows=(await client.query(calibrationRowsSql)).rows;snapshot={metadata,rows};await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();await pool.end();}
}
const decoded=decodeCalibrationRows(snapshot.rows);
const generatedAt=new Date(String(snapshot.metadata.extracted_at??new Date().toISOString())).toISOString();
const report=calibrationReport(decoded.records,{...snapshot.metadata,matchesExamined:decoded.matchesExamined,matchesWithRoutes:decoded.matchesWithRoutes,matchesWithoutRoutes:decoded.matchesWithoutRoutes,snapshotCount:decoded.snapshotCount,
 snapshotSha256:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),baseBranch:'codex/odds-neighbor-reliability-v1',baseCommit:'0e5851de568242d900d7dd7a594e7bd893c41e81',realData:true},generatedAt);
await mkdir(outputDir,{recursive:true});await writeFile(`${outputDir}/odds-neighbor-calibration-v2.json`,JSON.stringify(report,null,2));
await writeFile(`${outputDir}/odds-neighbor-calibration-v2.md`,calibrationMarkdown(report));
const headers=['matchId','kickoffAt','competitionId','league','market','selection','line','rawSamples','settledSamples','usableSamples','highQuality','mediumQuality','lowQuality','averageSimilarity','sameLeague','crossLeague','unknownLeague','status','capReached'] as const;
const cell=(x:unknown)=>'"'+String(x??'').replaceAll('"','""')+'"';
await writeFile(`${outputDir}/odds-neighbor-calibration-v2-targets.csv`,[headers.join(','),...report.targets.map(t=>headers.map(k=>cell(t[k])).join(','))].join('\n'));
console.log(JSON.stringify({verdict:report.verdict,dataset:report.dataset,summary:report.summary,safety:report.safety}));
