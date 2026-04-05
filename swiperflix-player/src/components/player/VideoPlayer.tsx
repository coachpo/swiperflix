
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  RotateCw,
  Heart,
  HeartCrack,
  MoreHorizontal,
  Play,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { VideoSlider } from "@/components/ui/video-slider";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { reportNotPlayable, sendImpression } from "@/lib/api";
import { apiConfig } from "@/lib/config";
import { usePlaylist } from "@/providers/playlist-provider";
import { useToast } from "@/components/ui/use-toast";

const ANIMATION_CLASSES = [
  "animate-slide-in-up",
  "animate-slide-in-down",
  "animate-slide-out-up",
  "animate-slide-out-down",
];

const SCROLL_THRESHOLD = 25;
const SWIPE_THRESHOLD = 45;
const SWIPE_VELOCITY = 0.6; // px per ms
const LONG_PRESS_DELAY = 250;
const REWIND_STEP = 0.4;
const REWIND_INTERVAL = 200;
const CACHE_LIMIT = 12;
const PRELOAD_CONCURRENCY = 2;
export function VideoPlayer() {
  const {
    current,
    currentIndex,
    videos,
    loading,
    goNext,
    goPrev,
    likeCurrent,
    dislikeCurrent,
    refresh,
  } = usePlaylist();
  const config = apiConfig;
  const { toast } = useToast();
  
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
  const [rotation, setRotation] = useState(0);
  const [outgoingRotation, setOutgoingRotation] = useState(0);
  const [reaction, setReaction] = useState<"liked" | "disliked" | null>(null);
  const [pressMode, setPressMode] = useState<"rewind" | "fast" | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [buffered, setBuffered] = useState(0);
  const [autoPlayNext, setAutoPlayNext] = useState(true);
  const [direction, setDirection] = useState<"next" | "prev" | null>(null);
  const [outgoing, setOutgoing] = useState<typeof current | null>(null);
  const [animating, setAnimating] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [, setPendingPlay] = useState(false);
  const [activeEl, setActiveEl] = useState<HTMLVideoElement | null>(null);
  const [outgoingEl, setOutgoingEl] = useState<HTMLVideoElement | null>(null);
  const [showDoubleTap, setShowDoubleTap] = useState(false);

  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rewindInterval = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastIndexRef = useRef(currentIndex);
  const prevVideoRef = useRef<typeof current>(current);
  const preloadControllers = useRef<Map<string, AbortController>>(new Map());
  const preloadedUrls = useRef<Set<string>>(new Set());
  const preloadedEls = useRef<Map<string, HTMLVideoElement>>(new Map());
  const cachedEls = useRef<Map<string, HTMLVideoElement>>(new Map());
  const pendingPlayRef = useRef(false);
  const isScrubbingRef = useRef(false);
  const userPausedRef = useRef(false);
  const autoPausedRef = useRef(false);
  const retryCounts = useRef<Map<string, number>>(new Map());
  const lastProgress = useRef<Map<string, number>>(new Map());
  const videoHostRef = useRef<HTMLDivElement | null>(null);
  const outgoingHostRef = useRef<HTMLDivElement | null>(null);
  const sessionIdRef = useRef<string>(
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `sess-${Math.random().toString(36).slice(2)}`,
  );
  const impressionsSent = useRef<Set<string>>(new Set());
  const reportedNotPlayable = useRef<Set<string>>(new Set());
  const lastVideoIdRef = useRef<string | null>(null);
  // Always honor the requested preload count; skip connection-based throttling.
  const preloadBudget = useMemo(() => Math.max(0, config.preloadCount), [config.preloadCount]);

  const applyVideoStyles = useCallback(
    (
      el: HTMLVideoElement,
      opts: { outgoing?: boolean; orientationOverride?: "portrait" | "landscape" },
    ) => {
      const orient = opts.orientationOverride ?? orientation;
      el.playsInline = true;
      el.loop = true;
      el.muted = !!opts.outgoing;
      el.className = cn(
        "absolute inset-0 h-full w-full object-contain object-center mx-auto block",
        orient === "landscape"
          ? "bg-gradient-to-b from-black/40 to-black/60"
          : "bg-black",
      );
      el.style.transform = `rotate(${opts.outgoing ? outgoingRotation : rotation}deg)`;
      el.style.transformOrigin = "center center";
      el.style.transition = "transform 200ms ease";
    },
    [orientation, rotation, outgoingRotation],
  );

  const applyHostAnimation = useCallback(
    (host: HTMLDivElement | null, opts: { outgoing?: boolean }) => {
      if (!host) return;
      host.classList.remove(...ANIMATION_CLASSES);
      if (!animating) return;

      const cls = opts.outgoing
        ? direction === "prev"
          ? "animate-slide-out-down"
          : "animate-slide-out-up"
        : direction === "prev"
          ? "animate-slide-in-down"
          : "animate-slide-in-up";

      host.classList.add(cls);
    },
    [animating, direction],
  );

  useEffect(() => {
    isScrubbingRef.current = isScrubbing;
  }, [isScrubbing]);

  const clampWatchedSeconds = useCallback(
    (seconds: number, video?: typeof current) => {
      const target = video ?? current;
      if (!target) return Math.max(0, seconds);
      const knownDuration = target.id === current?.id && duration ? duration : target.duration;
      if (knownDuration && Number.isFinite(knownDuration)) {
        return Math.max(0, Math.min(seconds, knownDuration));
      }
      return Math.max(0, seconds);
    },
    [current, duration],
  );

  const getWatchedSeconds = useCallback(
    (video?: typeof current) => {
      const target = video ?? current;
      if (!target) return 0;
      if (videoRef.current && target.id === current?.id) {
        return clampWatchedSeconds(videoRef.current.currentTime || 0, target);
      }
      const progress = lastProgress.current.get(target.id) ?? 0;
      return clampWatchedSeconds(progress, target);
    },
    [clampWatchedSeconds, current],
  );

  const sendImpressionOnce = useCallback(
    async (opts?: { video?: typeof current; completed?: boolean }) => {
      const target = opts?.video ?? current;
      if (!target || impressionsSent.current.has(target.id)) return;
      const watchedSeconds = getWatchedSeconds(target);
      try {
        await sendImpression(config, target.id, {
          watchedSeconds,
          completed: !!opts?.completed,
        });
        impressionsSent.current.add(target.id);
      } catch (error) {
        console.warn("Failed to send impression", error);
      }
    },
    [config, current, getWatchedSeconds],
  );

  const reportCurrentNotPlayable = useCallback(
    async (reason?: string | null) => {
      const target = current;
      if (!target || reportedNotPlayable.current.has(target.id)) return;
      const payload = {
        reason: reason ?? "Playback error",
        timestamp: new Date().toISOString(),
        sessionId: sessionIdRef.current,
      };
      try {
        const result = await reportNotPlayable(config, target.id, payload);
        reportedNotPlayable.current.add(target.id);
        if (result.duplicate) {
          toast({ title: "Already reported", description: "We logged this playback issue earlier." });
        } else {
          toast({ title: "Issue reported", description: "Thanks, we'll investigate this video." });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Report failed";
        if (message === "VIDEO_NOT_FOUND") {
          toast({ title: "Video missing", description: "Skipping unavailable video." });
        } else {
          toast({ title: "Report failed", description: message });
        }
      }
    },
    [config, current, toast],
  );

  const isUsableCache = useCallback((el: HTMLVideoElement | null | undefined, url: string) => {
    if (!el || !url) return false;
    const matchesUrl = el.src === url;
    const hasData = el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
    const hasDuration = Number.isFinite(el.duration) && el.duration > 0;
    const networkOk = el.networkState !== HTMLMediaElement.NETWORK_NO_SOURCE;
    return matchesUrl && hasData && hasDuration && networkOk;
  }, []);

  const suspendVideoFetch = useCallback((el: HTMLVideoElement | null | undefined) => {
    if (!el) return;
    el.pause();
    el.autoplay = false;
    el.preload = "metadata";
    el.dataset.suspended = "true";
  }, []);

  const cacheVideoElement = useCallback(
    (url: string, el: HTMLVideoElement | null) => {
      if (!el || !url) return;
      if (!isUsableCache(el, url)) {
        cachedEls.current.delete(url);
        return;
      }
      if (cachedEls.current.has(url)) {
        cachedEls.current.delete(url);
      }
      cachedEls.current.set(url, el);
      while (cachedEls.current.size > CACHE_LIMIT) {
        const oldest = cachedEls.current.keys().next().value as string | undefined;
        if (!oldest) break;
        cachedEls.current.delete(oldest);
        preloadedEls.current.delete(oldest);
        preloadedUrls.current.delete(oldest);
      }
    },
    [isUsableCache],
  );

  // Sync video source for the active video, reusing preloaded element when available
  useEffect(() => {
    if (!current) return;
    retryCounts.current.delete(current.url);

    const preloadCtrl = preloadControllers.current.get(current.url);
    if (preloadCtrl) {
      preloadCtrl.abort();
      preloadControllers.current.delete(current.url);
    }

    const fromCache = cachedEls.current.get(current.url);
    if (fromCache) {
      cachedEls.current.delete(current.url);
      fromCache.preload = "auto";
      delete fromCache.dataset.suspended;
    }

    const fromPreload = fromCache ?? preloadedEls.current.get(current.url);
    if (fromPreload && preloadedEls.current.has(current.url)) {
      preloadedEls.current.delete(current.url);
    }

    const video = fromPreload ?? document.createElement("video");
    video.setAttribute("fetchpriority", "high");
    videoRef.current = video;
    setActiveEl(video);

    pendingPlayRef.current = false;
    setPendingPlay(false);
    setIsPlaying(false);
    setIsBuffering(true);

    const onTime = () => {
      setTime(video.currentTime);
      if (!isScrubbingRef.current && current?.id) {
        lastProgress.current.set(current.id, video.currentTime);
      }
    };
    const onLoaded = () => {
      setDuration(video.duration || 0);
      setOrientation(video.videoWidth >= video.videoHeight ? "landscape" : "portrait");
      const resumeAt = lastProgress.current.get(current.id) ?? 0;
      setTime(resumeAt);
      video.currentTime = resumeAt;
      setIsBuffering(false);
      setBuffered(0);
    };
    const onProgress = () => {
      try {
        if (!video.duration || video.buffered.length === 0) {
          setBuffered(0);
          return;
        }
        const end = video.buffered.end(video.buffered.length - 1);
        setBuffered(Math.min(end, video.duration));
      } catch {
        setBuffered(0);
      }
    };
    const onEnded = () => {
      void sendImpressionOnce({ video: current, completed: true });
      if (autoPlayNext) {
        setDirection("next");
        goNext();
      }
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onWaiting = () => {
      setIsBuffering(true);
    };
    const onCanPlay = () => {
      setIsBuffering(false);
      if (pendingPlayRef.current) {
        pendingPlayRef.current = false;
        setPendingPlay(false);
        video
          .play()
          .then(() => setIsPlaying(true))
          .catch(() => setIsPlaying(false));
      }
    };
    const onError = () => {
      const attempts = retryCounts.current.get(current.url) ?? 0;
      if (attempts < 2) {
        retryCounts.current.set(current.url, attempts + 1);
        setIsBuffering(true);
        pendingPlayRef.current = true;
        setPendingPlay(true);
        video.load();
        video.play().catch(() => {});
        return;
      }
      retryCounts.current.delete(current.url);
      setIsPlaying(false);
      setIsBuffering(false);
      const reason =
        video.error?.message ||
        `readyState=${video.readyState} networkState=${video.networkState}`;
      void reportCurrentNotPlayable(reason);
      toast({ title: "Playback error", description: "Reporting and skipping to next video" });
      setDirection("next");
      goNext();
    };

    video.addEventListener("timeupdate", onTime);
    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("ended", onEnded);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("canplaythrough", onCanPlay);
    video.addEventListener("progress", onProgress);
    video.addEventListener("error", onError);

    const hasUsableCache = isUsableCache(video, current.url);
    const needsLoad = !hasUsableCache || video.src !== current.url;
    if (needsLoad) {
      video.preload = "auto";
      video.src = current.url;
      video.load();
    } else if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      // Preloaded element already has metadata; update UI immediately.
      onLoaded();
    }

    const attemptPlay = () => {
      video
        .play()
        .then(() => {
          setIsBuffering(false);
          setIsPlaying(true);
          userPausedRef.current = false;
          setPendingPlay(false);
          pendingPlayRef.current = false;
        })
        .catch(() => {
          setIsPlaying(false);
          setPendingPlay(true);
          pendingPlayRef.current = true;
          // If autoplay was blocked, ensure muted state aligns with policy
          video.muted = true;
        });
    };

    if (needsLoad) {
      setPendingPlay(true);
      pendingPlayRef.current = true;
    }

    attemptPlay();

    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("canplaythrough", onCanPlay);
      video.removeEventListener("progress", onProgress);
      video.removeEventListener("error", onError);
      suspendVideoFetch(video);
      cacheVideoElement(current.url, video);
    };
  }, [
    current,
    goNext,
    autoPlayNext,
    cacheVideoElement,
    isUsableCache,
    suspendVideoFetch,
    toast,
    sendImpressionOnce,
    reportCurrentNotPlayable,
  ]);

  // Track direction and animate in/out
  useEffect(() => {
    if (!current) return;
    const prev = prevVideoRef.current;
    if (prev && prev.id !== current.id) {
      const dir = currentIndex > lastIndexRef.current ? "next" : "prev";
      setOutgoing(prev);
      setOutgoingEl(activeEl);
      setOutgoingRotation(rotation);
      setDirection(dir);
      setAnimating(true);
      const timer = setTimeout(() => {
        setOutgoing(null);
        setOutgoingEl(null);
        setAnimating(false);
      }, 320);
      lastIndexRef.current = currentIndex;
      prevVideoRef.current = current;
      return () => clearTimeout(timer);
    }
    prevVideoRef.current = current;
    lastIndexRef.current = currentIndex;
  }, [current, currentIndex, rotation, activeEl]);

  // Preload next few videos with small concurrency (up to PRELOAD_COUNT)
  useEffect(() => {
    if (videos.length === 0) return;

    const prevUrl = videos[currentIndex - 1]?.url;
    const nextUrls = videos
      .slice(currentIndex + 1, currentIndex + 1 + Math.max(0, preloadBudget))
      .map((v) => v.url);

    const urls = [prevUrl, ...nextUrls]
      .filter(Boolean)
      .filter((url, idx, arr) => url && arr.indexOf(url) === idx);

    const desired = new Set(urls);
    preloadControllers.current.forEach((controller, url) => {
      if (!desired.has(url)) {
        controller.abort();
        preloadControllers.current.delete(url);
        preloadedUrls.current.delete(url);
        preloadedEls.current.delete(url);
      }
    });

    const queue = [...urls];

    const preloadOne = async (url: string) => {
      if (preloadedUrls.current.has(url) || preloadControllers.current.has(url)) return;

      const controller = new AbortController();
      preloadControllers.current.set(url, controller);

      const videoEl = document.createElement("video");
      videoEl.preload = "auto";
      videoEl.playsInline = true;
      videoEl.loop = true;
      videoEl.setAttribute("fetchpriority", "low");
      videoEl.src = url;
      preloadedEls.current.set(url, videoEl);

      await new Promise<void>((resolve) => {
        const cleanup = () => {
          videoEl.removeEventListener("canplaythrough", onReady);
          videoEl.removeEventListener("loadeddata", onReady);
          videoEl.removeEventListener("error", onError);
          preloadControllers.current.delete(url);
          if (controller.signal.aborted) {
            preloadedEls.current.delete(url);
          }
        };
        const onReady = () => {
          cleanup();
          preloadedUrls.current.add(url);
          cacheVideoElement(url, videoEl);
          resolve();
        };
        const onError = () => {
          cleanup();
          resolve();
        };
        videoEl.addEventListener("canplaythrough", onReady, { once: true });
        videoEl.addEventListener("loadeddata", onReady, { once: true });
        videoEl.addEventListener("error", onError, { once: true });
        videoEl.load();
      });
    };

    const worker = async () => {
      while (queue.length) {
        const url = queue.shift();
        if (!url) break;
        await preloadOne(url);
      }
    };

    const workers = Array.from({ length: Math.min(PRELOAD_CONCURRENCY, queue.length) }, worker);
    void Promise.all(workers);

    return () => {
      // Do not abort in-flight on index change to preserve benefit; cleanup happens on unmount below.
    };
  }, [videos, currentIndex, preloadBudget, cacheVideoElement]);

  // Hint the browser to start fetching the imminent next video earlier
  useEffect(() => {
    const nextUrl = videos[currentIndex + 1]?.url || current?.url;
    if (!nextUrl) return;
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "video";
    link.href = nextUrl;
    link.setAttribute("fetchpriority", "high");
    document.head.appendChild(link);
    return () => {
      if (link.parentNode) link.parentNode.removeChild(link);
    };
  }, [current?.url, currentIndex, videos]);

  useEffect(() => {
    const controllers = preloadControllers.current;
    const els = preloadedEls.current;
    const urls = preloadedUrls.current;
    const cache = cachedEls.current;
    return () => {
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
      els.clear();
      urls.clear();
      cache.clear();
    };
  }, []);

  useEffect(() => {
    setRotation(0);
  }, [current?.id]);

  useEffect(() => {
    const previousId = lastVideoIdRef.current;
    if (previousId && previousId !== current?.id) {
      const previousVideo = videos.find((v) => v.id === previousId);
      if (previousVideo) {
        void sendImpressionOnce({ video: previousVideo, completed: false });
      }
    }
    lastVideoIdRef.current = current?.id ?? null;
  }, [current?.id, videos, sendImpressionOnce]);

  useEffect(() => {
    return () => {
      const previousId = lastVideoIdRef.current;
      if (!previousId) return;
      const previousVideo = videos.find((v) => v.id === previousId);
      if (previousVideo) {
        void sendImpressionOnce({ video: previousVideo, completed: false });
      }
    };
  }, [videos, sendImpressionOnce]);

  useEffect(() => {
    const host = videoHostRef.current;
    if (!host || !activeEl) return;
    if (!host.contains(activeEl)) {
      host.innerHTML = "";
      host.appendChild(activeEl);
    }
    applyVideoStyles(activeEl, { outgoing: false, orientationOverride: orientation });
    applyHostAnimation(host, { outgoing: false });
  }, [activeEl, applyVideoStyles, applyHostAnimation, orientation, rotation, animating, direction]);

  useEffect(() => {
    const host = outgoingHostRef.current;
    if (!host) return;
    if (!outgoingEl) {
      host.classList.remove(...ANIMATION_CLASSES);
      host.innerHTML = "";
      return;
    }
    const orient = outgoing?.orientation ?? orientation;
    applyVideoStyles(outgoingEl, { outgoing: true, orientationOverride: orient });
    applyHostAnimation(host, { outgoing: true });
    if (!host.contains(outgoingEl)) {
      host.innerHTML = "";
      host.appendChild(outgoingEl);
    }
  }, [
    outgoingEl,
    applyVideoStyles,
    applyHostAnimation,
    outgoing?.orientation,
    orientation,
    outgoingRotation,
    animating,
    direction,
  ]);

  // Handle Playback Rate & Press Modes
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = pressMode === "fast" ? 2 : playbackRate;
    }
  }, [playbackRate, pressMode]);

  const handleWheel = (event: React.WheelEvent) => {
    const { deltaX, deltaY } = event;
    // Vertical scroll -> Next/Prev
    if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > SCROLL_THRESHOLD) {
      event.preventDefault();
      if (deltaY < 0) {
         // Scroll down (finger up) -> Next content
         setDirection("next");
         goNext(); 
      } else {
         setDirection("prev");
         goPrev();
      }
      return;
    }
    // Horizontal scroll -> Like/Dislike
    if (Math.abs(deltaX) > SCROLL_THRESHOLD) {
      event.preventDefault();
      if (deltaX > 0) handleLike();
      else handleDislike();
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY, t: performance.now() };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStart.current.x;
    const dy = touch.clientY - touchStart.current.y;
    const dt = Math.max(1, performance.now() - touchStart.current.t);
    const vx = dx / dt;
    const vy = dy / dt;

    const horizontalStrong = Math.abs(dx) > Math.abs(dy) + 10;
    const verticalStrong = Math.abs(dy) > Math.abs(dx) + 10;

    if (
      (horizontalStrong && Math.abs(dx) > SWIPE_THRESHOLD) ||
      (horizontalStrong && Math.abs(vx) > SWIPE_VELOCITY && Math.abs(dx) > 30)
    ) {
      if (dx > 0) {
        handleLike();
      } else {
        handleDislike();
      }
    } else if (
      (verticalStrong && Math.abs(dy) > SWIPE_THRESHOLD) ||
      (verticalStrong && Math.abs(vy) > SWIPE_VELOCITY && Math.abs(dy) > 30)
    ) {
      if (dy < 0) {
        setDirection("next");
        goNext();
      } else {
        setDirection("prev");
        goPrev();
      }
    }
    touchStart.current = null;
  };

  const handleLike = useCallback(async () => {
    try {
      await likeCurrent();
      setReaction("liked");
      toast({ title: "Liked", description: "Like this video" });
    } catch {
      toast({ title: "Error", description: "Failed to like video" });
    } finally {
      setTimeout(() => setReaction(null), 900);
    }
  }, [likeCurrent, toast]);

  const handleDislike = useCallback(async () => {
    try {
      await dislikeCurrent();
      setReaction("disliked");
      toast({ title: "Disliked", description: "Dislike this video" });
    } catch {
      toast({ title: "Error", description: "Failed to process dislike" });
    } finally {
      setTimeout(() => setReaction(null), 900);
    }
  }, [dislikeCurrent, toast]);

  const handleDoubleTap = useCallback(() => {
    likeCurrent().catch(() => {});
    setReaction("liked");
    setShowDoubleTap(true);
    setTimeout(() => setShowDoubleTap(false), 700);
    setTimeout(() => setReaction(null), 900);
  }, [likeCurrent]);

  const handleTogglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.src) return;

    if (
      video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      setPendingPlay(true);
      pendingPlayRef.current = true;
      setIsBuffering(true);
      video.load();
      return;
    }

    if (video.paused) {
      video
        .play()
        .then(() => {
          userPausedRef.current = false;
          setIsPlaying(true);
        })
        .catch(() => {
          setPendingPlay(true);
          pendingPlayRef.current = true;
        });
    } else {
      video.pause();
      setIsPlaying(false);
      userPausedRef.current = true;
    }
  }, []);

  const resumeIfAllowed = useCallback(() => {
    const video = videoRef.current;
    if (!video || userPausedRef.current) return;
    video
      .play()
      .then(() => {
        setIsPlaying(true);
        setIsBuffering(false);
        userPausedRef.current = false;
        setPendingPlay(false);
        pendingPlayRef.current = false;
      })
      .catch(() => {
        setPendingPlay(true);
        pendingPlayRef.current = true;
      });
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        const visible = entry?.isIntersecting && entry.intersectionRatio >= 0.6;
        if (visible) {
          if (autoPausedRef.current) {
            autoPausedRef.current = false;
            resumeIfAllowed();
          }
        } else {
          const video = videoRef.current;
          if (video && !video.paused) {
            autoPausedRef.current = true;
            video.pause();
            setIsPlaying(false);
          }
        }
      },
      { threshold: [0, 0.25, 0.5, 0.6, 0.75, 1] },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [resumeIfAllowed]);

  useEffect(() => {
    const handleVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "hidden") {
        const video = videoRef.current;
        if (video && !video.paused) {
          autoPausedRef.current = true;
          video.pause();
          setIsPlaying(false);
        }
      } else {
        resumeIfAllowed();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [resumeIfAllowed]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setDirection("next");
          goNext();
          break;
        case "ArrowUp":
          e.preventDefault();
          setDirection("prev");
          goPrev();
          break;
        case "ArrowLeft":
          e.preventDefault();
          handleDislike();
          break;
        case "ArrowRight":
          e.preventDefault();
          handleLike();
          break;
        case " ":
          e.preventDefault();
          handleTogglePlay();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goNext, goPrev, handleLike, handleDislike, handleTogglePlay]);


  const handleRotate = () => {
    setRotation((prev) => prev + 90);
  };

  const handleSeekCommit = (value: number[]) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = value[0];
    setTime(value[0]);
    if (current?.id) {
      lastProgress.current.set(current.id, value[0]);
    }
    setIsScrubbing(false);
  };

  const startPress = (mode: "rewind" | "fast") => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    if (rewindInterval.current) clearInterval(rewindInterval.current);
    
    pressTimer.current = setTimeout(() => {
      setPressMode(mode);
      if (mode === "fast") {
        if (videoRef.current) {
          videoRef.current.playbackRate = 2;
          videoRef.current.play().catch(() => {});
        }
      } else {
        rewindInterval.current = setInterval(() => {
          const video = videoRef.current;
          if (!video) return;
          video.currentTime = Math.max(0, video.currentTime - REWIND_STEP);
        }, REWIND_INTERVAL);
      }
    }, LONG_PRESS_DELAY);
  };

  const endPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    if (rewindInterval.current) clearInterval(rewindInterval.current);
    
    pressTimer.current = null;
    rewindInterval.current = null;
    
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
    setPressMode(null);
  };

  const progress = duration ? Math.min(time, duration) : 0;
  const friendlyTitle = useMemo(() => current?.title || `Video ${currentIndex + 1}`, [current, currentIndex]);

  if (!current) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black text-white">
        <div className="text-center">
          <p className="mb-4 text-muted-foreground">
            {loading ? "Loading playlist..." : "No videos available"}
          </p>
          {!loading && (
            <Button onClick={refresh} variant="secondary">
              Reload
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-black select-none touch-none"
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="absolute inset-0 overflow-hidden">
        {outgoing && <div ref={outgoingHostRef} className="absolute inset-0" />}
        <div ref={videoHostRef} className="absolute inset-0" />
      </div>

      {/* Gesture Zones (Invisible) */}
      <div className="absolute inset-0 grid grid-cols-3 z-10">
        <div
          className="h-full w-full touch-none select-none"
          onPointerDown={() => startPress("rewind")}
          onPointerUp={endPress}
          onPointerLeave={endPress}
          onContextMenu={(e) => e.preventDefault()}
        />
        <div
          className="h-full w-full touch-none select-none"
          onClick={handleTogglePlay}
          onDoubleClick={handleDoubleTap}
          onPointerDown={endPress} // cancel existing press
          onContextMenu={(e) => e.preventDefault()}
        />
        <div
          className="h-full w-full touch-none select-none"
          onPointerDown={() => startPress("fast")}
          onPointerUp={endPress}
          onPointerLeave={endPress}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>

      {/* Overlay UI Layer (Pointer events pass through except on buttons) */}
      <div className="absolute inset-0 z-20 pointer-events-none flex flex-col p-4 pb-[calc(3rem+env(safe-area-inset-bottom))]">
        
        {/* Main HUD Area */}
        <div className="mt-auto flex items-end gap-4">
            {/* Bottom Info & Progress */}
            <div className="flex-1 flex flex-col gap-3 pointer-events-auto pb-2">
                {/* Metadata */}
                <div className="space-y-1">
                  <h2 className="font-semibold text-white drop-shadow-md">{friendlyTitle}</h2>
                </div>

        {/* Full Width Scrub Bar */}
        <div 
          className="w-full pointer-events-auto absolute bottom-[calc(2rem+env(safe-area-inset-bottom))] left-0 z-10 px-8 pr-24 sm:pr-32"
          onTouchStart={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="relative h-6 w-full">
            <div
              className="absolute inset-y-2 left-0 rounded-full bg-white/20 pointer-events-none"
              style={{
                width: duration ? `${Math.min(buffered / duration, 1) * 100}%` : "0%",
              }}
            />
            <VideoSlider
              value={[isScrubbing ? time : progress]}
              min={0}
              max={Math.max(duration, 0.1)}
              step={0.05}
              onValueChange={(v) => {
                setIsScrubbing(true);
                setTime(v[0]);
              }}
              onValueCommit={handleSeekCommit}
              className="cursor-pointer h-6 w-full relative"
            />
          </div>
        </div>
            </div>

            {/* Right Action Bar (Vertical Stack) */}
            <div className="flex flex-col gap-4 pointer-events-auto items-center pb-10">
                {/* Profile / Follow placeholder (optional, kept simple) */}
                
                {/* Like */}
                <div className="flex flex-col items-center gap-1">
                   <Button 
                      size="icon" 
                      variant="ghost" 
                      className="h-12 w-12 p-0 bg-transparent hover:bg-transparent text-white transition-all active:scale-90 shadow-none"
                      onClick={handleRotate}
                   >
                      <RotateCw className="h-6 w-6 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]" />
                   </Button>
                   <span className="text-[10px] font-medium text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">Rotate</span>
                </div>

                {/* Like */}
                <div className="flex flex-col items-center gap-1">
                   <Button 
                      size="icon" 
                      variant="ghost" 
                      className={cn(
                        "h-12 w-12 p-0 bg-transparent hover:bg-transparent text-white transition-all active:scale-90 shadow-none",
                        reaction === 'liked' && "text-red-500"
                      )}
                      onClick={handleLike}
                   >
                      <Heart className={cn("h-6 w-6 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]", reaction === 'liked' && "fill-current")} />
                   </Button>
                   <span className="text-[10px] font-medium text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">Like</span>
                </div>

                {/* Dislike */}
                <div className="flex flex-col items-center gap-1">
                   <Button 
                      size="icon" 
                      variant="ghost" 
                      className="h-12 w-12 p-0 bg-transparent hover:bg-transparent text-white transition-all active:scale-90 shadow-none"
                      onClick={handleDislike}
                   >
                      <HeartCrack className="h-6 w-6 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]" />
                   </Button>
                   <span className="text-[10px] font-medium text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">Dislike</span>
                </div>

                 {/* More / Options */}
                 <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                       <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-10 w-10 p-0 bg-transparent hover:bg-transparent text-white/80 shadow-none"
                       >
                          <MoreHorizontal className="h-5 w-5 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]" />
                       </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" side="left" className="w-56 bg-black/90 border-white/10 text-white mr-2">
                       <DropdownMenuLabel className="text-xs text-white/50 uppercase tracking-wider">Playback Settings</DropdownMenuLabel>
                       
                       <DropdownMenuCheckboxItem
                          checked={autoPlayNext}
                          onCheckedChange={setAutoPlayNext}
                          className="text-sm focus:bg-white/20 focus:text-white cursor-pointer data-[state=checked]:bg-white/10"
                       >
                          Auto-play next video
                       </DropdownMenuCheckboxItem>
                       
                       <DropdownMenuSeparator className="bg-white/10" />
                       
            <DropdownMenuLabel className="text-xs text-white/50 uppercase tracking-wider mt-1">Speed</DropdownMenuLabel>
            {[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((speed) => (
                         <DropdownMenuItem 
                            key={speed} 
                            onClick={() => setPlaybackRate(speed)}
                            className={cn(
                                "justify-between text-sm focus:bg-white/20 focus:text-white cursor-pointer",
                                playbackRate === speed && "bg-white/10 text-white"
                            )}
                         >
                           <span>{speed}x</span>
                           {playbackRate === speed && <Zap className="h-3 w-3 fill-current" />}
                         </DropdownMenuItem>
                       ))}
                    </DropdownMenuContent>
                 </DropdownMenu>
            </div>
        </div>

        {/* Central Status Badges (Toast-like overlays) */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none flex flex-col gap-2 items-center">
           {isBuffering && (
              <div className="flex flex-col items-center gap-3 bg-black/50 px-5 py-4 rounded-2xl backdrop-blur-sm animate-in fade-in">
                <div className="h-8 w-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span className="text-xs uppercase tracking-[0.2em] text-white/80">Loading</span>
              </div>
           )}
           {!isPlaying && !loading && (
              <div className="bg-black/40 rounded-full p-4 backdrop-blur-sm animate-in fade-in zoom-in duration-200">
                 <Play className="h-8 w-8 text-white/90 fill-white/90" />
              </div>
           )}
           
           {pressMode === "fast" && (
              <Badge className="bg-black/40 text-white/80 backdrop-blur-sm px-3 py-1.5 text-xs animate-pulse border-none">
                 <Zap className="mr-2 h-3 w-3 fill-white/80 text-white/80" />
                 2x Speed
              </Badge>
           )}
           
           {pressMode === "rewind" && (
              <Badge className="bg-black/60 text-white backdrop-blur-md px-4 py-2 text-sm animate-pulse border-none">
                 <ArrowLeft className="mr-2 h-4 w-4" />
                 Rewinding...
              </Badge>
           )}

           {showDoubleTap && (
              <div className="flex items-center justify-center">
                <Heart className="h-16 w-16 text-red-500 drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)] animate-in zoom-in fade-in" />
              </div>
           )}
        </div>
      </div>
    </div>
  );
}
