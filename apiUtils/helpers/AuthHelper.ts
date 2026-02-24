import { createHmac, timingSafeEqual } from 'crypto';
import type {
  GetServerSidePropsContext,
  GetServerSidePropsResult,
  NextApiRequest,
  NextApiResponse,
} from 'next';

export const SESSION_COOKIE_NAME = 'xavia_admin_session';

const DEFAULT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

function getSessionSecret(): string | null {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || null;
}

function getSessionMaxAgeSeconds(): number {
  const rawValue = Number(process.env.ADMIN_SESSION_MAX_AGE_SECONDS);
  if (Number.isFinite(rawValue) && rawValue > 0) {
    return Math.floor(rawValue);
  }

  return DEFAULT_SESSION_MAX_AGE_SECONDS;
}

function createSignature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function createSessionToken(
  issuedAtSeconds: number = Math.floor(Date.now() / 1000)
): string {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error('Session secret is not configured');
  }

  const payload = `${issuedAtSeconds}`;
  const signature = createSignature(payload, secret);
  return Buffer.from(`${payload}.${signature}`).toString('base64url');
}

function parseSessionToken(token: string): { issuedAtSeconds: number; signature: string } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const [issuedAtRaw, signature] = decoded.split('.');

    if (!issuedAtRaw || !signature) {
      return null;
    }

    const issuedAtSeconds = Number(issuedAtRaw);
    if (!Number.isInteger(issuedAtSeconds) || issuedAtSeconds <= 0) {
      return null;
    }

    return { issuedAtSeconds, signature };
  } catch {
    return null;
  }
}

export function parseCookieHeader(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader
    .split(';')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex === -1) {
        return acc;
      }

      const key = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();

      if (!key) {
        return acc;
      }

      try {
        acc[key] = decodeURIComponent(value);
      } catch {
        acc[key] = value;
      }

      return acc;
    }, {});
}

export function getSessionTokenFromCookieHeader(cookieHeader?: string): string | null {
  const cookies = parseCookieHeader(cookieHeader);
  return cookies[SESSION_COOKIE_NAME] || null;
}

export function isSessionTokenValid(
  token: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): boolean {
  const secret = getSessionSecret();
  if (!secret) {
    return false;
  }

  const parsedToken = parseSessionToken(token);
  if (!parsedToken) {
    return false;
  }

  const payload = `${parsedToken.issuedAtSeconds}`;
  const expectedSignature = createSignature(payload, secret);
  const actualSignatureBuffer = Buffer.from(parsedToken.signature, 'utf8');
  const expectedSignatureBuffer = Buffer.from(expectedSignature, 'utf8');

  if (actualSignatureBuffer.length !== expectedSignatureBuffer.length) {
    return false;
  }

  if (!timingSafeEqual(actualSignatureBuffer, expectedSignatureBuffer)) {
    return false;
  }

  const maxAgeSeconds = getSessionMaxAgeSeconds();
  if (parsedToken.issuedAtSeconds + maxAgeSeconds < nowSeconds) {
    return false;
  }

  return true;
}

function buildSessionCookie(token: string): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${getSessionMaxAgeSeconds()}`,
  ];

  if (process.env.NODE_ENV === 'production') {
    attributes.push('Secure');
  }

  return attributes.join('; ');
}

function buildClearSessionCookie(): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
  ];

  if (process.env.NODE_ENV === 'production') {
    attributes.push('Secure');
  }

  return attributes.join('; ');
}

export function setSessionCookie(res: NextApiResponse): void {
  const token = createSessionToken();
  res.setHeader('Set-Cookie', buildSessionCookie(token));
}

export function clearSessionCookie(res: NextApiResponse): void {
  res.setHeader('Set-Cookie', buildClearSessionCookie());
}

export function isAdminApiRequestAuthenticated(req: NextApiRequest): boolean {
  const token = getSessionTokenFromCookieHeader(req.headers.cookie);
  if (!token) {
    return false;
  }

  return isSessionTokenValid(token);
}

export function requireAdminApiAuth(req: NextApiRequest, res: NextApiResponse): boolean {
  if (isAdminApiRequestAuthenticated(req)) {
    return true;
  }

  res.status(401).json({ error: 'Unauthorized' });
  return false;
}

export function requireAdminPageAuth(
  context: GetServerSidePropsContext
): GetServerSidePropsResult<Record<string, never>> | null {
  const token = getSessionTokenFromCookieHeader(context.req.headers.cookie);
  if (token && isSessionTokenValid(token)) {
    return null;
  }

  return {
    redirect: {
      destination: '/',
      permanent: false,
    },
  };
}
