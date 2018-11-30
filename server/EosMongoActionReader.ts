import {AbstractActionReader, Block} from "demux";
import {DBNodeos} from "./DBNodeos";
import {NodeosBlock} from "demux-eos";
import JsonRpc from "eosjs/dist/eosjs-jsonrpc";
import {Config} from "./Config";
import {EosAction} from "demux-eos/dist/interfaces";


export class EosMongoActionReader extends AbstractActionReader {

    private dbNodeos:DBNodeos;
    private processedBlockCallback:(blockNumber:number, timestamp:string) => Promise<any>;
    private history:any[] = null;

    constructor(dbNodeos:DBNodeos, startAtBlock: number, onlyIrreversible: boolean, maxHistoryLength: number, processedBlockCallback:(blockNumber:number, timestamp:string) => Promise<any> = null) {
        super(startAtBlock, onlyIrreversible, maxHistoryLength);
        this.dbNodeos = dbNodeos;
        this.processedBlockCallback = processedBlockCallback;
    }

    /**
     * Returns the head block number from the MongoDB
     * @param {number} numRetries
     * @param {number} waitTimeMs
     * @returns {Promise<number>}
     */
    public getHeadBlockNumber(numRetries:number = 120, waitTimeMs:number = 250): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            let getHeadBlock = function () {
                this.dbNodeos.getHeadBlock().then((blockNumber:number) => {
                    let unixTime:number = Math.floor(new Date().getTime()/1000);
                    console.log("Head block number: " + blockNumber + " - " + unixTime);
                    resolve(blockNumber);
                }).catch((reason: any) => {
                    numRetries--;
                    if (numRetries > 0) {
                        console.log("Retrying getHeadBlockNumber()...");
                        return new Promise((res) => {
                            setTimeout(() => {
                                getHeadBlock();
                            }, waitTimeMs);
                        });
                    } else {
                        reject("AbstractActionReader getHeadBlockNumber() failed");
                    }
                });
            }.bind(this);
            getHeadBlock();
        });
    }

    /**
     * Returns a particular block from the MongoDB
     * @param {number} blockNumber
     * @param {number} numRetries
     * @param {number} waitTimeMs
     * @returns {Promise<Block>}
     */
    public getBlock(blockNumber: number, numRetries:number = 120, waitTimeMs:number = 250): Promise<Block> {
        return new Promise<Block>((resolve, reject) => {
            let getBlock = function() {
                this.dbNodeos.getBlock(blockNumber).then((blocks:any[]) => {
                    this.chooseProng(blocks, blockNumber).then((elem:any) => {
                        if (elem) {
                            let rawBlock:any = elem.block;
                            rawBlock.block_num = blockNumber;
                            rawBlock.id = elem.block_id;
                            let block: DeferredActionsNodeosBlock = new DeferredActionsNodeosBlock(rawBlock, this.dbNodeos);
                            block.appendDeferredActions(rawBlock).then(() => {
                                if (this.processedBlockCallback) {
                                    this.processedBlockCallback(blockNumber, rawBlock.timestamp).then(() => {
                                        resolve(block);
                                    });
                                } else {
                                    resolve(block);
                                }
                            });
                        } else {
                            resolve(null);
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
            }.bind(this);
            getBlock();
        });
    }

    /**
     * Will choose the correct block taking into account forks in the blockchain. If
     * we encounter multiple block data at the same block height, we look forward until
     * we find a block height with only a single block. We then trace backwards
     * to define the correct path and identify the correct block id to return.
     *
     * If we are at the blockchain head, we will wait here until enough blocks come
     * in to allow us to resolve the fork.
     *
     * @param {any[]} blocks
     * @param {number} blockNumber
     * @returns {Promise<any>}
     */
    private chooseProng(blocks:any[], blockNumber:number):Promise<any> {

        let getBlocks = async function (blockNumber:number, callback:() => void) {
            this.dbNodeos.getBlock(blockNumber).then((blocks:any[]) => {
                if (blocks && blocks.length > 0) {
                    this.history.push(blocks);
                    if (blocks.length == 1) {
                        callback();
                    } else {
                        blockNumber++;
                        getBlocks(blockNumber, callback);
                    }
                } else {
                    // We are at the head, so we need to stay here until
                    // we can get the next block.
                    setTimeout(() => {
                        console.log("Waiting for block " + blockNumber + " ...");
                        getBlocks(blockNumber);
                    }, 500);
                }
            });
        }.bind(this);

        return new Promise((resolve, reject) => {
            if (blocks && blocks.length == 1) {
                resolve(blocks[0]);
            } else {
                console.log("Resolving fork at block " + blockNumber);
                this.history = new Array<any>();
                if (blocks && blocks.length > 0) {
                    this.history.push(blocks);
                    blockNumber++;
                }
                getBlocks(blockNumber, function() {
                   // Should have filled our history with future blocks until
                   // there is a fork resolution (block number with only one block id instance)
                   // The last element of the this.history should have only a single element.
                   let block:any = this.history[this.history.length - 1][0];
                   if (this.history.length > 1) {
                       console.log("Fork resolved at block " + block.block_num);
                       for (let i: number = this.history.length - 2; i >= 0; i--) {
                           let blocks: any[] = this.history[i];
                           for (let j: number = 0; j < blocks.length; j++) {
                               let examineBlock: any = blocks[j];
                               if (examineBlock.block_id == block.block.previous) {
                                   block = examineBlock;
                                   break;
                               }
                           }
                       }
                   }
                   this.history = null;
                   resolve(block);
                }.bind(this));
            }
        });
    }
}

class DeferredActionsNodeosBlock extends NodeosBlock {

    private dbNodeos:DBNodeos;

    constructor(rawBlock:any, dbNodeos:DBNodeos) {
        super(rawBlock);
        this.dbNodeos = dbNodeos;
    }

    public appendDeferredActions(rawBlock: any): Promise<void> {
        return new Promise((resolve, reject) => {

            // We clear out any actions that may have been collected via the base class
            this.actions = new Array<EosAction>();

            let transactionPromises:Promise<void>[] = new Array<Promise<void>>();
            let transactions:any[] = Config.safeProperty(rawBlock, ["transactions"], null);
            if (transactions) {
                for (let transaction of transactions) {
                    let trxId:string = Config.safeProperty(transaction, ["trx.id"], transaction.trx);
                    if (trxId) {
                        // Retrieve the transaction's traces
                        let p:Promise<any> = this.dbNodeos.getActionTraces(trxId).then((traces:any[]) => {
                            for (let i:number = 0; i < traces.length; i++) {
                                let trace:any = traces[i];
                                let txid:string = Config.safeProperty(transaction, ["trx.id"], transaction.trx);
                                trace.act["transactionId"] = txid;
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

            // Wait for all of our transaction promises to append deferred
            // actions to this.actions
            Promise.all(transactionPromises).then(() => {
                resolve();
            });
        });
    }
}