import "reflect-metadata";
import {BaseEntity, ConnectionOptions, createConnection, getConnection, ObjectType, SelectQueryBuilder} from "typeorm";
import {Connection} from "typeorm/connection/Connection";
import {dividend} from "./entities/dividend";
import {payment} from "./entities/payment";
import {Config} from "./Config";
import {user} from "./entities/user";
import {EntityManager} from "typeorm/entity-manager/EntityManager";
import {QueryRunner} from "typeorm/query-runner/QueryRunner";
import {Repository} from "typeorm/repository/Repository";
import {applicationSettings} from "./entities/applicationSettings";
import {bid} from "./entities/bid";
import moment = require("moment");
import {auctions} from "./entities/auctions";
import {auctionType} from "./entities/auctionType";
import {harpoon} from "./entities/harpoon";
const mysql = require('mysql');

export class DBMysql {

    private connectionOptions:ConnectionOptions = null;
    private conn:Connection = null;

    /**
     * Constructor connects to the database
     * @param {ConnectionOptions} connectionOptions
     */
    constructor(connectionOptions:ConnectionOptions) {
        this.connectionOptions = connectionOptions;
    }

    /**
     * Connects to our MySql database
     */
    public connect():Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            createConnection(this.connectionOptions).then((connection:Connection) => {
                this.conn = connection;
                resolve(true);
            }).catch((error) => {
                console.log("Could not open eostime MYSQL database and start the EOS blockchain watcher");
                console.log(error.message);
                resolve(false);
            });
        });

    }

    /**
     * Disconnects from our MySql database
     */
    public close():void {
        if (this.conn) {
            this.conn.close();
            this.conn = null;
        }
    }

    /**
     * Query builder for any entity
     * @param Entity
     * @param {string} alias
     * @returns {SelectQueryBuilder<Entity>}
     */
    public qb<T>(Entity: new () => T, alias:string):SelectQueryBuilder<T> {
        let repo:Repository<T> = this.conn.getRepository(Entity);
        return repo.createQueryBuilder();
    }

    /**
     * Returns the entity manager
     * @returns {EntityManager}
     */
    public entityManager():EntityManager {
        return this.conn.manager;
    }

    /**
     * Returns a repository to use on the database
     * @param {ObjectType<BaseEntity>} target
     * @returns {Repository<BaseEntity>}
     */
    public repository(target:ObjectType<BaseEntity>):Repository<BaseEntity> {
        return this.conn.getRepository(target);
    }

    /**
     * Returns our connection
     * @returns {Connection}
     */
    public getConnection():Connection {
        return this.conn;
    }

    /**
     * Creates a query runner on our database
     * @returns {QueryRunner}
     */
    public queryRunner():QueryRunner {
        return this.conn.createQueryRunner();
    }

    /**
     * Starts a transaction on the mysql database
     * @returns {Promise<QueryRunner>}
     */
    public startTransaction():Promise<QueryRunner> {
        return new Promise<QueryRunner>(async (resolve, reject) => {
            let success = true;
            if (this.conn) {
                const now:Date = new Date();
                const queryRunner:QueryRunner = this.conn.createQueryRunner();
                await queryRunner.connect();
                await queryRunner.startTransaction();
                resolve(queryRunner);
            } else {
                reject();
            }
        });
    }

    /**
     * Commits a previously started transaction
     * @param {QueryRunner} queryRunner
     * @returns {Promise<void>}
     */
    public commitTransaction(queryRunner:QueryRunner):Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            try {
                await queryRunner.commitTransaction();
                await queryRunner.release();
                resolve();
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Rolls back a previously started transaction
     * @param {QueryRunner} queryRunner
     * @returns {Promise<void>}
     */
    public rollbackTransaction(queryRunner:QueryRunner):Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            try {
                await queryRunner.rollbackTransaction();
                await queryRunner.release();
                resolve();
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Gets a value from our applicationSettings table
     * @param {string} key
     * @returns {Promise<string>}
     */
    public getConfig(key:string):Promise<string> {
        return new Promise<string>(async (resolve, reject) => {
            try {
                let val: applicationSettings = await this.conn.manager.findOne(applicationSettings, {key: key});
                if (typeof val == 'undefined') {
                    resolve(val);
                } else {
                    resolve(val.value);
                }
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Creates or updates an entry in the applicationSettings table
     * @param {string} key
     * @param {string} val
     * @returns {Promise<void>}
     */
    public setConfig(key:string, val: string):Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            try {
                let appSetting: applicationSettings = await this.conn.manager.findOne(applicationSettings, {key: key});
                if (appSetting) {
                    appSetting.value = val;
                    appSetting.save();
                } else {
                    appSetting = new applicationSettings();
                    appSetting.key = key;
                    appSetting.value = val;
                }
                await appSetting.save();
                resolve();
            } catch (err) {
                reject(err);
            }
        });
    }

    // ------------------------------------------------------------------------
    // Usefull table-specific classes
    // ------------------------------------------------------------------------

    /**
     * Returns the recent list of winners from the MySql database
     * @param {number} count
     * @returns {Promise<auctions[]>}
     */
    public loadRecentWinners(count:number):Promise<auctions[]> {
        return new Promise<auctions[]>(async (resolve, reject) => {
            try {
                let toRet:any[] = new Array<any>();
                let recentAuctions:auctions[] = await this.qb(auctions, "auctions").where("auctions.lastBidderAccount IS NOT NULL").orderBy("auctions.endedDatetime", "DESC").limit(count).getMany();
                for (let recentAuction of recentAuctions) {
                    let a:any = await this.winningAuctionObjectFromInstance(recentAuction);
                    toRet.push(a);
                }
                resolve(toRet);
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Returns a winning auction object compatible with the client from
     * a TypeORM auctions class. Includes a list of bids in decending order.
     *
     * @param {auctions} auction
     * @returns {Promise<any>}
     */
    public winningAuctionObjectFromInstance(auction:auctions):Promise<any> {
        return new Promise<any>(async (resolve, reject) => {
            try {
                let winningAuction: any = {
                    id: auction.auctionId,
                    type: auction.auctionType,
                    last_bidder: auction.lastBidderAccount,
                    prize_pool: auction.prizePool,
                    creation_time: Math.floor(auction.creationDatetime.getTime()/1000),
                    expires: Math.floor(auction.endedDatetime.getTime()/1000),
                    blockNumber: auction.blockNumber,
                    transactionId: auction.transactionId,
                    flags: auction.flags
                };
                winningAuction["bidders"] = await this.auctionBids(auction.auctionId);
                let harpoons:harpoon[] = await this.entityManager().find(harpoon, {auctionId: auction.auctionId});
                let harpoonsObject:any = {};
                for (let h of harpoons) {
                    harpoonsObject[h.accountName] = {
                        "creationDatetime": h.creationDatetime,
                        "status": h.status,
                        "accountName": h.accountName,
                        "serverSeed": h.serverSeed,
                        "clientSeed": h.clientSeed,
                        "odds": h.odds,
                        "result": h.result
                    };
                }
                winningAuction["harpoons"] = harpoonsObject;
                resolve(winningAuction);
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Assembles an array of auction bids for a given auction specified by auctionId
     * @param {number} auctionId
     * @returns {Promise<any[]>}
     */
    public auctionHarpoons(auctionId:number):Promise<any[]> {
        return new Promise<any[]>(async (resolve, reject) => {
            try {
                let harpoons:harpoon[] = await this.qb(harpoon, "harpoon").where("harpoon.auctionId = :id", { id: auctionId }).getMany();
                let h:any = {};
                for (let hp of harpoons) {
                    h[hp.accountName] = {
                        accountName: hp.accountName,
                        status: hp.status,
                        clientSeed: hp.clientSeed,
                        serverSeed: hp.serverSeed,
                        odds: hp.odds,
                        result: hp.result
                    };
                }
                resolve(h);

            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Assembles an array of auction bids for a given auction specified by auctionId
     * @param {number} auctionId
     * @returns {Promise<any[]>}
     */
    public auctionBids(auctionId:number):Promise<any[]> {
        return new Promise<any[]>(async (resolve, reject) => {
            try {
                let bids:bid[] = await this.qb(bid, "bid").where("bid.auctionId = :id", { id: auctionId }).orderBy("bid.bidId", "DESC").getMany();
                let b:any[] = new Array<any>();
                for (let bd of bids) {
                    b.push({
                        accountName: bd.accountName,
                        amount: bd.amount,
                        currency: bd.currency
                    });
                }
                resolve(b);

            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Records a bid record (deals with creating or updating)
     * @param data
     * @returns {Promise<void>}
     */
    public recordBid(data:any):Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            try {
                let timestamp: Date = new Date(parseInt(moment(data.block_time + "+00:00").local().format("X")) * 1000.0);
                let newBid: bid = await this.entityManager().findOne(bid, {bidId: data.bid_id});
                if (!newBid) {
                    newBid = new bid();
                    newBid.bidId = data.bid_id;
                }
                newBid.auctionId = data.redzone_id;
                newBid.accountName = data.bidder;
                newBid.amount = parseFloat(data.bid_price.split(" ")[0]);
                newBid.currency = "EOS";
                newBid.creationDatetime = timestamp;

                if (data.hasOwnProperty("house_portion")) {
                    newBid.housePortion = parseFloat(data.house_portion.split(" ")[0]);
                }
                if (data.hasOwnProperty("bidder_bonus")) {
                    newBid.bidderTimeTokens = parseFloat(data.bidder_bonus.split(" ")[0]);
                }
                if (data.hasOwnProperty("referrer_bonus")) {
                    newBid.referrerPortion = parseFloat(data.referrer_bonus.split(" ")[0]);
                }
                try {
                    await newBid.save();
                    resolve();
                } catch (err) {
                    if (err && err.code && (err.code != "ER_DUP_ENTRY")) {
                        console.log("Error saving record to MySql database");
                        console.log(err);
                        reject(err);
                    } else {
                        if (data.hasOwnProperty("house_portion") && data.hasOwnProperty("bidder_bonus") && data.hasOwnProperty("referrer_bonus")) {

                            // Perhaps the AuctionManager already wrote the record, so we just update
                            // the record with additional information picked up from the bid receipt.
                            //
                            let amBid: bid = await this.entityManager().findOne(bid, {bidId: data.bid_id});
                            if (amBid) {
                                amBid.housePortion = parseFloat(data.house_portion.split(" ")[0]);
                                amBid.referrerPortion = parseFloat(data.referrer_bonus.split(" ")[0]);
                                amBid.bidderTimeTokens = parseFloat(data.bidder_bonus.split(" ")[0]);
                                await amBid.save();
                            }
                            resolve();
                        }
                    }
                }
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Retrieves a user from the database, optionally creating one if need be
     * @param {EntityManager} manager
     * @param {string} accountName
     * @param {boolean} createIfNeeded
     * @returns {Promise<user>}
     */
    public userFromAccount(manager:EntityManager, accountName:string, createIfNeeded:boolean = true):Promise<user> {
        return new Promise<user>(async (resolve, reject) => {
            try {
                let u: user = await manager.findOne(user, {accountName: accountName});
                if (u) {
                    resolve(u);
                } else {
                    if (createIfNeeded) {
                        u = new user();
                        u.creationDatetime = new Date();
                        u.accountName = accountName;
                        u.acceptedTerms = "false";
                        u.connectionCount = 0;
                        await manager.save(u);
                        resolve(u);
                    } else {
                        resolve(null);
                    }
                }
            } catch (err) {
                reject(err);
            }
        });
    }
}