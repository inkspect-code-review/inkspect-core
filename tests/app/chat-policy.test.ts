import assert from "node:assert/strict";
import test from "node:test";
import { parseChatRoute, routeChat, noEvidenceReply, chatRoutingSystem } from "../../src/lib/chat-routing";
import { citedChatSources } from "../../src/lib/chat-citations";
import { chatSourcePolicy, selectChatSources, retrieveChatContext, type ChatSource } from "../../src/lib/chat-context";
import { chatUsage } from "../../src/lib/chat-usage";
import { prepareChatInput, converse, bedrockConfig } from "../../src/lib/bedrock";

const config = {key:"test",region:"eu-west-2",model:"amazon.nova-pro-v1:0",inputRate:10n,outputRate:20n,cacheReadRate:2n,cacheWriteRate:12n};
const source = (id: string, score = .9) => ({id,score,repository:"org/repo",repositoryId:1,revision:"a".repeat(40),path:`src/${id}.ts`,startLine:1,endLine:5,content:`export function ${id}() {}`,url:`https://github.com/org/repo/blob/${"a".repeat(40)}/src/${id}.ts#L1-L5`});

test("answer prompt reflects the text-only composer even without product guide evidence", async () => {
  const {input} = await prepareChatInput([{role:"user", content:"What should I share?"}],
    {sources:[], repositories:[], incomplete:false}, undefined, fetch, config);
  assert.match(input.system[0].text ?? "", /chat accepts text only/);
  assert.match(input.system[0].text ?? "", /exact error text/);
});

test("malformed rewriting falls back to the original question without excluding its topic", () => {
  for (const content of ['recipe', '{"intent":"repository"}', JSON.stringify({intent:"repository",language:"tr",query:""}), JSON.stringify({intent:"repository",language:"en",query:"valid",url:"https://attacker"})]) {
    assert.deepEqual(parseChatRoute(content,"tr","makarna tarifi ver"),{intent:"repository",language:"tr",query:"makarna tarifi ver"});
  }
  assert.equal(parseChatRoute(JSON.stringify({intent:"repository",language:"tr",query:"Tarif araması nerede bozuluyor?"})).intent,"repository");
  assert.equal(parseChatRoute(JSON.stringify({intent:"out_of_scope",language:"tr",query:"pasta"}),"tr","makarna tarifi ver").query,"makarna tarifi ver");
  assert.deepEqual(noEvidenceReply("tr").sources,[]);
  assert.equal(noEvidenceReply("tr").chargedNanoUSD,"0");
});

test("query plans accept inspection but malformed modes fail back to ordinary lookup",()=>{
 const plan={intent:"repository",language:"tr",query:"Implementation and tests to inspect",retrieval:"inspection"};
 assert.deepEqual(parseChatRoute(JSON.stringify(plan)),plan);
 for(const retrieval of ["all",null,{},true]) {
  const fallback=parseChatRoute(JSON.stringify({...plan,retrieval}),"tr","makarna tarifi ver");
  assert.equal(fallback.query,"makarna tarifi ver");assert.equal(fallback.retrieval,undefined);
 }
});

test("router sees recent context plus complete current request and keeps user content out of system", async () => {
  const env = process.env.AWS_BEARER_TOKEN_BEDROCK;
  process.env.AWS_BEARER_TOKEN_BEDROCK = "test";
  try {
    let calls=0;
    const result=await routeChat([{role:"user",content:"Explain saveOrder"},{role:"assistant",content:"It persists orders"},{role:"user",content:"Peki bunu nerede çağırıyoruz?"}],["org/repo"],async (_url,init)=>{
      calls++;
      const body=JSON.parse(String(init?.body));
      assert.equal(body.system[0].text,chatRoutingSystem);
      const input=JSON.parse(body.messages[0].content[0].text);
      assert.equal(input.history.length,2);
      assert.equal(input.current_request,"Peki bunu nerede çağırıyoruz?");
      return Response.json({output:{message:{content:[{text:JSON.stringify({intent:"repository",language:"tr",query:"saveOrder nerede çağrılıyor?"})}]}},usage:{inputTokens:10,outputTokens:10,totalTokens:20}});
    });
    assert.equal(calls,1);assert.equal(result.route.query,"saveOrder nerede çağrılıyor?");
    const oversized=await routeChat([{role:"user",content:"x".repeat(12001)}],[],async()=>assert.fail("must not silently truncate current task"));
    assert.equal(oversized.route.intent,"repository");
    assert.equal(oversized.route.query.length,1500);
  } finally { if(env===undefined) delete process.env.AWS_BEARER_TOKEN_BEDROCK; else process.env.AWS_BEARER_TOKEN_BEDROCK=env; }
});

