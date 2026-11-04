import { hasConfirmedAge, onboardingDestination, welcomePath } from "./account-onboarding";

type Environment = Record<string, string | undefined>;

export function accountOnboardingEnabled(env: Environment = process.env) {
  return env.INKSPECT_ACCOUNT_ONBOARDING_ENABLED === "true";
}

export function requiresAccountOnboarding(user: object, env: Environment = process.env) {
  return accountOnboardingEnabled(env) && !hasConfirmedAge(user);
}

export function accountEntryPath(next?: unknown, env: Environment = process.env) {
  return accountOnboardingEnabled(env) ? welcomePath(next) : onboardingDestination(next);
}
