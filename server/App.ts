/// <reference path='./ClientConnection.ts' />
import Process = NodeJS.Process;
import Socket from "socket.io";
import {ClientConnection} from "./ClientConnection";
import {Config} from "./Config";
import {EosWatcher} from "./EosWatcher";
import {EosBlockchain} from "./EosBlockchain";
import {AuctionManager} from "./AuctionManager";
import {DBManager} from "./DBManager";
import {ClientSession, MongoClient} from "mongodb";

const process:Process = require('process');
const serveStatic = require('serve-static')
const fh = require('finalhandler');
const http = require('http');
const sio = require('socket.io');

const md5 = require('md5');

module App {

    export class Main {

        private sio:any = null;
        private eosBlockchain:EosBlockchain = null;
        private eosWatcher:EosWatcher = null;
        private auctionManager:AuctionManager = null;
        private dbManager:DBManager = null;
        private serverConfig:any = null;

        private transactionMap:any = {};

        private updaters:any[] = [
            {
                actionType: "eosio.token::transfer",
                updater: async (state, payload, blockInfo, context) => {

                    let txFunc:(client:MongoClient, session:ClientSession) => void = async (client:MongoClient, session:ClientSession) => {
                        let from: string = Config.safeProperty(payload, ["data.from"], null);
                        let to: string = Config.safeProperty(payload, ["data.to"], null);
                        if (from == "eostimecontr" || to == "eostimecontr") {
                            let hash: string = Config.safeProperty(payload, ["transactionId"], null);
                            if (hash) {
                                hash = md5(hash + payload.hex_data);
                                payload["timestamp"] = blockInfo.timestamp;
                                payload["blockNumber"] = blockInfo.blockNumber;
                                payload["md5"] = hash;
                                try {
                                    await this.auctionManager.eosTransfer("eostimecontr", payload, session);
                                    await this.dbManager.setConfig("currentBlockNumber", blockInfo.blockNumber, session);
                                    console.log(blockInfo.blockNumber);
                                } catch (err) {
                                    if ((err.code != 11000) || (err.errmsg.indexOf(hash) < 0)) {
                                        console.log(err);
                                    }
                                };
                            } else {
                                console.log("======= NO TRANSACTION HASH ON EOSIO.TOKEN::TRANSFER");
                            }
                        }
                    };
                    return this.dbManager.executeTransaction(txFunc);
                }
            },
            {
                actionType: "eostimetoken::issue",
                updater: async (state, payload, blockInfo, context) => {
                    let txFunc:(client:MongoClient, session:ClientSession) => void = async (client:MongoClient, session:ClientSession) => {
                        let hash: string = Config.safeProperty(payload, ["transactionId"], null);
                        if (hash) {
                            hash = md5(hash + payload.hex_data);
                            let to: string = Config.safeProperty(payload, ["data.to"], null);

                            // We only record issue's to the eostimetoken contract because
                            // everyone else gets included in the eostimetoken:transfer action
                            if (to == "eostimetoken") {
                                payload["timestamp"] = blockInfo.timestamp;
                                payload["blockNumber"] = blockInfo.blockNumber;
                                payload["md5"] = hash;
                                payload.data["from"] = null;
                                try {
                                    await this.auctionManager.timeTokenIssued(payload, session);
                                    await this.dbManager.setConfig("currentBlockNumber", blockInfo.blockNumber, session);
                                } catch (err) {
                                    if ((err.code != 11000) || (err.errmsg.indexOf(hash) < 0)) {
                                        console.log(err);
                                    }
                                }
                            }
                        } else {
                            console.log("======= NO TRANSACTION HASH ON EOSTIMETOKEN::ISSUE");
                        }
                    };
                    return this.dbManager.executeTransaction(txFunc);
                }
            },
            {
                actionType: "eostimetoken::transfer",
                updater: async (state, payload, blockInfo, context) => {
                    let txFunc:(client:MongoClient, session:ClientSession) => void = async (client:MongoClient, session:ClientSession) => {
                        let hash: string = Config.safeProperty(payload, ["transactionId"], null);
                        if (hash) {
                            hash = md5(hash + payload.hex_data);
                            payload["timestamp"] = blockInfo.timestamp;
                            payload["blockNumber"] = blockInfo.blockNumber;
                            payload["md5"] = hash;
                            let from: string = Config.safeProperty(payload, ["data.from"], null);
                            if (from == "eostimetoken") {
                                payload.data.from = null;
                            }
                            try {
                                await this.auctionManager.timeTokenIssued(payload, session);
                                await this.dbManager.setConfig("currentBlockNumber", blockInfo.blockNumber, session);
                            } catch (err) {
                                if ((err.code != 11000) || (err.errmsg.indexOf(hash) < 0)) {
                                    console.log(err);
                                }
                            }
                        } else {
                            console.log("======= NO TRANSACTION HASH ON EOSTIMETOKEN::TRANSFER");
                        }
                    };
                    return this.dbManager.executeTransaction(txFunc);
                }
            },
            {
                actionType: "eostimecontr::rzpaywinner",
                updater: async (state, payload, blockInfo, context) => {
                    let txFunc:(client:MongoClient, session:ClientSession) => void = async (client:MongoClient, session:ClientSession) => {
                        let hash: string = Config.safeProperty(payload, ["transactionId"], null);
                        if (hash) {
                            hash = md5(hash + payload.hex_data);
                            payload["timestamp"] = blockInfo.timestamp;
                            payload["blockNumber"] = blockInfo.blockNumber;
                            payload["md5"] = hash;

                            // console.log("================================== " + hash);
                            // console.log("RZPAYWINNER by eostimecontr");
                            // console.log(payload);
                            // console.log("==================================");
                            //
                            // // TODO - move this to eosio.token payment when memo has auction ID in it
                            // this.auctionManager.updateAuction(payload).catch((err) => {
                            //     if ((err.code != 11000) || (err.errmsg.indexOf(hash) < 0)) {
                            //         console.log(err);
                            //     }
                            // });

                        } else {
                            console.log("======= NO TRANSACTION HASH ON EOSTIMECONTR::RZPAYWINNER");
                        }
                    };
                    // return this.dbManager.executeTransaction(txFunc);
                }
            },
            {
                actionType: "eostimecontr::rzbidreceipt",
                updater: async (state, payload, blockInfo, context) => {
                    let txFunc: (client: MongoClient, session: ClientSession) => void = async (client: MongoClient, session: ClientSession) => {
                        let hash: string = Config.safeProperty(payload, ["transactionId"], null);
                        if (hash) {
                            hash = md5(hash + payload.hex_data);
                            payload["timestamp"] = blockInfo.timestamp;
                            payload["blockNumber"] = blockInfo.blockNumber;
                            payload["md5"] = hash;
                            this.auctionManager.bidReceipt(payload, session).then(() => {
                                return this.dbManager.setConfig("currentBlockNumber", blockInfo.blockNumber, session);
                            }).catch((err) => {
                                if ((err.code != 11000) || (err.errmsg.indexOf(hash) < 0)) {
                                    console.log(err);
                                }
                            });
                        } else {
                            console.log("======= NO TRANSACTION HASH ON EOSTIMETOKEN::BIDRECEIPT");
                        }
                    };
                    return this.dbManager.executeTransaction(txFunc);
                }
            }
        ];
        private effects:any[] = [
            {
                actionType: "eostimetoken::transfer",
                effect: (state, payload, blockInfo, context) => {

                }
            }
        ];

