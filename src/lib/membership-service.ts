export type InvitationUser = { id: string; email: string; emailVerified?: boolean };
export type Invitation = { id: string; email: string; role: string; status?: string; expires_at: Date | string; tier?: string; name?: string };

// Implementations own persistence and any edition-specific admission rules.
// The shared HTTP layer always authenticates and scopes requests first.
export interface MembershipService {
  list(organizationId: string): Promise<Invitation[]>;
  invite(organizationId: string, inviterId: string, input: Record<string, unknown>): Promise<Invitation>;
  cancel(organizationId: string, actorId: string, invitationId: string): Promise<void>;
  find(invitationId: string, email: string): Promise<Invitation | undefined>;
  accept(invitationId: string, user: InvitationUser): Promise<{ organizationId: string }>;
}
