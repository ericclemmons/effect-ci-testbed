export class AuthenticationError extends Error {}
export interface ExchangeInput {
  broker: string;
  repository?: string;
  worker: string;
  scopes: string;
  requestUrl: string;
  requestToken: string;
}
export interface Credentials {
  token: string;
  receipt: string;
  accountId: string;
  expiresOn: string;
  broker: string;
}
export function brokerOrigin(value: string): string;
export function exchange(input: ExchangeInput, fetcher?: typeof fetch): Promise<Credentials>;
export function revoke(broker: string, receipt: string, fetcher?: typeof fetch): Promise<void>;
