import {AbstractActionHandler, AbstractActionReader, BaseActionWatcher, Block, IndexState} from "demux";
import {Effect, Updater} from "demux/dist/interfaces";
import {NodeosBlock} from "demux-eos";
import {JsonRpc} from 'eosjs';
import {GetInfoResult} from "eosjs/dist/eosjs-rpc-interfaces";
import {Config} from "./Config";

const fetch = require('node-fetch');
const Ecc = require('eosjs-ecc');

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
                                    let eosAction:any = {
                                        type: trace.act.account + "::" + trace.act.name,
                                        payload: trace.act
                                    }
                                    this.actions.push(eosAction);
                                }
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

class EosActionReader extends AbstractActionReader {

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

                this.eosRpc.get_block(blockNumber, (err, rawBlock) => {
                    if (err) {
                        numRetries--;
                        if (numRetries > 0) {
                            setTimeout(() => {
                                console.log("Retrying getBlock()...");
                                getBlock();
                            }, waitTimeMs);
                        } else {
                            reject("AbstractActionReader getBlock() failed");
                        }
                    } else {
                        let block:NodeosBlock = new NodeosBlock(rawBlock);
                        if (this.processedBlockCallback) {
                            this.processedBlockCallback(blockNumber, rawBlock.timestamp).then(() => {
                               resolve(block);
                            });
                        } else {
                            resolve(block);
                        }
                    }
                });
            }.bind(this);
            getBlock();
        });
    }
}

class EosActionHandler extends AbstractActionHandler {

    private state = {
        indexState: { blockNumber: 0, blockHash: "" }
    };
    private stateHistory = {};
    private stateHistoryMaxLength = 300;
    private rollbackToCallback:(blockNumber:number) => Promise<any>;

    constructor(updaters: Updater[], effects: Effect[], rollbackToCallback:(blockNumber:number) => Promise<any> = null) {
        super(updaters, effects);
        this.rollbackToCallback = rollbackToCallback;
    }

    protected loadIndexState(): Promise<IndexState> {
        return new Promise<IndexState>((resolve, reject) => {
            resolve(<IndexState> this.state.indexState);
        });
    }

    protected handleWithState(handle: (state: any, context?: any) => void): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            let asyncHandler = async function() {
                await handle(this.state);
                const indexState:IndexState = <IndexState> this.state.indexState;
                this.stateHistory[indexState.blockNumber] = JSON.parse(JSON.stringify(this.state))
                if (indexState.blockNumber > this.stateHistoryMaxLength && this.stateHistory[indexState.blockNumber - this.stateHistoryMaxLength]) {
                    delete this.stateHistory[indexState.blockNumber - this.stateHistoryMaxLength]
                }
                resolve();
            }.bind(this);
            asyncHandler();
        });
    }

    protected rollbackTo(blockNumber: number): Promise<void> {
        let toRet = new Promise<void>((resolve, reject) => {
            const indexState:IndexState = <IndexState> this.state.indexState;
            const toDelete = [...Array(indexState.blockNumber - (blockNumber)).keys()].map(n => n + blockNumber + 1)
            for (const n of toDelete) {
                delete this.stateHistory[n]
            }
            this.state = this.stateHistory[blockNumber]
            resolve();
        });
        if (this.rollbackToCallback) {
            this.rollbackToCallback(blockNumber).then(() => {
                return toRet;
            });
        } else {
            return toRet;
        }
    }
    protected updateIndexState(state: any, block: Block, isReplay: boolean, context?: any): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            state.indexState.blockNumber = block.blockInfo.blockNumber
            state.indexState.blockHash = block.blockInfo.blockHash
            resolve();
        });
    }

}

/**
 * Class to watch the EOS blockchain for specific events
 */
export class EosWatcher {

    private actionWatcher:BaseActionWatcher = null;

    /**
     * Creates our watcher object
     *
     * @param endPoint {string}
     * @param {number} startingBlock
     * @param {any[]} updaters
     * @param {any[]} effects
     * @param {(blockNumber: number) => Promise<any>} processedBlockCallback
     * @param {(blockNumber: number) => Promise<any>} rollbackToCallback
     * @param {boolean} onlyReversible
     * @param {number} maxHistoryLength
     * @param requestInstance
     */
    constructor (endPoint:string, startingBlock:number, updaters:any[], effects:any[],
                 processedBlockCallback:(blockNumber:number, timestamp:string) => Promise<any> = null,
                 rollbackToCallback:(blockNumber:number) => Promise<any> = null,
                 onlyReversible?:boolean,
                 maxHistoryLength?:number,
                 requestInstance?:any) {

        let actionReader:EosActionReader = new EosActionReader(endPoint, startingBlock, onlyReversible, maxHistoryLength, processedBlockCallback);
        let actionHandler:EosActionHandler = new EosActionHandler(updaters, effects, rollbackToCallback);
        this.actionWatcher = new BaseActionWatcher(actionReader, actionHandler, 250);
    }

    public run():void {
        this.actionWatcher.watch();
    }
}