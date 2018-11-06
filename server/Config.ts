// Configuration object for EOSRoller server application
import {ConfigBase} from "./ConfigBase";

export class Config extends ConfigBase {

    public static DEVELOPER_MODE:boolean = true;

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
            httpEndpoint: 'http://jungle.cryptolions.io:18888',
            // jungle chainId
            chainId: '038f4b0fc8ff18a4f0842a8f0564611f6e96e8535901dd45e43ac8691a1c4dca'
        }
    };

}