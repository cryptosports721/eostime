// Configuration object for EOSRoller client-side application
import {ConfigBase} from "../server/ConfigBase";

// Supported view states
export enum ViewState {
    LOGGED_IN = 0,
    LOGGED_OUT
}

export class Config extends ConfigBase {

    public static LOCAL_STORAGE_KEY_EOS_NETWORK:string = "LOCAL_STORAGE_EOS_NETWORK";

    public static SCATTER_NETWORK:any = {
        "mainnet" : {
            blockchain: 'eos',
            protocol: 'https',
            host: 'nodes.get-scatter.com',
            port: 443,
            chainId: 'aca376f206b8fc25a6ed44dbdc66547c36c6c33e3a119ffbeaef943642f0e906'
        },
        "jungle" : {
            blockchain: 'eos',
            protocol: 'http',
            host: 'jungle.cryptolions.io',
            port: 18888,
            chainId: '038f4b0fc8ff18a4f0842a8f0564611f6e96e8535901dd45e43ac8691a1c4dca'
        }
    };

    public static API_SERVER:any = {
        // "host": "http://localhost",
        "host": "http://54.164.95.106",
        "port": 4001
    };

    public static TIME_TOKEN_CONTRACT:string = "eostimetoken";
    public static TIME_TOKEN_SYMBOL:string = "TIME";

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