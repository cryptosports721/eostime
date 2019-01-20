import {SocketMessage} from "./SocketMessage";
import {ClientConnection} from "./ClientConnection";
import {Config} from "./Config";
import {DBManager} from "./DBManager";
import {EosBlockchain} from "./EosBlockchain";
import moment = require("moment");
import {ClientSession, MongoClient} from "mongodb";
import {Moment} from "moment";
import {DBMysql} from "./DBMysql";
import {auctions} from "./entities/auctions";
import {bid} from "./entities/bid";
import {HarpoonManager} from "./HarpoonManager";
import {user} from "./entities/user";
import {serverSeeds} from "./entities/serverSeeds";
import {auctionType} from "./entities/auctionType";
import {harpoon} from "./entities/harpoon";

const request = require('request');
const ecc = require('eosjs-ecc');
const crypto = require('crypto');

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
    private dbMySql:DBMysql;
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
    private harpoonManager:HarpoonManager;

    /**
     * Constructs our auction manager
     *
     * @param serverConfig
     * @param sio
     * @param {DBManager} dbManager
     * @param {DBMysql} dbMySql
     * @param serverKey
     * @param {EosBlockchain} eosBlockchain
     * @param {string} slackHook
     */
    constructor(serverConfig:any, sio:any, dbManager:DBManager, dbMySql:DBMysql, serverKey, eosBlockchain:EosBlockchain, slackHook:string) {
        this.serverConfig = serverConfig;
        this.sio = sio;
        this.dbManager = dbManager;
        this.dbMySql = dbMySql;
        this.serverKey = serverKey;
        this.eosBlockchain = eosBlockchain;
        this.slackHook = slackHook;
        this.harpoonManager = new HarpoonManager(this.dbMySql, serverKey);;

        if (this.dbMySql) {
            this.dbMySql.loadRecentWinners(Config.WINNERS_LIST_LIMIT).then((recentWinners) => {
                if (recentWinners && recentWinners.length > 0) {
                    this.recentWinners = recentWinners;
                    for (let winner of this.recentWinners) {
                        let expires: string = moment.unix(winner.expires).format();
                    }
                } else {
                    this.recentWinners = Array<any>();
                }
            }, (reason) => {
                console.log("Unable to retrieve most recent list of auctions");
                console.log(reason);
            })
        }

        // if (this.dbManager) {
        //     // Retrieve the most recent list of auction winners from the database
        //     dbManager.getDocuments("auctions", {}, {expires: -1}, Config.WINNERS_LIST_LIMIT).then((recentWinners: any[]) => {
        //         if (recentWinners && recentWinners.length > 0) {
        //             this.recentWinners = recentWinners;
        //             console.log("Recent Winners at startup: ");
        //             for (let winner of this.recentWinners) {
        //                 let expires: string = moment.unix(winner.expires).format();
        //                 console.log(winner.last_bidder + " won " + winner.prize_pool + " at " + expires);
        //             }
        //         } else {
        //             this.recentWinners = Array<any>();
        //         }
        //     }, (reason) => {
        //         console.log("Unable to retrieve most recent list of auctions");
        //         console.log(reason);
        //     });
        // }
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
    public async enablePolling(enable:boolean):Promise<void> {

        return new Promise<void>((resolve, reject) => {
            try {
                let pollFunc = async function () {
                    this.pollAuctionTable().then((result) => {
                        this.pollingTimer = setTimeout(() => {
                            this.pollingTimer = null;
                            pollFunc();
                        }, 250);
                    }).catch((err) => {
                        console.log("Error polling auction table - retry in 5 seconds");
                        console.log(err);
                        this.pollingTimer = setTimeout(() => {
                            this.pollingTimer = null;
                            pollFunc();
                        }, 5000);
                    });
                }.bind(this);

                this.dbMySql.entityManager().find(auctionType, {}).then((auctionTypes) => {
                    for (let at of auctionTypes) {
                        this.auctionTypes[at.typeId] = at;
                        this.auctionTypeCounter = 120;
                    }

                    if (enable) {
                        pollFunc();
                    } else {
                        if (this.pollingTimer) {
                            clearTimeout(this.pollingTimer);
                            this.pollingTimer = null;
                        }
                    }

                    resolve();

                }, (reason) => {
                    console.log("Couldn't find any auctionTypes");
                    console.log(reason);
                });

            } catch (err) {
                reject(err);
            }
        });
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
    public getBidSignature(accountName:string, auctionType:number):Promise<string> {
        return new Promise<string>(async (resolve, reject) => {
            try {
                let signature: string = null;
                for (let auction of this.auctions) {
                    if (auction.type == auctionType) {
                        let bomb: harpoon = await this.dbMySql.entityManager().findOne(harpoon, {
                            "auctionId": auction.id,
                            "accountName": accountName
                        });
                        if (bomb) {
                            resolve("HARPOON");
                            return;
                        } else {
                            let toSign: string = accountName + auction.remaining_bid_count + auction.id;
                            signature = ecc.sign(toSign, this.serverKey);
                            resolve(signature);
                            return;
                        }
                    }
                }
                reject(new Error("No auction of type " + auctionType + " was available."));
            } catch (err) {
                reject(err);
            }
        });
    }

    public getHarpoonSignature(accountName:string, auctionId:number):Promise<any> {
        return new Promise<any>(async (resolve, reject) => {
           try {

               let auction:any = this.auctions.find((a:any):boolean => {
                   return a.id == auctionId;
               });

               let toRet:any = {status: 'error'};
               if (auction) {
                   let blockchainInfo:any = await this.eosBlockchain.getInfo();
                   let headBlockTime:number = parseInt(moment( blockchainInfo.head_block_time + "+00:00").local().format("X"));
                   console.log(auction);
                   console.log("Head Block Time: " + headBlockTime + " Expire: " + auction.expires);
                   if ((auction.remaining_bid_count > 0) && (auction.expires > headBlockTime)) {
                       // (1) Is this user in the auction itself
                       if (!auction.odds.hasOwnProperty(accountName)) {
                           toRet.message = {english: accountName + " is not a participant in the specified auction.", chinese: accountName + "不是指定拍卖的参与者。"};
                       } else {
                           // (2) Has the user already harpooned this auction
                           let hasHarpooned:boolean = await this.hasHarpooned(accountName, auctionId);
                           if (hasHarpooned) {
                               toRet.message = {english: accountName + " has already harpooned this auction.", chinese: accountName + " 已经对这次拍卖进行了抨击。"};
                               // (3) Is the bomber the high bidder
                           } else if (accountName == auction.last_bidder) {
                               toRet.message = {english: "An auction leader cannot harpoon himself.", chinese: "拍卖领导者不能用自己的方式。"};
                           } else {
                               let ss: serverSeeds = await this.dbMySql.entityManager().findOne(serverSeeds, {"auctionId": auctionId});
                               if (!ss) {
                                   toRet.message = {english: "Unexpectedly missing server and client seeds for this auction.", chinese: "出乎意料地错过了这次拍卖的服务器和客户种子。"};
                               } else {

                                   // Good to go on the harpooning!
                                   let harpoonResults: any = await this.harpoonManager.harpoonAuction(accountName, ss, auction.odds[accountName].odds);
                                   if (harpoonResults.status == "pending") {
                                       // Return the correct signature enabling the client to bomb the auction
                                       let toSign: string = accountName + auction.remaining_bid_count.toString() + auctionId;
                                       toRet.signature = ecc.sign(toSign, this.serverKey);
                                   }

                                   toRet.accountName = accountName;
                                   toRet.auctionId = auctionId;
                                   toRet = {...toRet, ...harpoonResults};
                               }

                           }
                       }
                   } else {
                       toRet.message = {english: "Cannot harpoon an auction that has ended.", chinese: "不能拍卖已结束的拍卖。"};
                   }
               } else {
                   toRet.message = {english: "No such auction with id " + auctionId, chinese: "没有id的拍卖" + auctionId};
               }

               resolve(toRet);

           } catch (err) {
               reject(err);
           }
        });
    }

    /**
     * Polls the auction table from the blockchain
     * @returns {Promise<any>}
     */
    public pollAuctionTable():Promise<any> {
        // console.log("polling auction table at " + moment().format("dddd, MMMM Do YYYY, h:mm:ss a"));
        return new Promise<any>(async (resolve, reject) => {

            // Get new auction type data refresh every 120 polls (30 seconds)
            if (this.auctionTypeCounter <= 0) {
                try {
                    this.auctionTypes = {};
                    let auctionTypes: auctionType[] = await this.dbMySql.entityManager().find(auctionType, {});
                    for (let at of auctionTypes) {
                        this.auctionTypes[at.typeId] = at;
                        this.auctionTypeCounter = 120;
                    }
                } catch (err) {
                    reject(err);
                }
            } else {
                this.auctionTypeCounter--;
            }

            this.eosBlockchain.getInfo().then((blockchainInfo) => {
                let headBlockTime:number = parseInt(moment( blockchainInfo.head_block_time + "+00:00").local().format("X"));
                this.eosBlockchain.getTable(this.serverConfig.eostimeContract, this.serverConfig.eostimeContractTable).then(async (data:any) => {
                    let auctionsFromBlockchain:any[] = Config.safeProperty(data, ["rows"], null);
                    let auctionToPayout:any = null;
                    if (auctionsFromBlockchain) {

                        // ----------------------------------------------------------------------------
                        // This is the main method that determines the state of the blockchain auctions
                        // by sorting them into "removed", "added", "changed", and "ended" lists.
                        // ----------------------------------------------------------------------------
                        let sortedAuctions:any = await this.sortAuctions(headBlockTime, auctionsFromBlockchain);

                        for (let auction of sortedAuctions.removed) {
                            if (this.sio) {
                                this.sio.sockets.emit(SocketMessage.STC_REMOVE_AUCTION, JSON.stringify(auction));
                            }
                        }
                        for (let auction of sortedAuctions.added) {

                            await this.addProvablyFairSeedsToAuctions();

                            if (this.sio) {
                                this.sio.sockets.emit(SocketMessage.STC_ADD_AUCTION, JSON.stringify(auction));
                            }
                        }
                        for (let auction of sortedAuctions.changed) {

                            // Reset our auction if instructed to
                            if (auction.resetToOriginalParams) {
                                console.log("=========> Resetting auction id: " + auction.id);
                                this.eosBlockchain.replaceAuctionParams(auction.id, auction.resetToOriginalParams).then((result) => {
                                    console.log("=========> Auction id: " + auction.id + " has been reset");
                                }, (reject) => {
                                    console.log("Unexpected error resetToOriginalParams payoutAndReplace(" + auction.id + ")");
                                    console.log(reject);
                                    console.log("---------------");
                                });
                            } else {

                                // Create a bid record in the MySql database if one isn't already there.
                                //
                                if (auction.last_bidder != "eostimecontr") {
                                    let data: any = {
                                        block_time: blockchainInfo.head_block_time,
                                        redzone_id: auction.id,
                                        bidder: auction.last_bidder,
                                        bid_id: auction.last_bid_id,
                                        bid_price: parseFloat(auction.previous_bid_price).toFixed(4) + " EOS",
                                        currency: "EOS"
                                    }
                                    try {
                                        await this.dbMySql.recordBid(data);

                                        // Add this new bid to the auction's bidder field
                                        // Attach current bidders
                                        auction.bidders.unshift({
                                            accountName: data.bidder,
                                            amount: data.bid_price,
                                            currency: "EOS"
                                        });

                                        // Attach the odds for each account playing in the auction
                                        if (this.auctionTypes.hasOwnProperty(auction.type)) {
                                            let at: auctionType = this.auctionTypes[auction.type];
                                            auction.odds = await this.oddsFromBids(auction.id, auction.bidders, at.harpoon);
                                        } else {
                                            auction.odds = {};
                                        }

                                    } catch (err) {
                                        console.log("Failed to create bid record in AuctionManager");
                                        console.log(err);
                                    }
                                }

                                // Get the bidder's client seed and update the appropriate serverSeed record
                                // for this auction.
                                let dbUser:user = await this.dbMySql.entityManager().findOne(user, {accountName: auction.last_bidder});
                                if (dbUser) {
                                    let ss: serverSeeds = await this.dbMySql.entityManager().findOne(serverSeeds, {auctionId: auction.id});
                                    if (ss) {
                                        ss.clientSeed = dbUser.clientSeed;
                                        ss.save();

                                        // Broadcast out the auction's new client seed
                                        if (this.sio) {
                                            let payload:any = {
                                                auctionId: auction.id,
                                                clientSeed: dbUser.clientSeed
                                            }
                                            this.sio.sockets.emit(SocketMessage.STC_LEADER_CLIENT_SEED, JSON.stringify(payload));
                                        }

                                        auction.clientSeed = dbUser.clientSeed;
                                    }
                                }

                                await this.addProvablyFairSeedsToAuctions();

                                // Notify clients of auction change
                                if (this.sio) {
                                    this.sio.sockets.emit(SocketMessage.STC_CHANGE_AUCTION, JSON.stringify(auction));
                                }

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

                            await this.addProvablyFairSeedsToAuctions();

                            if (this.sio) {
                                this.sio.sockets.emit(SocketMessage.STC_END_AUCTION, JSON.stringify(auction));
                            }
                        }

                        await this.addProvablyFairSeedsToAuctions();
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
                            this.linkToAuctions(auctionToPayout).then(async (params:any) => {

                                // --------------- FINISH UP INNER FUNCTION --------------
                                //
                                let finishUp = async function(result) {

                                    console.log("finishUp(result): ");
                                    console.log(result);

                                    delete this.outstandingPayoutRestartTransactions[auctionToPayout.id];

                                    auctionToPayout["transactionId"] = result.transaction_id;
                                    auctionToPayout["blockNumber"] = result.processed.block_num;

                                    let totalBids:number = auctionToPayout.init_bid_count - auctionToPayout.remaining_bid_count;
                                    this.notifySlack("[" + auctionToPayout.last_bidder + "] won " + auctionToPayout.prize_pool + " EOS in auction id " + auctionToPayout.id + " with " + totalBids + " total bids placed.");

                                    if (auctionToPayout.init_bid_count != auctionToPayout.remaining_bid_count) {

                                        this.lastPayoutTime = new Date().getTime();

                                        // Add the bidders list for this winning auction auction
                                        auctionToPayout.bidders = await this.dbMySql.auctionBids(auctionToPayout.id, auctionToPayout.auctionType);

                                        // Save our auction record to MySql db
                                        let auct:auctions = await this.completeAuctionData(auctionToPayout);

                                        // Store this winner auction in our list of recent winners cache
                                        let recentWinnerObject:any = await this.dbMySql.winningAuctionObjectFromInstance(auct);
                                        this.recentWinners.unshift(auctionToPayout);
                                        if (this.recentWinners.length > Config.WINNERS_LIST_LIMIT) {
                                            this.recentWinners.splice(Config.WINNERS_LIST_LIMIT, this.recentWinners.length - Config.WINNERS_LIST_LIMIT);
                                        }

                                        if (this.sio) {
                                            this.sio.sockets.emit(SocketMessage.STC_WINNER_AUCTION, JSON.stringify(auctionToPayout));
                                        }

                                        // Tell the winner to update his balances 10 seconds from now
                                        let socketMessage: SocketMessage = ClientConnection.socketMessageFromAccountName(auctionToPayout.last_bidder);
                                        if (socketMessage) {
                                            socketMessage.stcUpdateBalances();
                                            setTimeout(() => {
                                                socketMessage.stcUpdateBalances();
                                            }, 10000);
                                        }

                                        // Save our auction that we won to Mongo (eventually going away)
                                        return this.dbManager.insertDocument("auctions", auctionToPayout);
                                    } else {
                                        return Promise.resolve(null);
                                    }
                                }.bind(this);
                                //
                                // --------------- END OF FINISH UP INNER FUNCTION --------------

                                // Creates an auction record to guarantee that we beat the
                                // history scanner which cannot possibly see this auction before
                                // it is paid out (generating an rzreceipt). The only reason I see
                                // if one exists already is because I bring the server up and down
                                // and if an auction completes while it is down it creates problems.
                                //
                                let newAuctionRecord: auctions = await this.dbMySql.entityManager().findOne(auctions, {auctionId: auctionToPayout.id});
                                if (!newAuctionRecord) {
                                    newAuctionRecord = new auctions();
                                    newAuctionRecord.auctionId = auctionToPayout.id;
                                }
                                newAuctionRecord.creationDatetime = new Date(auctionToPayout.block_time * 1000.0);
                                await this.dbMySql.entityManager().save(newAuctionRecord);

                                if (params) {

                                    try {
                                        // Hit the blockchain
                                        let result: any = await this.eosBlockchain.payoutAndReplace(auctionToPayout.id, params);

                                        // Complete the process and notify clients
                                        await finishUp(result);

                                    } catch (err) {
                                        delete this.outstandingPayoutRestartTransactions[auctionToPayout.id];
                                        console.log("Unexpected error payoutAndReplace(" + auctionToPayout.id + ")");
                                        console.log(err);
                                        console.log("---------------");
                                    }
                                } else {

                                    try {

                                        // Hit the blockchain
                                        let result:any = await this.eosBlockchain.payoutAndRestartAuction(auctionToPayout.id);

                                        // Complete the process and notify clients
                                        await finishUp(result);

                                    } catch (err) {
                                        delete this.outstandingPayoutRestartTransactions[auctionToPayout.id];
                                        console.log("Unexpected error payoutAndRestartAuction(" + auctionToPayout.id + ")");
                                        console.log(err);
                                        console.log("---------------");
                                    }
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
     * Returns an object containing account names and current harpoon odds
     * for each particular account
     *
     * @param {number} auctionId
     * @param {any[]} bids
     * @param {number} totalOdds_
     * @returns {any}
     */
    public oddsFromBids(auctionId:number, bids:any[], totalOdds_:number):Promise<any> {

        return new Promise<any>(async (resolve, reject) => {
           try {
               let lastCheckCount:number = 0;
               let lastCheckIdx:number = 0;
               let uniqueCheckedAccounts:any = {};

               // This function returns the # of unique accounts that are ahead
               // of a specified index into the bids array. It starts at the specified
               // index, and works its way backwards to the "lastCheckIdx", looking
               // for unique account names and incrimenting the "lastCheckCount"
               // var each time it finds one. Finally, it sets the lastCheckIdx
               // to where it started from (which will be the ending point of
               // the next call).
               let aheadOf = async (idx:number):Promise<number> => {
                   return new Promise<number>(async (resolve, reject) => {
                      try {
                          for (let i:number = idx - 1; i >= lastCheckIdx; i--) {
                              let bid:any = bids[i];
                              bid.hasHarpooned = await this.hasHarpooned(bid.accountName, auctionId);
                              if (!uniqueCheckedAccounts.hasOwnProperty(bid.accountName) && !bid.hasHarpooned) {
                                  uniqueCheckedAccounts[bid.accountName] = true;
                                  lastCheckCount++;
                              }
                          }
                          lastCheckIdx = idx;
                          resolve(lastCheckCount);
                      } catch (err) {
                          reject(err);
                      }
                   });
               };

               // Loop through all bids, extracting and counting unique accounts.
               let toRet:any = {};
               for (let i:number = 0; i < bids.length; i++) {
                   let bid:any = bids[i];
                   if (!toRet.hasOwnProperty(bid.accountName)) {
                       let aheadOfMe:number = await aheadOf(i);
                       if (!bid.hasHarpooned) {
                           toRet[bid.accountName] = {aheadOf: aheadOfMe, odds: 0};
                       }
                   }
               }

               // At this point, lastCheckCount == total number of accounts
               // that will get the harpoon button.
               //
               let harpoonButtonCount:number = lastCheckCount;
               if (lastCheckCount > 0) {

                   if (harpoonButtonCount == 1) {
                       for (let key in toRet) {
                           let o: any = toRet[key];
                           if (o.aheadOf == 1) {
                               o.odds = totalOdds_;
                           }
                       }
                   } else {
                       // We have multiple harpoon buttons to distribute
                       // the odds to (at least 2)
                       //
                       // We scale the odds according to the formula (example for 5 harpoon buttons - n=5)
                       //
                       // 1*nthRootTotalOdds * g*nthRootTotalOdds * g^2*nthRootTotalOdds * g^3*nthRootTotalOdds * g^4*nthRootTotalOdds
                       // ------------------------------------------------------------------------------------------------------------
                       //                                               g^10
                       //
                       // We then take the nth root of the denominator and apply it individually
                       //
                       // 1*nthRootTotalOdds * g*nthRootTotalOdds * g^2*nthRootTotalOdds * g^3*nthRootTotalOdds * g^4*nthRootTotalOdds
                       // ------------------   ------------------   --------------------   --------------------   --------------------
                       //   nthRootOfDenom       nthRootOfDenom         nthRootOfDenom         nthRootOfDenom         nthRootOfDenom
                       //
                       // We don't want the last term to go above 1, so calculate g by setting a fantom sixth factor = 1, making
                       // the real fifth factor just slightly less than 1.
                       //
                       // g^15 * nthRootTotalOdds
                       // ----------------------- = 1  therefore g =  nthRootOf(1/nthRootTotalOdds)(
                       //          g^10
                       //
                       let nthRootTotalOdds:number = Math.pow((1 - totalOdds_), 1/harpoonButtonCount);
                       let g:number = Math.pow(1/nthRootTotalOdds, 1/harpoonButtonCount);
                       let denominator:number = Math.pow(g, harpoonButtonCount*((harpoonButtonCount - 1) / 2));
                       let nthRootOfDenominator:number = Math.pow(denominator, 1/harpoonButtonCount);
                       for (let key in toRet) {
                           let o: any = toRet[key];
                           if (o.aheadOf > 0) {
                               let factor:number = Math.pow(g, o.aheadOf - 1);
                               let odds:number = (factor * nthRootTotalOdds)/nthRootOfDenominator;
                               o.odds = (1 - odds);
                           }
                       }
                   }
               }

               resolve(toRet);

           } catch (err) {
               reject(err);
           }
        });
    }

    /**
     * Resolves to true if the account has harpooned the specified auction, false otherwise.
     * @param {string} accountName
     * @param {number} auctionId
     * @returns {Promise<boolean>}
     */
    private hasHarpooned(accountName:string, auctionId:number):Promise<boolean> {
        return new Promise<boolean>(async (resolve, reject) => {
            try {
                let bomb: harpoon = await this.dbMySql.entityManager().findOne(harpoon, {
                    "auctionId": auctionId,
                    "accountName": accountName,
                    "status": "miss"
                });
                if (bomb) {
                    resolve(true);
                } else {
                    resolve(false);
                }
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Attaches the server seed hash and client seed (if any) to the current auctions
     * being held by this manager.
     *
     * @returns {Promise<void>}
     */
    private addProvablyFairSeedsToAuctions():Promise<void> {

        return new Promise<void>(async (resolve, reject) => {
            try {
                for (let auction of this.auctions) {
                    if (!auction.hasOwnProperty("serverSeedHash")) {
                        let seeds: any = await this.harpoonManager.getServerHashAndClientSeed(auction.id);
                        auction.serverSeedHash = seeds.serverHash;
                        auction.clientSeed = seeds.clientSeed;
                    }
                }
                resolve();
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Updates our auction record with its full compliment of data
     * @param data
     * @returns {Promise<void>}
     */
    private completeAuctionData(data:any):Promise<auctions> {
        return new Promise<auctions>(async (resolve, reject) => {
            try {
                let auction:auctions = null;
                await this.dbMySql.getConnection().manager.transaction(async (transactionalEntityManager) => {
                    auction = await transactionalEntityManager.findOne(auctions, {auctionId: data.id});
                    if (!auction) {
                        throw new Error("Could not find preliminary auction data in database for auction ID: " + data.id);
                    }
                    auction.endedDatetime = new Date(data.expires * 1000.0);
                    auction.auctionType = data.type;
                    auction.prizePool = parseFloat(data.prize_pool);
                    auction.lastBidderAccount = data.last_bidder;
                    auction.endingBidPrice = parseFloat(data.bid_price);
                    auction.endingBidId = data.last_bid_id;
                    auction.blockNumber = data.blockNumber;
                    auction.transactionId = data.transactionId;
                    auction.flags = data.flags;
                    let winningBid: bid = await transactionalEntityManager.findOne(bid, {bidId: data.last_bid_id});
                    if (winningBid) {
                        auction.endingBidPrice = winningBid.amount;
                    }
                    if ((auction.flags & 0x08) == 0x08) {
                        let h:harpoon = await transactionalEntityManager.findOne(harpoon, {auctionId: data.id, accountName: data.last_bidder, status: "pending"});
                        if (h) {
                            h.status = "success";
                            await h.save();
                            auction.harpoon_ = h;
                        }
                    }
                    await auction.save();
                });
                resolve(auction);
            } catch (err) {
                console.log(err);
                reject(err);
            }
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
            if (auctionType && auctionType.nextType && (auctionType.nextType != auctionType.typeId)) {
                let nextAuctionType:any = this.auctionTypes.hasOwnProperty(auctionType.nextType) ? this.auctionTypes[auctionType.nextType] : null;
                if (nextAuctionType) {
                    let params:any = JSON.parse(nextAuctionType.blockchainParams);
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
    private sortAuctions(headBlockTime:number , auctionsFromBlockchain:any[]):Promise<any> {

        return new Promise<any>(async (resolve, reject) => {

            try {
                let toRet: any = {
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

                        let originalBlockchainAuctionExpireUnixTime: number = parseInt(moment(blockchainAuction.expires + "+00:00").local().format("X"));

                        // Handles fantom auctions (ones with no bids that roll over so that we don't have to
                        // spend CPU on empty auctions)
                        this.restartEndedAuctions(headBlockTime, blockchainAuction);

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
                                if (blockchainAuction.last_bidder != "eostimecontr") {
                                    let bidPrice: number = parseFloat(blockchainAuction.bid_price.split(" ")[0]);
                                    if (bidPrice > 2) {
                                        this.notifySlack("Bid " + blockchainAuction.bid_price + " EOS received from [" + blockchainAuction.last_bidder + "] on auction type " + blockchainAuction.type + " id " + blockchainAuction.id);
                                    }
                                }
                                blockchainAuction.previous_bid_price = currentAuction.bid_price;
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

                    // Attach current bidders
                    auction.bidders = await this.dbMySql.auctionBids(auction.id);

                    // Attach the odds for each account playing in the auction
                    if (this.auctionTypes.hasOwnProperty(auction.type)) {
                        let at: auctionType = this.auctionTypes[auction.type];
                        auction.odds = await this.oddsFromBids(auction.id, auction.bidders, at.harpoon);
                    } else {
                        auction.odds = {};
                    }

                    // If the auction has not ended, present the prize pool as what the player
                    // will in-fact win if they place the bid (by adding the to-pool portion of
                    // the bid about to be placed.
                    if (!auction.hasEnded) {
                        let toPot: number = 1.0 - auction.house_portion_x100k / 100000;
                        let pool: number = parseFloat(auction.prize_pool) + parseFloat(auction.bid_price) * toPot;
                        auction.prize_pool = pool.toFixed(4);
                    }

                    if (this.auctionTypes.hasOwnProperty(auction.type)) {
                        let at: auctionType = this.auctionTypes[auction.type];
                        auction.harpoon = at.harpoon;
                        auction.html = "<div class=\"ribbon ribbon-" + at.color + " hot\"></div><div class=\"ribbon-contents\"><i class=\"" + at.icon + "\"></i><span>" + at.text + "</span></div>";
                    }
                }

                this.auctions = auctionsFromBlockchain;

                // To remove an auction, we need to see it go away for 3 seconds
                for (let i: number = 0; i < toRet.removed.length; i++) {
                    let removedAuction: any = toRet.removed[i];
                    let cyclesInRemovedList: number = removedAuction.hasOwnProperty("cyclesRemoved") ? removedAuction["cyclesRemoved"] : 0;
                    if (cyclesInRemovedList < 10) {
                        removedAuction["cyclesRemoved"] = cyclesInRemovedList + 1;
                        this.auctions.push(removedAuction);
                        toRet.removed.splice(i, 1);
                        i--;
                    }
                }

                resolve(toRet);

            } catch (err) {
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