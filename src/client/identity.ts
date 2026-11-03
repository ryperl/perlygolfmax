import { InteractionRequiredAuthError, PublicClientApplication } from '@azure/msal-browser';
import type { ClientSettings } from './config';
import { SessionExpiredError } from './events';

export interface EventSession {
  readonly initialize: () => Promise<boolean>;
  readonly signIn: () => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly token: () => Promise<string>;
}

export function createEventSession(settings: ClientSettings): EventSession {
  const client = new PublicClientApplication({
    auth: {
      clientId: settings.clientId, authority: settings.authority,
      redirectUri: `${window.location.origin}/?event-auth=1`,
      postLogoutRedirectUri: `${window.location.origin}/?event-auth=1`,
    },
    cache: { cacheLocation: 'sessionStorage' },
    system: { loggerOptions: { piiLoggingEnabled: false } },
  });
  return {
    async initialize() {
      await client.initialize();
      const result = await client.handleRedirectPromise({ navigateToLoginRequestUrl: false });
      const accounts = client.getAllAccounts();
      const account = result?.account ?? client.getActiveAccount() ?? (accounts.length === 1 ? accounts[0] : undefined);
      if (!account && accounts.length > 1) throw new SessionExpiredError('Choose an account by signing in again.');
      if (account) client.setActiveAccount(account);
      return Boolean(account);
    },
    async signIn() { await client.loginRedirect({ scopes: [settings.scope] }); },
    async signOut() { await client.logoutRedirect({ account: client.getActiveAccount() }); },
    async token() {
      const account = client.getActiveAccount();
      if (!account) throw new SessionExpiredError('Sign in to access your events.');
      try {
        return (await client.acquireTokenSilent({ account, scopes: [settings.scope] })).accessToken;
      } catch (error) {
        if (error instanceof InteractionRequiredAuthError) throw new SessionExpiredError('Your session expired. Sign in again.');
        throw error;
      }
    },
  };
}
