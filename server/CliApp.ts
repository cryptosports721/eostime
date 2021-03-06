import {DBManager} from "./DBManager";
import {DividendManager} from "./DividendManager";
import {EosBlockchain} from "./EosBlockchain";
import {FaucetManager} from "./FaucetManager";
import {Config} from "./Config";
import moment = require("moment");
import {DBMysql} from "./DBMysql";
import {ConnectionOptions} from "typeorm";
import {ClientConnection} from "./ClientConnection";
import {EosRpcMySqlHistoryBuilder} from "./EosRpcMySqlHistoryBuilderd";
import {AuctionManager} from "./AuctionManager";
import {HarpoonManager} from "./HarpoonManager";
import {bid} from "./entities/bid";
import {auctions} from "./entities/auctions";
import {serverSeeds} from "./entities/serverSeeds";

const readline = require('readline');
const crypto = require('crypto');

module CliApp {

    export class Main {

        private dbManager:DBManager = null;
        private dbMysql:DBMysql = null;
        private dividendManager:DividendManager = null;
        private eosBlockchain:EosBlockchain = null;
        private clientConnection:ClientConnection = null;
        private faucetManager:FaucetManager = null;
        private historyManager:EosRpcMySqlHistoryBuilder = null;
        private auctionManager:AuctionManager = null;
        private rl:any = null;

        private stdinListeners:((string) => void)[] = new Array<(string) => void>();

