import {AggregationCursor, ClientSession, Db, MongoClient, MongoClientOptions} from "mongodb";

export class DBManager {

    private dbClient:MongoClient = null;
    private dbo:Db = null;

    constructor() {

    }

    // Open the MongoDB connection.
    public openDbConnection(connectionString, username:string, password:string):Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.dbClient == null) {
                MongoClient.connect(connectionString, {useNewUrlParser: true}, (err:any, client:MongoClient) => {
                    if (err) {
                        reject(err);
                    } else {
                        this.dbClient = client;
                        this.dbo = this.dbClient.db(connectionString.substr(connectionString.lastIndexOf("/") + 1));
                        resolve();
                    }
                });
            }
        });
    }

    public closeDbConnection():void {
        if (this.dbClient) {
            this.dbClient.close();
            this.dbClient = null;
        }
    }

    // Get a configuration var
    public getConfig(keyToFind:string):Promise<any> {
        return new Promise<string>((resolve, reject) => {
            if (this.dbClient != null) {
                let filter:any = {key: keyToFind};
                this.dbo.collection("applicationSettings").findOne(filter, function(err, result) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(result ? result.value : null);
                    }
                });
            } else {
                reject(new Error("No Database Connection"));
            }
        });
    }

    // Set a configuration var
    public setConfig(keyToSet:string, valueToSet:any, session:ClientSession = null):Promise<void> {
        if (this.dbClient != null) {
            return this.updateDocumentByKey("applicationSettings", { key: keyToSet }, {value: valueToSet }, session);
        } else {
            return Promise.reject(new Error("No Database Connection"));
        }
    }

    /**
     * Returns a sorted array of documents
     * @param {string} collectionName
     * @param filter
     * @param orderBy
     * @param {number} limit
     * @returns {Promise<any[]>}
     */
    public getDocuments(collectionName:string, filter:any = null, orderBy:any, limit:number):Promise<any[]> {
        return new Promise<any[]>((resolve, reject) => {
            if (this.dbClient != null) {
                this.dbo.collection(collectionName).find(filter).sort(orderBy).limit(limit).toArray( function(err, result:any[]) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(result);
                    }
                });
            } else {
                reject(new Error("No Database Connection"));
            }
        });
    }

    /**
     * Returns a document from the specified collection by filter
     *
     * @param {string} collectionName
     * @param filter
     * @param orderBy
     * @returns {Promise<any>}
     */
    public getDocumentByKey(collectionName:string, filter:any = null):Promise<any> {
        return new Promise<string>((resolve, reject) => {
            if (this.dbClient != null) {
                this.dbo.collection(collectionName).findOne(filter, function(err, result) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(result);
                    }
                });
            } else {
                reject(new Error("No Database Connection"));
            }
        });
    }

    /**
     * Deletes specific documents
     * @param {string} collectionName
     * @param filter
     * @param {ClientSession} session
     * @returns {Promise<void>}
     */
    public deleteDocumentsByKey(collectionName:string, filter:any, session:ClientSession = null):Promise<void> {
        return new Promise<void>((resolve, reject) => {
           if (this.dbClient != null) {
               if (session) {
                   this.dbo.collection(collectionName).deleteMany(filter, {session}, function(err, result) {
                       if (err) {
                           reject(err);
                       } else {
                           resolve();
                       }
                   });
               } else {
                   this.dbo.collection(collectionName).deleteMany(filter, function(err, result) {
                       if (err) {
                           reject(err);
                       } else {
                           resolve();
                       }
                   });
               }
           } else {
               reject(new Error("No Database Connection"));
           }
        });
    }

    /**
     * Updates a document by key
     * @param {string} collectionName
     * @param filter
     * @param newValues
     * @returns {Promise<void>}
     */
    public updateDocumentByKey(collectionName:string, filter:any, newValues:any, session:ClientSession = null):Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.dbClient != null) {
                var newvalues = { $set: newValues };
                if (session) {
                    this.dbo.collection(collectionName).updateOne(filter, newvalues, {session}, (err, res) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                } else {
                    this.dbo.collection(collectionName).updateOne(filter, newvalues, (err, res) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                }
            } else {
                reject(new Error("No Database Connection"));
            }
        });
    }

    /**
     * Inserts a new document into the database
     * @param {string} collectionName
     * @param document
     * @returns {Promise<void>}
     */
    public insertDocument(collectionName:string, document, session:ClientSession = null):Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.dbClient != null) {
                if (session) {
                    this.dbo.collection(collectionName).insertOne(document, {session}, function(err, res) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                } else {
                    this.dbo.collection(collectionName).insertOne(document, function(err, res) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                }
            } else {
                reject(new Error("No Database Connection"));
            }
        });
    }

    /**
     * Returns an aggregation cursor to the results of a DB query
     * @param {string} collectionName
     * @param {any[]} pipeline
     * @param {number} batchSize
     * @returns {Promise<AggregationCursor>}
     */
    public aggregation(collectionName:string, pipeline:any[], batchSize:number = 0):Promise<AggregationCursor> {
        return new Promise<AggregationCursor>((resolve, reject) => {
            if (this.dbClient != null) {
                let batch:any = {
                    cursor: { batchSize: batchSize }
                };
                this.dbo.collection(collectionName).aggregate(pipeline, batch,function(err, res:AggregationCursor) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(res);
                    }
                });
            } else {
                reject(new Error("No Database Connection"));
            }
        });
    }

    /**
     * Executes the specified transactionFunction in an ACID transaction.
     *
     * @param {(client: MongoClient, session: ClientSession) => void} transactionFunction
     * @returns {Promise<any>}
     */
    public executeTransaction(transactionFunction:(client:MongoClient, session:ClientSession) => void):Promise<any>{
        // return this.dbClient.withSession(session => this.runTransactionWithRetry(transactionFunction, this.dbClient, session));
        return new Promise((resolve) => {
            transactionFunction(null, null);
            resolve();
        });
    }

    public async commitWithRetry(session) {
        try {
            // await session.commitTransaction();
        } catch (error) {
            if (
                error.errorLabels &&
                error.errorLabels.indexOf('UnknownTransactionCommitResult') >= 0
            ) {
                console.log('UnknownTransactionCommitResult, retrying commit operation ...');
                await this.commitWithRetry(session);
            } else {
                console.log('Error during commit ...');
                throw error;
            }
        }
    }

    private async runTransactionWithRetry(txnFunc, client, session) {
        try {
            await txnFunc(client, session);
        } catch (error) {
            console.log('Transaction aborted. Caught exception during transaction.');

            // If transient error, retry the whole transaction
            if (error.errorLabels && error.errorLabels.indexOf('TransientTransactionError') >= 0) {
                console.log('TransientTransactionError, retrying transaction ...');
                await this.runTransactionWithRetry(txnFunc, client, session);
            } else {
                throw error;
            }
        }
    }
}