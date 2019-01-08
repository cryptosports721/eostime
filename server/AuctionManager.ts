import {SocketMessage} from "./SocketMessage";
import {ClientConnection} from "./ClientConnection";
import {Config} from "./Config";
import {DBManager} from "./DBManager";
import {EosBlockchain} from "./EosBlockchain";
import moment = require("moment");
import {ClientSession, MongoClient} from "mongodb";
import {Moment} from "moment";

const request = require('request');
const ecc = require('eosjs-ecc');

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
    private serverKey:string;
    private auctions:any[] = new Array<any>();
    private outstandingPayoutRestartTransactions:any = {};
    private pollingTimer:any = null;
    private lastPayoutTime:number = 0;
    private recentWinners:any[] = null;
    private auctionTypeCounter:number = 0;
    private auctionTypes:any = {};
    private slackHook:string;

    /**
     * Constructs our auction manager
     *
     * @param serverConfig
     * @param sio
     * @param {DBManager} dbManager
     * @param serverKey
     * @param {EosBlockchain} eosBlockchain
     * @param {string} slackHook
     */
    constructor(serverConfig:any, sio:any, dbManager:DBManager, serverKey, eosBlockchain:EosBlockchain, slackHook:string) {
        this.serverConfig = serverConfig;
        this.sio = sio;
        this.dbManager = dbManager;
        this.serverKey = serverKey;
        this.eosBlockchain = eosBlockchain;
        this.slackHook = slackHook;

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
     * Called when the history scanner sees a winner transaction. We update our recent winners
     * structure and database.
     *
     * @param {number} auctionId
     * @param {number} blockNumber
     * @param {string} transactionId
     * @returns {Promise<void>}
     */
    public winnerPayoutTransaction(auctionId:number, blockNumber:number, transactionId:string):Promise<void> {
        return this.dbManager.updateDocumentByKey("auctions", {"id": auctionId}, {"blockNumber": blockNumber, "transactionId": transactionId}).then(() => {
            if (this.recentWinners) {
                for (let recentWinner of this.recentWinners) {
                    if (recentWinner.id == auctionId) {
                        recentWinner["blockNumber"] = blockNumber;
                        recentWinner["transactionId"] = transactionId;
                    }
                }
            }
            let payload:any = {
                auctionId: auctionId,
                blockNumber: blockNumber,
                transactionId: transactionId
            }

            // Notify clients of updated auction
            this.sio.sockets.emit(SocketMessage.STC_AUCTION_UPDATE, JSON.stringify(payload));
        });
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
            this.dbManager.getDocuments("auctionTypes", {}, {}, 100000).then((result:any[]) => {
                this.auctionTypes = {};
                for (let auctionType of result) {
                    this.auctionTypes[auctionType.auctionId] = auctionType;
                }
                this.auctionTypeCounter = 40;

                if (this.pollingTimer == null) {
                    pollFunc();
                }
            });
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
     * Returns the required bid signature for the currently running auction as
     * specified by its type.
     *
     * @param {string} accountName
     * @param {number} auctionType
     * @returns {string}
     */
    public getBidSignature(accountName:string, auctionType:number):string {
        let signature:string = null;
        for (let auction of this.auctions) {
            if (auction.type == auctionType) {
                let toSign:string = accountName + auction.remaining_bid_count + auction.id;
                signature = ecc.sign(toSign, this.serverKey);
            }
        }
        return signature;
    }

    /**
     * Polls the auction table from the blockchain
     * @returns {Promise<any>}
     */
    public pollAuctionTable():Promise<any> {
        // console.log("polling auction table at " + moment().format("dddd, MMMM Do YYYY, h:mm:ss a"));
        return new Promise<any>((resolve, reject) => {

            // Get new auction type data refresh every 120 polls (30 seconds)
            if (this.auctionTypeCounter <= 0) {
                this.dbManager.getDocuments("auctionTypes", {}, {}, 100000).then((result:any[]) => {
                    this.auctionTypes = {};
                    for (let auctionType of result) {
                        this.auctionTypes[auctionType.auctionId] = auctionType;
                    }
                    this.auctionTypeCounter = 120;
                });
            } else {
                this.auctionTypeCounter--;
            }

            this.eosBlockchain.getInfo().then((blockchainInfo) => {
                let headBlockTime:number = parseInt(moment( blockchainInfo.head_block_time + "+00:00").local().format("X"));
                this.eosBlockchain.getTable(this.serverConfig.eostimeContract, this.serverConfig.eostimeContractTable).then((data:any) => {
                    let auctionsFromBlockchain:any[] = Config.safeProperty(data, ["rows"], null);
                    let auctionToPayout:any = null;
                    if (auctionsFromBlockchain) {

                        // ----------------------------------------------------------------------------
                        // This is the main method that determines the state of the blockchain auctions
                        // by sorting them into "removed", "added", "changed", and "ended" lists.
                        // ----------------------------------------------------------------------------
                        let sortedAuctions:any = this.sortAuctions(headBlockTime, auctionsFromBlockchain);

                        for (let auction of sortedAuctions.removed) {
                            this.sio.sockets.emit(SocketMessage.STC_REMOVE_AUCTION, JSON.stringify(auction));
                        }
                        for (let auction of sortedAuctions.added) {
                            this.sio.sockets.emit(SocketMessage.STC_ADD_AUCTION, JSON.stringify(auction));
                        }
                        for (let auction of sortedAuctions.changed) {

                            // Reset our auction if instructed to
                            if (auction.resetToOriginalParams) {
                                console.log("=========> Resetting auction id: " + auction.id);
                                this.eosBlockchain.replaceAuctionParams(auction.id, auction.resetToOriginalParams).then((result) => {
                                    // Async call with no return
                                    console.log("=========> Auction id: " + auction.id + " has been reset");
                                }, (reject) => {
                                    console.log("1 Unexpected error resetToOriginalParams payoutAndReplace(" + auction.id + ")");
                                    console.log(reject);
                                    console.log("---------------");
                                }).catch((err) => {
                                    console.log("2 Unexpected error resetToOriginalParams payoutAndReplace(" + auction.id + ")");
                                    console.log(err);
                                    console.log("---------------");
                                });
                            } else {
                                // Notify clients of auction change
                                this.sio.sockets.emit(SocketMessage.STC_CHANGE_AUCTION, JSON.stringify(auction));

                                // Tell the last bidder to update his balances
                                let socketMessage:SocketMessage = ClientConnection.socketMessageFromAccountName(auction.last_bidder);
                                if (socketMessage) {
                                    socketMessage.stcUpdateBalances();
                                }
                            }
                        }
                        for (let auction of sortedAuctions.ended) {
                            if (!auctionToPayout &&
                                !auction.paid_out &&
                                !auction.resetToOriginalParams &&
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
                            this.linkToAuctions(auctionToPayout).then((params:any) => {

                                // --------------- FINISH UP INNER FUNCTION --------------
                                //
                                let finishUp = function(result) {
                                    delete this.outstandingPayoutRestartTransactions[auctionToPayout.id];

                                    let totalBids:number = auctionToPayout.init_bid_count - auctionToPayout.remaining_bid_count;
                                    this.notifySlack("[" + auctionToPayout.last_bidder + "] won " + auctionToPayout.prize_pool + " EOS in auction id " + auctionToPayout.id + " with " + totalBids + " total bids placed.");

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
                                }.bind(this);
                                //
                                // --------------- END OF FINISH UP INNER FUNCTION --------------

                                if (params) {
                                    this.eosBlockchain.payoutAndReplace(auctionToPayout.id, params).then((result) => {
                                        return finishUp(result);
                                    }).catch((err) => {
                                        delete this.outstandingPayoutRestartTransactions[auctionToPayout.id];
                                        console.log("Unexpected error finishUp() after blockchain payoutAndReplace(" + auctionToPayout.id + ")");
                                        console.log(err);
                                        console.log("---------------");
                                    });
                                } else {
                                    this.eosBlockchain.payoutAndRestartAuction(auctionToPayout.id).then((result) => {
                                        return finishUp(result);
                                    }).catch((reject) => {
                                        delete this.outstandingPayoutRestartTransactions[auctionToPayout.id];
                                        console.log("Unexpected error finishUp() after blockchain payoutAndRestartAuction(" + auctionToPayout.id + ")");
                                        console.log(reject);
                                        console.log("---------------");
                                    });
                                }
                            }).catch((error: any) => {
                                delete this.outstandingPayoutRestartTransactions[auctionToPayout.id];
                                console.log("Failed to payout/rollover auction TYPE: " + auctionToPayout.type + " / ID: " + auctionToPayout.id);
                                console.log(error);
                            });
                        }
                    }

                    resolve();
                }).catch((err) => {
                    console.log("=======================================================================");
                    console.log("Failed to read redzones table");
                    console.log("=======================================================================");
                    console.log(err);
                    console.log("=======================================================================");

                    // Re-enable polling in 10 seconds
                    setTimeout(() => {
                        this.enablePolling(true);
                    }, 10000);
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

    /**
     * Determines what the next auction should be
     * @param auctionToCheck
     * @returns {Promise<any>}
     */
    private linkToAuctions(auctionToCheck:any):Promise<any> {
        return new Promise<any>((resolve, reject) => {
            let auctionType:any = this.auctionTypes.hasOwnProperty(auctionToCheck.type) ? this.auctionTypes[auctionToCheck.type] : null;
            if (auctionType && auctionType.hasOwnProperty("nextType") && (auctionType.nextType != auctionType.auctionId)) {
                let nextAuctionType:any = this.auctionTypes.hasOwnProperty(auctionType.nextType) ? this.auctionTypes[auctionType.nextType] : null;
                if (nextAuctionType) {
                    let params:any = {...nextAuctionType.auctionParams};
                    resolve(params);
                } else {
                    resolve(null);
                }
            } else {
                resolve(null);
            }
        });
    };

    /**
     * Returns the promise to use to payout an auction taking into account
     * scamming activity.
     *
     * @param {any} auctionToCheck
     * @returns {Promise<any>}
     */
    private scamCheck(auctionToCheck:any):Promise<any> {

        return new Promise<any>((resolve, reject) => {

            let auctionType:any = this.auctionTypes.hasOwnProperty(auctionToCheck.type) ? this.auctionTypes[auctionToCheck.type] : null;
            if (auctionType && auctionType.hasOwnProperty("scammerMinBidders")) {

                let scammerMinBidders:number = auctionType.scammerMinBidders;
                let scammerMinActiveUsers:number = auctionType.scammerMinActiveUsers;
                let scammerTimeFactor:number = auctionType.scammerTimeFactor;
                let scammerMaxTime:number = auctionType.scammerMaxTime;
                let scammerResetWindow: number = auctionType.scammerResetWindow;
                let params:any = {...auctionType.auctionParams};

                this.dbManager.getDistinct("eostimecontr",
                    "bidder",
                    {name: "rzbidreceipt", redzone_id: auctionToCheck.id}).then((bidders: any[]) => {

                    let distinctIPs: any = {};
                    let distinctIPCount: number = this.activeDistinctIPCount(distinctIPs);

                    let isScam: boolean = bidders.length < scammerMinBidders || distinctIPCount < scammerMinActiveUsers;

                    if (!isScam) {
                        if (params.init_duration_secs != auctionToCheck.init_duration_secs) {
                            // Return to original parameters
                            console.log("Returning to original parameters");
                            resolve(params);
                        } else {
                            // At original parameters, so we restart
                            console.log("Rolling Over");
                            resolve(null);
                        }
                    } else {
                        // Increase initial duration by the factor
                        params.init_duration_secs = Math.floor(auctionToCheck.init_duration_secs * scammerTimeFactor);
                        if (params.init_duration_secs > scammerMaxTime) {
                            params.init_duration_secs = scammerMaxTime;
                        }
                        this.notifySlack("Bumped duration of auction type " + auctionToCheck.type + " to " + params.init_duration_secs + " [bidder count: " + bidders.length + "] [distinct ips: " + distinctIPCount + "]");
                        console.log("New Duration: " + params.init_duration_secs);
                        resolve(params);
                    }

                });

            } else {
                // Simply roll the auction over with a rzrestart
                resolve(null);
            }
        });
    }

    /**
     * Returns the number of distinct IPs currently connected
     * @returns {number}
     */
    private activeDistinctIPCount(distinctIPs:any = {}):number {
        let toRet:number = 0;
        for (let i:number = 0; i < ClientConnection.CONNECTIONS.length; i++) {
            let connection:ClientConnection = ClientConnection.CONNECTIONS[i];
            let ip:string = connection.getIPAddress();
            if (!distinctIPs.hasOwnProperty(ip)) {
                toRet++;
                distinctIPs[ip] = 1;
            } else {
                distinctIPs[ip] += 1;
            }
        }
        return toRet;
    }

    /**
     * Adjusts the auctions from the blockchain that have technically ended to look
     * like a running auction if enabled.
     *
     * @param {number} headBlockTime
     * @param {any[]} auctionsFromBlockchain
     * @returns {any}
     */
    private restartEndedAuctions(headBlockTime:number, blockchainAuction:any) {
        let bcExpireUnixTime: number = parseInt(moment(blockchainAuction.expires + "+00:00").local().format("X"));
        if ((bcExpireUnixTime <= headBlockTime) && (blockchainAuction.init_bid_count == blockchainAuction.remaining_bid_count)) {

            // This auction in memory has expired, so let's look at the blockchain
            // auction and see if we should spoof-restart it
            let secsSinceExpire: number = headBlockTime - bcExpireUnixTime;
            let secsIntoCurrentRun:number = secsSinceExpire % blockchainAuction.init_duration_secs;
            let secsUntilCurrentRunExpires:number = blockchainAuction.init_duration_secs - secsIntoCurrentRun;
            let expireUnixTime:number = headBlockTime + secsUntilCurrentRunExpires;
            let m:Moment = moment.unix(expireUnixTime).utc();
            blockchainAuction.expires = m.format("YYYY-MM-DD") + "T" + m.format("HH:mm:ss");
            blockchainAuction.iterationCount = Math.floor(secsSinceExpire / blockchainAuction.init_duration_secs) + 1;

        } else {
            blockchainAuction.iterationCount = 0;
            blockchainAuction.aggregatedRunTime = 0;
        }
    }

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
                console.log("Removing: " + currentAuction.type + " @ " + Config.friendlyTimestamp());
                toRet.removed.push(currentAuction);
            } else {

                blockchainAuction.hasEnded = false;

                let originalBlockchainAuctionExpireUnixTime:number = parseInt(moment(blockchainAuction.expires + "+00:00").local().format("X"));

                // Handles fantom auctions (ones with no bids that roll over so that we don't have to
                // spend CPU on empty auctions)
                this.restartEndedAuctions(headBlockTime, blockchainAuction);

                // See if we need to reset our auction to its original params because
                // we have exceeded our scammerResetWindow after previously bumping
                // the auction's expire time.
                blockchainAuction.resetToOriginalParams = null;
                if (blockchainAuction.remaining_bid_count == blockchainAuction.init_bid_count) {
                    if (this.auctionTypes.hasOwnProperty(blockchainAuction.type)) {
                        let auctionType: any = this.auctionTypes[blockchainAuction.type];
                        if (auctionType.hasOwnProperty("scammerResetWindow") && (auctionType.auctionParams.init_duration_secs != blockchainAuction.init_duration_secs)) {
                            let secsSinceExpire: number = headBlockTime - originalBlockchainAuctionExpireUnixTime;
                            if (secsSinceExpire > 0) {
                                if (secsSinceExpire > auctionType.scammerResetWindow) {
                                    // console.log("=========> Need to reset auction id: " + blockchainAuction.id + " (" + secsSinceExpire + ", " + auctionType.scammerResetWindow + ")");
                                    blockchainAuction.resetToOriginalParams = {...auctionType.auctionParams};
                                }
                            }
                        }
                    }
                }

                // See if we have ended
                let expireUnixTime: number = blockchainAuction.hasOwnProperty("expireUnixTime") ? blockchainAuction.expireUnixTime : parseInt(moment(blockchainAuction.expires + "+00:00").local().format("X"));
                if ((blockchainAuction.remaining_bid_count == 0) || (expireUnixTime <= headBlockTime)) {

                    // Yup, we ended - we require 5 seconds (10 polls) before we declare the auction ended
                    if (!currentAuction.hasOwnProperty("endedPollCount")) {
                        blockchainAuction["endedPollCount"] = 10;
                    } else {
                        blockchainAuction["endedPollCount"] = currentAuction.endedPollCount - 1;
                    }
                    if (blockchainAuction.endedPollCount <= 0) {
                        blockchainAuction.hasEnded = true;
                        toRet.ended.push(blockchainAuction);
                    }

                } else {
                    // See if this auction has changed
                    if ((blockchainAuction.remaining_bid_count < currentAuction.remaining_bid_count) || (blockchainAuction.id != currentAuction.id) || (blockchainAuction.iterationCount != currentAuction.iterationCount)) {
                        // Yup, it has changed
                        let blockchainGlitch:boolean = (blockchainAuction.remaining_bid_count > currentAuction.remaining_bid_count)
                        if (blockchainAuction.last_bidder != "eostimecontr") {
                            this.notifySlack("Bid " + blockchainAuction.bid_price + " EOS received from [" + blockchainAuction.last_bidder + "] on auction type " + blockchainAuction.type + " id " + blockchainAuction.id);
                        }
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
                console.log("Adding: " + blockchainAuction.type + " @ " + Config.friendlyTimestamp());
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

            // If the auction has not ended, present the prize pool as what the player
            // will in-fact win if they place the bid (by adding the to-pool portion of
            // the bid about to be placed.
            if (!auction.hasEnded) {
                let toPot: number = 1.0 - auction.house_portion_x100k / 100000;
                let pool: number = parseFloat(auction.prize_pool) + parseFloat(auction.bid_price) * toPot;
                auction.prize_pool = pool.toFixed(4);
            }

            if (this.auctionTypes.hasOwnProperty(auction.type)) {
                let at:any = this.auctionTypes[auction.type];
                auction.html = "<div class=\"ribbon ribbon-" + at.color + " hot\"></div><div class=\"ribbon-contents\"><i class=\"" + at.icon + "\"></i><span>" + at.text + "</span></div>";
            }
        }

        this.auctions = auctionsFromBlockchain;
        return toRet;
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