test("source selection accepts zero results, orders globally, removes duplicates and stays within budget", () => {
  const candidates=[source("weak",.01),source("good",.7),{...source("best",.95),repositoryId:2},source("good",.6),source("extra",.5)];
  const picked=selectChatSources(candidates,{minScore:.2,maxSources:2,maxBytes:1000});
  assert.deepEqual(picked.map(s=>s.path),["src/best.ts","src/good.ts"]);
  assert.deepEqual(picked.map(s=>s.id),["S1","S2"]);
  assert.deepEqual(selectChatSources([source("weak",.01)]),[]);
  assert.deepEqual(selectChatSources([{...source("huge"),content:"x".repeat(50000)}]),[]);
  assert.throws(()=>chatSourcePolicy({INKSPECT_CHAT_MIN_RELEVANCE:"NaN"}));
  assert.throws(()=>chatSourcePolicy({INKSPECT_CHAT_MIN_RELEVANCE:"0"}));
});

test("invalid source scores fail closed even when the source would have been discarded", async () => {
  for(const score of [NaN,Infinity,-.1,1.1,undefined]) {
    await assert.rejects(retrieveChatContext({organizationId:"org",userId:"user",messageId:"m",question:"where?",repositories:[{id:1,fullName:"org/repo",installationId:1,connectionId:"c"}]},async()=>({revision:{tenant_id:"org",repository_id:"1",provider:"github",provider_instance:"github.com",revision_id:"a".repeat(40)},snippets:[{path:"src/a.ts",start_line:1,end_line:1,content:"foo",score}]})),/verified/);
  }
});

test("only current citations in prose are returned; code, quoted examples and invented IDs are not sources", () => {
  const sources=[source("S1"),source("S2"),source("S3"),source("S4")];
  const selected=citedChatSources('Observed behavior [S2]. Unknown [S999].\n```ts\n// [S1]\n```\n`[S3]`\n> Example [S4]\n[link](https://example.com/[S1])',sources);
  assert.deepEqual(selected.map(s=>s.id),["S2"]);
  assert.ok(!("content" in selected[0]));
  assert.deepEqual(citedChatSources("No supporting repository claims.",sources),[]);
  assert.deepEqual(citedChatSources("```ts\n[S1]",sources),[]);
});

test("cached input usage is charged separately and never guessed when cache rates are absent", () => {
  const value={inputTokens:10,outputTokens:5,totalTokens:1315,cacheReadInputTokens:1000,cacheWriteInputTokens:300};
  const measured=chatUsage(value,config);
  assert.equal(chatUsage({...value,cacheReadInputTokens:1000,totalTokens:1315},{...config,cacheReadRate:"2.5"}).chargedNanoUSD,"6300");
  assert.equal(measured.chargedNanoUSD,"5800");assert.equal(measured.totalTokens,1315);
  assert.equal(chatUsage({...value,totalTokens:15},config).totalTokens,1315);
  assert.equal(chatUsage(value,{...config,cacheReadRate:undefined}).chargedNanoUSD,undefined);
  assert.throws(()=>chatUsage({...value,cacheWriteInputTokens:-1},config));
  assert.throws(()=>chatUsage({...value,totalTokens:123},config));
  const mismatched=bedrockConfig({AWS_BEARER_TOKEN_BEDROCK:"test",INKSPECT_AI_PRICING_MODEL:"other",INKSPECT_AI_PRICING_REGION:"eu-west-2",INKSPECT_AI_CACHE_READ_NANO_USD:"2"});
  assert.equal(mismatched.cacheReadRate,undefined);
});

test("stable system and history precede dynamic evidence; caching is bounded and model specific", async () => {
  const messages=[{role:"user" as const,content:"Where is auth?"},{role:"assistant" as const,content:"Earlier response"},{role:"user" as const,content:"And sessions?"}];
  const context={sources:[source("S1") as ChatSource],repositories:["org/repo"],incomplete:false,mode:"repository" as const};
  const a=await prepareChatInput(messages,context,undefined,fetch,config);
  const b=await prepareChatInput(messages,{...context,sources:[source("S2")]},undefined,fetch,config);
  assert.deepEqual(a.input.system,b.input.system);
  assert.ok(!JSON.stringify(a.input.system).includes("src/S1.ts"));
  assert.ok(JSON.stringify(a.input.messages.at(-1)?.content.at(-1)).includes("src/S1.ts"));
  assert.ok(a.input.system.some(block=>block.cachePoint));
  assert.ok(a.input.messages.at(-1)?.content.at(-2)?.cachePoint);
  for(const nextConfig of [{...config,model:"unsupported"},{...config,promptCaching:false}]) {
    const result=await prepareChatInput(messages,context,undefined,fetch,nextConfig);
    assert.ok(!JSON.stringify(result.input).includes('"cachePoint"'));
  }
  const large=await prepareChatInput([{role:"user",content:"x".repeat(25000)}],context,undefined,fetch,config);
  assert.ok(!large.input.messages[0].content.some(block=>block.cachePoint));
});

