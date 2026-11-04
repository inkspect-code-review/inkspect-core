import type { BetterAuthOptions, BetterAuthPlugin, DBAdapter, User } from "better-auth";
import { getCurrentAdapter, runWithTransaction } from "@better-auth/core/context";

export async function ensureWorkspace<Options extends BetterAuthOptions>(adapter: DBAdapter<Options>, userId: string) {
  return runWithTransaction(adapter, async () => {
    const tx = await getCurrentAdapter(adapter);
    // A no-op write locks this user's row until commit. Parallel logins cannot
    // both observe an empty membership list and create duplicate workspaces.
    const user = await tx.update<User>({ model: "user", where: [{ field: "id", value: userId }], update: { id: userId } });
    if (!user) throw new Error("Workspace user does not exist.");
    const existing = await tx.findMany<{ organizationId: string }>({
      model: "member", where: [{ field: "userId", value: userId }], sortBy: { field: "createdAt", direction: "asc" }, limit: 1,
    });
    if (existing[0]) return existing[0].organizationId;
    const name = user.name.trim().slice(0, 60) || user.email.split("@")[0].slice(0, 60);
    const organization = await tx.create<{ id: string }>({ model: "organization", data: {
      name: `${name}’s workspace`, slug: `workspace-${crypto.randomUUID()}`, createdAt: new Date(),
    } });
    await tx.create({ model: "member", data: { organizationId: organization.id, userId, role: "owner", createdAt: new Date() } });
    return organization.id;
  });
}

export const workspacePlugin = () => ({
  id: "default-workspace",
  init(ctx) {
    return { options: { databaseHooks: {
      user: { create: { after: async (user) => { await ensureWorkspace(ctx.adapter, user.id); } } },
      session: { create: { before: async (session) => ({ data: {
        ...session, activeOrganizationId: await ensureWorkspace(ctx.adapter, session.userId),
      } }) } },
    } } };
  },
  schema: {
    // No cascading foreign keys: reconnecting or deleting a workspace must not
    // let another account claim the same repo. Trial usage is account-bound.
    githubRepositoryClaim: { fields: {
      repositoryId: { type: "string", required: true, unique: true },
      organizationId: { type: "string", required: true, index: true },
      accountId: { type: "string", required: true },
      createdAt: { type: "date", required: true },
    } },
    knowledgeDocument: { fields: {
      organizationId: { type: "string", required: true, index: true, references: { model: "organization", field: "id", onDelete: "cascade" } },
      createdBy: { type: "string", required: true },
      title: { type: "string", required: true },
      content: { type: "string", required: true },
      createdAt: { type: "date", required: true, index: true },
    } },
    chatConversation: { fields: {
      organizationId: { type: "string", required: true, index: true, references: { model: "organization", field: "id", onDelete: "cascade" } },
      userId: { type: "string", required: true, index: true, references: { model: "user", field: "id", onDelete: "cascade" } },
      title: { type: "string", required: true },
      repositoryScope: { type: "string", required: true },
      shared: { type: "boolean", required: true, defaultValue: false },
      createdAt: { type: "date", required: true },
      updatedAt: { type: "date", required: true },
    } },
    chatMessage: { fields: {
      conversationId: { type: "string", required: true, index: true, references: { model: "chatConversation", field: "id", onDelete: "cascade" } },
      userId: { type: "string", required: true, index: true, references: { model: "user", field: "id", onDelete: "cascade" } },
      content: { type: "string", required: true },
      role: { type: "string", required: true, defaultValue: "user" },
      sources: { type: "string", required: true, defaultValue: "[]" },
      actions: { type: "string", required: true, defaultValue: "[]" },
      clientRequestId: { type: "string", required: false, unique: true },
      replyToId: { type: "string", required: false, unique: true },
      createdAt: { type: "date", required: true, index: true },
    } },
    workspaceSetup: { fields: {
      organizationId: { type: "string", required: true, unique: true, references: { model: "organization", field: "id", onDelete: "cascade" } },
      dismissedAt: { type: "date", required: false },
    } },
    githubConnection: { fields: {
      organizationId: { type: "string", required: true, index: true, references: { model: "organization", field: "id", onDelete: "cascade" } },
      installationId: { type: "string", required: true, unique: true },
      accountLogin: { type: "string", required: true },
      repositories: { type: "string", required: true },
      updatedAt: { type: "date", required: true },
    } },
  },
}) satisfies BetterAuthPlugin;
