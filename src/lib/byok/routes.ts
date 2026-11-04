import type { Auth } from "../github";
import { organizationAccess } from "../organization-access";
import { readReviewJSON, ReviewError, reviewJSON } from "../review-access";
import { byokModels, byokProviders } from "./catalog";
import type { ProviderSettingsService } from "./service";

export async function handleByokSettings(request: Request, auth: Auth, services: ProviderSettingsService) {
  try {
    const access=await organizationAccess(request,auth);
    if (request.method==="GET") return reviewJSON({...await services.state(access.organizationId), can_manage:access.canManage, encryption_ready:services.ready(), providers:byokProviders, models:byokModels});
    if (!access.canManage) throw new ReviewError(403,"Only workspace owners and admins can manage provider keys.");
    if (request.method==="DELETE") { await services.remove(access.organizationId,access.user.id); return reviewJSON({removed:true}); }
    if (request.method!=="POST") throw new ReviewError(405,"Method not allowed.");
    const body=await readReviewJSON(request,8192);
    if(body.action==="provider"){await services.setMode(access.organizationId,access.user.id,body.mode);return reviewJSON({saved:true});}
    await services.save(access.organizationId,access.user.id,body.provider,body.model,body.api_key);
    return reviewJSON({saved:true});
  } catch (error) {
    // Never forward raw errors from credential handling to diagnostics or clients.
    return reviewJSON({error:error instanceof ReviewError ? error.message : "Provider settings are unavailable. Please try again."},error instanceof ReviewError ? error.status : 503);
  }
}
