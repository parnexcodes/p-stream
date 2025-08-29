interface ProxyHealthStatus {
  url: string;
  isHealthy: boolean;
  lastChecked: number;
  consecutiveFailures: number;
  responseTime?: number;
  lastError?: string;
}

interface ProxyHealthConfig {
  healthCheckInterval: number; // ms
  maxConsecutiveFailures: number;
  healthCheckTimeout: number; // ms
  retryDelay: number; // ms
}

const DEFAULT_CONFIG: ProxyHealthConfig = {
  healthCheckInterval: 30000, // 30 seconds
  maxConsecutiveFailures: 3,
  healthCheckTimeout: 5000, // 5 seconds
  retryDelay: 60000, // 1 minute
};

class ProxyHealthManager {
  private healthStatus = new Map<string, ProxyHealthStatus>();

  private config: ProxyHealthConfig;

  private healthCheckIntervals = new Map<string, NodeJS.Timeout>();

  constructor(config: Partial<ProxyHealthConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize health monitoring for a list of proxy URLs
   */
  initializeProxies(urls: string[]): void {
    // Remove monitoring for URLs no longer in the list
    for (const [url] of this.healthStatus) {
      if (!urls.includes(url)) {
        this.stopMonitoring(url);
      }
    }

    // Add monitoring for new URLs
    urls.forEach((url) => {
      if (!this.healthStatus.has(url)) {
        this.healthStatus.set(url, {
          url,
          isHealthy: true, // Assume healthy initially
          lastChecked: 0,
          consecutiveFailures: 0,
        });
        this.startMonitoring(url);
      }
    });
  }

  /**
   * Get healthy proxy URLs sorted by response time (fastest first)
   */
  getHealthyProxies(urls: string[]): string[] {
    const healthyProxies = urls
      .filter((url) => {
        const status = this.healthStatus.get(url);
        return status?.isHealthy !== false;
      })
      .map((url) => ({
        url,
        responseTime: this.healthStatus.get(url)?.responseTime || Infinity,
      }))
      .sort((a, b) => a.responseTime - b.responseTime)
      .map((proxy) => proxy.url);

    // If no healthy proxies, return all (fallback behavior)
    return healthyProxies.length > 0 ? healthyProxies : urls;
  }

  /**
   * Mark a proxy as failed and update its health status
   */
  markProxyFailed(url: string, error?: string): void {
    const status = this.healthStatus.get(url);
    if (!status) return;

    status.consecutiveFailures += 1;
    status.lastError = error;
    status.lastChecked = Date.now();

    if (status.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      status.isHealthy = false;
      console.warn(
        `Proxy ${url} marked as unhealthy after ${status.consecutiveFailures} failures`,
      );
    }
  }

  /**
   * Mark a proxy as successful and update its health status
   */
  markProxySuccess(url: string, responseTime?: number): void {
    const status = this.healthStatus.get(url);
    if (!status) return;

    status.isHealthy = true;
    status.consecutiveFailures = 0;
    status.lastChecked = Date.now();
    status.responseTime = responseTime;
    status.lastError = undefined;
  }

  /**
   * Perform health check on a specific proxy
   */
  private async performHealthCheck(url: string): Promise<void> {
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.healthCheckTimeout,
    );

    try {
      // Simple health check - try to reach the proxy with a basic request
      const response = await fetch(`${url}/health`, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "User-Agent": "p-stream-health-check",
        },
      });

      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      if (response.ok || response.status === 404) {
        // 404 is acceptable for health checks as the proxy might not have a /health endpoint
        this.markProxySuccess(url, responseTime);
      } else {
        this.markProxyFailed(url, `HTTP ${response.status}`);
      }
    } catch (error) {
      clearTimeout(timeoutId);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.markProxyFailed(url, errorMessage);
    }
  }

  /**
   * Start monitoring a proxy URL
   */
  private startMonitoring(url: string): void {
    if (this.healthCheckIntervals.has(url)) {
      return; // Already monitoring
    }

    // Perform initial health check
    this.performHealthCheck(url);

    // Set up periodic health checks
    const interval = setInterval(() => {
      this.performHealthCheck(url);
    }, this.config.healthCheckInterval);

    this.healthCheckIntervals.set(url, interval);
  }

  /**
   * Stop monitoring a proxy URL
   */
  private stopMonitoring(url: string): void {
    const interval = this.healthCheckIntervals.get(url);
    if (interval) {
      clearInterval(interval);
      this.healthCheckIntervals.delete(url);
    }
    this.healthStatus.delete(url);
  }

  /**
   * Get health status for all monitored proxies
   */
  getHealthStatus(): ProxyHealthStatus[] {
    return Array.from(this.healthStatus.values());
  }

  /**
   * Clean up all monitoring
   */
  destroy(): void {
    for (const [url] of this.healthStatus) {
      this.stopMonitoring(url);
    }
  }
}

// Global instances for different proxy types
const corsProxyHealthManager = new ProxyHealthManager();
const m3u8ProxyHealthManager = new ProxyHealthManager();

export { ProxyHealthManager, corsProxyHealthManager, m3u8ProxyHealthManager };
export type { ProxyHealthStatus, ProxyHealthConfig };
