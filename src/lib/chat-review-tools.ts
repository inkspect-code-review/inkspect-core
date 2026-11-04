import { AIError } from "./bedrock";
import type { ChatRepository } from "./chat-context";
import { engineRequest } from "./engine-client";
import { ReviewError } from "./review-access";
import type { ReviewJob, ReportResponse } from "./review-types";

import {safeReviewDiagram, type ChatReviewReference, type ChatReviewResult} from "./chat-review-evidence";

export async function readLatestReviews(input:{organizationId:string;userId:string;repositories:ChatRepository[];pullNumber?:number;jobId?:string;includeDiagrams:boolean},send=engineRequest):Promise<ChatReviewResult[]> {
 const results:ChatReviewResult[]=new Array(input.repositories.length);let cursor=0;
 await Promise.all(Array.from({length:Math.min(3,input.repositories.length)},async()=>{
  for(;;){const index=cursor++;if(index>=input.repositories.length)return;const repo=input.repositories[index];
   const claims={tenant:input.organizationId,subject:input.userId,connection:repo.connectionId,installation:repo.installationId,repository:repo.id};
   try {
    if(input.jobId && !/^J-[a-f0-9]{32}$/.test(input.jobId))throw new AIError(400,"Invalid saved review.");
    const list=input.jobId?{reviews:[await send(`/jobs/${input.jobId}`,"GET",undefined,claims) as ReviewJob]}:await send("/jobs","GET",undefined,claims) as {reviews:ReviewJob[]};
    if(!Array.isArray(list.reviews)||list.reviews.length>30)throw new AIError(502,"Review history could not be verified.");
    const all=list.reviews.map(row=>{
     const prefix=`https://github.com/${repo.fullName}/pull/`;
     if(!row?.job || !/^J-[a-f0-9]{32}$/.test(row.job.id) || !row.snapshot?.url?.startsWith(prefix) || !/^\d+$/.test(row.snapshot.url.slice(prefix.length)) || String(row.snapshot.repository_id)!==String(repo.id) || !/^[a-f0-9]{40}$/.test(row.snapshot.head) || !Number.isFinite(Date.parse(row.job.created_at)))throw new AIError(502,"Review history could not be verified.");
     return row;
    }).sort((a,b)=>Date.parse(b.job.created_at)-Date.parse(a.job.created_at));
    const rows=all.filter(row=>!input.pullNumber || Number(row.snapshot.url.split('/').at(-1))===input.pullNumber);
    const latest=rows[0];
    const result:ChatReviewResult={repository:repo.fullName,status:rows.length?"available":"empty",searchedRecent:all.length,historyLimited:all.length===30,reviews:[],...(latest?{latestJob:{id:latest.job.id,status:latest.job.status,createdAt:latest.job.created_at}}:{})};
    // Latest recorded completed review; never start a fresh review to answer history.
    const row=rows.find(item=>item.job.status==="completed");
    if(row){
     const response=await send(`/jobs/${row.job.id}/report`,"GET",undefined,claims) as ReportResponse;
     const report=response?.report;
     if(!report || report.run?.id!==row.job.id || String(report.run.target?.repository_id)!==String(repo.id) || report.run.target.revision_id!==row.snapshot.head || !Array.isArray(report.findings) || typeof report.summary!=="string")throw new AIError(502,"Stored review scope could not be verified.");
     const diagram=input.includeDiagrams?safeReviewDiagram(report.diagram):undefined;
     const reference:ChatReviewReference={kind:"review",id:`R${index+1}`,repository:repo.fullName,repositoryId:repo.id,revision:row.snapshot.head,jobId:row.job.id,createdAt:row.job.created_at,pullNumber:Number(row.snapshot.url.split('/').at(-1)),url:`/dashboard?${new URLSearchParams({view:"reviews",organizationId:input.organizationId,repositoryId:String(repo.id),jobId:row.job.id})}`,...(diagram?{diagram}:{})};
     const findings=report.findings.slice(0,30).map(f=>({id:String(f.id).slice(0,100),title:String(f.title).slice(0,500),severity:String(f.severity).slice(0,30),reason:String(f.reason).slice(0,3000),suggestion:String(f.suggestion).slice(0,2000),verification:String(f.verification).slice(0,1000),location:f.location,evidence_ids:[],advisory:f.advisory===true}));
     result.reviews.push({reference,summary:report.summary.slice(0,6000),decision:report.decision,findings,findingCount:report.findings.length,truncated:report.findings.length>findings.length,coverageComplete:report.run.coverage_complete,freshness:response.freshness_check==="verified"?report.run.freshness:"unverified",diagramAvailable:!!safeReviewDiagram(report.diagram)});
    }
    results[index]=result;
   }catch(error){
    if(error instanceof ReviewError && [409,503].includes(error.status)){results[index]={repository:repo.fullName,status:"unavailable",searchedRecent:0,historyLimited:false,reviews:[]};continue;}
    throw error;
   }
  }
 }));
 return results;
}
