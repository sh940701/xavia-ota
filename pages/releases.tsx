import {
  Box,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Text,
  Button,
  Badge,
  HStack,
  IconButton,
  AlertDialogHeader,
  AlertDialogContent,
  AlertDialogOverlay,
  AlertDialog,
  AlertDialogBody,
  AlertDialogFooter,
  Flex,
  Tooltip,
} from '@chakra-ui/react';
import moment from 'moment';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FaApple, FaAndroid, FaCloudDownloadAlt } from 'react-icons/fa';
import { SlRefresh } from 'react-icons/sl';

import Layout from '../components/Layout';
import ProtectedRoute from '../components/ProtectedRoute';
import { showToast } from '../components/toast';

interface Downloads {
  ios: number;
  android: number;
  total: number;
}

interface Release {
  id: string | null;
  path: string;
  runtimeVersion: string;
  timestamp: string;
  size: number;
  commitHash: string | null;
  commitMessage: string | null;
  downloads: Downloads;
}

interface VersionGroup {
  runtimeVersion: string;
  releases: Release[];
  totalDownloads: Downloads;
}

export default function ReleasesPage() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedRelease, setSelectedRelease] = useState<Release | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    fetchReleases();
  }, []);

  const fetchReleases = async () => {
    try {
      const response = await fetch('/api/releases');
      if (!response.ok) {
        throw new Error('Failed to fetch releases');
      }
      const data = await response.json();
      setReleases(data.releases);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch releases');
    } finally {
      setLoading(false);
    }
  };

  const sortedReleases = useMemo(
    () =>
      [...releases].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      ),
    [releases]
  );

  const groupedByVersion: VersionGroup[] = useMemo(() => {
    const groupMap = new Map<string, Release[]>();
    for (const release of sortedReleases) {
      if (!groupMap.has(release.runtimeVersion)) {
        groupMap.set(release.runtimeVersion, []);
      }
      groupMap.get(release.runtimeVersion)!.push(release);
    }

    return Array.from(groupMap.entries()).map(([version, versionReleases]) => ({
      runtimeVersion: version,
      releases: versionReleases,
      totalDownloads: versionReleases.reduce(
        (acc, r) => ({
          ios: acc.ios + r.downloads.ios,
          android: acc.android + r.downloads.android,
          total: acc.total + r.downloads.total,
        }),
        { ios: 0, android: 0, total: 0 }
      ),
    }));
  }, [sortedReleases]);

  const newestReleaseId = sortedReleases.length > 0 ? sortedReleases[0].id : null;

  const thStyle = {
    color: 'gray.500',
    fontSize: 'xs',
    fontWeight: '600',
    textTransform: 'uppercase' as const,
    letterSpacing: 'wider',
    py: 4,
  };

  return (
    <ProtectedRoute>
      <Layout>
        <Flex justifyContent="space-between" alignItems="center" mb={8}>
          <Box>
            <Text fontSize="2xl" fontWeight="700" color="gray.800">
              Releases
            </Text>
            <Text color="gray.500" fontSize="sm" mt={1}>
              Manage your OTA update releases
            </Text>
          </Box>
          <IconButton
            aria-label="Refresh"
            onClick={fetchReleases}
            icon={<SlRefresh />}
            borderRadius="10px"
            colorScheme="primary"
            variant="outline"
          />
        </Flex>

        {loading && (
          <Text color="gray.500" fontSize="sm">
            Loading releases...
          </Text>
        )}
        {error && (
          <Box bg="red.50" border="1px" borderColor="red.200" borderRadius="12px" p={4}>
            <Text color="red.600" fontSize="sm">
              {error}
            </Text>
          </Box>
        )}

        {!loading && !error && groupedByVersion.length === 0 && (
          <Box bg="gray.50" borderRadius="16px" p={8} textAlign="center">
            <Text color="gray.500" fontSize="sm">
              No releases found.
            </Text>
          </Box>
        )}

        {!loading &&
          !error &&
          groupedByVersion.map((group) => (
            <Box key={group.runtimeVersion} mb={6}>
              <Flex
                bg="white"
                borderRadius="16px 16px 0 0"
                px={6}
                py={4}
                alignItems="center"
                justifyContent="space-between"
                borderBottom="1px"
                borderColor="gray.100"
                boxShadow="0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)">
                <HStack spacing={3}>
                  <Badge
                    colorScheme="purple"
                    variant="subtle"
                    borderRadius="6px"
                    px={2}
                    py="2px"
                    fontSize="sm">
                    v{group.runtimeVersion}
                  </Badge>
                  <Text fontSize="sm" color="gray.500">
                    {group.releases.length} release{group.releases.length !== 1 ? 's' : ''}
                  </Text>
                </HStack>
                <HStack spacing={4}>
                  <HStack spacing={1}>
                    <FaApple size="0.75rem" color="#374151" />
                    <Text fontSize="sm" color="gray.600" fontWeight="500">
                      {group.totalDownloads.ios.toLocaleString()}
                    </Text>
                  </HStack>
                  <HStack spacing={1}>
                    <FaAndroid size="0.75rem" color="#16A34A" />
                    <Text fontSize="sm" color="gray.600" fontWeight="500">
                      {group.totalDownloads.android.toLocaleString()}
                    </Text>
                  </HStack>
                  <HStack spacing={1}>
                    <FaCloudDownloadAlt size="0.75rem" color="#5655D7" />
                    <Text fontSize="sm" color="gray.700" fontWeight="600">
                      {group.totalDownloads.total.toLocaleString()}
                    </Text>
                  </HStack>
                </HStack>
              </Flex>

              <Box
                bg="white"
                borderRadius="0 0 16px 16px"
                boxShadow="0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)"
                overflow="hidden">
                <Table variant="simple">
                  <Thead>
                    <Tr bg="gray.50">
                      <Th {...thStyle}>Name</Th>
                      <Th {...thStyle}>Commit Hash</Th>
                      <Th {...thStyle}>Commit Message</Th>
                      <Th {...thStyle}>Timestamp (UTC)</Th>
                      <Th {...thStyle}>Downloads</Th>
                      <Th {...thStyle}>File Size</Th>
                      <Th {...thStyle}>Actions</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {group.releases.map((release, index) => (
                      <Tr
                        key={release.id || index}
                        _hover={{ bg: 'gray.50' }}
                        transition="background 0.1s"
                        borderBottom="1px"
                        borderColor="gray.100">
                        <Td py={4}>
                          <Text fontSize="sm" color="gray.700" fontWeight="500">
                            {release.path}
                          </Text>
                        </Td>
                        <Td py={4}>
                          <Tooltip label={release.commitHash} placement="top">
                            <Text
                              isTruncated
                              w="10rem"
                              fontSize="xs"
                              color="gray.500"
                              fontFamily="mono">
                              {release.commitHash}
                            </Text>
                          </Tooltip>
                        </Td>
                        <Td py={4}>
                          <Tooltip label={release.commitMessage} placement="top">
                            <Text isTruncated w="10rem" fontSize="sm" color="gray.600">
                              {release.commitMessage}
                            </Text>
                          </Tooltip>
                        </Td>
                        <Td py={4}>
                          <Text fontSize="sm" color="gray.600" whiteSpace="nowrap">
                            {moment(release.timestamp).utc().format('MMM Do, HH:mm')}
                          </Text>
                        </Td>
                        <Td py={4}>
                          <Tooltip
                            label={`iOS: ${release.downloads.ios} | Android: ${release.downloads.android}`}
                            placement="top">
                            <HStack spacing={1}>
                              <FaCloudDownloadAlt size="0.75rem" color="#9CA3AF" />
                              <Text fontSize="sm" color="gray.700" fontWeight="500">
                                {release.downloads.total.toLocaleString()}
                              </Text>
                            </HStack>
                          </Tooltip>
                        </Td>
                        <Td py={4}>
                          <Text fontSize="sm" color="gray.600">
                            {formatFileSize(release.size)}
                          </Text>
                        </Td>
                        <Td py={4}>
                          {release.id === newestReleaseId && newestReleaseId !== null ? (
                            <Badge
                              colorScheme="green"
                              variant="subtle"
                              borderRadius="20px"
                              px={3}
                              py={1}
                              fontSize="xs"
                              fontWeight="600">
                              Active
                            </Badge>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              colorScheme="orange"
                              borderRadius="8px"
                              fontSize="xs"
                              fontWeight="600"
                              onClick={() => {
                                setIsOpen(true);
                                setSelectedRelease(release);
                              }}>
                              Rollback
                            </Button>
                          )}
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </Box>
            </Box>
          ))}

        <AlertDialog
          isOpen={isOpen}
          leastDestructiveRef={cancelRef}
          onClose={() => setIsOpen(false)}
          isCentered>
          <AlertDialogOverlay backdropFilter="blur(4px)">
            <AlertDialogContent borderRadius="16px" boxShadow="0 25px 50px rgba(0,0,0,0.2)">
              <AlertDialogHeader fontSize="lg" fontWeight="700" color="gray.800" pb={2}>
                Rollback Release
              </AlertDialogHeader>

              <AlertDialogBody>
                <Text color="gray.600" fontSize="sm" mb={4}>
                  Are you sure you want to rollback to this release?
                </Text>
                <Box bg="gray.50" borderRadius="10px" p={3} mb={3}>
                  <Text fontSize="xs" color="gray.500" fontWeight="500" mb={1}>
                    Commit Hash
                  </Text>
                  <Text fontSize="sm" fontFamily="mono" color="gray.700">
                    {selectedRelease?.commitHash}
                  </Text>
                </Box>
                <Box
                  bg="orange.50"
                  border="1px"
                  borderColor="orange.200"
                  borderRadius="10px"
                  p={3}>
                  <Text fontSize="sm" color="orange.700">
                    This will promote this release to be the active release with a new timestamp.
                  </Text>
                </Box>
              </AlertDialogBody>

              <AlertDialogFooter gap={2}>
                <Button
                  ref={cancelRef}
                  onClick={() => setIsOpen(false)}
                  variant="ghost"
                  borderRadius="8px">
                  Cancel
                </Button>
                <Button
                  colorScheme="red"
                  borderRadius="8px"
                  onClick={async () => {
                    const response = await fetch('/api/rollback', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({
                        path: selectedRelease?.path,
                        runtimeVersion: selectedRelease?.runtimeVersion,
                        commitHash: selectedRelease?.commitHash,
                        commitMessage: selectedRelease?.commitMessage,
                      }),
                    });

                    if (!response.ok) {
                      throw new Error('Rollback failed');
                    }

                    showToast('Rollback successful', 'success');
                    fetchReleases();
                    setIsOpen(false);
                  }}>
                  Rollback
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialogOverlay>
        </AlertDialog>
      </Layout>
    </ProtectedRoute>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
