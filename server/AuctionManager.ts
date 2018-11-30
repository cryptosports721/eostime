import {SocketMessage} from "./SocketMessage";
import {ClientConnection} from "./ClientConnection";
import {Config} from "./Config";
import {DBManager} from "./DBManager";
import {EosBlockchain} from "./EosBlockchain";
import moment = require("moment");
import {ClientSession, MongoClient} from "mongodb";

export class AuctionManager {

    // { account_name: 'chassettny11',
    // head_block_num: 23292537,
    // head_block_time: '2018-11-07T18:26:57.000',
    // privileged: false,
    // last_code_update: '1970-01-01T00:00:00.000',
    // created: '2018-10-31T16:17:34.000',
    // core_liquid_balance: '218.8290 EOS',
    // ram_quota: 5474,
    // net_weight: 1000000,
    // cpu_weight: 1000000,
    // net_limit: { used: 715, available: 19127337, max: 19128052 },
    // cpu_limit: { used: 4794, available: 3634493, max: 3639287 },
    // ram_usage: 3574,
    // permissions:
    //     [ { perm_name: 'active', parent: 'owner', required_auth: [Object] },
    //         { perm_name: 'owner', parent: '', required_auth: [Object] } ],
    // total_resources:
    //     { owner: 'chassettny11',
    //         net_weight: '100.0000 EOS',
    //         cpu_weight: '100.0000 EOS',
    //         ram_bytes: 4074 },
    // self_delegated_bandwidth:
    //     { from: 'chassettny11',
    //         to: 'chassettny11',
    //         net_weight: '100.0000 EOS',
    //         cpu_weight: '100.0000 EOS' },
    // refund_request: null,
    // voter_info:
    //     { owner: 'chassettny11',
    //         proxy: '',
    //         producers: [],
    //         staked: 2000000,
    //         last_vote_weight: '0.00000000000000000',
    //         proxied_vote_weight: '0.00000000000000000',
    //         is_proxy: 0,
    //         reserved1: 0,
    //         reserved2: 0,
    //         reserved3: '0 ' } }

    // Broadcast auctionBid event to all connected clients
    // this.sio.sockets.emit('auctionBid',{ description: clients + ' clients connected!'});

    private sio:any;
    private dbManager:DBManager;
    private eosBlockchain:EosBlockchain;
    private serverConfig:any;
    private auctions:any[] = new Array<any>();
    private outstandingPayoutRestartTransactions:any = {};
    private pollingTimer:any = null;
    private lastPayoutTime:number = 0;
    private recentWinners:any[] = null;

    /**
     * Constructs our auction manager
     * @param sio
     * @param {DBManager} dbManager
     */
    constructor(serverConfig:any, sio:any, dbManager:DBManager, eosBlockchain:EosBlockchain) {
        this.serverConfig = serverConfig;
        this.sio = sio;
        this.dbManager = dbManager;
        this.eosBlockchain = eosBlockchain;

        // Retrieve the most recent list of auction winners from the database
        dbManager.getDocuments("auctions", {}, {expires: -1}, Config.WINNERS_LIST_LIMIT).then((recentWinners:any[]) => {
            if (recentWinners && recentWinners.length > 0) {
                this.recentWinners = recentWinners;
                console.log("Recent Winners at startup: ");
                for (let winner of this.recentWinners) {
                    let expires:string = moment.unix(winner.expires).format();
                    console.log(winner.last_bidder + " won " + winner.prize_pool + " at " + expires);
                }
            } else {
                this.recentWinners = Array<any>();
            }
        }, (reason) => {
            console.log("Unable to retrieve most recent list of auctions");
            console.log(reason);
        });
    }

    public getRecentWinners():any[] {
        return this.recentWinners;
    }

