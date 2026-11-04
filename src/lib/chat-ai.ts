import { chatIndexActions } from "./chat-actions";
import type { ChatProgress } from "./chat-progress";
import { routeChat, noEvidenceReply, type ChatRoute } from "./chat-routing";
import { gatherChatEvidence } from "./chat-tools";
import { generateChatTitle } from "./chat-title";
import { captureError } from "./diagnostics/server";
import { retrieveChatContext,type ChatRepository } from "./chat-context";
import { AIError, bedrockConfig, converse, type AIMessage, type AIReply } from "./bedrock";
import { ReviewError } from "./review-access";
export type ChatReplyInput = { organizationId: string; userId: string; messageId: string; conversationId: string; firstMessage?: boolean; repositoryId?: string; repositoryNames: string[]; repositories?:ChatRepository[]; messages: AIMessage[]; onDelta?:(text:string)=>void; onProgress?:(stage:ChatProgress)=>void };
export type ChatReplyService = ((input: ChatReplyInput) => Promise<AIReply>) & { delivered?:(messageId:string)=>Promise<void>; deleteConversation?:(organization:string,conversationId:string)=>Promise<void> };
export interface ChatLedger {
  begin(input: ChatReplyInput, model: string): Promise<AIReply | null>;
  routing(input: ChatReplyInput, route: ChatRoute | undefined, usage: AIReply | undefined): Promise<void>;
  check(input: ChatReplyInput, stage: "search" | "answer"): Promise<void>;
  failed(input: ChatReplyInput, model: string, calledModel: boolean): Promise<void>;
  title(input: ChatReplyInput, usage: AIReply | undefined): Promise<void>;
  complete(input: ChatReplyInput, reply: AIReply, calledModel: boolean): Promise<void>;
  delivered(messageId: string): Promise<void>;
  deleteConversation(organization: string, conversationId: string): Promise<void>;
}
export type ChatGenerationOptions = { fetcher?: typeof fetch; retrieve?: typeof retrieveChatContext; route?: typeof routeChat; tools?: Parameters<typeof gatherChatEvidence>[2] };

export function createChatReplyService(ledger: ChatLedger, options: ChatGenerationOptions = {}): ChatReplyService {
async function generateReply(input: ChatReplyInput) {
  const config = bedrockConfig();
  const previous = await ledger.begin(input, config.model);
  if(previous) return previous;
  let reply:AIReply;let calledModel=false;
  let route: ChatRoute | undefined;
  try {
    // Query rewriting is separately metered. Topic relevance is decided from
    // retrieved evidence, never by a pre-search scope gate.
    let routingUsage: AIReply | undefined;
    try {
      input.onProgress?.("thinking");
      const routed = await (options.route || routeChat)(input.messages, input.repositoryNames, options.fetcher || fetch);
      route = routed.route;
      routingUsage = routed.usage;
    } finally {
      await ledger.routing(input, route, routingUsage);
    }
    await ledger.check(input, "search");
    const context = await gatherChatEvidence({...input,repositories:input.repositories||[]},route,{...options.tools,search:options.retrieve||options.tools?.search});
    input.onProgress?.("answering");
    if (!context.sources.length && !context.reviewResults?.length && !context.knowledge && !context.indexAvailability?.length) {
      reply = noEvidenceReply(route.language);
      input.onDelta?.(reply.content);
    } else {
    // Recheck admission after retrieval before generating a response.
    await ledger.check(input, "answer");
    calledModel=true;reply=await converse(input.messages,input.repositoryNames,options.fetcher||fetch,config,{...context,mode:"repository"},{onDelta:input.onDelta});
    }
    reply.actions=chatIndexActions(context.indexAvailability);
  }
  catch(error) {
    // A network failure may follow actual provider usage. Never invent zero cost
    // or automatically retry a call whose outcome is unknown.
    await ledger.failed(input, config.model, calledModel);
    if(error instanceof ReviewError) throw new AIError(error.status,error.message);
    throw error;
  }
  if (input.firstMessage && calledModel) {
    let titleReply: AIReply | undefined;
    try {
      titleReply = await generateChatTitle(input.messages.find(message => message.role === "user")?.content || "", options.fetcher || fetch);
      reply.title = titleReply.content;
    } catch (error) { captureError("chat.title", error); }
    try {
      await ledger.title(input, titleReply);
    } catch (error) { captureError("chat.title.usage", error); }
  }
  await ledger.complete(input, reply, calledModel);
  return reply;
};

return Object.assign(generateReply, {
  delivered: (messageId: string) => ledger.delivered(messageId),
  deleteConversation: (organization: string, conversationId: string) => ledger.deleteConversation(organization, conversationId),
});
}
