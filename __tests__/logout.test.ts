import { createMocks } from 'node-mocks-http';

import { SESSION_COOKIE_NAME } from '../apiUtils/helpers/AuthHelper';
import logoutEndpoint from '../pages/api/logout';

describe('Logout API', () => {
  it('should return 405 for non-POST requests', async () => {
    const { req, res } = createMocks({ method: 'GET' });
    await logoutEndpoint(req, res);

    expect(res._getStatusCode()).toBe(405);
    expect(JSON.parse(res._getData())).toEqual({ error: 'Method not allowed' });
  });

  it('should clear admin session cookie on logout', async () => {
    const { req, res } = createMocks({ method: 'POST' });
    await logoutEndpoint(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ success: true });

    const setCookie = res.getHeader('Set-Cookie') as string;
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain('Max-Age=0');
    expect(setCookie).toContain('HttpOnly');
  });
});
