import {DBManager} from "./DBManager";
import JsonRpc from "eosjs/dist/eosjs-jsonrpc";
import moment = require("moment");
import {Config} from "./Config";
import {ObjectID} from "bson";
import {DBMysql} from "./DBMysql";
import {eostimetoken} from "./entities/eostimetoken";
import {applicationSettings} from "./entities/applicationSettings";
import {eostimecontr} from "./entities/eostimecontr";
import {eostimehouse} from "./entities/eostimehouse";
import {auctionType} from "./entities/auctionType";
import {auctions} from "./entities/auctions";
import {bid} from "./entities/bid";
import {QueryRunner} from "typeorm";

const fetch = require('node-fetch');
const md5 = require('md5');
const request = require('request');

class TypeAuctionBid {

    public type:number;
    public auctionId:number;
    public bidId:number;
    constructor(type:number, auctionId:number, bidId:number) {
        this.type = type;
        this.auctionId = auctionId;
        this.bidId = bidId;
    }
}

export class EosRpcMySqlHistoryBuilder {

    private static FAST_JOB_INTERVAL_SECS:number = 1000;
    private static JOB_INTERVAL_SECS:number = 500;
    private static ACTION_COUNT_PER_JOB:number = 199;

    private endpoint:string;
    private eosRpc:JsonRpc;
    private dbManager:DBMysql;
    private timer:any = null;
    private startingBlockNumber:number = 0;
    private mostRecentHeadBlockNumber:number = 0;
    private mostRecentHeadBlockTimeStamp:number = 0;
    private notificationCallback:(data:any) => void;
    private auctionWinnerPayoutTransactionCallback:(auctionId:number, blockNumber:number, transactionId:string) => Promise<void>;

    private hashMap:any = {};

    constructor(endpoint:string, dbManager:DBMysql, notificationCallback:(data:any) => void = null, auctionWinnerPayoutTransactionCallback:(auctionId:number, blockNumber:number, transactionId:string) => Promise<void> = null) {
        this.endpoint = endpoint;
        this.eosRpc = new JsonRpc(endpoint, {fetch});
        this.dbManager = dbManager;
        this.notificationCallback = notificationCallback;
        this.auctionWinnerPayoutTransactionCallback = auctionWinnerPayoutTransactionCallback;
    }

    public start():void {
        if (!this.timer) {
            this.dbManager.getConfig("startingBlockNumber").then((result) => {
                this.startingBlockNumber = parseInt(result);
                this.job();
            }, (err) => {
                console.log("Could not start EosRpcMySqlHistoryBuilder - bad startingBlockNumber in applicationSettings table");
                console.log(err);
            });
        }
    }

