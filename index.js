const http = require("http");
const fs = require("fs");
const WebSocket = require("ws");
const cluster = require("cluster");
const os = require("os");
const osUtils = require("os-utils");

const cpus = os.cpus().length;
const port = 8080;
const index = fs.readFileSync("./index.html");

if (cluster.isMaster) {
    console.log(`Number of CPUs is ${cpus}`);
    console.log(`Master ${process.pid} is running`);
    let requests = 0;
    let childs = [];

    for (let i = 0; i < cpus; i++) {
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

    const handler = function (req, res) {
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

    process.on("message", (data) => {
        const cpuUsage = osUtils.cpuUsage();
        const memoryUsage = (os.totalmem() - os.freemem()) / os.totalmem() * 100;
        const metrics = {
            requests: data.requests,
            connections: activeConnections,
            cpu: cpuUsage * 100,
            memory: memoryUsage.toFixed(2),
            alert: data.requests > 1000 ? "High traffic!" : null
        };
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(metrics));
            }
        });
    });

    server.listen(port, () => {
        console.log(`Server running on port ${port}`);
    });
}
