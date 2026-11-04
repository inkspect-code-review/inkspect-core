import { requiresAccountOnboarding } from "./account-onboarding-config";
import { ageConfirmationRequired } from "./account-onboarding";
import { parseChatActions } from "./chat-actions";
import { citedChatSources } from "./chat-citations";
import type { ChatProgress } from "./chat-progress";
import { captureError } from "./diagnostics/server";
import { createHash } from "node:crypto";
import { AIError, type AIMessage } from "./bedrock";
import type { ChatReplyService } from "./chat-ai";
import type { createEditionAuth } from "./auth-factory";
import type { GitHubConnection, Repository } from "./github";
import type { ChatConversation } from "./workspace-chat";
import { isReviewReference, isKnowledgeReference, type ChatReference } from "./chat-review-evidence";
import { loadKnowledgeSource } from "./chat-knowledge";
import { loadChatSource } from "./chat-source";
import { ReviewError } from "./review-access";

type Auth = ReturnType<typeof createEditionAuth>;
type Conversation = { id: string; organizationId: string; userId: string; title: string; repositoryScope: string; shared: boolean; createdAt: Date; updatedAt: Date };
type Message = { id: string; conversationId: string; userId: string; content: string; role?: "user" | "assistant"; clientRequestId?: string; replyToId?: string; sources?: string; actions?: string; createdAt: Date };
class ChatError extends Error { constructor(public status: number, message: string) { super(message); } }

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ChatError(415, "Send a JSON request.");
  const reader = request.body?.getReader();
  if (!reader) throw new ChatError(400, "A request body is required.");
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 8 * 1024 * 1024) { await reader.cancel(); throw new ChatError(413, "This message is too long."); }
    chunks.push(value);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || Array.isArray(body) || typeof body !== "object") throw new Error();
    return body;
  } catch { throw new ChatError(400, "Invalid request."); }
}

