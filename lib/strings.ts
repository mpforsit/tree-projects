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
    depthHint: (branches: number, tasks: number) => {
      const parts: string[] = [];
      if (branches > 0) parts.push(`${branches} ${branches === 1 ? "Teilbereich" : "Teilbereiche"}`);
      parts.push(tasks === 0 ? "Noch keine Aufgaben" : `${tasks} ${tasks === 1 ? "Aufgabe" : "Aufgaben"}`);
      return parts.join(" · ");
    },
    legend: "Fortschritt · Blockiert · Alarm",
    sizeToggle: "Kartengröße umschalten",
  },
  status: {
    open: "offen",
    in_progress: "in Arbeit",
    blocked: "blockiert",
    done: "erledigt",
  } as Record<string, string>,
  alarm: {
    stagnant: "stagniert",
    due_soon: "bald fällig",
    overdue: "überfällig",
  } as Record<string, string>,
  branch: {
    subBranches: "Teilbereiche",
    tasks: "Aufgaben",
    filterAll: "Alle",
    filterBlocked: "Blockiert",
    filterAlarms: "Alarme",
    filteredEmpty: "Keine Aufgaben für diesen Filter.",
    empty: "Noch nichts hier…",
    firstTask: "+ Erste Aufgabe anlegen",
    newTask: "+ Aufgabe",
    newBranch: "+ Teilbereich",
    newTaskTitle: "Titel der neuen Aufgabe",
    newBranchTitle: "Name des neuen Teilbereichs",
    create: "Anlegen",
    skeletonTooltip: "Nur Pfad sichtbar — kein Mitglied dieses Bereichs",
    neverProgressed: "noch nie ⟳",
    lastProgress: (ago: string) => `⟳ ${ago}`,
  },
  task: {
    description: "Beschreibung",
    noDescription: "Noch keine Beschreibung…",
    infoStream: "Informationsstrom",
    infoEmpty: "Noch keine Informationen. Beiträge aus Teams und manuelle Notizen erscheinen hier.",
    sourceManual: "Manuell",
    sourceTeams: "Teams",
    sourceAi: "KI-Zusammenfassung",
    openThread: "Thread öffnen ↗",
    discussion: "Diskussion",
    commentPlaceholder: "Kommentar schreiben…",
    send: "Senden",
    activity: "Aktivität",
    responsible: "Verantwortlich",
    due: "Fällig",
    noDate: "kein Datum",
    statusLabel: "Status",
    percentLabel: "Fortschritt",
    blockedNote: "Blockiert unterdrückt den Stagnations-Alarm — das Problem ist sichtbar markiert.",
    doneLocked: "Erledigt — bei 100 % gesperrt. Zum Ändern Status zurücksetzen.",
    percentZeroConfirm: "Aktives Segment abwählen und Fortschritt auf 0 % setzen?",
    readOnlyTooltip: "Nur die verantwortliche Person kann dies ändern",
    time: "Zeit",
    timeTotal: "Gesamt",
    record: "Erfassen",
    recordedToday: "Heute erfasst:",
    ownEntries: "Deine Einträge",
    timePlaceholder: "z. B. 45m oder 1,5h",
    presets: ["15 m", "30 m", "1 h", "2 h", "4 h", "8 h"],
  },
  activity: {
    created: "Aufgabe erstellt",
    statusChanged: (from: string, to: string) => `Status geändert: ${from} → ${to}`,
    percentChanged: (from: number, to: number) => `Fortschritt geändert: ${from} % → ${to} %`,
    responsibleChanged: (from: string, to: string) => `Verantwortung übergeben: ${from} → ${to}`,
    timeLogged: (duration: string) => `Zeit erfasst: ${duration}`,
    timeCorrected: "Zeiteintrag korrigiert",
    updated: "Aufgabe bearbeitet",
    infoAdded: "Information hinzugefügt",
    infoHidden: "Information ausgeblendet",
    commentAdded: "Kommentar hinzugefügt",
    alarmRaised: (kind: string) => `Alarm ausgelöst: ${kind}`,
    alarmCleared: (kind: string) => `Alarm aufgehoben: ${kind}`,
    archived: "Archiviert",
    unarchived: "Archivierung aufgehoben",
    moved: "Verschoben",
    fallback: "Änderung",
  },
  errors: {
    notFound: "Nicht gefunden.",
  },
} as const;
