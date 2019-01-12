import {DBManager} from "./DBManager";
import {Config} from "./Config";
import {ClientConnection} from "./ClientConnection";
import {EosBlockchain} from "./EosBlockchain";
import {DBMysql} from "./DBMysql";
import {user} from "./entities/user";
import {QueryRunner} from "typeorm";
import {payment} from "./entities/payment";

export class FaucetManager {

    private dbManager:DBManager;
    private dbMySql:DBMysql;
    private eos: () => EosBlockchain;
    private static faucetCache:any = {};
    private static ipCache:any = {};

    constructor (dbManager:DBManager, dbMySql:DBMysql, eos: () => EosBlockchain) {
        this.dbManager = dbManager;
        this.dbMySql = dbMySql;
        this.eos = eos;
    }


    /**
     * Returns the faucet info and implements a cache so we can handle
     * someone beating at the faucet.
     *
     * @param {string} accountName
     * @param {string} ipAddress
     * @returns {Promise<any>}
     */
    public getFaucetInfo(accountName:string, ipAddress:string):Promise<any> {

        return new Promise<any>(async (resolve, reject) => {

            try {
                let faucetInfo: any = null;
                this.purgeFaucetCache();

                // Check the cache
                faucetInfo = this.checkFaucetCache(accountName, ipAddress);
                if (faucetInfo) {
                    resolve(faucetInfo);
                } else {
                    let account: user = await this.dbMySql.qb(user, "user").where({accountName: accountName}).getOne();
                    if (account) {
                        if (account.lastFaucetDatetime) {
                            let deltaSecs: number = Math.floor(new Date().getTime() / 1000) - account.lastFaucetDatetime.getTime() / 1000;
                            if (deltaSecs < Config.FAUCET_FREQUENCY_SECS) {
                                faucetInfo = {
                                    account: accountName,
                                    nextDrawSecs: Config.FAUCET_FREQUENCY_SECS - deltaSecs,
                                    drawEverySecs: Config.FAUCET_FREQUENCY_SECS
                                };
                                FaucetManager.faucetCache[accountName] = faucetInfo;
                                FaucetManager.ipCache[ipAddress] = faucetInfo;
                            }
                        }
                        if (!faucetInfo) {
                            faucetInfo = {
                                account: accountName,
                                nextDrawSecs: 0,
                                drawEverySecs: Config.FAUCET_FREQUENCY_SECS
                            };
                        }
                        resolve(faucetInfo);
                    } else {
                        reject("No such user " + accountName);
                    }
                }
            } catch (err) {
                reject(err);
            }
        });
    }

    public faucetDraw(accountName:string, ipAddress:string):Promise<any> {

        return new Promise<any>(async (resolve, reject) => {

            this.purgeFaucetCache();

            // If in cache then we return the value from the cache (hitting us too early, which should not
            // happen if the user is coming from our web site)
            let faucetInfo:any = this.checkFaucetCache(accountName, ipAddress);
            if (faucetInfo) {
                resolve(faucetInfo);
            } else {

                let qr: QueryRunner = await this.dbMySql.startTransaction();
                try {
                    let account: user = await qr.manager.getRepository(user).createQueryBuilder().where({accountName: accountName}).getOne();
                    if (account) {
                        let faucetAward: any = null;
                        let now = Math.floor(new Date().getTime() / 1000);
                        if (account.lastFaucetDatetime) {
                            let deltaSecs: number = now - account.lastFaucetDatetime.getTime() / 1000;
                            if (deltaSecs < Config.FAUCET_FREQUENCY_SECS) {
                                faucetAward = {
                                    account: accountName,
                                    nextDrawSecs: Config.FAUCET_FREQUENCY_SECS - deltaSecs,
                                    drawEverySecs: Config.FAUCET_FREQUENCY_SECS
                                };
                                this.dbMySql.rollbackTransaction(qr);
                                resolve(faucetAward);
                                return;
                            }
                        }
                        if (!faucetAward) {

                            // We can award the faucet
                            let award: number;
                            let randomDraw: number = Math.floor(Math.random() * 10000); // Should be 10001
                            if (randomDraw <= 9885) {
                                award = 0.0005;
                            } else if (randomDraw <= 9985) {
                                award = 0.005;
                            } else if (randomDraw <= 9993) {
                                award = 0.05;
                            } else if (randomDraw <= 9998) {
                                award = 0.5;
                            } else if (randomDraw <= 9999) {
                                award = 5;
                            } else {
                                award = 50;
                            }

                            account.lastFaucetDatetime = new Date();
                            await account.save();

                            let pmt:payment = new payment();
                            pmt.creationDatetime = new Date();
                            pmt.paymentState = "paid";
                            pmt.accountName = accountName;
                            pmt.amount = award;
                            pmt.currency = "EOS";
                            pmt.paymentType = "faucet";
                            pmt.user_ = account;

                            let receipt: any = await this.eos().faucetPayout(accountName, award);

                            pmt.transactionId = receipt.transaction_id;
                            await pmt.save();

                            // Create our faucet cache entry to eliminate the need to
                            // check the database on future requests (which should not
                            // happen from our website).
                            FaucetManager.faucetCache[accountName] = {
                                lastFaucetTime: now,
                                cacheHitTime: now,
                                cacheHits: 0
                            };
                            FaucetManager.ipCache[ipAddress] = {
                                lastFaucetTime: now,
                                cacheHitTime: now,
                                cacheHits: 0
                            };

                            this.dbMySql.commitTransaction(qr);

                            faucetAward = {
                                account: accountName,
                                randomDraw: randomDraw,
                                eosAward: award,
                                nextDrawSecs: Config.FAUCET_FREQUENCY_SECS
                            };

                            resolve(faucetAward);
                        }

                    } else {
                        this.dbMySql.rollbackTransaction(qr);
                        reject(new Error("CTS_FAUCET_DRAW: Did not find user " + accountName + " in database"));
                    }
                } catch (err) {
                    this.dbMySql.rollbackTransaction(qr);
                    reject(err);
                }
            }
        });
    }

