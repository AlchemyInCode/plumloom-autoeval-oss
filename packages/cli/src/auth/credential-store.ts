export interface CredentialStore {
  read(): Promise<string | undefined>;
  write(apiKey: string): Promise<void>;
  delete(): Promise<boolean>;
}

export interface SecretPrompt {
  request(): Promise<string>;
}
