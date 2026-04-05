import type {
  ApiConfig,
  ImpressionPayload,
  NotPlayableReport,
  NotPlayableReportResult,
  OkResponse,
  PlaylistResponse,
  ReactionRequest,
  ReactionType,
} from "./types";

type ApiErrorResponse = {
  error?: {
    code?: string;
    message?: string;
  };
};

async function withTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("REQUEST_TIMEOUT");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildUrl(config: ApiConfig, path: string, query?: URLSearchParams) {
  const suffix = query && query.toString() ? `${path}?${query.toString()}` : path;
  if (!config.baseUrl) return suffix;
  return new URL(suffix, config.baseUrl).toString();
}

function replaceVideoId(path: string, videoId: string) {
  return path.replace("{id}", encodeURIComponent(videoId));
}

async function parseJson<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

function toError(response: Response, payload: ApiErrorResponse | null) {
  const code = payload?.error?.code;
  const message = payload?.error?.message;
  return new Error(code ?? message ?? `HTTP_${response.status}`);
}

async function requestJson<T>(config: ApiConfig, path: string, init: RequestInit): Promise<T> {
  const response = await withTimeout(
    buildUrl(config, path),
    {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    },
    config.requestTimeoutMs,
  );

  const payload = await parseJson<T | ApiErrorResponse>(response);

  if (!response.ok) {
    throw toError(response, (payload as ApiErrorResponse | null) ?? null);
  }

  if (payload === null) {
    throw new Error("EMPTY_RESPONSE");
  }

  return payload as T;
}

export function fetchPlaylist(config: ApiConfig, cursor: string | null) {
  const query = new URLSearchParams({
    limit: String(config.playlistLimit),
  });

  if (cursor) {
    query.set("cursor", cursor);
  }

  return requestJson<PlaylistResponse>(config, `${config.playlistPath}?${query.toString()}`, {
    method: "GET",
    headers: {},
    body: undefined,
  }).then((payload) => ({
    items: payload.items ?? [],
    nextCursor: payload.nextCursor ?? null,
  }));
}

export function sendReaction(
  config: ApiConfig,
  videoId: string,
  reactionType: ReactionType,
  payload: ReactionRequest = {},
) {
  const path = reactionType === "like" ? config.likePath : config.dislikePath;
  return requestJson<OkResponse>(config, replaceVideoId(path, videoId), {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function sendImpression(config: ApiConfig, videoId: string, payload: ImpressionPayload) {
  return requestJson<OkResponse>(config, replaceVideoId(config.impressionPath, videoId), {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function reportNotPlayable(
  config: ApiConfig,
  videoId: string,
  payload: NotPlayableReport,
): Promise<NotPlayableReportResult> {
  try {
    const response = await requestJson<OkResponse>(config, replaceVideoId(config.notPlayablePath, videoId), {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return {
      ...response,
      duplicate: false,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "ALREADY_REPORTED") {
      return {
        ok: true,
        duplicate: true,
      };
    }
    throw error;
  }
}
