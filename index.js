const http = require("http");
const fs = require("fs"); // <-- CORRECTED: Import the 'fs' module
const WebSocket = require("ws");
const cluster = require("cluster");
const os = require("os");

const cpus = os.cpus().length;
const port = 8080;
const index = fs.readFileSync("./index.html"); // <-- CORRECTED: Use the imported 'fs' module

const STATS_INTERVAL = 1000; // 1 second

if (cluster.isMaster) {
  console.log(`✅ Number of CPUs is ${cpus}`);
  console.log(`🚀 Master ${process.pid} is running`);

  let workerStats = new Map();

  // Fork workers.
  for (let i = 0; i < cpus; i++) {
    const worker = cluster.fork();
    // Initialize stats for the new worker
    workerStats.set(worker.process.pid, {});
  }

  cluster.on("exit", (worker, code, signal) => {
    console.error(`🔻 Worker ${worker.process.pid} died. Code: ${code}, Signal: ${signal}`);
    // Optional: Restart the worker
    // cluster.fork();
  });

  cluster.on("message", (worker, msg) => {
    // Update the stats for the specific worker
    workerStats.set(worker.process.pid, msg);
  });

  // Aggregate and broadcast stats every second
  setInterval(() => {
    const aggregated = {
      rps: 0,
      activeConnections: 0,
      memoryRssMb: 0,
      cpuUsage: 0,
      maxEventLoopLagMs: 0,
    };

    let activeWorkers = 0;
    for (const stats of workerStats.values()) {
      if (Object.keys(stats).length === 0) continue; // Skip workers that haven't reported yet

      activeWorkers++;
      aggregated.rps += stats.requests;
      aggregated.activeConnections += stats.connections;
      aggregated.memoryRssMb += stats.memory.rss / 1024 / 1024; // Convert to MB
      aggregated.cpuUsage += stats.cpu;
      aggregated.maxEventLoopLagMs = Math.max(aggregated.maxEventLoopLagMs, stats.eventLoopLag);
    }
    
    // Calculate average CPU usage
    if (activeWorkers > 0) {
        aggregated.cpuUsage = aggregated.cpuUsage / activeWorkers;
    }

    // Broadcast the aggregated stats to all workers
    for (const id in cluster.workers) {
      cluster.workers[id].send(aggregated);
    }
  }, STATS_INTERVAL);

} else {
  // --- Worker Process ---
  console.log(`Worker ${process.pid} started`);

  let requestsHandled = 0;
  let lastCpuUsage = process.cpuUsage();
  let lastLagCheck = process.hrtime();
  let eventLoopLag = 0;

  // Measure Event Loop Lag
  setInterval(() => {
    const delta = process.hrtime(lastLagCheck);
    lastLagCheck = process.hrtime();
    // Calculate lag in ms: (total ns - expected ns) / 1,000,000
    eventLoopLag = ((delta[0] * 1e9 + delta[1]) - (STATS_INTERVAL * 1e6)) / 1e6;
  }, STATS_INTERVAL);


  const handler = function (req, res) {
    // Count every request
    requestsHandled++;
    res.setHeader("Content-Type", "text/html");
    res.end(index);
  };

  const server = http.createServer(handler);
  const wss = new WebSocket.Server({ server });

  // When the master sends the aggregated stats, broadcast them to all WebSocket clients
  process.on("message", (aggregatedStats) => {
    const data = JSON.stringify(aggregatedStats);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
  });

  // Send this worker's individual stats to the master process every second
  setInterval(() => {
    const newCpuUsage = process.cpuUsage();
    const elapsedTime = (newCpuUsage.user - lastCpuUsage.user) + (newCpuUsage.system - lastCpuUsage.system);
    lastCpuUsage = newCpuUsage;

    const stats = {
      requests: requestsHandled,
      connections: wss.clients.size,
      memory: process.memoryUsage(),
      // CPU usage as a percentage of one core over the interval
      cpu: (elapsedTime / (STATS_INTERVAL * 1000)) * 100,
      eventLoopLag: eventLoopLag > 0 ? eventLoopLag : 0,
    };
    
    process.send(stats);

    // Reset per-interval counters
    requestsHandled = 0;
  }, STATS_INTERVAL);

  server.listen(port, () => {
    console.log(`Worker ${process.pid} listening on port ${port}`);
  });
}
