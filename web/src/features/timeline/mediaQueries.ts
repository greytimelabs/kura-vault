import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { albumApi, DELETE_BATCH, mediaApi, PAGE_SIZE } from '@/lib/api/endpoints';
import type { MediaItem, MediaPage } from '@/lib/api/types';
import { prefetchThumbs } from '@/lib/media/thumbLoader';
import { removeThumbCiphertext } from '@/lib/media/thumbStore';
import { toast } from '@/state/toastStore';

type MediaData = InfiniteData<MediaPage, number>;

const ALL = 'all';
export const mediaKey = (vaultId: string, albumId: string | null) => ['media', vaultId, albumId ?? ALL] as const;

/** A vault's media (or one album's), newest first, loaded a page at a time. */
export function useMediaList(vaultId: string, albumId: string | null = null) {
  const queryClient = useQueryClient();
  const queryKey = mediaKey(vaultId, albumId);

  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam, signal }) => mediaApi.list(vaultId, pageParam, albumId, PAGE_SIZE, signal),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    staleTime: 5 * 60_000,
  });

  const pages = query.data?.pages;

  // An upload landing between two page requests shifts everything by one, so the
  // same item can appear on consecutive pages. Keep the first sighting.
  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: MediaItem[] = [];
    for (const page of pages ?? []) {
      for (const item of page.data) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          out.push(item);
        }
      }
    }
    return out;
  }, [pages]);

  // Thumbnail links die 60 seconds after a page arrives; grab the encrypted bytes now
  const prefetched = useRef(new WeakSet<MediaPage>());
  useEffect(() => {
    for (const page of pages ?? []) {
      if (!prefetched.current.has(page)) {
        prefetched.current.add(page);
        prefetchThumbs(page.data);
      }
    }
  }, [pages]);

  // Re-request just the page holding an item whose link expired. Tiles on the same
  // page share one request.
  const renewing = useRef(new Map<number, Promise<void>>());
  const renewLinks = useCallback(
    (itemId: string): Promise<void> => {
      const data = queryClient.getQueryData<MediaData>(queryKey);
      const index = data?.pages.findIndex((page) => page.data.some((item) => item.id === itemId)) ?? -1;
      if (!data || index === -1) return Promise.resolve();

      const pageNumber = data.pageParams[index]!;
      let pending = renewing.current.get(pageNumber);
      if (!pending) {
        pending = mediaApi
          .list(vaultId, pageNumber, albumId)
          .then((fresh) => {
            queryClient.setQueryData<MediaData>(queryKey, (current) =>
              current && {
                ...current,
                pages: current.pages.map((page, i) => (current.pageParams[i] === pageNumber ? fresh : page)),
              },
            );
          })
          .finally(() => renewing.current.delete(pageNumber));
        renewing.current.set(pageNumber, pending);
      }
      return pending;
    },
    // queryKey is omitted: it is rebuilt every render from vaultId and albumId
    [queryClient, vaultId, albumId],
  );

  return {
    items,
    total: pages?.[0]?.total ?? 0,
    isLoading: query.isPending,
    error: query.error,
    refetch: query.refetch,
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: useCallback(() => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    }, [query]),
    renewLinks,
  };
}

function mapItems(data: MediaData | undefined, fn: (items: MediaItem[]) => MediaItem[]): MediaData | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((page) => ({ ...page, data: fn(page.data) })) };
}

/** Like or unlike. The heart flips at once and flips back if the server refuses. */
export function useToggleLike(vaultId: string) {
  const queryClient = useQueryClient();

  return useCallback(
    async (item: MediaItem) => {
      const liked = !item.isLiked;
      const apply = (value: boolean) =>
        queryClient.setQueriesData<MediaData>({ queryKey: ['media', vaultId] }, (data) =>
          mapItems(data, (items) =>
            items.some((m) => m.id === item.id)
              ? items.map((m) => (m.id === item.id ? { ...m, isLiked: value } : m))
              : items,
          ),
        );

      apply(liked);
      try {
        await (liked ? albumApi.like(item.id, vaultId) : albumApi.unlike(item.id, vaultId));
        // Album counts changed, and album lists (Liked among them) are out of date.
        // Mark them stale without refetching what is on screen.
        void queryClient.invalidateQueries({ queryKey: ['albums', vaultId] });
        void queryClient.invalidateQueries({ queryKey: ['albumCover', vaultId], refetchType: 'none' });
        void queryClient.invalidateQueries({
          predicate: (q) => q.queryKey[0] === 'media' && q.queryKey[1] === vaultId && q.queryKey[2] !== ALL,
          refetchType: 'none',
        });
      } catch {
        apply(!liked);
        toast(liked ? 'Could not like this photo' : 'Could not unlike this photo', 'error');
      }
    },
    [queryClient, vaultId],
  );
}

/**
 * Erase items for good, on the server and in every list on screen. Throws if the
 * server refuses; whatever was deleted before that is gone from the lists anyway.
 */
export function useDeleteMedia(vaultId: string) {
  const queryClient = useQueryClient();

  return useCallback(
    async (ids: string[]) => {
      const deleted: string[] = [];
      try {
        for (let start = 0; start < ids.length; start += DELETE_BATCH) {
          const batch = ids.slice(start, start + DELETE_BATCH);
          await mediaApi.remove(batch);
          deleted.push(...batch);
        }
      } finally {
        if (deleted.length > 0) {
          const gone = new Set(deleted);
          queryClient.setQueriesData<MediaData>({ queryKey: ['media', vaultId] }, (data) =>
            mapItems(data, (items) => (items.some((m) => gone.has(m.id)) ? items.filter((m) => !gone.has(m.id)) : items)),
          );
          // The cached thumbnail is ciphertext, but there is nothing left for it to belong to
          for (const id of deleted) void removeThumbCiphertext(id);
          void queryClient.invalidateQueries({ queryKey: ['media', vaultId] });
          void queryClient.invalidateQueries({ queryKey: ['albums', vaultId] });
          void queryClient.invalidateQueries({ queryKey: ['albumCover', vaultId] });
        }
      }
    },
    [queryClient, vaultId],
  );
}

/** Drop unliked items from the Liked album's loaded list. */
export function useDropUnliked(vaultId: string, albumId: string) {
  const queryClient = useQueryClient();
  return useCallback(() => {
    queryClient.setQueryData<MediaData>(mediaKey(vaultId, albumId), (data) =>
      mapItems(data, (items) => (items.every((m) => m.isLiked) ? items : items.filter((m) => m.isLiked))),
    );
  }, [queryClient, vaultId, albumId]);
}
