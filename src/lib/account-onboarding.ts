import { isOpenSourceApplicationPath } from "./sign-in-destinations";

export const ageConfirmationCopy = "I confirm that I am at least 18 years old and have reached the age of legal majority where I live.";
export const ageConfirmationVersion = "2026-11-04";
export const ageConfirmationRequired = "Confirm that you are an adult before continuing to Inkspect.";

export function hasConfirmedAge(user: object) {
  const value = "ageConfirmedAt" in user ? user.ageConfirmedAt : undefined;
  return (value instanceof Date || typeof value === "string") && Number.isFinite(new Date(value).getTime());
}

// Keep invitations and the OSS application intact without accepting arbitrary redirects.
export function onboardingDestination(value: unknown) {
  return isOpenSourceApplicationPath(value) || (typeof value === "string" && /^\/invite\?id=[a-f0-9-]{36}$/.test(value)) ? value : "/dashboard";
}

export function welcomePath(next?: unknown) {
  const destination = onboardingDestination(next);
  return destination === "/dashboard" ? "/welcome" : `/welcome?next=${encodeURIComponent(destination)}`;
}
