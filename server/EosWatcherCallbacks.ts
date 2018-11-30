import {DBManager} from "./DBManager";
import {Config} from "./Config";
import {ClientSession, MongoClient} from "mongodb";
import {AuctionManager} from "./AuctionManager";

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

export class EosWatcherCallbacks {

    private dbManager;
    private auctionManager;

    private updaters:any[] = [
        {
            /*************************
             * EOSIO.TOKEN::TRANSFER *
             *************************/
            actionType: "eosio.token::transfer",
            updater: async (state, payload, blockInfo, context) => {

                try {
                    let from: string = Config.safeProperty(payload, ["data.from"], null);
                    let to: string = Config.safeProperty(payload, ["data.to"], null);
                    let receiver: string = Config.safeProperty(payload, ["receipt.receiver"], "eosio.token");
                    let transactionId: string = Config.safeProperty(payload, ["transactionId"], null);
                    let actDigest: string = Config.safeProperty(payload, ["receipt.act_digest"], "");

                    // console.log("Block: " + blockInfo.blockNumber + " txid: " + transactionId + " from: " + from + " to: " + to + " receiver: " + receiver);

                    if (transactionId && (from == "eostimecontr" || to == "eostimecontr") && (receiver == "eosio.token")) {
                        let hash = md5(transactionId + payload.hex_data + actDigest);
                        payload["timestamp"] = blockInfo.timestamp;
                        payload["blockNumber"] = blockInfo.blockNumber;
                        payload["md5"] = hash;
                        let txFunc: (client: MongoClient, session: ClientSession) => void = async (client: MongoClient, session: ClientSession) => {
                            // await session.startTransaction({
                            //     readConcern: { level: 'snapshot' },
                            //     writeConcern: { w: 'majority' }
                            // });
                            try {
                                let memo: string = Config.safeProperty(payload, ["data.memo"], null);
                                let tab:any = this.typeAuctionBidIdsFromMemo(memo);
                                if (tab) {
                                    payload["auctionType"] = tab.type;
                                    payload["auctionId"] = tab.auctionId;
                                    payload["bidId"] = tab.bidId;
                                }
                                await this.auctionManager.eosTransfer("eostimecontr", payload, session);
                                await this.dbManager.setConfig("currentBlockNumber", blockInfo.blockNumber, session);
                                // Figure out if we are a winner payout or not.
                                if (memo && memo.toUpperCase().indexOf("YOU WIN") >= 0) {
                                    if (tab) {
                                        await this.auctionManager.assignPaymentTransactionId(tab.auctionId, transactionId);
                                    }
                                }
                                await this.dbManager.commitWithRetry(session);
                            } catch (err) {
                                if ((err.code != 11000) || (err.errmsg.indexOf(hash) < 0)) {
                                    console.log(err);
                                }
                                // await session.abortTransaction();
                            }
                            ;
                        };
                        return this.dbManager.executeTransaction(txFunc);
                    }
                    // Did not write anything to the database
                    return Promise.resolve();
                } catch (err) {
                    console.log("Updater eosio.token::transfer FAILED: "); console.log(err);
                    return Promise.resolve();
                }
            }
        },
        {
            /***********************
             * EOSTIMETOKEN::ISSUE *
             ***********************/
            actionType: "eostimetoken::issue",
            updater: async (state, payload, blockInfo, context) => {
                try {
                    let receiver:string = Config.safeProperty(payload, ["receipt.receiver"], "eostimetoken");
                    let hash: string = Config.safeProperty(payload, ["transactionId"], null);
                    let actDigest:string = Config.safeProperty(payload, ["receipt.act_digest"], "");
                    if (hash && (receiver == "eostimetoken")) {
                        hash = md5(hash + payload.hex_data + actDigest);
                        let to: string = Config.safeProperty(payload, ["data.to"], null);

                        // We only record issue's to the eostimetoken contract because
                        // everyone else gets included in the eostimetoken:transfer action
                        //
                        if (to == "eostimetoken") {
                            payload["timestamp"] = blockInfo.timestamp;
                            payload["blockNumber"] = blockInfo.blockNumber;
                            payload["md5"] = hash;
                            payload.data["from"] = null;
                            let memo: string = Config.safeProperty(payload, ["data.memo"], null);
                            let tab:any = this.typeAuctionBidIdsFromMemo(memo);
                            if (tab) {
                                payload["auctionType"] = tab.type;
                                payload["auctionId"] = tab.auctionId;
                                payload["bidId"] = tab.bidId;
                            }
                            let txFunc:(client:MongoClient, session:ClientSession) => void = async (client:MongoClient, session:ClientSession) => {
                                // await session.startTransaction({
                                //     readConcern: { level: 'snapshot' },
                                //     writeConcern: { w: 'majority' }
                                // });
                                try {
                                    await this.auctionManager.timeTokenIssued(payload, session);
                                    await this.dbManager.setConfig("currentBlockNumber", blockInfo.blockNumber, session);
                                    await this.dbManager.commitWithRetry(session);
                                } catch (err) {
                                    if ((err.code != 11000) || (err.errmsg.indexOf(hash) < 0)) {
                                        console.log(err);
                                    }
                                    // await session.abortTransaction();
                                }
                            };
                            return this.dbManager.executeTransaction(txFunc);
                        }
                    }
                    // Did not write anything to the database
                    return Promise.resolve();
                } catch (err) {
                    console.log("Updater eostimetoken::issue FAILED: "); console.log(err);
                    return Promise.resolve();
                }
            }
        },
        {
            /**************************
             * EOSTIMETOKEN::TRANSFER *
             **************************/
            actionType: "eostimetoken::transfer",
            updater: async (state, payload, blockInfo, context) => {
                try {
                    let receiver:string = Config.safeProperty(payload, ["receipt.receiver"], "eostimetoken");
                    let hash: string = Config.safeProperty(payload, ["transactionId"], null);
                    let actDigest:string = Config.safeProperty(payload, ["receipt.act_digest"], "");
                    if (hash && (receiver == "eostimetoken")) {
                        hash = md5(hash + payload.hex_data + actDigest);
                        payload["timestamp"] = blockInfo.timestamp;
                        payload["blockNumber"] = blockInfo.blockNumber;
                        payload["md5"] = hash;
                        let from: string = Config.safeProperty(payload, ["data.from"], null);
                        if (from == "eostimetoken") {
                            payload.data.from = null;
                        }
                        let memo: string = Config.safeProperty(payload, ["data.memo"], null);
                        let tab:any = this.typeAuctionBidIdsFromMemo(memo);
                        if (tab) {
                            payload["auctionType"] = tab.type;
                            payload["auctionId"] = tab.auctionId;
                            payload["bidId"] = tab.bidId;
                        }
                        let txFunc:(client:MongoClient, session:ClientSession) => void = async (client:MongoClient, session:ClientSession) => {
                            // await session.startTransaction({
                            //     readConcern: { level: 'snapshot' },
                            //     writeConcern: { w: 'majority' }
                            // });
                            try {
                                await this.auctionManager.timeTokenIssued(payload, session);
                                await this.dbManager.setConfig("currentBlockNumber", blockInfo.blockNumber, session);
                                await this.dbManager.commitWithRetry(session);
                            } catch (err) {
                                if ((err.code != 11000) || (err.errmsg.indexOf(hash) < 0)) {
                                    console.log(err);
                                }
                                // await session.abortTransaction();
                            }
                        };
                        return this.dbManager.executeTransaction(txFunc);
                    }
                    // Did not write anything to the database
                    return Promise.resolve();
                } catch (err) {
                    console.log("Updater eostimetoken::transfer FAILED: "); console.log(err);
                    return Promise.resolve();
                }
            }
        },
        {
            /*****************************
             * EOSTIMECONTR::RZPAYWINNER *
             *****************************/
            actionType: "eostimecontr::rzpaywinner",
            updater: async (state, payload, blockInfo, context) => {
                try {
                    let txFunc:(client:MongoClient, session:ClientSession) => void = async (client:MongoClient, session:ClientSession) => {
                        let receiver:string = Config.safeProperty(payload, ["receipt.receiver"], "eostimecontr");
                        let hash: string = Config.safeProperty(payload, ["transactionId"], null);
                        let actDigest:string = Config.safeProperty(payload, ["receipt.act_digest"], "");
                        if (hash && (receiver == "eostimecontr")) {
                            hash = md5(hash + payload.hex_data + actDigest);
                            payload["timestamp"] = blockInfo.timestamp;
                            payload["blockNumber"] = blockInfo.blockNumber;
                            payload["md5"] = hash;
                            let txFunc:(client:MongoClient, session:ClientSession) => void = async (client:MongoClient, session:ClientSession) => {
                                // await session.startTransaction({
                                //     readConcern: { level: 'snapshot' },
                                //     writeConcern: { w: 'majority' }
                                // });
                                try {
                                    await this.auctionManager.markAsPaid(payload);
                                    await this.dbManager.commitWithRetry(session);
                                } catch (err) {
                                    if ((err.code != 11000) || (err.errmsg.indexOf(hash) < 0)) {
                                        console.log(err);
                                    }
                                    // await session.abortTransaction();
                                }
                            };
                            return this.dbManager.executeTransaction(txFunc);

                            // console.log("================================== " + hash);
                            // console.log("RZPAYWINNER by eostimecontr");
                            // console.log(payload);
                            // console.log("==================================");
                            //
                            // // TODO - move this to eosio.token payment when memo has auction ID in it
                            // this.auctionManager.markAsPaid(payload).catch((err) => {
                            //     if ((err.code != 11000) || (err.errmsg.indexOf(hash) < 0)) {
                            //         console.log(err);
                            //     }
                            // });

                        }
                    };
                    // Did not write anything to the database
                    return Promise.resolve();
                } catch (err) {
                    console.log("Updater eostimecontr::rzpaywinner FAILED: "); console.log(err);
                    return Promise.resolve();
                }
            }
        },
        {
            /******************************
             * EOSTIMECONTR::RZBIDRECEIPT *
             ******************************/
            actionType: "eostimecontr::rzbidreceipt",
            updater: async (state, payload, blockInfo, context) => {
                try {
                    let receiver:string = Config.safeProperty(payload, ["receipt.receiver"], "eostimecontr");
                    let hash: string = Config.safeProperty(payload, ["transactionId"], null);
                    let actDigest:string = Config.safeProperty(payload, ["receipt.act_digest"], "");
                    if (hash && (receiver == "eostimecontr")) {
                        hash = md5(hash + payload.hex_data + actDigest);
                        payload["timestamp"] = blockInfo.timestamp;
                        payload["blockNumber"] = blockInfo.blockNumber;
                        payload["md5"] = hash;
                        let txFunc: (client: MongoClient, session: ClientSession) => void = async (client: MongoClient, session: ClientSession) => {
                            // await session.startTransaction({
                            //     readConcern: { level: 'snapshot' },
                            //     writeConcern: { w: 'majority' }
                            // });
                            try {
                                let biddingAccountName:string = Config.safeProperty(payload, ["data.bidder"], null);
                                if (biddingAccountName) {
                                    let user: any = await this.dbManager.getDocumentByKey("users", {accountName: biddingAccountName});
                                    if (user && user.referrer) {
                                        payload.data.referrer = user.referrer;
                                    } else {
                                        payload.data.referrer = null;
                                    }
                                    await this.auctionManager.bidReceipt(payload, session);
                                    await this.dbManager.setConfig("currentBlockNumber", blockInfo.blockNumber, session);
                                    await this.dbManager.commitWithRetry(session);
                                } else {
                                    console.log("Missing or malformed payload while processing EOSTIMECONTR::RZBIDRECEIPT");
                                    console.log(payload);
                                }
                            } catch (err) {
                                if ((err.code != 11000) || (err.errmsg.indexOf(hash) < 0)) {
                                    console.log(err);
                                }
                                // await session.abortTransaction();
                            };
                        };
                        return this.dbManager.executeTransaction(txFunc);
                    }
                    // Did not write anything to the database
                    return Promise.resolve();
                } catch (err) {
                    console.log("Updater eostimecontr::rzbidreceipt FAILED: "); console.log(err);
                    return Promise.resolve();
                }
            }
        }
    ];
    private effects:any[] = [
        {
            actionType: "eostimetoken::transfer",
            effect: (state, payload, blockInfo, context) => {

            }
        }
    ];

    constructor(dbManager:DBManager, auctionManager:AuctionManager) {
        this.dbManager = dbManager;
        this.auctionManager = auctionManager;
    }

    public getUpdaters():any {
        return this.updaters;
    }

    public getEffects():any {
        return this.effects;
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