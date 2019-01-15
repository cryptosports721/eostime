import {DBMysql} from "./DBMysql";
import {serverSeeds} from "./entities/serverSeeds";

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
     * Returns the required bid signature for the currently running auction as
     * specified by its type.
     *
     * @param {string} accountName
     * @param {number} auctionType
     * @returns {string}
     */
    public getBidSignature(accountName:string, auctionId:number):string {
        // signature = ecc.sign(toSign, this.serverKey);
        return "";
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