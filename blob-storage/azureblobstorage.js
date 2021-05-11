/*jshint esversion: 6 */
module.exports = function (RED) {

    var Client = require('azure-storage');
    var fs = require('fs');
    var path = require('path');
    var clientBlobService = null;
    var nodeConfig = null;

    var statusEnum = {
        disconnected: { color: "red", text: "Disconnected" },
        sending: { color: "yellow", text: "Sending" },
        sent: { color: "green", text: "Sent message" },
        error: { color: "grey", text: "Error" },
        receiving: { color: "yellow", text: "Receiving" },
        received: { color: "green", text: "Received message" },
        inOperation: { color: "blue", text: "In Operation" }
    };

    var setStatus = (node, status) => {
        node.status({ fill: status.color, shape: "dot", text: status.text });
    };

    var disconnectFrom = (node) => {
        if (clientBlobService) {
            node.log('Disconnecting from Azure');
            clientBlobService.removeAllListeners();
            clientBlobService = null;
            setStatus(node, statusEnum.disconnected);
        }
    };

    var createContainer = (node, containerName, blobservice, callback) => {
        // Create the container
        blobservice.createContainerIfNotExists(containerName, function (error) {
            if (error) {
                node.log(error);
            }
            else {
                node.log("Container '" + containerName + "' ready for blob creation");
                callback();
            }
        });
    }

    var uploadBlob = (node, file, blobService, containerName, blobName, callback) => {
        blobService.createBlockBlobFromLocalFile(containerName, blobName, file, function (error) {
            if (error) {
                node.log(error);
                callback(error);
            }

            callback();
        });
    }

    // Main function called by Node-RED    
    function AzureBlobStorage(config) {
        // Store node for further use        
        nodeConfig = config;
        var node = this;

        // Create the Node-RED node
        RED.nodes.createNode(this, config);
        let clientAccountName = this.credentials.accountname;
        let clientAccountKey = this.credentials.key;
        let clientContainerName = this.credentials.container;
        let clientBlobName = this.credentials.blob;

        var blobService = Client.createBlobService(clientAccountName, clientAccountKey);
        setStatus(node, statusEnum.inOperation);        

        this.on('input', function (msg) {
            if (!this.credentials.blob) {
                var nameObject = path.parse(msg.payload);
                clientBlobName = nameObject.base;
            }

            setStatus(node, statusEnum.sending);
            createContainer(node, clientContainerName, blobService, function () {
                uploadBlob(node, msg.payload, blobService, clientContainerName, clientBlobName, (error) => {
                    if (error) {
                        setStatus(node, statusEnum.error);
                        return;
                    }

                    let newMsg = {}
                    newMsg.payload = clientBlobName;
                    newMsg.containerName = clientContainerName;
                    newMsg.status = "OK";

                    node.send(newMsg);
                    setStatus(node, statusEnum.sent);
                });
            });
        });

        this.on('close', function () {
            disconnectFrom(this);
        });
    }

    function AzureBlobStorageDownload(config) {
        // Store node for further use
        var node = this;
        nodeConfig = config;

        // Create the Node-RED node
        RED.nodes.createNode(this, config);
        clientAccountName = node.credentials.accountname;
        clientAccountKey = node.credentials.key;
        clientContainerName = node.credentials.container;
        clientBlobName = node.credentials.blob;

        var blobservice = Client.createBlobService(clientAccountName, clientAccountKey);
        setStatus(node, statusEnum.inOperation);
        var destinationFile;

        this.on('input', function (msg) {
            setStatus(node, statusEnum.receiving);

            node.log("msg.payload " + msg.payload);
            if (msg.payload) {
                destinationFile = msg.payload;
            }
            else {
                const fileName = clientBlobName.replace('.txt', '.downloaded.txt');
                destinationFile = path.join(__dirname, fileName);
            }

            node.log("destinationFile " + destinationFile);
            downloadBlob(node, blobservice, clientContainerName, clientBlobName, destinationFile, (error) => {

                if (error) {
                    setStatus(node, statusEnum.error);
                    return;
                }

                node.log("Download completed!");
                let newMsg = {};
                //newMsg.payload = path.dirname(destinationFile);
                newMsg.payload = destinationFile;
                newMsg.blobName = clientBlobName;
                newMsg.status = "OK";

                node.send(newMsg);
                setStatus(node, statusEnum.received);
            });
        });

        this.on('close', function () {
            disconnectFrom(this);
        });
    }

    function downloadBlob(node, blobservice, containerName, blobName, fileName, callback) {
        node.log(containerName);
        node.log(blobName);
        node.log(fileName);
        blobservice.getBlobToLocalFile(containerName, blobName, fileName, function (error2) {
            if (error2) {
                node.log(error2);
                callback(error2);
            }

            callback();
        });
    }

    // Registration of the node into Node-RED
    RED.nodes.registerType("Aleph Save Blob", AzureBlobStorage, {
        credentials: {
            accountname: { type: "text" },
            key: { type: "text" },
            container: { type: "text" },
            blob: { type: "text" },
        },
        defaults: {
            name: { value: "Save in Blob Storage" },
        }
    });

    // Registration of the node into Node-RED to download
    RED.nodes.registerType("Aleph Get Blob", AzureBlobStorageDownload, {
        credentials: {
            accountname: { type: "text" },
            key: { type: "text" },
            container: { type: "text" },
            blob: { type: "text" },
        },
        defaults: {
            name: { value: "Get Blob Storage" },
        }
    });


    // Helper function to print results in the console
    function printResultFor(op) {
        return function printResult(err, res) {
            if (err) node.error(op + ' error: ' + err.toString());
            if (res) node.log(op + ' status: ' + res.constructor.name);
        };
    }
};
