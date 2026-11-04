import type { ChatIndexAvailability } from "./chat-actions";
import { AIError } from "./bedrock";
import { ReviewError } from "./review-access";
import { engineRequest } from "./engine-client";
import type { ChatReviewResult, ChatKnowledgeResult } from "./chat-review-evidence";
import type { ChatRetrieval } from "./chat-routing";
export type ChatRepository={id:number;fullName:string;connectionId:string;installationId:number};
export type ChatSource={id:string;repository:string;repositoryId:number;revision:string;path:string;startLine:number;endLine:number;content:string;url:string};
export type ChatContext={indexAvailability?:ChatIndexAvailability[];mode?:"repository"|"general";retrieval?:ChatRetrieval;selection?:{candidates:number;selected:number;minScore:number};reviewResults?:ChatReviewResult[];knowledge?:ChatKnowledgeResult;toolResultsTruncated?:boolean;sources:ChatSource[];repositories:string[];incomplete:boolean;repositoryCoverage?:{requested:number;searched:number;represented:number;unrepresented:string[]};historyTruncated?:boolean;searchQueryTruncated?:boolean};
type IndexRequired={kind:"index_required";tenant_id:string;repository_id:string;state:ChatIndexAvailability["state"];can_index:boolean};
type Packet={revision:{tenant_id:string;provider:string;provider_instance:string;repository_id:string;revision_id:string};snapshot:string;snippets:{path:string;start_line:number;end_line:number;content:string;score:number}[];omissions?:unknown[]};
export async function retrieveChatContext(input:{organizationId:string;userId:string;messageId:string;question:string;retrieval?:ChatRetrieval;requestedRepositories?:string[];repositories:ChatRepository[]},send=engineRequest):Promise<ChatContext>{
 if(!input.repositories.length)throw new AIError(409,"Connect a repository before asking about your code.");
 // Resolve planner selections only within the already authorized UI scope.
 if(input.requestedRepositories?.length) {
  const names=new Set(input.requestedRepositories.map(name=>name.toLowerCase()));
  const repositories=input.repositories.filter(repo=>names.has(repo.fullName.toLowerCase()));
  if(names.size!==new Set(repositories.map(repo=>repo.fullName.toLowerCase())).size)throw new AIError(400,"Include the requested repositories in the chat selection before comparing them.");
  input={...input,repositories};
 }
 const queryBytes=Buffer.from(input.question,"utf8");
 let queryEnd=Math.min(queryBytes.length,6000);while(queryEnd>0&&queryEnd<queryBytes.length&&(queryBytes[queryEnd]&0xc0)===0x80)queryEnd--;
 const searchQuestion=queryBytes.subarray(0,queryEnd).toString("utf8");
 const deadline=AbortSignal.timeout(180_000);
 const candidates:(ChatSource & {score:number})[]=[];let incomplete=false;
 const policy = chatSourcePolicy();
 const routes=JSON.parse(process.env.INKSPECT_CHAT_ENGINE_ROUTES||"{}");
 if(!routes || typeof routes!=="object" || Array.isArray(routes))throw new AIError(503,"Chat routing is unavailable.");
 const results:({repo:ChatRepository;packet:Packet|IndexRequired}|{error:unknown})[]=new Array(input.repositories.length);
 let cursor=0;
 await Promise.all(Array.from({length:Math.min(3,input.repositories.length)},async()=>{
  for(;;){const index=cursor++;if(index>=input.repositories.length)return;const repo=input.repositories[index];
  try {
  const route=routes[`${input.organizationId}:${repo.id}`];
  if(route!==undefined && typeof route!=="string")throw new AIError(503,"Chat routing is unavailable.");
  const claims={tenant:input.organizationId,subject:input.userId,connection:repo.connectionId,installation:repo.installationId,repository:repo.id};
  // Routes are operator-owned. The browser cannot provide an engine URL or scope.
  const packet=await send("/chat/context","POST",{question:searchQuestion,message_id:input.messageId,retrieval:input.retrieval === "inspection" ? "inspection" : "lookup"},claims,(url,init)=>fetch(url,{...init,signal:AbortSignal.any([deadline,...(init?.signal?[init.signal]:[])])}),route?{...process.env,INKSPECT_ENGINE_URL:route}:process.env) as Packet|IndexRequired;
  results[index]={repo,packet};
  }catch(error){results[index]={error};}
  }
 }));
 let successful=0;
 const indexAvailability:ChatIndexAvailability[]=[];
 for(const result of results){
  if("error" in result){
   if(result.error instanceof ReviewError&&[409,503].includes(result.error.status)){incomplete=true;continue;}
   throw result.error;
  }
  const {repo,packet}=result;
  if(!packet || typeof packet!=="object")throw new AIError(502,"Repository context could not be verified.");
  if("kind" in packet && packet.kind === "index_required") {
   if(packet.tenant_id!==input.organizationId||packet.repository_id!==String(repo.id)||!["not_indexed","indexing","index_failed"].includes(packet.state)||typeof packet.can_index!=="boolean")throw new AIError(502,"Repository index status could not be verified.");
   indexAvailability.push({repositoryId:repo.id,repository:repo.fullName,state:packet.state,canIndex:packet.can_index});incomplete=true;continue;
  }
  if (!("revision" in packet))throw new AIError(502,"Repository context could not be verified.");
  const rev=packet?.revision;
  if(!rev||rev.tenant_id!==input.organizationId||rev.repository_id!==String(repo.id)||rev.provider!=="github"||rev.provider_instance!=="github.com"||!/^[a-f0-9]{40}$/.test(rev.revision_id)||!Array.isArray(packet.snippets))throw new AIError(502,"Repository context could not be verified.");
  successful++;
  incomplete ||= !!packet.omissions?.length;
  for(const snippet of packet.snippets){
   if(typeof snippet.path!=="string"||snippet.path.length>512||snippet.path.startsWith("/")||snippet.path.split("/").some(p=>!p||p==="."||p==="..")||/[\\\r\n\0]/.test(snippet.path)||!Number.isSafeInteger(snippet.start_line)||!Number.isSafeInteger(snippet.end_line)||snippet.start_line<1||snippet.end_line<snippet.start_line||typeof snippet.content!=="string"||typeof snippet.score!=="number"||!Number.isFinite(snippet.score)||snippet.score<0||snippet.score>1)throw new AIError(502,"Repository context could not be verified.");
   const path=snippet.path.split("/").map(encodeURIComponent).join("/");
   candidates.push({score:snippet.score,id:"",repository:repo.fullName,repositoryId:repo.id,revision:rev.revision_id,path:snippet.path,startLine:snippet.start_line,endLine:snippet.end_line,content:snippet.content,url:`https://github.com/${repo.fullName.split("/").map(encodeURIComponent).join("/")}/blob/${rev.revision_id}/${path}#L${snippet.start_line}-L${snippet.end_line}`});
  }
 }
 if(!successful&&!indexAvailability.length)throw new AIError(409,"No repository context is available. Index a connected repository and check its service before asking again.");
 // An inspection needs code to reason about, not a pre-written answer to
 // "are there bugs?". Rank the sample, but don't use lookup relevance as a
 // correctness gate. All authorization/integrity checks and budgets still apply.
 const inspection = input.retrieval === "inspection";
 const selectionPolicy = inspection ? {...policy,minScore:0} : policy;
 const sources = selectChatSources(candidates, selectionPolicy, inspection);
 const represented=new Set(sources.map(source=>source.repositoryId));
 const unrepresented=input.repositories.filter(repo=>!represented.has(repo.id)).map(repo=>repo.fullName);
 incomplete ||= unrepresented.length>0;
 const repositoryCoverage={requested:input.repositories.length,searched:successful,represented:represented.size,unrepresented};
 return {sources,repositoryCoverage,...(indexAvailability.length?{indexAvailability}:{}),mode:"repository",retrieval:inspection ? "inspection" : "lookup",selection:{candidates:candidates.length,selected:sources.length,minScore:selectionPolicy.minScore},repositories:input.repositories.map(r=>r.fullName),incomplete,...(queryEnd<queryBytes.length?{searchQueryTruncated:true}:{})};
}

