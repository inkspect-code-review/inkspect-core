import { requiresAccountOnboarding } from "./account-onboarding-config";
import { ageConfirmationRequired } from "./account-onboarding";
import type { Auth } from "./github";
import { organizationAccess } from "./organization-access";
import type { MembershipService } from "./membership-service";
import { readReviewJSON, ReviewError, reviewFailure, reviewJSON } from "./review-access";

export async function handleMembers(request: Request, auth: Auth, membership: MembershipService) {
  try {
    const access=await organizationAccess(request,auth);
    if(!access.canManage)throw new ReviewError(403,"Only workspace owners and admins can manage invitations.");
    if(request.method==='GET')return reviewJSON({invitations:await membership.list(access.organizationId)});
    if(request.method!=='POST')throw new ReviewError(405,"Method not allowed.");
    const body=await readReviewJSON(request);
    if(body.action==='cancel' && typeof body.id==='string'){
      await membership.cancel(access.organizationId, access.user.id, body.id);
      return reviewJSON({cancelled:true});
    }
    if(body.action!=='invite')throw new ReviewError(400,"Choose an invitation action.");
    const invite=await membership.invite(access.organizationId,access.user.id,body);
    return reviewJSON({...invite,url:`${new URL(auth.options.baseURL).origin}/invite?id=${invite.id}`});
  } catch(error){return reviewFailure(error);}
}
export async function handleInvitation(request: Request, auth: Auth, membership: MembershipService) {
  try {
    if(request.method!=='GET' && request.method!=='POST')throw new ReviewError(405,"Method not allowed.");
    if(request.method==='POST' && request.headers.get('origin')!==new URL(auth.options.baseURL).origin)throw new ReviewError(403,"This request is not allowed.");
    const session=await auth.api.getSession({headers:request.headers});
    if(!session)throw new ReviewError(401,"Sign in to accept your invitation.");
    if (requiresAccountOnboarding(session.user)) throw new ReviewError(403, ageConfirmationRequired);
    const id=new URL(request.url).searchParams.get('id');
    if(!id || !/^[a-f0-9-]{36}$/.test(id))throw new ReviewError(400,"Invalid invitation.");
    if(request.method==='POST')return reviewJSON(await membership.accept(id,session.user));
    const row=await membership.find(id,session.user.email);
    if(!row)throw new ReviewError(404,"No invitation for this account. Sign in with the invited email address.");
    return reviewJSON(row);
  } catch(error){return reviewFailure(error);}
}
