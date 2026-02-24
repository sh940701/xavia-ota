import { createMocks } from 'node-mocks-http';

import { DatabaseFactory } from '../apiUtils/database/DatabaseFactory';
import { createSessionToken, SESSION_COOKIE_NAME } from '../apiUtils/helpers/AuthHelper';
import { StorageFactory } from '../apiUtils/storage/StorageFactory';
import releasesHandler from '../pages/api/releases';

jest.mock('../apiUtils/database/DatabaseFactory');
jest.mock('../apiUtils/storage/StorageFactory');

describe('Releases API', () => {
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

  it('should return 405 for non-GET requests', async () => {
    const { req, res } = createMocks({ method: 'POST' });
    await releasesHandler(req, res);
    expect(res._getStatusCode()).toBe(405);
    expect(JSON.parse(res._getData())).toMatchSnapshot();
  });

  it('should return 401 when no admin session cookie is provided', async () => {
    const { req, res } = createMocks({ method: 'GET' });
    await releasesHandler(req, res);

    expect(res._getStatusCode()).toBe(401);
    expect(JSON.parse(res._getData())).toEqual({ error: 'Unauthorized' });
  });

  it('should return releases successfully', async () => {
    const mockStorage = {
      listDirectories: jest.fn().mockResolvedValue(['1.0.0']),
      listFiles: jest.fn().mockResolvedValue([
        {
          name: 'update.zip',
          created_at: '2024-03-20T00:00:00Z',
          metadata: { size: 1000 },
        },
      ]),
    };

    const mockDatabase = {
      listReleases: jest.fn().mockResolvedValue([
        {
          id: 'test-uuid-1',
          path: 'updates/1.0.0/update.zip',
          commitHash: 'abc123',
          commitMessage: 'initial release',
        },
      ]),
      getTrackingCountsPerRelease: jest.fn().mockResolvedValue([
        { releaseId: 'test-uuid-1', platform: 'ios', count: 10 },
        { releaseId: 'test-uuid-1', platform: 'android', count: 5 },
      ]),
    };

    (StorageFactory.getStorage as jest.Mock).mockReturnValue(mockStorage);
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    const { req, res } = createMocks({
      method: 'GET',
      headers: { cookie: buildAuthCookie() },
    });
    await releasesHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.releases[0].id).toBe('test-uuid-1');
    expect(data.releases[0].downloads).toEqual({ ios: 10, android: 5, total: 15 });
    expect(data).toMatchSnapshot();
  });

  it('should return zero downloads when no tracking data exists', async () => {
    const mockStorage = {
      listDirectories: jest.fn().mockResolvedValue(['2.0.0']),
      listFiles: jest.fn().mockResolvedValue([
        {
          name: 'update.zip',
          created_at: '2024-04-01T00:00:00Z',
          metadata: { size: 2000 },
        },
      ]),
    };

    const mockDatabase = {
      listReleases: jest.fn().mockResolvedValue([
        {
          id: 'test-uuid-2',
          path: 'updates/2.0.0/update.zip',
          commitHash: 'def456',
          commitMessage: 'second release',
        },
      ]),
      getTrackingCountsPerRelease: jest.fn().mockResolvedValue([]),
    };

    (StorageFactory.getStorage as jest.Mock).mockReturnValue(mockStorage);
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    const { req, res } = createMocks({
      method: 'GET',
      headers: { cookie: buildAuthCookie() },
    });
    await releasesHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.releases[0].downloads).toEqual({ ios: 0, android: 0, total: 0 });
  });

  it('should handle errors gracefully', async () => {
    const mockStorage = {
      listDirectories: jest.fn().mockRejectedValue(new Error('Storage error')),
    };

    (StorageFactory.getStorage as jest.Mock).mockReturnValue(mockStorage);

    const { req, res } = createMocks({
      method: 'GET',
      headers: { cookie: buildAuthCookie() },
    });
    await releasesHandler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(JSON.parse(res._getData())).toMatchSnapshot();
  });
});
