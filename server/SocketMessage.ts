import Socket from "socket.io";
import {Config} from "./Config";

export class SocketMessage {

    private socket:Socket.Socket;

    constructor(_socket:Socket.Socket) {
        this.socket = _socket;
    }

    /**
     * Getter for socket
     * @returns {Socket.Socket}
     */
    public getSocket():Socket.Socket {
        return this.socket;
    }

    /**
     * Destorys this object by disconnecting from the API
     * server and deleting reference to the socket.
     */
    public destroy():void {
        if (this.socket) {
            this.socket.disconnect()
            this.socket = null;
        }
    }

    /**
     * Standard data in all messages sent from server to client
     * @returns {any}
     */
    public static standardServerDataObject():any {
        return {"timestamp": Math.floor(new Date().getTime()/1000)};
    }

    // ========================================================================
    // CLIENT TO SERVER MESSAGES
    // ========================================================================

    /**
     * Sends the logged-in account structure returned from scatter to the server
     * @param account
     * @param {string} network
     * @param {string} dataToVerify
     * @param {string} publicKey
     * @param {string} sig
     */
    public static CTS_EOS_ACCOUNT:string = "CTS_EOS_ACCOUNT";
    public ctsEOSAccount(account:any, network:string, dataToVerify:string, publicKey:string, sig:string):void {
        let data:any = {"account": account, "network": network, "data": dataToVerify, "publicKey": publicKey, "sig": sig};
        this.socket.emit(SocketMessage.CTS_EOS_ACCOUNT, JSON.stringify(data));
    }

    /**
     * Asks the server for the next server seed hash, will result in a corresponding
     * STC_SERVER_HASH message.
     * @param {string} referrer EOS account name of the referrer, or "" if none
     * @param {number} rollUnder Roll under value for the bet
     */
    public static CTS_GET_NEXT_SERVER_HASH:string = "CTS_GET_NEXT_SERVER_HASH";
    public ctsGetNextServerHash(referrer:string, rollUnder:number):void {
        this.socket.emit(SocketMessage.CTS_GET_NEXT_SERVER_HASH, JSON.stringify({
            "referrer": referrer,
            "rollUnder": rollUnder
        }));
    }

    /**
     * Asks the server to provide a fresh snapshot of all auctions it is
     * managing.
     * @param {string} referrer EOS account name of the referrer, or "" if none
     * @param {number} rollUnder Roll under value for the bet
     */
    public static CTS_GET_ALL_AUCTIONS:string = "CTS_GET_ALL_AUCTIONS";
    public ctsGetAllAuctions():void {
        this.socket.emit(SocketMessage.CTS_GET_ALL_AUCTIONS, JSON.stringify({}));
    }

    // ========================================================================
    // SERVER TO CLIENT MESSAGES
    // ========================================================================

    /**
     * Sends the STC_CLIENT_CONNECTED message to the client so it knows that
     * the server has recognized the connection
     */
    public static STC_CLIENT_CONNECTED:string = "STC_CLIENT_CONNECTED";
    public stcConnected():void {
        let data:any = SocketMessage.standardServerDataObject();
        this.socket.emit(SocketMessage.STC_CLIENT_CONNECTED, JSON.stringify(data));
    }

    /**
     * Sends the STC_ACCOUNT_INFO message to the client with account info
     * for the specific account received in the CTS_EOS_ACCOUNT message.
     */
    public static STC_ACCOUNT_INFO:string = "STC_ACCOUNT_INFO";
    public stcAccountInfo(accountInfo:any):void {
        let data:any = {...SocketMessage.standardServerDataObject(), ...accountInfo};
        this.socket.emit(SocketMessage.STC_ACCOUNT_INFO, JSON.stringify(data));
    }

    /**
     * Sends a server error message to the client.
     */
    public static STC_ERROR:string = "STC_ERROR";
    public stcError(message:string):void {
        let data:any = {...SocketMessage.standardServerDataObject(), ...{"message": message}};
        this.socket.emit(SocketMessage.STC_ERROR, JSON.stringify(data));
    }