export async function handleWorkspaceChat(request: Request, auth: Auth, reply: ChatReplyService) {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
  try {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.headers.get("origin") !== new URL(auth.options.baseURL).origin) throw new ChatError(403, "This request isn’t allowed.");
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new ChatError(401, "Sign in to use Ask AI.");
    if (requiresAccountOnboarding(session.user)) throw new ChatError(403, ageConfirmationRequired);
    const organizationId = url.searchParams.get("organizationId");
    if (!organizationId || organizationId !== session.session.activeOrganizationId) throw new ChatError(409, "Your workspace changed. Reopen Ask AI and try again.");
    const { adapter } = await auth.$context;
    const member = await adapter.findOne<{ id: string }>({ model: "member", where: [{ field: "userId", value: session.user.id }, { field: "organizationId", value: organizationId }] });
    if (!member) throw new ChatError(403, "You no longer have access to this workspace.");
    const body = request.method === "GET" ? {} : await readBody(request);
    const conversationId = request.method === "GET" ? url.searchParams.get("conversationId") : body.conversationId;
    let conversation: Conversation | null = null;
    if (conversationId) {
      if (typeof conversationId !== "string" || conversationId.length > 100) throw new ChatError(400, "Invalid conversation.");
      conversation = await adapter.findOne<Conversation>({ model: "chatConversation", where: [{ field: "id", value: conversationId }, { field: "organizationId", value: organizationId }] });
      if (!conversation || (conversation.userId !== session.user.id && !conversation.shared)) throw new ChatError(404, "This conversation is no longer available.");
    }
    const allMessages = async (id:string) => {
      const messages:Message[]=[];
      for(let offset=0;;offset+=200) {
        const page=await adapter.findMany<Message>({model:"chatMessage",where:[{field:"conversationId",value:id}],sortBy:{field:"createdAt",direction:"asc"},limit:200,offset});
        messages.push(...page);if(page.length<200)return messages;
      }
    };
    const present = async (row: Conversation): Promise<ChatConversation> => {
      const author = row.userId === session.user.id ? session.user : await adapter.findOne<{ name: string }>({ model: "user", where: [{ field: "id", value: row.userId }] });
      return { id: row.id, title: row.title, repositoryScope: row.repositoryScope, shared: row.shared, owner: row.userId === session.user.id, authorName: author?.name || "Workspace member", updatedAt: row.updatedAt.toISOString() };
    };
    if (request.method === "GET") {
      if (url.searchParams.has("sourceId")) {
        if (!conversation) throw new ChatError(400, "Choose a conversation.");
        const message = await adapter.findOne<Message>({ model: "chatMessage", where: [{ field: "id", value: url.searchParams.get("messageId") || "" }, { field: "conversationId", value: conversation.id }, { field: "role", value: "assistant" }] });
        const sources: ChatReference[] = citedChatSources(message?.content || "", JSON.parse(message?.sources || "[]"));
        const source = sources.find(item => item.id === url.searchParams.get("sourceId"));
        if (!source) throw new ChatError(404, "This source is not available in this message.");
        if(isReviewReference(source))throw new ChatError(400,"Open the saved review from its source card.");
        const connections = await adapter.findMany<GitHubConnection>({ model: "githubConnection", where: [{ field: "organizationId", value: organizationId }], limit: 10_000 });
        const loaded = isKnowledgeReference(source) ? await loadKnowledgeSource(source,organizationId,session.user.id) : await loadChatSource(source, organizationId, session.user.id, connections);
        // A source read may outlive unsharing, deletion, or membership revocation.
        const access = await adapter.findOne({ model: "member", where: [{ field: "userId", value: session.user.id }, { field: "organizationId", value: organizationId }] });
        const current = await adapter.findOne<Conversation>({ model: "chatConversation", where: [{ field: "id", value: conversation.id }, { field: "organizationId", value: organizationId }] });
        if (!access || !current || (current.userId !== session.user.id && !current.shared)) throw new ChatError(404, "This conversation is no longer available.");
        return json({ source: loaded });
      }
      if (conversation) {
        const messages = await allMessages(conversation.id);
        return json({ conversation: await present(conversation), messages: messages.map(({ id, content, role, sources, actions, createdAt }) => ({ id, content, role: role || "user", sources:citedChatSources(content, JSON.parse(sources||"[]")), actions:parseChatActions(actions), createdAt: createdAt.toISOString() })) });
      }
      const offset = Number(url.searchParams.get("offset") || 0);
      if (!Number.isInteger(offset) || offset < 0 || offset > 10_000) throw new ChatError(400, "Invalid page.");
      const where = [{ field: "organizationId", value: organizationId }, ...(url.searchParams.get("view") === "team" ? [{ field: "shared", value: true }] : [{ field: "userId", value: session.user.id }])];
      const rows = await adapter.findMany<Conversation>({ model: "chatConversation", where, sortBy: { field: "updatedAt", direction: "desc" }, limit: 31, offset });
      return json({ conversations: await Promise.all(rows.slice(0, 30).map(present)), hasMore: rows.length > 30 });
    }
    if (conversation && conversation.userId !== session.user.id) throw new ChatError(403, "Only the conversation owner can change it.");
    if (request.method === "PATCH") {
      if (!conversation || typeof body.shared !== "boolean") throw new ChatError(400, "Choose a conversation to share.");
      const updated = await adapter.update<Conversation>({ model: "chatConversation", where: [{ field: "id", value: conversation.id }, { field: "userId", value: session.user.id }], update: { shared: body.shared, updatedAt: new Date() } });
      if (!updated) throw new ChatError(404, "This conversation is no longer available.");
      return json({ conversation: await present(updated) });
    }
    if (request.method === "DELETE") {
      if (!conversation) throw new ChatError(400, "Choose a conversation to delete.");
      await reply.deleteConversation?.(organizationId,conversation.id);
      await adapter.transaction(async (tx) => {
        await tx.deleteMany({ model: "chatMessage", where: [{ field: "conversationId", value: conversation.id }] });
        await tx.delete({ model: "chatConversation", where: [{ field: "id", value: conversation.id }, { field: "userId", value: session.user.id }] });
      });
      return json({ deleted: true });
    }
    if (request.method !== "POST") throw new ChatError(405, "Method not allowed.");
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) throw new ChatError(400, "Enter a question.");
    if (body.requestId !== undefined && (typeof body.requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.requestId))) throw new ChatError(400, "Invalid message request.");
    const clientRequestId = body.requestId ? createHash("sha256").update(JSON.stringify([organizationId,session.user.id,body.requestId])).digest("hex") : undefined;
    const repositoryScope = conversation?.repositoryScope ?? body.repositoryScope;
    if (typeof repositoryScope !== "string") throw new ChatError(400, "Choose a repository scope.");
    const connections = await adapter.findMany<GitHubConnection>({ model: "githubConnection", where: [{ field: "organizationId", value: organizationId }], limit: 10_000 });
    const repos = connections.flatMap((connection) => JSON.parse(connection.repositories) as Repository[]);
    if (repositoryScope !== "all" && !repos.some((repo) => String(repo.id) === repositoryScope)) throw new ChatError(400, "This repository is no longer connected. Start a new conversation.");
    const result = await adapter.transaction(async (tx) => {
      // Serialize writes per member for the rate limit and message cap.
      const access = await tx.update({ model: "member", where: [{ field: "id", value: member.id }], update: { id: member.id } });
      if (!access) throw new ChatError(403, "You no longer have access to this workspace.");
      if (clientRequestId) {
        const previous = await tx.findOne<Message>({ model: "chatMessage", where: [{ field: "clientRequestId", value: clientRequestId }] });
        if (previous) {
          const priorConversation = await tx.findOne<Conversation>({ model: "chatConversation", where: [{ field: "id", value: previous.conversationId }, { field: "organizationId", value: organizationId }, { field: "userId", value: session.user.id }] });
          if (!priorConversation || previous.content !== content || priorConversation.repositoryScope !== repositoryScope || (conversation && conversation.id !== priorConversation.id)) throw new ChatError(409,"This request was already used for another question.");
          return { conversation: priorConversation, message: previous };
        }
      }
      const recent = await tx.count({ model: "chatMessage", where: [{ field: "userId", value: session.user.id }, { field: "role", value: "user" }, { field: "createdAt", operator: "gt", value: new Date(Date.now() - 60_000) }] });
      if (recent >= 20) throw new ChatError(429, "Please wait a moment before sending another question.");
      const now = new Date();
      const current = conversation ?? await tx.create<Conversation>({ model: "chatConversation", data: { organizationId, userId: session.user.id, title: content.replace(/\s+/g, " ").slice(0, 90), repositoryScope, shared: false, createdAt: now, updatedAt: now } });
      const message = await tx.create<Message>({ model: "chatMessage", data: { conversationId: current.id, userId: session.user.id, content, role: "user", ...(clientRequestId ? { clientRequestId } : {}), createdAt: now } });
      await tx.update({ model: "chatConversation", where: [{ field: "id", value: current.id }], update: { updatedAt: now } });
      return { conversation: { ...current, updatedAt: now }, message };
    });
    const envelope = { conversation: await present(result.conversation), message: { id: result.message.id, content: result.message.content, role: "user", createdAt: result.message.createdAt.toISOString() } };
    const complete = async (onDelta?:(text:string)=>void,onProgress?:(stage:ChatProgress)=>void) => {
    try {
      let assistant = await adapter.findOne<Message>({ model: "chatMessage", where: [{ field: "replyToId", value: result.message.id }] });
      if (!assistant) {
        const history = await allMessages(result.conversation.id);
        const messages: AIMessage[] = history.map(item=>{
          const reviewReferences=citedChatSources(item.content,JSON.parse(item.sources||"[]")).filter(isReviewReference).map(source=>({repository:source.repository,jobId:source.jobId,pullNumber:source.pullNumber}));
          return {role:item.role||"user",content:item.content,...(reviewReferences.length?{reviewReferences}:{})};
        });
        // Converse expects alternating roles, including older unanswered questions.
        const turns: AIMessage[] = [];
        for (const item of messages) { const last = turns.at(-1); if (last?.role === item.role) {last.content += "\n\n" + item.content;if(item.reviewReferences?.length)last.reviewReferences=[...(last.reviewReferences||[]),...item.reviewReferences];} else turns.push({ ...item }); }
        while (turns[0]?.role === "assistant") turns.shift();
        const answer = await reply({ onDelta, onProgress, firstMessage: history.filter(item => (item.role || "user") === "user").length === 1, organizationId, userId: session.user.id, messageId: result.message.id, conversationId: result.conversation.id, repositoryId: repositoryScope === "all" ? undefined : repositoryScope, repositories:connections.flatMap(c=>(JSON.parse(c.repositories) as Repository[]).filter(r=>repositoryScope==="all"||String(r.id)===repositoryScope).map(r=>({id:r.id,fullName:r.fullName,connectionId:c.id,installationId:Number(c.installationId)}))),repositoryNames: repos.filter((r) => repositoryScope === "all" || String(r.id) === repositoryScope).map((r) => r.fullName), messages: turns });
        assistant = await adapter.transaction(async (tx) => {
          const access = await tx.update({ model: "member", where: [{ field: "id", value: member.id }], update: { id: member.id } });
          if (!access) throw new ChatError(403,"You no longer have access to this workspace.");
          const exists = await tx.findOne<Conversation>({ model:"chatConversation",where:[{field:"id",value:result.conversation.id},{field:"userId",value:session.user.id}] });
          if (!exists) throw new ChatError(404,"This conversation was deleted.");
          const old = await tx.findOne<Message>({model:"chatMessage",where:[{field:"replyToId",value:result.message.id}]});
          if (old) return old;
          const now = new Date();
          const saved = await tx.create<Message>({ model: "chatMessage", data: { conversationId: result.conversation.id, userId: session.user.id, role: "assistant", replyToId: result.message.id, content: answer.content, sources:JSON.stringify(citedChatSources(answer.content, answer.sources||[])), actions:JSON.stringify(answer.actions||[]), createdAt: now } });
          const title = history.filter(item => (item.role || "user") === "user").length === 1 && typeof answer.title === "string" && answer.title.trim() && [...answer.title].length <= 80 ? answer.title : undefined;
          await tx.update({model:"chatConversation",where:[{field:"id",value:result.conversation.id}],update:{updatedAt:now,...(title ? {title} : {})}});
          if (title) envelope.conversation.title = title;
          return saved;
        });
      }
      await reply.delivered?.(result.message.id).catch(()=>{ console.error("Chat reply receipt is awaiting redaction."); });
      return json({ ...envelope, assistantMessage: { id: assistant.id, role: "assistant", content: assistant.content,sources:citedChatSources(assistant.content, JSON.parse(assistant.sources||"[]")), actions:parseChatActions(assistant.actions), createdAt: assistant.createdAt.toISOString() } },201);
    } catch (error) {
    captureError("chat.failure", error);
      if (error instanceof ChatError) throw error;
      return json({ ...envelope, replyError: error instanceof AIError ? error.message : "Your question is saved, but the AI reply couldn’t be confirmed. Reopen this conversation before trying again." },201);
    }
    };
    if(body.stream === true) {
      const encoder=new TextEncoder();let closed=false;
      const stream=new ReadableStream<Uint8Array>({
        start(controller) {
          const emit=(event:string,data:unknown)=>{if(!closed)try{controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));}catch{closed=true;}};
          emit("accepted",envelope);
          // Finish and persist provider usage even if the browser disconnects.
          // A replay uses the durable turn instead of submitting another paid call.
          const heartbeat=setInterval(()=>emit("ping",{}),15_000);
          void complete(text=>emit("delta",{text}),stage=>emit("progress",{stage})).then(async response=>{
            const data=await response.json();emit(data.replyError?"reply-error":"done",data);
          }).catch(error=>{
            captureError("chat.stream",error);
            emit("reply-error",{...envelope,replyError:error instanceof ChatError?error.message:"The reply could not be saved. Reopen this conversation before trying again."});
          }).finally(()=>{clearInterval(heartbeat);if(!closed){closed=true;controller.close();}});
        },
        cancel(){closed=true;},
      });
      return new Response(stream,{status:201,headers:{"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"private, no-store, no-transform","X-Accel-Buffering":"no"}});
    }
    return await complete();
  } catch (error) {
    captureError("chat.failure", error);
    if (error instanceof ChatError || error instanceof ReviewError) return json({ error: error.message }, error.status);
    return json({ error: "Couldn’t save or load this conversation. Please try again." }, 500);
  }
}
