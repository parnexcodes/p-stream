import {
  Fetcher,
  makeSimpleProxyFetcher,
  setM3U8ProxyUrl,
} from "@p-stream/providers";

import { sendExtensionRequest } from "@/backend/extension/messaging";
import { getApiToken, setApiToken } from "@/backend/helpers/providerApi";
import {
  corsProxyHealthManager,
  m3u8ProxyHealthManager,
} from "@/utils/proxyHealth";
import {
  getM3U8ProxyUrls,
  getProviderApiUrls,
  getProxyUrls,
} from "@/utils/proxyUrls";

import { convertBodyToObject, getBodyTypeFromBody } from "../extension/request";

/**
 * Creates a load-balanced proxy selector with health checking and failover
 *
 * Features:
 * - Round-robin rotation with random starting point
 * - Health-aware proxy selection (fastest healthy proxies first)
 * - Automatic failover to backup proxies
 * - Performance-based sorting
 *
 * @param getter Function that returns array of proxy URLs
 * @param healthManager Optional health manager for monitoring proxy status
 * @returns Function that returns the next available proxy URL
 */
function makeLoadbalancedList(
  getter: () => string[],
  healthManager?: typeof corsProxyHealthManager,
) {
  let listIndex = -1;
  return () => {
    const allProxies = getter();

    // Initialize health monitoring if health manager is provided
    if (healthManager) {
      healthManager.initializeProxies(allProxies);
    }

    // Get healthy proxies (sorted by performance) or fallback to all proxies
    const availableProxies = healthManager
      ? healthManager.getHealthyProxies(allProxies)
      : allProxies;

    if (availableProxies.length === 0) {
      throw new Error("No available proxies");
    }

    // Reset index if it's out of bounds or uninitialized
    if (listIndex === -1 || listIndex >= availableProxies.length) {
      listIndex = Math.floor(Math.random() * availableProxies.length);
    }

    const proxyUrl = availableProxies[listIndex];
    listIndex = (listIndex + 1) % availableProxies.length;
    return proxyUrl;
  };
}

// Load-balanced CORS proxy selector with health checking
// Automatically rotates between healthy proxies and monitors their performance
export const getLoadbalancedProxyUrl = makeLoadbalancedList(
  getProxyUrls,
  corsProxyHealthManager,
);

// Load-balanced provider API URL selector (no health checking for API endpoints)
export const getLoadbalancedProviderApiUrl =
  makeLoadbalancedList(getProviderApiUrls);
/**
 * Get enabled M3U8 proxy URLs based on user preferences
 * Users can enable/disable individual M3U8 proxies through the UI
 *
 * @returns Array of enabled M3U8 proxy URLs
 */
function getEnabledM3U8ProxyUrls() {
  const allM3U8ProxyUrls = getM3U8ProxyUrls();
  const enabledProxies = localStorage.getItem("m3u8-proxy-enabled");

  if (!enabledProxies) {
    return allM3U8ProxyUrls;
  }

  try {
    const enabled = JSON.parse(enabledProxies);
    return allM3U8ProxyUrls.filter(
      (_url, index) => enabled[index.toString()] !== false,
    );
  } catch {
    return allM3U8ProxyUrls;
  }
}

// Load-balanced M3U8 proxy selector with health checking and user preferences
// Only uses proxies that are both enabled by user and healthy
export const getLoadbalancedM3U8ProxyUrl = makeLoadbalancedList(
  getEnabledM3U8ProxyUrls,
  m3u8ProxyHealthManager,
);

async function fetchButWithApiTokens(
  input: RequestInfo | URL,
  init?: RequestInit | undefined,
): Promise<Response> {
  const apiToken = await getApiToken();
  const headers = new Headers(init?.headers);
  if (apiToken) headers.set("X-Token", apiToken);
  const response = await fetch(
    input,
    init
      ? {
          ...init,
          headers,
        }
      : undefined,
  );
  const newApiToken = response.headers.get("X-Token");
  if (newApiToken) setApiToken(newApiToken);
  return response;
}

export function setupM3U8Proxy() {
  try {
    const proxyUrl = getLoadbalancedM3U8ProxyUrl();
    if (proxyUrl) {
      setM3U8ProxyUrl(proxyUrl);
      console.log(`M3U8 proxy set to: ${proxyUrl}`);
    } else {
      console.warn("No M3U8 proxy URLs available");
    }
  } catch (error) {
    console.error("Failed to setup M3U8 proxy:", error);
    // Fallback: try to use any available proxy
    const allM3U8Proxies = getM3U8ProxyUrls();
    if (allM3U8Proxies.length > 0) {
      const fallbackProxy = allM3U8Proxies[0];
      setM3U8ProxyUrl(fallbackProxy);
      console.log(`Using fallback M3U8 proxy: ${fallbackProxy}`);
    }
  }
}

export function makeLoadBalancedSimpleProxyFetcher() {
  const fetcher: Fetcher = async (url, options) => {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      try {
        const proxyUrl = getLoadbalancedProxyUrl();
        const startTime = Date.now();

        const currentFetcher = makeSimpleProxyFetcher(
          proxyUrl,
          fetchButWithApiTokens,
        );

        const result = await currentFetcher(url, options);

        // Mark proxy as successful with response time
        const responseTime = Date.now() - startTime;
        corsProxyHealthManager.markProxySuccess(proxyUrl, responseTime);

        return result;
      } catch (error) {
        lastError = error as Error;
        const proxyUrl = getLoadbalancedProxyUrl();

        // Mark proxy as failed
        corsProxyHealthManager.markProxyFailed(
          proxyUrl,
          error instanceof Error ? error.message : "Unknown error",
        );

        // If this is the last attempt, throw the error
        if (attempt === maxRetries - 1) {
          console.error(`All proxy attempts failed. Last error:`, lastError);
          throw lastError;
        }

        // Wait a bit before retrying
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 1000 * (attempt + 1));
        });
      }
    }

    throw lastError || new Error("All proxy attempts failed");
  };
  return fetcher;
}

function makeFinalHeaders(
  readHeaders: string[],
  headers: Record<string, string>,
): Headers {
  const lowercasedHeaders = readHeaders.map((v) => v.toLowerCase());
  return new Headers(
    Object.entries(headers).filter((entry) =>
      lowercasedHeaders.includes(entry[0].toLowerCase()),
    ),
  );
}

export function makeExtensionFetcher() {
  const fetcher: Fetcher = async (url, ops) => {
    const result = await sendExtensionRequest<any>({
      url,
      ...ops,
      body: convertBodyToObject(ops.body),
      bodyType: getBodyTypeFromBody(ops.body),
    });
    if (!result?.success) throw new Error(`extension error: ${result?.error}`);
    const res = result.response;
    return {
      body: res.body,
      finalUrl: res.finalUrl,
      statusCode: res.statusCode,
      headers: makeFinalHeaders(ops.readHeaders, res.headers),
    };
  };
  return fetcher;
}