        /**
         * Constructs our App
         * node App.js -port 4001 -devmode true -startwatchernow true -db mongodb://localhost:27017/eostime -username node_server -password <password> -contractkey
         */
        constructor() {

            // Grab our port
            let port:number = <number> this.getCliParam("-port", true);
            if (!port) {
                port = 4001;
            }

            // Grab our developer mode
            let developerMode:string = <string> this.getCliParam("-devmode", false);
            if (developerMode) {
                Config.DEVELOPER_MODE = developerMode.toUpperCase() == "TRUE";
            }

            // Grab startwatchernow
            let startWatcherNow:string|boolean = <string> this.getCliParam("-startwatchernow", false);
            startWatcherNow = startWatcherNow && (startWatcherNow == "true");

            // Grab private keys
            let contractPrivateKey:string = process.env.PKEY_EOSTIMECONTR;
            let faucetPrivateKey:string = process.env.PKEY_EOSTIMEFAUCE;
            let housePrivateKey:string = process.env.PKEY_EOSTIMEHOUSE;
            if (!contractPrivateKey || !faucetPrivateKey || !housePrivateKey) {
                console.log("Invalid EOS keys");
                process.exit();
            }

            let eosEndpoint:string = <string> this.getCliParam("-eosendpoint", false);
            if (!eosEndpoint) {
                eosEndpoint = Config.EOS_ENDPOINTS.localhost;
            } else {
                eosEndpoint = Config.safeProperty(Config.EOS_ENDPOINTS, [eosEndpoint], Config.EOS_ENDPOINTS.localhost);
            }

            // Create our file server config
            const serve:any = serveStatic(__dirname + '/public', {'index': ['index.html', 'index.htm']});

            // create our server and listen on the specified port
            //
            const httpServer = http.createServer(function (request, response) {
                serve(request, response, fh(request, response));
            }).listen(port);

            this.sio = sio({"transports": ["websocket"]});
            this.sio.serveClient(true); // the server will serve the client js file
            this.sio.attach(httpServer);

            const db:string = <string> process.env.MONGO_DATABASE;
            const username:string = <string> process.env.MONGO_USERNAME;
            const password:string = <string> process.env.MONGO_PASSWORD;
            if (db && password && password) {
                this.dbManager = new DBManager();
            } else {
                console.log("Cannot connect to database");
                process.exit();
            }

            // Open the database then start the EOS blockchain watcher
            this.dbManager.openDbConnection(db, username, password).then((result) => {
                return this.dbManager.getConfig("serverConfig");
            }).then((serverConfig:any) => {
                this.serverConfig = serverConfig;

                this.eosBlockchain = new EosBlockchain(eosEndpoint, this.serverConfig, contractPrivateKey, faucetPrivateKey, housePrivateKey);

                this.auctionManager = new AuctionManager(this.serverConfig, this.sio, this.dbManager, this.eosBlockchain);

                if (startWatcherNow) {
                    return this.eosBlockchain.getInfo();
                } else {
                    return this.dbManager.getConfig("currentBlockNumber");
                }
            }).then((val:any) => {
                let currentBlockNumber:number = null;
                if (val) {
                    if (typeof val == "number") {
                        currentBlockNumber = val;
                    } else {
                        currentBlockNumber = Config.safeProperty(val, ["head_block_num"], null);
                    }
                    if (currentBlockNumber != null) {

                        // Run our EOS blockchain watcher
                        this.eosWatcher = new EosWatcher(eosEndpoint, currentBlockNumber, this.updaters, this.effects, this.processedBlockCallback.bind(this), this.rollbackToCallback.bind(this));
                        this.eosWatcher.run();

                        // Use auction manager to poll the blockchain
                        // Todo REMOVE comment this before deploying to AWS
                        // this.auctionManager.enablePolling(true);

                        // Finally, attach event handlers
                        this.attachEventHandlers();
                    }
                }
                if (currentBlockNumber == null) {
                    console.log("Could not resolve currentBlockNumber");
                    process.exit();
                }

            }).catch((err) => {
                console.log("Could not open eostime database and start the EOS blockchain watcher");
                console.log(err.message);
                process.exit();
            });
        }

