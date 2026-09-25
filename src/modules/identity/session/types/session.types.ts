export interface ActiveSession {
  sessionId: string;
  accountId: string;
}

export interface CreatedSession extends ActiveSession {
  token: string;
  expiresAt: string;
}
