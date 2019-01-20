import {DBMysql} from "./DBMysql";
import {serverSeeds} from "./entities/serverSeeds";
import {harpoon} from "./entities/harpoon";
import moment = require("moment");

const crypto = require('crypto');
const ecc = require('eosjs-ecc');

export class HarpoonManager {

    private dbManager:DBMysql;
    private serverKey:string;

    constructor(dbManager:DBMysql, serverKey:string) {
        this.dbManager = dbManager;
        this.serverKey = serverKey;
    }

    /**
     * Returns the seeds for a given auction (specified by auction ID)
     * @param {number} auctionId
     * @returns {Promise<any>}
     */
    public getServerHashAndClientSeed(auctionId:number):Promise<any> {
        return new Promise<any>(async (resolve, reject) => {
            try {
                let hash: string;
                let clientSeed: number;
                let ss: serverSeeds = await this.dbManager.entityManager().findOne(serverSeeds, {auctionId: auctionId});
                if (ss) {
                    hash = crypto.createHash('sha256').update(ss.serverSeed).digest("hex");
                    clientSeed = parseInt(ss.clientSeed);
                } else {
                    let guid: string = this.guid();
                    hash = crypto.createHash('sha256').update(guid).digest("hex");
                    ss = new serverSeeds();
                    ss.creationDatetime = new Date();
                    ss.auctionId = auctionId;
                    ss.serverSeed = guid;
                    await this.dbManager.entityManager().save(ss);
                }
                resolve({serverHash: hash, clientSeed: clientSeed});

            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Performs the harpoon random event
     * @param {string} accountName
     * @param {serverSeeds} ss
     * @param {number} odds
     * @returns {Promise<any>}
     */
    public harpoonAuction(accountName:string, ss:serverSeeds, odds:number):Promise<any> {
        return new Promise<any>(async (resolve, reject) => {
            try {
                let toRet: any = {
                    status: "miss"
                }
                toRet.clientSeed = parseInt(ss.clientSeed);
                toRet.serverSeed = ss.serverSeed;
                toRet.serverSeedHash = crypto.createHash('sha256').update(ss.serverSeed).digest("hex");
                toRet.randomNumber = this.generate32BitRandomNumberFromSeeds(ss);
                toRet.below = Math.round(odds * 4294967295);
                if (toRet.randomNumber <= toRet.below) {
                    // Successfully harpooned!
                    toRet.status = "pending";
                }
                let h: harpoon = new harpoon();
                h.creationDatetime = new Date();
                h.auctionId = ss.auctionId;
                h.accountName = accountName;
                h.clientSeed = parseInt(ss.clientSeed);
                h.serverSeed = ss.serverSeed;
                h.odds = odds;
                h.result = toRet.randomNumber.toString();
                h.status = toRet.status;
                await h.save();
                resolve(toRet);
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Generates a ranodom number from a serverSeed record
     * @param {serverSeeds} ss
     * @returns {number}
     */
    public generate32BitRandomNumberFromSeeds(ss:serverSeeds):number {
        let toHash:string = ss.clientSeed.toString() + ss.serverSeed;
        let sha512:string = crypto.createHash('sha512').update(toHash).digest("hex");
        return parseInt(sha512.substr(0, 8), 16);
    }

    private guid():string {
        function s4() {
            return Math.floor((1 + Math.random()) * 0x10000)
                .toString(16)
                .substring(1);
        }
        return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
    }
}