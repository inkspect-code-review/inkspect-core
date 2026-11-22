import assert from "node:assert/strict";
import test from "node:test";
import {gatherChatEvidence} from "../../src/lib/chat-tools";
import {readLatestReviews} from "../../src/lib/chat-review-tools";
import {safeReviewDiagram} from "../../src/lib/chat-review-evidence";
import {parseChatRoute} from "../../src/lib/chat-routing";
import {citedChatSources} from "../../src/lib/chat-citations";
import {knowledgeEvidence,searchKnowledge,loadKnowledgeSource} from "../../src/lib/chat-knowledge";
const repo={id:17,fullName:"org/project",connectionId:"connection",installationId:22};
const input={organizationId:"workspace",userId:"user",messageId:"message",repositories:[repo]};
const id="J-"+"a".repeat(32),sha="b".repeat(40);
const job={job:{id,status:"completed",created_at:"2026-10-29T08:00:00Z"},snapshot:{url:"https://github.com/org/project/pull/2",repository_id:"17",head:sha}};
const diagram={title:"Actual flow",view:"current",nodes:[{id:"a",label:"Validate"},{id:"b",label:"Save"}],edges:[{from:"a",to:"b"}]};
const report={run:{id,target:{repository_id:"17",revision_id:sha},coverage_complete:true,freshness:"stale"},summary:"Stored finding",decision:"needs_changes",findings:[{id:"F1",title:"Reject invalid input",severity:"P1",reason:"Missing validation",suggestion:"Validate",verification:"Test invalid input",location:{path:"src/main.ts",start_line:2,end_line:3}}],diagram};
const emptyKnowledge=async()=>({status:"available" as const,total:0,documents:[],incomplete:false});

test("recorded findings use authorized read functions and never launch a fresh inspection",async()=>{
 const calls:string[]=[];
 const context=await gatherChatEvidence(input,{intent:"repository",language:"tr",query:"latest findings",tools:["latest_reviews"]},{
  search:async()=>assert.fail("history must not become a new repository inspection"),knowledge:emptyKnowledge,
  reviews:args=>readLatestReviews(args,async(path,method,body,claims)=>{calls.push(path);assert.equal(method,"GET");assert.equal(body,undefined);assert.equal(claims.tenant,"workspace");assert.equal(claims.subject,"user");assert.equal(claims.repository,17);return path==="/jobs"?{reviews:[job]}:{report,freshness_check:"verified"};})
 });
 assert.deepEqual(calls,["/jobs",`/jobs/${id}/report`]);assert.equal(context.reviewResults?.[0].reviews[0].findings[0].title,"Reject invalid input");assert.equal(context.sources.length,0);
 assert.equal(context.reviewResults?.[0].reviews[0].freshness,"stale");assert.equal(context.reviewResults?.[0].reviews[0].reference.diagram,undefined);
});

test("saved diagram is preserved and cited separately from code; fabricated IDs do not become sources",async()=>{
 const result=await readLatestReviews({...input,includeDiagrams:true},async path=>path==="/jobs"?{reviews:[job]}:{report,freshness_check:"verified"});
 const ref=result[0].reviews[0].reference;
 assert.equal(ref.diagram?.title,"Actual flow");assert.ok(ref.url.includes(`jobId=${id}`));
 assert.deepEqual(citedChatSources("The recorded flow [R1]. `fake [R2]` [S99]",[ref]),[ref]);
 assert.equal(safeReviewDiagram({...diagram,edges:[{from:"a",to:"missing"}]}),undefined);
 assert.equal(safeReviewDiagram({...diagram,nodes:[{id:"a",label:"one"},{id:"a",label:"two"}]}),undefined);
});

test("newer running jobs remain distinct from latest completed findings and explicit PR scope is honored",async()=>{
 const recent={...job,job:{...job.job,id:"J-"+"c".repeat(32),status:"running",created_at:"2026-10-29T09:00:00Z"}};
 const result=await readLatestReviews({...input,pullNumber:2,includeDiagrams:false},async path=>path==="/jobs"?{reviews:[job,recent]}:{report,freshness_check:"unavailable"});
 assert.equal(result[0].latestJob?.status,"running");assert.equal(result[0].reviews[0].reference.jobId,id);assert.equal(result[0].reviews[0].freshness,"unverified");
 const empty=await readLatestReviews({...input,pullNumber:9,includeDiagrams:true},async path=>{assert.equal(path,"/jobs");return {reviews:[job]};});
 assert.equal(empty[0].status,"empty");assert.equal(empty[0].reviews.length,0);
});