        constructor() {

            // Grab private keys
            let contractPrivateKey:string = process.env.PKEY_EOSTIMECONTR;
            let faucetPrivateKey:string = process.env.PKEY_EOSTIMEFAUCE;
            let housePrivateKey:string = process.env.PKEY_EOSTIMEHOUSE;
            if (!contractPrivateKey || !faucetPrivateKey || !housePrivateKey) {
                console.log("Invalid EOS keys");
                process.exit();
            }

            const db:string = <string> process.env.MONGO_DATABASE;
            const username:string = <string> process.env.MONGO_USERNAME;
            const password:string = <string> process.env.MONGO_PASSWORD;
            if (db && password && password) {
                this.dbManager = new DBManager();
            } else {
                console.log("Cannot connect to database");
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

            let eosEndpoint:string = <string> this.getCliParam("-eosendpoint", false);
            if (!eosEndpoint) {
                eosEndpoint = Config.EOS_ENDPOINTS.localhost;
            } else {
                eosEndpoint = Config.safeProperty(Config.EOS_ENDPOINTS, [eosEndpoint], Config.EOS_ENDPOINTS.localhost);
            }

            const historyEndpoint:string = <string> process.env.HISTORY_RPC_ENDPOINT;
            if (!historyEndpoint) {
                console.log("No history RPC endpoint specified - please define HISTORY_RPC_ENDPOINT environment var");
                process.exit();
            }

            this.dbManager.openDbConnection(db, username, password).then((result) => {
                return this.dbManager.getConfig("serverConfig");
            }).then(async (serverConfig:any) => {
                this.eosBlockchain = new EosBlockchain(eosEndpoint, serverConfig, contractPrivateKey, faucetPrivateKey, housePrivateKey);
                this.dividendManager = new DividendManager(this.dbManager, this.dbMysql, this.eosBlockchain, null, null);

                return this.dbMysql.connect();
            }).then(async (mysqlConnected:boolean) => {
                if (mysqlConnected) {
                    let serverConfigString:string = await this.dbMysql.getConfig("serverConfig");
                    let serverConfig:any = JSON.parse(serverConfigString);
                    this.faucetManager = new FaucetManager(this.dbManager, this.dbMysql,() => {return this.eosBlockchain});
                    this.clientConnection = new ClientConnection(null, this.dbManager, this.dbMysql, null, this.dividendManager, this.faucetManager, () => {return this.eosBlockchain});
                    this.historyManager = new EosRpcMySqlHistoryBuilder(historyEndpoint, this.dbMysql);
                    let hm:HarpoonManager = new HarpoonManager(null, this.dbMysql, "");
                    this.auctionManager = new AuctionManager(serverConfig, null, null, this.dbMysql,null, this.eosBlockchain, null);

                    // Our outer menu listener
                    const menuListener = async function (data: string) {
                        if (data != "\n") {
                            data = data.toLowerCase();
                            switch (data) {
                                case "a":
                                    await this.dividendManager.dividendPayoutFunction(false);
                                    break;
                                case "b":
                                    await this.dividendManager.payDividends(this.verifyFunction.bind(this));
                                    break;
                                case "c":
                                    await this.transferFromHouseToContr();
                                    break;
                                case "d":
                                    await this.listTimeTransactions();
                                    break;
                                case "e":
                                    process.exit();
                                    break;
                                case "f":
                                    let dividendInfo:any = await this.dividendManager.getDividendInfo();
                                    console.log("\n=======\n");
                                    console.log(dividendInfo);
                                    console.log("\n=======\n");
                                    break;
                                case "g":

                                    let has:string = crypto.createHash('sha256').update("072b1fc2-d121-d9cb-2fd4-3fa902a12677").digest("hex");
                                    let rnd:string = crypto.createHash('sha512').update("79561072b1fc2-d121-d9cb-2fd4-3fa902a12677").digest("hex");
                                    // let account:user = await this.clientConnection.registerClientAccount({account_name: "rockthecasba", core_liquid_balance: "0.7902 EOS", timeBalance: "5.2207 TIME"}, "chassettny11");
                                    // let faucetInfo:any = await this.faucetManager.getFaucetInfo("chassettny11", "127.0.0.1");
                                    // let award:any = await this.faucetManager.faucetDraw("chassettny11", "127.0.0.1");

                                    // let hm:HarpoonManager = new HarpoonManager(this.dbMysql, "");
                                    // var sha512 = crypto.createHash('sha512').update('mystring').digest("hex");
                                    // console.log(bids);

                                    let bids:any[] = [
                                        {accountName: "A"},
                                        {accountName: "B"},
                                        {accountName: "C"},
                                        {accountName: "D"},
                                        {accountName: "C"},
                                        {accountName: "B"},
                                        {accountName: "A"},
                                        {accountName: "F"},
                                        {accountName: "C"},
                                        {accountName: "F"},
                                        {accountName: "G"},
                                        {accountName: "B"},
                                        {accountName: "C"}
                                    ];
                                    let c:any[] = await this.auctionManager.oddsFromBids(0, bids, 0.2);
                                    let s:number = 0;
                                    let o:number = 1;
                                    for (let key in c) {
                                        let a:any = c[key];
                                        if (a.odds > 0) {
                                            o *= (1- a.odds);
                                        }
                                    }
                                    console.log(c);

                                    bids = [
                                        {accountName: "A"},
                                        {accountName: "B"},
                                        {accountName: "C"}
                                    ];
                                    c = await this.auctionManager.oddsFromBids(0, bids, 0.2);
                                    o = 1;
                                    for (let key in c) {
                                        let a:any = c[key];
                                        if (a.odds > 0) {
                                            o *= (1 - a.odds);
                                        }
                                    }
                                    console.log(c);

                                    bids = [
                                        {accountName: "A"}
                                    ];
                                    c = await this.auctionManager.oddsFromBids(0, bids, 0.2);
                                    o = 1;
                                    for (let key in c) {
                                        let a:any = c[key];
                                        if (a.odds > 0) {
                                            o *= (1 - a.odds);
                                        }
                                    }
                                    console.log(c);

                                    bids = [
                                        {accountName: "A"},
                                        {accountName: "B"}
                                    ];
                                    c = await this.auctionManager.oddsFromBids(0, bids, 0.2);
                                    o = 1;
                                    for (let key in c) {
                                        let a:any = c[key];
                                        if (a.odds > 0) {
                                            o *= (1 - a.odds);
                                        }
                                    }
                                    console.log(c);

                                    bids = [
                                        {accountName: "A"},
                                        {accountName: "B"},
                                        {accountName: "C"},
                                        {accountName: "D"},
                                        {accountName: "E"},
                                        {accountName: "F"},
                                        {accountName: "G"},
                                        {accountName: "H"},
                                        {accountName: "I"},
                                        {accountName: "J"},
                                        {accountName: "K"},
                                        {accountName: "L"},
                                        {accountName: "M"},
                                        {accountName: "N"},
                                        {accountName: "O"},
                                        {accountName: "P"},
                                        {accountName: "Q"},
                                        {accountName: "R"},
                                        {accountName: "S"},
                                        {accountName: "T"}
                                    ];
                                    c = await this.auctionManager.oddsFromBids(0, bids, 0.2);
                                    o = 1;
                                    for (let key in c) {
                                        let a:any = c[key];
                                        if (a.odds > 0) {
                                            o *= (1 - a.odds);
                                        }
                                    }
                                    console.log(c);

                                    break;
                                case "h":
                                    await this.dividendManager.payDividends();
                                    break;
                                case "i":
                                    await this.historyManager.start();
                                    break;
                                case "j":
                                    await this.historyManager.stop();
                                    break;
                            }
                            this.outputMenu();
                        }
                    }.bind(this);
                    this.stdinListeners.push(menuListener);

                    // Set up our line reading interface for stdin
                    this.rl = readline.createInterface({
                        input: process.stdin,
                        output: process.stdout,
                        terminal: false
                    });
                    this.rl.on('line', (line: string) => {
                        let listener: (string) => void = this.stdinListeners[this.stdinListeners.length - 1];
                        listener(line);
                    });

                    // Process user input
                    // process.stdin.setRawMode(true);
                    process.stdin.on("keypress", menuListener);
                    this.outputMenu();
                } else {
                    console.log("Cannot open mysql database");
                    process.exit();
                }
            }).catch((err) => {
                console.log("Error opening the database");
                console.log(err);
            })
        }

        private outputMenu():void {
            process.stdout.write("\n=====================================\n");
            process.stdout.write("a - Process dividends\n");
            process.stdout.write("b - Pay dividends\n");
            process.stdout.write("c - Transfer EOS from eostimehouse to eostimecontr\n");
            process.stdout.write("d - List TIME transactions for account\n");
            process.stdout.write("e - Exit\n");
            process.stdout.write("f - Get dividend info\n");
            process.stdout.write("g - code test\n");
            process.stdout.write("h - Pay dividends NO VERIFY!! \n");
            process.stdout.write("i - Start MySql history builder \n");
            process.stdout.write("j - Stop MySql history builder \n");
            process.stdout.write("=====================================\n");
            process.stdout.write("> ");
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
         * Prompts user for a boolean response (y returns true, anything else false)
         * @param {string} prompt
         * @returns {Promise<boolean>}
         */
        private verifyFunction(prompt:string):Promise<boolean> {

            return new Promise<boolean>((resolve, reject) => {
                const verifyListener = async function (data: string)  {
                    data = data.toLowerCase();
                    if (data != "\n") {
                        if (data == "y" || data == "n") {
                            this.stdinListeners.pop();
                            resolve(data == "y");
                        } else {
                            process.stdout.write("\n Please enter 'y' or 'n'\n\n");
                            process.stdout.write(prompt + " [y/n] ");
                        }
                    }
                }.bind(this);
                this.stdinListeners.push(verifyListener);
                process.stdout.write(prompt + " [y/n] ");
            });
        }

        private getLine(forceLowerCase:boolean = true):Promise<string> {
            return new Promise<string>((resolve, reject) => {
                let listener = async function(line) {
                    if (forceLowerCase) {
                        line = line.toLowerCase();
                    }
                    this.stdinListeners.pop();
                    resolve(line);
                }
                this.stdinListeners.push(listener.bind(this));
            });
        }

        private listTimeTransactions():Promise<void> {
            return new Promise<void>(async (resolve, reject) => {
               process.stdout.write("Enter account name: ");
               let accountName:string = await this.getLine(false);
               let filter:any = {
                   "blockNumber": {"$gte": 32977141},
                   "$or" : [
                       {
                           "name" : "transfer",
                           "to" : accountName
                       },
                       {
                           "name" : "transfer",
                           "from" : "accountName"
                       }
                   ]
               };
               let orderBy:any = {bidId: 1};
               let transactions:any[] = await this.dbManager.getDocuments("eostimetoken", filter, orderBy, 10000);
               let tracker:any = {
                   count: 0,
                   auctionId: 0
               }
               for (let transaction of transactions) {
                   let quantity:string[] = transaction.quantity.split(" ");
                   let amount:number = parseFloat(quantity[0]);
                   let friendlyTime:string = moment.unix(transaction.timestamp).format("dddd, MMMM Do YYYY, h:mm:ss a");

                   if (transaction.bidId == tracker.auctionId) {
                       tracker.count++;
                   } else {
                       tracker.count = 1;
                       tracker.bidId = transaction.bidId;
                   }

                   let output:string = transaction.auctionId + "," + transaction.bidId + "," + friendlyTime + "," + transaction.from + "," + transaction.to + "," + amount.toFixed(4) + "," + transaction.memo;
                   process.stdout.write(output + "\n");

               }
               resolve();
            });
        }

        private transferFromHouseToContr():Promise<void> {
            return new Promise<void>((resolve, reject) => {

                let amountToTransfer:number = null;
                let numberListener = async function(line){
                    line = line.toLowerCase();
                    if (amountToTransfer == null) {
                        amountToTransfer = parseFloat(line);
                        if (!isNaN(amountToTransfer)) {
                            process.stdout.write("Transfer " + amountToTransfer.toFixed(4) + " EOS from eostimehouse to eostimecontr? [y/n] ");
                        } else {
                            process.stdout.write("Please enter a valid number\n");
                            process.stdout.write("Enter the amount of EOS you wish to transfer: ");
                            amountToTransfer = null;
                        }
                    } else {
                        if (line == 'y') {
                            await this.eosBlockchain.dividendPayout("eostimecontr", amountToTransfer, "CLI transfer");
                        } else {
                            amountToTransfer = null;
                            process.stdout.write("Enter the amount of EOS you wish to transfer: ");
                        }
                        this.stdinListeners.pop();
                        resolve();
                    }
                };

                this.stdinListeners.push(numberListener.bind(this));
                process.stdout.write("Enter the amount of EOS you wish to transfer: ");
            });
        }
    }
}

// Kick things off!
let app:CliApp.Main = new CliApp.Main();