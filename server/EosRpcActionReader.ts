import {NodeosBlock} from "demux-eos";
import {Config} from "./Config";
import JsonRpc from "eosjs/dist/eosjs-jsonrpc";
import {GetInfoResult} from "eosjs/dist/eosjs-rpc-interfaces";
import {AbstractActionReader, Block} from "demux";

class DeferredActionsNodeosBlock extends NodeosBlock {

    private eosRpc:JsonRpc;

    constructor(rawBlock:any, eosRpc:JsonRpc) {
        super(rawBlock);
        this.eosRpc = eosRpc;
    }

    public appendDeferredActions(rawBlock: any): Promise<void> {
        return new Promise((resolve, reject) => {

            let transactionPromises:Promise<void>[] = new Array<Promise<void>>();

            let actionIndex:number = 0;
            let transactions:any[] = Config.safeProperty(rawBlock, ["transactions"], null);
            if (transactions) {
                for (let transaction of transactions) {
                    if (!transaction.trx.transaction) {
                        // This is a deferred transaction that the base class cannot deal with
                        if (transaction.trx) {
                            let p:Promise<any> = this.eosRpc.history_get_transaction(transaction.trx).then((result) => {
                                let traces:any[] = Config.safeProperty(result, ["traces"], []);
                                for (let i:number = 0; i < traces.length; i++) {
                                    let trace:any = traces[i];
                                    trace.act["transactionId"] = transaction.trx;
                                    trace.act["receipt"] = trace.receipt;
                                    let eosAction:any = {
                                        type: trace.act.account + "::" + trace.act.name,
                                        payload: trace.act
                                    }
                                    this.actions.push(eosAction);
                                }
                            }).catch((err) => {
                                console.log("Couldn't get historical transaction info for: " + transaction.trx);
                            });
                            transactionPromises.push(p);
                        }
                    }
                }
            }

            // Wait for all of our transaction promises to append deferred
            // actions to this.actions
            Promise.all(transactionPromises).then(() => {
                resolve();
            });
        });
    }
}

export class EosRpcActionReader extends AbstractActionReader {

    private eosRpc:JsonRpc;
    private processedBlockCallback:(blockNumber:number, timestamp:string) => Promise<any>;

    /**
     * Loops on reading the blockchain looking for actions
     *
     * @param endPoint
     * @param {number} startAtBlock
     * @param {boolean} onlyIrreversible
     * @param {number} maxHistoryLength
     * @param {(blockNumber: number) => Promise<any>} processedBlockCallback
     */
    constructor(endPoint:string, startAtBlock: number, onlyIrreversible: boolean, maxHistoryLength: number, processedBlockCallback:(blockNumber:number, timestamp:string) => Promise<any> = null) {
        super(startAtBlock, onlyIrreversible, maxHistoryLength);
        this.eosRpc = new JsonRpc(endPoint, {fetch});
        this.processedBlockCallback = processedBlockCallback;
    }

    public getHeadBlockNumber(numRetries:number = 120, waitTimeMs:number = 250): Promise<number> {

        return new Promise<number>((resolve, reject) => {
            let getInfo = function() {
                this.eosRpc.get_info().then((blockInfo:GetInfoResult) => {
                    resolve(blockInfo.head_block_num);
                }).catch((reason:any) => {
                    numRetries--;
                    if (numRetries > 0) {
                        console.log("Retrying getHeadBlockNumber()...");
                        return new Promise((res) => {
                            setTimeout(() => {
                                getInfo();
                            }, waitTimeMs);
                        });
                    } else {
                        reject("AbstractActionReader getHeadBlockNumber() failed");
                    }
                });
            }.bind(this);
            getInfo();
        });
    }

    public getBlock(blockNumber: number, numRetries:number = 120, waitTimeMs:number = 250): Promise<Block> {
        return new Promise<Block>((resolve, reject) => {
            let getBlock = function() {
                this.eosRpc.get_block(blockNumber).then((rawBlock:any) => {
                    let block:DeferredActionsNodeosBlock = new DeferredActionsNodeosBlock(rawBlock, this.eosRpc);
                    block.appendDeferredActions(rawBlock).then(() => {
                        if (this.processedBlockCallback) {
                            this.processedBlockCallback(blockNumber, rawBlock.timestamp).then(() => {
                                resolve(block);
                            });
                        } else {
                            resolve(block);
                        }
                    });
                }).catch((reason:any) => {
                    numRetries--;
                    if (numRetries > 0) {
                        return new Promise((res) => {
                            setTimeout(() => {
                                console.log("Retrying getBlock()...");
                                getBlock();
                            }, waitTimeMs);
                        });
                    } else {
                        reject("AbstractActionReader getBlock() failed");
                    }
                });

                // this.eosRpc.get_block(blockNumber, (err, rawBlock) => {
                //     if (err) {
                //         numRetries--;
                //         if (numRetries > 0) {
                //             setTimeout(() => {
                //                 console.log("Retrying getBlock()...");
                //                 getBlock();
                //             }, waitTimeMs);
                //         } else {
                //             reject("AbstractActionReader getBlock() failed");
                //         }
                //     } else {
                //         let block:NodeosBlock = new NodeosBlock(rawBlock);
                //         if (this.processedBlockCallback) {
                //             this.processedBlockCallback(blockNumber, rawBlock.timestamp).then(() => {
                //                 resolve(block);
                //             });
                //         } else {
                //             resolve(block);
                //         }
                //     }
                // });
            }.bind(this);
            getBlock();
        });
    }
}