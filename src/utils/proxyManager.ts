import { conf } from "@/setup/config";
import { useAuthStore } from "@/stores/auth";

import {
  type ProxyHealthStatus,
  corsProxyHealthManager,
  m3u8ProxyHealthManager,
} from "./proxyHealth";
import { getM3U8ProxyUrls, getProxyUrls } from "./proxyUrls";

export interface ProxyTestResult {
  url: string;
  success: boolean;
  responseTime?: number;
  error?: string;
  statusCode?: number;
}

export interface ProxyManagerConfig {
  testTimeout: number;
  testEndpoint: string;
}

const DEFAULT_CONFIG: ProxyManagerConfig = {
  testTimeout: 10000, // 10 seconds
  testEndpoint: "/health", // Default health check endpoint
};

class ProxyManager {
  private config: ProxyManagerConfig;

  constructor(config: Partial<ProxyManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Test a single proxy URL
   */
  async testProxy(url: string, testUrl?: string): Promise<ProxyTestResult> {
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.testTimeout,
    );

    try {
      // Use a test URL or default health check endpoint
      const targetUrl = testUrl || `${url}${this.config.testEndpoint}`;

      const response = await fetch(targetUrl, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "User-Agent": "p-stream-proxy-test",
          Accept: "application/json, text/plain, */*",
        },
      });

      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      return {
        url,
        success: response.ok || response.status === 404, // 404 is acceptable
        responseTime,
        statusCode: response.status,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      return {
        url,
        success: false,
        responseTime,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Test multiple proxy URLs concurrently
   */
  async testProxies(
    urls: string[],
    testUrl?: string,
  ): Promise<ProxyTestResult[]> {
    const testPromises = urls.map((url) => this.testProxy(url, testUrl));
    return Promise.all(testPromises);
  }

  /**
   * Get health status for CORS proxies
   */
  static getCorsProxyHealth(): ProxyHealthStatus[] {
    return corsProxyHealthManager.getHealthStatus();
  }

  /**
   * Get health status for M3U8 proxies
   */
  static getM3U8ProxyHealth(): ProxyHealthStatus[] {
    return m3u8ProxyHealthManager.getHealthStatus();
  }

  /**
   * Add a new CORS proxy URL
   */
  static addCorsProxy(url: string): boolean {
    try {
      // Validate URL format
      try {
        const parsedUrl = new URL(url);
        if (!parsedUrl.protocol || !parsedUrl.hostname) {
          throw new Error("Invalid URL format");
        }
      } catch {
        throw new Error("Invalid URL format");
      }

      const currentProxies = getProxyUrls();
      if (currentProxies.includes(url)) {
        return false; // Already exists
      }

      // Add to auth store proxy set
      const authStore = useAuthStore.getState();
      const currentProxySet = authStore.proxySet || conf().PROXY_URLS;
      const newProxySet = [...currentProxySet, url];

      useAuthStore.setState({ proxySet: newProxySet });

      // Initialize health monitoring for the new proxy
      corsProxyHealthManager.initializeProxies(newProxySet);

      return true;
    } catch (error) {
      console.error("Failed to add CORS proxy:", error);
      return false;
    }
  }

  /**
   * Remove a CORS proxy URL
   */
  static removeCorsProxy(url: string): boolean {
    try {
      const authStore = useAuthStore.getState();
      const currentProxySet = authStore.proxySet || conf().PROXY_URLS;
      const newProxySet = currentProxySet.filter((proxy) => proxy !== url);

      if (newProxySet.length === currentProxySet.length) {
        return false; // URL not found
      }

      useAuthStore.setState({ proxySet: newProxySet });

      // Update health monitoring
      corsProxyHealthManager.initializeProxies(newProxySet);

      return true;
    } catch (error) {
      console.error("Failed to remove CORS proxy:", error);
      return false;
    }
  }

  /**
   * Reorder CORS proxy URLs
   */
  static reorderCorsProxies(urls: string[]): boolean {
    try {
      // Validate all URLs
      urls.forEach((url) => new URL(url));

      useAuthStore.setState({ proxySet: urls });

      // Update health monitoring
      corsProxyHealthManager.initializeProxies(urls);

      return true;
    } catch (error) {
      console.error("Failed to reorder CORS proxies:", error);
      return false;
    }
  }

  /**
   * Enable/disable M3U8 proxy by index
   */
  static toggleM3U8Proxy(index: number, enabled: boolean): boolean {
    try {
      const enabledProxies = localStorage.getItem("m3u8-proxy-enabled");
      let enabledMap: Record<string, boolean> = {};

      if (enabledProxies) {
        enabledMap = JSON.parse(enabledProxies);
      }

      enabledMap[index.toString()] = enabled;
      localStorage.setItem("m3u8-proxy-enabled", JSON.stringify(enabledMap));

      // Reinitialize health monitoring with updated enabled proxies
      const allM3U8Proxies = getM3U8ProxyUrls();
      const enabledM3U8Proxies = allM3U8Proxies.filter(
        (_url, idx) => enabledMap[idx.toString()] !== false,
      );
      m3u8ProxyHealthManager.initializeProxies(enabledM3U8Proxies);

      return true;
    } catch (error) {
      console.error("Failed to toggle M3U8 proxy:", error);
      return false;
    }
  }

  /**
   * Get enabled M3U8 proxy indices
   */
  static getEnabledM3U8ProxyIndices(): number[] {
    try {
      const enabledProxies = localStorage.getItem("m3u8-proxy-enabled");
      if (!enabledProxies) {
        // If no settings, all are enabled by default
        return getM3U8ProxyUrls().map((_, index) => index);
      }

      const enabledMap = JSON.parse(enabledProxies);
      return getM3U8ProxyUrls()
        .map((_, index) => index)
        .filter((index) => enabledMap[index.toString()] !== false);
    } catch {
      // If parsing fails, assume all are enabled
      return getM3U8ProxyUrls().map((_, index) => index);
    }
  }

  /**
   * Force refresh health status for all proxies
   */
  async refreshHealthStatus(): Promise<void> {
    const corsProxies = getProxyUrls();
    const m3u8Proxies = getM3U8ProxyUrls();

    // Test all proxies and update health status
    const corsResults = await this.testProxies(corsProxies);
    const m3u8Results = await this.testProxies(m3u8Proxies);

    // Update health managers with test results
    corsResults.forEach((result) => {
      if (result.success) {
        corsProxyHealthManager.markProxySuccess(
          result.url,
          result.responseTime,
        );
      } else {
        corsProxyHealthManager.markProxyFailed(result.url, result.error);
      }
    });

    m3u8Results.forEach((result) => {
      if (result.success) {
        m3u8ProxyHealthManager.markProxySuccess(
          result.url,
          result.responseTime,
        );
      } else {
        m3u8ProxyHealthManager.markProxyFailed(result.url, result.error);
      }
    });
  }

  /**
   * Get proxy statistics
   */
  static getProxyStats() {
    const corsHealth = ProxyManager.getCorsProxyHealth();
    const m3u8Health = ProxyManager.getM3U8ProxyHealth();

    return {
      cors: {
        total: corsHealth.length,
        healthy: corsHealth.filter((p: ProxyHealthStatus) => p.isHealthy)
          .length,
        unhealthy: corsHealth.filter((p: ProxyHealthStatus) => !p.isHealthy)
          .length,
        averageResponseTime:
          corsHealth.reduce(
            (sum: number, p: ProxyHealthStatus) => sum + (p.responseTime || 0),
            0,
          ) / corsHealth.length || 0,
      },
      m3u8: {
        total: m3u8Health.length,
        healthy: m3u8Health.filter((p: ProxyHealthStatus) => p.isHealthy)
          .length,
        unhealthy: m3u8Health.filter((p: ProxyHealthStatus) => !p.isHealthy)
          .length,
        averageResponseTime:
          m3u8Health.reduce(
            (sum: number, p: ProxyHealthStatus) => sum + (p.responseTime || 0),
            0,
          ) / m3u8Health.length || 0,
      },
    };
  }
}

// Export singleton instance
export const proxyManager = new ProxyManager();
export { ProxyManager };
