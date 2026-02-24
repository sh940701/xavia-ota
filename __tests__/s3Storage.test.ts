import { S3Client } from '@aws-sdk/client-s3';
import { S3Storage } from '../apiUtils/storage/S3Storage';

jest.mock('@aws-sdk/client-s3', () => {
  const S3ClientMock = jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  }));

  return {
    S3Client: S3ClientMock,
    GetObjectCommand: jest.fn(),
    HeadObjectCommand: jest.fn(),
    ListObjectsV2Command: jest.fn(),
    PutObjectCommand: jest.fn(),
    CopyObjectCommand: jest.fn(),
  };
});

const S3ClientMock = S3Client as unknown as jest.Mock;
const ORIGINAL_ENV = process.env;

describe('S3Storage constructor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      S3_REGION: 'ap-northeast-2',
      S3_BUCKET_NAME: 'test-bucket',
    };

    delete process.env.S3_ENDPOINT;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    delete process.env.S3_SESSION_TOKEN;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('throws when S3 bucket name is missing', () => {
    delete process.env.S3_BUCKET_NAME;

    expect(() => new S3Storage()).toThrow('S3 bucket name not configured');
  });

  it('throws when only one static credential value is provided', () => {
    process.env.S3_ACCESS_KEY_ID = 'access-key';

    expect(() => new S3Storage()).toThrow(
      'Incomplete S3 static credentials. Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither.'
    );
  });

  it('uses static credentials when access key and secret key are provided', () => {
    process.env.S3_ACCESS_KEY_ID = 'access-key';
    process.env.S3_SECRET_ACCESS_KEY = 'secret-key';
    process.env.S3_SESSION_TOKEN = 'session-token';

    new S3Storage();

    expect(S3ClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'ap-northeast-2',
        endpoint: undefined,
        credentials: {
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
          sessionToken: 'session-token',
        },
      })
    );
  });

  it('uses default AWS credential chain when static credentials are omitted', () => {
    new S3Storage();

    const clientConfig = S3ClientMock.mock.calls[0][0];
    expect(clientConfig).toEqual(
      expect.objectContaining({
        region: 'ap-northeast-2',
        endpoint: undefined,
      })
    );
    expect(clientConfig.credentials).toBeUndefined();
  });
});
