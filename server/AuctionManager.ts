import {SocketMessage} from "./SocketMessage";
import {ClientConnection} from "./ClientConnection";
import {Config} from "./Config";
import {DBManager} from "./DBManager";
import {EosBlockchain} from "./EosBlockchain";
import moment = require("moment");

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
    }

    /**
     * Enables polling of the auction table
     * @param {boolean} enable
     */
    public enablePolling(enable:boolean):void {

        if (enable) {
            if (this.pollingTimer == null) {
                this.pollingTimer = setInterval(() => {
                    this.pollAuctionTable().catch((reason) => {
                       console.log("Polling auciton table failed");
                       console.log(reason);
                    });
                }, 500);
            }
        } else {
            if (this.pollingTimer) {
                clearInterval(this.pollingTimer);
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

                                    // Delay this so payout transaction is confirmed on the blockchain, and
                                    // send 2 - one at 7.5 seconds and another at 15 seconds after the payout
                                    // was completed.
                                    setTimeout(() => {
                                        // Tell the winner to update his balances
                                        let socketMessage: SocketMessage = ClientConnection.socketMessageFromAccountName(auctionToPayout.last_bidder);
                                        if (socketMessage) {
                                            socketMessage.stcUpdateBalances();
                                            setTimeout(() => {
                                                socketMessage.stcUpdateBalances();
                                            }, 7500);
                                        }
                                    }, 7500);
                                }

                            }).catch((error: any) => {
                                delete this.outstandingPayoutRestartTransactions[auctionToPayout.id];
                                console.log("Failed to payout/rollover auction TYPE: " + auctionToPayout.type + " / ID: " + auctionToPayout.id);
                                console.log(error);
                            });
                        }
                    }

                    resolve();
                });
            });

        });
    }

    /**
     * Called as each block is processed from the blockchain
     * @param {number} blockNumber
     * @param {string} timestamp
     * @returns {Promise<any>}
     */
    public processBlock(blockNumber:number, timestamp:string):Promise<any> {
        console.log(blockNumber.toString() + " " + timestamp);
        return this.pollAuctionTable();
    }

    /**
     * Called when the watcher needs to roll back while scanning the blockchain
     * @param {number} blockNumber
     * @returns {Promise<any>}
     */
    public rollbackToBlock(blockNumber:number):Promise<any> {
        return new Promise<any>((resolve, reject) => {
            resolve();
        });
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