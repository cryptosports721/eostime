// Configuration object for EOSRoller server application
import {ConfigBase} from "./ConfigBase";

export class Config extends ConfigBase {

    public static DEVELOPER_MODE:boolean = true;

    public static EOS_ENDPOINTS:any = {
        "localhost": "http://localhost:8888",
        "jungle": "https://junglehistory.cryptolions.io:443",
    };

    public static WINNERS_LIST_LIMIT:number = 100;

    // TODO Make this 1 hour
    public static FAUCET_FREQUENCY_SECS = 20; // 3600; // 1 hour

    public static FAUCET_PAYOUT_MEMO:string = 'eostime.io faucet payout';

    /**
     * Sets the schedule for dividend payouts
     * {
     *  second (0-59)
     *  minute (0-59)
     *  hour (0-23)
     *  date (1-31)
     *  month (0-11)
     *  year
     *  dayOfWeek (0-6) Starts with Sunday
     * }
     */
    public static DIVIDEND_PAYOUT_SCHEDULE:any = {
        minute: 0
    }

    /*
    public static EOS_CONFIG:any = {
        "mainnet": {
            expireInSeconds: 60,
            broadcast: true,
            debug: false,
            sign: true,
            // mainNet bp endpoint
            httpEndpoint: 'https://api.eosnewyork.io',
            // mainNet chainId
            chainId: 'aca376f206b8fc25a6ed44dbdc66547c36c6c33e3a119ffbeaef943642f0e906'
        },
        "jungle": {
            expireInSeconds: 60,
            broadcast: true,
            debug: false,
            sign: true,
            // jungle bp endpoint
            httpEndpoint: 'http://dev.cryptolions.io:18888', // http://jungle.cryptolions.io:18888',
            // jungle chainId
            chainId: '038f4b0fc8ff18a4f0842a8f0564611f6e96e8535901dd45e43ac8691a1c4dca'
        },
        "jungle-AWS-large": { // 54.164.95.106
            expireInSeconds: 60,
            broadcast: true,
            debug: false,
            sign: true,
            // jungle bp endpoint
            httpEndpoint: 'http://54.164.95.106:18888',
            // jungle chainId
            chainId: '038f4b0fc8ff18a4f0842a8f0564611f6e96e8535901dd45e43ac8691a1c4dca'
        },
        "jungle-AWS-small": { // 54.152.82.172
            expireInSeconds: 60,
            broadcast: true,
            debug: false,
            sign: true,
            // jungle bp endpoint
            httpEndpoint: 'http://54.164.95.106:18888',
            // jungle chainId
            chainId: '038f4b0fc8ff18a4f0842a8f0564611f6e96e8535901dd45e43ac8691a1c4dca'
        },
        "localhost": {
            expireInSeconds: 60,
            broadcast: true,
            debug: false,
            sign: true,
            // jungle bp endpoint
            httpEndpoint: 'http://localhost:8888',
            // jungle chainId
            chainId: '038f4b0fc8ff18a4f0842a8f0564611f6e96e8535901dd45e43ac8691a1c4dca'
        }
    };
    */

}