        // ----------------------------------------------------------------------------
        // LOCAL UTILITY FUNCTIONS
        // ----------------------------------------------------------------------------

        /**
         * Attaches our event handlers
         */
        private attachEventHandlers() : void {

            // Listen for clients connecting
            //
            this.sio.on('connect', (socket:Socket.Socket) => {

                // Spawn new EOS client connection manager for this socket
                new ClientConnection(socket, this.dbManager, this.auctionManager, () => {return this.eosBlockchain});

            });

            // ============================================================================
            // Handle termination of our process
            // ============================================================================

            // Catch exit event
            let localThis:Main = this;
            process.on('exit', function () {

                for (let i:number = 0; i < ClientConnection.CONNECTIONS.length; i++) {
                    let cc:ClientConnection = ClientConnection.CONNECTIONS[i];
                    let accountInfo:any = cc.getAccountInfo();
                    if (accountInfo) {
                        console.log("Connection with [" + accountInfo.account_name + "] terminated");
                    }
                }
                if (localThis.dbManager) {
                    console.log("Disconnecting from database");
                    localThis.dbManager.closeDbConnection();
                }
                console.log("EOSRoller Server Exit");

            });

            // catch ctrl+c event and exit normally
            process.on('SIGINT', function () {
                console.log('Ctrl-C...');
                process.exit(2);
            });

            //catch uncaught exceptions, trace, then exit normally
            process.on('uncaughtException', function (e) {
                console.log('Uncaught Exception...');
                console.log(e.stack);
                process.exit(99);
            });
        }

        /**
         * Reads parameters from the command line
         *
         * @param paramName
         * @param isNumber
         * @param defaultValue
         * @returns {number | string}
         */
        private getCliParam(paramName, isNumber, defaultValue:any = null): number | string {
            for (var i: number = 0; i < process.argv.length; i++) {
                var val: string = process.argv[i];
                if (val == paramName) {
                    var nextArgIdx = i + 1;
                    if (nextArgIdx < process.argv.length) {
                        if (isNumber) {
                            var val: string = process.argv[nextArgIdx];
                            var valNum: number = parseInt(val);
                            if (!isNaN(valNum)) {
                                return valNum;
                            } else {
                                return defaultValue;
                            }
                        } else {
                            return process.argv[nextArgIdx];
                        }
                    }
                }
            }
            return defaultValue;
        }

        /**
         * Watcher callback executed on each block processed
         * @param {number} blockNumber
         * @returns {Promise<void>}
         */
        private processedBlockCallback(blockNumber:number, timestamp:string):Promise<void> {
            return this.auctionManager.processBlock(blockNumber, timestamp);
        }

        /**
         * Watcher callback executed when we need to rollback to a previous block
         * @param {number} blockNumber
         * @returns {Promise<void>}
         */
        private rollbackToCallback(blockNumber:number):Promise<void> {
            console.log("rollbackToCallback(" + blockNumber.toString() + ")");
            return this.auctionManager.rollbackToBlock(blockNumber).catch((err) => {
                console.log(err);
            });
        }

        // ----------------------------------------------------------------------------
        // GENERIC PUBLIC APP-LEVEL STATIC FUNCTIONS
        // ----------------------------------------------------------------------------

    }

}

// Kick things off!
let app:App.Main = new App.Main();