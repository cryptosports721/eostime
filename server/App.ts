import Process = NodeJS.Process;
import Socket from "socket.io";
import {ClientConnection} from "./ClientConnection";
import {Config} from "./Config";
import {EosWatcher} from "./EosWatcher";
import {EosBlockchain} from "./EosBlockchain";
import {AuctionManager} from "./AuctionManager";
import {DBManager} from "./DBManager";
import moment = require("moment");
import {DividendManager} from "./DividendManager";
import {SocketMessage} from "./SocketMessage";
import {TransactionLinkManager} from "./TransactionLinkManager";
import {FaucetManager} from "./FaucetManager";
import {ConnectionOptions} from "typeorm";
import {DBMysql} from "./DBMysql";
import {EosRpcMySqlHistoryBuilder} from "./EosRpcMySqlHistoryBuilderd";
import {HarpoonManager} from "./HarpoonManager";

const process:Process = require('process');
const serveStatic = require('serve-static')
const fh = require('finalhandler');
const http = require('http');
const sio = require('socket.io');
const ecc = require('eosjs-ecc');

const md5 = require('md5');

module App {

    export class Main {

        private sio:any = null;
        private eosBlockchain:EosBlockchain = null;
        private auctionManager:AuctionManager = null;
        private dbManager:DBManager = null;
        private dbMysql:DBMysql = null;
        private faucetManager:FaucetManager = null;
        private dividendManager:DividendManager = null;
        private historyBuilder:EosRpcMySqlHistoryBuilder = null;
        private serverConfig:any = null;
        private slackHook:string = null;