    /**
     * Enables polling of the auction table
     * @param {boolean} enable
     */
    public enablePolling(enable:boolean):void {

        let pollFunc = async function() {
            this.pollAuctionTable().then((result) => {
                this.pollingTimer = setTimeout(() => {
                    this.pollingTimer = null;
                    pollFunc();
                }, 250);
            }).catch((err) => {
                console.log("Error polling auction table - retry in 5 seconds");
                this.pollingTimer = setTimeout(() => {
                    this.pollingTimer = null;
                    pollFunc();
                }, 5000);
            });
        }.bind(this);

        if (enable) {
            if (this.pollingTimer == null) {
                pollFunc();
            }
        } else {
            if (this.pollingTimer) {
                clearTimeout(this.pollingTimer);
                this.pollingTimer = null;
            }
        }
    }

    /**
     * Returns the auctions we are currently monitoring
     * @returns {any[]}
     */
    public getAuctions():any[] {
        return this.auctions;
    }

    /**
     * Polls the auction table from the blockchain
     * @returns {Promise<any>}
     */
    public pollAuctionTable():Promise<any> {
        // console.log("polling auction table at " + moment().format("dddd, MMMM Do YYYY, h:mm:ss a"));
        return new Promise<any>((resolve, reject) => {
            this.eosBlockchain.getInfo().then((blockchainInfo) => {
                let headBlockTime:number = parseInt(moment( blockchainInfo.head_block_time + "+00:00").local().format("X"));
                this.eosBlockchain.getTable(this.serverConfig.eostimeContract, this.serverConfig.eostimeContractTable).then((data:any) => {
                    let auctionsFromBlockchain:any[] = Config.safeProperty(data, ["rows"], null);
                    let auctionToPayout:any = null;
                    if (auctionsFromBlockchain) {
                        let sortedAuctions:any = this.sortAuctions(headBlockTime, auctionsFromBlockchain);
                        for (let auction of sortedAuctions.removed) {
                            this.sio.sockets.emit(SocketMessage.STC_REMOVE_AUCTION, JSON.stringify(auction));
                        }
                        for (let auction of sortedAuctions.added) {
                            this.sio.sockets.emit(SocketMessage.STC_ADD_AUCTION, JSON.stringify(auction));
                        }
                        for (let auction of sortedAuctions.changed) {
                            this.sio.sockets.emit(SocketMessage.STC_CHANGE_AUCTION, JSON.stringify(auction));

                            // Tell the last bidder to update his balances
                            let socketMessage:SocketMessage = ClientConnection.socketMessageFromAccountName(auction.last_bidder);
                            if (socketMessage) {
                                socketMessage.stcUpdateBalances();
                            }
                        }
                        for (let auction of sortedAuctions.ended) {
                            if (!auctionToPayout &&
                                !auction.paid_out &&
                                !this.outstandingPayoutRestartTransactions[auction.id]) {
                                auctionToPayout = auction;
                            }
                            this.sio.sockets.emit(SocketMessage.STC_END_AUCTION, JSON.stringify(auction));
                        }
                    }

                    // Payout a winning auction (asynchronously)
                    if (auctionToPayout) {
                        // Only proceed with this blockchain action if we have a winner being paid out
                        // and there have been more than 2 seconds since the last winner payout. This is because
                        // we want to avoid putting more than one deferred payout on the blockchain at one time.
                        let now:number = new Date().getTime();
                        let timeSinceLastPayout:number = now - this.lastPayoutTime;
                        if ((timeSinceLastPayout > 2000) || (auctionToPayout.init_bid_count == auctionToPayout.remaining_bid_count)) {
                            this.outstandingPayoutRestartTransactions[auctionToPayout.id] = true;
                            this.eosBlockchain.payoutAuction(auctionToPayout.id).then((result) => {
                                delete this.outstandingPayoutRestartTransactions[auctionToPayout.id];

                                if (auctionToPayout.init_bid_count != auctionToPayout.remaining_bid_count) {
                                    this.lastPayoutTime = new Date().getTime();
                                    this.sio.sockets.emit(SocketMessage.STC_WINNER_AUCTION, JSON.stringify(auctionToPayout));

                                    // Store this winner auction in our list of recent winners cache
                                    this.recentWinners.unshift(auctionToPayout);
                                    if (this.recentWinners.length > Config.WINNERS_LIST_LIMIT) {
                                        this.recentWinners.splice(Config.WINNERS_LIST_LIMIT, this.recentWinners.length - Config.WINNERS_LIST_LIMIT);
                                    }

                                    // Tell the winner to update his balances 10 seconds from now
                                    let socketMessage: SocketMessage = ClientConnection.socketMessageFromAccountName(auctionToPayout.last_bidder);
                                    if (socketMessage) {
                                        socketMessage.stcUpdateBalances();
                                        setTimeout(() => {
                                            socketMessage.stcUpdateBalances();
                                        }, 10000);
                                    }

                                    // Save our auction that we won
                                    return this.dbManager.insertDocument("auctions", auctionToPayout);
                                } else {
                                    return Promise.resolve(null);
                                }
                            }).then((result) => {

                                // Do something if we want to

                            }).catch((error: any) => {
                                delete this.outstandingPayoutRestartTransactions[auctionToPayout.id];
                                console.log("Failed to payout/rollover auction TYPE: " + auctionToPayout.type + " / ID: " + auctionToPayout.id);
                                console.log(error);
                            });
                        }
                    }

                    resolve();
                });
            }).catch((err) => {
                reject(err);
            });
        });
    }

