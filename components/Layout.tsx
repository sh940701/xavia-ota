import { Box, Flex, VStack, Text, FlexProps } from '@chakra-ui/react';
import { useRouter } from 'next/router';
import { FaSignOutAlt, FaTachometerAlt, FaTags } from 'react-icons/fa';
import Image from 'next/image';

export default function Layout({ children, ...props }: { children: React.ReactNode } & FlexProps) {
  const router = useRouter();

  const navItems = [
    { name: 'Dashboard', path: '/dashboard', icon: <FaTachometerAlt size="1rem" /> },
    { name: 'Releases', path: '/releases', icon: <FaTags size="1rem" /> },
  ];

  const handleLogout = () => {
    localStorage.removeItem('isAuthenticated');
    router.push('/');
  };

  return (
    <Flex height="100vh" overflow="hidden">
      {/* Sidebar */}
      <Box
        w="240px"
        flexShrink={0}
        display="flex"
        flexDirection="column"
        py={6}
        px={4}
        style={{
          background: 'linear-gradient(180deg, #5655D7 0%, #3d3cb8 100%)',
        }}>
        {/* Logo */}
        <Box mb={10} px={2} pt={2}>
          <Image
            src="/xavia_logo.png"
            width={140}
            height={48}
            style={{ objectFit: 'contain', filter: 'brightness(0) invert(1)' }}
            alt="Xavia Logo"
          />
        </Box>

        {/* Nav */}
        <VStack spacing={1} align="stretch" flex={1}>
          {navItems.map((item) => {
            const isActive = router.pathname === item.path;
            return (
              <Box
                key={item.path}
                display="flex"
                alignItems="center"
                gap={3}
                px={4}
                py="10px"
                borderRadius="10px"
                cursor="pointer"
                bg={isActive ? 'rgba(255,255,255,0.18)' : 'transparent'}
                color="white"
                fontWeight={isActive ? '600' : '400'}
                fontSize="sm"
                style={{ opacity: isActive ? 1 : 0.72 }}
                _hover={{ bg: 'rgba(255,255,255,0.14)', opacity: 1 }}
                transition="all 0.15s ease"
                onClick={() => router.push(item.path)}>
                {item.icon}
                <Text>{item.name}</Text>
              </Box>
            );
          })}
        </VStack>

        {/* Logout */}
        <Box
          display="flex"
          alignItems="center"
          gap={3}
          px={4}
          py="10px"
          borderRadius="10px"
          cursor="pointer"
          color="white"
          fontSize="sm"
          style={{ opacity: 0.65 }}
          _hover={{ bg: 'rgba(255,255,255,0.12)', opacity: 1 }}
          transition="all 0.15s ease"
          onClick={handleLogout}>
          <FaSignOutAlt size="1rem" />
          <Text>Logout</Text>
        </Box>
      </Box>

      {/* Content */}
      <Box flex={1} overflow="auto" p={8} bg="#F7F8FA" {...props}>
        {children}
      </Box>
    </Flex>
  );
}
