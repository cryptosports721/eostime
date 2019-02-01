// Configuration object for EOSRoller client-side application
import {ConfigBase} from "../server/ConfigBase";

// Supported view states
export enum ViewState {
    LOGGED_IN = 0,
    LOGGED_OUT
}

export class Config extends ConfigBase {

    public static LOCAL_STORAGE_KEY_EOS_NETWORK:string = "LOCAL_STORAGE_EOS_NETWORK";
    public static LOCAL_STORAGE_KEY_CLIENT_SEED:string = "LOCAL_STORAGE_KEY_CLIENT_SEED";
    public static LOCAL_STORAGE_KEY_AUTO_RANDOMIZE:string = "LOCAL_STORAGE_KEY_AUTO_RANDOMIZE";

    public static SCATTER_NETWORK:any = {
        // "mainnet" : {
        //     blockchain: 'eos',
        //     protocol: 'https',
        //     host: 'nodes.get-scatter.com',
        //     port: 443,
        //     chainId: 'aca376f206b8fc25a6ed44dbdc66547c36c6c33e3a119ffbeaef943642f0e906'
        // },
        "mainnet" : {
            blockchain: 'eos',
            protocol: 'https',
            host: 'mainnet.eoscanada.com',
            port: 443,
            chainId: 'aca376f206b8fc25a6ed44dbdc66547c36c6c33e3a119ffbeaef943642f0e906'
        },
        "jungle" : {
            blockchain: 'eos',
            protocol: 'https',
            host: 'api.jungle.alohaeos.com',
            port: 443,
            chainId: 'e70aaab8997e1dfce58fbfac80cbbb8fecec7b99cf982a9444273cbc64c41473'
        },
        "jungle-no-ssl" : {
            blockchain: 'eos',
            protocol: 'http',
            host: 'jungle.cryptolions.io',
            port: 18888,
            chainId: '038f4b0fc8ff18a4f0842a8f0564611f6e96e8535901dd45e43ac8691a1c4dca'
        }
    };

    public static API_SERVER:any = {
        "jungle": {
            // "host": "http://localhost",
            "host": "https://jungle-elb.eostime.io",
            "port": 4001
        },
        "mainnet": {
            // "host": "http://63.33.62.156",
            "host": "https://mainnet-elb.eostime.io",
            "port": 4001
        }
    };

    public static EOSTIME_CONTRACT:string = "eostimecontr";
    public static TIME_TOKEN_CONTRACT:string = "eostimetoken";
    public static TIME_TOKEN_SYMBOL:string = "TIME";

    public static REFERRAL_LINK_PREFIX:string = "https://eostime.io?ref=";

    public static TX_INFO_LINK_PREFIX:any = {
        "jungle": "https://jungle.bloks.io/transaction/",
        "mainnet": "https://bloks.io/transaction/"
    };

    public static ACCOUNT_INFO_LINK_PREFIX:any = {
        "jungle": "https://jungle.bloks.io/account/",
        "mainnet": "https://bloks.io/account/"
    }

    // Mozilla/5.0 (iPhone; CPU iPhone OS 12_1_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) TokenPocket_iOS
    // Mozilla/5.0 (Linux; Android 7.0; Redmi Note 4 Build/NRD90M; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/68.0.3440.91 Mobile Safari/537.36 TokenPocket_Android
    public static LIMITED_MOBILE_UI:boolean = navigator.userAgent.indexOf("TokenPocket_Android") >= 0;

    // public static DEFAULT_GUAGE_OPTIONS:any = {
    //     min: 0,
    //     max: 100,
    //     unit: "%",
    //     color: "lightgreen",
    //     colorAlpha: 1,
    //     bgcolor: "#222",
    //     type: "default",
    //     textVal: null,
    // };
    public static GUAGE_OPTIONS:any = {
        "default": {
            min: 0,
            max: 100,
            unit: "%",
            color: "lightgreen",
            colorAlpha: 1,
            activeColor: "lightgreen",
            bgcolor: "#222",
            type: "default",
            textVal: null
        }, "yellow": {
            min: 0,
            max: 100,
            unit: "%",
            color: "#f6c522",
            colorAlpha: 1,
            activeColor: "#77b300",
            bgcolor: "#222",
            type: "default",
            textVal: null
        }
    };

    // TODO Make this 100
    public static MAX_WINNERS_IN_GUI:number = 15;
}