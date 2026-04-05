export type Orientation = "portrait" | "landscape";

export type VideoItem = {
  id: string;
  url: string;
  cover?: string;
  title?: string;
  duration?: number;
  orientation?: Orientation;
};

export type PlaylistResponse = {
  items: VideoItem[];
  nextCursor: string | null;
};

export type ReactionType = "like" | "dislike";

export type ReactionSource = "scroll" | "button" | "swipe";

export type ReactionRequest = {
  source?: ReactionSource;
  timestamp?: string;
  sessionId?: string;
};

export type ImpressionPayload = {
  watchedSeconds: number;
  completed: boolean;
};

export type NotPlayableReport = {
  reason?: string | null;
  timestamp?: string | null;
  sessionId?: string | null;
};

export type OkResponse = {
  ok: boolean;
};

export type NotPlayableReportResult = OkResponse & {
  duplicate: boolean;
};

export type ApiConfig = {
  baseUrl: string;
  playlistPath: string;
  likePath: string;
  dislikePath: string;
  impressionPath: string;
  notPlayablePath: string;
  preloadCount: number;
  playlistLimit: number;
  requestTimeoutMs: number;
};
