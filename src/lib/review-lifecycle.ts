import type { engineRequest, EngineClaims } from "./engine-client";
import type { reviewAccess } from "./review-access";

// Edition implementations must preserve repository authorization, durable
// admission identity and completion reconciliation independently of charging.
export interface ReviewLifecycle {
  start(access: Awaited<ReturnType<typeof reviewAccess>>, body: Record<string, unknown>, claims: Omit<EngineClaims, "expires">, send: typeof engineRequest): ReturnType<typeof engineRequest>;
  settle(organization: string, result: unknown): Promise<void>;
}

export type ReviewProviderState = (organization: string) => Promise<{
  review_provider: string;
  connection: { id: string } | null;
}>;
