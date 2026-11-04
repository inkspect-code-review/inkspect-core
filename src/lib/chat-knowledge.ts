import {createHash} from "node:crypto";
import {applicationPool} from "./application-database";
import {ReviewError} from "./review-access";
import type {ChatKnowledgeReference,ChatKnowledgeResult} from "./chat-review-evidence";
type Row={id:string;title:string;content:string;createdAt:Date|string;total?:string};
const digest=(content:string)=>createHash("sha256").update(content).digest("hex");

export function knowledgeEvidence(rows:Row[],query:string,maxBytes=96000):ChatKnowledgeResult {
 const words=new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}_]{3,}/gu)||[]);
 const documents:ChatKnowledgeResult["documents"]=[];let bytes=0;
 for(const row of rows){
  const lines=row.content.replace(/\r\n/g,"\n").split("\n");
  // Pick a contiguous relevant passage for long documents; retain exact line references.
  let start=0;
  if(Buffer.byteLength(row.content)>24000){
   let best=0;
   for(let i=0;i<lines.length;i++) {const lower=lines[i].toLocaleLowerCase();const score=[...words].reduce((n,w)=>n+(lower.includes(w)?1:0),0);if(score>best){best=score;start=Math.max(0,i-15);}}
  }
  const selected:string[]=[];let size=0;
  for(let i=start;i<lines.length;i++){const length=Buffer.byteLength(lines[i])+1;if(size+length>maxBytes-bytes || (selected.length>0 && size+length>24000))break;selected.push(lines[i]);size+=length;}
  if(!selected.length)continue;
  const content=selected.join("\n");bytes+=size;
  documents.push({reference:{kind:"knowledge",id:`K${documents.length+1}`,documentId:row.id,title:row.title,digest:digest(row.content),startLine:start+1,endLine:start+selected.length,url:`/dashboard?${new URLSearchParams({view:"knowledge",documentId:row.id})}`},content,truncated:start>0||selected.length<lines.length});
  if(bytes>=maxBytes)break;
 }
 const total=rows.length?Number(rows[0].total??rows.length):0;
 return {status:"available",total,documents,incomplete:documents.length<total||documents.some(d=>d.truncated)};
}

export async function searchKnowledge(input:{organizationId:string;userId:string;query:string},pool=applicationPool()):Promise<ChatKnowledgeResult> {
 const scope=[input.organizationId,input.userId];
 if(!(await pool.query('SELECT 1 FROM member WHERE "organizationId"=$1 AND "userId"=$2',scope)).rowCount)throw new ReviewError(403,"Workspace access is no longer available.");
 const terms=[...new Set(input.query.toLocaleLowerCase().match(/[\p{L}\p{N}_]{3,}/gu)||[])].slice(0,40).join(" | ");
 const rows=(await pool.query<Row>(`SELECT d.id,d.title,d.content,d."createdAt",count(*) OVER() AS total
  FROM "knowledgeDocument" d WHERE d."organizationId"=$1
  AND EXISTS(SELECT 1 FROM member m WHERE m."organizationId"=$1 AND m."userId"=$2)
  ORDER BY ts_rank_cd(to_tsvector('simple',d.title || ' ' || d.content),to_tsquery('simple',$3)) DESC,d.title,d.id LIMIT 100`,[...scope,terms])).rows;
 return knowledgeEvidence(rows,input.query);
}

export async function loadKnowledgeSource(reference:ChatKnowledgeReference,organizationId:string,userId:string,pool=applicationPool()) {
 const row=(await pool.query<Row>(`SELECT d.id,d.title,d.content,d."createdAt" FROM "knowledgeDocument" d
  WHERE d.id=$1 AND d."organizationId"=$2 AND EXISTS(SELECT 1 FROM member m WHERE m."organizationId"=$2 AND m."userId"=$3)`,[reference.documentId,organizationId,userId])).rows[0];
 if(!row)throw new ReviewError(404,"This knowledge document is no longer available.");
 if(digest(row.content)!==reference.digest)throw new ReviewError(409,"This document has changed since the answer. Open its current version in Knowledge Center.");
 if(!Number.isSafeInteger(reference.startLine)||!Number.isSafeInteger(reference.endLine)||reference.startLine<1||reference.endLine<reference.startLine)throw new ReviewError(400,"Invalid knowledge source.");
 return {...reference,content:row.content.replace(/\r\n/g,"\n").split("\n").slice(reference.startLine-1,reference.endLine).join("\n")};
}
