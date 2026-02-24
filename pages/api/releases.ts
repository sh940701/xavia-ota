import { NextApiRequest, NextApiResponse } from 'next';

import { DatabaseFactory } from '../../apiUtils/database/DatabaseFactory';
import { requireAdminApiAuth } from '../../apiUtils/helpers/AuthHelper';
import { StorageFactory } from '../../apiUtils/storage/StorageFactory';

export default async function releasesHandler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!requireAdminApiAuth(req, res)) {
    return;
  }

  try {
    const storage = StorageFactory.getStorage();
    const database = DatabaseFactory.getDatabase();
    const directories = await storage.listDirectories('updates/');

    const [releasesWithCommitHash, trackingCounts] = await Promise.all([
      database.listReleases(),
      database.getTrackingCountsPerRelease(),
    ]);

    const downloadMap = new Map<string, { ios: number; android: number; total: number }>();
    for (const tc of trackingCounts) {
      if (!downloadMap.has(tc.releaseId)) {
        downloadMap.set(tc.releaseId, { ios: 0, android: 0, total: 0 });
      }
      const entry = downloadMap.get(tc.releaseId)!;
      if (tc.platform === 'ios') entry.ios += tc.count;
      else if (tc.platform === 'android') entry.android += tc.count;
      entry.total += tc.count;
    }

    const releases = [];
    for (const directory of directories) {
      const folderPath = `updates/${directory}`;
      const files = await storage.listFiles(folderPath);
      const runtimeVersion = directory;

      for (const file of files) {
        const release = releasesWithCommitHash.find((r) => r.path === `${folderPath}/${file.name}`);
        const commitHash = release ? release.commitHash : null;
        const downloads = release?.id ? downloadMap.get(release.id) : undefined;

        releases.push({
          id: release?.id || null,
          path: release?.path || `${folderPath}/${file.name}`,
          runtimeVersion,
          timestamp: file.created_at,
          size: file.metadata.size,
          commitHash,
          commitMessage: release?.commitMessage,
          downloads: downloads || { ios: 0, android: 0, total: 0 },
        });
      }
    }

    res.status(200).json({ releases });
  } catch (error) {
    console.error('Failed to fetch releases:', error);
    res.status(500).json({ error: 'Failed to fetch releases' });
  }
}