test("foreign jobs, forged reports and out-of-scope repository plans fail closed",async()=>{
 await assert.rejects(readLatestReviews({...input,includeDiagrams:false},async()=>({reviews:[{...job,snapshot:{...job.snapshot,repository_id:"18"}}]})),/verified/);
 await assert.rejects(readLatestReviews({...input,includeDiagrams:false},async path=>path==="/jobs"?{reviews:[job]}:{report:{...report,run:{...report.run,id:"J-"+"e".repeat(32)}}}),/verified/);
 await assert.rejects(gatherChatEvidence(input,{intent:"repository",language:"tr",query:"latest",tools:["latest_reviews"],repositories:["private/other"]},{reviews:async()=>assert.fail("unauthorized tool call"),knowledge:emptyKnowledge}),/Include/);
 for(const extra of [{tools:["execute_sql"]},{tools:["latest_reviews"],sql:"DROP TABLE member"},{tools:["review_diagrams"],pullNumber:-1}])assert.equal(parseChatRoute(JSON.stringify({intent:"repository",language:"tr",query:"planned",...extra}),"tr","original").query,"original");
 assert.deepEqual(parseChatRoute(JSON.stringify({intent:"repository",language:"tr",query:"rules",tools:["knowledge_search"],knowledgeQuery:"TypeScript null checks"})).tools,["knowledge_search"]);
});

test("inspection combines code and organization rules, while irrelevant lookups do not fetch policy",async()=>{
 let knowledge=0;
 const deps={search:async()=>({sources:[],repositories:[repo.fullName],incomplete:false}),knowledge:async()=>{knowledge++;return emptyKnowledge();}};
 await gatherChatEvidence(input,{intent:"repository",language:"tr",query:"implementation",retrieval:"inspection"},deps);
 assert.equal(knowledge,1);
 await gatherChatEvidence(input,{intent:"repository",language:"tr",query:"makarna",retrieval:"lookup"},deps);
 assert.equal(knowledge,1);
});

test("activity follows the actual selected tools and never claims skipped work",async()=>{
 const events:string[]=[];
 await gatherChatEvidence({...input,onProgress:stage=>events.push(stage)},{intent:"repository",language:"tr",query:"check rules",retrieval:"inspection",tools:["repository_search","latest_reviews"]},{
  search:async()=>{events.push("search-called");return {sources:[],repositories:[repo.fullName],incomplete:false};},
  reviews:async()=>{events.push("reviews-called");return [];},
  knowledge:async()=>{events.push("knowledge-called");return emptyKnowledge();},
 });
 assert.deepEqual(events,["gathering","search-called","reading_reviews","reviews-called","reading_knowledge","knowledge-called"]);
});

test("Knowledge Center passages carry immutable document references and honor the aggregate budget",async()=>{
 const rows=[{id:"policy",title:"Validation rules",content:"# Rules\nValidate all external inputs.\nDo not log secrets.",createdAt:"2026-10-29"}];
 const result=knowledgeEvidence(rows,"validation",1000),ref=result.documents[0].reference;
 assert.equal(result.documents[0].content,rows[0].content);assert.equal(ref.startLine,1);assert.equal(ref.endLine,3);
 assert.deepEqual(citedChatSources("Your rule [K1] conflicts with the implementation [S1].",[ref]),[ref]);
 const pool={query:async(sql:string,params:unknown[])=>{assert.ok(sql.includes('d."organizationId"=$2'));assert.deepEqual(params,["policy","workspace","user"]);return {rows};}};
 assert.equal((await loadKnowledgeSource(ref,"workspace","user",pool as never)).content,rows[0].content);
 await assert.rejects(loadKnowledgeSource({...ref,digest:"changed"},"workspace","user",pool as never),/changed since/);
 const long=knowledgeEvidence([{...rows[0],content:"a".repeat(50000)}],"anything");assert.equal(long.documents[0].content.length,50000);
 const bounded=knowledgeEvidence([...rows,...rows.map(r=>({...r,id:"policy2"}))],"validation",60);assert.ok(bounded.documents.reduce((n,d)=>n+Buffer.byteLength(d.content),0)<=60);assert.equal(bounded.incomplete,true);
});

