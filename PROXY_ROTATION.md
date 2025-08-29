# Proxy Rotation System

This document describes the enhanced proxy rotation system in p-stream that supports multiple proxies with automatic health checking, failover, and load balancing.

## Overview

The proxy rotation system provides:
- **Multiple Proxy Support**: Configure multiple CORS and M3U8 proxies
- **Automatic Health Checking**: Continuous monitoring of proxy health
- **Load Balancing**: Round-robin rotation with performance-based sorting
- **Failover**: Automatic switching to healthy proxies when others fail
- **Retry Logic**: Automatic retries with exponential backoff
- **Management API**: Add, remove, test, and reorder proxies programmatically

## Configuration

### Environment Variables

Configure proxies in your `.env` file:

```bash
# Single CORS proxy
VITE_CORS_PROXY_URL=https://your-proxy.com

# Multiple CORS proxies (comma-separated)
VITE_CORS_PROXY_URL=https://proxy1.com,https://proxy2.com,https://proxy3.com

# Single M3U8 proxy
VITE_M3U8_PROXY_URL=https://your-m3u8-proxy.com

# Multiple M3U8 proxies (comma-separated)
VITE_M3U8_PROXY_URL=https://m3u8-proxy1.com,https://m3u8-proxy2.com
```

**Important**: Proxy URLs should NOT have a trailing slash.

### Advanced Proxy Configuration

You can also configure proxies with additional parameters using the pipe syntax:

```bash
# Proxy with type specification
VITE_CORS_PROXY_URL=|type=proxy|https://proxy1.com,|type=api|https://api-proxy.com
```

## Health Checking

### Automatic Health Monitoring

The system automatically monitors proxy health with:
- **Health Check Interval**: 30 seconds (configurable)
- **Timeout**: 5 seconds per health check
- **Failure Threshold**: 3 consecutive failures mark a proxy as unhealthy
- **Recovery**: Proxies are automatically re-enabled when they respond successfully

### Health Check Process

1. **Initial Check**: All proxies are assumed healthy initially
2. **Periodic Checks**: Health checks run every 30 seconds
3. **Failure Tracking**: Failed requests increment the failure counter
4. **Recovery**: Successful requests reset the failure counter and mark proxy as healthy

## Load Balancing

### Algorithm

The system uses a **performance-aware round-robin** algorithm:

1. **Health Filtering**: Only healthy proxies are considered
2. **Performance Sorting**: Proxies are sorted by response time (fastest first)
3. **Round-Robin**: Requests are distributed evenly across healthy proxies
4. **Random Start**: Initial proxy selection is randomized to distribute load

### Failover Behavior

- If no healthy proxies are available, the system falls back to using all configured proxies
- Failed requests automatically retry with different proxies (up to 3 attempts)
- Exponential backoff is applied between retry attempts (1s, 2s, 3s)

## Usage

### Basic Usage

The proxy rotation system works automatically once configured. No additional code changes are required for basic functionality.

### Programmatic Management

```typescript
import { proxyManager } from '@/utils/proxyManager';

// Test a single proxy
const result = await proxyManager.testProxy('https://proxy.example.com');
console.log('Proxy test result:', result);

// Test multiple proxies
const results = await proxyManager.testProxies([
  'https://proxy1.com',
  'https://proxy2.com'
]);

// Add a new CORS proxy
const added = proxyManager.addCorsProxy('https://new-proxy.com');

// Remove a CORS proxy
const removed = proxyManager.removeCorsProxy('https://old-proxy.com');

// Get health status
const corsHealth = proxyManager.getCorsProxyHealth();
const m3u8Health = proxyManager.getM3U8ProxyHealth();

// Get proxy statistics
const stats = proxyManager.getProxyStats();
console.log('Proxy stats:', stats);

// Force refresh health status
await proxyManager.refreshHealthStatus();
```

### M3U8 Proxy Management

```typescript
// Enable/disable M3U8 proxy by index
proxyManager.toggleM3U8Proxy(0, false); // Disable first M3U8 proxy
proxyManager.toggleM3U8Proxy(1, true);  // Enable second M3U8 proxy

// Get enabled M3U8 proxy indices
const enabledIndices = proxyManager.getEnabledM3U8ProxyIndices();
```

## Health Status Interface

