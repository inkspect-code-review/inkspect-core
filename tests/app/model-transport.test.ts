import test from "node:test";
import assert from "node:assert/strict";
import {modelTransport,engineModelEnvironment} from "../../src/lib/model-transport";
import {bedrockConfig} from "../../src/lib/bedrock";
import {generateChatTitle} from "../../src/lib/chat-title";
import {routingConfig} from "../../src/lib/chat-routing";
test("instance provider uses fixed transport for chat, routing, titles and all engine calls",()=>{
 const env={INKSPECT_AI_PROVIDER:"inkspect",INKSPECT_API_KEY:"isk_live_"+"a".repeat(64),AWS_BEARER_TOKEN_BEDROCK:"must-not-forward"};
 assert.equal(modelTransport(env).endpoint,"https://app.inkspect.si/api/provider");
 assert.equal(bedrockConfig(env).model,"inkspect-chat");
 assert.equal(routingConfig(env).model,"inkspect-router");
 assert.equal(bedrockConfig(env,"amazon.nova-micro-v1:0").model,"inkspect-chat");
 assert.equal(bedrockConfig(env,"inkspect-title").model,"inkspect-title");
 assert.equal(bedrockConfig(env).inputRate,undefined,"local provider estimates are not Cloud charges");
 const engine=engineModelEnvironment(env);
 assert.equal(engine.AWS_ENDPOINT_URL_BEDROCK_RUNTIME,"https://app.inkspect.si/api/provider");
 assert.equal(engine.AWS_BEARER_TOKEN_BEDROCK,env.INKSPECT_API_KEY);
 assert.equal(JSON.stringify(engine).includes("must-not-forward"),false);
 assert.throws(()=>modelTransport({INKSPECT_AI_PROVIDER:"inkspect"}));
 assert.throws(()=>modelTransport({INKSPECT_AI_PROVIDER:"unknown"}));
 assert.deepEqual(engineModelEnvironment({}),{});
 assert.equal(modelTransport({AWS_BEARER_TOKEN_BEDROCK:"direct"}).key,"direct");
});


test("titles select their own provider alias even with a preexisting instance chat model",async()=>{
 const env={INKSPECT_AI_PROVIDER:"inkspect",INKSPECT_API_KEY:"isk_live_"+"a".repeat(64),INKSPECT_DEFAULT_CHAT_MODEL:"amazon.nova-micro-v1:0"};
 const reply=await generateChatTitle("What is this project?",(async(url)=>{
  assert.match(String(url),/^https:\/\/app\.inkspect\.si\/api\/provider\/model\/inkspect-title\//);
  if(String(url).endsWith("count-tokens"))return Response.json({inputTokens:10});
  return Response.json({output:{message:{content:[{text:"Understanding this project"}]}},usage:{inputTokens:10,outputTokens:4,totalTokens:14}});
 }) as typeof fetch,env);
 assert.equal(reply.model,"inkspect-title");assert.equal(reply.content,"Understanding this project");
});
