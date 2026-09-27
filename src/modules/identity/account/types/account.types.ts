export interface Account {
  id: string;
  email: string;
  createdAt: string;
}

export interface AccountCredentials {
  account: Account;
  passwordHash: string;
}
