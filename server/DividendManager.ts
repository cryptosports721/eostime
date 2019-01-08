import {DBManager} from "./DBManager";
import {EosBlockchain} from "./EosBlockchain";
import {Config} from "./Config";
import {AggregationCursor} from "mongodb";
import moment = require("moment");
import {DBMysql} from "./DBMysql";

const schedule = require('node-schedule');
const request = require('request');

export class DividendManager {

    private jobRunning:boolean = false;
    private dbManager:DBManager;
    private dbMysql:DBMysql;
    private eosBlockchain:EosBlockchain;
    private historyBlockPosition:() => number;
    private notificationCallback:(data:any) => void;
    private slackHook:string;

    private job:any = null;

    /**
     * Constructs our dividend manager
     * @param {DBManager} dbManager
     * @param {DBMysql} dbMysql
     * @param {EosBlockchain} eosBlockchain
     * @param {() => number} historyBlockPosition
     * @param {string} slackHook
     * @param {(data: any) => void} notificationCallback
     */
    constructor(dbManager:DBManager, dbMysql:DBMysql, eosBlockchain:EosBlockchain, historyBlockPosition:() => number = null, slackHook:string, notificationCallback:(data:any) => void = null) {
        this.dbManager = dbManager;
        this.dbMysql = dbMysql;
        this.eosBlockchain = eosBlockchain;
        this.historyBlockPosition = historyBlockPosition;
        this.slackHook = slackHook;
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
                    dividendPool: parseFloat(result[0]) * (1 - Config.HOUSE_PROFIT - Config.STAKERS_PROFIT),
                    nextPayout: 0
                }
                if (this.job) {
                    toRet.nextPayout = Math.floor(this.job.nextInvocation().getTime()/1000);
                }
                resolve(toRet);
            });
        });

    }

    /**
     * Calculates and optionally pays out the dividends
     *
     * @param {boolean} autoPayDividend
     * @returns {Promise<void>}
     */
    public dividendPayoutFunction(autoPayDividend:boolean = true):Promise<void> {

        return new Promise<void> ((resolve, reject) => {

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
                // {
                //     "$match" : {
                //         "blockNumber" : {
                //             "$gte" : 32977141.0
                //         }
                //     }
                // },
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

            let friendlyTime:string = moment().format("dddd, MMMM Do YYYY, h:mm:ss a");
            this.notifySlack("Paying dividends at " + friendlyTime);
            this.eosBlockchain.getInfo().then((blockchainInfo:any) => {

                let headBlockTime:number = parseInt(moment( blockchainInfo.head_block_time + "+00:00").local().format("X"));
                let minutesBehind:number = (this.historyBlockPosition != null) ? (headBlockTime - this.historyBlockPosition())/60 : 0;
                if (minutesBehind < 5.0) {
                    pipeline.unshift(mintedTimeTokenMatch);
                    this.dbManager.aggregation("eostimetoken", pipeline).then((cursor: AggregationCursor) => {
                        cursor.toArray().then(async (timeHolders: any[]) => {

                            let dividendBalanceArr: any[] = await this.eosBlockchain.getBalance(Config.eostimeDividendContract);
                            let originalDividendBalance = parseFloat(dividendBalanceArr[0]);
                            if (originalDividendBalance > 0) {

                                let houseProfit:number = originalDividendBalance*Config.HOUSE_PROFIT;
                                let stakersProfit:number = originalDividendBalance*Config.STAKERS_PROFIT;
                                let stakerPayments:any[] = new Array<any>();

                                // Calculate the staker's cut
                                let stakers:any = await this.dbManager.getConfig("stakers");
                                if (stakers) {
                                    let totalStaked:number = 0;
                                    for (let accountName in stakers) {
                                        totalStaked += stakers[accountName];
                                    }
                                    for (let accountName in stakers) {
                                        let amt:number = stakersProfit * stakers[accountName]/totalStaked;
                                        let stakerPayment:any = {
                                            "account": accountName,
                                            "amount": parseFloat(amt.toFixed(4))
                                        };
                                        stakerPayments.push(stakerPayment);
                                    }
                                } else {
                                    // House is staking 100%
                                    houseProfit += stakersProfit;
                                }

                                // Now let's round things to 4 digits
                                houseProfit = parseFloat(houseProfit.toFixed(4));
                                stakersProfit = 0;
                                for (let stakerPayment of stakerPayments) {
                                    stakersProfit += stakerPayment.amount;
                                }

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
                                    originalDividendBalance: originalDividendBalance,
                                    dividendBalance: originalDividendBalance - houseProfit - stakersProfit,
                                    actionSequenceNumber: historyState.eostimetoken - 1,
                                    paymentState: "pending",
                                    houseProfit: houseProfit,
                                    stakersProfit: stakersProfit,
                                    stakersPayments: stakerPayments,
                                    accounts: {}
                                };

                                for (let timeHolder of timeHolders) {
                                    let account: any = {
                                        accountName: timeHolder._id["to"],
                                        timeTokens: parseFloat(timeHolder.total.toString()),
                                        eos: 0,
                                        paymentState: "pending",
                                        transactionId: null
                                    }
                                    let key:string = timeHolder._id["to"].replace(/\./gi, "_");
                                    newDividendPaymentDocument.timeTokenSupply += account.timeTokens;
                                    newDividendPaymentDocument.accounts[key] = account;
                                }

                                // Now we need to aggregate third party transfers and account for them
                                pipeline.shift();
                                pipeline.unshift(thirdPartyTransfersMatch);
                                this.dbManager.aggregation("eostimetoken", pipeline).then((cursor: AggregationCursor) => {
                                    cursor.toArray().then(async (thirdPartyTransfers: any[]) => {

                                        try {
                                            // Loop through our third party transactions and account for
                                            // them in our newDividendPaymentDocument
                                            for (let tpt of thirdPartyTransfers) {
                                                let debit: any = newDividendPaymentDocument.accounts[tpt._id.from];
                                                let credit: any = newDividendPaymentDocument.accounts[tpt._id.to];
                                                let tokens: number = parseFloat(tpt.total.toString());
                                                if (debit) {
                                                    if (!credit) {
                                                        credit = {
                                                            accountName: tpt._id.to,
                                                            eos: 0,
                                                            paymentState: "pending",
                                                            timeTokens: 0,
                                                            transactionId: null
                                                        };
                                                        let key:string = tpt._id["to"].replace(/\./gi, "_");
                                                        newDividendPaymentDocument.accounts[key] = credit;
                                                    }
                                                    debit.timeTokens -= tokens;
                                                    credit.timeTokens += tokens;
                                                }
                                            }

                                            // Calculate dividend payouts
                                            for (let key in newDividendPaymentDocument.accounts) {
                                                let account: any = newDividendPaymentDocument.accounts[key];
                                                account.proportion = account.timeTokens / newDividendPaymentDocument.timeTokenSupply;
                                                account.distribution = parseFloat((account.proportion * newDividendPaymentDocument.dividendBalance).toFixed(4));
                                            }

                                            // Apply rounding error to the house profit account
                                            let distributedSum: number = newDividendPaymentDocument.houseProfit + newDividendPaymentDocument.stakersProfit;
                                            for (let key in newDividendPaymentDocument.accounts) {
                                                let account: any = newDividendPaymentDocument.accounts[key];
                                                distributedSum += account.distribution;
                                            }
                                            let delta: number = originalDividendBalance - distributedSum;
                                            delta = parseFloat(delta.toFixed(4));
                                            newDividendPaymentDocument.houseProfit += delta;

                                            // Save our final distribution record to MONGO DB
                                            await this.dbManager.insertDocument("dividends", newDividendPaymentDocument);

                                            // Save our final distribution record to MySQL DB
                                            await this.dbMysql.newDividendReceipt(newDividendPaymentDocument);

                                            // Save our final distribution record

                                            // Pay the dividends from contract balance if we are supposed to
                                            if (autoPayDividend) {
                                                await this.payDividends();
                                            } else {
                                                this.jobRunning = false;
                                                resolve();
                                            }
                                        } catch (err) {
                                            let message:string = "Unexpected error while processing dividends";
                                            if (err && err.message) {
                                                message += ": " + err.message;
                                            }
                                            console.log(message);
                                            console.log(err);
                                            this.notifySlack(message);
                                            console.log(err);
                                            this.jobRunning = false;
                                            reject();
                                        }
                                    });
                                }).catch((err) => {
                                    let message:string = "1 - Error paying out dividends - prior to blockchain payout";
                                    if (err && err.message) {
                                        message += ": " + err.message;
                                    }
                                    this.notifySlack(message);
                                    console.log(message);
                                    console.log(err);
                                    this.jobRunning = false;
                                    reject();
                                });
                            } else {
                                // No dividend to distribute at this time.
                                if (this.notificationCallback !== null) {
                                    let dividendInfo:any = await this.getDividendInfo();
                                    this.notificationCallback(dividendInfo);
                                }
                                let message:string = "No dividends to distribute at " + friendlyTime;
                                this.notifySlack(message);
                                console.log(message);
                                this.jobRunning = false;
                                resolve();
                            }
                        }).catch((err) => {
                            let message:string = "2 - Error paying out dividends - prior to blockchain payout";
                            if (err && err.message) {
                                message += ": " + err.message;
                            }
                            this.notifySlack(message);
                            console.log(message);
                            console.log(err);
                            this.jobRunning = false;
                            reject();
                        });

                    }).catch((err) => {
                        let message:string = "3 - Error paying out dividends - prior to blockchain payout";
                        if (err && err.message) {
                            message += ": " + err.message;
                        }
                        this.notifySlack(message);
                        console.log(message);
                        console.log(err);
                        this.jobRunning = false;
                        reject();
                    });

                } else {
                    let message:string = "Not processing dividends because we are " + minutesBehind + " minutes behind in scraping history";
                    this.notifySlack(message)
                    console.log(message);
                    this.jobRunning = false;
                    reject();
                }

            });

        });

    }

    /**
     * Pays out the dividend
     * @param {(prompt:string) => Promise<boolean>} verifyFunction
     * @returns {Promise<void>}
     */
    public payDividends(verifyFunction:(prompt:string) => Promise<boolean> = null):Promise<void> {
        return new Promise<void>((resolve, reject) => {

            let document:any = null;
            this.dbManager.getDocuments("dividends", {paymentState: {"$in" : ["pending", "processing"]}}, {timestamp: -1}, 100).then(async (documents:any[]) => {
                if (documents.length > 0) {
                    document = documents[0];
                    let filter:any = {
                        "_id" : document["_id"]
                    };
                    await this.dbManager.updateDocumentByKey("dividends", filter, {"paymentState": "processing"});

                    // Pay the house
                    let payHouse:boolean = true;
                    if (verifyFunction) {
                        payHouse = await verifyFunction("Pay eostimecorpo " + document.houseProfit + " EOS ?");
                    }
                    if (payHouse) {
                        try {
                            let memo: string = "eostime.io dividend payment ID:" + document["_id"];
                            let receipt:any = await this.eosBlockchain.dividendPayout("eostimecorpo", document.houseProfit, memo);
                            let newValues: any = {houseTransactionId: receipt.transaction_id};
                            await this.dbManager.updateDocumentByKey("dividends", filter, newValues);
                        } catch (err) {
                            let msg: string = "[" + document["_id"] + "] Error paying corporate account eostimecorpo " + document.houseProfit + " EOS dividend";
                            this.notifySlack(msg);
                            console.log(msg);
                            console.log(err);
                        }
                    }

                    // Pay the stakers
                    for (let stakerPayment of document.stakersPayments) {

                        let payStaker:boolean = true;
                        if (verifyFunction) {
                            payStaker = await verifyFunction("Pay STAKER " + stakerPayment.account + " " + stakerPayment.amount + " EOS ? ");
                        }
                        if (payStaker) {
                            try {
                                let memo: string = "eostime.io staking payment ID:" + document["_id"];
                                let receipt:any = await this.eosBlockchain.dividendPayout(stakerPayment.account, stakerPayment.amount, memo);
                            } catch (err) {
                                let msg: string = "[" + document["_id"] + "] Error paying staker " + stakerPayment.account + " " + stakerPayment.amount + " EOS staking payment";
                                this.notifySlack(msg);
                                console.log(msg);
                                console.log(err);
                            }
                        }
                    }

                    // Pay TIME token holders
                    for (let key in document.accounts) {
                        let account:any = document.accounts[key];
                        try {
                            if ((account.eos === 0) && (account.distribution > 0) && (account.paymentState == "pending")) {
                                let payAccount:boolean = true;
                                if (verifyFunction) {
                                    payAccount = await verifyFunction("Pay TIME holder " + account.accountName + " " + account.distribution + " EOS ? ");
                                }
                                if (payAccount) {
                                    let fieldName: string = "accounts." + key + ".paymentState";
                                    let newValues: any = {};
                                    newValues[fieldName] = account.paymentState = "processing";
                                    await this.dbManager.updateDocumentByKey("dividends", filter, newValues);

                                    // This is the payment happening on the blockchain!
                                    let memo: string = "eostime.io dividend payment ID:" + document["_id"];
                                    let accountName: string = account.accountName;
                                    let receipt:any = await this.eosBlockchain.dividendPayout(accountName, account.distribution, memo);

                                    try {
                                        newValues[fieldName] = account.paymentState = "paid";
                                        newValues["accounts." + key + ".eos"] = account.distribution;
                                        newValues["accounts." + key + ".transactionId"] = receipt.transaction_id;
                                        await this.dbManager.updateDocumentByKey("dividends", filter, newValues);
                                    } catch (err) {
                                        let message: string = "[" + document["_id"] + "] Paid " + key + " but did not update account record in database";
                                        if (err && err.message) {
                                            message += ": " + err.message;
                                        }
                                        this.notifySlack(message);
                                        console.log(message);
                                    }
                                }
                            }
                        } catch (err) {
                            let msg:string = "[" + document["_id"] + "] Error paying TIME token holder " + key + " " + account.distribution + " EOS dividend";
                            this.notifySlack(msg);
                            console.log(msg);
                            console.log(err);
                        }
                    }
                    await this.dbManager.updateDocumentByKey("dividends", filter, {"paymentState": "paid"});

                    if (this.notificationCallback !== null) {
                        let dividendInfo:any = await this.getDividendInfo();
                        this.notificationCallback(dividendInfo);
                    }
                    this.jobRunning = false;
                    resolve();
                }
            }).catch((err) => {
                let documentId:any = (document !== null) ? document["_id"] : "null";
                console.log("Error in payDividends(" + documentId + "): ");
                console.log(err);
                this.jobRunning = false;
                reject();
            });

        });
    }

    /**
     * Method will notify a slack integration with a message.
     * @param {string} message
     * @returns {Promise<void>}
     */
    private notifySlack(message:string):Promise<void> {
        if (this.slackHook) {
            return new Promise<void>((resolve, reject) => {
                request.post(
                    this.slackHook,
                    {json: {text: message}},
                    function (error, response, body) {
                        if (!error && response.statusCode == 200) {
                            resolve();
                        } else {
                            reject(error);
                        }
                    }
                );
            });
        } else {
            return Promise.resolve();
        }

    }


}