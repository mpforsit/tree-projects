/**
 * All user-facing strings live here (CLAUDE.md convention: no hardcoded UI
 * text). German-first; login and /instance are English (spec §8.3/§15.1).
 */
export const strings = {
  placeholder: {
    deploymentBaseline: "TreeOps — Deployment-Baseline (M0).",
  },
  login: {
    // English by design — invitation links travel across organizations.
    welcome: "Welcome",
    emailLabel: "Email address",
    continueWithEmail: "Continue with email",
    checkInbox: "Check your inbox",
    codeSentTo: (email: string) => `We sent a 6-digit code to ${email}.`,
    codeRequested:
      "If this address is registered, a code is on its way.",
    ssoEnforced:
      "This domain uses single sign-on. Please sign in with Microsoft.",
    invalidCode: "That code is invalid or has expired.",
    sendNewCode: "Send a new code",
    youAreIn: "You're in.",
    openTreeOps: "Open TreeOps",
    or: "or",
    signInWithMicrosoft: "Sign in with Microsoft",
    invitationOnly: "Invitation-only — there is no public sign-up.",
    noMemberships:
      "You have no active memberships. Ask an administrator to invite you.",
    pickTenant: "Choose a workspace",
  },
  invitation: {
    subject: (tenantName: string) => `You've been invited to ${tenantName} on TreeOps`,
    body: (tenantName: string, url: string) =>
      `You have been invited to join ${tenantName} on TreeOps.\n\nSign in with this email address to get started:\n${url}\n\nInvitation-only — there is no public sign-up.`,
  },
  otpMail: {
    subject: "Your TreeOps sign-in code",
    body: (otp: string) =>
      `Your sign-in code is: ${otp}\n\nIt is valid for 10 minutes and can be used once.`,
  },
  shell: {
    myWork: "Meine Arbeit",
    searchHint: "Suchen ( / )",
    themeToggle: "Dunkel/Hell",
    switchTenant: "Arbeitsbereich wechseln",
    logout: "Abmelden",
    logoutEverywhere: "Überall abmelden",
  },
  glance: {
    emptyBranch: "Noch nichts hier…",
    notStarted: "noch nicht gestartet",
    branches: "Bereiche",
  },
  errors: {
    notFound: "Nicht gefunden.",
  },
} as const;
