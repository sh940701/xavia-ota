import { createMocks } from 'node-mocks-http';

import { DatabaseFactory } from '../apiUtils/database/DatabaseFactory';
import { createSessionToken, SESSION_COOKIE_NAME } from '../apiUtils/helpers/AuthHelper';
import allTrackingHandler from '../pages/api/tracking/all';
import trackingByReleaseHandler from '../pages/api/tracking/[release_id]';

jest.mock('../apiUtils/database/DatabaseFactory');

describe('Tracking API', () => {
  const originalEnv = process.env;

  const buildAuthCookie = (): string =>
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSessionToken())}`;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      ADMIN_PASSWORD: 'admin-password',
      ADMIN_SESSION_SECRET: 'session-secret',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('allTrackingHandler should return 405 for non-GET requests', async () => {
    const { req, res } = createMocks({ method: 'POST' });
    await allTrackingHandler(req, res);

    expect(res._getStatusCode()).toBe(405);
    expect(JSON.parse(res._getData())).toEqual({ error: 'Method not allowed' });
  });

  it('allTrackingHandler should return 401 when no admin session cookie is provided', async () => {
    const { req, res } = createMocks({ method: 'GET' });
    await allTrackingHandler(req, res);

    expect(res._getStatusCode()).toBe(401);
    expect(JSON.parse(res._getData())).toEqual({ error: 'Unauthorized' });
  });

  it('allTrackingHandler should return tracking metrics successfully', async () => {
    const mockDatabase = {
      getReleaseTrackingMetricsForAllReleases: jest
        .fn()
        .mockResolvedValue([{ release_id: 'release-1', platform: 'ios', count: 10 }]),
      listReleases: jest.fn().mockResolvedValue([{ id: 'release-1' }, { id: 'release-2' }]),
    };

    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    const { req, res } = createMocks({
      method: 'GET',
      headers: { cookie: buildAuthCookie() },
    });
    await allTrackingHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({
      trackings: [{ release_id: 'release-1', platform: 'ios', count: 10 }],
      totalReleases: 2,
    });
  });

  it('trackingByReleaseHandler should return 401 when no admin session cookie is provided', async () => {
    const { req, res } = createMocks({ method: 'GET', query: { release_id: 'release-1' } });
    await trackingByReleaseHandler(req, res);

    expect(res._getStatusCode()).toBe(401);
    expect(JSON.parse(res._getData())).toEqual({ error: 'Unauthorized' });
  });

  it('trackingByReleaseHandler should return 400 for missing release_id', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      headers: { cookie: buildAuthCookie() },
      query: {},
    });
    await trackingByReleaseHandler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: 'Release ID is required' });
  });

  it('trackingByReleaseHandler should return release-specific tracking metrics successfully', async () => {
    const mockDatabase = {
      getReleaseTrackingMetrics: jest
        .fn()
        .mockResolvedValue([{ release_id: 'release-1', platform: 'android', count: 3 }]),
    };

    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    const { req, res } = createMocks({
      method: 'GET',
      headers: { cookie: buildAuthCookie() },
      query: { release_id: 'release-1' },
    });
    await trackingByReleaseHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual([
      { release_id: 'release-1', platform: 'android', count: 3 },
    ]);
    expect(mockDatabase.getReleaseTrackingMetrics).toHaveBeenCalledWith('release-1');
  });
});
