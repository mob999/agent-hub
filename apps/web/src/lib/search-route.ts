export type SearchRouteSort = "relevant" | "recent";
export type SearchRouteTime = "any" | "24h" | "7d" | "30d";

export interface SearchRouteParams {
  channelId?: string;
  query?: string;
  sender?: string;
  sort?: SearchRouteSort;
  time?: SearchRouteTime;
}

export interface SearchRouteState extends Required<Pick<SearchRouteParams, "query">> {
  channelId?: string;
  isSearchRoute: boolean;
  sender?: string;
  sort: SearchRouteSort;
  time: SearchRouteTime;
}

function searchParamsFromInput(
  input: SearchRouteParams,
): URLSearchParams {
  const params = new URLSearchParams();

  if (input.query !== undefined && input.query.length > 0) {
    params.set("q", input.query);
  }

  if (input.sort !== undefined && input.sort !== "relevant") {
    params.set("sort", input.sort);
  }

  if (input.channelId !== undefined && input.channelId.length > 0) {
    params.set("channelId", input.channelId);
  }

  if (input.sender !== undefined && input.sender.length > 0) {
    params.set("sender", input.sender);
  }

  if (input.time !== undefined && input.time !== "any") {
    params.set("time", input.time);
  }

  return params;
}

export function chatConversationIdFromPath(path: string): string | null {
  const segments = path.split("/").filter(Boolean);

  if (segments[0] !== "chat") {
    return null;
  }

  if (segments[1] === "search") {
    return null;
  }

  return segments.length === 2 ? decodeURIComponent(segments[1] ?? "") : null;
}

export function getSearchRouteState(pathWithSearch: string): SearchRouteState {
  const [path, rawSearch = ""] = pathWithSearch.split("?");
  const params = new URLSearchParams(rawSearch);

  return {
    channelId: params.get("channelId") ?? undefined,
    isSearchRoute: path === "/chat/search",
    query: params.get("q") ?? "",
    sender: params.get("sender") ?? undefined,
    sort: params.get("sort") === "recent" ? "recent" : "relevant",
    time: params.get("time") === "24h" ||
        params.get("time") === "7d" ||
        params.get("time") === "30d"
      ? (params.get("time") as SearchRouteTime)
      : "any",
  };
}

export function searchRoutePath(input: SearchRouteParams): string {
  const params = searchParamsFromInput(input);
  const query = params.toString();

  return query.length === 0 ? "/chat/search" : `/chat/search?${query}`;
}

export function updateSearchRouteUrl(
  currentPathWithSearch: string,
  next: SearchRouteParams,
): string {
  const [path] = currentPathWithSearch.split("?");

  if (path !== "/chat/search") {
    return searchRoutePath(next);
  }

  const params = searchParamsFromInput(next);
  const query = params.toString();

  return query.length === 0 ? path : `${path}?${query}`;
}
