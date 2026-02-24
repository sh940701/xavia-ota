import type { GetServerSideProps } from 'next';
import { Box, SimpleGrid, Text, Flex } from '@chakra-ui/react';
import { FaCloudDownloadAlt, FaBoxOpen, FaApple, FaAndroid } from 'react-icons/fa';
import { useEffect, useState } from 'react';

import { TrackingMetrics } from '../apiUtils/database/DatabaseInterface';
import { requireAdminPageAuth } from '../apiUtils/helpers/AuthHelper';
import Layout from '../components/Layout';
import LoadingSpinner from '../components/LoadingSpinner';
import { AllTrackingResponse } from './api/tracking/all';

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  iconColor: string;
  iconBg: string;
}

function StatCard({ label, value, icon, iconColor, iconBg }: StatCardProps) {
  return (
    <Box
      bg="white"
      borderRadius="16px"
      p={6}
      boxShadow="0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)"
      transition="transform 0.15s ease, box-shadow 0.15s ease"
      _hover={{ transform: 'translateY(-2px)', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}
    >
      <Flex justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Text color="gray.500" fontSize="sm" fontWeight="500" mb={3}>
            {label}
          </Text>
          <Text fontSize="3xl" fontWeight="700" color="gray.800" lineHeight={1}>
            {value.toLocaleString()}
          </Text>
        </Box>
        <Box
          w="48px"
          h="48px"
          borderRadius="12px"
          bg={iconBg}
          display="flex"
          alignItems="center"
          justifyContent="center"
          color={iconColor}
          fontSize="20px"
          flexShrink={0}
        >
          {icon}
        </Box>
      </Flex>
    </Box>
  );
}

export default function Dashboard() {
  const [totalDownloaded, setTotalDownloaded] = useState(0);
  const [iosDownloads, setIosDownloads] = useState(0);
  const [androidDownloads, setAndroidDownloads] = useState(0);
  const [totalReleases, setTotalReleases] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = async () => {
    try {
      const response = await fetch('/api/tracking/all');
      const data = (await response.json()) as AllTrackingResponse;

      setTotalDownloaded(data.trackings.reduce((acc, curr) => acc + curr.count, 0));

      const iosData = data.trackings.filter((metric: TrackingMetrics) => metric.platform === 'ios');
      const androidData = data.trackings.filter(
        (metric: TrackingMetrics) => metric.platform === 'android'
      );

      setIosDownloads(iosData.reduce((acc, curr) => acc + curr.count, 0));
      setAndroidDownloads(androidData.reduce((acc, curr) => acc + curr.count, 0));
      setTotalReleases(data.totalReleases);
    } catch (error) {
      console.error('Failed to fetch tracking data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <Layout>
      <Box mb={8}>
        <Text fontSize="2xl" fontWeight="700" color="gray.800">
          Dashboard
        </Text>
        <Text color="gray.500" fontSize="sm" mt={1}>
          Overview of your OTA releases and downloads
        </Text>
      </Box>

      <SimpleGrid columns={2} spacing={5}>
        <StatCard
          label="Total Releases"
          value={totalReleases}
          icon={<FaBoxOpen />}
          iconColor="#5655D7"
          iconBg="#EEEEF9"
        />
        <StatCard
          label="Total Downloads"
          value={totalDownloaded}
          icon={<FaCloudDownloadAlt />}
          iconColor="#0EA5E9"
          iconBg="#E0F2FE"
        />
        <StatCard
          label="iOS Downloads"
          value={iosDownloads}
          icon={<FaApple />}
          iconColor="#374151"
          iconBg="#F3F4F6"
        />
        <StatCard
          label="Android Downloads"
          value={androidDownloads}
          icon={<FaAndroid />}
          iconColor="#16A34A"
          iconBg="#DCFCE7"
        />
      </SimpleGrid>
    </Layout>
  );
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const redirectResult = requireAdminPageAuth(context);
  if (redirectResult) {
    return redirectResult;
  }

  return {
    props: {},
  };
};
