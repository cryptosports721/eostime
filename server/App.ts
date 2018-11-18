/// <reference path='./ClientConnection.ts' />
import Process = NodeJS.Process;
import Socket from "socket.io";
import {ClientConnection} from "./ClientConnection";
import {Config} from "./Config";
import {EosWatcher} from "./EosWatcher";
import {EosBlockchain} from "./EosBlockchain";
import {AuctionManager} from "./AuctionManager";
import {DBManager} from "./DBManager";


const process:Process = require('process');
const nodeStatic = require('node-static');
const http = require('http');
const sio = require('socket.io');

module App {

    export class Main {

        private sio:any = null;
        private eosBlockchain:EosBlockchain = null;
        private eosWatcher:EosWatcher = null;
        private auctionManager:AuctionManager = null;
        private dbManager:DBManager = null;
        private serverConfig:any = null;

        private updaters:any[] = [
            {
                actionType: "eosio.token::transfer",
                updater: (state, payload, blockInfo, context) => {
                    // TODO React to action (put in database)
                    /*
                        payload IS:
                        {
                          "transactionId": "2618221d8415df911c22ced29cfa584d5d6a2da0c86264cc0d0d6e305a25678c",
                          "actionIndex": 0,
                          "account": "eosio.token",
                          "name": "transfer",
                          "authorization": [
                            {
                              "actor": "eosgamez1234",
                              "permission": "active"
                            }
                          ],
                          "data": {
                            "from": "eosgamez1234",
                            "to": "eosgameztea2",
                            "quantity": "0.0098 EOS",
                            "memo": "bet_id : 5be1fb03cca0bd6029b92e19 eosgamez.io"
                          }
                        }

                        blockInfo IS:
                        {
                          "blockNumber": 23144669,
                          "blockHash": "016128ddf7b2d8de3ddc6c777f34265b2cb544b4eae9866203354314207844ef",
                          "previousBlockHash": "016128dc39a08a71cfd354651e2e067bedcb9d9ecd6fe0f11bd4e7902f15b69a",
                          "timestamp": "2018-11-07T01:35:17.500Z"
                        }
                    */
                    let transactionData = Config.safeProperty(payload, ["data"], null);
                    if (transactionData && transactionData.to == this.serverConfig.eostimeContract) {

                        // A transfer (bid) was seen on the main contract

                    }
                }
            },
        ];
        private effects:any[] = [
            {
                actionType: "eosio.token::transfer",
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
            let contractPrivateKey:string = process.env.PKEY_EOSTIMECONTR; // <string> this.getCliParam("-contractkey", false);
            let faucetPrivateKey:string = process.env.PKEY_EOSTIMEFAUCE; // <string> this.getCliParam("-faucetkey", false);
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
            const file = new nodeStatic.Server('public', { // bin is the folder containing our html, etc
                cache: 0,	// don't cache
                gzip: true	// gzip our assets
            });

            // create our server and listen on the specified port
            //
            const httpServer = http.createServer(function (request, response) {
                request.addListener('end', function () {
                    file.serve(request, response);
                });
                request.resume();
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
                        // this.eosWatcher = new EosWatcher(this.eosBlockchain.getConfig(), currentBlockNumber, this.updaters, this.effects, this.processedBlockCallback.bind(this), this.rollbackToCallback.bind(this));
                        // this.eosWatcher.run();

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
            return this.dbManager.setConfig("currentBlockNumber", blockNumber).then(() => {
                return this.auctionManager.processBlock(blockNumber, timestamp);
            });
        }

        /**
         * Watcher callback executed when we need to rollback to a previous block
         * @param {number} blockNumber
         * @returns {Promise<void>}
         */
        private rollbackToCallback(blockNumber:number):Promise<void> {
            console.log("rollbackToCallback(" + blockNumber.toString() + ")");
            return this.dbManager.setConfig("currentBlockNumber", blockNumber).then(() => {
                return this.auctionManager.rollbackToBlock(blockNumber);
            });
        }

        // ----------------------------------------------------------------------------
        // GENERIC PUBLIC APP-LEVEL STATIC FUNCTIONS
        // ----------------------------------------------------------------------------

    }

}

// Kick things off!
let app:App.Main = new App.Main();