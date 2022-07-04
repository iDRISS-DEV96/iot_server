import {Process as process} from "node/process";

const app = require('express')();
const http = require('http').Server(app);
const {AttributeIds, OPCUAClient, TimestampsToReturn} = require("node-opcua");
const chalk = require("chalk");
const io = require('socket.io')(http, {
    cors: {
        origin: '*',
    }
});
const port = 3000;
//// OPC Variables and Endpoints:
const endpointUrl = "opc.tcp://D_A_T_A:53530/OCP/iot/";
const TempSensor = "ns=3;i=1001";
const VitesseSensor = "ns=3;i=1002";
const DebitSensor = "ns=3;i=1008";
const PertesSensor = "ns=3;i=1003";
let client, session, subscription;

////////// OPC  Client Connection Setup ////
async function createOPCUAClient(io) {
    client = OPCUAClient.create({
        endpointMustExist: false,
    });
    client.on("backoff", (retry) => {
        console.log("Retrying to connect to ", endpointUrl, " attempt ", retry);
    });
    console.log(" connecting to ", chalk.cyan(endpointUrl));
    await client.connect(endpointUrl);
    console.log(" connected to ", chalk.cyan(endpointUrl));

    session = await client.createSession();
    console.log(" session created".yellow);
    subscription = await session.createSubscription2({
        requestedPublishingInterval: 250,
        requestedMaxKeepAliveCount: 50,
        requestedLifetimeCount: 6000,
        maxNotificationsPerPublish: 1000,
        publishingEnabled: true,
        priority: 10,
    });

    subscription
        .on("keepalive", function () {
            console.log("keepalive....");
        })
        .on("terminated", function () {
            console.log(" TERMINATED ------------------------------>");
        });

    const TempToMonitor = {
        nodeId: TempSensor,
        attributeId: AttributeIds.Value,
    };
    const VitToMonitor = {
        nodeId: VitesseSensor,
        attributeId: AttributeIds.Value,
    };
    const PertesMonitor = {
        nodeId: PertesSensor,
        attributeId: AttributeIds.Value,
    };
    const DebitToMonitor = {
        nodeId: DebitSensor,
        attributeId: AttributeIds.Value,
    };
    const parameters = {
        samplingInterval: 100,
        discardOldest: true,
        queueSize: 100,
    };
    const monitoredVit = await subscription.monitor(
        VitToMonitor,
        parameters,
        TimestampsToReturn.Both
    );
    const monitoredDebit = await subscription.monitor(
        DebitToMonitor,
        parameters,
        TimestampsToReturn.Both
    );
    const monitoredPertes = await subscription.monitor(
        PertesMonitor,
        parameters,
        TimestampsToReturn.Both
    );
    const monitoredTemp = await subscription.monitor(
        TempToMonitor,
        parameters,
        TimestampsToReturn.Both
    );
/////////////// Send to the font-end App ///////////////////
    monitoredTemp.on("changed", (dataValue) => {
        io.sockets.emit("temperature", dataValue.value.value);
        io.sockets.emit("time", dataValue.serverTimestamp);
    });
    monitoredVit.on("changed", (dataValue) => {
        io.sockets.emit("vitesse", dataValue.value.value);
    });
    monitoredDebit.on("changed", (dataValue) => {
        io.sockets.emit("debit", {
            value: dataValue.value.value,
            timestamp: dataValue.serverTimestamp,
        });
    });
    monitoredPertes.on("changed", (dataValue) => {
        io.sockets.emit("pertes", dataValue.value.value);
    });
}

async function stopOPCUAClient() {
    if (subscription) await subscription.terminate();
    if (session) await session.close();
    if (client) await client.disconnect();
}
/////////////////////////// Starting The Server ////////////////////////
(async () => {
    try {
        // --------------------------------------------------------
        io.sockets.on("connection", function () {
            console.log('Socket: client connected');
        });

        createOPCUAClient(io);
        // --------------------------------------------------------
        http.listen(port, () => {
            console.log('Listening on port' + port);
        });

        // detect CTRL+C and close
        process.once("SIGINT", async () => {
            console.log("shutting down client");

            await stopOPCUAClient();
            console.log("Done");
            process.exit(0);
        });
    } catch (err) {
        console.log(chalk.red("Error" + err.message));
        console.log(err);
        process.exit(-1);
    }
})();