    /**
     * Sends a server error message to the client only if in developer mode.
     */
    public static STC_DEV_ERROR:string = "STC_DEV_ERROR";
    public stcDevMessage(message:string):void {
        if (Config.DEVELOPER_MODE) {
            let data: any = {...SocketMessage.standardServerDataObject(), ...{"message": message}};
            this.socket.emit(SocketMessage.STC_DEV_ERROR, JSON.stringify(data));
        }
    }

    /**
     * Clears the developer messages on the client
     */
    public static STC_CLEAR_DEV_ERRORS:string = "STC_CLEAR_DEV_ERRORS";
    public stcClearDevErrors():void {
        if (Config.DEVELOPER_MODE) {
            let data: any = SocketMessage.standardServerDataObject();
            this.socket.emit(SocketMessage.STC_CLEAR_DEV_ERRORS, JSON.stringify(data));
        }
    }

    /**
     * Sends the STC_DEV_MODE message to the client to indicate this
     * client can operate in developer mode. (additional GUI may be
     * displayed to assist in the development stages of things)
     */
    public static STC_DEV_MODE:string = "STC_DEV_MODE";
    public stcDeveloperMode():void {
        let data:any = SocketMessage.standardServerDataObject();
        this.socket.emit(SocketMessage.STC_DEV_MODE, JSON.stringify(data));
    }

    /**
     * Sends the next server seed hash to the client,
     * @param {string} serverHash
     * @param {string} sig Signature of the betting parameters
     */
    public static STC_SERVER_HASH:string = "STC_SERVER_HASH";
    public stcServerHash(serverHash:string, sig:string):void {
        let data:any = {...{"serverHash": serverHash}, ...SocketMessage.standardServerDataObject()};
        this.socket.emit(SocketMessage.STC_SERVER_HASH, JSON.stringify(data));
    }

    /**
     * Sends the current auction data to the client
     * @param {string} serverHash
     * @param {string} sig Signature of the betting parameters
     */
    public static STC_CURRENT_AUCTIONS:string = "STC_CURRENT_AUCTIONS";
    public stcCurrentAuctions(auctions:any[]):void {
        let data:any = {auctions, ...SocketMessage.standardServerDataObject()};
        this.socket.emit(SocketMessage.STC_CURRENT_AUCTIONS, JSON.stringify(data));
    }

    /**
     * Notifies client of a newly added auction
     * @param {string} serverHash
     * @param {string} sig Signature of the betting parameters
     */
    public static STC_ADD_AUCTION:string = "STC_ADD_AUCTION";

    /**
     * Notifies client of a newly added auction
     * @param {string} serverHash
     * @param {string} sig Signature of the betting parameters
     */
    public static STC_REMOVE_AUCTION:string = "STC_REMOVE_AUCTION";

    /**
     * Notifies client of a newly added auction
     * @param {string} serverHash
     * @param {string} sig Signature of the betting parameters
     */
    public static STC_CHANGE_AUCTION:string = "STC_CHANGE_AUCTION";

    /**
     * Notifies client of a newly added auction
     * @param {string} serverHash
     * @param {string} sig Signature of the betting parameters
     */
    public static STC_END_AUCTION:string = "STC_END_AUCTION";

    /**
     * Notifies client of a new auction winner!
     * @param {string} serverHash
     * @param {string} sig Signature of the betting parameters
     */
    public static STC_WINNER_AUCTION:string = "STC_WINNER_AUCTION";

    /**
     * Tells client to update its coin balances
     * @type {string}
     */
    public static STC_UPDATE_BALANCES:string = "STC_UPDATE_BALANCES";
    public stcUpdateBalances():void {
        let data:any = {...SocketMessage.standardServerDataObject()};
        this.socket.emit(SocketMessage.STC_UPDATE_BALANCES, JSON.stringify(data));
    }

}
