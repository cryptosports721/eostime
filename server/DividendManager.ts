import {DBManager} from "./DBManager";
import {EosBlockchain} from "./EosBlockchain";
import {Config} from "./Config";

var schedule = require('node-schedule');

export class DividendManager {

    private dbManager:DBManager;
    private eosBlockchain:EosBlockchain;
    private notificationCallback:(data:any) => void;

    private job:any = null;

    constructor(dbManager:DBManager, eosBlockchain:EosBlockchain, notificationCallback:(data:any) => void = null) {
        this.dbManager = dbManager;
        this.eosBlockchain = eosBlockchain;
        this.notificationCallback = notificationCallback;
    }

    public start():void {
        if (!this.job) {
            // Create our recurrence rule
            let rule:any = new schedule.RecurrenceRule();
            for (let key in Config.DIVIDEND_PAYOUT_SCHEDULE) {
                rule[key] = Config.DIVIDEND_PAYOUT_SCHEDULE[key];
            }
            schedule.scheduleJob(rule, this.dividendPayoutFunction.bind(this));
        }
    }

    public stop():void {
        if (this.job) {
            this.job.cancel();
            this.job = null;
        }
    }

    public currentDividendPool():Promise<number> {
        return this.eosBlockchain.getBalance(Config.eostimeDividendContract);
    }

    private dividendPayoutFunction():void {
        this.currentDividendPool().then((balance:number) => {
            console.log("dividendPayoutFunction() called with balance of " + balance);
        });
    }


}