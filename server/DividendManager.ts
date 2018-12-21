import {DBManager} from "./DBManager";
import {EosBlockchain} from "./EosBlockchain";
import {Config} from "./Config";
import {AggregationCursor} from "mongodb";
import {Decimal128} from "bson";
import {EosRpcMongoHistoryBuilder} from "./EosRpcMongoHistoryBuilder";
import moment = require("moment");

var schedule = require('node-schedule');

export class DividendManager {

    private jobRunning:boolean = false;
    private dbManager:DBManager;
    private eosBlockchain:EosBlockchain;
    private eosRpcMongoHistory:EosRpcMongoHistoryBuilder;
    private notificationCallback:(data:any) => void;

    private job:any = null;

    constructor(dbManager:DBManager, eosBlockchain:EosBlockchain, eosRpcMongoHistory:EosRpcMongoHistoryBuilder, notificationCallback:(data:any) => void = null) {
        this.dbManager = dbManager;
        this.eosBlockchain = eosBlockchain;
        this.eosRpcMongoHistory = eosRpcMongoHistory;
        this.notificationCallback = notificationCallback;
    }

    public start():void {
        // this.dividendPayoutFunction();
        if (!this.job) {
            // Create our recurrence rule
            let rule:any = new schedule.RecurrenceRule();
            for (let key in Config.DIVIDEND_PAYOUT_SCHEDULE) {
                rule[key] = Config.DIVIDEND_PAYOUT_SCHEDULE[key];
            }
            this.job = schedule.scheduleJob(rule, this.dividendPayoutFunction.bind(this));
        }
    }