    public async stop(retryCount:number = 20):Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.timer) {
                clearTimeout(this.timer);
                this.timer = null;
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

    public isRunning():boolean {
        return this.timer !== null;
    }

    public getBlockNumber():number {
        return this.mostRecentHeadBlockNumber;
    }

    public getBlockTimestamp():number {
        return this.mostRecentHeadBlockTimeStamp;
    }

    public getTimestampFriendly():string {
        return moment.unix(this.mostRecentHeadBlockTimeStamp).format("dddd, MMMM Do YYYY, h:mm:ss a");
    }

    // ===============
    // PRIVATE METHODS
    // ===============

    /**
     * Job to hit the RPC server and pull in data we build our Mongo history from
     */
    private job():void {

        this.timer = null;
        this.hashMap = {};

        let jobState:any = {
            eostimetoken: this.startingBlockNumber,
            eostimecontr: this.startingBlockNumber,
            eostimehouse: this.startingBlockNumber
        };
        let initialJobState:any = {
            eostimetoken: 0,
            eostimecontr: 0,
            eostimehouse: 0
        };

        let interval:number = EosRpcMySqlHistoryBuilder.JOB_INTERVAL_SECS;

        this.dbManager.getConfig("historyState").then(async (value) => {
            try {
                if (value) {
                    jobState = JSON.parse(value);
                } else {
                    // First time through, create the key
                    await this.dbManager.setConfig("historyState", JSON.stringify(jobState));
                }
                initialJobState = JSON.parse(JSON.stringify(jobState));

                let result: any = await this.getActions("eostimetoken", jobState.eostimetoken, EosRpcMySqlHistoryBuilder.ACTION_COUNT_PER_JOB);
                let actions: any[] = result.actions;
                console.log(actions.length + " eostimetoken actions");
                if (actions.length > 0) {
                    jobState.eostimetoken = actions[actions.length - 1]["account_action_seq"] + 1;
                    await this.saveActions("eostimetoken", actions);
                }

                result = await this.getActions("eostimecontr", jobState.eostimecontr, EosRpcMySqlHistoryBuilder.ACTION_COUNT_PER_JOB);
                actions = result.actions;
                console.log(actions.length + " eostimecontr actions");
                if (actions.length > 0) {
                    jobState.eostimecontr = actions[actions.length - 1]["account_action_seq"] + 1;
                    await this.saveActions("eostimecontr", actions);
                }

                result = await this.getActions("eostimehouse", jobState.eostimehouse, EosRpcMySqlHistoryBuilder.ACTION_COUNT_PER_JOB);
                actions = result.actions;
                console.log(actions.length + " eostimehouse actions");
                console.log("------------------------------");
                if (actions.length > 0) {
                    jobState.eostimehouse = actions[actions.length - 1]["account_action_seq"] + 1;
                    await this.saveActions("eostimehouse", actions);
                }

                await this.dbManager.setConfig("historyState", JSON.stringify(jobState));
                let blockchainInfo: any = await this.eosRpc.get_info();
                this.mostRecentHeadBlockNumber = blockchainInfo.head_block_num;
                this.mostRecentHeadBlockTimeStamp = parseInt(moment(blockchainInfo.head_block_time + "+00:00").local().format("X"));
                this.timer = setTimeout(this.job.bind(this), interval);
            } catch (err) {
                let friendlyTimestamp: string = this.getTimestampFriendly();
                console.log("EosRpcMySqlHistoryBuilder error at " + friendlyTimestamp);
                console.log(err);
                await this.rollback(initialJobState);
            }
        }, async (err) => {
            let friendlyTimestamp: string = this.getTimestampFriendly();
            console.log("EosRpcMySqlHistoryBuilder error at " + friendlyTimestamp);
            console.log(err);
            await this.rollback(initialJobState);
        });
    }

    /**
     * Rolls back and restarts our timer
     * @param jobState
     */
    private rollback(jobState:any):Promise<void> {

        return new Promise<void>(async (resolve, reject) => {

            try {
                await this.dbManager.setConfig("historyState", JSON.stringify(jobState));
                await this.dbManager.qb(eostimehouse, "eostimehouse").delete().where("accountActionSeq >= :param", {param: jobState.eostimehouse});
                await this.dbManager.qb(eostimetoken, "eostimetoken").delete().where("accountActionSeq >= :param", {param: jobState.eostimetoken});
                await this.dbManager.qb(eostimecontr, "eostimecontr").delete().where("accountActionSeq >= :param", {param: jobState.eostimecontr});
                if (!this.timer) {
                    this.timer = setTimeout(this.job.bind(this), 10*EosRpcMySqlHistoryBuilder.JOB_INTERVAL_SECS);
                }
                resolve();
            } catch (err) {
                console.log("Catastrophic err, cannot rollback database!");
                console.log("Stopping EosRpcMySqlHistoryBuilder !!!");
                reject(err);
            }

        });
    }

    private getActions(accountName:string, pos:number, offset:number):Promise<any[]> {

        return new Promise<any[]>((resolve, reject) => {

            let postData:any = {
                "account_name": accountName,
                "pos": pos,
                "offset": offset
            };
            request({
                    url: this.endpoint + "/v1/history/get_actions",
                    method: 'POST',
                    body: JSON.stringify(postData),
                    headers: {"Content-Type": "application/json", "cache-control": "no-cache"}
                }, function(error, response, body) {
                    if (error) {
                        reject(error);
                    } else {
                        try {
                            let toRet: any[] = JSON.parse(body);
                            resolve(toRet);
                        } catch (err) {
                            console.log("Bad response JSON from " + this.endpoiont);
                            reject(err);
                        }
                    }
                }.bind(this));
        });


        // return this.eosRpc.history_get_actions(accountName, pos, offset);
    }

    private saveActions(tableName:string, actions:any[]):Promise<void> {

        return new Promise<void>(async (resolve, reject) => {

            let addTableRecord = async function(action:any) {
                let record = null;
                let currency = null;
                switch (tableName) {
                    case ("eostimetoken"):
                        currency = "TIME";
                        record = new eostimetoken();
                        break;
                    case ("eostimecontr"):
                        currency = "EOS";
                        record = new eostimecontr();
                        break;
                    case ("eostimehouse"):
                        currency = "EOS";
                        record = new eostimehouse();
                        break;
                }
                if (record) {
                    record.timestamp = new Date(parseInt(moment(action.block_time + "+00:00").local().format("X"))*1000.0);
                    record.hash = md5(action.act.account + action.act.name + action.trx_id + action.act.hex_data);
                    record.account = Config.safeProperty(action, ["act.account"], null);
                    record.name = Config.safeProperty(action, ["act.name"], null);
                    if (record.name == "rzbidreceipt") {
                        let data:any = action.act.data;
                        if (data.redzone_id) {
                            data.block_time = action.block_time;

                            await this.dbManager.recordBid(data);

                            let auction: auctions = await this.dbManager.entityManager().findOne(auctions, {auctionId: data.redzone_id});
                            if (auction) {
                                if (auction.endingBidId && data.bid_id == auction.endingBidId) {
                                    auction.endingBidPrice = parseFloat(data.bid_price.split(" ")[0]);
                                    await auction.save();
                                }
                            }
                        }

                    } else if (record.name == "rzreceipt") {

                        let data:any = action.act.data;
                        if (data.redzone_id) {
                            await this.dbManager.getConnection().manager.transaction(async (transactionalEntityManager) => {
                                let auction: auctions = await transactionalEntityManager.findOne(auctions, {auctionId: data.redzone_id});
                                if (!auction) {
                                    auction = new auctions();
                                    auction.auctionType = data.redzone_type;
                                    auction.auctionId = data.redzone_id;
                                }
                                auction.creationDatetime = record.timestamp;
                                auction.endedDatetime = record.timestamp;
                                auction.lastBidderAccount = data.winner;
                                auction.endingBidId = data.bid_id;
                                auction.prizePool = parseFloat(data.amount.split(" ")[0]);
                                auction.bonusTimeTokens = parseFloat(data.winner_bonus.split(" ")[0]);
                                auction.blockNumber = action.block_num;
                                auction.transactionId = action.trx_id;
                                let winningBid: bid = await transactionalEntityManager.findOne(bid, {bidId: data.bid_id});
                                if (winningBid) {
                                    auction.endingBidPrice = winningBid.amount;
                                }
                                try {
                                    await transactionalEntityManager.save(auction);
                                } catch (err) {
                                    if (err && err.code && (err.code != "ER_DUP_ENTRY")) {
                                        console.log("Error saving record to MySql database");
                                        console.log(err);
                                    }
                                }
                            });
                        }

                    } else  if (record.name != "buyrambytes") {
                        let data: any = Config.safeProperty(action, ["act.data"], null);
                        if ((record.account !== null) && (record.name !== null) && (data !== null) && (data.hasOwnProperty("quantity"))) {
                            record.transactionId = action.trx_id;
                            record.blockNumber = action.block_num;
                            record.from = data.from;
                            record.to = data.to;
                            record.quantity = parseFloat(data.quantity.split(" ")[0]);
                            record.currency = currency;
                            record.accountActionSeq = action.accountActionSeq;
                            record.memo = data.memo;
                            let tab: TypeAuctionBid = this.typeAuctionBidIdsFromMemo(data.memo);
                            if (tab) {
                                record.auctionType = tab.type;
                                record.auctionId = tab.auctionId;
                                record.bidId = tab.bidId;
                            }
                            try {
                                await this.dbManager.entityManager().save(record);
                            } catch (err) {
                                if (err && err.code && (err.code != "ER_DUP_ENTRY")) {
                                    console.log("Error saving record to MySql database");
                                    console.log(err);
                                }
                            }
                        }
                    }
                }
            }.bind(this);

            try {
                for (let i: number = 0; i < actions.length; i++) {
                    let action: any = actions[i];
                    let seq: number = action.account_action_seq;
                    action.action_trace["accountActionSeq"] = seq;
                    await addTableRecord(action.action_trace);
                    for (let j: number = 0; j < action.action_trace.inline_traces.length; j++) {
                        let trace: any = action.action_trace.inline_traces[j];
                        trace["accountActionSeq"] = seq;
                        let innerAction: any = await addTableRecord(trace);
                    }
                }
            } catch (err) {
                reject(err);
            }

            if (this.notificationCallback !== null) {
                this.notificationCallback(null);
            }

            resolve();

        });
    }


    /**
     * Parses the type-auction-bid field
     *
     * @param {string} memo
     * @returns {TypeAuctionBid}
     */
    private typeAuctionBidIdsFromMemo(memo:string):TypeAuctionBid {

        if (memo) {
            let split: any[] = memo.split(" ");
            let idFields: string = split[split.length - 1];
            split = idFields.split("-");
            if (split.length == 3) {
                for (let i: number = 0; i < split.length; i++) {
                    split[i] = parseInt(split[i]);
                    if (isNaN(split[i])) {
                        return null;
                    }
                }
                return new TypeAuctionBid(split[0], split[1], split[2]);
            }
        }
        return null;
    }
}