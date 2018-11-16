import {Db, MongoClient, MongoClientOptions} from "mongodb";

export class DBManager {

    private dbConnection:MongoClient = null;
    private dbo:Db = null;

    constructor() {

    }

    // Open the MongoDB connection.
    public openDbConnection(connectionString, username:string, password:string):Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.dbConnection == null) {
                MongoClient.connect(connectionString, {useNewUrlParser: true}, (err:any, db:MongoClient) => {
                    if (err) {
                        reject(err);
                    } else {
                        this.dbConnection = db;
                        this.dbo = this.dbConnection.db(connectionString.substr(connectionString.lastIndexOf("/") + 1));
                        resolve();
                    }
                });
            }
        });
    }

    public closeDbConnection():void {
        if (this.dbConnection) {
            this.dbConnection.close();
            this.dbConnection = null;
        }
    }

    // Get a configuration var
    public getConfig(keyToFind:string):Promise<string> {
        return new Promise<string>((resolve, reject) => {
            if (this.dbConnection != null) {
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
    public setConfig(keyToSet:string, valueToSet:any):Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.dbConnection != null) {
                var myquery = { key: keyToSet };
                var newvalues = { $set: {value: valueToSet } };
                this.dbo.collection("applicationSettings").updateOne(myquery, newvalues, function(err, res) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            } else {
                reject(new Error("No Database Connection"));
            }
        });
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
            if (this.dbConnection != null) {
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
            if (this.dbConnection != null) {
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
     * Updates a document by key
     * @param {string} collectionName
     * @param filter
     * @param newValues
     * @returns {Promise<void>}
     */
    public updateDocumentByKey(collectionName:string, filter:any, newValues:any):Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.dbConnection != null) {
                var newvalues = { $set: newValues };
                this.dbo.collection(collectionName).updateOne(filter, newvalues, function(err, res) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
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
    public insertDocument(collectionName:string, document):Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.dbConnection != null) {
                this.dbo.collection(collectionName).insertOne(document, function(err, res) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            } else {
                reject(new Error("No Database Connection"));
            }
        });
    }
}