        /**
         * Constructs our App
         * node App.js -port 4001 -devmode true -rollback 160000 -db mongodb://localhost:27017/eostime -username node_server -password <password> -contractkey
         */
        constructor() {

            // TODO remove this was here just to debug
            // let signature = ecc.sign('I love Katya', "5J9fgyKAchBCLHnQ91JajZR7ahuH1M1TcwaWsYFJ7aLpCZpBCPQ");

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

            // Grab private keys
            let contractPrivateKey:string = process.env.PKEY_EOSTIMECONTR;
            let faucetPrivateKey:string = process.env.PKEY_EOSTIMEFAUCE;
            let housePrivateKey:string = process.env.PKEY_EOSTIMEHOUSE;
            if (!contractPrivateKey || !faucetPrivateKey || !housePrivateKey) {
                console.log("Invalid EOS keys");
                process.exit();
            }
            let serverKey:string = process.env.PKEY_SERVERKEY;
            if (typeof serverKey == "undefined") {
                console.log("Missing PKEY_SERVERKEY");
                process.exit();
            }

            // Grab the slack hooks
            let auctionSlackHook:string = process.env.AUCTION_SLACK_HOOK;
            if (typeof auctionSlackHook == "undefined") {
                auctionSlackHook = null;
            }
            let dividendSlackHook:string = process.env.DIVIDEND_SLACK_HOOK;
            if (typeof dividendSlackHook == "undefined") {
                dividendSlackHook = null;
            }
            this.slackHook = process.env.ERROR_SLACK_HOOK;
            if (typeof this.slackHook != "undefined") {
                this.slackHook = null;
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
                console.log("Cannot connect to MONGO database");
                process.exit();
            }

            // Open our MySql database
            const mysqlHost:string = <string> process.env.MYSQL_HOST;
            const mysqlUsername:string = <string> process.env.MYSQL_USERNAME;
            const mysqlPassword:string = <string> process.env.MYSQL_PASSWORD;
            const mysqlDatabase:string = <string> process.env.MYSQL_DATABASE;
            if (mysqlHost && mysqlUsername && mysqlPassword && mysqlDatabase) {
                const conn: ConnectionOptions = {
                    type: "mysql",
                    host: mysqlHost,
                    port: 3306,
                    username: mysqlUsername,
                    password: mysqlPassword,
                    database: mysqlDatabase,
                    entities: [
                        __dirname + "/entities/*.js"
                    ],
                    synchronize: true,
                }
                this.dbMysql = new DBMysql(conn);
            } else {
                console.log("Cannot connect to MYSQL database - are environment variables set?");
                process.exit();
            }

            const historyEndpoint:string = <string> process.env.HISTORY_RPC_ENDPOINT;
            if (!historyEndpoint) {
                console.log("No history RPC endpoint specified - please define HISTORY_RPC_ENDPOINT environment var");
                process.exit();
            }

            // Open the database then start the EOS blockchain watcher
            this.dbManager.openDbConnection(db, username, password).then((result) => {
                return this.dbMysql.connect();
            }).then(async (mysqlConnected:boolean) => {
                if (mysqlConnected) {
                    let serverConfigString = await this.dbMysql.getConfig("serverConfig");
                    this.serverConfig = JSON.parse(serverConfigString);
                    this.faucetManager = new FaucetManager(this.dbManager, this.dbMysql,() => {return this.eosBlockchain;});
                    this.eosBlockchain = new EosBlockchain(eosEndpoint, this.serverConfig, contractPrivateKey, faucetPrivateKey, housePrivateKey);
                    this.auctionManager = new AuctionManager(this.serverConfig, this.sio, this.dbManager, this.dbMysql, serverKey, this.eosBlockchain, auctionSlackHook);
                    this.dividendManager = new DividendManager(this.dbManager, this.dbMysql, this.eosBlockchain, dividendSlackHook, this.updateDividendCallback.bind(this));
                    this.historyBuilder = new EosRpcMySqlHistoryBuilder(historyEndpoint, this.dbMysql);
                    this.historyBuilder.start();


                    let processDividends:string = process.env.PROCESS_DIVIDENDS;
                    if ((typeof processDividends != "undefined") && (processDividends.toLowerCase() == "true")) {
                        this.dividendManager.start();
                    }

                    // this.transactionLinkManager = new TransactionLinkManager(this.dbManager, this.updateDividendCallback.bind(this), this.auctionManager.winnerPayoutTransaction.bind(this.auctionManager));
                    // this.transactionLinkManager.start();

                    // Use auction manager to poll the blockchain
                    let pollAuctions:string = process.env.POLL_AUCTIONS;
                    if ((typeof pollAuctions != "undefined") && (pollAuctions.toLowerCase() == "true")) {
                        await this.auctionManager.enablePolling(true);
                    }

                    // Finally, attach event handlers
                    this.attachEventHandlers();

                } else {
                    // Could not connect to MySql database
                    process.exit();
                }

            }).catch((err) => {
                console.log("Could not open eostime database and start the EOS blockchain watcher");
                console.log(err.message);
                console.log(err);
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
                new ClientConnection(socket, this.dbManager, this.dbMysql, this.auctionManager, this.dividendManager, this.faucetManager,() => {return this.eosBlockchain});

            });

            // ============================================================================
            // Handle termination of our process
            // ============================================================================

            // Catch exit event
            let localThis:Main = this;
            process.on('exit', async function () {

                try {
                    for (let i: number = 0; i < ClientConnection.CONNECTIONS.length; i++) {
                        let cc: ClientConnection = ClientConnection.CONNECTIONS[i];
                        let accountInfo: any = cc.getAccountInfo();
                        if (accountInfo) {
                            console.log("Connection with [" + accountInfo.account_name + "] terminated");
                        }
                    }
                    if (localThis.dividendManager) {
                        console.log("Stopping dividend payouts");
                        await localThis.dividendManager.stop();
                    }
                    // if (localThis.transactionLinkManager) {
                    //     console.log("Stopping transaction link manager");
                    //     await localThis.transactionLinkManager.stop();
                    // }
                    if (localThis.dbManager) {
                        console.log("Disconnecting from NODEOS database");
                        localThis.dbManager.closeDbConnection();
                    }
                    if (localThis.dbMysql) {
                        console.log("Disconnecting from MYSQL database");
                        localThis.dbMysql.close();
                    }
                } catch (err) {
                    console.log("Failed to exit gracefully")
                    console.log(err);
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
         * Called after a dividend payout
         * @param data
         */
        private updateDividendCallback(dividendInfo:any = null):void {
            if (dividendInfo === null) {
                this.dividendManager.getDividendInfo().then((dividendInfo:any) => {
                    let data: any = {...dividendInfo, ...SocketMessage.standardServerDataObject()};
                    this.sio.sockets.emit(SocketMessage.STC_DIVIDEND_INFO, JSON.stringify(data));
                });
            } else {
                let data: any = {...dividendInfo, ...SocketMessage.standardServerDataObject()};
                this.sio.sockets.emit(SocketMessage.STC_DIVIDEND_INFO, JSON.stringify(data));
            }
        }

        // ----------------------------------------------------------------------------
        // GENERIC PUBLIC APP-LEVEL STATIC FUNCTIONS
        // ----------------------------------------------------------------------------

    }

}

// Kick things off!
let app:App.Main = new App.Main();