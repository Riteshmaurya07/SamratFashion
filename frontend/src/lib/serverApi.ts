export function getServerApiBaseUrl(): string {
  const configured =
    process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";
  const normalized = configured.replace(/\/+$/, "");
  const base = /\/api$/i.test(normalized) ? normalized : `${normalized}/api`;
  return typeof window === "undefined" ? base.replace("localhost", "127.0.0.1") : base;
}

export interface ServerFetchOptions {
  params?: Record<string, string | number | boolean | undefined | null | Array<string | number>>;
  revalidate?: number;
  tags?: string[];
}

/**
 * Server-side cached fetch utility for Next.js App Router.
 * Uses Next.js native Data Cache to eliminate cross-cloud document request latency (TTFB).
 */
export async function serverFetch<T>(
  path: string,
  options?: ServerFetchOptions
): Promise<T | null> {
  const baseUrl = getServerApiBaseUrl();
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${baseUrl}${cleanPath}`);

  if (options?.params) {
    Object.entries(options.params).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      if (Array.isArray(value)) {
        value.forEach((v) => url.searchParams.append(key, String(v)));
      } else {
        url.searchParams.append(key, String(value));
      }
    });
  }

  try {
    const res = await fetch(url.toString(), {
      next: {
        revalidate: options?.revalidate ?? 60,
        tags: options?.tags,
      },
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    return data as T;
  } catch (error) {
    console.error(`serverFetch error for ${url.toString()}:`, error);
    return null;
  }
}
