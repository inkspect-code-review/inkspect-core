import { APIError } from "better-auth/api";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { magicLink } from "better-auth/plugins/magic-link";
import { organization } from "better-auth/plugins/organization";
import { passkey } from "@better-auth/passkey";
import { accountTwoFactor } from "./account-security";
import { readAuthEnvironment, socialProviders } from "./auth-config";
import { sendMagicLinkEmail } from "./mail";
import { workspacePlugin } from "./workspace";
import { prepareAccountLink, validateAccountLinking } from "./account-linking";
import { accountOnboarding } from "./account-onboarding-plugin";
import { rememberLastLoginMethod } from "./last-login-method";

export type AuthEditionPolicy = {
  additionalSocialProviders?: BetterAuthOptions["socialProviders"];
  canCreateOrganization: (user: { id: string; emailVerified: boolean }) => boolean | Promise<boolean>;
  createInvitationMessage: string;
  acceptInvitationMessage: string;
};

export function createEditionAuth(database: NonNullable<BetterAuthOptions["database"]>, policy: AuthEditionPolicy, sendLink = sendMagicLinkEmail) {
  const env = readAuthEnvironment();
  return betterAuth({
    appName: "Inkspect",
    baseURL: env.baseURL,
    secret: env.secret,
    database,
    trustedOrigins: [env.baseURL, "https://appleid.apple.com"],
    socialProviders: { ...socialProviders(), ...policy.additionalSocialProviders },
    // The ingress must overwrite this header and keep the upstream private.
    advanced: { ipAddress: { ipAddressHeaders: ["x-real-ip"] } },
    account: {
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        trustedProviders: [],
        requireLocalEmailVerified: true,
        allowDifferentEmails: false,
        updateUserInfoOnLink: false,
      },
    },
    hooks: { before: prepareAccountLink },
    user: { validateUserInfo: validateAccountLinking },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: true, storage: "database", window: 60, max: 60,
      // OAuth cancellation and provider switching should allow normal retries.
      // Override the built-in 3-per-10-second sign-in rule only for social login.
      customRules: { "/sign-in/social": { window: 60, max: 30 } },
    },
    onAPIError: { errorURL: "/login" },
    plugins: [accountOnboarding(), accountTwoFactor(), passkey({ rpName: "Inkspect", rpID: new URL(env.baseURL).hostname, origin: new URL(env.baseURL).origin, authenticatorSelection: { userVerification: "required" } }), magicLink({
      expiresIn: 60 * 10,
      storeToken: "hashed",
      rateLimit: { window: 60, max: 3 },
      sendMagicLink: sendLink,
    }), organization({ allowUserToCreateOrganization: (user) => policy.canCreateOrganization(user), organizationHooks: {
      // Route every invitation through the selected edition membership service.
      beforeCreateInvitation: async () => { throw new APIError("FORBIDDEN", { message: policy.createInvitationMessage }); },
      beforeAcceptInvitation: async () => { throw new APIError("FORBIDDEN", { message: policy.acceptInvitationMessage }); },
    } }), workspacePlugin(), rememberLastLoginMethod()],
  });
}