    /**
     * Sets our auction status as having been paid (we saw a
     * eostimecontr::rzpaywinner action on the blockchain).
     * @param payload
     * @returns {Promise<void>}
     */
    public markAsPaid(payload:any):Promise<void> {
        let updatedValues:any = {
            status: "paid"
        };
        return this.dbManager.updateDocumentByKey("auctions", {id: payload.redzone_id}, updatedValues);
    }

    /**
     * Tag the paid auction with the transaction ID of the payment
     * transaction (we saw an eosio.token::transfer with winning
     * memo field.
     * @param {number} auctionId
     * @param {string} txid
     * @returns {Promise<void>}
     */
    public assignPaymentTransactionId(auctionId:number, txid:string):Promise<void> {
        let updatedValues:any = {
            winner_payment_txid: txid
        };
        return this.dbManager.updateDocumentByKey("auctions", {id: auctionId}, updatedValues);
    }

    /**
     * Called as each block is processed from the blockchain
     * @param {number} blockNumber
     * @param {string} timestamp
     * @returns {Promise<any>}
     */
    public processBlock(blockNumber:number, timestamp:string):Promise<void> {
        return this.dbManager.setConfig("currentBlockNumber", blockNumber);
    }

    /**
     * Called when the watcher needs to roll back while scanning the blockchain
     * @param {number} blockNumber
     * @returns {Promise<any>}
     */
    public rollbackToBlock(blockNumber:number):Promise<any> {
        // let txFunc:(client:MongoClient, session:ClientSession) => void = async (client:MongoClient, session:ClientSession) => {
        //     try {
        //         await this.dbManager.updateDocumentByKey("applicationSettings", {key: "currentBlockNumber"}, {value: blockNumber}, session);
        //         await this.dbManager.deleteDocumentsByKey("bidreceipts", {blockNumber: {$gt: blockNumber}}, session);
        //         await this.dbManager.deleteDocumentsByKey("eostimecontr",{blockNumber: {$gt: blockNumber}}, session);
        //         await this.dbManager.deleteDocumentsByKey("timetokens", {blockNumber: {$gt: blockNumber}}, session);
        //     } catch (err) {
        //         console.log("Error rolling back to block " + blockNumber.toString());
        //         console.log(err);
        //     }
        // };
        // return this.dbManager.executeTransaction(txFunc);

        let promises:Promise<void>[] = new Array<Promise<void>>();
        promises.push(this.dbManager.updateDocumentByKey("applicationSettings", {key: "currentBlockNumber"}, {value: blockNumber}));
        promises.push(this.dbManager.deleteDocumentsByKey("bidreceipts", {blockNumber: {$gt: blockNumber}}));
        promises.push(this.dbManager.deleteDocumentsByKey("eostimecontr",{blockNumber: {$gt: blockNumber}}));
        promises.push(this.dbManager.deleteDocumentsByKey("timetokens", {blockNumber: {$gt: blockNumber}}));
        return Promise.all(promises);
    }

