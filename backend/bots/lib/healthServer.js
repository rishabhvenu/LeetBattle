// Health check HTTP server for bot service monitoring
'use strict';

const http = require('http');

/**
 * Create and start health check server
 * @param {Object} options - Server options
 * @param {number} options.port - Port to listen on
 * @param {Object} options.leadership - Leadership state object
 * @param {Function} options.getStats - Function to get bot deployment stats
 * @param {Object} options.circuitBreakers - Circuit breaker instances for monitoring
 * @returns {http.Server} HTTP server instance
 */
function createHealthServer(options) {
  const { port = 3000, leadership, getStats, circuitBreakers } = options;
  
  const server = http.createServer(async (req, res) => {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    
    if (req.url === '/health' && req.method === 'GET') {
      try {
        const stats = getStats ? await getStats() : {};
        const health = {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          leadership: {
            isLeader: leadership.isLeader,
            instanceId: require('./config').INSTANCE_ID,
            lastRenewal: leadership.lastRenewalAt || null
          },
          deployment: stats,
          circuitBreakers: circuitBreakers ? {
            queueStats: circuitBreakers.queueStats?.getState(),
            globalStats: circuitBreakers.globalStats?.getState(),
            activeMatches: circuitBreakers.activeMatches?.getState()
          } : {}
        };
        
        res.writeHead(200);
        res.end(JSON.stringify(health, null, 2));
      } catch (error) {
        console.error('Health check error:', error);
        res.writeHead(500);
        res.end(JSON.stringify({ 
          status: 'error', 
          error: error.message,
          timestamp: new Date().toISOString()
        }));
      }
    } else if (req.url === '/ready' && req.method === 'GET') {
      // Readiness check - is the service functional?
      const isReady = leadership.isLeader !== undefined;
      res.writeHead(isReady ? 200 : 503);
      res.end(JSON.stringify({
        ready: isReady,
        timestamp: new Date().toISOString()
      }));
    } else if (req.url === '/metrics' && req.method === 'GET') {
      // Prometheus-style metrics endpoint (placeholder for now)
      try {
        const stats = getStats ? await getStats() : {};
        const metrics = [];
        
        // Bot deployment metrics
        metrics.push(`# HELP bots_deployed_total Number of currently deployed bots`);
        metrics.push(`# TYPE bots_deployed_total gauge`);
        metrics.push(`bots_deployed_total ${stats.currentDeployed || 0}`);
        
        metrics.push(`# HELP bots_active_total Number of bots in active matches`);
        metrics.push(`# TYPE bots_active_total gauge`);
        metrics.push(`bots_active_total ${stats.currentActive || 0}`);
        
        metrics.push(`# HELP bots_queue_length Number of bots waiting in rotation queue`);
        metrics.push(`# TYPE bots_queue_length gauge`);
        metrics.push(`bots_queue_length ${stats.queueLength || 0}`);
        
        // Leadership metrics
        metrics.push(`# HELP bot_service_is_leader Whether this instance is the leader`);
        metrics.push(`# TYPE bot_service_is_leader gauge`);
        metrics.push(`bot_service_is_leader ${leadership.isLeader ? 1 : 0}`);
        
        // Circuit breaker metrics
        if (circuitBreakers) {
          const queueStatsState = circuitBreakers.queueStats?.getState();
          metrics.push(`# HELP circuit_breaker_state Circuit breaker state (0=CLOSED, 1=HALF_OPEN, 2=OPEN)`);
          metrics.push(`# TYPE circuit_breaker_state gauge`);
          const stateValue = queueStatsState?.state === 'OPEN' ? 2 : queueStatsState?.state === 'HALF_OPEN' ? 1 : 0;
          metrics.push(`circuit_breaker_state{endpoint="queue_stats"} ${stateValue}`);
          
          metrics.push(`# HELP circuit_breaker_failures Circuit breaker failure count`);
          metrics.push(`# TYPE circuit_breaker_failures gauge`);
          metrics.push(`circuit_breaker_failures{endpoint="queue_stats"} ${queueStatsState?.failureCount || 0}`);
        }
        
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
        res.end(metrics.join('\n') + '\n');
      } catch (error) {
        console.error('Metrics error:', error);
        res.writeHead(500);
        res.end(`# Error generating metrics: ${error.message}\n`);
      }
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });
  
  server.listen(port, () => {
    console.log(`[health] Health check server listening on port ${port}`);
    console.log(`[health] Endpoints: /health, /ready, /metrics`);
  });
  
  return server;
}

module.exports = {
  createHealthServer
};

