/** better-auth React client for the login screens and the avatar menu. */
import { createAuthClient } from "better-auth/react";
import { emailOTPClient, genericOAuthClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [emailOTPClient(), genericOAuthClient()],
});