    /**
     * Records an EOS transfer to/from a particular contract
     * @param {string} collection
     * @param payload
     * @returns {Promise<void>}
     */
    public eosTransfer(collection:string, payload:any, session:ClientSession = null):Promise<void> {
        let timestamp:number = parseInt(moment.utc(payload.timestamp).format("X"));
        let quantity:string|number = Config.safeProperty(payload, ["data.quantity"], null);
        if (quantity) {
            quantity = parseFloat(<string> quantity);
        }
        let document:any = {
            md5: payload.md5,
            timestamp: timestamp,
            blockNumber: payload.blockNumber,
            txid: Config.safeProperty(payload, ["transactionId"], null),
            from: Config.safeProperty(payload, ["data.from"], null),
            to: Config.safeProperty(payload, ["data.to"], null),
            quantity: quantity,
            memo: Config.safeProperty(payload, ["data.memo"], null)
        }
        if (payload.hasOwnProperty("auctionType")) {
            document["auctionType"] = payload.auctionType;
        } else {
            document["auctionType"] = null;
        }
        if (payload.hasOwnProperty("auctionId")) {
            document["auctionId"] = payload.auctionId;
        } else {
            document["auctionId"] = null;
        }
        if (payload.hasOwnProperty("bidId")) {
            document["bidId"] = payload.bidId;
        } else {
            document["bidId"] = null;
        }
        return this.dbManager.insertDocument(collection, document, session);
    }

    /**
     * Records a bid receipt
     * @param payload
     * @param {ClientSession} session
     * @returns {Promise<void>}
     */
    public bidReceipt(payload:any, session:ClientSession = null):Promise<void> {
        let timestamp:number = parseInt(moment.utc(payload.timestamp).format("X"));
        let document:any = {
            md5: payload.md5,
            timestamp: timestamp,
            blockNumber: payload.blockNumber,
            txid: Config.safeProperty(payload, ["transactionId"], null),
            bidder: payload.data.bidder,
            referrer: payload.data.referrer,
            auctionId: payload.data.redzone_id,
            auctionType: payload.data.redzone_type,
            bidPrice: parseFloat(payload.data.bid_price),
            houseEOS: parseFloat(payload.data.house_portion),
            referrerEOS: parseFloat(payload.data.referrer_bonus),
            bidderTIME: parseFloat(payload.data.bidder_bonus)
        }
        return this.dbManager.insertDocument("bidreceipts", document, session);
    }

    /**
     * Records a new time token issuance into the database
     *
     * @param payload
     * @param {ClientSession} session
     * @returns {Promise<void>}
     */
    public timeTokenIssued(payload:any, session:ClientSession = null):Promise<void> {
        let timestamp:number = parseInt(moment.utc(payload.timestamp).format("X"));
        let quantity:string|number = Config.safeProperty(payload, ["data.quantity"], null);
        if (quantity) {
            quantity = parseFloat(<string> quantity);
        }
        let document:any = {
            md5: payload.md5,
            timestamp: timestamp,
            blockNumber: payload.blockNumber,
            txid: Config.safeProperty(payload, ["transactionId"], null),
            from: Config.safeProperty(payload, ["data.from"], null),
            to: Config.safeProperty(payload, ["data.to"], null),
            quantity: quantity,
            memo: Config.safeProperty(payload, ["data.memo"], null)
        }
        if (payload.hasOwnProperty("auctionType")) {
            document["auctionType"] = payload.auctionType;
        } else {
            document["auctionType"] = null;
        }
        if (payload.hasOwnProperty("auctionId")) {
            document["auctionId"] = payload.auctionId;
        } else {
            document["auctionId"] = null;
        }
        if (payload.hasOwnProperty("bidId")) {
            document["bidId"] = payload.bidId;
        } else {
            document["bidId"] = null;
        }
        return this.dbManager.insertDocument("timetokens", document, session);
    }

