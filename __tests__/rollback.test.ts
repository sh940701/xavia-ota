import { createMocks } from 'node-mocks-http';

import { DatabaseFactory } from '../apiUtils/database/DatabaseFactory';
import { createSessionToken, SESSION_COOKIE_NAME } from '../apiUtils/helpers/AuthHelper';
import { StorageFactory } from '../apiUtils/storage/StorageFactory';
import rollbackHandler from '../pages/api/rollback';

jest.mock('../apiUtils/database/DatabaseFactory');
jest.mock('../apiUtils/storage/StorageFactory');

describe('Rollback API', () => {
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

  it('should return 405 for non-POST requests', async () => {
    const { req, res } = createMocks({ method: 'GET' });
    await rollbackHandler(req, res);
    expect(res._getStatusCode()).toBe(405);
    expect(JSON.parse(res._getData())).toMatchSnapshot();
  });

  it('should return 401 when no admin session cookie is provided', async () => {
    const { req, res } = createMocks({ method: 'POST', body: {} });
    await rollbackHandler(req, res);

    expect(res._getStatusCode()).toBe(401);
    expect(JSON.parse(res._getData())).toEqual({ error: 'Unauthorized' });
  });

  it('should return 400 for missing required fields', async () => {
    const { req, res } = createMocks({
      method: 'POST',
      headers: { cookie: buildAuthCookie() },
      body: {},
    });
    await rollbackHandler(req, res);
    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toMatchSnapshot();
  });

  it('should handle rollback successfully', async () => {
    const mockStorage = {
      copyFile: jest.fn().mockResolvedValue(true),
    };

    const mockDatabase = {
      createRelease: jest.fn().mockResolvedValue(true),
    };

    (StorageFactory.getStorage as jest.Mock).mockReturnValue(mockStorage);
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    Date.now = jest.fn(() => new Date('2020-05-13T12:33:37.000Z').getTime());

    const { req, res } = createMocks({
      method: 'POST',
      headers: { cookie: buildAuthCookie() },
      body: {
        path: 'updates/1.0.0/old.zip',
        runtimeVersion: '1.0.0',
        commitHash: 'abc123',
      },
    });

    await rollbackHandler(req, res);
    expect(res._getStatusCode()).toBe(200);
    expect(res._getData()).toMatchSnapshot();
    expect(mockStorage.copyFile).toHaveBeenCalled();
    expect(mockDatabase.createRelease).toHaveBeenCalled();
  });
});
