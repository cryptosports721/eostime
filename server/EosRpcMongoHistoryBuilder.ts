import {DBManager} from "./DBManager";
import JsonRpc from "eosjs/dist/eosjs-jsonrpc";
import moment = require("moment");
import {Config} from "./Config";
import {ObjectID} from "bson";

const fetch = require('node-fetch');
const md5 = require('md5');

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

export class EosRpcMongoHistoryBuilder {

    private static FAST_JOB_INTERVAL_SECS:number = 5000;
    private static JOB_INTERVAL_SECS:number = 30000;
    private static ACTION_COUNT_PER_JOB:number = 199;

    private eosRpc:JsonRpc;
    private dbManager:DBManager;
    private timer:any = null;
    private mostRecentHeadBlockNumber:number = 0;
    private mostRecentHeadBlockTimeStamp:number = 0;
    private notificationCallback:(data:any) => void;
    private auctionWinnerPayoutTransactionCallback:(auctionId:number, blockNumber:number, transactionId:string) => Promise<void>;

    private hashMap:any = {};

    constructor(endpoint:string, dbManager:DBManager, notificationCallback:(data:any) => void = null, auctionWinnerPayoutTransactionCallback:(auctionId:number, blockNumber:number, transactionId:string) => Promise<void> = null) {
        this.eosRpc = new JsonRpc(endpoint, {fetch});
        this.dbManager = dbManager;
        this.notificationCallback = notificationCallback;
        this.auctionWinnerPayoutTransactionCallback = auctionWinnerPayoutTransactionCallback;
    }

    public start():void {
        if (!this.timer) {
            this.job();
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
            eostimetoken: 0,
            eostimecontr: 0,
            eostimehouse: 0
        };
        let initialJobState:any = {
            eostimetoken: 0,
            eostimecontr: 0,
            eostimehouse: 0
        };

        let interval:number = EosRpcMongoHistoryBuilder.JOB_INTERVAL_SECS;

        this.dbManager.getConfig("historyState").then(async (value) => {
            if (value) {
                jobState = value;
            } else {
                // First time through, create the key
                await this.dbManager.insertDocument("applicationSettings", {key: "historyState", value: jobState});
            }
            initialJobState = JSON.parse(JSON.stringify(jobState));
            // console.log("EosRpcMongoHistoryBuider job started - " + jobState.eostimetoken + "/" + jobState.eostimecontr + "/" + jobState.eostimehouse);
            return this.getActions("eostimetoken", jobState.eostimetoken, EosRpcMongoHistoryBuilder.ACTION_COUNT_PER_JOB);

        }).then((result:any) => {
            let actions:any[] = result.actions;
            if (actions.length == (EosRpcMongoHistoryBuilder.ACTION_COUNT_PER_JOB + 1)) {
                interval = EosRpcMongoHistoryBuilder.FAST_JOB_INTERVAL_SECS;
            }
            if (actions.length > 0) {
                jobState.eostimetoken = actions[actions.length - 1]["account_action_seq"] + 1;
                return this.saveActions("eostimetoken", actions);
            } else {
                Promise.resolve();
            }
        }).then(() => {
            return this.getActions("eostimecontr", jobState.eostimecontr, EosRpcMongoHistoryBuilder.ACTION_COUNT_PER_JOB);
        }).then((result:any) => {
            let actions:any[] = result.actions;
            if (actions.length == (EosRpcMongoHistoryBuilder.ACTION_COUNT_PER_JOB + 1)) {
                interval = EosRpcMongoHistoryBuilder.FAST_JOB_INTERVAL_SECS;
            }
            if (actions.length > 0) {
                jobState.eostimecontr = actions[actions.length - 1]["account_action_seq"] + 1;
                return this.saveActions("eostimecontr", actions);
            } else {
                Promise.resolve();
            }
        }).then(() => {
            return this.getActions("eostimehouse", jobState.eostimehouse, EosRpcMongoHistoryBuilder.ACTION_COUNT_PER_JOB);
        }).then((result:any) => {
            let actions:any[] = result.actions;
            if (actions.length == (EosRpcMongoHistoryBuilder.ACTION_COUNT_PER_JOB + 1)) {
                interval = EosRpcMongoHistoryBuilder.FAST_JOB_INTERVAL_SECS;
            }
            if (actions.length > 0) {
                jobState.eostimehouse = actions[actions.length - 1]["account_action_seq"] + 1;
                return this.saveActions("eostimehouse", actions);
            } else  {
                Promise.resolve();
            }
        }).then(() => {
            return this.dbManager.setConfig("historyState", jobState);
        }).then(() => {
            return this.eosRpc.get_info();
        }).then((blockchainInfo:any) => {
            this.mostRecentHeadBlockNumber = blockchainInfo.head_block_num;
            this.mostRecentHeadBlockTimeStamp = parseInt(moment( blockchainInfo.head_block_time + "+00:00").local().format("X"));
            let friendlyTimestamp:string = this.getTimestampFriendly();
            // console.log("Last processed block: " + friendlyTimestamp);
            // console.log("EoxRpcMongoHistoryBuilder job queued to run in " + (interval/1000).toString() + " seconds");
            this.timer = setTimeout(this.job.bind(this), interval);
        }).catch((err) => {
            let friendlyTimestamp:string = this.getTimestampFriendly();
            console.log("EosRpcMongoHistoryBuilder error at " + friendlyTimestamp);
            console.log(err);
            this.rollback(initialJobState);
        });
    }

