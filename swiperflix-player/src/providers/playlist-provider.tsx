
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { fetchPlaylist, sendReaction } from "@/lib/api";
import { VideoItem } from "@/lib/types";
import { apiConfig } from "@/lib/config";

type PlaylistContextValue = {
  videos: VideoItem[];
  currentIndex: number;
  current?: VideoItem;
  loading: boolean;
  error?: string;
  goNext: () => void;
  goPrev: () => void;
  likeCurrent: () => Promise<void>;
  dislikeCurrent: () => Promise<void>;
  refresh: () => Promise<void>;
};

const PlaylistContext = createContext<PlaylistContextValue | null>(null);

export function PlaylistProvider({ children }: { children: React.ReactNode }) {
  const config = apiConfig;
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const pendingMore = useRef(false);
  const prefetchingNext = useRef(false);
  const prefetchedNext = useRef<Awaited<ReturnType<typeof fetchPlaylist>> | null>(null);
  const prefetchPromise = useRef<Promise<void> | null>(null);
  const awaitingPrefetchSwap = useRef(false);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    prefetchedNext.current = null;
    awaitingPrefetchSwap.current = false;
    try {
      const resp = await fetchPlaylist(config, null);
      setVideos(resp.items || []);
      setCursor(resp.nextCursor ?? null);
      setCurrentIndex(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load playlist");
    } finally {
      setLoading(false);
    }
  }, [config]);

  const loadMore = useCallback(async () => {
    if (loadingMore || pendingMore.current) return;
    pendingMore.current = true;
    setLoadingMore(true);
    try {
      const resp = await fetchPlaylist(config, cursor);
      setVideos((prev) => [...prev, ...(resp.items || [])]);
      setCursor(resp.nextCursor ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more");
    } finally {
      pendingMore.current = false;
      setLoadingMore(false);
    }
  }, [config, cursor, loadingMore]);

  const consumePrefetched = useCallback(() => {
    if (!prefetchedNext.current) return false;
    const next = prefetchedNext.current;
    prefetchedNext.current = null;
    awaitingPrefetchSwap.current = false;
    setVideos(next.items || []);
    setCursor(next.nextCursor ?? null);
    setCurrentIndex(0);
    return true;
  }, []);

  const prefetchNextPlaylist = useCallback(() => {
    if (prefetchedNext.current) return Promise.resolve();
    if (prefetchPromise.current) return prefetchPromise.current;
    prefetchingNext.current = true;
    prefetchPromise.current = fetchPlaylist(config, null)
      .then((resp) => {
        prefetchedNext.current = resp;
      })
      .catch((err) => {
        console.warn("Prefetch next playlist failed", err);
      })
      .finally(() => {
        prefetchingNext.current = false;
        prefetchPromise.current = null;
      });
    return prefetchPromise.current;
  }, [config]);

  const ensureFuture = useCallback(
    (targetIndex: number) => {
      if (videos.length === 0) {
        void bootstrap();
        return;
      }
      const nearTail = targetIndex >= Math.max(0, videos.length - 2);
      if (nearTail) {
        if (cursor !== null) {
          // Prefetch next batch while user watches the tail of current list.
          void loadMore();
        } else {
          // No further pages; start fetching a fresh playlist ahead of time.
          void prefetchNextPlaylist();
        }
      }
    },
    [videos.length, bootstrap, cursor, loadMore, prefetchNextPlaylist],
  );

  const goNext = useCallback(() => {
    let shouldConsumePrefetched = false;
    setCurrentIndex((idx) => {
      const nextIndex = idx + 1;
      if (nextIndex >= videos.length) {
        // Already at the end. Trigger refresh / load-more but keep showing last item until new data arrives.
        if (cursor !== null) {
          void loadMore();
        } else {
          if (prefetchedNext.current) {
            shouldConsumePrefetched = true;
          } else {
            awaitingPrefetchSwap.current = true;
            void prefetchNextPlaylist().then(() => {
              if (!awaitingPrefetchSwap.current) return;
              consumePrefetched();
            });
          }
        }
        return idx;
      }
      ensureFuture(nextIndex);
      awaitingPrefetchSwap.current = false;
      return nextIndex;
    });
    if (shouldConsumePrefetched) {
      consumePrefetched();
      awaitingPrefetchSwap.current = false;
    }
  }, [ensureFuture, videos.length, cursor, loadMore, prefetchNextPlaylist, consumePrefetched]);

  const goPrev = useCallback(() => {
    awaitingPrefetchSwap.current = false;
    setCurrentIndex((idx) => Math.max(idx - 1, 0));
  }, []);

  const likeCurrent = useCallback(async () => {
    const video = videos[currentIndex];
    if (!video) return;
    await sendReaction(config, video.id, "like");
    // Stay on current video, do not goNext()
  }, [config, currentIndex, videos]);

  const dislikeCurrent = useCallback(async () => {
    const video = videos[currentIndex];
    if (!video) return;
    await sendReaction(config, video.id, "dislike");
    goNext();
  }, [config, currentIndex, goNext, videos]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const value = useMemo(
    () => ({
      videos,
      currentIndex,
      current: videos[currentIndex],
      loading,
      error,
      goNext,
      goPrev,
      likeCurrent,
      dislikeCurrent,
      refresh: bootstrap,
    }),
    [videos, currentIndex, loading, error, goNext, goPrev, likeCurrent, dislikeCurrent, bootstrap],
  );

  return <PlaylistContext.Provider value={value}>{children}</PlaylistContext.Provider>;
}

export function usePlaylist() {
  const ctx = useContext(PlaylistContext);
  if (!ctx) throw new Error("usePlaylist must be used inside PlaylistProvider");
  return ctx;
}
