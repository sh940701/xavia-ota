import type { NextApiRequest, NextApiResponse } from 'next';

// Lightweight liveness endpoint for the GCP Load Balancer health check.
// The MIG health check on the OTA container hits GET /api/health and
// must receive a 2xx without exercising any storage or DB dependency.
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.status(200).json({ status: 'ok' });
}
