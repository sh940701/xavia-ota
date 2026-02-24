'use client';

import { useState } from 'react';
import { useRouter } from 'next/router';
import {
  Box,
  Button,
  FormControl,
  FormErrorMessage,
  Input,
  Text,
  VStack,
  Heading,
} from '@chakra-ui/react';
import Image from 'next/image';

export default function Home() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error);
      } else {
        router.push('/dashboard');
      }
    } catch (err) {
      setError('Failed to login');
      console.error(err);
    }
  };

  return (
    <Box
      minHeight="100vh"
      display="flex"
      alignItems="center"
      justifyContent="center"
      style={{ background: 'linear-gradient(135deg, #5655D7 0%, #3d3cb8 50%, #2d2c8a 100%)' }}
    >
      <Box
        bg="white"
        borderRadius="20px"
        p={10}
        w="full"
        maxW="400px"
        mx={4}
        boxShadow="0 25px 60px rgba(0,0,0,0.3)"
      >
        {/* Logo */}
        <Box display="flex" justifyContent="center" mb={8}>
          <Image
            src="/xavia_logo.png"
            width={160}
            height={56}
            style={{ objectFit: 'contain' }}
            alt="Xavia Logo"
          />
        </Box>

        <Heading size="md" color="gray.800" mb={1} textAlign="center">
          Admin Portal
        </Heading>
        <Text color="gray.500" fontSize="sm" textAlign="center" mb={8}>
          Enter your password to continue
        </Text>

        <form onSubmit={handleLogin}>
          <VStack spacing={4}>
            <FormControl isInvalid={!!error}>
              <Input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError('');
                }}
                placeholder="Password"
                size="lg"
                borderRadius="10px"
                borderColor="gray.200"
                _focus={{ borderColor: '#5655D7', boxShadow: '0 0 0 1px #5655D7' }}
                _hover={{ borderColor: 'gray.300' }}
              />
              {error && <FormErrorMessage>{error}</FormErrorMessage>}
            </FormControl>
            <Button
              type="submit"
              width="full"
              size="lg"
              borderRadius="10px"
              bg="#5655D7"
              color="white"
              fontWeight="600"
              _hover={{
                bg: '#4D4CC1',
                transform: 'translateY(-1px)',
                boxShadow: '0 4px 12px rgba(86,85,215,0.4)',
              }}
              _active={{ bg: '#4040A1', transform: 'translateY(0)' }}
              transition="all 0.15s ease"
            >
              Sign In
            </Button>
          </VStack>
        </form>
      </Box>
    </Box>
  );
}
