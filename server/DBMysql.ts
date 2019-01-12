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
     * Creates a dividend receipt in the database from the dividend receipt JSON
     * in a single transaction.
     *
     * @param dividendJsonReceipt
     * @returns {Promise<void>}
     */
    public newDividendReceipt(dividendJsonReceipt:any):Promise<void> {
        return new Promise<void>(async (resolve, reject) => {

           let success:boolean = true;
           if (this.conn) {
               const now:Date = new Date();
               const queryRunner:QueryRunner = this.conn.createQueryRunner();
               await queryRunner.connect();
               await queryRunner.startTransaction();
               try {

                   let div: dividend = new dividend();
                   div.creationDatetime = now;
                   div.timeTokenSupply = dividendJsonReceipt.timeTokenSupply;
                   div.originalDividendBalance = dividendJsonReceipt.originalDividendBalance;
                   div.houseProfit = dividendJsonReceipt.houseProfit;
                   div.stakersProfit = dividendJsonReceipt.stakersProfit;
                   div.dividendBalance = dividendJsonReceipt.dividendBalance;
                   div.eostimecontrRecharge = dividendJsonReceipt.eostimecontrRecharge;
                   div.eostimecontrRecharge = 100.0;
                   await queryRunner.manager.save(div);

                   // Transfer back to eostimecontr
                   if (dividendJsonReceipt.dividendInfo.topOff > 0) {
                       let transferToContr:payment = new payment();
                       transferToContr.creationDatetime = now;
                       transferToContr.accountName = Config.eostimeContract;
                       transferToContr.amount = dividendJsonReceipt.dividendInfo.topOff;
                       transferToContr.currency = "EOS";
                       transferToContr.paymentState = "pending";
                       transferToContr.paymentType = "transfer";
                       transferToContr.dividend_ = div;
                       await queryRunner.manager.save(transferToContr);
                   }

                   // Create our housePayment
                   let housePmt:payment = new payment();
                   housePmt.creationDatetime = now;
                   housePmt.accountName = Config.eostimeTokenCorpo;
                   housePmt.amount = div.houseProfit;
                   housePmt.currency = "EOS";
                   housePmt.paymentState = "pending";
                   housePmt.paymentType = "house";
                   housePmt.dividend_ = div;
                   await queryRunner.manager.save(housePmt);

                   // Create our stakerPayment
                   for (let sp of dividendJsonReceipt.stakersPayments) {
                       let stakerPayment:payment = new payment();
                       stakerPayment.creationDatetime = now;
                       stakerPayment.accountName = sp.account;
                       stakerPayment.amount = sp.amount;
                       stakerPayment.currency = "EOS";
                       stakerPayment.paymentState = "pending";
                       stakerPayment.paymentType = "staker";
                       let u:user = await this.userFromAccount(queryRunner.manager, sp.account);
                       if (u) {
                           stakerPayment.user_ = u;
                       }
                       stakerPayment.dividend_ = div;
                       await queryRunner.manager.save(stakerPayment);
                   }

                   // Loop through and create our staker payments
                   for (let accountName in dividendJsonReceipt.accounts) {
                       let pmt:any = dividendJsonReceipt.accounts[accountName];
                       let userPayment:payment = new payment();
                       userPayment.amount = pmt.distribution;
                       userPayment.currency = "EOS";
                       userPayment.creationDatetime = now;
                       userPayment.paymentState = (userPayment.amount > 0) ? pmt.paymentState : "paid";
                       userPayment.paymentType = "dividend";
                       userPayment.accountName = pmt.accountName;
                       userPayment.proportion = pmt.proportion;
                       let u:user = await this.userFromAccount(queryRunner.manager, accountName);
                       if (u) {
                           userPayment.user_ = u;
                       }
                       userPayment.dividend_ = div;
                       await queryRunner.manager.save(userPayment);
                   }

                   await queryRunner.commitTransaction();

               } catch (err) {
                   success = false;
                   await queryRunner.rollbackTransaction();
               } finally {
                   await queryRunner.release();
               }
               if (success) {
                   resolve();
               } else {
                   reject();
               }
           } else {
               reject();
           }

        });
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