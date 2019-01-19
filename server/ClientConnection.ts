import Socket from "socket.io";
import iplocation from "iplocation";
import {SocketMessage} from "./SocketMessage";
import {EosBlockchain} from "./EosBlockchain";
import {Config} from "./Config";
import {DBManager} from "./DBManager";
import {AuctionManager} from "./AuctionManager";
import {DividendManager} from "./DividendManager";
import {FaucetManager} from "./FaucetManager";
import {BannedUsers} from "./BannedUsers";
import {DBMysql} from "./DBMysql";
import {user} from "./entities/user";
import {QueryRunner, EntityManager, SelectQueryBuilder} from "typeorm";
import {ipAddress} from "./entities/ipAddress";

const moment = require('moment');

export class ClientConnection {

    // Global that holds all active client connections
    public static CONNECTIONS:ClientConnection[] = new Array<ClientConnection>();

    // Private class members
    private ipAddress = "127.0.0.1";
    private socketMessage:SocketMessage;
    private eos: () => EosBlockchain;
    private network:string = null;
    private accountInfo:any = null;
    private dbManager:DBManager = null;
    private dbMySql:DBMysql = null;
    private auctionManager:AuctionManager = null;
    private dividendManager:DividendManager = null;
    private faucetManager:FaucetManager = null;
    private bannedUsers:BannedUsers = null;
    private static GEOLOCATION_PROVIDERS:string[] = null;

    public static socketMessageFromAccountName(accountName:string):SocketMessage {
        let clientConnection:ClientConnection = ClientConnection.CONNECTIONS.find((val) => {
            let accountNameToCompare:string = Config.safeProperty(val, ["accountInfo.account_name"], null);
            return (accountNameToCompare == accountName);
        });
        if (clientConnection) {
            return clientConnection.socketMessage;
        } else {
            return null;
        }
    }

