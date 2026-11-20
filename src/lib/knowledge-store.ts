import { workspacePolicy } from "./workspace-policy";
import { ReviewError } from "./review-access";
import { requiresAccountOnboarding } from "./account-onboarding-config";
import { ageConfirmationRequired } from "./account-onboarding";
import { captureError } from "./diagnostics/server";
import type { createEditionAuth } from "./auth-factory";
import { validateKnowledgeDocument, type KnowledgeDocument } from "./knowledge";
import { knowledgeExcerpt } from "./knowledge-excerpt";

type Auth = ReturnType<typeof createEditionAuth>;
type DocumentRow = { id: string; organizationId: string; createdBy: string; title: string; content: string; createdAt: Date };
class KnowledgeError extends Error { constructor(public status: number, message: string) { super(message); } }

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new KnowledgeError(415, "Send a JSON request.");
  const reader = request.body?.getReader();
  if (!reader) throw new KnowledgeError(400, "A document is required.");
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    // JSON can escape each content byte as six characters.
    if (size > 400_000) { await reader.cancel(); throw new KnowledgeError(413, "This document is too large."); }
    chunks.push(value);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || Array.isArray(body) || typeof body !== "object") throw new Error();
    return body;
  } catch { throw new KnowledgeError(400, "Invalid document."); }
}

function present(row: DocumentRow): KnowledgeDocument {
  return { id: row.id, title: row.title, content: row.content, excerpt: knowledgeExcerpt(row.content), createdAt: row.createdAt.toISOString() };
}

export async function handleKnowledge(request: Request, auth: Auth) {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
  try {
    if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method)) throw new KnowledgeError(405, "Method not allowed.");
    if (request.method !== "GET" && request.headers.get("origin") !== new URL(auth.options.baseURL).origin) throw new KnowledgeError(403, "This request isn’t allowed.");
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new KnowledgeError(401, "Sign in to open the Knowledge Center.");
    if (requiresAccountOnboarding(session.user)) throw new KnowledgeError(403, ageConfirmationRequired);
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");
    if (!organizationId || organizationId !== session.session.activeOrganizationId) throw new KnowledgeError(409, "Your workspace changed. Refresh the page and try again.");
    const { adapter } = await auth.$context;
    const memberWhere = [{ field: "userId", value: session.user.id }, { field: "organizationId", value: organizationId }];
    const member = await adapter.findOne<{ id: string; role: string }>({ model: "member", where: memberWhere });
    if (!member) throw new KnowledgeError(403, "You no longer have access to this workspace.");
    await workspacePolicy(auth)?.assertAccess(organizationId);
    const where = [{ field: "organizationId", value: organizationId }];
    if (request.method === "GET") {
      const id = url.searchParams.get("documentId");
      if (id) {
        if (id.length > 100) throw new KnowledgeError(400, "Invalid document.");
        const document = await adapter.findOne<DocumentRow>({ model: "knowledgeDocument", where: [...where, { field: "id", value: id }] });
        if (!document) throw new KnowledgeError(404, "This document is no longer available.");
        return json({ document: present(document) });
      }
      const offset = Number(url.searchParams.get("offset") || 0);
      if (!Number.isInteger(offset) || offset < 0 || offset > 10_000) throw new KnowledgeError(400, "Invalid page.");
      const rows = await adapter.findMany<DocumentRow>({ model: "knowledgeDocument", where, sortBy: { field: "createdAt", direction: "desc" }, limit: 31, offset });
      return json({ documents: rows.slice(0, 30).map((row) => {
        const { id, title, excerpt, createdAt } = present(row);
        return { id, title, excerpt, createdAt };
      }), hasMore: rows.length > 30 });
    }
    const canManage = (role: string) => role.split(",").some((value) => ["owner", "admin"].includes(value.trim()));
    if (!canManage(member.role)) throw new KnowledgeError(403, "Only workspace owners and admins can manage documents.");
    const id = url.searchParams.get("documentId");
    if (request.method !== "POST" && (!id || id.length > 100)) throw new KnowledgeError(400, "Choose a valid document.");
    let title = "";
    let content = "";
    if (request.method !== "DELETE") {
      const body = await readBody(request);
      if (typeof body.title !== "string" || typeof body.content !== "string") throw new KnowledgeError(400, "Enter a document title and content.");
      const validation = validateKnowledgeDocument(body.title, body.content);
      if (validation) throw new KnowledgeError(400, validation);
      title = body.title.trim();
      content = body.content;
    }
    const document = await adapter.transaction(async (tx) => {
      // Recheck and lock membership before writing shared workspace knowledge.
      const access = await tx.update<{ role: string }>({ model: "member", where: [{ field: "id", value: member.id }, ...memberWhere], update: { id: member.id } });
      if (!access || !canManage(access.role)) throw new KnowledgeError(403, "Your document permissions changed. Refresh the page and try again.");
      const documentWhere = [...where, { field: "id", value: id! }];
      if (request.method === "DELETE") {
        const deleted = await tx.deleteMany({ model: "knowledgeDocument", where: documentWhere });
        if (!deleted) throw new KnowledgeError(404, "This document is no longer available.");
        return null;
      }
      if (request.method === "PATCH") {
        const updated = await tx.update<DocumentRow>({ model: "knowledgeDocument", where: documentWhere, update: { title, content } });
        if (!updated) throw new KnowledgeError(404, "This document is no longer available.");
        return updated;
      }
      return tx.create<DocumentRow>({ model: "knowledgeDocument", data: { organizationId, createdBy: session.user.id, title, content, createdAt: new Date() } });
    });
    if (!document) return json({ deleted: true });
    return json({ document: present(document) }, request.method === "POST" ? 201 : 200);
  } catch (error) {
    captureError("knowledge.failure", error);
    if (error instanceof KnowledgeError || error instanceof ReviewError) return json({ error: error.message }, error.status);
    return json({ error: "Couldn’t complete the document request. Please try again." }, 500);
  }
}