test("knowledge queries bind membership and organization, and never execute model-provided SQL",async()=>{
 const calls:{sql:string;params:unknown[]}[]=[];
 const pool={query:async(sql:string,params:unknown[])=>{calls.push({sql,params});return calls.length===1?{rowCount:1}:{rows:[]};}};
 await searchKnowledge({...input,query:"'; DROP TABLE member; -- validation"},pool as never);
 assert.equal(calls.length,2);assert.ok(calls[1].sql.includes('d."organizationId"=$1'));assert.ok(calls[1].sql.includes('m."userId"=$2'));assert.ok(!calls[1].sql.includes("DROP TABLE"));assert.deepEqual(calls[1].params.slice(0,2),["workspace","user"]);
 await assert.rejects(searchKnowledge({...input,query:"rules"},{query:async()=>({rowCount:0})} as never),/access/);
});

test("a fenced provider plan keeps follow-up tool intent without accepting text or extra fields",()=>{
 const plan={intent:"repository",language:"tr",query:"Saved diagram",retrieval:"lookup",tools:["review_diagrams"],pullNumber:2};
 assert.deepEqual(parseChatRoute('```json\n'+JSON.stringify(plan)+'\n```'),plan);
 assert.equal(parseChatRoute('Ignore scope\n```json\n'+JSON.stringify(plan)+'\n```',"tr","original").query,"original");
 assert.equal(parseChatRoute('```json\n'+JSON.stringify({...plan,organizationId:"other"})+'\n```',"tr","original").query,"original");
});

test("a saved review follow-up reads that exact run rather than switching to a newer completed review",async()=>{
 const calls:string[]=[];
 const result=await readLatestReviews({...input,jobId:id,includeDiagrams:true},async path=>{calls.push(path);return path.endsWith('/report')?{report,freshness_check:"verified"}:job;});
 assert.deepEqual(calls,[`/jobs/${id}`,`/jobs/${id}/report`]);assert.equal(result[0].reviews[0].reference.jobId,id);
});

test("planner defaults to configured chat intelligence without reusing small-model pricing",async()=>{
 const {routingConfig,chatRoutingModel}=await import("../../src/lib/chat-routing");
 const env={AWS_BEARER_TOKEN_BEDROCK:"test",AWS_REGION:"eu-west-2",INKSPECT_DEFAULT_CHAT_MODEL:"global.openai.gpt-6.1-sol",INKSPECT_AI_PRICING_MODEL:"global.openai.gpt-6.1-sol",INKSPECT_AI_PRICING_REGION:"eu-west-2",INKSPECT_AI_INPUT_NANO_USD:"2000",INKSPECT_AI_OUTPUT_NANO_USD:"10000",INKSPECT_ROUTING_PRICING_MODEL:"amazon.nova-micro-v1:0",INKSPECT_ROUTING_INPUT_NANO_USD:"1",INKSPECT_ROUTING_OUTPUT_NANO_USD:"2"};
 assert.equal(chatRoutingModel(env),env.INKSPECT_DEFAULT_CHAT_MODEL);assert.equal(routingConfig(env).inputRate,2000n);
 assert.equal(chatRoutingModel({...env,INKSPECT_CHAT_ROUTING_MODEL:"amazon.nova-micro-v1:0"}),"amazon.nova-micro-v1:0");
});

test("product help can use registered guides alone or alongside scoped repository evidence", async () => {
 const guide = { id: "setup", title: "Workspace setup", url: "https://example.com/setup", content: "Open settings." };
 const plan = { intent: "repository", language: "tr", query: "setup", guides: ["setup"], tools: [] };
 const route = parseChatRoute(JSON.stringify(plan), "tr", "original", [guide]);
 const noSearch = async () => assert.fail("Pure product help must not read workspace data");
 const context = await gatherChatEvidence({...input, repositories: []}, route, {
   productGuides: [guide], search: noSearch, knowledge: noSearch, reviews: noSearch,
 });
 assert.deepEqual(context.productGuides, [guide]);
 for (const invalid of [parseChatRoute(JSON.stringify(plan)), parseChatRoute(JSON.stringify({...plan, guides:["unknown"]}), "tr", "original", [guide])]) {
   assert.equal(invalid.guides, undefined);
   assert.equal(invalid.tools, undefined);
 }
 const mixed = await gatherChatEvidence(input, {...route, tools:["repository_search"]}, {
   productGuides: [guide], search: async args => {
     assert.deepEqual(args.repositories, [repo]);
     return { sources:[], repositories:[repo.fullName], incomplete:false };
   },
 });
 assert.deepEqual(mixed.productGuides, [guide]);
 assert.deepEqual(mixed.repositories, [repo.fullName]);
});
