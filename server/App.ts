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
import moment = require("moment");
import {EosWatcherCallbacks} from "./EosWatcherCallbacks";
import {DBNodeos} from "./DBNodeos";
import {DividendManager} from "./DividendManager";

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
        private dividendManager:DividendManager = null;
        private serverConfig:any = null;

        /**
         * Constructs our App
         * node App.js -port 4001 -devmode true -rollback 160000 -db mongodb://localhost:27017/eostime -username node_server -password <password> -contractkey
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

            // Grab startat
            let startat:string = <string> this.getCliParam("-startat", false);

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
                this.dividendManager = new DividendManager(this.dbManager, this.eosBlockchain);
                this.dividendManager.start();

                if (!startat) {
                    console.log("Missing parameter startat");
                    process.exit();
                }

                if (startat == "head") {
                    // Start at the current head block
                    return this.eosBlockchain.getInfo();
                } else {
                    if (startat == "last") {
                        // Start at the block stored in the database
                        return this.dbManager.getConfig("currentBlockNumber");
                    } else {
                        // Start at the block specified
                        return this.auctionManager.rollbackToBlock(parseInt(startat));
                    }
                }

            }).then((val:any) => {
                if (val && val.head_block_num) {
                    return Promise.resolve(val);
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

                        // See if we have a MongoDB for the nodeos blockchain (being fed by
                        // a local instance of NODEOS)
                        const nodeosDatabase:string = <string> process.env.NODEOS_MONGO_DATABASE;
                        if (nodeosDatabase) {
                            // We have a local NODEOS database we can use.
                            let dbNodeos:DBNodeos = new DBNodeos();
                            dbNodeos.init(nodeosDatabase).then(() => {
                                this.eosWatcher = new EosWatcher(eosEndpoint, currentBlockNumber, new EosWatcherCallbacks(this.dbManager, this.auctionManager), this.processedBlockCallback.bind(this), this.rollbackToCallback.bind(this), dbNodeos);
                                this.eosWatcher.run();
                            }).catch((err) => {
                                console.log("Could not open Nodeos DB");
                                console.log(err);
                                process.exit();
                            });
                        } else {
                            // Run our EOS blockchain watcher using nodeos endpoint as
                            // a history-capable node.
                            this.eosWatcher = new EosWatcher(eosEndpoint, currentBlockNumber, new EosWatcherCallbacks(this.dbManager, this.auctionManager), this.processedBlockCallback.bind(this), this.rollbackToCallback.bind(this), null);
                            this.eosWatcher.run();
                        }

                        // Use auction manager to poll the blockchain
                        // Todo REMOVE comment this before deploying to AWS
                        this.auctionManager.enablePolling(true);

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
                if (localThis.dividendManager) {
                    console.log("Stopping dividend payouts");
                    localThis.dividendManager.stop();
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
            if (blockNumber % 10000 === 0) {
                console.log("Processing block #: " + blockNumber.toString() + " @ " + moment().format());
            }
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