```typescript
interface ProxyHealthStatus {
  url: string;              // Proxy URL
  isHealthy: boolean;       // Current health status
  lastChecked: number;      // Timestamp of last health check
  consecutiveFailures: number; // Number of consecutive failures
  responseTime?: number;    // Average response time in ms
  lastError?: string;       // Last error message (if any)
}
```

## Configuration Options

### Health Check Configuration

```typescript
interface ProxyHealthConfig {
  healthCheckInterval: number;    // Health check interval (default: 30000ms)
  maxConsecutiveFailures: number; // Failure threshold (default: 3)
  healthCheckTimeout: number;     // Health check timeout (default: 5000ms)
  retryDelay: number;            // Retry delay for failed proxies (default: 60000ms)
}
```

### Proxy Manager Configuration

```typescript
interface ProxyManagerConfig {
  testTimeout: number;      // Proxy test timeout (default: 10000ms)
  testEndpoint: string;     // Health check endpoint (default: '/health')
}
```

## Monitoring and Debugging

### Console Logging

The system provides detailed console logging:
- Proxy health status changes
- Failed requests and retry attempts
- M3U8 proxy setup and fallback behavior
- Health check results

### Health Status Monitoring

```typescript
// Monitor proxy health in real-time
setInterval(() => {
  const stats = proxyManager.getProxyStats();
  console.log('CORS Proxies:', `${stats.cors.healthy}/${stats.cors.total} healthy`);
  console.log('M3U8 Proxies:', `${stats.m3u8.healthy}/${stats.m3u8.total} healthy`);
}, 10000);
```

## Best Practices

### Proxy Selection

1. **Use Multiple Proxies**: Configure at least 2-3 proxies for redundancy
2. **Geographic Distribution**: Use proxies in different regions for better performance
3. **Reliable Providers**: Choose proxy providers with good uptime and performance
4. **Regular Testing**: Periodically test your proxy configuration

### Performance Optimization

1. **Monitor Response Times**: Use the health status to identify slow proxies
2. **Remove Failing Proxies**: Disable consistently failing proxies
3. **Load Distribution**: Ensure proxies can handle the expected load
4. **Health Check Frequency**: Adjust health check intervals based on your needs

### Error Handling

1. **Graceful Degradation**: The system falls back to any available proxy if all are marked unhealthy
2. **Retry Logic**: Failed requests are automatically retried with different proxies
3. **Error Logging**: Monitor console logs for proxy-related errors
4. **Fallback Strategy**: Always have a backup proxy configuration

## Troubleshooting

### Common Issues

1. **No Proxies Available**
   - Check your environment variable configuration
   - Ensure proxy URLs are valid and accessible
   - Verify network connectivity

2. **All Proxies Marked Unhealthy**
   - Check proxy server status
   - Verify health check endpoints are accessible
   - Review health check timeout settings

3. **Poor Performance**
   - Monitor proxy response times
   - Consider using proxies closer to your users
   - Adjust health check intervals

4. **M3U8 Proxy Issues**
   - Check M3U8 proxy configuration in localStorage
   - Verify M3U8 proxy URLs are correct
   - Test M3U8 proxies individually

### Debug Commands

```typescript
// Get detailed health status
console.log('CORS Health:', proxyManager.getCorsProxyHealth());
console.log('M3U8 Health:', proxyManager.getM3U8ProxyHealth());

// Test all proxies manually
await proxyManager.refreshHealthStatus();

// Check proxy statistics
console.log('Stats:', proxyManager.getProxyStats());
```

## Migration from Single Proxy

If you're migrating from a single proxy setup:

1. **Update Environment Variables**: Change from single URL to comma-separated URLs
2. **Test Configuration**: Verify all proxies are working
3. **Monitor Health**: Check proxy health status after deployment
4. **Gradual Rollout**: Consider testing with a subset of proxies first

## API Reference

See the TypeScript interfaces and classes in:
- `src/utils/proxyHealth.ts` - Health monitoring system
- `src/utils/proxyManager.ts` - Proxy management utilities
- `src/backend/providers/fetchers.ts` - Enhanced fetcher implementations

## Contributing

When contributing to the proxy rotation system:

1. **Maintain Backward Compatibility**: Ensure single proxy configurations still work
2. **Add Tests**: Include tests for new proxy management features
3. **Update Documentation**: Keep this documentation up to date
4. **Monitor Performance**: Ensure changes don't negatively impact performance