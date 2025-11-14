const http = require("http");
const fs = require("fs");
const WebSocket = require("ws");
const cluster = require("cluster");
const os = require("os");
const pidusage = require("pidusage");

// Simulated environment stats (for display only)
const TOTAL_CORES = os.cpus().length;
const TOTAL_RAM_GB = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
const TOTAL_REPLICAS = 50; // Simulated

const port = 8080;
const index = fs.readFileSync("./index.html");

if (cluster.isMaster) {
    console.log(`Number of CPUs is ${TOTAL_CORES}`);
    console.log(`Master ${process.pid} is running`);
    let requests = 0;
    let childs = [];

    for (let i = 0; i < TOTAL_CORES; i++) {
        let child = cluster.fork();
        child.on("message", (msg) => {
            if (msg === 0) requests++;
        });
        childs.push(child);
    }

    setInterval(() => {
        for (let child of childs) {
            child.send({ requests });
        }
        requests = 0;
    }, 1000);
} else {
    console.log(`Worker ${process.pid} started`);
    let activeConnections = 0;

    const handler = (req, res) => {
        if (req.url === "/dstat") {
            process.send(0);
            res.end("OK");
        } else {
            res.end(index);
        }
    };

    const server = http.createServer(handler);
    const wss = new WebSocket.Server({ server });

    wss.on("connection", () => {
        activeConnections++;
        console.log(`New connection. Total: ${activeConnections}`);
    });

    wss.on("close", () => {
        activeConnections--;
        console.log(`Connection closed. Total: ${activeConnections}`);
    });

    setInterval(() => {
        pidusage(process.pid, (err, stats) => {
            if (err) console.error(err);
            else {
                const memoryUsageGB = (stats.memory / 1024 / 1024).toFixed(2);
                const metrics = {
                    requests: 0, // Will be updated by master process
                    connections: activeConnections,
                    cpu: stats.cpu.toFixed(2),
                    ram: memoryUsageGB,
                    power: (Math.random() * 1000).toFixed(2), // Simulated power usage
                    totalCores: TOTAL_CORES,
                    totalRam: TOTAL_RAM_GB,
                    totalReplicas: TOTAL_REPLICAS,
                    alert: null // You can set alerts based on thresholds
                };
                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(metrics));
                    }
                });
            }
        });
    }, 1000);

    process.on("message", (data) => {
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    ...data,
                    totalCores: TOTAL_CORES,
                    totalRam: TOTAL_RAM_GB,
                    totalReplicas: TOTAL_REPLICAS
                }));
            }
        });
    });

    server.listen(port, () => {
        console.log(`Server running on port ${port}`);
    });
}
