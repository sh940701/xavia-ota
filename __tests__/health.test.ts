import { createMocks } from 'node-mocks-http';

import healthEndpoint from '../pages/api/health';

describe('Health API', () => {
  it('returns 200 with { status: "ok" }', async () => {
    const { req, res } = createMocks({ method: 'GET' });
    await healthEndpoint(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ status: 'ok' });
  });
});
