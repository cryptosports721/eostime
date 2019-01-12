import { Api, JsonRpc, RpcError, GetInfoResult } from 'eosjs';
import {Config} from "./Config";
const Ecc = require('eosjs-ecc');
const fetch = require('node-fetch');
const JsSignatureProvider = require('eosjs/dist/eosjs-jssig');
const { TextDecoder, TextEncoder } = require('text-encoding');

export class EosBlockchain {

    private eosEndpoint:string;
    private eosRpc:JsonRpc;
    private serverConfig:any;
    private contractPrivateKey:string;
    private faucetPrivateKey:string;
    private housePrivateKey:string;

    /**
     * Constructor
     */
    constructor(eosEndpoint:string, serverConfig:any  = null, contractPrivateKey:string = null, faucetPrivateKey:string = null, housePrivateKey:string = null) {
        this.eosEndpoint = eosEndpoint;
        this.serverConfig = serverConfig;
        this.eosRpc = new JsonRpc(this.eosEndpoint, {fetch});
        this.contractPrivateKey = contractPrivateKey;
        this.faucetPrivateKey = faucetPrivateKey;
        this.housePrivateKey = housePrivateKey;
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
    }

    public getScope():Promise<any> {
        return this.eosRpc
    }

    /**
     * Pays out from the dividend account to the target account
     * @param {string} accountName
     * @param {number} amount
     * @param {string} memo
     * @returns {Promise<any>}
     */
    public dividendPayout(accountName:string, amount: number, memo:string):Promise<any> {
        const rpc = this.eosRpc;
        const signatureProvider = new JsSignatureProvider.default([this.housePrivateKey]);
        const api:Api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });
        return api.transact({
            actions: [
                {
                    account: 'eosio.token',
                    name: 'transfer',
                    authorization: [{
                        actor: this.serverConfig.dividendAccount,
                        permission: 'active',
                    }],
                    data: {
                        from: this.serverConfig.dividendAccount,
                        to: accountName,
                        quantity: amount.toFixed(4) + ' EOS',
                        memo: memo
                    },
                }
            ]
        }, {
            blocksBehind: 3,
            expireSeconds: 30,
        });
    }

    /**
     * Pays out a faucet reward
     * @param {string} accountName
     * @param {number} amount
     */
    public faucetPayout(accountName:string, amount:number):Promise<any> {
        const rpc = this.eosRpc;
        const signatureProvider = new JsSignatureProvider.default([this.faucetPrivateKey]);
        const api:Api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });
        return api.transact({
            actions: [
                {
                    account: 'eosio.token',
                    name: 'transfer',
                    authorization: [{
                        actor: this.serverConfig.faucetContract,
                        permission: 'active',
                    }],
                    data: {
                        from: this.serverConfig.faucetContract,
                        to: accountName,
                        quantity: amount.toFixed(4) + ' EOS',
                        memo: Config.FAUCET_PAYOUT_MEMO
                    },
                }
            ]
        }, {
            blocksBehind: 3,
            expireSeconds: 30,
        });

    }

    /**
     * Enables / disables an auction specified by its ID
     *
     * @param {boolean} enable
     * @param {number} auctionId
     * @returns {Promise<any>}
     */
    public enableAuction(enable:boolean, auctionId:number):Promise<any> {
        const rpc = this.eosRpc;
        const signatureProvider = new JsSignatureProvider.default([this.contractPrivateKey]);
        const api:Api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });
        return api.transact({
            actions: [
                {
                    account: this.serverConfig.eostimeContract,
                    name: 'rzenable',
                    authorization: [{
                        actor: this.serverConfig.eostimeContract,
                        permission: 'active',
                    }],
                    data: {
                        enable: enable ? 1 : 0
                    }
                }
            ]
        }, {
            blocksBehind: 3,
            expireSeconds: 30,
        });
    }

    /**
     * Creates an auction on the blockchain. Data is in the format:
     *
     * {
     *  redzone_type: 2001,
     *  init_prize_pool: "10.0000 EOS",
     *  init_bid_price: "0.1000 EOS",
     *  bid_multiplier_x100k: 105000,
     *  bidder_timecoins_per_eos: 50,
     *  referrer_portion_x100k: 375,
     *  winner_timecoins_per_eos: 10,
     *  house_portion_x100k: 9625,
     *  init_bid_count: 25000,
     *  init_duration_secs: 86400,
     *  init_redzone_secs: 60,
     *  back_to_back_bids_allowed: 1
     * }
     *
     * @param data
     * @returns {Promise<any>}
     */
    public createAuction(data:any):Promise<any> {
        const rpc = this.eosRpc;
        const signatureProvider = new JsSignatureProvider.default([this.contractPrivateKey]);
        const api:Api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });
        return api.transact({
            actions: [
                {
                    account: this.serverConfig.eostimeContract,
                    name: 'rzcreate',
                    authorization: [{
                        actor: this.serverConfig.eostimeContract,
                        permission: 'active',
                    }],
                    data: data
                }
            ]
        }, {
            blocksBehind: 3,
            expireSeconds: 30,
        });
    }

    /**
     * Pays out the specific auctionId, and then replace it with another defined
     * by the replacementParameters object.
     *
     * @param {number} auctionId
     * @param replacementParameters
     * @returns {Promise<any>}
     */
    public replaceAuctionParams(auctionId:number, replacementParameters:any):Promise<any> {
        const rpc = this.eosRpc;
        const signatureProvider = new JsSignatureProvider.default([this.contractPrivateKey]);
        const api:Api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });
        return api.transact({
            actions: [
                {
                    account: this.serverConfig.eostimeContract,
                    name: 'rzenable',
                    authorization: [{
                        actor: this.serverConfig.eostimeContract,
                        permission: 'active',
                    }],
                    data: {
                        redzone_id: auctionId,
                        enable: false
                    },
                },
                {
                    account: this.serverConfig.eostimeContract,
                    name: 'rzdelete',
                    authorization: [{
                        actor: this.serverConfig.eostimeContract,
                        permission: 'active',
                    }],
                    data: {
                        redzone_id: auctionId
                    },
                },
                {
                    account: this.serverConfig.eostimeContract,
                    name: 'rzcreate',
                    authorization: [{
                        actor: this.serverConfig.eostimeContract,
                        permission: 'active',
                    }],
                    data: replacementParameters,
                }
            ]
        }, {
            blocksBehind: 3,
            expireSeconds: 30,
        });
    }

    /**
     * Pays out the specific auctionId, and then replace it with another defined
     * by the replacementParameters object.
     *
     * @param {number} auctionId
     * @param replacementParameters
     * @param {boolean} issueWinnerBonusTimeCoins
     * @returns {Promise<any>}
     */
    public payoutAndReplace(auctionId:number, replacementParameters:any, issueWinnerBonusTimeCoins:boolean = true):Promise<any> {
        const rpc = this.eosRpc;
        const signatureProvider = new JsSignatureProvider.default([this.contractPrivateKey]);
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
                        issue_winner_bonus_time_coins: issueWinnerBonusTimeCoins
                    },
                },
                {
                    account: this.serverConfig.eostimeContract,
                    name: 'rzenable',
                    authorization: [{
                        actor: this.serverConfig.eostimeContract,
                        permission: 'active',
                    }],
                    data: {
                        redzone_id: auctionId,
                        enable: false
                    },
                },
                {
                    account: this.serverConfig.eostimeContract,
                    name: 'rzdelete',
                    authorization: [{
                        actor: this.serverConfig.eostimeContract,
                        permission: 'active',
                    }],
                    data: {
                        redzone_id: auctionId
                    },
                },
                {
                    account: this.serverConfig.eostimeContract,
                    name: 'rzcreate',
                    authorization: [{
                        actor: this.serverConfig.eostimeContract,
                        permission: 'active',
                    }],
                    data: replacementParameters,
                }
            ]
        }, {
            blocksBehind: 3,
            expireSeconds: 30,
        });
    }

    /**
     * Calls the blockchain payout auction method and roll over the auction
     *
     * @param {number} auctionId
     * @param {boolean} issueWinnerBonusTimeCoins
     * @returns {Promise<any>}
     */
    public payoutAndRestartAuction(auctionId:number, issueWinnerBonusTimeCoins:boolean = true):Promise<any> {
        const rpc = this.eosRpc;
        const signatureProvider = new JsSignatureProvider.default([this.contractPrivateKey]);
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
                        issue_winner_bonus_time_coins: issueWinnerBonusTimeCoins
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
     * @param {string} scope
     * @param {number} lowerBound
     * @param {number} upperBound
     * @param {number} limit
     * @returns {Promise<any>}
     */
    public getTable(contract:string, table: string, scope:string = null, lowerBound:number = 0, upperBound:number = -1, limit: number = 10):Promise<any> {
        if (scope === null) {
            scope = contract;
        }
        return this.eosRpc.get_table_rows({json:true, code:contract, scope:scope, table:table, table_key: 0, lower_bound: lowerBound, upper_bound: upperBound, limit: limit});
    }

    /**
     *
     * @param {string} contract
     * @param {string} lowerBound
     * @param {string} upperBound
     * @param {number} limit
     * @returns {Promise<any>}
     */
    public getTableByScope(contract:string, lowerBound:string = "", upperBound:string = "", limit: number = 10):Promise<any> {
        return this.eosRpc.get_table_by_scope({json:true, code:contract, table: "", lower_bound: lowerBound, upper_bound: upperBound, limit: limit});
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