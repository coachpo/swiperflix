import type { ApiConfig } from "./types";

export const apiConfig: ApiConfig = {
  baseUrl: "",
  playlistPath: "/api/v1/playlist",
  likePath: "/api/v1/videos/{id}/like",
  dislikePath: "/api/v1/videos/{id}/dislike",
  impressionPath: "/api/v1/videos/{id}/impression",
  notPlayablePath: "/api/v1/videos/{id}/not-playable",
  preloadCount: 3,
  playlistLimit: 20,
  requestTimeoutMs: 10_000,
};
