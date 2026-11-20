import { workspacePolicy } from "./workspace-policy";
import { ReviewError } from "./review-access";
import { requiresAccountOnboarding } from "./account-onboarding-config";
import { ageConfirmationRequired } from "./account-onboarding";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { Auth } from "./github";
import { captureError } from "./diagnostics/server";
import { workspaceLogoMaxBytes, workspaceLogoTypes, workspaceLogoURL, workspaceLogoVersion } from "./workspace-logo";
import { workspaceLogoStorage, type WorkspaceLogoStorage } from "./workspace-logo-storage";

class LogoError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const canManage = (role: string) => role.split(",").some(value => ["owner", "admin"].includes(value.trim()));
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

async function readImage(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";")[0];
  if (!workspaceLogoTypes.some(type => type === contentType)) throw new LogoError(415, "Choose a PNG, JPEG or WebP image.");
  if (Number(request.headers.get("content-length")) > workspaceLogoMaxBytes) throw new LogoError(413, "Choose an image smaller than 2 MB.");
  const reader = request.body?.getReader();
  if (!reader) throw new LogoError(400, "Choose an image to upload.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > workspaceLogoMaxBytes) { await reader.cancel(); throw new LogoError(413, "Choose an image smaller than 2 MB."); }
    chunks.push(value);
  }
  try {
    const image = sharp(Buffer.concat(chunks), { limitInputPixels: 16_777_216, failOn: "warning" });
    const metadata = await image.metadata();
    if (!metadata.format || !["png", "jpeg", "webp"].includes(metadata.format) || contentType !== `image/${metadata.format}` || (metadata.pages ?? 1) !== 1) throw new Error("Invalid image format");
    // Decode and re-encode: remove metadata, ignore filenames, retain transparency.
    return await image.rotate().resize(256, 256, { fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
  } catch { throw new LogoError(400, "This image couldn’t be read. Choose a still PNG, JPEG or WebP image up to 16 megapixels."); }
}

export async function handleWorkspaceLogo(request: Request, auth: Auth, storage: WorkspaceLogoStorage = workspaceLogoStorage) {
  try {
    if (!["GET", "POST", "DELETE"].includes(request.method)) throw new LogoError(405, "Method not allowed.");
    const writing = request.method !== "GET";
    if (writing && request.headers.get("origin") !== new URL(auth.options.baseURL).origin) throw new LogoError(403, "This request isn’t allowed.");
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new LogoError(401, "Sign in to view workspace logos.");
    if (requiresAccountOnboarding(session.user)) throw new LogoError(403, ageConfirmationRequired);
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");
    if (!organizationId || organizationId.length > 100) throw new LogoError(400, "Choose a valid workspace.");
    if (writing && organizationId !== session.session.activeOrganizationId) throw new LogoError(409, "Your workspace changed. Refresh the page and try again.");
    const { adapter } = await auth.$context;
    const memberWhere = [{ field: "userId", value: session.user.id }, { field: "organizationId", value: organizationId }];
    const member = await adapter.findOne<{ id: string; role: string }>({ model: "member", where: memberWhere });
    if (!member) throw new LogoError(403, "You no longer have access to this workspace.");
    await workspacePolicy(auth)?.assertAccess(organizationId);
    if (writing && !canManage(member.role)) throw new LogoError(403, "Only workspace owners and admins can change the logo.");
    const organizationWhere = [{ field: "id", value: organizationId }];
    if (!writing) {
      const organization = await adapter.findOne<{ logo: string | null }>({ model: "organization", where: organizationWhere });
      const version = workspaceLogoVersion(organizationId, organization?.logo);
      if (!version || version !== url.searchParams.get("v")) throw new LogoError(404, "Logo not found.");
      const bytes = await storage.get(organizationId, version);
      if (!bytes) throw new LogoError(404, "Logo not found.");
      return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" } });
    }
    if (!storage.ready()) throw new LogoError(503, "Logo uploads are not available yet. Please try again later.");
    const version = request.method === "POST" ? randomUUID() : null;
    const logo = version ? workspaceLogoURL(organizationId, version) : null;
    if (version) await storage.put(organizationId, version, await readImage(request));
    let previous: string | null;
    try {
      previous = await adapter.transaction(async tx => {
        // Lock and recheck membership after the upload, then serialize logo changes.
        const access = await tx.update<{ role: string }>({ model: "member", where: [{ field: "id", value: member.id }, ...memberWhere], update: { id: member.id } });
        if (!access || !canManage(access.role)) throw new LogoError(403, "Your permissions changed. Refresh the page and try again.");
        const current = await tx.update<{ logo: string | null }>({ model: "organization", where: organizationWhere, update: { id: organizationId } });
        if (!current) throw new LogoError(404, "Workspace not found.");
        await tx.update({ model: "organization", where: organizationWhere, update: { logo } });
        return workspaceLogoVersion(organizationId, current.logo);
      });
    } catch (error) {
      if (version) await storage.remove(organizationId, version).catch(cleanupError => captureError("workspace-logo.cleanup", cleanupError));
      throw error;
    }
    if (previous) await storage.remove(organizationId, previous).catch(error => captureError("workspace-logo.cleanup", error));
    return json({ logo });
  } catch (error) {
    if (error instanceof ReviewError) return json({ error: error.message }, error.status);
    if (!(error instanceof LogoError)) captureError("workspace-logo.failure", error);
    return json({ error: error instanceof LogoError ? error.message : "Couldn’t update or load the workspace logo. Please try again." }, error instanceof LogoError ? error.status : 503);
  }
}
