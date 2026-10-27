import { DoasSignInRequiredError, doasAuthHeaders, doasConnectionStatus, doasFetch } from '../services/doasAuth';

describe('DOAS sign-in support', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('sends a pasted Cookie header as Cookie, and a bare token as a bearer token', () => {
    expect(doasAuthHeaders('sid=abc123; theme=dark')).toEqual({ Cookie: 'sid=abc123; theme=dark' });
    expect(doasAuthHeaders('s3cr3tTOKEN')).toEqual({ Authorization: 'Bearer s3cr3tTOKEN' });
    expect(doasAuthHeaders(null)).toEqual({});
  });

  it('turns DOAS\'s 401 "Please sign in" into a clear, actionable error', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('{"code":"signin_required"}', { status: 401 })) as never;
    await expect(doasFetch('/api/batches', 1000)).rejects.toBeInstanceOf(DoasSignInRequiredError);
    await expect(doasFetch('/api/batches', 1000)).rejects.toThrow(/DOAS connection/);
  });

  it('reports the connection state for the dashboard', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('[]', { status: 200 })) as never;
    expect((await doasConnectionStatus()).state).toBe('connected');

    global.fetch = jest.fn().mockResolvedValue(new Response('{}', { status: 401 })) as never;
    expect((await doasConnectionStatus()).state).toBe('signin_required');

    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as never;
    const s = await doasConnectionStatus();
    expect(s.state).toBe('unreachable');
    expect(s.detail).toContain('ECONNREFUSED');
  });
});
