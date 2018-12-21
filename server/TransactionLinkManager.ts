import {DBManager} from "./DBManager";
import {Config} from "./Config";

export class TransactionLinkManager {

    private static JOB_INTERVAL_SECS:number = 1;

    private dbManager:DBManager;
    private notificationCallback:(data:any) => void;
    private auctionWinnerPayoutTransactionCallback:(auctionId:number, blockNumber:number, transactionId:string) => Promise<void>;
    private timer:any = null;

    constructor(dbManager:DBManager, notificationCallback:(data:any) => void, auctionWinnerPayoutTransactionCallback:(auctionId:number, blockNumber:number, transactionId:string) => Promise<void>) {
        this.dbManager = dbManager;
        this.notificationCallback = notificationCallback;
        this.auctionWinnerPayoutTransactionCallback = auctionWinnerPayoutTransactionCallback;
    }

    public start():void {
        if (!this.timer) {
            this.timer = setTimeout(() => {
                this.job();
            }, TransactionLinkManager.JOB_INTERVAL_SECS*1000);
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

    // ===============
    // PRIVATE METHODS
    // ===============

    /**
     * Job to attach transaction links to auction and dividend payments
     */
    private job():void {
        this.attachLinksToAuctions().then((result) => {
            return this.attachLinksToDividends();
        }).then((result) => {
            // Schedule next occurrance
            this.timer = setTimeout(() => {
                this.job();
            }, TransactionLinkManager.JOB_INTERVAL_SECS*1000);
        }).catch((err) => {
            console.log("TransactionLinkManager error (restarting)");
            console.log(err);
            // Scheule next occurance
            this.timer = setTimeout(() => {
                this.job();
            }, TransactionLinkManager.JOB_INTERVAL_SECS*1000);
        });
    }

    private attachLinksToAuctions():Promise<void> {
        return new Promise<void>((resolve, reject) => {
            let lookbackTo:number = Math.floor(new Date().getTime()/1000) - 100*86400;
            let filter:any = {"blockNumber" : { "$exists" : false }, creation_time: {"$gte": 1544838799}};
            this.dbManager.getDocuments("auctions", filter, {}, 1000).then(async (auctions:any[]) => {
                if (auctions.length == 0) {
                    resolve();
                } else {
                    for (let auction of auctions) {
                        // console.log("Attempting to update auction ID: " + auction.id);
                        try {
                            let filter: any = {
                                account: "eosio.token",
                                from: "eostimecontr",
                                to: {$ne: "eostimehouse"},
                                auctionId: auction.id
                            };
                            let transactions:any[] = await this.dbManager.getDocuments(Config.eostimeContract, filter, {}, 1000);
                            if (transactions && transactions.length > 0) {
                                for (let tx of transactions) {
                                    if (tx.memo.indexOf("You win") >= 0) {
                                        await this.auctionWinnerPayoutTransactionCallback(tx.auctionId, tx.blockNumber, tx.transactionId);
                                        // console.log("Successfully updated auction ID: " + tx.auctionId + " -> " + tx.transactionId);
                                        break;
                                    }
                                }
                            }
                        } catch(err) {
                            console.log("TransactionLinkManager error");
                            console.log(err);
                        }
                    }
                    resolve();
                }
            });
        });
    }

    private attachLinksToDividends():Promise<void> {
        return new Promise<void>((resolve, reject) => {
            // TODO Finish this method
            resolve();
        });
    }
}