    /**
     * Returns the faucet info and implements a cache so we can handle
     * someone beating at the faucet.
     *
     * @param {string} accountName
     * @param {string} ipAddress
     * @returns {Promise<any>}
     */
    public getFaucetInfo_(accountName:string, ipAddress:string):Promise<any> {

        return new Promise<any>((resolve, reject) => {

            let faucetInfo: any = null;
            this.purgeFaucetCache();

            // Check the cache
            faucetInfo = this.checkFaucetCache(accountName, ipAddress);
            if (faucetInfo) {
                resolve(faucetInfo);
            } else {

                // Hit the database
                this.dbManager.getDocumentByKey("users", {accountName: accountName}).then((user) => {
                    if (user) {
                        if (user.lastFaucetTime) {
                            let deltaSecs: number = Math.floor(new Date().getTime() / 1000) - user.lastFaucetTime;
                            if (deltaSecs < Config.FAUCET_FREQUENCY_SECS) {
                                faucetInfo = {
                                    account: accountName,
                                    nextDrawSecs: Config.FAUCET_FREQUENCY_SECS - deltaSecs,
                                    drawEverySecs: Config.FAUCET_FREQUENCY_SECS
                                };
                                FaucetManager.faucetCache[accountName] = faucetInfo;
                                FaucetManager.ipCache[ipAddress] = faucetInfo;
                            }
                        }
                        if (!faucetInfo) {
                            faucetInfo = {
                                account: accountName,
                                nextDrawSecs: 0,
                                drawEverySecs: Config.FAUCET_FREQUENCY_SECS
                            };
                        }
                        resolve(faucetInfo);
                    } else {
                        reject("No such user " + accountName);
                    }

                }).catch((err) => {
                    console.log(err);
                    reject(err);
                });
            }
        });
    }

    public faucetDraw_(accountName:string, ipAddress:string):Promise<any> {

        return new Promise<any>((resolve, reject) => {

            this.purgeFaucetCache();

            // If in cache then we return the value from the cache (hitting us too early, which should not
            // happen if the user is coming from our web site)
            let faucetInfo:any = this.checkFaucetCache(accountName, ipAddress);
            if (faucetInfo) {
                resolve(faucetInfo);
            } else {
                this.dbManager.getDocumentByKey("users", {accountName: accountName}).then((user) => {
                    if (user) {
                        let faucetAward: any = null;
                        let now = Math.floor(new Date().getTime() / 1000);
                        if (user.lastFaucetTime) {
                            let deltaSecs: number = now - user.lastFaucetTime;
                            if (deltaSecs < Config.FAUCET_FREQUENCY_SECS) {
                                faucetAward = {
                                    account: accountName,
                                    nextDrawSecs: Config.FAUCET_FREQUENCY_SECS - deltaSecs,
                                    drawEverySecs: Config.FAUCET_FREQUENCY_SECS
                                };
                                resolve(faucetAward);
                                return;
                            }
                        }
                        if (!faucetAward) {

                            // We can award the faucet
                            let award: number;
                            let randomDraw: number = Math.floor(Math.random() * 10000); // Should be 10001
                            if (randomDraw <= 9885) {
                                award = 0.0005;
                            } else if (randomDraw <= 9985) {
                                award = 0.005;
                            } else if (randomDraw <= 9993) {
                                award = 0.05;
                            } else if (randomDraw <= 9998) {
                                award = 0.5;
                            } else if (randomDraw <= 9999) {
                                award = 5;
                            } else {
                                award = 50;
                            }

                            // Create our faucet cache entry to eliminate the need to
                            // check the database on future requests (which should not
                            // happen from our website).
                            FaucetManager.faucetCache[accountName] = {
                                lastFaucetTime: now,
                                cacheHitTime: now,
                                cacheHits: 0
                            };
                            FaucetManager.ipCache[ipAddress] = {
                                lastFaucetTime: now,
                                cacheHitTime: now,
                                cacheHits: 0
                            };

                            let currentFaucetAwards: number = Config.safeProperty(user, ["totalFaucetAwards"], 0);
                            let newFaucetAwards: number = currentFaucetAwards + award;
                            this.dbManager.updateDocumentByKey("users", {accountName: accountName}, {
                                lastFaucetTime: now,
                                totalFaucetAwards: newFaucetAwards
                            }).then((result) => {

                                // Pay the faucet recipient
                                this.eos().faucetPayout(accountName, award).then((result) => {
                                    faucetAward = {
                                        account: accountName,
                                        randomDraw: randomDraw,
                                        eosAward: award,
                                        totalEosAwards: newFaucetAwards,
                                        nextDrawSecs: Config.FAUCET_FREQUENCY_SECS
                                    };
                                    resolve(faucetAward);
                                }).catch((reason) => {
                                    console.log(reason);
                                    reject(reason);
                                });

                            }).catch((reason) => {
                                console.log(reason);
                                reject(reason);
                            });
                        }
                    } else {
                        reject("CTS_FAUCET_DRAW: Did not find user " + accountName + " in database");
                    }
                }).catch((err) => {
                    console.log(err);
                    reject(err);
                });
            }
        });
    }

