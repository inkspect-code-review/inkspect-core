export function authErrorMessage(code?: string, status?: number): string {
  if (status === 429) return "Too many attempts. Please try again shortly.";
  switch (code?.toLowerCase()) {
    case "invalid_token":
    case "token_expired":
    case "expired_token":
      return "This sign-in link has expired or has already been used. Request a new link below.";
    case "account_not_linked":
      return "Confirm your existing account using your original sign-in method or an email link, then connect the new sign-in method.";
    case "link_reauth_required":
      return "For your security, sign in to your existing account again before connecting another sign-in method.";
    case "email_does_not_match":
      return "The email addresses don’t match. Choose the provider account with the same email as your Inkspect account.";
    case "account_already_linked_to_different_user":
    case "social_account_already_linked":
      return "This sign-in method is already connected to another Inkspect account.";
    case "unable_to_link_account":
    case "link_flow_required":
      return "We couldn’t connect this sign-in method. Confirm your existing account and try again.";
    case "access_denied":
      return "Sign-in was cancelled. Choose a sign-in method to try again.";
    case "provider_not_found":
    case "auth_unavailable":
      return "This sign-in method is currently unavailable. Please try again later.";
    default:
      return "We couldn’t sign you in. Please try again or choose another sign-in method.";
  }
}
