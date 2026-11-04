export type ByokSelection = { credential_id: string; provider: string; model: string };
export type ProviderState = {
  plan?: string;
  review_provider: string;
  eligible: boolean;
  connection: { id: string; provider: string; model: string; key_suffix: string; updated_at: Date } | null;
};
export interface ProviderSettingsService {
  ready(): boolean;
  state(organization: string): Promise<ProviderState>;
  save(organization: string, user: string, provider: unknown, model: unknown, key: unknown): Promise<void>;
  remove(organization: string, user: string): Promise<void>;
  setMode(organization: string, user: string, mode: unknown): Promise<void>;
}
