const Eos = require('eosjs');
const Ecc = require('eosjs-ecc');

import {Config} from "./config";

export class EosBlockchain {

    // Some sample use cases
    //
    // this.eos.getAccount("chassettny11").then((accountResult) => {
    //     console.log(accountResult);
    //     return this.eos.getBalance("chassettny11");
    // }).then((balanceResult:any) => {
    //     console.log(balanceResult);
    //     return this.eos.getTransaction("02d974269aa55b0f537223a98f7acf3b8f6b6fc86e247afe48af1a4c820d908c");
    // }).then((transaction:any) => {
    //     console.log(transaction);
    //     return this.eos.getActions("endlessdicex");
    // }).then((actions:any) => {
    //     console.log(actions);
    // });

    private eos:any;

    /**
     * Constructor
     */
    constructor(config:any) {
        this.eos = Eos(config);
    }

    /**
     * Recreates the Eos object
     * @param config
     */
    public setConfig(config:any):void {
        this.eos = Eos(config);
    }

    /**
     * Recovers the public key from a signature
     * @param {string} sig
     * @param {string} data
     * @param {string} encoding
     * @returns {string}
     */
    public recover(sig:string, data:string, encoding:string = "utf8"):string {
        return Ecc.recover(sig, data);
    }

    /**
     * Returns a hash of the specified data
     * @param {string} data
     * @returns {string}
     */
    public sha256(data:string):string {
        return Ecc.sha256(data);
    }

    /**
     * Returns the server signature for the specified data toSign.
     * @param {string} dataToSign
     * @returns {string}
     */
    public signServerData(dataToSign:string) : string {
        let privateKey:string = this.getServerPrivateKey();
        return Ecc.sign(dataToSign, privateKey);
    }

    /**
     * Verifies the signature as being the server on a particular data. This
     * isn't really used by the client/server code, but just used to check that
     * the signature logic works. The actual check is done on the blockchain.
     * @param {string} dataToVerify
     * @param {string} sig
     * @returns {boolean}
     */
    public verifyServerSignature(dataToVerify:string, sig:string):boolean {
        let publicKey:string = this.getServerPublicKey();
        return this.verifySignature(dataToVerify, publicKey, sig);
    }

    /**
     * Verifies a signature using specified public key
     * @param {string} dataToVerify
     * @param {string} publicKey
     * @param {string} sig
     * @returns {boolean}
     */
    public verifySignature(dataToVerify:string, publicKey:string, sig:string):boolean {
        let toRet = false;
        try {
            toRet = Ecc.verify(sig, dataToVerify, publicKey);
        } catch (err) {
            toRet = false;
        }
        return toRet;
    }

    /**
     * Retrieves the account innformation for a given EOS account
     * @param {string} accountName
     * @returns {Promise<any>}
     */
    public getAccount(accountName:string) : Promise<any> {
        return this.eos.getAccount(accountName);
    }

    /**
     * Gets the balance of a given EOS account
     * @param {string} accountName
     * @param {string} contract
     * @param {string} symbol
     * @returns {Promise<any>}
     */
    public getBalance(accountName:string, contract:string = "eosio.token", symbol:string = "EOS") : Promise<any> {
        return this.eos.getCurrencyBalance(contract, accountName, symbol);
    }

    /**
     * Returns all of the actions in a transaction
     * @param {string} transactionId
     * @returns {Promise<any>}
     */
    public getTransaction(transactionId:string) : Promise<any> {
        return this.eos.getTransaction(transactionId);
    }

    /**
     * Returns a paged view of actions on a contract. The actions are returned in
     * ascending chronological (block) order in pages starting at the action at
     * pos and ending including the action at (pos + offset)
     * i.e. [pos ... (pos + offset)] (inclusive)
     *
     * @param {string} contract
     * @param {number} pos (starting position to return)
     * @param {number} offset (the number of records to retrieve, can be positive or negative)
     * @returns {Promise<any>}
     */
    public getActions(contract:string, pos:number = 0, offset: number = 10) : Promise<any> {
        return this.eos.getActions(contract, pos, offset);
    }

    /**
     * Returns the server private key. To generate new keys, use the shell command:
     *
     * cleos create key --to-console
     *
     * @returns {string}
     */
    private getServerPrivateKey():string {
        // TODO Get the server private key
        // return "5KGn7K3W4bALrsLARN8Tc6eRjLDDurvHzFP8JfMm9FfTzY33pqB"; // Temporary
        return "5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3";
    }

    /**
     * Returns the server public key
     * @returns {string}
     */
    private getServerPublicKey():string {
        // TODO Get the server public key
        // return "EOS6QYaq3pFpAewTGbXwbvADJ2nfuR2geiURft9mWcco5JXtsiwtE"; // Temporary
        return "EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV";
    }
}