    // ------------------------------------------------------------------------
    // PRIVATE METHODS
    // ------------------------------------------------------------------------

    /**
     * Purges the faucetCache of entries that are no longer in the waiting zone
     */
    private purgeFaucetCache():void {
        for (let key in FaucetManager.faucetCache) {
            let cacheEntry = FaucetManager.faucetCache[key];
            let deltaSecs:number = Math.floor(new Date().getTime()/1000) - cacheEntry.lastFaucetTime;
            if (deltaSecs >= Config.FAUCET_FREQUENCY_SECS) {
                delete FaucetManager.faucetCache[key];
            }
        }
        for (let key in FaucetManager.ipCache) {
            let cacheEntry = FaucetManager.ipCache[key];
            let deltaSecs:number = Math.floor(new Date().getTime()/1000) - cacheEntry.lastFaucetTime;
            if (deltaSecs >= Config.FAUCET_FREQUENCY_SECS) {
                delete FaucetManager.ipCache[key];
            }
        }
    }

    /**
     * Checks our faucet cache to see if we are blocked from receiving a faucet award
     * @param {string} accountName
     * @returns {any}
     */
    private checkFaucetCache(accountName:string, ipAddress:string) : any {
        let faucetInfo:any = null;

        // Check by account name
        if (FaucetManager.faucetCache.hasOwnProperty(accountName)) {
            let cacheEntry:any = FaucetManager.faucetCache[accountName];
            let deltaSecs:number = Math.floor(new Date().getTime()/1000) - cacheEntry.lastFaucetTime;
            if (deltaSecs < Config.FAUCET_FREQUENCY_SECS) {

                // Check, for abuse
                let now = Math.floor(new Date().getTime()/1000);
                let secsSinceLastCacheCheck:number = now - cacheEntry.cacheHitTime;
                if (secsSinceLastCacheCheck < 5) {
                    if (++cacheEntry.cacheHits > 3) {
                        // TODO block this IP because they are banging at the faucet
                    }
                } else {
                    cacheEntry.cacheHits = 0;
                    cacheEntry.cacheHitTime = now;
                }

                // Return the faucet information
                faucetInfo = {
                    account: accountName,
                    nextDrawSecs: Config.FAUCET_FREQUENCY_SECS - deltaSecs,
                    drawEverySecs: Config.FAUCET_FREQUENCY_SECS
                };
            }
        }

        // Check by IP address
        if (!faucetInfo) {
            if (FaucetManager.ipCache.hasOwnProperty(ipAddress)) {
                let cacheEntry: any = FaucetManager.ipCache[ipAddress];
                let deltaSecs: number = Math.floor(new Date().getTime() / 1000) - cacheEntry.lastFaucetTime;
                if (deltaSecs < Config.FAUCET_FREQUENCY_SECS) {

                    // Check, for abuse
                    let now = Math.floor(new Date().getTime() / 1000);
                    let secsSinceLastCacheCheck: number = now - cacheEntry.cacheHitTime;
                    if (secsSinceLastCacheCheck < 5) {
                        if (++cacheEntry.cacheHits > 3) {
                            // TODO block this IP because they are banging at the faucet
                        }
                    } else {
                        cacheEntry.cacheHits = 0;
                        cacheEntry.cacheHitTime = now;
                    }

                    // Return the faucet information
                    faucetInfo = {
                        account: accountName,
                        nextDrawSecs: Config.FAUCET_FREQUENCY_SECS - deltaSecs,
                        drawEverySecs: Config.FAUCET_FREQUENCY_SECS
                    };
                }
            }
        }
        return faucetInfo;
    }
}