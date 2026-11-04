import type { BetterAuthOptions } from "better-auth";
import { createEditionAuth, type AuthEditionPolicy } from "../lib/auth-factory";
import { sendMagicLinkEmail } from "../lib/mail";

export const selfHostedAuthPolicy: AuthEditionPolicy = {
  canCreateOrganization: user => user.emailVerified,
  createInvitationMessage: "Create invitations in Members.",
  acceptInvitationMessage: "Use your workspace invitation link to join this workspace.",
};

export function createSelfHostedAuth(database: NonNullable<BetterAuthOptions["database"]>, sendLink = sendMagicLinkEmail) {
  return createEditionAuth(database, selfHostedAuthPolicy, sendLink);
}
