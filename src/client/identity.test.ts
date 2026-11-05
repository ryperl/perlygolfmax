import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InteractionRequiredAuthError, PublicClientApplication } from '@azure/msal-browser';
import type * as Msal from '@azure/msal-browser';
import { createEventSession } from './identity';
import { SessionExpiredError } from './events';
import { consumeInvitationReturn, rememberInvitationReturn } from './invitation-return';

const sdk = vi.hoisted(() => ({
  initialize: vi.fn(), handleRedirectPromise: vi.fn(), getActiveAccount: vi.fn(),
  getAllAccounts: vi.fn(), setActiveAccount: vi.fn(), loginRedirect: vi.fn(),
  logoutRedirect: vi.fn(), acquireTokenSilent: vi.fn(),
}));
vi.mock('@azure/msal-browser', async (original) => {
  const actual = await original<typeof Msal>();
  return { ...actual, PublicClientApplication: vi.fn(function () { return sdk; }) };
});
const config = {
  clientId: '00000000-0000-4000-8000-000000000001', authority: 'https://fictional.ciamlogin.com/',
  scope: 'api://00000000-0000-4000-8000-000000000002/Events.Access', apiUrl: 'https://fictional.example.test/api',
};
beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.resetAllMocks();
  sdk.initialize.mockResolvedValue(undefined);
  sdk.handleRedirectPromise.mockResolvedValue(null);
  sdk.getAllAccounts.mockReturnValue([]);
});
describe('customer identity session', () => {
  it('restores a validated private invitation only after the SDK sign-in return, then removes the continuation', async () => {
    const hash = `#join?event=${config.clientId}&invite=00000000-0000-4000-8000-000000000003&token=${'A'.repeat(43)}`;
    window.history.replaceState(null, '', hash);
    const session = createEventSession(config);
    await session.signIn();
    window.history.replaceState(null, '', '/?event-auth=1#code=fictional');
    sdk.handleRedirectPromise.mockResolvedValue({ account: { homeAccountId: 'fictional-account' } });
    expect(await session.initialize()).toBe(true);
    expect(window.location.hash).toBe(hash);
    expect(consumeInvitationReturn()).toBeNull();
    rememberInvitationReturn(hash);
    await session.signOut();
    expect(consumeInvitationReturn()).toBeNull();
  });
  it('processes the identity callback before declaring a session and requests only API-scoped tokens', async () => {
    const account = { homeAccountId: 'fictional-account' };
    sdk.handleRedirectPromise.mockResolvedValue({ account });
    sdk.getActiveAccount.mockReturnValue(account);
    sdk.acquireTokenSilent.mockResolvedValue({ accessToken: 'fictional-access-token' });
    const session = createEventSession(config);
    expect(await session.initialize()).toBe(true);
    expect(sdk.setActiveAccount).toHaveBeenCalledWith(account);
    expect(await session.token()).toBe('fictional-access-token');
    expect(sdk.acquireTokenSilent).toHaveBeenCalledWith({ account, scopes: [config.scope] });
    const constructorOptions = vi.mocked(PublicClientApplication).mock.calls[0]?.[0];
    expect(constructorOptions?.auth.redirectUri).toBe(`${window.location.origin}/?event-auth=1`);
    expect(constructorOptions?.cache?.cacheLocation).toBe('sessionStorage');
    expect(sdk.handleRedirectPromise).toHaveBeenCalledWith({ navigateToLoginRequestUrl: false });
  });
  it('handles signed-out and expired sessions explicitly and completes provider logout', async () => {
    const session = createEventSession(config);
    expect(await session.initialize()).toBe(false);
    await expect(session.token()).rejects.toBeInstanceOf(SessionExpiredError);
    sdk.getActiveAccount.mockReturnValue({ homeAccountId: 'fictional-account' });
    sdk.acquireTokenSilent.mockRejectedValue(new InteractionRequiredAuthError('interaction_required', 'fictional test'));
    await expect(session.token()).rejects.toBeInstanceOf(SessionExpiredError);
    await session.signIn();
    expect(sdk.loginRedirect).toHaveBeenCalledWith({ scopes: [config.scope] });
    await session.signOut();
    expect(sdk.logoutRedirect).toHaveBeenCalled();
  });
  it('does not silently choose between multiple cached identities', async () => {
    sdk.getAllAccounts.mockReturnValue([{ homeAccountId: 'fictional-one' }, { homeAccountId: 'fictional-two' }]);
    await expect(createEventSession(config).initialize()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(sdk.setActiveAccount).not.toHaveBeenCalled();
  });
});
