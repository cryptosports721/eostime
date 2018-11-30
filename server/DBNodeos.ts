import {Db, MongoClient} from "mongodb";

export class DBNodeos {

    private dbClient:MongoClient = null;
    private dbo:Db = null;

    public init(uri:string):Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            MongoClient.connect(uri, {useNewUrlParser: true}, (err:any, client:MongoClient) => {
                if (err) {
                    reject(err);
                } else {
                    this.dbClient = client;
                    this.dbo = this.dbClient.db(uri.substr(uri.lastIndexOf("/") + 1));
                    resolve();
                }
            });
        });
    }

    /**
     * Returns the head block from the Mongo DB
     * @returns {Promise<number>}
     */
    public getHeadBlock():Promise<number> {
        return new Promise<number>((resolve, reject) => {
            this.dbo.collection("blocks").find({}).sort(
                {
                    "block" : -1.0
                }
            ).limit(1).toArray( function(err, result:any[]) {
                if (err) {
                    reject(err);
                } else {
                    resolve(result[0]["block_num"]);
                }
            });
        });
    }

    /**
     * Returns a single block corresponding to the blockNumber specified.
     * @param {number} blockNumber
     * @returns {Promise<any>}
     */
    public getBlock(blockNumber:number):Promise<any[]> {
        return new Promise<any[]>((resolve, reject) => {
            this.dbo.collection("blocks").find({block_num: blockNumber}).toArray(function(err, result:any[]) {
                if (err) {
                    reject(err);
                } else {
                    resolve(result);
                }
            });
        });
    }

    /**
     * Returns all action traces associated with a transaction ID
     * @param {string} txid
     * @returns {Promise<any[]>}
     */
    public getActionTraces(txid:string):Promise<any[]> {
        return new Promise<any[]>((resolve, reject) => {
            this.dbo.collection("action_traces").find({trx_id:txid}).toArray( function(err, result:any[]) {
                if (err) {
                    reject(err);
                } else {
                    resolve(result);
                }
            });
        });
    }
}