    /**
     * Rolls back and restarts our timer
     * @param jobState
     */
    private rollback(jobState:any):void {

        let promises:Promise<void>[] = new Array<Promise<void>>();
        for (let key in jobState) {
            console.log("Rolling " + key + " back to block " + jobState[key]);
            let filter:any = {accountActionSeq: {$gte: jobState[key]}};
            let p:Promise<void> = this.dbManager.deleteDocumentsByKey(key, filter);
            promises.push(p);
        }
        promises.push(this.dbManager.setConfig("historyState", jobState));
        Promise.all(promises).then((result) => {
            if (!this.timer) {
                this.timer = setTimeout(this.job.bind(this), EosRpcMongoHistoryBuilder.JOB_INTERVAL_SECS);
            }
        }).catch((err) => {
            console.log("Catastrophic err, cannot rollback database!");
            console.log("Stopping EosRpcMongoHistoryBuilder !!!");
        });

    }

    private getActions(accountName:string, pos:number, offset:number):Promise<any[]> {
        return this.eosRpc.history_get_actions(accountName, pos, offset);
    }

    private saveActions(collectionName:string, actions:any[]):Promise<void[]> {

        let promises:Promise<void>[] = new Array<Promise<void>>();

        // console.log("Saving " + actions.length + " " + collectionName + " actions.");

        let createDocument = function(action:any) {
            if (action.receipt.receiver == collectionName) {
                let hash = md5(action.act.account + action.act.name + action.trx_id + action.act.hex_data);
                if (!this.hashMap.hasOwnProperty(hash)) {
                    this.hashMap[hash] = true;

                    // Main act
                    let account: string = Config.safeProperty(action, ["act.account"], null);
                    let name: string = Config.safeProperty(action, ["act.name"], null);
                    let data: any = Config.safeProperty(action, ["act.data"], null);

                    if ((account !== null) && (name !== null) && (data !== null)) {
                        let document: any = {
                            account: account,
                            name: name,
                            transactionId: action.trx_id,
                            timestamp: parseInt(moment(action.block_time + "+00:00").local().format("X")),
                            blockNumber: action.block_num
                        };

                        for (let key in data) {
                            let n:number = parseInt(key);
                            if (isNaN(n)) {
                                document[key] = data[key];
                                if (key == "memo") {
                                    let memo: string = data[key];
                                    let tab: TypeAuctionBid = this.typeAuctionBidIdsFromMemo(memo);
                                    if (tab) {
                                        document["auctionType"] = tab.type;
                                        document["auctionId"] = tab.auctionId;
                                        document["bidId"] = tab.bidId;
                                    }
                                    if (memo.indexOf("dividend payment") >= 0) {

                                        // Update the dividend payment record with the transactionId and blockNumber
                                        let fields: string[] = memo.split(":");
                                        if (fields.length == 2) {
                                            let _id: ObjectID = new ObjectID(fields[1]);
                                            let filter: any = {
                                                "_id": _id
                                            };
                                            let newValues: any = {};
                                            let fieldName: string = "accounts." + data["to"] + ".transactionId";
                                            newValues[fieldName] = document.transactionId;
                                            fieldName = "accounts." + data["to"] + ".blockNumber";
                                            newValues[fieldName] = document.blockNumber;
                                            let promise: Promise<any> = this.dbManager.updateDocumentByKey("dividends", filter, newValues);
                                            promises.push(promise);
                                        }
                                    }
                                }
                            }
                        }

                        // Check for winner payout transaction
                        if (this.auctionWinnerPayoutTransactionCallback) {
                            let from: string = Config.safeProperty(document, ["from"], null);
                            let to: string = Config.safeProperty(document, ["to"], null);
                            let auctionId: number = Config.safeProperty(document, ["auctionId"], null);
                            if ((account == "eosio.token") && (from == "eostimecontr") && (to != "eostimehouse") && (auctionId !== null)) {
                                let winnerBlockNumber: number = Config.safeProperty(document, ["blockNumber"], null);
                                let winnerTransactionId: string = Config.safeProperty(document, ["transactionId"], null);
                                if (winnerBlockNumber && winnerTransactionId) {
                                    this.auctionWinnerPayoutTransactionCallback(auctionId, winnerBlockNumber, winnerTransactionId);
                                }
                            }
                        }

                        return document;
                    } else {
                        console.log("Couldn't parse action into database document.");
                        return null;
                    }
                } else {
                    return null;
                }
            } else {
                return null;
            }
        }.bind(this);

        let updateClientDividendInfo:boolean = false;
        for (let i:number = 0; i < actions.length; i++) {
            let action:any = actions[i];
            let seq:number = action.account_action_seq;
            let outerAction: any = createDocument(action.action_trace);
            if (outerAction) {
                if ((outerAction.account == "eosio.token") && (outerAction.name == "transfer") && (outerAction.to == "eostimehouse")) {
                    updateClientDividendInfo = true;
                }
                outerAction["accountActionSeq"] = seq;
                promises.push(this.dbManager.insertDocument(collectionName, outerAction));
            }
            for (let j:number = 0; j < action.action_trace.inline_traces.length; j++) {
                let innerAction:any = createDocument(action.action_trace.inline_traces[j]);
                if (innerAction) {
                    if ((innerAction.account == "eosio.token") && (innerAction.name == "transfer") && (innerAction.to == "eostimehouse")) {
                        updateClientDividendInfo = true;
                    }
                    innerAction["accountActionSeq"] = seq;
                    promises.push(this.dbManager.insertDocument(collectionName, innerAction));
                }
            }
        }
        if (this.notificationCallback !== null) {
            this.notificationCallback(null);
        }

        return Promise.all(promises);
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