export function chatSourcePolicy(env: Record<string, string | undefined> = process.env) {
 const minScore = Number(env.INKSPECT_CHAT_MIN_RELEVANCE ?? "0.2");
 const maxSources = Number(env.INKSPECT_CHAT_MAX_SOURCES ?? "8");
 const maxBytes = Number(env.INKSPECT_CHAT_CONTEXT_BYTES ?? "48000");
 if (!Number.isFinite(minScore) || minScore <= 0 || minScore > 1 || !Number.isInteger(maxSources) || maxSources < 1 || maxSources > 24
   || !Number.isInteger(maxBytes) || maxBytes < 8192 || maxBytes > 192000) throw new AIError(503, "Chat source selection is not configured correctly.");
 return { minScore, maxSources, maxBytes };
}

export function selectChatSources(candidates: (ChatSource & {score:number})[], policy = chatSourcePolicy(), diversify = false): ChatSource[] {
 const selected: ChatSource[] = [];
 let bytes = 0;
 const ranked = [...candidates].sort((a,b) => b.score-a.score || a.repositoryId-b.repositoryId || a.path.localeCompare(b.path) || a.startLine-b.startLine);
 // For broad inspection, consider one chunk per file before adjacent chunks.
 const files = new Set<string>();
 const first: typeof ranked = [], rest: typeof ranked = [];
 for (const candidate of ranked) {
  const key = JSON.stringify([candidate.repositoryId,candidate.revision,candidate.path]);
  (files.has(key) ? rest : first).push(candidate);files.add(key);
 }
 // Across projects, reserve a turn for each repository before taking another
 // file from any one repository. Keep rank order within each repository.
 const groups=new Map<number,typeof ranked>();
 for(const candidate of [...first,...rest]) {
  const group=groups.get(candidate.repositoryId)||[];group.push(candidate);groups.set(candidate.repositoryId,group);
 }
 const diverse:typeof ranked=[];
 for(let row=0; ;row++) {
  let added=false;
  for(const group of groups.values())if(group[row]){diverse.push(group[row]);added=true;}
  if(!added)break;
 }
 for (const candidate of diversify ? diverse : ranked) {
  if (!Number.isFinite(candidate.score) || candidate.score < policy.minScore || !candidate.content.trim()) continue;
  if (selected.some(source => source.repositoryId === candidate.repositoryId && source.revision === candidate.revision && source.path === candidate.path
    && (source.content === candidate.content || (candidate.startLine >= source.startLine && candidate.endLine <= source.endLine)))) continue;
  const size = Buffer.byteLength(candidate.content, "utf8");
  if (bytes + size > policy.maxBytes) continue;
  const { score: _score, ...source } = candidate;
  void _score;
  selected.push({...source,id:`S${selected.length+1}`});
  bytes += size;
  if (selected.length >= policy.maxSources) break;
 }
 return selected;
}