test("non-streaming answer exposes only cited sources and meters cache reads", async () => {
  const reply=await converse([{role:"user",content:"Explain auth"}],[],async()=>Response.json({output:{message:{content:[{text:"Auth validates the session [S2]."}]}},usage:{inputTokens:10,outputTokens:5,totalTokens:1015,cacheReadInputTokens:1000}}),config,{sources:[source("S1"),source("S2")],repositories:[],incomplete:false});
  assert.deepEqual(reply.sources?.map(s=>s.id),["S2"]);assert.equal(reply.chargedNanoUSD,"2200");
});


test("follow-up preserves the newest task in query rewriting and the answer request",async()=>{
 const old=process.env.AWS_BEARER_TOKEN_BEDROCK;process.env.AWS_BEARER_TOKEN_BEDROCK="test";
 const messages=[{role:"user" as const,content:"konusu ne"},{role:"assistant" as const,content:"İstanbul'da geçen bir hikaye. [S1]"},{role:"user" as const,content:"hangi dille yazilmis"}];
 try {
  const routed=await routeChat(messages,["example/game"],async(_url,init)=>{
   const input=JSON.parse(JSON.parse(String(init?.body)).messages[0].content[0].text);
   assert.equal(input.current_request,"hangi dille yazilmis");
   assert.equal(input.history.length,2);
   return Response.json({output:{message:{content:[{text:JSON.stringify({intent:"repository",language:"tr",query:"Bu oyun hangi programlama diliyle geliştirilmiş?"})}]}},usage:{inputTokens:10,outputTokens:10,totalTokens:20}});
  });
  assert.match(routed.route.query,/programlama dili/);
  const context={sources:[{...source("S1"),content:"This game uses GDScript and Godot."}],repositories:["example/game"],mode:"repository" as const,incomplete:false};
  const prepared=await prepareChatInput(messages,context,undefined,async()=>assert.fail("local preparation must not call provider"),{...config,model:"global.openai.gpt-6.1-sol"});
  assert.equal(prepared.input.messages.at(-1)?.role,"user");
  assert.equal(prepared.input.messages.at(-1)?.content[0].text,"hangi dille yazilmis");
  assert.match(prepared.input.messages.at(-1)?.content.at(-1)?.text||"",/GDScript/);
  assert.ok(!JSON.stringify(prepared.input).includes('"cachePoint"'));
 } finally {if(old===undefined)delete process.env.AWS_BEARER_TOKEN_BEDROCK;else process.env.AWS_BEARER_TOKEN_BEDROCK=old;}
});

test("repository plans validate names and surface mentioned projects beyond the catalog window",async()=>{
 const {repositoryCatalog}=await import("../../src/lib/chat-routing");
 const plan={intent:"repository",language:"tr",query:"README purpose and product capabilities",retrieval:"inspection",repositories:["org/first","org/last"]};
 assert.deepEqual(parseChatRoute(JSON.stringify(plan)),plan);
 for(const repositories of [["../private"],[],[17],"all",["org/repo/extra"]]) {
  assert.equal(parseChatRoute(JSON.stringify({...plan,repositories}),"tr","original").query,"original");
 }
 const repositories=Array.from({length:1000},(_,i)=>`org/project-${i}`);
 const catalog=repositoryCatalog([{role:"user",content:"org/project-999 ile project-900 karşılaştır"}],repositories);
 assert.equal(catalog.length,80);assert.ok(catalog.includes("org/project-999"));assert.ok(catalog.includes("org/project-900"));
});

test("input trimming updates repository coverage instead of claiming discarded evidence was inspected",async()=>{
 const sources=[{...source("S1"),repository:"org/one",content:"a".repeat(130000)},{...source("S2"),repository:"org/two",repositoryId:2,content:"b".repeat(130000)}];
 const context={sources,repositories:["org/one","org/two"],incomplete:false,repositoryCoverage:{requested:2,searched:2,represented:2,unrepresented:[] as string[]}};
 const prepared=await prepareChatInput([{role:"user",content:"Explain these projects. "+"x".repeat(30000)}],context,undefined,async()=>new Response(null,{status:503}),config);
 assert.equal(prepared.context.sources.length,1);
 assert.equal(prepared.context.incomplete,true);
 assert.deepEqual(prepared.context.repositoryCoverage,{requested:2,searched:2,represented:1,unrepresented:["org/two"]});
 assert.equal(context.sources.length,2);assert.equal(context.repositoryCoverage.represented,2);
});
