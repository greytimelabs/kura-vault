import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api/client';
import { VaultLockedError } from './crypto/cryptoClient';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: (failureCount, error) => {
        if (error instanceof VaultLockedError) return false;
        // The client already waits out rate limits; other 4xx will not change on retry
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});