    /**
     * Constructor
     * @param {SocketIO.Socket} _socket
     * @param {DBManager} dbManager
     * @param {AuctionManager} auctionManager
     * @param {DividendManager} dividendManager
     * @param {() => EosBlockchain} eos
     */
    constructor(_socket:Socket.Socket, dbManager:DBManager, dbMysql:DBMysql, auctionManager:AuctionManager, dividendManager:DividendManager, faucetManager:FaucetManager, eos: () => EosBlockchain) {

        this.dbManager = dbManager;
        this.dbMySql = dbMysql;
        this.auctionManager = auctionManager;
        this.dividendManager = dividendManager;
        this.faucetManager = faucetManager;
        this.eos = eos;
        this.bannedUsers = new BannedUsers(this.dbManager);

        // Deal with load balancer forwarding the originator's IP address
        if (_socket) {
            if (_socket.request && _socket.request.headers && _socket.request.headers["x-forwarded-for"]) {
                this.ipAddress = _socket.request.headers["x-forwarded-for"];
            } else {
                this.ipAddress = _socket.handshake.address;
            }

            if (!this.isBlockedIPAddress(this.ipAddress)) {

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
    }

    /**
     * Returns the socket associated with this connection
     * @returns {SocketIO.Socket}
     */
    public getSocket():Socket.Socket {
        return this.socketMessage.getSocket();
    }

    /**
     * Returns the IP address that this socket has connected on.
     * @returns {string}
     */
    public getIPAddress():string {
        return this.ipAddress;
    }

    /**
     * Returns our socket message object
     * @returns {SocketMessage}
     */
    public getSocketMessage():SocketMessage {
        return this.socketMessage;
    }

    /**
     * Getter for accountInfo member
     * @returns {any}
     */
    public getAccountInfo():any {
        return this.accountInfo;
    }

    public sendDevMessage(message:string):void {
        this.socketMessage.stcDevMessage(message);
    }

    /**
     * Sends new accountInfo object to client
     * @param accountName
     */
    public sendAccountInfo(accountName:string, referrer:string):void {
        // Send EOS account info to the client
        let retryCount:number = 0;
        const getAccoutFromBlockchain = function() {
            // Send account information to the client
            this.eos().getAccount(accountName).then((accountInfo: any) => {
                this.accountInfo = accountInfo;
                return this.eos().getBalance(this.accountInfo.account_name, "eostimetoken", "TIME");
            }).then((data: any) => {
                let timeBalance:string = data.length == 1 && data[0].length > 1 ? data[0] : "0.0000 TIME";
                this.accountInfo.timeBalance = timeBalance;
                return this.registerClientAccount(this.accountInfo, referrer);
            }).then((data: any) => {
                this.socketMessage.stcDevMessage("Sent account info for " + this.accountInfo.account_name + " to client");
                this.socketMessage.stcAccountInfo(this.accountInfo);
            }).then((data:any) => {

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
                                    localThis.socketMessage.stcDevMessage("Retry #" + retryCount.toString() + " EOSjs getAccount()");
                                    getAccoutFromBlockchain();
                                }, 1000);
                            });
                        } else {
                            this.socketMessage.stcDevMessage("EOSjs getAccount(" + accountName + ") Too many requests failure");
                        }
                    } else if (err.message) {
                        this.socketMessage.stcDevMessage(err.message);
                    } else {
                        this.socketMessage.stcDevMessage("Unknown error EOSjs getAccount(" + accountName + ")");
                    }
                } else {
                    this.socketMessage.stcDevMessage("NULL error EOSjs getAccount(" + accountName + ")");
                }
            });
        }.bind(this);
        this.socketMessage.stcDevMessage("Retrieving account information for " + accountName + " from EOS");
        getAccoutFromBlockchain();
    }

    /**
     * Public method to return the geolocation of a specific IP address
     *
     * OBJECT RETURNED LOOKS LIKE THIS:
     * {
     *   "country": "United States",
     *   "countryCode": "US",
     *   "region": "Massachusetts",
     *   "regionCode": "MA",
     *   "city": "Wellesley Hills",
     *   "postal": "02481",
     *   "ip": "108.20.173.186",
     *   "latitude": 42.3106,
     *   "longitude": -71.2747,
     *   "timezone": "America/New_York"
     * }
     *
     * @param {string} ipAddress
     * @returns {Promise<any>}
     */
    public geolocateIPAddress(ipAddress:string):Promise<any> {
        return new Promise((resolve, reject) => {
            if (!ClientConnection.GEOLOCATION_PROVIDERS) {
                this.dbManager.getDocumentByKey("applicationSettings", {key: "geolocProviders"}).then((result) => {
                    if (result) {
                        ClientConnection.GEOLOCATION_PROVIDERS = result.value;
                        iplocation(ipAddress, ClientConnection.GEOLOCATION_PROVIDERS, (error, res) => {
                            if (error) {
                                reject(error);
                            } else {
                                resolve(res);
                            }
                        });
                    } else {
                        console.log("Could not get application key 'geolocProviders'");
                        resolve(null);
                    }
                }).catch((reason) => {
                    console.log("Could not get application key 'geolocProviders'");
                    resolve(null);
                });
            } else {
                iplocation(ipAddress, ClientConnection.GEOLOCATION_PROVIDERS, (error, res) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve(res);
                    }
                });
            }
        });
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
        socket.on(SocketMessage.CTS_EOS_ACCOUNT, (payload:any) => {

            // TODO Need to verify the expected properties of data

            // Put the client in developer mode
            if (Config.DEVELOPER_MODE) {
                this.socketMessage.stcDeveloperMode();
                this.socketMessage.stcClearDevErrors();
            }

            payload = JSON.parse(payload);
            let account:any = Config.safeProperty(payload, ["account"], null);
            let data:any = Config.safeProperty(payload, ["data"], null);
            let network:any = Config.safeProperty(payload, ["network"], null);
            if (!account || !data || !network) {
                // We must specify an account, data, and network in the payload.
                this.socketMessage.stcDevMessage("[" + account.name + "] BAD PAYLOAD from IP " + this.socketMessage.getSocket().handshake.address);
                return;
            }

            // Grab the user agent to help determine if the client is mobile or not
            let userAgent:string = Config.safeProperty(payload, ["userAgent"], null);
            if (userAgent) {
                console.log(account.name + " User Agent: " + userAgent);
            }

            // Save our network
            this.network = payload.network;

            // Send the account info structure to the client
            let referrer:string = Config.safeProperty(payload, ["referrer"], null);
            this.sendAccountInfo(account.name, referrer);
        });

        socket.on(SocketMessage.CTS_GET_ALL_AUCTIONS, (data:any) => {
            this.socketMessage.stcCurrentAuctions(this.auctionManager.getAuctions());
        });

        socket.on(SocketMessage.CTS_GET_WINNERS_LIST, (data:any) => {
            let recentWinners:any[] = this.auctionManager.getRecentWinners();
            this.socketMessage.stcSendPastWinners(recentWinners);
        });

        socket.on(SocketMessage.CTS_GET_DIVIDEND_INFO, (data:any) => {
            this.dividendManager.getDividendInfo().then((dividendInfo:any) => {
                this.socketMessage.stcDividendInfo(dividendInfo);
            });
        });

        socket.on(SocketMessage.CTS_GET_FAUCET_INFO, (data:any) => {
            if (this.accountInfo) {
                this.faucetManager.getFaucetInfo(this.accountInfo.account_name, this.ipAddress).then((faucetInfo:any) => {
                    if (faucetInfo) {
                        this.socketMessage.stcFaucetInfo(faucetInfo);
                    }
                }, (reason:any) => {
                    this.socketMessage.stcDevMessage("CTS_GET_FAUCET_INFO: Did not find user " + this.accountInfo.account_name + " in database");
                });
            } else {
                // TODO We should block the IP because this should not happen on our website
            }
        });

        socket.on(SocketMessage.CTS_FAUCET_DRAW, async (data:any) => {
            if (this.accountInfo) {
                this.faucetManager.faucetDraw(this.accountInfo.account_name, this.ipAddress).then((result:any) => {
                    if (result.hasOwnProperty("eosAward")) {
                        this.socketMessage.stcFaucetAward(result);
                    } else {
                        this.socketMessage.stcFaucetInfo(result);
                    }
                }, (reason:any) => {
                    console.log(reason);
                    if (typeof reason == "string") {
                        this.socketMessage.stcDevMessage("Could not payout faucet award.");
                    } else if (reason && reason.message) {
                        this.socketMessage.stcDevMessage(reason.message);
                    }
                });
            } else {
                // TODO We should block the IP because this should not happen on our website
            }
        });

        socket.on(SocketMessage.CTS_GET_BID_SIGNATURE, async (payload:any) => {
            payload = JSON.parse(payload);
            if (this.accountInfo && payload && payload.hasOwnProperty("auctionType") && payload.hasOwnProperty("bidAmount")) {
                let accountName:string = (this.bannedUsers.isBanned(this.accountInfo.account_name, this.ipAddress)) ? "invalid-account-name" : this.accountInfo.account_name;

                // Store the user's clientSeed when he asks for the bid sig
                // and when he becomes
                let clientSeed:any = Config.safeProperty(payload, ["clientSeed"], null);
                if (clientSeed && typeof clientSeed == "number" && !isNaN(clientSeed)) {
                    let bidder:user = await this.dbMySql.entityManager().findOne(user, {accountName: this.accountInfo.account_name});
                    bidder.clientSeed = clientSeed.toString();
                    bidder.save();
                }
                let signature: string = await this.auctionManager.getBidSignature(accountName, payload.auctionType);
                if (signature) {
                    this.socketMessage.stcSendBidSignature(signature, payload.auctionType, payload.bidAmount);
                }
            }
        });

        socket.on(SocketMessage.CTS_GET_HARPOON_SIGNATURE, async (payload:any) => {
            payload = JSON.parse(payload);
            let harpoonSignature:any = await this.auctionManager.getHarpoonSignature(this.accountInfo.account_name, payload.auctionId);
            this.socketMessage.stcSendHarpoonSignature(harpoonSignature);
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

    private extractHostname(url:string) {
        let hostname:string;
        //find & remove protocol (http, ftp, etc.) and get hostname
        if (url.indexOf("//") > -1) {
            hostname = url.split('/')[2];
        }
        else {
            hostname = url.split('/')[0];
        }
        //find & remove port number
        hostname = hostname.split(':')[0];
        //find & remove "?"
        hostname = hostname.split('?')[0];
        return hostname;
    }

    private extractRootDomain(url:string) {
        var domain:string = this.extractHostname(url),
            splitArr = domain.split('.'),
            arrLen = splitArr.length;

        //extracting the root domain here
        //if there is a subdomain
        if (arrLen > 2) {
            domain = splitArr[arrLen - 2] + '.' + splitArr[arrLen - 1];
            //check to see if it's using a Country Code Top Level Domain (ccTLD) (i.e. ".me.uk")
            if (splitArr[arrLen - 2].length == 2 && splitArr[arrLen - 1].length == 2) {
                //this is using a ccTLD
                domain = splitArr[arrLen - 3] + '.' + domain;
            }
        }
        return domain;
    }

    /**
     * Registers an account in the database if it has not already been registered (Using MySQL database).
     *
     * @param accountInfo
     * @param {string} referrer
     * @returns {Promise<void>}
     */
    public registerClientAccount(accountInfo:any, referrer:string) : Promise<user> {

        return new Promise<user>(async (resolve, reject) => {

            try {
                let account: user = await this.dbMySql.qb(user, "user").where({accountName: accountInfo.account_name}).getOne();
                if (account) {
                    // We already have registered this guy, so update his information
                    account.lastConnectedDatetime = new Date();
                    account.connectionCount++;
                    if (Config.PARTNER_REFERRERS.hasOwnProperty(referrer) && Config.PARTNER_REFERRERS[referrer]) {
                        account.referrer = referrer;
                        accountInfo.referrer = account.referrer;
                    } else {
                        accountInfo.referrer = account.referrer;
                    }
                } else {
                    account = new user();
                    account.lastConnectedDatetime = account.creationDatetime = new Date();
                    account.accountName = accountInfo.account_name;
                    account.connectionCount = 1;
                    if (referrer) {
                        let dbReferrer: user = await this.dbMySql.qb(user, "user").where({accountName: referrer}).getOne();
                        if (dbReferrer && (dbReferrer.accountName != accountInfo.account_name)) {
                            // Referrer exists in the database and is not user herself, so it's a go!
                            account.referrer = dbReferrer.accountName;
                        }
                    }
                }
                account.eosBalance = parseFloat(accountInfo.core_liquid_balance.split(" ")[0]);
                account.timeBalance = parseFloat(accountInfo.timeBalance.split(" ")[0]);
                await account.save();

                // Record IP address
                let ip:ipAddress = await this.dbMySql.qb(ipAddress, "ipAddress").leftJoinAndSelect("ipAddress.user_", "u").where({ipAddress: this.ipAddress}).andWhere("u.id = " + account.id).getOne();
                if (ip) {
                    ip.connectionCount++;
                } else {
                    ip = new ipAddress();
                    ip.ipAddress = this.ipAddress;
                    ip.user_ = account;
                }
                await ip.save();

                resolve(account);
            } catch (err) {
                reject(err);
            }

        });

        // return this.dbManager.getDocumentByKey("users", {accountName: accountInfo.account_name}).then((user) => {
        //     if (user) {
        //         // We have already seen this guy
        //         if (user.ipAddresses.indexOf(this.ipAddress) < 0) {
        //             user.ipAddresses.push(this.ipAddress);
        //         }
        //         user.eosBalance = accountInfo.core_liquid_balance;
        //         user.timeBalance = accountInfo.timeBalance;
        //         user.lastConnectedTime = moment().format();
        //         if (Config.PARTNER_REFERRERS.hasOwnProperty(referrer) && Config.PARTNER_REFERRERS[referrer]) {
        //             user.referrer = referrer;
        //             accountInfo.referrer = user.referrer;
        //         } else {
        //             accountInfo.referrer = user.referrer;
        //         }
        //         return this.dbManager.updateDocumentByKey("users", {accountName: accountInfo.account_name}, user);
        //     } else {
        //         // This is a new user
        //         let user: any = {
        //             accountName: accountInfo.account_name,
        //             connectionCount: 1,
        //             eosBalance: accountInfo.core_liquid_balance,
        //             timeBalance: accountInfo.timeBalance,
        //             lastFaucetTime: null,
        //             lastConnectedTime: moment().format(),
        //             ipAddresses: [this.ipAddress]
        //         };
        //         if (referrer) {
        //             return this.dbManager.getDocumentByKey("users", {accountName: referrer}).then((referrer) => {
        //                 if (referrer && (referrer.accountName != accountInfo.account_name)) {
        //                     // Referrer exists in the database and is not user herself, so it's a go!
        //                     user.referrer = referrer.accountName;
        //                 }  else {
        //                     // Referrer did not exist in the database or referred himself - so we ignore!
        //                     user.referrer = null;
        //                 }
        //                 return this.dbManager.insertDocument("users", user);
        //             });
        //         } else {
        //             // No referrer passed in
        //             user.referrer = null;
        //             return this.dbManager.insertDocument("users", user);
        //         }
        //     }
        // }).catch((err) => {
        //     console.log(err);
        // });
    }

    /**
     * Registers an account in the database if it has not already been registered (using MongoDB)
     *
     * @param accountInfo
     * @param {string} referrer
     * @returns {Promise<void>}
     */
    private register_ClientAccount(accountInfo:any, referrer:string) : Promise<void> {
        return this.dbManager.getDocumentByKey("users", {accountName: accountInfo.account_name}).then((user) => {
            if (user) {
                // We have already seen this guy
                if (user.ipAddresses.indexOf(this.ipAddress) < 0) {
                    user.ipAddresses.push(this.ipAddress);
                }
                user.eosBalance = accountInfo.core_liquid_balance;
                user.timeBalance = accountInfo.timeBalance;
                user.lastConnectedTime = moment().format();
                if (Config.PARTNER_REFERRERS.hasOwnProperty(referrer) && Config.PARTNER_REFERRERS[referrer]) {
                    user.referrer = referrer;
                    accountInfo.referrer = user.referrer;
                } else {
                    accountInfo.referrer = user.referrer;
                }
                return this.dbManager.updateDocumentByKey("users", {accountName: accountInfo.account_name}, user);
            } else {
                // This is a new user
                let user: any = {
                    accountName: accountInfo.account_name,
                    connectionCount: 1,
                    eosBalance: accountInfo.core_liquid_balance,
                    timeBalance: accountInfo.timeBalance,
                    lastFaucetTime: null,
                    lastConnectedTime: moment().format(),
                    ipAddresses: [this.ipAddress]
                };
                if (referrer) {
                    return this.dbManager.getDocumentByKey("users", {accountName: referrer}).then((referrer) => {
                       if (referrer && (referrer.accountName != accountInfo.account_name)) {
                           // Referrer exists in the database and is not user herself, so it's a go!
                           user.referrer = referrer.accountName;
                       }  else {
                           // Referrer did not exist in the database or referred himself - so we ignore!
                           user.referrer = null;
                       }
                       return this.dbManager.insertDocument("users", user);
                    });
                } else {
                    // No referrer passed in
                    user.referrer = null;
                    return this.dbManager.insertDocument("users", user);
                }
            }
        }).catch((err) => {
            console.log(err);
        });
    }

}