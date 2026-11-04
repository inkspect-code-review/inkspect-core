import assert from 'node:assert/strict';
import test from 'node:test';
import { EventStreamCodec } from '@smithy/eventstream-codec';
import { fromUtf8,toUtf8 } from '@smithy/util-utf8';
import { converse,prepareChatInput,CHAT_INPUT_TOKEN_LIMIT } from "../../src/lib/bedrock";
import { consumeChatStream } from "../../src/lib/chat-stream";
const config={key:'test',region:'eu-west-2',model:'amazon.nova-pro-v1:0',inputRate:2n,outputRate:3n};
const codec=new EventStreamCodec(toUtf8,fromUtf8);
const frame=(type:string,data:unknown)=>codec.encode({headers:{':message-type':{type:'string',value:'event'},':event-type':{type:'string',value:type}},body:fromUtf8(JSON.stringify(data))});
function providerResponse(complete=true){
 const bytes=Buffer.concat([frame('contentBlockDelta',{delta:{text:'Merhaba 🌍'}}),...(complete?[frame('messageStop',{stopReason:'end_turn'}),frame('metadata',{usage:{inputTokens:10,outputTokens:4,totalTokens:14}})]:[])]);
 return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=3)c.enqueue(bytes.subarray(i,i+3));c.close();}}));
}
test('Bedrock streams real deltas across binary frame boundaries and accounts only final verified usage',async()=>{
 const deltas:string[]=[];
 const answer=await converse([{role:'user',content:'Hello'}],[],async(url)=>{assert.ok(String(url).endsWith('/converse-stream'));return providerResponse();},config,undefined,{onDelta:text=>deltas.push(text)});
 assert.deepEqual(deltas,['Merhaba 🌍']);assert.equal(answer.content,'Merhaba 🌍');assert.equal(answer.chargedNanoUSD,'32');
 await assert.rejects(converse([{role:'user',content:'Hello'}],[],async()=>providerResponse(false),config,undefined,{onDelta:()=>{}}),/interrupted/);
 const corrupt=frame('contentBlockDelta',{delta:{text:'forged'}});corrupt[corrupt.length-1]^=1;
 await assert.rejects(converse([{role:'user',content:'Hello'}],[],async()=>new Response(new Uint8Array(corrupt)),config,undefined,{onDelta:()=>assert.fail('CRC failure must not emit text')}),/interrupted/);
});
test('input budget covers instructions, history and retrieval; preserves current question; handles CountTokens denial conservatively',async()=>{
 const context={sources:[],repositories:[],incomplete:false};
 const messages=[{role:'user' as const,content:'old'.repeat(150000)},{role:'assistant' as const,content:'earlier answer'},{role:'user' as const,content:'Current question'}];
 const result=await prepareChatInput(messages,context,undefined,async()=>new Response('',{status:403}),{...config,model:'budget-denied'});
 assert.equal(result.input.messages.at(-1)?.content[0].text,'Current question');
 assert.ok(Buffer.byteLength(JSON.stringify(result.input))+4096<=CHAT_INPUT_TOKEN_LIMIT);assert.equal(result.context.historyTruncated,true);
 await assert.rejects(prepareChatInput([{role:'user',content:'🧑'.repeat(100000)}],context,undefined,async()=>new Response('',{status:403}),{...config,model:'budget-unicode'}),/272,000/);
 let counted=false;
 const exact=await prepareChatInput([{role:'user',content:'code '.repeat(70000)}],context,undefined,async(_url,init)=>{const body=JSON.parse(String(init?.body));assert.ok(body.input.converse.system[0].text);counted=true;return Response.json({inputTokens:90000});},{...config,model:'budget-supported'});
 assert.ok(counted);assert.equal(exact.input.messages[0].content[0].text?.length,350000);
});
test('browser SSE parser preserves Unicode and rejects a dropped connection without a saved completion',async()=>{
 const packet=(end:boolean)=>{
  const text='event: delta\ndata: '+JSON.stringify({text:'şöyle 🌍'})+'\n\n'+(end?'event: done\ndata: {}\n\n':'');const bytes=new TextEncoder().encode(text);
  return new Response(new ReadableStream({start(c){for(const byte of bytes)c.enqueue(new Uint8Array([byte]));c.close();}}),{headers:{'content-type':'text/event-stream'}});
 };
 const parts:string[]=[];await consumeChatStream(packet(true),e=>{if(e.event==='delta')parts.push(e.data.text);});assert.deepEqual(parts,['şöyle 🌍']);
 await assert.rejects(consumeChatStream(packet(false),()=>{}),/before the reply was saved/);
});

test('activity events survive fragmented streams and never become answer text or completion',async()=>{
 const frames='event: progress\ndata: {"stage":"gathering","privateQuery":"not forwarded"}\n\n'+'event: delta\ndata: {"text":"Answer"}\n\n'+'event: done\ndata: {}\n\n';
 const bytes=new TextEncoder().encode(frames),events:unknown[]=[];
 const response=new Response(new ReadableStream({start(c){for(const byte of bytes)c.enqueue(new Uint8Array([byte]));c.close();}}),{headers:{'content-type':'text/event-stream'}});
 await consumeChatStream(response,event=>events.push(event));
 assert.deepEqual(events,[{event:'progress',data:{stage:'gathering'}},{event:'delta',data:{text:'Answer'}},{event:'done',data:{}}]);
 for(const stage of ['execute_sql','__proto__',null])await assert.rejects(consumeChatStream(new Response(`event: progress\ndata: ${JSON.stringify({stage})}\n\n`,{headers:{'content-type':'text/event-stream'}}),()=>assert.fail('unknown activity emitted')),/Invalid chat activity/);
 await assert.rejects(consumeChatStream(new Response('event: progress\ndata: {"stage":"thinking"}\n\n',{headers:{'content-type':'text/event-stream'}}),()=>{}),/before the reply was saved/);
});

test('streaming filters unused sources and accounts for cache reads and writes', async()=>{
 const bytes=Buffer.concat([
  frame('contentBlockDelta',{delta:{text:'Session validation [S2].'}}),
  frame('messageStop',{stopReason:'end_turn'}),
  frame('metadata',{usage:{inputTokens:10,outputTokens:4,totalTokens:1314,cacheReadInputTokens:1000,cacheWriteInputTokens:300}}),
 ]);
 const sources=[1,2].map(n=>({id:`S${n}`,repository:'org/repo',repositoryId:1,revision:'a'.repeat(40),path:`file${n}.ts`,startLine:1,endLine:2,content:'code',url:'https://github.com/org/repo'}));
 const answer=await converse([{role:'user',content:'Explain sessions'}],[],async()=>new Response(bytes),{...config,cacheReadRate:1n,cacheWriteRate:2n},{sources,repositories:['org/repo'],incomplete:false},{onDelta:()=>{}});
 assert.deepEqual(answer.sources?.map(s=>s.id),['S2']);
 assert.equal(answer.cacheReadInputTokens,1000);assert.equal(answer.cacheWriteInputTokens,300);
 assert.equal(answer.chargedNanoUSD,'1632');assert.equal(answer.totalTokens,1314);
});
