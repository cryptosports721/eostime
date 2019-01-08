import "reflect-metadata";
import {ConnectionOptions, createConnection, getConnection} from "typeorm";
import {Connection} from "typeorm/connection/Connection";
import {dividend} from "./entities/dividend";
import {payment} from "./entities/payment";
import {Config} from "./Config";
import {user} from "./entities/user";
import {EntityManager} from "typeorm/entity-manager/EntityManager";
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
                console.log("Could not open eostime database and start the EOS blockchain watcher");
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
               const queryRunner = this.conn.createQueryRunner();
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
                   div.paymentState = dividendJsonReceipt.paymentState;
                   div.eostimecontrRecharge = 100.0;
                   await queryRunner.manager.save(div);

                   // Create our housePayment
                   let housePmt:payment = new payment();
                   housePmt.creationDatetime = now;
                   housePmt.accountName = Config.eostimeDividendContract;
                   housePmt.amount = div.houseProfit;
                   housePmt.currency = "EOS";
                   housePmt.paymentState = div.paymentState;
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
                       stakerPayment.paymentState = div.paymentState;
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
                   await queryRunner.release();
                   resolve();

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