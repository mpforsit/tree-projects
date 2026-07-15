/**
 * better-auth server configuration (spec §8). Email OTP (6 digits,
 * 10-minute expiry, single active code, ≤5 verification attempts) plus
 * generic OIDC with Entra as the first provider — enabled only when the
 * ENTRA_* env vars are set, always with an explicit tenant, never "any
 * Microsoft account" (§8.2).
 *
 * No self-registration exists (§8.1): sign-up is disabled on both paths;
 * users come into existence through invitations (invite_member /
 * appoint_tenant_admin).
 *
 * better-auth connects with its own role (auth_user, migration 0019) that
 * can see auth tables and users, but no tenant data.
 */
import { betterAuth } from "better-auth";
import { emailOTP, genericOAuth } from "better-auth/plugins";
import pg from "pg";
import { entraClaimsFromIdToken } from "./entra.ts";
import { log } from "./log.ts";
import { sendMail } from "./mail.ts";
import { strings } from "./strings.ts";

let authPool: pg.Pool | undefined;

export function getAuthPool(): pg.Pool {
  if (!authPool) {
    const url = process.env.AUTH_DATABASE_URL;
    if (!url) throw new Error("AUTH_DATABASE_URL is not set");
    authPool = new pg.Pool({ connectionString: url });
  }
  return authPool;
}

export function isEntraConfigured(): boolean {
  return Boolean(
    process.env.ENTRA_TENANT_ID && process.env.ENTRA_CLIENT_ID && process.env.ENTRA_CLIENT_SECRET,
  );
}

// Constructed lazily: the module must be importable at build time,
// before any runtime env exists.
let _auth: ReturnType<typeof buildAuth> | undefined;

export function getAuth(): ReturnType<typeof buildAuth> {
  _auth ??= buildAuth();
  return _auth;
}

function buildAuth() {
  const entraConfigured = isEntraConfigured();
  return betterAuth({
  database: getAuthPool(),
  user: {
    modelName: "user",
    fields: {
      name: "display_name",
      emailVerified: "email_verified",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  session: {
    modelName: "auth_session",
    fields: {
      userId: "user_id",
      expiresAt: "expires_at",
      ipAddress: "ip_address",
      userAgent: "user_agent",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    expiresIn: 60 * 60 * 24 * 30, // 30 days…
    updateAge: 60 * 60 * 24, // …sliding (refreshed daily on use), spec §8.1
  },
  account: {
    modelName: "auth_account",
    fields: {
      userId: "user_id",
      accountId: "account_id",
      providerId: "provider_id",
      accessToken: "access_token",
      refreshToken: "refresh_token",
      idToken: "id_token",
      accessTokenExpiresAt: "access_token_expires_at",
      refreshTokenExpiresAt: "refresh_token_expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    accountLinking: {
      enabled: true, // §8: methods link to ONE user via verified email
      trustedProviders: entraConfigured ? ["entra"] : [],
    },
  },
  verification: {
    modelName: "auth_verification",
    fields: {
      expiresAt: "expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    modelName: "auth_rate_limit",
    fields: { lastRequest: "last_request" },
    customRules: {
      // The §8.1 control is ≤5 attempts per code (allowedAttempts below)
      // and ≤5 requests/h/email (app throttle in /api/login/request-otp).
      // The default per-IP window (3/min) would mask both — keep a
      // generous IP guard only.
      "/sign-in/email-otp": { window: 60, max: 20 },
    },
  },
  advanced: {
    database: { generateId: "uuid" },
  },
  databaseHooks: {
    session: {
      create: {
        // auth.login event (§3) — instance-level, tenant_id null.
        after: async (session) => {
          await getAuthPool().query(
            `INSERT INTO event (tenant_id, node_id, actor_member_id, source, type, payload)
             VALUES (NULL, NULL, NULL, 'ui', 'auth.login', $1)`,
            [JSON.stringify({ user_id: session.userId })],
          );
        },
      },
    },
  },
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 600, // 10 minutes (§8.1)
      allowedAttempts: 5, // ≤5 attempts per code, then the code is dead
      disableSignUp: true, // invitation-only
      // default resendStrategy "rotate": any newer request invalidates
      // the previous code (§8.1)
      sendVerificationOTP: async ({ email, otp, type }) => {
        if (type !== "sign-in") return;
        await sendMail({
          to: email,
          subject: strings.otpMail.subject,
          text: strings.otpMail.body(otp),
        });
      },
    }),
    ...(entraConfigured
      ? [
          genericOAuth({
            config: [
              {
                providerId: "entra",
                discoveryUrl: `https://login.microsoftonline.com/${process.env.ENTRA_TENANT_ID}/v2.0/.well-known/openid-configuration`,
                clientId: process.env.ENTRA_CLIENT_ID!,
                clientSecret: process.env.ENTRA_CLIENT_SECRET,
                scopes: ["openid", "profile", "email"],
                pkce: true,
                disableSignUp: true, // invitation-only, also via SSO
                // §8.2 enforcement: the tid must be allowlisted by at
                // least one tenant; the linked account stores tid/oid so
                // the Teams identity mapping (phase 2) stays exact.
                getUserInfo: async (tokens) => {
                  const idToken = tokens.idToken;
                  const claims = idToken ? entraClaimsFromIdToken(idToken) : null;
                  if (!claims || !claims.email) {
                    log.info("entra sign-in rejected: unusable id_token");
                    return null;
                  }
                  const { rows } = await getAuthPool().query<{ allowed: boolean }>(
                    "SELECT auth_entra_tid_allowed($1) AS allowed",
                    [claims.tid],
                  );
                  if (!rows[0]?.allowed) {
                    log.info("entra sign-in rejected: tid not allowlisted", {
                      tid: claims.tid,
                    });
                    return null;
                  }
                  return {
                    id: `${claims.tid}/${claims.oid}`,
                    email: claims.email,
                    name: claims.name ?? claims.email,
                    emailVerified: true,
                  };
                },
              },
            ],
          }),
        ]
      : []),
  ],
  });
}

export type SessionUser = {
  id: string;
  email: string;
  name: string;
};

/** Verified session user from request headers, or null. */
export async function getSessionUser(headers: Headers): Promise<SessionUser | null> {
  const session = await getAuth().api.getSession({ headers });
  if (!session) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  };
}
