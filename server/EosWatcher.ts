import {AbstractActionHandler, AbstractActionReader, BaseActionWatcher, Block, IndexState} from "demux";
import {Effect, Updater} from "demux/dist/interfaces";
import {NodeosBlock} from "demux-eos";

const Eos = require('eosjs');
const Ecc = require('eosjs-ecc');

class EosActionReader extends AbstractActionReader {

    private eos:any;
    private processedBlockCallback:(blockNumber:number, timestamp:string) => Promise<any>;

    /**
     * Loops on reading the blockchain looking for actions
     *
     * @param config
     * @param {number} startAtBlock
     * @param {boolean} onlyIrreversible
     * @param {number} maxHistoryLength
     * @param {(blockNumber: number) => Promise<any>} processedBlockCallback
     */
    constructor(config:any, startAtBlock: number, onlyIrreversible: boolean, maxHistoryLength: number, processedBlockCallback:(blockNumber:number, timestamp:string) => Promise<any> = null) {
        super(startAtBlock, onlyIrreversible, maxHistoryLength);
        this.eos = Eos(config);
        this.processedBlockCallback = processedBlockCallback;
    }

    public getHeadBlockNumber(numRetries:number = 120, waitTimeMs:number = 250): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            let getInfo = function() {
                this.eos.getInfo((err, blockInfo) => {
                    if (err) {
                        numRetries--;
                        if (numRetries > 0) {
                            console.log("Retrying getHeadBlockNumber()...");
                            setTimeout(() => {
                                    getInfo();
                                }, waitTimeMs);
                        } else {
                            reject("AbstractActionReader getHeadBlockNumber() failed");
                        }
                    } else {
                        resolve(blockInfo.head_block_num);
                    }
                });
            }.bind(this);
            getInfo();
        });
    }

    public getBlock(blockNumber: number, numRetries:number = 120, waitTimeMs:number = 250): Promise<Block> {
        return new Promise<Block>((resolve, reject) => {
            let getBlock = function() {
                this.eos.getBlock(blockNumber, (err, rawBlock) => {
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
     * @param config
     * @param {number} startingBlock
     * @param {any[]} updaters
     * @param {any[]} effects
     * @param {(blockNumber: number) => Promise<any>} processedBlockCallback
     * @param {(blockNumber: number) => Promise<any>} rollbackToCallback
     * @param {boolean} onlyReversible
     * @param {number} maxHistoryLength
     * @param requestInstance
     */
    constructor (config:any, startingBlock:number, updaters:any[], effects:any[],
                 processedBlockCallback:(blockNumber:number, timestamp:string) => Promise<any> = null,
                 rollbackToCallback:(blockNumber:number) => Promise<any> = null,
                 onlyReversible?:boolean,
                 maxHistoryLength?:number,
                 requestInstance?:any) {

        let actionReader:EosActionReader = new EosActionReader(config, startingBlock, onlyReversible, maxHistoryLength, processedBlockCallback);
        let actionHandler:EosActionHandler = new EosActionHandler(updaters, effects, rollbackToCallback);
        this.actionWatcher = new BaseActionWatcher(actionReader, actionHandler, 250);
    }

    public run():void {
        this.actionWatcher.watch();
    }
}