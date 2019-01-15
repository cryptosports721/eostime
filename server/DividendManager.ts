import {DBManager} from "./DBManager";
import {EosBlockchain} from "./EosBlockchain";
import {Config} from "./Config";
import {AggregationCursor} from "mongodb";
import moment = require("moment");
import {DBMysql} from "./DBMysql";
import {QueryRunner} from "typeorm";
import {payment} from "./entities/payment";
import {dividend} from "./entities/dividend";
import {user} from "./entities/user";
import {Connection} from "typeorm/connection/Connection";

const schedule = require('node-schedule');
const request = require('request');

export class DividendManager {

    private jobRunning:boolean = false;
    private dbManager:DBManager;
    private dbMysql:DBMysql;
    private eosBlockchain:EosBlockchain;
    private notificationCallback:(data:any) => void;
    private slackHook:string;

    private job:any = null;

    /**
     * Constructs our dividend manager
     * @param {DBManager} dbManager
     * @param {DBMysql} dbMysql
     * @param {EosBlockchain} eosBlockchain
     * @param {string} slackHook
     * @param {(data: any) => void} notificationCallback
     */
    constructor(dbManager:DBManager, dbMysql:DBMysql, eosBlockchain:EosBlockchain, slackHook:string, notificationCallback:(data:any) => void = null) {
        this.dbManager = dbManager;
        this.dbMysql = dbMysql;
        this.eosBlockchain = eosBlockchain;
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
                    await this.newDividendReceipt(newDividendPaymentDocument);

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

                                await qr.manager.save(pmt);
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
     * Creates a dividend receipt in the database from the dividend receipt JSON
     * in a single transaction.
     *
     * @param dividendJsonReceipt
     * @returns {Promise<void>}
     */
    private newDividendReceipt(dividendJsonReceipt:any):Promise<void> {
        return new Promise<void>(async (resolve, reject) => {

            let conn:Connection = this.dbMysql.getConnection();
            let success:boolean = true;
            if (conn) {
                const now:Date = new Date();
                const queryRunner:QueryRunner = conn.createQueryRunner();
                await queryRunner.connect();
                await queryRunner.startTransaction();
                try {

                    let div: dividend = new dividend();
                    div.creationDatetime = now;
                    div.timeTokenSupply = dividendJsonReceipt.timeTokenSupply;
                    div.originalDividendBalance = dividendJsonReceipt.originalDividendBalance;
                    div.houseProfit = dividendJsonReceipt.houseProfit;
                    div.stakersProfit = dividendJsonReceipt.stakersProfit;
                    div.dividendBalance = dividendJsonReceipt.dividendBalance;
                    div.eostimecontrRecharge = dividendJsonReceipt.eostimecontrRecharge;
                    div.eostimecontrRecharge = 100.0;
                    await queryRunner.manager.save(div);

                    // Transfer back to eostimecontr
                    if (dividendJsonReceipt.dividendInfo.topOff > 0) {
                        let transferToContr:payment = new payment();
                        transferToContr.creationDatetime = now;
                        transferToContr.accountName = Config.eostimeContract;
                        transferToContr.amount = dividendJsonReceipt.dividendInfo.topOff;
                        transferToContr.currency = "EOS";
                        transferToContr.paymentState = "pending";
                        transferToContr.paymentType = "transfer";
                        transferToContr.dividend_ = div;
                        await queryRunner.manager.save(transferToContr);
                    }

                    // Create our housePayment
                    let housePmt:payment = new payment();
                    housePmt.creationDatetime = now;
                    housePmt.accountName = Config.eostimeTokenCorpo;
                    housePmt.amount = div.houseProfit;
                    housePmt.currency = "EOS";
                    housePmt.paymentState = "pending";
                    housePmt.paymentType = "house";
                    housePmt.dividend_ = div;
                    await queryRunner.manager.save(housePmt);

                    // Create our stakerPayment
                    for (let sp of dividendJsonReceipt.stakersPayments) {
                        let stakerPayment:payment = new payment();
                        stakerPayment.creationDatetime = now;
                        stakerPayment.accountName = sp.account;
                        stakerPayment.amount = sp.amount;
                        stakerPayment.currency = "EOS";
                        stakerPayment.paymentState = "pending";
                        stakerPayment.paymentType = "staker";
                        let u:user = await this.dbMysql.userFromAccount(queryRunner.manager, sp.account);
                        if (u) {
                            stakerPayment.user_ = u;
                        }
                        stakerPayment.dividend_ = div;
                        await queryRunner.manager.save(stakerPayment);
                    }

                    // Loop through and create our staker payments
                    for (let accountName in dividendJsonReceipt.accounts) {
                        let pmt:any = dividendJsonReceipt.accounts[accountName];
                        let userPayment:payment = new payment();
                        userPayment.amount = pmt.distribution;
                        userPayment.currency = "EOS";
                        userPayment.creationDatetime = now;
                        userPayment.paymentState = (userPayment.amount > 0) ? pmt.paymentState : "paid";
                        userPayment.paymentType = "dividend";
                        userPayment.accountName = pmt.accountName;
                        userPayment.proportion = pmt.proportion;
                        let u:user = await this.dbMysql.userFromAccount(queryRunner.manager, accountName);
                        if (u) {
                            userPayment.user_ = u;
                        }
                        userPayment.dividend_ = div;
                        await queryRunner.manager.save(userPayment);
                    }

                    await queryRunner.commitTransaction();

                } catch (err) {
                    success = false;
                    await queryRunner.rollbackTransaction();
                } finally {
                    await queryRunner.release();
                }
                if (success) {
                    resolve();
                } else {
                    reject();
                }
            } else {
                reject();
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