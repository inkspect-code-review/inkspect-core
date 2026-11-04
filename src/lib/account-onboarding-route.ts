import type { Auth } from "./github";
import { accountOnboardingEnabled } from "./account-onboarding-config";
import { ageConfirmationVersion, hasConfirmedAge, onboardingDestination } from "./account-onboarding";
import { readReviewJSON, ReviewError, reviewFailure, reviewJSON } from "./review-access";

export async function handleAccountOnboarding(request: Request, auth: Auth) {
  try {
    if (request.method !== "POST") throw new ReviewError(405, "Method not allowed.");
    if (request.headers.get("origin") !== new URL(auth.options.baseURL).origin) throw new ReviewError(403, "This request is not allowed.");
    if (!accountOnboardingEnabled()) throw new ReviewError(404, "Account setup is not available.");
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new ReviewError(401, "Sign in to finish setting up your account.");
    const body = await readReviewJSON(request);
    if (body.confirmAdult !== true) throw new ReviewError(400, "You must be at least 18 and have reached the age of legal majority where you live to use Inkspect.");
    if (typeof body.name !== "string" || body.name.trim().length > 100 || /[\x00-\x1f\x7f]/.test(body.name)) throw new ReviewError(400, "Enter a name of up to 100 characters.");
    if (typeof body.referralSource !== "string" || body.referralSource.trim().length > 300 || /[\x00-\x1f\x7f]/.test(body.referralSource)) throw new ReviewError(400, "Tell us how you heard about Inkspect in up to 300 characters.");
    const name = body.name.trim();
    const referralSource = body.referralSource.trim();
    const { adapter } = await auth.$context;
    await adapter.transaction(async (tx) => {
      // Lock the user so retries cannot overwrite the original confirmation or profile.
      const user = await tx.update<{ ageConfirmedAt?: Date }>({ model: "user", where: [{ field: "id", value: session.user.id }], update: { id: session.user.id } });
      if (!user) throw new ReviewError(401, "Sign in to finish setting up your account.");
      if (hasConfirmedAge(user)) return;
      await tx.update({ model: "user", where: [{ field: "id", value: session.user.id }], update: {
        ...(name && { name }), referralSource: referralSource || null,
        ageConfirmedAt: new Date(), ageConfirmationVersion, updatedAt: new Date(),
      } });
    });
    return reviewJSON({ next: onboardingDestination(body.next) });
  } catch (error) { return reviewFailure(error); }
}