    public async stop(retryCount:number = 20):Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (!this.jobRunning) {
                if (this.job) {
                    this.job.cancel();
                    this.job = null;
                }
                resolve();
            } else {
                // Wait for currently running DB operation to complete (max of 10 seconds)
                if (retryCount > 0) {
                    setTimeout(() => {
                        this.stop(retryCount - 1);
                    }, 500);
                } else {
                    reject();
                }
            }
        });
    }

    public currentDividendPool():Promise<number> {
        return this.eosBlockchain.getBalance(Config.eostimeDividendContract);
    }

    public getDividendInfo():Promise<any> {

        return new Promise((resolve:any) => {
            this.currentDividendPool().then((result:any) => {
                let toRet:any = {
                    dividendPool: parseFloat(result[0]),
                    nextPayout: 0
                }
                if (this.job) {
                    toRet.nextPayout = Math.floor(this.job.nextInvocation().getTime()/1000);
                }
                resolve(toRet);
            });
        });

    }

    private dividendPayoutFunction():void {

        this.jobRunning = true;

        let mintedTimeTokenMatch:any = {
            "$match" : {
                "$or" : [
                    {
                        "account" : "eostimetoken",
                        "name" : "transfer",
                        "from" : "eostimetoken"
                    },
                    {
                        "account" : "eostimetoken",
                        "name" : "issue",
                        "to" : "eostimetoken"
                    }
                ]
            }
        };

        let thirdPartyTransfersMatch:any = {
            "$match" : {
                "$and" : [
                    { "account": "eostimetoken", "name": "transfer" },
                    { "from": {$ne: "eostimetoken"}}
                ]
            }
        }

        let pipeline:any[] = [
            {
                "$project" : {
                    "to" : "$to",
                    "from" : "$from",
                    "quantityAsString" : {
                        "$toString" : "$quantity"
                    }
                }
            },
            {
                "$project" : {
                    "to" : "$to",
                    "from" : "$from",
                    "quantitySplit" : {
                        "$split" : [
                            "$quantityAsString",
                            " "
                        ]
                    }
                }
            },
            {
                "$project" : {
                    "to" : "$to",
                    "from" : "$from",
                    "trimmedQuantity" : {
                        "$arrayElemAt" : [
                            "$quantitySplit",
                            0.0
                        ]
                    }
                }
            },
            {
                "$project" : {
                    "to" : "$to",
                    "from" : "$from",
                    "decimalQuantity" : {
                        "$toDecimal" : "$trimmedQuantity"
                    }
                }
            },
            {
                "$group" : {
                    "_id" : {
                        "to" : "$to",
                        "from" : "$from"
                    },
                    "total" : {
                        "$sum" : "$decimalQuantity"
                    }
                }
            }
        ];

        this.eosBlockchain.getInfo().then((blockchainInfo:any) => {

            let headBlockTime:number = parseInt(moment( blockchainInfo.head_block_time + "+00:00").local().format("X"));
            let minutesBehind:number = (headBlockTime - this.eosRpcMongoHistory.getBlockTimestamp())/60;
            if (minutesBehind < 5.0) {
                this.dbManager.getDocuments("users", {}, {}, 100000).then((results) => {

                    // Create a map of existing users
                    let existingAccounts:any = {"eostimecorpo": true, "eostimetoken": true};
                    for (let user of results) {
                        existingAccounts[user.accountName] = true;
                    }

                    pipeline.unshift(mintedTimeTokenMatch);
                    this.dbManager.aggregation("eostimetoken", pipeline).then((cursor: AggregationCursor) => {

                        cursor.toArray().then(async (timeHolders: any[]) => {

                            let dividendBalanceArr: any[] = await this.eosBlockchain.getBalance(Config.eostimeDividendContract);
                            let dividendBalance = parseFloat(dividendBalanceArr[0]);
                            if (dividendBalance > 0) {
                                let historyState: any = await this.dbManager.getConfig("historyState");
                                if (!historyState) {
                                    historyState = {
                                        eostimetoken: 0,
                                        eostimecontr: 0,
                                        eostimehouse: 0
                                    }
                                }

                                let newDividendPaymentDocument: any = {
                                    timestamp: Math.floor(new Date().getTime() / 1000),
                                    timeTokenSupply: 0,
                                    dividendBalance: dividendBalance,
                                    actionSequenceNumber: historyState.eostimetoken - 1,
                                    paymentState: "pending",
                                    accounts: {}
                                };

                                for (let timeHolder of timeHolders) {

                                    // We only pay dividends to TIME holders who have visited our site
                                    if (existingAccounts[timeHolder._id["to"]]) {
                                        let account: any = {
                                            timeTokens: parseFloat(timeHolder.total.toString()),
                                            eos: 0,
                                            paymentState: "pending",
                                            transactionId: null
                                        }
                                        newDividendPaymentDocument.timeTokenSupply += account.timeTokens;

                                        // eostimecorpo is the destination account for corporate dividends
                                        if (timeHolder._id["to"] == "eostimetoken") {
                                            timeHolder._id["to"] = "eostimecorpo";
                                        }

                                        newDividendPaymentDocument.accounts[timeHolder._id["to"]] = account;
                                    }
                                }

                                // Now we need to aggregate third party transfers and account for them
                                pipeline.shift();
                                pipeline.unshift(thirdPartyTransfersMatch);
                                this.dbManager.aggregation("eostimetoken", pipeline).then((cursor: AggregationCursor) => {
                                    cursor.toArray().then(async (thirdPartyTransfers: any[]) => {

                                        // Loop through our third party transactions and account for
                                        // them in our newDividendPaymentDocument
                                        for (let tpt of thirdPartyTransfers) {
                                            if (existingAccounts[tpt._id.to]) {
                                                let debit: any = newDividendPaymentDocument.accounts[tpt._id.from];
                                                let credit: any = newDividendPaymentDocument.accounts[tpt._id.to];
                                                let tokens: number = parseFloat(tpt.total.toString());
                                                if (debit && credit) {
                                                    debit.timeTokens -= tokens;
                                                    credit.timeTokens += tokens;
                                                }
                                            }
                                        }

                                        // Calculate dividend payouts
                                        for (let key in newDividendPaymentDocument.accounts) {
                                            let account: any = newDividendPaymentDocument.accounts[key];
                                            account.proportion = account.timeTokens / newDividendPaymentDocument.timeTokenSupply;
                                            account.distribution = parseFloat((account.proportion * newDividendPaymentDocument.dividendBalance).toFixed(4));
                                        }

                                        // Apply rounding error to the eostimecorpo account
                                        let distributedSum:number = 0.0;
                                        for (let key in newDividendPaymentDocument.accounts) {
                                            let account: any = newDividendPaymentDocument.accounts[key];
                                            distributedSum += account.distribution;
                                        }
                                        let delta:number = newDividendPaymentDocument.dividendBalance - distributedSum;
                                        delta = parseFloat(delta.toFixed(4));
                                        let corpoAccount:any = newDividendPaymentDocument.accounts["eostimecorpo"];
                                        corpoAccount.distribution += delta;

                                        // Save our final distribution record
                                        await this.dbManager.insertDocument("dividends", newDividendPaymentDocument);

                                        // Pay the dividends from contract balance
                                        this.payDividends();
                                    });
                                }).catch((err) => {
                                    console.log("Error paying out dividends - prior to blockchain payout");
                                    console.log(err);
                                    this.jobRunning = false;
                                });
                            } else {
                                // No dividend to distribute at this time.
                                if (this.notificationCallback !== null) {
                                    let dividendInfo:any = await this.getDividendInfo();
                                    this.notificationCallback(dividendInfo);
                                }
                                this.jobRunning = false;
                                let friendlyTime:string = moment().format("dddd, MMMM Do YYYY, h:mm:ss a");
                                console.log("No dividends to distribute at " + friendlyTime);
                            }
                        }).catch((err) => {
                            console.log("Error paying out dividends - prior to blockchain payout");
                            console.log(err);
                            this.jobRunning = false;
                        });

                    }).catch((err) => {
                        console.log("Error paying out dividends - prior to blockchain payout");
                        console.log(err);
                        this.jobRunning = false;
                    });
                }).catch((err) => {
                    console.log("Error finding existing users in database - prior to blockchain payout");
                    console.log(err);
                    this.jobRunning = false;
                });
            } else {
                console.log("Not processing dividends because we are " + minutesBehind + " minutes behind in scraping history");
                this.jobRunning = false;
            }

        });

    }

    /**
     * Pays out the
     * @param dividendPaymentDocument
     */
    private payDividends():void {
        let document:any = null;
        this.dbManager.getDocuments("dividends", {paymentState: {"$in" : ["pending", "processing"]}}, {timestamp: -1}, 100).then(async (documents:any[]) => {
            if (documents.length > 0) {
                document = documents[0];
                let filter:any = {
                    "_id" : document["_id"]
                };
                await this.dbManager.updateDocumentByKey("dividends", filter, {"paymentState": "processing"});
                for (let key in document.accounts) {
                    let account:any = document.accounts[key];
                    if ((account.eos === 0) && (account.distribution > 0) && (account.paymentState == "pending")) {
                        let fieldName:string = "accounts." + key + ".paymentState";
                        let newValues:any = {};
                        newValues[fieldName] = account.paymentState = "processing";
                        await this.dbManager.updateDocumentByKey("dividends", filter, newValues);

                        // This is the payment happeningon the blockchain!
                        let memo:string = "eostime.io dividend payment ID:" + document["_id"];
                        await this.eosBlockchain.dividendPayout(key, account.distribution, memo);
                        console.log("Paid " + key + " " + memo);

                        newValues[fieldName] = account.paymentState = "paid";
                        newValues["accounts." + key + ".eos"] = account.distribution;
                        await this.dbManager.updateDocumentByKey("dividends", filter, newValues);
                    }
                }
                await this.dbManager.updateDocumentByKey("dividends", filter, {"paymentState": "paid"});

                if (this.notificationCallback !== null) {
                    let dividendInfo:any = await this.getDividendInfo();
                    this.notificationCallback(dividendInfo);
                }
                this.jobRunning = false;
            }
        }).catch((err) => {
            let documentId:any = (document !== null) ? document["_id"] : "null";
            console.log("Error in payDividends(" + documentId + "): ");
            console.log(err);
            this.jobRunning = false;
        });
    }


}