    // ------------------------------------------------------------------------
    // PRIVATE METHODS
    // ------------------------------------------------------------------------

    // An auction structure looks like this:
    // {
    //     "id": 1,
    //     "creation_time": "2018-11-08T01:56:00",
    //     "prize_pool": "1.0090 EOS",
    //     "bid_price": "0.0100 EOS",
    //     "last_bidder": "ghassett1113",
    //     "expires": "2018-11-08T18:36:00",
    //     "remaining_bid_count": 249,
    //     "init_prize_pool": "1.0000 EOS",
    //     "init_bid_count": 250,
    //     "enabled": 1,
    //     "auto_refill": 0,
    //     "init_duration_secs": 60000,
    //     "init_redzone_secs": 15
    // }

    /**
     * Merges the currently held auctions with the new auctions received
     * from the blockchain.
     * @param {number} headBlockTime
     * @param {any[]} auctionsFromBlockchain
     * @returns {any}
     */
    private sortAuctions(headBlockTime:number , auctionsFromBlockchain:any[]):any {

        let toRet:any = {
            "removed": new Array<any>(),
            "added": new Array<any>(),
            "changed": new Array<any>(),
            "ended": new Array<any>()
        };

        // Loop through our existing auctions looking for removed, ended, or changed entries
        for (let currentAuction of this.auctions) {

            // Let's make sure the auction is still in the table
            let blockchainAuction: any = auctionsFromBlockchain.find((bcval) => {
                return currentAuction.type == bcval.type;
            });
            if (!blockchainAuction) {
                // This auction is no longer available
                console.log("Removing: " + currentAuction.type);
                console.log(auctionsFromBlockchain);
                toRet.removed.push(currentAuction);
            } else {
                // See if we have ended
                let expireUnixTime: number = parseInt(moment(blockchainAuction.expires + "+00:00").local().format("X"));
                if ((blockchainAuction.remaining_bid_count == 0) || (expireUnixTime <= headBlockTime)) {
                    // Yup, we ended
                    toRet.ended.push(blockchainAuction);
                } else {
                    // See if this auction has changed
                    if ((blockchainAuction.remaining_bid_count != currentAuction.remaining_bid_count) || (blockchainAuction.id != currentAuction.id)) {
                        // Yup, it has changed
                        toRet.changed.push(blockchainAuction);
                    }
                }
            }
        }

        // Loop through our auctions from the blockchain looking for ones
        // that need to be added.
        for (let blockchainAuction of auctionsFromBlockchain) {
            // Let's make sure the auction is still in the table
            let currentAuction: any = this.auctions.find((currval) => {
                return blockchainAuction.type == currval.type;
            });
            if (!currentAuction) {
                toRet.added.push(blockchainAuction);
            }
        }

        // We are going to use our server time as block time (assumes
        // miners are using pretty accurate clock)
        headBlockTime = Math.floor(new Date().getTime() / 1000);

        // Tune up our auction data
        for (let auction of auctionsFromBlockchain) {
            auction.prize_pool = auction.prize_pool.split(" ")[0];
            auction.bid_price = auction.bid_price.split(" ")[0];
            auction.expires = parseInt(moment(auction.expires + "+00:00").local().format("X"));
            auction.creation_time = parseInt(moment(auction.creation_time + "+00:00").local().format("X"));
            auction.block_time = headBlockTime;
            auction.status = ((auction.remaining_bid_count == 0) || (auction.expires < headBlockTime)) ? "ended" : "active";
        }

        this.auctions = auctionsFromBlockchain;
        return toRet;
    }
}