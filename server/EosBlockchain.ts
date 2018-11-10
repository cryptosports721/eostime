import { Api, JsonRpc, RpcError, JsSignatureProvider, GetInfoResult } from 'eosjs';
const Ecc = require('eosjs-ecc');
const fetch = require('node-fetch');
const { TextDecoder, TextEncoder } = require('text-encoding');

export class EosBlockchain {

    private eosNetworkConfig:any;
    private eosRpc:JsonRpc;
    private serverConfig:any;
    private contractPrivateKey:string = null;

    /**
     * Constructor
     */
    constructor(eosNetworkConfig:any, serverConfig, contractPrivateKey:string) {
        this.eosNetworkConfig = eosNetworkConfig;
        this.serverConfig = serverConfig;
        this.eosRpc = new JsonRpc(eosNetworkConfig.httpEndpoint, {fetch});
        this.contractPrivateKey = contractPrivateKey;
    }

    /**
     * Recreates the Eos object
     * @param config
     */
    public setConfig(config:any):void {
        this.eosNetworkConfig = config;
        this.eosRpc = new Api(config);
    }

    /**
     * Returns our network config object
     * @returns {any}
     */
    public getConfig():any {
        return this.eosNetworkConfig;
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
        return this.eosRpc.get_account(accountName);
    }

    /**
     * Gets the balance of a given EOS account
     * @param {string} accountName
     * @param {string} contract
     * @param {string} symbol
     * @returns {Promise<any>}
     */
    public getBalance(accountName:string, contract:string = "eosio.token", symbol:string = "EOS") : Promise<any> {
        return this.eosRpc.get_currency_balance(contract, accountName, symbol);
    }

    /**
     * Gets the head block and other info regarding the EOS blockchain
     * @returns {Promise<any>}
     */
    public getInfo():Promise<GetInfoResult> {
        return this.eosRpc.get_info();
        // return new Promise<any>((resolve, reject) => {
        //
        // });
    }

    /**
     * Calls the blockchain payout auction method
     * @param {number} auctionId
     * @returns {Promise<any>}
     */
    public payoutAuction(auctionId:number):Promise<any> {
        const rpc = this.eosRpc;
        const signatureProvider = new JsSignatureProvider([this.contractPrivateKey]);
        const api:Api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });
        return api.transact({
            actions: [
                {
                    account: this.serverConfig.eostimeContract,
                    name: 'rzpaywinner',
                    authorization: [{
                        actor: this.serverConfig.eostimeContract,
                        permission: 'active',
                    }],
                    data: {
                        redzone_id: auctionId,
                    },
                },
                {
                    account: this.serverConfig.eostimeContract,
                    name: 'rzrestart',
                    authorization: [{
                        actor: this.serverConfig.eostimeContract,
                        permission: 'active',
                    }],
                    data: {
                        redzone_id: auctionId,
                    }
                }
            ]
        }, {
            blocksBehind: 3,
            expireSeconds: 30,
        });
    }

    /**
     * Restarts an auction of a particular type
     * @param {number} auctionId
     * @returns {Promise<any>}
     */
    public restartAuction(auctionId:number):Promise<any> {
        return new Promise<any>((resolve, reject) => {

        });
    }

    /**
     * Returns all of the actions in a transaction
     * @param {string} transactionId
     * @returns {Promise<any>}
     */
    // public getTransaction(transactionId:string) : Promise<any> {
    //     return this.eos.getgetTransaction(transactionId);
    // }

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
        return this.eosRpc.history_get_actions(contract, pos, offset);
    }

    /**
     * Returns the complete table
     *
     * @param {string} contract
     * @param {string} table
     * @param {number} pos
     * @param {number} offset
     * @returns {Promise<any>}
     */
    public getTable(contract:string, table: string, lowerBound:number = 0, upperBound:number = -1, limit: number = 10):Promise<any> {
        return this.eosRpc.get_table_rows({json:true, code:contract, scope:contract, table:table, table_key: 0, lower_bound: lowerBound, upper_bound: upperBound, limit: limit});
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