import {DBManager} from "./DBManager";
import {EosBlockchain} from "./EosBlockchain";
import {Config} from "./Config";
import {AggregationCursor} from "mongodb";
import moment = require("moment");
import {DBMysql} from "./DBMysql";
import {QueryRunner} from "typeorm";
import {payment} from "./entities/payment";

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

    public currentDividendPool():Promise<any> {
        return this.eosBlockchain.getBalance(Config.eostimeDividendContract);
    }

    public async getDividendInfo():Promise<any> {

        return new Promise((resolve:any) => {
            this.eosBlockchain.getBalance(Config.eostimeContract).then((result:any) => {
                let currentContractBalance:number = parseFloat(result[0]);
                this.currentDividendPool().then((result:any) => {
                    let houseBalance:number = parseFloat(result[0]);
                    let topOff:number = Config.TOPOFF_MAIN_CONTRACT - currentContractBalance;
                    if (topOff < 0) {
                        topOff = 0;
                    }
                    if (topOff > houseBalance) {
                        topOff = houseBalance;
                    }
                    topOff = parseFloat(topOff.toFixed(4));
                    let toppedOffHouseBalance:number = houseBalance;
                    toppedOffHouseBalance -= topOff;
                    if (toppedOffHouseBalance < 0) {
                        toppedOffHouseBalance = 0;
                    }

                    let dividend:number =  toppedOffHouseBalance * (1 - Config.HOUSE_PROFIT - Config.STAKERS_PROFIT);
                    let toRet:any = {
                        mainBalance: currentContractBalance,
                        houseBalance: houseBalance,
                        topOff: topOff,
                        toppedOffHouseBalance: toppedOffHouseBalance,
                        dividendPool: dividend,
                        nextPayout: 0
                    }
                    if (this.job) {
                        toRet.nextPayout = Math.floor(this.job.nextInvocation().getTime()/1000);
                    }
                    resolve(toRet);
                });
            });
        });

    }

    /**
     * Assembles an array of existing time token holders
     * @returns {Promise<any>}
     */
    public getTimeTokenHolders():Promise<any> {

        return new Promise<any>(async (resolve, reject) => {

            try {
                let totalBalance: number = 0;
                let timeHolders: any[] = new Array<any>();

                // Async function to retrieve the next batch of token holders
                const getNext = async function (lowerBound: string = "") {
                    let result: any = await this.eosBlockchain.getTableByScope("eostimetoken", lowerBound, "", 100);
                    let rows: any[] = result.rows;
                    for (let timeTokenHolder of rows) {
                        if (timeTokenHolder.table == "accounts") {
                            let tt: any = await this.eosBlockchain.getTable("eostimetoken", "accounts", timeTokenHolder.scope);
                            if (tt.rows && tt.rows.length == 1) {
                                let balance: number = parseFloat(tt.rows[0]['balance'].split(" ")[0]);
                                let timeHolder: any = {accountName: timeTokenHolder.scope, balance: balance};
                                timeHolders.push(timeHolder);
                                totalBalance += balance;
                            }
                        }
                    }
                    if (result.more && result.more.length > 0) {
                        await getNext(result.more);
                    }
                }.bind(this);

                await getNext();
                resolve({timeHolders: timeHolders, totalBalance: totalBalance});

            } catch (err) {
                reject(err);
            }

        });
    };

    /**
     * Generates the database entries for a dividend payment.
     *
     * @param {boolean} autoPayDividend
     * @returns {Promise<void>}
     */
    public dividendPayoutFunction(autoPayDividend:boolean = true):Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            try {
                let dividendInfo: any = await this.getDividendInfo();
                let timeHolderData: any = await this.getTimeTokenHolders();
                let originalDividendBalance = dividendInfo.toppedOffHouseBalance;
                if (originalDividendBalance > 0) {

                    let houseProfit: number = originalDividendBalance * Config.HOUSE_PROFIT;
                    let stakersProfit: number = originalDividendBalance * Config.STAKERS_PROFIT;
                    let stakerPayments: any[] = new Array<any>();

                    // Calculate the staker's cut
                    let stakers: any = await this.dbManager.getConfig("stakers");
                    if (stakers) {
                        let totalStaked: number = 0;
                        for (let accountName in stakers) {
                            totalStaked += stakers[accountName];
                        }
                        for (let accountName in stakers) {
                            let amt: number = stakersProfit * stakers[accountName] / totalStaked;
                            let stakerPayment: any = {
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

                    let newDividendPaymentDocument: any = {
                        timestamp: Math.floor(new Date().getTime() / 1000),
                        timeTokenSupply: timeHolderData.totalBalance,
                        dividendInfo: dividendInfo,
                        originalDividendBalance: originalDividendBalance,
                        dividendBalance: originalDividendBalance - houseProfit - stakersProfit,
                        paymentState: "pending",
                        houseProfit: houseProfit,
                        stakersProfit: stakersProfit,
                        stakersPayments: stakerPayments,
                        accounts: {}
                    };

                    for (let timeHolder of timeHolderData.timeHolders) {
                        let account: any = {
                            accountName: timeHolder.accountName,
                            timeTokens: parseFloat(parseFloat(timeHolder.balance.toString()).toFixed(4)),
                            eos: 0,
                            paymentState: "pending",
                            transactionId: null
                        }
                        let key: string = timeHolder.accountName.replace(/\./gi, "_");
                        newDividendPaymentDocument.accounts[key] = account;
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

                    // Save our final distribution record to MySQL DB
                    await this.dbMysql.newDividendReceipt(newDividendPaymentDocument);

                    // Check the receipt
                    let totalToPayOut: number = newDividendPaymentDocument.dividendInfo.topOff + newDividendPaymentDocument.houseProfit;
                    for (let pmt of newDividendPaymentDocument.stakersPayments) {
                        totalToPayOut += pmt.amount;
                    }
                    let totalHolders: number = 0;
                    for (let key in newDividendPaymentDocument.accounts) {
                        let account: any = newDividendPaymentDocument.accounts[key];
                        totalToPayOut += account.distribution;
                        if (account.distribution > 0) {
                            totalHolders++;
                        }
                    }

                    totalToPayOut = parseFloat(totalToPayOut.toFixed(4));
                    let houseBalance: number = parseFloat(newDividendPaymentDocument.dividendInfo.houseBalance.toFixed(4));
                    if (totalToPayOut != houseBalance) {
                        this.notifySlack("PAY DIVIDEND MANUALLY -> Discrepency in dividend payment record: totalToPayOut: " + totalToPayOut.toString() + " vs houseBalance: " + newDividendPaymentDocument.dividendInfo.mainBalance);
                        this.jobRunning = false;
                        resolve();
                    } else {
                        // Pay the dividends from contract balance if we are supposed to
                        if (autoPayDividend) {
                            await this.payDividends();
                        } else {
                            this.jobRunning = false;
                            resolve();
                        }
                    }
                } else {
                    // No dividend to distribute at this time.
                    if (this.notificationCallback !== null) {
                        let dividendInfo: any = await this.getDividendInfo();
                        this.notificationCallback(dividendInfo);
                    }
                    let friendlyTime:string = moment().format("dddd, MMMM Do YYYY, h:mm:ss a");
                    let message: string = "No dividends to distribute at " + friendlyTime;
                    this.notifySlack(message);
                    console.log(message);
                    this.jobRunning = false;
                    resolve();
                }
            } catch (err) {
                console.log("======================================");
                console.log("Error in dividendPayoutFunction():");
                console.log(err);
                console.log("======================================");
                reject(err);
            }
        })
    }

    /**
     * Calculates and optionally pays out the dividends
     *
     * @param {boolean} autoPayDividend
     * @returns {Promise<void>}
     */
    public dividendPayoutFunction_(autoPayDividend:boolean = true):Promise<void> {

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
            };

            let pipeline:any[] = [
                {
                    "$match" : {
                        "blockNumber" : {
                            "$gte" : 32977141.0
                        }
                    }
                },
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
                this.getDividendInfo().then((dividendInfo:any) => {
                    let headBlockTime: number = parseInt(moment(blockchainInfo.head_block_time + "+00:00").local().format("X"));
                    let minutesBehind: number = (this.historyBlockPosition != null) ? (headBlockTime - this.historyBlockPosition()) / 60 : 0;
                    if (minutesBehind < 5.0) {
                        pipeline.unshift(mintedTimeTokenMatch);
                        this.dbManager.aggregation("eostimetoken", pipeline).then((cursor: AggregationCursor) => {
                            cursor.toArray().then(async (timeHolders: any[]) => {

                                let originalDividendBalance = dividendInfo.toppedOffHouseBalance;
                                if (originalDividendBalance > 0) {

                                    let houseProfit: number = originalDividendBalance * Config.HOUSE_PROFIT;
                                    let stakersProfit: number = originalDividendBalance * Config.STAKERS_PROFIT;
                                    let stakerPayments: any[] = new Array<any>();

                                    // Calculate the staker's cut
                                    let stakers: any = await this.dbManager.getConfig("stakers");
                                    if (stakers) {
                                        let totalStaked: number = 0;
                                        for (let accountName in stakers) {
                                            totalStaked += stakers[accountName];
                                        }
                                        for (let accountName in stakers) {
                                            let amt: number = stakersProfit * stakers[accountName] / totalStaked;
                                            let stakerPayment: any = {
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
                                        dividendInfo: dividendInfo,
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
                                            timeTokens: parseFloat(parseFloat(timeHolder.total.toString()).toFixed(4)),
                                            eos: 0,
                                            paymentState: "pending",
                                            transactionId: null
                                        }
                                        let key: string = timeHolder._id["to"].replace(/\./gi, "_");
                                        newDividendPaymentDocument.timeTokenSupply += account.timeTokens;
                                        newDividendPaymentDocument.accounts[key] = account;
                                    }

                                    // Now we need to aggregate third party transfers and account for them
                                    pipeline.shift();
                                    pipeline.unshift(thirdPartyTransfersMatch);
                                    this.dbManager.aggregation("eostimetoken", pipeline).then((cursor: AggregationCursor) => {
                                        cursor.toArray().then(async (thirdPartyTransfers: any[]) => {

                                            let eosexhwallet:any[] = new Array();
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
                                                            let key: string = tpt._id["to"].replace(/\./gi, "_");
                                                            newDividendPaymentDocument.accounts[key] = credit;
                                                        }
                                                        debit.timeTokens -= tokens;
                                                        credit.timeTokens += tokens;

                                                        if ((credit.accountName == "eosexhwallet") || debit.account_name == "eosexhwallet") {
                                                            eosexhwallet.push({debit: debit, credit: credit});
                                                        }
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
                                                // await this.dbManager.insertDocument("dividends", newDividendPaymentDocument);

                                                // Save our final distribution record to MySQL DB
                                                if (this.dbMysql) {
                                                    await this.dbMysql.newDividendReceipt(newDividendPaymentDocument);
                                                }

                                                // Check the receipt
                                                let totalToPayOut:number = newDividendPaymentDocument.dividendInfo.topOff + newDividendPaymentDocument.houseProfit;
                                                for (let pmt of newDividendPaymentDocument.stakersPayments) {
                                                    totalToPayOut += pmt.amount;
                                                }
                                                let totalHolders:number = 0;
                                                for (let key in newDividendPaymentDocument.accounts) {
                                                    let account:any = newDividendPaymentDocument.accounts[key];
                                                    totalToPayOut += account.distribution;
                                                    if (account.distribution > 0) {
                                                        totalHolders++;
                                                    }
                                                }

                                                totalToPayOut = parseFloat(totalToPayOut.toFixed(4));
                                                let houseBalance:number = parseFloat(newDividendPaymentDocument.dividendInfo.houseBalance.toFixed(4));
                                                if (totalToPayOut != houseBalance) {
                                                    this.notifySlack("PAY DIVIDEND MANUALLY -> Discrepency in dividend payment record: totalToPayOut: " + totalToPayOut.toString() + " vs houseBalance: " + newDividendPaymentDocument.dividendInfo.mainBalance);
                                                    this.jobRunning = false;
                                                    resolve();
                                                } else {
                                                    // Pay the dividends from contract balance if we are supposed to
                                                    if (autoPayDividend) {
                                                        await this.payDividends();
                                                    } else {
                                                        this.jobRunning = false;
                                                        resolve();
                                                    }
                                                }
                                            } catch (err) {
                                                let message: string = "Unexpected error while processing dividends";
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
                                        let message: string = "1 - Error paying out dividends - prior to blockchain payout";
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
                                        let dividendInfo: any = await this.getDividendInfo();
                                        this.notificationCallback(dividendInfo);
                                    }
                                    let message: string = "No dividends to distribute at " + friendlyTime;
                                    this.notifySlack(message);
                                    console.log(message);
                                    this.jobRunning = false;
                                    resolve();
                                }
                            }).catch((err) => {
                                let message: string = "2 - Error paying out dividends - prior to blockchain payout";
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
                            let message: string = "3 - Error paying out dividends - prior to blockchain payout";
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
                        let message: string = "Not processing dividends because we are " + minutesBehind + " minutes behind in scraping history";
                        this.notifySlack(message)
                        console.log(message);
                        this.jobRunning = false;
                        reject();
                    }

                });

            });

        });

    }

    /**
     * Pays out the dividend
     * @param {(prompt:string) => Promise<boolean>} verifyFunction
     * @returns {Promise<void>}
     */
    public payDividends_(verifyFunction:(prompt:string) => Promise<boolean> = null):Promise<void> {
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
     * Pays out the dividend using MySQL database
     * @param {(prompt:string) => Promise<boolean>} verifyFunction
     * @returns {Promise<void>}
     */
    public payDividends(verifyFunction:(prompt:string) => Promise<boolean> = null):Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            try {
                let document: any = null;
                let payments: payment[] = await this.dbMysql.qb(payment, "payment").leftJoinAndSelect("payment.dividend_", "div").where({paymentState: "pending"}).getMany();
                for (let pmt of payments) {
                    let dividendId: string = pmt.dividend_.id.toString();
                    let qr: QueryRunner = await this.dbMysql.startTransaction();
                    try {
                        let memo: string = null;
                        if (pmt.paymentType == "house") {
                            memo = "http://eostime.io house payment ID:" + dividendId;
                        } else if (pmt.paymentType == "staker") {
                            memo = "http://eostime.io staker payment ID:" + dividendId;
                        } else if (pmt.paymentType == "dividend") {
                            memo = "http://eostime.io dividend payment ID:" + dividendId;
                        } else if (pmt.paymentType == "transfer") {
                            memo = "Funding initial auction prizes ID:" + dividendId;
                        }
                        if (memo !== null) {
                            let makeBlockchainPayment: boolean = true;
                            if (verifyFunction) {
                                makeBlockchainPayment = await verifyFunction("\nPay " + pmt.accountName + " " + pmt.amount + " EOS for dividendId:" + dividendId + " ?");
                            }
                            if (makeBlockchainPayment) {
                                try {
                                    // PAY ON THE BLOCKCHAIN!
                                    let transaction:any = await this.eosBlockchain.dividendPayout(pmt.accountName, pmt.amount, memo);
                                    pmt.transactionId = transaction.transaction_id;
                                    pmt.paymentState = "paid";
                                    console.log("dividendId: " + dividendId + " - transactionId: [" + pmt.transactionId + "] " + memo + " -> " + pmt.amount.toFixed(4) + " EOS to " + pmt.accountName);
                                } catch (err) {
                                    pmt.paymentState = "error";
                                    if (err) {
                                        if (typeof err == "string") {
                                            pmt.error = new Buffer(err, "utf-8");
                                        } else if (err.hasOwnProperty("message")) {
                                            pmt.error = new Buffer(err.message, "utf-8");
                                        } else {
                                            pmt.error = new Buffer("Unexpected blockchain error", "utf-8");
                                        }
                                    }
                                }
                                pmt.save();
                                await this.dbMysql.commitTransaction(qr);
                            } else {
                                await this.dbMysql.rollbackTransaction(qr);
                            }
                        } else {
                            await this.dbMysql.rollbackTransaction(qr);
                        }
                    } catch (err) {
                        await this.dbMysql.rollbackTransaction(qr);
                        console.log(err);
                    }
                }
                resolve();
            } catch (err) {
                console.log(err);
                reject(err);
            }
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