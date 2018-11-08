import Socket from "socket.io";
import {SocketMessage} from "./SocketMessage";
import {EosBlockchain} from "./EosBlockchain";
import {Config} from "./Config";
import {Moment} from "moment";
import {DBManager} from "./DBManager";

var moment = require('moment');

export class ClientConnection {

    // Global that holds all active client connections
    public static CONNECTIONS:ClientConnection[] = new Array<ClientConnection>();

    // Private class members
    private sio:any;
    private ipAddress;
    private socketMessage:SocketMessage;
    private eos:EosBlockchain;
    private network:string = null;
    private accountInfo:any = null;
    private dbManager = null;

    constructor(_socket:Socket.Socket, dbManager:DBManager) {

        this.dbManager = dbManager;

        if (!this.isBlockedIPAddress(_socket.handshake.address)) {
            this.ipAddress = _socket.handshake.address;
            // Setup this ClientConnection
            this.socketMessage = new SocketMessage(_socket);
            this.attachAPIHandlers();

            // Add ourselves to the active list of connections
            ClientConnection.CONNECTIONS.push(this);

            // Let the client know that we are connected
            this.socketMessage.stcConnected();
        } else {
            // Kill the socket and associated resources
            _socket.disconnect();
        }
    }

    /**
     * Getter for accountInfo member
     * @returns {any}
     */
    public getAccountInfo():any {
        return this.accountInfo;
    }

    /**
     * Sends new accountInfo object to client
     * @param accountName
     */
    public sendAccountInfo(accountName:string):void {
        // Send EOS account info to the client
        let retryCount:number = 0;
        const getAccoutFromBlockchain = function() {
            // Send account information to the client
            this.eos.getAccount(accountName).then((accountInfo: any) => {
                this.socketMessage.stcDevError("Sent account info for " + accountName + " to client");
                this.accountInfo = accountInfo;
                this.registerClientAccount(accountInfo);
                this.socketMessage.stcAccountInfo(accountInfo);
            }).catch((err: any) => {
                if (err) {
                    if (err.status == 500) {
                        // TODO ADD THE SOCKET'S IP TO THE BLOCKED LIST BECAUSE THE ACCOUNT
                        console.log("BAD ACCOUNT");
                    } else if (err.status == 429) {
                        // Indicates too many requests out to EOS blockchain, try
                        // again in 1 second up to five times.
                        retryCount++;
                        if (retryCount < 5) {
                            let localThis:ClientConnection = this;
                            return new Promise(function(resolve) {
                                setTimeout(() => {
                                    localThis.socketMessage.stcDevError("Retry #" + retryCount.toString() + " EOSjs getAccount()");
                                    getAccoutFromBlockchain();
                                }, 1000);
                            });
                        } else {
                            this.socketMessage.stcDevError("EOSjs getAccount(" + accountName + ") Too many requests failure");
                        }
                    } else if (err.message) {
                        this.socketMessage.stcDevError(err.message);
                    } else {
                        this.socketMessage.stcDevError("Unknown error EOSjs getAccount(" + accountName + ")");
                    }
                } else {
                    this.socketMessage.stcDevError("NULL error EOSjs getAccount(" + accountName + ")");
                }
            });
        }.bind(this);
        this.socketMessage.stcDevError("Retrieving account information for " + accountName + " from EOS");
        getAccoutFromBlockchain();
    }

    /**
     * Attaches handlers for API messages sent by the client
     */
    private attachAPIHandlers():void {

        let socket:Socket.Socket = this.socketMessage.getSocket();

        // Handle the disconnect of the client
        socket.on("disconnect", () => {
            // Remove this socket from our active list
            for (let i:number = 0; i < ClientConnection.CONNECTIONS.length; i++) {
                let cs:ClientConnection = ClientConnection.CONNECTIONS[i];
                if (socket.id == cs.socketMessage.getSocket().id) {
                    ClientConnection.CONNECTIONS.splice(i, 1);
                    if (this.accountInfo) {
                        let timestamp:string = moment().format();
                        console.log("[" + this.accountInfo.account_name + "] DISCONNECTED at " + timestamp);
                    }
                    break;
                }
            }
        });

        // Sent when the client knows the EOS account associated with this socket
        socket.on(SocketMessage.CTS_EOS_ACCOUNT, (data:any) => {

            // TODO Need to verify the expected properties of data

            // Put the client in developer mode
            if (Config.DEVELOPER_MODE) {
                this.socketMessage.stcDeveloperMode();
                this.socketMessage.stcClearDevErrors();
            }

            data = JSON.parse(data);
            let account:any = data.account;

            // Create our eos instance
            this.network = data.network;
            this.eos = new EosBlockchain(Config.EOS_CONFIG[this.network]);

            // Validate the scatter signature
            let host:string = data.data;
            let portStart:number = host.indexOf(":");
            if (portStart > 0) {
                host = host.substr(0, portStart);
            }
            if (this.eos.verifySignature(host, data.publicKey, data.sig)) {

                let timestamp:string = moment().format();
                console.log("[" + account.name + "] CONNECTED from IP " + this.socketMessage.getSocket().handshake.address + " at " + timestamp);

                // Save our network
                this.network = data.network;

                // Send the account info structure to the client
                this.sendAccountInfo(account.name);
            } else {
                // TODO BAD SCATTER SIGNATURE
                this.socketMessage.stcDevError("[" + account.name + "] BAD SIGNATURE from IP " + this.socketMessage.getSocket().handshake.address);
            }
        });
    }

    /**
     * Checks to see if the IP address is currently to be blocked
     * @param {string} ipAddress
     * @returns {boolean}
     */
    private isBlockedIPAddress(ipAddress:string):boolean {
        // TODO NEED TO CHECK IP AGAINST BLOCKED ONES
        return false;
    }

    /**
     * Registers an account in the database if it has not already been registered.
     * @param accountInfo
     */
    private registerClientAccount(accountInfo:any) : Promise<void> {
        return this.dbManager.getDocumentByKey("users", {accountName: accountInfo.account_name}).then((user) => {
            if (user) {
                // We have already seen this guy
                if (user.ipAddresses.indexOf(this.ipAddress) < 0) {
                    user.ipAddresses.push(this.ipAddress);
                }
                user.eosBalance = accountInfo.core_liquid_balance;
                user.lastConnectedTime = moment().format();
                return this.dbManager.updateDocumentByKey("users", {accountName: accountInfo.account_name}, user);
            } else {
                // This is a new user
                let user:any = {
                    accountName: accountInfo.account_name,
                    eosBalance: accountInfo.core_liquid_balance,
                    lastConnectedTime: moment().format(),
                    ipAddresses: [this.ipAddress]
                }
                return this.dbManager.insertDocument("users", user);
            }
        }).catch((err) => {
            console.log(err);
        });
    }

}