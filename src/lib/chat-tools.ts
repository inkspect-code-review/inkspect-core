import { AIError } from "./bedrock";
import { retrieveChatContext, type ChatContext, type ChatRepository } from "./chat-context";
import { searchKnowledge } from "./chat-knowledge";
import { readLatestReviews } from "./chat-review-tools";
import type { ChatRoute } from "./chat-routing";
import type { ChatProgress } from "./chat-progress";

// Closed read-only registry: the planner cannot supply SQL, endpoints, claims,
// organization IDs, credentials, or mutation functions.
export async function gatherChatEvidence(input:{organizationId:string;userId:string;messageId:string;repositories:ChatRepository[];onProgress?:(stage:ChatProgress)=>void},plan:ChatRoute,dependencies:{search?:typeof retrieveChatContext;reviews?:typeof readLatestReviews;knowledge?:typeof searchKnowledge}={}):Promise<ChatContext> {
 let repositories=input.repositories;
 if(!repositories.length && !(plan.tools?.length===1 && plan.tools[0]==="knowledge_search"))throw new AIError(409,"Connect a repository before asking about your projects.");
 if(plan.repositories?.length){
  const names=new Set(plan.repositories.map(name=>name.toLowerCase()));
  repositories=repositories.filter(repo=>names.has(repo.fullName.toLowerCase()));
  if(new Set(repositories.map(repo=>repo.fullName.toLowerCase())).size!==names.size)throw new AIError(400,"Include the requested repositories in the chat selection before comparing them.");
 }
 const tools=new Set(plan.tools||["repository_search"]);
 if(plan.retrieval==="inspection" || tools.has("latest_reviews"))tools.add("knowledge_search");
 let context:ChatContext={sources:[],repositories:repositories.map(repo=>repo.fullName),incomplete:false,mode:"repository"};
 if(tools.has("repository_search")){
  input.onProgress?.("gathering");
  context=await (dependencies.search||retrieveChatContext)({...input,repositories,question:plan.query,retrieval:plan.retrieval});
 }
 if(tools.has("latest_reviews")||tools.has("review_diagrams")){
  input.onProgress?.(tools.has("review_diagrams")?"reading_diagrams":"reading_reviews");
  context.reviewResults=await (dependencies.reviews||readLatestReviews)({...input,repositories,pullNumber:plan.pullNumber,jobId:plan.jobId,includeDiagrams:tools.has("review_diagrams")});
  context.incomplete ||= context.reviewResults.some(result=>result.status==="unavailable"||result.historyLimited);
 }
 if(tools.has("knowledge_search")) {
  input.onProgress?.("reading_knowledge");
  context.knowledge=await (dependencies.knowledge||searchKnowledge)({...input,query:plan.knowledgeQuery||plan.query});
  context.incomplete ||= context.knowledge.incomplete;
 }
 return context;
}
